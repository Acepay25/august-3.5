/**
 * Dead-control guard (2026-09-20 UI audit).
 *
 * Each assertion pins a control that was deleted because it could not do what
 * it claimed. They are source contracts rather than renders because the failure
 * mode is "someone re-adds the prop and nothing breaks" — a header that accepts
 * onOpenBotManager and never forwards it typechecked for months while its
 * sidebar row sat unreachable.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const read = (p: string): string => readFileSync(p, 'utf8');

const appSrc = read('App.tsx');
const headerSrc = read('components/shared/Header.tsx');
const sidebarSrc = read('components/shared/Sidebar.tsx');
const panelSrc = read('components/trade/TradeChatPanel.tsx');
const learnSrc = read('components/learn/LearnView.tsx');

describe('the bot roster has one owner', () => {
    it('no unreachable BotManagerDrawer chain exists', () => {
        expect(appSrc).not.toMatch(/BotManagerDrawer/);
        expect(appSrc).not.toMatch(/isBotManagerVisible/);
        expect(appSrc).not.toMatch(/syncBotsFromTeam/);
    });

    it('Header and Sidebar declare no onOpenBotManager they cannot forward', () => {
        expect(headerSrc).not.toMatch(/onOpenBotManager/);
        expect(sidebarSrc).not.toMatch(/onOpenBotManager/);
    });

    it('the per-seat overrides are edited from the Agents rail', () => {
        expect(appSrc).toMatch(/onEditSeatOverrides=\{setSeatOverridesBot\}/);
        expect(read('components/agents/AgentsView.tsx')).toMatch(/label: 'Debate overrides'/);
    });
});

describe('a control renders only when it can act', () => {
    it('the desk toggle is gated on a debate existing, not just on the handler', () => {
        expect(panelSrc).toMatch(
            /onToggleDeskScene && \(hasDeskSceneMessage \|\| isDeskSceneOpen\) && \(/,
        );
    });

    it('the palette offers desk view only when a debate exists to project', () => {
        expect(appSrc).toMatch(/\.\.\.\(isDeskSceneOpen \|\| deskSceneMessage \? \[\{/);
    });

    it('Learn does not mount StrategyStudio a second time', () => {
        // The word may appear in the rationale comment; the import and the
        // mount may not.
        expect(learnSrc).not.toMatch(/import\(.*StrategyStudio/);
        expect(learnSrc).not.toMatch(/<StrategyStudio/);
        expect(learnSrc).not.toMatch(/'skills'/);
    });

    it('the effort dropdown carries no decorative meter', () => {
        expect(panelSrc).not.toMatch(/EffortMeter|effort-meter/);
        expect(read('index.css')).not.toMatch(/effort-meter/);
    });

    it('every command-palette action id is unique', () => {
        const start = appSrc.indexOf('const commandPaletteActions = useMemo');
        // The array literal ends where the memo's dependency list begins.
        const block = appSrc.slice(start, appSrc.indexOf('\n    ], [', start));
        expect(block.length).toBeGreaterThan(1000);
        const ids = [...block.matchAll(/^\s+id: '([^']+)'/gm)].map(m => m[1]);
        expect(ids.length).toBeGreaterThan(5);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
