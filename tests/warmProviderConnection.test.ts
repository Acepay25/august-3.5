import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderConfig } from '../types/provider';
import { warmProviderConnection } from '../services/providers/GenericProviderService';

const config: ProviderConfig = {
  id: 'prov-a',
  name: 'Provider A',
  apiKey: 'key-a',
  baseUrl: 'https://api.example.com/v1',
  apiFormat: 'chat_completions',
  isEnabled: true,
  isBuiltIn: true,
  models: ['model-a'],
  selectedModel: 'model-a',
};

describe('warmProviderConnection', () => {
  const fetchMock = vi.fn(async () => new Response());
  let originalLocation: Location;

  const setHostname = (hostname: string): void => {
    // jsdom's location is read-only — swap it for a plain object.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, hostname },
    });
  };

  beforeEach(() => {
    originalLocation = window.location;
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.unstubAllGlobals();
  });

  it('fires a no-cors HEAD at the provider origin off localhost', () => {
    setHostname('floor.august.app');
    warmProviderConnection(config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com');
    expect(init.method).toBe('HEAD');
    expect(init.mode).toBe('no-cors');
  });

  it('is a no-op on localhost (dev server proxies anyway)', () => {
    setHostname('localhost');
    warmProviderConnection(config);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op inside Electron (session pooling handles it)', () => {
    setHostname('floor.august.app');
    (window as { electronAPI?: { isElectron?: boolean } }).electronAPI = { isElectron: true };
    warmProviderConnection(config);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the provider has no baseUrl', () => {
    setHostname('floor.august.app');
    warmProviderConnection({ ...config, baseUrl: '' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the warm-up fetch rejects', async () => {
    setHostname('floor.august.app');
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(() => warmProviderConnection(config)).not.toThrow();
    // Let the rejected promise settle so its swallowed catch runs.
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});
