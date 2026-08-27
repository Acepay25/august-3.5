import { describe, it, expect } from 'vitest';

import { parseIfThenClauses } from '../utils/ifThenSkill';

describe('parseIfThenClauses placeholder hardening', () => {
  it('drops a clause whose IF side is a placeholder', () => {
    const clauses = parseIfThenClauses(
      'IF not applicable THEN wait for the 15m reclaim before entering the position.'
    );
    expect(clauses).toEqual([]);
  });

  it('drops a clause whose THEN side is a placeholder', () => {
    const clauses = parseIfThenClauses(
      'IF price sweeps the prior session low THEN unknown.'
    );
    expect(clauses).toEqual([]);
  });

  it('drops a clause where both sides are placeholders', () => {
    const clauses = parseIfThenClauses('IF N/A THEN N/A.');
    expect(clauses).toEqual([]);
  });

  it('still parses a real IF/THEN clause (regression)', () => {
    const clauses = parseIfThenClauses(
      'IF price sweeps the prior session low and reclaims THEN wait for the 15m close back inside the range.'
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0].ifCondition).toContain('sweeps the prior session low');
    expect(clauses[0].thenAction).toContain('15m close back inside');
  });

  it('keeps real clauses while dropping placeholder ones in the same text', () => {
    const clauses = parseIfThenClauses(
      'IF unknown THEN skip the trade entirely.\n' +
      'IF funding spikes positive into the New York open THEN fade the move once the first 15m candle closes red.'
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0].ifCondition).toContain('funding spikes');
  });
});
