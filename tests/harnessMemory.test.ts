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

import { initMemoryFiles, getMemoryFiles, getMemoryFilesContext, createMemoryFile } from '../services/learning/MemoryFilesService';
import { listRetrievedMemorySources } from '../services/learning/MemoryRetrievalService';
import {
  maybeUpsertSkill,
  applySkillEvidence,
  applyNotebookSkillsToAnalysis,
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
    const sources = listRetrievedMemorySources({
      coin: 'BTCUSDT',
      direction: 'Short',
      family: 'Family A',
      regime: 'ranging',
    }, trades);
    expect(sources.some(s => s.kind === 'skill' || s.path.includes('skills/'))).toBe(true);

    const moderator = getMemoryFilesContext({
      coin: 'BTCUSDT',
      direction: 'Short',
      family: 'Family A',
      regime: 'ranging',
    }, trades, 'moderator');
    expect(moderator).toContain('Skill catalog');
    expect(moderator).not.toContain('[skills/');
    expect(ctx).toContain('[market-conditions/ranging-day.md]');
    expect(ctx).toContain('Similar closed trades');
    expect(ctx).toMatch(/match this coin/i);
    expect(ctx).not.toMatch(/MUST cite|MUST reference/i);
    expect(ctx).toContain('NOTEBOOK MAP');
    expect(ctx.length).toBeLessThan(9000);
  });

  it('caps High when a matching candidate avoid skill exists', async () => {
    const trades = Array.from({ length: MIN_CLUSTER_FOR_SKILL }, (_, i) =>
      makeTrade({ id: `t-${i}` })
    );
    await maybeUpsertSkill(trades[2], trades, 'test-user');
    const next = applyNotebookSkillsToAnalysis({
      coinName: 'BTCUSDT',
      direction: 'Short',
      confidence: 'High',
      probability: 82,
      detectedPatternFamily: 'Family A',
      riskVeto: undefined as string | undefined,
    });
    expect(next.confidence).toBe('Low');
    expect(next.direction).toBe('Short');
    expect(next.riskVeto).toMatch(/NOTEBOOK SKILL/);
  });

  it('vetoes Long/Short when a confirmed avoid skill matches', async () => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(folder.id, 'btc-short-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 6
tradeIds: a,b,c,d,e,f,g
---

# Avoid BTCUSDT Short Family A

**Procedure:** Wait for the 15m reclaim.
`, 'test-user', true);
    const next = applyNotebookSkillsToAnalysis({
      coinName: 'BTCUSDT',
      direction: 'Short',
      confidence: 'High',
      probability: 80,
      detectedPatternFamily: 'Family A',
      riskVeto: undefined as string | undefined,
    });
    expect(next.confidence).toBe('Avoid');
    expect(next.direction).toBe('Neutral');
    expect(next.riskVeto).toMatch(/NOTEBOOK SKILL VETO/);
  });
});
