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
const railSrc = read('components/shell/NavRail.tsx');
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

    it('Header declares no onOpenBotManager it cannot forward', () => {
        expect(headerSrc).not.toMatch(/onOpenBotManager/);
        // The sidebar itself is gone (stage 3): conversation history lives in
        // the Agents rail, and a second sidebar would be a second list that
        // can disagree.
        expect(existsSync('components/shared/Sidebar.tsx')).toBe(false);
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

    it('the desk toggle keeps its gate after the palette died', () => {
        // The palette used to gate the same way; it is deleted (stage 3), so
        // the dock's 2D button — pinned above — is the only toggle left, and
        // no palette-shaped duplicate may re-arm itself in App.
        expect(appSrc).not.toMatch(/'desk-view'|Open desk view/);
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

    it('the command palette stays deleted — no half-remnant re-arms it', () => {
        // Stage 3 removed the palette (a fixed action list that duplicated
        // chrome and could not search anything); every sole-path action got a
        // real home. This pins the absence so a partial revert cannot strand
        // one of those homes with a second competing entry point.
        expect(existsSync('components/shared/CommandPalette.tsx')).toBe(false);
        expect(appSrc).not.toMatch(/commandPaletteActions|CommandPalette|PaletteAction/);
        // The keyboard binding went with it: Ctrl+K must not toggle a ghost.
        expect(appSrc).not.toMatch(/'k'\)\s*\{[^}]*setIsCommandPaletteOpen/);
    });
});

/**
 * The surfaces moved twice: out of the always-visible icon rail into the
 * header's hamburger (2026-09-21), then out of the hamburger into a
 * persistent rail again (Stage 2 Phase 2, decision D2). Each move deleted a
 * control, so each pins what replaced it — the risk here is a prop that
 * outlives its UI, or a route that quietly stops existing.
 *
 * What is deliberately NOT pinned is which chrome hosts the list. The failure
 * this guards against is a surface list that exists in two places (or none),
 * and a header that kept a nav prop after the nav moved out of it.
 */
describe('the surfaces live in the persistent nav rail', () => {
    it('the nav rail exists and App mounts it', () => {
        expect(existsSync('components/shell/NavRail.tsx')).toBe(true);
        expect(appSrc).toMatch(/<NavRail/);
        expect(appSrc).toMatch(/onSelectSurface=\{handleSurfaceSelect\}/);
    });

    it('the header no longer owns the navigation', () => {
        // The header's hamburger was the only nav host between the two moves;
        // if either comes back the app has two lists that can disagree.
        expect(headerSrc).not.toMatch(/<SurfaceMenuList/);
        expect(headerSrc).not.toMatch(/onSelectSurface/);
        expect(headerSrc).not.toMatch(/isMobileMenuOpen/);
        const railSrc = read('components/shell/NavRail.tsx');
        expect(railSrc).toMatch(/<SurfaceMenuList/);
    });

    it('the rail keeps the orphaned entry points the old rail had', () => {
        // Approvals stays a nav row; Switch profile moved onto the account
        // row (stage 3) — profile actions belong on the profile row, but the
        // rail must still carry both affordances somewhere.
        expect(railSrc).toMatch(/data-testid="nav-approvals"|data-testid="nav-switch-user"/);
        const menuSrc = read('components/shell/SurfaceMenuList.tsx');
        expect(menuSrc).toMatch(/data-testid="nav-approvals"/);
        expect(railSrc).toMatch(/data-testid="nav-switch-user"/);
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
        expect(learnSrc).toMatch(/id: 'coach', label: 'Skill approvals'/);
        expect(learnSrc).toMatch(/renderCoach\(\)/);
        const coachMounts = (appSrc.match(/<CoachThreadPanel\b/g) ?? []).length;
        expect(coachMounts).toBe(1);
    });
});

/**
 * SettingsMenu's journal interface (removed 2026-09-22).
 *
 * When the Journal stopped being an overlay inside Settings and became a
 * surface, it left behind a 16-prop block on SettingsMenuProps — onDeleteTrades,
 * modelIdToName, onUpdateInsights, onUpdateTradeLeverage, onUpdateOutcome,
 * onUpdatePnL, finalSummary, individualSummaries, the insight-progress trio,
 * onDeleteInsight, onRewriteInsightsWithAI — every one declared, never read, and
 * every one still computed and passed by App. Two `any`s in there were counted
 * warnings; the lint ratchet went 1022 → 1020 with them.
 *
 * The trap is that this reads as a wired surface. While it stood, App looked
 * like it handed SettingsMenu a journal, and adding one more editor prop there
 * (I nearly did, for the trade-class override) would have compiled, typechecked
 * and done nothing.
 */
describe('SettingsMenu has no vestigial journal interface', () => {
    const settingsSrc = read('components/settings/SettingsMenu.tsx');

    const DEAD = [
        'onDeleteTrades', 'onClearAllTrades', 'modelIdToName', 'onUpdateInsights',
        'isSummarizing', 'currentInsightIds', 'onUpdateTradeLeverage', 'onUpdateTradeType',
        'onUpdateOutcome', 'onUpdatePnL', 'finalSummary', 'individualSummaries',
        'isInsightGenerating', 'insightProgress', 'newlyAddedInsightIds',
        'onDeleteInsight', 'onRewriteInsightsWithAI',
    ];

    it.each(DEAD)('SettingsMenu does not declare or accept %s', (prop) => {
        expect(settingsSrc).not.toMatch(new RegExp(`\\b${prop}\\b`));
    });

    it('the journal is mounted from Journal.tsx, which does read them', () => {
        // Guards against "fixing" the dead props by deleting the live chain too.
        expect(read('components/journal/Journal.tsx')).toMatch(/onUpdateTradeType/);
        expect(read('components/journal/TradeLog.tsx')).toMatch(/onUpdateTradeType/);
    });
});
