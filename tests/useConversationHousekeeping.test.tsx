import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConversationHousekeeping, UseConversationHousekeepingArgs } from '../hooks/useConversationHousekeeping';
import * as conversationUtils from '../utils/conversationUtils';

vi.mock('../services/ui/AnalystLensService', () => ({
    loadLastModeratorPick: vi.fn().mockReturnValue(null),
}));

vi.mock('../utils/conversationUtils', () => ({
    findReusableEmptyConversation: vi.fn().mockReturnValue(null),
    createNewConversation: vi.fn().mockImplementation(() => ({ id: `new-${Math.random()}`, messages: [] })),
}));

const conv = (id: string, extra: Record<string, unknown> = {}) => ({ id, messages: [], ...extra }) as any;

const createArgs = (overrides: Partial<UseConversationHousekeepingArgs> = {}): UseConversationHousekeepingArgs => ({
    conversationHistory: [conv('c1'), conv('c2')],
    setConversationHistory: vi.fn(),
    activeConversation: conv('c1'),
    activeConversationId: 'c1',
    setActiveConversationId: vi.fn(),
    updateMessages: vi.fn(),
    handleCancelAnalysis: vi.fn(),
    invalidatePostMortemRuns: vi.fn(),
    confirmDialog: vi.fn().mockResolvedValue(true),
    toast: { success: vi.fn() },
    isCommandPaletteOpen: false,
    ...overrides,
});

describe('useConversationHousekeeping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('deleting the active session falls back to the first remaining one', () => {
        const setConversationHistory = vi.fn();
        const setActiveConversationId = vi.fn();
        const args = createArgs({ setConversationHistory, setActiveConversationId });
        const { result } = renderHook(() => useConversationHousekeeping(args));

        act(() => result.current.handleDeleteConversations(['c1']));

        expect(setConversationHistory).toHaveBeenCalledWith([conv('c2')]);
        expect(setActiveConversationId).toHaveBeenCalledWith('c2');
        expect(args.handleCancelAnalysis).toHaveBeenCalled();
    });

    it('deleting the last session mints a fresh blank one instead of reusing', () => {
        vi.mocked(conversationUtils.createNewConversation).mockReturnValue(conv('fresh') as any);
        const setConversationHistory = vi.fn();
        const setActiveConversationId = vi.fn();
        const args = createArgs({
            conversationHistory: [conv('c1')],
            setConversationHistory,
            setActiveConversationId,
        });
        const { result } = renderHook(() => useConversationHousekeeping(args));

        act(() => result.current.handleDeleteConversations(['c1']));

        expect(setConversationHistory).toHaveBeenCalledWith([conv('fresh')]);
        expect(setActiveConversationId).toHaveBeenCalledWith('fresh');
        expect(conversationUtils.findReusableEmptyConversation).not.toHaveBeenCalled();
    });

    it('deleting a non-active session leaves the selection alone', () => {
        const args = createArgs();
        const { result } = renderHook(() => useConversationHousekeeping(args));

        act(() => result.current.handleDeleteConversations(['c2']));

        expect(args.setActiveConversationId).not.toHaveBeenCalled();
        expect(args.handleCancelAnalysis).not.toHaveBeenCalled();
    });

    it('loadConversation only switches (and cancels) when the id differs', () => {
        const args = createArgs();
        const { result, rerender } = renderHook(({ a }: { a: UseConversationHousekeepingArgs }) => useConversationHousekeeping(a), {
            initialProps: { a: args },
        });

        act(() => result.current.handleLoadConversation('c1'));
        expect(args.setActiveConversationId).not.toHaveBeenCalled();

        rerender({ a: { ...args, activeConversationId: 'c2' } });
        act(() => result.current.handleLoadConversation('c1'));
        expect(args.setActiveConversationId).toHaveBeenCalledWith('c1');
        expect(args.handleCancelAnalysis).toHaveBeenCalled();
        expect(args.invalidatePostMortemRuns).toHaveBeenCalled();
    });

    it('selected-delete confirmations gate the deletion', async () => {
        const confirmDialog = vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        const args = createArgs({ confirmDialog });
        const { result } = renderHook(() => useConversationHousekeeping(args));

        const first = await act(() => result.current.handleDeleteSelectedConversations(['c1']));
        expect(first).toBe(false);

        const second = await act(() => result.current.handleDeleteSelectedConversations(['c1']));
        expect(second).toBe(true);
        expect(args.setConversationHistory).toHaveBeenCalledWith([conv('c2')]);
    });

    it('editUserMessage patches only the target message text', () => {
        const updateMessages = vi.fn();
        const args = createArgs({ updateMessages });
        const { result } = renderHook(() => useConversationHousekeeping(args));

        act(() => result.current.handleEditUserMessage('m1', 'edited'));
        expect(updateMessages).toHaveBeenCalledTimes(1);
        const updater = vi.mocked(updateMessages).mock.calls[0][0];
        expect(updater([{ id: 'm1', text: 'old' } as any])).toEqual([{ id: 'm1', text: 'edited' }]);
    });
});
