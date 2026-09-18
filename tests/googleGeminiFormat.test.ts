import { describe, expect, it } from 'vitest';
import {
    chatMessagesToGemini,
    geminiModelId,
    googleGenerateUrl,
    parseGeminiResponse,
    extractGeminiUsage,
    GOOGLE_GEMINI_DEFAULT_BASE,
} from '../utils/googleGeminiFormat';

describe('googleGeminiFormat', () => {
    it('builds generateContent URL and strips models/ from the id', () => {
        expect(geminiModelId('models/gemini-2.5-flash')).toBe('gemini-2.5-flash');
        expect(googleGenerateUrl(GOOGLE_GEMINI_DEFAULT_BASE, 'models/gemini-2.5-flash', 'AIza-test')).toBe(
            `${GOOGLE_GEMINI_DEFAULT_BASE}/models/gemini-2.5-flash:generateContent?key=AIza-test`,
        );
    });

    it('maps system + assistant into systemInstruction and model turns', () => {
        const body = chatMessagesToGemini([
            { role: 'system', content: 'You are a desk.' },
            { role: 'user', content: 'Long or short?' },
            { role: 'assistant', content: 'Short.' },
            { role: 'user', content: 'Why?' },
        ], { model: 'gemini-2.5-flash', temperature: 0.2, maxTokens: 2048 });
        expect(body.systemInstruction?.parts[0].text).toBe('You are a desk.');
        expect(body.contents.map(c => c.role)).toEqual(['user', 'model', 'user']);
        expect(body.generationConfig.maxOutputTokens).toBe(2048);
        // Gemini bills thinking tokens INSIDE maxOutputTokens, so the old flat
        // 8192 on a 2048-token call over-subscribed the response — this pinned
        // that, not a working configuration.
        expect(body.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 2047 });
    });

    it('clamps the thinking budget to the output limit instead of overspending it', () => {
        const msgs = [{ role: 'user', content: 'go' }];
        // Effort 'max' asks for 16384; a full analysis call has 8192.
        const capped = chatMessagesToGemini(msgs, { model: 'gemini-2.5-pro', maxTokens: 8192, reasoningEffort: 'max' });
        expect(capped.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 8191 });
        // Room to spare: the requested tier is used as-is.
        const roomy = chatMessagesToGemini(msgs, { model: 'gemini-2.5-pro', maxTokens: 32768, reasoningEffort: 'high' });
        expect(roomy.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 8192 });
        // A connection test has no budget worth thinking with — send nothing
        // rather than a config the API would reject.
        const tiny = chatMessagesToGemini(msgs, { model: 'gemini-2.5-pro', maxTokens: 64 });
        expect(tiny.generationConfig.thinkingConfig).toBeUndefined();
    });

    it('splits thought parts from answer text', () => {
        const parsed = parseGeminiResponse({
            candidates: [{
                content: {
                    parts: [
                        { text: 'Weighing HTF.', thought: true },
                        { text: 'Short the failed sweep.' },
                    ],
                },
            }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
        });
        expect(parsed.reasoning).toBe('Weighing HTF.');
        expect(parsed.text).toBe('Short the failed sweep.');
        expect(extractGeminiUsage({
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
        })).toEqual({ promptTokens: 10, completionTokens: 4, totalTokens: 14 });
    });
});
