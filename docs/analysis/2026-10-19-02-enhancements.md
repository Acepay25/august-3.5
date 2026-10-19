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
`2026-10-19-04-cleanup-manifest.md` §8.

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
| **Risk** | (a) changes every prompt — needs a token budget and a canary. (b) is behaviour-neutral but removes a capability the product is named for. **Recommendation: (b) first, (a) as a measured follow-up** — because the pull path already exists and the push path's budget was never settled. |
| **How to verify** | A new test that builds the **sent** message and asserts the expected blocks are present and the forbidden ones absent (E-11). Then `npm run render-probe`. Then: log the injection record's `sources` next to the sent prompt for one run and confirm they agree. |
| **Roadmap** | **PARTIAL** — `R-256` names "the data-pull residue — the injection string is read only by `devLog`", and `G-07` names `enhancedPrompt`. **The missing part, named:** R-256 does not name (i) the seven specific dropped blocks, (ii) the injection-ledger consequence, (iii) the hard-coded `gateInjection = ''`, (iv) the owner decision *"what replaces the analysis branch"* that `docs/plans/debate-deletion-status.md:110-147` is waiting on. |

### E-02 — One planned R:R, one formula

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

### E-03 — Charge the round trip

| | |
|---|---|
| **Problem** | The app has **no cost model**. There is no fee, slippage or funding term anywhere in the source. Every `realizedR`, every win rate, every calibration bucket, every skill's expectancy and the whole RL ledger are **gross**. The field named `netR` is the *sum of gross* R multiples — the name is misleading. |
| **Evidence** | a repo-wide search for `slippage\|takerFee\|makerFee\|commission\|costBps\|feeRate` returns exactly three files: `services/analysis/ScalpDetectionService.ts:189` (a *warning string*), `services/learning/ReinforcementSignalService.ts:50` (a *comment* — *"Potential future params: slippage, timeToTarget, etc."*), and `services/learning/SkillMemoryService.ts:1431` (the `netR` accumulator). `services/backtesting/BacktestingService.ts:1358-1366` computes P&L as a raw price difference. |
| **Why it is decisive** | The app's own gates define the loosest trade it will allow: R:R 1.2 (Low/Avoid), scalp SL ≤ 1.0 % of price, scalp min R:R 1.0. A 0.10 % round trip against a 1.0 % stop is **0.10 R**; against a 0.3 % scalp stop it is **0.33 R**. At a 50 % win rate and R:R 1.2, gross expectancy is **+0.10 R** and the round trip consumes it. **The breakeven win rate moves from 45.5 % to 50.0 %** — and the gate simultaneously caps that trade's confidence at **≤54 %** (`utils/analysisUtils.ts:1430-1440`). |
| **Caveat, stated** | The 0.05 %/side taker rate is an **assumption** ("the standard published taker rate and is not in the repo"). The arithmetic is linear in it, and the conclusion holds for any taker fee above ~0.02 % per side at a 1 % stop. **The honest design is therefore to make the trader state their fee tier**, not to hardcode an exchange rate. |
| **Proposed change** | A single cost model, in R, computed at journal-write time: `costR = (feePerSide×2 + slippageBps/10000) / (stopDistancePct/100)`, with the fee and slippage **user-configurable** and a visible **"gross" badge** when they are unset. Store `costR` and `netR` on the row, feed the ledger and the calibration buckets from `netR`, and keep `realizedR` for the gross view. |
| **Impact** | **Accuracy** (the ledger becomes net) · **profit** (this is the largest single correctness gap for a manual trader) · **reliability** (the expectancy shown to the trader becomes the expectancy they have) |
| **Effort** | **M** |
| **Risk** | **M** — it changes every number in the journal, so existing rows need a "gross" marker and the UI needs to say which is which. |
| **How to verify** | A test that a 1:1 plan at a 1 % stop with a 0.05 %/side fee shows a net expectancy ≤ 0 at a 50 % win rate, and that the skill ledger's expectancy matches `netR` and not `realizedR`. |
| **Roadmap** | **NEW (prior)** — this is `G-01`/`G-02`, and it comes from the **orphan** `docs/analysis/05-lead-findings.md`, **not** from `docs/plans/`. **It is not in the roadmap at all**, and the file it lives in survives in four unreachable commits. |

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

### E-21 — Break the notebook out of one JSON blob

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
| 23 | **E-21** | Break the notebook out of one blob | reliability · speed | L | NEW | big bet |

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
full set of measurements, with the commands, is in `2026-10-19-01-system-and-data-flow.md` §10
and `2026-10-19-00-index-and-method.md` §0.4.

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
