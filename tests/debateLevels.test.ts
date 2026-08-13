import { describe, it, expect } from 'vitest';
import { extractDebateLevels, formatDebateLevelsTable } from '../utils/debateLevels';

describe('debateLevels', () => {
  it('extracts labeled markdown levels', () => {
    const row = extractDebateLevels(
      'Technical',
      '- **Direction:** Short\n- **Entry:** 63710\n- **Stop Loss:** 64510\n- **Take Profit 1:** 63210\n- **Take Profit 2:** 62710\n- **Take Profit 3:** 62200',
    );
    expect(row.speaker).toBe('Technical');
    expect(row.direction).toBe('Short');
    expect(row.entry).toBe('63710');
    expect(row.stopLoss).toBe('64510');
    expect(row.tp1).toBe('63210');
    expect(row.tp2).toBe('62710');
    expect(row.tp3).toBe('62200');
  });

  it('falls back to prose labels', () => {
    const row = extractDebateLevels('Macro', 'Direction: Long. Entry 100. Stop loss 90. Take profit 120.');
    expect(row.direction).toBe('Long');
    expect(row.entry).toBe('100');
    expect(row.stopLoss).toBe('90');
    expect(row.tp1).toBe('120');
  });

  it('formats a stable GFM snapshot', () => {
    const table = formatDebateLevelsTable([
      extractDebateLevels('A', 'Direction: Short. Entry 1. SL 2. TP1 0.5'),
    ]);
    expect(table).toContain('| Speaker | Dir | Entry | SL | TP1 | TP2 | TP3 |');
    expect(table).toContain('| A |');
    expect(table).toContain('Do not invent a parallel tape');
  });
});
