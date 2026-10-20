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

/** The ids a cancel was asked for, in order. */
const cancelledIds = (handleCancelAnalysis: (conversationId?: string) => void): string[] =>
    (handleCancelAnalysis as unknown as { mock: { calls: unknown[][] } })
        .mock.calls.map(c => c[0] as string);

const createArgs = (overrides: Partial<UseConversationHousekeepingArgs> = {}): UseConversationHousekeepingArgs => ({
    conversationHistory: [conv('c1'), conv('c2')],
    setConversationHistory: vi.fn(),
    activeConversation: conv('c1'),
    activeConversationId: 'c1',
    setActiveConversationId: vi.fn(),
    updateMessages: vi.fn(),
    handleCancelAnalysis: vi.fn(),
    confirmDialog: vi.fn().mockResolvedValue(true),
    toast: { success: vi.fn() },
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
        // The DELETED conversation's run stops — and only that one. A run in
        // another thread is none of this delete's business.
        expect(cancelledIds(args.handleCancelAnalysis)).toEqual(['c1']);
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
        // The deleted thread's run stops even though it was not the active one.
        expect(cancelledIds(args.handleCancelAnalysis)).toEqual(['c2']);
    });

    it('loading a conversation does NOT cancel the run — the run survives the switch', () => {
        // THE CONTRACT E-45 CHANGED, DELIBERATELY.
        //
        // This used to assert that `handleCancelAnalysis` WAS called on a
        // conversation load. That assertion pinned the defect: the pipeline
        // binds every async write to the conversation the request started in
        // (`updateRequestMessages`), so the run was DESIGNED to land its answer
        // in the thread it was typed in — and the cancel killed it before that
        // could happen. A switch is a VIEW change now.
        const args = createArgs();
        const { result, rerender } = renderHook(({ a }: { a: UseConversationHousekeepingArgs }) => useConversationHousekeeping(a), {
            initialProps: { a: args },
        });

        act(() => result.current.handleLoadConversation('c1'));
        expect(args.setActiveConversationId).not.toHaveBeenCalled();

        rerender({ a: { ...args, activeConversationId: 'c2' } });
        act(() => result.current.handleLoadConversation('c1'));
        expect(args.setActiveConversationId).toHaveBeenCalledWith('c1');
        // The run keeps going. The thread it belongs to says so while you are
        // away (the surface's busy badge), and the answer lands there.
        expect(args.handleCancelAnalysis).not.toHaveBeenCalled();
    });

    it('a new conversation does not cancel the run either', () => {
        // Same reasoning as the load: opening another thread moves the view.
        const args = createArgs();
        const { result } = renderHook(() => useConversationHousekeeping(args));

        act(() => result.current.handleNewConversation());

        expect(args.handleCancelAnalysis).not.toHaveBeenCalled();
    });

    it('clearing the whole history stops every conversation\'s run', async () => {
        // "Clear all" takes every thread with it, so every thread's run stops —
        // each one NAMED, because a run in a thread the trader is not looking
        // at is not covered by a cancel of the active one.
        const args = createArgs();
        const { result } = renderHook(() => useConversationHousekeeping(args));

        // The clear sits behind a confirmation, so it settles on a later tick.
        await act(async () => { await result.current.handleClearAllConversations(); });

        expect(cancelledIds(args.handleCancelAnalysis)).toEqual(['c1', 'c2']);
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
