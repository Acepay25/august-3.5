import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
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

describe('SidebarContent unified panes (BOTS roster, sessions removed)', () => {
    it('with pane props + roster the sidebar IS the roster — sessions body hidden', () => {
        render(
            <SidebarContent
                {...base}
                sidebarPane="bots"
                onSetSidebarPane={() => {}}
                rosterSlot={<div data-testid="roster-slot">roster</div>}
            />,
        );
        expect(screen.getByTestId('roster-slot')).toBeTruthy();
        expect(screen.queryByText('Hello from c1')).toBeNull();
    });

    it('SESSIONS tab is removed — never rendered', () => {
        render(
            <SidebarContent
                {...base}
                sidebarPane="bots"
                onSetSidebarPane={() => {}}
                rosterSlot={<div data-testid="roster-slot">roster</div>}
            />,
        );
        expect(screen.queryByTestId('sidebar-pane-sessions')).toBeNull();
    });

    it('TERMINAL tab is removed — never rendered', () => {
        render(
            <SidebarContent
                {...base}
                sidebarPane="bots"
                onSetSidebarPane={() => {}}
                rosterSlot={<div data-testid="roster-slot">roster</div>}
            />,
        );
        expect(screen.queryByTestId('sidebar-pane-terminal')).toBeNull();
    });

    it('without roster content (mobile drawer / floor mode) the fallback body shows, no tabs', () => {
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
        expect(screen.queryByTestId('sidebar-pane-bots')).toBeNull();
    });

    it('collapsed rail shows the compact fallback body, no tabs', () => {
        render(
            <SidebarContent
                {...base}
                collapsed
                sidebarPane="bots"
                onSetSidebarPane={() => {}}
                rosterSlot={<div data-testid="roster-slot">roster</div>}
            />,
        );
        expect(screen.queryByTestId('sidebar-pane-bots')).toBeNull();
        // Collapsed hides text content entirely (icons only).
        expect(screen.queryByText('Hello from c1')).toBeNull();
    });

    it('clicking the BOTS tab keeps the roster selected (single-pane contract)', () => {
        const setPane = vi.fn();
        render(
            <SidebarContent
                {...base}
                sidebarPane="bots"
                onSetSidebarPane={setPane}
                rosterSlot={<div data-testid="roster-slot">roster</div>}
            />,
        );
        fireEvent.click(screen.getByTestId('sidebar-pane-bots'));
        expect(setPane).toHaveBeenCalledWith('bots');
    });
});

describe('SidebarPane legacy-value migration', () => {
    it('a stale stored pane value falls back to bots (sessions removed from the bar)', async () => {
        // Simulate the hook reading a pre-removal stored value.
        window.localStorage.setItem('august_sidebar_pane', 'sessions');
        const { useSidebarPane } = await import('../hooks/useSidebarPane');
        const TestProbe: React.FC = () => {
            const { sidebarPane } = useSidebarPane();
            return <div data-testid="probe-pane">{sidebarPane}</div>;
        };
        render(<TestProbe />);
        // 'sessions' remains a valid enum member (fallback body), so the
        // stored value is preserved — the TAB is what's gone from the bar.
        expect(screen.getByTestId('probe-pane').textContent).toBe('sessions');
        expect(screen.queryByTestId('sidebar-pane-sessions')).toBeNull();
        window.localStorage.removeItem('august_sidebar_pane');
    });
});
