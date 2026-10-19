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
| 0.2 | **Re-anchor to the new HEAD and re-run the four sweeps**: the import graph, the export sweep, the localStorage/Preferences census, and the dead-path comment scan. | The clean-code pass was done against `6a41a9f7`. The in-flight deletion changes the orphan set, the dead-export set, **and** the store census. |
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
| 4.2 | **E-05 → the ledger becomes honest** → **E-18** (the loop closes) | after 1.1 and 1.2 |
| 4.3 | **E-24 — `electron/main.cjs` behavioural coverage** | after Phase 2 (so the CSP and the sender-frame guard are already in) |
| 4.4 | **E-20 — the replay harness** | after W3.2 — it is the measurement instrument for it |
| 4.5 | **E-23 — the notebook's recovery affordance** | **the only batch here with a data-migration risk.** Do it with a sidecar, never in place. |
| 4.6 | **E-21 — break the notebook out of one blob** | after 4.5. **This is the one item where a bug loses the trader's own thinking.** |
| 4.7 | **N-01 … N-20** (Report 3) | the **[DATA-GATED]** ones wait for 4.2 |

### Phase 5 — the things that need the owner, and the things that need a decision to be made

| # | item | what is needed |
|---|---|---|
| 5.1 | **E-14 / the backup lists** (`approval_rules_v1`, the 5 restore-listed-but-not-RAW namespaces) | an **owner decision** on what should be in a backup. The repo's own test says *"worth a decision"* and the decision was never taken. |
| 5.2 | **E-03's fee tier** | the trader's real numbers |
| 5.3 | **E-21's notebook sharding** | a decision on whether one blob is acceptable |
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
| **Q3** | **What is your actual fee tier and slippage?** | Without it the cost model can only carry an assumption, and every expectancy number in the app stays gross. | **Make it a setting**, defaulting to 0.05 %/side taker, with a visible **"gross"** badge when unset. Never hardcode an exchange rate. |
| **Q4** | **What should be in a backup?** | `approval_rules_v1` — the per-coin auto-apply policy — is on **neither** allow-list, and the repo's own test has said *"worth a decision"* since 2026-10-06. | **Put `approval_rules_v1` and the five restore-listed-but-not-RAW namespaces on the RAW list.** The quota argument against "widening for safety" applies to *shadow copies*, not to the trader's own policy. |
| **Q5** | **Is the Analyst Lens feature staying?** | The in-flight tree is deleting it. Everything about it — 9 dead exports, 3 live prompt files, the `custom_lens_prompts` split read/write bug, `utils/thinkingLens.ts` — depends on the answer. | **Let the deletion land**, then delete the leftovers in one pass. A half-deleted feature is the worst state. |
| **Q6** | **Is the Android gallery feature wanted?** | `GallerySaverPlugin.java` is **shipped in the APK** and reachable from the WebView bridge, and **no JavaScript calls it**. The app cannot save to the gallery at all. | **Wire it** — `TradingChart.tsx:1055` already produces the PNG bytes, so a "save chart snapshot" affordance is small — **or delete both sides.** Do not leave the Java half. |
| **Q7** | **Where should the render-time `<think>` / `<JSON_PLAN>` strip live?** | `utils/messageDisplayText.ts` was the only one, and it is orphaned. New messages are clean; **historical** rows can still leak chain-of-thought into a bubble. | **Move the strip into the two row components** (`ChatTranscriptRow.tsx`, `ChatTranscriptList.tsx`), keep the file until that is done, then delete it. |
| **Q8** | **Should old post-mortems and old debate transcripts stay readable?** (roadmap #21) | 25 read accesses across 17 files still read them, and the guard returns null for every post-2026-10-18 trade. | **Keep them readable.** The cost is a read path that returns nothing for new rows; the alternative is a data loss the trader did not ask for. |
| **Q9** | **How many minds should answer "Full analysis"?** (roadmap #19) | It decides whether the analysis branch is one seat or several — and therefore whether the harness contract and the analyst persona ever reach a trader-facing answer. | **One seat, tool-driven.** The product framing says the agent proposes and the user decides; a second seat adds a prompt and a cost without adding a decision. |
| **Q10** | **Is `docs/analysis/` a live location or scratch?** | The eslint ignore already treats it as scratch; the previous generation's reports live in four dangling commits and one `git gc` from being lost. | **Make it live and tracked** — with this session's six reports as the first entries — **and commit the archive** rather than moving it. |
| **Q11** | **Should the history be rewritten to drop the 52 MB of APKs?** | They are in the first commit and in every clone. | **Not now.** Delete the merged branches first, then take the decision at the next major version boundary. A force-push across four remote branches is not a cleanup batch. |
| **Q12** | **Is the 1-second trade-surface clock needed, and is the root's 60 Hz re-render acceptable?** | They are the two largest render costs and both are the trader's felt experience. | **Move the clock to a leaf; move the transcript off the root.** Measure before and after, and if the numbers say it does not matter, say so and keep the code simple. |
| **Q13** | **Do the old pre-2026-10-18 trades count as evidence for the calibration ledger and the provider ranking?** | Their `planId` is absent (`R-214`), and their verdicts were produced by a gate that no longer exists. | **Count them for history, not for calibration.** The calibration ledger needs rows whose gate and prompt version are known. |
| **Q14** | **Which four tracked documents may be deleted?** (roadmap, 13 days open) | `docs/plans/` has 20 files, 4 slated for deletion or archival since 2026-10-07, and *"a deletion of a tracked file is a commit and yours to approve"*. | **Archive, do not delete.** An archive is recoverable and a deletion is not. The 18 files go to `docs/archive/` with a README that says a line number there points at a tree that no longer exists. |

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
