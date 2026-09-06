import { describe, it, expect } from 'vitest';
import { repairStreamTail, splitStreamingBlocks, UNSTABLE_TAIL_BLOCKS } from '../utils/incrementalMarkdown';

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

describe('repairStreamTail', () => {
  it('leaves fully-closed markdown untouched', () => {
    expect(repairStreamTail('Plain text.')).toBe('Plain text.');
    expect(repairStreamTail('**bold** and `code`')).toBe('**bold** and `code`');
    expect(repairStreamTail('- a\n- b\n\ndone')).toBe('- a\n- b\n\ndone');
  });

  it('closes an unclosed bold marker', () => {
    expect(repairStreamTail('The bias is **bullish but')).toBe('The bias is **bullish but**');
  });

  it('closes an unclosed strikethrough', () => {
    expect(repairStreamTail('old view ~~wrong')).toBe('old view ~~wrong~~');
  });

  it('closes an unclosed inline code span', () => {
    expect(repairStreamTail('watch the `RSI level')).toBe('watch the `RSI level`');
  });

  it('closes an unclosed code fence with a matching marker', () => {
    const repaired = repairStreamTail('Plan:\n```js\nconst x = 1;');
    expect(repaired.endsWith('\n```')).toBe(true);
  });

  it('closes a tilde fence with a tilde marker', () => {
    const repaired = repairStreamTail('~~~\ncode');
    expect(repaired.endsWith('\n~~~')).toBe(true);
  });

  it('does not append inline closers while inside a fence', () => {
    const repaired = repairStreamTail('```\nunpaired ** and ` stay literal');
    expect(repaired).toBe('```\nunpaired ** and ` stay literal\n```');
  });

  it('handles a closed fence followed by new text', () => {
    expect(repairStreamTail('```\ncode\n```\n\nafter')).toBe('```\ncode\n```\n\nafter');
  });

  it('does not touch lone asterisks or underscores (ambiguous emphasis)', () => {
    expect(repairStreamTail('3 * 4 = 12 and snake_case_name')).toBe('3 * 4 = 12 and snake_case_name');
  });

  it('repairs the streaming tail of a live reply end to end', () => {
    const text = 'Intro paragraph.\n\nSecond **paragraph still';
    const { tail } = splitStreamingBlocks(text);
    expect(repairStreamTail(tail)).toBe('Intro paragraph.\n\nSecond **paragraph still**');
  });
});
