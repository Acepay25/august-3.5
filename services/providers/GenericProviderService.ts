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
import {
    anthropicShouldSendThinking,
    anthropicThinkingFields,
    claudeThinkingBudgetTokens,
    geminiThinkingParams,
    MIN_EFFECTIVE_THINKING_TOKENS,
    requestReasoningSideChannel,
} from '../../shared/providerRequestPolicy.cjs';

import { recordProviderSuccess, recordProviderError } from '../infrastructure/ProviderHealthService';
import { applyReasoningToChatParams, buildReasoningPatch, detectWireCapabilities } from './reasoningControls';
// Side-effect import: harnessLessons registers the wire-route pin checker
// into reasoningControls at module init (harness-lesson read path). Importing here (the
// transport) guarantees the registration happens before any reasoning patch
// is built — harnessLessons imports buildReasoningPatch from
// reasoningControls, so the checker flows in through this module instead of
// a static cycle.
import '../learning/harnessLessons';
import { extractFinishReason, FinishReason, normalizeFinishReason, recordFinishReason, truncatesOutput } from '../../utils/finishReason';
import { emitTokenUsage, extractTokenUsage, TokenUsage } from '../../utils/tokenUsage';
import { observePromptRatio } from '../../utils/tokenEstimate';
import type { ElectronUpdateStatus } from '../../types/electron';
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
        /** Composer effort tier — the out-of-process transports (Electron
         *  bridge + dev proxy) gate/scale the Claude thinking block from this
         *  via shared/providerRequestPolicy.cjs. Without it the proxies could
         *  only ever use the fixed historical budget and ignored 'off'. */
        reasoningEffort?: NonNullable<ChatRequestOptions['reasoningEffort']>;
        /** Pre-resolved (capability-checked) constrained-decoding schema for
         *  chat_completions; undefined = never send json_schema. */
        jsonSchema?: ChatRequestOptions['jsonSchema'];
        tools?: ChatRequestOptions['tools'];
        toolChoice?: ChatRequestOptions['toolChoice'];
        /** Effort-derived wire fields (reasoningControls) — merged into the
         *  request body main-process-side, mirroring the vite proxy's
         *  reasoningPatch. Without it desktop ran thinking-default gateways
         *  at their provider default regardless of the composer tier. */
        reasoningPatch?: Record<string, unknown>;
        /** Opt into live SSE: main parses the response stream and pushes
         *  deltas over `provider:chunk` while the invoke promise still
         *  resolves with the accumulated final result. */
        stream?: boolean;
    }) => Promise<{ ok: boolean; text?: string; reasoning?: string; usage?: TokenUsage; toolCalls?: ChatTurnResult['toolCalls']; assistantMessage?: ChatMessage; /** Raw provider stop signal (finish_reason / stop_reason / status / finishReason), normalized renderer-side. */ finishReason?: string; status?: number; code?: string; message?: string }>;
    /** Subscribe to streamed deltas of a stream:true providerChat call. */
    onProviderChunk?: (callback: (chunk: { requestId: string; type: 'text' | 'reasoning'; delta: string }) => void) => (() => void) | void;
    cancelProviderChat?: (requestId: string) => Promise<boolean>;
    discoverModels?: (config: {
        baseUrl: string;
        apiKey: string;
        apiFormat: ProviderConfig['apiFormat'];
    }) => Promise<{ ok: boolean; status?: number; body?: string; message?: string }>;
    // ── App / auto-update / secret-encryption surface (preload.cjs). Declared
    // here so the ambient Window.electronAPI is complete: consumers (the update
    // hook, ProviderConfigService) read `window.electronAPI.*` typed instead of
    // re-casting to `(window as any)`. ──
    platform?: string;
    getVersion?: () => Promise<string>;
    checkForUpdates?: () => Promise<ElectronUpdateStatus | null>;
    downloadUpdate?: () => Promise<ElectronUpdateStatus | null>;
    installUpdate?: () => Promise<ElectronUpdateStatus | null>;
    getUpdateStatus?: () => Promise<ElectronUpdateStatus | null>;
    /** Fired by the restart-animation overlay once it has played. */
    quitNow?: () => void;
    /** Subscribe to pushed status; returns an unsubscribe (or void). */
    onUpdateStatus?: (callback: (status: ElectronUpdateStatus) => void) => (() => void) | void;
    /** safeStorage (OS keychain) encrypt/decrypt for API keys at rest. */
    encryptSecret?: (plaintext: string) => Promise<string | null>;
    decryptSecret?: (payload: string) => Promise<string | null>;
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
    /** Why the model stopped, normalized across all four wire formats. Fires
     *  once per completed call. 'length' means the answer was cut off, which a
     *  caller parsing the tail of the text has to know. */
    onFinishReason?: (reason: FinishReason) => void;
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
    /** chat_completions streaming: when the model answers with native tool
     *  calls, the SSE deltas are accumulated and delivered here ONCE at end
     *  of stream (complete name + parsed JSON arguments). Text deltas still
     *  yield normally — the desk-tool loop uses this to stream AND loop. */
    onStreamToolCalls?: (calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>) => void;
    /** Constrained decoding (chat_completions, capability-gated): sends
     *  response_format json_schema with the given object-root JSON Schema
     *  instead of plain json_object. Non-strict — the zod boundary stays
     *  the validator; a rejected format degrades (json_object → none), it
     *  never blocks the call. Ignored by the other wire formats. */
    jsonSchema?: { name?: string; schema: Record<string, unknown> };
}

export interface ChatTurnResult {
    text: string;
    reasoning: string;
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    /** Raw assistant message for appending into a tool loop (chat_completions). */
    assistantMessage?: ChatMessage;
    /** Why the model stopped, normalized across wire formats. 'unknown' means
     *  the gateway sent no signal — NOT that it stopped cleanly. */
    finishReason: FinishReason;
    /** The answer was cut off at the token ceiling. Consumers must not treat a
     *  truncated body as complete: the verdict parser and the CONVICTION probe
     *  both read the tail of the text. */
    truncated: boolean;
}

/** Report the normalized stop signal: the run-level tally, plus the inline
 *  callback for a caller that needs the value now. There is deliberately no
 *  global listener bus here — the tally and the callback are the two readers,
 *  and a third (a subscriber list nothing ever subscribed to) is how this file
 *  grew write-only code once before. */
function reportFinishReason(config: ProviderConfig, reason: FinishReason, options?: ChatRequestOptions): void {
    recordFinishReason(reason);
    options?.onFinishReason?.(reason);
}

/** Extract, report and return the stop signal from any response body shape. */
function observeFinishReason(
    config: ProviderConfig,
    data: unknown,
    options?: ChatRequestOptions,
): { finishReason: FinishReason; truncated: boolean } {
    const reason = extractFinishReason(data) ?? 'unknown';
    reportFinishReason(config, reason, options);
    return { finishReason: reason, truncated: truncatesOutput(reason) };
}

/** Text volume actually sent, so a measured usage frame can be turned into a
 *  chars-per-token ratio. Reasoning payloads and image parts are included
 *  because they occupy the same window the budget is drawn from. */
function messageTextLength(messages: ChatMessage[]): number {
    let chars = 0;
    for (const m of messages) {
        if (typeof m.content === 'string') chars += m.content.length;
        else if (Array.isArray(m.content)) {
            // Narrow on the discriminator rather than reading both branches:
            // an image part costs roughly a few hundred tokens of vision
            // embedding, which 1500 chars over-estimates on purpose.
            for (const part of m.content) chars += part.type === 'text' ? part.text.length : 1500;
        }
        chars += (m as { tool_calls?: unknown }).tool_calls ? 200 : 0;
    }
    return chars;
}

function reportUsage(
    config: ProviderConfig,
    data: unknown,
    options?: ChatRequestOptions,
    messages?: ChatMessage[],
): void {
    const usage = extractTokenUsage(data);
    if (!usage) return;
    options?.onUsage?.(usage);
    emitTokenUsage({ providerId: config.id, modelId: config.selectedModel, usage });
    // Calibrate the context-budget estimator against this provider's OWN count.
    // `utils/tokenEstimate` deliberately over-estimates in the absence of data;
    // once a gateway reports real prompt tokens there is no reason to keep
    // guessing, and a mis-guess costs either truncated memory or a 4xx.
    if (messages?.length && usage.promptTokens > 0) {
        observePromptRatio(usage.promptTokens, messageTextLength(messages));
    }
}

function reportUsageDirect(
    config: ProviderConfig,
    usage: TokenUsage | undefined,
    options?: ChatRequestOptions,
    /** Every Electron chat call takes the bridge and lands here, so without
     *  this the context-budget estimator was never calibrated on the shipped
     *  desktop app — only on web, which uses `reportUsage` instead. */
    messages?: ChatMessage[],
): void {
    if (!usage) return;
    // Coerce, don't just pass through. A truthy object with missing or
    // non-numeric fields (an un-normalized snake_case payload from a transport,
    // or any future one) used to reach mergeTokenUsage, where `0 + undefined`
    // produced NaN for the whole run ledger — and `estimateCostUsd(NaN) ?? 0`
    // then made shouldSkipRemaining() always false, silently disabling the
    // per-debate spend cap. Normalized upstream AND refused here, so one bad
    // transport cannot take the cost guard down with it.
    const promptTokens = Number(usage.promptTokens);
    const completionTokens = Number(usage.completionTokens);
    if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return;
    const safe: TokenUsage = {
        promptTokens,
        completionTokens,
        totalTokens: Number.isFinite(Number(usage.totalTokens))
            ? Number(usage.totalTokens)
            : promptTokens + completionTokens,
    };
    options?.onUsage?.(safe);
    emitTokenUsage({ providerId: config.id, modelId: config.selectedModel, usage: safe });
    if (messages?.length && usage.promptTokens > 0) {
        observePromptRatio(usage.promptTokens, messageTextLength(messages));
    }
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

// `requestReasoningSideChannel` now lives in shared/providerRequestPolicy.cjs
// and is imported below. It used to be a private copy HERE, which meant the
// PACKAGED APP never sent the flag: the dock asks electron/main.cjs to build
// the provider request, and main.cjs had no idea this existed. The same seat
// therefore returned its thinking on the web and not on the desktop — the
// Thinking row simply stayed empty, with no error anywhere to explain it. The
// shared policy module is the one file the renderer, the vite proxy and
// electron/main.cjs all import; that is the whole point of it.

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

// ─── Dev-proxy routing ───────────────────────────────────────────────────────

/**
 * The vite DEV SERVER is the only runtime that serves /__provider_proxy
 * (it's registered in configureServer). A packaged Capacitor WebView ALSO
 * reports hostname 'localhost' — routing its provider calls to that path
 * POSTed at a non-existent middleware and every call 404'd. Only dev may
 * take the proxy; packaged mobile/web fall through to the direct-call
 * branches. Deliberately NOT a full mirror of ProviderConfigService.fetchProviderCatalog's
 * guard: that one ALSO excludes VITEST, while this one keeps the proxy branch
 * live under tests on purpose — the transport suites (devProxyRouting,
 * providerPayloads, desktopProviderParity) mock fetch and must be able to
 * reach this branch in jsdom, whereas a catalog fetch under vitest has no
 * dev server to talk to at all and must not be attempted.
 */
export function usesDevProviderProxy(): boolean {
    return Boolean(import.meta.env.DEV)
        && typeof window !== 'undefined'
        && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
}

// ─── Extended Thinking (request side) ───────────────────────────────────────

/**
 * ALL extended-thinking / budget / temperature rules live in
 * shared/providerRequestPolicy.cjs — the single source consumed identically
 * by this renderer transport, the vite dev proxy, and electron/main.cjs.
 * (Before that module these rules were hand-copied three times and had
 * verifiably drifted: stale model-id regex, fixed 0.35 budget, missing
 * temperature on the proxies. The wrappers below stay exported because the
 * wire tests import them.
 */

/** Anthropic budget_tokens for a call: effort-scaled, clamped to
 *  1024 <= budget < max_tokens. Exported for wire tests. */
export function thinkingBudgetTokens(maxTokens: number, effort?: string): number {
    return claudeThinkingBudgetTokens(maxTokens, effort);
}

/**
 * Whether to request extended thinking on an Anthropic messages call
 * (delegates the whole gate — JSON-mode exclusion, the composer's 'off'
 * tier, the 1024-token floor, and the model-id list/`thinkingCapable`
 * override — to the shared policy module).
 */
export function shouldRequestExtendedThinking(config: ProviderConfig, options?: ChatRequestOptions): boolean {
    if (config.apiFormat !== 'messages') return false;
    return anthropicShouldSendThinking({
        modelId: config.selectedModel || '',
        displayName: config.name,
        capabilityOverride: config.thinkingCapable,
        maxTokens: options?.maxTokens,
        jsonMode: options?.jsonMode,
        reasoningEffort: options?.reasoningEffort,
    });
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
 * maxRetries: 0 — the SDK's own retry loop (default 2) multiplied with
 * withRetry(fn, 3) here, sending up to 9 requests to a rate-limited gateway
 * per logical call. Retry/backoff is this module's job; the SDK must make
 * exactly one attempt per call.
 */
function createOpenAIClient(config: ProviderConfig): OpenAI {
    return new OpenAI({
        apiKey: config.apiKey?.trim() || 'not-needed',
        baseURL: normalizeBaseUrl(config.baseUrl, config.apiFormat),
        dangerouslyAllowBrowser: true,
        maxRetries: 0,
    });
}

/** response_format for chat_completions: constrained json_schema when the
 *  jsonSchema capability class allows it and the caller supplied a schema,
 *  else plain json_object when requested, else none. Rejections are handled
 *  by the degrade chain in chatCompletionsTurn / chatCompletionsStream. */
const buildJsonResponseFormat = (
    config: ProviderConfig,
    options?: ChatRequestOptions,
): Record<string, unknown> | undefined => {
    if (options?.jsonSchema?.schema && detectWireCapabilities(config).jsonSchema) {
        return {
            type: 'json_schema',
            json_schema: {
                name: options.jsonSchema.name || 'august_json',
                // Non-strict on purpose: optional fields stay optional and
                // the zod schema at the analysis boundary remains the real
                // validator. Strict mode would require all-keys rewrites.
                strict: false,
                schema: options.jsonSchema.schema,
            },
        };
    }
    if (options?.jsonMode) return { type: 'json_object' };
    return undefined;
};

/** Capability decision for the OUT-of-process transports (Electron bridge +
 *  dev proxy, which build the body themselves): resolve the jsonSchema class
 *  here so those transports only ever see a schema the config supports. */
const resolveWireJsonSchema = (
    config: ProviderConfig,
    options?: ChatRequestOptions,
): ChatRequestOptions['jsonSchema'] =>
    options?.jsonSchema?.schema && detectWireCapabilities(config).jsonSchema ? options.jsonSchema : undefined;

/** First degrade step under a 400/422: json_schema falls back to
 *  json_object (when it was also requested), anything else is removed. */
const degradeResponseFormatOnce = (params: Record<string, unknown>, jsonMode?: boolean): void => {
    const rf = params.response_format as { type?: string } | undefined;
    if (rf?.type === 'json_schema' && jsonMode) params.response_format = { type: 'json_object' };
    else delete params.response_format;
};

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
    const rf = buildJsonResponseFormat(config, options);
    if (rf) (params as any).response_format = rf;
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
        if ((options?.jsonMode || options?.jsonSchema) && (error?.status === 400 || error?.status === 422)) {
            // Degrade chain: json_schema → json_object → no response_format.
            // A gateway that rejects the constrained format must still
            // answer — the pipeline never blocks on an optional hardening.
            const fallbackParams = { ...params } as Record<string, unknown>;
            degradeResponseFormatOnce(fallbackParams, options?.jsonMode);
            try {
                response = await client.chat.completions.create(fallbackParams as any, { signal: withTimeoutSignal(options?.signal) });
            } catch (second: any) {
                if ((second?.status === 400 || second?.status === 422) && fallbackParams.response_format) {
                    delete fallbackParams.response_format;
                    response = await client.chat.completions.create(fallbackParams as any, { signal: withTimeoutSignal(options?.signal) });
                } else {
                    throw second;
                }
            }
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
        return chatCompletionsTurn(config, messages, { ...options, jsonMode: false, jsonSchema: undefined });
    }
    if (reasoning.trim()) options?.onReasoning?.(reasoning.trim());
    reportUsage(config, response, options, messages);
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
    const finish = observeFinishReason(config, response, options);
    return {
        text: typeof content === 'string' ? content : '',
        reasoning: reasoning.trim(),
        toolCalls,
        assistantMessage,
        ...finish,
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
    const streamRf = buildJsonResponseFormat(config, options);
    if (streamRf) (params as any).response_format = streamRf;
    if (options?.tools?.length) {
        (params as any).tools = options.tools;
        (params as any).tool_choice = options.toolChoice ?? 'auto';
    }
    requestReasoningSideChannel(config, params);
    applyReasoningToChatParams(config, params as unknown as Record<string, unknown>, options);
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
        stream = await client.chat.completions.create(params, { signal: withStreamTimeoutSignal(options?.signal) });
    } catch (error: any) {
        // Same degrade chain as the non-streaming turn — previously the
        // stream path had NO json fallback, so a gateway that rejected
        // response_format failed the whole stream at creation time.
        if ((options?.jsonMode || options?.jsonSchema) && (error?.status === 400 || error?.status === 422)) {
            const fallbackParams = { ...params } as Record<string, unknown>;
            degradeResponseFormatOnce(fallbackParams, options?.jsonMode);
            stream = await client.chat.completions.create(fallbackParams as any, { signal: withStreamTimeoutSignal(options?.signal) }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
        } else {
            throw error;
        }
    }
    const gate = createThinkingStreamGate();
    const toolBuf = new StreamToolCallBuffer();
    // Chunks carry finish_reason only on the last one, and a stream that dies
    // mid-flight never yields one — so 'unknown' here genuinely means "no
    // signal", not "stopped cleanly".
    let streamFinish: FinishReason | undefined;
    for await (const chunk of stream) {
        reportUsage(config, chunk, options, messages);
        const chunkReason = normalizeFinishReason(chunk.choices?.[0]?.finish_reason);
        if (chunk.choices?.[0]?.finish_reason) streamFinish = chunkReason;
        const delta = chunk.choices[0]?.delta as any;
        toolBuf.push(delta);
        const reasoning = deltaReasoning(delta);
        if (reasoning.trim()) options?.onReasoning?.(reasoning);
        const gated = gate.push(deltaVisibleText(delta));
        if (gated.thinking.trim()) options?.onReasoning?.(gated.thinking);
        if (gated.visible) yield gated.visible;
    }
    const flushed = gate.flush();
    if (flushed.thinking.trim()) options?.onReasoning?.(flushed.thinking);
    if (flushed.visible) yield flushed.visible;
    toolBuf.finish(options);
    reportFinishReason(config, streamFinish ?? 'unknown', options);
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
    // Temperature + extended thinking come from the shared policy module (all
    // three transports): explicit value or 0.7 default — Anthropic's own API
    // default is 1.0, so omitting temperature sampled the same task at a
    // different value per provider format and polluted calibration data —
    // and when thinking is active the block replaces temperature (Anthropic
    // requires it unset alongside `thinking`).
    const thinkingFields = anthropicThinkingFields({
        modelId: config.selectedModel || '',
        displayName: config.name,
        capabilityOverride: config.thinkingCapable,
        maxTokens: maxTokensForBody,
        temperature: options?.temperature,
        jsonMode: options?.jsonMode,
        reasoningEffort: options?.reasoningEffort,
    });
    if (typeof thinkingFields.temperature === 'number') body.temperature = thinkingFields.temperature;
    if (thinkingFields.thinking) body.thinking = thinkingFields.thinking;
    // Wire audit: the messages transport previously emitted
    // NO audit line, so Claude seats — the format whose thinking gate P3
    // fixed — were invisible in the run log. Report the shim's actual
    // decision: applied (thinking block sent), or why it wasn't.
    {
        const effort = options?.reasoningEffort ?? 'auto';
        const thinkingSent = !!body.thinking;
        options?.onWireAudit?.({
            route: thinkingSent ? 'anthropic-thinking' : 'none',
            effort,
            applied: thinkingSent,
            reason: thinkingSent
                ? `thinking budget_tokens=${(body.thinking as { budget_tokens: number }).budget_tokens} (effort ${effort})`
                : `no thinking block: ${options?.jsonMode ? 'jsonMode excludes thinking'
                    : (options?.maxTokens ?? 4096) <= MIN_EFFECTIVE_THINKING_TOKENS ? 'maxTokens below the 1024 thinking floor'
                        : config.thinkingCapable === false ? 'thinkingCapable override = off'
                            : 'model id not recognized as thinking-capable (set the override in Settings)'}`,
        });
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
    reportUsage(config, data, options, messages);
    // Anthropic reports the ceiling as stop_reason:'max_tokens' on a 200 with
    // a well-formed body, so nothing downstream could tell it from an answer.
    observeFinishReason(config, data, options);
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
    reportUsage(config, data, options, messages);
    // Responses reports a cut-off answer as status:'incomplete' — a success
    // shaped response that previously parsed as if it were finished.
    observeFinishReason(config, data, options);
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
    const geminiThinking = geminiThinkingParams(
        options?.jsonMode,
        config.selectedModel,
        options?.reasoningEffort,
        options?.maxTokens,
    );
    // The audit must say what the wire received. Effort now scales
    // thinkingBudget, so reporting route:'none'/applied:false on a call that
    // is sending a thinkingConfig poisons everything built on the run log —
    // pinning, calibration and the known-answer probes all read this.
    options?.onWireAudit?.(geminiThinking
        ? {
            route: 'gemini-thinking',
            effort: options?.reasoningEffort ?? 'auto',
            applied: true,
            reason: `thinkingConfig.thinkingBudget=${geminiThinking.thinkingBudget}`,
        }
        : {
            route: 'none',
            effort: options?.reasoningEffort ?? 'auto',
            applied: false,
            reason: options?.jsonMode
                ? 'google generateContent: JSON mode sends no thinkingConfig'
                : (options?.reasoningEffort === 'off'
                    ? 'google generateContent: effort=off suppresses thinkingConfig'
                    : 'google generateContent: no thinkingConfig for this model'),
        });
    const body = chatMessagesToGemini(messages, {
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
        jsonMode: options?.jsonMode,
        model: config.selectedModel,
        reasoningEffort: options?.reasoningEffort,
    });
    // Canonical thinking decision from the shared policy module (the codec's
    // inline copy is behaviorally identical; applying the policy here means
    // every transport's Gemini thinkingConfig provably comes from one source).
    if (geminiThinking) body.generationConfig.thinkingConfig = geminiThinking;
    else delete body.generationConfig.thinkingConfig;
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
    reportUsage(config, data, options, messages);
    // Gemini reports MAX_TOKENS per candidate, so a truncated answer still has
    // a valid candidates[0].content — indistinguishable without this.
    observeFinishReason(config, data, options);
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
                        reasoningEffort: options?.reasoningEffort,
                        jsonMode: options?.jsonMode,
                        jsonSchema: resolveWireJsonSchema(effectiveConfig, options),
                        tools: options?.tools,
                        toolChoice: options?.toolChoice,
                        reasoningPatch: reasoningPatchFor(effectiveConfig, options),
                    }).then(result => {
                        if (!result.ok) {
                            const error = new Error(result.message || 'Provider request failed.');
                            if (result.status !== undefined) (error as any).status = result.status;
                            if (result.code !== undefined) (error as any).code = result.code;
                            throw error;
                        }
                        if (result.reasoning) options?.onReasoning?.(result.reasoning);
                        reportUsageDirect(effectiveConfig, result.usage, options, messages);
                        reportFinishReason(
                            effectiveConfig,
                            normalizeFinishReason(result.finishReason),
                            options,
                        );
                        return result.text || '';
                    }).finally(() => {
                        window.clearTimeout(timeout);
                        options?.signal?.removeEventListener('abort', cancelRequest);
                    });
                }
                if (usesDevProviderProxy()) {
                    return fetch('/__provider_proxy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        config: effectiveConfig,
                        messages,
                        maxTokens: options?.maxTokens,
                        temperature: options?.temperature,
                        reasoningEffort: options?.reasoningEffort,
                        jsonMode: options?.jsonMode,
                        jsonSchema: resolveWireJsonSchema(effectiveConfig, options),
                        tools: options?.tools,
                        toolChoice: options?.toolChoice,
                        reasoningPatch: reasoningPatchFor(effectiveConfig, options),
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
                        reportUsage(effectiveConfig, data, options, messages);
                        // The proxy hands back the raw provider body, so the
                        // same four-shape extractor covers every format here.
                        observeFinishReason(effectiveConfig, data, options);
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
                            reasoningEffort: options?.reasoningEffort,
                            jsonMode: options?.jsonMode,
                            jsonSchema: resolveWireJsonSchema(effectiveConfig, options),
                            tools: options?.tools,
                            toolChoice: options?.toolChoice,
                            reasoningPatch: reasoningPatchFor(effectiveConfig, options),
                        });
                        if (!bridge.ok) {
                            const error = new Error(bridge.message || 'Provider request failed.');
                            if (bridge.status !== undefined) (error as any).status = bridge.status;
                            if (bridge.code !== undefined) (error as any).code = bridge.code;
                            throw error;
                        }
                        if (bridge.reasoning) options?.onReasoning?.(bridge.reasoning);
                        reportUsageDirect(effectiveConfig, bridge.usage, options, messages);
                        // The bridge already flattened the provider body, so
                        // this is a raw stop token rather than a response shape
                        // — normalize directly instead of re-extracting.
                        const bridgeFinish = normalizeFinishReason(bridge.finishReason);
                        reportFinishReason(effectiveConfig, bridgeFinish, options);
                        return {
                            text: bridge.text || '',
                            reasoning: bridge.reasoning || '',
                            toolCalls: bridge.toolCalls || [],
                            finishReason: bridgeFinish,
                            truncated: truncatesOutput(bridgeFinish),
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
                if (usesDevProviderProxy()) {
                    const response = await fetch('/__provider_proxy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            config: effectiveConfig,
                            messages,
                            maxTokens: options?.maxTokens,
                            temperature: options?.temperature,
                            reasoningEffort: options?.reasoningEffort,
                            jsonMode: options?.jsonMode,
                            jsonSchema: resolveWireJsonSchema(effectiveConfig, options),
                            tools: options?.tools,
                            toolChoice: options?.toolChoice,
                            reasoningPatch: reasoningPatchFor(effectiveConfig, options),
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
                        reportUsage(effectiveConfig, data, options, messages);
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
                            ...observeFinishReason(effectiveConfig, data, options),
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
                    reportUsage(effectiveConfig, data, options, messages);
                    return {
                        text: text || '',
                        reasoning: reasoning.trim(),
                        toolCalls: [],
                        ...observeFinishReason(effectiveConfig, data, options),
                        assistantMessage: { role: 'assistant', content: text || '' },
                    } satisfies ChatTurnResult;
                }
                if (effectiveConfig.apiFormat === 'chat_completions') {
                    return chatCompletionsTurn(effectiveConfig, messages, options);
                }
                // Other formats: reuse string path; text-protocol tools still work.
                // The string transports report the stop signal themselves, so
                // capture it on the way through rather than re-parsing a body
                // this layer never sees.
                let passthroughFinish: FinishReason = 'unknown';
                const captured: ChatRequestOptions = {
                    ...options,
                    onFinishReason: (reason) => {
                        passthroughFinish = reason;
                        options?.onFinishReason?.(reason);
                    },
                };
                const text = effectiveConfig.apiFormat === 'messages'
                    ? await messagesCall(effectiveConfig, messages, { ...captured, signal: withTimeoutSignal(options?.signal) })
                    : effectiveConfig.apiFormat === 'responses'
                        ? await responsesCall(effectiveConfig, messages, { ...captured, signal: withTimeoutSignal(options?.signal) })
                        : effectiveConfig.apiFormat === 'google'
                            ? await googleCall(effectiveConfig, messages, { ...captured, signal: withTimeoutSignal(options?.signal) })
                            : '';
                return {
                    text,
                    reasoning: '',
                    toolCalls: [],
                    finishReason: passthroughFinish,
                    truncated: truncatesOutput(passthroughFinish),
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
 * Desktop live paint over the Electron bridge. main.cjs parses the provider's
 * SSE stream and pushes deltas on `provider:chunk`; this generator yields
 * text deltas as they land and forwards reasoning deltas to
 * options.onReasoning — so the thinking strip and the AnalyzedRow timer start
 * at the first thought, not the last byte. On invoke resolution it delivers
 * the accumulated native tool calls via options.onStreamToolCalls: the old
 * single-chunk short-circuit dropped them, so native seats silently lost
 * every tool round on desktop.
 *
 * If nothing streamed (provider ignored stream:true — main falls back to the
 * buffered parse and returns the whole text in the final result), the text is
 * yielded once whole; the consumer never sees a blank bubble.
 */
async function* streamViaElectronBridge(
    config: ProviderConfig,
    messages: ChatMessage[],
    options: ChatRequestOptions | undefined,
    electronAPI: NonNullable<Window['electronAPI']>,
): AsyncGenerator<string, void, unknown> {
    const requestId = `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const queue: string[] = [];
    let yielded = '';
    let wake: (() => void) | null = null;
    let settled = false;
    const notify = (): void => { wake?.(); wake = null; };
    // Route think-tag bodies to the reasoning channel, exactly as the other
    // two streaming paths do (`chatCompletionsStream`, `streamViaProxy`). This
    // bridge did not, so on the PACKAGED APP a reasoning model that leaks
    // <think> markup inside `content` painted its scratchpad straight into the
    // visible answer bubble. The settle-time cleanup peeled it back out, which
    // is why it read as a flicker rather than a failure — but the raw markup
    // was on screen, and the Thinking row never started its timer.
    const gate = createThinkingStreamGate();
    const unsubscribe = electronAPI.onProviderChunk?.((chunk) => {
        if (!chunk || chunk.requestId !== requestId) return;
        if (chunk.type === 'reasoning') {
            options?.onReasoning?.(chunk.delta);
            return;
        }
        const gated = gate.push(chunk.delta);
        if (gated.thinking.trim()) options?.onReasoning?.(gated.thinking);
        if (gated.visible) queue.push(gated.visible);
        notify();
    });
    const cancelRequest = (): void => { void electronAPI.cancelProviderChat?.(requestId); };
    options?.signal?.addEventListener('abort', cancelRequest, { once: true });
    if (options?.signal?.aborted) cancelRequest();
    // STREAMING budget (300s), NOT the 120s non-streaming cap: reasoning-heavy
    // desktop answers stream well past 120s and this renderer-side timer used
    // to cancel them mid-stream on the very transport main.cjs gives 300s.
    // (Web streams get the same 300s via withStreamTimeoutSignal.)
    const timeout = window.setTimeout(() => cancelRequest(), STREAM_TIMEOUT_MS);
    const invoke = electronAPI.providerChat!({
        config,
        messages,
        requestId,
        stream: true,
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
        reasoningEffort: options?.reasoningEffort,
        tools: options?.tools,
        toolChoice: options?.toolChoice,
        reasoningPatch: reasoningPatchFor(config, options),
    }).catch((err: unknown): Awaited<ReturnType<NonNullable<typeof electronAPI.providerChat>>> => ({
        ok: false,
        message: err instanceof Error ? err.message : 'Provider bridge call failed.',
    })).finally(() => { settled = true; notify(); });
    try {
        while (true) {
            while (queue.length > 0) {
                const delta = queue.shift() as string;
                yielded += delta;
                yield delta;
            }
            if (settled) break;
            await new Promise<void>(resolve => { wake = resolve; });
        }
        while (queue.length > 0) {
            const delta = queue.shift() as string;
            yielded += delta;
            yield delta;
        }
        const result = await invoke;
        // Flush the gate BEFORE the buffered-tail fallback: if the stream
        // stopped mid-think-block the visible remainder is sitting in the GATE,
        // not the queue, and yielding result.text on top would double-paint.
        // Same order the other two streaming paths use.
        const flushed = gate.flush();
        if (flushed.thinking.trim()) options?.onReasoning?.(flushed.thinking);
        if (flushed.visible) yield flushed.visible;
        if (!result.ok) {
            const error = new Error(result.message || 'Provider request failed.');
            if (result.status !== undefined) (error as { status?: number }).status = result.status;
            if (result.code !== undefined) (error as { code?: string }).code = result.code;
            throw error;
        }
        if (result.toolCalls && result.toolCalls.length > 0) options?.onStreamToolCalls?.(result.toolCalls);
        reportUsageDirect(config, result.usage, options, messages);
        reportFinishReason(config, normalizeFinishReason(result.finishReason), options);
        // Buffered fallback / lost tail: paint whatever the stream missed.
        if (result.text && result.text.length > yielded.length) {
            yield result.text.slice(yielded.length);
        }
    } finally {
        window.clearTimeout(timeout);
        options?.signal?.removeEventListener('abort', cancelRequest);
        if (typeof unsubscribe === 'function') unsubscribe();
    }
}

/**
 * Stream a chat response from any provider as an async generator.
 * Desktop: streams through the Electron bridge (main.cjs parses the SSE for
 * all three wire formats and pushes provider:chunk deltas). Web: currently
 * supports chat_completions (the dominant format) via proxy/SDK streaming;
 * messages/responses formats fall back to non-streaming and yield the full
 * result once. Streaming applies the same hard timeout as non-streaming calls.
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
            // JSON-mode streams take the BUFFERED bridge, not the chunk bridge:
            // streamViaElectronBridge's payload carries no jsonMode/jsonSchema
            // (the chunk protocol cannot express them — main.cjs parses streamed
            // SSE as plain text and its streamRequested() guard only keeps
            // jsonMode calls buffered when it can SEE them). Yielding the full
            // text once via sendChatRequest — which DOES forward jsonMode/
            // jsonSchema — keeps the wire policy intact; a chunk-bridged
            // jsonMode call would silently lose constrained decoding on
            // desktop while web/proxy streams honored it.
            if (electronAPI.onProviderChunk && !options?.jsonMode) {
                yield* streamViaElectronBridge(effectiveConfig, messages, options, electronAPI);
                return;
            }
            // Shell without the chunk channel (old preload), or a jsonMode
            // stream the chunk bridge cannot represent — buffered as before.
            yield await sendChatRequest(effectiveConfig, messages, options);
            return;
        }
        // Dev browser on localhost: route through the CORS-avoiding Vite
        // provider proxy, which passes SSE through. Direct SDK streaming from
        // the browser fails for providers without CORS headers (e.g. opencode).
        if (usesDevProviderProxy()) {
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
/** Accumulates OpenAI streamed tool_call deltas (fragmented across chunks
 *  and keyed by index) into complete calls. Shared by both chat_completions
 *  streaming paths (direct SDK + dev proxy) so the desk-tool loop can stream
 *  text live AND still loop on native tool calls. */
class StreamToolCallBuffer {
    private readonly parts = new Map<number, { id: string; name: string; args: string }>();

    push(delta: unknown): void {
        const frags = (delta as { tool_calls?: unknown })?.tool_calls;
        if (!Array.isArray(frags)) return;
        for (const f of frags as Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>) {
            const idx = Number.isFinite(f?.index) ? Number(f.index) : 0;
            const part = this.parts.get(idx) ?? { id: '', name: '', args: '' };
            if (typeof f?.id === 'string' && f.id) part.id = f.id;
            if (typeof f?.function?.name === 'string') part.name += f.function.name;
            if (typeof f?.function?.arguments === 'string') part.args += f.function.arguments;
            this.parts.set(idx, part);
        }
    }

    /** Deliver complete calls to onStreamToolCalls; returns them (null = none). */
    finish(options?: Pick<ChatRequestOptions, 'onStreamToolCalls'>): Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null {
        if (this.parts.size === 0) return null;
        const calls = [...this.parts.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, p]) => ({
                id: p.id || `call_${Math.random().toString(36).slice(2, 10)}`,
                name: p.name,
                arguments: parseStreamedToolArguments(p.args),
            }))
            .filter(c => c.name.length > 0);
        if (calls.length > 0) options?.onStreamToolCalls?.(calls);
        return calls.length > 0 ? calls : null;
    }
}

/** Tool-call arguments accumulate as a JSON string; a truncated stream must
 *  still reach the executor as an object (marked) rather than throwing. */
const parseStreamedToolArguments = (raw: string): Record<string, unknown> => {
    if (!raw.trim()) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : { value: parsed };
    } catch {
        return { _unparsed: raw };
    }
};

/** Client-side reasoning translation for the proxy routes: the capability
 *  classes live in reasoningControls (renderer side), so the middleware
 *  never imports app services — it just merges this patch into the body.
 *  'auto'/absent effort ⇒ undefined (no key, no body change). */
const reasoningPatchFor = (
    config: ProviderConfig,
    options?: ChatRequestOptions,
): Record<string, unknown> | undefined => {
    const effort = options?.reasoningEffort;
    if (!effort || effort === 'auto') return undefined;
    const { patch } = buildReasoningPatch(config, effort);
    return Object.keys(patch).length > 0 ? patch : undefined;
};

/** Extract an SSE event's payload per the spec: an event may carry MULTIPLE
 *  `data:` lines (legal — some gateways split large JSON frames across them,
 *  losing tool-call/usage events entirely when only the first line is read,
 *  the exact bug this replaces). Collect every data line, strip one optional
 *  leading space per line, and join with '\n' before the caller JSON.parses.
 *  Returns null when the event carries no data lines. */
const sseEventPayload = (event: string): string | null => {
    const dataLines: string[] = [];
    for (const line of event.split('\n')) {
        if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return null;
    const joined = dataLines.join('\n').trim();
    return joined || null;
};

async function* streamViaProxy(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): AsyncGenerator<string, void, unknown> {
    // Retry the OPEN of the stream on transient failures (429 / network /
    // 5xx) with the same backoff the non-streaming path uses — without it,
    // one rate-limit blip killed a bot room turn instantly while casual
    // chat (sendChatRequest → withRetry) recovered silently. Only the
    // request open is retried: once SSE bytes start flowing, a mid-stream
    // failure surfaces as an error instead of replaying the answer.
    const response = await withRetry(async () => {
        const attempt = await fetch('/__provider_proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                config,
                messages,
                maxTokens: options?.maxTokens,
                temperature: options?.temperature,
                reasoningEffort: options?.reasoningEffort,
                jsonMode: options?.jsonMode,
                jsonSchema: resolveWireJsonSchema(config, options),
                // Native tool-calling over SSE — without these the proxy strip
                // silently downgrades every streamed chat to tool-less, so the
                // desk tools never fire in the dev browser.
                tools: options?.tools,
                toolChoice: options?.toolChoice,
                // Reasoning patch is translated CLIENT-side (capability classes
                // live in reasoningControls); the middleware just merges it.
                reasoningPatch: reasoningPatchFor(config, options),
                stream: true,
            }),
            signal: withStreamTimeoutSignal(options?.signal),
        });
        if (!attempt.ok || !attempt.body) {
            const result = await attempt.json().catch(() => null);
            const message = result?.message || `Provider stream failed (${attempt.status}).`;
            const error = new Error(message);
            if (result?.status !== undefined) (error as any).status = result.status;
            throw error;
        }
        return attempt;
    }, (config.name as ProviderName) || 'Provider', 3, options?.signal);
    if (!response.body) {
        throw new Error('Provider stream returned no body.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let droppedEvents = 0;
    let proxyFinish: FinishReason | undefined;
    const gate = createThinkingStreamGate();
    const toolBuf = new StreamToolCallBuffer();
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
            // `data:` payload (possibly `data: [DONE]` at the end). Some
            // gateways emit CRLF line endings — normalize first so the
            // blank-line scan (and the per-line `data:` match below) never
            // strand an event behind a '\r\r\n' separator.
            buffer = buffer.replace(/\r\n/g, '\n');
            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) >= 0) {
                const event = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                // ALL data: lines of the event, joined — multi-line data is
                // legal SSE (see sseEventPayload).
                const data = sseEventPayload(event);
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
                    // error.code is usually a STRING ('invalid_request_error')
                    // — only a NUMERIC code is a status. The old
                    // parseInt(code)||0 stamped status=0 onto every string
                    // code, which downstream truthiness checks read as a
                    // present status. Leave it unset unless it's really numeric.
                    if (typeof chunk.error.code === 'number') (error as any).status = chunk.error.code;
                    else if (typeof chunk.error.code === 'string' && /^\d{3}$/.test(chunk.error.code)) (error as any).status = Number(chunk.error.code);
                    if (chunk.error.status !== undefined) (error as any).status = chunk.error.status;
                    throw error;
                }
                reportUsage(config, chunk, options, messages);
                if (chunk?.choices?.[0]?.finish_reason) {
                    proxyFinish = normalizeFinishReason(chunk.choices[0].finish_reason);
                }
                toolBuf.push(chunk?.choices?.[0]?.delta || {});
                const visible = forwardDelta(chunk?.choices?.[0]?.delta || {});
                if (visible) yield visible;
            }
        }
        // Flush any trailing buffer (final event without a blank line).
        if (buffer.trim()) {
            const data = sseEventPayload(buffer);
            if (data && data !== '[DONE]') {
                let chunk: any;
                try {
                    chunk = JSON.parse(data);
                } catch { /* trailing partial event — ignore */ }
                if (chunk?.error) {
                    // Provider error in the final event must propagate, not
                    // be silently swallowed like a partial event would be.
                    const error = new Error(chunk.error.message || `Provider stream error (${chunk.error.code ?? 'unknown'})`);
                    if (typeof chunk.error.code === 'number') (error as any).status = chunk.error.code;
                    else if (typeof chunk.error.code === 'string' && /^\d{3}$/.test(chunk.error.code)) (error as any).status = Number(chunk.error.code);
                    if (chunk.error.status !== undefined) (error as any).status = chunk.error.status;
                    throw error;
                }
                if (chunk) {
                    if (chunk?.choices?.[0]?.finish_reason) {
                        proxyFinish = normalizeFinishReason(chunk.choices[0].finish_reason);
                    }
                    toolBuf.push(chunk?.choices?.[0]?.delta || {});
                    const visible = forwardDelta(chunk?.choices?.[0]?.delta || {});
                    if (visible) yield visible;
                }
            }
        }
        const flushed = gate.flush();
        if (flushed.thinking.trim()) options?.onReasoning?.(flushed.thinking);
        if (flushed.visible) yield flushed.visible;
        toolBuf.finish(options);
        reportFinishReason(config, proxyFinish ?? 'unknown', options);
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
