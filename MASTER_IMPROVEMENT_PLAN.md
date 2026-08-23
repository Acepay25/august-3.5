# August 3.5 — Master Improvement Plan

**Date:** Aug 23, 2026
**Status:** Proposal only — zero code changes made. Every finding is verified against source with `file:line` anchors.
**Merges:** (1) Deep-scan audit report (this session), (2) `DEBATE_FLOW_PLAN.md` (debate flow D0–D4), (3) `Family` system evaluation (`FAMILY_SYSTEM_PLAN.md`, F0–F4).
**Health baseline at time of writing:** `typecheck` exit 0 · vitest 1066 passed / 13 skipped (103 files) · no uncommitted code changes.

Every work phase below ships behind green `npm run typecheck && npm run test && npm run build`.

---

## How to read this document

- **Part II** is the single register of all findings, with unified IDs. Duplicate findings across the
  original reports are explicitly merged there (e.g., the moderator-recall bug appeared in both the
  audit and the debate scan — one ID now).
- **Parts III–V** are the three workstreams with full implementation detail and acceptance criteria.
- **Part VI** maps dependencies between items (what must land before what).
- **Part VII** is the ordered execution roadmap if you implement straight down the list.
- IDs are stable — reference them (`A0-1`, `D2.1`, `F3`) in commits/reviews.

---

## Part I — System snapshot (verified)

| Layer | Entry points | Notes |
|---|---|---|
| Pipeline | `hooks/useAnalysisPipeline.ts` (3,571 lines) | orchestrates gate scan → staged analysis → ensemble/debate → validation → journal → post-mortem |
| Debate | `services/providers/ensembleService.ts` | real debate `conductRealDebate`:2714; simulated `conductTwoWayDebate`:1251 / `conductThreeWayDebate`:1695; sealed conviction auction `buildConvictionAuctionBlock`:2484; seat trust `buildSeatTrustBlock`:2513; hard floor `enforceCitedVerdict`:888 |
| Desk tools | `services/analysis/DeskToolsService.ts` | 8 tools (web_search, get_derivatives, get_order_book, get_liquidations, get_btc_context, get_session_context, get_price_snapshot, recall); 3-round cap, 30 s TTL cache, 2400-char budgets; native function calling + `<tool_call>` fallback |
| Memory/skills | `services/learning/*` | notebook in Preferences `memory_files_v1_<user>` (profile/, trader-diary/, rules/, skills/, bots/); stage-budgeted retrieval (opening 900 / rebuttal 400 / verdict 600 chars, doctrine slot 800); evidence-gated lifecycle (cluster ≥3 create · n≥5 WR≥0.6/≤0.4 confirm-retire · decay >30 d halve · refinement after 3 consecutive losses ≥48 h · A/B demotion TTL 30 d) |
| Providers | `services/providers/GenericProviderService.ts` | runtime-configured (`provider_configs_v1`); 3 API formats; retry + 120 s timeout; desktop keys encrypted via Electron safeStorage |
| Family | see Part V | taxonomy prompt + free-text label + deterministic classifier + measured stats consumers |

---

## Part II — Consolidated findings register

Severity: 🔴 high · 🟠 medium · 🟡 low. "Merged" shows which original report items collapsed into one ID.

### Foundations (audit)

| ID | Sev | Finding | Merged from |
|---|---|---|---|
| A0-1 | 🔴 | Moderator/arbiter pull channel broken: `getModeratorAnalysisStream` never receives `trades` → its `recall` tool returns nothing; arbiter has less history than rebuttal seats | audit P0 "recall-trades wiring" + debate W1 |
| A0-2 | 🔴 | `web_search` desk tool fragile: single upstream, failure surfaces as dead tool call mid-debate | audit P0 |
| A0-3 | 🔴 | `get_btc_context` drift: stale/regenerating BTC context injected without freshness guarantees | audit P0 |
| A0-4 | 🔴 | `PROMPTS.md` stale vs code (e.g., claims Standard mode injects `TRADING_FAMILIES_PROMPT`; actual builder `GenericAnalysisService.ts:405-422` does not) | audit P0 (+ concrete instance found in family scan) |
| A0-5 | 🟠 | Tool policy inconsistent: moderator gets all 8 tools; bot allowlists applied on rebuttals only; no per-stage policy helper | audit P0 + debate W6 |
| A1-1 | 🟠 | No conversational/session recall (Claude/Hermes gap): past desk calls on a symbol unreachable | audit P1 + debate D3.1 |
| A1-2 | 🟠 | No tier-0 always-loaded skill index; skill injection relies on per-stage retrieval slots only | audit P1 |
| A1-3 | 🟠 | No post-analysis capture: user corrections/pushback during review never become memory | audit P1 + debate D3.3 |
| A1-4 | 🟠 | Calibration loop incomplete: confidence-band accuracy not fed back into probability↔confidence coupling | audit P1 |
| A1-5 | 🟡 | No structured user-preferences layer (risk style, sessions, preferred pairs) in opening contexts | audit P1 |
| A2-1 | 🟡 | Missing desk tools: setup-history stats, bounded quick-backtest, price alerts | audit P2 + debate D1.1/D1.3 |
| A2-2 | 🟡 | Automation runs don't feed memory (scheduled scans can't mint draft skills) | audit P2 |
| A2-3 | 🟡 | Notebook lacks versioning/snapshot before bulk writes | audit P2 |

### Debate flow (D-items; weak spots W1–W11 in `DEBATE_FLOW_PLAN.md` §Part 3)

| ID | Sev | Finding |
|---|---|---|
| D0.1 | 🔴 | = A0-1. Give the moderator its memory |
| D0.2 | 🟠 | = A0-5. Deliberate moderator/stage tool policy via one `resolveSeatTools(seat, stage, bot?)` |
| D0.3 | 🔴 | Verdict evidence pack: proactive top-3 similar trades + matched skill index + cluster stats + doctrine header injected into verdict context |
| D1.1 | 🟠 | New `get_setup_history_stats` desk tool (SQL over journal: n, WR, avg R, last outcome, worst lesson per coin+dir+family+regime cluster) |
| D1.2 | 🟠 | Stats pack line in verdict context when cluster n ≥ 3 ("This desk is 2W/5L (−1.4R avg) on ETH-long liquidity-sweeps") |
| D1.3 | 🟡 | Optional bounded `run_quick_backtest` tool |
| D2.1 | 🟠 | Numeric seat weighting: citation weight = f(Brier, High-gap) inside `buildAnalystConsensus`; `enforceCitedVerdict` stays hard floor |
| D2.2 | 🟠 | Conviction drift tracking: request `CONVICTION:` every rebuttal round; show drift lines in verdict block |
| D2.3 | 🟡 | Debate protocol A/B lanes (rounds, devil rotation on/off, clarification threshold, evidence round) reusing `promptVersionStats` pattern |
| D2.4 | 🟡 | Divergence score v2: invalidation distance (ATR-normalized) + thesis-keyword overlap in `analyzePreDebateDivergence`:697 |
| D3.1 | 🟠 | `recall_chat` desk tool (FTS over conversations/analyses; SQLite FTS5 desktop / IndexedDB web) = A1-1 |
| D3.2 | 🟡 | "Prior desk calls" proactive block in evidence pack |
| D3.3 | 🟠 | Post-debate capture pass → drafts inbox = A1-3 |
| D4.1 | 🟡 | Rebuttal diff packets include seat's own prior-round text (W5) |
| D4.2 | 🟡 | Lopsided-floor guard: < 2 active seats ⇒ `partial floor` warning in plan + run log (W8) |
| D4.3 | 🟡 | Per-seat token/cost attribution in `DebateRunEvent` kind:'cost' (W11) |
| D4.4 | 🟡 | Document/converge simulated-vs-real debate physics (W10) |

### Family system (F-items; problems P1–P7 in `FAMILY_SYSTEM_PLAN.md` §Part 3)

| ID | Sev | Finding |
|---|---|---|
| F0 | 🟠 | Instrument first: label provenance field (which writer won: llm_json / markdown_parse / substring_fallback) + classifier-vs-LLM agreement metric |
| F1 | 🔴 | Prompt hygiene: strip fabricated outcome tendencies from `TRADING_FAMILIES_PROMPT` (`analysisPrompts.ts:338,349,360 "~86%",372`); replace with runtime-injected measured-stats block; fix `PROMPTS.md:18` row |
| F2 | 🟠 | One canonical family normalizer in `utils/patternMatch.ts`; route LiveBacktestService.familyKey:102, ModelPerformanceService.mapFamilyToKey:468, ScenarioSimulatorService:200, SelfLearningService:113, skillMatchesSetup:230 through it |
| F3 | 🟠 | Promote deterministic classifier (`PatternClassificationService`) to canonical `detectedPatternFamily` writer after calibration; LLM string kept as provenance/fallback |
| F4 | 🟡 | Convert family tendency claims into 4 draft skills under existing evidence gates; retire `allowedFamilies` ceremony (`GateKeeperService.ts:98` always-full-list) or implement measured exclusion; surface SL-optimizer byFamily multiplier + MODEL SPECIALIST line in debate contexts |

---

## Part III — Workstream A: Harness foundations

### A0 — Correctness fixes (ship first)

**A0-1 / D0.1 — Thread `trades` into the arbiter's pull channel.**
- Bug shape: `getModeratorAnalysisStream` (ensembleService.ts:298 area) has no `trades` param;
  ~10 call sites (`:1014, :1224, :1692, :2284, :3310, :3519, :3674, :3866, :3904, :4044`) cannot pass
  history. Same gap in the analysis service: `AnalyzeTradingViewParams` interface
  (`GenericAnalysisService.ts:233`), destructuring (~`:290`), desk-tools options (~`:495`).
  Meanwhile rebuttal seats receive `fullTradesForRecall` — the binding verdict is made with *less*
  memory than the arguments it judges.
- Fix: add optional `trades?: LoggedTrade[]` to both signatures; wire the three live-debate sites
  (`:3310, :3519, :3674`) and the analysis entry point; default `[]` keeps old behavior safe.
- Accept: moderator `recall` returns similar-trade rows in debateFlow tests; no call site regresses;
  typecheck catches any missed param misuse.

**A0-2 — `web_search` resilience.**
- Add transient-retry (reuse `streamWithTransientRetry`:2686 pattern) + timeout + a graceful empty
  envelope (`{status:'unavailable'}` digest line) so a failed search degrades to "no web data"
  instead of burning a round cap slot on an error.
- Accept: forced-failure unit test produces clean unavailable digest; retries capped; budget intact.

**A0-3 — `get_btc_context` freshness.**
- Stamp every BTC-context digest with data timestamp + age; tighten TTL; drop stale-regeneration
  silently serving yesterday's regime.
- Accept: digest carries `as of Xh ago`; test pins behavior at TTL boundary.

**A0-4 — Regenerate `PROMPTS.md` from source of truth.**
- `constants/promptRegistry.ts` is the registry; regenerate the doc's mode-composition table from it.
  Add a lightweight drift test asserting every registry id appears in PROMPTS.md.
- Land together with F1 (both touch the same doc section).

**A0-5 / D0.2 — One tool-policy resolver.**
- `resolveSeatTools(seat, stage, bot?): ToolGroupId[]` over groups `data | context | memory`.
  Defaults: moderator = `memory + context`; analysts = stage-scoped (openings: context; rebuttals:
  +data per bot `enabledTools` every round, not just rebuttals); clarification answers: memory only.
- Accept: table-driven unit tests; every `streamChatWithDeskTools` call site consumes it; the
  clarification-round allowlist gap closes.

### A1 — Memory-loop upgrades (Claude/Hermes parity where it pays)

**A1-1 / D3.1 — `recall_chat` desk tool.** FTS over stored conversations + analyses (SQLite FTS5 on
desktop, IndexedDB layer on web). Query: symbol + optional direction/timeframe. Returns prior desk
calls incl. never-journaled analyses. Register in `DESK_TOOL_DEFINITIONS` + label/digest + tests.

**A1-2 — Tier-0 skill index.** Always-loaded compact index (one line per active skill:
`trigger → verdict direction · WR n/T`), hard-capped ~800 chars, sorted by recency × weight; full
skill bodies stay JIT via existing stage-budgeted retrieval. Mirrors Claude's memory-index pattern.
Accept: index renders in opening context; overflow truncates lowest-value lines deterministically.

**A1-3 / D3.3 — Post-analysis capture.** Cheap-model pass after each completed analysis reviews the
session transcript for user corrections/pushback ("no, funding matters more here") → staged notebook
drafts (existing drafts inbox flow). Rate-limited (1 per analysis), skippable, never auto-applies.

**A1-4 — Calibration feedback.** Persist per-confidence-band hit rates; feed band-level offsets into
the probability↔confidence coupling (`schemas/tradeAnalysis.ts` rules) and surface band Brier in the
Win-Rate dashboard. Start read-only (report), enable adjustment after n ≥ 30/band.

**A1-5 — User-prefs layer.** Structured `profile/preferences.md` in the notebook (risk style,
session windows, preferred pairs, hard nos); injected into opening contexts within the existing
900-char opening memory budget.

### A2 — Extensions

**A2-1 — Desk tools:** `get_setup_history_stats` (= D1.1), `run_quick_backtest` (= D1.3, bounded:
fixed window, token-capped output), `manage_price_alert` (wrap existing PriceAlertService).
**A2-2 — Automation→memory bridge.** Scheduled automation runs may invoke the same
`evaluateSkillWorth` → draft-skill path as live trading, so nightly pattern scans accumulate
draft skills pending the standard gates.
**A2-3 — Notebook versioning.** Snapshot `memory_files_v1` before bulk writes via BackupService;
keep last N versions; restore command in Settings. Diffable skill/rule history follows free.

---

## Part IV — Workstream B: Debate flow (full plan)

> Full verified mechanics map lives in `DEBATE_FLOW_PLAN.md` Part 1 (pre-debate staging, speculative
> rebuttal pump, clarification cycles ≤3, sealed conviction auction, seat-trust records, verdict
> enforcement chain, simulated-debate variants). Strengths to preserve: no round barriers, prose
> verdicts, graceful degradation everywhere, `enforceCitedVerdict` as hard floor.

### Phase 0 — Fix the arbiter (≈ half day)

- **D0.1** = A0-1 (see above).
- **D0.2** = A0-5 (see above).
- **D0.3 — Verdict evidence pack (proactive).** Before the verdict call, assemble: top-3 similar
  closed trades (outcome + lesson), matched skill index lines, cluster stats line (needs D1.1),
  doctrine header — injected directly into verdict context. The arbiter must not depend on
  remembering to call `recall`. Accept: pack present when data exists, omitted cleanly when empty.

### Phase 1 — Evidence tribunal (2–3 days)

- **D1.1 — `get_setup_history_stats`.** Pure SQL over the trade log keyed on
  coin+direction+family+regime → `{n, winRate, avgR, lastOutcome, worstLesson}`; honest
  "insufficient sample" below n=3. Depends on F2 for reliable family keys.
- **D1.2 — Stats line in verdict context.** n ≥ 3 ⇒ inject one measured sentence into the evidence
  pack. Converts the Stress-Test Protocol from ritual to evidence. Family-level slice of this = F1
  stats block (shared builder recommended: one `buildEvidenceStats()` feeding both).
- **D1.3 — Optional `run_quick_backtest`.** Only if output budgeting stays clean; D1.1 covers 80%.

### Phase 2 — Mechanism design (3–5 days)

- **D2.1 — Numeric seat weighting.** Citation weight = f(Brier, High-gap overconfidence) — e.g.,
  calibrated 1.0, overconfident 0.7 — applied inside `buildAnalystConsensus:829`; show
  "cited Macro (trust 0.9)" in transcript. Advisory→numeric only; contract ladder untouched.
  Optional extension once F3 lands: fold `ModelPerformanceService.byFamily` specialist strength
  into per-seat priors.
- **D2.2 — Conviction drift tracking.** `CONVICTION:` requested every rebuttal round (regex parse
  already exists in seat-trust ingestion); verdict block prints "Macro 70→45 after Risk's funding
  point". Makes devil-round effectiveness measurable (feeds D2.3 lane evaluation).
- **D2.3 — Protocol A/B lanes.** Rounds count, devil rotation on/off, clarification threshold (20),
  evidence-round on/off — tracked per lane like `promptVersionStats`, winners pinned like
  `maybePinWinningPromptLane`.
- **D2.4 — Divergence score v2.** Add ATR-normalized invalidation distance + thesis-keyword overlap
  to `analyzePreDebateDivergence:697` so two Longs with stops 4% apart stop reading as "aligned".

### Phase 3 — Continuity (2–4 days)

- **D3.1** = A1-1 `recall_chat`. **D3.2** prior-desk-calls proactive block (reuses D0.3 pack).
- **D3.3** = A1-3 post-debate capture → fresher loss-priming material next debate.

### Phase 4 — Robustness polish (1–2 days)

- **D4.1** self-history in rebuttal diff packets. **D4.2** lopsided-floor guard. **D4.3** per-seat
  cost events. **D4.4** document simulated-vs-real physics split in PROMPTS.md.

---

## Part V — Workstream C: Family system migration (full plan)

> Verified usage map: four overlapping concepts — (1) taxonomy prompt, (2) free-text label with
> three competing writers (LLM JSON · markdown parse `analysisUtils.ts:575→768` · substring miner
> `tradeAnalysis.ts:624-629`), (3) unused deterministic classifier rendered only in hybrid data
> (`HybridIntelligenceService.ts:853-871`), (4) measured-stats consumers (dashboards, SL optimizer,
> model-performance specialists). Nine-plus subsystems key off the free-text label.

**Core verdict:** do **not** convert Family wholesale into skills — it is a coordinate (column), not
a lesson (row). Do strip its fabricated authority and convert its *claims* into draft skills.

- **F0 — Instrument (no behavior change).** Provenance field on finalized labels; log
  classifier-vs-LLM agreement. Accept: metric visible; zero prompt/matching changes.
- **F1 — Prompt hygiene (kills the "~86%" anchor).** Rewrite `TRADING_FAMILIES_PROMPT`
  (`analysisPrompts.ts:322-373`): keep definitions/features; delete all Outcome-Tendency lines
  (`:338, :349, :360, :372`). New `buildFamilyStatsBlock(trades)` (reuse the calc behind
  StrategySearch's `familyWinRates` overlay) injects measured lines — "Family C: 14T · 57% WR ·
  avg 1.8R (last 90d)" — wherever the taxonomy is injected today (Pure-AI toggle
  `GenericAnalysisService.ts:368-370`; debates `ensembleService.ts:1146, :1521, :2010`). Absent
  stats ⇒ neutral definitions only. Fix `PROMPTS.md:18` Standard-mode row. Ship with A0-4.
- **F2 — Canonical normalizer.** `normalizeFamilyLabel(raw)` in `utils/patternMatch.ts` merging
  keyword buckets (LiveBacktestService.familyKey:102) with negation rules (`familiesRelate`);
  route all five normalizer call sites through it; markdown-parse path normalizes too so
  "Directional Flip Family" and "Family B" share a cluster. Old rows never relabeled.
- **F3 — Classifier promotion.** Gate on F0 agreement > 80%. Adjust `WEIGHTS` only where outcome
  data justifies. Pipeline writes `detectedPatternFamily` from `PatternClassificationService`
  when hybrid data exists and confidence ≥ threshold; raw LLM string kept in provenance field.
- **F4 — Claims → seed skills; retire ceremony.** Seed 4 draft skills (Ω-wider-SL, A-trap-avoid,
  C-pullback-entry, B-confirm-volume) citing their motivating measured stat; standard lifecycle
  judges them (they may legitimately retire — that is success). Delete `allowedFamilies`
  (`GateKeeperService.ts:98` — can never bind) unless measured exclusion proves wanted; the
  familyBias penalties already do the soft version. Surface `StopLossOptimizerService.byFamily`
  multipliers and the ModelPerformanceService specialist line in debate risk context when samples
  suffice (coordinate with D2.1 — don't duplicate).

---

## Part VI — Dependency & merge map

```
A0-1 == D0.1        (same bug: moderator trades threading)
A0-5 == D0.2        (same fix: resolveSeatTools)
A1-1 == D3.1        (recall_chat)
A1-3 == D3.3        (post-analysis capture)
A0-4 + F1           (land together: PROMPTS.md + families prompt rewrite)

F0 ──► F3           (agreement data gates classifier promotion)
F2 ──► D1.1         (setup-stats clusters need reliable family keys)
F1 ──► F4           (seed skills replace the removed tendency lines)
D0.3 ──► D1.2 ──► D3.2   (evidence pack grows: trades → stats → chat history)
D1.1 ──► D1.2
D2.2 ──► D2.3       (drift data feeds protocol lanes)
F3 ──► D2.1(ext)    (canonical labels unlock family-aware seat priors)
A2-1 ⊃ D1.1/D1.3    (tool registrations shared)
A2-3 protects F4    (notebook snapshots before seeding skills)
```

Ordering constraints that matter: F2 before D1.1 (cluster purity); F1 before F4; D0.3 before D1.2
before D3.2 (one pack, incrementally enriched); everything behind green typecheck/test/build.

---

## Part VII — Unified execution roadmap

| Wave | Items | Est. effort | Theme |
|---|---|---|---|
| **0 — Stop the bleeding** | A0-1/D0.1 · A0-5/D0.2 · A0-3 · A0-2 · F0 | ~1 day | arbiter memory, tool policy, freshness, resilience, instrumentation |
| **1 — Honest prompts + evidence** | F1 + A0-4 · D0.3 · F2 · D1.1 · D1.2 | 2–3 days | strip fabrication, canonical labels, measured stats into verdicts |
| **2 — Mechanism + memory depth** | D2.1 · D2.2 · F3 · A1-2 · A1-4 | 3–5 days | weighted citations, conviction drift, canonical author, tier-0 index, calibration |
| **3 — Continuity + conversion** | D3.1/A1-1 · D3.2 · D3.3/A1-3 · F4 · A1-5 | 3–4 days | chat recall, capture loop, family claims → gated skills |
| **4 — Polish + extensions** | D2.3 · D2.4 · D4.1–D4.4 · A2-1..A2-3 | 3–4 days | A/B lanes, robustness, extra tools, versioning |

Each wave ends with: `typecheck && test && build` green + extended suites + a short changelog note
in the relevant plan doc.

---

## Part VIII — Unified success metrics

**Truthfulness**
- Zero static outcome-tendency claims in any prompt (grep-verified post-F1).
- Uncited-verdict forced-Neutral count ≈ 0; citation rate ≈ 100% (enforcement holding).
- Classifier-vs-LLM agreement trend visible from F0; > 80% before F3 flips authority.

**Debate quality**
- Time-to-verdict ↓ and cost/debate ↓ as smarter skips land (Phase 2 knobs).
- Devil-round persuasion rate measurable via D2.2; redesign if ≈ 0.
- Calibration spread (Brier) across seats tightens after D2.1.
- Evidence-pack hit rate: % verdicts whose cluster had n ≥ 3 history.

**Memory quality**
- Skill-cluster purity (member labels normalize identically) ↑ after F2.
- Tier-0 index present in 100% of opening contexts; retrieval-budget overflows logged ↓.
- Captured-correction drafts accepted-per-week > 0 after A1-3 (loop is alive).
- Seeded family skills: promotion OR principled retirement — either counts as success; silent rot does not.

---

## Part IX — Consolidated non-goals

- No round barriers; no longer default debates (rounds stay 2 + verdict; shortcuts stay).
- No JSON verdicts (prose + labeled FINAL TRADE PLAN contract stays).
- Seat trust never overrides the harness contract ladder; `enforceCitedVerdict` stays the floor.
- No removal of family vocabulary/UI/bot filters; no retroactive relabeling of journal history.
- No new debate stages for family discussion — family content rides existing stages.
- No auto-applied memory writes: capture flows stage drafts; humans (or the existing evidence gates) approve.

---

## Part X — Test strategy (consolidated)

- Extend `tests/debateFlow.test.ts`: moderator recall (A0-1), tool-policy matrix (A0-5),
  evidence-pack presence/absence (D0.3/D1.2), conviction-drift parsing (D2.2), self-history packets
  (D4.1), lopsided-floor guard (D4.2).
- Extend `tests/patternMatch.test.ts`: `normalizeFamilyLabel` bucket + negation matrix (F2).
- Extend `tests/tradeAnalysisSchema.test.ts`: provenance field; substring-fallback cases already at
  `:133-143` gain canonical-normalization assertions (F2/F3).
- New: `familyStatsBlock` presence/absence with mocked transport (mirrors `debateFlow.test.ts`).
- Keep green unchanged: `tests/harnessMemory.test.ts`, `skillEval.test.ts`, `skillAutoEval.test.ts`
  (fixture labels incl. 'Family Z' exercise normalizer edges).
- Drift test: every `promptRegistry` id appears in PROMPTS.md (A0-4).

---

## Appendix — Key anchors

| Topic | Anchors |
|---|---|
| Moderator stream bug | ensembleService.ts:298 area; call sites :1014/:1224/:1692/:2284/:3310/:3519/:3674/:3866/:3904/:4044; GenericAnalysisService.ts:233/~290/~495 |
| Debate engine | conductRealDebate:2714 · REAL_DEBATE_RESPONSE_ROUNDS=2:2297 · TIMEOUT 8 min:2300 · MAX_CLARIFICATION_CYCLES=3:2309 · REPLACEMENT_WAIT 60s:2339 · consensus shortcut:2926 · devil rotation:3007 · pump:2972 · auction:2484 · seat trust:2513 · divergence:697 · consensus:829 · enforceCitedVerdict:888 |
| Families prompt | analysisPrompts.ts:322-373 (claims :338/:349/:360/:372) · injections GenericAnalysisService.ts:368-370 · ensembleService.ts:1146/:1521/:2010 · toggle useAppSettings.ts:36 · SettingsMenu.tsx:697-701 |
| Label writers | schemas/tradeAnalysis.ts:187/:409/:561/:624-629 · utils/analysisUtils.ts:575/:768 · classifier HybridIntelligenceService.ts:52-54/:853-871 |
| Family consumers | SkillMemoryService.ts:230-231/:318/:745/:986 · MemoryRetrievalService.ts:81/:271/:296 · BotMemoryService.ts:118-127 · GateKeeperService.ts:113-248/:215-219 · LiveBacktestService.ts:102-192 · ScenarioSimulatorService.ts:200-204 · StopLossOptimizerService.ts:36/:185/:194-197 · ModelPerformanceService.ts:462-471/:574-578/:755-763 · TradeValidationGate.ts:235-237 |
| Normalizers | utils/patternMatch.ts (familiesRelate) · LiveBacktestService.familyKey:102 · ModelPerformanceService.mapFamilyToKey:468 · SelfLearningService.extractPatternFamily:113 |
| Gate ceremony | GateKeeperService.ts:98 (allowedFamilies always full) · analysisPrompts.ts:256 · PROMPTS.md:420/:491-497 |
| Measured family stats | WinRateDashboard.tsx:116-351 · StrategySearch.tsx:237-260 + constants/models.ts:20 (FAMILY_UI_DATA) · SettingsMenu familyWinRates prop |

*Nothing here is implemented. Source plans retained for reference: `DEBATE_FLOW_PLAN.md`,
`FAMILY_SYSTEM_PLAN.md` (both carry a pointer banner to this master).*
