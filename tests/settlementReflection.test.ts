/**
 * E-57 §1 — the closed-trade reflection.
 *
 * One bounded model call at settlement, whose text becomes `trade.postMortem`.
 * What this file pins, in order:
 *  - the packet is the ROW, and says so when a fact is missing (never a silent
 *    hole a model then fills in);
 *  - the note it writes is READABLE by the two live consumers — the diary
 *    lesson extractor and the IF/THEN clause parser — because that readability
 *    is the whole reason the leg exists;
 *  - the craft leg stops declining (`craftSkillFromPostMortem` returns a skill
 *    instead of `null`) on a trade settled with a reflection;
 *  - every path that must write NOTHING writes nothing: a trader's own note, an
 *    unfillable row, no provider, a decline, a malformed answer, a throw, and a
 *    re-fired settlement.
 *
 * The budget and the tier are asserted too: this call is only permitted because
 * it is bounded, so the bound is part of the contract, not an implementation
 * detail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

// The transport, mocked whole. `calls` records what the ONE permitted call was
// asked for, which is what the budget assertions read.
const { calls, transport } = vi.hoisted(() => ({
    calls: [] as Array<{ system: string; user: string; opts: Record<string, unknown> }>,
    transport: { reply: '{"noLesson":true}' as string | Error },
}));
vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatRequest: vi.fn(async (_config: unknown, messages: Array<{ role: string; content: string }>, opts: Record<string, unknown>) => {
        calls.push({ system: messages[0].content, user: messages[1].content, opts });
        if (transport.reply instanceof Error) throw transport.reply;
        return transport.reply;
    }),
    getQuickResponse: vi.fn(async () => JSON.stringify({
        name: 'Failed sweep short', description: 'Do not short a swept low that reclaims. Use when a short entry sits under a reclaimed sweep. Do NOT use for a break-and-hold short.',
        kind: 'avoid', when: 'a swept low closes back above its origin', inputs: ['price'],
        steps: ['wait for the reclaim close'], validate: 'the close is above', output: 'skip the short',
        approval: 'before any size change', ifCondition: 'BTC sweeps the prior low but the candle closes back above it',
        thenAction: 'Do not short — the failed sweep removes downside conviction',
    })),
}));

vi.mock('../services/infrastructure/ProviderConfigService', () => ({
    loadProviderConfigs: vi.fn(async () => store.__providers ?? []),
    getReadyProviders: (configs: Array<{ isEnabled?: boolean; apiKey?: string }>) =>
        configs.filter(c => c.isEnabled && !!c.apiKey?.trim()),
    getFirstReadyProvider: (configs: unknown[]) => (configs as unknown[])[0] ?? null,
}));
vi.mock('../services/infrastructure/dbService', () => ({
    getUserProfile: vi.fn(async () => null),
}));

import {
    reflectOnClosedTrade, reflectionPacket, renderPostMortem,
    __resetReflectedTradesForTests, SETTLEMENT_REFLECTION_FALLBACK,
} from '../services/learning/settlementReflection';
import { craftSkillFromPostMortem } from '../services/learning/SkillCraftService';
import { extractLessonFromPostMortem } from '../services/learning/MemoryFilesService';
import { parseIfThenClauses } from '../utils/ifThenSkill';
import { TASK_BUDGETS } from '../services/providers/taskBudgets';
import { effortForTask } from '../services/providers/reasoningControls';
import { TradeOutcome } from '../types';
import type { LoggedTrade, ProviderConfig, TradeAnalysis } from '../types';

const USER = 'reflection-user';
const readyConfig = {
    id: 'prov-mem', name: 'Memory', apiKey: 'k', baseUrl: 'https://x/v1',
    apiFormat: 'chat_completions' as const, isEnabled: true, isBuiltIn: false,
    models: ['gpt-x'], selectedModel: 'gpt-x',
};

const GOOD_ANSWER = JSON.stringify({
    whatHappened: 'The short was entered at 100 with the stop at 105 and never reached a target; the gross move closed at -1.0R and the round trip took a further 0.02R, so the plan lost on its stop distance rather than on its direction.',
    lesson: 'A short whose stop sits 5% above entry spends too much risk to survive a reclaim; size the stop to the sweep, not to the round number.',
    ifCondition: 'a short entry sits below a prior low whose reclaim would close above the stop',
    thenAction: 'wait for the reclaim to fail before entering, or skip the setup',
});

const trade = (over: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: 't-1',
    analysis: {
        coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A',
        strategy: 'Fade the sweep of the prior daily low, stop above the swing high.',
        entryPoints: [{ price: '100' }], stopLoss: '105', takeProfit: [{ price: '90' }],
    } as unknown as TradeAnalysis,
    outcome: TradeOutcome.LOSS,
    timestamp: new Date().toISOString(),
    realizedR: -1, rSource: 'autopilot', costR: 0.02, netR: -1.02, slippageModeled: false,
    maxAdverseExcursion: 4.1, maxFavorableExcursion: 0.3, excursionSource: 'autopilot',
    marketRegime: 'ranging', marketRegimeSource: 'snapshot',
    resolutionSource: 'autopilot',
    ...over,
});

const ask = (t = trade()) => reflectOnClosedTrade(t, { username: USER });

beforeEach(() => {
    store = { __providers: [readyConfig] };
    calls.length = 0;
    transport.reply = GOOD_ANSWER;
    __resetReflectedTradesForTests();
    localStorage.clear();
});

describe('reflectOnClosedTrade — the call it makes', () => {
    it('writes the reflection onto the row, with the model that wrote it', async () => {
        const out = await ask();
        expect(out.wrote).toBe(true);
        expect(out.reason).toBe('written');
        expect(out.trade.postMortem).toContain('Lesson:');
        expect(out.trade.postMortem!.length).toBeGreaterThanOrEqual(40);
        expect(out.trade.postMortemModel).toBe('gpt-x');
        expect(Date.parse(out.trade.postMortemCreatedAt!)).not.toBeNaN();
        // Exactly ONE call — the whole point of the waiver.
        expect(calls).toHaveLength(1);
    });

    it('spends the post-mortem budget and the post-mortem tier', async () => {
        await ask();
        const { opts } = calls[0];
        expect(opts.maxTokens).toBe(TASK_BUDGETS.postMortem);
        expect(opts.temperature).toBe(0.2);
        // The tier is the distinction that actually exists here: `postMortem`
        // and `chat` share the 8192 budget, so a call that asked for the chat
        // tier would look identical in the token count and think differently.
        const tier = effortForTask('postMortem');
        expect(opts.reasoningEffort).toBe(tier);
        expect(tier).not.toBe(effortForTask('chat'));
    });

    it('hands the model the row it is judging: R, cost, net, excursion, benchmark, regime, gate', async () => {
        await ask();
        const packet = calls[0].user;
        expect(packet).toContain('BTCUSDT');
        expect(packet).toContain('-1R gross (price-measured, by the autopilot)');
        expect(packet).toContain('0.02R round-trip cost — slippage is NOT modelled');
        expect(packet).toContain('-1.02R net after cost');
        expect(packet).toContain('max adverse 4.1% · max favorable 0.3%');
        expect(packet).toContain('ranging (snapshot)');
        // The waiver's promise is "only what the row carries": the packet says
        // what it was NOT told, so a model cannot be blamed for a hole.
        expect(packet).toContain('benchmark alpha: never measured');
        expect(packet).toContain('pre-trade gate: never ran');
    });

    it('carries E-57 §5 through: a refused plan and its cautions reach the model', async () => {
        const gated = trade({
            analysis: {
                ...(trade().analysis as unknown as Record<string, unknown>),
                gate: {
                    status: 'evaluated', confidenceCap: 0.5, reason: '50% cap',
                    stampedAt: new Date().toISOString(),
                    refusal: 'levels are inverted for a Short plan',
                    warnings: ['TIGHT STOP: Stop loss (1.00) is tighter than 1x ATR (4.00).'],
                },
            } as unknown as TradeAnalysis,
        });
        await ask(gated);
        expect(calls[0].user).toContain('REFUSED: levels are inverted for a Short plan');
        expect(calls[0].user).toContain('cautions: TIGHT STOP');
    });

    it('clips a long plan text and names how much it kept', async () => {
        const long = trade({
            analysis: {
                ...(trade().analysis as unknown as Record<string, unknown>),
                strategy: 'x'.repeat(900),
            } as unknown as TradeAnalysis,
        });
        await ask(long);
        expect(calls[0].user).toContain('first 600 of 900 chars');
        expect(calls[0].user).toContain('MISSING, not absent');
    });

    it('asks under the registered prompt, and under the trader’s override when there is one', async () => {
        await ask(trade({ id: 't-lane-a' }));
        expect(calls[0].system).toBe(SETTLEMENT_REFLECTION_FALLBACK);
        // The id is real in the registry, so Settings can edit what this call
        // actually sends — the identity the registry header promises.
        const { savePromptOverride, initPromptOverrides, resetPromptOverride } = await import('../services/infrastructure/PromptOverrideService');
        await savePromptOverride('learning.settlement_reflection', 'CUSTOM REFLECTION TEXT', USER);
        await initPromptOverrides(USER);
        __resetReflectedTradesForTests();
        await ask(trade({ id: 't-lane-b' }));
        expect(calls[1].system).toBe('CUSTOM REFLECTION TEXT');
        await resetPromptOverride('learning.settlement_reflection', USER);
        await initPromptOverrides(USER);
    });
});

describe('reflectOnClosedTrade — the paths that write nothing', () => {
    it('a trader’s own note always wins, and no call is spent on it', async () => {
        const own = trade({ postMortem: 'I chased the wick and moved my stop twice. My lesson, my words, longer than forty.' });
        const out = await ask(own);
        expect(out.wrote).toBe(false);
        expect(out.reason).toBe('already-written');
        expect(out.trade.postMortem).toBe(own.postMortem);
        expect(calls).toHaveLength(0);
    });

    it('an entry that never filled is not asked, because the notebook could not use the answer', async () => {
        const out = await ask(trade({ outcome: TradeOutcome.ENTRY_NOT_HIT }));
        expect(out.wrote).toBe(false);
        expect(out.reason).toBe('not-a-lesson-row');
        expect(calls).toHaveLength(0);
    });

    it('an execution slip or a macro shock is not turned into a technical rule', async () => {
        const slip = await ask(trade({ rootCauseClass: 'EXECUTION_ERROR' }));
        expect(slip.reason).toBe('not-a-lesson-row');
        const shock = await ask(trade({ id: 't-3', rootCauseClass: 'MACRO_SHOCK' }));
        expect(shock.reason).toBe('not-a-lesson-row');
        expect(calls).toHaveLength(0);
    });

    it('control: a row with NO root-cause class is still asked — the guard never starves the leg', async () => {
        // Without this arm every case above could pass on a predicate that
        // refuses everything, which is precisely how the leg starved the first
        // time (an empty post-mortem classifies UNCLEAR, and UNCLEAR admits).
        const out = await ask();
        expect(out.wrote).toBe(true);
    });

    it('no ready provider means no call, and the row comes back untouched', async () => {
        store.__providers = [];
        const out = await ask();
        expect(out.wrote).toBe(false);
        expect(out.reason).toBe('no-provider');
        expect(out.trade.postMortem).toBeUndefined();
        expect(calls).toHaveLength(0);
    });

    it('a no-provider miss does not spend the session’s one attempt', async () => {
        // The guard exists to stop a re-fired settlement asking twice, not to
        // punish a row that was settled before the trader configured a model.
        // Spending no call must spend no attempt.
        store.__providers = [];
        expect((await ask()).reason).toBe('no-provider');
        store.__providers = [readyConfig];
        const second = await ask();
        expect(second.wrote).toBe(true);
    });

    it('a declined answer writes nothing — a gap beats a rule that was never earned', async () => {
        transport.reply = '{"noLesson": true}';
        const out = await ask();
        expect(out.wrote).toBe(false);
        expect(out.reason).toBe('declined-or-malformed');
        expect(out.trade.postMortem).toBeUndefined();
    });

    it('a malformed answer writes nothing', async () => {
        transport.reply = 'I think the trader should be more careful.';
        const out = await ask();
        expect(out.wrote).toBe(false);
        expect(out.reason).toBe('declined-or-malformed');
    });

    it('an answer whose clause is too short to be a claim is refused by the schema', async () => {
        transport.reply = JSON.stringify({ ...JSON.parse(GOOD_ANSWER), ifCondition: 'tight' });
        const out = await ask();
        expect(out.wrote).toBe(false);
    });

    it('a throwing transport leaves the leg exactly as it was today', async () => {
        transport.reply = new Error('429 rate limited');
        const out = await ask();
        expect(out.wrote).toBe(false);
        expect(out.reason).toBe('failed');
        expect(out.trade.postMortem).toBeUndefined();
    });

    it('a re-fired settlement does not spend a second call', async () => {
        const first = await ask();
        const again = await ask();
        expect(first.wrote).toBe(true);
        expect(again.wrote).toBe(false);
        expect(again.reason).toBe('in-flight');
        expect(calls).toHaveLength(1);
    });

    it('the guard is keyed per user, so two profiles with the same trade id are each asked', async () => {
        await reflectOnClosedTrade(trade(), { username: 'user-a' });
        const other = await reflectOnClosedTrade(trade(), { username: 'user-b' });
        expect(other.wrote).toBe(true);
        expect(calls).toHaveLength(2);
    });
});

describe('the note the reflection writes is readable by the leg it exists to feed', () => {
    it('the diary finds the Lesson line, and the clause parser finds the IF/THEN', async () => {
        const out = await ask();
        const note = out.trade.postMortem!;
        expect(extractLessonFromPostMortem(note)).toContain('size the stop to the sweep');
        const clauses = parseIfThenClauses(note);
        expect(clauses).toHaveLength(1);
        expect(clauses[0].ifCondition).toContain('reclaim');
        expect(clauses[0].thenAction).toContain('wait for the reclaim to fail');
    });

    it('names the app as the author in the text itself, and the reader still finds the lesson', () => {
        const rendered = renderPostMortem({
            whatHappened: 'A plain paragraph about the stop distance.',
            lesson: 'size the stop to the sweep, not to the round number',
            ifCondition: 'the reclaim closes above the swept low',
            thenAction: 'skip the short entry',
        }, 'gpt-x');
        expect(rendered.split('\n')[0]).toContain('written by the app');
        expect(rendered.split('\n')[0]).toContain('gpt-x');
        // The provenance line is prose, not a title, so the lesson extractor's
        // title-skipping rule cannot eat the note — and cannot mistake this line
        // for the lesson either.
        expect(extractLessonFromPostMortem(rendered)).toContain('size the stop to the sweep');
    });

    it('craftSkillFromPostMortem stops declining on a settled trade', async () => {
        // The starved leg, from the outside: it has always been called, and it
        // has always returned null because `postMortem.length < 40`.
        const noNote = await craftSkillFromPostMortem(trade(), readyConfig as unknown as ProviderConfig);
        expect(noNote).toBeNull();
        const out = await ask();
        const crafted = await craftSkillFromPostMortem(out.trade, readyConfig as unknown as ProviderConfig);
        expect(crafted).not.toBeNull();
        expect(crafted!.ifCondition).toContain('sweeps the prior low');
    });
});

/** The call-site scan, as a predicate over code lines only. Shape rather than
 *  layout: the ordering IS the bug this item fixes, and a reflection that ran
 *  after `syncClosedTradeToNotebook` would be invisible to every behaviour test
 *  in this file, because the notebook guard marks the trade settled on the first
 *  call and the diary reads the row it was handed. */
const reflectsBeforeTheNotebookFolds = (code: string): boolean => {
    const reflectAt = code.indexOf('await reflectOnClosedTrade(');
    const syncAt = code.indexOf('await syncClosedTradeToNotebook(');
    // The row the notebook is handed must be the reflected one. The call site
    // keeps a fallback (`settledTrade = loggedTrade`) so a reflection that
    // unexpectedly throws cannot cost the diary; the assignment from the
    // result is what proves the normal path carries the note.
    const carriesTheReflection = /settledTrade\s*=\s*reflection\.trade;/.test(code)
        && /syncClosedTradeToNotebook\(\s*settledTrade,/.test(code);
    return reflectAt > -1 && syncAt > reflectAt && carriesTheReflection;
};

describe('the settlement call site', () => {
    const src = readFileSync('hooks/useTradeLogging.ts', 'utf8');
    // Comments legitimately name what they are explaining — including a deleted
    // ordering — so the scan reads code lines. (The lesson this repo has now
    // learned four times in three days.)
    const code = src.split('\n')
        .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');

    it('awaits the reflection before the notebook folds the trade, and hands it the reflected row', () => {
        expect(reflectsBeforeTheNotebookFolds(code)).toBe(true);
    });

    it('writes the reflection back onto the journal row', () => {
        expect(code).toMatch(/setLoggedTrades\(prev => prev\.map\(t => t\.id === reflected\.id \? reflected : t\)\)/);
    });

    it('reach control: a comment naming the call is not wiring', () => {
        // The planted bad artifact. A scan that passes on this would pass on a
        // file that only TALKS about the reflection — the exact false green that
        // a dead-but-documented leg produces.
        const commented = [
            '// we await reflectOnClosedTrade(x) and then',
            'await syncClosedTradeToNotebook(loggedTrade,',
            '    trades, user);',
        ].join('\n');
        expect(reflectsBeforeTheNotebookFolds(commented)).toBe(false);
        // …and the real file's own commentary cannot be what satisfies the pin:
        // strip the code and the predicate must fail on the comments alone.
        const commentsOnly = src.split('\n')
            .filter(line => line.trim().startsWith('//') || line.trim().startsWith('*'))
            .join('\n');
        expect(reflectsBeforeTheNotebookFolds(commentsOnly)).toBe(false);
    });
});
