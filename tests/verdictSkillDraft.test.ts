import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TradeAnalysis } from '../types';

// The notebook's skill list is mocked so the "already known" gate is
// observable without memory-file fixtures.
const { listSkillsMock } = vi.hoisted(() => ({
  listSkillsMock: vi.fn(() => [] as Array<{ file: unknown; meta: unknown }>),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
  listSkills: (() => listSkillsMock()) as never,
  skillMatchesSetup: vi.fn((meta: { status?: string }, setup: { family?: string }) =>
    meta.status !== 'retired' && Boolean(setup.family)),
}));

import { craftedSkillFromVerdict, maybeQueueVerdictSkillDraft } from '../utils/verdictSkillDraft';
import { listSkillDrafts } from '../utils/skillDrafts';

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

describe('verdict → skill draft', () => {
  beforeEach(() => {
    localStorage.clear();
    listSkillsMock.mockReset();
    listSkillsMock.mockReturnValue([]);
  });

  it('builds a repeat draft from a cited pattern family', () => {
    const crafted = craftedSkillFromVerdict(verdictAnalysis());
    expect(crafted).not.toBeNull();
    expect(crafted!.kind).toBe('repeat');
    expect(crafted!.ifCondition).toContain('BTC');
    expect(crafted!.ifCondition).toContain('Breakout');
    expect(crafted!.thenAction).toContain('Trend continuation');
  });

  it('builds an avoid draft for an Avoid verdict', () => {
    const crafted = craftedSkillFromVerdict(verdictAnalysis({
      direction: 'Neutral',
      confidence: 'Avoid',
      strategy: 'No edge here.',
    }));
    expect(crafted).not.toBeNull();
    expect(crafted!.kind).toBe('avoid');
    expect(crafted!.thenAction).toMatch(/stand aside/i);
  });

  it('returns null when the verdict cites no pattern', () => {
    expect(craftedSkillFromVerdict(verdictAnalysis({
      detectedPatternFamily: undefined,
      marketConditions: undefined,
    }))).toBeNull();
  });

  it('queues a draft when the notebook has no matching skill', () => {
    const draft = maybeQueueVerdictSkillDraft('msg-1', verdictAnalysis(), 'alice');
    expect(draft).not.toBeNull();
    expect(listSkillDrafts('alice').some(d => d.tradeId === 'msg-1')).toBe(true);
  });

  it('skips queueing when a notebook skill already covers the setup', () => {
    listSkillsMock.mockReturnValue([{ file: {}, meta: { status: 'confirmed' } }]);
    const draft = maybeQueueVerdictSkillDraft('msg-2', verdictAnalysis(), 'alice');
    expect(draft).toBeNull();
    expect(listSkillDrafts('alice')).toHaveLength(0);
  });

  it('skips queueing when there is no analysis', () => {
    expect(maybeQueueVerdictSkillDraft('msg-3', undefined, 'alice')).toBeNull();
  });
});
