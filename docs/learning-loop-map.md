# Learning-loop map

Anchors verified against the working tree on 2026-09-20 (the WS-4 hygiene pass
re-checked every line below; the WS-1 anchors were verified 2026-09-19). This is
the WS-1 acceptance artifact: every memory surface, its writers, its readers,
and whether the pairing is actually closed.
`tests/learningLoopE2E.test.ts` is the executable version of the top section.

## The loop as it runs

```
trade closes (hooks/useTradeLogging.ts)
  → SkillMemoryService.syncClosedTradeToNotebook (SkillMemoryService.ts)
      · appendDiaryEntry            → trader-diary/<COIN>.md
      · syncRecurringMistakes       → rules/recurring-mistakes.md
      · applySkillEvidence          → W/L, controlIds, overriddenIds, status
      · ingestIfThenFromTrade       → deterministic IF/THEN skills
      · cluster ≥ MIN_CLUSTER_FOR_SKILL and no matching skill
          → skillWorthGate.evaluateSkillWorth (LLM) → draft
post-mortem completes (hooks/usePostMortem.ts, the writeback path)
  → MemoryService.updateGlobalMemory → AlgorithmicMemoryService (deterministic)
  → craftSkillFromPostMortem → gateEvidenceBackedDraft → queueSkillDraft
  → SkillEvalScheduler kick (runDueSkillEvalWithDefaultRunner, called from
    SkillMemoryService's syncClosedTradeToNotebook; its own session budget caps
    the runs)
skill supervisor (services/learning/skillSupervisor.ts)
  · queue listeners installed at App level (hooks/useSupervisorBootstrap.ts) —
    no surface mount required. There is NO startup sweep (contract change,
    2026-10-05): a pass runs when something changes or when the panel says
    "Run now", never merely because the app opened.
  · one streamed call per item, MAX_ITEMS_PER_PASS = 12
  · AUTO-TRIAGE, NOT AUTO-APPLY (skillSupervisor.ts). approve/enhance
    records a verdict and a suggested rewrite in the triage ledger; it does NOT
    ingest. The only thing that creates a skill is the human — Save in the
    inbox, or overrideApproveSkill (skillSupervisor.ts).
  · reject → records the verdict; it no longer tombstones the trader's own
    draft. Unparseable → stays queued for the human.
  · rescope/contradiction → a proposal row; applying it goes through
    applyLearningProposalByKind (SkillMemoryService.ts), which reads the
    clauses the proposer STORED rather than a rewrite authored at apply time.
next analysis
  → assemblePipelineMemoryContext (hooks/analysisPipeline/memoryContext.ts)
      → getMemoryFilesContext (per-stage budget) → recordMemoryInjection
      → bot memory merged in (BotMemoryService.getBotMemoryContext, cap 1800)
outcome of that run
  → applySkillEvidence joins trade.sourceRunId → injection record.runId
      FOLLOWED   → counts
      OVERRIDDEN → override counter + rescope proposal
      CONTROL    → controlIds (the lift baseline)
next analyst prompt (hooks/useAnalysisPipeline.ts)
  → DecisionReflectionService.buildDecisionReflectionContext(loggedTrades, symbol)
      a pure read over the closed-trade log — it owns NO store (see its row)
weekly, at boot, due-checked per user
  (useUserProfileLoader.ts → weeklyReview.runWeeklyReviewIfDue
     → memoryHygiene.runMemoryHygieneIfDue)
  → stale-skill demotion proposals  ┐
  → contradiction sweep             ├→ learning queue (fingerprint-deduped)
  → graveyard retention sweep       ┘   (retention only — it revives nothing)
  → idle skill lifecycle (skillIdleLifecycle.runSkillIdleSweep) — the only
     stage that ACTS on a clock instead of queueing: idle 90d ⇒ suspend
     (enabled=false, still ranked-out but still MATCHED, so it can revive with
     no human involved); still suspended 180d ⇒ move to the skills archive +
     an 'idle' graveyard tombstone so a re-draft raises a revival card
  → notebook review → profile/suggestions.md (human-facing, never injected)
  · one health line each → memory_hygiene_v1_ → the Health tab (memoryHealth)
bots (WS-3)
  read  → buildBotSharedMemoryContext → same retrieval, smallest slice
  write → lessonFromBotTurn (a LESSON token, else a labelled line)
        → bots-<id>/memory.md
        → closed bot-authored trades fold into syncClosedTradeToNotebook
  turns that earn this: the 1:1 mailbox (hooks/useBotMailbox.ts), scheduled
  routines (services/agents/botRoutine.ts) and ROOM replies
  (hooks/useAgentGroups.ts — one write-back per PARTICIPANT per run, flushed
  at settlement; a bot that takes three rounds earns one lesson line, from
  the reply that declared it, and every room reply carries the runId + the
  injection record its own notes earned, so a trade logged from a room turn
  can be attributed like any other)
```

### The cold-start contract (fixed 2026-09-19)

Evidence accrues **only** on the FOLLOWED branch of `applySkillEvidence`
(SkillMemoryService.ts): a skill the run was not shown goes to
`controlIds`, never to W/L. Retrieval excluded every 0W/0L skill
(`MemoryRetrievalService.ts`). Those two rules together meant a newly
approved skill could never earn its first counted sample — no injection ⇒ no
evidence ⇒ no injection. `SkillMeta.prior` is the existing exemption; it now
takes `'gated'` as well as `'book'`, and `ingestCraftedSkillFromDraft` stamps
it, because every caller of that function is an already-approved draft. Such a
skill injects as a labeled hypothesis ("approved draft, untested"), which is
what lets the ladder test it at all.

## Surface matrix

| Surface | Writers | Readers | Closed? |
|---|---|---|---|
| `skills/*.md` | `SkillMemoryService.ts` + meta updates; `skillGeneralization.ts`; `SkillImportService.ts` | `MemoryRetrievalService` injection + `handleRecallTool` + enforcement (`applyNotebookSkillsToAnalysis`) | yes |
| `profile/memory.md` | `syncProfileMemoryUnlocked` (`MemoryFilesService.ts`) ← `useUserProfileLoader.ts` | `identityBlock` (`MemoryRetrievalService.ts`) | yes |
| `profile/doctrine.md` | `DoctrineConsolidationService.ts` | `doctrineBlock` — always-on slot | yes |
| `profile/settled-beliefs` | `settledBeliefs.ts` ← `weeklyRollup.ts` | `settledBeliefsBlock` → `MemoryRetrievalService.ts` | yes |
| `rules/risk-rules.md` | seed `MemoryFilesService.ts`; user edit `MemoryFilesManager.tsx` | `riskRulesBlock` | yes |
| `rules/recurring-mistakes.md` | `syncRecurringMistakesUnlocked` | `uncoveredMistakeLine` | yes |
| `trader-diary/<coin>.md` | `appendDiaryEntryUnlocked` | **none** — see asymmetries | **no** |
| `bots-<id>/memory.md` | `botLearning.recordBotTurnOutcome` | `BotMemoryService.ts` → `memoryContext.ts` | yes |
| `lessons/` (model notes) | `writeModelNoteUnlocked` | pull-only: `searchNotebookNotes` via `handleRecallTool` | pull-only |
| `distilled/` | `distilledMemory.ts` | `loadDistilledFacts` ← `PatternMemorySynthesisService.ts` | yes (not prompt-visible) |
| `lens/` | `lensMemory.ts` | `summarizeLensMemory` ← `DoctrineConsolidationService.ts`, `AnalystLensService.ts` | yes |
| `GlobalMemory.familyPerformance` | `AlgorithmicMemoryService.ts` | `buildGlobalMemoryIndex` (`utils/memoryUtils.ts`) → `constructOptimizedContext` (`GenericAnalysisService.ts`) | yes |
| `GlobalMemory.aiPatternMemory` | **none** — write removed (E3); its initializer still seeds `[]` so the field exists, and stored strings load untouched but never grow | none — the `PATTERN MEMORY` section was deleted from `buildGlobalMemoryIndex` (was "same index") | **no** — frozen legacy field; `insightKnowledgeBase` is the one source |
| `GlobalMemory.userPreferences` | `AlgorithmicMemoryService.ts` | same index + `syncProfileMemoryUnlocked` (`MemoryFilesService.ts`) | yes |
| `GlobalMemory.globalCorrections` | `AlgorithmicMemoryService.ts` | same index | yes |
| skill drafts | `queueSkillDraft` (`utils/skillDrafts.ts`) | `CoachThreadPanel`/`ApprovalInbox` + supervisor | yes |
| learning proposals | `queueLearningProposal` (`utils/learningQueue.ts`) ← cap/revival/demote/rescope/contradiction passes | `LearningQueuePanel` + supervisor (all five kinds actuable) | yes |
| harness lessons | `recordHarnessLesson` (`harnessLessons.ts`) | `formatHarnessNotesBlock` → `ensembleService.ts` | yes |
| memory amendments | `proposeAmendment` ← `DeskToolsService.ts` | `AmendmentsInbox` + supervisor | yes |
| injection records | `recordMemoryInjection` ← `getMemoryFilesContext`, `botLearning.recordBotTurnInjection` | `skillAdherenceForRun` ← `applySkillEvidence`; `listRetrievedMemorySources` UI | yes |
| decision reflections (**no store**) | none — `DecisionReflectionService.ts` is a pure selector over `LoggedTrade[]` (`loggedTrades`) + their `postMortem`; it writes nothing and owns nothing | `useAnalysisPipeline.ts` → the analyst prompt block | **reader-only, and that is the design** (WS-4.6: this row, not "registered above") |
| `skill_graveyard_v1_` tombstones | `recordTombstone` ← the ledger retirement transition, and ← the idle archive stage (`skillIdleLifecycle`, reason `idle`) | `graveyardBlock` → worth-gate context; `memoryHealth.queues.graveyard`; retention: `runGraveyardSweep` (weekly, via hygiene) | yes |
| `memory_hygiene_v1_` health log | `appendLog` ← `runMemoryHygiene` (demotions · contradiction sweep · notebook review · graveyard sweep · idle lifecycle) | `memoryHealth.hygiene` → `components/learn/MemoryHealthCard.tsx` | yes |

## WS-1.3 — the GlobalMemory round-trip

Confirmed **closed**. `updateGlobalMemory` is a pure delegate to
`AlgorithmicMemoryService.updateGlobalMemoryAlgorithmically`, and the three
live fields (`familyPerformance`, `userPreferences`, `globalCorrections`)
reach the model through the single choke-point
`utils/memoryUtils.buildGlobalMemoryIndex` → `constructOptimizedContext`
(both accuracy-mode branches in `GenericAnalysisService.ts`).
The fourth, legacy `aiPatternMemory`, was frozen by E3 — see asymmetry #2 —
so it no longer reaches the model at all. `familyPerformance` is injected
verbatim, which is what `tests/memoryIndexLayer.test.ts` pins. A post-mortem
on a Family-A trade therefore does change the next index's Family-A line.

## Asymmetries found (feed WS-4)

1. **`trader-diary/` is write-only.** Nothing reads its content.
   `MemoryRetrievalService.ts` claims the diary "feeds doctrine rewrites and
   skill gates", and `DoctrineConsolidationService.ts` repeats it — but the
   rewriter consumes the **closed-trade log** (`LoggedTrade[]`,
   `DOCTRINE_WINDOW_TRADES = 60`), never the diary files; `kindForHit` labels
   diary hits yet no block is ever pushed; `searchNotebookNotes` skips the
   folder (`MemoryFilesService.ts`); the only consumer is an entry count
   in `components/dashboards/learning/NotebookSection.tsx` (the `entries`
   count, from each diary file's `## ` headings). Either delete the write or fix the two
   comments — a journal the user reads is a legitimate reason to keep it, but
   it must be stated, not implied. Not deleted here: it is user-facing history.
2. **CLOSED (E3): `aiPatternMemory` duplicated `insightKnowledgeBase.insights`.**
   Both came from `detectRecurringMistakes` and both reached the same index —
   the same content twice in one prompt. The legacy write and the index
   section are deleted; the field stays in the type/schema so stored profiles
   load byte-identically, but it never grows and is never rendered. Pinned by
   `tests/algorithmicMemory.test.ts` (write gone, stored list untouched,
   insights still grow from the same detector) and the "never renders a
   legacy list" case in `tests/memoryIndexLayer.test.ts`.
3. **Dead code on the memory path — three removed, one kept, one uncalled.**
   Removed after verifying zero callers: `GenericAnalysisService.updateGlobalMemory`
   (the old AI-summarizer variant, plus the private `GLOBAL_MEMORY_JSON_SCHEMA`
   only it used), `memoryUtils.prepareTradeSummariesForGlobalMemory`,
   `harnessLessons.isWireRoutePinnedOff`, and an unused `listHarnessLessons`
   import in `App.tsx`. Kept, because an earlier pass wrongly called it dead:
   `harnessLessons.lessonsForClass` is a tested capability-class accessor.
   **WS-4 re-check:** `MemoryConsolidationService.consolidateMemory` is live
   code that nothing on the runtime path calls — the earlier "IS imported by
   `AlgorithmicMemoryService.ts`" was true of the import only, and that
   import was unused. `updateGlobalMemoryAlgorithmically` calls its two steps
   directly (`pruneOutdatedInsights` + `aggregateSimilarInsights`,
   `AlgorithmicMemoryService.ts`), which is what keeps the store
   maintained; the async wrapper's only remaining reference is the ad-hoc
   `tests/test-memory-consolidation.ts` script (not a Vitest file — the
   `tests/**/*.test.ts` include never collects it). Kept as the documented
   composition of those two steps; do not read its existence as a schedule.
4. **Top-level `insightKnowledgeBase` state is carried, not used.** The writer
   does fire — exactly once, at profile load (`useUserProfileLoader.ts`) —
   but nothing at runtime ever produces a new value for it, so the load → persist
   (`useProfilePersistence.ts`) round trip can only
   re-write what it read. Its one consumer, `useAnalysisPipeline.ts`,
   destructures it and lists it in a dependency array without ever
   reading the value. The store that matters is
   `GlobalMemory.insightKnowledgeBase` — written per batch
   (`AlgorithmicMemoryService.ts`) and read into prompts by
   `utils/memoryUtils.buildGlobalMemoryIndex`. The dead-threading justification
   now lives at the declaration (`hooks/useAppSettings.ts`); removing the
   state means unwinding `App.tsx` plus four hook call sites
   for no user-visible gain, so it was documented rather than half-removed
   (the deletion is a clean follow-up for whoever owns `App.tsx` next).
5. **`profile/suggestions.md` is write-only BY DESIGN, and says so.** The why
   is now at the code site (`MemoryReviewService.ts` module header + the
   `enabled:false` branch): it is advice for the HUMAN, unjudged by any gate,
   so enabling it would let one model's opinion re-enter the next debate as
   evidence. Forced `enabled:false` on both branches
   (`MemoryReviewService.ts`), excluded from the index dump
   (`MemoryFilesService.ts`), the graph (`MemoryGraph.ts`) and note
   search; `MemoryFilesManager.tsx` is its reader — a person.
6. **`DecisionReflectionService`** has exactly one call site,
   `useAnalysisPipeline.ts` (the line number the plan cited had already moved). It has **no
   store**: it is a pure read over `loggedTrades`, so it never appeared as a
   writer+reader pair. It now has its own row in the matrix above; "registered
   above" was the claim this replaces. Keep.
7. **`SelfLearningService.generateLearningContext` is already gone** — only
   the guard test remains (`tests/selfLearningServiceDeadExport.test.ts`).
   `computeLearningProfile` survives with one dashboard reader
   (`components/dashboards/LearningDashboard.tsx`, its `profile` memo), so it is UI-only, not prompt-visible.
8. **Scheduled hygiene exists (WS-4.2).** `services/learning/memoryHygiene.ts`
   reuses the `weeklyReview` discipline — per-user preference key
   (`memory_hygiene_v1_`), last run stamped in the payload, 7-day window,
   missing-or-unparsable ⇒ due — and is reached at boot from
   `weeklyReview.runWeeklyReviewIfDue` after its own due-check.
   `runMemoryHygiene` runs five reported steps, one health line each:
   stale-skill demotions, the contradiction sweep (moved here from the
   weekly review block, where its counts stopped at a `console.log` and reached
   no report), the graveyard retention sweep, the idle skill lifecycle, and the
   notebook review. The first three only queue; the idle lifecycle is the one
   step that actuates on its own, and it is bounded to being reversible — it
   changes which skills are injected and where the file is filed, never what a
   skill's record says. The Health tab renders
   the log via `memoryHealth.hygiene`. `runNotebookReview` still ALSO runs from
   `App.tsx` on a notebook-change debounce and needs an API key; the
   schedule only adds the weekly guarantee, it does not replace that path.
