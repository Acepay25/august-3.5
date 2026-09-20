/**
 * WS-5.4 acceptance: "every merged surface keeps a jsdom smoke test."
 *
 * LearningDashboard is the biggest thing the Learn surface absorbed — 1,140
 * lines of analytics that used to live on a second surface also called "Learn",
 * inside the Journal. Nothing rendered it before this file, so the merge was
 * asserted only by a wrapper div existing. These check the five sections mount
 * with an empty profile, which is the state where a lazy boundary or a guard is
 * most likely to swallow them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));

import LearningDashboard from '../components/dashboards/LearningDashboard';
import { ToastProvider } from '../components/shared/Toast';
import { initMemoryFiles } from '../services/learning/MemoryFilesService';

const USER = 'learning-signals-user';

beforeEach(async () => {
    store = {};
    localStorage.clear();
    await initMemoryFiles(USER);
});

afterEach(cleanup);

describe('Learn → Health learning signals (WS-5.1 merge)', () => {
    it('mounts every section of the absorbed dashboard with nothing to show', async () => {
        render(<ToastProvider><LearningDashboard username={USER} trades={[]} /></ToastProvider>);
        for (const heading of [
            'Top Lessons (outcome-weighted)',
            'Memory Graph',
            'Skill Review — Apply',
        ]) {
            await waitFor(() => expect(screen.getByText(heading)).toBeTruthy());
        }
        // No notebook card: Learn → Memory edits those files, and the health
        // card on this same tab already reports the diary count. This dashboard
        // was a third read of one store.
        expect(screen.queryByText(/what the model reads/)).toBeNull();
        // The harness panel's heading carries an em dash and sits inside a
        // flex row with the window control, so match on its prefix.
        expect(screen.getByText(/Harness Accuracy/)).toBeTruthy();
    });
});
