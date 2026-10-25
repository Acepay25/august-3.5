# Goal Workspaces — goal-as-environment, native in August (2026-10-25)

Status: **core landed on branch `goal-workspaces-20261025`; UI and the
skill/prompt/tool self-modification rails are next.** This is the plan and
status record, not a claim that the whole target is done.

## Reference and what transfers

The public reference is Octopus-SI-OS (`miuuyy/Octopus-SI-OS`, commit
`c44cede5`): a Rust kernel with execution environments (goal + policy),
artifacts, durable runs, worker pins, a ledger, verifiers and marks. August
Trading is an Electron/Capacitor TypeScript app; porting the kernel would be a
different application.

What transfers is the **environment model**, and only what fits the repo:

| Octopus | August |
| --- | --- |
| Execution environment = goal + policy | `goals/<slug>.json` in the existing notebook; the goal is the work environment |
| Goals, inputs, outputs, triggers | The goal JSON fields; editable mid-turn |
| Policy narrows a worker | `policy.allowedTools` ∩ the seat's own allow-list; a goal can never widen |
| Durable run / ledger | The conversation, tool trail and the goal's own revision history |
| Worker pin | The existing bot/agent roster; a goal may name one |
| Verifier / mark | Existing tool receipts and approval gates; no second ledger |
| Interfaces / rooms | Existing provider/tool surfaces; not ported |
| Triggers | Existing `watch_price`/`wake_me`, message keyword match, session start |
| Self-evolution | The agent edits its goal JSON; skills/memory stay on the repo's gates |

Explicitly **not** built: a Rust rewrite, a new store, a vector/FTS index, a
second skills system, durable run/verifier ledgers, worker-interface registries,
cron/scheduled automation (deleted 2026-10-24), or autonomous edits to the
compiled app source.

## Owner decisions (2026-10-25)

1. **Full self-modification** — the agent may edit its own harness artifacts at
   runtime. In August that means goals, skills, prompt overrides, tool
   descriptors, triggers and policies. It does not mean editing the compiled
   Electron/TypeScript source or widening its own root policy. The existing
   approval gates remain for the default mode; a separate owner-enabled
   self-modification mode with reviewer/undo/shadow/cooldown rails is required
   before skills/prompt/tool self-edits are enabled.
2. **Triggers** — existing machinery only: price watches, message keyword
   matches, session start. No scheduler and no autonomous background runs.
3. **UI host** — Agents rail Goals tab plus an active-goal chip in the chat.

## What landed

- `schemas/goal.ts` — zod schema for the goal, refs, triggers, policy and
  history; invalid files are skipped with a logged reason.
- `services/goals/GoalService.ts` — list/read/create/patch/focus/restore/delete
  over `goals/<slug>.json`, optimistic locking (`if_version`), one revision of
  history per edit (previous snapshot, bounded to 20), one focused goal, a
  compact `buildGoalsIndex`, message-trigger matching, no new store.
- `MemoryFilesService` — the `goals` folder is a default notebook folder and
  `.json` files are accepted; backup/export covers them. Existing notebooks add
  the folder through the normal harness-folder ensure.
- Desk tools `list_goals`, `open_goal`, `create_goal`, `update_goal`,
  `restore_goal`; goal writes are direct and versioned (the self-modification
  the owner chose for goal state). Detached evaluators may read goals, not write
  them.
- Prompt — a compact goals index in the chat and dock prompts, inside the
  shared budget (`goals` line cap 6/4/3/1 by context window).
- Policy — the focused goal's `allowedTools` is intersected with the seat's
  allow-list at the one turn transport that feeds both the prompt and the
  executor; a goal can only narrow.
- `scripts/check-contracts.cjs` still passes; `.verify` has the goal harness
  (19 checks) and the earlier skills/memory harnesses.

## Next slices

1. **Goals UI** — Agents rail Goals list, active-goal chip, detail/editor,
   status/focus, history/restore. The owner has in-flight edits in
   `AgentsView.tsx`/`LearnView.tsx`/`TradeChatPanel.tsx`; land this after those
   or in a separate worktree to avoid a blind merge.
2. **Self-modification rails** — a generic change ledger for skills, prompt
   overrides and tool descriptors; deterministic validator + reviewer; undo;
   shadow and cooldown; owner-only enable switch; the agent cannot enable it or
   widen its policy. Only after these rails do the non-goal artifacts become
   agent-writable.
3. **Remaining target gaps** — alias pre-read for all models + description,
   aliases in the memory index, subject type/source session, sensitive-read
   policy and bare bank/ID filters, skills source/read-only/manual caps, URL
   support files.
4. **Live proof** — with a funded or local provider: a message trigger surfaces
   the goal, the model loads a matching skill, the focused policy is visible in
   the offered tools, and a goal restore is used after a deliberate bad edit.
5. **UI/merge** — the owner's redesign branch and this branch both touch
   `TradeChatPanel.tsx`; merge the goal core first, then mount the UI.

## Invariants

- One notebook store; no new persistence path.
- A goal is work state, not a skill or a memory; it cannot approve a skill or
  change the memory setting.
- A goal's tool policy only narrows; the executor enforces the intersection.
- Goal edits are versioned and restorable; an invalid goal file never breaks
  discovery of the others.
- No scheduler, no autonomous background run, no compiled-source editing.
