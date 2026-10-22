# August Trading — harness baseline

**What the harness does today, and whether each thing is REAL or COSMETIC.**

This is the ground truth for the improvement phase. Every proposal in
`TRADING-IMPROVEMENTS.md` is checked against it: a proposal that re-does something
already here is rejected on the spot.

- **Method.** Seven readers each took one area of the harness, read it end to end, and
  marked every feature **REAL** (it changes model behaviour, data, or what the trader
  sees) or **COSMETIC** (it is rendered, listed, or typed, but has no effect — dead,
  unreachable, unwired, or its output is discarded). Reachability was measured by
  import-closure from `App.tsx` over production `.ts`/`.tsx`, not by reading names.
- **Coverage.** 343 numbered features across 7 areas.
- **Detail.** The per-feature evidence (`file:line` on every claim) is in
  `docs/research/baseline/`:

| Section file | Area | Features |
| --- | --- | --- |
| `agent-loop-and-tools.md` | agent loop, turn lifecycle, tool registry | 76 |
| `review-and-learning.md` | trade review and the learning loop | 58 |
| `model-and-provider.md` | model/provider handling, errors, timeouts | 71 |
| `pattern-memory-gates-mc.md` | pattern memory, gates, Monte Carlo | 42 |
| `ui-shell-and-surfaces.md` | UI shell, surfaces, streaming | 41 |
| `ensemble-and-debate.md` | ensemble/debate, multi-agent | 40 |
| `trade-log-and-intake.md` | trade log, `get_trade_log`, intake | 15 |

---

## 0. The one finding that reframes everything else

**The analysis pipeline assembles the trader's context and then throws it away.**

`hooks/useAnalysisPipeline.ts:1168` builds `enhancedPrompt`; it is written at
`:1175` (memory files, similar setups, weighted-voting learning, the code-checked
skill trigger note), `:1197` (decision reflections) and `:1208` (gate injection), and
it is **read exactly once** — `:1213`, a `devLog` that prints its length.

All three sends use `promptToSend`, not `enhancedPrompt`:

| Send | Site | Sends |
| --- | --- | --- |
| Scheduled run | `useAnalysisPipeline.ts:1258` | `promptToSend` |
| Bot thread | `useAnalysisPipeline.ts:1384` | `promptToSend` |
| Desk / Chat surface | `useAnalysisPipeline.ts:1411` | `promptToSend` |

A repo-wide grep for `enhancedPrompt` returns **7 hits**: 6 in this file (4 writes +
the devLog + the declaration) and 1 in a doc comment in `GateKeeperService.ts:450`.
There is no other reader.

**What this costs, precisely.** The live context path is a *different* module —
`surfacePromptWith` (`services/trade/chatSurfaceTurn.ts:110`), which composes the
surface mandate + **skills index** + active strategy plans + profile-memory index.
That one is sent. So the Chat surface and dock turn *do* get the skills index and the
mandate. What they **never** get, on any turn, without the model choosing to call a
tool:

- the retrieved notebook memory (the tier-2 bodies) — `memoryContext.ts:143`
- the similar-setups journal track record — `memoryContext.ts:156`
- the loss-priming rows (this setup's recent closed trades) — `memoryContext.ts:171`
- the decision reflections — `useAnalysisPipeline.ts:1194-1201`
- the weighted-voting learning context — `useAnalysisPipeline.ts:1137-1155`
- the **last-20 brief** — `MemoryRetrievalService.ts:923-935` → `memoryFilesContext`
- the pattern-memory synthesis injection — `PatternMemorySynthesisService.ts:589-669`
  has **0 production callers**

The model can still reach most of this by *asking* (`recall`, `get_trade_log`,
`get_setup_history_stats` are on the Chat surface's allow-list,
`chatSurfaceTurn.ts:63`). The `memoryContext.ts` comments show what this code was
written for: *"the verdict slice was built for a moderator that no longer exists"*
(`:138-140`), *"rebuttal rounds re-enter the same seats"* (`:144-147`). It is the
multi-seat debate engine's context assembler, left in place after the debate engine
was deleted. The cost of leaving it is a large, maintained, tested, dead subsystem
that makes the app *look* like it remembers the trader's journal when it does not.

**The closed-trade learning chain is dead.** `post-mortems` were deleted
(`usePostMortem`, `MistakePatternService`, `JobQueueService` — commit `03fc0d5`,
2026-10-17), and the consequence is recorded in
`docs/plans/debate-deletion-status.md:3-8`: *"the closed-trade learning chain stops
working with no replacement."* The code confirms it —
`craftSkillFromPostMortem` (`SkillCraftService.ts:140`) is still called from
`botLearning.ts:234`, but its guard `pm.length < 40` (`:145`) makes it return null
for **every** trade closed after 2026-10-17, because nothing writes a post-mortem
any more. So a closed trade produces no lesson, and therefore no skill.

---

## 1. Verdict ledger

| Area | Features | REAL | COSMETIC / DEAD | PARTIAL / MIXED |
| --- | --- | --- | --- | --- |
| Agent loop, turn lifecycle, tools | 76 | 66 | 9 | 1 |
| Trade review and learning | 58 | 43 | 9 | 6 |
| Model and provider handling | 71 | 55 | 2 | 14 |
| Pattern memory, gates, Monte Carlo | 42 | 32 | 5 | 5 |
| UI shell, surfaces, streaming | 41 | 32 | 6 | 3 |
| Ensemble, debate, multi-agent | 40 | 23 | 20 | 0 |
| Trade log, `get_trade_log`, intake | 15 | 5 | 10 | 0 |
| **Total** | **343** | **256** | **61** | **29** |

> **Arithmetic note (2026-10-23).** These columns do not add up: 256 + 61 + 29 = **346**,
> three more than the 343 features above. The discrepancy is one row — the ensemble area
> says 23 REAL / 20 COSMETIC / 0 PARTIAL, but `baseline/ensemble-and-debate.md`'s verdict
> column carries **40** features marked **22 REAL / 6 COSMETIC / 12 DELETED** (tallied
> row by row). Reconciling that row to 22 / 18 / 0 makes the totals **255 REAL / 59 dead
> or cosmetic / 29 partial = 343**. Until an author re-classifies, quote "256 / 61" as the
> ledger's claim, not as a count — and re-derive it from the section files before using it
> as a census.

The harness is **not** a hollow shell — 256 of 343 features genuinely work, and the
tool registry, the proposal gate, the skill approval gate and the one-conversation-home
contract are all real. The problem is not quality; it is that **61 features are
vestiges of a deleted feature set**, and they are the *expensive* kind: built,
tested, documented, and unreachable.

---

## 2. Agent loop, turn lifecycle, and the tool registry

**REAL (66).** One loop (`runToolTurn`, `services/trade/toolTurn.ts:131`), one
executor (`runDeskToolLoop`, `DeskToolsService.ts:3571`), one registry
(`DESK_TOOL_DEFINITIONS`, `DeskToolsService.ts:909-1543`). The executor-level
allow-list is enforced on **every** transport (`DeskToolsService.ts:2478-2487`).
The mandate is composed from the tools the turn can actually call
(`deskToolsMandateFor`, `:1739-1784`). A refusal is `ok:false`, not a receipt
(`:2426-2438`). 20s per-tool-call deadline; 180s turn budget; a repeat-call guard; a
stall detector; a self-heal bounce; a thinking-cut re-ask; a produced-nothing
continuation; atomic compaction so a `tool_calls` pair never splits
(`contextCompact.ts:122-145`); the context window learned from the provider's own
rejection plus one retry (`GenericProviderService.ts:1324-1341`).

**COSMETIC / DEAD (9).**

| Feature | Evidence |
| --- | --- |
| `enhancedPrompt` — never sent | `useAnalysisPipeline.ts:1168-1213` (§0) |
| Hybrid injection string | computed, never reaches a send |
| Gate-keeper injection | `useAnalysisPipeline.ts:1203` — `const gateInjection = '';` |
| `ARBITER_ALLOWED_TOOLS` | `DeskToolsService.ts:3341-3357`; **no production importer** — only `tests/evidencePack.test.ts:33`, `tests/tradeLogTool.test.ts:11` |
| `toAnthropicTools` | `DeskToolsService.ts:1791-1796`; test-only |
| `requireFirstToolRound` | `DeskToolsService.ts:3638/3737`; unreachable |
| The prompt A/B lane | `services/trade/**` has **zero** `getPrompt` calls; a "control" and a "live" run send identical bytes and record different labels (the repo's own `O-140`) |
| The four `analysis.*` registry prompts | reach a model only via `analyzeTradingView`, whose only production caller is the skill-eval scheduler (`SkillEvalScheduler.ts:284`) |
| `analyzeTradingViewWithTransientRetry` | `useAnalysisPipeline.ts:249-275`; zero callers |

**Two live problems inside a strong area.**

1. **The skill-proposal tool bug** — `propose_skill` **requires** `reason`
   (`DeskToolsService.ts:1074`, in `required` at `:1077`) and the handler
   **never reads it** (`:2645-2717`; `call.arguments.reason` appears in
   `amend_memory:2527`, `revise_skill:2793`, `decline_trade:3240` — but not here).
   `CraftedSkillSchema` (`schemas/learning.ts:121-209`) has no slot for it and the
   receipt (`:2712`) omits it. So the evidence is silently lost *before* a human
   approval gate. The sibling `revise_skill` does keep its reason (`:2793`).
   Two smaller losses: `:2657` coerces a missing `steps` into the literal
   `["undefined"]`; `additionalProperties:false` (`:1078`) with `timeframe`/`source`
   missing from the schema means the model's timeframe is lost (proof replay is
   always 1h) or the call is hard-rejected.
   Git: the earlier *silent-success* class was fixed (`121bd1df` → read-back in
   `utils/skillDrafts.ts:75-82`); the `reason` drop is in **no** commit.
2. **The unattended evaluator can call tools the automation surface denies.**
   `SkillEvalScheduler.ts:284-294` calls `analyzeTradingView` with **no**
   `allowedTools` → `GenericAnalysisService.ts:449-452` →
   `DeskToolsService.ts:2485/3720-3724` (empty list = unrestricted), fired detached
   at `SkillMemoryService.ts:3797-3798`, with `deskToolsEnabled` defaulting true
   (`utils/harnessSettings.ts:110`). So a detached job can call `propose_skill`,
   `decline_trade`, every forged `custom_*` tool, and the exact 8 tools
   `automationTurn.ts:56-64` denies.

---

## 3. Trade review and the learning loop

**REAL (43).** A skill store (`SkillMemoryService.ts:639/1243/1237`), a draft inbox
(`utils/skillDrafts.ts:65`), a two-tier draft gate (`draftGates.ts:85` deterministic
+ `:199` evidence), **human approval as the only writer with a read-back**
(`skillApproval.ts:53`, `:83-88`), an honest toast (`:115`), and an **activation
gate** — `isApprovedSkill` (`SkillMemoryService.ts:991`, enforced at
`MemoryRetrievalService.ts:226`). Also real: the evidence ledger
(`SkillMemoryService.ts:2204`), 3-state adherence (`MemoryInjectionService.ts:189`),
the status ladder + CI gate (`:1832/:1517`), the temporal ledger (`:1198/:1226`),
the graveyard + revival (`skillGraveyard.ts:97/288/341`), the idle lifecycle
(90d suspend → 180d archive, `skillIdleLifecycle.ts:264` via `memoryHygiene.ts:269`),
the library cap + displacement (`SkillMemoryService.ts:3320`), the worth gate +
attempt throttle (`skillWorthGate.ts:81`, `skillDrafts.ts:219`), the 7-step memory
hygiene (`memoryHygiene.ts:151`), the **weekly digest**
(`weeklyReview.ts:128` → `WeeklyReviewCard.tsx:13`), the monthly card
(`monthlyReport.ts:321` → `MonthlyReportCard.tsx:13`), settlement reflection
(`settlementReflection.ts:239`, called *before* the notebook sync at
`useTradeLogging.ts:527/549`), pass mining (`passMining.ts:90-108/184-303`) and the
strategy store (`strategyStore.ts:209` → `chatSurfaceTurn.ts:144`).

**COSMETIC / DEAD (7 — corrected after the Phase 3 gate; see the note below).**

| Feature | Evidence |
| --- | --- |
| `learning_rules_v2` store | `StorageService.ts:105`; load/save round-trip only (`useUserProfileLoader.ts:434-443`) — **no prompt reader**. A write-only corpse that still has a backup |
| `MemoryConsolidationService.ts` | an orphan module — **zero references in the whole production tree** |
| `providerFitness.ts` | orphan; its own header names a consumer (`autoAssignLenses`) **that does not exist in the repo** |
| The predicate-gate confidence ceiling — **on the chat path only** | `skillPredicateGate.ts:200` computes the ceiling; the *note* it returns (`:216`) is only read on the chat path, where it is dropped with the rest of `enhancedPrompt`. On the **plan** path the ceiling is applied: `services/trade/proposalGate.ts:264` → `buildSkillGate`, whose ceiling is folded into the one stamp the card shows and the journal records (`services/trade/presentTradeTool.ts:140-144`) |
| The insight pruner | dead |
| IF/THEN auto-ingest | `SkillMemoryService.ts:2996` writes a file with `prior:'gated'` but **no `approvedBy`** (`:3085`), so `isApprovedSkill` blocks injection — yet the index still names it (`tradeChatContext.ts:265` does not check approval) |
| Harness lessons | no prompt reader |

> **CORRECTION (Phase 3 gate, lead verification).** The first reading of this section
> recorded the **hard avoid veto** and `applyNotebookSkillsToAnalysis` as dead, on the
> strength of the claim that the function had *"ten test call sites and zero
> production ones"*. Re-opening the source shows that claim is **stale**: the fix
> (E-35) landed. `services/trade/presentTradeTool.ts:113` calls
> `applyNotebookSkillsToAnalysis`, and a fired AVOID **refuses the presentation** and
> writes the falsification ledger (`:114-133`). The file's own comment says it:
> *"This used to be computed and thrown away … so a confirmed AVOID skill could not
> stop the plan it was written to stop."* So the code **can** require a skill — on the
> plan path. The claim *"the prompt can ask for a skill, the code cannot require
> one"* is **false as it stands**; the accurate version is that the **chat** path has
> no deterministic skill enforcement, because its note is dropped with the rest of
> `enhancedPrompt` (see §0). The count of dead items in this section is **7, not 9**.

**Three belief types, three stores, three lifecycles — and only one of them works.**

| | Store | Reaches a model? | Evidence machinery |
| --- | --- | --- | --- |
| **Rules** | `learning_rules_v2` | **No** — no reader | none |
| **Strategies** | `strategyStore.ts` | Yes (a prompt block) | none — `status:'active'` only |
| **Skills** | the notebook | Yes, **if** `isApprovedSkill` | the full apparatus |

**The index filter and the injection filter disagree.** The index
(`tradeChatContext.ts:265`) does not apply the approval check the injection path
applies (`MemoryRetrievalService.ts:226`), so an unapproved skill is **named** to the
model and never **given** to it.

**Guards: 19 of 22 genuinely bite** (corrected from 18). Real: worth gate, graveyard +
revival, graveyard sweep, idle lifecycle, consolidation, tombstone cooldown,
pending-dup, live coverage, IF/THEN bar, library cap, status ladder, veto-cost/
negative-lift demotion, approval gate, byte budget (refuses growth, never evicts),
ε-holdout, **the hard avoid veto** (on the plan path), and **the predicate ceiling**
(on the plan path). Dead: the insight pruner, the rules store. Partial: stale-skill
demotion (proposal-only), and the predicate ceiling + trigger note on the **chat**
path, where the note is dropped with `enhancedPrompt`.

---

## 4. Model and provider handling

**REAL (55).** Four wire formats behind one dispatcher (`types/provider.ts:13`,
`GenericProviderService.ts:1480-1493`); the OpenAI SDK pinned to **1** attempt
(`:519-526`) with the app's own retry doing the work; three transports
(Electron / dev-proxy / direct, `:415-419`); **one** shared wire policy `.cjs` for
renderer + vite proxy + electron (`shared/providerRequestPolicy.cjs:1-39`); a
400/422 **degrade ladder** (json_schema → json_object → none → no tools,
`:585-633/693-702`); a provider-URL/SSRF policy with redirect re-validation
(`providerRequestPolicy.cjs:331-393/501-535`); timeouts 120s non-stream / 300s
stream per attempt (`:638-659`); **3 attempts**, jittered, `Retry-After` honoured,
and timeout/401/quota deliberately **not** retried (`utils/apiErrorUtils.ts:65-76/116-156`);
`toFriendlyProviderError` leading with the provider's own words plus the cause chain
(`:1114-1278`); a failed turn drawn as a failure and never as an answer
(`ChatFailureRow.tsx:16-26`); the context window resolved from 4 sources with the
source named (`utils/contextWindow.ts:136-158`); automatic compaction
(`contextCompact.ts:217-358`); a context-length rejection → learn the limit →
compact → retry **once** (`GenericProviderService.ts:1324-1341`); one effort ladder
with capability classes, fail-closed (`reasoningControls.ts:271-378`); `WireAuditEntry`
distinguishing *"did not think"* from *"never asked to"* (`WireAuditRow.tsx:47-75`); a
20s tool deadline producing a `DATA_UNAVAILABLE` receipt; a 3-in-a-row automation
self-disable.

**COSMETIC (2).** `readyProviderModels` still carries a `.slice(0,3)` ensemble
leftover (`utils/providerUtils.ts:38-42`); `useNetworkStatus` only drives the offline
queue (`hooks/useNetworkStatus.ts:12-47`).

**PARTIAL (14) — the important ones:**

| Gap | Evidence |
| --- | --- |
| **No runtime provider/model fallback** | A 500/429/401 ends the turn. No second provider is tried, on the chat, dock, analysis or automation path (`GenericProviderService.ts:1501-1506/1722-1727`, `useAnalysisPipeline.ts:1338-1344`, `automationTurn.ts:95-116`). A *resolution-time* fallback for a stale pick **is** real, with an amber banner in both composers (`utils/providerUtils.ts:119-134`, `tests/modelFallbackBanner.test.tsx`) — but that is a different thing. |
| The cooldown bench is not consulted for a chat turn's provider | `ProviderHealthService.ts:104-122` is read in only 3 places, none of them the turn path (`App.tsx:328-336`, `botAttention.ts:55`) |
| The dev-proxy branch has **no timeout** | `GenericProviderService.ts:1411-1427` (dev-only) |
| A Stopped turn on the Chat surface is unmarked | `types/message.ts` has no `interrupted` field; the flag is on the persisted `StoredChatEntry` (`chatSessions.ts:103`, inherited by `LiveEntry` at `chatStore.ts:48`), so the dock's rows survive reload |
| An empty-but-"complete" automation run does not trip the breaker | the breaker counts only error/skipped rows |
| The desk turn budget is a nudge, not a stop | `DeskToolsService.ts:196-219/4069-4072` |
| `isProviderReady` vs `readyProviderModels` disagree on keyless local servers | `utils/providerUtils.ts:18-22` vs `:38-42` |
| The measured chars/token anchor is observed but not consumed | `utils/tokenEstimate.ts:85-120` |

**The one real cross-provider fallback fails silently.** `AITrendlineService.analyzeWithAI`
(`services/analysis/AITrendlineService.ts:46-60/225-243`) tries each ready provider
and, on total failure, returns a hard-coded "AI analysis unavailable" with only a
`console.error`.

---

## 5. Pattern memory, gates, and Monte Carlo

**REAL (32).** Pattern-memory synthesis (`PatternMemorySynthesisService.ts:130-523`)
and the attributed-insight ledger (`distilledMemory.ts:38/202/239`); negation-aware
family matching (`utils/patternMatch.ts:42-50`); the candle-pattern detector
(`CandlePatternDetector.ts:1124-1245`, live at `HybridIntelligenceService.ts:503-508`);
geometric patterns with **measured** touches — `countTouchesOnLine`
(`utils/patternDetection.ts:68-102`) and a 2-touch shape labelled "ASSUMPTION, not a
setup" (`HybridIntelligenceService.ts:961-979`); `snapPriceToStructure` (`:425-453`);
`runProgrammaticGate` (`GateKeeperService.ts:70-308`); the **proposal gate** and its
two blocking refusals — the min-edge floor (`proposalGate.ts:95-115`) and the
inverted-plan refusal (`:152-181`, which survives a failed market fetch); the
**notebook-skill hard veto** (`presentTradeTool.ts:113-133` refuses the
`present_trade` call itself); the cap binding the recorded probability
(`proposedTrade.ts:166-233`); the refusal visible on the card
(`TradeProposalCard.tsx:162-166/206-209`) and at the log boundary
(`App.tsx:1577-1595`, which returns false and writes no row); Monte Carlo as a real
seeded GBM + Markov simulation (`MonteCarloService.ts:222-523`, pinned by
`tests/financialMath.test.ts:151-190`); ruin risk / Kelly (`:581-709`); the web
worker, wired, with a pool of 4, a 10s timeout and ejection
(`monteCarlo.worker.ts:35-58`, `MonteCarloService.ts:783-900`); `DataIntegrityService`;
the calibration chain; `ValidationConstants`; pass mining with the human gate
preserved (`passMining.ts:248-299`); `setupScan`.

**COSMETIC / DEAD (5).**

| Feature | Evidence |
| --- | --- |
| **`TradeValidationGate` (41 KB)** | `services/validation/TradeValidationGate.ts` — **zero importers in the whole production tree.** `runValidationGate:495-973` runs twelve named steps (MTF confluence, volume, regime, Devil's Advocate, crowding, session risk, pattern memory, entry timing, SL optimisation, calibration penalty) that never run. `matchPatternMemory:227-320`, `detectCrowdedTrade:329-375`, `validateSessionRisk:384-426`, `validateTimeframeAlignment:438-480` are reachable only through it. |
| `patternMemoryGate` | `PatternMemorySynthesisService.ts:882-1081` — `generateMandatoryPatternCheck` and `generatePatternMemoryEnforcementContext` have **0 production callers**. `Message.patternMemoryGate` is never assigned, so the journal's HALT chip (`TradeLog.tsx:359-386`) can never render. **`docs/app-flow.md:606-621` used to tell the reader this was "the pre-trade gate that refuses a setup with no evidence" — corrected 2026-10-23, and it now names `services/trade/proposalGate.ts:152` as the live gate.** |
| Severity insights | `severityInsights.ts:269` — the store and the maths are real; the writer is unreachable |
| `SessionGuardService` | `SessionGuardService.ts:157-268` — computes realised day P&L, trades opened today, the loss streak and a 4h post-loss cooldown, grades them, and is called **only from tests**. The 2% daily-loss budget, the 2-trades/day cap, the streak pause and the cooldown never fire. |
| `providerFitness` | see §3 |

**PARTIAL (5).** Monte Carlo is real but **display-only** — nothing downstream reads a
result; `runMonteCarloForSetup` (`HybridIntelligenceService.ts:1409-1444`) is dead and
`setLatestMonteCarloResult` is never called. The rolling-20 window is written for
real (`ModelPerformanceService.ts:126/868-905/1144-1189`) but **steers nothing**:
`calculateDynamicWeights` (`:531-629`) and `calculateDynamicWeightsEnhanced`
(`:1041-1138`, the one with "PRIORITY 1: last 20 trades — up to ±25 points") have
**no production callers**, and the live weighted-voting context ranks by *all-time*
win rate (`:649`). The per-family bias in the gate is computed and rendered, but
`runProgrammaticGate`'s own file says *"ALL families are ALWAYS allowed"*
(`GateKeeperService.ts:74-75`).

**The two gate chains:**

- **Chain A — the live one** (`present_trade` → journal): parse → notebook-skill veto
  → inverted levels → min-edge floor → *5 advisory caps* → skill ceiling → R:R/ATR
  bands *(warn)* → the cap binds the recorded probability → the refusal blocks the
  row write.
- **Chain B — the chat/analysis path**: **no deterministic gate at all.**
  `useAnalysisPipeline.ts:1203` reduces the gate injection to `''`; the calibration
  penalty, the provider-accuracy note, the similar-setups and regime weighting all
  reach the model as **prose only**; the computed `adjustedConfidence` is never read
  by the pipeline (`useAnalysisPipeline.ts:1006-1037`); and the session guardrails
  never run.

---

## 6. UI shell, surfaces, and streaming

**REAL (32).** The surface router (`useSurfaceRouter.ts:54-171`), surface
persistence with migration, the title-bar switch, the status cluster, the Activity
drawer, the right-panel contract (`useRightPanel.ts:82-207`), the header band, the
one `Disclosure`, the one `DetailModal`, the one `JumpToLatestFab` (with an
**indeterminate** ring — an explicit refusal to invent a denominator), the one
`ModelMenu`, the effort ladder + dial refcount, the tool-kind marks, the wire-audit
row, the Chat surface, the dock, the work card, the tool rows (one row per **call**,
never two), the turn-status grammar, and the whole one-conversation-home contract:
`deskThread` (`utils/agentThreads.ts:118-138`), `threadForProvider` (`:42-104`),
`entriesForSession` — the one merge (`chatSessions.ts:586-599`),
`liveEntryFromMessage` (`:491-550`, carrying `Message.isStreaming`),
`startEntryMirror` (`chatTurnMirror.ts:88-161`, same id, a 200ms **timer** not rAF,
always flushed), `ensureDockTurnConversation`, `commitSoloChatTurn` (upsert, never
replace), `commitDockBotTurn`, the proposal-disposition store, and conversation
housekeeping (a thread switch moves the **view**, never the run).

**COSMETIC (6).**

| Feature | Evidence |
| --- | --- |
| **`NavRail.tsx` — 242 lines, never rendered** | `App.tsx:2507-2515` says so in the source; `tests/deadControlsGuard.test.ts:145` pins the absence. Three exports are live: `AccountRow` and `NAV_RAIL_AUTO_COLLAPSE_PX` (`App.tsx:129`) and `NAV_RAIL_EXPANDED_PX` (`components/agents/AgentsView.tsx:73`) |
| `SurfaceMenuList`'s five-surface list | its only mount passes `hideSurfaces` (`App.tsx:2725-2731`), so `!hideSurfaces && SURFACE_ITEMS.map(...)` never evaluates — taking the brand-gradient active bar, the badge count, and the "a conversation is still running" busy badge (`RunBusyBadge` is imported **only** there) with it |
| `Header`'s three dead props | `isAnalysisInProgress` / `currentVisionData` / `pendingQueueCount` are declared (`Header.tsx:12-20`), passed (`App.tsx:2531-2535`), and never read; `pendingQueueCount` is live state whose only consumer is a prop nobody reads |
| `App.tsx:687/702` | two dead locals (`isNavOverlay`, `closeNavOverlay`) |
| The "Run stopped" card on the Chat surface | `ChatTranscriptRow.tsx:219` needs `row.interrupted`; `chatRowFrom` (`AgentsView.tsx:246-294`) never sets it and `types/message.ts` has no such field |
| The memory-provenance strip | dock-only (`ChatTranscriptList.tsx:245-251`); not mounted on the Chat surface |

**MIXED (3).** `ChatTranscriptRow` — the Chat surface mounts it with **only** `row`
(`AgentsView.tsx:1438-1441`), so it loses the Key Levels card, the Retry chip, the
Pin chip and the "Run stopped" card the dock has. The second disclosure mechanism
survives: `.collapsible-content` (`index.css:1455-1468`), a `<button>` +
grid-collapse `<div>`, at `StrategySearch.tsx:269/325` and
`LessonsSection.tsx:81` — the exact mechanism `Disclosure.tsx:4-15` says was retired.

**Also cosmetic:** the Chat surface's rail row for the desk thread is titled
**"Chart AI"** (`AgentsView.tsx:1119`) while the same thread is called "Desk" in that
surface's own header (`:1365/1372`); `AgentsView.tsx`'s header *"⚠️ THE TWO SURFACES DO
NOT SHARE A STORE TODAY"*, now false (rewritten 2026-10-23 to "two stores, one thread");
Settings → Journal is
a launcher duplicating a switch destination; the agent's "N lessons · N skills · N
evidence" is shown three times in one surface; the session pill's accessible name is
the bare `"NY"` (`Header.tsx:196-212`); 13 dead animation classes and the whole
`.floor-lean*` block (dead CSS for the deleted 2D desk floor) are still in
`index.css`; 28 `@keyframes` against a doctrine that sanctions 2 families
(`docs/ui-doctrine.md:110-111`).

---

## 7. Ensemble, debate, and multi-agent

The debate engine is **gone** — deleted in `48c3ee81` (2026-10-18, "the debate engine
is deleted") and `6e1e09bb` (2026-10-19). `ensembleService.ts` (3,638 lines),
`debatePrompts.ts`, `AnalystLensService.ts`, `EnsembleAnalystService.ts`,
`ensembleConsensus.ts`, `verdictFinalizer.ts` (709 lines), the 2D debate floor, the
analyst-role system, the verdict finalizer, the consensus/conviction-auction layer,
the debate-derived journal history, and the `debate.*` prompt ids are all deleted.

**DELETED (13).** The moderator turn; the analyst-role system; the **clarification
cycle** (`MAX_CLARIFICATION_CYCLES = 3` lived at `ensembleService.ts:1152`; the three
clarification prompts are gone); consensus / conviction auction / seat trust / gate
reconciliation / level-evidence extraction; the verdict finalizer; the 2D debate
floor; the global moderator picker; debate-derived journal history; **post-mortems**
(`usePostMortem`, `MistakePatternService`, `JobQueueService` — deleted `03fc0d5`,
with the accepted consequence recorded in `docs/plans/debate-deletion-status.md:3-8`:
*"the closed-trade learning chain stops working with no replacement"*); the debate
prompt ids; the debate-era `Message` fields.

**REAL (23).** A single-model tool turn (`toolTurn.ts:131`); the scheduled-run tool
turn; the chart-dock **multi-seat panel** — up to 5 models *or* roster agents
answering one request (`chatPanel.ts:81`, `chatTurnRunner.ts:1144-1300`); a panel
**closing synthesis seat** (`chatPanel.ts:87-91`, `chatTurnRunner.ts:1199-1201`) —
the closest thing to a moderator that survives; panel cross-talk by @mention
(`chatPanel.ts:107-122`); inter-seat direct messaging over real tool calls
(`DebateMailbox.ts:48/115`, live only inside the dock panel); the named agent
roster (`agentRoster.ts:20-152`); bot threads as derived views over one flat message
array; the teammate DM mailbox (`botMailbox.ts:84/133/220`) with TTL, hop cap,
fanout cap and a rate limit (`:33-42`); group rooms (`useAgentGroups.ts:126`); the
group-round protocol — bounded round-robin, deterministic @mention routing, `(pass)`
= silence (`groupRounds.ts:16-18/31-41/49/70/109`); bot memory isolation
(`memoryScope`: global / personal / isolated); the bot learning loop
(`botLearning.ts:169-362`); bot attention classification with a fix hint
(`botAttention.ts:30`); bot-scoped routines (`botRoutine.ts:80`); seat personas; the
unified agent-context loader; the prompt registry; the conversation-level steering
queue; and the legacy-preference cleanup.

**COSMETIC (7).** `Message.debateTurns` (no producer, four legacy readers);
`ARBITER_ALLOWED_TOOLS`; the one-tap debate templates (extraction live, steering
dead — no UI produces a marker); the run-contract stage ladder (types only, and
`RunContractPanel.tsx:32-37` still names the six deleted stages);
`Message.evidencePack`; the monthly report's "ensemble line" and "legacy moderator"
Brier cells; the mid-run seat steering handlers (exported at
`useAnalysisPipeline.ts:1778/1790-1797`, **zero consumers**; `seatSteeringRef` and
`stoppedSeatsRef` are written and never read, and `replacementChoiceRef` is never
set to a pending resolver, so `handleReplacementChoice` can never act).

**Live but misleading text.** `calibrationPolicy.ts:753/758/808` still says
*"INSTRUCTION FOR MODERATOR: Weight X's analysis more heavily"* and is injected into
the hybrid packet a **single** model reads (`HybridIntelligenceService.ts:1269-1276`).
Two more reach a live model and describe a committee that no longer exists:
`DeskToolsService.ts:1776` (*"opening analysis, rebuttal, clarification, or moderator
verdict"*) and `constants/prompts/harnessContract.ts:16` (*"The moderator's last block
is the labeled markdown plan only"*). `EFFORT_BY_TASK.moderatorVerdict/.rebuttal/.clarification`
(`reasoningControls.ts:72-78`) and `TASK_BUDGETS.rebuttal/.clarification`
(`taskBudgets.ts:15-17`) have no production caller. The `skill` audience
`'moderator'` survives only on legacy files — `SkillMemoryService.ts:382` says so.
`RolePreset 'moderator'` is **still reachable in the live UI**: the New Bot dialog
derives its choices from `Object.keys(ROLE_ACCENTS)`
(`components/chat/NewBotDialog.tsx:28-29`), so it still offers "Moderator" and the
three analyst roles as avatar presets, defaulting to `'macro'` (`:43`).

**Where the "moderator" name survives** — as a **fallback provider**
(`App.tsx:323-336`), as the **schedule's answering seat**
(`automationSeatFor`, `useAnalysisPipeline.ts:1236-1241`), and as **legacy persisted
fields** (`Conversation.moderatorProviderId`, `LoggedTrade.moderatorModel` — rendered
in the journal as *"Mod (legacy)"*). There is **no** moderator and **no** judge
today.

---

## 8. Trade log, `get_trade_log`, and trade-history intake

**REAL (5).** One store with two backends — the SQLite `trades` table
(`SqliteService.ts:159-183/718-742/756-774`) and the IndexedDB profile blob
(`dbService.ts:227-263`), keyed by `LoggedTrade.id` (= the Message id); section-diff
persistence with delete-absent (`SqliteService.ts:593-609`); the `get_trade_log`
tool (`DeskToolsService.ts:1379-1397`, handler `:3262-3286`), deliberately **not
cached** (`:450-466`); `utils/recentTradesBrief.ts`; the Journal "Last 20" card
(`components/journal/Journal.tsx:323-380`); the training JSONL export
(`utils/reportExport.ts:171-255`, button `ActionsTab.tsx:33-52`); and
`BackupService` carrying `tradeLog` (`:116-156`).

**COSMETIC / DEAD (10).**

| Feature | Evidence |
| --- | --- |
| **The last-20 brief never reaches a model** | `recentFormBlock` (`MemoryRetrievalService.ts:730-751`) → pushed at `:923-935` → `memoryFilesContext` → `enhancedPrompt` → **discarded** (§0). The Journal card is its only consumer. The bot path passes `trades=undefined` (`botLearning.ts:94`); the eval path passes `[]` (`SkillEvalScheduler.ts:211`) |
| **There is no trade-history import of any kind** | no importer exists. CSV, pasted text, image and PDF are all *prompt text*; PDF is wired to the **strategy book** only (`StrategiesManager.tsx:94/106`); an image is real **as analysis** but never becomes a journal row |
| The two surfaces use different clocks | the `get_trade_log` description says "the ISO time it was logged" but the code prints `decidedAt` (`recentTradesBrief.ts:136`), while the Journal prints `loggedAt` (`Journal.tsx:350`) |
| `ExportService` does **not** carry `tradeLog` | only `BackupService` does (`:116-156`). On web, Preferences is the export fallback — so a trade log is in the backup but not in the export |
| `ARBITER_ALLOWED_TOOLS` | dead policy (see §2) |
| `Message.evidencePack` | no producer |
| `Message.memoryRetrieved` | no producer |
| `LoggedTrade.postMortemImages` | no writer |
| The training export omits fields | `costR` / `netR` (the app's own canonical net-R, `types/trade.ts:228-235`), the benchmark alpha, `userPriorCall`, `postMortemModel` |
| `MemoryRetrievalService.ts:7-11` | still claims "the model … never the journal" — now false twice |

**Only the app's own capture funnel writes a journal row.**

---

## 9. What is genuinely strong — do not re-do it

These are the parts a proposal must not touch, because they are already right:

1. **One loop, one executor, one registry** for the desk tools, with the allow-list
   enforced at execution on every transport, and a mandate composed from the tools the
   turn can actually call.
2. **One proposal gate** with two *blocking* refusals (min-edge floor, inverted
   levels), one shared clamp that binds the confidence into the journal row, fail-closed
   on an unmeasurable scan, and a refusal that is visible on the card and in the toast.
3. **One shared R:R formula, one cost model, one clamp, one confidence-band rule** —
   shared by the card, the gate and the journal.
4. **Human approval as the only writer** for a skill, fail-closed, with a
   backup-before-stamp migration and revoke-on-rewrite.
5. **A write that cannot land is reported** — honoured in `skillDrafts.ts:81`,
   `skillApproval.ts:83-88`, `strategyStore.ts:329` and `rejectedResult`
   (`DeskToolsService.ts:2433`).
6. **Nothing is deleted** — the temporal ledger + graveyard "absorbed" naming the
   survivor.
7. **One turn-status grammar** read by the rows, the summary and the headline, so
   they cannot disagree; index-aware call/result pairing so payload ids stay attached.
8. **The indeterminate ring** — an honest refusal to invent a denominator.
9. **A shared failure row** using the provider's own words, in both homes.
10. **Measured (not asserted) pattern touches** — a 2-touch shape is labelled
    "ASSUMPTION, not a setup".
11. **Provenance on every field** (`resolutionSource`, `rSource`, `excursionSource`,
    `decidedAt`, `sourceRunId`); units are never merged; a missing fact stays a gap,
    not a zero.
12. **The harness-note dialect** generated from the real markers, with third-party
    text neutralised at ingestion.
13. **The byte budget refuses growth and never evicts**, because nothing in that
    store is safe to evict.

**Two multi-seat mechanisms, two stores, two vocabularies.** The dock **panel**
(`chatPanel.ts:81`, up to 5 seats, tool DMs allowed, **no turn cap**, has a
synthesis seat) and the Agents **room** (`groupRounds.ts:16-18`, 3 rounds / 12
turns, DMs forbidden by protocol at `:79`, **no** synthesis seat) are the same
product idea with different limits, on two screens — and the Agents surface reads
`App.messages` while the dock reads `services/trade/chatStore.ts`
(`AgentsView.tsx:10-25`).

---

## 10. The rules Phase 4 must obey

1. **Never propose what is already REAL.** §9 is the list.
2. **Prefer removal to addition.** 61 of 343 features are dead. Several are large
   (a 41 KB gate with zero importers, a 221 KB skill store with dead branches, a
   242 KB never-mounted rail). Removing them is a *simplification*, and it is
   cheaper than the features that would be added to work around them.
3. **No new machinery where one already exists.** A proposal that adds a store, a
   scheduler, a queue or a panel must first say which existing module it replaces.
4. **The review system stays file-based.** No SQLite for the review/learning system.
5. **The model must actually see the trader's journal.** Any proposal about context
   must be checked against §0: the context is *already computed* — the question is
   whether to send it or to delete the computation.
6. **Minimalist UI.** Less text, no unneeded displays, no new panels.
7. **Every proposal needs a real test**, not a structural review: a browser probe
   where a UI change is involved, a unit test where a computation is, and a
   *behavioural* assertion (the thing the trader sees) rather than a source-shape
   assertion.
8. **Do not re-litigate the deletions.** The debate engine, the moderator, the
   clarification cycle and the post-mortem chain are gone by owner ruling. A proposal
   that reintroduces multi-seat debate must argue it against the *current* product
   goal, not against the old engine.

---

## Appendix — a note on the working tree

During this baseline pass, six source files were modified in the working tree
(`components/agents/AgentsView.tsx`, `components/shared/AnalyzedRow.tsx`,
`components/shared/ChatTranscriptRow.tsx`, `components/shared/ReasoningRow.tsx`,
`components/trade/panels/ChatWorkTimeline.tsx`, `tests/tradeChatTimeline.test.tsx`),
adding a `startedAt` field so a surface switch does not reset a running turn's clock.
This is a research-only task, so the change was **reverted** and preserved verbatim
as `docs/research/REVERTED-unintended-edits.patch` (it can be reapplied with
`git apply`). The baseline was read against the working tree, so the handful of
`file:line` citations inside `components/` may be off by a few lines against `HEAD`.
