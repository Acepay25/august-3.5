/**
 * Stage 20s — the Chat surface's own system prompt, and the record of what went
 * into it.
 *
 * Stage 20b gave this surface the desk tools and left its prompt the one written
 * for a model with NONE. So a seat holding `get_price_snapshot` was still
 * invited to answer "what is BTC doing" out of training data, and the skills
 * library — the thing the owner named as the focus of the whole redesign — never
 * reached a Chat turn at all: only the dock assembled it.
 *
 * Four ways this could be quietly false, each checked here:
 *  1. the mandate may be a copy of the casual prompt (then nothing changed);
 *  2. the blocks may be read once at module load (then an approved skill waits
 *     for a reload);
 *  3. the recorded slug list may disagree with the printed index — a row
 *     claiming a skill the model never saw is the audit defect, not the feature;
 *  4. the dock's heading may drift along with the new `where` argument, which
 *     would rewrite a byte-identical prompt on the other home.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRole } from '../types';
import type { Message } from '../types/message';
import { CASUAL_CHAT_SYSTEM_PROMPT, CHAT_SURFACE_SYSTEM_PROMPT } from '../constants/prompts/chatPrompts';
import { buildSkillsIndexForPrompt } from '../services/trade/tradeChatContext';
import { listSkills } from '../services/learning/SkillMemoryService';
import { activeStrategiesBlock } from '../services/learning/strategyStore';
import { buildProfileMemoryIndex } from '../services/learning/profileMemory';
import { streamChatWithDeskTools } from '../services/analysis/DeskToolsService';
import { chatSurfaceSystemPrompt, runChatSurfaceTurn } from '../services/trade/chatSurfaceTurn';

vi.mock('../services/analysis/DeskToolsService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/DeskToolsService')>();
    return { ...actual, streamChatWithDeskTools: vi.fn() };
});
vi.mock('../services/trade/toolPayloadStore', () => ({ saveToolPayload: vi.fn(() => true) }));
vi.mock('../services/learning/SkillMemoryService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/learning/SkillMemoryService')>();
    return { ...actual, listSkills: vi.fn() };
});
vi.mock('../services/learning/strategyStore', () => ({ activeStrategiesBlock: vi.fn() }));
vi.mock('../services/learning/profileMemory', () => ({ buildProfileMemoryIndex: vi.fn() }));

const mockStream = vi.mocked(streamChatWithDeskTools);
const mockSkills = vi.mocked(listSkills);
const mockStrategies = vi.mocked(activeStrategiesBlock);
const mockMemory = vi.mocked(buildProfileMemoryIndex);

const skillRows = (n: number) => Array.from({ length: n }, (_, i) => ({
    file: { name: `skill-${i}.md`, content: '', createdAt: '' },
    meta: { status: 'active', kind: 'repeat', description: `rule number ${i}`, ifCondition: 'x', thenAction: 'y' },
} as never));

/** The transport's first message is the system prompt it was handed. */
const systemSent = (index = 0): string => String(
    (mockStream.mock.calls[index] as unknown as [unknown, Array<{ role: string; content: string }>])[1][0].content,
);

const harness = (extra: { systemPrompt?: string } = {}) => {
    let row: Message = { id: 'ai-1', role: MessageRole.AI, text: '', createdAt: new Date().toISOString() };
    const req = {
        config: { id: 'p1', name: 'P1', selectedModel: 'gpt-4o' } as never,
        history: [] as Message[],
        prompt: 'what is btc doing',
        trades: [] as never,
        signal: new AbortController().signal,
        startedAt: Date.now() - 100,
        symbol: 'BTCUSDT',
        interval: '15m',
        patch: (fn: (m: Message) => Message) => { row = fn(row); },
        paint: () => {},
        ...extra,
    };
    return { req, get row() { return row; } };
};

beforeEach(() => {
    mockStream.mockReset();
    mockSkills.mockReset();
    mockStrategies.mockReset();
    mockMemory.mockReset();
    mockStream.mockImplementation((async function* () { yield 'BTC is holding 111k.'; } as never));
    mockStrategies.mockReturnValue('');
    mockMemory.mockReturnValue('');
    mockSkills.mockReturnValue([]);
});

describe('the Chat surface mandate', () => {
    it('is the casual prompt PLUS a calling discipline, not a replacement of it', () => {
        // The casual prompt's output contract fixed the "Here's a thinking
        // process:" replies. Losing it while adding a tool mandate would trade
        // one defect for a worse one.
        expect(CHAT_SURFACE_SYSTEM_PROMPT.startsWith(CASUAL_CHAT_SYSTEM_PROMPT)).toBe(true);
        expect(CHAT_SURFACE_SYSTEM_PROMPT).toMatch(/LOOK UP, DON'T REMEMBER/);
        expect(CHAT_SURFACE_SYSTEM_PROMPT).toMatch(/NO CHART HERE/);
        expect(CHAT_SURFACE_SYSTEM_PROMPT).toMatch(/present_trade/);
    });

    it('carries the skills index, the active strategies and the memory index', () => {
        mockSkills.mockReturnValue(skillRows(2));
        mockStrategies.mockReturnValue('**ACTIVE STRATEGIES** (1) — pullback');
        mockMemory.mockReturnValue('## Remembered\n- prefers 15m');
        const { text } = chatSurfaceSystemPrompt();
        expect(text).toContain('skill-0');
        expect(text).toContain('pullback');
        expect(text).toContain('prefers 15m');
    });

    it('names the thing a skill must match as the question, never a chart', () => {
        mockSkills.mockReturnValue(skillRows(1));
        const { text } = chatSurfaceSystemPrompt();
        expect(text).toContain('what the trader asks about');
        expect(text).not.toContain('this chart');
    });

    it('leaves the dock’s heading byte-identical — the new argument is opt-in', () => {
        // Control for the change above: a shared builder whose DEFAULT moved
        // would rewrite the dock's prompt for every seat, silently.
        const rows = [{ slug: 'skill-0', status: 'active', description: 'd' }];
        expect(buildSkillsIndexForPrompt(rows)).toContain('match this chart');
    });

    it('re-reads every store per call, so a skill approved mid-session rides the next turn', () => {
        mockSkills.mockReturnValue(skillRows(1));
        expect(chatSurfaceSystemPrompt().text).toContain('skill-0');
        expect(mockSkills).toHaveBeenCalledTimes(1);
        mockSkills.mockReturnValue(skillRows(2));
        expect(chatSurfaceSystemPrompt().text).toContain('skill-1');
        expect(mockSkills).toHaveBeenCalledTimes(2);
    });

    it('answers anyway when a store throws — the prompt carries less, the turn is not lost', () => {
        mockSkills.mockImplementation(() => { throw new Error('notebook unreadable'); });
        const { text, skills } = chatSurfaceSystemPrompt();
        expect(text).toBe(CHAT_SURFACE_SYSTEM_PROMPT);
        expect(skills).toEqual([]);
    });
});

describe('the per-turn skill record', () => {
    it('writes onto the row exactly the slugs the printed index carried', async () => {
        mockSkills.mockReturnValue(skillRows(2));
        const h = harness();
        await runChatSurfaceTurn(h.req);
        expect(h.row.injectedSkills).toEqual(['skill-0', 'skill-1']);
        expect(systemSent()).toContain('skill-1');
    });

    it('records only the window the index printed, not the whole library', async () => {
        // The ceiling is the contract: 35 skills exist, the prompt shows 30, so
        // a record naming all 35 would claim five skills this turn never saw.
        mockSkills.mockReturnValue(skillRows(35));
        const h = harness();
        await runChatSurfaceTurn(h.req);
        expect(h.row.injectedSkills).toHaveLength(30);
        expect(h.row.injectedSkills?.[29]).toBe('skill-29');
        expect(systemSent()).not.toContain('- skill-30');
    });

    it('writes NOTHING when a caller brings its own mandate', async () => {
        // A toggle must remove something: with a persona prompt there is no
        // injection to record, and an empty array would read as "this turn had
        // no skills" while a missing field reads as "not this surface's prompt".
        mockSkills.mockReturnValue(skillRows(3));
        const h = harness({ systemPrompt: 'You answer as Atlas.' });
        await runChatSurfaceTurn(h.req);
        expect(h.row.injectedSkills).toBeUndefined();
        expect(systemSent()).toBe('You answer as Atlas.');
    });

    it('writes NOTHING when the library is empty, and still answers', async () => {
        mockSkills.mockReturnValue([]);
        const h = harness();
        const out = await runChatSurfaceTurn(h.req);
        expect(h.row.injectedSkills).toBeUndefined();
        expect(out.text).toContain('111k');
    });
});
