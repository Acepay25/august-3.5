# August Trading — Trade review and the learning loop

**Research baseline, section: review & learning.**
Repo: `C:\Dev\august-3.5` @ `2b4d4fa2` (working tree has 6 unrelated modified files; this report is the only file written).
Method: static reading + `git` inspection only. No build, no run, no network, no exchange keys, no orders.

**Reachability method.** Where a verdict turns on "is this wired?", the claim is backed by an import-closure walk from the app's real entry roots (`App.tsx`, `index.tsx`, `main.tsx`) over every `*.ts`/`*.tsx`/`*.cjs` under `components/ hooks/ services/ utils/ constants/ shared/`, following static `from '…'`, `export … from` and `await import('…')` — the same rule `tests/featuresAreWired.test.ts:106-139` uses. Result: **480 modules reachable, 67 in `services/learning/`, 65 of them reachable.** The two that are not: `services/learning/MemoryConsolidationService.ts` and `services/learning/providerFitness.ts` (both confirmed orphan by grep as well).

Verdict vocabulary: **REAL** = the capability runs and its output reaches a human or a live turn; **PARTIAL** = it runs but a step is missing, or it reaches a store nobody reads; **COSMETIC** = it computes/reports something with no effect on behaviour or on what the trader sees.

---

## 1. Feature list

| # | Feature | One sentence | Verdict | Evidence |
|---|---|---|---|---|
| 1 | **Skill store** | A skill is a markdown file with YAML frontmatter in the notebook's `skills/` folder; ~40 metadata fields ride in that frontmatter. | **REAL** | `services/learning/SkillMemoryService.ts:646` `parseSkillMarkdown`, `:1281` `serializeSkill`, `:1275` `listSkills`, `:108-440` `SkillMeta` |
| 2 | **Skill draft inbox** | Proposals live in a per-user `localStorage` queue (`skill_drafts_v1:<user>`), capped at the newest 20, and are listed in the Coach thread. | **REAL** | `utils/skillDrafts.ts:65` `queueSkillDraft`, `:84` `takeSkillDraft`, `:54` cap; `components/chat/CoachThreadPanel.tsx:189` `listSkillDrafts` |
| 3 | **Two-tier draft gate** | Every draft source passes the same bar: deterministic (cooldown, pending-dup, live coverage, IF/THEN sanity, default prediction + description) or evidence (full LLM worth gate). | **REAL** | `services/learning/draftGates.ts:85` `deterministicDraftGate`, `:199` `gateEvidenceBackedDraft`, `:88-96` the four refusals |
| 4 | **Human approval = the only writer** | A pending draft becomes a live skill only through `approveSkillDraft`, which reads the library back and leaves the draft in the inbox on any failure. | **REAL** | `services/learning/skillApproval.ts:53` `approveSkillDraft`, `:83-88` the read-back, `:89` `takeSkillDraft` only after the read-back |
| 5 | **Honest approval toast** | "Skill saved" / "Already learned" / "Not saved — still in your inbox" are derived from what the library actually did, not from the call resolving. | **REAL** | `services/learning/skillApproval.ts:115` `skillApprovalToast`, `:100` `skillIngestOverrideNote`; wired `App.tsx:1988-1991` |
| 6 | **Supervisor auto-triage** | An LLM reviews every queued item on a debounce/hourly budget and records a verdict — but since 2026-10-05 it changes **nothing**; only the trader's Save/Discard creates or removes. | **REAL (triage only)** | `services/learning/skillSupervisor.ts:511` `runSupervisorPass`, `:183-198` the contract-change comment, `:695`/`:708` the two human override buttons |
| 7 | **The activation gate** | Nothing model-generated reaches a seat's prompt without a human "yes": `approvedBy ∈ {human, grandfathered}`, or `prior: 'book'` with the starter-library toggle on. `approvedBy: 'supervisor'` is deliberately **not** approval. | **REAL** | `services/learning/SkillMemoryService.ts:999` `isApprovedSkill`, `:360-375` the `approvedBy` doc; enforced `services/learning/MemoryRetrievalService.ts:226`; migration `services/learning/approvalMigration.ts:54` (backup first, `:67`) |
| 8 | **Skills index in the live prompt** | Up to 30 rows (slug, status, kind, activation description, IF→THEN) are injected into every desk/Chat turn, ranked by trigger usability → status → recency. | **REAL** | `services/trade/tradeChatContext.ts:354` `buildSkillsIndexForPrompt`, `:335` `rankSkillIndexRows`, `:272` `isIndexableSkill`; live `services/trade/chatSurfaceTurn.ts:118-120`, `components/trade/TradeChatPanel.tsx:425-464` |
| 9 | **Retrieval + tier-2 body injection** | The best-matched approved skill's body is injected (verdict stage) and the runners-up as index lines, with coin/direction/family/regime scoping and a description-overlap scorer. | **REAL** | `services/learning/MemoryRetrievalService.ts:202` `rankedMatchedSkills`, `:531` `matchedSkillBlock`, `:241` `descriptionOverlap`, `:282` zero-evidence ban |
| 10 | **Code-checked skill predicates** | A skill can carry a machine-evaluable trigger; the gate evaluates it on the last closed candle and renders a "CODE-CHECKED TRIGGERS" note. | **PARTIAL** | `services/learning/skillPredicateGate.ts:131` `evaluateSkillPredicates`; live `services/trade/proposalGate.ts:263` and `hooks/useAnalysisPipeline.ts:1101`. **The ceiling is computed and dropped:** `:200` computes `ceiling`, `:216` renders it only as prose ("the verdict cannot exceed 40%") — it never caps the recorded probability (repo's own O-13) |
| 11 | **Deterministic skill enforcement** (hard `avoid` veto, candidate cap, confidence downgrade) | The function that would let a confirmed avoid skill refuse a trade is computed and never called. | **COSMETIC / DEAD** | `services/learning/SkillMemoryService.ts:3863` `applyNotebookSkillsToAnalysis` — **zero production call sites** (repo's own O-11) |
| 12 | **Skill evidence ledger** | Closed trades move a skill's W/L, `netR`/`grossR`/`netRKnown` and `rSampled`; stale evidence halves in 30-day bands. | **REAL** | `services/learning/SkillMemoryService.ts:2243` `applySkillEvidence`, `:2107` `countTradeOutcome`, `:2286` `applyEvidenceDecay` |
| 13 | **Three-state adherence (followed / overridden / control)** | The join is exact on the originating `runId`; a CONTROL outcome never inflates a skill's record, an OVERRIDDEN one queues an amendment proposal. | **REAL** | `services/learning/MemoryInjectionService.ts:189` `skillAdherenceForRun`; `services/learning/SkillMemoryService.ts:2027-2086` |
| 14 | **Status ladder (candidate → confirmed → retired)** | Promotion needs a Wilson CI gate, a met birth-claim and expectancy support; retirement needs a sample floor; decay demotes a confirmed skill whose recent window decayed. | **REAL** | `services/learning/SkillMemoryService.ts:1871` `deriveStatus`, `:1556` `confirmationCiGate`, `:1636` `isDecayed`, `:1921-1933` the eval-hurts override and decay demotion |
| 15 | **Temporal status ledger** | Every status transition is stamped `validFrom → invalidAt`; a replay can ask "what did I believe at time T?". | **REAL** | `services/learning/SkillMemoryService.ts:1236` `stampStatusTransition`, `:1264` `skillStatusAt`, `:191` `statusAtTime` in retrieval |
| 16 | **Graveyard + revival cards** | A retired skill leaves a one-line tombstone ("tried X, retired: <reason> after N=…, lift …pts"); the worth gate reads it, and a re-draft of the same trigger raises a REVIVAL card instead of a fresh skill. | **REAL** | `services/learning/skillGraveyard.ts:97` `recordTombstone`, `:114` `graveyardBlock`, `:288` `findArchiveTwin`, `:341` `queueRevivalProposal`; injected `services/learning/skillWorthGate.ts:105` |
| 17 | **Graveyard retention sweep** | Weekly pass that enforces the store's own newest-40 boundary and collects malformed/duplicate rows. | **REAL** | `services/learning/skillGraveyard.ts:189` `runGraveyardSweep`; called `services/learning/memoryHygiene.ts:244` |
| 18 | **Idle lifecycle (suspend 90d → archive 180d)** | A skill that stops matching anything leaves the prompt at 90 days and the active library at 180; it can revive on its own if its trigger matches again. | **REAL** | `services/learning/skillIdleLifecycle.ts:264` `runSkillIdleSweep`, `:131` `evaluateSkillLifecycle`, `:71`/`:76` the windows, `:308-345` revive/archive/suspend writes; called `services/learning/memoryHygiene.ts:269` |
| 19 | **Library cap + displacement proposal** | At the cap, creation becomes comparative and the weakest confirmed skill's displacement rides the human queue instead of a write. | **REAL** | `services/learning/SkillMemoryService.ts:3364` `checkLibraryCapAtGate`, `:3398` `applyDisplacementProposal` |
| 20 | **Consolidation / exact-duplicate merge** | Exact-duplicate triggers merge (W/L re-derived from the deduped trade-id union), losers are archived not deleted, and every retirement/absorption leaves a tombstone. | **REAL** | `services/learning/SkillMemoryService.ts:3175` `consolidateSkillsUnlocked`, `:3263-3285` the archive+record, `:3288-3319` the retired-archive sweep; called on every settlement `:3822` and under byte pressure `services/learning/memoryHygiene.ts:230` |
| 21 | **Worth gate (LLM create / merge / skip)** | An LLM judges a cluster against the catalog, the bot's memory and the graveyard; a `create` without a falsifiable prediction is refused. | **REAL** | `services/learning/skillWorthGate.ts:81` `evaluateSkillWorth`, `:59` `validateCraftedSkill` (fail-closed at `:67`) |
| 22 | **Worth-gate attempt throttle** | A gate that cannot run (no provider) does not re-bill once per close: the attempt ledger records what was judged and a retry needs a new trade id. | **REAL** | `utils/skillDrafts.ts:219` `shouldAttemptWorthGate`, `:190` `recordWorthGateAttempt`; used `services/learning/SkillMemoryService.ts:3727`, `:3734` |
| 23 | **Memory hygiene pass (7 steps)** | Weekly: stale-skill demotion proposals, contradiction sweep, notebook review, consolidation under pressure, graveyard retention, idle sweep, veto-cost demotions, negative-lift demotions — each logged. | **REAL** | `services/learning/memoryHygiene.ts:151` `runMemoryHygiene`; boot `:410` `runMemoryHygieneIfDue`; heartbeat `hooks/useLearningHeartbeat.ts:66` |
| 24 | **Weekly digest (stats + ONE impulse)** | Deterministic week stats plus exactly one model-written improvement impulse, stored per user and rendered as a Journal card. | **REAL** | `services/learning/weeklyReview.ts:128` `runWeeklyReview`, `:102` `buildWeeklyImpulsePrompt`, `:40` `MIN_CLOSED_TRADES_FOR_REVIEW`; card `components/journal/WeeklyReviewCard.tsx:13`; mounted `components/journal/Journal.tsx:192` |
| 25 | **Monthly report (scoreboard)** | A 30-day card: what happened, what was learned, what needs attention (incl. the worst skill-per-character), plus the panel scoreboard. | **REAL** | `services/learning/monthlyReport.ts:321` `runMonthlyReport`, `:260-272` the budget offender; card `components/journal/MonthlyReportCard.tsx:13`; mounted `components/journal/Journal.tsx:193` |
| 26 | **Weekly rollup** | Confirmed skills above the settled bar become **settled beliefs** (always-on prompt slot); cross-coin clusters are generalized; the rest is written to `profile/rollup-notes.md` for the doctrine rewriter. | **REAL** | `services/learning/weeklyRollup.ts:82` `runWeeklyRollup`, `:99` `upsertSettledBelief`, `:113` `runGeneralizationPass`; heartbeat `hooks/useLearningHeartbeat.ts:57`; the beliefs block reaches the prompt `services/learning/MemoryRetrievalService.ts:952` |
| 27 | **Settlement reflection (the post-mortem writer)** | Exactly one bounded model call at settlement writes `trade.postMortem` from the row's own measured facts; it writes nothing on a decline, a malformed answer, a transport failure, no provider, or a re-fire. | **REAL** | `services/learning/settlementReflection.ts:239` `reflectOnClosedTrade`, `:175` `reflectionPacket`, `:214` `renderPostMortem`; called **before** the notebook sync `hooks/useTradeLogging.ts:527` → `:549` |
| 28 | **IF/THEN auto-ingest from a post-mortem** | A settled trade's `IF … THEN …` sentence mints a skill **file** directly, unattended. | **PARTIAL** | `services/learning/SkillMemoryService.ts:3040` `ingestIfThenFromTradeUnlocked`, `:3145` the write. **The file it writes can never reach a model:** it sets `prior: 'gated'` (`:3125`) but **no `approvedBy`**, and `isApprovedSkill` (`:999`) is checked *before* the `prior:'gated'` exception in `services/learning/MemoryRetrievalService.ts:226` vs `:282`. The skill is still **named** in the prompt index (`services/trade/tradeChatContext.ts:272` `isIndexableSkill` checks no approval), so the model is told "APPLY any that match" about a rule the harness will never inject. This is the repo's own "post-mortem leg is starved" note (`docs/app-flow.md:876`, O-31) — **still true in code**. |
| 29 | **Skill A/B eval + `hurts` demotion** | A scheduled, budgeted eval runs a skill against a shadow window; a `hurts` verdict pins the skill at candidate. | **REAL** | `services/learning/SkillEvalScheduler.ts` (reachable), `services/learning/SkillEvalService.ts`; fired `services/learning/SkillMemoryService.ts:3841` `runDueSkillEvalWithDefaultRunner` |
| 30 | **Meta-calibration (the loop measuring the loop)** | Worth-gate precision, refinement recovery and eval agreement are recorded and shown on the weekly card. | **REAL** | `services/learning/metaCalibration.ts` `recordWorthGateApproval` / `recordWorthGateConfirm` / `recordRefinementOutcome` / `recordEvalAgreement`, `runWeeklyMetaCalibration`; recorded from `services/learning/SkillMemoryService.ts:2786`/`:2093`; rendered `components/journal/WeeklyReviewCard.tsx:43-48` |
| 31 | **Belief challenge + settled beliefs** | A weekly pass contests settled beliefs against the new record; the beliefs themselves are an always-on prompt slot above the doctrine. | **REAL** | `services/learning/beliefChallenge.ts` `runBeliefChallengePass` (called `services/learning/weeklyReview.ts:170`); `services/learning/settledBeliefs.ts` `settledBeliefsBlock` → `services/learning/MemoryRetrievalService.ts:952` |
| 32 | **Doctrine consolidation** | Every N closed trades an LLM rewrites `profile/doctrine.md` into first-person settled beliefs. | **REAL** | `services/learning/DoctrineConsolidationService.ts`; called `services/learning/SkillMemoryService.ts:3831` `consolidateDoctrine` |
| 33 | **Strategy store (named trade plans)** | A strategy is a notebook file in `strategies/` with `status: draft \| active \| retired`; only `active` plans are injected into a seat's prompt. | **REAL** | `services/learning/strategyStore.ts:209` `activeStrategiesBlock`, `:205` `listActiveStrategies`, `:338` `setStrategyStatus`; live `services/trade/chatSurfaceTurn.ts:127`, `components/trade/TradeChatPanel.tsx:446`; UI `components/settings/StrategyPlans.tsx:30` |
| 34 | **Learning RULES store** (`learning_rules_v2_<user>`) | The legacy IF/THEN rules store still loads, still saves, and is still exported — but **nothing reads it into a prompt**. | **COSMETIC (write-only)** | `services/infrastructure/StorageService.ts:105` `loadLearningRules` / `:136` `saveLearningRules`; the only production use is a load-then-save no-op round trip `hooks/useUserProfileLoader.ts:434-443`; `hooks/useTradeLogging.ts:194-199` states the store is "no longer written … read-only history". Repo O-30: "**The rules store has no reader**" |
| 35 | **Harness lessons** | Wire-level lessons are recorded and browsable in Settings, and they reach a pin-checker — but no prompt reader exists (the two fake readers were deleted in E-57 §2). | **PARTIAL** | `services/learning/harnessLessons.ts` `recordHarnessLesson` (called `services/learning/SkillMemoryService.ts`, `components/chat/MemoryProvenanceStrip.tsx`), browser `components/settings/HarnessLessonsBrowser.tsx`; stated limit `docs/app-flow.md` §G.6 |
| 36 | **Memory consolidation service** | `pruneOutdatedInsights` / `aggregateSimilarInsights` exist in their own file — and nothing imports it. | **COSMETIC / DEAD** | `services/learning/MemoryConsolidationService.ts:74` / `:102`; **no importer of any kind** (import-closure walk + grep). `services/learning/AlgorithmicMemoryService.ts` has its own copies (repo's own cleanup manifest calls this "100 % dead") |
| 37 | **Provider fitness** | A cross-regime provider score with a production importer of zero. | **COSMETIC / DEAD** | `services/learning/providerFitness.ts` — only `tests/decisionBiasClosure.test.ts` imports it; a comment in `services/backtesting/ModelPerformanceService.ts:142` names it |
| 38 | **Skill import / export** | Skills can be imported from files into the notebook. | **REAL** | `services/learning/SkillImportService.ts` `importSkillFiles` → `components/dashboards/StrategyStudio.tsx` |
| 39 | **Strategy PDF summarizer** | The trader's own strategy PDFs are summarised into plans. | **REAL** | `services/learning/strategySummarizer.ts` `summarizeStrategiesPdf` → `components/settings/StrategiesManager.tsx`; prompt registered `constants/promptRegistry.ts` |
| 40 | **Book seeds / book drafts** | `seedStrategies` lands vetted book priors as `prior: 'book'` candidates (injectable from birth, gated by one Settings toggle); `bookSkillDrafts` turns the trader's own PDF library into drafts behind the human gate. | **REAL** | `services/learning/seedStrategies.ts` `ensureSeedSkills` → `hooks/useUserProfileLoader.ts`; `services/learning/bookSkillDrafts.ts:196` `queueSkillDraft`; `prior:'book'` approved via `services/learning/SkillMemoryService.ts:1004` |
| 41 | **Skill proof ("Prove on history")** | A draft's trigger is replayed against 1,000 candles of the coin's history and reported as hits/W-L/MFE/MAE — explicitly labelled "it does not grade the draft". | **REAL (with a defect)** | `services/learning/skillProof.ts` `proofSkillOnHistory`; card `components/chat/CoachThreadPanel.tsx:94-125`. **Defect:** the replay timeframe is `d.crafted.timeframe \|\| '1h'` (`:105`), and a `propose_skill` draft can **never** carry a timeframe (see §4) |
| 42 | **Skill review job (E-55)** | A deterministic per-skill review that reports findings and repairs — run from the Skills catalogue. | **REAL** | `services/learning/skillReview.ts` `reviewAllSkills` → `components/learn/SkillsCatalog.tsx`, `components/learn/SkillViewerPanel.tsx`; `services/learning/skillDocument.ts` `parseSkillBody` / `projectSkillCard` |
| 43 | **Memory health report** | One pure read over every memory surface (folders, skills by bucket, ghosts, queue sizes, byte pressure, hygiene log) for the Health tab. | **REAL** | `services/learning/memoryHealth.ts` (`:39` imports every store); `components/learn/MemoryHealthCard.tsx:81` `runMemoryHygiene` on demand |
| 44 | **Memory budget (soft/trigger/hard byte caps)** | The notebook refuses growth at the trigger tier and all model notes at the hard cap; pressure also *shortens* the hygiene interval. | **REAL** | `utils/memoryBudget.ts` `measureNotebook` / `describePressure` / `cleanupIsDue`; `services/learning/MemoryFilesService.ts` `notebookWantsCleanup`, `notebookPressureAllows`; `services/learning/memoryHygiene.ts:123` |
| 45 | **Memory amendments inbox** | A model can propose a notebook correction; a human approves or rejects it. | **REAL** | `services/learning/memoryAmendments.ts` `proposeAmendment` → `services/analysis/DeskToolsService.ts:2524-2540`; inbox `components/learn/AmendmentsInbox.tsx` |
| 46 | **Memory topics** | The notebook's notes are grouped into topics with per-topic summaries. | **REAL** | `services/learning/memoryTopics.ts` `memoryTopicsFromStore` → `components/learn/MemoryTopicsCard.tsx` |
| 47 | **Decision reflection** | The turn's decision context is handed to the prompt builder. | **REAL** | `services/learning/DecisionReflectionService.ts` `buildDecisionReflectionContext` → `hooks/useAnalysisPipeline.ts` |
| 48 | **Self-learning profile** | A per-trader learning profile (weaknesses, tendencies) computed for the learning dashboard. | **REAL** | `services/learning/SelfLearningService.ts` `computeLearningProfile` → `components/dashboards/LearningDashboard.tsx` |
| 49 | **Severity insights / cumulative bleed** | High-severity post-mortems are recorded as attributed insights and summarised. | **REAL** | `services/learning/severityInsights.ts` `recordSeverityInsight` / `extractCumulativeBleedInsight` → `services/learning/PatternMemorySynthesisService.ts`; summary `components/dashboards/VersionHistoryDashboard.tsx` |
| 50 | **Regime ledger** | Every closed trade's observed regime is stamped, and the matrix re-resolves history from it. | **REAL** | `services/learning/regimeLedger.ts` `recordRegimeDay` → `hooks/useAnalysisPipeline.ts`, `resolveTradeRegime` → `hooks/useTradeLogging.ts`; `services/learning/strategyRegimeMatrix.ts` |
| 51 | **The `propose_skill` desk tool** | A model may propose a new skill; it lands as a pending draft for a human. | **PARTIAL** | `services/analysis/DeskToolsService.ts:1049-1086` (definition), `:2650-2735` (handler). See §4 for the precise defect |
| 52 | **The `revise_skill` desk tool** | A model may propose narrowing an existing skill; it lands as a `rescope` proposal with the model's own reason attached. | **REAL** | `services/analysis/DeskToolsService.ts:2779-2832`; applier `utils/learningQueue.ts:177` `applyProposalCard` → `services/learning/SkillMemoryService.ts:3583` `applyRescopeProposal` |
| 53 | **The `propose_strategy` desk tool** | A model may propose a named trade plan; it is written as a `draft` in the notebook and does nothing until activated. | **REAL** | `services/analysis/DeskToolsService.ts:2736-2778`; `services/learning/strategyStore.ts:317` `proposeStrategy` (`:329` refuses an empty slug) |
| 54 | **ε-holdout for skill injection** | ~10 % of runs get no skill injection, so the control group keeps growing; the same runId governs both lanes. | **REAL** | `utils/skillHoldout.ts` `shouldSkillHoldout`; used `services/learning/MemoryRetrievalService.ts:883`, `services/learning/skillPredicateGate.ts:147` |
| 55 | **Followed-skill attribution** | The skills actually shown on a turn are recorded on the row, and the injection log is the settled record of what was sent. | **REAL** | `utils/followedSkills.ts`; `services/trade/chatSurfaceTurn.ts:119` `skills = ranked.slice(0, SKILL_INDEX_WINDOW).map(r => r.slug)`; `services/learning/MemoryInjectionService.ts:72` `recordMemoryInjection` (opt-in: `:967` `recordInjections === true`) |
| 56 | **Skill economics (cost per injected char)** | The monthly card names the most expensive skill per unit of measured lift. | **REAL** | `utils/skillEconomics.ts`; used `services/learning/monthlyReport.ts:260-272` `worstBudgetOffender` |
| 57 | **Learned-skill statistics (Wilson CI, lift)** | Promotion needs a Wilson lower bound, not a raw win-rate threshold. | **REAL** | `utils/skillStatistics.ts` `ciGatePasses` → `services/learning/SkillMemoryService.ts:1556` `confirmationCiGate` |
| 58 | **Chat-surfaced proposal receipts** | A proposal lands in the transcript as a one-line status row naming the tool class and where to review it; refusals aggregate into one quiet "Blocked" line. | **REAL** | `services/analysis/DeskToolsService.ts:70` `toolActionFromResult` (`:93` the `propose_skill` label + "the Coach inbox" review hint), `:4044-4049` the persist step; renderer `components/chat/ToolActionsRow.tsx:39-80`, `:177-213` the Blocked line |

---

## 2. The skill lifecycle

### 2.1 The states and where they are stored

A skill has **two independent axes**, and conflating them is the single most common source of confusion in this area.

| Axis | Values | Stored where | Authoritative reader |
|---|---|---|---|
| **Status** (`SkillStatus`) | `candidate` → `confirmed` → `retired` | frontmatter `status:` in the skill file | `services/learning/SkillMemoryService.ts:72` |
| **Approval** (`approvedBy`) | `undefined` \| `'human'` \| `'grandfathered'` \| `'supervisor'` (not approval) | frontmatter `approvedBy:` | `services/learning/SkillMemoryService.ts:375` |
| **Availability** (not a status) | `enabled: true/false` **plus** `meta.suspendedAt` **plus** `meta.disabledByUser` | notebook file flag + frontmatter | `services/learning/SkillMemoryService.ts:979` `skillEnabledFlag` |
| **Idle stage** (not a status) | `live` \| `suspended` \| `archived` | derived from `suspendedAt` + folder | `services/learning/skillIdleLifecycle.ts:131` `evaluateSkillLifecycle` |
| **Evidence** | `wins`, `losses`, `netR`, `grossR`, `netRKnown`, `rSampled`, `controlWins/Losses`, `overriddenIds`, `recentOutcomes`, `regimeStats` | frontmatter | `services/learning/SkillMemoryService.ts:134-176` (net/gross/R-sample at `:152-171`) |
| **Pending-draft state** | *not a skill at all* — a `SkillDraft` row in `localStorage` | `skill_drafts_v1:<user>` | `utils/skillDrafts.ts:3-9` |
| **Proposal state** | *not a skill at all* — a `LearningProposal` row in `localStorage` | `learning_proposals_v1:<user>` | `utils/learningQueue.ts:88-103` |
| **Tombstone** | `RetirementReason` = `insufficient-evidence \| regime-shifted \| superseded \| eval-hurts \| user-veto \| idle \| absorbed` | Preferences `skill_graveyard_v1_<user>` | `services/learning/skillGraveyard.ts:45-71` |

The deliberate design: **suspension is `enabled: false` + `meta.suspendedAt`, never a fourth `SkillStatus`** (`services/learning/skillIdleLifecycle.ts:33-46`), and `skillEnabledFlag` is the **only** place `enabled` may be derived (`services/learning/SkillMemoryService.ts:970-980`) — every write path must call it, or an unrelated attribution write silently un-suspends a skill.

### 2.2 The state machine, transition by transition

```
                    ┌──────────────────────────────────────────────────────────────┐
                    │  (A) PROPOSAL — not yet a skill                            │
                    │  SkillDraft row: utils/skillDrafts.ts:3-9                   │
                    └──────────────────────────────────────────────────────────────┘
   producers:
     propose_skill (desk tool)     services/analysis/DeskToolsService.ts:2650-2735
     sessionSkillReview            services/learning/sessionSkillReview.ts:207
     chartScanSkills               services/learning/chartScanSkills.ts:325
     bookSkillDrafts               services/learning/bookSkillDrafts.ts:196
     passMining                    services/learning/passMining.ts:291
     selfImprovement               services/learning/selfImprovement.ts:248
     post-mortem craft → evidence gate
                                   services/learning/draftGates.ts:241 / :253
                    │
                    ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │ (B) GATE                                                                 │
   │  deterministic tier: services/learning/draftGates.ts:85                    │
   │    :88 cooldown tombstone │ :91 pending-dup │ :93 live coverage │ :96 IF/THEN│
   │    :105-106 stamps default description + prediction                        │
   │  evidence tier:     services/learning/draftGates.ts:199                    │
   │    :211 evaluateSkillWorth → :222 merge │ :227 create │ :246 skip          │
   └────────────────────────────────────────────────────────────────────────────┘
                    │  queueSkillDraft → localStorage `skill_drafts_v1:<user>`
                    ▼  utils/skillDrafts.ts:65-82 (write + READ-BACK at :81)
   ┌────────────────────────────────────────────────────────────────────────────┐
   │ (C) PENDING DRAFT — the human's decision                                  │
   │  listed: components/chat/CoachThreadPanel.tsx:189                         │
   │  badge: App.tsx:1938 coachCount, :1951 approvalsWaiting                   │
   │  proof: CoachThreadPanel.tsx:94-125 (on demand)                           │
   └────────────────────────────────────────────────────────────────────────────┘
        │                                                        │
   [Save as skill]                                       [Discard]
   App.tsx:1988 coachAllowDraft                          App.tsx:1992 coachDenyDraft
        │                                                        │
        ▼                                                        ▼
   services/learning/skillApproval.ts:53 approveSkillDraft   utils/skillDrafts.ts:138
        │  :71 trade-backed  OR  :73 draft-backed                 tombstoneSkillDraftKey
        │  :83-88 READ-BACK: if the trigger is not in the         (7-day cooldown,
        │          library, DO NOT consume the draft                utils/skillDrafts.ts:96)
        ▼
   services/learning/SkillMemoryService.ts:2931 ingestCraftedSkillFromDraftUnlocked
        │  :2905 no skills folder → refuse (named)                     │
        │  :2910 duplicate trigger → refuse                             │
        │  :2932 prior: 'gated'  :2934 approvedBy: 'human'              │
        │  :2941 slug  :2948-2950 claim an unused `-2.md` name          │
        ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │ (D) LIVE SKILL FILE — skills/<slug>.md                                     │
   │  status: 'candidate' (never 'confirmed' at birth)                          │
   │  wins: 0, losses: 0, prior: 'gated', approvedBy: 'human'                  │
   │  born "unproven", labelled a hypothesis to the model                       │
   │  (MemoryRetrievalService.ts:516-523)                                       │
   └────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │ (E) USE — the retrieval / injection path                                   │
   │  services/learning/MemoryRetrievalService.ts:202 rankedMatchedSkills        │
   │    :226 isApprovedSkill  ← THE GATE                                         │
   │    :231 not retired (point-in-time replay)                                 │
   │    :241-257 description / structured-scope match                            │
   │    :267 not manualOnly                                                      │
   │    :282 zero-evidence ban (except prior 'book' / 'gated')                  │
   │  injected: MemoryRetrievalService.ts:887-916 (body at verdict stage)        │
   │  named:    services/trade/tradeChatContext.ts:354 buildSkillsIndexForPrompt │
   │  recorded: services/learning/MemoryInjectionService.ts:72 recordMemoryInjection│
   └────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │ (F) EVALUATION — the outcome lands                                         │
   │  services/learning/SkillMemoryService.ts:2243 applySkillEvidence           │
   │    :1990 skillAdherenceForRun  (exact runId join)                          │
   │    :2002 CONTROL   → controlIds/controlWins (never inflates the record)    │
   │    :2026 OVERRIDDEN→ overriddenIds; ≥3 ⇒ rescope proposal (:2038)          │
   │    :2068 FOLLOWED  → countTradeOutcome (+decay at :2067)                   │
   │  status re-derived: :1832 deriveStatus                                     │
   │    → 'confirmed' (CI gate :1517, claim :1904, expectancy)                   │
   │    → 'retired'  (sample floor + band)                                       │
   │  A/B eval: services/learning/SkillEvalScheduler.ts (fires at                │
   │    SkillMemoryService.ts:3841) → 'hurts' pins at candidate (:1921-1925)     │
   │  Lift: services/learning/MemoryProvenanceService.ts computeAllSkillLifts    │
   └────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │ (G) DECAY / RETIREMENT — the guards (see §5)                               │
   │  idle ≥90d → suspended (enabled:false + suspendedAt)                        │
   │      services/learning/skillIdleLifecycle.ts:338-345                         │
   │  suspended ≥180d → archived to skills-archive/ + tombstone                  │
   │      services/learning/skillIdleLifecycle.ts:320-334                         │
   │  retired → archived + tombstone (every retirement)                          │
   │      services/learning/SkillMemoryService.ts:3293-3319                       │
   │  duplicate → absorbed into the survivor, tombstone 'absorbed'                │
   │      services/learning/SkillMemoryService.ts:3263-3285                       │
   │  a re-draft of a retired trigger → REVIVAL card, not a new skill            │
   │      services/learning/SkillGraveyard.ts:288 findArchiveTwin                 │
   │  a non-human rewrite → approval WITHDRAWN, row parked                      │
   │      services/learning/SkillMemoryService.ts:1067 requestRewriteApproval    │
   └────────────────────────────────────────────────────────────────────────────┘
```

**The one writer.** `approveSkillDraft` (`services/learning/skillApproval.ts:53`) is the only path that turns a draft into a file, and its authority is a **read-back**, not the call's completion: `:83` re-scans the library for the trigger and `:84-88` refuses to consume the draft if it is not there. The same discipline appears in the queue write (`utils/skillDrafts.ts:81` reads the row back) and in the strategy writer (`services/learning/strategyStore.ts:329` treats an empty slug as a failure).

---

## 3. Rules vs Strategies vs Skills

**They are three separate stores with three separate lifecycles — and only two of them are alive.**

| | **RULES** | **STRATEGIES** | **SKILLS** |
|---|---|---|---|
| Store | `learning_rules_v2_<user>` (Preferences) | notebook folder `strategies/`, one `.md` per plan | notebook folder `skills/`, one `.md` per rule |
| Type | `LearningRule` (`types/learning.ts:107`) | `StrategyMeta` (`services/learning/strategyStore.ts:42-67`) | `SkillMeta` (~40 fields, `services/learning/SkillMemoryService.ts:108-442`) |
| Status axis | none | `draft \| active \| retired` (`:34`) | `candidate \| confirmed \| retired` |
| Who writes it | **nobody** (the auto-learn leg moved to skills — `hooks/useTradeLogging.ts:194-199`) | `propose_strategy` desk tool → `proposeStrategy` (`:317`); activation by hand (`setStrategyStatus` `:338`) | 8 intake sources → `draftGates` → human `approveSkillDraft` |
| Human gate | n/a (nothing writes) | yes — a draft does nothing until activated | yes — `isApprovedSkill` (`SkillMemoryService.ts:999`) |
| **Reaches a live turn?** | **NO.** No prompt reader anywhere. `StorageService.loadLearningRules` is only round-tripped at `hooks/useUserProfileLoader.ts:434-443` | **YES**, but only `status: 'active'` — `activeStrategiesBlock()` → `services/trade/chatSurfaceTurn.ts:127` and `components/trade/TradeChatPanel.tsx:446` | **YES**, if approved — `rankedMatchedSkills` → `MemoryRetrievalService.ts:226`; plus the always-present index `tradeChatContext.ts:354` |
| Enforcement | none | none (a plan is guidance only) | yes in principle (`confirmedAvoidForSetup` `:3943`, `applyNotebookSkillsToAnalysis` `:3819`) — but the latter has **zero production callers** |
| Evidence ledger | none | `wins`/`losses` fields exist on the file, no writer found | W/L, netR/grossR, R-sample, control group, override group, regime split, birth-claim, eval verdict |
| Guards | none | none (status only) | worth gate, graveyard, idle lifecycle, consolidation, tombstone cooldown, library cap, CI gate, eval demotion |

**Answer: the SKILL is the only belief type that influences a live turn with real machinery behind it.** The STRATEGY is a live prompt block but carries no evidence machinery — it is guidance a seat is told to follow, and nothing measures whether following it worked. The RULE store is a corpse kept alive by a load-and-save round trip and an export entry.

The two live surfaces used to disagree: the skills index was filtered by `isIndexableSkill` (retired/suspended/disabled/manualOnly/audience — **no approval check**), while the injection path was additionally filtered by `isApprovedSkill`. A skill that is unapproved but live was therefore **named** to the model and never **injected** — the model was told "APPLY any that match" about a rule it would never be given. This was reachable in practice: `ingestIfThenFromTrade` writes exactly such rows (`services/learning/SkillMemoryService.ts:3129` sets `prior: 'gated'` and no `approvedBy`).

**Fixed by `e6787a8f`.** The two filters are now one: both surfaces build rows through `skillIndexRow` (`services/learning/SkillMemoryService.ts:1020`), which carries `approved`, and `isIndexableSkill` refuses a row whose approval fact is false (`services/trade/tradeChatContext.ts:277`). A field the surfaces used each compute themselves cannot drift, so the projection is the seam — and `tests/promptContract.test.ts` asserts it on the wire, not on the row.

---

## 4. The skill proposal tool bug

### 4.1 Symptom

A model calls `propose_skill`. The call is accepted, the draft is queued, the transcript says *"Skill draft proposed — <name> (review with the Coach)"* — and the human who opens the Coach inbox sees a **bare IF/THEN with no evidence, on a rule that is scoped to a timeframe the model never got to state.** The proposal reads as an unexplained assertion from the model.

### 4.2 The trace

```
model call (desk turn)
  └─ services/analysis/DeskToolsService.ts:1052   name: 'propose_skill'
     properties  :1062-1076   (name, kind, description, coin, when, steps,
                               validate, output, approval, if_condition,
                               then_action, reason, predicate)
     required    :1077   ['name','kind','when','steps','if_condition','then_action','reason']
     additionalProperties : false  :1078
        │
        ▼
  executeDeskTool  services/analysis/DeskToolsService.ts:2478
     allow-list :2485  ·  cache :2495-2507  ·  switch :2514
        │  case 'propose_skill'  :2645
        ▼
  parseCraftedSkill  schemas/learning.ts (CraftedSkillSchema)
     args built at DeskToolsService.ts:2670-2689
        │  ← note: call.arguments.reason is NEVER read
        │  ← note: no timeframe, no source
        ▼
  deterministicDraftGate  services/learning/draftGates.ts:85
     :88 tombstone cooldown │ :91 pending dup │ :93 live coverage │ :96 IF/THEN bar
     :105 default description │ :106 default prediction
        ▼
  queueSkillDraft  utils/skillDrafts.ts:65
     write → localStorage `skill_drafts_v1:<user>` → read-back at :81
        ▼
  the trader sees it:
     components/chat/CoachThreadPanel.tsx:127-178  (DraftCard)
        :135 name   :139-140 IF → THEN   :143-144 coin · kind · "from trade …"
        :155-171 "Prove on history" · "Discard" · "Save as skill"
        NO evidence line, NO timeframe line
        ▼
  press Save → App.tsx:1988 coachAllowDraft
     → services/learning/skillApproval.ts:53 approveSkillDraft
     → services/learning/SkillMemoryService.ts:2931 ingestCraftedSkillFromDraftUnlocked
```

### 4.3 Root cause (three precise defects, all in the tool's own contract)

> **Status: A and C are FIXED (`e6787a8f`, 2026-10-23); B is fixed for
> `timeframe` only.** Everything below this block is the pre-fix analysis, and its
> line numbers are the pre-fix tree — kept because it is the evidence *for* the
> fix, not a description of it. What the tree holds now:
> - **A** — the handler reads the reason (`services/analysis/DeskToolsService.ts:2687`),
>   `CraftedSkillSchema` carries it (`schemas/learning.ts:153`), the ingest stamps it
>   (`services/learning/SkillMemoryService.ts:2977`), the serialiser writes it
>   (`:1325`) and the parser reads it back (`:726`), and the Coach card prints it as
>   its own line (`components/chat/CoachThreadPanel.tsx:143`). A proposal with no
>   `steps` is now refused (`DeskToolsService.ts:2668`) instead of being coerced into
>   the literal `["undefined"]`.
> - **B** — `timeframe` is a schema property the handler forwards
>   (`DeskToolsService.ts:2688`). `source` is deliberately still **not** a property:
>   it is learner-stamped provenance, and a model must not claim it.
> - **C** — `write` returns a boolean (`utils/learningQueue.ts:126`) and
>   `queueLearningProposal` yields `null` on a failed write (`:156`).
>
> Pinned by `tests/skillApprovalRoundTrip.test.ts` (draft → bytes → read-back, the
> missing-`steps` refusal, the failed-write `null`) and `tests/coachThread.test.tsx`
> (the card line). Each was proved red by disabling its guard, not only green by
> adding it.

**Defect A — the required evidence is silently discarded. (Primary.)**

- The schema makes `reason` **required**: `services/analysis/DeskToolsService.ts:1077` — *"Evidence from THIS session that motivates the skill"*.
- The handler never reads it: the whole `parseCraftedSkill` argument object is `DeskToolsService.ts:2670-2689` and contains **no** `reason`.
- `CraftedSkillSchema` has no `reason` field to put it in (`schemas/learning.ts`, `CraftedSkillSchema`).
- `SkillDraft` has no field for it (`utils/skillDrafts.ts:3-9`).
- The Coach card has no line for it (`components/chat/CoachThreadPanel.tsx:133-150`).
- **The sibling tool keeps its reason**: `revise_skill` puts `reason` into the proposal's human-readable `text` (`DeskToolsService.ts:2811`). So the codebase knows how to show a model's evidence — `propose_skill` just does not.

**Defect B — the tool's schema is narrower than the craft it produces, and `additionalProperties: false` turns the difference into a hard failure.**

- `CraftedSkillSchema` accepts `timeframe` and `source` (`schemas/learning.ts`; the writers read them at `services/learning/SkillMemoryService.ts:2962-2963`).
- The `propose_skill` schema does **not** list them (`DeskToolsService.ts:1062-1077`), and it sets `additionalProperties: false` (`:1083`). A model that tries to send `timeframe` gets the whole tool call rejected by the provider, not a field-level error.
- The consequence is not theoretical: `components/chat/CoachThreadPanel.tsx:105` replays the draft on `d.crafted.timeframe || '1h'` — so **every chat-proposed skill's "Prove on history" replays the 1h tape, whatever chart it came from**, while the chart-scan path (`services/learning/chartScanSkills.ts:309`) and the post-mortem path do carry a timeframe. The `source` provenance field is likewise always empty for a chat proposal, so the catalogue cannot distinguish a chat rule from a book rule.
- Note also that `steps` is declared `type: 'string'` ("JSON array of the procedure steps", `:1068`) while the handler defensively accepts an array (`:2657`) — a strict provider rejects the array the handler is written to tolerate. The handler branch is dead code against a strict schema.

**Defect C — the same "success shape for a failed write" class that was fixed for drafts was never fixed for proposals.**

- `utils/skillDrafts.ts:52-60` `write` returns a boolean and `queueSkillDraft` returns `SkillDraft | null` with a read-back (`:76-81`) — fixed in `121bd1df` ("a proposal write that failed now fails, instead of returning a success shape").
- `utils/learningQueue.ts:121-126` `write` still **swallows every error**, and `queueLearningProposal` (`:136-149`) returns the row regardless. So every proposal-queueing caller — `revise_skill` (`DeskToolsService.ts:2791-2809`), the hygiene demotions (`memoryHygiene.ts:176`, `:315`, `:364`), the contradiction sweep, the revival cards — can report "proposed: true" for a write that never landed.

**Defect D (minor, cosmetic) — the card's provenance line is nonsense for a chat proposal.** `components/chat/CoachThreadPanel.tsx:149` prints `from trade {d.tradeId.slice(0, 8)}…`; a `propose_skill` draft's tradeId is `chat:<coin>|<kind>|<ifCondition>` (`DeskToolsService.ts:2704-2707`), so the trader reads *"from trade chat|avoid|…"*.

### 4.4 Blast radius

- **Every** model-proposed skill (there is no other route into the inbox from a model): the human approves a rule with no stated evidence, against a tool schema that *forced* the model to write that evidence and then threw it away.
- Every model-proposed skill's history replay runs on the wrong timeframe (Defect B).
- The approval inbox can be filled with unexplained rules — the exact "the harness manufactures beliefs nobody signed" failure the rest of this codebase is so careful about.
- Defect C is wider than `propose_skill`: it affects the whole `learningQueue` family, and it is the one place where the repo's own "a write that cannot land is reported" rule (`docs/app-flow.md` §G.8) is not honoured.

### 4.5 What the git history says

`git log -S'propose_skill' --oneline --all` returns 24 commits. The propose_skill-relevant ones:

| Commit | Status | What it did |
|---|---|---|
| `121bd1df` *fix(learning): a proposal write that failed now fails…* | **landed** | `queueSkillDraft` now returns `SkillDraft \| null` + read-back; `proposeStrategy` rejects an empty slug. **Did not touch `utils/learningQueue.ts`.** |
| `bbaae74a` *fix(skills): approving a draft no longer reports success for a write that never happened* | **landed** | the read-back in `services/learning/skillApproval.ts:83-88` |
| `724882a6` *test(mock): opt-in scripted propose_skill call, off by default* | **landed** | `scripts/mock-provider.cjs:43-104` — the mock can now emit a `propose_skill` tool call (`MOCK_TOOL_CALL=1` or the `PROBE_TOOL_ROUND` marker at `:72`) |
| `97317a5b` *test(probe): the mock never streamed its tool call…* | **landed** | `scripts/mock-provider.cjs:178-194` `streamToolCall` — the SSE frames a real provider sends |
| `a6e007ef`, `bddf1535` | landed | the skill-approval probe (WIP → happy path green) |
| `2f0467c4` *feat(learn): a skill's description becomes the activation key retrieval scores* | **landed** | added the `description` property to the tool (`:1065`) |

**No fix is pending for the three defects above.** The two fixes that landed fixed the *write* half of the path; nobody has fixed the *content* half (the dropped `reason`, the missing `timeframe`/`source`, the swallowed proposal-queue write).

### 4.6 The known-good path, and the gap in the gate that should have caught it

`npm run skill-approval-probe` (`package.json` → `node scripts/probe-skill-approval.cjs`) drives the **HUMAN ACTUATION** path only, and its own header says so (`scripts/probe-skill-approval.cjs:7-11`):

> *"The mock provider emits no tool calls, so `propose_skill` itself cannot be reached from a model turn yet (that is the next pass); a draft is therefore seeded with the exact bytes `utils/skillDrafts.ts` writes, which exercises everything DOWNSTREAM of the inbox — the part that was broken: `coachAllowDraft` → `approveSkillDraft` → notebook write → `skillApprovalToast`."*

The probe seeds `skill_drafts_v1:<user>` directly (`scripts/probe-skill-approval.cjs:40`, `:148-152`) and presses the real button (`:260-297`). Its five cases cover: happy path, slug collision → `-2.md`, duplicate → "Already learned", a failed notebook write → "Not saved" + the draft survives, and a `revise_skill` rescope applied by hand (`:445-512`).

**So the known-good path is: draft bytes → inbox → Save → notebook bytes → honest toast. The half that is *not* gated is the half above it** — the tool's argument parsing, the zod clause bar, `deterministicDraftGate`, and the queue write. The mock can now drive that half (`scripts/mock-provider.cjs:43-104`), but the approval probe does not use it: `scripts/probe-skill-approval.cjs:327-329` starts the mock **without** `MOCK_TOOL_CALL=1`. The only browser coverage of a real `propose_skill` call is the **render** probe (`scripts/render-probe.cjs:685-699`), and that asserts the **transcript row** ("a tool round is projected as a tool line" + "the tool line names the call the model actually made") — it never asserts that a draft reached the inbox, and it never presses Save on one.

**That is why Defect A and Defect B survived:** they are in the segment between the tool call and the inbox, and the only browser gate in that segment asserts a *label*.

### 4.7 What a fix would touch

1. `services/analysis/DeskToolsService.ts:1062-1077` — add `timeframe` (and optionally `source`) to the schema, and change `steps` to `oneOf: [string, array-of-string]` so the handler's array branch (`:2657`) is reachable.
2. `services/analysis/DeskToolsService.ts:2670-2689` — carry `reason` into the craft; add `reason` to `CraftedSkillSchema` (`schemas/learning.ts`) and to `SkillDraft` (`utils/skillDrafts.ts:3-9`); render it on the card (`components/chat/CoachThreadPanel.tsx:133-150`).
3. `utils/learningQueue.ts:121-149` — make `write` return a boolean and `queueLearningProposal` return `null` on failure, exactly as `utils/skillDrafts.ts:52-81` already does; fix the `revise_skill` receipt at `services/analysis/DeskToolsService.ts:2807-2809` accordingly.
4. `services/analysis/DeskToolsService.ts:2704-2707` — give the draft a `tradeId` the card can render (e.g. `chat:<coin>|<kind>` plus a separate "proposed in chat" label) instead of a slice of the trigger key.
5. `scripts/probe-skill-approval.cjs` — start the mock with `MOCK_TOOL_CALL=1` and add a case that asserts **a draft landed in `skill_drafts_v1:<user>`** after a model turn, and one that asserts the draft carries the model's `reason` and `timeframe`.

---

## 5. Guards that stop bad content accumulating

| Guard | Runs? | Effect | Verdict |
|---|---|---|---|
| **Worth gate** (`evaluateSkillWorth`, `skillWorthGate.ts:81`) | **YES** — `draftGates.ts:211` (evidence tier) and `SkillMemoryService.ts:3749` (cluster path). Requires a ready provider; without one the cluster stays eligible but the attempt ledger stops a per-close re-bill (`:3727`, `utils/skillDrafts.ts:219`) | LLM judges create / merge / skip against the catalog, the bot's memory and the graveyard; a `create` **without a falsifiable prediction is refused** (`skillWorthGate.ts:67`); a `merge` folds the outcome into the named skill instead of minting a twin (`draftGates.ts:224`) | **REAL** |
| **Graveyard + revival** (`skillGraveyard.ts`) | **YES** — tombstones written on every retirement/absorption (`SkillMemoryService.ts:3269`, `:3309`, `skillIdleLifecycle.ts:328`); the block is injected into the worth gate (`skillWorthGate.ts:105`); `findArchiveTwin` runs on every creation path (`SkillMemoryService.ts:2825`, `:2717`, `:3093`) | A retired twin raises a **REVIVAL card** instead of a fresh skill; re-entry rules are per reason (`:224-242`) | **REAL** |
| **Graveyard retention sweep** (`runGraveyardSweep`, `skillGraveyard.ts:189`) | **YES** — `memoryHygiene.ts:244` | Enforces the store's own newest-40 boundary; collects malformed/duplicate rows. **It revives nothing and expires nothing by age — by design** (`:180-187`) | **REAL** (narrow by design) |
| **Idle lifecycle** (`runSkillIdleSweep`, `skillIdleLifecycle.ts:264`) | **YES** — `memoryHygiene.ts:269`, inside its own try/catch (`:267-274`) so a network error cannot skip the rest of the pass | Suspends at 90 idle days (`enabled:false` + `suspendedAt`), archives at 180 into `skills-archive/` **with a tombstone**; revives on its own if the trigger matches again (`:308-316`). It is exempt for book seeds, retired/superseded rows, `hurts` evals and open shadow windows (`:205-224`) | **REAL** |
| **Consolidation** (`consolidateSkills`, `SkillMemoryService.ts:3323`) | **YES** — on **every** settlement (`:3822`) and under byte pressure (`memoryHygiene.ts:230`) | Merges exact-duplicate triggers (W/L re-derived from the deduped trade-id union, `:3165-3176`); archives the losers **with a tombstone saying where the evidence went** (`:3219-3241`); sweeps retired skills into the archive (`:3244-3275`) | **REAL** |
| **Tombstone cooldown on rejected drafts** (`utils/skillDrafts.ts:96`, `:127`, `:138`) | **YES** — `App.tsx:1992-1998` `coachDenyDraft` | A discarded trigger stays quiet for 7 days, so the same idea cannot be re-queued every session | **REAL** |
| **Pending-duplicate skip** (`draftGates.ts:91`) | **YES** | Two drafts with the same (coin, kind, IF) cannot both sit in the inbox | **REAL** |
| **Live-coverage skip** (`draftGates.ts:93` → `skillClauseBar.ts:71`) | **YES** | A draft whose trigger is already covered by a live skill is refused. Coin agreement is checked **first** (`:94`) so a BTC skill cannot suppress an ETH draft | **REAL** |
| **IF/THEN sanity bar** (`skillClauseBar.ts:25`, `CLAUSE_MIN_LENGTH = 12`) | **YES** — `draftGates.ts:96`, `SkillMemoryService.ts:3090` | A clause under 12 chars or a generic one ("be careful", "manage risk") is refused — and the number is declared once in the schema (`schemas/learning.ts`, `CLAUSE_MIN_LENGTH`) so the two checks cannot disagree | **REAL** |
| **Library cap + displacement** (`checkLibraryCapAtGate`, `SkillMemoryService.ts:3364`) | **YES** — `SkillMemoryService.ts:3777`, `:3097` | At the cap, creation becomes comparative and the displacement rides the human queue | **REAL** |
| **Status ladder / CI gate / decay** (`deriveStatus`, `SkillMemoryService.ts:1871`) | **YES** — re-derived on every evidence pass | Promotion needs a Wilson CI gate, a met birth-claim and expectancy support; a decayed recent window demotes; a `hurts` eval pins at candidate | **REAL** |
| **Veto-cost and negative-lift demotions** (`memoryHygiene.ts:302-332`, `:345-381`) | **YES** — but **only a proposal**, never a write | An avoid skill whose settled vetoes keep costing winners, and a skill whose setups got worse once it was injecting, are queued as `demote` proposals. They reach the supervisor/human, not the notebook | **REAL** (as proposals) |
| **Stale-skill demotion proposal** (`memoryHygiene.ts:164-186`) | **YES** — proposal only | A confirmed skill with no counted evidence for 2 quarters gets a `demote` proposal. **The proposal is not auto-applied**, so a stale confirmed skill keeps occupying an index slot until a human or the supervisor acts | **PARTIAL** (proposal-only) |
| **Approval gate** (`isApprovedSkill`, `SkillMemoryService.ts:999`) | **YES** — `MemoryRetrievalService.ts:226` | Nothing model-generated reaches a seat's prompt without a human yes | **REAL** — and since `e6787a8f` the *index* applies it too (`tradeChatContext.ts:272`), so an unapproved skill can still be **named** to the model |
| **Hard `avoid` veto / candidate cap / confidence downgrade** (`applyNotebookSkillsToAnalysis`, `SkillMemoryService.ts:3863`) | **NO** — zero production call sites | Nothing | **COSMETIC / DEAD** |
| **Predicate confidence ceiling** (`skillPredicateGate.ts:200`) | **computed, then dropped** — the note renders the number as prose (`:216`) | The recorded probability is never capped by the fired avoid predicate | **COSMETIC** (the note itself is real) |
| **Memory consolidation / insight pruning** (`MemoryConsolidationService.ts`) | **NO** — no importer | Nothing (`AlgorithmicMemoryService` has its own copies) | **COSMETIC / DEAD** |
| **Learning-rules store as a guard** | n/a — it is not a guard, it is a store with **no reader** | Nothing | **COSMETIC** |
| **Notebook byte budget** (`utils/memoryBudget.ts`) | **YES** — `MemoryFilesService.notebookPressureAllows`; pressure also shortens the hygiene interval (`memoryHygiene.ts:123`) | Refuses *growth* at the trigger tier and all model notes at the hard cap. **It never evicts** — nothing in that store is proven regenerable (by design) | **REAL** |
| **ε-holdout** (`utils/skillHoldout.ts`) | **YES** — `MemoryRetrievalService.ts:883`, `skillPredicateGate.ts:147` | Withholds skill treatment from ~10 % of runs so the control group keeps growing; a control run gets no skill guidance anywhere | **REAL** |

**Summary of the guard table: 18 of the 22 guards genuinely run and bite. The four that do not are all in the "deterministic enforcement" family — the hard veto, the predicate ceiling, the insight pruner, and the rules store — and all four were already named as open items in the repo's own register (O-11, O-13, O-30, and the cleanup manifest).**

---

## 6. The weekly / monthly digest — real or cosmetic?

**REAL.** Full trace:

- **Trigger.** A 15-minute heartbeat plus a `visibilitychange` wake-up (`hooks/useLearningHeartbeat.ts:40`, `:70-74`), and once at boot from the profile loader (`hooks/useUserProfileLoader.ts:410`, `:416`, `:427`). The due-checks live in the passes themselves: `isWeeklyReviewDue` (`weeklyReview.ts:113`), `isMonthlyReportDue` (`monthlyReport.ts:308`), `isWeeklyRollupDue` (`weeklyRollup.ts:50`), `isHygieneDue` (`memoryHygiene.ts:118`).
- **What it reads.** Closed trades in the window (`buildWeekStats`, `weeklyReview.ts:68` — filtered to WIN/LOSS within 7 days), discipline analytics, the measured R (`effectiveRMultiple`), the injection ledger for lift/economics (`monthlyReport.ts:328`, `:350`), the skill catalog, the settled beliefs, the graveyard.
- **What it writes.**
  - *Weekly*: one digest in Preferences `weekly_review_v1_<user>` (`weeklyReview.ts:152`) = deterministic stats + **exactly one** model-written impulse + the meta-calibration ratios (`:150`).
  - *Monthly*: one card in `monthly_report_v1_<user>` (`monthlyReport.ts:332`) = what happened / what was learned / what needs attention / the panel scoreboard.
  - *Rollup*: settled beliefs (`weeklyRollup.ts:99`), generalized coin-less skills (`:113`), and `profile/rollup-notes.md` (`:139`).
  - *Hygiene*: a 20-line log in `memory_hygiene_v1_<user>` (`memoryHygiene.ts:139-145`).
- **Does anything show it to the trader?** **Yes.**
  - The weekly digest is a **Journal card**: `components/journal/WeeklyReviewCard.tsx:13` reads the stored digest and renders the impulse, the week stats and the meta-calibration ratios; mounted at `components/journal/Journal.tsx:192`.
  - The monthly card is mounted at `components/journal/Journal.tsx:193` (`components/journal/MonthlyReportCard.tsx:13`).
  - The hygiene log is rendered by the **Health tab** (`components/learn/MemoryHealthCard.tsx`) and the pass can be run on demand from there (`MemoryHealthCard.tsx:81` `runMemoryHygiene`).
  - The rollup's output is *not* a card — it is the settled-beliefs block, which is an **always-on prompt slot** above the doctrine (`MemoryRetrievalService.ts:947-956`) and the rollup notes, which the doctrine rewriter reads next pass.
- **Gates that keep it from being noise.** A digest needs ≥ 3 closed trades (`MIN_CLOSED_TRADES_FOR_REVIEW = 3`, `weeklyReview.ts:40` — one shared constant, so the weekly and monthly cannot disagree) **and** a ready provider (`:137`); the monthly card is purely deterministic (no LLM at all). The weekly prompt demands **exactly one** falsifiable behaviour change, not a lecture (`weeklyReview.ts:102-110`).
- **What is weak.** The weekly impulse is the one part that is model-written and un-verified — nothing checks that the trader acted on it, and there is no second digest showing whether last week's impulse was followed. The monthly card is the stronger of the two because it is deterministic.

---

## 7. How a settlement becomes a new rule — the full trace

```
TRADE CLOSES  (the autopilot resolves it; the row is written)
  └─ hooks/useTradeLogging.ts:524  void (async () => {
        │
        │  ── STEP 1: the ONE model call ──────────────────────────────────
        ├─ reflectOnClosedTrade(loggedTrade, { username, injectedSkills })
        │     services/learning/settlementReflection.ts:239
        │       :249  a trader's own note ≥40 chars ALWAYS wins  → skip('already-written')
        │       :253  only WIN/LOSS rows are asked about
        │       :260  tradeAdmitsTechnicalStrategyRule — an execution slip / macro shock
        │              / ENTRY_NOT_HIT is not asked about (the gate would refuse it anyway)
        │       :272  no provider → skip('no-provider')
        │       :279  session guard: one call per (user, trade id)
        │       :175  reflectionPacket — the ROW and nothing else:
        │              symbol, direction, outcome + resolution source, levels,
        │              R gross/cost/net (slippage labelled NOT modelled), MAE/MFE,
        │              benchmark alpha, regime + its source, the pre-trade gate's
        │              refusal/cautions, plan adherence, the skills injected on that turn
        │       :295  the prompt (registry id 'learning.settlement_reflection')
        │       :306  {"noLesson":true} / malformed → skip('declined-or-malformed')
        │       :307  ⇒ trade.postMortem = renderPostMortem(r)  ← THE WRITER
        │              services/learning/settlementReflection.ts:214
        │              "Post-mortem written by the app at settlement (model)…"
        │              "Lesson: …"
        │              "IF … THEN …."
        │       :321  transport failure → skip('failed') — NOTHING is written
        │
        │  ── STEP 2: the notebook folds the row ───────────────────────────
        └─ syncClosedTradeToNotebook(settledTrade, allTrades, user, origin)
              services/learning/SkillMemoryService.ts:3664
              :3641  appendDiaryEntry               → trader-diary/
              :3642  syncRecurringMistakes          → rules/recurring-mistakes.md
              :3643  applySkillEvidence              → every matching skill's ledger
              :3644  ingestIfThenFromTrade           → the IF/THEN clause → a skill FILE
              :3647  strategyRegimeMatrix.recordSettledTradeForMatrix
              :3662  if the cluster ≥ MIN_CLUSTER_FOR_SKILL (10):
              :3705    evaluateSkillWorth  → create | merge | skip
              :3705    → 'create' → maybeUpsertSkill   (SkillMemoryService.ts:2670)
              :3726      validateCraftedSkill — a create WITHOUT a prediction is refused
              :3733      checkLibraryCapAtGate — at the cap, a displacement proposal instead
              :3747    → 'merge' → maybeMergeSkill  (SkillMemoryService.ts:2603)
              :3778  consolidateSkills — exact duplicates merged, retired rows archived
              :3787  consolidateDoctrine — profile/doctrine.md rewritten
              :3797  runDueSkillEvalWithDefaultRunner — the A/B eval (detached)
```

**Two routes out of the same post-mortem text, with very different fates:**

| Route | Writer | Gate | Result | Fates |
|---|---|---|---|---|
| **A. IF/THEN auto-ingest** | `ingestIfThenFromTrade` (`SkillMemoryService.ts:3040`) | `validateIfThen` (`:3090`), `coveredByLiveSkill` (`:3092`), archive twin → revival card (`:3093`), library cap (`:3097`) | writes `skills/<slug>.md` **directly, unattended** (`prior: 'gated'`, **no `approvedBy`**, `:3129`) | **Starved.** `isApprovedSkill` is false → `MemoryRetrievalService.ts:226` blocks injection. It used to be *named* in the index anyway; since `e6787a8f` the index applies the same approval filter (`services/trade/tradeChatContext.ts:277`), so a gated skill is neither named nor given. It can never earn evidence, so it can never confirm. (The repo's own O-31 / `docs/app-flow.md:876` calls this "starved, not deleted" — **and it is still true in code after E-57 §1 gave the leg its writer back**.) |
| **B. Post-mortem craft → draft → human** | `craftSkillFromPostMortem` (`services/learning/SkillCraftService.ts:140`) → `gateEvidenceBackedDraft` (`draftGates.ts:199`) → `queueSkillDraft` | the FULL worth gate (`:211`) + `validateCraftedSkill` (`:230`) | a **pending draft** in the inbox | **Alive.** A human presses Save → `approveSkillDraft` → an approved, injectable, zero-evidence skill labelled a hypothesis, which then earns its sample through the FOLLOWED branch of `applySkillEvidence`. Called from `services/agents/botLearning.ts:234` on every closed bot trade. |

**So: a settlement does turn into a new rule — but only through route B (a human press) or route A (a file the model will never be given).** Route A is the one the closed-trade loop actually runs unattended, and it produces the weaker artefact.

---

## 8. Weak spots

1. **The post-mortem → skill leg produces a file nobody can use.** `ingestIfThenFromTrade` writes `prior: 'gated'` and no `approvedBy` (`services/learning/SkillMemoryService.ts:3129`), so `isApprovedSkill` (`:999`) is false and `MemoryRetrievalService.ts:226` withholds it from injection — while `isIndexableSkill` (`services/trade/tradeChatContext.ts:277`) now applies the
same approval fact, so a rule the model will never be given is no longer named to it. Route B (the draft) is the only route that actually reaches a model, and it needs a human press.
2. **~~The `propose_skill` tool's contract is lossy in three places~~ — FIXED `e6787a8f`.** The required `reason` now reaches the draft, the card and the skill file; `timeframe` is a schema property; and the proposal queue reports a failed write as a failure (`utils/learningQueue.ts:126/:156`). `source` remains absent on purpose — a model may not claim learner provenance. The segment between the tool call and the inbox is still covered only by unit tests: `npm run skill-approval-probe` SEEDS the draft bytes, so it proves the approval side, not the call side (§4.6).
3. **The deterministic enforcement half of the skill system is dead.** `applyNotebookSkillsToAnalysis` (`SkillMemoryService.ts:3863`) has zero production callers, and the predicate ceiling (`skillPredicateGate.ts:200`) is computed and rendered only as prose. The prompt can *ask* for a skill to be applied; the code cannot *require* it.
4. **~~The index and the injection path disagree about what a skill is~~ — FIXED `e6787a8f`.** Both now read one projection (`skillIndexRow`, `services/learning/SkillMemoryService.ts:1020`) and the index filter (`services/trade/tradeChatContext.ts:277`) applies the approval fact the injection already enforced. The row's approval field is *optional*, so a caller that omits it fails open — which is why both surfaces go through the one projection instead of mapping `listSkills()` themselves.
5. **The learning-rules store is a corpse with a backup.** `learning_rules_v2_<user>` loads, saves, exports and round-trips (`StorageService.ts:105`, `useUserProfileLoader.ts:434-443`) and has **no prompt reader**. The code itself says so (`useTradeLogging.ts:194-199`). It costs a user-visible export entry and creates a second "where do my rules live?" answer.
6. **Two whole modules are orphans.** `services/learning/MemoryConsolidationService.ts` and `services/learning/providerFitness.ts` have no production importer (import-closure walk + grep). The first contains the only Levenshtein in the repo; the second computes a score that is thrown away.
7. **The prompt A/B lane and the analysis-pipeline retrieval are severed.** `getPrompt` has no call site on the path that answers the trader (repo O-140), and `analyzeTradingViewWithTransientRetry` has no caller — which is the function that assembles the memory-injection context with `evaluateSkillPredicates` (`hooks/useAnalysisPipeline.ts:1101`). The predicate note therefore reaches the desk through `services/trade/proposalGate.ts:263` but the full retrieval assembly may not.
8. **The weekly impulse is unverified.** It is the only model-written artefact in the digest pipeline and nothing measures whether the trader acted on last week's.
9. **The `SkillMeta` surface is enormous** (~40 fields, `SkillMemoryService.ts:108-440`) for a format the Agent-Skills spec says carries two. A database row wearing markdown — the repo's own O-38.
10. **A second "where do I approve this?" answer still exists in a comment.** `components/learn/ActionApprovals.tsx:12-15` says a skill draft is saved in "Learn → Approvals"; the tab is actually labelled "Approvals" and holds the Coach tab id `coach` (`components/learn/LearnView.tsx:64`, `:47`), so the code is right and the comment reads as a third destination. `components/learn/ActionApprovals.tsx:30` also filters skill items out of the list, which is correct but leaves `collectApprovalItems` (`utils/approvalInbox.ts:99-108`) producing `kind: 'skill'` rows that no list renders — they exist only to feed the badge.

---

## 9. What is ALREADY GOOD

- **The approval gate is the strongest thing in this area.** `isApprovedSkill` (`SkillMemoryService.ts:999`) with a fail-closed write-side (`approvedBy` missing ⇒ the skill simply never activates), a one-time migration that **backs up before it stamps** (`services/learning/approvalMigration.ts:67`), and a revoke-on-rewrite path (`:1041` `revokeSkillApproval`, `:1067` `requestRewriteApproval`) that keeps the previous version *with its approval* so Revert restores a working rule rather than an inert one. The comment at `:982-998` — "approval is a separate fact a HUMAN action sets … a model approving its own queue is triage, not consent" — is the right principle, and the code honours it.
- **"A write that cannot land is reported" is a real, enforced convention.** `queueSkillDraft` returns `null` and reads the row back (`utils/skillDrafts.ts:76-81`); `approveSkillDraft` reads the library back and leaves the draft in the inbox on failure (`services/learning/skillApproval.ts:83-88`); `proposeStrategy` treats an empty slug as a failure (`services/learning/strategyStore.ts:329`); `MemoryFilesService.getNotebookWriteFailure` is the one place that knows a notebook write never reached disk; `rejectedResult` (`DeskToolsService.ts:2438`) makes a refusal a **failed** call, not a receipt. This is exactly the discipline most learning loops lack.
- **The supervisor is triage-only, and says so.** `skillSupervisor.ts:183-198` records the contract change in the code, with a per-hour window (`:461`) instead of the lifetime counter that used to silently disable supervision forever, and a triage ledger so a pass never pays twice for the same item.
- **The evidence join is honest.** Three-state adherence on an exact `runId` join (`MemoryInjectionService.ts:189`), with CONTROL outcomes routed to a separate counter (`:2002-2024`) and OVERRIDDEN ones to an amendment signal (`:2026-2046`). A skill's record reflects what it *shaped*, not what merely *matched*.
- **The net/gross discipline in the ledger is exemplary.** `netR` / `grossR` / `netRKnown` / `rSampled` are kept apart (`SkillMemoryService.ts:152-171`), a missing cost is never stored as zero, and the R ladder is the one cost model (`utils/netRiskReward.ts`).
- **Nothing is deleted; superseded beliefs stay queryable.** The temporal status ledger (`stampStatusTransition` `:1236`, `skillStatusAt` `:1264`) means a replay can ask what the system believed at any past instant, and `statusAtTime` (`MemoryRetrievalService.ts:190`) honours it at injection time too.
- **The graveyard does not forget, and it says where the evidence went.** The `absorbed` tombstone names the survivor (`skillGraveyard.ts:119-124`), so the next drafter consolidates into it instead of re-deriving the same trigger as a second skill.
- **The prompt assembly reads fresh every turn.** `surfacePromptWith` (`services/trade/chatSurfaceTurn.ts:110`) re-reads the notebook each turn, so an approved skill lands in the *next* turn's prompt without a reload, and the 30 slugs it prints are the 30 recorded on the row (`:115-120`) — one list, two homes.
- **The gates have a single owner each.** `CLAUSE_MIN_LENGTH` is declared in the schema because `utils/` may not import `services/` (`schemas/learning.ts`, `services/learning/skillClauseBar.ts:22-24`); `skillEnabledFlag` is the only place `enabled` is derived; `defaultDescription` and `defaultPrediction` are the deterministic mirrors of their LLM counterparts. This is the "one source of truth" discipline the repo's AGENTS.md demands, applied consistently.
- **The digest pipeline is deterministic where it can be.** The monthly card involves **no model at all**; the weekly impulse is capped at exactly one sentence and cannot be generated without ≥ 3 closed trades and a ready provider.
- **The settlement reflection writes nothing when it is unsure.** A decline, a malformed answer, a transport failure, a missing provider and a re-fire all write nothing (`settlementReflection.ts:306`, `:321`, `:249`, `:272`, `:279`) — "a gap in the notebook is better than a rule that was never earned."
- **The repo measures its own dead code.** `tests/featuresAreWired.test.ts` is a ratchet that follows the **import closure from the real entry roots**, not mere mentions — a stricter rule than most projects apply, and it is why the orphans in §8.6 are known rather than invisible.
