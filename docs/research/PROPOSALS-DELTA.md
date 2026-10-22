# Delta review — TRADING-IMPROVEMENTS.md, checked against HEAD

**Auditor:** the independent auditor of `INDEPENDENT-AUDIT.md`. Every August-side
`file:line` claim in the ranked top five was re-opened at HEAD (`f144cdf5`); the
reference-side claims were covered by the 22-report spot-check (§3 of the audit).
Proposals P6–P8 and P11–P12 were **not** independently re-verified line-by-line; P9
was spot-checked here and its premise failed (see "Residual risk").

## Per-proposal verification

| Proposal | Central claims | Verdict |
| --- | --- | --- |
| **P1** dead context assembler | `enhancedPrompt` written 4× (`useAnalysisPipeline.ts:1168/1175/1197/1208`), read once by a `devLog` (`:1213`); all three sends use `promptToSend` (`:1258/:1384/:1411`); the "moderator that no longer exists" comment (`hooks/analysisPipeline/memoryContext.ts:138-140`); `generateSynthesizedPromptInjection` has **zero** callers (repo-wide grep: its own definition at `PatternMemorySynthesisService.ts:589` only); `get_trade_log`/`recall`/`get_setup_history_stats` on the Chat allow-list (`services/trade/chatSurfaceTurn.ts:63`; `chatTurnRunner.ts:107` carries the latter two) | **CONFIRMED** |
| **P2** `propose_skill` contract | `reason` in the tool's `required` (`DeskToolsService.ts:1077-1078`, `additionalProperties: false` right below); the handler's argument reads (`:2645-2718`) touch name/kind/when/steps/if_condition/then_action/predicate/… and **never** `reason` (the only `call.arguments.reason` reads in the file are `:2527`, `:2793` and `:3240`); sibling `revise_skill` keeps it (`:2793`); `queueLearningProposal` (`utils/learningQueue.ts:136-149`) swallows the write — its `write` helper catches and ignores at `:125` — and still returns the new proposal at `:148` | **CONFIRMED** |
| **P3** unattended blast radius | `SkillEvalScheduler.ts:284-294` calls `analyzeTradingView` with **no** `allowedTools`; that parameter (`GenericAnalysisService.ts:270`) rides straight into `streamChatWithDeskTools` (`:452`), where an empty/absent list means **all definitions are sent** (`DeskToolsService.ts:3720-3724`); the executor's seat gate only rejects when the list is non-empty (`:2485`); the job is fired detached (`SkillMemoryService.ts:3797-3798`, `void …`); the deny-list exists with exactly the 8 consequential names (`services/trade/automationTurn.ts:56-59`) but is applied only to the automation turn, not to this scheduler. Conditional on desk tools being enabled — they are by default (`utils/harnessSettings.ts:110`), and `GenericAnalysisService.ts:350` also switches them off for small-context models | **CONFIRMED** |
| **P4** dead subsystems | `TradeValidationGate`: zero **production** imports — the only importer is `tests/accuracyValidation.test.ts:3`; the mentions in `EntryTimingService.ts:588` / `StopLossOptimizerService.ts:336` / `types/analysis.ts:115` are comments. `NavRail` component unmounted: no `<NavRail` in `App.tsx`, pinned by `tests/deadControlsGuard.test.ts:145` (`expect(appSrc).not.toMatch(/<NavRail/)`), but the file keeps **three** live exports (correction 1). `providerFitness`'s named consumer does not exist (grep: the comment only; `tests/decisionBiasClosure.test.ts:80` is a test importer). `ARBITER_ALLOWED_TOOLS` (`DeskToolsService.ts:3341`, 9 names): test importers only. `learning_rules_v2`: no prompt reader (`StorageService.ts:105` loads it into the profile at `useProfilePersistence.ts:116`, `:115` migrates; nothing composes it into a turn). `docs/app-flow.md:606-621` no longer makes either false claim (fixed 2026-10-23; correction 4). The `AgentsView.tsx:10-14` "do not share a store" banner was stale — `tests/surfaceLiveSync.test.tsx:61-62` reads both homes from the one `chatSessions` store, and `docs/app-flow.md:150-152` already promises "one thread, GENERATING in both homes" — and was rewritten 2026-10-23 to say two stores, one thread | **CONFIRMED, with four corrections below** |
| **P5** stopped vs failed turn | `types/message.ts` has **no** `interrupted`; the flag is declared on the **persisted** `StoredChatEntry` (`services/trade/chatSessions.ts:24`, field `:103`) and `chatStore.LiveEntry` (`chatStore.ts:48`) inherits it by intersection — so the dock's rows survive a reload and the Chat surface's canonical row cannot say it stopped (`ChatTranscriptRow.tsx:215` reads `row.interrupted` off the projected shape, not off a `Message`) | **CONFIRMED** |
| **P10** index vs injection filter | `isIndexableSkill` (`services/trade/tradeChatContext.ts:265-273`) filters retired/suspended/disabled/manualOnly/audience but has **no approval check**; the injection path checks `isApprovedSkill` (`MemoryRetrievalService.ts:226`); the auto-ingest writes `prior: 'gated'` with no `approvedBy` (`SkillMemoryService.ts:3085`); `applyNotebookSkillsToAnalysis` is live via `presentTradeTool.ts:28/:113` | **CONFIRMED** — phrase precisely: the index lacks the *approval* filter, not all filtering |

## Corrections an implementer must carry into P4

1. **`NavRail.tsx` the file is not wholly dead.** `App.tsx:129` imports
   `AccountRow` and `NAV_RAIL_AUTO_COLLAPSE_PX` from it, and
   `components/agents/AgentsView.tsx:73` imports `NAV_RAIL_EXPANDED_PX` — **three**
   live exports, used at `App.tsx:2735`, `App.tsx:669`/`:672` and
   `AgentsView.tsx:972` respectively. The dead members are the rail component
   itself, its `export default React.memo(NavRail)` (`NavRail.tsx:242`) and
   `NAV_RAIL_COLLAPSED_PX` (`NavRail.tsx:35`, no importer). Deleting the file
   outright breaks the build. P4's table row should say
   "component unmounted; file keeps **three** live exports to relocate".
2. **Do not conflate `TradeValidationGate` with the live gate.** The live pre-trade
   scan is `services/trade/proposalGate.ts` (334 lines, E-57 §5), reached from
   `present_trade`, importing `GateKeeperService` + `AccuracyValidationService` —
   not the dead orchestrator. Deleting `TradeValidationGate.ts` and its
   `runValidationGate` is safe; anything that "fixes the gate" must land in
   `proposalGate.ts`, and P4's commit must not sweep the live one.
3. **The baseline's own correction stands** (`applyNotebookSkillsToAnalysis` is
   LIVE, P4's struck-through row is right). Any stale copy of the baseline that
   still lists it as dead should not be acted on.
4. **Two false claims lived in the flow doc, and both are now fixed (2026-10-23).**
   `docs/app-flow.md:606-621` used to call `generateSynthesizedPromptInjection`
   "the injected sentence" (it has no caller) and `generateMandatoryPatternCheck`
   "the pre-trade gate that refuses a setup with no evidence" (its only call site is
   `PatternMemorySynthesisService.ts:986`, inside `generatePatternMemoryEnforcementContext`
   (`:982`), whose only consumers are `tests/patternMemoryGate.test.ts`). The
   paragraph now names the live pre-trade gate — `services/trade/proposalGate.ts:152`
   (`assessPlanShape`) — and marks both functions dead on every trade path. The html
   mirror carries the same correction, and the `AgentsView.tsx:10-14` banner was
   rewritten in the same pass to "two stores, one thread" (the old text was true of
   the arrays and false of the thread).

## On the ranked order

The recommended order **P6-decision → P4 → P1 → P2 → P10 → P3** is endorsed. Two
adjustments, neither a re-rank:

- **P2 and P10 are one subsystem** (skills notebook, same schema, same filters).
  Landing them as one pass avoids fixing the index filter onto a contract that then
  changes shape again. Keep them adjacent regardless of commit granularity.
- **P3 is two small wiring changes and a safety property**; if it is convenient to
  land alongside P2 (same file: `DeskToolsService.ts`), doing so costs nothing and
  closes the unattended hole sooner. Visibility is a fine tie-breaker, not a blocker.

## Residual risk the proposals correctly name

P1's verification plan (assert the outbound prompt contains the trader's own W/L via
the mock provider) is the right test shape, and P8's "advance the slot before
dispatch" is the one proposal with real regression risk to the delicate scheduler —
its mitigation (the E-57 §6 tests already pin the breaker) was checked against
`tests/automationSettlement.test.tsx` existence in the run's baseline and holds at
HEAD. **P9's premise did not survive this pass and must be re-derived before it is
built.** It rests on `ProviderHealthService` having "three read sites, none on the
turn path". The three sites are `services/agents/botAttention.ts:12`,
`components/settings/ProviderManager.tsx:16` and `App.tsx:114`; but the third feeds
`App.tsx:329`, inside the `moderatorConfig` memo, and that memo's value is handed to
`useAnalysisPipeline` at `App.tsx:815-820`. So the bench is already consulted on the
analysis path — for the **fallback** provider only, which a per-run selected provider
bypasses. P9 is therefore "widen an existing read", not "add a missing one", and its
cost/benefit changes shape.
