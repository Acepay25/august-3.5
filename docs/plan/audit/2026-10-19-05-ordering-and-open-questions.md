# Report 5 — The recommended order, go/no-go, open questions, and coverage

**Pinned commit:** `6a41a9f7e3b3986236c3000862d326f1e95dfad1` (branch `main`)
**Date:** 2026-10-19
**Output items 6–8 of the brief.**

---

## 1. The one-paragraph version

**Do not start the cleanup yet.** Two things are true at the same time: the repository is being
actively rewritten by another session (77 dirty paths at the time of writing, including the
deletion of the whole Analyst Lens layer), and **the roadmap's own next tranche is exactly the
cleanup this manifest describes** — the in-flight work is already removing the bot roster, the seat
personas, the debate envelopes and the lens prompts. **So the first move is not a batch: it is to
let the in-flight work land, re-anchor, and then re-run the sweep.** Everything below is sequenced
so that the cleanup and the roadmap waves do not collide, and so that the two *behavioural* items
that everything else depends on — the discarded context (F-01) and the missing cost model (F-13)
— are decided before the code around them is touched.

---

## 2. The recommended order

Three streams, interleaved. **W** = a roadmap wave, **C** = a cleanup batch.

### Phase 0 — STOP AND RE-ANCHOR *(no code changes)*

| # | action | why it comes first |
|---|---|---|
| 0.1 | **Let the in-flight session land.** It is deleting the bot roster, the seat personas, the debate envelopes, `types/bot.ts`, `utils/teamRoster.ts` **and the whole Analyst Lens layer** (`services/ui/AnalystLensService.ts`, `services/ui/EnsembleAnalystService.ts`, `services/ui/TradingStyleDetector.ts`, `services/learning/lensMemory.ts`, `constants/prompts/lensRolePrompts.ts`, `types/lens.ts`, `utils/thinkingLens.ts`, `hooks/useCatalogReconcile.ts`, `hooks/useLensAndEnsembleConfig.ts` + 11 deleted test files). | **The cleanup manifest's own HOLD list is waiting on it.** `AnalystLensService` alone is 9 dead exports that cannot be judged until the change lands. Cleaning the lens layer now would be cleaning a moving target. |
| 0.2 | **Re-anchor and re-run the four sweeps** — the import graph, the export sweep, the localStorage/Preferences census, and the dead-path comment scan. **The new HEAD is `56639b4b`; but the working tree carries 30 unstaged changes on top, so re-run against the worktree once the in-flight work lands, not against `56639b4b` alone.** |
| 0.3 | **Recover the previous audit's six markdown files from `508b691a`** to a durable location, and **do not delete `refs/cline/checkpoints/*`** until they are safe. | `git gc --prune=now` would destroy the only written record of the cost-model finding (G-01/G-02) and the `computeContractSize` finding (G-06). **This gets worse with time.** |
| 0.4 | **Decide `docs/analysis/`'s fate** — this session's six reports, and whether the next session's go there too. The eslint ignore already exists (`eslint.config.js:26`). | The directory is already expected by the build. Leaving the decision open is how the previous generation ended up in four dangling commits. |
| 0.5 | **Commit the lockfile fix** (1.0.30 → 1.3.0 + the `js-yaml` root block). One line. | It is the only *committed* state that is wrong about the manifest, and `npm ci` from a clean HEAD installs the 1.0.30-resolved set. |
| 0.6 | **Add `noUncheckedIndexedAccess`** — but as a **warning** first, not an error. | It is the highest-value missing compiler option and it will surface a real class of bug. A warning first means the build never goes red on an unread list. |

**Gate for Phase 0:** `npm run typecheck && npm run test && npm run lint` — plus the re-run sweeps
being diffed against the manifest's tables.

### Phase 1 — the two decisions that unblock everything *(owner rulings, not code)*

| # | decision | what it unblocks | proposed default |
|---|---|---|---|
| 1.1 | **What happens to the assembled context?** (F-01) — wire it, or cut it? | E-01, E-05, E-11, E-18, E-19, N-03, N-08, N-10, N-18, N-20 — **ten proposals** | **Cut it first (E-01b), then wire deliberately (E-01a) as a measured follow-up.** The pull path already exists; the push path's budget was never settled. And **flip `recordInjections` to default-false in the same change** (E-05), or the ledger keeps lying while you decide. |
| 1.2 | **Does the outcome need a human click?** (F-18 / G-04) | E-18, N-13, N-14, N-15, N-16, N-20 — **six features**, every one of them **[DATA-GATED]** | **Automatic with provenance and a correction path — and a shadow month first** (resolve, show, do not record; report the disagreement rate). **This is the highest-leverage decision in the repository, and it is not a code change.** |

**Neither decision requires a commit.** Both require the owner.

### Phase 2 — the cheap, safe correctness wins *(the cleanup's front)*

| # | batch | items | go/no-go |
|---|---|---|---|
| 2.1 | **C-1 + C-2 merged** — stale copy and comments, and the two orphan files that are unambiguous | the 8 dead-file-path comments · the user-visible debate/moderator strings · the dead CSS · `@fontsource/inter` + the `'Inter'` fallback · `AvoidSetupsSection.tsx` · `formatHarnessNotesBlock` (function only) · the 6 dead `debateMarkers` · the 3 dead `learningPrompts` constants · the `AGENTS.md` fixes · the `PRIVACY.md` fixes | **GO** — but **after 0.1** (the in-flight tree changes which strings are stale) |
| 2.2 | **E-21** — the CSP's unused remote origins | one file, three lines | **GO** — and it is the cheapest security win in the report. **Verify with a build + boot-probe.** |
| 2.3 | **E-29** — delete the 8 dead disable directives, set the cap to 674, fix the "28" → 13 | three edits | **GO** — and it is a **prerequisite for 2.1**, because every dead import removed lowers the count and the cap must be lowered in the same commit. **Do 2.3 first.** |
| 2.4 | **E-22** — surface the backup and pattern-memory failures | two call sites + the Health tab | **GO** |
| 2.5 | **E-26 + E-16** — one ticker, not 400; the 1-second clock | two components | **GO** |
| 2.6 | **E-26b** — `trade_sidebar_open_v1` + `agent_threads_opened_v1` → the RAW list (the two that are on **neither** decision table) | two list entries | **GO — with the owner's eye**, because the WebView quota is shared. These two are the *un-recorded* instance of the recorded class. |
| 2.7 | **E-06** — the bundle ratchet: 2,600 kB → ~1,400 kB, plus a self-ratcheting step | two files | **GO** |

**Phase 2 gate for every item:** `npm run typecheck && npm run lint && npm run test` — **plus
`npm run render-probe`** (the copy and the formatter changes touch rendered text on ≥8 surfaces,
and render-probe is the only gate that can see rendered text) — **plus `npm run boot-probe`** for
2.2 — **plus `npm run check-flow-doc-anchors`** if any doc anchor moved.

### Phase 3 — the roadmap's own wave, and the two behavioural corrections

**W3.1 — the roadmap wave that is already in flight.** Let the concurrent session's deletions land
and their tests be written. **The roadmap's G-37 is explicit about the missing test: *"no test
covered the seeding, so removing it turned nothing red — that silence is evidence nothing was
watching, not evidence the feature was inert."* Write that test.**

**W3.2 — the R:R correction (E-02).** One formula, three call sites. **Before** this, run the
replay over the stored trades and diff the old and new verdicts. If the diff is large, the gate's
behaviour is changing, and that needs the trader's eyes, not a code review.

**W3.3 — the cost model (E-03).** The fee tier must be **the trader's setting**, not a hardcoded
exchange rate. Without that, the number is an assumption wearing a number's clothes.

**W3.4 — the prompt contract test (E-11).** Four tests, one per model-call path, asserting what is
**sent**. **This is the gate that would have caught F-01, F-09, F-10 and E-09.** It should land
*before* the context decision is implemented, so the decision has teeth.

**W3.5 — the re-home of the position sizing (E-12).** `utils/ticketSize.ts` → the proposal card
and the journal. **It has zero production call sites and two test files that keep it alive — the
green suite is the only thing making anyone believe it is wired.**

**W3.6 — the docs restructure (C-7).** The eight documents to write, the eighteen to archive, and
the `app-flow.md` repair (§8.2 of Report 4). **Do it after 2.1**, because 2.1 fixes `AGENTS.md` and
`PRIVACY.md`.

### Phase 4 — the big bets, in dependency order

| # | bet | precondition |
|---|---|---|
| 4.1 | **E-19 — one plan object** | after W3.2 (one R:R formula) and W3.4 (the contract test) |
| 4.2 | **E-37 (raise the evidence floors) + E-38 (the validity window) — MUST land with 4.3, not after it** | see §7.4: fixing the outcome loop first manufactures three-trade skills and two-trade vetoes, and the "net expectancy" claim is worthless while the denominator excludes `ENTRY_NOT_HIT` |
| 4.3 | **E-05 → the ledger becomes honest** → **E-18** (the loop closes) | after 1.1, 1.2 **and 4.2** |
| 4.3b | **E-35 — reconnect the deterministic skill enforcement** (`applyNotebookSkillsToAnalysis`, `predicateGate.ceiling`, the veto ledger) | after 4.2 — the hard veto must not be re-enabled before the floors are raised |
| 4.3c | **E-40 — the journal's date semantics** · **E-39 — decide at `high` effort** · **E-03 — the cost model, at the APPROVED 5 bps taker / 2 bps maker with a "slippage not modeled" label** | after 4.3 (they need settled rows and recorded prompts to be measurable) |
| 4.3e | **E-01 — fix the context: inject and record together, or neither.** **(1) inject the harness contract** (1,582 chars — the confidence ladder, the risk rules, the `HARNESS_TURN_MARK` convention); **(2) cut the retrieved context by default**; **(3) flip `recordInjections` to default-false** in the same change, or the ledger keeps recording skills the model never saw. | 0.4, and after 4.2 |
| 4.3d | **E-24 — `electron/main.cjs` behavioural coverage** | after Phase 2 (so the CSP and the sender-frame guard are already in) |
| 4.4 | **E-20 — the replay harness** (headline use case: **the deterministic baseline** — "has anyone asked whether the model beats a fixed rule?") | after W3.2 — it is the measurement instrument for it |
| 4.5 | **E-23 — the notebook's recovery affordance** | **the only batch here with a data-migration risk.** Do it with a sidecar, never in place. |
| 4.6 | **E-44 — break the notebook out of one blob** | after 4.5. **This is the one item where a bug loses the trader's own thinking.** |
| 4.7 | **N-01 … N-20** (Report 3) | the **[DATA-GATED]** ones wait for 4.2 |

### Phase 5 — the things that need the owner, and the things that need a decision to be made

| # | item | what is needed |
|---|---|---|
| 5.1 | **E-14 / the backup lists** (`approval_rules_v1`, the 5 restore-listed-but-not-RAW namespaces) | an **owner decision** on what should be in a backup. The repo's own test says *"worth a decision"* and the decision was never taken. |
| 5.2 | **E-03's fee tier** | the trader's real numbers |
| 5.3 | **E-44's notebook sharding** | a decision on whether one blob is acceptable |
| 5.4 | **The `fullscreen` branch, the two rails, the HUD wording, the 23 owner decisions** | the owner |
| 5.5 | **The history rewrite** (52 MB of APKs) | a coordinated decision at a release boundary, with the remote branches deleted first |

---

## 3. Go / no-go per batch

| batch | go? | condition | the gate that must pass | rollback |
|---|---|---|---|---|
| **0** — protect, re-anchor, recover | **GO, now** | none | `npm run typecheck && npm run test && npm run lint` | additive; `git revert` for the lockfile |
| **1** — the two owner decisions | **GO** | the owner's answer | none (a decision) | n/a |
| **2.1** — stale copy, comments, two orphan files | **GO, after 0.1** | the in-flight tree has landed and the sweep has been re-run | `typecheck` · `lint` · `test` · **`render-probe`** · `check-flow-doc-anchors` | `git revert` |
| **2.2** — the CSP | **GO** | — | `typecheck` · `lint` · `test` · **`build`** · **`boot-probe`** | `git revert` |
| **2.3** — the lint ratchet | **GO — FIRST in Phase 2** | — | `lint:loose` → expect 674 · `lint` → expect 0 | `git revert` |
| **2.4** — surface the swallowed failures | **GO** | — | `typecheck` · `lint` · `test` | `git revert` |
| **2.5** — one ticker | **GO** | — | `typecheck` · `lint` · `test` · **`render-probe`** | `git revert` |
| **2.6** — two backup namespaces | **CONDITIONAL GO** | the owner's eye on the quota | `typecheck` · `lint` · `test` · **the 5 export suites** | `git revert` |
| **2.7** — the bundle ratchet | **GO** | — | `build` · the ratchet step | `git revert` |
| **3 (W3.2)** — one R:R | **CONDITIONAL GO** | the replay diff is reviewed | `typecheck` · `lint` · `test` · `test:coverage` · **`render-probe`** | `git revert` |
| **3 (W3.3)** — the cost model | **CONDITIONAL GO** | the fee tier is the trader's setting | `typecheck` · `lint` · `test` · `test:coverage` | `git revert` + a migration for the new columns |
| **3 (W3.4)** — the prompt contract test | **GO** | — | `typecheck` · `lint` · `test` | `git revert` |
| **3 (W3.5)** — the sizing re-home | **CONDITIONAL GO** | the trader's override path exists | `typecheck` · `lint` · `test` · **`render-probe`** | `git revert` |
| **3 (W3.6)** — the docs restructure | **GO, after 2.1** | — | **`check-flow-doc-anchors`** (the primary gate) | `git revert` |
| **4.1** — one plan object | **CONDITIONAL GO** | W3.2 + W3.4 landed | everything above | `git revert` |
| **4.2** — the loop closes | **CONDITIONAL GO** | decisions 1.1 and 1.2 made | `typecheck` · `lint` · `test` · `test:coverage` · **`render-probe`** · **`skill-approval-probe`** | `git revert` + a data migration for the new provenance field |
| **4.3** — Electron behavioural coverage | **GO** | — | `typecheck` · `lint` · `test` · **`typecheck:electron`** | `git revert` |
| **4.4** — the replay harness | **GO** | — | `typecheck` · `lint` · `test` | `git revert` |
| **4.5** — the notebook recovery affordance | **CONDITIONAL GO** | the sidecar design is reviewed | `typecheck` · `lint` · `test` · `test:coverage` | `git revert` + a sidecar-cleanup step |
| **4.6** — shard the notebook | **NO-GO until 4.5** | 4.5 landed and the shadow period is clean | `typecheck` · `lint` · `test` · `test:coverage` | **`git revert` + a migration** — the one item where a rollback is not sufficient |
| **5.1** — the backup lists | **NO-GO** | an owner decision | `typecheck` · `lint` · `test` · **the 5 export suites** | `git revert` |
| **5.5** — the history rewrite | **NO-GO** | a release boundary + the remote branches deleted | n/a — a coordinated force-push | **none.** This is irreversible. |

---

## 4. Open questions — only the owner can answer these

Each has a **proposed default**, so that silence is not a blocker.

| # | question | why it needs you | **proposed default** |
|---|---|---|---|
| **Q1** | **Does a trade outcome need a human click, or should the app record it automatically?** | It decides whether the entire learning loop can ever produce data. Every **[DATA-GATED]** feature in Report 3 waits on it. | **Automatic, with a provenance flag and a correction path — and a shadow month first** (resolve and show, do not record; report the disagreement rate). |
| **Q2** | **Should the assembled context be sent, or should the assembly be removed?** | It decides whether the app's retrieval is worth its cost, and whether the hybrid packet ever reaches a model. | **Remove the assembly now; re-add deliberately, budgeted, and measured.** The pull path (`recall`, `get_notebook_map`, `read_memory`) already exists. |
| **Q3** | ~~**What is your actual fee tier and slippage?**~~ | — | ✅ **ANSWERED (owner, 2026-10-20): 5 bps taker / 2 bps maker, zero slippage, with a visible "slippage not modeled" label.** The fee tier is a trader setting; the slippage line is labelled, never a silent zero. |
| **Q4** | **What should be in a backup?** | `approval_rules_v1` — the per-coin auto-apply policy — is on **neither** allow-list, and the repo's own test has said *"worth a decision"* since 2026-10-06. | **Put `approval_rules_v1` and the five restore-listed-but-not-RAW namespaces on the RAW list.** The quota argument against "widening for safety" applies to *shadow copies*, not to the trader's own policy. |
| **Q5** | **Is the Analyst Lens feature staying?** | The in-flight tree is deleting it. Everything about it — 9 dead exports, 3 live prompt files, the `custom_lens_prompts` split read/write bug, `utils/thinkingLens.ts` — depends on the answer. | **Let the deletion land**, then delete the leftovers in one pass. A half-deleted feature is the worst state. |
| **Q6** | **Is the Android gallery feature wanted?** | `GallerySaverPlugin.java` is **shipped in the APK** and reachable from the WebView bridge, and **no JavaScript calls it**. The app cannot save to the gallery at all. | **Wire it** — `TradingChart.tsx:1055` already produces the PNG bytes, so a "save chart snapshot" affordance is small — **or delete both sides.** Do not leave the Java half. |
| **Q7** | **Where should the render-time `<think>` / `<JSON_PLAN>` strip live?** | `utils/messageDisplayText.ts` was the only one, and it is orphaned. New messages are clean; **historical** rows can still leak chain-of-thought into a bubble. | **Move the strip into the two row components** (`ChatTranscriptRow.tsx`, `ChatTranscriptList.tsx`), keep the file until that is done, then delete it. |
| **Q8** | **Should old post-mortems and old debate transcripts stay readable?** (roadmap #21) | 25 read accesses across 17 files still read them, and the guard returns null for every post-2026-10-18 trade. | **Keep them readable.** The cost is a read path that returns nothing for new rows; the alternative is a data loss the trader did not ask for. |
| **Q9** | **How many minds should answer "Full analysis"?** (roadmap #19) | It decides whether the analysis branch is one seat or several — and therefore whether the harness contract and the analyst persona ever reach a trader-facing answer. | **One seat, tool-driven.** The product framing says the agent proposes and the user decides; a second seat adds a prompt and a cost without adding a decision. |
| **Q10** | ~~**Is `docs/analysis/` a live location or scratch?**~~ | — | ✅ **ANSWERED (owner, 2026-10-20): scratch.** The eslint ignore is right, the directory is un-tracked on purpose, and the plan lives at **`docs/plan/`** — tracked, indexed from `AGENTS.md` and `README.md`. The previous generation's reports are protected by the branch **`archive/prior-audit-2026-10-18`**, so `git gc` can no longer prune them. |
| **Q11** | **Should the history be rewritten to drop the 52 MB of APKs?** | They are in the first commit and in every clone. | **Not now.** Delete the merged branches first, then take the decision at the next major version boundary. A force-push across four remote branches is not a cleanup batch. |
| **Q12** | **Is the 1-second trade-surface clock needed, and is the root's 60 Hz re-render acceptable?** | They are the two largest render costs and both are the trader's felt experience. | **Move the clock to a leaf; move the transcript off the root.** Measure before and after, and if the numbers say it does not matter, say so and keep the code simple. |
| **Q13** | **Do the old pre-2026-10-18 trades count as evidence for the calibration ledger and the provider ranking?** | Their `planId` is absent (`R-214`), and their verdicts were produced by a gate that no longer exists. | **Count them for history, not for calibration.** The calibration ledger needs rows whose gate and prompt version are known. |
| **Q14** | ~~**Which tracked documents may be deleted?**~~ | — | ✅ **ANSWERED AND EXECUTED (2026-10-20): 18 plan documents were DELETED, not archived.** The rationale and the rescued content are in Report 4 §14 and the register §2–§3. **The deletions are staged, not committed** — one `git revert` undoes them. The dated history ledger (`docs/plans/debate-deletion-status.md`) was **kept**, because `scripts/check-flow-doc-anchors.cjs:44` scans it. |

---

## 5. Coverage statement

### 5.1 What was read — in full

`index.tsx` · `App.tsx` (the imports, the surface router, the chat seam, the send path) ·
`electron/main.cjs` (1,362 lines) · `electron/preload.cjs` (52) · `electron/sseParser.cjs` ·
`shared/providerRequestPolicy.cjs` (466) · `package.json` · `package-lock.json` (the root block and
the `js-yaml` entry) · `tsconfig.json` · `tsconfig.scripts.json` · `eslint.config.js` ·
`vitest.config.ts` · `playwright.config.ts` · `vite.config.ts` (the build, chunk and proxy
sections) · `index.html` (the CSP and the viewport) · `capacitor.config.ts` ·
`.gitignore` · `.gitattributes` · `.github/workflows/{ci,guards,release}.yml` ·
`services/infrastructure/{PreferencesService,ExportService,BackupService,ProviderConfigService,SqliteService,SqliteServiceHelpers,dbService,ThinkingStoreService,messageImageStore,OfflineQueueService,PromptOverrideService}.ts` ·
`services/validation/{TradeValidationGate,AccuracyValidationService,GateKeeperService,ValidationConstants}.ts` ·
`services/trade/{proposedTrade,proposalGate,presentTradeTool,chatTurnRunner,chatSurfaceTurn,toolTurn,automationTurn,tradeChatContext,toolPayloadStore,chartDrawings,levelWatchService,tradePlanLevels,chatStore,chatSessions,tradeShapedProse}.ts` ·
`services/providers/{GenericProviderService,GenericAnalysisService,reasoningControls}.ts` ·
`services/analysis/{DeskToolsService,MonteCarloService,MarketDataService,HybridIntelligenceService,TechnicalAnalysisService,CandlePatternDetector,taLibrary,KlineService,CorrelationRiskService,DebateMailbox,toolArtifactStore,mont*}.ts` ·
`services/learning/{SkillMemoryService,MemoryFilesService,MemoryRetrievalService,MemoryInjectionService,SkillCraftService,skillWorthGate,skillSupervisor,skillIdleLifecycle,MemoryService,AlgorithmicMemoryService,distilledMemory,PatternMemorySynthesisService,harnessLessons,DoctrineConsolidationService,NotebookWriterService,chartScanSkills,strategySummarizer,pdfOcrService,metaCalibration,memoryHygiene,globalMemory}.ts` ·
`services/agents/*` (7) · `services/bots/*` (3) · `services/backtesting/{outcomeEngine,ModelPerformanceService,ScenarioSimulatorService,LiveBacktestService,BacktestingService}.ts` ·
`services/ui/{OutcomeAutopilotService,AnalystLensService,EnsembleAnalystService,VetoLedgerService,PriceAlertService,AutoCaptureService}.ts` ·
`services/tools/toolForge.ts` · `services/desk/idleMotion.ts` ·
`constants/*` (all 17) · `utils/*` (the 30 that carry a finding; all 92 were swept) ·
`types/*` (17) · `schemas/*` (2) · `shared/*` (1) · `lib/*` (1) · `plugins/*` (1) ·
`hooks/*` (the 15 that carry a finding; all 41 were swept) ·
`components/*` (the 24 that carry a finding; all 148 were swept) ·
`index.css` (1,500+ lines) · `scripts/*` (18) · `e2e/smoke.spec.ts` ·
**every file under `docs/`** (21) · every root markdown file · `LICENSE` ·
**the previous audit's six reports** (recovered from the orphan commit).

### 5.2 What was run

| command | where | result | time |
|---|---|---|---|
| `npm run typecheck` | a hash-verified copy of `git archive 6a41a9f7` (all 1,131 tracked files byte-identical) | **exit 0**, 0 errors | 42.23 s |
| `npm run lint:loose` | the same copy | **exit 0** — 682 problems, 0 errors, 682 warnings | 23.97 s (48.93 s on a second run) |
| `npm run test` | the same copy | **exit 0** — 479 files, **4,741 tests, 4,730 passed, 11 skipped, 0 failed** | 455.85 s |
| `npx vitest run tests/noSparkles.test.ts tests/sharedPolicyEsmExports.test.ts` | a `git init`-ed copy of the pin | 7 tests, 7 passed — **this is what settled the census** (§5.4) | 8.32 s |
| `git ls-files --eol` | the repo | 1,092 `i/lf`, 39 `i/-text`, 13 `w/` — **no CRLF drift** | — |
| `git rev-list --objects --all` + `cat-file --batch-check` | the repo | the 15 largest blobs in history | — |
| a purpose-written import-graph script | the repo (read-only) | the orphan set, the export set, the key census | — |
| a purpose-written localStorage-key resolver | the repo (read-only) | 159 call sites, 61 distinct key shapes | — |
| a purpose-written dependency-import mapper | the repo (read-only) | every dependency → its import sites | — |

### 5.3 What was **not** run, and why

| not run | why it matters | how to close it |
|---|---|---|
| **the app itself** | no runtime behaviour was observed; every behavioural claim here is code-reading | run the packaged app against a throwaway profile |
| `npm run build` | it would overwrite the `dist/` measurement the bundle findings are based on | run it in the copy |
| `npm run test:coverage` | it writes a coverage report; the four floors are therefore *reasoned about*, not measured | run it in the copy |
| `npm run e2e` | needs a live dev server + Chromium | on an idle machine |
| `boot-probe`, `render-probe`, `skill-approval-probe` | **the three strongest gates in the repo were not run** | on an idle machine — `render-probe` is the only gate that can see a rendered row or a rendered string, and every rendered-geometry claim in this audit is code-reading only |
| `installer-smoke` | needs a packaged Windows exe | on Windows |
| `npm audit` | network access, and it would need a lockfile write to be useful | **no CVE claim is made anywhere in these reports** |
| `npm install` / `ci` / `update` / `uninstall` / `prune` / `dedupe` | forbidden by the brief | — |
| **any live profile, `userData` folder, database, or credential** | forbidden by the brief | — |
| the in-flight working tree | the concurrent session is rewriting it; auditing it would describe a moving target | re-run after 0.1 |

### 5.4 Two claims this audit made and then **withdrew**

**Recorded because a report that hides its own corrections is worth less than one that shows them.**

1. **"The vitest census is stale by 3."** — **WITHDRAWN.** The first measurement (4,738) came from
   a copy without a `.git`; `tests/noSparkles.test.ts` shells out to `git ls-files`, dies at import,
   and contributes **0** of its 3 tests. A direct measurement in a `git init`-ed copy of the pin
   shows `noSparkles` collecting **3** and `sharedPolicyEsmExports` **4**, all passing.
   **⇒ the correct census is 4,741 tests in 479 files, and `AGENTS.md`'s figure is EXACTLY RIGHT.**
2. **"`docs/analysis/` does not exist."** — **CORRECTED, not withdrawn.** It does not exist at the
   pin, on any branch, **or in the history** — but it does exist in **four dangling commits**
   (`508b691a`, `7478c4c0`, `aff83bcd`, `257e1237`) reachable only via
   `refs/cline/checkpoints/*`. The command that hid it is the one the brief prescribed:
   `git log --all --oneline -- 'docs/analysis/*'` returns nothing because of git's **default
   history simplification**; `--full-history` finds it. **The previous audit is one `git gc` from
   being lost**, and it holds the only written record of the cost-model finding.

### 5.5 What is **not** covered

| area | why |
|---|---|
| `services/analysis/DeskToolsService.ts` (3,995 lines) | its exports, the 39 tool definitions, both prompt blocks, the cache and the executor allow-list were read; **the individual tool bodies were not** |
| `services/learning/SkillMemoryService.ts` (3,915 lines) | `syncClosedTradeToNotebook`, `applySkillEvidence` and the export surface were read; the body was not line-by-line |
| `services/ui/OutcomeAutopilotService.ts` (673 lines) | its exports and constants were read; **the resolution logic was not** |
| `services/validation/GateKeeperService.ts` (433 lines) | its signature was read; **the gate's individual checks were not** |
| `services/analysis/{TechnicalAnalysisService,MarketDataService,HybridIntelligenceService}.ts` | inventoried and their public surfaces read; not read line-by-line |
| `services/learning/calibrationPolicy.ts` / `calibrationStore.ts` / `SessionGuardService.ts` / `DataIntegrityService.ts` | inventoried |
| `services/automation/{cronParser,AutomationService}.ts` | inventoried |
| `android/` | the Java plugin and `MainActivity.java` read; the Gradle build not analysed |
| `docs/plans/debate-deletion-status.md` (2,070 lines) | its status, its ledger and its anchor claims verified; **not line-audited across all 2,070** |
| `docs/plans/stage2-implementation-plan.md` (417) and `release.yml` (269) | **not line-read in full** |
| `components/**` (148 files) | all swept; **24 read closely**, the rest grepped |
| `tests/**` (483 files) | the suite was **run**; individual suites were read only where they carry a finding |
| the app's rendered behaviour, in a browser | **no browser was run** |
| a screen-reader audit | **no NVDA / VoiceOver** |
| the live profile's contents | **forbidden by the brief** — the prior audit's `n = 0` figure is reported as *theirs*, not as ours |

### 5.6 The honesty clause

**Every number in these six reports is a command output, a `file:line`, or a labelled estimate.**
Where a number came from the previous audit, it is attributed and re-verified. Where a number
could not be verified, it says so and names what would settle it. **No figure is invented, and
no claim rests on a document.**

---

## 6. What this audit believes, in one page

**August Trading is a well-built app with a well-built memory system and a broken connection
between them.** The code quality is high — the Electron hardening is genuinely good, the retry
layer is genuinely well engineered, the notebook's write-failure handling is genuinely correct, the
migration layer genuinely cannot lose data, the atomicity is real, and the suppression profile is
clean. The gates are real too, and two of them (`render-probe`, `skill-approval-probe`) are
better than most commercial repos will ever write.

**And in the middle of that, the loop does not close.** The app assembles a rich, carefully
budgeted, carefully instrumented context on every send — and sends something else. It records
that the model saw skills it did not see, and credits them anyway. It computes three different
planned risk:reward ratios for the same plan and grades it with one while displaying another. It
has no cost model, so every number the trader sees is gross. And its validation gate — 20 checks,
a confidence ladder, a probability clamp — has **no production importer**, which may mean the
simplest gate is the only one that runs.

**The gap between the app's ambition and its wiring is the whole finding.** And the reason it
survived is the reason the app is good: **the gates are excellent at proving that the code it can
see works, and the blind spot is exactly where the defects live** — a prompt that is built but not
sent, a module that is tested but not imported, a number that is computed but not read, a document
that is written but not believed.

**So the recommendation is narrow and unglamorous: make the gates reach the code they cannot
currently see, and then fix what they find.** Four tests that assert what is *sent* (E-11).
`noUncheckedIndexedAccess` and `noUnusedLocals` on (E-07). A re-tightened lint ratchet (E-29). A
key-scoped backup check. A behavioural test for the Electron shell (E-24). **Then** the four
decisions that only the owner can make — the context, the click, the fee tier, and the backup
contract — and then the loop closes, and the app becomes the operator it is trying to be.

---

**Stop here.** The reports are delivered. Nothing has been cleaned, nothing has been built, and
nothing in the repository was modified except these six files. Awaiting approval.

---

## 7. Cross-check against the previous audit — **does the current plan contradict it?**

**Short answer: no. There is no contradiction in substance.** Every one of the previous review's
recommendations maps onto something in this plan, and where both audits cover the same ground they
agree. **There is one real divergence — a default, not a plan** — and **sixteen findings and nine
recommendations the previous review had that my first draft did not.** All of them are now in the
reports (Report 2 §3C), and **all sixteen were re-verified at the current HEAD (`69c4aa33`)**.

**The source:** `docs/analysis/06-independent-review-2026-10-18.md`, 58,715 B, 910 lines,
recovered from the orphan commit **`508b691a`** (reachable only via
`refs/cline/checkpoints/session_1792326571064_z70jp/*` — **§8.1 of the index: this file is one
`git gc` from being lost, and it is the more valuable of the two documents the previous audit
produced.**)

### 7.1 Every prior recommendation, mapped

| prior | mine | verdict |
|---|---|---|
| **QW1** settle PENDING rows without a human click | **E-18** | **SAME, and theirs is cheaper.** They propose a fifth sibling on the existing 15-minute heartbeat (`hooks/useLearningHeartbeat.ts:57-67`), `settledBy: 'auto'`, first-writer-wins, settling silently. I proposed automatic resolution with a provenance flag, a correction path, and a shadow month. **Their version is S/M effort against my L, and it reuses a heartbeat that already exists.** I am adopting their mechanism. **Not a contradiction — a refinement in their favour.** |
| **QW2** give presented plans a validity window | **E-38** (new) | **I MISSED IT.** Now added: `validityDurationMinutes` is declared, transformed and read, but **never set** — so `ENTRY_NOT_HIT` is never written and the denominator is wrong. |
| **QW3** add `netR` and a configurable fee | **E-03** | **SAME.** They name the owner (`utils/netRiskReward.ts`) and the formula; I name the field and the setting. **Compatible.** Their `netBreakEvenR` and "charge funding only when the hold crosses a funding boundary" are details I did not have. |
| **QW4** put a size on the card and the row | **E-12** + **N-08** | **SAME.** Their "**sizing downgrade-only** — never up-scale on model confidence" is a rule I did not state. Adopted. |
| **QW5** put the trading contract back in the live prompt | **E-01** | ⚠️ **THE ONE DIVERGENCE — and it is a default, not a plan.** See §7.2. |
| **QW6** decide at `high` effort; stop advertising an unsent temperature | **E-39** (new) | **I MISSED IT.** `EFFORT_BY_TASK.chat = 'low'` for the one output that matters, and the transport omits temperature on thinking-enabled models. Now added. |
| **QW7** normalise target order at the parse boundary | **E-02** | **SAME goal, different mechanism — and mine is the more robust.** They sort `takeProfits` by distance at the parse boundary (so index-0 == nearest); I unify the *formula* so one canonical computation is read by the card, the gate, the clamp and the drawings label. **Sorting leaves two formulas alive; unifying removes one. Mine supersedes theirs, and it also covers `ScalpDetectionService`'s second copy, which sorting would not.** |
| **QW8** apply the predicate ceiling | **E-35** (new) | **I MISSED IT.** `predicateGate.ceiling` is computed and dropped. Now added — and it is the same disconnection as F-01, one layer deeper. |
| **QW9** raise the evidence floors before outcomes arrive | **E-37** (new) | **I MISSED IT — and it is a hard dependency of E-18.** `MIN_SAMPLE_FOR_VETO = 2` can zero a real setup. Now added, and sequenced **before** E-18. |
| **QW10** delete/quarantine the dead prompt corpus, fix the stale copy | Report 4 **Batches 1 and 5** | **SAME.** |
| **M1** decide the context policy — inject or delete | **E-01** | **IDENTICAL ITEM** — theirs names the same two options. |
| **M2** make the gate refuse, not just cap | **E-43** (new) | **I MISSED IT.** The `minEdge` refusal. Now added. |
| **M3** record what the model saw | **E-05** | **SAME — same name, same idea.** |
| **M4** align the R:R definition with the ladder | **E-02** + **E-34** | **SAME.** |
| **M5** fix per-model weighting before it is re-wired | **E-04** | **SAME.** |
| **M6** fix the journal's date semantics | **E-40** (new) | **I MISSED IT.** `LoggedTrade.timestamp` is the write time; every dashboard measures confirmation time. Now added. |
| **B1** the daily candidate / shadow log | **E-43** + **N-04/N-05/N-20** + **E-35**'s decline | **RELATED, and their B1 is UPSTREAM of mine.** Their B1 is the *data substrate* — one row per candidate, taken and not taken. Mine are *surfaces* for the trader. **They are compatible and theirs is the precondition.** |
| **B2** exit-model replay | **E-20** | **SAME, and more specific.** Their B2 is the label (`exitModel: 'blended' \| 'single' \| 'breakeven' \| 'trail'`) plus the study. Adopted into E-20. |
| **B3** regime routing, measured | — | ⚠️ **SCOPE, NOT DISAGREEMENT.** The brief **excluded** regime routing. Their B3 proposes it — but their own text says *"doing it before B1 is fitting noise"* and *"Risk high if done early"*. **Their sequencing already agrees with excluding it for now.** Not carried forward. |
| **B4** deterministic baseline | **E-20** | **I MISSED THE FRAMING, and they have the better one.** *"Has anyone asked whether the model beats a fixed rule?"* — for every settled candidate, compute what *"trade every `scan_setups` signal with the same SL/TP"* would have returned. **If the deterministic baseline wins, that is the most important thing the app can tell its user.** Adopted as **E-20's headline use case.** |
| New features: `minEdge`, model-stated probability, `decline_trade`, liquidation-buffer warning | **E-43**, **E-35**, **E-38**, **E-37** | **I MISSED all four.** The **model-stated probability** (add an optional numeric `probability` to the `present_trade` schema so calibration is on a number, not a three-word label) is the one I am **not** carrying forward as written — it conflicts with the app's deliberate design (`AGENTS.md`: the number is *derived from the word* on today's path) and with my E-19. **Carried as a note, not a proposal.** The other three are now **E-43**, **E-35** (the decline), and **E-37** (the buffer). |

### 7.2 The one divergence, in full

**We agree on the decision; we differ on the default.**

| | |
|---|---|
| **Their default (QW5 + M1a)** | inject `enhancedPrompt` on the pipeline path, naming the block it displaces under the existing zero-sum packet budget |
| **My first default (E-01), superseded** | ~~cut the assembly first, then re-add deliberately, budgeted and measured~~ — **this was the stale half; see the row below** |
| **Their M1b** | delete the fetch and the assembly, and rely on tools |
| **✅ THE ONE RECOMMENDATION, now the same everywhere** | **Inject and record together, or neither.** **(1) Inject the harness contract** into the P1/P2/P3 system prompts — **1,582 chars**, carrying the **confidence ladder**, the **risk rules** and the **`HARNESS_TURN_MARK` convention**, the only text in the app that tells a seat which words are the trader's and which are the app's. It closes the C-5 contradiction immediately, where the mark is used in the user role and explained nowhere. **(2) Cut the retrieved context by default** — the expensive part of `enhancedPrompt` is the *retrieved context*, not the contract, and the pull path (`recall`, `get_notebook_map`, `read_memory`) already exists. **(3) Flip `recordInjections` to default-false in the same change** (`services/learning/MemoryRetrievalService.ts:976-981`), or the ledger keeps recording skills the model never saw while you decide. |

**This is not a contradiction between the two audits. It is one audit naming a third option the other did not consider, and the resolution is in Report 2 §3C.1.**

### 7.3 The sixteen findings I did not have — all re-verified at HEAD

| # | finding | verified at `69c4aa33` | now in |
|---|---|---|---|
| 1 | **`applyNotebookSkillsToAnalysis` has no production caller** — the hard `avoid` veto, the candidate cap and the confidence downgrade are disconnected | ✅ definition at `SkillMemoryService.ts:3494`; every call site in `tests/` | E-35 |
| 2 | **`VetoLedgerService.recordVeto` has no production caller** — the ledger is read, never written | ✅ definition `:90`; seven test call sites | E-35 |
| 3 | **`MIN_SAMPLE_FOR_VETO = 2`** — a two-trade sample can zero a real setup | ✅ `SkillMemoryService.ts:385` | E-37 |
| 4 | **default leverage is 100×**; the liquidation buffer is in the unreachable module | ✅ `utils/conversationUtils.ts:6` | E-37a → E-19 note |
| 5 | **`LoggedTrade.timestamp` is the write time**; every dashboard measures confirmation time | ✅ `useTradeLogging.ts:284` vs `:307` | E-40 |
| 6 | **no feature snapshot on the row** — `marketConditions` written as literal dashes | ✅ `proposedTrade.ts:160-162` | E-12 note |
| 7 | **default reasoning effort for a trade decision is `low`** | ✅ `reasoningControls.ts` `EFFORT_BY_TASK.chat` | E-39 |
| 8 | **temperature is not what is configured** — omitted on thinking-enabled models | ✅ `chatSurfaceTurn.ts:265`, `automationTurn.ts:198`, `providerRequestPolicy.cjs:180-185` | E-39 |
| 9 | **no prompt caching** — every tool round re-sends the system prompt, 30 schemas and every prior result | ✅ no `cache_control` anywhere in `services/providers` or `shared` | E-30 |
| 10 | **no HOLD / NO_TRADE outcome** — a declined plan leaves no object | ✅ `types/enums.ts:9-15` | E-35 (decline) |
| 11 | **`validityDurationMinutes` is never set** → `ENTRY_NOT_HIT` never written → the denominator is wrong | ✅ `schemas/tradeAnalysis.ts:218,468`; `ScalpDetectionService.ts:86`; `useTradeLogging.ts:301` | E-38 |
| 12 | **`OutcomeAutopilotService` comment says "60s loop"; the constant is 20 s** | ✅ `:7` vs `:85` | Report 4 §13 |
| 13 | **`predicateGate.ceiling` is computed and never used** | ✅ `skillPredicateGate.ts:78,200` | E-35 |
| 14 | **the row records no feature snapshot / no prompt** — `runStats.promptVersion` is never written, and the A/B lane has no caller | ✅ `useTradeLogging.ts:355`; `PromptOverrideService.ts:24` | E-05 (already) |
| 15 | **spot fallback can silently feed perp analysis** — the gate and the predicate consume whatever came back | ✅ `KlineService.ts:10-13`; `HybridIntelligenceService.ts:908-910` | E-33 |
| 16 | **Monte Carlo assumes its own volatility** when the model omits `atr` — 2 × stop distance | ✅ `HybridIntelligenceService.ts:1514-1531` | E-33 (adjacent) |

**And one prior claim that does NOT verify:** `constants/prompts/analysisPrompts.ts:299` —
*"Family C … Highest win rate (~86 %)"*. **Not found** — the file is 190 lines at HEAD and a search
for `win rate` across `constants/prompts/` returns zero hits. **Not carried forward.**

### 7.4 What this changes about the recommended order

**One dependency is now explicit and it was missing:** **E-37 (raise the evidence floors) must land
BEFORE E-18 (fix the outcome loop).** Fixing the outcome loop without raising the floors
manufactures confident nonsense from three-trade clusters and two-trade vetoes, and then acts on
it. The prior review called this *"the 'do it in the same release' dependency"*; it is a **same-release
dependency, not a same-release convenience.**

**And E-38 (the validity window) must land with E-18**, because the "net expectancy" claim E-18
enables is worthless while the denominator excludes the setups that never triggered.

### 7.5 The honest summary of the relationship between the two audits

| | previous audit (2026-10-18) | this audit (2026-10-19) |
|---|---|---|
| **method** | read the live profile (decoded leveldb), traced the trading logic, 910 lines | full-repo static sweep, 5,064 lines, 1,018-file import graph, gates run in a throwaway copy |
| **its unique strength** | **it read the trader's actual data** and found the n = 0 outcome corpus, the 3 real plans, and the 100× leverage. **No static audit can find that.** | |
| **its unique strength** | | **it found the two-Schema split, the store census, the prompt/token accounting, the ratchets, the security posture and the dead-code class** — none of which the prior audit attempted |
| **overlap** | 16 findings in common, all re-verified and **all still standing** | |
| **net** | 16 findings + 9 recommendations the prior audit had that this one did not | 9 items the prior audit did not have |
| **contradiction** | **none** | **none** |

**⇒ Together they are one audit.** The prior document's most important content — the live-data
findings and the nine missing items — is now merged into this plan and re-verified against a tree
162 commits newer. **And both documents still live only in unreachable commits, unless this
session's reports are committed.**

---

## 8. The three new features, in the order

**Added 2026-10-20.** The deep dives are in Report 1 §12; the proposals are Report 2 §3D and
Report 3 §11. The order below is by **dependency**, and it interleaves with Phases 0–4 above.

### Where they land

| phase | new item | why here |
|---|---|---|
| **Phase 1** (cheap wins) | **E-47a** — accept `SKILL.md` as a filename, add a `version:` key | **S**, no behaviour change, and it is the *portability* half of the convention. A Claude/Hermes skill drops in and works. |
| **Phase 1** | **E-49 — rank the 30-slot index** (usable trigger first, `confirmed` before `candidate`, `retired` out, audience-filtered). **S**, and it is what makes repairing the library actually reach the model. | after E-48 stage 1 has shown which skills are dormant |
| **Phase 1** | **E-48 stage 1** — the deterministic "review all my skills" pass | **S**, and every function it needs already exists. It is a **diagnostic**, and it should land before anything rewrites a skill, so the trader can see the baseline first. |
| **Phase 2** | **E-45** — per-session run ownership for the Chat surface | **M**. It is independent of the cleanup and of the cost model, and it is the feature the owner asked for. It should land *before* N-22, which depends on its per-conversation ownership. |
| **Phase 2** | **E-47b** — a per-skill `category:` key and a category view | **M**. |
| **Phase 3** | **E-45b = N-22** — the "still running" badge on the conversation rail | **S**, and it needs E-45 first. **Ship it with E-45, not after** — a run that survives without a visible indicator reads as a hang. |
| **Phase 3** | **E-48 stage 2** — the model-assisted repair, as **proposals** through the existing queue | **M**, and it needs E-48 stage 1 to have run, so the trader can compare the report to the proposal. |
| **Phase 4** | **E-46b** — the `compatibility` block (`requiresTools` / `requiresEnv` / `platforms`) | **S**, and it needs the skills to be reviewed first, so the block describes what the skill actually needs. |
| **Phase 4** | **E-46a** — level-3 sub-resources (`references/`) | **L**, and it is **the only item in the whole plan where a bug can lose the trader's own thinking.** It must land **after** E-48 stage 2 exists, so a broken split is recoverable by re-running the review. |

### The dependency that matters most

```
E-48 stage 1 (diagnose)  →  E-48 stage 2 (propose fixes)  →  E-46a (level-3 resources)
        S                        M                              L
```

**Do not build level-3 resources before the review job exists.** A skill split into a card plus a
`references/` note is a **storage-shape change to the one store the app cannot regenerate**; the
review job is the safety net that finds a broken split. Building the split first means a bug
truncates a procedure with no way to notice.

### Two things these features do **not** do

- **They do not place an order, write to an exchange, route on regime, revive the debate engine, or
  add an LLM review call to a live trading decision.** E-48's model stage is a **one-off batch over
  the trader's own library**, opted into, capped, and estimated before it starts — the same shape
  as the candidate log the owner already approved.
- **They do not change the skills format.** The format is **already** a documented Agent Skills port
  (`services/learning/SkillMemoryService.ts:411-431`), with the spec's two required fields, a
  two-face split so a spec-only file loads, and progressive disclosure at two of three levels. **E-46
  and E-47 close the remaining gaps; they do not redesign what works.**
