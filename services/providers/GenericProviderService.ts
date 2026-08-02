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
}

// ─── URL Normalization Helper ───────────────────────────────────────────────

/**
 * Normalizes base URLs by stripping trailing slashes and format-specific endpoint suffixes.
 * This ensures that pasting full endpoint URLs (e.g. ending in /chat/completions) works properly.
 */
export function normalizeBaseUrl(url: string, format: string): string {
    let clean = (url || '').trim().replace(/\/+$/, '');
    if (!clean) return '';

    if (format === 'chat_completions' && clean.endsWith('/chat/completions')) {
        clean = clean.substring(0, clean.length - '/chat/completions'.length);
    } else if (format === 'messages' && clean.endsWith('/messages')) {
        clean = clean.substring(0, clean.length - '/messages'.length);
    } else if (format === 'responses' && clean.endsWith('/responses')) {
        clean = clean.substring(0, clean.length - '/responses'.length);
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

/** Heuristic: does this model accept vision/image inputs? */
function isVisionModel(modelId: string): boolean {
    const m = modelId.toLowerCase();
    return m.includes('llama-4')
        || m.includes('vision')
        || m.includes('gpt-4o')
        || m.includes('gpt-4.1')
        || m.includes('gpt-5')
        || m.includes('glm-4.5v')
        || m.includes('glm-4.6v')
        || m.includes('gemini');
}

// ─── Timeout & Retry Helpers ────────────────────────────────────────────────

/** Abort a request if it exceeds this wall-clock duration (per attempt). */
const REQUEST_TIMEOUT_MS = 120_000;

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
    const response = await client.chat.completions.create(params, options?.signal ? { signal: options.signal } : undefined);
    return response.choices[0]?.message?.content || '';
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
    const stream = await client.chat.completions.create(params, options?.signal ? { signal: options.signal } : undefined);
    for await (const chunk of stream) {
        yield chunk.choices[0]?.delta?.content || '';
    }
}

// ─── Messages Format (Anthropic-style) ──────────────────────────────────────

/** Convert a ChatMessage's content to Anthropic message content blocks. */
function toAnthropicContent(content: string | ContentPart[]): any[] {
    if (typeof content === 'string') {
        return [{ type: 'text', text: content }];
    }
    return content.map(part => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: part.image_url.url.split(',')[1] || '' } };
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
    if (options?.temperature !== undefined) {
        body.temperature = options.temperature;
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
    if (data.content && Array.isArray(data.content)) {
        return data.content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n');
    }
    return data.text || JSON.stringify(data);
}

// ─── Responses Format (OpenAI Responses API) ────────────────────────────────

function toResponsesInput(messages: ChatMessage[]): any[] {
    return messages.map(m => ({
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
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.selectedModel,
            input: toResponsesInput(messages),
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
    if (!config.baseUrl || config.baseUrl.trim().length === 0) {
        throw new Error(`No Base URL configured for ${config.name}`);
    }
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
        const raw = (err?.message || '').toLowerCase();
        if (raw.includes('fetch') || raw.includes('network') || raw.includes('econnrefused') || raw.includes('enotfound') || raw.includes('failed to connect')) {
            friendly = `${name}: could not reach the server. Check the base URL and your connection.`;
        } else {
            friendly = `${name}: request failed.`;
        }
    }

    console.warn(`[GenericProviderService] ${name} error:`, err?.message || error);
    const wrapped = new Error(friendly);
    if (status !== undefined) {
        (wrapped as any).status = status;
    }
    return wrapped;
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
    try {
        // Retry transient failures (rate limit / network / 5xx) with
        // exponential backoff; each attempt is hard-capped by REQUEST_TIMEOUT_MS.
        return await withRetry(
            () => {
                switch (effectiveConfig.apiFormat) {
                    case 'chat_completions':
                        return chatCompletionsCall(effectiveConfig, messages, { ...options, signal: withTimeoutSignal(options?.signal) });
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
    } catch (error) {
        throw toFriendlyProviderError(error, effectiveConfig.name);
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
        if (effectiveConfig.apiFormat === 'chat_completions') {
            yield* chatCompletionsStream(effectiveConfig, messages, { ...options, signal: withTimeoutSignal(options?.signal) });
            return;
        }
    } catch (error) {
        throw toFriendlyProviderError(error, effectiveConfig.name);
    }
    // Fallback for non-OpenAI-compat formats: fetch then yield once.
    const full = await sendChatRequest(effectiveConfig, messages, options);
    yield full;
}

/**
 * Quick single-turn response from a provider.
 */
export async function getQuickResponse(
    config: ProviderConfig,
    prompt: string,
    historyOrSystem?: string | any[]
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

    return sendChatRequest(config, chatMessages, { maxTokens: 2048 });
}

/**
 * Test a provider connection with a minimal request.
 */
export async function testConnection(config: ProviderConfig): Promise<{ success: boolean; message: string }> {
    try {
        const testConfig = {
            ...config,
            apiKey: config.apiKey?.trim() || 'not-needed'
        };
        const result = await sendChatRequest(
            testConfig,
            [{ role: 'user', content: 'Reply with exactly: OK' }],
            { maxTokens: 10, temperature: 0 }
        );
        return { success: true, message: `Connected to ${config.name} successfully` };
    } catch (error: any) {
        return { success: false, message: error.message || 'Connection failed' };
    }
}
