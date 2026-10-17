# Deleting the ensemble debate — status

Owner order (2026-10-17): remove the ensemble debate **and** its related
features; keep Monte Carlo, key levels, watch list and price alerts as chat
tools; delete post-mortems entirely; delete accuracy mode + the calibration
ledger. Accepted consequence: the closed-trade learning chain
(recurring-mistake detection, insight extraction, global memory on close, lens
memory, closed-trade skill crafting) stops working with no replacement.

## Done (each: tsc + full vitest + lint + render-probe green)

- `e2b3965` post-mortem deleted: `usePostMortem`, `MistakePatternService`,
  `JobQueueService`, `postMortemReport/Lessons`, ~1,450 lines in survivors.
  Both lesson stores (`aiPatternMemory`, `insightKnowledgeBase`) are now
  **frozen**; `LoggedTrade.postMortem` still reads through SQLite but has no
  writer, so `DecisionReflectionService`, `DoctrineConsolidationService`,
  `EvidencePackService`, `MemoryFilesService` and
  `PatternMemorySynthesisService` see only what a profile already carries.
- `96af726` the 2D debate floor: DeskScene, PixelSeat, SpeechBubble,
  VerdictCard, DeskSteerInput, floorLayout, roomLayout, roleOverrides,
  DeskSeatMappingEditor, debateStageActors + 21 test files.
- `2095864` debate-derived history: BotSeatOverridesDialog, the Journal's Saved
  tab + SavedAnalyses, the dissent tally, the Conviction-auction card, the
  Reasoning panel's transcript block, `LiveStreamView`, AnalysisProgress's
  post-mortem props.
- `d90095b` Settings: the `lenses` (Roles) tab, `AnalystLensSettings`,
  `LensesTab`, the "Team analysis" switch.

## Next — order matters

1. **Stage 20 before 19.** Structured chart analysis exists ONLY in the
   ensemble branch: `isChartAnalysisRequested` (hooks/useAnalysisPipeline.ts:1474)
   lists `isEnsembleEnabled` as a trigger term, and the guard at :1488 is
   `isChartAnalysisRequested && runEnsembleEnabled`, with casual chat in the
   `else` at :3153. Delete the branch first and every send becomes casual chat
   with **no desk tools** — so move the Chat surface onto `chatTurnRunner` (the
   tool-capable runner the dock already uses) in the same change.
2. **Stage 19** the engine: branch 1488-3152 plus `runEnsembleEnabled` at
   848/872/1091/1154/1188, then `ensembleService`, `ensembleConsensus`,
   `debateScience`, `debatePods`, `EnsembleAnalystService`,
   `AnalystLensService`, `verdictFinalizer`, `autoplayParser`, `debateResume`,
   `streamThrottlers`, `runOutcome`, `utils/debate*`, debate prompts/markers/
   archetypes, `seatPersonas`, `handleSteerSeat`/`handleStopSeat` (~86 tests).
3. **Stage 17** accuracy mode + calibration ledger: `AccuracyValidationService`,
   `CalibrationLedgerService`, `calibrationPolicy`, `calibrationStore`,
   `calibrationPrompts`, `AccuracyModeModal`, the Settings toggle,
   `isAccuracyMode*`. Caution: `calibrationStore` also exports
   `detectTradingSession` (AlgorithmicSummaryService) and `ConfidenceLevel`
   (useTradeLogging, SelfLearningService, HybridIntelligenceService) — relocate
   those rather than delete them with the file.
4. **Stage 21** types (`DebateTurn`, `postMortem*`, the `savedAnalyses` store +
   SQLite table + backup plumbing), remaining gates, docs.

## Deviations from the approved manifest (say so before repeating them)

- **WatchListPanel kept.** "Watch becomes a chat tool only" named the list, but
  the panel is a container: it also confirms autopilot resolutions and logs the
  trade from a fired signal — surviving features.
- **InlineVerdict kept**: it renders verdict fields, not a transcript, and
  AgentsView + ChatTranscriptList both mount it. Only its folded `VerdictAudit`
  disclosure is debate-shaped. My manifest called the component debate-only;
  that was wrong on inspection.
- `services/desk/idleMotion.ts` kept and relabelled "Reduce motion": its body
  class also stills `.reasoning-row[data-state=running]`, `.beacon::after` and
  every `animate-pulse` on surviving surfaces. The localStorage key stays
  `desk_idle_motion_v1_<user>` — renaming it silently resets every profile.
- `components/chat/pixelAvatars.ts` (moved out of `components/desk/`) kept:
  BotAvatar, NewBotDialog and agentRoster use `ROLE_ACCENTS`,
  `buildGridForRole`, `colorForToken`, `RolePreset`. Its three animation frame
  tables went (650 lines).

## Corrected claims

- Commit `2095864`'s message reported "488 files / 4915 tests"; the measured
  tree was 489 files / 4850 tests. Figures were written from memory instead of
  the log's summary line — corrected in `d90095b`.

## Running the gates on this box

`NODE_OPTIONS=--no-experimental-webstorage`, one heavy gate at a time. Read the
log's own verdict line (`RENDER PROBE OK`, `Test Files …`), never a background
task's exit code. Lint has a `--max-warnings 889` ratchet (now 818).
