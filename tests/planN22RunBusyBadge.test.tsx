/**
 * N-22 — "still running" on the conversation rail.
 *
 * E-45 made a run survive a conversation switch: the run belongs to the
 * conversation it was typed in, and a switch moves the view. That creates a
 * state the app must be able to SHOW — a thread you are not looking at is
 * still thinking — or the answer reads as a hang when you come back to it.
 *
 * Two things are load-bearing here:
 *
 *   1. THE COLOUR AND THE WORD COME FROM ONE PLACE. `utils/runStatus.ts` is
 *      the run-status vocabulary ("one colour+word per state") and AGENTS.md
 *      is explicit — *"Never hardcode a status colour in a component."* The
 *      badge reads the presentation out of the vocabulary; it does not type
 *      `bg-cyan-400` itself.
 *   2. THE BADGE IS DECORATIVE, AND THE SENTENCE IS IN THE ACCESSIBLE NAME.
 *      A dot a screen reader cannot read is not an announcement — the same
 *      rule the nav already uses for its badge counts.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import SurfaceMenuList from '../components/shell/SurfaceMenuList';
import RunBusyBadge from '../components/chat/RunBusyBadge';
import * as store from '../services/trade/chatStore';
import { runStatusPresentation } from '../utils/runStatus';

const { userRef } = vi.hoisted(() => ({ userRef: { current: 'alice' } }));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => userRef.current,
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

beforeEach(() => {
    store.__resetForTests();
    localStorage.clear();
    userRef.current = 'alice';
});

afterEach(cleanup);

const renderMenu = (props: Partial<React.ComponentProps<typeof SurfaceMenuList>> = {}) => render(
    <SurfaceMenuList surface="trade" onSelect={() => {}} {...props} />,
);

describe('N-22 — the busy badge', () => {
    it('draws nothing when no conversation is running', () => {
        const { container } = render(<RunBusyBadge conversationId="conv-a" />);
        expect(container.querySelector('[data-testid="run-busy-badge"]')).toBeNull();
    });

    it('draws the dot for the conversation that is running', () => {
        store.beginConversationRun('conv-a', new AbortController());
        const { container } = render(<RunBusyBadge conversationId="conv-a" />);
        expect(container.querySelector('[data-testid="run-busy-badge"]')).not.toBeNull();
    });

    it('draws nothing for a conversation that is NOT the running one', () => {
        store.beginConversationRun('conv-a', new AbortController());
        const { container } = render(<RunBusyBadge conversationId="conv-b" />);
        expect(container.querySelector('[data-testid="run-busy-badge"]')).toBeNull();
    });

    it('without a conversation id it answers "is ANY conversation running"', () => {
        const { container } = render(<RunBusyBadge />);
        expect(container.querySelector('[data-testid="run-busy-badge"]')).toBeNull();
        // The store notifies its subscribers, which is a React state update.
        act(() => { store.beginConversationRun('conv-a', new AbortController()); });
        cleanup();
        const second = render(<RunBusyBadge />);
        expect(second.container.querySelector('[data-testid="run-busy-badge"]')).not.toBeNull();
    });

    it('the dot is DECORATIVE — the sentence belongs in the accessible name', () => {
        store.beginConversationRun('conv-a', new AbortController());
        const { container } = render(<RunBusyBadge conversationId="conv-a" />);
        // A dot a screen reader cannot read is not an announcement.
        expect(container.querySelector('[data-testid="run-busy-badge"]')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('the colour comes from the run-status vocabulary, not from this component', () => {
        store.beginConversationRun('conv-a', new AbortController());
        const { container } = render(<RunBusyBadge conversationId="conv-a" />);
        const dot = container.querySelector('[data-testid="run-busy-badge"]')?.firstElementChild;
        const expected = runStatusPresentation('running').dot;
        expect(expected).toBeTruthy();
        expect(dot?.className).toContain(expected);
    });
});

describe('N-22 — the Chat surface row says so', () => {
    it('the Chat row is unchanged while nothing is running', () => {
        renderMenu();
        const chat = screen.getByRole('button', { name: /^Chat/ });
        expect(chat.getAttribute('aria-label')).toBe('Chat, shortcut Alt+4');
        expect(chat.querySelector('[data-testid="run-busy-badge"]')).toBeNull();
    });

    it('the Chat row names the running state in its accessible name', () => {
        store.beginConversationRun('conv-a', new AbortController());
        renderMenu();
        const chat = screen.getByRole('button', { name: /^Chat/ });
        expect(chat.getAttribute('aria-label')).toContain('A conversation is still running');
        expect(chat.querySelector('[data-testid="run-busy-badge"]')).not.toBeNull();
    });

    it('the busy sentence does not swallow the badge count', () => {
        store.beginConversationRun('conv-a', new AbortController());
        renderMenu({ badges: { agents: { count: 3, detail: '3 awaiting your decision' } } });
        const chat = screen.getByRole('button', { name: /^Chat/ });
        const label = chat.getAttribute('aria-label') ?? '';
        expect(label).toContain('A conversation is still running');
        expect(label).toContain('3 awaiting your decision');
        expect(label).toContain('Alt+4');
    });

    it('the badge adds no button — the row count the probe measures is unchanged', () => {
        // `tests/surfaceMenu.test.tsx` pins five buttons in the menu; a badge
        // that was a button would break the nav's shape.
        store.beginConversationRun('conv-a', new AbortController());
        renderMenu({ onOpenCustomize: () => {} });
        expect(document.querySelectorAll('[data-testid="surface-menu"] button')).toHaveLength(5);
    });
});
