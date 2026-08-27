import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
  setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
  removePreference: vi.fn(async (key: string) => {
    delete store[key];
  }),
}));

import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';

describe('first-boot notebook seed', () => {
  beforeEach(async () => {
    store = {};
    await initMemoryFiles('seed-user');
  });

  it('no longer seeds the unread market-conditions playbooks', () => {
    const names = getMemoryFiles().files.map(f => f.name);
    expect(names).not.toContain('ranging-day.md');
    expect(names).not.toContain('after-liquidity-sweep.md');
  });

  it('keeps the market-conditions folder so user notes still have a home', () => {
    expect(getMemoryFiles().folders.some(f => f.name === 'market-conditions')).toBe(true);
  });

  it('still seeds the personal risk rules starter', () => {
    const rules = getMemoryFiles().files.find(f => f.name === 'risk-rules.md');
    expect(rules).toBeDefined();
    expect(rules!.content).toContain('Personal Risk Rules');
  });
});
