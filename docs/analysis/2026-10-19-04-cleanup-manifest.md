# Report 4 — The cleanup manifest

**Pinned commit:** `6a41a9f7e3b3986236c3000862d326f1e95dfad1` (branch `main`)
**Date:** 2026-10-19
**Part D of the brief.**

> **Nothing in this document has been executed.** No file was modified, deleted, moved or renamed.
> The only files this audit created are the six reports under `docs/analysis/`. Every item below is
> a *proposal*.

**Method, and its two hard rules.**

*Dead code.* Reachability from the entry points is only a **pointer**: it has false positives for
lazy-loaded modals and registry-rendered panels. So every candidate below was verified twice — a
**direct importer grep** across the whole repository *including `tests/`*, and a **dynamic-import /
registry check** (`import()`, `React.lazy()`, `new Worker(new URL(...))`, `export … from`,
`export * from`, the `@/` path alias, and the electron-builder `files` list). Two independent
resolvers were used and cross-checked: a **TypeScript 5.8.3 compiler-API** graph over 1,018 source
files, and a regex resolver. **They agree.** Two scanner false-positive classes are recorded in
§1.6 so they are not mistaken for findings.

*State.* The working tree was being modified by a concurrent session throughout the audit (21 → 70
dirty paths). **Every citation below was re-verified against the pin** with
`git show 6a41a9f7:<path>` or a read-only `git archive` extract of the pin. Files the concurrent
session is deleting are marked **"in flight"**.

**Confidence** — **SAFE** (verified dead, no importer, no state) · **NEEDS CHECK** (the code is
dead but a product or roadmap decision gates it) · **RISKY** (removing it changes behaviour).

**Rollback** — every item is a `git revert` of one commit. **Nothing here is a data migration**,
with three explicitly marked exceptions.

---

## 1. Dead code

### 1.1 Orphan modules — the sweep found exactly four

| # | path | evidence | label | confidence | depends on | rollback |
|---|---|---|---|---|---|---|
| 1 | `components/dashboards/learning/AvoidSetupsSection.tsx` | `git grep AvoidSetupsSection 6a41a9f` → 3 hits, all inside the file (`:7` export, `:33` default) + one doc line (`docs/plans/debate-deletion-status.md:1639`). Import graph: **zero inbound edges**. It renders "Setups to Avoid" from `profile.worstSetups`; it is the rename survivor of the deleted `CalibrationSection`. | [Verified by code reading] | **SAFE** | nothing | `git revert` |
| 2 | `services/learning/MemoryConsolidationService.ts` | `git grep "pruneOutdatedInsights\|aggregateSimilarInsights\|MemoryConsolidationService" -- services/learning` → 4 hits, **zero of them a call site**: `services/learning/memoryHygiene.ts:15` and `:16` are a *comment*, and the other two are the definitions. `services/learning/AlgorithmicMemoryService.ts:40` sets `insights: []` and never calls them. **The file is 100 % dead, not partially live.** | [Verified by code reading] | **NEEDS CHECK** — see the note below | nothing imports it; but `HANDOFF_LEARNING_LOOP.md:185` says the pruning *is* supposed to run | `git revert` |
| 3 | `utils/messageDisplayText.ts` | `git grep messageDisplayText 6a41a9f` → **one** hit, a doc line (`docs/plans/debate-deletion-status.md:793`). Zero importers. History: created by `92ca67ab` with two row-component importers; `78bc0275` removed both; **`ab3707ce` (2026-10-17) removed the last import**. | [Verified by code reading] | **NEEDS CHECK** — see §1.2 | nothing imports it | `git revert` |
| 4 | `plugins/GallerySaver.ts` | `git grep GallerySaver 6a41a9f` → 5 hits, none a call site: the file's own 4, plus the **native** `android/app/src/main/java/com/august35/tradingapp/GallerySaverPlugin.java:27,30,31` and `MainActivity.java:10` (`registerPlugin(GallerySaverPlugin.class)`). The Java class is `@CapacitorPlugin(name="GallerySaver")` (`:30`) and implements `saveImage` writing to `MediaStore.Images` on Android 10+ (`:84-103`). A repo-wide grep for `saveImage` finds **no TypeScript caller**: the only `toDataURL('image/png')` sites are `components/trade/TradingChart.tsx:1055` and `components/chat/NewBotDialog.tsx:246`, and neither hands bytes to the plugin. | [Verified by code reading] | **NEEDS CHECK** | the Java half is **shipped in the APK** — deleting only the TS wrapper leaves the Java half equally unreachable | `git revert` — **but a revert must include `GallerySaverPlugin.java` and `MainActivity.java`**, because `android/` is excluded by `tsconfig.json:32` and ignored by `eslint.config.js:11`, so **no npm gate covers the Java half** |

**Note on item 2.** The code is verifiably dead. The *plan of record* disagrees:
`HANDOFF_LEARNING_LOOP.md:185` says `pruneOutdatedInsights` and `aggregateSimilarInsights` "are
LIVE (`AlgorithmicMemoryService.ts:142-143`)". **That claim is false at the pin.** So the right
move may be **re-wire, not delete** — the insight store is never pruned or merged, and the
GlobalMemory store it feeds is **write-only** (Report 1 §7, D-13). **This is an owner decision, not
a cleanup item.**

**Note on item 4.** The verdict is **live-but-unwired, not dead**: `MainActivity.java:10` registers
the plugin, so the class **is compiled into the shipped APK** and **is** reachable from the WebView
bridge. Only no JS calls it. **The app cannot save to the Android gallery at all** — a half-feature
that ships 133 lines of Java plus a registration no code path can reach. Two options, and they
must be taken together: **(a) wire it** (`TradingChart.tsx:1055` already produces the PNG bytes, so
a "save chart snapshot to gallery" affordance is small), or **(b) delete both sides** so the APK
stops carrying a dead plugin.

### 1.2 The `messageDisplayText.ts` warning — resolved, and it is a bug, not a redundancy

`docs/plans/debate-deletion-status.md:793` left this open: *"before deleting an anti-drift
aggregation, both row components must be read to confirm neither leaks `<think>` or `<JSON_PLAN>` on
its own."* **Both row components were read, and the answer is that neither strips anything.**

| component | what it renders | what it strips |
|---|---|---|
| `components/shared/ChatTranscriptRow.tsx` (206 lines) | `row.text` through `FadingText` (`:130`, `:136`) | **only** `parseKeyLevels(row.text).clean` (`:88-90`) — no `<think>` strip, no `<JSON_PLAN>` strip |
| `components/trade/panels/ChatTranscriptList.tsx` (292 lines) | `shownText` through `FadingText` (`:197`); `shownText` (`:119`) = `aiLevels?.clean ?? e.text` | **nothing** |

**⇒ `utils/messageDisplayText.ts` was the *only* render-time strip chain, and it is now orphaned.
The safety net is DEAD, not redundant.** The protection now lives at **write** time
(`services/providers/GenericProviderService.ts:296`/`:317`,
`services/providers/GenericAnalysisService.ts:591`/`:671`,
`utils/thinkingSplit.ts:364` `createThinkingStreamGate`) — so **new** messages are clean, but a
**historical** message persisted before those strips can still leak `<think>` into the bubble, and
**`<JSON_PLAN>` is unstripped at render time entirely** (the only live `stripPlanTags`,
`utils/analysisUtils.ts:854`, is reachable only from debate-era helpers whose own importers are
test-only).

**Recommendation: file the missing render-time strip as a BUG ticket, and do not delete the file
until you decide where the strip goes.** **[Verified by code reading] · NEEDS CHECK.**

### 1.3 Dead exports — 63 fully dead, 202 dead `export` modifiers

**[Verified live]** 1,690 value exports in the tree; 352 have no importer by name. After a
repo-wide search (including `tests/`) for each name: **63 are fully dead code** (zero internal
use, zero production import) and **202 are dead `export` modifiers only** (the code is live inside
its own file; only the keyword is dead). 497 `type` exports are excluded as structural.

#### The 63 fully dead value exports

| file:line :: symbol | note | confidence |
|---|---|---|
| `services/learning/harnessLessons.ts:184` :: `formatHarnessNotesBlock` | **the headline** — see §4.1 | SAFE |
| `constants/prompts/learningPrompts.ts:7` :: `ENTRY_NOT_HIT_ANALYSIS_PROMPT` | 572 chars, no reader | SAFE |
| `constants/prompts/learningPrompts.ts:17` :: `ENTRY_NOT_HIT_ANALYSIS_QUESTIONS` | 1,710 chars | SAFE |
| `constants/prompts/learningPrompts.ts:64` :: `EXTENDED_SL_ZONE_DEBATE_CONTEXT` | 2,180 chars, contains "MODERATOR RESPONSIBILITY" | SAFE |
| `constants/debateMarkers.ts:12` :: `MODERATOR_RETRY_MARKER` | debate-era | SAFE |
| `constants/debateMarkers.ts:18` :: `CONVICTION_RETRY_MARKER` | debate-era | SAFE |
| `constants/debateMarkers.ts:20` :: `CLARIFICATION_DONE_MARKER` | debate-era | SAFE |
| `constants/debateMarkers.ts:26` :: `MODERATOR_ERROR_BLOCK_RE` | debate-era | SAFE |
| `constants/debateMarkers.ts:28` :: `DEBATE_END_MARKERS_RE` | debate-era | SAFE |
| `constants/debateMarkers.ts:31` :: `replacementTimeoutText` | debate-era | SAFE |
| `constants/harnessDataContract.ts:12` :: `HARNESS_TIMEFRAME_LABEL` | | SAFE |
| `constants/calibrationConstants.ts:24` :: `MIN_TRADES_FOR_CALIBRATION_NOTE` | | SAFE |
| `constants/calibrationConstants.ts:66` :: `CONFIDENCE_PENALTIES` | | SAFE |
| `constants/schemas.ts:9` :: `DUAL_SCENARIO_JSON_SCHEMA` | | SAFE |
| `constants/schemas.ts:95` :: `GATE_SCAN_JSON_SCHEMA` | | SAFE |
| `services/agents/seatPersonas.ts:52` :: `GENERAL_DIMENSION_TAGS` | **in flight** | in flight |
| `services/agents/seatPersonas.ts:62` :: `generalSeatMandate` | **in flight** | in flight |
| `services/analysis/DebateMailbox.ts:153` :: `mailboxRosterHint` | debate-era | SAFE |
| `services/analysis/CorrelationRiskService.ts:265` :: `generateCorrelationWarnings` | | SAFE |
| `services/analysis/HybridIntelligenceService.ts:1433` :: `runMonteCarloForSetupAsync` | **HOLD** — see §6 | NEEDS CHECK |
| `services/analysis/MonteCarloService.ts:747` :: `generateMonteCarloPromptInjection` | | SAFE |
| `services/analysis/TimeframeConfluenceService.ts:174` :: `generateConfluencePromptInjection` | | SAFE |
| `services/analysis/TimeframeConfluenceService.ts:299` :: `getConfluenceInsight` | | SAFE |
| `services/backtesting/ModelPerformanceService.ts:1001` :: `identifyLowestPerformer` | | SAFE |
| `services/backtesting/ModelPerformanceService.ts:1041` :: `calculateDynamicWeightsEnhanced` | | SAFE |
| `services/infrastructure/dbService.ts:437` :: `isUsingSqlite` | | SAFE |
| `services/infrastructure/ExportService.ts:31` :: `exportTextAsFile` | | SAFE |
| `services/infrastructure/SqliteService.ts:748` :: `sqliteGetTrades` | **test-imported** (`tests/sqliteService.test.ts`) | SAFE + test |
| `services/infrastructure/SqliteService.ts:780` :: `sqliteDeleteTrade` | | SAFE |
| `services/infrastructure/SqliteService.ts:829` :: `sqliteGetTradeCount` | | SAFE |
| `services/infrastructure/SqliteService.ts:845` :: `sqliteGetTrade` | | SAFE |
| `services/infrastructure/SqliteService.ts:872` :: `sqliteListConversations` | | SAFE |
| `services/infrastructure/SqliteService.ts:913` :: `sqliteListSummaries` | | SAFE |
| `services/infrastructure/ThinkingStoreService.ts:718` :: `buildThinkingRecordId` | | SAFE |
| `services/learning/harnessLessons.ts:159` :: `recordBudgetLessonFromAudit` | | SAFE |
| `services/learning/NotebookWriterService.ts:108` :: `writeNotebookNoteFromPostMortem` | post-mortem-era | SAFE |
| `services/learning/PatternMemorySynthesisService.ts:579` :: `generateSynthesizedPromptInjection` | | SAFE |
| `services/learning/SkillMemoryService.ts:408` :: `listSkillSlugs` | | SAFE |
| `services/learning/skillWorthGate.ts:142` :: `skillClusterExists` | **test-imported** (2 suites) | SAFE + test |
| `services/providers/GenericProviderService.ts:426` :: `thinkingBudgetTokens` | | SAFE |
| `services/trade/toolPayloadStore.ts:181` :: `payloadStoreSize` | **test-imported** | SAFE + test |
| `services/trade/toolPayloadStore.ts:184` :: `clearToolPayloads` | **test-imported** | SAFE + test |
| `services/trade/toolPayloadStore.ts:189` :: `__clearPayloadFailureForTests` | | SAFE |
| `services/trade/tradeShapedProse.ts:78` :: `proseNeedsAChip` | | SAFE |
| `services/ui/AnalystLensService.ts:128` :: `getProviderForRole` | **HOLD** — in flight | HOLD |
| `services/ui/AnalystLensService.ts:336` :: `validateLensConfig` | **HOLD** | HOLD |
| `services/ui/AnalystLensService.ts:363` :: `isLensConfigComplete` | **HOLD** | HOLD |
| `services/ui/AnalystLensService.ts:371` :: `getLensConfigSummary` | **HOLD** | HOLD |
| `services/ui/AnalystLensService.ts:433` :: `appendLensMemoryToPrompt` | **HOLD** | HOLD |
| `services/validation/AccuracyValidationService.ts:82` :: `confidenceScoreToLevel` | | SAFE |
| `services/validation/AccuracyValidationService.ts:92` :: `confidenceLevelToScore` | | SAFE |
| `services/validation/TradeValidationGate.ts:495` :: `runValidationGate` | **the full gate — see §1.5** | NEEDS CHECK |
| `services/validation/TradeValidationGate.ts:983` :: `quickValidate` | | SAFE |
| `utils/debateEnvelopes.ts:6` :: `envelopeKindForRole` | **in flight** | in flight |
| `utils/debateEnvelopes.ts:33` :: `buildOcrEnvelope` | **in flight** | in flight |
| `utils/followedSkills.ts:20` :: `FOLLOWED_SKILLS_LABEL` | | SAFE |
| `utils/harnessSettings.ts:128` :: `subscribeHarnessSettings` | | SAFE |
| `utils/messageDisplayText.ts:24` :: `deriveMessageDisplayText` | see §1.2 | NEEDS CHECK |
| `utils/skillPrediction.ts:75` :: `serializePrediction` | | SAFE |
| `utils/timezone.ts:13` :: `PHT_LABEL` | | SAFE |
| `utils/tokenUsage.ts:70` :: `subscribeTokenUsage` | | SAFE |
| `components/skills/SkillDetail.tsx:31` :: `monogramOf` | | SAFE |
| `tests/helpers/sourceCode.ts:45` :: `codeWithout` | a test helper — **not product code** | keep |

**Caveat: 5 of the 63 are test-imported** (marked). Deleting the export breaks the test, so the
test must go in the same commit.

#### The 202 dead `export` modifiers — a separate, much safer commit

Dropping the keyword is far lower risk than deleting code. Selected (the full list is in
`dead_exports.json`):

`services/ui/EnsembleAnalystService.ts:299` `duplicateTextPairs` — **note:** `AGENTS.md` calls it
the ONE canonical gateway-echo detector; the **function is live** at `:338`; only the export is dead
· `services/validation/GateKeeperService.ts:456` `getGateAnalysis` ·
`services/validation/DataIntegrityService.ts:100/108` `getDataVersion`/`setDataVersion` ·
`services/validation/TradeValidationGate.ts:227` `matchPatternMemory` (**also a duplicate scorer** —
§2.4) · `services/learning/PatternMemorySynthesisService.ts:490`/`:440` ·
`services/analysis/DeskToolsService.ts:2968` `executeDeskTools` ·
`services/analysis/NumericChartService.ts:108/188/290/355/385` (5 in one file) ·
`services/analysis/TechnicalAnalysisService.ts:1319/1361` ·
`services/backtesting/ModelPerformanceService.ts` (7) ·
`services/learning/SkillMemoryService.ts` (11) · `services/learning/selfImprovement.ts` (9) ·
`services/learning/skillIdleLifecycle.ts:176` `idleClockMs` · and ~150 more across `utils/`,
`services/infrastructure/`, `components/` and `hooks/`.

**Four were reclassified during final verification** — they are used *inside* their own file, so
only the keyword is dead: `services/providers/debatePods.ts:23` `POD_NAMES` (used `:64`, `:67`),
`:92` `scaleTranscriptCap` (used `:96`), `:99` `POD_ROUND_MAX_CHARS` (used `:113`, `:136`),
`utils/timezone.ts:14` `PHT_ZONE` (used at `:17`, `:20`, `:22`, `:23`, `:25`, `:28`, `:32`).
**⇒ the `debatePods.ts` *file* is dead in production (its only external importer is
`tests/debatePods.test.ts`) but its constants are not dead code.**

### 1.4 The debate-era cluster in `utils/analysisUtils.ts`

| symbol | status |
|---|---|
| `stripPlanTags` (`:854`) | **test-imported only**; called internally at `:892`, `:991`, `:997` — **it is the ONLY `<JSON_PLAN>` stripper in the app, and it is already unreachable from production** |
| `extractSignalStrategyText` (`:901`) | test-imported only; called internally at `:1142` |
| `looksLikeClarificationDump` (`:866`) | **no importer**; called internally at `:893`, `:992`, `:999` |
| `looksLikeModeratorVerdictDump` (`:880`) | **no importer**; called internally at `:893`, `:908`, `:913`, `:919` |
| `extractModeratorThinking` (`:928`) | test-imported only |
| `isBindingMarkdownPlan` (`:536`) | test-imported only |
| `extractFinalVerdictText` (`:986`) | no importer |
| `formatInvalidationLine` (`:1003`) | no importer |
| `services/learning/EvidencePackService.ts:229` `deriveSetupQueryFromPrompt` | test-imported only |

**⇒ `utils/analysisUtils.ts:1142` is the last live consumer of the moderator / clarification
machinery.** Deleting these exports is SAFE; deleting the machinery is a separate decision.
**⚠ Deleting `stripPlanTags` removes the only `<JSON_PLAN>` stripper — but it is already
unreachable from production, so this is a pre-existing gap, not one the cleanup creates.**

### 1.5 The validation gate's dead exports — a **warning**, not a cleanup item

`services/validation/TradeValidationGate.ts` exports `validateAnalysisOutput` (`:150`),
`detectCrowdedTrade` (`:329`), `validateSessionRisk` (`:384`), **`runValidationGate` (`:495`)** and
`quickValidate` (`:983`) — **all with zero production importers.**

**This is not dead code. It is the single most important thing in this manifest, and it needs a
decision before anything is deleted.** Report 1 §4.2 documents the full gate: 20 checks, a
confidence ladder, an R:R floor, a Devil's Advocate, a probability clamp, a scalp/swing branch. If
**`runValidationGate` has no production caller**, then **the entire validation gate is not wired
into the running app**, and the only thing that actually binds a plan is the narrower
`GateKeeperService` path (`services/validation/GateKeeperService.ts:70`, called from
`services/trade/proposalGate.ts`).

**Do not delete these exports.** First establish which of the two paths is the live one, and
whether the other is genuinely wanted. **[Unverified — needs a call-graph trace from the proposal
card to the gate]** — the export sweep proves the *symbol* is unreferenced; it does not prove the
*behaviour* is absent, because the gate's checks may be reached through
`GateKeeperService` instead.

### 1.6 The scanner false-positive classes — recorded so they are not re-reported

| class | what it looks like | the truth |
|---|---|---|
| `new Worker(new URL('./x.worker.ts', import.meta.url))` | a naive AST matcher that requires the outer `new` argument to be a `CallExpression` misses it (the inner `new URL(...)` is a `NewExpression`) | `services/analysis/monteCarlo.worker.ts` is **LIVE** — `services/analysis/MonteCarloService.ts:801-805`, literal at `:803` |
| the `@/` path alias | a resolver that only handles relative specifiers | `lib/utils.ts` is **LIVE** via `components/ui/task.tsx` (`components/analysis/AnalysisProgress.tsx:13`, `components/analysis/EvidencePackCard.tsx:2`); `components/ui/collapsible.tsx` is live via `AnalysisProgress.tsx:14`; therefore **`@radix-ui/react-collapsible` is live too** |
| a CSS plugin directive | a JS import scanner sees no import | `@tailwindcss/typography` is **LIVE** — `index.css:2` `@plugin "@tailwindcss/typography";` |
| a regex export sweep vs the compiler API | `components/shared/Icons.tsx` exports ~40 icon names that **are** imported; the regex sweep reported them as unreferenced | the **TypeScript-API graph is authoritative**; the two tools' disagreement on `Icons` is **not a finding** |
| a "*.js token in prose" comment scan | `utils/analysisTrace.ts`, `kelly.ts`, `tradingview.js`, `debateChat.test.tsx` | the real set is the **8** rows in §3.3 |

### 1.7 The dead import, already fixed in flight

`hooks/useAnalysisPipeline.ts:14` imported `defaultToolsForRole` with **no remaining use** — its
only call site was removed by `395f73db`. Invisible to CI because `tsconfig.json:28` sets
`noUnusedLocals: false` and `eslint.config.js:135` makes it a *warning* under a
`--max-warnings 889` cap. **The concurrent session has already deleted the import line.** Worth
noting: had it not, deleting `types/bot.ts` would have been a **hard compile error**, not a
warning.

---

## 2. Dead and duplicate data paths

### 2.1 `approval_rules_v1` — on neither allow-list, and it gates every auto-apply

**[Verified by code reading]** `utils/approvalInbox.ts`: `rulesKey(username)` at `:24-25` =
`approval_rules_v1:${user}`; `LEGACY_RULES_KEY = 'approval_rules_v1'` at `:23`.
**Write** `:46` `localStorage.setItem(rulesKey(username), …)`.
**Reads** `:29`, `:30` (the legacy fallback), `:38` `getAutoJournalRules`, `:51-53`
`autoJournalPolicyFor`.
**Not** in the 38-entry RAW list (`ExportService.ts:299-391`) and **not** in the restore allow-lists
(`:658-680` exact, `:683-756` prefixes).

**The repository's own test documents the gap verbatim**:
`tests/exportRawLocalStorage.test.ts:97` — `['approval_rules_v1', 'NOT backed up: the inbox rules
gate every auto-apply — worth a decision']`.

**Impact:** on **web** the sweep exports it (localStorage *is* the Preferences fallback) but the
**import skips it** (`isRestorablePreferenceKey`, `ExportService.ts:758-760`); on **native** it is
neither exported nor restored. **A native restore silently reverts every per-coin auto-apply to
"ask".**

**Confidence: the gap is SAFE to fix; the fix is a PRODUCT DECISION the repo explicitly deferred.**
**⚠ Do NOT widen the RAW list "for safety"** — the WebView origin quota is shared
(`ExportService.ts:291-293`; `tests/exportRawLocalStorage.test.ts:132-152` says so explicitly).

### 2.2 Five namespaces that are restore-listed but NOT raw-listed

**[Verified by code reading]** a programmatic cross-check of all 38 RAW prefixes against all 58
restore prefixes:

| namespace | write | read | RAW? | restore? | native effect |
|---|---|---|---|---|---|
| `agent_threads_opened_v1_<user>` | `utils/agentThreads.ts:323` | `:313` | **NO** | YES (`ExportService.ts:743`) | neither exported nor restored |
| `desk_idle_motion_v1_<user>` | `services/desk/idleMotion.ts:34` | `:26` | **NO** | YES (`:745`) | same |
| `thinking_leak_bin_v1` | `utils/thinkingLeakBin.ts:39` | `:12` | **NO** | YES (`:679`, exact) | same |
| `trade_sidebar_open_v1` | `App.tsx:475` | `App.tsx:454` | **NO** | YES (`:737`) | same |
| `last_active_user` | `hooks/useUserProfileLoader.ts:501`, `services/learning/PatternMemorySynthesisService.ts:677` | 10 sites incl. `services/infrastructure/sessionSearch.ts:124`, `StorageService.ts:98,147` | **NO** | YES (`:750`) | same — **and `bots_v1_<user>`'s roster key is derived from it** (`services/bots/BotRegistry.ts:15`), so the roster can restore under the wrong user |

`ExportService.ts:294-296` states the invariant: *"a key missing from this list does not merely fail
to restore, it EXPORTS THE WRONG BYTES."*

**The repo's own `AWAITING_BACKUP_DECISION` table** (`tests/exportRawLocalStorage.test.ts:153-171`)
already lists `desk_idle_motion_v1`, `last_active_user` and `thinking_leak_bin_v1` as awaiting an
owner's decision. **`trade_sidebar_open_v1` and `agent_threads_opened_v1` are on *neither* table** —
an **un-recorded instance of the recorded class**, and the reason the test passes on them is
precisely the blind spot its own header (`:107-122`) describes: the test ORs the two lists, so a
restore-listed key passes even when it is not raw-listed.

**Not a finding:** `trade_chat_active_v1_<user>` — deliberately excluded and documented at
`ExportService.ts:367-371`; the plain-string value cannot be JSON-swept.

### 2.3 The three dead Preferences keys, and the five split read/write stores

#### Dead settings — zero writers, zero readers, one grep hit each (their own declaration)

| key | declaration | note |
|---|---|---|
| `PREF_KEYS.MEMORY_PROVIDER` = `'memory_provider'` | `services/infrastructure/PreferencesService.ts:24` | the comment claims *"ProviderConfig id of the provider used for memory synthesis"*; **no code implements it** |
| `PREF_KEYS.HYBRID_PANEL_POSITION` = `'hybrid_panel_position'` | `:33` | |
| `PREF_KEYS.QUIET_HOURS` = `'quiet_hours_v1'` | `:42` | |

**Bonus:** because `ExportService.ts:659` does `...(Object.values(PREF_KEYS))` into
`RESTORABLE_PREFERENCE_KEYS`, these three are **also swept into every backup as phantom keys**.
Removing them removes them from backups too. **No migration is needed — they were never written.**

#### ☠ The split read/write stores — a **live bug**, not cleanup

`PreferencesService.setPreference` writes to Capacitor Preferences (SharedPreferences /
UserDefaults) on native and to localStorage on web (`PreferencesService.ts:68-74`); a direct
`localStorage.getItem` on native reads the **WebView's** localStorage. **Two different places.**

| # | key | write | read | effect |
|---|---|---|---|---|
| 1 | `custom_ensemble_prompt` | `services/ui/AnalystLensService.ts:483,487` `setPreferenceObject` | `services/ui/AnalystLensService.ts:473` `localStorage.getItem` | **the trader's custom prompt NEVER APPLIES ON NATIVE.** And even on web there is a **format** bug: the writer `JSON.stringify`s and the reader returns the raw string, so the value read back is `"my prompt"` **including the JSON quotes** |
| 2 | `custom_lens_prompts` | `:515` `setPreferenceObject` | `:499` `localStorage.getItem` | **per-role lens overrides never apply on native** |
| 3 | `model_performance_data` | `services/backtesting/ModelPerformanceService.ts:398` `setPreferenceObject` | `:373` `localStorage.getItem` + `:191` `getPreferenceObject` | two readers can disagree |
| 4 | `rolling_window_data` | `ModelPerformanceService.ts:830` `setPreferenceObject` | `:813` `localStorage.getItem` + `:192` `getPreferenceObject` | same |
| 5 | `confluence_historical_stats` | `services/analysis/TimeframeConfluenceService.ts:232` `setPreferenceObject` | `:206` `localStorage.getItem` + `:56` `getPreferenceObject` | same |

**#1 and #2 feed `hooks/useAppSettings.ts:40` → `useAnalysisPipeline` → the analysis system prompt.
They are live bugs, and the fix must keep web working** (the web path works only by accident of
`PreferencesService`'s localStorage fallback). **Confidence: #1/#2 RISKY (a cleanup that repoints
them changes behaviour) · #3/#4/#5 NEEDS CHECK.** **File as bugs, not as cleanup.**

**Gate for anything in this section:** `npm run typecheck && npm run test`, **plus**
`npm run render-probe` (Settings → Prompts is a rendered surface), **plus** `npm run test:coverage`
if the export/restore expectations move.

#### Legacy / migration-only keys — legitimate, but mislabelled

- `PREF_KEYS.CONFIDENCE_CALIBRATION` = `'confidence_calibration'` — read at
  `ModelPerformanceService.ts:1208` and **removed** at `:1213`. The **live** key is
  `'model_confidence_calibration'` (`CONFIDENCE_CALIBRATION_STORAGE_KEY`, `:1206`). The constant
  name does not say "legacy" → misleading. **The migration reads localStorage only**, so on native
  a legacy Preferences copy is never migrated.
- `PREF_KEYS.ATTRIBUTED_INSIGHTS` = `'attributed_insights_kb'` — read at
  `services/learning/distilledMemory.ts:329`, removed at `:340` (per-user suffix).
- `PREF_KEYS.MODEL_PERFORMANCE_DATA` / `ROLLING_WINDOW_DATA` / `CONFLUENCE_STATS` also appear on
  the **RAW** export list (`ExportService.ts:304,305,308`) although their owners write through
  Preferences — **a third inconsistency**: the RAW list says "localStorage owner", the writer says
  "Preferences owner".

**Duplicate key:** `PREF_KEYS.PROVIDER_CONFIGS` = `'provider_configs_v1'` is used only by
`ExportService.ts:214,912`; the **real** owner is `services/infrastructure/ProviderConfigService.ts:12`
with its own identical literal. **Two owners, one key.**

### 2.4 The planned R:R — **four** implementations, not two

`utils/riskReward.ts:1-18` documents the canonical rule: *"nearest-TP ÷ stop … deliberately
independent of array order."*

| # | implementation | status |
|---|---|---|
| 1 | `utils/riskReward.ts:48` `plannedRiskReward` | **CANONICAL** — callers `services/trade/proposedTrade.ts`, `utils/analysisUtils.ts:1273`, `utils/avoidReason.ts:50` |
| 2 | `services/validation/AccuracyValidationService.ts:196` `validateRiskReward` | **LIVE**, called at `services/validation/TradeValidationGate.ts:642`; the TP comes from `TradeValidationGate.ts:589` — **`analysis.takeProfit[0]?.price`** |
| 3 | `services/analysis/ScalpDetectionService.ts:178` and `:236` | **LIVE**, called at `TradeValidationGate.ts:889` and `:899` — also index-0 |
| 4 | 🆕 `services/trade/chartDrawings.ts:608-615` | `risk = |entry.p − stop.p|`, `reward = |target.p − entry.p|`, `ratio = reward/risk`, printed as `${ratio.toFixed(2)}:1` — **a user-drawn measured-move drawing renders a planned R:R that is NOT routed through `utils/riskReward.ts`** |
| 5 | ⚠ `services/learning/PatternMemorySynthesisService.ts:260-268` | `tp = analysis.takeProfit?.[0]?.price` — an index-0 selection, the exact defect the canonical module was created to eliminate. **NEEDS CHECK** — it may be the realized/estimate quantity |

**Verified NOT defects:** `utils/paperPnl.ts:18-23` `paperPnlR` (a realized quantity, explicitly
allowed by `riskReward.ts:16-17`) · `services/backtesting/ScenarioSimulatorService.ts:92-100`
(correctly imports `firstTargetDistance` from `utils/riskReward.ts:13`) ·
`services/analysis/DeskToolsService.ts:2832` and `HybridIntelligenceService.ts:1507` (stop distance
for ATR / degeneracy checks).

**⇒ #2, #3 and #1 can disagree for the SAME trade: the gate downgrades on #2, the scalp warnings
use #3, the card prints #1.** See Report 2 §E-02.

### 2.5 Similarity — **seven** implementations, not two

`AGENTS.md:216-221` says *"Do not write a third similarity function."* **There are seven.**

| # | implementation | status |
|---|---|---|
| 1 | `services/ui/EnsembleAnalystService.ts:264-323` `duplicateTextPairs` — trigram set, Jaccard at `:321`, `DUPLICATE_SIMILARITY = 0.9` at `:297` | **LIVE** at `:338`; the **export** is dead |
| 2 | `services/learning/MemoryConsolidationService.ts:20` `calculateSimilarity` → `:33` `levenshteinDistance` — the **only** Levenshtein in the repo | **DEAD** |
| 3 | `services/learning/PatternMemorySynthesisService.ts:129` `calculateSimilarity` + `SIMILARITY_WEIGHTS` (`:111`: coin/family/pattern/regime/direction/confidence/recency) → 0..100 | **LIVE** (`services/validation/GateKeeperService.ts:12,159`) |
| 4 | `services/validation/TradeValidationGate.ts:227` `matchPatternMemory` — a **second** hand-rolled weighted scorer, `normalizedSimilarity = (similarityScore / 90) * 100` at `:302` — **a different denominator from #3** | **TEST-ONLY**, dead in production |
| 5 | `services/backtesting/LiveBacktestService.ts:155` `calculateSimilarity(currentAnalysis, trade, currentRegime)` | **LIVE** |
| 6 | `services/backtesting/ScenarioSimulatorService.ts:247` — *"the same rule `LiveBacktestService.calculateSimilarity` already enforces"* | **LIVE** — a re-implementation of #5 |
| 7 | `services/learning/MemoryRetrievalService.ts:385` — *"a 0..1 Jaccard overlap of content words"* | **LIVE** |

**Ruled out:** `utils/patternMatch.ts` does **not** exist; `utils/patternMining.ts` holds
`mineCoinFromPrompt`/`minePatternFromPrompt` (string mining, not similarity);
`utils/patternDetection.ts` has `countTouchesOnLine`/`findPivots` (geometry);
`fast-levenshtein` appears only in `package-lock.json` (transitive, not imported by app code).

**Confidence: the duplication is VERIFIED; the consolidation is NEEDS CHECK** — #1/#2 are
text-vs-text, #3–#6 are setup-vs-trade feature scores, #7 is content-word overlap. **They are not
interchangeable, so "delete the duplicates" is not automatically right.** The zero-risk part: #2
(dead Levenshtein) and #4 (test-only duplicate scorer) can go; #1's export can be un-exported.
**#3 and #5 are the two live setup-vs-trade scorers — different questions, same name, same 0..100
scale: a drift hazard.**

### 2.6 "Which provider is ready" — written out twice

`utils/providerUtils.ts:18-22` `isProviderReady` — and
`services/infrastructure/ProviderConfigService.ts:332-336` `getReadyProviders`.
**Both doc comments admit it:** `providerUtils.ts:13-16` *"Mirrors `getReadyProviders()` in
`ProviderConfigService` exactly"*; `ProviderConfigService.ts:329-330` *"Mirrors
`providerUtils.isProviderReady` exactly."* **The clause order differs** (key before models) — the
same boolean today, with nothing enforcing it. **A third wrapper:** `hooks/useBotMailbox.ts:94`
`isProviderReadyFor` (provider + model).

**Confidence: duplication VERIFIED; a fix is RISKY** — `providerUtils.ts:8` imports
`shared/providerRequestPolicy.cjs` and `ProviderConfigService` is a heavier module, so the copy
exists for the "dependency-free so it can run inside hooks/memos" reason (`providerUtils.ts:16`).
12 importers of `isProviderReady`, 4 of `getReadyProviders`.

### 2.7 Money formatters — at least **five** shapes for a dollar amount

| # | implementation | shape |
|---|---|---|
| 1 | `utils/formatters.ts:69-73` `fmtUsd` | `$1.23 / $1.23M / $1.23B` — **one** importer (`components/trade/TradeView.tsx`) |
| 2 | `utils/formatters.ts:34` `fmtPrice` | `45.30 / 113,456.79` (no `$`) — 4 importers |
| 3 | `services/ui/AutoCaptureService.ts:580` | a **local copy inside a function body**: `` val ? `$${val.toLocaleString()}` : 'N/A' `` |
| 4 | `utils/recentTradesBrief.ts:228` | a **local copy**: `` `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}` `` |
| 5 | `components/journal/Journal.tsx:342,358`, `components/journal/TradeLog.tsx:433`, `components/dashboards/WinRateDashboard.tsx:263,589,595` | `toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})` — **no decimals**, against `±$N.NN` (2 dp) elsewhere. **Two different shapes for the same money in the same app** |
| 6 | `services/learning/MemoryFilesService.ts:849`, `services/learning/weeklyReview.ts:96` | `$N.NN / $N` |

**The repo documents its own duplication:** `utils/formatters.ts:19-25` — *"NOT deduped here
(peer-owned as of 2026-09-16): `services/ui/AutoCaptureService.ts`'s `fmtPrice` … and the two
`formatTime` copies."* **⚠ That comment names a file that does not exist** — `utils/analysisTrace.ts`
is not in the tree (see §3.3).

### 2.8 Date / duration formatters — **seven** "Xm ago" implementations

1. `components/trade/panels/ChatHistoryPalette.tsx:18-26` `relTime` — *Xm ago / Xh ago / X days ago / X wk ago* (the one `components/shared/ChatTranscriptRow.tsx:194-196` calls *"the same helper the history palette uses"*)
2. `components/chat/GroupChatView.tsx:65-66`
3. `components/chat/CoachThreadPanel.tsx:38-40` — *"X min. ago / X hr. ago / X days ago"*
4. `components/learn/SupervisorStream.tsx:71-72` — *"Xs ago / Xm ago"*
5. `components/settings/ProviderManager.tsx:104-106` — *"just now / Xm ago / Xh ago"*
6. `services/learning/memoryTopics.ts:100-111` — *"now / Xm ago / Xh ago / Xd ago"* (its comment claims *"The ONE duration formatter for this surface"* — surface-scoped, so not a lie, but it is the **sixth**)
7. `services/trade/chartDrawings.ts:528` `agoLabel(ageMs)` — its own
8. `services/analysis/HybridIntelligenceService.ts:906` `ageLabel` — its own
9. `services/infrastructure/SessionService.ts:256` `formatTime(hour, minute)` — an `HH:MM` clock pad (the **other** `formatTime` copy named by `utils/formatters.ts:21-24`)

**Consolidating changes rendered labels on six surfaces ⇒ the gate is `npm run render-probe` — it
is the only gate that sees rendered text.**

### 2.9 Two prompt-composition paths

1. `utils/composePrompt.ts:36` `composePrompt` — **canonical** per `AGENTS.md:161-163`; used at
   `services/providers/GenericAnalysisService.ts:365` and `:407`
2. `components/trade/TradeChatPanel.tsx:453` `systemPromptFor` — a **second, independent**
   system-prompt builder for the chat surface, threaded through
   `services/trade/chatTurnRunner.ts:224,311,890,1067,1204`

**Confidence: duplication VERIFIED; consolidating NEEDS CHECK** — they build different prompts.
(`utils/composePrompt.ts` also has a dead export, `stripHarnessContract` — test-only.)

### 2.10 Ruled out — checked, and **not** duplicates

| concept | verdict |
|---|---|
| **session identity** | `services/infrastructure/SessionService.ts` owns the **market** session (Asian/London/NY, `formatTime` `:256`, `isMonthlyClose`/`isWeeklyClose` `:248`); `services/trade/chatStore.ts` + `chatSessions.ts` own the **chat/trade** session. Different nouns. **Not a duplicate.** |
| **plan identity** | **not** duplicated — **one** `planId`, minted at `services/trade/presentTradeTool.ts:85` (`mintPlanId`), carried on `Message.planId` (`types/message.ts:262`) and `LoggedTrade.planId` (`types/trade.ts:49`), deduped on the journal row at `App.tsx:1585-1592` |
| **trade-log writers** | **exactly one** production write path — `hooks/useTradeLogging.ts:413` → `chatStore.addOpenTrade` (`services/trade/chatStore.ts:418`). `git grep "addOpenTrade\|logPaperTrade\|insertTrade\|saveTradeToDb\|logTrade("` → 6 hits, **one** production writer |
| **position size** | `utils/ticketSize.ts` is the **single** sizing module (it records every multiplier as a labelled `SizeAdjustment`, `:4-13`). `services/analysis/MonteCarloService.ts:631` `riskPerTrade` is a different question (the ruin-risk fraction for a simulation), not a second sizer. (`utils/ticketSize.ts:6` cites *"Clodds kelly.ts"* — an **external** project, not a dead path) |

### 2.11 The three parallel memory stores — the repo says so itself

`services/learning/distilledMemory.ts:3-5` — *"attributed_insights_kb_<user> — a THIRD parallel
memory store"*; `services/learning/PatternMemorySynthesisService.ts:664` repeats it. The three:

1. the **NOTEBOOK** (`services/learning/MemoryFilesService.ts`, markdown files);
2. the **ATTRIBUTED-INSIGHTS** store (`attributed_insights_kb_<user>`, now migrated into the notebook
   at `distilledMemory.ts:343`);
3. the **GLOBAL MEMORY** / insight knowledge base (`services/learning/MemoryService.ts` —
   `GlobalMemory.insightKnowledgeBase.insights`).

**The global-memory store is WRITE-ONLY.** The repo's own attachment note says it:
*"AlgorithmicMemoryService — called by `MemoryService.updateGlobalMemory` … but NOTHING reads
`GlobalMemory.aiPatternMemory` or `familyPerformance` back into any prompt (I checked
`MemoryRetrievalService.getMemoryFilesContext` — those fields aren't surfaced). The whole
`AlgorithmicMemoryService` is a write-only side ledger."*

**Corroborated by §1.1 item 2:** the pruner for exactly that store is dead, so the store grows
without ever being pruned or merged. **Confidence: the three-store observation VERIFIED; the
write-only claim [Verified by code reading]. HOLD per the roadmap** — the store may be planned for
a reader.

### 2.12 The systemic pattern: two localStorage-vs-Preferences access paths

The tree has **60+ direct `localStorage.*Item` call sites across 30+ files** alongside the
sanctioned `PreferencesService` abstraction, and `ExportService.ts:299-391` exists precisely to keep
the two in sync. The enforcement is a source scan: `tests/exportRawLocalStorage.test.ts` (423
lines) — it resolves each call site's key shape and fails when the namespace is on neither list
(`:363-371`) or is on the restore list but not the RAW list (`:373-385`).

**Two real holes in that guard, both confirmed:** (1) `approval_rules_v1` is exempt by table
(`:97`) — recorded, not caught; (2) `trade_sidebar_open_v1` and `agent_threads_opened_v1` are on
**neither** table — they pass the guard only because the restore list happens to contain them,
which is exactly the "restore-listed but not RAW" class the test's own header (`:107-122`) calls
wrong.

### 2.13 A dead feature flag with a **live** Settings control

`utils/harnessSettings.ts:13` `debateCostCapUsd: number` — the type at `:13`, the load at `:86-87`,
and a **live, user-visible field** labelled *"Debate cost cap (USD, 0 = off)"* at
`components/settings/SessionUsagePanel.tsx:327`, the value at `:332-333`.

`git grep debateCostCapUsd 6a41a9f` → **4 hits**: the type, the load, and the settings field.
**No code path ever reads it to cap anything.** The repo's own test says so:
`tests/desktopUsageBridge.test.ts:11` — *"per-debate `debateCostCapUsd` money guard NEVER FIRED on
desktop."*

**Confidence: SAFE to remove the field and the label** (it is user-visible copy for a feature that
does not exist). **Depends on:** `utils/harnessSettings.ts` (the `harness_settings_v1` store, which
**is** on the RAW export list at `ExportService.ts:381`) and the Settings → Session Usage panel.
**The stored value is inert.** Rollback: `git revert`; the stored key remains and is harmlessly
ignored.

### 2.14 A budget constant with no reader

`services/analysis/DeskToolsService.ts:204-205`: `DESK_TURN_BUDGET_MS` is **test-referenced only**
(`tests/deskToolDeadline.test.ts`); `DESK_TURN_WRAPUP_AT` (`:205`) has **no reference at all**.

**NEEDS CHECK: a budget constant with no reader is either a bug (the budget is not enforced) or a
leftover.** The turn budget *is* documented elsewhere in the same file (`:192`, `:204`, `:3449`), so
these two may be a second, unused copy of a live mechanism.

---

## 3. Prompts and copy

### 3.1 `formatHarnessNotesBlock` — the reader is dead, the store is not

**[Verified by code reading]** `services/learning/harnessLessons.ts:184`
`formatHarnessNotesBlock(max = 4): string`.

- **The reader is dead.** The TypeScript-API importer map gives **zero importers** (source or
  test); a repo-wide name search gives 0 hits outside its own definition. Its doc comment
  (`:177-183`) says *"Harness-lesson read path for **THE MODERATOR**: a compact digest of the
  harness's own wire/budget beliefs, injected into the verdict context so the arbiter weighs known
  provider quirks"* — **the moderator died with the debate engine and no call site was left.**
- **The store is live.** `services/learning/harnessLessons.ts:142`
  `registerWireRoutePins((route, providerId) => route !== 'none' && load().some(l => l.kind === 'wire' && …))`
  → `services/providers/reasoningControls.ts:202` `registerWireRoutePins` → `:205` `isRoutePinned`,
  which has **5 live call sites**: `reasoningControls.ts:264` (xai-effort), `:276` (openai-effort),
  `:289` (glm-thinking), `:312` (deepseek-thinking), `:349` (responses-effort).

**⇒ Delete `formatHarnessNotesBlock` and ONLY it.** Keep `load()`, `recordHarnessLesson` and the
`registerWireRoutePins` wiring at `:142`. **Confidence: SAFE. Depends on: nothing. Rollback:
`git revert`** (a pure function over an in-memory store).

**This is the exact defect `docs/learning-loop-map.md:114` records as *"Closed? yes"* — and it is
wrong on both the reader and the file it names (`ensembleService.ts` does not exist).** See §8.

### 3.2 The prompt registry — every entry has a real call site; the *drift* is the problem

**[Verified live]** all **11** registry ids have a `getPrompt()` consumer — there are **no dead
registry entries**. `tests/promptsAreWired.test.ts` pins this with `UNREACHABLE_CEILING = 0`.

**Two defects the gate cannot see:**

**(a) Two `getPrompt` ids that are not in the registry.** `learning.skill_refine`
(`services/learning/SkillCraftService.ts:228`) and `learning.skill_worth`
(`services/learning/skillWorthGate.ts:112`). A user override stored under either id **is applied**,
but the Settings → Prompts tab renders only `PROMPT_REGISTRY` — so the override is **invisible and
cannot be reset from the UI**. **NEEDS CHECK** — the intent may be "not user-editable", in which
case the `getPrompt` indirection is the bug.

**(b) Three registry entries hold a *different, older copy* of the prompt they shadow.** See
Report 2 §E-08 — `strategy.summarize_pdf` (992 vs 1,358) is the material one.

### 3.3 Comments naming files that no longer exist — **8 real hits** of 20 scanned

| file:line | names | the truth |
|---|---|---|
| `hooks/useTradeLogging.ts:991-992` | `tests/hookDestructureHygiene.test.ts` | **the test does not exist.** `eslint.config.js:117-120` records its removal: *"The guard was removed when the cap was corrected."* **⇒ the stated protection does not exist** |
| `utils/formatters.ts:21` | `utils/analysisTrace.ts` | the "first `formatTime` copy" it points at is **gone** |
| `services/learning/SkillMemoryService.ts:2745` | `usePostMortem` | the hook was **deleted** in `03fc0d5` (2026-10-18). The repo's own status doc already records it (`docs/plans/debate-deletion-status.md:2350`) |
| `components/agents/AgentsView.tsx:245` | `verdictFinalizer.ts` | gone |
| `components/shared/ChatTranscriptRow.tsx:18` | `verdictFinalizer.ts` | gone |
| `scripts/check-flow-doc-anchors.cjs:206` | `verdictFinalizer.ts:645` | the gate's **own** comment: *"the ledger cites `verdictFinalizer.ts:645` and THAT FILE IS GONE"* — a gate already knows |
| `vitest.config.ts:17` | `debateChat.test.tsx` | gone |
| `eslint.config.js:117` | `tests/hookDestructureHygiene.test.ts` | the same dead name that `hooks/useTradeLogging.ts:991` still relies on |

**Not findings:** `services/validation/calibrationPolicy.ts:4` + `calibrationPrompts.ts:4` +
`calibrationStore.ts:4` → `ConfidenceCalibrationService.ts` (a deliberate, accurate past-tense
"split out of the former…"); `utils/ticketSize.ts:6` → `kelly.ts` (an **external** project).

### 3.4 User-visible strings promising removed features

| file:line | string | verdict |
|---|---|---|
| `components/analysis/InlineVerdict.tsx:86` | **"Inspect debate audit & evidence"** (button text) | SAFE — relabel |
| `components/settings/SessionUsagePanel.tsx:327` | **"Debate cost cap (USD, 0 = off)"** | SAFE — a **dead flag with a live control** (§2.13) |
| `components/settings/tabs/ModelsTab.tsx:127` | **"DEBATE MODERATOR"** (Settings → AI setup field label) | **the field must stay** — it still picks the verdict/arbiter model (`App.tsx:1491-1492` → `PREF_KEYS.LAST_MODERATOR_PICK`; `hooks/useAnalysisPipeline.ts:536` `runModeratorModel`). **Relabel only** ("Verdict model" / "Arbiter model") |
| `components/automation/AutomationEditorModal.tsx:255` | "Pick the moderator model." | SAFE — relabel |
| `components/automation/AutomationEditorModal.tsx:574` | "Moderator model" (section heading) | SAFE — relabel |
| `components/automation/AutomationEditorModal.tsx:504` | **"Runs the full analyst debate pipeline."** | SAFE — it now runs a tool turn |
| `components/trade/panels/ChatComposer.tsx:196` | `title="Run the full ensemble analysis (hybrid data + debate + verdict) on this request"` | SAFE — relabel |
| `components/chat/GroupChatView.tsx:302` | starter prompt **"Debate the current BTC setup"** | SAFE — relabel |
| `components/chat/NewBotDialog.tsx:317` | "DEBATE PERSONA" | SAFE — relabel |
| `components/chat/NewBotDialog.tsx:325` | `aria-label="Debate role"` | SAFE — **screen-reader-visible** |
| `components/chat/NewBotDialog.tsx:358` | "The bot inherits this role's prompt in debates…" | SAFE — relabel |
| `components/chat/NewGroupDialog.tsx:5` | "each member's debate role" | SAFE — relabel |
| `components/chat/NewGroupDialog.tsx:19` | "debate persona" | SAFE — relabel |
| `components/learn/MemoryFilesManager.tsx:406,410` | "Which debate audience may load this skill", options `['all','analyst','moderator']` | **NEEDS CHECK** — the `'moderator'` option may gate a live write path |
| `components/settings/StrategiesManager.tsx:234,287,362` | "injected into every analysis and debate prompt" / "(ANALYSTS + MODERATOR) will follow it" / "…in every analysis and debate prompt." | SAFE — relabel |
| `components/settings/tabs/GeneralTab.tsx:75` | "Lets analysts and the MODERATOR call live tools anytime" | SAFE — relabel |
| `components/settings/ToolForgeManager.tsx:62` | "Tools proposed by the models during debates" | SAFE — relabel |
| `components/dashboards/StrategyStudio.tsx:415` | toast "Skills imported — … the models can use them in debates now." | SAFE — relabel |
| `components/settings/PromptManager.tsx:25,28` | `GROUP_ORDER = ['analysis','debate','postmortem','strategy','notebook']` and `debate: 'Debate'` | SAFE — a dead group label |
| `components/settings/SettingsMenu.tsx:184` | nav keywords include `'moderator'` | SAFE — a stale search keyword |
| `components/journal/ThinkingRecordCard.tsx:36` | `if (record.role === 'moderator') return 'Moderator';` | **NEEDS CHECK** — historical records may still carry `role: 'moderator'` |
| `components/journal/ReasoningPanel.tsx:26,48,98-100` | "the MODERATOR SYNTHESIS" block | **NEEDS CHECK** — data-driven |
| `components/journal/MonthlyReportCard.tsx:8,64,67` | monthly Brier panel with a `'moderator'` column | **NEEDS CHECK** — `services/learning/monthlyReport.ts:249` still says *"Ensemble line beat the MODERATOR this period"* |
| `components/journal/TradeLog.tsx:73,351` | renders "Mod: {model}" from `trade.moderatorModel` | **NEEDS CHECK** — historical rows (`types/trade.ts:105-106`) |
| `components/chat/pixelAvatars.ts:45,81,209,210` | a `'moderator'` avatar role + gold-sash pixels | **NEEDS CHECK** |

**Confidence:** SAFE for the pure-label ones; **NEEDS CHECK** for the data-driven ones.
**Depends on:** rendered labels ⇒ **`npm run render-probe`**. **Rollback:** `git revert`.

### 3.5 Comments naming a deleted engine or module

`components/analysis/EvidencePackCard.tsx:26` · `components/analysis/VerdictAudit.tsx:58` ·
`components/analysis/RunContractPanel.tsx:7,36` · `components/analysis/AnalysisProgress.tsx:133-136` ·
`components/agents/AgentsView.tsx:30,463` · `components/automation/AutomationRunCard.tsx:25` ·
`components/shared/ReasoningRow.tsx:121` · `components/chat/GroupChatView.tsx:42` ·
`constants/disclaimer.ts:8` (*'"ensemble debate", "binding verdict"'*) ·
**`constants/prompts/harnessContract.ts:16`** (*'"The public FLOOR reply"', '"The moderator\'s last
block"'*).

**⚠ `constants/prompts/harnessContract.ts` is a LIVE prompt that reaches the model — it still
instructs the model about a Floor and a moderator that no longer exist.** Treat as a Batch-1 text
change, but verify with the probe.

**Not findings:** `constants/prompts/analysisPrompts.ts:137` (*"Relocated here from the DELETED
DEBATE-PROMPT FILE"* — accurate history) · `constants/prompts/chatPrompts.ts:3` (historical).

### 3.6 Stale behavioural comments — the file exists; the behaviour does not

- `services/learning/memoryHygiene.ts:15-16` — *"…the batch's new insights and then calls
  `pruneOutdatedInsights` + `aggregateSimilarInsights` in the same block"* — **neither is called**
  (§1.1 item 2). **The insight store is never pruned or merged.** NEEDS CHECK — is the pruning
  supposed to run?
- `components/analysis/RunContractPanel.tsx:36` — *"Persisted into DebateReplay via the message"* —
  `DebateReplay` no longer exists as a concept.

### 3.7 Hardcoded statistics and dates in UI copy — **clean**

**[Verified by code reading]** comma-grouped fake counts in `components/`: **0 real hits** (the 10
regex matches are all CSS `rgba(255,255,255,0.04)` colour literals). Hardcoded percentages in UI
copy: **0 hits** — every percentage is computed (`.toFixed(2)` on a live number). Hardcoded dates
in UI copy: **0 hits** — all dates come from `utils/timezone.ts` (`phtStamp`/`phtFullStamp`) or
`relTime`.

### 3.8 Terms ruled out

- **"Chart AI dock"** — **NOT dead copy.** It is the **live** name of the trade surface's chat panel
  (`components/trade/TradeChatPanel.tsx:2` — *"TradeChatPanel — the Chart AI dock on the trade
  surface"*). 50+ hits, all describing a live surface.
- **"Log Trade Win" / "Log Trade Loss"** (`components/modals/DataCaptureModal.tsx:88,95`) — live
  modal titles.
- **"usePostMortem"** — the hook is **gone**; **3 comments** still name it
  (`services/learning/SkillMemoryService.ts:2745`, `tests/harnessMemory.test.ts:600`,
  `tests/skillApprovalRoundTrip.test.ts:117`).
- **"ensembleService"** — only `services/agents/seatPersonas.ts:19` names it; the module is
  `services/ui/EnsembleAnalystService.ts`.
- **"Accuracy Mode"** — **0 hits** in `components/` and `constants/`.
- **"seat layout"** — 0 hits in `components/` and `constants/`.
- **"CalibrationSection"** — 0 hits in `components/` and `constants/`.
- **"desk floor"** — one comment only (`components/analysis/RunContractPanel.tsx:7`). But
  `index.css:832-881` still carries `.debate-floor-body` + `.floor-lean*` — **dead CSS for a
  deleted view** — and `index.css:360-365` still explains `.status-surface`/`.analysis-card` as if
  live.

---

## 4. Tests

### 4.1 Tests that cover only dead code

| test | subject | verdict |
|---|---|---|
| `tests/teamRoster.test.ts` | `utils/teamRoster.ts` | **deleted in flight** |
| `tests/debatePods.test.ts` | `services/providers/debatePods.ts` (no production consumer) | the file is the only importer — **the test keeps a dead file alive** |
| `tests/analysisUtils.test.ts` | `stripPlanTags`, `extractSignalStrategyText`, `extractModeratorThinking`, `isBindingMarkdownPlan` | test-only exports |
| `tests/evidencePack.test.ts:97-101`, `tests/tradeLogTool.test.ts:112` | `ARBITER_ALLOWED_TOOLS` (9 tools, zero importers) | test-only |
| `tests/accuracyValidation.test.ts` | `matchPatternMemory` — the test-only duplicate scorer | see §2.5 #4 |
| `tests/sqliteService.test.ts` | `sqliteGetTrades` and 5 sibling `sqlite*` exports | test-only |
| `tests/toolPayloadStore.test.ts` | `payloadStoreSize`, `clearToolPayloads` | test-only |
| `tests/botWorthGateContext.test.ts`, `tests/chartScanSkills.test.ts` | `skillClusterExists` | test-only |
| `tests/financialMath.test.ts`, `tests/ticketMathTiers.test.ts` | **`utils/ticketSize.ts` — the whole module** | **test-only** — see Report 2 §E-12 |

**The last one is the most consequential and the least obviously a cleanup item:** the sizing
module has **zero production call sites**, and its only coverage is a test suite. **A green test
suite is the only thing standing between the repo and a belief that the module is wired.**

### 4.2 Duplicate tests

- `tests/deskToolCache.test.ts` and `tests/deskToolRepeatGuard.test.ts` both drive
  `clearDeskToolCache` and the 30 s TTL; `tests/deskToolsChartView.test.ts`,
  `tests/deskToolScreener.test.ts`, `tests/deskToolSelfHeal.test.ts`, `tests/deskToolSentinels.test.ts`,
  `tests/deskToolStateful.test.ts`, `tests/deskToolStreamLoop.test.ts`,
  `tests/getIndicatorsTool.test.ts`, `tests/scanSetupsTool.test.ts`, `tests/scanChartSkillsTool.test.ts`,
  `tests/profileMemory.test.ts`, `tests/projectFuturePriceTool.test.ts` each call it too — **12
  suites call the same setup function**; that is good hygiene, not duplication.
- **The real duplication is the export sweep vs the compiler API** (§1.6) — a *tooling* duplication,
  and the resolution is "the compiler API is authoritative".
- `tests/exportService.test.ts`, `tests/exportLearningStores.test.ts`,
  `tests/exportRawLocalStorage.test.ts`, `tests/exportRestoreRoundTrip.test.ts`,
  `tests/exportServiceProviderEncryption.test.ts` — five suites on the export path, which is
  **appropriate** given §2.1/§2.2 are behavioural.

### 4.3 Brittle snapshot tests

`toMatchSnapshot` / `toMatchInlineSnapshot`: the sweep did not produce a count, and the vitest run
shows no snapshot-file failures. **[Unverified — needs a `rg "toMatchSnapshot" tests/` count]**
Recorded as a gap rather than a claim.

### 4.4 Skipped tests

**[Verified live]** **8** skip/only markers in `tests/`. The 11 skipped *tests* are all inside
`tests/lensWordCount.measure.test.ts`, whose whole `describe` is `describe.skip` unless
`RUN_LENS_MEASUREMENT=1` (`:55-56`) — **deliberate and documented at `:7-8`**. **[Unverified — needs
the 8 markers enumerated]** which of the 8 are the file-level `describe.skip`/`it.skip` pairs and
whether any is an accidental `.only`.

### 4.5 Fixtures with sensitive data

**[Verified live]** the working-tree scan for API-key patterns found **zero** hits outside
`tests/runStatus.test.tsx:90,94,98,100`, which are **deliberate fake keys in a sanitizer test
fixture** (the test asserts the error-text sanitizer strips them). The one literal-looking value
inspected is the test fixture at `tests/exportServiceProviderEncryption.test.ts:96` — **a test
string, not a credential**; cited by location only.

**No sensitive data in the test fixtures.** The *live* profile is where the data is, and this
audit did not touch it.

### 4.6 Missing tests on critical paths

| path | status |
|---|---|
| `electron/main.cjs` (1,362 lines) | **no type checking**; `node --check` only. Partial coverage via `tests/electronIpcContract.test.ts` and `tests/desktopUsageBridge.test.ts` |
| `electron/preload.cjs` (52 lines) | the bridge is contract-tested; the 15 methods are not individually tested |
| `scripts/*.cjs` (~6,200 lines) | **no type checking**; `node --check` + a narrow lint config in `guards.yml`. Only `tests/workflowShells.test.ts` and `tests/releaseIsCiOnly.test.ts` reach them |
| `services/infrastructure/Preferences.ts` | `tests/serializedPrefs.test.ts` exists; the **native/web split is not covered** — which is exactly where §2.3's split read/write bug lives |
| the **native** backup → export → import round trip | `tests/infrastructure/backupImportRoundTrip.test.tsx` exists but exercises the **web** path. **The native path — where every §2.1/§2.2 defect lives — is not exercised.** |
| the migration layer | `SqliteService.runMigrations`' "version recorded only on full success" is not directly tested |
| the notebook write-failure path | `tests/memoryNotebookWriteFailure.test.ts` exists ✅ |
| **"the Agents roster is NOT seeded"** (the behaviour `395f73db` introduced) | **NO TEST.** `tests/teamRoster.test.ts` was deleted in the in-flight tree and nothing replaced it. **This is the roadmap's own G-37**: *"no test covered the seeding, so removing it turned nothing red — that silence is evidence nothing was watching, not evidence the feature was inert."* |
| **the sent prompt** | **NO TEST asserts the content of a sent message.** This is the gap that hides F-01, F-09, F-10 and E-09. See Report 2 §E-11. |
| the Android gallery plugin | **NO TEST** — `android/` is excluded from `tsconfig.json` and ignored by `eslint.config.js`, so no npm gate covers it at all |
| `runValidationGate` | **no production importer** (§1.5) and **no test of the whole gate as a unit** — only of its pieces |

---

## 5. Dependencies

**[Verified live]** every dependency in `package.json` was mapped to its import sites across the
whole repository (source, scripts, e2e and tests).

### 5.1 The one genuine orphan

| package | version | evidence | verdict | confidence |
|---|---|---|---|---|
| **`@fontsource/inter`** | `^5.3.0` | **0 import sites.** `index.css:169` names `'Inter'` in the `--font-sans` fallback chain (`'Geist Variable', 'Inter', system-ui, sans-serif`), **but no font file is ever loaded**, so the name resolves to nothing. `AGENTS.md` says the fonts are Geist / DM Serif Text / JetBrains Mono. | **remove the dependency AND the `'Inter'` fallback token** | **SAFE** |

### 5.2 Ruled out — and the reason each false positive happened

| package | the trap | the truth |
|---|---|---|
| `@tailwindcss/typography` | a JS import scanner sees no import | **LIVE** — `index.css:2` `@plugin "@tailwindcss/typography";` |
| `@radix-ui/react-collapsible` | an alias-blind resolver | **LIVE** — `components/ui/collapsible.tsx:1` → `components/analysis/AnalysisProgress.tsx:14` |
| `openai` 4.52.7 | an old pin looks like a leftover | **LIVE** — `services/providers/GenericProviderService.ts:510` `new OpenAI({...})`, used for the `chat_completions` transport only; the `responses` format is a raw fetch (`:947`). **Outdated-major, NOT dead.** The 4.x pin is two years behind, but the shape it serves is the one the transport needs. |
| `@capacitor/android` 7.4.4 | no TS import | **a platform package** — required by the Capacitor CLI for the `android/` platform. Not dead. |
| `js-yaml` 4.3.1 (devDependency) | — | **correctly in devDependencies** — used only by `scripts/check-workflow-shells.cjs:32`. **But the committed lockfile's root `devDependencies` block does not list it** (§5.4) |
| `@types/node`, `@types/react`, `@types/react-dom`, `jsdom`, `tailwindcss`, `typescript`, `eslint`, `electron-builder`, `wait-on`, `concurrently`, `cross-env`, `@vitest/coverage-v8` | no import | **correctly in devDependencies** — they are used by the toolchain, not imported by app code |

### 5.3 Section placement

| package | currently in | should be in | note |
|---|---|---|---|
| `@capacitor/cli` | `dependencies` | `devDependencies` | a build-time tool, not a runtime import. **Minor.** |
| `electron-builder` | `devDependencies` | correct | |
| `electron` | `devDependencies` | correct | the runtime is packaged by electron-builder, which bundles it |
| `js-yaml` | `devDependencies` | correct | |

**There is no separate `electron-builder` config file** — the `build` block in `package.json` is the
whole configuration.

### 5.4 The lockfile drift

**[Verified live]** the **committed** `package-lock.json`:
- says `"version": "1.0.30"` while `package.json` says **`1.3.0`** — a three-minor-version mismatch;
- its root `packages[""].devDependencies` block **does not list `js-yaml`**, although `package.json`
  does and `scripts/check-workflow-shells.cjs:32` imports it.

**The fix is sitting uncommitted in the working tree** (the lockfile is the one dirty file at the
pin). **Committing it is a one-line-change commit.**

**The rest of the lock is otherwise in sync** with the manifest's ranges: `js-yaml`'s
`node_modules/js-yaml` entry **is** present in the lock (at `^4.1.0`, a transitive range), so only
the root block and the version are stale.

### 5.5 `THIRD_PARTY_NOTICES.md`

**[Verified by code reading]** the file exists (58 lines) and carries per-file MIT attribution plus
a Gradle carve-out. **Two gaps:** `:26` names a *"debate/moderator harness"* — deleted; `:39` links
to `docs/desk/README.md` — **a ghost doc** (§8). The Gradle claim is **accurate** (the jar is
present; `android/` is 57 tracked files). **UPDATE.**

### 5.6 Oversized packages

`pdfjs-dist` (a 1,343.6 kB worker chunk in the build, plus the library) ·
`katex` (the library **plus ~500 kB of TTF/WOFF fonts shipped for a feature most users never
touch**) · `recharts` (a 297 kB `AreaChart` chunk) · `lightweight-charts` ·
`technicalindicators`. **None is unused. All are reachable. The note is about *weight*, not
necessity** — and the app already lazy-loads the surfaces that use them.

---

## 6. Scripts, config and build

### 6.1 npm scripts — three are referenced by nothing

**[Verified live]** every npm script was searched for across every tracked markdown, workflow, json
and script file at the pin, with prefix disambiguation.

| script | references |
|---|---|
| `probe:chip` → `scripts/chip-shot.cjs` | **NONE** |
| `probe:census` → `scripts/surface-census.cjs` | **NONE** |
| `probe:surfaces` → `scripts/surface-shots.cjs` | **NONE** |
| `verify:signature` → `scripts/verify-release-signature.cjs` | **NONE** — but `release.yml` calls `node scripts/verify-release-signature.cjs` **directly**. The npm script is a redundant alias. |
| `preview`, `test:watch`, `lint:loose`, `typecheck:scripts`, `typecheck:electron`, `electron:release` | referenced by `AGENTS.md` only (or by another script) — legitimate developer conveniences |
| every other script | referenced by CI, the release workflow, or the docs |

**⇒ the three `probe:*` scripts are the only genuinely dead npm entries**, and their three `.cjs`
files are referenced by nothing at all.

### 6.2 The `scripts/` directory — 18 files, and two of them are the biggest artefacts in the repo

| file | size | purpose | caller | verdict |
|---|---|---|---|---|
| `scripts/render-probe.cjs` | **138 KB** | the strongest gate: rendered row counts, inert controls, zero pageerrors | `ci.yml`, `release.yml`, `AGENTS.md` | **LIVE and load-bearing** — but it is a 3,000-line CJS file with **no type checking** |
| `scripts/check-flow-doc-anchors.cjs` | **58 KB** | the doc-anchor gate | `ci.yml`, `AGENTS.md` | **LIVE** — and it knows about a deleted file (§3.3) |
| `scripts/installer-smoke.cjs` | 24 KB | the packaged-exe smoke | `release.yml` only | **LIVE** |
| `scripts/probe-skill-approval.cjs` | 28 KB | the human-actuation probe | `ci.yml` | **LIVE** |
| `scripts/boot-probe.cjs` | 7 KB | the production-bundle boot check | `ci.yml`, `release.yml` | **LIVE** |
| `scripts/check-workflow-shells.cjs` | 4 KB | the workflow-shell check | `guards.yml` | **LIVE** — and it is the **only** consumer of `js-yaml` |
| `scripts/verify-release-signature.cjs` | 9 KB | the signature check | `release.yml` (directly) | **LIVE** — the npm alias is not |
| `scripts/check-update-manifest.cjs` | 3 KB | the updater-manifest check | `release.yml` | **LIVE** |
| `scripts/release-is-ci-only.cjs` | 2 KB | refuses a local publish | `package.json` (`electron:release`) | **LIVE** |
| `scripts/mock-provider.cjs` | 11 KB | the local loopback model server | the probes | **LIVE** |
| `scripts/flake-hunt.cjs` | 3 KB | per-run vitest JSON, so a flake survives long enough to be read | **no npm script; no CI reference** | **DEAD-ish** — the `.flake-hunt/` output dir is gitignored, so it is a deliberate local tool. **NEEDS CHECK.** |
| `scripts/ui-inspect.cjs` | 19 KB | drives the running app | — | **NEEDS CHECK** — the roadmap records a **stale probe assertion** here (`ui-inspect.cjs:215` expects 7 nav rows; the app has 5 + approvals) — `R-058` |
| `scripts/chip-shot.cjs` | 4 KB | a screenshot probe | `package.json` `probe:chip` only | **DEAD** (both the script and its npm entry) |
| `scripts/surface-census.cjs` | 14 KB | the surface census | `package.json` `probe:census` only | **DEAD** as a script — but `R-052` records a **gate defect** in it: the leaf selector only matches `[learn-view]`, so `leafCount: 0` for 4 surfaces. **If it is dead, that defect is moot — but `R-051` (the type dial) depends on fixing it. Decide: fix it, or delete it and fix `R-051`'s gate.** |
| `scripts/surface-shots.cjs` | 17 KB | surface screenshots | `package.json` `probe:surfaces` only | **DEAD** |
| `scripts/trade-shot.cjs` | 3 KB | a trade-surface screenshot | — | **NEEDS CHECK** |
| `scripts/eslint.config.mjs` | 3 KB | the narrow lint config for the CJS probes | `guards.yml` | **LIVE** |
| `scripts/test-candle-history.ts` | 2 KB | the **only** file `tsconfig.scripts.json` covers | `typecheck:scripts` | **LIVE but nearly pointless** — the typecheck of `scripts/` covers one file out of ~6,200 lines of gate logic |

### 6.3 The `guards.yml` ratchet that no longer binds

`.github/workflows/guards.yml` fails the build if the entry chunk exceeds **2,600 kB**, with the
comment that *"the last measured entry chunk was ~1956 kB"*. **The measured entry chunk is
1,352.6 kB** — 31 % below the calibration point and 48 % below the ceiling. **The ratchet can no
longer catch the 363 KB-eager-import regression it was written for.** See Report 2 §E-06.

### 6.4 CI steps that no longer test anything

**[Verified live]** the ci-vs-release script set difference is exactly `{installer-smoke}` in
release only and `{check-flow-doc-anchors, skill-approval-probe, test, typecheck}` in ci only —
**`AGENTS.md`'s claim is accurate.** Every step in `ci.yml`, `guards.yml` and `release.yml` maps to
a real gate. **No dead step was found.**

**Two asymmetries, both recorded and deliberate:** `release.yml` does **not** run
`check-flow-doc-anchors` or `skill-approval-probe` (`R-239`, `G-53` — *"a tag can still publish
with a dead line number in these docs"*), and `ci.yml`'s coverage floors are in `vitest.config.ts`
rather than in the workflow.

### 6.5 The coverage floors

`vitest.config.ts:81-86` — lines 36 / statements 28 / functions 36 / branches 30. The comment
records the baseline as *"38.2 % lines / 30.0 % statements"*. **[Unverified — `npm run
test:coverage` was not run]** whether the tree is above the floor. **The floor is a ratchet that
can only be lowered, and it is 2 points below the recorded baseline — so it is close to binding.**

### 6.6 Line endings and `.gitattributes`

**[Verified live]** `git ls-files --eol` across the whole tree:

```
1092  i/lf      (index: LF, correct)
1079  w/lf      (worktree: LF, correct)
  39  i/-text   (binary — correctly not text)
  39  w/-text
  13  w/        (no eol attribute recorded)
```

**⇒ no CRLF/LF inconsistency. `.gitattributes` (one line: `* text=auto eol=lf`) is working.** The 39
binary files (png, ico, webp, ttf, woff, woff2, jar) are correctly detected. **No finding.**

### 6.7 Generated files committed by mistake

`dist/` is **gitignored and not tracked** ✅. `coverage/`, `playwright-report/`, `test-results/` are
gitignored ✅. **`android/` is 57 tracked files** — the Capacitor Gradle host, the Java plugin and
the launcher resources. **`android/app/build` and `android/app/src/main/assets` are gitignored**
(`android/app/build` is in `.gitignore`), so no build output is committed. **No finding.**

---

## 7. Assets and repo hygiene

### 7.1 Large files in git

**[Verified live]** the largest tracked files in the working tree:

| size | path | note |
|---|---|---|
| **769.8 KB** | `docs/plans/reference/hermes-desktop-live.png` | a **reference screenshot of a different application** (Hermes), kept as design reference. **The largest asset in the repo, and it is not a picture of August.** |
| 494 KB | `package-lock.json` | necessary |
| 440.3 KB | `android/app/src/main/ic_launcher-playstore.png` | the Play Store icon — necessary for a shipped app |
| 216.9 KB | `services/analysis/DeskToolsService.ts` | source |
| 200 KB | `services/learning/SkillMemoryService.ts` | source |
| 174.1 KB | `docs/plans/debate-deletion-status.md` | a **dated working ledger** |
| 159.3 KB | `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp` | necessary |
| 140.7 KB | `App.tsx` | source |
| **135.1 KB** | `scripts/render-probe.cjs` | a gate script, **larger than `App.tsx`** |
| 129.7 KB | `changelog.md` | the changelog |
| 122.7 KB | `docs/plans/reference/dsh-settings-form-live.png` | a reference screenshot of **another app** (DSH) |
| 103.8 KB | `services/providers/GenericProviderService.ts` | source |
| 100 KB | `components/agents/AgentsView.tsx` | source |
| 94.1 KB | `docs/plans/reference/august-chat-before.png` | a **before** screenshot of August — of historical value only |
| 92.3 KB | `docs/plans/reference/august-chat-after.png` | an **after** screenshot — **the only current picture of the app** |
| 89 KB | `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.webp` | necessary |
| 80.1 KB | `docs/plans/reference/dsh-settings-live.png` | a reference screenshot of another app |

**The reference folder holds seven PNGs totalling ~1.2 MB, of which three are screenshots of
*other* applications and two are "before" pictures of August.** Everything else the repo has ever
produced lives in the **gitignored** `.probe-artifacts/`. **KEEP the folder, but move it to
`docs/archive/assets/` and label it as reference, not documentation** — and note that the repo has
**no current screenshot of itself** beyond one 92 KB PNG.

### 7.2 Binaries in git

`png` × 12, `webp` × 2, `ico` × 1, `ttf`/`woff`/`woff2` × (the KaTeX fonts, shipped — and they are
**build output**, committed as source because `katex` ships them), `jar` × 1
(`android/gradle/wrapper/gradle-wrapper.jar` — **necessary** for a reproducible Gradle build), and
`apk` × 2 **in history only** (§7.5).

### 7.3 Files that should be ignored but are tracked

`docs/plans/reference/*.png` — arguably reference material, arguably should be ignored. **LOW.**

### 7.4 Secrets and personal data

**[Verified live]**
- **Working tree:** a scan for `sk-…`, `AIza…`, `ghp_…`, `AKIA…`,
  `-----BEGIN … PRIVATE KEY-----` and `xox…` across every tracked text file returns **zero** hits.
- **History:** a scan across the **520 most recent revisions** returns hits in exactly one file —
  `tests/runStatus.test.tsx:90,94,98,100` — and those are **deliberate fake keys in a sanitizer test
  fixture**. A scan across the **120 earliest revisions** (including `9afc42d1`, whose subject is
  *"Initial commit (secrets removed)"*) returns **zero** hits.
- **⇒ no secret was found in the tree or in the scanned history.** The first commit's own subject
  says the secrets were removed, and the scan corroborates it.

**Personal data:** the only personal datum in the repository is a **username in a persisted local
storage key shape** (`<user>` in key names) and the prior audit's report of a live profile. **No
personal data is committed.** The previous audit's `05-lead-findings.md` §B.2 quotes a real
username from the owner's live `leveldb` — **that file is one `git gc` from being lost, and it
contains a personal identifier.** See §7.6.

### 7.5 Git history: **52 MB of APKs**

**[Verified live]** the largest blobs in history:

| size | path | when |
|---|---|---|
| **26,299.5 KB** | `august.debug.apk` | `9afc42d1` (2026-01-30, *"Initial commit (secrets removed)"*) and `e92be1b3` (2026-07-23) |
| **26,263.7 KB** | `august-3.5-debug.apk` | the same two commits |
| 769.8 KB | `docs/plans/reference/hermes-desktop-live.png` | |
| 570 KB | `docs/analysis/data/ls_aggregates.json` | the orphan checkpoint commits (§7.6) |
| 494 KB | `package-lock.json` | many revisions |

**⇒ 52.5 MB of Android application binaries are permanently in `main`'s history.** They were in
the first commit and were never removed. They are ancestors of every branch, so **every clone
downloads them.** Purging them requires a history rewrite (`git filter-repo`) and a force-push —
**which the brief forbids and which is a coordinated operation for a repository with remote
branches.** **Recommendation: do not rewrite history now.** Record it as a known cost, and take the
decision at the next major version boundary, with the other branches deleted first.

### 7.6 The four orphan commits — **the previous audit is one `git gc` from being lost**

**[Verified live]** `git log --all --oneline -- 'docs/analysis/*'` returns **nothing** — but that
is git's default **history simplification**, not absence. With `--full-history` the directory is
found in **8 commits** under `refs/cline/checkpoints/session_1792326571064_z70jp/{1,2,3,4}`:

| commit | content |
|---|---|
| `508b691a` | `00-REPORT.md` (52,577 B), `01-architecture.md` (41,945), `02-trading-logic.md` (42,988), `03-prompts-harness.md` (59,676), `05-lead-findings.md` (13,408), **`06-independent-review-2026-10-18.md` (58,715)**, plus `data/` (1,135 `_blobs/*.bin`, `census.json`, `trades.json`, ~30 probe scripts) |
| `7478c4c0`, `aff83bcd` | the same six files |
| `257e1237` | the same, **without** `06-independent-review-2026-10-18.md` — **the fullest recovery is `508b691a`** |

**They are not reachable from any branch** (`git merge-base --is-ancestor 508b691a main` exits 1;
`git branch -a --contains 508b691a` is empty). **They survive only because the tool that made them
has not garbage-collected yet.**

**⇒ `git gc --prune=now` on the owner's machine would delete the previous audit entirely —
including the only place the cost-model finding (G-01/G-02) and the
`computeContractSize` finding (G-06) are written down.**

**Recommendation, and it is the highest-priority operational item in this report: recover the six
markdown files to a durable location, and do not delete `refs/cline/checkpoints/*` until they are
safe.** The six markdown files are ~269 KB; the 1,176-file `data/` folder is scratch and is not
worth keeping.

### 7.7 Branches, worktrees and stashes

**[Verified live]**

| branch | last commit | unmerged into `main` | behind `main` | verdict |
|---|---|---|---|---|
| `main` | 2026-10-19 | 0 | 0 | the branch |
| `feat/stage19-tail` | 2026-10-19 (`cf0a2a12`) | **0** | 111 | **fully merged — safe to delete** |
| `origin/refactor/calibration-split` | 2026-09-28 | **0** | 487 | **fully merged — safe to delete** |
| `origin/stage3-ui-arrangement` | 2026-10-07 | **0** | 292 | **fully merged — safe to delete** |
| `origin/test/provider-degrade-ladder` | 2026-09-28 | **1** | 470 | **one unmerged commit** — inspect it before deleting |

**`git stash list` is empty. `git worktree list` shows one worktree (this one).** No stale
worktrees, no stashes.

### 7.8 Tags

**[Verified live]** 36 tags: `v1.0.0` (2026-07-25) … `v1.0.33`, then `v1.1.0` (2026-09-29) and
**`v1.2.0` (2026-10-01)**. **No two tags point at the same commit.**

**⇒ `v1.3.0` is not tagged, but `package.json` says `1.3.0` and `changelog.md`'s newest entry is
`v1.3.0`.** So the repository is **one release ahead of its last tag** — the v1.3.0 work is what HEAD
contains. `R-276` shipped a test that fails if the changelog's version and `package.json`'s disagree
(they agree ✅).

### 7.9 The four version numbers

| source | value |
|---|---|
| `constants/version.ts:6` (the dev/test fallback) | **`1.0.28`** |
| `package-lock.json` (committed) | **`1.0.30`** |
| the newest **tag** | **`v1.2.0`** |
| `package.json` **and** `changelog.md`'s newest entry | **`1.3.0`** |

**Four numbers in one repository.** The `constants/version.ts` comment says the literal is *"kept
synced with package.json"* — **it is five minor versions behind.** See Report 2 §E-15.

### 7.10 Untracked clutter on disk

**[Verified live]** `git status --porcelain --untracked-files=all` at the pin: only `M
package-lock.json` (plus the concurrent session's 70 paths). The repo root also holds
**~17 log files** — `.boot-probe.log`, `.e2e.log`, and 15 `.probe-*.log` — plus `.probe-artifacts/`,
`test-results/`, `.freebuff/`, `.workbuddy-ai/`, `.openclaw-attachments/`, `dist/` and
`node_modules/`. **All are covered by `.gitignore`** (`*.log`, `.probe-artifacts/`,
`test-results/`, `.freebuff/`, `.workbuddy-ai/`, `dist/`, `node_modules/`). **No finding.**

### 7.11 Orphan folders and naming

| folder | tracked files | verdict |
|---|---|---|
| `lib/` | 1 (`utils.ts`) | **live** (via the `@/` alias) but **a single file in a `lib/` folder** is an odd shape for a repo whose convention is `utils/`. **LOW.** |
| `plugins/` | 1 (`GallerySaver.ts`) | the §1.1 item 4 decision |
| `.openclaw-attachments/` | 1 (a `.txt` file) | **a tool's scratch in the repo root**, tracked. It contains a note that corroborates §2.11. **LOW — but it is a `.txt` from a tool, and it is the only place the "write-only GlobalMemory ledger" claim is written down.** |

---

## 8. The docs audit

**[Verified by code reading]** — 33 doc files (21 under `docs/` including 1 HTML and 7 PNGs, 8 root
including `LICENSE`, 3 `.github/` workflows) plus `index.html`.

### 8.1 The table

| # | file | size | accurate? | contradicted by | classify | reason + evidence |
|---|---|---|---|---|---|---|
| 1 | `AGENTS.md` | 350 / 24.5K | **partially** | — | **UPDATE** | 4 factual errors: the vitest census is **stale by 2** (`:157` — the measured figure is **4,739** in 479 files, 4,728 pass + 11 skip); **`services/research/` does not exist** (`:140`); **`components/` is not flat** (`:128` — 15 subdirectories, three two levels deep); **`.github/workflows/guards.yml` is not mentioned** — and `vitest.config.ts:58-65` *does* refer to "the `guards` workflow". 4 more claims die when the in-flight tree lands (`:148`, `:215`, `:220`) |
| 2 | `README.md` | 80 / 4.7K | **NO** | `AGENTS.md`, `app-flow.md` | **UPDATE** (rewrite) | `:3-7,13,26-34,44-47,79,83` all describe the deleted debate engine: *"an ensemble of AI analysts **debates**… a **moderator** issues the binding verdict"*, *"real debate (speculative rebuttal pump, devil's advocate rotation, sealed conviction auction, clarification cycles)"*, *"useAnalysisPipeline (the send/**debate** engine)"*. **The public front door advertises a feature that was deleted six days ago.** It cannot be fixed by deletion — the pipeline section must be rewritten for the tool-turn architecture |
| 3 | `changelog.md` | 1,930 / 133K | **partially** | `AGENTS.md` | **UPDATE** (split) | A 133 K **log**, not a doc; it duplicates `app-flow.md`'s narrative per round. `:1009,1314,1334,1340,1341` cite files deleted in flight. The `v1.3.0` entry carries no date of its own |
| 4 | `HANDOFF_LEARNING_LOOP.md` | 233 / 21.1K | **NO** | `AGENTS.md`, `learning-loop-map.md` | **ARCHIVE** | `:19-21` *"Node v26.7.0"* (the repo pins 22.23.3 via volta); `:11-13` *"488 files / 4686 tests"* (the real figures are 479 / 4,739); *"838/889 warnings"* (the measured count is 682); `:4` contradicts `:6-7` internally. `:85,87,89,227,296` cite `BotRegistry`/`lensMemory` — deleted in flight. **But `:185`'s claim that the insight pruners are live is FALSE at the pin** (§2.11) — so this file is not merely stale, it is **wrong**, and its claim is load-bearing for the §1.1 item-2 decision |
| 5 | `PLAN_LEARNING_LOOP_AND_UI.md` | 648 / 44K | **NO** | `AGENTS.md` | **ARCHIVE** | Already dispositioned ARCHIVE by the repo's own 2026-10-06 audit — **never executed**. Its ground rules duplicate `AGENTS.md` |
| 6 | `PRIVACY.md` | 84 / 5.3K | **partially** | the CSP, `KlineService.ts`, `CorrelationRiskService.ts` | **UPDATE** | *"Five outbound paths"* (`:7-10`, `:92-94`) **omits `api.coingecko.com`** (`services/analysis/CorrelationRiskService.ts:38,147`) **and the three CORS proxies** (`services/analysis/KlineService.ts:176-178` — `api.allorigins.win`, `corsproxy.io`, `api.codetabs.com`). A "public market-data request" can transit a third party. **Its own test** (`tests/disclaimer.test.ts:91-93`) asserts the doc names the real market-data endpoints — so the test is passing against an incomplete list |
| 7 | `THIRD_PARTY_NOTICES.md` | 58 / 4.2K | **partially** | `docs/desk/README.md` | **UPDATE** | The Gradle claim is accurate (the jar exists; 57 `android/` files). `:26` *"debate/moderator harness"* — deleted. `:39` links to `docs/desk/README.md` — a ghost doc |
| 8 | `LICENSE` | MIT | ✅ yes | — | **KEEP** | MIT, correctly pointed at from `README.md:98`; the Gradle JAR is correctly carved out |
| 9 | `docs/app-flow.md` | 590 / 55.9K | ✅ **yes** | — | **KEEP** | **303 unique anchors verified, 0 unattributed** by the gate at the pin. It publishes its own error bars (`:7-11`, `:500-505`, `:520-523`, `:574`). Updated in **both** new commits. Correction 12 (`:589`) already records the "never seeded" ruling. **LIVING, not a log.** ⚠ but see §8.2 — a hand spot-check found **8 of 22 anchors stale**, all in the class the gate is blind to |
| 10 | `docs/app-flow.html` | 331 / 54.9K | ✅ **yes** | — | **KEEP** | The same gate population. `6a41a9f7` exists to repair its anchors. **The duplication is intentional and gate-enforced — do not de-duplicate** |
| 11 | `docs/ui-doctrine.md` | 116 / 7.9K | **partially** | `index.css` | **UPDATE** | `:63`'s type ramp is **2 px wrong on every step** and **5 roles short**: it says *"= 18/16/14/13/12/11/10/9px … `--ui-font-size` (14px)"*; `index.css:304` is **`16px`** (the 2026-10-10 redesign, `index.css:296-302`), so the real mapping is 20/18/16/15/14/13/12/11, and the doctrine omits `lede`, `price`, `display`, `hero`, `micro` (`index.css:200-249`). Correct on `.status-surface`/`.analysis-card`, `dense`, `micro`, the Learn IA and the focus-indicator rule |
| 12 | `docs/learning-loop-map.md` | 207 / 16.2K | **NO** | `app-flow.md` | **UPDATE** | **3 rows wrong at the pin:** `:20` cites `hooks/usePostMortem.ts` — **the file does not exist**; `:114` says the harness-lessons reader is `formatHarnessNotesBlock` → `ensembleService.ts` — **the reader has zero callers, the file does not exist, and "Closed? yes" is false**; `:143` cites `NotebookSection.tsx` — **the file does not exist**. Also `:128` (accuracy mode), `:131-132` (post-mortem line), `:107` (`lensMemory`/`AnalystLensService` — both deleted in flight) |
| 13 | `docs/desk/README.md` | 53 / 3.5K | ❌ **NO — the feature is gone** | `AGENTS.md`, `app-flow.md` | **DELETE** (or ARCHIVE) | `components/desk/` has **0 tracked files**; no `PixelSeat`/`SpeechBubble`/`DeskScene` anywhere; `--avatar-px` appears **0 times**; `:41` cites `components/desk/pixelAvatars.ts` (actually `components/chat/pixelAvatars.ts`). **The whole 53-line file describes a deleted view.** The prior audit already said REWRITE or DELETE — **13 days on, still not done.** **This is the most misleading doc in the tree, and it is named as a gap nowhere in the roadmap** |
| 14 | `docs/plans/debate-deletion-status.md` | 2,070 / 178K | **partially** | — | **KEEP** (as the archive of record) | Explicitly dated history; the gate exempts its 3 deleted-file citations (*"history; ratchets down only"*). **The only place the deletion's reasoning lives.** ⚠ **178 K of working log sitting next to 56 K of current** — move it to `docs/archive/` when the archive is created |
| 15 | `docs/plans/flow-ui-audit-2026-10-15.md` | 382 / 31.2K | **partially** | — | **UPDATE → merge the open findings into `docs/a11y.md`, archive the rest** | The best prior art and the direct precedent for this audit. §10 records T8 (Toast `aria-live`) as FIXED — verified fixed, so that row is stale. **Its Tier-4 findings are still open:** untrapped `aria-modal` overlays (`:213-217`) and the missing transcript live region (`:220`) — both re-verified. Mixes closed and open findings with **no status column** |
| 16 | `docs/plans/docs-audit-2026-10-06.md` | 197 / 16K | **partially** | — | **ARCHIVE + ACT ITS TABLE** | Its disposition table is the best thing in the repo about its own docs, and **6 of its dispositions are still un-executed 13 days later**: `desk/README`, `ui-doctrine`, `PRIVACY`, `learning-loop-map`, `PLAN_LEARNING_LOOP`, `stage2`/`stage3`. **A to-do list masquerading as an archive** — which is why this manifest cannot simply trust it |
| 17 | `docs/plans/stage1-ui-ux-spec.md` | 362 / 60.2K | **NO** | `stage2-implementation-plan.md` | **ARCHIVE** | Already ARCHIVE per the prior audit (*"C1/C9 claims false"*). Its own header admits no screenshots were attached (`:8-9`) |
| 18 | `docs/plans/stage2-implementation-plan.md` | 417 / 29.6K | **NO** | `stage1-ui-ux-spec.md` | **ARCHIVE** (after confirming no Phase 3/4 item is still owed) | The prior audit said LIVE — Phase 3/4 owed. **Re-verified: the "no focus-restore anywhere" item is now FALSE** (`hooks/useFocusTrap.ts:87` restores focus; 11 overlays use it) and the typing-indicator/aria-live items are superseded by the 2026-10-10 redesign and the 2026-10-18 deletion. **[Unverified — not line-read in full]** |
| 19 | `docs/plans/stage3-arrangement.md` | 111 / 8.3K | **NO** | `stage3-status.md`, `app-flow.md` | **ARCHIVE** | The prior audit called it CURRENT — true on 2026-10-06, false now. `:47-49` describes a NavRail with 5 surfaces; `app-flow.md:467-478` records that NavRail is **imported and NEVER rendered**. `:19,21,30` cite `CommandPalette.tsx` and `usePostMortem.ts` — gone |
| 20 | `docs/plans/stage3-status.md` | 73 / 5.3K | **partially** | `stage3-arrangement.md` | **ARCHIVE** (promote the facts) | The status is historical; the gates are stale (`:9` *"484 files / 4641 tests"*). **But `:42-81` "Facts paid for — do not rediscover" is genuinely live** (realizedR canonical, rSource first-writer-wins, recentTradesBrief owns ordering, planId dedupe, SQLite needs no migration). **Split it — promote the facts into the living architecture doc** |
| 21 | `docs/plans/workstream1-status.md` | 355 / 31.2K | **NO** | `AGENTS.md` | **ARCHIVE** | For an unpushed branch whose content reached main by merge. `:100-101` *"post-mortem still 5 writers"* — the post-mortem is deleted |
| 22 | `docs/plans/workstream1-stepB-evidence.md` | 149 / 14.9K | **NO** | `learning-loop-map.md` | **ARCHIVE** | The prior audit said *"DELETE (not yet) — waits for a word"*. The word has come: the post-mortem is gone, `savedAnalyses` is gone, the `saved_analyses` table is orphaned |
| 23 | `docs/plans/workstream1-stepB-gap-audit.md` | 71 / 5.9K | **NO** | `workstream1-status.md` | **ARCHIVE** (as an issue source) | Its 4 gaps are now moot. **Its method is worth keeping:** *"can a person reach it from the app, and does the thing it claims to do actually happen?"* |
| 24 | `docs/plans/chat-dock-reference.md` | 77 / 6.9K | **NO** | `stage3-arrangement.md` | **ARCHIVE** (keep the PNGs) | *"conversations need a home"* shipped in stage 3 A; the surfaces were rebuilt again on 2026-10-10. **Its 7 PNGs are the only committed screenshots of this app** — everything else lives in the gitignored `.probe-artifacts/` |
| 25 | `docs/plans/memory-skills-research-2026-10-10.md` | 157 / 18.7K | **partially** | `learning-loop-map.md` | **MERGE into `docs/learning-loop-map.md`**, then archive | Its durable finding is still true: *"`learning_rules_v2_<user>` has **no reader**"* (`:11-12`) — the single most important statement in the memory docs, and it belongs in the living map. Its anchors are stale |
| 26 | `docs/plans/reference-transcript-catalog-copy.md` | 581 / 43.6K | **NO** | `redesign-plan…` | **ARCHIVE** | A copy spec for a UI rebuilt three times since. Its own rule (`:12-14`) — *"A UI must not advertise a gesture that isn't wired"* — is **exactly the rule this manifest applies to the repo's own stale copy** |
| 27 | `docs/plans/redesign-plan-claude-chatgpt-haze-2026-10-10.md` | 488 / 38.7K | **partially** | `ui-ux-target-plan` | **UPDATE → split: ARCHIVE the spec, KEEP the doctrine** | **It *is* the design that shipped.** Its method (`:8-9`, *"every claim is a file:line a mapper opened"*) is why the app looks like this. Promote its binding rules into `ui-doctrine.md` |
| 28 | `docs/plans/ui-redesign-deep-dive-2026-10-10.md` | 116 / 14.6K | **NO** | `redesign-plan…` | **ARCHIVE** | *"analysis only. No code changed"* against `78f99bd`. **Its artefacts (`census-1280.json`, `census-430.json`) are in the gitignored `.probe-artifacts/` — so its numbers are unfalsifiable.** That is the failure mode `app-flow.md:479-505` was written to prevent |
| 29 | `docs/plans/ui-ux-target-plan-2026-10-11.md` | 212 / 18.6K | **partially** | `redesign-plan…` | **ARCHIVE** | Its header (`:1-6`) honestly discloses the rebuild-from-memory. Overthrown by the 2026-10-15 audit and the 2026-10-18/19 deletions. Its §5 "four build decisions recorded as answered" is the durable part |
| 30 | `.github/workflows/ci.yml` | 135 / 6.7K | ✅ **yes** | — | **KEEP** | Every step matches `AGENTS.md` and the `comm` asymmetry. The actions are now **SHA-pinned** (`:21`, `:119`) — the prior audit's *"not SHA-pinned"* finding is **fixed** |
| 31 | `.github/workflows/release.yml` | 269 / 15.2K | ✅ **yes** | — | **KEEP** | Matches `AGENTS.md` exactly. `app-flow.md:524-533` records the coverage asymmetry as a deliberate unclosed decision. **[Unverified — not line-read in full]** |
| 32 | `.github/workflows/guards.yml` | 98 / 5.0K | ⚠️ **unknown — NO doc mentions it** | `AGENTS.md` | **KEEP + MENTION IT** | `guards.yml:5-16` states its purpose and the gaps it closes (the ~1,900 lines of probe logic get no lint; there is no size gate); `:19-35` says what it deliberately does **not** do and why. `vitest.config.ts:58-65` refers to *"the `guards` workflow"*. **Add it to `AGENTS.md`** |
| 33 | `docs/plans/reference/*.png` (7) | binary | n/a | — | **KEEP** (→ `docs/archive/assets/`) | The only committed screenshots of anything. Everything else the repo produced lives in the gitignored `.probe-artifacts/` |
| 34 | `index.html` (app source) | 43 / 2.6K | ✅ yes | — | **KEEP** | The viewport meta is correct and modern; the CSP is thorough |

**Totals:** **machine-checked and current: 3** · **machine-checked but factually wrong: 1**
(`AGENTS.md`) · **stale and unchecked: 28** · **contradictions: 13** · **deleted files cited as
live: 4** · **to write: 8** · **to archive: 18** · **to update: 7** · **keep as-is: 3**.

### 8.2 `docs/app-flow.md` — the one doc worth *repairing* rather than archiving

**[Verified by code reading]** a hand spot-check of 22 citations: **14 CORRECT, 8 STALE (36 %)**.

**The stale ones share one diagnosable cause.** `395f73db` deleted **51 lines** from `App.tsx` and
the flow docs' `App.tsx` citations were re-derived **by arithmetic, not by content**. The diff
shows it: `App.tsx:2493 → :2440` (2493−53, but 2440 is a prop), `:2538 → :2485` (but 2485 is
`<SkillsLibrary`), `:2675 → :2622` (but 2622 is `/>`). **The two that were fixed *by content* are
the two the gate could see** — `App.tsx:2376` (`<Header`) and `App.tsx:2584` (`<AccountRow`) — and
the ledger says so itself (`docs/plans/debate-deletion-status.md:2397`): *"the header band fixed by
content rather than arithmetic because a citation with no bound symbol is invisible to the gate
while still being wrong."*

**⇒ the gate is green (303 anchors, 52/53 coverage) and the stale citations live exactly in the
class the gate is blind to: citations that name no symbol.** `scripts/check-flow-doc-anchors.cjs`
tier 3 *"abstains when the doc line names no symbol"* — and the enormous class of in-range,
non-blank, non-comment citations that hold no symbol is precisely where these live.

**Two prose figures are also self-contradictory:** the comment-as-claim exemptions are **3**
(`:6-7`) versus the gate's **5**; and the unique-anchor count is **303** (`:5`, `:481`, `:484`) ✅
versus **255** (`:576`).

**⇒ This is a bounded, mechanical, owner-approvable repair: re-derive every `App.tsx` citation in
the four flow documents *by content*, reconcile the mermaid diagrams against the arrow tables, and
fix 255 → 303 and 3 → 5.** The roadmap itself asks for it (`docs/app-flow.md:6-11`). It is **not** a
rewrite.

### 8.3 The proposed docs structure — and the eight documents to **write**

**Structure:**

| path | what |
|---|---|
| `docs/README.md` | **the index — none exists.** Nothing today says which doc is LIVE and which is HISTORY. |
| `docs/architecture.md` | **the living architecture.** `app-flow.md` is a *call graph*, not an architecture. Promote `stage3-status.md:42-81` "Facts paid for" into it. |
| `docs/decisions.md` | **the decision log**, append-only. The repo's excellent decisions are currently scattered across `AGENTS.md`, `app-flow.md`'s corrections 1–12, an `index.css` comment, an archived plan and a deleted-file ledger. |
| `docs/a11y.md` | **the accessibility contract**, promoted from `flow-ui-audit` §5a/§8, **with a status column so closed ≠ open**. |
| `docs/ui-doctrine.md` | KEEP + UPDATE (§8.1 row 11) |
| `docs/app-flow.md` / `.html` | KEEP — and **repair** (§8.2) |
| `docs/learning-loop-map.md` | UPDATE (§8.1 row 12) |
| `docs/archive/` | **18 files + `assets/reference-*.png`**, with a 20-line `archive/README.md` saying *"dated snapshots, not truth; a file:line here points at a tree that no longer exists"* |
| `docs/plans/` | **empty** — a plan that shipped is an archive entry |

**Eight documents to WRITE (not just remove):**

1. `docs/README.md` — the index. *(P1)*
2. `docs/architecture.md` — the living architecture. *(P1)*
3. `docs/decisions.md` — the decision log. *(P1)*
4. `docs/a11y.md` — the a11y contract with a status column. *(P2)*
5. `docs/archive/README.md` — the archive's contract. *(P2)*
6. **A rewritten `README.md`** — the public front door cannot be fixed by deletion; the pipeline
   section must be rewritten for the tool-turn architecture. *(P1)*
7. **A decision on `docs/analysis/`'s fate** — and note the **eslint ignore already exists**
   (`eslint.config.js:26`, added by `92e77843`), so the directory is expected. *(P2)*
8. **Commit the archive, do not just move it** — a `git mv` keeps it tracked, which matters: the
   previous audit's 1,176-file `docs/analysis/` tree survived **only** in four dangling commits
   (§7.6). *(P2)*

### 8.4 The contradiction register (13)

| id | contradiction | which side is right |
|---|---|---|
| C1 | `README.md` says the debate is alive; `AGENTS.md` and `app-flow.md` say it is deleted | **README is wrong** |
| C2 | `stage3-arrangement.md` and `desk/README.md` describe a populated roster; `app-flow.md:589` says "never seeded" | **app-flow is right** |
| C3 | `ui-doctrine.md:63`'s 14 px ramp vs `index.css:304`'s 16 px | **the doctrine is 2 px wrong** |
| C4 | `PRIVACY.md`'s "five paths" vs `CorrelationRiskService.ts` / `KlineService.ts` | **PRIVACY is short by 2+** |
| C5 | `AGENTS.md` says `services/desk/` is a preference only; `app-flow.md:381` records that the key *is not*, so renaming it silently resets every profile | **not a contradiction — `AGENTS.md` omits a live migration hazard** |
| C6 | `AGENTS.md` names 2 workflows; **3 exist** | **`AGENTS.md` is incomplete** |
| C7 | `PromptManager.tsx:25` still shows a `debate` prompt group; `app-flow.md:608-611` says the registry is 11 live ids | **the UI is wrong, not the doc** |
| C8 | the census: 4,739 measured vs 4,741 documented | **the doc is stale by 2** |
| C8b | `services/research/` | **the doc is wrong** |
| C8c | `components/` "flat" | **the doc is wrong** |
| C8d | the harness-lessons "Closed? yes" | **the doc is wrong** |
| C9 | `docs/desk/README.md` describes a deleted view | **the doc is wrong** |
| C10 | `flow-ui-audit` mixes closed and open findings with no status column | **the doc is unusable as a status board** |

---

## 9. The batches

**The gate vocabulary.**

| gate | what it enforces |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over `**/*.ts(x)` — **excludes `scripts/` and `android/`** |
| `npm run typecheck:scripts` | `tsc -p tsconfig.scripts.json` — **`scripts/**/*.ts` only: ONE file** |
| `npm run typecheck:electron` | `node --check electron/{main,preload,sseParser}.cjs` — **syntax only** |
| `npm run test` | vitest, 479 files / 4,739 tests |
| `npm run test:coverage` | the same, with the four ratchet floors |
| `npm run lint` | `eslint . --max-warnings 889` — **a moving target: see the warning below** |
| `npm run lint:loose` | the same without the cap — **use this to get the true count** |
| `npm run build` | `tsc --noEmit && vite build` |
| `npm run e2e` | Playwright, 1 spec |
| `npm run boot-probe` | the production bundle boots, zero pageerror |
| `npm run render-probe` | **the ONLY gate that sees a rendered row or a rendered string** |
| `npm run skill-approval-probe` | **real clicks, notebook bytes after each** |
| `npm run check-flow-doc-anchors` | the doc-anchor gate |
| `npm run check-workflow-shells` | the workflow-shell check |

> ⚠ **`npm run lint` is a moving target.** Every dead import removed **lowers** the warning count,
> and `eslint.config.js:131-132` requires the cap to be **lowered to match — never raised**. **Any
> batch that removes warnings must re-measure with `npm run lint:loose` and lower
> `--max-warnings` in `package.json` in the SAME change, or CI fails.**

### BATCH 0 — PROTECT THE ORPHAN COMMITS *(do this first; it is not a code change)*

| item | evidence | confidence | rollback |
|---|---|---|---|
| Recover the six markdown files from `508b691a` to a durable location, and **do not delete `refs/cline/checkpoints/*`** until they are safe | §7.6 — four unreachable commits; `git gc --prune=now` would destroy them, including the only written record of G-01/G-02/G-06 | **SAFE** | n/a — additive |
| **Also decide `docs/analysis/`'s fate** before this session's reports are followed by more | `eslint.config.js:26` already ignores it; `R-256` and the 13-conclusion `app-flow.md` are all anchor-sensitive | **SAFE** | n/a |

**GATE:** none (no code changes). **This is the one item that gets worse with time.**

### BATCH 1 — STALE COPY AND COMMENTS *(lowest risk; text only)*

| item | evidence | confidence |
|---|---|---|
| The 8 dead-file-path comments (§3.3) — including `hooks/useTradeLogging.ts:991-992`, which cites a **deleted test as a live build guard** | §3.3 | SAFE |
| The user-visible debate/moderator strings (§3.4) — **labels only; no field removal**; `ModelsTab.tsx:127` is a relabel, not a removal | §3.4 | SAFE for the pure labels; NEEDS CHECK for the data-driven ones |
| The in-code comment wording (§3.5) — **including `constants/prompts/harnessContract.ts:16`**, a live prompt that still instructs the model about a Floor and a moderator | §3.5 | NEEDS CHECK (it is a live prompt) |
| `services/learning/memoryHygiene.ts:15-16` — the claim that the pruners run | §3.6 | **FLAG, do not delete** |
| The dead CSS in `index.css:832-881` (`.debate-floor-body`, `.floor-lean*`) and the stale `.status-surface`/`.analysis-card` explanation at `:360-365` | §3.8 | SAFE |
| `@fontsource/inter` — remove the dependency **and** the `'Inter'` fallback at `index.css:169` | §5.1 | SAFE |
| The `app-flow.md` repair (§8.2) — re-derive the `App.tsx` citations **by content**, reconcile the mermaid against the arrow tables, fix 255 → 303 and 3 → 5 | §8.2 | SAFE |
| `AGENTS.md` — the 4 factual errors (§8.1 row 1) **and** the unmentioned `guards.yml` | §8.1 | SAFE |
| `PRIVACY.md` — add `api.coingecko.com` and the three CORS proxies | §8.1 row 6 | SAFE |
| `README.md` — the debate-engine sections | §8.1 row 2 | SAFE |

**GATE:** `npm run typecheck && npm run lint && npm run test` — **plus `npm run render-probe`**
(the copy changes rendered labels on ≥8 surfaces, and render-probe is the only gate that sees
rendered text) — **plus `npm run check-flow-doc-anchors`** if any `docs/plans/` line anchor moves.
**Risk: LOW. Rollback: `git revert`.**

### BATCH 2 — ORPHAN FILES

| item | evidence | confidence |
|---|---|---|
| `components/dashboards/learning/AvoidSetupsSection.tsx` | §1.1 #1 | **SAFE** |
| `services/learning/MemoryConsolidationService.ts` | §1.1 #2 | **HOLD — the doc says the pruning should run. Re-wire, or delete with a doc change.** |
| `plugins/GallerySaver.ts` + `GallerySaverPlugin.java` + `MainActivity.java:10` | §1.1 #4 | **NEEDS CHECK — decide wire-vs-delete. If delete, BOTH sides; `android/` is outside every npm gate.** |
| `utils/messageDisplayText.ts` | §1.1 #3, §1.2 | **HOLD — the render-time strip has to go somewhere first. File the bug.** |
| `utils/debateEnvelopes.ts` | already removed in flight | done |

**GATE:** `npm run typecheck && npm run lint && npm run test` — **plus `npm run build`** (an orphan
can still be reached by a dynamic import the AST scan missed) — **plus `npm run boot-probe`** —
**plus `npm run typecheck:scripts` and `npm run typecheck:electron`** if `electron/` or `scripts/`
reference the deleted file. **Risk: MEDIUM for the three HOLDs, LOW for #1. Rollback: `git revert`.**

### BATCH 3 — DEAD MODULES AND EXPORTS

| item | evidence | confidence |
|---|---|---|
| The 63 fully dead value exports (§1.3) — **except** the five that are test-imported (the test goes in the same commit) and the `HOLD` rows | §1.3 | SAFE |
| **The 202 dead `export` modifiers — as a SEPARATE COMMIT** | §1.3 | SAFE |
| The `utils/analysisUtils.ts` debate-era cluster (§1.4) | §1.4 | SAFE for the exports; the machinery is a separate decision |
| `services/providers/debatePods.ts` — dead in production, its only external importer is a test | §1.3 B-4 | SAFE (the file), with the test in the same commit |
| `services/ui/AnalystLensService.ts` (9 dead exports) | §1.3 B-5 | **HOLD — the in-flight tree is already removing the lens config from `UseAnalysisPipelineParams`.** Wait for it to land, then re-sweep. **Do not delete piecemeal.** |
| `services/validation/TradeValidationGate.ts` — the dead gate exports | §1.5 | **HOLD — see §1.5. Establish which gate path is live before deleting anything.** |
| `services/analysis/HybridIntelligenceService.ts:1433` `runMonteCarloForSetupAsync` | §1.3 | **HOLD** |

**GATE:** `npm run typecheck && npm run lint && npm run test` — **plus `npm run test:coverage`**
(removing exports can drop coverage below the ratchet) — **plus `npm run render-probe`**.
**Risk: MEDIUM. Rollback: `git revert`.**

### BATCH 4 — DEAD DATA PATHS *(the behavioural one)*

| item | evidence | confidence |
|---|---|---|
| The 3 dead `PREF_KEYS` (`memory_provider`, `hybrid_panel_position`, `quiet_hours_v1`) | §2.3 | SAFE — they were never written |
| `debateCostCapUsd` + its label | §2.13 | SAFE |
| **The 5 split read/write stores** — `custom_ensemble_prompt`, `custom_lens_prompts`, `model_performance_data`, `rolling_window_data`, `confluence_historical_stats` | §2.3 | **#1/#2 are BUGS, not cleanup** |
| `approval_rules_v1` | §2.1 | **PRODUCT DECISION — do not silently add it to the RAW list** |
| The 5 restore-listed-but-not-RAW namespaces | §2.2 | **OWNER DECISION — and `trade_sidebar_open_v1` / `agent_threads_opened_v1` are on NEITHER table, so nobody is tracking them** |
| The dead Levenshtein (#2) and the test-only duplicate scorer (#4) | §2.5 | SAFE |
| The duplicated provider-readiness predicate | §2.6 | **RISKY** — the copy exists for a dependency reason |
| The money / date formatter consolidation | §2.7, §2.8 | **RISKY — changes rendered text** |
| The `chartDrawings` R:R copy (#4) and the `PatternMemorySynthesisService` index-0 selection (#5) | §2.4 | NEEDS CHECK — #4's input is a user-drawn triple, not the plan's levels |
| The write-only GlobalMemory ledger | §2.11 | **HOLD per the roadmap** |
| The key-scoped fix to `tests/exportRawLocalStorage.test.ts`'s file-scoped heuristic | §2.2 | SAFE |

**GATE:** `npm run typecheck && npm run lint && npm run test` — **plus `npm run test:coverage`** —
**plus `npm run render-probe`** (the formatter changes touch rendered money and labels) — **plus
`npm run boot-probe`** — and for **any** change touching `ExportService`, `npm run test` must
explicitly include `tests/exportRawLocalStorage.test.ts`,
`tests/exportRestoreRoundTrip.test.ts`, `tests/exportLearningStores.test.ts`,
`tests/exportService.test.ts` and `tests/exportServiceProviderEncryption.test.ts` — **a backup
change is invisible to every other gate.**

**Risk: HIGH for the four behavioural items. Rollback: `git revert`.**

### BATCH 5 — DEAD PROMPTS

| item | evidence | confidence |
|---|---|---|
| `formatHarnessNotesBlock` — **the function only; the store stays** | §3.1 | SAFE |
| The two registry-less `getPrompt` ids | §3.2 (a) | NEEDS CHECK |
| The 3 dead prompt constants in `constants/prompts/learningPrompts.ts` | §1.3 | SAFE |
| The 6 dead markers in `constants/debateMarkers.ts` | §1.3 | SAFE |
| `generateSynthesizedPromptInjection`, `generateConfluencePromptInjection`, `generateMonteCarloPromptInjection`, `exportTextAsFile`, `mailboxRosterHint` | §1.3 | SAFE |
| The `harnessContract.ts` Floor/moderator wording | §3.5 | NEEDS CHECK — it is a live prompt |

**GATE:** `npm run typecheck && npm run lint && npm run test` — **plus `npm run test:coverage`** —
**plus `npm run skill-approval-probe`** (a prompt that reaches the model changes what the model
writes, and that probe asserts the notebook **bytes** after each click) — **plus
`npm run render-probe`**. **Risk: MEDIUM-HIGH — every item here is a string that reaches a model;
`tests/harnessMarks.test.ts` and `tests/promptsAreWired.test.ts` are the guards. Rollback:
`git revert`.**

### BATCH 6 — DEPENDENCIES, CONFIG AND BUILD

| item | evidence | confidence |
|---|---|---|
| `@fontsource/inter` — dependency + the `'Inter'` fallback *(in Batch 1, because it touches `index.css`)* | §5.1 | SAFE |
| The lockfile version + the `js-yaml` root block — **commit the working-tree fix** | §5.4 | SAFE |
| `constants/version.ts`'s fallback literal | §7.9 | SAFE |
| The three dead `probe:*` npm scripts and their three `.cjs` files — **or** fix and wire `surface-census.cjs` (R-052) and re-home `ui-inspect.cjs` (R-058) | §6.1, §6.2 | NEEDS CHECK for `surface-census` (R-051 depends on fixing it) |
| `verify:signature` — the redundant npm alias, or delete it | §6.1 | SAFE |
| `@capacitor/cli` → devDependencies | §5.3 | SAFE |
| `THIRD_PARTY_NOTICES.md` — the deleted-harness line and the `desk/README` link | §8.1 row 7 | SAFE |
| The lint ratchet: re-measure and **lower** `--max-warnings`; the bundle ratchet: re-measure and **lower** the ceiling | Report 2 §E-06 | SAFE |
| `tsconfig.json` — `noUnusedLocals: true` (land in two steps) | Report 2 §E-07 | MEDIUM |
| The branch cleanup: `feat/stage19-tail`, `origin/refactor/calibration-split`, `origin/stage3-ui-arrangement` are **fully merged**; inspect the 1 unmerged commit on `origin/test/provider-degrade-ladder` first | §7.7 | SAFE (for the three) |
| `docs/plans/reference/*.png` → `docs/archive/assets/`, labelled as reference | §7.1 | SAFE |

**GATE:** `npm run typecheck && npm run lint && npm run test && npm run build` — **plus
`npm run test:coverage`** — **plus `npm run boot-probe`** — **plus `npm run check-flow-doc-anchors`**
if any doc anchor moved. **Risk: LOW–MEDIUM. Rollback: `git revert`.**

### BATCH 7 — DOCS RESTRUCTURE

| item | evidence | confidence |
|---|---|---|
| Write the 8 documents (§8.3) | §8.3 | SAFE |
| Move the 18 files to `docs/archive/` and write `docs/archive/README.md` | §8.3 | SAFE |
| `docs/plans/` → empty | §8.3 | SAFE |
| **Act the 2026-10-06 audit's disposition table** — 6 dispositions are still un-executed 13 days on | §8.1 row 16 | SAFE |
| The `docs/analysis/` decision (Batch 0) | Batch 0 | SAFE |

**GATE:** `npm run check-flow-doc-anchors` — **and this is the only batch where that gate is the
primary gate.** The gate exempts the dated stage ledger, so moving `debate-deletion-status.md`
into `docs/archive/` requires updating the gate's four-document list
(`scripts/check-flow-doc-anchors.cjs:44`) **in the same commit**.

**Risk: LOW for the moves; MEDIUM for the writes (a wrong living doc is worse than a stale one).
Rollback: `git revert`.**

---

## 10. Items that OVERLAP the roadmap — do not clean these blindly

| item | roadmap overlap | action |
|---|---|---|
| `services/ui/AnalystLensService.ts` (9 dead exports) + `customEnsemblePrompt` / `customLensPrompts` | 🔴 the in-flight tree already removes `lensConfig`, `ensembleModelSelection`, `customEnsemblePrompt`, `customLensPrompts` and `isEnsembleEnabled` from `UseAnalysisPipelineParams` — but `hooks/useAppSettings.ts` (the reader) and `hooks/useLensAndEnsembleConfig.ts` (the writer) are **not** in the dirty set. **⚠ the in-flight change can create a NEW dead path** (a lens config that is saved but never read) | **HOLD.** Wait for the in-flight change to land, then re-run the sweep. **Do not delete piecemeal.** Highest-collision item in the manifest. |
| `services/learning/MemoryConsolidationService.ts` | `HANDOFF_LEARNING_LOOP.md:185` says the pruners are LIVE. **That claim is false at the pin.** The handoff is the plan of record | **HOLD on the doc; report the contradiction.** The code is verifiably dead, but the right move may be **re-wire, not delete**. |
| `services/providers/debatePods.ts`, `utils/debateTemplates.ts`, `utils/debateEnvelopes.ts`, `types/bot.ts`, `utils/teamRoster.ts` | `docs/plans/debate-deletion-status.md` is the deletion ledger; `stage2-implementation-plan.md` and `stage3-arrangement.md` reference the seat/moderator model. `utils/debateEnvelopes.ts`, `types/bot.ts` and `utils/teamRoster.ts` are **already removed in flight** | `debatePods.ts` (no production consumer) is the only safe one. The rest: **HOLD until the in-flight tree settles.** |
| `services/analysis/HybridIntelligenceService.ts:1433` `runMonteCarloForSetupAsync` | the hybrid-data path is live; the Monte Carlo arm may be planned for re-wiring | **HOLD — NEEDS CHECK** |
| The write-only GlobalMemory ledger | `docs/plans/workstream1-stepB-evidence.md` and `docs/learning-loop-map.md` describe the writeback path | **HOLD** — the store may be planned for a reader |
| `approval_rules_v1` | `tests/exportRawLocalStorage.test.ts:97` explicitly defers it | **PRODUCT DECISION, not cleanup** |
| `trade_sidebar_open_v1`, `agent_threads_opened_v1` | on **neither** decision table | **NEEDS CHECK** before touching the lists — the WebView origin quota is shared |
| `utils/messageDisplayText.ts` | the missing render-time strip is a **behaviour** decision | **DO NOT DELETE** without deciding where the strip goes |
| `plugins/GallerySaver.ts` + the Java plugin | the Java side is live in the APK | **DECIDE wire-vs-delete; if delete, BOTH sides** |
| `components/dashboards/learning/AvoidSetupsSection.tsx` | `docs/plans/debate-deletion-status.md:1636-1644` flags it as a rename survivor | **SAFE to delete** |
| `services/validation/TradeValidationGate.ts:227` `matchPatternMemory` | a test-only duplicate of the pattern scorer; `tests/accuracyValidation.test.ts` pins it | delete the export **and** the test, or keep both. **NEEDS CHECK** |
| `@fontsource/inter` | `index.css:169` names `'Inter'` in the fallback chain but no font file is loaded | **SAFE** to remove both |
| `openai` 4.52.7 | live at `GenericProviderService.ts:510` | **outdated-major, NOT dead** — no action |
| `utils/ticketSize.ts` (test-only) | `G-06` calls it *"the highest-value re-homing in the codebase"* | **NOT cleanup — it is Report 2 §E-12.** Do not delete the module. |
| `services/validation/TradeValidationGate.ts:495` `runValidationGate` (no production importer) | the validation gate is the product's core promise | **NOT cleanup — a decision.** See §1.5. |

---

## 11. What this manifest deliberately does **not** propose

- **No history rewrite.** The 52 MB of APKs (§7.5) are a real cost, but purging them needs
  `git filter-repo` and a coordinated force-push across four remote branches. **That is a release
  decision, not a cleanup batch.**
- **No deletion of the orphan checkpoint commits** — see Batch 0. They are the only record of the
  previous audit.
- **No deletion of `utils/ticketSize.ts`**, `services/validation/TradeValidationGate.ts`, or the
  GlobalMemory ledger — those are **decisions**, and they are in Report 2.
- **No change to the product's boundaries**: no order placement, no exchange write access, no
  removal of the no-order guarantee that `tests/disclaimer.test.ts` enforces.
- **No new dependency**, no database, no vector store, no graph store, and **no widening of the
  tool surface** — every proposal here reads or writes something the app already stores.

---

## 12. Addendum — three gaps the first draft of this manifest left open

An honest self-audit against the brief's Part D list found three items that were covered only
implicitly. They are closed here.

### 12.1 The per-store schema, version and growth table

**§2 of Report 1 carries the full store inventory. What it did not carry, per store, is the
schema/version, the count or byte cap, and the growth characteristic.** Here it is, for every
persisted store, at the pin.

| store | value shape | cap | growth | version? |
|---|---|---|---|---|
| **the notebook** `memory_files_v1_<user>` | a JSON **object** of `path → markdown` entries | **2 MiB** (the `memory_files_v1` key is the app's largest) | **unbounded in principle**, bounded by the memory budget's refusal-to-grow | **no version field, no checksum** — §11.8 |
| `profile_memory_v1_<user>` | `JSON.stringify(entries.slice(-40))` — an **array** | **40 entries** (`services/learning/profileMemory.ts:47`) | count-bounded | no |
| `learning_rules_v2_<user>` | a JSON object of rules | — | **write-only since the rules store was retired** (Report 1 §4.6) | no |
| `global_learning_state_<user>` | a **calibration object** (`setPreferenceObject`, `GlobalLearningService.ts:162`) | — | grows with closed trades | no |
| `memory_injections_v1_<user>` | an array of injection records | — | **grows with every turn** | no |
| `rl_signals_data` | a JSON object of RL signals | — | grows with closed trades | no |
| `session_review_{counter,drafted,open_theses,resolver}_v1` | small counters / thesis arrays | `OPEN_THESIS_TTL_MS` = 14 days (`sessionSkillReview.ts:308`) | TTL-bounded | no |
| `supervisor_{auto,last_run}_v1_<user>` | a small object | — | fixed size | no |
| `supervisor_triaged_v1_<user>:<id>` | one record per triaged item | — | grows with supervisor passes | no |
| `memory_amendments_v1` | an array of amendment proposals | — | grows | no |
| `august_harness_lessons_v1` | an array of wire/budget lessons | — | **grows without a cap** | no |
| `approvals_grandfathered_v1_<user>` | a one-shot migration marker | — | fixed | no |
| `book_drafts_seeded_v1` | a one-shot marker | — | fixed | no |
| `skill_drafts_v1[:<user>]` | `JSON.stringify(drafts.slice(-20))` — an array | **20 drafts** (`utils/skillDrafts.ts:54`) | count-bounded | no |
| `skill_drafts_v1_rejected:<user>` | tombstones | — | grows | no |
| `skill_drafts_v1_gate_attempts:<user>` | attempt ledgers, `tradeIds.slice(-40)` (`:202`) | 40 trade ids per cluster | count-bounded | no |
| `learning_proposals_v1:<user>` | `JSON.stringify(items.slice(-30))` — an array | **30 proposals** (`utils/learningQueue.ts:106`) | count-bounded | no |
| `attributed_insights_kb` | a legacy array | — | **migrated into the notebook** (`distilledMemory.ts:343`) | no |
| `bots_v1_<user>` | a JSON array of bot rows | — | **was never written** (F-14) | no |
| `agents_bots_v1_<user>` / `agents_groups_v1_<user>` | `JSON.stringify(items)` — arrays (`services/agents/agentRoster.ts:100`) | — | grows with the roster | no — **removed in the in-flight tree** |
| `agent_threads_opened_v1_<user>` | a set of opened thread ids | — | grows | no |
| `agent_pins_v1_<user>` | pinned ids | — | grows | no |
| `trade_chat_sessions_v1_<user>` | a JSON array of sessions, each with **≤60 entries** (`services/trade/chatSessions.ts:147`) | 60 entries/session; **512 KB** on export | **bounded by count, NOT by bytes** — the open backlog `R-201`/`G-60` | no |
| `trade_chat_active_v1_<user>` | **a plain string** (a session id) | — | fixed | no — **deliberately not backed up** (`ExportService.ts:367-371`) |
| `trade_tool_payloads_v1_<user>` | a JSON object of tool payloads | **256 KB** on export | grows with turns | no |
| `trade_watches_v1_<user>` | `JSON.stringify([...watches].slice(-10))` (`services/trade/watchService.ts:61`) | **10 watches** (`:32`) | count-bounded | no |
| `trade_level_arms_v1_<user>` | `JSON.stringify(plans)` (`levelWatchService.ts:140`) | — | grows with armed plans | no |
| `trade_level_hits_v1_<user>` | `JSON.stringify([...fired].slice(-200))` (`:167`) | **200 hits** (`MAX_LATCHED`, `:64`) | count-bounded | no |
| `trade_drawings_v1_<user>_<sym>` | `JSON.stringify(trimmed)` (`chartDrawings.ts:121`) | — | grows with drawings | no |
| `trade_session_drawings_v1_<user>_<sess>` | `JSON.stringify(store)` (`:187`) | **1 MB** on export | **keeps every coin** — `G-27` | no |
| `trade_session_model_v1` | a plain string | — | fixed | no — exempt |
| `trade_tf_bar_v1_<user>` | the last timeframe bar | — | fixed | no |
| `trading_checklist_v1` | a JSON array of checklist items | **64 KB** on export | **no count cap** — `G-27` | no |
| `nav_rail_width_v1`, `right_panel_width_v1_<surface>`, `trade_sidebar_open_v1` | plain numbers/strings | — | fixed | no |
| `august_surface_v1`, `august_trade_mode_v1_<user>`, `learn_tab_v1`, `august_update_notes_seen_v1`, `august_model_picker_free_only_v1`, `skills_grid_pins_v1` | plain strings | — | fixed | no |
| `desk_idle_motion_v1_<user>` | a boolean | — | fixed | no |
| `thinking_leak_bin_v1` | a ring buffer of thinking leaks | — | grows | no |
| `last_active_user` | a plain string | — | fixed | no |
| `approval_rules_v1[:<user>]` | a JSON object of per-coin rules | — | grows with the rules | no — **on neither backup list** (F-04) |
| the 24 `PREF_KEYS` | strings, JSON objects, or arrays | — | varies | no |
| **SQLite** `users`, `trades`, `conversations`, `trade_summaries`, `saved_analyses`, `thinking_records` | typed tables, 12 indexes | — | grows with use | **yes — `schema_migrations`, v2…v7** (`SqliteService.ts:265-270`, `:311-363`), all additive, recorded only on full success (`:296-308`) |
| **IndexedDB** `FuturesAI-DB`, `AugustBackups`, `ThinkingStore`, `OfflineQueue`, `MessageImages` | object stores with keyPaths | — | grows | **yes — each store carries a version** |

**The pattern, stated plainly: _every_ store is a version-less JSON blob except the two that
have a real schema — SQLite and IndexedDB.** Nine of the stores are count-bounded, four are
byte-bounded **on export only** (not on write — `R-201`/`R-202`/`G-60`), and **the notebook, which
is the one store the app cannot regenerate, has neither a version nor a checksum.**

### 12.2 The brief also asked about **duplicated packages** — and there is one duplication nobody has named

**[Verified by code reading]** The brief's Part D item 5 lists *"unused, duplicated, outdated, risky
or oversized packages"*. The first draft of this manifest covered unused, outdated, risky and
oversized. The **duplicated** half was not covered, and it is not a package-level duplication — it
is a **capability** duplication that the package list makes invisible:

> **The app ships two complete SQLite implementations and picks between them at runtime.**
> `@capacitor-community/sqlite` (`services/infrastructure/SqliteService.ts`) for native, and
> `idb` + a hand-written IndexedDB layer (`services/infrastructure/dbService.ts`) for web.
> Both expose the same seven tables' worth of operations, and **the two schemas are not the same
> shape** — the web path is a *user-profile blob with nested trades and conversations*, the native
> path is *relational tables with a `schema_migrations` ledger*.

**Consequences that are already visible in the audit:**

1. **A trade logged on web and a trade logged on native are not the same shape** — the web path
   stores a nested profile document, the native path stores rows. That is why
   `stage3-arrangement.md:29-41` (roadmap `R-213`) records the live-journal counts as *"not
   obtained"*, and why `R-214` records that *"pre-F3a rows carry no `planId`"*.
2. **The migration ledger only exists on the native path.** The web path has no version, so
   **the web store cannot be migrated** — it can only be replaced.
3. `services/infrastructure/dbService.ts:437` `isUsingSqlite` is a **dead export** (Report 4 §1.3) —
   the switch between the two is decided somewhere else, and the flag that would have named it is
   unused.

**The duplication is not a bug to fix — it is a design decision to document.** The proposed
change is therefore documentation-first: a `docs/architecture.md` section that states, in one
place, **which path owns which table, what the web shape is, and what a migration between them
would have to do.** Report 5 §2 Phase 3 already proposes writing that document. **The missing part
is that it must include the two-schema problem, not just the module list.**

**A smaller, genuine package-level duplication:** `clsx` **and** `tailwind-merge` are both used
**only** by `lib/utils.ts`'s `cn` helper, and `lib/utils.ts` is used **only** by
`components/ui/task.tsx`. So two popular packages hang off a single-file helper used by a single
component. That is not duplication — it is a **dependency chain that a future edit could sever
for free** (fold `cn` into the one consumer and drop both packages). Low priority; **SAFE**; a
one-line change with two dependency removals.

### 12.3 "Tests that assert nothing" — the systematic scan, and its result

The brief's Part A item 10 asks for *"tests that pass over dead code **or assert nothing**"*. The
first draft covered the first half thoroughly (Report 4 §4.1 — ~17 test files exercising dead
app code) and the second half **not at all**. It is now scanned.

**Method:** a script that strips line comments, then flags any file that has an `it(`/`test(`
block but **no** `expect(` / `assert.` / `assert(` / `.should` / `toBeTruthy` / `toEqual` /
`toMatch(` anywhere in the file.

**[Verified live]** over the whole `tests/` tree:

| result | count |
|---|---|
| files scanned | 475 at the current tree (479 at the pin) |
| **files with a test block but no assertion at all** | **2** — and **both are support files, not test files**: `tests/helpers/sourceCode.ts` and `tests/jsxScan.ts` (neither matches the `*.test.ts` include glob) |
| **files where every test block is skipped** | the same 2 |
| **test files that assert nothing** | **ZERO** |

**⇒ There is no "asserts nothing" class in this repository.** Every one of the 479 test files
makes at least one assertion. **[Verified live]**

Two related facts from the same pass, for the record:

- **Zero snapshot tests** — no `.snap` file, no `toMatchSnapshot`, no `toMatchInlineSnapshot`
  anywhere. **No brittle snapshots.**
- **The 11 skips are all in one file** — `tests/lensWordCount.measure.test.ts`, whose whole
  `describe` is `describe.skip` unless `RUN_LENS_MEASUREMENT=1` (`:55-56`) and a provider key is
  configured. **Deliberate, documented at `:7-8`, and correctly designed.**
- **The 8 skip/only markers in the tree** (measured by grep) are that file's `describe.skip` /
  `it.skip` pairs plus the `gated` / `gatedIt` aliases it defines at `:55-56`. **No accidental
  `.only`.**

**The one caveat this scan cannot see — and it is the same caveat the whole audit carries:** a
test can assert *something* and still assert the wrong thing. The 17 files that exercise dead
code (Report 4 §4.1) all make assertions. **They assert correctly about code the app never runs.**
That is the more dangerous class, and it is why `E-11` (a test that asserts what is *sent*) and
`E-24` (behavioural coverage for the Electron shell) matter more than any count of assertions.
