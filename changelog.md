# Changelog

Plain-English log of change rounds. Newest first.

---

## ROUND-34 — Graph-scored ranking, temporal skill ledger, per-seat controls, jobs drawer

The four queued deep-scan items, implemented together:

**Graph-scored skill ranking (M3 reconciliation).** `rankedMatchedSkills`
now scores every matched skill as status weight (confirmed 2 / candidate 1)
× setup-dimension overlap × evidence-freshness decay (120-day constant,
same as MemoryGraph). The dashboard graph and production retrieval can no
longer disagree about what matters. The M3 conflict is resolved by design:
moderators keep seeing skills through audience filtering (index tier at
verdict), not exclusion.

**Zep-style temporal ledger.** Skills carry a `history:` frontmatter array —
every status transition stamps validFrom → invalidAt with a reason
(evidence / eval hurts N/M / manual). Demotions and retirements close the old
era instead of erasing it; `skillStatusAt(meta, timestamp)` answers "what did
I believe at this moment?" for replay audits. Wired into evidence-driven
status derivation, eval 'hurts' demotions, and manual retire/restore.

**U3: per-seat Steer/Stop.** Hover a live actor bubble on the debate stage:
the paper-plane queues a note that rides ONLY that seat's next prompt
("**USER STEERING — DIRECTED AT YOU**"), the square benches the seat at the
next round boundary (drop path reuses the tested transcript purge). Both flow
through new engine hooks (`getSeatSteeringNote`, `shouldDropSeat`) and the
pipeline exposes `handleSteerSeat` / `handleStopSeat`.

**U4: Jobs drawer.** Header "Jobs" button opens a right drawer (Hermes
status-stack pattern): live job queue rows (insight extraction etc., with
status + error) and the 20 most recent skill audits with their verdicts.
Background autonomy becomes visible instead of fire-and-forget toasts.

Also: lint error in ChatArea hero greeting fixed (useless assignment).
Tests: `tests/temporalLedger.test.ts` covers transition stamping, replay
queries, and frontmatter round-tripping.

---

## ROUND-32 — Root-cause failure patterns in the evidence pack (2026-08-23)

The first production payoff from the graph-engineering research (GraphRAG /
Zep / LightRAG): the memory system's root-cause classification — which until
now only fed the dashboard graph — surfaces as a **high-level failure-pattern
line** in the verdict evidence pack.

When a coin+direction cluster has ≥4 admitted technical losses and ≥50% of
them classify as SETUP_EDGE_FAILURE, both the moderator's prompt block and the
card's evidence panel now say so explicitly: *"Failure pattern: 3/4 of your
admitted BTC Short losses are SETUP_EDGE_FAILURE — the setups themselves, not
execution or macro shocks. Tighten entry criteria before trusting this class
again."* Execution errors and macro shocks never fire the line (they don't
admit edge lessons), small samples stay silent, and the card renders it in the
status-surface scope.

This is LightRAG's dual-level idea in miniature: seats reason at low level
(specific skills, similar trades); the arbiter now also gets one high-level
line summarizing what the cluster's cause nodes say — no new infrastructure,
just reading data that already existed.

---

## ROUND-31 — Memory honesty fixes + composer declutter (2026-08-23)

**Edge decay now actually reaches prompts (M1).** The 120-day exponential
decay documented in ROUND-26 lived only in the dashboard's memory graph —
`getMemoryFilesContext` fed prompts from raw similarity. `findRelevantTrades`
gains a `decayByAge` option and both prompt consumers (similar-trades block,
verdict evidence pack) now use it: old trades still appear with their lessons,
but at honest reduced weight, and can no longer crowd out fresh evidence.

**Bot memory respects the setup (M2).** `getBotMemoryContext` ignored its
query entirely (`void query`). Bot notes are now line-filtered to this
coin/regime: matching lines and general lessons pass, other-coin-specific
lines are dropped, persona blocks always pass. Multi-bot merges are capped at
1,800 chars total so N bots can't balloon the analyst prompt outside the
stage-budget discipline.

**Provenance counter (M4).** Skills serialize a monotonic `evidenceCount`
frontmatter field; the verdict block's "learned from N logged trade(s)" now
reads it instead of the tail-20 tradeIds list, which silently capped long-lived
skills at 20 forever.

**Composer declutter (from screenshot audit).** The nine-chip suggestion row
(@roles, debate templates, skill slugs) collapses behind one "Templates ▾"
toggle — the default composer is text + attach + Team + send, DeepSeek-minimal.
The duplicate footer "Team" chip is suppressed (the composer dropdown already
carries that control); overflow counting uses visible chips only.

Verified: typecheck, 1106 tests, lint, build all green. New suite
`tests/memoryHonesty.test.ts` pins decay math, bot-note filtering, and
evidence-count round-tripping.

---

## ROUND-29 — DeepSeek-parity chat polish (2026-08-23)

Component-by-component comparison against the DeepSeek harness UI (thinking
row, settled turn, composer) drove three polish items — all view-layer:

**Quiet model byline.** Every settled AI bubble now ends with a whisper line:
`Macro · Technical · Moderator · 41s` (seat roster from the run ledger +
wall-clock duration). This is the exact "DeepSeek-R1 · 12s" convention —
previously august buried model names inside a details table.

**One container language.** New shared `AuditPanel` wrapper; the run-contract
panel, evidence-pack card, and used-notes strip all render through it, so a
stack of audit surfaces reads as one grouped system instead of five competing
boxes. Same radius/border/background everywhere.

**Chip-bar overflow.** Past three active context chips above the composer,
the tail collapses into a single `Context · N ▸` summary with a hover/focus
popover listing the hidden chips. No second toolbar row, no portal, no deps.

Verified matches (no change needed): `ReasoningRow` already implements the
DeepSeek thinking row exactly — live expand while streaming, scroll-pinned
latest-line ticker, collapse to "Thought for Xs" on settle, plain-text body
while running and markdown on settle. Hover-copy affordance also matched.

---

## ROUND-28 — Arbiter evidence, setup-stats tool, run contract UI (2026-08-23)

**The moderator can finally see its own journal.** `getModeratorAnalysisStream`
now accepts the trade log, so the `recall` desk tool works at every moderator
surface (clarification questions, judgment, verdict, accuracy verification,
post-mortem debates) — previously only analysts had history and the arbiter
recalled nothing.

**Arbiter tool policy.** The moderator's default desk is now memory + context
(`recall`, `get_setup_history_stats`, session, web search). Order-book and
derivatives data no longer reach the binding verdict by default — argument
quality decides, not wall noise.

**New desk tool: `get_setup_history_stats`.** Any seat can check a claim like
"this setup usually fails" against the real journal: sample size, win rate,
average R, last outcome, worst lesson for a coin+direction cluster. Honest
"no logged trades" when the sample is empty.

**Verdict evidence pack.** Before the moderator writes the verdict, a compact
block is assembled automatically: this desk's record on the setup, top similar
closed trades, matched notebook skills, doctrine header. The binding decision
no longer depends on the moderator remembering to call recall.

**Run Contract panel.** Every debate card shows its stage ladder as a live
todo — Gate scan → openings → rebuttals → clarification → verdict — derived
from the existing run log. Skips are honest and labeled ("USD budget cap
reached", floor alignment), so a lopsided-floor verdict is visible instead of
silent. Frozen into the finished card for replay audits.

**Evidence pack card.** The settled verdict card shows what the arbiter's
evidence pack contained: journal record line, similar trades with lessons,
matched skills with freshness, doctrine header. Prompt-side block and UI card
show the same data.

**Chat surface color pass.** Post-mortem headers, live post-mortem stream and
the hybrid session panel dropped their purple/indigo accents back to the
charcoal + steel-blue theme; the strategy auto-discover button joins the accent
family properly.

Also: skill injection credit is scoped to each trade's time window (one old
injection no longer upgrades credit forever); the dead Bayesian calibration in
post-mortem debates is wired into the transcript; README rewritten to describe
this repo.

---

## ROUND-26 — Seat trust, provenance, edge decay (2026-08-22)

**Seat-trust weighting.** The moderator verdict prompt now includes each seat's historical record: Brier calibration score, overconfidence gap, and average sealed conviction from stored debates. Seats with proven accuracy are flagged trustworthy; overconfident seats get an explicit discount instruction when they dissent from better-calibrated peers. Data comes entirely from the existing trade log.

**Skill provenance.** Verdict-stage skill blocks now state what they were learned from ("learned from 7 logged trade(s)") alongside freshness, so the model knows both how old and how well-evidenced a rule is.

**Per-skill lift measurement.** New `MemoryProvenanceService` computes whether a skill actually improved outcomes: win rate on matching setups *after* the skill existed versus before it. Positive lift = the skill helps; negative = it misleads despite plausible evidence. Surfaced in the Learning Dashboard Skills card (`lift +12pp`) and folded into its color coding.

**Memory-graph edge decay.** `similarTo` edges now fade with trade age (~120-day exponential half-life). Old associations stop surfacing without deletion — the same decay philosophy applied to skill counts in ROUND-24m, extended to the graph.

**Settings: audience toggle.** Skill files in Settings → Memory files show an `audience:` button cycling all → analyst → moderator, controlling which debate audience may load them.

Also: changelog.md created (this file).

---

## ROUND-25c — Fully-automated skill self-evaluation (2026-08-22)

The harness audits its own knowledge with zero user action:

- After every trade-log sync, one due confirmed skill gets an A/B eval (re-analyze up to 6 of its matched historical trades with the skill on vs off).
- Due policy: enabled + confirmed, ≥3 matched trades, ≥10 closed trades since last eval, ≥24h cooldown. Max 2 auto-evals per session.
- Verdicts stamp into frontmatter (`evalVerdict: helps (3/3)`, `lastEvalAt`).
- **Causal override:** a `hurts` verdict demotes a confirmed skill to candidate on the next evidence pass. Injection-causation outranks outcome correlation.
- Doctrine staleness header: `(beliefs last consolidated around trade N)` injected above doctrine so models know how current their convictions are.

The loop is closed end-to-end without human intervention: write → count evidence → confirm → A/B verify → demote if harmful → re-verify later.

---

## ROUND-25 / 25b — Progressive disclosure + eval engine; IF/THEN removal (2026-08-22)

- **modified:** timestamps on every skill write; injection surfaces human-readable freshness ("evidence 12d old").
- **Tiered skill injection:** openings/rebuttals get a one-line index (`AVOID [confirmed · 1W/6L · …] IF…THEN…`); verdicts + recall serve full bodies.
- **audience frontmatter** (analyst/moderator/all) controls which debate seat may load a skill.
- **Dynamic context:** `${SYMBOL}`/`${REGIME}`/`${DIRECTION}` substituted live at assembly.
- **SkillEvalService**: with-skill vs without-skill benchmarking engine (deterministic flip scoring).
- **IF/THEN rules system removed** (ROUND-25b + completion): post-mortem lessons flow only through skills; validation-gate structured rules retired; CONFIDENCE_RULES safety rails kept as constants; legacy rule data migrates mechanically to candidate skills.

---

## ROUND-24m — Memory simplification (2026-08-22)

Fewer, truer memories:

- Hard stage budgets (opening 900 / rebuttal 400 / verdict 600 chars) with ranked fill order; doctrine has its own always-on slot.
- Diary = raw storage, never injected.
- Recurring-mistakes lines go quiet once a skill owns the cluster.
- Similar-trade history moved to verdict-only.
- Skill refinement slowed (3 consecutive losses spanning ≥48h); doctrine rewrite every 15 trades with ≥⅔ carry-forward.
- Evidence decay: counts halve when >30 days stale or earned in a different regime.
- IF/THEN rules retired from prompt injection (folded into skills).
- `recall` desk tool: debate seats pull their own memory on demand instead of receiving bigger prompts.

---

## Earlier rounds

See git history for rounds before ROUND-24m (Brier calibration summaries, skill effectiveness review, debate upgrades B1–B4, memory-as-own-knowledge voice work, UI surfacing).
