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
