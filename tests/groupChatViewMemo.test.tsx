import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

// Spy the transcript derivation: threadForGroup runs INSIDE the component's
// useMemo, so it executes exactly once per real render. A React.memo bailout
// skips the render — and the call. (A Profiler can't prove this: it fires on
// every parent commit even when the memoized child bails out.)
const { threadForGroupSpy } = vi.hoisted(() => ({ threadForGroupSpy: vi.fn() }));
vi.mock('../utils/agentThreads', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils/agentThreads')>();
    return {
        ...actual,
        threadForGroup: (...args: unknown[]) => {
            threadForGroupSpy();
            return (actual.threadForGroup as (...a: unknown[]) => unknown)(...args);
        },
    };
});

import { GroupChatView } from '../components/chat/GroupChatView';
import { AgentBot, AgentGroup } from '../services/agents/agentRoster';
import { Message } from '../types/message';
import { MessageRole } from '../types/enums';

/**
 * Memoization contract (perf pass): GroupChatView is wrapped in React.memo
 * so an App re-render with identical props must NOT repaint the room.
 */
afterEach(() => {
    cleanup();
    threadForGroupSpy.mockClear();
});

let seq = 0;
const bot = (over: Partial<AgentBot>): AgentBot => ({
    id: over.id ?? `b${(seq += 1)}`,
    name: over.name ?? 'Scout',
    providerId: over.providerId ?? 'p1',
    modelId: over.modelId ?? 'model-a',
    avatar: over.avatar ?? { kind: 'auto' },
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
});

const group = (over: Partial<AgentGroup>): AgentGroup => ({
    id: over.id ?? `g${(seq += 1)}`,
    memberIds: over.memberIds ?? [],
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
});

const msg = (over: Partial<Message>): Message => ({
    id: over.id ?? `m${(seq += 1)}`,
    role: over.role ?? MessageRole.USER,
    text: over.text ?? '',
    createdAt: over.createdAt ?? new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
});

describe('GroupChatView memoization', () => {
    it('does not re-render when the parent re-renders with identical props', () => {
        const bots = [bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })];
        const grp = group({ id: 'g1', memberIds: ['b1', 'b2'] });
        const messages = [msg({ id: 'm1', role: MessageRole.USER, text: 'analyze btc', roomId: 'g1' })];
        const onSendThread = vi.fn();

        // A parent whose state bump forces its own re-render while every
        // GroupChatView prop stays referentially identical.
        const Parent: React.FC = () => {
            const [, setN] = React.useState(0);
            (Parent as unknown as { bump?: () => void }).bump = () => setN(x => x + 1);
            return (
                <GroupChatView
                    group={grp}
                    bots={bots}
                    messages={messages}
                    activity={[]}
                    workingBotId={null}
                    isRunning={false}
                    onSendThread={onSendThread}
                />
            );
        };

        render(<Parent />);
        expect(screen.getByText('analyze btc')).toBeTruthy();
        expect(threadForGroupSpy).toHaveBeenCalledTimes(1); // mount render

        React.act(() => {
            (Parent as unknown as { bump: () => void }).bump!();
        });
        // The memo held: the room never re-rendered.
        expect(threadForGroupSpy).toHaveBeenCalledTimes(1);
    });

    it('does re-render when a prop actually changes', () => {
        const bots = [bot({ id: 'b1', name: 'Scout' })];
        const grp = group({ id: 'g1', memberIds: ['b1'] });
        const baseMessages = [msg({ id: 'm1', role: MessageRole.USER, text: 'first', roomId: 'g1' })];

        const Parent: React.FC = () => {
            const [extra, setExtra] = React.useState<Message[]>([]);
            // Memoized so the ONLY thing that changes the messages reference
            // is the extra state — an inline array would defeat the memo on
            // every render and the test would prove nothing.
            const messages = React.useMemo(() => [...baseMessages, ...extra], [extra]);
            (Parent as unknown as { push?: () => void }).push = () =>
                setExtra([msg({ id: 'm2', role: MessageRole.AI, text: 'second', roomId: 'g1', modelsUsed: { p1: 'model-a' } })]);
            return (
                <GroupChatView
                    group={grp}
                    bots={bots}
                    messages={messages}
                    activity={[]}
                    workingBotId={null}
                    isRunning={false}
                    onSendThread={() => {}}
                />
            );
        };

        render(<Parent />);
        expect(threadForGroupSpy).toHaveBeenCalledTimes(1);
        React.act(() => {
            (Parent as unknown as { push: () => void }).push!();
        });
        expect(threadForGroupSpy).toHaveBeenCalledTimes(2); // the changed prop repainted
        expect(screen.getByText('second')).toBeTruthy();
    });
});
