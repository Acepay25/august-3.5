import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PreferencesService so provider configs live in an in-memory store
// (avoids touching localStorage / Capacitor Preferences in tests).
let store: unknown = null;
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async () => store),
  getPreferenceArray: vi.fn(async () => []),
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
  discoverProviderModels,
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

    it('keeps the Google Gemini generateContent format', async () => {
      store = [makeConfig({ id: 'gemini', name: 'Gemini', apiFormat: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' })];
      const loaded = await loadProviderConfigs();
      expect(loaded[0].apiFormat).toBe('google');
    });
  });

  describe('API key decryption (Electron safeStorage bridge)', () => {
    const setBridge = (decryptSecret: (payload: string) => Promise<string | null>) => {
      (window as unknown as { electronAPI: unknown }).electronAPI = {
        encryptSecret: vi.fn(async (plain: string) => `enc:v1:${plain}`),
        decryptSecret,
      };
    };
    const clearBridge = () => {
      delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    };

    it('returns the decrypted key when the bridge succeeds', async () => {
      setBridge(async (payload) => payload === 'enc:v1:xyz' ? 'sk-live' : null);
      store = [makeConfig({ apiKey: 'enc:v1:xyz' })];
      const loaded = await loadProviderConfigs();
      expect(loaded[0].apiKey).toBe('sk-live');
      expect(getReadyProviders(loaded).map((c) => c.id)).toEqual(['prov-a']);
      clearBridge();
    });

    it('FAILED decryption yields an EMPTY key (not-ready), never the ciphertext blob', async () => {
      setBridge(async () => null);
      store = [makeConfig({ apiKey: 'enc:v1:cipherblob' })];
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const loaded = await loadProviderConfigs();
      // Pre-fix this returned 'enc:v1:cipherblob' — non-empty, so it passed the
      // readiness check and was sent verbatim as the Bearer token.
      expect(loaded[0].apiKey).toBe('');
      expect(getReadyProviders(loaded)).toEqual([]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
      clearBridge();
    });

    it('a decrypt bridge that THROWS is also handled as not-ready', async () => {
      setBridge(async () => {
        throw new Error('keyring locked');
      });
      store = [makeConfig({ apiKey: 'enc:v1:cipherblob' })];
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const loaded = await loadProviderConfigs();
      expect(loaded[0].apiKey).toBe('');
      warn.mockRestore();
      clearBridge();
    });

    it('bridge-absent keeps the documented raw-payload passthrough (web/Capacitor plaintext)', async () => {
      clearBridge();
      store = [makeConfig({ apiKey: 'enc:v1:cipherblob' })];
      const loaded = await loadProviderConfigs();
      expect(loaded[0].apiKey).toBe('enc:v1:cipherblob');
    });

    it('plaintext (non-enc) values pass through untouched even with a bridge', async () => {
      setBridge(async () => null);
      store = [makeConfig({ apiKey: 'sk-plain' })];
      const loaded = await loadProviderConfigs();
      expect(loaded[0].apiKey).toBe('sk-plain');
      clearBridge();
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

    it('seeds NO phantom "default" model — a model-less add stays not-ready', async () => {
      const updated = await addCustomProvider({
        name: 'Bare',
        baseUrl: 'https://bare.example.com/v1',
        apiKey: 'sk-test',
        apiFormat: 'chat_completions',
      });
      expect(updated[0].models).toEqual([]);
      expect(updated[0].selectedModel).toBe('');
      expect(updated[0].ensembleModels).toEqual([]);
      // Pre-fix the ['default'] seed made this READY (apiKey present), so
      // callers sent model:'default' and 400'd on every call. It must stay
      // not-ready until the user refreshes/picks real models.
      expect(getReadyProviders(updated)).toEqual([]);
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

  describe('discoverProviderModels (/models endpoint)', () => {
    const okResponse = (body: unknown) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    } as Response);

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('parses the OpenAI-compatible { data: [{ id }] } shape', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        okResponse({ data: [{ id: 'deepseek-v4-flash-free' }, { id: 'nemotron-3-ultra-free' }, { id: 'deepseek-v4-flash-free' }] })
      );
      const models = await discoverProviderModels({ baseUrl: 'https://opencode.ai/zen/v1', apiKey: 'sk-test', apiFormat: 'chat_completions' });
      expect(models).toEqual(['deepseek-v4-flash-free', 'nemotron-3-ultra-free']);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://opencode.ai/zen/v1/models');
      expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-test' });
    });

    it('uses a key query param when the format is google even without a Gemini host', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        okResponse({ models: [{ name: 'models/gemini-2.5-flash' }] })
      );
      const models = await discoverProviderModels({
        baseUrl: 'https://ai.example.com/v1beta',
        apiKey: 'AIza-test',
        apiFormat: 'google',
      });
      expect(models).toEqual(['gemini-2.5-flash']);
      expect(fetchMock.mock.calls[0][0]).toBe('https://ai.example.com/v1beta/models?key=AIza-test');
    });

    it('parses the Gemini { models: [{ name }] } shape with a key query param', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        okResponse({ models: [{ name: 'models/gemini-2.0-flash' }, { name: 'models/gemini-2.5-pro' }] })
      );
      const models = await discoverProviderModels({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'gk-test', apiFormat: 'chat_completions' });
      expect(models).toEqual(['gemini-2.0-flash', 'gemini-2.5-pro']);
      expect(fetchMock.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=gk-test');
    });

    it('throws a user-safe error on HTTP failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
      } as Response);
      await expect(discoverProviderModels({ baseUrl: 'https://x.example/v1', apiKey: 'bad', apiFormat: 'chat_completions' }))
        .rejects.toThrow('Invalid API key');
    });

    it('throws when the response carries no models', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ data: [] }));
      await expect(discoverProviderModels({ baseUrl: 'https://x.example/v1', apiKey: 'k', apiFormat: 'chat_completions' }))
        .rejects.toThrow('returned no models');
    });

    it('uses the Electron discover bridge when present', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ data: [] }));
      const previous = (window as unknown as { electronAPI?: unknown }).electronAPI;
      (window as unknown as { electronAPI: unknown }).electronAPI = {
        isElectron: true,
        discoverModels: vi.fn(async () => ({
          ok: true,
          status: 200,
          body: JSON.stringify({ data: [{ id: 'gpt-4o' }] }),
        })),
      };
      try {
        const models = await discoverProviderModels({
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          apiFormat: 'chat_completions',
        });
        expect(models).toEqual(['gpt-4o']);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        (window as unknown as { electronAPI?: unknown }).electronAPI = previous;
      }
    });

    it('cleanses baseUrl ending in /models or /chat/completions so it calls <base url>/models', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        okResponse({ data: [{ id: 'model-clean-1' }] })
      );
      const models1 = await discoverProviderModels({
        baseUrl: 'https://api.openai.com/v1/models',
        apiKey: 'sk-test',
        apiFormat: 'chat_completions',
      });
      expect(models1).toEqual(['model-clean-1']);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');

      const models2 = await discoverProviderModels({
        baseUrl: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'sk-test',
        apiFormat: 'chat_completions',
      });
      expect(models2).toEqual(['model-clean-1']);
      expect(fetchMock.mock.calls[1][0]).toBe('https://api.openai.com/v1/models');
    });

    it('parses top-level arrays of strings or objects from <base url>/models', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okResponse(['model-alpha', 'model-beta'])
      );
      const stringArrModels = await discoverProviderModels({
        baseUrl: 'https://api.local.ai/v1',
        apiKey: 'sk-test',
        apiFormat: 'chat_completions',
      });
      expect(stringArrModels).toEqual(['model-alpha', 'model-beta']);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okResponse([{ id: 'obj-alpha' }, { name: 'obj-beta' }])
      );
      const objArrModels = await discoverProviderModels({
        baseUrl: 'https://api.local.ai/v1',
        apiKey: 'sk-test',
        apiFormat: 'chat_completions',
      });
      expect(objArrModels).toEqual(['obj-alpha', 'obj-beta']);
    });

    it('falls back to candidate endpoints when the primary /models returns 404', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Not Found',
        } as Response)
        .mockResolvedValueOnce(
          okResponse({ data: [{ id: 'fallback-model-1' }] })
        );

      const models = await discoverProviderModels({
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
        apiFormat: 'chat_completions',
      });
      expect(models).toEqual(['fallback-model-1']);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/models');
      expect(fetchMock.mock.calls[1][0]).toBe('https://api.openai.com/v1/models');
    });

    it('falls back to /api/tags for local endpoints when /models returns 404', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Not Found',
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Not Found',
        } as Response)
        .mockResolvedValueOnce(
          okResponse({ models: [{ name: 'llama3:latest' }] })
        );

      const models = await discoverProviderModels({
        baseUrl: 'http://localhost:11434',
        apiKey: '',
        apiFormat: 'chat_completions',
      });
      expect(models).toEqual(['llama3:latest']);
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/models');
      expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:11434/v1/models');
      expect(fetchMock.mock.calls[2][0]).toBe('http://localhost:11434/api/tags');
    });
  });
});
