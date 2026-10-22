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
| 0 | `docs/research/trading-baseline.md` — what August Trading's harness does today, real vs cosmetic | in progress |
| 1 | `docs/research/<repo>/manifest.tsv` — coverage ledger, every tracked file | pending |
| 2 | `docs/research/<repo>/shards/<shard>.md` — one subagent per shard, full read | pending |
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
