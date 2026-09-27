import { describe, it, expect } from 'vitest';
import {
  serializeSkill,
  parseSkillMarkdown,
  recentWindowStats,
  isDecayed,
  appendRecentOutcome,
  RECENT_WINDOW,
  DECAY_MIN_SAMPLES,
  DECAY_RECENT_WINRATE,
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

  it('recentWindowStats counts BOTH tokens — a dirty row is not a loss streak', () => {
    // `length - wins` counted every non-W byte as a loss, so a corrupt
    // "WLXL" read as 1W/3L: two losses invented out of junk the ledger never
    // counted, enough on its own to sink a window under the decay bar.
    expect(recentWindowStats(meta({ recentOutcomes: 'WLXL' }))).toEqual({ wins: 1, losses: 2 });
    // Junk only, and lower-case: neither invents evidence in either direction.
    expect(recentWindowStats(meta({ recentOutcomes: 'XXX' }))).toEqual({ wins: 0, losses: 0 });
    expect(recentWindowStats(meta({ recentOutcomes: 'wl' }))).toEqual({ wins: 1, losses: 1 });
    expect(isDecayed(meta({ kind: 'repeat', recentOutcomes: 'XXX' }))).toBe(false);
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

  it('needs TWO consecutive bad slices, not one point estimate', () => {
    // Sample floor boundary: exactly DECAY_MIN_SAMPLES is judgeable, one
    // fewer is not.
    expect(isDecayed(meta({ kind: 'repeat', recentOutcomes: 'WLLLLLLL' }))).toBe(true);
    expect(isDecayed(meta({ kind: 'repeat', recentOutcomes: 'WLLLLLL' }))).toBe(false);
    // The whole window is 20% on paper, but its FRESHEST 8 sit at 50%: the
    // skill is coming back. One aggregate point estimate used to bench it
    // anyway; the decay has to persist to the present to count.
    expect(isDecayed(meta({ kind: 'repeat', recentOutcomes: 'LLLLLLWWWW' }))).toBe(false);
    // Mirror for avoid: 8W/4L overall (decayed by the old rule) whose freshest
    // 8 are a coin flip.
    expect(isDecayed(meta({ kind: 'avoid', recentOutcomes: 'WWWWWWWWLLLL' }))).toBe(false);
    // Both slices under the bar still demotes.
    expect(isDecayed(meta({ kind: 'repeat', recentOutcomes: 'LLLLLLLLLL' }))).toBe(true);
  });

  it('the decay bar is strict — sitting ON it is not decay', () => {
    // 7W/13L is exactly DECAY_RECENT_WINRATE. The comparison is `<`, so a
    // window pinned to the bar is not evidence of decay.
    expect(DECAY_RECENT_WINRATE * 20).toBe(7);
    expect(isDecayed(meta({ kind: 'repeat', recentOutcomes: 'W'.repeat(7) + 'L'.repeat(13) }))).toBe(false);
    expect(isDecayed(meta({ kind: 'repeat', recentOutcomes: 'W'.repeat(6) + 'L'.repeat(14) }))).toBe(true);
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
