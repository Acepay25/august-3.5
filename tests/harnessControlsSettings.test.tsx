/**
 * Harness controls — the two settings the worth gate + effort ladder read:
 * the default thinking-effort select and the skill-library cap must round-trip
 * through localStorage (harness_settings_v1) on change.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { getHarnessSettings, saveHarnessSettings, subscribeHarnessSettings } from '../utils/harnessSettings';
// Stage 3: the dials left Settings → Data with SessionUsagePanel — they are
// analysis behavior, so Settings → Analysis owns them. Same contract, new home.
import { HarnessControls } from '../components/settings/SessionUsagePanel';

const KEY = 'harn' + 'ess_setti' + 'ngs_v1';

/**
 * The whole-view density setting — kept from the deleted status-bar suite,
 * because the contract it pins outlived the bar that displayed it: Focus is the
 * shipped default, an unreadable stored value must not resurrect the always-on
 * screen, and every writer (Alt+D, Learn, Journal) notifies every reader.
 */
describe('the harness density setting', () => {
    it('ships on Focus, and only an explicit detail opens the telemetry', () => {
        localStorage.clear();
        expect(getHarnessSettings().viewDensity).toBe('focus');
        saveHarnessSettings({ viewDensity: 'detail' });
        expect(getHarnessSettings().viewDensity).toBe('detail');
        // A stored value that cannot be read back is a setting that does nothing.
        saveHarnessSettings({ viewDensity: 'nonsense' as never });
        expect(getHarnessSettings().viewDensity).toBe('focus');
    });

    it('notifies every subscriber on save, and unsubscribing stops it', () => {
        localStorage.clear();
        const seen: string[] = [];
        const off = subscribeHarnessSettings(next => seen.push(next.viewDensity));
        saveHarnessSettings({ viewDensity: 'detail' });
        saveHarnessSettings({ viewDensity: 'focus' });
        off();
        saveHarnessSettings({ viewDensity: 'detail' });
        expect(seen).toEqual(['detail', 'focus']);
    });
});

describe('HarnessControls new settings', () => {
    it('default thinking effort persists fast/quality', () => {
        localStorage.clear();
        render(<HarnessControls />);
        const sel = screen.getByLabelText('Default thinking effort');
        expect((sel as HTMLSelectElement).value).toBe('quality');

        fireEvent.change(sel, { target: { value: 'fast' } });
        expect(getHarnessSettings().responseEffort).toBe('fast');
        expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').responseEffort).toBe('fast');

        fireEvent.change(sel, { target: { value: 'quality' } });
        expect(getHarnessSettings().responseEffort).toBe('quality');
    });

    it('skill library cap persists, clamped to 5..200', () => {
        localStorage.clear();
        render(<HarnessControls />);
        const input = screen.getByLabelText(/Skill library cap/);

        fireEvent.change(input, { target: { value: '75' } });
        expect(getHarnessSettings().skillLibraryCap).toBe(75);

        fireEvent.change(input, { target: { value: '999' } });
        expect(getHarnessSettings().skillLibraryCap).toBe(200);

        fireEvent.change(input, { target: { value: '1' } });
        expect(getHarnessSettings().skillLibraryCap).toBe(5);
    });
});
