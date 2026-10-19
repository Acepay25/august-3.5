# 2026-10-19-07 — The consolidated open-items register

**Created:** 2026-10-19 · **Pinned commit:** `6a41a9f7` (the audit's pin) — re-verified against
HEAD `56639b4b` at the time of writing.
**Purpose:** this is the surviving record of **everything the plan corpus said that is not yet
implemented**. It replaces the 18 plan documents it was extracted from.

---

## 0. How this register was built

**Sources scanned — 19 plan documents, every markdown file under `docs/` plus the two root
plan-shaped files:**

| file | lines | repo paths it cites | of those, **dead** | % stale |
|---|---|---|---|---|
| `docs/desk/README.md` | 68 | 1 | 1 | **100 %** |
| `docs/plans/chat-dock-reference.md` | 92 | 2 | 2 | **100 %** |
| `docs/plans/debate-deletion-status.md` | 2,404 | 147 | 18 | 12 % |
| `docs/plans/docs-audit-2026-10-06.md` | 224 | 16 | 1 | 6 % |
| `docs/plans/flow-ui-audit-2026-10-15.md` | 429 | 14 | 3 | 21 % |
| `docs/plans/memory-skills-research-2026-10-10.md` | 184 | 11 | 1 | 9 % |
| `docs/plans/redesign-plan-claude-chatgpt-haze-2026-10-10.md` | 571 | 18 | 2 | 11 % |
| `docs/plans/reference-transcript-catalog-copy.md` | 669 | 49 | 12 | 24 % |
| `docs/plans/stage1-ui-ux-spec.md` | 451 | 31 | 11 | 35 % |
| `docs/plans/stage2-implementation-plan.md` | 484 | 24 | 3 | 13 % |
| `docs/plans/stage3-arrangement.md` | 132 | 4 | 1 | 25 % |
| `docs/plans/stage3-status.md` | 83 | 7 | 0 | 0 % |
| `docs/plans/ui-redesign-deep-dive-2026-10-10.md` | 142 | 21 | 8 | 38 % |
| `docs/plans/ui-ux-target-plan-2026-10-11.md` | 250 | 15 | 0 | 0 % |
| `docs/plans/workstream1-status.md` | 383 | 16 | 0 | 0 % |
| `docs/plans/workstream1-stepB-evidence.md` | 167 | 10 | 1 | 10 % |
| `docs/plans/workstream1-stepB-gap-audit.md` | 84 | 0 | 0 | 0 % |
| `HANDOFF_LEARNING_LOOP.md` | 303 | 40 | 5 | 13 % |
| `PLAN_LEARNING_LOOP_AND_UI.md` | 727 | 32 | 3 | 9 % |

**"Dead" = the path the document cites is not in `git ls-files` at HEAD.** The measurement is
automated and reproducible.

**Method.** Every actionable item in every document was extracted, then verified against HEAD: does
the code it describes exist? Each row below carries the `file:line` that proves it is **still
open**. Where a prior row was found to be **stale**, that is stated — this register does not
propagate claims it could not re-verify.

**Status vocabulary.**

| status | meaning |
|---|---|
| **OPEN** | not implemented at HEAD, and the evidence is cited |
| **OPEN-VERIFY** | believed open, but the evidence is one measurement away and this audit did not take it |
| **DONE** | the item was in a plan doc and **is** implemented at HEAD — recorded so the deletion is auditable |
| **CORRECTED** | a prior audit's row did not survive re-verification; the correction is recorded |
| **OWNER** | needs a decision from the trader, not code |
| **DEFERRED** | deliberately deferred by the owner; do not re-pick without a ruling |

**Severity** is as claimed by the source document, not re-derived.

---

## 1. The register

### 1.1 Signal, plan and gate

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-01 | **The validation gate scores R:R from `takeProfit[0]`** while the card, the journal and the clamp use the **nearest** target. A 1:1 plan can be gated as 2:1. | `flow-ui-audit` (C-2), `redesign-plan` | **OPEN** | `services/validation/TradeValidationGate.ts:589` → `AccuracyValidationService.ts:196-222` vs `utils/riskReward.ts:48` → `utils/analysisUtils.ts:1272-1278` | **E-02** |
| O-02 | **A second R:R inside the same gate run** — the scalp/swing validators each compute their own index-0 ratio. | `redesign-plan` | **OPEN** | `services/analysis/ScalpDetectionService.ts:178`, `:236`, called at `TradeValidationGate.ts:889`, `:899` | **E-02** |
| O-03 | **A third R:R outside `utils/riskReward.ts`** — the chart-drawing label prints its own `:1` ratio. | — | **OPEN** | `services/trade/chartDrawings.ts:608-615` | **E-02**, **E-34** |
| O-04 | **A fourth** — the pattern-memory synthesis picks `takeProfit[0]` for a loss/reward figure. | — | **OPEN-VERIFY** | `services/learning/PatternMemorySynthesisService.ts:260-268` | **E-34** |
| O-05 | **The R:R floor measures the nearest target while the scorer pays the ladder** — a plan whose nearest target is 0.59R is capped at 54 % and downgraded, and it then ran to TP3 for 1.65R. | `06-independent-review` §2.2 | **OPEN** | `utils/analysisUtils.ts:1431-1438` | **E-02** |
| O-06 | **The gate caps, it does not refuse.** "Make the gate refuse, not just cap." | `06-independent-review` M2 | **OPEN** | `services/validation/TradeValidationGate.ts:943` — `isValid: errors.length === 0`; a scored failure is a warning + a downgrade | **E-43** |
| O-07 | **`minEdge` gate** — refuse a plan whose net expectancy at its own probability is ≤ 0 after fees. | `06-independent-review` §3.4 | **OPEN** | no expectancy test exists in the gate | **E-43** |
| O-08 | **The deterministic baseline** — "has anyone asked whether the model beats a fixed rule?" | `06-independent-review` B4 | **OPEN** | — | **E-20** (headline use case) |
| O-09 | **The exit model is an unrecorded assumption** — the 50/50 blend and the 150 % zone are policy, not data. | `06-independent-review` B2 | **OPEN** | `services/backtesting/outcomeEngine.ts:69-71` (blend), `:119-121` (150 % zone) | **E-20** |
| O-10 | **The full validation gate is NOT wired** — `runValidationGate` has zero production importers. **Verified 2026-10-20**: `grep 'runValidationGate\|TradeValidationGate'` over every non-test file returns **only the definition and two comments in other files offering to feed it** (`services/analysis/EntryTimingService.ts:588`, `services/backtesting/StopLossOptimizerService.ts:332`). Only the narrower `GateKeeperService` (confidence cap + family pre-filter) is live, via `services/trade/proposalGate.ts`. | `06-independent-review` §2.6 | **OPEN — was OPEN-VERIFY** | `services/validation/TradeValidationGate.ts:495`; the two comments above | **E-02a / E-02b** (wire it, or retire it) |
| O-11 | **The deterministic skill layer is computed and dropped** — `applyNotebookSkillsToAnalysis` (the hard `avoid` veto, the candidate cap, the confidence downgrade) has **ten test call sites and zero production call sites**. | — | **OPEN** | `services/learning/SkillMemoryService.ts:3494` (definition); every call is in `tests/` | **E-35** |
| O-12 | **The veto ledger is read and never written** — `VetoLedgerService.recordVeto`: seven test call sites, zero production. | — | **OPEN** | `services/ui/VetoLedgerService.ts:90` | **E-35** |
| O-13 | **The predicate ceiling is computed and discarded** — `skillPredicateGate.ceiling` never reaches a recorded probability. | `06-independent-review` QW8 | **OPEN** | `services/learning/skillPredicateGate.ts:78`, `:200` | **E-35** |
| O-14 | **A decline leaves no object** — there is no `NO_TRADE`/`HOLD` outcome; a model that declines presents nothing, so "are we skipping winners?" is unanswerable. | `06-independent-review` §2.16 | **OPEN** | `types/enums.ts:9-15` — no HOLD member | **E-42** (decline tool) |
| O-15 | **The live prompt has no confidence ladder, no R:R rule, no risk rules, no stop guidance, and no "no trade is a decision"** — the trading-analysis corpus reaches a model only through the skill-eval harness. | `06-independent-review` QW5 | **OPEN** | `constants/prompts/analysisPrompts.ts` is reachable only via `services/learning/SkillEvalScheduler.ts:284` | **E-01** (contract injection) |
| O-16 | **A stored row already violates the ladder** — "Low / 58 %" was stored where Low is 40–54 %. | `06-independent-review` §2.2 | **OPEN-VERIFY** | the ladder lives in `constants/prompts/harnessContract.ts:11`; the *derivation* of the word from the number is not in one place | **E-01**, **E-35** |
| O-17 | **The live prompt is ~15 lines of mandate plus 30 tool schemas**; of 1,245 lines of prompt text in `constants/prompts/`, only `chatPrompts.ts` is on the live path. | `06-independent-review` §2.4 | **OPEN** | — | **E-01**, **E-30** |
| O-18 | **The live prompt's confidence ladder and the code's bands are separate derivations.** | `06-independent-review` QW5 | **OPEN** | `utils/analysisUtils.ts:1445+` `retierConfidenceForClamp` vs `constants/prompts/harnessContract.ts:11` | **E-01** |

### 1.2 Risk, cost and size

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-19 | **There is no cost model anywhere** — no fee, slippage or funding term is ever charged. Every R, win rate, calibration bucket and the whole skill ledger is **gross**. | `05-lead-findings` §A.1, `06-independent-review` §2.3 | **OPEN** | a repo-wide search for `takerFee\|makerFee\|feeRate\|commission\|costBps` returns **0** files; `netR` (`services/learning/SkillMemoryService.ts:1431`) is the sum of **gross** R multiples | **E-03** |
| O-20 | **The permitted-floor trade nets ≈ 0 R** once the round trip is charged; the breakeven win rate moves 45.5 % → 50.0 %. | `05-lead-findings` §A.2 | **OPEN** (the rate is an **assumption**, flagged) | — | **E-03** |
| O-21 | **The loss size is −1.0R *or* −1.5R by an unvalidated rule**; in the extended-zone world the gate's own ≤54 % cap is arithmetically below the 59.3 % breakeven. | `05-lead-findings` §A.3 | **OPEN-VERIFY** | `services/backtesting/outcomeEngine.ts:119-121` `extendedSlPrice` | **E-03** |
| O-22 | **A "win" at TP1-then-breakeven is a net loss** — the app would book +0.30R gross and **−0.23R net**. | `06-independent-review` §2.2 | **OPEN** | `services/backtesting/outcomeEngine.ts:69-71` | **E-03** |
| O-23 | **The app emits entries, stops and targets and never a quantity.** `computeContractSize` is imported only by tests. | `06-independent-review` §2.3 | **OPEN** | `utils/ticketSize.ts:89-182` — test-only importers | **E-12** |
| O-24 | **The default leverage is 100×**, and the liquidation buffer lives in the unreachable module. At 100× a 0.19 % stop is a ~15.9 % account move at 1R on full notional, and a 1 % wick is a total loss. | `06-independent-review` §2.3 | **OPEN** | `utils/conversationUtils.ts:6` `DEFAULT_LEVERAGE = 100`; `utils/ticketSize.ts:194` `computeLiquidationBuffer` unreachable | **E-12**, **E-41** |
| O-25 | **`equityUsd` is configured in Settings and read by nothing in production** — its only reader, `SessionGuardService`, is unreachable. | `06-independent-review` §2.3 | **OPEN** | `components/settings/SessionUsagePanel.tsx:149` (writer) → `services/infrastructure/SessionGuardService.ts` (unreachable reader) | **E-12** |
| O-26 | **A presented plan never expires** — `validityDurationMinutes` is declared, transformed and read, but **no producer sets it**, so `ENTRY_NOT_HIT` is never written and the denominator excludes every setup that never triggered. | `06-independent-review` §2.9 | **OPEN** | `schemas/tradeAnalysis.ts:218`, `:468`; `services/analysis/ScalpDetectionService.ts:86`; `hooks/useTradeLogging.ts:301` ("label-only, so no `validityDurationMinutes` appears on a…") | **E-38** |
| O-27 | **The trading-contract floor never binds** — the R:R floor measures the nearest target and the confidence ladder is a separate derivation. | `06-independent-review` QW7 | **OPEN** | `utils/analysisUtils.ts:1431-1438` | **E-02** |

### 1.3 The learning loop, the skills and the evidence

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-28 | **Settlement requires a human click** — the autopilot detects and stores a resolution, but the row is written only in `handleConfirmAutopilot`, and `markProcessed` sits after that click. With `isAutoCapturing` defaulting off, the click is the only path. **Every learning consumer is starved behind it.** | `05-lead-findings` §B, `06-independent-review` §2.10 | **OPEN** | `hooks/useWatchAndAutopilot.ts:185-215`; `services/ui/OutcomeAutopilotService.ts:650`; `hooks/useUserProfileLoader.ts:227` | **E-18** |
| O-29 | **The evidence floors are tuned for a world with no outcomes** — `MIN_SAMPLE_FOR_VETO = 2` (a two-trade sample can **zero a real setup**), `MIN_CLUSTER_FOR_SKILL = 3`, `MIN_SAMPLE_CONFIRMED = 5`. **This is a same-release dependency of O-28, not a follow-on.** | `06-independent-review` §2.11 | **OPEN** | `services/learning/SkillMemoryService.ts:352` (`MIN_CLUSTER_FOR_SKILL`), `:353` (`MIN_SAMPLE_CONFIRMED`), `:379` (`MIN_SAMPLE_FOR_VETO`) | **E-37** |
| O-30 | **The rules store has no reader** — `learning_rules_v2_<user>` is read by backup sweeps and Preferences constants only, never by a prompt. | `memory-skills-research` §0, `ui-ux-target-plan` R2, `HANDOFF` | **OPEN** | `services/learning/StorageService.ts:106-137`; no prompt reader | **E-28** (cleanup) |
| O-31 | **The post-mortem route is starved, not deleted** — 25 read accesses across 17 files; `craftSkillFromPostMortem` is still called but its guard returns null for every post-2026-10-18 trade. | `debate-deletion-status` | **OPEN (owner-accepted)** | `services/learning/SkillMemoryService.ts:2664` `ingestIfThenFromTrade` (live, via `syncClosedTradeToNotebook:3312`) | **E-18**, and the owner decision on #21 |
| O-32 | **14 paths make a rule, skill or strategy active with no human approval** — 12 pre-seeded `book-*` skills, the IF/THEN auto-ingest, the LLM worth-gate `create`, the candidate→confirmed evidence ladder, the A/B-eval promotion, shadow refinement auto-promotion, consolidation/generalization, idle suspend/auto-revive. | `workstream1-stepB-evidence` | **OPEN** | `services/learning/seedStrategies.ts:234-252`; `SkillMemoryService.ts:2386,2406,2898`; `skillSupervisor.ts:209,570`; `supervisorStore.ts:84` `autoEnabled = true`; `SkillMemoryService.ts:1421-1442`; `:2432-2543`; `skillIdleLifecycle.ts:235-243,265-272` | **E-35**, **E-37** |
| O-33 | **Nothing checks `approvedBy` or `whyAccepted` at injection time.** | `workstream1-stepB-evidence` | **OPEN** | no gate on the injection path | **E-35** |
| O-34 | **The supervisor's auto-triage runs by default.** The off-switch is exposed in the supervisor panel (`setAutoEnabled`) and the panel is mounted in Learn. The default-on behavior remains; only the "no UI off-switch" half was wrong. | `docs-audit-2026-10-06` | **DONE** | `services/learning/supervisorStore.ts:84` `autoEnabled = true`; `components/learn/SupervisorStream.tsx:202`; mounted at `components/learn/LearnView.tsx:304` | **E-35** |
| O-35 | **The post-mortem still has 5–6 writers** (`trade.postMortem`, `trade_summaries`, the conversation message, thinking turns, `globalMemory`) — and the post-mortem writer itself was deleted, so all five are frozen. | `workstream1-status` | **OPEN** | the writer is gone; the readers remain | **E-18** |
| O-36 | **`trader-diary/` is write-only** — two comments claim it feeds doctrine rewrites and skill gates. | `learning-loop-map` | **OPEN** | — | cleanup |
| O-37 | **`GlobalMemory.aiPatternMemory` is a frozen legacy field** and top-level `insightKnowledgeBase` is carried, not used. | `learning-loop-map` | **OPEN (low)** | `services/learning/MemoryService.ts`; `services/learning/AlgorithmicMemoryService.ts:40` sets `insights: []` | cleanup |
| O-38 | **`SkillMeta` has ~35 fields** vs the Agent Skills spec's 2 — "a database row wearing markdown". | `memory-skills-research` §3 | **OPEN** | `services/learning/SkillMemoryService.ts` | E-21 (the split landed; the row remains) |
| O-39 | **Skills and `rules/risk-rules.md` can express the same sentence** — two injection sites, no dedup. | `memory-skills-research` §3 | **OPEN** | — | E-30 |
| O-40 | **The doctrine slot is an always-on layer outside the budget** — "an unaccounted always-on layer is how a memory system silently crowds out the chart." | `memory-skills-research` §3 | **OPEN** | `utils/memoryBudget.ts`; the slot is deliberately outside the stage budget | E-30 |
| O-41 | **Nothing is pulled** — the model cannot ask for more of a skill it was told exists. | `memory-skills-research` §3 | **OPEN** | the pull tools exist (`recall`, `get_notebook_map`, `read_memory`) but no skill is pulled automatically | **E-18**, N-18 |
| O-42 | **Nine Improve-list items, none started** — regime backfill, holdout observable, LESSON token, room recorder, `finalTradeSummary` symmetry, post-mortem `recordInjections:false`, fold `skillIdleLifecycle` into `evaluateSkillLifecycle`, one `isLiveSkill`, per-file persist keys. | `HANDOFF_LEARNING_LOOP` | **OPEN** | — | mostly folded into **E-05** and **E-18** |
| O-43 | **Seven Tier-2 product decisions, none started** — one inbox, one supervisor view, hide the `approvedBy:'supervisor'` badge, drop the load→persist-only stores (incl. `learning_rules_v2`), unify the two bot registries, diary cap 50→20, gate the auto-mint behind a button. | `HANDOFF_LEARNING_LOOP` | **OWNER** (some now moot) | the two bot registries were unified by the in-flight work | **E-35**, cleanup |
| O-44 | **The "Try now" button for a throttled worth-gate cluster** — no UI button was added. | `HANDOFF_LEARNING_LOOP` | **OPEN (low)** | — | E-35 |

### 1.4 Evaluation, replay and the journal's record

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-45 | **No shadow-promotion e2e** — a settled real window never asserts the promoted prose line. | `workstream1-status` | **OPEN** | `tests/skillRefinement.test.ts` pins serialization only | **E-20** |
| O-46 | **The journal row records no feature snapshot** — `buildProposedTradeAnalysis` writes `marketConditions` as literal dashes, so RSI/ATR/ADX at decision time are unrecoverable. | `06-independent-review` §2.12 | **OPEN** | `services/trade/proposedTrade.ts:160-162` | **E-12** |
| O-47 | **The journal row records no prompt** — `promptVersion` is copied from `message.runStats` but nothing writes `runStats.promptVersion` any more. | `06-independent-review` §2.12 | **OPEN** | `hooks/useTradeLogging.ts:355`; `utils/promptVersionStats.ts:45-57` | **E-13** |
| O-48 | **`LoggedTrade.timestamp` is the WRITE time**, so every dashboard groups by confirmation time, not decision time. | `06-independent-review` M6 | **OPEN** | `hooks/useTradeLogging.ts:307` (`new Date()`) vs `:284` (`message.createdAt`); read by `WinRateDashboard.tsx:117-125`, `EquityCurveDashboard.tsx:34-43`, `LearningDashboard.tsx:106` | **E-40** |
| O-49 | **The live-journal counts were never obtained** — the number of rows under the packaged app's `app://` IndexedDB. | `stage3-arrangement` | **OPEN** | — | E-20 |
| O-50 | **Pre-F3a rows carry no `planId`** and can therefore be re-logged. | `stage3-status` | **OPEN (accepted)** | — | — |
| O-51 | **No daily or per-candle candidate scan** — `run_screener` walks the universe deterministically but is only called on demand; automations have **no symbol field**, so the instrument comes from the prompt text; no `shadow`/`candidate` store exists. | `06-independent-review` §2.16 | ✅ **DESIGN APPROVED (owner, 2026-10-20)** — a **365-day candidate log** under **`userData/candidates/`**, **included in backup and export**. The *implementation* is staged behind the earlier dry run (D-24). | `services/trade/screener.ts:110`; `types/automation.ts:34-68` | **E-35** (shadow log) |

### 1.5 Prompt surface and tools

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-52 | **Twelve (now fewer) debate prompt entries were still user-editable with zero effect** — the app was handing the trader an editor for text it never sends. | `06-independent-review` §2.14, `docs-audit` | **DONE** | the registry is 11 live ids, unreachable ceiling 0 (`tests/promptsAreWired.test.ts`); the 2026-10-19 deletion removed the rest | — |
| O-53 | **Remaining stale user-visible strings** naming the deleted debate engine. The 2026-10-20 copy pass fixed the named strings in InlineVerdict, AutomationEditorModal, ChatComposer, GroupChatView, SessionUsagePanel, StrategiesManager, GeneralTab, ToolForgeManager and StrategyStudio. Remaining: the automation editor's error “Pick the moderator model” (`AutomationEditorModal.tsx:238`), the legacy `Ensemble` / `Mod:` badges on old trades (`TradeLog.tsx:347,349`), the moderator/ensemble cells on old monthly reports (`MonthlyReportCard.tsx:64-67`), and the `moderator` search keyword (`SettingsMenu.tsx:179`). | `06-independent-review` §2.14 | **OPEN** | `components/automation/AutomationEditorModal.tsx:238`; `components/journal/TradeLog.tsx:347,349`; `components/journal/MonthlyReportCard.tsx:64-67`; `components/settings/SettingsMenu.tsx:179` | Report 4 Batch 1 |
| O-54 | **The `Debate cost cap (USD, 0 = off)` control caps nothing** — the flag is loaded and displayed but never read. | — | **OPEN** | `utils/harnessSettings.ts:13`, `:86-87`; `components/settings/SessionUsagePanel.tsx:327,332-333`; `tests/desktopUsageBridge.test.ts:11` says the guard "NEVER FIRED" | Report 4 §2.13 |
| O-55 | **The "Prompt A/B (control lane)" control does nothing** — `beginPromptLane` has zero call sites and `runStats.promptLane` is never assigned. | `debate-deletion-status` | **OPEN** | `services/infrastructure/PromptOverrideService.ts:24-38`; `hooks/useAnalysisPipeline.ts:1242,1403` | **E-13** |
| O-56 | **The default reasoning effort for a trade decision is `low`** — `EFFORT_BY_TASK.chat = 'low'`; the Chat surface and the dock both pass it through. | `06-independent-review` §2.13 | **OPEN** | `services/providers/reasoningControls.ts` (`EFFORT_BY_TASK`); `services/trade/chatSurfaceTurn.ts:266,327` | **E-39** |
| O-57 | **Temperature is not what is configured** — the chat turn asks for 0.4 and automation 0.3, but on a thinking-enabled Anthropic model the transport omits it. | `06-independent-review` §2.13 | **OPEN** | `services/trade/chatSurfaceTurn.ts:265`; `services/trade/automationTurn.ts:198`; `shared/providerRequestPolicy.cjs:180-185` | **E-39** |
| O-58 | **No prompt caching** — each of up to 8 tool rounds re-sends the system prompt, 30 tool schemas and every prior result. | `06-independent-review` §2.13 | **OPEN** | no `cache_control` anywhere in `services/providers` or `shared` | **E-30** |
| O-59 | **The full tool-schema tax is ~7,864 tokens per request on the dock** — seven times the mandate that tells the model what kind of assistant to be. | — | **OPEN** | `services/analysis/DeskToolsService.ts:820` (39 definitions) | **E-30** |
| O-60 | **The model is told to call a tool its allow-list refuses** (`get_chart_view` on the chat surface). | — | **OPEN** | `services/analysis/DeskToolsService.ts:1600` vs `services/trade/chatSurfaceTurn.ts:55-76` | **E-30** |
| O-61 | **The `harnessTurn` mark is used in the user role on every desk turn and explained nowhere** — the only text that defines it is the contract, which the desk never receives. | `06-independent-review` | **OPEN** | `utils/harnessMarks.ts` `harnessTurn()` (4 writers, all in the desk-tool loop) vs `constants/prompts/harnessContract.ts:18` (skill-eval only) | **E-01** |
| O-62 | **The market packet may be stale or missing and the prompt does not say so** — it promises a *fresh* packet, the code serves an 8-second cache, and a failed fetch substitutes a bare "packet unavailable". | `06-independent-review` §2.15 | **OPEN** | `services/trade/tradeChatContext.ts:83` (substitution), `:168` (the "fresh" claim) | **E-33** |
| O-63 | **The spot mirror can silently feed perp analysis** — the gate and the predicates consume whatever came back. | `06-independent-review` §2.15 | **OPEN** | `services/analysis/KlineService.ts:10-13`; the packet discloses "degraded" (`HybridIntelligenceService.ts:908-910`) but the gate does not | **E-33** |
| O-64 | **Monte Carlo can assume its own volatility** — with `atr` omitted, the model uses 2 × stop distance. | `06-independent-review` §2.15 | **OPEN** | `services/analysis/HybridIntelligenceService.ts:1514-1531` | **E-33** |

### 1.6 UX, accessibility and the design system

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-65 | **No `aria-live` anywhere near the streaming transcript** — a screen-reader user gets no announcement that an answer arrived, nor the answer. | `flow-ui-audit` | **OPEN** | `components/trade/panels/ChatTranscriptList.tsx` (292 lines) and `components/shared/ChatTranscriptRow.tsx` (206 lines) have no `aria-live`, no `role="log"`, no `aria-busy` | **E-11** / the a11y doc |
| O-66 | **Seven of eighteen dialogs have no focus trap** — worst is `components/automation/AutomationEditorModal.tsx:291` (a 573-line CRUD modal with `role="dialog"`, no `aria-modal`, no trap, no restore). | `flow-ui-audit` | **OPEN** | as cited | a11y doc |
| O-67 | **The composite roles advertise keyboard contracts they do not have** — four tablists, a radiogroup, five menus. | `flow-ui-audit` | **OPEN** | the good pattern exists at `components/journal/Journal.tsx:170-183,264-297` | a11y doc |
| O-68 | **Four pickers/menus are unusable without sight** — `ModelPicker`, `SymbolPicker`, `SelectMenu`. | `flow-ui-audit` | **OPEN** | ~20 `SelectMenu` call sites | a11y doc |
| O-69 | **No `EmptyState` offers a next action** — 17 call sites, 0 pass `action=`. | `ui-redesign-deep-dive` | **OPEN** | — | a11y doc |
| O-70 | **Buttons and a switch that never render** — `onAddSkill`/`onOpenSkillsSettings` never passed; the global-memory switch never rendered. | `ui-redesign-deep-dive` | **OPEN** | — | a11y doc |
| O-71 | **Lazy surfaces without a skeleton** — 20 `fallback={null}`. | `ui-redesign-deep-dive` | **OPEN** | `App.tsx` has a `SurfaceSkeleton` for the four surfaces, but the modals do not | a11y doc |
| O-72 | **The flagship run is a black box** — the step ladder is muted for the dock's "Full analysis". | `flow-ui-audit` | **OPEN** | `components/analysis/AnalysisProgress.tsx` is imported but the "Full analysis" path does not mount it | a11y doc |
| O-73 | **The desk home, which runs the longest jobs, has no Stop.** | `flow-ui-audit` | **OPEN** | — | a11y doc |
| O-74 | **An answer cut off at the token ceiling is silent in every chat home.** | `flow-ui-audit` T7 | **OPEN** | and the truncation tally itself has no reader — `utils/finishReason.ts` `beginTruncationWindow`/`consumeTruncations`/`peekTruncations` have **zero** production call sites | **E-13** |
| O-75 | **The background autopilot logs a pinned setup 15 s after detection.** | `flow-ui-audit` F-h | **OPEN** | `hooks/useWatchSideEffects.ts:55` still toasts `'Logging in 15s'` | a11y doc |
| O-76 | **The skill record never shows the trades that earned it** — "the single biggest 'why' hole". | `flow-ui-audit` L-a | **OPEN** | — | N-14 |
| O-77 | **The Journal never says what a trade taught the app.** | `flow-ui-audit` L-b | **OPEN** | — | N-13 |
| O-78 | **Two homes called "Skills"; the catalog gear's reason is false.** | `flow-ui-audit` L-c | **OPEN** | — | a11y doc |
| O-79 | **The weekly/monthly review cards return `null`** — "pending", "failed" and "never ran" are indistinguishable. | `flow-ui-audit` L-d | **OPEN** | `services/learning/weeklyReview.ts:135` (`MIN_CLOSED_TRADES_FOR_REVIEW = 3`) | N-15 |
| O-80 | **The forged-tool queue count has no destination.** | `flow-ui-audit` L-e | **OPEN** | — | a11y doc |
| O-81 | **Agents shows `N lessons · N skills · N evidence` that cannot be opened.** | `flow-ui-audit` L-f | **OPEN** | `components/agents/AgentsView.tsx:1065` | a11y doc |
| O-82 | **One fact, several homes** — Skills in Learn *and* Settings; approvals at four addresses; one number formatted four ways; the same event in local time in five panels and PHT elsewhere. | `flow-ui-audit` | **OPEN** | `utils/timezone.ts`; 7 duplicate "Xm ago" implementations | Report 4 §2.8 |
| O-83 | **Density is the one place the app is not calm** — 57 % of type at 11–13 px, ~520 white-alpha borders, 71 stock overlay shadows. | `flow-ui-audit` | **OPEN** | — | a11y doc |
| O-84 | **Nine semantic aliases are declared and unused** — the app speaks `zinc-900` and `border-white/10`. | `flow-ui-audit` T3-1 | **OPEN** | re-measured: `bg-surface-raised` 1, `border-hairline` 0, `text-ink-*` 0, `text-trade-up/down` 0, `border-white/10` 195, `border-white/5` 123 | a11y doc |
| O-85 | **`SurfaceTitle`, `SectionLabel`, `Button` primitives do not exist.** | `flow-ui-audit` T3-2/T3-3 | **OPEN** | 0 hits for `SurfaceTitle` and `SectionLabel` | a11y doc |
| O-86 | **Radius tokens are not gated** — "no test gates it at all". | `ui-redesign-deep-dive`, `redesign-plan` | **OPEN** | `tests/radiusRamp.test.ts` exists and cites the redesign plan, but the token sweep is ungated | a11y doc |
| O-87 | **The type ramp in the doctrine is 2 px wrong on every step** and five roles short (`lede`, `price`, `display`, `hero`, `micro`). | `ui-doctrine` | **OPEN** | `docs/ui-doctrine.md:63` says 18/16/14/13/12/11/10/9 with a 14 px base; `index.css:304` is **16 px** | **docs fix** |
| O-88 | **No mobile *layout*** — safe chrome, but 100 of ~137 component files have no breakpoint class. | `06-independent-review` / a11y | **OPEN** | `sm:` 242, `lg:` 39, `md:` 27, `xl:` 3, `2xl:` 0 | a11y doc |
| O-89 | **The status-colour doctrine is a proposal, not a contract** — `utils/runStatus.ts` says *"Never hardcode a status colour in a component"* and has **2** consumers; 15+ files hardcode the palette. | `06-independent-review` / a11y | **OPEN** | `utils/runStatus.ts:28-60`; `components/dashboards/WinRateDashboard.tsx` 25, `components/ui/ScenarioSimulator.tsx` 22, `components/market/LiveMarket.tsx` 19, `components/journal/TradeLog.tsx` 12, `components/shared/Header.tsx` 12 | a11y doc |
| O-90 | **The `surface-census.cjs` leaf selector only matches `[learn-view]`** → `leafCount: 0` for four surfaces. **It blocks the type-dial gate.** | `redesign-plan` | **OPEN** | `scripts/surface-census.cjs` | cleanup + a11y doc |
| O-91 | **The `ui-inspect.cjs` probe assertion is stale** — it expects 7 nav rows; the app has 5. | `redesign-plan` | **OPEN** | `scripts/ui-inspect.cjs:215` | cleanup |
| O-92 | **The `NavRail` is imported and never rendered** — a dead node. | `app-flow` correction 5 | **OPEN** | `App.tsx:121` imports it; no `<NavRail` JSX exists in the app | cleanup |
| O-93 | **The chat surface's second column, the quick-prompt chip cloud and the dock header icon set** were deliberately deferred. | `chat-dock-reference` | **DEFERRED** | — | — |
| O-94 | **The debounce/typing/clarification rungs** and the per-model `<details>` standardisation were dropped or deferred. | `stage2-implementation-plan` | **DEFERRED** | — | — |
| O-95 | **Per-agent win rates, light theme, settings value-search, updater rollback, multi-symbol sampling** — deferred by the owner. | `stage2-implementation-plan` | **DEFERRED** | — | — |

### 1.7 Data, stores and infrastructure

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-96 | **Write-time bounds are counts, not bytes** — `trade_chat_sessions_v1` bounds 12 × 60 entries, `MAX_IMAGE_CHARS` = 1,200,000; the export side is bounded (3,500,000) but the **write** side is not. *"The only genuine data-loss path found."* | `workstream1-status`, `docs-audit` | **OPEN** | `services/trade/chatSessions.ts:147`, `:329`; `services/infrastructure/ExportService.ts:418-427` | **E-14** |
| O-97 | **Three byte-cap risks** — `trade_session_drawings_v1` keeps every coin; `desk_tools_forged_v1` and `trading_checklist_v1` have no count cap. | `workstream1-stepB-gap-audit` | **OPEN** | `services/trade/chartDrawings.ts:187` | **E-14** |
| O-98 | **The `approval_rules_v1:<user>` store is on neither backup allow-list** — it gates every auto-apply. | `tests/exportRawLocalStorage.test.ts:97` | **OPEN (owner decision)** | `utils/approvalInbox.ts:46` | **E-14**, Q4 |
| O-99 | **Five namespaces are restore-listed but not raw-listed** — on native they are neither exported nor restored. | — | **OPEN (owner decision)** | `trade_sidebar_open_v1`, `agent_threads_opened_v1`, `desk_idle_motion_v1`, `thinking_leak_bin_v1`, `last_active_user` | **E-14**, Q4 |
| O-100 | **The two chat stores are half-migrated** — the instruction is *"document the two chat stores, do not half-migrate them"*, and they are **still undocumented**. | `flow-ui-audit` | **OPEN** | — | docs |
| O-101 | **The legacy `userData` rename is untested**; `migrateLocalStorageToPreferences` is mocked, not exercised. | `06-independent-review` | **OPEN** | `electron/main.cjs:49-77`; `tests/dbServiceImageGc.test.ts:43` | **E-24** |
| O-102 | **No logger and no packaged log sink**; `no-console` is off. | `docs-audit` | **DEFERRED** | ~740 `console.*` calls; `eslint.config.js:136` | **E-31** |
| O-103 | **SQLCipher off.** | `docs-audit` | **DEFERRED** | `services/infrastructure/SqliteService.ts:113` | — |
| O-104 | **No key pool.** | `docs-audit` | **DEFERRED** | — | — |
| O-105 | **`App.tsx` is ~2,579 lines.** | `docs-audit` | **OPEN (low)** | `App.tsx` | **E-25** |
| O-106 | **The `fullscreen` right-panel branch is computed and never used** — *"either is honest, silently deleting it is not."* | `docs-audit` | **OWNER** | `hooks/useRightPanel.ts:127`; `components/trade/TradeView.tsx:1097` pins `"push"` | **E-17** |
| O-107 | **The release workflow does not run `check-flow-doc-anchors` or `skill-approval-probe`** — a tag can publish with a dead line number in the flow docs. | `app-flow` | **OWNER** | `.github/workflows/release.yml` | — |
| O-108 | **The census half's provider sentences bind only their FIRST match.** | `debate-deletion-status` | **OPEN (known limit)** | `scripts/check-flow-doc-anchors.cjs` | — |
| O-109 | **The git-history half prints `SKIPPED` on a shallow clone** (CI depth 1) — *"a gate that cannot see git history must say so instead of reporting zero findings."* | `debate-deletion-status` | **OPEN (known limit)** | `scripts/check-flow-doc-anchors.cjs:670-675` | — |
| O-110 | **The calibration ledger is an unresolved product decision.** | `debate-deletion-status` | **OWNER** | `services/validation/CalibrationLedgerService.ts` + store/policy/prompts | N-17, Q |

### 1.8 Ownership decisions still owed (24)

**Taken from the plan corpus and the previous audit, deduplicated.** These are not code; they are
rulings only the trader can make. **Each has a proposed default in Report 5 §4.**

| # | decision | source |
|---|---|---|
| D-01 | does the outcome need a human click? | `05-lead-findings` §B, `06-independent-review` §2.10 |
| D-02 | inject the context or delete the assembly? | `06-independent-review` M1 |
| D-03 | what is your actual fee tier? | `06-independent-review` §2.3 |
| D-04 | what belongs in a backup? | `tests/exportRawLocalStorage.test.ts:97` |
| D-05 | is the Analyst Lens feature staying? | the 2026-10-19 deletion |
| D-06 | is the Android gallery feature wanted? | `06-independent-review` (the `GallerySaver` half-feature) |
| D-07 | where should the render-time `<think>` / `<JSON_PLAN>` strip live? | `debate-deletion-status` §11.2 |
| D-08 | should old post-mortems and old debate transcripts stay readable? (#21) | `debate-deletion-status:2061-2068` |
| D-09 | how many minds should answer "Full analysis"? (#19) | `debate-deletion-status:2053-2059` |
| D-10 | what replaces the analysis branch? | `debate-deletion-status:110-147` |
| D-11 | the gate scan: inside `present_trade` or its own tool? | `debate-deletion-status:138-140` |
| D-12 | the `reasoningEffort` side-channel | `debate-deletion-status:142-143` |
| D-13 | which tools are meaningless without a chart? | `debate-deletion-status:144-146` |
| D-14 | the Stage 5.3 rating store | `reference-transcript-catalog-copy:667` |
| D-15 | the Stage 10M audio wire format | `reference-transcript-catalog-copy:668` |
| D-16 | the 7 Tier-2 product decisions | `HANDOFF_LEARNING_LOOP:213-235` |
| D-17 | the 9 Improve-list items | `HANDOFF_LEARNING_LOOP:239-259` |
| D-18 | the doctrine slot's 1,150 characters | `memory-skills-research:133` |
| D-19 | merging the two rails | `flow-ui-audit:240` |
| D-20 | the brand-mark spinner | `flow-ui-audit:242` |
| D-21 | the HUD wording | `ui-ux-target-plan:249` |
| D-22 | the coach row renders the greeting pane, not the transcript | `PLAN_LEARNING_LOOP_AND_UI:720-725` |
| D-23 | per-agent win rates | `stage2-implementation-plan:478` |
| **D-24** | **The candidate log's shape is approved; its implementation waves are not.** The 365-day log under `userData/candidates/`, included in backup/export, is **approved as a design**. **The later waves that follow it are NOT approved and wait on the earlier dry run** (Phase 3, the outcome loop) before any of them is built. | owner, 2026-10-20 |

### 1.9 Corrections — prior rows that did **not** survive re-verification

| prior row | verdict at HEAD `56639b4b` |
|---|---|
| `recordToolTurnUsage` has a reader and no writer (G-40) | **CORRECTED — it has three production callers**: `services/trade/automationTurn.ts:258`, `services/trade/chatSurfaceTurn.ts:331`, `services/trade/chatTurnRunner.ts:709`, and `tests/featuresAreWired.test.ts:179` pins it. |
| `runEnsembleEnabled` survives as a half-live flag (G-39) | **CORRECTED — the flag is gone.** `tests/automationRouteCharacterization.test.tsx:249` asserts the source does **not** match `/runEnsembleEnabled/`. |
| The supervisor auto-approves drafts, no human (stepB path 5) | **CORRECTED — it is auto-triage only.** `overrideApproveSkill` (`services/learning/skillSupervisor.ts:708`) is the only approve path and there is no boot sweep in `hooks/useSupervisorBootstrap.ts`. **What remains true is narrower: the supervisor's auto-triage runs by default (O-34); the off-switch exists in the supervisor panel.** |
| `constants/prompts/analysisPrompts.ts:299` — "Family C … Highest win rate (~86 %)" | **CORRECTED — not found.** The file is 190 lines at HEAD and a search for `win rate` across `constants/prompts/` returns zero hits. |
| the 14 activation paths (stepB) | **PARTLY CORRECTED.** Path 5 is stale (above). Paths 1, 3, 4, 7, 8, 9, 10, 11 remain live and unaudited — see O-32. |

---

## 2. What each deleted document contributed, and where it went

| deleted document | what it was | where its content went |
|---|---|---|
| `docs/desk/README.md` | the 2D desk floor layout — a **deleted feature** | nothing to salvage: 100 % of its cited paths are dead and the feature is gone. **Deleted.** |
| `docs/plans/chat-dock-reference.md` | a 2026-10-04 visual reference for Chat/dock | its **7 PNGs are the only committed screenshots of this app** and are **kept** at `docs/plans/reference/`. The prose was rebuilt three times over. **Deleted.** |
| `docs/plans/debate-deletion-status.md` | the dated stage ledger for deleting the debate | **KEPT.** It is dated history, it names deleted files on purpose, and `scripts/check-flow-doc-anchors.cjs:44` scans it — deleting it breaks a gate. Its open items are in §1 above (O-31, O-32, O-52, O-107…O-109). |
| `docs/plans/docs-audit-2026-10-06.md` | a per-doc disposition table | its **7 un-actioned dispositions** became O-99, O-102…O-106 and the Report 4 docs table. Its "worth a decision" items became Q4 and D-04. **Deleted.** |
| `docs/plans/flow-ui-audit-2026-10-15.md` | the 2026-10-15 six-auditor UX/a11y/flow audit | its open Tier-4 findings became O-65…O-75, O-79, O-81, O-100. **Deleted.** |
| `docs/plans/memory-skills-research-2026-10-10.md` | how Claude/Hermes store memory vs what August does | its durable finding is O-30; its five divergences are O-38…O-41. **Deleted.** |
| `docs/plans/redesign-plan-claude-chatgpt-haze-2026-10-10.md` | the 2026-10-10 redesign master spec — **it is the design that shipped** | its binding rules are in `docs/ui-doctrine.md` (KEEP); its still-open findings are O-62, O-90, O-91 and the type/density cluster. **Deleted.** |
| `docs/plans/reference-transcript-catalog-copy.md` | a copy spec for a UI rebuilt three times | its open stages became O-14, O-45, O-51, D-14, D-15. Its own rule — *"A UI must not advertise a gesture that isn't wired"* — is the rule this register applies to the repo. **Deleted.** |
| `docs/plans/stage1-ui-ux-spec.md` | the 2026-10-03 research and design spec (D1–D6) | its decisions shipped; its open findings are O-69…O-71, O-83…O-86. **Deleted.** |
| `docs/plans/stage2-implementation-plan.md` | the 2026-10-03 implementation plan | its Phase 0–2 shipped; its Phase 3/4 open items are O-04, O-69, O-76, O-93…O-95, O-106. **Deleted.** |
| `docs/plans/stage3-arrangement.md` | the 2026-10-05 target arrangement | its Phase A–G shipped; its open item is O-49. **Deleted.** |
| `docs/plans/stage3-status.md` | the merge status and the **"Facts paid for — do not rediscover"** list | **the 15 facts are rescued verbatim in §3 below.** Its open item is O-50. **Deleted.** |
| `docs/plans/ui-redesign-deep-dive-2026-10-10.md` | the measured pre-redesign baseline | a baseline against `78f99bd` whose artefacts are in the gitignored `.probe-artifacts/` — **its numbers are unfalsifiable**. Its findings are O-66…O-71, O-83, O-90. **Deleted.** |
| `docs/plans/ui-ux-target-plan-2026-10-11.md` | the 2026-10-11 target plan | its four build decisions are **D-18, D-19, D-21, D-22**; its open items are O-38, O-46, O-53. **Deleted.** |
| `docs/plans/workstream1-status.md` | the workstream-1 status and handoff | its open items are O-32, O-35, O-45, O-60, O-96. **Deleted.** |
| `docs/plans/workstream1-stepB-evidence.md` | the platform-by-platform record of where the data lives | its 14 activation paths are O-32; its method line is rescued in §3. **Deleted.** |
| `docs/plans/workstream1-stepB-gap-audit.md` | the read-only gap audit of workstream 1 | its 4 gaps are moot; its method line is rescued in §3. **Deleted.** |
| `HANDOFF_LEARNING_LOOP.md` | the learning-loop handoff | its Tier-2 decisions and Improve list are D-16, D-17, O-42, O-43, O-44. **Deleted.** |
| `PLAN_LEARNING_LOOP_AND_UI.md` | the multi-workstream plan | WS-1…WS-6 shipped; its deliberately-left list is O-40, O-41, D-22. **Deleted.** |

---

## 3. Unique content rescued before deletion

### 3.1 "Facts paid for — do not rediscover" (from `docs/plans/stage3-status.md`)

**Verified as still true at HEAD.** These are the facts a future reader would otherwise have to
rediscover the hard way.

- **Journal:** the embedded branch only (`isEmbedded` deleted); the overlay and the *"your calls vs
  verdict"* stat are gone (**nothing writes `userPriorCall`**).
- **`VersionHistoryDashboard`:** no props, no overlay, no tab strip; the only mount is
  Learn → System. Hardcoded placeholder cards deleted.
- **Settings → Journal** routes through `openJournal`; `settingsInitialTab` and
  `isUpdateAutoCapturing` are deleted everywhere including `types/user.ts`. **`isAutoCapturing` IS
  wired** (`confirmAutopilotOutcome` → capture modal).
- **`utils/recentTradesBrief.ts` owns explicit log-time ordering**; `computeJournalStats` counts
  the trailing run of whatever order it is handed, **so sort before calling it**. Dollar and percent
  PnL never merge.
- **`realizedR` is the canonical outcome label**, computed by `realizedRFromPrices`
  (`services/backtesting/outcomeEngine.ts`) — used by BOTH the post-mortem's candle validation and
  the autopilot's `verifyHistoricalOutcome`. **`rMultiple` is the older leveraged-percent figure.**
- **MAE/MFE scaled only by `toLeveragedExcursionPct`** (same module). Rows carry `rSource` /
  `excursionSource` (`autopilot` | `postMortem`); **first writer wins** — the post-mortem will not
  clobber an autopilot measurement.
- **The recent-form brief is AUDIENCE-SPLIT:** analysts get neutral day-level rows (no win rate, no
  streak, no net PnL — ~1.2k chars, 20 rows); moderator and post-mortem get `tallyLine`. Both are
  fingerprinted into the injection record (`journal/recent-form`, `fingerprint`), reachable from a
  row's `sourceRunId`.
- **`get_trade_log`:** 4000-char budget (a 20-row read measures ~2.7k), deliberately **NOT cached**,
  and **not** a `MARKET_TOOL`.
- **Training JSONL:** `utils/reportExport.ts`, `TRAINING_SCHEMA_VERSION = 1`, nests `decision` /
  `outcome` / `lesson` / `provenance`, `incomplete` + `missing[]`. **Never derives dollars.** Entry
  candles are reconstructed from `decision.symbol` + `decision.analysisCreatedAt` + entry via
  `fetchFuturesOHLCVFromTime` — **not stored**.
- **The "Log this trade" dedupe keys on `LoggedTrade.planId` / `Message.planId`.** The headline-text
  match is gone; pre-F3a rows carry no `planId` and can therefore be re-logged — **accepted**, and
  the only known data gap from that phase.
- **`render-probe`:** `sweepSurface(label, cap, tabs)` enters each tab; a newly revealed
  input/textarea counts as a live press. Journal tabs are reached by id (`#journal-tab-analytics`).
  **Learn presses 16; floor `min(cap, 6)` — do not lower.**
- **SQLite needs NO migration for the new fields:** save spreads everything non-column into the
  `meta` TEXT column, read spreads `...meta` back. Proven by `tests/sqliteService.test.ts`
  (*"stage-3 trade fields round-trip"*), which also asserts zero `ALTER TABLE trades` statements
  and that a legacy row's missing keys stay `undefined`.

### 3.2 The method lines worth keeping

- **From `docs/plans/workstream1-stepB-gap-audit.md`:** *"can a person reach it from the app, and
  does the thing it claims to do actually happen?"* — the two questions this whole audit was
  built on.
- **From `docs/plans/reference-transcript-catalog-copy.md`:** *"A UI must not advertise a gesture
  that isn't wired."* — the rule that becomes the register's own test.
- **From `docs/plans/redesign-plan-claude-chatgpt-haze-2026-10-10.md`:** *"every claim is a
  file:line a mapper opened."* — and the counter-rule: a doc whose artefacts live in a gitignored
  directory has **unfalsifiable** numbers, which is the failure mode `docs/app-flow.md` was written
  to prevent.

---

## 4. How to restore anything

Every deletion is a `git rm` — a **tracked** change — so every one of the 18 documents is one
command away:

```
git revert <the commit that deletes them>
```

or, for a single file, `git checkout <sha> -- <path>`. The content also remains in the history of
`main` at the commit that preceded the deletion.

---

## 5. What was NOT deleted, and why

| kept | why |
|---|---|
| `docs/app-flow.md` and `docs/app-flow.html` | **living and machine-checked** — 303 verified anchors, 0 unattributed. The anchor gate scans both. |
| `docs/learning-loop-map.md` | living, but **three rows are wrong** (Report 4 §8.1 row 12) — needs UPDATE, not deletion. |
| `docs/ui-doctrine.md` | living — the binding UI rules. Needs a 2 px correction (O-87), not deletion. |
| `docs/plans/debate-deletion-status.md` | the **dated history ledger** — names deleted files on purpose, and `scripts/check-flow-doc-anchors.cjs:44` scans it. **Deleting it breaks a gate.** |
| `docs/plans/reference/*.png` (7 files) | the only committed screenshots of this app |
| `AGENTS.md`, `README.md`, `PRIVACY.md`, `THIRD_PARTY_NOTICES.md`, `changelog.md` | living, and not plan documents. `README.md` and `PRIVACY.md` need UPDATE (Report 4 §8.1 rows 2 and 6). |

---

| O-129 | **13 modules the app never loads, and 25 test files that exist only to cover them** — measured by a reachability graph over 521 source modules from the real entry points (492 reachable, 29 not). **Zero production importers each:** `TradeValidationGate.ts` (986), `BacktestingService.ts` (1,414), `AnalysisProgress.tsx` (the step ladder — not merely "muted", **not mounted at all**), `EntryTimingService.ts`, `ProbabilityEngineService.ts`, `debatePods.ts`, `incrementalMarkdown.ts`, `seriesPalette.ts`, `preRead.ts`, `convictionDrift.ts`, `providerFitness.ts`, `ticketSize.ts`, `chartScanSkills.ts`. | this audit | **OPEN** | the reachability graph plus a direct `from '…'` grep per module. **Four of the apparent "orphans" are TEST HELPERS, and the four tests that use them are repo-wide SOURCE GUARDS (849 lines) that must NOT be deleted** — `themeContrast.test.ts` (393), `jsxNesting.test.ts` (283), `sourceCodeHelper.test.ts` (96), `aiTrendlinesDrawn.test.ts` (77) | **E-50** (the test-removal batches T1–T4) |

## 1.10 Four items the first pass of this register missed

A keyword-coverage check of the register against the 60 gap themes named by the plan corpus found
four that were not represented. They are added here rather than left out.

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-111 | **The queue strip's refusal line is unverified in the app** — no probe presses **Apply** in the Learning queue, so the refusal the strip shows is only asserted in a unit test. | `workstream1-stepB-gap-audit` | **OPEN (low)** | `components/learn/ActionApprovals.tsx`; `tests/approvalGate.test.ts` asserts the function, not the press | **E-11** / the probe |
| O-112 | **Nothing exercises the real Settings → Data restore of a chat backup with an image-bearing session.** The web round trip is tested; **the native path — where every §2.1/§2.2 store defect lives — is not.** | `workstream1-stepB-gap-audit` | **OPEN** | `tests/infrastructure/backupImportRoundTrip.test.tsx` covers the web path only; `PreferencesService.ts:68-74` and `:226-241` are the native split | **E-14**, **E-24** |
| O-113 | **The provenance strip is jsdom-only** — it needs a real analysis run with a configured provider to prove it renders what it claims. | `PLAN_LEARNING_LOOP_AND_UI` | **OPEN (medium)** | `components/chat/MemoryProvenanceStrip.tsx`; `tests/memoryProvenanceStrip.test.tsx` mounts it in jsdom | **E-24** (a real run) |
| O-114 | **Node 26's experimental `localStorage` shadows jsdom's**, which breaks every test that touches `localStorage` directly. The repo pins Node 22.23.3 via volta. | `HANDOFF_LEARNING_LOOP` | **OPEN (environment fact — verify on this box)** | `.nvmrc`; `HANDOFF_LEARNING_LOOP.md:18-41` (now deleted; preserved here) | — |

## 1.11 Rows the deletion itself closed

Three rows from the plan corpus are **no longer open**, because of what happened while this register
was being built. They are recorded so nobody re-picks them.

| prior row | what closed it |
|---|---|
| **G-36 — the role / lens feature was only half-cut** (`AnalystRole`, the seat personas, the lens prompts, the roster builder all still named the three analyst roles) | the 2026-10-19 deletion removed the whole analyst-role system and migrated the stored profiles (`6e1e09bb`, `69c4aa33`). The Lens layer — `services/ui/AnalystLensService.ts`, `constants/prompts/lensRolePrompts.ts`, `utils/thinkingLens.ts`, `types/lens.ts` — went with it. **The three `AnalystRole` members remain the *lens* vocabulary, used by `constants/prompts/lensRolePrompts.ts` until that file was removed too.** |
| **G-61 — the stage-19 delete list was a claim, not a fact** (`utils/debateEnvelopes.ts` and `services/agents/seatPersonas.ts` were listed as deleted on 2026-10-18 and were still present) | both are gone at HEAD. **The claim is now true.** |
| **G-62 — `TEAM_MAX_SEATS` was claimed removed and the constant survived** (`utils/teamRoster.ts:25` still exported `TEAM_MAX_SEATS = 10`, and `tests/teamRoster.test.ts:19` asserted it) | `utils/teamRoster.ts` and its test are both deleted. **Gone.** |
| **G-63 — `HANDOFF_LEARNING_LOOP.md`'s IMPLEMENT-3 "DONE ✅" and Tier-2 #5 both named `BotRegistry`**, which was being deleted — so the target inverted and the DONE mark needed re-writing | **moot: `HANDOFF_LEARNING_LOOP.md` is deleted, and `services/bots/BotRegistry.ts` is gone.** Its Tier-2 content survives as O-32, O-33, O-34, O-43 and D-16. |

**And one row that changed meaning rather than closing:**

| prior row | what happened |
|---|---|
| **G-19 — "the two supervisor Settings switches have no UI"** | **the two docs disagreed** (`workstream1-status.md:19-22` said they *are* exposed in `SessionUsagePanel`; `docs-audit-2026-10-06.md:80-82` said no UI writer exists anywhere). **Re-verified at HEAD: the supervisor panel is the UI that reaches the store.** The store's `autoEnabled` defaults to **`true`** (`services/learning/supervisorStore.ts:84`) with a getter/setter/reset at `:187`, `:191`, `:202`; `SupervisorStream.tsx:202` calls `setAutoEnabled`, and the panel is mounted at `LearnView.tsx:304`. The narrower, correct statement is now **O-34**: *the supervisor's auto-triage runs by default; the off-switch is exposed.* |

### 1.10b Six more open items the register's first pass left in the reports only

A second coverage pass found six themes that the reports carried but the register's table did not.
Since the register is meant to be **the** list of what is not implemented, they belong here.

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-115 | **The ensemble weighting is inverted** — a provider with one loss scores **0.0 %**, the same as a provider with no trades at all; the providers are then sorted descending and the arbiter is told to favour the top one. **A single loss can brand a model as the worst performer, and a single lucky win the best.** | `05-lead-findings` §C | **OPEN** | `services/backtesting/ModelPerformanceService.ts:649` `winRate: perf.overallStats.total >= 3 ? perf.overallStats.winRate : 0`; the sort at `:657`; best/worst at `:669-670` | **E-04** |
| O-116 | **`DebateSpeaker` is a degenerate union** — `string \| 'Moderator'` — *"worse than the one it replaced"*. | `docs-audit-2026-10-06` | **OPEN (one line)** | `types/enums.ts:43` | **E-10b** |
| O-117 | **The drawn Entry/Stop/Target line is un-asserted by any gate** — the probe asserts no canvas overlay levels, so the one thing the trader drew can be wrong without anything failing. | `app-flow` | **OPEN** | `services/trade/chartDrawings.ts`; `scripts/render-probe.cjs` asserts no canvas levels | **E-11** |
| O-118 | **No test covered the Agents-roster seeding, so removing it turned nothing red** — *"that silence is evidence nothing was watching, not evidence the feature was inert."* | `app-flow` correction 12 | **OPEN (test gap)** | the seeding is gone; `tests/teamRoster.test.ts` was deleted with it and nothing replaced it | **E-11** |
| O-119 | **`trade_chat_active_v1` cannot be backed up** — it holds a plain string id, which the JSON sweep cannot carry. Deliberate, and documented — but the constraint is still live and still needs a raw-string envelope if the id ever matters. | `workstream1-stepB-gap-audit` | **OPEN (accepted constraint)** | `services/infrastructure/ExportService.ts:367-371`; `services/trade/chatStore.ts:161` | **E-14** |
| O-120 | **`harness_settings_v1` is backed up but its restore target is ambiguous** — a Preferences row that nothing reads. The 2026-10-06 audit called it *"NOT a bug"*; the gap audit called it *"a live gap"*. **The two docs disagree and the code was never checked.** | `workstream1-stepB-gap-audit` | **OPEN (needs one measurement)** | `services/infrastructure/ExportService.ts:375` (write) and `:736` (restore mirror) | **E-14** |
