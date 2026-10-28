# Documentation

One reading path. Everything else is evidence, kept where it belongs.

## Read in this order

1. [AGENTS.md](../AGENTS.md) — how to work here: commands, gates, git rules. Most agents load it
   automatically.
2. [product/goal.md](product/goal.md) — what this is, who it's for, the loop, the non-goals.
3. [product/ux/](product/ux/) — what the trader sees: the [charter](product/ux/charter.md), the
   [four surfaces](product/ux/surfaces.md), the [voice](product/ux/voice.md).
4. [engineering/gates.md](engineering/gates.md) — how a change is proven, and what each gate cannot
   see. [engineering/conventions.md](engineering/conventions.md) — code style and the canonical
   single-source modules.
5. [plan/open-items.md](plan/open-items.md) — what is open to build, each row mapped to the proposal
   that covers it. Read [plan/decisions.md](plan/decisions.md) before proposing anything that needs
   the owner.
6. [architecture/system-map.md](architecture/system-map.md) — how the code implements the flow.
   [architecture/learning-loop.md](architecture/learning-loop.md) is the memory loop in depth.

Read [plan/implementation-record.md](plan/implementation-record.md) only to check whether something
already landed. Read `plan/full-audit.md` and `plan/audit/` only when you need the evidence behind a
claim.

## The tree

| Directory | What lives here | Read when |
|---|---|---|
| `product/` | the goal and the UX: charter, surfaces, voice | designing anything the trader sees |
| `architecture/` | the system map and the learning loop | changing a call path, a store, or a prompt |
| `engineering/` | gates, code conventions, the canonical modules | before writing code or claiming a change |
| `plan/` | the working register, decisions, roadmap, what landed, and the audit evidence | choosing what to build next |
| `research/` | the harness-research corpus: three reference-repo syntheses, the August baseline, the independent audit | reading reference designs on demand — not part of the daily path |

## Rules for durable docs

1. **Live docs live here, tracked.** Scratch is not documentation; a plan that must survive belongs
   in `plan/`.
2. **Cite code by symbol, not by line.** Write `` `src/App.tsx` › `App` ``.
   `npm run check:docs` verifies every symbol, every relative link, and that the gates named in
   `AGENTS.md` exist. A line number is a claim that rots on the next edit.
3. **Do not copy a number that can drift.** Name the file that owns it (the lint cap lives in
   `package.json`, the bundle ceiling in the workflow, the contract list in `scripts/check-contracts.cjs`).
4. **One home per fact.** If two docs state the same rule, one links to the other.
5. **Removed history stays in git.** `docs/STATUS.md`, `docs/AUDIT.md`, and `docs/plans/` were
   deleted on 2026-10-29; recover any file with `git log --diff-filter=D -- <path>` followed by
   `git show <sha>^:<path>`. Their live conclusions are in `plan/` and this tree. Code comments
   that cite an audit id (`M-4`, `L-7`, `F-9`) refer to the deleted 2026-10-27 audit — the ids are
   provenance, not live links.

## Where things went

| Was | Now |
|---|---|
| `docs/ui-doctrine.md` | [product/ux/charter.md](product/ux/charter.md) |
| `docs/learning-loop-map.md` | [architecture/learning-loop.md](architecture/learning-loop.md) |
| `docs/app-flow.md` + `.html` | [architecture/system-map.md](architecture/system-map.md) |
| `docs/STATUS.md`, `docs/AUDIT.md`, `docs/plans/` | deleted — in git history only |
