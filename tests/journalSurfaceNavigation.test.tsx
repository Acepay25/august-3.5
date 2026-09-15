/**
 * Journal navigation rewire (audit 2026-09-15, UI shell): journalState.isOpen
 * had NO live consumer (the overlay render was commented out), so the command
 * palette "Open Journal", the mobile drawer entry, the #/journal hash and the
 * Think-tab reasoning deep link were all silent no-ops. Everything now routes
 * through App's openJournal → setSurface('journal').
 *
 * Two layers of coverage:
 *  1. BEHAVIOR — the Header drawer's "Trading Journal" row must fire the
 *     onOpenJournal callback (Header owns that wiring; the prop replaced the
 *     dead setJournalState one).
 *  2. WIRING SCANS — the App-side routing (palette/hash/deep-link/embedded
 *     Journal props + the fixed serializer deps) lives inside the 3k-line App
 *     component's effects, which no jsdom render in this repo exercises;
 *     like tests/notebookCycleGuard.test.ts and
 *     tests/providerRequestPolicy.test.ts, we assert the source contract.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Header } from '../components/shared/Header';
import type { Conversation } from '../types';

const appSrc = readFileSync('App.tsx', 'utf8');
const headerSrc = readFileSync('components/shared/Header.tsx', 'utf8');

// jsdom lacks matchMedia (Sidebar/Header internals query it in some paths).
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
    window.localStorage.clear();
});

// ─── 1. Behavior: the mobile drawer routes through onOpenJournal ───────────

const renderHeaderWithDrawer = (onOpenJournal: () => void): void => {
    const conversations: Conversation[] = [];
    render(
        <Header
            activeUsername="tester"
            saveStatus="SAVED"
            isAnalysisInProgress={false}
            isPostMortemInProgress={false}
            currentVisionData={[]}
            isFreshSession
            isMobileMenuOpen
            mobileMenuRef={{ current: null }}
            setIsMobileMenuOpen={() => {}}
            setIsVisionDataVisible={() => {}}
            onOpenJournal={onOpenJournal}
            setIsSettingsVisible={() => {}}
            setIsLivePostMortemVisible={() => {}}
            onOpenLiveMarket={() => {}}
            onOpenVersionHistory={() => {}}
            conversations={conversations}
            activeConversationId={null}
            onNewConversation={() => {}}
            onLoadConversation={() => {}}
            onDeleteConversation={() => {}}
        />,
    );
};

describe('Header mobile drawer → journal surface routing', () => {
    it('clicking "Trading Journal" invokes the onOpenJournal callback', () => {
        const onOpenJournal = vi.fn();
        renderHeaderWithDrawer(onOpenJournal);
        fireEvent.click(screen.getByText('Trading Journal'));
        expect(onOpenJournal).toHaveBeenCalledTimes(1);
    });

    it('Header no longer carries the dead setJournalState plumbing', () => {
        expect(headerSrc).not.toMatch(/setJournalState/);
        expect(headerSrc).toMatch(/onOpenJournal: \(\) => void/);
    });
});

// ─── 2. Wiring contract inside App.tsx ─────────────────────────────────────

describe('App journal routing (source contract)', () => {
    it('the legacy isOpen plumbing is gone', () => {
        expect(appSrc).not.toMatch(/journalState\.isOpen/);
        expect(appSrc).not.toMatch(/setJournalState\(\{ isOpen: true/);
        expect(appSrc).not.toMatch(/journalState, setJournalState,/);
    });

    it('the dead overlay branch was deleted (Journal renders via the surface)', () => {
        // The commented-out overlay used isVisible={journalState.isOpen};
        // the ONLY <Journal render must be the embedded surface branch.
        const journalRenders = appSrc.match(/<Journal\b/g) ?? [];
        expect(journalRenders.length).toBe(1);
        expect(appSrc).toMatch(/<Journal[\s\S]{0,400}initialTab=\{journalTab\}/);
        expect(appSrc).toMatch(/initialTradeId=\{journalFocusTradeId\}/);
        expect(appSrc).toMatch(/onInitialTradeConsumed=\{handleReasoningTradeConsumed\}/);
    });

    it('palette "Open Journal" routes to the journal surface via openJournal', () => {
        expect(appSrc).toMatch(/label: 'Open Journal',[\s\S]{0,80}run: \(\) => openJournal\(\)/);
        expect(appSrc).toMatch(/setSurface\('journal'\)/);
    });

    it('the #/journal hash restore routes to the journal surface', () => {
        expect(appSrc).toMatch(/route\.view === 'journal'\) \{[\s\S]{0,120}setSurface\('journal'\)/);
    });

    it('the reasoning deep link routes to the journal surface Think tab', () => {
        expect(appSrc).toMatch(/openJournal\('reasoning', tradeId\)/);
    });

    it('the hash serializer depends on isApprovalInboxVisible (stale-URL fix)', () => {
        expect(appSrc).toMatch(/serializeAppHash\(route\)[\s\S]{0,400}\[surface, journalTab, isLiveMarketVisible, isSettingsMenuVisible, isWatchListVisible, isApprovalInboxVisible\]/);
    });

    it('NavRail + Alt-shortcuts enter the journal through openJournal', () => {
        expect(appSrc).toMatch(/onSelect=\{handleSurfaceSelect\}/);
        expect(appSrc).toMatch(/if \(next === 'journal'\) \{\s*openJournal\(\);/);
    });
});
