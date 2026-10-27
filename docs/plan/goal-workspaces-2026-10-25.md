# Goal Workspaces — goal-as-environment, native in August (2026-10-25)

Status: **the goals core, the self-modification rails, the memory-loop gaps,
the rail/chip UI, the URL support-file import and the library's own delete are
all landed on branch `goal-workspaces-20261025`.** What is left is named at the
bottom of this file (Next slices) and none of it is a secret: the in-place goal
editor with its tool-policy picker, and the live proof that needs a funded or
local provider. This is a plan and status record, not a claim that the whole
target is done.

**Resume facts** (measured at this tip, re-measure rather than quoting):
- This branch lives in the worktree `C:\Dev\august-verify-20261024`;
  `C:\Dev\august-3.5` holds the owner's 22 in-flight files and was never written
  to. Nothing is pushed.
- Commits, oldest first: `e66d8cf7` `05a8a127` `e0449741` `22b05ba8` `51afd154`
  (skills/memory fixes) → `a140f181` `56301d6e` (goal core + plan) →
  `315c46d0` `7576778c` `55e53507` `50963684` (self-mod rails, docs, plan,
  lint ignore) → `056f1a1a` (memory loop) → `bee2933b` (rail + chip) →
  `935d7832` (inverse gate) → `323d6185` (this record) → `9a487648` (declared
  compatibility keys honoured) → `e017e202` (merge keeps its aliases) →
  `491540f6` (URL support-file import) → `defe61da` (delete takes the bundles) →
`82d9e878` (goal editor + the narrowing fix).
- Gates: `check:contracts` **130**; anchor gate **434** anchors, 0 comment-line,
  0 symbol-miss, 0 unattributed; `npm run lint` **0 errors / 379 warnings** (the
  ratchet, and `.verify/**` is now ignored so it reproduces CI); typecheck ×3,
  build, `boot-probe`, `render-probe` **131 ok**, `skill-approval-probe` 25/25
  (its `pageErrors=2` is the planted quota arm).
- Verification scaffolding is untracked in `.verify/`: `node-*.cjs` harnesses
  (134 + 25 + 57 + 13 + 22 + 9 + 5 checks) and `live-probe4.cjs` (**77 passed, 0 failed, 1
  blocked**) which
  drives the goals/self-mod flows in Chromium against a scripted mock provider.
  `.verify/wip/GoalRailPanel.tsx` is dead — the component shipped from it.
  `.verify/url-ref-probe.cjs` is the one that measured how the URL parser treats
  a backslash reference; `check:contracts` cites it.
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

## Goal narrowing could widen — found by building the picker, not by a review

`policy.allowedTools` intersects with the seat's list at the transport, and the
first version of that intersection had a hole the invariant lives on: an empty
result was passed on as `[]`, and in this file `seatIsRestricted([])` is false,
so an empty allow-list means *unrestricted* to every gate. A goal whose policy
named tools the acting seat does not have therefore did not narrow that seat —
it handed it the whole desk. That is reachable because the two seat lists are
different (`CHAT_SURFACE_TOOLS` for the Chat surface, `TRADE_TOOLS` for the
trade seat): a goal authored in one can be focused in the other.

`create_goal`/`update_goal` already refuse a name the acting seat lacks, which
is why no probe had ever hit it — the write gate hides the transport bug rather
than fixing it. Now the rule is one exported pure function,
`intersectGoalPolicy utils/toolKinds.ts:187`, and an empty intersection returns
`NO_TOOLS_ALLOWED` (`utils/toolKinds.ts:170`) — a name no tool can carry, which
matches no definition and refuses every call, so "narrowed to nothing" means
nothing at both layers. `check:contracts` pins it (six arms, including the
reach control that an in-seat policy still narrows normally); proved red by
returning `keep` — three arms failed with the exact value `[]`.

Worth saying plainly: the picker was the point, and the bug it exposed is the
reason the picker's universe is the seat's own list rather than the whole
vocabulary. A control that can only offer valid choices is cheaper to trust
than a transport that has to fail closed.

## A trigger nobody called — the second defect the goal slice turned up

`goalMatchesMessage` (`services/goals/GoalService.ts:278`) shipped complete, was
cited by `docs/app-flow.md` as "the deterministic pre-read that resurfaces a goal
from the trader's own words", and had NO caller. The flow doc therefore described
a label the model reads in the index as if it were a behavior. Nothing in the gate
set could see it: the function is correct, `buildGoalsIndex` prints the trigger
words either way, and a prose claim about a live path is not something the anchor
gate can contradict — it checks that a citation lands, not that the cited thing
runs.

Wired now, at the one place the seat prompt is composed
(`surfacePromptWith services/trade/chatSurfaceTurn.ts:178`), matching only the
TRADER'S OWN line (`matchText` from `req.prompt`) and appending one hint line that
names the goal and offers `open_goal`. Three rules it keeps, all pinned:
a non-match attaches nothing; the hint never changes `focused` (an environment
switch stays the trader's call, per the untrusted-input rule); and an unattended
run passes no `matchText` at all, because a tool output or a fetched page must not
be what points the seat at an environment. `node-goals` holds six arms of it and
the live probe holds the turn-side wiring — the part no unit arm can prove, since
the wiring IS the call site.

## The memory loop shipped switched OFF — and the probe had been hiding it

`isGlobalMemoryEnabled` is a per-profile setting that gates the profile index,
the notebook topics index, the deterministic pre-read and the
`remember`/`read_memory`/`forget` seat. Its default was `?? false` on load and
`useState(false)` before that, so **every profile that never discovered the switch
ran with no memory at all** — which is every profile this repo ships. Spec item 18
calls the control "a setting to turn memory off entirely", and item 8 injects the
profile/preferences/index each turn; both presuppose it is on. Fixed at the three
sites that decided it (loader default, hook initial, profile reset), each with the
reason beside it.

Two things this is worth recording as method, not just as a diff:

- **The live probe had been asserting the property while destroying the evidence
  for it.** Its seeded profile row carried `isGlobalMemoryEnabled: true`, so every
  memory arm ran with the loop switched on BY HAND and none of them could see the
  default. The seed no longer sets it; the default arm now measures what it
  actually claims.
- **Writing a store the app owns, to prove what the app does with it, is the
  probe fighting the product.** Two drafts set `settings.isGlobalMemoryEnabled`
  through IndexedDB and reloaded; the row read back `true` every time, because
  `useProfilePersistence` re-persists live state. The fix was not a longer wait —
  it was clicking the switch the trader clicks, at
  `MemoryFilesManager.tsx:366` on the Learn surface (Settings → Memory holds the
  LIST, not the switch, which is why an arm aimed there finds nothing).

Five arms now cover it: the pristine profile reads the switch ON and gets both the
index and the pre-read; one press reads back `aria-checked=false` and the next turn
carries neither; `remember` lands no row while off; pressing again restores the
index, which also leaves the state as every later arm expects.

## The strategies switch gated a label, not a prompt

Found while fixing the line above it, and it is the same shape: a control that
reads as a promise. `isStrategiesEnabled` was read by exactly one thing — its own
"On — enabled books are used" caption — and `getEnabledStrategiesText()`, the
function that turns uploaded books into prompt text, had **no caller at all**.
The dock's prompt callback listed `[symbol, trades]` as its only deps, so even a
mid-session flip could not have reached it. Meanwhile the per-book Enabled
checkbox and the upload flow both worked, which is what made it read as wired.

The owner was asked in product terms and chose to wire it rather than default it
off. One function now composes BOTH strategy sources behind ONE opt-out gate
(`activeStrategiesBlock`, `strategyStore.ts:226`): the ACTIVE plans from the
notebook folder plus the enabled books, and an explicit `enabled: false` returns
'' for the whole section. Both seat homes call it — the Chat surface through
`surfacePromptWith` and the dock through `strategiesForPrompt`, whose deps now
carry both switches. The default is ON at both sites that decide it (the loader
and the hook's initial state), because a book the trader marked Enabled is a
promise the app made; a stored `false` still means they said no.

Proof, in the two layers the app has:

- **The store gate and the seat hop, deterministic** — six arms in
  `node-authoring` (21/21). Three of them call the real
  `chatSurfaceSystemPrompt`, not the block builder, because a dropped hop reads
  exactly like a working gate at the store level and a switch that does nothing
  in the app. Proved red by unthreading only the flag: the arm reports
  `off has books=true` while its siblings stay green, then 21/21 on restore.
- **The whole hop, live** — five arms in `live-probe4` (82 passed, 0 failed, one
  `BLOCKED` that is the unprompted-model-choice measurement): an enabled book
  reaches the seat at the shipped default, Settings → **Playbooks** shows the
  switch ON for a profile that never touched it, one press reads back off and
  the next seat prompt carries neither section, and pressing again restores it.
  The harness had to stop clearing `location.hash` to leave Settings — the scrim
  stays mounted and intercepts the next composer click — so it now dismisses the
  real overlay and asserts the scrim is gone before sending.
- Gates on the same tree: anchors 445 (restated, 0 unattributed), contracts 130,
  typecheck ×3, lint 0 errors at the 379-warning ratchet, build, boot-probe,
  render-probe and skill-approval 25/25.

## The startup graph paid for the pass, and the guard caught it

`Guards` went red the first time it ran on the merged tree: the entry chunk was
1,434 kB against a 1,400 kB ratchet (1,377.98 kB measured on 2026-10-20). It was
not a library and not the shell pass — shell v2 alone measured 1,389 kB; the
goals, self-modification and memory work added the rest, and all of it is
turn-time code rather than startup code. The desk-turn stack (`DeskToolsService`
and the goal, strategy and profile-memory services behind it) and the
deep-analysis memory assembly are needed when a message is SENT. Both are now
`await import(...)` at their two call sites in `useAnalysisPipeline`, and the
entry measures **1,145 kB** (-289 kB). The first send pays one extra chunk fetch,
which the browser then caches. `CEILING_KB` drops 1400 → 1200 so the ratchet
keeps binding — the guard's own stale-ceiling rule refuses a build more than 10%
under the ceiling, which is why the number moves down with the build.

Proof: build entry 1,145 kB; boot and render probes green (render-probe drives
real exchanges through the deferred stack); live probe 87 passed / 0 failed /
1 blocked *after* the change, so the deferral is measured on the path it moved.

## Next slices

1. **Goals UI** — landed. The Chat rail's third tab (`components/agents/GoalRailPanel.tsx`)
   lists every goal with its focus control, Pause/Resume, the last three history restores, a delete that asks once before it commits, and a create form; under it the change ledger lists what is in force with one Undo per row. The Chat header carries the active-goal chip (`components/agents/ActiveGoalChip.tsx`) and its single press releases the goal — the chip exists because a focused goal changes which tools the next turn is offered. The row's `Edit` press now opens an in-place editor over the same fields the desk writes — objective, next step, the phrases that resurface the goal, and a tool-policy picker limited to tools THIS seat can reach — through `updateGoal` with the same `ifVersion` lock: a model edit mid-session makes the human press name the revision that won and keep the editor open rather than overwrite it. Two rules the editor had to keep: replacing only the `message` trigger (a `price` trigger names a watch id the rail cannot offer, so a prose edit must not un-arm it), and `policy: {}` on a cleared switch, which means "unchanged seat list" rather than a stored empty array.
2. ~~Self-modification rails~~ — landed above.
3. **Remaining target gaps** — the memory half landed with this pass: the
   pre-read runs on every model and attaches the record's own body, aliases
   ride the index line, a record carries `subject` and `sourceSession`,
   `read_memory "all"` holds sensitive rows back for every seat, and the secret
   table refuses a bare SSN shape, an IBAN and a labelled account number. A
   full-store merge also stopped costing the survivor its aliases: the
   consolidation write now carries both sets, the subject and the session, so
   consolidating no longer makes recall worse at the moment it is meant to fix
   it (proved red without the change — the merged row came back `["pnpm","bun"]`
   with the new fact's match word dropped). The
   skills half is now: `requires_tools` / `fallback_for_tools` / `platforms` are
   read from a declared file (flat, nested, or inline-JSON) and honoured, with
   the blob winning and the author's lines still round-tripping;
   `requires_toolsets` / `fallback_for_toolsets` are announced at import as
   preserved-but-unenforced rather than left silent, and a URL import now brings
   the files the fetched SKILL.md names: `skillSupportRefs` reads the body for
   its `references/`, `templates/`, `scripts/` and `assets/` siblings and
   `resolveSiblingUrl` refuses anything that is not https, not on the skill's
   own host, or not under the SKILL.md's own folder, before a request leaves.
   The result is fed to the SAME `importSkillFiles` folder path with folder-style
   relPaths, so bundling, the `scanSkillText` screen and the trader's
   confirmation are one pipeline, not two. Caps: 12 siblings, 200kB each, 600kB
   per batch (spent in body order, so a concurrent pair cannot double-count),
   one shared 20s deadline; every refusal is named in the receipt. Two bugs fell
   out of running the real path on a non-`.md` file: `bundledName` slugified the
   leaf, so `scripts/helper.py` was stored as `helperpy.md` and the address the
   body handed the model no longer resolved; and discovery used to reject an
   escaping `references/../../x.md` silently instead of reporting it. The library's
   own delete now takes the head WITH its `<slug>__…` bundled siblings in one
   notebook write (proved red head-only: two orphan files left behind), and the
   enable toggle, source badge and two-click delete were already shipped on every
   row — checked, not built. Item 18's skills list is therefore closed.
4. **Live proof** — measured already: the focused goal narrowing the offered
   tools AND the executor refusing a tool outside its policy, the ledger row's
   Undo press, the chip's release press, the pre-read reaching a seat whose
   config reads as a strong, non-local model, `create_goal` refusing a policy
   that names a tool the acting seat lacks, the rail's in-place editor writing
   objective/next/triggers/policy into the stored goal under the version lock,
   and a human history restore undoing a deliberate bad edit as a NEW revision.
   The shadow settle is proven at its CALL SITE, not just as a function —
   `node-selfmod` drives the real `syncClosedTradeToNotebook` pass and reads the
   ledger afterwards, and deleting the call at `SkillMemoryService.ts:3947`
   turns that arm red with `status=shadow` (57/57 with it, 56/57 without).
   Still blocked, and now measured rather than asserted: the model *choosing*
   `propose_self_change` or a `skill_view` unprompted. `live-probe4` probes four
   local model endpoints each run (`11434/1234/8080/4000`) and prints
   `BLOCKED [live-model]` with the list of what it tried and that all were
   closed — the detection itself is exercised, because the probe asserts its own
   mock answers `/v1/models`. Start any local OpenAI-compatible server and that
   arm turns into a NOTE naming the endpoint to point one real completion at;
   until then the scripted mock proves the wiring, never the choice.
5. **Forget and "anything derived solely from it" (spec item 9)** — BUILT, and
   it needed provenance to be decidable at all. `forgetProfileMemory` now returns
   `{ gone, removed, carried }` and takes with the named line every row whose
   whole `derivedFrom` list resolves to slugs this delete already dooms —
   transitively, because a one-level check strands C when C derives from B
   derives from A. The field is written by the consolidation merge, which was
   already deleting its inputs and recording nothing; the survivor now says which
   lines it absorbed. Two consequences worth naming: the merge must retire its
   inputs through a NON-cascading delete (`retireMergedMemory`), because the
   survivor's list names exactly those slugs and running the trader-facing forget
   there would delete the merged row seconds after writing it (caught while
   writing the arms, not after shipping); and an ordinary re-save of a survivor
   keeps its `derivedFrom`, or the next `remember` would erase the record the rule
   reads. Both the desk receipt (`alsoRemoved` / `itAlsoCarried`) and the Settings
   memory list say what actually left, so a delete of two rows is never presented
   as a delete of one. Ten harness arms, three of which go red when the cascade is
   neutered, plus five live arms in the real Settings list.
6. **UI/merge** — the owner's redesign branch and this branch both touch
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
