import { describe, it, expect } from 'vitest';

import { isMeaningfulLabel } from '../utils/meaningfulLabel';

describe('isMeaningfulLabel', () => {
  it('rejects the literal placeholder labels the schema defaults to', () => {
    expect(isMeaningfulLabel('N/A')).toBe(false);
    expect(isMeaningfulLabel('n/a')).toBe(false);
    expect(isMeaningfulLabel('none')).toBe(false);
    expect(isMeaningfulLabel('None')).toBe(false);
    expect(isMeaningfulLabel('null')).toBe(false);
    expect(isMeaningfulLabel('undefined')).toBe(false);
    expect(isMeaningfulLabel('unknown')).toBe(false);
    expect(isMeaningfulLabel('not applicable')).toBe(false);
    expect(isMeaningfulLabel('TBD')).toBe(false);
    expect(isMeaningfulLabel('-')).toBe(false);
    expect(isMeaningfulLabel('—')).toBe(false);
    expect(isMeaningfulLabel('...')).toBe(false);
  });

  it('rejects non-strings and near-empty values', () => {
    expect(isMeaningfulLabel(undefined)).toBe(false);
    expect(isMeaningfulLabel(null)).toBe(false);
    // 2-char strings are too short to be a real label.
    expect(isMeaningfulLabel('ok')).toBe(false);
    expect(isMeaningfulLabel('')).toBe(false);
  });

  it('accepts real pattern labels', () => {
    expect(isMeaningfulLabel('Breakout')).toBe(true);
    expect(isMeaningfulLabel('Family A')).toBe(true);
    expect(isMeaningfulLabel('liquidity sweep')).toBe(true);
    expect(isMeaningfulLabel('range')).toBe(true);
  });

  it('sees through markdown decoration around a placeholder', () => {
    expect(isMeaningfulLabel('**N/A**')).toBe(false);
    expect(isMeaningfulLabel('`none`')).toBe(false);
    expect(isMeaningfulLabel('> unknown')).toBe(false);
    expect(isMeaningfulLabel('  Not  Applicable  ')).toBe(false);
  });
});
