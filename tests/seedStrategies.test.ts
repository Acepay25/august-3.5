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

import { initMemoryFiles, getMemoryFiles, getMemoryFilesContext, updateMemoryFile } from '../services/learning/MemoryFilesService';
import { parseSkillMarkdown, serializeSkill } from '../services/learning/SkillMemoryService';
import { ensureSeedSkills, SEED_SKILLS } from '../services/learning/seedStrategies';
import { STRATEGY_FAMILIES } from '../types/strategy';

const USER = 'seed-user';

describe('seed strategy corpus', () => {
  beforeEach(async () => {
    store = {};
    await initMemoryFiles(USER);
  });

  it('every seed serializes to a skill that parses back with its template fields', () => {
    for (const spec of SEED_SKILLS) {
      const parsed = parseSkillMarkdown(serializeSkill(spec.meta, spec.title));
      expect(parsed, spec.slug).not.toBeNull();
      expect(parsed!.prior).toBe('book');
      expect(parsed!.status).toBe('candidate');
      expect(parsed!.strategyFamily).toBeDefined();
      expect(STRATEGY_FAMILIES).toContain(parsed!.strategyFamily);
      expect(parsed!.signals).toBeTruthy();
      expect(parsed!.invalidation).toBeTruthy();
      expect(parsed!.horizon).toBeTruthy();
      expect(parsed!.body).toBeTruthy();
    }
  });

  it('slugs are unique and family coverage spans the crypto-executable families', () => {
    const slugs = SEED_SKILLS.map(s => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const families = new Set(SEED_SKILLS.map(s => s.meta.strategyFamily));
    // At least six of the eight families get a seed; the corpus is a prior,
    // not a census — but it must not leave the main chart families empty.
    expect(families.size).toBeGreaterThanOrEqual(6);
    expect(families.has('trend_following')).toBe(true);
    expect(families.has('mean_reversion')).toBe(true);
    expect(families.has('breakout')).toBe(true);
    expect(families.has('range_fade')).toBe(true);
  });

  it('ensureSeedSkills creates the corpus once and is idempotent', async () => {
    const created = await ensureSeedSkills(USER);
    expect(created.length).toBe(SEED_SKILLS.length);
    const files = getMemoryFiles().files.filter(f => f.name.startsWith('book-'));
    expect(files.length).toBe(SEED_SKILLS.length);
    // Second boot: nothing new, nothing overwritten.
    const again = await ensureSeedSkills(USER);
    expect(again).toEqual([]);
    expect(getMemoryFiles().files.filter(f => f.name.startsWith('book-')).length).toBe(SEED_SKILLS.length);
  });

  it('never resurrects a seed the user edited or retired', async () => {
    await ensureSeedSkills(USER);
    const target = getMemoryFiles().files.find(f => f.name === 'book-trend-pullback.md')!;
    const meta = parseSkillMarkdown(target.content)!;
    meta.status = 'retired';
    await updateMemoryFile(target.id, { content: serializeSkill(meta, 'Retired seed') }, USER);
    await ensureSeedSkills(USER);
    const after = getMemoryFiles().files.find(f => f.name === 'book-trend-pullback.md')!;
    expect(parseSkillMarkdown(after.content)!.status).toBe('retired');
  });

  it('book priors inject from birth (zero-evidence exemption) and are labeled', async () => {
    await ensureSeedSkills(USER);
    const context = getMemoryFilesContext(
      { coin: 'BTC', direction: 'Long', family: 'Family C', pattern: 'Family C', regime: 'trending' },
      [],
      'analyst',
      'opening',
    );
    expect(context).toContain('book-trend-pullback');
    expect(context).toContain('book prior');
  });

  it('a zero-evidence NON-prior skill stays out of injection', async () => {
    await ensureSeedSkills(USER);
    const { createMemoryFile } = await import('../services/learning/MemoryFilesService');
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(folder.id, 'hunch-skill.md', serializeSkill({
      status: 'candidate',
      kind: 'repeat',
      wins: 0,
      losses: 0,
      consecutiveLosses: 0,
      tradeIds: [],
      family: 'Family C',
      direction: 'Long',
      regime: 'trending',
      body: 'An unproven hunch with no evidence at all.',
    }, 'Hunch'), USER, true);
    const context = getMemoryFilesContext(
      { coin: 'BTC', direction: 'Long', family: 'Family C', pattern: 'Family C', regime: 'trending' },
      [],
      'analyst',
      'opening',
    );
    expect(context).not.toContain('hunch-skill');
  });
});
