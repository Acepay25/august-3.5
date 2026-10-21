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
 * trade with a lane on it. Those tests were missing; they are below.
 *
 * E-57 §3 moved the lane from a module flag to a returned VALUE, because two
 * runs deciding at once (a schedule and a human send) each answered with the
 * other's lane, and a run that threw before its `finally` cleared the flag out
 * from under a run still using it.
 */
import { beginPromptLane, promptCorpusVersion } from '../services/infrastructure/PromptOverrideService';
import { PROMPT_REGISTRY_IDS } from '../constants/promptIds';
import { PROMPT_REGISTRY } from '../constants/promptRegistry';
import { saveHarnessSettings } from '../utils/harnessSettings';
import { readFileSync } from 'node:fs';

describe('the prompt A/B lane', () => {
  beforeEach(() => {
    store = {};
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

  it('rolls CONTROL on a live override, and the caller passes that lane to getPrompt', async () => {
    // The dial's positions are Off / 10 % / 50 % (utils/harnessSettings coerces
    // anything else back to 10 %), so the roll is forced rather than asking for
    // a rate the app cannot store.
    await initPromptOverrides('alice');
    saveHarnessSettings({ promptAbRate: 0.5 });
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    let lane: ReturnType<typeof beginPromptLane>;
    try {
        lane = beginPromptLane();
    } finally {
        random.mockRestore();
    }
    expect(lane).toBe('control');
    expect(getPrompt('analysis.master', FALLBACK, lane)).toBe(FALLBACK);
    // The same instant, a live run resolves the edit. This is the whole point of
    // returning a value: one run's lane cannot be the other's answer.
    expect(getPrompt('analysis.master', FALLBACK, 'live')).toBe('MY OVERRIDE');
  });

  it('two runs deciding at once keep their own lanes', async () => {
    // The regression this replaces: `let controlLane` was module state, so
    // beginPromptLane() called by a schedule and by a human send in the same
    // tick left BOTH reading whichever decided last, and the `finally` that
    // cleared it reset the other one mid-run.
    await initPromptOverrides('alice');
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    saveHarnessSettings({ pinnedPromptLane: 'control' });
    const controlRun = beginPromptLane();
    saveHarnessSettings({ pinnedPromptLane: 'live' });
    const liveRun = beginPromptLane();
    expect(controlRun).toBe('control');
    expect(liveRun).toBe('live');
    expect(getPrompt('analysis.master', FALLBACK, controlRun)).toBe(FALLBACK);
    expect(getPrompt('analysis.master', FALLBACK, liveRun)).toBe('MY OVERRIDE');
  });

  it('there is no lane state left to leak between runs', () => {
    // A source pin, because the failure is invisible to any single-run test: a
    // reset function that exists is a reset function someone forgets to call on
    // the path that throws.
    //
    // CODE lines only — the service's own header names `endPromptLane()` to
    // explain why it is gone, and a scan that reads comments would fail on the
    // documentation of the fix. Third time this day a source gate learned that it
    // must scan code, not text; it is now the house rule, not a per-test insight.
    const codeOnly = (p: string): string => readFileSync(p, 'utf8')
        .split('\n')
        .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
    const source = codeOnly('services/infrastructure/PromptOverrideService.ts');
    expect(source).not.toMatch(/endPromptLane/);
    expect(source).not.toMatch(/^let controlLane/m);
    const pipeline = codeOnly('hooks/useAnalysisPipeline.ts');
    expect(pipeline).toMatch(/const promptLane = beginPromptLane\(\);/);
    expect(pipeline).toMatch(/promptCorpusVersion\(promptLane\)/);
    expect(pipeline).not.toMatch(/endPromptLane\(\)/);
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

describe('the id list the corpus fingerprint filters by (E-57 §3)', () => {
  it('names exactly the ids the Settings tab can edit', () => {
    // Two lists that drift is the defect: an id in the registry but not here
    // stops counting in the fingerprint (a real edit, invisible in the A/B
    // group), and an id here but not in the registry is precisely the orphan the
    // filter exists to drop.
    const registered = PROMPT_REGISTRY.map(e => e.id).sort();
    expect([...PROMPT_REGISTRY_IDS].sort()).toEqual(registered);
  });
});

describe('promptCorpusVersion, the string the journal row groups runs by (O-47)', () => {
  beforeEach(async () => {
    store = {};
    await initPromptOverrides('alice');
  });

  it('ignores an override left behind by a prompt that no longer exists (E-57 §3)', async () => {
    // A deleted prompt's stored text stayed in the map, so it hashed into every
    // live run's fingerprint: two runs with identical SENT prompts could carry
    // different `promptVersion` strings, and the A/B group the profile card
    // builds would split on a number that named nothing the model was given.
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    const withoutOrphan = promptCorpusVersion('live');
    store['prompt_overrides_v1_alice'] = {
        'analysis.master': 'MY OVERRIDE',
        'analysis.deleted_experiment': 'text from a prompt this app no longer sends',
    };
    await initPromptOverrides('alice');
    expect(promptCorpusVersion('live')).toBe(withoutOrphan);
    // Control on the shape of the assertion: the orphan really is in the map, so
    // this passing is the filter and not a test that compared two empties.
    expect(getPromptOverrides()).toHaveProperty('analysis.deleted_experiment');
  });

  it('the CONTROL lane fingerprints as `defaults`, and LIVE as the edit', async () => {
    // One call, two lanes: the value decides, not the order things ran in.
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    expect(promptCorpusVersion('live')).toMatch(/^edited-/);
    expect(promptCorpusVersion('control')).toBe('defaults');
  });

  it('is `defaults` for a run that resolved the built-in text', async () => {
    expect(promptCorpusVersion('live')).toBe('defaults');
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    saveHarnessSettings({ promptAbRate: 0.5 });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    let lane: ReturnType<typeof beginPromptLane>;
    try {
      lane = beginPromptLane();
    } finally {
      random.mockRestore();
    }
    expect(lane).toBe('control');
    // The lane resolves defaults, so its version is the defaults' version — the
    // two sides of the A/B differ by THIS string, and nothing else. Passed as the
    // value it is: reading it back out of module state is what let one run
    // fingerprint another's decision.
    expect(promptCorpusVersion(lane)).toBe('defaults');
    expect(promptCorpusVersion('live')).toMatch(/^edited-/);
  });

  it('names an edit, and a different edit is a different version', async () => {
    await savePromptOverride('analysis.master', 'MY OVERRIDE', 'alice');
    const first = promptCorpusVersion();
    expect(first).toMatch(/^edited-[0-9a-z]{1,13}$/);
    await savePromptOverride('analysis.master', 'A DIFFERENT OVERRIDE', 'alice');
    expect(promptCorpusVersion()).not.toBe(first);
  });

  it('does not depend on the order the overrides were saved in', async () => {
    // Both ids are REGISTERED. This file used to spell the second one
    // `chat.casual`, which exists nowhere in the app — so the test passed while
    // exercising only one real id, and it would keep passing if the ordering
    // logic were deleted outright.
    await savePromptOverride('analysis.master', 'A', 'alice');
    const one = promptCorpusVersion('live');
    await resetAllPromptOverrides('alice');
    await savePromptOverride('analysis.risk_rules', 'X', 'alice');
    await savePromptOverride('analysis.master', 'A', 'alice');
    const two = promptCorpusVersion('live');
    await resetAllPromptOverrides('alice');
    await savePromptOverride('analysis.master', 'A', 'alice');
    await savePromptOverride('analysis.risk_rules', 'X', 'alice');
    expect(two).toBe(promptCorpusVersion('live'));
    expect(one).not.toBe(two);
  });

  it('an override saved blank is no override at all', async () => {
    await savePromptOverride('analysis.master', '   ', 'alice');
    expect(promptCorpusVersion()).toBe('defaults');
  });
});

describe('the run decides its own lane (O-55 wiring, E-57 §3)', () => {
  const src = readFileSync('hooks/useAnalysisPipeline.ts', 'utf8');

  it('begins the lane inside the run, before any prompt is resolved, and never closes it', () => {
    expect(src).toMatch(/const promptLane = beginPromptLane\(\);/);
    // E-57 §3 removed the pairing on purpose. A `finally` that resets a global is
    // the bug: it clears the lane of whichever OTHER run happened to be mid-
    // flight, and a run that throws before reaching it leaves the flag set for
    // everyone else. A value needs no unwinding.
    expect(src).not.toMatch(/endPromptLane\(\)/);
    // And the decided value is what the fingerprint is computed FROM — a version
    // derived from module state rather than from this run would be a label for
    // someone else's decision.
    expect(src).toMatch(/const promptVersion = promptCorpusVersion\(promptLane\);/);
    expect(src.indexOf('const promptLane = beginPromptLane();'))
      .toBeLessThan(src.indexOf('const promptVersion = promptCorpusVersion(promptLane);'));
  });

  it('stamps the lane and the corpus version on every run it records', () => {
    // Shape-based, not a line number: each `runId:` in a runStats block must be
    // joined by both fields, or the journal row that copies them writes a gap.
    const runIds = [...src.matchAll(/runId: `/g)].length;
    expect(runIds).toBeGreaterThan(0);
    expect([...src.matchAll(/promptLane,/g)].length).toBe(runIds);
    expect([...src.matchAll(/promptVersion,/g)].length).toBe(runIds);
    expect(src).toMatch(/const promptVersion = promptCorpusVersion\(promptLane\);/);
  });
});
