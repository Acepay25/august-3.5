/**
 * GenericProviderService — Universal AI provider client supporting 3 API formats.
 *
 * Formats:
 * - chat_completions: OpenAI-compatible /chat/completions (most providers)
 * - messages: Anthropic-style /v1/messages
 * - responses: OpenAI Responses API /responses
 */

import OpenAI from 'openai';
import { ProviderConfig } from '../../types/provider';

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

// ─── Chat Completions Format ────────────────────────────────────────────────

async function chatCompletionsCall(
    config: ProviderConfig,
    messages: { role: string; content: string }[],
    options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
    const client = createOpenAIClient(config);
    const response = await client.chat.completions.create({
        model: config.selectedModel,
        messages: messages as any,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
    });
    return response.choices[0]?.message?.content || '';
}

// ─── Messages Format (Anthropic-style) ──────────────────────────────────────

async function messagesCall(
    config: ProviderConfig,
    messages: { role: string; content: string }[],
    options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
    // Extract system message if present
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    const body: any = {
        model: config.selectedModel,
        max_tokens: options?.maxTokens || 4096,
        messages: nonSystemMsgs.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) {
        body.system = systemMsg.content;
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
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Messages API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    // Anthropic returns { content: [{ type: 'text', text: '...' }] }
    if (data.content && Array.isArray(data.content)) {
        return data.content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n');
    }
    return data.text || JSON.stringify(data);
}

// ─── Responses Format (OpenAI Responses API) ────────────────────────────────

async function responsesCall(
    config: ProviderConfig,
    messages: { role: string; content: string }[],
    options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
    // Convert messages to Responses API input format
    const input = messages.map(m => ({
        role: m.role,
        content: m.content,
    }));

    const url = `${config.baseUrl.replace(/\/$/, '')}/responses`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.selectedModel,
            input,
            max_output_tokens: options?.maxTokens || 4096,
            temperature: options?.temperature ?? 0.7,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Responses API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    // Responses API returns { output: [{ type: 'message', content: [{ type: 'output_text', text: '...' }] }] }
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
    // Fallback: try output_text directly
    if (data.output_text) return data.output_text;
    return JSON.stringify(data);
}

// ─── Universal Dispatcher ───────────────────────────────────────────────────

/**
 * Send a chat request to any provider, routing to the correct API format.
 */
export async function sendChatRequest(
    config: ProviderConfig,
    messages: { role: string; content: string }[],
    options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
        throw new Error(`No API key configured for ${config.name}`);
    }

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
 * Quick single-turn response from a provider.
 */
export async function getQuickResponse(
    config: ProviderConfig,
    prompt: string,
    systemPrompt?: string
): Promise<string> {
    const messages: { role: string; content: string }[] = [];
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
