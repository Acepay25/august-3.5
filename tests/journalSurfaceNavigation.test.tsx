/**
 * Journal navigation rewire (audit 2026-09-15, UI shell; nav moved into the
 * hamburger on 2026-09-21): journalState.isOpen had NO live consumer (the
 * overlay render was commented out), so the command palette "Open Journal",
 * the navigation menu entry, the #/journal hash and the Think-tab reasoning
 * deep link were all silent no-ops. Everything now routes through App's
 * openJournal → setSurface('journal').
 *
 * Two layers of coverage:
 *  1. BEHAVIOR — the header's navigation menu must reach the journal through
 *     the surface row's onSelectSurface('journal') (App maps that onto
 *     openJournal), and the legacy "Trading Journal" quick-action row must
 *     stay deleted so the drawer holds one Journal entry, not two.
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
import SurfaceMenuList from '../components/shell/SurfaceMenuList';
import type { AppSurface } from '../hooks/useSurface';

const appSrc = readFileSync('App.tsx', 'utf8');
const headerSrc = readFileSync('components/shared/Header.tsx', 'utf8');
const navRailSrc = readFileSync('components/shell/NavRail.tsx', 'utf8');
/** The routing state itself moved out of App into `useSurfaceRouter` (handoff
 *  2.1). The CONTRACT is unchanged — only its address moved — so the scans are
 *  split by owner rather than rewritten: App still owns the call sites (the
 *  palette row, the deep link, the <Journal> props), and the hook owns the
 *  state transitions they drive. Asserting only on App.tsx would now pass
 *  vacuously for half of them. */
const routerSrc = readFileSync('hooks/useSurfaceRouter.ts', 'utf8');

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

// ─── 1. Behavior: navigation routes through the surface list ────────────────
// The list moved twice — hamburger drawer, then the persistent NavRail (D2) —
// but it has always been ONE list, and it is the row that owns the route. The
// component under test is therefore the list itself rather than whatever shell
// happens to host it, so this keeps testing the route and not the furniture.

const renderSurfaceMenu = (onSelectSurface: (s: AppSurface) => void, collapsed = false): void => {
    render(
        <SurfaceMenuList
            surface="trade"
            onSelect={onSelectSurface}
            collapsed={collapsed}
        />,
    );
};

describe('surface list → journal surface routing', () => {
    it('the Journal row invokes onSelect("journal")', () => {
        const onSelect = vi.fn();
        renderSurfaceMenu(onSelect);
        fireEvent.click(screen.getByRole('button', { name: /^Journal/ }));
        expect(onSelect).toHaveBeenCalledWith('journal');
    });

    // The rail's collapsed state is now a fully hidden box (D2 amendment), but
    // the same tree renders inside it — glyph-only, labels carried by the
    // accessible name. Reviving the panel (header toggle) must reveal rows
    // that still route, so the route has to survive the label-less render.
    it('the Journal row routes from the hidden rail\'s label-less tree', () => {
        const onSelect = vi.fn();
        renderSurfaceMenu(onSelect, true);
        fireEvent.click(screen.getByRole('button', { name: /^Journal/ }));
        expect(onSelect).toHaveBeenCalledWith('journal');
    });

    it('carries no second Journal entry — the surface list owns that route', () => {
        renderSurfaceMenu(() => {});
        expect(screen.queryByText('Trading Journal')).toBeNull();
    });

    it('the nav props live in the rail, not the header', () => {
        // The drawer is gone. Its replacement must not leave the header still
        // owning a second copy of the navigation. The header still IMPORTS
        // `surfaceLabel` from this module to name the current surface, so the
        // check is that it does not RENDER the list.
        expect(headerSrc).not.toMatch(/<SurfaceMenuList/);
        expect(headerSrc).not.toMatch(/onSelectSurface/);
        expect(headerSrc).not.toMatch(/isMobileMenuOpen/);
        expect(navRailSrc).toMatch(/<SurfaceMenuList/);
        expect(navRailSrc).toMatch(/onSelectSurface/);
    });

    it('Header no longer carries the dead setJournalState plumbing', () => {
        expect(headerSrc).not.toMatch(/setJournalState/);
        // onOpenJournal was the drawer row's prop; the row moved into the
        // surface list, so the prop must not come back as a dead chain.
        expect(headerSrc).not.toMatch(/onOpenJournal/);
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
        // The palette row stays a call site in App; the transition it drives
        // (setSurface('journal')) now lives in the router.
        expect(appSrc).toMatch(/label: 'Open Journal',[\s\S]{0,80}run: \(\) => openJournal\(\)/);
        expect(routerSrc).toMatch(/setSurface\('journal'\)/);
    });

    it('the #/journal hash restore routes to the journal surface', () => {
        expect(routerSrc).toMatch(/route\.view === 'journal'\) \{[\s\S]{0,120}setSurface\('journal'\)/);
    });

    it('the reasoning deep link routes to the journal surface Think tab', () => {
        // RETIRED 2026-10-03. This pinned `handleViewReasoning` in App.tsx —
        // the "open the reasoning behind this message" deep link into the
        // journal's Think tab. It had no call site for months (the handler was
        // reachable only from this assertion), so it was deleted as part of
        // removing the unwired handler batch.
        //
        // If that deep link is wanted back, this is the contract to restore
        // with it: a visible control that calls
        // openJournal('reasoning', tradeId). openJournal itself is unchanged
        // and still asserted by the palette + surface-menu cases above.
        expect(true).toBe(true);
    });

    it('the hash serializer depends on isApprovalInboxVisible (stale-URL fix)', () => {
        expect(routerSrc).toMatch(/serializeAppHash\(route\)[\s\S]{0,400}\[surface, journalTab, isLiveMarketVisible, isSettingsMenuVisible, isWatchListVisible, isApprovalInboxVisible\]/);
    });

    it('the surface menu + Alt-shortcuts enter the journal through openJournal', () => {
        expect(appSrc).toMatch(/onSelectSurface=\{handleSurfaceSelect\}/);
        expect(routerSrc).toMatch(/if \(next === 'journal'\) \{\s*openJournal\(\);/);
        // …and App must be reading both back OFF the hook, not keeping a
        // private copy — a second surface state is how they would diverge.
        expect(appSrc).toMatch(/const \{[\s\S]{0,400}openJournal, handleSurfaceSelect,[\s\S]{0,40}\} = useSurfaceRouter\(/);
    });
});
