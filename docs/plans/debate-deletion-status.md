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
  (`chatTurnRunner.ts:687` appends the digest line and its id **in the same patch**,
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
**at construction** (`chatTurnRunner.ts:204-285`, `useMemo` over 35 fields at
`TradeChatPanel.tsx:515-556`), including composer state (`draft`, `attachments`,
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
  (`services/analysis/DeskToolsService.ts:3933`), and **every option is optional**
  (`StreamWithDeskToolsOptions`). It self-gates on
  `getHarnessSettings().deskToolsEnabled`, and `withDeskToolsSystemPrompt` will not
  double-inject the DESK TOOLS block if the system message already carries it.
- The dock consumes it at `chatTurnRunner.ts:636` with `allowedTools: TRADE_TOOLS`
  (`:96`, ~20 names, chart-aware: `get_chart_view`, `mark_trade_levels`,
  `draw_on_chart`) plus a frozen `PanelTurnContext` so a background turn still
  writes into its own transcript.
- The Chat surface's casual turn is the OTHER transport:
  `streamQuickResponse(...)` at `useAnalysisPipeline.ts` line 3197 (pre-deletion
numbering; the file is shorter now) — eight positional
  args, separate `onReasoning` channel, no tool loop. That is the asymmetry stage 20
  removes.
- Swapping the call is small; the three things that are NOT obvious and need
  deciding while doing it: (1) the reasoning side-channel — the generator yields
  visible text, so `Message.thoughtProcesses` needs its own route; (2) which tool
  subset a surface WITHOUT a chart may call — `get_chart_view` / `draw_on_chart`
  have no target there; (3) whether the Chat surface renders a tool chip (the dock's
  transcript rows already do).
- Lifting `createChatTurnRunner` into App is **not** the cheap route: its deps
  object (`chatTurnRunner.ts:204-285`) is 35 fields, most of them chart state
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
  (`useAnalysisPipeline.ts:1481 (comment)`) tests the prompt text for ANALYZE / CHART /
  SETUP / STRATEGY / LIVE MARKET and that whole gate goes away — a send is one
  turn, always.
- **One turn path**: the tool-capable transport both homes use —
  `streamChatWithDeskTools` (`DeskToolsService.ts:3933`), which the dock's solo
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
(before its deletion, `useAnalysisPipeline.ts` listed `isEnsembleEnabled` as a trigger term), so with
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
   ensemble branch: `isChartAnalysisRequested` (hooks/useAnalysisPipeline.ts)
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
  canvas tools), split from the bot arm at `useAnalysisPipeline.ts` line 3211
(pre-deletion numbering).
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
- **20c (#28)** — the keyword gate is deleted. `isChartAnalysisRequested` tested
  the prompt for `LIVE MARKET` / `STRATEGY` / `ANALYZE` / `CHART` / `SETUP` and the
  result was ANDed with `runEnsembleEnabled`, which already contained
  `isEnsembleEnabled`. Measured consequence: for a human send those five tests could
  never change the route — toggle on, every send analyzed whatever it said; toggle
  off, no wording made one analyze — so the only thing wording decided was whether a
  *scheduled* run got a verdict, contradicting the flag's own comment that
  automations always run the pipeline. The guard is now `if (runEnsembleEnabled)`
  alone, which makes that comment true. The brief also told me to delete "its
  prompt-text tests"; none existed — the predicate had one consumer and one
  source-shape pin, which I rewrote to bind the guard to its first statement
  (`if (runEnsembleEnabled) {` also appears at the data pull, so a bare match would
  stay green with the fork deleted) and to forbid the call shape `Prompt.includes(`.
- **20s (#25)** — the Chat surface finally has a prompt of its own.
  `chatSurfaceSystemPrompt` (`chatSurfaceTurn.ts:165`) leads with
  `CHAT_SURFACE_SYSTEM_PROMPT` (`chatPrompts.ts:40`), which is
  `CASUAL_CHAT_SYSTEM_PROMPT` **plus** a calling mandate and an explicit
  "NO CHART HERE" — so the output discipline that fixed the
  "Here's a thinking process:" replies is inherited, not replaced — then appends
  the skills index, the active strategy plans and the profile memory index, each
  read fresh per turn exactly as the dock reads them. Two things this exposed:
  `buildSkillsIndexForPrompt`'s heading said "match **this chart**", so a canvas
  free seat was being told to match a chart it cannot see — it now takes a `where`
  argument and the dock's default is byte-identical (pinned as a control); and the
  slugs that travelled are recorded on the row (`Message.injectedSkills`,
  `types/message.ts:278`) bounded to the 30 the index printed, so the record cannot
  claim skills the model never saw. Tests: `tests/chatSurfacePrompt.test.ts` (10).
  Full suite: 496 files / 4922 tests, lint back on the 818/0 baseline after four
  `no-useless-assignment` errors from initialized-then-overwritten locals.
  The probe then FAILED once on `the dock header jumps straight to Chat — no
  menu button/false` and passed the next run: the check queried
  `[aria-label="Customization"]` synchronously while a previous check was still
  transitioning surfaces, so it measured the probe's own timing. Fixed in
  `scripts/render-probe.cjs` by waiting for the header with the same 8 s bound the
  hop already uses, and a header that never arrives now reports which `*-view`
  surface was live. The assertion itself is unchanged — a real missing header
  still fails the gate. Two consecutive OK runs after the fix.

## 20d — trade-shaped prose gets the same decision (landed after the probe fix)

`services/trade/tradeShapedProse.ts` extracts a labelled entry/stop/target out of a
Chat row and hands the numbers to `parseTradeProposal` — no second validator, so the
geometry refusal ("a long whose stop sits above its entry") is inherited rather than
re-derived. The chip mints its id through `mintPlanId`, pulled out of
`presentTradeTool` so the prose path and the tool path cannot become two objects to
the `planId` dedupe, and then calls the existing `onLogProposedTrade`, so the gate
stamp and the journal row are the same path as a card. It requires one direction (a
reply hedging "long above X, short below Y" is not one plan) and a coin, and never
shadows a row that already has a proposal. `tests/tradeShapedProse.test.ts` (9, five
of them refusals) caught a real bug in the first pass: prices assembled by string
concatenation matched "entry 90" and silently refused "entry 111,000", so the
patterns are literals now. Gates: tsc clean, 497 files / 4931 tests, lint 818/0,
RENDER PROBE OK.

## 20f — Full analysis is an instruction, and the turn is checked for obeying it

20c deleted the keyword gate, which left the dock's "Full analysis" button with two
possible meanings: a run that is TOLD to look things up, or nothing. It is the first
now. `handleRunAnalysisFromChat` takes `fullAnalysis` as a third argument and only
the dock's binding passes `true` (the Chat surface's ordinary send keeps the plain
wrapper, so an every-turn mandate never shames a definition question). The flag
rides the options bag → `requireTools` on the turn → the seat is told to call the
tape before it states a number, and the settled turn carries
`FULL ANALYSIS, NOTHING LOOKED UP` on the row when no tool line appeared. A stopped
turn is excluded: the trader cut it, the seat did not skip the market.

`tests/fullAnalysisRequiredTools.test.ts` (6) is mostly about the false-positive
direction, plus source contracts on the plumbing — the invariant in
`scrollToMessageWiring.test.ts` (one wrapper, both homes) is kept while its pin now
reads the arrow-function binding, because the wiring gained an argument, not a twin.

## 20r — a schedule gets its own tool turn, its own ration, and its own bad news

Stage 20c made `runEnsembleEnabled` the only guard, so a scheduled run with the
toggle on was still entering the debate. 20r does not delete that dependency in
stage 19 — it gives the schedule a route of its own first, so one config has one
behaviour at every revision. The arm sits in the pipeline at
`useAnalysisPipeline.ts:1288`. The mode fork it used to precede went with stage
19, so the pair's order is no longer a testable property;
`tests/automationRouteCharacterization.test.tsx` pins the route the arm takes.

`services/trade/automationTurn.ts` is the third sink over the same `runToolTurn`.
It reuses `chatSurfaceTurnMessages` and `surfacePromptWith`, so a schedule and the
Chat surface cannot answer the same question with two prompt shapes; the `where`
wording becomes "a schedule running unattended", which is what the seat needs to
know. Two decisions worth naming:

- **Caps are enforced where the plan is minted.** `MAX_PLANS_PER_RUN = 1` in the
  turn and `MAX_PLANS_PER_DAY = 3` in `AutomationService` (a local-day key,
  because a "day" that rolls at 08:00 in UTC+8 is not a day the trader would
  recognise) refuse inside `executePanelTool` and return `ok:false` — the
  executor's existing "a refusal is a failed call" contract, not a silent skip.
  A refusal counts against the ration, so a seat cannot farm retries.
- **Notebook writes are denied outright**
  (`AUTOMATION_UNATTENDED_DENY` — `write_memory_note`, `amend_memory`, `remember`,
  `forget`, the skill/strategy proposers, `forge_tool`). Nobody is watching when a
  schedule edits the trader's memory, so the deny list is DERIVED from
  `CHAT_SURFACE_TOOLS` and a test asserts both directions: every denied name still
  exists in the registry, and the resulting list is not the Chat list. This is a
  feature-shape call I made, not one the manifest made — flagging it.
- **Failure is written down.** `onToolPayload` already carried `ok`, so a failed
  lookup needs no fourth sink event: the turn's `notices` are appended to the
  stored row and `onMessage` downgrades the toast to `toast.warning`. A success
  toast over a failed price read is how an unattended run manufactures confidence.

`MAX_HISTORY_RUNS = 3` now reads only delivered runs; the characterization file
recorded that stub rows were eating half the budget. `AutomationRunCard` renders a
`proposal`-only run (gate receipt line included) instead of calling it "Bot reply".

Tests: `tests/automationToolTurn.test.ts` (15), `tests/automationPlanLedger.test.ts`
(8), `tests/automationRouteCharacterization.test.tsx` rewritten (12). One test was
false-green while I wrote it: it imported `MAX_PLANS_PER_DAY` from
`automationTurn`, which does not re-export it, so the cap compared against
`undefined` and the assertion passed by never binding a number. It now asserts the
constant is a number first.

Gates: tsc clean, 501 files / 4978 tests, lint 818 warnings / 0 errors, RENDER
PROBE OK. The first probe run FAILED three checks (`Ctrl+B puts the conversation
column away` and its two companions) with `md:hidden=null` — null means the
`agents-rail` node was ABSENT, not un-collapsed, i.e. the probe measured the Agents
surface in the ~900 ms after switching to it, before the lazy `AgentsView` chunk
mounted. Re-run alone on an idle machine: all three pass with real values
(`md:hidden=true`, then `240px, md:hidden=false`). So the gate still distinguishes
the two states and the failure was the documented "don't measure while the app is
seconds from filling" hazard, not a regression — but it is a hazard of the same
family as the header-timing bug fixed in the 20s entry, and the durable fix belongs
in 20p, which is the probe-stage for exactly this: wait for the node, don't sleep.

## Stage 19 — measured resume point (2026-10-18, attempted and reverted; tree is green)

I cut the ensemble arm this session, measured the fallout, and **reverted it rather
than leave a red tree**. Nothing of it is in `3d498db`. The facts below are the
point: stage 19 is now a known-size job, not an unknown one.

**The cut itself is mechanically easy.** `hooks/useAnalysisPipeline.ts`: the arm
opens at `:1589` (`if (runEnsembleEnabled) {`), the casual arm's `} else {` is
`:3254`, the wrapper closes at `:3420`. Deleting `1589–3254` + `:3420` and dedenting
the 165 surviving body lines gave **`tsc --noEmit` clean** — because the arm only ever
CONSUMED locals declared above it (`:683` flag, `:1022-1075` placeholder, refs), and
`noUnusedLocals` is off. Dedenting is safe only under a template-literal check: a line
of a multi-line template is TEXT, and shifting its indentation silently rewrites prompt
bytes. The guard used was "no retained line may carry an odd number of unescaped
backticks", and it passed clean, so a plain 4-space dedent was provable here.

**The cleanup is the whole job.** After the cut, this one file reported **124 eslint
problems — 1 error + 123 warnings** (baseline repo-wide is 818 warnings under a 889
cap, so the file alone would have blown the ratchet even ignoring the error):

- The error is the class of bug the cut creates: `stopTokenUsage` at `:665` is
  `let`-declared and only ever assigned INSIDE the deleted arm, so it is provably
  `undefined` forever (`no-unassigned-vars`). The catch block still passes
  `ensemblePlaceholder` to `mapRunFailureMessages` (committed position `:3446`), which
  is the same species and must be unwired from `hooks/analysisPipeline/runOutcome.ts`.
- 70 names were "defined but never used"; they sat inside 35 import statements, which
  the trimmer touched — 26 dropped whole, 9 rewritten to shed one specifier. That pass
  took the file 124 → **57 problems**.
- The remaining 56 are dead LOCALS and the blocks that compute them — the pre-flight
  work the arm consumed: analyst building, lens role assignment and duplicate-seat
  validation, moderator pre-flight, `TEAM_MAX_SEATS`, the Gate Keeper scan, the
  resume-target block. These need judgment, not a script, because an initializer can
  have side effects (`recordPreflightResult`, token-usage subscription, thinking
  records) and some of those effects are what the SURVIVING surfaces read.

**Two tool bugs found, both of the "green means nothing" family.** My import trimmer
first reported `unusedReported: 0` and wrote nothing — it looked like a clean run.
Cause 1: eslint's message text ends with a period (`'X' is defined but never used.`)
and my regex anchored without it. Cause 2: I handed node `/tmp/eslint-19.json`, which
for bash is `AppData\Local\Temp` but for node on Windows is `C:\tmp` — and a stale file
existed there, so it parsed real JSON about a DIFFERENT run. A scanner that reads the
wrong file is indistinguishable from a clean scan unless the script asserts a non-zero
population; it does now (`ABORT: no unused names parsed`).

**Unfinished, in order:** (1) finish this file's dead-local pass and get it back under
the lint cap with 0 errors; (2) delete the now-orphaned engine and its own tests —
`ensembleService` / `ensembleConsensus` / `debateScience` / `debatePods` /
`EnsembleAnalystService` / `AnalystLensService` / `verdictFinalizer` / `autoplayParser`
/ `debateResume` / `streamThrottlers` / `runOutcome` / `utils/debate*` / debate prompts,
plus ~26 ensemble-only test files and FOUR incidental ones that must be edited, not
deleted (`verdictFinalizer.test.ts`, `harnessFeatures.test.ts`,
`automationRouteCharacterization.test.tsx` — its `runEnsembleEnabled` source pins — and
`lensPipelineValidation.test.ts`); (3) the settings surface and the five Preference keys
(`ENSEMBLE_MODEL_SELECTION`, `LAST_MODERATOR_PICK`, `CUSTOM_ENSEMBLE_PROMPT`,
`CUSTOM_LENS_PROMPTS`, `ANALYST_LENS_CONFIG`) and the `isEnsembleEnabled` flag itself,
`scripts/installer-smoke.cjs:289` and the lens chunk in `scripts/render-probe.cjs`; (4) the
debate-only `Message` fields. Item counts in (2) came from a research agent and are
**not yet verified by me line-by-line** — check each before deleting.

**Second attempt, same day — the cut re-applied and gated.** The excision was
replayed from a saved copy and measured again, and the numbers are better than the
first pass suggested:

- **The suite says 3 files / 4 tests fail — not ~86.** `4974 passed` with the branch
  gone, because the ensemble-only suites (`debateFlow`, `ensembleConsensus`,
  `debatePods`, `debateScience`, …) unit-test the ENGINE, which still exists. They
  break when stage 19 deletes the engine files, NOT when the branch goes. The
  agent-supplied inventory that predicted ~86 affected suites conflated those two
  tranches; it is over-broad and was wrong as a plan for this cut.
- The 4 real failures are all source-shape pins of the deleted arm, and each has a
  post-deletion contract to re-anchor to rather than a deletion:
  `tests/analysisPipelineSendIdentity.test.ts` / *keeps the hybrid snapshot OUT of a
  ref* pinned `currentHybridData: hybridAtSend,` — the snapshot's consumer is gone,
  and the seat now fetches the tape inside the turn, so the invariant worth pinning is
  that NO stale pre-captured packet is threaded into a model call, plus that
  `runChatSurfaceTurn({` is the answering path.
  `tests/automationRouteCharacterization.test.tsx` / *the schedule has its OWN arm, and
  it is ordered BEFORE the mode fork* — `indexOf` of the fork is now `-1`, so the
  ordering test must become "the arm exists AND there is no mode fork". Same file's
  *the ensemble branch is still the mode's, and the keywords stay dead* — the positive
  half inverts to "the branch is gone"; the keyword bans stay exactly as they are.
  `tests/verdictFinalizer.test.ts` / *selects the automation-private messages at the
  hook call site* pinned `const verdictMessages = isAutomationRun ? …` — re-anchor to
  `runAutomationTurn({ … history: currentMessages, …})` plus the single
  `updateRequestMessages(prev => [...prev, aiMessage])` write.
- **The dead-local pass must be hand-edited, not scripted.** A range-exciser driven by
  eslint's 46 flagged names removed 41 statements / 132 lines and `tsc` then reported
  syntax errors at six sites (`:8`, `:403`, `:418`, `:1277`, `:1286`, `:1294`) — the
  extent finder ended a statement at a brace inside a nested arrow or template. It also
  reported `statementsRemoved: 41` happily while doing it, which is the lesson: a bulk
  edit's own count is not evidence. The surviving check is `tsc` after EVERY group of
  deletions, in chunks small enough to read. The flagged sites, by committed position:
  `:56 SEAT_LAUNCH_STAGGER_MS`, `:237 seatTemperature`, `:341 runAnalyzeTradingView`,
  `:394/395/399/400/407/408` the six debate refs, `:470-474` four throttlers,
  `:577 persistThinkingRecords`, `:639 stopTokenUsage` (the run's only lint ERROR),
  `:640 tokenByProvider`, `:738/744/748 teamSeatFor/seatToolsFor/seatMandates`,
  `:906 runStartedAt`, `:909 liveBtResult`, `:955 imageFiles`,
  `:1044 updateEnsembleProgress`, `:1113 promptLane = beginPromptLane()` (deleting the
  assignment must delete the CALL — a begun lane that never ends is a leak),
  `:1117 currentThreadSummary`, `:1120 memoryToInject`, `:1131 instructionsToUse`,
  `:1188 bayesianConfidenceCap`, `:1258/1264/1265/1268` four learning-context members,
  `:1319 moderatorContextBundle`, `:1327 effectiveTradingStyle`,
  `:1360 enhancedFinalTradeSummary`, `:1405 moderatorLearningContext`,
  `:1422 capturedGateResult`. Five more are single specifiers inside a LIVE destructure
  and must be shed without touching the call: `:7` two type names, `:283/284/285` four
  App setters, `:713 resolvedAssignments` (the same destructure yields
  `enabledProviders`, which the surviving casual arm still reads).
- Arithmetic for the ratchet: this file carried 23 warnings at HEAD and 57 after the
  cut (56 + the 1 error), so the repo total would sit near 851 under the 889 cap. The
  error is what blocks CI, not the warnings — but leaving 41 dead prompt-assembly
  statements in the send path is the half-finished state this stage refuses.

## Stage 19 — third attempt got it to tsc-clean; still reverted, and why

Restricting the dead-statement pass to **single bracket-balanced lines that end in
`;`** worked: 20 statements gone, file at 1,944 lines (from 3,657 — both `wc -l` measured,
not arithmetic), and
**`tsc --noEmit` reported 0 errors**. Every multi-line extent was refused and listed
(`470-474` throttler import members, `577 persistThinkingRecords`, `738/744/748`,
`1044`, `1117`, `1131`, `1258/1264/1265/1268`, `1405`, `341 runAnalyzeTradingView`,
`713 resolvedAssignments`). Four facts the next session must not re-derive:

1. **Two lint ERRORS appeared, both `prefer-const`, both created by my own deletes**:
   `let promptLane` (`:1082`) and `let capturedGateResult` (`:1396`) lost their only
   reassignment. They are dead declarations — delete the lines, don't convert them to
   `const`. One `no-useless-assignment` disable comment sits above `promptLane` and
   goes with it. Repo-wide the pass measured **847 problems (2 errors, 845 warnings)**
   against a 818/0 baseline: warnings ROSE because deleting suppressed code turns the
   `eslint-disable` directives above it into "Unused eslint-disable directive"
   warnings. Expect that signature; it is not a regression in code quality.
2. **The Gate Keeper scan is still live and still costs a network call per send.**
   `if (finalSymbol && runEnsembleEnabled) { … }` (`:1397`) writes
   `gateInjection`/`capturedGateResult`, and the cut made `capturedGateResult`
   unread. Deleting that block is the single highest-value remaining removal — it is
   latency and quota spent on a verdict nobody receives.
3. **`beginPromptLane` now has zero callers** (`PromptOverrideService.ts:24`), while
   the `finally` still calls `endPromptLane()` (`:1805`), which only resets a module
   flag to `false`. The prompt A/B / pinned-lane feature is therefore **starved, not
   deleted** — the exact defect class the peer review's #1 flagged for `postMortem`.
   This is an owner decision, not a mechanical one: either begin the lane in the
   surviving tool-turn path (so the pin/AB still steers prompts) or delete the
   override lane deliberately. Do not let a revert silently keep it broken.
4. Reverted again for the same reason as attempt two: **the remaining budget could not
   finish the pins + the multi-line pass + the full gate chain**, and a half-deleted
   send path is worse than a green tree with a written plan. Resume from
   `%TEMP%\pipe-19d-singledrop.ts` (excision + import trim + single-line dead pass
   applied) rather than re-running the scripts.

## Stage 19 tranche 1 — LANDED (`ab28158`), and tranche 2's blockers measured

The branch is out of the send path: 3,657 → 1,789 lines, gates read from their own
markers — tsc 0 errors, lint **0 errors** / 826 warnings (cap 889), `501 files /
4978 tests`, **`RENDER PROBE OK`** (104 checks, zero pageerrors). The Gate Keeper
block went with it, so a send no longer pays for a network call whose result
nothing reads. Four pins were re-anchored rather than deleted; the hybrid-snapshot
one inverted (a pre-captured packet reaching a model is now the thing that must
stay false).

**My earlier tranche-2 list is unsafe as written — verified with `grep`, not
inherited.** Deletion order matters because two of those modules are NOT dead:

- Zero app importers now: `hooks/analysisPipeline/verdictFinalizer.ts`,
  `hooks/analysisPipeline/autoplayParser.ts`, and (reachable only through each
  other or through `verdictFinalizer`) `services/providers/ensembleService.ts`,
  `ensembleConsensus.ts`, `debatePods.ts`.
- **`debateScience.ts` is NOT dead** — `services/learning/monthlyReport.ts` imports
  it. Relocate what the monthly report uses (`computeEnsembleLine`) or keep the
  file; deleting it breaks a live surface.
- **`EnsembleAnalystService.ts` is NOT dead** — `hooks/analysisPipeline/runOutcome.ts`
  imports it and the pipeline still imports `runOutcome` (for
  `mapRunFailureMessages` in the `catch`, which still receives the now-always-null
  `ensemblePlaceholder`). Unwire that argument FIRST, then the analyst service,
  then `streamThrottlers`' four throttlers.
- **`AnalystLensService` and `DebateMailbox` stay** — 11 live importers and the
  surviving desk-tool/chat-turn surface respectively. The research agent's "~86
  suites" and "delete DebateMailbox" were both wrong; the real count of suites
  touching the engine cluster is **14**, and three of them
  (`harnessFeatures`, `lensPipelineValidation`, `ensembleAnalysts`) also test live
  code, so they must be edited, not deleted.
- `tests/verdictFinalizer.test.ts` dies with the module, but the automation-private
  message pin I just re-anchored lives in that file — **move it into
  `tests/automationRouteCharacterization.test.tsx` before deleting the file**, or
  the deletion silently drops coverage 20r was written to hold.

Two residues left in the open, both deliberate: the hybrid pull still runs for a
toggle-on human send and feeds no model, and `beginPromptLane` has zero callers
while the `finally` still calls `endPromptLane()` — the prompt A/B lane is starved,
not deleted, and re-wiring it onto the tool turn versus removing it is an owner
call, not a mechanical one.

**Correction to the section above, measured by attempting it.** `verdictFinalizer.ts`
and `autoplayParser.ts` have zero IMPORTERS, and I deleted both plus
`tests/verdictFinalizer.test.ts`. `tsc` stayed clean — and two suites failed, for a
reason neither the import graph nor this document predicted:

- `tests/featuresAreWired.test.ts` → **`withDetectedTradeType` loses its consumer**.
  `verdictFinalizer.ts:425` is
  `withDetectedTradeType(processNewAnalysis(finalAnalysis))` — the file applies the
  journal's scalp/swing label, so it is a live capability carrier, not dead code.
  `hooks/analysisPipeline/autoplayParser.ts` likewise went quietly.
- `tests/liveMarketTrendlines.test.tsx` failed on the same removal.

So a zero-importer count is NOT proof a module is dead: it can be the only place a
capability is APPLIED, and the wiring gate counts application, not importation. This
is the same starved-vs-deleted distinction defect #1 of the peer review turned on
its head — here the gate caught me before I shipped it. The deletion was reverted;
the tree is exactly `HEAD`.

Tranche 2 therefore starts with a re-homing decision, not a deletion: where do
`withDetectedTradeType` and whatever `liveMarketTrendlines` asserts get applied once
the finalizer goes — `present_trade`/`runPresentTrade` (where plans are minted, like
the gate stamp in 20a2) or `logTradeWithFeedback` (where the journal row is
written)? Re-home first, then delete, then let both gates fall out naturally. Do not
edit those two suites to pass the deletion; that would be loosening the gate to make
it agree with me.

## #33 — the confidence WORD now follows the number

`downgradeConfidenceForProbability` walked ONE step, so a verdict whose
probability the gate clamped from 88 to 34 still read "Medium": the number and
the word disagreed inside the same object and the trader acted on the word. It is
now a band of the final probability (<55 Low, <70 Medium, else High), applied at
every clamp site, and it still never upgrades — a seat that said Low keeps Low.
'Avoid' is a veto, not a rung, and is returned untouched.

Two existing tests pinned the old walk, and both were rewritten rather than
deleted, per the rule that a green check can encode the bug:
`proposalGate.test.ts` was titled "…re-tiers it one step" (the name itself said
"one step", with a comment deferring to this task) and
`proposalCard.test.tsx` asserted the card showed "Medium" over 50%. Both now
assert the band, in the same tests that already proved the probability and the
warning line. Stored analyses are not re-derived: only a freshly stamped verdict
changes label. New: `tests/confidenceBand.test.ts` (16, incl. a monotonicity
sweep and a never-touch-a-veto case).

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

## Stage 19 tranche 2 — re-measured, and the blocker is bigger than one label

`verdictFinalizer.ts` (709 lines) has **no production importer**: the only file
that imports `finalizeVerdict` is `tests/verdictFinalizer.test.ts`. `autoplayParser.ts`
(174 lines) has zero references anywhere, including its own test.

It is still not deletable yet, and the reason generalises past the scalp label. The
finalizer is the **only application site** for roughly fifteen behaviours it imports —
`withDetectedTradeType`, `clampProbabilityToGate`, `downgradeConfidenceForProbability`,
`flagBannedVocabulary`, `buildRecommendationContract`, `buildRunContractStages`,
`buildVerdictEvidencePack`, `annotateVerdictCitations`, `maybeQueueVerdictSkillDraft`,
`appendSessionUsage`, `notifyAnalysisComplete`, `VetoLedgerService`, `shouldSkillHoldout`,
`estimateCostUsd`, `peekTruncations`. A zero-importer file can therefore still be the
place a capability is applied — exactly the prompt-lane trap, one level up. Tranche 2
must decide, per behaviour: re-home it into the tool path (`runPresentTrade` already
hosts the gate stamp since 20a2, `logTradeWithFeedback` hosts the row), or prove the
tool path applies it already. Only then does the `rm` become honest.

## Docs (this pass, mechanical)

Both flow docs re-audited against the post-19 tree: **167/167 anchors land**, and all
six peer-review defects verified fixed by grep (no dangling hashes, `plans/` cross-link,
`services/infrastructure/messageImageStore.ts`, `ChatComposer.tsx:146`, Section D says
starved-not-deleted). Two defects my own scanner found that the reviewer's did not: a
stale `streamQuickResponse :3315` (the debate arm's copy — it is `:1449` now) and a
**fabricated citation**, `rationale` at lines 617-622, in three places — the word `rationale`
does not appear in `automationTurn.ts`, `useAnalysisPipeline.ts` or `useAutomations.ts`
at all. It described the notices that 20r assembles, so it now names `notices`.

Blind spot worth keeping: an anchor written as a bare `:NNNN` inherits its filename
from a *different table cell*, so a scanner that only matches `file.ts:NNNN` reports a
clean doc while every bare ref goes unchecked. Name the file in every anchor.

## Tranche 2, first slice landed

`hooks/analysisPipeline/autoplayParser.ts` (174 lines) is deleted: zero references
anywhere — no importer of the module, no caller of `parseAutoplayTranscriptChunk`,
no test. Nothing to re-home, so it went ahead of the decision. `tsc --noEmit` clean
and `featuresAreWired`, `harnessFeatures`, `scalpDetection`,
`automationRouteCharacterization`, `analysisPipelineSendIdentity` green.

Still blocked: `verdictFinalizer.ts` (the ~15 application sites above), and the engine
cluster it feeds. Also two comments now make a false claim — `components/agents/AgentsView.tsx:245`
and the second comment, `components/shared/ChatTranscriptRow.tsx:18`, cite `verdictFinalizer.ts` as where a
verdict payload is written, and it has no production caller. Not edited this pass (no turn to
verify the sentence around them); fix with the re-home.

## The consequence, stated plainly (measured 2026-10-18)

`withDetectedTradeType(` is called in exactly one file, and that file has no production
importer. So **today the journal's scalp/swing filter has no live producer** — every new row
reaches it unlabelled, and the one exception is history written before stage 19. Two things
follow:

1. `tests/featuresAreWired.test.ts:84` is satisfied by an application site inside an
   unreachable file. The gate exists to catch a capability that stopped being applied, and a
   dead module's call body passes it. That is the vacuous-measurement shape again: the check
   passes for a reason unrelated to what it claims.
2. Tranche 2's first edit is therefore not the finalizer's removal — it is a call in a live
   path. Until that lands, the filter is broken by data, not by a bug, and `useTradeJournalActions`'s
   comment ("the classifier labels every verdict on finalization") describes a path that no
   longer runs. Both need fixing in the re-home, not before it.

## Tranche 2, second slice — the label has a live producer again, and the gate now means it

Measured this pass with a reachability walk over the import graph (App.tsx + index.tsx
as roots, static AND `React.lazy(() => import())` edges): 494 of 545 source files are
reachable, and `verdictFinalizer.ts` / `ensembleService.ts` are **not** among them. Of
the finalizer's 26 imported behaviours, only 3 are applied by a reachable module outside
their own definition file (`clampProbabilityToGate` and
`downgradeConfidenceForProbability` via `services/trade/proposedTrade.ts` — that is 20a2
— and `buildRunContractStages` via the pipeline). 17 are applied nowhere live.

One of those 17 is in `featuresAreWired`'s declared contract, so it is a defect rather
than a stage-19 deletion: **the journal's scalp/swing filter had no producer**. Fixed by
calling `withDetectedTradeType` at the two row-minting sites in `logTradeWithFeedback`
and `logEntryNotHitTrade` — the label-only variant, so `validityDurationMinutes` stays
untouched and OutcomeAutopilot's expiry window does not silently widen. The reader is
`components/journal/TradeLog.tsx:535` (`trade.tradeType || trade.analysis?.tradeType`),
which is why the row is the right host: every journal path lands there, a presented plan,
a prose chip or a manual log alike.

**And the gate itself was the bug.** Two holes, both found by reverting my own edit and
watching the suite stay green:

1. A mention in *any* production file discharged a duty, so a dead module counted as a
   consumer. Now the consumer must be inside the entry-point import closure.
2. After fixing (1), reverting the call sites STILL stayed green: an
   `import { withDetectedTradeType }` line alone matched the name. Import statements are
   now stripped before matching, so a consumer must use the name in its body. That second
   hole briefly accused `harnessNoteLegend` of being orphaned — a false red from my own
   stripper closing an import run on a line ending in a backtick; the real call is
   `DeskToolsService.ts:3222`. The control that caught it is the new
   `the reachability walk separates live from dead` test.

Proof of load-bearing: producer reverted → `withDetectedTradeType` FAILS; restored →
24/24 green. `tsc --noEmit` clean.

Still unre-homed (16 of the 17) — none is in `featuresAreWired`'s list, so each is a
product decision, not a contract violation: `appendSessionUsage`, `estimateCostUsd`
(per-session token + cost accounting), `peekTruncations` (the truncation ceiling),
`notifyAnalysisComplete` (the whole `CompletionNotifications` module is unreachable),
`maybeQueueVerdictSkillDraft`, `annotateVerdictCitations`, `flagBannedVocabulary`,
`parseKeptAnalyst`, `buildRecommendationContract`, `buildVerdictEvidencePack`,
`deriveSetupQueryFromPrompt`, `isBindingMarkdownPlan`, `stripPlanTags`,
`parseProseTradePlan`, `ANALYST_ROLE_DEFINITIONS`, `GENERAL_DIMENSION_TAGS`.
The plan-parsing four are already replaced by the tool path (`present_trade` payload) and
20d's `parseTradeProposal`, so those die with stage 19. The usage/cost/notification four
look like capabilities the trader still expects to see, and need an owner call before the
finalizer is deleted.

Lint note, not mine: `npm run lint` is red with 95 `no-require-imports` errors coming
entirely from untracked scratch under `docs/analysis/data/*.cjs`, which eslint's scope
picks up. My four changed files report 0 errors / 12 warnings.

## Two more dark surfaces, same class as the label (measured, NOT yet fixed)

The reachability walk found the label was not the only orphaned write:

1. **Knowledge → Session Usage panel reads a store nothing writes.**
   `components/settings/SessionUsagePanel.tsx:32` calls `loadSessionUsage()` and
   `LearnView.tsx:314` mounts it, but `appendSessionUsage` is called only at
   `verdictFinalizer.ts:645`. So the panel has shown nothing new since tranche 1, and
   `ExportService` still lists `session_usage_v1` as a backed-up store. Re-homing it is
   NOT a one-liner: the finalizer's entry is built from debate-shaped `runStats`
   (per-analyst tokens, `analystCount`, `costUsd`), and the tool path never surfaces
   provider token usage at all — `services/trade/toolTurn.ts` has no usage field. The
   honest fix is to thread real usage out of `GenericProviderService` →
   `streamChatWithDeskTools` → `runToolTurn`; writing a chars/4 estimate into a panel
   that presents its numbers as usage would manufacture confidence, the same failure
   20r removed for scheduled runs.
2. **Completion notification for an analysis run is gone.** Its only caller is the
   finalizer. `services/infrastructure/notify.ts` is live (price alerts,
   `TradeView.tsx:716`), and its own header calls the completion-notifier component (named in a comment in `services/infrastructure/notify.ts`, no component of that name remains) a
   "native-only copy" — so the fix is one `notify()` call on the settled Full-analysis
   path, and `CompletionNotifications` then dies with stage 19.

`utils/messageDisplayText.ts` also has zero references anywhere. Its header claims the
two chat row components share its strip chain; they do not import it, and the strips
live in `utils/thinkingSplit.ts` + `sanitizeAIResponse`. Left in place: before deleting
an anti-drift aggregation, both row components must be read to confirm neither leaks
`<think>` or `<JSON_PLAN>` on its own. `useConversationLeverage` (superseded — App.tsx's
only mention is a comment saying the handlers "used to" come from it) and
`useTypingEffect` are deleted: zero importers in production or tests,
501 files / 4981 tests green.

## Task #36 closed — both dark writes are live again

`recordToolTurnUsage` (20p-adjacent fix, `utils/sessionUsage.ts`) is now called by all
three turn owners, fed by `usage`/`usageCalls` that `runToolTurn` folds out of the wire's
per-request `onUsage`. Pinned in `tests/toolTurn.test.ts` ("the measured usage fold") and
guarded by a new `featuresAreWired` row; stubbing the fold turns those pins red.

`notify()` now fires on the settled Full-analysis path (`useAnalysisPipeline.ts:1274`),
scoped to `options?.fullAnalysis === true` and excluded on a stopped turn, so an ordinary
chat line stays quiet and a schedule (which already reports in its own row) is not doubled.
`CompletionNotifications` therefore has no caller left and dies with the engine.
Pinned in `tests/analysisPipelineSendIdentity.test.ts`, including the negative
(`not.toMatch(/notifyAnalysisComplete/)`) so the duplicate cannot creep back.

Gates: `tsc --noEmit` clean, 501 files / 4988 tests green, docs 171/171 anchors land.

## The finalizer is gone; the engine island has THREE live→dead edges left

Deleted `hooks/analysisPipeline/verdictFinalizer.ts` (709 lines) with its suite: `tsc`
clean, 500 files / 4969 tests green. It became safe as soon as the two live writes were
re-homed — the label and the ledger — plus the completion notice.

The remaining debate cluster cannot be swept yet, and not because of its own tests. Three
REACHABLE modules still import dead helpers, and each one is a feature question, not a
mechanical cut:

| live importer | imports | the question it forces |
|---|---|---|
| `hooks/analysisPipeline/streamThrottlers.ts:30` | `lastCompletedRound`, `laneDraftsFromTurns` from `utils/debateResume` | the live writer's lane-draft display was built around rounds a single-seat turn does not have |
| `hooks/useWatchAndAutopilot.ts` | `reconstructOpenings` from `utils/debateResume` — WRITTEN BEFORE THIS WAS DELETED: as of 2026-10-19 neither name occurs anywhere in the tree, so there is no line to cite | what a watch arms an opening FROM, now that no debate produces one |
| `services/learning/monthlyReport.ts:24` | `computeEnsembleLine`, `SeatConviction` from `services/providers/debateScience` | what the monthly report's ensemble line says when there is no ensemble — a gap, or the single analyst's own conviction |

Answer those three (or say "delete the display half") and the island goes in one commit:
`ensembleService`, `ensembleConsensus`, `debateScience`, `debateResume`, `debateLevels`,
`debateDiff`, `debateEpisodes`, `debatePreStep`, `debateReplyTo`, `debateTranscript`,
`provisionalVerdict`, `keptAnalyst`, `recommendationContract`, `verdictSkillDraft`,
`analysisResultProcessor`, `CompletionNotifications`, `archetypePrompts`,
`analysisReport`, `analysisTrace`, `runGantt`, `hybridChartDrift`, `levelEvidence`,
`ungroundedGate`, `levelKeywords`, `services/learning/preflight`, `lensMemoryRecord`, plus
their ~27 test files.

Method note, so this does not happen again: the first candidate sweep was wrong because it
added each candidate's *production importers* to the delete list — which silently included
three live files. A bulk delete must intersect the reachability walk and refuse any file
reachable from `App.tsx`.

## Stage 19 tranche 2 — the engine island is GONE (this commit)

The three "feature questions" in the previous section all turned out to be
mechanical, and the proof is that no user-visible output changed:

- `streamThrottlers`: `useAnalysisPipeline.ts:34` destructures **only**
  `throttledCasualStream`. The debate-round, provisional-verdict,
  ensemble-progress and opening-thinking writers had no consumer left, so the
  file is now one updater + one dep, and the `debateResume` edge went with them.
- `useWatchAndAutopilot`: the caller used `reconstructOpenings` for
  `name` + `opening` only. Inlined as a round-1 group-by-speaker over
  `msg.debateTurns` — identical output, and the transcript it reads only ever
  exists on rows written before the debate was deleted.
- `monthlyReport`: `ensembleLineFromTranscript` needed the weighted log-odds
  mean, which is `computeEnsembleLine` at alpha=1 and weight=1. Inlined. The
  card's ensemble cell still renders for historical rows; for new rows it was
  already absent, because nothing writes a transcript any more.

Deleted 26 production files and 24 suites (`ensembleService`,
`ensembleConsensus`, `debateScience`, `debateResume`, `debateLevels`,
`debateDiff`, `debateEpisodes`, `debatePreStep`, `debateReplyTo`,
`debateTranscript`, `provisionalVerdict`, `keptAnalyst`,
`recommendationContract`, `verdictSkillDraft`, `analysisResultProcessor`,
`CompletionNotifications`, `archetypePrompts`, `analysisReport`,
`analysisTrace`, `runGantt`, `hybridChartDrift`, `levelEvidence`,
`ungroundedGate`, `levelKeywords`, `services/learning/preflight`,
`lensMemoryRecord`), plus their tests.

Two of those suites were NOT engine tests and were restored, then trimmed to
their live halves: `tests/trustSurface.test.ts` (funding carry, claim sweep,
calibration ledger, plan-amendment diff) and
`tests/protocolAndInlineApprovals.test.ts` (inline approval cards). Matched by
IMPORT, a suite is an engine suite; two of them only reached through one.

Gate lesson, second occurrence: `tests/featuresAreWired.test.ts` named two dead
files as its reachability controls, and stage 19 deleted them — the control
rotted the moment it was useful. It now computes the unreachable set from the
walk instead of naming files. `tests/harnessMarks.test.ts` likewise read
`ensembleService.ts` to prove the harness never says `**USER STEERING`; the
label lives in `constants/prompts/debatePrompts.ts` and the read now points
there.

Measured after the cut: `tsc --noEmit` clean; vitest 477 files / 4702 tests
green (11 skipped); anchors in both flow docs re-measured. NOT run for this
commit: render-probe, eslint, boot-probe (the 20p phase is parked in
`.probe-artifacts/20p-probe-work-in-progress.patch` — its preamble waited for
`[data-testid="trade-view"]`, which is the TRADE surface, while the probe's
reload restores the Agents surface).

## What stage 19 did NOT delete — measured after the island went

The engine is gone, the pipeline's ensemble BRANCH is not. Read from the tree,
not from the plan:

- The hook used to set `runEnsembleEnabled`, and three
  debate-only refusals still run on it: no-moderator (`:730`), incomplete lens
  roles / two seats sharing a model (`:754-785`), and the seat ceiling
  `TEAM_MAX_SEATS` (`:793`, "Too many providers for a Standard-mode debate").
  Nothing on that path can convene a debate any more — `conductDebate` and
  `ensembleService` are deleted — so a send with the ensemble toggle ON can still
  be REFUSED for a debate that cannot happen.
- `isStagedEnsemble` (`:655`) still mints `ensembleProgress` (`:888`, written on
  the placeholder at `:912`) with every seat at `status: 'waiting'`. Nothing ever
  moves it, because the only writers were the debate throttler (deleted) and
  `runOutcome`'s catch path, which only marks it failed, and the App read that surfaces it.
- `isDebating: true` is now written in exactly ONE place: the resume path
  (`:924`). Everything that once set it lived in the debate loop.

**The live consequence, and it is the next job:** `App.tsx:1193` picks
`verdictMessage` out of the debate shapes — `ensembleProgress`, >1 `modelsUsed`,
`debateTurns` — and hands it to the chart as `verdict={verdictMessage?.analysis}`
(`App.tsx`, and there is no line to give it: as of 2026-10-19 nothing passes an analysis prop there at all). After this tranche nothing sets `Message.analysis` for a new
run: the writer was `verdictFinalizer` (deleted), and a tool turn answers with a
`TradeProposal` carried in the tool payload (`services/trade/presentTradeTool.ts`,
`proposedTrade.ts`, `tradeShapedProse.ts`). So the chart's verdict prop has a
reader and no writer — the third instance of the class this stage already fixed
twice (session usage, the completion notice). NOT fixed here, because re-sourcing
it means deciding whether the chart reads the settled `TradeProposal` or a
re-minted `TradeAnalysis`, and that needs `npm run render-probe` (or the app open)
to prove the line actually draws again. Do not "fix" it by widening the selector:
the selector is not the defect, the missing producer is.

## The chart verdict producer — LANDED

Re-sourced from the settled proposal: `latestChartVerdict(messages)` in `services/trade/chartData.ts`, wired into App (the old `verdictMessage` memo and the dead `isDebating` branch are gone). RED PROOF ran the old predicate against a proposal-only row: it returned null, so `verdict` was undefined for every new run. `tests/chartVerdictSource.test.ts` pins the proposal path, the `analysis` fallback for history, the preference when a row carries both, the symbol match through `verdictLevels`, and the App wiring by source grep. tsc clean; that suite + `chartData` + `streamThrottlers` green (15 tests). Gate state: render-probe PASSED on 2026-10-18 after these commits (zero pageerrors); it asserts no canvas overlay levels, so the drawn verdict line is still un-asserted, and lint / boot-probe / e2e remain unrun.


## 20p, second attempt: the navigation is fixed, the tool turn does not settle

Run 4 and run 5 of the probe isolate two different faults, and only the first
one was mine:

- Run 4 failed with "the composer never became sendable" because a reload
  restores the surface the sweep last visited (Settings — no composer). Fixed by
  clicking: the phase now calls the probe's own `navTo('Trade')` and waits for
  `[data-testid="trade-view"]`. Run 5 printed
  `ok   the dock surface is reachable again after a reload (clicked)`, and the
  send landed its user row. That half is proven.
- Run 5 then failed at the next step: "user row rendered, no settled reply"
  (30s). `wire: no failing request on the mock port`, and the transcript dump
  shows the earlier dock turns settled normally. So the marked turn
  (`PROBE_TOOL_ROUND`, which switches the mock's tool scenario on by content)
  starts and never finishes, with no transport error.

That is the behaviour 20p was written to catch, and it is a candidate real
defect: a tool call the desk cannot honour may leave the row streaming instead
of settling with a visible failure. Unproven — nothing else was measured,
because the phase ends there. Kept as the next experiment: send the marked turn
and read whether Stop is offered, whether a tool line appears before the hang,
and whether the mock ever received the follow-up request after the tool frame.

The phase is parked again at `.probe-artifacts/20p-probe-work-in-progress.patch`
(both files `node --check` clean after revert, so the gate is runnable for
everyone else in the meantime).

Gate closure 2026-10-18: after the four stage-19 / chart-verdict commits, `tsc --noEmit` clean, vitest 477 files / 4713 tests green (VITEST_EXIT=0), and `npm run render-probe` OK with zero pageerrors. Gate state: render-probe PASSED on 2026-10-18 after these commits (zero pageerrors); it asserts no canvas overlay levels, so the drawn verdict line is still un-asserted, and lint / boot-probe / e2e remain unrun.
 Still un-asserted by any gate: the chart actually drawing the verdict levels — the probe never looks at overlay levels, so that claim stops at the pure-function test.

## Resume here (turn budget paused 2026-10-18 ~09:32Z)

Tree state: everything I built this session is committed on main, 7 commits
(48c3ee8, c4dd059, abe838e, 1bd501e, 22364c9, 8b1f25e, ead0230). Nothing pushed.
The only dirty paths are the owner's (package-lock.json, docs/analysis/,
docs/improvements/, the harness-accuracy plan). Gate state at this commit: tsc
clean, vitest 477 files / 4713 tests green, render-probe OK. Unrun: lint,
boot-probe, e2e.

Order to resume in, cheapest risk first:
1. Stage 17 pre-cuts (relocate ConfidenceLevel + detectTradingSession out of
   calibrationStore, inline brierQuality into monthlyReport) — mechanical, same
   technique as stage 19 tranche 2, unblocks the whole accuracy-mode deletion.
2. The three ensemble refusals + the never-moving ensembleProgress in
   useAnalysisPipeline (read :900-1470 before cutting; run render-probe after).
3. Task #32's three observations on the non-settling tool turn.
4. Stage 21 field census, then AGENTS.md counts.

## Resumed 2026-10-18: stage 17's scope was wrong, and `ensembleProgress` is not dead code

Two measurements that change what the next cut should be. Do these reads before
deleting anything in either area.

**1. Accuracy mode is fully wired, and the calibration store is infrastructure, not part of the stage.**
`AccuracyModeModal` looked orphaned to a `from '…'` grep — it was imported through
`React.lazy` at `App.tsx:67` and mounted in the App body. The Accuracy Mode
toggle and its modal were deleted after this measurement; the import line is
kept as dated history, and the open-items register records the removal.
`accuracySubMode` / `isAccuracyModeEnabled` flags reach App, GeneralTab,
useAppSettings, useLensAndEnsembleConfig, useProfilePersistence, useAnalysisPipeline,
GenericAnalysisService, HybridIntelligenceService, TradeLog and 4 types files. And
`services/validation/calibrationStore.ts` is imported by `useTradeLogging`,
`HybridIntelligenceService`, `GlobalLearningService`, `SelfLearningService`,
`AlgorithmicSummaryService`, `TradeValidationGate`, `VersionHistoryDashboard` plus
5 suites — so relocating `ConfidenceLevel` / `detectTradingSession` unblocks nothing;
the store stays. `CalibrationLedgerService` (117 lines) feeds TWO live surfaces:
`WinRateDashboard` (`buildCalibrationLedger`, `ledgerFramingLine`, `brierQuality`) and
`monthlyReport`'s panel grades. Deleting the ledger is therefore a feature decision,
not a mechanical one — it removes reporting the trader can currently open.

**2. `ensembleProgress` has no rendering reader but IS load-bearing on the failure path.**
Census over all `.ts`/`.tsx`: minted at the block now at `useAnalysisPipeline.ts:1070` (the placeholder row itself was deleted with the engine), patched at
`runOutcome.ts`'s debating branch, stripped at the SQLite boundary, and
after `1bd501e` no component reads it (`App.tsx:1211` was the last, and that memo is
gone). But the `runOutcome` branch keyed on it writes the row's TEXT —
"The analysis was cancelled." / "The ensemble could not continue before the debate
started." — so deleting the mint without re-keying that guard strands an empty row on
every cancelled staged send. It is an identity check wearing a data field's clothes.

**Open question worth measuring before any of this is "fixed":** the staged placeholder
is created with `text: ''` and `isDebating: false`, and nothing renders
`ensembleProgress`. What does the trader see on a staged (`runEnsembleEnabled` + >1
provider) send between the send and the settle — a live row, an empty row, or nothing?
That decides whether the ensemble-branch removal is one change or two, and it is only
answerable in the browser: `npm run render-probe` does not assert it today.

## Staged placeholder removed — the ensemble branch is now partly gone (this commit)

Measured first, because the obvious cut was wrong: `ensembleProgress` had no
rendering reader after `1bd501e`, but `runOutcome.ts` keyed its cancel/error TEXT on
it — deleting the mint alone would have stranded an empty row on every cancelled
staged send. So the field, the row it belonged to, and that guard go together.

What the row actually was: `isStagedEnsemble` (ensemble flag + >1 enabled
provider) appended a second AI message with `text: ''` beside the row the tool
turn writes (`streamingMessageId`, now :1406/:1432), and nothing had a settle path
for it since the debate engine was deleted. A staged send therefore left an empty
bubble in the transcript. That is the fourth user-visible consequence of this
stage; the other three (journal label, usage ledger, chart verdict) are earlier in
this file.

Also measured: the resume branch was the ONLY writer of `isDebating: true`, and
`options.resumeMessageId` has no caller anywhere in the tree — so it went with the
placeholder, and nothing in the app can now mark a row as debating. The three refusals (:731, :761, :794) still stand and
are the next cut.

Gates: tsc clean; full vitest green; render-probe OK (PROBE_EXIT=0, zero
pageerrors) — the probe counts rendered rows per conversation, which is what this
change alters, so the removal is browser-verified.

Gate re-run after 336c887 (the placeholder removal): render-probe OK, PROBE_EXIT=0, zero pageerrors — the probe counts rendered rows per conversation, which is exactly what this change alters, so the removal is browser-verified, not just suite-verified. tsc and the full suite were green before it (477 files / 4713 tests).

## The ensemble refusals are gone (this commit)

Measured before cutting: exactly ONE model answers a send (`provider`, resolved from
the composer selection and falling back to `enabledProviders[0]`), so the
lens-role completeness check, the "two seats share a model" check and the
`TEAM_MAX_SEATS` ceiling all refused runs over seats the run never used. The
moderator readiness check was NOT deleted — a scheduled run really does take its
seat from that config — it was scoped to `isAutomationRun` and reworded away from
"The debate cannot start", which described a debate that cannot exist.

Side effects, all verified: `missingAnalystRoles` / `hasCompleteAnalystAssignments`
had no other consumer, so the destructure narrowed; `ANALYST_ROLE_DEFINITIONS` and
`TEAM_MAX_SEATS` imports went; `buildModelsUsedRecord` (one record per SEAT) lost its
last production caller, so the module and its two unit tests were deleted — no
test asserted any of the removed refusals, which is worth noting: three
user-visible blocks shipped with no pin on them.

No suite pinned the removed blocks; tsc clean, full vitest 477 files / 4711 tests
green (the 2 fewer are the deleted buildModelsUsedRecord units), and render-probe
OK with zero pageerrors after the cut.

## Stage 21, first pass: the dead debate-era message fields are gone

Censused across EVERY production directory before touching anything — the first
census (hooks/services/components/App only) wrongly reported the replacement-offer
field as unread, and the reader in `utils/approvalInbox.ts` proved it wrong. That
near-miss is why the field set below was re-measured, not assumed. This row names
the file, not a line number: the field was deleted in the pass this ledger records,
so a line here would be a live claim the tree no longer supports, and the anchor
gate would rightly refuse it.

Deleted from `types/message.ts`: `ensembleProgress`, `debateRunLog`,
`debateCheckpoint`, `provisionalAnalysis`, `provisionalPlanFields`, plus the
`EnsembleProgress` / `EnsembleAnalystProgress` / `EnsembleAnalystProgressStatus` /
`DebateCheckpoint` types, the two provisional clears in `runOutcome`, the now
nonexistent key in `SqliteService`'s persist strip, and
`tests/ensembleProgress.test.ts` (its three units exercised a local helper over a
type that no longer exists).

KEPT, because a reader survives: `debateTurns` (journal carry + watchList + the
monthly report's transcript recompute), `activeDebateSpeakers` and `isDebating`
(legacy-row normalization in `useUserProfileLoader` + `AgentsView`'s streaming
test), `liveToolEvents`, `replacementOffer`, `modelsUsed`, `runContract`,
`DebateRunEvent` (still the element type of `debateRunLogRef`).

Gates: tsc clean; full vitest 476 files / 4708 tests green (the 3 gone tests are
the deleted suite); render-probe re-run for this change because the persistence
strip is inside the export/import path the probe exercises.

## Stage 21, second pass: the run-contract chain had no producer left

Censused first, then cut: `liveToolEventsRef` (declared, never read after the
debate throttler went), `debateRunLogRef` (never pushed — so `runContractFor()`
always returned the ladder for an EMPTY log), `runContractFor` (no consumer since
the placeholder was removed), `buildRunContractStages` (its only caller was that
function), and the `DebateRunEvent` / `DebateRunEventKind` types (nothing
constructs one). `utils/runContract.ts` is now the ladder's TYPE vocabulary only —
`RunContractPanel` imports those and still renders the `Message.runContract`
persisted by rows written before the cut, which is what render-probe's seeded
`run-contract` assertion covers.

The comment above the deleted refs claimed the log was "reset at run start, merged
into the AI message when it lands" — it was neither; a stale comment asserting a
behavior no code has. Deleted with the refs.

Gates: tsc clean; full vitest 476 files / 4708 tests green; eslint on the three
changed files 0 errors / 32 warnings (all pre-existing shapes, the ratchet is
repo-wide); render-probe re-run because the panel's source module changed.

## 20p attempt three: four causes, all in the harness, and the phase is parked again

Runs 4-8 each failed for a DIFFERENT reason, and each one was measured rather
than assumed — worth keeping as the record of what this phase actually needs:

1. waited for `[data-testid="trade-view"]` (Trade surface) after a reload that
   restored the Agents surface → timeout. Removed.
2. no click at all: a reload restores the persisted surface (Settings after the
   sweep), so `sendInDock` had no composer → "no Send button and no Stop button".
   Fixed with a route click.
3. a control send (plain text, same point in the run) failed IDENTICALLY, which
   exonerated the tool path — the hang was never an app defect, and the mock's
   `Unknown tool` branch at DeskToolsService.ts:3041 settles fine.
4. the phase, moved next to the dock sends, called `navTo` before its `const`
   initialization (`ReferenceError`, probe line 636) → replaced with the same DOM
   click inline; `surface-switch-${id}` is real (SurfaceSwitch.tsx:54).
5. runs 7 and 8 then failed in the boot sequence itself (`trade-view` wait, then
   `page.goto` timeout): run 6 was still alive when 7 launched, so two dev servers
   fought for :3000, and 8 inherited a dead server. Two of my gate cycles were
   spent on self-inflicted contention — the rule I already had, applied to probes
   as well as builds.

Phase parked at `.probe-artifacts/20p-probe-work-in-progress.patch` (both probe
files reverted, `node --check` clean, gate runnable).

## 20p attempt four: the missing tool line was the MOCK, not the app

Re-applying the patch and running it found the real cause, and it was never in
the app. `scripts/mock-provider.cjs` armed its tool scenario correctly but then
answered with a bare JSON body regardless of `body.stream`. The dock asks for a
stream, so `sseParser` received zero `data:` frames and produced no tool call —
which is why three of the phase's checks reported `0 tool line(s) before, 0
after` across every earlier attempt. The accumulator itself was unit-tested
(`tests/sseParser.test.ts:35`); what had never run was a **streamed** tool call
through the real transport into a rendered row. Fixed by emitting the frames an
OpenAI-compatible provider actually sends (opening frame with `id`+`name`, then
argument fragments keyed on `index`, then `finish_reason: "tool_calls"` +
`[DONE]`), chunked so the index-keyed accumulator is exercised rather than
bypassed.

Measured with that fix, one clean run, nothing else on the machine:
**111 checks ok, 2 failing** — and the two failures were the probe, not the app.
It asserted `/propose_skill/i` against the row's text, while the row renders in
the app's own voice: `▸Skill draft proposed — Session-open fade short (review
with the Coach)`. Pinning the wire identifier would encode the opposite of the
"labels are human-readable, never keys" rule, so the check now requires the
rendered verb AND the title carried in the tool's own arguments — which proves
the line identifies the call by content instead of printing a generic "tool
used". Both facts come from run 3's captured string, so the predicate is derived
from measurement, not guesswork — and the re-run confirmed it: **RENDER PROBE
OK, `RENDER_EXIT=0`**, with `0 → 1` tool rows projected, both name assertions
green, the tool line surviving a reload (`1 → 1`), and zero pageerrors.

What the phase now covers, all browser-measured: a tool round projects a
`tool-actions-row` (`0 → 1`), the same turn grows the usage ledger the Knowledge
panel reads (`364 → 485` bytes), the tool line survives a reload (`1 → 1`), Stop
during a round leaves one settled row (`3 → 3`), and the dock/Agents/Settings
sweeps still pass with zero pageerrors.

Two operational notes, because both cost a run:
- **The parked instruction was wrong.** It said to start a dev server and
  confirm `:3000` answers before launching. `render-probe.cjs` spawns its OWN
  Vite — on **:4183**, not 3000 — and its own mock on :8787. Pre-starting a
  server competes with it. Sweep `:3000`, `:4183` and `:8787` and launch with
  all three free.
- Runs 2 and 4 died at the probe's boot `page.goto` (30 s) right after the
  previous run's teardown, on an otherwise idle machine; runs 1 and 3 booted
  fine. Treat a driver-level boot timeout as cold-start and re-run rather than
  reading it as a code failure — but say which runs were discarded.

## Two gate findings from the final sweep (2026-10-18)

- **`npm run typecheck:scripts` was red at HEAD and CI runs it** (`ci.yml:36`,
  `release.yml:103`). Cause: the root config excludes `scripts`, so
  `tsconfig.scripts.json` exists to re-add them — and overriding `include` also
  dropped the two ambient sources the scripts need: `vite-env.d.ts` (vite's
  `import.meta.env`) and the `declare global { interface Window }` block that
  lives inside `services/providers/GenericProviderService.ts`, which is what
  types `window.electronAPI`. Neither is imported by a file under check, so the
  program never saw them and reported 4 errors, all in
  `services/infrastructure/ProviderConfigService.ts`. Fixed by naming both in
  `include`: **4 errors before, 0 after; the main typecheck stays 0.** Follow-up
  worth doing: move that augmentation into an ambient `.d.ts`, where a global
  type does not depend on which module happened to be compiled.
- **`npm run skill-approval-probe` passes 25/25 while reporting `pageErrors=2`**
  and exits 0. The two are the quota rejection this probe injects on purpose
  (`[MemoryFiles] notebook write FAILED (quota, 1…2 in a row)`), so a memory
  write that fails surfaces as an *uncaught* page error even though the UI
  handles it. Unlike `render-probe`, this gate does not assert zero page errors,
  so "25/25 passed" here is not evidence of a clean page. Either assert
  `pageErrors === 0` outside the injected scenario or label the count expected.

## The review's two remaining "not verified" items, closed by measurement

- **"Do e2e/boot-probe wait on the splash node?"** Yes, both, with different
  mechanics: `scripts/boot-probe.cjs:119` blocks on
  `waitForFunction(() => !document.querySelector('#splash'))`, while the e2e
  specs assert ABSENCE with a count-0 expectation (`e2e/smoke.spec.ts:55` in the
  shared seed path, `:141` in the first-run spec). `index.tsx:86-92` is
  `dismissSplash` plus its double `requestAnimationFrame`. Both flow docs now
  say which gate does which, and cite the lines.
- **"One service replacing nine" (called unfalsifiable).** That phrasing no
  longer appears in either doc (`grep -n "nine\|replacing" docs/app-flow.md
  docs/app-flow.html` → no matches). The falsifiable form lives in AGENTS.md:
  `GenericProviderService` + `GenericAnalysisService` are the only provider
  clients, and the legacy per-provider services were removed.

## Parked: a permanent gate for the docs' line-number claims

The flow docs carry 56 anchors and go stale silently, so a checker belongs in CI.
Two attempts were built and both were deleted rather than shipped, and the reason
is the design constraint:

- As a vitest file it never ran: the pool reported `Failed to start forks worker`
  / `Timeout waiting for worker to respond` — the contention signature this repo
  already documents — while the log's own headline read `Test Files no tests`.
  A gate that cannot be told apart from a machine fault is not a gate.
- As `scripts/check-flow-doc-anchors.cjs` it ran and reported 82 problems, of
  which ~80 were the scanner's fault: a bare `:2493` written after the `App:NNNN`
  shorthand inherited a filename from an EARLIER line of the same paragraph. A
  gate that false-alarms 80 times teaches everyone to ignore it, so it was
  removed rather than tuned until quiet.

Requirements for whoever rebuilds it, all measured: attribute a bare `:NNN` to
the nearest filename on the SAME line, and only fall back to the paragraph when
the line has none; resolve `App:NNNN` as an alias for App.tsx; ignore numbers
inside a quoted withdrawn claim (`App.tsx` line 2766, cited at
docs/app-flow.md:425 as a mistake this doc already retracted, is
correctly cited as a mistake this doc already retracted); floor the parsed
population so a dead regex fails loudly; and carry a reach control that must
catch both an out-of-range and a blank-line anchor before "0 problems" counts.
Until then the per-line checker used for 69b93ff/5079090 (56 anchors, 0
problems) is a manual step, not an enforced one.

**That last sentence is now false, and the requirements above are all met (2026-10-18).**
`scripts/check-flow-doc-anchors.cjs` exists and runs in CI as "Flow docs cite real lines":
same-line ownership with `App:NNNN` resolved as an alias, no paragraph fallback, a population
floor that fails loudly (120, measured 145), and nine reach controls that plant both an
out-of-range and a blank-line anchor. The retracted-claim case was solved differently than the
requirements imagined: rather than teach the scanner to recognise a quote, the withdrawn sentence
at `docs/app-flow.md` was rewritten to "App.tsx line 2766", so the number is no longer in
`file:NNN` form and the gate cannot mistake it for a live citation. `UNATTRIBUTED_CEILING`
is **0** — every number in both flow docs names its file — and the ratchet was proved in both
directions: a planted bare `:1234` made it FAIL, removing it made it pass. Qualifying the last
98 unattributed claims is what exposed six wrong line numbers (see the flow doc's correction 6).

## Gate evidence at this tip (2026-10-18, all figures read from each gate's own marker line)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run typecheck:scripts` | exit 0 |
| `npm run typecheck:electron` | exit 0 (three `.cjs` files, invisible to tsc) |
| `npm run check-flow-doc-anchors` | OK — 145 anchors, 0 unattributed, 9 reach controls |
| `npm run e2e` | 5 passed, 1 worker, 37.2 s, `E2E_EXIT=0` |
| `npm run test` | **476 files passed / 1 skipped, 4708 tests passed / 11 skipped, 410 s, `VITEST_EXIT=0`** |
| `npm run render-probe` | OK — 113 checks, 0 FAIL, zero pageerrors, `PROBE_EXIT=0` |

**One discard, recorded rather than hidden.** The first full-suite run reported
`2 failed / 469 passed` with `VITEST_EXIT=1` in 718.80 s, and `tests/coachThread.test.tsx` and
`tests/deskToolPerceptionTruth.test.ts` failed 4 tests between them. It was launched 14 s after
the Playwright webServer came down: 1.75× the idle duration and **5 × `Failed to start forks
worker` / `Timeout waiting for worker to respond`**. Both files then ran 13/13 green solo in
4.47 s, and the clean re-run above passed them with zero worker-start failures. The discarded
measurement is the red one; the number to quote is 476/4708.

## Ruled on 2026-10-18, measured, and deliberately NOT started

The owner answered all three open questions with DELETE, and pushed the 16 commits. What the
measurement then showed is that none of the three is a trim — each is a feature with live UI and
persisted state, so each needs its own gated pass rather than a half-edit at the end of a budget.
The file lists are recorded here so the next pass starts from evidence, not from a grep hunt.

**#19 — the ensemble branch, the hybrid pull, and the prompt A/B lane.**
`runEnsembleEnabled` is not local to the hook: it is threaded from `App.tsx` through
the hook used to read the flag in three places and gate a UI-muting early return and the progress steps on it; every one of those reads is now deleted.
`:806` (the coin tip), `:874`, `:923`, `:956`, and appears in the `:1594` dependency array. The
toggle itself is persisted (`hooks/useProfilePersistence.ts`, `hooks/useUserProfileLoader.ts`,
`types/user.ts`, `services/learning/MemoryFilesService.ts`, `services/trade/automationTurn.ts`,
`services/ui/EnsembleAnalystService.ts`) and is covered by three suites
(`tests/analysisPipelineSendIdentity.test.ts`, `tests/automationRouteCharacterization.test.tsx`,
`tests/useProfilePersistence.test.tsx`). Deleting the hybrid pull also changes which coin the
learning step receives, because the packet still feeds `assemblePipelineMemoryContext` at
`hooks/useAnalysisPipeline.ts:1047` (the call; the import sits at :33).

**Correction to what this doc and the flow doc currently assert about the A/B lane.** It is not
"starved with no caller" in the product sense: `beginPromptLane` has no caller, so
`controlLane` can never become true and `getPrompt`'s guard at
`services/infrastructure/PromptOverrideService.ts:63` is unreachable — but the two settings that
drive it are live and user-facing: `promptAbRate` and `pinnedPromptLane` are surfaced in
`components/settings/SessionUsagePanel.tsx` and read by `utils/promptVersionStats.ts`. Removing
the lane therefore removes a visible control and its statistics. My earlier sentence in
`docs/app-flow.md` described the dead writer only; it understated the feature still attached to it.

**#17 — accuracy mode and the calibration ledger.** Measured on the second pass, and my earlier
framing was wrong in two ways that both matter before anyone edits:

- *The calibration store is not accuracy mode's sidecar.* `calibration` has **402 hits across 30+
  files**, including `components/dashboards/learning/CalibrationBar.tsx`, `TraderProfileCards.tsx`,
  `services/learning/monthlyReport.ts`, `metaCalibration.ts` and `schemas/tradeAnalysis.ts`.
  Deleting it deletes visible Learn-surface dashboards and the confidence-band input. So
  "accuracy mode + the calibration ledger" is really two decisions, and only the first was
  clearly ruled on. The ledger was NOT deleted on that ambiguity.
- *Accuracy mode is load-bearing in three places the task text never named.* (1) It changes what a
  prompt receives: `services/providers/GenericAnalysisService.ts:335` sends the memory context
  whole for accuracy and truncates it to 800 tokens otherwise, so the branch's survival value for
  the ordinary path must be decided, not assumed. (2) `AccuracySubMode` is not an optional setting
  but a **required, persisted `AutomationConfig.mode`** (`types/automation.ts:42`) with a picker at
  `components/automation/AutomationEditorModal.tsx` (the Lenses toggle block: the earlier citation landed on that block’s opening comment, so no line is given) and a label at
  the automation card's Lenses/Analysts chips — stored schedules already carry it, so removing
  the field needs a read-side migration or old configs fail validation on load. (3) Three further
  toggles live under it (`isPlaybookEnabledInPureAI`, `isFamiliesEnabledInPureAI`,
  `isMemoryEnabledInPureAI`) and gate injection in `GenericAnalysisService` and the memory
  context. Scope: **129 accuracy hits across 22 files**, 4 of them suites
  (`automationRouteCharacterization`, `memoryFilesService`, `useProfilePersistence`,
  `useUserProfileLoader`), plus `components/modals/AccuracyModeModal.tsx`, the `accuracyOriginal` /
  `accuracyPure` tabs in `components/settings/CustomInstructionsEditor.tsx`, and the journal badge
  in `components/journal/TradeLog.tsx:107-111`.

Not attempted this session, deliberately: with the full gate chain costing ~10 minutes per pass and
the remaining budget in single-digit turns, a 22-file feature removal with a stored-config migration
would have landed half-finished on a `main` that is pushed.

**The two sub-decisions are now answered (2026-10-18, second ruling round).**
1. *Which memory path survives*: the owner's words were "I want this to be a normal chat", so the
   ordinary branch wins — `services/providers/GenericAnalysisService.ts:335` keeps the 800-token
   truncation as the only behaviour and the whole-context branch goes with the feature. Everyday
   sends are byte-identical to what they are today; only accuracy-mode sends change.
2. *Stored schedules*: `AutomationConfig.mode` collapses to `'standard'` **on the reader side** —
   the field stays in the type, anything not `'standard'` coerces to `'standard'`, the picker in
   the editor's Lenses toggle and the label at
   the automation card's Lenses/Analysts chips go away. A saved schedule keeps running instead
   of failing validation on load, which is the whole reason not to drop the field outright.
3. *Calibration*: the owner chose **delete the dashboards too**, after being told in plain terms
   that this removes the Learn tab's calibration bar, trader profile cards and monthly report — not
   just a hidden store. It stays a separate gated pass; it is the largest of the four.
Also agreed: anything the user typed into the two accuracy instruction boxes is deleted with them,
with an offer to migrate that text into the general list before the tabs go.

**Attempted #19's tail in an isolated worktree on 2026-10-18 and stopped at the third site — with
two couplings the list above did not contain.** They are the reason this is a design pass and not a
grep-and-delete:
- `isEnsembleEnabled` gated **live market polling** too: `App.tsx:444` passed it to
  `hooks/useMarketData.ts`, which uses it at `:44` (clears `liveMarketConditions` when off), `:127`
  and `:161` (the Binance reachability check) and `:118`/`:192` (effect deps). So deleting the
  toggle silently kills the market ticker the header shows, unless the polling is re-parented onto
  `isHybridIntelligenceEnabled`, which is that feature's own switch and the honest owner of it.
  Note the toggle's default is **off** (`App.tsx:330` `useState(false)`), so "ordinary chat wins"
  means today's default behaviour, not today's opt-in behaviour — a user who enabled ensemble
  loses the ticker unless it is re-parented. That re-parenting is a feature decision, not a trim.
- `runEnsembleEnabled` is not only read in the hook: it is passed **as a positional argument** at
  the pipeline into a callee alongside `runLensConfig` and
  `runEnsembleSelection`, so removing it changes that signature and its other callers, and the
  argument order is load-bearing. Each such site drags a second file into the diff, which is how a
  "22-file" task is really 30+ and why it needs a session with room for several typecheck loops
  (one pass here runs 4–5 minutes).

The worktree was removed; `main` and the working checkout are untouched.

**Correction to the cost claim I used to defer all three deletions (2026-10-18).** I wrote that one
`npm run typecheck` pass runs 4–5 minutes and therefore a compiler-driven 22-file removal cannot fit
in a session. Re-measured on an idle machine: **cold 14 s, warm 4 s** with `--incremental`
(buildinfo 377,958 bytes, exit 0 both times). The slow run I generalised from called tsc **twice in
one command** while the full suite had just released the machine — contention, not cost. So the
real blockers for these three are the two design couplings above (market polling, a positional
argument) and the persisted-field semantics, not the typechecker's speed, and no `incremental`
config change is needed to proceed.

**#21 — `postMortem`, `savedAnalyses`, `Message.debateTurns`.** Measured the `savedAnalyses`
surface before touching it, and it is not the quick trim the phrase "no writer" suggests: **54
references across 17 files**. Only `setSavedAnalyses` was starved, but the plumbing around it was
alive and asserted: `SqliteService` read and wrote it as its own column, staging JSON and diffing
against the previous profile; `profileUtils` validated the first element's shape on every profile
read; `BackupService` refused backups where it was not an array and reported `savedAnalysesCount`;
`dbService` seeded defaults; and ten suites pinned it — one round-tripped a row and asserted
`userPrompt` survived. So **the store had a working read/write path with a dead source, not a dead
path**. Deleting it therefore meant a schema change plus a backup-format change plus ten suite
edits, with the migration decided explicitly rather than discovered mid-edit.

**Resolved 2026-10-19, stage 21.** The migration was decided first: **keep the `saved_analyses`
table, delete the code.** Dropping a table is a destructive migration against the owner's live
journal, and the reasoning above is that its bytes may still be history worth having. Deleted: the
`UserProfile` field and the `SavedAnalysis` type, the `useTradeLogging` state and the
`setSavedAnalyses` prop that threaded it to the loader, three loader call sites, the persistence
hook's snapshot key and both dirty-section comparisons, `SqliteService`'s fingerprint entry plus its
SELECT section plus its INSERT/delete-absent section, `BackupService`'s validation and the
`savedAnalysesCount` preview field (nothing under `components/` ever read it), `profileUtils`' shape
check, `dbService`'s two default seeds, and 19 further occurrences in fixtures and nine probe
scripts that seeded the old profile shape. The round-trip suite kept its trades and summaries and
lost only the analyses leg. Census: 66 references across 21 files, removed as one all-or-nothing
asserted codemod — nothing was written unless every expectation matched. **Local `npm run lint` cannot run at home right
now**: 95 of its 96 errors sit in `docs/analysis/data/`, which has zero tracked files, so CI
never sees them — ignoring that directory or moving it out of the repo is a decision, not a
cleanup.

## 2026-10-19 — #17 taken as one asserted codemod pass; the assertions won

The DELETE ruling stands. This pass stopped trying to edit accuracy mode file by
file and instead wrote ONE script (outside the repo: `acc_codemod.mjs` under the
Windows `%TEMP%` dir) that refuses to write a single byte unless every
replacement matches its expected count. It aborted twice and `git diff --stat`
then showed only the owner's `package-lock.json`: the working tree is untouched,
no half-deleted feature.

What the attempt measured, which is the value it leaves behind:

- The surface is 25 tracked source files, not the ~18 named earlier. Missed
  before: `hooks/useUIState.ts` owns the modal's open flag,
  `components/automation/AutomationEditorModal.tsx` renders the automation Mode
  picker, `components/automation/AutomationView.tsx` renders its label, and
  `scripts/installer-smoke.cjs:290-295` carries a profile fixture with all five
  settings fields. Leaving any of them produces an inert control or a stale
  packaged-exe fixture.
- The Pure-AI trio cannot outlive the mode: its three switches were rendered
  only while the sub-mode was `pure_ai`, so they went in the same pass as the
  toggle, not after it.
- `services/providers/GenericAnalysisService.ts:361` is a three-way prompt chain;
  deleting the two mode branches means lifting the standard branch out of its
  `else` and dedenting it, which needs a brace-walking flattener, not a regex.
- `hooks/useProfilePersistence.ts:185` and `hooks/useAnalysisPipeline.ts:1398` list
  the five fields inside one-line object literals and one very long dependency
  array, so whole-line filtering cannot reach them — they need token strips.
- The one unsolved blocker is `components/settings/CustomInstructionsEditor.tsx:164`:
  the tab strip is a single `<div>` holding three sibling `<button>`s, so "delete
  from this line through the matching `</div>`" swallows its siblings (that is
  what tripped the second abort). The fix is a sibling-aware range — walk back to
  the line equal to `<button`, forward to the line equal to `</button>` — then
  collapse `InstructionTab` to the one list.

Resume facts: `node <temp>/acc_codemod.mjs` is idempotent-safe to iterate because
it aborts before writing. After it succeeds, run `npm run typecheck` and expect
to hand-repair the lines it deliberately skips (any line with unbalanced braces,
e.g. an `if` opener left without its body). #19 and #21 are unchanged above and
still unbuilt.

## 2026-10-19 — #17 executed and reverted to a patch; here is the exact resume state

Accuracy mode was deleted for real this time, in the working tree, and the pass
reached: `npm run typecheck` 0 errors; the six suites that read the deleted fields
green (95 passed, 11 skipped); zero surviving mode identifiers anywhere in the
tracked source. It is NOT committed, because the flow-docs anchor gate went red on
4 drifted citations and eslint could not be run (the changed-file list included the
deleted `components/modals/AccuracyModeModal.tsx`, which makes eslint exit 2).
Committing a red gate was refused; the tree was restored from
`acc17_full.patch` under the Windows `%TEMP%` dir (1,655 lines, applies with
`git apply`), and `hooks/useProfilePersistence.ts` etc. are back at HEAD.

Restoring the tree swept one file that was not mine — the owner's uncommitted
`package-lock.json` edit rode into the same diff. It was re-applied from a
pre-pass snapshot and verified byte-identical. The rule this pass learned: build
the revert patch from the same pathspecs the pass touched, never from `git diff`
over the whole tree.

The commit-blocking sequence, in order: re-measure the doc citations that moved
when the deleted lines shrank the files — the two `App:` alias rows in
`docs/app-flow.md` and `docs/app-flow.html`, and this file's two
`hooks/useAnalysisPipeline.ts` numbers (the props-destructure triple and the
dependency-array bullet) — then re-run eslint with the deleted modal kept out of
the file list, then the full suite and render-probe, and only then commit. Every
re-measure here moved a citation by locating the identical line text in the
post-deletion file; none was shifted by arithmetic, because the deletions were
not uniform across a file.

Residual design note the pass confirmed: two prompt-registry entries
(`analysis.accuracy`, `analysis.pure_ai`) survive the mode and are now editable by
the Prompts tab but consumed by nothing, and the calibration store plus the Learn
dashboards — the owner's second DELETE ruling inside this decision — are untouched.

## 2026-10-19 — #17 second pass: committed locally, two gates still owed

Re-applied the saved patch (excluding the owner's `package-lock.json` edit this
time, by pathspec) and finished the sequence the previous section described.

Green before committing: `npm run typecheck` with zero errors; the flow-docs
anchor gate; eslint over the 28 changed files that still exist (one error, a
`prefer-const` on the journal row's container class, which the deleted badge
branch had been the only writer for); and the six suites that read the removed
fields. The citations the deletions moved were re-measured by locating the
identical line text in the post-deletion file — the two `App:` alias rows in
`docs/app-flow.md` and `docs/app-flow.html`, and this file's two
`hooks/useAnalysisPipeline.ts` numbers — never by shifting arithmetic, because
the deletions are not uniform within a file.

Owed, and the reason this is a local commit only: the full vitest run and
`npm run render-probe` were still in flight when the last turn expired. CI runs
both, plus boot-probe and the installer smoke. Nothing was pushed, and a
`git revert` of this one commit restores the mode exactly.

Design residue left standing, deliberately: the prompt registry still offers the
two mode prompts the analysis path no longer consumes, and the calibration store
with the Learn dashboards — the owner's second DELETE ruling inside this
decision — has not been touched. #19 and #21 remain unbuilt.

## 2026-10-19 — the named residue is gone too

`constants/promptRegistry.ts` no longer offers the two prompts nothing consumes,
so the Prompts tab cannot present an entry whose text reaches no request, and the
`analysis.master` usage line stopped advertising the deleted mode. The prompt
bodies themselves were removed from `constants/prompts/analysisPrompts.ts`. A
whole-tree scan for the two constant names and the two ids reports zero
references, typecheck is clean, and the two changed files lint with zero errors
and zero warnings.

Still owed by #17: the calibration store with the Learn dashboards (the owner's
second DELETE ruling inside this decision) — untouched, and larger than this
file's surface. #19 and #21 remain unbuilt.

## 2026-10-19 — #17 is now verified by the whole local chain, not a subset

The two commits were re-checked against the gates they had not yet faced:

- full suite: 476 files passed / 1 skipped, 4708 tests passed / 11 skipped, zero
  `FAIL` lines, exit 0 — measured by `vitest run` in `npm run test`'s own log, not
  by a wrapper exit code.
- render probe: `RENDER PROBE OK`, every exchange renders, settled verdicts and
  malformed persisted audit data drop no row, all four nav surfaces mount, the
  Learn and Journal sweeps find no inert control, and zero pageerrors.

That is the point: the deletion removed a Settings row, a journal badge and an
automation label, and the surface that could have silently dropped a row is the
one jsdom tests cannot see.

Not run locally, still CI-only: `installer-smoke` (needs the packaged exe) and
`npm run build`'s bundle path. #17's second ruling — the calibration store with
the Learn dashboards — is still untouched, as are #19 and #21.

## 2026-10-19 — #21 first piece: the moderator synthesis field is gone

`LoggedTrade.moderatorSynthesis` had exactly three sites — the declaration, the
writer that copied the assistant message into it at log time, and one column in
the printable report — and all three are deleted, with the transcript comment
reworded to name only the debate turns that remain. A scan for the identifier
across the repo returns nothing.

Gates run for this change, all green: typecheck, eslint on the three files, the
flow-docs anchor gate, the full suite, and the render probe with zero pageerrors.
The rest of #21 is untouched and is NOT this small: `debateTurns` spreads over 14
source files plus 3 suites and feeds the training-data export, the chart, the
monthly report and conviction drift; `postMortem` is 50 files; `savedAnalyses` —
31 refs with a SQLite column and backup validation — has since been deleted (see
stage 21). The calibration ruling is larger
still than either, because the confidence store is written at outcome time and
read by the validation gate, the lens service and the Learn dashboards at once.

## 2026-10-19 — parked: what is landed, what is not, and the exact entry points

Turn budget ends here. Nothing is half-done in the working tree: the six commits
are gated, `git status` shows only the owner's own paths, and the remaining
rulings are NOT started. The entry points below were re-read from the current
tree this pass, not recalled.

**Two of my earlier claims in this ledger were wrong and are corrected here.**
The backup validator is `services/infrastructure/BackupService.ts`, and the line
numbers I had attributed to a bare `BackupService.ts` are actually
`services/infrastructure/SqliteService.ts:686` — the saved-analyses JSON compare.
And the settings field `confidenceCalibration` is not what the Learn dashboards
read: `components/dashboards/learning/CalibrationSection.tsx:28` renders
`profile.confidenceAccuracy`, produced at
`services/learning/SelfLearningService.ts`. Those are two different stores,
and the owner's "delete the dashboards too" ruling is about the second one.

**Remaining ruling inside #17 — the calibration dashboards.** Delete
`components/dashboards/learning/CalibrationSection.tsx` and
`components/dashboards/learning/CalibrationBar.tsx`, their mount at
`components/dashboards/LearningDashboard.tsx:203`, and the
`confidenceAccuracy` producer at `services/learning/SelfLearningService.ts`.
Separately, the `confidenceCalibration` settings field is now deleted too. It
was plumbed through `App.tsx`, the profile persistence and the pipeline's props
and dependency array, but the pipeline never read it — a prop that is only ever
listed in a dependency array is a writer with no reader. `GlobalLearningService
.getCalibration()` itself stays: the pipeline, the lens service and the version
history card all still call it directly.

**#21 — three sub-items, measured, none started.** `debateTurns` is declared at
`types/message.ts:189` and `types/trade.ts:128`, written at
`hooks/useTradeLogging.ts:350` and `utils/watchList.ts:30`, and read by
`hooks/useAnalysisPipeline.ts:908`,
`hooks/useWatchAndAutopilot.ts:105`, `services/analysis/convictionDrift.ts:82`,
`services/learning/monthlyReport.ts:220`, `utils/analysisUtils.ts:990` and the
report's turn count at `utils/reportExport.ts:241`, plus a seeded fixture in
`e2e/smoke.spec.ts:86`. Deleting it removes the input to conviction-drift and
the monthly report's ensemble line, so those consumers change behavior, not just
size. `savedAnalyses` carried a real table
(`services/infrastructure/SqliteService.ts:214`, still created), a read, a
write-and-diff and an id list — a persisted-schema deletion, which is why the
table was kept and only the code removed. See the stage-21 note above.

## 2026-10-19 — a fourth orphan from stage 19: the desk-tool cache lost its invalidation

`AGENTS.md` claimed `clearDeskToolCache()` was "called at each debate start". Grepped: the only
call sites left were its own definition and ~30 test files — no production caller at all. That
was the debate start's deletion taking the invalidation with it and no gate noticing. The
consequence is not cosmetic: the cache holds the market reads (order book, liquidations,
derivatives, market packet, all timeframes) for 30s, so with no per-run clear a run could be
answered with the PREVIOUS run's order book whenever the gap between them exceeded the TTL —
which is unbounded. A live reader with a dead writer, the same class as the two writes and the
chart verdict found earlier in this stage.

Fixed at the choke point instead of the boundary: `streamChatWithDeskTools` now clears before it
runs the loop, so no caller has to remember. Two assertions pin it in `tests/deskToolCache.test.ts`
— the clear appears in that generator before `runDeskToolLoop(`, and no production caller clears it
instead (the second half is what stops the wiring drifting back to a forgettable site). RED PROOF:
stripping the call makes the first index `-1`, which the test asserts greater than `-1`. Verified
against the file itself, not by argument. `AGENTS.md` and the `toolArtifactStore` comment now say
"every tool turn" rather than "every debate".

Gates: typecheck, eslint 0 errors, vitest 476 files / **4710** tests (the two new ones),
render-probe zero pageerrors.
with backup validation and the SQLite round-trip test to update. `postMortem` is
the largest reader set.

**#19** is untouched: the surviving ensemble branch in the pipeline, with the
market-polling coupling and the positional-argument site recorded above.

**Gate chain each of these owes before commit:** typecheck, eslint on the changed
files, the flow-docs anchor gate, the full suite, the render probe. Run them one
at a time, never alongside the probe.

## 2026-10-19 — the calibration dashboards are deleted; one claim of mine was wrong

The owner's second ruling inside #17 is now executed. The Confidence Calibration
card and its bar are gone from the Learn surface, the profile no longer computes
a per-confidence win-rate list, and the card that shared the file with them kept
its own name: the surviving component is
`components/dashboards/learning/AvoidSetupsSection.tsx`, because it renders
"Setups to Avoid" and nothing else. A file called CalibrationSection that no
longer shows calibration is exactly the kind of name that misleads the next
reader, so the rename is part of the deletion, not decoration.

**A claim in the section this one replaces was false, and it is withdrawn.**
`tests/calibrationSurface.test.ts` does not scan the dashboard modules: its
MODULES list is the three `services/validation` calibration modules, so the
"module floor to lower" instruction it gave was aimed at the wrong gate. No test
change was needed here — `grep -rln confidenceAccuracy tests` was already empty,
and the full suite ran unchanged at 476 files passed / 1 skipped.

Gates for this change: typecheck, eslint on the three touched files (0 errors;
5 pre-existing `no-explicit-any` warnings, none introduced), the flow-docs
anchor gate, the full suite, and the render probe. The probe's first run failed
with "user row rendered, no settled reply" — that was contention: a background
run I had killed earlier still owned the probe's vite port, so the browser
talked to a server whose mock child was gone. Re-run with the script's own
`PROBE_PORT` and `MOCK_PORT` overrides it passed, Learn and Journal sweeps and
all, zero pageerrors.

Still open: #17's other calibration half — the `confidenceCalibration` settings
field and its persistence/loader plumbing — where the field is plumbed through
`App.tsx` and `hooks/useAnalysisPipeline.ts` but has no renderer, so it needs a
reader check before it can be called dead. And #19, and #21's three remaining
sub-items.

The settings copy of the calibration store is deleted with this: the field, its
state, the loader read, the persistence snapshot entries and the pipeline prop.
The pipeline only ever listed that prop in a dependency array, so removing it
changed no behavior — which is the point of a writer with no reader.

`tests/analysisPipelineSendIdentity.test.ts` then failed, and it is worth
recording why: its header claimed the send callback's dependency array was
"36 entries", while the committed mode deletion had already taken it to 31 and
this one to 30. The floor (`toBeGreaterThan(30)`) was the only thing that
noticed, and a number inside a comment is checked by nothing. The census in the
header is now the measured 30 and the floor is 24, both with the reason written
next to them, so the guard still fails loudly if the extraction ever breaks.

## 2026-10-19 — `debateTurns` is NOT all dead code, and that changes the ruling's meaning

Measured before deleting anything, because "delete fields + readers" reads as one
action and is actually two.

Nothing produces a transcript any more: the only writes are copies
(`hooks/useTradeLogging.ts:349`, `utils/watchList.ts:30`) and **no code sets
`isDebating: true`** — every remaining `isDebating` is a literal `false`, and
`hooks/useUserProfileLoader.ts:377` forces it false on load. So the failure-path
guard inside `classifyRunFailure` (`hooks/analysisPipeline/runOutcome.ts:47`) is unreachable and the three
verdict-fallback parameters in `utils/analysisUtils.ts` (the final-verdict text,
the level hit-odds legacy parse, the signal-card "why") only ever take their
`analysis.strategy` / stored-`levelProbabilities` branch. That half is safe to
delete, and the `ensembleProgress` / `activeDebateSpeakers` producers are already
gone.

The other half is not dead — it is retroactive over existing rows:
`services/analysis/convictionDrift.ts`, `ensembleLineFromTranscript` in
`services/learning/monthlyReport.ts`, the round-1 openings the follow-up ticket
assembles in `hooks/useWatchAndAutopilot.ts:105`, and the transcript count in
`utils/reportExport.ts:241` all read transcripts already persisted on trades
made before stage 19. Deleting the field removes those from the monthly report's
ensemble-line row, the seat conviction-drift analysis, the follow-up prompt's
context and the export's count — for the journal the owner already has, not for
future runs. Live app data is in `app://` IndexedDB and cannot be read from here,
so how many rows still carry a transcript is unknown, not zero.

So #21's transcript item is left standing until the owner chooses: delete only
the unreachable half (guard + three fallback parameters), or also give up
analysis over the stored history. This is a feature-shape call, not a bug fix,
which is why it was not made silently. Everything else ruled in #17 is landed and
gated; #19 and the `postMortem` item remain (`savedAnalyses` was cleared later the
same day — see the stage-21 note above).

## 2026-10-19 — the unreachable half is deleted: `isDebating` and `activeDebateSpeakers`

Measured before cutting: every write of `Message.isDebating` in the app was a literal
`false` — eight of them (five on constructed rows that never debated, two in the loader,
one inside the branch below) — and the loader rewrote any loaded row to `false`, so no row
could ever reach the one branch that read it. `activeDebateSpeakers` had exactly one
writer, and it was inside that same branch. That makes `mapRunFailureMessages`'s debating
branch unreachable, not merely unused: the guard, the transcript-preserving return and the
two cancel/error sentences it chose could not execute.

Deleted: that branch (`hooks/analysisPipeline/runOutcome.ts` — which is why `cancelled`
left its `ctx`: the text it picked was the flag's only reader), `isDebating` and
`activeDebateSpeakers` from `types/message.ts`, the load-time normalization that forced the
flag false, the SQLite write-time strip of `activeDebateSpeakers`, the `|| m.isDebating` in
the Agents desk row's streaming flag, and the five literals.

The history-reading half above is untouched. `debateTurns` still travels with a logged
trade and still feeds those four consumers; the owner's choice about them stands as written.

Consequence measured, not assumed: dropping the SQLite strip means a row persisted before
this change keeps its `activeDebateSpeakers` object when re-serialized instead of losing it
on the next save. Nothing reads it and the field has left the type, so those are inert
bytes on legacy rows — accepted over keeping a stripper for a key no writer can produce.

Nine doc citations moved when these lines went. Each was re-measured by matching the HEAD
line's content, and two were re-pointed at a real symbol instead of the bare `};` they used
to land on (`useAnalysisPipeline.ts:970` for the automation guard, `:747` for the coin tip).
One failure mode the gate cannot see, recorded because it happened here: a citation that
drifts onto a DIFFERENT non-blank line passes. The run-failure guard's own number did
exactly that, so the two ledger sentences citing it were rewritten rather than renumbered.

**#19 scope, measured for whoever picks it up:** the multi-seat branch is 132 references
across 27 files (`'panel'`, `panelModels`, `isEnsembleEnabled`, `ensembleModelSelection`),
heaviest in `components/trade/TradeChatPanel.tsx` (21), `App.tsx` (13),
`hooks/useAnalysisPipeline.ts` (11), `services/trade/chatSessions.ts` (7) and
`hooks/useProfilePersistence.ts` (7). The session kind, the seat loop in
`services/trade/chatTurnRunner.ts`, the persisted ensemble choice and the seat pickers are
one unit — removing part of it leaves a picker that selects a roster nothing consumes. Not
started here rather than left half-deleted.

## 2026-10-19 — #19's referent moved: what survives is a live multi-seat chat, not the debate branch

Measured before deleting anything, because "the ensemble branch" no longer names what it did
when it was ruled on.

**The panel is reachable and working.** `components/trade/TradeChatPanel.tsx:937` renders a
**"New panel · up to 5 models"** control, and a local `addSession(kind)` creates the session;
`chatTurnRunner.ts:989` builds the seats, refuses below two usable seats (`:990`), opens a
`createDebateMailbox` (`:1023`), plans each turn with `planPanelTurn` (`:1035`), gives every
seat its own mandate ("You are \"X\" on a 5-seat chart panel", `:1058`), streams each seat into
its own bubble, and parses `@Name` mentions so a seat can pull another in mid-turn (`:1118`).
The picker's own copy says it plainly: "pick up to 5 models or agents; **they answer together
and talk to each other**". Nothing about that is starved, unreachable or vestigial: no
production code calls `createSession('panel', …)`, but the UI does it through the panel's own
`addSession`, and the trader can start one with two clicks.

So the ruling "delete the ensemble branch, I want this to be a normal chat" was given against
the ensemble *analysis* debate — the engine, the moderator, the consensus pass, the seat
completeness refusals — and all of that is already gone. What is left under the same name is a
different product surface: a multi-agent room on the chart dock, built on the Agents mailbox
that the owner has not ruled on, sharing machinery with the `group` session kind that stays.

Why this is not the same call as `savedAnalyses`: that store had no writer and no UI, so
deleting it removed plumbing around data nothing could reach. This one has a control, a picker,
a streaming renderer and a working turn. Deleting it removes the ability to have several models
or agents answer one question together on the chart — which is the "they answer together"
feature, not a leftover of the debate. Recorded here rather than executed silently, per
"feature shape is theirs", and because the ledger's earlier census ("132 refs across 27 files")
described the size of the job, not what the job costs the trader.

**What deleting it would actually take, now measured:** `SessionKind` loses `'panel'`
(`services/trade/chatSessions.ts:84`) plus `panelModels`/`PanelSeatRef` and their load-time
sanitiser (`:258`); `services/trade/chatPanel.ts` dies whole (its only consumer is the seat
loop); the seat arm of `chatTurnRunner.send` (`:989`–`:1140`) and both `kind === 'panel'`
supervisor/seat-model reads (`:820`, `:1179`); `TradeChatPanel`'s `isPanel`, the picker overlay
(`:1016`–`:1044`), `ready`'s two-seat rule (`:823`), `panelCount` (`:1138`) and the "New panel"
button (`:937`); the ◆ marker in `ChatHistoryPalette.tsx:81`; the persisted ensemble flag across
`App.tsx`, `useProfilePersistence`, `useUserProfileLoader`, `useMarketData`,
`useCatalogReconcile`, `useLensAndEnsembleConfig`, `types/user.ts` and `automationTurn.ts`; and
three suites that pin it (`tests/chatSessions.test.ts`, `tests/chatPanel.test.ts`,
`tests/analysisPipelineSendIdentity.test.ts`).

**Decision wanted, in product terms:** does the chart's chat keep the ability to have several
models or agents answer together, or is the dock a one-model chat and multi-agent conversation
belongs only to the Agents surface? Either answer is one word. If DELETE, say so and this is
two gated passes (the panel surface, then the ensemble flag), not a trim. If KEEP, then #19 is
closed as scoped and the remaining flow-doc sentences about "the ensemble branch" get reworded
to name the panel, which is what they now actually refer to.

## 2026-10-19 — gate state at the tip: every local gate has now been run

Earlier entries here carry "lint / boot-probe / e2e remain unrun" caveats from the moment each
pass finished. Those are superseded. All of the following were run against the tip after #17,
the `isDebating` deletion, the `savedAnalyses` deletion and the desk-tool cache fix:

- `npm run typecheck` — clean. `npm run typecheck:scripts` — clean, and it had to be: nine probe
  scripts under `scripts/` were edited when their seeded profile shape lost `savedAnalyses`.
- `npm run build` — clean (the flow docs' claim that the bundle builds is therefore measured).
- `npm run lint` — **exits 1, and not on tracked code.** All 95 errors attribute to five files in
  `docs/analysis/data/` (`_census.cjs` 32, `replicate_bodyonly.cjs` 22, `v8_profile_decode.cjs` 16,
  `_probe_outcomes.cjs` 16, `_probe_node_v8.cjs` 9) — the owner's untracked scratch scripts, which
  CI never checks out. Warnings are 689 against the `--max-warnings 889` ratchet. So the local lint
  failure is pre-existing and structural, not a regression from these passes; ignoring that
  directory or moving it out of the repo remains an owner decision, not a cleanup.
- `npm run test` — 476 files / 4710 tests passed, 1 file and 11 tests skipped.
- `npm run render-probe` — OK, zero pageerrors (run twice: after the flag deletion and after the
  cache fix). `npm run boot-probe` — OK on the built bundle, which is the proof that the app still
  boots on a seeded profile that carries no `savedAnalyses` key at all. `npm run e2e` — 5 passed.
  `npm run skill-approval-probe` — 25/25 checks, `pageErrors=2`, which is this probe's known-good
  signature (the 2 are its own deliberately-injected notebook quota failures being surfaced).
- The flow-doc anchor gate — 227 anchors, 0 unattributed, all 9 reach controls passing.

`installer-smoke` stays CI-only on purpose (it needs the packaged exe; a local run would bypass
the chain that signs the bytes). Nothing here is pushed: `git rev-list --count origin/main..HEAD`
is **22** local commits, and the owner's earlier push authorization covered the 16 that existed
when it was given — so the six since then are not covered and stay local until said so.

## 2026-10-19 — the `postMortem` census in this doc is inflated, and the difference is a landmine

Went to size the remaining #21 item and found my own earlier figure wrong, in a way that matters
more than the number. Grepping the token `postMortem` across code returns **189 lines in 57
files**. Grepping for the deleted *field* — a bare `postMortem` property or object key, excluding
every longer name that merely starts with it — returns **105 lines in ~35 files**, roughly half of
them test fixtures. The other ~84 lines are two different things that happen to share the word:

- **The outcome-validation engine.** `services/backtesting/BacktestingService.ts` (15 hits:
  `PostMortemTPHit`, the `[PostMortemValidation]` log prefixes) and `services/ui/AutoCaptureService.ts`
  (7: `PostMortemDataSummary`, `extractPostMortemDataSummary`, `logPostMortemDataVerification`)
  replay candles to decide whether a trade's TP or SL actually got hit and whether the captured
  outcome agrees with the logged one. Load-bearing, live, and named after the *validation pass*,
  not after the deleted prose field.
- **An enum value.** `LoggedTrade.rSource` and `excursionSource` are `'autopilot' | 'postMortem'`
  (`types/trade.ts:203-186`): "this excursion was observed by the after-close validation pass",
  which still happens. `effortForTask('postMortem')` at `services/learning/traderLearner.ts:105`
  is a reasoning-budget key, pinned by `tests/reasoningControls.test.ts:60`.

**A bulk deletion keyed on the word would have taken the outcome engine with it.** The real
field's production readers are `services/learning/SkillCraftService.ts` (the craft leg),
`selfImprovement.ts`, `SkillMemoryService.ts`, `PatternMemorySynthesisService.ts`,
`MemoryFilesService.ts`, `draftGates.ts`, `utils/rootCause.ts`, `utils/tradeInsightBrief.ts`,
`utils/reportExport.ts`, `hooks/analysisPipeline/memoryContext.ts`,
`services/learning/EvidencePackService.ts`, `DoctrineConsolidationService.ts`,
`NotebookWriterService.ts` and `services/infrastructure/SqliteService.ts` (its row mapping).
Where section D of the flow doc and an earlier entry here say "25 read accesses across 17 files",
the measured statement is **105 field lines across ~35 files, of which ~17 are production** — and
`services/trainingDataExport` deliberately omits the field, pinned by
`tests/trainingDataExport.test.ts:45` (`expect(d).not.toHaveProperty('postMortem')`), so that
assertion survives the deletion and should not be mistaken for a reader.

Two decisions the eventual pass must make rather than discover: every reader that *composed* a
prompt, note or brief from the post-mortem prose loses a whole section (its variable cannot just
be renamed), and `rSource`/`excursionSource`'s `'postMortem'` member is a stale NAME on live data —
renaming it touches the SQLite mapping, the round-trip test at `tests/sqliteService.test.ts:410/:436`
and every row already storing that string, so it is its own schema-shaped decision, not part of
this deletion.

Held rather than executed: with the turns left, a 35-file pass over the learning and skill-craft
path is exactly the work that either finishes or gets left half-deleted, and a half-deleted
learning path fails silently the way the desk-tool cache did.

**Executed since that sentence — the part that needed no owner decision.** Three `Message` fields
had zero references anywhere outside their own declaration: `postMortemDebateTurns`,
`isPostMortem` and the `postMortemFailedCandidate` retry object with its nested `feedback` shape.
Proved by grep, not by typecheck: an unread optional field typechecks forever. Deleted from
`types/message.ts` only — the trade-side fields the owner's history question covers are untouched.
The collision warning paid for itself immediately: the four token hits in
`hooks/useTradeJournalActions.ts` are capitalised `PostMortem…` names belonging to the validation
engine, and a case-sensitive grep for the field finds none there.

**Also found and removed: `Message.replacementOffer`, the fifth orphan from stage 19.** Its only two
references both *read* it — `utils/approvalInbox.ts:76/:80` build a "…dropped — pick a replacement
analyst or skip" inbox card from it — and nothing has written it since the debate generator that
suspended on the choice was deleted. The `ReplacementOffer` type, the inbox arm and an unused
import in `useAnalysisPipeline.ts:7` went with it. Nothing user-visible changes, because the card
could never appear; what changes is that the approvals inbox no longer claims a second
producer-side flow it cannot have.

## 2026-10-19 — the step tracker was the sixth orphan, and it is user-visible

`useAnalysisPipeline` still minted four progress rows. Three had no writer left:
`gate-scan` and `debate` were never even started (`getGateAnalysis` was imported and
called by nothing), and `analysis` was started at the run's head and completed by the
engine, so a **successful** Full-analysis run left "Analyzing charts" spinning and two
rows pinned at pending forever. `AnalysisProgress` kept summary clauses for
`gate-scan`, `debate` and `validation` — the last dead since accuracy mode. No gate saw
it: the panel tests fabricate their own step lists, and a fabricated row with
`status: 'complete'` is exactly what a component test needs to stay green while the
product can never produce it.

Fixed by dropping the two rows for work that no longer happens (and the dead import),
summarising the two rows that do, and completing the run at the one choke point every
path reaches — the `finally`, which is now terminal-aware: the catch marks the failing
step and Stop marks the cancelled one *before* the sweep, so anything still open really
did succeed. That ordering is the whole difference from the sweep this file used to
warn about; `currentPhaseRef` (which existed only to pick between analysis and debate)
is gone, and the Esc-cancel toast no longer claims a debate was preserved.

`tests/analysisStepTracker.test.ts` pins all four claims on the real files, with a
planted control for each scan. Every `useAnalysisPipeline.ts` citation in the flow docs
and here shifted by its region delta (-1 / -6 / +9 / +7 / +9) and was re-printed against
the tree before landing; the 113 bare numbers in this ledger are ports and examples and
were not touched.

## 2026-10-19 — the peer review's six defects, re-checked against the tree, and the gate chain closed

Each review finding was re-opened in the CURRENT files rather than assumed closed:

| # | finding | state today, with the check that says so |
|---|---|---|
| 1 | Section D hid that the post-mortem route was **starved**, not deleted | closed — the doc now says so at `docs/app-flow.md` §D, and the guard it quotes is real: `if (pm.length < 40) return null` is `services/learning/SkillCraftService.ts:145` |
| 2 | dangling hashes `e2b3965` / `2095864` | closed — neither string appears in either flow doc any more; the only hashes cited are `03fc0d5` and `591f735`, and `git merge-base --is-ancestor` says both are ancestors of HEAD |
| 3 | stale anchors | closed by the gate, not by hand: 248 anchors verified, 0 unattributed, ceilings 46 comment-line / 16 symbol. **Those are the counts at that commit, not today's** — both ceilings have since been driven to 0 and the population is 247 (one stale stage row retired); the live numbers are in the resume-facts block below |
| 4 | cross-link resolved to `docs/debate-deletion-status.md` | closed — the link is now `(plans/debate-deletion-status.md)`, relative to `docs/`, and the broken form has 0 occurrences |
| 5 | `messageImageStore.ts` filed under `utils/` | closed — the table row names `services/infrastructure/messageImageStore.ts`, which is where the file is |
| 6 | `ChatComposer.tsx:160` for the Enter key | closed — the doc cites `:146`, and line 146 is `if (ev.key === 'Enter' && !ev.shiftKey)`. The doc no longer cites an AgentsView Enter line at all |
| 7 | not in the review, found while answering it: `AGENTS.md` said the release gate "runs the same static + probe chain" | closed as a doc fix, not a CI change — `AGENTS.md` now names the asymmetry with the `comm -13` recipe that prints it: release lacks `check-flow-doc-anchors`, `skill-approval-probe`, `test` and bare `typecheck`, and adds `installer-smoke`. **The owner still owes the other option** (add the anchor step to `release.yml`), which would change what a tag push gates |

Two review items stay honestly open. "One service replacing nine" is unfalsifiable as
written and no gate can settle it. Section C's eight-stage ordering is deliberately
unanchored: those are the lines stage 19 deleted, so an anchor there would have aged
within hours — the page says this in its own header.

Gate chain now run against this tree, each read from its own marker rather than a
piped exit code: typecheck, typecheck:scripts, eslint on changed files (0 errors),
vitest (477 files passed, 1 skipped), the flow-doc anchor gate (14 reach controls),
`vite build` (BUILD_EXIT=0), boot-probe on the built bundle (BOOT_EXIT=0, zero
pageerrors), render-probe (RENDER_EXIT=0, zero pageerrors), Playwright e2e
(5 passed, E2E_EXIT=0). `installer-smoke` remains CI-only on purpose — it is the
gate that measures the signed artifact.

Open engineering on the gate itself, and the shape of the last unsolved pairing. A
citation whose symbol is named on the PREVIOUS line (the "`sym` at / `path:NNN`" list
shape) is bound forward by a test on the current line's tail. That test is weak in BOTH
directions, measured 2026-10-19 with the patch parked at `.probe-artifacts/connector-widening.patch`:

- **It over-matched — fixed the same day, with the proof on both sides.** The connector list
  had no word boundary, so `…does read it. That` ended in a suffix that read as `at` and the
  row was treated as dangling: 42 lines across the three docs end in a word whose tail is
  at|is|to (16 of them just "that", plus into, seat, analysis, this, Chat, onto). Requiring
  whitespace before `at|is|to` fixed it, the legitimate "`SYM` at" shape is untouched (29
  lines end in " at"), and the fix immediately surfaced one pairing the old rule had been
  abstaining on — a ledger census row that cited a live line number for a reader of a field
  this pass deleted. That row now names the file, not the line. Two reach controls hold the
  fix: they fail on the unbounded regex (verified by reverting it in tree and reading the
  FAILED line) and pass on the bounded one.
- **Widening the tail does not help.** Replacing the list with "the line ends without a
  sentence terminator" produced 8 false symbol misses, all the same class: markdown
  paragraphs WRAP, so an ordinary prose line ends mid-sentence constantly. Tightening to
  "at most two tokens after the last span" took it to 2, and the remaining 2 are a third
  class the tail regex cannot see at all: a line that carries a citation AND a bare symbol
  *after* that citation (the Session Usage row, and the `replacementOffer` census row). The
  symbol belongs to the next line's number; the line view binds it to its own.
- **The next step is positional, not lexical.** A symbol whose span starts AFTER a
  citation on the same line cannot own that citation — bind by position within the line and
  drop the tail heuristic, then re-measure. Until then the ceiling stays at 0 and the two
  rows above stay honestly unpaired, which is what the forward-binding caveat is for.

The arrow table's own line-level claims all check out, and the reach controls prove each
arm fires: 17 before this fix, **19 now** (the two boundary arms above), and 24 with the
widened tail rule tried today — that last arm-set is parked in
`.probe-artifacts/connector-widening.patch`, not shipped, because the two pairings the
widening newly bound are dated ledger claims whose symbols this pass deleted, and the
gate cannot tell a historical sentence from a live claim.

**Why "just bind by position" is not a one-line change, worked out on 2026-10-19 so the
next attempt does not rediscover it.** The pairing decision compares the symbol's offset
with each citation's offset, but the two loops do NOT live in the same coordinate space:
`symbolOf` and `spanAnchors` read the RAW line (html `<code>` spans only exist there),
while the `OWNER_RE` and `BARE_RE` loops that push anchors scan the STRIPPED line. After
today's tag fix a stripped html line is shorter by every tag it held, so a raw offset is
meaningless against a stripped offset and comparing them mis-binds silently — which is
exactly the failure class this rule is meant to eliminate. Two viable shapes:

- Zip in order instead of comparing offsets: raw `OWNER_RE` matches and stripped `OWNER_RE`
  matches are the same tokens in the same order (only tags differ), so build the raw start
  list once per line and consume it with a counter as anchors are pushed. Breaks if any tag
  removal ever deletes a digit — assert the two lists are the same length and abort to
  abstain (never mis-bind) if they are not.
- Or strip tags to a SPACE-PADDED equal-length string (replace each tag with the same number
  of spaces rather than one), so raw and stripped positions are identical by construction and
  every existing offset comparison stays valid. This is the smaller, more testable change and
  it also removes the reason the two coordinate spaces ever differed.

Either way: a symbol whose span starts AFTER a citation cannot own it (that row's number is
the previous row's), a symbol BEFORE it owns it, a crowded line with more than one of each
abstains, and the reach controls must include an html fixture — every control written so far
uses markdown backticks, where raw and stripped are the same string, so no existing control
can see this bug.

**Attempted and reverted the same day, with the reason (so the next attempt starts here, not at
zero).** Padded strip landed (`11bb0078`, scan byte-neutral at 253 unique / 539 references), then
positional binding was implemented and measured: **5 symbol misses and 3 failing controls**, so it
was reverted. The bug is in the dangling test, and it is a real design error worth naming: I used
`citPos.every(c => c < symPos)`, i.e. "a row is dangling if SOME citation precedes its symbol".
Section H's arrow rows are multi-citation — one row reads "`SYM-A path:a`, `SYM-B` at" — so a
trailing `SYM-B` made the whole row dangling and the PREVIOUS row's symbol was pushed onto the
current row's first citation. Every pairing shifted one row early:
chatTurnRunner 929 got `createDebateMailbox` instead of `runSeatTurn`, 1006 got `planPanelTurn`
instead of `createDebateMailbox`, 1018 got `send` instead of `planPanelTurn`, 784 got
`runFullAnalysis` instead of `send`, and TradeChatPanel 547 got `MAX_PLANS_PER_RUN` instead of
`runFullAnalysis` — five misses, all the same off-by-one, and the code is a dead giveaway that the
rule is wrong rather than the docs. The correct predicate is per-citation, not per-row: a symbol
owns the citations that follow it and carries to the next row ONLY IF it is the last span on the
line and the line has no other unclaimed citation before it; multi-citation rows must be split
into (symbol, citation) pairs by order within the line, which is what the span view already does
for `SYM path:NNN` inside one span and what the line view still cannot do. Until that pairing is
written, the boundary-fixed allowlist stays.
**Second attempt the same day: the off-by-one was a carry-ordering bug, and fixing it drew the
line under which pairing is sound.** `symFor` closed over `carrySym`, which was overwritten
BEFORE the anchors were pushed, so each row read its own trailing symbol as the incoming
carry. Reading the incoming value first removed the off-by-one entirely — the five section-H
arrow rows pair correctly and all 20 controls still pass, the forward-binding fixtures
included. It then bound 9 citations the lexical test had abstained on, and none of those are
doc errors: `enabled` in "rides `enabled`, not a 4th status", `ReferenceError` in a prose
aside, `isChartAnalysisRequested` and `reconstructOpenings` in sentences that name a deleted
thing while citing something else. A backticked word is not a symbol claim, and position
alone cannot distinguish one — what makes the SPAN view sound is that the symbol and the path
share one span, which the line view cannot require without discarding most of its coverage.
So this is a settled design boundary, not an unfinished task: the line view keeps the
boundary-fixed allowlist, positional pairing stays where it is sound, and the enabler that
is kept is 11bb0078, the length-padded strip (behaviour-neutral on its own, verified: same
253 unique / 539 references, both ceilings 0, 20 controls). Until that html-arm control exists, do not trust a positional rule at all.

**A second hole, found while widening: the gate has never been able to see a citation to a
deleted file.** `collect()` resolves each qualified path and `continue`s when nothing matches, so
`rep.missingFile` could only fire for a file that resolved at collect time and vanished mid-run —
i.e. never. Implemented the detection and ran it (parked as a clean-applying patch,
`.probe-artifacts/deleted-file-citations.patch`, 72 lines): **3 hits in this ledger and 12 in the
flow html — and all 12 html hits are a scanner defect, not a doc defect.** `strip()` deletes html
tags without leaving a separator, so a `<b>App</b>` running into `<i>index.tsx:73-79` becomes the
token three such glued tokens were produced across the flow html — none of them names a real file, and each one silenced a citation that should have been checked The consequence is worse than the false positives: those 12 citations fail
`resolve()` today, so they have never been checked for resolution, non-blank or comment-line at all.
Work order: make `strip()` emit a space per tag and confirm the anchor population does not move;
then re-apply the detector and expect ~15 real findings; then retire the ledger's historical line
numbers the way the approval-inbox census row was retired today. LANDED THE SAME DAY, in the other order: fix strip() first (the scan went from 513 references / 247 unique to 538 / 252, and the wider scan itself failed the gate until five stale citations were retired: `App:2041` was a comment about chatModelFallback and now points at the mount at the mount site; the quick-reply row bare-numbered 1350 when the call is the quick-reply call site; the bot fork bare-numbered 431 when `if (config.botId)` is the fork line; and `ensureStamp` was paired with `runPresentTrade` line 75 though it is defined at the gate file where it is defined), then apply the detector. Measured with it live: 0 deleted-file citations in the flow docs, 6 in this ledger — the verdictFinalizer and CalibrationSection rows name files this run deleted, and three are the glued examples quoted above. A live-doc hit fails the merge; a ledger hit is recorded history and ratchets down only.

## Resume facts, 2026-10-19 end of session — read this before exploring anything

**Two questions, one word each. Everything else in the backlog is closed.**

1. #19 — **When you press "Full analysis", how many minds should answer?** Today one
   request can still be answered by several models at once in the panel chat, left over
   from the debate. Either keep that (it works, it just isn't a debate any more), or make
   the dock answer with the single model you picked, like the chat box does. Choosing
   "single model" is two passes, not one: the panel itself, then the flag that tells
   already-saved conversations they were multi-model — those old rows must keep showing
   what they were.

2. #21 — **Should old post-mortems and old debate transcripts still be readable?** A
   closed trade can still carry a written post-mortem, and an old conversation can still
   carry its debate transcript. Nothing writes either any more, but five places still
   *read* them: the drift chart, the monthly report's debate line, the "what the analysts
   said first" opening in watch runs, and the count in the exported report. So today they
   are a museum of pre-2026-10-18 runs that nothing new will ever join. Deleting the
   fields means deleting that history too — that is the part your earlier "delete fields
   + readers" ruling did not say either way.

**Also open, owned by nobody yet:** the calibration ledger
(`CalibrationLedgerService` + `calibrationStore/policy/prompts`) is still an unresolved
product decision; the anchor gate's other ceiling, 46 citations landing on comment
lines, is a measured backlog that ratchets down only; and a citation whose symbol is
named on the line ABOVE its citation is now paired forward, but the connector test
matches `at|is|to|→|->|–|:` only after a non-space, so a shape using another connective
would still abstain. The 46 remaining each need a hand look: the retired scratch helper
`retarget.cjs` prints, for every flagged citation, the nearest non-comment line in that file
that carries a symbol the doc line actually names.

**The anchor gate grew a census half (2026-10-19).** It now re-runs the RECIPES these
docs quote instead of trusting the figure printed beside them: both post-mortem grep
censuses, the size of the arrow table, and the provider-directory deletion list — checked
name by name against `git log --diff-filter=D`, which is the direct answer to the outside
review that called "one service replacing nine" unfalsifiable. Four control arms failed on
the day the rule was written and every one of them was right: a tag-stripping regex applied
to MARKDOWN ate whole paragraphs (a `<` in a .md is prose or a placeholder like
`class <ProviderName>Service`), which made the rule report a clean zero over an EMPTY
population — the population floor is what exposed it; `(\w+)` captured `four` out of
`Twenty-four` and accused a correct sentence; a name lookahead `(?![.\w])` dropped the LAST
item of a comma list, so the doc's own nine deletions read as eight; and the md's
88-column wrap broke every multi-word pattern until each was rewritten with `\s+`. None was
absorbed by loosening a claim. Two limits stay open and are named rather than hidden: the
provider sentences bind only their FIRST match, so a duplicated copy of one of those claims
would go unchecked until those become `matchAll`; and the git-history half prints SKIPPED on
a shallow clone (CI's checkout is depth 1) rather than reporting zero findings.

**New finding, 2026-10-19 (later): the prompt registry was never re-measured.** Settings →
Prompts lists 27 overridable prompts; `tests/promptsAreWired.test.ts` measures 16 with no
`getPrompt('<id>'` call site anywhere in live source — all 12 `debate.*`, `analysis.families`
and 3 `postmortem.*`. Each such entry is a UI that accepts, stores and validates text the app
never sends; the `debate.moderator_autoplay` fallback also still tells a model to follow
"Accuracy Mode checks" and emit a debate envelope, both deleted. The unreachable count is a
ceiling that ratchets down only, and the 11 wired ids must keep their call site (red-proved by
renaming one `analysis.master` argument → 5 arms failed, and by tightening the ceiling by one).
Deletion is the next pass: the 16 entries plus the prompt constants whose only importer is
`constants/promptRegistry.ts` (measured: 15 of `debatePrompts.ts`'s exports have zero consumers
at all, the rest reach code only through the dead entries). One dependency to resolve first, and
deliberately NOT loosened here: `tests/harnessMarks.test.ts` binds its "prompts that claim the
user role must quote the real harness mark" and "USER STEERING" arms to
`constants/prompts/debatePrompts.ts` by path — deleting that file empties their population, so
those two arms must move to whatever prompt files are still sent before the file goes.
Three stale labels were fixed in place: `hooks/useAppSettings.ts` and
`components/settings/SettingsMenu.tsx` headed live state/props as "Accuracy Mode", and
`hooks/useAnalysisPipeline.ts` carried an eslint directive naming the deleted
`verdictFinalizer` as the consumer of `casualMessageId` — the variable is read at
`mapRunFailureMessages`, so only the comment was wrong.

**Gate state on this tree, each read from its own marker, not a piped exit code:**
Re-run here: typecheck, type-check-scripts, electron parse (both re-run on this tip: `tsc --noEmit` clean,
`node --check` on all three electron files clean), flow-doc anchors (286 verified, — the same figure as before, reached by a different set of anchors,
0 unattributed, **0** comment-line and **0** symbol misses — both ceilings now zero, with 5
citations listed as deliberate comment-as-claim exemptions — **0** census disagreements, and
**0 of 6** AGENTS.md control arms failing, the new half that measures `AGENTS.md`'s own counts:
smoke tests from `e2e/smoke.spec.ts`, the vitest census against `git ls-files tests`, and the
workflow-asymmetry step names as whole tokens inside the paragraph that prints its own `comm -13`
recipe), vitest re-run on the tip AFTER the prompt deletion and read out of the log's own summary block:
`Test Files 478 passed | 1 skipped
(479)`, `Tests 4730 passed | 11 skipped (4741)` — the skipped file is
`tests/lensWordCount.measure.test.ts` (11 measurements, skipped by design),
lint (0 errors / 681 warnings under the ratchet — CI's step is now runnable
locally because `docs/analysis/**` is ignored as the untracked scratch it is),
`vite build`, boot-probe, render-probe, Playwright e2e (5 passed), and the
skill-approval probe — whose own log says `25/25 checks passed; pageErrors=2`.
The two "notebook write FAILED (quota)" lines under that verdict are the probe's
own injected fault: the write-failure surfacing is what it is testing, so they are
the pass, not a failure. `installer-smoke` is CI-only by design.

**Every gate above was re-executed on this tip, not carried over (2026-10-19, after the prompt
deletion).** The earlier version of this paragraph said the browser probes were carried because
`git diff` between the probed tip and HEAD touched only docs and the gate script — that reasoning
was sound then and is void now, because this stretch edited real source: `promptRegistry.ts`,
`prompts/debatePrompts.ts` (deleted), `prompts/index.ts`, `prompts/analysisPrompts.ts`,
`prompts/harnessContract.ts`, `constants/debateMarkers.ts` and `useAnalysisPipeline.ts`. The
bundle is therefore not the bytes the previous probes passed on, and "carried over" was replaced
by running them: `vite build` ✓ 34.07s, `boot-probe` OK (zero pageerrors), `render-probe` OK
(zero pageerrors, all four nav surfaces, the coin pick still reaches the chart), Playwright e2e
5 passed in 15.3s, `skill-approval-probe` 25/25 with its own two injected quota faults, repo-wide
lint 0 errors / 681 warnings under the 889 cap. The rule that made this visible: a carried-over
claim is only honest while the diff behind it is provably inert, and the first source edit
revokes it.

**Do not re-derive these** (each cost a turn this session and is already proven): the
review's six defects are all closed in the current files; **and the item it filed as
"Not verified" — section C's ordering — turned out to carry nine wrong line numbers.** The
fetch gate is `hooks/useAnalysisPipeline.ts:970` (the docs said line 880 in one file and line 880
in the other, and `:890` is the automation mute flag, not a gate); the injection string is
built at `:953` (preset path `:994`, not `:988`); it is read only by `devLog` at `:978`, `:979`
and `:1166` (not `:973`/`:1160`); `assemblePipelineMemoryContext` is called at `:1021` with the
packet at `:1024` (not `:1047`); the hybrid loading flag is `:863` (not `:890`). Two docs that
described the same residue disagreed with each other, and the gate passed both: a citation
only binds to a symbol when the doc names one on that line, and these sentences named none.
Restating them cost one more failure of my own — the new `:1024` first bound the neighbouring
function name and then sat unqualified on a line that named no file. Both were caught by the
run, not by reading. the post-mortem route is
**starved, not deleted** (the guard tests the length of the field, and `docs/app-flow.md` §D carries the exact line); `reconstructOpenings`,
`utils/debateResume` and `confidenceAccuracy` exist nowhere in the tree; the census
recipe is `grep -rE` over `.ts/.tsx` (122 lines / 50 files for the token, 34 / 23 for
the field reads); `MAX_PLANS_PER_RUN` is `services/trade/automationTurn.ts:69`; and the
progress panel now mints two rows (`market-data`, `analysis`), completed by
`settleOpenSteps()` in the run's `finally` after the catch has marked any failure.

**Push state:** 101 unpushed commits at this tip (measured as `git rev-list --count
origin/main..HEAD`, which is the only honest way to state it — the count grows with
every commit, so re-measure rather than trust this number), nothing pushed this
session; the earlier authorization covered only the first 16.

## 2026-10-19 — a seventh orphan, turned up by re-measuring the census this doc quotes

The flow doc's field census is reproducible **only with the word boundary**:
`grep -rE "\.postMortem\b"` over `.ts/.tsx` gives 34 lines in 23 files. Drop the `\b` and it
gives **38**, and the four extras are a different field — `postMortemCreatedAt`, the
timestamp twin. Counting it is not pedantry: it is the difference between a census of the
dead field and a census that quietly includes a live-looking one.

All 11 mentions of `postMortemCreatedAt`, enumerated rather than sampled: two are the
declarations at `types/message.ts:153` and `types/trade.ts:78`; four are
`tests/pointInTime.test.ts:30` and its neighbours, which are the **only writers anywhere in
the repository**; the remaining five are production reads at
`hooks/analysisPipeline/memoryContext.ts:182`,
`services/learning/DecisionReflectionService.ts:24`, and
`services/ui/AlgorithmicSummaryService.ts:50`. No quoted-key or shorthand write exists, so
nothing has set this field since the post-mortem writer went.

Two consequences, and they are different in kind:

1. The two fallback readers still work but measure the wrong thing.
   `memoryContext.ts:183` and `DecisionReflectionService.ts:24` both read
   `x ?? t.timestamp`, so lesson age and the point-in-time memory slice are now computed
   from the trade's own time rather than from when the reflection was written. Nothing
   errors; the meaning is gone and the number keeps coming out.
2. `AlgorithmicSummaryService.ts:50` gates on
   `if (trade.timestamp && trade.postMortemCreatedAt)` with no fallback, so its
   "reflected N minutes after close" line **can never appear for a trade closed after
   2026-10-18** — while it still appears for older rows from the journal. Dark on new data,
   alive on the museum.

This widens the #21 question, and in the direction that matters to the trader: the stored
history has one more visible surface than the five readers counted, and it is a line in the
monthly summary, not an internal field. Choosing "keep it readable" means restoring a
producer or accepting the summary's silence going forward; choosing "delete it" means this
gate and its fallback readers go with the fields. Deliberately NOT fixed here — removing
the dead branch is the decision, not a cleanup, and the fallback readers would change what
every later learning turn measures.

**The user-role harness note had no live teacher (2026-10-19, later).** `harnessTurn()` is
called at four desk-tool sites to stamp `HARNESS NOTE (this app, not the trader):` into
user-role content, and the only prompts that ever named that marker were the debate prompts —
unreachable after stage 19. Clause 5 of `constants/prompts/harnessContract.ts` now carries the
rule (obey its facts; never read it as the trader's request or as new permission to trade;
unmarked text outranks it on conflict), quoting `HARNESS_TURN_MARK` by interpolation so the
sentence cannot drift from the emitted bytes. `tests/harnessMarks.test.ts`'s two path-bound
arms moved onto the blocks the app actually sends, with the floor re-based on that population
and a planted-paraphrase control added, since a scanner matching nothing reports no drift. This
unblocks the debate-prompt deletion, which was held back precisely because those arms were the
file's last consumer.

**The 16 unreachable prompt entries are deleted (2026-10-19).** `constants/promptRegistry.ts`
is now the 11 ids a call site reads and `tests/promptsAreWired.test.ts` holds the unreachable
ceiling at 0, so a future entry must ship with its `getPrompt(id, fallback)` caller.
`constants/prompts/debatePrompts.ts` and its barrel line are gone — with one exception that the
compiler, not the grep, caught: `HybridIntelligenceService.ts:98-99` imports
`INVALIDATION_THESIS_PROMPT` and `CORRELATION_AWARENESS_PROMPT` from `../../constants/prompts`,
so those two blocks moved verbatim into `constants/prompts/analysisPrompts.ts` and the importer
is untouched. My per-name consumer scan had reported them as registry-only, which is the
same mistake the zero-importer rule warns about, seen from the other side: the reference lived
in a barrel re-export, not next to the definition. `tests/promptOverrideService.test.ts` also
had to change: its "resets a single override" case used the dead `debate.rebuttal` as its second
prompt, and after a blanket rename both halves pointed at one id — a two-id store test that
asserts one id proves nothing, so it now uses `analysis.lens` and `analysis.master`.
Gates: tsc 0, promptsAreWired + promptOverrideService + harnessMarks + composePrompt 55 tests
green, flow-doc anchors 253 verified with 0 census disagreements, full suite read from its own
summary marker (`Test Files 478 passed | 1 skipped`, `VITEST_EXIT=0`, zero `x` lines), and
`npm run build` — which is the gate that matters after removing a module, because a dynamic
`import()` or a barrel re-export can break the bundle while tsc stays silent: `✓ built in 34.07s`.
`constants/debateMarkers.ts` also lost a comment naming the deleted prompt file as its other
half; the markers it owns are now the only home for both the strings and the matchers.

**Second-order leftovers from the prompt deletion (2026-10-19, later same day).** Removing a
registry row can orphan the constant it alone imported: `STRESS_TEST_PROTOCOL`,
`PROBABILITY_ESTIMATION_PROMPT` and `TRADING_FAMILIES_PROMPT` in
`constants/prompts/analysisPrompts.ts` fell to zero references outside their own definition
file and are deleted (proved by `tsc` and `vite build`, since the barrel can hide a consumer —
the exact trap that had already saved two other constants on this pass). Three debate-era names
were then re-checked rather than assumed dead, and the answer differs for each: `moderatorConfig`
is live as the DEFAULT provider behind vision/OCR (`App.tsx:311`) and memory (`App.tsx:550`) and
as the automation seat and the journal's `Mod:` label; the `<CLARIFICATION_*>`/`<MODERATOR_RETRY>`
matchers in `constants/debateMarkers.ts` are live as sanitizers at `utils/analysisUtils.ts:859`,
while no prompt file mentions either marker any more. Both facts, plus the "no moderator TURN
exists" distinction, are now stated in the flow docs.
Gates on this tip: full suite `478 files passed | 1 skipped`, `4730 passed | 11 skipped`, 233.18s;
tsc 0; `vite build` ✓; flow-doc anchors 261 verified, 0 unattributed, 0 census disagreements.

**Section H measured the same way, and it does not all check out.** The arrow table is 53 rows; 28 of them cite a
file at all, and only 5 write the symbol beside the citation — the only shape the gate can bind to content.
So 48 rows are line-resolved and nothing more, and the run prints `arrow coverage: 5/53` with a floor on both
figures so coverage cannot fall silently. Row 7 came out wrong outright: the lazy-surface `SurfaceSkeleton`
boundaries are App.tsx:153 TradeView, :2373 Journal, :2395 LearnView, :2411 StrategyStudio plus the
automation modal at :2298 — not the :2493/:2538/:2560/:2602 the table had, which are a prop, a component
open tag and two unrelated lines. Those five are now cited with the symbol beside each path. Raising coverage is per-row verification work, not a rule change, and the docs say that
instead of implying the table is checked.

**Then 5 became 14.** Nine more rows were rewritten into the bindable shape, each only after its symbol was
found on the line it cites: the `index.tsx` mount chain (StrictMode :73, ErrorBoundary :74, ToastProvider :75 —
the old `73-79` range proved nothing), `august_surface_v1`, `onSendBotTurn`, `onAnalyze`, `handleRunAnalysisFromChat`,
`runFullAnalysis`, `runSeatTurn` at both :593 and :1082, `applyCasualStreamUpdate`, `notify`. Binding found another real
defect: row 13 cited AgentsView.tsx:725 for `onAnalyze`, and the await is at **:722** (:725 is the `finally` of that
same try) — fixed in both flow docs. Coverage now prints 14/53 with 22 pairs and a floor of 14, and 39 rows remain
line-resolved only.

**Coverage 14 became 23, and it cost the docs three more wrong numbers.** Binding a row to its symbol means reading the line, so ten more rows
went through the source: `runAutomation` is hooks/useAutomations.ts:381 (the table said :389), the `config.botId` fork is
:423 (it said :431), and the row that attributes `Message.proposal` to the pipeline cited line 1293 of that
file — a ternary arm — while the stamp is at hooks/useAnalysisPipeline.ts:1349. All three fixed in both flow docs. Newly bound and verified true:
SURFACE_ITEMS components/shell/SurfaceMenuList.tsx:44, the Enter branch at
components/trade/panels/ChatComposer.tsx:146, systemPromptFor components/trade/TradeChatPanel.tsx:453 with
TRADE_CHAT_SYSTEM_PROMPT components/trade/TradeChatPanel.tsx:475, useBotThread hooks/useAnalysisPipeline.ts:1292,
entriesForSession services/trade/chatSessions.ts:531, chatSurfaceSystemPrompt services/trade/chatSurfaceTurn.ts:165
with CHAT_SURFACE_SYSTEM_PROMPT constants/prompts/chatPrompts.ts:40, MAX_PLANS_PER_RUN
services/trade/automationTurn.ts:69, MAX_PLANS_PER_DAY services/automation/AutomationService.ts:113, notices
services/trade/automationTurn.ts:155, latestChartVerdict services/trade/chartData.ts:95. The gate prints
23/53 with 37 pairs and a floor of 23; 30 rows remain line-resolved, and those are where the next wrong number
would still be invisible.

**Coverage 23 became 28: every arrow row that cites a file is content-checked now.** Binding the last five
produced one more wrong number: row 6 cited App.tsx:2336 for the guard `surface !== 'agents'`, but that line is a
prop — the guard is at **App.tsx:2298**, 38 lines away. Also bound and verified against the source:
parseAppHash hooks/useSurfaceRouter.ts:101 with serializeAppHash :159, the `AgentsView` element opening at
App.tsx:2436, `TradeChatPanel` rendered at components/trade/TradeView.tsx:1115, and the two row-minting calls
withDetectedTradeType hooks/useTradeLogging.ts:368 and :665. What the gate still cannot reach: the 25 rows that
name no file at all, and the docs say 28/53 rather than claiming the table is fully checked.
## Which gates actually ran at this tip (2026-10-19, after the arrow-binding passes)

The paragraph above this one says every gate was re-executed, and it was true of the tip it was
written at (`8e4808a1`). Seven commits have landed since, so the claim was re-measured rather than
inherited. The recipe is the diff itself:

```bash
git diff --name-only 8e4808a1..HEAD
```

which prints exactly five paths — `AGENTS.md`, `docs/app-flow.md`, `docs/app-flow.html`,
`docs/plans/debate-deletion-status.md`, `scripts/check-flow-doc-anchors.cjs` — and nothing else.
So: re-run here and green were `check-flow-doc-anchors` (284 284 anchors, 0 unattributed, 0 comment-line,
0 symbol misses, 0 census disagreements, 0 of 6 AGENTS arms failing, arrow coverage 28/53 with 44 pairs
and 0 control failures), `npm run lint` (0 errors / 681 warnings under the ratchet) and
`npm run typecheck:scripts`. Then the three cheap ones were re-executed at HEAD anyway rather
than left on inference: `npm run test` reads `Test Files 478 passed | 1 skipped (479)` and
`Tests 4730 passed | 11 skipped (4741)` — which is the census `AGENTS.md` states, confirmed by the
run and not only by arithmetic — `npm run typecheck` exits clean, and `vite build` succeeds in
10.53s. Then the four browser gates were run here as well, so nothing on this page is inferred:
`boot-probe` → "prod bundle boots, trade surface + Chart AI dock render, zero pageerrors";
Playwright `e2e` → "5 passed (13.9s)", which is the smoke-test count `AGENTS.md` states;
`render-probe` → every exchange renders and keeps its earlier rows in both conversation surfaces,
malformed audit data drops no row, all four nav surfaces mount, Settings → Data backs up, exports
and imports, **zero pageerrors**; `skill-approval-probe` → "25/25 checks passed; pageErrors=2".
Each verdict was read from its own log line, not from a wrapper exit code.
The `8e4808a1` diff recipe above is still worth keeping — it is the REASON these runs could not
have been affected by the seven doc commits, and the reason a future reader need not re-run them
when the diff is likewise inert. The `[MemoryFiles] notebook write FAILED` lines inside the vitest
and skill-approval output are those suites' own injected quota faults — the write-failure
surfacing is the thing under test, so they are the pass, not a failure, and the probe's
`pageErrors=2` is the same pair.

This is the same rule that revoked a carry-over earlier in this session — a carried claim dies at the
first source edit — stated now in the direction that matters: the diff is what makes it survivable, and
the command that prints it belongs in the record so the next reader can re-run it instead of trusting me.
## The absence claims were re-grepped (2026-10-19)

Line numbers prove where something IS. The flow docs also make present-tense claims about things that
ARE NOT there — no writer, zero callers, not rendered — and no anchor rule can see any of them. Each was
re-measured over the production roots (`hooks services utils components App.tsx constants`, plus `electron`
where relevant), not re-read:

| claim | recipe | measured |
|---|---|---|
| `beginPromptLane` has zero callers | `grep -rn beginPromptLane hooks services components App.tsx utils constants` | 2 hits: the import line and its own `export const` — no call site |
| the prompt lane still settles | `grep -rn endPromptLane …` | 3: import, the settle call `settleOpenSteps useAnalysisPipeline.ts:1482` inside the finally, the definition |
| `savedAnalyses` was deleted outright (stage 21) | `grep -rl savedAnalyses --include=*.ts --include=*.tsx . \| wc -l` | **0 files** — field, state, SQLite read/write, backup validation all gone; the surviving mentions are in the untracked `docs/analysis/` census, where every count is already 0 |
| `NavRail` is imported and never rendered | `grep -rn "<NavRail" …` | 1 hit, and it is the generic `<NavRailProps>` on its own definition line — no JSX use anywhere in production |
| post-mortems are gone | `grep -rn usePostMortem conductPostMortem …` | 1, a comment in `services/learning/SkillMemoryService.ts`; 0 for `conductPostMortem` |
| all three turn owners record usage | `grep -rn recordToolTurnUsage …` | 3 call sites (`chatSurfaceTurn.ts:338`, `automationTurn.ts:262`, `chatTurnRunner.ts:709`) + the definition at `utils/sessionUsage.ts:63` |
| one notifier | `grep -rn CompletionNotifications …` | 1, a comment in `services/infrastructure/notify.ts` — the module itself was deleted, which is stronger than "no caller" and is now what row 52 says |

One sentence was tightened rather than corrected: row 52 said `CompletionNotifications` "has no caller",
which understates the truth — the file is gone and only a comment mentions it. Everything else held.
The point of printing the recipes is that an absence claim is exactly the kind of sentence that rots
silently: a reader-less field can regain a writer with one line of code and no anchor moves.

**Arrow coverage 28 became 31.** Three prose-only rows gained verified citations (saveSessions
services/trade/chatSessions.ts:419, collectApprovalItems utils/approvalInbox.ts:57, resolveInvokedSkills
services/learning/SkillMemoryService.ts:494), and the gate caught the pairing that insertion created: the row
also names approvalsWaiting, which is not on that line — a SYMBOL MISS. It now cites App.tsx:1816, where the
useMemo actually is. 31 of 53 rows cite a file, all bound; 22 name no file at all.

**Arrow coverage 28 became 31.** Three prose-only rows gained verified citations (saveSessions chatSessions.ts:419,
collectApprovalItems approvalInbox.ts:57, resolveInvokedSkills SkillMemoryService.ts:494), and the gate caught the
pairing that insertion created: the same row also names approvalsWaiting, which is not on that line — a SYMBOL
MISS, because pairing is positional. It now cites App.tsx:1816, where the useMemo actually is. 31 of 53 rows cite
a file and every one of them binds a symbol; 22 name no file at all.

**31 then 33.** Two more prose-only rows were bound after reading their source: deskThread is the export at
utils/agentThreads.ts:118 and useLearningHeartbeat the hook at hooks/useLearningHeartbeat.ts:42. Rows citing a
file: 33, every one bound; 20 rows name no file, floors moved to 33.


**Coverage round: 33 to 43 of 53 arrow rows (2026-10-19, after the peer review said the table beyond its probed subset was unverified).** Eleven more rows now name the symbol their citation must land on, and each line was looked up in the source first: the two error handlers in the entry file, the surface router, the mailbox pair, the two store writers, the desk-tool and panel-tool executors, the routine runner, the group-rooms pair, the skill-approval function and the profile-persistence hook. Two of those bindings were rejected by the gate rather than accepted: a row that carries a SECOND uncited symbol makes the gate bind the citation to the wrong name, because attribution is one symbol per ROW, not per code span, so the panel-tool row and the bot-routine row were rewritten to hold exactly one symbol each. The gate now measures 296 anchors and the coverage floors moved from 33 to 43 — tightened, never loosened. The 10 rows still outside the rule name no file at all: storage keys, wire formats and prose, and both flow docs say that instead of claiming 53 of 53.


**Coverage round 43 to 48 of 53 arrow rows (2026-10-19).** Five more rows became content-checked: the journal writer, the dev-proxy middleware route in the vite config, the desktop IPC handler, the prose-to-plan reader and the usage recorder. Each had to be rewritten rather than merely cited, because symbol attribution is one symbol per row, so a row holding a second code span binds the citation to the wrong name and every other symbol in those five rows became plain text. The gate now measures 300 anchors and the coverage floors moved from 43 to 48. Five rows stay outside the rule: the ensemble row deliberately claims no stage number, and four rows name a service whose declaration line was not looked up this round, so no line was invented for them.


**Coverage round 48 to 50 of 53 arrow rows (2026-10-19).** The provider-roster writer and the reasoning-delta writer are content-checked now, each cited at the declaration line that IS the row claim: saveProviderConfigs in the provider-config module, saveThinkingBatch in the thinking store. The reasoning row had to give up three service-name spans, because one row carries one attributed symbol. The notebook-tier row stays unbound on purpose: its declaration line was not located before this commit, so no number was invented for it. The row is not wrong though — the three modules it names were each checked in the tree, memoryBudget.ts in utils/ and memoryHealth.ts plus MemoryFilesService.ts in services/learning/, so the omission is only that the row is not line-checked yet. The gate measures 302 anchors and the coverage floors moved 48 to 50. A restatement bug of my own made this round longer than it needed to be: a replace with a non-global regex patched only the first of two identical sentences, so the quota rule kept failing while I assumed both had moved.


**Coverage round 50 to 52 of 53 arrow rows (2026-10-19).** The last two rows that named a module with no line are content-checked now. The provider row cites the import itself, line 29 of GenericProviderService, because the shared wire policy is exactly what the row claims — a call-site number there would have asserted a per-request detail the row never makes. The notebook row cites notebookPressureAllows, the gate a write consults before the notebook may grow. Both rows released their other code spans, since one row carries one attributed symbol, so the sibling modules are plain paths now. Only the ensemble row stays uncited, and the doc states why: no stage is named in the code, so no line number is claimed. The gate measures 304 anchors and the coverage floors moved 50 to 52.


**Resume state (2026-10-19, end of this session).** Arrow coverage measures 52 of 53 rows content-checked, and the one uncited row is the ensemble row, which claims no stage number because the code names none. Three decisions belong to the owner and nothing further moves without them: whether the still-live ensemble leg stays, whether the release workflow gains the flow-doc anchor step that only CI runs today, and whether these commits get pushed. Two review items are unproven rather than unaddressed: that the browser gates wait on the splash node, and the count of provider clients that replaced the deleted per-provider services, which the reviewer called unfalsifiable — making it falsifiable means adding a census recipe this gate re-executes, the same shape as the existing provider-deletion census. Figures quoted here are a dated record; the two flow docs carry the live claims.


**The last unverified review item is now measured (2026-10-19): do the browser gates wait on the splash node?** Yes, both of them, and each is cited to the line that does it. boot-probe clears the splash with `waitForFunction scripts/boot-probe.cjs:119` — the predicate is that no #splash element remains — and then waits for the lazy Trade surface at `waitForSelector scripts/boot-probe.cjs:122`, which is the pair the probe was written for (the v1.0.20 symptom WAS a splash hang, so waiting for the splash to vanish is the assertion, not a nicety). The e2e smoke does the same from the other side: `toHaveCount e2e/smoke.spec.ts:54` inside the workspace seeder, and again per-test at `toHaveCount e2e/smoke.spec.ts:140`, both asserting the #splash node is gone after React mounts. So the reviewer could not see it from the doc, and it is true in the code: neither gate can pass while the app is still showing the splash. Related, the other item the reviewer called unfalsifiable — the provider-client count — is already a recipe the anchor gate re-executes, and it prints git names 24 deleted files under services/providers/ with 6 remaining.


**Stage 1 of #19 landed (2026-10-19): the ensemble flag stops deciding data work.** Per the owner ruling — keep Hybrid Intelligence, delete the ensemble leg, let market data be pulled on demand — a manual send no longer fetches real-time data: the seat calls get_market_packet, which already runs the same fetchHybridData + generateHybridPromptInjection path, so the capability is unchanged while an ordinary answer stops spending an exchange round trip it never asked for. Scheduled runs keep their unconditional pull, because for them the data IS the point. hooks/useMarketData now keys live polling to the Hybrid Intelligence toggle alone (guard at :44, reachability check at :127 and :161, effect deps at :118 and :192), which is exactly the re-parenting the grep-and-delete warning above said would be required before the toggle could go. Two things this pass caught about itself: (1) tests/automationRouteCharacterization.test.tsx went red because the deletion SUCCEEDED — it required an `if (runEnsembleEnabled) {` block to still exist, and its own comment anticipated the deletion — so it now asserts the property (no mode-gated block, the arm inside the schedule guard, a schedule-only fetch) and was checked against HEAD source to prove those assertions fail there; (2) 22 citations into the hook drifted when about fifteen lines vanished and the gate caught only six of them, because the rest are bare continuation numbers that land silently on whatever code is now there — including two that landed on comment lines and were flagged only in the ledger. The anchor count moved 305 to 302 as citations collapsed onto shared lines and others were re-anchored.


**Stage 2 of #19 landed (2026-10-19): the Agents desk is never seeded, and the built-in Macro / Technical / Risk analysts are gone.** Per the owner the desk should open empty, like a chat, so the two effects in the App that invented a fallback roster (one from the Analyst Lens assignments, one from the model picker) and the effect that rewrote a named bot's model when those settings moved were deleted, together with the registry helper that only they called and the now-unreferenced role import. Nothing about the delete was quiet: it took four attempts on the docs, and three of them taught me something about my own checks. The first rewrote four CRLF files as LF, which is a whole-file diff masquerading as a documentation edit; the second assumed one hunk when the change was two, so every citation below the import was off by one line and the header-band references landed on comments; the third rewrote bare continuation numbers without their colon, corrupting the text it was meant to fix. Each time the correct move was to restore the files from HEAD and redo the pass, not patch the damage on top of itself. All four docs are now byte-consistent with CRLF intact and every App citation re-derived from the two hunks, with the header band fixed by content rather than arithmetic because a citation with no bound symbol is invisible to the gate while still being wrong. One honest gap is recorded in the flow docs themselves: no test covered the seeding, so removing it turned nothing red — the green suite here proves the deletion is safe, not that the feature was unused. Also worth stating plainly: the anchor gate caught my new sentence immediately, because attribution is one symbol per row, so the empty-state citation had to carry the identifier that actually lives on that line. The role feature is only half-cut: bot tool presets, role personas, lens prompts and the roster builder still name the three roles, and the Analyst Lens settings surface still exists, so those are the next tranche of this ruling.


**Stage 3 of #19 landed (2026-10-19): the analyst-role system is deleted and stored profiles are migrated.** Per the owner the desk opens empty, like a chat, so the built-in Macro / Technical / Risk analysts are gone end to end: the role vocabulary, the per-role tool presets, the role prompts and lens prompt files, the Analyst Lens service and its config, the ensemble model picker, the role pickers in the New Bot and New Group dialogs, the per-member role plumbing, role-scoped retrieval and the lens-scoped skill filter, and the automation editor is Lenses/Analysts controls. A bot is now its name, provider/model, notebook scope and the trader instructions that form its persona; groups carry membership only. The moderator pick survives (it still decides a scheduled run seat) and moved to its own module. Migration is real, not type-level: the roster rewrites a stored row the first time it is read (role and enabledTools removed, verified by a test that asserts the stored bytes, not just the returned object), profile settings lose the ensemble flag on first load, provider configs lose the per-provider ensemble roster on load and are persisted through the normal save path, and a boot step deletes the four removed preference keys. Two honest residues: notebooks may still contain lens/*.md files written by the old seats — they are no longer read, and nothing deletes user notes; and bot tool presets were already inert (bots are chat-only since stage 20), so their removal changes no runtime behaviour. All gates were re-executed on this tip, each read from its own summary: typecheck, typecheck:scripts and typecheck:electron clean; vitest 4670 tests in 472 files passing, none skipped; lint 0 errors with 675 warnings under the ratchet; vite build clean; flow-doc anchors OK at 296 anchors and 52 of 53 arrow rows content-checked, with the AGENTS census re-measured and its skipped-file rule now deriving the count instead of assuming the one file that used to be skipped; boot-probe and render-probe zero pageerrors across all four surfaces; Playwright 5 passed; skill-approval probe 25 of 25 with its two injected quota faults. The release workflow still has no anchor step because the owner said to leave it for now, and nothing was pushed by me.


**Final residue pass after stage 3 (2026-10-19).** A vocabulary audit of the production tree found four leftovers the stage-3 commit had missed: the AnalystRole enum itself (only an unused Doctrine import still named it), two comments describing the deleted flag, and the lens-scoped skill filter with its helpers, parameter and one test. All are removed; a grep for the role, flag and lens vocabulary across the app now returns nothing except the migration that deletes the stored setting by name, which must spell it. The suite census moved to 4660 tests in 471 files, all passing and none skipped, and every gate was re-executed on this tip rather than carried: typecheck and both script/electron variants clean, lint 0 errors with 673 warnings under the ratchet, flow-doc anchors OK at 296 with 52 of 53 arrow rows content-checked and 0 AGENTS disagreements, vite build, boot-probe and render-probe with zero pageerrors, Playwright 5 passed, skill-approval 25 of 25 with its own injected quota faults. What remains outside this delivery is unchanged and the owner's: the release workflow has no anchor step by their instruction, and pushing is theirs to do.


**The global Moderator picker is gone (2026-10-20, owner ruling).** It was the last control shaped by the old debate vocabulary: renamed once, but never removed, which the owner spotted in Settings. The picker, the conversation-level setters, the last-pick preference and the seeding of new conversations are deleted; a scheduled run answers with the model picked in its own automation (the editor already required one), and the provider used by the memory, vision and strategy fallbacks is simply the first healthy ready provider. Stored conversation and trade fields stay as legacy data. Two things surfaced while verifying: an orphaned Vite process left by a stopped dev-server task was competing with every probe run, and the render probe read the Agents Send button in the same tick as the input event — a race against React that reported a dead composer on a healthy app. The probe now waits up to five seconds for the button to enable and still fails when the composer is genuinely stuck. Gates re-run at this tip: typecheck, typecheck:scripts and typecheck:electron clean; vitest 4660 tests in 471 files; lint 0 errors; build; anchors 296 with coverage 52 of 53 and no AGENTS disagreement; boot-probe; render-probe fully green including all six transcript rows; Playwright 5 passed; skill-approval 25 of 25.
