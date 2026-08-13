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

import { initMemoryFiles, getMemoryFiles, getMemoryFilesContext } from '../services/learning/MemoryFilesService';
import {
  maybeUpsertSkill,
  applySkillEvidence,
  parseSkillMarkdown,
  MIN_CLUSTER_FOR_SKILL,
} from '../services/learning/SkillMemoryService';
import { LoggedTrade, TradeOutcome } from '../types';

const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
  id: 't1',
  analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as any,
  outcome: TradeOutcome.LOSS,
  timestamp: '2026-08-09T12:00:00.000Z',
  postMortem: '**Key Lesson:** Wait for the 15m reclaim before entering.',
  ...overrides,
});

describe('Harness memory (skills + retrieval)', () => {
  beforeEach(async () => {
    store = {};
    await initMemoryFiles('test-user');
  });

  it('does not create a skill before the cluster is large enough', async () => {
    const created = await maybeUpsertSkill(makeTrade(), [makeTrade(), makeTrade({ id: 't2' })], 'test-user');
    expect(created).toBeNull();
    expect(getMemoryFiles().files.filter(f => f.name.includes('short')).length).toBe(0);
  });

  it('creates an evidence-gated skill after a cluster of similar losses', async () => {
    const trades = Array.from({ length: MIN_CLUSTER_FOR_SKILL }, (_, i) =>
      makeTrade({ id: `t-${i}` })
    );
    const created = await maybeUpsertSkill(trades[2], trades, 'test-user');
    expect(created).not.toBeNull();
    const meta = parseSkillMarkdown(created!.content)!;
    expect(meta.kind).toBe('avoid');
    expect(meta.losses).toBe(MIN_CLUSTER_FOR_SKILL);
    expect(meta.status).toBe('candidate');
  });

  it('updates skill evidence on a later matching WIN', async () => {
    const losses = Array.from({ length: MIN_CLUSTER_FOR_SKILL }, (_, i) =>
      makeTrade({ id: `t-${i}` })
    );
    await maybeUpsertSkill(losses[2], losses, 'test-user');
    const win = makeTrade({ id: 'win-1', outcome: TradeOutcome.WIN });
    await applySkillEvidence(win, 'test-user');
    const file = getMemoryFiles().files.find(f => f.name.includes('btc') && f.name.includes('avoid'));
    const meta = parseSkillMarkdown(file!.content)!;
    expect(meta.wins).toBe(1);
    expect(meta.losses).toBe(MIN_CLUSTER_FOR_SKILL);
  });

  it('retrieves a matching skill and ranging playbook for the setup', async () => {
    const trades = Array.from({ length: MIN_CLUSTER_FOR_SKILL }, (_, i) =>
      makeTrade({ id: `t-${i}` })
    );
    await maybeUpsertSkill(trades[2], trades, 'test-user');
    const ctx = getMemoryFilesContext({
      coin: 'BTCUSDT',
      direction: 'Short',
      family: 'Family A',
      regime: 'ranging',
    }, trades);
    expect(ctx).toContain('[skills/');
    expect(ctx).toContain('kind: avoid');
    expect(ctx).toContain('[market-conditions/ranging-day.md]');
    expect(ctx).toContain('Similar closed trades');
    expect(ctx.length).toBeLessThan(8000);
  });
});
