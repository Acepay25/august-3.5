# Harness research — status

**Task:** exhaustive deep-dive of three reference harness repos, then evidence-based
improvement proposals for the August Trading harness. RESEARCH ONLY — no August
Trading source code is modified by this work.

**Started:** 2026-10-22 (Asia/Manila)

---

## Scope

| Item | Value |
| --- | --- |
| In scope | the harness app: agent loop, tools, debate/ensemble, review/learning, UI |
| Out of scope | the model training pipeline, except where the harness feeds it (trade log / training-data export) |
| Reference repos | `earendil-works/pi`, `deepseek-ai/deepseek-harness`, `NousResearch/hermes-agent` |
| Safety | reference repos are read-only and untrusted: no install/build/postinstall, no code execution, no exchange API keys, no orders, no live accounts |

## Reference repos (shallow clones, outside the August Trading repo)

| Repo | Local path | Tracked files | Status |
| --- | --- | --- | --- |
| `earendil-works/pi` | `%TEMP%\harness-research\pi` | 1987 | cloned |
| `deepseek-ai/deepseek-harness` | `%TEMP%\harness-research\deepseek-harness` | 16297 | cloned |
| `NousResearch/hermes-agent` | `%TEMP%\harness-research\hermes-agent` | — | pending clone |

> The prior `harness-research` clone also contains `simulide` (a circuit simulator).
> It is **not** one of the named reference repos and is **out of scope**; it is
> excluded from every manifest.

## Phases

| Phase | Deliverable | Status |
| --- | --- | --- |
| 0 | `docs/research/trading-baseline.md` — what August Trading's harness does today, real vs cosmetic | **DONE** |
| 1 | `docs/research/<repo>/manifest.tsv` — coverage ledger, every tracked file | **DONE** |
| 2 | `docs/research/<repo>/shards/<shard>.md` — one subagent per shard, full read | in progress (93 shards dispatched) |
| 3 | `docs/research/<repo>/ARCHITECTURE.md` — synthesis + coverage summary (lead verifies) | pending |
| 4 | `docs/research/TRADING-IMPROVEMENTS.md` — proposals with verdicts and a ranked top-5 | pending |

## Manifest status vocabulary

| Status | Meaning |
| --- | --- |
| `read` | the file was opened and its content incorporated into its shard report |
| `skipped` | the file was NOT read line by line; the `note` column states why and what was done instead |
| `pending` | not yet dispatched (Phase 1 default) |

The Phase 3 gate requires every manifest row to be `read` or `skipped` with a
reason. A `skipped` row is honest about depth: the note says whether the file was
catalogued (structure + entry points) or deliberately excluded (generated, vendored,
binary, out-of-scope language).

## Log

- **2026-10-22** — Phase 0 started. Recovered the Stage 3 plan from git history
  (`docs/plans/stage3-arrangement.md`, last present at `dd34ea87`); it is deleted from
  the working tree but is the governing plan for the harness work.
- **2026-10-22** — **Phase 0 DONE.** Seven readers covered the harness; 343 numbered
  features classified. Deliverables: `docs/research/trading-baseline.md` (the
  synthesis) plus the seven evidence files in `docs/research/baseline/`.
  Headline: **256 features REAL, 61 dead/cosmetic, 29 partial.** The largest single
  finding is that the analysis pipeline assembles the trader's context and discards
  it — `enhancedPrompt` is written 4× and read once, by a `devLog`
  (`hooks/useAnalysisPipeline.ts:1168-1213`); all three sends use `promptToSend`.
- **2026-10-22** — **Phase 1 DONE.** Coverage ledger built for all three repos
  (`manifest.tsv`, `shard-sizes.tsv`, and a per-shard work order
  `shards/<shard>.files.txt`). 39,979 tracked files across 93 shards.
- **2026-10-22** — **Working-tree incident.** Six source files were modified during
  the baseline pass (a `startedAt` work-clock field). This is a research-only task, so
  the change was reverted with `git checkout --` and preserved verbatim as
  `docs/research/REVERTED-unintended-edits.patch`. The tree is clean of source
  changes; only `docs/research/` is new.
- **2026-10-22** — **Phase 2 dispatched (second attempt).** The first run read one
  file per tool call; on a 402-file shard that is ~2.4 minutes per step, and after
  95 minutes not one shard report had been written. The brief was rewritten to
  specify **batch reading** (15–30 files per shell call, `Get-Content -Raw` with a
  header per file — a read, not an execution) and **three read tiers** (a full entry
  for load-bearing source, a one-line table row for the bulk, skipped-with-a-reason
  for generated/vendored/binary). The run was killed and relaunched at concurrency 9
  with the shards ordered by value, so a partial run still lands the
  harness-critical ones first. After the fix, seven reports landed in twenty
  minutes.
- **2026-10-22** — **Phase 3 spot-checks begun** (the lead re-opens the source and
  confirms the claims; the shard authors do not verify their own work). First
  checks: `dsh-core` and `pi-ai`. **6 of 7 claims verified exactly; 1 verified
  true with a line-number drift of ~76 lines** (`max-tokens is sticky` is at
  `packages/core/agent-loop/src/agent.ts:338-341`, not `:262-267` as cited). The
  claim held; the citation drifted.
