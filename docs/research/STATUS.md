# Harness research — status

**Task:** exhaustive deep-dive of three reference harness repos, then evidence-based
improvement proposals for the August Trading harness. RESEARCH ONLY — no August
Trading source code is modified by this work.

**Started:** 2026-10-22 (Asia/Manila) · **Finished:** 2026-10-22

---

## Scope

| Item | Value |
| --- | --- |
| In scope | the harness app: agent loop, tools, debate/ensemble, review/learning, UI |
| Out of scope | the model training pipeline, except where the harness feeds it (trade log / training-data export) |
| Reference repos | `earendil-works/pi`, `deepseek-ai/deepseek-harness`, `NousResearch/hermes-agent` |
| Safety | reference repos are read-only and untrusted: no install/build/postinstall, no code execution, no exchange API keys, no orders, no live accounts, no network |

## Reference repos (shallow clones, outside the August Trading repo)

| Repo | Local path | Tracked files | Shards |
| --- | --- | ---: | ---: |
| `earendil-works/pi` | `%TEMP%\harness-research\pi` | 1,987 | 12 |
| `deepseek-ai/deepseek-harness` | `%TEMP%\harness-research\deepseek-harness` | 16,297 | 47 |
| `NousResearch/hermes-agent` | `%TEMP%\harness-research\hermes-agent` | 20,695 | 34 |

> The prior `harness-research` clone also contains `simulide` (a circuit simulator).
> It is **not** one of the named reference repos and is **out of scope**; it is
> excluded from every manifest.

> These three checkouts are also the pins the independent audit re-derived coverage
> against — `git rev-parse HEAD` in each returns pi `58c0b02c`, deepseek-harness
> `687f282e`, hermes-agent `4e58c721`. Anyone re-checking a shard citation should do it
> here, at these commits; a later upstream commit moves every line number in the corpus.

## Phases — all complete

| Phase | Deliverable | Status |
| --- | --- | --- |
| 0 | `docs/research/trading-baseline.md` — what August Trading's harness does today, real vs cosmetic | **DONE** |
| 1 | `docs/research/<repo>/manifest.tsv` — coverage ledger, every tracked file | **DONE** |
| 2 | `docs/research/<repo>/shards/<shard>.md` — one subagent per shard, full read | **DONE** |
| 3 | `docs/research/<repo>/ARCHITECTURE.md` — synthesis + coverage summary (lead verifies) | **DONE — all three repos PASS** |
| 4 | `docs/research/TRADING-IMPROVEMENTS.md` — proposals with verdicts and a ranked top-5 | **DONE** |

## The coverage gate — final result

| Repo | Tracked files | Ledger rows | Read | Skipped (with a reason) | Pending | Missing | Skipped without a reason | Shards complete | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `pi` | 1,987 | 1,987 | 1,811 | 176 | 0 | 0 | 0 | 12 / 12 | **PASS** |
| `deepseek-harness` | 16,297 | 16,297 | 13,041 | 3,256 | 0 | 0 | 0 | 47 / 47 | **PASS** |
| `hermes-agent` | 20,695 | 20,695 | 18,168 | 2,527 | 0 | 0 | 0 | 34 / 34 | **PASS** |
| **Total** | **38,979** | **38,979** | **33,020** | **5,959** | **0** | **0** | **0** | **93 / 93** | **ALL PASS** |

Every tracked file in every repo appears in the ledger, exactly once, with a status
of `read` or `skipped` and — for a skip — a one-line reason. No file is missing, no
ledger row names a file that is not tracked, and no shard is without a ledger.

**One qualification the independent audit added to that PASS is now fixed, and one
remains** (`INDEPENDENT-AUDIT.md` §1/§4, both re-derived here). The fixed one: 19
`README.i18n.yaml` rows in `dsh-web-deliverables-feedback` were recorded `read` while the
shard's own prose said they were only opened to confirm what they are. **The ledger was
corrected on 2026-10-23** (19 rows `read` → `skipped`, each with the reason the report
already gave), and the manifest, `coverage.tsv` and `COVERAGE.md` were regenerated from
the ledgers — hence `deepseek-harness` is 13,041 read / 3,256 skipped and the totals are
33,020 / 5,959. `read` now means one thing in every ledger. Still open: three ledgers —
`dsh-docs-persistence`, `dsh-client-primitives-theme`, `dsh-client-approval-agents-ui` —
do not open with the required `path\tstatus\tnote` header, which the roll-up tolerates
and this file did not record.

Regenerate: `node %TEMP%\harness-research\merge-status.mjs` (merges the shard
ledgers into the manifest and diffs it against `git ls-files`), then
`node %TEMP%\harness-research\gen-coverage.mjs` (rebuilds `COVERAGE.md`).

## Manifest status vocabulary

| Status | Meaning |
| --- | --- |
| `read` | the file was opened and its content is incorporated into its shard report |
| `skipped` | the file was NOT read line by line; the `note` column states why, and what was done instead |
| `pending` | not yet dispatched (Phase 1 default) — **0 rows remain** |

## Where the reports are

| Path | What it is |
| --- | --- |
| `docs/research/trading-baseline.md` | the August Trading baseline: 343 features, each REAL or COSMETIC, with `file:line` |
| `docs/research/baseline/*.md` | the seven per-area evidence files behind the baseline |
| `docs/research/TRADING-IMPROVEMENTS.md` | twelve proposals with verdicts, a "considered and rejected" section, and the ranked top five |
| `docs/research/INDEPENDENT-AUDIT.md` | the second-agent audit of this run: coverage re-derived from the pinned clones, 22 of 93 reports spot-checked content-by-content, and the five findings the gate should carry |
| `docs/research/PROPOSALS-DELTA.md` | the same auditor re-opening every August-side `file:line` in the ranked top five at HEAD, with the corrections an implementer must carry into P4 and P9 |
| `docs/research/<repo>/ARCHITECTURE.md` | the per-repo synthesis |
| `docs/research/<repo>/COVERAGE.md` | the generated per-shard coverage table |
| `docs/research/<repo>/coverage.tsv` | the same, as TSV |
| `docs/research/<repo>/manifest.tsv` | the full per-file ledger |
| `docs/research/<repo>/shards/<shard>.md` | 93 per-shard reports |
| `docs/research/<repo>/shards/<shard>.status.tsv` | 93 per-shard per-file ledgers |
| `docs/research/<repo>/shards/<shard>.files.txt` | 93 per-shard work orders (the exact file list each reader was responsible for) |
| `docs/research/SHARD-BRIEF.md` | the shared brief every shard reader followed |
| `docs/research/REVERTED-unintended-edits*.patch` | two source-change sets made by readers in breach of the read-only constraint, reverted and preserved here |

## Log

- **12:55** — Phase 0 started. Recovered the Stage 3 plan from git history
  (`docs/plans/stage3-arrangement.md`, last present at `dd34ea87`); it is deleted from
  the working tree but is the governing plan for the harness work.
- **13:12** — **Phase 0 DONE.** Seven readers covered the harness; 343 numbered
  features classified: **256 REAL, 61 dead/cosmetic, 29 partial**. The largest single
  finding is that the analysis pipeline assembles the trader's context and discards
  it — `enhancedPrompt` is written 4× and read once, by a `devLog`
  (`hooks/useAnalysisPipeline.ts:1168-1213`); all three sends use `promptToSend`.
- **13:02** — **Phase 1 DONE.** Coverage ledger built for all three repos. 38,979
  tracked files across 93 shards.
- **13:15** — **Working-tree incident 1.** Six source files were modified during the
  baseline pass (a `startedAt` work-clock field). Reverted with `git checkout --` and
  preserved verbatim as `docs/research/REVERTED-unintended-edits.patch`.
- **13:29** — **Phase 2, first attempt: throughput failure.** One read call per file
  meant ~2.4 minutes per step; after 95 minutes not one shard report existed. The
  brief was rewritten to specify **batch reading** (15–30 files per shell call) and
  **three read tiers**. The run was killed and relaunched.
- **14:00** — **Phase 2, second attempt: capacity failure.** The runtime caps active
  children at 8; a pool of 9 overflowed and 87 shards never started. The pool was
  cut to 5 and the shards ordered by value.
- **13:56–18:10** — **Phase 2 completed.** All 93 shards read: 33,039 files read
  and 5,940 skipped with a one-line reason, across 93 reports and 93 ledgers. *(That is
  19 read rows too many — corrected to 33,020 / 5,959 on 2026-10-23; see the 01:20
  entry.)*
- **17:50** — **Working-tree incident 2.** Seven more source files were modified
  during the shard run (a "thinking off instead of step down" change to
  `DeskToolsService.ts`, plus tests and docs). Reverted and preserved as
  `docs/research/REVERTED-unintended-edits-2.patch` (13.7 KB, exactly those 7 paths).
  **The tree now contains only `docs/research/`.**
- **18:00** — **One gap re-dispatched rather than accepted.** The `hermes-tui-gateway`
  reader ran out of budget and left 24 `tui_gateway/methods_*.py` files unread. An
  honest skip, but not coverage — so they were re-dispatched and read.
- **18:12** — **Phase 3 gate: ALL THREE REPOS PASS.** 38,979 / 38,979 ledger rows,
  0 pending, 0 missing, 0 skipped without a reason, 93 / 93 shards complete.
- **18:12** — **The gate caught two stale claims in the August baseline**, both
  corrected in `trading-baseline.md` and `TRADING-IMPROVEMENTS.md`:
  1. *"the hard avoid veto is dead / `applyNotebookSkillsToAnalysis` has zero
     production callers"* is **stale** — the E-35 fix landed. It is called at
     `services/trade/presentTradeTool.ts:113` and a fired AVOID **refuses the
     presentation**. The accurate claim is that the **chat** path has no
     deterministic skill enforcement.
  2. *"`SessionGuardService` is dead"* is **too strong** — the guard half is dead
     (`assessSession` / `formatGuardContextBlock` are called only from tests), but
     the module is imported for two pure helpers (`rowPnlUsd`, `utcDayStart`).
  Verified **correct** as reported: `TradeValidationGate` really has zero importers
  (all four production mentions are comments), `MemoryConsolidationService.ts` has
  zero references at all, and the `propose_skill` defect is exactly as described.
- **18:12** — **Phase 4 DONE.** Twelve proposals, twelve verdicts, a
  "considered and rejected" section, and a ranked top five with a direct
  recommendation and an order.
- **22:07** — **Independent audit landed** (`INDEPENDENT-AUDIT.md`,
  `PROPOSALS-DELTA.md`), by an agent with no shard authorship in this run. Coverage
  re-derived from its own clones: the gate's 38,979 / 93 / 0-missing **CONFIRMED**, and
  22 of 93 reports spot-checked content-by-content (~300 checks, 3 substantive defects,
  0 fabricated files or symbols). Every August-side `file:line` in the ranked top five
  re-opened at HEAD: P1/P2/P3/P4/P5/P10 **CONFIRMED**, with corrections an implementer
  must carry.
- **00:23 (2026-10-23)** — **The audit was itself audited.** Re-checking its own
  citations found four of its claims wrong or short: P3's two `DeskToolsService.ts`
  attributions were swapped, `NavRail.tsx` keeps **three** live exports rather than the
  two its correction told the plan to write, the `interrupted` flag is on the persisted
  `StoredChatEntry` and not "only on the dock's `LiveEntry`", and P9's premise
  ("cooldown read nowhere on the turn path") fails because `App.tsx:329` feeds the
  fallback provider straight into `useAnalysisPipeline`. Its clone directory
  (`C:/Dev/harness-refs`) does not exist on this machine, though its three commit pins
  re-verify against the clones above; the §2 bucket rows sum 7,024 against a 7,025
  denominator; the header anomaly is three ledgers, not two; and 14 reports carry no
  `path:line` citation at all, not the two named. All corrected in place, and this file
  now indexes both audit documents and carried the two qualifications on its own PASS.
- **01:20 (2026-10-23)** — **The 19-row ledger discrepancy is fixed.** The audit's §4.1
  finding was that `dsh-web-deliverables-feedback` recorded 225 files `read` while its
  own prose said 206 were read and 19 `README.i18n.yaml` records were only opened to
  confirm what they are. The **ledger** was corrected, not the prose: 19 rows moved
  `read` → `skipped` with that reason, and `merge-status.mjs` then `gen-coverage.mjs`
  were re-run so the manifest, `coverage.tsv` and `COVERAGE.md` were rebuilt from the
  ledgers rather than hand-edited. Deepseek-harness is now **13,041 read / 3,256
  skipped**; the run total is **33,020 / 5,959**. The merge re-verified the partition
  unchanged (16,297 rows, 0 missing, 0 phantom, 0 unknown, 0 failing rows).
