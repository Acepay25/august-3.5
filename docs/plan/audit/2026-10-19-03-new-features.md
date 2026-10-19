# Report 3 — New features

**Pinned commit:** `6a41a9f7e3b3986236c3000862d326f1e95dfad1` (branch `main`)
**Date:** 2026-10-19
**Part C of the brief.**

**The framing these are built for.** August is the trader's **operator** — the trading equivalent of
what Claude Code is for coding and Hermes is for a user's daily work. It does the trader's work:
prep, scan, plan, manage, journal, review, improve. **The user decides.** The agent proposes,
deterministic code checks, the user decides. No order placement, no exchange write access, ever.

**What that framing excludes, and why these proposals honour it.** No order placement. No exchange
write access. No regime routing (the app already has a regime ledger — `services/learning/regimeLedger.ts`
— and it is a *measurement*, not a router; routing would make the app decide, which is the user's
job). No debate revival. No extra LLM review calls — and several proposals here **reduce** model
calls. No macro calendar.

**The design rule for every proposal below:** *it must make the trader better at deciding, and it
must not make decisions for them.* A proposal that fails that test is not here, however cheap it is.

**What "reuses" means in the tables.** The right-hand column names the **existing** machinery the
feature is built on. A proposal that needs new infrastructure is a worse proposal; most of these
need none.

**A note on the data.** Several of these are only worth building once there is real trade data.
Those are marked **[DATA-GATED]**. The app's own journal, the outcome engine, the calibration
ledger and the skill ledger already exist and work — they are **starved of closed rows**, not
missing. The mechanism of the starvation is in Report 2 §E-18, and it is the precondition for
every **[DATA-GATED]** item.

---

## 1. PREP — before the session, the trader knows what is in play

The prep surface is currently the **weakest** of the six. The app has a watch list, level watches,
automations, a market-data cache and a rich notebook — and **no way to see, in one place, what
"in play" means this morning.** Everything below is assembly, not invention.

### N-01 — A pre-session brief

| | |
|---|---|
| **User value** | The trader opens the app and knows, in one screen: what they marked, what moved to it, what is now invalid, and what the app learned from last week that bears on today. Today that is three surfaces and a memory. |
| **Reuses** | `services/trade/watchService.ts` (the watch list) · `services/trade/levelWatchService.ts` (armed levels and hits) · `services/trade/chartDrawings.ts` (the trader's own drawings) · `services/analysis/MarketDataService.ts` (the cached packet) · `utils/recentTradesBrief.ts` (the last-20 summary, already built and already injected) · `services/learning/MemoryRetrievalService.ts` (the skills that match these symbols) · `services/automation/AutomationService.ts` (the schedule that could deliver it) |
| **What it needs** | A read-only assembly surface over existing stores. **No new store, no new model call.** The one new thing is a rule for *which* symbols count as "in play" — the watch list plus any symbol with an armed level. |
| **Effort** | **M** |
| **Risk** | **S** — read-only. The risk is scope creep into a second home for the journal (the app already has a "one fact, several homes" problem, `R-049`). |
| **Data** | **works with zero trades.** It reads the trader's own watch list and drawings, which exist from day one. It gets *better* with data. |
| **Roadmap** | **NEW** — no roadmap item proposes a pre-session brief. The closest are `R-208` (the last-20 brief, shipped) and `R-087` (the weekly/monthly review cards returning `null`). |

### N-02 — Session setup: a checklist the app can fill

| | |
|---|---|
| **User value** | Before the first trade of the day: the open drawdown since the last session, the open thesis, the symbols in the watch list, the skills that match them, and the risk the trader has already committed today. The trader's "prep" step becomes a two-minute read instead of a memory exercise. |
| **Reuses** | `utils/checklist.ts` (**already exists** — `trading_checklist_v1` is a real store, with a 64 KB export cap) · `utils/recentTradesBrief.ts` · `services/trade/levelWatchService.ts` · `services/learning/SkillMemoryService.ts` (the skills index) · `services/analysis/MarketDataService.ts` |
| **What it needs** | A checklist *producer* (today the checklist is presumably trader-authored) that fills itself from the existing stores. No new store. |
| **Effort** | **M** |
| **Risk** | **S** — but the checklist store's write-time bound is an open backlog item (`R-202`), so a producer that writes on every session start makes that bound matter sooner. **Sequence it after `R-202`.** |
| **Data** | **works with zero trades.** The risk-committed line needs open positions, so it degrades gracefully. |
| **Roadmap** | **NEW**. |

### N-03 — The open-position digest

| | |
|---|---|
| **User value** | Every open position, on one card, with the distance to its stop and target, the time held, and the *current* planned R:R — computed from the **canonical** formula, so the number matches the journal. |
| **Reuses** | `services/trade/chatStore.ts` (`addOpenTrade` — the one journal write path) · `services/trade/levelWatchService.ts` · `services/ui/OutcomeAutopilotService.ts` (already resolves open trades every 20 s) · `utils/riskReward.ts` (the canonical ratio) |
| **What it needs** | A read-only view over the open rows. **The R:R must come from `utils/riskReward.ts`** — this is the feature that makes E-02 (one R:R formula) visible to the trader, and it is the reason E-02 matters. |
| **Effort** | **S–M** |
| **Risk** | **S** — but it depends on E-02, because a digest that prints the *gate's* index-0 ratio would print a different number from the journal. **Do not build it before E-02.** |
| **Data** | Needs at least one logged trade. **But the machinery is the existing journal read path.** |
| **Roadmap** | **NEW** — adjacent to `R-084`/`R-085` (the "why" holes) but not the same. |

---

## 2. SCAN — find the setup, not the chart

The scan tools are the **strongest** part of the app: `scan_setups` (861 schema chars), `run_screener`
(843), `scan_chart_skills` (1,301), `get_indicators` (1,660) — 12 market-reading tools, all
deterministic, all local-TA, all served from a 30-second cache. **What is missing is the bridge
between the tools and the trader's own attention.**

### N-04 — The watch list becomes the scan's input

| | |
|---|---|
| **User value** | One list. The trader watches six symbols; the scan runs over exactly those six (or over a defined universe) and returns the ones that have changed shape — instead of the trader remembering to ask. |
| **Reuses** | `services/trade/watchService.ts` (`trade_watches_v1_<user>`) · `services/analysis/DeskToolsService.ts` (`run_screener`, `scan_setups`) · `services/analysis/MarketDataService.ts` (the 30 s cache) · `services/learning/strategyStore.ts` (the strategy book the scan already reads) · `services/automation/AutomationService.ts` (the schedule) |
| **What it needs** | A screener entry point that takes a **symbol list** instead of the Binance universe, and the ability to schedule it. **Both exist in pieces.** |
| **Effort** | **M** |
| **Risk** | **S** — but the screener over a fixed universe is a different cost profile from the scan over the trader's list; the 30 s cache and the 20 s tool timeout already bound it. |
| **Data** | **works with zero trades.** It needs watch-list entries, which exist from day one. |
| **Roadmap** | **NEW** — `R-207` shipped the `get_trade_log` tool and `R-208` the last-20 brief; the screener bridge is not in the corpus. |

### N-05 — "What changed since yesterday", per symbol

| | |
|---|---|
| **User value** | For each watched symbol: the trader's own level is now 0.4 % away and the structure changed; the previous session's packet said X and today's says Y. The trader's *attention* is the scarce resource; the app already has both halves of the comparison. |
| **Reuses** | `services/analysis/MarketDataService.ts` (`POINT_IN_TIME_TTL` = 5 s, the live mark at 2 s) · `services/trade/chartDrawings.ts` (the trader's levels) · `services/trade/levelWatchService.ts` (the armed levels and the hits) · `services/trade/chartTriggers.ts` · the last session's stored `marketSnapshot` on the journal row (`hooks/useTradeLogging.ts:296-368`) |
| **What it needs** | A diff between two packets. **The journal row already stores `marketSnapshot` and `marketRegime`**, so the "then" is already persisted; the "now" is one packet fetch. |
| **Effort** | **M** |
| **Risk** | **S** |
| **Data** | **works with zero trades** for the levels half; the snapshot comparison needs at least one logged trade. |
| **Roadmap** | **NEW** |

### N-06 — Counter-pattern scan: what you have been wrong about

| | |
|---|---|
| **User value** | "You have been trading this shape 6 times and lost 5. Here is what is set up *instead*." The pattern memory already holds per-coin, per-family, per-pattern, per-regime, per-direction performance; nothing surfaces the *negative* case. |
| **Reuses** | `services/learning/PatternMemorySynthesisService.ts` (the weighted scorer, live) · `services/validation/GateKeeperService.ts` (which already reads it) · `services/analysis/DeskToolsService.ts` (`scan_setups`) · `utils/patternMining.ts` (`mineCoinFromPrompt`) |
| **What it needs** | The *inverse* of the current query — a scan for the shape the trader loses. A new tool argument, not a new tool. |
| **Effort** | **M** |
| **Risk** | **S** — read-only. |
| **Data** | **[DATA-GATED]** — needs a real pattern-performance sample. With n < 10 the honest answer is "not enough evidence", and the app must say so rather than show a 0 % that means nothing. **This is the same trap as E-04.** |
| **Roadmap** | **NEW** — `R-151` records that *"nothing checks `approvedBy` or `whyAccepted` at injection time"*; the negative-case query is not covered. |

---

## 3. PLAN — the proposal becomes something the trader can shape

The current proposal card is **accept or ignore**. The product framing says *the agent proposes, the
user decides* — and "decide" is currently only "yes" or "no". Everything below is about widening
"decide" without widening the agent's authority.

### N-07 — The trader can adjust the plan, and the adjustment is recorded

| | |
|---|---|
| **User value** | The trader moves the stop, takes a different target, or halves the size — and the journal records **both** the model's plan and the trader's. Over time that is the single most valuable dataset the app can have: *"this model proposes stops that are 0.3 % too tight for this coin."* |
| **Reuses** | `services/trade/proposedTrade.ts` (the `TradeProposal` schema) · `services/trade/proposalGate.ts` (the stamp) · `services/trade/levelWatchService.ts` (the armed levels) · `hooks/useTradeLogging.ts` (the one journal write path) · `services/learning/SkillMemoryService.ts` (`applySkillEvidence` — the evidence chain) |
| **What it needs** | The `TradeProposal` schema already carries the levels; it needs an **adjustment record** and a re-stamp after the adjustment. The `planId` already dedupes the journal row, so an adjusted plan can be a second row under the same id. |
| **Effort** | **L** — this is a schema change on the journal row, and the evidence chain reads it. |
| **Risk** | **M** — the evidence chain (`applySkillEvidence` → `skillAdherenceForRun`) joins on the injection record, so an adjusted plan must not double-credit or double-debit a skill. **This is the part that makes it L rather than M.** |
| **Data** | **[DATA-GATED]** for the *value* (the dataset only exists once trades are adjusted and resolved); the *feature* can ship without it. |
| **Roadmap** | **NEW** — nothing in the corpus proposes trader-adjustable plans. `R-216` (trust & noise) is adjacent but is about settle-time stripping. |

### N-08 — A size suggestion on the proposal card

| | |
|---|---|
| **User value** | The card says, in the trader's own risk terms, what this plan costs: *"at 1 % risk on a 10 k account, 2 lots, 0.8 % stop, 3 % away"*. The trader's risk % is already a setting; the stop is already in the plan; the leverage cap is already coded. |
| **Reuses** | `utils/ticketSize.ts` — **the complete, grade-tiered, fail-closed sizing module that has zero production call sites** (`utils/ticketSize.ts:45-180`, with the leverage cap and the unconfigured-equity refusal) · the trader's risk setting (`utils/harnessSettings.ts`) · the plan's levels (`services/trade/proposedTrade.ts`) |
| **What it needs** | Nothing new. **This is the re-homing E-12 proposes, with a surface.** |
| **Effort** | **S** once E-12 lands; **M** from scratch (because the module has never been wired and its contract with the plan shape has never been exercised). |
| **Risk** | **S** — a suggestion the trader can ignore. It must never *be* the size. |
| **Data** | **works with zero trades.** |
| **Roadmap** | **NEW** — `R-024` covers the R:R chip on the proposal card, **not** the size. The sizing module's orphanhood is `G-06`. |

### N-09 — "What would have to be true" — a structured thesis on the card

| | |
|---|---|
| **User value** | The card shows the plan's **invalidation** and its **evidence**, not just three prices. A plan the trader can invalidate in one sentence is a plan the trader can hold; a plan that is three prices is a trade the trader has to babysit. |
| **Reuses** | `services/trade/proposedTrade.ts` (the `TradeProposal` schema) · `services/analysis/EvidencePackService.ts` (**already builds an evidence pack** — `R-120` shipped the "review-destinations" idea partially) · `services/learning/EvidencePackService.ts` · `services/trade/tradePlanLevels.ts` (the level parsing) · `utils/avoidReason.ts` (**already produces an "avoid" reason** — a per-coin avoid list) |
| **What it needs** | Two extra fields on the proposal schema: an invalidation condition and an evidence list. The model already produces both in prose (the `present_trade` description and the EvidencePackCard). |
| **Effort** | **M** |
| **Risk** | **M** — a schema change to the model-facing tool. The `present_trade` schema change ripples into the tool definition, the parser, the card and the journal. |
| **Data** | **works with zero trades.** |
| **Roadmap** | **NEW** — `R-257` records that *"the drawn Entry/Stop/Target line is un-asserted by any gate"*; the *content* of the plan is not covered. |

---

## 4. MANAGE — the plan while it is live

### N-10 — Arm the plan, not the price

| | |
|---|---|
| **User value** | The trader arms a *plan* — entry, stop, target, invalidation — and the app tells them when the **plan** is invalidated (structure broke, the invalidation condition triggered), not only when a price is touched. Today the watch is price-level-based: `services/trade/levelWatchService.ts` fires on a level. |
| **Reuses** | `services/trade/levelWatchService.ts` (the arm/fire machinery) · `services/trade/tradePlanLevels.ts` (`staleLevelsAtArm` — the existing "the plan is already through its stop" refusal) · `services/analysis/MarketDataService.ts` (the live mark) · `services/analysis/CandlePatternDetector.ts` (the structure) · `services/ui/PriceAlertService.ts` (the alert surface) |
| **What it needs** | An invalidation predicate. The pieces exist: the levels, the structure detector, the market regime. **What is missing is the composition** — and the invalidation has to come from the plan (N-09), so this is downstream of N-09. |
| **Effort** | **M** (after N-09); **L** standalone |
| **Risk** | **M** — a false invalidation erodes trust in the watch immediately. The existing design already treats a refusal as a *receipt* rather than a silent drop (`presentTradeTool.ts:133`), and that discipline should carry over. |
| **Data** | **works with zero trades** — it reads the plan and the tape. |
| **Roadmap** | **NEW** |

### N-11 — The veto ledger, where the trader can see it

| | |
|---|---|
| **User value** | `services/ui/VetoLedgerService.ts` records a veto; the trader's "why was this blocked" question currently has no screen. A veto that is invisible is a veto the trader cannot learn from. |
| **Reuses** | `services/ui/VetoLedgerService.ts` (the store) · `utils/approvalInbox.ts` (the approval inbox) · `components/learn/ActionApprovals.tsx` (the inbox surface) · `services/infrastructure/ThinkingStoreService.ts` |
| **What it needs** | A read surface. **One caveat:** the ledger's *meaning* is entangled with the deleted moderator, so a reader must be written to say what a veto means in the tool-turn architecture, not the debate one. |
| **Effort** | **S–M** |
| **Risk** | **S** |
| **Data** | needs vetoes to exist, which needs runs. |
| **Roadmap** | **PARTIAL** — `R-088` ("the forged-tool queue count has no destination") is the same *shape* of gap for a different queue; the veto ledger itself is **NEW**. |

### N-12 — One home for "what is open"

| | |
|---|---|
| **User value** | The trade surface, the journal and the header each show a slice of the open positions. One list, one place, linked. |
| **Reuses** | `services/trade/chatStore.ts` · `services/trade/watchService.ts` · `components/journal/Journal.tsx` · `components/trade/TradeView.tsx` |
| **What it needs** | Nothing new — a shared read model. |
| **Effort** | **M** |
| **Risk** | **S** |
| **Data** | needs open positions. |
| **Roadmap** | **COVERED** in spirit — `R-049` ("one fact, several homes") names the class. **The missing part, named: no roadmap item names the open-position list specifically.** |

---

## 5. JOURNAL — the record that explains itself

The journal is the app's most complete surface and its **weakest** in one specific way: it records
what the trader did but not what it taught. The roadmap already names this twice.

### N-13 — "What this trade taught"

| | |
|---|---|
| **User value** | Each journal row carries the one sentence the app learned from it: *"your BTC scalp entries below 61,200 lost 4 of 5"*, *"this setup beat your 1.5 % floor only because the stop was 0.4 %"* — linked to the skill, rule or pattern that changed. |
| **Reuses** | `services/learning/SkillMemoryService.ts` (`applySkillEvidence` already computes FOLLOWED / OVERRIDDEN / CONTROL per skill) · `services/learning/skillSupervisor.ts` (the triage ledger) · `utils/tradeInsightBrief.ts` (the per-trade summary) · `services/learning/AlorithmicMemoryService.ts` (the aggregation) · `hooks/useTradeLogging.ts` (the one write path) |
| **What it needs** | A read surface over the evidence the app **already computes** and does not show. The `applySkillEvidence` result is written; nobody renders it per trade. |
| **Effort** | **M** |
| **Risk** | **M** — the evidence is currently *wrong* (F-01b: the ledger credits skills the model never saw). **Build this AFTER E-05, or it will show the trader a confident wrong answer.** |
| **Data** | **[DATA-GATED]** — needs closed trades. |
| **Roadmap** | **COVERED** — `R-085` ("The Journal never says what a trade taught the app", *"gap → fix M"*) and `R-084` (the skill's trades). Both still open. |

### N-14 — The skill's own evidence, one click away

| | |
|---|---|
| **User value** | A skill shows a tally but not *which trades earned it*. The trader cannot tell a skill that earned 7 samples from one that earned 2 lucky ones. |
| **Reuses** | `services/learning/SkillMemoryService.ts` (the per-skill W/L and control counters) · `services/learning/MemoryInjectionService.ts` (`skillAdherenceForRun` — the injection→trade join) · `services/learning/EvidencePackService.ts` |
| **What it needs** | The join from a skill back to the trades, rendered. The join exists (`skillAdherenceForRun`); the view does not. |
| **Effort** | **M** |
| **Risk** | **S** — but it inherits F-01b, so the *counts* it shows depend on E-05. |
| **Data** | **[DATA-GATED]** |
| **Roadmap** | **COVERED** — `R-084` (*"the single biggest 'why' hole"*). Still open. |

---

## 6. REVIEW — the loop closes

### N-15 — A weekly review that names what changed

| | |
|---|---|
| **User value** | Not "you had 12 trades, 8 wins" — *"this week the app stopped recommending X because of Y, your win rate on Z changed from 40 % to 65 %, and three of your four losses were the same shape you were told to avoid"*. |
| **Reuses** | `services/learning/weeklyReview.ts` (**already built**; `MIN_CLOSED_TRADES_FOR_REVIEW = 3` is the only thing stopping it) · `services/learning/weeklyRollup.ts` (the rollup) · `services/learning/settledBeliefs.ts` · `services/learning/memoryHygiene.ts` (the demotion / contradiction / graveyard sweeps that already run) · `services/learning/monthlyReport.ts` (the same idea, monthly) |
| **What it needs** | **Almost nothing.** The review machinery exists and is correctly gated. The gap is that the cards return `null` and the trader cannot tell "pending" from "failed" from "never ran" (`R-087`). **Fix `R-087` first** — a review that says "not enough closed trades yet" is honest; a card that returns `null` is not. |
| **Effort** | **S** for the honest-empty-state fix · **M** for the full review |
| **Risk** | **S** |
| **Data** | **[DATA-GATED]** — this is the feature that most needs closed trades, and the one that most rewards them. |
| **Roadmap** | **PARTIAL** — `R-087` covers the *empty state*; the *review content* is **NEW**. |

### N-16 — Replay: "what would today's code have said about last Tuesday's plan?"

| | |
|---|---|
| **User value** | The trader's judgement improves when they can see whether the app's advice has changed. Replay also becomes the app's own regression harness — the cheapest way to know whether a gate change made things better or worse. |
| **Reuses** | the stored journal rows (entry, stop, targets, `marketSnapshot`, `marketRegime`, `promptVersion`, `sourceRunId`, `modelsUsed`, `realizedR`) · `services/validation/TradeValidationGate.ts` (the deterministic re-grade) · `services/backtesting/outcomeEngine.ts` (the re-resolve) · `utils/riskReward.ts` |
| **What it needs** | A **replay** command over the journal, re-running the deterministic code against the stored plan. **No model call** — the levels and the snapshot are already stored. This is the deterministic half of what `R-206`'s `SkillEvalService` does with the *prompt*. |
| **Effort** | **L** (M for the first version: replay the gate, report the drift) |
| **Risk** | **S** — read-only over the journal |
| **Data** | **[DATA-GATED]** — needs a history of closed trades, and rows that carry a `planId` (pre-F3a rows do not — `R-214`). |
| **Roadmap** | **NEW** — nothing in the corpus proposes a replay. `R-206` is the nearest machinery and the nearest miss. |

### N-17 — The calibration ledger, decided

| | |
|---|---|
| **User value** | Not a feature so much as a decision with a surface: *"your confidence in this kind of call has been 30 % accurate over the last 40 calls — you are over-confident by 20 points."* |
| **Reuses** | `services/validation/CalibrationLedgerService.ts` + `calibrationPolicy.ts` + `calibrationStore.ts` + `calibrationPrompts.ts` (**all four exist**) · `services/learning/metaCalibration.ts` · `utils/promptVersionStats.ts` |
| **What it needs** | The roadmap records this as *"still an unresolved product decision"* (`G-56`). **It needs a ruling before it needs code.** |
| **Effort** | **S** for a surface · **M** for the decision's consequences |
| **Risk** | **S** |
| **Data** | **[DATA-GATED]** — the Brier buckets need closed trades. |
| **Roadmap** | **COVERED** as an open decision — `G-56`, `R-056`. **The missing part, named: it is recorded as a decision, not as a build, and it is one of the 23 owner decisions the roadmap lists.** |

---

## 7. IMPROVE — the loop that makes the next session better

### N-18 — A skill the gate just verified is pushed, not indexed

| | |
|---|---|
| **User value** | The trader's skills are shown to the model as a **30-row index** — slug, status, kind, description, if/then. The model can pull a body with `recall`, but it does not get the skill that the *gate* just proved is relevant, in the prompt, with its evidence. |
| **Reuses** | `services/learning/MemoryRetrievalService.ts` (the retrieval, the budget, the injection record) · `services/learning/skillPredicate.ts` (the code-checked trigger) · `services/learning/SkillMemoryService.ts` (the evidence counters) · `services/learning/patternMemorySynthesisService.ts` |
| **What it needs** | A **push** rule: the top-N retrieved skills (currently ≤400 chars each) go into the prompt alongside the index, with a budget. The retrieval already computes the ranking and the stage budget — it computes it and throws it away (F-01). |
| **Effort** | **M** — and it is the **same work as E-01(a)**, so the two should be one change. |
| **Risk** | **M** — the push changes every prompt. It must be budgeted and measured. |
| **Data** | **works with zero trades** — retrieval is not data-dependent. |
| **Roadmap** | **PARTIAL** — `R-161`/`G-32` record that *"nothing is pulled"* as an open research finding, and `R-135` made `description` the trigger. **The missing part, named: the roadmap discusses pull-vs-push as a *storage* question; it does not propose the push rule as a *prompt-budget* question.** |

### N-19 — "What changed in my thinking"

| | |
|---|---|
| **User value** | The trader's doctrine and settled beliefs change over time — a rule is added, a belief is settled, a skill is demoted. The app changes them silently. The trader should see the diff. |
| **Reuses** | `services/learning/DoctrineConsolidationService.ts` (the doctrine rewriter) · `services/learning/settledBeliefs.ts` · `services/learning/skillIdleLifecycle.ts` (the suspension clock) · `services/learning/memoryHygiene.ts` (the demotion / contradiction sweeps) · `services/learning/supervisorStore.ts` (the triage ledger) · `services/learning/memoryTopics.ts` (the topic index) |
| **What it needs** | A read surface over the change ledger. The supervisor's triage ledger (`services/learning/skillSupervisor.ts:317-606`) already records approve/enhance/reject per item; **nothing renders it as a diff.** |
| **Effort** | **M** |
| **Risk** | **S** |
| **Data** | needs changes to have happened. |
| **Roadmap** | **PARTIAL** — `R-089` ("Agents shows `N lessons · N skills · N evidence` that cannot be opened") is the same shape for the agents pane. The **doctrine diff** is **NEW**. |

### N-20 — The expectancy the trader actually has

| | |
|---|---|
| **User value** | *"Your break-even win rate at your fee tier and your average stop is 50 %. You are at 47 % over the last 60 calls. At the R:R you are actually taking, you need 44 %."* — the number that connects the app's gate to the trader's bankroll. |
| **Reuses** | E-03's cost model (the new `netR` / `costR`) · `services/validation/AccuracyValidationService.ts` (the grade bands) · `utils/riskReward.ts` (the canonical ratio) · `services/learning/SkillMemoryService.ts` (the per-skill expectancy) · `services/learning/calibrationPolicy.ts` |
| **What it needs** | E-03 first. Then a surface that puts the break-even beside the actual. |
| **Effort** | **M** after E-03 |
| **Risk** | **M** — this is the number a trader will act on, so it must be right. Which is why it comes after E-03 and E-02. |
| **Data** | **[DATA-GATED]** |
| **Roadmap** | **NEW** — `G-01`/`G-02` identify the missing cost model but propose no surface. |

---

## 8. Ranked

| rank | id | feature | workflow | effort | data | roadmap |
|---|---|---|---|---|---|---|
| 1 | **N-03** | The open-position digest | manage | S–M | 1 trade | NEW |
| 2 | **N-08** | A size suggestion on the card | plan | S–M | none | NEW (needs E-12) |
| 3 | **N-01** | A pre-session brief | prep | M | none | NEW |
| 4 | **N-15** | A weekly review that names what changed | review | S–M | **[DATA-GATED]** | PARTIAL (R-087) |
| 5 | **N-04** | The watch list becomes the scan's input | scan | M | none | NEW |
| 6 | **N-14** | The skill's own evidence | journal | M | **[DATA-GATED]** | COVERED (R-084) |
| 7 | **N-13** | "What this trade taught" | journal | M | **[DATA-GATED]** | COVERED (R-085) |
| 8 | **N-05** | "What changed since yesterday" | scan | M | 1 trade | NEW |
| 9 | **N-19** | "What changed in my thinking" | improve | M | changes | NEW |
| 10 | **N-18** | Push the gate-verified skill | improve | M | none | PARTIAL (G-32) |
| 11 | **N-02** | Session setup checklist | prep | M | none | NEW |
| 12 | **N-10** | Arm the plan, not the price | manage | M | none | NEW (after N-09) |
| 13 | **N-11** | The veto ledger, visible | manage | S–M | runs | NEW |
| 14 | **N-12** | One home for "what is open" | manage | M | open positions | PARTIAL (R-049) |
| 15 | **N-09** | "What would have to be true" | plan | M | none | NEW |
| 16 | **N-07** | The trader can adjust the plan | plan | L | **[DATA-GATED]** | NEW |
| 17 | **N-16** | Replay | review | L | **[DATA-GATED]** | NEW |
| 18 | **N-06** | Counter-pattern scan | scan | M | **[DATA-GATED]** | NEW |
| 19 | **N-20** | The expectancy the trader has | improve | M | **[DATA-GATED]** | NEW (needs E-03) |
| 20 | **N-17** | The calibration ledger, decided | review | S–M | **[DATA-GATED]** | COVERED (G-56) |

## 9. Only worth building after real data exists

**Seven features are [DATA-GATED]**: N-06, N-07, N-13, N-14, N-15, N-16, N-17, N-20.

**But their precondition is a single change, not a data collection project: E-18 — record the
outcome automatically (with a provenance flag and a correction path).** Until then, the features
are not "early", they are **meaningless**: a review with no closed trades, a skill with no
evidence, a replay with no history, a break-even with no win rate.

**The one thing to do before any of them: the owner's ruling on the click gate.** The previous
audit was explicit — *"the starved link is the click gate, not the toggle"* — and the roadmap lists
it as one of its 23 open owner decisions. **This is the highest-leverage decision in the repository
and it is not a code change.**

## 10. What is deliberately **not** proposed

The brief excludes order placement, exchange write access, regime routing, debate revival, extra
LLM review calls and a macro calendar. **None is proposed here.** In particular:

- **No order placement and no exchange write access**, because the app's product promise and its
  test-enforced disclaimer both depend on it. `tests/disclaimer.test.ts` asserts the app *"never
  places or signs a trade"* and that `PRIVACY.md` says *"no API key, no signature"*. A feature that
  broke that would break the thing the app *is*.
- **No regime routing.** The app has a regime ledger; the proposal is to *show* the regime
  (N-01, N-05) and to *measure* it, never to route on it. Routing makes the app decide.
- **No debate revival.** The ensemble became a tool-turn architecture; N-18 and N-09 extend the
  tool-turn architecture, they do not bring back a moderator.
- **No extra LLM review calls.** Every feature above is either a read surface over data the app
  already computes, or a *push* of context the app already assembles. **N-18 in particular makes
  the app use the retrieval it already pays for.** The one feature that calls a model is N-16
  (replay) — and its first version deliberately does **not**: it replays the deterministic code.
- **No macro calendar.** It is a data source, not a workflow, and it would put third-party
  economic-release data on the critical path of a trading decision.

---

## 11. The two new user-facing features

**Added 2026-10-20** at the owner's request. The deep dives are in Report 1 §12.

### N-21 — "Review all my skills" — one button, a verdict per skill, and a diff before anything changes

| | |
|---|---|
| **User value** | The trader has dozens of learned skills and **no way to see which of them are actually working**: which never fire (a description that does not say WHEN), which are silently clipped at the 700-char recall cap, which have a malformed frontmatter, which shadow each other. Today that is only discoverable by reading the raw files. One button produces a per-skill verdict, and — for the ones that are wrong — a **proposed fix the trader accepts or rejects**. |
| **Reuses** | `parseSkillMarkdown` (the parser) · `serializeSkill` (the serializer — a parse→serialize→compare round-trip is the format check) · `services/learning/skillDocument.ts` `parseSkillBody` / `projectSkillCard` (the section check and the clip count) · `skillFileNameFor` (the name check) · `utils/learningQueue.ts` (the proposal queue) · `components/learn/ActionApprovals.tsx` (the approval surface) · `services/learning/SkillCraftService.ts` (the model call that rewrites a description) · `services/learning/SkillEvalScheduler.ts` (the budgeted, scheduled precedent) |
| **What it needs** | A new job with a deterministic first stage and an optional model second stage, and a button in `components/learn/SkillsCatalog.tsx`. **No new dependency, no new store, no new table.** |
| **Effort** | **M** — the deterministic stage is **S**, the model stage is **M** |
| **Risk** | **M** — a batch that rewrites skills can damage them. **The rule: the job proposes; the existing human gate applies.** One diff per skill; per-skill revert; the deterministic pass runs alone first. |
| **Cohort / data** | Needs the trader's own skills (they exist from day one) and, for the model stage, a ready provider. **No closed trades needed** — this works on a brand-new profile. |
| **Roadmap** | **NEW** — the *format* is already a documented Agent Skills port (`services/learning/SkillMemoryService.ts:411-431`); the *bulk review* is not in the corpus. See Report 1 §12.3. |

### N-22 — "Still running" — the conversation rail shows where the model is thinking

| | |
|---|---|
| **User value** | After E-45, a run keeps going while the trader looks at another conversation. **Unless the app says so, that reads as a hang.** The rail should carry a busy badge on the conversation that is still streaming, and the dock's own session list already tracks busy sessions. |
| **Reuses** | `services/trade/chatStore.ts` (the store already tracks busy sessions — `beginRun`/`endRunOwned`, `:479`/`:493`) · `components/trade/TradeChatPanel.tsx:302` (*"unmounts, but the run keeps streaming into the store"*) · the conversation rail (`components/shell/SurfaceMenuList.tsx` / `components/chat/`) · `utils/runStatus.ts` — **the one module that owns the run-status vocabulary** (`AGENTS.md`: *"Never hardcode a status colour in a component"*) |
| **What it needs** | A per-conversation busy flag surfaced from the store into the rail. The state exists; the surface does not. |
| **Effort** | **S** once E-45 lands (it needs the per-conversation ownership E-45 introduces) |
| **Risk** | **S** — but it must use `utils/runStatus.ts`'s vocabulary, not a new colour. |
| **Cohort / data** | None — it is a live-state surface. |
| **Roadmap** | **NEW** — and it is **the second half of E-45**: the run survives, so the app has to say so. |
