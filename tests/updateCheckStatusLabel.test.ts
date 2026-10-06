/**
 * The manual update check has to report what it found.
 *
 * `electron/main.cjs` used to map a clean check onto `status: 'idle'`, which is
 * also the never-checked state, so the Settings row returned to "Check for
 * updates" and told the trader nothing about the check they just ran.
 */

import { describe, it, expect } from 'vitest';
import { updateCheckStatusLabel } from '../components/settings/tabs/ProfileTab';

describe('updateCheckStatusLabel', () => {
    it('names the result of a clean check instead of falling back to the resting label', () => {
        expect(updateCheckStatusLabel('upToDate')).toBe('Up to date');
        expect(updateCheckStatusLabel('upToDate')).not.toBe(updateCheckStatusLabel('idle'));
    });

    it('keeps the resting state honest — nothing has been checked yet', () => {
        expect(updateCheckStatusLabel('idle')).toBe('Check for updates');
        expect(updateCheckStatusLabel(undefined)).toBe('Check for updates');
    });

    it('covers the in-flight and failed phases with one label each', () => {
        expect(updateCheckStatusLabel('checking')).toBe('Checking…');
        for (const phase of ['available', 'downloading', 'downloaded', 'installing']) {
            expect(updateCheckStatusLabel(phase)).toBe('Update in progress');
        }
        expect(updateCheckStatusLabel('error')).toBe('Check failed — try again');
    });
});
