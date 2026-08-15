import { describe, expect, it } from 'vitest';
import { createThinkingStreamGate, displayThinkingParts, looksLikeTradeOutput, splitThinkingFromOutput, visibleReplyFromThinking } from '../utils/thinkingSplit';

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

    it('strips native CoT when whitespace in the content stream differs', () => {
        const cot = 'Weigh HTF vs LTF.';
        const split = splitThinkingFromOutput(cot, `Weigh HTF vs LTF.\n\nShort the failed sweep.`);
        expect(split.thinking).toBe(cot);
        expect(split.output).toBe('Short the failed sweep.');
    });

    it('does not copy Thinking paragraphs into the Final output bubble', () => {
        const cot = 'Weigh HTF vs LTF and fade the failed sweep.';
        const visible = visibleReplyFromThinking(
            cot,
            `${cot}\n\n**Direction:** Short\n**Entry:** 63748\n**Stop Loss:** 63971\n**Take Profit 1:** 63251`,
        );
        expect(visible).toContain('Direction');
        expect(visible).not.toMatch(/Weigh HTF vs LTF/);
    });

    it('hides a prompt-echo dump that never uses an Answer header', () => {
        const dump = `Here's a thinking process:

Analyze User Input: I'm in a debate/ensemble scenario. Role: Risk & Execution Specialist. Current Round: Round 5. Moderator's question: "State direction and give exact TP2, TP3, and R:R ratio." There's a "LIVE PRICE REFRESH: $63,653.08" note. There's a levels snapshot table showing my R3 entry: 63,694, SL: 63,420, TP1: 63,251. I need to answer directly, 60-100 words max, plain prose, no JSON/XML/tags/headers. I must correct any misunderstanding. I need to give exact TP2, TP3, and R:R ratio.

Deconstruct the Context: The levels snapshot restates Entry 63694 SL 63420 TP1 63251.`;
        const split = splitThinkingFromOutput('', dump);
        expect(split.output).toBe('');
        expect(split.thinking).toMatch(/Analyze User Input/i);
        expect(split.thinking).toMatch(/LIVE PRICE REFRESH/i);
    });

    it('keeps a numeric clarification that follows a scratchpad without an Answer header', () => {
        const dump = `Here's a thinking process:\n\nAnalyze User Input: Round 5 clarification.\n\nShort. TP2 62980, TP3 62640, R:R 1.8.`;
        const split = splitThinkingFromOutput('', dump);
        expect(split.output).toContain('TP2 62980');
        expect(split.output).not.toMatch(/thinking process/i);
        expect(split.thinking).toMatch(/Analyze User Input/i);
    });

    it('keeps native streamed CoT and drops tagged THINKING from content', () => {
        const split = splitThinkingFromOutput(
            'Native chain-of-thought from the provider.',
            '<THINKING>Tagged fallback reasoning.</THINKING><FINAL_OUTPUT>Proposal text.</FINAL_OUTPUT>',
        );
        expect(split.thinking).toContain('Native chain-of-thought');
        expect(split.thinking).not.toContain('Tagged fallback');
        expect(split.output).toContain('Proposal text');
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

    it('splits DeepSeek-style </think> without an opener', () => {
        const split = splitThinkingFromOutput(
            '',
            'Weigh HTF vs LTF and fade the failed sweep.\n</think>\nShort. SL above the wick.',
        );
        expect(split.thinking).toContain('Weigh HTF vs LTF');
        expect(split.output).toBe('Short. SL above the wick.');
        expect(split.output).not.toMatch(/think/i);
    });

    it('hides an unclosed <think> dump until the answer starts', () => {
        const split = splitThinkingFromOutput('', '<think>\nStill weighing the sweep.');
        expect(split.output).toBe('');
        expect(split.thinking).toContain('Still weighing the sweep');
    });

    it('peels Seed thought / solution tokens', () => {
        const split = splitThinkingFromOutput(
            '',
            '<|begin_of_thought|>Fade the wick.<|end_of_thought|><|begin_of_solution|>Short the failed sweep.<|end_of_solution|>',
        );
        expect(split.thinking).toContain('Fade the wick');
        expect(split.output).toBe('Short the failed sweep.');
    });

    it('peels Reasoning / Answer markdown headers', () => {
        const split = splitThinkingFromOutput(
            '',
            '**Reasoning:**\nHTF is offered.\n\n**Answer:**\nShort from the sweep high.',
        );
        expect(split.thinking).toContain('HTF is offered');
        expect(split.output).toContain('Short from the sweep high');
        expect(split.output).not.toMatch(/Reasoning/i);
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

describe('createThinkingStreamGate', () => {
    it('holds think-tag bodies off the visible stream until the close tag', () => {
        const gate = createThinkingStreamGate();
        const a = gate.push('<thi');
        expect(a.visible).toBe('');
        const b = gate.push('nk>Weigh HTF vs LTF.</think>\nShort the failed sweep.');
        expect(b.thinking).toContain('Weigh HTF vs LTF.');
        expect(b.visible).toContain('Short the failed sweep.');
        expect(b.visible).not.toMatch(/think/i);
    });

    it('does not swallow the answer when </think> is split across chunks', () => {
        const gate = createThinkingStreamGate();
        const start = gate.push('<think>Weigh HTF.');
        const mid = gate.push('</thi');
        const end = gate.push('nk>\nShort the failed sweep.');
        expect(start.thinking + mid.thinking + end.thinking).toContain('Weigh HTF.');
        expect(mid.visible).toBe('');
        expect(end.visible).toContain('Short the failed sweep.');
    });
});
