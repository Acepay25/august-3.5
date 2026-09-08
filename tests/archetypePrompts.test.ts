import { describe, it, expect } from 'vitest';
import {
  STRATEGY_ARCHETYPES,
  archetypeForSeat,
  archetypeDirectiveLine,
} from '../constants/prompts/archetypePrompts';
import { isStrategyFamily } from '../types/strategy';

describe('strategy archetypes', () => {
  it('covers five distinct families, each a controlled-vocabulary member', () => {
    expect(STRATEGY_ARCHETYPES.length).toBe(5);
    const names = new Set(STRATEGY_ARCHETYPES.map(a => a.name));
    expect(names.size).toBe(5);
    for (const a of STRATEGY_ARCHETYPES) {
      expect(isStrategyFamily(a.family)).toBe(true);
    }
  });

  it('rotates deterministically: seats 0–4 all differ, seat 5 wraps to seat 0', () => {
    const ids = [0, 1, 2, 3, 4].map(i => archetypeForSeat(i).id);
    expect(new Set(ids).size).toBe(5);
    expect(archetypeForSeat(5).id).toBe(archetypeForSeat(0).id);
    // Stable across calls — a seat keeps its identity for the whole debate.
    expect(archetypeForSeat(2).id).toBe(archetypeForSeat(2).id);
  });

  it('clamps negative and non-finite indices to the first archetype', () => {
    expect(archetypeForSeat(-1).id).toBe(STRATEGY_ARCHETYPES[0].id);
    expect(archetypeForSeat(NaN).id).toBe(STRATEGY_ARCHETYPES[0].id);
    expect(archetypeForSeat(2.7).id).toBe(archetypeForSeat(2).id);
  });

  it('the directive line names the archetype and demands divergence', () => {
    const line = archetypeDirectiveLine(1);
    expect(line).toContain('strategy archetype');
    expect(line).toContain(STRATEGY_ARCHETYPES[1].name);
    expect(line).toContain('do not abandon your lens');
  });
});
