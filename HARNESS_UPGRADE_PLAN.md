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
v4 (2026-08-30) adds the memory/skill lifecycle hardening addendum (§8 —
store unification, evidence quality, retirement/graveyard, long-run loop
honesty), the debate-flow addendum (§9 — a structured seat tier above 5,
ProviderHealth read-side wiring), the chat/floor UI addendum (§10), and a
do-first dead-code cleanup batch (§8.0) whose candidates were verified by
runtime call-path trace on 2026-08-30. The full 2026-08-30 recommendation
memo is preserved verbatim as §12 (appendix); §§8-10 subsume it with
verified anchors, record shapes, wiring, and tests. Every anchor below was
verified in this repo on 2026-08-29 (§§0-7) or 2026-08-30 (§§8-10).
v5 (2026-08-30, later same day) is the independent-review addendum: a verified
implementation-status matrix (§13), a bug-fix batch with re-anchored findings
from auditing batches 1-3 + the landed batch-7 work against this plan (§14 —
batch 14, do before further feature batches), and plan corrections the audit
exposed (§15). All §13-15 anchors re-verified against HEAD 2a40613.
>> **IF YOU ARE AN AGENT PICKING THIS UP COLD: read §16 (SESSION
>> HANDOFF) first — it states exactly what is implemented-but-uncommitted,
>> what remains, in which order, and the pitfalls. §§13-15 are the audit
>> record; §16 is the live state.**

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

---

## 8. Memory & skill lifecycle hardening (v4 addendum)

The skills notebook is the good store (evals, lift, history, archive). The
addendum hardens its four lifecycle stages — create, update, retire, long-run —
and removes the two parallel stores that compete with it for the same budget.

### 8.0 Dead-code cleanup (do first — verified by call-path trace, 2026-08-30)

Small, zero-risk, and it un-strands a later batch:

- **Six orphaned components** (zero imports anywhere, lazy imports included):
  `components/analysis/PriceAlertToggle.tsx`, `components/desk/SeatCard.tsx`,
  `components/journal/MemoryBrowser.tsx` (superseded by
  `components/settings/MemoryFilesManager.tsx`), `components/journal/PerformanceReview.tsx`, `components/market/ProbabilityWidget.tsx`,
  `components/modals/SkipTradeModal.tsx`. Delete.
- **`conductTwoWayDebate` (ensembleService.ts:1297) and
  `conductThreeWayDebate` (ensembleService.ts:1714)** — ~800 lines imported
  ONLY by `tests/debateFlow.test.ts`; the engine's own comment
  (ensembleService.ts:3988) calls them "the dead two/three-way debate
  generators". Delete generators + their two test blocks. Accuracy mode uses
  `conductDebate` (alive, useAnalysisPipeline.ts:2402); the live path is
  `conductRealDebate` (:2772).
- **`ProviderHealthService` is write-only** — `recordProviderSuccess`/
  `recordProviderError` are fed by GenericProviderService; the readers
  (`getProviderHealth`/`getAllProviderHealth`) have no runtime consumer
  (tests only). Do NOT delete: §9.2 wires the read side (P4). The header
  comment promising a Settings health view was never built — fix or amend
  the comment when wiring.
- **Plan landmine re-point**: §4.4 says "Panels in PerformanceReview/
  WinRateDashboard" — `PerformanceReview` is one of the dead components.
  When batch 5 lands, target the rendered journal surface instead.
- Gate: typecheck + tests + build; one plain commit.

### 8.1 Store unification

**The problem.** Three parallel memory systems rank against the same fixed
prompt budget, each with its own cap, its own ranking scheme, and its own
dedupe rules — and two of the three have no review UI:

1. The skills notebook (the good store): SkillMeta records with evals, lift,
   history, archive (`SkillMemoryService.ts`), surfaced in
   MemoryFilesManager + SkillsGrid + LearningDashboard.
2. `InsightExtractionService` — regex-mines post-mortem TEXT into
   TradeInsight records (patterns at InsightExtractionService.ts:47-103,
   `MAX_STORED_INSIGHTS = 100` pruned oldest-least-used at :177-188, max 3
   injected per prompt at :28). Regex mining rewards fluent writing, not
   correct writing — the exact "mines fluency, not outcomes" failure mode
   §4.6 already bans for the judge.
3. `PatternMemorySynthesisService` — the AttributedInsight store: its own
   qualityScore recomputed from thumbs (:804-828), its own 200-record trim
   (:727-729), no browsing UI, feedback wired to exactly one button
   (VersionHistoryDashboard).

Three stores means three caps, three ranking schemes, and duplicated lessons
competing for the same prompt budget.

**Migration plan, in dependency order:**
- (a) FIRST migrate the load-bearing consumer: `generateMandatoryPatternCheck`
  (:884, :984) is the pipeline's mandatory-pattern gate
  (useAnalysisPipeline.ts:2301 depends on it) — re-point it at notebook data
  and keep its behavior identical.
- (b) Migrate the AttributedInsight store into low-tier candidate skills /
  memory facts with `distilled:<fingerprint>` provenance (the §4.6 distill
  path).
- (c) Delete the regex miner (`InsightExtractionService` patterns + cap
  machinery) once its consumers (`usePostMortem`, JobQueueService) are
  re-pointed at the notebook paths.
- (d) Migrate the VersionHistoryDashboard feedback button onto the notebook's
  evidence path.

**Result:** one store, one cap, one ranking, one UI (MemoryFilesManager +
SkillsGrid). Gate: no consumer of either store's exports remains except
migrated call sites + tests; snapshot-test that the mandatory-pattern-check
gate emits identical verdicts over a fixture trade log pre/post migration.

### 8.2 Creation hardening

**a) Skill birth certificates.**
Verified today: a created skill carries provenance (originMessageId, tradeIds
tail-20) but NO claim — the confirm/retire ladder is threshold magic (promote
at `MIN_SAMPLE_CONFIRMED = 5`, retire at `MIN_SAMPLE_RETIRE = 6`,
SkillMemoryService.ts:128-130) and the eval scheduler asks a generic
hurts/helps question.
Design: at creation the skill must pre-register a falsifiable prediction in
its frontmatter:
```
prediction:
  expectedLiftPts: number   # minimum win-rate delta claimed
  horizonTrades: number     # trades over which the claim must hold
  scope: { coin?, family?, regime? }
```
Wiring: (1) `CraftedSkill` (SkillCraftService.ts:51) gains the fields,
extracted in the same LLM call; (2) the worth gate zod schema
(`WorthDecisionSchema`, skillWorthGate.ts:23) REJECTS a create verdict whose
craft output lacks one — fail-closed; (3) `SkillEvalScheduler` tests the
skill against its own claim ("did win rate rise ≥ expectedLiftPts over
horizonTrades within scope?") instead of a generic verdict; (4) the verdict
feeds the ladder — claim met at horizon → confirmed, claim unmet → retire
with reason `insufficient-evidence` (§8.4b). The ladder becomes principled
instead of magic.
Tests: gate rejects prediction-less crafts; scheduler verdict equals the
claim comparison on fixture skills with known records.

**b) Comparative worth gate with a library cap.**
Verified today: the worth gate judges "is this worth keeping?" in isolation;
confirmed skills are unbounded while injection budgets are fixed (opening
900 / rebuttal 400 / verdict 600 chars, MemoryRetrievalService.ts:41-46) —
every new skill silently taxes every existing skill's chance of being seen.
Unbounded libraries are how every memory system drowns.
Design: `SKILL_LIBRARY_CAP` (harnessSettings, default 40 confirmed). Below
the cap the gate answers as today. At the cap it answers "is this better
than the weakest confirmed skill?" — lift comparison via
MemoryProvenanceService. New wins: the weakest is displaced to retired
(reason `superseded`, supersededBy = winner) and the winner enters.
Wiring: cap check at the gate call site inside `syncClosedTradeToNotebook`
(SkillMemoryService.ts:1404-1417); the displaced skill gets a tombstone row
(§8.4a) so the comparison stays visible. Displacement is a SUGGESTION queued
for approval (§10.3) — the gate proposes, the inbox disposes (§4.6 ruling 5
stands).
Tests: cap boundary (39/40/41 confirmed), displaced record fields,
suggestion-not-auto semantics.

**c) Mine correct passes, not just trades.**
Verified today: skill creation requires a closed-trade cluster
(`MIN_CLUSTER_FOR_SKILL = 3` inside `syncClosedTradeToNotebook`,
SkillMemoryService.ts:1333-1445); SKIPPED trades never reach it, so
discipline — the thing the research says matters most — is invisible to the
learning loop.
Design: for SKIPPED trades with a reason (§4.1 field), resolve the pass
post-hoc deterministically: fetch klines after the skip timestamp and check
whether the would-be entry (the analyst's preliminary plan — already
captured for the veto ledger, useAnalysisPipeline.ts:~2350) would have hit
SL (correct pass) or TP (missed opportunity). Clusters of ≥3 correct passes
sharing a {coin|direction|family|regime} fingerprint draft an avoid-skill
through the existing craft path, provenance = skip episode ids —
"we passed on premium-side longs in chop 4 times; price confirmed all 4."
Missed-opportunity passes surface as a journal counter-metric (a "miss
cost" table), NOT as skills — we do not teach the system to take more
trades; §3's breakers own that side.
Tests: pass resolution on synthetic klines (TP-first vs SL-first),
cluster→draft flow, no skill drafted from misses.

### 8.3 Update hardening (evidence quality)

**a) Track adherence separately from co-occurrence (three-state evidence).**
Verified today: `applySkillEvidence` (SkillMemoryService.ts:680-690)
credits/blames a skill on the trade outcome whenever the skill matched —
including when the moderator was handed the skill and overrode it. A skill
that was injected and ignored eats the loss; this is the most common way
skill stats silently rot.
Design: three evidence states, joined entirely from data that already
exists:
- FOLLOWED — the verdict cited the skill (parsed by `attachVerdictCitations`,
  ensembleService.ts:909; enforced by `enforceCitedVerdict`, :929) → outcome
  counts toward wins/losses.
- OVERRIDDEN — injected into the verdict prompt (injection log record,
  MemoryInjectionService.ts:220-231) but NOT cited → recorded on a separate
  per-skill override counter; a high override rate is itself a signal (the
  skill always gets ignored → amend-trigger candidate).
- CONTROL — not injected (controlIds path or §8.5a holdout) → feeds the
  control group for lift.
Wiring: the injection log record needs one added linkage field
(verdict/trade id) so the join is possible; the join itself lives next to
applySkillEvidence's caller. Only FOLLOWED outcomes drive `deriveStatus`;
OVERRIDDEN drives the amendment queue; CONTROL drives lift.
Tests: three-way join over fixture trades (cited / injected-uncited /
absent), override counter accumulation, status unaffected by overridden
outcomes.

**b) Re-scope instead of decay when the pattern is conditional.**
Verified today: `applyEvidenceDecay` (SkillMemoryService.ts:680-690) halves
wins/losses when evidence is >30 days stale OR the regime differs — treating
"works in trend, fails in chop" as FADING when it is actually CONDITIONAL.
Design: keep per-regime splits on the skill (`regimeStats:
Record<regime, {w, l}>`, written alongside the existing counters). When the
split diverges (one regime ≥3W/≤1L while another ≥3L/≤1W), do NOT decay —
auto-draft an amend-trigger proposal ("narrow appliesWhen to `<regime>`")
into the §4.6 queue. The skill gets sharper, not weaker; the decay path
remains for genuine staleness only.
Tests: divergence trigger boundary, drafted proposal diff content, decay
unchanged when no divergence.

**c) Shadow-run refinements.**
Verified today: the 3-consecutive-loss LLM refinement
(SkillMemoryService.ts:139-145, :702-720) snapshots `previousVersion`
(:177, :263) and immediately swaps the refined version into live use — a
panicked refinement after a bad-luck streak can replace a good skill with a
worse one, undetectably.
Design: on refinement, the REFINED version enters eval-only shadow (the
SkillEvalService with/without A/B chassis already exists) while the PRIOR
version keeps the live injection slot for ~10 matched trades. Promote
whichever wins the comparison; a losing refinement logs a P7 harness-lesson
(refinement overfit). Rollback = restore previousVersion (the mechanism
already exists).
Tests: shadow-window promotion/rollback, live slot retention during shadow,
refinement-loss lesson emission.

**d) Confidence intervals before confirmation.**
Verified today: `deriveStatus` promotes at 5 samples
(SkillMemoryService.ts:128-130) — a 4-1 record at N=5 is statistically
indistinguishable from coin flips.
Design: confirmation additionally requires the Wilson lower bound of the
followed-evidence win rate, minus the control win rate, to exclude zero.
No controls yet (cold start) → require the raw Wilson interval to exclude
50% AND N ≥ 8. The raw-threshold ladder stays as a floor; the CI is the
gate. This attacks the junk-skill problem at the promotion gate rather than
downstream.
Wiring: pure function next to MemoryProvenanceService (which already
computes point lift); called by deriveStatus.
Tests: interval math on known fixtures, gate boundary (4-1 stays candidate;
8-2 with controls confirms), cold-start path.

### 8.4 Retirement & deletion

**a) Graveyard index — retired skills must stay barely visible.**
Verified today: retirement flips status and moves the file to skills/archive
(MemoryFilesService.ts:138-149), dropping it from ranking entirely — so
NOTHING stops the worth gate from re-creating the same skill from the next
loss cluster. The existing creation dedup (lowercased ifCondition,
SkillMemoryService.ts:1063-1066) covers only LIVE files.
Design, two halves:
- Creation dedup: BEFORE the worth gate runs, normalize the candidate's
  ifCondition (lowercase, strip paths/ids/numbers — reuse the §4.6
  fingerprint normalizer) and compare against archive slugs. A match drafts
  a REVIVAL review card ("this exact rule was tried and retired: eval-hurts
  after N=8 — see tombstone") instead of a fresh skill.
- Tombstone index: one line per retired skill — "tried X, retired: <reason>
  after N=<sampleN>, lift was <+/-pts>" — maintained at retirement time and
  injected into the WORTH GATE's context (capped, most recent 40), never
  into the debate. The graveyard is how the system remembers what didn't
  work — half of learning.
Tests: dedup hit on a retired twin (exact + token-shuffled condition),
tombstone line generation, gate-context cap.

**b) Retirement reason taxonomy.**
Verified today: the history ledger (SkillMeta `history` temporal intervals,
SkillMemoryService.ts:116-125) records THAT a skill left, not WHY.
Design: every retirement writes a reason — `{insufficient-evidence |
regime-shifted | superseded | eval-hurts | user-veto}` — on the history
entry. The reason feeds the tombstone line, the monthly report card (§4.5),
and the re-entry rules table:
- `regime-shifted` → MAY auto-revive (a suggestion, user-confirmed) when
  regimeLedger (regimeLedger.ts:743-755) shows its regime returning with
  ≥3 fresh episodes in the window.
- `insufficient-evidence` → re-eligible when a NEW cluster arrives with
  more evidence than the failed window had.
- `superseded` → stays retired while its successor lives; revives as a
  suggestion if the successor is itself retired.
- `eval-hurts`, `user-veto` → explicit human action required; no auto path
  ever (§10.3).
Tests: reason recorded on every retirement path (eval streak, generalization,
user toggle, displacement), re-entry rule per reason.

**c) Contradiction sweep.**
Verified today: nothing detects two LIVE skills with overlapping IF
conditions and conflicting THEN actions — both inject (ranking
independently, MemoryRetrievalService.ts:112-123) and seats receive
incoherent guidance.
Design: a deterministic periodic pass beside weeklyRollup (same
JobQueueService trigger, no LLM): pairwise condition-token overlap ≥ 2
(symbol/family/regime/direction tokens) AND conflicting action (opposite
kind repeat/avoid, opposite direction, or contradictory thenAction) → a
merge/priority proposal queued for the human gate. Prevents the worst kind
of context poison for the cost of a cron tick.
Tests: pair detection over fixture libraries (true positives + near
misses), proposal dedup (the same pair is not re-queued every week).

**d) Settled beliefs need a challenge path.**
Verified today: only the doctrine rewriter can emit INVALIDATE
(settledBeliefs.ts:1-28) — and it sees rollup NOTES, not raw
counter-evidence. A `settled` belief is effectively unchallengeable by
data.
Design: when a belief is settled, register its observable claim; a
deterministic rolling-window counter (per belief slug) increments on closed
trades whose FOLLOWED outcome contradicts the claim (e.g. "never short into
premium" vs followed WIN shorts in premium). At ≥3 contradictions in the
window the belief is auto-FLAGGED for review — surfaced through
MemoryReviewService's suggestions path plus a review card — never
auto-invalidated. "Settled" must mean hard to change, not unchallengeable;
permanent beliefs with no falsification path are exactly the drift §4.6's
anti-drift rules exist to prevent.
Tests: contradiction counter per claim type, flag at threshold, no
invalidation without the human gate.

### 8.5 Long-run loop honesty

**a) Permanent ε-holdout — the single most important long-run mechanism in
this addendum.**
Verified today: once a skill is confirmed it is injected on every matching
run — its controlIds stop growing, and lift (post-influence vs
pre-influence, MemoryProvenanceService) becomes a historical artifact
measured on a window that no longer exists.
Design: withhold skill injection on ~10% of runs, forever. Seeded per run
id (reproducible), decided at the single retrieval entry point
(`getMemoryFilesContext`, MemoryRetrievalService.ts:469-567) so no call
site can forget it, recorded on the injection log entry (`holdout: true`)
and emitted into runStats so every downstream consumer can see it. The
holdout covers candidate skills especially — they need controls even more
than confirmed ones.
Cost/acceptance: holdout runs may produce slightly worse verdicts; the 10%
expectation is the price of counterfactual lift estimation — and therefore
pruning, promotion, and the §4.6 measurement loop — staying honest after
year one. Without it, every lift number slowly becomes decoration. There is
deliberately NO setting to disable it: a disablable holdout gets disabled
the first time a holdout run misses.
Tests: seeded reproducibility (same run id → same decision), holdout flag
in the injection log + runStats, controlIds accumulating on holdout runs.

**b) Meta-calibration — the loop learns about the loop.**
Verified today: nothing measures the learning machinery itself.
Design: three ratios computed by weeklyRollup (deterministic, no LLM) into
a small preferences blob:
- worth-gate precision: of skills the gate approved, what fraction reached
  confirmed?
- refinement recovery rate: of refinements, what fraction beat their
  previousVersion in shadow (§8.3c)?
- eval-verdict agreement: of hurts/helps verdicts, what fraction did
  realized outcomes agree with?
Surface in the Learning dashboard header next to the §4.6 metrics. These
are the empirical basis for tightening or loosening the gates, and they are
lessons about the HARNESS (keyed on the gate, not on any provider) — the
natural first residents of the P7 harness-lessons store once batch 1 ships
it. A gate whose precision decays gets a harness-lesson and a default-change
proposal, not a silent threshold tweak.
Tests: ratio computation over fixture histories, dashboard rendering,
lesson emission on decay.

**c) Context-budget economics.**
Verified today: injection chars are the scarce resource, but nothing
measures a skill's cost against its benefit — ranking (status × overlap ×
age decay, MemoryRetrievalService.ts:112-123) is blind to size. A skill
with +1pt lift occupying 200 chars of every opening slice may be
net-negative versus letting a runner-up in.
Design: per skill, cost = average injected chars × injection frequency
(both derivable from the injection log; add one field — injected char
count); benefit = lift × trade frequency. Rank on lift-per-char; the
monthly report card names the worst offender. This grows MORE important,
not less, after §4.7's index-layer migration: index lines are cheap, but
recall pulls are not — the economics should price both (an index line +
N recalls/month).
Tests: cost/benefit computation from fixture logs, worst-offender
selection, index-line vs recall pricing.

**d) Regime-mix drift sentinel.**
Verified today: time-based decay (30 days, applyEvidenceDecay) is the only
staleness axis; regimeLedger (regimeLedger.ts:743-755) already records the
regime mix per coin×day but nothing compares it to skill evidence windows.
Design: when the last 30 days' regime mix diverges sharply (L1 distance
threshold) from the mix during which a skill's evidence accumulated (from
regimeStats, §8.3b), mark the skill stale-by-regime — DISTINCT from
stale-by-time — and downweight it in ranking (a factor in
MemoryRetrievalService.ts:112-123) until fresh evidence arrives in the
current mix. Crypto regime shifts are the main way a whole library goes
quietly wrong at once; time-decay cannot catch a fast shift because it has
no idea what "fast" means.
Tests: mix divergence computation, flag + downweight, auto-clear on fresh
evidence.

## 9. Debate-flow addendum (v4)

### 9.1 Structured seat tier above 5

Verified 2026-08-30 by direct trace: the roster is hard-capped — Team slots
`slice(0, 5)` (EnsembleAnalystService.ts:147), lens mode seats exactly the 3
required roles (:44-48, :133-141), the fallback path caps at 3 (:176-190).
Configuring 6-10 providers does NOT error — the user silently gets 5.
Raising the cap is mechanically a one-line slice, but three engine
properties were designed for ≤5 and break at 10 without structure:

- **Addressed routing degenerates.** A rebuttal reads only peer turns
  addressed to it (turnAddressedTo, ensembleService.ts:3082-3087). At 9
  seats most pairs never address each other; diff packets thin out and
  seats increasingly talk past each other. The floor needs explicit
  speaking structure, not just more seats.
- **The verdict goes partially blind.** The moderator transcript is capped
  at 2400 chars total / 100 per turn (:3887), and the auction block (:2534)
  + final-positions summary (:3978) assume a handful of seats — at 10 seats
  the cap silently truncates mid-argument.
- **Cost curve.** Rebuttals are per-seat speculative (:3054-3061) so
  wall-clock stays flat, but total tokens scale ~linearly with seats and
  transcript building scales worse.

**Design — LENS PODS, not a flat 10-way floor:**
- 6-10 seats → 3 pods (macro / technical / risk), 2-3 seats each — mapped
  from lens assignments when lenses are ON, from bot lens hints / team
  metadata when they are not; unmarked seats round-robin into the
  least-populated pod.
- Pod-internal round: one compact round where pod members see only each
  other's openings and emit a pod position (bounded budget, e.g. 600
  chars/seat); ONE pod representative (highest seat-trust score,
  buildSeatTrustBlock :2563) carries the pod position + a dissent summary
  to the floor.
- Floor rounds then run exactly as today at effective size 3-5: the
  existing addressed routing, devil rotation, evidence round, and
  clarification logic all work unchanged.
- Every seat still emits its own sealed CONVICTION on the final round
  (insurance retry :3222-3239 covers all seats); the auction stays
  seat-level, not pod-level — the moderator sees all 6-10 convictions,
  which is the point of the bigger roster.
- Re-budget the verdict path: per-turn cap stays 100, total transcript cap
  scales (e.g. 2400 + 400×(seats−5)); auction and final-positions
  summaries summarize per pod.
- Roster UI: Team slots currently cap at 5, mirroring the engine — extend
  to 10 with a pod-assignment affordance, and evaluate the
  homogeneous-roster warning (§1.2b) per POD and per floor.

Gate: debateFlow tests at 6/9/10 seats asserting pod routing (a pod
member's floor-facing text equals its pod position), auction completeness
(all seats' convictions present), and a cost assertion (floor rebuttal
call count unchanged vs 5 seats).

### 9.2 ProviderHealth read side (P4 dependency)

Verified 2026-08-30: ProviderHealthService records per-provider
request/error/rate-limit counts on every call (fed by
GenericProviderService), and the read side (`getProviderHealth`/
`getAllProviderHealth`) has NO runtime consumer — tests only. The header
comment promises a Settings health view that was never built. Wire it in
two places:
- **Roster-build cooldown (P4's core):** ≥3 persisted errors within 15
  minutes → the provider is skipped from roster consideration for 10
  minutes, cleared on a success. Hook at `buildEnsembleAnalysts`
  (EnsembleAnalystService.ts:77) input filtering and at the moderator
  fallback selection. Transient retries (streamWithTransientRetry,
  ensembleService.ts:2744) do NOT count — only persisted errors land in
  the map by construction (opengrok F11 semantics).
- **Settings health view:** the provider list shows last error, latency,
  and rate-limit count — the read the header comment always promised.
Small; un-blocks P4 with zero new telemetry, and resolves the write-only
finding in §8.0 (which is why §8.0 says do-not-delete).

## 10. Chat & floor UI addendum (v4)

### 10.1 Chat mode

- **Unread badges (cheapest win on this list).** `unreadCount`/
  `markThreadOpened` exist in utils/agentThreads.ts:197-223 with NO UI
  consumer (verified: the only other reference is DebateMailbox). Render a
  monochrome count badge on AgentRosterRail rows; call markThreadOpened
  when a thread is focused. The machinery is already tested — this is
  wiring, not building.
- **Learning inbox as a Coach thread.** When §4.6's approval queue ships,
  do NOT build a separate inbox surface. Draft cards (type badge, unified
  diff, provenance chips, Approve/Edit/Reject) arrive as messages from a
  reserved "Coach" bot in the roster, rendered with the existing
  InlineApprovalCard pattern; the coach is a special bot id excluded from
  harness seat eligibility. Matches the established no-toasts/chat-bubble
  rule and makes reviewing a conversation: "why did you draft this?" is a
  reply, answered with the draft's provenance (episode ids, first-seen,
  occurrences).
- **Skill-citation chips in transcripts.** `attachVerdictCitations`
  (ensembleService.ts:909) already parses cited skill slugs into turn
  metadata. Render tappable chips on the verdict message: tap → opens the
  skill's SkillsGrid card (lift, history, status); plus a one-tap "this
  was wrong here" writing negative evidence through the same path
  VersionHistoryDashboard's feedback button uses. Closes the chat↔learning
  gap — today SkillsGrid lives three menus away from the place where
  skills actually act.
- **Message search.** Threads are derived views over ONE flat message
  array (utils/agentThreads.ts:1-27), so cross-thread search is a filter
  over that array — no index, no new store. Roster search
  (AgentRosterRail :116-131) covers names only today.
- **Per-message context disclosure.** InjectionContextBar shows what the
  NEXT send will include; debate messages should carry a "what this seat
  saw" expander fed by MemoryInjectionService records (stage, audience,
  sources per injection). This is the trust surface for the learning
  system itself: skepticism about a bad answer should be answerable by
  inspection, not by faith.

### 10.2 Floor mode

- **Make the floor the wire-layer observability surface.** P5's per-call
  audit labels + §9.2 health data need a home: the seat's desk shows
  thinking on/off, current effort tier, cooldown state, and fitness as a
  subtle posture/badge (floorTheme stays monochrome — states encode as
  iconography, not color). Harness-lesson events go to the squawk feed as
  system lines ("Seat 3 pinned thinking-off — wire lesson"). Today the
  floor is a decorative projection of app state; this makes it the one
  surface where you can SEE the harness managing itself — the most useful
  and the most compelling thing the floor could show.
- **Sealed-auction dot plot.** After conviction reveal, a small dot plot on
  the Big Board — one dot per seat, positioned 0-100, outlined by lens —
  makes dissent legible at a glance. §5d's "show the dissent" currently
  has no floor-mode expression (the spread readout exists only in
  DebateSummary).
- **Guard state on the Big Board.** When §3b's SessionGuardService ships,
  rotate day P&L vs limit and trades-remaining into the Big Board
  rotation. The floor is the ambient display; risk state is the thing most
  worth ambient awareness.
- **Pin a seat's bubble.** The spotlight SpeechBubble is single-speaker
  (FloorScene.tsx :163-171, :428-435); clicking a desk mid-debate
  currently jumps to that seat's 1:1 chat thread (:412, :444), which exits
  the floor experience. Add pin-in-place: click pins the seat's live
  argument in a side pane while the floor keeps moving; jump-to-thread
  becomes the secondary action.

### 10.3 What NOT to add (v4)

- A flat 10-seat floor without pod structure (see §9.1).
- Auto-apply for any lifecycle action — worth-gate displacement demotes,
  CI gates, belief flags all stay SUGGESTIONS in the human-gated queue
  (§4.6 rulings 1/5 stand).
- Any resurrection path for `eval-hurts`-retired skills that is not an
  explicit user action.

## 11. Implementation batches (v4 addendum)

8. **Dead-code cleanup (§8.0)** — do first; small; one plain commit.
9. **Store unification (§8.1)** — standalone cleanup; shrinks the surface
   every other batch touches. Migrate the mandatory-pattern-check dependency
   first, stores second; snapshot-test the gate verdicts.
10. **Lifecycle hardening A — creation + evidence (§8.2, §8.3)** — birth
    certificates, comparative gate + cap, pass mining; three-state
    adherence, re-scope, shadow refinements, Wilson gate.
11. **Lifecycle hardening B — retirement + long-run (§8.4, §8.5)** —
    graveyard dedup + tombstones, reason taxonomy, contradiction sweep,
    belief challenge, ε-holdout, meta-calibration, economics ranking,
    regime sentinel.
12. **Seat tier + health wiring (§9)** — start with §9.2 (small), then
    §9.1 pods + verdict budgets + roster UI.
13. **UI addendum (§10)** — unread badges and Coach inbox first (cheap);
    citation chips with the SkillsGrid linkage; floor observability lands
    with batch 12's audit labels (P5) since they share one data source.
14. **Audit fixes (§14 — v5)** — defects found reviewing batches 1-3 +
    7 at HEAD 2a40613: Kelly sign bug (14-1), messages/google wire audit
    (14-2), probe self-harm pin (14-3), P6 wire assertions (14-4), P7
    read/write wiring (14-5), closedAt + guard math (14-6/7), guard
    config surface (14-8), snapshot ordering (14-9), cooldown rulings +
    housekeeping (14-10/11). DO FIRST — before any further feature
    batch; every downstream claim (P5/P6/P7, §3 guard, §4.1 MFE) builds
    on these. Full item list with anchors and fixes: §14.

**Sequencing note (from the 2026-08-30 memo):** the three mechanisms that
determine whether every downstream lift number is trustworthy — three-state
adherence (§8.3a), graveyard dedup (§8.4a), and the ε-holdout (§8.5a) — are
small and should ship inside whatever batch first touches the measurement
loop (existing batch 6's Phase E, or batch 11 here, whichever runs first).
Store unification (batch 9) shrinks the surface every other batch touches.
Unread badges and the Coach inbox are the cheapest UI wins; floor
observability shares its data source with P5 (existing batch 1), so land
them together.

**Ordering/dependencies:** 8 → 9 are prerequisites-in-spirit for everything
else (one store, no ghosts). 10-13 are independent of existing batches 1-7
except where noted: §8.5b meta-calibration needs P7's store (batch 1); §10.2
floor observability needs P5's audit labels (batch 1); §9.1 wants §1.2b's
homogeneity warning; §8.3a's citation join wants the
attachVerdictCitations metadata to stay stable. Each batch gated:
typecheck + tests + build; one plain commit per batch.

---

## 12. Appendix — source recommendation memo (2026-08-30, verbatim)

Reproduced verbatim below; §§8-10 subsume it with verified anchors, record
shapes, wiring, and tests added. Kept for provenance, matching how v2 of
this plan folded in its source documents.

````
I'll ground this in the actual codebase state — let me read the current upgrade plan and survey the learning layer and the two UI modes.

I read the current `HARNESS_UPGRADE_PLAN.md` and had an explorer map the entire learning layer and both UI modes as they exist today, so these suggestions build on what's already planned (§4.6 episode loop, §4.7 index injection, P7 harness-lessons) rather than repeating it. TLDR of the highest-leverage new ideas: **unify the three overlapping memory stores into one, give retired skills a "graveyard index" so dead ideas can't be relearned, formalize a permanent holdout so skill lift stays measurable forever, track adherence (was the skill actually followed?) separately from co-occurrence, and make the floor the observability surface for the wire layer.** Detail below, organized by lifecycle stage as you asked.

## Creation

**1. Unify the stores first — this is the biggest structural debt.** You have three parallel memory systems: the skills notebook (the good one, with evals/lift/history), plus `InsightExtractionService` (regex-mines post-mortem *text* — it rewards fluency, not outcomes) and `PatternMemorySynthesisService` (`AttributedInsight` with its own qualityScore, its own 200-cap, no browsing UI, feedback wired to exactly one button in VersionHistoryDashboard). Three stores means three caps, three ranking schemes, and duplicated lessons competing for the same prompt budget. I'd fold both insight stores into the notebook as low-tier candidate skills (or memory facts via the §4.6 distill path) and delete the regex miner — it's exactly the "mines fluency" failure mode your own plan warns about in §4.6.

**2. Skill birth certificates.** Every created skill should carry, at creation time: source episode ids (planned), *plus a pre-registered prediction* — "this skill should raise win rate on `{coin, family, regime}` setups by ≥X points over N trades." The eval scheduler then tests the skill against its own stated claim rather than a generic hurts/helps judgment. A skill that can't state a falsifiable prediction shouldn't pass the worth gate. This makes the confirm/retire ladder principled instead of threshold-magic (why 5 wins? why 6 samples?).

**3. Comparative worth gate with a library cap.** Right now the worth gate answers "is this worth keeping?" in isolation. Cap active confirmed skills (say 40) and make the gate answer "is this better than the weakest confirmed skill?" once the cap is hit. Unbounded libraries are how every memory system drowns: injection budgets are fixed, so each new skill silently taxes every existing one's chance of being seen. A cap forces displacement and keeps the ranking meaningful.

**4. Learn from passes, not just trades.** The SKIPPED outcome exists and §4.1 adds a reason field — go one step further and mine *correct passes* into avoid-skills ("we passed on premium-side longs in chop 4 times; price confirmed all 4"). Right now skill creation requires a trade cluster, so discipline — the thing the research says matters most — is invisible to the learning loop.

## Updating

**5. Track adherence separately from co-occurrence.** Today `applySkillEvidence` credits/blames a skill based on the trade outcome when the skill matched. But a skill that was injected and *overridden* by the moderator shouldn't eat the loss. You already log injections (`MemoryInjectionService`) and enforce citation (`enforceCitedVerdict`) — join them: evidence should be three-state (followed / injected-but-not-cited / not-injected via controlIds). This is cheap and it fixes the most common way skill stats silently rot.

**6. Re-scope instead of decay when the pattern is conditional.** `applyEvidenceDecay` halves evidence on regime mismatch — that treats "works in trend, fails in chop" as *fading* when it's actually *conditional*. Keep per-regime win/loss splits on the skill; when the split diverges (works in one regime, hurts in another), auto-draft an amend-trigger proposal ("narrow appliesWhen to trending") into the §4.6 queue instead of decaying globally. You get a sharper skill, not a weaker one.

**7. Shadow-run refinements.** When the 3-loss streak triggers `refineSkillFromLosses`, the old version becomes `previousVersion` and is gone from live use. Instead, keep the prior version running in eval-only shadow (the SkillEvalService A/B chassis already exists) for ~10 trades and promote whichever version wins. Otherwise a panicked refinement after a bad-luck streak can replace a good skill with a worse one and you'll never know.

**8. Confidence intervals before confirmation.** With N=5 samples, a 4-1 record is indistinguishable from coin flips. Compute a Wilson interval on lift (MemoryProvenanceService already computes point lift) and require the interval to exclude zero before `confirmed`. Below that, the skill stays candidate no matter its raw record. This directly attacks the junk-skill problem at the promotion gate rather than downstream.

## Deletion / retirement

**9. Graveyard index — retired skills must stay barely visible.** Today retirement drops a skill out of ranking entirely, which means nothing stops the worth gate from re-creating the same skill from the next loss cluster. Two fixes: (a) dedupe new-skill candidates against the archive by normalized ifCondition/fingerprint before the worth gate runs; (b) maintain a compact tombstone index — one line per retired skill: "tried X, retired: eval-hurts after N=8" — injected into the *worth gate's* context (not the debate). The graveyard is how the system remembers what didn't work, which is half of learning.

**10. Retirement reason taxonomy.** `{insufficient-evidence | regime-shifted | superseded | eval-hurts | user-veto}` stored on the history entry. It feeds the tombstone line, the monthly report card, and — crucially — different re-entry rules: a `regime-shifted` skill can auto-revive when its regime returns (regimeLedger tells you); an `eval-hurts` skill needs a human to resurrect it.

**11. Contradiction sweep.** Nothing currently detects two live skills with overlapping IF conditions and conflicting THEN actions — both inject and the seats get incoherent guidance. A periodic deterministic pass (condition-token overlap + opposite kind/direction) that queues conflicting pairs for a merge/priority decision belongs next to the weekly rollup.

**12. Settled beliefs need a challenge path.** Right now only the doctrine rewriter can emit INVALIDATE, and it sees rollup notes, not raw counter-evidence. Add a deterministic rule: a settled belief accumulating ≥3 contradicting outcomes in a rolling window gets auto-flagged for review (not auto-invalidated). "Settled" should mean *hard to change*, not *unchallengeable* — permanent beliefs with no falsification path are exactly the drift your plan's anti-drift section worries about.

## Long-run self-improvement

**13. Permanent ε-holdout — the single most important long-run mechanism.** Once a confirmed skill is always injected, its lift becomes unmeasurable: you have no more control group, and `controlIds` stops accumulating. Randomly withhold skill injection on ~10% of runs (flagged in runStats so it's auditable) forever. This keeps counterfactual lift estimation alive for the life of the system and is what lets pruning, promotion, and the measurement loop in §4.6 stay honest after year one. Without it, every lift number slowly becomes a historical artifact.

**14. Meta-calibration — the loop learns about the loop.** Track the learning machinery's own precision: of skills the worth gate approved, what fraction reached confirmed? Of refinements, what fraction recovered? Of eval 'hurts' verdicts, what fraction did realized outcomes agree with? These three numbers tell you whether to tighten or loosen the gates, and they're the natural first residents of the P7 harness-lessons store (they're lessons about the harness, keyed on the gate, not on any provider). Surface them in the Learning dashboard header alongside the §4.6 metrics.

**15. Context-budget economics.** Injection chars are the scarce resource. Per skill, compute cost (avg injected chars × injection frequency) vs benefit (lift × trade frequency). A skill with +1pt lift that occupies 200 chars of every opening slice may be net-negative versus letting a runner-up skill in. Rank on lift-per-char, and let the monthly report name the worst offender. This becomes more important, not less, after §4.7's index-layer migration — index lines are cheap but recall pulls are not.

**16. Regime-mix drift sentinel.** regimeLedger gives you the regime distribution over time. When the last 30 days' mix diverges sharply from the window a skill's evidence came from, mark it *stale-by-regime* (distinct from stale-by-time) and downweight until fresh evidence arrives. Crypto regime shifts are the main way a whole library goes quietly wrong at once, and time-decay alone won't catch a fast shift.

## Chat mode UI

- **Wire the unread machinery.** `unreadCount`/`markThreadOpened` exist in `utils/agentThreads.ts:197-223` and are consumed by nothing in the UI. Unread badges on roster rows are almost free.
- **Learning inbox as a Coach thread.** When §4.6's approval queue ships, don't build a separate inbox surface — surface drafts as messages from a "Coach" bot in the roster, with Approve/Edit/Reject as inline cards (`InlineApprovalCard` already exists). This matches your no-toasts, chat-bubbles preference, and it makes reviewing drafts a conversation ("why did you draft this?" is a reply, answered with provenance).
- **Skill-citation chips in transcripts.** When a verdict cites a skill (enforceCitedVerdict gives you the citation), render a tappable chip on the verdict message that opens the skill card with its lift and history, plus a one-tap "this was wrong here" that logs negative evidence. This closes the loop between the chat surface and the learning surface — today they're completely disjoint (SkillsGrid lives three menus away).
- **Message search.** Roster search exists; message search across threads doesn't, and threads are derived views over one flat array, so it's a filter, not an index.
- **Per-message context disclosure.** InjectionContextBar shows what the *next* send will include; debate messages should have a "what this seat saw" expander (the data is in MemoryInjectionService, per stage/audience). This is the trust surface for the learning system itself: skepticism about a bad answer should be answerable by inspection.

## Floor mode UI

- **Make the floor the wire-layer observability surface.** P5's audit labels need a home — put them on the seats. A seat's desk shows: thinking on/off, current effort tier, cooldown state (P4), fitness score as a subtle posture/badge. When a harness-lesson pins a provider to thinking-off, the squawk feed says so ("Seat 3 pinned thinking-off — wire lesson"). The floor is currently a decorative projection; this makes it the place where you can *see the harness managing itself*, which is both useful and the most compelling thing the floor could show.
- **Reveal the sealed auction visually.** After conviction reveal, a small dot plot on the Big Board — one dot per seat, colored by lens — makes dissent legible at a glance (§5d's "show the dissent" has no floor-mode expression yet).
- **Guard state on the Big Board.** When SessionGuardService (§3b) ships, rotate day P&L vs limit and trades-remaining into the Big Board. The floor is the ambient display; risk state is the thing most worth ambient awareness.
- **Pin a seat's bubble.** The spotlight bubble is single-speaker; clicking a desk mid-debate should pin that seat's live argument (click currently jumps to the 1:1 thread, which exits the floor experience). Pin-in-place keeps you on the floor watching the argument develop.

## What I'd sequence first

If I were adding to the plan's batches: items **5, 9, 13** (adherence-aware evidence, graveyard dedup, ε-holdout) belong inside Batch 6's measurement loop — they're small and they determine whether every downstream lift number is trustworthy. Item **1** (store unification) is a standalone cleanup batch that shrinks the surface every other batch touches. The unread badges and Coach-thread inbox are the cheapest UI wins; the floor observability work naturally lands with Batch 1 since P5's audit labels are its data source.
````

---

## 13. Implementation status matrix (v5 — verified by grep/read against HEAD 2a40613, 2026-08-30; not from commit messages)

> **v5.1 UPDATE (same day, post-work):** batch 14 (§14) FULLY LANDED;
> batch 8 (§8.0) LANDED (six orphans + two/three-way generators deleted,
> ~1000 lines out); batch 5 PARTIAL LANDED — §4.3 checklist + §4.5 weekly
> review shipped (services/learning/weeklyReview.ts, WeeklyReviewCard,
> boot trigger). Batch 5 still open: monthly report card, §5a pre-read
> capture, §4.7 index-layer injection. Batches 6, 9-13 remain NOT
> STARTED. Gates at landing: tsc 0, 1715 tests / 0 failed, build clean.
> Next in plan order: 5-remainder → 12 (§9.2 health view first, then
> pods) → 13 → 9 → 10 → 11 → 6.

Gates at audit time: `npm run typecheck` ✅ (RC=0), `npm run build` ✅,
`npm run test` 1634/1635 — the single failure is `tests/skillsGrid.test.tsx`
timing out at 5s under full-suite load (11.5s) while passing 3/3 in
isolation (2.1s): a load flake, not a regression. Raise its timeout or
mark it slow when convenient; not a finding.

| Batch | Status | Evidence / gaps |
|---|---|---|
| 1 Wire layer P1-P7 | **~80% DONE** | P1 ✓ `reasoningControls.ts`; P3 ✓ (rebuttal 2560 now passes the gate; budget clamp `Math.min(max-1, …)` verified); P4 ✓ roster + moderator fallback consult `isProviderOnCooldown`. GAPS → §14: P2 three schedule tiers dead (14-3), P5 audit missing on messages/google transports (14-2), P6 debateFlow wire-shape assertions absent (14-4), P7 read path half-wired + no automatic writers (14-5). |
| 2 Risk + sizing | **DONE except deferred + §14 bugs** | commit defers §3d drawdown floor, §3e stop-discipline, §3g intake interstitial (still true). FTMO preset is a dead export (14-8); day-by-open-time (14-6); pnlPercent conversion (14-7). |
| 3 Detectors + snapshot | **DONE** | all 8 detectors + stop-vs-ATR in `utils/smcStructure.ts`; field-9 CVD parse at `MarketDataService.ts:376,433,497`; cap 1800→2400 at `useAnalysisPipeline.ts:2624,2628`. One ordering risk → 14-9. |
| 4 Debate science | **NOT STARTED** | zero hits for anonymization, COMMIT/DISSENT parsing, log-odds ensemble line, vocabulary ban. |
| 5 Journal + review + memory index | **NOT STARTED** | none of the §4.1 fields exist in `types/trade.ts`; no WeeklyReviewService; §4.7 index-layer injection not done. NOTE: §4.1's MFE needs a close-time field that doesn't exist yet → §15-4. |
| 6 Self-improvement loop | **NOT STARTED** | no fingerprint/episode/distill/judge anywhere in `services/learning/`. |
| 7 Crypto + trust surface | **DONE (committed 2a40613) except two items** | quiet hours ✓ (`utils/quietHours.ts` wired into `PriceAlertService.ts:583` + AlertManager UI), funding carry ✓ (`TradingSignalCard.tsx:219`, snapshot line `HybridIntelligenceService.ts:964`), calibration ledger ✓ (`services/validation/CalibrationLedgerService.ts` + WinRateDashboard), planVersion amendments ✓ (`useAnalysisPipeline.ts:1496-1501` + card chip), copy sweep + disclaimer ✓ (`utils/analysisReport.ts:103-104`, `TradeShareService.ts:284`). MISSING: §5a pre-read capture (`userPriorCall` — zero hits); quietHours has **no tests** (zero hits in `tests/`). |
| 8 Dead-code cleanup §8.0 | **NOT STARTED** — plan says do first | all six orphans still exist (`components/analysis/PriceAlertToggle.tsx`, `desk/SeatCard.tsx`, `journal/MemoryBrowser.tsx`, `journal/PerformanceReview.tsx`, `market/ProbabilityWidget.tsx`, `modals/SkipTradeModal.tsx`); `conductTwoWayDebate`/`conductThreeWayDebate` still at `ensembleService.ts:1315/:1732`. |
| 9 Store unification | **NOT STARTED** | `InsightExtractionService.ts` + `PatternMemorySynthesisService.ts` present and still wired (usePostMortem, JobQueueService, EvidencePackService, MemoryGraph, MemoryRetrievalService). |
| 10-11 Lifecycle hardening | **NOT STARTED** | no prediction/birth-certificate fields on CraftedSkill, no SKILL_LIBRARY_CAP, no FOLLOWED/OVERRIDDEN states, no tombstone/graveyard, no ε-holdout, no Wilson gate, no shadow refinements, no regimeStats on SkillMeta. |
| 12 Seat pods + health | **PARTIAL** | §9.2 first half (roster cooldown) shipped with batch 1; Settings health view NOT built (`getProviderHealth`/`getAllProviderHealth` still zero component consumers); pods NOT started — `slice(0, 5)` still at `EnsembleAnalystService.ts:159`. |
| 13 UI addendum | **NOT STARTED** | `unreadCount`/`markThreadOpened` still have zero component consumers; no Coach bot; no citation chips; no message search; no floor observability. |
| changelog convention | **MISSING** | `changelog.md` newest row is ROUND-39; the four implementation commits (40ab758, cfb4ee3, df83d05, 2a40613) have no rows. |

## 14. Batch 14 — audit-fix batch (v5; do BEFORE further feature batches — these are defects in already-landed code)

> **STATUS: IMPLEMENTED 2026-08-30** (this session). All items landed;
> gates green (tsc 0, build ok, 157 tests incl. new `tests/auditFixes.test.ts`,
> `tests/probeSelfHarm.test.ts`, `tests/quietHours.test.ts`, debateFlow
> wire-shape assertions). Two findings were CORRECTED during implementation:
> **14-6** — `timestamp` is stamped at outcome-capture, so it is already
> close time and correct for P&L/streak/cooldown; the real bug was the
> TRADE CAP using close time — fixed to bucket by `analysis.createdAt`
> (open time) with timestamp fallback. **14-7** — the "double division"
> claim was a miscalculation on my part: `(pct/100)*equity*0.01` equals
> `pct * equity / 10_000`, which IS the documented convention (-200
> leveraged = -$200 on $10k at 1% risk). The real gap was ignoring
> `investmentAmount` when present — fixed via the shared `rowPnlUsd`
> converter (margin = investmentAmount, else risk base), now used by
> BOTH SessionGuard and disciplineAnalytics so they can't disagree.
> 14-5 shipped as: `recordBudgetLessonFromAudit` (P5 audit → budget
> lesson writer, wired at the clarification call site) +
> `formatHarnessNotesBlock` (moderator verdict-context read path). The
> Settings lesson-list UI from 14-5(c) is deferred to batch 13's UI pass.


Every item verified against source at HEAD 2a40613. Severity-ordered.
Gate for the whole batch: typecheck + tests + build; regression test per
fix; one plain commit + changelog row.

**14-1 🔴 Kelly advisory is dead in production (sign error).**
`hooks/useAnalysisPipeline.ts:1791` calls
`kellyAdvisory(wins.length, losses.length, avg(wins), avg(losses))` where
`avg` reduces `t.pnlAmount`, and losses store pnlAmount **negative**
(`components/modals/DataCaptureModal.tsx:81`:
`finalPnl = isWin ? Math.abs(pnlNum) : -Math.abs(pnlNum)`).
`utils/ticketSize.ts:183` gates `avgLossUsd <= 0 → line: ''`, and the call
site only sets `analysis.kellyAdvisory` when `kelly.line` is non-empty —
so the advisory NEVER renders from real journal data. All tests pass
positive literals (`tests/ticketMathTiers.test.ts:44-76`), hiding it.
FIX: pass `Math.abs(avg(losses))` at the call site AND accept negative
input inside `kellyAdvisory` (normalize with abs at entry); add a test
feeding a negative avgLoss. The commit message's "Kelly advisory rides
the journaled history" claim is currently false.

**14-2 🟠 P5 wire audit missing on the messages + google transports.**
`applyReasoningToChatParams`/`onWireAudit` fire only in
`chatCompletionsTurn` (:396-397), `chatCompletionsStream` (:482-483), and
`responsesCall` (:631-632). `messagesCall` (GenericProviderService.ts:526)
and `googleCall` (:686) emit ZERO audit lines (verified: grep count 0 in
both ranges). Claude — the format whose thinking gate P3 just fixed — and
Gemini seats produce no `budget` run-log lines, the exact
200-accepted-but-ignored blindness P5 exists to kill.
FIX: in `messagesCall`, build the `anthropic-thinking` audit entry
(`buildReasoningPatch` already returns it; route exists at
reasoningControls.ts:237-251) and call `options?.onWireAudit?.(audit)`
with the shim's actual decision folded into the reason (thinking block
applied vs below-floor vs jsonMode-excluded); in `googleCall`, emit the
fail-closed `none` label. Extend the P5 test to assert one audit line per
call for all four apiFormats.

**14-3 🟠 Probe can pin off a WORKING provider (self-harm path).**
`services/learning/harnessLessons.ts:205` probes with `maxTokens: 64` at
effort `high`. On thinking-default GLM/DeepSeek, `effort !== 'low'`
enables thinking (reasoningControls.ts:202,223); the model may spend the
64-token budget on reasoning and return no visible "OK" →
`audit.applied && !/OK/` → `honored=false` → `probeAndLearn`'s
`else if (result.audit.applied)` branch (:265-276) records a wire lesson
that PINS THE ROUTE OFF until re-probe — punishing a provider whose knob
worked. (The 400-rejection branch is safe: message contains the knob
field → honored=true.)
FIX: raise probe `maxTokens` to ≥512; treat "knob sent + 200 + no OK" as
INCONCLUSIVE (evidence says so, no lesson recorded) rather than broken —
only pin off on hard evidence (rejection naming the knob, or repeated
transport failure). Also tighten the error heuristic at :221-229:
`message.includes('thinking')` matches unrelated error text; require the
knob field name as a quoted/parameter-shaped token
(`/['"]?thinking['"]?\b.*(not|unrecognized|invalid|unsupported)/i` or
equivalent).

**14-4 🟡 P6 wire-shape assertions in debateFlow tests don't exist.**
Commit 40ab758 claims "wire-shape assertions in debateFlow tests";
`tests/debateFlow.test.ts` has no `reasoning_effort`/`thinking` body
assertions (its `thinking` hits are `openingFromResult` text tests).
FIX: with the mocked transport, assert the outgoing body carries the
translated knob per capability class (xai → `reasoning_effort`, GLM →
`thinking.type`, responses → `reasoning.effort`) and that an unknown
shape sends none of them (fail-closed).

**14-5 🟡 P7 read path half-wired; store has no automatic writers.**
Plan §1.1: lessons "read by roster build, reasoningControls, and the
snapshot assembler." Verified: only reasoningControls reads them (the pin
checker). `lessonsForClass` (harnessLessons.ts:88) and
`isWireRoutePinnedOff` (:137) have ZERO non-test consumers; the only
writer is the manual Settings probe — P5's audit labels never write
lessons, so the store stays empty in normal operation and the
"self-improving" loop is scaffolding.
FIX (small, ships the loop): (a) a `fabrication`/`budget` lesson writer
fed from the P5 audit stream — e.g. when a verdict cites a number absent
from the snapshot (existing echo/fabrication checks in ensembleService
can host it) or when a clarification call ran thinking-ON despite the
low tier (audit says `applied` on a thinkingDefault class); (b) roster
build consults `lessonsForClass('thinkingDefault')` to annotate seats
(the read the plan promised); (c) surface the store in a small Settings
list so lessons are reviewable/clearable (graveyard principle, §8.4a).

**14-6 🟡 SessionGuard measures the day by trade OPEN time, not close.**
`services/validation/SessionGuardService.ts:98-167` keys dayPnl, streak,
and cooldown all on `t.timestamp` — the only timestamp `LoggedTrade` has
(`types/trade.ts` has no close-time field). A trade opened 23:50 UTC and
stopped 00:10 lands its loss on the PREVIOUS day (evading today's
breaker); the 4h post-loss cooldown counts from open, not from when the
loss hit. Plan §3b says "realized day P&L" — realization happens at
close. FIX: add optional `closedAt?: string` to LoggedTrade, stamped at
outcome-capture time in `hooks/useTradeLogging.ts` (fallback to
`timestamp` for historical rows); dayPnl/streak/cooldown prefer
`closedAt`. Pairs with §4.1's MFE field need (§15-4).

**14-7 🟡 pnlPercent → USD conversion is dimensionally wrong.**
`SessionGuardService.ts:105`: `(t.pnlPercent / 100) * equityUsd * 0.01`
divides by 100 twice AND treats a leveraged POSITION percent as a
percent-of-equity. A −50% leveraged autopilot row on $10k equity counts
as −$50 (0.5%), not the real dollar loss — autopilot rows can still
largely escape the guard, contradicting commit cfb4ee3's "can't escape
the guard" claim. FIX: convert through the position, not equity:
`(pnlPercent / 100) * (t.investmentAmount ?? riskBaseFallback)` where
riskBaseFallback derives from the trade's own sizing fields
(`investmentAmount` exists at types/trade.ts:38); when neither is
present, count the row at the configured riskPercent × equity (the
planned worst case) rather than a 100×-deflated number. Test: a
pnlPercent-only row trips the 2% breaker at the right dollar amount.

**14-8 🟡 FTMO preset is a dead export; guard config has no surface.**
`FTMO_SESSION_GUARD` (SessionGuardService.ts:45) has zero consumers;
every call site (App.tsx:695, useAnalysisPipeline.ts:1771,2795) uses
`DEFAULT_SESSION_GUARD` implicitly. Plan §3b "all configurable" unmet.
FIX: persist a `SessionGuardConfig` in harnessSettings (or its own pref
key) with a minimal Settings → Journal row (limit %, trades/day,
cooldown min, preset picker); `assessSession` call sites read it. Cap
changes ride the typed-confirm rule §3b already specifies.

**14-9 🟢 SMC block sits at the END of a head-sliced snapshot.**
The SMC block renders near the end of the hybrid injection
(`HybridIntelligenceService.ts:1025`, after Sweeps/candles/patterns)
while the 2400-char cap is a head-slice
(`useAnalysisPipeline.ts:2624: hybridDataInjection.slice(0, 2400)`) —
under the densest packets the brand-new SMC lines are the FIRST thing
truncated away. FIX: either move the SMC block above the decorative
sections, or make the cap section-aware (never cut mid-`###` block;
append `…truncated` marker). Cheap; do with 14-2.

**14-10 🟢 Cooldown bench is in-memory only + success wipes the window.**
The plan calls it the "persisted-error cooldown"; the error history lives
in a module-level Map (`ProviderHealthService.ts`) — an app restart
clears every bench. Acceptable for v1 IF documented; if the plan's word
"persisted" is meant literally, mirror `recentErrorAts` to Preferences
(throttle writes). Related: `recordProviderSuccess` clears the whole
window, so a success/fail-flapping provider never benches — matches the
plan's "cleared on success" but deserves a one-line ruling in §1.1 P4.
Also the all-benched moderator fallback `|| readyProviders[0]`
(App.tsx:303) silently picks a benched provider — add a console.warn.

**14-11 🟢 Housekeeping.** (a) changelog.md rows for 40ab758, cfb4ee3,
df83d05, 2a40613 (repo convention: plain rows per round; newest is
stale at ROUND-39). (b) tests for `utils/quietHours.ts` (wrap-around
window, equal-hours-off, disabled) — batch 7 shipped untested. (c)
`tests/skillsGrid.test.tsx` 5s timeout under load — raise to 15s.
(d) `requestReasoningSideChannel` (:396,482) sets `include_reasoning` on
deepseek-hosting gateways while the new patch also sets `thinking` —
redundant knobs; harmless on 200-ignoring gateways, note it in
reasoningControls' header so a future probe doesn't read it as a
collision.

## 15. Plan corrections (v5 — the audit found the plan itself wrong here)

1. **§1.1 P1 "Gemini effort slugs" is not a verified route.** The
   implementation fail-closes Google (`reasoningControls.ts:27`: "no
   effort knob"). Either correct P1's list or add the
   `thinkingConfig.thinkingBudget` route as a separate verified item —
   do not let a future implementer treat the plan line as verified.
2. **§3b "all configurable" needs a named surface.** Specify: pref key +
   Settings row + who reads it (this gap is exactly how 14-8 happened).
3. **§8.5a ε-holdout vs §3b removable-limits** — the deliberate
   no-disable holdout contradicts the removable-limits ruling; add one
   explicit line to §8.5a ("no-disable is intentional; §3b's typed
   confirm applies to RISK limits only") so it isn't "fixed" later.
4. **§4.1 MFE needs a close-time field.** `LoggedTrade` has only
   `timestamp` (open). Batch 5 must add `closedAt` (same field 14-6
   needs — land it once, in batch 14, and batch 5 consumes it).
5. **§2 cap-bump wording** should say the cap must be section-aware or
   the SMC block placed high in the packet — a naive head-slice
   silently drops the new detectors (14-9).
6. **§4.4 landmine re-point (§8.0) still pending**: batch 5 targets the
   rendered journal surface, not the dead `PerformanceReview` — reminder
   that batch 8 must land before batch 5 deletes its assumptions.

---

## 16. SESSION HANDOFF (2026-08-30, ~12:15 local) — read this FIRST

A previous session (the "v5 reviewer") audited batches 1-3+7, wrote §§13-15,
then implemented batches 14, 8, and part of 5. **That work is COMMITTED
on `main` as the ROUND-40 commit directly above `8d5eec3`** (35 files,
+2122/−2283), all gates green at commit time: `tsc` exit 0,
`npm run test` **1715 passed / 0 failed**, `npm run build` clean.
changelog.md has the ROUND-40 row describing it.
The user's convention: do NOT commit unless they say so; they batch,
then order one commit.

### State of the tree (verify with `git status` — a twin session edits this repo concurrently)

- **DONE, uncommitted:** batch 14 (all 11 §14 items + tests/auditFixes.test.ts,
  tests/probeSelfHarm.test.ts, tests/quietHours.test.ts, debateFlow wire
  assertions); batch 8 (§8.0 — six orphan components deleted,
  conductTwoWayDebate/conductThreeWayDebate + 5 test blocks removed from
  ensembleService.ts, ~980 lines); batch 5 partial (§4.3 checklist via
  utils/checklist.ts + DataCaptureModal checkboxes + Settings→Harness
  toggle; §4.5 weekly review via services/learning/weeklyReview.ts +
  components/journal/WeeklyReviewCard.tsx + App.tsx boot trigger +
  tests/weeklyReview.test.ts).
- **§14 status block + §13 v5.1 update already record the corrections**
  (14-6 inverted, 14-7 miscalculation) — trust those, not the original
  §14 text.

### What's left, in order (each = its own gated batch: typecheck + tests + build)

1. **Batch 5 remainder** — (a) §4.5 MONTHLY report card + grade-the-panel:
   per-provider + ensemble-line Brier per period; the ensemble line exists
   (debateScience.ts computeEnsembleLine, verdict block in
   ensembleService conductRealDebate ~:4050 post-deletion numbering);
   Brier data lives in ConfidenceCalibrationService +
   ModelPerformanceService; render inside WeeklyReviewCard's tab or a
   sibling card. (b) §5a PRE-READ capture (`userPriorCall`): opt-in,
   commit direction+confidence BEFORE the verdict card reveals, store on
   the message (types/message.ts), show user-prior vs verdict vs outcome
   delta in the journal. (c) §4.7 INDEX-LAYER injection: replace bulk
   GlobalMemory injection in MemoryRetrievalService.getMemoryFilesContext
   with a compact index (skill titles + one-line summaries + status);
   familyPerformance MUST stay injected (six-phase constraint, §4.7);
   eval arms call getMemoryFilesContext({excludeSkillName,
   recordInjections:false}) — keep that signature working.
2. **Batch 12** — §9.2 second half first (Settings provider-health view:
   getProviderHealth/getAllProviderHealth still have zero component
   consumers; add last-error/latency/rate-limit rows to
   components/settings/ProviderManager.tsx list). Then §9.1 LENS PODS
   (6-10 seats → 3 pods; slice(0,5) at EnsembleAnalystService.ts:159;
   verdict transcript cap scales 2400+400×(seats−5); debateFlow tests at
   6/9/10 seats).
3. **Batch 13** — §10.1 unread badges (unreadCount/markThreadOpened in
   utils/agentThreads.ts:197-223, wire into AgentRosterRail rows +
   markThreadOpened on thread focus — pure wiring); Coach-thread inbox +
   citation chips + message search + per-message context disclosure;
   §10.2 floor observability (seat desks show thinking/effort/cooldown
   from P5 labels + §9.2 health; sealed-auction dot plot; guard state on
   Big Board; pin seat bubble). Also §14-5(c) deferred: a small Settings
   list to browse/clear harness lessons.
4. **Batch 9** — store unification (§8.1): migrate
   generateMandatoryPatternCheck consumer FIRST
   (useAnalysisPipeline.ts ~:2301 pre-deletion numbering — re-anchor!),
   snapshot-test identical gate verdicts, then fold
   InsightExtractionService + PatternMemorySynthesisService into the
   notebook.
5. **Batches 10-11** — lifecycle hardening (§8.2-8.5) exactly as written.
6. **Batch 6** — self-improvement loop A→E (§4.6); §8.3a/§8.4a/§8.5a ship
   inside its Phase E per the sequencing note.

### Pitfalls for the next agent (learned the hard way)

- **Anchor drift:** §§1-15 file:line anchors reference HEAD 2a40613/
  8d5eec3. ensembleService.ts SHRANK ~980 lines (batch 8 deletions) —
  anything cited after line ~1316 there is stale; re-grep before editing.
- **Redaction artifact:** tool output masks `config.apiKey?.trim()` as
  `config...im()` / `config ***`. The line at harnessLessons.ts:202 is
  CORRECT on disk — do NOT "fix" it from a masked read; verify with
  `od -c` or python repr before patching anything that looks corrupted.
- **jsdom hostname:** tests calling sendChatRequest directly must
  override window.location.hostname (pattern in tests/auditFixes.test.ts
  + warmProviderConnection.test.ts) or they hit the /__provider_proxy
  dev branch and fail confusingly.
- **Twin sessions:** the user runs parallel agents on this repo. Re-run
  `git status`/`git log` before starting AND before each commit; if files
  you're about to touch are dirty with someone else's edits, stop and
  ask. Commit messages claiming "wired at all call sites" have been
  wrong before (see §14) — verify claims against source, including your
  own.
- **Tests:** losses store pnlAmount NEGATIVE; pnlPercent is a LEVERAGED
  position percent (convert via rowPnlUsd, never percent-of-equity);
  vitest default timeout is 5s and the full suite runs ~30s — UI tests
  under load need explicit timeouts.
- **Style:** monochrome zinc theme (status-surface scope only for real
  status colors); all functions typed; AGENTS.md conventions apply;
  plain changelog row per round (ROUND-41 next).

---

## 17. SESSION HANDOFF (2026-09-01) — post-batch audit + review fixes

**Read §16 above for history; this section is the CURRENT state.**

All plan batches (5–14) are now implemented AND audited. The audit
(ROUND-48, changelog.md) re-verified every claim against source and fixed
seven wiring/logic defects plus two P0 dead surfaces. Full detail lives in
the ROUND-48 changelog row and `.hermes/plans/harness-review-fix-plan.md`.

- **State:** UNCOMMITTED on `main` (HEAD still `0787668`), ~130 dirty files.
  Gates at handoff: tsc 0, **1861 passed / 11 skipped / 0 failed**, build
  clean, eslint 0 errors on touched files.
- **The §8.3a join is now EXACT-runId** (`trade.sourceRunId` ↔
  `MemoryInjectionRecord.runId` ↔ `runStats.runId`). Any future attribution
  code must join on runId — never a time window around trade.timestamp
  (that was the inverted-join bug: the run predates the log click).
- **Learning queue** (`utils/learningQueue.ts`) finally has its consumer:
  `components/settings/LearningQueuePanel` in Settings → Skills. New
  proposal kinds MUST render there (unknown kinds fall back to a generic
  card + Dismiss). Apply paths: displacement/revival/demote actuate;
  rescope/contradiction are human-edit prompts by design.
- **Birth certificate** is live: deriveStatus + recordEvalVerdict consume
  `evaluateClaim`. A skill's claim now gates promotion — when tuning
  thresholds remember an unmet claim blocks confirmed tier.
- **Remaining scope (user go-ahead needed):** NONE — §10.1 Coach thread +
  message search landed in ROUND-49 (Coach row in the rail,
  CoachThreadPanel as the learning inbox, roster search filters by thread
  content). Reference-parity UI pass (ROUND-49): SelectMenu replaces every
  native <select> in chat surfaces; monochrome violations fixed.
- **Pitfalls still true:** twin sessions edit this repo concurrently
  (re-check `git status` before touching); ensembleService anchors drifted
  ~980 lines; apiKey?.trim() masks in tool output but is fine on disk;
  jsdom tests hitting sendChatRequest need the hostname override.
- **Next action when the user says done:** ONE commit for the whole
  ROUND-41→48 batch (their convention: accumulate, commit once on order).

---

## 18. SESSION HANDOFF (2026-09-01 → 09-03) — Bot Mode G1–G5 + team seat roles

Full mechanism map + port plan: `.hermes/plans/botmode-scan-and-plan.md`
(read that file first — it is the scan). Summary of state:

- **ROUND-52 (latest)**: the stale "max 3 providers" Standard-mode cap
  was removed (now mirrors `TEAM_MAX_SEATS` = 10; pod tier already
  handles 6+). Teams gain per-seat **roles** (Macro/Technical/Risk
  inherit their built-in debate prompts, editable) + optional trader
  instructions; unroled seats default to the general-analyst mandate
  (full-scope market analysis, best actionable signal, desk tools +
  web search — `web_search` is a registered desk tool). Personas ride
  openings (`seatDirective`), rebuttals (`conductRealDebate`
  `seatPersonas` keyed by seat name — a replacement inherits the
  dropped seat's persona under its own name), and tool scope
  (`defaultToolsForRole`). New: `services/agents/seatPersonas.ts`
  (`seatPersonaPrompt` / `builtInPromptForRole` / `seatHasPersona`).
  Rail avatar stacks no longer bleed over team names. Gates: tsc 0 ·
  1948 passed / 11 skipped · build clean · eslint 0 errors. Ad-hoc
  (teamless) ensembles keep the legacy mandate rotation byte-identical.
- **ROUND-51**: Bot Mode G2–G5 done (rooms, attention badges, mentions,
  bot Routines) — see changelog; G1 (DMs) was ROUND-50.

- **Scanned**: Hermes Bot Mode at source level (desktop plugin
  `apps/desktop/src/plugins/hermes-bots/`, core `tools/bot_mode_probe.py`
  / `bot_mode_dm.py`, file relay `tools/bot_relay.py`, AGENTS.md §Bot
  Mode) and Grok Bot (xAI beta: persistent named "AI teammates" sharing a
  cloud computer, texting each other). The transferable DNA: named
  teammates + texting-style async delegation + bot↔bot coordination +
  bounded rounds with silence as an outcome.
- **G1 BUILT (ROUND-50)**: `services/agents/botMailbox.ts` (pure: marker
  grammar, handle resolution, validateDM refusals, teammate protocol,
  buildBotSystemPrompt) + `hooks/useBotMailbox.ts` (per-target serial
  queues, TTL 15min, 12/min budget, 3-hop cap, wake-up notices). The
  pipeline's casual branch now runs bot-thread sends AS the bot (exact
  provider+model, persona prompt, thread-scoped history) and hands the
  settled reply to the mailbox. 20 new tests; gates green.
- **Key invariants to preserve**: (1) DM markers are stripped from the
  bubble BEFORE the text persists — the model composes, the harness owns
  delivery + attribution; (2) refusals are always VISIBLE notices in the
  sender's thread (never silent drops); (3) the reply wakes the sender as
  a notice — never auto-runs the sender (storm guard = hop cap + budget);
  (4) the protocol section is byte-stable per roster (prompt caching);
  (5) outside bot threads the pipeline is behavior-identical to pre-G1.
- **Not ported (deliberate)**: cross-connection relay/socket layer
  (august's bots are in-process), session-id pins (derived threads are
  already the post-incident design), per-bot session browsers.
- **G2–G5 BUILT (ROUND-51)**: G2 real room coordination
  (`services/agents/groupRounds.ts` — bounded rounds + `(pass)` silence +
  deterministic mention routing + per-member incremental context;
  `useAgentGroups` rewritten onto the engine; `Message.hidden` + filter),
  G3 needs-attention badges (`services/agents/botAttention.ts` + ⚠/tooltip
  in AgentRosterRail), G4 roster-derived @mention chips in ChatInput
  (`botHandle()`, un-gated from ensemble), G5 bot-scoped Routines
  (`AutomationConfig.botId?` + `services/agents/botRoutine.ts` pure
  executor — runs AS the bot: persona prompt, its provider/model, reply
  into its thread, markers → mailbox; visible skips for dangling
  bot/provider/prompt; editor "Run as bot" SelectMenu + rail Routines
  disclosure; App bridges roster getter + mailbox DM delivery).
- **Gates at handoff**: tsc 0 · 1936 passed/11 skipped · build clean ·
  eslint 0 errors (whole dirty tree). COMMITTED as 03d4451 on main
  (ROUND-41→51, one commit per convention; pre-commit review: static
  scan clean, 4 stale eslint-disable exhaustive-deps errors fixed,
  vitest testTimeout raised to 15s — heavy jsdom files hit the default
  5s per-test timeout only in full runs, clean-HEAD stash bisect proved
  a scheduling edge, not regressions). Not pushed.
