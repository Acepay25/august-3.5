# August Trading — full deep-dive audit (single reading copy)

**Date:** 2026-10-19  **Audit baseline:** `6a41a9f7`  **Current HEAD:** `56639b4b`  **Working tree:** 60 changed paths (30 staged, 30 unstaged)
**Repo:** `C:\Dev\august-3.5`  **Nature:** READ-ONLY — the only files created are the reports under `docs/plan/`.

> **This is a reading copy.** It is the seven sources concatenated in order, with the heading levels
> adjusted so the document has one valid hierarchy and unique anchors. **The sources remain the
> source of truth** at `docs/plan/audit/` and `docs/plan/open-items.md`. Nothing was rewritten;
> only heading levels and the section-number prefixes were changed.

**How the numbering maps.** Part A is *Report 1*, B is *Report 2*, C is *Report 3*, D is *Report 4*,
E is *Report 5*, F is the *open-items register*, and `0` is the index. **In-text cross-references
inside the reports ("Report 4 §8.1") are unchanged and still resolve** — read "Report 4" as "Part D"
and the section number as-is.

---

## Contents

| part | source | what it is |
|---|---|---|
| **0** | [`audit/2026-10-19-00-index-and-method.md`](audit/2026-10-19-00-index-and-method.md) | the exact commit, the tree state, the tools, what could not be run |
| **A** | [`audit/2026-10-19-01-system-and-data-flow.md`](audit/2026-10-19-01-system-and-data-flow.md) | architecture, the store inventory, the prompt inventory, the tool surface, security, reliability, performance, UX, quality gates |
| **B** | [`audit/2026-10-19-02-enhancements.md`](audit/2026-10-19-02-enhancements.md) | 39 enhancements, ranked, each with roadmap status |
| **C** | [`audit/2026-10-19-03-new-features.md`](audit/2026-10-19-03-new-features.md) | 20 new features by trader workflow |
| **D** | [`audit/2026-10-19-04-cleanup-manifest.md`](audit/2026-10-19-04-cleanup-manifest.md) | the cleanup manifest, 8 batches, the 34-row docs audit |
| **E** | [`audit/2026-10-19-05-ordering-and-open-questions.md`](audit/2026-10-19-05-ordering-and-open-questions.md) | the interleaved order, go/no-go, 14 open questions, coverage |
| **F** | [`open-items.md`](open-items.md) | **the consolidated open-items register** — **121** open items (O-01…O-129) + **24** owner decisions, each with the `file:line` that proves it is open |

### Section index

| part | section | |
|---|---|---|
| **0** | [0](#0-step-0--the-exact-commit-the-tree-state-and-the-tools) | Step 0 — the exact commit, the tree state, and the tools |
| **0** | [0.0](#00-the-baseline-stated-once) | The baseline, stated once |
| **0** | [0.9](#09-repository-shape-at-the-pin-measured) | Repository shape at the pin (measured) |
| **0** | [0](#0-09b-what-changed-after-this-audit-was-filed--the-plan-document-cleanup) | 0.9b What changed after this audit was filed — the plan-document cleanup |
| **0** | [0.10](#010-one-paragraph-orientation-for-a-reader-who-has-not-seen-the-code) | One-paragraph orientation for a reader who has not seen the code |
| **0** | [0.11](#011-addendum--the-repository-moved-after-the-pin-and-what-that-changes) | Addendum — the repository moved after the pin, and what that changes |
| **0** | [0.12](#012-a-note-on-how-these-files-entered-git--read-this-if-you-see-them-in-a-commit) | A note on how these files entered git — read this if you see them in a commit |
| **A** | [A1](#a1-architecture-map) | Architecture map |
| **A** | [A2](#a2-persisted-stores--the-full-inventory) | Persisted stores — the full inventory |
| **A** | [A3](#a3-the-prompt-inventory) | The prompt inventory |
| **A** | [A4](#a4-trading-logic-end-to-end) | Trading logic, end to end |
| **A** | [A5](#a5-the-tool-surface) | The tool surface |
| **A** | [A6](#a6-security-and-privacy) | Security and privacy |
| **A** | [A7](#a7-reliability) | Reliability |
| **A** | [A8](#a8-performance) | Performance |
| **A** | [A9](#a9-ux-and-accessibility) | UX and accessibility |
| **A** | [A10](#a10-quality-gates) | Quality gates |
| **A** | [A11](#a11-supplement--the-security-reliability-and-performance-detail) | Supplement — the security, reliability and performance detail |
| **A** | [A12](#a12-two-feature-deep-dives) | Two feature deep dives |
| **A** | [A12.4](#a124-what-happens-to-a-skill-that-does-not-follow-the-format-or-is-too-vague) | What happens to a skill that does not follow the format, or is too vague |
| **B** | [B1](#b1-the-five-findings-that-decide-everything-else) | The five findings that decide everything else |
| **B** | [B2](#b2-quick-wins--small-effort-real-impact) | Quick wins — small effort, real impact |
| **B** | [B3](#b3-medium-projects) | Medium projects |
| **B** | [B4](#b4-big-bets) | Big bets |
| **B** | [B5](#b5-ranked-list) | Ranked list |
| **B** | [B6](#b6-what-is-deliberately-not-proposed) | What is deliberately **not** proposed |
| **B** | [B7](#b7-coverage-note) | Coverage note |
| **B** | [B](#b-3a-a-second-wave--from-the-security-reliability-and-performance-pass) | 3A. A second wave — from the security, reliability and performance pass |
| **B** | [B](#b-3b-the-five-part-b-areas-the-first-draft-under-covered) | 3B. The five Part B areas the first draft under-covered |
| **B** | [B](#b-3c-cross-check-against-the-previous-audit-and-the-items-it-found-that-i-missed) | 3C. Cross-check against the previous audit, and the items it found that I missed |
| **B** | [B](#b-3d-the-three-new-features-as-proposals) | 3D. The three new features, as proposals |
| **B** | [B](#b-3e-two-additions-the-malformed-skill-question-forces) | 3E. Two additions the malformed-skill question forces |
| **C** | [C1](#c1-prep--before-the-session-the-trader-knows-what-is-in-play) | PREP — before the session, the trader knows what is in play |
| **C** | [C2](#c2-scan--find-the-setup-not-the-chart) | SCAN — find the setup, not the chart |
| **C** | [C3](#c3-plan--the-proposal-becomes-something-the-trader-can-shape) | PLAN — the proposal becomes something the trader can shape |
| **C** | [C4](#c4-manage--the-plan-while-it-is-live) | MANAGE — the plan while it is live |
| **C** | [C5](#c5-journal--the-record-that-explains-itself) | JOURNAL — the record that explains itself |
| **C** | [C6](#c6-review--the-loop-closes) | REVIEW — the loop closes |
| **C** | [C7](#c7-improve--the-loop-that-makes-the-next-session-better) | IMPROVE — the loop that makes the next session better |
| **C** | [C8](#c8-ranked) | Ranked |
| **C** | [C9](#c9-only-worth-building-after-real-data-exists) | Only worth building after real data exists |
| **C** | [C10](#c10-what-is-deliberately-not-proposed) | What is deliberately **not** proposed |
| **C** | [C11](#c11-the-two-new-user-facing-features) | The two new user-facing features |
| **D** | [D1](#d1-dead-code) | Dead code |
| **D** | [D2](#d2-dead-and-duplicate-data-paths) | Dead and duplicate data paths |
| **D** | [D3](#d3-prompts-and-copy) | Prompts and copy |
| **D** | [D4](#d4-tests) | Tests |
| **D** | [D5](#d5-dependencies) | Dependencies |
| **D** | [D6](#d6-scripts-config-and-build) | Scripts, config and build |
| **D** | [D7](#d7-assets-and-repo-hygiene) | Assets and repo hygiene |
| **D** | [D8](#d8-the-docs-audit) | The docs audit |
| **D** | [D9](#d9-the-batches) | The batches |
| **D** | [D10](#d10-items-that-overlap-the-roadmap--do-not-clean-these-blindly) | Items that OVERLAP the roadmap — do not clean these blindly |
| **D** | [D11](#d11-what-this-manifest-deliberately-does-not-propose) | What this manifest deliberately does **not** propose |
| **D** | [D12](#d12-addendum--three-gaps-the-first-draft-of-this-manifest-left-open) | Addendum — three gaps the first draft of this manifest left open |
| **D** | [D13](#d13-addendum--the-orphan-class-neither-audit-had-named-and-one-stale-comment) | Addendum — the orphan class neither audit had named, and one stale comment |
| **D** | [D14](#d14-addendum--the-plan-document-cleanup-executed) | Addendum — the plan-document cleanup, executed |
| **D** | [D15](#d15-the-test-removal-plan) | The test-removal plan |
| **E** | [E1](#e1-the-one-paragraph-version) | The one-paragraph version |
| **E** | [E2](#e2-the-recommended-order) | The recommended order |
| **E** | [E3](#e3-go--no-go-per-batch) | Go / no-go per batch |
| **E** | [E4](#e4-open-questions--only-the-owner-can-answer-these) | Open questions — only the owner can answer these |
| **E** | [E5](#e5-coverage-statement) | Coverage statement |
| **E** | [E6](#e6-what-this-audit-believes-in-one-page) | What this audit believes, in one page |
| **E** | [E7](#e7-cross-check-against-the-previous-audit--does-the-current-plan-contradict-it) | Cross-check against the previous audit — **does the current plan contradict it?** |
| **E** | [E8](#e8-the-three-new-features-in-the-order) | The three new features, in the order |
| **F** | [F0](#f0-how-this-register-was-built) | How this register was built |
| **F** | [F1](#f1-the-register) | The register |
| **F** | [F2](#f2-what-each-deleted-document-contributed-and-where-it-went) | What each deleted document contributed, and where it went |
| **F** | [F3](#f3-unique-content-rescued-before-deletion) | Unique content rescued before deletion |
| **F** | [F4](#f4-how-to-restore-anything) | How to restore anything |
| **F** | [F5](#f5-what-was-not-deleted-and-why) | What was NOT deleted, and why |
| **F** | [F1.10](#f110-four-items-the-first-pass-of-this-register-missed) | Four items the first pass of this register missed |
| **F** | [F1.11](#f111-rows-the-deletion-itself-closed) | Rows the deletion itself closed |

---

## The two-minute version

**August Trading is a well-built app with a well-built memory system and a broken connection
between them.** The code quality is high — the Electron hardening is genuinely good, the retry
layer is genuinely well engineered, the notebook's write-failure handling is genuinely correct, the
migration layer genuinely cannot lose data, the atomicity is real, and the eslint suppression
profile is clean. The gates are real too, and two of them (`render-probe`, `skill-approval-probe`)
are better than most commercial repos will ever write.

**And in the middle of that, the loop does not close.** The app assembles a rich, carefully
budgeted, carefully instrumented context on every send — and sends something else. It records that
the model saw skills it did not see, and credits them anyway. It computes three different planned
risk:reward ratios for the same plan and grades it with one while displaying another. It has no
cost model, so every number the trader sees is gross. And its validation gate — 20 checks, a
confidence ladder, a probability clamp — has **no production importer**, which may mean the
simplest gate is the only one that runs.

**The gap between the app's ambition and its wiring is the whole finding.** And the reason it
survived is the reason the app is good: **the gates are excellent at proving that the code they
can see works, and the blind spot is exactly where the defects live** — a prompt that is built but
not sent, a module that is tested but not imported, a number that is computed but not read, a
document that is written but not believed.

**The five findings that decide everything else:**

| # | finding | severity |
|---|---|---|
| **F-01** | the assembled context is computed and **discarded** on every send | **HIGH** |
| **F-01b** | the injection ledger therefore **records skills the model never received** | **HIGH** |
| **F-11** | the validation gate scores R:R from `takeProfit[0]`; the card uses the **nearest** target | **HIGH** |
| **F-13** | **there is no cost model** — every R, win rate and calibration bucket is gross | Med-High |
| **F-10** | the analysis prompt **never reaches a trader-facing answer** | Med-High |

**The recommendation is narrow and unglamorous: make the gates reach the code they cannot
currently see, and then fix what they find.** Four tests that assert what is *sent*. `noUncheckedIndexedAccess`
and `noUnusedLocals` on. A re-tightened lint ratchet. A key-scoped backup check. A behavioural
test for the Electron shell. **Then** the four decisions that only the owner can make — the
context, the click, the fee tier, and the backup contract — and then the loop closes.

---

## Part 0 — Step 0 — the commit, the method, and the coverage

<sub>Source: `docs/plan/audit/2026-10-19-00-index-and-method.md`</sub>

<!-- original part title: August Trading — deep-dive audit: index, method, and coverage -->

**Date:** 2026-10-19
**Subject:** the `august-trading` repository at `C:\Dev\august-3.5`
**Nature:** READ-ONLY. Nothing in the repository was modified, deleted, moved or renamed. The only
files created are the seven reports in this folder.

---

### 0. Step 0 — the exact commit, the tree state, and the tools


---

### 0.0. The baseline, stated once

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
#### 0.1 The commit

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

#### 0.2 The tree moved twice while the audit ran — and how that was handled

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

#### 0.3 Working tree state at the pin

| path | state at pin | note |
|---|---|---|
| `package-lock.json` | **dirty** (uncommitted) | the working-tree copy bumps the lock to `1.3.0` and adds `js-yaml` to the root devDependencies block. The **committed** lockfile still says `1.0.30` and lacks `js-yaml` in the root block. See Report 4, batch 5. |
| all 1,130 other tracked paths | clean at the pin | except the 21 paths the concurrent session later dirtied |

#### 0.4 Tools and where they ran

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

#### 0.5 What could NOT be run, and why

| not run | why it matters | how to close it |
|---|---|---|
| the app itself | no live behaviour was observed; every runtime claim in these reports is code-reading | run the packaged app against a throwaway profile |
| `render-probe` / `boot-probe` / `skill-approval-probe` | the three strongest gates (per `AGENTS.md`) were not executed, so "the rendered row count is right" is unverified | `npm run render-probe` on an idle machine |
| `npm run e2e` (Playwright) | needs a dev server + Chromium | same |
| `npm audit` | network access + it would need a lockfile write to be useful | run in a throwaway copy |
| `npm run test:coverage` | writes a coverage report and is slow; the floors in `vitest.config.ts` are therefore *reasoned about*, not measured | run in a throwaway copy |
| any read of the live `userData` / SQLite / localStorage | **prohibited by the brief**; the prior audit did read it on 2026-10-18 and its numbers are reported here as *that* audit's, not as ours | see the "n = 0 resolved trades" item in Report 1 §2.6 |
| the deleted-in-flight bot subsystem | the concurrent session is actively rewriting it; auditing it now would describe a moving target | re-audit after the concurrent session lands |

#### 0.6 Labelling used in every report

| label | meaning |
|---|---|
| **[Verified live]** | I ran it or measured it — a command, a count, a byte size, a timing |
| **[Verified by code reading]** | read at `file:line`; the behaviour is deterministic from the source, but not observed running |
| **[Unverified — needs X]** | a claim that needs a specific thing I could not do — stated in full every time |

**No number in these reports is invented.** Where a number is an estimate it says so and names the
method. Where a prior report's number is quoted, the prior report is named and dated.

#### 0.7 The seven reports

| file | contents | maps to |
|---|---|---|
| `audit/2026-10-19-00-index-and-method.md` | this file | Step 0 |
| `audit/2026-10-19-01-system-and-data-flow.md` | Report 1 — architecture, the full persisted-store inventory, the prompt inventory, the tool surface, security, reliability, performance, UX, quality gates | Part A |
| `audit/2026-10-19-02-enhancements.md` | Report 2 — enhancements and improvements, ranked, each with roadmap status | Part B |
| `audit/2026-10-19-03-new-features.md` | Report 3 — new features by trader workflow, ranked, each with roadmap status | Part C |
| `audit/2026-10-19-04-cleanup-manifest.md` | Report 4 — the cleanup manifest, the batches, the docs audit table | Part D |
| `audit/2026-10-19-05-ordering-and-open-questions.md` | the interleaved order, go/no-go per batch, open questions only the owner can answer, and the coverage statement | Output items 6–8 |

#### 0.8 A note on the previous audit — and on `docs/analysis/`

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

### 0.9. Repository shape at the pin (measured)

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

#### The twenty largest source files (lines) — where the complexity actually lives

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

#### The two largest *non-application* files, which are a smell in their own right

| file | size | why it matters |
|---|---|---|
| `scripts/render-probe.cjs` | **138 KB** | a gate script larger than `App.tsx`'s predecessor. It is the strongest gate in the repo and it is a 3,000-line CJS file with no type checking (it is excluded from `tsconfig.json` and from the main eslint config — it gets its own narrow config, `scripts/eslint.config.mjs`). |
| `scripts/check-flow-doc-anchors.cjs` | **58 KB** | the doc-anchor gate. `tsconfig.json` excludes `scripts/`, and `tsconfig.scripts.json` includes only `scripts/**/*.ts` — one file (`scripts/test-candle-history.ts`). So **~6,200 lines of `.cjs` gate logic get no type checking**; `guards.yml` compensates with `node --check` and a separate lint config. |

---

### 0. 0.9b What changed after this audit was filed — the plan-document cleanup

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
### 0.10. One-paragraph orientation for a reader who has not seen the code

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

### 0.11. Addendum — the repository moved after the pin, and what that changes

**Written at 2026-10-19 22:15, after the deliverables were first filed.**

#### The move

**Two more commits landed after the pin:**

| commit | subject | what it did |
|---|---|---|
| `6e1e09bb` | `feat(desk)!: delete the analyst-role system and migrate stored profiles` | the Analyst Lens / analyst-role system, deleted, with a **stored-profile migration** |
| `69c4aa33` | `chore(desk): remove the last role/lens vocabulary residue` | the last role/lens vocabulary |

`87 files changed, 5,303 insertions(+), 4,073 deletions(-)`. **The working tree is now clean** (one dirty path: `package-lock.json`).

`AGENTS.md`'s own census has already moved: it now reads *"4660 tests in 471 files: 4660 pass in 471 and 0 skip across 0 wholly-skipped files … after the analyst-role/lens deletion removed 8 files and 85 tests, and the roster-migration test added one."*

#### Does the audit still hold?

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

#### What the move *resolves* from the cleanup manifest

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

#### What the move *changes* that needs a re-run

**Do not apply the cleanup manifest's Batch 2/3 tables to the new HEAD without re-running the four sweeps.** Specifically:

1. `services/learning/MemoryConsolidationService.ts` — the claim *"the pruners are called from `AlgorithmicMemoryService.ts`"* was **false at the pin** (Report 4 §1.1 #2) and `AlgorithmicMemoryService.ts` is in the changed set. **Re-verify before deciding re-wire vs delete.**
2. The orphan set, the dead-export set and the localStorage/Preferences census have all changed. The **method** in Report 4 §0 is unchanged — only the results need re-running.
3. `AGENTS.md`'s census (4,741 → 4,660) means the **doc-anchor gate's** "agents-census" arm will now fail until `AGENTS.md` is updated — **that is Phase 0 / Batch 1 work, and the lens deletion has just made it necessary.**

#### The one conclusion that does **not** change

**F-01 — the context is assembled and discarded — is now the app's single most load-bearing defect, and it is now the *only* one left of its kind.** With the analyst-role system gone, there is exactly one retrieval path, one prompt assembly, and one send — and the retrieval still does not reach the wire. **The fix (E-01) and the ledger honesty fix (E-05) are now unblocked by the deletion, not complicated by it.**

**⇒ The recommended order in Report 5 stands, with one change: Phase 0 item 0.1 ("let the in-flight work land") is now COMPLETE. Start at 0.2 — re-anchor to `69c4aa33`, re-run the four sweeps, and diff them against Report 4's tables before starting any batch.**

---

### 0.12. A note on how these files entered git — read this if you see them in a commit

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


<div style="page-break-after: always"></div>

---

## Part A — Report 1 — How August Trading actually works today

<sub>Source: `docs/plan/audit/2026-10-19-01-system-and-data-flow.md`</sub>

<!-- original part title: Report 1 — How August Trading actually works today -->

**Pinned commit:** `6a41a9f7e3b3986236c3000862d326f1e95dfad1` (branch `main`)
**Date:** 2026-10-19
**Part A of the brief** — architecture, persisted stores, prompts, trading logic, tool surface,
security, reliability, performance, UX, quality gates.

Labelling: **[Verified live]** = measured; **[Verified by code reading]** = `file:line`;
**[Unverified — needs X]** = what would settle it. See `audit/2026-10-19-00-index-and-method.md` §0.6.

---

### A1. Architecture map

#### 1.1 Entry points

| entry | file | what it does |
|---|---|---|
| Browser / WebView root | `index.html` | owns the `#splash` element, loads `/index.tsx` |
| Renderer mount | `index.tsx` (92 lines) | mounts `<App/>` under `ErrorBoundary` → `ToastProvider` → `React.StrictMode` (`index.tsx:71-80`) |
| Application root | `App.tsx` (2,499 lines) | the whole shell: surface router, 41 hooks, the chat composer, the settings surface |
| Electron main | `electron/main.cjs` (1,362 lines) | `app://` protocol handler, provider egress, `safeStorage`, auto-updater, window state |
| Electron preload | `electron/preload.cjs` (52 lines) | the **only** privileged surface: one `contextBridge.exposeInMainWorld('electronAPI', …)` |
| Electron SSE parser | `electron/sseParser.cjs` | the provider stream parser, shared by main |
| Shared wire policy | `shared/providerRequestPolicy.cjs` (466 lines) | the ONE request policy, imported by the renderer, the Vite dev proxy **and** the Electron main |
| Capacitor config | `capacitor.config.ts` | `appId com.august35.tradingapp`, `webDir dist`, https scheme, cleartext off |
| Android host | `android/` (57 tracked files) | **no application source** — the Capacitor Gradle host plus one custom plugin |
| E2E | `e2e/smoke.spec.ts` | one Playwright spec |
| Operational | `scripts/` (18 files) | probes, gates, release helpers — not app code |

**[Verified by code reading]** `android/app/src/main/java/com/august35/tradingapp/` contains only
`MainActivity.java` and `GallerySaverPlugin.java`; all application logic is the shared renderer.

#### 1.2 Process boundaries

```
╔═ ELECTRON MAIN (electron/main.cjs) ══════════════════════════════════════════════╗
║ app:// protocol handler  :912                                              ║
║ provider:chat (net.fetch, safe-redirect policy)  :1240                     ║
║ crypto:encrypt / crypto:decrypt (safeStorage)  :1279 / :1289              ║
║ update:check / :download / :install / :quit-now / :get-status  :1149-1217  ║
║ userData/window-state.json  :88, :92, :125                                  ║
║ legacy "August 3.5" → "August Trading" migration  :49-79                    ║
║ shared/providerRequestPolicy.cjs  ← the ONE wire policy                      ║
╚════════╤═════════════════════╤═════════════════════╤═════════════════════════╝
         │ app:// (renderer)   │ ipcRenderer.invoke  │ ipcRenderer.on
╔════════╧═════════════════════╧═════════════════════╧═════════════════════════╗
║ PRELOAD electron/preload.cjs — exposeInMainWorld('electronAPI')            ║
║ 15 methods: getVersion, isElectron, platform, checkForUpdates,             ║
║ downloadUpdate, installUpdate, quitNow(send), getUpdateStatus,             ║
║ encryptSecret, decryptSecret, providerChat, cancelProviderChat,             ║
║ discoverModels, onProviderChunk, onUpdateStatus                             ║
╚════════╤═════════════════════╧═════════════════════════╧═════════════════════╝
         │
╔════════╧═════════════════════════════════════════════════════════════════════╗
║ RENDERER — index.tsx → App.tsx (2,499)                                       ║
║  41 hooks  ·  184 services  ·  1 React context (ToastContext)              ║
║  module singletons: chatStore · MemoryFilesService · GlobalLearningService  ║
║                     OutcomeAutopilotService · SqliteService.db              ║
║  WEB WORKER: services/analysis/monteCarlo.worker.ts (59 lines)             ║
║  PERSISTENCE — 5 backends: localStorage │ Capacitor Preferences │ IndexedDB  ║
║               │ Capacitor SQLite │ Capacitor Filesystem                    ║
╚════════╤═════════════════════════════════════════════════════════════════════╝
         │  the SAME renderer code, different storage backends
╔════════╧═════════════════════════════════════════════════════════════════════╗
║ ANDROID WEBVIEW (Capacitor host, https scheme, cleartext disabled)          ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

**The consequential boundary is the Capacitor one, not the Electron one.** On desktop, localStorage
and Capacitor Preferences are the same store. On Android they are **two different places** (the
WebView origin vs SharedPreferences/UserDefaults), and that single fact is the mechanical cause of
the whole "mobile backup loses data" class of bugs in §2.6.

**[Verified live]** `grep createContext` across the whole repository returns **one** hit
(`components/shared/Toast.tsx:30`). There is no redux, no zustand, no jotai, no recoil.

#### 1.3 The IPC surface — complete

**[Verified by code reading]** `electron/preload.cjs` + `electron/main.cjs`:

| # | preload method (file:line) | channel | main handler (file:line) | what it can do |
|---|---|---|---|---|
| 1 | `getVersion` `preload:11` | `app:get-version` | `main:1219` | read the app version |
| 2 | `isElectron` `preload:12` | — | — | (local constant) |
| 3 | `platform` `preload:13` | — | — | (local constant) |
| 4 | `checkForUpdates` `preload:16` | `update:check` | `main:1149` | network to the update feed |
| 5 | `downloadUpdate` `preload:17` | `update:download` | `main:1161` | writes into `userData/pending` |
| 6 | `installUpdate` `preload:18` | `update:install` | `main:1173` | **relaunches the app** |
| 7 | `quitNow` `preload:21` (**`send`**, fire-and-forget) | `update:quit-now` | `main:1213` (`ipcMain.on`) | quits |
| 8 | `getUpdateStatus` `preload:22` | `update:get-status` | `main:1217` | read status |
| 9 | `encryptSecret` `preload:26` | `crypto:encrypt` | `main:1279` | `safeStorage.encryptString` |
| 10 | `decryptSecret` `preload:27` | `crypto:decrypt` | `main:1289` | `safeStorage.decryptString` |
| 11 | `providerChat` `preload:31` | `provider:chat` | `main:1240` | **the provider request, from the main process** |
| 12 | `cancelProviderChat` `preload:32` | `provider:cancel` | `main:1263` | aborts an in-flight request |
| 13 | `discoverModels` `preload:33` | `provider:discover` | `main:1221` | fetches the model list from a provider |
| 14 | `onProviderChunk` `preload:39-43` | `provider:chunk` (main → renderer) | main stream path | streamed deltas |
| 15 | `onUpdateStatus` `preload:46-51` | `update-status` (main → renderer) | `main:1082` | update progress |

Totals: **11 `ipcMain.handle` + 1 `ipcMain.on` + 1 `contextBridge` + 12 `ipcRenderer.invoke` +
1 `ipcRenderer.send` + 2 `ipcRenderer.on`.**

**There is no filesystem, no SQLite and no Node bridge in the renderer.** The renderer cannot read
a file. Secrets are encrypted *in the main process* and the plaintext is decrypted back into the
renderer on demand — which is the correct shape, but it does mean the plaintext key exists in the
renderer while a request is in flight (see §6.2).

**There is a third provider transport that is not IPC:** the Vite dev proxy.
`GenericProviderService.ts:1306` → `vite.config.ts:73` (`/__provider_proxy`). It exists so the
browser can reach a provider that does not send CORS headers. In production on desktop the
Electron bridge is used; on web the raw `fetch` path is used.

#### 1.4 State: where the canonical truth lives

| kind | where | notes |
|---|---|---|
| React context | `components/shared/Toast.tsx:30` (`ToastContext`) | **the only one** |
| Module singletons | `chatStore` (`services/trade/chatStore.ts:210/216`), `AnalystLensService._lensConfigCache` (`:140`), `GlobalLearningService` (`:135`), `OutcomeAutopilotService` (`:673`), `MemoryFilesService` (`:31/250/460`), `proposalGate` in-flight map (`:85`), `SqliteService.db`, `dbService.dbPromise` | the real state layer of this app |
| Private module caches | `DeskToolsService` tool cache (30 s TTL, `TOOL_CACHE_TTL_MS` at `DeskToolsService.ts:311`) | the only import surface is `clearDeskToolCache()`, called at the top of every tool turn inside `streamChatWithDeskTools` (`DeskToolsService.ts:3772`) — verified |
| Component state | `App.tsx` and 148 components | |
| **Persisted** | SQLite/IndexedDB (profile, trades, conversations, thinking) + Preferences/localStorage (settings) + the notebook blob (skills/rules/notes) | §2 |

**There is no generic AI-response cache.** `AGENTS.md` says so, and the code agrees: the only
caches in the request path are the 30 s desk-tool cache and the provider-health cooldown.

#### 1.5 Services and hooks inventory

**[Verified live]** `services/` = 184 files, `hooks/` = 41 files.

| domain | files | notable |
|---|---|---|
| `services/learning/` | 66 | the notebook, skills, retrieval, evidence, hygiene, reviews |
| `services/trade/` | 29 | the chat turn runner, the proposal gate, the journal write path |
| `services/analysis/` | 23 | desk tools, TA, market data, Monte Carlo, hybrid packet |
| `services/infrastructure/` | 20 | SQLite, Preferences, backups, export, provider config |
| `services/validation/` | 10 | the gate, calibration, session guard |
| `services/agents/` | 8 | roster, mailbox, routines, group rounds, seat personas |
| `services/ui/` | 8 | outcome autopilot, lens, auto-capture, alerts, veto ledger |
| `services/providers/` | 6 | the one provider client, analysis, reasoning controls |
| `services/backtesting/` | 6 | backtest, model performance, live backtest, outcome engine, scenario sim, stop optimiser |
| `services/automation/` | 3 | cron, the service, the catch-up planner |
| `services/bots/` | 3 | registry, per-bot memory, memory budget |
| `services/tools/` | 1 | `toolForge` (user/model-authored HTTPS tools) |
| `services/desk/` | **1** | `idleMotion.ts` (70 lines) — a per-user "reduce motion" boolean. `AGENTS.md` is right that the 2D desk floor and its seat layout are gone and no market data lives here. |

**`services/research/` does not exist at the pin** — `git ls-tree -d --name-only HEAD services/`
returns 13 directories and `research` is not among them. `AGENTS.md`'s project-structure tree
lists `services/research/  # Fixed 4-stage web research plan`. **That line is stale.** (Report 4,
docs audit, `AGENTS.md`.)

**Four of the 41 "hooks" are not hooks.** `hooks/analysisPipeline/{memoryContext, notebookQuickSave,
runOutcome, streamThrottlers}.ts` call no React primitive — they are plain modules in a `hooks/`
directory. Harmless, but it inflates the "41 hooks" figure and it is where `memoryContext.ts` —
a 160-line retrieval assembler — hides.

#### 1.6 The actual request-sending function

**`sendChatRequest(config, messages, options)` — `services/providers/GenericProviderService.ts:1237`.**

It is the **only** place a provider request is issued. Structure:

```
sendChatRequest                     GenericProviderService.ts:1237
 └─ withRetry(…, 3)                            :1251-1392   (retry + backoff)
 └─ transport selection
    ├─ Electron:  electronAPI.providerChat     :1273  → IPC provider:chat → main.cjs:1240
    │                                              → net.fetch via policy.fetchFollowingSafeRedirects (main.cjs:230)
    ├─ Vite proxy: fetch('/__provider_proxy')   :1306  (dev only)
    └─ direct fetch by apiFormat                :1374-1387
       ├─ chatCompletionsCall  :736  → fetch :888
       ├─ messagesCall         :833  → fetch :888
       ├─ responsesCall        :947  → fetch :961
       └─ googleCall          :1016  → fetch :1063
```

Streaming entry point: **`sendChatTurn` — `GenericProviderService.ts:1407`**; desktop streams over
the bridge (`streamViaElectronBridge` `:1628`, chunk subscription `:1644`, invoke `:1663`), web
fetches directly (`:1474`), the dev proxy streams (`:1900`).

**One policy, three transports.** `shared/providerRequestPolicy.cjs` owns the thinking gates, the
temperature and the provider-URL host policy, and is imported by the renderer, the Vite dev proxy
*and* the Electron main — which is why the renderer and the main process cannot drift on what a
legal request looks like. `tests/sharedPolicyEsmExports.test.ts` pins the renderer's import
surface against the shared module.

#### 1.7 The full data flow, end to end

```
TRADER PRESSES SEND
 └─ App.tsx → hooks/useAnalysisPipeline.ts:477  handleSendMessage
    │
    ├─ [A] AUTOMATION BRANCH            :1176
    │     └─ runAutomationTurn           services/trade/automationTurn.ts:161
    │           └─ automationSeatFor     :94   (picks the seat model)
    │           └─ tool turn (same desk tools as the chat surface)
    │
    ├─ [B] BOT 1:1 BRANCH               :1316
    │     └─ streamQuickResponse        services/providers/GenericAnalysisService.ts:613
    │
    └─ [C] THE DESK (the live chat path) :1347
          └─ runChatSurfaceTurn         services/trade/chatSurfaceTurn.ts:230
                ├─ chatSurfaceSystemPrompt   :147  → surfacePromptWith :105
                │     └─ [mandate + skills index (30) + active strategies + profile-memory index]
                └─ runToolTurn            services/trade/toolTurn.ts:109
                      └─ streamChatWithDeskTools   services/analysis/DeskToolsService.ts:3754
                            └─ clearDeskToolCache()      :3772
                            └─ GenericProviderService.streamChatTurn :1407
                                  └─ sendChatRequest :1237 → fetch / IPC
```

**The tool branch — how a plan is actually born:**

```
MODEL CALLS present_trade
 └─ runPresentTrade                    services/trade/presentTradeTool.ts:75
     ├─ parseTradeProposal             services/trade/proposedTrade.ts:72   [MODEL input, D parsing]
     ├─ computeRrRatio                 proposedTrade.ts:60
     │    └─ utils/riskReward.plannedRiskReward   utils/riskReward.ts:48  [D — nearest target]
     ├─ mintPlanId                     proposedTrade.ts:67                   [D]
     ├─ beginGateScan  (NOT awaited)   services/trade/proposalGate.ts:88     [D]
     │    └─ GateKeeperService.runProgrammaticGate    :70  → {pass, confidenceCap, warnings}
     ├─ drawingsFromLevelTool          services/trade/chartDrawings.ts:370
     └─ sink.armPlan                   services/trade/levelWatchService.ts:217
 └─ sink.setProposal  → the "Log this trade" card
```

**The journal branch — the one write path:**

```
TRADER PRESSES "LOG THIS TRADE"
 └─ ensureStamp                        services/trade/proposalGate.ts:122
 └─ logTradeWithFeedback               hooks/useTradeLogging.ts:270        ← THE ONE PATH
     ├─ withDetectedTradeType          :305
     ├─ computeRMultiple               :362
     ├─ chatStore.addOpenTrade         :413
     ├─ syncClosedTradeToNotebook      services/learning/SkillMemoryService.ts:3288
     ├─ updateThinkingOutcome          :458
     ├─ GlobalLearningService.updateCalibration   :484
     ├─ trackConfluenceOutcome         :511
     ├─ autoLearnFromOutcome           :141
     └─ autoAddRecentInsight           :210
```

**The resolution branch:**

```
services/backtesting/outcomeEngine.ts:107  scanTradeOutcome
 └─ entry trigger → SL-first same-candle rule → 150 % zone → TP1 (scale out, stop → breakeven)
    → TP2/TP3 → later breakeven → OPEN
```

**Persistence:** `services/infrastructure/dbService.ts` (web / IndexedDB) and
`SqliteService.ts` (native / Capacitor SQLite) — tables `users`, `trades`, `conversations`,
`trade_summaries`, `saved_analyses`, `thinking_records`, `schema_migrations`.

#### 1.8 Prompt layering

`utils/composePrompt.ts:36` is the **only** compositor. It puts the harness contract first and
strips any nested copy of that contract from the parts it composes (`stripHarnessContract`,
`composePrompt.ts:17`) — so a contract cannot appear twice in one request.

`constants/promptRegistry.ts` (236 lines) is the **user-overridable** registry, surfaced by
`components/settings/PromptManager.tsx`.

**The layers, in the order they reach the wire:**

| layer | source | note |
|---|---|---|
| harness contract | `constants/prompts/harnessContract.ts` | always first; names the `HARNESS_TURN_MARK` by interpolation so the sentence cannot drift from the bytes |
| surface mandate | `constants/prompts/chatPrompts.ts` (`CHAT_SURFACE_SYSTEM_PROMPT`) | the desk's role |
| skills index | `utils/tradeChatContext.buildSkillsIndexForPrompt` | up to 30 rows: slug, status, kind, description, if/then |
| active strategies | `services/learning/strategyStore.activeStrategiesBlock` | |
| profile memory index | `services/learning/profileMemory.buildProfileMemoryIndex` | |
| tool schemas | `services/analysis/DeskToolsService` | the desk tools |
| history | the conversation, trimmed per surface | the desk re-sends its last ten; the Chat surface passes the whole conversation |
| the trader's turn | `promptToSend` | `useAnalysisPipeline.ts:779` |

**And one layer that is assembled and never sent** — see §7.3, finding **F-01**.

---

### A2. Persisted stores — the full inventory

#### 2.1 Method

A static scan script (written outside the repository) resolved the first argument of every
`localStorage.{getItem,setItem,removeItem}` call through the file's own constants, through
`PREF_KEYS.X`, and through one-level template builders, then compared the result against
`ExportService.RAW_LOCAL_STORAGE_PREFIXES` and the restore allow-lists.

**[Verified live]** 159 `localStorage` call sites; 61 distinct key shapes. The scan's known limits:
it cannot follow a key whose namespace is a runtime parameter
(`services/agents/agentRoster.ts:100` builds `agents_${ns}_v1_${user}`), and it does not resolve
constants across modules beyond `PREF_KEYS`. 21 of the 159 call sites resolved to `*`; the five
that mattered were hand-resolved and are marked in the table.

#### 2.2 The localStorage key space

| group | keys | owner | in backup? |
|---|---|---|---|
| **Notebook** | `memory_files_v1_<user>` — the whole notebook (skills, rules, doctrine, diary, notes) as **one JSON blob of `.md` entries** | `services/learning/MemoryFilesService.ts:250` (prefix `:31`) | **yes** — first RESTORE prefix (`ExportService.ts:685`); deliberately **uncapped** (`EXPORT_RAW_KEY_CAP_BYTES` scoped away, `:398-402`); up to 2 MB, the largest key in the app |
| **Learning** | `learning_rules_v2_<user>`, `profile_memory_v1_<user>`, `memory_injections_v1_<user>`, `global_learning_state_<user>`, `rl_signals_data`, `session_review_{counter_v1,drafted_v1,open_theses_v1,resolver_v1}:<user>`, `trader_learning_v1:<user>`, `trader_learner_counter_v1:<user>`, `supervisor_{auto_v1,last_run_v1}_<user>`, `supervisor_triaged_v1_<user>:<id>`, `memory_amendments_v1`, `august_harness_lessons_v1`, `approvals_grandfathered_v1_<user>`, `book_drafts_seeded_v1`, `skill_drafts_v1[:<user>]` + `_rejected:` + `_gate_attempts:`, `learning_proposals_v1:<user>`, `attributed_insights_kb` | `StorageService.ts:137`, `profileMemory.ts:80`, `MemoryInjectionService.ts:87`, `GlobalLearningService.ts:148/162`, `ReinforcementSignalService.ts:121`, `sessionSkillReview.ts:97-361`, `traderLearner.ts:43-55`, `supervisorStore.ts:192`, `skillSupervisor.ts:317-606`, `memoryAmendments.ts:75`, `harnessLessons.ts:80`, `approvalMigration.ts:80`, `bookSkillDrafts.ts:185`, `skillDrafts.ts:54-244`, `learningQueue.ts:123` | all registered (RAW `:300-318`, `:320`, `:342-348`, `:386`, `:390`) |
| **Agent / bot** | `bots_v1_<user>` (**Preferences**, `services/bots/BotRegistry.ts:37`), `agents_bots_v1_<user>`, `agents_groups_v1_<user>` (`services/agents/agentRoster.ts:100` — the prefix is a runtime parameter), `agent_threads_opened_v1_<user>` (`utils/agentThreads.ts:323`), `agent_pins_v1_<user>` (`components/agents/AgentsView.tsx:580`) | see left | `bots_v1_` RESTORE `:740`; `agents_*` RAW `:302-303`; `agent_threads_opened_v1` RESTORE-only `:743`; `agent_pins_v1` **no** (exempt) |
| **Trading surface** | `trade_chat_sessions_v1_<user>` (`services/trade/chatSessions.ts:427`), `trade_chat_active_v1_<user>` (`services/trade/chatStore.ts:161`), `trade_tool_payloads_v1_<user>` (`services/trade/toolPayloadStore.ts:98`), `trade_watches_v1_<user>` (`services/trade/watchService.ts:61`), `trade_level_arms_v1_<user>` (`services/trade/levelWatchService.ts:140`), `trade_level_hits_v1_<user>` (`:167`), `trade_drawings_v1_<user>_<sym>` (`services/trade/chartDrawings.ts:121`), `trade_session_drawings_v1_<user>_<sess>` (`:187`), `trade_session_model_v1` (`:210`), `trade_tf_bar_v1_<user>` (`components/trade/TradingChart.tsx:112`), `trading_checklist_v1` (`utils/checklist.ts:51`) | see left | RAW `:362-366`, `:372`, `:377`, `:379-380`; caps: chat 512 KB, tool payloads 256 KB, session drawings 1 MB, checklist 64 KB (`:418-427`); an over-cap key is **omitted with a notice, never truncated** (`:536-542`) |
| **UI furniture** | `nav_rail_width_v1` (`App.tsx:659`), `right_panel_width_v1_<surface>` (`hooks/useRightPanel.ts:115`), `trade_sidebar_open_v1` (`App.tsx:475`), `august_surface_v1` (`hooks/useSurface.ts:29`), `august_trade_mode_v1_<user>` (`components/trade/TradeView.tsx:238`), `learn_tab_v1` (`components/learn/LearnView.tsx:150`), `august_update_notes_seen_v1` (`components/shared/UpdateOverlay.tsx:107`), `august_model_picker_free_only_v1` (`utils/providerUtils.ts:277`), `skills_grid_pins_v1` (`components/dashboards/StrategyStudio.tsx:285`), `desk_idle_motion_v1_<user>` (`services/desk/idleMotion.ts:34`) | see left | RAW: `nav_rail_width_v1` `:325`, `right_panel_width_v1` `:331`. **RESTORE-only, not RAW**: `trade_sidebar_open_v1` `:737`, `desk_idle_motion_v1` `:745`. **Not backed up**: `august_surface_v1` (a plain string, `:669-673`), `august_trade_mode_v1`, `learn_tab_v1`, `august_update_notes_seen_v1`, `august_model_picker_free_only_v1`, `agent_pins_v1`, `skills_grid_pins_v1` (the exempt table) |
| **Preferences (`PREF_KEYS`, 24)** | `provider_configs_v1`, `memory_provider`, `analyst_lens_config`, `ensemble_model_selection`, `last_moderator_pick_v1`, `custom_ensemble_prompt`, `custom_lens_prompts`, `casual_chat_model`, `hybrid_panel_position`, `model_performance_data`, `rolling_window_data`, `confidence_calibration`, `confluence_historical_stats`, `attributed_insights_kb`, `outcome_autopilot_state`, `quiet_hours_v1`, `bots_v1`, `last_trade_count`, `last_session`, `data_version`, `data_integrity_log`, `lastCrashError`, `lastPromiseError`, `lastGlobalError`, `sqlite_migrated` | `services/infrastructure/PreferencesService.ts:19-58` | exported by the `PREF_KEYS` loop (`ExportService.ts:600-609`); **API keys are redacted on export** and grafted on import only when the endpoint is identical (`mergeProviderConfigsForImport` `:802-881`) |
| **Dual-written (Preferences + raw)** | `analyst_lens_config` (`services/ui/AnalystLensService.ts:171` + `:181`), `ensemble_model_selection` (`:256` + `:264`), `last_moderator_pick_v1` (`:247` + `:249`), `casual_chat_model` (`App.tsx:715` + `:716`) | see left | **not a loss** — both copies are current and a boot sync re-mirrors Preferences → localStorage. Verified clean. |
| **Telemetry** | `thinking_leak_bin_v1` (`utils/thinkingLeakBin.ts:39`), `lastPromiseError` (`index.tsx:36`), `lastGlobalError` (`index.tsx:55`), `lastCrashError` (`components/shared/ErrorBoundary.tsx:46`), `last_active_user` (`hooks/useUserProfileLoader.ts:501`, `services/learning/PatternMemorySynthesisService.ts:677`) | see left | `thinking_leak_bin_v1` RESTORE exact `:679` only; `last_active_user` RESTORE `:750` only; the three breadcrumbs are `PREF_KEYS` |
| **Gates (auto-apply policy)** | `approval_rules_v1:<user>` (`utils/approvalInbox.ts:46`), legacy unscoped `approval_rules_v1` (read-only, `:30`) | `utils/approvalInbox.ts` | **neither list** — see finding **F-04** |

#### 2.3 The other four backends

**IndexedDB (5 databases).**

| database | version / store | owner | notes |
|---|---|---|---|
| `FuturesAI-DB` | v1 / `userProfiles` (keyPath `username`) | `services/infrastructure/dbService.ts:63-66` | on web it holds users + trades + conversations + summaries |
| `AugustBackups` | v1 / `backups` (keyPath `id`, indexes `username`, `timestamp`) | `services/infrastructure/BackupService.ts:57-67` | **web only**; on native the same backup goes to the Filesystem plugin |
| `ThinkingStore` | `ThinkingStoreService.ts:36-39` (keyPath `id`) | the reasoning corpus | deliberately **not** inside `UserProfile`, hence the separate `.thinking.json` sidecar |
| `OfflineQueue` | `services/infrastructure/OfflineQueueService.ts:61-76` | queued sends while offline |
| `MessageImages` | v1, keyPath `key` (`services/infrastructure/messageImageStore.ts:116-120`) | pasted screenshots |

**Capacitor Preferences** — one abstraction, `services/infrastructure/PreferencesService.ts`:
native → `@capacitor/preferences` (`:70/:81/:93/:154/:166`); **web → localStorage** (`:72/:84/:95`,
`Object.keys` `:157`, `.clear()` `:168`).

**Files on disk.**

| what | where | owner |
|---|---|---|
| `window-state.json` | Electron `userData` | `electron/main.cjs:88` (written `:125`, read `:92`) |
| `.migrated-to-august-trading` stamp | Electron `userData` | `main.cjs:64-75` (packaged builds only, `main.cjs:59`) |
| `AugustBackups/<user>_<id>.{json,meta.json,prefs.json,thinking.json}` | `Directory.Documents` | `services/infrastructure/BackupService.ts:169-192` |
| global learning state | `Directory.Data` | `services/learning/GlobalLearningService.ts:148` |
| exports | `Directory.Cache` → `Directory.ExternalStorage` | `services/infrastructure/ExportService.ts:67-70`, `:117-120` |

**There is no JSONL store anywhere in the app.** And — worth stating because it surprises people —
**the skill `.md` files are not files.** They are entries inside the single `memory_files_v1_<user>`
JSON blob (`MemoryFilesService.ts:31`, the name is built at `:673`, and a name collision dedupes to
`-2.md` at `:1364`).

**SQLite (native only)** — `services/infrastructure/SqliteService.ts`: tables `users` (`:142-155`),
`trades` (`:158-178`), `conversations` (`:186-194`), `trade_summaries` (`:200-206`),
`saved_analyses` (`:212-220`), `thinking_records` (`:230-252`), `schema_migrations` (`:265-270`),
plus 12 indexes. Migrations v2 `:311-315`, v3 `:318-323`, v4 `:326-331`, v5 `:336-343`,
v6 `:348-353`, v7 `:358-363` — **all seven are additive** (`ADD COLUMN` / `CREATE INDEX`); there is
no `DROP` and no destructive backfill. `runMigrations` records a version **only if every statement
applied** (`:296-308`) — an earlier unconditional record was a real bug and is fixed.

**Electron `userData`** — `window-state.json` plus Chromium's own `Cache/`, `GPUCache/`,
`Code Cache/`, `Local Storage/`, `IndexedDB/`, `Session Storage/`, `Network/`, `Service Worker/`,
`blob_storage/`, `Partitions/`, plus `electron-updater`'s `pending/` and `app-<version>/`.
**[Unverified — needs a live `userData` listing]** the Chromium and updater parts come from the
documented layout, not from measurement.

#### 2.4 Retention and rollup

| store | rollup | cap |
|---|---|---|
| the notebook | `utils/memoryBudget.ts` — soft / trigger / hard byte caps; **pressure REFUSES growth, it never evicts** (new files refused at the trigger tier, all model notes refused at the hard cap, `MemoryFilesService.ts:1310`, gate `notebookPressureAllows` `:443`) | see `memoryBudget.ts` |
| skills | `services/learning/skillIdleLifecycle.ts` — the only clock that decides a skill stops being injected: 90 days idle ⇒ suspend (`enabled: false` + `meta.suspendedAt`); 180 days ⇒ archive + an `idle` graveyard tombstone | 90 d / 180 d |
| graveyard | `services/learning/skillGraveyard.ts` — retention only, it revives nothing | weekly sweep |
| chat sessions | `hooks/useConversationHousekeeping.ts` | — |
| tool payloads | `services/trade/toolPayloadStore.ts` | 256 KB |
| session drawings | `services/trade/chartDrawings.ts` | 1 MB |
| trade chat sessions | `services/trade/chatSessions.ts` | 512 KB |
| checklist | `utils/checklist.ts` | 64 KB |
| injection records | `services/learning/MemoryInjectionService.ts` | — |
| backup files | `services/infrastructure/BackupService.ts` | — |

**[Verified by code reading]** The design choice — *refuse growth rather than evict* — is stated
in `AGENTS.md` and honoured: `utils/memoryBudget.ts` is the one classifier for which tier applies,
and nothing in that store is safe to evict without first proving which bytes are regenerable.

#### 2.5 Backup / export / import registration

**[Verified live]** `RAW_LOCAL_STORAGE_PREFIXES` (`services/infrastructure/ExportService.ts:299-391`)
has **38 entries**. The repository's own gate is a **source scan**, not a list check:
`tests/exportRawLocalStorage.test.ts` (423 lines, CI-wired) fails when a new `localStorage.*Item`
write site lands in neither the RAW list nor the restore allow-list. That is a genuinely good
mechanism — it is the only reason the paragraph above the list can stay true as stores are added.

**Verification of the list itself:** all 38 prefixes resolve to a real call site. Five had no
resolvable site in the static scan and all five were hand-verified **correct**:
`learning_rules_v2` → `StorageService.ts:137`; `agents_bots_v1` / `agents_groups_v1` →
`agentRoster.ts:100` (runtime-parameter prefix; the test judges that file by whether it declares
an allow-listed namespace, `:336-339`); `trader_learner_counter_v1` → `traderLearner.ts:55`;
`trade_session_drawings_v1` → `chartDrawings.ts:187`. **No prefix on the list is spurious.**

The CI backlog is pinned at 8 entries with `>5` and `<17` bounds (`:403-404`), so it can only
shrink. `supervisor_auto_v1` is registered because its default is **on**
(`supervisorStore.ts:84`) — a restore that missed it would silently re-enable an LLM pass the user
switched off (`ExportService.ts:280-281`).

#### 2.6 The store defects

| ID | sev | finding |
|---|---|---|
| **F-02** | **Med** | **Three stores are on the RESTORE list but not the RAW list, and their owner reads `localStorage` directly — so on native they are neither exported nor restored.** `readSweptValue` (`ExportService.ts:497-505`) falls through to `getPreferenceObject` for a non-RAW key; on native the Preferences copy was never written, so the value is `null` and the key is **not exported**. On restore, `setPreferenceObject` writes Preferences and `mirrorToLocalStorage` returns early because `isRawLocalStorageKey` is false (`:511`) — **the owner never sees it.** Affected: `desk_idle_motion_v1_<user>` (`services/desk/idleMotion.ts:34` writes, `:26` reads; RESTORE `:745`), `thinking_leak_bin_v1` (`utils/thinkingLeakBin.ts:39`/`:12`; RESTORE `:679`), `trade_sidebar_open_v1` (`App.tsx:475`/`:454`; RESTORE `:737`). |
| **F-03** | **Med** | **`agent_threads_opened_v1_<user>`** has the same shape (write `utils/agentThreads.ts:323`, read `:313`; RESTORE `:743`; not RAW). **[Unverified — needs a native round-trip]** whether the file-scoped `ownerUsesPreferences` heuristic lets it escape CI (see F-06). |
| **F-04** | **Med-High** | **`approval_rules_v1:<user>` is on neither list.** Written `utils/approvalInbox.ts:46`, read `:29`/`:38`/`:51`. On **web** the sweep exports it (localStorage *is* the Preferences fallback) but the import **skips** it (`isRestorablePreferenceKey` `:758-760`); on **native** it is neither exported nor restored. This store **gates every auto-apply** — the per-coin "always journal" vs "ask" policy. The repository already knows: `tests/exportRawLocalStorage.test.ts:97` — *"NOT backed up: the inbox rules gate every auto-apply — worth a decision"*. **The decision was never taken.** |
| **F-05** | Med | **`bots_v1_<user>` restore depends on `last_active_user`**, which is itself restore-listed-but-not-raw (`:750`, not in RAW) — so on native the roster can be restored under the wrong user key. `BotRegistry.botKey()` reads `last_active_user` from **raw** localStorage (`services/bots/BotRegistry.ts:15`). **[Unverified — needs a native round-trip]** the observed outcome. |
| **F-06** | Low | **The CI gate's `ownerUsesPreferences` check is file-scoped**, so a file that touches Preferences *anywhere* is exempt for *every* key it owns — which is exactly how `trade_sidebar_open_v1` escapes F-02. A **key-scoped** check would close it. |
| **F-07** | Info | **`approval_rules_v1` (the legacy unscoped key) is read but never written** (`utils/approvalInbox.ts:30` reads; `:46` writes only the scoped key) **and is never deleted** — a legacy value can shadow the scoped one indefinitely. |
| **F-08** | Info | **No SQLite migration can lose data.** All seven are additive, and the version is recorded only on full success (`:296-308`). The genuinely risky migration is the **one-time** `migrateLocalStorageToPreferences` sweep (`services/infrastructure/PreferencesService.ts:226-241`), which copies **every** localStorage key into Preferences and thereby creates a **stale second copy** of every raw-owned key. `readSweptValue` prefers the raw store for RAW-listed keys precisely to undo this (`ExportService.ts:482-506`). **This sweep is the mechanical cause of F-02, F-03, F-04 and F-05.** |
| **F-09** | Info | **No write-only store in the localStorage/Preferences layer** — every resolved key shape with a writer has a matching reader. The closest is `lastCrashError` (write-and-clear only, `components/shared/ErrorBoundary.tsx:46`/`:68`). |

#### 2.7 The one write-only *capability* in the app

`formatHarnessNotesBlock` — `services/learning/harnessLessons.ts:184` — is exported and has **no
caller anywhere**, in source or in tests. Its own doc comment says *"Harness-lesson read path for
the moderator"*, and the moderator died with the debate engine.

**The store itself is not dead.** The harness-lessons store reaches the wire by a different route:
`registerWireRoutePins` → `isRoutePinned` (`services/providers/reasoningControls.ts:193-206`), which
makes a recorded wire lesson outrank name-based route detection. So the precise finding is:
**the prompt-injection reader is orphaned; the store is live for a different reason.** The
`docs/learning-loop-map.md:114` row claims "Closed? yes — `formatHarnessNotesBlock` → `ensembleService.ts`"
and is wrong on both the reader and the file (`ensembleService.ts` does not exist; the file is
`services/ui/EnsembleAnalystService.ts`). See Report 4, docs audit.

---

### A3. The prompt inventory

#### 3.1 Method and a caveat about "size"

**Sizes below are runtime-measured**, not estimated: the repository's own
`node_modules/esbuild` transpiles a TS module to a temporary `.cjs` **outside** the repository,
Node 24 `require`s it with browser and `@capacitor/*` stubs, and the exported string's `.length` is
read. Token figures are `chars / 4` and are labelled as estimates.

#### 3.2 The four live model-call paths

| # | path | system prompt actually sent | tools |
|---|---|---|---|
| **P1** | **Chat surface** (and the app's "Full analysis" button) — `services/trade/chatSurfaceTurn.ts:230` | `CHAT_SURFACE_SYSTEM_PROMPT` (1,480) + skills index + strategies + profile-memory index + `DESK_TOOLS_PROMPT` (2,446) [+ a text fallback 221] [+ "FULL ANALYSIS REQUESTED" ~320] | `CHAT_SURFACE_TOOLS` (31) |
| **P2** | **Chart AI dock** (solo + panel) — `services/trade/chatTurnRunner.ts` | `TRADE_CHAT_SYSTEM_PROMPT` (4,299) + skills + strategies + memory + agent notes (≤1,800) + persona + `DESK_TOOLS_PROMPT` (2,446) | `TRADE_TOOLS` (39) |
| **P3** | **Automation** (cron) — `services/trade/automationTurn.ts:161` | `AUTOMATION_SYSTEM_PROMPT` (2,313) + skills + strategies + memory + "LOOK IT UP" + `DESK_TOOLS_PROMPT` (2,446) | `AUTOMATION_TOOLS` (31) |
| **P4** | **Bot turns** (thread / DM / room / routine) | `buildBotSystemPrompt` (`services/agents/botMailbox.ts:167`) = `system.md` + `memory.md` + teammate protocol; else `CASUAL_CHAT_SYSTEM_PROMPT` (355) | **none — deliberately** |
| **P5** | **Skill A/B evaluation** — `services/learning/SkillEvalScheduler.ts:284` | **the only place `composePrompt` runs**: contract 1,582 + master 4,636 + memory 236 + risk 243 + output 368 + desk tools 2,446 | all 31 core, no allow-list |

**None of P1, P2 or P3 honours a `getPrompt()` override** — none of them uses a registry id.
**P5 is the only path that does.**

#### 3.3 The full prompt inventory

| # | prompt / surface | file:line | chars | ≈tok | read by | registered? | user-editable? | note |
|---|---|---|---|---|---|---|---|---|
| 1 | `HARNESS_CONTRACT_PROMPT` | `constants/prompts/harnessContract.ts:7` | 1,582 | 396 | **P5 only** | ✗ | ✗ | clause 5 defines `HARNESS_TURN_MARK`; **never reaches P1/P2/P3** |
| 2 | `ANALYST_PERSONA_PROMPT` | `constants/prompts/analysisPrompts.ts:11` | 1,950 | 488 | **P5 only** | ✗ | ✗ | |
| 3 | `MASTER_ANALYSIS_PROMPT` | `constants/prompts/analysisPrompts.ts:67` | 4,636 | 1,159 | **P5 only** | ✓ `analysis.master` | ✓ | registry ≡ call site (byte-identical) |
| 4 | `LENS_MODE_BASE_PROMPT` | `constants/prompts/analysisPrompts.ts:108` | 2,854 | 714 | **nobody** | ✓ `analysis.lens` | ✓ → **no effect** | **DEAD — see F-10** |
| 5 | `COMPACT_ANALYSIS_PROMPT` | `constants/prompts/analysisPrompts.ts:127` | 2,524 | 631 | P5, small-CTX model only | ✓ `analysis.compact` | ✓ | |
| 6 | `RISK_MANAGEMENT_RULES` | `constants/prompts/analysisPrompts.ts:48` | 243 | 61 | **P5 only** | ✓ `analysis.risk_rules` | ✓ | "R:R < 1.2 is Avoid" |
| 7 | `AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT` | `constants/prompts/memoryPrompts.ts:1` | 236 | 59 | **P5 only** | ✓ `analysis.memory_enforcement` | ✓ | |
| 8 | `CASUAL_CHAT_SYSTEM_PROMPT` | `constants/prompts/chatPrompts.ts:24` | 355 | 89 | P4 without a persona | ✗ | ✗ | |
| 9 | `CHAT_SURFACE_SYSTEM_PROMPT` | `constants/prompts/chatPrompts.ts:40` | 1,480 | 370 | P1 | ✗ | ✗ | |
| 10 | `AUTOMATION_SYSTEM_PROMPT` | `constants/prompts/chatPrompts.ts:61` | 2,313 | 578 | P3 | ✗ | ✗ | contains a **false** claim (C-3) |
| 11 | `TRADE_CHAT_SYSTEM_PROMPT` | `services/trade/tradeChatContext.ts:166` | 4,299 | 1,075 | P2 | ✗ | ✗ | the largest shipped prompt |
| 12 | `DESK_TOOLS_PROMPT` | `services/analysis/DeskToolsService.ts:1594` | 2,446 | 612 | **P1+P2+P3** | ✗ | ✗ | names tools some surfaces lack (C-2) |
| 13 | `TEXT_TOOL_FALLBACK_PROMPT` | `services/analysis/DeskToolsService.ts:3130` | 221 | 55 | P1/P2/P3 (non-`chat_completions` only) | ✗ | ✗ | |
| 14 | `GENERAL_ANALYST_DEFAULT_PROMPT` | `services/agents/seatPersonas.ts:28` | 719 | 180 | team seats, bots | ✗ | ✗ | survives the in-flight change |
| 15 | `GENERAL_DIMENSION_MANDATES` + `generalSeatMandate` | `services/agents/seatPersonas.ts:42`, `:62` | 459 + ~180 | ~160 | team seats | ✗ | ✗ | **being removed in the in-flight tree** |
| 16 | `LENS_SWING_PROMPTS` (3) | `constants/prompts/lensRolePrompts.ts:16` | 4,926 | 1,232 | live at the pin via `AnalystLensService.ts:46,54,62` | ✗ | ✗ | **orphaned the moment the in-flight change lands** |
| 17 | `LENS_SCALP_PROMPTS` (3) | `constants/prompts/lensRolePrompts.ts:73` | 3,309 | 827 | **no production caller** | ✗ | ✗ | **DEAD** |
| 18 | `LENS_POSITION_PROMPTS` (3) | `constants/prompts/lensRolePrompts.ts:111` | 3,245 | 811 | **no production caller** | ✗ | ✗ | **DEAD** |
| 19 | `DESK_RULES` (the shared tail of the nine lens prompts) | `constants/prompts/lensRolePrompts.ts:8` | ~900 (static) | ~225 | via #16 | ✗ | ✗ | |
| 20 | `INVALIDATION_THESIS_PROMPT` | `constants/prompts/analysisPrompts.ts:140` | 1,059 | 265 | `services/analysis/HybridIntelligenceService.ts:1289` | ✗ | ✗ | |
| 21 | `CORRELATION_AWARENESS_PROMPT` | `constants/prompts/analysisPrompts.ts:163` | 945 | 236 | `services/analysis/HybridIntelligenceService.ts:1287` | ✗ | ✗ | |
| 22 | `ENTRY_NOT_HIT_ANALYSIS_PROMPT` | `constants/prompts/learningPrompts.ts:7` | 572 | 143 | **nobody** | ✗ | ✗ | **DEAD** |
| 23 | `ENTRY_NOT_HIT_ANALYSIS_QUESTIONS` | `constants/prompts/learningPrompts.ts:17` | 1,710 | 428 | **nobody** | ✗ | ✗ | **DEAD** |
| 24 | `EXTENDED_SL_ZONE_DEBATE_CONTEXT` | `constants/prompts/learningPrompts.ts:64` | 2,180 | 545 | **nobody** | ✗ | ✗ | **DEAD** |
| 25 | `SKILL_CRAFT_FALLBACK` | `services/learning/SkillCraftService.ts:11` | 4,008 | 1,002 | skill draft | ✓ `learning.skill_craft` | ✓ | registry ≡ call site |
| 26 | `SKILL_REFINE_FALLBACK` | `services/learning/SkillCraftService.ts:171` | 2,310 | 578 | skill refine | ✗ — `learning.skill_refine` is **not a registry id** | ✗ | |
| 27 | `SKILL_WORTH_FALLBACK` | `services/learning/skillWorthGate.ts:29` | 1,597 | 399 | worth gate | ✗ — `learning.skill_worth` is **not a registry id** | ✗ | |
| 28 | `CHART_SCAN_FALLBACK_PROMPT` | `services/learning/chartScanSkills.ts:79` | 2,233 | 558 | chart scan | ✓ `learning.chart_scan` | ✓ | registry ≡ call site |
| 29 | `NOTEBOOK_NOTE_FALLBACK` | `services/learning/NotebookWriterService.ts:23` | 1,718 | 430 | notebook writer | ✓ `notebook.note` | ✓ | **registry copy is 107 chars short — DRIFTED** |
| 30 | `CHAT_NOTE_FALLBACK` | `services/learning/NotebookWriterService.ts:47` | 1,557 | 389 | chat quick-save | ✓ `notebook.chat_note` | ✓ | **registry copy is 107 chars short — DRIFTED** |
| 31 | `DEFAULT_SUMMARIZE_PROMPT` | `services/learning/strategySummarizer.ts:24` | 1,358 | 340 | PDF upload | ✓ `strategy.summarize_pdf` | ✓ | **registry copy is 992 — a different, older prompt** |
| 32 | `DEFAULT_OCR_PAGE_PROMPT` | `services/learning/pdfOcrService.ts:20` | 329 | 82 | PDF OCR | ✓ `strategy.ocr_page` | ✓ | registry ≡ call site |
| 33 | `SUPERVISOR_SYSTEM` | `services/learning/skillSupervisor.ts:101` | 605 | 151 | the skill supervisor | ✗ | ✗ | |
| 34 | `buildBotSystemPrompt` | `services/agents/botMailbox.ts:167` | persona + notes (≤1,800) + ~700 | ~2,500 | P4 | ✗ | per-bot `system.md` | budget `services/bots/botMemoryBudget.ts:15,23` |
| 35 | `outputContract` | `services/providers/GenericAnalysisService.ts:354` | 368 | 92 | P5 | ✗ | ✗ | |
| 36 | `marketDataOverride` | `services/providers/GenericAnalysisService.ts:306` | 459 | 115 | P5 | ✗ | ✗ | |
| 37 | `visionDeepDive` | `services/providers/GenericAnalysisService.ts:332` | ~700 (static) | ~175 | P5 | ✗ | ✗ | |
| 38 | doctrine-consolidation prompt | `services/learning/DoctrineConsolidationService.ts` (builder ~2,555 source chars) | ~1,600 (static) | ~400 | the doctrine rewriter | ✗ | ✗ | sent as a **user** message, `:181` |
| 39 | `aiTrendlineSystem` | `services/analysis/AITrendlineService.ts:231` | 86 | 22 | AI trendline | ✗ | ✗ | |
| 40 | "FULL ANALYSIS REQUESTED…" | `services/trade/chatSurfaceTurn.ts:315` | ~320 | 80 | P1 only | ✗ | ✗ | |
| 41 | "LOOK IT UP…" | `services/trade/automationTurn.ts:247` | ~230 | 58 | P3 | ✗ | ✗ | |

**Dead-prompt total: 13,870 chars ≈ 3,468 tokens** (#4 2,854 + #17 3,309 + #18 3,245 + #22 572 +
#23 1,710 + #24 2,180). **Shipped but never reaching a trader-facing model: 7,639 chars**
(#3, #5, #6, #7 — skill-eval only).

#### 3.4 The prompt registry — 11 entries, and the defect in the *other* direction

**[Verified live]** 11 of 11 registry ids have a `getPrompt()` consumer
(`UNREACHABLE_CEILING = 0`, pinned by `tests/promptsAreWired.test.ts`).

**But the reverse defect exists**, and it is the one that bites: two call sites use ids that are
**not** registry entries — `learning.skill_refine`
(`services/learning/SkillCraftService.ts:228`) and `learning.skill_worth`
(`services/learning/skillWorthGate.ts:112`). **The Settings prompt editor cannot reach them.**

| id | call site | registry chars | call-site chars | identical? | reaches a model? |
|---|---|---|---|---|---|
| `analysis.master` | `GenericAnalysisService.ts:364` | 4,636 | 4,636 | ✅ | skill-eval only |
| `analysis.lens` | `:363` | 2,854 | 2,854 | ✅ | **NEVER** |
| `analysis.compact` | `:409` | 2,524 | 2,524 | ✅ | skill-eval only |
| `analysis.risk_rules` | `:376` | 243 | 243 | ✅ | skill-eval only |
| `analysis.memory_enforcement` | `:371` | 236 | 236 | ✅ | skill-eval only |
| `strategy.summarize_pdf` | `strategySummarizer.ts:66` | **992** | **1,358** | ❌ **DRIFTED** | live |
| `notebook.note` | `NotebookWriterService.ts:132` | **1,611** | **1,718** | ❌ **DRIFTED** | live |
| `notebook.chat_note` | `NotebookWriterService.ts:81` | **1,450** | **1,557** | ❌ **DRIFTED** | live |
| `strategy.ocr_page` | `pdfOcrService.ts:40` | 329 | 329 | ✅ | live |
| `learning.skill_craft` | `SkillCraftService.ts:155` | 4,008 | 4,008 | ✅ | live |
| `learning.chart_scan` | `chartScanSkills.ts:294` | 2,233 | 2,233 | ✅ | live |

**The drifted copies are live and user-reachable, and "Reset to default" installs the stale one:**

- **`notebook.note` / `notebook.chat_note`** — the registry copies are **107 characters short**: they
  lack *"Never write to skills/ — the harness creates skills only after a cluster of similar trades
  has evidence."* (divergence at chars 889 / 813). "Reset to default" therefore installs an override
  that **removes the prohibition on writing into `skills/`**.
- **`strategy.summarize_pdf`** — the registry copy (992) is an **older, non-template** prompt. The
  real default (1,358) demands `**Strategy: <name>**` plus
  `Family/Signals/Invalidation/Exits/Filters/Horizon/Sizing`, and "Family is mandatory — pick the
  closest of the eight". Resetting installs the old shape, so strategy files parse with **no
  `strategyFamily`** (`services/learning/strategyStore.ts:90` `parseStrategyMarkdown`) — and the
  strategy×regime matrix and the skill attribution both read that field. **Live, user-reachable,
  silent.**

#### 3.6 Six contradictions between prompts on the *same* surface

| id | contradiction | where |
|---|---|---|
| **C-1** | `DESK_TOOLS_PROMPT`: *"Naming `draw_on_chart` or `mark_trade_levels` is how a level becomes something the trader can see"* **vs** `CHAT_SURFACE_SYSTEM_PROMPT`: *"Drawing, marking levels and arming a price watch are not offered here and you must not claim to have done them."* — **both in the Chat surface's system message** | `DeskToolsService.ts:1600` vs `chatPrompts.ts:44` |
| **C-2** | `DESK_TOOLS_PROMPT` requires `get_chart_view` before naming a shape — but `get_chart_view` is **not** in `CHAT_SURFACE_TOOLS` or `AUTOMATION_TOOLS`. The seat is told to call a tool its allow-list refuses. | `DeskToolsService.ts:1600` vs `chatSurfaceTurn.ts:55-76` |
| **C-3** | `AUTOMATION_SYSTEM_PROMPT`: *"forged tools are not offered here"* — **FALSE.** `AUTOMATION_UNATTENDED_DENY` cannot name dynamic `custom_*` ids, and `streamChatWithDeskTools:3821-3830` **adds every confirmed forged tool to the allowed list** whenever the caller supplies `executePanelTool` (the automation does, `automationTurn.ts:202`). **A cron can call a forged POST — a write on a third-party endpoint.** | `chatPrompts.ts:67` vs `automationTurn.ts:55-63` + `DeskToolsService.ts:3821-3830` |
| **C-4** | `ANALYST_PERSONA_PROMPT` forbids "this is not financial advice"; `TRADE_CHAT_SYSTEM_PROMPT` ends *"Analysis, not financial advice"* | `analysisPrompts.ts:22-24` vs `tradeChatContext.ts:178` |
| **C-5** | `HARNESS_CONTRACT_PROMPT` clause 5: an **unmarked** user-role turn "IS the trader's own words". The dock prepends harness-authored packet / on-screen / plans / drawings / file text to the trader's turn **without** `harnessTurn()`. | `harnessContract.ts:18` vs `chatTurnRunner.ts:873-881` |
| **C-6** | `RISK_MANAGEMENT_RULES` says "R:R < 1.2 is Avoid"; P1/P2/P3 have **no** R:R floor and no confidence ladder (the ladder lives in the contract they never receive). | `analysisPrompts.ts:51` |

#### 3.7 Hardcoded claims vs deterministic enforcement

| prompt claim | enforcement |
|---|---|
| "Avoid means Neutral — never emit Long/Short with Avoid" (`analysisPrompts.ts:25-27`) | **ENFORCED on the structured path only** — `schemas/tradeAnalysis.ts:730-732`; `SkillMemoryService.ts:3612-3616`. On P1/P2/P3 there is no structured analysis, and the prompt is not sent there either |
| "requires `get_chart_view` on this turn" (`DeskToolsService.ts:1600`) | **UNENFORCED and partly FALSE** (C-2) |
| "Prefer 0–2 calls" (`DeskToolsService.ts:1602`) | **UNENFORCED** — up to 8 rounds × 3 calls = 24; a 180 s turn budget (`:192`, `:204`, `:3449`) |
| "forged tools are not offered here" (automation) | **FALSE** (C-3) |
| "at most one plan … and the app caps how many a day" (automation) | **ENFORCED** — `automationTurn.ts:205` (`MAX_PLANS_PER_RUN = 1`, `MAX_PLANS_PER_DAY`) |
| "not offered here" (chat surface drawing / watching) | **ENFORCED** — the executor allow-list `DeskToolsService.ts:2171` |
| "LOOK UP, DON'T REMEMBER" (`chatPrompts.ts:42`) | **UNENFORCED** for an ordinary chat turn; only a Full-analysis turn gets a post-hoc notice (`chatSurfaceTurn.ts:339-347`) |
| "the harness warns only — it does not place, close or resolve trades" (`tradeChatContext.ts:175`) | **ENFORCED** |
| "NEVER re-announce a level already marked fired" (`tradeChatContext.ts:175`) | **UNENFORCED** |
| "every message arrives with a **fresh** packet" (`tradeChatContext.ts:168`) | **PARTLY** — an 8 s cache (`chatTurnRunner.ts:173`); a failed fetch substitutes "packet unavailable" (`tradeChatContext.ts:83`) |
| "An id from an earlier run is gone" (`read_tool_output`) | **ENFORCED** — `clearDeskToolCache` clears the artifact store (`:417-423`, `:3772`) |
| "Never write into diary/distilled" (`write_memory_note`) | **ENFORCED** — `MemoryFilesService.ts:1300/1394` |
| "Restate the predicate whenever you change if_condition" (`revise_skill`) | **UNENFORCED** — the file says "This is display only — a human still applies it" (`:1038-1042`) |
| "No probability above 85% without two matching historical wins" (`analysisPrompts.ts:105`) | **UNENFORCED** |
| "Missing data is 'Unavailable' — never invent a price" (`analysisPrompts.ts:94`) | **ENFORCED** via `dataUnavailable()` — **except** `services/analysis/HybridIntelligenceService.ts:892`, which emits the prefix constant **without** the helper, so the line lacks the "treat this as UNKNOWN" guidance and does not match the shape the legend describes |
| "NEVER say 'I am an AI'" | **UNENFORCED** — no output sanitizer checks disclaimers |
| `web_search` description: "A result starting with DATA_UNAVAILABLE means the search itself failed" | enforced in effect, but the marker is **hand-written in a model-facing string** — `AGENTS.md` forbids exactly that, and `tests/harnessMarks.test.ts:272` only scans for the literal *with a colon*, so it slips past |

#### 3.8 Settings that are editable but do nothing

| flag | UI | read by | effect |
|---|---|---|---|
| **`promptAbRate`** ("Prompt A/B (control lane)" — Off / 10 % / 50 %) | `components/settings/SessionUsagePanel.tsx:228-242` | `services/infrastructure/PromptOverrideService.ts:24-38` `beginPromptLane` | **NONE.** `beginPromptLane` has **zero call sites repo-wide** (only an *import* at `hooks/useAnalysisPipeline.ts:69`). `controlLane` is permanently `false`, so `getPrompt` always returns the user's override — **the control lane is unreachable** |
| **`pinnedPromptLane`** | not user-editable; written by `utils/promptVersionStats.ts:45-57` | same | **NONE.** `maybePinWinningPromptLane` reads `trade.promptLane` ← `message.runStats?.promptLane` (`hooks/useTradeLogging.ts:351`) — and **`runStats.promptLane` is never assigned anywhere**: the `runStats` literals at `useAnalysisPipeline.ts:1242,1403`, `App.tsx:1727,1754` and `botRoutine.ts:155` set only `runId` / `startedAt` / `finishedAt` / `durationMs`. `summarizePromptLanes` therefore always reports 0/0, so the "Prompt lanes" dashboard card is **inert**. `runStats.promptVersion` is likewise never assigned |
| `deskToolsEnabled` | Settings | `DeskToolsService.ts:3759`, `toolTurn.ts:161`, `GenericAnalysisService.ts:355` | **LIVE** |
| `skillEnforcementEnabled` | `SessionUsagePanel.tsx:218` | `SkillMemoryService.ts:3556` / `:3656` | **LIVE** |
| `starterLibraryEnabled` | `:176` | `SkillMemoryService.ts:812` | **LIVE** |
| `autoDraftingEnabled` | `:198` | `chartScanSkills.ts:254`, `sessionSkillReview.ts:216`, `botLearning.ts:305`, `DeskToolsService.ts:2730`, `chatTurnRunner.ts:773` | **LIVE** |
| `responseEffort` | `:246` | `services/providers/reasoningControls.ts:96` | **LIVE** |
| `skillLibraryCap` | `:264` | `utils/harnessSettings.ts:166` → `SkillMemoryService.ts:2993` | **LIVE** |

#### 3.9 `harnessMarks.ts` and `finishReason.ts` — two holes

**`harnessMarks` — mostly right, two holes.**

- `dataUnavailable` / `DATA_UNAVAILABLE` is emitted at `DeskToolsService.ts:238,1657,1660,1686,1689,1698,2545,2687,2767,2777,2962`, `toolArtifactStore.ts:144`, `chartScanSkills.ts:281`. **Hole 1:** `HybridIntelligenceService.ts:892` emits the prefix without the helper.
- `clipNote` — 13 emit sites; `clipReceipt` — 2; `MINIMAL_CLIP_NOTE` — 1. ✅
- `harnessTurn()` — 4 writers, **all inside the desk-tool loop** (`DeskToolsService.ts:299, 3412, 3643, 3985`). **Hole 2: the only text that explains the mark is `HARNESS_CONTRACT_PROMPT` clause 5, which is composed ONLY in `analyzeTradingView`** (`GenericAnalysisService.ts:366/408`) — the skill-eval path. **P1/P2/P3 receive `HARNESS NOTE (this app, not the trader): …` in the user role with no instruction anywhere about what it is.**
- `harnessNoteLegend()` at `DeskToolsService.ts:3116` (the untrusted fence) is built from the real prefixes ✅ — but it lives in the tool-result fence, not in any system prompt.
- `neutralizeHarnessNotes()` at ingestion for `web_search` (`DeskToolsService.ts:1638,1644,1647,1679`) and for forged tools (`services/tools/toolForge.ts:310`) ✅.

**`finishReason` — the tally is DEAD in production.** `normalizeFinishReason` / `extractFinishReason`
are used correctly on the wire (`GenericProviderService.ts:187,197,790,1296,1455,1709,1993,2019`)
and `truncatesOutput` is read at `DeskToolsService.ts:3203` ✅. But **`beginTruncationWindow()`,
`consumeTruncations()` and `peekTruncations()` have zero production call sites** — only
`utils/finishReason.ts` and `tests/finishReason.test.ts`. So `recordFinishReason` returns
immediately (`!windowOpen`) and **the per-run truncation tally records nothing in the app**.
`AGENTS.md`'s "Read the ceiling with `peekTruncations()`" has no reader.

#### 3.10 Injected context — what a request actually costs

| block | cap in code | typical | share of a typical request |
|---|---|---|---|
| market packet | 10 % of the window, `PACKET_TOKEN_CAP = 6,000` tok (`services/trade/tradeChatContext.ts:52-53`), clipped with a `clipNote` naming kept-vs-total | 3,000–8,000 chars | **P2: the largest block, 50–70 % of the user message** |
| on-screen + drawings + armed plans | none | 1,500–4,000 | 10–25 % of the P2 user message |
| **attached file text** | `MAX_FILE_CHARS = 200_000` (`services/trade/chatTurnRunner.ts:168`, `:841-843`) | 0 or huge | **can be 50,000 tokens in one turn** |
| skills index | 30 rows, each ≤620 (`services/learning/MemoryRetrievalService.ts:141`) | 2,000–6,000 | 10–30 % of the system message |
| active strategies | uncapped | 0–3,000 | 0–15 % |
| profile-memory index | body ≤2,000, description ≤160 (`services/learning/profileMemory.ts:48-49`) | 300–2,500 | 0–12 % |
| **retrieved notebook / matched skill body** | `stageBudgetChars` = max(floor, min(2 % of window, 900 tok) × stage share); skill body ≤400, rules ≤300, mistake line ≤200, doctrine 800 | 1,000–3,600 | **assembled and then DISCARDED on the trader's path — see F-01**; live in P5 and reachable via `recall` / `get_notebook_map` |
| bot notes | 900 per agent, 1,800 total (`services/bots/botMemoryBudget.ts:15,23`) | 0–1,800 | P4 only |
| calibration stats | uncapped — 150 (no data) / 420 (per model) / grows | 150–1,500 | **also DISCARDED** (F-01) |

**Fixed harness prose per surface:** P1 4,147 chars (the desk-tools block is 59 % of it);
P2 6,745 (the mandate 64 %, the desk tools 36 %); P3 4,759 (desk tools 51 %);
P5 ≈9,521 (the analyst persona is 41 % of the master prompt).

**Fixed schema tax per request:** the dock 31,455 chars ≈ 7,864 tokens;
chat and automation 25,535 ≈ 6,384 tokens.

---

### A4. Trading logic, end to end

Legend: **[D]** deterministic · **[M]** model-output-dependent · **[D|M]** a deterministic gate
applied to model output.

#### 4.1 Production — how a plan is actually born

The live path is **the model calls the `present_trade` desk tool** →
`runPresentTrade` (`services/trade/presentTradeTool.ts:75`).

The plan's schema is `TradeProposal` (`services/trade/proposedTrade.ts:72`). Its levels are **[M]**
(the model's tool arguments) but are then parsed and range-checked deterministically
(`services/trade/tradePlanLevels.ts:68` `priceArgError`, `:88` `usablePrice`). The card's
`TradeAnalysis` is built by `buildProposedTradeAnalysis` (`proposedTrade.ts:126`) and its `rrRatio`
is **recomputed** from the levels via `plannedRiskReward` (`:165`) — **the app does not trust the
model's ratio.**

`analyzeTradingView` (`services/providers/GenericAnalysisService.ts:289`) still exists and still
produces a full `TradeAnalysis` from prose or JSON — but its only production caller is
`services/learning/SkillEvalScheduler.ts:284`. See F-10.

**Boundary schema:** `schemas/tradeAnalysis.ts` (918 lines) — a lenient zod pipeline
(`SanitizedTradeAnalysisSchema` `:10-11`) with `sanitizeLevelOrdering` (`:16`) for SL/TP repair.

#### 4.2 Validation — the gates

**(a) The desk-tool gate — this is the one that binds the live path**
(`services/trade/proposalGate.ts` → `services/validation/GateKeeperService.ts`):

| step | file:line | what it bounds |
|---|---|---|
| `fetchGateInputData(symbol, history)` | `GateKeeperService.ts:365` | — |
| 10 s timeout | `proposalGate.ts:30`, `:67` | a slow scan yields an `unavailable` stamp with `confidenceCap: 1` — deliberately **not** a 0 % cap (`:18-22`: *"0 is a measurement, not an absence"*) |
| `runProgrammaticGate(input)` | `GateKeeperService.ts:70` | → `{pass, confidenceCap, warnings, reason}` |
| `unavailable(reason)` | `proposalGate.ts:54-56`, `:79` | nothing is refused; the plan falls to an explicit confirm and is recorded **UNCAPPED** (`:135`) |
| `isStampFresh` | `proposalGate.ts:113` | 120 s (`GATE_STAMP_STALE_MS` `:38`) — a stale stamp re-scans |
| `ensureStamp` | `proposalGate.ts:122-130` | the ONE call every log path makes |
| `beginGateScan` | `proposalGate.ts:88-102` | one in-flight scan per plan id |
| `cancelGateScan` | `proposalGate.ts:106-111` | a Stop cancels; a late answer cannot resurrect a cancelled card |
| `arm()` refusal | `levelWatchService.ts:217` + `staleLevelsAtArm` (`tradePlanLevels.ts:244`) | refuses a plan already through its SL/target at the live mark — **the watch is refused, not the plan**, and the receipt says so (`presentTradeTool.ts:133`) |

**(b) The full validation gate** — `services/validation/TradeValidationGate.ts:495`
`runValidationGate`. The **only** hard error source is `validateAnalysisOutput` (`:150-201`):
direction ∈ {Long, Short, Neutral}; confidence ∈ {High, Medium, Low, Avoid}; ≥1 entry point with a
price; a stop loss; ≥1 TP with a price; probability ∈ [0,100]; a coin name.

| # | gate | file:line | what it does |
|---|---|---|---|
| 1 | pattern-memory match | `:227-327` | downgrade at similarity ≥80 (`ValidationConstants.ts:14-17`); `normalizedSimilarity = (score/90)*100` `:302` |
| 2 | crowded trade | `:329-382` | funding ≥0.0005 warn / ≥0.001 downgrade; L/S >2.0 or <0.5 (`ValidationConstants.ts:24-33`) |
| 3 | session risk | `:384-436` | "closing soon" within 15 min (`:67`) |
| 4 | timeframe alignment | `:438-481` | High=3 / Medium=2 / Low=1 aligned TFs (`:84-90`); >3 conflicts caps High (`:92`) |
| 5 | multi-TF confluence | called `:602` | pushes **errors** + warnings; may downgrade (`:610-612`) |
| 6 | MTF alignment, 2nd pass | `:615-629` | zero aligned TFs used to be computed and **thrown away**, so it came out "PASSED" (`:619-626`); now a warning |
| 7 | **`validateRiskReward`** | `AccuracyValidationService.ts:196-278`, called `:642` | score 80/30 (`ValidationConstants.ts:57-60`); rejects an **inverted plan** (direction-aware `sanitizeLevelOrdering` `:206-210`, `:243-247`); `ratio < min` (High 2.0 / Med 1.5 / Low 1.2 / Avoid 1.0, `:231-241`); **stop tighter than 1×ATR** `:253-256`; warns >3×ATR `:259`, >5 % of entry `:264` |
| 8 | confidence downgrade on R:R fail | `:646-656` | High→Med→Low; **only** <1:1 (or non-finite) reaches `Avoid` (`:650-655`) |
| 9 | volume confirmation | `:662-679` | errors + warnings; **hard rule**: low volume + High ⇒ cap Medium (`:672-675`) |
| 10 | market regime | `:687` | score + confidence |
| 11 | Devil's Advocate | `:696-710` | risk ≥70 ⇒ force Low; ≥50 ⇒ cap Medium (`ValidationConstants.ts:40-43`) |
| 12 | candle confirmation | `:713` | stale-candle warning |
| 13 | dangerous combinations | `:842` | calibration-bucket combinations |
| 14 | streak / session state | `:858-859` | — |
| 15 | calibration penalty | `:821`, applied `:836` | — |
| 16 | entry timing | `:767-775`; threshold `ValidationConstants.ts:50` | score <35 caps High |
| 17 | SL optimisation warning | `:789` | — |
| 18 | **scalp / swing validation** | `:889`, `:899` → `services/analysis/ScalpDetectionService.ts:150`, `:218` | inverted levels `:171-176`; scalp R:R <1:1 `:179-182`; off-hours `:188-191`; weekend `:193-196`; High + stop >0.8 % `:201-206`; swing R:R <1.5:1 `:237-239` |
| 19 | `quickValidate` | `:983` | field-presence subset only |
| 20 | **the result** | `:543-544`, `:943` | `isValid: errors.length === 0` — *"blocking errors only; a scored-criterion FAILURE is a warning + a confidence downgrade, never a silent pass"* |

**The hard-refusal list is short**: `validateAnalysisOutput` (7 checks) plus whatever confluence
and volume push into `errors`. Everything else is a score, a warning or a downgrade.

**Probability clamp** — `utils/analysisUtils.ts:1399-1443` `clampProbabilityToGate(prob, cap, rrRatio)`:
floor 0 / cap 100 (`:1411-1419`) → cap at the gate cap (`:1422-1427`) → **R:R grade bands**:
`<1.2` ⇒ ≤54 %, `<1.5` ⇒ ≤69 % (`:1430-1440`); then `retierConfidenceForClamp` (`:1445+`) re-tiers
the confidence **word** on the same thresholds, so the number and the label cannot contradict.

#### 4.3 Sizing — where the numbers come from

The canonical planned R:R is `utils/riskReward.ts` (102 lines):
`plannedRiskReward` `:48` = **nearest-to-entry** target distance ÷ `|entry − stop|`, 2 dp, returns
**0** (never NaN or negative) when not computable (`:44-47`); `firstTargetDistance` `:24`;
`riskRewardDistances` `:63`; `fmtRiskReward` `:91` (`2.4:1`, reward first); `fmtRMultiple` `:101`
(realized, deliberately no `:1`).

**Position sizing has no single module.** risk % of equity from `utils/harnessSettings.ts`;
`rMultiple` from `utils/disciplineAnalytics.computeRMultiple` (`hooks/useTradeLogging.ts:362`);
leveraged MAE/MFE from `services/backtesting/outcomeEngine.ts:293-294`; risk/reward % and USD from
`services/backtesting/ScenarioSimulatorService.ts:103-124`; "the ticket" from `utils/ticketSize.ts`;
an ATR-based stop *suggestion* (`AccuracyValidationService.ts:228`, never applied); and the model's
own size (**[M]**).

**The one place a model's number becomes a number the app computes with** is
`services/trade/proposedTrade.ts:126-165`: the model's entry/SL/TP become the row's levels, and the
app **recomputes** the ratio from them. The model does not supply the ratio.

#### 4.4 Logging — one write path

**The single journal write path is `logTradeWithFeedback` — `hooks/useTradeLogging.ts:270`.**
Every route reaches it: the presented plan, a prose chip, a manual log, the auto-capture modal
(`:572`, `:600`) and the autopilot banner (`:778`).

**Trade identity.** `id: message.id` (`:297`) — the trade id **is** the conversation Message id
(`present_trade` reuses it, `:398-399`); `planId` (`:310`) — the id the level-watch armed on;
`sourceRunId` (`:352`) from `runStats.runId`; the ThinkingStore correlation uses a **different
canonical** key, `getThinkingTradeId(analysis.createdAt, trade.id)` (`:453`), with the message id
passed alongside so the outcome lands even when the timestamp key diverges (`:454-457`).

**Dedupe.** `isDuplicate` by id (`:377`); the accumulating side-effects return early (`:390`) while
the idempotent message chrome always applies (`:388-390`) — the ref is advanced **here** because the
effect sync lags one commit, exactly the window a double-confirm fires in (`:370-376`).

**Row contents** (`:296-368`): `analysis` via `withDetectedTradeType` (`:305`), `outcome`,
`timestamp`, `planId`, `outcomeResolvedAt` (`:314` — *when the outcome became known*), `leverage`,
`pnlAmount`/`pnlPercent`, `benchmark`, `correctedStopLoss`/`correctedTakeProfit`,
`triggeredEntryIndices`, `marketSnapshot`, `marketRegime` + `marketRegimeSource` (`:328`),
`slOptimizationData`, `maxAdverseExcursion`/`maxFavorableExcursion` + `excursionSource` (`:337` —
*"provenance, not decoration"*), `realizedR` + `rSource` (`:338-340`), `modelsUsed`,
`thoughtProcesses`, `debateTurns`, `patternMemoryGate`, `promptVersion`, `promptLane`,
`sourceRunId`, `userPriorCall`, `journalTags`, `rMultiple`.

#### 4.5 Resolution — one engine

`services/backtesting/outcomeEngine.ts` (441 lines). Its header (`:1-34`) records that three paths
each had their own scan loop and drifted — the same trade resolved "WIN @ TP3" in the backtest panel
and "WIN @ TP1 + breakeven" in the post-mortem. `scanTradeOutcome` (`:107-`):

| rule | line |
|---|---|
| the entry trigger is the first candle touching entry | `:14` |
| **SL-first on the same candle** ⇒ a candle realizing both is a **LOSS** | `:15-17` |
| an initial SL touch does **not** end the scan (recovery inside the 150 % zone is allowed) | `:18-19` |
| a 150 % zone breach before TP1 ⇒ a hard-stop LOSS (`extendedSlPrice` `:119-121`) | `:20` |
| TP1 ⇒ scale out, stop → **breakeven**, 150 % zone **disarmed** | `:21-24` |
| a later breakeven touch ⇒ the remainder exits **flat**; TP2/TP3 only before it | `:22-24` |
| priority: TP(s) → zone breach → SL touch → OPEN | `:25` |
| **inverted plans are NEVER scored** (`planInvalid` + reason) via `sanitizeLevelOrdering` | `:26-29`, `:135-140` |
| `excludeFormingCandle` drops the still-forming candle | `:31-33` |
| a TP1→breakeven exit blends as `(TP1+breakeven)/2` | `:69-71` |

**Outcome autopilot** — `services/ui/OutcomeAutopilotService.ts` (673 lines), a class singleton at
`:673`, `CHECK_INTERVAL_MS = 20_000` `:85`, `MAX_TRACKED_IDS = 2000` `:113`.
**[Unverified — needs a read of the class body]** the price source, the expiry rule and the hand-off
to the log path were not read. The contract that was read: it exports `AutopilotResolution`,
consumed by `utils/approvalInbox.ts:2`.

#### 4.6 Learning from the outcome

`hooks/useTradeLogging.ts:434` → `syncClosedTradeToNotebook`
(`services/learning/SkillMemoryService.ts:3288`): a `settledTradeIds` guard marked **before any
await** (`:3298-3302`, capped at 2000 `:3305-3308`) → `appendDiaryEntry` → `syncRecurringMistakes`
→ `applySkillEvidence` → `ingestIfThenFromTrade` (`:3312` → `:2781` → `:2664`) →
`recordSettledTradeForMatrix` (fire-and-forget, `:3315-3317`) → `evaluateSkillWorth` +
`validateCraftedSkill` (`:3319-3337`), where a cluster of ≥`MIN_CLUSTER_FOR_SKILL` similar settled
trades can CREATE a skill.

| store | module | holds | written by | read by |
|---|---|---|---|---|
| **skills** | `SkillMemoryService.ts` (3,915) — `skills/*.md` **inside the notebook blob** | evidence-gated procedures + an `enabled` flag | `ingestIfThenFromTrade` `:2664`, `skillGeneralization.ts:126`, `SkillImportService.ts:30` | `MemoryRetrievalService`, `skillPredicate.ts`, prompt assembly |
| **pattern memory** | `PatternMemorySynthesisService.ts` (949) — now notebook-backed under `distilled/` (`:661-688`) | one file per attributed fact | `distilledMemory.ts:208+` | `PatternMemorySynthesisService.ts:692` |
| **rules** | `StorageService.ts:106-137` (`learning_rules_v2_<user>`) | the rules store | **no longer written from outcomes** (`useTradeLogging.ts:189-194`) — **read-only history** for `applyOutcomeToRules` | attribution only |
| **insights** | `AlgorithmicSummaryService.ts` (128), `utils/tradeInsightBrief.ts` (61), `MemoryService.summarizeTrade` | per-trade summaries | `autoAddRecentInsight` (`useTradeLogging.ts:210`) | the Journal's Recent Insights |
| **global memory** | `GlobalLearningService.ts` (245) — `global_learning_state_<user>` | the confidence-calibration aggregate (Brier buckets) | `updateCalibration` (`useTradeLogging.ts:484`) | `calibrationPolicy.ts`, `calibrationPrompts.ts` |

**Two deliberate non-writes** **[Verified by code reading]**: the parallel rules store is no longer
written from outcomes (skills are the single representation); and **`levelsCorrected` plans are
excluded from model training** (`useTradeLogging.ts:169-170`, and again for the Brier ledger at
`:476`) — a mirrored plan's outcome says nothing about the model's reading, and the mirror hides
the error.

**The notebook refuses growth rather than evicting** — `notebookPressureAllows`
(`MemoryFilesService.ts:443`); new files are refused at the trigger tier, all model notes at the
hard cap (`:1310`).

#### 4.7 Deterministic vs model-dependent — the whole chain

| step | kind | where |
|---|---|---|
| market-data fetch | **[D]** | `services/analysis/MarketDataService.ts` |
| TA / candle patterns | **[D]** | `TechnicalAnalysisService.ts`, `CandlePatternDetector.ts`, `taLibrary.ts` |
| hybrid packet assembly | **[D]** | `HybridIntelligenceService.ts` |
| prompt layering | **[D]** over **[M]** content | `utils/composePrompt.ts:36` |
| the model's answer | **[M]** | `sendChatRequest` `:1237` / `streamChatTurn` `:1407` |
| the model's tool arguments (entry/SL/TP) | **[M]** | `present_trade` args → `parseTradeProposal` `proposedTrade.ts:72` |
| level parsing / range checks | **[D]** | `tradePlanLevels.ts:68`, `:88` |
| plan-id minting | **[D]** | `proposedTrade.ts:67` |
| **planned R:R — the card / journal** | **[D]** over **[M]** | `utils/riskReward.ts:48` |
| **planned R:R — the gate** | **[D]** over **[M]**, **a different formula (index 0)** | `AccuracyValidationService.ts:196` ← **F-11** |
| **scalp/swing R:R — the gate's second number** | **[D]** over **[M]**, **a third formula** | `ScalpDetectionService.ts:178`, `:236` ← **F-12** |
| the gate scan (the cap) | **[D]** over market data | `GateKeeperService.runProgrammaticGate` `:70` |
| the full validation gate | **[D]** over **[M]** analysis + **[D]** market data | `TradeValidationGate.ts:495` |
| field-presence validation | **[D]** over **[M]** | `TradeValidationGate.ts:150` |
| zod boundary coercion + level-order repair | **[D]** over **[M]** | `schemas/tradeAnalysis.ts` |
| probability clamp | **[D]** over **[M]** probability | `utils/analysisUtils.ts:1399` |
| the outcome scan | **[D]** over market data | `outcomeEngine.ts:107` |
| realized R multiple | **[D]** | `utils/disciplineAnalytics.computeRMultiple` |
| the journal row | **[D]** assembly over **[M]** analysis + **[D]** outcome | `useTradeLogging.ts:296-368` |
| the learning write | **[D]** pipeline over **[M]**-derived text | `SkillMemoryService.ts:3288` |
| `ingestIfThenFromTrade` rule text | **[M]** text, **[D]** admission gate | `SkillMemoryService.ts:2664`; the gate at `:3330` |
| `evaluateSkillWorth` | **[D]** | `SkillMemoryService.ts:3319` |

#### 4.8 Model output reaching a calculation without validation

| # | site | what the model's output does | validation | assessment |
|---|---|---|---|---|
| 1 | `proposedTrade.ts:126-165` | the model's entry/SL/TP become the row's levels; the ratio is **recomputed** from them (`:165`) | `usablePrice` / `priceArgError`; `sanitizeLevelOrdering`; the gate scan | **Acceptable** — the app does not trust the model's ratio |
| 2 | **`AccuracyValidationService.ts:196`** | the model's **index-0** target decides a **confidence downgrade** (`:646-656`) and, via `analysis.rrRatio`, a **probability clamp** (`analysisUtils.ts:1430`) | `parsePrice`; direction-aware ordering (`:206-210`) | **F-11** — the formula differs from the card's; a 1:1 plan can be gated as 2:1 |
| 3 | **`ScalpDetectionService.ts:178`, `:236`** | the model's index-0 target decides a **second** R:R that downgrades confidence (`:176`, `:181`) | direction-signed risk/reward; inverted-level refusal (`:171-176`) | **F-12** |
| 4 | `utils/analysisUtils.ts:1399` | the model's **own** probability % becomes the displayed number | clamped to [0,100], the gate cap and the R:R bands | **Acceptable** — but the band uses the *card's* ratio, so it and the gate disagree (F-11) |
| 5 | `services/trade/tradeShapedProse.ts:51` `planFromProse` | the model's **prose** is parsed into a `TradeProposal` — a plan stated in a sentence rather than a tool call | `parseTradeProposal` + level checks; `proseNeedsAChip` (`:78`) | **[Unverified — needs X]** whether prose-parsed plans reach the log path *without* the gate scan. `proposalGate.ts:4-8` says the gate must bind "that path too", which implies it does; the call site was not traced |
| 6 | `TradeValidationGate.ts:589` `parsePrice` | the model's price **strings** become numbers | `parsePrice` handles annotations ("94500 4h" → 94500) — `:584-586` records that a naive digit-strip regex produced 945004 (a 100× inflation corrupting R:R and ATR math) | **Acceptable — a good catch by the repo** |
| 7 | `outcomeEngine.ts:107` | the model's entry/SL/TP decide the scan geometry | `sanitizeLevelOrdering` refusal (`:135-140`) | **Acceptable** |
| 8 | `useTradeLogging.ts:305` `withDetectedTradeType` | the model's analysis is re-labelled scalp/swing | `withDetectedTradeType` | **[Unverified — needs X]** the body was not read; if it reads model-authored text it is an unvalidated input |
| 9 | `SkillMemoryService.ts:2664` `ingestIfThenFromTrade` | the **model writes the if/then rule text** into the notebook | the **worth gate** `:3319` + `validateCraftedSkill` + the cluster threshold `MIN_CLUSTER_FOR_SKILL` `:3330` | **Acceptable in shape** — the *text* is model-authored, the *admission* is evidence-gated. This is the intended hybrid design |
| 10 | `services/validation/calibrationPolicy.ts` / `calibrationPrompts.ts` | the model grades calibration | the policy is deterministic | **[Unverified — needs X]** |

---

### A5. The tool surface

**39 static tools (31 core + 8 chart) + 2 mailbox + an unbounded forged set.** Schema size is the
per-request tax: the description plus the JSON parameters.

#### 5.1 The 31 core tools

| tool | def line | schema chars | ≈tok | reads | writes (and where) | timeout | error behaviour | offered on |
|---|---|---|---|---|---|---|---|---|
| `amend_memory` | 824 | 892 | 223 | the notebook | **proposal only** → pending, a human approves | 20 s | `rejected:` | all (automation denies) |
| `forge_tool` | 845 | 1,016 | 254 | — | **proposal only** → candidate | 20 s | `rejected:` | all (automation denies) |
| `write_memory_note` | 869 | 806 | 202 | — | **DIRECT WRITE** → `memory_files_v1_<user>` | 20 s | `rejected:` | all (automation denies) |
| `get_notebook_map` | 891 | 304 | 76 | the notebook | — | 20 s | `DATA_UNAVAILABLE` | all |
| `remember` | 902 | 1,421 | 355 | profile memory | **DIRECT WRITE** | 20 s | `rejected:` | all (automation denies) |
| `read_memory` | 929 | 364 | 91 | profile memory | — | 20 s | `DATA_UNAVAILABLE` | all |
| `forget` | 946 | 276 | 69 | profile memory | **DIRECT DELETE** | 20 s | `rejected:` | all (automation denies) |
| `propose_skill` | 963 | 2,160 | 540 | skills | **PENDING DRAFT** → the Coach inbox | 20 s | `rejected:` | all (automation denies) |
| `propose_strategy` | 996 | 1,609 | 402 | strategies | **DRAFT file** | 20 s | `rejected:` | all (automation denies) |
| `revise_skill` | 1027 | 891 | 223 | skills | **PENDING proposal** | 20 s | `rejected:` | all (automation denies) |
| `read_tool_output` | 1054 | 789 | 197 | the artifact store | — | 20 s | `DATA_UNAVAILABLE` | all |
| `web_search` | 1072 | 465 | 116 | **DuckDuckGo** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_derivatives` | 1092 | 383 | 96 | **Binance fapi** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_order_book` | 1107 | 487 | 122 | **Binance depth** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_liquidations` | 1122 | 329 | 82 | **Binance** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_btc_context` | 1137 | 314 | 79 | **CoinGecko** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_market_packet` | 1152 | 629 | 157 | **Binance** ×4 TFs | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_all_timeframes` | 1167 | 649 | 162 | **Binance** ×5 TFs | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_chart_view` | 1182 | 686 | 172 | **Binance** klines + mark + book | — | 20 s | `DATA_UNAVAILABLE` | **dock only** |
| `get_session_context` | 1198 | 179 | 45 | the local clock | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_price_snapshot` | 1211 | 467 | 117 | **Binance** | — | 20 s | `DATA_UNAVAILABLE` | all — **never cached** (`:379-382`) |
| `get_indicators` | 1231 | 1,660 | 415 | **Binance** → local TA | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_setup_history_stats` | 1257 | 483 | 121 | the local journal | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_trade_log` | 1273 | 1,095 | 274 | the local journal | — | 20 s | `DATA_UNAVAILABLE` | all |
| `recall` | 1292 | 419 | 105 | the notebook + skills | — | 20 s | `DATA_UNAVAILABLE` | all |
| `recall_chat` | 1311 | 524 | 131 | past sessions | — | 20 s | `DATA_UNAVAILABLE` | all |
| `scan_setups` | 1330 | 861 | 215 | **Binance** + the strategy book | — | 20 s | `DATA_UNAVAILABLE` | all |
| `scan_chart_skills` | 1349 | 1,301 | 325 | **Binance**, ≤1000 bars | **PENDING skill drafts** | 20 s | `DATA_UNAVAILABLE` | **dock only** |
| `project_future_price` | 1372 | 853 | 213 | **Binance** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `run_screener` | 1389 | 843 | 211 | the **Binance** universe | — | 20 s | `DATA_UNAVAILABLE` | all |
| `run_monte_carlo` | 1406 | 1,921 | 480 | **none — local MC** | — | 20 s | argument rejections | all |
| | | **25,076** | **6,269** | | | | | |

#### 5.2 The 8 chart tools (dock only)

| tool | def line | schema chars | ≈tok | writes (and where) |
|---|---|---|---|---|
| `draw_on_chart` | 1447 | 1,496 | 374 | **live canvas shapes** |
| `draw_detected` | 1468 | 653 | 163 | **live canvas shapes** (from the detector's geometry) |
| `mark_trade_levels` | 1484 | 509 | 127 | **live canvas Entry/SL/TP** |
| `clear_chart_drawings` | 1502 | 341 | 85 | **deletes canvas shapes** |
| `present_trade` | 1517 | 1,145 | 286 | **the proposal card + the level-watch** |
| `watch_price` | 1540 | 1,026 | 257 | **arms a price watch** |
| `wake_me` | 1560 | 625 | 156 | **arms a timed wake-up** |
| `cancel_watch` | 1578 | 584 | 146 | **cancels watches** |
| | | **6,379** | **1,595** | |

Plus two mailbox tools — `send_message` / `read_message`
(`services/analysis/DebateMailbox.ts:119/139`) — reachable only from the dock's multi-seat panel
(`services/trade/chatTurnRunner.ts:1083-1084` → `:654-656` → `DeskToolsService.ts:3819`). **Live.**

Plus `custom_*` — the **forged** tools (`services/tools/toolForge.ts:176`): an https host the model
itself wrote, **GET or POST**.

#### 5.3 Which surface gets which tools

| | P5 evaluation | P1 chat | P2 dock | P3 automation |
|---|---|---|---|---|
| core (31) | **all 31**, no allow-list | 30 (no `get_chart_view`) | **31** | 30 (no `get_chart_view`) |
| chart (8) | none (no `executePanelTool`) | 1 (`present_trade`) | **8** | 1 (`present_trade`, plan-capped) |
| mailbox (2) | none | none | panel only ✅ live | none |
| forged `custom_*` | yes | yes | yes | **yes — NOT denied** ⚠️ (C-3) |

**Both enforcement points are real and both work.** The offer-time filter
(`DeskToolsService.ts:3354-3358`, native `chat_completions` only) **and** the transport-agnostic
executor allow-list (`:2171-2173`), which is also applied to forged tools *before* the forge
executor (`:3532-3535`, with a comment recording that the gate "used to live only in the core
executor, and `custom_*` routed around it").

#### 5.4 Defined-but-not-exposed

- **`ARBITER_ALLOWED_TOOLS`** (`DeskToolsService.ts:2988-3004`, 9 tools) — **DEAD**. Only
  `tests/evidencePack.test.ts:97-101` and `tests/tradeLogTool.test.ts:112` reference it.
- `analysis.lens`, `LENS_SCALP_PROMPTS` / `LENS_POSITION_PROMPTS`, the three `learningPrompts`
  constants, `analyzeTradingViewWithTransientRetry`, `getLensPromptForStyle`,
  `appendLensMemoryToPrompt` — all dead (§3.3).

**No tool is exposed whose implementation is missing**: all 31 core names have a `case` in
`executeDeskTool` (`:2201-2937`), and the default is `Unknown tool: <name>` (`:2934`).

**No tool throws to the model**: `executeDeskTool` try/catch → `ok:false` + `dataUnavailable()`
(`:2956-2965`), and `withinToolDeadline` (`:227-260`) converts a timeout, an abort or a throw into
a `DATA_UNAVAILABLE:` receipt, so an assistant `tool_calls` turn is always answered (providers
return 400 otherwise). That is a genuinely good design.

#### 5.5 The tool cache — correct, with one gap

`toolCache` (`:317`), `TOOL_CACHE_TTL_MS = 30_000` (`:311`), `TOOL_CACHE_MAX = 200` with
oldest-first eviction (`:321-328`), key = `name@scope:JSON(sorted args)` (`:339-340`).
Only `CACHEABLE_TOOLS` cache (`:373-389`): `get_market_packet`, `get_all_timeframes`,
`get_derivatives`, `get_order_book`, `get_liquidations`, `get_session_context`,
`get_setup_history_stats`, `project_future_price`, `run_screener`, `scan_setups`, `web_search` and
`custom_*`. **`get_price_snapshot` is deliberately excluded** (`:379-382`). Failure sentinels are
never cached (`:2951`).

**`clearDeskToolCache()` is called at exactly one place — `:3772`, the top of
`streamChatWithDeskTools`**, the single generator every tool turn passes through. It also clears
the artifact store, so a `read_tool_output` id from an earlier run is genuinely gone.
`tests/deskToolCache.test.ts:209-227` pins that.

**The gap:** `runDeskToolLoop` is exported and callable *without* the clear. The invariant is
enforced by a **source-shape test**, not a runtime guard — so a new caller can silently break it.

#### 5.6 The tool-output cost, and the worst case

Default per-result cap **2,400 chars ≈ 600 tokens** (`:428`), with overrides (`:431-451`):
`get_market_packet` 6,000 · `get_all_timeframes` 8,000 · `get_chart_view` 8,000 · `run_screener`
4,000 · `get_trade_log` 4,000. **3 calls per round** (`:3449`), **8 rounds** (`:192`), a **180 s
turn** (`:204`, wrap-up at 80 % `:205`), **20 s per call** (`:216`).

**Worst case per turn: 8 × 3 × 8,000 = 192,000 chars ≈ 48,000 tokens.** A typical round is 2–3 calls
≈ 3,000–7,000 chars ≈ 750–1,750 tokens. **The whole message array is re-sent each round**, so it
compounds. Read-back pages at 2,000 (`:316`), and the spill receipt is only offered when the seat
can redeem it (`:470`) ✅.

#### 5.7 What the tools send off the machine

| tool | host(s) | what is sent |
|---|---|---|
| `web_search` | `api.duckduckgo.com` + `html.duckduckgo.com` (`:1624`, `:1666`) | **the model's query verbatim** |
| 12 market tools | `api.binance.com`, `fapi.binance.com` (+ fapi1/2, api1/2/3, `data-api.binance.vision`) — `MarketDataService.ts:249-266`, `KlineService.ts:152-179` | **the trading symbol and interval** |
| `get_btc_context` | `api.coingecko.com/api/v3/global` (`services/analysis/CorrelationRiskService.ts:38,147`) | nothing user-specific |
| `custom_*` | **any https host the model wrote** — `assertSafeForgedUrl` (`:98`): https only, no credentials, port 22 blocked, private/loopback/link-local/multicast blocked, host-position `{param}` slots rejected at save time; same-host redirect policy (`:207-238`); GET-only caching; `MAX_RESPONSE_CHARS = 2,400`; TTL clamped to [5 s, 10 min] | the URL and its parameters, **GET or POST** |
| `run_monte_carlo` | none | — |

**No tool sends an API key, an account id or a credential to a third party.** But on the **web
build** the degraded kline fallback routes the whole Binance request through **three third-party
CORS proxies** — `api.allorigins.win`, `corsproxy.io`, `api.codetabs.com`
(`services/analysis/KlineService.ts:176-178`) — so the symbol and the request URL are visible to
three unrelated operators. That is a real, if low-severity, egress surface, and it is not named in
`PRIVACY.md`.

---

### A6. Security and privacy

#### 6.1 Electron hardening — **[Verified by code reading]** this is genuinely good

| control | state | where |
|---|---|---|
| `nodeIntegration` | **false** | `electron/main.cjs:972` |
| `contextIsolation` | **true** | `:973` |
| `webSecurity` | **true** | `:974` |
| `sandbox` | **true** | `:977` — the renderer is fully sandboxed; the preload bridge is its only privileged surface |
| `setWindowOpenHandler` | **denies everything** | `:1021-1025` |
| `will-navigate` | allows only `http://localhost/` (dev) or `app://` (prod) | `:1027-1029` |
| `setPermissionRequestHandler` | **denies every permission** — media, geolocation, clipboard | `:1324-1329` |
| `registerSchemesAsPrivileged` | the `app:` scheme is registered at boot | `:138` |
| `app://` path traversal | **protected** — `path.relative` + `..` + absolute checks, 403 otherwise | `:929-937` |
| the renderer bridge | **no filesystem, no SQLite, no Node** — 15 methods, all of them either version info, updater control, `safeStorage`, or provider egress | `electron/preload.cjs` |

**The `app://` handler is the part most Electron apps get wrong, and this one does not**: it
resolves the path, then checks `relativePath === '..'`, `relativePath.startsWith('..' + sep)` and
`path.isAbsolute(relativePath)` before serving. A `../../` escape is refused with a 403.

#### 6.2 The Content-Security-Policy

**[Verified by code reading]** `index.html`:

```
default-src 'self' app:;
script-src 'self' https://s3.tradingview.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://s3.tradingview.com https://www.tradingview.com;
font-src 'self' data:;
connect-src 'self' app: https: wss: ws: blob: data:;
worker-src 'self' blob:;
frame-src https://s3.tradingview.com https://www.tradingview.com https://tradingview.com;
object-src 'none';
base-uri 'self'
```

**Good:** `default-src` is narrow; `object-src 'none'`; `base-uri 'self'`; no `unsafe-eval`
anywhere; no `*`.

**Three things to note, in descending order of interest:**

1. **`script-src` allows a remote origin** — `https://s3.tradingview.com`. It is there for the
   TradingView widget, but it means a compromised bucket, or a MITM against that one origin,
   becomes arbitrary script in the app. There is no SRI-style integrity control on it.
2. **`connect-src` allows `https:` and `wss:`/`ws:` universally.** That is a deliberate trade-off —
   the provider URL is user-configurable, so it cannot be pinned — but it also permits the three
   CORS proxies in §5.7, and `ws:` (plaintext) alongside `wss:`.
3. **No `frame-ancestors`, no `form-action`.** Minor for a desktop app with no frames of its own
   except TradingView.

#### 6.3 Secrets

- **Desktop:** API keys are encrypted at rest through Electron `safeStorage`
  (`electron/main.cjs:1279` `crypto:encrypt`, `:1289` `crypto:decrypt`), bridged by
  `electron/preload.cjs:26-27`, and `services/infrastructure/ProviderConfigService.ts` encrypts on
  save and decrypts on load. **The plaintext is returned into the renderer** on demand, so it exists
  in renderer memory while a request is in flight. That is the correct shape for a renderer that
  must sign a request, but it means "encrypted at rest" is the honest claim, not "never in the
  renderer".
- **Web / Capacitor:** the keys stay **plaintext** in Preferences. That is documented.
- **Never committed:** **[Verified live]** a working-tree scan for `sk-…`, `AIza…`, `ghp_…`,
  `AKIA…`, `-----BEGIN … PRIVATE KEY-----` and `xox…` across every tracked text file returns
  **zero** hits. A history scan across the **520 most recent revisions** returns hits in exactly
  one file — `tests/runStatus.test.tsx:90,94,98,100` — and those are **deliberate fake keys in a
  sanitizer test fixture** (the test asserts the error-text sanitizer strips them). The 120
  earliest revisions (including `9afc42d1`, whose subject is *"Initial commit (secrets removed)"*)
  return **zero** hits. **No secret was found in the tree or in the scanned history.**
- **Logging:** the repository has `utils/runStatus.ts`'s error-text sanitizer, and the test above
  proves it is applied. `AGENTS.md` and `services/providers/GenericProviderService.ts`'s
  `toFriendlyProviderError` establish the rule that raw API error bodies are never surfaced.

#### 6.4 The no-order-placement guarantee — **verified, and enforced by a test**

**[Verified by code reading]** a repository-wide search for exchange order endpoints
(`/api/v3/order`, `/fapi/v1/order`, `createOrder`, `placeOrder`, `submitOrder`, `new_order`)
returns **only public market-data paths**: `klines`, `ticker/price`, `premiumIndex`, `depth`.

**And the guarantee is pinned by a test**, which is the right way to keep it:
`services/analysis/../constants/disclaimer.ts` is asserted by `tests/disclaimer.test.ts` to say
the app *"never places or signs a trade"* and that the first-run notice says *"no exchange account
access"*; `PRIVACY.md` is asserted to contain the real market-data endpoints and to say *"no API
key, no signature"*; and the test also asserts `PRIVACY.md` mentions `X-MBX-APIKEY` (i.e. that the
header the app *does not* send is named, so the omission is explicit).

**Conclusion: the product framing's central promise holds at the pin, and is defended by a gate
rather than by a comment.** That is the strongest single piece of engineering hygiene in the
repository.

#### 6.5 What leaves the machine, and when

| destination | what | when |
|---|---|---|
| the user's configured provider endpoint(s) | the whole conversation, the system prompt, the tool schemas, the trader's text, the retrieved context, the tool results | every model call |
| `api.binance.com`, `fapi.binance.com` (+ mirrors), `data-api.binance.vision` | symbol + interval | every market-data read |
| `api.coingecko.com` | nothing user-specific | the BTC-context tool |
| `api.duckduckgo.com` / `html.duckduckgo.com` | **the model's query verbatim** | the `web_search` tool |
| `api.allorigins.win`, `corsproxy.io`, `api.codetabs.com` | the whole Binance request URL, via the degraded kline fallback | **web build only**, when the direct path fails |
| `s3.tradingview.com`, `www.tradingview.com` | the widget's own traffic | the TradingView integration |
| the update feed (`electron-updater`) | the app version and platform | on a scheduled check and on demand |
| `sentry`-like telemetry | **none** — no telemetry host appears in the source | — |

**No portfolio, no P&L, no journal row and no credential is ever sent to a market-data or search
host.** The only place trade data goes is the provider the trader configured — which is the
product's whole premise, and is disclosed in `PRIVACY.md` and in the first-run notice.

**The CORS-proxy fallback is the one item `PRIVACY.md` does not name.** Low severity (a symbol and
a URL are not private), but it is a third-party relay and the doc's own test asserts the doc names
"the real market-data endpoints".

---

### A7. Reliability

#### 7.1 What is handled well

These are not filler; they are the reason the app is shippable at all, and they should not be
lost in a cleanup.

| behaviour | where |
|---|---|
| **no tool throws to the model** — a timeout, an abort or a throw becomes a `DATA_UNAVAILABLE:` receipt, so an assistant `tool_calls` turn is always answered (providers 400 otherwise) | `services/analysis/DeskToolsService.ts:227-260`, `:2956-2965` |
| **the notebook refuses growth rather than evicting** — a soft/trigger/hard byte ladder, and a classifier that decides the tier | `utils/memoryBudget.ts`; `MemoryFilesService.ts:443`, `:1310` |
| **a notebook write that never reached disk is surfaced, not swallowed** — `persist` records the failure (quota vs error, bytes, streak), rethrows so no caller's handling changes, and clears on the next success | `MemoryFilesService.getNotebookWriteFailure()` |
| **the gate is fail-open with a cap, never fail-silent** — an unavailable scan yields `confidenceCap: 1` and a recorded **UNCAPPED** plan, not a 0 % and not a refusal | `services/trade/proposalGate.ts:18-22`, `:54-56`, `:135` |
| **the outcome engine is conservative in the right direction** — SL-first on the same candle is a loss; an inverted plan is never scored; the still-forming candle is excluded | `services/backtesting/outcomeEngine.ts:15-17`, `:26-29`, `:31-33`, `:135-140` |
| **`levelsCorrected` plans are excluded from model training** and from the Brier ledger | `hooks/useTradeLogging.ts:169-170`, `:476` |
| **the settled-trade guard is marked before any `await`**, so a double-fire cannot double-write | `services/learning/SkillMemoryService.ts:3298-3302` |
| **the provider is the single place errors are made user-safe** | `GenericProviderService.toFriendlyProviderError` |
| **the migration layer cannot lose data** — all seven SQLite migrations are additive, and a version is recorded only if every statement applied | `services/infrastructure/SqliteService.ts:296-308`, `:311-363` |
| **one request-sending function, one wire policy, three transports** — the renderer and the Electron main cannot drift | `GenericProviderService.ts:1237`; `shared/providerRequestPolicy.cjs` |
| **`clearDeskToolCache()` has exactly one call site** and it is the choke point every tool turn passes through, pinned by a test | `DeskToolsService.ts:3772`; `tests/deskToolCache.test.ts:209-227` |

#### 7.2 Weaknesses

| ID | sev | finding | evidence |
|---|---|---|---|
| **F-01** | **HIGH** | **The assembled context is computed and then DISCARDED.** `enhancedPrompt` and `hybridDataInjection` in `hooks/useAnalysisPipeline.ts` are built and only `devLog`ged; the request sends `promptToSend`. The trader's turn gets **no** retrieved notebook, no matched-skill body, no skill-trigger note, no similar-setups, no reflections, no recent insights, no market packet. | `useAnalysisPipeline.ts:1003-1154`; sends at `:1214`, `:1323`, `:1350` |
| **F-01b** | **HIGH** | **The injection ledger therefore records skills the model never received.** `getMemoryFilesContext` **records an injection** by default (`MemoryRetrievalService.ts:976-981`); `assemblePipelineMemoryContext` calls it without `recordInjections: false` (`hooks/analysisPipeline/memoryContext.ts:150`); and the result is thrown away. `skillAdherenceForRun` (`MemoryInjectionService.ts:189`) is the join `applySkillEvidence` (`SkillMemoryService.ts:1617`) uses to grant **FOLLOWED** credit. The documented cold-start contract — *"evidence accrues only on the FOLLOWED branch… a skill the run was not shown goes to `controlIds`, never to W/L"* (`docs/learning-loop-map.md:80-91`) — is therefore **violated in the app's favour**: skills earn credit for outcomes they did not influence. | see left |
| **F-01c** | **HIGH** | **The gate injection is a hard-coded empty string.** `const gateInjection = '';` at `useAnalysisPipeline.ts:1138` — the whole "GATE KEEPER: Two-Stage Gate Scan" block (`:1113-1150`) computes nothing, and the `devLog('[GateKeeper] Gate constraints injected into prompt')` at `:1148` can never fire. | `useAnalysisPipeline.ts:1138` |
| **F-03** | **Med-High** | **`approval_rules_v1:<user>` is on neither allow-list** — on web it is exported and then refused on import; on native it is neither exported nor restored. It gates **every auto-apply**. The repo's own test says *"worth a decision"*; the decision was never taken. | §2.6 F-04; `utils/approvalInbox.ts:46`; `ExportService.ts:758-760` |
| **F-10** | **Med-High** | **The analysis prompt never reaches a trader-facing answer.** `analyzeTradingView` has exactly one production caller — the skill-eval scheduler. `analyzeTradingViewWithTransientRetry` has zero. The harness contract, the analyst persona, the R:R rules and the memory-enforcement prompt reach a model **only in the skill-eval harness**. | `GenericAnalysisService.ts:289`; `SkillEvalScheduler.ts:284`; `useAnalysisPipeline.ts:228-254` |
| **F-10b** | **HIGH** | 🔴 **The 986-line validation gate has ZERO production callers** (verified 2026-10-20). `grep 'runValidationGate\|TradeValidationGate'` over every non-test file returns only the definition and **two comments in other files offering to feed it** (`services/analysis/EntryTimingService.ts:588`, `services/backtesting/StopLossOptimizerService.ts:332`). Only the narrower `GateKeeperService` is live, via `services/trade/proposalGate.ts`. **⇒ The product's "deterministic code checks" half is not connected.** This makes F-11 a decision (wire it, or retire it), not a refactor. See Report 4 §15.2. |
| **F-11** | **HIGH** | **The validation gate computes R:R from `takeProfit[0]`** while the card, the journal and the probability clamp use the **nearest** target. On an out-of-order target list a 1:1 plan can be **gated as 2:1** while the clamp applies the 1:1 band. This is exactly the drift `utils/riskReward.ts` was written to end, and the gate was never migrated. | `TradeValidationGate.ts:589` → `AccuracyValidationService.ts:196-222` vs `utils/riskReward.ts:48` → `utils/analysisUtils.ts:1272-1278` |
| **F-12** | **Med** | **A second R:R implementation inside the same gate run** — `services/analysis/ScalpDetectionService.ts:178` and `:236`, both index-0, called at `TradeValidationGate.ts:889` and `:899`. The file's own "never wired in" comment (`:160`) is stale. | see left |
| **F-13** | **Med-High** | **There is no cost model anywhere.** A repository-wide search for `slippage|takerFee|makerFee|commission|costBps|feeRate` finds only a *warning string* (`ScalpDetectionService.ts:189`), a *comment* (`ReinforcementSignalService.ts:50`) and the `netR` accumulator in `SkillMemoryService.ts`. **Every R in the journal, every win rate, every calibration bucket and the whole skill ledger is gross.** Note that `netR` is a misleading name: it is the **sum of realized R multiples**, not net of costs. | §7.4 below |
| **F-14** | **HIGH** | **The roster store was read but never written at the pin.** `bots_v1_<user>` is written only by `BotRegistry.upsert` and `BotRegistry.seedIfEmpty`; `395f73db` removed the second, and there is **no production caller of `upsert`**. `BotRegistry.list()` therefore always returned `[]`, which silently killed (a) the bot-memory merge into the prompt context (`hooks/analysisPipeline/memoryContext.ts:98-99`) and (b) the skill-worth gate's authoring-bot context (`SkillMemoryService.ts:3365-3380` — it fell back to `trade.id` every time, defeating the exact failure the code comment says it exists to prevent). **Fixed by the concurrent session's in-flight work.** | `services/bots/BotRegistry.ts:14-75` |
| **F-15** | **Med** | **`buildHybridEnvelope` is imported and never called.** `hooks/useAnalysisPipeline.ts:66` imports it; a repository-wide search returns exactly two hits — the import and the definition. | `useAnalysisPipeline.ts:66`; `utils/debateEnvelopes.ts` |
| **F-16** | **Med** | **The truncation tally records nothing.** `beginTruncationWindow()`, `consumeTruncations()` and `peekTruncations()` have zero production call sites, so `recordFinishReason` returns immediately (`!windowOpen`). `AGENTS.md` tells a future reader to "read the ceiling with `peekTruncations()`" — there is no reader. | `utils/finishReason.ts` |
| **F-17** | **Med** | **The "Prompt A/B (control lane)" control does nothing.** `beginPromptLane` has zero call sites, and `runStats.promptLane` is never assigned — so the "Prompt lanes" dashboard card is inert. | `PromptOverrideService.ts:24-38`; `useAnalysisPipeline.ts:1242,1403`; `App.tsx:1727,1754` |
| **F-18** | **Med** | **The in-flight `getBots()` is a getter with a destructive write-on-read migration that runs during React render.** The first read of a profile permanently strips `role`/`enabledTools` from every stored bot row, and the write path calls `notify()`, which can land a `setState` during render. **[Unverified — needs `npm run render-probe`]** whether it warns or loops. *This is a review point on the concurrent session's work, not a proposal.* | `services/agents/agentRoster.ts` (in-flight); `hooks/useAgentThreads.ts:63` |
| **F-19** | **Med** | **`app.getVersion()` and the in-app version can disagree.** `constants/version.ts:6` falls back to the literal `'1.0.28'` when `import.meta.env.PACKAGE_VERSION` is absent (the Vite `define` supplies it in builds, `vite.config.ts:443`), while `package.json` says `1.3.0` and the comment claims the literal is "kept synced with package.json". It is five minor versions behind. | `constants/version.ts:6`; `package.json` |
| **F-20** | **Med** | **The committed lockfile does not match the committed manifest.** `package-lock.json` says `1.0.30`; `package.json` says `1.3.0`; and the lockfile's root `devDependencies` block lacks `js-yaml` (which `package.json` lists and `scripts/check-workflow-shells.cjs:32` imports). The fix is sitting uncommitted in the working tree. | `package.json`; `package-lock.json`; `scripts/check-workflow-shells.cjs:32` |
| **F-21** | **Info** | **The legacy `approval_rules_v1` (unscoped) is read but never written and never deleted** — it can shadow the scoped key indefinitely. | `utils/approvalInbox.ts:30` vs `:46` |

#### 7.3 F-01 in detail — the single most important finding

This deserves its own section because it is the one finding that changes what the app *is*.

**What is assembled, per send, in `hooks/useAnalysisPipeline.handleSendMessage`:**

| assembled | pin line | fate |
|---|---|---|
| `hybridDataInjection` — the entire hybrid market packet | `:940` / `:981` | only `devLog`ged at `:965` and `:1153` — **never in a prompt** |
| `memoryFilesContext` — the retrieved notebook, the **matched skill body**, the risk rules, the recurring-mistake line, the recent-form block, similar trades, the family×regime matrix, the doctrine, the settled beliefs | `:1005` | → `contextParts` `:1106` → `enhancedPrompt` `:1110` → **never read again** |
| `similarSetupsContext` | `:1006` | → `:1107` → discarded |
| `learningInjection` — the weighted-voting block | `:1080` | → `:1108` → discarded |
| `predicateGate.note` — the **code-checked** skill trigger | `:1030-1049` | → `:1109` → discarded |
| `buildDecisionReflectionContext(loggedTrades, finalSymbol)` — the Reflexion loop over the trader's own closed trades | `:1130` | prepended at `:1132` → discarded |
| `recentInsightsString` | `:1098` | only `devLog`ged `:1099` |
| `gateInjection` | **hard-coded `''`** `:1138` | never anything |
| `enhancedPrompt` | `:1103`, mutated `:1110`/`:1132`/`:1147` | `devLog`ged `:1152` — **never read again** |

**What is sent instead: `promptToSend`** (`:779`) — at `:1214` (automation), `:1323` (the bot quick
response) and `:1350` (the desk, `runChatSurfaceTurn` at `:1347`).

**So the trader's own turn reaches the model with:**
- the system prompt: the surface mandate + a **skills index** (slug, status, kind, description,
  if/then — up to 30 rows) + active strategies + the profile-memory index + the desk-tools block;
- the trader's own text.

**And it does not reach the model with:** the retrieved notebook, the **body of the skill that
matched**, the code-checked skill trigger, the similar setups, the trader's own closed-trade
reflections, the recent insights, the calibration block, the hybrid market packet, or the gate
constraints.

**This is not a broken retrieval.** `getMemoryFilesContext` works, the budgets work, the injection
records work, the skill-evidence join works. The output is simply routed to a variable that
nothing sends. It is the classic "assembled, then dropped" shape — and it is exactly the kind of
defect that **unit tests cannot see**, because every one of them asserts that a function *returns*
the right thing, and none of them asserts that the right thing is *sent*.

**The live desk path has its own, narrower, deliberate context assembly**
(`services/trade/chatSurfaceTurn.ts:105-139` `surfacePromptWith`): mandate + skills index +
strategies + profile memory, each read fresh per turn, each block separately guarded so an
unreadable notebook costs the prompt some text rather than the answer. The design is defensible —
a *pull* model, where the model reaches deeper with `recall` / `get_notebook_map` / `read_memory`.
**But the pull model is not what the code is wired for**: the push model is fully built, fully
budgeted, fully instrumented, and disconnected.

**Three consequences, in increasing severity:**

1. **Cost and latency.** Every send pays for a retrieval it does not use — including a
   `getMemoryFilesContext` call that does similarity search and writes an injection record.
2. **The learning loop's evidence chain is corrupted (F-01b).** The app records "this run saw
   skill X"; the model did not see skill X; the outcome is credited to skill X. The documented
   cold-start contract is violated in the app's favour, and the effect is a **skill ledger that
   rewards skills the trader did not act on**. The prior audit's independent reading of the same
   code (2026-10-18) reached the same conclusion from the other end.
3. **The "hybrid intelligence" the app is named for is not in the prompt.** `hybridDataInjection` —
   the packet built from `services/analysis/HybridIntelligenceService.ts` — is computed and
   devLogged.

#### 7.4 The prior audit's claims, re-verified against the pin

The previous audit (`docs/analysis/05-lead-findings.md`, dangling commit `508b691a`, authored against
HEAD `04b4d25`, 162 commits before the pin) was read in full and **every material claim was
re-checked**. Results:

| prior claim | verdict at the pin `6a41a9f7` |
|---|---|
| **No cost model anywhere** — "every R in the journal, every win rate, every calibration bucket and the entire skill ledger are gross" | **STANDS.** A repository-wide search for `slippage|takerFee|makerFee|commission|costBps|feeRate` returns three files: a warning string (`ScalpDetectionService.ts:189`), a comment (`ReinforcementSignalService.ts:50`) and the `netR` accumulator (`SkillMemoryService.ts:1431`). `netR` is the **sum of realized R multiples** (`meta.netR = round(((meta.netR ?? 0) + r) * 100) / 100`), not net of costs — so the name is misleading and the claim is correct. |
| **The ensemble weighting is inverted** — `winRate: perf.overallStats.total >= 3 ? perf.overallStats.winRate : 0`, so a provider with one loss scores 0.0 % and a provider with no trades also scores 0.0 %; the gate only requires *some* provider to have ≥5 trades | **STANDS, verbatim.** `services/backtesting/ModelPerformanceService.ts:649` — identical at the pin. The sort is at `:657`, best/worst at `:669-670`, and the moderator is told to favour the top one. **A single loss can brand a model as the worst performer, and a single lucky win the best.** |
| **The feedback loop is starved: n = 0 resolved trades** | **NOT RE-VERIFIABLE BY US** — that was measured from the owner's live profile on 2026-10-18, and the brief forbids touching a live profile. The *mechanism* is confirmed in code: confirmation is a human click (`hooks/useWatchAndAutopilot.ts:178` → `App.tsx:2372` → `confirmAutopilotOutcome`), and `markProcessed` is reached only **after** that click (`OutcomeAutopilotService.ts:650` ← `useWatchAndAutopilot.ts:201`). The downstream consumers that need closed rows (auto-learn `useTradeLogging.ts:122`, the loss-similarity penalty, the skill A/B `SkillEvalService.ts:53`, `weeklyReview.ts:135` with `MIN_CLOSED_TRADES_FOR_REVIEW = 3`, the Brier calibration, `calibrationPolicy.ts:800` with `MIN_TRADES_FOR_CALIBRATION = 10`) are all correctly written and all starved of data. **Whether n is still 0 is a question only the owner can answer — see the open questions.** |
| **`finalizeVerdict` has zero production importers** | **RESOLVED.** `git grep finalizeVerdict 6a41a9f7` returns **nothing** — the function is gone. |
| **`computeContractSize` / `utils/ticketSize.ts` is test-only — "the correct, grade-tiered, fail-closed sizing module does not size anything in the running app"** | **STANDS.** `git grep computeContractSize 6a41a9f7` returns only `tests/financialMath.test.ts:10,327,336,346` and `tests/ticketMathTiers.test.ts:6,80,91,103,109,182`. **Zero production call sites.** |
| **`utils/analysisReport.ts` is test-only** | **RESOLVED** — the file no longer exists at the pin. |
| **`services/analysis/analysisResultProcessor.ts` has no production caller** | **RESOLVED** — the file no longer exists; only two comments mention it (`schemas/tradeAnalysis.ts:503`, `utils/analysisUtils.ts:1176`). |
| **`enhancedPrompt` is built and never passed to a model** | **STANDS** and is now the headline finding — see F-01. |

**One latent split-store bug the prior audit could not see, and the concurrent session fixes:**
at the pin, `hooks/analysisPipeline/memoryContext.ts:98` assembled the pipeline's bot-memory context
from `BotRegistry.list()` → the **Preferences** key `bots_v1_<user>`, while the roster the UI
actually writes lives in the **raw localStorage** key `agents_bots_v1_<user>`
(`services/agents/agentRoster.ts:73`). Two different keys in two different stores — so the bot
memory injected into the analysis context was **empty in practice** even before F-14 closed the
reader.

---

### A8. Performance

#### 8.1 Startup and the bundle

**[Verified live]** the existing `dist/` build (written 2026-10-19 16:58, i.e. from the tree as it
stood shortly before the pin) measures:

| asset | size | note |
|---|---|---|
| `index-*.js` (the entry chunk) | **1,352.6 kB** | the startup chunk |
| `pdf.worker.min-*.mjs` | **1,343.6 kB** | `pdfjs-dist`'s worker — **never on the startup path**, but it is a third of the total |
| `MarkdownRenderer-*.js` | 426.8 kB | `react-markdown` + `remark-*` + `rehype-katex` + `katex` |
| `StrategiesTab-*.js` | 340.9 kB | |
| `AreaChart-*.js` | 297.0 kB | `recharts` |
| `index-*.css` | 198.1 kB | |
| `vendor-react-*.js` | 188.4 kB | |
| `Journal-*.js` | 178.2 kB | |
| `vendor-ai-*.js` | 69.2 kB | |
| **total `dist/assets`** | **6,742.4 kB** | |
| plus KaTeX fonts | ~500 kB across TTF + WOFF | shipped, for a feature most users never touch |

**[Verified live]** `dist/` is **gitignored** and **not tracked** — correct.

**Two observations.**

1. **The ratchet has drifted loose.** `.github/workflows/guards.yml` fails the build if the entry
   chunk exceeds **2,600 kB**, and its comment says *"the last measured entry chunk was ~1956 kB"*.
   The measured entry chunk is **1,352.6 kB** — roughly **48 % below** the ceiling and **31 % below**
   the figure the ratchet was calibrated against. The ratchet can no longer catch the regression
   class it exists for. *(This is the same failure mode as the lint ratchet in §10.)*
2. **The startup chunk is 1.35 MB and the app is 2,672 lines of `App.tsx`.** The code-splitting is
   good — `App.tsx` has **26 `React.lazy()` boundaries** (Automation, Settings, Journal, TradeView,
   Learn, Agents, the modals), and the comment at `App.tsx:49-53` records the previous state
   ("Previously the entire app was one ~1.73 MB chunk"). The remaining 1.35 MB is React, the
   providers, `react-markdown`/`katex`, and the eagerly-imported surfaces.

#### 8.2 The eager-import hazard is real and unguarded at the source level

The `guards.yml` ratchet is the only thing standing between the repo and the regression class
`vite.config.ts` documents: *"a 363KB static chart import pulled into the eager startup graph by
one top-level import."* A **ratchet on the output** catches it only after the fact and only if
the CI job runs; it does not stop the next import. There is no import-boundary lint.

**[Verified by code reading]** the source-level guard that does exist is a **test**:
`tests/oneFactOnePlace.test.ts` and `tests/mountedAuditPanels.test.ts` cover shape, not the
eager-import graph. A `tests/noEagerHeavyImports.test.ts` that asserts "no top-level import of
`recharts` / `lightweight-charts` / `pdfjs-dist` in `App.tsx` or `index.tsx`" would be ~20 lines and
would catch the class at the point it is introduced.

#### 8.3 Polling and timers — **[Verified by code reading]**

Every timer in the app, at the pin:

| interval | where | what it does |
|---|---|---|
| **1,000 ms** | `components/trade/TradeView.tsx:666` | a clock tick (`setNowMs`) |
| **2,000 ms** | `services/analysis/MarketDataService.ts:17` (`LIVE_MARK_TTL`) | the live mark cache TTL |
| **2,000 ms** | `hooks/useFuturesLiveFeed.ts:69` (`POLL_ARM_MS`) | arms the futures poll |
| **5,000 ms** | `services/analysis/MarketDataService.ts:25` (`POINT_IN_TIME_TTL`) | the point-in-time cache TTL |
| **5,000 ms** | `hooks/useFuturesLiveFeed.ts:59` (`POLL_INTERVAL_MS`) | the futures live feed |
| **5,000 ms** | `services/trade/levelWatchService.ts:91` (`PRICE_POLL_INTERVAL_MS`) | the armed price watch |
| **5,000 ms** | `components/shared/Header.tsx:93` | session refresh |
| **5,000 ms** | `components/settings/ProviderManager.tsx:88` | a tick |
| **5,000 ms** | `components/settings/SettingsMenu.tsx:254` | a sync |
| **5,000 ms** | `components/shared/AnalyzedRow.tsx:58`, `components/shared/ReasoningRow.tsx:90` | row ticks |
| **5,000 ms** | `components/trade/BiasChips.tsx:52` (`REFRESH_MS`) | the bias chips refresh |
| **10,000 ms** | `services/learning/skillSupervisor.ts:596` (`EVENT_DEBOUNCE_MS`) | the supervisor's event debounce |
| **15,000 ms** | `components/trade/TradeView.tsx:590` and `:608` | two polls |
| **20,000 ms** | `services/ui/OutcomeAutopilotService.ts:85` (`CHECK_INTERVAL_MS`) | the outcome autopilot |
| **30,000 ms** | `services/analysis/DeskToolsService.ts:311` (`TOOL_CACHE_TTL_MS`), `services/analysis/KlineService.ts:28`, `services/analysis/MarketDataService.ts:12` | cache TTLs |
| **30,000 ms** | `components/dashboards/VersionHistoryDashboard.tsx:53` | a metrics refresh |
| **60,000 ms** | `hooks/useMarketData.ts:90`, `:164`, `:171` | the market conditions poll and two connection checks |
| **90,000 ms** | `services/learning/skillSupervisor.ts:597` (`SEND_THROTTLE_MS`) | the supervisor's send throttle |
| **300,000 ms** | `services/analysis/CorrelationRiskService.ts:18` (`DOMINANCE_CACHE_TTL`) | a cache TTL |
| **600,000 ms** | `services/analysis/CorrelationRiskService.ts:22` (`LEVELS_CACHE_TTL`) | a cache TTL |
| **10 minutes** | `services/learning/sessionSkillReview.ts:306` (`RESOLVER_THROTTLE_MS`) | a throttle |
| **15 minutes** | `hooks/useLearningHeartbeat.ts:70` (`LEARNING_HEARTBEAT_MS`) | the learning sweep |
| **30 minutes** | `services/infrastructure/BackupService.ts:34` (`AUTO_BACKUP_INTERVAL_MS`) | the auto backup |
| **1 hour** | `services/agents/botMailbox.ts:33` (`DM_ENVELOPE_TTL_MS` = 15 min) | envelope expiry |
| **6 hours** | `hooks/useModelCatalogRefresh.ts:26` (`SWEEP_INTERVAL_MS = 6 * 3_600_000`) | the model-catalog sweep |
| **7 days** | `services/learning/weeklyRollup.ts:36` (`ROLLUP_INTERVAL_MS`) | the weekly rollup |
| **14 days** | `services/learning/sessionSkillReview.ts:308` (`OPEN_THESIS_TTL_MS`) | thesis expiry |
| **30 minutes** | `services/analysis/toolArtifactStore.ts:46` (`ARTIFACT_TTL_MS`) | the artifact store |

**Two things stand out.**

- **The 1-second clock in `TradeView.tsx:666` re-renders the whole trade surface every second.**
  A `setNowMs(Date.now())` in a component with a 1,100-line body (and a chart, and an order book,
  and a transcript) is a full re-render per second, for the lifetime of the surface. It is very
  likely the single largest avoidable render cost in the app. **[Unverified — needs a React
  DevTools profiler run]** whether the components below it are memoised.
- **Every timer is inside a `useEffect` with a cleanup**, which is the correct pattern and is
  applied consistently across the ~22 sites. No leaks were found by reading. **[Unverified — needs a
  runtime check]** that every path returns its handle.

#### 8.4 Network call volume

Per turn, the desk path issues: 1 provider request per round, up to 8 rounds; plus 3 tool calls
per round, each of which may hit Binance. **The tools are cached for 30 s** (the 11 cacheable
tools), so a burst of turns does not multiply market-data traffic — but `get_price_snapshot` is
**deliberately not cached** (`:379-382`), so it hits Binance every time.

The provider request **re-sends the whole message array each round** (§5.6). That is inherent to the
API shape, but it means the cost of a long tool loop is quadratic in the number of rounds.

#### 8.5 Memory growth

The caches that grow with use, and their bounds:

| cache | bound | where |
|---|---|---|
| the desk tool cache | 200 entries, oldest-first eviction | `DeskToolsService.ts:321-328` |
| the tool artifact store | 30-minute TTL | `toolArtifactStore.ts:46` |
| the in-flight gate scans | one per plan id | `proposalGate.ts:88-102` |
| the settled-trade guard | 2,000 ids | `SkillMemoryService.ts:3305-3308` |
| the autopilot's tracked ids | 2,000 | `OutcomeAutopilotService.ts:113` |
| the correlation caches | 5 min / 1 min TTLs | `CorrelationRiskService.ts:18,22` |

**All of them are bounded.** That is a deliberate and well-executed part of the design. The
**unbounded** growth is on disk, and it is handled by the notebook's refusal-to-grow policy
(§2.4) and by the export caps.

---

### A9. UX and accessibility

#### 9.1 The shell

The app is **four surfaces** — `useSurface.ts`'s `VALID` array is `['trade', 'journal', 'agents',
'learn']` — chosen from a rail (`components/shell/NavRail.tsx`) with a title-bar switch
(`components/shell/SurfaceSwitch.tsx`) and keyboard shortcuts `Alt+1..5` (`SURFACE_ITEMS`).

**[Verified by code reading]** `hooks/useSurface.ts` declares
`export type AppSurface = 'chat' | 'trade' | 'journal' | 'agents' | 'learn';` but the `VALID` array
has only four members. **`'chat'` is in the type union and can never be a valid stored value** — it
is a migration case only (the old Chart AI dock). The type should not carry it.

`components/shell/SurfaceSwitch.tsx` reads `SURFACE_ITEMS` from `SurfaceMenuList` rather than
declaring its own list — "the drift this repo keeps hitting is a second copy of the destination
set." Correct, and worth keeping.

#### 9.2 The doctrine is written down, and the code largely follows it

`docs/ui-doctrine.md` (7,901 bytes) exists and is specific: no sliding `.seg-thumb`, no `z-50`
outside a ladder, one `SurfaceHeader` grammar, `EmptyState` with an `action`, radius tokens,
`bg-surface-page`, amber = attention and cyan = live/data, and a brand gradient reserved for the
wordmark.

**[Verified by code reading]** the doctrine is followed where it is explicit — the brand gradient
is used for the wordmark and the active-nav indicator; the surface switch uses a pressed state
rather than a sliding thumb, with the reason written down in the file.

**But the roadmap's own audit says the doctrine is not enforced** — and the roadmap items
`R-035` ("radius tokens — write the gate first, then sweep 650 sites"; *"no test gates it at
all"*), `R-042` (*"17 `EmptyState`, **0 pass `action=`**"* — *"the single cheapest 'powerful'
win"*), `R-043` (*"buttons that never render"*), `R-045` (*"20 `fallback={null}`"*) and `R-056`
(*"7 legacy `z-50`"*) are all **still needed** at the pin. **A doctrine without a gate is a
suggestion.** This is the largest single UX cluster in the roadmap and it is not covered by the
cleanup in Report 4.

#### 9.3 Accessibility: what is there and what is not

**[Verified by code reading]**

**Present and good:**

- `role="group"` + `aria-label="Screens"` on the surface switch; `aria-current="page"` on the
  active surface; an `aria-label` that carries the badge, the detail and the shortcut.
- `hooks/useFocusTrap.ts` and `hooks/useEscapeClose.ts` exist as first-class hooks — focus
  management is a deliberate concern, not an afterthought.
- `components/shared/ErrorBoundary.tsx` exists, and the crash breadcrumb is persisted.
- `role="status"` on the typing indicator (`components/chat/GroupChatView.tsx:384`).
- `aria-label` on the chart-related controls.

**Absent or partial — and these are the roadmap's own findings, re-verified at the pin:**

| gap | evidence | roadmap id |
|---|---|---|
| **No `EmptyState` offers a next action** | 17 `EmptyState` call sites, **0** pass `action=` | R-042 |
| **Focus restore after a modal closes is missing** | — | R-026 |
| **The chart has no `role="img"`, no `aria-label`, no hidden summary** | deferred | R-028 |
| **Native `<select>` survives in 22 places across 12 files** instead of `SelectMenu` | — | R-039 |
| **~30 controls carry shortcut hints on a raw `title=`** instead of the `Tip` component (which is used in 3 files) | — | R-038 |
| **Modal keyboard behaviour is untested** | the `render-probe` Tab-focuses editable fields and reads back the computed focus indicator, but the unit suite cannot see a stylesheet | R-018 (shipped), the *restore* half is R-026 |

**[Unverified — needs `npm run render-probe`]** the actual computed focus indicator. The
`render-probe` is described in `AGENTS.md` as the only gate that can see `index.css`, because jsdom
mounts markup without resolving a stylesheet. That gate was **not run** in this audit.

#### 9.4 Copy that promises what the code no longer does

**[Verified by code reading]** — see Report 4 §4 for the full list. The most user-visible:

- `constants/prompts/lensRolePrompts.ts:20,38,57,111,115,116` still tells the Lens seats to
  *"Consume Macro and Technical"* and describes a **three-analyst desk**. The three-analyst desk is
  gone; the Lens feature is not. These prompts are **live at the pin** and are orphaned the moment
  the concurrent change lands.
- `services/agents/seatPersonas.ts` — the general analyst is told to *"use your desk tools … and
  web search before reasoning"*, but the bot surface **has no tools at all** (P4 in §3.2 is
  deliberately tool-less, `useAnalysisPipeline.ts:1317-1320`). **The seat is told to use tools it
  does not have.**
- `AGENTS.md`'s project tree lists `services/research/` — which does not exist.
- `constants/version.ts`'s comment says the fallback literal is "kept synced with package.json" —
  it is five minor versions behind (F-19).

#### 9.5 Mobile

`android/` is the Capacitor host; the renderer is the same code. `capacitor.config.ts` sets
`https` and cleartext off, and the app uses the SQLite and Filesystem plugins natively. There is
**no separate mobile layout** — the phone gets the desktop layout in a phone-sized viewport.
`electron/main.cjs:953-954` sets `minWidth: 800, minHeight: 600` for the desktop window, so the
desktop app cannot be resized into the degraded state the comment describes — but that constraint
does not exist on Android.

---

### A10. Quality gates

#### 10.1 What the gates are, and what they actually enforce

| gate | command | what it enforces |
|---|---|---|
| type check | `npm run typecheck` | `tsc --noEmit` over `**/*.ts` and `**/*.tsx` |
| type check (scripts) | `npm run typecheck:scripts` | `tsc -p tsconfig.scripts.json` — **`scripts/**/*.ts` only, which is ONE file** (`scripts/test-candle-history.ts`) |
| type check (Electron) | `npm run typecheck:electron` | `node --check` on `electron/{main,preload,sseParser}.cjs` |
| flow-doc anchors | `npm run check-flow-doc-anchors` | the doc line-number gate, 58 KB of CJS |
| tests | `npm run test` | vitest, 479 files |
| tests + coverage | `npm run test:coverage` | the same, with the four ratchet floors |
| lint | `npm run lint` | `eslint . --max-warnings 889` |
| e2e smoke | `npm run e2e` | Playwright, 1 spec |
| build | `npm run build` | `tsc --noEmit && vite build` |
| boot probe | `npm run boot-probe` | the production bundle boots, zero pageerror |
| render probe | `npm run render-probe` | **rendered row counts, inert controls, zero pageerrors** |
| skill-approval probe | `npm run skill-approval-probe` | **real clicks, notebook bytes after each** |
| installer smoke | `npm run installer-smoke` | the packaged exe, release-only |
| release signature | `node scripts/verify-release-signature.cjs` | release-only, **not exposed as an npm script** |

CI (`.github/workflows/ci.yml`) runs: typecheck → typecheck:scripts → check-flow-doc-anchors →
typecheck:electron → test:coverage → lint → e2e → build → boot-probe → render-probe →
skill-approval-probe, plus a **non-blocking** `teardown-race-hunt` diagnostic job.

`guards.yml` runs the deterministic gates CI does not: `node --check` on every `scripts/*.cjs` and
`electron/*.cjs`, a separate narrow lint config for the probe scripts, a shell-declaration check
for the workflows, and the **entry-chunk size ratchet**.

`release.yml` runs the same chain **minus `check-flow-doc-anchors` and `skill-approval-probe`**,
plus `installer-smoke`, the signature check, the update-manifest check, and the publishing.

**[Verified live]** the ci-vs-release set difference is exactly
`{installer-smoke}` in release only and `{check-flow-doc-anchors, skill-approval-probe, test, typecheck}`
in ci only. **`AGENTS.md`'s claim is accurate.**

#### 10.2 The measured state of the gates

| measurement | value | how |
|---|---|---|
| **lint warnings** | **682** (0 errors) | `npm run lint:loose` in a throwaway copy |
| **the lint ratchet** | `--max-warnings 889` | `package.json` |
| **the ratchet's slack** | **207 warnings** | 889 − 682 |
| **eslint suppressions in source** | **3**, all `eslint-disable-next-line` | a repo-wide grep of every non-test `.ts`/`.tsx` |
| **vitest** | **479 files, 0 failed; 4,741 tests: 4,730 passed, 11 skipped** | `npm run test` in a throwaway copy (456 s) |
| **the 2 file failures in a copy without `.git`** | **artefacts** — `tests/noSparkles.test.ts` (3 tests) and `tests/sharedPolicyEsmExports.test.ts` (4 tests) shell out to `git ls-files`, which fails outside a git repository; `noSparkles` dies at import and contributes 0, `sharedPolicyEsmExports` contributes 1 failure. **Measured directly:** in a `git init`-ed copy of the pin, `noSparkles` collects **3** tests and `sharedPolicyEsmExports` **4**, all passing | the error text is `fatal: not a git repository` |
| **the 11 skips** | all in `tests/lensWordCount.measure.test.ts`, which is gated behind an env flag by design (`tests/lensWordCount.measure.test.ts:7-8`) | read |
| **the skip/only markers in the suite** | **8** | a repo-wide grep for `.skip(`, `it.only(`, `describe.only(`, `xit(` |
| **`AGENTS.md`'s "4741 tests in 479 files"** | **stale by 3** — the measured figure is **4,738** | see above |
| **the coverage floors** | lines 36 / statements 28 / functions 36 / branches 30 | `vitest.config.ts:81-86` |

#### 10.3 The two ratchets that no longer bind

This is the most important quality-gate finding, and it is the same shape twice.

**The lint ratchet.** `eslint.config.js:111-133` documents the history honestly: *"the cap sat at
1020 while the tree stood at 949, so 71 warnings could be added and CI would still pass. That is
why `tests/hookDestructureHygiene.test.ts` had to exist — the repo was hand-rolling a
dead-binding guard because the installed AST rule that already does the job was gated by a cap
with slack in it. The guard was removed when the cap was corrected."* It was corrected to 889.

**The tree now stands at 682.** So the cap has **207 warnings of slack** — a *new* warning cannot
fail CI, exactly as before. The corrective cycle has to be repeated. The file's own instruction —
*"Re-measure on a clean checkout after touching this file, and LOWER the number when you pay
warnings down; never raise it to go green"* — is the procedure, and it has not been run since.

**The bundle-size ratchet.** `guards.yml` fails the build if the entry chunk exceeds 2,600 kB,
with the comment that the last measured entry chunk was ~1,956 kB. The measured chunk is
**1,352.6 kB** — 31 % below the calibration point and 48 % below the ceiling. The ratchet can no
longer catch the 363 KB-eager-import regression it was written for.

**The pattern:** two numeric ceilings, both set from a measurement, both left behind by the
measurements, neither auto-lowering. A ratchet that only goes down by hand is a ratchet that
eventually stops binding. **The fix is mechanical: re-measure, lower the number, and add a CI step
that fails when the measured value is *below* the recorded ceiling by more than a threshold** —
i.e. a ratchet that ratchets itself.

#### 10.4 TypeScript strictness

`tsconfig.json`:

| option | value | note |
|---|---|---|
| `strict` | **true** | |
| `noImplicitAny` | true | implied |
| `strictNullChecks` | true | implied |
| `noUnusedLocals` | **false** | **this is why dead imports are invisible to `tsc`** |
| `noUnusedParameters` | **false** | |
| `noUncheckedIndexedAccess` | not set | off |
| `exactOptionalPropertyTypes` | not set | off |
| `noImplicitReturns` | not set | off |
| `noFallthroughCasesInSwitch` | not set | off |
| `skipLibCheck` | true | standard |
| `allowJs` | true | this is how `tests/sseParser.test.ts` reaches `electron/sseParser.cjs` |
| `include` | `**/*.ts`, `**/*.tsx` | **does not match `.cjs`** — the main process and preload are outside `tsc` |

**`noUnusedLocals: false` is the single most consequential line in the file for this audit.** The
dead import at `hooks/useAnalysisPipeline.ts:14` (`defaultToolsForRole`) survives CI because of it,
and so does the import-but-never-called `buildHybridEnvelope` at `:66`. Turning it on is a
one-line change with a predictable error list; that error list is, in effect, the dead-code
manifest this report had to build by hand.

**The `electron/` gap is real and is documented.** `AGENTS.md` says it plainly: *"`npm run typecheck`
does not read the main process or preload — a syntax break in `electron/main.cjs` passes tsc, passes
vitest, and only fails when a user launches the packaged app."* The compensating gate
(`npm run typecheck:electron`, wired into CI and the release gate) is `node --check`, which is
**syntax only** — it cannot catch a typo in an IPC channel name, a missing handler, or a wrong
argument shape. The repo compensates further with `tests/electronIpcContract.test.ts` and
`tests/desktopUsageBridge.test.ts` (cited in `guards.yml`'s header).

#### 10.5 What the tests cover, and what they cannot

**479 test files, 4,738 tests, 79,154 lines of test code against 134,247 lines of source.** That
is a genuinely thorough suite, and the depth is real: the gate, the outcome engine, the schema
coercion, the notebook's memory budget and write-failure path, the backup/import round trip, the
prompt-wiring census, the export/localStorage allow-list, the CI/release script-set difference,
and the workflow-shell check all have dedicated suites.

**The structural limits, which the repository itself documents and which this audit confirms:**

1. **jsdom cannot see a transcript.** A defect that only shows when a *list* of messages renders
   passes the whole suite green. `AGENTS.md` names two panels that shipped unmounted for exactly
   this reason. `npm run render-probe` is the only gate that counts rendered rows.
2. **jsdom cannot see a stylesheet.** The computed focus indicator, the theme tokens and the
   contrast are invisible to the unit suite. `render-probe` is the only gate that can read them.
3. **A source-shape gate is not a reachability gate.** `tests/promptsAreWired.test.ts` proves every
   registry id has a `getPrompt()` call site. It does **not** prove the prompt is ever *sent* — and
   F-10 and F-01 are exactly that gap: prompts that are wired to a call site which is itself only
   reachable from the skill-eval harness, and context that is assembled and dropped.
4. **The dead-code class is invisible.** `noUnusedLocals: false` plus a warn-only lint rule under a
   slack cap means an unused import, an unused export and an orphaned module are all silent.

#### 10.6 Critical paths with no test

| path | status |
|---|---|
| `electron/main.cjs` (1,362 lines) | **no type checking**; `node --check` only. Partial coverage via `tests/electronIpcContract.test.ts` and `tests/desktopUsageBridge.test.ts` |
| `electron/preload.cjs` (52 lines) | the bridge is contract-tested; the 15 methods are not individually tested |
| `scripts/*.cjs` (~6,200 lines) | **no type checking**; `node --check` + a narrow lint config in `guards.yml`. Only `tests/workflowShells.test.ts` and `tests/releaseIsCiOnly.test.ts` reach them |
| `services/infrastructure/Preferences.ts` | `tests/serializedPrefs.test.ts` exists; the native/web split is not covered |
| backup → export → import round trip | `tests/infrastructure/backupImportRoundTrip.test.tsx` and `tests/exportService.test.ts` exist ✅ |
| the migration layer | `SqliteService.runMigrations` is not directly tested for the "version recorded only on full success" behaviour |
| the notebook write-failure path | `tests/memoryNotebookWriteFailure.test.ts` exists ✅ |
| **"the Agents roster is NOT seeded"** (the behaviour `395f73db` introduced) | **no test** — `tests/teamRoster.test.ts` was deleted in the in-flight tree and nothing replaced it |
| the surface that the trader actually uses | the chat surface's prompt assembly (`chatSurfaceTurn.ts:105-139`) has no test that the *blocks* are present in the sent system prompt |

---

---

### A11. Supplement — the security, reliability and performance detail

A second pass (a separate read-only thread) went deeper into `electron/`, the retry layer, the
notebook's write path and the render path. Everything below is additional to §6–§10, not a
restatement. **All citations are at the pin.**

#### 11.1 Security — the CSP permits an origin the code deliberately does not use

**[Verified by code reading]** `index.html:21-22` is the **only** CSP (there is no header, and the
`app://` handler cannot add one — it returns `net.fetch(file://)` verbatim). The policy allows
`https://s3.tradingview.com` in `script-src` and `https://s3.tradingview.com`,
`https://www.tradingview.com`, `https://tradingview.com` in `frame-src` and `img-src`.

**But the code does not use the widget.** `components/trade/TradingChart.tsx:4` says *"Deliberately
NOT the embed widget: an iframe from s.tradingview.com is…"*, and `components/market/LiveMarket.tsx:6`
says it runs its **own** WS/REST transport. Meanwhile `index.html:14-15` says *"plus the TradingView
widget loader (Live Market / Trade chart)"* and `:19` says *"frame-src: TradingView's chart iframe"* —
**the comment claims the opposite of the code.**

**⇒ Removing `s3.tradingview.com` / `www.tradingview.com` / `tradingview.com` from `script-src`,
`frame-src` and `img-src` is a free, zero-functional-cost fix** that closes the only remote-script
hole *and* makes the CSP and `PRIVACY.md` truthful. It is the single cheapest security improvement
in this report. See Report 2 §E-21.

#### 11.2 Security — the IPC surface has no sender-frame validation

**[Verified by code reading]** all 11 IPC channels were enumerated with their validation status:

| channel | handler | sender frame validated? | args validated? |
|---|---|---|---|
| `update:check` | `main.cjs:1149` | **no** | n/a |
| `update:download` | `:1161` | **no** | n/a |
| `update:install` | `:1173` | **no** | guarded by `status === 'downloaded'` |
| `update:get-status` | `:1217` | **no** | n/a |
| `app:get-version` | `:1219` | **no** | n/a |
| `provider:discover` | `:1221` | **no** | ✅ URL policy |
| `provider:chat` | `:1240` | **no** | ✅ URL policy, messages coerced, model non-empty, unknown format throws |
| `provider:cancel` | `:1263` | **no** | ✅ `typeof requestId === 'string'` |
| `crypto:encrypt` | `:1279` | **no** | ✅ string + `isEncryptionAvailable()` |
| `crypto:decrypt` | `:1289` | **no** | ✅ `enc:v1:` prefix |
| `update:quit-now` (`on`) | `:1213` | **no** | guarded |

**⇒ not one handler validates `event.senderFrame`.** Practical exposure today is low (one window,
a local origin, `will-navigate` blocks off-origin navigation), but a one-line
`event.senderFrame !== mainWindow.webContents.mainFrame` guard per handler closes it — **and it
matters precisely because §11.1 leaves a remote iframe origin permitted.**

**Two things that are right and should not be broken:**

- **There is no filesystem IPC at all, and no `path.join` with user input anywhere in `main.cjs`.**
  Every `path.join` uses a fixed name (`window-state.json`, `LEGACY_PRODUCT_NAME`,
  `.migrated-to-august-trading`, `preload.cjs`, `favicon.ico`). **A compromised renderer cannot
  read or write arbitrary files, and cannot escape `dist/` via the `app://` handler.** The
  traversal check is sound **including the Windows `%5c` bypass**: `path.relative` yields `..\..\`,
  which `startsWith('..' + path.sep)` catches → 403 (`main.cjs:929-937`).
- **The shared SSRF / redirect policy is real:** `shared/providerRequestPolicy.cjs:413-447`
  `fetchFollowingSafeRedirects`, max 3 hops, **every hop re-validated**, used identically by the
  renderer, the Vite dev proxy and `main.cjs:230`.

**Three smaller items:**

- **The provider URL policy allows the link-local range `169.254.0.0/16`**
  (`providerRequestPolicy.cjs:255,271`) — **that is the cloud-metadata range** — while
  `PRIVACY.md:84-87` says cloud-metadata hosts are refused. That is true for `toolForge` and false
  for the provider policy.
- **The preload bridge hands the renderer the decrypted key** (`decryptSecret` is a general
  decryptor; the key then travels over IPC inside `provider:chat`). Inherent to the design, but it
  means "encrypted at rest" does not protect against a renderer-side XSS — **which is why §11.1
  matters.**
- **No API key, token, password or credential is EVER logged.** A grep for
  `console.*(apiKey|secret|token|credential)` returns one hit, a false positive
  (`utils/analysisUtils.ts:1305` matches "tokens" in a truncation message). Provider error paths log
  **name / format / status only** (`main.cjs:1228-1232`, `:1247-1253`;
  `GenericProviderService.ts:1216`), and `:1205-1210` explicitly sanitises raw SDK error text
  because it "may echo the user's prompt". **✅**

#### 11.3 Reliability — two silent data-loss swallows

**[Verified by code reading]**

- **`App.tsx:2000` — `void createBackup(activeUsernameRef.current).catch(() => {})`.** A failed
  **auto-backup** (`services/infrastructure/BackupService.ts:34`, every 30 minutes, `:644-649`)
  produces **no signal at all**. The trader believes they have a backup cadence and learns the
  truth only when they need it. **One-line fix.**
- **`hooks/useTradeJournalActions.ts:93, 135, 379` — `void syncPatternMemory(null, …).catch(() => {})`.**
  The pattern-memory synthesis is silently lost, at three call sites.

**These are the same class as the notebook's write-failure path — which the repo handles *well***
(`MemoryFilesService.persist` records the failure, rethrows, and clears on the next success; the
failure is owned by `memoryHealth` and read by `App.tsx:28`). **The pattern is right; two
call-sites outside it do not follow it.**

#### 11.4 Reliability — the retry layer is well engineered, with two honest gaps

**[Verified by code reading]** `withRetry` (`utils/apiErrorUtils.ts:195-236`):

- **max 3 attempts at every call site** (`GenericProviderService.ts:1390`, `:1419+`, `:1931`); the
  default of 4 (`:198`) is never used.
- retryable = `rate_limit` / `network` / `server` only; **`timeout` is deliberately NOT retryable**
  (`:116-120`) — this replaced a 3 × 300 s ≈ **15-minute** desktop hang.
- backoff `min(2000 · 2^n, 30000)` with **equal jitter**; the `Retry-After` branch is capped at a
  30 s base plus up to +50 % jitter (≤45 s). **Jitter is always on** — parallel seats must not wake
  in lockstep.
- the SDK's own `maxRetries: 0` (`GenericProviderService.ts:515`) prevents a 3 × 3 multiplication.
- the degrade ladder advances only on 400/422, so a healthy gateway issues **exactly one** request.
- **worst case per logical call ≈ 450 s** (3 × 120 s + 2 × 45 s).
- **mid-stream failures are NOT retried** (only the stream *open* is) — replaying a partially-painted
  answer would duplicate transcript text. **✅ correct.**

**Two gaps:** (a) **a retry is not idempotent** — a network failure *after* the provider accepted
the request re-bills, and there is no idempotency key. (But a retry **cannot** duplicate a journal
write: the write is downstream of the resolved promise.) (b) `parseAPIError` classifies any message
containing "exceeded" as a quota problem (`apiErrorUtils.ts:44`) → non-retryable **and** a misleading
*"quota exceeded, switch provider"* message for, say, a length error.

#### 11.5 Reliability — six `fetch` calls with no client-side timeout

**[Verified by code reading]** the other 12 product fetches all carry 120 s / 300 s / 15 s caps.
These six do not: `services/providers/GenericProviderService.ts:1306` and `:1474` (the dev proxy),
`services/infrastructure/ProviderConfigService.ts:488` (the dev proxy),
`services/ui/PriceAlertService.ts:424` (live Binance),
`services/trade/markPricePoll.ts:19` (live), and
`services/analysis/DeskToolsService.ts:1667` (the DuckDuckGo HTML fallback).

#### 11.6 Reliability — `getPreferenceObject` conflates "missing" with "corrupt"

**[Verified by code reading]** `services/infrastructure/PreferencesService.ts:109-117` returns
`null` for both a missing key and an unparseable one. **Any caller that treats `null` as "empty"
and writes a default destroys a corrupt-but-recoverable blob.** Only
`services/learning/MemoryFilesService.ts:145-176` defends (a raw read, and *"leave the stored
blob UNTOUCHED"*). **Every other caller has no guard.**

#### 11.7 Reliability — the notebook's pressure classifier has two dead branches

**[Verified by code reading]** `services/learning/MemoryFilesService.ts:443-448` defines three
kinds for `notebookPressureAllows` — `'newFiles'`, `'appends'`, `'all'` — but **the only call site
(`:690`) passes `'newFiles'`.** So `'appends'` and `'all'` are **dead branches**: **at the hard
cap the notebook still accepts appends and updates**, and `utils/memoryBudget.ts:40-43` ("appends
still land") contradicts the module's own doc at `:439-442` (*"`all` refuses every model write"*).

**⇒ the hard cap does not do what the docs say it does.** This is the repo's own *"reader without
a writer"* pattern, now in the docs.

#### 11.8 Reliability — the notebook is one replace-in-place blob with no recovery affordance

**[Verified by code reading]** `services/learning/MemoryFilesService.ts:250`. A corrupt blob serves
an **empty notebook** with only a `console.warn` (`:173`). There is no version, no checksum and no
recovery affordance — **a `.corrupt.<ts>` sidecar or a backup/restore path would convert an
unrecoverable-looking loss into a recoverable one.**

Related: **only the notebook has a byte budget.** The raw `localStorage` stores
(`profile_memory_v1_*`, `learning_rules_v2_*`, `agents_*_v1_*`, the calibration/performance/confluence
stats) have **no size cap** and **share the same origin quota** — one of them can starve the
notebook's 2 MiB budget.

**✅ What is right:** **SQLite writes ARE atomic** (`SqliteService.ts:557` `BEGIN`, `:668` commit,
`:676-682` `ROLLBACK` guarded by `transactionOpen`; `SqliteServiceHelpers.ts:34-39` funnels every
transactional writer through one chain so one flow's `ROLLBACK` cannot undo another's uncommitted
writes). IndexedDB uses `db.transaction(...)` throughout. The legacy `userData` rename is careful
(`main.cjs:49-77`: packaged-only, never clobbers, `renameSync`→`cpSync` fallback, a one-time stamp,
a boot-safe catch).

#### 11.9 Performance — the root re-renders once per animation frame during a stream

**[Verified by code reading]** `App.tsx` uses `chatStore` through `useSyncExternalStore`
(`App.tsx:2`), and `hooks/analysisPipeline/streamThrottlers.ts:72` throttles the deltas to one
update **per frame** — but a **2,672-line root re-rendering at 60 Hz**. The leaves are memo'd
(`AgentsView:1550`, `Journal:383`, `TradeLogContent:772`, `StrategyStudio:782`,
`WinRateDashboard:603`) — but the **root** is in the hot path. A memo'd transcript subscribing to
the store directly would take the root out of it.

**Two smaller render costs:** the root holds **100+ state values** and all 75 memos re-check on
every change; `approvalItems` (`App.tsx:1840`) is **O(trades) per trade change**; `botStats`
(`:1861`) is a synchronous computation inside a `useMemo`.

#### 11.10 Performance — up to 400 live intervals in one conversation

**[Verified by code reading]** `components/shared/AnalyzedRow.tsx:58` and
`components/shared/ReasoningRow.tsx:90` each run their **own** `setInterval` **per row** — so a
200-message conversation holds **up to 400 live intervals**, each re-rendering its own row. **They
need one shared ticker.**

**And the 1-second clock** (`components/trade/TradeView.tsx:666`) re-renders the whole trade
surface every second (Report 2 §E-16).

**And `backgroundThrottling: false`** (`electron/main.cjs:970`, deliberate and correct for price
feeds) also keeps every **UI** clock running at full rate in a hidden window. **The price feeds
need to run in the background; the UI clocks do not.**

#### 11.11 Performance — every notebook write serialises the blob twice

**[Verified by code reading]** `services/learning/MemoryFilesService.ts:250` (`JSON.stringify` for
the write) **and** `:405` (`bytesOf(JSON.stringify(memoryCache))` for the size), and the index is
rebuilt at `:243` → `:567-599`. **At the 1.5 MiB trigger tier, a 5-file post-mortem burst means 10
full serialisations of a multi-megabyte object on the main thread.** The measurement can reuse the
string the write just built.

**✅ What is right:** the notebook is read **once** into a module-global cache
(`MemoryFilesService.ts:151-161`); later reads are in-memory (`:194`). **No per-keystroke and no
per-render network calls anywhere.** Steady state is ≈ 20–30 requests/minute of public market data.

#### 11.12 Quality gates — three more measured facts

**[Verified live]**

- **`electron/main.cjs` (1,362 lines) has ZERO behavioural test coverage.** The largest untested
  surface in the app. `tests/electronIpcContract.test.ts` is **pure string analysis** (`:26-37`
  `readFileSync` + regex); `tests/providerRequestPolicy.test.ts:263-274` asserts that `main.cjs`
  *contains the string* `require(...)`; `tests/reasoningSideChannelParity.test.ts:17` and
  `tests/desktopUsageBridge.test.ts:19` read `main.cjs` **as text**.
  `tests/sseParser.test.ts` is the **only** file that executes electron code. **The `app://`
  traversal check, the navigation rules, the permission-denial handler, the `safeStorage`
  round-trip, the `provider:chat` body construction and the degrade chain are all untested at
  runtime** — the file is outside `tsc` (`tsconfig.json:31`) and outside coverage
  (`vitest.config.ts:91`), and the only gate is `node --check`, which **parses and proves nothing**.
- **There are ZERO snapshot tests** — no `.snap` file, no `toMatchSnapshot`, no
  `toMatchInlineSnapshot` anywhere. **No brittle snapshots. ✅**
- **The eslint suppression profile is very clean:** 23 `eslint-disable` directives in total, of
  which **only 3 are in product code** (2 `no-control-regex` in `utils/sanitizers.ts`, 1
  `no-require-imports` in `hooks/useAnalysisPipeline.ts`); by rule: 13 `no-explicit-any`, 4
  `no-console`, 3 `no-require-imports`, 2 `no-control-regex`, 1 `no-useless-assignment`.

**Two corrections to claims this audit had itself made:**

- **`eslint.config.js:124`'s "28 unused LOCAL declarations remain there [in `App.tsx`]" is stale —
  it is 13**, across 11 statements (plus 5 unused imports: `Conversation` `:8`, `ChevronDownIcon`
  `:47`, `CloseIcon` `:47`, `ModelPicker` `:82`, `NavRail` `:122`). The claim's *reasoning* holds —
  each is a real `useMemo`/`useCallback`/`useState`/destructured binding — but **the number is wrong
  by 15.** **`App.tsx` is now `any`-free**: all 449 `no-explicit-any` warnings are elsewhere.
- **The 682 warnings break down as:** 449 `no-explicit-any` (65.8 %), 225 `no-unused-vars` (33.0 %),
  and **8 "unused eslint-disable directive"** warnings (4 `no-console`, 3 `no-explicit-any`, 1
  `no-useless-assignment`). **⇒ deleting those 8 dead directives gives 674, and the cap can be set
  to 674.** The 449 `any` are the real backlog, but **re-tightening the ratchet needs no code
  change at all.**

**Three more `tsconfig` facts:** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are
**absent** — `noUncheckedIndexedAccess` is the highest-value missing option, because every
`arr[0]` silently lies. `paths` (`:18-22`) is declared but **never used** — dead config.
`forceConsistentCasingInFileNames` is off, and
`services/infrastructure/ProviderConfigService.ts:10` imports
`'../../shared/providerRequestPolicy.cjs'`, which resolves only on case-insensitive filesystems —
**a latent portability break** on a Windows-only target.

#### 11.13 Quality gates — ~17 test files exercise code the app never loads

**[Verified by code reading]** a module-level import graph over 529 source files and 480 test
files found **39 orphan modules** (after fixing a first-pass false positive that missed
`React.lazy(() => import(...))`).

- **7 files import only orphan modules → 5 test genuinely dead app code:**
  `tests/probabilityEngine.test.ts` and `tests/lazySurfaceSkeletons.test.ts` →
  `services/analysis/ProbabilityEngineService.ts`; `tests/ticketMathTiers.test.ts` →
  `utils/ticketSize.ts`; `tests/seriesPalette.test.ts` → `utils/seriesPalette.ts`;
  `tests/incrementalMarkdown.test.ts` → `utils/incrementalMarkdown.ts`. (The other two,
  `verifyReleaseSignature` and `workflowShells`, target script entry points — legitimate orphans.)
- **12 more import at least one orphan:** `accuracyValidation` → `TradeValidationGate`;
  `backtestingKlineLadder` / `backtestingOutcomes` / `validateTradeOutcome` → `BacktestingService`;
  `convictionDrift` → `services/analysis/convictionDrift.ts`; `preRead` → `utils/preRead.ts`;
  `runStatus` / `stoppedStepReason` → `components/analysis/AnalysisProgress.tsx`; `analysisUtils` →
  `constants/schemas.ts`; `auditFixes` / `financialMath` → `utils/ticketSize.ts`; `teamRoster` →
  `utils/teamRoster.ts`.
- **Orphans with no test at all:** `services/learning/MemoryConsolidationService.ts`,
  `utils/messageDisplayText.ts`, `components/dashboards/learning/AvoidSetupsSection.tsx`,
  `lib/utils.ts`, `plugins/GallerySaver.ts`.

**⇒ And the dead code is documented as if it were live.** `AGENTS.md` describes
`services/validation/` (the TradeValidationGate) and cites `BacktestingService` as the realized-R:R
source; `utils/riskReward.ts:7,16,96` references it three times; `utils/analysisUtils.ts:409` lists
`ticketSize`; `components/journal/ThinkingRecordCard.tsx:16` points at `utils/seriesPalette`;
`services/analysis/EntryTimingService.ts:588` and
`services/backtesting/StopLossOptimizerService.ts:332` both say *"Generate a compact warning for
TradeValidationGate"*. **This is the repo's own *"reader without a writer"* pattern, now in the
documentation.** See Report 4 §4.1.

#### 11.14 The security/reliability/performance findings in one list

| ID | sev | finding |
|---|---|---|
| **F-21** | **High** | The CSP permits `script-src`/`frame-src`/`img-src` origins the code deliberately does not use, **while its own comment claims it does** — a free fix that closes the only remote-script hole |
| **F-22** | **High** | No IPC handler validates the sender frame |
| **F-23** | **High** | The auto-backup failure and the pattern-memory sync failure are both swallowed silently (`App.tsx:2000`; `hooks/useTradeJournalActions.ts:93,135,379`) |
| **F-24** | **High** | The notebook is one replace-in-place blob with no version, checksum or recovery affordance |
| **F-25** | **Med-High** | `getPreferenceObject` conflates "missing" with "corrupt" — a caller that treats `null` as "empty" destroys a recoverable blob |
| **F-26** | **Med** | `notebookPressureAllows('appends')` and `('all')` are **dead branches** — the hard cap still accepts appends, contradicting `utils/memoryBudget.ts`'s own doc |
| **F-27** | **Med** | The root re-renders at 60 Hz during a stream; up to 400 per-row `setInterval`s; a 1-second whole-surface clock; `backgroundThrottling: false` keeps UI clocks alive in a hidden window |
| **F-28** | **Med** | Every notebook write serialises the whole blob **twice** and rebuilds the index |
| **F-29** | **Med** | Six `fetch` calls with no client-side timeout; a retry is not idempotent; "exceeded" is misclassified as a quota error |
| **F-30** | **Med** | The provider URL policy allows the `169.254.0.0/16` cloud-metadata range |
| **F-31** | **Med** | `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are off; `paths` is dead config; `forceConsistentCasingInFileNames` off is a latent portability break |
| **F-32** | **Med** | `electron/main.cjs` (1,362 lines) has **zero** behavioural coverage |
| **F-33** | **Low** | `setPermissionCheckHandler` is not set (sync permission checks stay permissive); the dev proxy is unauthenticated and CORS-reachable |
| **F-34** | **Low** | The raw provider error body's first 200 chars are embedded in a persisted error message (`GenericProviderService.ts:1335`, `:1503`) |
| **F-35** | **Low** | `warmProviderConnection` HEADs the provider origin from the renderer — revealing which provider is in use |
| **F-36** | **Info** | 1,465 kB of KaTeX fonts ship with no preload hint; the 1.3 MB pdfjs worker has no progress indication |
| **F-37** | **Info** | `migrateLocalStorageToPreferences`'s second pass has no allow-list (unlike `ExportService`'s restore allow-list) and copies *every* localStorage key |
| **F-38** | **Info** | `window-state.json` is written non-atomically (harmless) |
| **F-39** | **Info** | `playwright.config.ts` sets `reuseExistingServer: true` — a stale dev server on :3000 would be silently reused (a possible false green) |
| **F-40** | **✅ positive** | **No filesystem IPC, no `path.join` with user input, a sound `app://` traversal check (including the Windows `%5c` bypass), a real shared SSRF/redirect policy with per-hop re-validation, no credential ever logged, atomic SQLite writes, a read-once notebook cache, zero snapshot tests, and a 3-of-23 eslint suppression profile.** |

---

### A12. Two feature deep dives

**Added 2026-10-20** at the owner's request: (a) *"the model should not cancel its output and keep
working even though I switch tabs or go to the skills or chat"*, and (b) *"how does Hermes format
its skills, and can August's skills work that way"*.

Both were read against the current source. **The first one turned out to be mostly built already —
and the part that is missing is a contradiction inside one file. The second one turned out to be
mostly built already too: August's skill format IS a deliberate port of the Agent Skills spec,
and the code says so in a comment.**

#### 12.1 Deep dive — "keep generating until it's done"

##### 12.1.1 What already works, and was deliberate

| mechanism | evidence |
|---|---|
| the dock's session state is **hoisted out of React** "so an in-flight answer survives a surface switch" | `services/trade/chatStore.ts:1-8` — *"The trade surface is mounted only while its tab is active, so a plain `useState` panel would unmount (and its unmount-cleanup abort) the moment the user glanced at the Journal — the stream died mid-sentence."* |
| the store owns **per-session AbortControllers** "so switching tabs never aborts another session's run — only an explicit Stop or deleting a session does" | `services/trade/chatStore.ts:10-11`; the map at `:84`; `beginRun` `:479`; `endRunOwned` `:493` |
| the dock panel has **no unmount-abort, on purpose** | `components/trade/TradeChatPanel.tsx:696-697` — *"NOTE: no unmount-abort on purpose. Switching to another surface tab unmounts this panel; the run must keep streaming into the store so…"* |
| the surfaces really do unmount on switch (so this had to be solved) | `App.tsx:2312` `{surface === 'trade' && (…)}`, `:2357` `{surface === 'journal' && (…)}`, `:2379` `{surface === 'learn' && (…)}` |
| every run-owning hook is **App-level**, so a surface switch cannot unmount it | `useAnalysisPipeline` (App.tsx), `useBotMailbox` (`App.tsx:94`, `:700`, `:1086`), `useAgentGroups` (`App.tsx:1065`) |
| the bot and room runs have **no unmount-abort at all** — only a user-facing cancel | `hooks/useAgentGroups.ts:117-124` `cancelRun`; `hooks/useBotMailbox.ts` has no abort-on-unmount at all |
| a surface switch **binds a chat session**, it does not change the conversation | `App.tsx:375-378` `openChartAi` → `chatStore.bindConversation(activeConversationId)`; `chatStore.ts:362-389` — it binds a *session* to a conversation and returns a session id. The app's `activeConversationId` is a separate value owned by `useConversations`. |

**⇒ Switching tabs, switching to the Skills surface, and switching to the Chat do NOT cancel a
run. The dock keeps streaming into the store while the panel is gone and the text resumes on
screen when you come back.**

##### 12.1.2 What does cancel — and the contradiction that makes one of them a defect

Three paths abort a run:

| # | path | evidence |
|---|---|---|
| 1 | **switching conversation** | `hooks/useAnalysisPipeline.ts:351-367` — an effect on `activeConversationId`: `analysisAbortController.current?.abort(); analysisAbortController.current = null; analysisConversationIdRef.current = null; analysisInFlightRef.current = false; steeringQueueRef.current = []; setLoadingMessage(null); setIsAnalysisInProgress(false); setAnalysisSteps([]);` |
| 2 | **new / load / delete a conversation** | `hooks/useConversationHousekeeping.ts:56`, `:67`, `:105`, `:116` — each calls `handleCancelAnalysis()` |
| 3 | **switching profile (user)** | `hooks/useUserProfileLoader.ts:207` (`resetAppState` → `handleCancelAnalysis()`), `:272` |

**Path 1 is a defect, not a policy — because the same file already contains the machinery for the
behaviour the user is asking for, ~340 lines away:**

> `hooks/useAnalysisPipeline.ts:691-693` — *"Bind every async message write to the conversation
> that started the request. **This remains correct even if the user switches conversations before a
> provider response or stream chunk arrives.**"*

That is `updateRequestMessages` (`:695-703`) writing into `requestConversationId` (`:694`). **The
run was designed to survive a conversation switch and land its answer in the conversation it was
typed in.** The effect at `:351-367` kills the run the instant `activeConversationId` changes —
before that machinery can ever be used. The comment at `:359-361` even assumes the abort: *"the
queue is memory, not an outbox. Leaving them would drain into the WRONG conversation **when the
abort settles**."*

##### 12.1.3 The two chat paths do not behave the same

| path | who runs it | run ownership | survives a conversation switch? |
|---|---|---|---|
| **the dock** (P2) | `components/trade/TradeChatPanel.tsx:57,58,85` → `services/trade/chatTurnRunner.ts` | **per session** — `chatStore.beginRun(sid, controller)` at `chatTurnRunner.ts:850`, `:1153`, `:1196`, released by `chatStore.endRunOwned(sid, controller)` (`:493`), which only clears if the controller is still the owner | **YES** — and another session can run concurrently |
| **the Chat surface** (P1) | `services/trade/chatSurfaceTurn.ts:230` via `hooks/useAnalysisPipeline.ts:1276` | **one global** `analysisAbortController` ref (`:327`) — one run at a time, globally | **NO** — any conversation change kills it |

`chatStore.beginRun` is called **only** from `chatTurnRunner.ts` — the Chat surface's run is not in
the store's per-session map at all.

##### 12.1.4 The proposal

**E-45 — give the Chat surface the dock's per-session ownership, and stop aborting on a
conversation switch.**

1. **Own the run per conversation.** Replace the single `analysisAbortController` ref with a
   conversation-keyed map — or simply register the Chat surface's controller with
   `chatStore.beginRun(sid, controller)` / `endRunOwned`, which already implements the
   owner-checked release (`chatStore.ts:493`).
2. **Stop aborting in the `:351-367` effect.** It should *move the UI*, not kill the run: the
   loading message, the step tracker and the in-progress flag become **per-conversation**, so
   switching conversations shows *that* conversation's state rather than clearing it. The steering
   queue becomes per-conversation too, instead of being cleared.
3. **Make the double-submit guard per-conversation** (`analysisInFlightRef` at `:358`, `:686`), so a
   run in conversation A neither blocks a send in conversation B nor is mistaken for one.
4. **Stop must abort the active conversation's run only** — `handleCancelAnalysis`
   (`:1497-1504`) currently aborts the single global controller.
5. **Deleting a conversation must abort *that* conversation's run**, not every run.
6. **Show that a run is still going.** The dock already tracks busy sessions in the store; the
   conversation rail should carry the same badge, so "it is still thinking over there" is visible
   instead of mysterious. (`components/trade/TradeChatPanel.tsx:302` — *"unmounts, but the run keeps
   streaming into the store"* — shows the pattern is understood.)
7. **Keep the profile switch cancelling** (path 3): a different trader's data must not receive the
   previous trader's answer.

**Impact:** the feature the owner asked for, on the path that was missing it. **Accuracy** (an
answer that arrives after you look at another conversation is an answer, not a cancellation) ·
**UX** · **Reliability**.
**Effort:** **M**. **Risk:** **M** — it changes *when* a run dies, and there is a test that pins
the current behaviour: `tests/useConversationHousekeeping.test.tsx:45` asserts
`handleCancelAnalysis` **is** called on a conversation load. That test must be flipped
deliberately, not incidentally.
**How to verify:** a test that starts a run in conversation A, switches to B, and asserts (i) A's
controller was **not** aborted, (ii) A's streamed text landed in A, (iii) the Stop button in B
aborts only B, and (iv) deleting A aborts A. Then `npm run render-probe` for the busy badge.
**Roadmap:** **NEW** — nothing in the corpus mentions it. The dock's half is already shipped, so
this is the second half of a design that exists.

#### 12.2 Deep dive — the skills format, against the Agent Skills convention

**The reference.** The agentskills.io / Claude Code / Hermes convention is a directory per skill:
`SKILL.md` with **YAML frontmatter** (`name` + `description` required; optional `compatibility` or
a Hermes-specific `hermes:` block), a markdown body with **When to use / Procedure / Verification**,
and optional `scripts/`, `references/`, `assets/` sub-resources, loaded in **three levels of
progressive disclosure** — the index always, the body on trigger, the sub-resources on demand.

**The finding: August's skill format is already a deliberate, documented port of that spec — and
in three respects it is stricter than the convention.**

##### 12.2.1 What August already has

| convention element | status | evidence |
|---|---|---|
| **YAML frontmatter with `name` + `description`** | ✅ **PRESENT** | `services/learning/SkillMemoryService.ts:1059-1070` — `serializeSkill` emits `name:` (derived from the title, **capped at the spec's 64 chars**, `:1063`) and `description:` (capped at 1024, `:1064-1067`), both YAML-safe via `yamlString` = `JSON.stringify` — and the comment at `:434-437` notes *"JSON strings are also valid YAML 1.2 double-quoted scalars."* |
| **the spec's problem, solved explicitly** | ✅ **PRESENT, and better** | `:411-431` — *"The Agent Skills spec's required frontmatter is exactly `name` + `description`, and it has NO lifecycle or outcome fields at all. August's SkillMeta carries ~35 of them. Keeping both in one undivided block is why a skill file cannot be shared, imported, or read as a procedure — **it is a database row wearing markdown**."* The fix: **two faces** behind `# august:skill-ledger` (`:432`) — a **PORTABLE** face above (name, description, and the keys that describe the procedure's behaviour: kind/coin/direction/family/regime/ifCondition/thenAction/predicate/timeframe/source/audience/lensScope) and a **LEDGER** face below (every outcome and lifecycle key, `:1101-1118`). |
| **a spec-only file already loads** | ✅ **PRESENT** | `:424-427` — *"The parser reads straight through the marker, so NOTHING is rewritten and no migration is needed: existing files parse exactly as before, and **a spec-only file with just the two required fields loads as an unproven candidate**."* |
| **When to use / Procedure / Verification body** | ✅ **PRESENT** | `services/learning/skillDocument.ts:56-68` — the recognised headings: `when to use`, `how i know it still holds`, `the plan` / `my plan`, `when not to use`, `required inputs` / `inputs`, `steps`, `pitfalls`, `verification`, `examples` — plus `other` (`:45`) so *"an unknown section written by a hand-edited file is never silently lost."* |
| **progressive disclosure** | ✅ **PRESENT, two of three levels** | `services/trade/tradeChatContext.ts:206-224` `buildSkillsIndexForPrompt` — the **index is always in context** (30 rows max), one line per skill: `- {slug} [{status}] — {kind} · {description} · IF … → THEN …`, and the header says *"Each line is WHEN to use it… pull its full body with **recall/get_notebook_map** when you act on it."* `skillDocument.ts:1-19` — *"A skill file is a document; the prompt can only ever carry a card"* — `parseSkillBody()` for the detail pane, `projectSkillCard()` for injection, and *"Truncation is reported, never silent: `clipped` says how much was dropped."* |
| **agent-authored skills with a human gate** | ✅ **PRESENT** | the `propose_skill` / `revise_skill` desk tools → `utils/learningQueue.ts` (`queueLearningProposal`, `applyProposalCard`, `decideRewriteCard`, `APPLYABLE_PROPOSAL_KINDS`) → `services/learning/skillApproval.ts`. **This is exactly Hermes' `skill_manage` + `pending/` approval gate.** |
| **import, with honest per-file outcomes** | ✅ **PRESENT** | `services/learning/SkillImportService.ts:45-83` — `imported` / `skipped` / `failed` **with a reason per file**; duplicates detected on the **trigger key** (`:63-70`); collisions get `-2`, `-3` (`:31-40`); a file that is not a skill is reported, never silently dropped (`:56-58`). |
| **imported headings must survive** | ✅ **PRESENT** | `SkillMemoryService.ts:458-474` `skillBody` strips the frontmatter and the redundant generated `# Title`, but *"Imported skill section headings, including a leading H1, are real instructions and must survive."* |
| **invocation control** | ✅ **PRESENT** | `audience`, `lensScope` (`:1087-1088`), `manualOnly` (`:1113`) — the code calls these *"Agent Skills frontmatter port"* (`:315`, `MemoryRetrievalService.ts:476`). |

##### 12.2.2 What is missing

| convention element | status | the gap | effort |
|---|---|---|---|
| **level 3 — `references/`, `scripts/`, `assets/`** | ❌ **ABSENT** | the body is one flat file, and `RECALL_SKILL_BODY_MAX` is **700 characters** (`skillDocument.ts:6-8`) — a long skill is *clipped*, not *extended*. The convention's answer is a `references/` doc loaded on demand; August has no equivalent, so **long procedures are lossy by design**. | **L** — a storage-shape change (the notebook is a flat list of `.md` entries, not a tree) |
| **`compatibility` / `hermes:` block** (required tools, env vars, platform limits) | ❌ **ABSENT** | August has `audience`/`lensScope` (who may see the skill) and `manualOnly`, but **nothing that says what the skill NEEDS**. A skill that assumes the `run_screener` tool or a specific env var cannot say so. | **S** — one more frontmatter key family |
| **`SKILL.md` as the filename** | ⚠️ **PARTIAL** | files are `slug.md` (`isSkillFile`, `:405-406`) — the *content* is spec-shaped, the *filename* is not, so a skill dropped into `skills/` is not auto-detected as spec-shaped | **S** |
| **category grouping** | ⚠️ **PARTIAL** | the notebook has **top-level folders** (`ensureHarnessFolders`, `MemoryFilesService.ts`) — skills / rules / doctrine / diary / distilled — but not a category *per skill* | **M** |
| **`version` field** | ❌ **ABSENT** | | **S** |
| **skill bundles** (one YAML loading several) | ❌ **ABSENT** | | **M** |
| **install from a URL / owner-repo** | ⚠️ **PARTIAL** | file import only (`readSkillFiles`, `:95-112`); no URL fetch | **S/M** |

**⇒ The honest verdict: the format question is largely already answered, and by the repo's own
comment.** What August does not have is (a) level-3 sub-resources, (b) a compatibility block,
(c) the filename, (d) per-skill categories, (e) bundles and URL install. **The gap that actually
costs the trader something is (a)**, because the 700-character cap means a good long procedure is
clipped rather than extended.

#### 12.3 Deep dive — "review all my skills and fix the format"

**This is the feature the owner asked for, and it is much smaller than it sounds — because most
skills are already in the right shape.** The job is therefore mostly a **diagnostic**, not a mass
rewrite.

##### 12.3.1 What the checker can decide with **no model call at all**

Every one of these is already implemented and can be reused as-is:

| check | the existing code that answers it |
|---|---|
| does it parse as a skill at all? | `parseSkillMarkdown(content)` (`SkillMemoryService.ts`) — the same parser `SkillImportService` uses to reject a non-skill with *"missing or invalid skill frontmatter"* |
| does it **round-trip**? | `serializeSkill(meta, title)` — **parse → serialize → compare** is the cheapest and strongest format check there is, and it needs no new code |
| is `name` present, ≤64 chars, and equal to the file's identity? | `skillFileNameFor(meta)` (`:3642`) and the `name:` write rule (`:1063`) |
| is `description` present and non-empty? | `serializeSkill` falls back to `ifCondition → thenAction → first 24 words → title` (`:1064-1067`) — a skill that only got the fallback **has no real description**, and that is worth flagging |
| is the **portable/ledger split** intact? | the marker at `:432` |
| are the body sections recognised? | `parseSkillBody` / the `HEADINGS` map (`skillDocument.ts:56-68`) — `other` (`:45`) catches a hand-written section, and says so |
| how much would be clipped at the recall cap? | `projectSkillCard` (`skillDocument.ts`) returns `clipped` + `droppedChars` (`:48-54`) — **the number is already computed** |
| does the description say **WHEN** to use it? | the convention's "pushy description" rule: the index line *is* the trigger, so a description without a trigger phrase (and no `ifCondition`) is a skill that will never fire |

##### 12.3.2 What needs a model, and only for what code cannot decide

| repair | the existing model-writing machinery |
|---|---|
| rewrite a description that does not say WHEN | `services/learning/SkillCraftService.ts` — `craftSkillFromPostMortem` (`:155`) and `refineSkillFromLosses` (`:228`) already write skills with a model |
| normalise section headings to the recognised set | the `HEADINGS` map is the target; the body is the source |
| split an over-long procedure into a card + a `references/` note | **this one is blocked on E-46 (level 3) — there is nowhere to put the extra text yet** |

##### 12.3.3 The write path — the one rule that matters

**A batch job must never write a skill file directly.** Every write goes through the **existing
human gate**: the learning queue (`utils/learningQueue.ts` — `queueLearningProposal`,
`applyProposalCard`, `decideRewriteCard`, `proposalApplyFailureMessage`), the same path
`propose_skill` and `revise_skill` already use, landing in `components/learn/ActionApprovals.tsx`.
**The review produces *proposals*; the trader applies them.** This is the same discipline the
supervisor uses, and the same one the repo already applies to agent-authored skills.

##### 12.3.4 The budget, and the precedent for it

A review of N skills is up to N model calls. Two precedents exist in the repo:
- `services/learning/SkillEvalScheduler.ts` — a **scheduled, budgeted, sample-gated** LLM pass over
  skills, with a session budget and a default runner.
- `services/learning/SkillEvalService.ts` — it runs a model over a skill, judges it, and **writes
  the verdict into the skill's frontmatter** (`evalVerdict:`, `:307`).

**⇒ The review job is a sibling of the evaluator: same scheduler, same budget, different prompt,
different write target (a proposal, not a verdict).** It should be **opt-in**, **capped per run**,
show a **token estimate before it starts**, and fail closed with no ready provider — exactly the
constraint the prior review set for the candidate log.

##### 12.3.5 Where the button goes

`components/learn/SkillsCatalog.tsx` (the catalog the trader already opens) — the button belongs in
its header. The per-skill verdicts render in `components/learn/SkillViewerPanel.tsx` (the detail
pane) next to the existing card projection. The proposals land in `components/learn/ActionApprovals.tsx`.

**Roadmap:** **NEW** — the skills *format* is already a port; the *bulk review* is not in the corpus.

---

### A12.4. What happens to a skill that does not follow the format, or is too vague

**The owner's question, answered against the source. It is the question that decides whether the
review job is a diagnostic or a mass rewrite — and the answer is: it is a diagnostic, with three
verdicts, and one of them is currently a *silent* failure.**

#### 12.4.1 Verdict 1 — a **GHOST**: in the notebook, invisible to the app

**The code.** `services/learning/SkillMemoryService.ts:1053-1057`:

```ts
export const listSkills = (): Array<{ file: MemoryFile; meta: SkillMeta }> =>
    getMemoryFiles().files.filter(isSkillFile).map(file => {
        const meta = parseSkillMarkdown(file.content);
        return meta ? { file, meta } : null;
    }).filter((row): row is { file: MemoryFile; meta: SkillMeta } => Boolean(row));
```

**A file that fails to parse is dropped — silently.** The same happens on the retrieval path
(`services/learning/MemoryRetrievalService.ts:218-219`, `if (!meta) continue;`).

**The app already has the number and throws it away.** `services/learning/memoryHealth.ts:178-181`:

```ts
const skillFiles = files.filter(isSkillFile);
const metas = skillFiles
    .map(f => parseSkillMarkdown(f.content))
    .filter((m): m is SkillMeta => Boolean(m));
```

`skillFiles` is **every** `.md` in the skills folder; `metas` is the ones that parse. So
**`skillFiles.length - metas.length` *is* the number of malformed skills** — and `skillFiles` is
never used again (the only two references are `:178` and `:179`). There is **no flag** for it among
the nine `flags.push` calls (`:297`, `:304`, `:307`, `:310`, `:313`, `:316`, `:319`, `:328`, `:334`,
`:341`).

**⇒ A ghost is:**
- **in** the notebook, the backup, the export, and the file count;
- **out** of `listSkills()`, the prompt index, the catalog, the retrieval, the health card, and the
  review;
- and — the sharp edge — **the same file would be REJECTED with a reason on import**
  (`services/learning/SkillImportService.ts:56-58`: *"Not a skill file — missing or invalid skill
  frontmatter"*).

**⇒ The app gives two opposite answers for the same file depending on how it arrived: imported →
rejected with a reason; already in the notebook → invisible.** The trader cannot tell which
skills they actually have.

#### 12.4.2 Verdict 2 — a **DORMANT** skill: it lists, it occupies a slot, and it will not fire

**The trigger gate.** `services/learning/MemoryRetrievalService.ts:232-257`:

```
const descScore = descriptionOverlap(meta, query);
const descHit = descScore >= DESCRIPTION_MATCH_MIN;
...
if (!descHit && !skillMatchesSetup(meta, setup)) continue;
```

and the code's own comment on the gate: *"the description, which is the field that says what a
skill does and **when it applies**, was never consulted… **A skill that qualifies on neither signal
stays invisible, exactly as before.**"*

**⇒ A skill with no usable trigger is alive in the index and dead in practice.**

**And it takes a slot from a good one.** `services/trade/chatSurfaceTurn.ts:109-118`:

```ts
const rows = listSkills().map(({ file, meta }) => ({ … }));
skills = rows.slice(0, SKILL_INDEX_WINDOW).map(r => r.slug);
skillsBlock = buildSkillsIndexForPrompt(rows, SKILL_INDEX_WINDOW, where);
```

`listSkills()` returns **notebook file order** — `getMemoryFiles().files.filter(isSkillFile).map(…)`.
**The 30-slot index is unranked, and unfiltered by status**: a `retired` skill and an unproven
`candidate` occupy a slot exactly like a `confirmed` one.

**And the line it renders is trigger-free.** `services/trade/tradeChatContext.ts:206-224`:

```
- {slug}[{status}] — {kind} · {desc || rule || '(see recall)'}{desc && rule ? ' · ' + rule : ''}
```

A skill with no description and no `ifCondition` renders as `- slug [candidate] — repeat · (see
recall)` — **no trigger information at all**, inside a block whose own header says *"Each line is
WHEN to use it."*

**⇒ Three concrete harms:** a dormant skill **displaces a better one** from the index; it **never
fires**; and the trader believes it is a rule.

**What is NOT a usable signal here — and the repo has already worked this out.** The app *can*
almost tell "this skill never fired" — but `services/learning/memoryHealth.ts:15-18` refuses to:

> *"`staleFiles` — a file the log DOES place a hit on, whose newest hit is older than
> `STALE_FILE_DAYS`… `unobserved` — a file with no hit inside the retained window. **Absence from a
> run-capped log is not the same as never being served** (the hit may simply have aged out, and most
> notebook folders are never named in a source record at all), so these are reported as unobserved —
> with their days-since-edit — and never folded into the stale count."*

**⇒ The review job must inherit that discipline: "never fired" is NOT provable from the injection
log, so it must not be the verdict.** The verdict is the *structural* one — no trigger, or a
fallback description — with "never observed" shown as a **corroborating hint**, never as the proof.

**And the review must not confuse *vague* with *general*.** The retrieval deliberately broadens on
prose for an unscoped rule (`:243-244` — *"A prose match may broaden retrieval for an
unscoped/general skill"*), so a general lesson is **supposed** to have no structured scope. A
vague skill and a general skill have the same shape from the outside. **⇒ the verdict is a
WARNING, not a defect**, and the fix is the trader's choice.

#### 12.4.3 Verdict 3 — a **CLIPPED** skill: it fires, with half a procedure

`RECALL_SKILL_BODY_MAX = 700` (`services/learning/MemoryRetrievalService.ts:144`), and
`services/learning/skillDocument.ts:6-8` explains the consequence: *"A longer document injected
naively would either truncate mid-section or push the rest of the packet out."* The card projection
already returns `clipped` and `droppedChars` (`skillDocument.ts:48-54`) — **computed, and never
surfaced to anyone.**

**⇒ a clipped skill is a half-procedure in every single prompt that uses it, and nothing says so.**

#### 12.4.4 The safety rule the review must obey — and it falls out of E-35

`applyNotebookSkillsToAnalysis` — the function with zero production callers today (E-35) — is the
one that would apply the hard `avoid` veto, the candidate cap and the confidence downgrade. **If E-35
lands, a repaired skill can change what the model does with the trader's money.**

**So:**

1. **A repair that WIDENS a skill's reach ACTIVATES it.** Reconstructing a ghost gives it a
   trigger; giving a dormant skill a real description makes it match. Both turn a dormant rule into
   a live one that can veto a trade.
2. **⇒ The default for a broken skill is NOT "make it work" — it is "show it and let the trader
   decide."**
3. **Narrowing is safe; widening is not.** A proposal may **demote** (candidate, retired, archived)
   freely — that only ever removes influence. A proposal that **activates** must be explicitly
   confirmed, one skill at a time.
4. **Evidence counters are never invented.** A reconstructed skill starts at **zero wins, zero
   losses**, `status: candidate`, and no `lastEvidenceAt` — it has earned nothing, and the ledger
   must say so.
5. **Every repair is a proposal through the existing queue** (`utils/learningQueue.ts` →
   `components/learn/ActionApprovals.tsx`), with the old and new text side by side.
6. **The ghost count belongs on the Health card permanently**, not only in the review — a hand-edit
   can create a ghost at any time, and today the trader has no way to know.

#### 12.4.5 The table

| verdict | detection (all deterministic) | what the review shows | what it may propose |
|---|---|---|---|
| **GHOST** | `parseSkillMarkdown` returns null while `isSkillFile` is true. **Count already computed at `memoryHealth.ts:178-181` and discarded.** | the file name, its byte count, and **the first failing line** — the parse error, not *"invalid"* | (a) reconstruct the frontmatter from the file's own body → **unproven candidate, zero counters**; (b) archive it out of `skills/`; (c) delete it, **only on the trader's word** |
| **DORMANT** | no `ifCondition`/`thenAction`, and the description is the `serializeSkill` fallback (`:1064-1067`) rather than a real one. *"Never observed"* is a **hint**, never the proof (`memoryHealth.ts:15-18`). | the skill, its description, and **"names no setup it applies to"** | (a) the model writes a trigger **from the skill's own body** — old and new side by side; (b) demote to `candidate`; (c) leave it alone. **A warning, not a defect** — a general rule is meant to be unscoped |
| **CLIPPED** | `projectSkillCard(...).droppedChars > 0` — **already computed** (`skillDocument.ts:48-54`) and never surfaced | the skill and **how many characters are cut** | (a) shorten the body (model-proposed; the full text kept in the proposal); (b) move the overflow to a `references/` note — **needs E-46** |

**⇒ The review job's output is a three-column report (fine / dormant / clipped / ghost), a per-skill
diff for every proposal, and a Health-card counter for the ghosts. Not a rewrite.**


<div style="page-break-after: always"></div>

---

## Part B — Report 2 — Enhancements and improvements

<sub>Source: `docs/plan/audit/2026-10-19-02-enhancements.md`</sub>

<!-- original part title: Report 2 — Enhancements and improvements -->

**Pinned commit:** `6a41a9f7e3b3986236c3000862d326f1e95dfad1` (branch `main`)
**Date:** 2026-10-19
**Part B of the brief.**

**How to read the roadmap column.** Every proposal is tagged with one of:

| tag | meaning |
|---|---|
| **NEW** | not present anywhere in the roadmap corpus — *and* not in the previous audit's orphan gap report either |
| **NEW (prior)** | not in `docs/plans/`, but **already identified** on 2026-10-18 in the orphan `docs/analysis/05-lead-findings.md`. These are the highest-value items in this report **and** the most likely to be lost — see §0.8 of the index report |
| **PARTIAL** | a roadmap item exists but does not name the missing part; the missing part is named explicitly in the row |
| **COVERED** | a roadmap item already covers it; the item id is cited and the item is still open |
| **IN FLIGHT** | the concurrent session is doing it right now |

**The corpus I checked against.** 282 numbered roadmap items (R-001…R-282) and 64 gap rows
(G-01…G-64) extracted from `docs/plans/**` (20 files), `docs/learning-loop-map.md`,
`docs/ui-doctrine.md`, `HANDOFF_LEARNING_LOOP.md`, `PLAN_LEARNING_LOOP_AND_UI.md`, `AGENTS.md`,
`changelog.md`, plus the recovered orphan `docs/analysis/05-lead-findings.md`. Full index in
`audit/2026-10-19-04-cleanup-manifest.md` §8.

---

### B1. The five findings that decide everything else

Before the ranked list, the five items that dominate. Everything in §2 and §3 is downstream of
these, and two of them are not on the roadmap at all.

| # | finding | severity | one-line proof |
|---|---|---|---|
| **F-01** | The assembled context is computed and **discarded** on every send. | **HIGH** | `hooks/useAnalysisPipeline.ts:1003-1154` builds it; `:1214`, `:1323`, `:1350` send `promptToSend` instead |
| **F-01b** | The injection ledger therefore **records skills the model never received**, and the skill-evidence join credits them anyway. | **HIGH** | `MemoryRetrievalService.ts:976-981` records by default; `memoryContext.ts:150` does not opt out; `MemoryInjectionService.ts:189` → `SkillMemoryService.ts:1617` grants FOLLOWED |
| **F-11** | The gate scores R:R from `takeProfit[0]`; the card and the clamp use the **nearest** target. | **HIGH** | `TradeValidationGate.ts:589` → `AccuracyValidationService.ts:196-222` vs `utils/riskReward.ts:48` → `utils/analysisUtils.ts:1272-1278` |
| **F-13** | **There is no cost model.** Every R, win rate, calibration bucket and the entire skill ledger is **gross**. | **Med-High** | a repo-wide search for `slippage\|takerFee\|makerFee\|commission\|costBps\|feeRate` returns a warning string, a comment, and the `netR` accumulator — which is the **sum of gross** R multiples (`SkillMemoryService.ts:1431`) |
| **F-10** | The analysis prompt **never reaches a trader-facing answer**. | **Med-High** | `analyzeTradingView`'s only production caller is `SkillEvalScheduler.ts:284`; `analyzeTradingViewWithTransientRetry` has zero |

---

### B2. Quick wins — small effort, real impact

#### E-01 — Decide what happens to the assembled context, and make the ledger match

| | |
|---|---|
| **Problem** | `enhancedPrompt` is assembled from seven context blocks and sent nowhere. `hybridDataInjection` — the whole hybrid market packet — is `devLog`ged. `const gateInjection = '';` is a **hard-coded empty string**, so the entire "GATE KEEPER: Two-Stage Gate Scan" block computes nothing and its success log can never fire. |
| **Evidence** | `hooks/useAnalysisPipeline.ts:1003` (assemble), `:1106-1109` (the four blocks), `:1130` (reflections), `:1138` (`gateInjection = ''`), `:1146-1149` (dead branch), `:1152` (devLog), sends at `:1214` / `:1323` / `:1350` |
| **Proposed change** | Two mutually exclusive options — **pick one and make it explicit**:<br>**(a) Wire it.** Pass the assembled prompt on the desk path; give the retrieval call `recordInjections: false` unless the block is actually sent; move the gate constraints out of the dead variable and into the real prompt. Cost: a per-request token increase, and a budget decision.<br>**(b) Cut it.** Delete the assembly, the `devLog`s, and the injection record that goes with it. The desk path's own `surfacePromptWith` (`services/trade/chatSurfaceTurn.ts:105-139`) already assembles a *deliberate, narrower* context, and the tools (`recall`, `get_notebook_map`, `read_memory`) give the model a pull path. Cost: the "hybrid intelligence" the app is named for stays out of the prompt.<br>**What is not acceptable is the current state**, where the app pays for a retrieval it does not use and then lies about what the model saw. |
| **Impact** | **Accuracy** (the loop learns from what it actually saw) · **cost** (one wasted retrieval per send) · **reliability** (the ledger stops lying) · **maintainability** (a dead branch and a hard-coded empty string out) |
| **Effort** | **M** (a) · **S** (b) |
**The one recommendation, made consistent across the whole audit and the plan index (§3C.1):** **(1) inject the harness contract — 1,582 chars: the confidence ladder, the risk rules and the `HARNESS_TURN_MARK` convention — into the P1/P2/P3 system prompts; (2) cut the retrieved context by default; (3) flip `recordInjections` to default-false in the same change**, or the ledger keeps lying while you decide. Inject and record together, or neither. |
| **How to verify** | A new test that builds the **sent** message and asserts the expected blocks are present and the forbidden ones absent (E-11). Then `npm run render-probe`. Then: log the injection record's `sources` next to the sent prompt for one run and confirm they agree. |
| **Roadmap** | **PARTIAL** — `R-256` names "the data-pull residue — the injection string is read only by `devLog`", and `G-07` names `enhancedPrompt`. **The missing part, named:** R-256 does not name (i) the seven specific dropped blocks, (ii) the injection-ledger consequence, (iii) the hard-coded `gateInjection = ''`, (iv) the owner decision *"what replaces the analysis branch"* that `docs/plans/debate-deletion-status.md:110-147` is waiting on. |

#### E-02 — One planned R:R, one formula — **REFRAMED 2026-10-20: the module it fixes is not wired**

| | |
|---|---|
| **Problem** | Three computations of the *planned* R:R coexist. The card, the journal and the probability clamp use `utils/riskReward.plannedRiskReward` (nearest target). The **validation gate** uses `takeProfit[0]`. The **scalp/swing validators**, called *by the same gate run*, use `takeProfit[0]` a second time. On an out-of-order target list the gate and the card disagree about the same plan — and the probability clamp uses the card's ratio while the confidence downgrade uses the gate's. |
| **Evidence** | `services/validation/TradeValidationGate.ts:589` → `services/validation/AccuracyValidationService.ts:196-222` (gate) · `utils/riskReward.ts:48` → `utils/analysisUtils.ts:1272-1278` (card) → `utils/analysisUtils.ts:1430` (clamp) · `services/analysis/ScalpDetectionService.ts:178` and `:236`, called at `TradeValidationGate.ts:889`/`:899` (second copy). The file's own comment at `ScalpDetectionService.ts:160` ("which is part of why this service was never wired in") is **stale** — it is wired in. |
| **Consequence, worked** | entry 100, SL 90, targets listed `[120, 110]`: the **card shows 1.00** (nearest = 110), the **gate scores 2.00** and passes the High-confidence bar (min 2.0), and the **clamp applies the 1:1 band (≤54 %)**. A 1:1 plan is gated as 2:1. |
| **Proposed change** | Make `utils/riskReward.ts` the single arithmetic owner. Add a **direction-aware** variant (`signedPlannedRiskReward`) that the gate can use for the inverted-plan refusal, and delete the copies in `AccuracyValidationService.ts` and `ScalpDetectionService.ts`. The two cannot be merged naively — the gate's sign handling is *desirable*; the duplication is the defect. |
| **Impact** | **Accuracy** (a plan's grade must not depend on target order) · **profit** (a wrong grade is a wrong size) · **maintainability** (one formula, one test table) |
| **Effort** | **M** |
| **Risk** | **M** — changing the gate changes what is refused. Ship behind the existing `ValidationConstants` thresholds, and diff the gate verdict over the existing trade corpus before and after. |
| **How to verify** | A table-driven test over out-of-order target lists asserting `gateRatio === cardRatio` for every combination; and a replay of the stored `trades` table comparing the old and new verdicts (the corpus is in the journal). |
| **Roadmap** | **NEW** — nothing in `docs/plans/` and nothing in the orphan gap report names the R:R drift. `AGENTS.md` names `utils/riskReward.ts` as the canonical module, which makes the gate's copy an unnoticed second implementation of a module the repo says is canonical. |
| **🔴 REFRAMED 2026-10-20** | **The gate this fixes is not wired.** `services/validation/TradeValidationGate.ts` (986 lines, 20 checks) has **ZERO production importers** — `grep 'runValidationGate\|TradeValidationGate'` over every non-test file returns only the definition and **two comments in other files offering to feed it** (`services/analysis/EntryTimingService.ts:588`, `services/backtesting/StopLossOptimizerService.ts:332`). Only the narrower `GateKeeperService` (a confidence cap + a family pre-filter) is live, via `services/trade/proposalGate.ts`. **⇒ E-02 splits: E-02a *wire the gate* (big) and E-02b *retire it* (small — delete 986 lines and its test).** This is **the single highest-leverage decision in the plan**, and it is the owner's, not a refactor's. |

#### E-03 — Charge the round trip

| | |
|---|---|
| **Problem** | The app has **no cost model**. There is no fee, slippage or funding term anywhere in the source. Every `realizedR`, every win rate, every calibration bucket, every skill's expectancy and the whole RL ledger are **gross**. The field named `netR` is the *sum of gross* R multiples — the name is misleading. |
| **Evidence** | a repo-wide search for `slippage\|takerFee\|makerFee\|commission\|costBps\|feeRate` returns exactly three files: `services/analysis/ScalpDetectionService.ts:189` (a *warning string*), `services/learning/ReinforcementSignalService.ts:50` (a *comment* — *"Potential future params: slippage, timeToTarget, etc."*), and `services/learning/SkillMemoryService.ts:1431` (the `netR` accumulator). `services/backtesting/BacktestingService.ts:1358-1366` computes P&L as a raw price difference. |
| **Why it is decisive** | The app's own gates define the loosest trade it will allow: R:R 1.2 (Low/Avoid), scalp SL ≤ 1.0 % of price, scalp min R:R 1.0. A 0.10 % round trip against a 1.0 % stop is **0.10 R**; against a 0.3 % scalp stop it is **0.33 R**. At a 50 % win rate and R:R 1.2, gross expectancy is **+0.10 R** and the round trip consumes it. **The breakeven win rate moves from 45.5 % to 50.0 %** — and the gate simultaneously caps that trade's confidence at **≤54 %** (`utils/analysisUtils.ts:1430-1440`). |
| **Caveat, stated** | The 0.05 %/side taker rate was an **assumption** ("the standard published taker rate and is not in the repo"). The arithmetic is linear in it, and the conclusion holds for any taker fee above ~0.02 % per side at a 1 % stop. **The design is therefore to make the trader state their fee tier**, not to hardcode an exchange rate — and that is now decided (see *Approved parameters* below). |
| **APPROVED PARAMETERS** (owner, 2026-10-20) | ✅ **5 bps taker / 2 bps maker, zero slippage, with a visible "slippage not modeled" label.** The fee tier is the trader's setting. **The slippage line is labelled, never a silent zero** — an unlabelled zero reads as a claim the model did not make, which is the same class of defect as the "fresh packet" claim in E-33. |
| **Proposed change** | A single cost model, in R, computed at journal-write time: `costR = (feePerSide×2 + slippageBps/10000) / (stopDistancePct/100)`, with the fee **user-configurable** at the approved defaults and a visible **"slippage not modeled"** label on every net figure. Store `costR` and `netR` on the row, feed the ledger and the calibration buckets from `netR`, and keep `realizedR` for the gross view. |
| **Impact** | **Accuracy** (the ledger becomes net) · **profit** (this is the largest single correctness gap for a manual trader) · **reliability** (the expectancy shown to the trader becomes the expectancy they have) |
| **Effort** | **M** |
| **Risk** | **M** — it changes every number in the journal, so existing rows need a "gross" marker and the UI needs to say which is which. |
| **How to verify** | A test that a 1:1 plan at a 1 % stop with a 0.05 %/side fee shows a net expectancy ≤ 0 at a 50 % win rate, and that the skill ledger's expectancy matches `netR` and not `realizedR`. |
| **Roadmap** | **NEW (prior)** — this is `G-01`/`G-02`, and it comes from the **orphan** `docs/analysis/05-lead-findings.md`, **not** from `docs/plans/`. **It is not in the roadmap at all** — and the file it lives in was one `git gc` from being lost. It is now protected by the branch `archive/prior-audit-2026-10-18`. |

#### E-04 — Fix the inverted ensemble weighting

| | |
|---|---|
| **Problem** | `winRate: perf.overallStats.total >= 3 ? perf.overallStats.winRate : 0`. A provider with **one loss and one trade** scores `0.0 %`; a provider with **no trades at all** also scores `0.0 %`. The providers are then sorted descending, and the moderator is told to favour the top one. **A single loss can brand a model as the worst performer, and a single lucky win the best.** |
| **Evidence** | `services/backtesting/ModelPerformanceService.ts:649` (the score), `:657` (the sort), `:660` (the gate — *some* provider needs ≥5 trades), `:669-670` (best/worst), `:693-694` ("Weight X's analysis significantly higher … Be skeptical of Y's"). **Verified at the pin, verbatim.** |
| **Proposed change** | A provider with fewer than `MIN_TRADES` gets `null`, not `0`. The ranking skips nulls. The moderator block says "not enough data for this provider" rather than being handed a 0 %. The second, better-gated path (`services/validation/calibrationPolicy.ts:800`, `MIN_TRADES_FOR_CALIBRATION = 10`) is already correct — make it the one that feeds the prompt, and note that its output is assembled at `services/analysis/HybridIntelligenceService.ts:1270-1291` into `accuracyEnhancements` **which reaches no model**. |
| **Impact** | **Accuracy** — this is the mechanism that would tell the app which seat to trust. |
| **Effort** | **S** |
| **Risk** | **S** — the whole block is inert today (no closed trades), so nothing can regress. |
| **How to verify** | A unit test over `ensureProviderEntry` + the ranking: one provider with 1 loss, one with 0 trades, one with 20 trades — assert the ranking and the emitted text. |
| **Roadmap** | **NEW (prior)** — `G-05`, from the orphan gap report. Not in `docs/plans/`. |

#### E-05 — Make the injection ledger honest, independently of the prompt decision

| | |
|---|---|
| **Problem** | `getMemoryFilesContext` **records an injection** by default (`MemoryRetrievalService.ts:976-981`). `assemblePipelineMemoryContext` calls it without `recordInjections: false` (`hooks/analysisPipeline/memoryContext.ts:150`). The recorded injection then feeds `skillAdherenceForRun` (`MemoryInjectionService.ts:189`), which is the join `applySkillEvidence` (`SkillMemoryService.ts:1617`) uses to grant **FOLLOWED** credit. So a skill can earn W/L credit for an outcome it did not influence. The repo's own cold-start contract says this must not happen: *"evidence accrues ONLY on the FOLLOWED branch … a skill the run was not shown goes to `controlIds`, never to W/L"* (`docs/learning-loop-map.md:80-91`). |
| **Evidence** | as above. Also `services/learning/SkillEvalService.ts:203-213` shows the pattern the codebase already knows: `recordInjections: false` "keeps synthetic arms out of" the ledger. |
| **Proposed change** | `recordInjections` should default to **false** and be opted into by the caller that actually puts the block on the wire. The call sites that genuinely send the context opt in; the ones that do not, do not. One-line change per call site plus a default flip. |
| **Impact** | **Accuracy** — this is the difference between a skill ledger that measures something and one that measures noise. |
| **Effort** | **S** |
| **Risk** | **S** — but it will **change the existing ledger's numbers** (skills that were credited for nothing will stop being credited). That is the point, and it should be stated in the changelog. |
| **How to verify** | A test that runs a turn with a known skill, asserts the injection record's `sources` match the blocks present in the **sent** message, and asserts a skill absent from the sent message lands in `controlIds`, never in W/L. |
| **Roadmap** | **NEW** — `R-151` records that *"nothing checks `approvedBy` or `whyAccepted` at injection time"*, but that is the **approval** gate, a different mechanism from the **record**. The missing part, named: no roadmap item covers the *record*. |

#### E-06 — Make the two numeric ratchets bind again

| | |
|---|---|
| **Problem** | Two ceilings were set from a measurement and left behind by the measurement. **The lint ratchet:** `eslint . --max-warnings 889` against a measured **682** warnings — **207 warnings of slack**, so a new warning cannot fail CI. `eslint.config.js:111-133` documents the history honestly: *"the cap sat at 1020 while the tree stood at 949, so 71 warnings could be added and CI would still pass."* It was corrected to 889. **The bundle ratchet:** `guards.yml` fails the build above 2,600 kB, calibrated at *"~1956 kB"*; the measured entry chunk is **1,352.6 kB** — 31 % below the calibration point, 48 % below the ceiling. |
| **Evidence** | `package.json` (`--max-warnings 889`); `npm run lint:loose` measured at **682 problems (0 errors, 682 warnings)** in a throwaway copy; `.github/workflows/guards.yml` (the 2600 kB ceiling and its comment); `dist/assets/index-*.js` measured at **1,352.6 kB**; `eslint.config.js:111-133` (the history) |
| **Proposed change** | Re-measure and lower both. **And make the ratchet ratchet itself** — the repo already has the mechanism: `scripts/check-flow-doc-anchors.cjs` re-runs its census on every invocation and its floors `const COVER_FLOOR = 52; const COVER_CITED_FLOOR = 52;` **ratchet down only**, with a control arm per rule. Apply the same shape to the lint and bundle ceilings: a CI step that **fails when the measured value is below the recorded ceiling by more than a threshold** — "the ceiling is stale, lower it". |
| **Impact** | **Reliability** (the gates start catching regressions again) · **maintainability** (the ceiling is a fact, not a wish) |
| **Effort** | **S** |
| **Risk** | **S** — the lint change is a one-line edit plus whatever the new count breaks; the bundle change is a one-line edit. The self-ratcheting step could be noisy on the first run; make it advisory for one cycle, then binding. |
| **How to verify** | `npm run lint:loose` on a clean checkout (expect ≤ the new cap); the new CI step fails on a deliberately raised ceiling. |
| **Roadmap** | **NEW** — no roadmap item covers either ceiling. The pattern the fix copies is the repo's own (`R-222` shipped the anchor gate; `R-243` shipped its ratcheting floors). |

#### E-07 — Turn on `noUnusedLocals`

| | |
|---|---|
| **Problem** | `tsconfig.json:28` sets `noUnusedLocals: false`. An unused import, an unused export and an orphaned module are all **silent**. Two live examples at the pin: `defaultToolsForRole` imported at `hooks/useAnalysisPipeline.ts:14` with no remaining use, and `buildHybridEnvelope` imported at `:66` with **zero calls** — `git grep buildHybridEnvelope 6a41a9f7` returns exactly two hits, the import and the definition. Both are invisible to `tsc` *and* to `eslint` (the rule is `warn` under a slack cap). |
| **Evidence** | `tsconfig.json:28`; `hooks/useAnalysisPipeline.ts:14` and `:66`; `eslint.config.js:135` |
| **Proposed change** | Set `noUnusedLocals: true` and `noUnusedParameters: true`. Land it in two steps: first as an `eslint` **error** (with `--fix` for the trivial cases), then as a `tsc` error, so the build never goes red on a list nobody has read. |
| **Impact** | **Maintainability** (the dead-code class becomes a build failure) · **reliability** (no dead branch can hide a live bug) |
| **Effort** | **S** to flip · **M** to clear the list |
| **Risk** | **M** — the list may be long, and a `noUnusedParameters` flip will hit every intentionally-unused callback parameter. The two-step landing removes the risk of a red build. |
| **How to verify** | `npm run typecheck` clean; then add a test that a deliberately-unused import fails the build (or just rely on `tsc`). |
| **Roadmap** | **NEW** — no roadmap item covers it. `G-17` covers `App.tsx`'s *size*, not the compiler setting that would find the dead code. |

#### E-08 — Fix the registry's drifted copies and the two unreachable ids

| | |
|---|---|
| **Problem** | Three registry entries hold a **different, older copy** of the prompt they shadow, and "Reset to default" installs that stale copy **as an override**. `strategy.summarize_pdf` is the worst: the registry copy is 992 chars, the real default is 1,358, and the real one demands `**Strategy: <name>**` plus a mandatory `Family` from the eight families. Resetting installs the old shape, so uploaded strategy files parse with **no `strategyFamily`** (`services/learning/strategyStore.ts:90`) — and the strategy×regime matrix and the skill attribution both read that field. `notebook.note` (1,611 vs 1,718) and `notebook.chat_note` (1,450 vs 1,557) are each **107 chars short**, and the missing text is *"Never write to skills/ — the harness creates skills only after a cluster of similar trades has evidence."* — so resetting installs an override that **removes the prohibition on writing into `skills/`**. Separately, two call sites use ids that are **not registry entries** — `learning.skill_refine` (`services/learning/SkillCraftService.ts:228`) and `learning.skill_worth` (`services/learning/skillWorthGate.ts:112`) — so the Settings editor cannot reach them. |
| **Evidence** | as above; the byte sizes are runtime-measured |
| **Proposed change** | Make the registry import the constant rather than restate it, and add a test that asserts **byte identity** between a registry entry and the constant it shadows. Add the two missing ids. |
| **Impact** | **Accuracy** (a strategy file with no family is invisible to the matrix) · **reliability** (a notebook override that permits skill writes) · **maintainability** |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | the byte-identity test; `tests/promptsAreWired.test.ts` extended from *reachability* to *reachability + identity* |
| **Roadmap** | **NEW** — `R-241` shipped the **unreachable** half of this cleanup (16 unreachable entries → 0). The **drift** half was not in scope, and `tests/promptsAreWired.test.ts` is a *source-shape* gate, so it cannot see it. **The missing part, named: the gate asserts that an id is *read*, not that the text is *the same*.** |

#### E-09 — `analysis.lens`: wire it or take the editor away

| | |
|---|---|
| **Problem** | `analysis.lens` is a registry entry the trader can edit in Settings, and it is **sent to nobody**. `LENS_MODE_BASE_PROMPT` (2,854 chars) is never sent; `rolePrompt` is a declared-but-unset interface field (`hooks/useAnalysisPipeline.ts:298`) — only the measure test assigns it. |
| **Evidence** | `constants/promptRegistry.ts` (the entry) · `constants/prompts/analysisPrompts.ts:108` (the constant) · `hooks/useAnalysisPipeline.ts:298` (`rolePrompt` never assigned) |
| **Proposed change** | One of the two: assign `rolePrompt` and route the lens path, **or** delete the registry entry and the constant. The app is currently handing the trader an editor for text it never sends — the exact defect `docs/app-flow.md:595-597` describes and the 2026-10-18 deletion fixed for 16 other ids. |
| **Impact** | **Honesty** (a control that does nothing) · **maintainability** (2,854 chars of dead prompt) |
| **Effort** | **S** to remove · **M** to wire |
| **Risk** | **S** to remove |
| **How to verify** | Extend `tests/promptsAreWired.test.ts` to assert **that the prompt reaches a sent request**, not merely that a `getPrompt()` call site exists. That is the gate that would have caught this and F-10. |
| **Roadmap** | **NEW** — one entry further than `R-241`. |

#### E-10 — Three small honest fixes

| item | problem | evidence | change | impact | effort | roadmap |
|---|---|---|---|---|---|---|
| **E-10a** | The bot seat is told to *"use your desk tools … and web search before reasoning"* — and the bot surface has **no tools at all** (P4 is deliberately tool-less). | `services/agents/seatPersonas.ts:30` vs `hooks/useAnalysisPipeline.ts:1317-1320` and `services/trade/chatSurfaceTurn.ts:24-27` | either give bots the read-only tools, or fix the prompt | honesty, accuracy | S | **NEW** |
| **E-10b** | `types/enums.ts:43` still reads `export type DebateSpeaker = string \| 'Moderator';` — *"a degenerate union, worse than the one it replaced"*. | `types/enums.ts:43` | one line: `export type DebateSpeaker = string;` | maintainability | S | **COVERED** — `G-13`, `R-248`; still open |
| **E-10c** | `hooks/useSurface.ts` declares `AppSurface = 'chat' \| 'trade' \| 'journal' \| 'agents' \| 'learn'` but `VALID` has only four members — `'chat'` is a migration case that can never be stored. | `hooks/useSurface.ts:16-20` | drop `'chat'` from the union | maintainability | S | **NEW** |

---

### B3. Medium projects

#### E-11 — A prompt **contract** test: assert what is *sent*, not what is built

| | |
|---|---|
| **Problem** | There is **no test anywhere** that asserts the content of a sent message. `tests/promptsAreWired.test.ts` proves a registry id has a `getPrompt()` call site — a *source-shape* gate. F-01, F-09, F-10 and E-09 are all invisible to it, and all four are real. The repo's own doctrine names the blind spot: *"Unit tests cannot see the transcript"* and *"jsdom mounts components without resolving a stylesheet"* (`AGENTS.md:65-122`). |
| **Evidence** | `tests/promptsAreWired.test.ts`; the four findings above; `AGENTS.md:65-122` |
| **Proposed change** | For each of the four model-call paths (P1 chat, P2 dock, P3 automation, P4 bot), build the **real** system prompt through the real function and assert: the expected blocks are present, the forbidden ones are absent, and the tool list matches the surface's allow-list. Four tests, one per surface. This is the gate that turns "the app assembles it" into "the app sends it". |
| **Impact** | **Reliability** (it would have caught F-01, F-09, F-10, E-09) · **maintainability** (the prompt surface becomes a checked contract) · **cost** (a budget assertion per surface) |
| **Effort** | **M** |
| **Risk** | **S** — pure test code |
| **How to verify** | Remove a block from one surface's prompt and watch exactly one test go red. |
| **Roadmap** | **NEW** — `R-225` is the *doctrine* of the blind spot; no item is the *fix*. |

#### E-12 — Re-home the position sizing

| | |
|---|---|
| **Problem** | `utils/ticketSize.ts` is a **complete, grade-tiered, fail-closed** position-sizing module — with a leverage cap, an unconfigured-equity refusal, a risk-tier ladder and a Kelly advisory — and it has **zero production call sites**. The only callers are two test files. The journal's size today is the model's own number, or nothing. |
| **Evidence** | `git grep computeContractSize 6a41a9f7` returns only `tests/financialMath.test.ts:10,327,336,346` and `tests/ticketMathTiers.test.ts:6,80,91,103,109,182`. The module is `utils/ticketSize.ts` (the previous audit called it *"the highest-value re-homing in the codebase"*). |
| **Proposed change** | Wire it into the proposal card and the journal write path: the suggested size is computed from the trader's risk % setting, the plan's stop distance and the exchange leverage cap — and the trader can override it. The override is recorded, so the journal can compare *the model's size*, *the app's suggestion* and *the trader's size*. |
| **Impact** | **Accuracy** (the model's size is currently one of the inputs) · **profit** (a wrong size is the most expensive error a manual trader makes) · **reliability** |
| **Effort** | **M** |
| **Risk** | **M** — it changes what the journal records; existing rows need a marker, and the trader must always be able to override. |
| **How to verify** | The journal row's size equals `computeContractSize`'s output for a fixture; the leverage cap is honoured; an unconfigured equity is refused rather than guessed. |
| **Roadmap** | **NEW (prior)** — `G-06`; from the orphan gap report. Not in `docs/plans/`. |

#### E-13 — Decide the two unresolved *product* questions the code already poses

| | |
|---|---|
| **Problem** | Two code paths are half-decided and the half-decision is visible to the trader. (a) The **Prompt A/B (control lane)** dropdown in Settings does nothing: `beginPromptLane` has zero call sites, `controlLane` is permanently `false`, and `runStats.promptLane` is never assigned — so the "Prompt lanes" dashboard card always reports 0/0. (b) The **truncation tally** records nothing: `beginTruncationWindow()`, `consumeTruncations()` and `peekTruncations()` have zero production call sites, so `recordFinishReason` returns immediately. |
| **Evidence** | (a) `services/infrastructure/PromptOverrideService.ts:24-38`; `hooks/useAnalysisPipeline.ts:1242,1403`, `App.tsx:1727,1754`, `services/agents/botRoutine.ts:155` (the `runStats` literals set only `runId`/`startedAt`/`finishedAt`/`durationMs`); `utils/promptVersionStats.ts:45-57`; `components/settings/SessionUsagePanel.tsx:228-242`. (b) `utils/finishReason.ts` — zero production call sites for the three window functions; `AGENTS.md` tells a reader to "read the ceiling with `peekTruncations()`" and there is no reader. |
| **Proposed change** | For each: **either wire it or remove it.** (a) Wire `beginPromptLane` onto the tool turn and stamp `runStats.promptLane` — the A/B is a genuinely useful operator tool and the machinery is 90 % built. Or remove the dropdown and the card. (b) Wire the window into the turn so the tally is real, and surface it in the run contract; the roadmap's `R-071` needs exactly this to know an answer was cut off. |
| **Impact** | **Honesty** (two visible controls that do nothing) · **accuracy** (the A/B lane is how you would compare two prompts on real trades) · **reliability** (the truncation tally is the only way to know a provider stopped early) |
| **Effort** | **M** each |
| **Risk** | **M** — (a) changes the prompt sent, (b) changes the run accounting |
| **How to verify** | (a) two runs with the lane set, and the dashboard card shows two non-zero rows with different prompt versions. (b) a forced truncation produces a non-zero tally and a visible "the provider stopped early" marker. |
| **Roadmap** | (a) **COVERED** — `R-250` and `G-09`, both still open. (b) **PARTIAL** — `R-071` covers the *user-visible* silence of a truncated answer; **the missing part, named: the tally is not recorded at all**, so there is nothing for R-071 to surface. |

#### E-14 — Three stores that are backed up in name only

| | |
|---|---|
| **Problem** | (a) `approval_rules_v1:<user>` is on **neither** allow-list. On **web** the export sweep picks it up (localStorage *is* the Preferences fallback) but the import **skips** it (`isRestorablePreferenceKey`, `ExportService.ts:758-760`); on **native** it is neither exported nor restored. It gates **every auto-apply** — the per-coin "always journal" vs "ask" policy. The repository already knows: `tests/exportRawLocalStorage.test.ts:97` — *"NOT backed up: the inbox rules gate every auto-apply — worth a decision."* **The decision was never taken.** (b) `desk_idle_motion_v1_<user>`, `thinking_leak_bin_v1` and `trade_sidebar_open_v1` are on the **restore** list but not the **raw** list, and their owners read `localStorage` directly — so on native they are neither exported nor restored. (c) `agent_threads_opened_v1_<user>` has the same shape. |
| **Evidence** | `utils/approvalInbox.ts:46` (write), `:29/:38/:51` (reads) · `services/infrastructure/ExportService.ts:299-391` (the raw list), `:497-505` (the read fall-through), `:511` (the mirror's early return), `:758-760` (the import skip) · `services/desk/idleMotion.ts:34`/`:26` · `utils/thinkingLeakBin.ts:39`/`:12` · `App.tsx:475`/`:454` · `utils/agentThreads.ts:323`/`:313` |
| **Mechanical cause** | The one-time `migrateLocalStorageToPreferences` sweep (`services/infrastructure/PreferencesService.ts:226-241`) copies **every** localStorage key into Preferences, creating a **stale second copy** of every raw-owned key. `readSweptValue` prefers the raw store for RAW-listed keys precisely to undo this. A key that is *not* on the RAW list gets the stale Preferences copy. |
| **Proposed change** | (a) Add `approval_rules_v1` to `RAW_LOCAL_STORAGE_PREFIXES` and to the restore allow-list. (b) Add the three restore-only keys to the RAW list, or remove them from the restore list. (c) Same. Then **close the gate's blind spot**: `tests/exportRawLocalStorage.test.ts`'s `ownerUsesPreferences` check is **file-scoped**, so a file that touches Preferences anywhere is exempt for *every* key it owns — which is exactly how `trade_sidebar_open_v1` escapes. Make it **key-scoped**. |
| **Impact** | **Reliability** (no silent data loss on backup/restore) · **Accuracy** (the auto-apply policy is part of the trader's setup) |
| **Effort** | **S** for (a)–(c); **S** for the key-scoped gate |
| **Risk** | **S** — but it changes what a restore writes, so the restore test needs the native path too (which is not currently exercised). |
| **How to verify** | Extend `tests/infrastructure/backupImportRoundTrip.test.tsx` to run the native path (Preferences instead of localStorage) and assert each key round-trips. |
| **Roadmap** | **NEW** — `R-193` shipped 10 trading stores into the RAW list and `R-199` shipped per-key export caps; **the missing part, named: the approval-policy store and the three restore-only stores are not in either list, and the CI gate's file-scoped heuristic is why nobody noticed.** |

#### E-15 — Version coherence

| | |
|---|---|
| **Problem** | The repository carries **four** different version numbers. `package.json` says **1.3.0**. The committed `package-lock.json` says **1.0.30** — and the fix (bumping it and adding `js-yaml` to the lock's root devDependencies block) is sitting **uncommitted** in the working tree. `constants/version.ts:6` falls back to the literal **`'1.0.28'`** while its own comment says it is "kept synced with package.json" — five minor versions behind. The newest tag is **v1.2.0**; the changelog's newest entry is **v1.3.0**. |
| **Evidence** | `package.json` · `package-lock.json` (HEAD) · `constants/version.ts:6` · `vite.config.ts:443` (the `define` that supplies the real version in builds) · `git tag --sort=-creatordate` · `changelog.md:5` |
| **Proposed change** | One source. The build already injects `PACKAGE_VERSION`; make the fallback read the same value rather than a literal, or delete the fallback and fail loudly when it is absent. Commit the lockfile fix. |
| **Impact** | **Reliability** (a rebuild does not silently produce a different filename) · **maintainability** |
| **Effort** | **S** |
| **Risk** | **S** — but the fallback is the *dev* path, so a hard failure would break `npm run dev` if the define is ever removed. Prefer a build-time assertion over a throw. |
| **How to verify** | A test that asserts `APP_VERSION` equals `package.json`'s version under the test runner; `npm ci` from a clean checkout. |
| **Roadmap** | **NEW** — `R-276` shipped the *changelog ↔ package.json* agreement with a test; this is the same class for three other files. **The missing part, named: the lockfile and the fallback constant are not in that test.** |

#### E-16 — The 1-second clock in the trade surface

| | |
|---|---|
| **Problem** | `components/trade/TradeView.tsx:666` runs `setInterval(() => setNowMs(Date.now()), 1000)` — a **one-second state update in a 1,145-line component** that owns the chart, the order book, the transcript and the panels. A full re-render per second, for the lifetime of the surface. |
| **Evidence** | `components/trade/TradeView.tsx:666`; the component's size (1,145 lines) |
| **Proposed change** | Move the clock into a leaf that only renders the time, and let it format locally from a coarse tick. If the whole surface genuinely needs per-second freshness, that is a design question — but the *component* does not. |
| **Impact** | **Speed** (the app's feel on the surface the trader spends most time on) · **reliability** (fewer re-render-induced races) |
| **Effort** | **S–M** |
| **Risk** | **S** |
| **How to verify** | React DevTools profiler: the commit count on the trade surface over 60 s, before and after. **[Unverified — needs a profiler run]** the exact current cost. |
| **Roadmap** | **NEW** — the roadmap's performance items are the bundle ratchet and `App.tsx`'s size (`G-17`). This is not in the corpus. |

#### E-17 — The `fullscreen` right-panel branch, decided

| | |
|---|---|
| **Problem** | The right-panel contract computes a `fullscreen` presentation and the Trade surface pins `"push"`. So a branch is computed and never used. |
| **Evidence** | `hooks/useRightPanel.ts:127` (computes) · `components/trade/TradeView.tsx:1097` (pins `"push"`) |
| **Proposed change** | Decide: use it somewhere, or delete it. The repo's own instruction is *"either is honest, silently deleting it is not"* — so this is an owner decision, not a cleanup. |
| **Impact** | **Maintainability** |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | The branch is either reachable or absent. |
| **Roadmap** | **COVERED** — `R-017`, `G-18`, `R-156`, `R-159`; still open, and it is one of the 23 owner decisions the roadmap lists. |

---

### B4. Big bets

#### E-18 — Close the loop: make the outcome automatic, reversible and provenanced

**This is the highest-leverage change available, and it is the one the product promise depends on.**

| | |
|---|---|
| **Problem** | The learning loop is starved by **one human click**. The outcome autopilot polls every 20 s (`services/ui/OutcomeAutopilotService.ts:85`) and resolves the trade — but `markProcessed` is reached only **after** the trader confirms (`OutcomeAutopilotService.ts:650` ← `hooks/useWatchAndAutopilot.ts:201` ← `:178` → `App.tsx:2372` → `confirmAutopilotOutcome`). Every downstream consumer then computes over an empty set: auto-learn (`hooks/useTradeLogging.ts:122`), the loss-similarity penalty, the skill A/B (`services/learning/SkillEvalService.ts:53`), the weekly review (`services/learning/weeklyReview.ts:135`, `MIN_CLOSED_TRADES_FOR_REVIEW = 3`), the Brier calibration, and the provider ranking (`services/validation/calibrationPolicy.ts:800`, `MIN_TRADES_FOR_CALIBRATION = 10`). |
| **The number** | The previous audit measured **n = 0** resolved trades on the owner's machine on 2026-10-18, by decoding the live `leveldb`. **We did not re-measure** — the brief forbids touching a live profile, and the figure is machine-specific. **Whether it is still 0 is an open question only the owner can answer.** |
| **Proposed change** | Make the resolution **automatic but reversible**: the autopilot resolves, the app records the outcome with a `resolutionSource` flag (`autopilot` vs `confirmed`), and the trader can correct it. The correction writes a *new* row rather than editing the old one, so the ledger keeps both. Shadow mode first: resolve, show, **do not record** — for a month — and report the disagreement rate between the autopilot's resolution and the trader's confirmation. |
| **Impact** | **Accuracy** (every learning consumer is downstream) · **profit** (the skill ledger, the calibration and the provider ranking are all inert without closed rows) · **reliability** (the app's central promise is a loop) |
| **Effort** | **L** |
| **Risk** | **L** — a wrongly-recorded outcome poisons the ledger permanently. The mitigations are: a provenance flag, a correction path, a shadow month, and a "the trader may always override" rule. |
| **How to verify** | After the shadow month, the disagreement rate is below a threshold you choose. Then: the weekly review card stops returning `null`; the skill A/B produces verdicts; the calibration buckets populate. |
| **Roadmap** | **NEW (prior)** — `G-04`; from the orphan gap report, and it is *also* an owner decision the roadmap lists (the 7 Tier-2 product decisions, `HANDOFF_LEARNING_LOOP.md:213-235`). **This is the one item in this report where the previous audit's "worth doing" and the roadmap's "needs a ruling" point the same way: the loop cannot be measured until the outcome is recorded.** |

#### E-19 — One plan object, read by every surface

| | |
|---|---|
| **Problem** | A trade plan is computed in at least four places from the same levels: the proposal card (`services/trade/proposedTrade.ts:126-165`), the validation gate (`services/validation/TradeValidationGate.ts:495`), the probability clamp (`utils/analysisUtils.ts:1399`), and the level watch (`services/trade/levelWatchService.ts:217`). Each recomputes the ratio from the model's own numbers, and they do not agree (E-02). |
| **Proposed change** | Compute the plan **once**: a `Plan` object with entry, stop, targets, invalidation, the planned ratio (one formula), the grade, the confidence cap, and the size suggestion. The card, the gate, the clamp, the watch and the journal row all **read** it. The model supplies the levels; the app supplies everything else. This is the structural expression of the product framing: *the agent proposes, the deterministic code checks, the user decides.* |
| **Impact** | **Accuracy** (one plan, one verdict, one ratio) · **profit** (the grade and the size become consistent) · **reliability** · **maintainability** |
| **Effort** | **L** |
| **Risk** | **M** — it touches the gate, the card, the watch and the journal simultaneously. Land it behind the existing `Plan` type, one surface at a time. |
| **How to verify** | One test that builds a plan and asserts that the card's ratio, the gate's ratio, the clamp's band and the journal row's ratio are all the same number. |
| **Roadmap** | **NEW** — no roadmap item proposes this shape. `R-254`/`R-256` touch the same neighbourhood but not the object. |

#### E-20 — A replay harness

| | |
|---|---|
| **Problem** | There is **no way to ask "would today's code have graded yesterday's plan the same way?"** The app has the *ingredients* — the stored trades, the market history, the outcome engine, the prompt version stamp (`trade.promptVersion`), `sourceRunId`, `modelsUsed`, `marketSnapshot`, `marketRegime` — but no harness that re-runs a past plan through today's deterministic code. |
| **Proposed change** | A **replay** command (a script, not a feature, at first): for each closed trade, re-derive the gate verdict, the confidence cap and the probability band from the stored levels and the stored snapshot; compare with what was recorded; report the drift. It is deterministic, needs no provider, and it is the cheapest possible regression harness for E-02, E-19 and E-03. |
| **Impact** | **Accuracy** (every gate change can be measured against real history) · **reliability** · **maintainability** |
| **Effort** | **L** (M for the first version) |
| **Risk** | **S** — it is read-only over the journal |
| **How to verify** | The harness runs and reports; the drift report becomes a CI artifact. |
| **Depends on** | **real trade data** — and the *stored* data's completeness. `R-213` records that the live-journal counts were **never obtained**; `R-214` records that pre-F3a rows carry no `planId`. |
| **Roadmap** | **NEW** — nothing in the corpus proposes a replay. `R-206` (`SkillEvalService`) is the closest machinery: it re-runs a *prompt* against a trade. A replay of the *deterministic* code is the missing half. |

#### E-44 — Break the notebook out of one JSON blob

| | |
|---|---|
| **Problem** | The entire notebook — every skill, the risk rules, the doctrine, the recurring mistakes, the diary, the model notes, the distilled facts, the lens memory — is **one key**: `memory_files_v1_<user>`, a JSON blob of `.md` entries, up to **2 MB**, written whole. It is the **largest key in the app**, it is deliberately **uncapped** in the export (`ExportService.ts:398-402`), and every write rewrites the whole thing. |
| **Evidence** | `services/learning/MemoryFilesService.ts:31` (the prefix), `:250` (the store), `:673` (the name), `:1364` (the `-2.md` dedupe); `services/infrastructure/ExportService.ts:398-402` (the cap exemption) |
| **Proposed change** | Shard the notebook by category, with a small manifest key listing the shards and their sizes. The export already knows how to cap and mirror per key, so the machinery exists. The risk is a write that updates one shard must also update the manifest — an atomicity problem that does not exist today because the blob is one write. |
| **Impact** | **Reliability** (one corrupt write cannot lose 2 MB) · **Speed** (a single skill edit does not rewrite the notebook) · **cost** (the quota pressure in `utils/memoryBudget.ts` becomes per-shard) |
| **Effort** | **L** |
| **Risk** | **M–L** — this is the one store in the app that holds the trader's own thinking. A migration bug loses it. |
| **How to verify** | A migration test that shards an existing blob and asserts every entry survives byte-identically; a quota test that a full shard fails the *one* write, not the whole notebook. |
| **Roadmap** | **NEW** — the corpus discusses the notebook's *content* (`R-137`, `R-236`, `G-29`, `G-30`, `G-31`) but never its *shape*. `G-31` ("a budget exception that hides itself — the doctrine slot is an always-on layer outside the budget") is adjacent: the budget is per-run, the storage is per-blob. |

---

### B5. Ranked list

Ranked by impact ÷ effort, with the roadmap status.

| rank | id | what | impact | effort | roadmap | group |
|---|---|---|---|---|---|---|
| 1 | **E-01** | Decide the assembled context's fate | accuracy · cost · reliability | S–M | PARTIAL (R-256) | quick win |
| 2 | **E-05** | Make the injection ledger honest | accuracy | S | NEW | quick win |
| 3 | **E-02** | One planned R:R, one formula | accuracy · profit | M | NEW | medium |
| 4 | **E-06** | Make the ratchets bind | reliability | S | NEW | quick win |
| 5 | **E-08** | Fix the registry's drifted copies | accuracy | S | NEW | quick win |
| 6 | **E-04** | Fix the inverted ensemble weighting | accuracy | S | NEW (prior) | quick win |
| 7 | **E-09** | `analysis.lens` — wire or remove | honesty | S | NEW | quick win |
| 8 | **E-14** | Three stores backed up in name only | reliability | S | NEW | medium |
| 9 | **E-11** | A prompt contract test | reliability · maintainability | M | NEW | medium |
| 10 | **E-15** | Version coherence | reliability | S | NEW | quick win |
| 11 | **E-10a** | The bot seat's tool lie | honesty | S | NEW | quick win |
| 12 | **E-13** | The prompt lane and the truncation tally | honesty · accuracy | M | COVERED (R-250) / PARTIAL (R-071) | medium |
| 13 | **E-12** | Re-home the position sizing | accuracy · profit | M | NEW (prior) | medium |
| 14 | **E-03** | Charge the round trip | accuracy · profit | M | NEW (prior) | medium |
| 15 | **E-07** | Turn on `noUnusedLocals` | maintainability | S–M | NEW | medium |
| 16 | **E-16** | The 1-second clock | speed | S–M | NEW | quick win |
| 17 | **E-17** | The `fullscreen` branch | maintainability | S | COVERED (R-017) | quick win |
| 18 | **E-10b** | `DebateSpeaker` | maintainability | S | COVERED (G-13) | quick win |
| 19 | **E-10c** | The dead `'chat'` union member | maintainability | S | NEW | quick win |
| 20 | **E-19** | One plan object | accuracy · profit | L | NEW | big bet |
| 21 | **E-18** | Close the loop (auto-resolve) | accuracy · profit | L | NEW (prior) | big bet |
| 22 | **E-20** | A replay harness | accuracy · reliability | L | NEW | big bet |
| 23 | **E-44** | Break the notebook out of one blob | reliability · speed | L | NEW | big bet |

---

### B6. What is deliberately **not** proposed

The brief excludes order placement, exchange write access, regime routing, debate revival, extra
LLM review calls and a macro calendar. This report proposes none of them, and two of the
proposals above actively *reduce* model calls (E-01b, E-19).

Two things that look like proposals and are not, stated so they are not mistaken for omissions:

- **The ensemble weighting (E-04) is not a "debate revival".** It is one line that stops a
  one-loss provider from being ranked as the worst. It changes no prompt and adds no call.
- **The prompt contract test (E-11) is not an "extra LLM review call".** It is four unit tests
  that build strings.

### B7. Coverage note

Everything in this report was derived from: the source at `6a41a9f7`; the 282-item roadmap index
and 64-gap table extracted from `docs/plans/**` and the other planning documents; the recovered
orphan `docs/analysis/05-lead-findings.md`; and the four teammates' read-only audits
(architecture and stores, prompts and tools, security and gates, UX and docs). **No gate was run
in the repo by this thread**, **the app was never run**, and **no live profile was touched**. The
full set of measurements, with the commands, is in `audit/2026-10-19-01-system-and-data-flow.md` §10
and `audit/2026-10-19-00-index-and-method.md` §0.4.

---

### B. 3A. A second wave — from the security, reliability and performance pass

These arrived from a deeper read of `electron/`, the retry layer, the notebook's write path and
the render path. They are **independent of §1–§3** and they are the cheapest high-value items in
the whole report.

#### E-21 — Close the CSP's unused remote origins *(the cheapest security win in this report)*

| | |
|---|---|
| **Problem** | `index.html:21-22` is the **only** CSP — there is no header, and the `app://` handler cannot add one (it returns `net.fetch(file://)` verbatim). It allows `https://s3.tradingview.com` in `script-src` and `https://s3.tradingview.com` / `https://www.tradingview.com` / `https://tradingview.com` in `frame-src` and `img-src`. **But the code does not use the widget**: `components/trade/TradingChart.tsx:4` says *"Deliberately NOT the embed widget: an iframe from s.tradingview.com is…"*, and `components/market/LiveMarket.tsx:6` says it runs its **own** WS/REST transport. **And the CSP's own comment says the opposite** — `index.html:14-15` *"plus the TradingView widget loader (Live Market / Trade chart)"*, `:19` *"frame-src: TradingView's chart iframe"*. |
| **Proposed change** | Remove the three TradingView origins from `script-src`, `frame-src` and `img-src`, and fix the comment. **Zero functional cost** — nothing imports or embeds them. |
| **Impact** | **Security** — it closes the **only remote-script hole** in the app, and it makes `PRIVACY.md:89-94`'s *"no third-party scripts"* claim **literally true** rather than merely behaviourally true. |
| **Effort** | **S** (one file, three lines) |
| **Risk** | **S** — but **verify**: `npm run build && npm run boot-probe` (the production bundle is the only place the CSP applies) and a visual check of the chart and the Live Market surface. |
| **How to verify** | A test asserting `script-src` contains no `unsafe-inline`/`unsafe-eval` and **no third-party origin**, and that `frame-src` contains **no** third-party origin. **That test would have caught this automatically** — and it is also the test `electron/main.cjs` has never had. |
| **Roadmap** | **NEW** — nothing in the corpus mentions the CSP's contents. `R-247`/`R-248` cover the *other* deferred security items (no logger, no key pool, SQLCipher off). |

#### E-22 — Stop swallowing the backup and the pattern-memory failures

| | |
|---|---|
| **Problem** | Two silent data-loss swallows. (a) `App.tsx:2000` — `void createBackup(activeUsernameRef.current).catch(() => {})`. A failed **auto-backup** (`services/infrastructure/BackupService.ts:34`, every 30 minutes, `:644-649`) produces **no signal at all**; the trader believes they have a backup cadence and learns the truth only when they need it. (b) `hooks/useTradeJournalActions.ts:93, 135, 379` — `void syncPatternMemory(null, …).catch(() => {})`, three call sites where the pattern-memory synthesis is silently lost. |
| **Evidence** | as left; the **pattern to follow already exists in the repo**: `MemoryFilesService.persist` records the failure, **rethrows** so no caller's handling changes, and clears on the next success — and `getNotebookWriteFailure()` is the one place that knows a write never reached disk, read by `memoryHealth` and by `App.tsx:28`. |
| **Proposed change** | Surface both. The backup failure belongs in the same place the notebook's failure is surfaced (the Health tab); the pattern-memory failure belongs in the Learn surface's inbox. **Neither needs a new store** — both already have somewhere to go. |
| **Impact** | **Reliability** — a silent backup failure is the worst kind, because the trader's false confidence is unbounded. **Accuracy** (a lost pattern-memory synthesis is a lost learning event). |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | Force a backup failure (a read-only profile) and confirm the Health tab shows it. The pattern-memory case: a rejected promise in a unit test and assert the signal. |
| **Roadmap** | **NEW** — `AGENTS.md` documents the notebook's rule as *"Never add a swallow-and-continue around a notebook write"*; **the missing part, named: the rule is not written for the two other writes.** |

#### E-23 — The notebook needs a recovery affordance, and its hard cap does not work

| | |
|---|---|
| **Problem** | (a) The notebook is **one replace-in-place blob** (`services/learning/MemoryFilesService.ts:250`) with **no version, no checksum and no recovery affordance**. A corrupt blob serves an **empty notebook** with only a `console.warn` (`:173`) — the trader's entire thinking, unrecoverable. (b) **`notebookPressureAllows('appends')` and `('all')` are dead branches**: `:443-448` defines three kinds, but the only call site (`:690`) passes `'newFiles'`. **At the hard cap the notebook still accepts appends and updates** — and `utils/memoryBudget.ts:40-43` ("appends still land") contradicts the module's own doc at `:439-442` (*"`all` refuses every model write"*). |
| **Proposed change** | (a) A `.corrupt.<timestamp>` sidecar written when the blob fails to parse, plus a version field and a checksum — **and a restore path in Settings → Data**. That converts an unrecoverable-looking loss into a recoverable one. (b) Decide whether the hard cap is meant to refuse appends. If yes, pass the right kind at the call site and add a test. If no, change the doc. **Do not leave the code and the doc disagreeing** — this is the repo's own *"reader without a writer"* pattern, now in the docs. |
| **Impact** | **Reliability** (the trader's own notes are the one thing the app cannot regenerate) · **Accuracy** (the hard cap is the app's promise that the notebook never grows without bound) |
| **Effort** | **M** |
| **Risk** | **M** for (a) — the sidecar must never become a second source of truth. **S** for (b). |
| **How to verify** | A test that writes a corrupt blob and asserts a sidecar exists and the app reports it; a test that at the hard cap an append is refused. |
| **Roadmap** | **PARTIAL** — `G-31` records the doctrine slot as *"an unaccounted always-on layer"* and `R-233` records the same for the budget. **The missing part, named: no item covers the notebook's *corruption* path, and no item covers the two dead pressure branches.** |

#### E-24 — Give `electron/main.cjs` behavioural coverage

| | |
|---|---|
| **Problem** | **The largest untested surface in the app.** `electron/main.cjs` is 1,362 lines and has **zero** behavioural coverage. `tests/electronIpcContract.test.ts` is **pure string analysis** (`:26-37` `readFileSync` + regex); `tests/providerRequestPolicy.test.ts:263-274` asserts the file *contains the string* `require(...)`; `tests/reasoningSideChannelParity.test.ts:17` and `tests/desktopUsageBridge.test.ts:19` read it **as text**. `tests/sseParser.test.ts` is the **only** file that executes electron code. **The `app://` traversal check, the navigation rules, the permission-denial handler, the `safeStorage` round-trip, the `provider:chat` body construction and the degrade chain are all untested at runtime.** The file is outside `tsc` (`tsconfig.json:31`) and outside coverage (`vitest.config.ts:91`); the only gate is `node --check`, which **parses and proves nothing**. |
| **Proposed change** | Extract the *pure* parts of `main.cjs` into testable modules — the `app://` path resolver, the navigation decision, the permission decision, the `provider:chat` body builder — and unit-test them. `electron/sseParser.cjs` already shows the pattern works: it is a `.cjs` file that `tests/sseParser.test.ts` **imports** (and `allowJs` is on). |
| **Impact** | **Reliability** (the desktop shell is what the user launches) · **Security** (the traversal check and the navigation rules are the app's trust boundary) · **Maintainability** |
| **Effort** | **M** |
| **Risk** | **S** — extraction only, no behaviour change. |
| **How to verify** | The new tests fail when the corresponding guard is removed. |
| **Roadmap** | **NEW** — `AGENTS.md:65-122` names the *type-check* gap in the Electron shell honestly; **the missing part, named: it names the type-check gap, not the behavioural-coverage gap.** The two are different, and the second one is bigger. |

#### E-25 — Take the root out of the streaming hot path

| | |
|---|---|
| **Problem** | `App.tsx` (2,672 lines) subscribes to `chatStore` through `useSyncExternalStore` (`App.tsx:2`), and `hooks/analysisPipeline/streamThrottlers.ts:72` throttles the deltas to one update **per frame** — so a **2,672-line root re-renders at 60 Hz** for the whole length of a streamed answer. The leaves are memo'd, but the root is in the hot path. |
| **Proposed change** | A memo'd transcript component that subscribes to the store **directly**, so the streaming updates stop at the transcript instead of at the root. The root keeps the coarse state it needs. |
| **Impact** | **Speed** — the app's feel while an answer streams, on the surface the trader spends the most time on. |
| **Effort** | **M** |
| **Risk** | **M** — it is a state-ownership change, and `AGENTS.md` documents that *"writing a ref during render is a load-bearing idiom here"*. Measure before and after. |
| **How to verify** | React DevTools: the **root's** commit count during a 30-second stream, before and after. **[Unverified — needs a profiler run]** the current number. |
| **Roadmap** | **NEW** — `G-17` covers `App.tsx`'s *size*; nothing covers its *render behaviour*. |

#### E-26 — One ticker, not 400

| | |
|---|---|
| **Problem** | `components/shared/AnalyzedRow.tsx:58` and `components/shared/ReasoningRow.tsx:90` each run **their own** `setInterval` **per row** — so a 200-message conversation holds **up to 400 live intervals**, each re-rendering its own row. Separately, `components/trade/TradeView.tsx:666` ticks a 1-second clock that re-renders the whole trade surface. |
| **Proposed change** | One shared ticker, subscribed to by the rows that need it. Move the trade-surface clock into the leaf that renders the time. |
| **Impact** | **Speed** · **Reliability** (400 timers is 400 chances for a leaked handle) |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | The interval count in a 200-message conversation, before and after. `npm run render-probe` for the visual check. |
| **Roadmap** | **NEW** — see Report 2 §E-16 for the clock half; this is the row half. |

#### E-27 — `getPreferenceObject` must not conflate "missing" with "corrupt"

| | |
|---|---|
| **Problem** | `services/infrastructure/PreferencesService.ts:109-117` returns `null` for a missing key **and** for an unparseable one. **Any caller that treats `null` as "empty" and writes a default destroys a corrupt-but-recoverable blob.** Only `services/learning/MemoryFilesService.ts:145-176` defends (a raw read, and *"leave the stored blob UNTOUCHED"*). **Every other caller has no guard.** |
| **Proposed change** | A tri-state read: `getPreferenceObject` returns `{present, value}` (or a separate `getPreferenceObjectRaw` that surfaces the parse error), so a caller can distinguish "not set" from "set and broken". Then make the callers that matter (the notebook already does; the calibration and performance stores should) refuse to overwrite a corrupt value. |
| **Impact** | **Reliability** — a corrupt preference is currently an unrecoverable loss, and it is indistinguishable from an empty one. |
| **Effort** | **S–M** |
| **Risk** | **M** — it changes a widely-used return type. An additive variant (`getPreferenceObjectWithState`) is the low-risk shape. |
| **How to verify** | A test that writes a corrupt value and asserts the caller does **not** overwrite it. |
| **Roadmap** | **NEW** — `F-08` in Report 1 (§2.6) is the same family: *"the risky migration is the one-time sweep"*. **The missing part, named: nothing covers the corrupt-value path.** |

#### E-28 — Validate the sender frame on every IPC handler

| | |
|---|---|
| **Problem** | **Not one of the 11 IPC handlers validates `event.senderFrame`.** Practical exposure today is low (one window, a local origin, `will-navigate` blocks off-origin navigation) — **but it matters precisely because E-21 leaves a remote iframe origin permitted in the CSP.** |
| **Proposed change** | A one-line guard per handler: `if (event.senderFrame !== mainWindow.webContents.mainFrame) return;`. A shared wrapper is better than eleven copies. |
| **Impact** | **Security** — defence in depth for the app's only privileged surface. |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | A test that invokes a handler with a foreign sender frame and asserts it is refused. |
| **Roadmap** | **NEW** |

#### E-29 — Re-tighten the lint ratchet with **no code change at all**

| | |
|---|---|
| **Problem** | `eslint.config.js:111-113` says the cap *"must EQUAL the warning count on a clean main, because the cap is only a ratchet if it actually binds."* **It does not bind**: the cap is 889 and the measured count is **682** — **207 warnings of slack (23.3 %)**, so a new warning cannot fail CI. |
| **The cheap half** | **8 of the 682 are "unused eslint-disable directive"** (4 `no-console`, 3 `no-explicit-any`, 1 `no-useless-assignment`). **Delete those 8 directives → 674.** Then set `--max-warnings 674`. **Re-tightening the ratchet needs no code change at all** — the 449 `any` and 225 `no-unused-vars` are the real backlog, but they do not have to be paid down before the cap binds again. |
| **The breakdown** | 449 `no-explicit-any` (65.8 %) · 225 `no-unused-vars` (33.0 %) · 8 unused disable directives (1.2 %) · **0 errors**. |
| **Also** | **`App.tsx` is now `any`-free** — all 449 are elsewhere. And `eslint.config.js:124`'s *"28 unused LOCAL declarations remain there"* is **stale: it is 13** (across 11 statements, plus 5 unused imports). Fix the number in the same commit. |
| **Impact** | **Reliability** (the gate starts catching regressions) · **Maintainability** |
| **Effort** | **S** |
| **Risk** | **S** — the 8 deletions are dead directives; the cap change is one line. **Never raise the cap to go green** (`eslint.config.js:131-132`). |
| **How to verify** | `npm run lint:loose` on a clean checkout → expect 674; `npm run lint` → expect 0. |
| **Roadmap** | **NEW** — see Report 2 §E-06 for the same item seen as a bundle-size ratchet. The mechanism to copy is the repo's own (`R-222` shipped the anchor gate; `R-243` shipped its ratcheting floors). |

#### 3A-rank — the second wave, ranked

| rank | id | what | impact | effort | roadmap |
|---|---|---|---|---|---|
| 1 | **E-21** | Close the CSP's unused remote origins | security | **S** | NEW |
| 2 | **E-22** | Stop swallowing the backup and pattern-memory failures | reliability | **S** | NEW |
| 3 | **E-29** | Re-tighten the lint ratchet (delete 8 dead directives → 674) | reliability | **S** | NEW |
| 4 | **E-26** | One ticker, not 400 | speed | **S** | NEW |
| 5 | **E-28** | Validate the sender frame on every IPC handler | security | **S** | NEW |
| 6 | **E-23** | Notebook recovery affordance + the two dead pressure branches | reliability | **M** | PARTIAL (G-31) |
| 7 | **E-24** | Give `electron/main.cjs` behavioural coverage | reliability · security | **M** | NEW |
| 8 | **E-27** | `getPreferenceObject`: missing ≠ corrupt | reliability | **S–M** | NEW |
| 9 | **E-25** | Take the root out of the streaming hot path | speed | **M** | NEW |

---

### B. 3B. The five Part B areas the first draft under-covered

An honest self-audit against the brief's list found five required areas that the first draft of
this report covered only implicitly, or not at all. They are added here rather than left implicit.
Each is a real finding with evidence, not a placeholder.

#### E-30 — Tool design: the fixed schema tax is larger than most of the app's prompts

| | |
|---|---|
| **Problem** | Every request carries the **full JSON schema of every tool the surface offers** — and the surface's tool list is long. **The fixed schema tax per request is 31,455 chars ≈ 7,864 tokens on the dock** and **25,535 ≈ 6,384 tokens on the chat surface and the automation**. For comparison, the dock's entire mandate — `TRADE_CHAT_SYSTEM_PROMPT` — is 4,299 chars ≈ 1,075 tokens. **The tool schemas cost roughly seven times the prompt that tells the model what kind of assistant to be.** That is before a single token of the trader's question, the retrieved context, or the market packet. |
| **Evidence** | **[Verified live, measured]** the tool-definition arrays in `services/analysis/DeskToolsService.ts` (defs at `:820`): 31 core + 8 chart = 39 static tools, plus 2 mailbox and an unbounded forged set. Schema chars per tool are in Report 1 §5.1–§5.2; the per-surface totals are the sums. |
| **The compounding problem** | The chat surface is offered **30 of the 31 core tools** — including `get_indicators` (1,660 schema chars), `run_monte_carlo` (1,921), `get_all_timeframes` (649), `get_market_packet` (629) — and is offered **only one** of the 8 chart tools. `get_chart_view` (686 chars) is **withheld from the chat surface** — so the model pays for a tool it does not have, and is told to use it (the C-2 contradiction in Report 1 §3.6). **And `ARBITER_ALLOWED_TOOLS` (9 tools) is dead**, so 9 more definitions are maintained for nothing. |
| **Proposed change** | **Split the tool list by *need*, not by surface.** The chat surface should not carry `run_monte_carlo` (1,921 chars) or `get_all_timeframes` (649) if a scheduler or the dock can do them. **Better: publish a short index of the tools and let the model request the schema** — the app already has a tool for reading a prior result (`read_tool_output`), so the pattern exists. **Cheapest first step: remove `get_chart_view` from `DESK_TOOLS_PROMPT`'s text on the surfaces that do not have it** (C-2), and delete `ARBITER_ALLOWED_TOOLS`. |
| **Impact** | **Cost** (this is the largest single line item in a request) · **Speed** (fewer tokens to parse per round, and the whole array is re-sent each round — Report 1 §5.6) · **Accuracy** (C-2: the model is told to call a tool its allow-list refuses) |
| **Effort** | **M** |
| **Risk** | **M** — removing a tool from a surface changes what the model can do. The surfaces differ in what they are *for*, so this needs a per-surface decision, not a global cut. |
| **How to verify** | Measure the tokens-per-request before and after; check the tool-call *success* rate per surface (a refused call is visible in the transcript). The `skill-approval-probe` asserts the notebook bytes after a real click, so it will catch a tool that stops working. |
| **Roadmap** | **NEW** — nothing in the corpus discusses the schema tax. `R-107` (five new `render-probe` assertions) is adjacent but is about a11y. |

#### E-31 — Observability: the app logs to `console` and has one log sink

| | |
|---|---|
| **Problem** | The repository has **~740 `console.*` calls** and **no logger**. There is **no packaged-Electron log sink** — so when the packaged app fails, there is nowhere for the failure to go. The gap is small and named in the corpus: *"no logger, no key pool, SQLCipher off"* is the surviving home of three deferrals from a deleted plan. |
| **Evidence** | **[Verified by code reading]** `console.*` is everywhere; `eslint.config.js:136` has `no-console: 'off'` — *"App uses console extensively; migrate to logger incrementally"* — and that is the **one rule that would have caught the class in §11.3** (the silent backup failure). `services/analysis/DeskToolsService.ts` logs a *harness-authored* line on every cache replay. There **is** a diagnostics surface (`components/settings/DiagnosticsPanel.tsx`, reading `lastPromiseError` / `lastGlobalError` / `lastCrashError`) — but it only sees **three** breadcrumbs. |
| **The gap that matters** | **Four** things the app already knows and never surfaces: (a) a failed **auto-backup** (`App.tsx:2000`); (b) a failed **pattern-memory synthesis** (3 sites); (c) a **corrupt notebook blob** (a `console.warn` at `MemoryFilesService.ts:173`); (d) a **truncated answer** — the truncation tally has no reader (Report 2 §E-13). All four are exactly the kind of thing a trader's "it just didn't work" report is about. |
| **Proposed change** | **Not a logger rewrite** — the corpus's own wording is *"not a rewrite"*, and that is right. A **single `utils/diagnostics.ts`** with a ring buffer of the last 100 structured events, one `report(event)` call, and one place that renders it. The four silent events above become `report()` calls. The packaged Electron shell writes the ring buffer to `userData/logs/app.log` on quit (a ~30-line addition to `main.cjs`). |
| **Impact** | **Reliability** (four failure modes become visible) · **Maintainability** (one place to look) · **UX** (the trader can see "the last backup failed") |
| **Effort** | **M** |
| **Risk** | **S** — a ring buffer in memory plus one file on disk. **Do not** log anything that contains a prompt, a key, a position or a query (Report 1 §11.2: the provider error paths already sanitise, and that discipline must carry into the new sink). |
| **How to verify** | Force each of the four failures and see it in the panel. `npm run typecheck && npm run test && npm run render-probe`. |
| **Roadmap** | **PARTIAL** — `G-14` / `R-247` name the missing logger and the missing packaged log sink, and are explicitly *"deferred … not a rewrite"*. **The missing part, named: no item names the four *specific* silent failures, which is the part that does not need a logger at all — it needs a `report()` call.** |

#### E-32 — Developer experience: the gate scripts have no type checking and the alias config is dead

| | |
|---|---|
| **Problem** | (a) **`scripts/` is excluded from `tsconfig.json`**, and `tsconfig.scripts.json` includes `scripts/**/*.ts` — **which is exactly one file** (`scripts/test-candle-history.ts`). So **~6,200 lines of `.cjs` gate logic get no type checking.** `guards.yml` compensates with `node --check` (syntax only) and a separate narrow lint config — which is why `scripts/render-probe.cjs` is **138 KB**, larger than `App.tsx`, and `scripts/check-flow-doc-anchors.cjs` is **58 KB**. (b) **`tsconfig.json`'s `paths` (`:18-22`) is declared and never used** — dead config. (c) `forceConsistentCasingInFileNames` is off, and `ProviderConfigService.ts:10` imports `'../../shared/providerRequestPolicy.cjs'`, which resolves **only on a case-insensitive filesystem** — a latent portability break on a Windows-only target. (d) `AGENTS.md:124`'s *"28 unused LOCAL declarations remain there [in `App.tsx`]"* is **stale — it is 13.** |
| **Evidence** | **[Verified by code reading + measured]** `tsconfig.json:18-22`, `:31-32`; `tsconfig.scripts.json`; `scripts/` file sizes; `npx eslint App.tsx -f json` → 18 messages, of which 5 are unused **imports** and **13** are unused **local** declarations across 11 statements; `ProviderConfigService.ts:10`. |
| **Proposed change** | (a) Either add `allowJs: true` + `checkJs` for `scripts/**` to a second tsconfig, **or** accept the situation deliberately and say so in `AGENTS.md` — the current half-measure (a `typecheck:scripts` script that checks one file) is the worst of the three options, because it *looks* covered. (b) Delete the dead `paths` block, or point it at the alias the code actually uses (`vite.config.ts:447-449` defines `@`; `tsconfig.json` does not). (c) Turn on `forceConsistentCasingInFileNames` — it will flag the `.cjs` import, and that import should be fixed to the exact case anyway. (d) Fix the number in `AGENTS.md`. |
| **Impact** | **Maintainability** · **Reliability** (the gate scripts are the gates; a syntax-valid but wrong selector is the `surface-census.cjs` defect in `R-052`) |
| **Effort** | **S** for (b), (c) and (d); **M** for (a) |
| **Risk** | **M** for (c) — it may flag more than one import; **S** for the rest. |
| **How to verify** | `npm run typecheck` and `npm run typecheck:scripts` after each change; the workflows' shell check for (a). |
| **Roadmap** | **PARTIAL** — `R-052` names the `surface-census.cjs` selector defect and `R-058` names the stale probe assertion. **The missing part, named: no item covers the *type-checking gap* in `scripts/`, the dead `paths` block, or the casing portability risk.** |

#### E-33 — Signal quality: the prompt promises a fresh packet, and the code sometimes cannot deliver one

| | |
|---|---|
| **Problem** | The dock's prompt states: *"every message arrives with a **fresh** packet"*. The code delivers a **cached** one — `services/trade/tradeChatContext.ts:83` has an 8-second cache — and, on a failed fetch, substitutes the literal string **"packet unavailable"**. So the model is told *"fresh"*, is given up-to-8-seconds-old data, and is given **no signal at all** that the data is missing or stale. Meanwhile the prompt's own contract (`constants/prompts/analysisPrompts.ts:94`) says *"Missing data is 'Unavailable' — never invent a price"* — and that rule reaches the model only on the **skill-eval** path (Report 1 §3.3 #1), never on the dock. |
| **Evidence** | **[Verified by code reading]** `services/trade/tradeChatContext.ts:83` (the substitution), `:168` (the "fresh" claim), `constants/prompts/analysisPrompts.ts:94` (the rule), and Report 1 §3.7 (the "Missing data is Unavailable" row, enforced via `dataUnavailable()` — but **except** `services/analysis/HybridIntelligenceService.ts:892`, which emits the prefix **without** the helper, so the line lacks the "treat this as UNKNOWN" guidance). |
| **Why it matters for a trader** | A stale or missing packet is the difference between a plan and a guess. The app has a *correct* convention for this — `utils/harnessMarks.ts`'s `DATA_UNAVAILABLE` sentinel, with a legend, and a test that fails on a hand-written marker. **The market packet is the one place the app does not use its own convention.** |
| **Proposed change** | Make the packet's freshness and availability **part of the prompt, using the app's own sentinel**: if the packet came from the cache, say so and say how old it is; if the fetch failed, emit `dataUnavailable()` instead of the bare string "packet unavailable". **And fix `HybridIntelligenceService.ts:892` to use the helper** — it is a one-line change and it is the one place the convention is bypassed. |
| **Impact** | **Accuracy** (the model is told the truth about its data) · **Reliability** (one convention, not two) · **UX** (the trader can see a stale packet) |
| **Effort** | **S–M** |
| **Risk** | **M** — it changes what the model sees on every turn. Measure the token cost of the extra marker (it is one line) and check the `harnessMarks` tests. |
| **How to verify** | A test that a failed packet fetch produces a `DATA_UNAVAILABLE:` line **and** that the legend matches it. `npm run skill-approval-probe` (it asserts the notebook bytes after a real click, so it exercises a real turn). |
| **Roadmap** | **PARTIAL** — `R-107` and `R-071` are about the *visible* consequences (the muted ladder, the silent truncation); `AGENTS.md` documents the `harnessMarks` convention. **The missing part, named: no item covers the market packet's own freshness/availability contract, which is the one place the app's own sentinel convention is bypassed.** |

#### E-34 — "Signal quality" in the other sense: the *indicator* tools and the *decision* tools disagree about what a number means

| | |
|---|---|
| **Problem** | The app has **two different notions of "the R:R of this plan"** and **two different notions of "similar"** (Report 4 §2.4 and §2.5). The trader's *signal* — the indicator output, the pattern score, the confluence, the regime — is produced by deterministic code with **at least three overlapping scorers** and is then **graded by a formula that does not match the one the card shows**. So the number the model reasons over and the number the trader sees can differ, and the number that decides a confidence downgrade is neither. |
| **Evidence** | **[Verified by code reading]** the planned-R:R family: `utils/riskReward.ts:48` (canonical, nearest target) · `services/validation/AccuracyValidationService.ts:196` (index-0, the gate's authority) · `services/analysis/ScalpDetectionService.ts:178`, `:236` (index-0, the same gate run) · `services/trade/chartDrawings.ts:608-615` (a fourth copy, outside `riskReward.ts`) · `services/learning/PatternMemorySynthesisService.ts:260-268` (index-0 again). The similarity family: **seven** implementations, `AGENTS.md:216-221` naming only two. |
| **Proposed change** | One **scoring contract** the whole app reads: `utils/riskReward.ts` owns the planned ratio; a single `utils/similarity.ts` owns the pattern score with a named scale; the gate, the card, the clamp, the drawings label and the pattern synthesis all call them. **Note the direction of travel: this is E-02 and E-19, applied to the *signal* rather than to the plan.** |
| **Impact** | **Accuracy** (one number, one meaning) · **Profit** (the grade and the size follow the number the trader sees) · **Maintainability** |
| **Effort** | **L** (it is E-02 and E-19 with the scorers included) |
| **Risk** | **M** — the scorers are not interchangeable (Report 4 §2.5: text-vs-text, setup-vs-trade and content-word overlap are three different questions). **Consolidate the two live setup-vs-trade scorers (`PatternMemorySynthesisService.calculateSimilarity` and `LiveBacktestService.calculateSimilarity`) last, and separately.** |
| **How to verify** | The replay harness (E-20) is the instrument: re-grade the stored trades and diff. |
| **Roadmap** | **NEW** — `R-235` ("Decide what a rule is, once") and `G-29`/`G-30` touch the *skill* model, not the *scoring* model. **The missing part, named: no item names the scoring duplication.** |

#### 3B-rank

| rank | id | what | impact | effort | roadmap |
|---|---|---|---|---|---|
| 1 | **E-31** | Observability: one `report()` sink, four silent failures surfaced | reliability | **M** | PARTIAL (G-14) |
| 2 | **E-33** | Signal freshness and availability, using the app's own sentinel | accuracy | **S–M** | PARTIAL (R-071) |
| 3 | **E-30** | Tool design: cut the fixed schema tax | cost · speed | **M** | NEW |
| 4 | **E-32** | Developer experience: the `scripts/` type-check gap, the dead `paths`, the casing risk | maintainability | **S–M** | PARTIAL (R-052) |
| 5 | **E-34** | One scoring contract for the signal | accuracy · profit | **L** | NEW |

#### 3B-coverage — the brief's Part B list, now complete

| the brief's area | where it is now |
|---|---|
| signal and plan quality | **E-33**, **E-34** (signal) · **E-02**, **E-19** (plan) |
| gates and refusals | **E-02** · Report 1 §4.2 and §1.5 (the gate that may not be wired) |
| risk and cost modeling | **E-03** (cost) · **E-12** (risk/size) · **E-02** (the R:R) |
| prompt and context efficiency | **E-01**, **E-05**, **E-08**, **E-09** · Report 1 §3.10 and §5.6 (the measured sizes) |
| memory and skills | **E-05**, **E-23** · Report 1 §2.4 (the retention ladder) |
| learning loops | **E-05**, **E-18** |
| evaluation and replay | **E-20** (replay) · Report 1 §3.2 (the skill A/B evaluator — the closest existing machinery) |
| tool design | **E-30** |
| error handling | **E-22** (the silent swallows) · **E-27** (missing ≠ corrupt) · Report 1 §11.4 (the retry layer) |
| performance | **E-16**, **E-25**, **E-26** |
| **observability** | **E-31** |
| testing | **E-11**, **E-24** · **E-29** (the ratchet) |
| **developer experience** | **E-32** · **E-07** (`noUnusedLocals`) |

---

### B. 3C. Cross-check against the previous audit, and the items it found that I missed

**The user's question — "does the current plan contradict `docs/analysis/06-independent-review-2026-10-18.md`?" — is answered in Report 5 §7, with the full item-by-item mapping.** This section carries the *new* material: the findings the previous review had that my first draft did not, and the one place where I now **defer to it**.

**Source:** the orphan commit `508b691a`, `docs/analysis/06-independent-review-2026-10-18.md`
(58,715 B, 910 lines) — an independent trading review authored 2026-10-18 against a tree 162
commits before my pin. **Every claim below was re-verified at the current HEAD (`69c4aa33`).**

#### 3C.1 The one I defer to: a **third option** for the context decision

Their **QW5** and their **M1** are the same item as my **E-01** — *"Decide the context policy —
inject or delete"*. We agree on the decision; we differ on the **default**, and **they are right
about a third option that I did not name**:

- **My default:** cut the assembly first, then re-add deliberately.
- **Their QW5:** *put the trading contract back in the live prompt* — `HARNESS_CONTRACT_PROMPT`
  (1,582 chars) composed into the Chat-surface and dock system prompts through
  `utils/composePrompt.ts`, which already dedupes the contract.

**The third option is better than both of ours, and it is cheap.** The harness contract carries the
**confidence ladder**, the **marker convention** (`HARNESS_TURN_MARK` — the only text that tells a
seat which words are the app's and which are the trader's) and the **risk rules**. The expensive
part of `enhancedPrompt` is the *retrieved context*, not the contract. So:

> **E-01 is refined into two decisions, not one.**
> **(a) Inject the CONTRACT** (1,582 chars) into the P1/P2/P3 system prompts — **S effort**, and it
> closes the C-5 contradiction (the mark is used in the user role on every desk turn and explained
> nowhere) and gives the model a ladder and a "no trade is a decision" instruction.
> **(b) Decide the REST of the context separately** — the retrieved notebook, the matched skill
> body, the similar setups, the reflections, the hybrid packet — and **cut it by default**, because
> the pull path (`recall`, `get_notebook_map`, `read_memory`) already exists and the push path's
> budget was never settled.

**And the change is what makes the ledger honest:** inject **and** record, or record only what was
injected. Never one without the other.

#### E-35 — The finding I missed that is the sharpest in either audit: **the deterministic skill layer is computed and thrown away** (§3C.2)

| | |
|---|---|
| **Problem** | `applyNotebookSkillsToAnalysis` (`services/learning/SkillMemoryService.ts:3494`) is the function that applies the **hard `avoid` veto**, the **candidate cap** and the **confidence downgrade** — the entire deterministic half of the skill system. **It has no production caller.** Its telemetry helper `recordEnforcement` is dead with it. Separately, `services/learning/skillPredicateGate.ts:200` computes `ceilings` from the fired `avoid` skills and returns `ceiling?: number` (`:78`) — **and the consumer discards it**, because `predicateGate` is one of the seven blocks folded into the never-sent `enhancedPrompt` (F-01). |
| **Evidence** | **[Verified at HEAD `69c4aa33`]** `git grep applyNotebookSkillsToAnalysis` returns: the **definition** (`:3494`), three **comments** (`SkillMemoryService.ts:793`, `services/validation/TradeValidationGate.ts:876`, `utils/harnessSettings.ts:39`) — and **every actual call site is in `tests/`** (`tests/approvalGate.test.ts:110,123`, `tests/decisionBiasClosure.test.ts:297,310`, `tests/harnessMemory.test.ts:384,419,485,491,500,534,571`, `tests/learningLoopMachinery.test.ts:758,765,772`). **Zero production callers.** `git grep recordVeto` returns the definition (`services/ui/VetoLedgerService.ts:90`), a comment (`:9`), an internal catch (`:160`) — and **seven test call sites** (`tests/decisionBiasClosure.test.ts:318`, `tests/learningLoopMachinery.test.ts:200-336`). **Zero production callers.** |
| **Why it matters** | The app's whole thesis is *"the agent proposes, **deterministic code checks**, the user decides."* **The deterministic check is not connected.** The learner's hard veto — the thing that makes a skill the trader's own rule rather than a suggestion — is computed and dropped. And `VetoLedgerService`'s ledger, which the Health tab and `memoryHygiene` **read**, is never **written**. |
| **Proposed change** | **Wire `applyNotebookSkillsToAnalysis` into the plan path** (`services/trade/presentTradeTool.ts` / `buildProposedTradeAnalysis`), and pass the `predicateGate.ceiling` into the recorded probability with a `validationWarnings` note naming the skill. **And write the veto** when the veto fires — `VetoLedgerService.recordVeto` already exists and already has the right shape. **Do NOT re-enable the hard veto until E-37 raises the sample floor.** |
| **Impact** | **Accuracy** (the trader's own rules start binding) · **Reliability** (a read-but-never-written ledger is a lie on the Health tab) · **Maintainability** (a function with 10 test call sites and 0 production ones is the clearest "green suite over dead code" case in the repo) |
| **Effort** | **S–M** |
| **Risk** | **M** — a wrong predicate can suppress a good trade. That is exactly why E-37 must land first. |
| **How to verify** | A test that a fired `avoid` predicate at ceiling 0.40 caps a 72 % plan to 40 % **and stamps the reason**; a retired or zero-sample skill does not. And that the veto ledger's write count is non-zero after a vetoed plan. |
| **Roadmap** | **NEW** — no roadmap item names the enforcement disconnection. The closest is `R-151` (*"nothing checks `approvedBy` or `whyAccepted` at injection time"*) — **the missing part, named: that is the approval gate, not the enforcement path, and neither one has a caller.** |

#### E-37 — The evidence floors are too low for the outcomes that are about to arrive (§3C.3)

| | |
|---|---|
| **Problem** | The learning system's sample floors are tuned for a world where there are no outcomes. `MIN_SAMPLE_FOR_VETO = 2` (`services/learning/SkillMemoryService.ts:385`) — **a two-trade sample can veto a real setup**, and a veto can *zero* it. `MIN_CLUSTER_FOR_SKILL = 3` (`:358`) — a three-trade cluster can mint a skill. `MIN_SAMPLE_CONFIRMED = 5` (`:359`). |
| **Evidence** | **[Verified at HEAD]** `services/learning/SkillMemoryService.ts:358, 359, 385`. |
| **Why it matters** | **This is a sequencing dependency, and it is the one that bites.** The moment the outcome loop is fixed (E-18), these floors start producing confident, wrong conclusions *from the data they have*. Fixing the outcome loop **without** raising the floors manufactures noise. |
| **Proposed change** | Raise them **before** the outcomes arrive, in this order: `MIN_SAMPLE_FOR_VETO` 2 → ≥10 (the one that can zero a real setup); then `MIN_CLUSTER_FOR_SKILL` 3 → ≥10 and `MIN_SAMPLE_CONFIRMED` 5 → ≥20. `services/learning/metaCalibration.ts` already proposes this. |
| **Impact** | **Accuracy** · **Profit** (a wrong veto is a lost trade) · **Reliability** |
| **Effort** | **S** |
| **Risk** | **S** — but it needs its existing tests updated deliberately, not incidentally. |
| **How to verify** | The existing suites updated on purpose; then the promotion rate measured over the new settled population. |
| **Roadmap** | **NEW** — no roadmap item names the floors. `R-180` (the 9-item Improve list) is the closest home; **the missing part, named: the floors are not on that list, and they are a hard dependency of E-18.** |

#### E-38 — A presented plan never expires, so the denominator is wrong (§3C.4)

| | |
|---|---|
| **Problem** | `validityDurationMinutes` is declared optional in the schema (`schemas/tradeAnalysis.ts:218`), transformed (`:468`) and **read** by the scalp detector (`services/analysis/ScalpDetectionService.ts:86-87`) — but **no producer ever sets it**. `hooks/useTradeLogging.ts:301` says so in a comment: *"label-only, so no `validityDurationMinutes` appears on a…"*. So a plan that never triggers **vanishes** instead of being recorded as `ENTRY_NOT_HIT`. |
| **Evidence** | **[Verified at HEAD]** the four sites above; no writer. |
| **Why it matters** | **The denominator.** Win rate counts only the setups that reached a level. A setup that never triggered is not a loss and not a win — it is a **skip** — and it is currently invisible. The `TradeOutcome` enum has `ENTRY_NOT_HIT` (`types/enums.ts:9-15`), so the outcome exists; nothing produces it. |
| **Proposed change** | Stamp a default window in `buildProposedTradeAnalysis` — e.g. 24 h for scalp-class, 72 h for swing, derived from `withDetectedTradeType` — and let the autopilot's existing expiry branch (`services/ui/OutcomeAutopilotService.ts:443-456`) write `ENTRY_NOT_HIT` at expiry. |
| **Impact** | **Accuracy** (the denominator becomes honest) · **Profit** (the expectancy stops being overstated) |
| **Effort** | **S** |
| **Risk** | **S** |
| **How to verify** | After E-18, the ratio of `ENTRY_NOT_HIT` to resolved rows is non-zero and stable across two weeks. |
| **Roadmap** | **NEW** — and it is a **prerequisite** for E-18's "net expectancy" claims, which are worthless without it. |

#### E-39 — The most consequential output in the app is produced at the lowest thinking tier (§3C.5)

| | |
|---|---|
| **Problem** | `EFFORT_BY_TASK` (`services/providers/reasoningControls.ts`) is a role→effort schedule: `analysis: 'high'`, `rebuttal: 'high'`, `moderatorVerdict: 'max'`, `clarification: 'low'`, **`chat: 'low'`**, `postMortem: 'medium'`, `supervision: 'medium'`, `ocr: 'low'`. The **Chat surface and the dock** — the paths that can call `present_trade` — resolve through `chat`. **The one output that matters is produced at the lowest tier**, unless the trader manually raises the dial. And the tier the prompt *advertises* is not the tier that is sent: the chat turn asks for temperature 0.4 (`services/trade/chatSurfaceTurn.ts:265`) and automation for 0.3 (`services/trade/automationTurn.ts:198`), but on a thinking-enabled Anthropic model the transport **omits temperature** (`shared/providerRequestPolicy.cjs:180-185`) — the provider default applies. |
| **Evidence** | **[Verified at HEAD]** `services/providers/reasoningControls.ts` (`EFFORT_BY_TASK`), `services/trade/chatSurfaceTurn.ts:266,327` (the pass-through), `services/trade/chatSurfaceTurn.ts:265` and `services/trade/automationTurn.ts:198` (the requested temperature), `shared/providerRequestPolicy.cjs:180-185` (the omission). |
| **Proposed change** | Add a **`tradingDecision` task tier** (`high`; `max` for automation) and use it for any turn that can call `present_trade`. And publish the **effective** temperature per (format × thinking) in one table, asserted by a test — so the setting the trader can see is the setting that is sent. |
| **Impact** | **Accuracy** — the prior review's phrasing is the right one: *"the same model, asked to reason longer, on the one output that matters."* · **Cost** (it will cost more per turn; that is the trade) |
| **Effort** | **S** |
| **Risk** | **S** for the tier; **M** for the cost increase. |
| **How to verify** | A paired A/B on a fixed set of recorded prompts, scoring plan quality against the gate — which needs E-20's replay to store the prompts. |
| **Roadmap** | **NEW** — no roadmap item names the effort tier or the temperature mismatch. |

#### E-40 — The journal's timestamp is the **write** time, so every dashboard measures the wrong thing (§3C.6)

| | |
|---|---|
| **Problem** | `hooks/useTradeLogging.ts:284` writes `timestamp: message.createdAt || new Date().toISOString()` — the **decision** time — and `:307` writes `timestamp: new Date().toISOString()` — the **write** time. The **journal row** uses the write time. For an autopilot row that is when the trader **confirmed**, possibly days after entry. `analysis.createdAt` holds the decision time, but the dashboards group and sort by `timestamp` (`components/dashboards/WinRateDashboard.tsx:117-125`, `EquityCurveDashboard.tsx:34-43`, `LearningDashboard.tsx:106`). |
| **Evidence** | **[Verified at HEAD]** the two writes, and the three dashboard reads. |
| **Why it matters** | **Every hour-of-day, day-of-week and equity-curve analysis is measuring confirmation time, not trading time.** The equity curve can reorder trades. |
| **Proposed change** | Add `decidedAt` (from `analysis.createdAt`) and use it for all time-bucketed analytics; keep `timestamp` as `loggedAt` for provenance. Backfill from the embedded analysis — **the data is already in the row.** |
| **Impact** | **Accuracy** · **Profit** (an equity curve that reorders trades is a wrong equity curve) |
| **Effort** | **S–M** |
| **Risk** | **S** |
| **How to verify** | A unit test with a trade decided Monday and confirmed Friday lands on Monday; the equity-curve order matches the decision order. |
| **Roadmap** | **NEW** |

#### E-41 — The default leverage is 100×, and the liquidation buffer is in the unreachable module (§3C.7)

| | |
|---|---|
| **Problem** | `DEFAULT_LEVERAGE = 100` (`utils/conversationUtils.ts:6`) is the app-wide default. `computeLiquidationBuffer` (`utils/ticketSize.ts:194`) exists and is **in the module with no production caller** (E-12). So the app defaults to 100× and never shows the trader how close the liquidation line is. At 100×, a stop 0.19 % from entry is a ~15.9 % account move at 1R on full notional, and a 1 % adverse wick is a total loss. |
| **Evidence** | **[Verified at HEAD]** `utils/conversationUtils.ts:6` and `:18` (`leverage: DEFAULT_LEVERAGE` — *"Match the app-wide default (useTradeLogging / schema / UI)"*). |
| **Proposed change** | **Two parts.** (a) On the proposal card, show the **liquidation buffer** beside the stop: *"stop is 0.19 % from entry; liquidation is ~1 % away; a 0.8 % wick is total loss"* — `computeLiquidationBuffer` is already written. (b) **The 100× default is a product decision, not a code change** — it should be the trader's setting, defaulted lower, with the buffer warning always visible. |
| **Impact** | **Profit** (a wrong size is the most expensive error a manual trader makes) · **Accuracy** (the trader is not shown the risk) |
| **Effort** | **S** for the warning (it rides on E-12) · **S** for the setting |
| **Risk** | **S** |
| **How to verify** | The card shows the buffer for a fixture plan; a plan whose stop is inside the buffer is flagged. |
| **Roadmap** | **NEW** — the leverage default is not in the corpus. |

#### E-42 — A decline leaves no object — there is no HOLD (§3C.8)

| | |
|---|---|
| **Problem** | `TradeOutcome` has WIN, LOSS, PENDING, ENTRY_NOT_HIT, SKIPPED (`types/enums.ts:9-15`). **There is no NO_TRADE / HOLD.** A model that declines to present a plan leaves **no row, no candidate, no reason** — the only trace is the level-watch's armed list. And there is **no daily or per-candle job** that scans the universe and logs candidates: `run_screener` (`services/trade/screener.ts:110`) walks the top-N universe deterministically but is only called on demand by the tool and the screener panel, and **automations have no symbol field** (`types/automation.ts:34-68`) — the instrument comes from the prompt text. No `shadow`, `candidate` or `daily scan` store exists. |
| **Evidence** | **[Verified by code reading]** the enum, the screener's on-demand-only callers, the automation type. |
| **Why it matters** | **"Are we skipping winners?" is structurally unanswerable today.** That is the largest question a trading app can be asked, and the app cannot answer it because the skip is not a first-class object. |
| **Proposed change** | **Two steps.** (a) **A `decline_trade` tool** — the model calls it with a reason and the levels it rejected. That is the HOLD record, it is **S/M**, and it fits the existing tool architecture (`present_trade`'s sibling). (b) The **shadow log** — one row per candidate, taken and not taken. The prior review's B1 specifies it: symbol, timeframe, decision time, the feature snapshot, regime, prompt+packet hash, model, the parsed signal **including HOLD**, confidence + `probabilitySource`, entry/SL/TP, which gates ran and which refused, and the cost inputs — with a resolver that settles TP/SL/timeout into `pnlR`, `netR`, MAE/MFE and `resolvedAt`, persisted in Preferences with a stated retention rollup (the notebook cannot hold it). **The pieces already exist and must not be rebuilt:** `outcomeEngine.scanTradeOutcome` (the resolver), `passMining.resolvePassOutcome` (already classifies `MISSED_OPPORTUNITY` vs `CORRECT_PASS`), `VetoLedgerService` (settles what a veto would have done: `WOULD_TP`/`WOULD_SL`/`EXPIRED`), `useAutomations` + `services/automation/*` (cron, 15 s tick, catch-up, run history), `screener.ts` (the universe walk). |
| **Impact** | **Accuracy** · **Profit** (threshold tuning and prompt replay become possible) · **Reliability** (the biggest question becomes answerable) |
| **Effort** | **S/M** for (a) · **L** for (b) |
| **Risk** | **M** for (b) — each candidate can be a model call. Make it opt-in, cap candidates per run, estimate tokens before enabling, and fail closed with no ready provider. |
| **How to verify** | For (b): replay one week of settled shadow rows against the live thresholds and check that a changed threshold improves expectancy **out of sample** — walk-forward, never random. |
| **Roadmap** | **NEW** for (a) and (b). `R-119` (the rating store) and `R-120` (the review destinations) are adjacent in shape but not the same. **Note the brief excluded regime routing — and the prior review's own B3 says doing regime routing before the shadow log is *"fitting noise"*, so the exclusion and their sequencing agree.** |

#### E-43 — `minEdge`: refuse a plan whose net expectancy at its own probability is ≤ 0 (§3C.9)

| | |
|---|---|
| **Problem** | The app caps confidence and downgrades tiers, but **nothing refuses a plan on the arithmetic of its own edge**. A plan at 45 % probability with a 1.1 R:R is a *negative* expectancy after fees, and the app will present it. |
| **Evidence** | **[Verified by code reading]** the gate's cap-and-downgrade behaviour (Report 1 §4.2) and the absence of any expectancy test. |
| **Proposed change** | **One inequality, using numbers the app will have after E-03 and E-12**: `netEdge = p × netR_win − (1 − p) × netR_loss`; refuse when `netEdge ≤ 0`. It must be **the trader's threshold**, with the app showing the number it refused on and why. |
| **Impact** | **Profit** — this is the gate that would have caught the prior review's Plan A (**−1.63 R net**) before it was presented. · **Accuracy** |
| **Effort** | **S** (after E-03 and E-12) |
| **Risk** | **M** — a refusal is a lost opportunity if the probability is mis-calibrated. That is why it must be the trader's dial, not the app's. |
| **How to verify** | A fixture plan with a negative `netEdge` is refused with a named reason; a positive one is not. |
| **Roadmap** | **NEW** — no roadmap item proposes an expectancy-based refusal. |

#### 3C.10 The two things the prior review had that I did not, and I am carrying forward

- **A deterministic baseline: "has anyone asked whether the model beats a fixed rule?"** For every
  settled candidate, compute what *"trade every `scan_setups` signal with the same SL/TP"* would
  have returned. **If the deterministic baseline wins, that is the most important thing the app can
  tell its user** — and it is a few lines against the shadow log. **This is a *use* of my E-20
  (the replay harness), and it is the sharpest framing of what replay is for.** Carried forward as
  **E-20's headline use case.**
- **An exit-model label.** The 50/50 blend and the 150 % zone are **unrecorded assumptions**
  (`services/backtesting/outcomeEngine.ts:69-71` blends TP1 and breakeven; the 150 % zone
  `extendedSlPrice` `:119-121` is an unrecorded policy). Store `exitModel: 'blended' | 'single' |
  'breakeven' | 'trail'` on the row, then replay the same signals under hold-to-last-TP,
  breakeven-only and a trailing stop. **"No new predictions, just a different management rule on the
  same entries"** — the cheapest route to a genuine expectancy improvement. **Carried into E-20.**

#### 3C.11 One prior claim that does **not** verify at HEAD

| prior claim | verdict at HEAD `69c4aa33` |
|---|---|
| `constants/prompts/analysisPrompts.ts:299` — *"Family C … Highest win rate (~86 %)"* asserted as fact | **NOT FOUND.** `analysisPrompts.ts` is **190 lines** at HEAD (the citation's line number is past its end), and a search for `win rate`/`winrate` across `constants/prompts/` returns **zero** hits. Either the text was removed with the lens deletion, or the citation was wrong. **The finding is not carried forward.** |

#### 3C.12 The prior review's dead-module list, checked against mine

Their §2.14 list: `utils/ticketSize.ts`, `services/validation/TradeValidationGate.ts`,
`services/validation/ValidationConstants.ts`, `services/analysis/EntryTimingService.ts`,
`services/analysis/ProbabilityEngineService.ts`, `services/analysis/convictionDrift.ts`,
`services/backtesting/BacktestingService.ts`, `services/learning/MemoryConsolidationService.ts`,
`utils/teamRoster.ts`, `utils/navModality.ts`.

**My sweep found 4 orphans** (`AvoidSetupsSection.tsx`, `MemoryConsolidationService.ts`,
`messageDisplayText.ts`, `plugins/GallerySaver.ts`) plus the 63 dead exports and 202 dead `export`
modifiers — **which covers their list as a superset**, except for **four modules my sweep did not
flag** because they are reachable *from a dead module* rather than from nothing:
`EntryTimingService.ts` (imported only by the dead `TradeValidationGate`),
`navModality.ts`, `SessionGuardService.ts` (reads `equityUsd`, and is unreachable) and
`ValidationConstants.ts` (imported only by the dead gate). **Those four are dead-by-transitivity —
a second-order orphan class neither audit had named.** They are added to Report 4 §13.

---

#### E-50 — Remove the tests that only cover code the app never loads — **with a keep-list**

| | |
|---|---|
| **Problem** | A reachability graph over **521 source modules** from the real entry points finds **29 that the app never loads** — and **25 test files exist only to cover them**. Two of the three largest are the product's core promise: **`services/validation/TradeValidationGate.ts` (986 lines, the 20-check gate) has ZERO production callers**, and **`services/backtesting/BacktestingService.ts` (1,414 lines)** is named in a *comment* by `utils/riskReward.ts:7` as the realized-R authority. The third, **`components/analysis/AnalysisProgress.tsx`**, is the **step ladder** — the roadmap says it is "muted"; it is **not mounted at all**. |
| **Proposed change** | **Four batches, and a keep-list that is the important half.**<br>**T1 — the unambiguously dead** (5 test files, 482 lines + 4 modules, 596 lines): `debatePods`, `ProbabilityEngineService` (×2 test files), `incrementalMarkdown`, `seriesPalette`. Delete the test **and** its module in one commit.<br>**T2 — dead-by-decision, HELD** (6 test files + 6 modules): the validation gate, the backtest engine, the step ladder, `EntryTimingService`, `convictionDrift`, `preRead`. **Each waits on the plan deciding that module's fate** — and three of them are the plan's biggest open decisions.<br>**T3 — the 15 mixed files** test live code: keep the file, drop the dead side-import.<br>**T4 — the 849 lines that LOOK useless and are NOT**: `themeContrast.test.ts` (393), `jsxNesting.test.ts` (283), `sourceCodeHelper.test.ts` (96), `aiTrendlinesDrawn.test.ts` (77) are **repo-wide source guards** — the repo's own lint, in test form. They import a *test helper*, which is why they look like orphans. **Never delete them.** |
| **The keep-list** | **`tests/ticketMathTiers.test.ts` (187) stays** — it is the only coverage of `utils/ticketSize.ts`, and **the plan wires that module (E-12)**. Deleting the test before the module ships removes the only proof it works. **`tests/accuracyValidation.test.ts` stays** until the gate's fate is decided. **`tests/financialMath.test.ts` stays** — 5 live subjects, 1 orphan side-reference. |
| **The rule** | **A test and its dead module go together, or neither** — a test that outlives its subject is the "green suite over dead code" defect itself. **Never delete a test to make a number smaller**; the suite's value is its coverage of what *ships*. Before any deletion, confirm the subject has **zero production importers** with a direct `git grep` for the import specifier — not a reachability pointer. |
| **Impact** | **Maintainability** (the suite stops proving things that do not run) · **Speed** (≈1,000 lines of test and ≈2,100 lines of dead module out of the tree) · **Accuracy** — because T2 forces the two biggest dead modules to be *decided* rather than left in limbo |
| **Effort** | **S** for T1 and T3 · **M** for T2 (it is a decision, not a deletion) |
| **Risk** | **LOW** for T1/T3 · **MEDIUM** for T2 — three of the six are decisions, and two of them are the product's promise |
| **How to verify** | `npm run typecheck && npm run lint && npm run test && npm run test:coverage`. The coverage ratchet (36/28/36/30) must stay satisfied **after** the deletions — removing 1,000 lines of tests can move it. |
| **Roadmap** | **NEW** — and it is **the last, and the largest, piece of the cleanup**: Report 4 §15 has the full per-file table, the batches, the keep-list and the four rules. |

### B. 3D. The three new features, as proposals

**Added 2026-10-20** at the owner's request. The deep dives that justify them are in Report 1
§12. These are the proposals those dives produced.

#### E-45 — The Chat surface's run gets per-session ownership, and a conversation switch stops killing it

| | |
|---|---|
| **Problem** | The dock's run survives a surface switch because its state is hoisted into `services/trade/chatStore.ts` and its controller is per-session (`chatStore.beginRun` at `services/trade/chatTurnRunner.ts:850,1153,1196`). **The Chat surface's run does not** — it is owned by one module-level `analysisAbortController` (`hooks/useAnalysisPipeline.ts:327`), and the effect at `:351-367` aborts it on **any** `activeConversationId` change. Yet `:691-693` already binds every async write to the conversation the request started in, *"even if the user switches conversations before a provider response or stream chunk arrives"* — **the machinery for surviving a conversation switch exists, and the effect kills the run before it can be used.** |
| **Evidence** | Report 1 §12.1. `:351-367` vs `:691-703`; `services/trade/chatStore.ts:479,493`; `chatTurnRunner.ts:850`; the surfaces unmount at `App.tsx:2312,2357,2379`; the dock's deliberate no-abort at `components/trade/TradeChatPanel.tsx:696-697` |
| **Proposed change** | 1. Register the Chat surface's controller with `chatStore.beginRun`/`endRunOwned`, so a run is owned by a conversation, not by the hook. 2. **Stop aborting** in the `:351-367` effect: make the loading message, the step tracker, the in-progress flag and the steering queue **per-conversation**, and let the run write into its own conversation via the existing `updateRequestMessages`. 3. Make the double-submit guard per-conversation. 4. **Stop** aborts the active conversation's run only. 5. Deleting a conversation aborts that conversation's run. 6. Show a **busy badge** on conversations with a live run, so "it is still thinking over there" is visible. 7. **Keep** the profile switch cancelling — a different trader's data must not receive the previous trader's answer. |
| **Impact** | **UX** (the feature as asked) · **Accuracy** (an answer that arrives after you look at another conversation is an answer, not a cancellation) · **Reliability** (two conversations can now run at once, as the dock already allows) |
| **Effort** | **M** |
| **Risk** | **M** — it changes *when* a run dies. `tests/useConversationHousekeeping.test.tsx:45` asserts `handleCancelAnalysis` **is** called on a conversation load; that test must be flipped deliberately. |
| **How to verify** | A test that starts a run in A, switches to B, and asserts (i) A's controller was not aborted, (ii) A's text landed in A, (iii) Stop in B aborts only B, (iv) deleting A aborts A. Then `npm run render-probe` for the badge. |
| **Roadmap** | **NEW** — the dock's half is already shipped, so this is the **second half of a design that exists**, not a new idea. |

#### E-46 — Level-3 sub-resources and a compatibility block for skills

| | |
|---|---|
| **Problem** | August's skill format is **already a deliberate port of the Agent Skills spec** — `services/learning/SkillMemoryService.ts:411-431` says so in a comment, with the two-face split (`# august:skill-ledger`, `:432`), spec-shaped `name` + `description` (`:1068-1070`), and a parser that loads a spec-only file as an unproven candidate (`:424-427`). Two convention elements are missing, and **one of them costs the trader something**: (a) **no `references/` / `scripts/` / `assets/`** — so a long procedure is **clipped** at `RECALL_SKILL_BODY_MAX` = **700 characters** (`services/learning/skillDocument.ts:6-8`) instead of being extended; (b) **no `compatibility` block** — a skill cannot declare the tools, env vars or platform it needs (August has `audience`/`lensScope`/`manualOnly`, which say *who may see it*, not *what it needs*). |
| **Proposed change** | (a) **Level 3**: let a skill carry a `references/<name>.md` note that the model pulls on demand with the same `recall` path that already pulls the body. The storage problem is real — the notebook is a flat list of `.md` entries, not a tree — so the cheapest version is a **sibling note referenced by path in the frontmatter**, not a directory tree. (b) **`compatibility`**: one more frontmatter key family (`requiresTools:`, `requiresEnv:`, `platforms:`), written by the craft and checked by the retrieval, so a skill that needs a tool the seat does not have is **not injected**. |
| **Impact** | **Accuracy** (a long procedure stops being lossy) · **Reliability** (a skill that needs a missing tool is not injected) · **Maintainability** (the format becomes the spec's, so a Claude/Hermes skill is a first-class import) |
| **Effort** | **L** for (a) — it is a storage-shape change · **S** for (b) |
| **Risk** | **M** for (a) — the notebook is the one store the app cannot regenerate. **This is the only item in the whole plan where a bug can lose the trader's own thinking.** It must land **after** E-48's repair path exists, so a broken split is recoverable. |
| **How to verify** | A skill with a `references/` note: the index line stays one line, the body stays ≤ 700 chars, and the note is pullable and cited. A skill with `requiresTools: [run_screener]` is not injected into a surface without that tool. |
| **Roadmap** | **NEW** — but the *format* itself is already a port; the missing part is named precisely in Report 1 §12.2.2. |

#### E-47 — The small convention gaps: filename, category, version, URL install

| | |
|---|---|
| **Problem** | The skill **content** is spec-shaped; the **envelope** is not. Files are `slug.md` (`isSkillFile`, `services/learning/SkillMemoryService.ts:405-406`), so a `SKILL.md` dropped into the skills folder is not recognised as spec-shaped. There is no `version` key. The notebook's folders are top-level (`skills/`, `rules/`, `doctrine/`, …) but there is **no category per skill**. Import is file-only (`services/learning/SkillImportService.ts:95-112` — `readSkillFiles`); there is no URL or owner-repo install. There are no skill bundles (one YAML loading several skills). |
| **Proposed change** | (a) Accept `SKILL.md` as an alias for a spec-shaped skill file — the **parser already handles it**; only the filename check needs to widen. (b) A `version:` key on the portable face. (c) A per-skill `category:` key, and a category view in the catalog. (d) `installSkillFromUrl(url)` alongside the file import, with the same per-file outcome contract. (e) Defer bundles — they are the least valuable of the five and the most work. |
| **Impact** | **Maintainability** (a Claude/Hermes skill drops in and works) · **UX** (a category view) · **Portability** |
| **Effort** | **S** for (a), (b), (d) · **M** for (c) · **M** for (e), deferred |
| **Risk** | **S** |
| **How to verify** | Drop a spec-only `SKILL.md` into the skills folder and assert it lists, parses and loads as an unproven candidate. |
| **Roadmap** | **NEW** |

#### E-48 — A "review all my skills" job that proposes, never writes

| | |
|---|---|
| **Problem** | There is no way to see which of the trader's skills are malformed, clipped, untriggerable or shadowed — the format is already spec-shaped, but **nothing checks it**. A skill whose description is only the `ifCondition → thenAction` fallback (`services/learning/SkillMemoryService.ts:1064-1067`) will rarely fire; a skill over the 700-char recall cap is **silently clipped at the card** (`services/learning/skillDocument.ts:48-54` — `clipped`, `droppedChars` — the number is already computed and nothing surfaces it). |
| **Proposed change** | **A two-stage job, both stages already exist as building blocks.**<br>**Stage 1 — deterministic, no model call.** For every skill: does it parse (`parseSkillMarkdown`); does it round-trip (`serializeSkill`); is `name` present and ≤ 64; is `description` real or a fallback; is the portable/ledger split intact; are the body sections recognised (`parseSkillBody` / the `HEADINGS` map); **how much would be clipped** (`projectSkillCard` → `droppedChars`); does the description say WHEN (a trigger phrase, or an `ifCondition`); does the file name match the skill (`skillFileNameFor`).<br>**Stage 2 — model-assisted, only for what code cannot decide.** Rewrite a description that does not say WHEN, and normalise section headings, using the existing skill-writing calls (`services/learning/SkillCraftService.ts` — `craftSkillFromPostMortem:155`, `refineSkillFromLosses:228`).<br>**The write rule: the job produces PROPOSALS, never writes.** Every proposal goes through the existing human gate — `utils/learningQueue.ts` (`queueLearningProposal`, `applyProposalCard`, `decideRewriteCard`) — landing in `components/learn/ActionApprovals.tsx`. The same discipline the supervisor and `propose_skill` already use.<br>**The budget: opt-in, capped per run, a token estimate shown before it starts, fail closed with no ready provider.** The precedent is `services/learning/SkillEvalScheduler.ts` — a scheduled, budgeted, sample-gated LLM pass over skills — and `services/learning/SkillEvalService.ts:307`, which already writes a verdict into a skill's frontmatter. **The review job is its sibling: same scheduler, same budget, different prompt, different write target.** |
| **Impact** | **Accuracy** (an untriggerable skill is a skill that never fires; a clipped one is a procedure the model only half-reads) · **Maintainability** (one button to see the health of the whole library) · **UX** |
| **Effort** | **M** — Stage 1 is **S** (everything it needs exists); Stage 2 is **M** |
| **Risk** | **M** — a batch that rewrites skills is a batch that can damage them. Mitigations: proposals only; a diff per skill before anything is applied; a per-skill revert; the deterministic pass runs first and alone. |
| **How to verify** | A test over a corpus of deliberately malformed skills (no frontmatter, no description, an unknown section, an over-cap body, a name that does not match the file) asserting one verdict each; and an end-to-end test that a Stage-1 report lists exactly those and proposes nothing. |
| **Roadmap** | **NEW** — the *format* is already a port; the *bulk review* is not in the corpus. |

#### 3D-rank

| rank | id | what | impact | effort | roadmap |
|---|---|---|---|---|---|
| 1 | **E-45** | Per-session run ownership for the Chat surface | UX · accuracy | **M** | NEW |
| 2 | **E-48** | "Review all my skills" — propose, never write | accuracy · maintainability | **M** | NEW |
| 3 | **E-47** | The envelope gaps: filename, category, version, URL install | maintainability | **S–M** | NEW |
| 4 | **E-46** | Level-3 sub-resources + a compatibility block | accuracy | **L** | NEW |
| 5 | **E-46** (the new features file) | **"a run is still going" badge on the conversation rail** | UX | **S** | NEW (as **N-21**) |

---

### B. 3E. Two additions the malformed-skill question forces

**Added 2026-10-20**, after the owner asked what happens to a skill that does not follow the format
or is too vague. The deep dive is Report 1 §12.4.

#### E-48b — the review job issues **three** verdicts, and proposes only what is safe

| | |
|---|---|
| **Problem** | A skill that does not parse is **silently dropped** by `listSkills()` (`services/learning/SkillMemoryService.ts:1053-1057`) and by the retrieval (`MemoryRetrievalService.ts:218-219`). It sits in the notebook, in the backup and in the export — and appears in **no** list, including the Health card, whose report **already computes the count and throws it away** (`memoryHealth.ts:178-181` — `skillFiles` is used at `:178` and `:179` and never again). **The same file would be rejected *with a reason* on import** (`SkillImportService.ts:56-58`) — so the app gives two opposite answers for the same file depending on how it arrived. A skill that parses but names no trigger is listed, **occupies one of the 30 index slots in file order**, and will never fire (`MemoryRetrievalService.ts:257`, *"A skill that qualifies on neither signal stays invisible"*). A skill whose card is clipped at the 700-char recall cap is a **half-procedure in every prompt**, and `projectSkillCard` already returns `droppedChars` (`skillDocument.ts:48-54`) — **computed and never surfaced**. |
| **Proposed change** | **The review issues three verdicts, and proposes only what is safe.**<br>**GHOST** (unparseable) — show the file, its size and **the first failing line**; propose (a) reconstruct the frontmatter from the file's own body, landing as an **unproven candidate with zero counters**, (b) archive it out of `skills/`, or (c) delete it **on the trader's word only**.<br>**DORMANT** (no usable trigger) — show the skill and *"names no setup it applies to"*; propose (a) the model writes a trigger **from the skill's own body**, old and new side by side, (b) demote to `candidate`, or (c) leave it alone. **A warning, not a defect** — a general rule is *supposed* to be unscoped, and the retrieval deliberately broadens on prose for exactly that case (`MemoryRetrievalService.ts:243-244`). **"Never fired" is NOT the verdict** — the injection log is run-capped, and the repo already refuses to conflate "never served" with "aged out" (`memoryHealth.ts:15-18`). Show it as a hint, never as the proof.<br>**CLIPPED** — show **how many characters are cut**; propose shortening the body, or moving the overflow to a `references/` note (**needs E-46**).<br>**And put the ghost count on the Health card permanently** — a hand-edit can create one at any time. |
| **The safety rule** | **A repair that widens a skill's reach ACTIVATES it.** Reconstructing a ghost gives it a trigger; giving a dormant skill a real description makes it match. Once E-35 lands, that means a live rule that can veto a trade. **⇒ The default for a broken skill is NOT "make it work" — it is "show it and let the trader decide." Narrowing (demote, archive, retire) is safe and may be proposed freely; widening (activate) must be confirmed one skill at a time. Evidence counters are never invented: a reconstructed skill starts at zero wins, zero losses, `status: candidate`.** Every repair is a proposal through the existing queue with a diff. |
| **Impact** | **Accuracy** (a ghost is a rule the trader believes in and the app has never heard of) · **Reliability** (two opposite answers for the same file is a correctness bug, not a formatting one) · **Maintainability** |
| **Effort** | **S** for the deterministic stage — *every* number it needs is already computed somewhere and discarded — **M** for the model stage |
| **Risk** | **M** — a batch that widens skills changes what the model does. Mitigations: proposals only, a diff per skill, per-skill revert, and the safe/unsafe split above. |
| **How to verify** | A test over a corpus of deliberately broken skills — no frontmatter, a broken `---` fence, a description equal to the fallback, an over-cap body — asserting one verdict each; a test asserting a reconstructed ghost lands as `candidate` with zero counters; and a test asserting the Health card's ghost count equals `skillFiles.length - metas.length`. |
| **Roadmap** | **NEW** — an extension of E-48, not a separate idea. |

#### E-49 — rank the 30-slot index, so fixing the skills actually gets them in front of the model

| | |
|---|---|
| **Problem** | The prompt's skill index is **30 slots, filled in notebook file order, unranked and unfiltered by status** (`services/trade/chatSurfaceTurn.ts:109-118` → `rows.slice(0, SKILL_INDEX_WINDOW)`; `listSkills()` returns file order). A **retired** skill and an unproven **candidate** occupy a slot exactly like a **confirmed** one, and a **dormant** skill occupies a slot a good skill needed. `buildSkillsIndexForPrompt` (`services/trade/tradeChatContext.ts:206-224`) renders whatever it is given. **⇒ Repairing the library does not guarantee the model sees the repaired skill** — and the index is the only place a skill is ever *named* to the model. |
| **Proposed change** | **Rank and filter the rows before the slice.** A skill earns an index slot by: (1) it has a usable trigger; (2) it is not `retired`; (3) `confirmed` before `candidate`; (4) a skill the current audience may see (`audience` / `lensScope` / `manualOnly` — `MemoryRetrievalService.ts:258-260` already filters these for *retrieval*, but the **index** does not); (5) ties broken by last evidence, then by name. The `…and N more` line already exists for the overflow (`tradeChatContext.ts:222`), so the honest count is already handled. |
| **Impact** | **Accuracy** (the model sees the skills that can act) · **Cost** (the same 30 slots carry better content) · **Reliability** (a retired skill stops occupying a slot a live one needs) |
| **Effort** | **S** |
| **Risk** | **S** — it changes which skills are named. The pool that ranks out is reported in the `…and N more` line, so nothing disappears silently. It must use `utils/runStatus.ts`'s vocabulary for the status word, not a new one. |
| **How to verify** | A test with a retired skill, a dormant skill and a confirmed skill, asserting the order of the index and that the retired one is absent. Plus a test that the `manualOnly` skill stays out of an audience that may not see it. |
| **Roadmap** | **NEW** — and it is the **same defect as the "one fact, several homes" cluster**, seen from the prompt side. |


<div style="page-break-after: always"></div>

---

## Part C — Report 3 — New features

<sub>Source: `docs/plan/audit/2026-10-19-03-new-features.md`</sub>

<!-- original part title: Report 3 — New features -->

**Pinned commit:** `6a41a9f7e3b3986236c3000862d326f1e95dfad1` (branch `main`)
**Date:** 2026-10-19
**Part C of the brief.**

**The framing these are built for.** August is the trader's **operator** — the trading equivalent of
what Claude Code is for coding and Hermes is for a user's daily work. It does the trader's work:
prep, scan, plan, manage, journal, review, improve. **The user decides.** The agent proposes,
deterministic code checks, the user decides. No order placement, no exchange write access, ever.

**What that framing excludes, and why these proposals honour it.** No order placement. No exchange
write access. No regime routing (the app already has a regime ledger — `services/learning/regimeLedger.ts`
— and it is a *measurement*, not a router; routing would make the app decide, which is the user's
job). No debate revival. No extra LLM review calls — and several proposals here **reduce** model
calls. No macro calendar.

**The design rule for every proposal below:** *it must make the trader better at deciding, and it
must not make decisions for them.* A proposal that fails that test is not here, however cheap it is.

**What "reuses" means in the tables.** The right-hand column names the **existing** machinery the
feature is built on. A proposal that needs new infrastructure is a worse proposal; most of these
need none.

**A note on the data.** Several of these are only worth building once there is real trade data.
Those are marked **[DATA-GATED]**. The app's own journal, the outcome engine, the calibration
ledger and the skill ledger already exist and work — they are **starved of closed rows**, not
missing. The mechanism of the starvation is in Report 2 §E-18, and it is the precondition for
every **[DATA-GATED]** item.

---

### C1. PREP — before the session, the trader knows what is in play

The prep surface is currently the **weakest** of the six. The app has a watch list, level watches,
automations, a market-data cache and a rich notebook — and **no way to see, in one place, what
"in play" means this morning.** Everything below is assembly, not invention.

#### N-01 — A pre-session brief

| | |
|---|---|
| **User value** | The trader opens the app and knows, in one screen: what they marked, what moved to it, what is now invalid, and what the app learned from last week that bears on today. Today that is three surfaces and a memory. |
| **Reuses** | `services/trade/watchService.ts` (the watch list) · `services/trade/levelWatchService.ts` (armed levels and hits) · `services/trade/chartDrawings.ts` (the trader's own drawings) · `services/analysis/MarketDataService.ts` (the cached packet) · `utils/recentTradesBrief.ts` (the last-20 summary, already built and already injected) · `services/learning/MemoryRetrievalService.ts` (the skills that match these symbols) · `services/automation/AutomationService.ts` (the schedule that could deliver it) |
| **What it needs** | A read-only assembly surface over existing stores. **No new store, no new model call.** The one new thing is a rule for *which* symbols count as "in play" — the watch list plus any symbol with an armed level. |
| **Effort** | **M** |
| **Risk** | **S** — read-only. The risk is scope creep into a second home for the journal (the app already has a "one fact, several homes" problem, `R-049`). |
| **Data** | **works with zero trades.** It reads the trader's own watch list and drawings, which exist from day one. It gets *better* with data. |
| **Roadmap** | **NEW** — no roadmap item proposes a pre-session brief. The closest are `R-208` (the last-20 brief, shipped) and `R-087` (the weekly/monthly review cards returning `null`). |

#### N-02 — Session setup: a checklist the app can fill

| | |
|---|---|
| **User value** | Before the first trade of the day: the open drawdown since the last session, the open thesis, the symbols in the watch list, the skills that match them, and the risk the trader has already committed today. The trader's "prep" step becomes a two-minute read instead of a memory exercise. |
| **Reuses** | `utils/checklist.ts` (**already exists** — `trading_checklist_v1` is a real store, with a 64 KB export cap) · `utils/recentTradesBrief.ts` · `services/trade/levelWatchService.ts` · `services/learning/SkillMemoryService.ts` (the skills index) · `services/analysis/MarketDataService.ts` |
| **What it needs** | A checklist *producer* (today the checklist is presumably trader-authored) that fills itself from the existing stores. No new store. |
| **Effort** | **M** |
| **Risk** | **S** — but the checklist store's write-time bound is an open backlog item (`R-202`), so a producer that writes on every session start makes that bound matter sooner. **Sequence it after `R-202`.** |
| **Data** | **works with zero trades.** The risk-committed line needs open positions, so it degrades gracefully. |
| **Roadmap** | **NEW**. |

#### N-03 — The open-position digest

| | |
|---|---|
| **User value** | Every open position, on one card, with the distance to its stop and target, the time held, and the *current* planned R:R — computed from the **canonical** formula, so the number matches the journal. |
| **Reuses** | `services/trade/chatStore.ts` (`addOpenTrade` — the one journal write path) · `services/trade/levelWatchService.ts` · `services/ui/OutcomeAutopilotService.ts` (already resolves open trades every 20 s) · `utils/riskReward.ts` (the canonical ratio) |
| **What it needs** | A read-only view over the open rows. **The R:R must come from `utils/riskReward.ts`** — this is the feature that makes E-02 (one R:R formula) visible to the trader, and it is the reason E-02 matters. |
| **Effort** | **S–M** |
| **Risk** | **S** — but it depends on E-02, because a digest that prints the *gate's* index-0 ratio would print a different number from the journal. **Do not build it before E-02.** |
| **Data** | Needs at least one logged trade. **But the machinery is the existing journal read path.** |
| **Roadmap** | **NEW** — adjacent to `R-084`/`R-085` (the "why" holes) but not the same. |

---

### C2. SCAN — find the setup, not the chart

The scan tools are the **strongest** part of the app: `scan_setups` (861 schema chars), `run_screener`
(843), `scan_chart_skills` (1,301), `get_indicators` (1,660) — 12 market-reading tools, all
deterministic, all local-TA, all served from a 30-second cache. **What is missing is the bridge
between the tools and the trader's own attention.**

#### N-04 — The watch list becomes the scan's input

| | |
|---|---|
| **User value** | One list. The trader watches six symbols; the scan runs over exactly those six (or over a defined universe) and returns the ones that have changed shape — instead of the trader remembering to ask. |
| **Reuses** | `services/trade/watchService.ts` (`trade_watches_v1_<user>`) · `services/analysis/DeskToolsService.ts` (`run_screener`, `scan_setups`) · `services/analysis/MarketDataService.ts` (the 30 s cache) · `services/learning/strategyStore.ts` (the strategy book the scan already reads) · `services/automation/AutomationService.ts` (the schedule) |
| **What it needs** | A screener entry point that takes a **symbol list** instead of the Binance universe, and the ability to schedule it. **Both exist in pieces.** |
| **Effort** | **M** |
| **Risk** | **S** — but the screener over a fixed universe is a different cost profile from the scan over the trader's list; the 30 s cache and the 20 s tool timeout already bound it. |
| **Data** | **works with zero trades.** It needs watch-list entries, which exist from day one. |
| **Roadmap** | **NEW** — `R-207` shipped the `get_trade_log` tool and `R-208` the last-20 brief; the screener bridge is not in the corpus. |

#### N-05 — "What changed since yesterday", per symbol

| | |
|---|---|
| **User value** | For each watched symbol: the trader's own level is now 0.4 % away and the structure changed; the previous session's packet said X and today's says Y. The trader's *attention* is the scarce resource; the app already has both halves of the comparison. |
| **Reuses** | `services/analysis/MarketDataService.ts` (`POINT_IN_TIME_TTL` = 5 s, the live mark at 2 s) · `services/trade/chartDrawings.ts` (the trader's levels) · `services/trade/levelWatchService.ts` (the armed levels and the hits) · `services/trade/chartTriggers.ts` · the last session's stored `marketSnapshot` on the journal row (`hooks/useTradeLogging.ts:296-368`) |
| **What it needs** | A diff between two packets. **The journal row already stores `marketSnapshot` and `marketRegime`**, so the "then" is already persisted; the "now" is one packet fetch. |
| **Effort** | **M** |
| **Risk** | **S** |
| **Data** | **works with zero trades** for the levels half; the snapshot comparison needs at least one logged trade. |
| **Roadmap** | **NEW** |

#### N-06 — Counter-pattern scan: what you have been wrong about

| | |
|---|---|
| **User value** | "You have been trading this shape 6 times and lost 5. Here is what is set up *instead*." The pattern memory already holds per-coin, per-family, per-pattern, per-regime, per-direction performance; nothing surfaces the *negative* case. |
| **Reuses** | `services/learning/PatternMemorySynthesisService.ts` (the weighted scorer, live) · `services/validation/GateKeeperService.ts` (which already reads it) · `services/analysis/DeskToolsService.ts` (`scan_setups`) · `utils/patternMining.ts` (`mineCoinFromPrompt`) |
| **What it needs** | The *inverse* of the current query — a scan for the shape the trader loses. A new tool argument, not a new tool. |
| **Effort** | **M** |
| **Risk** | **S** — read-only. |
| **Data** | **[DATA-GATED]** — needs a real pattern-performance sample. With n < 10 the honest answer is "not enough evidence", and the app must say so rather than show a 0 % that means nothing. **This is the same trap as E-04.** |
| **Roadmap** | **NEW** — `R-151` records that *"nothing checks `approvedBy` or `whyAccepted` at injection time"*; the negative-case query is not covered. |

---

### C3. PLAN — the proposal becomes something the trader can shape

The current proposal card is **accept or ignore**. The product framing says *the agent proposes, the
user decides* — and "decide" is currently only "yes" or "no". Everything below is about widening
"decide" without widening the agent's authority.

#### N-07 — The trader can adjust the plan, and the adjustment is recorded

| | |
|---|---|
| **User value** | The trader moves the stop, takes a different target, or halves the size — and the journal records **both** the model's plan and the trader's. Over time that is the single most valuable dataset the app can have: *"this model proposes stops that are 0.3 % too tight for this coin."* |
| **Reuses** | `services/trade/proposedTrade.ts` (the `TradeProposal` schema) · `services/trade/proposalGate.ts` (the stamp) · `services/trade/levelWatchService.ts` (the armed levels) · `hooks/useTradeLogging.ts` (the one journal write path) · `services/learning/SkillMemoryService.ts` (`applySkillEvidence` — the evidence chain) |
| **What it needs** | The `TradeProposal` schema already carries the levels; it needs an **adjustment record** and a re-stamp after the adjustment. The `planId` already dedupes the journal row, so an adjusted plan can be a second row under the same id. |
| **Effort** | **L** — this is a schema change on the journal row, and the evidence chain reads it. |
| **Risk** | **M** — the evidence chain (`applySkillEvidence` → `skillAdherenceForRun`) joins on the injection record, so an adjusted plan must not double-credit or double-debit a skill. **This is the part that makes it L rather than M.** |
| **Data** | **[DATA-GATED]** for the *value* (the dataset only exists once trades are adjusted and resolved); the *feature* can ship without it. |
| **Roadmap** | **NEW** — nothing in the corpus proposes trader-adjustable plans. `R-216` (trust & noise) is adjacent but is about settle-time stripping. |

#### N-08 — A size suggestion on the proposal card

| | |
|---|---|
| **User value** | The card says, in the trader's own risk terms, what this plan costs: *"at 1 % risk on a 10 k account, 2 lots, 0.8 % stop, 3 % away"*. The trader's risk % is already a setting; the stop is already in the plan; the leverage cap is already coded. |
| **Reuses** | `utils/ticketSize.ts` — **the complete, grade-tiered, fail-closed sizing module that has zero production call sites** (`utils/ticketSize.ts:45-180`, with the leverage cap and the unconfigured-equity refusal) · the trader's risk setting (`utils/harnessSettings.ts`) · the plan's levels (`services/trade/proposedTrade.ts`) |
| **What it needs** | Nothing new. **This is the re-homing E-12 proposes, with a surface.** |
| **Effort** | **S** once E-12 lands; **M** from scratch (because the module has never been wired and its contract with the plan shape has never been exercised). |
| **Risk** | **S** — a suggestion the trader can ignore. It must never *be* the size. |
| **Data** | **works with zero trades.** |
| **Roadmap** | **NEW** — `R-024` covers the R:R chip on the proposal card, **not** the size. The sizing module's orphanhood is `G-06`. |

#### N-09 — "What would have to be true" — a structured thesis on the card

| | |
|---|---|
| **User value** | The card shows the plan's **invalidation** and its **evidence**, not just three prices. A plan the trader can invalidate in one sentence is a plan the trader can hold; a plan that is three prices is a trade the trader has to babysit. |
| **Reuses** | `services/trade/proposedTrade.ts` (the `TradeProposal` schema) · `services/analysis/EvidencePackService.ts` (**already builds an evidence pack** — `R-120` shipped the "review-destinations" idea partially) · `services/learning/EvidencePackService.ts` · `services/trade/tradePlanLevels.ts` (the level parsing) · `utils/avoidReason.ts` (**already produces an "avoid" reason** — a per-coin avoid list) |
| **What it needs** | Two extra fields on the proposal schema: an invalidation condition and an evidence list. The model already produces both in prose (the `present_trade` description and the EvidencePackCard). |
| **Effort** | **M** |
| **Risk** | **M** — a schema change to the model-facing tool. The `present_trade` schema change ripples into the tool definition, the parser, the card and the journal. |
| **Data** | **works with zero trades.** |
| **Roadmap** | **NEW** — `R-257` records that *"the drawn Entry/Stop/Target line is un-asserted by any gate"*; the *content* of the plan is not covered. |

---

### C4. MANAGE — the plan while it is live

#### N-10 — Arm the plan, not the price

| | |
|---|---|
| **User value** | The trader arms a *plan* — entry, stop, target, invalidation — and the app tells them when the **plan** is invalidated (structure broke, the invalidation condition triggered), not only when a price is touched. Today the watch is price-level-based: `services/trade/levelWatchService.ts` fires on a level. |
| **Reuses** | `services/trade/levelWatchService.ts` (the arm/fire machinery) · `services/trade/tradePlanLevels.ts` (`staleLevelsAtArm` — the existing "the plan is already through its stop" refusal) · `services/analysis/MarketDataService.ts` (the live mark) · `services/analysis/CandlePatternDetector.ts` (the structure) · `services/ui/PriceAlertService.ts` (the alert surface) |
| **What it needs** | An invalidation predicate. The pieces exist: the levels, the structure detector, the market regime. **What is missing is the composition** — and the invalidation has to come from the plan (N-09), so this is downstream of N-09. |
| **Effort** | **M** (after N-09); **L** standalone |
| **Risk** | **M** — a false invalidation erodes trust in the watch immediately. The existing design already treats a refusal as a *receipt* rather than a silent drop (`presentTradeTool.ts:133`), and that discipline should carry over. |
| **Data** | **works with zero trades** — it reads the plan and the tape. |
| **Roadmap** | **NEW** |

#### N-11 — The veto ledger, where the trader can see it

| | |
|---|---|
| **User value** | `services/ui/VetoLedgerService.ts` records a veto; the trader's "why was this blocked" question currently has no screen. A veto that is invisible is a veto the trader cannot learn from. |
| **Reuses** | `services/ui/VetoLedgerService.ts` (the store) · `utils/approvalInbox.ts` (the approval inbox) · `components/learn/ActionApprovals.tsx` (the inbox surface) · `services/infrastructure/ThinkingStoreService.ts` |
| **What it needs** | A read surface. **One caveat:** the ledger's *meaning* is entangled with the deleted moderator, so a reader must be written to say what a veto means in the tool-turn architecture, not the debate one. |
| **Effort** | **S–M** |
| **Risk** | **S** |
| **Data** | needs vetoes to exist, which needs runs. |
| **Roadmap** | **PARTIAL** — `R-088` ("the forged-tool queue count has no destination") is the same *shape* of gap for a different queue; the veto ledger itself is **NEW**. |

#### N-12 — One home for "what is open"

| | |
|---|---|
| **User value** | The trade surface, the journal and the header each show a slice of the open positions. One list, one place, linked. |
| **Reuses** | `services/trade/chatStore.ts` · `services/trade/watchService.ts` · `components/journal/Journal.tsx` · `components/trade/TradeView.tsx` |
| **What it needs** | Nothing new — a shared read model. |
| **Effort** | **M** |
| **Risk** | **S** |
| **Data** | needs open positions. |
| **Roadmap** | **COVERED** in spirit — `R-049` ("one fact, several homes") names the class. **The missing part, named: no roadmap item names the open-position list specifically.** |

---

### C5. JOURNAL — the record that explains itself

The journal is the app's most complete surface and its **weakest** in one specific way: it records
what the trader did but not what it taught. The roadmap already names this twice.

#### N-13 — "What this trade taught"

| | |
|---|---|
| **User value** | Each journal row carries the one sentence the app learned from it: *"your BTC scalp entries below 61,200 lost 4 of 5"*, *"this setup beat your 1.5 % floor only because the stop was 0.4 %"* — linked to the skill, rule or pattern that changed. |
| **Reuses** | `services/learning/SkillMemoryService.ts` (`applySkillEvidence` already computes FOLLOWED / OVERRIDDEN / CONTROL per skill) · `services/learning/skillSupervisor.ts` (the triage ledger) · `utils/tradeInsightBrief.ts` (the per-trade summary) · `services/learning/AlorithmicMemoryService.ts` (the aggregation) · `hooks/useTradeLogging.ts` (the one write path) |
| **What it needs** | A read surface over the evidence the app **already computes** and does not show. The `applySkillEvidence` result is written; nobody renders it per trade. |
| **Effort** | **M** |
| **Risk** | **M** — the evidence is currently *wrong* (F-01b: the ledger credits skills the model never saw). **Build this AFTER E-05, or it will show the trader a confident wrong answer.** |
| **Data** | **[DATA-GATED]** — needs closed trades. |
| **Roadmap** | **COVERED** — `R-085` ("The Journal never says what a trade taught the app", *"gap → fix M"*) and `R-084` (the skill's trades). Both still open. |

#### N-14 — The skill's own evidence, one click away

| | |
|---|---|
| **User value** | A skill shows a tally but not *which trades earned it*. The trader cannot tell a skill that earned 7 samples from one that earned 2 lucky ones. |
| **Reuses** | `services/learning/SkillMemoryService.ts` (the per-skill W/L and control counters) · `services/learning/MemoryInjectionService.ts` (`skillAdherenceForRun` — the injection→trade join) · `services/learning/EvidencePackService.ts` |
| **What it needs** | The join from a skill back to the trades, rendered. The join exists (`skillAdherenceForRun`); the view does not. |
| **Effort** | **M** |
| **Risk** | **S** — but it inherits F-01b, so the *counts* it shows depend on E-05. |
| **Data** | **[DATA-GATED]** |
| **Roadmap** | **COVERED** — `R-084` (*"the single biggest 'why' hole"*). Still open. |

---

### C6. REVIEW — the loop closes

#### N-15 — A weekly review that names what changed

| | |
|---|---|
| **User value** | Not "you had 12 trades, 8 wins" — *"this week the app stopped recommending X because of Y, your win rate on Z changed from 40 % to 65 %, and three of your four losses were the same shape you were told to avoid"*. |
| **Reuses** | `services/learning/weeklyReview.ts` (**already built**; `MIN_CLOSED_TRADES_FOR_REVIEW = 3` is the only thing stopping it) · `services/learning/weeklyRollup.ts` (the rollup) · `services/learning/settledBeliefs.ts` · `services/learning/memoryHygiene.ts` (the demotion / contradiction / graveyard sweeps that already run) · `services/learning/monthlyReport.ts` (the same idea, monthly) |
| **What it needs** | **Almost nothing.** The review machinery exists and is correctly gated. The gap is that the cards return `null` and the trader cannot tell "pending" from "failed" from "never ran" (`R-087`). **Fix `R-087` first** — a review that says "not enough closed trades yet" is honest; a card that returns `null` is not. |
| **Effort** | **S** for the honest-empty-state fix · **M** for the full review |
| **Risk** | **S** |
| **Data** | **[DATA-GATED]** — this is the feature that most needs closed trades, and the one that most rewards them. |
| **Roadmap** | **PARTIAL** — `R-087` covers the *empty state*; the *review content* is **NEW**. |

#### N-16 — Replay: "what would today's code have said about last Tuesday's plan?"

| | |
|---|---|
| **User value** | The trader's judgement improves when they can see whether the app's advice has changed. Replay also becomes the app's own regression harness — the cheapest way to know whether a gate change made things better or worse. |
| **Reuses** | the stored journal rows (entry, stop, targets, `marketSnapshot`, `marketRegime`, `promptVersion`, `sourceRunId`, `modelsUsed`, `realizedR`) · `services/validation/TradeValidationGate.ts` (the deterministic re-grade) · `services/backtesting/outcomeEngine.ts` (the re-resolve) · `utils/riskReward.ts` |
| **What it needs** | A **replay** command over the journal, re-running the deterministic code against the stored plan. **No model call** — the levels and the snapshot are already stored. This is the deterministic half of what `R-206`'s `SkillEvalService` does with the *prompt*. |
| **Effort** | **L** (M for the first version: replay the gate, report the drift) |
| **Risk** | **S** — read-only over the journal |
| **Data** | **[DATA-GATED]** — needs a history of closed trades, and rows that carry a `planId` (pre-F3a rows do not — `R-214`). |
| **Roadmap** | **NEW** — nothing in the corpus proposes a replay. `R-206` is the nearest machinery and the nearest miss. |

#### N-17 — The calibration ledger, decided

| | |
|---|---|
| **User value** | Not a feature so much as a decision with a surface: *"your confidence in this kind of call has been 30 % accurate over the last 40 calls — you are over-confident by 20 points."* |
| **Reuses** | `services/validation/CalibrationLedgerService.ts` + `calibrationPolicy.ts` + `calibrationStore.ts` + `calibrationPrompts.ts` (**all four exist**) · `services/learning/metaCalibration.ts` · `utils/promptVersionStats.ts` |
| **What it needs** | The roadmap records this as *"still an unresolved product decision"* (`G-56`). **It needs a ruling before it needs code.** |
| **Effort** | **S** for a surface · **M** for the decision's consequences |
| **Risk** | **S** |
| **Data** | **[DATA-GATED]** — the Brier buckets need closed trades. |
| **Roadmap** | **COVERED** as an open decision — `G-56`, `R-056`. **The missing part, named: it is recorded as a decision, not as a build, and it is one of the 23 owner decisions the roadmap lists.** |

---

### C7. IMPROVE — the loop that makes the next session better

#### N-18 — A skill the gate just verified is pushed, not indexed

| | |
|---|---|
| **User value** | The trader's skills are shown to the model as a **30-row index** — slug, status, kind, description, if/then. The model can pull a body with `recall`, but it does not get the skill that the *gate* just proved is relevant, in the prompt, with its evidence. |
| **Reuses** | `services/learning/MemoryRetrievalService.ts` (the retrieval, the budget, the injection record) · `services/learning/skillPredicate.ts` (the code-checked trigger) · `services/learning/SkillMemoryService.ts` (the evidence counters) · `services/learning/patternMemorySynthesisService.ts` |
| **What it needs** | A **push** rule: the top-N retrieved skills (currently ≤400 chars each) go into the prompt alongside the index, with a budget. The retrieval already computes the ranking and the stage budget — it computes it and throws it away (F-01). |
| **Effort** | **M** — and it is the **same work as E-01(a)**, so the two should be one change. |
| **Risk** | **M** — the push changes every prompt. It must be budgeted and measured. |
| **Data** | **works with zero trades** — retrieval is not data-dependent. |
| **Roadmap** | **PARTIAL** — `R-161`/`G-32` record that *"nothing is pulled"* as an open research finding, and `R-135` made `description` the trigger. **The missing part, named: the roadmap discusses pull-vs-push as a *storage* question; it does not propose the push rule as a *prompt-budget* question.** |

#### N-19 — "What changed in my thinking"

| | |
|---|---|
| **User value** | The trader's doctrine and settled beliefs change over time — a rule is added, a belief is settled, a skill is demoted. The app changes them silently. The trader should see the diff. |
| **Reuses** | `services/learning/DoctrineConsolidationService.ts` (the doctrine rewriter) · `services/learning/settledBeliefs.ts` · `services/learning/skillIdleLifecycle.ts` (the suspension clock) · `services/learning/memoryHygiene.ts` (the demotion / contradiction sweeps) · `services/learning/supervisorStore.ts` (the triage ledger) · `services/learning/memoryTopics.ts` (the topic index) |
| **What it needs** | A read surface over the change ledger. The supervisor's triage ledger (`services/learning/skillSupervisor.ts:317-606`) already records approve/enhance/reject per item; **nothing renders it as a diff.** |
| **Effort** | **M** |
| **Risk** | **S** |
| **Data** | needs changes to have happened. |
| **Roadmap** | **PARTIAL** — `R-089` ("Agents shows `N lessons · N skills · N evidence` that cannot be opened") is the same shape for the agents pane. The **doctrine diff** is **NEW**. |

#### N-20 — The expectancy the trader actually has

| | |
|---|---|
| **User value** | *"Your break-even win rate at your fee tier and your average stop is 50 %. You are at 47 % over the last 60 calls. At the R:R you are actually taking, you need 44 %."* — the number that connects the app's gate to the trader's bankroll. |
| **Reuses** | E-03's cost model (the new `netR` / `costR`) · `services/validation/AccuracyValidationService.ts` (the grade bands) · `utils/riskReward.ts` (the canonical ratio) · `services/learning/SkillMemoryService.ts` (the per-skill expectancy) · `services/learning/calibrationPolicy.ts` |
| **What it needs** | E-03 first. Then a surface that puts the break-even beside the actual. |
| **Effort** | **M** after E-03 |
| **Risk** | **M** — this is the number a trader will act on, so it must be right. Which is why it comes after E-03 and E-02. |
| **Data** | **[DATA-GATED]** |
| **Roadmap** | **NEW** — `G-01`/`G-02` identify the missing cost model but propose no surface. |

---

### C8. Ranked

| rank | id | feature | workflow | effort | data | roadmap |
|---|---|---|---|---|---|---|
| 1 | **N-03** | The open-position digest | manage | S–M | 1 trade | NEW |
| 2 | **N-08** | A size suggestion on the card | plan | S–M | none | NEW (needs E-12) |
| 3 | **N-01** | A pre-session brief | prep | M | none | NEW |
| 4 | **N-15** | A weekly review that names what changed | review | S–M | **[DATA-GATED]** | PARTIAL (R-087) |
| 5 | **N-04** | The watch list becomes the scan's input | scan | M | none | NEW |
| 6 | **N-14** | The skill's own evidence | journal | M | **[DATA-GATED]** | COVERED (R-084) |
| 7 | **N-13** | "What this trade taught" | journal | M | **[DATA-GATED]** | COVERED (R-085) |
| 8 | **N-05** | "What changed since yesterday" | scan | M | 1 trade | NEW |
| 9 | **N-19** | "What changed in my thinking" | improve | M | changes | NEW |
| 10 | **N-18** | Push the gate-verified skill | improve | M | none | PARTIAL (G-32) |
| 11 | **N-02** | Session setup checklist | prep | M | none | NEW |
| 12 | **N-10** | Arm the plan, not the price | manage | M | none | NEW (after N-09) |
| 13 | **N-11** | The veto ledger, visible | manage | S–M | runs | NEW |
| 14 | **N-12** | One home for "what is open" | manage | M | open positions | PARTIAL (R-049) |
| 15 | **N-09** | "What would have to be true" | plan | M | none | NEW |
| 16 | **N-07** | The trader can adjust the plan | plan | L | **[DATA-GATED]** | NEW |
| 17 | **N-16** | Replay | review | L | **[DATA-GATED]** | NEW |
| 18 | **N-06** | Counter-pattern scan | scan | M | **[DATA-GATED]** | NEW |
| 19 | **N-20** | The expectancy the trader has | improve | M | **[DATA-GATED]** | NEW (needs E-03) |
| 20 | **N-17** | The calibration ledger, decided | review | S–M | **[DATA-GATED]** | COVERED (G-56) |

### C9. Only worth building after real data exists

**Seven features are [DATA-GATED]**: N-06, N-07, N-13, N-14, N-15, N-16, N-17, N-20.

**But their precondition is a single change, not a data collection project: E-18 — record the
outcome automatically (with a provenance flag and a correction path).** Until then, the features
are not "early", they are **meaningless**: a review with no closed trades, a skill with no
evidence, a replay with no history, a break-even with no win rate.

**The one thing to do before any of them: the owner's ruling on the click gate.** The previous
audit was explicit — *"the starved link is the click gate, not the toggle"* — and the roadmap lists
it as one of its 23 open owner decisions. **This is the highest-leverage decision in the repository
and it is not a code change.**

### C10. What is deliberately **not** proposed

The brief excludes order placement, exchange write access, regime routing, debate revival, extra
LLM review calls and a macro calendar. **None is proposed here.** In particular:

- **No order placement and no exchange write access**, because the app's product promise and its
  test-enforced disclaimer both depend on it. `tests/disclaimer.test.ts` asserts the app *"never
  places or signs a trade"* and that `PRIVACY.md` says *"no API key, no signature"*. A feature that
  broke that would break the thing the app *is*.
- **No regime routing.** The app has a regime ledger; the proposal is to *show* the regime
  (N-01, N-05) and to *measure* it, never to route on it. Routing makes the app decide.
- **No debate revival.** The ensemble became a tool-turn architecture; N-18 and N-09 extend the
  tool-turn architecture, they do not bring back a moderator.
- **No extra LLM review calls.** Every feature above is either a read surface over data the app
  already computes, or a *push* of context the app already assembles. **N-18 in particular makes
  the app use the retrieval it already pays for.** The one feature that calls a model is N-16
  (replay) — and its first version deliberately does **not**: it replays the deterministic code.
- **No macro calendar.** It is a data source, not a workflow, and it would put third-party
  economic-release data on the critical path of a trading decision.

---

### C11. The two new user-facing features

**Added 2026-10-20** at the owner's request. The deep dives are in Report 1 §12.

#### N-21 — "Review all my skills" — one button, a verdict per skill, and a diff before anything changes

| | |
|---|---|
| **User value** | The trader has dozens of learned skills and **no way to see which of them are actually working**: which never fire (a description that does not say WHEN), which are silently clipped at the 700-char recall cap, which have a malformed frontmatter, which shadow each other. Today that is only discoverable by reading the raw files. One button produces a per-skill verdict, and — for the ones that are wrong — a **proposed fix the trader accepts or rejects**. |
| **Reuses** | `parseSkillMarkdown` (the parser) · `serializeSkill` (the serializer — a parse→serialize→compare round-trip is the format check) · `services/learning/skillDocument.ts` `parseSkillBody` / `projectSkillCard` (the section check and the clip count) · `skillFileNameFor` (the name check) · `utils/learningQueue.ts` (the proposal queue) · `components/learn/ActionApprovals.tsx` (the approval surface) · `services/learning/SkillCraftService.ts` (the model call that rewrites a description) · `services/learning/SkillEvalScheduler.ts` (the budgeted, scheduled precedent) |
| **What it needs** | A new job with a deterministic first stage and an optional model second stage, and a button in `components/learn/SkillsCatalog.tsx`. **No new dependency, no new store, no new table.** |
| **Effort** | **M** — the deterministic stage is **S**, the model stage is **M** |
| **Risk** | **M** — a batch that rewrites skills can damage them. **The rule: the job proposes; the existing human gate applies.** One diff per skill; per-skill revert; the deterministic pass runs alone first. |
| **Cohort / data** | Needs the trader's own skills (they exist from day one) and, for the model stage, a ready provider. **No closed trades needed** — this works on a brand-new profile. |
| **Roadmap** | **NEW** — the *format* is already a documented Agent Skills port (`services/learning/SkillMemoryService.ts:411-431`); the *bulk review* is not in the corpus. See Report 1 §12.3. |

#### N-22 — "Still running" — the conversation rail shows where the model is thinking

| | |
|---|---|
| **User value** | After E-45, a run keeps going while the trader looks at another conversation. **Unless the app says so, that reads as a hang.** The rail should carry a busy badge on the conversation that is still streaming, and the dock's own session list already tracks busy sessions. |
| **Reuses** | `services/trade/chatStore.ts` (the store already tracks busy sessions — `beginRun`/`endRunOwned`, `:479`/`:493`) · `components/trade/TradeChatPanel.tsx:302` (*"unmounts, but the run keeps streaming into the store"*) · the conversation rail (`components/shell/SurfaceMenuList.tsx` / `components/chat/`) · `utils/runStatus.ts` — **the one module that owns the run-status vocabulary** (`AGENTS.md`: *"Never hardcode a status colour in a component"*) |
| **What it needs** | A per-conversation busy flag surfaced from the store into the rail. The state exists; the surface does not. |
| **Effort** | **S** once E-45 lands (it needs the per-conversation ownership E-45 introduces) |
| **Risk** | **S** — but it must use `utils/runStatus.ts`'s vocabulary, not a new colour. |
| **Cohort / data** | None — it is a live-state surface. |
| **Roadmap** | **NEW** — and it is **the second half of E-45**: the run survives, so the app has to say so. |


<div style="page-break-after: always"></div>

---

## Part D — Report 4 — The cleanup manifest

<sub>Source: `docs/plan/audit/2026-10-19-04-cleanup-manifest.md`</sub>

<!-- original part title: Report 4 — The cleanup manifest -->

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

### D1. Dead code

#### 1.1 Orphan modules — the sweep found exactly four

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

#### 1.2 The `messageDisplayText.ts` warning — resolved, and it is a bug, not a redundancy

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

#### 1.3 Dead exports — 63 fully dead, 202 dead `export` modifiers

**[Verified live]** 1,690 value exports in the tree; 352 have no importer by name. After a
repo-wide search (including `tests/`) for each name: **63 are fully dead code** (zero internal
use, zero production import) and **202 are dead `export` modifiers only** (the code is live inside
its own file; only the keyword is dead). 497 `type` exports are excluded as structural.

##### The 63 fully dead value exports

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

##### The 202 dead `export` modifiers — a separate, much safer commit

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

#### 1.4 The debate-era cluster in `utils/analysisUtils.ts`

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

#### 1.5 The validation gate's dead exports — a **warning**, not a cleanup item

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

#### 1.6 The scanner false-positive classes — recorded so they are not re-reported

| class | what it looks like | the truth |
|---|---|---|
| `new Worker(new URL('./x.worker.ts', import.meta.url))` | a naive AST matcher that requires the outer `new` argument to be a `CallExpression` misses it (the inner `new URL(...)` is a `NewExpression`) | `services/analysis/monteCarlo.worker.ts` is **LIVE** — `services/analysis/MonteCarloService.ts:801-805`, literal at `:803` |
| the `@/` path alias | a resolver that only handles relative specifiers | `lib/utils.ts` is **LIVE** via `components/ui/task.tsx` (`components/analysis/AnalysisProgress.tsx:13`, `components/analysis/EvidencePackCard.tsx:2`); `components/ui/collapsible.tsx` is live via `AnalysisProgress.tsx:14`; therefore **`@radix-ui/react-collapsible` is live too** |
| a CSS plugin directive | a JS import scanner sees no import | `@tailwindcss/typography` is **LIVE** — `index.css:2` `@plugin "@tailwindcss/typography";` |
| a regex export sweep vs the compiler API | `components/shared/Icons.tsx` exports ~40 icon names that **are** imported; the regex sweep reported them as unreferenced | the **TypeScript-API graph is authoritative**; the two tools' disagreement on `Icons` is **not a finding** |
| a "*.js token in prose" comment scan | `utils/analysisTrace.ts`, `kelly.ts`, `tradingview.js`, `debateChat.test.tsx` | the real set is the **8** rows in §3.3 |

#### 1.7 The dead import, already fixed in flight

`hooks/useAnalysisPipeline.ts:14` imported `defaultToolsForRole` with **no remaining use** — its
only call site was removed by `395f73db`. Invisible to CI because `tsconfig.json:28` sets
`noUnusedLocals: false` and `eslint.config.js:135` makes it a *warning* under a
`--max-warnings 889` cap. **The concurrent session has already deleted the import line.** Worth
noting: had it not, deleting `types/bot.ts` would have been a **hard compile error**, not a
warning.

---

### D2. Dead and duplicate data paths

#### 2.1 `approval_rules_v1` — on neither allow-list, and it gates every auto-apply

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

#### 2.2 Five namespaces that are restore-listed but NOT raw-listed

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

#### 2.3 The three dead Preferences keys, and the five split read/write stores

##### Dead settings — zero writers, zero readers, one grep hit each (their own declaration)

| key | declaration | note |
|---|---|---|
| `PREF_KEYS.MEMORY_PROVIDER` = `'memory_provider'` | `services/infrastructure/PreferencesService.ts:24` | the comment claims *"ProviderConfig id of the provider used for memory synthesis"*; **no code implements it** |
| `PREF_KEYS.HYBRID_PANEL_POSITION` = `'hybrid_panel_position'` | `:33` | |
| `PREF_KEYS.QUIET_HOURS` = `'quiet_hours_v1'` | `:42` | |

**Bonus:** because `ExportService.ts:659` does `...(Object.values(PREF_KEYS))` into
`RESTORABLE_PREFERENCE_KEYS`, these three are **also swept into every backup as phantom keys**.
Removing them removes them from backups too. **No migration is needed — they were never written.**

##### ☠ The split read/write stores — a **live bug**, not cleanup

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

##### Legacy / migration-only keys — legitimate, but mislabelled

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

#### 2.4 The planned R:R — **four** implementations, not two

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

#### 2.5 Similarity — **seven** implementations, not two

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

#### 2.6 "Which provider is ready" — written out twice

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

#### 2.7 Money formatters — at least **five** shapes for a dollar amount

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

#### 2.8 Date / duration formatters — **seven** "Xm ago" implementations

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

#### 2.9 Two prompt-composition paths

1. `utils/composePrompt.ts:36` `composePrompt` — **canonical** per `AGENTS.md:161-163`; used at
   `services/providers/GenericAnalysisService.ts:365` and `:407`
2. `components/trade/TradeChatPanel.tsx:453` `systemPromptFor` — a **second, independent**
   system-prompt builder for the chat surface, threaded through
   `services/trade/chatTurnRunner.ts:224,311,890,1067,1204`

**Confidence: duplication VERIFIED; consolidating NEEDS CHECK** — they build different prompts.
(`utils/composePrompt.ts` also has a dead export, `stripHarnessContract` — test-only.)

#### 2.10 Ruled out — checked, and **not** duplicates

| concept | verdict |
|---|---|
| **session identity** | `services/infrastructure/SessionService.ts` owns the **market** session (Asian/London/NY, `formatTime` `:256`, `isMonthlyClose`/`isWeeklyClose` `:248`); `services/trade/chatStore.ts` + `chatSessions.ts` own the **chat/trade** session. Different nouns. **Not a duplicate.** |
| **plan identity** | **not** duplicated — **one** `planId`, minted at `services/trade/presentTradeTool.ts:85` (`mintPlanId`), carried on `Message.planId` (`types/message.ts:262`) and `LoggedTrade.planId` (`types/trade.ts:49`), deduped on the journal row at `App.tsx:1585-1592` |
| **trade-log writers** | **exactly one** production write path — `hooks/useTradeLogging.ts:413` → `chatStore.addOpenTrade` (`services/trade/chatStore.ts:418`). `git grep "addOpenTrade\|logPaperTrade\|insertTrade\|saveTradeToDb\|logTrade("` → 6 hits, **one** production writer |
| **position size** | `utils/ticketSize.ts` is the **single** sizing module (it records every multiplier as a labelled `SizeAdjustment`, `:4-13`). `services/analysis/MonteCarloService.ts:631` `riskPerTrade` is a different question (the ruin-risk fraction for a simulation), not a second sizer. (`utils/ticketSize.ts:6` cites *"Clodds kelly.ts"* — an **external** project, not a dead path) |

#### 2.11 The three parallel memory stores — the repo says so itself

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

#### 2.12 The systemic pattern: two localStorage-vs-Preferences access paths

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

#### 2.13 A dead feature flag with a **live** Settings control

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

#### 2.14 A budget constant with no reader

`services/analysis/DeskToolsService.ts:204-205`: `DESK_TURN_BUDGET_MS` is **test-referenced only**
(`tests/deskToolDeadline.test.ts`); `DESK_TURN_WRAPUP_AT` (`:205`) has **no reference at all**.

**NEEDS CHECK: a budget constant with no reader is either a bug (the budget is not enforced) or a
leftover.** The turn budget *is* documented elsewhere in the same file (`:192`, `:204`, `:3449`), so
these two may be a second, unused copy of a live mechanism.

---

### D3. Prompts and copy

#### 3.1 `formatHarnessNotesBlock` — the reader is dead, the store is not

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

#### 3.2 The prompt registry — every entry has a real call site; the *drift* is the problem

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

#### 3.3 Comments naming files that no longer exist — **8 real hits** of 20 scanned

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

#### 3.4 User-visible strings promising removed features

| file:line | string | verdict |
|---|---|---|
| `components/analysis/InlineVerdict.tsx:86` | **"Inspect debate audit & evidence"** (button text) | SAFE — relabel |
| `components/settings/SessionUsagePanel.tsx:327` | **"Debate cost cap (USD, 0 = off)"** | SAFE — a **dead flag with a live control** (§2.13) |
| `components/settings/tabs/ModelsTab.tsx:127` | **"DEBATE MODERATOR"** (Settings → AI setup field label) | ⚠️ **SUPERSEDED BY THE WORKTREE (2026-10-20).** At the baseline the field still picked the verdict/arbiter model and needed a relabel. **The current worktree removes the field, the picker and its persistence entirely** — `hooks/useModeratorPick.ts` and `services/infrastructure/moderatorPick.ts` are deleted (unstaged), `ModelsTab.tsx` drops `moderatorProvider` / `moderatorModel` / `onSetModeratorProvider` / `onSetModeratorModel`, and `PREF_KEYS.LAST_MODERATOR_PICK` has **no remaining reference in the source**. **So the row is not "relabel" — the string goes away with the field, and the only residue is the `last_moderator_pick` Preferences key, which becomes a dead write.** Re-check against the worktree before acting. | NEEDS CHECK |
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

#### 3.5 Comments naming a deleted engine or module

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

#### 3.6 Stale behavioural comments — the file exists; the behaviour does not

- `services/learning/memoryHygiene.ts:15-16` — *"…the batch's new insights and then calls
  `pruneOutdatedInsights` + `aggregateSimilarInsights` in the same block"* — **neither is called**
  (§1.1 item 2). **The insight store is never pruned or merged.** NEEDS CHECK — is the pruning
  supposed to run?
- `components/analysis/RunContractPanel.tsx:36` — *"Persisted into DebateReplay via the message"* —
  `DebateReplay` no longer exists as a concept.

#### 3.7 Hardcoded statistics and dates in UI copy — **clean**

**[Verified by code reading]** comma-grouped fake counts in `components/`: **0 real hits** (the 10
regex matches are all CSS `rgba(255,255,255,0.04)` colour literals). Hardcoded percentages in UI
copy: **0 hits** — every percentage is computed (`.toFixed(2)` on a live number). Hardcoded dates
in UI copy: **0 hits** — all dates come from `utils/timezone.ts` (`phtStamp`/`phtFullStamp`) or
`relTime`.

#### 3.8 Terms ruled out

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

### D4. Tests

#### 4.1 Tests that cover only dead code

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

#### 4.2 Duplicate tests

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

#### 4.3 Brittle snapshot tests

`toMatchSnapshot` / `toMatchInlineSnapshot`: the sweep did not produce a count, and the vitest run
shows no snapshot-file failures. **[Unverified — needs a `rg "toMatchSnapshot" tests/` count]**
Recorded as a gap rather than a claim.

#### 4.4 Skipped tests

**[Verified live]** **8** skip/only markers in `tests/`. The 11 skipped *tests* are all inside
`tests/lensWordCount.measure.test.ts`, whose whole `describe` is `describe.skip` unless
`RUN_LENS_MEASUREMENT=1` (`:55-56`) — **deliberate and documented at `:7-8`**. **[Unverified — needs
the 8 markers enumerated]** which of the 8 are the file-level `describe.skip`/`it.skip` pairs and
whether any is an accidental `.only`.

#### 4.5 Fixtures with sensitive data

**[Verified live]** the working-tree scan for API-key patterns found **zero** hits outside
`tests/runStatus.test.tsx:90,94,98,100`, which are **deliberate fake keys in a sanitizer test
fixture** (the test asserts the error-text sanitizer strips them). The one literal-looking value
inspected is the test fixture at `tests/exportServiceProviderEncryption.test.ts:96` — **a test
string, not a credential**; cited by location only.

**No sensitive data in the test fixtures.** The *live* profile is where the data is, and this
audit did not touch it.

#### 4.6 Missing tests on critical paths

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

### D5. Dependencies

**[Verified live]** every dependency in `package.json` was mapped to its import sites across the
whole repository (source, scripts, e2e and tests).

#### 5.1 The one genuine orphan

| package | version | evidence | verdict | confidence |
|---|---|---|---|---|
| **`@fontsource/inter`** | `^5.3.0` | **0 import sites.** `index.css:169` names `'Inter'` in the `--font-sans` fallback chain (`'Geist Variable', 'Inter', system-ui, sans-serif`), **but no font file is ever loaded**, so the name resolves to nothing. `AGENTS.md` says the fonts are Geist / DM Serif Text / JetBrains Mono. | **remove the dependency AND the `'Inter'` fallback token** | **SAFE** |

#### 5.2 Ruled out — and the reason each false positive happened

| package | the trap | the truth |
|---|---|---|
| `@tailwindcss/typography` | a JS import scanner sees no import | **LIVE** — `index.css:2` `@plugin "@tailwindcss/typography";` |
| `@radix-ui/react-collapsible` | an alias-blind resolver | **LIVE** — `components/ui/collapsible.tsx:1` → `components/analysis/AnalysisProgress.tsx:14` |
| `openai` 4.52.7 | an old pin looks like a leftover | **LIVE** — `services/providers/GenericProviderService.ts:510` `new OpenAI({...})`, used for the `chat_completions` transport only; the `responses` format is a raw fetch (`:947`). **Outdated-major, NOT dead.** The 4.x pin is two years behind, but the shape it serves is the one the transport needs. |
| `@capacitor/android` 7.4.4 | no TS import | **a platform package** — required by the Capacitor CLI for the `android/` platform. Not dead. |
| `js-yaml` 4.3.1 (devDependency) | — | **correctly in devDependencies** — used only by `scripts/check-workflow-shells.cjs:32`. **But the committed lockfile's root `devDependencies` block does not list it** (§5.4) |
| `@types/node`, `@types/react`, `@types/react-dom`, `jsdom`, `tailwindcss`, `typescript`, `eslint`, `electron-builder`, `wait-on`, `concurrently`, `cross-env`, `@vitest/coverage-v8` | no import | **correctly in devDependencies** — they are used by the toolchain, not imported by app code |

#### 5.3 Section placement

| package | currently in | should be in | note |
|---|---|---|---|
| `@capacitor/cli` | `dependencies` | `devDependencies` | a build-time tool, not a runtime import. **Minor.** |
| `electron-builder` | `devDependencies` | correct | |
| `electron` | `devDependencies` | correct | the runtime is packaged by electron-builder, which bundles it |
| `js-yaml` | `devDependencies` | correct | |

**There is no separate `electron-builder` config file** — the `build` block in `package.json` is the
whole configuration.

#### 5.4 The lockfile drift

**[Verified live]** the **committed** `package-lock.json`:
- says `"version": "1.0.30"` while `package.json` says **`1.3.0`** — a three-minor-version mismatch;
- its root `packages[""].devDependencies` block **does not list `js-yaml`**, although `package.json`
  does and `scripts/check-workflow-shells.cjs:32` imports it.

**The fix is sitting uncommitted in the working tree** (the lockfile is the one dirty file at the
pin). **Committing it is a one-line-change commit.**

**The rest of the lock is otherwise in sync** with the manifest's ranges: `js-yaml`'s
`node_modules/js-yaml` entry **is** present in the lock (at `^4.1.0`, a transitive range), so only
the root block and the version are stale.

#### 5.5 `THIRD_PARTY_NOTICES.md`

**[Verified by code reading]** the file exists (58 lines) and carries per-file MIT attribution plus
a Gradle carve-out. **Two gaps:** `:26` names a *"debate/moderator harness"* — deleted; `:39` links
to `docs/desk/README.md` — **a ghost doc** (§8). The Gradle claim is **accurate** (the jar is
present; `android/` is 57 tracked files). **UPDATE.**

#### 5.6 Oversized packages

`pdfjs-dist` (a 1,343.6 kB worker chunk in the build, plus the library) ·
`katex` (the library **plus ~500 kB of TTF/WOFF fonts shipped for a feature most users never
touch**) · `recharts` (a 297 kB `AreaChart` chunk) · `lightweight-charts` ·
`technicalindicators`. **None is unused. All are reachable. The note is about *weight*, not
necessity** — and the app already lazy-loads the surfaces that use them.

---

### D6. Scripts, config and build

#### 6.1 npm scripts — three are referenced by nothing

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

#### 6.2 The `scripts/` directory — 18 files, and two of them are the biggest artefacts in the repo

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

#### 6.3 The `guards.yml` ratchet that no longer binds

`.github/workflows/guards.yml` fails the build if the entry chunk exceeds **2,600 kB**, with the
comment that *"the last measured entry chunk was ~1956 kB"*. **The measured entry chunk is
1,352.6 kB** — 31 % below the calibration point and 48 % below the ceiling. **The ratchet can no
longer catch the 363 KB-eager-import regression it was written for.** See Report 2 §E-06.

#### 6.4 CI steps that no longer test anything

**[Verified live]** the ci-vs-release script set difference is exactly `{installer-smoke}` in
release only and `{check-flow-doc-anchors, skill-approval-probe, test, typecheck}` in ci only —
**`AGENTS.md`'s claim is accurate.** Every step in `ci.yml`, `guards.yml` and `release.yml` maps to
a real gate. **No dead step was found.**

**Two asymmetries, both recorded and deliberate:** `release.yml` does **not** run
`check-flow-doc-anchors` or `skill-approval-probe` (`R-239`, `G-53` — *"a tag can still publish
with a dead line number in these docs"*), and `ci.yml`'s coverage floors are in `vitest.config.ts`
rather than in the workflow.

#### 6.5 The coverage floors

`vitest.config.ts:81-86` — lines 36 / statements 28 / functions 36 / branches 30. The comment
records the baseline as *"38.2 % lines / 30.0 % statements"*. **[Unverified — `npm run
test:coverage` was not run]** whether the tree is above the floor. **The floor is a ratchet that
can only be lowered, and it is 2 points below the recorded baseline — so it is close to binding.**

#### 6.6 Line endings and `.gitattributes`

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

#### 6.7 Generated files committed by mistake

`dist/` is **gitignored and not tracked** ✅. `coverage/`, `playwright-report/`, `test-results/` are
gitignored ✅. **`android/` is 57 tracked files** — the Capacitor Gradle host, the Java plugin and
the launcher resources. **`android/app/build` and `android/app/src/main/assets` are gitignored**
(`android/app/build` is in `.gitignore`), so no build output is committed. **No finding.**

---

### D7. Assets and repo hygiene

#### 7.1 Large files in git

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

#### 7.2 Binaries in git

`png` × 12, `webp` × 2, `ico` × 1, `ttf`/`woff`/`woff2` × (the KaTeX fonts, shipped — and they are
**build output**, committed as source because `katex` ships them), `jar` × 1
(`android/gradle/wrapper/gradle-wrapper.jar` — **necessary** for a reproducible Gradle build), and
`apk` × 2 **in history only** (§7.5).

#### 7.3 Files that should be ignored but are tracked

`docs/plans/reference/*.png` — arguably reference material, arguably should be ignored. **LOW.**

#### 7.4 Secrets and personal data

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

#### 7.5 Git history: **52 MB of APKs**

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

#### 7.6 The four orphan commits — **the previous audit is one `git gc` from being lost**

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

#### 7.7 Branches, worktrees and stashes

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

#### 7.8 Tags

**[Verified live]** 36 tags: `v1.0.0` (2026-07-25) … `v1.0.33`, then `v1.1.0` (2026-09-29) and
**`v1.2.0` (2026-10-01)**. **No two tags point at the same commit.**

**⇒ `v1.3.0` is not tagged, but `package.json` says `1.3.0` and `changelog.md`'s newest entry is
`v1.3.0`.** So the repository is **one release ahead of its last tag** — the v1.3.0 work is what HEAD
contains. `R-276` shipped a test that fails if the changelog's version and `package.json`'s disagree
(they agree ✅).

#### 7.9 The four version numbers

| source | value |
|---|---|
| `constants/version.ts:6` (the dev/test fallback) | **`1.0.28`** |
| `package-lock.json` (committed) | **`1.0.30`** |
| the newest **tag** | **`v1.2.0`** |
| `package.json` **and** `changelog.md`'s newest entry | **`1.3.0`** |

**Four numbers in one repository.** The `constants/version.ts` comment says the literal is *"kept
synced with package.json"* — **it is five minor versions behind.** See Report 2 §E-15.

#### 7.10 Untracked clutter on disk

**[Verified live]** `git status --porcelain --untracked-files=all` at the pin: only `M
package-lock.json` (plus the concurrent session's 70 paths). The repo root also holds
**~17 log files** — `.boot-probe.log`, `.e2e.log`, and 15 `.probe-*.log` — plus `.probe-artifacts/`,
`test-results/`, `.freebuff/`, `.workbuddy-ai/`, `.openclaw-attachments/`, `dist/` and
`node_modules/`. **All are covered by `.gitignore`** (`*.log`, `.probe-artifacts/`,
`test-results/`, `.freebuff/`, `.workbuddy-ai/`, `dist/`, `node_modules/`). **No finding.**

#### 7.11 Orphan folders and naming

| folder | tracked files | verdict |
|---|---|---|
| `lib/` | 1 (`utils.ts`) | **live** (via the `@/` alias) but **a single file in a `lib/` folder** is an odd shape for a repo whose convention is `utils/`. **LOW.** |
| `plugins/` | 1 (`GallerySaver.ts`) | the §1.1 item 4 decision |
| `.openclaw-attachments/` | 1 (a `.txt` file) | **a tool's scratch in the repo root**, tracked. It contains a note that corroborates §2.11. **LOW — but it is a `.txt` from a tool, and it is the only place the "write-only GlobalMemory ledger" claim is written down.** |

---

### D8. The docs audit

**[Verified by code reading]** — 33 doc files (21 under `docs/` including 1 HTML and 7 PNGs, 8 root
including `LICENSE`, 3 `.github/` workflows) plus `index.html`.

#### 8.1 The table

> ⚠️ **UPDATED 2026-10-19 — this table has been ACTED ON.** The owner's instruction was *"scan all
> md plan in docs and find what still not implemented and merge it to the full audit, if its
> implemented and stale delete it."* **18 of the plan documents in this table have been DELETED**
> (rows 4, 5, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29). Their still-open
> items were harvested into **`docs/plan/open-items.md`** (Part F of the
> merged audit) — **121** open items + **24** owner decisions, each with the `file:line` that proves it is
> open. **The full execution record, the rescue list and the 17 repointed code/test comments are in
> §14 below.** Rows 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 14, 30, 31, 32, 33, 34 were **kept** — they are
> living documents, not plans, and several still need UPDATE (rows 1, 2, 6, 7, 11, 12).


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

#### 8.2 `docs/app-flow.md` — the one doc worth *repairing* rather than archiving

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

#### 8.3 The proposed docs structure — and the eight documents to **write**

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

#### 8.4 The contradiction register (13)

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

### D9. The batches

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

#### BATCH 0 — PROTECT THE ORPHAN COMMITS *(do this first; it is not a code change)*

| item | evidence | confidence | rollback |
|---|---|---|---|
| Recover the six markdown files from `508b691a` to a durable location, and **do not delete `refs/cline/checkpoints/*`** until they are safe | §7.6 — four unreachable commits; `git gc --prune=now` would destroy them, including the only written record of G-01/G-02/G-06 | **SAFE** | n/a — additive |
| **Also decide `docs/analysis/`'s fate** before this session's reports are followed by more | `eslint.config.js:26` already ignores it; `R-256` and the 13-conclusion `app-flow.md` are all anchor-sensitive | **SAFE** | n/a |

**GATE:** none (no code changes). **This is the one item that gets worse with time.**

#### BATCH 1 — STALE COPY AND COMMENTS *(lowest risk; text only)*

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

#### BATCH 2 — ORPHAN FILES

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

#### BATCH 3 — DEAD MODULES AND EXPORTS

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

#### BATCH 4 — DEAD DATA PATHS *(the behavioural one)*

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

#### BATCH 5 — DEAD PROMPTS

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

#### BATCH 6 — DEPENDENCIES, CONFIG AND BUILD

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

#### BATCH 7 — DOCS RESTRUCTURE

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

### D10. Items that OVERLAP the roadmap — do not clean these blindly

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

### D11. What this manifest deliberately does **not** propose

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

### D12. Addendum — three gaps the first draft of this manifest left open

An honest self-audit against the brief's Part D list found three items that were covered only
implicitly. They are closed here.

#### 12.1 The per-store schema, version and growth table

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

#### 12.2 The brief also asked about **duplicated packages** — and there is one duplication nobody has named

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

#### 12.3 "Tests that assert nothing" — the systematic scan, and its result

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

---

### D13. Addendum — the orphan class neither audit had named, and one stale comment

#### 13.1 **Dead-by-transitivity**: four modules that are only reachable from a dead module

The previous audit's dead-module list (§2.14) and my own orphan sweep (§1.1) overlapped but did not
match exactly. The difference is a class neither named.

**My sweep found modules with ZERO inbound edges. Their list included modules that DO have an
importer — but the importer is itself dead.** A module imported only by a dead module is dead; it
simply does not show up in a zero-inbound-edge scan.

| module | its only importer | that importer's state |
|---|---|---|
| `services/analysis/EntryTimingService.ts` | `services/validation/TradeValidationGate.ts` | **dead** — `TradeValidationGate` is imported only by `tests/accuracyValidation.test.ts` |
| `services/validation/ValidationConstants.ts` | `services/validation/TradeValidationGate.ts` | **dead** — same |
| `services/analysis/convictionDrift.ts` | `services/analysis/TradeValidationGate.ts` (or a test) | **dead** — same |
| `utils/navModality.ts` | — | **dead** — no production importer |
| `services/infrastructure/SessionGuardService.ts` | — | **dead** — and it is the **only reader of the trader's `equityUsd`**, so the equity setting is configured in Settings (`components/settings/SessionUsagePanel.tsx:149`) and read by nothing in production |

**⇒ five more modules to the manifest, and the fourth one is a *setting* with no reader** — the same
class as the three dead `PREF_KEYS` in §2.3, but a fourth instance: `equityUsd` is a live
user-facing field whose only reader is unreachable.

**Confidence: SAFE for the deletion of the four modules; NEEDS CHECK for `SessionGuardService`,
because `equityUsd` is a live setting and the right answer may be to *wire* it (it is the
liquidation-buffer guard) rather than delete it.** **[Verified by code reading]** at HEAD
`69c4aa33`; the importers must be re-checked after the in-flight tree settles (Report 0 §0.11).

#### 13.2 One more stale comment, in the class of Report 4 §3.6

| file:line | the comment | the code | confidence |
|---|---|---|---|
| `services/ui/OutcomeAutopilotService.ts:7` | *"Runs a **60s** loop only while…"* | `const CHECK_INTERVAL_MS = 20_000;` (`:85`), used at `:352` | **SAFE** |

This is the **third** instance of the same defect class in this file family: the comment says 60 s,
the code says 20 s. The prior audit found it; I did not. **[Verified by code reading]** at HEAD.

#### 13.3 The "green suite over dead code" case, at its sharpest

`applyNotebookSkillsToAnalysis` — the function that applies the hard `avoid` veto, the candidate cap
and the confidence downgrade — has **ten test call sites across four test files and zero production
call sites** (`services/learning/SkillMemoryService.ts:3494` is the definition; every actual call is
in `tests/approvalGate.test.ts`, `tests/decisionBiasClosure.test.ts`, `tests/harnessMemory.test.ts`
and `tests/learningLoopMachinery.test.ts`). `VetoLedgerService.recordVeto` is the same shape:
**seven test call sites, zero production call sites.**

**⇒ a reviewer reading only the test suite would conclude the deterministic skill layer is
enforced, active, and well-tested. It is none of those three things.** This is the single best
argument in the whole audit for E-24 (behavioural coverage for the shell) and E-11 (a test that
asserts what is *sent*): **the tests are rigorous about the code they can reach, and the code that
matters is the code nothing reaches.**

**Confidence: SAFE (it is a measurement, not a change). The proposed change — wiring it — is
Report 2 §3C.2, E-35.**

---

### D14. Addendum — the plan-document cleanup, executed

**Executed:** 2026-10-19, after the owner's instruction to *"scan all md plan in docs and find what
still not implemented and merge it to the full audit, if its implemented and stale delete it."*

**The register that replaced them: `docs/plan/open-items.md`** (Part F of
the merged audit) — **121 open items + 24 owner decisions**, each with the `file:line` that proves
it is still open, each mapped to the proposal that covers it, plus the **5 prior-audit rows that
did not survive re-verification** and the **15 "facts paid for"** rescued from `stage3-status.md`
before it went.

#### 14.1 What was deleted — 18 documents

| deleted | why it qualified | where its content went |
|---|---|---|
| `docs/desk/README.md` | the 2D desk floor was **deleted**; 100 % of its cited paths are dead; 0 open items | nothing to salvage |
| `docs/plans/chat-dock-reference.md` | the surfaces were rebuilt three times; 100 % dead paths | its **7 PNGs are kept** — they are the only committed screenshots of this app |
| `docs/plans/docs-audit-2026-10-06.md` | its 7 dispositions were still un-actioned | O-98…O-106, Q4, D-04 |
| `docs/plans/flow-ui-audit-2026-10-15.md` | superseded by the 2026-10-10 redesign; its Tier-4 findings are still open | O-65…O-75, O-79, O-81, O-100 |
| `docs/plans/memory-skills-research-2026-10-10.md` | its durable finding survives | O-30, O-38…O-41 |
| `docs/plans/redesign-plan-claude-chatgpt-haze-2026-10-10.md` | **it is the design that shipped**; the binding rules are already in `docs/ui-doctrine.md` | O-62, O-90, O-91, and the density/type cluster |
| `docs/plans/reference-transcript-catalog-copy.md` | a copy spec for a UI rebuilt three times | O-14, O-45, O-51, D-14, D-15 |
| `docs/plans/stage1-ui-ux-spec.md` | 35 % of its cited paths are dead; its own header admits no screenshots | O-69…O-71, O-83…O-86 |
| `docs/plans/stage2-implementation-plan.md` | Phase 0–2 shipped; Phase 3/4 open | O-04, O-69, O-76, O-93…O-95, O-106 |
| `docs/plans/stage3-arrangement.md` | Phase A–G shipped | O-49 |
| `docs/plans/stage3-status.md` | historical status | **the 15 "facts paid for" are rescued verbatim** (register §3.1) · O-50 |
| `docs/plans/ui-redesign-deep-dive-2026-10-10.md` | a baseline against `78f99bd` whose artefacts are gitignored — **its numbers are unfalsifiable** | O-66…O-71, O-83, O-90 |
| `docs/plans/ui-ux-target-plan-2026-10-11.md` | overthrown by the 2026-10-15 audit | D-18, D-19, D-21, D-22, O-38, O-46, O-53 |
| `docs/plans/workstream1-status.md` | its open items are the register's | O-32, O-35, O-45, O-60, O-96 |
| `docs/plans/workstream1-stepB-evidence.md` | its 14 activation paths are still live — and are now O-32 | O-32, O-33; its method line is rescued |
| `docs/plans/workstream1-stepB-gap-audit.md` | its 4 gaps are moot | its method line is rescued |
| `HANDOFF_LEARNING_LOOP.md` | IMPLEMENT-1…6 shipped | O-42, O-43, O-44, D-16, D-17 |
| `PLAN_LEARNING_LOOP_AND_UI.md` | WS-1…WS-6 shipped | O-40, O-41, D-22 |

**Every deletion is a tracked `git rm`, so every one is one `git revert` away.** The content also
stays in `main`'s history.

#### 14.2 What was KEPT, and why

| kept | why |
|---|---|
| `docs/plans/debate-deletion-status.md` | **the dated history ledger** — it names deleted files on purpose, and **`scripts/check-flow-doc-anchors.cjs:44` scans it**: `const DOCS = ['AGENTS.md', 'docs/app-flow.md', 'docs/app-flow.html', 'docs/plans/debate-deletion-status.md']`. **Deleting it breaks a gate.** |
| `docs/app-flow.md` / `.html` | living and machine-checked — 303 verified anchors, 0 unattributed |
| `docs/learning-loop-map.md` | living; needs UPDATE (three wrong rows), not deletion |
| `docs/ui-doctrine.md` | living; needs a 2 px correction (O-87) |
| `docs/plans/reference/*.png` (7) | the only committed screenshots of this app |
| `AGENTS.md`, `README.md`, `PRIVACY.md`, `THIRD_PARTY_NOTICES.md`, `changelog.md` | living, and not plan documents |

#### 14.3 The dangling references, and what was done about them

**No test *reads* any plan document** — every reference was a *comment*. There were **17** of them,
across 16 files, pointing at 4 of the deleted documents.

| file | reference |
|---|---|
| `index.css:297` | the redesign plan |
| `tests/radiusRamp.test.ts:8`, `tests/typeRamp.test.ts:10` | the redesign plan |
| `components/learn/MemoryTopicPanel.tsx:14`, `MemoryTopicsCard.tsx:8`, `SkillViewerPanel.tsx:17` | the 2026-10-11 target plan |
| `components/skills/SkillsLibrary.tsx:7` | the 2026-10-11 target plan |
| `services/learning/memoryTopics.ts:3`, `memoryTopicEdits.ts:3` | the 2026-10-11 target plan |
| `services/infrastructure/ExportService.ts:405`, `services/learning/approvalMigration.ts:18` | workstream-1 status |
| `tests/agentsSurface.test.tsx:778,829`, `tests/answerActionRow.test.tsx:124`, `tests/proposedTrade.test.ts:104`, `tests/skillViewerPanel.test.tsx:2`, `tests/approvalGate.test.ts:4` | the plan docs |

**All 17 were repointed at the surviving register** — `docs/plan/open-items.md` —
so no comment now names a file that does not exist. **16 files changed, 17 lines.**

`THIRD_PARTY_NOTICES.md:39` named `docs/desk/README.md`; it was rewritten to state the fact instead
of linking a ghost: the avatars are hand-built on a 16×20 grid *"so that no sprite sheets are
imported"*, and the 2D desk floor they were built for was deleted on 2026-10-18.

#### 14.4 The gates after the change

| gate | result |
|---|---|
| `npm run typecheck` | **exit 0**, 0 errors |
| `npm run lint:loose` | **676 problems, 0 errors** (682 before — the 16 comment edits and the concurrent session's own changes) |
| `npm run test` | see §14.6 |

#### 14.5 A note on the method — the register is a *measurement*, not a transcription

Every "still open" row in the register carries a `file:line` that proves it is open **at HEAD**. That
is the difference between this register and the plan corpus it replaces, which carried *claims*.

**And it changed the answer.** Five rows from the previous audit **did not survive re-verification**,
and the register says so rather than repeating them:

| prior row | verdict at HEAD `56639b4b` |
|---|---|
| `recordToolTurnUsage` has a reader and no writer | **CORRECTED** — it has three production callers |
| `runEnsembleEnabled` survives as a half-live flag | **CORRECTED** — the flag is gone, and a test asserts it is |
| the supervisor auto-approves drafts with no human | **CORRECTED** — it is auto-**triage** only; the narrower truth (auto-triage on by default, no UI off-switch) is O-34 |
| `analysisPrompts.ts:299` "Family C … highest win rate (~86 %)" | **CORRECTED** — not found; the file is 190 lines and the phrase does not exist |
| the 14 activation paths | **PARTLY CORRECTED** — path 5 is stale; the other 13 remain live and are now O-32 |

#### 14.6 The test run

See the table in the delivery note. The run was executed in a **throwaway copy**
(`%TEMP%\august-audit\gate-copy`, a `git init`-ed snapshot of the post-change working tree, with
`node_modules` junctioned read-only) — **never against the live tree or a live profile.**

---

### D15. The test-removal plan

**Added 2026-10-20** at the owner's request: *"include in the plan to remove all those useless
test"*.

**The honest headline first: the tests are the symptom. The disease is 13 modules the app never
loads — and the largest one is the product's core promise.**

#### 15.1 The measurement

A reachability graph over **521 source modules** from the real entry points (`index.tsx`,
`App.tsx`, `electron/main.cjs`, the e2e spec, and the 20 gate scripts), resolving static imports,
`export … from`, `import()` (including `React.lazy` and `new Worker(new URL(...))`), `require()` and
the `@/` alias, then classifying all **475 test files** by what they actually exercise.

**[Verified live] 492 of 521 source modules are reachable. 29 are not.**

| bucket | files | lines | verdict |
|---|---|---|---|
| **A** — exercises only code the app never loads | 10 | 1,523 | **6 are candidates, 4 are NOT** (see §15.3) |
| **B** — exercises both live and orphan code | 15 | 3,483 | **keep the file, drop the dead side-import** |
| **C** — exercises only live code | 420 | 69,944 | keep |
| **D** — imports no source at all (self-contained) | 30 | 3,602 | keep |

**A correction to the numbers, so they are not misread:** a test that imports a *test helper*
(`tests/helpers/sourceCode.ts`, `tests/jsxScan.ts`) is counted as "exercising an orphan" because
helpers are not in the reachability set. **Those four are repo-wide source guards, not dead-code
coverage.**

#### 15.2 The 13 modules the app never loads

**Every one of these has ZERO production importers** — their only importers are tests, or other
dead modules. Verified with a direct `from '…'` grep, not the graph.

| # | module | lines | who imports it | what it is |
|---|---|---|---|---|
| 1 | **`services/validation/TradeValidationGate.ts`** | **986** | **nothing** | **the 20-check validation gate — the product's "deterministic code checks" half** |
| 2 | **`services/backtesting/BacktestingService.ts`** | **1,414** | **nothing** | the backtest engine; `utils/riskReward.ts:7` cites it in a **comment** as the realized-R authority |
| 3 | **`components/analysis/AnalysisProgress.tsx`** | — | **nothing** | the **step ladder** — the roadmap's F-73 says it is "muted"; it is **not mounted at all** |
| 4 | `services/analysis/EntryTimingService.ts` | — | only the dead gate | |
| 5 | `services/analysis/ProbabilityEngineService.ts` | 313 | tests only | |
| 6 | `services/providers/debatePods.ts` | 142 | tests only | the debate engine's last remnant |
| 7 | `utils/incrementalMarkdown.ts` | 111 | tests only | |
| 8 | `utils/seriesPalette.ts` | 30 | tests only | |
| 9 | `utils/preRead.ts` | — | tests only | its own comment in `hooks/useWatchAndAutopilot.ts` says the feature *"was deleted in the audit purge: its only UI … never existed"* |
| 10 | `services/analysis/convictionDrift.ts` | — | tests only | |
| 11 | `services/learning/providerFitness.ts` | — | tests only | only a **comment** in `ModelPerformanceService.ts` names it |
| 12 | `utils/ticketSize.ts` | — | tests only | **the sizing module the plan WIRES (E-12)** |
| 13 | `services/learning/chartScanSkills.ts` | — | tests only | only a **comment** in `draftGates.ts` names it |

##### 🔴 The one that changes the plan: **the validation gate is not wired**

`grep 'runValidationGate\|TradeValidationGate'` over every non-test file returns **four hits, and
three of them are comments or the definition**:

```
services/analysis/EntryTimingService.ts:588      * Generate a compact warning for TradeValidationGate
services/backtesting/StopLossOptimizerService.ts:332   * Generate warning for TradeValidationGate
services/validation/TradeValidationGate.ts:2      * TradeValidationGate - Central validation orchestrator
services/validation/TradeValidationGate.ts:495    export const runValidationGate = (
```

**⇒ The app's 986-line, 20-check validation gate — with the R:R floor, the pattern-memory
downgrade, the volume cap, the Devil's Advocate, the scalp/swing branch and the confidence ladder —
has no production caller.** Only `GateKeeperService` (a *narrower* gate: a confidence cap and a
family pre-filter) is wired, via `services/trade/proposalGate.ts`.

**This closes the plan's own open question.** `docs/plan/open-items.md` **O-10** was recorded as
*"The full validation gate may not be wired at all — `runValidationGate` has zero production
importers"*, status **OPEN-VERIFY**. **It is now OPEN, with the evidence.** And it reframes two
existing items:

- **E-02** (one R:R formula) was framed as a *drift* fix. It is **bigger than that**: the formula
  being fixed is in a module **nothing calls**. **E-02 must first become "wire the gate, or
  retire it"** — and that is an owner decision, not a refactor.
- The same applies to **`services/backtesting/BacktestingService.ts`** (1,414 lines), which
  `utils/riskReward.ts:7` cites in a comment as *"the realized ratio in `BacktestingService`"* —
  **a comment pointing at a module the app never loads.**

**⇒ The two biggest items in the dead-module list are not leftovers. They are the two halves of
the product's promise that were never connected.**

#### 15.3 The batches

##### **Batch T1 — the unambiguously dead** *(5 test files, 482 lines, + 4 modules, 596 lines)*

| test file | lines | module | lines |
|---|---|---|---|
| `tests/debatePods.test.ts` | 101 | `services/providers/debatePods.ts` | 142 |
| `tests/probabilityEngine.test.ts` | 164 | `services/analysis/ProbabilityEngineService.ts` | 313 |
| `tests/lazySurfaceSkeletons.test.ts` | 83 | (the same module) | — |
| `tests/incrementalMarkdown.test.ts` | 92 | `utils/incrementalMarkdown.ts` | 111 |
| `tests/seriesPalette.test.ts` | 42 | `utils/seriesPalette.ts` | 30 |

**Gate:** `npm run typecheck && npm run lint && npm run test && npm run test:coverage`.
**Risk: LOW.** **Rollback:** `git revert` — the test *and* its module in one commit.
**Note:** `ProbabilityEngineService` carries 313 lines and two test files; delete both tests with
the module, or the second test is left pointing at nothing.

##### **Batch T2 — dead-by-decision** *(6 test files + 6 modules — **HELD**)*

| test file(s) | module | the decision that must come first |
|---|---|---|
| `tests/accuracyValidation.test.ts` | `services/validation/TradeValidationGate.ts` (986) | **wire the gate (E-02a) or retire it (E-02b).** The test is the only proof it works — if the gate is going to ship, the test must survive; if it is going, the test goes with it. **Do not delete before the decision.** |
| `tests/backtestingKlineLadder.test.ts`, `tests/backtestingOutcomes.test.ts`, `tests/validateTradeOutcome.test.ts` | `services/backtesting/BacktestingService.ts` (1,414) | the same question: is the backtest engine part of the product, or is the **replay harness (E-20)** its replacement? |
| `tests/runStatus.test.tsx`, `tests/stoppedStepReason.test.tsx` | `components/analysis/AnalysisProgress.tsx` | the step ladder — the roadmap's F-73. Wire it, or delete it and its two tests. |
| `tests/planLevelLocation.test.ts` | `services/analysis/EntryTimingService.ts` | follows the gate's fate |
| `tests/convictionDrift.test.ts` | `services/analysis/convictionDrift.ts` | standalone; safe to delete with its module |
| `tests/preRead.test.ts` | `utils/preRead.ts` | the module's own comment says the feature was deleted — **safe to delete with its module** |

**Gate:** same as T1. **Risk: MEDIUM** — three of these are decisions, not deletions.

##### **Batch T3 — the 15 mixed files: keep the file, drop the dead import**

These 15 files test **live** code and also import a module the app never loads. **The file stays;
only the dead side-import goes.** 3,483 lines of coverage are not collateral damage.

`tests/accuracyValidation.test.ts` · `tests/analysisUtils.test.ts` · `tests/auditFixes.test.ts` ·
`tests/backtestingKlineLadder.test.ts` · `tests/backtestingOutcomes.test.ts` ·
`tests/convictionDrift.test.ts` · `tests/decisionBiasClosure.test.ts` ·
`tests/drawVisibilityReceipt.test.ts` · `tests/drawingCapAndChartTruth.test.ts` ·
`tests/financialMath.test.ts` · `tests/planLevelLocation.test.ts` · `tests/preRead.test.ts` ·
`tests/runStatus.test.tsx` · `tests/stoppedStepReason.test.tsx` · `tests/validateTradeOutcome.test.ts`

*(listed for completeness; in practice the import disappears with its module in T1/T2)*

##### **Batch T4 — the ones that LOOK useless and are NOT** *(849 lines, keep)*

| file | lines | why it must stay |
|---|---|---|
| `tests/themeContrast.test.ts` | 393 | a **repo-wide source guard** — it scans the source tree as text for contrast violations. It imports `tests/jsxScan.ts`, a *helper*, which is why it looks like an orphan. |
| `tests/jsxNesting.test.ts` | 283 | the same: a **repo-wide JSX-nesting guard** over the whole source tree |
| `tests/sourceCodeHelper.test.ts` | 96 | it tests the **guard machinery** every other source guard depends on |
| `tests/aiTrendlinesDrawn.test.ts` | 77 | a source-text guard on the trendline wiring |

**⇒ 849 lines that a naive "orphan subject" scan would have deleted, and that are among the most
valuable files in the suite.** They are the repo's own lint, in test form.

#### 15.4 The keep-list — the four that look removable and must not be

| test | lines | why it stays |
|---|---|---|
| **`tests/ticketMathTiers.test.ts`** | 187 | it is the **only** coverage of `utils/ticketSize.ts` — and **the plan wires that module (E-12)**. Deleting the test before the module ships removes the only proof it works. **HOLD.** |
| **`tests/accuracyValidation.test.ts`** | — | the only coverage of the validation gate, whose fate is the decision in T2. **HOLD.** |
| **`tests/financialMath.test.ts`** | — | 5 live subjects, 1 orphan side-reference. **KEEP the file.** |
| the 420 bucket-C files | 69,944 | live coverage |

#### 15.5 The rule this batch must obey

1. **A test and its dead module go together, or neither.** A test that outlives its subject is the
   exact defect in Report 4 §4.1 — a green suite that proves nothing.
2. **Never delete a test to make a number smaller.** The suite's value is its coverage of what
   *ships*; the number of files is not the metric. **Before any deletion, confirm the subject
   module has zero production importers** — a `git grep` for the import specifier, not a reachability
   pointer.
3. **Never delete a source-text guard.** A guard that reads the repo as text is the repo's lint;
   it has no import graph to be orphaned from.
4. **A test for a module the plan intends to WIRE is not dead — it is the acceptance test.** That is
   `tests/ticketMathTiers.test.ts`, and it is why the order is: **decide the module's fate (T2) →
   then delete (T1/T2) → never the other way round.**

#### 15.6 What this does to the plan

| item | change |
|---|---|
| **E-02** (one R:R formula) | **reframed.** It is not a drift fix in a live module — it is a fix in a module **nothing calls**. **E-02 splits: E-02a "wire the gate" and E-02b "retire it".** E-02b is a **much cheaper** outcome (delete 986 lines + a test) and E-02a is a much bigger one (ship the gate the product promises). **It is the owner's call, and it is the single highest-leverage decision in this plan.** |
| **O-10** | **OPEN-VERIFY → OPEN**, with the evidence. |
| **O-129** (new) | the dead-module list itself, so the register carries it. |
| **E-50** (new) | **the test-removal batches T1–T4** as a cleanup item, with the keep-list. |
| **F-73** (the roadmap's "step ladder is muted") | **resolved to "not mounted at all"** — `AnalysisProgress.tsx` has zero production importers. |


<div style="page-break-after: always"></div>

---

## Part E — Report 5 — Order, go/no-go, open questions, coverage

<sub>Source: `docs/plan/audit/2026-10-19-05-ordering-and-open-questions.md`</sub>

<!-- original part title: Report 5 — The recommended order, go/no-go, open questions, and coverage -->

**Pinned commit:** `6a41a9f7e3b3986236c3000862d326f1e95dfad1` (branch `main`)
**Date:** 2026-10-19
**Output items 6–8 of the brief.**

---

### E1. The one-paragraph version

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

### E2. The recommended order

Three streams, interleaved. **W** = a roadmap wave, **C** = a cleanup batch.

#### Phase 0 — STOP AND RE-ANCHOR *(no code changes)*

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

#### Phase 1 — the two decisions that unblock everything *(owner rulings, not code)*

| # | decision | what it unblocks | proposed default |
|---|---|---|---|
| 1.1 | **What happens to the assembled context?** (F-01) — wire it, or cut it? | E-01, E-05, E-11, E-18, E-19, N-03, N-08, N-10, N-18, N-20 — **ten proposals** | **Cut it first (E-01b), then wire deliberately (E-01a) as a measured follow-up.** The pull path already exists; the push path's budget was never settled. And **flip `recordInjections` to default-false in the same change** (E-05), or the ledger keeps lying while you decide. |
| 1.2 | **Does the outcome need a human click?** (F-18 / G-04) | E-18, N-13, N-14, N-15, N-16, N-20 — **six features**, every one of them **[DATA-GATED]** | **Automatic with provenance and a correction path — and a shadow month first** (resolve, show, do not record; report the disagreement rate). **This is the highest-leverage decision in the repository, and it is not a code change.** |

**Neither decision requires a commit.** Both require the owner.

#### Phase 2 — the cheap, safe correctness wins *(the cleanup's front)*

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

#### Phase 3 — the roadmap's own wave, and the two behavioural corrections

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

#### Phase 4 — the big bets, in dependency order

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

#### Phase 5 — the things that need the owner, and the things that need a decision to be made

| # | item | what is needed |
|---|---|---|
| 5.1 | **E-14 / the backup lists** (`approval_rules_v1`, the 5 restore-listed-but-not-RAW namespaces) | an **owner decision** on what should be in a backup. The repo's own test says *"worth a decision"* and the decision was never taken. |
| 5.2 | **E-03's fee tier** | the trader's real numbers |
| 5.3 | **E-44's notebook sharding** | a decision on whether one blob is acceptable |
| 5.4 | **The `fullscreen` branch, the two rails, the HUD wording, the 23 owner decisions** | the owner |
| 5.5 | **The history rewrite** (52 MB of APKs) | a coordinated decision at a release boundary, with the remote branches deleted first |

---

### E3. Go / no-go per batch

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

### E4. Open questions — only the owner can answer these

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

### E5. Coverage statement

#### 5.1 What was read — in full

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

#### 5.2 What was run

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

#### 5.3 What was **not** run, and why

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

#### 5.4 Two claims this audit made and then **withdrew**

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

#### 5.5 What is **not** covered

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

#### 5.6 The honesty clause

**Every number in these six reports is a command output, a `file:line`, or a labelled estimate.**
Where a number came from the previous audit, it is attributed and re-verified. Where a number
could not be verified, it says so and names what would settle it. **No figure is invented, and
no claim rests on a document.**

---

### E6. What this audit believes, in one page

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

### E7. Cross-check against the previous audit — **does the current plan contradict it?**

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

#### 7.1 Every prior recommendation, mapped

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

#### 7.2 The one divergence, in full

**We agree on the decision; we differ on the default.**

| | |
|---|---|
| **Their default (QW5 + M1a)** | inject `enhancedPrompt` on the pipeline path, naming the block it displaces under the existing zero-sum packet budget |
| **My first default (E-01), superseded** | ~~cut the assembly first, then re-add deliberately, budgeted and measured~~ — **this was the stale half; see the row below** |
| **Their M1b** | delete the fetch and the assembly, and rely on tools |
| **✅ THE ONE RECOMMENDATION, now the same everywhere** | **Inject and record together, or neither.** **(1) Inject the harness contract** into the P1/P2/P3 system prompts — **1,582 chars**, carrying the **confidence ladder**, the **risk rules** and the **`HARNESS_TURN_MARK` convention**, the only text in the app that tells a seat which words are the trader's and which are the app's. It closes the C-5 contradiction immediately, where the mark is used in the user role and explained nowhere. **(2) Cut the retrieved context by default** — the expensive part of `enhancedPrompt` is the *retrieved context*, not the contract, and the pull path (`recall`, `get_notebook_map`, `read_memory`) already exists. **(3) Flip `recordInjections` to default-false in the same change** (`services/learning/MemoryRetrievalService.ts:976-981`), or the ledger keeps recording skills the model never saw while you decide. |

**This is not a contradiction between the two audits. It is one audit naming a third option the other did not consider, and the resolution is in Report 2 §3C.1.**

#### 7.3 The sixteen findings I did not have — all re-verified at HEAD

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

#### 7.4 What this changes about the recommended order

**One dependency is now explicit and it was missing:** **E-37 (raise the evidence floors) must land
BEFORE E-18 (fix the outcome loop).** Fixing the outcome loop without raising the floors
manufactures confident nonsense from three-trade clusters and two-trade vetoes, and then acts on
it. The prior review called this *"the 'do it in the same release' dependency"*; it is a **same-release
dependency, not a same-release convenience.**

**And E-38 (the validity window) must land with E-18**, because the "net expectancy" claim E-18
enables is worthless while the denominator excludes the setups that never triggered.

#### 7.5 The honest summary of the relationship between the two audits

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

### E8. The three new features, in the order

**Added 2026-10-20.** The deep dives are in Report 1 §12; the proposals are Report 2 §3D and
Report 3 §11. The order below is by **dependency**, and it interleaves with Phases 0–4 above.

#### Where they land

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

#### The dependency that matters most

```
E-48 stage 1 (diagnose)  →  E-48 stage 2 (propose fixes)  →  E-46a (level-3 resources)
        S                        M                              L
```

**Do not build level-3 resources before the review job exists.** A skill split into a card plus a
`references/` note is a **storage-shape change to the one store the app cannot regenerate**; the
review job is the safety net that finds a broken split. Building the split first means a bug
truncates a procedure with no way to notice.

#### Two things these features do **not** do

- **They do not place an order, write to an exchange, route on regime, revive the debate engine, or
  add an LLM review call to a live trading decision.** E-48's model stage is a **one-off batch over
  the trader's own library**, opted into, capped, and estimated before it starts — the same shape
  as the candidate log the owner already approved.
- **They do not change the skills format.** The format is **already** a documented Agent Skills port
  (`services/learning/SkillMemoryService.ts:411-431`), with the spec's two required fields, a
  two-face split so a spec-only file loads, and progressive disclosure at two of three levels. **E-46
  and E-47 close the remaining gaps; they do not redesign what works.**


<div style="page-break-after: always"></div>

---

## Part F — The consolidated open-items register (what is still NOT implemented)

<sub>Source: `docs/plan/open-items.md`</sub>

<!-- original part title: 2026-10-19-07 — The consolidated open-items register -->

**Created:** 2026-10-19 · **Pinned commit:** `6a41a9f7` (the audit's pin) — re-verified against
HEAD `56639b4b` at the time of writing.
**Purpose:** this is the surviving record of **everything the plan corpus said that is not yet
implemented**. It replaces the 18 plan documents it was extracted from.

---

### F0. How this register was built

**Sources scanned — 19 plan documents, every markdown file under `docs/` plus the two root
plan-shaped files:**

| file | lines | repo paths it cites | of those, **dead** | % stale |
|---|---|---|---|---|
| `docs/desk/README.md` | 68 | 1 | 1 | **100 %** |
| `docs/plans/chat-dock-reference.md` | 92 | 2 | 2 | **100 %** |
| `docs/plans/debate-deletion-status.md` | 2,404 | 147 | 18 | 12 % |
| `docs/plans/docs-audit-2026-10-06.md` | 224 | 16 | 1 | 6 % |
| `docs/plans/flow-ui-audit-2026-10-15.md` | 429 | 14 | 3 | 21 % |
| `docs/plans/memory-skills-research-2026-10-10.md` | 184 | 11 | 1 | 9 % |
| `docs/plans/redesign-plan-claude-chatgpt-haze-2026-10-10.md` | 571 | 18 | 2 | 11 % |
| `docs/plans/reference-transcript-catalog-copy.md` | 669 | 49 | 12 | 24 % |
| `docs/plans/stage1-ui-ux-spec.md` | 451 | 31 | 11 | 35 % |
| `docs/plans/stage2-implementation-plan.md` | 484 | 24 | 3 | 13 % |
| `docs/plans/stage3-arrangement.md` | 132 | 4 | 1 | 25 % |
| `docs/plans/stage3-status.md` | 83 | 7 | 0 | 0 % |
| `docs/plans/ui-redesign-deep-dive-2026-10-10.md` | 142 | 21 | 8 | 38 % |
| `docs/plans/ui-ux-target-plan-2026-10-11.md` | 250 | 15 | 0 | 0 % |
| `docs/plans/workstream1-status.md` | 383 | 16 | 0 | 0 % |
| `docs/plans/workstream1-stepB-evidence.md` | 167 | 10 | 1 | 10 % |
| `docs/plans/workstream1-stepB-gap-audit.md` | 84 | 0 | 0 | 0 % |
| `HANDOFF_LEARNING_LOOP.md` | 303 | 40 | 5 | 13 % |
| `PLAN_LEARNING_LOOP_AND_UI.md` | 727 | 32 | 3 | 9 % |

**"Dead" = the path the document cites is not in `git ls-files` at HEAD.** The measurement is
automated and reproducible.

**Method.** Every actionable item in every document was extracted, then verified against HEAD: does
the code it describes exist? Each row below carries the `file:line` that proves it is **still
open**. Where a prior row was found to be **stale**, that is stated — this register does not
propagate claims it could not re-verify.

**Status vocabulary.**

| status | meaning |
|---|---|
| **OPEN** | not implemented at HEAD, and the evidence is cited |
| **OPEN-VERIFY** | believed open, but the evidence is one measurement away and this audit did not take it |
| **DONE** | the item was in a plan doc and **is** implemented at HEAD — recorded so the deletion is auditable |
| **CORRECTED** | a prior audit's row did not survive re-verification; the correction is recorded |
| **OWNER** | needs a decision from the trader, not code |
| **DEFERRED** | deliberately deferred by the owner; do not re-pick without a ruling |

**Severity** is as claimed by the source document, not re-derived.

---

### F1. The register

#### 1.1 Signal, plan and gate

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-01 | **The validation gate scores R:R from `takeProfit[0]`** while the card, the journal and the clamp use the **nearest** target. A 1:1 plan can be gated as 2:1. | `flow-ui-audit` (C-2), `redesign-plan` | **OPEN** | `services/validation/TradeValidationGate.ts:589` → `AccuracyValidationService.ts:196-222` vs `utils/riskReward.ts:48` → `utils/analysisUtils.ts:1272-1278` | **E-02** |
| O-02 | **A second R:R inside the same gate run** — the scalp/swing validators each compute their own index-0 ratio. | `redesign-plan` | **OPEN** | `services/analysis/ScalpDetectionService.ts:178`, `:236`, called at `TradeValidationGate.ts:889`, `:899` | **E-02** |
| O-03 | **A third R:R outside `utils/riskReward.ts`** — the chart-drawing label prints its own `:1` ratio. | — | **OPEN** | `services/trade/chartDrawings.ts:608-615` | **E-02**, **E-34** |
| O-04 | **A fourth** — the pattern-memory synthesis picks `takeProfit[0]` for a loss/reward figure. | — | **OPEN-VERIFY** | `services/learning/PatternMemorySynthesisService.ts:260-268` | **E-34** |
| O-05 | **The R:R floor measures the nearest target while the scorer pays the ladder** — a plan whose nearest target is 0.59R is capped at 54 % and downgraded, and it then ran to TP3 for 1.65R. | `06-independent-review` §2.2 | **OPEN** | `utils/analysisUtils.ts:1431-1438` | **E-02** |
| O-06 | **The gate caps, it does not refuse.** "Make the gate refuse, not just cap." | `06-independent-review` M2 | **OPEN** | `services/validation/TradeValidationGate.ts:943` — `isValid: errors.length === 0`; a scored failure is a warning + a downgrade | **E-43** |
| O-07 | **`minEdge` gate** — refuse a plan whose net expectancy at its own probability is ≤ 0 after fees. | `06-independent-review` §3.4 | **OPEN** | no expectancy test exists in the gate | **E-43** |
| O-08 | **The deterministic baseline** — "has anyone asked whether the model beats a fixed rule?" | `06-independent-review` B4 | **OPEN** | — | **E-20** (headline use case) |
| O-09 | **The exit model is an unrecorded assumption** — the 50/50 blend and the 150 % zone are policy, not data. | `06-independent-review` B2 | **OPEN** | `services/backtesting/outcomeEngine.ts:69-71` (blend), `:119-121` (150 % zone) | **E-20** |
| O-10 | **The full validation gate is NOT wired** — `runValidationGate` has zero production importers. **Verified 2026-10-20**: `grep 'runValidationGate\|TradeValidationGate'` over every non-test file returns **only the definition and two comments in other files offering to feed it** (`services/analysis/EntryTimingService.ts:588`, `services/backtesting/StopLossOptimizerService.ts:332`). Only the narrower `GateKeeperService` (confidence cap + family pre-filter) is live, via `services/trade/proposalGate.ts`. | `06-independent-review` §2.6 | **OPEN — was OPEN-VERIFY** | `services/validation/TradeValidationGate.ts:495`; the two comments above | **E-02a / E-02b** (wire it, or retire it) |
| O-11 | **The deterministic skill layer is computed and dropped** — `applyNotebookSkillsToAnalysis` (the hard `avoid` veto, the candidate cap, the confidence downgrade) has **ten test call sites and zero production call sites**. | — | **OPEN** | `services/learning/SkillMemoryService.ts:3494` (definition); every call is in `tests/` | **E-35** |
| O-12 | **The veto ledger is read and never written** — `VetoLedgerService.recordVeto`: seven test call sites, zero production. | — | **OPEN** | `services/ui/VetoLedgerService.ts:90` | **E-35** |
| O-13 | **The predicate ceiling is computed and discarded** — `skillPredicateGate.ceiling` never reaches a recorded probability. | `06-independent-review` QW8 | **OPEN** | `services/learning/skillPredicateGate.ts:78`, `:200` | **E-35** |
| O-14 | **A decline leaves no object** — there is no `NO_TRADE`/`HOLD` outcome; a model that declines presents nothing, so "are we skipping winners?" is unanswerable. | `06-independent-review` §2.16 | **OPEN** | `types/enums.ts:9-15` — no HOLD member | **E-42** (decline tool) |
| O-15 | **The live prompt has no confidence ladder, no R:R rule, no risk rules, no stop guidance, and no "no trade is a decision"** — the trading-analysis corpus reaches a model only through the skill-eval harness. | `06-independent-review` QW5 | **OPEN** | `constants/prompts/analysisPrompts.ts` is reachable only via `services/learning/SkillEvalScheduler.ts:284` | **E-01** (contract injection) |
| O-16 | **A stored row already violates the ladder** — "Low / 58 %" was stored where Low is 40–54 %. | `06-independent-review` §2.2 | **OPEN-VERIFY** | the ladder lives in `constants/prompts/harnessContract.ts:11`; the *derivation* of the word from the number is not in one place | **E-01**, **E-35** |
| O-17 | **The live prompt is ~15 lines of mandate plus 30 tool schemas**; of 1,245 lines of prompt text in `constants/prompts/`, only `chatPrompts.ts` is on the live path. | `06-independent-review` §2.4 | **OPEN** | — | **E-01**, **E-30** |
| O-18 | **The live prompt's confidence ladder and the code's bands are separate derivations.** | `06-independent-review` QW5 | **OPEN** | `utils/analysisUtils.ts:1445+` `retierConfidenceForClamp` vs `constants/prompts/harnessContract.ts:11` | **E-01** |

#### 1.2 Risk, cost and size

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-19 | **There is no cost model anywhere** — no fee, slippage or funding term is ever charged. Every R, win rate, calibration bucket and the whole skill ledger is **gross**. | `05-lead-findings` §A.1, `06-independent-review` §2.3 | **OPEN** | a repo-wide search for `takerFee\|makerFee\|feeRate\|commission\|costBps` returns **0** files; `netR` (`services/learning/SkillMemoryService.ts:1431`) is the sum of **gross** R multiples | **E-03** |
| O-20 | **The permitted-floor trade nets ≈ 0 R** once the round trip is charged; the breakeven win rate moves 45.5 % → 50.0 %. | `05-lead-findings` §A.2 | **OPEN** (the rate is an **assumption**, flagged) | — | **E-03** |
| O-21 | **The loss size is −1.0R *or* −1.5R by an unvalidated rule**; in the extended-zone world the gate's own ≤54 % cap is arithmetically below the 59.3 % breakeven. | `05-lead-findings` §A.3 | **OPEN-VERIFY** | `services/backtesting/outcomeEngine.ts:119-121` `extendedSlPrice` | **E-03** |
| O-22 | **A "win" at TP1-then-breakeven is a net loss** — the app would book +0.30R gross and **−0.23R net**. | `06-independent-review` §2.2 | **OPEN** | `services/backtesting/outcomeEngine.ts:69-71` | **E-03** |
| O-23 | **The app emits entries, stops and targets and never a quantity.** `computeContractSize` is imported only by tests. | `06-independent-review` §2.3 | **OPEN** | `utils/ticketSize.ts:89-182` — test-only importers | **E-12** |
| O-24 | **The default leverage is 100×**, and the liquidation buffer lives in the unreachable module. At 100× a 0.19 % stop is a ~15.9 % account move at 1R on full notional, and a 1 % wick is a total loss. | `06-independent-review` §2.3 | **OPEN** | `utils/conversationUtils.ts:6` `DEFAULT_LEVERAGE = 100`; `utils/ticketSize.ts:194` `computeLiquidationBuffer` unreachable | **E-12**, **E-41** |
| O-25 | **`equityUsd` is configured in Settings and read by nothing in production** — its only reader, `SessionGuardService`, is unreachable. | `06-independent-review` §2.3 | **OPEN** | `components/settings/SessionUsagePanel.tsx:149` (writer) → `services/infrastructure/SessionGuardService.ts` (unreachable reader) | **E-12** |
| O-26 | **A presented plan never expires** — `validityDurationMinutes` is declared, transformed and read, but **no producer sets it**, so `ENTRY_NOT_HIT` is never written and the denominator excludes every setup that never triggered. | `06-independent-review` §2.9 | **OPEN** | `schemas/tradeAnalysis.ts:218`, `:468`; `services/analysis/ScalpDetectionService.ts:86`; `hooks/useTradeLogging.ts:301` ("label-only, so no `validityDurationMinutes` appears on a…") | **E-38** |
| O-27 | **The trading-contract floor never binds** — the R:R floor measures the nearest target and the confidence ladder is a separate derivation. | `06-independent-review` QW7 | **OPEN** | `utils/analysisUtils.ts:1431-1438` | **E-02** |

#### 1.3 The learning loop, the skills and the evidence

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-28 | **Settlement requires a human click** — the autopilot detects and stores a resolution, but the row is written only in `handleConfirmAutopilot`, and `markProcessed` sits after that click. With `isAutoCapturing` defaulting off, the click is the only path. **Every learning consumer is starved behind it.** | `05-lead-findings` §B, `06-independent-review` §2.10 | **OPEN** | `hooks/useWatchAndAutopilot.ts:185-215`; `services/ui/OutcomeAutopilotService.ts:650`; `hooks/useUserProfileLoader.ts:227` | **E-18** |
| O-29 | **The evidence floors are tuned for a world with no outcomes** — `MIN_SAMPLE_FOR_VETO = 2` (a two-trade sample can **zero a real setup**), `MIN_CLUSTER_FOR_SKILL = 3`, `MIN_SAMPLE_CONFIRMED = 5`. **This is a same-release dependency of O-28, not a follow-on.** | `06-independent-review` §2.11 | **OPEN** | `services/learning/SkillMemoryService.ts:358`, `:359`, `:385` | **E-37** |
| O-30 | **The rules store has no reader** — `learning_rules_v2_<user>` is read by backup sweeps and Preferences constants only, never by a prompt. | `memory-skills-research` §0, `ui-ux-target-plan` R2, `HANDOFF` | **OPEN** | `services/learning/StorageService.ts:106-137`; no prompt reader | **E-28** (cleanup) |
| O-31 | **The post-mortem route is starved, not deleted** — 25 read accesses across 17 files; `craftSkillFromPostMortem` is still called but its guard returns null for every post-2026-10-18 trade. | `debate-deletion-status` | **OPEN (owner-accepted)** | `services/learning/SkillMemoryService.ts:2664` `ingestIfThenFromTrade` (live, via `syncClosedTradeToNotebook:3312`) | **E-18**, and the owner decision on #21 |
| O-32 | **14 paths make a rule, skill or strategy active with no human approval** — 12 pre-seeded `book-*` skills, the IF/THEN auto-ingest, the LLM worth-gate `create`, the candidate→confirmed evidence ladder, the A/B-eval promotion, shadow refinement auto-promotion, consolidation/generalization, idle suspend/auto-revive. | `workstream1-stepB-evidence` | **OPEN** | `services/learning/seedStrategies.ts:234-252`; `SkillMemoryService.ts:2386,2406,2898`; `skillSupervisor.ts:209,570`; `supervisorStore.ts:84` `autoEnabled = true`; `SkillMemoryService.ts:1421-1442`; `:2432-2543`; `skillIdleLifecycle.ts:235-243,265-272` | **E-35**, **E-37** |
| O-33 | **Nothing checks `approvedBy` or `whyAccepted` at injection time.** | `workstream1-stepB-evidence` | **OPEN** | no gate on the injection path | **E-35** |
| O-34 | **The supervisor's auto-triage runs by default and the trader has no off-switch in the UI.** | `docs-audit-2026-10-06` | **OPEN** | `services/learning/supervisorStore.ts:84` `autoEnabled = true`, getters/setters at `:187`, `:191`, `:202`; **no reference to "supervisor" anywhere in `components/` except the display component `SupervisorStream`** | **E-35** |
| O-35 | **The post-mortem still has 5–6 writers** (`trade.postMortem`, `trade_summaries`, the conversation message, thinking turns, `globalMemory`) — and the post-mortem writer itself was deleted, so all five are frozen. | `workstream1-status` | **OPEN** | the writer is gone; the readers remain | **E-18** |
| O-36 | **`trader-diary/` is write-only** — two comments claim it feeds doctrine rewrites and skill gates. | `learning-loop-map` | **OPEN** | — | cleanup |
| O-37 | **`GlobalMemory.aiPatternMemory` is a frozen legacy field** and top-level `insightKnowledgeBase` is carried, not used. | `learning-loop-map` | **OPEN (low)** | `services/learning/MemoryService.ts`; `services/learning/AlgorithmicMemoryService.ts:40` sets `insights: []` | cleanup |
| O-38 | **`SkillMeta` has ~35 fields** vs the Agent Skills spec's 2 — "a database row wearing markdown". | `memory-skills-research` §3 | **OPEN** | `services/learning/SkillMemoryService.ts` | E-21 (the split landed; the row remains) |
| O-39 | **Skills and `rules/risk-rules.md` can express the same sentence** — two injection sites, no dedup. | `memory-skills-research` §3 | **OPEN** | — | E-30 |
| O-40 | **The doctrine slot is an always-on layer outside the budget** — "an unaccounted always-on layer is how a memory system silently crowds out the chart." | `memory-skills-research` §3 | **OPEN** | `utils/memoryBudget.ts`; the slot is deliberately outside the stage budget | E-30 |
| O-41 | **Nothing is pulled** — the model cannot ask for more of a skill it was told exists. | `memory-skills-research` §3 | **OPEN** | the pull tools exist (`recall`, `get_notebook_map`, `read_memory`) but no skill is pulled automatically | **E-18**, N-18 |
| O-42 | **Nine Improve-list items, none started** — regime backfill, holdout observable, LESSON token, room recorder, `finalTradeSummary` symmetry, post-mortem `recordInjections:false`, fold `skillIdleLifecycle` into `evaluateSkillLifecycle`, one `isLiveSkill`, per-file persist keys. | `HANDOFF_LEARNING_LOOP` | **OPEN** | — | mostly folded into **E-05** and **E-18** |
| O-43 | **Seven Tier-2 product decisions, none started** — one inbox, one supervisor view, hide the `approvedBy:'supervisor'` badge, drop the load→persist-only stores (incl. `learning_rules_v2`), unify the two bot registries, diary cap 50→20, gate the auto-mint behind a button. | `HANDOFF_LEARNING_LOOP` | **OWNER** (some now moot) | the two bot registries were unified by the in-flight work | **E-35**, cleanup |
| O-44 | **The "Try now" button for a throttled worth-gate cluster** — no UI button was added. | `HANDOFF_LEARNING_LOOP` | **OPEN (low)** | — | E-35 |

#### 1.4 Evaluation, replay and the journal's record

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-45 | **No shadow-promotion e2e** — a settled real window never asserts the promoted prose line. | `workstream1-status` | **OPEN** | `tests/skillRefinement.test.ts` pins serialization only | **E-20** |
| O-46 | **The journal row records no feature snapshot** — `buildProposedTradeAnalysis` writes `marketConditions` as literal dashes, so RSI/ATR/ADX at decision time are unrecoverable. | `06-independent-review` §2.12 | **OPEN** | `services/trade/proposedTrade.ts:160-162` | **E-12** |
| O-47 | **The journal row records no prompt** — `promptVersion` is copied from `message.runStats` but nothing writes `runStats.promptVersion` any more. | `06-independent-review` §2.12 | **OPEN** | `hooks/useTradeLogging.ts:355`; `utils/promptVersionStats.ts:45-57` | **E-13** |
| O-48 | **`LoggedTrade.timestamp` is the WRITE time**, so every dashboard groups by confirmation time, not decision time. | `06-independent-review` M6 | **OPEN** | `hooks/useTradeLogging.ts:307` (`new Date()`) vs `:284` (`message.createdAt`); read by `WinRateDashboard.tsx:117-125`, `EquityCurveDashboard.tsx:34-43`, `LearningDashboard.tsx:106` | **E-40** |
| O-49 | **The live-journal counts were never obtained** — the number of rows under the packaged app's `app://` IndexedDB. | `stage3-arrangement` | **OPEN** | — | E-20 |
| O-50 | **Pre-F3a rows carry no `planId`** and can therefore be re-logged. | `stage3-status` | **OPEN (accepted)** | — | — |
| O-51 | **No daily or per-candle candidate scan** — `run_screener` walks the universe deterministically but is only called on demand; automations have **no symbol field**, so the instrument comes from the prompt text; no `shadow`/`candidate` store exists. | `06-independent-review` §2.16 | ✅ **DESIGN APPROVED (owner, 2026-10-20)** — a **365-day candidate log** under **`userData/candidates/`**, **included in backup and export**. The *implementation* is staged behind the earlier dry run (D-24). | `services/trade/screener.ts:110`; `types/automation.ts:34-68` | **E-35** (shadow log) |

#### 1.5 Prompt surface and tools

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-52 | **Twelve (now fewer) debate prompt entries were still user-editable with zero effect** — the app was handing the trader an editor for text it never sends. | `06-independent-review` §2.14, `docs-audit` | **DONE** | the registry is 11 live ids, unreachable ceiling 0 (`tests/promptsAreWired.test.ts`); the 2026-10-19 deletion removed the rest | — |
| O-53 | **Twelve stale user-visible strings** naming the deleted debate engine. | `06-independent-review` §2.14 | **OPEN** | `components/analysis/InlineVerdict.tsx:86`; `components/automation/AutomationEditorModal.tsx:504`; `components/trade/panels/ChatComposer.tsx:196`; `components/chat/GroupChatView.tsx:302`; `components/chat/NewBotDialog.tsx:317,325,358`; `components/chat/NewGroupDialog.tsx:5,19`; `components/settings/SessionUsagePanel.tsx:327`; `components/settings/tabs/ModelsTab.tsx:127`; `components/settings/StrategiesManager.tsx:234,287,362`; `components/settings/tabs/GeneralTab.tsx:75`; `components/settings/ToolForgeManager.tsx:62`; `components/dashboards/StrategyStudio.tsx:415` | Report 4 Batch 1 |
| O-54 | **The `Debate cost cap (USD, 0 = off)` control caps nothing** — the flag is loaded and displayed but never read. | — | **OPEN** | `utils/harnessSettings.ts:13`, `:86-87`; `components/settings/SessionUsagePanel.tsx:327,332-333`; `tests/desktopUsageBridge.test.ts:11` says the guard "NEVER FIRED" | Report 4 §2.13 |
| O-55 | **The "Prompt A/B (control lane)" control does nothing** — `beginPromptLane` has zero call sites and `runStats.promptLane` is never assigned. | `debate-deletion-status` | **OPEN** | `services/infrastructure/PromptOverrideService.ts:24-38`; `hooks/useAnalysisPipeline.ts:1242,1403` | **E-13** |
| O-56 | **The default reasoning effort for a trade decision is `low`** — `EFFORT_BY_TASK.chat = 'low'`; the Chat surface and the dock both pass it through. | `06-independent-review` §2.13 | **OPEN** | `services/providers/reasoningControls.ts` (`EFFORT_BY_TASK`); `services/trade/chatSurfaceTurn.ts:266,327` | **E-39** |
| O-57 | **Temperature is not what is configured** — the chat turn asks for 0.4 and automation 0.3, but on a thinking-enabled Anthropic model the transport omits it. | `06-independent-review` §2.13 | **OPEN** | `services/trade/chatSurfaceTurn.ts:265`; `services/trade/automationTurn.ts:198`; `shared/providerRequestPolicy.cjs:180-185` | **E-39** |
| O-58 | **No prompt caching** — each of up to 8 tool rounds re-sends the system prompt, 30 tool schemas and every prior result. | `06-independent-review` §2.13 | **OPEN** | no `cache_control` anywhere in `services/providers` or `shared` | **E-30** |
| O-59 | **The full tool-schema tax is ~7,864 tokens per request on the dock** — seven times the mandate that tells the model what kind of assistant to be. | — | **OPEN** | `services/analysis/DeskToolsService.ts:820` (39 definitions) | **E-30** |
| O-60 | **The model is told to call a tool its allow-list refuses** (`get_chart_view` on the chat surface). | — | **OPEN** | `services/analysis/DeskToolsService.ts:1600` vs `services/trade/chatSurfaceTurn.ts:55-76` | **E-30** |
| O-61 | **The `harnessTurn` mark is used in the user role on every desk turn and explained nowhere** — the only text that defines it is the contract, which the desk never receives. | `06-independent-review` | **OPEN** | `utils/harnessMarks.ts` `harnessTurn()` (4 writers, all in the desk-tool loop) vs `constants/prompts/harnessContract.ts:18` (skill-eval only) | **E-01** |
| O-62 | **The market packet may be stale or missing and the prompt does not say so** — it promises a *fresh* packet, the code serves an 8-second cache, and a failed fetch substitutes a bare "packet unavailable". | `06-independent-review` §2.15 | **OPEN** | `services/trade/tradeChatContext.ts:83` (substitution), `:168` (the "fresh" claim) | **E-33** |
| O-63 | **The spot mirror can silently feed perp analysis** — the gate and the predicates consume whatever came back. | `06-independent-review` §2.15 | **OPEN** | `services/analysis/KlineService.ts:10-13`; the packet discloses "degraded" (`HybridIntelligenceService.ts:908-910`) but the gate does not | **E-33** |
| O-64 | **Monte Carlo can assume its own volatility** — with `atr` omitted, the model uses 2 × stop distance. | `06-independent-review` §2.15 | **OPEN** | `services/analysis/HybridIntelligenceService.ts:1514-1531` | **E-33** |

#### 1.6 UX, accessibility and the design system

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-65 | **No `aria-live` anywhere near the streaming transcript** — a screen-reader user gets no announcement that an answer arrived, nor the answer. | `flow-ui-audit` | **OPEN** | `components/trade/panels/ChatTranscriptList.tsx` (292 lines) and `components/shared/ChatTranscriptRow.tsx` (206 lines) have no `aria-live`, no `role="log"`, no `aria-busy` | **E-11** / the a11y doc |
| O-66 | **Seven of eighteen dialogs have no focus trap** — worst is `components/automation/AutomationEditorModal.tsx:291` (a 573-line CRUD modal with `role="dialog"`, no `aria-modal`, no trap, no restore). | `flow-ui-audit` | **OPEN** | as cited | a11y doc |
| O-67 | **The composite roles advertise keyboard contracts they do not have** — four tablists, a radiogroup, five menus. | `flow-ui-audit` | **OPEN** | the good pattern exists at `components/journal/Journal.tsx:170-183,264-297` | a11y doc |
| O-68 | **Four pickers/menus are unusable without sight** — `ModelPicker`, `SymbolPicker`, `SelectMenu`. | `flow-ui-audit` | **OPEN** | ~20 `SelectMenu` call sites | a11y doc |
| O-69 | **No `EmptyState` offers a next action** — 17 call sites, 0 pass `action=`. | `ui-redesign-deep-dive` | **OPEN** | — | a11y doc |
| O-70 | **Buttons and a switch that never render** — `onAddSkill`/`onOpenSkillsSettings` never passed; the global-memory switch never rendered. | `ui-redesign-deep-dive` | **OPEN** | — | a11y doc |
| O-71 | **Lazy surfaces without a skeleton** — 20 `fallback={null}`. | `ui-redesign-deep-dive` | **OPEN** | `App.tsx` has a `SurfaceSkeleton` for the four surfaces, but the modals do not | a11y doc |
| O-72 | **The flagship run is a black box** — the step ladder is muted for the dock's "Full analysis". | `flow-ui-audit` | **OPEN** | `components/analysis/AnalysisProgress.tsx` is imported but the "Full analysis" path does not mount it | a11y doc |
| O-73 | **The desk home, which runs the longest jobs, has no Stop.** | `flow-ui-audit` | **OPEN** | — | a11y doc |
| O-74 | **An answer cut off at the token ceiling is silent in every chat home.** | `flow-ui-audit` T7 | **OPEN** | and the truncation tally itself has no reader — `utils/finishReason.ts` `beginTruncationWindow`/`consumeTruncations`/`peekTruncations` have **zero** production call sites | **E-13** |
| O-75 | **The background autopilot logs a pinned setup 15 s after detection.** | `flow-ui-audit` F-h | **OPEN** | `hooks/useWatchSideEffects.ts:55` still toasts `'Logging in 15s'` | a11y doc |
| O-76 | **The skill record never shows the trades that earned it** — "the single biggest 'why' hole". | `flow-ui-audit` L-a | **OPEN** | — | N-14 |
| O-77 | **The Journal never says what a trade taught the app.** | `flow-ui-audit` L-b | **OPEN** | — | N-13 |
| O-78 | **Two homes called "Skills"; the catalog gear's reason is false.** | `flow-ui-audit` L-c | **OPEN** | — | a11y doc |
| O-79 | **The weekly/monthly review cards return `null`** — "pending", "failed" and "never ran" are indistinguishable. | `flow-ui-audit` L-d | **OPEN** | `services/learning/weeklyReview.ts:135` (`MIN_CLOSED_TRADES_FOR_REVIEW = 3`) | N-15 |
| O-80 | **The forged-tool queue count has no destination.** | `flow-ui-audit` L-e | **OPEN** | — | a11y doc |
| O-81 | **Agents shows `N lessons · N skills · N evidence` that cannot be opened.** | `flow-ui-audit` L-f | **OPEN** | `components/agents/AgentsView.tsx:1065` | a11y doc |
| O-82 | **One fact, several homes** — Skills in Learn *and* Settings; approvals at four addresses; one number formatted four ways; the same event in local time in five panels and PHT elsewhere. | `flow-ui-audit` | **OPEN** | `utils/timezone.ts`; 7 duplicate "Xm ago" implementations | Report 4 §2.8 |
| O-83 | **Density is the one place the app is not calm** — 57 % of type at 11–13 px, ~520 white-alpha borders, 71 stock overlay shadows. | `flow-ui-audit` | **OPEN** | — | a11y doc |
| O-84 | **Nine semantic aliases are declared and unused** — the app speaks `zinc-900` and `border-white/10`. | `flow-ui-audit` T3-1 | **OPEN** | re-measured: `bg-surface-raised` 1, `border-hairline` 0, `text-ink-*` 0, `text-trade-up/down` 0, `border-white/10` 195, `border-white/5` 123 | a11y doc |
| O-85 | **`SurfaceTitle`, `SectionLabel`, `Button` primitives do not exist.** | `flow-ui-audit` T3-2/T3-3 | **OPEN** | 0 hits for `SurfaceTitle` and `SectionLabel` | a11y doc |
| O-86 | **Radius tokens are not gated** — "no test gates it at all". | `ui-redesign-deep-dive`, `redesign-plan` | **OPEN** | `tests/radiusRamp.test.ts` exists and cites the redesign plan, but the token sweep is ungated | a11y doc |
| O-87 | **The type ramp in the doctrine is 2 px wrong on every step** and five roles short (`lede`, `price`, `display`, `hero`, `micro`). | `ui-doctrine` | **OPEN** | `docs/ui-doctrine.md:63` says 18/16/14/13/12/11/10/9 with a 14 px base; `index.css:304` is **16 px** | **docs fix** |
| O-88 | **No mobile *layout*** — safe chrome, but 100 of ~137 component files have no breakpoint class. | `06-independent-review` / a11y | **OPEN** | `sm:` 242, `lg:` 39, `md:` 27, `xl:` 3, `2xl:` 0 | a11y doc |
| O-89 | **The status-colour doctrine is a proposal, not a contract** — `utils/runStatus.ts` says *"Never hardcode a status colour in a component"* and has **2** consumers; 15+ files hardcode the palette. | `06-independent-review` / a11y | **OPEN** | `utils/runStatus.ts:28-60`; `components/dashboards/WinRateDashboard.tsx` 25, `components/ui/ScenarioSimulator.tsx` 22, `components/market/LiveMarket.tsx` 19, `components/journal/TradeLog.tsx` 12, `components/shared/Header.tsx` 12 | a11y doc |
| O-90 | **The `surface-census.cjs` leaf selector only matches `[learn-view]`** → `leafCount: 0` for four surfaces. **It blocks the type-dial gate.** | `redesign-plan` | **OPEN** | `scripts/surface-census.cjs` | cleanup + a11y doc |
| O-91 | **The `ui-inspect.cjs` probe assertion is stale** — it expects 7 nav rows; the app has 5. | `redesign-plan` | **OPEN** | `scripts/ui-inspect.cjs:215` | cleanup |
| O-92 | **The `NavRail` is imported and never rendered** — a dead node. | `app-flow` correction 5 | **OPEN** | `App.tsx:123` imports it; no `<NavRail` JSX exists in the app | cleanup |
| O-93 | **The chat surface's second column, the quick-prompt chip cloud and the dock header icon set** were deliberately deferred. | `chat-dock-reference` | **DEFERRED** | — | — |
| O-94 | **The debounce/typing/clarification rungs** and the per-model `<details>` standardisation were dropped or deferred. | `stage2-implementation-plan` | **DEFERRED** | — | — |
| O-95 | **Per-agent win rates, light theme, settings value-search, updater rollback, multi-symbol sampling** — deferred by the owner. | `stage2-implementation-plan` | **DEFERRED** | — | — |

#### 1.7 Data, stores and infrastructure

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-96 | **Write-time bounds are counts, not bytes** — `trade_chat_sessions_v1` bounds 12 × 60 entries, `MAX_IMAGE_CHARS` = 1,200,000; the export side is bounded (3,500,000) but the **write** side is not. *"The only genuine data-loss path found."* | `workstream1-status`, `docs-audit` | **OPEN** | `services/trade/chatSessions.ts:147`, `:329`; `services/infrastructure/ExportService.ts:418-427` | **E-14** |
| O-97 | **Three byte-cap risks** — `trade_session_drawings_v1` keeps every coin; `desk_tools_forged_v1` and `trading_checklist_v1` have no count cap. | `workstream1-stepB-gap-audit` | **OPEN** | `services/trade/chartDrawings.ts:187` | **E-14** |
| O-98 | **The `approval_rules_v1:<user>` store is on neither backup allow-list** — it gates every auto-apply. | `tests/exportRawLocalStorage.test.ts:97` | **OPEN (owner decision)** | `utils/approvalInbox.ts:46` | **E-14**, Q4 |
| O-99 | **Five namespaces are restore-listed but not raw-listed** — on native they are neither exported nor restored. | — | **OPEN (owner decision)** | `trade_sidebar_open_v1`, `agent_threads_opened_v1`, `desk_idle_motion_v1`, `thinking_leak_bin_v1`, `last_active_user` | **E-14**, Q4 |
| O-100 | **The two chat stores are half-migrated** — the instruction is *"document the two chat stores, do not half-migrate them"*, and they are **still undocumented**. | `flow-ui-audit` | **OPEN** | — | docs |
| O-101 | **The legacy `userData` rename is untested**; `migrateLocalStorageToPreferences` is mocked, not exercised. | `06-independent-review` | **OPEN** | `electron/main.cjs:49-77`; `tests/dbServiceImageGc.test.ts:43` | **E-24** |
| O-102 | **No logger and no packaged log sink**; `no-console` is off. | `docs-audit` | **DEFERRED** | ~740 `console.*` calls; `eslint.config.js:136` | **E-31** |
| O-103 | **SQLCipher off.** | `docs-audit` | **DEFERRED** | `services/infrastructure/SqliteService.ts:113` | — |
| O-104 | **No key pool.** | `docs-audit` | **DEFERRED** | — | — |
| O-105 | **`App.tsx` is ~2,672 lines.** | `docs-audit` | **OPEN (low)** | `App.tsx` | **E-25** |
| O-106 | **The `fullscreen` right-panel branch is computed and never used** — *"either is honest, silently deleting it is not."* | `docs-audit` | **OWNER** | `hooks/useRightPanel.ts:127`; `components/trade/TradeView.tsx:1097` pins `"push"` | **E-17** |
| O-107 | **The release workflow does not run `check-flow-doc-anchors` or `skill-approval-probe`** — a tag can publish with a dead line number in the flow docs. | `app-flow` | **OWNER** | `.github/workflows/release.yml` | — |
| O-108 | **The census half's provider sentences bind only their FIRST match.** | `debate-deletion-status` | **OPEN (known limit)** | `scripts/check-flow-doc-anchors.cjs` | — |
| O-109 | **The git-history half prints `SKIPPED` on a shallow clone** (CI depth 1) — *"a gate that cannot see git history must say so instead of reporting zero findings."* | `debate-deletion-status` | **OPEN (known limit)** | `scripts/check-flow-doc-anchors.cjs:670-675` | — |
| O-110 | **The calibration ledger is an unresolved product decision.** | `debate-deletion-status` | **OWNER** | `services/validation/CalibrationLedgerService.ts` + store/policy/prompts | N-17, Q |

#### 1.8 Ownership decisions still owed (24)

**Taken from the plan corpus and the previous audit, deduplicated.** These are not code; they are
rulings only the trader can make. **Each has a proposed default in Report 5 §4.**

| # | decision | source |
|---|---|---|
| D-01 | does the outcome need a human click? | `05-lead-findings` §B, `06-independent-review` §2.10 |
| D-02 | inject the context or delete the assembly? | `06-independent-review` M1 |
| D-03 | what is your actual fee tier? | `06-independent-review` §2.3 |
| D-04 | what belongs in a backup? | `tests/exportRawLocalStorage.test.ts:97` |
| D-05 | is the Analyst Lens feature staying? | the 2026-10-19 deletion |
| D-06 | is the Android gallery feature wanted? | `06-independent-review` (the `GallerySaver` half-feature) |
| D-07 | where should the render-time `<think>` / `<JSON_PLAN>` strip live? | `debate-deletion-status` §11.2 |
| D-08 | should old post-mortems and old debate transcripts stay readable? (#21) | `debate-deletion-status:2061-2068` |
| D-09 | how many minds should answer "Full analysis"? (#19) | `debate-deletion-status:2053-2059` |
| D-10 | what replaces the analysis branch? | `debate-deletion-status:110-147` |
| D-11 | the gate scan: inside `present_trade` or its own tool? | `debate-deletion-status:138-140` |
| D-12 | the `reasoningEffort` side-channel | `debate-deletion-status:142-143` |
| D-13 | which tools are meaningless without a chart? | `debate-deletion-status:144-146` |
| D-14 | the Stage 5.3 rating store | `reference-transcript-catalog-copy:667` |
| D-15 | the Stage 10M audio wire format | `reference-transcript-catalog-copy:668` |
| D-16 | the 7 Tier-2 product decisions | `HANDOFF_LEARNING_LOOP:213-235` |
| D-17 | the 9 Improve-list items | `HANDOFF_LEARNING_LOOP:239-259` |
| D-18 | the doctrine slot's 1,150 characters | `memory-skills-research:133` |
| D-19 | merging the two rails | `flow-ui-audit:240` |
| D-20 | the brand-mark spinner | `flow-ui-audit:242` |
| D-21 | the HUD wording | `ui-ux-target-plan:249` |
| D-22 | the coach row renders the greeting pane, not the transcript | `PLAN_LEARNING_LOOP_AND_UI:720-725` |
| D-23 | per-agent win rates | `stage2-implementation-plan:478` |
| **D-24** | **The candidate log's shape is approved; its implementation waves are not.** The 365-day log under `userData/candidates/`, included in backup/export, is **approved as a design**. **The later waves that follow it are NOT approved and wait on the earlier dry run** (Phase 3, the outcome loop) before any of them is built. | owner, 2026-10-20 |
| **D-24** | **The candidate log's shape is approved; its implementation waves are not.** The 365-day log under `userData/candidates/`, included in backup/export, is **approved as a design**. **The later waves that follow it are NOT approved and wait on the earlier dry run** (Phase 3, the outcome loop) before any of them is built. | owner, 2026-10-20 |
| **D-24** | **The candidate log's shape is approved; its implementation waves are not.** The 365-day log under `userData/candidates/`, included in backup/export, is **approved as a design**. **The later waves that follow it are NOT approved and wait on the earlier dry run** (Phase 3, the outcome loop) before any of them is built. | owner, 2026-10-20 |

#### 1.9 Corrections — prior rows that did **not** survive re-verification

| prior row | verdict at HEAD `56639b4b` |
|---|---|
| `recordToolTurnUsage` has a reader and no writer (G-40) | **CORRECTED — it has three production callers**: `services/trade/automationTurn.ts:258`, `services/trade/chatSurfaceTurn.ts:331`, `services/trade/chatTurnRunner.ts:709`, and `tests/featuresAreWired.test.ts:179` pins it. |
| `runEnsembleEnabled` survives as a half-live flag (G-39) | **CORRECTED — the flag is gone.** `tests/automationRouteCharacterization.test.tsx:249` asserts the source does **not** match `/runEnsembleEnabled/`. |
| The supervisor auto-approves drafts, no human (stepB path 5) | **CORRECTED — it is auto-triage only.** `overrideApproveSkill` (`services/learning/skillSupervisor.ts:708`) is the only approve path and there is no boot sweep in `hooks/useSupervisorBootstrap.ts`. **What remains true is narrower: the supervisor's auto-triage runs by default with no UI off-switch (O-34).** |
| `constants/prompts/analysisPrompts.ts:299` — "Family C … Highest win rate (~86 %)" | **CORRECTED — not found.** The file is 190 lines at HEAD and a search for `win rate` across `constants/prompts/` returns zero hits. |
| the 14 activation paths (stepB) | **PARTLY CORRECTED.** Path 5 is stale (above). Paths 1, 3, 4, 7, 8, 9, 10, 11 remain live and unaudited — see O-32. |

---

### F2. What each deleted document contributed, and where it went

| deleted document | what it was | where its content went |
|---|---|---|
| `docs/desk/README.md` | the 2D desk floor layout — a **deleted feature** | nothing to salvage: 100 % of its cited paths are dead and the feature is gone. **Deleted.** |
| `docs/plans/chat-dock-reference.md` | a 2026-10-04 visual reference for Chat/dock | its **7 PNGs are the only committed screenshots of this app** and are **kept** at `docs/plans/reference/`. The prose was rebuilt three times over. **Deleted.** |
| `docs/plans/debate-deletion-status.md` | the dated stage ledger for deleting the debate | **KEPT.** It is dated history, it names deleted files on purpose, and `scripts/check-flow-doc-anchors.cjs:44` scans it — deleting it breaks a gate. Its open items are in §1 above (O-31, O-32, O-52, O-107…O-109). |
| `docs/plans/docs-audit-2026-10-06.md` | a per-doc disposition table | its **7 un-actioned dispositions** became O-99, O-102…O-106 and the Report 4 docs table. Its "worth a decision" items became Q4 and D-04. **Deleted.** |
| `docs/plans/flow-ui-audit-2026-10-15.md` | the 2026-10-15 six-auditor UX/a11y/flow audit | its open Tier-4 findings became O-65…O-75, O-79, O-81, O-100. **Deleted.** |
| `docs/plans/memory-skills-research-2026-10-10.md` | how Claude/Hermes store memory vs what August does | its durable finding is O-30; its five divergences are O-38…O-41. **Deleted.** |
| `docs/plans/redesign-plan-claude-chatgpt-haze-2026-10-10.md` | the 2026-10-10 redesign master spec — **it is the design that shipped** | its binding rules are in `docs/ui-doctrine.md` (KEEP); its still-open findings are O-62, O-90, O-91 and the type/density cluster. **Deleted.** |
| `docs/plans/reference-transcript-catalog-copy.md` | a copy spec for a UI rebuilt three times | its open stages became O-14, O-45, O-51, D-14, D-15. Its own rule — *"A UI must not advertise a gesture that isn't wired"* — is the rule this register applies to the repo. **Deleted.** |
| `docs/plans/stage1-ui-ux-spec.md` | the 2026-10-03 research and design spec (D1–D6) | its decisions shipped; its open findings are O-69…O-71, O-83…O-86. **Deleted.** |
| `docs/plans/stage2-implementation-plan.md` | the 2026-10-03 implementation plan | its Phase 0–2 shipped; its Phase 3/4 open items are O-04, O-69, O-76, O-93…O-95, O-106. **Deleted.** |
| `docs/plans/stage3-arrangement.md` | the 2026-10-05 target arrangement | its Phase A–G shipped; its open item is O-49. **Deleted.** |
| `docs/plans/stage3-status.md` | the merge status and the **"Facts paid for — do not rediscover"** list | **the 15 facts are rescued verbatim in §3 below.** Its open item is O-50. **Deleted.** |
| `docs/plans/ui-redesign-deep-dive-2026-10-10.md` | the measured pre-redesign baseline | a baseline against `78f99bd` whose artefacts are in the gitignored `.probe-artifacts/` — **its numbers are unfalsifiable**. Its findings are O-66…O-71, O-83, O-90. **Deleted.** |
| `docs/plans/ui-ux-target-plan-2026-10-11.md` | the 2026-10-11 target plan | its four build decisions are **D-18, D-19, D-21, D-22**; its open items are O-38, O-46, O-53. **Deleted.** |
| `docs/plans/workstream1-status.md` | the workstream-1 status and handoff | its open items are O-32, O-35, O-45, O-60, O-96. **Deleted.** |
| `docs/plans/workstream1-stepB-evidence.md` | the platform-by-platform record of where the data lives | its 14 activation paths are O-32; its method line is rescued in §3. **Deleted.** |
| `docs/plans/workstream1-stepB-gap-audit.md` | the read-only gap audit of workstream 1 | its 4 gaps are moot; its method line is rescued in §3. **Deleted.** |
| `HANDOFF_LEARNING_LOOP.md` | the learning-loop handoff | its Tier-2 decisions and Improve list are D-16, D-17, O-42, O-43, O-44. **Deleted.** |
| `PLAN_LEARNING_LOOP_AND_UI.md` | the multi-workstream plan | WS-1…WS-6 shipped; its deliberately-left list is O-40, O-41, D-22. **Deleted.** |

---

### F3. Unique content rescued before deletion

#### 3.1 "Facts paid for — do not rediscover" (from `docs/plans/stage3-status.md`)

**Verified as still true at HEAD.** These are the facts a future reader would otherwise have to
rediscover the hard way.

- **Journal:** the embedded branch only (`isEmbedded` deleted); the overlay and the *"your calls vs
  verdict"* stat are gone (**nothing writes `userPriorCall`**).
- **`VersionHistoryDashboard`:** no props, no overlay, no tab strip; the only mount is
  Learn → System. Hardcoded placeholder cards deleted.
- **Settings → Journal** routes through `openJournal`; `settingsInitialTab` and
  `isUpdateAutoCapturing` are deleted everywhere including `types/user.ts`. **`isAutoCapturing` IS
  wired** (`confirmAutopilotOutcome` → capture modal).
- **`utils/recentTradesBrief.ts` owns explicit log-time ordering**; `computeJournalStats` counts
  the trailing run of whatever order it is handed, **so sort before calling it**. Dollar and percent
  PnL never merge.
- **`realizedR` is the canonical outcome label**, computed by `realizedRFromPrices`
  (`services/backtesting/outcomeEngine.ts`) — used by BOTH the post-mortem's candle validation and
  the autopilot's `verifyHistoricalOutcome`. **`rMultiple` is the older leveraged-percent figure.**
- **MAE/MFE scaled only by `toLeveragedExcursionPct`** (same module). Rows carry `rSource` /
  `excursionSource` (`autopilot` | `postMortem`); **first writer wins** — the post-mortem will not
  clobber an autopilot measurement.
- **The recent-form brief is AUDIENCE-SPLIT:** analysts get neutral day-level rows (no win rate, no
  streak, no net PnL — ~1.2k chars, 20 rows); moderator and post-mortem get `tallyLine`. Both are
  fingerprinted into the injection record (`journal/recent-form`, `fingerprint`), reachable from a
  row's `sourceRunId`.
- **`get_trade_log`:** 4000-char budget (a 20-row read measures ~2.7k), deliberately **NOT cached**,
  and **not** a `MARKET_TOOL`.
- **Training JSONL:** `utils/reportExport.ts`, `TRAINING_SCHEMA_VERSION = 1`, nests `decision` /
  `outcome` / `lesson` / `provenance`, `incomplete` + `missing[]`. **Never derives dollars.** Entry
  candles are reconstructed from `decision.symbol` + `decision.analysisCreatedAt` + entry via
  `fetchFuturesOHLCVFromTime` — **not stored**.
- **The "Log this trade" dedupe keys on `LoggedTrade.planId` / `Message.planId`.** The headline-text
  match is gone; pre-F3a rows carry no `planId` and can therefore be re-logged — **accepted**, and
  the only known data gap from that phase.
- **`render-probe`:** `sweepSurface(label, cap, tabs)` enters each tab; a newly revealed
  input/textarea counts as a live press. Journal tabs are reached by id (`#journal-tab-analytics`).
  **Learn presses 16; floor `min(cap, 6)` — do not lower.**
- **SQLite needs NO migration for the new fields:** save spreads everything non-column into the
  `meta` TEXT column, read spreads `...meta` back. Proven by `tests/sqliteService.test.ts`
  (*"stage-3 trade fields round-trip"*), which also asserts zero `ALTER TABLE trades` statements
  and that a legacy row's missing keys stay `undefined`.

#### 3.2 The method lines worth keeping

- **From `docs/plans/workstream1-stepB-gap-audit.md`:** *"can a person reach it from the app, and
  does the thing it claims to do actually happen?"* — the two questions this whole audit was
  built on.
- **From `docs/plans/reference-transcript-catalog-copy.md`:** *"A UI must not advertise a gesture
  that isn't wired."* — the rule that becomes the register's own test.
- **From `docs/plans/redesign-plan-claude-chatgpt-haze-2026-10-10.md`:** *"every claim is a
  file:line a mapper opened."* — and the counter-rule: a doc whose artefacts live in a gitignored
  directory has **unfalsifiable** numbers, which is the failure mode `docs/app-flow.md` was written
  to prevent.

---

### F4. How to restore anything

Every deletion is a `git rm` — a **tracked** change — so every one of the 18 documents is one
command away:

```
git revert <the commit that deletes them>
```

or, for a single file, `git checkout <sha> -- <path>`. The content also remains in the history of
`main` at the commit that preceded the deletion.

---

### F5. What was NOT deleted, and why

| kept | why |
|---|---|
| `docs/app-flow.md` and `docs/app-flow.html` | **living and machine-checked** — 303 verified anchors, 0 unattributed. The anchor gate scans both. |
| `docs/learning-loop-map.md` | living, but **three rows are wrong** (Report 4 §8.1 row 12) — needs UPDATE, not deletion. |
| `docs/ui-doctrine.md` | living — the binding UI rules. Needs a 2 px correction (O-87), not deletion. |
| `docs/plans/debate-deletion-status.md` | the **dated history ledger** — names deleted files on purpose, and `scripts/check-flow-doc-anchors.cjs:44` scans it. **Deleting it breaks a gate.** |
| `docs/plans/reference/*.png` (7 files) | the only committed screenshots of this app |
| `AGENTS.md`, `README.md`, `PRIVACY.md`, `THIRD_PARTY_NOTICES.md`, `changelog.md` | living, and not plan documents. `README.md` and `PRIVACY.md` need UPDATE (Report 4 §8.1 rows 2 and 6). |

---

| O-129 | **13 modules the app never loads, and 25 test files that exist only to cover them** — measured by a reachability graph over 521 source modules from the real entry points (492 reachable, 29 not). **Zero production importers each:** `TradeValidationGate.ts` (986), `BacktestingService.ts` (1,414), `AnalysisProgress.tsx` (the step ladder — not merely "muted", **not mounted at all**), `EntryTimingService.ts`, `ProbabilityEngineService.ts`, `debatePods.ts`, `incrementalMarkdown.ts`, `seriesPalette.ts`, `preRead.ts`, `convictionDrift.ts`, `providerFitness.ts`, `ticketSize.ts`, `chartScanSkills.ts`. | this audit | **OPEN** | the reachability graph plus a direct `from '…'` grep per module. **Four of the apparent "orphans" are TEST HELPERS, and the four tests that use them are repo-wide SOURCE GUARDS (849 lines) that must NOT be deleted** — `themeContrast.test.ts` (393), `jsxNesting.test.ts` (283), `sourceCodeHelper.test.ts` (96), `aiTrendlinesDrawn.test.ts` (77) | **E-50** (the test-removal batches T1–T4) |

### F1.10. Four items the first pass of this register missed

A keyword-coverage check of the register against the 60 gap themes named by the plan corpus found
four that were not represented. They are added here rather than left out.

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-111 | **The queue strip's refusal line is unverified in the app** — no probe presses **Apply** in the Learning queue, so the refusal the strip shows is only asserted in a unit test. | `workstream1-stepB-gap-audit` | **OPEN (low)** | `components/learn/ActionApprovals.tsx`; `tests/approvalGate.test.ts` asserts the function, not the press | **E-11** / the probe |
| O-112 | **Nothing exercises the real Settings → Data restore of a chat backup with an image-bearing session.** The web round trip is tested; **the native path — where every §2.1/§2.2 store defect lives — is not.** | `workstream1-stepB-gap-audit` | **OPEN** | `tests/infrastructure/backupImportRoundTrip.test.tsx` covers the web path only; `PreferencesService.ts:68-74` and `:226-241` are the native split | **E-14**, **E-24** |
| O-113 | **The provenance strip is jsdom-only** — it needs a real analysis run with a configured provider to prove it renders what it claims. | `PLAN_LEARNING_LOOP_AND_UI` | **OPEN (medium)** | `components/chat/MemoryProvenanceStrip.tsx`; `tests/memoryProvenanceStrip.test.tsx` mounts it in jsdom | **E-24** (a real run) |
| O-114 | **Node 26's experimental `localStorage` shadows jsdom's**, which breaks every test that touches `localStorage` directly. The repo pins Node 22.23.3 via volta. | `HANDOFF_LEARNING_LOOP` | **OPEN (environment fact — verify on this box)** | `.nvmrc`; `HANDOFF_LEARNING_LOOP.md:18-41` (now deleted; preserved here) | — |

### F1.11. Rows the deletion itself closed

Three rows from the plan corpus are **no longer open**, because of what happened while this register
was being built. They are recorded so nobody re-picks them.

| prior row | what closed it |
|---|---|
| **G-36 — the role / lens feature was only half-cut** (`AnalystRole`, the seat personas, the lens prompts, the roster builder all still named the three analyst roles) | the 2026-10-19 deletion removed the whole analyst-role system and migrated the stored profiles (`6e1e09bb`, `69c4aa33`). The Lens layer — `services/ui/AnalystLensService.ts`, `constants/prompts/lensRolePrompts.ts`, `utils/thinkingLens.ts`, `types/lens.ts` — went with it. **The three `AnalystRole` members remain the *lens* vocabulary, used by `constants/prompts/lensRolePrompts.ts` until that file was removed too.** |
| **G-61 — the stage-19 delete list was a claim, not a fact** (`utils/debateEnvelopes.ts` and `services/agents/seatPersonas.ts` were listed as deleted on 2026-10-18 and were still present) | both are gone at HEAD. **The claim is now true.** |
| **G-62 — `TEAM_MAX_SEATS` was claimed removed and the constant survived** (`utils/teamRoster.ts:25` still exported `TEAM_MAX_SEATS = 10`, and `tests/teamRoster.test.ts:19` asserted it) | `utils/teamRoster.ts` and its test are both deleted. **Gone.** |
| **G-63 — `HANDOFF_LEARNING_LOOP.md`'s IMPLEMENT-3 "DONE ✅" and Tier-2 #5 both named `BotRegistry`**, which was being deleted — so the target inverted and the DONE mark needed re-writing | **moot: `HANDOFF_LEARNING_LOOP.md` is deleted, and `services/bots/BotRegistry.ts` is gone.** Its Tier-2 content survives as O-32, O-33, O-34, O-43 and D-16. |

**And one row that changed meaning rather than closing:**

| prior row | what happened |
|---|---|
| **G-19 — "the two supervisor Settings switches have no UI"** | **the two docs disagreed** (`workstream1-status.md:19-22` said they *are* exposed in `SessionUsagePanel`; `docs-audit-2026-10-06.md:80-82` said no UI writer exists anywhere). **Re-verified at HEAD: no reference to "supervisor" exists anywhere in `components/` except the display component `SupervisorStream`.** The store's `autoEnabled` defaults to **`true`** (`services/learning/supervisorStore.ts:84`) with a getter/setter/reset at `:187`, `:191`, `:202` — and **no UI can reach them.** The narrower, correct statement is now **O-34**: *the supervisor's auto-triage runs by default and the trader has no off-switch.* |

#### 1.10b Six more open items the register's first pass left in the reports only

A second coverage pass found six themes that the reports carried but the register's table did not.
Since the register is meant to be **the** list of what is not implemented, they belong here.

| # | item | source | status | evidence at HEAD | covered by |
|---|---|---|---|---|---|
| O-115 | **The ensemble weighting is inverted** — a provider with one loss scores **0.0 %**, the same as a provider with no trades at all; the providers are then sorted descending and the arbiter is told to favour the top one. **A single loss can brand a model as the worst performer, and a single lucky win the best.** | `05-lead-findings` §C | **OPEN** | `services/backtesting/ModelPerformanceService.ts:649` `winRate: perf.overallStats.total >= 3 ? perf.overallStats.winRate : 0`; the sort at `:657`; best/worst at `:669-670` | **E-04** |
| O-116 | **`DebateSpeaker` is a degenerate union** — `string \| 'Moderator'` — *"worse than the one it replaced"*. | `docs-audit-2026-10-06` | **OPEN (one line)** | `types/enums.ts:43` | **E-10b** |
| O-117 | **The drawn Entry/Stop/Target line is un-asserted by any gate** — the probe asserts no canvas overlay levels, so the one thing the trader drew can be wrong without anything failing. | `app-flow` | **OPEN** | `services/trade/chartDrawings.ts`; `scripts/render-probe.cjs` asserts no canvas levels | **E-11** |
| O-118 | **No test covered the Agents-roster seeding, so removing it turned nothing red** — *"that silence is evidence nothing was watching, not evidence the feature was inert."* | `app-flow` correction 12 | **OPEN (test gap)** | the seeding is gone; `tests/teamRoster.test.ts` was deleted with it and nothing replaced it | **E-11** |
| O-119 | **`trade_chat_active_v1` cannot be backed up** — it holds a plain string id, which the JSON sweep cannot carry. Deliberate, and documented — but the constraint is still live and still needs a raw-string envelope if the id ever matters. | `workstream1-stepB-gap-audit` | **OPEN (accepted constraint)** | `services/infrastructure/ExportService.ts:367-371`; `services/trade/chatStore.ts:161` | **E-14** |
| O-120 | **`harness_settings_v1` is backed up but its restore target is ambiguous** — a Preferences row that nothing reads. The 2026-10-06 audit called it *"NOT a bug"*; the gap audit called it *"a live gap"*. **The two docs disagree and the code was never checked.** | `workstream1-stepB-gap-audit` | **OPEN (needs one measurement)** | `services/infrastructure/ExportService.ts:375` (write) and `:736` (restore mirror) | **E-14** |
