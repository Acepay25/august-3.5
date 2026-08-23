# FAMILY SYSTEM PLAN — Evaluation & Migration Proposal

**Date:** Aug 23, 2026
**Scope:** Deep-dive on how "Family" (A / B / C / Omega) is used across August 3.5, and whether it should be converted into skills.
**Constraint:** Suggestions only — no code changes in this pass. Every claim below is verified against source with `file:line` references.

> **Merged 2026-08-23:** Consolidated into `MASTER_IMPROVEMENT_PLAN.md` (Parts II, V, VI–X). Kept for reference; F0–F4 IDs are stable there.

---

## Part 1 — Verified Usage Map

"Family" is not one system. The codebase runs **four overlapping concepts under one name**, and any
migration decision has to treat them separately.

### 1.1 Prompt taxonomy (`TRADING_FAMILIES_PROMPT`)

- Defined at `constants/prompts/analysisPrompts.ts:322-373`. Four families with nicknames,
  "personalities", indicator features, and **outcome-tendency claims**:
  - Family A "Low win rate for continuation setups" (:338)
  - Family B "Win rate improves with high-volume confirmation" (:349)
  - Family C **"Highest win rate (~86%). Source of most profitable trades."** (:360)
  - Omega "Very high continuation probability. Requires wider SL." (:372)
- Injection points (verified):
  - **Pure AI mode, toggle-gated:** `GenericAnalysisService.ts:368-370` (`familiesContext`, requires
    `isFamiliesEnabledInPureAI`; toggle default **false**, `useAppSettings.ts:36`; UI at
    `SettingsMenu.tsx:697-701`, only visible in Accuracy → Pure AI).
  - **Real debate path, toggle-gated:** `ensembleService.ts:1146-1147` inside `conductDebate`
    (JSON-output directive: "detectedPatternFamily must be Family A/B/C/Omega").
  - **Simulated debates, ALWAYS ON:** two-way debate prompt (`ensembleService.ts:1503` Section 3 +
    `:1515-1521` moderator enforcement + family definitions block) and three-way debate prompt
    (`:1996` Section 3, `:2004-2010` enforcement + definitions). These are unconditional.
  - **Standard mode: NOT injected.** `PROMPTS.md:18` claims Standard composition includes
    `TRADING_FAMILIES_PROMPT`, but the appended-blocks builder at
    `GenericAnalysisService.ts:405-422` contains no families entry. PROMPTS.md is stale here
    (consistent with the earlier P0 doc-drift finding). Same staleness in the registry note at
    `promptRegistry.ts:100-102` ("usage: Pure-AI analysis, Moderator prompts" — accurate; but
    PROMPTS.md's Standard-mode row is wrong).
- Registry override key: `analysis.families` (`promptRegistry.ts:100-102`), consumed via
  `getPrompt('analysis.families', …)` at both injection sites.

### 1.2 Label assignment — three competing writers of `detectedPatternFamily`

The schema field is free-text: `schemas/tradeAnalysis.ts:187` (`z.string().optional()`), coerced at
`:409`, bridged at `:561`. It gets populated by whichever path fires first:

1. **LLM self-report** — the model returns `detectedPatternFamily` in JSON (enforced only when the
   Pure-AI toggle or debate directive asks for it).
2. **Markdown prose parse** — `parseMarkdownTradePlan` extracts `Pattern Family:` from the rendered
   markdown (`utils/analysisUtils.ts:575`) and writes it back at `:768`
   (`detectedPatternFamily: plan.patternFamily`). Tests confirm the contract
   (`tests/analysisUtils.test.ts:34,253`).
3. **Substring fallback miner** — if still empty, `schemas/tradeAnalysis.ts:624-629` scans
   `marketConditions.pattern` for `"FAMILY A|B|C"` / `"OMEGA"` substrings.

Plus a fourth writer that **never wins**:

4. **Deterministic classifier** — `services/analysis/PatternClassificationService.ts` computes
   `PatternFamily` from weighted indicator scores (e.g., A: rsiExtreme 30 + divergence 40 +
   volumeSpike 15 + wickRejection 15; C: trendAlignment 35 + pullbackRSI 25 + adxStrength 25 +
   emaRespect 15) into `{family, confidence, scores, reasoning}`. Its **only consumer** is
   `HybridIntelligenceService.ts:52-54`, which renders it as a hybrid-data table row
   ("Regime / family / confluence", `HybridIntelligenceService.ts:853-871`: family, confidence %,
   per-family scores). **It is never written back into `detectedPatternFamily`.**
   → Result: the journal's family coordinate is whatever the LLM said that day, while a code-side
   classification of the same setup sits unused in a different channel. Double bookkeeping.

### 1.3 Consumers of the label (memory coordinates & measured stats)

Everything downstream keys off the free-text label via several independent normalizers:

| Consumer | What it does | Where |
|---|---|---|
| Skill clustering | cluster key `coin\|dir\|family`; skill meta `family:`; filename slug | `SkillMemoryService.ts:745, 318, 291-292` |
| Skill matching | `familiesRelate` negation-aware match, +2 hits toward threshold ≥2 | `SkillMemoryService.ts:230-231`, `utils/patternMatch.ts` |
| Avoid-skill lookup | `confirmedAvoidForSetup({coin,direction,family,…})` | `SkillMemoryService.ts:986-989` |
| Memory retrieval | `query.family` passed to similar-setup search | `MemoryRetrievalService.ts:81, 271, 296` |
| Bot skill filter | `bot.skillFilter.families` gates which skills a bot may see | `BotMemoryService.ts:118-127` |
| Gate pattern-memory penalty | same-family recent loss ⇒ −0.15 bias + penalty reasoning | `GateKeeperService.ts:215-219` |
| Gate familyBias heuristics | HTF conflict ⇒ A/B +0.10, Ω −0.15 (:245-248); missing TFs ⇒ Ω −0.20 (:163) | `GateKeeperService.ts:113-248` |
| Gate reconciliation (debate) | renders ±% family bias into reconciliation block | `ensembleService.ts:255-264` |
| Debate context | "Family Bias:" line in analyst context | `ensembleService.ts:2094` |
| Live backtest similarity | `familyKey()` regex normalization; +20 exact / +15 normalized same-family | `LiveBacktestService.ts:102-109, 180-192` |
| Scenario simulator | family match bonus (lowercase `includes`) | `ScenarioSimulatorService.ts:200-204` |
| Stop-loss optimizer | `byFamily` SL multipliers, applied when sampleSize ≥ min | `StopLossOptimizerService.ts:36, 185, 194-197` |
| Model performance | per-provider `byFamily` win rates → dynamic weight bonus (0-20 pts) + "**FAMILY SPECIALIST:** X has highest win rate…" debate context | `ModelPerformanceService.ts:462-471, 574-578, 755-763` |
| Learning extraction | multi-fallback `extractPatternFamily` (detected→patternFamily→marketConditions→strategy keywords) | `SelfLearningService.ts:109-130` |
| Trade validation gate | +25 similarity for same-family loss | `TradeValidationGate.ts:235-237` |

**Not a consumer:** Monte Carlo (`monteCarlo.worker.ts` / `MonteCarloService`) — zero family coupling.

### 1.4 Normalizer duplication (four ways to compare two family strings)

- `familiesRelate` (`utils/patternMatch.ts`) — negation-aware word-segment overlap.
- `familyKey` regex map (`LiveBacktestService.ts:102-109`) — keyword buckets (exhaustion/trap→a,
  reversal→b, continuation→c, omega→omega).
- `mapFamilyToKey` (`ModelPerformanceService.ts:468`) — its own bucketing.
- `SelfLearningService.extractPatternFamily` (`:113+`) — fallback-chain extractor.

Same underlying question ("do these two labels refer to the same family?") answered four different
ways with four different failure modes.

### 1.5 UI surfaces (user-visible family features)

- `WinRateDashboard.tsx:116-351` — "Pattern Families" cards with live WR per family
  (`calculatePerformanceByFamily`), fixed color map incl. a fix comment for A/C color collision (:35-52).
- `StrategySearch.tsx:237-260` — "Market Classification Families" accordion rendering
  `FAMILY_UI_DATA` (`constants/models.ts:20+`) **overlaid with live journal win rates**
  (`familyWinRates` prop) — i.e., the UI already shows measured stats next to the taxonomy.
- `SettingsMenu.tsx:683-701` — Pattern-Families toggle in Pure-AI context panel.
- `LearningDashboard.tsx:225-227` — similar-setups summaries include family.
- `VersionHistoryDashboard.tsx:343`, `BacktestResults.tsx:169`, `ModelPerformanceDashboard.tsx:34-360`
  (currentFamily prop feeding dynamic weights).

### 1.6 Gate Scan `allowedFamilies` — ceremony

`GateKeeperService.ts:98` hardcodes `['A','B','C','Omega']` with the comment "ALL families are
ALWAYS allowed - no exclusions"; Stage-1 prompt says "NEVER exclude"
(`analysisPrompts.ts:256`, `PROMPTS.md:420`). The only functional values are the degenerate ones
(`[]` when data fetch fails, `:140/:526/:607`). Stage-2 prompts instruct choosing "EXACTLY ONE from
the Gate's allowedFamilies" (`PROMPTS.md:491-497`) — a constraint that can never bind.

---

## Part 2 — What Works Well (do not break)

1. **Family is a cheap, shared coordinate.** One string joins debates ↔ skills ↔ dashboards ↔ bots ↔
   gate heuristics. Removing it would orphan ~9 subsystems and every historical journal row.
2. **Measured family stats already exist end-to-end.** Journal → `familyWinRates` (UI overlay in
   StrategySearch), `StopLossOptimizerService.byFamily` (SL multipliers), and
   `ModelPerformanceService.byFamily` (per-provider specialists feeding ensemble weights). This is
   exactly the evidence loop Claude/Hermes lack — it just isn't wired back into the prompts.
3. **Negation-aware matching** (`familiesRelate`) correctly keeps `fake-breakout` apart from
   `breakout` — a subtle property worth preserving in any normalization consolidation
   (`tests/patternMatch.test.ts` covers it).
4. **The deterministic classifier exists.** The hardest part of label canonicalization (weighted
   scoring + reasoning traces) is already built and tested-adjacent; it's just not connected to the
   write path.

---

## Part 3 — Problems

| # | Severity | Problem | Evidence |
|---|---|---|---|
| P1 | High | **Fabricated outcome claims anchor every debate.** "~86% highest win rate" and friends are static prompt text presented as fact, while the app's own measured numbers sit unused one layer away. If your journal says Family C wins 54%, the prompt is injecting a false prior into openings, rebuttals, verdicts, and post-mortems. | `analysisPrompts.ts:338,349,360,372`; injection map §1.1 |
| P2 | High | **Label provenance chaos.** Three competing writers (LLM JSON, prose parse, substring miner) decide the journal coordinate; skill clusters, avoid-vetoes, gate penalties, SL optimization, and model weights all inherit the noise. An LLM that says "Family Omega" once creates an Ω-clustered skill from what the classifier would call C. | §1.2 |
| P3 | Medium | **Deterministic classifier is dead-end double bookkeeping.** Computed, rendered in hybrid data, never reconciled with the journal label — so you can't even measure how often the LLM disagrees with the code. | `HybridIntelligenceService.ts:853-871` vs no write-back |
| P4 | Medium | **Four normalizers, four semantics.** Exact-match vs negation-aware vs keyword-bucket vs fallback-chain. Cross-service family comparisons are inconsistent by construction. | §1.4 |
| P5 | Low | **`allowedFamilies` is unfalsifiable ceremony.** Always full list; costs tokens and implies a gating function that doesn't exist. | `GateKeeperService.ts:98` |
| P6 | Medium | **Classifier weights are themselves unvalidated guesses.** Promoting the classifier to canonical label authority without calibrating its weights against outcomes just relocates the fabrication problem from prompt-text to code. | `PatternClassificationService.ts` WEIGHTS |
| P7 | Low | **Doc drift.** `PROMPTS.md:18` (Standard-mode composition includes families) contradicts `GenericAnalysisService.ts:405-422`. Already covered by the known PROMPTS.md-staleness P0; this is a concrete instance. | §1.1 |

---

## Part 4 — The Core Question: Should Family Become Skills?

### Short answer

**No — not wholesale. Yes — for its advice content.** Family should be demoted from
*"prompt-baked truth"* to *"measured memory coordinate"*, and its outcome-tendency/playbook claims
should be reborn as draft skills subject to the same evidence gates every other claim must pass.

### Why not wholesale conversion

Skills and families are different layers:

- A **skill** is a falsifiable procedural lesson keyed BY coordinates (`coin|dir|family`),
  gated on evidence (cluster ≥3, n≥5 WR thresholds, decay, A/B eval) — `SkillMemoryService`.
- A **family** is a classification dimension — a column, not a row.

Converting "Family C" into a skill produces a skill with no trigger conditions distinct from its own
key, competing with real skills for retrieval budget, and duplicating what `WinRateDashboard` and
`StrategySearch` already show better. You'd also break bot filters (`skillFilter.families`), all
historical clusters, and every dashboard query — high migration cost, near-zero epistemic gain.

### What "turn into skills" SHOULD mean

Three conversions, all reusing existing machinery:

1. **Claims → seed skills.** Each outcome-tendency line becomes a draft skill:
   - *"In Family Ω conditions (volume expansion + range break + momentum surge), widen SL ×1.3"* —
     seeded with `status: 'draft'`, promoted only after the standard cluster/n≥5 evidence gates.
   - The SL-optimizer already measures this (`byFamily.multiplier`) — the seed skill can cite it.
   - Net effect: family advice becomes **falsifiable**. If Ω trades don't need wider stops in your
     journal, the skill retires instead of anchoring prompts forever.
2. **Static prompt text → measured stats block.** Replace the "Outcome Tendency" lines with a
   runtime-injected block built from existing calcs:
   - `Family C: 14 trades · 57% WR · avg 1.8R · last 90d (your journal)`
   - plus the ModelPerformanceService specialist line it already generates
     (`:755-763`). Zero new computation needed — `familyWinRates` is already computed for the UI.
3. **Label authority → deterministic classifier, LLM demoted to fallback.** After calibration
   (F1 below), `PatternClassificationService` output writes the canonical `detectedPatternFamily`;
   the raw LLM string is preserved in a separate provenance field for audit and agreement metrics.

### Why this is strictly better than status quo *and* better than deletion

- Status quo: fabricated priors + noisy labels. Deletion: loses the shared vocabulary that makes
  cross-debate/memory/UI coordination cheap, orphans 9 consumers.
- Target state: same vocabulary, but every quantitative statement about a family is derived from
  your journal, and every qualitative claim must earn skill status through the evidence gates —
  the harness's core moat, extended to its own oldest prompt constant.

---

## Part 5 — Phased Migration Plan (suggestions)

### F0 — Instrument before touching anything *(no behavior change)*

- Add label provenance: wherever `detectedPatternFamily` is finalized, record which writer won
  (`llm_json | markdown_parse | substring_fallback`) and, when hybrid data exists, the classifier's
  family. Store alongside the trade (new optional field; schema addition only).
- Log agreement rate classifier-vs-LLM over N analyses.
- **Accept:** typecheck/tests/build green; no prompt or matching behavior change;
  agreement metric visible in logs/dev console.

### F1 — Prompt hygiene (kills P1, P7)

- Rewrite `TRADING_FAMILIES_PROMPT`: keep definitions/features/personality; delete all
  Outcome-Tendency lines. Replace with neutral framing ("tendency claims are learned from the
  journal, see FAMILIES_STATS block") — keep it working when the stats block is absent.
- Add a `buildFamilyStatsBlock(trades)` helper (suggested location: next to the existing family
  stat calcs) producing the measured line per family; inject where `TRADING_FAMILIES_PROMPT` is
  injected today (Pure-AI toggle path `GenericAnalysisService.ts:368-370`, debate paths
  `ensembleService.ts:1146, 1521, 2010`), behind the same toggles.
- Fix `PROMPTS.md:18` Standard-mode row (remove TRADING_FAMILIES_PROMPT from composition list).
- **Accept:** no "~86%" anywhere; tests updated (`tradeAnalysisSchema.test.ts` family-fallback tests
  unaffected); debate snapshots assert stats block presence when trades exist, absence when not.

### F2 — One normalizer, canonical labels (kills P2, P4)

- Extend `utils/patternMatch.ts` with `normalizeFamilyLabel(raw): CanonicalFamily | null`
  (canonical union: `'A'|'B'|'C'|'Omega'` + preserve original string) implementing
  `familyKey`'s buckets AND `familiesRelate`'s negation rules. Route
  `LiveBacktestService.familyKey`, `ModelPerformanceService.mapFamilyToKey`,
  `ScenarioSimulatorService`, `SelfLearningService.extractPatternFamily`, and
  `skillMatchesSetup` through it.
- Make the markdown-parse path (`analysisUtils.ts:768`) normalize through the same util so
  `"Directional Flip Family"` and `"Family B"` land in the same cluster.
- **Accept:** unit tests pinning each normalizer case (incl. negation: `fake-breakout` ≠ `breakout`,
  `"OMEGA continuation"` → Omega); existing suites green.

### F3 — Classifier promotion + calibration (kills P3, P6)

- Using F0 agreement data: reconcile discrepancies; adjust `WEIGHTS` only where outcomes justify it.
- Flip write authority: pipeline sets `detectedPatternFamily` from
  `PatternClassificationService` when hybrid data is available; LLM/prose value kept in
  provenance field as fallback when classifier confidence < threshold.
- **Accept:** journal rows show classifier-authored labels with confidence; disagreement cases
  reviewable; skill-cluster churn bounded (no mass re-clustering of history — old rows keep old
  labels; only new trades use canonical labels).

### F4 — Family advice → seed skills; retire `allowedFamilies` ceremony (completes the conversion)

- Seed 4 draft skills from the former tendency lines (Ω-wider-SL, A-trap-avoid, C-pullback-entry,
  B-confirm-volume), each citing the measured stat that motivated it; let the existing lifecycle
  (confirm/retire/decay/A-B) judge them.
- Either implement `allowedFamilies` for real (exclude families with n≥5 && WR < 30% over window —
  measured, not vibes) or delete the field and its prompt paragraphs. Recommend: delete unless
  measured exclusion proves useful; the familyBias penalties already do the soft version.
- Surface `StopLossOptimizerService.byFamily` multiplier in debate risk context when sample size
  suffices (it's computed but only shown in its own UI today).
- Feed the ModelPerformanceService "FAMILY SPECIALIST" line into seat-trust/auction context
  (D2.x territory from DEBATE_FLOW_PLAN — coordinate, don't duplicate).
- **Accept:** skills files exist in notebook `skills/` with draft status; no static tendency text in
  any prompt; gate scan output shrinks; debate contexts cite measured multipliers.

---

## Part 6 — Non-goals

- No removal of the family vocabulary, UI dashboards, or bot filters.
- No retroactive relabeling of historical journal rows.
- No new debate rounds/stages for family discussion — family content rides existing stages
  (per DEBATE_FLOW_PLAN philosophy).
- No numeric weighting of family bias into conviction auction math in this plan (that's D2.1).

## Part 7 — Sequencing, Metrics, Test Plan

**Order:** F0 → F1 → F2 → F3 → F4. F1 and F2 are independent and can ship in either order after F0;
F3 depends on F0 data; F4 depends on F1+F2.

**Metrics:**

- Label agreement rate (classifier vs LLM) — target >80% before F3 flip.
- Cluster purity: fraction of skill clusters whose member labels normalize identically — should
  rise after F2.
- Debate anchor drift: count of verdicts citing family win rates — after F1 they can only cite
  measured numbers (verifiable via `enforceCitedVerdict`-adjacent spot checks).
- Skill promotion rate of the 4 seeded family skills (they may legitimately retire — that's success).

**Test plan:**

- `tests/patternMatch.test.ts` — extend for `normalizeFamilyLabel` buckets + negation matrix.
- `tests/tradeAnalysisSchema.test.ts` — substring-fallback cases already present (:133-143); add
  canonical-normalization assertions after F2.
- `tests/harnessMemory.test.ts`, `skillEval.test.ts`, `skillAutoEval.test.ts` — fixture labels
  ('Family Z', mixed-case variants) exercise normalizer edge cases; keep passing unchanged.
- New: `familyStatsBlock` presence/absence test in debate-flow suite with mocked transport
  (mirrors `debateFlow.test.ts` patterns).

---

## Bottom Line

Keep Family as the **coordinate system**; stop letting it speak with unearned authority. Strip the
fabricated tendencies from prompts (F1), make labels trustworthy and consistently compared (F2+F3),
and convert everything Family *claims* into draft skills that must survive the same evidence gates
as every other lesson the harness learns (F4). That turns the oldest hardcoded prior in the app into
the newest demonstration of its core loop: **claim → measure → gate → skill**.

*Suggestions only — nothing in this document has been implemented.*
