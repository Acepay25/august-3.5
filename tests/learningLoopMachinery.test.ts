import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Machinery tests for the learning-loop falsification batch:
 *   1. REGIME GATING — the strict matcher's direction+regime lane only fires
 *      when a regime is present; enforcement without regime is unchanged.
 *   2. VETO LEDGER — vetoes are recorded with would-be TP/SL and settle to
 *      WOULD_TP (veto blocked a winner → counts against) / WOULD_SL
 *      (vindicated) / EXPIRED; accuracy rollups aggregate per skill.
 *   3. SEQUENTIAL EVALS — one 'hurts' run does NOT demote a confirmed skill;
 *      a second consecutive 'hurts' does (ledger-stamped); 'helps' resets.
 *   4. CONTROL ATTRIBUTION — matched-but-not-injected trades land in
 *      controlIds instead of half-counting into wins/losses.
 */

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

// No memory model configured anywhere in this suite — refinement LLM phases
// are skipped so the code paths under test exercise pure bookkeeping.
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));

import {
    skillStrictlyMatchesSetup,
    applySkillEvidence,
    parseSkillMarkdown,
    serializeSkill,
    titleFromMeta,
    applyReviewRecommendation,
    applyNotebookSkillsToAnalysis,
    MIN_SAMPLE_FOR_VETO,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';
import { initMemoryFiles, createMemoryFile, getMemoryFiles, updateMemoryFile } from '../services/learning/MemoryFilesService';
import { recordEvalVerdict, evaluateSkill } from '../services/learning/SkillEvalService';
import { setPreferenceObject } from '../services/infrastructure/PreferencesService';
import type { ProviderConfig } from '../types/provider';
import type { LoggedTrade, TradeAnalysis, TradeOutcome } from '../types';

const USER = 'round40-user';

const readMeta = (fileId: string): SkillMeta =>
    parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === fileId)!.content)!;

const makeTrade = (id: string, outcome: TradeOutcome, overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Short',
        detectedPatternFamily: 'Family A',
        entryPoints: [{ price: 100 }],
        stopLoss: 105,
        takeProfit: [{ price: 90 }],
    } as unknown as TradeAnalysis,
    outcome,
    timestamp: new Date(Date.now() - 5000).toISOString(),
    ...overrides,
});

const seedSkill = async (name: string, frontmatter = ''): Promise<string> => {
    await initMemoryFiles(USER);
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const file = await createMemoryFile(skills.id, name, `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
wins: 1
losses: 6
ifCondition: BTC short setup
thenAction: skip the short
tradeIds: a,b,c
${frontmatter}---

# Avoid BTC short

**When:** BTC short setup
**What I do:** skip.
`, USER, true);
    return file.id;
};

/** Seed injection telemetry claiming `fileName` WAS injected just now —
 *  evidence trades then take the injected (full-credit) path, which is the
 *  path that runs deriveStatus. */
const seedInjection = (fileName: string): void => {
    store[`memory_injections_v1_${USER}`] = [{
        ts: new Date().toISOString(),
        stage: 'opening',
        audience: 'analyst',
        coin: 'BTCUSDT',
        sources: [{ path: `skills/${fileName}`, kind: 'skill' }],
    }];
};

// ─── 1. Regime gating ───────────────────────────────────────────────────────

describe('regime-conditional strict matching', () => {
    const meta = (): SkillMeta => ({
        kind: 'avoid',
        status: 'confirmed',
        body: 'skip',
        wins: 1,
        losses: 6,
        consecutiveLosses: 0,
        tradeIds: [],
        direction: 'Short',
        regime: 'trending',
    });

    it('direction+regime overlap matches ONLY when both sides carry a regime', () => {
        // Both regimes present and equal → the third lane fires.
        expect(skillStrictlyMatchesSetup(meta(), { direction: 'Short', regime: 'trending' })).toBe(true);
        // Different regime → no lane fires.
        expect(skillStrictlyMatchesSetup(meta(), { direction: 'Short', regime: 'ranging' })).toBe(false);
        // No regime on the setup → the lane can never fire (legacy behavior).
        expect(skillStrictlyMatchesSetup(meta(), { direction: 'Short' })).toBe(false);
        // No regime on the SKILL → same.
        expect(skillStrictlyMatchesSetup({ ...meta(), regime: undefined }, { direction: 'Short', regime: 'trending' })).toBe(false);
    });

    it('coin match still wins regardless of regime mismatch (primary scope)', () => {
        const withCoin = { ...meta(), coin: 'BTCUSDT' };
        expect(skillStrictlyMatchesSetup(withCoin, { coin: 'BTCUSDT', regime: 'ranging' })).toBe(true);
        // And the family lane is regime-independent too.
        const withFamily = { ...meta(), family: 'Family A' };
        expect(skillStrictlyMatchesSetup(withFamily, { family: 'Family A', direction: 'Long', regime: 'ranging' })).toBe(true);
    });
});

// ─── 2. Veto ledger ─────────────────────────────────────────────────────────

// Price feed is mocked at the module boundary (hoisted by vitest) — no
// sockets anywhere. `priceState.current` is the mutable knob tests turn;
// tracked/untracked record feed-claim calls; `tick` captures the price-tick
// subscriber so tests can fire a tick deterministically.
const priceState: {
    current: number | undefined;
    tracked: string[];
    untracked: string[];
    tick: (() => void) | null;
} = { current: undefined, tracked: [], untracked: [], tick: null };
vi.mock('../services/ui/PriceAlertService', () => ({
    PriceAlertService: {
        normalizeSymbol: (c: string) => c.toUpperCase(),
        trackSymbol: (s: string) => { priceState.tracked.push(s); return true; },
        untrackSymbol: (s: string) => { priceState.untracked.push(s); return false; },
        acquireMonitor: () => () => {},
        subscribePrices: (cb: () => void) => { priceState.tick = cb; return () => {}; },
        getCurrentPrice: () => priceState.current,
    },
}));

describe('veto falsification ledger', () => {
    beforeEach(() => {
        store = {};
        priceState.current = undefined;
        priceState.tracked = [];
        priceState.untracked = [];
        priceState.tick = null;
    });

    async function freshLedger() {
        const mod = await import('../services/ui/VetoLedgerService');
        mod.VetoLedgerService.resetForTest();
        return mod.VetoLedgerService;
    }

    it('a veto that would have hit TP settles WOULD_TP and counts against the skill', async () => {
        const ledger = await freshLedger();
        const rec = await ledger.recordVeto({
            username: USER,
            skill: {} as SkillMeta,
            skillName: 'btc-short-avoid.md',
            coinName: 'BTCUSDT',
            direction: 'Long',
            entryPrice: 100,
            takeProfits: [{ price: 110 }],
            stopLoss: 95,
        });
        expect(rec?.outcome).toBe('PENDING');

        priceState.current = 111; // would-have-been TP touched
        await ledger.evaluateVetoes(USER);

        const all = await ledger.getAll(USER);
        expect(all[0].outcome).toBe('WOULD_TP');
        const acc = await ledger.getAccuracyBySkill(USER);
        expect(acc['btc-short-avoid.md']).toEqual({ hits: 0, runs: 1, pending: 0 });
    });

    it('a veto whose stop would have been hit settles WOULD_SL (vindicated)', async () => {
        const ledger = await freshLedger();
        await ledger.recordVeto({
            username: USER,
            skill: {} as SkillMeta,
            skillName: 'btc-short-avoid.md',
            coinName: 'BTCUSDT',
            direction: 'Long',
            entryPrice: 100,
            takeProfits: [{ price: 110 }],
            stopLoss: 95,
        });
        priceState.current = 94; // would-have-been SL touched first (conservative)
        await ledger.evaluateVetoes(USER);
        const acc = await ledger.getAccuracyBySkill(USER);
        expect(acc['btc-short-avoid.md']).toEqual({ hits: 1, runs: 0, pending: 0 });
    });

    it('an untouched veto expires after the window', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));
            const ledger = await freshLedger();
            const rec = await ledger.recordVeto({
                username: USER,
                skill: {} as SkillMeta,
                skillName: 'x.md',
                coinName: 'BTCUSDT',
                direction: 'Long',
                entryPrice: 100,
                takeProfits: [{ price: 110 }],
                stopLoss: 95,
            });
            expect(rec?.outcome).toBe('PENDING');
            // Jump past the 7-day expiry with the price never moving.
            vi.setSystemTime(new Date('2026-08-20T00:00:00Z'));
            priceState.current = 100;
            await ledger.evaluateVetoes(USER);
            expect((await ledger.getAll(USER))[0].outcome).toBe('EXPIRED');
        } finally {
            vi.useRealTimers();
        }
    });

    it('settles each veto exactly once — later passes must NOT re-release the symbol', async () => {
        const ledger = await freshLedger();
        await ledger.recordVeto({
            username: USER,
            skill: {} as SkillMeta,
            skillName: 'btc-short-avoid.md',
            coinName: 'BTCUSDT',
            direction: 'Long',
            entryPrice: 100,
            takeProfits: [{ price: 110 }],
            stopLoss: 95,
        });
        expect(priceState.tracked).toEqual(['BTCUSDT']);

        priceState.current = 111;
        await ledger.evaluateVetoes(USER);
        expect(priceState.untracked).toEqual(['BTCUSDT']); // released once on settle

        // Regression: the old release logic recomputed "tracked but idle"
        // from ALL records on every tick and untracked already-settled
        // symbols again — decrementing refcounts owned by other consumers
        // (setup watches, fresh vetoes) and dropping their feed.
        await ledger.evaluateVetoes(USER);
        await ledger.evaluateVetoes(USER);
        expect(priceState.untracked).toEqual(['BTCUSDT']);
    });

    it('records a veto before init() ever ran (pipeline can fire first)', async () => {
        const ledger = await freshLedger();
        // Deliberately NO init() — a veto may fire before any dashboard
        // opened the ledger for this user.
        const rec = await ledger.recordVeto({
            username: USER,
            skill: {} as SkillMeta,
            skillName: 'x.md',
            coinName: 'BTCUSDT',
            direction: 'Long',
            entryPrice: 100,
            takeProfits: [{ price: 110 }],
            stopLoss: 95,
        });
        expect(rec?.outcome).toBe('PENDING');
        expect(await ledger.getAll(USER)).toHaveLength(1);
        expect(priceState.tracked).toEqual(['BTCUSDT']);
    });

    it('re-pins the feed user on init() even for an already-initialized user (A→B→A switch)', async () => {
        const ledger = await freshLedger();
        await ledger.init('user-a');
        await ledger.recordVeto({
            username: 'user-a',
            skill: {} as SkillMeta,
            skillName: 'x.md',
            coinName: 'BTCUSDT',
            direction: 'Long',
            entryPrice: 100,
            takeProfits: [{ price: 110 }],
            stopLoss: 95,
        });
        await ledger.init('user-b');
        await ledger.init('user-a'); // early-return path must still re-pin A

        priceState.current = 111;
        priceState.tick?.(); // a price tick settles the CURRENT user's ledger
        await new Promise(resolve => setTimeout(resolve, 0));
        expect((await ledger.getAll('user-a'))[0].outcome).toBe('WOULD_TP');
    });

    it('MFE updates stay in-memory (no persist) until the record settles', async () => {
        const writes = (): number => vi.mocked(setPreferenceObject).mock.calls.length;
        const ledger = await freshLedger();
        await ledger.recordVeto({
            username: USER,
            skill: {} as SkillMeta,
            skillName: 'btc-short-avoid.md',
            coinName: 'BTCUSDT',
            direction: 'Long',
            entryPrice: 100,
            takeProfits: [{ price: 110 }],
            stopLoss: 95,
        });
        const writesAfterRecord = writes();

        // An improving tick (price up, still below TP) raises MFE only — it
        // must NOT trigger a preference write (the old code saved every tick).
        priceState.current = 104;
        const settled = await ledger.evaluateVetoes(USER);
        expect(settled).toBe(0); // no state transition
        expect(writes()).toBe(writesAfterRecord); // no new persist
        // …but the in-memory record carries the excursion.
        let all = await ledger.getAll(USER);
        expect(all[0].maxFavorablePercent).toBe(4);
        expect(all[0].outcome).toBe('PENDING');

        // The accumulated MFE rides the next settle transition to disk.
        priceState.current = 111; // touches TP
        await ledger.evaluateVetoes(USER);
        expect(writes()).toBeGreaterThan(writesAfterRecord);
        all = await ledger.getAll(USER);
        expect(all[0].outcome).toBe('WOULD_TP');
        expect(all[0].maxFavorablePercent).toBe(11);
    });
});

// ─── 3. Sequential eval verdicts ────────────────────────────────────────────

describe('sequential eval verdict gating', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USER);
    });

    it("one 'hurts' run records evidence but does NOT demote a confirmed skill", async () => {
        const fileId = await seedSkill('seq-one.md');
        await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 3, alignedFlips: 0 }, USER);
        const meta = readMeta(fileId);
        expect(meta.status).toBe('confirmed');
        expect(meta.evalVerdict).toBe('hurts');
        expect(meta.evalStreak).toBe(1);
    });

    it("two consecutive 'hurts' runs DO demote — with a ledger stamp", async () => {
        const fileId = await seedSkill('seq-two.md');
        await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 3, alignedFlips: 0 }, USER);
        await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 2, alignedFlips: 0 }, USER);
        const meta = readMeta(fileId);
        expect(meta.status).toBe('candidate');
        expect(meta.evalStreak).toBe(2);
        const last = meta.history![meta.history!.length - 1];
        expect(last.status).toBe('candidate');
        expect(last.reason).toContain('eval hurts');
    });

    it("a different verdict resets the streak", async () => {
        const fileId = await seedSkill('seq-three.md');
        await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 3, alignedFlips: 0 }, USER);
        await recordEvalVerdict(fileId, { verdict: 'mixed', flips: 2, alignedFlips: 1 }, USER);
        const meta = readMeta(fileId);
        expect(meta.status).toBe('confirmed');
        expect(meta.evalStreak).toBeUndefined();
        // And a fresh hurts after the reset needs another streak to demote:
        await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 3, alignedFlips: 0 }, USER);
        expect(readMeta(fileId).status).toBe('confirmed');
        expect(readMeta(fileId).evalStreak).toBe(1);
    });

    it("two consecutive 'helps' runs rehabilitate an eval-demoted skill", async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-08-10T00:00:00Z'));
            const fileId = await seedSkill('seq-rehab.md');
            await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 3, alignedFlips: 0 }, USER);
            vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
            await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 3, alignedFlips: 0 }, USER);
            expect(readMeta(fileId).status).toBe('candidate');
            // One 'helps' records evidence but is not yet rehabilitation.
            vi.setSystemTime(new Date('2026-08-12T00:00:00Z'));
            await recordEvalVerdict(fileId, { verdict: 'helps', flips: 3, alignedFlips: 3 }, USER);
            expect(readMeta(fileId).status).toBe('candidate');
            // The second consecutive 'helps' restores the skill.
            vi.setSystemTime(new Date('2026-08-13T00:00:00Z'));
            await recordEvalVerdict(fileId, { verdict: 'helps', flips: 3, alignedFlips: 3 }, USER);
            const meta = readMeta(fileId);
            expect(meta.status).toBe('confirmed');
            const last = meta.history![meta.history!.length - 1];
            expect(last.status).toBe('confirmed');
            expect(last.reason).toContain('eval helps');
        } finally {
            vi.useRealTimers();
        }
    });

    it("re-confirmation re-arms the demotion gate (no instant demote on one legacy 'hurts')", async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-08-10T00:00:00Z'));
            const fileId = await seedSkill('seq-rearm.md');
            await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 3, alignedFlips: 0 }, USER);
            vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
            await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 3, alignedFlips: 0 }, USER);
            expect(readMeta(fileId).status).toBe('candidate');
            // Manual review promotes the skill back…
            vi.setSystemTime(new Date('2026-08-12T00:00:00Z'));
            await applyReviewRecommendation(fileId, 'promote', USER);
            expect(readMeta(fileId).status).toBe('confirmed');
            // …so a single new 'hurts' starts a FRESH streak instead of
            // inheriting the old ×2 and demoting instantly.
            vi.setSystemTime(new Date('2026-08-13T00:00:00Z'));
            await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 3, alignedFlips: 0 }, USER);
            expect(readMeta(fileId).status).toBe('confirmed');
            expect(readMeta(fileId).evalStreak).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a single 'hurts' run does NOT demote through the evidence path either (override respects the streak)", async () => {
        // Fresh lastEvidenceAt so staleness decay doesn't shrink the sample
        // below MIN_SAMPLE_CONFIRMED — this test isolates the eval override.
        const fileId = await seedSkill('seq-override-a.md', `lastEvidenceAt: ${new Date().toISOString()}\n`);
        await recordEvalVerdict(fileId, { verdict: 'hurts', flips: 3, alignedFlips: 0 }, USER);
        expect(readMeta(fileId).evalStreak).toBe(1);
        // An INJECTED evidence trade arrives between eval runs. The pre-fix
        // causal override in deriveStatus demoted here on a single 'hurts',
        // silently bypassing the sequential gate.
        seedInjection('seq-override-a.md');
        const win = makeTrade('ovr-1', 'WIN' as TradeOutcome);
        await applySkillEvidence(win, USER, [win]);
        const meta = readMeta(fileId);
        expect(meta.status).toBe('confirmed');
        expect(meta.wins).toBe(2); // full credit counted
    });

    it("a confirmed 'hurts' streak (×2) still demotes through the evidence path, stamped as an eval demotion", async () => {
        const now = new Date().toISOString();
        const fileId = await seedSkill('seq-override-b.md', `evalVerdict: hurts\nevalStreak: 2\nlastEvalAt: ${now}\nlastEvidenceAt: ${now}\n`);
        seedInjection('seq-override-b.md');
        const win = makeTrade('ovr-2', 'WIN' as TradeOutcome);
        await applySkillEvidence(win, USER, [win]);
        const meta = readMeta(fileId);
        expect(meta.status).toBe('candidate');
        const last = meta.history![meta.history!.length - 1];
        expect(last.status).toBe('candidate');
        // Must read as an EVAL demotion so rehabilitation can recognize it.
        expect(last.reason).toMatch(/^eval hurts/);
    });

    it("two consecutive 'helps' runs rehabilitate a skill demoted through the evidence path", async () => {
        const now = new Date().toISOString();
        const fileId = await seedSkill('seq-override-c.md', `evalVerdict: hurts\nevalStreak: 2\nlastEvalAt: ${now}\nlastEvidenceAt: ${now}\n`);
        seedInjection('seq-override-c.md');
        const win = makeTrade('ovr-3', 'WIN' as TradeOutcome);
        await applySkillEvidence(win, USER, [win]);
        expect(readMeta(fileId).status).toBe('candidate');
        // One 'helps' records evidence but is not yet rehabilitation.
        await recordEvalVerdict(fileId, { verdict: 'helps', flips: 3, alignedFlips: 3 }, USER);
        expect(readMeta(fileId).status).toBe('candidate');
        // The second consecutive 'helps' restores the skill.
        await recordEvalVerdict(fileId, { verdict: 'helps', flips: 3, alignedFlips: 3 }, USER);
        const meta = readMeta(fileId);
        expect(meta.status).toBe('confirmed');
        expect(meta.history![meta.history!.length - 1].reason).toContain('eval helps');
    });
});

// ─── 4. Control attribution ─────────────────────────────────────────────────
// NOTE: the REAL MemoryInjectionService is used — the shared Preferences
// store is seeded with injection records (or left empty), which exercises
// skillInjectedSince's actual window logic instead of a mock.

describe('injected-vs-control attribution', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USER);
    });

    it('a matched-but-NOT-injected trade lands in controlIds, not wins/losses', async () => {
        const fileId = await seedSkill('ctrl-a.md', 'lastEvidenceAt: 2026-08-25T00:00:00.000Z\n');
        // Seed telemetry with an injection of a DIFFERENT skill (recent, so
        // the log is non-empty) but never THIS skill → injected === false.
        store['memory_injections_v1_round40-user'] = [{
            ts: new Date().toISOString(),
            stage: 'opening',
            audience: 'analyst',
            coin: 'BTCUSDT',
            sources: [{ path: 'skills/some-other-skill.md', kind: 'skill' }],
        }];

        const loss = makeTrade('ctrl-1', 'LOSS' as TradeOutcome);
        await applySkillEvidence(loss, USER, [loss]);

        const meta = readMeta(fileId);
        expect(meta.controlIds).toContain('ctrl-1');
        // The seeded 1W/6L must be UNCHANGED — no half-credit inflation.
        expect(meta.losses).toBe(6);
        expect(meta.wins).toBe(1);
    });

    it('an INJECTED trade keeps full credit as before', async () => {
        const fileId = await seedSkill('ctrl-b.md', 'lastEvidenceAt: 2026-08-25T00:00:00.000Z\n');
        // Telemetry shows THIS skill was injected recently (inside the trade window).
        store['memory_injections_v1_round40-user'] = [{
            ts: new Date(Date.now() - 1000).toISOString(),
            stage: 'opening',
            audience: 'analyst',
            coin: 'BTCUSDT',
            sources: [{ path: 'skills/ctrl-b.md', kind: 'skill' }],
        }];

        const loss = makeTrade('ctrl-2', 'LOSS' as TradeOutcome);
        await applySkillEvidence(loss, USER, [loss]);

        const meta = readMeta(fileId);
        expect(meta.losses).toBe(7); // 6 + full credit
        expect(meta.controlIds ?? []).not.toContain('ctrl-2');
    });

    it('unknown telemetry (empty log) keeps full credit — tiering cannot starve', async () => {
        const fileId = await seedSkill('ctrl-c.md', 'lastEvidenceAt: 2026-08-25T00:00:00.000Z\n');

        const win = makeTrade('ctrl-3', 'WIN' as TradeOutcome);
        await applySkillEvidence(win, USER, [win]);

        const meta = readMeta(fileId);
        expect(meta.wins).toBe(2);
        expect(meta.controlIds ?? []).toHaveLength(0);
    });
});

// ─── 5. Regime scope is gap-filled, not last-write-wins ────────────────────

describe('regime scope gap-fill', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USER);
    });

    it('first evidenced regime sets the scope; a later different regime does NOT re-scope', async () => {
        const fileId = await seedSkill('regime-gap.md', 'lastEvidenceAt: 2026-08-25T00:00:00.000Z\n');
        seedInjection('regime-gap.md');
        const t1 = makeTrade('rg-1', 'WIN' as TradeOutcome, { marketRegime: 'trending' });
        await applySkillEvidence(t1, USER, [t1]);
        expect(readMeta(fileId).regime).toBe('trending');

        // A later trade in a different regime must NOT overwrite the scope
        // (last-write-wins drift) — a genuine re-scope belongs in refinement.
        const t2 = makeTrade('rg-2', 'WIN' as TradeOutcome, { marketRegime: 'ranging' });
        await applySkillEvidence(t2, USER, [t1, t2]);
        expect(readMeta(fileId).regime).toBe('trending');
    });
});

// ─── 6. Control-group baseline surfaces in evals ───────────────────────────

describe('control-group baseline in evals', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USER);
    });

    it('evaluateSkill reports the control-group win rate from controlIds', async () => {
        const fileId = await seedSkill('eval-ctrl.md', 'controlIds: c-win,c-loss,c-pending\n');
        const trades: LoggedTrade[] = [
            makeTrade('c-win', 'WIN' as TradeOutcome),
            makeTrade('c-loss', 'LOSS' as TradeOutcome),
            makeTrade('c-pending', 'PENDING' as TradeOutcome), // unsettled → excluded
            makeTrade('eval-1', 'WIN' as TradeOutcome),
        ];
        const runner = vi.fn(async () => ({ confidence: 'Medium', direction: 'Short' }));
        const result = await evaluateSkill(fileId, USER, trades, {} as unknown as ProviderConfig, runner);
        // c-win + c-loss are the settled control trades → 1 win of 2.
        expect(result.controlBaseline).toEqual({ trades: 2, wins: 1, winRate: 0.5 });
    });

    it('controlBaseline is absent when there are no settled control trades', async () => {
        const fileId = await seedSkill('eval-ctrl-none.md');
        const trades: LoggedTrade[] = [makeTrade('eval-2', 'WIN' as TradeOutcome)];
        const runner = vi.fn(async () => ({ confidence: 'Medium', direction: 'Short' }));
        const result = await evaluateSkill(fileId, USER, trades, {} as unknown as ProviderConfig, runner);
        expect(result.controlBaseline).toBeUndefined();
    });
});

// serializeSkill round-trip sanity for the new fields.
describe('new frontmatter fields round-trip', () => {
    it('evalStreak + controlIds survive parse→serialize→parse', () => {
        const meta: SkillMeta = {
            kind: 'avoid',
            status: 'confirmed',
            body: 'b',
            wins: 1,
            losses: 2,
            consecutiveLosses: 0,
            tradeIds: ['a'],
            evalStreak: 2,
            controlIds: ['c1', 'c2'],
        };
        const parsed = parseSkillMarkdown(serializeSkill(meta, titleFromMeta(meta)))!;
        expect(parsed.evalStreak).toBe(2);
        expect(parsed.controlIds).toEqual(['c1', 'c2']);
    });
});

// ─── 5. Candidate-avoid sample gate ─────────────────────────────────────────

describe('candidate avoid enforcement needs MIN_SAMPLE_FOR_VETO evidence', () => {
    beforeEach(() => {
        // Other describes in this file seed confirmed skills into the same
        // store — enforcement must see ONLY this describe's candidate.
        store = {};
    });

    const seedCandidate = async (name: string, wins: number, losses: number): Promise<void> => {
        await initMemoryFiles(USER);
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, name, `---
status: candidate
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: ${wins}
losses: ${losses}
ifCondition: BTC short setup
thenAction: skip the short
tradeIds: ${Array.from({ length: wins + losses }, (_, i) => `t${i}`).join(',')}
---

# Candidate avoid BTC short

**When:** BTC short setup
**What I do:** skip.
`, USER, true);
    };

    const analysis = (): {
        coinName: string;
        direction: string;
        confidence: string;
        probability: number;
        detectedPatternFamily: string;
        riskVeto?: string;
        validationWarnings?: string[];
    } => ({
        coinName: 'BTCUSDT',
        direction: 'Short',
        confidence: 'High',
        probability: 82,
        detectedPatternFamily: 'Family A',
        riskVeto: undefined,
    });

    it('a zero-evidence candidate does NOT cap confidence', async () => {
        // Verdict-sourced drafts start at 0W/0L. Zero-evidence candidates
        // never reach the model in the prompt — code-side enforcement must
        // not reach further than injection does.
        await seedCandidate('zero-ev-avoid.md', 0, 0);
        const next = applyNotebookSkillsToAnalysis(analysis());
        expect(next.confidence).toBe('High');
        expect(next.validationWarnings ?? []).toEqual([]);
    });

    it('a single-evidence candidate stays quiet too (below the sample gate)', async () => {
        await seedCandidate('one-ev-avoid.md', 1, 0);
        const next = applyNotebookSkillsToAnalysis(analysis());
        expect(next.confidence).toBe('High');
    });

    it('caps High → Low once the candidate has MIN_SAMPLE_FOR_VETO counted trades', async () => {
        expect(MIN_SAMPLE_FOR_VETO).toBe(2);
        await seedCandidate('two-ev-avoid.md', 1, 1);
        const next = applyNotebookSkillsToAnalysis(analysis());
        expect(next.confidence).toBe('Low');
        // Still a size-down warning, never a hard veto.
        expect(next.riskVeto).toBeUndefined();
        expect(next.validationWarnings?.join(' ')).toMatch(/NOTEBOOK SKILL/);
    });
});
