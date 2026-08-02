import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PreferencesService so provider configs live in an in-memory store
// (avoids touching localStorage / Capacitor Preferences in tests).
let store: unknown = null;
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async () => store),
  setPreferenceObject: vi.fn(async (_key: string, value: unknown) => {
    store = value;
  }),
}));

import {
  getDefaultConfigs,
  loadProviderConfigs,
  saveProviderConfigs,
  addCustomProvider,
  removeCustomProvider,
  addModelToProvider,
  removeModelFromProvider,
  updateModelInProvider,
  getReadyProviders,
} from '../services/infrastructure/ProviderConfigService';
import type { ProviderConfig } from '../types/provider';

const makeConfig = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'prov-a',
  name: 'Provider A',
  apiKey: '',
  baseUrl: 'https://api.example.com/v1',
  apiFormat: 'chat_completions',
  isEnabled: true,
  isBuiltIn: false,
  models: ['model-1', 'model-2'],
  selectedModel: 'model-1',
  ...overrides,
});

describe('ProviderConfigService', () => {
  beforeEach(() => {
    store = null;
  });

  describe('getDefaultConfigs', () => {
    it('returns no built-in providers (providers are fully user-configured)', () => {
      expect(getDefaultConfigs()).toEqual([]);
    });
  });

  describe('loadProviderConfigs', () => {
    it('returns an empty list when nothing is saved', async () => {
      expect(await loadProviderConfigs()).toEqual([]);
    });

    it('returns saved configs as-is', async () => {
      const saved = [makeConfig(), makeConfig({ id: 'prov-b', name: 'Provider B' })];
      store = saved;
      expect(await loadProviderConfigs()).toEqual(saved);
    });
  });

  describe('addCustomProvider / removeCustomProvider', () => {
    it('adds a provider with a generated id and isBuiltIn=false', async () => {
      const updated = await addCustomProvider({
        name: 'My LLM',
        baseUrl: 'https://llm.example.com/v1',
        apiKey: 'sk-test',
        apiFormat: 'chat_completions',
        models: ['m1'],
        selectedModel: 'm1',
      });
      expect(updated).toHaveLength(1);
      expect(updated[0].isBuiltIn).toBe(false);
      expect(updated[0].id).toMatch(/^custom-/);
      expect(updated[0].isEnabled).toBe(true);
    });

    it('removes any provider by id', async () => {
      store = [makeConfig(), makeConfig({ id: 'prov-b' })];
      const updated = await removeCustomProvider('prov-a');
      expect(updated.map((c) => c.id)).toEqual(['prov-b']);
    });
  });

  describe('model management', () => {
    beforeEach(() => {
      store = [makeConfig()];
    });

    it('adds a model and keeps the selected model stable', async () => {
      const updated = await addModelToProvider('prov-a', 'model-3');
      expect(updated[0].models).toEqual(['model-1', 'model-2', 'model-3']);
      expect(updated[0].selectedModel).toBe('model-1');
    });

    it('does not duplicate existing models', async () => {
      const updated = await addModelToProvider('prov-a', 'model-2');
      expect(updated[0].models).toEqual(['model-1', 'model-2']);
    });

    it('reselects another model when the selected one is removed', async () => {
      const updated = await removeModelFromProvider('prov-a', 'model-1');
      expect(updated[0].models).toEqual(['model-2']);
      expect(updated[0].selectedModel).toBe('model-2');
    });

    it('renames a model and follows the selected model', async () => {
      const updated = await updateModelInProvider('prov-a', 'model-1', 'model-1-v2');
      expect(updated[0].models).toEqual(['model-1-v2', 'model-2']);
      expect(updated[0].selectedModel).toBe('model-1-v2');
    });
  });

  describe('getReadyProviders', () => {
    it('returns an empty array when no keys are configured', () => {
      expect(getReadyProviders([makeConfig()])).toEqual([]);
    });

    it('returns only enabled providers that have an API key', () => {
      const configs = [
        makeConfig({ id: 'a', apiKey: 'key-a' }),
        makeConfig({ id: 'b', apiKey: '' }),
        makeConfig({ id: 'c', apiKey: 'key-c', isEnabled: false }),
      ];
      expect(getReadyProviders(configs).map((c) => c.id)).toEqual(['a']);
    });

    it('treats whitespace-only keys as not configured', () => {
      expect(getReadyProviders([makeConfig({ apiKey: '   ' })])).toEqual([]);
    });
  });

  describe('saveProviderConfigs', () => {
    it('persists the given configs', async () => {
      const configs = [makeConfig()];
      await saveProviderConfigs(configs);
      expect(store).toEqual(configs);
    });
  });
});
