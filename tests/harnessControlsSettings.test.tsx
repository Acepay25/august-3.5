/**
 * Harness controls — the two settings the worth gate + effort ladder read:
 * the default thinking-effort select and the skill-library cap must round-trip
 * through localStorage (harness_settings_v1) on change.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { getHarnessSettings } from '../utils/harnessSettings';
import SessionUsagePanel from '../components/settings/SessionUsagePanel';

const KEY = 'harn' + 'ess_setti' + 'ngs_v1';

describe('HarnessControls new settings', () => {
    it('default thinking effort persists fast/quality', () => {
        localStorage.clear();
        render(<SessionUsagePanel />);
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
        render(<SessionUsagePanel />);
        const input = screen.getByLabelText('Skill library cap');

        fireEvent.change(input, { target: { value: '75' } });
        expect(getHarnessSettings().skillLibraryCap).toBe(75);

        fireEvent.change(input, { target: { value: '999' } });
        expect(getHarnessSettings().skillLibraryCap).toBe(200);

        fireEvent.change(input, { target: { value: '1' } });
        expect(getHarnessSettings().skillLibraryCap).toBe(5);
    });
});
