# pi :: pi-durable

**Files in shard:** 219 (read: 219, skipped with reason: 0)
**What this shard covers:** `@earendil-works/pi-durable` v1.4.0 — the durable conversation/task/document runtime of the Pi harness, and the single most interesting package in the reference set. It owns the transcript (an append-only entry log with head markers, edits and forks), a versioned document store with four storage backends (memory, IndexedDB, JSONL, SQLite), the Harness itself (generation, tool calls, compaction, live progress, a durable task scheduler, inbox, telemetry), a pluggable sandboxed execution environment, coding tools (read/write/edit/bash), a "code mode" where the model writes JavaScript that calls other tools, and a BM25 tool-search mechanism for deferring tool declarations out of the prompt.

The whole design is one sentence from `docs/spec.md`: *"A Session atomically commits immutable entries, full task records, and Chord-tracked documents. Only committed state is observable."* Everything else — the fork semantics, the compaction rules, the replay-safe code mode, the restart-limit breaker — follows from that sentence.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/durable/src/types.ts`
- **Purpose:** the type vocabulary every other file imports: `Id<Kind>`, `Seq`, `ConversationId`/`EntryId`/`TaskId`/`SubmissionId`/`DocumentId`, and the record shapes (`ConversationRecord`, `EntryRecord`, `TaskRecord`, `SubmissionRecord`, `DocumentRecord`).
- **Key abstractions:** `Id` is a *nominal number* — one global integer namespace across all record kinds, brand-only at compile time (`src/types.ts:20-37`). `ROOT_CONVERSATION_ID = 1` is reserved forever (`src/types.ts:46`). `TaskState` is a 6-way union: `pending | running | waiting | sleeping | completing | terminal` (`src/types.ts:621-686`).
- **Data flow:** types only; no runtime behaviour. `TaskRecord` splits on state: live states may carry `memos` (first-writer-wins scratch), terminal states may not (`src/types.ts:706-724`).
- **Non-obvious design decisions:** `DocumentSemantics` is a *scope + history + fork* triple chosen at definition time, and only conversation documents declare `history` (`latest` vs `rewindable`) and `fork` (`asOf`/`current`/`initial`) (`src/types.ts:50-70`). That single choice decides whether a document's old values stay addressable and what a fork inherits — and it is decided by the *data*, not by the harness.
- **Edge cases & failure handling:** `TaskRecordBase.restarts` counts "times in a row a crash cut it off while it ran **without the task changing its state**"; a clean close does not count (`src/types.ts:687-696`). `abortReason: "restart"` is distinct from an abort request.
- **Surprising:** `ConversationOwnership` is `ownerless | task`. There is no "owned by a conversation" — a conversation is owned by a *task*, or by nobody. This inverts the usual intuition and is what makes abort cascades work.

#### `packages/durable/src/ids.ts`
- **Purpose:** 377 bytes; brands a plain number into an `Id<Kind>` and rejects unsafe integers.
- **Key abstractions:** `idFromNumber<I>(n)`, `seqFromNumber(n)`.
- **Data flow:** pure cast + validation; every backend uses it so the "one global ID namespace" rule cannot be broken by a backend that forgets.
- **Non-obvious design decisions:** the brand is compile-time only; the runtime guarantee comes from the *storage* (`storage/memory.ts` keeps a `recordTypes: Map<Id, TableName>` so an ID minted for a task cannot be reused for an entry — see `test/storage-memory.ts` and the conformance case "keeps one global record ID namespace and rejects exhausted ID minting").
- **Edge cases & failure handling:** `Number.MAX_SAFE_INTEGER` is the exhaustion point; minting past it throws "ID space is exhausted".
- **Surprising:** the *type* safety is nominal but the *value* safety is a storage invariant — a neat split that keeps the hot path free of runtime checks.

#### `packages/durable/src/errors.ts`
- **Purpose:** the package's error taxonomy: `SessionFailed`, `StorageRequestError`, `ReadAfterWrite`.
- **Key abstractions:** `SessionFailed` (the Session is dead and must be reopened), `StorageRequestError` (the caller's request was invalid — *this call* fails, the Session survives), `ReadAfterWrite` (a read inside a write transaction that would not see the write).
- **Non-obvious design decisions:** the distinction between "your request was bad" and "the backend died" is load-bearing. `session/session.ts:1100-1112` uses it: an invalid read or a caller-cancelled read is *exempt* from failing the Session; anything else is fatal.
- **Surprising:** a storage error is **final**. There is no retry at the Session layer; the spec says "retry transient failures inside the Storage" (`docs/spec.md` §10.1).

#### `packages/durable/src/entries.ts`
- **Purpose:** the built-in entry kinds and their `defineEntry` token helpers.
- **Key abstractions:** `AssistantEntry`, `UserEntry`, `SystemEntry`, `ToolResultEntry`, `ResetEntry`, `CompactionEntry`; `defineEntry<T>(kind)` returns a typed token for `tx.appendEntry`.
- **Non-obvious design decisions:** an entry has two channels — `model` (the provider messages it contributes to the next request) and `data` (app-only, never sent). A `ResetEntry` is a head marker that starts a *new* context while the old entries stay stored.
- **Surprising:** `ResetEntry` is not a message; it is a context boundary. `harness/generation.ts:717` uses it to implement the "handoff" reset (`control: { handoff }`).

#### `packages/durable/src/documents.ts`
- **Purpose:** the typed-document system: definitions, address resolution, versioning, migration, scope checking.
- **Key abstractions:** `defineDoc<T>(def)`, `defineDocFamily<T, Seed>(def)`; `resolveAddress`, `addressId`, `documentCreate`, `checkRecordScope`, `checkRecordVersion`, `materializeDocument`.
- **Data flow:** a *definition* (kind, version, scope, history, fork, `initial`, optional `migrate`, mandatory `checkpointWhen`) + a set of *arguments* resolve to a `DocumentAddress` → an `addressId` (a stable JSON string identity) → a `DocumentCreate` record → a `DocumentRecord` in storage.
- **Non-obvious design decisions:** `addressId` is `JSON.stringify([kind, scopeKind, owner, key ?? null])` — a *logical* identity that survives re-creation of the incarnation. `checkRecordVersion` refuses a stored version newer than the definition ("has newer version N than M") and refuses an older one with no `migrate` ("requires migration from version N") — so a downgrade is a loud error, not a silent coercion.
- **Edge cases & failure handling:** `checkRecordScope` rejects a typed access whose token disagrees with the persisted scope/history/fork, which is what stops a `latest`-history document from being read as `rewindable`.
- **Surprising:** `definition.family === true` adds a *key* argument to the address, and the key is validated to be non-empty, slash-free, not `__proto__`, and not a positive integer (which would collide with default family keys) — see `harness/tool.ts:checkKey`.

#### `packages/durable/src/tasks.ts`
- **Purpose:** 338 bytes; `defineTask` — the identity function that types a task definition (name, version, initial, `phases`, `abort`, optional `migrate`/`hooks`).
- **Non-obvious design decisions:** a task is a *state machine keyed by a `phase` string*, not a promise chain. The phase name lives in the durable checkpoint, so recovery re-enters the phase by name.
- **Surprising:** the identity function is the *only* thing the package gives a task author, yet it is where the whole "durable task" idea is expressed — a task is data plus a set of named handlers.

#### `packages/durable/src/timers.ts`
- **Purpose:** the host-timer abstraction: `hostTimers` (background timers that never keep the process alive) and `nativeTimer`.
- **Key abstractions:** `SetTimer` — `background(fn, delay)` returns a disarm function or `undefined` if the host declines; `foreground` falls back to `setTimeout` when the host throws or declines.
- **Non-obvious design decisions:** Cloudflare Workers declines background timers (the object must be allowed to sleep), so the whole scheduler, the document-eviction sweep and the sleep timers all degrade gracefully. `test-workers/wake.test.ts:57-65` asserts `nativeTimer(..., { background: true })` returns `undefined` in Workers, and that a Durable Object can then actually be evicted.
- **Why it transfers:** August Trading runs in a browser tab and an Electron shell; a timer abstraction that can be *declined* is what lets the same scheduler survive a backgrounded tab.

#### `packages/durable/src/truncate.ts`
- **Purpose:** the shared truncation arithmetic for tool output: `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`, `utf8ByteLength`, `truncateHeadOf`, `formatSize`.
- **Key abstractions:** truncation is measured in **UTF-8 bytes** and in **lines**, and it never splits a line when the byte limit is hit.
- **Non-obvious design decisions:** a trailing newline is *not* counted as an extra line (pinned by `test/env-truncate.test.ts` and `test/tools.test.ts`). The byte count is computed without `Buffer` so the same code runs in Workers and in the browser (`test/fixtures/utf8-byte-length-without-buffer.ts`).
- **Why it transfers:** August Trading's transcript rows and tool outputs need the same "never split a code line, always report what was dropped" rule.

#### `packages/durable/src/search.ts`
- **Purpose:** BM25 ranking over the deferred-tool catalogue.
- **Key abstractions:** `rankDocuments(query, documents)`.
- **Why it transfers:** August Trading has a large tool catalogue (skills, validation tools, desk tools). A BM25 ranker over tool descriptions is cheaper and more predictable than an embedding store, and it is re-rankable at request time.

#### `packages/durable/src/index.ts`
- **Purpose:** the package's public barrel: `Harness`, `createSession`, `createRegistry`, `defineDoc`, `defineDocFamily`, `defineEntry`, `defineTask`, `defineTool`, `defineExtension`, `hook`, `section`, `wrapTool`, `wrapSection`, `watchEvents`, plus the built-in documents (`AgentDoc`, `LiveDoc`, `InboxDoc`, `UsageDoc`, `CompactionEntry`, `AssistantEntry`).
- **Non-obvious design decisions:** the barrel exports *documents* as first-class values. A host that wants to see the harness's live state reads `tx.doc(LiveDoc, conversationId)` — there is no side channel.

#### `packages/durable/src/harness/define.ts`
- **Purpose:** the typed constructors: `defineTool`, `defineExtension`, `hook`, `section`, `wrapTool`, `wrapSection`.
- **Key abstractions:** `defineTool` infers the argument type from a TypeBox `TSchema` and the details type from what `execute` returns; `hook(Task, handlers)` ties a hook to a specific task definition; `section(name, produce, opts)` declares a system-prompt section.
- **Non-obvious design decisions:** `wrapTool` must not rename the tool — `applyWrap` in `harness/agent.ts` throws "Wrapper renamed X to Y" and *deletes* the wrapped tool, so a bad wrapper cannot silently shadow the original.
- **Why it transfers:** the "a wrapper may not rename what it wraps" rule is a one-line invariant that prevents a whole class of tool-override bugs.

#### `packages/durable/src/harness/json.ts`
- **Purpose:** 1.3 KB; `assignJson` — the one place a JSON value is validated as assignable to a draft.
- **Why it transfers:** a single chokepoint for "is this safe to write into a durable document" is worth copying; August Trading's notebook writes have the same requirement.

#### `packages/durable/src/harness/provider.ts`
- **Purpose:** 1.5 KB; `ensureProviderSessionId` — creates the provider-side session (Anthropic/OpenAI "previous_response_id" style) for a conversation before it is needed.
- **Non-obvious design decisions:** it is called from the compaction path too (`harness/compaction.ts`), because a legacy conversation must have a provider session created *before* its summarization request — pinned by `test/harness-compaction.test.ts` "creates provider state before a legacy conversation's summarization request".

#### `packages/durable/src/harness/util.ts`
- **Purpose:** 2.4 KB; `scanAll` (paged scan helper), `Waiters`, `contained` (run a callback, report its throw without breaking the caller), `optionalExtension`, `closedError`.

#### `packages/durable/src/harness/registry.ts`
- **Purpose:** the in-process registry of extensions: install / replace / remove, with a `snapshot()` and `subscribe()`.
- **Non-obvious design decisions:** the registry is *not* persisted — it is this process's code (`README.md`, "Extensions"). A stored choice is a **name**, not a closure, so a restart binds to whatever code the new process installs (`test/examples/31-reload-and-restart.ts`).
- **Why it transfers:** storing tool *names* rather than tool *implementations* is exactly what August Trading needs for its skill/agent reload path.

#### `packages/durable/src/harness/types.ts`
- **Purpose:** 44 KB; the public type surface of the Harness — `Harness`, `Conversation`, `Agent`, `Settings`, `Extension`, `ToolRegistration`, `ToolHooks`, `GenerationHooks`, `CompactionHooks`, `ContextView`, `Submission`, `SettledTask`, `TaskInspection`, `RegistrySnapshot`.
- **Key abstractions:** `Extension` (`src/harness/types.ts:372`) bundles `tools`, `sections`, `hooks`, `tasks`, `agents` into one named unit. `ToolRegistration` carries `name`, `description`, `parameters` (TypeBox), `structuredOutputSchema`, `callers`, and `execute`.
- **Non-obvious design decisions:** `callers: ["model"] | ["tools"] | ["both"]` is a *static* declaration of who may invoke a tool, enforced at the tool boundary, and it is separate from what the model is *offered*. `harness-callers.test.ts` pins the asymmetry: "offers the model only tools it may call, and lets tools call only tools they may call", and "narrows what the model is offered with `modelTools`, leaving the rest callable by tools".
- **Edge cases & failure handling:** `ConversationAbortOptions.background` — "Cross background boundaries: mark every live task reached ignoring the background flag when the abort is admitted, withdraw the queued inputs of every conversation reached, and wait until those tasks are terminal". A normal abort deliberately stops at a background boundary; `background: true` reaches past it.
- **Surprising:** the *whole* public API is `types.ts`; the implementation files are internal. The package's stability surface is the types.

#### `packages/durable/src/harness/agent.ts`
- **Purpose:** the per-conversation agent configuration document (`AgentDoc`, `src/harness/agent.ts:43`): model, thinking level, tool selection, prompt sections, and the `AgentChange` apply/merge semantics.
- **Key abstractions:** `createAgent`, `configure`, `resolveAgent`, `resolveSettings`, `agentHooks`, `DEFAULT_RESTART_LIMIT`, `addTools`, `sectionExtension`, `toolExtension`.
- **Data flow:** a conversation's agent is a *document*, not a field on the conversation. `configure(tx, conversationId, change)` merges a partial change into it inside the same commit that starts a run, so a model switch and the request that uses it cannot be split by a crash.
- **Non-obvious design decisions:** the *selected tool set* lives in the agent document, so a per-conversation tool override (`test/examples/30-tool-override.ts`) survives a restart and is applied at request time, not at registration time.
- **Edge cases & failure handling:** `applyWrap` deletes a tool whose wrapper threw or renamed it, and reports the error — a broken wrapper degrades to "tool absent", never to "tool misbehaving".

#### `packages/durable/src/harness/live.ts`
- **Purpose:** the `pi.live` document — the *progress* state of a conversation: the running generation, the tool slots, the nested-tool slots, the compaction statuses, the failure latch.
- **Key abstractions:** `LiveDoc` (`src/harness/live.ts:111`), `toolSlot`, `addCompactionStatus`, `removeCompactionStatus`, `failCompactionStatus`, `endRun`, `clearProgress`.
- **Data flow:** the Harness writes `pi.live` in the *same commits* as the work it describes. A tool slot is a field in a document, so a late joiner sees "tool X is running, output so far is …" by reading a document — not by attaching to a live socket.
- **Non-obvious design decisions:** the live document is *ordinary durable state*, so progress survives a restart and can be read by a second observer. The README's "Agent Events (Experimental)" turns the same commits into a `message_start` / `message_update` / `tool_execution_start` event stream for a UI, with deltas (text append, tool-output front-trim + append) and a fresh `snapshot` event when a consumer falls more than 100 batches behind.
- **Why it transfers:** August Trading's "which trades are the agents currently working on" question is exactly this shape: a durable progress document, read by the UI, updated in the same commit as the work.

#### `packages/durable/src/harness/usage.ts`
- **Purpose:** the `pi.usage` document — token/cost accounting per conversation, keyed by `provider/model`.
- **Key abstractions:** `UsageDoc` (`src/harness/usage.ts:14`), `recordUsage`.
- **Non-obvious design decisions:** `appendAssistant` in `harness/generation.ts:743-751` writes the usage ledger **in the same commit** as the assistant entry, with the comment "REMINDER: every built-in writer of assistant entries goes through here, so the usage ledger stays complete." A separate accounting path would drift.
- **Why it transfers:** August Trading already tracks `modelsUsed` per analysis row; the durable version writes the cost in the same transaction as the content, so the ledger cannot be one write behind.

#### `packages/durable/src/harness/prompt.ts`
- **Purpose:** system-prompt assembly: `replaySections` (read the sections already in the transcript), `renderSections` (produce the current sections), `planSystemEntries` (compute the minimal diff of system entries).
- **Key abstractions:** `planSystemEntries` (`src/harness/prompt.ts:66`) returns *only the difference* between the last system entry and the new one, so the prompt is not rewritten on every turn.
- **Non-obvious design decisions:** the baseline system message only moves when it is still the *first* system message. `docs/spec.md` §2.1 explains why: "Providers treat only a leading system message as the initial prompt and tool set; without one, a later tool change rewrites the request's tool list and invalidates the whole prompt cache. Only the first system message moves, so replay gives the same sections and tools."
- **Why it transfers:** this is the single most directly stealable idea in the shard for August Trading's prompt-cache cost: **never let a system message lose the lead position, and never rewrite the whole system message when only a section changed.**

#### `packages/durable/src/harness/context.ts`
- **Purpose:** turns stored entries into the model context: `readContext`, `readContextFrom`, `captureContextBounds`, `deriveRange`, `orderToolResults`, `emptyView`.
- **Key abstractions:** `ContextView` = `{ entries, contributions, messages }`; a `ContextRange` is the *derived* set of entries the view was built from, with frozen JSON.
- **Data flow:** `readContextFrom(session, storage, conversationId, context, at, previous)` reuses an earlier range when the head marker is unchanged, and scans only the *new* tail otherwise (`src/harness/context.ts:559-595`). The range outlives the read, so its entries are frozen like `MemoryStorage` records.
- **Non-obvious design decisions:** the view and the range are separate objects with separate arrays (`{ ...view, entries: [...view.entries], … }`) so a caller mutating the view cannot corrupt the cache. "freezes kept entries deeply even when storage freezes them shallowly" is pinned in `test/harness-context.test.ts`.
- **Edge cases & failure handling:** a read that finishes *after its task ended* is discarded ("does not keep a read that finishes after its task ended") — a read-after-abort cannot resurrect a context.

#### `packages/durable/src/harness/compaction.ts`
- **Purpose:** the compaction task — select an old prefix of the context, summarize it, and place a summary entry whose `head` is the first kept entry.
- **Key abstractions:** `CompactionTask` (`src/harness/compaction.ts:112`), `compactionPolicy` (:262), `selectCut` (:279), `createCompaction`, `estimateContext`, `serializeConversation`.
- **Data flow:** `selectCut(view, keepRecentTokens)` returns the entry to cut at; the cut is never at a tool result, never at a system entry, never at an error/aborted answer, and never at a display-only entry (`test/harness-compaction.test.ts` pins all six). The summarizer receives a *serialized* transcript: tool results truncated to 2 000 characters (`TOOL_RESULT_MAX_CHARS`, :64), system messages and thinking omitted.
- **Non-obvious design decisions:** the summarization prompt is a **fixed** structured template — `## Goal / ## Constraints & Preferences / ## Progress (Done / In Progress / Blocked) / ## Key Decisions / ## Next Steps / ## Critical Context` — with the instruction "Do NOT continue the conversation… ONLY output the structured summary" (:74). The summary is a *checkpoint another LLM will use to continue the work*, not a prose digest.
- **Edge cases & failure handling:** the compaction is a durable task, so it can be aborted, can fail, can be retried, and can be recovered. When a compaction that a generation *waits for* fails, the generation fails too **without sending a request** (README). A summary whose cut is older than a newer summary's cut settles `stale`.
- **Surprising:** compaction is **not** a special case in the model path — it is an ordinary task with hooks, a checkpoint phase machine, telemetry and a usage ledger. A `beforeCompact` hook can decline or supply its own summary.

#### `packages/durable/src/harness/generation.ts`
- **Purpose:** the generation task — one assistant turn: prepare the request, send it, handle the answer, run tool rounds, decide whether to continue.
- **Key abstractions:** `GenerationTask` (`src/harness/generation.ts:122`) with checkpoint phases `prepare | request | retry | poll | tools`; `startRun` (:753); `appendAssistant` (:743).
- **Data flow:** `prepare` → `request` → (on error) `retry` (sleeping until a backoff deadline) or `poll` (deferred handle) → the answer → `tools` (a round of tool tasks) → back to `prepare` for the next round → `answer` → terminal.
- **Non-obvious design decisions — compaction on overflow:** the overflow check is `message.stopReason === "error" && isContextOverflow(message)` (:542). On overflow the generation **compacts and retries once with the same attempt number**, and "An overflow is never retried: only a compaction can make the next request fit" (:561-567). A normal retryable error uses `retryDelayMs(policy, attempt)` and a `sleeping` checkpoint; an overflow uses a *child compaction task* the generation waits on (`policy: "allSettled"`).
- **Non-obvious design decisions — the inbox boundary:** `answer()` runs `prepareBoundary` and `applyBoundary(tx, boundary, "final" | "postTools", now)`. A `handoff` control replaces the run with a `ResetEntry`; a queued reset *during* a tool round ends the current run with `reason: "reset"` (:724-728). Otherwise the run hands over to a **successor generation** and the queued user inputs ride along (:733).
- **Edge cases & failure handling:** the failure path computes `prepareFailure(tx, runtime)` **before the first table write** ("Read before the first table write; only a failure uses it", :570) so a failed run leaves a written `unanswered` submission with a `model_error` detail.
- **Surprising:** "the last handoff in call order wins" for tool-control handoffs, and a *model* tool call and a *nested* tool call are both "tool tasks" — the difference is only where the receipt lives.

#### `packages/durable/src/harness/tool.ts`
- **Purpose:** the tool task — executing one model-issued or nested tool call, and the receipt.
- **Key abstractions:** `ToolTask` (:125), `NestedCallDoc` (:106, a *task-scoped document family* keyed by the nested call's key), `appendToolResult`, `harnessError`, `MADE_NESTED_CALLS` memo.
- **Data flow:** a model-issued call's result **is its transcript entry**; a nested call's result lives in its caller's `NestedCallDoc`, so the receipt stays small and retires with the caller. A nested call reattaches to its task by key (`c<VM call id>`), so a rerun never runs it twice unless its own replay policy says so.
- **Non-obvious design decisions:** the tool task has a *durable intent* checkpoint — `{ phase: "execute", arguments, replay: "safe" | "unsafe" }` — written **before** execution. A replay-safe call can be re-executed after a restart; a replay-unsafe one cannot. The `MADE_NESTED_CALLS` memo records that a tool task made nested calls *in any attempt*, committed before the first admission of each attempt, so settling can remove their slots.
- **Edge cases & failure handling:** a tool task can be *faulted* (the tool threw) or *orphaned* (its definition disappeared). Both end the call with an error result and leave `pi.live` with no dangling slot ("marks a faulted tool's slot done without an entry").
- **Why it transfers:** the `replay: "safe" | "unsafe"` flag is the exact primitive August Trading needs for a "log this trade" or "place an order" tool that must not run twice across a crash — and the *intent is written before the effect*, so recovery knows the difference.

#### `packages/durable/src/harness/scheduler.ts`
- **Purpose:** 108 KB, 2 507 lines — the durable task scheduler: reservation, invocation, phase stepping, abort cascades, waiting/sleeping, retention of ended chains, and the task graph.
- **Key abstractions:** `TaskScheduler`; `blockedReason(record)` (:448) with `BlockedReason = "missing_task" | "task_too_old" | "migration_failed" | "restart_limit"` (:94); `Invocation`; `Reservation`.
- **Data flow:** a pass scans live tasks newest-first, reserves one by *committing* the reservation (so two schedulers cannot take the same task), builds an `Invocation` with its own `AbortController`, runs the phase handler, and then the phase *decides* — its decision is a commit. The decision is where the durable state advances, so a crash between handler and decision simply re-runs the phase.
- **Non-obvious design decisions — the crash-loop breaker:** `restarts` counts consecutive crashes *without a state change*; at `settings.restartLimit` the task is **parked** with a visible reason instead of being re-run forever (:1365-1367). "counts no restart for a task a close stopped" — a clean close is not a crash. An abort handler cut off `restartLimit` times in a row *faults* rather than looping (:1521-1522).
- **Non-obvious design decisions — the cancellation barrier:** a task whose owner was cancelled does not start its next phase until the cascade's mark has **committed** (`test/harness-cancellation-barrier.test.ts`). The mark is durable before the effect, so a crash cannot leave a child running under a cancelled parent.
- **Non-obvious design decisions — chain retention:** ended subagent chains are forgotten lazily; a chain is *re-loaded* if new work appears below a forgotten owner ("holds a live owner for work later created in a forgotten conversation, loading its chain again"). A 20 000-deep chain of ended tasks is forgotten without recursion (`test/harness-scheduler-retention.test.ts`).
- **Edge cases & failure handling:** a failed reservation commit **fails the Harness** rather than risking a double run. The `#decide` precedence rules (terminal > completing > waiting > sleeping > closing) are explicit and tested.
- **Surprising:** `TaskRuntime.sleep()` was *removed* in 1.4.0 (CHANGELOG) because "it waited inside a phase, which holds an invocation and, after a restart, reruns the phase and restarts the wait". The replacement — `runtime.sleepUntil(until, checkpoint, context)` or returning `{ status: "sleeping" }` — parks the task *between* phases.

#### `packages/durable/src/harness/inbox.ts`
- **Purpose:** the `pi.inbox` document — the ordered list of queued submissions while a conversation is busy.
- **Key abstractions:** `InboxDoc` (`src/harness/inbox.ts:21`), `prepareBoundary`, `applyBoundary`, `withdrawQueuedInputs`.
- **Non-obvious design decisions:** three queue modes — `steer` (reaches the model at its next step), `followUp` (after the current answer), `reject` (dropped). A `write` submission is a passive entry write that never touches the model.
- **Edge cases & failure handling:** a write queued behind a queued reset lands *after* the reset and stays visible; a data-only write appended mid-run does **not** change the request already in flight ("leaves the request unchanged by a data-only write that lands while the generation prepares").

#### `packages/durable/src/harness/submissions.ts`
- **Purpose:** the host-facing submission API: `submit`, `status`, `wait`, `abort`, and the `requestId` de-duplication.
- **Key abstractions:** `Submissions`; a `Submission` is an awaitable handle whose `wait()` resolves to `done` or `unanswered` with a *reason*.
- **Non-obvious design decisions:** `requestId` is a **conversation-scoped host de-duplication key** — a repeated submission with the same request id returns the first one. This is what makes "a subagent gets the message once and the main agent gets the report once" safe across a crash (`test/examples/23-subagent-background.ts`).
- **Edge cases & failure handling:** a stale write submission (its entry was superseded) settles `unanswered` with `reason: "stale"`; a failed run settles its inputs `unanswered` with `reason: "run_failed"`.

#### `packages/durable/src/harness/task-graph.ts`
- **Purpose:** the read-only *task graph* view: every live task, its owner, its state, and what it is blocked on.
- **Key abstractions:** `TaskGraph`, `TaskGraphNode`, `TaskGraphState`, `TaskGraphWatch`.
- **Non-obvious design decisions:** the graph is derived from the *records*, not maintained separately — `stateOf(record)` maps a record to a view node. `blocked` is a first-class field, so a task that cannot run says *why* (`missing_task`, `restart_limit`, `migration_failed`).
- **Why it transfers:** August Trading's "which agent is doing what, and why is it stuck" panel can be a derived graph over the task records with no second store.

#### `packages/durable/src/harness/events.ts`
- **Purpose:** the experimental agent-event stream derived from commits: `watchEvents`, `SnapshotEvent`, `AgentEvent`.
- **Key abstractions:** `MessageChange` (text/thinking/toolcall deltas); `AgentEvent` union: `run_start`, `turn_start`, `message_start/update/end`, `tool_execution_start/update/end`, `inbox_update`, `submission`, `auto_retry_start/end`, `deferred_poll`, plus the `snapshot` event.
- **Non-obvious design decisions:** `tool_execution_update.output` is `{ trimStart?, append? }` or `{ set }` — a *front trim plus an append* of the retained window, so a long tool output is streamed to the UI without resending what it already sent.
- **Why it transfers:** August Trading's transcript rows need the same "one retained window, trimmed at the front, appended at the back" protocol for a live backtest or a long tool call.

#### `packages/durable/src/harness/harness.ts`
- **Purpose:** the public `Harness` object: open/close, `root()`, `conversation()`, `create()`, `fork()`, `submit()`, `compact()`, `abort()`, `waitForTask()`, `getTask()`, `inspect()`, `wake()`, `resume()`, plus the registry snapshot and the `HarnessInspection` view.
- **Key abstractions:** `ConversationImpl`; `CreateTarget` = `root | independent | fork`; `HarnessOptions` (models, registry, settings, now, setTimer, onWake, telemetry, identity, env).
- **Data flow:** every conversation operation is a *transaction* on the Session; the Harness owns the root adapter and never stores it in a `Context`.
- **Non-obvious design decisions:** `HarnessOptions.env` may be a **function of the conversation** — one sandbox per conversation (`test/examples/29-sandbox-per-conversation.ts`). And `HarnessOptions.models` / `settings` may be **functions**, re-read at each request, so a host can change them at runtime ("generation uses the current return value of a models function at each request").

#### `packages/durable/src/harness/telemetry.ts`
- **Purpose:** `DURABLE_TELEMETRY_SCHEMA` — the content-free span/metric schema for the durable runtime.
- **Key abstractions:** spans for submission admission, task phases, committed entries/submissions, checkpoint changes, nested-tool replay; metrics for phase duration and live task counts.
- **Non-obvious design decisions:** error statuses are *fixed categories* — `task_faulted`, `task_failed`, `task_orphaned` — and diagnostics are capped at 500 characters; an aborted phase keeps status `ok`. No error payload leaves the process in the telemetry.

#### `packages/durable/src/harness/view.ts`
- **Purpose:** the `ConversationView` — the UI-facing projection of a conversation: entries, the live state, the agent, the usage, the inbox — plus `conversationViews` and `ConversationViews`.
- **Non-obvious design decisions:** the view is *derived* from committed state, and the README/spec insist "UI reduction and model-context reduction are separate consumers" — the same stored entries serve both the screen and the prompt, but the two reductions are not the same code.

#### `packages/durable/src/session/session.ts`
- **Purpose:** the Session kernel: one mutation line, the loaded-document cache, committed publication, and the storage-failure latch.
- **Key abstractions:** `createSession(storage, { now, documentRetentionMs, setTimer })` (:76), `SessionImpl` (:121), `documentRetention` (:101), `setDefaultDocumentRetention` (:93).
- **Data flow:** every mutation is enqueued on the **mutation line** and holds it through storage settlement and committed-state adoption. "Only committed state is observable. Every commit callback, preparation, Storage settlement, adoption, and publication enqueue runs while the line is held; listeners run later."
- **Non-obvious design decisions — the document cache is bounded by *use*, not by size:** a document with no watch and no attached state leaves the cache once it has not been read or written for the retention period (default 10 minutes), and the next access cold-loads it from Storage. Eviction runs as a job on the line (:656-693). A hot document is re-ordered at most once per *granule* (a tenth of the retention, capped at 1 s), "it may then leave up to a granule early, which costs a reload, while a commit-heavy workload skips the reordering" (:633).
- **Non-obvious design decisions — a storage error is fatal and final:** the first error a Storage method throws (other than a caller-cancelled read or a `StorageRequestError`) latches a failure (:1100-1112). That call gets the error; every later call and every call still underway gets `SessionFailed`; close listeners run at once; the Session then closes itself, Storage included. **Nothing retries.**
- **Edge cases & failure handling:** a failed *commit* still settles durably if the committer was cancelled while it was in Storage ("settles durably a commit whose committer was cancelled while it was in Storage", `test/harness-lifecycle.test.ts`). A commit that settles during close publishes no frame.
- **Surprising:** the "immutable root conversation" is ID 1 and can never be re-created — minting starts at 2.

#### `packages/durable/src/session/transaction.ts`
- **Purpose:** the transaction: draft acquisition, document create/copy/retire, submission placement/settlement, and the atomic write plan.
- **Key abstractions:** `Transaction`, `TransactionHost`, `LoadedDocument`, `DocumentEntry`, `DocumentPlan`; `applySubmissionChange`.
- **Data flow:** `tx.doc(Definition, ownerId, key?)` acquires a *draft*; the draft is a Chord tracker. At settle, every open change is prepared into a `StorageWrite` batch, and one `storage.commit()` writes them all.
- **Non-obvious design decisions:** the Session "synchronously prepares or aborts every open change" when the callback settles (spec invariant 6) — so a draft can never outlive its transaction. A retirement of a *fork copy* is deferred until the copy is committed. A `document.create` for a `conversation` scope **requires the conversation to exist**; a `task` scope requires the task to exist and to be non-terminal (:634-646).
- **Edge cases & failure handling:** `settleFailure` aborts every change and observes every pending operation; `settleSuccess` aborts *all* changes if any pending operation is outstanding ("Session commit callback settled with a pending operation").
- **Surprising:** a *version change* stores a complete base even without operations, and otherwise only a change stores a delta — and whether it is a base or a delta is decided by the definition's mandatory `checkpointWhen` predicate. Since 1.4.0 there is **no default**: "`defineDoc()` and `defineDocFamily()` require an explicit `checkpointWhen` predicate on every definition; there is no default."

#### `packages/durable/src/session/observation.ts`
- **Purpose:** the Session→Chord bridge: `CommittedStateSource`, `CommittedWatch`, `RETIREMENT_OPERATIONS` (`[["r", null]]`).
- **Non-obvious design decisions:** exactly **100** pending committed frames are retained behind an unavailable watch listener (`MAX_PENDING_WATCH_FRAMES`). A `null` value retires the document incarnation — a canonical terminal update, so every observer sees the same end.

#### `packages/durable/src/session/forks.ts`
- **Purpose:** preparing the document copies a fork needs.
- **Key abstractions:** `prepareForkDocumentCopies(storage, parentConversationId, at, childConversationId, context)`, `ForkDocumentCopy`.
- **Non-obvious design decisions:** a fork copies documents **twice** — once "as of" the fork entry (documents whose `fork: "asOf"`), once "current" (`fork: "current"`). If the fork would select **multiple** source documents for one member, it throws "Fork selects multiple source documents for …" rather than picking one.

#### `packages/durable/src/storage/memory.ts`
- **Purpose:** the in-memory `Storage` implementation — the reference semantics every other backend must match.
- **Key abstractions:** `MemoryStorage`; the in-memory `State` holds `recordTypes`, per-status ID lists, `entryCommitSeqs`, `documentAddresses` (address → `{ ids, currentId }`), `documentIdsByScope`.
- **Data flow:** `commit(writes)` applies every write atomically and assigns a `Seq`; `mintId` allocates from the one global namespace above every ID minted or stored before.
- **Non-obvious design decisions:** returned records are **detached** (deep-cloned with a `clone` that preserves null prototypes and defends against prototype-like keys) so a prepared commit cannot expose retained state — pinned by `test/memory-storage.test.ts` "does not expose retained state through a prepared commit" and by the conformance case "detaches prototype-like JSON keys without changing object prototypes".
- **Edge cases & failure handling:** a `base` revision for a *current-only* document replaces the revision list; a `delta` after a version change without a base is rejected ("crosses a stored version boundary without a base").

#### `packages/durable/src/storage/jsonl/storage.ts`
- **Purpose:** the file-based backend: a `main.jsonl` commit log plus one **sidecar** file per document and per task.
- **Key abstractions:** `JsonlStorage` (:242), `JsonlCorruptionError`, `JsonlStoragePoisonedError`; `MainMarker` (a commit: seq + ordered operations) and `SidecarRecord`.
- **Data flow:** a commit serializes the marker **and every sidecar payload** first, writes the sidecars, then appends the marker — the marker is the *authorization*. `reclaimSidecars` (:508) then deletes or replaces sidecar files that the marker made redundant (a retired current-only document, a terminal task), writing a `.reclaim` temp file and renaming it into place.
- **Non-obvious design decisions:** a sidecar failure is **poisoning**: `JsonlStoragePoisonedError` says "JSONL storage is poisoned and must be reopened". The reason is the write ordering — a torn sidecar that was never confirmed by a marker must not be trusted, so the whole storage refuses to continue rather than guess.
- **Edge cases & failure handling:** `recover()` (:535) re-reads the main file, deletes stray `.reclaim` files, and requires the commit sequence to **strictly increase**; it truncates a torn UTF-8 tail at the exact byte offset and reuses the unconfirmed sequence. A confirmed record after an unconfirmed sidecar record is rejected.
- **Why it transfers:** "the marker authorizes the sidecars" is a clean, portable write-ahead discipline for a file-based store with no database.

#### `packages/durable/src/storage/indexeddb.ts`
- **Purpose:** the browser backend, backed by IndexedDB with 8 object stores and 16 secondary indexes.
- **Key abstractions:** `IndexedDbStorage`; `INDEXES` (by owner conversation, by owner task, entries by conversation, **head markers by conversation**, tasks by status/conversation/kind/abortRequested/background, submissions by request/conversation/status, documents by address/scope/scopeKind, revisions by kind).
- **Non-obvious design decisions:** the head-marker index is what makes "the newest head marker" a single indexed lookup. `entry(conversationId, id)` walks the fork ancestry and caps the upper entry id at each ancestor's `at`, so a fork cannot read past its cut.
- **Edge cases & failure handling:** one `readwrite` transaction is kept active across many mixed writes, and a later failure rolls the whole batch back ("rolls back table writes when a later document copy fails").

#### `packages/durable/src/storage/sqlite/storage.ts`
- **Purpose:** the SQLite backend, portable across Node and Cloudflare Durable Objects.
- **Key abstractions:** `SqliteStorage`; `SqliteStorageOptions.prefix` (a table/index namespace that must be a SQLite identifier and must not use the reserved `sqlite_` prefix).
- **Data flow:** the record's JSON is stored in a `record` column and indexed columns carry the queryable parts (`conversation_id`, `status`, `scope_kind`, `owner_id`, `kind`, `key_value`). Indexed string identities are stored as `JSON.stringify(value)` "Some SQLite bindings replace lone UTF-16 surrogates. JSON encoding keeps indexed identities lossless."
- **Edge cases & failure handling:** a multi-query read is *admitted* and counted, and `close` waits for admitted reads to drain before closing the database ("Close waits for admitted reads, so their later queries never reach a closed database"). A document read must observe one committed state, so it runs inside a transaction.

#### `packages/durable/src/storage/sqlite/schema.ts`
- **Purpose:** the table and index names for the SQLite schema, prefixable.

#### `packages/durable/src/storage/sqlite/migrations.ts`
- **Purpose:** versioned schema migrations; `createSqliteMigrations(schema)` and `applySqliteMigrationsForSchema`.
- **Non-obvious design decisions:** version 1 → 2 **rebuilds the task table** to admit `sleeping`. A migrated database cannot be opened by 1.3.0 or earlier, "so a deployment cannot roll back past this release" (CHANGELOG) — a deliberate one-way door.

#### `packages/durable/src/storage/sqlite/node.ts`, `packages/durable/src/storage/sqlite/cloudflare.ts`, `packages/durable/src/storage/sqlite/database.ts`, `packages/durable/src/storage/sqlite/index.ts`
- **Purpose:** the platform adapters: open a SQLite storage on Node (`node:sqlite`), open one on a Durable Object's SQLite, the portable `SqliteDatabase` type, and the subpath barrel.
- **Non-obvious design decisions:** `test/storage-runtime-boundary.test.ts` pins that the portable subpaths (`/storage/sqlite`, `/env`, `/storage/jsonl`) contain **no Node imports**, so the same code runs in a Worker, a browser and Node.

#### `packages/durable/src/storage/scan.ts`
- **Purpose:** 1.7 KB; `scanStart`/`nextCursor` — the shared cursor arithmetic for the paged scans.

#### `packages/durable/src/storage/jsonl/index.ts`, `packages/durable/src/storage/jsonl/node.ts`
- **Purpose:** the JSONL subpath barrel and the Node opener.

#### `packages/durable/src/env/index.ts`
- **Purpose:** the **execution-environment interface** — the harness's whole filesystem/process surface, and the boundary that lets a hosted product swap a local sandbox for a container.
- **Key abstractions:** `ExecutionEnv`; `Result<T, E>` (`ok`/`err`/`getOrThrow`/`getOrUndefined`); `FileError` with codes `aborted | not_found | permission_denied | not_directory | is_directory | invalid | not_supported | unknown`; `ExecutionError` with codes `aborted | timeout | shell_unavailable | spawn_error | callback_error | unknown`; `FileWatcher`, `WatchTarget`, `WatchChange`; `BinaryReader`, `TextLineReader`, `DirReader`.
- **Non-obvious design decisions:** **expected failures are returned, not thrown.** A missing file is `err(new FileError("not_found", …))`, not an exception. The comment says it outright: "Result of a fallible operation. Expected failures are returned instead of thrown."
- **Edge cases & failure handling:** `FileError` carries an optional `path` and a `cause`; `ExecutionError` carries an optional `spillPath` — the file with the complete output of a command that timed out or was aborted after crossing the spill thresholds.
- **Why it transfers:** August Trading's tool layer talks to the browser/Electron in two completely different ways. An interface where "expected failure" is a *value* and "the environment failed" is an *exception* is a directly portable contract.

#### `packages/durable/src/env/node.ts`
- **Purpose:** the Node implementation of `ExecutionEnv` — 1 235 lines: files, directories, readers, shell execution, temp files, watchers, process cleanup.
- **Key abstractions:** `NodeExecutionEnv`; `resolvePath` (expands `~`, `file://` URLs, resolves against `cwd`); `toFileError` (maps Node errno codes to the FileError taxonomy); `killProcessTree`.
- **Data flow:** a string command runs through a shell; an argv array runs its program directly, "without shell parsing". Output is streamed to `api.output()` within a retained window and **spilled to a file** once it crosses a 1 MiB high-water mark (`SPILL_HIGH_WATER_MARK`).
- **Non-obvious design decisions:** symbolic links are **refused**, not followed ("Refusing to follow a symbolic link"). `cleanup()` kills every tracked child process tree, so a cancelled turn does not leave a shell running.
- **Edge cases & failure handling:** a missing working directory is reported **before** spawning; a non-zero exit code is a *successful execution result* with an exit code, not an error; a signal-killed process maps to a non-zero exit code; an invalid timeout is rejected before spawning.

#### `packages/durable/src/env/node-watch.ts`
- **Purpose:** the file watcher — implemented by **snapshot diffing**, not by trusting OS events.
- **Key abstractions:** `NodeFileWatcher`, `NodeWatchOptions` (`mode: "native" | "polling"`, `pollIntervalMs`, `maxDirectories`).
- **Data flow:** native events only *trigger a debounced rescan*; a change is the difference between two snapshots plus the event paths.
- **Non-obvious design decisions:** "A replaced file, a renamed or recreated ancestor, or a directory created with its contents therefore never depends on which events an operating system sends. New directories get their watchers before they are scanned again, so nothing written into them before the watcher existed is missed." And: **Windows polls**, because "Windows refuses to rename a directory while another directory below it is open, and a native watcher keeps every watched directory open: watching would break renames of their parents".
- **Edge cases & failure handling:** a directory-budget breach throws `BudgetExceeded`, surfaced as a `FileError("invalid", …)`.

#### `packages/durable/src/env/line-scan.ts`
- **Purpose:** `LineScanner` — one pass over a file that locates a line range, so a huge file need not be read to find line 5 000.

#### `packages/durable/src/env/decode.ts`
- **Purpose:** `StreamDecoder` — a streaming UTF-8 decoder that behaves exactly like decoding the whole buffer, for *any* chunking (including a multi-byte character split across chunks), and keeps a `U+FEFF` that does not start the stream.

#### `packages/durable/src/tools/read.ts`
- **Purpose:** the `read` tool — text and images, with offsets/limits and honest truncation.
- **Key abstractions:** `createReadTool({ images? })` (:89); `ReadToolDetails.truncation`; `readHead` (reads only as far as the truncation needs).
- **Data flow:** the file is opened through the environment's `BinaryReader`; the head is decoded incrementally and read **only** until `DEFAULT_MAX_LINES` newlines or `DEFAULT_MAX_BYTES + 1` bytes is reached (:75).
- **Non-obvious design decisions:** the *diagnostics* (truncation remarks, continuation hints, image-processing remarks) are **details**, not content — "Remarks about truncation, continuation, and image processing are diagnostics; the content is only file text, or one image." A model is told *how* the text was cut without the cut text being contaminated by a preamble.
- **Edge cases & failure handling:** a file that changes while it is read is **re-read** rather than returned cut off; if it changes again, the read fails. An image too large to send is refused **without reading it**; an image wider than the limit is refused by its *header*.

#### `packages/durable/src/tools/write.ts`
- **Purpose:** the `write` tool — writes a file and creates parent directories.

#### `packages/durable/src/tools/edit.ts`
- **Purpose:** the `edit` tool — applies one or more exact-string edits to a file.
- **Non-obvious design decisions:** the edit is matched against the **original**, all edits must be **disjoint**, and the tool returns **two diff formats** ("applies disjoint edits and returns both diff formats"). Malformed argument shapes are *repaired* rather than rejected: "repairs edits sent as a JSON string, a single object, or top-level oldText/newText without mutating" (`test/tools.test.ts`).

#### `packages/durable/src/tools/edit-diff.ts`
- **Purpose:** the diff renderer — a unified-ish view with line numbers, context lines, and a "…" marker for skipped regions; returns the diff and the first changed line.

#### `packages/durable/src/tools/bash.ts`
- **Purpose:** the `bash` / `powershell` tools.
- **Key abstractions:** `BashExecution` (`command`, `cwd`, `env`, `inheritEnv`); `BashPrepare` — a hook that may *change* the script, the working directory and the environment before it runs; `ShellStructuredOutput` = `{ output, truncated, fullOutputPath?, exitCode }`.
- **Non-obvious design decisions:** the PowerShell tool tries `pwsh` then `powershell` and skips a program that cannot start. The structured output repeats the *retained* output plus the exit code, and names the spill file when there was one.

#### `packages/durable/src/tools/env.ts`
- **Purpose:** `requireEnv(api)` — the one place a tool insists that an environment is configured, failing with an ordinary error rather than a crash.

#### `packages/durable/src/tools/file-mutation-queue.ts`
- **Purpose:** a per-path mutation queue so that concurrent write/edit calls on the same file serialise ("keeps the mutation queue locked until an aborted write settles").

#### `packages/durable/src/tools/image.ts`
- **Purpose:** image detection and dimension reading: `detectSupportedImageMimeTypeOf`, `imageDimensions`; detects animated PNGs and full GIF signatures.

#### `packages/durable/src/tools/image-processor.ts`
- **Purpose:** the image-processor contract and the base64 helpers: `ImageProcessor`, `ImageLimits`, `DEFAULT_IMAGE_LIMITS`, `INLINE_IMAGE_TYPES`, `toBase64`, `base64Length`.
- **Non-obvious design decisions:** `toBase64` builds the binary string **8 KiB at a time** — "a single `String.fromCharCode` call with megabytes of arguments overflows the stack" — and the tool-output bench pins that a 3 MiB image encodes within a 128 MB heap.

#### `packages/durable/src/tools/index.ts`
- **Purpose:** the tool bundle: `createCodingTools({ images? })` returning `read`/`write`/`edit`/`bash`/`powershell`; `CodingTools`.

#### `packages/durable/src/tools/path-utils.ts`
- **Purpose:** `resolveReadToolPath` — resolves a tool-supplied path against the environment's `cwd`, including `~` and `file://`.

#### `packages/durable/src/images/index.ts`
- **Purpose:** the Photon (Rust→WASM) image processor: resize, flip, JPEG re-encode at four descending qualities `[80, 70, 55, 40]`, EXIF orientation applied.
- **Non-obvious design decisions:** the processor "keeps at least one pixel on each side of an extreme aspect ratio" and gives up when not even one pixel fits the byte limit — it never produces a zero-dimension image.

#### `packages/durable/src/images/exif.ts`
- **Purpose:** reads the EXIF orientation of a JPEG or WebP **from the bytes, without decoding the image** — including the "Exif\0\0" prefix in WebP chunks and the little/big-endian TIFF variants.

#### `packages/durable/src/images/node.ts`, `packages/durable/src/images/node-worker.ts`, `packages/durable/src/images/cloudflare.ts`
- **Purpose:** the platform image processors: Node (a WASM worker thread so the event loop stays free), the Cloudflare Workers build (a pre-compiled `WebAssembly.Module`, because "Workers cannot compile WebAssembly from bytes at runtime"), and the worker shim.

#### `packages/durable/src/images/photon-wasm.d.ts`
- **Purpose:** an ambient declaration for the WASM module so the build typechecks (`tsconfig.build.json` lists it in `files`).

#### `packages/durable/src/codemode/codemode.ts`
- **Purpose:** the **code mode** — a tool that runs model-written JavaScript in a QuickJS sandbox, and survives a restart.
- **Key abstractions:** `CodemodeRunDoc` (:124) and `CodemodeJournalDoc` (:150), both task-scoped; the `codemode` tool (:88); the extension that installs it (:254).
- **Data flow — the problem it solves** (the file's own header comment): "a script is in-memory VM state. A restart while `await Promise.all(paths.map(p => tools.read({path})))` waits for the last of 200 reads would lose the script and every read it made."
- **Data flow — the solution:** *deterministic replay*. "The VM only runs when the host hands it a result; given the same start data, clock, seed, and results in the same order, it makes the same calls with the same arguments." The journal records one entry per **delivered** result: the VM call id, the clock value, the calls the VM had issued after processing it, and a global's outcome. A rerun starts the script again from the stored start data and hands it the previous results, in order, from the journal written *before* each delivery.
- **Non-obvious design decisions:** a call is launched only once the count of calls issued in the drain that made it is **committed**, so "every key an earlier attempt admitted is at most its last recorded count; a replay checks every recorded count". A rerun **refuses to replay** when the module version or the VM fingerprint changed, when the deadline passed, or when the script diverges (it makes another call, or calls in another order, than the journal says) — each ends the call with an error result.
- **Edge cases & failure handling:** nested tool calls reattach by key (`c<VM call id>`), so they never run twice unless their own replay policy reruns them. The script's outcome is stored **with its store writes in one transaction**, so a rerun after that returns it **without a VM**.
- **Why it transfers:** the "journal the *delivered results* and replay deterministically" pattern is a general technique for any long batch of tool calls, and the "fingerprint the sandbox and refuse to replay across a version change" rule is the safety net most implementations skip.

#### `packages/durable/src/codemode/describe.ts`
- **Purpose:** the code-mode *description* layer: `codemodeDescription`, `codemodeSection`, `CodemodeNamespace`, `namespaceOf`, `sampleOf`, `DEFAULT_CODEMODE_INLINE_BUDGET` — the catalogue the model reads to know what `tools.*` and `models.*` exist.

#### `packages/durable/src/codemode/models.ts`
- **Purpose:** the `models.*` namespace of code mode: `models.classify()` and `models.generateImages()` exposed as ordinary tools.
- **Non-obvious design decisions:** the model is resolved **by provider and id only** — "so a script-supplied baseUrl or headers never receive the credentials". An unknown model produces an error that *says what to do*: "List the classifier models you can use with `models.getAvailableOfType(\"classifier\")`."

#### `packages/durable/src/codemode/output.ts`
- **Purpose:** the code-mode result formatter: lays out text items, console lines and the returned value under a header, cuts text past the token budget to its start and end, and spills the full text to a file.

#### `packages/durable/src/codemode/index.ts`
- **Purpose:** the code-mode subpath barrel.

#### `packages/durable/src/tool-search/tool-search.ts`
- **Purpose:** the deferred-tool mechanism: `createToolSearchTool()` (:55) and `createToolSearchExtension()` (:90) — BM25 search over the tool catalogue, so a large tool set does not have to sit in the prompt.
- **Non-obvious design decisions:** a deferred tool is **not offered to the model** until `tool_search` loads it, and loading **appends its declaration** to the tool list. Loaded tools are tracked **by branch** and survive a reset in the baseline.
- **Why it transfers:** August Trading's tool catalogue is large and growing; a BM25 `tool_search` plus an append-only declaration is a cheap, cache-friendly way to keep the prompt small without hiding capability.

#### `packages/durable/src/tool-search/index.ts`
- **Purpose:** the tool-search subpath barrel.

#### `packages/durable/src/testing/storage-conformance.ts`
- **Purpose:** 1 682 lines — the **shared conformance suite** every storage backend must pass, written runner-independently.
- **Key abstractions:** `createStorageConformance(options)` returns `StorageConformanceCase[]`; the options carry the runner's own `describe`/`it`/`expect` and a `withStorage` provider.
- **Data flow:** the suite creates a root conversation, commits mixed writes, and asserts the *contract* — atomicity and rollback, ID namespace, cursor semantics in both orders, fork-aware scans, document lifecycle (create/copy/change/retire), base vs delta storage, and "rejects every operation after close".
- **Why it transfers:** one conformance suite, run against every backend, is how you keep four storage implementations honest. August Trading has (SQLite/Capacitor, IndexedDB, Preferences/localStorage) and could use exactly this shape.

#### `packages/durable/src/testing/env-conformance.ts`
- **Purpose:** the same idea for execution environments: `createEnvConformance(options)` returns cases that any `ExecutionEnv` must satisfy — files, readers, directory listing, shell, symlinks, watches.
- **Non-obvious design decisions:** a case that waits for a watch latency gets a longer `timeoutMs` — "Cases that wait for an environment's watch latency need longer than a test runner's default timeout."

#### `packages/durable/src/testing/storage-benchmark.ts`
- **Purpose:** the reusable benchmark scenarios (mixed commits, reopen + first exact read) so every backend is measured by the same script.

#### `packages/durable/src/testing/assertions.ts`, `packages/durable/src/testing/runner.ts`, `packages/durable/src/testing/types.ts`, `packages/durable/src/testing/index.ts`
- **Purpose:** the test-harness plumbing: a minimal assertion facade the conformance suite uses so it can run under Vitest *or* a bespoke runner; the case types; the subpath barrel.

#### `packages/durable/src/search.ts` (see above), `packages/durable/src/timers.ts` (see above)

#### `packages/durable/test-workers/worker.ts`
- **Purpose:** a Cloudflare Durable Object that hosts a Harness the way an application would: opened in the constructor, woken by its alarm through `onWake`.
- **Key abstractions:** `TestSession` (a `DurableObject`), the `Reminder` task (`runtime.sleepUntil` → `deliver`), `HEARTBEAT_MS = 60_000`.
- **Non-obvious design decisions:** the object arms a **fallback alarm before anything can throw** — "a fallback before anything can throw: an object whose open or recovery fails is started again" — and it arms the alarm **before** admitting any work, "a process that dies after the commit is still woken".
- **Edge cases & failure handling:** a failed alarm write resets the object (`ctx.abort("Alarm write failed")`) and the alarm is re-armed the next time it starts. The faux model's script position is stored in the object's KV, so a new instance continues the script.

#### `packages/durable/test-workers/cloudflare.d.ts`
- **Purpose:** hand-written typings for the slice of the Workers runtime these tests use — "full Workers types would conflict with Node's".

#### `packages/durable/test-workers/vitest.config.ts`
- **Purpose:** the Vitest config that runs the Workers tests **in workerd itself** (`@cloudflare/vitest-plugin` + `wrangler.jsonc`), with `source` resolution conditions and aliases to `src/`.

### Tier 2 — bulk: a compact table, one row per file

#### Docs and configuration

| File | What it is / what it pins |
| --- | --- |
| `packages/durable/docs/spec.md` | The **normative** specification (303 KB, 5 700 lines, 13 sections). Decides: the core rule ("A Session atomically commits immutable entries, full task records, and Chord-tracked documents. Only committed state is observable."), 8 required invariants (§1), the record contracts (§2), the task state machine and its 5 statuses (§5), structured concurrency and `failFast`/`allSettled` joins (§5.5), durable sleeps and wakeups (§5.6), the inbox's three queue modes (§6), the hook catalogue (§7.2), the tool contract (§7.3), the system-prompt/baseline rules (§7.4), code mode (§7.6), the built-in tasks generation/tool/compaction (§8.3–8.7), the storage contract and its failure rules (§10, §10.1), the backends (§11), 12 "API footguns" (§12) and an explicit non-goals list (§13). |
| `packages/durable/README.md` | The host-facing guide (876 lines). Decides the public API surface: `Harness.open`, `root()`, `submit()`, `wait()`, `compact()`, `abort()`, `watchEvents()`, the `settings.compaction` block (`reserveTokens`/`keepRecentTokens`/`backgroundTokens` + per-model `modelOverrides`), the hook list, the agent-event stream, and the storage-backend choice. |
| `packages/durable/CHANGELOG.md` | The 1.4.0 breaking changes, which *are* the design decisions: `TaskRuntime.sleep()` removed (a sleep inside a phase holds an invocation and re-runs the phase after a restart); the new `sleeping` status; SQLite auto-migrates to schema v2 and cannot be rolled back; the crash-loop breaker (`restartLimit`); and `checkpointWhen` becoming **mandatory** on every document definition. |
| `packages/durable/package.json` | The manifest: 12 public subpath exports (`.`, `./env`, `./env/node`, `./codemode`, `./tool-search`, `./tools`, `./images{,/node,/cloudflare}`, `./storage/{memory,indexeddb,jsonl,jsonl/node,sqlite,sqlite/cloudflare,sqlite/node}`, `./testing`), `"sideEffects": false`, and the scripts (`test` runs Vitest **twice** — once normal, once with `PI_DURABLE_DOCUMENT_RETENTION_MS=0` so eviction is exercised — then the Workers suite). |
| `packages/durable/tsconfig.build.json` | The build config: `rootDir: ./src`, `include: src/**/*.ts`, and `files: ["src/images/photon-wasm.d.ts"]` — the ambient WASM declaration the build needs even though `exclude` drops `**/*.d.ts`. |
| `packages/durable/vitest.config.ts` | The Node test config: `environment: "node"`, `setupFiles: ["./test/setup-document-retention.ts"]`, `test-workers/**` excluded (they run in workerd under their own config), and `source` resolution conditions. |
| `packages/durable/vitest.benchmark.config.ts` | The benchmark config: `include: ["test/**/*.bench.ts"]`, verbose reporters. |

#### Cloudflare Workers test suite

| File | What it is / what it pins |
| --- | --- |
| `packages/durable/test-workers/wrangler.jsonc` | The Workers config: one Durable Object class `TestSession` with a `new_sqlite_classes` migration. |
| `packages/durable/test-workers/storage.test.ts` | Runs the **whole storage conformance suite** inside a Durable Object SQLite, and pins the v1→v2 migration: a version-1 schema rejects the `sleeping` status, the migration rewrites the task table and preserves the rows and the five task indexes. |
| `packages/durable/test-workers/wake.test.ts` | Pins the durable-sleep story end to end: a task sleeps through two Durable Object evictions and resumes from its alarm; a turn cut off mid-stream is recovered through the heartbeat alarm (the same `requestId` finds the submission admitted before the eviction); and an object whose Harness keeps idle documents can still be evicted because the Workers host declines background timers. |

#### Examples (`packages/durable/test/examples/`) — the tutorial, one runnable file per idea

| File | What it is / what it pins |
| --- | --- |
| `packages/durable/test/examples/00-conversation.ts` | The floor: a Session, a transaction callback, and the meaning of "ownerless". |
| `packages/durable/test/examples/01-documents.ts` | A conversation-scoped document and the `rewindable` + `fork: "asOf"` semantics. |
| `packages/durable/test/examples/02-forks.ts` | Forking a conversation and what a fork copies from the documents. |
| `packages/durable/test/examples/03-owned-conversations.ts` | A background task that owns a child conversation; all three records created in one commit. |
| `packages/durable/test/examples/04-chord-state.ts` | Exposing a document as a Chord replicated state. |
| `packages/durable/test/examples/05-watches.ts` | Serialising asynchronous document work with a watch. |
| `packages/durable/test/examples/06-harness.ts` | Opening a Harness over a registry of extensions; "Nothing in the registry is saved; it is this process's code." |
| `packages/durable/test/examples/07-configuration.ts` | Per-conversation agent choices vs Harness-wide settings; tools carrying app metadata. |
| `packages/durable/test/examples/08-harness-conversations.ts` | Conversation handles, typed entries (`defineEntry`), created conversations, forks. |
| `packages/durable/test/examples/09-context.ts` | How stored entries become model messages: head markers, edits, omitted aborted/error/deferred answers, tool results in call order. |
| `packages/durable/test/examples/10-registry-reload.ts` | Installing, replacing and wrapping extensions at runtime. |
| `packages/durable/test/examples/11-extension-state.ts` | An extension keeping its own per-conversation document (a todo list) with `fork: "asOf"`. |
| `packages/durable/test/examples/12-tasks.ts` | A durable task as a state machine: "save what you are about to do, do it, then save the result" — so a crash reruns a step that must be safe to repeat (the fake payment service ignores a repeated key). |
| `packages/durable/test/examples/13-recovery.ts` | Close, reopen over a SQLite file, and continue where the task stopped. |
| `packages/durable/test/examples/14-chat.ts` | One chat turn with the faux provider and a prompt section. |
| `packages/durable/test/examples/15-system-prompt.ts` | System-prompt sections and per-conversation instructions. |
| `packages/durable/test/examples/16-real-model.ts` | The same with OpenAI, and `LiveDoc` as the progress surface. |
| `packages/durable/test/examples/17-coding-tools.ts` | A full coding-agent tool turn on JSONL storage, with a hook that times a `cat` of a 1 GB file. |
| `packages/durable/test/examples/18-print.ts` | Print mode (`pi -p`): one prompt, one answer, awaiting *its own* submission rather than global idle. |
| `packages/durable/test/examples/19-json.ts` | JSON mode (`pi --mode json`): the agent-event stream and the raw conversation-view op stream, with a storage-backend switch. |
| `packages/durable/test/examples/20-inbox.ts` | What happens to submissions while a conversation is busy. |
| `packages/durable/test/examples/21-late-join.ts` | A client attaching mid-run: it gets the current state first, then only what changes. |
| `packages/durable/test/examples/22-subagent-foreground.ts` | A foreground subagent tool: the parent's call creates a child conversation it owns, runs one task there and returns the child's answer; aborting the call aborts the child. |
| `packages/durable/test/examples/23-subagent-background.ts` | Persistent background subagents — the multi-agent pattern in full: each subagent is its own conversation; the main conversation keeps a name→conversation document; a **background anchor task** owns the subagent so it outlives the main agent's turns; a `Reporter` task delivers a message and reports the answer back, using `requestId` so neither side double-processes. |
| `packages/durable/test/examples/24-child-tasks.ts` | A task that owns child tasks: a checkout charges four payments at once, waits with `policy: "failFast"`, and prints the task graph as a tree. |
| `packages/durable/test/examples/25-compaction.ts` | A long trip-planning chat compacted against a fake 3 000-token window that also *rejects* a request as too long, the way a real provider reports an overflow. |
| `packages/durable/test/examples/26-coding-agent.ts` | A small coding agent: built-in tools, a prompt that knows the working directory, settings backed by a file, and an environment that follows the conversation's directory. |
| `packages/durable/test/examples/27-plan-mode.ts` | Plan mode: switch a conversation to read-only, have the agent write a plan into the extension's own document, switch back. |
| `packages/durable/test/examples/28-reviewer.ts` | A reviewer agent beside the main one — cheaper model, review role and loop, read-only tools, its own checkout of the project. |
| `packages/durable/test/examples/29-sandbox-per-conversation.ts` | One sandbox per conversation: the app records the sandbox in its own document and the Harness `env` **function** looks it up per call. |
| `packages/durable/test/examples/30-tool-override.ts` | Replacing a tool for some conversations and decorating whichever bash wins; the wrapper times every call. |
| `packages/durable/test/examples/31-reload-and-restart.ts` | Reloading an extension mid-call, then restarting the process: running work finishes on the code it started with, and stored choices are *names* so they bind to whatever the new process installs. |

#### Tests (`packages/durable/test/`)

| File | What it is / what it pins |
| --- | --- |
| `packages/durable/test/chat-support.ts` | The chat test harness: a faux provider, `openChat`, `allEntries`, `textOf`, `waitFor`, and `unanswered()` (a response that never answers, so the run stays busy). |
| `packages/durable/test/harness-support.ts` | The harness test harness: open a Harness over a storage, a registry, reports, `completed()`/`abortedWith()` state builders, and a `countingReader` that counts live registry subscriptions. |
| `packages/durable/test/session-support.ts` | The session test harness: the shared `context`, storage factories and the fake clock. |
| `packages/durable/test/task-support.ts` | The task test harness: task definitions, phase helpers and the outcome builders. |
| `packages/durable/test/setup-document-retention.ts` | The Vitest setup file that sets the document retention so eviction runs in the suite. |
| `packages/durable/test/storage-memory.ts` | The in-memory storage used as the test double for a `Storage`. |
| `packages/durable/test/heap-retained.ts` | A helper that measures retained heap after a scenario (for the memory benches). |
| `packages/durable/test/fixtures/delete-buffer.ts` | A fixture that deletes `Buffer` from the global scope, to prove a code path does not depend on it. |
| `packages/durable/test/fixtures/utf8-byte-length-without-buffer.ts` | The same for UTF-8 byte counting — the truncation maths must work without `Buffer`. |
| `packages/durable/test/codemode-bench.ts` | Benchmarks the code-mode tool: the sandbox start cost and the per-call overhead. |
| `packages/durable/test/codemode.test.ts` | The code-mode contract: the journal and the run document, replaying after a crash, refusing a replay on a changed fingerprint or a diverging script, the output formatting and the token budget, the deferred-tool call inside code mode, and the failure report that lists the calls already made. |
| `packages/durable/test/codemode-checkpoints.test.ts` | The code-mode checkpoint policy: what is stored as a base vs a delta in `pi.codemode.*`. |
| `packages/durable/test/codemode-describe.test.ts` | The code-mode description layer: the namespace catalogue, the section text, and the inline budget. |
| `packages/durable/test/codemode-models.test.ts` | The `models.*` namespace: `models.classify` / `models.generateImages` resolve a model by provider+id only, and the error message says what to do. |
| `packages/durable/test/document-append-bench.ts` | Benchmarks appending entries (the transcript write path). |
| `packages/durable/test/env-line-scan.test.ts` | `StreamDecoder` and `LineScanner` agree with decoding and splitting the whole file, for any chunking; invalid ranges are rejected. |
| `packages/durable/test/env-node-conformance.test.ts` | Runs the shared environment conformance suite against `NodeExecutionEnv`, plus the directory-budget refusal and multi-chunk range reads. |
| `packages/durable/test/env-node-spill.test.ts` | The spill back-pressure: output is spilled to a file exactly when it crosses the threshold, and the spill never loses bytes. |
| `packages/durable/test/env-node.test.ts` | The Node environment in detail: files, dirs, symlinks (listed, never followed), the text line reader, the shell (cwd, env overrides, non-zero exit as a *result*, timeouts, aborts, signal-killed processes, spill creation) and the cleanup of child process trees. |
| `packages/durable/test/env-truncate.test.ts` | The truncation arithmetic: UTF-8 byte counts, a trailing newline is not an extra line, head truncation by lines and by bytes without splitting a line, and `formatSize`. |
| `packages/durable/test/harness-blocked.test.ts` | The crash-loop breaker: a task cut off `restartLimit` times in a row is *parked* with a visible reason and runs again on `retryTask()`; a close is not a restart; a task without a definition is blocked and the host is woken when a registry change unblocks it; a failed migration is reported to the graph. |
| `packages/durable/test/harness-callers.test.ts` | Who may call a tool: the model is offered only `model`-callable tools, tools may call tools, a tool that is not enabled is never offered nor callable, and a model-issued call of a tool it was not offered answers as unavailable. |
| `packages/durable/test/harness-cancellation-barrier.test.ts` | The abort barrier: work below a cancelled owner does not start its next phase until the cascade's mark has committed; a `failFast` request in the same pass overrides a restart mark; a restart mark is upgraded to an abort when an abort is requested above it. |
| `packages/durable/test/harness-compaction.test.ts` | The largest suite (108 KB). Pins the cut selection rules (never at a tool result, a system entry, an error/aborted answer or a display-only entry), the serialized summarizer source, manual compaction at idle vs at the next boundary, `stale` settlement, the background/blocking thresholds, overflow compaction and retry, the `beforeCompact` hook, the failure outcomes (`no_model`, `model_error`), compaction recovery across a reopen, and the per-model overrides. |
| `packages/durable/test/harness-context.test.ts` | Context derivation: the whole transcript without a head, model-less entries excluded from the messages, aborted/error/deferred answers excluded but kept as raw entries, head markers resolved, the newest edit per target applied, tool results ordered by call order, the baseline-system-message rules, tool results synthesised after a fork, as-of reads, incremental range extension, deep freezing, and idle retention. |
| `packages/durable/test/harness-conversations.test.ts` | Root creation, identity and state across a reopen, atomic independent-conversation creation, forking at a concrete entry with the as-of agent, fork-aware history pagination, and the data-only write semantics (mid-run, queued behind a reset, during preparation, after a failed run). |
| `packages/durable/test/harness-events.test.ts` | The experimental agent-event stream: the snapshot, `message_start/update/end` with deltas, `tool_execution_start/update/end`, and the fresh-snapshot fallback for a consumer more than 100 batches behind. |
| `packages/durable/test/harness-failed-run-inbox.test.ts` | What happens to inputs queued behind a failed run: they stay queued by default, a `continue` starts the next run, queued writes are placed, and `withdraw` settles them `unanswered` with `run_failed`. |
| `packages/durable/test/harness-generation-recovery.test.ts` | Generation recovery: a phase that faulted, a migration failure, definition handover to a same-version or newer-version replacement (with memos kept), the old invocation's commit rejected after the handover, and the abort mark preserved across the handover. |
| `packages/durable/test/harness-generation.test.ts` | The generation turn: prepare/request/retry/poll, the tool round, the answer, the `onYield` continuation, and the handoff. |
| `packages/durable/test/harness-host-inputs.test.ts` | `HarnessOptions.models` and `settings` may be **functions**, re-read at each request and at each `api.models` access. |
| `packages/durable/test/harness-inbox.test.ts` | The inbox's three queue modes, the boundary rules (final vs postTools), and the withdrawal of queued inputs. |
| `packages/durable/test/harness-input-entries.test.ts` | A submission may be placed as a *custom* entry kind with app data, and the data-only write rules. |
| `packages/durable/test/harness-inspect.test.ts` | `Harness.inspect()` derives every live task's state **without running task code**, and lists the unsettled submissions. |
| `packages/durable/test/harness-lifecycle.test.ts` | Open and close: the original open error is rethrown even if closing then fails too, a task handler that ignores its signal is joined before Storage closes, a cancelled close still shuts down, a commit whose committer was cancelled still settles durably, and no frame is published from a commit that settles during close. |
| `packages/durable/test/harness-live-deltas.test.ts` | The `pi.live` delta protocol: a front trim plus an append, a full-window write when the overlap search cannot find the shared part, leaf-by-leaf detail diffs, streamed partial text, and a complete base only in the commits where nothing runs. |
| `packages/durable/test/harness-nested-tools-restart.test.ts` | Nested tool calls across a restart: a replay-unsafe caller's unfinished nested calls are abandoned, a replay-safe caller's are recovered and reattached by key, the child tasks an abandoned call owns never run again, and a rerun that calls differently is rejected. |
| `packages/durable/test/harness-nested-tools.test.ts` | Nested tool calls in general: a tool calling another tool, the result living in the caller's `NestedCallDoc`, and the slot lifecycle. |
| `packages/durable/test/harness-ownership.test.ts` | Ownership: who owns a task, a conversation and a child; how an abort and an idle wait travel down the owner edges; background tasks as a boundary. |
| `packages/durable/test/harness-prompt.test.ts` | The system prompt: sections, the baseline's position, and the minimal diff between system entries. |
| `packages/durable/test/harness-registry.test.ts` | The extension registry: install, replace, remove, the snapshot, and the subscription count. |
| `packages/durable/test/harness-reports.test.ts` | Error reporting: a report says which task reported a failure or faulted, names the extension whose definition ran, and distinguishes an extension, listener, wake or timer failure from a failed Session. |
| `packages/durable/test/harness-scheduler-indexes.test.ts` | The scheduler's indexes: a cascade takes its reason from the nearest cancelling owner, a chain of held owners is finalised in the commit that frees the last one, and a scope stays busy after a reopen while the chain below an ended task is not loaded yet. |
| `packages/durable/test/harness-scheduler-retention.test.ts` | The scheduler's memory discipline: ended chains are forgotten, a forgotten chain is re-loaded when new work appears below it, a 20 000-deep chain is forgotten without recursion, and after all work ends the scheduler holds no more than a fresh reopen. |
| `packages/durable/test/harness-sleep.test.ts` | Durable sleeps: a sleep holds no invocation, survives a reopen, resumes at its checkpoint, is disarmed on abort and on close, and the abort handler runs without waiting for the sleep's time. |
| `packages/durable/test/harness-storage-failure.test.ts` | A failed Storage call ends everything with the first error: later calls, waits, watches, streams and running tasks; the Session closes once the calls underway settle; a `StorageRequestError` fails only that call; and a throw in a commit listener fails the Session "which would leave memory behind storage". |
| `packages/durable/test/harness-structured-output.test.ts` | Structured tool output: the `structuredOutputSchema` and its use by code mode. |
| `packages/durable/test/harness-structured.test.ts` | The structured-output path for tools and generations. |
| `packages/durable/test/harness-submissions.test.ts` | The submission lifecycle: `submit`, `status`, `wait`, `abort`, and the `requestId` de-duplication. |
| `packages/durable/test/harness-task-graph.test.ts` | The task graph view: the tree, the states, the blocked reasons, and the watch. |
| `packages/durable/test/harness-tasks-recovery.test.ts` | Task recovery: a task with a missing definition waits, an abort-marked one is orphaned, a definition handover migrates the checkpoint, and the registry subscription is released when `open` fails. |
| `packages/durable/test/harness-tasks.test.ts` | The task contract: phase progress and a typed result, a faulted phase, checkpoint comparison by value, atomic commits with entries, `memos` until terminal, the `startedAt`/`endedAt` stamps, one registry snapshot per phase, the agent resolved afresh per phase, the runtime's document and context reads, the abort rules, and the close rules. |
| `packages/durable/test/harness-telemetry-options.test.ts` | `HarnessOptions.telemetry` accepts one adapter with optional propagation and metrics. |
| `packages/durable/test/harness-telemetry.test.ts` | The telemetry schema: submission admission spans, task phase spans with the phase name and attempt, committed entry and submission events, fixed error-status categories (`task_faulted`/`task_failed`/`task_orphaned`) capped at 500 characters, and content-free reports. |
| `packages/durable/test/harness-tools-recovery.test.ts` | Tool recovery: a tool task that faulted, a tool whose definition disappeared, and the slot left behind. |
| `packages/durable/test/harness-tools.test.ts` | The tool contract: the model-issued call's result is its transcript entry, a nested call's result is in the caller's document, the durable intent checkpoint, and the replay-safe/unsafe flag. |
| `packages/durable/test/harness-view.test.ts` | The conversation view: the entries, the live state, the agent and the usage, published per commit. |
| `packages/durable/test/images-wasm-module.test.ts` | `createPhotonImages` takes a **compiled** `WebAssembly.Module`, the way Cloudflare Workers pass it. |
| `packages/durable/test/indexeddb-storage.test.ts` | The IndexedDB backend: minted IDs persist across a reopen, table writes roll back when a later document copy fails, entries and head markers are scanned through fork ancestry, and one readwrite transaction stays active across many mixed writes. |
| `packages/durable/test/jsonl-storage.test.ts` | The JSONL backend's publication and recovery: every commit is published before a sidecar is reclaimed, sidecar records are ordered by commit ordinal, a torn sidecar is removed, a failure poisons the storage, the main file is flushed to authorise reclamation, torn UTF-8 tails are truncated at the exact byte offset, and a non-increasing commit sequence is rejected. |
| `packages/durable/test/memory-storage.test.ts` | A prepared commit does not expose retained state. |
| `packages/durable/test/nested-images-bench.ts` | Benchmarks nested image processing. |
| `packages/durable/test/nested-tools-bench.ts` | Benchmarks nested tool calls (the per-call durable cost). |
| `packages/durable/test/provider-session-cache-e2e.test.ts` | The provider-side session cache, end to end against a real provider (skipped without a token). |
| `packages/durable/test/scheduler-fanout-bench.ts` | Benchmarks the scheduler's fan-out (many child tasks). |
| `packages/durable/test/scheduler-memory-bench.ts` | Benchmarks the scheduler's retained memory. |
| `packages/durable/test/session-checkpoints-migrations.test.ts` | The document checkpoint and migration machinery: `checkpointWhen` is called with its definition as the receiver, only for nonempty batches, with the exact prepared revision and the deltas-since-base count; a throwing predicate rolls everything back; a migration is read-only once per cold load, writes a base on the first transaction, and rejects a newer stored version or an older one without a migration; historical snapshots migrate independently. |
| `packages/durable/test/session-definitions.test.ts` | The document definition contracts (scope, version, family, `initial` seeding). |
| `packages/durable/test/session-document-cache-bench.ts` | Benchmarks the loaded-document cache (hit/miss, eviction). |
| `packages/durable/test/session-document-retention.test.ts` | The idle-document eviction: a document leaves the cache after the retention, an attached one is pinned, and the sweep runs on the mutation line. |
| `packages/durable/test/session-documents.test.ts` | Document create/read/change/retire, the address index, and the scope rules. |
| `packages/durable/test/session-forks.test.ts` | Fork semantics: the cut, the copied documents, the ambiguity rejection, and the `asOf`/`current`/`initial` fork policies. |
| `packages/durable/test/session-states.test.ts` | The Session's own states (open, closing, closed, failed). |
| `packages/durable/test/session-tables.test.ts` | The five record tables and their scans. |
| `packages/durable/test/session-watches.test.ts` | Watches: the delivery of exact operation batches, the retirement update, the replay from the acquisition revision, the cancellation semantics, and the listener failure settling only the affected watch. |
| `packages/durable/test/spec-usage.test.ts` | The spec's usage examples **compile** — the specification is checked by the compiler. |
| `packages/durable/test/sqlite-cloudflare.test.ts` | The Durable Object SQLite adapter: unprefixed by default, a prefix namespaces pi's tables without touching the host's tables, concurrent prefixes are isolated, and an invalid or reserved prefix is rejected. |
| `packages/durable/test/sqlite-facade.test.ts` | The portable SQLite facade: the driver classes are re-exported without wrapping, statements are prepared once per connection, commits are read in call order, admitted multi-query reads finish before close, and a document is read from one committed state. |
| `packages/durable/test/sqlite-migrations.test.ts` | The SQLite migrations: the schema is created and re-applied idempotently, a v1 database is migrated to store `sleeping` tasks, a newer database is rejected, and a failed migration rolls back so the data is preserved for a retry. |
| `packages/durable/test/sqlite-storage.test.ts` | The SQLite backend: records, sequence and global ID allocation across a reopen, prefix namespacing, metadata-corruption rejection, the missing-base rejection, detached root-replacement replay, a full rollback as one transaction, rewindable reconstruction, index use, revision reclamation, WAL checkpointing, and bounded storage. |
| `packages/durable/test/storage-runtime-boundary.test.ts` | The **portable subpaths contain no Node imports** — the package root, `/storage/sqlite`, `/env` and `/storage/jsonl` stay portable. |
| `packages/durable/test/storage.bench.ts` | The storage benchmarks: mixed commits, scans, and reopen + first exact read. |
| `packages/durable/test/system-order-cache-e2e.test.ts` | The system-message order, end to end against a real provider (skipped without a token) — the prompt-cache claim is checked against the provider, not just the unit. |
| `packages/durable/test/tool-output-bench.ts` | Benchmarks the tool-output path (the retained window, the trim, the spill). |
| `packages/durable/test/tool-search.test.ts` | The deferred-tool mechanism: a deferred tool is offered only after `tool_search` loads it, the declaration is appended in load order, a load is recorded by name, a loaded tool survives a temporary extension loss, loaded tools are per branch, and an unrelated query loads nothing. |
| `packages/durable/test/tools-images.test.ts` | Image reading: pass-through within the limits, refusal by size and by header, the placeholder message, the model's own limits, the Photon processor (scaling, JPEG re-encode, aspect-ratio floors, format conversion), EXIF orientation for JPEG and WebP, `imageDimensions`, `toBase64` against `Buffer` for every remainder length, and the worker thread keeping the event loop free. |
| `packages/durable/test/tools-read-differential.test.ts` | The read tool returns **exactly** what reading the whole file returned, and detects an animated PNG whose `acTL` chunk lies far beyond the header. |
| `packages/durable/test/tools.test.ts` | The durable tools: read (offsets, limits, truncation, a growing log, images), write (parent directories, the mutation queue), edit (disjoint edits, both diff formats, repaired argument shapes, overlap rejection), and bash. |
| `packages/durable/test/types.test.ts` | The type-level contracts (compile-time assertions on the public types). |

### Tier 3 — skipped with a reason

None. Every file in the shard was opened and read; nothing was binary, generated-vendored, or unreadable. Seven files larger than 40 KB (`harness/scheduler.ts` 108 KB, `types.ts` 52 KB, `codemode/codemode.ts` 45 KB, `harness/types.ts` 44 KB, `storage/indexeddb.ts` 43 KB, `session/session.ts` 42 KB, `session/transaction.ts` 42 KB) and one very large doc (`docs/spec.md` 303 KB) were read in sequential line ranges rather than a single `Get-Content -Raw`, so no portion of them was dropped. Where a shell call's output was elided mid-batch, the elided region was re-read from the harness's own spill file before the report was written.

---

## 2. Ideas worth stealing

1. **Store progress in the same transaction as the work.** `pi.live` is an ordinary durable document written in the same commits as the work it describes (`src/harness/live.ts:111`, `src/harness/generation.ts:743`). A late joiner reads the *document*, not a live socket, so progress survives a restart and can be read by a second observer. — **CONVERGENT** (the same idea appears in the Hermes and deepseek-harness shards as a "session state file"). *Why it transfers:* August Trading's "what is the agent doing right now" panel can be one document read, not a websocket protocol.
2. **Never let the system message lose the lead, and never rewrite it wholesale.** `planSystemEntries` emits only the *difference* (`src/harness/prompt.ts:66`), and the baseline only moves while it is still the first system message, because "a later tool change rewrites the request's tool list and invalidates the whole prompt cache" (`docs/spec.md` §2.1). — **UNIQUE** to this repo. *Why it transfers:* August Trading's prompt has sections; a section change must not re-send the whole system prompt or the provider cache dies.
3. **A crash-loop breaker that parks the task and shows why.** `restarts` counts consecutive crashes *without a state change*; at `restartLimit` the task is parked with a `BlockedReason` and only `retryTask()` restarts it (`src/harness/scheduler.ts:1365`, `:94`). A clean close does not count as a crash. — **UNIQUE**. *Why it transfers:* August Trading's skill/agent loop needs a "this is stuck, here is why" state, or a poisoned prompt burns the budget forever.
4. **Write the intent before the effect, and mark the effect replay-safe or not.** The tool task's checkpoint `{ phase: "execute", arguments, replay: "safe" | "unsafe" }` is committed *before* execution (`src/harness/tool.ts:60`). — **UNIQUE**. *Why it transfers:* "Log this trade" and "place an order" are replay-unsafe; the recovery path must know before it acts.
5. **Deterministic replay for a script that spans many tool calls.** The code mode journals every *delivered result* and replays the VM deterministically; a changed sandbox fingerprint or a diverging call sequence **refuses** to replay rather than guessing (`src/codemode/codemode.ts:1-40`). — **UNIQUE**. *Why it transfers:* a "scan 200 symbols and summarise" turn is exactly this shape, and August Trading's multi-symbol analysis is the same problem.
6. **A deferred-tool catalogue: search to load, load to append.** `tool_search` ranks with BM25 (`src/search.ts`), and a loaded tool's *declaration* is appended to the tool list (`src/tool-search/tool-search.ts:55`). — **UNIQUE**. *Why it transfers:* August Trading's tool/skill catalogue is large and growing; this keeps the prompt small without hiding capability.
7. **One conformance suite, run against every backend.** `createStorageConformance` returns runner-independent cases; the same suite runs against memory, JSONL, SQLite, IndexedDB *and* a Cloudflare Durable Object (`src/testing/storage-conformance.ts`, `test-workers/storage.test.ts`). — **UNIQUE**. *Why it transfers:* August Trading has Capacitor-SQLite, IndexedDB and Preferences; one suite keeps them honest.
8. **A host-abstracted clock and timer that the host may decline.** `HarnessOptions.now` and `HarnessOptions.setTimer`; a declined background timer makes the whole scheduler degrade gracefully, which is what lets a Cloudflare Durable Object actually sleep (`src/timers.ts`, `test-workers/wake.test.ts`). — **CONVERGENT** (all three reference repos separate the clock from the wall clock). *Why it transfers:* August Trading's tests need a fake clock, and a backgrounded browser tab needs the same refusal.
9. **The execution environment is an interface, and expected failures are values.** `Result<T, E>` with `ok`/`err`; a missing file is `err(FileError("not_found"))`, not an exception (`src/env/index.ts:4-30`). — **UNIQUE**. *Why it transfers:* August Trading's tool layer runs against a browser and an Electron shell; "expected failure" and "the environment broke" must be different types.
10. **One global ID namespace across every record kind, enforced by the storage.** `Id<Kind>` is a branded number; the backend refuses to reuse an ID for another kind (`src/ids.ts`, `src/storage/memory.ts`). — **UNIQUE**. *Why it transfers:* a trade, a journal entry, a chat message and a scheduled job all getting IDs from one sequence means "show me everything about this trade" is one index scan.
11. **A fixed structured summary template for compaction.** `## Goal / ## Constraints & Preferences / ## Progress (Done / In Progress / Blocked) / ## Key Decisions / ## Next Steps / ## Critical Context`, with "Do NOT continue the conversation… ONLY output the structured summary" (`src/harness/compaction.ts:74`). — **UNIQUE**. *Why it transfers:* August Trading's context compaction should produce a *checklist another model can resume from*, not prose. The "In Progress / Blocked / Next Steps" sections are a decision-ready handoff format.
12. **The spec is compiled.** `test/spec-usage.test.ts` asserts the specification's usage examples typecheck. — **UNIQUE**. *Why it transfers:* a "design doc that fails CI when it drifts" is cheap to add and catches the most embarrassing class of drift.

---

## 3. Trading-specific findings

**Long-lived monitoring & scheduled work.** This shard is the substrate, not the product, but it answers the reliability question precisely. A scheduled job is a **durable task**, not a cron entry: `runtime.sleepUntil(until, checkpoint, context)` parks it *between* phases with no invocation held, and it resumes at its checkpoint when the Harness clock reaches `until` (`src/harness/scheduler.ts`, `src/harness/types.ts:625-640`). Crucially the 1.4.0 CHANGELOG records that the *old* API was removed because "it waited inside a phase, which holds an invocation and, after a restart, reruns the phase and restarts the wait" — i.e. the naive implementation double-fires after a restart. A sleeping task holds no invocation, survives a reopen, and its timer is disarmed on abort and on close (`test/harness-sleep.test.ts`). Catch-up for a missed run falls out of the same design: the wakeup computes the *earliest* sleep, and the host arms an alarm for it (`test-workers/worker.ts:arm`). There is **no** built-in "ran three times and produced nothing" breaker here — the closest analogue is the crash-loop `restartLimit` breaker, which is a *failure* breaker, not an *emptiness* breaker. August Trading's automation breaker would have to be built on top.

**Human-in-the-loop approval.** Not implemented in this shard, but the substrate is the right one. A consequential action is a *tool task* with a durable intent checkpoint written before the effect (`src/harness/tool.ts:60`), and the `beforeTool` / `afterTool` hooks can block or rewrite a call (`src/harness/types.ts:372+`). The audit trail is the transcript itself: the tool call and its result are committed entries, and the tool's *nested* calls live in a `NestedCallDoc` that retires with the caller. A "pending approval" is therefore just a task in the `waiting` state with a checkpoint — the same state machine as everything else. What is *missing* is any notion of who approved, when, or a human identity: `onReport` carries a task id and an extension name, not an actor.

**Post-mortem / reflection loops.** The reflection mechanism here is **compaction**, and it is the strictest example of "stop bad rules accumulating" in the whole reference set: a summary *replaces* a range of entries in the model's view while the raw entries stay in storage (`src/harness/compaction.ts:279`). The rules are not appended and never accumulate — the older material is *superseded*, and the cut is chosen by a deterministic budget (`keepRecentTokens`), not by a model. Three guard rails are worth stealing verbatim: the cut is **never** at a tool result, a system entry, an error/aborted answer, or a display-only entry; the summarizer never sees system messages or thinking, and its tool results are truncated to 2 000 characters (`TOOL_RESULT_MAX_CHARS`); and a summary whose cut is *older* than a newer one settles `stale` rather than overwriting it. August Trading's "outcome autopilot → new rule" loop currently appends rules; this design would instead *retire* them.

**Multi-agent.** There is **no debate** in this repo, and that is a finding rather than an absence. The multi-agent patterns are: (a) a **foreground subagent tool** — the parent's call creates a child conversation it owns, runs one task there and returns the child's answer, and aborting the call aborts the child (`test/examples/22-subagent-foreground.ts`); (b) **persistent background subagents** — each subagent is its own conversation with its own transcript, the main conversation keeps a name→conversation document, and the subagent is owned by a **background anchor task** that finishes at once so the subagent outlives the main agent's turns but is still reachable by `abort({ background: true })` (`test/examples/23-subagent-background.ts`); (c) **child tasks** — a checkout task creates four payment tasks, waits with `policy: "failFast"`, and the whole tree is visible in the task graph (`test/examples/24-child-tasks.ts`). The review-agent pattern is a *separate agent with its own role, cheaper model, read-only tools and its own checkout* (`test/examples/28-reviewer.ts`) — again, not debate. Where debate would add value over one agent is nowhere in this repo; where it would be *wasted* is exactly where a subagent with its own transcript is used instead.

**Structured logs the model can query later.** The transcript *is* the queryable log: immutable entries, an append-only log, with a cursor-based `entries()` scan and a fork-aware history read. Storage is deliberately light — four backends, no database required: an in-memory map, a JSONL file with one sidecar per document/task, IndexedDB for the browser, SQLite for the desktop and Cloudflare. The query model is *scans with opaque cursors* plus *exact-key lookups* (`docs/spec.md` §10). For August Trading, the closest analogue is the trade log: Pi's answer is "the same append-only store that holds the conversation also holds the tool results, and the model's context is a *reduction* of it, not a copy of it" — which is precisely what August Trading's journal + transcript split is missing.

**Staying simple as features accumulate.** Four mechanisms, all visible in the source: (1) **one public type file** — `src/harness/types.ts` is the entire stable surface, and every implementation file is internal (`src/harness/types.ts:1-70`); (2) **one document per concept** — `pi.live`, `pi.inbox`, `pi.usage`, `pi.agent` are documents, so there is no bespoke plumbing, no repository classes, and no in-memory mirror to keep in sync; (3) **the spec is the contract** — 5 700 lines of normative prose with 8 invariants, and §13 lists the non-goals explicitly ("Durable has no: whole-Session DOM; visible-undurable publication; … CRDT/offline multi-writer merge; … automatic checkpoint heuristic"). The mandatory `checkpointWhen` predicate is the sharpest example: rather than a heuristic, the *definition* must say when to write a base, and there is no default.

---

## 4. Non-obvious decisions and gotchas

1. **A storage error is final and fatal.** The first error a `Storage` method throws (other than a caller-cancelled read or a `StorageRequestError`) fails the Session permanently; every later call and every call still underway gets `SessionFailed`; the Session then closes itself, Storage included ("Nothing retries: transient failures must be retried inside the Storage", `src/session/session.ts:1100-1112`, spec §10.1). A reader will assume the Session recovers; it does not.
2. **A conversation is owned by a *task*, or by nobody** — there is no "owned by a conversation" (`src/types.ts:ConversationOwnership`). A top-level task is owned by its conversation; a conversation is owned by a task. Inverting this is why the abort cascade and the idle wait work at all.
3. **The ID namespace is global across all record kinds.** A number minted for an entry cannot be reused for a task. "Entries and IDs are immutable and never reused after a committed write" (spec invariant 5). The brand is compile-time only; the *storage* enforces it.
4. **`checkpointWhen` has no default** since 1.4.0. A document definition must say when an ordinary change is stored as a complete base instead of a delta (`src/documents.ts`, CHANGELOG). Forgetting it is a compile error, not a silent policy.
5. **The tool result *is* the transcript entry; a nested tool's result is not.** A model-issued call's result is an entry; a nested call's result lives in the caller's `NestedCallDoc` "so the receipt stays small and the result retires with the caller" (`src/harness/tool.ts:56-63`). Reading the wrong one gives you an empty result.
6. **A "sleep" inside a phase is a bug, not a feature.** 1.4.0 removed `TaskRuntime.sleep()` for exactly this reason. A task that waits must end its phase and park.
7. **An overflow is never retried; only a compaction can make the next request fit** (`src/harness/generation.ts:561-567`). A retryable-looking context-overflow error must not consume the retry budget.
8. **A compaction that a generation waits for failing fails the generation too, without sending a request** — the inputs settle `unanswered` with `model_error` and detail `Compaction failed: <error>` (README).
9. **The system-message baseline may not move once another system message precedes an assistant message** — moving it "would change what it means" (spec §2.1). This is subtle and easy to break with a naive prompt-section rewrite.
10. **The `history`/`fork` triple is chosen per document at definition time** and is checked on every typed access (`checkRecordScope`). A `latest`-history document read as `rewindable` throws rather than returning a wrong value.
11. **The JSONL backend poisons itself rather than guess.** A failure after the marker is written leaves the store in an unknown state and the error says "JSONL storage is poisoned and must be reopened" (`src/storage/jsonl/storage.ts:89`). A "best effort" repair here would silently corrupt a trade log.
12. **Windows polls the filesystem** because a native watcher holds directories open and would break renames of their parents (`src/env/node-watch.ts:707-713`). Portability costs performance, deliberately.
13. **Symlinks are refused, not followed** (`src/env/node.ts:621`).
14. **A non-zero exit code is a successful execution result**, not an error (`src/env/node.ts`); a timeout is an error; an invalid timeout is rejected *before* spawning.

---

## 5. Weak spots

1. **The scheduler is 2 507 lines and 108 KB, and it is the hardest thing in the package to change.** It owns reservation, invocation, phase stepping, abort cascades, chain retention, sleeping, the task graph and the telemetry spans in one file. The chain-retention rules alone ("forgets ended subagent chains once their work ends", "holds a live owner for work later created in a forgotten conversation", "keeps a scope busy after reopen for work below an ended task whose chain is not loaded yet") read as emergent behaviour from a sweep, not as a designed invariant — a change here is likely to break a test whose name is a sentence.
2. **The task vocabulary is large and mostly orthogonal.** `pending | running | waiting | sleeping | completing | terminal`, plus `abortRequested`, `abortReason: "restart"`, `abandonOnRestart`, `background`, `restarts`, `memos`, `trace`, `links`, `startedAt`, `endedAt`. Every new state is a new case in the scheduler, the graph, the inspector and the tests. The spec's own §12 "API footguns" and §13 "Non-goals" are an admission that the surface is hard to hold.
3. **The JSONL backend is the weakest of the four.** It needs a two-file write protocol (sidecars + a marker), it poisons itself on failure, it does not promise durability across power loss without `fsync` ("default JSONL ordering handles ordinary process crashes; without durable mode it does not promise acknowledged commits survive power or host failure"), and it has no global compaction. It is also the backend most likely to be used as "the simple no-database option" — which is exactly where its sharp edges will bite.
4. **The `history`/`fork` semantics are a three-way cross-product chosen per document, and the legal combinations are not enumerated anywhere a reader would look.** `LatestConversationSemantics` allows `fork: "current" | "initial"`; `RewindableConversationSemantics` allows `fork: "asOf" | "current" | "initial"`. The consequences of each choice (what a fork inherits, what stays addressable) are only discoverable from the fork code and its tests.
5. **The package has no domain.** Everything here is generic runtime; the trading value is entirely in the *shapes* it imposes. Reading it will not tell you anything about trading, only about how to build a harness that could serve one — and the gap between "a durable transcript" and "a trade log with a P&L" is where the real work is.

