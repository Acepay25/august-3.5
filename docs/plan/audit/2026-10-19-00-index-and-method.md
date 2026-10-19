# August Trading — deep-dive audit: index, method, and coverage

**Date:** 2026-10-19
**Subject:** the `august-trading` repository at `C:\Dev\august-3.5`
**Nature:** READ-ONLY. Nothing in the repository was modified, deleted, moved or renamed. The only
files created are the seven reports in this folder.

---

## 0. Step 0 — the exact commit, the tree state, and the tools


---

## 0.0 The baseline, stated once

**This audit measured against one commit. The repository has moved on. Both facts matter, so both
are stated here, once, and every other section refers back to this one.**

| | |
|---|---|
| **The audit baseline** | **`6a41a9f7`** — the commit every finding in Parts A–F was measured at. Line numbers, sizes and store shapes are all relative to this commit. |
| **The current HEAD** | **`56639b4b`** — three commits later: the analyst-role/lens deletion (`6e1e09bb`, `69c4aa33`) and the un-tracking of the scratch directory (`56639b4b`). |
| **The current working tree** | **60 changed paths** — 30 staged and 30 unstaged. 24 of them are this audit's own work (the 18 deleted plan documents, the plan's new home, the 16 repointed comments, `AGENTS.md`, `README.md`, `THIRD_PARTY_NOTICES.md`, `index.css`); the rest are the other session's in-flight work: the moderator picker's removal (`hooks/useModeratorPick.ts`, `services/infrastructure/moderatorPick.ts`, `components/settings/tabs/ModelsTab.tsx`, `components/settings/SettingsMenu.tsx`), the conversation-housekeeping and preferences changes, `scripts/render-probe.cjs`, and the flow docs. |
| **The rule** | A finding that depends on a file in that 60-path set is **worktree-specific** and is labelled as such. A finding that does not is **stable across all three states**, and was re-verified at `56639b4b`. |

**What changed between the baseline and HEAD that could move a finding:**

| change | commits | effect on this audit |
|---|---|---|
| the analyst-role and Lens system was deleted, with a stored-profile migration | `6e1e09bb`, `69c4aa33` | **F-14 is resolved.** The Lens prompts, the seat personas and the three `AnalystRole` members are gone or reduced to the lens vocabulary. The HOLD rows in Report 4 §10 are decidable. **No headline finding is affected** — F-01, F-10, F-11, F-13 and F-01b all re-verified as **standing** at `56639b4b`. |
| the `docs/analysis/` directory was un-tracked as scratch | `56639b4b` | **this audit's own output moved out of it**, to `docs/plan/` (§0.9b). |
| the moderator picker was removed from the worktree | uncommitted | **one cleanup row is superseded** (Report 4 §3.4) — the field is being deleted, not relabelled. |

**The re-anchor instruction, corrected.** Where Part E says *"re-anchor to the new HEAD and re-run
the four sweeps"*, the new HEAD is **`56639b4b`** — and, because the working tree carries 30
unstaged changes on top, the sweep should be re-run against **the worktree after the in-flight
work lands**, not against `56639b4b` alone. The four sweeps are: the import graph, the export
sweep, the localStorage/Preferences census, and the dead-path comment scan.
### 0.1 The commit

| item | value |
|---|---|
| **Pinned commit** | **`6a41a9f7e3b3986236c3000862d326f1e95dfad1`** |
| Abbreviated | `6a41a9f7` |
| Subject | `docs(flow): repair the tip 395f73db left red` |
| Commit date | 2026-10-19 20:42:47 +0800 |
| Branch | `main` (ahead of `origin/main` by 1) |
| Parent | `395f73db` `refactor(desk): never seed the Agents roster; drop the built-in Macro/Technical/Risk` |
| Grandparent | `55a7bb7c` `refactor(ensemble): stop the mode flag deciding data work (stage 1 of #19)` |

**Every finding in these reports is stated against `6a41a9f7`.** Where a line number is quoted for
a file that later changed, it was re-read with `git show 6a41a9f7:<path>` and confirmed at the pin.

### 0.2 The tree moved twice while the audit ran — and how that was handled

This is the single most important caveat in the whole audit, so it is stated plainly.

The repository is being worked on **concurrently, by another session, in the same working
directory**. Three separate HEAD moves and one large in-flight edit set were observed:

1. **At audit start**, HEAD was `55a7bb7c` and the working tree carried five uncommitted files
   (`App.tsx`, `docs/app-flow.html`, `docs/app-flow.md`, `docs/plans/debate-deletion-status.md`,
   `package-lock.json`, `services/bots/BotRegistry.ts`).
2. **Mid-audit**, that pending work was committed by the other session as `395f73db` + `6a41a9f7`.
   The pin moved forward to `6a41a9f7` and every teammate was notified. The delta was small,
   understood, and re-verified: it removed the Agents-roster seeding effect from `App.tsx` and the
   `BotRegistry.seedIfEmpty` method from `services/bots/BotRegistry.ts`.
3. **Late in the audit**, the working tree gained a further **21 dirty paths** — an in-flight
   deletion of the bot/roster subsystem (`D services/bots/BotRegistry.ts`, `D types/bot.ts`,
   `D utils/debateEnvelopes.ts`, `D utils/teamRoster.ts`, `D tests/teamRoster.test.ts`, plus
   modifications to 12 bot/agent files, 5 test files and `package-lock.json`).

**Rule applied throughout:** the audit describes the **committed** tree at `6a41a9f7`, never the
moving working tree. Where a finding concerns a file the concurrent session is currently deleting,
it is labelled *"present at pin `6a41a9f7`; removed in the in-flight working tree"* and treated
as **in-flight corroboration** rather than as a proposal. Nothing was staged, stashed, checked out,
reverted or otherwise disturbed. The other session's work was never blocked.

**The practical consequence for the reader:** two of the cleanup batches in Report 4 are, at the
time of writing, already being executed by someone else. Treat them as *in flight*, not as *to
do*, and re-verify the current HEAD before starting any cleanup work.

### 0.3 Working tree state at the pin

| path | state at pin | note |
|---|---|---|
| `package-lock.json` | **dirty** (uncommitted) | the working-tree copy bumps the lock to `1.3.0` and adds `js-yaml` to the root devDependencies block. The **committed** lockfile still says `1.0.30` and lacks `js-yaml` in the root block. See Report 4, batch 5. |
| all 1,130 other tracked paths | clean at the pin | except the 21 paths the concurrent session later dirtied |

### 0.4 Tools and where they ran

| tool | where | what |
|---|---|---|
| `git` (read-only: `rev-parse`, `log`, `show`, `ls-files`, `ls-tree`, `status`, `branch`, `tag`, `rev-list`, `cat-file --batch-check`, `grep`, `worktree list`, `stash list`, `ls-files --eol`) | `C:\Dev\august-3.5` | commit, history, reachability, eol, blob sizes |
| `node` v24.18.0 — four read-only analysis scripts | `C:\Users\rober\AppData\Local\Temp\august-audit\lead\` | localStorage key extraction, dependency import map, orphan sweeps |
| `npm run lint:loose` | **a throwaway copy** at `%TEMP%\august-audit\sec\copy` | 682 warnings, 0 errors |
| `npm run test` (vitest) | a throwaway copy, plus a `git init`-ed copy of the pin (so the two `git ls-files` suites can run) | **479 files / 4,741 tests: 4,730 pass, 11 skip, 0 fail**; 456 s |
| `npm run typecheck` | the same throwaway copy | see Report 1 §10 |

**Nothing was installed, updated or uninstalled.** No `npm install` / `npm ci` / `npm update` /
`npm uninstall` / `npm prune` / `npm audit fix` / `npm dedupe` ran at any point. The dependency
analysis is therefore a *static import-graph* analysis, not an `npm ls` tree, and the
"is it still maintained?" question is answered from the manifest and the import graph, not from a
registry query.

**The app was never run.** No dev server, no Electron launch, no packaged app, no probe. Nothing
touched a live profile, a live `userData` folder, a live database, or another session's uncommitted
work. The two vitest failures in the measured run are artefacts of running outside a git
repository (two suites shell out to `git ls-files`) and are not real failures — see Report 1 §10.

### 0.5 What could NOT be run, and why

| not run | why it matters | how to close it |
|---|---|---|
| the app itself | no live behaviour was observed; every runtime claim in these reports is code-reading | run the packaged app against a throwaway profile |
| `render-probe` / `boot-probe` / `skill-approval-probe` | the three strongest gates (per `AGENTS.md`) were not executed, so "the rendered row count is right" is unverified | `npm run render-probe` on an idle machine |
| `npm run e2e` (Playwright) | needs a dev server + Chromium | same |
| `npm audit` | network access + it would need a lockfile write to be useful | run in a throwaway copy |
| `npm run test:coverage` | writes a coverage report and is slow; the floors in `vitest.config.ts` are therefore *reasoned about*, not measured | run in a throwaway copy |
| any read of the live `userData` / SQLite / localStorage | **prohibited by the brief**; the prior audit did read it on 2026-10-18 and its numbers are reported here as *that* audit's, not as ours | see the "n = 0 resolved trades" item in Report 1 §2.6 |
| the deleted-in-flight bot subsystem | the concurrent session is actively rewriting it; auditing it now would describe a moving target | re-audit after the concurrent session lands |

### 0.6 Labelling used in every report

| label | meaning |
|---|---|
| **[Verified live]** | I ran it or measured it — a command, a count, a byte size, a timing |
| **[Verified by code reading]** | read at `file:line`; the behaviour is deterministic from the source, but not observed running |
| **[Unverified — needs X]** | a claim that needs a specific thing I could not do — stated in full every time |

**No number in these reports is invented.** Where a number is an estimate it says so and names the
method. Where a prior report's number is quoted, the prior report is named and dated.

### 0.7 The seven reports

| file | contents | maps to |
|---|---|---|
| `audit/2026-10-19-00-index-and-method.md` | this file | Step 0 |
| `audit/2026-10-19-01-system-and-data-flow.md` | Report 1 — architecture, the full persisted-store inventory, the prompt inventory, the tool surface, security, reliability, performance, UX, quality gates | Part A |
| `audit/2026-10-19-02-enhancements.md` | Report 2 — enhancements and improvements, ranked, each with roadmap status | Part B |
| `audit/2026-10-19-03-new-features.md` | Report 3 — new features by trader workflow, ranked, each with roadmap status | Part C |
| `audit/2026-10-19-04-cleanup-manifest.md` | Report 4 — the cleanup manifest, the batches, the docs audit table | Part D |
| `audit/2026-10-19-05-ordering-and-open-questions.md` | the interleaved order, go/no-go per batch, open questions only the owner can answer, and the coverage statement | Output items 6–8 |

### 0.8 A note on the previous audit — and on `docs/analysis/`

The brief said to read "the gap reports in `docs/analysis/`". **That directory does not exist at
the pin.** It has never been committed to `main`.

It *does* exist, and this is worth knowing: four dangling commits — `508b691a`, `7478c4c0`,
`aff83bcd`, `257e1237`, all titled `untracked files on cline checkpoint`, dated 2026-10-18 — carry
a `docs/analysis/` tree with `00-REPORT.md`, `01-architecture.md`, `02-trading-logic.md`,
`03-prompts-harness.md`, `05-lead-findings.md`, `06-independent-review-2026-10-18.md` and a
`data/` folder of **1,176 files** (binary `_blobs/*.bin`, a `__pycache__/*.pyc`, and a 570 KB
`ls_aggregates.json`).

Those commits are **not reachable from `main`** (`git merge-base --is-ancestor 508b691a main` exits 1). **They ARE reachable from a branch: `archive/prior-audit-2026-10-18`, created 2026-10-20** (`git branch archive/prior-audit-2026-10-18 508b691a`). **That branch is what makes them gc-safe** — a branch reference keeps the objects reachable, so `git gc` can no longer prune them. It holds the **fullest** recovery, including `06-independent-review-2026-10-18.md`, which the other three do not.
exits 1; `git branch -a --contains 508b691a` is empty). They survive only because the tool that
made them has not garbage-collected yet. **A `git gc --prune=now` on the owner's machine would
delete the previous audit entirely.**

Three consequences, and they are the reason this folder's structure matters:

1. The previous audit's **lead findings** (`05-lead-findings.md`, authored against HEAD `04b4d25`)
   were read and **every material claim was re-verified against `6a41a9f7`**. The results are in
   Report 1 §7.4 and Report 2 (items E-01, E-02, E-14). Two of its findings were **resolved** in
   the 162 commits since; one was **half-resolved**; three **stand**. None of its claims were
   accepted on its word.
2. `eslint.config.js:26` already ignores `docs/analysis/**` — added by `92e77843`
   *"build(lint): ignore the untracked analysis scratch so CI's Lint step is reproducible locally"*.
   The ignore was added for a directory that was never committed. **This is the only reason the
   reports in this folder do not break the lint ratchet**, and it is load-bearing.
3. The previous audit committed a Python extraction pipeline's **scratch data** (1,176 files,
   binary blobs, a `.pyc`) into git. That is the anti-pattern this audit deliberately repeats
   nowhere: **these seven reports are markdown only, and every measurement artefact lives outside
   the repository** at `%TEMP%\august-audit\`.

---

## 0.9 Repository shape at the pin (measured)

| metric | value | how |
|---|---|---|
| tracked files | 1,131 | `git ls-files \| wc -l` |
| tracked source files (`.ts`/`.tsx`/`.cjs`/`.mjs`/`.js`) | 1,018 | `git ls-files` filtered |
| total source LOC (tracked, excluding tests) | **134,247** | per-file line count **including blank lines** |
| total test LOC | **79,154** | same |
| total source LOC incl. tests | **213,401** | — |
| `services/` | 184 files | `git ls-tree -d` |
| `components/` | 148 files, 16 subdirectories | `git ls-tree -d` |
| `hooks/` | 41 files | `git ls-tree -d` |
| `utils/` | 92 files | `git ls-tree -d` |
| `constants/` | 17 files | `git ls-tree -d` |
| `types/` | 17 files | `git ls-tree -d` |
| `tests/` | 483 tracked files — 479 `*.test.ts(x)` + 4 support files | `git ls-files tests/` |
| React contexts in the whole app | **1** (`ToastContext`) | `grep createContext` |
| Web Workers | **1** (`services/analysis/monteCarlo.worker.ts`) | `grep new Worker` |
| IPC channels | 11 `ipcMain.handle` + 1 `ipcMain.on` + 1 `contextBridge` | read of `electron/main.cjs` |
| tags | 36 (`v1.0.0`…`v1.0.33`, `v1.1.0`, `v1.2.0`) | `git tag` |
| branches | `main`, `feat/stage19-tail`; remotes: `origin/refactor/calibration-split`, `origin/stage3-ui-arrangement`, `origin/test/provider-degrade-ladder` | `git branch -a` |
| stashes | 0 | `git stash list` |
| worktrees | 1 (this one) | `git worktree list` |

### The twenty largest source files (lines) — where the complexity actually lives

| # | lines | file |
|---|---|---|
| 1 | 3,995 | `services/analysis/DeskToolsService.ts` |
| 2 | 3,915 | `services/learning/SkillMemoryService.ts` |
| 3 | 2,672 | `App.tsx` |
| 4 | 2,108 | `services/providers/GenericProviderService.ts` |
| 5 | 1,818 | `services/analysis/TechnicalAnalysisService.ts` |
| 6 | 1,730 | `services/analysis/MarketDataService.ts` |
| 7 | 1,678 | `hooks/useAnalysisPipeline.ts` |
| 8 | 1,561 | `services/backtesting/BacktestingService.ts` |
| 9 | 1,554 | `services/analysis/HybridIntelligenceService.ts` |
| 10 | 1,550 | `components/agents/AgentsView.tsx` |
| 11 | 1,486 | `utils/analysisUtils.ts` |
| 12 | 1,455 | `services/learning/MemoryFilesService.ts` |
| 13 | 1,330 | `services/backtesting/ModelPerformanceService.ts` |
| 14 | 1,245 | `services/analysis/CandlePatternDetector.ts` |
| 15 | 1,224 | `services/trade/chatTurnRunner.ts` |
| 16 | 1,200 | `components/trade/TradingChart.tsx` |
| 17 | 1,168 | `components/trade/TradeChatPanel.tsx` |
| 18 | 1,145 | `components/trade/TradeView.tsx` |
| 19 | 1,128 | `services/learning/MemoryRetrievalService.ts` |
| 20 | 1,104 | `services/providers/GenericAnalysisService.ts` |

> **A note on method, because it changes the numbers.** `Get-Content | Measure-Object -Line`
> counts **0 for a blank line**, so the obvious PowerShell one-liner under-counts every file by
> 5–20 %. The figures above are re-measured with a method that counts blank lines and
> cross-checked against the pin with `git cat-file --batch`. Where the working tree and the pin
> differ (the concurrent session is editing some of these), the **pin** figure is given.

**The two giants are 3,995 and 3,915 lines each** — together 7,910 lines, 5.9 % of the source, in
two files that are each larger than the entire `components/journal` directory.
`DeskToolsService.ts` is also the **largest script-like artefact in the repo at 217 KB** and is
bigger than `App.tsx`.

### The two largest *non-application* files, which are a smell in their own right

| file | size | why it matters |
|---|---|---|
| `scripts/render-probe.cjs` | **138 KB** | a gate script larger than `App.tsx`'s predecessor. It is the strongest gate in the repo and it is a 3,000-line CJS file with no type checking (it is excluded from `tsconfig.json` and from the main eslint config — it gets its own narrow config, `scripts/eslint.config.mjs`). |
| `scripts/check-flow-doc-anchors.cjs` | **58 KB** | the doc-anchor gate. `tsconfig.json` excludes `scripts/`, and `tsconfig.scripts.json` includes only `scripts/**/*.ts` — one file (`scripts/test-candle-history.ts`). So **~6,200 lines of `.cjs` gate logic get no type checking**; `guards.yml` compensates with `node --check` and a separate lint config. |

---

## 0.9b What changed after this audit was filed — the plan-document cleanup

**Executed 2026-10-19, on the owner's instruction:** *"scan all md plan in docs and find what still
not implemented and merge it to the full audit, if its implemented and stale delete it."*

- **18 plan documents were deleted** (all of `docs/plans/` except the dated history ledger, plus
  `docs/desk/README.md` and the two root plan files). Every deletion is a tracked `git rm` — one
  `git revert` away.
- **Their still-open items were harvested into `open-items.md`** — **121** open
  items (O-01…O-129) + **24** owner decisions (D-01…D-24), each with the `file:line` that proves
  it is open at HEAD, plus the **5 prior-audit rows that did not survive re-verification** and the
  **11 rows this audit's own coverage passes added** (O-111…O-129).
- **17 code/test comments** that named a deleted document were repointed at the register.
- **`docs/plans/debate-deletion-status.md` was KEPT** because
  `scripts/check-flow-doc-anchors.cjs:44` scans it — deleting it breaks a gate.
- **The 7 committed PNGs were kept** — they are the only committed screenshots of this app.
- Gates after the change: **`typecheck` exit 0 · `lint:loose` 677 warnings / 0 errors · `test`
  471 files, 4,660 tests, all pass, exit 0** · **`check-flow-doc-anchors` exit 0, 296 anchors
  verified, 0 unattributed** — and its agents-census arm reports **"0 AGENTS.md claim(s) disagree
  with the tree"**.
- **The 18 deletions are STAGED, not committed.** They are one `git revert` from being undone.

**Full record: Report 4 §14.**
## 0.10 One-paragraph orientation for a reader who has not seen the code

August Trading is a **single-window Electron/React desktop app** (plus a Capacitor Android shell
that runs the same renderer) that acts as a *trading operator*, not a broker. The trader talks to
it in a Chat surface; the app retrieves their notebook (skills, rules, doctrine, profile memory),
their trade history and live market data; a seat model reasons over that and can call **tools**
(fetch indicators, scan setups, read the journal, present a trade); a deterministic **gate** then
decides whether the presented plan is loggable; the trader presses one button to log it; the
outcome engine resolves it against the tape; and a learning loop writes the result back into the
notebook. **No order is ever placed and the app has no exchange write access** — the only writes
that leave the machine are the provider and market-data HTTP calls, and the only local writes are
to the trader's own storage. The single most important thing this audit found is that the
**reading half of that learning loop is assembled and then thrown away on every send** — see
Report 1 §7.3, finding **F-01**.

---

## 0.11 Addendum — the repository moved after the pin, and what that changes

**Written at 2026-10-19 22:15, after the deliverables were first filed.**

### The move

**Two more commits landed after the pin:**

| commit | subject | what it did |
|---|---|---|
| `6e1e09bb` | `feat(desk)!: delete the analyst-role system and migrate stored profiles` | the Analyst Lens / analyst-role system, deleted, with a **stored-profile migration** |
| `69c4aa33` | `chore(desk): remove the last role/lens vocabulary residue` | the last role/lens vocabulary |

`87 files changed, 5,303 insertions(+), 4,073 deletions(-)`. **The working tree is now clean** (one dirty path: `package-lock.json`).

`AGENTS.md`'s own census has already moved: it now reads *"4660 tests in 471 files: 4660 pass in 471 and 0 skip across 0 wholly-skipped files … after the analyst-role/lens deletion removed 8 files and 85 tests, and the roster-migration test added one."*

### Does the audit still hold?

**Yes — the substance holds; only line numbers moved.** Re-verified against the new HEAD:

| finding | at the pin | at the new HEAD | verdict |
|---|---|---|---|
| **F-01** — the assembled context is discarded | `useAnalysisPipeline.ts:1103` | `:1052` (`let enhancedPrompt = promptToSend;`), `:1059`, `:1081` | **STANDS** |
| **F-11** — the gate scores R:R from `takeProfit[0]` | `TradeValidationGate.ts:589` | `:589` (`const takeProfit1 = parsePrice(analysis.takeProfit[0]?.price \|\| '') \|\| 0;`) | **STANDS** |
| **F-13** — no cost model | 3 files, no fee term | **0 files** with `takerFee\|makerFee\|costBps\|feeRate` | **STANDS** |
| `formatHarnessNotesBlock` — the orphaned prompt reader | definition only | definition only | **STANDS** |
| **F-14** — the roster store was read but never written | 3 call sites | the whole `BotRegistry` is gone | **RESOLVED by the in-flight work** |
| **F-10** — the analysis prompt never reaches a trader-facing answer | skill-eval only | unchanged | **STANDS** |
| the `LENS_SWING/SCALP/POSITION` prompts | live / dead / dead | **all gone** | **RESOLVED** |
| the 4 orphan modules | 4 | **1** (`AvoidSetupsSection.tsx`); `MemoryConsolidationService.ts` may now be reachable | **partly resolved** — **re-run the sweep** |
| the 63 dead exports | 63 | **fewer** (the lens exports are gone) | **re-run the sweep** |

### What the move *resolves* from the cleanup manifest

These HOLD items are now decidable, and they resolve **towards deletion**, not towards keeping:

| item | verdict now |
|---|---|
| `services/ui/AnalystLensService.ts` (9 dead exports) | **the file is gone.** Delete the leftovers in one pass (Report 4 §10). |
| `constants/prompts/lensRolePrompts.ts` (9,461 chars of lens prompts) | **gone.** |
| `utils/thinkingLens.ts`, `types/lens.ts`, `services/learning/lensMemory.ts` | **gone.** |
| `services/agents/seatPersonas.ts` | **gone** (the file). |
| `utils/debateEnvelopes.ts`, `utils/teamRoster.ts`, `types/bot.ts`, `services/bots/BotRegistry.ts` | **gone.** |
| `custom_lens_prompts` / `custom_ensemble_prompt` split read/write (Report 4 §2.3) | **the reader is gone** — so the *native-never-applies* bug is moot. But the **JSON-quoted-on-web** half is a separate defect and may survive. **Re-check.** |
| the `LENS_*` prompt constants | **gone** — the dead-prompt budget in Report 1 §3.3 drops by ~9,461 chars. |

### What the move *changes* that needs a re-run

**Do not apply the cleanup manifest's Batch 2/3 tables to the new HEAD without re-running the four sweeps.** Specifically:

1. `services/learning/MemoryConsolidationService.ts` — the claim *"the pruners are called from `AlgorithmicMemoryService.ts`"* was **false at the pin** (Report 4 §1.1 #2) and `AlgorithmicMemoryService.ts` is in the changed set. **Re-verify before deciding re-wire vs delete.**
2. The orphan set, the dead-export set and the localStorage/Preferences census have all changed. The **method** in Report 4 §0 is unchanged — only the results need re-running.
3. `AGENTS.md`'s census (4,741 → 4,660) means the **doc-anchor gate's** "agents-census" arm will now fail until `AGENTS.md` is updated — **that is Phase 0 / Batch 1 work, and the lens deletion has just made it necessary.**

### The one conclusion that does **not** change

**F-01 — the context is assembled and discarded — is now the app's single most load-bearing defect, and it is now the *only* one left of its kind.** With the analyst-role system gone, there is exactly one retrieval path, one prompt assembly, and one send — and the retrieval still does not reach the wire. **The fix (E-01) and the ledger honesty fix (E-05) are now unblocked by the deletion, not complicated by it.**

**⇒ The recommended order in Report 5 stands, with one change: Phase 0 item 0.1 ("let the in-flight work land") is now COMPLETE. Start at 0.2 — re-anchor to `69c4aa33`, re-run the four sweeps, and diff them against Report 4's tables before starting any batch.**

---

## 0.12 A note on how these files entered git — read this if you see them in a commit

**I did not commit anything.** The brief prohibited it, and I did not. But the concurrent session's
commit **`6e1e09bb` (`feat(desk)!: delete the analyst-role system and migrate stored profiles`)**
used a broad `git add`, and it **swept all six of these reports into that commit** alongside its
own 87-file change.

**Verified:** `git show --name-only 6e1e09bb` lists all six `docs/analysis/2026-10-19-*.md` files
among its 87 changed paths.

**Current state of the working tree (as of 22:20):**

| file | git state | why |
|---|---|---|
| `audit/2026-10-19-00-index-and-method.md` | **` M` (modified)** | committed at its pre-addendum length; the §0.11 and §0.12 addenda are uncommitted |
| `audit/2026-10-19-02-enhancements.md` | **` M` (modified)** | committed at its pre-addendum length; the §3B addendum is uncommitted |
| `audit/2026-10-19-04-cleanup-manifest.md` | **` M` (modified)** | committed at its pre-addendum length; the §12 addendum is uncommitted |
| `audit/2026-10-19-01-system-and-data-flow.md` | clean | committed, unchanged since |
| `audit/2026-10-19-03-new-features.md` | clean | committed, unchanged since |
| `audit/2026-10-19-05-ordering-and-open-questions.md` | clean | committed, unchanged since |

**What this means for you:**

1. **The read-only constraint was honoured by me** — every byte I wrote is inside `docs/analysis/`,
   and I ran no git write of any kind. The commit was the other session's.
2. **The reports are now in `main`'s history**, which is a reasonable place for them to be, but it
   was not my decision to make. If you would rather they were not in the tree, they can be removed
   with a single revert of `6e1e09bb`'s `docs/analysis/` paths — **or** left, since the
   `eslint.config.js:26` ignore already treats the directory as expected.
3. **The three uncommitted modifications are mine and are safe to commit or discard at your
   discretion.** They are only the three addenda that close the coverage gaps (this section, §0.11,
   Report 2 §3B, Report 4 §12).
4. **This is also, incidentally, the second time the previous audit's reports were lost to a
   dangling commit.** The 2026-10-18 generation survived only because nothing swept it into
   `main`. **The 2026-10-19 generation is safe** — for the opposite reason.
