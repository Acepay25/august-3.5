import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../services/learning/MemoryModelService', () => ({
  resolveMemoryConfig: vi.fn(async () => null),
}));

import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { maybeUpsertSkill, MIN_CLUSTER_FOR_SKILL } from '../services/learning/SkillMemoryService';
import type { LoggedTrade, TradeAnalysis, TradeOutcome } from '../types';

const USER = 'no-claim-user';

const makeTrade = (id: string, outcome: TradeOutcome, postMortem: string): LoggedTrade => ({
  id,
  analysis: {
    coinName: 'BTCUSDT',
    direction: 'Short',
    detectedPatternFamily: 'Family A',
  } as unknown as TradeAnalysis,
  outcome,
  postMortem,
  timestamp: new Date(Date.now() - 5000).toISOString(),
});

describe('maybeUpsertSkill no-claim gate', () => {
  beforeEach(async () => {
    store = {};
    await initMemoryFiles(USER);
  });

  it('refuses to write a skill when the cluster has no extractable claim', async () => {
    // A full cluster of admitted trades (LOSS + empty postMortem → UNCLEAR
    // admits) — but with no IF/THEN clause and no lesson there is nothing
    // the market taught. Cluster statistics alone are not a procedure.
    const trades = Array.from({ length: MIN_CLUSTER_FOR_SKILL }, (_, i) =>
      makeTrade(`t-${i}`, 'LOSS' as TradeOutcome, '')
    );
    const created = await maybeUpsertSkill(trades[2], trades, USER);
    expect(created).toBeNull();
    expect(getMemoryFiles().files.filter(f => f.folderId === 'skills')).toHaveLength(0);
  });

  it('refuses when the post-mortem is only a section title, not a lesson', async () => {
    const junk = '**Lesson: 🩸 LOSS FORENSIC ANALYSIS — BTCUSDT LONG (2026-08-13)**';
    const trades = Array.from({ length: MIN_CLUSTER_FOR_SKILL }, (_, i) =>
      makeTrade(`t-${i}`, 'LOSS' as TradeOutcome, junk)
    );
    const created = await maybeUpsertSkill(trades[2], trades, USER);
    expect(created).toBeNull();
  });

  it('still writes a skill when the cluster carries a real lesson (regression)', async () => {
    const pm = '**Key Lesson:** Wait for the 15m reclaim before entering.';
    const trades = Array.from({ length: MIN_CLUSTER_FOR_SKILL }, (_, i) =>
      makeTrade(`t-${i}`, 'LOSS' as TradeOutcome, pm)
    );
    const created = await maybeUpsertSkill(trades[2], trades, USER);
    expect(created).not.toBeNull();
    expect(created!.content).toContain('Wait for the 15m reclaim');
  });
});
