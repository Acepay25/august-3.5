/**
 * WS-5.8 — the "Active" label lied.
 *
 * `SkillDetail` read `retired ? 'Retired' : 'Active'` — a STATUS test — while
 * every injector gates on `skillEnabledFlag(meta)`. Three states fall in that
 * gap and all three rendered "Active" while contributing nothing to a single
 * prompt:
 *
 *   suspended  — the idle sweep switched it off at 90 days of silence
 *                (`enabled:false` + `meta.suspendedAt`)
 *   disabled   — the trader switched it off in the notebook (`disabledByUser`)
 *   superseded — absorbed into a generalized skill (`supersededBy`)
 *
 * The pane therefore told the user a rule was live for a belief the desk had
 * quietly stopped using, with no way to tell which of the three it was.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

const store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async () => []),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));

import SkillDetail, { type SkillCardData } from '../components/skills/SkillDetail';
import type { SkillMeta } from '../services/learning/SkillMemoryService';

const USER = 'skill-live-label-user';

const META: SkillMeta = {
    status: 'confirmed',
    kind: 'repeat',
    wins: 4,
    losses: 1,
    consecutiveLosses: 0,
    tradeIds: [],
    body: 'Fade a failed breakout when volume diverges.',
    description: 'Fade a failed breakout when volume diverges',
};

const card = (meta: SkillMeta | null): SkillCardData => ({
    fileId: 'f1',
    name: 'fade-the-fakeout',
    meta,
    body: '# fade-the-fakeout\n\nFade a failed breakout when volume diverges.',
});

const labelText = (): string | null => {
    // The status label is the first uppercase micro-label in the header row.
    // CSS (`uppercase`) does the visual casing, so compare on the raw text and
    // case-fold here — asserting on the transformed value would test Tailwind.
    const spans = [...document.querySelectorAll('span')].filter(s => /uppercase/.test(s.className));
    return spans.length > 0 ? (spans[0].textContent ?? '').trim() : null;
};

describe('the skill live label', () => {
    afterEach(() => {
        cleanup();
    });

    it('says Active for a skill the injectors will actually use', () => {
        render(<SkillDetail skill={card(META)} onBack={() => {}} onToggleRetire={() => {}} backLabel="Studio" />);
        expect(labelText()).toBe('Active');
    });

    it('says Suspended — not Active — when the idle sweep switched it off', () => {
        // THE DEFECT. `enabled:false` + `suspendedAt` is the one suspension
        // shape, and this skill was in prompts' way for 90 days of silence.
        const meta = { ...META, suspendedAt: new Date().toISOString() };
        render(<SkillDetail skill={card(meta)} onBack={() => {}} onToggleRetire={() => {}} backLabel="Studio" />);
        expect(labelText()).toBe('Suspended');
        // And it says WHY, because "suspended" without a reason invites the user
        // to think they broke something.
        expect(document.querySelector('[title*="Suspended"]')).not.toBeNull();
    });

    it('says Inactive when the trader switched it off by hand', () => {
        const meta = { ...META, disabledByUser: true };
        render(<SkillDetail skill={card(meta)} onBack={() => {}} onToggleRetire={() => {}} backLabel="Studio" />);
        expect(labelText()).toBe('Inactive');
        expect(document.querySelector('[title*="switched this off"]')).not.toBeNull();
    });

    it('names the skill that absorbed a superseded one', () => {
        // A superseded skill is retired from matching but kept as the control
        // group — the label has to say where its belief went, not just that it
        // is gone.
        const meta = { ...META, supersededBy: 'fade-any-failed-breakout' };
        render(<SkillDetail skill={card(meta)} onBack={() => {}} onToggleRetire={() => {}} backLabel="Studio" />);
        expect(labelText()).toBe('Inactive');
        expect(document.querySelector('[title*="fade-any-failed-breakout"]')).not.toBeNull();
    });

    it('still says Retired for a retired skill', () => {
        const meta = { ...META, status: 'retired' as const };
        render(<SkillDetail skill={card(meta)} onBack={() => {}} onToggleRetire={() => {}} backLabel="Studio" />);
        expect(labelText()).toBe('Retired');
    });

    it('reads the canonical flag, so it cannot drift from the injectors again', () => {
        // The derivation starts from `skillEnabledFlag(meta)` — the ONE place
        // `enabled` may be derived. A second implementation here is how the label
        // and the injectors drifted apart in the first place.
        const meta = { ...META, suspendedAt: new Date().toISOString(), disabledByUser: true };
        render(<SkillDetail skill={card(meta)} onBack={() => {}} onToggleRetire={() => {}} backLabel="Studio" />);
        // Both flags set: still not live, and still labelled honestly.
        expect(labelText()).not.toBe('Active');
    });

    it('does not write enabled:false on a superseded skill — its bytes are still read', async () => {
        // The label layers `supersededBy` on top of `skillEnabledFlag` rather
        // than folding it in, because that flag owns the notebook's `enabled`
        // FIELD. Changing it would start writing false on a file whose evidence
        // is deliberately kept queryable as the control group.
        const { skillEnabledFlag: sf } = await import('../services/learning/SkillMemoryService');
        const meta = { ...META, supersededBy: 'fade-any-failed-breakout' };
        expect(sf(meta)).toBe(true);
        // …and yet the LABEL must not call it Active, because it is not matched.
        render(<SkillDetail skill={card(meta)} onBack={() => {}} onToggleRetire={() => {}} backLabel="Studio" />);
        expect(labelText()).toBe('Inactive');
    });
});
