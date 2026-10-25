# Goal Workspaces — goal-as-environment, native in August (2026-10-25)

Status: **the goals core, the self-modification rails, the memory-loop gaps and
the rail/chip UI are all landed on branch `goal-workspaces-20261025`.** What is
left is named at the bottom of this file (Next slices) and none of it is a
secret: the Hermes→`compatibility` key mapping, URL import of referenced support
files, a user-skill delete, the in-place goal editor, and the live proof that
needs a funded or local provider. This is a plan and status record, not a claim
that the whole target is done.

**Resume facts** (measured at this tip, re-measure rather than quoting):
- This branch lives in the worktree `C:\Dev\august-verify-20261024`;
  `C:\Dev\august-3.5` holds the owner's 22 in-flight files and was never written
  to. Nothing is pushed.
- Commits, oldest first: `e66d8cf7` `05a8a127` `e0449741` `22b05ba8` `51afd154`
  (skills/memory fixes) → `a140f181` `56301d6e` (goal core + plan) →
  `315c46d0` `7576778c` `55e53507` `50963684` (self-mod rails, docs, plan,
  lint ignore) → `056f1a1a` (memory loop) → `bee2933b` (rail + chip) →
  `935d7832` (inverse gate).
- Gates: `check:contracts` **102**; anchor gate **414** anchors, 0 comment-line,
  0 symbol-miss, 0 unattributed; `npm run lint` **0 errors / 379 warnings** (the
  ratchet, and `.verify/**` is now ignored so it reproduces CI); typecheck ×3,
  build, `boot-probe`, `render-probe`, `skill-approval-probe` 25/25 (its
  `pageErrors=2` is the planted quota arm).
- Verification scaffolding is untracked in `.verify/`: `node-*.cjs` harnesses
  (95 + 13 + 5 + 9 + 9 + 19 + 54 checks) and `live-probe4.cjs` (**42/42**) which
  drives the goals/self-mod flows in Chromium against a scripted mock provider.
  `.verify/wip/GoalRailPanel.tsx` is dead — the component shipped from it.
- Two probe facts that cost time: a `SelectMenu` flyout never stays open to a
  Playwright pointer click inside the Settings modal (drive it by keyboard, and
  walk `data-active` rather than counting presses), and a background learner
  (notebook reviewer / skill supervisor) issues its own provider calls mid-turn,
  so every seat assertion must filter requests by the text the probe typed.
- The live packaged profile was hash-verified unchanged before and after this
  branch's work; the app's journal still cannot be read headlessly, so exact live
  row counts remain BLOCKED, not verified.

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

## Self-modification rails (next-slice 2) — what landed

Built as the owner asked: the capability is real, and the ceiling is real. Two
surfaces actually change how this app behaves, and both are open; everything
that could change a *decision the trader owns* is closed by name.

- `schemas/selfChange.ts` — `off | config | shadow` mode, and the ledger row:
  target, verbatim previous value, new value, the stated reason, status, actor,
  window, corpus fingerprint, evidence. `z.strictObject` refuses a smuggled key.
- `services/selfMod/SelfChangeLedger.ts` — one JSON file per change in the
  notebook `self-changes/` folder (a default folder, like `goals`). The row is
  why undo is a read and not a guess. Capped at 60 rows, terminal rows first.
- `services/selfMod/SelfModificationService.ts` — the policy.
  - **config**: `responseEffort`, `skillLibraryCap` (both owner-visible dials in
    Settings → Analysis). Applies now, auto-reverts after 24h, per-target
    6h cooldown, at most 8 changes active-or-measuring at once.
  - **shadow**: a registered prompt override, refused unless the app's own
    prompt A/B is armed (rate > 0, no lane pin), because an edit nobody is
    compared against is not a shadow. Settled by `settleSelfChanges` on the
    closed trades that ran under its corpus fingerprint, at the same
    5-per-side / 8-point bar `maybePinWinningPromptLane` uses. It runs from the
    learning pass beside that call, so no new scheduler exists.
  - **blocked, by name**: equity, risk, leverage, edge floor, session guard,
    outcome settlement, skill veto, starter shelf, auto-drafting, sensitive
    memory, desk tools, the A/B rate and pin, and the mode itself. Skills are
    not a self-change target at all: the approval inbox plus `meta.shadow` and
    `settleShadow` remain the only route to a live rule.
- Desk tools `list_self_changes` (read, works with the mode off and on a
  detached seat), `propose_self_change`, `revert_self_change`. Both writes are
  in `UNATTENDED_DENY`, and a restricted seat that lacks them is read-only.
- The seat is told about the capability only while the trader has it on: the
  mandate line is gated on the mode, so an off switch removes a promise instead
  of leaving one the executor refuses.
- `setSelfModMode` is the one writer of the switch (Settings → Analysis →
  Advanced → Self-modification) and pulling it to `off` reverts every agent
  change in force, promoted ones included.
- A prompt override edit is refused by the same content scan that screens
  third-party skill text, and by the placeholder check, so an injected
  instruction or a broken `{{TOKEN}}` cannot ride in as "self-improvement".

**Verified.** `.verify/node-selfmod.cjs` **54/54**; `live-probe4` (Chromium,
mock provider, Chat surface) **33/33** — mode-off refusal moved nothing, the
switch stored the mode, a knob landed and was audited with the value it
replaced, the cooldown and the blocked risk key held, a goal narrowed the
offered tools *and* the executor refused a tool outside its policy, revert
restored the exact previous value, shadow edit + switch-off round-tripped
through the prompt store. `check:contracts` 84 → **93** (a 12th section pins
the policy table: no earlier section pinned a table, and a renamed setting key
would silently open a knob). Flow docs re-anchored by byte-verified line map:
**403 anchors**, 0 on a comment line, 0 missing their symbol; the earlier stated
"4 exempt comment citations" was wrong since the pass that wrote it and is now
5. `typecheck`, `typecheck:scripts`, `typecheck:electron`, `lint` (0 errors,
379 warnings = the ratchet), `build`, `boot-probe`, `render-probe`,
`skill-approval-probe` (25/25) all green.

**Not done.** No UI surface yet for the ledger beyond the notebook file browser
and the mode switch — the audit rail is next-slice 1's host. The live shadow
promotion cannot be observed without real closed trades, so its thresholds are
pinned by the node harness, not by the app.

## Next slices

1. **Goals UI** — landed, except the in-place editor. The Chat rail carries a
   third tab (`components/agents/GoalRailPanel.tsx`) listing every goal with its
   focus control, Pause/Resume, the last three history restores, a delete that
   asks once before it commits, and a create form; under it the change ledger
   lists what is in force with one Undo per row. The Chat header carries the
   active-goal chip (`components/agents/ActiveGoalChip.tsx`) and its single
   press releases the goal — the chip exists because a focused goal changes
   which tools the next turn is offered. Still open: editing a goal's
   objective/next/triggers in place (the desk does that through `update_goal`;
   the trader cannot yet), and a picker for the goal's tool policy.
2. ~~Self-modification rails~~ — landed above.
3. **Remaining target gaps** — the memory half landed with this pass: the
   pre-read runs on every model and attaches the record's own body, aliases
   ride the index line, a record carries `subject` and `sourceSession`,
   `read_memory "all"` holds sensitive rows back for every seat, and the secret
   table refuses a bare SSN shape, an IBAN and a labelled account number. The
   skills half is still open: source badge and delete-for-user-skills-only in
   the list, manual authoring caps, URL import pulling referenced support files,
   and `fallback_for_tools` / `fallback_for_toolsets` (implemented or retired —
   a tolerated key nothing reads is a false promise to a skill author).
4. **Live proof** — measured already: the focused goal narrowing the offered
   tools AND the executor refusing a tool outside its policy, the ledger row's
   Undo press, the chip's release press, and the pre-read reaching a seat whose
   config reads as a strong, non-local model. Still blocked on a funded or local
   provider: the model *choosing* `propose_self_change` or a `skill_view`
   unprompted, a shadow prompt edit settling on real closed trades, and a goal
   restore used after a deliberate bad edit.
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
- Self-modification cannot widen itself: the mode is not a knob, a blocked key
  is refused before the whitelist can be reached, and the tools that write are
  denied to every seat that has no human watching.
- A shadow edit exists only inside a measurement. Refusing the edit when the
  prompt A/B is disarmed is the rail; promoting it on closed trades is the
  outcome. An edit that ties is left in shadow, because "no verdict" is the
  honest state and not a licence to keep the change.
- Skills keep one route: the approval inbox and the existing shadow/refine
  window. A self-change never becomes a second way past that gate.
