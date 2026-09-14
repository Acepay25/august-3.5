/**
 * UpdateOverlay restart handshake — while `installing`, the overlay must let
 * the animation play and then fire the renderer's quitNow() ack exactly once
 * (main's 5 s fallback covers a stuck renderer, but a healthy one must not
 * wait for it). Other phases must never ack.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const { quitNowMock, hookState } = vi.hoisted(() => ({
    quitNowMock: vi.fn(),
    hookState: {
        current: {
            isElectron: true,
            appVersion: '1.0.0',
            updateStatus: {
                status: 'idle', progress: 0, version: null, error: null,
            },
            checkForUpdates: vi.fn(),
            downloadUpdate: vi.fn(),
            installUpdate: vi.fn(),
            quitNow: quitNowMock,
        },
    },
}));

vi.mock('../../hooks/useAutoUpdate', () => ({
    useAutoUpdate: () => hookState.current,
}));

import UpdateOverlay from '../../components/shared/UpdateOverlay';

beforeEach(() => {
    vi.useFakeTimers();
    quitNowMock.mockReset();
    hookState.current.updateStatus = {
        status: 'idle', progress: 0, version: null, error: null,
    } as never;
});
afterEach(() => { vi.useRealTimers(); });

const phase = (status: string, extra: Record<string, unknown> = {}): void => {
    act(() => {
        hookState.current.updateStatus = {
            status, progress: status === 'downloaded' ? 100 : 42, version: '9.9.9', error: null, ...extra,
        } as never;
    });
};

describe('UpdateOverlay install ack', () => {
    it('plays the restart animation, then acks quit exactly once', () => {
        render(<UpdateOverlay />);
        phase('installing');
        expect(screen.getByText(/Restarting with v9.9.9/)).toBeTruthy();
        expect(quitNowMock).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(2000); }); // past the 1.9s hold
        expect(quitNowMock).toHaveBeenCalledTimes(1);

        act(() => { vi.advanceTimersByTime(10_000); }); // no repeat acks
        expect(quitNowMock).toHaveBeenCalledTimes(1);
    });

    it('never acks during download or after cancel (unmount clears the timer)', () => {
        const { unmount } = render(<UpdateOverlay />);
        phase('downloading', { bytesPerSecond: 1024 * 1024, transferred: 1e6, total: 2e6 });
        act(() => { vi.advanceTimersByTime(5000); });
        expect(quitNowMock).not.toHaveBeenCalled();
        expect(screen.getByText(/Updating to v9.9.9/)).toBeTruthy();
        unmount();
    });
});
