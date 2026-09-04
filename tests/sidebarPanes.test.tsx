import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { SidebarContent } from '../components/shared/Sidebar';
import type { SidebarPane } from '../hooks/useSidebarPane';
import { Conversation } from '../types';
import { Message } from '../types/message';
import { MessageRole } from '../types/enums';

// jsdom lacks matchMedia (the sidebar has hidden lg:flex internals).
const installMatchMedia = (): void => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: () => {}, removeListener: () => {},
            addEventListener: () => {}, removeEventListener: () => {},
            dispatchEvent: () => false,
        })) as unknown as typeof window.matchMedia;
    }
};

beforeAll(installMatchMedia);

afterEach(() => {
    cleanup();
    if (typeof window !== 'undefined') window.localStorage.clear();
});

const conversation = (id: string): Conversation => ({
    id,
    timestamp: Date.now(),
    title: `Session ${id}`,
    messages: [{
        id: `${id}-m1`,
        role: MessageRole.USER,
        text: `Hello from ${id}`,
        createdAt: new Date().toISOString(),
    } as Message],
    ocrModel: '',
    moderatorProviderId: '',
    moderatorModel: '',
    leverage: 1,
});

const base = {
    activeUsername: 'Ace',
    conversations: [conversation('c1')],
    activeConversationId: 'c1',
    hasVisionData: false,
    isFreshSession: false,
    onNewConversation: () => {},
    onLoadConversation: () => {},
    onOpenLiveMarket: () => {},
    onOpenVisionData: () => {},
    onOpenJournal: () => {},
    onOpenSettings: () => {},
    onDeleteConversation: () => {},
};

describe('SidebarContent unified panes (SESSIONS | BOTS | TERMINAL)', () => {
    it('without pane props (mobile drawer) there is no tab bar — sessions body only', () => {
        render(<SidebarContent {...base} />);
        expect(screen.queryByTestId('sidebar-pane-sessions')).toBeNull();
        expect(screen.queryByTestId('sidebar-pane-bots')).toBeNull();
        expect(screen.queryByTestId('sidebar-pane-terminal')).toBeNull();
        expect(screen.getByText('Hello from c1')).toBeTruthy();
    });

    it('renders the three tabs and switches bodies by pane', () => {
        let pane: SidebarPane = 'sessions';
        const setPane = (p: SidebarPane): void => { pane = p; };
        const { rerender } = render(
            <SidebarContent
                {...base}
                sidebarPane={pane}
                onSetSidebarPane={setPane}
                rosterSlot={<div data-testid="roster-slot">roster</div>}
            />,
        );
        expect(screen.getByTestId('sidebar-pane-sessions')).toBeTruthy();
        expect(screen.getByTestId('sidebar-pane-bots')).toBeTruthy();
        expect(screen.getByTestId('sidebar-pane-terminal')).toBeTruthy();
        expect(screen.getByText('Hello from c1')).toBeTruthy();

        // Click BOTS → parent state flips → rerender shows the roster slot.
        fireEvent.click(screen.getByTestId('sidebar-pane-bots'));
        rerender(
            <SidebarContent
                {...base}
                sidebarPane={pane}
                onSetSidebarPane={setPane}
                rosterSlot={<div data-testid="roster-slot">roster</div>}
            />,
        );
        expect(screen.getByTestId('roster-slot')).toBeTruthy();
        expect(screen.queryByText('Hello from c1')).toBeNull();

        // Click TERMINAL → jobs pane mounts.
        fireEvent.click(screen.getByTestId('sidebar-pane-terminal'));
        rerender(
            <SidebarContent
                {...base}
                sidebarPane={pane}
                onSetSidebarPane={setPane}
                rosterSlot={<div data-testid="roster-slot">roster</div>}
            />,
        );
        expect(screen.getByTestId('jobs-pane')).toBeTruthy();
        expect(screen.queryByTestId('roster-slot')).toBeNull();
    });

    it('bots pane without roster content (floor mode) falls back to sessions body', () => {
        render(
            <SidebarContent
                {...base}
                sidebarPane="bots"
                onSetSidebarPane={() => {}}
                rosterSlot={null}
            />,
        );
        expect(screen.getByText('Hello from c1')).toBeTruthy();
        expect(screen.queryByTestId('roster-slot')).toBeNull();
    });

    it('collapsed rail shows the compact sessions body, no tabs', () => {
        render(
            <SidebarContent
                {...base}
                collapsed
                sidebarPane="bots"
                onSetSidebarPane={() => {}}
                rosterSlot={<div data-testid="roster-slot">roster</div>}
            />,
        );
        expect(screen.queryByTestId('sidebar-pane-sessions')).toBeNull();
        // Collapsed hides text content entirely (icons only).
        expect(screen.queryByText('Hello from c1')).toBeNull();
    });

    it('sessions-only pane list when rosterSlot is omitted — BOTS tab never a dead end', () => {
        render(
            <SidebarContent
                {...base}
                sidebarPane="sessions"
                onSetSidebarPane={() => {}}
            />,
        );
        expect(screen.getByTestId('sidebar-pane-sessions')).toBeTruthy();
        expect(screen.queryByTestId('sidebar-pane-bots')).toBeNull();
        expect(screen.getByTestId('sidebar-pane-terminal')).toBeTruthy();
    });
});
