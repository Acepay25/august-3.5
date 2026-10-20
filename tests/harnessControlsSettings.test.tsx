/**
 * Harness controls — the two settings the worth gate + effort ladder read:
 * the default thinking-effort select and the skill-library cap must round-trip
 * through localStorage (harness_settings_v1) on change.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { getHarnessSettings } from '../utils/harnessSettings';
// Stage 3: the dials left Settings → Data with SessionUsagePanel — they are
// analysis behavior, so Settings → Analysis owns them. Same contract, new home.
import { HarnessControls } from '../components/settings/SessionUsagePanel';

const KEY = 'harn' + 'ess_setti' + 'ngs_v1';

describe('HarnessControls new settings', () => {
    it('default thinking effort persists fast/quality', () => {
        localStorage.clear();
        render(<HarnessControls />);
        // The effort dial is a SelectMenu now: click the trigger, then the
        // option row (same contract the native select covered).
        const trigger = screen.getByLabelText('Default thinking effort');
        expect(trigger.textContent).toContain('Quality — built-in reasoning budget');

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('option', { name: 'Fast — one step lighter on every call' }));
        expect(getHarnessSettings().responseEffort).toBe('fast');
        expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').responseEffort).toBe('fast');

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('option', { name: 'Quality — built-in reasoning budget' }));
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

    it('default leverage is 10× out of the box and persists clamped (E-41)', () => {
        localStorage.clear();
        expect(getHarnessSettings().defaultLeverage).toBe(10);
        render(<HarnessControls />);
        const input = screen.getByTestId('harness-default-leverage');

        fireEvent.change(input, { target: { value: '25' } });
        expect(getHarnessSettings().defaultLeverage).toBe(25);

        fireEvent.change(input, { target: { value: '999' } });
        expect(getHarnessSettings().defaultLeverage).toBe(125);

        fireEvent.change(input, { target: { value: '0' } });
        expect(getHarnessSettings().defaultLeverage).toBe(1);
    });

    it('minimum net edge defaults to 0 and persists (E-43)', () => {
        localStorage.clear();
        expect(getHarnessSettings().minEdgeR).toBe(0);
        render(<HarnessControls />);
        const input = screen.getByTestId('harness-min-edge');
        fireEvent.change(input, { target: { value: '0.25' } });
        expect(getHarnessSettings().minEdgeR).toBe(0.25);
        fireEvent.change(input, { target: { value: '-2' } });
        expect(getHarnessSettings().minEdgeR).toBe(-2);
    });

    it('outcome settlement defaults to SHADOW — the plan\'s first month (E-18)', () => {
        localStorage.clear();
        expect(getHarnessSettings().outcomeSettlement).toBe('shadow');
    });
});
