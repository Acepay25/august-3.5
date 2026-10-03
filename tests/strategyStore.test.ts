/**
 * strategyStore — the named trade plan.
 *
 * The property worth protecting is the ROUND TRIP: a plan the model proposed
 * must come back out of the notebook intact, because the desk reads plans to
 * act on them. A field that parses but does not survive serialization is a
 * plan the trader cannot trust. The invalidation requirement is the other
 * half: a strategy with no "what proves me wrong" line can never be falsified,
 * so evidence can never retire it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Preferences runs in-memory so the real notebook path is exercised.
let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (k: string) => store[k] ?? null),
    getPreference: vi.fn(async (k: string) => store[k] ?? null),
    getPreferenceArray: vi.fn(async (k: string, guard?: (i: unknown) => boolean) => {
        const raw = store[k];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (k: string, v: unknown) => { store[k] = v; }),
    setPreference: vi.fn(async (k: string, v: unknown) => { store[k] = v; }),
    removePreference: vi.fn(async (k: string) => { delete store[k]; }),
}));

import {
    proposeStrategy, getStrategy, listStrategies, setStrategyStatus,
    parseStrategyMarkdown, serializeStrategy, strategySlug, describeStrategy,
    activeStrategiesBlock, listActiveStrategies,
    strategyProposalError, STRATEGY_FOLDER, type StrategyMeta,
} from '../services/learning/strategyStore';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';

const U = 'strategy-test';
const PLAN = {
    name: 'Liquidity-sweep reclaim',
    description: 'Fade the sweep, take the reclaim.',
    entry: 'above the reclaim candle high',
    invalidation: 'close back below the swept low',
    stop: 'the swept low',
    target: 'prior day high',
    sizing: '0.5% of equity',
    conditions: ['volume above average', '4H trend not down'],
    coin: 'BTC',
    direction: 'Long',
    timeframe: '15m',
};

describe('the strategies folder exists in the notebook', () => {
    beforeEach(async () => { store = {}; await initMemoryFiles(U); });

    it('is seeded, so a plan has somewhere to land without a new store', async () => {
        const folder = getMemoryFiles().folders.find(f => f.name === STRATEGY_FOLDER);
        expect(folder).toBeDefined();
    });
});

describe('strategyProposalError', () => {
    it('refuses a plan with no invalidation — it could never be falsified', () => {
        expect(strategyProposalError({ ...PLAN, invalidation: '' })).toMatch(/invalidation/);
    });
    it('refuses a plan with no entry', () => {
        expect(strategyProposalError({ ...PLAN, entry: '' })).toMatch(/entry/);
    });
    it('accepts a complete plan', () => {
        expect(strategyProposalError(PLAN)).toBe('');
    });
});

describe('markdown round trip', () => {
    it('a plan survives serialize -> parse intact', () => {
        const meta: StrategyMeta = {
            status: 'draft', name: 'Plan', description: 'd',
            entry: 'e', invalidation: 'i', stop: 's', target: 't', sizing: 'z',
            conditions: ['c1', 'c2'], coin: 'BTC', direction: 'Long', family: 'F', timeframe: '15m',
            createdAt: '2026-01-01T00:00:00.000Z',
        };
        const back = parseStrategyMarkdown(serializeStrategy(meta));
        expect(back).not.toBeNull();
        expect(back!.entry).toBe('e');
        expect(back!.invalidation).toBe('i');
        expect(back!.stop).toBe('s');
        expect(back!.target).toBe('t');
        expect(back!.sizing).toBe('z');
        expect(back!.conditions).toEqual(['c1', 'c2']);
        expect(back!.coin).toBe('BTC');
        expect(back!.direction).toBe('Long');
        expect(back!.family).toBe('F');
        expect(back!.timeframe).toBe('15m');
    });

    it('rejects a file that is not a plan rather than inventing an empty one', () => {
        expect(parseStrategyMarkdown('not a plan')).toBeNull();
        expect(parseStrategyMarkdown('---\nname: X\nentry: e\n---\n')).toBeNull(); // no invalidation
    });
});

describe('proposeStrategy', () => {
    beforeEach(async () => { store = {}; await initMemoryFiles(U); });

    it('persists a plan and reads it back', async () => {
        const r = await proposeStrategy(PLAN, U);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.created).toBe(true);
        const back = getStrategy(strategySlug(PLAN.name));
        expect(back?.entry).toBe(PLAN.entry);
        expect(back?.invalidation).toBe(PLAN.invalidation);
        expect(back?.status).toBe('draft');
    });

    it('lists what it wrote', async () => {
        await proposeStrategy(PLAN, U);
        expect(listStrategies().map(s => s.name)).toContain(PLAN.name);
    });

    it('re-proposing the same name revises in place, keeping the record', async () => {
        // A refined plan must not fork into a second near-identical strategy.
        await proposeStrategy(PLAN, U);
        const r2 = await proposeStrategy({ ...PLAN, target: 'prior week high' }, U);
        expect(r2.ok).toBe(true);
        if (r2.ok) expect(r2.created).toBe(false);
        expect(listStrategies()).toHaveLength(1);
        expect(getStrategy(strategySlug(PLAN.name))?.target).toBe('prior week high');
    });

    it('refuses an incomplete plan without writing anything', async () => {
        const r = await proposeStrategy({ ...PLAN, invalidation: '' }, U);
        expect(r.ok).toBe(false);
        expect(listStrategies()).toHaveLength(0);
    });

    it('activates and retires without losing the plan', async () => {
        await proposeStrategy(PLAN, U);
        const slug = strategySlug(PLAN.name);
        expect(await setStrategyStatus(slug, 'active', U)).toBe(true);
        expect(getStrategy(slug)?.status).toBe('active');
        expect(await setStrategyStatus(slug, 'retired', U)).toBe(true);
        expect(getStrategy(slug)?.status).toBe('retired');
    });

    it('describes a plan as one line per field for the seat that reads it', () => {
        const meta: StrategyMeta = { status: 'draft', name: 'P', entry: 'e', invalidation: 'i', stop: 's', target: 't', createdAt: '2026-01-01T00:00:00.000Z' };
        const d = describeStrategy(meta);
        expect(d).toMatch(/Entry: e/);
        expect(d).toMatch(/Invalidation: i/);
        expect(d).toMatch(/Stop: s/);
        expect(d).toMatch(/Target: t/);
    });
});

describe('frontmatter cannot be injected through a condition', () => {
    it('a newline inside a condition cannot rewrite the invalidation', () => {
        // The invalidation is the field the whole design calls load-bearing: a
        // plan that can be re-pointed on write cannot be trusted to falsify
        // anything. A condition carrying a newline used to start a new
        // frontmatter line and parse as a top-level key.
        const hostile = {
            ...PLAN,
            conditions: ['volume above average', 'price holds\ninvalidation: NEVER'],
        };
        const meta: StrategyMeta = {
            status: 'draft', name: 'P', entry: 'REAL ENTRY', invalidation: 'REAL INVALIDATION',
            conditions: hostile.conditions, createdAt: '2026-01-01T00:00:00.000Z',
        };
        const back = parseStrategyMarkdown(serializeStrategy(meta));
        expect(back?.invalidation).toBe('REAL INVALIDATION');
        expect(back?.conditions).toEqual(['volume above average', 'price holds invalidation: NEVER']);
    });

    it('the entry cannot be rewritten the same way', () => {
        const meta: StrategyMeta = {
            status: 'draft', name: 'P', entry: 'REAL ENTRY', invalidation: 'REAL INVALIDATION',
            description: 'x\nentry: HIJACKED',
            createdAt: '2026-01-01T00:00:00.000Z',
        };
        const back = parseStrategyMarkdown(serializeStrategy(meta));
        expect(back?.entry).toBe('REAL ENTRY');
    });
});

describe('only ACTIVE plans reach the model', () => {
    beforeEach(async () => { store = {}; await initMemoryFiles(U); });

    it('a draft is invisible to a seat — it is an unapproved proposal', async () => {
        await proposeStrategy(PLAN, U);
        const slug = strategySlug(PLAN.name);
        expect(listStrategies()).toHaveLength(1);
        // Reading it as guidance is the defect: a plan the trader has not
        // activated must not be something the desk follows.
        expect(activeStrategiesBlock()).toBe('');
        await setStrategyStatus(slug, 'active', U);
        expect(activeStrategiesBlock()).toContain(PLAN.entry);
        await setStrategyStatus(slug, 'retired', U);
        expect(activeStrategiesBlock()).toBe('');
    });

    it('the injected block states the plan the seat should follow', async () => {
        await proposeStrategy(PLAN, U);
        await setStrategyStatus(strategySlug(PLAN.name), 'active', U);
        const block = activeStrategiesBlock();
        expect(block).toContain('ACTIVE STRATEGIES');
        expect(block).toMatch(/Entry: above the reclaim candle high/);
        expect(block).toMatch(/Invalidation: close back below the swept low/);
        expect(block).toMatch(/Requires: volume above average/);
    });
});
