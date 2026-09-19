# Learning-loop map

Anchors verified against the working tree on 2026-09-19. This is the WS-1
acceptance artifact: every memory surface, its writers, its readers, and
whether the pairing is actually closed. `tests/learningLoopE2E.test.ts` is the
executable version of the top section.

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
| `GlobalMemory.familyPerformance` | `AlgorithmicMemoryService.ts:24,100` | `buildGlobalMemoryIndex` (`utils/memoryUtils.ts:23`) → `constructOptimizedContext` (`GenericAnalysisService.ts:334,335`) | yes |
| `GlobalMemory.aiPatternMemory` | `AlgorithmicMemoryService.ts:25,116` | same index (:29) | yes |
| `GlobalMemory.userPreferences` | `AlgorithmicMemoryService.ts:26-30,167-175` | same index (:41) + `syncProfileMemoryUnlocked` (`MemoryFilesService.ts:683`) | yes |
| `GlobalMemory.globalCorrections` | `AlgorithmicMemoryService.ts:31,190` | same index (:35) | yes |
| skill drafts | `queueSkillDraft` (`utils/skillDrafts.ts:39`) | `CoachThreadPanel`/`ApprovalInbox` + supervisor (:445) | yes |
| learning proposals | `queueLearningProposal` (`utils/learningQueue.ts:62`) ← cap/revival/demote/rescope/contradiction passes | `LearningQueuePanel` + supervisor (all five kinds actuable) | yes |
| harness lessons | `recordHarnessLesson` (`harnessLessons.ts:99`) | `formatHarnessNotesBlock` (:199) → `ensembleService.ts:3117` | yes |
| memory amendments | `proposeAmendment` (:84) ← `DeskToolsService.ts:1450` | `AmendmentsInbox` + supervisor (:307,309) | yes |
| injection records | `recordMemoryInjection` ← `getMemoryFilesContext`, `botLearning.recordBotTurnInjection` | `skillAdherenceForRun` ← `applySkillEvidence`; `listRetrievedMemorySources` UI | yes |

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
   from `detectRecurringMistakes` (`AlgorithmicMemoryService.ts:109-116` and
   `:120-133`) and both reach the same index — the same content twice in one
   prompt.
3. **Dead code on the memory path.** `GenericAnalysisService.ts:1568
   updateGlobalMemory` (the old AI-summarizer variant, zero callers);
   `memoryUtils.ts:98 prepareTradeSummariesForGlobalMemory`;
   `MemoryConsolidationService.ts:137 consolidateMemory` (tests only — the
   live halves are `pruneOutdatedInsights`/`aggregateSimilarInsights`, called
   from `AlgorithmicMemoryService.ts:149-150`); `harnessLessons.ts:91
   lessonsForClass` and `:140 isWireRoutePinnedOff`; `App.tsx:134` imports
   `listHarnessLessons` unused.
4. **Top-level `insightKnowledgeBase` state is rotting.** Persisted
   (`useProfilePersistence.ts:98`) and loaded (:432) and threaded into the
   pipeline (`useAnalysisPipeline.ts:3583`), but `setInsightKnowledgeBase` is
   never called — `App.tsx:2419` passes the setter and nothing writes it. The
   live copy is `GlobalMemory.insightKnowledgeBase`.
5. **`profile/suggestions.md` is write-only by construction.** Forced
   `enabled:false` (`MemoryReviewService.ts:60,64`), excluded from the index
   dump, the graph and note search; only `MemoryFilesManager.tsx:85` reads it.
6. **`DecisionReflectionService`** has exactly one call site,
   `useAnalysisPipeline.ts:1411` (the plan's ":1353" is stale). Registered
   above; keep.
7. **`SelfLearningService.generateLearningContext` is already gone** — only
   the guard test remains (`tests/selfLearningServiceDeadExport.test.ts`).
   `computeLearningProfile` survives with one dashboard reader
   (`LearningDashboard.tsx:89`), so it is UI-only, not prompt-visible.
8. **Scheduled hygiene does not exist yet.** `MemoryReviewService.runNotebookReview`
   runs from `App.tsx:382` on a notebook-change debounce, not on a schedule,
   and needs an API key. The reuse target for WS-4.2 is
   `services/learning/weeklyReview.ts`: per-user preference key (:25),
   last-run stamped inside the payload (:133), `isWeeklyReviewDue` (:100-109,
   missing-or-NaN ⇒ due, 7-day window), volume + provider gates (:122-123),
   boot entry `runWeeklyReviewIfDue` ← `useUserProfileLoader.ts:361`, which
   already fire-and-forgets the contradiction (:159), belief-challenge (:161),
   self-improvement (:165) and pass-mining (:171) passes the same way.
