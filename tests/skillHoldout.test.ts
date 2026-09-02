import { describe, it, expect, vi, beforeEach } from 'vitest';

// §8.5a — permanent ε-holdout (plan §8.5a): ~10% of runs withhold skill
// injection, seeded per run id and reproducible, recorded on the injection
// log, and folded into runStats. The withheld run's outcomes must land in the
// CONTROL group (controlIds) for lift — never in the skill's W/L record.

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

// No memory model configured → the refinement LLM phase is skipped entirely.
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));

// The retrieval telemetry records under getActiveUsername() — pin it to the
// fixture user so the records land on the key the test reads back.
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: vi.fn(() => 'ho-user'),
}));

import { shouldSkillHoldout } from '../utils/skillHoldout';
import {
    initMemoryFiles,
    getMemoryFiles,
    getMemoryFilesContext,
    createMemoryFile,
} from '../services/learning/MemoryFilesService';
import { applySkillEvidence, parseSkillMarkdown } from '../services/learning/SkillMemoryService';
import { getRecentMemoryInjections } from '../services/learning/MemoryInjectionService';
import { LoggedTrade, TradeOutcome } from '../types';

const HO_USER = 'ho-user';

describe('shouldSkillHoldout (pure decision)', () => {
    it('is deterministic: the same run id always yields the same decision', () => {
        for (let i = 0; i < 10; i++) {
            expect(shouldSkillHoldout('run-8')).toBe(true);
            expect(shouldSkillHoldout('run-0')).toBe(false);
        }
    });

    it('approximates the 10% expectation over many ids', () => {
        let heldOut = 0;
        for (let i = 0; i < 1000; i++) {
            if (shouldSkillHoldout(`id-${i}`)) heldOut += 1;
        }
        // 1000 ids ⇒ ~100; loose band guards the hash, not the coin.
        expect(heldOut).toBeGreaterThanOrEqual(60);
        expect(heldOut).toBeLessThanOrEqual(140);
    });

    it('never holds out without a run id (conservative default)', () => {
        expect(shouldSkillHoldout(undefined)).toBe(false);
        expect(shouldSkillHoldout('')).toBe(false);
    });

    it('covers both outcomes (not a constant)', () => {
        expect(shouldSkillHoldout('run-8')).toBe(true);
        expect(shouldSkillHoldout('run-27')).toBe(true);
        expect(shouldSkillHoldout('run-1')).toBe(false);
    });
});

describe('ε-holdout retrieval integration', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(HO_USER);
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'holdout-skill.md', `---
status: confirmed
kind: repeat
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 1
ifCondition: BTC short setup holdout-test
thenAction: short after the 15m reclaim
lastEvidenceAt: ${new Date(Date.now() - 5 * 60 * 1000).toISOString()}
tradeIds: seed-1
---

# Repeat BTCUSDT Short Family A

**When:** BTC short setup
**What I do:** wait for the reclaim.
`, HO_USER, true);
    });

    const flushTelemetry = async (): Promise<void> => {
        await new Promise(r => setTimeout(r, 50));
    };

    const theContext = (runId: string): string =>
        getMemoryFilesContext(
            { coin: 'BTCUSDT', direction: 'Short', family: 'Family A' },
            [],
            'analyst',
            'opening',
            { runId },
        );

    const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
        id: 'ctl-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analysis: {
            coinName: 'BTCUSDT',
            direction: 'Short',
            detectedPatternFamily: 'Family A',
            entryPoints: [{ price: 100 }],
            stopLoss: 105,
            takeProfit: [{ price: 90 }],
        } as any,
        outcome: TradeOutcome.WIN,
        // §8.3a: the join is EXACT on the originating run — production
        // timing (run at T0, logged at T1 > T0) no longer matters.
        timestamp: new Date().toISOString(),
        ...overrides,
    });

    it('on a holdout run: no skill in the context, holdout:true, no skill source recorded', async () => {
        const ctx = theContext('run-8');
        expect(ctx).not.toContain('holdout-skill');
        await flushTelemetry();
        const recs = await getRecentMemoryInjections(HO_USER);
        expect(recs[0]?.holdout).toBe(true);
        expect(recs[0]?.sources.some(s => s.path.startsWith('skills/'))).toBe(false);
    });

    it('on a normal run: the matched skill is injected and recorded as a source', async () => {
        const ctx = theContext('run-0');
        expect(ctx).toContain('holdout-skill');
        await flushTelemetry();
        const recs = await getRecentMemoryInjections(HO_USER);
        expect(recs[0]?.holdout).toBeFalsy();
        expect(recs[0]?.sources.some(s => s.path.startsWith('skills/'))).toBe(true);
    });

    it('a trade after a holdout run becomes CONTROL evidence, not W/L credit', async () => {
        theContext('run-8');
        await flushTelemetry();
        const trade = makeTrade({ id: 'ctl-1', sourceRunId: 'run-8' });
        await applySkillEvidence(trade, HO_USER);
        const file = getMemoryFiles().files.find(f => f.name === 'holdout-skill.md')!;
        const meta = parseSkillMarkdown(file.content)!;
        expect(meta.controlIds).toContain('ctl-1');
        // Seed counts unchanged — the outcome was NOT attributed to the skill.
        expect(meta.wins).toBe(1);
        expect(meta.losses).toBe(1);
    });

    it('a trade after a normal run credits the skill (controlIds stays empty)', async () => {
        theContext('run-0');
        await flushTelemetry();
        const trade = makeTrade({ id: 'ctl-2', sourceRunId: 'run-0' });
        await applySkillEvidence(trade, HO_USER);
        const file = getMemoryFiles().files.find(f => f.name === 'holdout-skill.md')!;
        const meta = parseSkillMarkdown(file.content)!;
        expect(meta.wins).toBe(2);
        expect(meta.losses).toBe(1);
        expect(meta.controlIds ?? []).not.toContain('ctl-2');
    });

    it('§8.3a regression: a LATER run must not steal attribution — a trade joined to run-0 is CONTROL even if run-8 (holdout) logged after it', async () => {
        // Production order: run-0 injects the skill (T0) → user logs the
        // trade (T1) → a holdout run happens (T2). The old window join
        // (records AFTER trade.timestamp) would see only run-8 and label
        // the followed skill CONTROL. The exact runId join sees run-0.
        theContext('run-0');
        await flushTelemetry();
        const trade = makeTrade({ id: 'ctl-3', sourceRunId: 'run-0' });
        theContext('run-8'); // a later, unrelated holdout run
        await flushTelemetry();
        await applySkillEvidence(trade, HO_USER);
        const file = getMemoryFiles().files.find(f => f.name === 'holdout-skill.md')!;
        const meta = parseSkillMarkdown(file.content)!;
        expect(meta.controlIds ?? []).not.toContain('ctl-3');
        // beforeEach reseeds wins=1; the credited trade adds exactly one.
        expect(meta.wins).toBe(2);
    });

    it('§8.3a: a legacy trade with no sourceRunId keeps full credit (UNKNOWN)', async () => {
        theContext('run-0');
        await flushTelemetry();
        const trade = makeTrade({ id: 'ctl-4' }); // no sourceRunId
        await applySkillEvidence(trade, HO_USER);
        const file = getMemoryFiles().files.find(f => f.name === 'holdout-skill.md')!;
        const meta = parseSkillMarkdown(file.content)!;
        expect(meta.controlIds ?? []).not.toContain('ctl-4');
        expect(meta.wins).toBe(2);
    });
});
