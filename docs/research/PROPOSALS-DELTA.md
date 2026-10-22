# Delta review — TRADING-IMPROVEMENTS.md, checked against HEAD

**Auditor:** the independent auditor of `INDEPENDENT-AUDIT.md`. Every August-side
`file:line` claim in the ranked top five was re-opened at HEAD (`f144cdf5`); the
reference-side claims were covered by the 22-report spot-check (§3 of the audit).
Proposals P6–P9 and P11–P12 were **not** independently re-verified line-by-line.

## Per-proposal verification

| Proposal | Central claims | Verdict |
| --- | --- | --- |
| **P1** dead context assembler | `enhancedPrompt` written 4× (`useAnalysisPipeline.ts:1168/1175/1197/1208`), read once by a `devLog` (`:1213`); all three sends use `promptToSend` (`:1258/:1384/:1411`); the "moderator that no longer exists" comment (`memoryContext.ts:139-141`); `generateSynthesizedPromptInjection` has **zero** callers (repo-wide grep: its own definition only); `get_trade_log`/`recall`/`get_setup_history_stats` on the Chat allow-list | **CONFIRMED** |
| **P2** `propose_skill` contract | `reason` in the tool's `required` (`DeskToolsService.ts:1077-1078`, `additionalProperties: false` right below); the handler's argument reads (`:2645-2718`) touch name/kind/when/steps/if_condition/then_action/predicate/… and **never** `reason`; sibling `revise_skill` keeps it (`:2793`); `queueLearningProposal` swallows the write (`catch { /* ignore */ }`) and still returns the new proposal (`utils/learningQueue.ts:122-149`) | **CONFIRMED** |
| **P3** unattended blast radius | `SkillEvalScheduler.ts:284-296` calls `analyzeTradingView` with **no** `allowedTools`; empty list ⇒ all definitions sent (`DeskToolsService.ts:2485`); the seat gate only rejects when the list is non-empty (`:3720-3724`); the job is fired detached (`SkillMemoryService.ts:3797-3798`); the deny-list exists with exactly the 8 consequential names (`automationTurn.ts:56-64`) | **CONFIRMED** |
| **P4** dead subsystems | `TradeValidationGate`: zero **production** imports — the only importer is `tests/accuracyValidation.test.ts:3`; the mentions in `EntryTimingService.ts:588` / `StopLossOptimizerService.ts:336` / `types/analysis.ts:115` are comments. `NavRail` component unmounted: no `<NavRail` in `App.tsx`, pinned by `tests/deadControlsGuard.test.ts:145` (`expect(appSrc).not.toMatch(/<NavRail/)`). `providerFitness`'s named consumer does not exist (grep: the comment only). `ARBITER_ALLOWED_TOOLS`: test importers only. `learning_rules_v2`: no prompt reader (StorageService has a migration reader only). `docs/app-flow.md:608-612` does make the false gate claim. The `AgentsView.tsx:10-14` "do not share a store" banner is stale — `tests/surfaceLiveSync.test.tsx:61` reads both homes from the one `chatSessions` store | **CONFIRMED, with two corrections below** |
| **P5** stopped vs failed turn | `types/message.ts` has **no** `interrupted`; the flag exists only on the dock's `LiveEntry` (`chatSessions.ts:96-103`) | **CONFIRMED** |
| **P10** index vs injection filter | `isIndexableSkill` (`tradeChatContext.ts:265-274`) filters retired/suspended/disabled/manualOnly/audience but has **no approval check**; the injection path checks `isApprovedSkill` (`MemoryRetrievalService.ts:226`); the auto-ingest writes `prior: 'gated'` with no `approvedBy` (`SkillMemoryService.ts:3085-3086`); `applyNotebookSkillsToAnalysis` is live via `presentTradeTool.ts:28/:113` | **CONFIRMED** — phrase precisely: the index lacks the *approval* filter, not all filtering |

## Corrections an implementer must carry into P4

1. **`NavRail.tsx` the file is not wholly dead.** `App.tsx:129` imports
   `AccountRow` and `NAV_RAIL_AUTO_COLLAPSE_PX` from it and uses both. The deletion
   target is the unmounted rail component inside that file (and its dead exports);
   deleting the file outright breaks the build. P4's table row should say
   "component unmounted; file keeps two live exports to relocate".
2. **Do not conflate `TradeValidationGate` with the live gate.** The live pre-trade
   scan is `services/trade/proposalGate.ts` (334 lines, E-57 §5), reached from
   `present_trade`, importing `GateKeeperService` + `AccuracyValidationService` —
   not the dead orchestrator. Deleting `TradeValidationGate.ts` and its
   `runValidationGate` is safe; anything that "fixes the gate" must land in
   `proposalGate.ts`, and P4's commit must not sweep the live one.
3. **The baseline's own correction stands** (`applyNotebookSkillsToAnalysis` is
   LIVE, P4's struck-through row is right). Any stale copy of the baseline that
   still lists it as dead should not be acted on.

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
HEAD. P9's "consult the cooldown bench on the turn path" touches
`ProviderHealthService`, whose read sites were verified as claimed (three, none on
the turn path) by the baseline pass and were not re-audited here.
