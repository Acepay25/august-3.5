# August 3.5 — Harness Upgrade Plan

Date: 2026-08-29. Sources: opengrok wire-layer deep dive (prior session) plus five
research streams — Reddit trader workflows; FinTwit/signal culture + trading
psychology; a technique/pattern catalog with evidence tiers; prop-firm risk rules +
journaling-app field inventories; and AI-trading-tools + multi-agent-debate +
human-AI-trust literature. Every load-bearing claim about this repo was re-verified
in code (file:line anchors inline). Research reports with full source URLs live in
the session that produced this plan.

---

## 0. Algorithm or skills? — both, with a hard rule

**Deterministic algorithms own everything numeric; LLM skills own judgment.**

- Math and measurement — detectors, position sizing, circuit breakers, conviction
  aggregation, calibration, metrics — must be app-side code: testable, no
  hallucination, no drift. The MAD literature is blunt that reasoning-shaped text is
  persuasive regardless of validity (even vacuous reasoning produces 20-39% error
  adoption; strict conformity is 57-77% correct-to-wrong). Numbers the floor argues
  over must never be model-generated.
- Evidence weighing — the debate itself, stop-type arguments, playbook matching,
  digest narrative — stays prompt-side, but must cite the computed facts. The
  existing `enforceCitedVerdict` must-quote rule generalizes to this.
- The chassis already exists: desk tools (`get_session_context`,
  `get_derivatives`, `get_order_book`, `recall`, `get_setup_history_stats`) and the
  hybrid snapshot. Extend those; never ask models for data in free-form prompts.

This matches what the technique evidence supports: every family that survives
contact with data does so via confluence + regime + timing filters — computed
inputs — not raw pattern narratives.

## 1. Debate engine — how the floor reaches a high-grade signal

### Already right (verified in code, backed by research — keep)
- Sealed conviction auction: seats never see each other's numbers, moderator sees
  all (`buildConvictionAuctionBlock`, ensembleService.ts:2534). Directly matches the
  anti-conformity findings — post-debate positions are contaminated by sycophancy.
- 2 rebuttal rounds (3 on `extended`) — inside the research's 3-4 round sweet spot.
- Cross-provider seats by default in lens mode — diverse model families beat
  self-ensembling (Diversity of Thought: diverse trio 91% vs one-model×3 82%).
- Devil's-advocate rotation, steelman-before-defense, trigram echo detection,
  bounded compaction, moderator retry on same config.
- Preflight DATA/SOURCE/FALSIFICATION gate + provider-fitness demotion (shipped in
  the six-phase work).

### 1.1 Wire layer (opengrok roadmap — do first)
- **P1 reasoning control plane** — new `services/providers/reasoningControls.ts`
  translating per-provider reasoning knobs (xAI `reasoning_effort`, GLM
  `thinking.type` + literal "max" effort, DeepSeek `thinking` + `max_tokens` floor,
  Gemini effort slugs, Claude thinking shim): verified routes only, gap-fill,
  fail-closed no-ops, audit label per call. Today `reasoning_effort` is sent
  nowhere (verified: zero occurrences repo-wide).
- **P2 effort scheduling by role** — openings high; final conviction + moderator
  verdict max; clarification fast/thinking-off; devil seat +1 tier.
- **P3 fix the Claude thinking gate** — `shouldRequestExtendedThinking`
  (GenericProviderService.ts:252) requires maxTokens ≥ 4096 but
  `TASK_BUDGETS.rebuttal` = 2560, so Claude seats never think during debate rounds;
  the model-id regex also misses opus-5/sonnet-5 ids. Replace with a
  `thinkingCapable` ProviderConfig flag; decouple the floor.
- **P4** persisted-error cooldown consulted at roster build
  (recordProviderSuccess/Error already recorded, unread). **P5** applied-wire
  audit label in runStats/evidence pack. **P6** known-answer probe per provider +
  wire-shape assertions in debateFlow tests.

### 1.2 Structure changes
- **a) Context-match first.** The debate's first exchange settles regime
  (trend/range/chop — detection exists), session window (`isKillZone` /
  `killZoneType` from SessionService.ts:304), and pending-event context — and "NO
  TRADE today" is a first-class outcome, not a failure. Traders explicitly skip
  even A+ setups when context mismatches the playbook ("days no trades is better
  than losing days").
- **b) Anonymize model identity seat-to-seat.** Strip provider names from
  seat-facing transcripts; keep lens identities (Technical/Macro/Risk). Identity
  sycophancy/self-bias is measured (arxiv 2510.07517); lens identity is the useful
  structure, model identity is the bias channel. UI keeps real names — only prompt
  text changes. Also warn (not block) when the same provider+model occupies
  multiple seats — EnsembleAnalystService.ts:148 permits it, and homogeneous floors
  lose to isolated self-correction.
- **c) Targeted devil.** The red-team question must name specific claims: the entry
  trigger, the invalidation level, hidden correlation ("four 1%-risk positions
  sharing a dollar leg are one 4% bet"), stop-in-retail-cluster, gap/liquidation
  risk beyond the stated stop, regime mismatch, "is this entry to make back a
  loss?". Free-form "challenge the floor" degenerates into sycophancy.
- **d) Deterministic ensemble line.** Alongside the moderator's verdict, compute a
  fitness-weighted log-odds mean of the sealed convictions (weights from
  calibration/Brier data), extremized with alpha fitted on realized outcomes;
  start alpha = 1 (plain log-odds mean) until N ≥ 50 graded signals per band.
  Never overrides the moderator; both lines' Brier scores tracked in the digest.
  Theory: plain averaging is dragged toward 50% (Baron/Tetlock/Satopää); Alpha
  Illusion warns "language confidence is not tradable probability" — so the line
  is scored, not trusted.
- **e) Stop taxonomy as an explicit axis.** Three named placements — structure
  stop, ATR stop (floor ≥ 1-1.5x ATR distance; ATR is already in the snapshot),
  invalidation-logic stop ("body close beyond the sweep extreme invalidates; wicks
  do not" — matches the existing sweep detector's semantics at
  HybridIntelligenceService.ts:592). App computes each seat's proposed stop vs the
  ATR floor and flags violations into the debate (deterministic check, model
  argues).
- **f) Vocabulary ban.** No "urgent/easy/guaranteed" in any model output
  (urgency-framed calls averaged -0.42R vs +0.07R in the 112-signal study;
  Steenbarger flags "easy" as a tell). Keep the existing grade-conditional caps
  (debatePrompts.ts:144).

### 1.3 Setup-family checklists (the skills side)
Decompose Family A/B/C/Omega into named, falsifiable checklist steps — e.g. sweep →
displacement → array entry (FVG/OB/OTE) → 2R minimum to the first draw — each step
citing a computed detector output, enforced by the existing preflight gate. Wyckoff's
ninth buying test demanded 3R theoretical; encode a per-family minimum-R instead of
the flat 1.2 floor.

## 2. Technique & data layer (deterministic detectors)

Already present (verified): liquidity-sweep detection (wick-beyond + close-back —
exactly the ICT body-close rule), session/killzone context, funding/OI/liquidation
desk tools, VWAP, fibs, Ichimoku, pivots, ADX, regime, divergences, psychological
levels, ATR.

New detectors — all feed the hybrid snapshot (raise the 1800-char
`centralizedSnapshot` cap, useAnalysisPipeline.ts:2561, to ~2400 with denser
formatting):
- a) **Equal highs/lows** — feed them as sweep levels (buy-side liquidity rests
  above equal highs).
- b) **FVG/imbalance** — 3-candle gap, BISI/SIBI direction, CE midpoint for limit
  entries; label the caveat "60%+ of 30m FVGs go unmitigated same-session (Edgeful)
  — S/R, not a magnet".
- c) **Order blocks** — last opposite candle before a displacement leg (needs a
  displacement metric: range > k×ATR with directional close) + breaker flip on
  failure.
- d) **Premium/discount** — dealing-range midpoint (equilibrium) + which side price
  is on; rule: don't buy premium / sell discount against bias.
- e) **Draw on liquidity** — nearest untested PDH/PDL/PWH/PWL + weekly open; name
  T1 (internal) and T2 (external) so target logic defaults to partial-at-first-pool,
  runner-to-second.
- f) **CVD** — extend fetchOHLCV to request taker-buy volume (Binance kline field
  9; the `Kline` type at types/message.ts:32 lacks it) → session CVD + divergence
  flags (price new high, CVD not). Funding/OI already arrive via desk tools.
- g) **Measured move / AB=CD projection + range-width (Wyckoff cause)** as
  target-math cross-checks — target logic is the weakest link in retail setups and
  a deterministic one.
- h) **Seasonality flags** in session context — Monday-Asia-open favorable window
  (Sun ~7pm ET +24h, the best-evidenced timing finding, Concretum), weekend-chop
  warning, pre-open caution.

Deprioritize (evidence says weak): ornate multi-candle patterns (Bulkowski's stats
are direction-tendencies, not tradable win rates; absent from practitioner
playbooks), MA-crossover signals, trendline-only strategies, precise fib numerology.

## 3. Risk guardrails & position sizing (biggest user-visible gap)

- a) **Position sizing calculator** — equity + risk% → risk dollars; size = risk$ ÷
  stop distance; leverage sanity check. Grade-tiered defaults from the moderator's
  grade: A 1%, B 0.5%, C/D → no-trade guidance (practiced by a verified trader at
  1/2/3% capped at 2%; prop norm 0.25-1%). Kelly advisory (W − (1−W)/R from journaled
  history) shown at quarter/half Kelly with a noisy-edge warning.
- b) **Daily-loss circuit breaker** — realized + unrealized day P&L vs cap (default
  2%; FTMO 3%, Topstep 2% auto-flatten; "over 63% of traders have lost account in a
  single day"): warn at 50%, hard interstitial at 80%, stand-down verdict at 100%
  until next UTC day. Cap changes require typed confirm and take effect next
  session — removable limits "make it easier to rationalize bad habits in the
  moment" (Topstep's own doc).
- c) **Max trades/day** (default 2; one win = done, one loss = one attempt then
  done — the recurring prop pattern) + **post-loss cooldown** (default 4h no-charts;
  cortisol clears ~90 min; 73% of one auditor's losses came after the first red
  trade of the day).
- d) **Drawdown floor on the equity curve** — static (initial −10%) or trailing
  (high-water mark −10%, ratchets up, locks at start balance — Topstep MLL
  mechanics) + best-day consistency ratio (best day ÷ total profit, warn > 50%).
- e) **Stop-discipline flag** — any stop moved away from the profit direction is
  flagged in the journal as a rule break (stops only move toward target).

## 4. Journal & learning loop

- a) **New LoggedTrade fields** (types/trade.ts — verified absent): pre-trade
  3-level state self-rating; behavior tags (FOMO/revenge/forced/boredom);
  conviction-at-entry (pairs with the sealed auction for user-Brier tracking);
  planned-vs-actual size; adherence graded per stage (entry/management/exit —
  Edgewonk computes adherence % by stage); correlation note.
- b) **MFE** (maxFavorableExcursion — MAE exists at types/trade.ts:94) + capture
  efficiency (P&L ÷ MFE) + exit efficiency (P&L ÷ best-exit P&L).
- c) **Analytics the research says changed behavior**: win rate by hour/session and
  setup grade; performance after the first red trade; giveback (green days that
  finished red); expectancy per setup and per emotion tag. Extends DashboardStats,
  doesn't replace it.
- d) **Review cadence**: weekly Monday digest + monthly report card (what happened /
  learned / needs attention; adherence %; biggest mistake; best trade) including a
  **grade-the-panel section** (per-provider + ensemble-line Brier for the period).
  Distinct from the existing weeklyRollup (learning-memory consolidation).
- e) **Missed trades**: SKIPPED outcome exists — add a reason field ("watched,
  chose not to") so passes become data.

## 5. Human command & trust surface

- a) **Pre-read capture** — before the verdict reveals, record the user's own
  direction + conviction; reveal; log the delta. Algorithm appreciation (over-
  weighting machine advice) is the live risk for a sophisticated user; human-Brier
  vs ensemble-Brier is the strongest anti-automation-bias display available.
- b) **Signal card completeness checklist** (render, not just prompt-enforce):
  entry zone, invalidation at signal time (74% of real signal-group calls had no
  stop), TP1/2/3 + probabilities, R:R, timeframe, session context. Version-stamp the
  published plan; later adjustments are explicit amendments, never overwrites (61%
  of signal-group targets were silently edited).
- c) **Frequency-format uncertainty** — "68% conviction — of the last N signals in
  the 60-70% band, 62% hit TP before SL" from ConfidenceCalibrationService (already
  computes granular calibration — surface it in this format). Frequency beats raw
  probability for calibrated reliance (Cao et al.); only show genuinely backtested
  bands (Gaertig & Simmons: intervals increase advice-weighting — an overconfident
  range is worse than a point number).
- d) **Show the dissent** — conviction spread + which lens dissents (spread readout
  already in DebateSummary) + the ensemble line vs moderator grade when they diverge.
  Dispersion keeps the display non-directive, which preserves accuracy under
  imperfect reliability.
- e) **Process-over-outcome framing** — a trade is a winner if the rules were
  followed (SMB's definition); the digest leads with adherence, not P&L.

## 6. What NOT to build
- Auto-execution / order placement (Alpha Illusion + trust research: the human
  stays in command).
- Ornate candlestick-pattern recognition or MA-crossover signal generation.
- CME-gap detector (CME BTC futures went 24/7 in 2026 — the phenomenon is ending).
- Opaque one-number trust scores (Zella-Score style) — component metrics +
  calibration curves instead.
- Marketing-number surfaces ("+241%, 70-80% win rate" is the Tickeron anti-pattern);
  always N + window + drawdown.
- No imported extremization constants — fit alpha on this app's realized data.

## 7. Implementation batches (each gated: typecheck + tests + build)

1. **Wire layer** (P1-P3 + audit) — reasoningControls.ts, effort schedule, Claude gate
   fix, runStats wire audit; debateFlow wire-shape assertions. Smallest, highest
   signal-quality leverage per token.
2. **Risk guardrails + sizing** — equity/risk settings, sizing calculator on the
   signal card, daily breaker + stand-down, trade cap, cooldown, stop/correlation
   flags, pre-debate intake interstitial.
3. **Detectors + snapshot** — FVG/OB/equal-levels/premium-discount/DOL/CVD/measured-
   move + seasonality flags + stop-vs-ATR checks; snapshot restructure + cap bump;
   unit tests on synthetic klines.
4. **Debate science** — context-match round + NO TRADE verdict, seat anonymization +
   homogeneous-roster warning, targeted devil, ensemble line + dual-Brier tracking,
   vocabulary ban, family checklists wired to detectors via the preflight gate.
5. **Journal + digests** — new fields + MFE/capture/exit-efficiency, time-of-day +
   post-red + giveback analytics, Monday digest + monthly report card + panel
   grading, pre-read capture flow.

Rough sizes: 1 small-medium; 2-3 medium; 4 medium-large; 5 large.
