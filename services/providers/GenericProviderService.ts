/**
 * GenericProviderService — Universal AI provider client supporting 3 API formats.
 *
 * Formats:
 * - chat_completions: OpenAI-compatible /chat/completions (most providers)
 * - messages: Anthropic-style /v1/messages
 * - responses: OpenAI Responses API /responses
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
interface ElectronProviderBridge {
    isElectron?: boolean;
    providerChat?: (request: {
        config: ProviderConfig;
        messages: ChatMessage[];
        requestId?: string;
        maxTokens?: number;
        temperature?: number;
        jsonMode?: boolean;
    }) => Promise<{ ok: boolean; text?: string; reasoning?: string; status?: number; code?: string; message?: string }>;
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
    content: string | ContentPart[];
}

export interface ChatRequestOptions {
    maxTokens?: number;
    temperature?: number;
    /** Request JSON object output (chat_completions only uses response_format). */
    jsonMode?: boolean;
    /** Abort signal for cancellation. */
    signal?: AbortSignal;
    onReasoning?: (reasoning: string) => void;
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
        return value.filter((part): part is string => typeof part === 'string').join('\n');
    }
    return '';
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
 * the gate is model-id based rather than opt-in.
 */
const EXTENDED_THINKING_MODEL_RE = /claude-(?:3-7|sonnet-4|opus-4|haiku-4-5)/i;

/** Chain-of-thought budget as a fraction of max_tokens (always kept below it). */
const THINKING_BUDGET_FRACTION = 0.35;

/**
 * Whether to request extended thinking on an Anthropic messages call.
 * Gated on: a thinking-capable Claude model id, a non-trivial token budget
 * (connection tests use maxTokens 10 — no thinking needed, and Anthropic
 * requires 1024 <= budget_tokens < max_tokens), and no JSON mode
 * (structured output and extended thinking are mutually exclusive).
 */
export function shouldRequestExtendedThinking(config: ProviderConfig, options?: ChatRequestOptions): boolean {
    if (config.apiFormat !== 'messages') return false;
    if (options?.jsonMode) return false;
    const maxTokens = options?.maxTokens ?? 4096;
    if (maxTokens < 4096) return false;
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

async function chatCompletionsCall(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): Promise<string> {
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
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
        // Timeout wrap happens here (not at the call site) so the jsonMode
        // retry below gets a FRESH budget — AbortSignal.any keeps the old
        // timer, so wrapping at the call site made the retry inherit a
        // partially-consumed timeout. Always applied (even with no caller
        // signal) so a wedged gateway can never hang the pipeline.
        response = await client.chat.completions.create(params, { signal: withTimeoutSignal(options?.signal) });
    } catch (error: any) {
        // A number of OpenAI-compatible gateways reject response_format even
        // though they support the chat-completions endpoint. Retry once
        // without that optional parameter; the prompt still requires JSON.
        if (options?.jsonMode && (error?.status === 400 || error?.status === 422)) {
            const fallbackParams = { ...params } as Record<string, unknown>;
            delete fallbackParams.response_format;
            response = await client.chat.completions.create(fallbackParams as any, { signal: withTimeoutSignal(options?.signal) });
        } else {
            throw error;
        }
    }
    const message = response.choices[0]?.message as any;
    const reasoning = extractReasoning(message?.reasoning_content) || extractReasoning(message?.reasoning);
    const content = Array.isArray(message?.content)
        ? message.content.filter((part: any) => typeof part?.text === 'string').map((part: any) => part.text).join('\n')
        : message?.content;
    if (!content && !reasoning && options?.jsonMode) {
        // Some gateways return 200 with an empty message when response_format
        // is present. Retry once without the optional JSON enforcement (fresh
        // timeout is applied internally on the next attempt).
        return chatCompletionsCall(config, messages, { ...options, jsonMode: false });
    }
    // Reasoning is forwarded as a separate channel only when the answer text
    // exists — otherwise the reasoning IS the answer and returning it both via
    // onReasoning and as content would make callers accumulate it twice.
    if (reasoning.trim() && content) {
        options?.onReasoning?.(reasoning.trim());
    }
    // Some reasoning-capable gateways place the generated answer in
    // reasoning_content when the final content field is omitted. Preserve it
    // so the caller can still extract a structured answer instead of seeing
    // a misleading empty-response error.
    return content || reasoning || '';
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
    };
    if (options?.jsonMode) {
        (params as any).response_format = { type: 'json_object' };
    }
    const stream = await client.chat.completions.create(params, { signal: withStreamTimeoutSignal(options?.signal) });
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta as any;
        const reasoning = extractReasoning(delta?.reasoning_content) || extractReasoning(delta?.reasoning);
        if (reasoning.trim()) options?.onReasoning?.(reasoning);
        yield chunk.choices[0]?.delta?.content || '';
    }
}

// ─── Messages Format (Anthropic-style) ──────────────────────────────────────

/** Convert a ChatMessage's content to Anthropic message content blocks. */
export function toAnthropicContent(content: string | ContentPart[]): any[] {
    if (typeof content === 'string') {
        return [{ type: 'text', text: content }];
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
            budget_tokens: Math.max(1024, Math.floor((options?.maxTokens ?? 4096) * THINKING_BUDGET_FRACTION)),
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
        content: typeof m.content === 'string'
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
                    }).then(result => {
                        if (!result.ok) {
                            const error = new Error(result.message || 'Provider request failed.');
                            if (result.status !== undefined) (error as any).status = result.status;
                            if (result.code !== undefined) (error as any).code = result.code;
                            throw error;
                        }
                        if (result.reasoning) options?.onReasoning?.(result.reasoning);
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
                            } else {
                                reasoning = extractReasoning(data.choices?.[0]?.message?.reasoning_content) || extractReasoning(data.choices?.[0]?.message?.reasoning);
                            }
                        }
                        let text: string;
                        if (effectiveConfig.apiFormat === 'messages') {
                            text = Array.isArray(data.content) ? data.content.filter((block: any) => block?.type === 'text').map((block: any) => block.text).join('\n') : data.text || '';
                        } else if (effectiveConfig.apiFormat === 'responses') {
                            text = data.output_text || '';
                        } else {
                            const message = data.choices?.[0]?.message || {};
                            const content = Array.isArray(message.content)
                                ? message.content.filter((part: any) => typeof part?.text === 'string').map((part: any) => part.text).join('\n')
                                : message.content;
                            text = content || '';
                        }
                        // Reasoning goes out on its own channel only when the
                        // answer text exists; otherwise it IS the answer and
                        // must not be double-reported as content too.
                        if (reasoning.trim() && text) options?.onReasoning?.(reasoning.trim());
                        return text || reasoning || '';
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
                const delta = chunk?.choices?.[0]?.delta || {};
                const reasoning = extractReasoning(delta.reasoning_content) || extractReasoning(delta.reasoning);
                if (reasoning.trim()) options?.onReasoning?.(reasoning);
                const content = delta.content;
                if (typeof content === 'string' && content) yield content;
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
                        const delta = chunk?.choices?.[0]?.delta || {};
                        const reasoning = extractReasoning(delta.reasoning_content) || extractReasoning(delta.reasoning);
                        if (reasoning.trim()) options?.onReasoning?.(reasoning);
                        if (typeof delta.content === 'string' && delta.content) yield delta.content;
                    }
                }
            }
        }
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
            return { success: false, message: `${config.name} responded without the expected 'OK' — check the base URL and model id.` };
        }
        return { success: true, message: `Connected to ${config.name} successfully` };
    } catch (error: any) {
        return { success: false, message: error.message || 'Connection failed' };
    }
}
