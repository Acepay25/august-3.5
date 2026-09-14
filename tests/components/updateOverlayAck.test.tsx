/**
 * UpdateOverlay restart handshake — while `installing`, the overlay must let
 * the animation play and then fire the renderer's quitNow() ack exactly once
 * (main's 5 s fallback covers a stuck renderer, but a healthy one must not
 * wait for it). Other phases must never ack, and an unmount mid-hold kills
 * the pending ack.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    quitNow: vi.fn(),
    // Mutable status snapshot the mocked hook reads on every render.
    status: { status: 'idle', progress: 0, version: null, error: null } as Record<string, unknown>,
}));

vi.mock('../../hooks/useAutoUpdate', () => ({
    useAutoUpdate: () => ({
        isElectron: true,
        appVersion: '1.0.0',
        updateStatus: mocks.status,
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn(),
        installUpdate: vi.fn(),
        quitNow: mocks.quitNow,
    }),
}));

import UpdateOverlay from '../../components/shared/UpdateOverlay';

beforeEach(() => {
    vi.useFakeTimers();
    mocks.quitNow.mockReset();
    mocks.status = { status: 'idle', progress: 0, version: null, error: null };
});
afterEach(() => { vi.useRealTimers(); });

const phase = (status: string, extra: Record<string, unknown> = {}): void => {
    mocks.status = {
        status, progress: status === 'downloaded' ? 100 : 42, version: '9.9.9', error: null, ...extra,
    };
};

describe('UpdateOverlay install ack', () => {
    it('plays the restart animation, then acks quit exactly once', () => {
        phase('installing');
        render(<UpdateOverlay />);
        expect(screen.getByText(/Restarting with v9.9.9/)).toBeTruthy();
        expect(mocks.quitNow).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(2000); }); // past the 1.9s hold
        expect(mocks.quitNow).toHaveBeenCalledTimes(1);

        act(() => { vi.advanceTimersByTime(10_000); }); // no repeat acks
        expect(mocks.quitNow).toHaveBeenCalledTimes(1);
    });

    it('never acks during download, and the hold respects unmount', () => {
        phase('downloading', { bytesPerSecond: 1024 * 1024, transferred: 1e6, total: 2e6 });
        const { unmount } = render(<UpdateOverlay />);
        expect(screen.getByText(/Updating to v9.9.9/)).toBeTruthy();
        act(() => { vi.advanceTimersByTime(5000); });
        expect(mocks.quitNow).not.toHaveBeenCalled();
        unmount();

        // A fresh install-phase mount acks only after the animation hold.
        phase('installing');
        render(<UpdateOverlay />);
        act(() => { vi.advanceTimersByTime(1000); }); // still inside the 1.9s hold
        expect(mocks.quitNow).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(1500); }); // past it → exactly one
        expect(mocks.quitNow).toHaveBeenCalledTimes(1);
    });
});
