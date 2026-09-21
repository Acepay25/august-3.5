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
import { existsSync, readFileSync } from 'fs';

const read = (p: string): string => readFileSync(p, 'utf8');

const appSrc = read('App.tsx');
const headerSrc = read('components/shared/Header.tsx');
const sidebarSrc = read('components/shared/Sidebar.tsx');
const panelSrc = read('components/trade/TradeChatPanel.tsx');
const tradeSrc = read('components/trade/TradeView.tsx');
const agentsSrc = read('components/agents/AgentsView.tsx');
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
        expect(agentsSrc).toMatch(/label: 'Debate overrides'/);
    });
});

describe('one read, one owner', () => {
    it('the learning queue is mounted once', () => {
        expect(read('components/dashboards/StrategyStudio.tsx')).not.toMatch(/LearningQueuePanel/);
    });

    it('harness lessons are mounted once', () => {
        expect(read('components/settings/SessionUsagePanel.tsx')).not.toMatch(/HarnessLessonsBrowser/);
    });

    it('the notebook has one browser and one diary readout', () => {
        expect(existsSync('components/dashboards/learning/NotebookSection.tsx')).toBe(false);
    });

    it('"try in chat" reaches a dock that is not mounted yet', () => {
        const link = read('components/chat/skillDeepLink.ts');
        expect(link).toMatch(/export const requestSkillTry/);
        expect(link).toMatch(/export const consumePendingSkillTry/);
        // The dock takes the parked token on mount, and clears it when the
        // broadcast lands, so a re-mount cannot replay a stale skill.
        expect(panelSrc).toMatch(/const parked = consumePendingSkillTry\(\);/);
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

/**
 * The 2026-09-21 nav move: the five surfaces left the always-visible icon rail
 * for the header's hamburger, and the Coach inbox left the Chart AI dock for a
 * Learn tab. Both deleted a control, so each pins what replaced it — the risk
 * here is a prop that outlives its UI, or a route that quietly stops existing.
 */
describe('the surfaces live in the hamburger menu', () => {
    it('the activity bar is gone, not merely unmounted', () => {
        expect(existsSync('components/shell/NavRail.tsx')).toBe(false);
        expect(appSrc).not.toMatch(/NavRail/);
        expect(appSrc).toMatch(/onSelectSurface=\{handleSurfaceSelect\}/);
        expect(headerSrc).toMatch(/<SurfaceMenuList/);
    });

    it('the menu keeps the rail\'s two orphaned entry points', () => {
        // Approvals and Switch profile had no other home; a menu that lists
        // only the surfaces would strand both.
        const menuSrc = read('components/shell/SurfaceMenuList.tsx');
        expect(menuSrc).toMatch(/data-testid="nav-approvals"/);
        expect(menuSrc).toMatch(/data-testid="nav-switch-user"/);
        expect(appSrc).toMatch(/onSwitchUser=\{handleSwitchUser\}/);
    });

    it('the order-book toggle still has a handler behind it', () => {
        // The rail's active-Trade icon used to be the only way to open the
        // book. The control moved into the Chart surface with its handler.
        expect(tradeSrc).toMatch(/data-testid="trade-book-toggle"/);
        expect(tradeSrc).toMatch(/\{onToggleSidebar && \(/);
        expect(appSrc).toMatch(/onToggleSidebar=\{toggleTradeSidebar\}/);
    });
});

describe('the Coach inbox has one host', () => {
    it('the dock declares no Coach surface it cannot render', () => {
        expect(panelSrc).not.toMatch(/renderCoachSurface|coachPending|coachSessionRequest/);
        expect(panelSrc).not.toMatch(/dock-surface-switch/);
        expect(tradeSrc).not.toMatch(/renderCoachSurface|coachPending|coachSessionRequest/);
    });

    it('Agents hops to the Coach instead of hosting a pane for it', () => {
        expect(agentsSrc).not.toMatch(/renderCoach\b/);
        expect(agentsSrc).toMatch(/onOpenCoach/);
        expect(appSrc).toMatch(/onOpenCoach=\{openCoachInLearn\}/);
    });

    it('Learn mounts the one CoachThreadPanel', () => {
        expect(learnSrc).toMatch(/id: 'coach', label: 'Coach'/);
        expect(learnSrc).toMatch(/renderCoach\(\)/);
        const coachMounts = (appSrc.match(/<CoachThreadPanel\b/g) ?? []).length;
        expect(coachMounts).toBe(1);
    });
});
