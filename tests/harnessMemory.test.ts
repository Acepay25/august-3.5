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
  confirmedAvoidForSetup,
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
    // No lastEvidenceAt before this win -> no stale-decay halving.
    expect(meta.losses).toBeGreaterThanOrEqual(1);
    expect(meta.lastEvidenceAt).toBeTruthy();
  });

  it('decays stale evidence before counting new outcomes', async () => {
    const { EVIDENCE_STALE_DAYS } = await import('../services/learning/SkillMemoryService');
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const staleDate = new Date(Date.now() - (EVIDENCE_STALE_DAYS + 5) * 86400000).toISOString();
    await createMemoryFile(folder.id, 'btc-stale-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 4
losses: 6
lastEvidenceAt: ${staleDate}
tradeIds: s1,s2,s3
---

# Avoid BTCUSDT Short Family A (stale)
`, 'test-user', true);

    const win = makeTrade({ id: 'fresh-win', outcome: TradeOutcome.WIN });
    await applySkillEvidence(win, 'test-user');
    const file = getMemoryFiles().files.find(f => f.name === 'btc-stale-avoid.md')!;
    const meta = parseSkillMarkdown(file.content)!;
    // 4W/6L halved to 2W/3L, then the fresh WIN counts.
    expect(meta.wins).toBe(3);
    expect(meta.losses).toBe(3);
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
ifCondition: BTC short setup
thenAction: enter the short after the 15m reclaim
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

  it('refines a confirmed skill via the LLM after 3 consecutive losses spanning >=48h', async () => {
    await seedConfirmedSkill('consecutiveLosses: 1\nlastEvidenceAt: 2026-08-09T12:00:00.000Z\n');
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

    // Two more losses, 3 days apart - past both gates (count + span).
    const lossA = makeTrade({ id: 'loss-2', timestamp: '2026-08-12T12:00:00.000Z' });
    const lossB = makeTrade({ id: 'loss-3', timestamp: '2026-08-15T12:00:00.000Z' });
    const history = [
      makeTrade({ id: 'g', outcome: TradeOutcome.LOSS, timestamp: '2026-08-09T12:00:00.000Z' }),
      lossA,
      lossB,
    ];
    await applySkillEvidence(lossA, 'test-user', history);
    await applySkillEvidence(lossB, 'test-user', history);

    expect(quickResponseMock).toHaveBeenCalledTimes(1);
    const file = getMemoryFiles().files.find(f => f.name.includes('btc') && f.name.includes('avoid'))!;
    const meta = parseSkillMarkdown(file.content)!;
    // §8.3c: the refinement enters the eval-only SHADOW — the live trigger
    // keeps its injection slot until the window settles.
    expect(meta.ifCondition).toBe('BTC short setup');
    expect(meta.shadow?.ifCondition).toBe('BTC short without a 15m reclaim and rising volume');
    expect(meta.shadow?.thenAction).toBe('skip the short until the reclaim candle closes');
    expect(meta.shadow?.seen).toBe(0);
    // The refined skill starts a fresh streak; evidence still landed.
    expect(meta.consecutiveLosses).toBe(0);
    expect(meta.losses).toBe(7);
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
    await seedConfirmedSkill('consecutiveLosses: 1\nlastEvidenceAt: 2026-08-21T15:29:28.000Z\n');
    loadConfigsMock.mockResolvedValue([readyConfig]);

    await applySkillEvidence(makeTrade({ id: 'win-1', outcome: TradeOutcome.WIN }), 'test-user');

    expect(quickResponseMock).not.toHaveBeenCalled();
    const file = getMemoryFiles().files.find(f => f.name.includes('btc') && f.name.includes('avoid'))!;
    const meta = parseSkillMarkdown(file.content)!;
    expect(meta.consecutiveLosses).toBe(0);
    expect(meta.wins).toBe(3); // fresh evidence -> no decay
  });

  it('keeps the skill untouched when the refinement LLM call fails', async () => {
    await seedConfirmedSkill('consecutiveLosses: 1\nlastEvidenceAt: 2026-08-21T15:29:28.000Z\n');
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
    expect(REFINE_AFTER_CONSECUTIVE_LOSSES).toBe(3);
  });

  it('retrieves a matching skill for the setup (tier-1 index, not body)', async () => {
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
    // Tier-1: openings get the one-line skill index, not the body.
    expect(ctx).toContain('[skills/');
    expect(ctx).toMatch(/AVOID \[/);
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
    // Moderator gets the ranked analyst slices too (no separate
    // catalog block — the recall tool covers discovery).
    expect(moderator).not.toContain('Skill catalog');
    // Openings: doctrine slot + ranked slices only; similar-trades moved to
    // verdict stage; no notebook map dump.
    expect(ctx).not.toContain('Similar closed trades');
    expect(ctx).not.toContain('NOTEBOOK MAP');
    expect(ctx).not.toMatch(/MUST cite|MUST reference/i);
    expect(ctx.length).toBeLessThan(4000);
  });

  it('verdict stage includes similar-trade history', async () => {
    const verdictTrades = Array.from({ length: MIN_CLUSTER_FOR_SKILL }, (_, i) =>
      makeTrade({ id: `t-${i}` })
    );
    const verdictCtx = getMemoryFilesContext({
      coin: 'BTCUSDT',
      direction: 'Short',
      family: 'Family A',
      regime: 'ranging',
    }, verdictTrades, 'analyst', 'verdict');
    expect(verdictCtx).toContain('Similar closed trades');
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
    // Candidate caps are a WARNING, not a hard risk veto —
    // the setup stays tradeable at reduced size.
    expect(next.riskVeto).toBeUndefined();
    expect((next as { validationWarnings?: string[] }).validationWarnings?.join(' ')).toMatch(/NOTEBOOK SKILL/);
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

  it('does NOT veto a different coin that merely shares the direction (S1 strict enforcement)', async () => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(folder.id, 'btc-long-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Long
family: liquidity sweep
wins: 1
losses: 6
tradeIds: a,b,c,d,e,f,g
---

# Avoid BTCUSDT Long liquidity sweep

**Procedure:** Wait for the reclaim.
`, 'test-user', true);
    // Same direction (Long) but a DIFFERENT coin and family — under the old
    // loose matcher this vetoed the setup; strictly it must not.
    const next = applyNotebookSkillsToAnalysis({
      coinName: 'ETHUSDT',
      direction: 'Long',
      confidence: 'High',
      probability: 80,
      detectedPatternFamily: 'range breakout',
      riskVeto: undefined as string | undefined,
    });
    expect(next.confidence).toBe('High');
    expect(next.direction).toBe('Long');
    expect(next.riskVeto).toBeUndefined();
    // The moderator-side skip_to_verdict veto is bound by the same rule.
    expect(confirmedAvoidForSetup({ coin: 'ETHUSDT', direction: 'Long', family: 'range breakout' })).toBeNull();
    // ...while its own setup still enforces.
    expect(confirmedAvoidForSetup({ coin: 'BTCUSDT', direction: 'Long', family: 'liquidity sweep' })).not.toBeNull();
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
