# Changelog

Plain-English log of change rounds. Newest first.

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
