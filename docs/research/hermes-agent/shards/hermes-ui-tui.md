# hermes-agent :: hermes-ui-tui

**Files in shard:** 627 (read: 627, skipped with reason: 0)
**What this shard covers:** the `ui-tui/` workspace of the Hermes agent — a React 19 + Ink terminal
client that talks to a Python gateway over newline-delimited JSON-RPC. Three distinct bodies of work
live here: (1) `packages/hermes-ink/`, a **fork of the Ink terminal renderer** that adds a
screen-buffer/blit diff engine, a virtualised `ScrollBox`, real text selection, a complete `termio`
ANSI parser, mouse tracking and an OSC layer; (2) `src/`, the TUI application itself — a gateway
client, a turn-lifecycle controller, a slash-command system, an approvals/clarify prompt flow, a
subagent roster, a durable pending-input journal, and ~200 vitest suites; (3) `scripts/`, the
native PTY probes and benchmark harnesses used to prove the renderer works against a real terminal.

> **Reading method note (honesty).** Everything was read as source text via `Get-Content`; **nothing
> was executed** — no install, build, codegen or test ran, and no repo script was invoked. The shard
> is 4.3 MB across 627 files, which is more than one session can ingest line-by-line. Two depths were
> used, and the ledger in `hermes-ui-tui.status.tsv` says which is which:
> - **Full read (113 files)** — read line by line: every file in `packages/hermes-ink/src/utils`,
>   `src/ink/events`, `src/ink/layout` (except `yoga.ts`), the `src/ink/hooks`, the small
>   `src/ink/components`, plus every load-bearing app file listed in Tier 1 below
>   (`turnController.ts`, `submissionCore.ts`, `overlayStore.ts`, `useQueue.ts`,
>   `pendingInputs.ts`, the approval/clarify path, `gatewayRecovery.ts`, `loopStatus.ts`,
>   `goalStatus.ts`, …) regardless of size, and both docs and all config files.
> - **Structural extraction (514 files)** — the remainder were read through a filter that keeps
>   every doc-comment, every exported symbol and every control-flow line, and drops only
>   React-Compiler boilerplate (`$[n] = …` cache slots) and inline base64 source-map blobs. For
>   test files the filter keeps the file's comments and its `describe`/`it` titles. No file was
>   summarised from its name alone; the row for each such file in the Tier-2 table quotes content
>   actually read. The `note` column of the status TSV records which method was used per file.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `ui-tui/README.md`
- **Purpose:** the contract document for the whole TUI: what runs, the transport, the hotkey table,
  the prompt flows, the event surface, the file map.
- **Key decision (stealable):** *"TypeScript owns the screen. Python owns sessions, tools, model
  calls, and most command logic."* (`ui-tui/README.md:3`). The split is enforced by one transport:
  JSON-RPC over stdio, with **stdout = protocol only** and **stderr = an in-memory log ring** —
  "Neither writes directly into the terminal" (`ui-tui/README.md:60-63`).
- **Non-obvious:** malformed stdout lines are *not* fatal — they become `gateway.protocol_error`
  events and stderr lines become `gateway.stderr`, so the renderer never sees a byte the gateway
  produced (`ui-tui/README.md:60-63`).
- **Stealable:** the **slash-command fall-through chain** — a command the TUI does not know is sent
  to the gateway as `slash.exec` then `command.dispatch`, so Python owns aliases, plugins and skills
  without the TUI duplicating them (`ui-tui/README.md:397-406`).
- **Stealable:** the **busy-mode laws**: plain text typed while the agent is busy is *queued*, but
  slash commands and `!cmd` are *not* queued and run immediately (`ui-tui/README.md:302-304`); the
  queue auto-drains after each assistant response *unless* a queued item is being edited
  (`ui-tui/README.md:305`).
- **Stealable:** **`{!cmd}` interpolation is evaluated at SEND time, not at queue time** — queued
  drafts keep the raw text so the shell command runs against the state at the moment it is actually
  dispatched (`ui-tui/README.md:307-308`).
- **Edge cases:** `PgUp`/`PgDn` are deliberately left to the terminal emulator
  (`ui-tui/README.md:283`); `Alt+G` is offered because VS Code/Cursor steal `Cmd/Ctrl+G`
  (`ui-tui/README.md:246`).

#### `ui-tui/CANONICAL_GATEWAY.md`
- **Purpose:** the design note for the *canonical* local-gateway connection — the TUI is a pure
  client of a long-lived gateway daemon, not the owner of an agent loop.
- **Key decision:** the TUI obtains a **private, profile-bound, single-use control ticket** that
  "travels through a private child pipe and WebSocket subprotocol, never in an endpoint URL or
  discovery receipt" (`ui-tui/CANONICAL_GATEWAY.md:11-13`). A concrete answer to "how do you
  authenticate a local client without leaking a secret into a URL that gets logged".
- **Key decision:** **closing Ink detaches the socket without stopping the gateway**; reconnection
  uses *discovery* to get a fresh ticket (`ui-tui/CANONICAL_GATEWAY.md:16-18`). Crash (SIGKILL/OOM)
  is distinguished from an explicit stop: a crashed gateway may be re-ensured **up to three
  reconnects per minute**; a gateway in `stopped`/`desired_state: stopped` is **never resurrected**
  (`ui-tui/CANONICAL_GATEWAY.md:18-22`).
- **Key decision:** **an explicit remote URL never falls back to a local daemon** —
  "a failed connection cannot fall back to a local daemon" (`ui-tui/CANONICAL_GATEWAY.md:15`).
- **Key decision:** **capability negotiation is a gate, not a hope.** The TUI requires
  `runtime.describe.session_create` to advertise the `tui` source; an older CLI-only runtime
  returns "a visible policy compatibility failure rather than silently creating CLI-policy work"
  (`ui-tui/CANONICAL_GATEWAY.md:24-27`).
- **Key decision:** the **input journal** — "Enter writes a private fsync/rename journal *before*
  clearing the composer; reconnect only resumes that destination" (`ui-tui/CANONICAL_GATEWAY.md:37-38`).
  Confirmed admissions are retired from the journal; ambiguous prompt retries keep their original
  id and payload; unknown executions stay **paused** until the human discards them with `Ctrl+X`
  through a generation-bound authority resolver (`ui-tui/CANONICAL_GATEWAY.md:40-44`).
- **Stealable:** **ambiguity is retained, never auto-replayed** — "An ambiguous control reply is
  retained for inspection but never automatically or manually replayed"
  (`ui-tui/CANONICAL_GATEWAY.md:50-51`).
- **Stealable:** the **"current gaps"** section names exactly what is *not* claimed
  (`ui-tui/CANONICAL_GATEWAY.md:56-72`): "render an explicit unavailable-inventory message, not
  fabricated tool/skill lists" (`ui-tui/CANONICAL_GATEWAY.md:59-60`).
- **Stealable (test design):** the **native probe** (`ui-tui/CANONICAL_GATEWAY.md:74-119`) — real
  PTY, loopback model, private temp `HOME`/`HERMES_HOME`, "the fixture does not replace renderer
  predicates or inject RPC results" — and, crucially, the probe **retains the authority's settled
  snapshot *before* starting the reconnected viewer**, "otherwise a late live delta can conceal
  broken history hydration" (`ui-tui/CANONICAL_GATEWAY.md:88-89`).

#### `ui-tui/src/app/turnController.ts`
- **Purpose:** the stateful class that owns a turn's whole life — streaming buffers, tool state,
  reasoning segments, notices, interrupts, and the final transcript archive.
- **Key abstractions:** `class TurnController` (`ui-tui/src/app/turnController.ts:173`), the module
  singleton `turnController` (`:1186`), `SealedInterrupt` (`:132`), `InterruptDeps` (`:156`),
  `lateInterruptedReply` (`:142`).
- **Data flow:** gateway events → `recordMessageDelta` / `recordToolStart` / `recordToolComplete` /
  `recordReasoningDelta` / `recordMessageComplete` → a **nanostore** (`turnStore.ts`) → React
  subscribers. The controller keeps the *authoritative* buffer (`bufRef`) and the *rendered* buffer
  separately.
- **Non-obvious (stealable):** the **sealed-interrupt reconciliation.** Ctrl+C seals the reply the
  moment the key lands, but the agent keeps streaming and persists everything it streamed. The
  persisted partial that extends the sealed text is adopted so "the screen matches state.db"
  (`turnController.ts:137-154`).
- **Non-obvious:** `recordError` **discards the whole unsealed turn** (flushed segments *and* the
  streaming tail) — unlike `recordMessageComplete`, which must keep the tail, and
  `interruptTurn`, which preserves it as `partial` (`turnController.ts:655-669`).
- **Non-obvious:** the **"notice held while busy"** discipline. A notice arriving mid-turn is held
  (latest-wins) because the FaceTicker owns the verb slot; the TTL clock starts only when the
  notice becomes *visible*, so an 8-second "restored" notice shows for its full life
  (`turnController.ts:198-207`, `:275-293`); the flush is invoked **only** by the three real turn-end
  sites, "NEVER by `idle()`/`reset()`, which would leak session A's notice into session B"
  (`turnController.ts:300-306`).
- **Non-obvious:** the **diff-segment anchoring**. `pushInlineDiffSegment` flushes the in-progress
  text first so "the diff lands BETWEEN the assistant narration that preceded the edit and whatever
  the agent streams afterwards — not glued onto the final message" (`turnController.ts:588-620`);
  and at `message.complete`, a diff-only segment the agent is about to narrate is dropped so the
  patch does not render twice (`turnController.ts:721-733`).
- **Non-obvious:** **streaming batch cadence is adaptive** — typing shortens the delay
  (`boostStreamingForTyping`), scrolling lengthens it (`boostStreamingForScroll`), and idle relaxes
  it (`turnController.ts:209-219`).
- **Edge case:** the reasoning buffer is **capped at 80 000 chars, trimmed to the last 60 000**
  (`turnController.ts:903-905`).
- **Edge case:** late subagent events after `message.complete` would resurrect a finished child;
  `upsertSubagent(..., { createIfMissing: false })` drops them silently
  (`turnController.ts:1117-1124`).
- **Stealable:** the subagent roster is ordered **by spawn (depth, parent, index) rather than
  insert time**, "because grandchildren can shuffle relative to siblings when events arrive out of
  order under high concurrency" (`turnController.ts:1174-1180`).

#### `ui-tui/src/app/submissionCore.ts`
- **Purpose:** the single choke point every prompt submission funnels through.
- **Key abstractions:** `submitPrompt` (`ui-tui/src/app/submissionCore.ts:323`), `markSubmitting`
  (`:46`), `readmitAsPrompt` (`:133`), `isSessionBusyError` (`:19`), `SubmitPromptDeps` (`:21`).
- **Non-obvious (stealable):** **busy is flipped synchronously, before any await.** The old path
  fired an async `input.detect_drop` RPC and only set `busy` inside its `.then`; a second Enter
  inside that window read `busy === false` and raced a second `prompt.submit` onto the backend
  instead of landing in the local queue, so the client lost track of the message and the UI stuck on
  "analyzing…" until Ctrl+C (`submissionCore.ts:30-45`). "Marking busy at the choke point closes
  the gap for every caller" (`:44-45`).
- **Non-obvious:** **busy-time admission is queue-shaped by construction.** `behindTurn` marks the
  item `queued` and the user bubble is painted only when the authority's fanout reports the row
  started — "so the bubble lands after the in-flight assistant reply instead of inside it"
  (`submissionCore.ts:327-330`; cf. `pendingBubbles.ts:5-7`).
- **Non-obvious:** **a busy correction that the owner confirms it never delivered becomes the next
  prompt** — same row, same `submission_id`, admitted durably behind the running turn. "Kept as a
  control it would be refused again on every retry, since the generation it names is over"
  (`submissionCore.ts:140-142`, `readmitAsPrompt` `:133-139`). But a *plain* rejection that may
  follow delivery settles as refused and is **never** re-sent, "since re-sending it would run the
  correction twice" (`submissionCore.ts:163-172`).
- **Edge case:** an **identityless write cannot be deduplicated**, so a legacy-attempted item is
  never re-sent (`submissionCore.ts:346-356`).
- **Edge case:** the "busy" error path is kept as a **safety net** even though the gateway now
  queues mid-turn sends successfully — "so a message is never silently dropped"
  (`submissionCore.ts:658-472`).
- **Edge case:** a file-drop check is **always** delegated to the backend
  (`input.detect_drop`) because the backend's `_detect_file_drop` handles spaces, quotes, Windows
  drive letters and escapes correctly; literal launcher text skips it
  (`submissionCore.ts:493-499`, `:538-547`).
- **Stealable:** `retireCanonicalControls(gw, sid)` is called **before every submit**, so a new
  prompt retires any lost-reply control that was still outstanding (`submissionCore.ts:394`).

#### `ui-tui/src/app/overlayStore.ts`
- **Purpose:** the single store for "what is on top of the composer right now".
- **Key abstractions:** `$overlayState` (nanostore), `$isBlocked` (`:73`), `$isStatusRuleOccluded`
  (`:137`), `SENSITIVE_PROMPTS` (`:146`), `PROMPT_KEYS` (`:152`), `resetFlowOverlays` (`:175`),
  `capturePromptResponseGuard` (`:7`).
- **Stealable:** **the overlay taxonomy is explicit and singular.** `BLOCKING_KEYS` lists every
  overlay that suspends text input, with `ambient` the one non-blocking key
  (`overlayStore.ts:48-71`); `SENSITIVE_PROMPTS` is the "single source for the credential prompts"
  so "no gate silently misses one" (`:141-146`); `PROMPT_KEYS` is "the agent's questions and
  confirms, which take the keyboard from any open panel" (`:151`).
- **Stealable:** **`$isBlocked` and `$isStatusRuleOccluded` are deliberately different questions.**
  The first is "is text input suspended"; the second is "does an overlay actually paint over the
  status rule", and the file carries a 40-line comment proving it — e.g. the PromptZone flow states
  render in normal flow and *push content down*, so the rule stays on screen and "its clock must
  keep running" (`overlayStore.ts:75-115`).
- **Stealable:** the **soft reset** — a turn ending drops flow-scoped overlays (approval / clarify /
  confirm / sudo / secret / pager) but **preserves user-toggled ones** (agents dashboard, model
  picker, skills hub, sessions overlay): "the old 'reset everything' behaviour silently closed
  /agents the moment delegation finished" (`overlayStore.ts:164-173`).
- **Stealable:** `capturePromptResponseGuard` returns a closure that checks **the same prompt
  object** is still installed *and* the execution epoch/generation have not moved, so a stale card
  cannot answer for a newer turn (`overlayStore.ts:7-18`).

#### `ui-tui/src/hooks/useQueue.ts`
- **Purpose:** the message queue — local items, server-admitted items, and the durable journal that
  survives a crash.
- **Key abstractions:** `QueueItem` (`ui-tui/src/hooks/useQueue.ts:19`), `useQueue` (`:97`),
  `takeQueueItem` (`:73`), `removeAtInPlace` (`:77`).
- **Data flow:** the queue is **not** an array in React state. It is a `Map<destinationKey,
  PendingQueue>` ref, rehydrated from the on-disk journal (`loadPendingInputs`) and reconciled with
  the server's pending fanout (`useQueue.ts:97-186`).
- **Non-obvious (stealable):** **editing a queued item mints a new submission but keeps the
  attachments, the destination and the busy-control intent** — only `failed`, `inFlight`,
  `legacyAttempted`, `preparedText`, `settle` and `submissionId` are dropped
  (`useQueue.ts:60-72`).
- **Non-obvious:** **server-queued rows are owned by the gateway** — deleting or editing one goes
  through `prompt.cancel`, "the next fanout, not a local splice, retires it" (`useQueue.ts:94-96`).
- **Edge case:** **input typed before any session exists belongs to the next attachment**, unlike a
  bound session's queue, "which must never migrate on navigation" (`useQueue.ts:158-159`).
- **Edge case:** compression **re-keys the queue** before resolving it, and the items' `destination`
  is only rewritten when the item is neither in-flight nor failed (`useQueue.ts:104-133`).

#### `ui-tui/src/lib/pendingInputs.ts`
- **Purpose:** the durable, crash-safe journal of inputs the client believes it sent.
- **Key abstractions:** `savePendingInput` (`ui-tui/src/lib/pendingInputs.ts:88`),
  `removePendingInput` (`:123`), `loadPendingInputs` (`:138`), `migratePendingInputs` (`:50`),
  `pendingInputOwner` (`:30`), `pendingDestinationKey` (`:27`).
- **Data flow:** one **file per submission**, named `<uuid>.json`, in
  `<HERMES_HOME>/tui-pending-inputs/`, written `write → fsync → rename → fsync(dir)`.
- **Non-obvious (stealable):** **separate files avoid read/modify/write loss between two native
  clients** (`pendingInputs.ts:87`, and the same reason in `loadPendingInputs` where a missing
  record is "a concurrent client's acknowledgement, not corruption" `:149-151`).
- **Non-obvious:** the directory is created with `mode: 0o700` and the records with `mode: 0o600`
  (`pendingInputs.ts:90`, `:117`).
- **Non-obvious:** the **`ownerDestination` vs `destination` split.** `destination` is where the
  item was *sent*; `ownerDestination` is where it is *owed*. Only a non-failed, non-in-flight item
  is re-pointed at the new owner (`:98-99`). The owner chain is walked with a **cycle guard**
  (`:30-47`).
- **Non-obvious:** **"Resume authorizes the source → successor mapping; navigation alone does not"**
  (`pendingInputs.ts:49-50`).
- **Edge case:** `loadPendingInputs` distinguishes **durable resume** (match on the *stored* sid)
  from an ordinary load (match on the runtime sid) (`:172-180`).
- **Edge case:** an invalid record throws a *translated* error naming the file
  (`:163-169`).

#### `ui-tui/src/app/gatewayCanonicalEvents.ts`
- **Purpose:** the owner-epoch lifecycle fence and the generation-bound shared controls.
- **Key abstractions:** `fenceLifecycleEvent` (`ui-tui/src/app/gatewayCanonicalEvents.ts:28`),
  `settleSharedPrompt` (`:52`), `openCanonicalClarify` (`:72`), `openCanonicalApproval` (`:127`),
  `isGenericErrorEvent` (`:19`).
- **Non-obvious (stealable):** the **lifecycle fence.** "Lifecycle authority is local to an owner
  epoch. Only attachment RPC snapshots replace that epoch; delayed push events cannot reset it."
  An event is dropped when its epoch differs, its generation is missing/non-integer, or it is
  *older* than the current generation (`gatewayCanonicalEvents.ts:25-40`). A `session.info` event
  does **not** advance the stored generation — only a non-`session.info` lifecycle event does
  (`:43-45`).
- **Non-obvious:** **a generic `error` (build/RPC failure) is not a turn settlement** and is
  excluded from the fence (`:18-23`).
- **Stealable:** the canonical gateway publishes approvals/clarifies as **events carrying a
  `prompt_id`** and they are answered through `approval.respond` / `clarify.respond` — "never
  through a server→client request frame", which is the legacy path
  (`:67-71`).
- **Edge case:** the canonical one-card and the batch card are **normalised into one
  `questions[]` shape** so one renderer serves both (`:98-114`).

#### `ui-tui/src/app/createServerRequestHandler.ts`
- **Purpose:** the TUI's answer to the backend's server→client requests (legacy path).
- **Key abstractions:** `createServerRequestHandler` (`ui-tui/src/app/createServerRequestHandler.ts:28`),
  `ServerRequestHandlerContext` (`:9`).
- **Non-obvious (stealable):** **a method the terminal cannot answer returns `false`**, so the
  channel answers `-32601` and the tool "fails fast instead of waiting out its deadline"
  (`createServerRequestHandler.ts:19-26`).
- **Non-obvious:** **a replayed request does not ring the bell again** — `request.replayed` is
  checked before `ringPromptBell()` (`:35-38`).
- **Non-obvious:** the permanent-allow option is dropped **only on an explicit `false`**
  (`allow_permanent !== false`), never by omission (`:79-80`).

#### `ui-tui/src/app/gatewayRecovery.ts`
- **Purpose:** the crash-recovery budget for the gateway exit handler.
- **Key abstractions:** `planGatewayRecovery` (`ui-tui/src/app/gatewayRecovery.ts:24`),
  `GATEWAY_RECOVERY_LIMIT = 3` (`:7`), `GATEWAY_RECOVERY_WINDOW_MS = 60_000` (`:8`).
- **Stealable:** the function is **pure** (no refs, no UI) precisely so the bound — *including the
  crash-loop case* — is unit-testable (`:1-6`).
- **Stealable:** the **recovery target is carried across a respawn**, so "a startup crash-loop
  keeps retrying the same session up to the budget instead of stranding it after one attempt"
  (`:19-23`, `:30`).
- **Stealable:** attempts outside the sliding window are **pruned**, so recovery re-arms after the
  window (`:31-35`).

#### `ui-tui/src/app/loopStatus.ts` + `ui-tui/src/app/goalStatus.ts`
- **Purpose:** the standing `/loop` and `/goal` controls — the repo's *scheduled-work* surface.
- **Key abstractions:** `$loopSnapshot` / `applyLoopSnapshot` / `loopLine` / `useLoopLine`
  (`ui-tui/src/app/loopStatus.ts:13,15,64,95`); `$goalSnapshot` / `applyGoalSnapshot` / `goalLine`
  (`ui-tui/src/app/goalStatus.ts:10,12,34`).
- **Non-obvious (stealable):** **the countdown is rounded UP and only shows seconds in the last
  minute**, "so a long wait keeps an idle TUI to one repaint a minute" (`loopStatus.ts:36-49`).
- **Non-obvious:** the snapshot's `next_due_at` is the live anchor; the countdown is computed
  client-side, and the gateway publishes on set/pause/resume/stop, on a wakeup firing and on
  completion (`loopStatus.ts:9-11`).
- **Stealable:** the loop line distinguishes **four** states in words, not colour:
  `running now` / `deferred to the goal` / `next in 44m` / `due, waiting for idle`
  (`loopStatus.ts:79-88`).
- **Stealable:** `useLoopLine` re-derives every second but **returns the previous object when the
  rendered line is unchanged**, so React drops the identical string and the bar repaints at minute
  steps, not per second (`loopStatus.ts:92-119`).
- **Stealable:** the goal line shows a **parked** state with its *barrier* spelled out —
  `until 14:30` or `on <type> <target>`, plus the reason (`goalStatus.ts:44-51`).

#### `ui-tui/src/app/pendingBubbles.ts`
- **Purpose:** prevent a duplicate user bubble when a busy-time admission finally starts.
- **Non-obvious (stealable):** a **ledger of already-painted input ids**, and a transition detector
  that only fires for a `queued → started` move *observed by this client* — "a resume snapshot's
  started row already lives in the replayed history"
  (`ui-tui/src/app/pendingBubbles.ts:13-21`).

#### `ui-tui/src/app/spawnHistoryStore.ts`
- **Purpose:** an in-memory ring of finished fan-outs so `/replay` can show what a subagent run did.
- **Non-obvious (stealable):** the store keeps **only non-empty snapshots** (a turn with no
  subagents is dropped) and the last 10 (`ui-tui/src/app/spawnHistoryStore.ts:55-71`).
- **Stealable:** the comment states the *reason for the scope* — "the primary investigation loop is
  'I just ran a fan-out, it misbehaved, let me look at what happened' — same-session debugging.
  Disk persistence across process restarts is a natural extension but adds RPC surface for a
  less-common path" (`:59-62`).
- **Stealable:** disk-loaded snapshots are **defensively normalised** into the same shape as live
  data, "defensive against cross-version reads", including an unknown status falling back to
  `completed` (`:104-152`).

#### `ui-tui/src/app/submissionDestination.ts`
- **Purpose:** capture *where* a submission is going, so a late reply can be matched to its owner.
- **Non-obvious (stealable):** the profile home is **canonicalised through `realpathSync`, resolving
  existing ancestors too** — "a new profile may not have been created yet"
  (`ui-tui/src/app/submissionDestination.ts:16-29`).
- **Non-obvious:** the **owner home is not the local home** when an explicit
  `HERMES_TUI_GATEWAY_URL` serves another machine: "its receipts name the owner's profile_id (from
  the session snapshot), not this client's HERMES_HOME" (`:36-39`).

#### `ui-tui/src/app/agentRoster.ts` + `ui-tui/src/lib/subagentTree.ts`
- **Purpose:** merge the live event stream with the server's roster snapshot and rebuild the spawn
  tree.
- **Non-obvious (stealable):** the merge **never rolls event progress back**: "Snapshot replies may
  predate progress/completion events already rendered" (`ui-tui/src/app/agentRoster.ts:102-104`).
- **Non-obvious:** **async records are completion units, not agents** — "Independent completions can
  give them different IDs from the actual children; never invent extra rows" (`agentRoster.ts:109-111`).
- **Non-obvious:** in `subagentTree.ts` a missing `parentId` (or one pointing at an unknown
  subagent) is treated as a **top-level spawn of the current turn**
  (`ui-tui/src/lib/subagentTree.ts:3-5`).

#### `ui-tui/src/app/clarifyTranscript.ts`
- **Purpose:** the transcript a settled clarify leaves behind.
- **Stealable:** one pure function produces **both** the collapsed tool row and the user bubble, so
  "the canonical one-card path and the batch path both settle through this"
  (`ui-tui/src/app/clarifyTranscript.ts:13-16`); a blank answer renders as *skipped* rather than
  an empty line (`:22`).

#### `ui-tui/src/app/useLongRunToolCharms.ts`
- **Purpose:** ambient activity messages for tools that run long.
- **Stealable:** the cadence is **bounded twice** — nothing before 8 s, then at most 2 messages per
  tool at 10 s intervals (`ui-tui/src/app/useLongRunToolCharms.ts:10-12`, `:46-60`).
- **Stealable:** the slot map is **pruned of tools that are no longer live** each tick, so a
  finished tool stops emitting (`:38-44`).

#### `ui-tui/packages/hermes-ink/src/ink/dom.ts`
- **Purpose:** the Ink fork's mini-DOM — node creation, mutation, dirty tracking, text measurement.
- **Key abstractions:** `DOMElement` (with `yogaNode`, `style`, `textStyles`, `dirty`, `scrollTop`,
  `pendingScrollDelta`, `scrollClampMin/Max`, `scrollAnchor`, `_textMeasureCache`),
  `createNode`, `appendChildNode`, `insertBeforeNode`, `removeChildNode`, `setAttribute`,
  `setStyle`, `markDirty`, `scheduleRenderFrom`.
- **Non-obvious:** `setAttribute` **skips the `children` key**
  (`ui-tui/packages/hermes-ink/src/ink/dom.ts:229-235`) because React passes a new children
  reference every render, which would mark the whole tree dirty every frame; `setStyle` and
  `setTextStyles` compare by value for the same reason (`:246-268`).
- **Non-obvious:** `ink-link`, `ink-progress` and `ink-virtual-text` have **no yoga node**
  (`:107`), so `insertBeforeNode` must translate a DOM index into a yoga index by counting children
  that *do* have yoga nodes (`:153-165`).
- **Edge case:** the text measure cache is **generation-invalidated** (`:437-440`) and FIFO-capped
  at 16 entries "to avoid unbounded growth during pathological frames where yoga probes many
  widths" (`:343-351`).
- **Edge case:** text with embedded newlines is **not** re-wrapped when yoga asks for an intrinsic
  size but **is** measured at the constraint width — otherwise layout height and rendered line
  count disagree and content is truncated (`:385-397`).

#### `ui-tui/packages/hermes-ink/src/ink/optimizer.ts`
- **Purpose:** reduce a frame's diff to the minimum number of terminal patches.
- **Rules:** drop empty stdout patches; merge consecutive `cursorMove`; drop `(0,0)` moves; collapse
  consecutive `cursorTo` to the last; **concat adjacent `styleStr` patches**; dedupe identical
  hyperlinks; **cancel a `cursorHide`/`cursorShow` pair**; drop `clear` with count 0.
- **Non-obvious (load-bearing):** adjacent style patches are *concatenated* and not deduplicated:
  `styleStr` is a **transition diff**, not a setter — dropping the first is only sound if its
  undo-codes are a subset of the second's, which is **not guaranteed**; e.g. `[\e[49m, \e[2m]`
  dropping the bg reset leaks it into the next `\e[2J` via BCE
  (`ui-tui/packages/hermes-ink/src/ink/optimizer.ts:74-78`).

#### `ui-tui/packages/hermes-ink/src/ink/ansi-transition.ts`
- **Purpose:** a corrected replacement for `diffAnsiCodes` for the bold/dim SGR family.
- **The bug it fixes (stealable):** bold (SGR 1) and dim (SGR 2) are **independent attributes that
  share one reset code (SGR 22)**, but `diffAnsiCodes` models "same endCode" as "same slot, new
  start code overwrites" — true for fg/bg, false here
  (`ui-tui/packages/hermes-ink/src/ink/ansi-transition.ts:3-14`). Emitting `[2m` over a bold cell
  yields **bold+dim**, and because later transitions are computed from the tracked state, the
  corruption compounds and sticks.
- **The fix:** when the transition must *remove* a weight flag, emit `SGR 22` (which clears both)
  and re-apply every weight-carrying sequence in the target style (`:94-104`).
- **Non-obvious:** the detector parses the SGR *parameters* rather than matching code strings,
  because real tool output emits compound sequences like `[1;31m` whose `endCode` is `[0m`, dodging
  any endCode check (`:16-20`), and because extended-colour sub-parameters (`38;2;r;g;b`) contain
  a literal `2`/`5` that are not SGR atoms (`:47-52`).

#### `ui-tui/packages/hermes-ink/src/ink/stringWidth.ts` + `wrap-text.ts` + `utils/sliceAnsi.ts`
- **Purpose:** terminal display width, wrapping, and ANSI-aware slicing — the three hottest
  functions in the renderer.
- **Key decision:** a hand-written `stringWidth` fallback because the `string-width` package
  "incorrectly reports as width 2" for characters like `⚠` (U+26A0)
  (`ui-tui/packages/hermes-ink/src/ink/stringWidth.ts:20-28`); ambiguous-width characters are
  **narrow** "as recommended by the Unicode standard for Western contexts".
- **Non-obvious:** complex-script graphemes like Devanagari `क्ष` render as one ligature but occupy
  **2 terminal cells**; Bun's `stringWidth` matches cell allocation, while the JS fallback's
  grapheme-cluster width of 1 "would desync Ink's layout from the terminal"
  (`stringWidth.ts:244-252`).
- **Performance:** `stringWidth` is ~100k calls/frame; a **global 8192-entry LRU** memoises it, and
  **pure-ASCII strings ≤64 chars skip the cache** because the inline loop beats a `Map.get`
  (`stringWidth.ts:257-300`). `wrap-ansi` → `string-width` was **30% of total runtime during fast
  scroll**, so the wrap result is memoised on `(text, maxWidth, wrapType)` in a 4096-entry LRU
  (`wrap-text.ts:5-11`). `sliceAnsi` carries its own 4096-entry LRU because it was **18% of total
  time during scroll** (`utils/sliceAnsi.ts:17-24`).
- **Stealable:** **one eviction entry point for four caches** — `evictInkCaches('all'|'half')` — with
  the reason stated: "All caches are content-keyed (not session-keyed), so cross-session sharing is
  normally beneficial — only evict when memory tightens or when the user explicitly resets"
  (`ui-tui/packages/hermes-ink/src/ink/cache-eviction.ts:1-12`).

#### `ui-tui/packages/hermes-ink/src/ink/colorize.ts`
- **Purpose:** turn a `Color` value into ANSI, with three terminal-capability clamps.
- **Stealable:** (1) `TERM_PROGRAM=vscode` + chalk level 2 → **boost to level 3**, because chalk's
  `supports-color` does not recognise VS Code and code-server containers drop truecolor to
  washed-out salmon (`ui-tui/packages/hermes-ink/src/ink/colorize.ts:5-29`); (2) `$TMUX` → **clamp
  to level 2**, because tmux only re-emits truecolor when the outer terminal advertises `Tc` via
  `terminal-overrides`; the default config does not, so the background sequence is lost and the
  cell renders black-on-dark (`:70-97`); (3) Apple Terminal without `COLORTERM`/`FORCE_COLOR` →
  **rich 8-bit downgrade**, implemented as an explicit RGB→xterm-256 conversion
  (`richEightBitColorNumber`) rather than a library call (`:31-68`).
- **Stealable:** **the order matters** — boost first, then tmux may clamp RGB back down, and the
  decision is made **once at module load** because the terminal environment does not change
  mid-session (`:99-104`).

#### `ui-tui/packages/hermes-ink/src/ink/focus.ts` + `hit-test.ts` + `events/dispatcher.ts`
- **Purpose:** a DOM-like focus manager, hit testing, and capture/bubble dispatch.
- **Stealable:** the focus **stack** restores focus to the most recent still-mounted element when
  the focused node is removed, and the stack is **deduplicated and capped at 32** so Tab cycling
  cannot grow it without bound (`ui-tui/packages/hermes-ink/src/ink/focus.ts:36-49`, `:72-101`).
- **Stealable:** focus lives on the **root** node, so any node reaches it by walking `parentNode` —
  "like browser's `node.ownerDocument`" (`focus.ts:10-13`, `:195-218`).
- **Stealable:** the hit test uses the **screen-space rects the renderer already computed**
  (`nodeCache`), not yoga coordinates, so scroll offsets are already applied
  (`ui-tui/packages/hermes-ink/src/ink/hit-test.ts:37-44`); children are traversed in **reverse**
  so later siblings win (`:62-76`); and **absolute-positioned descendants are searched even when
  the parent does not contain the point** (`:7-36`) — overlays live outside their parent's box.
- **Stealable:** the dispatcher uses react-dom's **two-phase accumulation** — capture handlers
  `unshift`ed (root-first), bubble handlers `push`ed (target-first)
  (`ui-tui/packages/hermes-ink/src/ink/events/dispatcher.ts:47-88`); event → React priority mirrors
  react-dom's `getEventPriority()` (`:124-153`); and a handler that throws is **caught per
  handler** so one bad listener cannot kill the dispatch (`:112-117`).

#### `ui-tui/packages/hermes-ink/src/ink/events/input-event.ts` + `hooks/use-input.ts`
- **Purpose:** turn a parsed keypress into the `Key` vocabulary the app sees, and route it.
- **Stealable (stealable bug class):** **a ctrl chord is never typed text.** `isControlChord` marks
  any `ctrl` keypress that is not a paste
  (`ui-tui/packages/hermes-ink/src/ink/events/input-event.ts:187-189`) because the dashboard writes
  the PTY force-redraw byte `Ctrl+L` (0x0c) into the TUI's stdin on every re-attach, which "typed a
  solitary `l` into the composer after a session resume / tab switch / window restore"
  (`input-event.ts:175-186`). Bracketed pastes are text even when a control byte rides inside them.
- **Stealable:** raw mode is enabled in a **`useLayoutEffect`, not `useEffect`**, so the terminal is
  raw *synchronously during React's commit phase* — with `useEffect` "keystrokes echo and the cursor
  is visible until the effect fires"
  (`ui-tui/packages/hermes-ink/src/ink/hooks/use-input.ts:47-52`); the listener **slot** is
  registered once on mount and `isActive` is read through `useEventCallback`, because re-appending
  the listener on `false→true` would break `stopImmediatePropagation()` ordering (`:64-70`).

#### `ui-tui/packages/hermes-ink/src/ink/components/Text.tsx` + `styles.ts`
- **Purpose:** the styled-text component and the style → yoga mapping.
- **Stealable:** **bold and dim are mutually exclusive in terminals** — the `Props` type is a union
  that makes `bold` and `dim` mutually exclusive at compile time
  (`ui-tui/packages/hermes-ink/src/ink/components/Text.tsx:50-67`).
- **Stealable:** terminals that ignore SGR 2 (Apple Terminal) get a **literal colour** instead of a
  dim attribute, and that colour is **theme-supplied** via `setDimFallbackColor` so it stays inside
  the active palette — a hardcoded value "reads as an off-palette foreground next to themed spans
  on the same line" (`Text.tsx:87-98`).
- **Stealable:** `applyBorderStyles` needs the **resolved** style, not the diff, because a diff's
  `borderStyle` may not carry unchanged border-side values
  (`ui-tui/packages/hermes-ink/src/ink/styles.ts:688-702`).

#### `ui-tui/packages/hermes-ink/src/utils/execFileNoThrow.ts` + `utils/earlyInput.ts`
- **Purpose:** spawn helpers that never throw, and capture of keystrokes typed before the UI is ready.
- **Stealable:** `resolveOnExit` — resolve when the child *exits* rather than when its stdio
  *closes* — because a tool that forks a daemon and lets the daemon inherit the parent's stdio never
  fires `close`; in that mode stdout/stderr are `'ignore'` so the daemon does not inherit the pipe
  FDs (`ui-tui/packages/hermes-ink/src/utils/execFileNoThrow.ts:6-18`, `:40-43`).
- **Stealable:** a timeout **settles unconditionally** with code 124 even though SIGTERM does not
  guarantee `close`/`exit` — the promise used to leak (`execFileNoThrow.ts:75-90`); a
  signal-terminated child maps to code 1, never 0 (`:97-99`).
- **Stealable:** `Ctrl+C` during early-input capture exits with **130**, the conventional SIGINT
  code (`ui-tui/packages/hermes-ink/src/utils/earlyInput.ts:49-54`); backspace deletes a whole
  **grapheme** (`:56-63`).

#### `ui-tui/packages/hermes-ink/src/ink/frame.ts` + `node-cache.ts` + `hooks/use-terminal-viewport.ts`
- **Purpose:** the frame contract, the layout cache, and viewport visibility.
- **Stealable:** the **frame-timing instrumentation is part of the frame contract**, not a profiler:
  phase breakdown (renderer / diff / optimize / write), pre- and post-optimise patch counts, bytes
  written, backpressure flag, drain latency, and **yoga node liveness** ("Growth = leak")
  (`ui-tui/packages/hermes-ink/src/ink/frame.ts:37-69`).
- **Stealable:** `shouldClearScreen` returns a **reason** (`'resize' | 'offscreen' | 'clear'`) rather
  than a boolean, so the flicker can be explained and logged (`frame.ts:98-124`).
- **Stealable:** the layout cache holds a **flag for "an absolute-positioned node was removed"**,
  which disables the blit optimisation for the next frame — the removed node may have painted over
  non-siblings and their blits from `prevScreen` would restore the overlay's pixels
  (`ui-tui/packages/hermes-ink/src/ink/node-cache.ts:24-49`).
- **Stealable:** the viewport hook **never calls `setState`** — it updates a ref during
  `useLayoutEffect` to "avoid infinite update loops when combined with other layout effects that
  also call setState" (`ui-tui/packages/hermes-ink/src/ink/hooks/use-terminal-viewport.ts:17-24`),
  and it **subtracts each scroll container's `scrollTop`** because yoga ignores scroll offset
  (`:55-78`).

#### `ui-tui/packages/hermes-ink/src/ink/searchHighlight.ts` + `hyperlinkHover.ts`
- **Purpose:** post-layout screen-buffer overlays.
- **Stealable:** highlighting is done by **inverting the cell's style in the screen buffer**
  *after* layout — the diff engine then sees it as an ordinary change and LogUpdate stays a pure
  diff engine (`ui-tui/packages/hermes-ink/src/ink/searchHighlight.ts:3-10`).
- **Stealable:** the search builds a **per-row code-unit → cell index map** because with wide
  characters the Nth character is not at column N, and it lowercases **per character** because
  Turkish `İ` lowercases to two code units and lowering the joined string would desync the `indexOf`
  positions from the map (`:36-48`).
- **Stealable:** the **hover affordance** for OSC 8 links inverts the link's cells, because a
  terminal app cannot change the system mouse cursor
  (`ui-tui/packages/hermes-ink/src/ink/hyperlinkHover.ts:3-12`); and the caller forces full-frame
  damage only on **enter/leave/change transitions**, not on every steady-state frame (`:12-15`).

#### `ui-tui/packages/hermes-ink/src/ink/ink.tsx` (structural read, 282 KB)
- **Purpose:** the renderer instance — the class that owns the screen buffers, the frame loop, the
  terminal-mode lifecycle and the exit path.
- **Stealable (backpressure):** when the previous frame's `stdout.write` has not drained, the
  renderer **coalesces** the frame and retries on the drain tick, because "piling another write on
  the backed-up pipe … keeps the macrotask queue hot, which is what starves the stdin 'readable'
  callback and wedges input". A ceiling of 10 coalesced frames guarantees forward progress so a
  terminal whose drain callback never fires "self-heals once the pipe recovers instead of
  coalescing forever" (`ui-tui/packages/hermes-ink/src/ink/ink.tsx:778-806`).
- **Stealable:** the **alt-screen cursor anchor.** All cursor moves in log-update are *relative* to
  `prev.cursor`; if tmux (or any emulator) perturbs the physical cursor out of band, "the relative
  moves drift and content creeps up 1 row/frame". `CSI H` before every alt-screen frame resets the
  basis — "self-healing against any external cursor manipulation" (`:989-1007`).
- **Stealable:** the **damage model** — a full-screen damage backstop fires when the layout
  actually *shifted* (`didLayoutShift()`), when a selection/highlight overlay is active, or when
  the previous frame was contaminated; steady-state frames (spinner rotate, clock tick) compare
  only the damaged region (`:904-980`).
- **Stealable:** the **exit path is explicit and ordered** — exit alt screen FIRST so the remaining
  cleanup sequences land on the main screen; then disable mouse tracking, drain stdin, disable
  extended key reporting, disable focus events, disable bracketed paste, show the cursor, clear
  the iTerm2 progress bar and the OSC 21337 tab dot (`:2528-2570`).
- **Stealable:** **`process.stderr.write` is intercepted** so stray writes from third-party deps
  cannot corrupt the alt-screen buffer; the write is swallowed to the debug log and a full-damage
  repaint is forced (`:2675-2731`).
- **Stealable:** `drainStdin` opens `/dev/tty` with `O_NONBLOCK` (termios is not fcntl, so
  `readSync` on the stdin fd would hang) and briefly re-enters raw mode so canonical-mode
  line-buffering does not hide partial input; the read loop is bounded at 64 iterations
  (`:2738-2829`).

#### `ui-tui/packages/hermes-ink/src/ink/components/App.tsx` (structural read, 111 KB)
- **Purpose:** the reconciler host component — stdin handling, raw mode, mouse decoding, the
  stdin-gap watchdog and the terminal-mode re-assert.
- **Stealable:** the **stdin-gap watchdog**. After N ms of stdin silence the next chunk triggers a
  terminal-mode re-assert, "Catches tmux detach→attach" (`:26-28`).
- **Stealable:** the **mouse-mode watchdog** queries `DECRQM` for mode 1000 on an interval and
  re-asserts tracking when the terminal reports RESET; it **disables itself permanently** when the
  terminal ignores DECRQM (`ui-tui/src/__tests__/app-mouse-watchdog.test.ts:1-4`).
- **Stealable:** the **raw-mode teardown contract** — when the *last* `useInput` consumer detaches,
  the app must DISABLE mouse tracking, "so DEC 1003 hover can't [survive into the shell]"
  (`ui-tui/src/__tests__/app-rawmode-mouse.test.ts:1-4`).

#### `ui-tui/src/app/useConfigSync.ts`, `useSessionLifecycle.ts`, `useInputHandlers.ts`,
`useMainApp.ts`, `createGatewayEventHandler.ts`, `useSubmission.ts` (structural reads)
- **Purpose:** the top-level composition hooks and the gateway event mapper.
- **Stealable:** `useConfigSync` **polls the config mtime every 5 s** and applies display settings
  and triggers an MCP reload on change (`ui-tui/README.md`, "App model" section) — a config-poll
  loop rather than a config-push channel.
- **Stealable:** the **Ctrl+C ladder** is a pure function: clear → interrupt → exit, in that order,
  and **a non-empty composer always wins** — "mid-stream, the chord used to interrupt the turn even
  when the user was trying to dump a draft"
  (`ui-tui/src/app/useInputHandlers.ts:1-4`).
- **Stealable:** the status-bar clock is **only armed when nothing occludes the rule**, and the
  gate is documented per-overlay so no timer churns behind a hidden panel
  (`ui-tui/src/__tests__/appChromeBlockedTimers.test.tsx:1-3`).
- **Stealable:** `mergeUsageStable` returns the **prior object reference** when a patch changes
  nothing — "an unchanged-value patch must NOT mint a new object, or every `$uiState` subscriber
  re-renders per streaming delta" (`ui-tui/src/__tests__/mergeUsageStable.test.ts:1-4`).

### Tier 2 — bulk: a compact table

Every file in the shard appears exactly once below. Rows for files that received a Tier-1 entry
above are listed here too, so this table is the complete ledger.

| File | What it is / what it pins |
| --- | --- |
| `ui-tui/.gitignore` | Configuration/module file; no exported symbols detected. |
| `ui-tui/CANONICAL_GATEWAY.md` | The canonical local-gateway connection design: tickets, epochs, the input journal, capability gates, native probes. |
| `ui-tui/README.md` | The TUI contract: transport, hotkey table, prompt flows, event surface, file map. |
| `ui-tui/eslint.config.mjs` | Configuration/module file; no exported symbols detected. |
| `ui-tui/package.json` | Configuration/module file; no exported symbols detected. |
| `ui-tui/packages/hermes-ink/ambient.d.ts` | / <reference types="react" /> |
| `ui-tui/packages/hermes-ink/index.d.ts` | / <reference path="./ambient.d.ts" /> 'ink-text-input' types deliberately not re-exported here; see |
| `ui-tui/packages/hermes-ink/index.js` | Configuration/module file; no exported symbols detected. |
| `ui-tui/packages/hermes-ink/package.json` | Configuration/module file; no exported symbols detected. |
| `ui-tui/packages/hermes-ink/src/bootstrap/state.ts` | Exports function, function, function, function. |
| `ui-tui/packages/hermes-ink/src/entry-exports.ts` | NOTE: Do not re-export from 'ink-text-input' here.  |
| `ui-tui/packages/hermes-ink/src/hooks/use-stderr.ts` | Exports type, function. |
| `ui-tui/packages/hermes-ink/src/hooks/use-stdout.ts` | Exports type, function. |
| `ui-tui/packages/hermes-ink/src/ink/Ansi.tsx` | Component that parses ANSI escape codes and renders them using Text components. Use this as an escape hatch when you have pre-formatted ANSI strings from |
| `ui-tui/packages/hermes-ink/src/ink/absolute-in-zero-height-box.test.tsx` | Pins: 'absolute children of a zero-height box' |
| `ui-tui/packages/hermes-ink/src/ink/ansi-transition.test.ts` | Pins: 'transitionAnsiCodes weight family' / 'StylePool.transition weight correctness' |
| `ui-tui/packages/hermes-ink/src/ink/ansi-transition.ts` | Bold (SGR 1) and dim (SGR 2) are INDEPENDENT terminal attributes that share one reset code (SGR 22). `diffAnsiCodes` models "same endCode" as "same |
| `ui-tui/packages/hermes-ink/src/ink/app-mouse-watchdog.test.ts` | Pins: 'App mouse-mode watchdog' |
| `ui-tui/packages/hermes-ink/src/ink/app-mouse.test.ts` | Pins: 'handleMouseEvent right-click selection behavior' |
| `ui-tui/packages/hermes-ink/src/ink/app-rawmode-mouse.test.ts` | Pins: 'App raw-mode teardown' |
| `ui-tui/packages/hermes-ink/src/ink/app-stdin-recovery.test.ts` | Pins: 'App.handleReadable error recovery (issue #31486)' |
| `ui-tui/packages/hermes-ink/src/ink/bidi.ts` | Bidirectional text reordering for terminal rendering. Terminals on Windows do not implement the Unicode Bidi Algorithm, |
| `ui-tui/packages/hermes-ink/src/ink/cache-eviction.ts` | Unified cache eviction for the four hot Ink module-level caches: - widthCache       (stringWidth.ts) |
| `ui-tui/packages/hermes-ink/src/ink/clearTerminal.ts` | Cross-platform terminal clearing with scrollback support. Detects modern terminals that support ESC[3J for clearing scrollback. |
| `ui-tui/packages/hermes-ink/src/ink/colorize.test.ts` | Pins: 'shouldUseRichEightBitDowngradeForLegacyAppleTerminal' / 'richEightBitColorNumber' |
| `ui-tui/packages/hermes-ink/src/ink/colorize.ts` | xterm.js (VS Code, Cursor, code-server, Coder) has supported truecolor since 2017, but code-server/Coder containers often don't set |
| `ui-tui/packages/hermes-ink/src/ink/components/AlternateScreen.tsx` | Alt-screen component: enters/exits the alt buffer and resets every mouse mode before enabling the requested preset. |
| `ui-tui/packages/hermes-ink/src/ink/components/App.focus.test.tsx` | Pins: 'App terminal focus events' |
| `ui-tui/packages/hermes-ink/src/ink/components/App.tsx` | Reconciler host: stdin handling, raw-mode teardown, mouse decoding, stdin-gap + mouse-mode watchdogs. (structural) |
| `ui-tui/packages/hermes-ink/src/ink/components/AppContext.ts` | Exit (unmount) the whole Ink app. `AppContext` is a React context, which exposes a method to manually exit the app (unmount). |
| `ui-tui/packages/hermes-ink/src/ink/components/Box.tsx` | Tab order index. Nodes with `tabIndex >= 0` participate in Tab/Shift+Tab cycling; `-1` means programmatically focusable only. |
| `ui-tui/packages/hermes-ink/src/ink/components/Button.tsx` | A focusable, activatable button with Tab order, autoFocus and the button state vocabulary. |
| `ui-tui/packages/hermes-ink/src/ink/components/ClockContext.tsx` | The single shared clock: tick snapshot, keepAlive subscribers, paused vs synchronised time. |
| `ui-tui/packages/hermes-ink/src/ink/components/CursorAdvanceContext.ts` | Notify Ink that the physical terminal cursor was advanced by an out-of-band stdout.write (e.g. the TextInput fast-echo path). |
| `ui-tui/packages/hermes-ink/src/ink/components/CursorDeclarationContext.ts` | Setter for the declared cursor position. The optional second argument makes `null` a conditional clear: the |
| `ui-tui/packages/hermes-ink/src/ink/components/ErrorOverview.tsx` | Renders an error with its source-frame context, stripping the file:// cwd prefix. |
| `ui-tui/packages/hermes-ink/src/ink/components/Link.tsx` | Kept for backwards-compat: prior versions rendered `fallback` instead of the linked content on terminals where supportsHyperlinks() was false. We |
| `ui-tui/packages/hermes-ink/src/ink/components/Newline.tsx` | Number of newlines to insert. Adds one or more newline (\n) characters. Must be used within <Text> components. |
| `ui-tui/packages/hermes-ink/src/ink/components/NoSelect.tsx` | Marks a box as excluded from text selection (gutters), with the from-left-edge variant. |
| `ui-tui/packages/hermes-ink/src/ink/components/RawAnsi.tsx` | Pre-rendered ANSI lines, bypassing the Ansi->React->Yoga->squash roundtrip. |
| `ui-tui/packages/hermes-ink/src/ink/components/ScrollBox.tsx` | Virtualised scroll container: scrollTop/pendingScrollDelta, sticky bottom-follow, imperative scrollToElement anchor. |
| `ui-tui/packages/hermes-ink/src/ink/components/Spacer.tsx` | A flexible space that expands along the major axis of its containing layout. It's useful as a shortcut for filling all the available spaces between elements. |
| `ui-tui/packages/hermes-ink/src/ink/components/StdinContext.ts` | Exports type. |
| `ui-tui/packages/hermes-ink/src/ink/components/TerminalFocusContext.tsx` | Publishes DECSET 1004 focus state to React without re-rendering App. |
| `ui-tui/packages/hermes-ink/src/ink/components/TerminalSizeContext.tsx` | # sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmVhdGVDb250ZXh0IiwiVGVybWluYWxTaXplIiwiY29sdW1ucyIsInJv… |
| `ui-tui/packages/hermes-ink/src/ink/components/Text.test.ts` | Pins: 'shouldUseAnsiDim' / 'dimColorFallback' |
| `ui-tui/packages/hermes-ink/src/ink/components/Text.tsx` | Change text color. Accepts a raw color value (rgb, hex, ansi). Same as `color`, but for background. |
| `ui-tui/packages/hermes-ink/src/ink/constants.ts` | Shared frame interval for render throttling and animations (~60fps). Keep clock-driven animations at full speed when terminal focus changes. |
| `ui-tui/packages/hermes-ink/src/ink/cursor.ts` | Exports type. |
| `ui-tui/packages/hermes-ink/src/ink/devtools.ts` | Exports . |
| `ui-tui/packages/hermes-ink/src/ink/dom.ts` | Internal properties Used to skip empty renders during React 19's effect double-invoke in test mode |
| `ui-tui/packages/hermes-ink/src/ink/events/click-event.ts` | Mouse click event. Fired on left-button release without drag, only when mouse tracking is enabled (i.e. inside <AlternateScreen>). |
| `ui-tui/packages/hermes-ink/src/ink/events/cmd-shortcuts.test.ts` | Pins: 'enhanced keyboard modifier parsing' |
| `ui-tui/packages/hermes-ink/src/ink/events/dispatcher.ts` | -- Collect all listeners for an event in dispatch order. |
| `ui-tui/packages/hermes-ink/src/ink/events/emitter.ts` | Similar to node's builtin EventEmitter, but is also aware of our `Event` class, and so `emit` respects `stopImmediatePropagation()`. |
| `ui-tui/packages/hermes-ink/src/ink/events/event-handlers.ts` | Props for event handlers on Box and other host components. Follows the React/DOM naming convention: |
| `ui-tui/packages/hermes-ink/src/ink/events/event.ts` | Exports class. |
| `ui-tui/packages/hermes-ink/src/ink/events/focus-event.ts` | Focus event for component focus changes. Dispatched when focus moves between elements. 'focus' fires on the |
| `ui-tui/packages/hermes-ink/src/ink/events/input-event-control-chord.test.ts` | Pins: 'ctrl chords are bindable but never typed text (#115284)' |
| `ui-tui/packages/hermes-ink/src/ink/events/input-event.ts` | Extended-key protocols (CSI u / xterm modifyOtherKeys) report printable letters as their lowercase keycode, so Shift+R arrives as name 'r' with |
| `ui-tui/packages/hermes-ink/src/ink/events/keyboard-event.ts` | Keyboard event dispatched through the DOM tree via capture/bubble. Follows browser KeyboardEvent semantics: `key` is the literal character |
| `ui-tui/packages/hermes-ink/src/ink/events/mouse-event.ts` | Exports class. |
| `ui-tui/packages/hermes-ink/src/ink/events/paste-event.ts` | Exports class. |
| `ui-tui/packages/hermes-ink/src/ink/events/resize-event.ts` | Exports class. |
| `ui-tui/packages/hermes-ink/src/ink/events/terminal-event.ts` | Base class for all terminal events with DOM-style propagation. Extends Event so existing event types (ClickEvent, InputEvent, |
| `ui-tui/packages/hermes-ink/src/ink/events/terminal-focus-event.ts` | Event fired when the terminal window gains or loses focus. Uses DECSET 1004 focus reporting - the terminal sends: |
| `ui-tui/packages/hermes-ink/src/ink/focus.ts` | DOM-like focus manager for the Ink terminal UI. Pure state — tracks activeElement and a focus stack. Has no reference |
| `ui-tui/packages/hermes-ink/src/ink/frame.ts` |  has frame-timing instrumentation enabled (via onFrame wiring). */ Populated by log-update when a scrollback diff triggers the reset. |
| `ui-tui/packages/hermes-ink/src/ink/get-max-width.ts` | Returns the yoga node's content width (computed width minus padding and border). |
| `ui-tui/packages/hermes-ink/src/ink/global.d.ts` | Exports . |
| `ui-tui/packages/hermes-ink/src/ink/hit-test.test.ts` | Pins: 'hit-test' |
| `ui-tui/packages/hermes-ink/src/ink/hit-test.ts` | Find the deepest DOM element whose rendered rect contains (col, row). Uses the nodeCache populated by renderNodeToOutput — rects are in screen |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-animation-frame.ts` | Hook for synchronized animations that pause when offscreen. Returns a ref to attach to the animated element and the current animation time. |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-app.ts` | `useApp` is a React hook, which exposes a method to manually exit the app (unmount). |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-cursor-advance.ts` | Returns a function that notifies Ink the physical terminal cursor was advanced out-of-band (e.g. by a direct stdout.write from the |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-declared-cursor.ts` | Declares where the terminal cursor should be parked after each frame. Terminal emulators render IME preedit text at the physical cursor |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-external-process.ts` | Exports type, function, function. |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-input.ts` | Enable or disable capturing of user input. Useful when there are multiple useInput hooks used at once to avoid handling the same input several times. |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-interval.ts` | Returns the clock time, updating at the given interval. Subscribes as non-keepAlive — won't keep the clock alive on its own, |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-search-highlight.ts` | Set the search highlight query on the Ink instance. Non-empty → all visible occurrences are inverted on the next frame (SGR 7, screen-buffer |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-selection.ts` | Access to text selection operations on the Ink instance (fullscreen only). Returns no-op functions when fullscreen mode is disabled. |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-stdin.ts` | `useStdin` is a React hook, which exposes stdin stream. |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-tab-status.ts` | Per the OSC 21337 usage guide's suggested mapping. Declaratively set the tab-status indicator (OSC 21337). |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-terminal-focus.ts` | Hook to check if the terminal has focus. Uses DECSET 1004 focus reporting - the terminal sends escape sequences |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-terminal-title.ts` | Declaratively set the terminal tab/window title. Pass a single string to set both the tab and window title (OSC 0). |
| `ui-tui/packages/hermes-ink/src/ink/hooks/use-terminal-viewport.ts` | Whether the element is currently within the terminal viewport Hook to detect if a component is within the terminal viewport. |
| `ui-tui/packages/hermes-ink/src/ink/hyperlinkHover.ts` | Highlight every cell whose OSC 8 hyperlink matches `hoveredUrl` by inverting its style. This is the cursor-hover affordance for clickable links: terminal |
| `ui-tui/packages/hermes-ink/src/ink/ink-backpressure.test.ts` | Pins: 'Ink stdout backpressure coalescing (issue #31486)' |
| `ui-tui/packages/hermes-ink/src/ink/ink-cursor-advance.test.ts` | Pins: 'Ink.noteExternalCursorAdvance' |
| `ui-tui/packages/hermes-ink/src/ink/ink-focus-redraw.test.ts` | Pins: cases / 'Ink focus recovery — alt screen modes' |
| `ui-tui/packages/hermes-ink/src/ink/ink-resize.test.ts` | Pins: 'Ink resize healing' |
| `ui-tui/packages/hermes-ink/src/ink/ink.tsx` | The renderer instance: screen buffers, frame loop, backpressure coalescing, terminal-mode lifecycle, ordered exit path, stderr interception, stdin drain. (structural) |
| `ui-tui/packages/hermes-ink/src/ink/instances.ts` | Store all instances of Ink (instance.js) to ensure that consecutive render() calls use the same instance of Ink and don't create a new one |
| `ui-tui/packages/hermes-ink/src/ink/layout/engine.ts` | Exports function. |
| `ui-tui/packages/hermes-ink/src/ink/layout/geometry.ts` | Exports type, type, type, type, function, function. |
| `ui-tui/packages/hermes-ink/src/ink/layout/node.ts` | -- Adapter interface for the layout engine (Yoga) |
| `ui-tui/packages/hermes-ink/src/ink/layout/yoga.ts` | -- Edge/Gutter mapping |
| `ui-tui/packages/hermes-ink/src/ink/line-width-cache.ts` | During streaming, text grows but completed lines are immutable. Caching stringWidth per-line avoids re-measuring hundreds of |
| `ui-tui/packages/hermes-ink/src/ink/log-update.test.ts` | Pins: 'LogUpdate.render diff contract' |
| `ui-tui/packages/hermes-ink/src/ink/log-update.ts` | The diff engine: screen -> Patch[] -> ANSI, with the scrollback/full-reset rules for main-screen output. |
| `ui-tui/packages/hermes-ink/src/ink/lru.ts` | Shared eviction for the hot Ink LRU caches (widthCache, wrapCache, sliceCache, lineWidthCache). Hot-path touch-on-read stays inlined per |
| `ui-tui/packages/hermes-ink/src/ink/measure-element.ts` | Element width. Element height. |
| `ui-tui/packages/hermes-ink/src/ink/measure-text.ts` | Single-pass measurement: computes both width and height in one iteration instead of two (widestLine + countVisualLines). |
| `ui-tui/packages/hermes-ink/src/ink/node-cache.ts` | Cached layout bounds for each rendered node (used for blit + clearing). `top` is the yoga-local getComputedTop() — stored so ScrollBox viewport |
| `ui-tui/packages/hermes-ink/src/ink/optimizer.ts` | Optimize a diff by applying all optimization rules in a single pass. This reduces the number of patches that need to be written to the terminal. |
| `ui-tui/packages/hermes-ink/src/ink/osc-response-chain.test.ts` | Pins: 'OSC 11 reply chain' |
| `ui-tui/packages/hermes-ink/src/ink/output.ts` | DOM -> output operation list; per-line ClusteredChar cache so the hot loop is property reads only. |
| `ui-tui/packages/hermes-ink/src/ink/parse-keypress-drop-probe.test.ts` | Pins: 'parser does not silently drop printable codepoints' |
| `ui-tui/packages/hermes-ink/src/ink/parse-keypress-noregress.test.ts` | Pins: 'control-byte split does not touch clean (EVKey-style) input' |
| `ui-tui/packages/hermes-ink/src/ink/parse-keypress.test.ts` | Pins: 'legacy modified return parsing' / 'legacy function-key parsing' |
| `ui-tui/packages/hermes-ink/src/ink/parse-keypress.ts` | Terminal input -> keypresses: kitty CSI-u, xterm modifyOtherKeys, SGR/X10 mouse, bracketed paste, DECRPM/DA1/DA2/OSC/XTVERSION responses. |
| `ui-tui/packages/hermes-ink/src/ink/reconciler.ts` | The react-reconciler host config; owns the Dispatcher, the yoga timers and the profile counters. |
| `ui-tui/packages/hermes-ink/src/ink/render-border.test.ts` | Pins: 'renderBorder viewport parity' |
| `ui-tui/packages/hermes-ink/src/ink/render-border.ts` | Border drawing, including the custom styles and the wide-grapheme slice that sliceAnsi can bisect. |
| `ui-tui/packages/hermes-ink/src/ink/render-node-to-output.ts` | Walks the DOM into screen cells; owns layout-shift detection, scroll hints and the fast-path stats. |
| `ui-tui/packages/hermes-ink/src/ink/render-to-screen.ts` | Renders a subtree to a fresh Screen and scans it for search positions (message-relative, scroll-stable). |
| `ui-tui/packages/hermes-ink/src/ink/renderer.ts` | createRenderer: DOM -> yoga layout -> screen buffer; tracks prev-frame contamination for the blit path. |
| `ui-tui/packages/hermes-ink/src/ink/root.ts` | createRoot/render/renderSync/forceRedraw: the public entry points and the per-stdout instance registry. |
| `ui-tui/packages/hermes-ink/src/ink/screen.ts` | The screen buffer: CharPool/HyperlinkPool/StylePool interning, Cell layout, per-cell damage tracking. |
| `ui-tui/packages/hermes-ink/src/ink/searchHighlight.ts` | Highlight all visible occurrences of `query` in the screen buffer by inverting cell styles (SGR 7). Post-render, same damage-tracking machinery |
| `ui-tui/packages/hermes-ink/src/ink/selection.test.ts` | Pins: 'selection whitespace handling' |
| `ui-tui/packages/hermes-ink/src/ink/selection.ts` | Line-based text selection state in screen coordinates; word/line snap, scroll capture, copy extraction. |
| `ui-tui/packages/hermes-ink/src/ink/squash-text-nodes.ts` | A segment of text with its associated styles. Used for structured rendering without ANSI string transforms. |
| `ui-tui/packages/hermes-ink/src/ink/stringWidth.ts` | Fallback JavaScript implementation of stringWidth when Bun.stringWidth is not available. Get the display width of a string as it would appear in a terminal. |
| `ui-tui/packages/hermes-ink/src/ink/styles.ts` | Structured text styling properties. Used to style text without relying on ANSI string transforms. |
| `ui-tui/packages/hermes-ink/src/ink/supports-hyperlinks.ts` | Additional terminals that support OSC 8 hyperlinks but aren't detected by supports-hyperlinks. Checked against both TERM_PROGRAM and LC_TERMINAL (the latter is preserved inside tmux). |
| `ui-tui/packages/hermes-ink/src/ink/tabstops.ts` | Tab expansion, inspired by Ghostty's Tabstops.zig Uses 8-column intervals (POSIX default, hardcoded in terminals like Ghostty) |
| `ui-tui/packages/hermes-ink/src/ink/terminal-background.test.ts` | Pins: 'parseOscColor' / 'terminal background storage' |
| `ui-tui/packages/hermes-ink/src/ink/terminal-focus-state.ts` | Terminal focus state signal — non-React access to DECSET 1004 focus events. 'unknown' is the default for terminals that don't support focus reporting; |
| `ui-tui/packages/hermes-ink/src/ink/terminal-querier.ts` | Builds and awaits terminal queries (DECRQM/DA1/DA2/kitty/CPR/OSC colour/XTVERSION) on the shared stdin. |
| `ui-tui/packages/hermes-ink/src/ink/terminal.test.ts` | Pins: 'terminal resize quirks' / 'synchronized output detection' |
| `ui-tui/packages/hermes-ink/src/ink/terminal.ts` | Terminal capability detection: OSC 9;4 progress, DEC 2026 synchronised output, xterm.js probe, background/foreground colour capture. |
| `ui-tui/packages/hermes-ink/src/ink/termio.ts` | ANSI Parser Module A semantic ANSI escape sequence parser inspired by ghostty, tmux, and iTerm2. |
| `ui-tui/packages/hermes-ink/src/ink/termio/ansi.ts` | C0 control bytes and escape introducers per ECMA-48. |
| `ui-tui/packages/hermes-ink/src/ink/termio/csi.ts` | CSI constants and generators: cursor, erase, scroll region, bracketed paste, focus, kitty keyboard. |
| `ui-tui/packages/hermes-ink/src/ink/termio/dec.ts` | DEC private modes and the mouse-tracking presets (off/wheel/buttons/all). |
| `ui-tui/packages/hermes-ink/src/ink/termio/esc.ts` | The simple ESC-sequence parser (RIS, DECSC/DECRC, IND/RI/NEL, HTS). |
| `ui-tui/packages/hermes-ink/src/ink/termio/host.ts` | Reads HERMES_PTY_HOST so the TUI knows it is behind the dashboard PTY bridge. |
| `ui-tui/packages/hermes-ink/src/ink/termio/osc.test.ts` | Pins: 'shouldEmitClipboardSequence' / 'supportsOsc52Clipboard' |
| `ui-tui/packages/hermes-ink/src/ink/termio/osc.ts` | OSC layer: OSC 8 links, 10/11 colours, 9;4 progress, 21337 tab status, and the OSC-52 clipboard strategy. |
| `ui-tui/packages/hermes-ink/src/ink/termio/parser.test.ts` | Pins: 'output parser line endings after ESC' |
| `ui-tui/packages/hermes-ink/src/ink/termio/parser.ts` | The semantic ANSI parser: streaming, emits text/segment actions for SGR, cursor, erase, scroll, modes and OSC 8. |
| `ui-tui/packages/hermes-ink/src/ink/termio/sgr.ts` | SGR parameter parser (semicolon and colon forms) applied to a TextStyle. |
| `ui-tui/packages/hermes-ink/src/ink/termio/tokenize.test.ts` | Pins: 'tokenizer escape-sequence boundaries' / 'tokenizer state-aware flush' |
| `ui-tui/packages/hermes-ink/src/ink/termio/tokenize.ts` | The input tokenizer: escape-sequence boundary detection and the one-tick truncation valve. |
| `ui-tui/packages/hermes-ink/src/ink/termio/types.ts` | The semantic action vocabulary the parser emits (colours, styles, cursor/erase/scroll/mode/link/title/tab-status). |
| `ui-tui/packages/hermes-ink/src/ink/useTerminalNotification.ts` | OSC 9;4 progress reporting + the TerminalWriteContext raw-write channel. |
| `ui-tui/packages/hermes-ink/src/ink/warn.ts` | Exports function. |
| `ui-tui/packages/hermes-ink/src/ink/widest-line.ts` | Exports function. |
| `ui-tui/packages/hermes-ink/src/ink/wrap-text.test.ts` | Pins: 'wrapText wrap-trim' |
| `ui-tui/packages/hermes-ink/src/ink/wrap-text.ts` | CPU profile (Apr 2026) showed `wrap-ansi` → `string-width` consuming 30% of total runtime during fast scroll: every layout pass re-wraps every visible |
| `ui-tui/packages/hermes-ink/src/ink/wrapAnsi.ts` | Exports  wrapAnsi . |
| `ui-tui/packages/hermes-ink/src/native-ts/yoga-layout/enums.ts` | The Yoga enum surface (Align, Edge, Gutter, MeasureMode, Overflow, ...). |
| `ui-tui/packages/hermes-ink/src/native-ts/yoga-layout/index.ts` | A pure-TypeScript Yoga port: the flexbox engine behind the whole layout. (structural) |
| `ui-tui/packages/hermes-ink/src/native-ts/yoga-layout/round-layout.test.ts` | Pins: 'incremental layout rounding' |
| `ui-tui/packages/hermes-ink/src/utils/debug.ts` | Exports function. |
| `ui-tui/packages/hermes-ink/src/utils/earlyInput.ts` | Exports function, function, function, function, function, function. |
| `ui-tui/packages/hermes-ink/src/utils/env.ts` | Terminals known to correctly implement OSC 52 clipboard writes (ESC ] 52 ; c ; <b64> BEL/ST — osc() in ink/termio/osc.ts emits BEL |
| `ui-tui/packages/hermes-ink/src/utils/envUtils.ts` | Exports function. |
| `ui-tui/packages/hermes-ink/src/utils/execFileNoThrow.test.ts` | Pins: cases |
| `ui-tui/packages/hermes-ink/src/utils/execFileNoThrow.ts` |  stdio streams to close. Use this for tools that fork a daemon and  let the daemon inherit the parent's stdio (e.g. `wl-copy`): the |
| `ui-tui/packages/hermes-ink/src/utils/fullscreen.ts` | Exports function. |
| `ui-tui/packages/hermes-ink/src/utils/intl.ts` | Exports function, function, function, function, function, function. |
| `ui-tui/packages/hermes-ink/src/utils/log.ts` | Exports function. |
| `ui-tui/packages/hermes-ink/src/utils/semver.ts` | Exports function, function, function, function, function, function. |
| `ui-tui/packages/hermes-ink/src/utils/sliceAnsi.ts` | LRU cache: same (string, start, end) → same output. Output.get() re-emits identical writes every frame for stable transcript content; this avoids |
| `ui-tui/packages/hermes-ink/text-input.d.ts` | Exports  default, UncontrolledTextInput . |
| `ui-tui/packages/hermes-ink/text-input.js` | Exports  default, UncontrolledTextInput . |
| `ui-tui/packages/hermes-ink/tsconfig.json` | Configuration/module file; no exported symbols detected. |
| `ui-tui/scripts/bench-history-scroll.tsx` | A deterministic virtual-history scroll benchmark, written to run identically on base and candidate checkouts. |
| `ui-tui/scripts/bench-native-history.tsx` | Compares the native primary-buffer transcript with the virtualised ScrollBox path. |
| `ui-tui/scripts/bench-streaming-md.tsx` | Benchmarks the streamed-markdown render strategies on a synthetic block-heavy stream. |
| `ui-tui/scripts/billing-fixtures.tsx` | A DEV/REVIEW harness that renders any single overlay state live so it can be screenshotted and UX-reviewed. |
| `ui-tui/scripts/clipboard_image.py` | Reads a clipboard image on the platforms where the Node side cannot. |
| `ui-tui/scripts/gateway_bootstrap.py` | The short Python bootstrap subprocess that connects the TUI to the profile's gateway. |
| `ui-tui/scripts/i18n-export-en.ts` | Exports the bundled English catalogue as a flat {key: template} JSON for translators. |
| `ui-tui/scripts/i18n-keys.ts` | Emits the sorted flat key list the plugin validator checks a language pack against. |
| `ui-tui/scripts/native_canonical_probe.py` | The native canonical probe: real PTY viewers, a loopback model, private HOME/HERMES_HOME, and text/approval/clarify/startup/launcher/stop modes. |
| `ui-tui/scripts/native_stop_probe.py` | The native stop probe: holds the loopback stream before a fixture-owned effect and asserts the real generation-bearing interrupt acknowledgement. |
| `ui-tui/scripts/profile-tui.mjs` | Profiles the TUI render pipeline. |
| `ui-tui/scripts/visual/paths.mjs` | The shared output location for the visual harness, using os.tmpdir() so it works on Windows. |
| `ui-tui/scripts/visual/render.tsx` | Renders real TUI surfaces with ANSI intact across theme x background scenes into an HTML file. |
| `ui-tui/scripts/visual/run.mjs` | The zero-dependency launcher for the visual harness; it sets FORCE_COLOR/COLORTERM itself. |
| `ui-tui/scripts/visual/shot.mjs` | Screenshots the visual harness output with the workspace Electron (offscreen). |
| `ui-tui/src/__tests__/activeSessionSwitcher.test.ts` | Pins: 'session orchestrator helpers' / 'unified Sessions overlay helpers' |
| `ui-tui/src/__tests__/agentControls.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/agentRoster.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/agentsCompact.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/agentsDock.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/agentsHydration.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/appChromeBlockedTimers.test.tsx` | Pins: 'status-chrome timers under an occluding overlay' / 'status-chrome timers track the current overlay model' |
| `ui-tui/src/__tests__/appChromeStatusRule.test.tsx` | Pins: 'StatusRule model label' / 'StatusRule session title' |
| `ui-tui/src/__tests__/approvalAction.test.ts` | Pins: 'approvalAction — pure key dispatch for ApprovalPrompt' |
| `ui-tui/src/__tests__/attachments.test.ts` | Pins: 'expandTokens (what the agent actually receives)' / 'nextImageIndex (user-facing numbering)' |
| `ui-tui/src/__tests__/billingStepUp.test.tsx` | Pins: 'BillingOverlay — step-up screen (Allow Remote Spending)' / 'BillingOverlay — overview (reordered, dollars)' |
| `ui-tui/src/__tests__/blockLayout.test.ts` | Pins: 'messageGroup' / 'hasLeadGap' |
| `ui-tui/src/__tests__/brandingCanonicalSnapshot.test.ts` | Pins: 'banner from a canonical session snapshot' |
| `ui-tui/src/__tests__/brandingMcpCount.test.ts` | Pins: 'branding MCP headline count' |
| `ui-tui/src/__tests__/bundleNoAsyncEsmDeadlock.test.ts` | Pins: 'TUI bundle (issue #31227)' |
| `ui-tui/src/__tests__/busyQueueAdmission.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/canonicalCommandObserve.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalDetachClose.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/canonicalDetachOrdering.test.tsx` | The real owner reuses a token for repeated attaches by the same actor. One row per attach-path pairing; the stale reply lands first in half of them so both |
| `ui-tui/src/__tests__/canonicalDisplayPrefs.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalGateway.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalHistory.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalI18n.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalImages.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalMultipartResumeRows.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalPickerDelete.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/canonicalResumeDisplayProjection.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalRetainedControlRetire.test.ts` | Pins: 'retained canonical controls' |
| `ui-tui/src/__tests__/canonicalRetryValidate.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalSessionControls.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalSessionPicker.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/canonicalSideAgents.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalSidecarSessionVerbs.test.tsx` | Ink verbs that resolve their session_id in the legacy sidecar's own map. On the shared gateway the sidecar never holds the session, so each answered "session not found" (or an empty roster). Every |
| `ui-tui/src/__tests__/canonicalSlashCommands.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalStartupImage.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalStoredPicker.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/canonicalSwitcherClose.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/canonicalTuiOps.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/canonicalUnsupportedCommand.test.ts` | The shared owner's slash.exec runs only its reviewed reads and refuses every other command with `unsupported_command` (gateway/session_commands.py). Every Ink path that forwards a command there |
| `ui-tui/src/__tests__/canonicalUsageTotals.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/charts.test.ts` | Pins: 'chart primitives' |
| `ui-tui/src/__tests__/chatBitsCatalog.test.ts` | Pins: 'chatBits catalog' |
| `ui-tui/src/__tests__/clarifyTranscript.test.ts` | Pins: 'clarifySettledRows' |
| `ui-tui/src/__tests__/clipboard.test.ts` | Pins: 'readClipboardText' / 'isUsableClipboardText' |
| `ui-tui/src/__tests__/coldPendingRenderer.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/completionApply.test.ts` | Pins: 'applyCompletion' / 'completionToApplyOnSubmit' |
| `ui-tui/src/__tests__/composerDestinationRenderer.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/composerFreshnessRenderer.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/composerHighlights.test.ts` | Pins: 'splitComposerHighlights' / 'highlightsStable' |
| `ui-tui/src/__tests__/connectorAccounts.test.ts` | Pins: 'connector account rows' / 'reconnect is offered only as a repair' |
| `ui-tui/src/__tests__/contentTables.test.ts` | Pins: 'content tables read the active catalog lazily' |
| `ui-tui/src/__tests__/createGatewayEventHandler.deferredPick.test.ts` | Pins: 'a model pick made during a turn that did not apply at the boundary' |
| `ui-tui/src/__tests__/createGatewayEventHandler.notice.test.ts` | Pins: 'createGatewayEventHandler' / 'credits notice' |
| `ui-tui/src/__tests__/createGatewayEventHandler.test.ts` | Pins: 'createGatewayEventHandler' / 'session.usage' |
| `ui-tui/src/__tests__/createGatewayEventHandler.usage.test.ts` | Pins: 'canonical session.usage tick' |
| `ui-tui/src/__tests__/createGatewayEventHandler.wake.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/createSlashHandler.test.ts` | Pins: 'createSlashHandler' |
| `ui-tui/src/__tests__/cursorDriftRegression.test.ts` | Pins: 'cursor-drift regression — composer cursorLayout matches Ink rendering' |
| `ui-tui/src/__tests__/details.test.ts` | Pins: 'parseDetailsMode' / 'isSectionName' |
| `ui-tui/src/__tests__/emoji.test.ts` | Pins: 'ensureEmojiPresentation' |
| `ui-tui/src/__tests__/externalLink.test.ts` | Pins: 'external link helpers' |
| `ui-tui/src/__tests__/forceTruecolor.test.ts` | Pins: 'forceTruecolor' |
| `ui-tui/src/__tests__/gatewayBrowserLinks.test.ts` | Pins: 'free_tier.challenge' |
| `ui-tui/src/__tests__/gatewayClient.test.ts` | Pins: 'GatewayClient websocket attach mode' |
| `ui-tui/src/__tests__/gatewayClientHeartbeatLiveness.test.ts` | Pins: 'GatewayClient heartbeat liveness wiring' |
| `ui-tui/src/__tests__/gatewayClientKillLatch.test.ts` | Pins: 'GatewayClient kill latch (issue #114987)' |
| `ui-tui/src/__tests__/gatewayLocalLaunch.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/gatewayRecovery.test.ts` | Pins: 'planGatewayRecovery' |
| `ui-tui/src/__tests__/gatewayStartTimeout.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/goalBar.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/gracefulExit.test.ts` | Pins: 'shouldExitForSignal' |
| `ui-tui/src/__tests__/i18nRuntime.test.ts` | Pins: 'TUI i18n catalog' / 'TUI i18n runtime' |
| `ui-tui/src/__tests__/imeVietnameseTelex.test.tsx` | Pins: 'Vietnamese Telex IME recomposition' / 'Fast-echo suppression reset (60ms window)' |
| `ui-tui/src/__tests__/inkIdleSessionInfoStamp.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/inkOfflinePollRedial.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/inkRemoteReceiptHome.test.tsx` | C22: an explicit HERMES_TUI_GATEWAY_URL owner on another home/machine answers receipts naming ITS profile_id; Ink validates them against the owner identity from the snapshot, not its local |
| `ui-tui/src/__tests__/inkResumeSnapshotFence.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/inlineSlashSkill.test.ts` | Pins: 'inlineSlashTrigger' / 'completionRequestForInput — inline skill references' |
| `ui-tui/src/__tests__/inputSelectionClipboard.test.ts` | Pins: 'handleInputSelectionClipboard' |
| `ui-tui/src/__tests__/journeyCommand.test.ts` | Pins: '/journey slash command' |
| `ui-tui/src/__tests__/legacyAdmissionRecovery.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/libTextI18n.test.ts` | Pins: 'libText catalog swap' |
| `ui-tui/src/__tests__/loaders.test.ts` | Pins: 'ShimmerRows leniency (agent-authored calls)' / 'shimmerSegments' |
| `ui-tui/src/__tests__/loopBar.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/markdown.test.ts` | Pins: 'INLINE_RE emphasis' / 'stripInlineMarkup' |
| `ui-tui/src/__tests__/mathUnicode.test.ts` | Pins: 'texToUnicode — symbols' / 'texToUnicode — blackboard / calligraphic / fraktur' |
| `ui-tui/src/__tests__/memoryMonitor.test.ts` | Pins: 'startMemoryMonitor thresholds (#34095)' |
| `ui-tui/src/__tests__/mergeUsageStable.test.ts` | Pins: 'mergeUsageStable (#41480 status-bar flicker)' |
| `ui-tui/src/__tests__/messageLine.test.ts` | Pins: 'shouldShowResponseSeparator' / 'shouldShowThinkingTrail' |
| `ui-tui/src/__tests__/messages.test.ts` | Pins: 'toTranscriptMessages' / 'MessageLine' |
| `ui-tui/src/__tests__/moaProgressActivity.test.ts` | Pins: 'moa.progress / moa.phase activity surface' |
| `ui-tui/src/__tests__/modelPicker.test.ts` | Pins: 'ModelPicker provider filtering' |
| `ui-tui/src/__tests__/modelPickerReasoning.test.ts` | Pins: 'ModelPicker reasoning step' |
| `ui-tui/src/__tests__/orchestratorPromptSession.test.ts` | Pins: 'startPromptLiveSession' |
| `ui-tui/src/__tests__/osc52.test.ts` | Pins: 'buildOsc52ClipboardQuery' / 'parseOsc52ClipboardData' |
| `ui-tui/src/__tests__/overlayPrimitives.test.ts` | Pins: 'clampOverlayWidth' |
| `ui-tui/src/__tests__/parentLog.test.ts` | Pins: 'recordParentLifecycle' |
| `ui-tui/src/__tests__/paths.test.ts` | Pins: 'shortCwd' / 'fmtCwdBranch' |
| `ui-tui/src/__tests__/pendingMigrationRenderer.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/petPane.test.tsx` | Pins: 'PetPane' |
| `ui-tui/src/__tests__/petPolling.test.ts` | Pins: 'requestPetUpdate' / 'createPetSingleFlight' |
| `ui-tui/src/__tests__/platform.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/precisionWheel.test.ts` | Pins: 'precisionWheel' |
| `ui-tui/src/__tests__/processDock.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/prompt.test.ts` | Pins: 'composerPromptText' |
| `ui-tui/src/__tests__/promptResponseFreshness.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/providers.test.ts` | Pins: 'providerDisplayNames' |
| `ui-tui/src/__tests__/queueEditKeepsFields.test.ts` | Pins: 'editing the text of a local queued item' |
| `ui-tui/src/__tests__/queueScopeRenderer.test.tsx` | Pins: 'pending input destination' |
| `ui-tui/src/__tests__/queueSubmission.test.ts` | Pins: '/queue collapsed paste submission' / 'prepareSlashSubmission' |
| `ui-tui/src/__tests__/reasoning.test.ts` | Pins: 'splitReasoning' / 'cleanThinkingText' |
| `ui-tui/src/__tests__/receiptBusyRenderer.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/replayGapReattach.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/resumeEpochRenderer.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/rpc.test.ts` | Pins: 'asRpcResult' / 'rpcErrorMessage' |
| `ui-tui/src/__tests__/scroll.test.ts` | Pins: 'scrollWithSelectionBy' |
| `ui-tui/src/__tests__/scrollBoxRendererBounds.test.ts` | Pins: 'ScrollBox renderer bounds' |
| `ui-tui/src/__tests__/sessionActivationPrompts.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/slashAttachmentRenderer.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/slashCatalog.test.ts` | Pins: 'loadSlashCatalog' |
| `ui-tui/src/__tests__/slashCatalogSkillsChanged.test.ts` | Pins: 'refreshSlashCatalogOnSkillsChange' |
| `ui-tui/src/__tests__/slashParity.test.ts` | Pins: 'slash parity matrix' / 'parseSlashCommand argument fidelity' |
| `ui-tui/src/__tests__/slashSessionAuthority.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/spawnHistoryStore.test.ts` | Pins: 'spawnHistoryStore status normalization' |
| `ui-tui/src/__tests__/startupLatency.test.ts` | Pins: 'startup latency metric' |
| `ui-tui/src/__tests__/startupLatencyDashboard.test.ts` | Pins: 'startup latency in a dashboard-embedded TUI' |
| `ui-tui/src/__tests__/stateIsolation.test.ts` | Pins: 'TUI state isolation' |
| `ui-tui/src/__tests__/statusBarTicker.test.ts` | Pins: 'FaceTicker verb padding' |
| `ui-tui/src/__tests__/statusRule.test.ts` | Pins: 'statusRuleWidths' / 'statusBarSegments' |
| `ui-tui/src/__tests__/steerCommand.test.ts` | Pins: '/steer' |
| `ui-tui/src/__tests__/streamingMarkdown.test.ts` | Pins: 'findStableBoundary' / 'advanceScan (incremental scanner)' |
| `ui-tui/src/__tests__/subagentTree.test.ts` | Pins: 'aggregate: tokens, cost, files, hotness' / 'hotnessBucket + peakHotness' |
| `ui-tui/src/__tests__/submissionCore.test.ts` | Pins: 'submissionCore.submitPrompt — synchronous busy (queue-race fix)' / 'submissionCore.submitPrompt — literal submissions (startup -q queries)' |
| `ui-tui/src/__tests__/submissionCoreUndeliveredCorrection.test.ts` | Pins: cases |
| `ui-tui/src/__tests__/submissionDestinationRenderer.test.tsx` | Pins: cases |
| `ui-tui/src/__tests__/subscriptionCommand.test.ts` | Pins: '/subscription slash command' |
| `ui-tui/src/__tests__/subscriptionOverlay.test.tsx` | Pins: 'SubscriptionOverlay — overview' / 'SubscriptionOverlay — overview actions' |
| `ui-tui/src/__tests__/syntax.test.ts` | Pins: 'syntax highlighter' |
| `ui-tui/src/__tests__/terminalModes.test.ts` | Pins: 'terminal mode reset' / 'isPaintableHex' |
| `ui-tui/src/__tests__/terminalParity.test.ts` | Pins: 'terminalParityHints' |
| `ui-tui/src/__tests__/terminalSetup.test.ts` | Pins: 'terminalSetup helpers' / 'configureTerminalKeybindings' |
| `ui-tui/src/__tests__/termuxComposerLayout.test.ts` | Pins: 'Termux composer prompt + width guards' |
| `ui-tui/src/__tests__/text.test.ts` | Pins: 'isToolTrailResultLine' / 'buildToolTrailLine' |
| `ui-tui/src/__tests__/textInputBurstInput.test.ts` | Pins: 'applyPrintableInsert' / 'shouldRouteMultiCharInputAsPaste' |
| `ui-tui/src/__tests__/textInputCursorSourceOfTruth.test.ts` | Pins: 'resolveCursorLayout' / 'fastBackspaceEffect' |
| `ui-tui/src/__tests__/textInputCut.test.ts` | Pins: 'cutSelection (transactional cut)' |
| `ui-tui/src/__tests__/textInputFastEcho.test.ts` | Pins: 'canFastAppendShape' / 'canFastBackspaceShape' |
| `ui-tui/src/__tests__/textInputKillLine.test.ts` | Pins: 'killToLineStart' / 'killToLineEnd' |
| `ui-tui/src/__tests__/textInputLineKill.test.ts` | Pins: 'isLineKillModifier' |
| `ui-tui/src/__tests__/textInputLineNav.test.ts` | Pins: 'lineNav' |
| `ui-tui/src/__tests__/textInputPassThrough.test.ts` | Pins: 'shouldPreserveCtrlJNewline' / 'shouldPassThroughToGlobalHandler' |
| `ui-tui/src/__tests__/textInputRedoShift.test.tsx` | Pins: 'TextInput redo chord under extended-key terminals' |
| `ui-tui/src/__tests__/textInputReturnBurst.test.ts` | Pins: 'valueForReturnSubmit' |
| `ui-tui/src/__tests__/textInputRightClick.test.ts` | Pins: 'decideRightClickAction' |
| `ui-tui/src/__tests__/textInputStaleParentEcho.test.tsx` | Pins: 'stale parent own-echo during deferred key-burst flush' |
| `ui-tui/src/__tests__/textInputSubmitClear.test.tsx` | Pins: 'TextInput submit clearing' |
| `ui-tui/src/__tests__/textInputWordDelete.test.ts` | Pins: 'Ctrl+Delete → ESC d decode contract' / 'deleteWordForward' |
| `ui-tui/src/__tests__/textInputWrap.test.ts` | Pins: 'cursorLayout — word-wrap parity with wrap-ansi' / 'input metrics helpers' |
| `ui-tui/src/__tests__/theme.test.ts` | Pins: 'LIGHT_THEME' / 'DEFAULT_THEME aliasing' |
| `ui-tui/src/__tests__/themeBoot.test.ts` | Pins: 'seedBootEnvironment' / 'invalidateBootBackground' |
| `ui-tui/src/__tests__/thinkingLiveCollapse.test.tsx` | Pins: 'ToolTrail — collapsed mode auto-expands while reasoning is live' |
| `ui-tui/src/__tests__/thinkingMoaReferenceVisibility.test.tsx` | Pins: 'ToolTrail — MoA reference panel visibility (#64701)' |
| `ui-tui/src/__tests__/topupCommand.test.ts` | Pins: '/billing slash command (overlay-driven)' |
| `ui-tui/src/__tests__/turnControllerNotice.test.ts` | Pins: 'turnController.startMessage — flash-and-yield notices clear on next prompt' |
| `ui-tui/src/__tests__/turnControllerTodos.test.ts` | Pins: 'turnController.recordTodos — preserves the parent field' |
| `ui-tui/src/__tests__/turnStore.test.ts` | Pins: 'turnStore live progress helpers' |
| `ui-tui/src/__tests__/usageCommand.test.ts` | Pins: '/usage slash command' |
| `ui-tui/src/__tests__/useBatteryPoll.test.ts` | Pins: 'toBatteryInfo' |
| `ui-tui/src/__tests__/useCompletion.test.ts` | Pins: 'completionRequestForInput' |
| `ui-tui/src/__tests__/useComposerState.test.ts` | Pins: 'looksLikeDroppedPath' |
| `ui-tui/src/__tests__/useConfigSync.test.ts` | Pins: 'applyDisplay' / 'normalizeStatusBar' |
| `ui-tui/src/__tests__/useInputHandlers.test.ts` | Pins: 'shouldFallThroughForScroll — keep transcript scrolling alive during prompt overlays' / 'composerHasDraft — Ctrl+D exits only from an empty composer (#116443)' |
| `ui-tui/src/__tests__/useQueue.test.ts` | Pins: 'removeAtInPlace' / 'queue items' |
| `ui-tui/src/__tests__/useSessionLifecycle.test.ts` | Pins: 'fresh session boundary' / 'writeActiveSessionFile' |
| `ui-tui/src/__tests__/useSessionLifecycleGatewayConnected.test.ts` | Pins: 'a successful bind restores gatewayConnected' |
| `ui-tui/src/__tests__/useSessionLifecycleStoredSid.test.ts` | Pins: 'useSessionLifecycle durable session id' |
| `ui-tui/src/__tests__/useSubmission.test.ts` | Pins: 'prepareSubmission' / 'visible interpolation combined with a collapsed paste' |
| `ui-tui/src/__tests__/useVirtualHistoryHeights.test.ts` | Pins: 'ensureVirtualItemHeight' |
| `ui-tui/src/__tests__/userMessages.test.ts` | Pins: 'describeTurnFailure' / 'describeRpcError' |
| `ui-tui/src/__tests__/userWidgets.test.ts` | Pins: 'user widget loading' |
| `ui-tui/src/__tests__/vaultSaveLoginPrompt.test.tsx` | Pins: 'VaultSaveLoginPrompt (#109101)' / 'VaultCodePrompt' |
| `ui-tui/src/__tests__/viewport.test.ts` | Pins: 'stickyPromptFromViewport' |
| `ui-tui/src/__tests__/viewportStore.test.ts` | Pins: 'viewportStore' |
| `ui-tui/src/__tests__/virtualHeights.test.ts` | Pins: 'virtual height estimates' |
| `ui-tui/src/__tests__/virtualHistoryClamp.test.ts` | Pins: 'virtual history clamp bounds' |
| `ui-tui/src/__tests__/virtualHistoryOffsetCache.test.ts` | Pins: 'useVirtualHistory offset cache reuse' |
| `ui-tui/src/__tests__/voicePartialStore.test.ts` | Pins: 'handleVoiceCapture' |
| `ui-tui/src/__tests__/voiceSubmitModeRenderer.test.tsx` | Pins: 'voice.submit_mode live composer rendering' |
| `ui-tui/src/__tests__/wakeCommand.test.ts` | Pins: '/wake slash command' |
| `ui-tui/src/__tests__/weatherApp.test.ts` | Pins: 'weather reference app (async contract)' |
| `ui-tui/src/__tests__/wheelAccel.test.ts` | Pins: 'wheelAccel — native path' / 'wheelAccel — xterm.js path' |
| `ui-tui/src/__tests__/widgetGrid.test.ts` | Pins: 'layoutWidgetGrid' / 'resolveGridTracks' |
| `ui-tui/src/__tests__/widgetGridComponent.test.tsx` | Pins: 'WidgetGrid component composition' / 'GridAreas component' |
| `ui-tui/src/__tests__/widgetSdk.test.ts` | Pins: 'widget SDK host' |
| `ui-tui/src/app.tsx` | Exports function. |
| `ui-tui/src/app/agentRoster.ts` | Merges the live subagent event stream with the server snapshot without rolling progress back. |
| `ui-tui/src/app/clarifyTranscript.ts` | The transcript a settled clarify leaves: a collapsed tool row plus a question -> answer bubble. |
| `ui-tui/src/app/connectionOperationStore.ts` | Tracks a connector setup operation so the card knows which row was answered and in what state. |
| `ui-tui/src/app/createGatewayEventHandler.ts` | Maps every gateway event to a state update; the largest file in the TUI. (structural) |
| `ui-tui/src/app/createServerRequestHandler.ts` | The legacy server->client request path: approval, clarify, sudo, secret, vault cards; unknown methods fail fast. |
| `ui-tui/src/app/createSlashHandler.ts` | Local slash dispatch: it runs the registry, falls through to slash.exec then command.dispatch, and reports each command exactly once. |
| `ui-tui/src/app/delegationStore.ts` | The delegation caps and the overlay accordion state, fetched from delegation.status. |
| `ui-tui/src/app/gatewayBrowserLinks.ts` | Presents the links the headless gateway cannot open itself (the billing step-up device flow, the free-tier challenge). |
| `ui-tui/src/app/gatewayCanonicalEvents.ts` | The owner-epoch lifecycle fence and the generation-bound shared approval/clarify controls. |
| `ui-tui/src/app/gatewayContext.tsx` | The React context that carries the gateway client. |
| `ui-tui/src/app/gatewayRecovery.ts` | The pure crash-recovery budget: 3 respawn+resume attempts per 60 s sliding window. |
| `ui-tui/src/app/gatewayStartTimeout.ts` | Turns a gateway start timeout into a terminal verdict with the next step, never "still waiting". |
| `ui-tui/src/app/goalStatus.ts` | The standing /goal control: turns, subgoals, gates and the wait barrier. |
| `ui-tui/src/app/inputSelectionStore.ts` | The nanostore exposing the active text-input selection handle. |
| `ui-tui/src/app/interfaces.ts` | A single battery reading pushed from the Python gateway (`system.battery`). `available` is false on machines without a battery; `percent` is 0-100. |
| `ui-tui/src/app/liveSessions.ts` | Asks session.list for the live sessions; the legacy sidecar's active_list never holds them. |
| `ui-tui/src/app/loopStatus.ts` | The standing /loop control and its minute-step countdown line. |
| `ui-tui/src/app/overlayStore.ts` | The overlay taxonomy: what blocks input, what occludes the status rule, what a turn end may close. |
| `ui-tui/src/app/pendingBubbles.ts` | The painted-bubble ledger that prevents a duplicate user row on a busy-time admission. |
| `ui-tui/src/app/petFlashStore.ts` | Transient reaction beats (wave/jump/failed) the pet shows for a moment at turn end before falling back to its steady state. The gateway event handler |
| `ui-tui/src/app/processRoster.ts` | The background-process roster and its retention window; the completion notification in the transcript is the durable record. |
| `ui-tui/src/app/scroll.ts` | Scrolls the viewport while keeping the text-selection anchor in sync, using a FRESH scroll height rather than the cached fake bottom. |
| `ui-tui/src/app/serverRequestStore.ts` | Live server→client requests (clarify, approval, sudo, …) keyed by request id. Overlay state keeps only the id; answering resolves the stored request |
| `ui-tui/src/app/sessionResumeView.test.ts` | Pins: 'scheduleResumeScrollToBottom' |
| `ui-tui/src/app/sessionResumeView.ts` | The resume-time scroll-to-bottom snap: it re-snaps while sticky and stops when the user scrolls away. |
| `ui-tui/src/app/setupHandoff.ts` | Runs the external setup wizard with Ink suspended and opens a new session on success. |
| `ui-tui/src/app/slash/canonicalSessionCommands.ts` | Maps the Ink slash commands onto what the canonical gateway serves (session.mutate rename/rewind, the committed admission). |
| `ui-tui/src/app/slash/canonicalSessionControls.ts` | The revision-fenced session mutations (model/branch/compress/delete/rename/rewind/reasoning) with the lost-reply control retirement. |
| `ui-tui/src/app/slash/commands/core.ts` | The general TUI slash commands (/help /clear /copy /queue /history /save /undo /retry /steer /status /redraw ...). |
| `ui-tui/src/app/slash/commands/debug.ts` | The debug commands (/heapdump /mem) plus the registry-derived widget-app commands. |
| `ui-tui/src/app/slash/commands/ops.ts` | The operations commands (/stop /reload-mcp /agents /replay /skills /plugins /tools). |
| `ui-tui/src/app/slash/commands/session.ts` | The session and agent slash commands (/model /sessions /bg /compress /branch /voice /reasoning /usage ...). |
| `ui-tui/src/app/slash/commands/setup.ts` | The /setup command, which hands off to the external wizard with Ink suspended. |
| `ui-tui/src/app/slash/commands/subscription.ts` | The /subscription command; the manage-subscription URL is built locally from the resolved portal base and the org id. |
| `ui-tui/src/app/slash/commands/topup.ts` | The credit top-up commands; a non-charge mutation that needs remote spending points the user at the buy path rather than leaking the raw scope. |
| `ui-tui/src/app/slash/commands/wake.ts` | The /wake command; the gateway's refusal codes are resolved at reply time so a locale swap is observed. |
| `ui-tui/src/app/slash/fuzzyScore.test.ts` | Pins: 'normalizeSlashSearchQuery' / 'tokenizeSearchText' |
| `ui-tui/src/app/slash/fuzzyScore.ts` | The slash-menu scorer: exact/prefix/substring tiers on id/label/alias, plus a description token match at a +3 offset. |
| `ui-tui/src/app/slash/registry.ts` | Assembles SLASH_COMMANDS from every command file in registration order and provides a case-insensitive lookup. |
| `ui-tui/src/app/slash/types.ts` | The SlashCommand interface and the SlashRunCtx execution context, including the "observe once, never on a refusal or a forward" rule. |
| `ui-tui/src/app/slash/usagePanel.ts` | The /usage panel sections, computed from main's Usage shape or the canonical owner's session.stats. |
| `ui-tui/src/app/slashCatalog.ts` | Loads the slash catalogue from the gateway and refetches it on skills.changed; a reply for a session that is no longer live is dropped. |
| `ui-tui/src/app/spawnHistoryStore.ts` | The last-10 ring of finished subagent fan-outs behind /replay. |
| `ui-tui/src/app/startupLatency.ts` | Reports launch->first-ready once per TUI process; a gateway respawn never re-reports. |
| `ui-tui/src/app/submissionCore.ts` | The single submit choke point: synchronous busy, admission receipts, legacy fallback, corrections, file-drop staging. |
| `ui-tui/src/app/submissionDestination.ts` | Captures the canonical destination of a submission (profile home realpath, owner home, sids). |
| `ui-tui/src/app/turnController.ts` | The turn lifecycle: streaming buffer, tool/reasoning segments, notices, interrupts, the final transcript archive. |
| `ui-tui/src/app/turnStore.ts` | The nanostore holding the turn state (streaming text, tools, reasoning, subagents, todos, activity trail). |
| `ui-tui/src/app/uiStore.ts` | The nanostore for UI flags (busy, sid, theme, notice, status bar mode); the last session's theme paints frame one for a flash-free boot. |
| `ui-tui/src/app/useBatteryPoll.ts` | Polls the host battery while the status-bar indicator is on; the reading is a system property, so it is not session-gated. |
| `ui-tui/src/app/useComposerState.ts` | Quick client-side heuristic to detect text that looks like a dropped file path. When this returns true the composer sends RPC calls to the server for actual |
| `ui-tui/src/app/useConfigSync.ts` | Polls config.get full on session start and the config mtime every 5 s; applies display settings and triggers an MCP reload on change. |
| `ui-tui/src/app/useInputHandlers.ts` | Keypress routing: the Ctrl+C ladder (clear -> interrupt -> exit), the double-Esc ladder, idle hotkeys, and composer selection copy/cut. |
| `ui-tui/src/app/useLongRunToolCharms.ts` | Ambient activity lines for tools running longer than 8 s, capped at 2 per tool. |
| `ui-tui/src/app/useMainApp.ts` | The top-level composition hook: wires every sub-hook, owns transcript history and session polling. (structural) |
| `ui-tui/src/app/usePet.ts` | Resolve the animation state — mirrors `agent.pet.state.derive_pet_state` (and the desktop's `derivePetState`) so all surfaces agree. `awaitingInput` |
| `ui-tui/src/app/useSessionLifecycle.ts` | Session create / resume / activate / close, the visible-history reset, the active-session file, and the plugin finalize epilogue. |
| `ui-tui/src/app/useSubmission.ts` | Message send, shell exec (!cmd), inline interpolation ({!cmd}) and the busy-input-mode dispatch (queue / steer / interrupt). |
| `ui-tui/src/app/userMessages.ts` | Pure functions producing the user-facing wording for gateway/transport failures, so the copy is unit-testable without rendering. |
| `ui-tui/src/app/voicePartialStore.ts` | The live STT text shown as the composer placeholder until the capture settles. |
| `ui-tui/src/app/wakeState.ts` | Session-scoped memory of an explicit /wake off; the gateway re-arms the listener on every gateway.ready. |
| `ui-tui/src/banner.ts` | ASCII art renderer that parses Rich colour markup into themed lines (logo + caduceus). |
| `ui-tui/src/canonicalGateway.ts` | The canonical wire adapter: maps legacy RPCs onto session.mutate, translates submission_id to input_id, and projects the owner's display_messages. |
| `ui-tui/src/components/accordion.tsx` | THE expand/collapse primitive; the session panel and the widget accordions are the same component. |
| `ui-tui/src/components/activeSessionSwitcher.tsx` | The session switcher: [new][live...][history...] rows, the current-session highlight, and the two-press delete. |
| `ui-tui/src/components/agentControls.tsx` | The per-agent controls: the bounded live transcript tail, the steer form, and the roster viewport maths. |
| `ui-tui/src/components/agentsOverlay.tsx` | The /agents overlay: the spawn tree, the replay history, sort/filter, and the per-child tail and steer controls. |
| `ui-tui/src/components/agentsPanel.tsx` | The docked agents panel: one merged row per child, a shared dock budget split with the processes block. |
| `ui-tui/src/components/appChrome.tsx` | The status rule and the composer chrome: verb padding, duration width, and the width budget that drops the lowest-priority read-outs first. |
| `ui-tui/src/components/appLayout.tsx` | The top-level layout: transcript, composer, status rule, dock and the pet pane, with the geometry the transcript reserves. |
| `ui-tui/src/components/appOverlays.tsx` | Overlay routing: the prompt zone (approval/clarify/sudo/secret) in normal flow, and the floating panels that anchor above the composer. |
| `ui-tui/src/components/billingOverlay.tsx` | The /billing modal.  A self-contained state machine:   overview → buy / autoreload / limit  (and buy → confirm). |
| `ui-tui/src/components/branding.tsx` | The banner and the session panel: the logo, the tool/skill/MCP inventory (MCP counts only CONNECTED servers), and the update notice. |
| `ui-tui/src/components/connectionSetupOverlay.tsx` | The connection setup card; the answered row keeps its own state while a sibling frame of the same operation arrives. |
| `ui-tui/src/components/connectorsOverlay.tsx` | The connectors overlay: hosted accounts, their status, and reconnect offered only as a repair. |
| `ui-tui/src/components/fpsOverlay.tsx` | The FPS debug overlay; zero cost when disabled. |
| `ui-tui/src/components/goalBar.tsx` | The standing /goal bar; the goal is done or cleared it disappears. |
| `ui-tui/src/components/gridStreamsDemo.tsx` | Six independently ticking panels tiled through layoutGridAreas, with one promoted 2x2 slot. |
| `ui-tui/src/components/gridTestOverlay.tsx` | The grid test/demo overlay: nested toggles, sparse patterns, and the areas-mode variant. |
| `ui-tui/src/components/helpHint.tsx` | The contextual help hint. |
| `ui-tui/src/components/journey.tsx` | The learning-journey overlay: a flattened timeline tree of slices and their items. |
| `ui-tui/src/components/loaders.tsx` | The shimmer/loader primitives: a single shared shimmer clock so an idle TUI does not repaint 22x/sec. |
| `ui-tui/src/components/loopBar.tsx` | The standing /loop bar; the countdown ticks on its own clock between snapshots. |
| `ui-tui/src/components/markdown.tsx` | The Markdown-to-Ink renderer: headings, lists, tables, fenced code, diff colouring, inline emphasis and the media/audio directives. |
| `ui-tui/src/components/maskedPrompt.tsx` | The masked credential prompts: sudo, secret, vault unlock/save-login/code. |
| `ui-tui/src/components/messageLine.tsx` | A transcript row: role colour, the timestamp label, the response separator, and the thinking trail toggle. |
| `ui-tui/src/components/modelPicker.tsx` | The /model picker: provider -> model -> reasoning effort, with the effort ladder as literal --reasoning values. |
| `ui-tui/src/components/overlay.tsx` | The viewport-level overlay primitive: nine placement zones and the canonical cell-by-cell scrim. |
| `ui-tui/src/components/overlayControls.tsx` | Shared overlay controls: the key hook, the windowed list navigation and the hint row. |
| `ui-tui/src/components/overlayPrimitives.tsx` | Shared overlay primitives: the width clamp, the menu row reducer, the scrollbar colours, and the list navigation. |
| `ui-tui/src/components/overlayScrollbar.tsx` | A mouse-draggable scrollbar bound to a ScrollBox ref, re-rendering off the parent tick. |
| `ui-tui/src/components/petPicker.tsx` | The pet gallery picker; adopting a pet installs on demand and the mascot lights up on the next poll. |
| `ui-tui/src/components/petSprite.tsx` | Renders a petdex frame as truecolor half-blocks from the gateway's pet.cells payload. |
| `ui-tui/src/components/pluginsHub.tsx` | The plugins hub overlay. |
| `ui-tui/src/components/prompts.tsx` | The approval, clarify and confirm cards; approvalAction is a pure key-dispatch function so the precedence is testable. |
| `ui-tui/src/components/queuedMessages.tsx` | The queued-input strip and its 3-row window. |
| `ui-tui/src/components/skillsHub.tsx` | The skills hub overlay: the catalogue the gateway serves, grouped by category. |
| `ui-tui/src/components/streamingAssistant.tsx` | The live streaming area: the ordered block list whose lead gap is derived from the block above it. |
| `ui-tui/src/components/streamingMarkdown.tsx` | The incremental streaming renderer: it finds a stable boundary so a live block is never re-tokenized on every delta. |
| `ui-tui/src/components/subscriptionOverlay.tsx` | The /subscription modal state machine: overview -> picker -> confirm -> result, with a step-up screen spliced in. |
| `ui-tui/src/components/textInput.tsx` | The custom line editor: cursor layout, fast-echo to stdout, grapheme-aware editing, cut/copy, and the 16 ms deferred state flush. |
| `ui-tui/src/components/themed.tsx` | The theme-aware text wrapper. |
| `ui-tui/src/components/thinking.tsx` | The reasoning and tool-activity panel: the spinner, the live reasoning segment, the tool trail tree, and the MoA reference blocks. |
| `ui-tui/src/components/todoPanel.tsx` | The live todo panel for the in-flight turn. |
| `ui-tui/src/components/widgetGrid.tsx` | The widget-grid component composition: stateful children, nested grids, and fixed header/footer rows. |
| `ui-tui/src/config/env.ts` | Environment resolution and the mouse-tracking default. |
| `ui-tui/src/config/limits.ts` | The paste, live-render and history limits. |
| `ui-tui/src/config/timing.ts` | The streaming batch, idle, scroll and typing delays, and the reasoning pulse. |
| `ui-tui/src/content/charms.ts` | The ambient activity strings fired for long-running tools. |
| `ui-tui/src/content/faces.ts` | The agent face / kaomoji pool. |
| `ui-tui/src/content/fortunes.ts` | The /fortune quote pool. |
| `ui-tui/src/content/hotkeys.ts` | Platform-aware hotkey display strings. |
| `ui-tui/src/content/placeholders.ts` | The rotating composer placeholders. |
| `ui-tui/src/content/setup.ts` | The setup-required panel content. |
| `ui-tui/src/content/verbs.ts` | The tool-activity verb map (browser -> browsing, ...). |
| `ui-tui/src/domain/attachments.ts` | Composer tokens are the ONE way deferred content shows up in the input line: a collapsed paste and an attached image both render as `[[ … ]]` sitting in |
| `ui-tui/src/domain/blockLayout.ts` | Block layout and the lead-gap rule; the grouping is what makes the blank-line rhythm readable. |
| `ui-tui/src/domain/composerHighlights.ts` | Splits the composer text into highlighted segments and computes a stable mask so highlighting does not re-render per keystroke. |
| `ui-tui/src/domain/connectorAccounts.ts` | Connector account rules: name validation, retired accounts, and reconnect offered only as a repair. |
| `ui-tui/src/domain/details.ts` | Details visibility: hidden/collapsed/expanded, with per-section defaults layered ABOVE the global mode. |
| `ui-tui/src/domain/messages.ts` | Transcript projection: the intro row, the user display, and toTranscriptMessages (which keeps assistant tool rows so resume does not drop turns). |
| `ui-tui/src/domain/paths.ts` | cwd shortening and the inline project/cwd/branch label (the terminal has no hover tooltip). |
| `ui-tui/src/domain/providers.ts` | Provider display names; a collision appends the slug to EVERY name in the group so the disambiguation is symmetric. |
| `ui-tui/src/domain/roles.ts` | The role colour and label map. |
| `ui-tui/src/domain/slash.ts` | Slash parsing: the --tui-session model flag, the canonical reasoning-effort set, and the inline slash trigger. |
| `ui-tui/src/domain/usage.ts` | The zero usage value and its helpers. |
| `ui-tui/src/domain/viewport.ts` | The sticky-prompt helper derived from the viewport. |
| `ui-tui/src/entry.tsx` | The client entrypoint: the TTY gate, the truecolor override import order, the crash-recovery terminal reset, and render(). |
| `ui-tui/src/gatewayClient.ts` | The transport: spawns/attaches the Python gateway, JSON-RPC over stdio or an authenticated WebSocket, keepalive heartbeat, exponential reconnect, owner-recovery budget, and the kill latch that stops a killed transport from respawning. |
| `ui-tui/src/gatewayTypes.ts` |  Includes the paired light_colors/dark_colors overlays from #20379. */  (`gateway/session_pending_controls.py::register` / `register_clarify`). Answered through |
| `ui-tui/src/hooks/useCompletion.ts` | Tab completion: slash commands merged with the widget-app registry, and path completion; requests are debounced by 60 ms. |
| `ui-tui/src/hooks/useGitBranch.ts` | Reads the current git branch for the status label. |
| `ui-tui/src/hooks/useInputHistory.ts` | The persistent input-history navigation. |
| `ui-tui/src/hooks/useQueue.ts` | The message queue: local + server-admitted rows, the durable journal rehydration, and edit semantics. |
| `ui-tui/src/hooks/useSessionDelete.ts` | The revision-fenced two-press session delete, with the CAS tuple kept so a refused delete does not detach the view. |
| `ui-tui/src/hooks/useVirtualHistory.ts` | The virtualised transcript: height estimation, the external height cache, and the scroll clamp bounds. |
| `ui-tui/src/i18n/en.ts` | The bundled English catalogue and the sibling list; every other language arrives as a pack merged over it at runtime. |
| `ui-tui/src/i18n/en/app.ts` | app/ layer (excluding slash): notices, turn-controller activity lines, gateway event copy, server-request prompts, session lifecycle, queue, pet. |
| `ui-tui/src/i18n/en/billing.ts` | Billing overlay (`/topup`, credit purchases, card step-up). Owned namespace: `billing`. Leaves are strings or `(...args) => string`; packs supply `{0}`, `{1}` positional |
| `ui-tui/src/i18n/en/canonical.ts` | Shared-gateway (canonical authority) client text: durable submission/queue receipts, image staging, launch-contract refusals and the slash commands mapped onto `session.mutate`. |
| `ui-tui/src/i18n/en/chatBits.ts` | Chat bits: the banner/session panel (branding.tsx), the reasoning + tool trail tree (thinking.tsx), transcript rows (messageLine.tsx), the todo |
| `ui-tui/src/i18n/en/chrome.ts` | App shell: status line, composer, keybind hints, banner, dock, transcript rows. Owned namespaces: `status`, `composer`, `hints`, `help`, `banner`, `transcript`, `dock`. |
| `ui-tui/src/i18n/en/connection.ts` | Connection setup overlay and the learning-journey (starmap) overlay. Owned namespaces: `connection`, `journey`. Leaves are strings or |
| `ui-tui/src/i18n/en/connectors.ts` | The /connectors overlay: the user's hosted connector accounts. Owned namespace: `connectors`. Leaves are strings or `(...args) => string`; |
| `ui-tui/src/i18n/en/content.ts` | Content tables: tool verbs, fortunes, kaomoji faces, the setup-required panel. Owned namespace: `content`. |
| `ui-tui/src/i18n/en/gatewayMsg.ts` | Lane t2 — app/createGatewayEventHandler.ts: notices/activity lines rendered from gateway events. Owned namespace: `gatewayMsg`. |
| `ui-tui/src/i18n/en/hubs.ts` | Hubs: the agents overlay (spawn tree / replay diff), the live agents dock, per-agent steer/tail controls, the Skills Hub and the Plugins Hub. |
| `ui-tui/src/i18n/en/lib.ts` | lib/, domain/, content/, hooks/, sdk/ and root files: clipboard, editor, external links, usage, attachments, widgets. Owned namespaces: `clipboard`, |
| `ui-tui/src/i18n/en/libText.ts` | Lane t2 — gatewayClient displayed reasons, lib/*, domain/*, hooks/* user-facing text. Owned namespace: `libText`. |
| `ui-tui/src/i18n/en/overlays.ts` | Overlays, pickers and dialogs: prompts, model/pet pickers, hubs, agents panel, billing/subscription, connection setup. Owned namespaces: `overlay`, `prompt`, |
| `ui-tui/src/i18n/en/pickers.ts` | Picker overlays: the /model provider→model→effort picker, the Ctrl+X live session switcher (orchestrator), and the /pet gallery picker. Owned |
| `ui-tui/src/i18n/en/secure.ts` | Credential prompts: the sudo password, secret (env var) and password-manager unlock prompts hosted in MaskedPrompt. Owned namespace: `secure`. |
| `ui-tui/src/i18n/en/session.ts` | Lane t2 — app/ session flow: useMainApp, useSessionLifecycle, useInputHandlers, turnController, createServerRequestHandler, setupHandoff. Owned namespace: `session`. |
| `ui-tui/src/i18n/en/slash.ts` | Slash-command layer: local command replies, usage hints, RPC error copy. Owned namespaces: `slash`, `rpc`. |
| `ui-tui/src/i18n/en/slashCmd.ts` | Slash-command replies (app/slash/commands/*). Owned namespace: `slashCmd`. Composed from per-command-file parts under ./slashCmd/ so each part is |
| `ui-tui/src/i18n/en/slashCmd/core.ts` | slashCmd.core / slashCmd.debug / slashCmd.setup — replies and usage hints of app/slash/commands/{core,debug,setup}.ts. Command NAMES/aliases/arg syntax stay literal. |
| `ui-tui/src/i18n/en/slashCmd/ops.ts` | slashCmd.ops / slashCmd.wake — replies and usage hints of app/slash/commands/{ops,wake}.ts. Command NAMES/aliases/arg syntax inside usage strings stay literal. |
| `ui-tui/src/i18n/en/slashCmd/session.ts` | slashCmd.session / slashCmd.topup / slashCmd.subscription — replies and usage hints of app/slash/commands/{session,topup,subscription}.ts. Command NAMES/aliases/arg syntax |
| `ui-tui/src/i18n/en/subscription.ts` | Subscription overlay (`/subscription`: plans, scheduled changes, remote spending). Owned namespace: `subscription`. Leaves are strings or `(...args) => string`; packs |
| `ui-tui/src/i18n/en/userMessages.ts` | app/userMessages.ts copy: gateway/transport failure wording, turn-failure titles + next steps, withdrawn-prompt notices, empty states. |
| `ui-tui/src/i18n/index.ts` | The i18n barrel. |
| `ui-tui/src/i18n/keys.ts` | Flattens a catalogue into its sorted dotted leaf keys, shared by the key emitter and its test. |
| `ui-tui/src/i18n/loader.ts` | Fetches the TUI language pack from the backend (display.language -> i18n.catalog {lang, surface: tui}). |
| `ui-tui/src/i18n/merge.ts` | The deep-merge helpers for language packs, kept local because the shared module touches the DOM. |
| `ui-tui/src/i18n/runtime.ts` | The locale + merged catalogue store; a function leaf stays callable, and packs use {0}/{1} positional placeholders. |
| `ui-tui/src/i18n/types.ts` | The i18n type contract: Translations is derived from the bundled English catalogue, so adding a string IS the schema change. |
| `ui-tui/src/i18n/useT.ts` | The useT / useLocale hooks. |
| `ui-tui/src/lib/agentRows.ts` | Pure merge + layout logic for the docked agents panel, kept Ink-free so it is unit-testable on its own. |
| `ui-tui/src/lib/billingDialog.ts` | Copy for the out-of-credits confirm dialog (the TUI's billing wall). The dialog is the actionable layer — the full provider guidance already lands in |
| `ui-tui/src/lib/charts.ts` | Pure string chart builders (sparkline, spark rows, gauge, horizontal bars) for widget apps. |
| `ui-tui/src/lib/circularBuffer.ts` | A fixed-size generic ring buffer. |
| `ui-tui/src/lib/clipboard.ts` | Clipboard read/write through child_process, with the PowerShell path base64-encoding to dodge the ANSI codepage. |
| `ui-tui/src/lib/color.test.ts` | Pins: 'color() chain' |
| `ui-tui/src/lib/color.ts` | TUI-only colour derivations: contrast lifting, desaturation, HSL round-trip, and the xterm.js 16-colour fallback. |
| `ui-tui/src/lib/editor.test.ts` | Pins: 'resolveEditor' |
| `ui-tui/src/lib/editor.ts` | The $EDITOR fallback chain, mirroring prompt_toolkit's picker so the TUI and the CLI open the same editor. |
| `ui-tui/src/lib/emoji.ts` | ensureEmojiPresentation injects VS16 after text-default emoji codepoints, lazily. |
| `ui-tui/src/lib/externalCli.ts` | Launches the hermes CLI as a subprocess. |
| `ui-tui/src/lib/externalLink.ts` | URL normalisation, host/path labels, slug-derived titles, and a cached title fetch. |
| `ui-tui/src/lib/forceTruecolor.ts` | A targeted 24-bit truecolor override before chalk imports, with the pre-Tahoe Apple Terminal downgrade. |
| `ui-tui/src/lib/fpsStore.ts` | The Ink frame FPS tracker fed by the onFrame callback. |
| `ui-tui/src/lib/gracefulExit.ts` | The signal-based clean shutdown with the ignored-signal allowlist. |
| `ui-tui/src/lib/history.ts` | The persistent input history file. |
| `ui-tui/src/lib/imageAttachments.ts` | Stages a clipboard or path image: local bytes into the profile's private cache, remote bytes uploaded, and the attachment is never a client path. |
| `ui-tui/src/lib/inputMetrics.ts` | The composer cursor layout, computed by mapping wrap-ansi output back to source offsets so the caret cannot drift from the rendered text. |
| `ui-tui/src/lib/liveProgress.test.ts` | Pins: 'isTodoDone' / 'tool shelf helpers' |
| `ui-tui/src/lib/liveProgress.ts` | The tool-shelf helpers: what may hold a tool shelf, and how a shelf merges into a message. |
| `ui-tui/src/lib/mathUnicode.ts` | Best-effort LaTeX -> Unicode for inline math, with a longest-match-first symbol table. |
| `ui-tui/src/lib/memory.test.ts` | Pins: 'performHeapDump auto opt-in gate (#21767)' / 'heapdump retention guard (#21767)' |
| `ui-tui/src/lib/memory.ts` | Heap-dump and diagnostics capture with a byte cap and oldest-first pruning; the auto trigger is opt-in via HERMES_AUTO_HEAPDUMP. |
| `ui-tui/src/lib/memoryMonitor.ts` | Watches heap growth and fires ONE warning while still far below the critical exit threshold, then re-arms; also drives cache eviction. |
| `ui-tui/src/lib/messages.ts` | Transcript append/upsert; rows are stamped at APPEND time, because a message's authoring time is when it entered the transcript. |
| `ui-tui/src/lib/openExternalUrl.test.ts` | Pins: 'parseSafeUrl' / 'openCommand' |
| `ui-tui/src/lib/openExternalUrl.ts` | Opens a URL in the system browser, and parseSafeUrl accepts ONLY http/https so a model cannot trigger a local handler. |
| `ui-tui/src/lib/osc52.ts` | Builds and parses the OSC 52 clipboard query/write, wrapping for tmux passthrough. |
| `ui-tui/src/lib/parentLog.ts` | Append-only lifecycle breadcrumbs to ~/.hermes/tui-parent.log, interleaved with the Python gateway's panic log. |
| `ui-tui/src/lib/pendingInputs.ts` | The crash-safe pending-input journal: fsync+rename per submission, owner/destination split, cycle-guarded migration. |
| `ui-tui/src/lib/perfPane.tsx` | The React.Profiler perf pane and the per-frame event log. |
| `ui-tui/src/lib/petPolling.ts` | A single-flight pet probe so a slow gateway can never accumulate a queue of cosmetic requests. |
| `ui-tui/src/lib/platform.ts` | Platform-aware keybinding helpers: which modifier is the action modifier (Cmd on macOS, Ctrl elsewhere), SSH detection, copy and voice-record chords. |
| `ui-tui/src/lib/precisionWheel.ts` | The modifier-held precision wheel with a sticky-frame budget. |
| `ui-tui/src/lib/processGlyph.ts` | The shared status->glyph lookup for background-process rows. |
| `ui-tui/src/lib/prompt.ts` | The composer prompt text; the live marker is strictly single-cell ASCII so no stale arrow artifacts remain. |
| `ui-tui/src/lib/pythonHelpers.ts` | Resolves a bundled Python helper path relative to the shipped entry.js. |
| `ui-tui/src/lib/reasoning.ts` | Splits a <think> block out of the reply, anchored to start-of-input so a literal <think> in prose does not eat the rest. |
| `ui-tui/src/lib/resizeCoalescer.test.ts` | Pins: 'createResizeCoalescer' |
| `ui-tui/src/lib/resizeCoalescer.ts` | Leading + trailing throttle for terminal-resize bursts, so a drag does not remount the transcript every tick. |
| `ui-tui/src/lib/rpc.ts` | The single place every failed RPC error line is shaped, so transport failures read as what happened + what to do. |
| `ui-tui/src/lib/sessionExport.ts` | Writes a session export next to the launch folder, or under HERMES_HOME/sessions/saved. |
| `ui-tui/src/lib/sessionLabel.test.ts` | Pins: 'sessionLabel' |
| `ui-tui/src/lib/sessionLabel.ts` | The 8-character session label; the full id stays in state for every RPC. |
| `ui-tui/src/lib/starmapPalette.ts` | The Star Map palette, ported from the desktop so both surfaces derive the same memory ink. |
| `ui-tui/src/lib/subagentGlyph.ts` | The shared status->glyph lookup, extracted so the docked panel and the /agents overlay cannot drift apart. |
| `ui-tui/src/lib/subagentTree.ts` | Reconstructs the spawn tree from a flat event list and aggregates tokens, cost, files and hotness (tools per second). |
| `ui-tui/src/lib/syntax.ts` | The theme-aware syntax highlighter for code blocks. |
| `ui-tui/src/lib/terminalModes.ts` | The terminal-mode reset sequences; OSC 10/11 make every cell take the skin, not just the coloured ones. |
| `ui-tui/src/lib/terminalParity.ts` | Detects the macOS / SSH / tmux context and suggests the IDE keybinding setup only where it applies. |
| `ui-tui/src/lib/terminalSetup.ts` | Installs VS Code / Cursor / Windsurf keybindings for the composer; detects the terminal family and refuses to configure a remote shell. |
| `ui-tui/src/lib/termux.ts` | Termux detection with an explicit opt-out for debugging. |
| `ui-tui/src/lib/text.test.ts` | Pins: 'stripTrailingPasteNewlines' / 'formatAbandonedClarify' |
| `ui-tui/src/lib/text.ts` | The transcript text helpers: tool-trail lines, thinking previews, paste labels, token estimates, and the bounded live-render text. |
| `ui-tui/src/lib/themeBoot.ts` | The flash-free theme boot: reads the desktop's boot keys and seeds the environment so frame one is already themed. |
| `ui-tui/src/lib/todo.test.ts` | Pins: 'todoTree' |
| `ui-tui/src/lib/todo.ts` | The todo tree: parents before children, dangling/cyclic parents degraded to depth 0. |
| `ui-tui/src/lib/viewportStore.ts` | Reads the ScrollBox viewport and scrollbar snapshots and exposes them as stable keys. |
| `ui-tui/src/lib/virtualHeights.ts` | Estimates a transcript row's rendered height from its text, with a hard cap on estimated lines. |
| `ui-tui/src/lib/wheelAccel.ts` | The wheel-scroll acceleration state machine: a trackpad at 200+ events/sec needs more than one row per event. |
| `ui-tui/src/lib/widgetGrid.ts` | The grid-template track solver for character cells: fixed tracks, fr shares, span packing, and area placement. |
| `ui-tui/src/localGatewayBootstrap.ts` | Trust HERMES_PYTHON only. The launcher guarantees it: hermes_cli/main.py validates it and falls back to its own sys.executable, and the Nix |
| `ui-tui/src/protocol/interpolation.ts` | The {!cmd} inline-shell interpolation regex. |
| `ui-tui/src/protocol/paste.ts` | The bracketed-paste snippet token regex. |
| `ui-tui/src/sdk/apps/dialogTest.tsx` | The dialog widget app, launched programmatically by the grid demo. |
| `ui-tui/src/sdk/apps/gridTest.tsx` | The grid demo widget app; d opens the dialog app as a nested demo. |
| `ui-tui/src/sdk/apps/gridTestState.ts` | The grid demo's state type, split out to avoid an import cycle. |
| `ui-tui/src/sdk/apps/index.ts` | The app barrel: importing it registers the reference apps at startup. |
| `ui-tui/src/sdk/apps/ticker.tsx` | The animated ambient reference app: a fake price random-walk drawn as a live block sparkline. |
| `ui-tui/src/sdk/apps/weather.tsx` | The data-backed reference widget app: init returns a loading state, the resolution lands through updateWidget, and a late resolution cannot resurrect a closed app. |
| `ui-tui/src/sdk/host.tsx` | The widget-app host: launch, dispatch, the modal render slot, and the ambient surfaces. A widget that throws in render shows an error chip, not a dead TUI. |
| `ui-tui/src/sdk/index.ts` | The one import surface a widget app needs. |
| `ui-tui/src/sdk/registry.ts` | defineWidgetApp and the app registry; the slash commands and / completions derive from it, nothing is hardcoded. |
| `ui-tui/src/sdk/types.ts` | The widget-app contract: state + reducer + render, the input vocabulary and the ambient zones. |
| `ui-tui/src/sdk/userWidgets.ts` | Loads and watches user widget apps from $HERMES_HOME/tui-widgets, mirroring the Python plugin contract. |
| `ui-tui/src/theme.ts` | The theme model: DEFAULT_THEME, the skin merge from gateway.ready, and the colour maths the TUI-only derivations build on. |
| `ui-tui/src/types.ts` | The shared client-side types (Msg, ActiveTool, SubagentProgress, TodoItem, SessionInfo, pending submissions). |
| `ui-tui/src/types/hermes-ink.d.ts` | Exports type, type, type, type, type, type. |
| `ui-tui/tsconfig.build.json` | Configuration/module file; no exported symbols detected. |
| `ui-tui/tsconfig.json` | Configuration/module file; no exported symbols detected. |
| `ui-tui/vitest.config.ts` | Configuration/module file; no exported symbols detected. |


### Tier 3 — skipped with a reason

None. Every file in the shard was opened; the note column in the status TSV records, per file,
whether it was a full line-by-line read or a structural extraction.

---

## 2. Ideas worth stealing

1. **The synchronous choke point.** Marking a session busy *before the first `await`* in the one
   function every submission path funnels through closed a real queue race that a later
   `await`-heavy refactor would have re-opened (`ui-tui/src/app/submissionCore.ts:30-48`). August
   Trading's send path (`useSubmission` / the analysis pipeline) has the same shape — a
   `setBusy(true)` that happens *after* an await is the classic bug. **UNIQUE.**
2. **A durable, fsync'd, one-file-per-item input journal written before the composer clears.**
   `write → fsync → rename → fsync(dir)`, `0600` records in a `0700` directory, and a
   `failed`/`inFlight` distinction so an ambiguous write is *retained* rather than re-sent
   (`ui-tui/src/lib/pendingInputs.ts:88-137`). **UNIQUE.** This is the single most transferable
   idea in the shard for a trading app: a submitted order/plan must be recoverable, and the
   journal must be written *before* the UI forgets it.
3. **Separate files over a shared file for concurrent writers.** "Separate files avoid
   read/modify/write loss between two native clients" (`ui-tui/src/lib/pendingInputs.ts:87`), and a
   missing record is treated as *the other client's acknowledgement*, not corruption (`:149-151`).
   **UNIQUE.**
4. **An owner-epoch + generation fence on every lifecycle event.** A delayed push event cannot
   replace the epoch; only an attachment snapshot can; an event with an older generation is
   dropped (`ui-tui/src/app/gatewayCanonicalEvents.ts:25-49`). August Trading has no equivalent of
   "which turn is this event about?" — a proposal/plan event arriving after a session switch has
   no home today. **UNIQUE.**
5. **The generation-bound "lost-reply control" that is retired, never replayed.** A control whose
   reply was lost is kept for inspection but is *never* automatically or manually replayed, and any
   other verb retires it (`ui-tui/CANONICAL_GATEWAY.md:50-51`;
   `ui-tui/src/__tests__/canonicalRetainedControlRetire.test.ts:1-2`). **UNIQUE.**
6. **A read-only "detail reader" that never edits.** The TUI's overlays open a card and the card's
   answer path resolves the request; the card itself is display-only. Compare August Trading's
   `components/shared/DetailModal.tsx`, which is *already* read-only by ruling — the same instinct,
   arrived at independently. **CONVERGENT.**
7. **One eviction entry point for four hot caches, with the reason for not evicting by default
   written down** ("content-keyed, not session-keyed, so cross-session sharing is normally
   beneficial") (`ui-tui/packages/hermes-ink/src/ink/cache-eviction.ts:1-12`). August Trading's
   own cache surfaces should say the same thing out loud. **UNIQUE.**
8. **A status line that reports *what the system is doing*, not just state.** The loop line spells
   out `running now` / `deferred to the goal` / `next in 44m` / `due, waiting for idle`, and the
   goal line spells out its *barrier* (`until 14:30`, `on <type> <target>`) plus the reason
   (`ui-tui/src/app/loopStatus.ts:79-88`; `ui-tui/src/app/goalStatus.ts:44-51`). **UNIQUE.**
9. **A countdown that renders at minute steps.** Rounding up and showing seconds only in the last
   minute keeps an idle TUI to one repaint a minute (`ui-tui/src/app/loopStatus.ts:36-49`);
   the hook returns the *previous object* when the rendered line is unchanged
   (`:92-119`). **UNIQUE.**
10. **A pure, unit-testable recovery budget.** "respawn+resume attempts are capped to 3 within a
    sliding 60 s window", kept as a pure function so the crash-loop case is testable
    (`ui-tui/src/app/gatewayRecovery.ts:1-9`). **UNIQUE.**
11. **Subagent fan-out history as an in-memory ring of the last 10 non-empty snapshots, plus a
    `/replay` diff** (`ui-tui/src/app/spawnHistoryStore.ts:55-71`) — the "I just ran a fan-out, it
    misbehaved" investigation loop. **UNIQUE.**
12. **The roster merge never rolls progress back**, because "snapshot replies may predate
    progress/completion events already rendered"
    (`ui-tui/src/app/agentRoster.ts:102-104`). **UNIQUE.**
13. **Everything user-facing is a pure function over a message catalogue**, so the wording is
    unit-testable without rendering, and the catalogue is resolved at *call* time so a locale swap
    is observed (`ui-tui/src/app/userMessages.ts:1-3`; `ui-tui/src/i18n/runtime.ts:1-4`;
    `ui-tui/src/__tests__/libTextI18n.test.ts:1-2`). **CONVERGENT** with August Trading's
    `i18n`-free but message-central approach; the *call-time* resolution rule is the transferable
    part.
14. **A regression test that asserts an INVARIANT rather than an exact byte run.** "The heal may
    also erase scrollback depending on which recovery path runs, so assert the invariant — screen
    erased, then content repainted after — rather than an exact byte run"
    (`ui-tui/src/__tests__/ink-resize.test.ts:1-3`). **CONVERGENT** with August Trading's
    `render-probe` philosophy of asserting rendered outcomes, not internals.
15. **A native probe that keeps the settled snapshot BEFORE starting the reconnected viewer**, or a
    late live delta will conceal broken history hydration
    (`ui-tui/CANONICAL_GATEWAY.md:88-89`). **UNIQUE.**
16. **A single clock.** `useInterval` piggybacks on one shared `ClockContext` clock, "so all timers
    consolidate into one wake-up", and subscribes as a *non-keepAlive* subscriber
    (`ui-tui/packages/hermes-ink/src/ink/hooks/use-interval.ts:40-70`). **CONVERGENT** with
    August Trading's single-animation-frame discipline in the render probe.
17. **Refuse to open a URL the model could have chosen.** `parseSafeUrl` accepts only `http`/`https`
    and rejects `file:`, `javascript:`, `data:`, `vbscript:`, `mailto:` and `ftp:` "would let a
    hostile model trigger arbitrary local handlers"
    (`ui-tui/src/lib/openExternalUrl.test.ts:1-4`). **UNIQUE.**
18. **A "notice held while busy, TTL clock starts when it becomes visible" rule**, with the flush
    called from the three real turn-end sites and *never* from `idle()`/`reset()` so a session's
    notice cannot bleed into the next session
    (`ui-tui/src/app/turnController.ts:198-207`, `:300-306`, `:317-327`). **UNIQUE.**

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work.** The TUI does not run cron itself; it *renders* the
  gateway's standing `/loop` and `/goal` controls. The reliability story is in the snapshot
  contract: the gateway publishes on set/pause/resume/stop, when a wakeup fires and when it
  completes, so `next_due_at` is always the live anchor and the countdown is derived client-side
  (`ui-tui/src/app/loopStatus.ts:9-11`). There is **no catch-up for missed runs** and **no breaker
  after repeated empty runs** in this shard — that logic lives in the Python `cron/` directory,
  which is a different shard. The client-side rule that transfers: *publish on every state
  transition, not on a timer*, and derive the countdown from the published anchor.
- **Human-in-the-loop approval.** Two paths coexist. The legacy path is a **server→client JSON-RPC
  request** that opens a card; the canonical path is a **broadcast event carrying a `prompt_id`**,
  answered through `approval.respond` / `clarify.respond` (`ui-tui/src/app/gatewayCanonicalEvents.ts:67-71`).
  The approval record is the transcript: a settled clarify leaves a collapsed `Clarify("N
  question(s)")` tool row *and* a user bubble of `question → answer` lines, with a blank answer
  rendered as *skipped* (`ui-tui/src/app/clarifyTranscript.ts:13-22`). Approval choices are
  `once` / `session` / `always` / `deny`, and the permanent-allow option is dropped **only** on an
  explicit `false` from the backend (`ui-tui/src/app/createServerRequestHandler.ts:79-80`).
- **Post-mortem / reflection loops.** Not in this shard. The TUI persists a *spawn tree* of
  finished subagent fan-outs so `/replay` can re-open them, and the rule is a **bounded ring of
  the last 10 non-empty snapshots** with the scope stated out loud ("Disk persistence across
  process restarts is a natural extension but adds RPC surface for a less-common path")
  (`ui-tui/src/app/spawnHistoryStore.ts:55-71`). There is no scoring, retirement or consolidation
  of lessons in this shard — that lives in the Python `agent/` directory.
- **Multi-agent.** Subagents, not debate. The TUI renders a **spawn tree** reconstructed from a
  flat event-ordered list by `parentId`, where a missing/unknown parent is treated as a top-level
  spawn of the current turn (`ui-tui/src/lib/subagentTree.ts:3-5`). The roster merges live events
  with a server snapshot and **never rolls progress back**
  (`ui-tui/src/app/agentRoster.ts:102-104`); **async records are completion units, not agents** and
  never invent rows (`:109-111`); late events after turn end are dropped rather than resurrecting a
  finished child (`ui-tui/src/app/turnController.ts:1117-1124`); the roster is ordered **by spawn
  (depth, parent, index)** rather than insert time because events arrive out of order under
  concurrency (`turnController.ts:1174-1180`). Steering a child is *queued for the next tool
  boundary*, "not confirmed delivery" (`ui-tui/README.md`, "Live agents"). No debate mechanism
  appears in this shard.
- **Structured logs the model can query.** The TUI's durable log is **one JSON file per pending
  input** under `<HERMES_HOME>/tui-pending-inputs/`, each with a `submissionId`, the destination,
  the prepared text, attachments, the control method and the execution generation
  (`ui-tui/src/lib/pendingInputs.ts:100-133`). It is deliberately *not* a database — no SQLite, no
  index, no query language. The crash breadcrumb log is a plain append-only file
  (`~/.hermes/tui-parent.log`) that mirrors the Python gateway's panic log so the two interleave by
  timestamp (`ui-tui/src/lib/parentLog.ts:1-3`).
- **Staying simple as features accumulate.** The strongest mechanisms are all *negative*: the
  slash command that the TUI does not know **falls through to the gateway** rather than being
  implemented twice (`ui-tui/README.md:397-406`); the overlay taxonomy is a **single list** so a new
  overlay cannot be silently missed by a gate (`ui-tui/src/app/overlayStore.ts:141-154`); the
  i18n catalogue is **derived from the bundled English catalog** so adding a string *is* the schema
  change (`ui-tui/src/i18n/types.ts:1-3`); and the widget SDK's slash commands and `/` completions
  are **derived from the registry** — "nothing is hardcoded"
  (`ui-tui/src/sdk/registry.ts:1-2`).

---

## 4. Non-obvious decisions and gotchas

1. **A ctrl chord is never typed text.** The PTY force-redraw byte `Ctrl+L` (0x0c) arrives on the
   TUI's stdin on every re-attach; a naive parser turns it into a literal `l` in the composer
   (`ui-tui/packages/hermes-ink/src/ink/events/input-event.ts:175-189`).
2. **Bold and dim share one reset code.** Any diff engine that treats "same endCode" as "same slot"
   corrupts the terminal's weight state, and the corruption compounds because later transitions are
   computed from the tracked state (`ui-tui/packages/hermes-ink/src/ink/ansi-transition.ts:3-14`).
3. **`$isBlocked` and `$isStatusRuleOccluded` are different questions.** The first is "is input
   suspended"; the second is "does an overlay paint over the status rule" — the flow overlays push
   content down and do **not** cover it, so their clocks must keep running
   (`ui-tui/src/app/overlayStore.ts:75-115`).
4. **`{!cmd}` interpolation runs at send time, not at queue time**; a queued draft keeps the raw
   text (`ui-tui/README.md:307-308`).
5. **The busy flag must be set before the first `await`**, or a second Enter races a second
   `prompt.submit` onto the backend (`ui-tui/src/app/submissionCore.ts:30-45`).
6. **A `rejected` busy correction is only re-submitted when the owner says it was *undelivered*.**
   A plain rejection may follow delivery, and re-sending it would run the correction twice
   (`ui-tui/src/app/submissionCore.ts:163-172`).
7. **A failed turn discards the whole unsealed turn; a completed one keeps the streaming tail; an
   interrupted one keeps it as `partial`** — three different rules for three different endings
   (`ui-tui/src/app/turnController.ts:655-669`).
8. **The TTL clock of a notice starts when it becomes visible, not when it arrives**
   (`ui-tui/src/app/turnController.ts:200-207`).
9. **`raw mode` belongs in `useLayoutEffect`**, not `useEffect` — otherwise keystrokes echo for one
   tick (`ui-tui/packages/hermes-ink/src/ink/hooks/use-input.ts:47-52`).
10. **A `stdout.write` that has not drained means the frame is coalesced, not queued** — the
    alternative starves the stdin reader and wedges input
    (`ui-tui/packages/hermes-ink/src/ink/ink.tsx:778-806`).
11. **`process.stderr.write` is intercepted** so a third-party dependency cannot corrupt the
    alt-screen buffer (`ui-tui/packages/hermes-ink/src/ink/ink.tsx:2675-2731`).
12. **The exit path resets terminal modes in a specific order**, alt-screen first, so the cleanup
    sequences land on the main screen (`ui-tui/packages/hermes-ink/src/ink/ink.tsx:2528-2570`).
13. **A slash alias can collide with a backend alias.** `/q` was bound to `quit` in the TUI and to
    `queue` in Python; TUI-local commands dispatch first, so the TUI won and the backend's meaning
    was unreachable (`ui-tui/src/__tests__/slashParity.test.ts:1-3`).
14. **A model that prints a literal `<think>` in prose must not swallow the rest of the reply.**
    The split is anchored to start-of-input, and the trailing unclosed tag is only treated as
    reasoning when it *leads* (`ui-tui/src/lib/reasoning.ts:1-3`).
15. **A 40 KB tool result must not be embedded whole** — "the persisted, expanded-by-default trail
    block is what blew up the Ink render tree and silently OOM-killed the TUI"
    (`ui-tui/src/__tests__/text.test.ts:1-2`).

---

## 5. Weak spots

1. **`packages/hermes-ink` is a 282 KB fork of a third-party renderer**, and the fork carries its
   own ANSI parser, screen buffer, selection model, yoga build and terminal-mode lifecycle
   (`ui-tui/packages/hermes-ink/src/ink/ink.tsx`, `screen.ts`, `selection.ts`,
   `native-ts/yoga-layout/index.ts`). That is a very large surface to keep in step with upstream
   Ink, and the `entry-exports.ts` comment records a real casualty — bundling a second copy of Ink
   through `ink-text-input` deadlocked the bundle at startup (#31227)
   (`ui-tui/packages/hermes-ink/src/entry-exports.ts:30-56`).
2. **The TUI is doing a lot of authority reasoning in the client.** The epoch/generation fence,
   the CAS tuple on session mutations, the lost-reply control retirement and the pending-input
   ownership chain are all client-side (`ui-tui/src/app/gatewayCanonicalEvents.ts:28-49`;
   `ui-tui/src/app/slash/canonicalSessionControls.ts:1-6`; `ui-tui/src/lib/pendingInputs.ts:30-87`).
   A client-side authority check is a rule the *server* can change without the client noticing.
3. **A very large test surface is anchored on a mock gateway** — `createGatewayEventHandler.test.ts`
   alone is 96 KB and `createSlashHandler.test.ts` 46 KB
   (`ui-tui/src/__tests__/`). The suite proves the client's state machine; it cannot prove the
   protocol. The repo compensates with the native PTY probes
   (`ui-tui/scripts/native_canonical_probe.py`), which is the right answer but a slow one to run.
4. **The canonical-gateway migration is visibly incomplete**, and the repo says so: "Runtime
   descriptions and session metadata are intentionally narrow", "Rich legacy RPCs outside these
   controls … are not claimed implemented", "Secret/sudo and batch clarification are not claimed
   supported" (`ui-tui/CANONICAL_GATEWAY.md:56-72`). Two protocols for approvals (a server→client
   request *and* a `prompt_id` event) are live at once
   (`ui-tui/src/app/createServerRequestHandler.ts:19-27`;
   `ui-tui/src/app/gatewayCanonicalEvents.ts:67-71`).

