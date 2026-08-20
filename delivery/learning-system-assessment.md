# August 3.5 — Learning-system assessment & implementation plan

Goal from the user: "implement all that can benefit August, especially so it learns to
predict high-quality traders in the long run." Audit date: 2026-08-20.

---

## 1. What ALREADY exists (the goal is substantially built)

The learning → quality pipeline is already implemented and wired. Enumerated from the code:

| Capability | Where | What it does |
|---|---|---|
| **Model performance tracking** | `services/backtesting/ModelPerformanceService.ts` | `trackTradeOutcome`, per-model win rate by family/regime/confidence, rolling windows, cold-streak detection, `calculateDynamicWeightsEnhanced` (regime + family + situational + hot/cold scoring), weighted-voting context, `generatePerformanceSummary`. |
| **Reinforcement signals** | `services/learning/ReinforcementSignalService.ts` | Outcome × confidence reward matrix (−1..+1), per-provider signal store, `getAverageReward`. Surfaced in `VersionHistoryDashboard`. |
| **Rule learning** | `services/learning/LearningRulesService.ts` | `extractIfThenRules`, `extractStructuredRules`, `storeRule`, `getRelevantRules`. |
| **Insight extraction** | `services/learning/InsightExtractionService.ts` | Post-mortem → insights, `markInsightsUsed`, severity insights, attributed provider insights. |
| **Memory / consolidation** | `MemoryService.ts`, `MemoryConsolidationService.ts`, `MemoryReviewService.ts`, `GlobalLearningService.ts`, `AlgorithmicMemoryService.ts` | Outcome-correlated reasoning corpus (`ThinkingStoreService`), memory consolidation + review. |
| **Self-learning / skill** | `SelfLearningService.ts`, `SkillCraftService.ts`, `SkillMemoryService.ts` | Autonomous skill/playbook distillation. |
| **Memory graph (data layer)** | `services/learning/MemoryGraph.ts` | Graph model over learned skills/memories — **no UI consumer yet.** |

So "predict high-quality traders" is already operational at the service layer: outcomes feed
back into per-model quality scores that drive dynamic ensemble weighting.

---

## 2. The concrete gaps (why "implement all" needs a dedicated pass)

1. **Legacy `AIProvider` keying vs. dynamic `providerId`.** The entire performance/RL
   subsystem is keyed by the legacy `AIProvider` enum (`ModelPerformance.provider: AIProvider`,
   `getModelPerformance(provider: AIProvider)`), while the debate now uses runtime
   `ProviderConfig.id` strings (`'gemini'`, `'custom-1720…'`). `DynamicWeights.byProvider`
   is the only dynamic-keyed field. Surfacing "track record" on the debate seats requires
   resolving this keying first — a real refactor, not a one-line change.
2. **No UI for the learning graph.** `MemoryGraph.ts` exists as data but has zero UI
   consumers — the Hermes "Memory Graph (All/Used/Learned)" idea is the missing surface.
3. **No write-approval gate on auto-learned rules/insights.** Rules and insights are
   persisted directly (`storeRule` → `saveLearningRules`); Hermes' `write_approval` pattern
   (stage → user approve/reject) is absent, so a bad auto-learned assumption can persist.
4. **Prefix-cache not safely applicable yet.** The debate prompts are heavily per-seat
   (role mandate + name + floor orientation differ per model), so there's no byte-identical
   shared first-block to hoist; enabling DeepSeek prefix caching needs a prompt restructure
   with debate-quality risk — a deliberate, tested pass, not an inline edit.

---

## 3. Recommended implementation order (each a bounded, testable pass)

1. **Resolve legacy → dynamic keying** in `ModelPerformanceService` + `ReinforcementSignalService`
   (add providerId-keyed accessors alongside the legacy fields). Unblocks everything below.
2. **Write-approval gate** on learned rules/insights (a `pending` queue + approve/reject,
   gated by a `learningWriteApproval` preference). Trust + "no garbage learning."
3. **Track-record surface** in the debate seat roster (win rate / dynamic weight per seat),
   once keying is resolved.
4. **Memory Graph UI** (All / Used / Learned) over the existing `MemoryGraph.ts` data.
5. **Prefix-cache prompt restructure** for the debate (hoist a shared, byte-identical
   constitution block first), with debate-output regression tests.

---

## 4. Verification baseline (unchanged)

- `npm run typecheck` — 0 errors.
- `npx vitest run` — **1022 passed, 11 skipped, 0 failed**.
- `npm run build` — ✓.
