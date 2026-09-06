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

// Provider layer mocked so no LLM call can leak into the integrity check.
vi.mock('../services/providers/GenericProviderService', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getQuickResponse: vi.fn(async () => ''),
}));
vi.mock('../services/infrastructure/ProviderConfigService', () => ({
  loadProviderConfigs: vi.fn(async () => []),
  getReadyProviders: (configs: unknown[]) => configs,
}));

import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import {
  maybeUpsertSkill,
  parseSkillMarkdown,
  serializeSkill,
  titleFromMeta,
  skillMatchesSetup,
  MIN_CLUSTER_FOR_SKILL,
} from '../services/learning/SkillMemoryService';
import { resolveInvokedSkills, formatInvokedSkillSection } from '../services/learning/SkillMemoryService';
import { LoggedTrade, TradeOutcome } from '../types';

const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
  id: 't1',
  analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as any,
  outcome: TradeOutcome.LOSS,
  timestamp: '2026-08-09T12:00:00.000Z',
  postMortem: '**Key Lesson:** Wait for the 15m reclaim before entering.',
  ...overrides,
});

// "Is the skill PROPERLY created?" — the file-integrity contract for the
// mining writer. Creation coverage lives in harnessMemory.test.ts; this
// suite pins the SHAPE of what lands on disk, because a skill that parses
// wrong (bad frontmatter, missing evidence, empty body) silently drops out
// of every downstream consumer: invocation, matching, veto, eval.
describe('created skill file integrity', () => {
  let created: NonNullable<Awaited<ReturnType<typeof maybeUpsertSkill>>>;

  beforeEach(async () => {
    store = {};
    await initMemoryFiles('integrity-user');
    const trades = Array.from({ length: MIN_CLUSTER_FOR_SKILL }, (_, i) =>
      makeTrade({ id: `t-${i}`, timestamp: `2026-08-0${i + 1}T12:00:00.000Z` }),
    );
    const result = await maybeUpsertSkill(trades[2], trades, 'integrity-user');
    if (!result) throw new Error('expected the writer to create a skill');
    created = result;
  });

  it('lands as a slug-named markdown file in the skills folder', () => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    const file = getMemoryFiles().files.find(f => f.id === created.id);
    expect(folder).toBeTruthy();
    expect(file).toBeTruthy();
    expect(file!.name).toMatch(/^[a-z0-9-]+\.md$/);
    expect(file!.name.endsWith('.md')).toBe(true);
  });

  it('serializes a valid frontmatter block that round-trips', () => {
    expect(created.content.startsWith('---\n')).toBe(true);
    const end = created.content.indexOf('\n---\n', 4);
    expect(end).toBeGreaterThan(0);
    const meta = parseSkillMarkdown(created.content);
    expect(meta).not.toBeNull();
    // Round-trip: re-serializing the parsed meta parses back to the same
    // identity — serialize/parse are inverses for what the writer wrote.
    const reserialized = serializeSkill(meta!, titleFromMeta(meta!));
    const reparsed = parseSkillMarkdown(reserialized)!;
    expect(reparsed.kind).toBe(meta!.kind);
    expect(reparsed.coin).toBe(meta!.coin);
    expect(reparsed.losses).toBe(meta!.losses);
    expect(reparsed.ifCondition).toBe(meta!.ifCondition);
    expect(reparsed.thenAction).toBe(meta!.thenAction);
  });

  it('carries complete evidence: counts, provenance, streak, prediction, description', () => {
    const meta = parseSkillMarkdown(created.content)!;
    expect(meta.status).toBe('candidate');
    expect(meta.kind).toBe('avoid');
    expect(meta.coin).toBe('BTCUSDT');
    expect(meta.direction).toBe('Short');
    expect(meta.family).toBe('Family A');
    expect(meta.wins).toBe(0);
    expect(meta.losses).toBe(MIN_CLUSTER_FOR_SKILL);
    expect(meta.consecutiveLosses).toBe(MIN_CLUSTER_FOR_SKILL);
    expect(meta.tradeIds).toEqual(['t-0', 't-1', 't-2']);
    expect(meta.evidenceCount).toBe(MIN_CLUSTER_FOR_SKILL);
    // Birth certificate: every new skill leaves with a falsifiable claim.
    expect(meta.prediction).toBeTruthy();
    // A skill without a one-line summary is invisible to the index and
    // the /slug menu — the writer derives one; it must be non-empty.
    expect((meta.description ?? '').length).toBeGreaterThan(0);
  });

  it('has a non-empty instruction body (a claim about the market)', () => {
    const meta = parseSkillMarkdown(created.content)!;
    expect(meta.body?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it('is usable downstream: matches its setup, resolves by /slug, renders in the section', () => {
    const meta = parseSkillMarkdown(created.content)!;
    // Matching: the cluster that produced it must match it (a skill that
    // cannot match its own birth setup would never fire again).
    expect(skillMatchesSetup(meta, {
      coin: 'BTCUSDT', direction: 'Short', family: 'Family A',
    })).toBe(true);
    // Invocation: /slug resolves with kind, status and body.
    const slug = created.name.replace(/\.md$/i, '');
    const rows = resolveInvokedSkills([slug]);
    expect(rows[0].found).toBe(true);
    expect(rows[0].kind).toBe('avoid');
    expect(rows[0].body).toBeTruthy();
    const section = formatInvokedSkillSection(rows);
    expect(section).toContain(`### ${slug}`);
    expect(section).toContain('avoid skill · candidate');
  });
});
