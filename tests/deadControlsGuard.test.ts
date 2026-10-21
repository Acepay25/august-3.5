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
const composerSrc = read('components/trade/panels/ChatComposer.tsx');

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

    it('no per-seat override editor survives the debate', () => {
        // The dialog edited the BotRegistry record a DEBATE seat resolved to
        // (prompt, personality, tool allowlist). With no seats there is no
        // override to edit, and a row that opens a form for a dead concept is
        // exactly the inert control this file exists to catch.
        expect(appSrc).not.toMatch(/onEditSeatOverrides|seatOverridesBot/);
        expect(agentsSrc).not.toMatch(/Debate overrides/);
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
    it('the expand-over-chart row is gated on its handler', () => {
        expect(panelSrc).toMatch(/\{onToggleExpanded && \(/);
        expect(panelSrc).toMatch(/Expand over chart/);
    });

    // The Chat surface's switch lands on the Trade dock, so the dock has to be
    // handed the conversation's real handlers — a stub there is a control that
    // presses to nothing. The pane that used to be the panel's second host is
    // gone: it rendered the same rows without the chart, which read as an inert
    // toggle, so the switch became a route instead.
    it('the dock is handed the conversation handlers, not stubs', () => {
        expect(appSrc).toMatch(/onBotTurnCommit=\{commitDockBotTurn\}/);
        expect(appSrc).toMatch(/onSoloTurnCommit=\{commitSoloChatTurn\}/);
        expect(appSrc).toMatch(/conversationRows=\{messages\}/);
        expect(appSrc).toMatch(/onLogProposedTrade=\{handleLogProposedTrade\}/);
    });

    it('Learn does not mount StrategyStudio a second time', () => {
        // The claim is about the MOUNT, not the word: Learn has a 'skills' tab
        // now, and it renders the library through a node App supplies. What must
        // stay true is that this surface never imports or mounts the Studio
        // itself — a second copy was half-wired (no onClose) and gave "Try in
        // chat" nothing to reach.
        expect(learnSrc).not.toMatch(/import\(.*StrategyStudio/);
        expect(learnSrc).not.toMatch(/<StrategyStudio/);
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
describe('the surfaces live in the title-bar switch', () => {
    it('the switch exists and App mounts it exactly once', () => {
        expect(existsSync('components/shell/SurfaceSwitch.tsx')).toBe(true);
        // One node, built in App and handed to whichever title bar the surface
        // renders — the band's, or the Chat surface's own row. Two wirings is how
        // one of them drifts.
        expect(appSrc.match(/<SurfaceSwitch/g)?.length).toBe(1);
        expect(appSrc).toMatch(/surfaceSwitch=\{shellNavSwitch\}/);
        expect(appSrc).toMatch(/onSelect=\{handleSurfaceSelect\}/);
    });

    it('the destination rows are out of the sidebar, and the rail is out of the shell', () => {
        // The brief was to remove the tab strip that opened Trade / Journal /
        // Chat / Learn / Approvals / Custom. Renaming it (Learn → Knowledge) and
        // demoting two entries to tabs left the same list standing, so this pins
        // the removal itself rather than the label.
        expect(appSrc).not.toMatch(/<NavRail/);
        // The one nav list the Chat sidebar still renders is Customize only.
        expect(appSrc).toMatch(/hideSurfaces\b/);
        const menuSrc = read('components/shell/SurfaceMenuList.tsx');
        expect(menuSrc).toMatch(/hideSurfaces = false/);
        expect(menuSrc).toMatch(/!hideSurfaces && SURFACE_ITEMS\.map/);
    });

    it('no surface grows a second list of destinations', () => {
        const headerSrc = read('components/shared/Header.tsx');
        const agentsSrc = read('components/agents/AgentsView.tsx');
        expect(headerSrc).not.toMatch(/<SurfaceMenuList/);
        expect(agentsSrc).not.toMatch(/<SurfaceMenuList/);
        // The switch is handed IN to both, so neither can render its own copy.
        expect(headerSrc).not.toMatch(/<SurfaceSwitch/);
        expect(agentsSrc).not.toMatch(/<SurfaceSwitch/);
    });

    it('Settings is reachable on the surfaces that lost the account row', () => {
        // The gear lived in the rail's account row. With the rail gone, three
        // surfaces had no account row and would have silently lost Settings —
        // a control removed because its host moved is the exact failure mode
        // this file exists to catch.
        expect(appSrc).toMatch(/onOpenSettings=\{\(\) => setIsSettingsMenuVisible\(true\)\}/);
        const header = read('components/shared/Header.tsx');
        expect(header).toMatch(/data-testid="header-settings"/);
    });

    it('profile switching has one home in Settings, and the account row is a readout', () => {
        const railSrc = read('components/shell/NavRail.tsx');
        expect(railSrc).not.toMatch(/nav-switch-user/);
        const menuSrc = read('components/shell/SurfaceMenuList.tsx');
        // Inverted on purpose: Approvals is a tab of the Knowledge surface, so a
        // rail row for it was a second destination for one queue and a duplicate
        // count on one screen. The number rides the surface that holds it.
        expect(menuSrc).not.toMatch(/data-testid="nav-approvals"/);
        const profileSrc = read('components/settings/tabs/ProfileTab.tsx');
        expect(profileSrc).toMatch(/onSwitchUser/);
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
        expect(appSrc).toMatch(/onOpenCoach=\{openApprovalsInLearn\}/);
    });

    it('Learn mounts the one CoachThreadPanel', () => {
        expect(learnSrc).toMatch(/id: 'coach', label: 'Approvals'/);
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

describe('a class the framework does not generate must have a rule behind it', () => {
    // `form-checkbox` is a Tailwind **v3 forms-plugin** name. This app runs v4
    // and never installed the plugin, so the class styled NOTHING and Chromium
    // painted a native white checkbox — the brightest object on the Journal
    // surface, with `bg-zinc-950` beside it ignored because a UA-appearance
    // control draws its own background. jsdom cannot see any of this: it mounts
    // markup without resolving a stylesheet, so the only gate is the source.
    const css = read('index.css');
    const users = ['components/journal/TradeLog.tsx'];

    it('the class is really used — this is not a rule written for nothing', () => {
        for (const f of users) expect(read(f)).toMatch(/form-checkbox/);
    });

    it('the rule removes the UA appearance, which IS the defect', () => {
        const rule = css.match(/\.form-checkbox\s*\{[^}]*\}/);
        expect(rule, 'no .form-checkbox rule in index.css').toBeTruthy();
        expect(rule![0]).toMatch(/appearance:\s*none/);
    });

    it('a checked box gets a mark, because appearance:none draws no glyph', () => {
        const checked = css.match(/\.form-checkbox:checked\s*\{[^}]*\}/);
        expect(checked, 'no checked-state rule: the box would go blank when ticked').toBeTruthy();
        expect(checked![0]).toMatch(/background-image:/);
    });
});

/**
 * E-57: the harness-lesson store advertised a prompt reader it did not have.
 * `formatHarnessNotesBlock` fed the ensemble's arbiter, the ensemble was
 * deleted, and the store's own header still claimed "read by roster build,
 * reasoningControls, and the run-snapshot assembler" — a header that names a
 * consumer which no longer exists is the same class of lie as an inert button,
 * because the next reader of that file believes the loop is closed.
 */
describe('the harness-lesson store says who actually reads it', () => {
    const lessonsSrc = read('services/learning/harnessLessons.ts');
    const dead = /formatHarnessNotesBlock|lessonsForClass/;

    /**
     * The identifiers MAY appear in prose — this repo names deleted code on
     * purpose so the next reader knows why it went (see the dated deletion
     * ledger). What must never appear again is a line of CODE that declares,
     * imports or calls one. So the scan is per line, and a line whose first
     * non-space token is a comment marker is not code.
     */
    const codeLinesNaming = (src: string, name: RegExp): number[] =>
        src.split('\n')
            .map((line, i) => ({ line, n: i + 1 }))
            .filter(({ line }) => name.test(line))
            .filter(({ line }) => !/^\s*(\/\/|\/\*|\*)/.test(line))
            .map(({ n }) => n);

    it('the deleted readers appear on no code line, anywhere', () => {
        for (const f of [
            'services/learning/harnessLessons.ts',
            'services/learning/SkillMemoryService.ts',
            'services/learning/metaCalibration.ts',
            'services/analysis/HybridIntelligenceService.ts',
            'services/providers/GenericAnalysisService.ts',
            'services/trade/tradeChatContext.ts',
            'components/settings/HarnessLessonsBrowser.tsx',
        ]) {
            expect(codeLinesNaming(read(f), dead), `${f} still names a deleted lesson reader in code`).toEqual([]);
        }
    });

    it('the scan actually bites — a called reader on a code line is a finding', () => {
        // Without this control the rule above is a claim about a regex that
        // matched nothing at all.
        expect(codeLinesNaming('const x = formatHarnessNotesBlock();\n', dead)).toEqual([1]);
        expect(codeLinesNaming('// formatHarnessNotesBlock was deleted (E-57)\n', dead)).toEqual([]);
    });

    it('the store itself is NOT dead — the wire-audit pin checker still reads it', () => {
        // This is the assertion that stops the NEXT cleanup from deleting the
        // store because "nothing prompts from it". A lesson can pin a provider
        // class to thinking-off, and `reasoningControls` asks for that.
        expect(lessonsSrc).toMatch(/registerWireRoutePins\(/);
        expect(read('services/providers/reasoningControls.ts')).toMatch(/registerWireRoutePins/);
    });

    it('the Settings browser is still the human reader', () => {
        expect(read('components/settings/HarnessLessonsBrowser.tsx')).toMatch(/listHarnessLessons/);
    });

    it('the header names readers that exist, and says there is no prompt reader', () => {
        expect(lessonsSrc).not.toMatch(/read by roster/);
        expect(lessonsSrc).toMatch(/There is NO prompt reader/);
    });
});
