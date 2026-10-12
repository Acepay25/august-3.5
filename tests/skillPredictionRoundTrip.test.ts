import { describe, it, expect } from 'vitest';
import { serializeSkill, parseSkillMarkdown } from '../services/learning/SkillMemoryService';
import { defaultPrediction } from '../utils/skillPrediction';

describe('prediction round-trip', () => {
  it('a JSON prediction survives yamlString wrapping', () => {
    const meta: any = {
      name: 'Avoid BTC Short', kind: 'avoid', status: 'candidate',
      coin: 'BTC', direction: 'SHORT', description: 'Avoid BTC short',
      body: '**When:** shorting BTC after a failed sweep.\n**What I do:** wait for the reclaim close.',
      wins: 4, losses: 1, tradeIds: ['t1', 't2'], evidenceCount: 2,
      prediction: defaultPrediction({ coin: 'BTC' }),
    };
    const ser = serializeSkill(meta, 'Avoid BTC Short');
    const line = ser.split('\n').find(l => l.startsWith('prediction:'))!;
    expect(line).toMatch(/^prediction: "/);
    const back = parseSkillMarkdown(ser)!;
    expect(back.prediction).toBeTruthy();
    expect(back.prediction!.expectedLiftPts).toBe(10);
    expect(back.prediction!.horizonTrades).toBe(10);
    expect(back.prediction!.scope.coin).toBe('BTC');
  });
});
