# August Trading — New Feature Proposals, ranked by trader workflow

**Audit date:** 2026-10-21 · **Commit:** `b584d7ee1cbc2360bc1d90098c6a3191b221a1cf`
**Companion reports:** `2026-10-21-01-system-and-data-flow.md` (evidence), `-02-enhancements.md`, `-04-cleanup-manifest.md`

**How to read this.** The prior audit proposed 22 features (`N-01`…`N-22` in `docs/plan/audit/2026-10-19-03-new-features.md`). A fix pass landed since, so several are **partially or fully built** and the register's "OPEN" markers are stale. This report re-states each one against HEAD, marks its **true** status, re-ranks it, and adds four new proposals that only became possible — or only became necessary — after this audit's findings.

**The one rule that orders everything below:** the app's context budget is currently 92 % tool schemas (`B-03`). **Any feature that adds a model round, a tool schema or an injected-context block is net-negative on cost until `B-03` lands.** Features that make the *existing* evidence legible — without adding a round — are the ones worth building now. That is why the list below is weighted toward read-side and ledger-side work and away from new chat surfaces.

**Status legend:** ✅ built · 🟡 partially built · ⬜ not built · ⛔ not built and the prior premise no longer holds

---

## 1. The trader's day, and what the app currently supports

| stage of the day | what exists today | the gap |
|---|---|---|
| **Before the open** | automation schedules run on their own (`automationTurn.ts`) | no brief; the trader finds out what the app did by reading a transcript |
| **Scanning** | `scan_setups`, `run_screener`, `scan_chart_skills` (dock only) | no "what changed since yesterday"; no counter-pattern scan |
| **Deciding** | `present_trade` → card → veto/cap enforcement → `decline_trade` | no size on the card, no structured thesis, no visible veto ledger, no arm-vs-price concept |
| **Executing** | level-watch arming, price alerts, trade log | the plan expires never (`O-26`) — `ENTRY_NOT_HIT` is never written |
| **Reviewing** | journal, dashboards, `recall`, `get_trade_log`, `recall_chat` | settlement waits on a human click (`O-28`); the journal records no feature snapshot (`O-46`) and the write time, not the decision time (`O-48`) |
| **Learning** | skills, notebook, doctrine, rules, pattern memory, post-mortem, weekly review | nothing charges the round trip (`O-19`); most consumers are starved behind the settlement click |

---

## 2. The prior 22, re-stated and re-ranked

### Rank 1 — 🟡 **N-14 · The skill's own evidence, one click away**
**Why first:** it is the app's biggest "why" hole (`O-76`), and it is **read-side only** — it adds no model round, no schema, no context block. It is the cheapest high-value thing in the entire proposal set.

Today a skill can be confirmed, injected, and credited, but the trader cannot see *the trades that earned it*. `O-76` calls this *"the single biggest 'why' hole."*

**Build:** a per-skill evidence panel listing the closed trades whose settlement touched that skill, with the R (net, once `B-06` lands), the dates, and the regime. The data is already there — `SkillMemoryService` records the attribution, and `VetoLedgerService` and the injection ledger already track which skill touched which trade. **This is a query, not a new pipeline.**

**Roadmap:** NOT IN THE REGISTER (the register's `O-76` records the hole but proposes no feature for it).

---

### Rank 2 — ⬜ **N-16 · Replay: "what would today's code have said about last Tuesday's plan?"**
**Why:** the replay harness **already exists** (`utils/planReplay.ts` + `scripts/replay-plans.entry.ts`, `E-20` landed) and re-derives every number through the *same* `buildTradePlan` the live card uses. The work that remains is a UI, not a rebuild.

**Build:** a "replay" button on any historical plan: re-run the gate, the skill predicates and the veto check against the plan as it was, and show a diff — *what today's rules would say about that plan*. This is the single most useful thing the app could offer a trader who is trying to learn whether their rules are actually rules.

**Blocker to note:** `planReplay` is currently reachable only from a CLI entry, so it is one of the "orphans" in the reachability graph that are *not* actually dead. `B-19`/Report D tracks it as CLI-live.

**Roadmap:** ALREADY COVERED — `E-20` (harness, landed); the UI is the open half.

---

### Rank 3 — ⬜ **N-11 · The veto ledger, where the trader can see it**
**Why:** the ledger's **writer** landed in the last fix pass (`E-35` — `presentTradeTool.ts:118` now calls `VetoLedgerService.recordVeto` on every hard refusal). The **reader** does not exist. The app now writes an audit trail of every setup a confirmed rule blocked, and shows the trader none of it.

**Build:** a surface listing vetoed setups — coin, direction, the rule that fired, the reason, the date — with a filter by rule. This is the "the app said no and I want to know why" view, and it is a pure read.

**Also fixes a live finding:** `presentTradeTool.ts:128` swallows the ledger write (`.catch(() => { /* best-effort */ })`). If the write fails, the veto is invisible to both the trader and the audit. A UI makes that swallow visible; a `console.warn` makes it debuggable.

**Roadmap:** PARTIAL — `E-35` (writer, landed) + `O-43` (owner decision: "one inbox, one supervisor view"). The reader UI is the open half.

---

### Rank 4 — ⬜ **N-01 · A pre-session brief**
**Why:** `O-14` and `O-28` combine into this. A decline leaves **no object** (there is no `NO_TRADE`/`HOLD` outcome in the journal), and settlement waits on a click. So "what did the app decide while I was away?" is currently unanswerable.

**Build:** one screen: what ran, what it proposed, what it declined and why, what is still open, and what needs one click from the trader.

**Blocker:** needs `N-11` (the veto/decline ledger) and `B-07` (auto-settlement) first. **Sequencing: `B-07` → `N-11` → `N-01`.**

**Roadmap:** NOT IN THE REGISTER (the register's `O-14` records the missing object; `N-01` was proposed in the prior audit and never built).

---

### Rank 5 — ⬜ **N-13 · "What this trade taught"**
**Why:** `O-77` — the Journal never says what a trade taught the app. The post-mortem writer was **deleted** (2026-10-18) and all five post-mortem writers are frozen (`O-35`).

**Build:** on each closed trade, one card: the lesson extracted, the skill or rule it changed, and — once `B-07` lands — the settlement that triggered it.

**Blocker:** the post-mortem chain is frozen and `B-06` (cost model) should land first, or the lessons will be learned from gross numbers.

**Roadmap:** ALREADY COVERED — `N-13` (prior audit) + `O-35`, `O-31`.

---

### Rank 6 — ⬜ **N-22 · "Still running" — the conversation rail shows where the model is thinking**
**Why:** the dock's longest jobs are invisible. `O-72` records this as *"the flagship run is a black box"* and *"worse than recorded"* — the step ladder is muted for the dock's "Full analysis". A trader cannot tell a hung turn from a slow one, and the turn can legitimately run **43 minutes** (`B-09`).

**Build:** a rail showing the current phase, the elapsed time against the real ceiling, the tools called, and a Stop that works (the desk's Stop landed — `O-73` is CLOSED).

**Depends on `B-09`:** until the 180 s budget is a real cap, a progress rail would be showing a number the app does not enforce.

**Roadmap:** ALREADY COVERED — `N-22` (prior audit) + `O-72`.

---

### Rank 7 — ⬜ **N-09 · "What would have to be true" — a structured thesis on the card**
**Why:** a trade card shows entry, stop, targets and a probability. It does not show **the conditions that would make the trade wrong**. The app has an `invalidation` field on the proposal (`services/trade/proposedTrade.ts:41`) and an `INVALIDATION_THESIS_PROMPT` (`constants/prompts/analysisPrompts.ts:121-142`) — but the prompt is only used by `HybridIntelligenceService.enhancedInjection`, not by the analysis path that produces the card.

**Build:** on the card, the invalidation stated as checkable conditions with the price levels that would trip them.

**Cost note:** this is a *re-prompting* change (the model must produce it), so it adds context. It is worth it only after `B-03` shrinks the schema tax, and only if the existing `invalidation` field is actually populated — which this audit did **not** verify.

**Roadmap:** ALREADY COVERED — `N-09` (prior audit).

---

### Rank 8 — ⬜ **N-06 · Counter-pattern scan: what you have been wrong about**
**Why:** `O-06`/`N-06` — the app's learning is entirely confirmatory. It records what the trader did and why it worked; it has no surface that deliberately looks for the setups the trader *loses on* and the rules that keep missing them.

**Build:** a scan that takes the trader's closed losses, groups them by the predicate that should have fired and did not, and proposes one rule to add.

**Blocker:** `B-06` (cost model) and `B-07` (settlement) — a counter-pattern scan over gross R and a click-gated settlement is noise.

**Roadmap:** ALREADY COVERED — `N-06` (prior audit).

---

### Rank 9 — ⬜ **N-05 · "What changed since yesterday", per symbol**
**Why:** the most-asked question in a trading journal, and the app has every input for it: candles (cached, 30 s TTL), the trader's own levels, the watch list, and the journal.

**Build:** per watched symbol: what moved, which of the trader's own levels came into range, and what the app's own last verdict was.

**Cost note:** read-side; no new model round is strictly required, but the *summary* would need one. Do it as a deterministic diff first, and only add a narration round after `B-03`.

**Roadmap:** ALREADY COVERED — `N-05` (prior audit).

---

### Rank 10 — ⬜ **N-03 · The open-position digest**
**Why:** `O-82` — *"one fact, several homes"*. The trader's open positions are scattered across the dock, the watch list and the journal.

**Build:** one list: every armed watch and every pending plan, with its live distance to entry/stop/target, its age, and its plan id.

**Blocker:** `O-26` — a presented plan never expires, so "open" currently has no end. `E-38` (plan expiry) must land first, or the digest is a list of every plan the trader ever saw.

**Roadmap:** ALREADY COVERED — `N-03` (prior audit) + `O-26`/`E-38`.

---

### Rank 11 — ⬜ **N-10 · Arm the plan, not the price**
**Why:** closely related to `N-03` and to the *wiring* of the arm/level-watch. The harness already arms a level-watch on a plan id (`presentTradeTool.ts:167-170`); the trader has no surface for "these are the conditions I am waiting for".

**Roadmap:** ALREADY COVERED — `N-10` (prior audit).

---

### Rank 12 — ⬜ **N-08 · A size suggestion on the proposal card**
**Why:** 🟡 **largely built.** `E-12` (re-home the position sizing) landed: `utils/ticketSize.ts` is now imported by `services/trade/proposedTrade.ts:23`, `components/trade/panels/TradeProposalCard.tsx:19` and `hooks/useTradeLogging.ts:25`. `computeContractSize` and `computeLiquidationBuffer` exist, and the card imports them.

**What is left:** the card still shows a *computed* size, not a *suggested* size from the trader's own risk setting, and `O-24`/`E-41` record that the default leverage is 100× with the liquidation buffer in an unreachable module (`O-23`'s "imported only by tests" is now fixed; `O-24`'s "buffer in the unreachable module" is not).

**Roadmap:** ALREADY COVERED — `N-08` + `E-12` (landed) + `E-41`/`O-24` (open half).

---

### Rank 13 — ⬜ **N-19 · "What changed in my thinking"**
**Why:** the app can show what the trader *did* and what it *learned*; it cannot show how the trader's **reasoning** changed between two similar setups. `O-33` (nothing checks `approvedBy` at injection time) and `O-32` (14 paths make a rule active with no human approval) make this sharper: the trader's stated reasons and the app's active rules are not visibly connected.

**Roadmap:** ALREADY COVERED — `N-19` (prior audit).

---

### Rank 14 — ✅/⬜ **N-21 · "Review all my skills" — one button, a verdict per skill, and a diff before anything changes**
**Why here:** the **review job** landed (`E-48`, `E-48b` — three verdicts, proposes only what is safe). What is not built is the **surface**: a one-button review of every skill with a per-skill verdict and a diff before anything changes. The machinery proposes; nothing presents.

**Roadmap:** PARTIAL — `E-48`/`E-48b` (job, landed); the surface is the open half. Closest register item: `O-43` ("one inbox, one supervisor view") and `O-44` ("no UI button was added" for the throttled worth-gate cluster).

---

### Rank 15 — ⬜ **N-15 · A weekly review that names what changed**
**Why:** 🟡 **partly built and partly broken.** The weekly/monthly review cards **return `null`** — `O-79`: *"pending, failed and never ran are indistinguishable."* A weekly review that cannot say "it did not run" is worse than no weekly review, because the trader assumes it ran.

**Build first:** make the three states distinguishable. Then the review can name what changed.

**Roadmap:** ALREADY COVERED — `N-15` + `O-79`.

---

### Rank 16 — ⬜ **N-17 · The calibration ledger, decided**
**Why:** `O-110` and `O-43` — an unresolved **product** decision, not an engineering one. The code poses the question; the trader must answer it.

**Roadmap:** ALREADY COVERED — `N-17` + `O-110` (owner decision).

---

### Rank 17 — ⬜ **N-18 · A skill the gate just verified is pushed, not indexed**
**Why:** `E-37` raised the evidence floors, and `O-29` shows `MIN_SAMPLE_FOR_VETO = 2` lets a two-trade sample zero a real setup. The proposal — a verified skill goes to the front of the index, not into the 30-slot window — depends on `B-06` and `B-07`.

**Roadmap:** ALREADY COVERED — `N-18` + `E-49` (rank the 30-slot index) + `E-37`.

---

### Rank 18 — ⬜ **N-02 · Session setup: a checklist the app can fill**
**Why:** the lowest-ranked of the prior 22 for a reason: it is a *new surface* with a *new model round*, which is the most expensive kind of proposal while `B-03` is open.

**Roadmap:** ALREADY COVERED — `N-02`.

---

### Rank 19 — ⬜ **N-04 · The watch list becomes the scan's input**
**Why:** `run_screener` walks the universe deterministically but is only called on demand, and **automations have no symbol field** — the instrument comes from the prompt text (`O-51`). Making the watch list the scan's input is a small, cheap change to an existing tool.

**Roadmap:** ALREADY COVERED — `N-04` + `O-51` (owner-approved: 365-day candidate log, no daily scan).

---

### Rank 20 — ⬜ **N-07 · The trader can adjust the plan, and the adjustment is recorded**
**Why:** the trader can reject or accept; the app records no *adjustment*. `O-46` and `O-48` are the sibling holes (no feature snapshot, write-time not decision-time). A recorded adjustment is the missing third of the "what actually happened" trio.

**Roadmap:** ALREADY COVERED — `N-07` + `O-46`, `O-48`.

---

### Rank 21 — ⬜ **N-20 · The expectancy the trader actually has**
**Why:** the direct consequence of `B-06`. Until the round trip is charged, every expectancy the app shows is gross — and `O-20` already showed the permitted-floor trade nets ≈ 0 R.

**Roadmap:** ALREADY COVERED — `N-20` + `E-03`.

---

### ⛔ **N-12 · One home for "what is open"**
**Re-scoped.** `N-03` (the open-position digest) and `N-12` (one home) are the same feature. The prior audit listed both. **Keep one** — the digest (rank 10) — and close `N-12` as merged.

---

## 3. Four new proposals this audit produced

### C-01 · 🆕 **An audit log for unattended runs**
**Impact: medium-high · Effort: 1 d · Roadmap: NOT IN THE REGISTER**

`B-01` establishes that an unattended background process (the skill evaluator) currently holds a 40-tool surface with no allow-list. Fixing the allow-list is necessary but not sufficient: **the trader needs to see what unattended runs did.**

Today, an unattended run's effects are scattered: a notebook file (no author, no run id), a profile-memory entry (`source: 'model'`), a skill draft in the inbox, a decline row filed as `source: 'desk'` (see `B-18`), and a forged tool's HTTPS call. **None of them says "this happened at 03:14, in run X, without the trader watching."**

**Build:** one append-only record of every unattended run: run id, timestamp, trigger, the model, every tool called, and every store it wrote. It is the missing half of `B-01` and the precondition for `N-01` (the pre-session brief).

**Why read-side matters:** the log itself adds no model round and no schema.

---

### C-02 · 🆕 **"What today's rules would say" — a rules diff on every closed trade**
**Impact: medium · Effort: 1.5 d · Roadmap: NOT IN THE REGISTER**

`N-16` (replay) is the same idea applied to *plans*. This applies it to *settled trades*: for each closed trade, re-run today's skill predicates, the veto rules and the gate against the analysis the trade was taken on, and show which rules would have fired **now** but did not fire then.

The machinery is the replay harness (`utils/planReplay.ts`, `E-20`) plus the skill-predicate evaluator — both already single-sourced. The output is a per-trade diff.

**Why it earns its place:** it is the only proposed feature that directly measures the thing the whole learning loop claims to produce — whether the trader's rules are actually changing their behaviour.

**Depends on:** `B-07` (settlement) and `B-06` (cost model), so the diff is against real net outcomes.

---

### C-03 · 🆕 **A cost panel on the trade card**
**Impact: medium · Effort: 1 d · Roadmap: PARTIAL — `E-03` (the cost model), but no surface is proposed**

`B-06` builds the cost model. This is its **surface**: on the trade card, show the fee, the estimated slippage and the funding assumption, and the plan's net expectancy at its own stated probability.

The app already has the primitives (`utils/netRiskReward.ts` — `netEdgeR`, `roundTripCostR`, imported by `services/trade/proposedTrade.ts:24`). What is missing is a number the trader sees. Without it, `O-19` is invisible: a trader cannot know that the plan they are about to take nets ≈ 0 R.

**A note on honesty:** the card must show the *assumption*, not a precise number. `E-03` requires the rate to be an explicit, user-editable assumption — the same discipline the app already applies to the risk percentage.

---

### C-04 · 🆕 **A "model card" for the seat the trader is talking to**
**Impact: low-medium · Effort: 0.5 d · Roadmap: NOT IN THE REGISTER**

Three small, concrete gaps make the trader unable to know what the model in front of them actually is:

1. `get_btc_context`'s description says *"Required before trading alts"* — an instrument rule hardcoded into a tool description (`B-25`).
2. `EFFORT_BY_TASK.chat = 'low'` (`O-56`) — the default reasoning tier for a trade decision is the lowest, and the trader is not told which tier answered.
3. `isSmallContextModel` silently swaps the whole prompt set (`B-02`), and `get_btc_context`/`B-25`'s `'BTCUSDT'` default means a symbol-less turn analyses BTC.

**Build:** one line above the transcript: the model, the effort tier, the tool set, and whether the compact prompt path was taken. This is a **read-side** change with no model cost, and it is the honest counterpart to `B-02` — a trader whose instructions were dropped should be able to see that.

---

## 4. The recommended order

Sequenced by **dependency first, then value**, with the explicit constraint that nothing that adds a model round ships before `B-03`.

**Phase 1 — free, and it removes risk (≈ 2 days total)**
`B-01` (eval allow-list) → `B-11` (compose the mandate) · `B-05` (export/restore lists) · `B-18` (decline source) · `B-08` (panel deadline + try/catch) · `B-09` (turn budget as a cap)

**Phase 2 — the metric comes before the learning (≈ 5 days)**
`B-06` (cost model) → `B-07` (auto-settlement) → `E-38` (plan expiry) → `B-03` (schema tax, first lever only)

**Phase 3 — make the evidence legible (≈ 4 days)**
`N-14` (skill evidence) → `N-11` (veto ledger) → `C-01` (unattended-run audit) → `N-15` (fix the three null states)

**Phase 4 — the surfaces that need Phase 2 (≈ 6 days)**
`N-16` (replay UI) → `C-02` (rules diff) → `N-03` (open digest) → `N-13` (what it taught) → `N-01` (pre-session brief)

**Phase 5 — the schema tax is gone, now new model rounds are affordable (≈ 5 days)**
`B-02` (small-context layers) → `B-10` (gate constraints in the prompt) → `B-12` (surface-aware schema) → `N-09` (thesis on the card) → `C-03` (cost panel) → `N-06` (counter-pattern scan)

**Phase 6 — the long tail**
`N-05`, `N-07`, `N-10`, `N-19`, `N-20`, `C-04`, `N-02`, `N-04`, `N-18`

**Why Phase 1 is first and costs almost nothing:** three of its five items close real defects (an unattended process with write capability, a turn that can run 43 minutes, an export that refuses its own data) and none of them touches the model's context. **Nothing else in this report is that cheap relative to the risk it removes.**

---

*Next: **Report D** — the cleanup manifest, the dead-code census, the dependency list, the test plan and the docs audit.*
