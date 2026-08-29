/**
 * GenericProviderService — Universal AI provider client supporting 4 API formats.
 *
 * Formats:
 * - chat_completions: OpenAI-compatible /chat/completions (most providers)
 * - messages: Anthropic-style /v1/messages
 * - responses: OpenAI Responses API /responses
 * - google: Gemini generateContent
 *
 * Capabilities:
 * - Non-streaming chat (`sendChatRequest`)
 * - Streaming chat (`streamChatRequest`) — async generator
 * - Multimodal/vision content (image_url parts)
 * - JSON response mode (`response_format: { type: 'json_object' }`)
 * - AbortSignal support
 */

import OpenAI from 'openai';
import { ProviderConfig } from '../../types/provider';
import { withRetry, ProviderName } from '../../utils/apiErrorUtils';
import { assertValidProviderUrl } from '../../utils/providerUrlValidation';

import { recordProviderSuccess, recordProviderError } from '../infrastructure/ProviderHealthService';
import { applyReasoningToChatParams, buildReasoningPatch } from './reasoningControls';
// Side-effect import: harnessLessons registers the wire-route pin checker
// into reasoningControls at module init (P7 read path). Importing here (the
// transport) guarantees the registration happens before any reasoning patch
// is built — harnessLessons imports buildReasoningPatch from
// reasoningControls, so the checker flows in through this module instead of
// a static cycle.
import '../learning/harnessLessons';
import { emitTokenUsage, extractTokenUsage, TokenUsage } from '../../utils/tokenUsage';
import { chatMessagesToGemini, googleGenerateUrl, parseGeminiResponse } from '../../utils/googleGeminiFormat';
import { createThinkingStreamGate, extractAndStripThinkBlocks } from '../../utils/thinkingSplit';
interface ElectronProviderBridge {
    isElectron?: boolean;
        providerChat?: (request: {
        config: ProviderConfig;
        messages: ChatMessage[];
        requestId?: string;
        maxTokens?: number;
        temperature?: number;
        jsonMode?: boolean;
        tools?: ChatRequestOptions['tools'];
        toolChoice?: ChatRequestOptions['toolChoice'];
    }) => Promise<{ ok: boolean; text?: string; reasoning?: string; usage?: TokenUsage; toolCalls?: ChatTurnResult['toolCalls']; assistantMessage?: ChatMessage; status?: number; code?: string; message?: string }>;
    cancelProviderChat?: (requestId: string) => Promise<boolean>;
    discoverModels?: (config: {
        baseUrl: string;
        apiKey: string;
        apiFormat: ProviderConfig['apiFormat'];
    }) => Promise<{ ok: boolean; status?: number; body?: string; message?: string }>;
}

declare global {
    interface Window {
        electronAPI?: ElectronProviderBridge;
    }
}

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single message part — text or image. */
export type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

/** A chat message. `content` may be a plain string or an array of content parts (vision). */
export interface ChatMessage {
    role: string;
    content: string | ContentPart[] | null;
    /** OpenAI-style tool calls on assistant turns. */
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
    /** OpenAI-style tool result linkage. */
    tool_call_id?: string;
    name?: string;
}

export interface ChatRequestOptions {
    maxTokens?: number;
    temperature?: number;
    /** Request JSON object output (chat_completions only uses response_format). */
    jsonMode?: boolean;
    /** Abort signal for cancellation. */
    signal?: AbortSignal;
    onReasoning?: (reasoning: string) => void;
    onUsage?: (usage: TokenUsage) => void;
    /** OpenAI-style tool definitions (chat_completions). */
    tools?: Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }>;
    toolChoice?: 'auto' | 'none' | 'required';
}

export interface ChatTurnResult {
    text: string;
    reasoning: string;
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    /** Raw assistant message for appending into a tool loop (chat_completions). */
    assistantMessage?: ChatMessage;
}

function reportUsage(config: ProviderConfig, data: unknown, options?: ChatRequestOptions): void {
    const usage = extractTokenUsage(data);
    if (!usage) return;
    options?.onUsage?.(usage);
    emitTokenUsage({ providerId: config.id, modelId: config.selectedModel, usage });
}

function reportUsageDirect(config: ProviderConfig, usage: TokenUsage | undefined, options?: ChatRequestOptions): void {
    if (!usage) return;
    options?.onUsage?.(usage);
    emitTokenUsage({ providerId: config.id, modelId: config.selectedModel, usage });
}

// ─── Thinking / Chain-of-Thought Extraction ──────────────────────────────────

/**
 * Normalize a provider reasoning payload to a string. OpenAI-compatible
 * gateways disagree on the shape: `reasoning_content` (DeepSeek), `reasoning`
 * (Qwen/Kimi), sometimes as an array of strings (`reasoning: ["..."]`).
 * Every variant funnels into the same onReasoning side channel.
 */
export function extractReasoning(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map(extractReasoning).filter(Boolean).join('\n');
    }
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        return extractReasoning(obj.text ?? obj.content ?? obj.reasoning ?? obj.reasoning_content);
    }
    return '';
}

/** Pull public text vs thinking out of chat-completions `content` (string or parts). */
export function splitChatContent(content: unknown): { text: string; reasoning: string } {
    if (typeof content === 'string') {
        const split = extractAndStripThinkBlocks(content);
        return { text: split.visible, reasoning: split.leaked };
    }
    if (!Array.isArray(content)) return { text: '', reasoning: '' };
    const texts: string[] = [];
    const thoughts: string[] = [];
    for (const part of content) {
        if (typeof part === 'string') {
            texts.push(part);
            continue;
        }
        if (!part || typeof part !== 'object') continue;
        const block = part as { type?: string; thought?: boolean; thinking?: string; text?: string };
        const type = String(block.type || '');
        if (type === 'thinking' || type === 'reason' || block.thought === true) {
            const inner = block.thinking || block.text || '';
            if (inner.trim()) thoughts.push(inner);
            continue;
        }
        if (typeof block.text === 'string' && block.text) texts.push(block.text);
    }
    const stripped = extractAndStripThinkBlocks(texts.join('\n'));
    return {
        text: stripped.visible,
        reasoning: [...thoughts, stripped.leaked].filter(Boolean).join('\n'),
    };
}

function deltaReasoning(delta: { reasoning_content?: unknown; reasoning?: unknown; reasoning_details?: unknown; content?: unknown }): string {
    const fromField = extractReasoning(delta?.reasoning_content)
        || extractReasoning(delta?.reasoning)
        || extractReasoning(delta?.reasoning_details);
    if (typeof delta?.content === 'string') return fromField;
    const fromContent = splitChatContent(delta?.content).reasoning;
    return [fromField, fromContent].filter(Boolean).join('\n');
}

function deltaVisibleText(delta: { content?: unknown }): string {
    if (typeof delta?.content === 'string') return delta.content;
    return splitChatContent(delta?.content).text;
}

function requestReasoningSideChannel(config: ProviderConfig, params: object): void {
    const host = `${config.baseUrl || ''} ${config.selectedModel || ''}`;
    if (/openrouter\.ai|deepseek|groq\.com|together\.xyz|fireworks\.ai|siliconflow/i.test(host)) {
        (params as Record<string, unknown>).include_reasoning = true;
    }
}

/**
 * Extract the chain of thought from an Anthropic-style messages response.
 * Thinking arrives as `{type:'thinking', thinking, signature}` content blocks
 * (returned only when the request enabled extended thinking); redacted blocks
 * are surfaced as a marker so the user knows the provider withheld part of it.
 */
export function extractMessagesThinking(content: unknown): string {
    if (!Array.isArray(content)) return '';
    const parts: string[] = [];
    for (const block of content) {
        if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
            parts.push(block.thinking.trim());
        } else if (block?.type === 'redacted_thinking') {
            parts.push('[Thinking redacted by provider]');
        }
    }
    return parts.join('\n');
}

/**
 * Extract the chain of thought from an OpenAI Responses API payload.
 * Reasoning arrives as `output` items of type `reasoning` — full text in
 * `content` (output_text blocks), the public summary in `summary`
 * (summary_text blocks). Both are captured; some gateways emit only one.
 */
export function extractResponsesReasoning(output: unknown): string {
    if (!Array.isArray(output)) return '';
    const parts: string[] = [];
    for (const item of output) {
        if (item?.type !== 'reasoning') continue;
        if (Array.isArray(item.content)) {
            for (const block of item.content) {
                if (block?.type === 'output_text' && typeof block.text === 'string') parts.push(block.text);
            }
        }
        if (Array.isArray(item.summary)) {
            for (const block of item.summary) {
                if (block?.type === 'summary_text' && typeof block.text === 'string') parts.push(block.text);
            }
        }
    }
    return parts.join('\n');
}

// ─── Extended Thinking (request side) ───────────────────────────────────────

/**
 * Anthropic extended-thinking-capable Claude models. The `thinking` request
 * block is only valid on these — older Claude models reject it with a 400, so
 * the gate is model-id based (with a manual override flag below).
 * Covers 3.7 / 4 / 4.5 and the 5-series ids (the old regex missed opus-5 /
 * sonnet-5, silently disabling thinking on them).
 */
const EXTENDED_THINKING_MODEL_RE = /claude-(?:3-7|3\.7|sonnet-4|opus-4|haiku-4-5|sonnet-5|opus-5|4-5)/i;

/** Chain-of-thought budget as a fraction of max_tokens (always kept below it). */
const THINKING_BUDGET_FRACTION = 0.35;

/**
 * Whether to request extended thinking on an Anthropic messages call.
 * Gated on: a thinking-capable Claude model id (or the explicit
 * `thinkingCapable` override on the provider config — the regex can't know
 * every future id), no JSON mode (structured output and extended thinking
 * are mutually exclusive), and enough headroom for Anthropic's
 * 1024 <= budget_tokens < max_tokens constraint.
 *
 * The old `maxTokens >= 4096` floor silently excluded every rebuttal round
 * (TASK_BUDGETS.rebuttal = 2560), so Claude seats never thought during
 * debates. 2560 already fits the Anthropic constraint — the floor only needs
 * to keep budget_tokens under max_tokens, which THINKING_BUDGET_FRACTION
 * guarantees for any maxTokens > 1576 (0.35×2560 ≈ 896 clamps to 1024).
 * Connection tests still pass maxTokens 10: the real floor is
 * MIN_EFFECTIVE_THINKING_TOKENS, below which thinking is pointless.
 */
const MIN_EFFECTIVE_THINKING_TOKENS = 1024;

export function shouldRequestExtendedThinking(config: ProviderConfig, options?: ChatRequestOptions): boolean {
    if (config.apiFormat !== 'messages') return false;
    if (options?.jsonMode) return false;
    const maxTokens = options?.maxTokens ?? 4096;
    if (maxTokens <= MIN_EFFECTIVE_THINKING_TOKENS) return false;
    if (config.thinkingCapable === false) return false;
    if (config.thinkingCapable === true) return true;
    return EXTENDED_THINKING_MODEL_RE.test(config.selectedModel || '');
}

// ─── URL Normalization Helper ───────────────────────────────────────────────

/**
 * Normalizes base URLs by stripping trailing slashes and format-specific endpoint suffixes.
 * This ensures that pasting full endpoint URLs (e.g. ending in /chat/completions) works properly.
 */
export function normalizeBaseUrl(url: string, format: string): string {
    let clean = (url || '').trim().replace(/\/+$/, '');
    if (!clean) return '';

    for (const suffix of ['/chat/completions', '/messages', '/responses']) {
        if (clean.endsWith(suffix)) {
            clean = clean.substring(0, clean.length - suffix.length);
            break;
        }
    }
    return clean;
}

/**
 * Warm a provider's connection before it is actually needed (perceived speed).
 * Fires a cheap no-cors HEAD at the provider origin so the browser completes
 * DNS + TCP + TLS and keeps the socket in its connection pool. When the real
 * verdict/analysis request lands moments later, it reuses the warm socket and
 * skips the handshake latency. Never throws, never consumes tokens, and is a
 * no-op on Electron (main process owns its own sockets) and on the localhost
 * dev proxy (already same-origin warm).
 */
export function warmProviderConnection(config: ProviderConfig): void {
    try {
        if (typeof window === 'undefined' || typeof fetch !== 'function') return;
        const electronAPI = (window as { electronAPI?: { isElectron?: boolean } }).electronAPI;
        if (electronAPI?.isElectron) return;
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') return;
        const base = normalizeBaseUrl(config.baseUrl, config.apiFormat);
        if (!base) return;
        let origin: string;
        try {
            origin = new URL(base).origin;
        } catch {
            return;
        }
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 3000);
        fetch(origin, { method: 'HEAD', mode: 'no-cors', signal: controller.signal })
            .catch(() => undefined)
            .finally(() => window.clearTimeout(timer));
    } catch {
        // Warm-up is best-effort; never surface an error.
    }
}

// ─── Client Factory ─────────────────────────────────────────────────────────

/**
 * Create an OpenAI SDK client for chat_completions providers.
 */
function createOpenAIClient(config: ProviderConfig): OpenAI {
    return new OpenAI({
        apiKey: config.apiKey?.trim() || 'not-needed',
        baseURL: normalizeBaseUrl(config.baseUrl, config.apiFormat),
        dangerouslyAllowBrowser: true,
    });
}

// ─── Timeout & Retry Helpers ────────────────────────────────────────────────

/** Abort a request if it exceeds this wall-clock duration (per attempt). */
const REQUEST_TIMEOUT_MS = 120_000;

// Streaming analysis calls (reasoning-heavy models + large prompts) regularly
// exceed the non-streaming budget — the chain of thought streams first, then
// the answer. Give streams 5 minutes before declaring a timeout.
const STREAM_TIMEOUT_MS = 300_000;

/**
 * Combine the caller's AbortSignal with a strict timeout. A fresh combined
 * signal is created per attempt so a retry gets a full timeout budget.
 * (AbortSignal.timeout / AbortSignal.any are supported in Chromium 103+,
 * Node 20+, and Electron 25+.)
 */
function withTimeoutSignal(signal?: AbortSignal): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function withStreamTimeoutSignal(signal?: AbortSignal): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(STREAM_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

// ─── Chat Completions Format ────────────────────────────────────────────────

async function chatCompletionsTurn(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): Promise<ChatTurnResult> {
    const client = createOpenAIClient(config);
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: config.selectedModel,
        messages: messages as any,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
    };
    if (options?.jsonMode) {
        (params as any).response_format = { type: 'json_object' };
    }
    if (options?.tools?.length) {
        (params as any).tools = options.tools;
        (params as any).tool_choice = options.toolChoice ?? 'auto';
    }
    requestReasoningSideChannel(config, params);
    applyReasoningToChatParams(config, params as unknown as Record<string, unknown>, options);
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
        response = await client.chat.completions.create(params, { signal: withTimeoutSignal(options?.signal) });
    } catch (error: any) {
        if (options?.jsonMode && (error?.status === 400 || error?.status === 422)) {
            const fallbackParams = { ...params } as Record<string, unknown>;
            delete fallbackParams.response_format;
            response = await client.chat.completions.create(fallbackParams as any, { signal: withTimeoutSignal(options?.signal) });
        } else if (options?.tools?.length && (error?.status === 400 || error?.status === 422)) {
            // Gateway rejects tools — retry without them so the text-protocol fallback can run.
            const fallbackParams = { ...params } as Record<string, unknown>;
            delete fallbackParams.tools;
            delete fallbackParams.tool_choice;
            response = await client.chat.completions.create(fallbackParams as any, { signal: withTimeoutSignal(options?.signal) });
        } else {
            throw error;
        }
    }
    const message = response.choices[0]?.message as any;
    const splitContent = splitChatContent(message?.content);
    const reasoning = [
        extractReasoning(message?.reasoning_content),
        extractReasoning(message?.reasoning),
        extractReasoning(message?.reasoning_details),
        splitContent.reasoning,
    ].filter(Boolean).join('\n');
    const content = splitContent.text;
    if (!content && !reasoning && !message?.tool_calls?.length && options?.jsonMode) {
        return chatCompletionsTurn(config, messages, { ...options, jsonMode: false });
    }
    if (reasoning.trim()) options?.onReasoning?.(reasoning.trim());
    reportUsage(config, response, options);
    const toolCalls = (message?.tool_calls || []).map((tc: any, i: number) => {
        let args: Record<string, unknown>;
        try {
            args = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
            args = { raw: tc?.function?.arguments || '' };
        }
        return {
            id: tc?.id || `call_${i}`,
            name: String(tc?.function?.name || ''),
            arguments: args && typeof args === 'object' ? args : {},
        };
    }).filter((c: { name: string }) => c.name);
    const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: typeof content === 'string' ? content : (content ?? ''),
        ...(message?.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    };
    return {
        text: typeof content === 'string' ? content : '',
        reasoning: reasoning.trim(),
        toolCalls,
        assistantMessage,
    };
}

async function chatCompletionsCall(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): Promise<string> {
    const turn = await chatCompletionsTurn(config, messages, options);
    return turn.text;
}

async function* chatCompletionsStream(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): AsyncGenerator<string, void, unknown> {
    const client = createOpenAIClient(config);
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: config.selectedModel,
        messages: messages as any,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
        stream: true,
        stream_options: { include_usage: true },
    };
    if (options?.jsonMode) {
        (params as any).response_format = { type: 'json_object' };
    }
    requestReasoningSideChannel(config, params);
    applyReasoningToChatParams(config, params as unknown as Record<string, unknown>, options);
    const stream = await client.chat.completions.create(params, { signal: withStreamTimeoutSignal(options?.signal) });
    const gate = createThinkingStreamGate();
    for await (const chunk of stream) {
        reportUsage(config, chunk, options);
        const delta = chunk.choices[0]?.delta as any;
        const reasoning = deltaReasoning(delta);
        if (reasoning.trim()) options?.onReasoning?.(reasoning);
        const gated = gate.push(deltaVisibleText(delta));
        if (gated.thinking.trim()) options?.onReasoning?.(gated.thinking);
        if (gated.visible) yield gated.visible;
    }
    const flushed = gate.flush();
    if (flushed.thinking.trim()) options?.onReasoning?.(flushed.thinking);
    if (flushed.visible) yield flushed.visible;
}

// ─── Messages Format (Anthropic-style) ──────────────────────────────────────

/** Convert a ChatMessage's content to Anthropic message content blocks. */
export function toAnthropicContent(content: string | ContentPart[] | null): any[] {
    if (content == null) return [];
    if (typeof content === 'string') {
        return content ? [{ type: 'text', text: content }] : [];
    }
    return content.map(part => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        const url = part.image_url.url;
        const commaIdx = url.indexOf(',');
        if (url.startsWith('data:') && commaIdx !== -1) {
            // data:image/png;base64,<payload> — carry the real media type
            // (JPEG/WebP screenshots were previously hardcoded as PNG).
            const header = url.slice(5, commaIdx);
            const mimeMatch = header.match(/^image\/(png|jpeg|webp|gif)\b/i);
            const mediaType = mimeMatch ? mimeMatch[1].toLowerCase() : 'png';
            return { type: 'image', source: { type: 'base64', media_type: `image/${mediaType}`, data: url.slice(commaIdx + 1) } };
        }
        // Non-data URL — pass through as a URL source instead of silently
        // emitting an empty base64 payload.
        return { type: 'image', source: { type: 'url', url } };
    });
}

async function messagesCall(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): Promise<string> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    const body: any = {
        model: config.selectedModel,
        max_tokens: options?.maxTokens ?? 4096,
        messages: nonSystemMsgs.map(m => ({ role: m.role, content: toAnthropicContent(m.content) })),
    };
    const maxTokensForBody = body.max_tokens as number;
    if (systemMsg) {
        body.system = typeof systemMsg.content === 'string' ? systemMsg.content : (systemMsg.content as ContentPart[]).map(p => p.type === 'text' ? p.text : '').join('');
    }
    // Explicit 0.7 default — matches chat_completions/responses. Anthropic's
    // API default is 1.0, so omitting temperature sampled the same task at a
    // different value per provider format and polluted calibration data.
    body.temperature = options?.temperature ?? 0.7;
    // Extended thinking (thinking-capable Claude models only — older models
    // reject the `thinking` block with a 400): request a chain-of-thought
    // budget so `thinking` content blocks come back. Anthropic requires
    // temperature unset when thinking is enabled, so the explicit value drops.
    if (shouldRequestExtendedThinking(config, options)) {
        body.thinking = {
            type: 'enabled',
            budget_tokens: Math.min(
                maxTokensForBody - 1,
                Math.max(1024, Math.floor(maxTokensForBody * THINKING_BUDGET_FRACTION)),
            ),
        };
        delete body.temperature;
    }

    const url = `${normalizeBaseUrl(config.baseUrl, 'messages')}/messages`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal: options?.signal,
    });

    if (!response.ok) {
        const status = response.status;
        const friendlyMessage =
            status === 401 ? 'Invalid API key. Check your provider settings.' :
            status === 403 ? 'Access denied. Your API key may lack permissions.' :
            status === 429 ? 'Rate limit reached. Please wait and try again.' :
            status >= 500 ? `${config.name || 'Provider'} server error. Try again later.` :
            `${config.name || 'Provider'} request failed (${status}).`;
        const err = new Error(friendlyMessage);
        (err as any).status = status; // Preserve for retry/quota classification
        throw err;
    }

    const data = await response.json();
    // Anthropic chain of thought arrives as `thinking` content blocks — forward
    // it on the same side channel as chat_completions reasoning_content.
    const thinking = extractMessagesThinking(data.content);
    if (thinking) options?.onReasoning?.(thinking);
    reportUsage(config, data, options);
    if (data.content && Array.isArray(data.content)) {
        return data.content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n');
    }
    return data.text || JSON.stringify(data);
}

// ─── Responses Format (OpenAI Responses API) ────────────────────────────────

export function toResponsesInput(messages: ChatMessage[]): any[] {
    // The Responses API only accepts user/assistant roles in `input` — system
    // content belongs in the top-level `instructions` field (see responsesCall).
    // Passing role:'system' here gets a 400-class rejection.
    return messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role,
        content: m.content == null
            ? ''
            : typeof m.content === 'string'
            ? m.content
            : (m.content as ContentPart[]).map(p => p.type === 'text' ? { type: 'input_text', text: p.text } : { type: 'input_image', image_url: p.image_url.url }),
    }));
}

async function responsesCall(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): Promise<string> {
    const url = `${normalizeBaseUrl(config.baseUrl, 'responses')}/responses`;
    const systemMsg = messages.find(m => m.role === 'system');
    const instructions = systemMsg
        ? typeof systemMsg.content === 'string'
            ? systemMsg.content
            : (systemMsg.content as ContentPart[]).map(p => p.type === 'text' ? p.text : '').join('')
        : undefined;
    const reasoningPatch = buildReasoningPatch(config, options?.reasoningEffort ?? 'auto');
    options?.onWireAudit?.(reasoningPatch.audit);
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.selectedModel,
            input: toResponsesInput(messages),
            ...(instructions ? { instructions } : {}),
            max_output_tokens: options?.maxTokens ?? 4096,
            temperature: options?.temperature ?? 0.7,
            ...reasoningPatch.patch,
        }),
        signal: options?.signal,
    });

    if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        const friendlyMessage =
            status === 401 ? 'Invalid API key. Check your provider settings.' :
            status === 429 ? 'Rate limit reached. Please wait and try again.' :
            status >= 500 ? `${config.name || 'Provider'} server error. Try again later.` :
            `${config.name || 'Provider'} request failed (${status}).`;
        const err = new Error(friendlyMessage);
        (err as any).status = status; // Preserve for retry/quota classification
        throw err;
    }

    const data = await response.json();
    // OpenAI Responses API reasoning arrives as `output` items of type
    // `reasoning` (full text + public summary) — forward on onReasoning.
    const reasoning = extractResponsesReasoning(data.output);
    if (reasoning) options?.onReasoning?.(reasoning);
    reportUsage(config, data, options);
    if (data.output && Array.isArray(data.output)) {
        const texts: string[] = [];
        for (const item of data.output) {
            if (item.type === 'message' && item.content) {
                for (const block of item.content) {
                    if (block.type === 'output_text') {
                        texts.push(block.text);
                    }
                }
            }
        }
        if (texts.length > 0) return texts.join('\n');
    }
    if (data.output_text) return data.output_text;
    return JSON.stringify(data);
}

async function googleCall(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): Promise<string> {
    const base = normalizeBaseUrl(config.baseUrl, config.apiFormat);
    const key = (config.apiKey || '').trim();
    const url = googleGenerateUrl(base, config.selectedModel, key, false);
    const body = chatMessagesToGemini(messages, {
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
        jsonMode: options?.jsonMode,
        model: config.selectedModel,
    });
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) {
        const status = response.status;
        const friendlyMessage =
            status === 401 || status === 403 ? 'Invalid API key. Check your provider settings.' :
            status === 429 ? 'Rate limit reached. Please wait and try again.' :
            status >= 500 ? `${config.name || 'Provider'} server error. Try again later.` :
            `${config.name || 'Provider'} request failed (${status}).`;
        const err = new Error(friendlyMessage);
        (err as { status?: number }).status = status;
        throw err;
    }
    const data = await response.json();
    const parsed = parseGeminiResponse(data);
    if (parsed.reasoning) options?.onReasoning?.(parsed.reasoning);
    reportUsage(config, data, options);
    return parsed.text;
}

// ─── Universal Dispatchers ──────────────────────────────────────────────────

function assertHasKey(config: ProviderConfig): void {
    assertValidProviderUrl(config.baseUrl);
}

/**
 * Convert low-level provider/SDK errors into user-safe messages.
 * Raw API error bodies can leak internals (URLs, request dumps), so they are
 * logged for debugging but never surfaced verbatim. The `status` property is
 * preserved so callers can still detect rate limits / quota errors, and abort
 * errors pass through untouched so cancellation keeps working.
 */
function toFriendlyProviderError(error: unknown, providerName: string): unknown {
    const err = error as { name?: string; code?: string; status?: number; message?: string };

    // Cancellation — must propagate as-is
    if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.name === 'TimeoutError') {
        return error;
    }

    const name = providerName || 'Provider';
    const status = typeof err?.status === 'number' ? err.status : undefined;

    let friendly: string;
    if (status === 401) {
        friendly = `${name}: invalid API key. Check your provider settings.`;
    } else if (status === 403) {
        friendly = `${name}: access denied. Your API key may lack permissions or credits.`;
    } else if (status === 429) {
        friendly = `${name}: rate limit or quota reached. Please wait and try again.`;
    } else if (status === 404) {
        friendly = `${name}: model or endpoint not found. Check the base URL and model id.`;
    } else if (status && status >= 500) {
        friendly = `${name}: server error (${status}). Try again later.`;
    } else if (status) {
        friendly = `${name}: request failed (${status}).`;
    } else {
        const rawMessage = (err?.message || '').trim();
        const raw = rawMessage.toLowerCase();
        if (raw.includes('desktop provider bridge')) {
            friendly = 'Desktop provider bridge is not loaded. Fully quit and restart the Electron app.';
        } else if (raw.includes('aborted') || raw.includes('timed out') || raw.includes('timeout')) {
            // "The operation was aborted" arrives from the Electron bridge when
            // the main-process timer (or our per-attempt cap) killed a hung
            // request — surface it as a timeout, not a mystery abort.
            friendly = `${name}: request timed out. The provider may be overloaded — try again shortly.`;
        } else if (raw.includes('fetch') || raw.includes('network') || raw.includes('econnrefused') || raw.includes('enotfound') || raw.includes('failed to connect') || raw.includes('certificate') || raw.includes('tls')) {
            friendly = `${name}: could not reach the server. Check the base URL and your connection.`;
        } else if (rawMessage && rawMessage.toLowerCase() !== 'provider request failed.') {
            // Sanitize the raw SDK text before surfacing it: it can embed the
            // provider base URL and response-body excerpts (which may echo the
            // user's prompt). Strip URLs and key-like tokens, then cap length.
            const sanitized = rawMessage
                .replace(/https?:\/\/\S+/g, '[url]')
                .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '***')
                .slice(0, 300);
            friendly = `${name}: ${sanitized}`;
        } else {
            friendly = `${name}: request failed.`;
        }
    }

    console.warn(`[GenericProviderService] ${name} request failed with status ${status ?? 'unknown'}`);
    const wrapped = new Error(friendly);
    if (status !== undefined) {
        (wrapped as any).status = status;
    }
    return wrapped;
}

function parseProviderErrorBody(raw: string): string {
    try {
        const parsed = JSON.parse(raw) as any;
        const message = parsed?.error?.message || parsed?.error?.error?.message || parsed?.message || parsed?.detail;
        return typeof message === 'string' ? message.trim().slice(0, 300) : '';
    } catch {
        return raw.replace(/\s+/g, ' ').trim().slice(0, 300);
    }
}

/**
 * Send a chat request to any provider, routing to the correct API format.
 */
export async function sendChatRequest(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): Promise<string> {
    assertHasKey(config);
    const effectiveConfig = {
        ...config,
        apiKey: config.apiKey?.trim() || 'not-needed'
    };
    const startedAt = Date.now();
    try {
        // Retry transient failures (rate limit / network / 5xx) with
        // exponential backoff; each attempt is hard-capped by REQUEST_TIMEOUT_MS.
        const result = await withRetry(
            () => {
                const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
                if (electronAPI?.isElectron && !electronAPI.providerChat) {
                    throw new Error('Desktop provider bridge is not loaded. Fully quit and restart the Electron app.');
                }
                if (electronAPI?.isElectron && electronAPI.providerChat) {
                    const requestId = `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    const cancelRequest = () => {
                        void electronAPI.cancelProviderChat?.(requestId);
                    };
                    options?.signal?.addEventListener('abort', cancelRequest, { once: true });
                    // An abort arriving BEFORE the listener registered would
                    // never fire it — re-check so a main-process request can't
                    // run to its 300s cap on an already-aborted signal.
                    if (options?.signal?.aborted) cancelRequest();
                    // Hard per-attempt timeout for the Electron bridge. Unlike
                    // the web paths it has no built-in cap, and main.cjs's
                    // 300s guard surfaces only as a generic "aborted" error —
                    // without this a wedged main-process request could hang
                    // the pipeline ~15 minutes across 3 retries.
                    const timeout = window.setTimeout(() => cancelRequest(), REQUEST_TIMEOUT_MS);
                    return electronAPI.providerChat({
                        config: effectiveConfig,
                        messages,
                        requestId,
                        maxTokens: options?.maxTokens,
                        temperature: options?.temperature,
                        jsonMode: options?.jsonMode,
                        tools: options?.tools,
                        toolChoice: options?.toolChoice,
                    }).then(result => {
                        if (!result.ok) {
                            const error = new Error(result.message || 'Provider request failed.');
                            if (result.status !== undefined) (error as any).status = result.status;
                            if (result.code !== undefined) (error as any).code = result.code;
                            throw error;
                        }
                        if (result.reasoning) options?.onReasoning?.(result.reasoning);
                        reportUsageDirect(effectiveConfig, result.usage, options);
                        return result.text || '';
                    }).finally(() => {
                        window.clearTimeout(timeout);
                        options?.signal?.removeEventListener('abort', cancelRequest);
                    });
                }
                if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
                    return fetch('/__provider_proxy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            config: effectiveConfig,
                            messages,
                            maxTokens: options?.maxTokens,
                            temperature: options?.temperature,
                            jsonMode: options?.jsonMode,
                            tools: options?.tools,
                            toolChoice: options?.toolChoice,
                        }),
                        signal: options?.signal,
                    }).then(async response => {
                        const result = await response.json() as { ok?: boolean; status?: number; body?: string; reasoning?: string; message?: string };
                        if (!response.ok || !result.ok) {
                            const providerBody = result.body ? parseProviderErrorBody(result.body) : '';
                            const error = new Error(result.message || providerBody || `Provider request failed (${result.status || response.status}).`);
                            if (result.status !== undefined) (error as any).status = result.status;
                            throw error;
                        }
                        let data: any;
                        try {
                            data = result.body ? JSON.parse(result.body) : {};
                        } catch (e) {
                            const message = e instanceof Error ? e.message : 'Unknown JSON parsing error';
                            throw new Error(`Provider proxy returned invalid JSON: ${message}. Body: ${(result.body || '').slice(0, 200)}`, { cause: e });
                        }
                        let reasoning = result.reasoning || '';
                        if (!reasoning) {
                            // The localhost proxy returns `reasoning` for
                            // chat_completions; fall back to a per-format parse
                            // so messages/responses thinking survives the proxy.
                            if (effectiveConfig.apiFormat === 'messages') {
                                reasoning = extractMessagesThinking(data.content);
                            } else if (effectiveConfig.apiFormat === 'responses') {
                                reasoning = extractResponsesReasoning(data.output);
                            } else if (effectiveConfig.apiFormat === 'google') {
                                reasoning = parseGeminiResponse(data).reasoning;
                            } else {
                                reasoning = extractReasoning(data.choices?.[0]?.message?.reasoning_content) || extractReasoning(data.choices?.[0]?.message?.reasoning);
                            }
                        }
                        let text: string;
                        if (effectiveConfig.apiFormat === 'messages') {
                            text = Array.isArray(data.content) ? data.content.filter((block: any) => block?.type === 'text').map((block: any) => block.text).join('\n') : data.text || '';
                        } else if (effectiveConfig.apiFormat === 'responses') {
                            text = data.output_text || '';
                        } else if (effectiveConfig.apiFormat === 'google') {
                            text = parseGeminiResponse(data).text;
                        } else {
                            const message = data.choices?.[0]?.message || {};
                            const content = Array.isArray(message.content)
                                ? message.content.filter((part: any) => typeof part?.text === 'string').map((part: any) => part.text).join('\n')
                                : message.content;
                            text = content || '';
                        }
                        if (reasoning.trim()) options?.onReasoning?.(reasoning.trim());
                        reportUsage(effectiveConfig, data, options);
                        return text || '';
                    });
                }
                switch (effectiveConfig.apiFormat) {
                    case 'chat_completions':
                        // chatCompletionsCall applies its own per-attempt
                        // timeout internally (needed for its jsonMode retry).
                        return chatCompletionsCall(effectiveConfig, messages, options);
                    case 'messages':
                        return messagesCall(effectiveConfig, messages, { ...options, signal: withTimeoutSignal(options?.signal) });
                    case 'responses':
                        return responsesCall(effectiveConfig, messages, { ...options, signal: withTimeoutSignal(options?.signal) });
                    case 'google':
                        return googleCall(effectiveConfig, messages, { ...options, signal: withTimeoutSignal(options?.signal) });
                    default:
                        throw new Error(`Unknown API format: ${effectiveConfig.apiFormat}`);
                }
            },
            (effectiveConfig.name as ProviderName) || 'Provider',
            3,
            options?.signal
        );
        recordProviderSuccess(config.id, Date.now() - startedAt);
        return result;
    } catch (error) {
        const err = error as { name?: string; code?: string };
        const isAbort = err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.name === 'TimeoutError';
        if (!isAbort) recordProviderError(config.id, error);
        throw toFriendlyProviderError(error, `${effectiveConfig.name} · ${effectiveConfig.selectedModel}`);
    }
}

/**
 * One chat turn that can return native tool calls (chat_completions).
 * Other formats return text only — callers may fall back to the text tool protocol.
 */
export async function sendChatTurn(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): Promise<ChatTurnResult> {
    assertHasKey(config);
    const effectiveConfig = {
        ...config,
        apiKey: config.apiKey?.trim() || 'not-needed'
    };
    const startedAt = Date.now();
    try {
        const result = await withRetry(
            async () => {
                const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
                if (electronAPI?.isElectron && electronAPI.providerChat) {
                    const requestId = `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    const cancelRequest = () => {
                        void electronAPI.cancelProviderChat?.(requestId);
                    };
                    options?.signal?.addEventListener('abort', cancelRequest, { once: true });
                    if (options?.signal?.aborted) cancelRequest();
                    const timeout = window.setTimeout(() => cancelRequest(), REQUEST_TIMEOUT_MS);
                    try {
                        const bridge = await electronAPI.providerChat({
                            config: effectiveConfig,
                            messages,
                            requestId,
                            maxTokens: options?.maxTokens,
                            temperature: options?.temperature,
                            jsonMode: options?.jsonMode,
                            tools: options?.tools,
                            toolChoice: options?.toolChoice,
                        });
                        if (!bridge.ok) {
                            const error = new Error(bridge.message || 'Provider request failed.');
                            if (bridge.status !== undefined) (error as any).status = bridge.status;
                            if (bridge.code !== undefined) (error as any).code = bridge.code;
                            throw error;
                        }
                        if (bridge.reasoning) options?.onReasoning?.(bridge.reasoning);
                        reportUsageDirect(effectiveConfig, bridge.usage, options);
                        return {
                            text: bridge.text || '',
                            reasoning: bridge.reasoning || '',
                            toolCalls: bridge.toolCalls || [],
                            assistantMessage: bridge.assistantMessage || {
                                role: 'assistant',
                                content: bridge.text || '',
                            },
                        } satisfies ChatTurnResult;
                    } finally {
                        window.clearTimeout(timeout);
                        options?.signal?.removeEventListener('abort', cancelRequest);
                    }
                }
                if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
                    const response = await fetch('/__provider_proxy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            config: effectiveConfig,
                            messages,
                            maxTokens: options?.maxTokens,
                            temperature: options?.temperature,
                            jsonMode: options?.jsonMode,
                            tools: options?.tools,
                            toolChoice: options?.toolChoice,
                        }),
                        signal: options?.signal,
                    });
                    const result = await response.json() as { ok?: boolean; status?: number; body?: string; reasoning?: string; message?: string };
                    if (!response.ok || !result.ok) {
                        const providerBody = result.body ? parseProviderErrorBody(result.body) : '';
                        const error = new Error(result.message || providerBody || `Provider request failed (${result.status || response.status}).`);
                        if (result.status !== undefined) (error as any).status = result.status;
                        throw error;
                    }
                    let data: any;
                    try {
                        data = result.body ? JSON.parse(result.body) : {};
                    } catch (e) {
                        const message = e instanceof Error ? e.message : 'Unknown JSON parsing error';
                        throw new Error(`Provider proxy returned invalid JSON: ${message}. Body: ${(result.body || '').slice(0, 200)}`, { cause: e });
                    }
                    if (effectiveConfig.apiFormat === 'chat_completions') {
                        const message = data.choices?.[0]?.message || {};
                        const splitContent = splitChatContent(message.content);
                        const reasoning = result.reasoning
                            || extractReasoning(message.reasoning_content)
                            || extractReasoning(message.reasoning)
                            || splitContent.reasoning;
                        if (reasoning.trim()) options?.onReasoning?.(reasoning.trim());
                        reportUsage(effectiveConfig, data, options);
                        const toolCalls = (message.tool_calls || []).map((tc: any, i: number) => {
                            let args: Record<string, unknown>;
                            try {
                                args = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {};
                            } catch {
                                args = { raw: tc?.function?.arguments || '' };
                            }
                            return {
                                id: tc?.id || `call_${i}`,
                                name: String(tc?.function?.name || ''),
                                arguments: args && typeof args === 'object' ? args : {},
                            };
                        }).filter((c: { name: string }) => c.name);
                        return {
                            text: splitContent.text || '',
                            reasoning: reasoning.trim(),
                            toolCalls,
                            assistantMessage: {
                                role: 'assistant',
                                content: splitContent.text || '',
                                ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
                            },
                        } satisfies ChatTurnResult;
                    }
                    // Non-chat_completions via proxy: text only.
                    let text: string;
                    let reasoning = result.reasoning || '';
                    if (effectiveConfig.apiFormat === 'messages') {
                        text = Array.isArray(data.content) ? data.content.filter((block: any) => block?.type === 'text').map((block: any) => block.text).join('\n') : data.text || '';
                        if (!reasoning) reasoning = extractMessagesThinking(data.content);
                    } else if (effectiveConfig.apiFormat === 'responses') {
                        text = data.output_text || '';
                        if (!reasoning) reasoning = extractResponsesReasoning(data.output);
                    } else if (effectiveConfig.apiFormat === 'google') {
                        const parsed = parseGeminiResponse(data);
                        text = parsed.text;
                        if (!reasoning) reasoning = parsed.reasoning;
                    } else {
                        text = data.choices?.[0]?.message?.content || '';
                    }
                    if (reasoning.trim()) options?.onReasoning?.(reasoning.trim());
                    reportUsage(effectiveConfig, data, options);
                    return {
                        text: text || '',
                        reasoning: reasoning.trim(),
                        toolCalls: [],
                        assistantMessage: { role: 'assistant', content: text || '' },
                    } satisfies ChatTurnResult;
                }
                if (effectiveConfig.apiFormat === 'chat_completions') {
                    return chatCompletionsTurn(effectiveConfig, messages, options);
                }
                // Other formats: reuse string path; text-protocol tools still work.
                const text = effectiveConfig.apiFormat === 'messages'
                    ? await messagesCall(effectiveConfig, messages, { ...options, signal: withTimeoutSignal(options?.signal) })
                    : effectiveConfig.apiFormat === 'responses'
                        ? await responsesCall(effectiveConfig, messages, { ...options, signal: withTimeoutSignal(options?.signal) })
                        : effectiveConfig.apiFormat === 'google'
                            ? await googleCall(effectiveConfig, messages, { ...options, signal: withTimeoutSignal(options?.signal) })
                            : '';
                return {
                    text,
                    reasoning: '',
                    toolCalls: [],
                    assistantMessage: { role: 'assistant', content: text },
                } satisfies ChatTurnResult;
            },
            (effectiveConfig.name as ProviderName) || 'Provider',
            3,
            options?.signal
        );
        recordProviderSuccess(config.id, Date.now() - startedAt);
        return result;
    } catch (error) {
        const err = error as { name?: string; code?: string };
        const isAbort = err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.name === 'TimeoutError';
        if (!isAbort) recordProviderError(config.id, error);
        throw toFriendlyProviderError(error, `${effectiveConfig.name} · ${effectiveConfig.selectedModel}`);
    }
}

/**
 * Stream a chat response from any provider as an async generator.
 * Currently supports chat_completions (the dominant format). For messages/responses
 * formats, falls back to non-streaming and yields the full result once.
 * Streaming applies the same hard timeout as non-streaming calls.
 */
export async function* streamChatRequest(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): AsyncGenerator<string, void, unknown> {
    assertHasKey(config);
    const effectiveConfig = {
        ...config,
        apiKey: config.apiKey?.trim() || 'not-needed'
    };
    try {
        const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
        if (electronAPI?.isElectron && electronAPI.providerChat) {
            yield await sendChatRequest(effectiveConfig, messages, options);
            return;
        }
        // Dev browser on localhost: route through the CORS-avoiding Vite
        // provider proxy, which passes SSE through. Direct SDK streaming from
        // the browser fails for providers without CORS headers (e.g. opencode).
        if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            if (effectiveConfig.apiFormat === 'chat_completions') {
                const startedAt = Date.now();
                try {
                    yield* streamViaProxy(effectiveConfig, messages, options);
                    recordProviderSuccess(config.id, Date.now() - startedAt);
                } catch (streamError) {
                    const err = streamError as { name?: string; code?: string };
                    const isAbort = err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.name === 'TimeoutError';
                    if (!isAbort) recordProviderError(config.id, streamError);
                    throw streamError;
                }
                return;
            }
            // Other formats: non-streaming through the proxy (existing behavior).
            const full = await sendChatRequest(effectiveConfig, messages, options);
            yield full;
            return;
        }
        if (effectiveConfig.apiFormat === 'chat_completions') {
            const startedAt = Date.now();
            try {
                yield* chatCompletionsStream(effectiveConfig, messages, { ...options, signal: withStreamTimeoutSignal(options?.signal) });
                recordProviderSuccess(config.id, Date.now() - startedAt);
            } catch (streamError) {
                const err = streamError as { name?: string; code?: string };
                const isAbort = err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.name === 'TimeoutError';
                if (!isAbort) recordProviderError(config.id, streamError);
                throw streamError;
            }
            return;
        }
        // Fallback for non-OpenAI-compat formats: fetch then yield once.
        // Inside the try so its errors flow through toFriendlyProviderError
        // (previously this sat after the catch and bypassed friendly mapping).
        const full = await sendChatRequest(effectiveConfig, messages, options);
        yield full;
    } catch (error) {
        throw toFriendlyProviderError(error, effectiveConfig.name);
    }
}

/**
 * Stream chat_completions through the localhost dev provider proxy. The proxy
 * pipes the upstream SSE response through; we parse `data:` events here and
 * yield content deltas while forwarding reasoning deltas to onReasoning.
 */
async function* streamViaProxy(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): AsyncGenerator<string, void, unknown> {
    const response = await fetch('/__provider_proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            config,
            messages,
            maxTokens: options?.maxTokens,
            temperature: options?.temperature,
            jsonMode: options?.jsonMode,
            stream: true,
        }),
        signal: withStreamTimeoutSignal(options?.signal),
    });
    if (!response.ok || !response.body) {
        const result = await response.json().catch(() => null);
        const message = result?.message || `Provider stream failed (${response.status}).`;
        const error = new Error(message);
        if (result?.status !== undefined) (error as any).status = result.status;
        throw error;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let droppedEvents = 0;
    const gate = createThinkingStreamGate();
    const forwardDelta = (delta: Record<string, unknown>): string => {
        const reasoning = deltaReasoning(delta);
        if (reasoning.trim()) options?.onReasoning?.(reasoning);
        const gated = gate.push(deltaVisibleText(delta));
        if (gated.thinking.trim()) options?.onReasoning?.(gated.thinking);
        return gated.visible;
    };
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // SSE events are separated by a blank line; each event carries a
            // `data:` payload (possibly `data: [DONE]` at the end).
            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) >= 0) {
                const event = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                const dataLine = event.split('\n').find(line => line.startsWith('data:'));
                if (!dataLine) continue;
                const data = dataLine.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                let chunk: any;
                try {
                    chunk = JSON.parse(data);
                } catch {
                    droppedEvents++;
                    if (droppedEvents === 1) console.warn(`[ProxyStream] Dropping non-JSON SSE events (first seen: ${data.slice(0, 80)})`);
                    continue; // partial / non-JSON event
                }
                // A provider error event is a real failure — surface it instead
                // of silently finishing the stream as if it completed cleanly.
                if (chunk?.error) {
                    const message = chunk.error.message || `Provider stream error (${chunk.error.code ?? 'unknown'})`;
                    const error = new Error(message);
                    // error.code is a STRING (e.g. 'invalid_request_error') —
                    // assign a numeric status (or 0) so numeric status checks
                    // downstream never see a string.
                    if (chunk.error.code !== undefined) (error as any).status = parseInt(chunk.error.code, 10) || 0;
                    if (chunk.error.status !== undefined) (error as any).status = chunk.error.status;
                    throw error;
                }
                reportUsage(config, chunk, options);
                const visible = forwardDelta(chunk?.choices?.[0]?.delta || {});
                if (visible) yield visible;
            }
        }
        // Flush any trailing buffer (final event without a blank line).
        if (buffer.trim()) {
            const dataLine = buffer.split('\n').find(line => line.startsWith('data:'));
            if (dataLine) {
                const data = dataLine.slice(5).trim();
                if (data && data !== '[DONE]') {
                    let chunk: any;
                    try {
                        chunk = JSON.parse(data);
                    } catch { /* trailing partial event — ignore */ }
                    if (chunk?.error) {
                        // Provider error in the final event must propagate, not
                        // be silently swallowed like a partial event would be.
                        const error = new Error(chunk.error.message || `Provider stream error (${chunk.error.code ?? 'unknown'})`);
                        if (chunk.error.code !== undefined) (error as any).status = parseInt(chunk.error.code, 10) || 0;
                        if (chunk.error.status !== undefined) (error as any).status = chunk.error.status;
                        throw error;
                    }
                    if (chunk) {
                        const visible = forwardDelta(chunk?.choices?.[0]?.delta || {});
                        if (visible) yield visible;
                    }
                }
            }
        }
        const flushed = gate.flush();
        if (flushed.thinking.trim()) options?.onReasoning?.(flushed.thinking);
        if (flushed.visible) yield flushed.visible;
    } finally {
        reader.releaseLock();
    }
}

/**
 * Quick single-turn response from a provider.
 */
export async function getQuickResponse(
    config: ProviderConfig,
    prompt: string,
    historyOrSystem?: string | any[],
    options?: ChatRequestOptions
): Promise<string> {
    const chatMessages: ChatMessage[] = [];

    if (Array.isArray(historyOrSystem)) {
        historyOrSystem.forEach(msg => {
            if (msg && typeof msg === 'object') {
                if ('role' in msg && 'text' in msg) {
                    const r = msg.role;
                    const role = r === 'user' || r === 'USER'
                        ? 'user'
                        : r === 'system' || r === 'SYSTEM'
                            ? 'system'
                            : 'assistant';
                    chatMessages.push({
                        role,
                        content: msg.text || ''
                    });
                } else if ('role' in msg && 'content' in msg) {
                    chatMessages.push(msg as ChatMessage);
                }
            }
        });
    } else if (typeof historyOrSystem === 'string' && historyOrSystem.trim()) {
        chatMessages.push({ role: 'system', content: historyOrSystem });
    }

    if (!chatMessages.some(m => m.content === prompt)) {
        chatMessages.push({ role: 'user', content: prompt });
    }

    return sendChatRequest(config, chatMessages, { maxTokens: 2048, ...options });
}

/**
 * Test a provider connection with a minimal request.
 */
export async function testConnection(config: ProviderConfig): Promise<{ success: boolean; message: string }> {
    const model = config.selectedModel?.trim();
    if (!model) {
        return { success: false, message: 'Choose a model before testing the connection.' };
    }

    try {
        const testConfig = {
            ...config,
            apiKey: config.apiKey?.trim() || 'not-needed',
            selectedModel: model,
        };
        const result = await sendChatRequest(
            testConfig,
            [{ role: 'user', content: 'Reply with exactly: OK' }],
            { maxTokens: 64, temperature: 0, signal: AbortSignal.timeout(30_000) }
        );
        // Verify the response actually contains the expected token — a 200
        // with empty/error content used to report "Connected successfully",
        // and max_tokens 10 truncated reasoning models into false failures.
        if (!/OK/i.test(result || '')) {
            return { success: false, message: `${config.name} · ${model} responded without the expected 'OK'.` };
        }
        return { success: true, message: `${config.name} · ${model} replied OK` };
    } catch (error: any) {
        return { success: false, message: error.message || 'Connection failed' };
    }
}
