/**
 * useUserProfiles deletion cascade (residual item 1): deleting a profile must
 * drop the offline-queue items it enqueued — `clearQueueForUser` existed and
 * was unit-tested in offlineQueueProfile.test.ts but had zero production
 * callers, so a deleted profile's pending analyses could linger in IndexedDB
 * forever (or be adopted by a future same-name profile via the legacy
 * unstamped path). Wires the call next to `deleteUserProfile` and proves:
 *   - the deleted username is passed through,
 *   - a queue-cleanup failure does not abort the delete cascade,
 *   - the confirm gate still guards everything.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../services/infrastructure/dbService', () => ({
    deleteUserProfile: vi.fn().mockResolvedValue(undefined),
    getAllUsernames: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/infrastructure/ExportService', () => ({
    exportDataAsFile: vi.fn(),
    exportPreferencesData: vi.fn(),
    importPreferencesData: vi.fn(),
}));

const { clearQueueForUser } = vi.hoisted(() => ({ clearQueueForUser: vi.fn() }));
vi.mock('../services/infrastructure/OfflineQueueService', () => ({ clearQueueForUser }));

// The active-user branch dynamically imports these singletons — stub them so
// the hook can be exercised without the whole service graph.
vi.mock('../services/ui/OutcomeAutopilotService', () => ({
    OutcomeAutopilotService: { reset: vi.fn() },
}));
vi.mock('../services/learning/PatternMemorySynthesisService', () => ({
    setAttributedInsightsUser: vi.fn(),
}));

import * as dbService from '../services/infrastructure/dbService';
import { useUserProfiles } from '../hooks/useUserProfiles';

const makeParams = (confirmResult: boolean) => ({
    resetAppState: vi.fn().mockResolvedValue(undefined),
    setIsUserModalOpen: vi.fn(),
    setIsSettingsVisible: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    confirmDialog: vi.fn().mockResolvedValue(confirmResult),
});

beforeEach(() => {
    vi.clearAllMocks();
    clearQueueForUser.mockResolvedValue(2);
});

describe('useUserProfiles → offline-queue cleanup on profile delete', () => {
    it('calls clearQueueForUser with the deleted username after dropping the profile', async () => {
        const params = makeParams(true);
        const { result } = renderHook(() => useUserProfiles(params));
        // Start from a two-user list so the filter-after-delete is observable.
        act(() => result.current.setExistingUsernames(['alice', 'bob']));

        await act(async () => { await result.current.handleDeleteUser('alice'); });

        expect(dbService.deleteUserProfile).toHaveBeenCalledWith('alice');
        expect(clearQueueForUser).toHaveBeenCalledWith('alice');
        // Order: the profile itself is dropped before the queue cleanup.
        expect((dbService.deleteUserProfile as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
            .toBeLessThan(clearQueueForUser.mock.invocationCallOrder[0]);
        await waitFor(() => expect(result.current.existingUsernames).toEqual(['bob']));
    });

    it('a queue-cleanup failure does not abort the rest of the delete cascade', async () => {
        clearQueueForUser.mockRejectedValue(new Error('idb down'));
        const params = makeParams(true);
        const { result } = renderHook(() => useUserProfiles(params));
        act(() => result.current.setExistingUsernames(['alice', 'bob']));

        await act(async () => { await result.current.handleDeleteUser('alice'); });

        expect(clearQueueForUser).toHaveBeenCalledWith('alice');
        await waitFor(() => expect(result.current.existingUsernames).toEqual(['bob']));
    });

    it('does nothing when the confirmation is declined', async () => {
        const params = makeParams(false);
        const { result } = renderHook(() => useUserProfiles(params));

        await act(async () => { await result.current.handleDeleteUser('alice'); });

        expect(dbService.deleteUserProfile).not.toHaveBeenCalled();
        expect(clearQueueForUser).not.toHaveBeenCalled();
    });

    it('active-profile delete still runs the queue cleanup + app reset', async () => {
        const params = makeParams(true);
        const { result } = renderHook(() => useUserProfiles(params));
        // Make 'alice' the active user, then delete her.
        act(() => result.current.setActiveUsername('alice'));
        expect(result.current.activeUsername).toBe('alice');

        await act(async () => { await result.current.handleDeleteUser('alice'); });

        expect(clearQueueForUser).toHaveBeenCalledWith('alice');
        await waitFor(() => expect(params.resetAppState).toHaveBeenCalledWith(null));
        expect(result.current.activeUsername).toBeNull();
    });
});
