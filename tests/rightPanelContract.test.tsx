/**
 * The right-panel contract, as far as Stage 2 Phase 2 got to enforce it.
 *
 * The one behaviour here that is genuinely worth a guard is HIDE vs CLOSE.
 * Collapsing the Chart AI dock used to render a second, collapsed copy of the
 * panel in place of the real one, so React unmounted the live conversation to
 * mount a 10px rail — taking the composer's draft, the scroll offset and any
 * in-flight turn with it. A user who collapsed the dock to look at the chart
 * mid-analysis came back to an empty one. Every unit test in this repo passed
 * while that was true, because none of them collapsed anything.
 *
 * The behavioural proof is `scripts/ui-inspect.cjs`, which types a draft in a
 * real browser, collapses, expands and reads the draft back. These are source
 * contracts for the same rule: cheap, and they fail at review time instead of
 * only in a browser.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const tradeView = readFileSync('components/trade/TradeView.tsx', 'utf8');
const panel = readFileSync('components/trade/TradeChatPanel.tsx', 'utf8');
const shell = readFileSync('components/shell/RightPanel.tsx', 'utf8');
const hook = readFileSync('hooks/useRightPanel.ts', 'utf8');
const inspect = readFileSync('scripts/ui-inspect.cjs', 'utf8');

describe('the Chart AI dock hides, it does not close', () => {
    it('the dock wrapper is not behind a collapsed-only condition', () => {
        // The old shape was `{(!dockCollapsed || isBelowLg) && (<TradeChatPanel/>)}`
        // followed by a second panel for the collapsed rail. If that returns, the
        // panel unmounts again and the state loss returns with it.
        expect(tradeView).not.toMatch(/\(!dockCollapsed \|\| isBelowLg\)\s*&&/);
        expect(tradeView).not.toMatch(/<TradeChatPanel[\s\S]{0,400}?\bcollapsed\b/);
    });

    it('exactly one TradeChatPanel instance is rendered by the trade layout', () => {
        const mounts = tradeView.match(/<TradeChatPanel\b/g) ?? [];
        expect(mounts.length).toBe(1);
    });

    it('the collapsed presentation is its own component, not a panel prop', () => {
        // `collapsed` as a prop would mean a second mounted panel again.
        expect(panel).not.toMatch(/^\s*collapsed\?: boolean;/m);
        expect(panel).toMatch(/export const ChartAiDockRail/);
        expect(tradeView).toMatch(/import TradeChatPanel, \{ ChartAiDockRail \}/);
        expect(tradeView).toMatch(/<ChartAiDockRail/);
    });

    it('the hidden dock is inert, not merely invisible', () => {
        // A `visibility: hidden` box stays focusable, so without `inert` the
        // collapsed dock's controls would still take Tab focus off-screen. Both
        // now live in the shared shell; this surface only passes `isHidden`.
        expect(tradeView).toMatch(/isHidden=\{dockCollapsed && !isBelowLg\}/);
        expect(shell).toMatch(/inert=\{isHidden \? true : undefined\}/);
        expect(shell).toMatch(/visibility: 'hidden'/);
        expect(shell).toMatch(/pointerEvents: 'none'/);
    });

    it('the drag handle is not rendered while the dock is closed', () => {
        expect(shell).toMatch(/\{!isHidden && presentation === 'push' && \(/);
        expect(shell).toMatch(/role="separator"/);
    });

    it('a browser test actually exercises hide-vs-close, not just the source', () => {
        // Guard the guard: the source contracts above all pass on the old
        // swapping implementation if this is what is really being checked.
        expect(inspect).toMatch(/the draft survived the collapse/);
        expect(inspect).toMatch(/the collapsed dock stays MOUNTED/);
    });
});

describe('the dock width is the trader\'s, not a constant', () => {
    it('persists per surface under one namespaced key', () => {
        expect(hook).toMatch(/right_panel_width_v1_\$\{surface\}/);
        expect(hook).toMatch(/localStorage\.setItem\(widthKey/);
    });

    it('adopts the pre-contract key rather than resetting an existing dock', () => {
        expect(tradeView).toMatch(/legacyWidthKey: DOCK_WIDTH_KEY/);
        expect(tradeView).toMatch(/DOCK_WIDTH_KEY = 'trade_dock_width_v1'/);
    });
});