# Learning-loop map

Anchors verified against the working tree on 2026-09-20 (the WS-4 hygiene pass
re-checked every line below; the WS-1 anchors were verified 2026-09-19). This is
the WS-1 acceptance artifact: every memory surface, its writers, its readers,
and whether the pairing is actually closed.
`tests/learningLoopE2E.test.ts` is the executable version of the top section.

## The loop as it runs

```
trade closes (hooks/useTradeLogging.ts)
  → SkillMemoryService.syncClosedTradeToNotebook (SkillMemoryService.ts:2321)
      · appendDiaryEntry            → trader-diary/<COIN>.md
      · syncRecurringMistakes       → rules/recurring-mistakes.md
      · applySkillEvidence          → W/L, controlIds, overriddenIds, status
      · ingestIfThenFromTrade       → deterministic IF/THEN skills
      · cluster ≥ MIN_CLUSTER_FOR_SKILL and no matching skill
          → skillWorthGate.evaluateSkillWorth (LLM) → draft
post-mortem completes (hooks/usePostMortem.ts:655)
  → MemoryService.updateGlobalMemory → AlgorithmicMemoryService (deterministic)
  → craftSkillFromPostMortem → gateEvidenceBackedDraft → queueSkillDraft
  → SkillEvalScheduler kick (SkillMemoryService.ts:2458, budget 2/session)
skill supervisor (services/learning/skillSupervisor.ts)
  · listeners + startup sweep installed at App level
    (hooks/useSupervisorBootstrap.ts) — no surface mount required
  · one streamed call per item, MAX_ITEMS_PER_PASS = 12
  · approve/enhance → ingestCraftedSkillFromDraft → candidate skill
    (whyAccepted persisted; verdict reason survives the session log)
  · reject → tombstone; unparseable → stays queued for the human
  · rescope/contradiction → applied only when the model authors a clause
    that clears the same validateIfThen bar a fresh draft must clear
next analysis
  → assemblePipelineMemoryContext (hooks/analysisPipeline/memoryContext.ts)
      → getMemoryFilesContext (per-stage budget) → recordMemoryInjection
      → bot memory merged in (BotMemoryService.getBotMemoryContext, cap 1800)
outcome of that run
  → applySkillEvidence joins trade.sourceRunId → injection record.runId
      FOLLOWED   → counts
      OVERRIDDEN → override counter + rescope proposal
      CONTROL    → controlIds (the lift baseline)
next analyst prompt (hooks/useAnalysisPipeline.ts:1411)
  → DecisionReflectionService.buildDecisionReflectionContext(loggedTrades, symbol)
      a pure read over the closed-trade log — it owns NO store (see its row)
weekly, at boot, due-checked per user
  (useUserProfileLoader.ts:361 → weeklyReview.runWeeklyReviewIfDue
     → memoryHygiene.runMemoryHygieneIfDue)
  → stale-skill demotion proposals  ┐
  → contradiction sweep             ├→ learning queue (fingerprint-deduped)
  → graveyard retention sweep       ┘   (retention only — it revives nothing)
  → notebook review → profile/suggestions.md (human-facing, never injected)
  · one health line each → memory_hygiene_v1_ → the Health tab (memoryHealth)
bots (WS-3)
  read  → buildBotSharedMemoryContext → same retrieval, smallest slice
  write → lessonFromBotTurn → bots-<id>/memory.md
        → closed bot-authored trades fold into syncClosedTradeToNotebook
```

### The cold-start contract (fixed 2026-09-19)

Evidence accrues **only** on the FOLLOWED branch of `applySkillEvidence`
(SkillMemoryService.ts:1037-1050): a skill the run was not shown goes to
`controlIds`, never to W/L. Retrieval excluded every 0W/0L skill
(`MemoryRetrievalService.ts:163`). Those two rules together meant a newly
approved skill could never earn its first counted sample — no injection ⇒ no
evidence ⇒ no injection. `SkillMeta.prior` is the existing exemption; it now
takes `'gated'` as well as `'book'`, and `ingestCraftedSkillFromDraft` stamps
it, because every caller of that function is an already-approved draft. Such a
skill injects as a labeled hypothesis ("approved draft, untested"), which is
what lets the ladder test it at all.

## Surface matrix

| Surface | Writers | Readers | Closed? |
|---|---|---|---|
| `skills/*.md` | `SkillMemoryService.ts:1745,1844,1904,1977,2248` + meta updates; `skillGeneralization.ts:154`; `SkillImportService.ts:76` | `MemoryRetrievalService` injection (:596-618) + `handleRecallTool` (:709) + enforcement (`applyNotebookSkillsToAnalysis`) | yes |
| `profile/memory.md` | `syncProfileMemoryUnlocked` (`MemoryFilesService.ts:655`) ← `useUserProfileLoader.ts:329` | `identityBlock` (`MemoryRetrievalService.ts:387`) | yes |
| `profile/doctrine.md` | `DoctrineConsolidationService.ts:210` | `doctrineBlock` (:234) — always-on slot | yes |
| `profile/settled-beliefs` | `settledBeliefs.ts:186` ← `weeklyRollup.ts:30` | `settledBeliefsBlock` → `MemoryRetrievalService.ts:630` | yes |
| `rules/risk-rules.md` | seed `MemoryFilesService.ts:83`; user edit `MemoryFilesManager.tsx:154` | `riskRulesBlock` (:359) | yes |
| `rules/recurring-mistakes.md` | `syncRecurringMistakesUnlocked` (:871) | `uncoveredMistakeLine` (:388) | yes |
| `trader-diary/<coin>.md` | `appendDiaryEntryUnlocked` (:627) | **none** — see asymmetries | **no** |
| `bots-<id>/memory.md` | `botLearning.recordBotTurnOutcome` (:139) | `BotMemoryService.ts:24,29` → `memoryContext.ts:111` | yes |
| `lessons/` (model notes) | `writeModelNoteUnlocked` (:1064) | pull-only: `searchNotebookNotes` via `handleRecallTool` (:732) | pull-only |
| `distilled/` | `distilledMemory.ts:239,302` | `loadDistilledFacts` ← `PatternMemorySynthesisService.ts:692` | yes (not prompt-visible) |
| `lens/` | `lensMemory.ts:135` | `summarizeLensMemory` ← `DoctrineConsolidationService.ts:29`, `AnalystLensService.ts:12` | yes |
| `GlobalMemory.familyPerformance` | `AlgorithmicMemoryService.ts:27,103` | `buildGlobalMemoryIndex` (`utils/memoryUtils.ts:23`) → `constructOptimizedContext` (`GenericAnalysisService.ts:334,335`) | yes |
| `GlobalMemory.aiPatternMemory` | `AlgorithmicMemoryService.ts:28,119` | same index (:29) | yes |
| `GlobalMemory.userPreferences` | `AlgorithmicMemoryService.ts:29-33,166-175` | same index (:41) + `syncProfileMemoryUnlocked` (`MemoryFilesService.ts:683`) | yes |
| `GlobalMemory.globalCorrections` | `AlgorithmicMemoryService.ts:34,189` | same index (:35) | yes |
| skill drafts | `queueSkillDraft` (`utils/skillDrafts.ts:39`) | `CoachThreadPanel`/`ApprovalInbox` + supervisor (:445) | yes |
| learning proposals | `queueLearningProposal` (`utils/learningQueue.ts:62`) ← cap/revival/demote/rescope/contradiction passes | `LearningQueuePanel` + supervisor (all five kinds actuable) | yes |
| harness lessons | `recordHarnessLesson` (`harnessLessons.ts:99`) | `formatHarnessNotesBlock` (:199) → `ensembleService.ts:3117` | yes |
| memory amendments | `proposeAmendment` (:84) ← `DeskToolsService.ts:1450` | `AmendmentsInbox` + supervisor (:307,309) | yes |
| injection records | `recordMemoryInjection` ← `getMemoryFilesContext`, `botLearning.recordBotTurnInjection` | `skillAdherenceForRun` ← `applySkillEvidence`; `listRetrievedMemorySources` UI | yes |
| decision reflections (**no store**) | none — `DecisionReflectionService.ts:12` is a pure selector over `LoggedTrade[]` (`loggedTrades`) + their `postMortem`; it writes nothing and owns nothing | `useAnalysisPipeline.ts:1411` → the analyst prompt block | **reader-only, and that is the design** (WS-4.6: this row, not "registered above") |
| `skill_graveyard_v1_` tombstones | `recordTombstone` ← the ledger retirement transition (`SkillMemoryService.ts:2140`) | `graveyardBlock` → worth-gate context; `memoryHealth.queues.graveyard`; retention: `runGraveyardSweep` (weekly, via hygiene) | yes |
| `memory_hygiene_v1_` health log | `appendLog` ← `runMemoryHygiene` (demotions · contradiction sweep · notebook review · graveyard sweep) | `memoryHealth.hygiene` → `components/learn/MemoryHealthCard.tsx` | yes |

## WS-1.3 — the GlobalMemory round-trip

Confirmed **closed**. `updateGlobalMemory` is a pure delegate to
`AlgorithmicMemoryService.updateGlobalMemoryAlgorithmically`, and all four
fields reach the model through the single choke-point
`utils/memoryUtils.buildGlobalMemoryIndex` → `constructOptimizedContext`
(`GenericAnalysisService.ts:334` and `:335`, the two accuracy-mode branches).
`familyPerformance` is injected verbatim, which is what
`tests/memoryIndexLayer.test.ts` pins. A post-mortem on a Family-A trade
therefore does change the next index's Family-A line.

## Asymmetries found (feed WS-4)

1. **`trader-diary/` is write-only.** Nothing reads its content.
   `MemoryRetrievalService.ts:8` claims the diary "feeds doctrine rewrites and
   skill gates", and `DoctrineConsolidationService.ts:5-6` repeats it — but the
   rewriter consumes the **closed-trade log** (`LoggedTrade[]`,
   `DOCTRINE_WINDOW_TRADES = 60`), never the diary files; `kindForHit` labels
   diary hits yet no block is ever pushed; `searchNotebookNotes` skips the
   folder (`MemoryFilesService.ts:1153`); the only consumer is an entry count
   in `LearningDashboard.tsx:473`. Either delete the write or fix the two
   comments — a journal the user reads is a legitimate reason to keep it, but
   it must be stated, not implied. Not deleted here: it is user-facing history.
2. **`aiPatternMemory` duplicates `insightKnowledgeBase.insights`.** Both come
   from `detectRecurringMistakes` (`AlgorithmicMemoryService.ts:112-119` and
   `:123-146`) and both reach the same index — the same content twice in one
   prompt.
3. **Dead code on the memory path — three removed, one kept, one uncalled.**
   Removed after verifying zero callers: `GenericAnalysisService.updateGlobalMemory`
   (the old AI-summarizer variant, plus the private `GLOBAL_MEMORY_JSON_SCHEMA`
   only it used), `memoryUtils.prepareTradeSummariesForGlobalMemory`,
   `harnessLessons.isWireRoutePinnedOff`, and an unused `listHarnessLessons`
   import in `App.tsx`. Kept, because an earlier pass wrongly called it dead:
   `harnessLessons.lessonsForClass` is a tested capability-class accessor.
   **WS-4 re-check:** `MemoryConsolidationService.consolidateMemory` is live
   code that nothing on the runtime path calls — the earlier "IS imported by
   `AlgorithmicMemoryService.ts:7`" was true of the import only, and that
   import was unused. `updateGlobalMemoryAlgorithmically` calls its two steps
   directly (`pruneOutdatedInsights` + `aggregateSimilarInsights`,
   `AlgorithmicMemoryService.ts:148-149`), which is what keeps the store
   maintained; the async wrapper's only remaining reference is the ad-hoc
   `tests/test-memory-consolidation.ts` script (not a Vitest file — the
   `tests/**/*.test.ts` include never collects it). Kept as the documented
   composition of those two steps; do not read its existence as a schedule.
4. **Top-level `insightKnowledgeBase` state is carried, not used.** The writer
   does fire — exactly once, at profile load (`useUserProfileLoader.ts:432`) —
   but nothing at runtime ever produces a new value for it, so the load
   (`:432`) → persist (`useProfilePersistence.ts:98`) round trip can only
   re-write what it read. Its one consumer, `useAnalysisPipeline.ts:162,316`,
   destructures it and lists it in a dependency array (:3583) without ever
   reading the value. The store that matters is
   `GlobalMemory.insightKnowledgeBase` — written per batch
   (`AlgorithmicMemoryService.ts:135-149`) and read into prompts by
   `utils/memoryUtils.buildGlobalMemoryIndex:52`. The dead-threading justification
   now lives at the declaration (`hooks/useAppSettings.ts:70`); removing the
   state means unwinding `App.tsx:304,823,1568,2463` plus four hook call sites
   for no user-visible gain, so it was documented rather than half-removed
   (the deletion is a clean follow-up for whoever owns `App.tsx` next).
5. **`profile/suggestions.md` is write-only BY DESIGN, and says so.** The why
   is now at the code site (`MemoryReviewService.ts` module header + the
   `enabled:false` branch): it is advice for the HUMAN, unjudged by any gate,
   so enabling it would let one model's opinion re-enter the next debate as
   evidence. Forced `enabled:false` on both branches
   (`MemoryReviewService.ts:79,82`), excluded from the index dump
   (`MemoryFilesService.ts:277`), the graph (`MemoryGraph.ts:57`) and note
   search; `MemoryFilesManager.tsx:85` is its reader — a person.
6. **`DecisionReflectionService`** has exactly one call site,
   `useAnalysisPipeline.ts:1411` (the plan's ":1353" is stale). It has **no
   store**: it is a pure read over `loggedTrades`, so it never appeared as a
   writer+reader pair. It now has its own row in the matrix above; "registered
   above" was the claim this replaces. Keep.
7. **`SelfLearningService.generateLearningContext` is already gone** — only
   the guard test remains (`tests/selfLearningServiceDeadExport.test.ts`).
   `computeLearningProfile` survives with one dashboard reader
   (`LearningDashboard.tsx:89`), so it is UI-only, not prompt-visible.
8. **Scheduled hygiene exists (WS-4.2).** `services/learning/memoryHygiene.ts`
   reuses the `weeklyReview` discipline — per-user preference key
   (`memory_hygiene_v1_`, :49), last run stamped in the payload, 7-day window,
   missing-or-unparsable ⇒ due — and is reached at boot from
   `weeklyReview.runWeeklyReviewIfDue` (:168-169) after its own due-check.
   `runMemoryHygiene` runs four reported steps, one health line each:
   stale-skill demotions, the contradiction sweep (moved here from the
   weekly review block, where its counts stopped at a `console.log` and reached
   no report), the notebook review, and the graveyard retention sweep. The Health tab renders
   the log via `memoryHealth.hygiene`. `runNotebookReview` still ALSO runs from
   `App.tsx:379-386` on a notebook-change debounce and needs an API key; the
   schedule only adds the weekly guarantee, it does not replace that path.
