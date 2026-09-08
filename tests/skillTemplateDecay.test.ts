import { describe, it, expect } from 'vitest';
import {
  serializeSkill,
  parseSkillMarkdown,
  recentWindowStats,
  isDecayed,
  appendRecentOutcome,
  RECENT_WINDOW,
  DECAY_MIN_SAMPLES,
  type SkillMeta,
} from '../services/learning/SkillMemoryService';

const meta = (overrides: Partial<SkillMeta> = {}): SkillMeta => ({
  status: 'candidate',
  kind: 'repeat',
  wins: 0,
  losses: 0,
  consecutiveLosses: 0,
  tradeIds: [],
  body: 'Test body',
  ...overrides,
});

describe('SkillMeta strategy-template fields', () => {
  it('round-trips the book-template fields through frontmatter', () => {
    const original = meta({
      strategyFamily: 'trend_following',
      signals: 'HTF trend + pullback to 20 EMA',
      invalidation: 'Close below the pullback low',
      horizon: 'swing',
      sizing: 'half size beyond 2 ATR stretch',
      prior: 'book',
    });
    const parsed = parseSkillMarkdown(serializeSkill(original, 'Template skill'))!;
    expect(parsed.strategyFamily).toBe('trend_following');
    expect(parsed.signals).toBe('HTF trend + pullback to 20 EMA');
    expect(parsed.invalidation).toBe('Close below the pullback low');
    expect(parsed.horizon).toBe('swing');
    expect(parsed.sizing).toBe('half size beyond 2 ATR stretch');
    expect(parsed.prior).toBe('book');
  });

  it('rejects an invalid horizon and a non-book prior', () => {
    const content = serializeSkill(meta(), 'x')
      .replace('---\n', '---\nhorizon: forever\nprior: vibes\n');
    const parsed = parseSkillMarkdown(content)!;
    expect(parsed.horizon).toBeUndefined();
    expect(parsed.prior).toBeUndefined();
  });

  it('legacy files without the new fields parse unchanged', () => {
    const legacy = `---\nstatus: confirmed\nkind: avoid\nwins: 4\nlosses: 1\nconsecutiveLosses: 0\ntradeIds: a,b\n---\n\n# Old skill\n\nbody text\n`;
    const parsed = parseSkillMarkdown(legacy)!;
    expect(parsed.status).toBe('confirmed');
    expect(parsed.strategyFamily).toBeUndefined();
    expect(parsed.recentOutcomes).toBeUndefined();
  });
});

describe('alpha-decay window', () => {
  it('appendRecentOutcome tail-caps at RECENT_WINDOW', () => {
    const m = meta();
    for (let i = 0; i < RECENT_WINDOW + 5; i++) appendRecentOutcome(m, i % 2 === 0);
    expect(m.recentOutcomes!.length).toBe(RECENT_WINDOW);
    expect(m.recentOutcomes).toMatch(/^[WL]+$/);
  });

  it('recentWindowStats counts the window', () => {
    const m = meta({ recentOutcomes: 'WWLWLLLW' });
    expect(recentWindowStats(m)).toEqual({ wins: 4, losses: 4 });
    expect(recentWindowStats(meta())).toBeNull();
  });

  it('isDecayed fires only past the sample bar and the win-rate band', () => {
    const good = meta({ kind: 'repeat', recentOutcomes: 'WWWWWWWWWW' });
    expect(isDecayed(good)).toBe(false);
    const thin = meta({ kind: 'repeat', recentOutcomes: 'WLLL' });
    expect(isDecayed(thin)).toBe(false); // below DECAY_MIN_SAMPLES
    expect(DECAY_MIN_SAMPLES).toBeGreaterThan(4);
    const decayed = meta({ kind: 'repeat', recentOutcomes: 'WWLLLLLLLL' });
    expect(isDecayed(decayed)).toBe(true);
    // Mirrored for avoid-skills: an avoid rule that keeps "losing" (i.e. the
    // avoided setups keep winning) is decayed.
    const avoidDecayed = meta({ kind: 'avoid', recentOutcomes: 'LLWWWWWWWW' });
    expect(isDecayed(avoidDecayed)).toBe(true);
    const avoidFine = meta({ kind: 'avoid', recentOutcomes: 'LLWWLLLLLL' });
    expect(isDecayed(avoidFine)).toBe(false);
  });

  it('the window round-trips through serialize/parse and strips junk', () => {
    const m = meta({ recentOutcomes: 'WWLWL' });
    const parsed = parseSkillMarkdown(serializeSkill(m, 'x'))!;
    expect(parsed.recentOutcomes).toBe('WWLWL');
    const dirty = parseSkillMarkdown(
      serializeSkill(meta(), 'x').replace('---\n', '---\nrecentOutcomes: WwXl1Z\n'),
    )!;
    expect(dirty.recentOutcomes).toBe('WWL');
  });
});
