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
  `chatSurfaceSystemPrompt` (`chatSurfaceTurn.ts:103`) leads with
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
  `types/message.ts:368`) bounded to the 30 the index printed, so the record cannot
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
`useAnalysisPipeline.ts:1539`, ABOVE the mode fork at `:1589`, and
`tests/automationRouteCharacterization.test.tsx` pins the order by `indexOf`
rather than by prose, so moving the arm below the fork is a failing test, not a
comment.

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
`scripts/installer-smoke.cjs:289` and `scripts/render-probe.cjs`'s `lens` chunk; (4) the
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
**fabricated citation**, `rationale :617-622`, in three places — the word `rationale`
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
and `components/shared/ChatTranscriptRow.tsx:18` both cite `verdictFinalizer.ts` as where a
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
`components/journal/TradeLog.tsx:532` (`trade.tradeType || trade.analysis?.tradeType`),
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
   `DeskToolsService.ts:3116`. The control that caught it is the new
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
   `TradeView.tsx:716`), and its own header calls `CompletionNotifications` a
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

`notify()` now fires on the settled Full-analysis path (`useAnalysisPipeline.ts:1559`),
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
| `hooks/useWatchAndAutopilot.ts:4` | `reconstructOpenings` from `utils/debateResume` | what a watch arms an opening FROM, now that no debate produces one |
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

- `streamThrottlers`: `useAnalysisPipeline.ts:403` destructures **only**
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

- `hooks/useAnalysisPipeline.ts:575` still sets `runEnsembleEnabled`, and three
  debate-only refusals still run on it: no-moderator (`:730`), incomplete lens
  roles / two seats sharing a model (`:754-785`), and the seat ceiling
  `TEAM_MAX_SEATS` (`:793`, "Too many providers for a Standard-mode debate").
  Nothing on that path can convene a debate any more — `conductDebate` and
  `ensembleService` are deleted — so a send with the ensemble toggle ON can still
  be REFUSED for a debate that cannot happen.
- `isStagedEnsemble` (`:655`) still mints `ensembleProgress` (`:888`, written on
  the placeholder at `:912`) with every seat at `status: 'waiting'`. Nothing ever
  moves it, because the only writers were the debate throttler (deleted) and
  `runOutcome.ts:41`, which only marks it failed. `App.tsx:1254` reads it.
- `isDebating: true` is now written in exactly ONE place: the resume path
  (`:924`). Everything that once set it lived in the debate loop.

**The live consequence, and it is the next job:** `App.tsx:1249` picks
`verdictMessage` out of the debate shapes — `ensembleProgress`, >1 `modelsUsed`,
`debateTurns` — and hands it to the chart as `verdict={verdictMessage?.analysis}`
(`App.tsx:2526`). After this tranche nothing sets `Message.analysis` for a new
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
`AccuracyModeModal` looked orphaned to a `from '…'` grep — it is imported through
`React.lazy` at `App.tsx:69` and mounted at `App.tsx:2222`. The
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
Census over all `.ts`/`.tsx`: minted at `useAnalysisPipeline.ts:888`→`:912`, patched at
`runOutcome.ts:41-53`, stripped at the SQLite boundary (`SqliteService.ts:499`), and
after `1bd501e` no component reads it (`App.tsx:1254` was the last, and that memo is
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

Gates: tsc clean; full vitest 477 files / 4713 tests green. render-probe to be
re-run for this change — it asserts row counts per conversation, and this removes
a row.
