/**
 * Stage 20f — "Full analysis" survives as an INSTRUCTION, with a check that the
 * turn obeyed it.
 *
 * 20c deleted the keyword gate, which left the button with two possible meanings:
 * a run that is told to look things up, or nothing at all. This is the first. The
 * tests are mostly about the false-positive direction, because the notice is only
 * worth reading if it stays silent on an ordinary chat line — a turn that called
 * nothing is also what a text-only model does when asked a definition, and shaming
 * every one of those is how a warning becomes wallpaper.
 *
 * The plumbing is pinned as source contracts on purpose: the flag has to travel
 * from the ONE caller that means it (the dock's Full-analysis button) through the
 * options bag into the turn, and a unit test of `runChatSurfaceTurn` alone cannot
 * see a caller that forgets to pass it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { MessageRole } from '../types';
import type { Message } from '../types/message';
import { streamChatWithDeskTools } from '../services/analysis/DeskToolsService';
import { runChatSurfaceTurn } from '../services/trade/chatSurfaceTurn';

vi.mock('../services/analysis/DeskToolsService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/DeskToolsService')>();
    return { ...actual, streamChatWithDeskTools: vi.fn() };
});
vi.mock('../services/trade/toolPayloadStore', () => ({ saveToolPayload: vi.fn(() => true) }));
vi.mock('../services/learning/SkillMemoryService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/learning/SkillMemoryService')>();
    return { ...actual, listSkills: vi.fn(() => []) };
});

const mockStream = vi.mocked(streamChatWithDeskTools);

const script = (steps: Array<{ call?: string; line?: string; text?: string }>): void => {
    mockStream.mockImplementation((async function* (_c: unknown, _m: unknown, o: unknown) {
        const owned = o as { onToolEvent?: (line: string) => void; onToolCall?: (name: string) => void };
        for (const s of steps) {
            if (s.call !== undefined) owned.onToolCall?.(s.call);
            if (s.line !== undefined) owned.onToolEvent?.(s.line);
            if (s.text !== undefined) yield s.text;
        }
    }) as never);
};

const turn = (extra: { requireTools?: boolean } = {}) => {
    let row: Message = { id: 'ai-1', role: MessageRole.AI, text: '', createdAt: new Date().toISOString() };
    return runChatSurfaceTurn({
        config: { id: 'p1', name: 'P1', selectedModel: 'gpt-4o' } as never,
        history: [] as Message[],
        prompt: 'what is btc doing',
        trades: [] as never,
        signal: new AbortController().signal,
        startedAt: Date.now() - 50,
        symbol: 'BTCUSDT',
        interval: '15m',
        patch: fn => { row = fn(row); },
        paint: () => {},
        ...extra,
    });
};

const systemSent = (): string => String(
    (mockStream.mock.calls[0] as unknown as [unknown, Array<{ role: string; content: string }>])[1][0].content,
);

beforeEach(() => {
    mockStream.mockReset();
});

describe('a full analysis is told, and checked', () => {
    it('tells the seat to call the tape before it states a number', async () => {
        script([{ text: 'BTC is holding 111k.' }]);
        await turn({ requireTools: true });
        expect(systemSent()).toContain('FULL ANALYSIS REQUESTED');
    });

    it('says so on the row when the turn called nothing', async () => {
        script([{ text: 'I would guess around 111k.' }]);
        const out = await turn({ requireTools: true });
        expect(out.notice).toMatch(/NOTHING LOOKED UP/);
    });

    it('says NOTHING when a tool actually ran — the check passed', async () => {
        script([{ call: 'get_price_snapshot', line: 'price snapshot · BTCUSDT · 111,040' }, { text: 'Spot 111,040.' }]);
        const out = await turn({ requireTools: true });
        expect(out.notice).toBeUndefined();
    });

    it('does not count a presented plan as looking something up', async () => {
        // `present_trade` is a tool call and paints a call line like any other,
        // but it reads nothing. A Full analysis that only presented a plan is
        // exactly the turn the notice exists for.
        script([
            { call: 'present_trade', line: 'calling present trade…' },
            { line: 'trade plan · BTCUSDT · Long' },
            { text: 'Long BTC at 111,000, stop 109,800.' },
        ]);
        const out = await turn({ requireTools: true });
        expect(out.notice).toMatch(/NOTHING LOOKED UP/);
    });

    it('leaves an ordinary chat line alone: no mandate, no notice', async () => {
        script([{ text: 'A futures contract is an agreement…' }]);
        const out = await turn();
        expect(out.notice).toBeUndefined();
        expect(systemSent()).not.toContain('FULL ANALYSIS REQUESTED');
    });
});

describe('the intent travels as data, from the one caller that means it', () => {
    const pipeline = readFileSync('hooks/useAnalysisPipeline.ts', 'utf8');
    const app = readFileSync('App.tsx', 'utf8');

    it('the desk arm passes the flag through, defaulting to false', () => {
        expect(pipeline).toMatch(/requireTools: options\?\.fullAnalysis === true,/);
    });

    it('the wrapper carries it in the options bag instead of reading the prompt', () => {
        expect(app).toMatch(/fullAnalysis = false/);
        expect(app).toMatch(/reasoningEffort: chatStore\.getActiveEffort\(\),\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+fullAnalysis,/);
        // The dock's button is the only caller that stamps it true, and the Chat
        // surface's ordinary send keeps the plain wrapper: an every-turn mandate
        // would put a warning on half the conversation.
        expect(app).toMatch(/onRunAnalysis=\{(?:async )?\(?p\w*, i\w*\)? => handleRunAnalysisFromChat\(p\w*, i\w*, true\)\}/);
        expect(app).toMatch(/onAnalyze=\{handleRunAnalysisFromChat\}/);
    });
});
