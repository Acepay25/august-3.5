import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PreferencesService so the service never touches Capacitor Preferences
// (the localStorage path is exercised directly in the selection test).
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async () => null),
  setPreferenceObject: vi.fn(async () => {}),
  PREF_KEYS: {
    ANALYST_LENS_CONFIG: 'analyst_lens_config',
    ENSEMBLE_MODEL_SELECTION: 'ensemble_model_selection',
  },
}));

import {
  getRoleForProvider,
  loadEnsembleModelSelection,
} from '../services/ui/AnalystLensService';
import { AnalystRole } from '../types/enums';

describe('AnalystLensService role lookup', () => {
  const config = [
    { role: AnalystRole.MACRO_VOLATILITY, assignedProvider: 'gemini', assignedModel: 'model-x' },
    { role: AnalystRole.TECHNICAL_ANALYST, assignedProvider: 'deepseek', assignedModel: undefined },
  ];

  it('matches the canonical `provider::model` key', () => {
    expect(getRoleForProvider('gemini::model-x', config)).toBe(AnalystRole.MACRO_VOLATILITY);
  });

  it('matches the pipeline\'s legacy single-colon `provider:model` key', () => {
    // The pipeline's thoughtsKey used a single colon while the lookup split on
    // double colon — that silently returned UNASSIGNED and the lens prompt was
    // never injected. Both separators must resolve now.
    expect(getRoleForProvider('gemini:model-x', config)).toBe(AnalystRole.MACRO_VOLATILITY);
  });

  it('falls back to the provider-only assignment when no model is set', () => {
    expect(getRoleForProvider('deepseek::any-model', config)).toBe(AnalystRole.TECHNICAL_ANALYST);
    expect(getRoleForProvider('deepseek:any-model', config)).toBe(AnalystRole.TECHNICAL_ANALYST);
  });

  it('returns UNASSIGNED for providers without an assignment', () => {
    expect(getRoleForProvider('openrouter::model-z', config)).toBe(AnalystRole.UNASSIGNED);
    expect(getRoleForProvider('openrouter:model-z', config)).toBe(AnalystRole.UNASSIGNED);
  });
});

describe('loadEnsembleModelSelection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns an empty array when nothing is stored', () => {
    expect(loadEnsembleModelSelection()).toEqual([]);
  });

  it('filters malformed entries and caps the selection at 3', () => {
    localStorage.setItem('ensemble_model_selection', JSON.stringify([
      { providerId: 'gemini', model: 'm1' },
      { providerId: 'deepseek', model: 'm2' },
      { bad: 'entry' },
      { providerId: 'zhipu', model: 'm3' },
      { providerId: 'groq', model: 'm4' },
    ]));

    const selection = loadEnsembleModelSelection();
    expect(selection).toHaveLength(3);
    expect(selection[0]).toEqual({ providerId: 'gemini', model: 'm1' });
    expect(selection[1]).toEqual({ providerId: 'deepseek', model: 'm2' });
    expect(selection[2]).toEqual({ providerId: 'zhipu', model: 'm3' });
  });
});
