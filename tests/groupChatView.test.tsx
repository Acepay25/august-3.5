import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { GroupChatView } from '../components/chat/GroupChatView';
import { AgentBot, AgentGroup } from '../services/agents/agentRoster';
import { GroupActivityEntry } from '../hooks/useAgentGroups';
import { Message } from '../types/message';
import { MessageRole } from '../types/enums';

afterEach(cleanup);

let seq = 0;
const bot = (over: Partial<AgentBot>): AgentBot => ({
    id: over.id ?? `b${seq += 1}`,
    name: over.name ?? 'Scout',
    providerId: over.providerId ?? 'p1',
    modelId: over.modelId ?? 'gpt-test',
    avatar: over.avatar ?? { kind: 'auto' },
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
});

const group = (over: Partial<AgentGroup>): AgentGroup => ({
    id: over.id ?? `g${seq += 1}`,
    memberIds: over.memberIds ?? [],
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
});

const msg = (over: Partial<Message>): Message => ({
    id: over.id ?? `m${seq += 1}`,
    role: over.role ?? MessageRole.USER,
    text: over.text ?? '',
    createdAt: over.createdAt ?? new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
});

const bots = [
    bot({ id: 'b1', name: 'Scout', providerId: 'p1', modelId: 'model-a' }),
    bot({ id: 'b2', name: 'Ledger', providerId: 'p1', modelId: 'model-b' }),
];
const grp = group({ id: 'g1', memberIds: ['b1', 'b2'] });

const base = {
    group: grp,
    bots,
    messages: [] as Message[],
    activity: [] as GroupActivityEntry[],
    workingBotId: null as string | null,
    isRunning: false,
    onSendThread: () => {},
};

describe('GroupChatView (room UX)', () => {
    it('header shows member count and the gear/trash actions when wired', () => {
        const onEditGroup = vi.fn();
        const onDeleteGroup = vi.fn();
        render(<GroupChatView {...base} onEditGroup={onEditGroup} onDeleteGroup={onDeleteGroup} />);
        expect(screen.getByText('2 bots')).toBeTruthy();
        fireEvent.click(screen.getByTestId('group-edit'));
        expect(onEditGroup).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('group-delete'));
        expect(onDeleteGroup).toHaveBeenCalledTimes(1);
    });

    it('actions are absent when the callbacks are omitted', () => {
        render(<GroupChatView {...base} />);
        expect(screen.queryByTestId('group-edit')).toBeNull();
        expect(screen.queryByTestId('group-delete')).toBeNull();
        expect(screen.queryByTestId('reply-link-m1')).toBeNull();
    });

    it('Reply in thread opens an inline composer and sends via onReplyInThread', () => {
        const onReplyInThread = vi.fn();
        const messages: Message[] = [
            msg({ id: 'm1', role: MessageRole.USER, text: 'analyze btc' }),
            msg({ id: 'm2', role: MessageRole.AI, text: 'Trend is up.', modelsUsed: { p1: 'model-a' } }),
            msg({ id: 'm3', role: MessageRole.AI, text: 'Funding cooling.', modelsUsed: { p1: 'model-b' } }),
        ];
        render(<GroupChatView {...base} messages={messages} onReplyInThread={onReplyInThread} />);
        fireEvent.click(screen.getByTestId('reply-link-m1'));
        const input = screen.getByLabelText('Reply in thread') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'and ETH?' } });
        fireEvent.click(screen.getByTestId('reply-send-m1'));
        expect(onReplyInThread).toHaveBeenCalledWith('and ETH?');
        // Composer closes after sending.
        expect(screen.queryByLabelText('Reply in thread')).toBeNull();
    });

    it('the working indicator line renders while a member runs', () => {
        const messages: Message[] = [
            msg({ id: 'm1', role: MessageRole.USER, text: 'analyze btc' }),
        ];
        render(<GroupChatView {...base} messages={messages} workingBotId="b1" isRunning />);
        expect(screen.getByTestId('group-thinking').textContent).toContain('Scout is thinking');
    });

    it('Stop replaces New Thread while running and fires onCancelRun', () => {
        const onCancelRun = vi.fn();
        const { rerender } = render(<GroupChatView {...base} isRunning onCancelRun={onCancelRun} />);
        // While running, the composer shows Stop (no New Thread).
        expect(screen.getByTestId('composer-cancel')).toBeTruthy();
        expect(screen.queryByTestId('new-thread-button')).toBeNull();
        // The thread area shows the cancel affordance too (empty room → no
        // thread rows, so only the composer Stop renders here).
        fireEvent.click(screen.getByTestId('composer-cancel'));
        expect(onCancelRun).toHaveBeenCalledTimes(1);

        rerender(<GroupChatView {...base} isRunning={false} onCancelRun={onCancelRun} />);
        expect(screen.queryByTestId('composer-cancel')).toBeNull();
        expect(screen.getByTestId('new-thread-button')).toBeTruthy();
    });

    it('with a thread in flight, an inline Stop sits next to the thinking line', () => {
        const onCancelRun = vi.fn();
        const messages: Message[] = [
            msg({ id: 'm1', role: MessageRole.USER, text: 'analyze btc' }),
        ];
        render(<GroupChatView {...base} messages={messages} workingBotId="b1" isRunning onCancelRun={onCancelRun} />);
        expect(screen.getByTestId('group-thinking').textContent).toContain('Scout is thinking');
        fireEvent.click(screen.getByTestId('group-cancel'));
        expect(onCancelRun).toHaveBeenCalledTimes(1);
    });

    it('no Stop affordances without onCancelRun', () => {
        render(<GroupChatView {...base} isRunning />);
        expect(screen.queryByTestId('composer-cancel')).toBeNull();
        expect(screen.queryByTestId('group-cancel')).toBeNull();
        // Falls back to New Thread (input-gated, not run-gated).
        expect(screen.getByTestId('new-thread-button')).toBeTruthy();
    });

    it('the hybrid toggle renders only when wired and flips via onToggleHybrid', () => {
        const onToggleHybrid = vi.fn();
        const { rerender } = render(
            <GroupChatView {...base} hybridEnabled={false} onToggleHybrid={onToggleHybrid} />,
        );
        const toggle = screen.getByTestId('group-hybrid-toggle') as HTMLButtonElement;
        expect(toggle.getAttribute('aria-checked')).toBe('false');
        fireEvent.click(toggle);
        expect(onToggleHybrid).toHaveBeenCalledTimes(1);

        rerender(<GroupChatView {...base} hybridEnabled onToggleHybrid={onToggleHybrid} />);
        expect((screen.getByTestId('group-hybrid-toggle') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    });

    it('the hybrid toggle is absent when the callback is omitted', () => {
        render(<GroupChatView {...base} />);
        expect(screen.queryByTestId('group-hybrid-toggle')).toBeNull();
    });

    it('member replies render markdown (bold survives as a <strong>) with a hover copy button', { timeout: 30_000 }, async () => {
        const messages: Message[] = [
            msg({ id: 'm1', role: MessageRole.USER, text: 'analyze btc' }),
            msg({ id: 'm2', role: MessageRole.AI, text: '**Spot:** $77,648 · below the 7d mean', modelsUsed: { p1: 'model-a' } }),
        ];
        const { container } = render(<GroupChatView {...base} messages={messages} />);
        expect(screen.getByTestId('group-copy-m2')).toBeTruthy();
        // MarkdownContent lazy-loads the renderer chunk — under full-suite
        // load the chunk fetch + parse can exceed the default waitFor window
        // (same 30s class as the skillsGrid detail-open test, §14-11c).
        await waitFor(() => expect(container.querySelector('strong')).toBeTruthy(), { timeout: 25_000 });
    });
});
