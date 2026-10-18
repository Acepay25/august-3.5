/**
 * 20r — a scheduled run answers with its tools, and the two rules that make it
 * safe to run without a human watching are enforced HERE, in the turn:
 *
 *  1. A PLAN IS RATIONED. `MAX_PLANS_PER_RUN` binds on the turn's own counter
 *     and `MAX_PLANS_PER_DAY` on the automation ledger. A refusal is a
 *     `present_trade` receipt with `ok: false` — the model reads that and stops,
 *     instead of retrying into a plan the run never earned. The cap that is only
 *     a UI rule is no cap at all: nothing else would ever call this leg twice.
 *  2. A FAILURE IS VISIBLE. A tool that came back with nothing, a run that
 *     called nothing, and a plan the cap refused all land in `notices`, which
 *     `useAnalysisPipeline` writes into the stored row and `useAutomations` turns
 *     into a WARNING toast instead of a success one.
 *
 * The tool list is derived from the Chat surface's, so its denial is checked as
 * a derivation (every denied name exists, no denied name is offered, lookups
 * survive) rather than as a hardcoded count that passes when a name is dropped.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '../types/message';
import type { ProviderConfig } from '../types/provider';
import { streamChatWithDeskTools } from '../services/analysis/DeskToolsService';
import { CHAT_SURFACE_TOOLS } from '../services/trade/chatSurfaceTurn';
import {
    AUTOMATION_TOOLS, AUTOMATION_UNATTENDED_DENY, MAX_PLANS_PER_RUN,
    automationSeatFor, automationSystemPrompt, runAutomationTurn,
} from '../services/trade/automationTurn';
// The day cap comes from the ledger module, not from the turn that reads it: an
// import that does not exist resolves to `undefined` under vitest, and
// `plansToday >= undefined` is false — a cap test written against an undefined
// limit passes as "no cap" and proves nothing.
import { loadAutomationPlanCount, MAX_PLANS_PER_DAY } from '../services/automation/AutomationService';

vi.mock('../services/analysis/DeskToolsService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/DeskToolsService')>();
    return { ...actual, streamChatWithDeskTools: vi.fn() };
});
// The ledger is the one thing here that would otherwise be a Preferences read
// with a day boundary in it; the day logic has its own test below.
vi.mock('../services/automation/AutomationService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/automation/AutomationService')>();
    return {
        ...actual,
        loadAutomationPlanCount: vi.fn(async () => 0),
        recordAutomationPlan: vi.fn(async () => 1),
    };
});
// The notebook reads are exercised by `chatSurfacePrompt.test.ts`; here they
// would only add a storage dependency to a cap test.
vi.mock('../services/learning/SkillMemoryService', () => ({ listSkills: () => [] }));
vi.mock('../services/learning/strategyStore', () => ({ activeStrategiesBlock: () => '' }));
vi.mock('../services/learning/profileMemory', () => ({ buildProfileMemoryIndex: () => '' }));

const mockStream = vi.mocked(streamChatWithDeskTools);
const mockLedger = vi.mocked(loadAutomationPlanCount);

type Owned = {
    onToolEvent?: (line: string) => void;
    onToolPayload?: (payload: never) => void;
    onReasoning?: (chunk: string) => void;
    executePanelTool?: (call: never) => Promise<{ ok: boolean; content: string } | null>;
};

const PLAN_CALL = {
    id: 'c1', name: 'present_trade',
    arguments: { direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] },
};

type Step = { line?: string; failedTool?: string; plan?: boolean; text?: string };

/** Drive the fake transport: replay `steps`, capture every `present_trade`
 *  receipt, and hand back the options the turn actually passed — so a test can
 *  assert on the ALLOW-LIST the executor was given, not on a copy of it. */
const script = (steps: Step[]) => {
    const receipts: Array<{ ok: boolean; content: string } | null> = [];
    let seen: Record<string, unknown> = {};
    mockStream.mockImplementation((async function* (_c: unknown, _m: unknown, o: unknown) {
        const owned = o as Owned;
        seen = o as Record<string, unknown>;
        for (const s of steps) {
            if (s.line !== undefined) owned.onToolEvent?.(s.line);
            if (s.failedTool !== undefined) {
                owned.onToolPayload?.({ toolCallId: 'p1', name: s.failedTool, ok: false } as never);
            }
            if (s.plan) {
                receipts.push(await owned.executePanelTool?.(PLAN_CALL as never) ?? null);
            }
            if (s.text !== undefined) yield s.text;
        }
    }) as never);
    return { receipts, get options() { return seen; } };
};

const config = {
    id: 'p1', name: 'P1', selectedModel: 'm1', isEnabled: true, apiKey: 'k',
    baseUrl: 'https://x', apiFormat: 'chat_completions', models: ['m1'],
} as unknown as ProviderConfig;

const req = (over: Partial<Parameters<typeof runAutomationTurn>[0]> = {}) => ({
    config,
    history: [] as Message[],
    prompt: 'sweep BTC',
    trades: [],
    username: 'tester',
    automationId: 'a1',
    signal: new AbortController().signal,
    startedAt: Date.now() - 50,
    ...over,
});

beforeEach(() => {
    mockStream.mockReset();
    mockLedger.mockReset();
    mockLedger.mockResolvedValue(0);
});

describe('the schedule’s tool list is derived, not restated', () => {
    it('offers the market lookups and present_trade, and at least a score of names', () => {
        expect(AUTOMATION_TOOLS.length).toBeGreaterThanOrEqual(20);
        for (const tool of ['get_price_snapshot', 'get_market_packet', 'get_indicators', 'web_search', 'present_trade']) {
            expect(AUTOMATION_TOOLS).toContain(tool);
        }
    });

    it('offers NONE of the notebook-writing tools, and every denied name still exists', () => {
        for (const denied of AUTOMATION_UNATTENDED_DENY) {
            // A rename would drop a name from CHAT_SURFACE_TOOLS, and a filter
            // over a missing name silently UN-denies it — so the deny list is
            // only real if each entry is still something the surface offers.
            expect(CHAT_SURFACE_TOOLS, `${denied} is denied but no longer offered anywhere`).toContain(denied);
            expect(AUTOMATION_TOOLS, `${denied} reached a schedule`).not.toContain(denied);
        }
    });

    it('is exactly the Chat list minus the deny list', () => {
        expect(AUTOMATION_TOOLS).toEqual(CHAT_SURFACE_TOOLS.filter(t => !AUTOMATION_UNATTENDED_DENY.includes(t)));
    });
});

describe('a plan is rationed per run', () => {
    it('presents the first plan and REFUSES the second with ok:false', async () => {
        const s = script([{ line: 'get_market_packet calling…' }, { plan: true }, { plan: true }, { text: 'done' }]);
        const out = await runAutomationTurn(req());
        expect(MAX_PLANS_PER_RUN).toBe(1);
        expect(s.receipts[0]?.ok).toBe(true);
        expect(s.receipts[1]?.ok).toBe(false);
        expect(s.receipts[1]?.content).toMatch(/refused/i);
        expect(out.plansPresented).toBe(1);
        expect(out.refusedPlans).toBe(1);
        expect(out.proposal?.direction).toBe('Long');
        expect(out.notices.join('\n')).toMatch(/PLAN CAP REACHED/);
    });

    it('hands the executor the schedule’s allow-list, not the surface’s', async () => {
        const s = script([{ line: 'calling…' }, { text: 'x' }]);
        await runAutomationTurn(req());
        expect(s.options.allowedTools).toEqual(AUTOMATION_TOOLS);
        expect(s.options.allowedTools).not.toEqual(CHAT_SURFACE_TOOLS);
    });
});

describe('a plan is rationed per day', () => {
    it('refuses even the FIRST plan once the day is spent', async () => {
        // The limit must be a number this test can see: an import that does not
        // exist resolves to undefined under vitest, and `count >= undefined` is
        // false, so the test would pass by proving the cap never fires.
        expect(MAX_PLANS_PER_DAY).toBeGreaterThan(0);
        mockLedger.mockResolvedValue(MAX_PLANS_PER_DAY);
        const s = script([{ line: 'calling…' }, { plan: true }, { text: 'x' }]);
        const out = await runAutomationTurn(req());
        expect(s.receipts[0]?.ok).toBe(false);
        expect(s.receipts[0]?.content).toMatch(/per day/);
        expect(out.plansPresented).toBe(0);
        expect(out.refusedPlans).toBe(1);
        expect(mockLedger).toHaveBeenCalledWith('tester', 'a1');
    });
});

describe('a failure cannot look like a clean answer', () => {
    it('records a tool that came back with nothing and says so in a notice', async () => {
        script([{ line: 'calling get_order_book…' }, { failedTool: 'get_order_book' }, { text: 'Book is thin.' }]);
        const out = await runAutomationTurn(req());
        expect(out.failedTools).toEqual(['get_order_book']);
        expect(out.notices.join('\n')).toMatch(/TOOL FAILURE\(S\).*get_order_book/);
    });

    it('says NOTHING WAS LOOKED UP when the turn called no tool at all', async () => {
        script([{ text: 'BTC is probably fine.' }]);
        const out = await runAutomationTurn(req());
        expect(out.notices.join('\n')).toMatch(/NOTHING WAS LOOKED UP/);
    });

    it('does not shame a turn that did call something', async () => {
        script([{ line: 'calling get_price_snapshot…' }, { text: 'BTC 111,000.' }]);
        const out = await runAutomationTurn(req());
        expect(out.notices.join('\n')).not.toMatch(/NOTHING WAS LOOKED UP/);
    });

    it('keeps the tool feed capped at the same window the chat homes use', async () => {
        const steps = Array.from({ length: 11 }, (_, i) => ({ line: `calling… #${i}` }));
        script([...steps, { text: 'x' }]);
        const out = await runAutomationTurn(req());
        expect(out.toolLines.length).toBe(8);
        expect(out.toolLines[7]).toContain('#10');
    });
});

describe('the mandate a schedule carries', () => {
    it('forbids the notebook writes and the chart, and records no invented skills', () => {
        const prompt = automationSystemPrompt();
        expect(prompt.text).toMatch(/A SCHEDULED RUN, NOT A CONVERSATION/i);
        expect(prompt.text).toMatch(/ONE PLAN, RATIONED/i);
        expect(prompt.text).toMatch(/YOU MAY NOT EDIT THE NOTEBOOK/i);
        expect(prompt.skills).toEqual([]);
    });
});

describe('which model answers a scheduled run', () => {
    const ready = (id: string, models: string[], selected: string): ProviderConfig => ({
        id, name: id, isEnabled: true, apiKey: 'k', baseUrl: 'https://x',
        apiFormat: 'chat_completions', models, selectedModel: selected,
    } as unknown as ProviderConfig);
    const disabled = (id: string, models: string[]): ProviderConfig => ({
        ...ready(id, models, models[0]), isEnabled: false,
    });

    it('takes the config’s own decider pick', () => {
        const p = ready('p1', ['m1', 'm2'], 'm1');
        expect(automationSeatFor(p, 'm2', [], [p])).toEqual({ config: expect.objectContaining({ selectedModel: 'm2' }), model: 'm2' });
    });

    it('falls back to the provider’s selection when the named model is gone', () => {
        const p = ready('p1', ['m1'], 'm1');
        const seat = automationSeatFor(p, 'deleted-model', [], [p]);
        expect(seat?.model).toBe('m1');
    });

    it('walks the config’s analyst picks when the decider provider is not ready', () => {
        const dead = disabled('p1', ['m1']);
        const live = ready('p2', ['m9'], 'm9');
        const seat = automationSeatFor(dead, 'm1', [{ providerId: 'p1', model: 'm1' }, { providerId: 'p2', model: 'm9' }], [dead, live]);
        expect(seat?.config.id).toBe('p2');
        expect(seat?.model).toBe('m9');
    });

    it('returns null rather than answering on a model the trader never picked', () => {
        const dead = disabled('p1', ['m1']);
        expect(automationSeatFor(dead, 'm1', [{ providerId: 'p1', model: 'm1' }], [dead])).toBeNull();
    });
});
