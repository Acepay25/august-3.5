import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PreferencesService — keyed store models the real API (each preference
// key holds its own value, per-user override maps live under their own key).
let store: Record<string, Record<string, string>> = {};
const { getPreferenceObjectMock } = vi.hoisted(() => ({
  getPreferenceObjectMock: vi.fn(async (key: string) => store[key] ?? null),
}));
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: getPreferenceObjectMock,
  setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
    store[key] = value as Record<string, string>;
  }),
  removePreference: vi.fn(async (key: string) => {
    delete store[key];
  }),
}));

import {
  initPromptOverrides,
  getPrompt,
  getPromptOverrides,
  savePromptOverride,
  resetPromptOverride,
  resetAllPromptOverrides,
  validatePromptOverride,
} from '../services/infrastructure/PromptOverrideService';

const FALLBACK = 'You are the built-in default prompt.';

describe('PromptOverrideService', () => {
  beforeEach(() => {
    store = {};
    vi.clearAllMocks();
    // initPromptOverrides reassigns the sync cache from storage, so an empty
    // store at the start of every test resets it.
  });

  it('falls back to the built-in default when no override exists', async () => {
    await initPromptOverrides('alice');
    expect(getPrompt('analysis.master', FALLBACK)).toBe(FALLBACK);
  });

  it('returns the user override after save (no reload needed)', async () => {
    await initPromptOverrides('alice');
    await savePromptOverride('analysis.master', 'You are Alice\'s custom analysis prompt.', 'alice');
    // The sync cache updates immediately — the next provider call sees it.
    expect(getPrompt('analysis.master', FALLBACK)).toBe('You are Alice\'s custom analysis prompt.');
    expect(store['prompt_overrides_v1_alice']).toMatchObject({ 'analysis.master': 'You are Alice\'s custom analysis prompt.' });
  });

  it('isolates overrides per user', async () => {
    await initPromptOverrides('alice');
    await savePromptOverride('analysis.master', 'alice version', 'alice');
    // Bob loads → empty cache → fallback.
    await initPromptOverrides('bob');
    expect(getPrompt('analysis.master', FALLBACK)).toBe(FALLBACK);
    // Alice comes back → her override is restored from storage.
    await initPromptOverrides('alice');
    expect(getPrompt('analysis.master', FALLBACK)).toBe('alice version');
  });

  it('clears an override when saved empty (back to default)', async () => {
    await initPromptOverrides('alice');
    await savePromptOverride('analysis.master', 'custom', 'alice');
    expect(getPrompt('analysis.master', FALLBACK)).toBe('custom');
    await savePromptOverride('analysis.master', '   ', 'alice');
    expect(getPrompt('analysis.master', FALLBACK)).toBe(FALLBACK);
  });

  it('resets a single override', async () => {
    await initPromptOverrides('alice');
    await savePromptOverride('analysis.master', 'custom', 'alice');
    await savePromptOverride('debate.rebuttal', 'rebuttal custom', 'alice');
    await resetPromptOverride('analysis.master', 'alice');
    expect(getPrompt('analysis.master', FALLBACK)).toBe(FALLBACK);
    expect(getPrompt('debate.rebuttal', 'rebuttal default')).toBe('rebuttal custom');
  });

  it('resets all overrides', async () => {
    await initPromptOverrides('alice');
    await savePromptOverride('analysis.master', 'custom', 'alice');
    await resetAllPromptOverrides('alice');
    expect(getPromptOverrides()).toEqual({});
    expect(getPrompt('analysis.master', FALLBACK)).toBe(FALLBACK);
  });

  it('ignores a blank override from storage (treats it as default)', async () => {
    store = { prompt_overrides_v1_alice: { 'analysis.master': '   ' } };
    await initPromptOverrides('alice');
    expect(getPrompt('analysis.master', FALLBACK)).toBe(FALLBACK);
  });
});

describe('validatePromptOverride', () => {
  it('warns on leftover JSON_PLAN and unknown placeholders', () => {
    const warnings = validatePromptOverride('Output <JSON_PLAN> and {{FOO}} and I am an AI.');
    expect(warnings.some(w => /JSON_PLAN/i.test(w))).toBe(true);
    expect(warnings.some(w => /FOO/.test(w))).toBe(true);
    expect(warnings.some(w => /I am an AI/i.test(w))).toBe(true);
  });

  it('allows known debate placeholders', () => {
    expect(validatePromptOverride('You are {{NAME}} in round {{ROUND}} for {{ANALYSTS}}.')).toEqual([]);
  });
});
