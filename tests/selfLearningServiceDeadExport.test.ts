import { describe, it, expect } from 'vitest';

import * as SelfLearningService from '../services/learning/SelfLearningService';

describe('SelfLearningService dead-export purge', () => {
  // These three exports had zero runtime callers (verified by tracing
  // import → call sites, not just import counts) and were removed with the
  // learning-loop dead-code purge. This test pins the removal so a
  // "restore for symmetry" refactor can't silently bring them back.
  const mod = SelfLearningService as unknown as Record<string, unknown>;

  it('no longer exports the unused lesson/setup-stats API', () => {
    expect('generateLearningContext' in mod).toBe(false);
    expect('extractLessonsFromTrade' in mod).toBe(false);
    expect('getSetupSpecificStats' in mod).toBe(false);
  });

  it('still exports the live learning-profile API', () => {
    expect(typeof mod.computeLearningProfile).toBe('function');
  });
});
