import { describe, expect, it } from 'vitest';
import { createThinkingStreamGate, displayThinkingParts, splitThinkingFromOutput } from '../utils/thinkingSplit';

describe('thinking-split harness (final prose never leaks scratchpad)', () => {
    it('live stream: thinking stays in details, visible never carries tags', () => {
        const gate = createThinkingStreamGate();
        const chunks = ['<think>Weigh ', 'the sweep.</think>\n', 'Short ', '62760 SL 62910.'];
        let thinking = '';
        let visible = '';
        for (const c of chunks) {
            const out = gate.push(c);
            thinking += out.thinking;
            visible += out.visible;
        }
        const flushed = gate.flush();
        thinking += flushed.thinking;
        visible += flushed.visible;
        const split = splitThinkingFromOutput(thinking, visible);
        expect(split.thinking).toMatch(/Weigh the sweep/);
        expect(split.output).toBe('Short 62760 SL 62910.');
        expect(split.output).not.toMatch(/<\/?think>/i);
        expect(split.output).not.toMatch(/Weigh the sweep/);
    });

    it('replay (stored) never renders the same blob as both lanes', () => {
        const blob = 'Short 62760 · entry 62780 · SL 62910 · TP 62500';
        const parts = displayThinkingParts({ role: 'moderator', reasoning: blob, finalOutput: blob });
        expect(parts.thinking === '' || parts.output === '').toBe(true);
        const merged = `${parts.thinking} ${parts.output}`.trim();
        expect(merged).toContain('Short 62760');
    });

    it('MessageItem contract: one split per turn keeps both lanes queryable', () => {
        const cot = 'HTF offered, fade the sweep high.';
        const prose = '**Direction:** Short\n**Entry:** 62780\n**Stop Loss:** 62910';
        const split = splitThinkingFromOutput(cot, `${cot}\n\n${prose}`);
        expect(split.thinking).toContain('HTF offered');
        expect(split.output).toContain('Direction');
        expect(split.output).not.toContain('HTF offered');
    });
});
