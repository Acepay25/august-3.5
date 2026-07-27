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

// ─── Client Factory ─────────────────────────────────────────────────────────

/**
 * Create an OpenAI SDK client for chat_completions providers.
 */
function createOpenAIClient(config: ProviderConfig): OpenAI {
    return new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
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

    const url = `${config.baseUrl.replace(/\/$/, '')}/messages`;
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
        throw new Error(friendlyMessage);
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
    const url = `${config.baseUrl.replace(/\/$/, '')}/responses`;
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
        throw new Error(friendlyMessage);
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
    if (!config.apiKey || config.apiKey.trim().length === 0) {
        throw new Error(`No API key configured for ${config.name}`);
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
    switch (config.apiFormat) {
        case 'chat_completions':
            return chatCompletionsCall(config, messages, options);
        case 'messages':
            return messagesCall(config, messages, options);
        case 'responses':
            return responsesCall(config, messages, options);
        default:
            throw new Error(`Unknown API format: ${config.apiFormat}`);
    }
}

/**
 * Stream a chat response from any provider as an async generator.
 * Currently supports chat_completions (the dominant format). For messages/responses
 * formats, falls back to non-streaming and yields the full result once.
 */
export async function* streamChatRequest(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: ChatRequestOptions
): AsyncGenerator<string, void, unknown> {
    assertHasKey(config);
    if (config.apiFormat === 'chat_completions') {
        yield* chatCompletionsStream(config, messages, options);
        return;
    }
    // Fallback for non-OpenAI-compat formats: fetch then yield once.
    const full = await sendChatRequest(config, messages, options);
    yield full;
}

/**
 * Quick single-turn response from a provider.
 */
export async function getQuickResponse(
    config: ProviderConfig,
    prompt: string,
    systemPrompt?: string
): Promise<string> {
    const messages: ChatMessage[] = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });
    return sendChatRequest(config, messages, { maxTokens: 2048 });
}

/**
 * Test a provider connection with a minimal request.
 */
export async function testConnection(config: ProviderConfig): Promise<{ success: boolean; message: string }> {
    try {
        const result = await sendChatRequest(
            config,
            [{ role: 'user', content: 'Reply with exactly: OK' }],
            { maxTokens: 10, temperature: 0 }
        );
        return { success: true, message: `Connected to ${config.name} successfully` };
    } catch (error: any) {
        return { success: false, message: error.message || 'Connection failed' };
    }
}
