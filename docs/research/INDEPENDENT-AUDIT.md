# Independent audit of the harness-research run

**Auditor:** a second agent with no shard-authorship in this run. Written 2026-10-22,
after the run declared its Phase 3 gate passed (`f144cdf5`).
**Method:** the auditor cloned all three reference repos independently and proved the
clones sit on the **same commits** the run read
(pi `58c0b02c`, deepseek-harness `687f282e`, hermes-agent `4e58c721`) before checking
anything. Those pins re-verify against the run's own checkouts at
`%TEMP%\harness-research\{pi,deepseek-harness,hermes-agent}` — `git rev-parse HEAD`
returns the three SHAs above there — so the citations below are checkable from that
location; `STATUS.md` names it as the clone directory. Every machine check below ran
against a frozen snapshot of this tree
(`docs/research/` copied at 21:39), so the numbers are internally consistent even
though the run was live while the audit started. Two scripted checks were discarded
during the audit because they were the auditor's own artifacts (a line counter that
dropped blank lines, and a citation matcher that could not see house-style
backtick placement); the numbers below are from the corrected versions. Because those
two matchers were discarded, **the §2 counts are not reproducible from this repo** —
an independent extension-based recount of the 93 reports finds 7,090 `path:line`
tokens (pi 1,044 / deepseek-harness 2,466 / hermes-agent 3,580), so treat §2 as the
auditor's measurement with a stated matcher, not as a gate output.

---

## 1. Coverage verdict — the run's gate claim is CONFIRMED

The run claims "38,979 files, 93 of 93 shards, 0 missing". Independently re-derived
from `git ls-tree -rl HEAD` in the auditor's own clones:

| Repo | git files | manifest rows | missing | phantom | duplicates | shard orders | files in no shard |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pi | 1,987 | 1,987 | 0 | 0 | 0 | 12 | 0 |
| deepseek-harness | 16,297 | 16,297 | 0 | 0 | 0 | 47 | 0 |
| hermes-agent | 20,695 | 20,695 | 0 | 0 | 0 | 34 | 0 |
| **total** | **38,979** | **38,979** | **0** | **0** | **0** | **93** | **0** |

Ledger status (per-shard `status.tsv`, the authoritative per-file record, checked row
by row against each work order):

| Repo | read | skipped (all with notes) | missing rows | extra rows | bad status vocab | duplicate rows |
| --- | --- | --- | --- | --- | --- | --- |
| pi | 1,811 | 176 | 0 | 0 | 0 | 0 |
| deepseek-harness | 13,060 | 3,237 | 0 | 0 | 0 | 0 |
| hermes-agent | 18,168 | 2,527 | 0 | 0 | 0 | 0 |

Every tracked file is accounted for as `read` or `skipped`-with-reason, in exactly one
shard, with no invented paths. **The gate's coverage claim is true.** One caveat: the
manifest's `size` column is the *checked-out working-tree* size (CRLF applied), not
the blob size — e.g. hermes `.dockerignore` 2,590 on disk vs 2,462 in git. Harmless
for shard balancing, but the ledger records no commit SHA anywhere, so it cannot be
re-derived against a pinned upstream commit; this audit pins them above.

## 2. Citation quality — 7,025 `path:line` citations across the 93 reports

| Bucket | Count | Share | Meaning |
| --- | --- | --- | --- |
| exact repo-root path | 3,922 | 55.8% | resolves as written |
| abbreviated, unique match | 2,288 | 32.6% | resolvable (basename or suffix unique in the repo) |
| ambiguous bare name | 798 | 11.4% | several files share the name; machine-uncheckable, usually fine in context |
| no such file anywhere | 16 | 0.2% | see adjudication below |
| line number past EOF | 64 | 0.9% | cites a line the file does not have |

**Read this table as three partitions plus one cross-cutting count.** The first four
rows are mutually exclusive and sum to **7,024**, one short of the 7,025 denominator —
the auditor's own census has an unreconciled row, and since the matcher that produced
it was rebuilt mid-audit (§Method) the discrepancy is not resolvable from here; it does
not move any bucket by more than one. The fifth bucket is **not** a partition member: a
citation that resolves to a real file can still point past its end, so the 64 past-EOF
hits live inside the first two rows. Percentages are all against 7,025.

Resolvable rate **88.4%** (exact + abbreviated). The defect class is **line drift, not
fabrication** — see §3.

Adjudication of the 16 "no such file" citations (each re-checked by hand against the
pinned commits): 4 are the auditor's matcher failing on legitimate forms (`.../`
elision in `hermes-website.md`, and two cross-repo references from
`dsh-interaction-guard-plan.md` that resolve in the pi and hermes checkouts). The
remaining ~12 are real citation defects of the wrong-directory / wrong-extension
species, e.g. `packages/core/agent-loop/src/runtime-types.ts` (the file is
`packages/core/agent/src/runtime-types.ts`), `task-detail.client.spec.ts` (the file
is `.spec.tsx`), `evals/compaction/jev_cycles.py` (real path adds `scripts/`), and
`ui-tui/src/__tests__/app-mouse-watchdog.test.ts` (real path
`ui-tui/packages/hermes-ink/src/ink/…`). One appears genuinely fabricated-shaped but
supports a real fact.

## 3. Spot-check — 22 of 93 reports (23.7%), content-level, 8 verifier agents

Each verifier re-opened the source at the cited lines and ruled each claim
SUPPORTED / WRONG / OVERSTATED / UNVERIFIABLE, quoting the real code. Shards chosen
to cover the agent loop, tools, session/compaction, skills/rules lifecycle, approval
UI, cron/scheduled work, storage, evals and plugins — the areas Phase 4 leans on.

| Report | Claims ruled | Wrong | Note |
| --- | --- | --- | --- |
| pi-coding-agent-src | 10 | 0 | line drift only (e.g. cited :436, real :585) |
| pi-durable | 12 | 0 | 2 past-EOF ranges; both claims real elsewhere in the file |
| pi-agent-env | 16 | 0 | 1 stale range (~40 lines) |
| pi-ai (zero-citation table style) | 17 | 0 | verified by content; line counts match `wc -l` |
| pi-tui | 17 | 0 | 1 imprecise pointer (constant vs its use site) |
| pi-evals-telemetry | 23 | 0 | cleanest shard audited |
| dsh-core | 12 | 1 | wrong-directory citation in the ideas list (§2 above) |
| dsh-llm | 7 | 0 | sub-line drift only |
| dsh-interaction-guard-plan | 12 | 0 | the two cross-repo flags are legitimate |
| dsh-session | 19 | 0 | 7 ambiguous bare names, all resolve via prose |
| dsh-workflow-jobs-schedule (zero-citation style) | 11 | 0 | every quoted string verbatim in source |
| dsh-skill-goal-todo-spill | 11 | 1 cosmetic | `refine` mislabelled `superRefine`; line correct |
| dsh-client-approval-agents-ui | 20 | 0 | approval flow verified claim-by-claim, 10 checks |
| dsh-notes-current | 16 | 0 | one machine flag was the auditor's artifact |
| hermes-agent-loop | 18 | 0 | **8/8 past-EOF flags confirmed** — systematic stale line numbers on 5 core files; content real at correct lines |
| hermes-tools | 8 | 0 | essentially no drift found |
| hermes-gateway | 13 | 0 | one 7-line drift |
| hermes-skills-core | 8 | 0 | clean |
| hermes-cron | 14 | 1 | one weak-spot figure overstated ~30% (cron/ is ~19.1k lines, not ~25k); reliability claims 11/11 real |
| hermes-state-storage | 9 | 0 | cleanest of the hermes set |
| hermes-plugins | 13 | 0 | one line drift (chronos :146 → :201) |
| hermes-evals | 12 | 1 | one wrong dir + wrong line (`jev_cycles.py:20`); §2 line numbers drift ~20–100 lines |

**Totals: 298 claims ruled across the 22 reports, 4 rows in the Wrong column, 3 of
them substantive** (`dsh-skill-goal-todo-spill`'s `refine`/`superRefine` mislabel is
self-labelled cosmetic and is not counted as a defect). Plus the flags and ideas the
verifiers raised — roughly 300 checks in all. **0 fabricated files, 0 fabricated
symbols, 0 overstated behaviour.** The run's prose is trustworthy;
its line numbers are not uniformly — follow them as hints, and where a Phase 4
proposal carries a citation, the implementer should re-open the file rather than
trust the range.

## 4. Findings the gate should record (none block the pass)

1. **Report/ledger mismatch, one shard** — `dsh-web-deliverables-feedback.md` claims
   `read: 206, skipped: 19`; its own ledger says `read: 225, skipped: 0`. Nineteen
   files the prose admits were not fully read are recorded as `read`. The only honesty
   defect found in 93 ledgers — and it is the only one: re-running the comparison over
   all 93 reports against their own ledgers finds exactly one disagreement (86 reports
   print a machine-parseable tally; 7 print none, so they could not be compared).
   **Consequence for the roll-up:** the merged manifest carries the ledger's version,
   so `STATUS.md`'s `deepseek-harness read = 13,060` and the total `33,039 read` each
   include those 19 rows. Fix the ledger (19 rows → `skipped` with the reason the prose
   already gives) rather than the prose, or restate the read totals as "33,039 recorded
   `read`, of which 19 the reports themselves say were not read line by line".
2. **Three ledgers whose first line is not the required `path\tstatus\tnote` header** —
   `dsh-docs-persistence` and `dsh-client-primitives-theme` start directly on a data
   row, and `dsh-client-approval-agents-ui` line 1 is a stub `path\t-\t-\`. A merge
   script that skips line 1 blindly would drop a real row from the first two; the
   run's roll-up evidently tolerated all three (the per-repo row counts still match
   `git ls-tree` exactly, §1). One of the three, `dsh-client-approval-agents-ui`, is a
   report §3 spot-checks, so its header anomaly was in front of the auditor.
3. **One quoted-path row** — DSH's `snapshots/web/present/workspace.expected/说明.txt`
   is enumerated in git-quoted octal form with size 0 and type `source`; the reader
   received an unopenable pseudo-path. One file of 38,979; fix the enumerator, not
   the shard.
4. **Citation-style heterogeneity, and it is wider than "several"** — **14 of the 93
   reports** carry zero `path:line` citations: `pi-ai`, `pi-coding-agent-examples-docs`,
   `dsh-apps-desktop`, `dsh-client-primitives-theme`, `dsh-client-settings`,
   `dsh-experimental-misc`, `dsh-notes-archived-arch`, `dsh-notes-archived-bugfix`,
   `dsh-notes-archived-feature`, `dsh-notes-archived-testing`, `dsh-notes-impl-arch`,
   `dsh-workflow-jobs-schedule`, `hermes-cli-root`, `hermes-scripts-ci`. At the other
   end only two exceed 500 (`hermes-gateway` 1,243, `pi-agent-env` 507). The brief's
   "every claim must carry a path:line reference" is enforced unevenly; the
   zero-citation reports survived content-level verification, but they cannot be
   machine-audited, and any re-basing pass must cover 14 reports, not the two named
   here originally.
5. **Line drift is systemic** (~12% of sampled citations point 2–150 lines off;
   `hermes-agent-loop` is the worst, with every one of its five core files cited past
   EOF). Consistent with citations taken from batch-read output offsets rather than
   from the files. A re-basing pass over the ~64 past-EOF and ~12 wrong-path citations
   would make the corpus fully machine-trustworthy.

## 5. Bottom line

The run's Phase 3 verdict — gate passes, coverage complete, ledgers honest — is
**confirmed** by an independent pipeline, with two qualifications the verdict does not
carry on its own. The one correction a reader must take: treat shard-report line
numbers as approximate (verify before implementing). The two qualifications:
(i) the `read` totals are inflated by the 19 rows of §4.1(1), so "ledgers honest"
means *arithmetically complete*, not *every `read` was read line by line*; and
(ii) §4.2's three header anomalies survive the roll-up, so the merge script's
tolerance is load-bearing and undocumented. Fix the single report/ledger mismatch in
`dsh-web-deliverables-feedback` before treating its per-file read claims as complete.
