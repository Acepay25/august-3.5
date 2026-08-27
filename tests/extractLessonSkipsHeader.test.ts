import { describe, it, expect } from 'vitest';

import { extractLessonFromPostMortem } from '../services/learning/MemoryFilesService';

describe('extractLessonFromPostMortem header-mining guard', () => {
  it('skips a bold-wrapped section title after "Lesson:" and finds the real lesson below', () => {
    const pm = [
      '**Lesson: 🩸 LOSS FORENSIC ANALYSIS — BTCUSDT LONG (2026-08-13)**',
      '',
      'The actual lesson is to wait for the 15m reclaim before re-entering.',
    ].join('\n');
    expect(extractLessonFromPostMortem(pm)).toBe(
      'The actual lesson is to wait for the 15m reclaim before re-entering.'
    );
  });

  it('skips a markdown heading shaped like a lesson and falls back to the body', () => {
    const pm = [
      '# Lesson: bold takeaway',
      '',
      'When the sweep fails to close beyond the level, wait for the 15m close back inside.',
    ].join('\n');
    expect(extractLessonFromPostMortem(pm)).toBe(
      'When the sweep fails to close beyond the level, wait for the 15m close back inside.'
    );
  });

  it('rejects an ALL-CAPS title captured after the Lesson: prefix', () => {
    const pm = [
      'Lesson: 🩸 LOSS FORENSIC ANALYSIS — BTCUSDT LONG (2026-08-13)',
      '',
      'Do not add to a losing position while funding is still negative.',
    ].join('\n');
    expect(extractLessonFromPostMortem(pm)).toBe(
      'Do not add to a losing position while funding is still negative.'
    );
  });

  it('still extracts a plain inline lesson (legacy behavior)', () => {
    const pm = 'Lesson: wait for the reclaim of the swept level before entering any short.';
    expect(extractLessonFromPostMortem(pm)).toBe(
      'wait for the reclaim of the swept level before entering any short.'
    );
  });

  it('returns nothing when the post-mortem is only a title', () => {
    const pm = '**Lesson: 🩸 LOSS FORENSIC ANALYSIS — BTCUSDT LONG (2026-08-13)**';
    expect(extractLessonFromPostMortem(pm)).toBe('');
  });

  it('returns nothing for an empty post-mortem', () => {
    expect(extractLessonFromPostMortem('')).toBe('');
  });
});
