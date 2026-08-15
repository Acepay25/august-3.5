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
        expect(body.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 8192 });
        expect(body.generationConfig.maxOutputTokens).toBe(2048);
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
