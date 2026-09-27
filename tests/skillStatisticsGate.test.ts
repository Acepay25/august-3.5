import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The confirmation gate's own arithmetic (handoff 1.6, sub-items a–c):
 *   • ONE z for both Wilson bounds, so the avoid path is not structurally
 *     stricter than the repeat path (utils/skillStatistics.ts).
 *   • A control group has to be a GROUP before a skill is graded against it.
 *   • The R ledger the service maintains gates promotion once it is deep
 *     enough to mean anything — and stays out of the way until then.
 * Decay (sub-item d) is pinned in skillTemplateDecay.test.ts, the review-side
 * expectancy conflict in skillEffectiveness.test.ts.
 */

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
  getPreference: vi.fn(async (key: string) => store[key] ?? null),
  getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
    const raw = store[key];
    if (!Array.isArray(raw)) return [];
    return guard ? raw.filter(guard) : raw;
  }),
  setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
  setPreference: vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
  removePreference: vi.fn(async (key: string) => {
    delete store[key];
  }),
}));

vi.mock('../services/learning/MemoryModelService', () => ({
  resolveMemoryConfig: vi.fn(async () => null),
}));

import {
  wilsonLowerBound,
  wilsonUpperBound,
  ciGatePasses,
  Z_ONE_SIDED,
  CONTROL_MIN_SAMPLE,
  COLD_START_MIN_SAMPLE,
} from '../utils/skillStatistics';
import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import {
  applySkillEvidence,
  parseSkillMarkdown,
  EXPECTANCY_MIN_R_SAMPLE,
  type SkillMeta,
} from '../services/learning/SkillMemoryService';
import { LoggedTrade, TradeOutcome } from '../types';

const USER = 'stats-gate-user';

// ─── (a) one z, both bounds ─────────────────────────────────────────────────

describe('Wilson bounds share ONE z', () => {
  it('defaults both bounds to the one-sided quantile', () => {
    expect(Z_ONE_SIDED).toBe(1.645);
    for (const [w, n] of [[1, 10], [5, 8], [9, 10], [20, 12]] as const) {
      expect(wilsonLowerBound(w, n)).toBe(wilsonLowerBound(w, n, Z_ONE_SIDED));
      expect(wilsonUpperBound(w, n)).toBe(wilsonUpperBound(w, n, Z_ONE_SIDED));
    }
  });

  it('a mirrored record sums to 1 — the asymmetry cannot come back', () => {
    // The lower bound of (n-w, n) IS 1 - the upper bound of (w, n). This held
    // for no other reason than the two bounds sharing z, so re-introducing a
    // two-sided 1.96 on the upper side breaks it on the first record.
    for (const [w, n] of [[1, 10], [2, 10], [3, 8], [4, 12], [0, 6], [7, 7]] as const) {
      expect(wilsonLowerBound(n - w, n) + wilsonUpperBound(w, n)).toBeCloseTo(1, 12);
    }
  });

  it('the avoid path is no longer structurally stricter than the repeat path', () => {
    // 2W/8L and its mirror. The repeat twin cleared the cold-start bar; the
    // avoid twin could not, because the upper bound silently ran at the
    // TWO-SIDED 1.96 while the lower ran at 1.645.
    expect(ciGatePasses('repeat', 8, 2)).toBe(true);
    expect(ciGatePasses('avoid', 2, 8)).toBe(true);
    // …and the pre-fix numbers, so this test fails if someone "restores" them.
    expect(wilsonUpperBound(2, 10, 1.96)).toBeGreaterThan(0.5);
    expect(wilsonUpperBound(2, 10)).toBeLessThan(0.5);
  });
});

// ─── (b) the control comparison needs a control group ───────────────────────

describe('ciGatePasses control floor', () => {
  it('grades against the control rate only from CONTROL_MIN_SAMPLE', () => {
    expect(CONTROL_MIN_SAMPLE).toBe(5);
    // 5W/3L clears the raw ladder floor (0.6) but its interval does NOT
    // exclude 50% from cold start, so the ONLY thing that could ever confirm
    // it is a lift comparison — and a lift comparison needs a real baseline.
    expect(wilsonLowerBound(5, 8)).toBeLessThan(0.5);
    expect(wilsonLowerBound(5, 8)).toBeGreaterThan(0);
    // Four control losses: a 0% rate, but not a group.
    expect(ciGatePasses('repeat', 5, 3, { wins: 0, losses: 4 })).toBe(false);
    // Five: the lift branch, and the trivial 0% baseline now legitimately
    // separates. Same record, same rate — only the sample size moved.
    expect(ciGatePasses('repeat', 5, 3, { wins: 0, losses: 5 })).toBe(true);
  });

  it('a one- or two-trade control cannot promote anything the cold start rejects', () => {
    // Pre-fix each of these took the lift branch against a rate of 0 (or 1)
    // and passed on a comparison that carried no information at all.
    for (const control of [
      { wins: 0, losses: 1 },
      { wins: 1, losses: 0 },
      { wins: 1, losses: 1 },
      { wins: 0, losses: 2 },
    ]) {
      expect(ciGatePasses('repeat', 5, 3, control)).toBe(false);
      expect(ciGatePasses('avoid', 3, 5, control)).toBe(false);
    }
  });

  it('falls back to the cold-start bar, not to "no evidence required"', () => {
    // Under the floor AND under COLD_START_MIN_SAMPLE: nothing to judge.
    expect(ciGatePasses('repeat', 2, 1, { wins: 0, losses: 1 })).toBe(false);
    // Above the control floor, the comparison is back on and it says no.
    expect(ciGatePasses('repeat', 4, 4, { wins: 4, losses: 1 })).toBe(false);
    expect(COLD_START_MIN_SAMPLE).toBe(8);
    // No evidence at all never passes, whatever the control says.
    expect(ciGatePasses('repeat', 0, 0, { wins: 1, losses: 1 })).toBe(false);
  });
});

// ─── (b/c) the gate as the service runs it ─────────────────────────────────

const makeTrade = (id: string, outcome: TradeOutcome, realizedR?: number): LoggedTrade => ({
  id,
  analysis: {
    coinName: 'BTCUSDT',
    direction: 'Long',
    detectedPatternFamily: 'Family A',
    entryPoints: [{ price: 100 }],
    stopLoss: 95,
    takeProfit: [{ price: 110 }],
  } as never,
  outcome,
  ...(realizedR === undefined ? {} : { realizedR }),
  timestamp: new Date().toISOString(),
});

/** An 11-sample candidate: 9W/2L plus the WIN fed below → 10W/2L at N=12.
 *  The raw ladder (0.6) and the cold-start CI (Wilson lower ≈ 0.60) both clear
 *  it, so whatever happens next is decided by the R ledger alone. */
const seedSkill = async (name: string, r: { netR?: number; rSampled?: number } = {}): Promise<string> => {
  const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
  const rLines = r.rSampled
    ? `netR: ${(r.netR ?? 0).toFixed(2)}\nrSampled: ${r.rSampled}\n`
    : '';
  const file = await createMemoryFile(folder.id, name, `---
status: candidate
kind: repeat
coin: BTCUSDT
direction: Long
family: Family A
wins: 9
losses: 2
consecutiveLosses: 0
tradeIds: seed-a,seed-b
ifCondition: BTC long in Family A
thenAction: follow the documented procedure
lastEvidenceAt: ${new Date(Date.now() - 5000).toISOString()}
modified: ${new Date(Date.now() - 7_200_000).toISOString()}
${rLines}---

# Seeded skill
`, USER, true);
  return file.id;
};

const readMeta = (fileId: string): SkillMeta => {
  const file = getMemoryFiles().files.find(f => f.id === fileId)!;
  const meta = parseSkillMarkdown(file.content);
  if (!meta) throw new Error('seeded skill no longer parses');
  return meta;
};

describe('the R ledger gates promotion', () => {
  beforeEach(async () => {
    store = {};
    await initMemoryFiles(USER);
  });

  it('blocks a skill whose measured R does not pay, even at 10W/2L', async () => {
    // 10 wins of +0.1R against 2 losses of -1R: an 83% win rate and -0.08R per
    // trade. The win-rate ladder cannot see this — it is the signature of a
    // small target behind a wide stop.
    const fileId = await seedSkill('expectancy-blocked.md', { netR: -0.9, rSampled: 10 });
    const win = makeTrade('eb-1', TradeOutcome.WIN, 0.1);
    await applySkillEvidence(win, USER, [win]);

    const meta = readMeta(fileId);
    expect(meta.wins).toBe(10);
    expect(meta.losses).toBe(2);
    expect(meta.rSampled).toBe(EXPECTANCY_MIN_R_SAMPLE + 3);
    expect(meta.netR).toBeCloseTo(-0.8, 2);
    // The record itself clears the ladder floor and the cold-start CI — only
    // the ledger keeps it a candidate.
    expect(meta.status).toBe('candidate');
  });

  it('promotes the same record when the ledger pays', async () => {
    const fileId = await seedSkill('expectancy-paid.md', { netR: 2.5, rSampled: 10 });
    const win = makeTrade('ep-1', TradeOutcome.WIN, 0.5);
    await applySkillEvidence(win, USER, [win]);

    const meta = readMeta(fileId);
    expect(meta.netR).toBeCloseTo(3, 2);
    expect(meta.rSampled).toBe(EXPECTANCY_MIN_R_SAMPLE + 3);
    expect(meta.status).toBe('confirmed');
  });

  it('stands aside below EXPECTANCY_MIN_R_SAMPLE — unmeasured is not break-even', async () => {
    const fileId = await seedSkill('expectancy-thin.md', { netR: -0.9, rSampled: EXPECTANCY_MIN_R_SAMPLE - 1 });
    // This trade carries no measured R, so the ledger does not move: the same
    // bad average is still on record, one sample short of being judgeable.
    const win = makeTrade('et-1', TradeOutcome.WIN);
    await applySkillEvidence(win, USER, [win]);

    const meta = readMeta(fileId);
    expect(meta.rSampled).toBe(EXPECTANCY_MIN_R_SAMPLE - 1);
    expect(meta.netR).toBeCloseTo(-0.9, 2);
    expect(meta.status).toBe('confirmed');
  });
});

describe('the control group is counted, not just listed', () => {
  beforeEach(async () => {
    store = {};
    await initMemoryFiles(USER);
  });

  const seedInjection = (fileName: string, runId: string): void => {
    // A run that injected a DIFFERENT skill: this one is matched-but-absent,
    // i.e. CONTROL (the exact runId join applySkillEvidence makes).
    store[`memory_injections_v1_${USER}`] = [{
      ts: new Date().toISOString(),
      stage: 'opening',
      audience: 'analyst',
      coin: 'BTCUSDT',
      runId,
      sources: [{ path: 'skills/some-other-skill.md', kind: 'skill' }],
    }];
  };

  it('accumulates controlWins/controlLosses and round-trips them beside controlIds', async () => {
    const fileId = await seedSkill('control-aggregate.md');
    for (const [id, outcome] of [['c-1', TradeOutcome.LOSS], ['c-2', TradeOutcome.LOSS], ['c-3', TradeOutcome.WIN]] as const) {
      const runId = `run-${id}`;
      seedInjection('control-aggregate.md', runId);
      const trade = { ...makeTrade(id, outcome), sourceRunId: runId } as LoggedTrade;
      await applySkillEvidence(trade, USER, [trade]);
    }

    const meta = readMeta(fileId);
    expect(meta.controlIds).toEqual(['c-1', 'c-2', 'c-3']);
    expect(meta.controlWins).toBe(1);
    expect(meta.controlLosses).toBe(2);
    // Never mixed into the skill's own record.
    expect(meta.wins).toBe(9);
    expect(meta.losses).toBe(2);
  });

  it('a replayed control trade does not double-count the baseline', async () => {
    const fileId = await seedSkill('control-replay.md');
    const runId = 'run-c-replay';
    seedInjection('control-replay.md', runId);
    const trade = { ...makeTrade('cr-1', TradeOutcome.LOSS), sourceRunId: runId } as LoggedTrade;
    await applySkillEvidence(trade, USER, [trade]);
    await applySkillEvidence(trade, USER, [trade]);

    const meta = readMeta(fileId);
    expect(meta.controlIds).toEqual(['cr-1']);
    expect(meta.controlLosses).toBe(1);
  });
});
