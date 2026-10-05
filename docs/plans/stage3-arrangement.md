# Stage 3 — UI arrangement + trade-intelligence refactor

Approved 2026-10-05. Continues the approved Stage 1/2 spec (`stage1-ui-ux-spec.md`,
`stage2-implementation-plan.md`). Branch: `stage3-ui-arrangement` off `main`.
One commit per phase; gates after each: `typecheck + test + lint + build + render-probe`
(+ `boot-probe` / `ui-inspect` for shell phases). Never `git add -A` — explicit paths only.

Decisions taken at approval: the ⌘K header pill AND the CommandPalette are removed with
every sole-path function rehomed; the Playbooks→Studio merge is kept as a strikeable
final phase (G).

## Ground truth (verified 2026-10-05, file:line)

- The "main chat" IS the Chat surface desk pane: App conversations and the Chart AI desk
  render from one flat array via `deskThread()` (`utils/agentThreads.ts:118-138`); loading
  a rail SESSIONS row silently swaps the transcript under a pane titled "Chart AI"
  (`AgentsView.tsx:513-518`).
- ⌘K CommandPalette = fixed ~16-action launcher, no data search, desktop-only
  (`CommandPalette.tsx`, `App.tsx:1783-1892`); pill `Header.tsx:339-351` hidden below md —
  touch never had it. Deleting it orphans 7 sole-path functions (StrategySearch,
  SavedAnalyses+delete, Analysis Gallery, ensemble toggle, clear-chat, jump-latest;
  desk-view is duplicated in the dock).
- Settings bugs: 2 of 3 auto-capture toggles decorative (`GeneralTab.tsx:208-230`;
  modals open unconditionally `useTradeLogging.ts:556,873`); Settings→Journal cards
  re-open Settings (`App.tsx:2209`); dead `august:open-settings` listener (`App.tsx:2421`);
  duplicate global-memory writers (`MemoryTab.tsx:50` + `MemoryFilesManager.tsx:298`);
  HarnessControls model dials live in the Data tab (`SessionUsagePanel.tsx:136-261`).
- Trade data (`types/trade.ts:28-168`): `timestamp` IS the log time (displayed in
  TradeLog); NO `planId` on trades, NO outcome-resolved-at; MAE/MFE written only by
  post-mortem (`usePostMortem.ts:601-619`) though the engine computes them
  (`outcomeEngine.ts:394-426`); PnL unit split (autopilot rows percent-only, manual
  dollar-only); autopilot rows lack discipline fields; `modelsUsed` collision fallback
  (`hooks/analysisPipeline/modelsUsed.ts:15-27`).
- Model's trade access today: aggregates only (`get_setup_history_stats`,
  `DeskToolsService.ts:2747`) + similarity top-5 via `recall`; NO chronological log tool.
  Per-MODEL rolling-20 exists (`ModelPerformanceService.ts:126`); NO trade-level last-20
  summary; pipeline history is coin-filtered ≤6 rows (`memoryContext.ts:178-195`).

## Target arrangement

**Header (all surfaces):** `[≡ toggle] SURFACE · August Trading · ● Ldn/NY ······
✓saved · ◍ Activity`. The Activity drawer (extends JobsDrawer) = job queue + skill-eval
audits + automations (relocated from the rail) + run history; visible at ALL breakpoints
(replaces the hidden-sm tray). saveStatus gains its missing ERROR branch. The Ldn/NY
popover stays (sole session clock).

**NavRail:** navigation only — 5 surfaces + Approvals + update row + account row
(click → Switch profile, gear → Settings). Deleted rows: New chat (Ctrl+N stays),
Search, AUTOMATIONS, SESSIONS, Live Market, Pinned signals, Vision Data, Switch profile.

**Chat surface = the one conversation home:** App conversations merge into the
AgentsView rail (dated section, same pin/delete mechanics; rail SESSIONS dies);
`+ New ▾` split-menu = New chat · New agent · New room · Coach inbox; the
Agents/Rooms/Coach chips are deleted (Agents was a literal duplicate of + New);
inactive/misconfigured bots collapse behind "▸ N inactive"; **pane title becomes the
thread's name**, not constant "Chart AI"; the pinned Chart AI row keeps opening the
dock session.

**Trade surface:** Pinned (WatchList) button next to Screener; feed dot on the symbol
picker replaces the ● CONNECTING pill; MARK + 24H CHANGE stats deleted (duplicates);
chart badge "● BTCUSDT · BINANCE · 5M" deleted (verdict-overlay text → floating chip);
"ƒ Indicators" → honest "ƒSMA" toggle; dock header: open-chat hop moves into ⋯.

**Learn gains a "System" tab:** VersionHistoryDashboard content (Algorithm placeholders
cut) + SessionUsagePanel usage dashboards + DiagnosticsPanel; the header clock button
dies with it.

## Phases

**A — Shell.** Header: remove ⌘K pill/Jobs/clock buttons, add Activity
(`Header.tsx:307-362`; `JobsDrawer.tsx` + automations from `Sidebar.tsx:402-464`).
Rail: nav-only (`Sidebar.tsx:346-578` deletions; account row absorbs Switch profile).
Chat sidebar merge + `+ New ▾` + inactive-collapse + honest pane title
(`AgentsView.tsx:693-975`). Delete dead AdvancedAnalyticsSidePanel (`App.tsx:2839-2868`,
never opened). Retarget render-probe/ui-inspect expectations same-commit.

**B — Palette removal + rehoming.** Delete CommandPalette + Ctrl+K
(`App.tsx:1433-1436,1783-1892,3243-3248`). Rehome: StrategySearch → Studio search entry;
SavedAnalyses archive + Analysis Gallery → new Journal "Saved" tab (one browser, delete
included); ensemble toggle → Settings→Analysis beside Accuracy; Clear chat → rail row ⋯
menu; jump-to-latest → scroll-to-bottom pill in `ChatTranscriptList`.

**C — Trust & noise.** Strip tool-call markup at settle (`chatTurnRunner.ts:684` +
regex gaps + abort path, `DeskToolsService.ts:2877-2888`); harness notice shows the
event, not the instruction (`chatTurnRunner.ts:1116-1117`); Blocked rows → one quiet
aggregate line (`ToolActionsRow.tsx:83-161`); planId dedupe for "Logged from Chart AI"
cards (`App.tsx:1908`); stale preview claiming fix (`utils/agentThreads.ts:84-99`);
paperclip disabled + explained when a bot is selected (attachments silently dropped,
`AgentsView.tsx:529-547`).

**D — Trade surface surgery.** Per target arrangement (`TradeView.tsx:819-915`,
`TradingChart.tsx:1097-1121`, `TradeChatPanel.tsx:841-992`); folds in the owed C9/P4
double-price-chip fix.

**E — Settings + Learn.** Wire the 2 auto-capture toggles (gate DataCaptureModal /
UpdateTradeModal); JournalTab cards route to the Journal surface; delete the dead
listener; memory toggle owned by Learn alone; drop duplicate stat tiles;
HarnessControls → Analysis tab; Learn "System" tab lands; Developer details slims to
version + link; General row (version/check-updates); Journal legacy overlay branch +
dead calibration stat deleted (`Journal.tsx:347-410,452-458`); Studio "Back to Chat" →
"Back to Trade".

**F — Trade-log intelligence.**
1. `get_trade_log` desk tool (`DeskToolsService`, near `:2747`; params
   limit/coin/outcome/strategy/since) returning chronological compact rows including
   ISO time-logged, outcome, PnL, R, lesson tag; registered in TRADE_TOOLS + arbiter
   allowlist; provenance row in `listRetrievedMemorySources`.
2. Last-20 summary — new pure `utils/recentTradesBrief.ts` (explicit timestamp sort):
   header stats (W/L, win rate, avg realizedR, net PnL, streak) + 20 one-line rows.
   Shown: Journal → Stats "Last 20" card; injected into pipeline context beside
   `lossPrimingRows` (`memoryContext.ts:197-211`) + moderator context; fed to
   post-mortem `tradeHistoryContext`; pullable via the new tool (`limit=20`).
3. Training-data completeness: stamp `planId` on LoggedTrade at log time (ProposedTrade
   linkage; also powers Phase-C dedupe); add `outcomeResolvedAt` written by
   autopilot/post-mortem; autopilot writes MAE/MFE at resolution (reuse
   `computeTradeExcursions`) + fills discipline fields when known; unify PnL units;
   checklist capture gains per-item results; "Export training data (JSONL)" in
   Settings → Data alongside CSV.
4. Model handling: consistent `modelsUsed` on every write path; amber model-fallback
   warning added to the Chat surface composer (dock-only today, `ChatComposer.tsx:105`);
   Journal→Models tab stays the per-model home.

**G (strikeable) — Playbooks merge.** StrategiesManager upload moves into Studio;
Settings→Playbooks becomes a pointer card. One library home.

## Tests

Extend `deskTools`/`deskToolStreamLoop`, `toolActions`, `proposedTrade`,
`agentThreads`; new `recentTradesBrief` + trade-log-tool suites; render-probe
expectation updates land in the same commit as the UI change they track.
