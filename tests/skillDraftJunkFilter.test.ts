import { describe, it, expect, vi } from 'vitest';
import { TradeAnalysis } from '../types';

// Same mock seam as verdictSkillDraft.test.ts — the junk filter under test
// lives BEFORE the notebook lookup, so the mock only needs to exist.
vi.mock('../services/learning/SkillMemoryService', () => ({
  listSkills: vi.fn(() => [] as Array<{ file: unknown; meta: unknown }>),
  skillMatchesSetup: vi.fn(() => false),
}));

import { craftedSkillFromVerdict } from '../utils/verdictSkillDraft';

const verdictAnalysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
  coinName: 'BTCUSDT',
  direction: 'Long',
  tradeType: 'swing',
  confidence: 'High',
  probability: 75,
  grade: 'B',
  strategy: 'Trend continuation above the 15m EMA.',
  activeStrategies: ['Momentum Trading'],
  entryPoints: [{ description: 'Breakout retest', price: '95000' }],
  detectedPatternFamily: 'Breakout',
  ...overrides,
} as TradeAnalysis);

describe('verdict skill drafts reject placeholder pattern citations', () => {
  it('does NOT draft a skill when detectedPatternFamily is the schema default "N/A"', () => {
    // schemas/tradeAnalysis.ts defaults missing pattern fields to the
    // literal 'N/A' — truthy, so the old guard drafted "N/A pattern" skills.
    expect(craftedSkillFromVerdict(verdictAnalysis({ detectedPatternFamily: 'N/A' }))).toBeNull();
  });

  it('does NOT fall back to a placeholder marketConditions.pattern either', () => {
    expect(craftedSkillFromVerdict(verdictAnalysis({
      detectedPatternFamily: undefined,
      marketConditions: { pattern: 'None' } as TradeAnalysis['marketConditions'],
    }))).toBeNull();
  });

  it('treats other junk labels the same way', () => {
    for (const junk of ['n/a', 'unknown', 'not applicable', '-', '...']) {
      expect(craftedSkillFromVerdict(verdictAnalysis({ detectedPatternFamily: junk }))).toBeNull();
    }
  });

  it('still drafts from a real cited family (regression)', () => {
    const crafted = craftedSkillFromVerdict(verdictAnalysis({ detectedPatternFamily: 'Breakout' }));
    expect(crafted).not.toBeNull();
    expect(crafted!.ifCondition).toContain('Breakout');
  });

  it('still drafts from a real marketConditions.pattern fallback (regression)', () => {
    const crafted = craftedSkillFromVerdict(verdictAnalysis({
      detectedPatternFamily: undefined,
      marketConditions: { pattern: 'liquidity sweep' } as TradeAnalysis['marketConditions'],
    }));
    expect(crafted).not.toBeNull();
    expect(crafted!.ifCondition).toContain('liquidity sweep');
  });
});
