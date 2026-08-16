import { describe, it, expect } from 'vitest';
import { splitStreamingBlocks, UNSTABLE_TAIL_BLOCKS } from '../utils/incrementalMarkdown';

describe('splitStreamingBlocks', () => {
  it('returns a single tail block for short text', () => {
    const { frozen, tail } = splitStreamingBlocks('Hello world');
    expect(frozen).toEqual([]);
    expect(tail).toBe('Hello world');
  });

  it('keeps the last two blocks hot and freezes the head', () => {
    expect(UNSTABLE_TAIL_BLOCKS).toBe(2);
    const { frozen, tail } = splitStreamingBlocks('One.\n\nTwo.\n\nThree.\n\nFour.');
    expect(frozen).toEqual(['One.', 'Two.']);
    expect(tail).toBe('Three.\n\nFour.');
  });

  it('does not split inside a code fence', () => {
    const text = 'Intro.\n\n```\ncode line 1\n\ncode line 2\n```\n\nClosing.';
    const { frozen, tail } = splitStreamingBlocks(text);
    expect(frozen).toEqual(['Intro.']);
    expect(tail).toContain('code line 1');
    expect(tail).toContain('code line 2');
    expect(tail).toContain('Closing.');
  });

  it('keeps frozen head blocks byte-identical as the tail grows (append-only)', () => {
    const early = splitStreamingBlocks('Alpha.\n\nBeta.\n\nGamma.');
    const later = splitStreamingBlocks('Alpha.\n\nBeta.\n\nGamma.\n\nDelta.\n\nEpsilon.\n\nZeta.');
    // Alpha is frozen in both; once far enough ahead of the hot tail it never
    // changes identity, so memoized renders are skipped on every later delta.
    expect(early.frozen).toContain('Alpha.');
    expect(later.frozen).toContain('Alpha.');
    expect(later.frozen).toContain('Beta.');
    expect(later.tail).toBe('Epsilon.\n\nZeta.');
  });

  it('handles empty input', () => {
    const { frozen, tail } = splitStreamingBlocks('');
    expect(frozen).toEqual([]);
    expect(tail).toBe('');
  });
});
