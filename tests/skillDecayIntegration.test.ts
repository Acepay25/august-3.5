import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
  getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
      const raw = store[key];
      if (!Array.isArray(raw)) return [];
      return guard ? raw.filter(guard) : raw;
  }),
  setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
  removePreference: vi.fn(async (key: string) => {
    delete store[key];
  }),
}));

vi.mock('../services/providers/GenericProviderService', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getQuickResponse: (async () => '') as any,
}));
vi.mock('../services/infrastructure/ProviderConfigService', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadProviderConfigs: (async () => []) as any,
  getReadyProviders: (configs: unknown[]) => configs,
}));

import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import {
  applySkillEvidence,
  parseSkillMarkdown,
  serializeSkill,
  maybeMergeSkill,
  ingestCraftedSkill,
  EVIDENCE_STALE_DAYS,
  EVIDENCE_DECAY_MAX_HALVINGS,
  type SkillMeta,
} from '../services/learning/SkillMemoryService';
import { LoggedTrade, TradeOutcome } from '../types';

const USER = 'decay-user';

const confirmedDecayedSkill = (): SkillMeta => ({
  status: 'confirmed',
  kind: 'repeat',
  coin: 'BTCUSDT',
  direction: 'Short',
  family: 'Family A',
  regime: 'ranging',
  strategyFamily: 'mean_reversion',
  // Lifetime record says the skill is great…
  wins: 10,
  losses: 2,
  consecutiveLosses: 1,
  tradeIds: ['old-1', 'old-2'],
  lastEvidenceAt: new Date().toISOString(), // fresh enough to skip decay halving
  // …but the recent window says the edge is gone: 2W/8L = 20%.
  recentOutcomes: 'WWLLLLLLLL',
  body: 'Fade exhaustion prints in ranging BTC.',
});

const lossTrade = (id: string): LoggedTrade => ({
  id,
  analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A', strategy: 'mean reversion fade' } as never,
  outcome: TradeOutcome.LOSS,
  marketRegime: 'ranging',
  timestamp: new Date().toISOString(),
} as LoggedTrade);

describe('alpha-decay demotion (end-to-end through the evidence path)', () => {
  beforeEach(async () => {
    store = {};
    await initMemoryFiles(USER);
  });

  it('demotes a confirmed skill whose recent window decayed, without retiring it', async () => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(folder.id, 'decay-skill.md', serializeSkill(confirmedDecayedSkill(), 'Decay skill'), USER, true);

    await applySkillEvidence(lossTrade('new-1'), USER, [lossTrade('new-1')]);

    const file = getMemoryFiles().files.find(f => f.name === 'decay-skill.md')!;
    const meta = parseSkillMarkdown(file.content)!;
    // Lifetime 10W/3L (77%) would keep it confirmed under the old math;
    // the decayed window (2W/9L) demotes it to candidate — not retired.
    expect(meta.status).toBe('candidate');
    expect(meta.wins).toBe(10);
    expect(meta.losses).toBe(3);
    expect(meta.recentOutcomes).toBe('WWLLLLLLLLL'.slice(-12));
  });

  it('leaves a confirmed skill with a healthy recent window alone', async () => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const skill = confirmedDecayedSkill();
    skill.recentOutcomes = 'WWWWWWWWWW';
    await createMemoryFile(folder.id, 'healthy-skill.md', serializeSkill(skill, 'Healthy skill'), USER, true);

    await applySkillEvidence(lossTrade('new-2'), USER, [lossTrade('new-2')]);

    const file = getMemoryFiles().files.find(f => f.name === 'healthy-skill.md')!;
    expect(parseSkillMarkdown(file.content)!.status).toBe('confirmed');
  });
});

const foldTrade = (id: string, outcome: TradeOutcome): LoggedTrade => ({
  id,
  analysis: {
    coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A',
    strategy: 'mean reversion fade',
  } as never,
  outcome,
  marketRegime: 'ranging',
  timestamp: new Date().toISOString(),
  postMortem: '**Key Lesson:** Wait for the 15m reclaim before entering.',
} as LoggedTrade);

const seedFoldSkill = async (name: string, overrides: Partial<SkillMeta> = {}): Promise<string> => {
  const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
  const base: SkillMeta = {
    status: 'candidate',
    kind: 'avoid',
    coin: 'BTCUSDT',
    direction: 'Short',
    family: 'Family A',
    wins: 1,
    losses: 1,
    consecutiveLosses: 0,
    tradeIds: ['old-1', 'old-2'],
    ifCondition: 'BTC short in Family A without a reclaim',
    thenAction: 'skip',
    body: 'skip it',
    ...overrides,
  };
  const file = await createMemoryFile(folder.id, name, serializeSkill(base, 'Fold skill'), USER, true);
  return file.id;
};

describe('fold paths feed the decay window + the evidence counter', () => {
  beforeEach(async () => {
    store = {};
    await initMemoryFiles(USER);
  });

  it('worth-gate MERGE fold appends recentOutcomes and grows evidenceCount', async () => {
    const fileId = await seedFoldSkill('fold-target.md');
    await maybeMergeSkill('fold-target', foldTrade('fold-1', TradeOutcome.WIN),
      [foldTrade('fold-1', TradeOutcome.WIN)], USER);
    const meta = parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === fileId)!.content)!;
    expect(meta.wins).toBe(2);
    // Pre-fix the merge fold bumped W/L only — alpha-decay could never see
    // this evidence and the provenance counter missed it too.
    expect(meta.recentOutcomes).toBe('W');
    expect(meta.evidenceCount).toBe(3); // legacy floor (2 tail ids) + this trade
  });

  it('CRAFT fold (ingestCraftedSkill re-seeing a trade) appends recentOutcomes + counter', async () => {
    const fileId = await seedFoldSkill('craft-target.md');
    await ingestCraftedSkill(foldTrade('craft-1', TradeOutcome.LOSS), {
      name: 'Craft target',
      kind: 'avoid',
      when: 'BTC short in Family A without a reclaim',
      inputs: ['price'],
      steps: ['skip the short'],
      validate: 'reclaim close',
      output: 'no trade',
      approval: 'draft',
      ifCondition: 'BTC short in Family A without a reclaim',
      thenAction: 'skip the short',
    }, USER);
    const meta = parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === fileId)!.content)!;
    expect(meta.losses).toBe(2);
    expect(meta.recentOutcomes).toBe('L');
    expect(meta.consecutiveLosses).toBe(1);
    expect(meta.evidenceCount).toBe(3);
  });
});

describe('age-band decay, CONTROL-excluded', () => {
  beforeEach(async () => {
    store = {};
    await initMemoryFiles(USER);
  });

  it('halves once per 30-day band (capped) — not exactly once regardless of age', async () => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const stale = new Date(Date.now() - (EVIDENCE_STALE_DAYS * 3 + 5) * 86_400_000).toISOString(); // ~95d
    const meta: SkillMeta = {
      status: 'candidate', kind: 'avoid', coin: 'BTCUSDT', direction: 'Short', family: 'Family A',
      wins: 16, losses: 16, consecutiveLosses: 0, tradeIds: ['o1'],
      lastEvidenceAt: stale, body: 'fade',
    };
    await createMemoryFile(folder.id, 'band-decay.md', serializeSkill(meta, 'Band decay'), USER, true);

    await applySkillEvidence(lossTrade('band-1'), USER, [lossTrade('band-1')]);

    const after = parseSkillMarkdown(getMemoryFiles().files.find(f => f.name === 'band-decay.md')!.content)!;
    // 3 full bands → 3 halvings (the cap): 16 → 8 → 4 → 2, then the LOSS counts.
    expect(after.wins).toBe(2);
    expect(after.losses).toBe(3);
    expect(EVIDENCE_DECAY_MAX_HALVINGS).toBe(3);
  });

  it('a CONTROL-routed trade never decays the skill record', async () => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const stale = new Date(Date.now() - (EVIDENCE_STALE_DAYS + 5) * 86_400_000).toISOString();
    const meta: SkillMeta = {
      status: 'confirmed', kind: 'avoid', coin: 'BTCUSDT', direction: 'Short', family: 'Family A',
      wins: 8, losses: 8, consecutiveLosses: 0, tradeIds: ['o1'],
      lastEvidenceAt: stale, body: 'fade',
    };
    await createMemoryFile(folder.id, 'ctrl-decay.md', serializeSkill(meta, 'Ctrl decay'), USER, true);
    // Telemetry: the trade's run injected a DIFFERENT skill → CONTROL.
    store[`memory_injections_v1_${USER}`] = [{
      ts: new Date().toISOString(),
      stage: 'opening', audience: 'analyst', coin: 'BTCUSDT', runId: 'run-ctrl-decay',
      sources: [{ path: 'skills/some-other-skill.md', kind: 'skill' }],
    }];
    const ctrl = { ...lossTrade('ctrl-decay-1'), sourceRunId: 'run-ctrl-decay' } as LoggedTrade;

    await applySkillEvidence(ctrl, USER, [ctrl]);

    const after = parseSkillMarkdown(getMemoryFiles().files.find(f => f.name === 'ctrl-decay.md')!.content)!;
    // Pre-fix, applyEvidenceDecay ran BEFORE the adherence check, so a
    // matched-but-not-injected outcome eroded the skill's lifetime counts
    // (16→8 style halving) even though it never counted toward the record.
    expect(after.wins).toBe(8);
    expect(after.losses).toBe(8);
    expect(after.controlIds).toContain('ctrl-decay-1');
    expect(after.recentOutcomes).toBeUndefined();
  });
});
