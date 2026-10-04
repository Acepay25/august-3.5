# Stage 2 — UI/UX Refactor Implementation Plan

**Status:** APPROVED (2026-10-03) — D1–D6 accepted as recommended. **Phases 0–2
complete**, including the Task 3 shared right-panel contract (third pass,
2026-10-04 — AdvancedAnalytics/Journal migration still owed to it). Phase 3 next.
**Companion doc:** [stage1-ui-ux-spec.md](./stage1-ui-ux-spec.md) (research + audit + design spec — all load-bearing claims fact-checked).
**Rule:** UI refactor, not a logic change. Preserve existing behavior and data.
Reuse the current stack (React 19, Tailwind v4 token block, lightweight-charts,
lucide-react, electron-updater) unless the spec justifies otherwise.

---

## Stage 1 readiness summary (what was verified before this plan)

- **Reference research: 28/28 claims verified** against fresh clones of
  NousResearch/hermes-agent and deepseek-ai/deepseek-harness (2 precision fixes
  applied; 4 missed patterns adopted: tooltip anti-tax, named z-ladder tokens,
  modality-aware focus rings, abort-ordered search).
- **Current-state audit: all 35 file:line citations checked, 6 corrected, rest
  confirmed.** Headline findings held: `DebateStage.tsx` is dead code; the
  update chip renders null while `installing`; R:R has two colliding conventions
  (reward-first vs risk-first); ~23 hand-rolled SVGs + 82 direct lucide imports
  bypass the icon layer; the "LIVE MARKET (BTC)" label AND the
  `useMarketData` sampler are both hardcoded to BTC.
- **Vela = LuxAlgo/Vela** (Apache-2.0), cited from source → spec A5 + C9.
  Its WebGL2/Pine machinery is NOT adopted; the chart stays lightweight-charts.
- **Honest gaps (flagged in the spec, carried here):** Claude Desktop /
  ChatGPT Desktop sections are docs-sourced (closed source) with **[not
  verified]** marks; the audit is code-level — visual acceptance happens
  per-phase below via render-probe + manual passes.

## Decision defaults (D1–D6)

Approved 2026-10-03 as recommended; each is reversible until its phase starts.

| | Decision | Default |
|---|---|---|
| D1 | Light theme | **Dormant** token mapping; ship dark-only (honors the 2026-09-10 decision) |
| D2 | Sidebar | ~~Persistent 56px rail → 280px panel~~ **AMENDED 2026-10-04 after living with it: collapsed = fully hidden (0px, inert); the expand affordance moves to the header and carries the update dot (DSH's hidden-sidebar pattern). Expanded = the 280px panel. Ctrl/Cmd+B unchanged; below 1024px always hidden.** |
| D3 | Dead DebateStage | **Delete** (component + steer test + unreachable seat-click plumbing) |
| D4 | R:R on trade/verdict cards | **Add**, one display shape `2.4:1` |
| D5 | Update flow | **Keep full-screen overlay** for download/ready; account row mirrors status |
| D6 | Chart retune | **Apply C9** (borderless candles, dashed crosshair, direction-colored price chip, role-based indicator colors) on existing hue tokens |

---

## Gates — run for every phase

```bash
npm run typecheck && npm run test && npm run build
npm run render-probe        # on an IDLE machine (doctrine: competing builds report blank surfaces)
npx eslint <changed files>  # errors fail CI; the --max-warnings 889 ratchet must not grow
```

- `npm run boot-probe` additionally whenever the shell, splash, or
  `electron/` is touched. `npm run installer-smoke` in Phase 4 (updater).
- Guard tests that constrain this work: `tests/themeContrast.test.ts` (hue
  allowlist), `tests/typeRamp.test.ts` (9/10px ban), `tests/deadControlsGuard.test.ts`.
- Render-probe expectations are updated **in the same phase** when nav
  structure changes (it asserts six entries: five surfaces + the Approvals
  overlay, `scripts/render-probe.cjs:764-777`).
- Staging discipline: explicit `git add <paths>` only — never `git add -A`
  (concurrent-agent landmine, per AGENTS.md history).
- After each phase, report: what changed, command results, which screens were
  verified by hand, anything deferred.

---

## Phase 0 — Dead code & standards (low risk, ~half a day)

**Tasks**
1. Delete `components/analysis/DebateStage.tsx`, `tests/debateStageSteer.test.tsx`;
   re-home or delete the type-only imports (`DeskScene.tsx:28-30`,
   `utils/debateStageActors.ts:16`).
2. Remove the dead `externalOpenActor` / `externalOpenActorNonce` state
   (`App.tsx:1351-1352`, set at `:3455-3456`, never read) and the stale comments
   describing the non-existent integration (`App.tsx:1346-1350`,
   `DebateStage.tsx:55-60`).
3. Delete the `fmtPx` duplicate (`KeyLevelsCard.tsx:39`) → canonical `fmtPrice`
   (`utils/formatters.ts:34-40`).
4. Add `fmtPercent(value, digits)` to `utils/formatters.ts`; call sites declare
   digits (win rates 0, P&L 1, spread/Brier 3).
5. Canonical R:R shape `2.4:1` at `TradingChart.tsx:907`,
   `utils/avoidReason.ts:78`, `utils/tradeInsightBrief.ts:41`. The realized
   "avg R" (`WeeklyReviewCard.tsx:33`) stays a distinct metric but formats
   through one helper.
6. Replace the `⏱` emoji (`Sidebar.tsx:441` → lucide `Timer`) and the plain
   `+` glyph (`Sidebar.tsx:431` → lucide `Plus`).
7. Bind the header market label to the symbol actually sampled
   (`Header.tsx:245`; expose the symbol from `useMarketData` — the sampler
   itself stays BTC-only; multi-symbol is logic, out of scope).

**Verify:** gates above + manual Trade & Journal pass.
**Risk:** low; `debateStageActors` re-homing is the only fiddly bit.

### Phase 0 result (done 2026-10-03)

Gates: typecheck clean · 4418 tests pass (467 files) · build clean · eslint 858
warnings against the 889 ratchet · render-probe OK with zero pageerrors.

Four points where the code disagreed with this plan, recorded so the doc does
not lie:

1. **`debateStageActors.ts` is live, not dead.** App and the desk floor both
   call it. Only `DebateStage.tsx` was dead, so `DebateStageActor` +
   `DebateExchange` were re-homed INTO that module (9 files imported those
   types from the deleted component).
2. **`DebateBotAvatar.tsx` was collateral** — its only production caller was
   the dead file, and its own test kept it green while nothing rendered it.
   Deleted with it, along with the `.bot-avatar` CSS (which was pasted twice).
   The live identity renderers are `BotAvatar`/`BotFace`/`pixelAvatars`; Phase 3
   should use one of those rather than resurrecting this.
3. **D4 shipped as shape-only, not digits-only.** "One display shape" is the
   reward-first `X:1` order; the digit count stays declared per call site,
   because `tests/analysisUtils.test.ts:521` pins the verdict markdown at
   `1.37:1` and `tests/drawingGeometry.test.ts:98` pins the canvas chip at
   `3.0:1`. Forcing 1 decimal everywhere would have re-rounded a quoted number
   — and made the avoid-reason print "1.0:1 is below the 1:1 floor" for a 0.97.
   Helper: `fmtRiskReward(ratio, digits)` + `fmtRMultiple(r)` in
   `utils/riskReward.ts`. A **fourth** risk-first site the audit missed:
   `BacktestResults.tsx:124`.
4. **The canvas R:R site moved before this phase began.** Task 3 names
   `TradingChart.tsx:907`, but the measured-move annotation was extracted
   into `components/trade/drawingGeometry.ts` by commit `0aea8c8`, so the
   site the shape actually had to be unified is `drawingGeometry.ts:135`
   (now `fmtRiskReward(ratio, 1)`). The requirement held; only the citation
   was stale. Stage 1's audit prose still cites the old line deliberately —
   it records the tree as audited on 2026-10-03.

Carried to Phase 1: the pre-existing dead `.debate-stage-*` / `.debate-seat-*`
CSS (`index.css:712-786, 1027-1110`) was orphaned by an earlier refactor, not
this one, and the stale `MessageItem` / `DebateSidePanel` comments still live in
`App.tsx:1704, 2082, 2181`, `hooks/useWatchAndAutopilot.ts:20`, `index.css:1819`.

## Phase 1 — Tokens, type ramp, icon standard (low-medium)

**Tasks**
1. Formalize semantic token aliases in `index.css` (`--surface-*`, `--ink-*`,
   `--trade-up/down`, `--warn`, `--info`, z-ladder tokens) — same hexes, no
   visual change; light-theme mapping dormant (D1).
2. Add `text-ui-micro` and migrate the 11px literals (`index.css:536, :768, :794`).
3. Re-token hardcoded chart/dashboard palettes via the existing `chartColor()`
   pattern: `EquityCurveDashboard.tsx:69-73`, `WinRateDashboard.tsx:40-50,410-438`,
   `VersionHistoryDashboard.tsx:193-201`, `ModelPerformanceDashboard.tsx:54`,
   `LearnView.tsx:99`, `AgentsView.tsx:797`, `AutomationView.tsx:46`;
   `getWinRateColor` (`components/dashboards/learning/shared.ts:12-17`).
4. `components/shared/Icons.tsx` becomes the sole import surface: migrate the
   78 production direct `lucide-react` imports; replace the ~23 hand-rolled
   SVGs per the C2 mapping table; enforce the size set `{h-3, h-4, h-5}` and
   default stroke 2; `SurfaceMenuList.tsx:11-17` picks one style.
5. Collapse the second color vocabulary (generic `red/green/yellow` classes →
   semantic `rose/emerald/amber` names, identical hexes today).

**Verify:** `themeContrast`, `typeRamp`, lint ratchet, render-probe on all six
probe surfaces.
**Risk:** low-medium — edit volume; keep every hue inside the allowlist.

### Phase 1 result (done 2026-10-03)

Gates: typecheck clean · 4423 tests pass (468 files) · build clean · eslint 858
warnings against the 889 ratchet (unchanged) · render-probe OK, zero pageerrors.

Four places the code disagreed with the plan, recorded so the doc does not lie:

1. **`text-ui-micro` was not added, because the step already exists.** Task 2
   asks for a base−3 role for the 11px literals; `--text-ui-dense` IS base−3
   (11px), and its own comment records the same 281-occurrence migration. A
   second name for one size is exactly the ambiguity `typeRamp.test.ts` exists
   to prevent, so the literals moved onto `dense` instead. The ramp's own
   comment had already covered this; the audit read it as missing.
2. **The z-ladder could not live in `@theme`.** Declared there first, the build
   proved Tailwind v4 has no `--z-*` namespace: every variable was silently
   dropped and a `z-modal` written against them would compile to nothing —
   an overlay with no z-index, worse than the literals it replaced. The rungs
   now sit in a plain `:root` rule with `@utility` declarations on top,
   verified by a build (`z-modal` → `z-index:var(--z-modal)`).
3. **`--ink-secondary: #a1a19b` (C1) is not a step of this ramp.** Writing it
   would have introduced a color the app has never rendered; the alias points
   at `zinc-400` `#a3a39d`, the existing step that role occupies.
4. **`chartColor` had to move out of `TradingChart.tsx`.** The dashboards need
   it, and importing it from there pulls the ~200 kB chart chunk into every
   dashboard bundle to get a four-line function. It now lives in
   `utils/themeColors.ts` and `TradingChart` re-exports it, so `TradeView` and
   the rest are unaffected.

**What actually changed.** Semantic aliases (`--color-surface-*`, `--color-ink-*`,
`--color-trade-up/down`, `--color-warn`, `--color-info`, `--color-hairline`) in
`@theme` — same hexes, verified emitted, and `bg-surface-page` generated. The D1
light mapping is written and ships inert (no element carries `data-theme`). The
six remaining fixed-size literals in `index.css` moved onto ramp roles, and the
dead `.debate-stage-*` / `.debate-seat-*` / `.debate-thread*` CSS carried over
from Phase 0 was deleted rather than restyled — 160 lines, zero references,
two of its animations naming keyframes that were never even defined. The
`MessageItem` / `DebateSidePanel` stale comments are gone with it. 106 generic
`red-*`/`yellow-*` class sites became `rose-*`/`amber-*` (every shade used has an
hex-identical target, so nothing moved). 77 files now import icons from
`components/shared/Icons.tsx`, which re-exports 101 lucide names verbatim
alongside its 64 legacy aliases; 11 hand-rolled glyphs were replaced and 10 kept
(identity/data/scene artwork). `tests/iconLayer.test.ts` is new and makes the
import surface, the 2px stroke, and the 12px size floor enforceable.

**Deliberately not done, and why.** The `{h-3,h-4,h-5}` size set is only half
enforced: the sub-floor `h-2.5` icons (13 sites) were raised to `h-3`, but ~87
icons sit at `h-3.5` (14px), and folding those to 12 or 16 moves pixels across
most of the app. That is a per-site design call, not a lint fix, so it is left
for a deliberate pass rather than mass-converted. The three ChartToolRail glyphs
also stay hand-drawn — each names a drawing tool (endpoints, anchor, level
bands) that lucide does not carry, and the guard test says so.

**Visible colour changes, on purpose:** WinRateDashboard's axis ticks carried the
pre-AA-bump `#6e6e68` and now read `zinc-600` `#7e7e78`; EquityCurveDashboard's
four stock-Tailwind hexes and ModelPerformanceDashboard's demoted-series gray
now sit on the ramp; ImageViewerModal's close button went 24px → 20px and
MemoryFilesManager's chevrons 14px → 16px (to match the sibling icon beside them).
`COLORS.blue` (`#42a1ff`) has no ramp step and stays literal for C9. `.ui-control`
in `index.css` is unreferenced dead CSS found next to the deleted block — left
alone as out of scope.

## Phase 2 — App shell: rail + right-panel system (highest risk)

**Tasks**
1. Build `NavRail` (persistent 56px) + `NavPanel` (280px, D2) reusing
   `SidebarContent` and `SurfaceMenuList` as-is; retire the hamburger drawer
   (`Header.tsx:418-476` portal); wire `Ctrl/Cmd+B`; auto-collapse below 1024px.
2. Bottom-pinned account row carrying profile, Settings entry, and update
   status (spinner + % while downloading, "Restart" when ready, red retry dot
   on failure; brand dot on the collapsed rail).
3. Right-panel contract: push vs fullscreen (below 768px forces fullscreen),
   drag-resize with no transition delay, width persisted per surface, handle
   hidden when closed, hide-vs-close for `TradeChatPanel` (stays mounted so
   scroll/composer state survives); tab capsules when multiple docks open.
4. Z-ladder tokens + modality-aware focus rings (C1).
5. Update render-probe expectations FIRST, in the same commit.

**Verify:** render-probe (surface counts, approvals inbox), `useSurface` /
`useSurfaceRouter` tests, `boot-probe`, manual pass at 800 / 1024 / 1440px
window widths (Electron floor is minWidth 800 / minHeight 600,
`electron/main.cjs:953-954`).
**Risk:** high — App.tsx is 3,500+ lines and the probe asserts counts; the
same-phase probe update is mandatory.

### Phase 2 result — partially done (done 2026-10-03)

Gates: typecheck clean · 4426 tests pass (469 files) · build clean · eslint 860
warnings against the 889 ratchet · render-probe OK, zero pageerrors. Ladder
utilities (`z-update`, `z-modal`, `z-confirm`, `z-drawer`) verified as emitted.

**Done.** Tasks 1 and 2 in full, and the z-ladder half of task 4.

- `components/shell/NavRail.tsx` is a persistent 56px column that expands to
  280px, replacing the hamburger drawer. The drawer's portal, its Esc/Tab-trap
  effect, the `isMobileMenuOpen` state in `useUIState`, and the header's
  hamburger are all gone rather than left dormant. `Ctrl/Cmd+B` toggles;
  below 1024px the rail is a rail whatever the user last chose — applied at
  render time, not written back, so widening the window restores the choice.
- `SurfaceMenuList` gained a `collapsed` mode. It is ONE list rendered at two
  widths, not a second icon set: a surface that could appear at one width and
  not the other is the drift this prevents. The collapsed row keeps
  `aria-current`, the badge and an accessible name that still carries the
  shortcut, which is also what lets the probe drive either width.
- The account row is bottom-pinned and owns update status: `UpdateButton` when
  expanded, `useUpdateStatusDot()` on the rail. The header's duplicate update
  chip was removed so there is exactly one status carrier.
- render-probe was retargeted in the same change, not afterwards: `navTo`
  scopes to `[data-testid="surface-menu"]`, `openMenu` became
  "ensure the rail is expanded", and four hamburger-click sites became direct
  row clicks. Five new checks cover the claim the old probe could not make —
  that navigation is on screen with no menu to open, that `Ctrl+B` collapses to
  56px and restores, and that a COLLAPSED rail still navigates.
- The three genuinely global overlay rungs (`z-[200]`/`z-[120]`/`z-[100]`, 9
  sites) now use `z-update`/`z-modal`/`z-confirm`. The other ~88 z-index
  literals were left alone on purpose: most are local stacking inside one
  panel (`z-40` in TimeframeBar, `z-10` in TradingChart), and naming a global
  rung after those would mislabel them. The lone `z-[101]` in ConfirmDialog
  stays literal because it is a deliberate +1 over its own backdrop, and that
  relationship has to survive.

**Not done, and why it is not a small remainder.** Task 3's remaining items —
push-vs-fullscreen as a *shared contract*, and tab capsules for multiple docks —
are untouched. Parts of the dock already existed per-surface (`TradeChatPanel`
persists its own width, `TradeView` already drag-resizes), which is what makes a
single contract worth building rather than adding to; unifying `AdvancedAnalytics`
and the Journal aside onto it, plus multi-dock tabs, touches the Trade surface's
layout and needs its own pass. Two dead tests were rewritten rather than deleted:
`deadControlsGuard` had pinned the OLD decision (rail absent), and
`journalSurfaceNavigation` asserted the drawer's routing; both now pin the new
contract and additionally assert the collapsed rail still routes.

### Phase 2 result — complete (second pass, 2026-10-03)

Gates: typecheck clean · 4434 tests pass (470 files) · build clean · eslint 860
warnings, 0 errors, against the 889 ratchet · render-probe OK, zero pageerrors ·
`scripts/ui-inspect.cjs` OK.

**A new probe was written for this phase: `scripts/ui-inspect.cjs`.** It answers
a question render-probe structurally cannot — "what does the shell actually look
like" — by measuring rather than eyeballing. It reads `getBoundingClientRect` and
`getComputedStyle` off the live DOM at 800 / 1024 / 1440px, collapsed and
expanded, and asserts: no horizontal overflow; the rail's width and ladder rung;
that the surface keeps a usable share of the viewport; that collapsing gives the
content back exactly the width the rail takes; that the theme is still the dark
one. It writes screenshots for a human, but deliberately never reads them back —
an automated pass that depends on an agent's eyes is not a gate.

What it measured at this commit: rail 56px below 1024 and 280px at/above it;
content 744px at 800 (93%), 744px at 1024, 1160px at 1440; collapse moves 224px
from rail to content with no overflow at any width; `body` still `#0b0b0a`.

**Focus rings (C1) are now modality-aware.** 19 call sites wrote a bare
`focus:ring-*`, which paints on every mouse click — training people to ignore the
one indicator that tells a keyboard user where they are. All 19 are
`focus-visible:ring-*` now, and `tests/themeContrast.test.ts` owns a new
focus-modality lockout so they cannot come back. The global ring is a named
`--focus-ring` token rather than a literal repeated per site.

**The Chart AI dock is hidden, not closed.** This was a real data-loss bug: the
panel rendered itself TWICE — collapsed it returned a 10px rail, expanded it
returned the dock — so React unmounted the live conversation to mount the rail,
destroying the composer draft, the scroll offset and any in-flight turn.
Collapsing the dock to look at the chart mid-analysis came back empty. Now one
instance stays mounted, `visibility: hidden` (which preserves the scroll box,
where `display: none` would not) plus `inert` so it leaves the tab ring, and the
rail is a separate presentational `ChartAiDockRail`.

Verified the only way it can honestly be: `ui-inspect` types a draft in a real
browser, collapses, expands, and reads the draft back. Three source-contract
tests in `tests/rightPanelContract.test.tsx` pin the shape, and one of them
asserts the browser test exists — otherwise all three would pass against the old
swapping implementation, which is exactly the bug.

**Two existing tests were source-scans pinned to the old two-instance dock** and
were updated rather than weakened: `scrollToMessageWiring` (the scroll bridge is
registered once now, which is the point) and `dockExpandedLayout` (its 420-char
window needed the JSX attributes reordered so `className` follows the testid).

## Phase 2, Task 3 — the shared right-panel contract (third pass, 2026-10-04)

Gates: typecheck clean · 4455 tests pass · build clean · eslint 859 warnings
against the 889 ratchet, 0 errors · render-probe OK, zero pageerrors ·
`scripts/ui-inspect.cjs` OK, including the draft-survives-collapse browser
check now running through the shared shell.

**The contract exists.** `hooks/useRightPanel` (geometry + lifecycle) and
`components/shell/RightPanel` (chrome) are the one implementation of: per-surface
persisted width (`right_panel_width_v1_<surface>`, clamped), push vs fullscreen
(below 768px forces fullscreen), drag-resize with the width transition suppressed
for the gesture, hide-vs-close (the hidden panel goes out of flow at its SAME
pixel width so the interior never reflows — `visibility: hidden` alone would
have left the collapsed dock occupying its full width in the flex row), and tab
capsules that render only when more than one dock is open. The Chart AI dock is
the first consumer: its bespoke drag listeners, `readDockWidth`, and local
`--dock-w` variable are gone; the shell publishes `--panel-w` and the surface
consumes it in its className, because where the width lands stays the surface's
layout decision (below lg the dock is a mode pane, not a panel). The old
`trade_dock_width_v1` key is adopted once via `legacyWidthKey`, so the upgrade
does not reset a dragged width. `right_panel_width_v1` is registered in
`ExportService.RAW_LOCAL_STORAGE_PREFIXES` (the `nav_rail_width_v1` precedent —
a restored backup must not silently reset the layout) — the export-registry
guard caught the first draft of this, which is the guard working.

**Still open from Task 3:** `AdvancedAnalytics` and the Journal aside have not
migrated onto the contract, so the capsule strip has no second consumer yet;
the fullscreen presentation is implemented but unused (the Trade dock pins
`push` deliberately — see the comment at its registration).

### Browser-found fixes from the same pass (the UI-quieting batch)

A dev-server walk of every surface at 1440px found these; each is verified in
the browser, not just in tests:

1. **The settings modal rendered its nav underneath the expanded rail.**
   `SettingsMenu`'s overlay wrapper was a literal `z-50` — the same rung as the
   rail's `z-drawer` — so DOM order let the rail paint over the modal's left
   column: the settings categories were in the DOM but invisible, and the
   search bar visually slid under the rail. Moved to `z-modal`, and with it the
   other full-viewport overlays still on literal `z-50`
   (`UserProfileManager`, `BotSeatOverridesDialog`, `NewGroupDialog`,
   `NewBotDialog`, both `ScenarioSimulator` wrappers,
   `VersionHistoryDashboard`) — they are app-global rungs, not local stacking,
   which is the distinction Phase 2's z-note drew. `JobsDrawer` stays: it is a
   right-side drawer that never shares space with the left rail.
2. **The rail carried identity three times.** The SidebarContent user footer
   (name + account popover), the NavRail account row (name + Settings + update
   dot), and a rose `Switch profile` row with a LogOut glyph all showed at
   once. The footer is deleted (its popover duplicated entries that exist
   elsewhere), the account avatar now shows the profile initial (the
   references' initials-block pattern), and Switch profile is a quiet zinc row
   with a `UsersRound` glyph — a routine identity change was dressed as a
   destructive sign-out.
3. **Shortcut chips are trailing keybinding text now (DSH).** Every surface
   row and New chat wore a permanent `Alt+n` / `Ctrl+N` chip; they are
   hover- and focus-revealed via opacity, which keeps the accessible name —
   the rows' `aria-label` already carried the shortcut, so nothing assistive
   depended on the visible chip.
4. **The Chart AI dock header wrapped its own title.** "Chart AI" broke onto
   two lines at the default 384px dock because the "answered N ago" meta was
   gated on the VIEWPORT (`sm:`) while the dock is user-dragged — on a 1440px
   window with a 370px dock the meta always lit. The brand is now `shrink-0`
   + `nowrap`, the session title flexes and truncates, and the meta is gated
   on the dock's own width with a `@container` query (`@min-[460px]`).

**Deliberately not done:** the chart's duplicated mark/last price chips (C9,
Phase 4); the splash's staged cycler (C3 launch, Phase 4); Studio row actions
hover-reveal (per-site design calls, not shell doctrine); the dock composer's
two-line "Scan skills" chip (cosmetic, needs its own look).

## D2 amendment — the resting view hides navigation entirely (2026-10-04)

The user, after seeing the 56px strip live, ruled that the collapsed state
should show nothing on the left — "too many icons" — and that the panel should
return to the hamburger's resting shape. The rail stays (D2's core: navigation
is a first-class panel, not a portal), but collapse now means HIDDEN:

- `NavRail` collapsed = 0px wide, `invisible`, `inert` — the dock's
  hide-vs-close pair applied to the rail, so the same tree renders inside it
  and expansion reveals the same nodes with their state intact. The border
  belongs to the expanded state only, or the "0px" box still measures 1px.
- The expand affordance moves to the header (`nav-rail-toggle-header`),
  present exactly while the rail is hidden, and carries the update-status dot
  — the DSH pattern for the hidden sidebar, so the one quiet status carrier
  stays visible in the resting view.
- Probes retargeted in the same change: render-probe's D2 block now asserts
  the hide (0px + inert), the header button's existence while hidden, its
  revive (back to 280px), and Ctrl+B re-hiding — and `ui-inspect` measures
  0px and proves routing through the REVIVED rail via the header's surface
  label (the old collapsed-row-click check would have passed vacuously
  against an inert rail).

## Phase 3 — Debate/messenger unification (medium)

**Tasks**
1. New `TypingIndicator` unifying the four framings (desk floor per-seat rows,
   LiveStreamView panels, transcript, GroupChatView): multi-seat "N analysts
   thinking…" with per-seat chips; `role="status"` + `aria-live="polite"`;
   settles to "Thought for Ns"; reduced-motion static.
2. Per-model expansion standardized on the `AnalyzedRow`/`ReasoningRow`
   `<details>` pattern (LiveStreamView already matches; `ReasoningPanel` cards
   adopt the summary line, keep grouping).
3. Make the clarification cycle readable after the fact: expandable
   "Clarification" rung in `RunContractPanel`, reusing `ReasoningPanel`'s
   stored-turn renderer (orchestration logic untouched).
4. R:R on `TradeProposalCard` + `VerdictCard` (D4; `rrRatio` already computed,
   `services/trade/proposedTrade.ts:113`); conviction auction behind a disclosure.
5. Unify Entry/Stop/TP label formats across the six inconsistent renderers.

**Verify:** `debateFlow` tests, render-probe chat rows, manual debate run.
**Risk:** medium — streaming rows re-render often; watch for layout shift on
stream chunks.

## Phase 4 — Settings, update flow, chart, polish (low)

**Tasks**
1. Settings: Developer out of the `<details>` into the nav groups; new General
   section with version + "Check for updates"; focus-return-to-invoker on close.
2. Update flow: `UpdateButton` installing state (currently renders null,
   `UpdateButton.tsx:28-30`); "Up to date" toast on manual check; error state
   with "View technical details" collapsed + plain statement that electron-updater
   has no rollback (re-download from the release page); account-row mirror from
   Phase 2.
3. Chart a11y: `role="img"` + aria-label (symbol · interval · last · trend) +
   visually-hidden summary; `KeyLevelsCard` remains the full text alternative.
4. C9 chart visual retune (D6): borderless candles, one hue per direction for
   body/wick, dashed 0.4-opacity crosshair, direction-colored last-price chip,
   recessive axis/grid, 5% watermark, role-based indicator colors
   (cyan=derived, amber=second line, trade hues=slope, gray dashed=levels) —
   via lightweight-charts options + the existing overlay canvas only.
5. Trade mobile tablist arrow keys (`TradeView.tsx:909-943`); GroupChatView
   live region (`GroupChatView.tsx:384-386`, if not folded into Phase 3).

**Verify:** full suite + `installer-smoke` (updater renderer changed) + manual
update-state pass. Renderer-only — `electron/main.cjs` untouched.
**Risk:** low.

---

## Out of scope / deferred (reported again at end of Stage 2)

- Per-agent win rates on the roster (needs `BotLearningStat` schema + computation — data work, recommend as follow-up).
- Clarification-cycle orchestration, provider/model logic, SQLite/learning services (logic, not UI).
- Light-theme activation (D1 dormant tokens only), settings value-search.
- Real updater rollback (electron-updater doesn't support it — documented, not built).
- Multi-symbol market sampling (sampler logic; Phase 0 binds only the label).
- Exact spacing/radii values for the closed-source references (marked [not verified] in Part A).
