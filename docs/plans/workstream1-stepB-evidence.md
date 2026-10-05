# Step B — audit evidence (read-only, 2026-10-05)

Companion to `workstream1-stepB-gap-audit.md`. Every claim is a file:line in the
source, not a plan document. Produced without editing any implementation file.

## (a) Where trade and post-mortem records live

| platform | store | holds | authority |
|---|---|---|---|
| web | IndexedDB `FuturesAI-DB/userProfiles`, keyPath `username`, v1 — `services/infrastructure/dbService.ts:32-34,66` | `conversations, tradeLog, savedAnalyses, tradeSummaries, finalTradeSummary, globalMemory, insightKnowledgeBase, learningRules` (`hooks/useProfilePersistence.ts:115-131`, `types/user.ts:51`) | authoritative `dbService.ts:134-137` |
| Electron | same code path — `isNativePlatform()` is false (`SqliteService.ts:82`), so IndexedDB + localStorage under `%APPDATA%/<productName>` (`electron/main.cjs:42-43,60-61`) | as web | IndexedDB |
| native Capacitor | SQLite `futuresai_db`: `users, trades, conversations, trade_summaries, saved_analyses, thinking_records` (`SqliteService.ts:43,143-261`) | `trades` = core columns + `analysis` JSON + `meta` JSON of every non-core field | after the one-shot IDB→SQLite migration gated on Preferences `sqlite_migrated` (`dbService.ts:107-132`, `PreferencesService.ts:63`) |

- Preferences holds **no trade rows**, only post-mortem *derived* stores:
  `post_mortem_insights, attributed_insights_kb, learning_pending_rules_v1,
  model_performance_data, confidence_calibration, confluence_historical_stats,
  outcome_autopilot_state` (`PreferencesService.ts:34-47`); `learning_rules_v2` and
  friends are raw localStorage on native (`ExportService.ts:299-317`).
- Side stores: thinking corpus `FuturesAI-Thinking-DB/thinking_records`
  (`ThinkingStoreService.ts:24-25`), `august-msg-images` (`messageImageStore.ts:20-21`),
  `AugustBackups` (`BackupService.ts:32,57`).
- **One post-mortem, five places**: `trade.postMortem` (`usePostMortem.ts:614`),
  `trade_summaries` capped 100 (`:636-645`, `useTradeLogging.ts:24`), the post-mortem
  message inside `conversations` (`:560-571`), thinking turns (`:537-554`), and
  `globalMemory` (`:661`). `LoggedTrade.id === message.id` (`useTradeLogging.ts:252`).
- `entry`/`stopLoss` exist BOTH as SQLite columns and inside the `analysis` JSON blob
  (`SqliteService.ts:750-788`) — two copies of one fact.

## (b) Paths that make a rule/skill/strategy active with no human approval

| # | path | becomes active | human? | evidence |
|---|---|---|---|---|
| 1 | 12 pre-seeded `book-*` skills | candidate skill, `prior:'book'`, injected from birth | **no** | `seedStrategies.ts:234-252`; called `useUserProfileLoader.ts:376`; prior exemption `MemoryRetrievalService.ts:218` |
| 2 | PDF `book-*.md` drafts | inbox rows → then #5 | partial | `bookSkillDrafts.ts:175-192` |
| 3 | post-mortem IF/THEN auto-ingest | live skill, `prior:'gated'` | **no** | `SkillMemoryService.ts:2898→2386,2406` |
| 4 | LLM worth-gate `create` | live skill | **no** | `SkillMemoryService.ts:2951,2987→2063` |
| 5 | supervisor auto-approves drafts | skill born + `approvedBy:'supervisor'`, injectable | **no** | `supervisorStore.ts:84` (`autoEnabled=true`), `skillSupervisor.ts:209,570`, boot sweep `useSupervisorBootstrap.ts:40` |
| 6 | supervisor applies tools / amendments / re-scope rewrites | forged tool live; notebook file replaced; live IF/THEN rewritten | **no** | `skillSupervisor.ts:270,313-322,372-416,468-484` |
| 7 | candidate→confirmed evidence ladder | veto-grade enforcement | **no** | `SkillMemoryService.ts:1169-1248,1477-1510,2897` |
| 8 | A/B eval promotion ("helps ×2") | confirmed = hard veto | **no** | `SkillEvalService.ts:387-411`, auto-scheduled `SkillMemoryService.ts:3035` |
| 9 | shadow refinement auto-promotion | rewrites live `kind/ifCondition/thenAction/body` | **no** | `SkillMemoryService.ts:1421-1442`, `settleShadow:1769-1786`, opened at 3 losses `:3348` |
| 10 | consolidation / generalization | dupes archived, sources retired, new coin-less skill born | **no** | `SkillMemoryService.ts:2432-2543,2550-2574,1833-1835`; `skillGeneralization.ts:165,173-176`; driven `memoryHygiene.ts:230,269` ← `useLearningHeartbeat.ts:38,56-64` |
| 11 | idle suspend / auto-revive | in and out of prompts | **no** | `skillIdleLifecycle.ts:235-243,265-272` |
| 12 | doctrine, settled beliefs, rollup notes, lens memory, attributed insights, AI notebook notes | always-on prompt slots | **no** | `DoctrineConsolidationService.ts:180`, `weeklyRollup.ts:100-106`, `settledBeliefs.ts:141,163-172`, `MemoryRetrievalService.ts:702-711`, `usePostMortem.ts:656,661`, `JobQueueService.ts:167`, `PatternMemorySynthesisService.ts:619-627` |
| 13 | enforcement | confirmed avoid → riskVeto; candidate avoid → confidence cap | **no** | `SkillMemoryService.ts:3170-3200`, applied `analysisResultProcessor.ts:334`, `useAnalysisPipeline.ts:2201` |
| 14 | `strategies/*.md` | model may only write `status:'draft'`; only `active` reaches seats | **yes** | `strategyStore.ts:286,205-222`, `StrategyPlans.tsx:30` |

**What gates exist:** retrieval filters `file.enabled` and `status !== 'retired'` only
(`MemoryRetrievalService.ts:187,194`; `skillEnabledFlag` `SkillMemoryService.ts:675-676`
= not retired / not suspended / not user-disabled). **Nothing checks `approvedBy` or
`whyAccepted` at injection time.** Opt-outs are coarse (`isGlobalMemoryEnabled`,
`isMemoryEnabledInPureAI`); skill *enforcement* has no user toggle.

Worst combinations:
- #5 is the default and fires ~10 s after boot, so the "human gate" comment in
  `bookSkillDrafts.ts:8-15` is not the live behaviour for book drafts.
- #1 + #7/#8: a prior-carrying book seed bypasses the zero-evidence ban by design, can
  reach `confirmed`, and then hard-veto a trade nobody ever approved.
- #9 + #10 + #11 together mean a skill's text, status and folder can all change with no
  human while `enabled: skillEnabledFlag(...)` keeps it injected throughout.

Recommended fix (one mechanism, not thirteen): make **injection and enforcement read an
approval fact**, and make that fact something a human action sets.
1. Gate on `approvedBy` at retrieval/enforcement (a two-line predicate beside
   `skillEnabledFlag`), so #1/#3/#4/#9/#12 candidates stop reaching prompts or vetoes
   until approved — with an explicit "starter library is on" toggle for the books.
2. Turn #5's auto-approval into auto-*triage*: the supervisor may annotate, dedupe and
   order the queue, and only land writes when a per-class switch says so (default off
   for enforcement-bearing kinds, i.e. `avoid`).
3. Give #6 and #9 a reversible record on the row (`previousVersion` already exists for
   #9) and route the change through the proposal queue the human already reviews.
4. Add the missing toggle for enforcement (#13) — currently a confirmed `avoid` skill
   vetoes analysis with no user-facing off switch.

## (c) Recorded vs needed for MAE/MFE

- Optional today: `maxAdverseExcursion`, `maxFavorableExcursion`, `realizedR`,
  `rMultiple`, `pnlPercent`, `leverage` (`types/trade.ts:155-159,148,69,43`);
  approximate `slOptimizationData.maxAdverseExcursion` (`:120-130`).
- Needed to compute: `analysis.entryPoints[0].price/stopLoss/takeProfit[]/direction/
  coinName` as parseable strings (`BacktestingService.ts:1199-1206`,
  `types/analysis.ts:87-91,110`), a start time (`usePostMortem.ts:243`) and a candle tape.
- **Single writer** of MAE/MFE: `usePostMortem.ts:601-610` (leverage scaling `:594-597`).
  `AutoCaptureService.ts:57-81` never emits MAE/MFE — it produces `benchmark`
  (`:509-514`) and approximate SL data via `trackSLOutcome`
  (`StopLossOptimizerService.ts:288,325`, `OutcomeAutopilotService.ts:603-609`).
  `useTradeLogging.ts:294-299` writes `rMultiple`; journal edits touch outcome/PnL only
  (`useTradeJournalActions.ts:340,356`).
- Guards that make a row uncomputable: no candles `:1214`; unparsable entry/stop `:1232`;
  inverted plan `:1261`; entry never triggered `:1279`; unresolved exit → undefined pair
  `:1379-1400`; `computeTradeExcursions` null (`outcomeEngine.ts:401-407,416`); tape window
  hard-capped ~24 days from the analysis (`BacktestingService.ts:79-83`); symbol/plan
  mismatch returns before any write (`usePostMortem.ts:248-259`, `:228-232`);
  `analysis.createdAt` optional while `LoggedTrade.timestamp` is LOG time
  (`useTradeLogging.ts:255`).
- **Is old history recoverable?** Levels, symbol and a timestamp survive inside the
  persisted `analysis` blob, so re-derivation is arithmetically possible — but candles are
  never stored (`MarketDataService.ts:11-12`, 30 s in-memory) and the only caller needs a
  live message candidate (`PostTradeUploadModal.tsx:13-22`). **No backfill path exists**,
  so old rows are treated as unmeasured rather than recomputed
  (`disciplineAnalytics.ts:69,178-181`, `SkillMemoryService.ts:1076-1093`).
- **How many rows are affected cannot be determined from this repository** — there is no
  user database in the tree. It needs one query against the live profile/DB.

## (d) Code to delete or merge

| item | why | evidence |
|---|---|---|
| `LearningQueuePanel.apply` vs `CoachThreadPanel.applyProposal` | the same kind→applier branch twice, ~35 lines each; this branch already shipped the drift bug it invites | `components/skills/LearningQueuePanel.tsx:80-118`, `components/chat/CoachThreadPanel.tsx:215-251` |
| `applyProposalRewrite`'s `verdict.enhanced` branch | now a second, weaker implementation of `applyRescopeProposal` (no predicate handling, no read-back) | `skillSupervisor.ts:394-425` vs `SkillMemoryService.ts:2841-2880` |
| `EXPORT_RAW_KEY_CAP_BYTES` as a separate public const | duplicated meaning now that `EXPORT_KEY_CAPS` carries per-prefix ceilings | `ExportService.ts:353,368-379` |
| unused imports `ProviderConfig`, `sanitizePrediction` | two of the 861 lint warnings, in the file this branch touched most | `SkillMemoryService.ts:11,53` |
| `fmtUsd` local in `TradeView` | the spec put it in `utils/formatters.ts`; two money formatters now exist | `components/trade/TradeView.tsx:147` |
| `trade.postMortem` + `trade_summaries` + conversation message + thinking turns + globalMemory | five copies of one post-mortem; the cap-100 summary store is the one nobody reads back | `usePostMortem.ts:614,636-645,560-571,537-554,661` |
| `entry`/`stopLoss` as columns AND inside `analysis` JSON | two sources of truth for the same number | `SqliteService.ts:750-788` |
| legacy `geminiModelUsed`-style per-provider fields | read-only fallbacks since the dynamic-provider migration | `types/analysis.ts`, `modelsUsed` carriers |

## (e) Spec status (stage1-ui-ux-spec.md + stage2-implementation-plan.md)

Complete (proof in source, nothing owed): P0 all 7 items (dead `DebateStage`, stale
comments, `fmtPx`→`fmtPrice` `utils/formatters.ts:34`, `fmtPercent`
`utils/formatters.ts:59`, one R:R shape `drawingGeometry.ts:135`, lucide icons
`Sidebar.tsx:353,426`, bound header `Header.tsx:216`); P1 aliases `index.css:145-158`,
z-ladder `index.css:291-313`, dormant light mapping `index.css:251-263`, dashboards
`themeColors.ts:25`, `Icons.tsx` sole import surface, generic red/yellow→rose/amber
(0 remaining), focus rings `index.css:1554,1567`; P2 rail `App.tsx:138,2877`,
Ctrl/Cmd+B `App.tsx:1448`, collapsed-0px `NavRail.tsx:171,184`, account row/dot
`UpdateButton.tsx:31-68`, right-panel contract `useRightPanel.ts` +
`RightPanel.tsx:88-91`.

| item | status | what is missing |
|---|---|---|
| P1 `text-ui-micro` | complete-as-renamed | spec name never added; ships `--text-ui-dense` (`index.css:210`) |
| P1 hand-rolled SVGs → lucide | partial | `<svg>` remains in ChartToolRail, desk/DeskScene, desk/SpeechBubble, chat/BotFace, ModelPerformanceDashboard, SessionUsagePanel |
| P1 icon size set {h-3,h-4,h-5} | partial | 90 `h-3.5 w-3.5` sites under `components/` |
| P2 tab capsules | partial | `RightPanel.tsx:63` needs >1 dock; only `TradeView.tsx:1035` registers one → strip never renders |
| P2 fullscreen presentation | partial | `RightPanel.tsx:96` exists, `TradeView.tsx:1031` pins `"push"`; nothing forces it |
| P2 AdvancedAnalytics + Journal onto the panel contract | absent | `App.tsx:2840`; `Journal.tsx:356` keeps its own aside (`z-50`) |
| P3 `TypingIndicator` + 4 call sites | absent | no file anywhere |
| P3 multi-seat "N analysts thinking" | absent | per-seat text only, `DeskScene.tsx:667-671` |
| P3 GroupChatView live region | absent | `GroupChatView.tsx:384` has no `role`/`aria-live` |
| P3 "Thought for Ns" settle | partial | only `ReasoningRow.tsx:152`; `LiveStreamView.tsx:94-101` stays "Thinking…" |
| P3 per-model `<details>` standardization | partial | `ReasoningPanel.tsx:106-110` is its own shape |
| P3 expandable Clarification rung | absent | `RunContractPanel.tsx:37-66` static ladder |
| P3/P4 R:R on TradeProposalCard | absent | value exists (`proposedTrade.ts:113`), card never shows it (`TradeProposalCard.tsx:32-45`) |
| P3 R:R on VerdictCard + auction disclosure | absent | no `rr` prop (`VerdictCard.tsx:17-27`), auction always open `:84-108`; **and it only mounts on the desk floor** (`DeskScene.tsx:687`) |
| P3 unify Entry/Stop/TP labels | absent | `WatchListPanel.tsx:111-115` "Entry/SL" vs `CompareModal.tsx:91-92` "Stop loss/Take profit" |
| P4 splash cycler → one static line | absent | `index.html:37-41` |
| P4 first-run "Set up later" provider CTA | absent | `UserProfileManager.tsx:87-100` |
| P4 Developer out of `<details>` | absent | `SettingsMenu.tsx:461-469` |
| P4 General: version + "Check for updates" row | absent | version only at `SettingsMenu.tsx:472` |
| P4 focus return to invoker | absent | no `restoreFocus`/`returnFocus` in the repo |
| P4 UpdateButton installing state | absent | `UpdateButton.tsx:80-82` returns null |
| P4 "Up to date" on manual check | absent | `electron/main.cjs:1109-1112` sets `idle`, emits no event |
| P4 overlay technical details / no-rollback copy | absent | `UpdateOverlay.tsx:18` defers to the chip |
| P4 chart `role="img"` + aria + hidden summary | absent | `TradingChart.tsx:1118` labels only the status pip |
| P4 C9 chart retune (D6) | absent | border=body `:351-355`, crosshair unstyled `:349`, SMA yellow `:573`, no watermark anywhere |
| P4 Trade mobile tablist arrow keys | absent | `TradeView.tsx:924` has no `onKeyDown` |

Where the docs and the code disagree: stage-2's header says "Phases 0-2 complete" while
Task 3's capsules/fullscreen are unreachable and the AdvancedAnalytics + Journal asides
were never migrated; `{h-3,h-4,h-5}` and "23 SVGs handled" are both claimed and both
partly true; C1 places `fmtUsd` in formatters where it is still a `TradeView` local; the
R:R call sites in Phase 0/1 cite `TradingChart.tsx:907`, now `drawingGeometry.ts:135`;
`VerdictCard` is treated as the dock's signal card but renders only inside the desk
floor overlay.
