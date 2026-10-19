# Report 2 — Enhancements and improvements

**Pinned commit:** `6a41a9f7e3b3986236c3000862d326f1e95dfad1` (branch `main`)
**Date:** 2026-10-19
**Part B of the brief.**

**How to read the roadmap column.** Every proposal is tagged with one of:

| tag | meaning |
|---|---|
| **NEW** | not present anywhere in the roadmap corpus — *and* not in the previous audit's orphan gap report either |
| **NEW (prior)** | not in `docs/plans/`, but **already identified** on 2026-10-18 in the orphan `docs/analysis/05-lead-findings.md`. These are the highest-value items in this report **and** the most likely to be lost — see §0.8 of the index report |
| **PARTIAL** | a roadmap item exists but does not name the missing part; the missing part is named explicitly in the row |
| **COVERED** | a roadmap item already covers it; the item id is cited and the item is still open |
| **IN FLIGHT** | the concurrent session is doing it right now |

**The corpus I checked against.** 282 numbered roadmap items (R-001…R-282) and 64 gap rows
(G-01…G-64) extracted from `docs/plans/**` (20 files), `docs/learning-loop-map.md`,
`docs/ui-doctrine.md`, `HANDOFF_LEARNING_LOOP.md`, `PLAN_LEARNING_LOOP_AND_UI.md`, `AGENTS.md`,
`changelog.md`, plus the recovered orphan `docs/analysis/05-lead-findings.md`. Full index in
`audit/2026-10-19-04-cleanup-manifest.md` §8.

---

## 1. The five findings that decide everything else

Before the ranked list, the five items that dominate. Everything in §2 and §3 is downstream of
these, and two of them are not on the roadmap at all.

| # | finding | severity | one-line proof |
|---|---|---|---|
| **F-01** | The assembled context is computed and **discarded** on every send. | **HIGH** | `hooks/useAnalysisPipeline.ts:1003-1154` builds it; `:1214`, `:1323`, `:1350` send `promptToSend` instead |
| **F-01b** | The injection ledger therefore **records skills the model never received**, and the skill-evidence join credits them anyway. | **HIGH** | `MemoryRetrievalService.ts:976-981` records by default; `memoryContext.ts:150` does not opt out; `MemoryInjectionService.ts:189` → `SkillMemoryService.ts:1617` grants FOLLOWED |
| **F-11** | The gate scores R:R from `takeProfit[0]`; the card and the clamp use the **nearest** target. | **HIGH** | `TradeValidationGate.ts:589` → `AccuracyValidationService.ts:196-222` vs `utils/riskReward.ts:48` → `utils/analysisUtils.ts:1272-1278` |
| **F-13** | **There is no cost model.** Every R, win rate, calibration bucket and the entire skill ledger is **gross**. | **Med-High** | a repo-wide search for `slippage\|takerFee\|makerFee\|commission\|costBps\|feeRate` returns a warning string, a comment, and the `netR` accumulator — which is the **sum of gross** R multiples (`SkillMemoryService.ts:1431`) |
| **F-10** | The analysis prompt **never reaches a trader-facing answer**. | **Med-High** | `analyzeTradingView`'s only production caller is `SkillEvalScheduler.ts:284`; `analyzeTradingViewWithTransientRetry` has zero |

---

## 2. Quick wins — small effort, real impact

### E-01 — Decide what happens to the assembled context, and make the ledger match

| | |
|---|---|
| **Problem** | `enhancedPrompt` is assembled from seven context blocks and sent nowhere. `hybridDataInjection` — the whole hybrid market packet — is `devLog`ged. `const gateInjection = '';` is a **hard-coded empty string**, so the entire "GATE KEEPER: Two-Stage Gate Scan" block computes nothing and its success log can never fire. |
| **Evidence** | `hooks/useAnalysisPipeline.ts:1003` (assemble), `:1106-1109` (the four blocks), `:1130` (reflections), `:1138` (`gateInjection = ''`), `:1146-1149` (dead branch), `:1152` (devLog), sends at `:1214` / `:1323` / `:1350` |
| **Proposed change** | Two mutually exclusive options — **pick one and make it explicit**:<br>**(a) Wire it.** Pass the assembled prompt on the desk path; give the retrieval call `recordInjections: false` unless the block is actually sent; move the gate constraints out of the dead variable and into the real prompt. Cost: a per-request token increase, and a budget decision.<br>**(b) Cut it.** Delete the assembly, the `devLog`s, and the injection record that goes with it. The desk path's own `surfacePromptWith` (`services/trade/chatSurfaceTurn.ts:105-139`) already assembles a *deliberate, narrower* context, and the tools (`recall`, `get_notebook_map`, `read_memory`) give the model a pull path. Cost: the "hybrid intelligence" the app is named for stays out of the prompt.<br>**What is not acceptable is the current state**, where the app pays for a retrieval it does not use and then lies about what the model saw. |
| **Impact** | **Accuracy** (the loop learns from what it actually saw) · **cost** (one wasted retrieval per send) · **reliability** (the ledger stops lying) · **maintainability** (a dead branch and a hard-coded empty string out) |
| **Effort** | **M** (a) · **S** (b) |
**The one recommendation, made consistent across the whole audit and the plan index (§3C.1):** **(1) inject the harness contract — 1,582 chars: the confidence ladder, the risk rules and the `HARNESS_TURN_MARK` convention — into the P1/P2/P3 system prompts; (2) cut the retrieved context by default; (3) flip `recordInjections` to default-false in the same change**, or the ledger keeps lying while you decide. Inject and record together, or neither. |
| **How to verify** | A new test that builds the **sent** message and asserts the expected blocks are present and the forbidden ones absent (E-11). Then `npm run render-probe`. Then: log the injection record's `sources` next to the sent prompt for one run and confirm they agree. |
| **Roadmap** | **PARTIAL** — `R-256` names "the data-pull residue — the injection string is read only by `devLog`", and `G-07` names `enhancedPrompt`. **The missing part, named:** R-256 does not name (i) the seven specific dropped blocks, (ii) the injection-ledger consequence, (iii) the hard-coded `gateInjection = ''`, (iv) the owner decision *"what replaces the analysis branch"* that `docs/plans/debate-deletion-status.md:110-147` is waiting on. |

### E-02 — One planned R:R, one formula — **REFRAMED 2026-10-20: the module it fixes is not wired**

| | |
|---|---|
| **Problem** | Three computations of the *planned* R:R coexist. The card, the journal and the probability clamp use `utils/riskReward.plannedRiskReward` (nearest target). The **validation gate** uses `takeProfit[0]`. The **scalp/swing validators**, called *by the same gate run*, use `takeProfit[0]` a second time. On an out-of-order target list the gate and the card disagree about the same plan — and the probability clamp uses the card's ratio while the confidence downgrade uses the gate's. |
| **Evidence** | `services/validation/TradeValidationGate.ts:589` → `services/validation/AccuracyValidationService.ts:196-222` (gate) · `utils/riskReward.ts:48` → `utils/analysisUtils.ts:1272-1278` (card) → `utils/analysisUtils.ts:1430` (clamp) · `services/analysis/ScalpDetectionService.ts:178` and `:236`, called at `TradeValidationGate.ts:889`/`:899` (second copy). The file's own comment at `ScalpDetectionService.ts:160` ("which is part of why this service was never wired in") is **stale** — it is wired in. |
| **Consequence, worked** | entry 100, SL 90, targets listed `[120, 110]`: the **card shows 1.00** (nearest = 110), the **gate scores 2.00** and passes the High-confidence bar (min 2.0), and the **clamp applies the 1:1 band (≤54 %)**. A 1:1 plan is gated as 2:1. |
| **Proposed change** | Make `utils/riskReward.ts` the single arithmetic owner. Add a **direction-aware** variant (`signedPlannedRiskReward`) that the gate can use for the inverted-plan refusal, and delete the copies in `AccuracyValidationService.ts` and `ScalpDetectionService.ts`. The two cannot be merged naively — the gate's sign handling is *desirable*; the duplication is the defect. |
| **Impact** | **Accuracy** (a plan's grade must not depend on target order) · **profit** (a wrong grade is a wrong size) · **maintainability** (one formula, one test table) |
| **Effort** | **M** |
| **Risk** | **M** — changing the gate changes what is refused. Ship behind the existing `ValidationConstants` thresholds, and diff the gate verdict over the existing trade corpus before and after. |
| **How to verify** | A table-driven test over out-of-order target lists asserting `gateRatio === cardRatio` for every combination; and a replay of the stored `trades` table comparing the old and new verdicts (the corpus is in the journal). |
| **Roadmap** | **NEW** — nothing in `docs/plans/` and nothing in the orphan gap report names the R:R drift. `AGENTS.md` names `utils/riskReward.ts` as the canonical module, which makes the gate's copy an unnoticed second implementation of a module the repo says is canonical. |
| **🔴 REFRAMED 2026-10-20** | **The gate this fixes is not wired.** `services/validation/TradeValidationGate.ts` (986 lines, 20 checks) has **ZERO production importers** — `grep 'runValidationGate\|TradeValidationGate'` over every non-test file returns only the definition and **two comments in other files offering to feed it** (`services/analysis/EntryTimingService.ts:588`, `services/backtesting/StopLossOptimizerService.ts:332`). Only the narrower `GateKeeperService` (a confidence cap + a family pre-filter) is live, via `services/trade/proposalGate.ts`. **⇒ E-02 splits: E-02a *wire the gate* (big) and E-02b *retire it* (small — delete 986 lines and its test).** This is **the single highest-leverage decision in the plan**, and it is the owner's, not a refactor's. |

### E-03 — Charge the round trip

| | |
|---|---|
| **Problem** | The app has **no cost model**. There is no fee, slippage or funding term anywhere in the source. Every `realizedR`, every win rate, every calibration bucket, every skill's expectancy and the whole RL ledger are **gross**. The field named `netR` is the *sum of gross* R multiples — the name is misleading. |
| **Evidence** | a repo-wide search for `slippage\|takerFee\|makerFee\|commission\|costBps\|feeRate` returns exactly three files: `services/analysis/ScalpDetectionService.ts:189` (a *warning string*), `services/learning/ReinforcementSignalService.ts:50` (a *comment* — *"Potential future params: slippage, timeToTarget, etc."*), and `services/learning/SkillMemoryService.ts:1431` (the `netR` accumulator). `services/backtesting/BacktestingService.ts:1358-1366` computes P&L as a raw price difference. |
| **Why it is decisive** | The app's own gates define the loosest trade it will allow: R:R 1.2 (Low/Avoid), scalp SL ≤ 1.0 % of price, scalp min R:R 1.0. A 0.10 % round trip against a 1.0 % stop is **0.10 R**; against a 0.3 % scalp stop it is **0.33 R**. At a 50 % win rate and R:R 1.2, gross expectancy is **+0.10 R** and the round trip consumes it. **The breakeven win rate moves from 45.5 % to 50.0 %** — and the gate simultaneously caps that trade's confidence at **≤54 %** (`utils/analysisUtils.ts:1430-1440`). |
| **Caveat, stated** | The 0.05 %/side taker rate was an **assumption** ("the standard published taker rate and is not in the repo"). The arithmetic is linear in it, and the conclusion holds for any taker fee above ~0.02 % per side at a 1 % stop. **The design is therefore to make the trader state their fee tier**, not to hardcode an exchange rate — and that is now decided (see *Approved parameters* below). |
| **APPROVED PARAMETERS** (owner, 2026-10-20) | ✅ **5 bps taker / 2 bps maker, zero slippage, with a visible "slippage not modeled" label.** The fee tier is the trader's setting. **The slippage line is labelled, never a silent zero** — an unlabelled zero reads as a claim the model did not make, which is the same class of defect as the "fresh packet" claim in E-33. |
| **Proposed change** | A single cost model, in R, computed at journal-write time: `costR = (feePerSide×2 + slippageBps/10000) / (stopDistancePct/100)`, with the fee **user-configurable** at the approved defaults and a visible **"slippage not modeled"** label on every net figure. Store `costR` and `netR` on the row, feed the ledger and the calibration buckets from `netR`, and keep `realizedR` for the gross view. |
| **Impact** | **Accuracy** (the ledger becomes net) · **profit** (this is the largest single correctness gap for a manual trader) · **reliability** (the expectancy shown to the trader becomes the expectancy they have) |
| **Effort** | **M** |
| **Risk** | **M** — it changes every number in the journal, so existing rows need a "gross" marker and the UI needs to say which is which. |
| **How to verify** | A test that a 1:1 plan at a 1 % stop with a 0.05 %/side fee shows a net expectancy ≤ 0 at a 50 % win rate, and that the skill ledger's expectancy matches `netR` and not `realizedR`. |
| **Roadmap** | **NEW (prior)** — this is `G-01`/`G-02`, and it comes from the **orphan** `docs/analysis/05-lead-findings.md`, **not** from `docs/plans/`. **It is not in the roadmap at all** — and the file it lives in was one `git gc` from being lost. It is now protected by the branch `archive/prior-audit-2026-10-18`. |

### E-04 — Fix the inverted ensemble weighting

| | |
|---|---|
| **Problem** | `winRate: perf.overallStats.total >= 3 ? perf.overallStats.winRate : 0`. A provider with **one loss and one trade** scores `0.0 %`; a provider with **no trades at all** also scores `0.0 %`. The providers are then sorted descending, and the moderator is told to favour the top one. **A single loss can brand a model as the worst performer, and a single lucky win the best.** |
| **Evidence** | `services/backtesting/ModelPerformanceService.ts:649` (the score), `:657` (the sort), `:660` (the gate — *some* provider needs ≥5 trades), `:669-670` (best/worst), `:693-694` ("Weight X's analysis significantly higher … Be skeptical of Y's"). **Verified at the pin, verbatim.** |
| **Proposed change** | A provider with fewer than `MIN_TRADES` gets `null`, not `0`. The ranking skips nulls. The moderator block says "not enough data for this provider" rather than being handed a 0 %. The second, better-gated path (`services/validation/calibrationPolicy.ts:800`, `MIN_TRADES_FOR_CALIBRATION = 10`) is already correct — make it the one that feeds the prompt, and note that its output is assembled at `services/analysis/HybridIntelligenceService.ts:1270-1291` into `accuracyEnhancements` **which reaches no model**. |
| **Impact** | **Accuracy** — this is the mechanism that would tell the app which seat to trust. |
| **Effort** | **S** |
| **Risk** | **S** — the whole block is inert today (no closed trades), so nothing can regress. |
| **How to verify** | A unit test over `ensureProviderEntry` + the ranking: one provider with 1 loss, one with 0 trades, one with 20 trades — assert the ranking and the emitted text. |
| **Roadmap** | **NEW (prior)** — `G-05`, from the orphan gap report. Not in `docs/plans/`. |

### E-05 — Make the injection ledger honest, independently of the prompt decision

| | |
|---|---|
| **Problem** | `getMemoryFilesContext` **records an injection** by default (`MemoryRetrievalService.ts:976-981`). `assemblePipelineMemoryContext` calls it without `recordInjections: false` (`hooks/analysisPipeline/memoryContext.ts:150`). The recorded injection then feeds `skillAdherenceForRun` (`MemoryInjectionService.ts:189`), which is the join `applySkillEvidence` (`SkillMemoryService.ts:1617`) uses to grant **FOLLOWED** credit. So a skill can earn W/L credit for an outcome it did not influence. The repo's own cold-start contract says this must not happen: *"evidence accrues ONLY on the FOLLOWED branch … a skill the run was not shown goes to `controlIds`, never to W/L"* (`docs/learning-loop-map.md:80-91`). |
| **Evidence** | as above. Also `services/learning/SkillEvalService.ts:203-213` shows the pattern the codebase already knows: `recordInjections: false` "keeps synthetic arms out of" the ledger. |
| **Proposed change** | `recordInjections` should default to **false** and be opted into by the caller that actually puts the block on the wire. The call sites that genuinely send the context opt in; the ones that do not, do not. One-line change per call site plus a default flip. |
| **Impact** | **Accuracy** — this is the difference between a skill ledger that measures something and one that measures noise. |
| **Effort** | **S** |
| **Risk** | **S** — but it will **change the existing ledger's numbers** (skills that were credited for nothing will stop being credited). That is the point, and it should be stated in the changelog. |
| **How to verify** | A test that runs a turn with a known skill, asserts the injection record's `sources` match the blocks present in the **sent** message, and asserts a skill absent from the sent message lands in `controlIds`, never in W/L. |
| **Roadmap** | **NEW** — `R-151` records that *"nothing checks `approvedBy` or `whyAccepted` at injection time"*, but that is the **approval** gate, a different mechanism from the **record**. The missing part, named: no roadmap item covers the *record*. |

### E-06 — Make the two numeric ratchets bind again

| | |
|---|---|
| **Problem** | Two ceilings were set from a measurement and left behind by the measurement. **The lint ratchet:** `eslint . --max-warnings 889` against a measured **682** warnings — **207 warnings of slack**, so a new warning cannot fail CI. `eslint.config.js:111-133` documents the history honestly: *"the cap sat at 1020 while the tree stood at 949, so 71 warnings could be added and CI would still pass."* It was corrected to 889. **The bundle ratchet:** `guards.yml` fails the build above 2,600 kB, calibrated at *"~1956 kB"*; the measured entry chunk is **1,352.6 kB** — 31 % below the calibration point, 48 % below the ceiling. |
| **Evidence** | `package.json` (`--max-warnings 889`); `npm run lint:loose` measured at **682 problems (0 errors, 682 warnings)** in a throwaway copy; `.github/workflows/guards.yml` (the 2600 kB ceiling and its comment); `dist/assets/index-*.js` measured at **1,352.6 kB**; `eslint.config.js:111-133` (the history) |
| **Proposed change** | Re-measure and lower both. **And make the ratchet ratchet itself** — the repo already has the mechanism: `scripts/check-flow-doc-anchors.cjs` re-runs its census on every invocation and its floors `const COVER_FLOOR = 52; const COVER_CITED_FLOOR = 52;` **ratchet down only**, with a control arm per rule. Apply the same shape to the lint and bundle ceilings: a CI step that **fails when the measured value is below the recorded ceiling by more than a threshold** — "the ceiling is stale, lower it". |
| **Impact** | **Reliability** (the gates start catching regressions again) · **maintainability** (the ceiling is a fact, not a wish) |
| **Effort** | **S** |
| **Risk** | **S** — the lint change is a one-line edit plus whatever the new count breaks; the bundle change is a one-line edit. The self-ratcheting step could be noisy on the first run; make it advisory for one cycle, then binding. |
| **How to verify** | `npm run lint:loose` on a clean checkout (expect ≤ the new cap); the new CI step fails on a deliberately raised ceiling. |
| **Roadmap** | **NEW** — no roadmap item covers either ceiling. The pattern the fix copies is the repo's own (`R-222` shipped the anchor gate; `R-243` shipped its ratcheting floors). |

### E-07 — Turn on `noUnusedLocals`

| | |
|---|---|
| **Problem** | `tsconfig.json:28` sets `noUnusedLocals: false`. An unused import, an unused export and an orphaned module are all **silent**. Two live examples at the pin: `defaultToolsForRole` imported at `hooks/useAnalysisPipeline.ts:14` with no remaining use, and `buildHybridEnvelope` imported at `:66` with **zero calls** — `git grep buildHybridEnvelope 6a41a9f7` returns exactly two hits, the import and the definition. Both are invisible to `tsc` *and* to `eslint` (the rule is `warn` under a slack cap). |
| **Evidence** | `tsconfig.json:28`; `hooks/useAnalysisPipeline.ts:14` and `:66`; `eslint.config.js:135` |
| **Proposed change** | Set `noUnusedLocals: true` and `noUnusedParameters: true`. Land it in two steps: first as an `eslint` **error** (with `--fix` for the trivial cases), then as a `tsc` error, so the build never goes red on a list nobody has read. |
| **Impact** | **Maintainability** (the dead-code class becomes a build failure) · **reliability** (no dead branch can hide a live bug) |
| **Effort** | **S** to flip · **M** to clear the list |
| **Risk** | **M** — the list may be long, and a `noUnusedParameters` flip will hit every intentionally-unused callback parameter. The two-step landing removes the risk of a red build. |
| **How to verify** | `npm run typecheck` clean; then add a test that a deliberately-unused import fails the build (or just rely on `tsc`). |
| **Roadmap** | **NEW** — no roadmap item covers it. `G-17` covers `App.tsx`'s *size*, not the compiler setting that would find the dead code. |

### E-08 — Fix the registry's drifted copies and the two unreachable ids

| | |
|---|---|
| **Problem** | Three registry entries hold a **different, older copy** of the prompt they shadow, and "Reset to default" installs that stale copy **as an override**. `strategy.summarize_pdf` is the worst: the registry copy is 992 chars, the real default is 1,358, and the real one demands `**Strategy: <name>**` plus a mandatory `Family` from the eight families. Resetting installs the old shape, so uploaded strategy files parse with **no `strategyFamily`** (`services/learning/strategyStore.ts:90`) — and the strategy×regime matrix and the skill attribution both read that field. `notebook.note` (1,611 vs 1,718) and `notebook.chat_note` (1,450 vs 1,557) are each **107 chars short**, and the missing text is *"Never write to skills/ — the harness creates skills only after a cluster of similar trades has evidence."* — so resetting installs an override that **removes the prohibition on writing into `skills/`**. Separately, two call sites use ids that are **not registry entries** — `learning.skill_refine` (`services/learning/SkillCraftService.ts:228`) and `learning.skill_worth` (`services/learning/skillWorthGate.ts:112`) — so the Settings editor cannot reach them. |
| **Evidence** | as above; the byte sizes are runtime-measured |
| **Proposed change** | Make the registry import the constant rather than restate it, and add a test that asserts **byte identity** between a registry entry and the constant it shadows. Add the two missing ids. |
| **Impact** | **Accuracy** (a strategy file with no family is invisible to the matrix) · **reliability** (a notebook override that permits skill writes) · **maintainability** |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | the byte-identity test; `tests/promptsAreWired.test.ts` extended from *reachability* to *reachability + identity* |
| **Roadmap** | **NEW** — `R-241` shipped the **unreachable** half of this cleanup (16 unreachable entries → 0). The **drift** half was not in scope, and `tests/promptsAreWired.test.ts` is a *source-shape* gate, so it cannot see it. **The missing part, named: the gate asserts that an id is *read*, not that the text is *the same*.** |

### E-09 — `analysis.lens`: wire it or take the editor away

| | |
|---|---|
| **Problem** | `analysis.lens` is a registry entry the trader can edit in Settings, and it is **sent to nobody**. `LENS_MODE_BASE_PROMPT` (2,854 chars) is never sent; `rolePrompt` is a declared-but-unset interface field (`hooks/useAnalysisPipeline.ts:298`) — only the measure test assigns it. |
| **Evidence** | `constants/promptRegistry.ts` (the entry) · `constants/prompts/analysisPrompts.ts:108` (the constant) · `hooks/useAnalysisPipeline.ts:298` (`rolePrompt` never assigned) |
| **Proposed change** | One of the two: assign `rolePrompt` and route the lens path, **or** delete the registry entry and the constant. The app is currently handing the trader an editor for text it never sends — the exact defect `docs/app-flow.md:595-597` describes and the 2026-10-18 deletion fixed for 16 other ids. |
| **Impact** | **Honesty** (a control that does nothing) · **maintainability** (2,854 chars of dead prompt) |
| **Effort** | **S** to remove · **M** to wire |
| **Risk** | **S** to remove |
| **How to verify** | Extend `tests/promptsAreWired.test.ts` to assert **that the prompt reaches a sent request**, not merely that a `getPrompt()` call site exists. That is the gate that would have caught this and F-10. |
| **Roadmap** | **NEW** — one entry further than `R-241`. |

### E-10 — Three small honest fixes

| item | problem | evidence | change | impact | effort | roadmap |
|---|---|---|---|---|---|---|
| **E-10a** | The bot seat is told to *"use your desk tools … and web search before reasoning"* — and the bot surface has **no tools at all** (P4 is deliberately tool-less). | `services/agents/seatPersonas.ts:30` vs `hooks/useAnalysisPipeline.ts:1317-1320` and `services/trade/chatSurfaceTurn.ts:24-27` | either give bots the read-only tools, or fix the prompt | honesty, accuracy | S | **NEW** |
| **E-10b** | `types/enums.ts:43` still reads `export type DebateSpeaker = string \| 'Moderator';` — *"a degenerate union, worse than the one it replaced"*. | `types/enums.ts:43` | one line: `export type DebateSpeaker = string;` | maintainability | S | **COVERED** — `G-13`, `R-248`; still open |
| **E-10c** | `hooks/useSurface.ts` declares `AppSurface = 'chat' \| 'trade' \| 'journal' \| 'agents' \| 'learn'` but `VALID` has only four members — `'chat'` is a migration case that can never be stored. | `hooks/useSurface.ts:16-20` | drop `'chat'` from the union | maintainability | S | **NEW** |

---

## 3. Medium projects

### E-11 — A prompt **contract** test: assert what is *sent*, not what is built

| | |
|---|---|
| **Problem** | There is **no test anywhere** that asserts the content of a sent message. `tests/promptsAreWired.test.ts` proves a registry id has a `getPrompt()` call site — a *source-shape* gate. F-01, F-09, F-10 and E-09 are all invisible to it, and all four are real. The repo's own doctrine names the blind spot: *"Unit tests cannot see the transcript"* and *"jsdom mounts components without resolving a stylesheet"* (`AGENTS.md:65-122`). |
| **Evidence** | `tests/promptsAreWired.test.ts`; the four findings above; `AGENTS.md:65-122` |
| **Proposed change** | For each of the four model-call paths (P1 chat, P2 dock, P3 automation, P4 bot), build the **real** system prompt through the real function and assert: the expected blocks are present, the forbidden ones are absent, and the tool list matches the surface's allow-list. Four tests, one per surface. This is the gate that turns "the app assembles it" into "the app sends it". |
| **Impact** | **Reliability** (it would have caught F-01, F-09, F-10, E-09) · **maintainability** (the prompt surface becomes a checked contract) · **cost** (a budget assertion per surface) |
| **Effort** | **M** |
| **Risk** | **S** — pure test code |
| **How to verify** | Remove a block from one surface's prompt and watch exactly one test go red. |
| **Roadmap** | **NEW** — `R-225` is the *doctrine* of the blind spot; no item is the *fix*. |

### E-12 — Re-home the position sizing

| | |
|---|---|
| **Problem** | `utils/ticketSize.ts` is a **complete, grade-tiered, fail-closed** position-sizing module — with a leverage cap, an unconfigured-equity refusal, a risk-tier ladder and a Kelly advisory — and it has **zero production call sites**. The only callers are two test files. The journal's size today is the model's own number, or nothing. |
| **Evidence** | `git grep computeContractSize 6a41a9f7` returns only `tests/financialMath.test.ts:10,327,336,346` and `tests/ticketMathTiers.test.ts:6,80,91,103,109,182`. The module is `utils/ticketSize.ts` (the previous audit called it *"the highest-value re-homing in the codebase"*). |
| **Proposed change** | Wire it into the proposal card and the journal write path: the suggested size is computed from the trader's risk % setting, the plan's stop distance and the exchange leverage cap — and the trader can override it. The override is recorded, so the journal can compare *the model's size*, *the app's suggestion* and *the trader's size*. |
| **Impact** | **Accuracy** (the model's size is currently one of the inputs) · **profit** (a wrong size is the most expensive error a manual trader makes) · **reliability** |
| **Effort** | **M** |
| **Risk** | **M** — it changes what the journal records; existing rows need a marker, and the trader must always be able to override. |
| **How to verify** | The journal row's size equals `computeContractSize`'s output for a fixture; the leverage cap is honoured; an unconfigured equity is refused rather than guessed. |
| **Roadmap** | **NEW (prior)** — `G-06`; from the orphan gap report. Not in `docs/plans/`. |

### E-13 — Decide the two unresolved *product* questions the code already poses

| | |
|---|---|
| **Problem** | Two code paths are half-decided and the half-decision is visible to the trader. (a) The **Prompt A/B (control lane)** dropdown in Settings does nothing: `beginPromptLane` has zero call sites, `controlLane` is permanently `false`, and `runStats.promptLane` is never assigned — so the "Prompt lanes" dashboard card always reports 0/0. (b) The **truncation tally** records nothing: `beginTruncationWindow()`, `consumeTruncations()` and `peekTruncations()` have zero production call sites, so `recordFinishReason` returns immediately. |
| **Evidence** | (a) `services/infrastructure/PromptOverrideService.ts:24-38`; `hooks/useAnalysisPipeline.ts:1242,1403`, `App.tsx:1727,1754`, `services/agents/botRoutine.ts:155` (the `runStats` literals set only `runId`/`startedAt`/`finishedAt`/`durationMs`); `utils/promptVersionStats.ts:45-57`; `components/settings/SessionUsagePanel.tsx:228-242`. (b) `utils/finishReason.ts` — zero production call sites for the three window functions; `AGENTS.md` tells a reader to "read the ceiling with `peekTruncations()`" and there is no reader. |
| **Proposed change** | For each: **either wire it or remove it.** (a) Wire `beginPromptLane` onto the tool turn and stamp `runStats.promptLane` — the A/B is a genuinely useful operator tool and the machinery is 90 % built. Or remove the dropdown and the card. (b) Wire the window into the turn so the tally is real, and surface it in the run contract; the roadmap's `R-071` needs exactly this to know an answer was cut off. |
| **Impact** | **Honesty** (two visible controls that do nothing) · **accuracy** (the A/B lane is how you would compare two prompts on real trades) · **reliability** (the truncation tally is the only way to know a provider stopped early) |
| **Effort** | **M** each |
| **Risk** | **M** — (a) changes the prompt sent, (b) changes the run accounting |
| **How to verify** | (a) two runs with the lane set, and the dashboard card shows two non-zero rows with different prompt versions. (b) a forced truncation produces a non-zero tally and a visible "the provider stopped early" marker. |
| **Roadmap** | (a) **COVERED** — `R-250` and `G-09`, both still open. (b) **PARTIAL** — `R-071` covers the *user-visible* silence of a truncated answer; **the missing part, named: the tally is not recorded at all**, so there is nothing for R-071 to surface. |

### E-14 — Three stores that are backed up in name only

| | |
|---|---|
| **Problem** | (a) `approval_rules_v1:<user>` is on **neither** allow-list. On **web** the export sweep picks it up (localStorage *is* the Preferences fallback) but the import **skips** it (`isRestorablePreferenceKey`, `ExportService.ts:758-760`); on **native** it is neither exported nor restored. It gates **every auto-apply** — the per-coin "always journal" vs "ask" policy. The repository already knows: `tests/exportRawLocalStorage.test.ts:97` — *"NOT backed up: the inbox rules gate every auto-apply — worth a decision."* **The decision was never taken.** (b) `desk_idle_motion_v1_<user>`, `thinking_leak_bin_v1` and `trade_sidebar_open_v1` are on the **restore** list but not the **raw** list, and their owners read `localStorage` directly — so on native they are neither exported nor restored. (c) `agent_threads_opened_v1_<user>` has the same shape. |
| **Evidence** | `utils/approvalInbox.ts:46` (write), `:29/:38/:51` (reads) · `services/infrastructure/ExportService.ts:299-391` (the raw list), `:497-505` (the read fall-through), `:511` (the mirror's early return), `:758-760` (the import skip) · `services/desk/idleMotion.ts:34`/`:26` · `utils/thinkingLeakBin.ts:39`/`:12` · `App.tsx:475`/`:454` · `utils/agentThreads.ts:323`/`:313` |
| **Mechanical cause** | The one-time `migrateLocalStorageToPreferences` sweep (`services/infrastructure/PreferencesService.ts:226-241`) copies **every** localStorage key into Preferences, creating a **stale second copy** of every raw-owned key. `readSweptValue` prefers the raw store for RAW-listed keys precisely to undo this. A key that is *not* on the RAW list gets the stale Preferences copy. |
| **Proposed change** | (a) Add `approval_rules_v1` to `RAW_LOCAL_STORAGE_PREFIXES` and to the restore allow-list. (b) Add the three restore-only keys to the RAW list, or remove them from the restore list. (c) Same. Then **close the gate's blind spot**: `tests/exportRawLocalStorage.test.ts`'s `ownerUsesPreferences` check is **file-scoped**, so a file that touches Preferences anywhere is exempt for *every* key it owns — which is exactly how `trade_sidebar_open_v1` escapes. Make it **key-scoped**. |
| **Impact** | **Reliability** (no silent data loss on backup/restore) · **Accuracy** (the auto-apply policy is part of the trader's setup) |
| **Effort** | **S** for (a)–(c); **S** for the key-scoped gate |
| **Risk** | **S** — but it changes what a restore writes, so the restore test needs the native path too (which is not currently exercised). |
| **How to verify** | Extend `tests/infrastructure/backupImportRoundTrip.test.tsx` to run the native path (Preferences instead of localStorage) and assert each key round-trips. |
| **Roadmap** | **NEW** — `R-193` shipped 10 trading stores into the RAW list and `R-199` shipped per-key export caps; **the missing part, named: the approval-policy store and the three restore-only stores are not in either list, and the CI gate's file-scoped heuristic is why nobody noticed.** |

### E-15 — Version coherence

| | |
|---|---|
| **Problem** | The repository carries **four** different version numbers. `package.json` says **1.3.0**. The committed `package-lock.json` says **1.0.30** — and the fix (bumping it and adding `js-yaml` to the lock's root devDependencies block) is sitting **uncommitted** in the working tree. `constants/version.ts:6` falls back to the literal **`'1.0.28'`** while its own comment says it is "kept synced with package.json" — five minor versions behind. The newest tag is **v1.2.0**; the changelog's newest entry is **v1.3.0**. |
| **Evidence** | `package.json` · `package-lock.json` (HEAD) · `constants/version.ts:6` · `vite.config.ts:443` (the `define` that supplies the real version in builds) · `git tag --sort=-creatordate` · `changelog.md:5` |
| **Proposed change** | One source. The build already injects `PACKAGE_VERSION`; make the fallback read the same value rather than a literal, or delete the fallback and fail loudly when it is absent. Commit the lockfile fix. |
| **Impact** | **Reliability** (a rebuild does not silently produce a different filename) · **maintainability** |
| **Effort** | **S** |
| **Risk** | **S** — but the fallback is the *dev* path, so a hard failure would break `npm run dev` if the define is ever removed. Prefer a build-time assertion over a throw. |
| **How to verify** | A test that asserts `APP_VERSION` equals `package.json`'s version under the test runner; `npm ci` from a clean checkout. |
| **Roadmap** | **NEW** — `R-276` shipped the *changelog ↔ package.json* agreement with a test; this is the same class for three other files. **The missing part, named: the lockfile and the fallback constant are not in that test.** |

### E-16 — The 1-second clock in the trade surface

| | |
|---|---|
| **Problem** | `components/trade/TradeView.tsx:666` runs `setInterval(() => setNowMs(Date.now()), 1000)` — a **one-second state update in a 1,145-line component** that owns the chart, the order book, the transcript and the panels. A full re-render per second, for the lifetime of the surface. |
| **Evidence** | `components/trade/TradeView.tsx:666`; the component's size (1,145 lines) |
| **Proposed change** | Move the clock into a leaf that only renders the time, and let it format locally from a coarse tick. If the whole surface genuinely needs per-second freshness, that is a design question — but the *component* does not. |
| **Impact** | **Speed** (the app's feel on the surface the trader spends most time on) · **reliability** (fewer re-render-induced races) |
| **Effort** | **S–M** |
| **Risk** | **S** |
| **How to verify** | React DevTools profiler: the commit count on the trade surface over 60 s, before and after. **[Unverified — needs a profiler run]** the exact current cost. |
| **Roadmap** | **NEW** — the roadmap's performance items are the bundle ratchet and `App.tsx`'s size (`G-17`). This is not in the corpus. |

### E-17 — The `fullscreen` right-panel branch, decided

| | |
|---|---|
| **Problem** | The right-panel contract computes a `fullscreen` presentation and the Trade surface pins `"push"`. So a branch is computed and never used. |
| **Evidence** | `hooks/useRightPanel.ts:127` (computes) · `components/trade/TradeView.tsx:1097` (pins `"push"`) |
| **Proposed change** | Decide: use it somewhere, or delete it. The repo's own instruction is *"either is honest, silently deleting it is not"* — so this is an owner decision, not a cleanup. |
| **Impact** | **Maintainability** |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | The branch is either reachable or absent. |
| **Roadmap** | **COVERED** — `R-017`, `G-18`, `R-156`, `R-159`; still open, and it is one of the 23 owner decisions the roadmap lists. |

---

## 4. Big bets

### E-18 — Close the loop: make the outcome automatic, reversible and provenanced

**This is the highest-leverage change available, and it is the one the product promise depends on.**

| | |
|---|---|
| **Problem** | The learning loop is starved by **one human click**. The outcome autopilot polls every 20 s (`services/ui/OutcomeAutopilotService.ts:85`) and resolves the trade — but `markProcessed` is reached only **after** the trader confirms (`OutcomeAutopilotService.ts:650` ← `hooks/useWatchAndAutopilot.ts:201` ← `:178` → `App.tsx:2372` → `confirmAutopilotOutcome`). Every downstream consumer then computes over an empty set: auto-learn (`hooks/useTradeLogging.ts:122`), the loss-similarity penalty, the skill A/B (`services/learning/SkillEvalService.ts:53`), the weekly review (`services/learning/weeklyReview.ts:135`, `MIN_CLOSED_TRADES_FOR_REVIEW = 3`), the Brier calibration, and the provider ranking (`services/validation/calibrationPolicy.ts:800`, `MIN_TRADES_FOR_CALIBRATION = 10`). |
| **The number** | The previous audit measured **n = 0** resolved trades on the owner's machine on 2026-10-18, by decoding the live `leveldb`. **We did not re-measure** — the brief forbids touching a live profile, and the figure is machine-specific. **Whether it is still 0 is an open question only the owner can answer.** |
| **Proposed change** | Make the resolution **automatic but reversible**: the autopilot resolves, the app records the outcome with a `resolutionSource` flag (`autopilot` vs `confirmed`), and the trader can correct it. The correction writes a *new* row rather than editing the old one, so the ledger keeps both. Shadow mode first: resolve, show, **do not record** — for a month — and report the disagreement rate between the autopilot's resolution and the trader's confirmation. |
| **Impact** | **Accuracy** (every learning consumer is downstream) · **profit** (the skill ledger, the calibration and the provider ranking are all inert without closed rows) · **reliability** (the app's central promise is a loop) |
| **Effort** | **L** |
| **Risk** | **L** — a wrongly-recorded outcome poisons the ledger permanently. The mitigations are: a provenance flag, a correction path, a shadow month, and a "the trader may always override" rule. |
| **How to verify** | After the shadow month, the disagreement rate is below a threshold you choose. Then: the weekly review card stops returning `null`; the skill A/B produces verdicts; the calibration buckets populate. |
| **Roadmap** | **NEW (prior)** — `G-04`; from the orphan gap report, and it is *also* an owner decision the roadmap lists (the 7 Tier-2 product decisions, `HANDOFF_LEARNING_LOOP.md:213-235`). **This is the one item in this report where the previous audit's "worth doing" and the roadmap's "needs a ruling" point the same way: the loop cannot be measured until the outcome is recorded.** |

### E-19 — One plan object, read by every surface

| | |
|---|---|
| **Problem** | A trade plan is computed in at least four places from the same levels: the proposal card (`services/trade/proposedTrade.ts:126-165`), the validation gate (`services/validation/TradeValidationGate.ts:495`), the probability clamp (`utils/analysisUtils.ts:1399`), and the level watch (`services/trade/levelWatchService.ts:217`). Each recomputes the ratio from the model's own numbers, and they do not agree (E-02). |
| **Proposed change** | Compute the plan **once**: a `Plan` object with entry, stop, targets, invalidation, the planned ratio (one formula), the grade, the confidence cap, and the size suggestion. The card, the gate, the clamp, the watch and the journal row all **read** it. The model supplies the levels; the app supplies everything else. This is the structural expression of the product framing: *the agent proposes, the deterministic code checks, the user decides.* |
| **Impact** | **Accuracy** (one plan, one verdict, one ratio) · **profit** (the grade and the size become consistent) · **reliability** · **maintainability** |
| **Effort** | **L** |
| **Risk** | **M** — it touches the gate, the card, the watch and the journal simultaneously. Land it behind the existing `Plan` type, one surface at a time. |
| **How to verify** | One test that builds a plan and asserts that the card's ratio, the gate's ratio, the clamp's band and the journal row's ratio are all the same number. |
| **Roadmap** | **NEW** — no roadmap item proposes this shape. `R-254`/`R-256` touch the same neighbourhood but not the object. |

### E-20 — A replay harness

| | |
|---|---|
| **Problem** | There is **no way to ask "would today's code have graded yesterday's plan the same way?"** The app has the *ingredients* — the stored trades, the market history, the outcome engine, the prompt version stamp (`trade.promptVersion`), `sourceRunId`, `modelsUsed`, `marketSnapshot`, `marketRegime` — but no harness that re-runs a past plan through today's deterministic code. |
| **Proposed change** | A **replay** command (a script, not a feature, at first): for each closed trade, re-derive the gate verdict, the confidence cap and the probability band from the stored levels and the stored snapshot; compare with what was recorded; report the drift. It is deterministic, needs no provider, and it is the cheapest possible regression harness for E-02, E-19 and E-03. |
| **Impact** | **Accuracy** (every gate change can be measured against real history) · **reliability** · **maintainability** |
| **Effort** | **L** (M for the first version) |
| **Risk** | **S** — it is read-only over the journal |
| **How to verify** | The harness runs and reports; the drift report becomes a CI artifact. |
| **Depends on** | **real trade data** — and the *stored* data's completeness. `R-213` records that the live-journal counts were **never obtained**; `R-214` records that pre-F3a rows carry no `planId`. |
| **Roadmap** | **NEW** — nothing in the corpus proposes a replay. `R-206` (`SkillEvalService`) is the closest machinery: it re-runs a *prompt* against a trade. A replay of the *deterministic* code is the missing half. |

### E-44 — Break the notebook out of one JSON blob

| | |
|---|---|
| **Problem** | The entire notebook — every skill, the risk rules, the doctrine, the recurring mistakes, the diary, the model notes, the distilled facts, the lens memory — is **one key**: `memory_files_v1_<user>`, a JSON blob of `.md` entries, up to **2 MB**, written whole. It is the **largest key in the app**, it is deliberately **uncapped** in the export (`ExportService.ts:398-402`), and every write rewrites the whole thing. |
| **Evidence** | `services/learning/MemoryFilesService.ts:31` (the prefix), `:250` (the store), `:673` (the name), `:1364` (the `-2.md` dedupe); `services/infrastructure/ExportService.ts:398-402` (the cap exemption) |
| **Proposed change** | Shard the notebook by category, with a small manifest key listing the shards and their sizes. The export already knows how to cap and mirror per key, so the machinery exists. The risk is a write that updates one shard must also update the manifest — an atomicity problem that does not exist today because the blob is one write. |
| **Impact** | **Reliability** (one corrupt write cannot lose 2 MB) · **Speed** (a single skill edit does not rewrite the notebook) · **cost** (the quota pressure in `utils/memoryBudget.ts` becomes per-shard) |
| **Effort** | **L** |
| **Risk** | **M–L** — this is the one store in the app that holds the trader's own thinking. A migration bug loses it. |
| **How to verify** | A migration test that shards an existing blob and asserts every entry survives byte-identically; a quota test that a full shard fails the *one* write, not the whole notebook. |
| **Roadmap** | **NEW** — the corpus discusses the notebook's *content* (`R-137`, `R-236`, `G-29`, `G-30`, `G-31`) but never its *shape*. `G-31` ("a budget exception that hides itself — the doctrine slot is an always-on layer outside the budget") is adjacent: the budget is per-run, the storage is per-blob. |

---

## 5. Ranked list

Ranked by impact ÷ effort, with the roadmap status.

| rank | id | what | impact | effort | roadmap | group |
|---|---|---|---|---|---|---|
| 1 | **E-01** | Decide the assembled context's fate | accuracy · cost · reliability | S–M | PARTIAL (R-256) | quick win |
| 2 | **E-05** | Make the injection ledger honest | accuracy | S | NEW | quick win |
| 3 | **E-02** | One planned R:R, one formula | accuracy · profit | M | NEW | medium |
| 4 | **E-06** | Make the ratchets bind | reliability | S | NEW | quick win |
| 5 | **E-08** | Fix the registry's drifted copies | accuracy | S | NEW | quick win |
| 6 | **E-04** | Fix the inverted ensemble weighting | accuracy | S | NEW (prior) | quick win |
| 7 | **E-09** | `analysis.lens` — wire or remove | honesty | S | NEW | quick win |
| 8 | **E-14** | Three stores backed up in name only | reliability | S | NEW | medium |
| 9 | **E-11** | A prompt contract test | reliability · maintainability | M | NEW | medium |
| 10 | **E-15** | Version coherence | reliability | S | NEW | quick win |
| 11 | **E-10a** | The bot seat's tool lie | honesty | S | NEW | quick win |
| 12 | **E-13** | The prompt lane and the truncation tally | honesty · accuracy | M | COVERED (R-250) / PARTIAL (R-071) | medium |
| 13 | **E-12** | Re-home the position sizing | accuracy · profit | M | NEW (prior) | medium |
| 14 | **E-03** | Charge the round trip | accuracy · profit | M | NEW (prior) | medium |
| 15 | **E-07** | Turn on `noUnusedLocals` | maintainability | S–M | NEW | medium |
| 16 | **E-16** | The 1-second clock | speed | S–M | NEW | quick win |
| 17 | **E-17** | The `fullscreen` branch | maintainability | S | COVERED (R-017) | quick win |
| 18 | **E-10b** | `DebateSpeaker` | maintainability | S | COVERED (G-13) | quick win |
| 19 | **E-10c** | The dead `'chat'` union member | maintainability | S | NEW | quick win |
| 20 | **E-19** | One plan object | accuracy · profit | L | NEW | big bet |
| 21 | **E-18** | Close the loop (auto-resolve) | accuracy · profit | L | NEW (prior) | big bet |
| 22 | **E-20** | A replay harness | accuracy · reliability | L | NEW | big bet |
| 23 | **E-44** | Break the notebook out of one blob | reliability · speed | L | NEW | big bet |

---

## 6. What is deliberately **not** proposed

The brief excludes order placement, exchange write access, regime routing, debate revival, extra
LLM review calls and a macro calendar. This report proposes none of them, and two of the
proposals above actively *reduce* model calls (E-01b, E-19).

Two things that look like proposals and are not, stated so they are not mistaken for omissions:

- **The ensemble weighting (E-04) is not a "debate revival".** It is one line that stops a
  one-loss provider from being ranked as the worst. It changes no prompt and adds no call.
- **The prompt contract test (E-11) is not an "extra LLM review call".** It is four unit tests
  that build strings.

## 7. Coverage note

Everything in this report was derived from: the source at `6a41a9f7`; the 282-item roadmap index
and 64-gap table extracted from `docs/plans/**` and the other planning documents; the recovered
orphan `docs/analysis/05-lead-findings.md`; and the four teammates' read-only audits
(architecture and stores, prompts and tools, security and gates, UX and docs). **No gate was run
in the repo by this thread**, **the app was never run**, and **no live profile was touched**. The
full set of measurements, with the commands, is in `audit/2026-10-19-01-system-and-data-flow.md` §10
and `audit/2026-10-19-00-index-and-method.md` §0.4.

---

## 3A. A second wave — from the security, reliability and performance pass

These arrived from a deeper read of `electron/`, the retry layer, the notebook's write path and
the render path. They are **independent of §1–§3** and they are the cheapest high-value items in
the whole report.

### E-21 — Close the CSP's unused remote origins *(the cheapest security win in this report)*

| | |
|---|---|
| **Problem** | `index.html:21-22` is the **only** CSP — there is no header, and the `app://` handler cannot add one (it returns `net.fetch(file://)` verbatim). It allows `https://s3.tradingview.com` in `script-src` and `https://s3.tradingview.com` / `https://www.tradingview.com` / `https://tradingview.com` in `frame-src` and `img-src`. **But the code does not use the widget**: `components/trade/TradingChart.tsx:4` says *"Deliberately NOT the embed widget: an iframe from s.tradingview.com is…"*, and `components/market/LiveMarket.tsx:6` says it runs its **own** WS/REST transport. **And the CSP's own comment says the opposite** — `index.html:14-15` *"plus the TradingView widget loader (Live Market / Trade chart)"*, `:19` *"frame-src: TradingView's chart iframe"*. |
| **Proposed change** | Remove the three TradingView origins from `script-src`, `frame-src` and `img-src`, and fix the comment. **Zero functional cost** — nothing imports or embeds them. |
| **Impact** | **Security** — it closes the **only remote-script hole** in the app, and it makes `PRIVACY.md:89-94`'s *"no third-party scripts"* claim **literally true** rather than merely behaviourally true. |
| **Effort** | **S** (one file, three lines) |
| **Risk** | **S** — but **verify**: `npm run build && npm run boot-probe` (the production bundle is the only place the CSP applies) and a visual check of the chart and the Live Market surface. |
| **How to verify** | A test asserting `script-src` contains no `unsafe-inline`/`unsafe-eval` and **no third-party origin**, and that `frame-src` contains **no** third-party origin. **That test would have caught this automatically** — and it is also the test `electron/main.cjs` has never had. |
| **Roadmap** | **NEW** — nothing in the corpus mentions the CSP's contents. `R-247`/`R-248` cover the *other* deferred security items (no logger, no key pool, SQLCipher off). |

### E-22 — Stop swallowing the backup and the pattern-memory failures

| | |
|---|---|
| **Problem** | Two silent data-loss swallows. (a) `App.tsx:2000` — `void createBackup(activeUsernameRef.current).catch(() => {})`. A failed **auto-backup** (`services/infrastructure/BackupService.ts:34`, every 30 minutes, `:644-649`) produces **no signal at all**; the trader believes they have a backup cadence and learns the truth only when they need it. (b) `hooks/useTradeJournalActions.ts:93, 135, 379` — `void syncPatternMemory(null, …).catch(() => {})`, three call sites where the pattern-memory synthesis is silently lost. |
| **Evidence** | as left; the **pattern to follow already exists in the repo**: `MemoryFilesService.persist` records the failure, **rethrows** so no caller's handling changes, and clears on the next success — and `getNotebookWriteFailure()` is the one place that knows a write never reached disk, read by `memoryHealth` and by `App.tsx:28`. |
| **Proposed change** | Surface both. The backup failure belongs in the same place the notebook's failure is surfaced (the Health tab); the pattern-memory failure belongs in the Learn surface's inbox. **Neither needs a new store** — both already have somewhere to go. |
| **Impact** | **Reliability** — a silent backup failure is the worst kind, because the trader's false confidence is unbounded. **Accuracy** (a lost pattern-memory synthesis is a lost learning event). |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | Force a backup failure (a read-only profile) and confirm the Health tab shows it. The pattern-memory case: a rejected promise in a unit test and assert the signal. |
| **Roadmap** | **NEW** — `AGENTS.md` documents the notebook's rule as *"Never add a swallow-and-continue around a notebook write"*; **the missing part, named: the rule is not written for the two other writes.** |

### E-23 — The notebook needs a recovery affordance, and its hard cap does not work

| | |
|---|---|
| **Problem** | (a) The notebook is **one replace-in-place blob** (`services/learning/MemoryFilesService.ts:250`) with **no version, no checksum and no recovery affordance**. A corrupt blob serves an **empty notebook** with only a `console.warn` (`:173`) — the trader's entire thinking, unrecoverable. (b) **`notebookPressureAllows('appends')` and `('all')` are dead branches**: `:443-448` defines three kinds, but the only call site (`:690`) passes `'newFiles'`. **At the hard cap the notebook still accepts appends and updates** — and `utils/memoryBudget.ts:40-43` ("appends still land") contradicts the module's own doc at `:439-442` (*"`all` refuses every model write"*). |
| **Proposed change** | (a) A `.corrupt.<timestamp>` sidecar written when the blob fails to parse, plus a version field and a checksum — **and a restore path in Settings → Data**. That converts an unrecoverable-looking loss into a recoverable one. (b) Decide whether the hard cap is meant to refuse appends. If yes, pass the right kind at the call site and add a test. If no, change the doc. **Do not leave the code and the doc disagreeing** — this is the repo's own *"reader without a writer"* pattern, now in the docs. |
| **Impact** | **Reliability** (the trader's own notes are the one thing the app cannot regenerate) · **Accuracy** (the hard cap is the app's promise that the notebook never grows without bound) |
| **Effort** | **M** |
| **Risk** | **M** for (a) — the sidecar must never become a second source of truth. **S** for (b). |
| **How to verify** | A test that writes a corrupt blob and asserts a sidecar exists and the app reports it; a test that at the hard cap an append is refused. |
| **Roadmap** | **PARTIAL** — `G-31` records the doctrine slot as *"an unaccounted always-on layer"* and `R-233` records the same for the budget. **The missing part, named: no item covers the notebook's *corruption* path, and no item covers the two dead pressure branches.** |

### E-24 — Give `electron/main.cjs` behavioural coverage

| | |
|---|---|
| **Problem** | **The largest untested surface in the app.** `electron/main.cjs` is 1,362 lines and has **zero** behavioural coverage. `tests/electronIpcContract.test.ts` is **pure string analysis** (`:26-37` `readFileSync` + regex); `tests/providerRequestPolicy.test.ts:263-274` asserts the file *contains the string* `require(...)`; `tests/reasoningSideChannelParity.test.ts:17` and `tests/desktopUsageBridge.test.ts:19` read it **as text**. `tests/sseParser.test.ts` is the **only** file that executes electron code. **The `app://` traversal check, the navigation rules, the permission-denial handler, the `safeStorage` round-trip, the `provider:chat` body construction and the degrade chain are all untested at runtime.** The file is outside `tsc` (`tsconfig.json:31`) and outside coverage (`vitest.config.ts:91`); the only gate is `node --check`, which **parses and proves nothing**. |
| **Proposed change** | Extract the *pure* parts of `main.cjs` into testable modules — the `app://` path resolver, the navigation decision, the permission decision, the `provider:chat` body builder — and unit-test them. `electron/sseParser.cjs` already shows the pattern works: it is a `.cjs` file that `tests/sseParser.test.ts` **imports** (and `allowJs` is on). |
| **Impact** | **Reliability** (the desktop shell is what the user launches) · **Security** (the traversal check and the navigation rules are the app's trust boundary) · **Maintainability** |
| **Effort** | **M** |
| **Risk** | **S** — extraction only, no behaviour change. |
| **How to verify** | The new tests fail when the corresponding guard is removed. |
| **Roadmap** | **NEW** — `AGENTS.md:65-122` names the *type-check* gap in the Electron shell honestly; **the missing part, named: it names the type-check gap, not the behavioural-coverage gap.** The two are different, and the second one is bigger. |

### E-25 — Take the root out of the streaming hot path

| | |
|---|---|
| **Problem** | `App.tsx` (2,672 lines) subscribes to `chatStore` through `useSyncExternalStore` (`App.tsx:2`), and `hooks/analysisPipeline/streamThrottlers.ts:72` throttles the deltas to one update **per frame** — so a **2,672-line root re-renders at 60 Hz** for the whole length of a streamed answer. The leaves are memo'd, but the root is in the hot path. |
| **Proposed change** | A memo'd transcript component that subscribes to the store **directly**, so the streaming updates stop at the transcript instead of at the root. The root keeps the coarse state it needs. |
| **Impact** | **Speed** — the app's feel while an answer streams, on the surface the trader spends the most time on. |
| **Effort** | **M** |
| **Risk** | **M** — it is a state-ownership change, and `AGENTS.md` documents that *"writing a ref during render is a load-bearing idiom here"*. Measure before and after. |
| **How to verify** | React DevTools: the **root's** commit count during a 30-second stream, before and after. **[Unverified — needs a profiler run]** the current number. |
| **Roadmap** | **NEW** — `G-17` covers `App.tsx`'s *size*; nothing covers its *render behaviour*. |

### E-26 — One ticker, not 400

| | |
|---|---|
| **Problem** | `components/shared/AnalyzedRow.tsx:58` and `components/shared/ReasoningRow.tsx:90` each run **their own** `setInterval` **per row** — so a 200-message conversation holds **up to 400 live intervals**, each re-rendering its own row. Separately, `components/trade/TradeView.tsx:666` ticks a 1-second clock that re-renders the whole trade surface. |
| **Proposed change** | One shared ticker, subscribed to by the rows that need it. Move the trade-surface clock into the leaf that renders the time. |
| **Impact** | **Speed** · **Reliability** (400 timers is 400 chances for a leaked handle) |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | The interval count in a 200-message conversation, before and after. `npm run render-probe` for the visual check. |
| **Roadmap** | **NEW** — see Report 2 §E-16 for the clock half; this is the row half. |

### E-27 — `getPreferenceObject` must not conflate "missing" with "corrupt"

| | |
|---|---|
| **Problem** | `services/infrastructure/PreferencesService.ts:109-117` returns `null` for a missing key **and** for an unparseable one. **Any caller that treats `null` as "empty" and writes a default destroys a corrupt-but-recoverable blob.** Only `services/learning/MemoryFilesService.ts:145-176` defends (a raw read, and *"leave the stored blob UNTOUCHED"*). **Every other caller has no guard.** |
| **Proposed change** | A tri-state read: `getPreferenceObject` returns `{present, value}` (or a separate `getPreferenceObjectRaw` that surfaces the parse error), so a caller can distinguish "not set" from "set and broken". Then make the callers that matter (the notebook already does; the calibration and performance stores should) refuse to overwrite a corrupt value. |
| **Impact** | **Reliability** — a corrupt preference is currently an unrecoverable loss, and it is indistinguishable from an empty one. |
| **Effort** | **S–M** |
| **Risk** | **M** — it changes a widely-used return type. An additive variant (`getPreferenceObjectWithState`) is the low-risk shape. |
| **How to verify** | A test that writes a corrupt value and asserts the caller does **not** overwrite it. |
| **Roadmap** | **NEW** — `F-08` in Report 1 (§2.6) is the same family: *"the risky migration is the one-time sweep"*. **The missing part, named: nothing covers the corrupt-value path.** |

### E-28 — Validate the sender frame on every IPC handler

| | |
|---|---|
| **Problem** | **Not one of the 11 IPC handlers validates `event.senderFrame`.** Practical exposure today is low (one window, a local origin, `will-navigate` blocks off-origin navigation) — **but it matters precisely because E-21 leaves a remote iframe origin permitted in the CSP.** |
| **Proposed change** | A one-line guard per handler: `if (event.senderFrame !== mainWindow.webContents.mainFrame) return;`. A shared wrapper is better than eleven copies. |
| **Impact** | **Security** — defence in depth for the app's only privileged surface. |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | A test that invokes a handler with a foreign sender frame and asserts it is refused. |
| **Roadmap** | **NEW** |

### E-29 — Re-tighten the lint ratchet with **no code change at all**

| | |
|---|---|
| **Problem** | `eslint.config.js:111-113` says the cap *"must EQUAL the warning count on a clean main, because the cap is only a ratchet if it actually binds."* **It does not bind**: the cap is 889 and the measured count is **682** — **207 warnings of slack (23.3 %)**, so a new warning cannot fail CI. |
| **The cheap half** | **8 of the 682 are "unused eslint-disable directive"** (4 `no-console`, 3 `no-explicit-any`, 1 `no-useless-assignment`). **Delete those 8 directives → 674.** Then set `--max-warnings 674`. **Re-tightening the ratchet needs no code change at all** — the 449 `any` and 225 `no-unused-vars` are the real backlog, but they do not have to be paid down before the cap binds again. |
| **The breakdown** | 449 `no-explicit-any` (65.8 %) · 225 `no-unused-vars` (33.0 %) · 8 unused disable directives (1.2 %) · **0 errors**. |
| **Also** | **`App.tsx` is now `any`-free** — all 449 are elsewhere. And `eslint.config.js:124`'s *"28 unused LOCAL declarations remain there"* is **stale: it is 13** (across 11 statements, plus 5 unused imports). Fix the number in the same commit. |
| **Impact** | **Reliability** (the gate starts catching regressions) · **Maintainability** |
| **Effort** | **S** |
| **Risk** | **S** — the 8 deletions are dead directives; the cap change is one line. **Never raise the cap to go green** (`eslint.config.js:131-132`). |
| **How to verify** | `npm run lint:loose` on a clean checkout → expect 674; `npm run lint` → expect 0. |
| **Roadmap** | **NEW** — see Report 2 §E-06 for the same item seen as a bundle-size ratchet. The mechanism to copy is the repo's own (`R-222` shipped the anchor gate; `R-243` shipped its ratcheting floors). |

### 3A-rank — the second wave, ranked

| rank | id | what | impact | effort | roadmap |
|---|---|---|---|---|---|
| 1 | **E-21** | Close the CSP's unused remote origins | security | **S** | NEW |
| 2 | **E-22** | Stop swallowing the backup and pattern-memory failures | reliability | **S** | NEW |
| 3 | **E-29** | Re-tighten the lint ratchet (delete 8 dead directives → 674) | reliability | **S** | NEW |
| 4 | **E-26** | One ticker, not 400 | speed | **S** | NEW |
| 5 | **E-28** | Validate the sender frame on every IPC handler | security | **S** | NEW |
| 6 | **E-23** | Notebook recovery affordance + the two dead pressure branches | reliability | **M** | PARTIAL (G-31) |
| 7 | **E-24** | Give `electron/main.cjs` behavioural coverage | reliability · security | **M** | NEW |
| 8 | **E-27** | `getPreferenceObject`: missing ≠ corrupt | reliability | **S–M** | NEW |
| 9 | **E-25** | Take the root out of the streaming hot path | speed | **M** | NEW |

---

## 3B. The five Part B areas the first draft under-covered

An honest self-audit against the brief's list found five required areas that the first draft of
this report covered only implicitly, or not at all. They are added here rather than left implicit.
Each is a real finding with evidence, not a placeholder.

### E-30 — Tool design: the fixed schema tax is larger than most of the app's prompts

| | |
|---|---|
| **Problem** | Every request carries the **full JSON schema of every tool the surface offers** — and the surface's tool list is long. **The fixed schema tax per request is 31,455 chars ≈ 7,864 tokens on the dock** and **25,535 ≈ 6,384 tokens on the chat surface and the automation**. For comparison, the dock's entire mandate — `TRADE_CHAT_SYSTEM_PROMPT` — is 4,299 chars ≈ 1,075 tokens. **The tool schemas cost roughly seven times the prompt that tells the model what kind of assistant to be.** That is before a single token of the trader's question, the retrieved context, or the market packet. |
| **Evidence** | **[Verified live, measured]** the tool-definition arrays in `services/analysis/DeskToolsService.ts` (defs at `:820`): 31 core + 8 chart = 39 static tools, plus 2 mailbox and an unbounded forged set. Schema chars per tool are in Report 1 §5.1–§5.2; the per-surface totals are the sums. |
| **The compounding problem** | The chat surface is offered **30 of the 31 core tools** — including `get_indicators` (1,660 schema chars), `run_monte_carlo` (1,921), `get_all_timeframes` (649), `get_market_packet` (629) — and is offered **only one** of the 8 chart tools. `get_chart_view` (686 chars) is **withheld from the chat surface** — so the model pays for a tool it does not have, and is told to use it (the C-2 contradiction in Report 1 §3.6). **And `ARBITER_ALLOWED_TOOLS` (9 tools) is dead**, so 9 more definitions are maintained for nothing. |
| **Proposed change** | **Split the tool list by *need*, not by surface.** The chat surface should not carry `run_monte_carlo` (1,921 chars) or `get_all_timeframes` (649) if a scheduler or the dock can do them. **Better: publish a short index of the tools and let the model request the schema** — the app already has a tool for reading a prior result (`read_tool_output`), so the pattern exists. **Cheapest first step: remove `get_chart_view` from `DESK_TOOLS_PROMPT`'s text on the surfaces that do not have it** (C-2), and delete `ARBITER_ALLOWED_TOOLS`. |
| **Impact** | **Cost** (this is the largest single line item in a request) · **Speed** (fewer tokens to parse per round, and the whole array is re-sent each round — Report 1 §5.6) · **Accuracy** (C-2: the model is told to call a tool its allow-list refuses) |
| **Effort** | **M** |
| **Risk** | **M** — removing a tool from a surface changes what the model can do. The surfaces differ in what they are *for*, so this needs a per-surface decision, not a global cut. |
| **How to verify** | Measure the tokens-per-request before and after; check the tool-call *success* rate per surface (a refused call is visible in the transcript). The `skill-approval-probe` asserts the notebook bytes after a real click, so it will catch a tool that stops working. |
| **Roadmap** | **NEW** — nothing in the corpus discusses the schema tax. `R-107` (five new `render-probe` assertions) is adjacent but is about a11y. |

### E-31 — Observability: the app logs to `console` and has one log sink

| | |
|---|---|
| **Problem** | The repository has **~740 `console.*` calls** and **no logger**. There is **no packaged-Electron log sink** — so when the packaged app fails, there is nowhere for the failure to go. The gap is small and named in the corpus: *"no logger, no key pool, SQLCipher off"* is the surviving home of three deferrals from a deleted plan. |
| **Evidence** | **[Verified by code reading]** `console.*` is everywhere; `eslint.config.js:136` has `no-console: 'off'` — *"App uses console extensively; migrate to logger incrementally"* — and that is the **one rule that would have caught the class in §11.3** (the silent backup failure). `services/analysis/DeskToolsService.ts` logs a *harness-authored* line on every cache replay. There **is** a diagnostics surface (`components/settings/DiagnosticsPanel.tsx`, reading `lastPromiseError` / `lastGlobalError` / `lastCrashError`) — but it only sees **three** breadcrumbs. |
| **The gap that matters** | **Four** things the app already knows and never surfaces: (a) a failed **auto-backup** (`App.tsx:2000`); (b) a failed **pattern-memory synthesis** (3 sites); (c) a **corrupt notebook blob** (a `console.warn` at `MemoryFilesService.ts:173`); (d) a **truncated answer** — the truncation tally has no reader (Report 2 §E-13). All four are exactly the kind of thing a trader's "it just didn't work" report is about. |
| **Proposed change** | **Not a logger rewrite** — the corpus's own wording is *"not a rewrite"*, and that is right. A **single `utils/diagnostics.ts`** with a ring buffer of the last 100 structured events, one `report(event)` call, and one place that renders it. The four silent events above become `report()` calls. The packaged Electron shell writes the ring buffer to `userData/logs/app.log` on quit (a ~30-line addition to `main.cjs`). |
| **Impact** | **Reliability** (four failure modes become visible) · **Maintainability** (one place to look) · **UX** (the trader can see "the last backup failed") |
| **Effort** | **M** |
| **Risk** | **S** — a ring buffer in memory plus one file on disk. **Do not** log anything that contains a prompt, a key, a position or a query (Report 1 §11.2: the provider error paths already sanitise, and that discipline must carry into the new sink). |
| **How to verify** | Force each of the four failures and see it in the panel. `npm run typecheck && npm run test && npm run render-probe`. |
| **Roadmap** | **PARTIAL** — `G-14` / `R-247` name the missing logger and the missing packaged log sink, and are explicitly *"deferred … not a rewrite"*. **The missing part, named: no item names the four *specific* silent failures, which is the part that does not need a logger at all — it needs a `report()` call.** |

### E-32 — Developer experience: the gate scripts have no type checking and the alias config is dead

| | |
|---|---|
| **Problem** | (a) **`scripts/` is excluded from `tsconfig.json`**, and `tsconfig.scripts.json` includes `scripts/**/*.ts` — **which is exactly one file** (`scripts/test-candle-history.ts`). So **~6,200 lines of `.cjs` gate logic get no type checking.** `guards.yml` compensates with `node --check` (syntax only) and a separate narrow lint config — which is why `scripts/render-probe.cjs` is **138 KB**, larger than `App.tsx`, and `scripts/check-flow-doc-anchors.cjs` is **58 KB**. (b) **`tsconfig.json`'s `paths` (`:18-22`) is declared and never used** — dead config. (c) `forceConsistentCasingInFileNames` is off, and `ProviderConfigService.ts:10` imports `'../../shared/providerRequestPolicy.cjs'`, which resolves **only on a case-insensitive filesystem** — a latent portability break on a Windows-only target. (d) `AGENTS.md:124`'s *"28 unused LOCAL declarations remain there [in `App.tsx`]"* is **stale — it is 13.** |
| **Evidence** | **[Verified by code reading + measured]** `tsconfig.json:18-22`, `:31-32`; `tsconfig.scripts.json`; `scripts/` file sizes; `npx eslint App.tsx -f json` → 18 messages, of which 5 are unused **imports** and **13** are unused **local** declarations across 11 statements; `ProviderConfigService.ts:10`. |
| **Proposed change** | (a) Either add `allowJs: true` + `checkJs` for `scripts/**` to a second tsconfig, **or** accept the situation deliberately and say so in `AGENTS.md` — the current half-measure (a `typecheck:scripts` script that checks one file) is the worst of the three options, because it *looks* covered. (b) Delete the dead `paths` block, or point it at the alias the code actually uses (`vite.config.ts:447-449` defines `@`; `tsconfig.json` does not). (c) Turn on `forceConsistentCasingInFileNames` — it will flag the `.cjs` import, and that import should be fixed to the exact case anyway. (d) Fix the number in `AGENTS.md`. |
| **Impact** | **Maintainability** · **Reliability** (the gate scripts are the gates; a syntax-valid but wrong selector is the `surface-census.cjs` defect in `R-052`) |
| **Effort** | **S** for (b), (c) and (d); **M** for (a) |
| **Risk** | **M** for (c) — it may flag more than one import; **S** for the rest. |
| **How to verify** | `npm run typecheck` and `npm run typecheck:scripts` after each change; the workflows' shell check for (a). |
| **Roadmap** | **PARTIAL** — `R-052` names the `surface-census.cjs` selector defect and `R-058` names the stale probe assertion. **The missing part, named: no item covers the *type-checking gap* in `scripts/`, the dead `paths` block, or the casing portability risk.** |

### E-33 — Signal quality: the prompt promises a fresh packet, and the code sometimes cannot deliver one

| | |
|---|---|
| **Problem** | The dock's prompt states: *"every message arrives with a **fresh** packet"*. The code delivers a **cached** one — `services/trade/tradeChatContext.ts:83` has an 8-second cache — and, on a failed fetch, substitutes the literal string **"packet unavailable"**. So the model is told *"fresh"*, is given up-to-8-seconds-old data, and is given **no signal at all** that the data is missing or stale. Meanwhile the prompt's own contract (`constants/prompts/analysisPrompts.ts:94`) says *"Missing data is 'Unavailable' — never invent a price"* — and that rule reaches the model only on the **skill-eval** path (Report 1 §3.3 #1), never on the dock. |
| **Evidence** | **[Verified by code reading]** `services/trade/tradeChatContext.ts:83` (the substitution), `:168` (the "fresh" claim), `constants/prompts/analysisPrompts.ts:94` (the rule), and Report 1 §3.7 (the "Missing data is Unavailable" row, enforced via `dataUnavailable()` — but **except** `services/analysis/HybridIntelligenceService.ts:892`, which emits the prefix **without** the helper, so the line lacks the "treat this as UNKNOWN" guidance). |
| **Why it matters for a trader** | A stale or missing packet is the difference between a plan and a guess. The app has a *correct* convention for this — `utils/harnessMarks.ts`'s `DATA_UNAVAILABLE` sentinel, with a legend, and a test that fails on a hand-written marker. **The market packet is the one place the app does not use its own convention.** |
| **Proposed change** | Make the packet's freshness and availability **part of the prompt, using the app's own sentinel**: if the packet came from the cache, say so and say how old it is; if the fetch failed, emit `dataUnavailable()` instead of the bare string "packet unavailable". **And fix `HybridIntelligenceService.ts:892` to use the helper** — it is a one-line change and it is the one place the convention is bypassed. |
| **Impact** | **Accuracy** (the model is told the truth about its data) · **Reliability** (one convention, not two) · **UX** (the trader can see a stale packet) |
| **Effort** | **S–M** |
| **Risk** | **M** — it changes what the model sees on every turn. Measure the token cost of the extra marker (it is one line) and check the `harnessMarks` tests. |
| **How to verify** | A test that a failed packet fetch produces a `DATA_UNAVAILABLE:` line **and** that the legend matches it. `npm run skill-approval-probe` (it asserts the notebook bytes after a real click, so it exercises a real turn). |
| **Roadmap** | **PARTIAL** — `R-107` and `R-071` are about the *visible* consequences (the muted ladder, the silent truncation); `AGENTS.md` documents the `harnessMarks` convention. **The missing part, named: no item covers the market packet's own freshness/availability contract, which is the one place the app's own sentinel convention is bypassed.** |

### E-34 — "Signal quality" in the other sense: the *indicator* tools and the *decision* tools disagree about what a number means

| | |
|---|---|
| **Problem** | The app has **two different notions of "the R:R of this plan"** and **two different notions of "similar"** (Report 4 §2.4 and §2.5). The trader's *signal* — the indicator output, the pattern score, the confluence, the regime — is produced by deterministic code with **at least three overlapping scorers** and is then **graded by a formula that does not match the one the card shows**. So the number the model reasons over and the number the trader sees can differ, and the number that decides a confidence downgrade is neither. |
| **Evidence** | **[Verified by code reading]** the planned-R:R family: `utils/riskReward.ts:48` (canonical, nearest target) · `services/validation/AccuracyValidationService.ts:196` (index-0, the gate's authority) · `services/analysis/ScalpDetectionService.ts:178`, `:236` (index-0, the same gate run) · `services/trade/chartDrawings.ts:608-615` (a fourth copy, outside `riskReward.ts`) · `services/learning/PatternMemorySynthesisService.ts:260-268` (index-0 again). The similarity family: **seven** implementations, `AGENTS.md:216-221` naming only two. |
| **Proposed change** | One **scoring contract** the whole app reads: `utils/riskReward.ts` owns the planned ratio; a single `utils/similarity.ts` owns the pattern score with a named scale; the gate, the card, the clamp, the drawings label and the pattern synthesis all call them. **Note the direction of travel: this is E-02 and E-19, applied to the *signal* rather than to the plan.** |
| **Impact** | **Accuracy** (one number, one meaning) · **Profit** (the grade and the size follow the number the trader sees) · **Maintainability** |
| **Effort** | **L** (it is E-02 and E-19 with the scorers included) |
| **Risk** | **M** — the scorers are not interchangeable (Report 4 §2.5: text-vs-text, setup-vs-trade and content-word overlap are three different questions). **Consolidate the two live setup-vs-trade scorers (`PatternMemorySynthesisService.calculateSimilarity` and `LiveBacktestService.calculateSimilarity`) last, and separately.** |
| **How to verify** | The replay harness (E-20) is the instrument: re-grade the stored trades and diff. |
| **Roadmap** | **NEW** — `R-235` ("Decide what a rule is, once") and `G-29`/`G-30` touch the *skill* model, not the *scoring* model. **The missing part, named: no item names the scoring duplication.** |

### 3B-rank

| rank | id | what | impact | effort | roadmap |
|---|---|---|---|---|---|
| 1 | **E-31** | Observability: one `report()` sink, four silent failures surfaced | reliability | **M** | PARTIAL (G-14) |
| 2 | **E-33** | Signal freshness and availability, using the app's own sentinel | accuracy | **S–M** | PARTIAL (R-071) |
| 3 | **E-30** | Tool design: cut the fixed schema tax | cost · speed | **M** | NEW |
| 4 | **E-32** | Developer experience: the `scripts/` type-check gap, the dead `paths`, the casing risk | maintainability | **S–M** | PARTIAL (R-052) |
| 5 | **E-34** | One scoring contract for the signal | accuracy · profit | **L** | NEW |

### 3B-coverage — the brief's Part B list, now complete

| the brief's area | where it is now |
|---|---|
| signal and plan quality | **E-33**, **E-34** (signal) · **E-02**, **E-19** (plan) |
| gates and refusals | **E-02** · Report 1 §4.2 and §1.5 (the gate that may not be wired) |
| risk and cost modeling | **E-03** (cost) · **E-12** (risk/size) · **E-02** (the R:R) |
| prompt and context efficiency | **E-01**, **E-05**, **E-08**, **E-09** · Report 1 §3.10 and §5.6 (the measured sizes) |
| memory and skills | **E-05**, **E-23** · Report 1 §2.4 (the retention ladder) |
| learning loops | **E-05**, **E-18** |
| evaluation and replay | **E-20** (replay) · Report 1 §3.2 (the skill A/B evaluator — the closest existing machinery) |
| tool design | **E-30** |
| error handling | **E-22** (the silent swallows) · **E-27** (missing ≠ corrupt) · Report 1 §11.4 (the retry layer) |
| performance | **E-16**, **E-25**, **E-26** |
| **observability** | **E-31** |
| testing | **E-11**, **E-24** · **E-29** (the ratchet) |
| **developer experience** | **E-32** · **E-07** (`noUnusedLocals`) |

---

## 3C. Cross-check against the previous audit, and the items it found that I missed

**The user's question — "does the current plan contradict `docs/analysis/06-independent-review-2026-10-18.md`?" — is answered in Report 5 §7, with the full item-by-item mapping.** This section carries the *new* material: the findings the previous review had that my first draft did not, and the one place where I now **defer to it**.

**Source:** the orphan commit `508b691a`, `docs/analysis/06-independent-review-2026-10-18.md`
(58,715 B, 910 lines) — an independent trading review authored 2026-10-18 against a tree 162
commits before my pin. **Every claim below was re-verified at the current HEAD (`69c4aa33`).**

### 3C.1 The one I defer to: a **third option** for the context decision

Their **QW5** and their **M1** are the same item as my **E-01** — *"Decide the context policy —
inject or delete"*. We agree on the decision; we differ on the **default**, and **they are right
about a third option that I did not name**:

- **My default:** cut the assembly first, then re-add deliberately.
- **Their QW5:** *put the trading contract back in the live prompt* — `HARNESS_CONTRACT_PROMPT`
  (1,582 chars) composed into the Chat-surface and dock system prompts through
  `utils/composePrompt.ts`, which already dedupes the contract.

**The third option is better than both of ours, and it is cheap.** The harness contract carries the
**confidence ladder**, the **marker convention** (`HARNESS_TURN_MARK` — the only text that tells a
seat which words are the app's and which are the trader's) and the **risk rules**. The expensive
part of `enhancedPrompt` is the *retrieved context*, not the contract. So:

> **E-01 is refined into two decisions, not one.**
> **(a) Inject the CONTRACT** (1,582 chars) into the P1/P2/P3 system prompts — **S effort**, and it
> closes the C-5 contradiction (the mark is used in the user role on every desk turn and explained
> nowhere) and gives the model a ladder and a "no trade is a decision" instruction.
> **(b) Decide the REST of the context separately** — the retrieved notebook, the matched skill
> body, the similar setups, the reflections, the hybrid packet — and **cut it by default**, because
> the pull path (`recall`, `get_notebook_map`, `read_memory`) already exists and the push path's
> budget was never settled.

**And the change is what makes the ledger honest:** inject **and** record, or record only what was
injected. Never one without the other.

### E-35 — The finding I missed that is the sharpest in either audit: **the deterministic skill layer is computed and thrown away** (§3C.2)

| | |
|---|---|
| **Problem** | `applyNotebookSkillsToAnalysis` (`services/learning/SkillMemoryService.ts:3494`) is the function that applies the **hard `avoid` veto**, the **candidate cap** and the **confidence downgrade** — the entire deterministic half of the skill system. **It has no production caller.** Its telemetry helper `recordEnforcement` is dead with it. Separately, `services/learning/skillPredicateGate.ts:200` computes `ceilings` from the fired `avoid` skills and returns `ceiling?: number` (`:78`) — **and the consumer discards it**, because `predicateGate` is one of the seven blocks folded into the never-sent `enhancedPrompt` (F-01). |
| **Evidence** | **[Verified at HEAD `69c4aa33`]** `git grep applyNotebookSkillsToAnalysis` returns: the **definition** (`:3494`), three **comments** (`SkillMemoryService.ts:793`, `services/validation/TradeValidationGate.ts:876`, `utils/harnessSettings.ts:39`) — and **every actual call site is in `tests/`** (`tests/approvalGate.test.ts:110,123`, `tests/decisionBiasClosure.test.ts:297,310`, `tests/harnessMemory.test.ts:384,419,485,491,500,534,571`, `tests/learningLoopMachinery.test.ts:758,765,772`). **Zero production callers.** `git grep recordVeto` returns the definition (`services/ui/VetoLedgerService.ts:90`), a comment (`:9`), an internal catch (`:160`) — and **seven test call sites** (`tests/decisionBiasClosure.test.ts:318`, `tests/learningLoopMachinery.test.ts:200-336`). **Zero production callers.** |
| **Why it matters** | The app's whole thesis is *"the agent proposes, **deterministic code checks**, the user decides."* **The deterministic check is not connected.** The learner's hard veto — the thing that makes a skill the trader's own rule rather than a suggestion — is computed and dropped. And `VetoLedgerService`'s ledger, which the Health tab and `memoryHygiene` **read**, is never **written**. |
| **Proposed change** | **Wire `applyNotebookSkillsToAnalysis` into the plan path** (`services/trade/presentTradeTool.ts` / `buildProposedTradeAnalysis`), and pass the `predicateGate.ceiling` into the recorded probability with a `validationWarnings` note naming the skill. **And write the veto** when the veto fires — `VetoLedgerService.recordVeto` already exists and already has the right shape. **Do NOT re-enable the hard veto until E-37 raises the sample floor.** |
| **Impact** | **Accuracy** (the trader's own rules start binding) · **Reliability** (a read-but-never-written ledger is a lie on the Health tab) · **Maintainability** (a function with 10 test call sites and 0 production ones is the clearest "green suite over dead code" case in the repo) |
| **Effort** | **S–M** |
| **Risk** | **M** — a wrong predicate can suppress a good trade. That is exactly why E-37 must land first. |
| **How to verify** | A test that a fired `avoid` predicate at ceiling 0.40 caps a 72 % plan to 40 % **and stamps the reason**; a retired or zero-sample skill does not. And that the veto ledger's write count is non-zero after a vetoed plan. |
| **Roadmap** | **NEW** — no roadmap item names the enforcement disconnection. The closest is `R-151` (*"nothing checks `approvedBy` or `whyAccepted` at injection time"*) — **the missing part, named: that is the approval gate, not the enforcement path, and neither one has a caller.** |

### E-37 — The evidence floors are too low for the outcomes that are about to arrive (§3C.3)

| | |
|---|---|
| **Problem** | The learning system's sample floors are tuned for a world where there are no outcomes. `MIN_SAMPLE_FOR_VETO = 2` (`services/learning/SkillMemoryService.ts:385`) — **a two-trade sample can veto a real setup**, and a veto can *zero* it. `MIN_CLUSTER_FOR_SKILL = 3` (`:358`) — a three-trade cluster can mint a skill. `MIN_SAMPLE_CONFIRMED = 5` (`:359`). |
| **Evidence** | **[Verified at HEAD]** `services/learning/SkillMemoryService.ts:358, 359, 385`. |
| **Why it matters** | **This is a sequencing dependency, and it is the one that bites.** The moment the outcome loop is fixed (E-18), these floors start producing confident, wrong conclusions *from the data they have*. Fixing the outcome loop **without** raising the floors manufactures noise. |
| **Proposed change** | Raise them **before** the outcomes arrive, in this order: `MIN_SAMPLE_FOR_VETO` 2 → ≥10 (the one that can zero a real setup); then `MIN_CLUSTER_FOR_SKILL` 3 → ≥10 and `MIN_SAMPLE_CONFIRMED` 5 → ≥20. `services/learning/metaCalibration.ts` already proposes this. |
| **Impact** | **Accuracy** · **Profit** (a wrong veto is a lost trade) · **Reliability** |
| **Effort** | **S** |
| **Risk** | **S** — but it needs its existing tests updated deliberately, not incidentally. |
| **How to verify** | The existing suites updated on purpose; then the promotion rate measured over the new settled population. |
| **Roadmap** | **NEW** — no roadmap item names the floors. `R-180` (the 9-item Improve list) is the closest home; **the missing part, named: the floors are not on that list, and they are a hard dependency of E-18.** |

### E-38 — A presented plan never expires, so the denominator is wrong (§3C.4)

| | |
|---|---|
| **Problem** | `validityDurationMinutes` is declared optional in the schema (`schemas/tradeAnalysis.ts:218`), transformed (`:468`) and **read** by the scalp detector (`services/analysis/ScalpDetectionService.ts:86-87`) — but **no producer ever sets it**. `hooks/useTradeLogging.ts:301` says so in a comment: *"label-only, so no `validityDurationMinutes` appears on a…"*. So a plan that never triggers **vanishes** instead of being recorded as `ENTRY_NOT_HIT`. |
| **Evidence** | **[Verified at HEAD]** the four sites above; no writer. |
| **Why it matters** | **The denominator.** Win rate counts only the setups that reached a level. A setup that never triggered is not a loss and not a win — it is a **skip** — and it is currently invisible. The `TradeOutcome` enum has `ENTRY_NOT_HIT` (`types/enums.ts:9-15`), so the outcome exists; nothing produces it. |
| **Proposed change** | Stamp a default window in `buildProposedTradeAnalysis` — e.g. 24 h for scalp-class, 72 h for swing, derived from `withDetectedTradeType` — and let the autopilot's existing expiry branch (`services/ui/OutcomeAutopilotService.ts:443-456`) write `ENTRY_NOT_HIT` at expiry. |
| **Impact** | **Accuracy** (the denominator becomes honest) · **Profit** (the expectancy stops being overstated) |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | After E-18, the ratio of `ENTRY_NOT_HIT` to resolved rows is non-zero and stable across two weeks. |
| **Roadmap** | **NEW** — and it is a **prerequisite** for E-18's "net expectancy" claims, which are worthless without it. |

### E-39 — The most consequential output in the app is produced at the lowest thinking tier (§3C.5)

| | |
|---|---|
| **Problem** | `EFFORT_BY_TASK` (`services/providers/reasoningControls.ts`) is a role→effort schedule: `analysis: 'high'`, `rebuttal: 'high'`, `moderatorVerdict: 'max'`, `clarification: 'low'`, **`chat: 'low'`**, `postMortem: 'medium'`, `supervision: 'medium'`, `ocr: 'low'`. The **Chat surface and the dock** — the paths that can call `present_trade` — resolve through `chat`. **The one output that matters is produced at the lowest tier**, unless the trader manually raises the dial. And the tier the prompt *advertises* is not the tier that is sent: the chat turn asks for temperature 0.4 (`services/trade/chatSurfaceTurn.ts:265`) and automation for 0.3 (`services/trade/automationTurn.ts:198`), but on a thinking-enabled Anthropic model the transport **omits temperature** (`shared/providerRequestPolicy.cjs:180-185`) — the provider default applies. |
| **Evidence** | **[Verified at HEAD]** `services/providers/reasoningControls.ts` (`EFFORT_BY_TASK`), `services/trade/chatSurfaceTurn.ts:266,327` (the pass-through), `services/trade/chatSurfaceTurn.ts:265` and `services/trade/automationTurn.ts:198` (the requested temperature), `shared/providerRequestPolicy.cjs:180-185` (the omission). |
| **Proposed change** | Add a **`tradingDecision` task tier** (`high`; `max` for automation) and use it for any turn that can call `present_trade`. And publish the **effective** temperature per (format × thinking) in one table, asserted by a test — so the setting the trader can see is the setting that is sent. |
| **Impact** | **Accuracy** — the prior review's phrasing is the right one: *"the same model, asked to reason longer, on the one output that matters."* · **Cost** (it will cost more per turn; that is the trade) |
| **Effort** | **S** |
| **Risk** | **S** for the tier; **M** for the cost increase. |
| **How to verify** | A paired A/B on a fixed set of recorded prompts, scoring plan quality against the gate — which needs E-20's replay to store the prompts. |
| **Roadmap** | **NEW** — no roadmap item names the effort tier or the temperature mismatch. |

### E-40 — The journal's timestamp is the **write** time, so every dashboard measures the wrong thing (§3C.6)

| | |
|---|---|
| **Problem** | `hooks/useTradeLogging.ts:284` writes `timestamp: message.createdAt || new Date().toISOString()` — the **decision** time — and `:307` writes `timestamp: new Date().toISOString()` — the **write** time. The **journal row** uses the write time. For an autopilot row that is when the trader **confirmed**, possibly days after entry. `analysis.createdAt` holds the decision time, but the dashboards group and sort by `timestamp` (`components/dashboards/WinRateDashboard.tsx:117-125`, `EquityCurveDashboard.tsx:34-43`, `LearningDashboard.tsx:106`). |
| **Evidence** | **[Verified at HEAD]** the two writes, and the three dashboard reads. |
| **Why it matters** | **Every hour-of-day, day-of-week and equity-curve analysis is measuring confirmation time, not trading time.** The equity curve can reorder trades. |
| **Proposed change** | Add `decidedAt` (from `analysis.createdAt`) and use it for all time-bucketed analytics; keep `timestamp` as `loggedAt` for provenance. Backfill from the embedded analysis — **the data is already in the row.** |
| **Impact** | **Accuracy** · **Profit** (an equity curve that reorders trades is a wrong equity curve) |
| **Effort** | **S–M** |
| **Risk** | **S** |
| **How to verify** | A unit test with a trade decided Monday and confirmed Friday lands on Monday; the equity-curve order matches the decision order. |
| **Roadmap** | **NEW** |

### E-41 — The default leverage is 100×, and the liquidation buffer is in the unreachable module (§3C.7)

| | |
|---|---|
| **Problem** | `DEFAULT_LEVERAGE = 100` (`utils/conversationUtils.ts:6`) is the app-wide default. `computeLiquidationBuffer` (`utils/ticketSize.ts:194`) exists and is **in the module with no production caller** (E-12). So the app defaults to 100× and never shows the trader how close the liquidation line is. At 100×, a stop 0.19 % from entry is a ~15.9 % account move at 1R on full notional, and a 1 % adverse wick is a total loss. |
| **Evidence** | **[Verified at HEAD]** `utils/conversationUtils.ts:6` and `:18` (`leverage: DEFAULT_LEVERAGE` — *"Match the app-wide default (useTradeLogging / schema / UI)"*). |
| **Proposed change** | **Two parts.** (a) On the proposal card, show the **liquidation buffer** beside the stop: *"stop is 0.19 % from entry; liquidation is ~1 % away; a 0.8 % wick is total loss"* — `computeLiquidationBuffer` is already written. (b) **The 100× default is a product decision, not a code change** — it should be the trader's setting, defaulted lower, with the buffer warning always visible. |
| **Impact** | **Profit** (a wrong size is the most expensive error a manual trader makes) · **Accuracy** (the trader is not shown the risk) |
| **Effort** | **S** for the warning (it rides on E-12) · **S** for the setting |
| **Risk** | **S** |
| **How to verify** | The card shows the buffer for a fixture plan; a plan whose stop is inside the buffer is flagged. |
| **Roadmap** | **NEW** — the leverage default is not in the corpus. |

### E-42 — A decline leaves no object — there is no HOLD (§3C.8)

| | |
|---|---|
| **Problem** | `TradeOutcome` has WIN, LOSS, PENDING, ENTRY_NOT_HIT, SKIPPED (`types/enums.ts:9-15`). **There is no NO_TRADE / HOLD.** A model that declines to present a plan leaves **no row, no candidate, no reason** — the only trace is the level-watch's armed list. And there is **no daily or per-candle job** that scans the universe and logs candidates: `run_screener` (`services/trade/screener.ts:110`) walks the top-N universe deterministically but is only called on demand by the tool and the screener panel, and **automations have no symbol field** (`types/automation.ts:34-68`) — the instrument comes from the prompt text. No `shadow`, `candidate` or `daily scan` store exists. |
| **Evidence** | **[Verified by code reading]** the enum, the screener's on-demand-only callers, the automation type. |
| **Why it matters** | **"Are we skipping winners?" is structurally unanswerable today.** That is the largest question a trading app can be asked, and the app cannot answer it because the skip is not a first-class object. |
| **Proposed change** | **Two steps.** (a) **A `decline_trade` tool** — the model calls it with a reason and the levels it rejected. That is the HOLD record, it is **S/M**, and it fits the existing tool architecture (`present_trade`'s sibling). (b) The **shadow log** — one row per candidate, taken and not taken. The prior review's B1 specifies it: symbol, timeframe, decision time, the feature snapshot, regime, prompt+packet hash, model, the parsed signal **including HOLD**, confidence + `probabilitySource`, entry/SL/TP, which gates ran and which refused, and the cost inputs — with a resolver that settles TP/SL/timeout into `pnlR`, `netR`, MAE/MFE and `resolvedAt`, persisted in Preferences with a stated retention rollup (the notebook cannot hold it). **The pieces already exist and must not be rebuilt:** `outcomeEngine.scanTradeOutcome` (the resolver), `passMining.resolvePassOutcome` (already classifies `MISSED_OPPORTUNITY` vs `CORRECT_PASS`), `VetoLedgerService` (settles what a veto would have done: `WOULD_TP`/`WOULD_SL`/`EXPIRED`), `useAutomations` + `services/automation/*` (cron, 15 s tick, catch-up, run history), `screener.ts` (the universe walk). |
| **Impact** | **Accuracy** · **Profit** (threshold tuning and prompt replay become possible) · **Reliability** (the biggest question becomes answerable) |
| **Effort** | **S/M** for (a) · **L** for (b) |
| **Risk** | **M** for (b) — each candidate can be a model call. Make it opt-in, cap candidates per run, estimate tokens before enabling, and fail closed with no ready provider. |
| **How to verify** | For (b): replay one week of settled shadow rows against the live thresholds and check that a changed threshold improves expectancy **out of sample** — walk-forward, never random. |
| **Roadmap** | **NEW** for (a) and (b). `R-119` (the rating store) and `R-120` (the review destinations) are adjacent in shape but not the same. **Note the brief excluded regime routing — and the prior review's own B3 says doing regime routing before the shadow log is *"fitting noise"*, so the exclusion and their sequencing agree.** |

### E-43 — `minEdge`: refuse a plan whose net expectancy at its own probability is ≤ 0 (§3C.9)

| | |
|---|---|
| **Problem** | The app caps confidence and downgrades tiers, but **nothing refuses a plan on the arithmetic of its own edge**. A plan at 45 % probability with a 1.1 R:R is a *negative* expectancy after fees, and the app will present it. |
| **Evidence** | **[Verified by code reading]** the gate's cap-and-downgrade behaviour (Report 1 §4.2) and the absence of any expectancy test. |
| **Proposed change** | **One inequality, using numbers the app will have after E-03 and E-12**: `netEdge = p × netR_win − (1 − p) × netR_loss`; refuse when `netEdge ≤ 0`. It must be **the trader's threshold**, with the app showing the number it refused on and why. |
| **Impact** | **Profit** — this is the gate that would have caught the prior review's Plan A (**−1.63 R net**) before it was presented. · **Accuracy** |
| **Effort** | **S** (after E-03 and E-12) |
| **Risk** | **M** — a refusal is a lost opportunity if the probability is mis-calibrated. That is why it must be the trader's dial, not the app's. |
| **How to verify** | A fixture plan with a negative `netEdge` is refused with a named reason; a positive one is not. |
| **Roadmap** | **NEW** — no roadmap item proposes an expectancy-based refusal. |

### 3C.10 The two things the prior review had that I did not, and I am carrying forward

- **A deterministic baseline: "has anyone asked whether the model beats a fixed rule?"** For every
  settled candidate, compute what *"trade every `scan_setups` signal with the same SL/TP"* would
  have returned. **If the deterministic baseline wins, that is the most important thing the app can
  tell its user** — and it is a few lines against the shadow log. **This is a *use* of my E-20
  (the replay harness), and it is the sharpest framing of what replay is for.** Carried forward as
  **E-20's headline use case.**
- **An exit-model label.** The 50/50 blend and the 150 % zone are **unrecorded assumptions**
  (`services/backtesting/outcomeEngine.ts:69-71` blends TP1 and breakeven; the 150 % zone
  `extendedSlPrice` `:119-121` is an unrecorded policy). Store `exitModel: 'blended' | 'single' |
  'breakeven' | 'trail'` on the row, then replay the same signals under hold-to-last-TP,
  breakeven-only and a trailing stop. **"No new predictions, just a different management rule on the
  same entries"** — the cheapest route to a genuine expectancy improvement. **Carried into E-20.**

### 3C.11 One prior claim that does **not** verify at HEAD

| prior claim | verdict at HEAD `69c4aa33` |
|---|---|
| `constants/prompts/analysisPrompts.ts:299` — *"Family C … Highest win rate (~86 %)"* asserted as fact | **NOT FOUND.** `analysisPrompts.ts` is **190 lines** at HEAD (the citation's line number is past its end), and a search for `win rate`/`winrate` across `constants/prompts/` returns **zero** hits. Either the text was removed with the lens deletion, or the citation was wrong. **The finding is not carried forward.** |

### 3C.12 The prior review's dead-module list, checked against mine

Their §2.14 list: `utils/ticketSize.ts`, `services/validation/TradeValidationGate.ts`,
`services/validation/ValidationConstants.ts`, `services/analysis/EntryTimingService.ts`,
`services/analysis/ProbabilityEngineService.ts`, `services/analysis/convictionDrift.ts`,
`services/backtesting/BacktestingService.ts`, `services/learning/MemoryConsolidationService.ts`,
`utils/teamRoster.ts`, `utils/navModality.ts`.

**My sweep found 4 orphans** (`AvoidSetupsSection.tsx`, `MemoryConsolidationService.ts`,
`messageDisplayText.ts`, `plugins/GallerySaver.ts`) plus the 63 dead exports and 202 dead `export`
modifiers — **which covers their list as a superset**, except for **four modules my sweep did not
flag** because they are reachable *from a dead module* rather than from nothing:
`EntryTimingService.ts` (imported only by the dead `TradeValidationGate`),
`navModality.ts`, `SessionGuardService.ts` (reads `equityUsd`, and is unreachable) and
`ValidationConstants.ts` (imported only by the dead gate). **Those four are dead-by-transitivity —
a second-order orphan class neither audit had named.** They are added to Report 4 §13.

---

### E-50 — Remove the tests that only cover code the app never loads — **with a keep-list**

| | |
|---|---|
| **Problem** | A reachability graph over **521 source modules** from the real entry points finds **29 that the app never loads** — and **25 test files exist only to cover them**. Two of the three largest are the product's core promise: **`services/validation/TradeValidationGate.ts` (986 lines, the 20-check gate) has ZERO production callers**, and **`services/backtesting/BacktestingService.ts` (1,414 lines)** is named in a *comment* by `utils/riskReward.ts:7` as the realized-R authority. The third, **`components/analysis/AnalysisProgress.tsx`**, is the **step ladder** — the roadmap says it is "muted"; it is **not mounted at all**. |
| **Proposed change** | **Four batches, and a keep-list that is the important half.**<br>**T1 — the unambiguously dead** (5 test files, 482 lines + 4 modules, 596 lines): `debatePods`, `ProbabilityEngineService` (×2 test files), `incrementalMarkdown`, `seriesPalette`. Delete the test **and** its module in one commit.<br>**T2 — dead-by-decision, HELD** (6 test files + 6 modules): the validation gate, the backtest engine, the step ladder, `EntryTimingService`, `convictionDrift`, `preRead`. **Each waits on the plan deciding that module's fate** — and three of them are the plan's biggest open decisions.<br>**T3 — the 15 mixed files** test live code: keep the file, drop the dead side-import.<br>**T4 — the 849 lines that LOOK useless and are NOT**: `themeContrast.test.ts` (393), `jsxNesting.test.ts` (283), `sourceCodeHelper.test.ts` (96), `aiTrendlinesDrawn.test.ts` (77) are **repo-wide source guards** — the repo's own lint, in test form. They import a *test helper*, which is why they look like orphans. **Never delete them.** |
| **The keep-list** | **`tests/ticketMathTiers.test.ts` (187) stays** — it is the only coverage of `utils/ticketSize.ts`, and **the plan wires that module (E-12)**. Deleting the test before the module ships removes the only proof it works. **`tests/accuracyValidation.test.ts` stays** until the gate's fate is decided. **`tests/financialMath.test.ts` stays** — 5 live subjects, 1 orphan side-reference. |
| **The rule** | **A test and its dead module go together, or neither** — a test that outlives its subject is the "green suite over dead code" defect itself. **Never delete a test to make a number smaller**; the suite's value is its coverage of what *ships*. Before any deletion, confirm the subject has **zero production importers** with a direct `git grep` for the import specifier — not a reachability pointer. |
| **Impact** | **Maintainability** (the suite stops proving things that do not run) · **Speed** (≈1,000 lines of test and ≈2,100 lines of dead module out of the tree) · **Accuracy** — because T2 forces the two biggest dead modules to be *decided* rather than left in limbo |
| **Effort** | **S** for T1 and T3 · **M** for T2 (it is a decision, not a deletion) |
| **Risk** | **LOW** for T1/T3 · **MEDIUM** for T2 — three of the six are decisions, and two of them are the product's promise |
| **How to verify** | `npm run typecheck && npm run lint && npm run test && npm run test:coverage`. The coverage ratchet (36/28/36/30) must stay satisfied **after** the deletions — removing 1,000 lines of tests can move it. |
| **Roadmap** | **NEW** — and it is **the last, and the largest, piece of the cleanup**: Report 4 §15 has the full per-file table, the batches, the keep-list and the four rules. |

## 3D. The three new features, as proposals

**Added 2026-10-20** at the owner's request. The deep dives that justify them are in Report 1
§12. These are the proposals those dives produced.

### E-45 — The Chat surface's run gets per-session ownership, and a conversation switch stops killing it

| | |
|---|---|
| **Problem** | The dock's run survives a surface switch because its state is hoisted into `services/trade/chatStore.ts` and its controller is per-session (`chatStore.beginRun` at `services/trade/chatTurnRunner.ts:850,1153,1196`). **The Chat surface's run does not** — it is owned by one module-level `analysisAbortController` (`hooks/useAnalysisPipeline.ts:327`), and the effect at `:351-367` aborts it on **any** `activeConversationId` change. Yet `:691-693` already binds every async write to the conversation the request started in, *"even if the user switches conversations before a provider response or stream chunk arrives"* — **the machinery for surviving a conversation switch exists, and the effect kills the run before it can be used.** |
| **Evidence** | Report 1 §12.1. `:351-367` vs `:691-703`; `services/trade/chatStore.ts:479,493`; `chatTurnRunner.ts:850`; the surfaces unmount at `App.tsx:2312,2357,2379`; the dock's deliberate no-abort at `components/trade/TradeChatPanel.tsx:696-697` |
| **Proposed change** | 1. Register the Chat surface's controller with `chatStore.beginRun`/`endRunOwned`, so a run is owned by a conversation, not by the hook. 2. **Stop aborting** in the `:351-367` effect: make the loading message, the step tracker, the in-progress flag and the steering queue **per-conversation**, and let the run write into its own conversation via the existing `updateRequestMessages`. 3. Make the double-submit guard per-conversation. 4. **Stop** aborts the active conversation's run only. 5. Deleting a conversation aborts that conversation's run. 6. Show a **busy badge** on conversations with a live run, so "it is still thinking over there" is visible. 7. **Keep** the profile switch cancelling — a different trader's data must not receive the previous trader's answer. |
| **Impact** | **UX** (the feature as asked) · **Accuracy** (an answer that arrives after you look at another conversation is an answer, not a cancellation) · **Reliability** (two conversations can now run at once, as the dock already allows) |
| **Effort** | **M** |
| **Risk** | **M** — it changes *when* a run dies. `tests/useConversationHousekeeping.test.tsx:45` asserts `handleCancelAnalysis` **is** called on a conversation load; that test must be flipped deliberately. |
| **How to verify** | A test that starts a run in A, switches to B, and asserts (i) A's controller was not aborted, (ii) A's text landed in A, (iii) Stop in B aborts only B, (iv) deleting A aborts A. Then `npm run render-probe` for the badge. |
| **Roadmap** | **NEW** — the dock's half is already shipped, so this is the **second half of a design that exists**, not a new idea. |

### E-46 — Level-3 sub-resources and a compatibility block for skills

| | |
|---|---|
| **Problem** | August's skill format is **already a deliberate port of the Agent Skills spec** — `services/learning/SkillMemoryService.ts:411-431` says so in a comment, with the two-face split (`# august:skill-ledger`, `:432`), spec-shaped `name` + `description` (`:1068-1070`), and a parser that loads a spec-only file as an unproven candidate (`:424-427`). Two convention elements are missing, and **one of them costs the trader something**: (a) **no `references/` / `scripts/` / `assets/`** — so a long procedure is **clipped** at `RECALL_SKILL_BODY_MAX` = **700 characters** (`services/learning/skillDocument.ts:6-8`) instead of being extended; (b) **no `compatibility` block** — a skill cannot declare the tools, env vars or platform it needs (August has `audience`/`lensScope`/`manualOnly`, which say *who may see it*, not *what it needs*). |
| **Proposed change** | (a) **Level 3**: let a skill carry a `references/<name>.md` note that the model pulls on demand with the same `recall` path that already pulls the body. The storage problem is real — the notebook is a flat list of `.md` entries, not a tree — so the cheapest version is a **sibling note referenced by path in the frontmatter**, not a directory tree. (b) **`compatibility`**: one more frontmatter key family (`requiresTools:`, `requiresEnv:`, `platforms:`), written by the craft and checked by the retrieval, so a skill that needs a tool the seat does not have is **not injected**. |
| **Impact** | **Accuracy** (a long procedure stops being lossy) · **Reliability** (a skill that needs a missing tool is not injected) · **Maintainability** (the format becomes the spec's, so a Claude/Hermes skill is a first-class import) |
| **Effort** | **L** for (a) — it is a storage-shape change · **S** for (b) |
| **Risk** | **M** for (a) — the notebook is the one store the app cannot regenerate. **This is the only item in the whole plan where a bug can lose the trader's own thinking.** It must land **after** E-48's repair path exists, so a broken split is recoverable. |
| **How to verify** | A skill with a `references/` note: the index line stays one line, the body stays ≤ 700 chars, and the note is pullable and cited. A skill with `requiresTools: [run_screener]` is not injected into a surface without that tool. |
| **Roadmap** | **NEW** — but the *format* itself is already a port; the missing part is named precisely in Report 1 §12.2.2. |

### E-47 — The small convention gaps: filename, category, version, URL install

| | |
|---|---|
| **Problem** | The skill **content** is spec-shaped; the **envelope** is not. Files are `slug.md` (`isSkillFile`, `services/learning/SkillMemoryService.ts:405-406`), so a `SKILL.md` dropped into the skills folder is not recognised as spec-shaped. There is no `version` key. The notebook's folders are top-level (`skills/`, `rules/`, `doctrine/`, …) but there is **no category per skill**. Import is file-only (`services/learning/SkillImportService.ts:95-112` — `readSkillFiles`); there is no URL or owner-repo install. There are no skill bundles (one YAML loading several skills). |
| **Proposed change** | (a) Accept `SKILL.md` as an alias for a spec-shaped skill file — the **parser already handles it**; only the filename check needs to widen. (b) A `version:` key on the portable face. (c) A per-skill `category:` key, and a category view in the catalog. (d) `installSkillFromUrl(url)` alongside the file import, with the same per-file outcome contract. (e) Defer bundles — they are the least valuable of the five and the most work. |
| **Impact** | **Maintainability** (a Claude/Hermes skill drops in and works) · **UX** (a category view) · **Portability** |
| **Effort** | **S** for (a), (b), (d) · **M** for (c) · **M** for (e), deferred |
| **Risk** | **S** |
| **How to verify** | Drop a spec-only `SKILL.md` into the skills folder and assert it lists, parses and loads as an unproven candidate. |
| **Roadmap** | **NEW** |

### E-48 — A "review all my skills" job that proposes, never writes

| | |
|---|---|
| **Problem** | There is no way to see which of the trader's skills are malformed, clipped, untriggerable or shadowed — the format is already spec-shaped, but **nothing checks it**. A skill whose description is only the `ifCondition → thenAction` fallback (`services/learning/SkillMemoryService.ts:1064-1067`) will rarely fire; a skill over the 700-char recall cap is **silently clipped at the card** (`services/learning/skillDocument.ts:48-54` — `clipped`, `droppedChars` — the number is already computed and nothing surfaces it). |
| **Proposed change** | **A two-stage job, both stages already exist as building blocks.**<br>**Stage 1 — deterministic, no model call.** For every skill: does it parse (`parseSkillMarkdown`); does it round-trip (`serializeSkill`); is `name` present and ≤ 64; is `description` real or a fallback; is the portable/ledger split intact; are the body sections recognised (`parseSkillBody` / the `HEADINGS` map); **how much would be clipped** (`projectSkillCard` → `droppedChars`); does the description say WHEN (a trigger phrase, or an `ifCondition`); does the file name match the skill (`skillFileNameFor`).<br>**Stage 2 — model-assisted, only for what code cannot decide.** Rewrite a description that does not say WHEN, and normalise section headings, using the existing skill-writing calls (`services/learning/SkillCraftService.ts` — `craftSkillFromPostMortem:155`, `refineSkillFromLosses:228`).<br>**The write rule: the job produces PROPOSALS, never writes.** Every proposal goes through the existing human gate — `utils/learningQueue.ts` (`queueLearningProposal`, `applyProposalCard`, `decideRewriteCard`) — landing in `components/learn/ActionApprovals.tsx`. The same discipline the supervisor and `propose_skill` already use.<br>**The budget: opt-in, capped per run, a token estimate shown before it starts, fail closed with no ready provider.** The precedent is `services/learning/SkillEvalScheduler.ts` — a scheduled, budgeted, sample-gated LLM pass over skills — and `services/learning/SkillEvalService.ts:307`, which already writes a verdict into a skill's frontmatter. **The review job is its sibling: same scheduler, same budget, different prompt, different write target.** |
| **Impact** | **Accuracy** (an untriggerable skill is a skill that never fires; a clipped one is a procedure the model only half-reads) · **Maintainability** (one button to see the health of the whole library) · **UX** |
| **Effort** | **M** — Stage 1 is **S** (everything it needs exists); Stage 2 is **M** |
| **Risk** | **M** — a batch that rewrites skills is a batch that can damage them. Mitigations: proposals only; a diff per skill before anything is applied; a per-skill revert; the deterministic pass runs first and alone. |
| **How to verify** | A test over a corpus of deliberately malformed skills (no frontmatter, no description, an unknown section, an over-cap body, a name that does not match the file) asserting one verdict each; and an end-to-end test that a Stage-1 report lists exactly those and proposes nothing. |
| **Roadmap** | **NEW** — the *format* is already a port; the *bulk review* is not in the corpus. |

### 3D-rank

| rank | id | what | impact | effort | roadmap |
|---|---|---|---|---|---|
| 1 | **E-45** | Per-session run ownership for the Chat surface | UX · accuracy | **M** | NEW |
| 2 | **E-48** | "Review all my skills" — propose, never write | accuracy · maintainability | **M** | NEW |
| 3 | **E-47** | The envelope gaps: filename, category, version, URL install | maintainability | **S–M** | NEW |
| 4 | **E-46** | Level-3 sub-resources + a compatibility block | accuracy | **L** | NEW |
| 5 | **E-46** (the new features file) | **"a run is still going" badge on the conversation rail** | UX | **S** | NEW (as **N-21**) |

---

## 3E. Two additions the malformed-skill question forces

**Added 2026-10-20**, after the owner asked what happens to a skill that does not follow the format
or is too vague. The deep dive is Report 1 §12.4.

### E-48b — the review job issues **three** verdicts, and proposes only what is safe

| | |
|---|---|
| **Problem** | A skill that does not parse is **silently dropped** by `listSkills()` (`services/learning/SkillMemoryService.ts:1053-1057`) and by the retrieval (`MemoryRetrievalService.ts:218-219`). It sits in the notebook, in the backup and in the export — and appears in **no** list, including the Health card, whose report **already computes the count and throws it away** (`memoryHealth.ts:178-181` — `skillFiles` is used at `:178` and `:179` and never again). **The same file would be rejected *with a reason* on import** (`SkillImportService.ts:56-58`) — so the app gives two opposite answers for the same file depending on how it arrived. A skill that parses but names no trigger is listed, **occupies one of the 30 index slots in file order**, and will never fire (`MemoryRetrievalService.ts:257`, *"A skill that qualifies on neither signal stays invisible"*). A skill whose card is clipped at the 700-char recall cap is a **half-procedure in every prompt**, and `projectSkillCard` already returns `droppedChars` (`skillDocument.ts:48-54`) — **computed and never surfaced**. |
| **Proposed change** | **The review issues three verdicts, and proposes only what is safe.**<br>**GHOST** (unparseable) — show the file, its size and **the first failing line**; propose (a) reconstruct the frontmatter from the file's own body, landing as an **unproven candidate with zero counters**, (b) archive it out of `skills/`, or (c) delete it **on the trader's word only**.<br>**DORMANT** (no usable trigger) — show the skill and *"names no setup it applies to"*; propose (a) the model writes a trigger **from the skill's own body**, old and new side by side, (b) demote to `candidate`, or (c) leave it alone. **A warning, not a defect** — a general rule is *supposed* to be unscoped, and the retrieval deliberately broadens on prose for exactly that case (`MemoryRetrievalService.ts:243-244`). **"Never fired" is NOT the verdict** — the injection log is run-capped, and the repo already refuses to conflate "never served" with "aged out" (`memoryHealth.ts:15-18`). Show it as a hint, never as the proof.<br>**CLIPPED** — show **how many characters are cut**; propose shortening the body, or moving the overflow to a `references/` note (**needs E-46**).<br>**And put the ghost count on the Health card permanently** — a hand-edit can create one at any time. |
| **The safety rule** | **A repair that widens a skill's reach ACTIVATES it.** Reconstructing a ghost gives it a trigger; giving a dormant skill a real description makes it match. Once E-35 lands, that means a live rule that can veto a trade. **⇒ The default for a broken skill is NOT "make it work" — it is "show it and let the trader decide." Narrowing (demote, archive, retire) is safe and may be proposed freely; widening (activate) must be confirmed one skill at a time. Evidence counters are never invented: a reconstructed skill starts at zero wins, zero losses, `status: candidate`.** Every repair is a proposal through the existing queue with a diff. |
| **Impact** | **Accuracy** (a ghost is a rule the trader believes in and the app has never heard of) · **Reliability** (two opposite answers for the same file is a correctness bug, not a formatting one) · **Maintainability** |
| **Effort** | **S** for the deterministic stage — *every* number it needs is already computed somewhere and discarded — **M** for the model stage |
| **Risk** | **M** — a batch that widens skills changes what the model does. Mitigations: proposals only, a diff per skill, per-skill revert, and the safe/unsafe split above. |
| **How to verify** | A test over a corpus of deliberately broken skills — no frontmatter, a broken `---` fence, a description equal to the fallback, an over-cap body — asserting one verdict each; a test asserting a reconstructed ghost lands as `candidate` with zero counters; and a test asserting the Health card's ghost count equals `skillFiles.length - metas.length`. |
| **Roadmap** | **NEW** — an extension of E-48, not a separate idea. |

### E-49 — rank the 30-slot index, so fixing the skills actually gets them in front of the model

| | |
|---|---|
| **Problem** | The prompt's skill index is **30 slots, filled in notebook file order, unranked and unfiltered by status** (`services/trade/chatSurfaceTurn.ts:109-118` → `rows.slice(0, SKILL_INDEX_WINDOW)`; `listSkills()` returns file order). A **retired** skill and an unproven **candidate** occupy a slot exactly like a **confirmed** one, and a **dormant** skill occupies a slot a good skill needed. `buildSkillsIndexForPrompt` (`services/trade/tradeChatContext.ts:206-224`) renders whatever it is given. **⇒ Repairing the library does not guarantee the model sees the repaired skill** — and the index is the only place a skill is ever *named* to the model. |
| **Proposed change** | **Rank and filter the rows before the slice.** A skill earns an index slot by: (1) it has a usable trigger; (2) it is not `retired`; (3) `confirmed` before `candidate`; (4) a skill the current audience may see (`audience` / `lensScope` / `manualOnly` — `MemoryRetrievalService.ts:258-260` already filters these for *retrieval*, but the **index** does not); (5) ties broken by last evidence, then by name. The `…and N more` line already exists for the overflow (`tradeChatContext.ts:222`), so the honest count is already handled. |
| **Impact** | **Accuracy** (the model sees the skills that can act) · **Cost** (the same 30 slots carry better content) · **Reliability** (a retired skill stops occupying a slot a live one needs) |
| **Effort** | **S** |
| **Risk** | **S** — it changes which skills are named. The pool that ranks out is reported in the `…and N more` line, so nothing disappears silently. It must use `utils/runStatus.ts`'s vocabulary for the status word, not a new one. |
| **How to verify** | A test with a retired skill, a dormant skill and a confirmed skill, asserting the order of the index and that the retired one is absent. Plus a test that the `manualOnly` skill stays out of an audience that may not see it. |
| **Roadmap** | **NEW** — and it is the **same defect as the "one fact, several homes" cluster**, seen from the prompt side. |
