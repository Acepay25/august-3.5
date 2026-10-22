# deepseek-harness :: dsh-skill-goal-todo-spill

**Files in shard:** 171 (read: 153, skipped with reason: 18 — 17 generated i18n hash records + 1 binary xlsx fixture)
**What this shard covers:** four capability seams of the DeepSeek Harness monorepo — the **goal** domain (a persisted, compare-and-set "long-running objective" plus a driver that keeps re-entering the same session for successive rounds), the **skill** domain (a layered provider registry, a filesystem provider with a real watcher, a model-facing `skill` loader with a durable session catalog, and the bundled Office skill set), the **spill** domain (a Service Definition seam for storing oversized tool output, a local filesystem backend, and a token-budgeted retention policy that truncates inline results and leaves a recovery locator), and the **todo** domain (a model-facing whole-list task tracker stored as a session projection). Together these are the harness's "state that outlives a turn" — the parts of a harness that must survive compaction, restart, and resume.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

---

### `packages/goal/goal/src/index.ts`
- **Purpose:** the same-session goal domain: an event-sourced, compare-and-set goal service plus a durable session projection of "the current goal".
- **Key abstractions:**
  - `GoalService` (`:240`) — the host service on `ctx.goals`, extends `TypertRemoteService` so it can be driven over the remote wire.
  - `goalProjectionDefinition` (`:162`) — the `goal` session projection, `stateVersion: 6`, with a strict zod `stateSchema` and a `superRefine` that enforces three invariants (`:96-107`): the current goal id must appear in `seenGoalIds`, `updatedAt >= createdAt`, and `roundsStarted <= maxGoalRounds`.
  - `applyGoalProjection` (`:146`) — the projection's `apply`, which *never throws*: the first invalid owned event is captured into `state.failure` and the host read path rejects while the client view stays at the last valid goal.
  - `GoalView` / `GoalProjection` / `GoalRef` — three different shapes of the same fact: durable, durable-plus-derivable, and the CAS identity.
- **Data flow:** every mutation (`create` `:303`, `edit` `:329`, `pause` `:352`, `resume` `:364`, `complete` `:391`, `block` `:409`, `clear` `:433`) → `prepareMutation` → `expectCurrent` (stale-ref check) → build a full-snapshot `GoalChangeMeta` → `commit` (`:609`) → `agent.session.append('goal/change', change)` → the session projection folds it → `agentEvents(...).emit('goal/changed', …)`.
- **Non-obvious design decisions:**
  - **Durable phase vs. process-local activation are two different axes.** `GoalPhase` (`active|paused|blocked|complete`) is persisted; `GoalActivation` (`armed|disarmed`) is *never* persisted and lives in a `WeakMap<Session, GoalRuntimeState>` (`:246`). A resumed session therefore comes back with a durable `active` goal that is nonetheless **disarmed** until a human re-arms it. This is the single most transferable idea in the shard: *the thing the model is allowed to keep doing on its own is not the same thing as the thing that is true.*
  - **Compare-and-set on a revision.** `expectCurrent` (`:456`) rejects any ref whose `revision` is not the current one, so two concurrent editors cannot silently clobber. Every mutation bumps the revision by exactly one.
  - **`clear` writes a tombstone, not a deletion** (`:433`): it commits `operation: 'clear'` with a `cleared` ref at `revision + 1`, so the log still shows that a goal existed. `seenGoalIds` also permanently records every goal id, so an id can never be reused (`fold.ts:290`).
  - **The activation edge rides the log offset.** `commit` (`:609`) sets `runtime.pendingActivation = { offset: agent.session.seq, activation }` *before* appending, and the `session/event` listener applies it only if the committed event's `seq` matches. This closes the window where the durable event and the live activation could disagree.
  - **Backward wall-clock is clamped**: `nextMutationTime` (`:574`) returns `Math.max(Date.now(), state.updatedAt)`, so a clock that jumps backwards cannot produce `updatedAt < createdAt` and wedge the fold.
- **Edge cases & failure handling:**
  - `resume` refuses when `roundsStarted >= maxGoalRounds` (`:377`) with a message that *tells the model how to fix it* ("increase maxGoalRounds before resuming") rather than a bare error.
  - `create` refuses to replace a non-complete goal (`GOAL_ALREADY_EXISTS`); a completed goal may be replaced.
  - `block` requires a lower-kebab-case `code` and a non-empty trimmed `message` (`:214`).
  - `assertLive` (`:469`) checks object identity (`ctx.agents.get(agent.id) !== agent`), not just id equality — a stale agent object from a dead lifecycle cannot mutate a goal.
  - A projection failure poisons only the *host* read (`state()` throws at `:481`); the client-visible view keeps the last valid goal.
- **Surprising:**
  - `disarm` is deliberately **not** `@Remote`-decorated and does not write a session event — it changes only process-local state, so "the human stopped the automation" is not a durable fact but is still observable.
  - `remoteExportCreate` (`:647`) exists only to expose `create` on the wire in a shape that returns just a `GoalRef`; the richer `GoalView` is a host-side convenience.
  - `GoalService` declares `static inject = ['agents', 'sessionProjections']` — the goal service is *not* injected into the tools registry, so a goal can exist with no way to edit it.

---

### `packages/goal/goal/src/domain.ts`
- **Purpose:** host-side vocabulary of the goal domain — durable change payloads, message attribution, and the scoped `goal/changed` cordis event.
- **Key abstractions:** `GoalOperation` (`create|edit|pause|resume|complete|block|clear`), `GoalSnapshotChangeMeta` / `GoalClearChangeMeta` / `GoalChangeMeta` (a two-arm union, not an optional-field struct), `GoalMessageSource` (`{kind:'goal', goalId, revision, round}`), `FoldedGoal`, `GoalChanged`, `GoalErrorCode` (nine stable codes).
- **Data flow:** pure type declarations plus two `declare module` augmentation blocks — one extending `dsh-llm`'s `MessageSourceMap` with `goal`, one extending `dsh-session/types`'s `SessionEventMap` with `'goal/change'`.
- **Non-obvious design decisions:**
  - The file exists **because of a packaging constraint**: `types.ts` is the client-safe outlet and must not pull `dsh-agent`/`dsh-llm`/`cordis` into a client aggregate. So host-coupled vocabulary is split out and `types.ts` stays importable from a browser bundle. The comment at `:1-9` says so explicitly.
  - `GoalChangeMeta` is a **discriminated union on `operation`**, with the clear-tombstone arm carrying `{cleared, clearedAt}` and the snapshot arm carrying `{goal, roundsStarted, createdAt, updatedAt}`. A single struct with optional fields would have made "a clear has a goal" representable.
- **Edge cases & failure handling:** `GoalErrorCode` is a closed union — the wire can classify a rejection without string-matching a message.
- **Surprising:** `GoalErrorCode` lives in `domain.ts` while `GoalError` (the class) lives in `runtime.ts`; the class imports the union from `domain.ts`, and `domain.ts` imports `GoalId` from `types.ts` — a deliberate three-file split with no cycle.

---

### `packages/goal/goal/src/types.ts`
- **Purpose:** the pure, client-safe type outlet of the goal domain, and the ONE home of the `goal` projection-key declaration.
- **Key abstractions:** `GoalId` (branded), `GoalRef`, `CreateGoalRequest`, `EditGoalRequest`, `GoalPhase`, `GoalBlockReason`, `GoalSnapshot`, `GoalActivation`, `GoalActivationChanged`, `GoalView`, `GoalProjection`, `GoalProjectionState`.
- **Data flow:** types only. Two `declare module` blocks extend `dsh-session-projection/types` (`SessionProjectionStateMap` + `SessionProjectionMap`) and `cordis`'s `Events` (`goal/activation-changed`).
- **Non-obvious design decisions:**
  - `GoalActivationChanged` is the *only* place process-local activation crosses to a UI client, and it is a separate cordis event from `goal/changed` (which is agent-scoped). **Durable change and live authority are separate events on purpose** — a UI can show "paused" (durable) and "disarmed" (live) at the same time.
  - `GoalProjectionState.seenGoalIds` is a *list*, not a set, so the checkpointed state stays JSON-serialisable; uniqueness is enforced by the zod `superRefine` (`index.ts:88`).
- **Edge cases & failure handling:** the projection value type is `GoalProjection | null` — null before the first create and after a clear tombstone.
- **Surprising:** the `GoalProjection` doc comment states plainly that activation "is deliberately absent" — the projection reflects durable phase only. Most people would put the flag in the projection; that would make "armed" survive a restart, which is exactly the bug the harness avoids.

---

### `packages/goal/goal/src/client.ts`
- **Purpose:** the client-namespace projection of the goal domain — a one-line `export type * from './types.ts'`.
- **Key abstractions:** none beyond the re-export.
- **Data flow:** none.
- **Non-obvious design decisions:** the repo's "one-program-per-side" rule forbids client code importing the host entry. `./client` is a *projection* of the same source, so there is **zero content duplication** — the same discipline the todo and goal packages use (`packages/todo/tool-todo/src/client.ts`).
- **Edge cases & failure handling:** n/a.
- **Surprising:** a 2-line file that exists purely to satisfy an import-graph rule. Cheap, and it prevents the whole host-side dependency tree from leaking into a browser bundle.

---

### `packages/goal/goal/src/runtime.ts`
- **Purpose:** runtime constructors and protocol constants for the goal domain.
- **Key abstractions:** `GOAL_CHANGE_VERSION = 1` (`:5`), `GoalId()` brand function (`:12`), `GoalError extends HarnessError` (`:20`) with a narrowed string code type.
- **Data flow:** none — pure constructors.
- **Non-obvious design decisions:** `GOAL_CHANGE_VERSION` is embedded in the *round-zero message source* as well as in every durable change, so a future format change can be detected rather than silently mis-folded.
- **Edge cases & failure handling:** `GoalError` narrows `HarnessError`'s `string` code to `GoalErrorCode` — the comment says the constructor exists only for that type-only narrowing.
- **Surprising:** the file is named `runtime.ts` but contains no runtime behaviour — it is the *type-construction* home.

---

### `packages/goal/goal/src/fold.ts`
- **Purpose:** the pure replay fold and strict decoder for durable goal changes — the thing that makes an event-sourced goal trustworthy across a restart.
- **Key abstractions:** `GoalFoldState` (mutable accumulator), `emptyGoalFoldState()` (`:40`), `decodeGoalChange()` (`:134`), `applyGoalChange()` (`:271`), `applyGoalEvent()` (`:313`), `foldGoal()` (`:339`), `goalChangeRef()` (`:260`).
- **Data flow:** `session events → applyGoalEvent → decodeGoalChange (validate) → applyGoalChange (state machine) → GoalFoldState`.
- **Non-obvious design decisions:**
  - **Exact-field-set validation.** `decodeSnapshot` (`:88`) compares `Object.keys(value).sort().join(',')` against an *expected* list, and the expected list differs by phase: a `blocked` goal must have `blockedReason,id,maxGoalRounds,objective,phase,revision` and every other phase must have exactly five fields. A snapshot with an extra field is **rejected**, not ignored. Same for the change envelope (`:143`, `:150`).
  - **The fold re-derives the transition rules, not just the data.** `validateSnapshotTransition` (`:200`) re-checks phase legality independently of the service: `pause` requires `active → paused`, `resume` requires `{active,paused,blocked} → active` **and** `roundsStarted < maxGoalRounds`, `complete` forbids `complete → complete`, `block` requires `active → blocked`. `edit` may not change phase or blocked reason.
  - **`requireSameDefinition` (`:186`)** — only `edit` may change `objective`/`maxGoalRounds`; every other operation must preserve them.
  - **The round counter is advanced by the *message*, not by the change event.** `applyGoalEvent` (`:313`) sees a `user/message` whose source is `{kind:'goal'}` and requires `source.round === state.roundsStarted + 1` and `source.round <= maxGoalRounds`; anything else throws. So the durable count of admitted rounds is derived from what actually entered the session, and a forged or skipped round breaks replay.
  - **The blocked goal's reason must be exactly `{code, message}`** (`decodeBlockReason`, `:75`) with a lower-kebab-case code and a trimmed non-empty message.
- **Edge cases & failure handling:** a `create` is refused when the goal id was already seen (`state.seenGoalIds.has`), when the current goal is not `complete`, when the revision is not 1, or when `roundsStarted !== 0`. A `clear` resets the counters and refuses if `clearedAt < state.updatedAt`.
- **Surprising:** `decodeGoalChange` returns `undefined` for a value that is not a goal change (`kind !== 'goal/change'`) but **throws** for a value that declares itself as one and is malformed. "Not mine" and "mine but broken" are different outcomes — that distinction is what lets a shared event stream carry several domains' events.

---

### `packages/goal/goal-round-driver/src/index.ts`
- **Purpose:** the scheduler that keeps an armed, active goal turning: it queues a follow-up user message per goal round, waits for quiescence, and reserves exactly one round at a time.
- **Key abstractions:** `DriverState` (per-agent serialised state), `RoundAttempt` (a reservation: `queued|claimed|admitted` × `cancelled|stale`), `RoundIdentity` (`goalId+revision+round`), `validReservation()` (`:365`).
- **Data flow:** cordis events (`agent/status`, `goal/changed`, `agent/inbox/inserted|claimed|discarded`, `session/event`, `agent/pre-step`) → `requestDrive()` (`:224`) coalesces onto ONE `ctx.agents.withoutInitiator(...)` promise → `drive()` (`:146`) → `agent.followup(message)` → the agent's inbox claims it → `agent/pre-step` revalidates the reservation and returns `{...decision, startsRequestSeries: true}`.
- **Non-obvious design decisions:**
  - **The reservation protocol.** A round is only admitted if the *exact* content and source still match what the driver reserved: `sameQueued()` (`:62`) does a `isDeepStrictEqual` on the content **and** compares goalId/revision/round. A stale, cancelled, or shadowed reservation is rejected at `pre-step`.
  - **"Fail closed" everywhere.** If the pre-step check throws, the driver *disarms* the goal rather than proceeding (`:391`, `:435`). A driver that cannot prove it still owns the round stops the automation instead of guessing.
  - **A checkpoint before every new round** (`:150`): `await ctx.sessions.flush(agent.session)` before reserving, so the previous round's events are durable before the next one starts. If the flush fails, the goal is **disarmed** (`:156`) — a failed durability checkpoint stops the loop rather than losing history.
  - **Subagent quiescence is awaited before reserving** (`:176`): a round started while descendants are progressing would only wait for them.
  - **The round limit is enforced by the driver, not only by the tool** (`:183`): hitting `maxGoalRounds` calls `ctx.goals.block(agent, …, {code:'round-limit'})` — the goal becomes *blocked with a machine-readable reason*, not silently stopped.
  - **A host-initiated pause aborts the live turn; a model-initiated pause does not** (`:302-312`): the check is `ctx.agents.currentInitiator() !== agent`. A model pausing its own goal inside its own turn finishes normally; a human pausing mid-turn cancels it so the model cannot keep acting.
  - **`restoreOtherClaimed`** (`:135`) puts back any other messages the agent claimed alongside the rejected goal round, so a human's queued input is not stranded behind a withdrawn automation.
- **Edge cases & failure handling:**
  - `turn/end` with `reason.kind === 'max-tokens'` → disarm (`:350`). A truncated turn is not evidence the goal is finished.
  - An aborted turn marks the attempt cancelled (if it was already claimed/admitted) else disarms (`:355`).
  - A queue failure (`agent.followup` throws) clears the attempt and, if the goal is still current and armed, **blocks the goal** with `code: 'queue-failed'` (`:207`).
  - A `reject` decision from the downstream step blocks the goal with `code: 'prompt-rejected'` (`:421`).
  - `agent/error` → disarm (`:262`).
  - On plugin unload, every pending attempt is marked stale, running agents are cancelled, and all driver promises are awaited (`Promise.allSettled`) before the states map is cleared (`:466-479`).
- **Surprising:** the driver never *writes* the goal's durable state to record "round N started" — the durable round count is derived by the fold from the `user/message` source that the driver attached (see `fold.ts:313`). The driver and the projection agree by construction, not by convention.

---

### `packages/goal/goal-round-driver/src/prompt.ts`
- **Purpose:** the one model-visible prompt used for every automatic goal round.
- **Key abstractions:** `renderGoalRoundPrompt(goal, round)` (`:12`).
- **Data flow:** `GoalView` + round number → one `ContentBlock` of text → `Agent.followup()`.
- **Non-obvious design decisions:**
  - The prompt is **XML-framed** (`<goal_round>…</goal_round>`) with the objective `JSON.stringify`'d, so an objective containing newlines or quotes cannot break the frame.
  - It states the round as `Round: N/max` — the model can see its own budget.
  - It explicitly instructs: *"Treat the current workspace, tool results, and durable session state as authoritative; inspect them instead of assuming earlier narration is still current."* That is a **context-management** decision: after a compaction the model must re-read, not trust its own prior summary.
  - It names the completion protocol: *"gather evidence that the whole objective is achieved, read the current goal, and mark it complete."* The model must go back through the goal tool, not just say it's done.
  - It defers to the tool policy for blockers: *"Follow the configured goal-tool policy before reporting a blocker."*
- **Edge cases & failure handling:** n/a — one code path.
- **Surprising:** the prompt is a **constant template** with only the objective and round substituted. It does not restate the rules for edit/pause/resume; the tool description owns those.

---

### `packages/goal/command-goal/src/index.ts`
- **Purpose:** the human-facing `/goal` slash command over the persisted goal domain.
- **Key abstractions:** `parseGoalCommand()` (`:35`) → closed union `GoalCommand`; `phaseLabel()` (`:48`); `commandHint()` (`:60`); `renderGoal()` (`:78`); `executeGoalCommand()` (`:126`).
- **Data flow:** `CommandInvocation.rawInput` → parse → `ctx.goals.*` mutation → `CommandResult` text.
- **Non-obvious design decisions:**
  - **The command renders a *state-dependent hint list* of what is legal next** (`:60`): an active+armed goal offers `edit/pause/clear`; an active+disarmed goal offers `edit/resume/clear`; a complete goal offers only "create a new one". The UI never has to know the state machine.
  - **The parse is deliberately loose about objectives.** `/goal <anything not a control word>` is an objective (`:44`); only the exact control words `clear|pause|resume|edit` are reserved. `/goal` alone means "show".
  - **Attachments are injected as a separate ordinary user message** (`submitObjectiveAttachments`, `:117`) with a fixed trailing text block naming their role, so *the goal domain stores no attachment state* — a later round reads them from ordinary session history.
  - **A `GoalError` is caught and rendered as a friendly, non-specific message** (`:180`) rather than leaking internals; a non-`GoalError` is rethrown.
  - `assertNever` (`:29`) is the closed-union backstop.
- **Edge cases & failure handling:**
  - `/goal edit` with no objective → a specific `invalid-edit` error, not a silent no-op (`:38`).
  - Attachments with a non-create/edit command are rejected (`:127`).
  - `/goal clear` with no current goal → success, not an error.
  - Editing a *complete* goal creates a replacement instead of editing (`:154`).
- **Surprising:** `edit` on a complete goal **replaces** the goal, so the completed goal's history is only in the log. That is a deliberate simplification: the goal is a live pointer, not an archive.

---

### `packages/goal/tool-goal/src/authority.ts`
- **Purpose:** execution-time authority checks for the model-facing goal tools — the human-in-the-loop gate.
- **Key abstractions:** `GoalToolExecution` (`{agent, events, openTurnStartSeq}`), `GoalToolAuthority` (`{kind:'direct-human'} | {kind:'goal-round', goal}`), `goalToolExecution()` (`:48`), `requireDirectHuman()` (`:100`), `completionAuthority()` (`:111`).
- **Data flow:** tool execution → `goalToolExecution` authenticates the caller (live agent + running + is the current initiator) and snapshots the session event cut + open-turn boundary → `hasDirectHumanInput` / `isMatchingGoalRound` scan **only the events after `openTurnStartSeq`** → an authority grant or a `HarnessError`.
- **Non-obvious design decisions:**
  - **Authority is derived from the durable event log, not from a flag.** `hasDirectHumanInput` (`:80`) looks for a `user/message` with `source.kind === 'user'` inside the current open turn, and *only* on a root agent (`ctx.agents.roots().includes(execution.agent)`). A subagent's own message can never manufacture "direct human" authority.
  - **The omitted-source rule is documented in code** (`:75-78`): an `Agent.followup()`/`steer()` with no source resolves to `user`, so a *non-human producer must supply its own source* rather than inheriting human authority. The comment says this outright.
  - **Two-tier authority.** `edit`/`pause`/`resume` need `direct-human`. `complete`/`blocked` accept `direct-human` **or** `goal-round` (the exact admitted round of the current goal) — `:111`.
  - **`isMatchingGoalRound`** (`:87`) matches on `goalId`, `revision` **and** `round === goal.roundsStarted` — the round must be the *exact* current one.
  - The immutable event cut is taken once (`snapshotEvents()`), so a concurrent event cannot change the answer mid-check.
- **Edge cases & failure handling:** no agent → `GOAL_TOOL_AGENT_REQUIRED`; agent not live / not running / not the current initiator → `GOAL_TOOL_DRIVER_REQUIRED`; no open turn → `GOAL_TOOL_DRIVER_REQUIRED`; neither authority → a generic rejection.
- **Surprising:** this is the shard's cleanest **human-in-the-loop approval** implementation — approval is not a UI dialog and not a permission table. It is *"is there a human-authored message inside the current turn of a root agent, in the durable log?"* That is checkable, replayable, and forge-resistant, because the model cannot author a `user`-sourced message.

---

### `packages/goal/tool-goal/src/index.ts`
- **Purpose:** the model-facing `get_goal`, `create_goal`, `update_goal` tools plus the shared system-prompt policy section.
- **Key abstractions:** `Config.blockedAfterConsecutiveRounds` (default 3, `:47`), `GOAL_VALUE_SCHEMA` (`:74`), `guidance()` (`:115`), `goalValue()` (`:157`), `GOAL_OUTPUT` (`:175`).
- **Data flow:** tool args → authority check → `ctx.goals.*` → the canonical `GoalToolValue` JSON (the same shape for all three tools) → rendered as one text block.
- **Non-obvious design decisions:**
  - **One output schema for three tools** (`:74`, `:175`): `get_goal`, `create_goal`, `update_goal` all return the identical `GoalToolValue`, so the model never has to learn three response shapes.
  - **The tool description is a policy, not a label.** `guidance()` (`:115`) is injected into the system prompt and says: *"Mark blocked only after the same blocking condition persists for at least N consecutive goal rounds… difficulty, uncertainty, or useful remaining work is not blocked."* That sentence is the **anti-perfectionism guard** — it stops the model from declaring a goal blocked because a task is hard.
  - **The blocked threshold is enforced in code, not just in the prompt** (`:289`): `if (authority.kind === 'goal-round' && authority.goal.roundsStarted < resolved.blockedAfterConsecutiveRounds)` → `GOAL_TOOL_BLOCK_THRESHOLD`. Prompt guidance *and* a hard gate.
  - **Cross-field argument validation** — `objective`/`max_goal_rounds` are valid only with `edit`; `blocked_reason` only with `blocked`; `blocked_reason` is required with `blocked`. Each violation is a distinct `HarnessError` (`:265`, `:283`, `:296`).
  - **The model cannot resume a paused goal** (`:270`): `GOAL_TOOL_RESUME_PAUSED` — *"the model cannot resume a paused goal; the user must resume it."* Pausing is a human brake; the model can pause but not release the brake.
  - **Terminal updates defer a closing message** via `exec.deferContext(...)` (`:303`) so the model still addresses the user once before the run ends — see `wrapup.ts`.
  - **Argument-shape leniency is explicit**: `hasText()` (`:135`) and `hasRoundCap()` (`:140`) treat `''` and `0` as "absent" because strict schemas force zero/empty fillers.
- **Edge cases & failure handling:** `goalRef()` (`:145`) validates the id is non-empty/untrimmed and the revision is a positive safe integer, throwing `GOAL_TOOL_INVALID_UPDATE`. `resolveConfig()` (`:126`) re-validates the config even when `apply` is called directly outside the Loader's normalisation.
- **Surprising:** `presentCall` (`:329`) computes a `rawInput` for the UI card by a *priority chain* (blocked_reason → objective → max_goal_rounds → goal_id), so the transcript card always shows the most meaningful argument. Small, but it is the "one row shows one thing" discipline the harness applies everywhere.

---

### `packages/goal/tool-goal/src/wrapup.ts`
- **Purpose:** the model-visible wrap-up instruction injected after an autonomous goal round reports `complete` or `blocked`.
- **Key abstractions:** `renderWrapupContext(objective, blockedReason?)` (`:17`), a shared `GROUNDING` clause.
- **Data flow:** terminal goal update → `exec.deferContext(createUserMessage({content, source:{kind:'tool-goal', form:'notice', summary: boundContextSummary(...)}}))`.
- **Non-obvious design decisions:**
  - **The turn no longer hard-stops on a goal update**; instead a closing message is requested. The model still has to *address the user* — "state the outcome, summarize what was done and how it was verified, and point to the concrete results (files, commits, or other artifacts)."
  - **The grounding clause is mandatory in both variants** (`:5`): *"Report only what earlier rounds and tool results in this session actually establish; when a detail is not in the session, say so instead of inventing it."* This is a hallucination brake applied exactly at the moment the model is most likely to summarise.
  - **The blocked variant asks for the three things a blocked report needs**: what was completed, the concrete blocking condition and what was tried, and exactly what is needed from the user.
  - **It explicitly forbids more tool calls** in the closing message: *"Do not call any more tools in this run; further work waits for the user's next instruction."*
- **Edge cases & failure handling:** the blocked reason is `JSON.stringify`'d into the text (`:22`) so a multi-line reason cannot break the frame.
- **Surprising:** this is a **deferred context**, not a new turn — the closing message is *appended to the current turn*, so the transcript shows the model answering rather than the run appearing to die.

---

### `packages/skill/skill/src/index.ts`
- **Purpose:** the `ctx.skills` registry — the Service Definition of the skill capability seam. Merges provider catalogs, resolves the winning skill for a name, and hands summaries/definitions to consumers.
- **Key abstractions:** `SkillRegistry` (`:356`), `SkillProvider` (`:247`), `SkillCandidate` (`:77`), `SkillDefinition` (`:87`), `SkillSummary` (`:57`), `SkillInvocationPolicy` (`:49`), `SkillProviderObservation` (`:239`), `SkillCatalogSnapshot` (`:231`), `renderSkillContent()` (`:170`), `isModelInvocable()` / `isUserInvocable()` (`:126`, `:135`).
- **Data flow:** `registerProvider(create)` (`:390`) → provider files into the **layer of the calling context's scope** → `list`/`snapshot`/`get` (`:470`, `:481`, `:500`) → `collect()` (`:519`) → `collectFresh()` (`:551`) → per-layer `collectLayer()` (`:567`) → `listLayerCandidates()` (`:584`) → provider `list()` → merged map by name → sorted → `get()` re-loads the body from the winning candidate's `locator`.
- **Non-obvious design decisions:**
  - **Layered shadowing beats global rank.** `collectFresh` (`:551`) merges the global layer first, then the scope chain **farthest ancestor first, exact scope last**, so the nearest layer's same-name entry *replaces* the farther one outright. Rank decides duplicates only *within* one layer. This is explicitly modelled on the tools registry's shadowing rule (`:548-550`).
  - **The cache key includes the scope chain, not the scope** (`:519-523`, `:630`): a blank-session recompose re-parents an existing scope object without touching the registry, so only a **chain-bearing** key makes the next read see the new preset. Scope keys are opaque identity-compared objects, so the registry assigns them numeric ids via a `WeakMap` (`:626`).
  - **Incomplete discovery is never cached.** A provider may return `{candidates, complete:false}`; the registry marks the whole collection uncacheable and `snapshot()` reports `complete:false` (`:481-490`) so a consumer can keep its last-good catalog. A throwing provider is caught, logged, and the rest of the catalog is returned — **one broken provider cannot blank the skill list** (`:600-606`).
  - **Revision re-check with bounded retry**: `collect()` (`:519`) reads `this.revision` before the fetch; if the revision moved, it retries **once** (`MAX_COLLECT_ATTEMPTS = 2`) and then returns the result *uncached* rather than serving a torn view.
  - **A stale definition invalidates the cache and returns `undefined`** (`:500-517`): if a provider returns a definition whose `name` differs from the candidate that selected it, the entry is invalidated (only if that exact registration is still live — `:630`).
  - **The `skill` body is rendered into a fixed XML frame** by `renderSkillContent` (`:170`), shared *verbatim* by the tool result and the user-explicit invocation injection, so the model sees one canonical shape on both paths.
  - **The frame is escaped, the body is not** (`:170-190`, `:226`): the *name* is attribute-escaped, and the *resource hint* (which embeds a provider-supplied path) is text-escaped, but the skill body is embedded verbatim — "skills are trusted local content". The user's own invocation text stays outside the wrapper.
  - **Invocation policy is a two-bit matrix** (`modelInvocable`, `userInvocable`), so a skill can be model-only, user-only, both, or neither.
  - **`register()` is first-wins with a warning** (`:439-447`): a duplicate runtime skill in one layer logs and returns a **no-op disposer** so it cannot remove the winner.
  - **Provider errors are contained, never propagated** (`:601-606`): `skills/change` listeners are also individually contained (`:648-663`).
- **Edge cases & failure handling:** `waitWithAbort` (`:819`) races a provider promise against an `AbortSignal` so an uncooperative provider cannot hang the caller; `toError` (`:836`) defends against a hostile `Proxy` whose `instanceof` throws. The catalog cache is bounded (`collectCacheMaxEntries`, default 128) with oldest-first eviction (`:536-540`).
- **Surprising:**
  - `SkillSource` (`:40`) is `... | (string & {})` — an open union that still gives autocomplete. Source is *prompt-visible metadata, not precedence*.
  - `registerProvider` **throws synchronously** if the provider name is `runtime` — that name is reserved (`:404-406`).
  - The provider registration returns the **exact Cordis effect disposer**, and the docs insist composite effects yield it directly to preserve teardown ordering (`:385-389`).

---

### `packages/skill/skill-filesystem/src/index.ts`
- **Purpose:** the local-filesystem skill provider — discovery of directory-bundle and flat-Markdown skills across project, custom, and user roots, with a real filesystem watcher.
- **Key abstractions:** `FileSystemSkillProvider` (`:149`), `SkillWatchManager` (`:287`), `RootWatchMode` (`root` vs `ancestor`), `Config` (13 knobs), the rank constants (`:35-39`).
- **Data flow:** `list(options)` → `roots(cwd)` (`:244`) → `watchManager.observeRoots(roots)` → per root `discoverRoot()` (`:730`) → `listSkillRootEntries()` → per entry `parseSkillFile()` (`:804`) → frontmatter parse → `SkillCandidate`; then `get(candidate)` → `parseSkillFile` again → `SkillDefinition` with `resourceBase = {kind:'directory', path}`.
- **Non-obvious design decisions:**
  - **The rank ladder is explicit and published**: `project-dsh` 100 → `project-agents` 200 → `runtime` 250 → `custom` 300 → `user-dsh` 400 → `user-agents` 500 → `bundled` 600. The *nearest layer* wins first; rank is only the within-layer tiebreak. Bundled skills rank **lowest** so a project can always override a shipped one.
  - **The bundled root is a default root, not an always-on root** (`:203-208`): an isolated provider must see only its explicit roots, or every provider would re-discover the app's bundled skills under its own name. `DSH_BUNDLED_SKILL_DIR` is honoured only when `includeDefaultRoots` is true.
  - **Two file-reading paths**: `ctx.fs` (the sandboxed filesystem service) for untrusted roots, and raw `node:fs` for `trustedHost` roots (the bundled dir) (`:753-758`, `:812-825`). The bundled skill set is trusted; everything else goes through the sandbox.
  - **The watcher watches the *root* or an *ancestor*, whichever exists** (`:636`): if the skill root does not exist yet, `resolveRootWatchMode` walks up to the nearest existing ancestor and uses `watchFile` on the *next* path segment, so a root created later is still noticed. The mode is re-probed after opening and the watcher is replaced if the host path changed (`:439-453`).
  - **Discovery revalidates the handle independently** (`:398-406`): "A child unlink can publish an empty catalog before root unlinkDir arrives."
  - **Write-stability thresholds** (`:497-503`): `awaitWriteFinish` with `stabilityThreshold: 200ms` and `pollInterval: 100ms` — a half-written `SKILL.md` is not parsed as a broken skill.
  - **A first-party mutation short-circuits the watcher** (`:144-147`): `ctx.on('fs/observed', …)` with `mutationToolName(actor)` accepting only `edit`/`write` (`:704`). When the *agent* writes a file, the catalog is invalidated immediately instead of waiting for the OS watcher.
  - **A broken skill file is skipped, not fatal** (`:804-840`): invalid YAML, missing frontmatter, missing `name`/`description`, or an invalid name each produce a `warn` and `undefined`. The rest of the catalog still loads.
  - **Legacy frontmatter keys are rejected loudly** (`:1019`): `disableModelInvocation`, `modelInvocable`, `userInvocable` throw "use `<canonical>`" rather than being silently ignored. A skill file that uses the old key is *ignored with a warning*, not half-honoured.
  - **`disable-model-invocation` / `user-invocable` accept many boolean spellings** (`:1028-1048`): `true/1/'1'/'yes'/'on'` and the negatives; anything else is a `TypeError`.
  - **The `.system` directory is skipped only under the user-dsh root** (`skipSystem: true` at `:249`, honoured at `:676`).
  - **Project root discovery walks up to `.git`** (`:952`); if no `.git` is found the original cwd is the project root.
- **Edge cases & failure handling:**
  - Watcher failure marks the root `unhealthy`, logs, invalidates, and schedules a rewatch (`:568-588`); the next incomplete discovery retries it.
  - `dispose()` awaits every watcher's close, and `close()` **re-attaches an `error` listener** (`:539-546`): Chokidar's scheduled write-settle poll can `EPERM` a file the teardown is deleting, and an `error` emission with no listener is rethrown as an uncaught exception. This is a hard-won Windows-specific fix with the reason inline.
  - The provider's `list()` returns `{candidates, complete:false}` if the watcher failed to start (unless the provider is being disposed) so the catalog is still usable but not cached (`:174-181`).
  - Symlinks: `nodeEntryKind` (`:906`) follows them to classify directory vs file; a broken link is warned and skipped.
  - The number of watched **project roots** is bounded (`watchMaxProjects`, default 128) with oldest-first eviction (`:337-350`).
- **Surprising:**
  - There is an explicit `TODO(file-watch-service)` at `:436` — the Chokidar mechanics are meant to become a generic Cordis service, not stay skill-specific.
  - `parseFrontmatter` (`:924`) is a hand-rolled scanner rather than a YAML-document parse, so a `---` inside the body cannot be mistaken for the closing fence.

---

### `packages/skill/skill-office/src/index.ts`
- **Purpose:** registers the seven bundled Office skills (`office`, `office-docx`, `office-pptx`, `office-xlsx`, `office-render`, `office-recalculate`, `office-export-pdf`) as a `bundled`-rank provider.
- **Key abstractions:** `SKILL_NAMES` (`:13`), `parseSkill()` (`:37`), `officeRuntime()` (`:47`).
- **Data flow:** `apply()` reads each `assets/<name>/SKILL.md` synchronously, extracts the `description` for the catalog, and registers a provider whose `get()` re-reads the file and appends a **runtime path block** to the three skills that need an external binary.
- **Non-obvious design decisions:**
  - **The runtime paths are injected into the skill body at load time** (`officeRuntime`, `:47-63`), not baked into the Markdown. The body ends with a JSON blob of `{libreofficeKit: {node, cli}}` so the model has the exact absolute paths, and the block is omitted entirely when `cli === false` ("LibreOffice Kit is disabled in this deployment").
  - **A packaged app must supply a standalone Node** (`:48-51`): under Electron or SEA (`isSea()`), `process.execPath` is the app binary, not Node, so the config must point at a real Node executable — otherwise it throws rather than producing a broken command.
  - **The description is read at registration** (`:73-75`) so the catalog can be built without reading every body; the body is read lazily in `get()`.
  - `resourceBase.path` is normalised to forward slashes (`:80`).
- **Edge cases & failure handling:** a missing `SKILL.md`, a file without frontmatter, or one without a `description` throws at registration (`:37-42`) — a broken *bundled* skill is a packaging bug, not a user mistake, so it fails loudly. A non-absolute `assetRoot` throws (`:71`).
- **Surprising:** `parseSkill` here uses a *regex* frontmatter extraction while `skill-filesystem` uses a hand-rolled scanner — two frontmatter parsers in one repo, justified because this one must fail loudly where the other must skip quietly.

---

### `packages/skill/tool-skill/src/index.ts`
- **Purpose:** the model-facing `skill` loader tool plus the **durable session skill catalog** that is injected into every step.
- **Key abstractions:** `SkillCatalogSource` (`:33`), `apply()` (`:78`), `digestCatalogEntries()` (`:330`), `catalogHistory()` (`:363`), `readCatalogEntries()` (`:350`), `invokedSkillNames()` (`:420`), `SKILL_GESTURE` (`:411`).
- **Data flow:** every `agent/pre-step` → (a) the **user-explicit invocation** listener (`:179`) scans claimed user messages for a `/name` token, loads the skill, and appends a `skill-invocation`-sourced instructions message; (b) the **catalog** listener (`:215`) takes a `skills.snapshot()`, filters to `isModelInvocable`, digests the entries, and inserts/replaces a `skill-catalog`-sourced catalog message in the step.
- **Non-obvious design decisions:**
  - **The catalog is a durable session artifact, not a system-prompt string.** Its `source` (`kind:'skill-catalog', form:'catalog', entries`) records the exact entries published, so a consumer presenting the list reads metadata instead of re-parsing the `<available_skills>` block (`:33-43`).
  - **The digest is over the entries, not the rendered prose** (`:330`): the JSON of `[name, description]` per entry, SHA-256. "The entries are what changes; the surrounding `<system-reminder>` framing is written for the model and must not decide whether a republish is needed." JSON-per-entry rather than a separator, because *"every separator is itself a legal description character, so only quoting makes the boundary exact."*
  - **An unchanged catalog is *removed* from the step, not re-sent** (`:230-234`): if the visible digest matches, the existing catalog message is filtered out of `decision.messages` — the model does not re-read the same catalog every turn, and the durable message stays in the session for the transcript.
  - **A changed catalog is a *replacement*, published in place** (`:237-251`): the existing catalog message is replaced with a `renderCatalogUpdate` message that says "This complete catalog replaces every earlier available-skills list in this session", and adds "Use only names in this replacement catalog." When the catalog becomes empty, the update explicitly says *"Do not use names from earlier skill catalogs."* — a **stale-name guard**.
  - **The tool's visibility is matched to the catalog's visibility** (`:226`): `ctx.tools.get(skillTool.name, agent) === skillTool` — exact *definition* identity, so a scoped plugin that merely happens to be named `skill` does not inherit this catalog, and a plugin mounted inside an agent preset does not leak a catalog to unscoped lookups (`:211-215`).
  - **Incomplete discovery suppresses the catalog entirely** (`:227`): `if (!snapshot.complete) return decision` — the model keeps the previous catalog rather than seeing a partial one.
  - **The `/name` gesture is a closed grammar** (`:411`): `/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g` — a second `/` or any non-boundary character breaks the match, keeping `/usr/bin` and `5/8` out. Only `source.kind === 'user'` messages are scanned (`:421`) — external text cannot forge the gesture.
  - **The gesture is a *lookup*, not a claim** (`:189-197`): an unknown name or a non-user-invocable skill stays plain prose; the check sits on the loaded definition.
  - **Registration order is load-bearing** (`:165-177`): this listener registers before the catalog listener, so the "waterfall" hands it the catalog-bearing message list to extend. Material the model must act on lands last, closest to the answer.
- **Edge cases & failure handling:**
  - The tool re-checks `isModelInvocable` on **both** the summary and the loaded definition (`:143-150`) — the policy is enforced at the boundary and again at the payload.
  - `readCatalogEntries` (`:350`) treats an unreadable record as "not this plugin's catalog" rather than throwing inside a step listener, because a resumed/forked/externally-written seed only guarantees a source with a non-empty `kind`. Throwing would fail **every subsequent turn of that session**.
  - `catalogHistory` (`:363`) walks the session backwards from `agent.session.seq`; a missing event below the current length throws a specific error rather than guessing.
- **Surprising:**
  - `catalogDescription` (`:393`) normalises whitespace and truncates to `maxLength` with an ellipsis — the catalog shows a *summary*, and the full description is only available after loading the skill. That is deliberate prompt-size discipline.
  - The catalog message is a **`user`-role message** (created via `createUserMessage`) so it is part of ordinary session history — and it is *removed from the step* when unchanged, so it does not accumulate in the live prompt while remaining durable in the transcript.

---

### `packages/skill/tool-workspace-dependencies/src/index.ts`
- **Purpose:** a read-only model-facing query for the bundled Python/Node/pnpm payload, either used in place or installed under the Harness home.
- **Key abstractions:** `PrimaryRuntimeManifest` (`:38`), `WorkspaceDependencies` (`:50`), `parsePrimaryRuntime()` (`:82`), `readPrimaryRuntime()` (`:130`), `primaryRuntimePythonAliases()` (`:142`), `copyPrimaryRuntime()` (`:170`), `workspaceDependencyPaths()` (`:183`), `resolvePrimaryRuntime()` (`:234`), `installPrimaryRuntime()` (`:248`).
- **Data flow:** `runtime.json` → `parsePrimaryRuntime` (validate + normalise) → `workspaceDependencyPaths` (absolute paths) → `validatePayloadEntries` (stat every path) → the tool result.
- **Non-obvious design decisions:**
  - **The manifest parser normalises a legacy format in place** (`:82-127`): the old `components: {python, node, pnpm}` shape is read and flattened, and the legacy per-package `numpy`/`pandas` fields are cross-checked against the distribution map — a conflict throws "conflicting numpy distribution version". One reader, two on-disk shapes.
  - **Distribution names are normalised to lowercase-dash** (`:117`) and duplicates after normalisation throw, so `Foo.Bar` and `foo-bar` cannot both appear.
  - **The install is atomic-ish with a rollback** (`:248-282`): copy into a `mkdtemp` staging dir, rename the live root to `<root>.previous`, rename staging into place, and on failure **rename the previous tree back**. The previous tree is only removed after the new one is in place.
  - **An unchanged payload short-circuits the whole copy** (`:260`): the existing `runtime.json` is compared by `JSON.stringify` equality with the new manifest; if identical, the installed root is reused.
  - **Python symlink aliases are preserved as *relative* links** (`:142-168`): `python`/`python3` in `dependencies/python/bin` must point directly at the versioned regular file, and only those two are kept as links; everything else is materialised with `dereference: true`.
  - **The tool never mutates the environment**: "This does not change PATH or package-manager settings" (in the tool description) — the model gets *paths*, and must use them explicitly.
  - **A failed preparation is retried** (`:296-301`): the memoised promise is cleared on rejection so the next call tries again.
- **Edge cases & failure handling:** platform/arch mismatch throws "incompatible platform or architecture" (`:224`); an install path that is itself a symlink is refused (`:213`); `validatePayloadEntries` stats every declared path and throws if a file is missing or a directory is not a directory.
- **Surprising:** the tool's *description* is the entire contract with the model and it is unusually long and specific ("Python includes numpy, pandas, python-docx, python-pptx, openpyxl, Pillow, lxml, and XlsxWriter… run pnpm with that Node executable and pnpm script path"). The description is where the policy lives, not in prose elsewhere.

---

### `packages/spill/spill/src/index.ts`
- **Purpose:** the Service Definition of the spill-storage seam (`ctx.spillStore`): *what* a spill backend does, not *how*.
- **Key abstractions:** `SpillStore` (abstract, `:45`), `SaveTextSpill` / `SpillRef` / `SpillOwner` / `SpillSource` / `SpillLocator` (re-exported from `types.ts`).
- **Data flow:** a caller → `saveText(input)` → `{locator, bytes, retrievalHint}`.
- **Non-obvious design decisions:**
  - **The seam has exactly one method.** The comment at `:29-42` is explicit: the Service Definition owns **NO** retention policy, **NO** tool-result replacement, and **NO** retrieval/search API. Those belong to sibling packages (`dsh-output-retention`, `dsh-spill-policy`). A second method would have pulled policy into the abstraction.
  - **The contract is written as the semantics an implementation *must* honour** (`:33-42`): persist the FULL content verbatim; scope storage by `owner.sessionId`; choose a private, collision-free name **derived from — never equal to — the caller's `suggestedName`**; and **reject** on a real storage failure, leaving the caller to decide how to degrade.
  - **The retrieval guidance is backend-supplied** — a local backend says "use read with offset/limit, or grep this path"; a remote backend would say something else. The consumer renders `ref.retrievalHint` and never parses `ref.locator`.
- **Edge cases & failure handling:** the abstract method is documented to reject on permissions/ENOSPC/backend-unavailable; the spill policy treats a rejection as best-effort and keeps the inline result.
- **Surprising:** the class extends cordis `Service` with `super(ctx, 'spillStore')`, so **loading a second implementation throws** — cordis' standard duplicate-service behaviour. One spill backend per context, by construction.

---

### `packages/spill/spill/src/types.ts`
- **Purpose:** the pure vocabulary of the spill seam.
- **Key abstractions:** `SpillLocator` (branded, `:18`), `SpillLocator()` brand fn (`:26`), `SpillOwner` (`:37`), `SpillSource` (`:46`), `SaveTextSpill` (`:63`), `SpillRef` (`:76`).
- **Data flow:** types only.
- **Non-obvious design decisions:**
  - **`SpillSource` is a two-arm union**: `{kind:'tool', toolName, callId, label}` and `{kind:'session-reference', sessionId, label}`. The second arm exists because a *session reference* (a captured conversation) is also spillable — not just a tool result.
  - **"Descriptive source description only, never access control"** (`:44-45`): `label` is a human label, and the docs are careful that it is not a security boundary. The actual boundary is the *owner session id* and the private directory mode.
  - **Fork semantics are spelled out** (`:37-42`): forked sessions inherit locators already present in the seeded log; those artifacts are **not copied or re-owned**, and spills produced after the fork use the child session id.
  - **`suggestedName` is explicitly a hint, never a path** (`:66-68`).
- **Edge cases & failure handling:** n/a (types).
- **Surprising:** the branded `SpillLocator` exists precisely so that a consumer *cannot* accidentally treat the locator as a plain string and start parsing it.

---

### `packages/spill/spill-local/src/index.ts`
- **Purpose:** the host-filesystem implementation of the spill seam, with a one-shot startup cleanup sweep.
- **Key abstractions:** `LocalSpillStore` (`:65`), `Config` (`:31`), `gatherRoots()` (`:131`, protected — a test seam), `defaultRootsBase()` (`:145`, protected — a test seam).
- **Data flow:** `saveText(input)` → `saveTextFile({root, sessionId, suggestedName, content})` → `{locator: SpillLocator(saved.path), bytes, retrievalHint}`.
- **Non-obvious design decisions:**
  - **The default root is a lazily-created private per-process directory** (`:29-40` in `store.ts`): `mkdtempSync(join(tmpdir(), 'dsh-spill-'))` with mode 0700. A per-process root means a crashed process leaves exactly one directory behind — and the startup sweep finds and reclaims it.
  - **The cleanup sweep is launched but NOT awaited at activation** (`:95-100`): the generator body starts the sweep and yields an async disposer that awaits *the same promise*. Service availability is never delayed, yet a fiber unload reaches quiescence — no sweep I/O outlives the fiber. The comment says exactly this.
  - **The sweep's root set is overridable in tests but is "not a deployment knob"** (`:122-145`): `gatherRoots` and `defaultRootsBase` are `protected` so a test can inject an isolated root set and hold the sweep open across a disposal.
  - **Cleanup is retention, not purging** (`:38-46`): "a resumed or forked session may still reference an older locator until it ages out."
- **Edge cases & failure handling:** `cleanupPeriodDays: 0` disables cleanup entirely (the disposer becomes a no-op). The sweep **never rejects** — every filesystem failure is contained inside `sweepSpillRoots`, so awaiting it during activation/disposal is safe.
- **Surprising:** the spill file's own name embeds a **6-byte random prefix** *plus* the sanitized suggested name (`<hex12>-<encoded>`), so two spills of the same tool in the same session never collide and a caller cannot predict a path.

---

### `packages/spill/spill-local/src/store.ts`
- **Purpose:** cordis-free storage mechanics — private root selection, safe-name derivation, traversal protection, and the exclusive owner-only write.
- **Key abstractions:** `encodeSegment()` (`:55`), `sessionDir()` (`:78`), `saveTextFile()` (`:108`), `privateRoot()` (`:36`), `isErrno()` (`:25`).
- **Data flow:** `SaveTextOptions` → `sessionDir(root, sessionId)` → `join(dir, randomBytes(6).hex + '-' + encodeSegment(suggestedName))` → `mkdir(dir, {recursive, mode:0o700})` → `open(path, 'wx', 0o600)` → `writeFile` → `close` → `{path, bytes}`.
- **Non-obvious design decisions:**
  - **`encodeSegment` is injective over ALL JS strings** (`:49-73`): each code unit is kept literal (`[A-Za-z0-9._-]`, minus `~`) or escaped as `~XXXX`; `~` is itself escaped, so the mapping is reversible and **distinct inputs never collide**. `.` and `..` become `~002E` and `~002E~002E` so they can never traverse. Empty string → `~`.
  - **`sessionDir` hashes the session id** (`:78`): `sha256(sessionId).slice(0,12)` → `session-<12 hex>`. The session id never appears on disk, and the directory name is a fixed shape the sweeper can recognise exactly.
  - **The write is exclusive and owner-only** (`:117`): `open(path, 'wx', 0o600)` — `wx` fails if the path exists, so a random-name collision can never silently overwrite; the retry loop handles only `ENOENT` (the directory was pruned underneath) and rethrows everything else.
  - **The directory is created 0700 on every attempt** (`:115`), so the mode is re-asserted even if a previous directory had looser permissions.
  - **The bytes count is UTF-8, not UTF-16** (`:131`): `Buffer.byteLength(content, 'utf8')`.
- **Edge cases & failure handling:** the `for(;;)` loop around `mkdir`+`open` retries on `ENOENT` (a concurrent prune removed the directory) and rethrows every other error. `handle.close()` is in a `finally`, so a failed write still closes the descriptor.
- **Surprising:** the file name is `<12 hex>-<encoded suggested name>`, so a human reading the directory can still see what the file was, while the name is unguessable and traversal-proof.

---

### `packages/spill/spill-local/src/cleanup.ts`
- **Purpose:** startup cleanup mechanics for local spill roots — a security-conscious, best-effort, never-throwing sweeper.
- **Key abstractions:** `sweepSpillRoots()` (`:274`), `gatherSweepRoots()` (`:418`), `discoverDefaultRoots()` (`:404`), `SweepRoot` (`:159`), `SweepOptions` (`:173`), `WarnFn` (`:34`).
- **Data flow:** `gatherSweepRoots(activeRoot, warn, base)` → discovered prior-default roots + the active root → `sweepSpillRoots({roots, cutoffMs, warn})` → per root: `readdir` → per `session-*` entry: `lstat` (never follow a symlink) → `sweepSessionDir` → `rmdir` the empty session dir → optionally `rmdir` the root.
- **Non-obvious design decisions:**
  - **Name matching is EXACT-shape, not prefix** (`:15`, `:23`): `^dsh-spill-[A-Za-z0-9]{6}$` (the exact `mkdtemp` shape) and `^session-[0-9a-f]{12}$`. An unrelated `dsh-spill-test-*` fixture or a `session-backup` directory is **never** swept. This is the difference between a cleanup job and a data-loss bug.
  - **A root another local user could replace is refused** (`:47-56`, `:108-157`): `isTrustedDirectory` requires the directory to be owned by the current user and not group/other-writable; `hasProtectedAncestors` (`:72`) additionally requires that no ancestor allows another user to replace the child (a *sticky* writable ancestor is safe because the child is owned by the current user).
  - **Symlinks are never followed** (`:225-272`): the session entry is `lstat`ed first and a symlinked `session-*` is skipped; inside a session directory, a symlink or any non-regular entry is left untouched because `lstat` never follows a link. A planted symlink can neither be deleted nor redirect the age check.
  - **Only regular files expire** (`:262`): sockets, fifos, and nested directories are skipped.
  - **The active root is never pruned; only *discovered prior-default* roots are** (`:336-338`, `:346-353`): a per-process default root would otherwise accumulate one empty directory per past process forever, and every future startup would rescan them. `gatherSweepRoots` de-duplicates by **filesystem identity** (dev+ino on POSIX, lower-cased path on Windows) and the active root's identity overrides a discovered match so the live target is never marked prunable (`:428-433`).
  - **The warning sink can never break cleanup** (`:37-45`): `warnSafely` catches a throwing logger.
  - **Deletion is idempotent** (`:196-219`): `unlinkIdempotent` treats `ENOENT` as success — another process may have removed the file between the scan and the unlink, and the goal ("file gone") already holds.
  - **An empty root is only pruned if nothing un-swept remains** (`:330-334`): an unrelated sibling entry blocks the prune, so the sweeper never removes a directory that still holds foreign files.
- **Edge cases & failure handling:** every `readdir`/`lstat`/`rmdir` failure is contained and reported through `warn`; the sweep never rejects. `rmdir` failures of `ENOTEMPTY`/`ENOENT` are silent (they mean a concurrent writer added a file, or the dir was already gone).
- **Surprising:** `cleanup.ts` contains **more security reasoning than most of the harness**. The whole file is about one thing: *a background janitor must not be able to delete a stranger's data or be redirected by a stranger's symlink.*

---

### `packages/spill/spill-policy/src/index.ts`
- **Purpose:** the token-budgeted post-execute policy — truncate an oversized tool result inline, keep a recoverable copy, and tell the model where the full thing lives.
- **Key abstractions:** `Config.maxInlineTokens` (`:25`), `retainable()` (`:37`), `bound()` (`:91`), `pricing()` (`:57`), `fullText()` (`:78`), the `GAP` marker (`:41`).
- **Data flow:** `tools/post-execute` (`:133`) and `tools/ptc-dispatch-log` (`:152`) → `bound()` → estimate tokens → if over budget: write the full text to the spill store → compute the notice → `retainContent()` keeps head+tail → the model sees `[head] ... [tail] + notice`.
- **Non-obvious design decisions:**
  - **The notice is reserved OUT of the budget before the content is retained** (`:118-122`): `reserved = price(GAP) + price(worstNotice)`, and the content budget is `maxTokens - reserved`. The model can never be told "the rest is at <path>" *and* be over budget because of it.
  - **A notice that would itself exceed the cap throws** (`:120`): "spill notice for X exceeds maxInlineTokens". A pathological cap fails loudly instead of producing a result the model cannot parse.
  - **Every failure keeps the inline content** (`:129-132`): the whole `bound()` body is wrapped, and any error logs `spill-policy: … ; keeping the inline content` and returns `undefined`. **A missing spill backend degrades to "no truncation", never to "lost output".**
  - **Images are priced, not estimated** (`:57-76`): the model-route's `imageRequestPricing` gives the visual tokens and the descriptor-text tokens. If the model has no image calculator, the policy **throws** and keeps the content inline.
  - **The `read` tool is exempt** (`:135`): `exec.name === 'read'` is never truncated — a read's own offset/limit mechanism is the model's way to page through a large file, and truncating it would break that contract.
  - **Text-only PTC bindings keep their own async log-only spill path** (`:140`): `if (exec.parent !== undefined && !hasImages) return decision`.
  - **Adjacent text blocks are merged** (`:124-128`): one framing cost on the wire *and* in the spill preview.
  - **The image placeholder is a path the model can act on** (`:78-88`): `\n[Image: "<readonlyPath>"; <mediaType>; WxH. Use read_image to view it.]\n` — the image is not dropped, it is *relocated* to a readable path.
- **Edge cases & failure handling:** non-text/non-image blocks make the content non-retainable and skip the policy entirely (`:37-39`). The owner session id is required; without it the policy throws and keeps the inline content (`:98`).
- **Surprising:** `ctx.on('tools/post-execute', …, { prepend: true })` — the policy runs *before* other post-execute listeners, so a later listener sees the already-truncated content. The order is part of the contract.

---

### `packages/spill/spill-policy/src/notice.ts`
- **Purpose:** browser-safe formatting and *recognition* of persisted spill-policy notices.
- **Key abstractions:** `formatSpillNotice()` (`:21`), `hasSpillNotice()` (`:45`), `isOmission()` (`:26`).
- **Data flow:** `Omitted` + `SpillRef` → one notice string; and the reverse — a persisted text result → "does this end with a spill notice?"
- **Non-obvious design decisions:**
  - **The omission phrase is imported, not re-spelled** (`:2`, `:10-12`): `describeOmitted` from `dsh-output-retention` is the ONE source of the wording, and the count offset/suffix are *derived* from it (`EXACT_OMISSION.indexOf('0')`). If the shared phrase ever changes, the recogniser follows automatically.
  - **The recogniser is text-convention-based, not authenticated** (`:41-43`): the doc says "This identifies the text convention, not authenticated tool-output origin." Deliberate honesty about what a string match can prove.
  - **The notice format is stable enough to re-parse**: `(omission. Full formatted result stored at: <locator>. <hint>)`, with a `\n\n` separator before it.
- **Edge cases & failure handling:** `hasSpillNotice` handles notice-only output (a result that is *only* the notice), tolerates the `Omitted N images.` suffix, and requires the trailing `)` to be present.
- **Surprising:** the notice is written in a **parenthesised, prose-like** form rather than a structured marker, so it survives a tool result that is rendered as plain text in a transcript — and it can still be recognised afterwards by a renderer that wants to show a "recoverable" badge.

---

### `packages/spill/spill-policy/src/retention.ts`
- **Purpose:** ordered head/tail retention of text and indivisible images under a token budget.
- **Key abstractions:** `RetainableBlock` (`:5`), `RetainedContent` (`:8`), `retainContent()` (`:48`), `fitText()` (`:27`), `textSlice()` (`:16`).
- **Data flow:** ordered blocks + budget + a `price(block)` function → `{head, tail, omittedBytes, omittedImages}`.
- **Non-obvious design decisions:**
  - **Head AND tail are kept, not just the head** (`:64-93`): each end gets half the budget. A truncated tool result usually ends with the conclusion ("the error was: …"), so keeping the tail preserves the most useful part.
  - **The two halves do not overlap** (`:80-83`): when the head and tail would land in the same text block, the tail is sliced past the head's characters (`original.text.slice(headCharacters)`).
  - **Images are indivisible** (`:69-76`, `:86-91`): an image that does not fit is skipped and its space is *left unused* rather than half-emitted. A half-image is meaningless.
  - **UTF-16 surrogate pairs are never split** (`:16-25`): `textSlice` adjusts the cut by one if it would land between a high and low surrogate.
  - **The text fit is a binary search** (`:27-38`) over a *monotonic* price function, not a linear scan — O(log n) token estimates instead of O(n).
  - **Omitted bytes are exact** (`:97`): `bytes(content) - bytes(head) - bytes(tail)` — UTF-8 byte counts, so the notice can say precisely how much was dropped.
- **Edge cases & failure handling:** a budget of 0 yields empty head and tail; the caller then emits only the footer notice (see `index.ts:123`).
- **Surprising:** the "unused space at an indivisible image stays unused" rule means the retained content can be **smaller** than the budget — the policy never pads, and never lies about how much it kept.

---

### `packages/spill/spill-policy/src/types.ts`
- **Purpose:** the minimal structural view of a tool execution that the policy needs to find the owning session.
- **Key abstractions:** `SpillPolicyExec` (`:16`).
- **Data flow:** types only.
- **Non-obvious design decisions:** the policy **does not import `dsh-tools` or `dsh-agent`** — it declares the shape it needs structurally, and `ToolExecution` satisfies it. That keeps the policy package free of the tools/agent dependency tree (the file comment says so at `:3-9`).
- **Edge cases & failure handling:** only the session **header id** is read — "the same identity every other subsystem keys off".
- **Surprising:** this is a 20-line file whose whole job is to *avoid* a dependency. A structural type instead of an import.

---

### `packages/todo/tool-todo/src/index.ts`
- **Purpose:** the model-facing `todo_write` tool — a whole-list task tracker stored as a session projection.
- **Key abstractions:** `Config.allowParallelInProgress` (`:32`), `describe()` (`:63`), `toTodoList()` (`:80`), the `todos` projection (`:123`), `todo_write` tool (`:135`).
- **Data flow:** model args → `toTodoList` (validate) → `exec.agent.session.append('todo/write', {todos})` → the `todos` projection folds it → the tool returns `{todos, counts}`.
- **Non-obvious design decisions:**
  - **Whole-list replacement, not a diff** (`:117`, `:137-140`): *"The COMPLETE task list, replacing any previous list."* The `todos` projection folds `todo/write` by **last-write-wins** and the whole value is the state. There is no add/remove operation, so there is no merge conflict to resolve.
  - **The list is cleared by the next turn, but `turn/end` keeps it visible** (`:127-130`): `if (event.type === 'turn/start') return null`. The finished checklist survives the turn it belongs to, and disappears when the next turn starts — the list is *standing-plan UI state*, not history.
  - **The "one in_progress" rule is a deployment choice, not a hard-coded rule** (`:32-43`, `:63-71`): `allowParallelInProgress` changes *only the one clause of the tool description* ("keep exactly one todo `in_progress`" vs "several only when work runs in parallel"). The code path is identical; the *policy text* is what changes. When `allowParallel` is false, a call with two `in_progress` items is **rejected** (`:105-107`).
  - **The status enum is enforced by the schema, and the extra shape checks live in code** (`:77-79`): the registry has already rejected unknown item keys (`additionalProperties: false`), so the code only checks what the schema cannot — non-empty trimmed content, uniqueness of content, and the parallel rule.
  - **Duplicate content is rejected** (`:96-98`): "invalid todos: duplicate content". A task list with two identical lines is a model mistake, not a display choice.
  - **A non-agent caller is rejected, not no-op'd** (`:147-150`): "todo_write requires an owning agent session" — the list is per-agent-session state, and there is nowhere to write it.
  - **The tool's output carries counts** (`:163-172`): `{todos, counts:{pending, inProgress, completed}}` — a UI can render a progress bar without re-counting, and the model gets a summary of its own state.
  - **The render is one line of prose** (`:170-172`): "Updated todo list: 2 pending, 1 in progress, 3 completed." — the model's transcript shows a human sentence, not a JSON dump.
- **Edge cases & failure handling:** empty content is rejected; `content` is trimmed before it is stored, so the canonical list is what the model believes it wrote; an empty `todos` array is legal (it clears the list).
- **Surprising:** `stateVersion: 2` on the projection (`:131`) — the fold has already been changed once, and the version records it.

---

### `packages/todo/tool-todo/src/types.ts`
- **Purpose:** the pure type outlet of the todo domain and the ONE home of the `todos` projection-key declaration.
- **Key abstractions:** `TodoItem` (`:16`), the `todo/write` session event (`:30`), the `todos` projection map entries (`:36-46`).
- **Data flow:** types only.
- **Non-obvious design decisions:**
  - **`TodoItem` is deliberately minimal**: `{content, status}` — "No id, priority, or `activeForm`". The doc comment explains why: the list is replaced wholesale, so entries need no stable identity. That is a *design decision forced by the write model*, and the comment makes the coupling explicit.
  - **The comment says "log-only UI state; never derived history"** (`:31`): the `todo/write` event is explicitly *not* a source of truth about what happened — it is a snapshot of the plan.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the two-namespace projection (`./types` for host, `./client` for browser aggregates) with **zero content duplication** is repeated here exactly as in the goal package — a repo-wide packaging discipline, not a one-off.

---

### `packages/todo/tool-todo/src/client.ts`
- **Purpose:** the client-namespace projection of the todo domain — a one-line `export type * from './types.ts'`.
- **Key abstractions:** none beyond the re-export.
- **Data flow:** none.
- **Non-obvious design decisions:** identical discipline to `packages/goal/goal/src/client.ts` — the same single source projected to a browser-safe namespace.
- **Edge cases & failure handling:** n/a.
- **Surprising:** two packages, two identical 3-line files. The consistency is the point.

---

### Tier 2 — bulk: a compact table, one row per file

#### Package-group and package READMEs (`docs`)

| File | What it is / what it decides |
| --- | --- |
| `packages/goal/README.md` | Group map: the goal family is *state, not scheduling* — "Each session has only one current goal, and that goal records completion state rather than scheduling work; automatic continuation must therefore be enabled separately." Tables the four packages and their `ctx` keys. |
| `packages/goal/README.zh.md` | Chinese counterpart of the above; same structure, same decisions. The repo ships every README as a *pair* and checks the pairing with a hash record. |
| `packages/goal/goal/README.md` | The goal service contract. Decides: one current goal per session; a 256-round default cap; compare-and-set `{id, revision}` mutations; a blocked goal keeps a stable lower-kebab-case code + free message; **"Automatic continuation is the exception: an active goal is disarmed after any session-start edge."** Lists the honest limits: "Trusted in-process producers — a plugin with direct `Session` access can append counterfeit `goal/change` data… this is integrity detection, not plugin isolation." |
| `packages/goal/goal/README.zh.md` | Chinese counterpart; the same decisions restated. |
| `packages/goal/tool-goal/README.md` | The three model tools and their authority rules. Decides: `create/edit/pause/resume` need a direct human turn in a *runtime-root* agent; `complete/blocked` also accept the exact current goal round; `resume` of a durable paused goal is rejected (`GOAL_TOOL_RESUME_PAUSED`); the blocked threshold (default 3) is both the hard floor and the number in the prompt. |
| `packages/goal/tool-goal/README.zh.md` | Chinese counterpart; embeds the same literal English goal-policy markdown block the code injects. |
| `packages/goal/command-goal/README.md` | The human `/goal` command. Decides: control words are recognized only when they fill the whole input ("`/goal pause after verification` creates that literal objective"); a `GoalError` becomes a *stable* direct command error while an unexpected failure rethrows so the adapter can report a command failure; attachments ride one ordinary user message so the goal domain stores no attachment state. |
| `packages/goal/command-goal/README.zh.md` | Chinese counterpart. |
| `packages/goal/goal-round-driver/README.md` | The continuation driver. Decides: only an *admitted* goal message consumes the round allowance (a human message or a stale reservation does not); a host pause aborts the running turn but a model pause inside its own turn finishes; the round cap ends in a blocker with code `round-limit`; **"Cancellation never auto-restarts a round"**; after resume/fork the driver never revives work on its own. Lists the honest limits: no independent evaluator, same-session only, no abnormal auto-retry, round cap ≠ resource budget. |
| `packages/goal/goal-round-driver/README.zh.md` | Chinese counterpart. |
| `packages/skill/README.md` | Group map: "Different sources produce the same model-visible format, and model access requires at least one source." Tables the five skill packages. |
| `packages/skill/README.zh.md` | Chinese counterpart. |
| `packages/skill/skill/README.md` | The registry contract. Decides: providers own *where* skills come from, the registry owns merging/winning/validation; the invocation policy is a 2-bit matrix (model × user) so one discovery result serves both surfaces; a provider that fails is logged and skipped and the observation is marked incomplete; **the registry has no TTL — invalidation is provider-driven**. |
| `packages/skill/skill/README.zh.md` | Chinese counterpart. |
| `packages/skill/skill-filesystem/README.md` | The local provider. Decides: a skill is `<name>/SKILL.md` or `<name>.md`, one level deep only; the rank table (project-dsh 100 → project-agents 200 → custom 300 → user-dsh 400 → user-agents 500 → bundled 600); the boolean grammar for `disable-model-invocation`/`user-invocable`; **catalog and body have separate lifecycles** ("every load re-reads the current file, so editing a skill body needs no versioning or cache invalidation"); a malformed skill disappears with a warning, so "the model catalog receives no per-skill diagnostic". |
| `packages/skill/skill-filesystem/README.zh.md` | Chinese counterpart. |
| `packages/skill/tool-skill/README.md` | The model-facing catalog + loader. Decides: the catalog is a *durable projection diffed by a digest over the entries*, not over the rendered prose; an unchanged catalog is removed from the step rather than resent; an emptied catalog is a *replacement* that explicitly retires older names; the `/name` gesture is the only entry point for `disable-model-invocation` skills. Publishes the exact catalog and `<skill_content>` templates the model sees. |
| `packages/skill/tool-skill/README.zh.md` | Chinese counterpart. |
| `packages/skill/skill-office/README.md` | The bundled Office skills. Decides: *progressive loading* — the host never injects instructions by file extension; appearance changes require rendering even without an explicit visual-check request, and an explicit "skip rendering" wins; a blank preview ends visual checks for the task and the reply must contain exactly one visual-status sentence. Publishes a mermaid routing flowchart. |
| `packages/skill/skill-office/README.zh.md` | Chinese counterpart (the mermaid diagram is kept in English). |
| `packages/skill/tool-workspace-dependencies/README.md` | The `load_workspace_dependencies` tool. Decides: the tool returns *paths*, never mutates `PATH` or the package manager; the payload is used in place on read-only carriers and copied under the Harness home on Desktop; legacy `components` manifests are normalized in memory; a manifest whose platform/arch differs is rejected. |
| `packages/skill/tool-workspace-dependencies/README.zh.md` | Chinese counterpart. |
| `packages/spill/README.md` | Group map: the family is storage service + local backend + tool-result policy, and tool-result spilling is *opt-in* through `maxInlineTokens` and "keeps the original result on storage failure". |
| `packages/spill/README.zh.md` | Chinese counterpart. |
| `packages/spill/spill/README.md` | The seam. Decides: **one method** (`saveText`) and nothing else; the seam owns no retention, no replacement, no retrieval; "Reject, never silently degrade at the seam — the caller owns degradation"; storage is not access control. |
| `packages/spill/spill/README.zh.md` | Chinese counterpart. |
| `packages/spill/spill-local/README.md` | The local backend. Decides: files land at `<root>/session-<hash>/<random>-<safeName>`; the *startup* sweep deletes only strictly-older regular files, prunes empty session dirs, and removes only *discovered prior-default* roots; on POSIX it admits only current-user-owned, non-group-writable, ancestor-protected directories. |
| `packages/spill/spill-local/README.zh.md` | Chinese counterpart. |
| `packages/spill/spill-policy/README.md` | The retention policy. Decides: text and images share one estimated-token budget; head *and* tail are kept, each half the remaining budget; images are retained or omitted whole; the notice is reserved out of the budget *before* the content is retained; a notice that cannot fit disables the replacement for that call; every failure keeps the original content. |
| `packages/spill/spill-policy/README.zh.md` | Chinese counterpart. |
| `packages/todo/README.md` | Group map: "the list belongs to the agent session that created it, and each update replaces the whole list"; the group ships no UI. |
| `packages/todo/README.zh.md` | Chinese counterpart. |
| `packages/todo/tool-todo/README.md` | The `todo_write` tool. Decides: whole-list replacement over the event-sourced session log; `allowParallelInProgress` is a *required* deployment choice because the tool cannot observe runtime concurrency; the item shape is deliberately minimal (`content` + three-state `status`); validation keeps "the durable snapshot equal to what the model believes it wrote". Notes the Loader export-shape hazard (a stray `export default` drops `inject`). |
| `packages/todo/tool-todo/README.zh.md` | Chinese counterpart. |

#### Bundled Office skill assets (`docs`)

| File | What it is / what it pins |
| --- | --- |
| `packages/skill/skill-office/assets/office/SKILL.md` | The router. Decides which sub-skill to load, when rendering is required, and "Do not reload skills." |
| `packages/skill/skill-office/assets/office-docx/SKILL.md` | Word workflow. Pins: use `python-docx`, never install packages; do not assign `paragraph.text` (it destroys run formatting); a title may be an ordinary paragraph; CJK needs an explicit `w:eastAsia` font; when writing OOXML directly, create a new ZIP and copy each member once (appending duplicates the name and corrupts the package); reopen the saved file to verify before delivering. |
| `packages/skill/skill-office/assets/office-pptx/SKILL.md` | PowerPoint workflow. Pins: paragraph alignment does not move a text box (center both); a native chart's embedded workbook is part of the deliverable; rebuilding slides can discard animation/SmartArt; library support is not a rendering engine. |
| `packages/skill/skill-office/assets/office-xlsx/SKILL.md` | Excel workflow. Pins: a DataFrame is not the workbook (exporting over it loses sheets/formulas/charts); `data_only=False` to keep formulas; **writing a formula does not calculate it** and `data_only=True` may return absent/stale caches; do not rename `.xls`/`.xlsb`/encrypted/macro files to `.xlsx`. |
| `packages/skill/skill-office/assets/office-render/SKILL.md` | Render/inspect. Pins: a private, randomly named preview directory inside the workspace; never a fixed name; a fully transparent/uniformly blank image is a *renderer failure* — composite RGBA onto white first, then stop visual checks for the task; the reply must contain exactly one visual-status sentence and must not claim visual verification. |
| `packages/skill/skill-office/assets/office-recalculate/SKILL.md` | Recalculate. Pins: keep the original and write a new file; verify with both `data_only=False` and `data_only=True`; never present stale caches as fresh results. |
| `packages/skill/skill-office/assets/office-export-pdf/SKILL.md` | PDF export. Pins: check the command result, nonempty output, and the `%PDF-` signature, then report *that extent* of validation; do not search for PDF readers or install tools to validate a conversion. |
| `packages/skill/skill-office/assets/office/references/sidecar.md` | The "missing engine" protocol. Pins: check for an existing installation first; a missing `dsoffice` on PATH alone does not prove absence; **ask before downloading** and wait for explicit agreement; use `--ignore-scripts`; keep the package-manager cache in a task-local directory; select the platform/engine package (including the WASM fallback). |

#### Config files

| File | What it is / what it pins |
| --- | --- |
| `packages/goal/command-goal/locale/en.json` | UI locale title `command-goal`. |
| `packages/goal/command-goal/locale/zh.json` | Chinese title + description. |
| `packages/goal/goal-round-driver/locale/en.json` | UI locale title `goal-round-driver`. |
| `packages/goal/goal-round-driver/locale/zh.json` | Chinese title + description. |
| `packages/goal/goal/locale/en.json` | UI locale title `goal`. |
| `packages/goal/goal/locale/zh.json` | Chinese title + description. |
| `packages/goal/tool-goal/locale/en.json` | UI locale title `tool-goal`. |
| `packages/goal/tool-goal/locale/zh.json` | Chinese title + description. |
| `packages/goal/command-goal/package.json` | Peer deps on `dsh-commands`/`dsh-goal`/`dsh-llm`; no runtime deps. |
| `packages/goal/command-goal/tsconfig.json` | Project references: commands, llm, goal, session-projection. |
| `packages/goal/goal-round-driver/package.json` | `dsh-subagent` is an **optional** peer dependency (the driver awaits descendants only when the service is present). |
| `packages/goal/goal-round-driver/tsconfig.json` | Project references incl. `core/agent`, `core/session`, `subagent/subagent`. |
| `packages/goal/goal-round-driver/tsdown.config.ts` | Bundles `lib/types/index.js` to ESM/node/es2024; `dts: false`, `clean: false`. |
| `packages/goal/goal/package.json` | Multi-entry exports (`.`, `./types`, `./client`, `./typert`, `./remote`) — the client/host split is a packaging contract. Depends on `zod@4.4.3` and `schemastery`. |
| `packages/goal/goal/tsconfig.json` | Project references incl. `core/scope`, `session/session-projection`, `typert/protocol`. |
| `packages/goal/goal/tsdown.config.ts` | Same bundle shape as the driver's. |
| `packages/goal/tool-goal/package.json` | Peer deps: agents, goal, llm, session, system-prompt, tools, session-projection. |
| `packages/goal/tool-goal/tsconfig.json` | Project references incl. `core/system-prompt`. |
| `packages/skill/skill/locale/en.json` | UI locale title `skill`. |
| `packages/skill/skill/locale/zh.json` | Chinese title + description. |
| `packages/skill/skill/package.json` | Peer deps: `cordis`, `dsh-llm`, `dsh-scope`; deps: `dsh-util-values`, `schemastery`. |
| `packages/skill/skill/tsconfig.json` | Project references: `core/scope`, `llm/llm`, `util/values`. |
| `packages/skill/skill-filesystem/locale/en.json` | UI locale title `skill-filesystem`. |
| `packages/skill/skill-filesystem/locale/zh.json` | Chinese title + description. |
| `packages/skill/skill-filesystem/package.json` | Runtime deps: `chokidar@5.0.0`, `yaml@^2.4.2`, `schemastery`. |
| `packages/skill/skill-filesystem/tsconfig.json` | Project references: `fs/fs`, `util/home-paths`, `../skill`. |
| `packages/skill/skill-office/package.json` | Ships `assets` in the published files; depends on `@deepseek-ai/libreoffice-kit@^0.1.5`. |
| `packages/skill/skill-office/tsconfig.json` | Project references: `../skill`. |
| `packages/skill/tool-skill/locale/en.json` | UI locale title `tool-skill`. |
| `packages/skill/tool-skill/locale/zh.json` | Chinese title + description. |
| `packages/skill/tool-skill/package.json` | Peer deps include `dsh-working-directory` — the catalog is cwd-sensitive. |
| `packages/skill/tool-skill/tsconfig.json` | Project references: `core/agent`, `core/tools`, `session/working-directory`. |
| `packages/skill/tool-workspace-dependencies/package.json` | Peer deps: `dsh-tools`, `cordis`; no runtime deps. |
| `packages/skill/tool-workspace-dependencies/tsconfig.json` | Project references: `core/tools`. |
| `packages/spill/spill/package.json` | Peer deps: `dsh-brand`, `dsh-llm`, `dsh-session`, `cordis`. |
| `packages/spill/spill/tsconfig.json` | Project references: `util/brand`, `llm/llm`, `core/session`. |
| `packages/spill/spill-local/locale/en.json` | UI locale title `spill-local`. |
| `packages/spill/spill-local/locale/zh.json` | Chinese title + description. |
| `packages/spill/spill-local/package.json` | Peer dep: `dsh-spill`; dev deps include `dsh-sandbox-local`, `dsh-fs-local`. |
| `packages/spill/spill-local/tsconfig.json` | Project references: `../spill`. |
| `packages/spill/spill-policy/locale/en.json` | UI locale title `spill-policy`. |
| `packages/spill/spill-policy/locale/zh.json` | Chinese title + description. |
| `packages/spill/spill-policy/package.json` | Exports a `./notice` sub-path (the browser-safe formatter); peer deps include `dsh-output-retention`, `dsh-token-meter`, `dsh-attachment`, `dsh-fs`. |
| `packages/spill/spill-policy/tsconfig.json` | Project references: `util/output-retention`, `llm/token-meter`, `attachment/attachment`, `fs/fs`. |
| `packages/todo/tool-todo/locale/en.json` | UI locale title `tool-todo`. |
| `packages/todo/tool-todo/locale/zh.json` | Chinese title + description. |
| `packages/todo/tool-todo/package.json` | Exports `./client`; deps `zod@4.4.3` + `schemastery`; peer deps include `dsh-session-projection`. |
| `packages/todo/tool-todo/tsconfig.json` | Project references: `core/tools`, `core/agent`, `core/session`, `session/session-projection`. |

#### Test files

| File | What behaviour this test actually pins |
| --- | --- |
| `packages/goal/command-goal/tests/command-goal.spec.ts` | The `/goal` grammar end to end: empty status writes no events; a trimmed objective; "pause everything only after verification" is an *objective*; `edit` needs a replacement and starts a new goal after `complete`; missing-state results for pause/resume/clear; the whole phase matrix including `Blocker: <code>: <message>`; a `GoalError` becomes a stable error while an unexpected throw propagates; attachments ride one `user` message as `[image, file, text]` with the fixed trailing text, and are refused on sub-commands and on refused creates. |
| `packages/goal/goal/tests/goal.spec.ts` | The goal domain's contract: the projection registry is *required* to activate; one durable `goal/change` per mutation; default 256 rounds; input validation inside `create`; a *seeded* goal restores with `activation: 'disarmed'`; a forked session inherits the goal prefix and stays disarmed; every session-start edge disarms; `disarm()` writes no durable revision; exact-live-instance enforcement; CAS stale-revision rejection; canonical blocker reasons; monotonic timestamps when the wall clock moves backward; listener failures contained; an *external* appended `goal/change` is observed and disarms local activation; the whole replay-validation matrix (version, operation, extra fields, invalid creates, illegal transitions, exhausted resume, clear continuity, goal-id reuse, malformed snapshots/refs, non-positive round sources). |
| `packages/goal/goal/tests/projection.spec.ts` | The `goal` projection unit: null before the first create; the whole goal on the history tail page with a consistent `asOfSeq`; null again after a clear tombstone; an inbox splice cannot revive a cleared goal; the strict schema rejects a missing seen-id, `updatedAt < createdAt`, and `roundsStarted > maxGoalRounds`; a malformed `goal/change` is *retained as a failure* instead of throwing; a retained failure makes the host `get` throw while the client view still serves the last valid goal; no `goal` key without the service; the key is dropped on fiber unload (HMR safety). |
| `packages/goal/goal/tests/goal.e2e.ts` | The goal domain through the *production headless profile and a real process*: one `goal/change` lands in the JSONL session log, decodes with `decodeGoalChange`, and **the persisted record contains no `activation`**; no goal-sourced round was admitted. |
| `packages/goal/goal/tests/fixtures/domain/goal.patch.yml` | A test-only Loader patch over the shipped headless profile: disables the startup/runner, sets `defaultMaxGoalRounds: 11`, inserts a `cli-mock` LLM and the `seed-goal` plugin, and turns on JSONL persistence with `compression: none`. |
| `packages/goal/goal/tests/fixtures/domain/seed-goal.ts` | A test-only plugin that creates a goal at the first real step edge and then **disarms it** — the comment explains why: an armed goal would make the shipped driver start a round and race the test's disposal, and "Activation is process-local, so disarming leaves the persisted snapshot unchanged." |
| `packages/goal/tool-goal/tests/tool-goal.spec.ts` | The model tools' authority and semantics: three exclusive tools + a configured `tool:goal` prompt section; the Loader-safe export shape; invalid direct config fails *before* registration; a root model may infer create intent from an accepted human turn; agentless/driverless/non-human/live-child creation is rejected; a stale agent object is rejected; a fork resumed as a runtime root keeps direct-human authority; calls before a turn or after its end boundary are rejected; an exact goal round may complete but not edit or pause; the configured blocked lower bound is enforced across rounds, while direct-human authority may block immediately; the wrap-up instruction is injected for an autonomous completion but *not* for a human pause; strict-schema empty fillers count as omitted. |
| `packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts` | The driver's race fences: the rendered round prompt quotes a multiline/tag-like objective as one data value; exact numbered rounds are admitted until the durable cap; activation is never adopted from an already-live driver; a downstream step rejection maps to *blocked*; a cancelled reservation is paused and its prompt withdrawn so later human input runs; a host pause aborts the in-flight round but a model pause finishes its own turn; a human pause followed by an immediate resume does not re-pause; a goal edit invalidates an in-flight round and the driver continues the new revision; the revision is rechecked *after* downstream prompt hooks; a failed durability checkpoint **disarms** instead of reserving; a queue failure blocks the goal; forged goal attribution is rejected; the driver waits for progressing descendants; a plugin unload cancels an admitted round and awaits quiescence. |
| `packages/skill/skill/tests/skill.spec.ts` | The registry: provider registration/disposal; first-wins duplicate resolution; the invocation-neutral catalog and independent model/user policy; validation of every candidate and definition scalar (including provider-ownership mismatch); a failing provider is skipped and the observation marked incomplete; the lookup options are borrowed (not copied) through discovery and loading; cancellation is rechecked after a cached discovery; a hostile abort reason and a throwing string coercion are contained; the catalog is cached, bounded, and invalidated by a runtime registration; an in-flight catalog invalidated mid-read retries once and then returns uncached; a definition whose name changed invalidates the provider; scoped layers: a scoped provider lands in its layer, the nearest layer wins a duplicate regardless of rank, the scope chain follows a recompose, provider-name uniqueness is per layer, and a scoped `invalidate()` acts only while its exact registration is live; `renderSkillContent` escapes a hostile attribute name and keeps the body verbatim. |
| `packages/skill/tool-skill/tests/tool-skill.spec.ts` | The catalog and loader: the tool schema and its disposal; the abort signal reaches discovery; a stable durable catalog is injected at the first step; no catalog when nothing is model-invocable; an *incomplete* snapshot is omitted and retried later; an unchanged catalog is deduplicated or removed from the step; a stale proposed catalog is removed before the first empty baseline; additions and removals append a complete replacement (an empty tombstone for removals); the catalog resumes from the durable entries of the latest visible message; a malformed durable catalog is treated as unrecognizable rather than failing the step; a missing event below the session length throws; the catalog is re-established after compaction hides its message; body-only edits stay out of the catalog; the layered registry resolves as the calling agent sees it; the last-good catalog is retained while discovery is incomplete; a scoped same-name tool shadow removes both the schema and the guidance. The `/name` gesture tests pin the regex boundary (no paths, fractions, or broken boundaries), non-user sources are never scanned, and repeated gestures dedupe. |
| `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` | The local provider: project/custom/user/agents roots are discovered in rank order; project beats runtime beats custom beats user; flat skills parse and invalid ones are filtered; the documented boolean spellings are accepted; **legacy invocation keys are rejected without hiding valid siblings**; CRLF frontmatter and delimiter-looking text inside YAML values are handled; invalid YAML is skipped; `ctx.fs` is used for discovery/reads/project-root lookup; a transient root read reports an *incomplete* observation rather than an empty cached catalog; a transient entry failure is distinguished from a confirmed disappearance; cancellation is forwarded to reads; additions/metadata changes/deletions and a recreated missing root all refresh the catalog; `fs/observed` is the synchronous first-party invalidation path; project watchers are bounded and an evicted project is re-observed; repeated disposal and late first-party observations are contained; a followed skill symlink still refreshes; the watcher tunables are validated at load. |
| `packages/skill/skill-filesystem/tests/skill-filesystem-watcher.spec.ts` | Watcher failure handling: an existing root is canonicalized before the native watcher opens; a symlink root is preserved when link following is disabled; missing-path probes are ignored until the path actually changes; a persistent watcher startup failure keeps skills loadable but uncached; events are filtered, invalidation is coalesced, runtime errors are recovered from, and late callbacks are contained; a retained watcher is replaced on `unlinkDir`; a child unlink re-probes the root and observes immediate recreation; disposal racing the `ready` event settles the opening watcher; disposal winning the mode probe closes it; an opening rejection during teardown is contained; an error emitted after close removed its listeners is contained. |
| `packages/skill/skill-office/tests/skill-office.spec.ts` | The bundled Office set: the seven skills are listed in order; **the router's description stays ≤50 estimated tokens and its body ≤200**; each authoring body is at least 35% smaller than the previous combined guide and contains no render guidance; every body loads with the right `resourceBase` and the exact file content; disposal removes all candidates; a relocated asset tree loads through a real `cordis.yml` composition (including a non-ASCII directory name); quoted and folded YAML descriptions parse and a body line that looks like metadata is left intact; a relative asset root, a missing `SKILL.md`, a missing frontmatter, and six bad description shapes all fail *before* registration; the `capabilities` command runs with only the paths the loaded skill returned and an empty `PATH`; operation skills validate their interpreter/CLI paths at load while authoring stays available, SEA/Electron require a standalone Node, and `cli: false` disables the operation. |
| `packages/skill/skill-office/tests/progressive-loading.spec.ts` | Progressive loading in both `native` and `ptc` tool modes: the router is loaded, then only the requested authoring body; the router body does not leak the authoring guide; no `dsoffice` path appears until an operation skill is loaded; a resume and a fork retain the loaded instructions; an operation skill loads directly without the router or an authoring body; an explicitly invoked `/office-xlsx` loads without the router. |
| `packages/skill/skill-office/tests/fixtures/real-office.ts` | Shared model configuration for the real e2e runs, plus `expectNoRenderContext` — asserts a non-rendering task received *no* render guidance or commands (checks the derived messages for `imageRendering`, `maxPixels`, `render --input`, `uniformly blank`, …). |
| `packages/skill/skill-office/tests/fixtures/render-cli.ts` | A CLI wrapper fixture that runs the real LibreOffice Kit, records every invocation to a JSONL log, inspects the rendered PNGs with Pillow (compositing RGBA onto white), can force a blank render, and rewrites the `capabilities` payload's `cliPath`. |
| `packages/skill/skill-office/tests/docx-validation.e2e.ts` | A real Word content edit through the shipped headless CLI: the model must change a title's text *without changing its formatting*, and the result is verified by reopening the saved file — "without package-wide investigation". Requires `DEEPSEEK_API_KEY` and a built primary runtime; skipped otherwise. |
| `packages/skill/skill-office/tests/render-tools.e2e.ts` | Actual skill discovery and CLI rendering through the shipped headless composition, in `native` and `ptc` tool modes, for DOCX and PDF inputs; asserts the rendered PNG is readable and that a non-rendering task got no render context. Requires an API key and primary runtime. |
| `packages/skill/skill-office/tests/visual-intent.e2e.ts` | Real Office authoring tasks under three *visual intents* — explicit, explicitly excluded, and implicit (appearance change with no request) — across PPTX, DOCX and XLSX; each case has a content-verification script and an appearance-verification script, and the render CLI is faked so the harness can observe whether a render actually happened. |
| `packages/skill/skill-office/tests/xlsx-validation.e2e.ts` | Real-agent Excel validation through the shipped headless profile: data edits with basic styling must *skip* visual inspection; layout/blank cases prove the renderer failed; a mid-sized workbook is checked for preserved sheets, cell types, and readable previews. Requires a built primary runtime. |
| `packages/skill/tool-workspace-dependencies/tests/tool-workspace-dependencies.spec.ts` | The runtime manifest and installation: install offline and reuse the same release while leaving the environment and user packages unchanged; a Windows payload creates no interpreter aliases; an unreadable alias propagates without creating a partial payload; an interrupted directory swap is recovered; a changed payload digest replaces the bytes even without a Desktop version change; a legacy manifest without a digest upgrades; an incomplete replacement keeps the installed release; a linked installation directory is refused without modifying its target; malformed metadata and incompatible targets are rejected; the real tool loads through Cordis, exposes the payload paths in place, and unregisters on disposal; a payload without Node/pnpm is tolerated; a failed preparation is retried; the previous directory is validated even when a current installation exists; legacy metadata is normalized in memory without rewriting the source; an equivalent legacy installation is reused without replacing user-added packages; flat Python libraries are accepted without singling out numpy/pandas. |
| `packages/skill/tool-workspace-dependencies/tests/primary-runtime-copy.spec.ts` | Target-specific payload copying with filesystem link operations modeled independently of host privileges; a legacy regular Python command is copied without requiring an optional alias. |
| `packages/spill/spill/tests/service.spec.ts` | The seam contract only: a minimal subclass registers as `ctx.spillStore` and returns `{locator, bytes, retrievalHint}`; a **second** implementation is rejected (one per context); disposal releases the service. |
| `packages/spill/spill-local/tests/spill-local.spec.ts` | The storage mechanics and the sweep: `encodeSegment` keeps the safe set literal, escapes separators/tilde, escapes the whole-segment dot tokens, and encodes the empty string to a non-empty segment; `sessionDir` is a stable per-session hash; `saveTextFile` writes the content, reports UTF-8 bytes, sanitizes a traversal-shaped name, creates the dir/file with owner-only POSIX permissions, and gives two saves of the same name distinct paths; `privateRoot` is a stable temp directory; the service registers, resolves a relative root, falls back to the private root, rejects an unwritable root, and validates `cleanupPeriodDays` (0 disables, default 30). The sweep: deletes only strictly-older files, keeps a file exactly at the boundary, prunes empty session dirs, **skips a symlink inside a session dir and does not follow a symlinked session dir**, skips a POSIX session dir writable by another user, sweeps only exact `session-<12hex>` names, prunes an emptied *discovered* default root but never the active root, de-duplicates roots by filesystem identity, does not prune a discovered root that still holds a fresh file, covers the configured root *and* discovered defaults, omits a missing active root, skips a root another user could replace, does not block activation but is awaited on disposal, contains an unsafe root, contains a throwing warning sink, and treats a nonexistent root as silent. `discoverDefaultRoots` returns only real `dsh-spill-*` directories and warns on an unreadable base. |
| `packages/spill/spill-local/tests/loader-composition.spec.ts` | The real Loader composition through `cordis.yml`: `cleanupPeriodDays` is loaded and only expired session contents are pruned. |
| `packages/spill/spill-policy/tests/spill-policy.spec.ts` | The retention policy: no listener at all when `maxInlineTokens` is omitted; the Loader-safe export shape; negative and fractional caps fail at load; an oversized plain-text result spills and is replaced by a preview + locator within the cap; a notice-only replacement that would exceed the cap keeps the inline result; a small result is untouched; a non-text block is untouched; the outer PTC mode failure capture spills through the ordinary policy; **`read` is never spilled** (the read → spill → read loop); the durable dispatch-log arm bounds a sub-result's log copy while the program value stays whole; a slow spill backend never delays the program value, and a *sustained* slow backend backpressures the run instead of accumulating unbounded log tasks; a `saveText` failure keeps the complete content in the durable log; nested composite results stay complete; the original result is kept when the backend is missing or the call has no session owner; a downstream tool-owned projection is wrapped before the generic cap; downstream-replaced content is bounded; downstream contexts are preserved; a downstream value replacement passes through; the cap invariant holds even for a large original; and the policy stops transforming after fiber disposal (HMR safety). |
| `packages/spill/spill-policy/tests/retention.spec.ts` | The pure retention function: both images keep their original positions around a truncated middle text; a middle image is omitted together with its surrounding text; a retained boundary never crosses an image that cannot fit wholly; overlapping head and tail content is never duplicated; everything is omitted when the notices consume the budget; a text suffix is omitted when its minimum framing cost exceeds the remaining budget; an incomplete surrogate pair is dropped from the prefix; and a surrogate pair is never split at either retained end. |
| `packages/spill/spill-policy/tests/notice.spec.ts` | The persisted notice: the historical spelling is preserved independently of the formatter; every omission form the producer can format is recognized; whole-image omissions are reported while historical text-only notices still recognize; the locator and retrieval text stay opaque (parentheses and newlines included); repeated non-notice prefixes do not lose the final notice; ordinary, partial, non-final, and malformed notice text is rejected. |
| `packages/spill/spill-policy/tests/multimodal.spec.ts` | Image-bearing results: ordered end images are retained and their readable addresses are saved among the complete text; a middle image is omitted as a whole while its address stays in the complete result; images are kept when their recovery paths cannot be resolved, when the route has no visual-token calculator, after the execution filesystem is unmounted, or when there is no active model route; and the content is preserved when the image calculator loses an occurrence. |
| `packages/spill/spill-policy/tests/multimodal-recovery.spec.ts` | Recovery through *real* providers: a large single-image read stays inside a fresh 12500-token budget; two distinct end images survive in both the tool result and the DeepSeek request; and an omitted middle image is recovered through `read` + `read_image` into the next request. |
| `packages/todo/tool-todo/tests/tool-todo.spec.ts` | The `todo_write` tool: the schema is an array of `{content,status}`; a `todo/write` event carries the whole list; the **trimmed** content is stored, not the raw input; a second call replaces the list (last-write-wins); a malformed status and a non-array argument are rejected before `execute`; several `in_progress` items are accepted under the parallel policy; `allowParallelInProgress: false` rejects a parallel write and accepts one; `true` accepts the very list `false` rejects; and the *description* changes with the flag; a non-agent caller is rejected; the call presents a stable title with the list as raw input; the tool unregisters on fiber disposal; the export shape has no stray default so the Loader keeps `name`/`inject`/`apply`; the `todo/write` event isolates the log from later mutation, adds **no derived message and no surface node**, and round-trips through a seeded replay identically. |
| `packages/todo/tool-todo/tests/integration.spec.ts` | `todo_write` through the real agent loop: a model tool call produces a `tool/call`, a non-error `tool/result`, and a `todo/write` snapshot; a second call replaces the list. |
| `packages/todo/tool-todo/tests/loader-composition.spec.ts` | The real Loader composition through `cordis.yml`: `allowParallelInProgress: false` narrows the model description and rejects a parallel write; `true` permits a parallel write end to end. |
| `packages/todo/tool-todo/tests/projection.spec.ts` | The `todos` projection: null before the first `todo/write`; the latest whole list afterwards with `asOfSeq` = the last event's seq; the standing plan clears on the next `turn/start` while `turn/end` keeps the finished checklist; no `todos` key without the tool-todo plugin; the key is dropped on fiber unload (HMR safety). |

### Tier 3 — skipped with a reason

- `packages/goal/README.i18n.yaml` — generated bilingual-pairing hash record (per-heading hashes of the English and Chinese README blocks, outside code fences). Head peeked to confirm the shape; not read line by line.
- `packages/goal/command-goal/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/goal/goal-round-driver/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/goal/goal/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/goal/tool-goal/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/skill/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/skill/skill-filesystem/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/skill/skill-office/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/skill/skill/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/skill/tool-skill/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/skill/tool-workspace-dependencies/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/spill/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/spill/spill-local/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/spill/spill-policy/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/spill/spill/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/todo/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/todo/tool-todo/README.i18n.yaml` — same generated pairing-hash record. Head peeked.
- `packages/skill/skill-office/tests/fixtures/encrypted.xlsx` — binary fixture (224 bytes; ZIP/OOXML container with the encryption bit set, confirmed from the `PK\x03\x04` header and general-purpose flag `0x0009`). It is an *encrypted* workbook fixture, so it has no readable text content; not read line by line.

---

## 2. Ideas worth stealing

1. **Separate "what is true" from "what the process may keep doing on its own", and never persist the second.** The goal's durable `phase` and its process-local `activation` are different axes; after any resume/fork the goal is still `active` but the process refuses to continue until a human re-arms it (`packages/goal/goal/src/index.ts:248`, `:255-256`, `:289`; `packages/goal/goal/src/types.ts:97` — "Process-local continuation eligibility; never persisted"). `UNIQUE` to this repo. **Why it transfers:** August Trading's automations, outcome autopilot and scheduled runs all have exactly this shape — a trading *plan* is durable, but "may the bot act on it without a human" must die with the process. August's `services/automation/` and `services/ui/outcomeAutopilot` should carry an explicit armed/disarmed axis that never round-trips through storage.
2. **Prove human authority from the durable log, not from a permission table.** `hasDirectHumanInput` scans the *current turn's* events for a `user`-sourced message and requires the caller to be a runtime root (`packages/goal/tool-goal/src/authority.ts:80`); the code documents that a non-human producer "must supply their own source rather than inheriting this authority" (`:75-78`). `UNIQUE`. **Why it transfers:** August's human-in-the-loop approval for consequential actions (logging a trade, applying a skill draft, changing risk settings) can be proven the same way — if the app records the *origin* of every message it shows the model, an approval gate becomes a query, not a modal.
3. **Make "the model may declare itself blocked" a throttled, machine-readable claim.** `blockedAfterConsecutiveRounds` (default 3) is both interpolated into the system prompt and enforced as a hard floor in code, and the prompt spells out the anti-perfectionism clause "difficulty, uncertainty, or useful remaining work is not blocked" (`packages/goal/tool-goal/src/index.ts:115`, `:305-313`). `UNIQUE`. **Why it transfers:** August's agents routinely call a hard market "unclear" and stop. A `blocked_reason` + a consecutive-attempt floor + a stable code would turn a shrug into a measurable, retryable state, and the code vocabulary (`round-limit`, `queue-failed`, `prompt-rejected`, `model-reported`) is exactly the kind August's `utils/runStatus.ts` already uses.
4. **A "reservation" protocol for scheduled autonomous work: reserve, admit, then re-validate after the downstream hook.** The driver reserves `{goalId, revision, round}`, matches the *complete claimed record* (`isDeepStrictEqual` on content plus source), and re-checks the reservation **after** the downstream `pre-step` chain before letting the step enter (`packages/goal/goal-round-driver/src/index.ts:62`, `:365`, `:380`, `:432`). `UNIQUE`. **Why it transfers:** August's automations and multi-step tool plans need the same thing — a scheduled action must prove it still owns the revision it was planned against, and a human message arriving mid-step must not be silently swallowed (`restoreOtherClaimed`, `:135`).
5. **Fail closed on a durability checkpoint.** If `ctx.sessions.flush()` fails, the driver *disarms* the goal rather than starting another round (`packages/goal/goal-round-driver/src/index.ts:150-157`); the README states the rule plainly. `UNIQUE`. **Why it transfers:** August's notebook writes have exactly this failure mode — `MemoryFilesService.getNotebookWriteFailure()` already exists as "the only place that knows a notebook write never reached disk". The missing half is the *policy*: a failed durability checkpoint should stop the loop, not just log.
6. **Give a durable plan a "standing plan" lifecycle: it survives the turn it belongs to and is cleared by the next turn.** The `todos` projection folds `todo/write` as last-write-wins, keeps the finished checklist through `turn/end`, and clears on the next `turn/start` (`packages/todo/tool-todo/src/index.ts:123-133`). `UNIQUE`. **Why it transfers:** August's trade-plan and post-trade checklists are the same object. "Clear at the start of the next turn" is a one-line rule that stops a stale checklist from being read as the current plan.
7. **Truncate an oversized tool result but keep the *tail*, and reserve the notice out of the budget first.** `retainContent` keeps half the budget from each end, never splits an image, never splits a surrogate pair, and reports the exact omitted byte count (`packages/spill/spill-policy/src/retention.ts:48`); the plugin reserves the notice cost *before* fitting content, so the result can never exceed the cap because of its own notice (`packages/spill/spill-policy/src/index.ts:112-113`). `UNIQUE`. **Why it transfers:** August's web-fetch/market-data tools produce large payloads; the head-and-tail preview with a byte count and a recovery path is directly reusable, and the "reserve the notice first" ordering is a bug class August would otherwise hit.
8. **Keep the full result, and make the truncation recoverable rather than lossy.** A spill write is *best-effort*: any failure logs and **keeps the original inline content** (`packages/spill/spill-policy/src/index.ts:126-128`), and the `read` tool is explicitly exempt so the model can never be put in a read → spill → read loop (`:135`). `UNIQUE`. **Why it transfers:** August's provider errors and large API payloads are the same shape. "A truncation failure degrades to the full content, never to an error" is the right default for a trading app that must never lose the raw response.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** the goal-round driver is the closest analogue to a cron-style loop: it fires only at whole-agent idle, only for an *armed* goal, only after a durability checkpoint, and only when the agent's descendants have settled (`packages/goal/goal-round-driver/src/index.ts:111`, `:150`, `:176`). The round allowance is a *durable admitted-round count* derived from the log, not an in-memory counter, so it survives a restart (`packages/goal/goal/src/fold.ts:313`). What keeps it reliable: a fail-closed checkpoint; a "block with a stable code" exit at the cap (`round-limit`); no auto-restart after a cancellation; and a single-owner "only one current goal per session" rule. What is *absent*: catch-up for missed runs, wall-clock or cost budgets, and any resource metering beyond the round count — the README says so explicitly ("Round cap, not resource budget").
- **Human-in-the-loop approval:** the goal tools implement a two-tier authority (`packages/goal/tool-goal/src/authority.ts:100`, `:111`) — `direct-human` for edit/pause/resume, and `direct-human` *or* `goal-round` for complete/blocked. The audit trail is the session log itself: every mutation is a `goal/change` event with the full post-mutation snapshot, and the fold can prove that a recorded change was legal (`packages/goal/goal/src/fold.ts:200`). There is no separate approval table; the log *is* the audit trail. The model cannot resume a durably paused goal (`packages/goal/tool-goal/src/index.ts:283`) — the human owns that transition.
- **Post-mortem / reflection loops:** this shard has **no** reflection loop and no rule-accumulation, expiry, or retirement machinery. The nearest thing is the goal's terminal transition: a round that reports `complete` or `blocked` gets a forced closing message whose *grounding clause* is mandatory — "Report only what earlier rounds and tool results in this session actually establish; when a detail is not in the session, say so instead of inventing it" (`packages/goal/tool-goal/src/wrapup.ts:5`). That is a hallucination brake applied exactly where the model is most likely to summarise. The skill domain has a two-bit invocation policy and a rank ladder, but no lifecycle either.
- **Multi-agent:** the goal domain is explicitly **single-owner** — one current goal per session, and the tool authority refuses a live child agent creating or editing a goal (`packages/goal/tool-goal/src/authority.ts:80`; the test at `packages/goal/tool-goal/tests/tool-goal.spec.ts:243`). The driver waits for descendants to settle before reserving a round (`packages/goal/goal-round-driver/src/index.ts:176`), i.e. subagents are *waited for*, never *debated with*. The README says outright that same-session execution is deliberate and that the package "deliberately does not spawn a fresh agent, fork a session prefix, or implement Ralph-style independent attempts". Debate is nowhere in this shard; there is no multi-agent mechanism to evaluate.
- **Structured logs the model can query:** the goal domain *is* the model of the durable state. The durable artifact is the **session log** (event-sourced JSONL), and the query surface is a *projection* — the `goal` key folds `goal/change` and goal-sourced `user/message` events into one current value (`packages/goal/goal/src/index.ts:162`). The todo domain does the same with `todo/write` (`packages/todo/tool-todo/src/index.ts:123`). The spill domain adds the *other* half: when a payload is too big for the context, it is written to a private session-scoped file and the model gets a **path plus a retrieval hint** ("Use read with offset/limit, or grep this path to search within it", `packages/spill/spill-local/src/index.ts:150-159`). So the model-queryable log is: JSONL session log + a projection registry + a file-per-record overflow store. No database.
- **Staying simple as features accumulate:** three separations, each stated in a README and each enforced in code: (a) *contract vs implementation vs policy* — `SpillStore` has exactly one method and owns no policy (`packages/spill/spill/src/index.ts:29-42`); (b) *durable phase vs live authority* (goal); (c) *catalog vs body* (skills) — "every load re-reads the current file, so editing a skill body needs no versioning or cache invalidation" (`packages/skill/skill-filesystem/README.md`). The registry also refuses to grow a second abstraction: the provider interface is `list()` + `get()`, and everything else (ranking, shadowing, invalidation) is the registry's problem (`packages/skill/skill/src/index.ts:247`).

---

## 4. Non-obvious decisions and gotchas

1. **A `clear` is a tombstone, not a delete, and the id can never be reused.** `clear` writes `operation: 'clear'` with a `cleared` ref at `revision + 1` (`packages/goal/goal/src/index.ts:433-447`); the fold keeps `seenGoalIds` forever and refuses a `create` whose id was seen (`packages/goal/goal/src/fold.ts:288`).
2. **The durable round count comes from the *message*, not from a counter the driver increments.** The fold advances `roundsStarted` only when a `user/message` carries `{kind:'goal', goalId, revision, round}` with `round === roundsStarted + 1` and `round <= maxGoalRounds` (`packages/goal/goal/src/fold.ts:313-330`). A reservation that was never admitted consumes nothing — which is why the driver and the projection cannot disagree.
3. **A host-initiated pause aborts the live turn; a model-initiated pause does not.** The discriminator is `ctx.agents.currentInitiator() !== agent` (`packages/goal/goal-round-driver/src/index.ts:308-310`). Get this backwards and either the model keeps working after a human brake, or the model's own pause kills its turn.
4. **The model may pause but may not resume.** `update_goal action=resume` on a durable *paused* goal throws `GOAL_TOOL_RESUME_PAUSED` ("the user must resume it", `packages/goal/tool-goal/src/index.ts:283`). A brake is a human's, and the model cannot release it.
5. **"Not mine" and "mine but broken" are different outcomes.** `decodeGoalChange` returns `undefined` for a value that is not a goal change, but *throws* for a value that declares `kind: 'goal/change'` and is malformed (`packages/goal/goal/src/fold.ts:134-152`). One event stream carries several domains; that distinction is what makes it possible.
6. **A replay failure poisons only the host read, never the client view.** The projection retains the first failure in `state.failure` and keeps the last valid goal for clients (`packages/goal/goal/src/index.ts:146-160`); `ctx.goals.get` then throws (`packages/goal/goal/src/index.ts:479`).
7. **The model cannot re-publish the same skill catalog.** The digest is over the *entries*, not the rendered `<system-reminder>` prose, and it is JSON-per-entry so no separator can be ambiguous (`packages/skill/tool-skill/src/index.ts:330-340`). An unchanged catalog is **removed from the step**, not resent.
8. **A skill that is invalid disappears with a warning and no diagnostic.** "the model catalog receives no per-skill diagnostic and cannot distinguish an absent skill from an invalid one" (`packages/skill/skill-filesystem/README.md`). Deliberate: a per-skill error surface is a prompt-size and UX cost.
9. **The skill catalog's replacement is whole-list, and an empty one explicitly retires the old names** ("Do not use names from earlier skill catalogs", `packages/skill/tool-skill/src/index.ts:281-320`). Stale names are a real failure mode when a skill is deleted mid-session.
10. **`disable-model-invocation` skills have exactly one entry point** — the user's `/name` gesture. The catalog and the `skill` tool never expose them (`packages/skill/tool-skill/src/index.ts:165-190`).
11. **The `read` tool is never spilled** (`packages/spill/spill-policy/src/index.ts:135`) — truncating a `read` result would create a read → spill → read loop.
12. **The spill sweeper matches *exact* name shapes, not prefixes.** `^dsh-spill-[A-Za-z0-9]{6}$` and `^session-[0-9a-f]{12}$` (`packages/spill/spill-local/src/cleanup.ts:15`, `:23`). A prefix match would delete a stranger's directory. The same file refuses roots another local user could replace and never follows a symlink.
13. **The spill file name is `<12 hex>-<encoded suggested name>`, and the encoding is injective over all JS strings** (`packages/spill/spill-local/src/store.ts:55`). Distinct inputs never collide and nothing can escape one path segment.
14. **The cleanup sweep is launched but not awaited at activation**, and the disposer awaits *the same promise* (`packages/spill/spill-local/src/index.ts:95-100`) — availability is never delayed, but a fiber unload still reaches quiescence.
15. **The `todo` list is cleared by the next `turn/start` but survives `turn/end`** (`packages/todo/tool-todo/src/index.ts:127-130`). It is standing-plan UI state, never history.
16. **`allowParallelInProgress` changes only one clause of the tool description** (`packages/todo/tool-todo/src/index.ts:63-71`) — the code path is identical; the *policy text* is the difference. A required, no-default flag.
17. **A stray `export default` would make the Loader drop `inject`** — the todo README cites postmortem 0001 for it. The test asserts the namespace-plugin export shape (`packages/todo/tool-todo/tests/tool-todo.spec.ts:225`).
18. **The skill registry's cache key carries the scope *chain*, not the scope.** A blank-session recompose re-parents a scope object without touching the registry, so only a chain-bearing key makes the next read see the new preset (`packages/skill/skill/src/index.ts:519-530`).
19. **Providers are queried sequentially** and a slow one delays every provider after it (`packages/skill/skill/src/index.ts:596-606`; the README lists this as a known limit). Cancellation stops the wait but cannot terminate an uncooperative provider.
20. **Chokidar's `close()` needs an `error` listener re-attached** — its scheduled write-settle poll can `EPERM` a file the teardown is deleting, and an `error` emission with no listener is rethrown as an uncaught exception (`packages/skill/skill-filesystem/src/index.ts:539-546`). A Windows-specific trap with the reason inline.
21. **The Office render skill treats a uniformly blank image as a renderer failure and *stops* visual checks** — it overrides its own "rerender after edit" guidance, and the reply must contain exactly one visual-status sentence rather than a claim of visual verification (`packages/skill/skill-office/assets/office-render/SKILL.md`).
22. **`office-xlsx` states the most dangerous fact in the set:** "Writing a formula does not calculate its result… `data_only=True` returns cached values that may be absent or stale. Do not replace requested formulas with constants or report stale values as newly calculated results." For a trading app the analogue is a *stale* indicator or a *cached* quote presented as fresh.

---

## 5. Weak spots

1. **The goal domain trusts in-process producers.** "a plugin with direct `Session` access can append counterfeit `goal/change` data" (`packages/goal/goal/README.md`, Known Limitations). The strict replay catches malformed or inconsistent records and wedges goal access — but that is *detection*, not isolation, and a counterfeiter can write a *well-formed* change.
2. **The blocked-threshold and the "same condition" judgment are both model judgment.** The runtime enforces a *count* of admitted rounds, never the semantic equivalence of the obstacle (`packages/goal/tool-goal/README.md`, Known Limitations). A model that reports a different blocker each round satisfies the count.
3. **No evaluator certifies completion.** "the caller that records completion or blocking is authoritative" (`packages/goal/goal/README.md`). The whole loop rests on the model judging its own work.
4. **The round cap is a count, not a budget.** Tokens, currency, wall time and provider quota are explicitly out of scope, and their session events "are not attributed to the goal message or mapped into goal blocker codes" (`packages/goal/goal-round-driver/README.md`). A 256-round loop on an expensive model is unbounded in money.
5. **The skill registry has no TTL and no last-good catalog of its own.** Invalidation is entirely provider-driven, providers are queried *sequentially*, and shadowed definitions are invisible — "there is no API to inspect all shadowed definitions" (`packages/skill/skill/README.md`, Known Limitations). A slow or broken provider degrades the whole catalog.
6. **The spill cleanup is one-shot at activation.** A long-lived deployment is not swept until restart, so files that cross the age cutoff during a run are reclaimed only on the next start (`packages/spill/spill-local/README.md`). And a notice that cannot fit the cap leaves the *oversized original inline* after the backend has already saved an unreferenced spill — wasted bytes and a wasted write on every call.
7. **The spill locator is not an access control.** "Storage is not access control — the owner session namespaces writes but does not authorize reads of a locator" (`packages/spill/spill/README.md`), and the local backend's own dev note flags the workspace-confinement gap: the retrieval model assumes the model's `read`/`grep` can inspect a path *outside* the session working directory.
8. **`skill-filesystem` is one level deep and `.git`-anchored.** Nested skill trees, package manifests, and any project-root marker other than `.git` are unsupported; a monorepo with sub-projects has no way to scope skills per sub-project (`packages/skill/skill-filesystem/README.md`).
9. **The todo list is single-owner and whole-list.** No shared list across agents, no per-item edit, no read-back tool, and no stable id — the model must resend the entire list on every call, so token cost grows with every update and the arguments stay until compaction (`packages/todo/tool-todo/README.md`). For a multi-agent trading desk this is a real ceiling.
10. **Two frontmatter parsers and two skill conventions coexist.** `skill-filesystem` hand-rolls a fence scanner and *skips* broken files; `skill-office` uses a regex and *throws* at registration. Both are justified, but a reader has to learn which convention applies where.
11. **The `todo` and `goal` projections are separate units with separate lifecycles** — a `turn/start` clears the todo list but does not touch the goal, and a goal round does not clear the todo list. There is no single "what is the agent currently doing" projection, so a consumer must reconcile them.
12. **Three packages have no `locale/` entry** (`packages/spill/spill`, `packages/skill/skill-office`, `packages/skill/tool-workspace-dependencies`) while every sibling package does — a small inconsistency in an otherwise strict localisation discipline.
13. **The `goal` package's `create` re-validates its input *inside* `create` rather than at the schema boundary** (`packages/goal/goal/src/index.ts:303`; the test at `packages/goal/goal/tests/goal.spec.ts` asserts the error codes). The goal domain is a *remote* service, so the wire schema cannot enforce the same invariants the local API does — which is why the fold has to re-derive them.
---
