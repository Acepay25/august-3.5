# August 3.5 — Harness Upgrade Plan

Date: 2026-08-29 (v2 — merged same day with two reviewed documents). Sources:
opengrok wire-layer deep dive (prior session) plus five research streams — Reddit
trader workflows; FinTwit/signal culture + trading psychology; a technique/pattern
catalog with evidence tiers; prop-firm risk rules + journaling-app field
inventories; and AI-trading-tools + multi-agent-debate + human-AI-trust literature.
v2 folds in (1) the companion six-phase "Debate Quality + Trader-Workflow" plan
(repo-native; every anchor re-verified) and (2) the "Self-Improvement Loops" draft
(Part 16 — written for a Python brain backend; ported to august's chassis, rulings
on its open questions included). Every file:line anchor below was verified in this
repo on 2026-08-29.
v3 (same day) adds two items drawn from reviewing how the ZCode agent harness
itself manages memory and skills: the harness-lessons store (§1.1 P7) and
index-layer memory injection (§4.7).

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

**Value bar (adopted from the Part 16 draft):** every phase must ship a countable
artifact — recurrence counts, judge precision on a hand-labeled sample, trigger-
rate deltas, or a shipped skill with provenance. Phases that cannot name their
number get cut at review.

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
  the six-phase learning-loop work).

### 1.1 Wire layer (opengrok roadmap — do first)
- **P1 reasoning control plane** — new `services/providers/reasoningControls.ts`
  translating per-provider reasoning knobs (xAI `reasoning_effort`, GLM
  `thinking.type` + literal "max" effort, DeepSeek `thinking` + `max_tokens` floor,
  Gemini effort slugs, Claude thinking shim): verified routes only, gap-fill,
  fail-closed no-ops, audit label per call. Today `reasoning_effort` is sent
  nowhere (verified: zero occurrences repo-wide).
- **P2 effort scheduling by role** — openings high; final conviction + moderator
  verdict max; clarification fast/thinking-off (thinking-default providers burn
  tokens on 60-word answers); devil seat max tier (weak devil = rubber-stamp
  grade). Thread effort through task budgets → ChatRequestOptions → body assembly.
- **P3 fix the Claude thinking gate** — `shouldRequestExtendedThinking`
  (GenericProviderService.ts:252) requires maxTokens ≥ 4096 but
  `TASK_BUDGETS.rebuttal` = 2560, so Claude seats never think during debate rounds
  (Anthropic only needs 1024 ≤ budget_tokens < max_tokens — 2560 works fine); the
  model-id regex also misses opus-5/sonnet-5 ids. Replace with a
  `thinkingCapable` ProviderConfig flag (toggle in ProviderManager); decouple the
  floor.
- **P4** persisted-error cooldown consulted at roster build
  (`buildEnsembleAnalysts`, EnsembleAnalystService.ts:77) and moderator fallback —
  `recordProviderSuccess`/`recordProviderError` already record
  (ProviderHealthService.ts:32,43) but are read by nothing; ≥3 persisted errors in
  15 min → 10-min cooldown, cleared on success (opengrok F11: cooldown only after
  PERSISTED errors — transient retries don't count).
- **P5** applied-wire audit label per call into runStats, surfaced in DebateRunLog.
- **P6** known-answer probe per provider + wire-shape assertions in debateFlow
  tests (200-accepted ≠ honored — behavior-prove every knob).
- **P7 harness-lessons store** (new in v3 — the ZCode self-improvement pattern
  applied to the harness's own knobs). Trading-skill memory already exists; what
  has NO home is lessons about *harness/model behavior*: "seat fabricated a
  funding number," "thinking-default models burn tokens on 60-word
  clarifications," "provider X 200-accepts but ignores reasoning_effort," "seat
  regurgitates veto text as if it were its own reasoning." Small typed store
  (`services/learning/harnessLessons.ts`, same file-backed chassis as skills)
  with fields {kind: fabrication|wire|injection|budget, scope, provider?,
  pattern, lesson, evidenceId} — written by P5's audit labels, P6's probes, and
  the §4.6 episode extractor, read by roster build, reasoningControls, and the
  snapshot assembler (e.g. a wire lesson can pin a provider to thinking-off
  until re-probed). Scoping rule (user correction, 2026-08-29): ANY model can
  run on this harness — the roster is fully user-configured — so lessons key on
  CAPABILITY CLASSES (`thinkingDefault`, wire format, jsonMode, vision), never
  on provider identity; the provider id is evidence provenance only. A
  provider-narrow lesson ("GLM thinks by default") would silently fail to cover
  the next thinking-default model, repeating the hardcoded-constant mistake
  the provider migration already removed. Class is the scope, provider is the
  footnote. This is the memory layer that makes P1-P6 itself self-improving
  instead of a one-time fix. Cheap, ships with Batch 1.

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
- **g) Disagree-or-Commit protocol (FinCom).** In `DEBATE_RESPONSE_PROMPT`
  (debatePrompts.ts:341): for EACH peer's current position the seat emits exactly
  one line — `COMMIT: <seat> — <why>` or `DISSENT: <seat> — <why>` — as the
  mandatory skeleton (steelman rule stays; free-form concede/challenge prose
  becomes optional color). The moderator verdict prompt gains a COMMIT/DISSENT
  matrix requirement: the verdict must state which dissents it overruled and why.
  Parse the markers into turn metadata for future stats. Prompt-only fix for
  premature consensus — naive multi-agent consensus breeds agent conformity;
  FinCom's disagree-or-commit beats it.

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

## 3. Risk guardrails, sizing & session state

**Already exists (verified — build on, don't rebuild):** position sizing off
equity/risk% and the Entry→SL distance (`utils/harnessSettings.ts` settings,
`computeContractSize` utils/ticketSize.ts:50, rendered on the signal card at
TradingSignalCard.tsx:201 and injected at useAnalysisPipeline.ts:1752) and
liquidation-buffer math (`computeLiquidationBuffer` ticketSize.ts:99, rendered
TradingSignalCard.tsx:205). What's missing is the tiering, the advisory layer, and
the session-state machinery.

- a) **Grade-tiered risk + Kelly advisory** (layered onto existing sizing): the
  moderator's grade scales riskPercent — A → 1%, B → 0.5%, C/D → no-trade guidance
  (practiced by a verified trader at 1/2/3% capped at 2%; prop norm 0.25-1%); Kelly
  advisory (W − (1−W)/R from journaled history) shown at quarter/half Kelly with a
  noisy-edge warning. Deterministic — the app computes, the card displays.
- b) **SessionGuardService** — new `services/validation/SessionGuardService.ts`,
  pure functions over `LoggedTrade[]` (read from the profile `tradeLog`,
  StorageService.ts:149): realized+unrealized day P&L (UTC), trades opened today,
  current loss streak → verdicts {dailyLossHit, tradeCapHit, streakPauseActive,
  cooldownActive(until), warnings}. Deterministic, no LLM.
  Defaults (research-tight end; all configurable — the looser FTMO set 3%/3
  trades/60 min is the config alternative): daily-loss limit 2% (Topstep 2%
  auto-flatten; "over 63% of traders have lost an account in a single day"), max 2
  trades/day (one win = done; one loss = one attempt then done — the recurring prop
  pattern), streak pause at 2 losses, post-loss cooldown 4h (cortisol clears
  ~90 min; 73% of one auditor's losses came after the first red trade of the day).
  Breaker behavior: warn at 50% of the daily cap, hard interstitial at 80%,
  stand-down at 100% until next UTC day. Cap changes require typed confirm and
  take effect next session — removable limits "make it easier to rationalize bad
  habits in the moment" (Topstep's own doc). Advisory app, not a broker:
  warn-first, never hard-block, explicit "I understand, continue anyway" override.
- c) **Guard surfaces**: rose `status-surface` banner above the composer
  (ChatArea) when any guard is active; trade-count chip near the log-trade action;
  guard state injected into the debate context block (alongside the existing
  loss-priming rows, ensembleService.ts:2836) so the moderator can weigh "trader is
  at the daily-loss limit" when grading.
- d) **Drawdown floor on the equity curve** — static (initial −10%) or trailing
  (high-water mark −10%, ratchets, locks at start balance — Topstep MLL mechanics)
  + best-day consistency ratio (best day ÷ total profit, warn > 50%).
- e) **Stop-discipline flag** — any stop moved away from the profit direction is
  flagged in the journal as a rule break (stops only move toward target).
- f) **Leverage guard** — prominent ticket-sheet warning when the liquidation
  buffer is < 1.5× the stop distance at chosen leverage (uses the existing
  `computeLiquidationBuffer`; liquidation-before-stop is crypto's #1 account
  killer per the research).
- g) **Pre-debate intake interstitial** — trades today, day P&L vs limits, state
  self-rating, pending events, before the floor convenes; the floor may refuse to
  run (a NO SESSION outcome, sibling of NO TRADE).

## 4. Journal, review loop & self-improvement

### 4.1 LoggedTrade fields (types/trade.ts — all optional; JSON profile storage,
no migration)
- `mistakeTags?: ('failed_thesis'|'boredom'|'overtrading'|'greed'|'revenge'|
  'moved_stop'|'early_entry'|'late_exit')[]`
- `emotionalState?: 'calm'|'confident'|'anxious'|'frustrated'|'tilted'|'fomo'`
- `followedPlan?: boolean`, `planDeviationNote?: string`
- `rMultiple?: number` — computed at log time from entry/SL/pnl (deterministic util)
- `convictionAtEntry` (pairs with the sealed auction for user-Brier tracking);
  `plannedVsActualSize`; `stageAdherence` graded per stage (entry/management/exit —
  Edgewonk computes adherence % by stage); `correlationNote`
- `checklistCompleted` (from 4.3)
- **MFE** (`maxFavorableExcursion` — MAE exists at types/trade.ts:94) + capture
  efficiency (P&L ÷ MFE) + exit efficiency (P&L ÷ best-exit P&L)
- **Missed trades**: SKIPPED outcome exists — add a reason field ("watched, chose
  not to") so passes become data.

### 4.2 Quick-tag UI
Chips in UpdateTradeModal + a one-tap tag sheet right after outcome capture
(useTradeLogging outcome path). Everything optional, ≤3 taps, monochrome chips.
Pre-trade 3-level state self-rating rides the intake interstitial (3g).

### 4.3 Pre-trade checklist (off by default)
Editable checklist (FTMO-derived defaults: mental state, high-impact news checked,
SL/TP defined, size computed, invalidation known) attached to the verdict card's
log-trade path; completion stored on the trade (`checklistCompleted`) and feeds
adherence stats. Toggle in the settings journal tab.

### 4.4 Analytics the research says changed behavior
Panels in PerformanceReview/WinRateDashboard (client-side over `trades`, matching
the existing dashboard pattern):
- **Adherence split** — rule-followed vs rule-broken trades: win rate, profit
  factor, avg R each (the Edgewonk flagship insight).
- **Mistake-cost table** — Σ PnL per tag; "most expensive mistake this month".
- Emotion × outcome breakdown; expectancy (avg R) per setup and per emotion tag.
- Win rate by hour/session and setup grade; performance after the first red trade;
  giveback (green days that finished red).
Extends DashboardStats, doesn't replace it.

### 4.5 Review cadence
- **WeeklyReviewService** (`services/learning/`): deterministic week-stats assembly
  (adherence split, mistake cost, per-family stats, R distribution, calibration
  delta vs last week) + ONE moderator-provider call synthesizing exactly one
  improvement impulse (Edgewonk cadence — one impulse, not a lecture). Trigger via
  JobQueueService at app start when ≥7 days since last digest AND ≥3 closed trades
  since (SkillEvalScheduler's due-check + cooldown + budget pattern). Rendered as
  a Journal card; stored in preferences.
- **Monthly report card** — what happened / learned / needs attention; adherence %;
  biggest mistake; best trade — plus the **grade-the-panel section**: per-provider
  and ensemble-line Brier for the period (which seats were actually right).

### 4.6 Self-improvement loop (Part 16 port — failure mining → skill/memory
distillation)

The reviewed Part 16 draft is well-designed but targets a different architecture
(`backend-py/app/services/brain/`, `uv`, a skills hub with pill tabs, a `remember`
door — none exist here). The core design ports intact: **episodes, not
conversations; tier-1 free heuristics over everything + tier-2 LLM judge on flagged
episodes only (≤5%); normalized failure fingerprints that dedupe, count recurrence,
and prove whether a shipped skill actually worked; three distill actions classified
before drafting; improve-first; everything human-gated with provenance.**

Scope discipline (the strong version of the concept): **outcome-linked episodes,
not raw conversations.** Raw conversation review mines fluency — the judge rewards
well-argued text, not correct text. Episodes must resolve against ground truth:
closed-trade post-mortems (TP-vs-SL), skill-eval streaks, preflight NO CLAIM seats,
veto misfires, user corrections. A general assistant persists lessons because
someone judged them useful; august can persist them because price resolved. The
outcome gate IS the safety story — a trading harness can and should run a stricter
loop than a general one.

August's episode substrate (different sources, same shape):
- closed-trade post-mortems with `rootCauseClass` (types/trade.ts:34) — the
  failure+recovery window
- debate-run events: preflight NO CLAIM seats, veto misfires, grade-vs-outcome
  misses, ensemble-line vs moderator divergence (from 1.2d)
- skill-eval verdicts (SkillEvalService hurts/helps streaks)
- user corrections: trade-level edits (corrected levels exist on LoggedTrade),
  manual grade overrides

Port map (draft concept → august chassis; all anchors verified):
- **Tier-0 extractor** → post-hoc, read-only pass over tradeLog + DebateRunLog
  events + eval records. No runtime behavior change; the debate loop never waits
  on it.
- **Tier-1 scoring + fingerprints** → extend MistakePatternService
  (`detectRecurringMistakes` :115 is already recurrence-shaped): fingerprint =
  normalized failure class + key entity with paths/ids/numbers stripped (e.g.
  `stop-in-cluster:btc-london`, `overcalibrated-grade-b:asia`);
  `rootCauseClass` feeds cause-stability (stable = mineable; a one-off timeout
  teaches nothing). Unclassifiables bucket as `unknown:<first-line>` for manual
  class assignment.
- **Three distill actions** → (1) no skill covers it → create draft via
  `craftSkillFromPostMortem` (SkillCraftService.ts:51) with provenance = episode
  ids; (2) skill exists but didn't trigger → amend-trigger (description diff —
  trigger reliability, not body); (3) skill triggered but was wrong → amend-body
  (Pitfalls-only until the precision record exists — ruling below). Below the
  generalizability threshold → memory fact through the existing global-memory /
  settled-beliefs path (source-tagged `distilled:<fingerprint>`).
- **Improve-first** — amendments ship before creations; a diff proposal forces the
  approval UI + versioning to exist first.
- **Human gate** → the existing approval-inbox chassis (`utils/approvalInbox`
  ApprovalItem/AutoJournalPolicy, rendered by ApprovalInbox.tsx) + a Learning
  section inside the existing SkillsGrid (components/settings/SkillsGrid.tsx) — no
  new top-level IA. Draft cards: type badge, unified diff, provenance chips
  (session count, first-seen, occurrences), Approve / Edit / Reject.
- **Versioning & rollback** → SkillMeta `history`/`previousVersion` already parsed
  (SkillMemoryService.ts:177, :263) + VersionHistoryDashboard; prior versions
  retained as rows, rollback = restore.
- **Pruning** → a skill with zero recorded evidence AND zero injection hits in 30
  days surfaces a demote SUGGESTION in the same queue (never auto — suggestion
  coexists with the existing eval-based demotion `EVAL_DEMOTE_STREAK` = 2, adding
  the usage axis evals can't see). Demoted = excluded from injection, one-click
  restore. (August has no injection leak — `enabledSkillMeta` filters
  `file.enabled` (SkillMemoryService.ts:452) and retired status drops out of
  ranking; the draft's "disabled skills still injected" prerequisite is a
  cross-repo bug, not one here.)
- **Measurement loop** → the fingerprint row gains `skill_link` +
  `recurrence_after_install`; zero recurrence in 30 days = resolved + skill
  credited; recurrence auto-drafts a revision proposal into the same queue
  ("skill X did not prevent recurrence of Y — amend or retire"), extending
  `refineSkillFromLosses` (SkillCraftService.ts:111). Metrics surface in the
  Learning section header: drafts generated, approval rate, fingerprints
  open/resolved/recurred, judge token cost, demotions — the numbers the whole
  feature is accountable to.
- **Anti-drift (hard rules)** → judge input contains approved skills' titles +
  descriptions only (not bodies — cost), never its own pending/rejected drafts;
  one draft per (fingerprint, action, target), deduped before queueing; judge runs
  offline (never inside a live turn, never a debate seat); flag rule = correction
  count ≥ 2 OR (human-corrected/uncorrected AND stable cause) OR a fingerprint's
  second occurrence; flag ratio logged and held ≤ 5%.

Sequence (each independently shippable): **A** extractor + episode records →
**B** fingerprints + tier-1 scoring → **C** judge + distiller, gated by precision
≥ 0.8 on ≥ 30 hand-labeled episodes (record the number) → **D** review queue +
Learning UI + pruning → **E** measurement loop + one end-to-end seeded test
(inject a known failure → fingerprint → flagged → draft → approve → simulate
recurrence → revision proposal appears).

**Rulings on the draft's six open questions:**
1. Ship default **extract-only** (mine episodes, no judge) until the precision
   gate is met; `full` after burn-in.
2. Drafts amending human-authored skills: **Pitfalls-only additions** until judge
   precision ≥ 0.8 on ≥ 30 hand-labeled episodes is recorded; body rewrites after.
3. Mining solo/efficient-lane runs post-hoc: **yes** (the draft's sub-agent
   analog — offline, read-only, no runtime door opens).
4. Judge model: **dedicated config** (`skillLearningJudgeModel`) defaulting to the
   app's default provider — never a live seat, never inside a debate.
5. Demotion after zero hits: **suggestion-only — confirmed** (the existing
   eval-streak machinery stays the only automatic demotion path).
6. Episode retention: **180 days** default, configurable (fingerprints keep
   counts, not transcripts — disk stays flat).

### 4.7 Index-layer memory injection (new in v3 — the ZCode memory pattern)

August currently injects the whole GlobalMemory JSON into every seat's prompt. The
agent-harness pattern that scales better: a **tiny always-loaded index + full
content fetched on demand**. ZCode loads a one-line-per-memory index every session
and reads full files only when relevant; august's equivalent of the fetch path is
already built — the desk tools (`recall`, `recall_chat`) are exactly an on-demand
memory fetch. The change is snapshot-side: inject a compact index (skill titles +
one-line summaries + status), and let seats pull detail via the recall tool when a
setup actually matches. Tokens saved scale with library size; salience goes UP
because each seat sees a menu, not a wall.

Migration constraint (from the six-phase review): `familyPerformance` rides inside
the verbatim GlobalMemory injection and is genuinely read by the model — it must
stay injected (or move to a compact computed-stats block), not silently drop.
Snapshot-cap discipline (§2) applies: the index replaces bulk body text, so the
~2400-char cap stays meaningful.

Trade-off to note: a seat that never calls recall sees only summaries. That is
acceptable — today's wall-of-JSON has the same failure mode with none of the token
savings — but the enforceCitedVerdict must-quote rule should extend naturally:
citing a skill in the verdict implies its detail was pulled.

## 5. Human command & trust surface

- a) **Pre-read capture (cognitive forcing, opt-in training mode)** — before the
  verdict card reveals, the user commits direction + confidence (stored as
  userPriorCall on the message); reveal; log the delta. Journal stats then show
  user-prior vs verdict vs outcome — measures the user's own calibration and
  over-reliance (algorithm appreciation is the live risk; human-Brier vs
  ensemble-Brier is the strongest anti-automation-bias display available).
  Off by default — the friction can hurt satisfaction.
- b) **Signal card completeness checklist** (render, not just prompt-enforce):
  entry zone, invalidation at signal time (74% of real signal-group calls had no
  stop), TP1/2/3 + probabilities, R:R, timeframe, session context. Version-stamp the
  published plan; later adjustments are explicit amendments, never overwrites (61%
  of signal-group targets were silently edited).
- c) **Frequency-format uncertainty** — "68% conviction — of the last N signals in
  the 60-70% band, 62% hit TP before SL" from ConfidenceCalibrationService
  (services/validation — already computes granular calibration; surface it in this
  format). Frequency beats raw probability for calibrated reliance (Cao et al.);
  only show genuinely backtested bands (Gaertig & Simmons: intervals increase
  advice-weighting — an overconfident range is worse than a point number).
- d) **Show the dissent** — conviction spread + which lens dissents (spread readout
  already in DebateSummary) + the ensemble line vs moderator grade when they
  diverge. Dispersion keeps the display non-directive, which preserves accuracy
  under imperfect reliability.
- e) **Process-over-outcome framing** — a trade is a winner if the rules were
  followed (SMB's definition); the digest leads with adherence, not P&L.
- f) **Calibration ledger dashboard** — predicted vs realized hit rate by grade
  (A-F) and confidence band, per-seat/provider calibration, Brier score,
  plain-language framing ("when the verdict says 70%+, it hits X% of the time over
  N trades"). Data already computed — aggregation + UI only. No consumer journaling
  tool offers this; it is the market gap.
- g) **Copy pass** — audit verdict/share text for deterministic claims ("will",
  "guaranteed"); "analysis, not financial advice" framing (SEC AI-washing
  precedent). Prompt-side ban is 1.2f; this is the rendered-side sweep.

## 5.5 Crypto context (small)

- **Funding carry-cost line** on the signal card relative to verdict direction
  ("holding this short pays ~0.01%/8h") + funding added to the debate market-
  snapshot block. (The fetch and panel display already exist —
  MarketDataService.getFundingRate :547, HybridDataPanel.tsx:551 with sentiment
  coloring — what's missing is verdict-relative framing and debate visibility.)
- **Quiet hours** — AlertManager gains a configurable silent window (sleep
  protection for a 24/7 market; no quiet/silent support exists today, verified);
  alerts during the window queue instead of notifying.

## 6. What NOT to build
- Auto-execution / order placement (Alpha Illusion + trust research: the human
  stays in command).
- Exchange/broker auto-sync of trades — no exchange API keys in the app; outcome
  autopilot stays the capture path.
- Economic-calendar data feed — external source dependency; the checklist item
  covers news discipline for now.
- Ornate candlestick-pattern recognition or MA-crossover signal generation.
- CME-gap detector (CME BTC futures went 24/7 in 2026 — the phenomenon is ending).
- Opaque one-number trust scores (Zella-Score style) — component metrics +
  calibration curves instead.
- Marketing-number surfaces ("+241%, 70-80% win rate" is the Tickeron anti-pattern);
  always N + window + drawdown.
- No imported extremization constants — fit alpha on this app's realized data.

## 7. Implementation batches (each gated: typecheck + tests + build; one plain
commit per batch)

1. **Wire layer** (P1-P7) — reasoningControls.ts, effort schedule, Claude gate
   fix, persisted-error cooldown, runStats wire audit, harness-lessons store;
   debateFlow wire-shape assertions. Smallest, highest signal-quality leverage
   per token — and P7 makes it self-improving rather than a one-time fix.
2. **Risk + sizing** — SessionGuardService + banner/chip/debate-context surfaces,
   grade-tiered risk + Kelly advisory layered on existing sizing, leverage guard,
   breaker/caps/streak/cooldown, pre-debate intake interstitial. Tests:
   sessionGuard (UTC midnight boundary, streak counting, override semantics),
   ticket-math extensions.
3. **Detectors + snapshot** — FVG/OB/equal-levels/premium-discount/DOL/CVD/measured-
   move + seasonality flags + stop-vs-ATR checks; snapshot restructure + cap bump;
   unit tests on synthetic klines.
4. **Debate science** — context-match round + NO TRADE verdict, seat anonymization +
   homogeneous-roster warning, targeted devil, Disagree-or-Commit markers, ensemble
   line + dual-Brier tracking, vocabulary ban, family checklists wired to detectors
   via the preflight gate.
5. **Journal + review loop + memory index** — new LoggedTrade fields + quick-tag
   UI + pre-trade checklist, MFE/capture/exit-efficiency, adherence + mistake-cost
   + time-of-day + post-red + giveback analytics, WeeklyReviewService + monthly
   report card + grade-the-panel, pre-read capture flow, §4.7 index-layer memory
   injection (compact skill index + recall-tool fetch; familyPerformance stays
   injected).
6. **Self-improvement loop** (Part 16 port, A→E above) — extractor → fingerprints →
   judge (precision-gated) → Learning queue/UI + pruning → measurement loop.
   Depends only on 4's ensemble-line stats for one episode type; can start its
   Phase A in parallel with any batch.
7. **Crypto context + trust surface** — funding carry-cost + debate snapshot line,
   quiet hours, calibration ledger dashboard, rendered-copy pass, version-stamped
   signal cards.

Rough sizes: 1 small-medium; 2-3 medium; 4 medium-large; 5 large (index-layer
injection adds a medium sub-task); 6 medium-large; 7 small-medium. Order: 1 first
(cheapest, sharpens every downstream round); 2 and 7 next in either order; 6 can
proceed from its Phase A alongside anything.
