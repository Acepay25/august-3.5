# Deleting the ensemble debate — status

Owner order (2026-10-17): remove the ensemble debate **and** its related
features; keep Monte Carlo, key levels, watch list and price alerts as chat
tools; delete post-mortems entirely; delete accuracy mode + the calibration
ledger. Accepted consequence: the closed-trade learning chain
(recurring-mistake detection, insight extraction, global memory on close, lens
memory, closed-trade skill crafting) stops working with no replacement.

## Done (each: tsc + full vitest + lint + render-probe green)

- `03fc0d5` post-mortem deleted: `usePostMortem`, `MistakePatternService`,
  `JobQueueService`, `postMortemReport/Lessons`, ~1,450 lines in survivors.
  Both lesson stores (`aiPatternMemory`, `insightKnowledgeBase`) are now
  **frozen**; `LoggedTrade.postMortem` still reads through SQLite but has no
  writer, so `DecisionReflectionService`, `DoctrineConsolidationService`,
  `EvidencePackService`, `MemoryFilesService` and
  `PatternMemorySynthesisService` see only what a profile already carries.
  **The route was starved, not deleted** — 25 read accesses across 17 files
  remain outside the tests, and `craftSkillFromPostMortem`
  (`SkillCraftService.ts:140`) is still called from `botLearning.ts:234`; its
  guard `if (pm.length < 40) return null` (`:144`) is what makes it answer null
  for every trade closed after this date. Clearing the readers is stage 21.
- `854bd58` the 2D debate floor: DeskScene, PixelSeat, SpeechBubble,
  VerdictCard, DeskSteerInput, floorLayout, roomLayout, roleOverrides,
  DeskSeatMappingEditor, debateStageActors + 21 test files.
- `591f735` debate-derived history: BotSeatOverridesDialog, the Journal's Saved
  tab + SavedAnalyses, the dissent tally, the Conviction-auction card, the
  Reasoning panel's transcript block, `LiveStreamView`, AnalysisProgress's
  post-mortem props.
- `cf1c6e6` Settings: the `lenses` (Roles) tab, `AnalystLensSettings`,
  `LensesTab`, the "Team analysis" switch.

## Stage 20 — APPROVED 2026-10-18 with six changes; task ids 22–32

Owner approved the plan with: (1) the gate cap **and** the `verdictFinalizer` clamps
move into `present_trade`, running the gate on FRESH data, landing **before** 20b so
no commit ever leaves an uncapped `PENDING` row; (2) **bots stay chat-only** — do not
move `useBotMailbox` / `botRoutine` / `groupRounds` onto the tool turn; (3) add a
trade-shaped-prose-without-`present_trade` detector with a "log this?" chip; (4) add
max rounds, per-tool timeout, repeat-call detection, Stop-aborts-a-running-tool, and
a defined fallback when `deskToolsEnabled` is off or the provider can't call tools;
(5) specify the Chat surface's system prompt and log which skills were injected per
turn; (6) add reload-persistence and Stop-mid-tool probes. Decisions: Full analysis
survives as an instruction shortcut **with a required-tools check**; automations get
the same tool turn through a **third sink** with per-run and per-day trade caps and
visible failure on tool errors; the automation **characterization test lands before
stage 19**.

### 20a design fact found while starting it (task 22) — the sink must be event-shaped

The two row types do **not** share the tool transcript's fields, measured 2026-10-18:

- dock row = `LiveEntry` (`services/trade/chatStore.ts:48`, `StoredChatEntry & {…}`):
  carries `tools: string[]`, `toolIds: string[]`, `actions`
  (`chatTurnRunner.ts:682` appends the digest line and its id **in the same patch**,
  because the desk loop's `results` order does not match the rendered lines — pairing
  by index silently attaches the wrong payload).
- canonical row = `Message` (`types/message.ts`): has `thoughtProcesses` `:209`,
  `planId` `:350`, `toolActions?: ToolAction[]` `:355` — **no `tools`, no `toolIds`.**

So an executor that emits one shared state object cannot serve both homes without
either widening `Message` (a type change) or losing the chip/payload pairing on the
Chat surface. The extraction therefore takes an **event sink** — the executor calls
`onText / onReasoning / onToolLine / onToolPayload / onAction / onReset / settle` and
each home maps them onto its own fields. That is what 20a builds.

Second blocker for the cheaper "just lift the runner" route: the deps are captured
**at construction** (`chatTurnRunner.ts:201-283`, `useMemo` over 35 fields at
`TradeChatPanel.tsx:515-551`), including composer state (`draft`, `attachments`,
`setDraft`, `clearAttachments`, `setContextAt`) and `systemPromptFor`. Two surfaces
cannot share one instance built per-mount, so 20a converts turn-scoped context into
parameters and leaves the composer/state hooks with the caller.

**Not started:** no code moved. `runSeatTurn` (`:604-784`) is the extraction source;
its settle paths (abort `:741`, pure-echo `:765`, peel/leak `:780-783`,
`stripTextToolCalls` `:728`) must all survive the move unchanged — the dock's suites
are the proof.

## Stage 20 — measured contract (2026-10-18, no code written yet)

The goal is one tool-capable turn in **both** chat homes. Facts, so the next
session does not re-derive them:

- `streamChatWithDeskTools` is an **async generator** returning text deltas
  (`services/analysis/DeskToolsService.ts:3684`), and **every option is optional**
  (`StreamWithDeskToolsOptions`). It self-gates on
  `getHarnessSettings().deskToolsEnabled`, and `withDeskToolsSystemPrompt` will not
  double-inject the DESK TOOLS block if the system message already carries it.
- The dock consumes it at `chatTurnRunner.ts:641` with `allowedTools: TRADE_TOOLS`
  (`:96`, ~20 names, chart-aware: `get_chart_view`, `mark_trade_levels`,
  `draw_on_chart`) plus a frozen `PanelTurnContext` so a background turn still
  writes into its own transcript.
- The Chat surface's casual turn is the OTHER transport:
  `streamQuickResponse(...)` at `useAnalysisPipeline.ts:3197` — eight positional
  args, separate `onReasoning` channel, no tool loop. That is the asymmetry stage 20
  removes.
- Swapping the call is small; the three things that are NOT obvious and need
  deciding while doing it: (1) the reasoning side-channel — the generator yields
  visible text, so `Message.thoughtProcesses` needs its own route; (2) which tool
  subset a surface WITHOUT a chart may call — `get_chart_view` / `draw_on_chart`
  have no target there; (3) whether the Chat surface renders a tool chip (the dock's
  transcript rows already do).
- Lifting `createChatTurnRunner` into App is **not** the cheap route: its deps
  object (`chatTurnRunner.ts:201-283`) is 35 fields, most of them chart state
  owned by TradeView (`allDrawings`, `getChartSnapshot`, `addModelDrawings`,
  `onPlanPresented`). Do the transport swap, not the lift.

## OWNER RULING 2026-10-18 — what replaces the analysis branch

Asked which reading of "remove the ensemble debate" was meant, the answer was:
**one analyst pass, but reached by tool calling, not by a keyword.** In the
owner's words: *"I want the number 1 but the model should be able to do all that
using tool call not just when the keyword 'analyze this' it will trigger, we will
focus on tool calling, skills, and memory."*

So the target is NOT "keep the branch and shrink it to one seat". It is:

- **No keyword routing at all.** `isChartAnalysisRequested`
  (`useAnalysisPipeline.ts:1474-1484`) tests the prompt text for ANALYZE / CHART /
  SETUP / STRATEGY / LIVE MARKET and that whole gate goes away — a send is one
  turn, always.
- **One turn path**: the tool-capable transport both homes use —
  `streamChatWithDeskTools` (`DeskToolsService.ts:3684`), which the dock's solo
  seat already runs at `chatTurnRunner.ts:641`.
- **The verdict and the journal row become tools the model chooses to call**, not
  a pipeline stage it has to earn. What already exists: `present_trade`
  (proposal → `TradeAnalysis` with outcome PENDING, so the autopilot watches it),
  `mark_trade_levels`, `run_monte_carlo`, `get_market_packet` /
  `get_price_snapshot` / `get_order_book` / `get_derivatives` / `get_liquidations`
  for stage 1's data, `recall` / `get_setup_history_stats` for memory.
- **Skills and memory are the focus**, per the ruling: the notebook injection and
  the skill-approval path matter more than any run scaffolding.

Open engineering questions to settle while implementing, not before:
1. The **gate scan** (`GateKeeperService`, stage 2 today) — does it stay as
   post-processing inside `present_trade`, or become its own tool? Check whether
   `processAnalysisResult` already runs it on a presented plan; if it does, the
   answer is "keep it in the tool".
2. **`reasoningEffort`**: the tool generator yields visible text only, so the
   `Message.thoughtProcesses` side-channel needs its own route (the dock has one;
   the Chat surface currently gets it from `streamQuickResponse`'s `onReasoning`).
3. Which tools are meaningless on a surface with **no chart**
   (`get_chart_view`, `draw_on_chart`) — pass a chart-aware subset per home, do not
   let a tool call quietly no-op.

## Stage 19 — design question: RESOLVED (see the stage-20 ruling above)

**Answer, 2026-10-18: neither option as posed.** The verdict/levels/journal-row
capabilities are kept, but as **tools the model chooses to call** — so stage 19 is
still a deletion of the branch and the engine, and what stage 20 must finish first
is the tool path that replaces them (tasks 22–32). The text below is kept as the
record of why the order is what it is.

Structured chart analysis exists **only** inside the ensemble branch, and this app
has no solo-analysis path: `isChartAnalysisRequested`
(`useAnalysisPipeline.ts:1474`) lists `isEnsembleEnabled` as a trigger term, so with
the flag off every send is casual chat. Deleting the branch therefore deletes the
verdict, the entry/SL/TP, the levels drawn on the chart, the gate scan, and the
journal row that the autopilot watches — not just the debate.

Two readings of "remove the ensemble debate", and they are not the same product:
- **(a) convert**: collapse multi-seat debate into ONE analyst pass that still
  produces a `TradeAnalysis` verdict, keeping stages 1-3 and 7-8 (market data, gate
  scan, prompt assembly, tool loop, finalizer, Monte Carlo/backtest, journal row).
  The app keeps doing the thing it is for, with one model instead of a floor of them.
- **(b) delete**: the branch goes, chat-with-tools is the product, and "analyze this
  chart" becomes a conversational answer with no structured verdict and no journal
  proposal from a verdict.

The order of stages so far assumed (b). If (a) is wanted, stage 19 is a rewrite of
the branch rather than a removal, and the "Full analysis" affordance survives in
some form. Ask before starting; the diff is ~1,700 lines either way and the wrong
reading is expensive to undo.

## Next — order matters

1. **Stage 20 before 19.** Structured chart analysis exists ONLY in the
   ensemble branch: `isChartAnalysisRequested` (hooks/useAnalysisPipeline.ts:1474)
   lists `isEnsembleEnabled` as a trigger term, and the guard at :1488 is
   `isChartAnalysisRequested && runEnsembleEnabled`, with casual chat in the
   `else` at :3153. Delete the branch first and every send becomes casual chat
   with **no desk tools** — so move the Chat surface onto `chatTurnRunner` (the
   tool-capable runner the dock already uses) in the same change.
2. **Stage 19** the engine: branch 1488-3152 plus `runEnsembleEnabled` at
   848/872/1091/1154/1188, then `ensembleService`, `ensembleConsensus`,
   `debateScience`, `debatePods`, `EnsembleAnalystService`,
   `AnalystLensService`, `verdictFinalizer`, `autoplayParser`, `debateResume`,
   `streamThrottlers`, `runOutcome`, `utils/debate*`, debate prompts/markers/
   archetypes, `seatPersonas`, `handleSteerSeat`/`handleStopSeat` (~86 tests).
3. **Stage 17** accuracy mode + calibration ledger: `AccuracyValidationService`,
   `CalibrationLedgerService`, `calibrationPolicy`, `calibrationStore`,
   `calibrationPrompts`, `AccuracyModeModal`, the Settings toggle,
   `isAccuracyMode*`. Caution: `calibrationStore` also exports
   `detectTradingSession` (AlgorithmicSummaryService) and `ConfidenceLevel`
   (useTradeLogging, SelfLearningService, HybridIntelligenceService) — relocate
   those rather than delete them with the file.
4. **Stage 21** types (`DebateTurn`, `postMortem*`, the `savedAnalyses` store +
   SQLite table + backup plumbing), remaining gates, docs.

## Landed since the approval (2026-10-18, later in the same day)

- **20a (#22)** — `services/trade/toolTurn.ts` is the sink-based turn executor
  (`runToolTurn`), and `runSeatTurn` now only owns its row. The strip/settle/
  echo/repaint behaviours moved with it; `tests/toolTurn.test.ts` pins them and
  `tests/stage3NoiseFixes.test.ts` was retargeted at the executor (with a new
  assertion that the dock keeps no second copy of the strip).
- **20a2 (#23)** — already pushed as `f89b754`.
- **20g (#24)** — the loop already had max rounds (8), the turn budget
  (`DESK_TURN_BUDGET_MS`) and repeat/STALL detection. Added: `DESK_TOOL_TIMEOUT_MS`
  + `withinToolDeadline(call, work, signal, timeoutMs?)` in
  `services/analysis/DeskToolsService.ts`, applied to the built-in batch AND the
  forged-tool path, so a hung lookup returns a `DATA_UNAVAILABLE:` receipt
  instead of holding the round, and a Stop answers the pending call immediately.
  Both exits keep the assistant/tool pairing (nothing throws past the batch —
  the loop's round-top abort check still ends the turn). Fallback defined for
  tools-off: `runToolTurn` notices when the seat emitted protocol markup while
  `deskToolsEnabled` is off, so an answer that looked up nothing cannot read as
  an answer that looked something up. Tests: `tests/deskToolDeadline.test.ts`.
- **The coin a chat picks is now the coin the chart draws (#34)** — measured,
  not guessed: render-probe had been failing this check deterministically at
  `f89b754` (three clean runs). The picker's write landed and its own label
  followed, but the chart read a different row. Three places resolved "the
  active session" three ways: `AgentsView` rendered `active ?? sessions[0]`
  while writing `getActiveId()`; `TradeView` read `sessions.find(activeId)`
  with no fallback and only inside an effect; and `bindConversation` — which
  App calls when the trader switches homes — minted a session with NO symbol,
  so the chart opened on its default. Now `chatStore.getActiveSession()` is the
  one rule for read, write and adoption, `TradeView` seeds its first frame from
  it, and a minted bind inherits `symbol`/`interval`. Pinned by
  `tests/chartFollowsChatSession.test.tsx` (6). render-probe's check now also
  waits for convergence and prints the first paint, so a chart that merely
  lags is distinguishable from one that never follows.
- **20b (#27)** — the Chat surface's non-bot branch runs a tool turn:
  `services/trade/chatSurfaceTurn.ts` (tools from `CHAT_SURFACE_TOOLS`, no
  canvas tools), split from the bot arm at `useAnalysisPipeline.ts:3211`.
  Bots stay chat-only by ruling: `useBotMailbox` / `botRoutine` / `groupRounds`
  keep `streamQuickResponse`.
- **20b-B (#35)** — `present_trade` lifted out of the dock into
  `services/trade/presentTradeTool.ts`, called through a sink by both homes, so
  a plan presented from Chat lands a decision card on its own row; the
  logged/dismissed disposition map moved to `proposalDisposition.ts` so one
  store serves both. `watchable` is an explicit flag, not an inferred one — the
  dock arms a level-watch, the Chat surface honestly says it cannot.
- **20t (#29)** — `tests/automationRouteCharacterization.test.tsx` (8) pins the
  automation route BEFORE stage 19: private conversation, run continuity, the
  7-run cap, the overrides, the bot fork, the persisted direction, and the
  source shape of `runEnsembleEnabled`.
- **The flow docs re-measured.** A peer review scored the previous pass 61/66
  anchors and named 6 defects; all 6 were fixed, and defect 3 (anchor drift)
  recurs with every stage-20 commit, so both `docs/app-flow.md` and
  `docs/app-flow.html` were rewritten against the tree, not patched. The check
  is scripted: every `file.ext:NN` anchor in each doc is resolved and printed
  with the line it cites (`ANCHORS_CHECKED=30 PROBLEMS=0` for each). Two rules
  came out of it: a number lands only where it was measured THIS pass — the
  html previously carried ~100 numbers from an older revision, so nodes that
  name a file without a line were left without one rather than corrected by
  guess — and section C carries NO numbers by design, because those are exactly
  the lines stage 19 deletes.

## Deviations from the approved manifest (say so before repeating them)

- **WatchListPanel kept.** "Watch becomes a chat tool only" named the list, but
  the panel is a container: it also confirms autopilot resolutions and logs the
  trade from a fired signal — surviving features.
- **InlineVerdict kept**: it renders verdict fields, not a transcript, and
  AgentsView + ChatTranscriptList both mount it. Only its folded `VerdictAudit`
  disclosure is debate-shaped. My manifest called the component debate-only;
  that was wrong on inspection.
- `services/desk/idleMotion.ts` kept and relabelled "Reduce motion": its body
  class also stills `.reasoning-row[data-state=running]`, `.beacon::after` and
  every `animate-pulse` on surviving surfaces. The localStorage key stays
  `desk_idle_motion_v1_<user>` — renaming it silently resets every profile.
- `components/chat/pixelAvatars.ts` (moved out of `components/desk/`) kept:
  BotAvatar, NewBotDialog and agentRoster use `ROLE_ACCENTS`,
  `buildGridForRole`, `colorForToken`, `RolePreset`. Its three animation frame
  tables went (650 lines).

## Corrected claims

- Commit `591f735`'s message reported "488 files / 4915 tests"; the measured
  tree was 489 files / 4850 tests. Figures were written from memory instead of
  the log's summary line — corrected in `cf1c6e6`.

## Running the gates on this box

`NODE_OPTIONS=--no-experimental-webstorage`, one heavy gate at a time. Read the
log's own verdict line (`RENDER PROBE OK`, `Test Files …`), never a background
task's exit code. Lint has a `--max-warnings 889` ratchet (now 818).
