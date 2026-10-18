import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { CASUAL_CHAT_SYSTEM_PROMPT } from '../constants/prompts/chatPrompts';

/**
 * The plain chat turn used to be driven by a two-sentence string literal,
 * duplicated inline at both call sites — the only chat prompt in the app with no
 * output discipline, which is why a model whose thinking channel is switched off
 * wrote its plan into the answer and the trader read it back as
 * "Here's a thinking process: …".
 */
describe('the casual chat prompt', () => {
    it('forbids the scratchpad shapes the model otherwise emits', () => {
        expect(CASUAL_CHAT_SYSTEM_PROMPT).toMatch(/no restated instructions/i);
        expect(CASUAL_CHAT_SYSTEM_PROMPT).toMatch(/here's my thinking|final output/i);
        expect(CASUAL_CHAT_SYSTEM_PROMPT).toMatch(/answer directly/i);
    });

    it('keeps the role sentence the models were already answering to', () => {
        expect(CASUAL_CHAT_SYSTEM_PROMPT).toMatch(/helpful and concise AI assistant specializing in futures trading/);
    });

    it('is read from one constant at every casual call site, not retyped', () => {
        const src = readFileSync('services/providers/GenericAnalysisService.ts', 'utf8');
        expect(src.match(/systemInstruction \|\| CASUAL_CHAT_SYSTEM_PROMPT/g)).toHaveLength(2);
        expect(src).not.toMatch(/helpful and concise AI assistant specializing/);
        // Stage 20b gave the Chat surface a second casual transport (the desk
        // turn). A third copy of this prompt is how two homes start answering
        // the same question with different discipline, so the new site must
        // import the constant too.
        const surface = readFileSync('services/trade/chatSurfaceTurn.ts', 'utf8');
        expect(surface).toMatch(/systemPrompt \|\| CASUAL_CHAT_SYSTEM_PROMPT/);
        expect(surface).not.toMatch(/helpful and concise AI assistant specializing/);
    });
});
