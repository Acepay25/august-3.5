import { describe, it, expect } from 'vitest';

import {
    seatPersonaPrompt,
    seatHasPersona,
    GENERAL_ANALYST_DEFAULT_PROMPT,
} from '../services/agents/seatPersonas';

describe('seatPersonas — a seat carries only the trader instructions', () => {
    it('general-analyst default when the seat has no instructions', () => {
        expect(seatPersonaPrompt({})).toBe(GENERAL_ANALYST_DEFAULT_PROMPT);
        expect(seatPersonaPrompt(null)).toBe(GENERAL_ANALYST_DEFAULT_PROMPT);
        // The default mandate covers market analysis, best-signal framing and
        // data grounding via tools/web.
        expect(GENERAL_ANALYST_DEFAULT_PROMPT).toContain('GENERAL MARKET ANALYST');
        expect(GENERAL_ANALYST_DEFAULT_PROMPT).toContain('strongest, most actionable trading signal');
        expect(GENERAL_ANALYST_DEFAULT_PROMPT).toContain('web search');
    });

    it('trader instructions REPLACE the default verbatim', () => {
        const custom = 'You are a copy-trade analyst: mirror the desk lead only.';
        const prompt = seatPersonaPrompt({ customPrompt: custom });
        expect(prompt).toBe(custom);
        expect(prompt).not.toContain('GENERAL MARKET ANALYST');
    });

    it('whitespace-only instructions fall back to the default', () => {
        expect(seatPersonaPrompt({ customPrompt: '   ' })).toBe(GENERAL_ANALYST_DEFAULT_PROMPT);
    });

    it('seatHasPersona is true only for real instructions', () => {
        expect(seatHasPersona({ customPrompt: '  do x  ' })).toBe(true);
        expect(seatHasPersona({ customPrompt: '   ' })).toBe(false);
        expect(seatHasPersona({})).toBe(false);
        expect(seatHasPersona(undefined)).toBe(false);
    });

    it('every prompt is non-empty, even for a wholly empty seat', () => {
        expect(seatPersonaPrompt(null).length).toBeGreaterThan(0);
        expect(seatPersonaPrompt({}).length).toBeGreaterThan(0);
        expect(seatPersonaPrompt(undefined).length).toBeGreaterThan(0);
    });
});
