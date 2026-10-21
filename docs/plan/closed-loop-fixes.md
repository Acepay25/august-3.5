# E-57 — the verification pass: eight defects two reviews found, and the four they got wrong

**Proposed:** 2026-10-21 · **Baseline:** `8e863522` at review, landed work measured at `8c88bee0`
· **Owner:** the trader · **Status:** §8a, §2, §7, §4, §3, §5 and §6 landed; §1 open. — and §3 opened O-140, which changes its own premise.

## Why this exists

Two independent reviews of August Trading were produced from `docs/app-flow.md`. One was a
1,600-line architecture and product critique; the other rated seven flaws "Critical" or "High".
Both were written against a document, and one of them said so out loud: *"if the live code
differs, the code should be treated as the source of truth."*

So every claim was re-checked in code before a single line was planned. That step is the whole
value of this proposal: **four of the headline claims were false, two recommendations would have
broken live paths, and six claims that were true had never been written down as an item at all.**

### The four that were false

| The claim | What HEAD actually does |
|---|---|
| "`beginPromptLane` has zero callers, so the A/B lane is starved" | It has a production caller at `hooks/useAnalysisPipeline.ts:951`, pinned by `tests/promptOverrideService.test.ts:243`. The **sentence in `docs/app-flow.md` was stale**, and both reviewers inherited it. |
| "Human sends no longer fetch real-time hybrid data" | The dock fetches and injects on every human send: `services/trade/chatTurnRunner.ts:906` → `:590` → `:914` → onto the wire at `:959`. What is true is narrower: `hooks/useAnalysisPipeline.ts:982,994` builds a `hybridDataInjection` string that only a dev log reads. |
| "`utils/ticketSize.ts` is dead — zero production importers" | Three importers: `TradeProposalCard.tsx:20`, `useTradeLogging.ts:25`, `proposedTrade.ts:23`. **`O-129` said so too**, and O-129's orphan census was rebuilt (§8a). |
| "Pre-trade validation is only structural" | The minEdge-with-fees refusal (`services/trade/proposalGate.ts:95`) and the skill-AVOID ceiling (`:258`) were already enforced, and they disable the Log button. What was *not* enforced was the R:R floor and the ATR stop bands — those lived in `TradeValidationGate.ts`, which nothing imports. **§5 lifted them into the live gate**, so the claim is now false in both directions. |

### The two recommendations that would have broken something

- **"Delete the harness-lesson store and its Settings surface."** The store has a live reader:
  `registerWireRoutePins` at `services/learning/harnessLessons.ts:142`, consumed by
  `services/providers/reasoningControls.ts:216`. A wire lesson is what pins a provider class to
  thinking-off. Deleting the store would have quietly broken the wire audit. §2 deletes the two
  functions that had no caller and keeps the store, with a guard that pins both halves.
- **"Add portfolio exposure, event-risk calendar, sector concentration and broker fills."** The
  app's whole universe is Binance spot + USDT-M perps (`services/analysis/MarketDataService.ts`,
  `services/analysis/KlineService.ts`, benchmark `BTCUSDT`/`ETHUSDT` in
  `services/analysis/benchmarkAlpha.ts:26-31`). There is no brokerage, no calendar feed and no
  equities. Those items are a different product; they are out of scope here and recorded as such.

## Rulings

- **(a) Rule 8 is WAIVED for one call, by the owner, 2026-10-21.** `README.md` §3 rule 8 said no
  proposal in this plan "adds an LLM review call". §1 adds exactly one, bounded, at trade
  settlement. The justification is that the leg already has a live caller —
  `services/agents/botLearning.ts:234` calls `craftSkillFromPostMortem` on every closed bot trade,
  and `SkillCraftService.ts:144` returns `null` whenever `postMortem.length < 40`, which is now
  always. The cost buys back a path the code was already built to run. Output stays a **draft
  behind the existing human gate**; no unattended notebook write; skipped when no provider is
  ready; on failure it writes nothing, so a missing reflection is a gap and never a fabricated
  lesson.
- **(b) A wire lesson is evidence for a human and for a pin, not an instruction to a seat.** No
  prompt injection in this proposal.
- **(c) Warn, do not block.** A sub-floor R:R or an out-of-band stop prints a warning and leaves
  *Log this trade* enabled; only an inverted or unmeasurable plan refuses, because there the
  arithmetic itself is meaningless. *The app proposes; the trader decides.*
- **(d) The automation breaker disables and needs a human to re-enable it.** Three consecutive
  failures stops a schedule; re-enabling clears the counter. Autonomy that fails repeatedly must
  not get to keep trying quietly.

## The eight items

| § | Item | Status | Gate |
|---|---|---|---|
| §8a | **The register's own census was wrong.** `O-129` named 13 unreachable modules; re-measured with a scan that also reads `await import(...)`, 10 are unreachable and four of the thirteen were never orphans (`ticketSize.ts`, `chartScanSkills.ts` — reached dynamically at `DeskToolsService.ts:2915`; `ThinkingModal.tsx` — renamed by E-52 to `shared/DetailModal.tsx` and mounted by `AgentsView.tsx`; `debatePods.ts` — deleted). The graph's 521/492/29 figures are left **unre-run**, because no reachability script exists and the row should not quote a number its recipe cannot produce. `docs/app-flow.md`'s stale lane sentence corrected. | **LANDED** `dd0af735` | `check-flow-doc-anchors` |
| §2 | **The lesson store advertised a reader it did not have.** `formatHarnessNotesBlock` and `lessonsForClass` deleted; the header now names the two readers that exist; the capability-class doctrine moves into a test against the stored shape so the deletion costs no coverage. | **LANDED** | `typecheck` · `lint` · `test` |
| §7 | **No gate asserts the drawn Entry/Stop/Target levels.** `scripts/render-probe.cjs` contains zero references to them, and they paint through `addSeries(LineSeries)+setData` (`components/trade/TradingChart.tsx:628`), which the existing `createPriceLine` mock cannot see. **Closes O-117** for the plan overlay; the hand-drawn and `mark_trade_levels` shapes stay asserted only at the data level, and that residue is named in the row. | **LANDED** (record §28) | `test` (proved red by swapping entry/stop) · census |
| §4 | **A turn that streamed prose and then failed reads as an answer** — in the dock only: `chatTurnRunner.ts:974` stamped `error` solely when the entry had no text. The Chat home already appends a separate failure row (`useAnalysisPipeline.ts:1589`). The fix uses the existing `interrupted` field (`services/trade/chatSessions.ts:103`) rather than inventing a fourth state, and the dock now sanitizes the provider message it persists. **Closes O-137.** | **LANDED** (record §29) | `test` (proved red by restoring the old branch) |
| §3 | **The prompt lane was a process-global singleton**, so concurrent runs clobbered each other and a `finally` cleared the flag out from under a run still reading it, and `promptCorpusVersion` hashed overrides for prompt ids that no longer exist. **Re-reading the call sites changed this item:** threading the lane into the analysis prompts would have been plumbing into a path no trader's run reaches — `services/trade/**` has zero `getPrompt` calls, and the wrapper those prompts live behind has no caller at all. So the lane is now a per-run value, the fingerprint and the visible “Reset all (N)” ignore the ghosts, and the real gap is registered as **O-140**: the dial measures a label, not a difference, and wiring it or deleting it is the owner's call. | **LANDED** (record §30) | `typecheck` · `test` (proved red by deleting the filter) · `build` |
| §5 | **The R:R floor and the ATR stop bands are computed in a module nothing imports.** They now run in the one live path: `assessPlanShape` (`services/trade/proposalGate.ts:152`) is called from every exit of `runGateScan` (`:189`) — including the failed-fetch ones, because a plan's shape needs no tape — and it calls the band owner itself, `validateRiskReward` (`services/validation/AccuracyValidationService.ts:206`), over the ATR the gate already scores on (`atrForGate :123`, 1h → 4h → 15m → 1d) and `MIN_RATIO_BY_CONFIDENCE` (`services/validation/ValidationConstants.ts:78`). No new arithmetic. **Per ruling (c) they warn** — printed on the card (`components/trade/panels/TradeProposalCard.tsx:173`, first caution always visible, the rest through `Disclosure`) and recorded on the journal row (`services/trade/proposedTrade.ts:207`) so the caution is auditable after the trader overrode it. **Only an inverted plan refuses**, and its refusal is stated ahead of the min-edge one, because a floor is a meaningless question on levels that point the wrong way. Two things this did NOT do, both on purpose: it added no `hardInvalid` field — `refusal` already owns "do not log this", and a second flag for the same fact is a second writer — and it did not import `runValidationGate`, so `TradeValidationGate.ts` stays dead and remains an E-50 candidate. Wiring it also exposed a latent defect: with `atr = 0` the wide-stop band fired on **every** plan and printed `Wide stop loss (Infinityx ATR)`, so both bands now stand down when there is no volatility reading (`AccuracyValidationService.ts:269`). | **LANDED** (record §31) | `typecheck` · `test` (7 shape cases; proved red by stubbing `assessPlanShape` → 6 of the 7 fail, the seventh being the control that asserts the absence, by removing the `atr > 0` guard → the gate's own control case reports `Infinityx ATR`, by removing the card block and the row provenance → 4 fail) · `lint` (655/659) · `render-probe` · `check-flow-doc-anchors` · **O-141** |
| §6 | **Automation caveats evaporate.** `runAutomationTurn` returns `notices`/`failedTools`/`refusedPlans` (`services/trade/automationTurn.ts:279-300`) and the hook only toasted them; the stored `AutomationRun` kept no field for any of it. They are now fields on the row (`types/automation.ts:102`, `:108`) written at the one `finish` site (`hooks/useAutomations.ts:530`) and printed in the open on the card (`components/automation/AutomationRunCard.tsx:147`) — but not twice: the bubble paths that already render the prose, which carries the notices on purpose so the NEXT scheduled run reads them off the wire, suppress the block. Ruling (d)'s breaker is ONE helper both run arms settle through — `settleRunStreak` (`hooks/useAutomations.ts:282`) with `MAX_CONSECUTIVE_AUTOMATION_FAILURES` (`services/automation/AutomationService.ts:127`) — so three runs that produced nothing disable the schedule, the schedule's own banner says why (`components/automation/AutomationView.tsx:121`), and only the human toggle clears it (`hooks/useAutomations.ts:752`). **No `RAW_LOCAL_STORAGE_PREFIXES` change was needed:** `automation_runs_v1_` is already restorable (`services/infrastructure/ExportService.ts:774`), proved by an export → wipe → import round trip that keeps a notices-bearing run and a breaker-bearing config. **The quota item was already true** — `MAX_PLANS_PER_DAY` counts plans per automation per local day and the refusal receipt says so in those words (`services/trade/automationTurn.ts:216`); nothing ever claimed symbols, so nothing was changed. **No `model` field:** `message.modelsUsed` already names the model and the card now reads it (`AutomationRunCard.tsx:62`) rather than growing a second writer for one fact. | **LANDED** (record §32) | `typecheck` · `test` (7 hook cases — both arms, a streak control, a manual-off control — plus 6 card/view cases incl. the no-repeat control; proved red by dropping the row fields, by never disabling, by forcing the duplication guard on, and by making the banner unconditional) · the export suites · `render-probe` · `lint` · `check-flow-doc-anchors` · **O-142** |
| §1 | **The closed-trade reflection** (ruling a): one bounded model call at settlement, written onto the trade row before `syncClosedTradeToNotebook` runs, because that function marks the trade settled and appends the diary first (`SkillMemoryService.ts:3622-3641`) and the diary reads post-mortem text. | OPEN | `skill-approval-probe` · `render-probe` · export suites |

## What E-57 does NOT do

- No broker, no order placement, no exchange credentials.
- No equities, indices, Treasuries, economic calendar, sector or portfolio-exposure model — the
  data does not exist in this app, and a warning that cannot be computed is a worse lie than a
  silence.
- No indicator catalogue, no chart rewrite, no docking, no theme editor, no command palette
  (deleted by ruling; `tests/deadControlsGuard.test.ts:106` pins it).
- No skill auto-approval and no unattended notebook write: every §1 output is a draft awaiting a
  human, exactly as the doctrine requires.
- It does not re-run the reachability graph, and it says so rather than quoting a stale figure.

## A note on method, because it is the actual lesson

Both reviews were useful and both were substantially wrong in detail. The register was wrong in
the same way the flow doc was wrong: **a number that was once measured and then copied.** Six of
the eight items in this proposal are defects that had been *described* in `docs/app-flow.md` for
weeks and were real; four were stale sentences about code that had already changed. The gate that
polices line numbers cannot see a sentence that names no symbol, and it measures the working tree,
which is how HEAD shipped a doc citing `outputTokenBudget` and `ChatFailureRow` before either
existed in the commit.
