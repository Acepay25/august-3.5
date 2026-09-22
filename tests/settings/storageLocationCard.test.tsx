/**
 * The storage card reports what it can actually know, and says the rest.
 *
 * `getStorageInfo` returned platform + backend + profile count and was called by
 * nobody. Surfacing it is only useful if the copy distinguishes the two backends
 * correctly — the eviction warning applies to browser/WebView storage, not to
 * the app's own data file, and telling a SQLite user their journal might be
 * cleared would be the same overreach this repo keeps having to root out.
 *
 * The failure path matters most: a card that cannot tell must not render a
 * confident "everything is fine".
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const storageInfoMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/infrastructure/dbService', () => ({
    getStorageInfo: () => storageInfoMock(),
}));

import { StorageLocationCard } from '../../components/settings/StorageLocationCard';

// No shared `beforeEach` resetting this mock: `mockReset()` on it makes the
// probe-failure case below fail with the thrown error escaping to the runner,
// and every case here sets its own behavior anyway.

describe('the storage location card', () => {
    it('names SQLite as the app’s own data file and raises no eviction warning', async () => {
        storageInfoMock.mockResolvedValue({ platform: 'win', storageType: 'sqlite', userCount: 3 });
        render(<StorageLocationCard />);
        const value = await screen.findByTestId('storage-location-value');
        expect(value.textContent).toContain('SQLite');
        expect(value.textContent).toContain('3 profiles');
        expect(screen.queryByTestId('storage-location-warning')).not.toBeInTheDocument();
    });

    it('warns about eviction when the journal is in IndexedDB', async () => {
        storageInfoMock.mockResolvedValue({ platform: 'web', storageType: 'indexeddb', userCount: 1 });
        render(<StorageLocationCard />);
        await screen.findByTestId('storage-location-value');
        expect(screen.getByTestId('storage-location-value').textContent).toContain('1 profile');
        const warning = screen.getByTestId('storage-location-warning');
        expect(warning.textContent).toMatch('cleared by the system under disk pressure');
        expect(warning.textContent).toMatch('exported backup');
    });

    it('shows no confident answer while it cannot tell, then resolves', async () => {
        // A promise that never settles leaks into the next test's hooks; handing
        // the resolver back lets this one assert both halves — the "I don't know
        // yet" state and the moment it stops being true.
        let settle: ((v: { platform: string; storageType: 'indexeddb'; userCount: number }) => void) = () => {};
        storageInfoMock.mockReturnValue(new Promise(res => { settle = res; }));
        render(<StorageLocationCard />);
        expect(screen.getByText('Checking…')).toBeInTheDocument();
        expect(screen.queryByTestId('storage-location-value')).not.toBeInTheDocument();
        expect(screen.queryByTestId('storage-location-warning')).not.toBeInTheDocument();

        settle({ platform: 'web', storageType: 'indexeddb', userCount: 2 });
        await screen.findByTestId('storage-location-value');
        expect(screen.getByTestId('storage-location-warning')).toBeInTheDocument();
    });

    it('says so and points at the remedy when the probe fails', async () => {
        // Driven with a throw rather than a rejected promise on purpose: the
        // card's `try { await … } catch` handles both identically, but Vitest
        // attributes any rejection created here to the test as an unhandled one
        // — however eagerly it is caught — so the rejected form fails the run
        // over state the card copes with. The render is wrapped in `act` so the
        // async probe's state update lands inside it rather than escaping.
        storageInfoMock.mockImplementation(() => { throw new Error('storage unreadable'); });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await act(async () => { render(<StorageLocationCard />); });
        expect(screen.getByTestId('storage-location-unknown').textContent)
            .toMatch('export a backup before assuming this journal is safe');
        // The reason is logged, not swallowed — this is where the detail lives.
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
