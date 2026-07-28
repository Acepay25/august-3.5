import { describe, it, expect, vi } from 'vitest';

// Mock PreferencesService so loadProviderConfigs falls back to defaults
// (avoids touching localStorage / Capacitor Preferences in tests).
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn().mockResolvedValue(null),
  setPreferenceObject: vi.fn().mockResolvedValue(undefined),
}));

import {
  getDefaultConfigs,
  loadProviderConfigs,
  getReadyProviders,
} from '../services/infrastructure/ProviderConfigService';
import { getPreferenceObject } from '../services/infrastructure/PreferencesService';

describe('ProviderConfigService', () => {
  describe('getDefaultConfigs', () => {
    it('returns 7 built-in providers, all with isBuiltIn=true', () => {
      const configs = getDefaultConfigs();
      expect(configs).toHaveLength(7);
      expect(configs.every((c) => c.isBuiltIn === true)).toBe(true);
    });

    it('has the correct provider ids', () => {
      const configs = getDefaultConfigs();
      const ids = configs.map((c) => c.id);
      expect(ids).toEqual([
        'gemini',
        'deepseek',
        'openai',
        'groq',
        'openrouter',
        'zhipu',
        'grok',
      ]);
    });

    it('returns providers with empty API keys by default', () => {
      const configs = getDefaultConfigs();
      expect(configs.every((c) => c.apiKey === '')).toBe(true);
    });
  });

  describe('loadProviderConfigs', () => {
    it('falls back to default configs when nothing is saved', async () => {
      vi.mocked(getPreferenceObject).mockResolvedValueOnce(null);
      const configs = await loadProviderConfigs();
      expect(configs).toEqual(getDefaultConfigs());
    });
  });

  describe('getReadyProviders', () => {
    it('returns an empty array when no keys are configured', () => {
      const configs = getDefaultConfigs(); // all have apiKey: ''
      expect(getReadyProviders(configs)).toEqual([]);
    });

    it('returns only enabled providers that have an API key', () => {
      const configs = getDefaultConfigs().map((c) =>
        c.id === 'gemini' || c.id === 'deepseek'
          ? { ...c, apiKey: 'test-key-123' }
          : c
      );
      // gemini and deepseek are enabled by default and now have keys
      const ready = getReadyProviders(configs);
      expect(ready.map((c) => c.id).sort()).toEqual(['deepseek', 'gemini']);
    });

    it('excludes disabled providers even if they have keys', () => {
      const configs = getDefaultConfigs().map((c) =>
        c.id === 'openai'
          ? { ...c, apiKey: 'sk-test-key', isEnabled: false }
          : c.id === 'gemini'
            ? { ...c, apiKey: 'gemini-key', isEnabled: true }
            : c
      );
      const ready = getReadyProviders(configs);
      expect(ready.map((c) => c.id)).toEqual(['gemini']);
      expect(ready.map((c) => c.id)).not.toContain('openai');
    });

    it('treats whitespace-only keys as not configured', () => {
      const configs = getDefaultConfigs().map((c) =>
        c.id === 'gemini' ? { ...c, apiKey: '   ' } : c
      );
      expect(getReadyProviders(configs)).toEqual([]);
    });
  });
});
