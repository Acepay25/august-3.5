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

// Provider layer is mocked so the skill-refinement LLM pass runs offline.
const { quickResponseMock, loadConfigsMock } = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quickResponseMock: vi.fn(async (..._args: any[]) => ''),
  loadConfigsMock: vi.fn(async () => [] as unknown[]),
}));
vi.mock('../services/providers/GenericProviderService', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getQuickResponse: ((...args: any[]) => quickResponseMock(...args)) as any,
}));
vi.mock('../services/infrastructure/ProviderConfigService', () => ({
  loadProviderConfigs: (() => loadConfigsMock()) as never,
  getReadyProviders: (configs: unknown[]) => configs,
}));

import { initMemoryFiles, getMemoryFiles, getMemoryFilesContext, createMemoryFile, updateMemoryFile } from '../services/learning/MemoryFilesService';
import { listRetrievedMemorySources } from '../services/learning/MemoryRetrievalService';
import {
  maybeUpsertSkill,
  applySkillEvidence,
  applyNotebookSkillsToAnalysis,
  parseSkillMarkdown,
  ingestIfThenFromTrade,
  MIN_CLUSTER_FOR_SKILL,
  REFINE_AFTER_CONSECUTIVE_LOSSES,
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
    quickResponseMock.mockReset();
    quickResponseMock.mockResolvedValue('');
    loadConfigsMock.mockReset();
    loadConfigsMock.mockResolvedValue([]);
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

  const seedConfirmedSkill = async (extra = ''): Promise<void> => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(folder.id, 'btc-short-familya-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 2
losses: 5
${extra}tradeIds: a,b,c,d,e,f,g
---

# Avoid BTCUSDT Short Family A

**Procedure:** Wait for the 15m reclaim.
`, 'test-user', true);
  };

  const readyConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
  };

  it('refines a confirmed skill via the LLM after 2 consecutive losses', async () => {
    await seedConfirmedSkill('consecutiveLosses: 1\n');
    loadConfigsMock.mockResolvedValue([readyConfig]);
    quickResponseMock.mockResolvedValue(JSON.stringify({
      name: 'Avoid BTC short without reclaim',
      kind: 'avoid',
      when: 'BTC short setup without a 15m reclaim candle',
      inputs: ['BTCUSDT', 'Short', 'Family A'],
      steps: ['Wait for the 15m reclaim', 'Confirm rising volume'],
      validate: 'Reclaim candle closes above the level',
      output: 'Skip the short',
      approval: 'Never auto-size a short',
      ifCondition: 'BTC short without a 15m reclaim and rising volume',
      thenAction: 'skip the short until the reclaim candle closes',
    }));

    const loss = makeTrade({ id: 'loss-2' });
    await applySkillEvidence(loss, 'test-user', [loss]);

    expect(quickResponseMock).toHaveBeenCalledTimes(1);
    const file = getMemoryFiles().files.find(f => f.name.includes('btc') && f.name.includes('avoid'))!;
    const meta = parseSkillMarkdown(file.content)!;
    expect(meta.ifCondition).toBe('BTC short without a 15m reclaim and rising volume');
    expect(meta.thenAction).toBe('skip the short until the reclaim candle closes');
    // The refined skill starts a fresh streak; evidence still landed.
    expect(meta.consecutiveLosses).toBe(0);
    expect(meta.losses).toBe(6);
  });

  it('does not refine on the first consecutive loss', async () => {
    await seedConfirmedSkill();
    loadConfigsMock.mockResolvedValue([readyConfig]);

    await applySkillEvidence(makeTrade({ id: 'loss-1' }), 'test-user');

    expect(quickResponseMock).not.toHaveBeenCalled();
    const file = getMemoryFiles().files.find(f => f.name.includes('btc') && f.name.includes('avoid'))!;
    expect(parseSkillMarkdown(file.content)!.consecutiveLosses).toBe(1);
  });

  it('resets the consecutive-loss streak on a WIN without an LLM call', async () => {
    await seedConfirmedSkill('consecutiveLosses: 1\n');
    loadConfigsMock.mockResolvedValue([readyConfig]);

    await applySkillEvidence(makeTrade({ id: 'win-1', outcome: TradeOutcome.WIN }), 'test-user');

    expect(quickResponseMock).not.toHaveBeenCalled();
    const file = getMemoryFiles().files.find(f => f.name.includes('btc') && f.name.includes('avoid'))!;
    const meta = parseSkillMarkdown(file.content)!;
    expect(meta.consecutiveLosses).toBe(0);
    expect(meta.wins).toBe(3);
  });

  it('keeps the skill untouched when the refinement LLM call fails', async () => {
    await seedConfirmedSkill('consecutiveLosses: 1\n');
    loadConfigsMock.mockResolvedValue([readyConfig]);
    quickResponseMock.mockRejectedValue(new Error('provider down'));

    await applySkillEvidence(makeTrade({ id: 'loss-2' }), 'test-user');

    const file = getMemoryFiles().files.find(f => f.name.includes('btc') && f.name.includes('avoid'))!;
    const meta = parseSkillMarkdown(file.content)!;
    expect(meta.body).toContain('Wait for the 15m reclaim');
    // Evidence landed even though refinement failed.
    expect(meta.losses).toBe(6);
  });

  it('exports the refinement threshold constant', () => {
    expect(REFINE_AFTER_CONSECUTIVE_LOSSES).toBe(2);
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

  it('does not apply a disabled notebook skill to a setup', async () => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const disabled = await createMemoryFile(folder.id, 'disabled-eth-long-avoid.md', `---
status: confirmed
kind: avoid
coin: ETHUSDT
direction: Long
family: Family Z
wins: 1
losses: 6
tradeIds: a,b,c,d,e,f,g
---

# Disabled avoid skill

Wait for the reclaim.
`, 'test-user');
    await updateMemoryFile(disabled.id, { enabled: false }, 'test-user');
    const next = applyNotebookSkillsToAnalysis({
      coinName: 'ETHUSDT',
      direction: 'Long',
      confidence: 'High',
      probability: 80,
      detectedPatternFamily: 'Family Z',
    });
    expect(next.confidence).toBe('High');
    expect(next.direction).toBe('Long');
  });

  it('promotes a post-mortem IF/THEN into a skill on the first closed trade', async () => {
    const trade = makeTrade({
      id: 'if-1',
      postMortem: 'IF 15m close reclaims VWAP with rising volume THEN wait for a retest before shorting.',
    });
    await ingestIfThenFromTrade(trade, 'test-user');
    const hit = getMemoryFiles().files.map(f => parseSkillMarkdown(f.content)).find(m => m?.ifCondition?.includes('VWAP'));
    expect(hit?.thenAction).toMatch(/retest/i);
    expect(hit?.kind).toBe('avoid');
    expect(hit?.losses).toBe(1);
  });

  it('does not ingest an IF/THEN from an execution-error post-mortem', async () => {
    const trade = makeTrade({
      id: 'exec-1',
      rootCauseClass: 'EXECUTION_ERROR',
      postMortem: 'EXECUTION_ERROR\nI chased.\nIF 15m close reclaims VWAP THEN wait for a retest before shorting.',
    });
    await ingestIfThenFromTrade(trade, 'test-user');
    expect(getMemoryFiles().files.map(f => parseSkillMarkdown(f.content)).some(m => m?.ifCondition?.includes('VWAP'))).toBe(false);
  });
});
