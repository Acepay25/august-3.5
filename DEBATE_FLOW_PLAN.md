# August Debate Flow — Deep Scan & Enhancement Plan

_Date: 2026-08-22 · Scope: ensemble debate (the harness's core feature) · Status: proposal only, no code changed._

> **Merged 2026-08-23:** Consolidated into `MASTER_IMPROVEMENT_PLAN.md` (Parts II, IV, VI–X). Kept for reference; D0–D4 IDs are stable there.

---

## Part 1 — How the debate actually works today (verified map)

### 1.1 Pre-debate (pipeline stage, `useAnalysisPipeline.ts`)

1. **Staged ensemble**: each analyst runs its own full Stage-2 analysis in parallel
   (700 ms launch stagger, deterministic per-seat temperature 0.55–0.85 so three
   seats sharing one prompt sample differently).
2. **Gate Scan** runs first (confidence cap + allowed families) and its output is
   injected into every seat's context.
3. **Memory gate** pre-step: a confirmed avoid skill can force
   `skip_to_verdict` before any round runs (`debatePreStep`).
4. **Pre-debate divergence** (`analyzePreDebateDivergence`, ensembleService.ts:697)
   scores direction / confidence / entry-spread disagreement across the openings.

### 1.2 Round 1 — openings (free)

Openings are each analyst's **existing** final output — zero extra API calls
(`openingFromResult`). Crash-resume can seed them from `resumeState`.

### 1.3 Pre-rebuttal machinery

| Mechanism | Where | What it does |
|---|---|---|
| Consensus shortcut | :2926 | Divergence < 15 + same direction + entry spread ≤ 0.8 % → trim one rebuttal round |
| Level discipline | :2948 | Missing Entry/SL/TP1 in an opening → flagged into that seat's next prompt |
| Clarification worthiness | :2886 | Runs only when divergence ≥ 20 or direction/multiple divergence |
| Synthetic dissent | :780 | Echo chamber (score < 15) → moderator-must-argue-both-sides protocol at verdict |
| Desk cache reset | :2784 | `clearDeskToolCache()` per debate — no stale cross-run market data |
| Deadline | :2789 | 8 min default wall-clock; expiry skips remaining rounds → verdict always arrives |
| Connection warm-up | :2971 | Moderator socket warmed during rebuttals |

### 1.4 Rebuttal pump (rounds 2..N) — the most sophisticated part

- **Per-seat speculative scheduling** (:2972): a seat's round N+1 fires the moment
  its round N settles — no round barrier. Correctness kept via **diff packets**
  (`buildRebuttalDiffPacket`) against whatever peer positions exist at launch.
- **Devil's advocate rotation** (:3007): one seat, seeded by prompt hash, is
  assigned the contra case for its first rebuttal — kills premature agreement.
- **Evidence round** (round 3): each seat must cite one concrete on-table data point.
- **Sealed conviction** (final round): `CONVICTION: <0-100>`, private, revealed to
  the moderator only via `buildConvictionAuctionBlock` (:2484).
- **Levels snapshot table**: machine-extracted Entry/SL/TP rows per seat each round.
- **Loss priming**: similar closed trades (outcome + key lesson only) injected.
- **Live price refresh** at every round boundary (`buildLivePriceRefreshBlock`).
- **Centralized market snapshot** injected once (round 2) to avoid N× tool calls.
- **Per-seat tool allowlists** (bot `enabledTools`) + transient retry (429/5xx/network).
- **Drop handling**: failed seat purged from transcript, replacement offered (60 s
  wait), injected mid-debate with its own streamed opening; late deltas discarded.
- **User steering**: queued mid-debate notes injected into the next turn + verdict.
- **Budget**: USD cap (`shouldSkipRemaining`) and deadline both skip to verdict.

### 1.5 Clarification loop (before verdict)

- Up to `MAX_CLARIFICATION_CYCLES` (3): moderator questions (may short-circuit
  `<CLARIFICATION_DONE>`) → parallel per-analyst answers (60–100 words, addressed
  via per-seat target aliases) → internal judgment (satisfied/unsatisfied).
- Cycle 3 has **no judgment call** — verdict is forced.
- Skipped entirely when openings aligned; skipped when the floor converges during
  rebuttals (entry spread check).
- Failures degrade gracefully: questions fail → skip; judgment fails → satisfied.

### 1.6 Verdict

- Context blocks: full weighted transcript (recency-weighted), **conviction
  auction**, **seat trust record** (`buildSeatTrustBlock` :2513 — per-seat Brier
  score, High-gap overconfidence, avg sealed conviction, from stored debates),
  final-stance divergence recomputed post-clarification, live price, user steering.
- Compact-prompt retry on moderator failure; abort/rate-limit propagate cleanly.
- Output contract: verdict prose → `</DEBATE_END>` → labeled **FINAL TRADE PLAN**
  markdown (single-line fields; Avoid = Neutral + reason, no invented levels).

### 1.7 Post-debate enforcement (code, not prompt)

- `attachVerdictCitations` — each analyst marked aligned/dissented vs verdict.
- `enforceCitedVerdict` (:888) — a verdict citing **no** analyst is forced Neutral
  ("moderator must quote, not average").
- `applyNotebookSkillsToAnalysis` (useAnalysisPipeline.ts:1746) — notebook skill
  vetoes apply to the final plan (confirmed avoid → Neutral, prob ≤ 15).
- Plan parsed from labeled lines → zod validation → Monte Carlo → journal →
  post-mortem debate variants (two-way/three-way) on close.

### 1.8 The other debate paths

- **Simulated debates** (`conductTwoWayDebate` / `conductThreeWayDebate`,
  `MODERATOR_SYSTEM_PROMPT_V2`): one moderator call autoplays all roles in
  `<TURN>` envelopes; 9 mandatory sections; accuracy pass (`verifyAccuracyPlan`)
  can adjust the plan afterwards.
- **Post-mortem debates**: two-way/three-way variants + `recalculateProbabilities`.

### 1.9 Test coverage

`tests/debateFlow.test.ts` covers: openings with zero API calls, speculative
pump, clarification cycles (satisfied/unsatisfied/cap/short-circuit/failure
paths), live-price injection, drops + replacements (rebuttal & clarification),
replacement-wait suspension, moderator retry/compact fallback, abort semantics,
three-analyst flows. Strong suite — enhancements below must extend it.

---

## Part 2 — What is already excellent (do not touch)

1. **Speculative rebuttal pump** — latency win most agent harnesses don't have.
   Any change must preserve its no-barrier semantics.
2. **Mechanism design**: sealed conviction auction + seat-trust Brier scores is
   genuine adversarial-collaboration engineering, not prompt theater.
3. **Anti-echo-chamber is two-layered** (devil's advocate rotation + synthetic
   dissent protocol) with different trigger conditions.
4. **Graceful degradation everywhere**: drop → replace → resume → budget-skip →
   timeout-skip → compact retry. The debate always produces a verdict.
5. **Code-enforced honesty**: uncited verdicts forced Neutral; skill vetoes apply
   post-debate regardless of what the moderator wrote.

---

## Part 3 — Weak spots found in the scan

| # | Finding | Severity | Detail |
|---|---|---|---|
| W1 | **Arbiter's pull channel is broken** | High | `getModeratorAnalysisStream` never receives `trades`, so the moderator's `recall` desk tool returns no similar-trade history — the seat issuing the binding verdict has *less* history than rebuttal-stage analysts, contradicting the retrieval design ("similar trades are verdict-stage material"). |
| W2 | **No in-room dispute resolution** | High | Claims like "this setup usually fails" cannot be checked by any seat. The trade log already holds the ground truth; no tool exposes it. |
| W3 | **Seat trust is advisory-only** | Medium | Brier/overconfidence data is injected as prose ("weight accordingly") but `buildAnalystConsensus` citations and any voting remain unweighted — an overconfident seat's dissent counts the same. |
| W4 | **Conviction is single-shot** | Medium | Captured once at the final rebuttal. Persuasion is invisible: nobody knows if the devil's advocate round actually moved anyone (70 → 45). |
| W5 | **Rebuttal diff packets lose self-history** | Medium | A seat sees peers' current positions but not its own prior round text — "you abandoned your TP2 argument" is impossible to notice. |
| W6 | **Moderator tool policy = all 8 tools** | Medium | No deliberate policy (order-book data in a verdict can outweigh argument quality); inconsistent with bot allowlists elsewhere. |
| W7 | **Divergence score is shallow** | Low | Direction/confidence/entry-spread only. Two Longs with invalidations 4 % apart score as "agreeing". |
| W8 | **Lopsided-floor verdicts are silent** | Low | If budget expires with 1 active seat + moderator, the verdict doesn't flag that it ruled on a partial floor. |
| W9 | **Debate protocol is not experimentable** | Low | Prompt lanes exist (promptAbRate) but protocol knobs (rounds, devil rotation, clarification threshold) have no A/B lane + outcome tracking. |
| W10 | **Two debate "physics"** | Low | Simulated autoplay (7 rounds, 9 sections, one call) vs real debate (pump + cycles) have drifted semantics; accuracy-mode users get a different debate than ensemble users. |
| W11 | **No per-seat cost attribution in run events** | Low | Budget cap exists; per-seat token/cost breakdown per debate is not in `DebateRunEvent`, so expensive seats can't be identified. |

---

## Part 4 — Enhancement plan (phased, with acceptance criteria)

### Phase 0 — Fix the arbiter (≈ half day, P0)

**D0.1 — Give the moderator its memory.**
Add optional `trades?: LoggedTrade[]` to `getModeratorAnalysisStream`; pass
`fullTradesForRecall` at the three live-debate call sites (:3310, :3519, :3674).
*Acceptance: moderator `recall` returns similar trades; extend debateFlow tests.*

**D0.2 — Deliberate moderator tool policy.**
Default moderator toolset = `memory + context` (recall, session, btc, web_search);
data tools optional via config. One `resolveSeatTools(seat, stage, bot?)` helper
consumed by every `streamChatWithDeskTools` call site (also fixes the
clarification-round allowlist gap).

**D0.3 — Verdict evidence pack (proactive, not pull-only).**
Before the verdict call, assemble a compact block: top-3 similar closed trades,
matched skill index lines, cluster stats (Phase 1), doctrine header — injected
directly into the verdict context. The arbiter should not depend on remembering
to call `recall`.
*Acceptance: verdict prompt contains evidence pack when data exists; omitted
cleanly when empty.*

### Phase 1 — Evidence tribunal (2–3 days, P1)

**D1.1 — `get_setup_history_stats` desk tool.**
Pure SQL over the trade log: for coin+direction+family+regime cluster → sample n,
win rate, avg R, last outcome, worst lesson. Honest "no sample" when n < 3.
Register in `DESK_TOOL_DEFINITIONS` + label/digest entries + tests (mirror
`deskTools.test.ts`).

**D1.2 — Stats pack in verdict context.**
When the cluster has n ≥ 3, inject one line into the verdict evidence pack:
*"This desk is 2W/5L (−1.4R avg) on ETH-long liquidity-sweeps."* This converts
the Stress-Test Protocol from ritual to evidence.

**D1.3 — (Optional) `run_quick_backtest` tool.**
Wrap existing backtesting services behind a bounded tool (fixed bar window, hard
token cap on output). Defer if output budgeting gets messy — D1.1 covers 80 % of
the value.

### Phase 2 — Mechanism design upgrades (3–5 days, P1–P2)

**D2.1 — Numeric seat weighting.**
Extend `buildSeatTrustBlock` data into `buildAnalystConsensus`: citation weight
= f(Brier, High-gap) (e.g., calibrated 1.0, overconfident 0.7). Show weights in
the verdict transcript ("cited Macro (trust 0.9)"). Keep `enforceCitedVerdict`
unchanged — it's the hard floor.

**D2.2 — Conviction drift tracking.**
Request `CONVICTION:` every rebuttal round (not just final); moderator verdict
block shows drift lines: *"Macro 70→45 after Risk's funding point — the devil
round worked."* Persuasion becomes visible; devil-advocate effectiveness becomes
measurable (feeds D2.3).

**D2.3 — Debate protocol A/B lanes.**
Reuse the `promptVersionStats` lane pattern for protocol knobs: rounds count,
devil rotation on/off, clarification threshold (20), evidence-round on/off.
Track outcome (verdict direction vs resolved outcome) per lane; pin winners like
`maybePinWinningPromptLane` does.

**D2.4 — Divergence score v2.**
Add invalidation-level distance (normalized by ATR) and thesis-keyword overlap
to `analyzePreDebateDivergence`. Two Longs with stops 4 % apart should not be
"aligned" — that mis-routes clarification skipping.

### Phase 3 — Continuity (2–4 days, P2)

**D3.1 — `recall_chat` desk tool.** FTS over stored conversations/analyses
(SQLite FTS5 desktop / IndexedDB layer web). Seats + moderator can pull prior
desk calls on this symbol, including never-journaled ones.
**D3.2 — "Prior desk calls" block** in the verdict evidence pack (same data,
proactive).
**D3.3 — Post-debate capture.** Cheap-model pass after each analysis extracts
user corrections/pushback → staged notebook entries via the existing drafts
inbox. Next debate's loss-priming block gets fresher material.

### Phase 4 — Robustness polish (1–2 days, P2)

**D4.1** Rebuttal packets include the seat's own prior-round text (fixes W5).
**D4.2** Lopsided-floor guard: verdict emitted with < 2 active seats gets a
`partial floor` warning line in the plan + run log.
**D4.3** Per-seat token/cost attribution in `DebateRunEvent` (kind: 'cost').
**D4.4** Document (or converge) simulated-vs-real debate physics — at minimum a
docs note in PROMPTS.md that accuracy autoplay is a distinct format.

---

## Part 5 — Explicit non-goals

- Do **not** add round barriers to the rebuttal pump.
- Do **not** lengthen default debates (rounds stay 2 + verdict; shortcuts stay).
- Do **not** replace prose verdicts with JSON (plan parser contract is prose+labels).
- Do **not** make seat trust override the harness contract ladder (advisory →
  numeric weighting only; `enforceCitedVerdict` stays the hard floor).

## Part 6 — Suggested sequencing & success metrics

Order: **Phase 0 → D1.1/D1.2 → D2.1/D2.2 → D3 → rest.** Each phase ships behind
green `typecheck && test && build`.

Metrics to watch (from run events + journal):
- Verdict citation rate (should stay ~100 % via enforcement) & uncited-forced-Neutral count (should be ~0).
- Time-to-verdict and cost/debate (Phase 2 knobs should reduce both via smarter skips).
- Devil-round persuasion rate (D2.2) — if ~0, the rotation needs redesign.
- Calibration spread across seats (Brier) — should tighten as weighting lands.
- Recall/evidence-pack hit rate: % of verdicts whose cluster had n ≥ 3 history.
