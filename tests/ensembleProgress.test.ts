import { describe, expect, it } from 'vitest';
import type { EnsembleProgress } from '../types';

const updateAnalyst = (progress: EnsembleProgress, key: string, update: Partial<EnsembleProgress['analysts'][number]>): EnsembleProgress => ({
  ...progress,
  analysts: progress.analysts.map(analyst => analyst.key === key ? { ...analyst, ...update } : analyst),
});

describe('ensemble analyst progress', () => {
  const initial: EnsembleProgress = {
    analysts: [
      { key: 'a:model-a', providerId: 'a', providerName: 'Provider A', modelId: 'model-a', modelName: 'model-a', displayName: 'Macro', status: 'waiting' },
      { key: 'b:model-b', providerId: 'b', providerName: 'Provider B', modelId: 'model-b', modelName: 'model-b', displayName: 'Technical', status: 'waiting' },
    ],
    moderator: { status: 'waiting', waitingFor: ['Macro', 'Technical'] },
  };

  it('updates one analyst without changing the other entry', () => {
    const next = updateAnalyst(initial, 'a:model-a', { status: 'complete', finalOutput: 'Long above 123.4' });

    expect(next.analysts[0]).toMatchObject({ status: 'complete', finalOutput: 'Long above 123.4' });
    expect(next.analysts[1]).toMatchObject({ status: 'waiting' });
    expect(next.moderator).toMatchObject({ status: 'waiting', waitingFor: ['Macro', 'Technical'] });
  });

  it('represents the moderator review state only after all analysts settle', () => {
    const settled = updateAnalyst(
      updateAnalyst(initial, 'a:model-a', { status: 'complete' }),
      'b:model-b',
      { status: 'error', error: 'Unavailable' },
    );
    const reviewing: EnsembleProgress = { ...settled, moderator: { status: 'reviewing' } };

    expect(reviewing.analysts.every(analyst => analyst.status === 'complete' || analyst.status === 'error')).toBe(true);
    expect(reviewing.moderator).toEqual({ status: 'reviewing' });
  });

  it('keeps progress separate from persisted trade fields', () => {
    const persistedTrade = {
      modelsUsed: { 'a:model-a': 'model-a' },
      thoughtProcesses: { 'a:model-a': 'analysis' },
      debateTurns: [],
    };

    expect(persistedTrade).not.toHaveProperty('ensembleProgress');
  });
});
