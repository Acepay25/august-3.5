import { describe, expect, it } from 'vitest';
import { displayThinkingParts, looksLikeTradeOutput, splitThinkingFromOutput } from '../utils/thinkingSplit';

describe('splitThinkingFromOutput', () => {
    it('keeps streamed CoT as thinking and the content stream as output', () => {
        const split = splitThinkingFromOutput(
            'Sweep failed on 15m so I fade the wick.',
            '**Direction:** Short\n**Entry:** 63748\n**Stop Loss:** 63971\n**Take Profit 1:** 63251',
        );
        expect(split.thinking).toContain('Sweep failed');
        expect(split.output).toContain('Direction');
        expect(split.thinking).not.toContain('Take Profit');
    });

    it('does not copy a reasoning-only stream into final output', () => {
        const split = splitThinkingFromOutput('I am weighing HTF vs LTF.', '');
        expect(split.thinking).toBe('I am weighing HTF vs LTF.');
        expect(split.output).toBe('');
    });

    it('moves a trade plan out of the thinking channel', () => {
        const plan = '**FINAL TRADE PLAN**\n- Direction: Short\n- Entry: 63748\n- Stop Loss: 63971\n- Take Profit 1: 63251';
        const split = splitThinkingFromOutput(plan, plan);
        expect(split.thinking).toBe('');
        expect(split.output).toContain('FINAL TRADE PLAN');
    });

    it('moves a leaked thinking-process dump out of the visible answer', () => {
        const dump = `Here's a thinking process:\n\nAnalyze User Input: I'm in a debate. Role: Risk & Execution Specialist.\n\nDeconstruct the Context: Entry 63694 SL 63420.\n\nAnswer:\nShort. TP2 62980, TP3 62640, R:R 1.8.`;
        const split = splitThinkingFromOutput('', dump);
        expect(split.output).toContain('TP2 62980');
        expect(split.output).not.toMatch(/thinking process/i);
        expect(split.thinking).toMatch(/Analyze User Input/i);
    });

    it('peels THINKING / FINAL OUTPUT headers into the two channels', () => {
        const split = splitThinkingFromOutput(
            '',
            'THINKING:\nFade if the sweep fails.\n\nFINAL OUTPUT:\nShort. SL above the wick.',
        );
        expect(split.thinking).toContain('Fade if the sweep fails');
        expect(split.output).toContain('Short. SL above the wick');
        expect(split.output).not.toMatch(/THINKING/i);
    });

    it('strips Hermes-style think tags out of the answer', () => {
        const split = splitThinkingFromOutput(
            '',
            '<think>Weigh HTF vs LTF.</think>\nShort the failed sweep.',
        );
        expect(split.thinking).toContain('Weigh HTF vs LTF');
        expect(split.output).toBe('Short the failed sweep.');
        expect(split.output).not.toMatch(/<\/?think>/i);
    });

    it('hides a scratchpad-only dump until a real answer exists', () => {
        const dump = `Here's a thinking process:\n\nAnalyze User Input: I'm in a debate/ensemble scenario. Role: Risk & Execution Specialist. Current Round: Round 5.`;
        const split = splitThinkingFromOutput('', dump);
        expect(split.output).toBe('');
        expect(split.thinking).toMatch(/thinking process/i);
    });
});

describe('displayThinkingParts', () => {
    it('treats legacy debate-turn reasoning as final output', () => {
        const parts = displayThinkingParts({
            role: 'debate_turn',
            reasoning: 'Short from 4H supply. Entry 63748.',
        });
        expect(parts.output).toContain('Short from 4H supply');
        expect(parts.thinking).toBe('');
    });

    it('does not show the same blob as both thinking and output', () => {
        const blob = '**FINAL TRADE PLAN**\n- Direction: Short\n- Entry: 1\n- Stop Loss: 2\n- Take Profit 1: 3';
        const parts = displayThinkingParts({
            role: 'moderator',
            reasoning: blob,
            finalOutput: blob,
        });
        expect(parts.thinking).toBe('');
        expect(parts.output).toContain('FINAL TRADE PLAN');
    });
});

describe('looksLikeTradeOutput', () => {
    it('detects a labeled plan and ignores a short CoT note', () => {
        expect(looksLikeTradeOutput('**Direction:** Short\nEntry: 1\nStop Loss: 2\nTake Profit 1: 3')).toBe(true);
        expect(looksLikeTradeOutput('Fade the wick if 15m stays weak.')).toBe(false);
    });
});
