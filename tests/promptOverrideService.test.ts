import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PreferencesService — keyed store models the real API (each preference
// key holds its own value, per-user override maps live under their own key).
let store: Record<string, Record<string, string>> = {};
const { getPreferenceObjectMock } = vi.hoisted(() => ({
  getPreferenceObjectMock: vi.fn(async (key: string) => store[key] ?? null),
}));
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: getPreferenceObjectMock,
  getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
    const raw = await getPreferenceObjectMock(key);
    if (!Array.isArray(raw)) return [];
    return guard ? raw.filter(guard) : raw;
  }),
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
    await savePromptOverride('analysis.compact', 'compact custom', 'alice');
    await savePromptOverride('analysis.master', 'master custom', 'alice');
    await resetPromptOverride('analysis.compact', 'alice');
    expect(getPrompt('analysis.compact', FALLBACK)).toBe(FALLBACK);
    expect(getPrompt('analysis.master', 'master default')).toBe('master custom');
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
    expect(validatePromptOverride('You are {{NAME}} in round {{ROUND}} for {{ANALYSTS}} with {{OTHERS}}.')).toEqual([]);
  });
});

/**
 * O-55 / O-47 — the A/B lane had a Settings dial, a pinning rule, a summarizer
 * and a journal column, and NO caller for `beginPromptLane`. Nothing on the
 * panel said so: `getPrompt` kept returning the override, the profile card kept
 * rendering two empty rows, and `maybePinWinningPromptLane` could never see a
 * trade with a lane on it. These are the tests that were missing.
 */
import { beginPromptLane, endPromptLane } from '../services/infrastructure/PromptOverrideService';
import { promptCorpusVersion } from '../services/infrastructure/PromptOverrideService';
import { saveHarnessSettings } from '../utils/harnessSettings';
import { readFileSync } from 'node:fs';

describe('the prompt A/B lane', () => {
  beforeEach(() => {
    store = {};
    endPromptLane();
  });

  it('stays LIVE when the trader set no rate', async () => {
    await initPromptOverrides('alice');
    saveHarnessSettings({ promptAbRate: 0.1 });
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    // Draw forced above the rate, so the test asserts the gate rather than
    // rolling a die: an 8-hundred-million-run suite would eventually flake here.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
        expect(beginPromptLane()).toBe('live');
    } finally {
        random.mockRestore();
    }
    expect(getPrompt('analysis.master', FALLBACK)).toBe('MY OVERRIDE');
  });

  it('never rolls the lane when there is nothing to A/B against', async () => {
    // Without an override both lanes resolve to the same bytes, so a coin flip
    // would only relabel an identical run — and the card would fill with rows
    // that prove nothing. Rate 50 % AND the smallest possible draw, so the only
    // thing that can stop it is this gate.
    await initPromptOverrides('alice');
    saveHarnessSettings({ promptAbRate: 0.5 });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
        expect(beginPromptLane()).toBe('live');
    } finally {
        random.mockRestore();
    }
  });

  it('rolls CONTROL on a live override, and getPrompt ignores overrides there', async () => {
    // The dial's positions are Off / 10 % / 50 % (utils/harnessSettings coerces
    // anything else back to 10 %), so the roll is forced rather than asking for
    // a rate the app cannot store.
    await initPromptOverrides('alice');
    saveHarnessSettings({ promptAbRate: 0.5 });
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
        expect(beginPromptLane()).toBe('control');
    } finally {
        random.mockRestore();
    }
    expect(getPrompt('analysis.master', FALLBACK)).toBe(FALLBACK);
    endPromptLane();
    expect(getPrompt('analysis.master', FALLBACK)).toBe('MY OVERRIDE');
  });

  it('a pin beats the roll in both directions', async () => {
    await initPromptOverrides('alice');
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    saveHarnessSettings({ promptAbRate: 0.5, pinnedPromptLane: 'live' });
    expect(beginPromptLane()).toBe('live');
    saveHarnessSettings({ promptAbRate: 0, pinnedPromptLane: 'control' });
    expect(beginPromptLane()).toBe('control');
  });
});

describe('promptCorpusVersion, the string the journal row groups runs by (O-47)', () => {
  beforeEach(async () => {
    store = {};
    endPromptLane();
    await initPromptOverrides('alice');
  });

  it('is `defaults` for a run that resolved the built-in text', async () => {
    expect(promptCorpusVersion()).toBe('defaults');
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    saveHarnessSettings({ promptAbRate: 0.5 });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect(beginPromptLane()).toBe('control');
    } finally {
      random.mockRestore();
    }
    // The lane resolves defaults, so its version is the defaults' version — the
    // two sides of the A/B differ by THIS string, and nothing else.
    expect(promptCorpusVersion()).toBe('defaults');
  });

  it('names an edit, and a different edit is a different version', async () => {
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    const first = promptCorpusVersion();
    expect(first).toMatch(/^edited-[0-9a-z]{1,13}$/);
    await savePromptOverride('analysis.master', 'A DIFFERENT OVERRIDE', 'alice');
    expect(promptCorpusVersion()).not.toBe(first);
  });

  it('does not depend on the order the overrides were saved in', async () => {
    await savePromptOverride('analysis.master', 'A', 'alice');
    const one = promptCorpusVersion();
    await resetAllPromptOverrides('alice');
    await savePromptOverride('chat.casual', 'X', 'alice');
    await savePromptOverride('analysis.master', 'A', 'alice');
    const two = promptCorpusVersion();
    await resetAllPromptOverrides('alice');
    await savePromptOverride('analysis.master', 'A', 'alice');
    await savePromptOverride('chat.casual', 'X', 'alice');
    expect(two).toBe(promptCorpusVersion());
    expect(one).not.toBe(two);
  });

  it('an override saved blank is no override at all', async () => {
    await savePromptOverride('analysis.master', '   ', 'alice');
    expect(promptCorpusVersion()).toBe('defaults');
  });
});

describe('the run actually opens the lane it closes (O-55 wiring)', () => {
  const src = readFileSync('hooks/useAnalysisPipeline.ts', 'utf8');

  it('begins the lane inside the run, before any prompt is resolved', () => {
    expect(src).toMatch(/const promptLane = beginPromptLane\(\);/);
    // The `finally` that closes it was already there — the pairing is the point.
    expect(src).toMatch(/endPromptLane\(\);/);
    expect(src.indexOf('const promptLane = beginPromptLane();'))
      .toBeLessThan(src.indexOf('endPromptLane();'));
  });

  it('stamps the lane and the corpus version on every run it records', () => {
    // Shape-based, not a line number: each `runId:` in a runStats block must be
    // joined by both fields, or the journal row that copies them writes a gap.
    const runIds = [...src.matchAll(/runId: `/g)].length;
    expect(runIds).toBeGreaterThan(0);
    expect([...src.matchAll(/promptLane,/g)].length).toBe(runIds);
    expect([...src.matchAll(/promptVersion,/g)].length).toBe(runIds);
    expect(src).toMatch(/const promptVersion = promptCorpusVersion\(\);/);
  });
});
