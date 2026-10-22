# deepseek-harness :: dsh-workflow-jobs-schedule

**Files in shard:** 139 (read: see §6 ledger; skipped with reason: see §5)
**What this shard covers:** Three capability groups in the DeepSeek Harness monorepo, all of which are the "long-running work" layer of the harness:

- `packages/jobs/**` — a **background-job registry** split into an abstract *seam* (`dsh-jobs`), a *process-local implementation* (`dsh-jobs-local`), and the *model-facing tools* (`dsh-tool-jobs`: `job_list`, `job_output`, `job_kill`).
- `packages/schedule/**` — a **durable, host-wide reminder/scheduler** (`dsh-schedule`) plus its model-facing tools (`dsh-tool-schedule`: `schedule_create/list/update/delete`), with cron/daily/weekly recurrence, delivery history, restart recovery and update-migration logic.
- `packages/workflow/**` — a **workflow orchestration seam** (`dsh-workflow`), the model-facing *workflow tool* that runs a JavaScript orchestration script (`dsh-tool-workflow`), and a **sandboxed "PTC" (program-to-component) guest runtime** that executes that script in a shared Node PTC sandbox (`dsh-workflow-ptc`).

The recurring architectural theme: **a contract package (no behaviour), an implementation package (behaviour), and a model-tool package (the surface the model sees)** — repeated three times with different names. That three-package split is the single most transferable idea in this shard.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `packages/jobs/jobs/src/brand.ts`
- **Purpose:** Owns the branded `JobId` type so a browser-safe consumer can name a job without pulling the Host `dsh-agent` dependency.
- **Key abstractions:** `type JobId = Branded<'JobId'>`; `function JobId(id: string): JobId`.
- **Data flow:** Pure type-level. A raw string is branded with a zero-cost cast; **no validation is performed** — the doc comment says so explicitly.
- **Non-obvious design decisions:** The file exists *only* because `src/index.ts` and `src/types.ts` reach `dsh-agent` through owner/listener signatures, and a "Client program cannot resolve `dsh-agent` even as a type". So the branded id is split into a leaf module (`./brand` is its own `exports` entry in `package.json`) rather than living with its siblings. This is **declaration-graph surgery driven by a bundler's reachability constraint**.
- **Edge cases & failure handling:** None — the brand function never throws.
- **Surprising:** `JobId('anything')` succeeds. The brand is a compile-time marker, not a runtime guard; runtime validation is the registry's job.

### `packages/jobs/jobs/src/types.ts`
- **Purpose:** The shared vocabulary between job producers, the registry and its consumers — the seam's contract in type form.
- **Key abstractions:** `JobToolCall` (a call id plus its `rootCallId`, so a nested PTC sub-call still records the root model-requested invocation), `JobRegisteredData`, `JobSettledData`, `JobOutcome`, `JobSourceRead`, `JobOutputSource`, `JobHandle`, `JobHooks`, `JobSpec`, `JobRead`, `JobOutputRead`, `JobSettleCause`, `JobEvent`, `JobEventFilter`, `JobEvents`.
- **Data flow:** A producer calls `JobRegistry.start(spec)`; the registry invokes `spec.run(handle)`; the handle's `append`/`updateProgress` push into the ring; `hooks.done` resolves with a `JobOutcome` (`completed`/`killed`/`failed` + `detail` + optional `result`).
- **Non-obvious design decisions:**
  - **Two independent read cursors on one byte stream.** `JobRegistry.read` is *consuming* (advances a registry-kept model cursor) and `JobRegistry.readAt` is *non-consuming* (absolute byte offset, used by observers). The comment in `JobOutputRead.next` is the design note: "Always a chunk boundary: appends land whole and trimming only advances chunk starts, and consumers concatenate `chunks` under that assumption, so a provider serving partial chunks would silently duplicate text." Observation is therefore **invisible to the model**.
  - **`JobOutcome.result` is handed out exactly once**, by the model's next `read` after settlement — "the output ring carries the stream; this is handed out once".
  - **`producerReported` is a truth flag, not a guarantee.** Its doc: "True when done fulfilled; false for rejection or forced failure. **Does not certify resource release.**"
  - **`JobHandle` writes after settlement are dropped, not thrown** — "so a producer's trailing flush cannot break its own teardown path."
  - **`JobHooks.done` "Resolves after the producer releases its resources, not merely when work finishes."** Settlement is a *release* boundary, not a completion boundary.
  - **`JobEvent` carries the projection only.** The `output` event carries `{ id, owner?, total }` and *no payload*: "so an observer schedules a `readAt` from its own cursor and the registry never pushes payloads." The registry never pushes bytes.
- **Edge cases & failure handling:** `JobEventFilter` is a three-way union: `{ owner }` (that session's jobs + all unowned jobs), `{ owners: 'scope' }` (owners composed under the subscribing context), `{ owners: 'all' }`.
- **Surprising:** `JobKind` is a *merge-extensible* map (`JobKindMap`) but `JobView.kind` is deliberately typed as a plain `string`, because a browser bundle compiling fewer declaration merges would otherwise reject `pwsh`/`pty-send`. The test `service.spec.ts` pins this as a compile-time probe.

### `packages/jobs/jobs/src/index.ts`
- **Purpose:** The abstract `JobRegistry` Cordis **Service Definition** — the contract every implementation must honour, with zero behaviour.
- **Key abstractions:** `abstract class JobRegistry extends Service` with abstract `events`, `start`, `list`, `get`, `read`, `readAt`, `kill`, `wait`, `remove`, `attachController`; plus `declare module '@deepseek-ai/cordis' { interface Context { jobs: JobRegistry } }`.
- **Data flow:** The constructor calls `super(ctx, 'jobs')` then `installJobArchiveAdmission(ctx, this)`. Everything else is abstract.
- **Non-obvious design decisions:**
  - **The abstract class throws when instantiated directly** (`if (new.target === JobRegistry) throw new Error('@deepseek-ai/dsh-jobs is the abstract job registry seam; load an implementation such as @deepseek-ai/dsh-jobs-local instead')`). The comment explains why: "`abstract` erases at runtime, so a composition row naming this package would register a `ctx.jobs` with no method implementations and fail far from the misconfiguration. **Fail loud at load instead.**" This is a *misconfiguration fence* that costs one runtime check and buys a load-time error.
  - **The doc block is the real spec.** ~40 lines of contract prose in the class JSDoc: settlement is first-wins; the `settled` event follows every released waiter and reports `awaited` so a completion reporter can skip settlements a waiting caller already collected; `start` refuses work while no attached controller serves the owner; "one registry serves every composition in the process, so this question — and event delivery under `{ owners: 'scope' }` — is **owner-relative rather than process-wide**".
  - **A settled record stays listed until removed** — the registry keeps *no retention count* of settled jobs. Deliberate (documented as a known limitation).
- **Edge cases & failure handling:** All access methods take an optional `caller: SessionId`; omission permits only unowned jobs. `wait` rejects for an invalid timeout, unknown or foreign job. `remove` throws for a live job.
- **Surprising:** The `remove` method exists for exactly one use case — "a caller that collected the terminal state through its own `wait` and never handed the id to the model, such as a shell tool's foreground call." It is a *hygiene* method, not a feature.

### `packages/jobs/jobs/src/view.ts`
- **Purpose:** The client-safe projection vocabulary — `JobView`, `JobChunk`, `JobStatus`, `JobKindMap`, `JobChannel`.
- **Key abstractions:** `type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'`; `type JobChannel = 'stdout' | 'stderr' | 'log'`; `interface JobView`; `interface JobChunk`.
- **Data flow:** Produced by the registry's `view()`; consumed by the model tools, the browser roster and the observation stream — "The model tools, the browser roster, and the observation stream all consume this one shape."
- **Non-obvious design decisions:**
  - **`JobChunk.at` is an absolute byte offset that "never moves once assigned"**, even after eviction. A reader below `earliest` gets a `lossy: true` read, never an error.
  - **`output` carries `total` + `earliest` + optional `spillPaths`.** `spillPaths` "outlives any chunk, so a reader below `earliest` can still name where the bytes went" — the *file* reference is source metadata, not chunk metadata.
  - **`channel: 'log'` marks producer narration that only observers see**; `stdout`/`stderr` reach the model. "Consumers treat an unrecognized label like an absent one" — forward-compatible by construction.
  - **`gapBefore?: true` marks a discontinuity** so an observer renders the gap instead of a silent splice.
  - The module declares `interface SessionActivityKindMap { job: true }` — it *merges into the Workspace registry's* activity vocabulary, so a running job shows up in a session's activity list with no extra wiring.
- **Edge cases & failure handling:** `progress` is cleared at settlement; `detail` carries the terminal reason including a merged kill reason.
- **Surprising:** `JobView` is a *fresh object per call, never live registry state* — every projection is rebuilt from the mutable record.

### `packages/jobs/jobs/src/archive-admission.ts`
- **Purpose:** The `job` family of the Workspace registry's **archive admission** — reporting a session's live jobs and killing them when the session is archived.
- **Key abstractions:** `installJobArchiveAdmission(ctx, registry)`; private `runningJobs(registry, owner)`.
- **Data flow:** Two Cordis listeners: `workspace/session-activity` (waterfall) prepends `{ kind: 'job', items: [{ id, label }] }`; `workspace/session-stop` kills each owned live job with reason `'session archived'`.
- **Non-obvious design decisions:**
  - **It is installed by the seam's *constructor*, so every implementation inherits it** through the abstract `list`/`kill` alone — no implementation has to opt in.
  - **The kill loop is per-job and contained**: a producer that throws on cancel is logged and the loop continues, "so a producer that throws on cancel must not keep the Session's other jobs running once it is archived."
  - **Unowned jobs are excluded** from both the activity report and the kill — they belong to nobody.
- **Edge cases & failure handling:** `registry.kill` throwing is caught and `ctx.logger.warn`ed.
- **Surprising:** The `workspace/session-activity` listener awaits `next()` *first* and then prepends its own family — so the job family always leads the activity list.

### `packages/jobs/jobs-local/src/index.ts`
- **Purpose:** The in-memory `LocalJobRegistry` — the shipped implementation of `ctx.jobs`.
- **Key abstractions:** `class LocalJobRegistry extends JobRegistry` with a Schemastery `static Config`; internal `TrackedJob` (the mutable record) and `ProducerState` (the object shared between the handle and the record).
- **Data flow:** `start(spec)` → preflight (controller present? kind/label/outputLimitBytes valid? owner live? concurrency bucket free?) → allocate id → build `OutputRing` + `ProducerState` → call `spec.run(handle)` → **commit** (`state.job = job`, `store.set`, `recordSessionEvent`, emit `registered`) → start the pump → await `hooks.done` → `settle()`.
- **Non-obvious design decisions:**
  - **The commit is a single assignment.** "Binding the shared producer state is the commit: writes staged inside the starter are already in the ring and `state`, and every later handle call reaches the registered record for its terminal checks and signals." A producer that appends during `run()` gets its bytes staged and published atomically with the registration — the test pins this: only the `registered` event fires, and the staged bytes are already in the ring.
  - **`ProducerState` exists so a handle call can tell "staged" from "committed".** `state.job === undefined` exactly during the starter call.
  - **`start` requires an attached job controller** that *serves the owner* — "so a producer cannot start work that owner cannot collect or stop." A per-owner scope layer chain (`ScopedLayers`) decides that. The error message names the fix: `'background jobs unavailable: no job controller serves this agent (load @deepseek-ai/dsh-tool-jobs in its composition)'`.
  - **Concurrency bucket per *exact owner agent instance*** (default 10). A replacement agent for the same session id gets a fresh bucket, and a `stopping` job still occupies its bucket until the producer actually settles.
  - **The rejection happens *before* producer start and before id allocation** — the producer's `run` is never called, so there is no half-started resource.
  - **Settlement trims to `max(settledRetainBytes, total - modelCursor)`** — "Nothing the model has not read is trimmed at settlement: a job that finishes before its first read still hands over everything the live cap retained." The *terminal* model read is what drops retention to the settled cap.
  - **Kill reason merge rule:** producer detail first, kill reason appended (`'signal: SIGTERM; cancelled by the user'`), but "A job that outran its kill request (settled `completed`/`failed`) keeps the producer detail alone — the reason describes a kill that never landed."
  - **A throwing producer `cancel` leaves the job completely untouched** — `killJob` calls `job.cancel(reason)` *before* mutating `status`, so the throw propagates with no state change.
  - **`wait` uses a scoped `deadline(signal, timeoutMs, TASK_WAIT_TIMEOUT)`** so a timeout is distinguishable from caller cancellation, and the timer is cleared on every exit.
  - **Waiters are released *synchronously inside* the settlement, before the `settled` event is emitted.** The doc in `JobEvent` explains why this ordering is load-bearing: "That waiter's caller receives the terminal projection as its own result… A wait that timed out or was aborted before the settlement does not count." The `awaited` flag on the event is computed as `waitResolvers.length > 0` at settlement time.
  - **The `output` event is emitted *after* the `settled` event** — "The ring's stream ends with the settlement; the signal follows the committed settlement so an observer that wakes on it reads the terminal state."
  - **A failing pull source is contained once** (`guardSource`): first throw is logged, the source then reads as exhausted forever, "so the job runs to its own settlement with whatever the ring holds instead of freezing on a pump failure."
  - **Owner cleanup is attached to the *owner's* scope**, not the jobs fiber: `owner.ctx.effect(() => async () => { ...await this.disposeOwned(owner) }, 'jobs.ownerCleanup()')`. This "survives producer reloads and joins agent quiescence".
  - **Teardown forces a failed record rather than hanging.** If `cancel` throws during teardown: `settle(job, { status: 'failed', detail: 'cancel threw during teardown; work may be orphaned' }, 'teardown', false)` — the record is honest about the orphan instead of pretending the work stopped.
- **Edge cases & failure handling:**
  - Producer `done` **rejecting** is a contract violation: caught, logged as `'producer contract violation'`, converted to `{ status: 'failed', detail: String(error) }` with `producerReported: false`.
  - `recordSessionEvent` failures (session append throwing) are logged and **do not** block execution or waiter release.
  - A producer that appends or updates progress after settlement is warned and dropped.
  - `remove` refuses a live job (`'job <id> is still running; kill it and wait for settlement before removing it'`).
  - `readAt` rejects a negative or non-integer offset.
  - `wait` rejects a non-positive / non-finite timeout.
- **Surprising:**
  - **`view()` rebuilds the projection on every call** — `before.output.total` stays `0` after a later append. There is no live-state leak.
  - **The id generator retries on collision** (`do { id = … } while (this.store.has(id))`) rather than trusting 16 hex chars.
  - **An unowned job is visible to every caller** and never reported/killed for a session.
  - The `layers` comment is the sharpest statement of the scope design: "The registry is one process-wide instance serving every composition, so a flat table would answer a per-owner question process-wide: one preset's job controls would hold `start()` open for an agent whose own composition loads none."

### `packages/jobs/jobs-local/src/events.ts`
- **Purpose:** Event routing — "subscriptions file by filter, and every commit dispatches once to each matching listener with containment."
- **Key abstractions:** `class JobLayer implements ScopeLayer` (`controllers: AnonymousEntries<symbol>`, `scoped: AnonymousEntries<Subscription>`); `class JobEventHub` with `subscribe(ctx, filter, listener)` and `emit(event, owner)`.
- **Data flow:** `subscribe` either files the subscription into `layers.global.scoped` (unscoped `'scope'` filter) or into the registering context's scope layer; ordinary filters go into the `unscoped` set as a `ctx.effect`. `emit` walks: unscoped set → global scoped layer → the owner scope's layer chain.
- **Non-obvious design decisions:**
  - **The subscription is an *effect of the subscribing context*** — so it is unregistered automatically when that fiber is disposed (HMR safety). The `events` getter on the registry re-binds to `this.ctx` each access: "a subscription is an effect of that context".
  - **Entries are anonymous** (`AnonymousEntries<symbol>`) — "a contribution is identified by its own disposer, never by a name a second registrant could shadow." Two `attachController('a')` calls stay independently disposable.
  - **Listener throws are contained per listener**, so one bad observer cannot break the commit that was already made.
- **Edge cases & failure handling:** The `warn` sink is injected (`(message) => ctx.logger.warn(message)`), which is what makes the hub unit-testable without a registry.
- **Surprising:** A scoped subscription hears *only* its own composed agents; an **unowned job is heard only by unscoped subscriptions** ("an unowned job has no chain to walk").

### `packages/jobs/jobs-local/src/pump.ts`
- **Purpose:** The registry-owned pull pump — copies a job's `JobOutputSource`s into its ring at a bounded cadence, then drains once more after the producer settles.
- **Key abstractions:** `interface PumpHandle { done: Promise<void> }`; `interface PumpSink { append(text, options?); spill(index, path) }`; `function startPump(sources, sink, pollMs, until)`.
- **Data flow:** `drain()` reads every source at its own cursor, updates the cursor to `nextOffset`, reports the spill file, and appends non-empty text. The loop drains → sleeps `pollMs` (or until `until` settles) → drains → … → after settlement, one final drain.
- **Non-obvious design decisions:**
  - **The registry owns the cadence, not the producer.** "a producer folds nothing into its `done`."
  - **The final drain happens before settlement trims the ring** — so stderr written at exit is not lost. The `jobs-local` test makes stderr readable *only* after the producer settles, precisely to prove the final drain collects it.
  - **The wait holds constant resources**: one subscription on `until` for the whole run, one pending timer at a time. The test pins this with a counting `then` wrapper over 10 000 poll rounds: `subscriptions <= 2` and `getTimerCount() === 1`.
  - **The spill file is reported on *every* read**, including empty and lossy ones, because "that reference outlives any chunk" and "a read without it withdraws the file".
  - **A lossy read is marked `gapBefore`** so the discontinuity stays visible.
- **Edge cases & failure handling:** A **rejected** `until` counts as settlement (`void until.then(finish, finish)`), so a broken producer still gets its final drain. `pollMs <= 0` or non-finite throws *before touching any source*.
- **Surprising:** **Cross-source reordering is bounded by `pollMs`** and is accepted: "bytes two sources produced inside one poll window land in that order, not in the order they were written: the ring is a best-effort live view." The doc says this outright rather than pretending to be exact.

### `packages/jobs/jobs-local/src/ring.ts`
- **Purpose:** The bounded output ring behind one job.
- **Key abstractions:** `class OutputRing` with `retainedBytes`, `total`, `earliest`, `append(text, options, cap)`, `trim(cap)`, `readFrom(from)`; private `utf8Tail(text, maxBytes)`.
- **Data flow:** `append` pushes a chunk at `this.total`, adds its UTF-8 byte length to `total` and `retainedBytes`, then trims to the cap. `readFrom` returns every retained chunk overlapping `[from, total)`.
- **Non-obvious design decisions:**
  - **Offsets are absolute and never move.** `earliest` only advances.
  - **Eviction is whole-chunk** — `while (retainedBytes > cap && chunks.length > 1) shift()`. A reader below the window gets `lossy: true`, never an error.
  - **A lone oversized chunk is kept as a UTF-8-safe *tail***, with its `at` advanced by the dropped byte count and `gapBefore: true` set. `utf8Tail` walks forward past continuation bytes (`(raw[start] & 0xC0) === 0x80`) so the surviving text never starts inside a code point. The test uses `'ééé'` (6 bytes) with a 3-byte cap and asserts the retained chunk is `'é'` (2 bytes) at offset 4.
  - **Empty chunks are dropped** and return `false` without waking observers.
- **Edge cases & failure handling:** `trim` on an empty ring is a no-op and keeps `earliest === total`. `readFrom` at a foreign offset inside a chunk returns the **whole** chunk (its `at` may precede `from`) — documented so consumers concatenate correctly.
- **Surprising:** `readFrom` returns `next: this.total` (the ring's current total) rather than the last chunk's end — "Always a chunk boundary."

### Tier 2 — bulk: a compact table, one row per file

*(packages/jobs group — see the group-level table further down for the READMEs and i18n manifests.)*

| File | What it is / what it pins |
| --- | --- |
| `packages/jobs/jobs-local/tests/events.spec.ts` | Pins the `JobEventHub` routing: owner filter delivers that session + every unowned job but never another session; `'all'` delivers everything; `'scope'` delivers only the owners composed under the subscriber; a throwing listener is contained and later listeners still run; disposers unregister and the subscribing fiber's registrations die with it; a scope layer stays alive only while a subscription or controller remains in it. |
| `packages/jobs/jobs-local/tests/loader-composition.spec.ts` | Loads `dsh-jobs-local` through a **real Cordis `Loader` + `cordis.yml` row** and asserts the provider-owned `maxConcurrentJobsPerOwner: 1` admission config is applied, and that the second start is refused with `(limit: 1)`. The only test in the shard that exercises the YAML composition surface. |
| `packages/jobs/jobs-local/tests/pump.spec.ts` | Pins the pump: per-source offsets never share a cursor; a lossy read lands as `gapBefore`; the spill file is reported on every read and *withdrawn* when a read stops naming it; a rejected settlement still drains the final bytes; one subscription + one timer regardless of run length; a non-positive `pollMs` throws before touching a source. |
| `packages/jobs/jobs-local/tests/ring.spec.ts` | Pins the ring: absolute UTF-8 byte offsets, empty chunks dropped, a foreign offset returns the whole overlapping chunk, whole-chunk head eviction with the evicted span flagged lossy, a lone oversized chunk kept as a UTF-8-safe tail with `gapBefore`, re-trimming to a smaller cap leaves `total` untouched. |
| `packages/jobs/jobs-local/tests/jobs.spec.ts` | The behavioural heart of the seam (1 659 lines). Pins: the controller-admission fence (an owner whose own composition loads no controller cannot start work; a globally attached controller serves everyone); the per-exact-owner concurrency bucket (10 by default; a `stopping` job still holds its bucket; rejection happens *before* `run()`); unique `<kind>-<16 hex>` ids with UUID-collision retry; `read` consumes / `readAt` does not; the producer `result` is handed out exactly once; settlement cause `producer`/`kill`/`teardown`; a throwing `cancel` mutates nothing; `wait` timeout vs abort vs settlement ordering (an abort landing *after* settlement still delivers the terminal projection); the `awaited` flag; `remove`; owner isolation; owner-scope cleanup attached to the *agent's* scope, not the jobs fiber; a stale same-session scope must not cancel its replacement's job; teardown force-failure with `'work may be orphaned'`; the `registered`→`progress`→`stopping`→`settled`→`removed` event order; staged starter writes surfacing at the registration commit; settlement keeping unconsumed bytes and the terminal read trimming to the settled cap; post-settlement writes warned-and-dropped; a throwing pull source contained once; and the **`job/registered` / `job/settled` Session lifecycle records** (timestamps, nested tool identity, `producerReported`, ordering ahead of synchronous hub reactions, and the case where recording fails without breaking execution). |
| `packages/jobs/jobs/tests/archive-admission.spec.ts` | Pins the archive admission: only the session's own `running`/`stopping` jobs are reported (never unowned, foreign, or settled); each is killed with the reason `'session archived'`; a producer that refuses cancel is logged and the others still stop; the listeners die with the registry fiber. |
| `packages/jobs/jobs/tests/service.spec.ts` | Pins the *seam*: a concrete subclass registers as `ctx.jobs`; the projection `kind` is an **open string** (compile-time probe `string extends JobView['kind']`); loading a second implementation throws (`service "jobs" has been registered`); mounting the abstract seam directly throws with the "load an implementation such as …" message. |

### `packages/jobs/tool-jobs/src/index.ts`
- **Purpose:** The model-facing surface: `job_output`, `job_list`, `job_kill`, plus the **completion-notice delivery** that turns a settlement into something the model actually sees.
- **Key abstractions:** `export const name = 'tool-jobs'`; `export const inject = ['tools', 'jobs', 'systemPrompt']`; `type CompletionDelivery = 'quiet' | 'wakeup'`; `interface Config` + `export const Config: z<Config>`; `apply(ctx, config)`.
- **Data flow:** The plugin (a) attaches the job controller (`ctx.jobs.attachController('tool-jobs')`) — this is what *arms* `ctx.jobs.start()` for every agent in its scope; (b) registers a system-prompt section; (c) subscribes to `ctx.jobs.events` with `{ owners: 'scope' }` and delivers notices; (d) registers the three tools.
- **Non-obvious design decisions:**
  - **Delivery is owned here; the *recipients* are the registry's.** The plugin decides *how* a notice reaches the owner (inject into a busy step vs. wake an idle owner); the registry decides *which* mount hears it. The comment: "The registry routes each settlement to the scope this plugin was mounted under, so a mount under one preset never sees another preset's agents; this listener owns delivery, not the choice of whom to deliver to."
  - **The model is told not to poll.** The system-prompt section reads: *"You are notified in-session when a job finishes — do not busy-poll or sleep on one; keep working on independent steps and do not duplicate a running job's work. Before giving a final answer, collect every still-relevant job with `job_output` (set `wait: true` only when you are genuinely blocked on it), and `job_kill` jobs that stopped mattering."* — a **prompt-level instruction that makes the tool's existence self-explanatory**.
  - **`maxConsecutiveWakes` is a self-excitation breaker.** The config doc is explicit: "Set it to bound the self-exciting chain where a woken turn starts the job whose completion wakes it again, at the cost of notices past the cap waiting silently for the next user input." The budget is tracked per exact `Agent` in a `WeakMap`, and **only a user-authored message refills it** — the refill listener checks `message.source.kind === 'user'`, because "a notice this plugin itself queued must not refill the budget it just spent."
  - **The budget must be a whole number of turns**: "A fraction never names a turn, and `Infinity` would spell an 'unbounded' that omitting the field already means." So `maxConsecutiveWakes: Infinity` and `2.5` are *rejected at load*.
  - **A settlement the model already collected gets no notice.** Three suppression rules: `event.awaited` (a live wait was released), the `killedByModel` set (the model asked for the kill — "that tool result is the model's delivery, so the settlement notice would only repeat it"), and `event.cause === 'teardown'` (nobody is left to read it).
  - **A wait that timed out or aborted withdraws only its own claim** — the registry counts only a wait *still owed* the projection, so a later settlement notifies as usual. The test pins exactly this.
  - **Producer-owned output bounds are applied to the *complete* model-facing result**, including the status line and the notice metadata. The `finalizeContent` hook bounds the rendered text and reuses an existing producer truncation marker (`'\n[result truncated]'`) rather than double-marking it.
  - **A bounded notice keeps the full job id and the `job_output` action if both fit**; otherwise it degrades to `'background job ended; use job_list for id.'`; at 8 bytes only `'job_list'` fits; at 3 bytes `'job'`. The comment explains the ordering: "A partial UUID cannot identify the job. Point the model at the listing instead."
  - **The wait is owned by the tool, not by `ToolDefinition.timeoutMs`** — "A timed-out wait returns job state rather than a TOOL_TIMEOUT error, so this tool owns its deadline instead of using `ToolDefinition.timeoutMs`." A model-supplied `timeout_ms` is clamped to `maxWaitTimeoutMs` (default 10 min).
  - **`job_kill` reads a *non-consuming* projection** — "A projection describes current state without consuming pending output."
- **Edge cases & failure handling:**
  - `waitTimeoutMs > maxWaitTimeoutMs` throws at load.
  - A `job_id` that is empty throws (`validateJobId`), an unknown id errors (`unknown job bash-99`), a foreign owner's job errors (`belongs to another session`).
  - The `visibleOutputLimit` lookup is done in a **prepended** `tools/pre-execute` listener so the cap survives policy that replaces the content.
  - An `owner.inject` failure escapes the notice listener and is caught by the registry's per-listener containment — "a real bug must be visible", not swallowed.
- **Surprising:**
  - **`completionDelivery` defaults to `wakeup` — unbounded by default.** "an unattended agent that chains background commands and one-shot subagents is woken for every completion." The README flags the cost explicitly: "a notice reaching an idle owner also buys a model request the user did not ask for."
  - `quiet` delivery exists "which deterministic transcripts need" — a *testability* requirement drove a production config knob.
  - `job_list` and `job_output` render as `kind: 'read'` cards, `job_kill` as `kind: 'execute'` — the UI card kind is the only difference in presentation.

### `packages/jobs/tool-jobs/src/render.ts`
- **Purpose:** Model-facing rendering of registry reads: the delta, the status line, and the *public* (model-safe) job projection.
- **Key abstractions:** `interface PublicJobSnapshot`; `jobDetail(job)`; `publicJob(job)`; `statusLine(snapshot)`; `renderModelDelta(chunks, lossy, spillPaths)`.
- **Data flow:** `JobChunk[]` + the lossy flag + the spill paths → one text block for the model.
- **Non-obvious design decisions:**
  - **The public projection *omits ownership and offsets*.** `publicJob` keeps `id, kind, label, status, detail, startedAt, finishedAt` and drops `owner`, `output` (total/earliest/spillPaths) and `outputLimitBytes`. "Job state safe for model-authored programs; ownership and offsets are omitted."
  - **`detail` is overloaded on purpose:** `jobDetail` returns `job.progress ?? job.detail` — the live progress line while running, the terminal reason once settled. One field, two eras, one renderer.
  - **stdout first, then one `[stderr]` section** — "exactly as the shell tools render a foreground result." The `log` channel is filtered out entirely: "producer narration for observers and never reach the model."
  - **A gap or a lossy read ends with the shell tools' dropped-output notice**, naming the spill files: `[some output was dropped from memory; full output: /spill/out.log, /spill/err.log]`. When no source keeps a file, `(unavailable)`.
- **Edge cases & failure handling:** A `gapBefore` on a `log` chunk is invisible to the model (the whole chunk is filtered) — the test pins that the render is `''`.
- **Surprising:** The dropped-output notice fires on a **producer-side gap** even when the ring lost nothing (`lossy: false`) — "the ring itself lost nothing (`lossy: false`); the source did, between two pumps."

### Tier 2 — bulk (continued): the jobs group READMEs

| File | What it is / what it decides |
| --- | --- |
| `packages/jobs/README.md` | The group map: three packages — `jobs` (`ctx.jobs`, the contract), `jobs-local` (registers on `ctx.jobs`, the storage), `tool-jobs` (registers on `ctx.tools`, the model surface). |
| `packages/jobs/README.zh.md` | Chinese translation of the group map; same table and links. |
| `packages/jobs/jobs/README.md` | The seam's user-facing contract: ids, ownership, the output ring, the event stream, "Starting background work needs a controller", and the *Known Limitations* ("The contract is in-process", "The model's cursor is the only consuming read", "A settled record stays listed until it is removed"). |
| `packages/jobs/jobs/README.zh.md` | Chinese translation of the seam README. |
| `packages/jobs/jobs-local/README.md` | The implementation's user-facing contract: the four config fields and their defaults (`maxConcurrentJobsPerOwner 10`, `retainBytes 262144`, `settledRetainBytes 16384`, `pumpPollMs 150`); "the registry neither queues nor preempts"; "A producer cancel that returns without settling `done` stays indistinguishable from a slow stop and can stall teardown while holding one capacity slot"; "Final settlement persistence is not guaranteed during teardown". |
| `packages/jobs/jobs-local/README.zh.md` | Chinese translation of the jobs-local README. |
| `packages/jobs/tool-jobs/README.md` | The model-surface contract: the three tools, the notice text, the wake budget, the output-capping rules, and a *Model Experience* section that prices the feature in tokens and KV-cache terms ("a notice reaching an idle owner also buys a model request the user did not ask for"). |
| `packages/jobs/tool-jobs/README.zh.md` | Chinese translation of the tool-jobs README. |

### `packages/schedule/schedule/src/types.ts`
- **Purpose:** The durable and model-facing Schedule value types — the file that decides *what a reminder is*.
- **Key abstractions:** `ScheduleId` (branded); five record shapes (`AfterScheduleRecord`, `AtScheduleRecord`, `EveryScheduleRecord`, `DailyScheduleRecord`, `WeeklyScheduleRecord`, `CronScheduleRecord`); `LegacyScheduleRecord`; `RecurringScheduleRecord`; `ScheduleRecord`; `ScheduleDeliveryReceipt`; `ScheduleDeliveryRecord`; `ScheduleCatalogEntry`; the `ScheduleChange` union (`create`/`delete`/`dispatch`); `ScheduleView`; the closed `ScheduleToolError` union (9 codes); `ScheduleCreateRequest`/`List`/`Delete`/`Update`; `ScheduleTimingChange`; `ScheduleDeliveryHistoryRequest`/`Result`; `DeliveryRetentionBounds`.
- **Data flow:** A `ScheduleRecord` (rule + committed UTC target) is bound to a `SessionId` in storage; delivery appends a `ScheduleDeliveryReceipt` (scheduledAt, deliveredAt, messageId) and the record advances.
- **Non-obvious design decisions:**
  - **A title is REQUIRED on every current record** ("Required stored task name; already trimmed, non-empty, and at most 120 characters") — but the *legacy* variants make `title` optional so a v1 log written before titles existed still decodes. Two types, not one: `LegacyScheduleRecord` vs `ScheduleRecord`.
  - **Daily/weekly/cron rules retain an explicit local time and an explicit IANA zone** — "they are not fixed 86,400-second intervals" (AGENTS.md). The stored `scheduledAt` is the *committed UTC instant*; the rule is what generates the next one.
  - **"Inactive reminders remain visible but never schedule another delivery."** A task is not deleted by firing; only an explicit delete removes it.
  - **`ScheduleDeliveryReceipt` is "Durable Session inbox delivery acknowledgment, not model execution completion."** The comment is repeated in `AGENTS.md`: "Do not describe enqueue as model completion."
  - **The error union is closed and stable** — `invalid_prompt`, `invalid_selector`, `invalid_rule`, `invalid_time_zone`, `not_future`, `time_out_of_range`, `frequency_too_high`, `subagent_session`, `internal_error`. `InternalScheduleError` is "a stable fallback that does not disclose an internal exception."
  - **`schedule/changed` is a Cordis *event*, not a durable record**: "Durable task set changed; clients refetch global task and Session-active catalogs."
- **Edge cases & failure handling:** `ScheduleUpdateMiss` is a *non-mutating* outcome (`schedule_not_found` / `schedule_ended` / `schedule_conflict`) — the update never throws for these.
- **Surprising:** The package declares `SessionActivityKindMap { schedule: true }` and `SessionEventMap { 'schedule/change': ScheduleChange }` — the *storage* domain and the *Session event log* are two different durable surfaces for the same concept, and the code carefully keeps them apart.

### `packages/schedule/schedule/src/domain.ts` (1 896 lines — the largest file in the shard)
- **Purpose:** "Strict Schedule decoding, replay, time validation, and framing" — the *pure* layer. No Cordis, no I/O, no clock reads (every function takes `now` explicitly).
- **Key abstractions:** `ScheduleLogError` (code `corrupt_schedule_log`) vs `ScheduleInputError` (8 public codes); `FoldedSchedules`; `RecurringOccurrence`; `createAfter/At/Every/Daily/Weekly/CronScheduleRecord`; `decodeScheduleRecord`/`decodeScheduleChange`; `resolveEvery/Daily/Weekly/CronOccurrence` + `resolveRecurringOccurrence`; `applyScheduleChanges`; `foldScheduleEvents`; `allocateScheduleId`; `canonicalizeCronExpression`; `canonicalizeTimeZone`; `normalizeWeekdays`; `parseAtInput`/`parseDailyInput`/`parseWeeklyInput`/`parseCronInput`; `scheduleView`; `renderReminderFraming`; `renderRecurringReminderBatchFraming`.
- **Data flow:** A model selector → `create*ScheduleRecord(id, prompt, selector, now, title)` → a frozen durable record with a committed UTC `scheduledAt`. At delivery time the runtime calls `resolve*Occurrence(record, acceptedAt)` → `{ occurrenceAt, nextScheduledAt? }` → the record's `scheduledAt` is rewritten to `nextScheduledAt` and the task stays armed.
- **Non-obvious design decisions (the richest set in the shard):**
  - **Two distinct error families.** `ScheduleLogError` = "the durable data is corrupt"; `ScheduleInputError` = "the model/user supplied something invalid". They are never conflated: `rethrowLogError` converts an input error raised while decoding stored data back into a log error, so the *boundary* decides the diagnostic.
  - **"Latest-only" recurrence.** A recurring task that was asleep for a century contributes **only its latest missed occurrence** — `resolveEveryOccurrence` computes `steps = floor((acceptedAt - target) / interval)` and never enumerates the backlog. The same shape is used for daily/weekly/cron (`latestDueOccurrence`, `latestCronOccurrence`).
  - **The committed target is a FLOOR, not a recomputation.** "A committed target remains due even if current tzdata places the rule before it" — `Math.max(candidate, savedTarget)`. A stored rule keeps its committed instant even after a tzdata update would move it, and a *pinned* target stops a second same-date occurrence.
  - **Daily rules are wall-clock, not interval.** `localInstant` uses Temporal with `disambiguation: 'earlier'` and **verifies the round trip** (`zoned.toPlainDateTime().equals(local)`), so a DST *gap* date is skipped and a DST *overlap* resolves to the earlier instant, once.
  - **Cron is implemented from scratch** — a five-field Vixie parser with `*/n`, `a-b/n`, comma lists, Sunday 0/7 folding, **and a canonical encoder** (`encodeCronField`, `encodeStarCronField`) so a stored expression is byte-stable. The star flag is preserved because it changes the day-of-month/day-of-week AND/OR semantics: "The star flag selects the branch only; it never excuses a field's matched values."
  - **The cron search is bounded by `CRON_SEARCH_HORIZON_YEARS = 400`** — the Gregorian calendar repeats every 400 years, "so a rule that matches any local date has a match within this window; walking further can only reach a rule that never matches." The test spies on `Temporal.PlainDate.prototype.add/subtract` to prove the walk stays inside the horizon.
  - **The date line is handled in both directions.** `latestDueOccurrence` starts one day after the *UTC* decision date because "Offsets are less than 24 hours; a date-line rollback can make the current local date earlier than a due date." The test uses `Pacific/Kiritimati` (UTC+14) to prove the due local date can be the *next* day.
  - **The model-facing framing is anti-forgery.** `renderReminderFraming` emits a fixed header plus JSON-escaped fields:
    ```
    [SCHEDULE REMINDER]
    This is a scheduled message from the user
    schedule_id_json: "schedule-\"1"
    occurrence_at: 1970-01-01T00:00:02.000Z
    reminder_prompt_json: "line one\noccurrence_at: forged\n\"quoted\""
    ```
    A prompt containing `occurrence_at: forged` cannot forge a field — the payload is `JSON.stringify`d.
  - **Recurring reminders are batched into ONE message.** `renderRecurringReminderBatchFraming` emits `reminders_json: [...]` — "due recurring tasks in one Session share a message" (AGENTS.md).
  - **Every stored record is `Object.freeze`d**, and weekday arrays are frozen too.
  - **`foldScheduleEvents` is a pure replay** with a `SessionLogOffset` boundary ("the package-owned stream after the durable fork seed boundary"), and it *rejects* invalid transitions (reused id, delete of an inactive id) rather than silently ignoring them.
  - **`everySeconds` has a public floor of 60 s** (`MIN_EVERY_INTERVAL_SECONDS`), reported as `frequency_too_high`.
  - **The zone is canonicalized at creation but the STORED spelling is preserved.** `canonicalizeTimeZone('US/Eastern')` → `'America/New_York'` for *comparison*, but a stored `timeZone: 'US/Eastern'` is kept verbatim, and the decode path only checks that it is a valid IANA name. A stored zone alias + pinned target survives restart byte-identically.
- **Edge cases & failure handling:**
  - `futureInstant` rejects a non-strictly-future or out-of-range target with distinct codes (`not_future` vs `time_out_of_range`).
  - `calendarEpoch` round-trips the calendar fields to *reject normalization* (e.g. Feb 30) instead of letting `Date` roll it over.
  - A local time that does not exist in its zone throws `'The local at time does not exist in the selected time zone.'`
  - A rule that can never fire again returns `{ occurrenceAt }` with **no** `nextScheduledAt` — the task retires rather than spinning.
- **Surprising:**
  - **`every` is anchored to creation, not to the wall clock.** The interval is `target + k*interval` from the original anchor, so a task created at 12:00:00.125 with a 300 s interval always fires at `xx:xx:00.125` offsets.
  - **`decodeScheduleRecord` (current) vs `decodeLegacyScheduleRecord` (v1)** are different functions, and the daily/weekly/cron kinds are **rejected by the v1 decoder** — the daily/weekly/cron records belong only to Host storage, never to a Session event log. The tests assert this in both directions.
  - `allocateScheduleId` produces `schedule-1`, `schedule-2`, … but skips any id ever used — the Host uses `schedule-<uuid>` while the *fold* uses readable ordinals.

### `packages/schedule/schedule/src/storage.ts`
- **Purpose:** The durable Host-wide Schedule domain — one zod schema over one table.
- **Key abstractions:** `scheduleTaskSchema` (zod); `ScheduleTask`; `scheduleDomain = defineDomain({ name: 'schedule', version: 1, tables: { tasks: domainTable<ScheduleId, ScheduleTask>(scheduleTaskSchema) } })`.
- **Data flow:** `domain.table('tasks').put(id, task)` / `.get(id)` / `.delete(id)`; the whole unit is published as ONE document per write.
- **Non-obvious design decisions:**
  - **The record is decoded by the package's own decoder, not by zod.** `recordSchema = z.unknown().transform(decodeScheduleRecord)` — zod is the *outer* shape, the package owns the inner semantics. A malformed record rejects with the package's own diagnostic.
  - **`status` defaults to `'active'`** — "absent status decodes as active", which is how version-1 tasks (written before the field existed) open without a rewrite.
  - **A cross-field refinement ties `lastDelivery` to the newest history record.** "Last delivery must match the latest saved delivery receipt." The schema refuses a state where the two disagree.
  - **Delivery history records must have unique `messageId`s** within a task — a refinement on the array.
  - **Instants must be canonical four-digit-year UTC** (`z.iso.datetime({ precision: 3 })` + a `!startsWith('0000-')` refinement).
- **Edge cases & failure handling:** "malformed tasks reject opening the domain" — the *whole* domain refuses to open rather than opening empty. The test writes a JSON file with an array-shaped `tables` map and asserts the open rejects with `malformed-medium` **and the file bytes are unchanged**.
- **Surprising:** The domain's whole-unit document means an unbounded history array would grow the file on every acknowledgment — hence the retention pruning in `delivery-history.ts`.

### `packages/schedule/schedule/src/runtime.ts`
- **Purpose:** The Host timer over stored tasks; "Session activation is a delivery operation."
- **Key abstractions:** `class ScheduleRuntime`; `MAX_TIMER_DELAY_MS = 2_147_483_647` (Node's own limit).
- **Data flow:** `requestDrive()` → `ctx.agents.withoutInitiator(async () => { while (requested && !stopping) { requested = false; await transact(() => drive()) } })` → `drive()` scans active tasks whose `scheduledAt <= now`, groups the due *recurring* tasks of one Session, resolves the Session's agent, `followup`s a message, `await ctx.sessions.flush(...)`, then commits the new status/target/receipt/history → finally arms ONE timer for the nearest future obligation.
- **Non-obvious design decisions:**
  - **Delivery and management share one serialized transaction** (`this.transact`), so a `schedule/changed` write and a delivery commit cannot interleave.
  - **The timer is recomputed from scratch every drive** and is `unref()`ed, so it never keeps the process alive.
  - **The timer is segmented by `MAX_TIMER_DELAY_MS`** — a 3 000 000 s wait is armed in ≤ 2 147 483 647 ms chunks.
  - **A delivery that fails leaves the task stored and arms NO retry timer** — "Failed delivery leaves the task stored and reports the failure. **Do not add a generic retry loop.**" (AGENTS.md). The failed task is excluded from the next-timer computation, so it waits for the next startup or management change.
  - **Session restoration is re-checked against the clock.** After `resolveAgent` (which can take a long time), the runtime re-samples `now` and drops members whose target is no longer due: "Session restoration can span a wall-clock rollback; future members keep their timer obligation."
  - **Due recurring tasks of one Session are delivered in ONE message** with ONE `messageId` shared by every task in the batch.
  - **The commit is *after* the flush, and the flush is *after* the followup.** "followup synchronously appends the inbox splice before flush observes the Session" and "await Session persistence, then retire or advance the task."
  - **A partial batch failure keeps the successful commits.** "Successful commits and targets made future by clock rollback keep their timer obligation."
- **Edge cases & failure handling:**
  - `flush` returning `false` is a failure: `throw new Error('Session persistence did not acknowledge the reminder')` — the receipt is not written.
  - A `SessionController` that returns `{ error }` (a *declared* error, not a throw) is handled: `if ('error' in resolved) throw resolved.error`.
  - `dispose()` sets `stopping`, clears the timer, and awaits the in-flight run — "Shutdown drains accepted work before closing storage."
  - `requestDrive` catches an admission refusal (`withoutInitiator` throwing because the ancestor is unloading) and warns: `'schedule: dispatch stopped: ...'`.
- **Surprising:** **The delivery receipt is an *inbox* acknowledgment, not a model execution result.** The `delivery.spec.ts` test holds model execution inside `runMaintenance` and still expects the receipt to be written — "acknowledges the real synchronous inbox splice after flush without claiming model execution."

### `packages/schedule/schedule/src/delivery-history.ts`
- **Purpose:** "Saved delivery interpretation and identity-based pagination without Session reads."
- **Key abstractions:** `appendDelivery(task, receipt, bounds)`; `deliveryHistoryPage(task, request, retention)`.
- **Data flow:** `appendDelivery` reads the existing history, appends `{...receipt, prompt: task.record.prompt}`, filters by the day window, slices to the record cap, and returns `{ lastDelivery, deliveryHistory }`. `deliveryHistoryPage` walks the array in *append* order and returns a newest-first page with a `nextBefore` cursor.
- **Non-obvious design decisions:**
  - **Pruning happens on the WRITE path only** — "the domain publishes one whole-unit document per write, so an unbounded array would grow that document with every acknowledgment."
  - **The read path states no bound of its own** — "a whole-unit document over the schema's limits refuses to open", so the read cannot be the thing that enforces the cap.
  - **Two distinct "earlier records" flags.** `earlierRecordsUnavailable` = "missing receipts are never reconstructed"; `earlierRecordsPruned` = "True only after an append removed saved records". A legacy task with only a `lastDelivery` reports *unavailable* but NOT *pruned*.
  - **Pagination is by message identity, not by timestamp** — "newest-first in append order, independent of wall-clock ordering", which survives a clock rollback.
- **Edge cases & failure handling:** An unknown cursor returns `{ code: 'delivery_cursor_not_found' }`; the returned records are *copies* (a test mutates the response and re-reads to prove storage is untouched).
- **Surprising:** The history stores the **immutable prompt that was actually sent** per receipt — so an edit to the task's prompt does not rewrite history.

### `packages/schedule/schedule/src/update.ts`
- **Purpose:** "Optimistic name, instruction, and timing updates of retained Host tasks, without Session mutations."
- **Key abstractions:** `retainedTitle(record)`; `resolveScheduleUpdate(current, expected, change, now, content)`; private `validateChange`, `schedulePrompt`, `withContent`, `changedRecord`, `timingSelector`.
- **Data flow:** The caller supplies the *complete record it observed* (`expected`). The resolver decodes `expected`, compares it to `current` with `isDeepStrictEqual`, and only then applies the change. A mismatch returns `{ code: 'schedule_conflict' }` — a **compare-and-swap**.
- **Non-obvious design decisions:**
  - **The wire shape is validated by key count, not by a schema.** "Timing change must contain exactly kind and its matching timing selector" — `keys.length !== 2` plus a whitelist of the five selectors. An extra key like `prompt` is refused.
  - **A name or instruction change alone NEVER re-anchors the schedule.** "A supplied name or instruction never re-anchors the schedule on its own; an equivalent normalized timing change keeps the committed target too."
  - **An equivalent normalized timing change is a NO-OP that returns the same object identity** (`result.record` is `current`), so the caller can skip the write. The zone *alias* is treated as equivalent: `US/Eastern` vs `America/New_York`.
  - **The change kind may differ from the stored kind** — a weekly record can become a cron record with the same id and prompt. "the same identity, prompt, and title, but a different rule."
  - **Programming failures are not converted into public input results.** `if (!(error instanceof ScheduleInputError)) throw error` — a bug in the domain throws; only a genuine input problem becomes a bounded `{ code, message }`.
- **Edge cases & failure handling:** A malformed `expected` returns `{ code: 'invalid_rule', message: 'expected must be a complete valid Schedule record.' }` — a fixed public message, no internals.
- **Surprising:** `withContent` returns `current` itself when nothing changed — the *same frozen object*, so `updated: false` is detectable by identity, not by comparison.

### `packages/schedule/schedule/src/index.ts`
- **Purpose:** The `ScheduleService` — the shared Host-wide management surface (`ctx.schedule`), a `TypertRemoteService` so the browser client can call it over the wire.
- **Key abstractions:** `class ScheduleService extends TypertRemoteService` with `static inject = ['agents', 'sessions', 'storageDomain', 'sessionController', 'sessionPersistence']`; `Config` (`deliveryHistoryDays` 30, `deliveryHistoryRecords` 200); `@Remote('list'|'catalog'|'history'|'delete'|'update')` methods; `create(...)`.
- **Data flow:** `create` → validate the selector (exactly one) → `scheduleTitle` → allocate a uuid id → build the record from a `now` sample → `serialize(...)` → refusal check (subagent) → `signal?.throwIfAborted()` → `tasks.put(id, task)` → `emitChanged()` → `runtime?.requestDrive()`.
- **Non-obvious design decisions:**
  - **`create` is NOT `@Remote` but list/catalog/history/delete/update are.** The model-facing creation goes through the *tool* package; the browser gets the others. (The `Remote` decorator on the mutating methods is what the Web editor uses.)
  - **Every mutation goes through one FIFO `serialize()` chain.** "this.chain = pending.catch(() => undefined) // Preserve FIFO progress after the caller receives the failure."
  - **The clock sample for a create is taken BEFORE it joins the queue.** "a create that waits behind a longer operation keeps its request-time anchor and may already be due when the queue reaches it." The *update*, by contrast, uses the **queue-time** clock — "uses the fresh queue-time clock after a blocked creation rather than the edit request time."
  - **Reads and deletes NEVER activate a Session.** The class doc: "Shared management service; reads, deletion, and timing edits never activate a Session." `catalog()` reads the *stored rows*, not live runtime state.
  - **A delegated child's Session is refused at creation and update** (`reminderTargetRefusal`), because "Delivery resolves the bound Session through `ctx.sessionController.resolveAgent`, which rejects the live Agent of a delegated child; a stored task for such a Session would stay permanently overdue and retry on every drive." The refusal is based on `delegationDepthOf(agent)`, "the accounting the delegation cap itself enforces, which survives a cold resume through the persisted header." **But deletion stays allowed** — "so a task stored before that rule existed remains removable."
  - **The update refusal travels as an ordinary *result*, not a rejection** — "so the Web editor can explain the refusal through the ordinary result it already renders."
  - **The stored key must equal the record id** — a mismatch throws at startup: `schedule: stored task key "X" differs from record id "Y"`. The comment: "The mismatch is the actionable failure; a rejecting close must not replace it."
  - **`emitChanged` contains a throwing listener** — "The event is a notification, not a transaction participant."
  - **A legacy Session with active historical reminders gets a warning, not a migration.** "do not scan or migrate all historical Sessions implicitly."
  - **`schedule/changed` is emitted only AFTER the durable write landed.**
- **Edge cases & failure handling:** `serialize` rejects with `'Schedule service is stopping'` once teardown began. A cancellation *after* a write starts does not roll it back. `stopSessionTasks` attempts **every** row and aggregates failures, and notifies observers when at least one row was removed.
- **Surprising:** **The service registers NO tools.** `schedule_create`/`list`/`update`/`delete` live in `dsh-tool-schedule`; the service is the *Host* surface. A test asserts `ctx.tools.get('schedule_create')` is undefined even with agents registered.

### Tier 2 — bulk: the schedule test suite

| File | What it is / what it pins |
| --- | --- |
| `packages/schedule/schedule/tests/harness.ts` | The shared fixture: a real `DomainFacility` over a memory backend, an explicit fake `sessionController.resolveAgent`, a fake `session/flush` listener, `gatedScheduleBackend` (per-primitive write/delete traps that can hold a row write open), and `agentFor(ctx, id, meta)` (an unregistered Agent whose `followup` is a spy property). |
| `packages/schedule/schedule/tests/recurrence.spec.ts` | A **fast-check property test** (300 runs) proving the latest-only runtime calculation and the durable fold agree on the creation anchor for every (interval, skipped, offset) triple. The only property-based test in the shard. |
| `packages/schedule/schedule/tests/malformed-unit.spec.ts` | An array-shaped `tables` map must make the domain **refuse to open** (`malformed-medium`) rather than open empty — because an empty read would let the first write republish the file without the task it could not see. Asserts the file bytes are unchanged. |
| `packages/schedule/schedule/tests/legacy-history.spec.ts` | An unreadable historical `schedule/change` stream must not veto Session creation: the Session stays attached, a warning names the session and the reason, and the legacy reminder is ignored. |
| `packages/schedule/schedule/tests/delivery.spec.ts` | The receipt acknowledges the **real synchronous inbox splice** after flush, without claiming model execution: with model execution held inside `runMaintenance`, the splice is visible, the receipt is written, and no `assistant/message` exists. |
| `packages/schedule/schedule/tests/serial-delivery.spec.ts` | A due reminder delivered **during Agent creation** enqueues the message without starting a turn, and the turn only starts after every `agent/created` listener finishes. |
| `packages/schedule/schedule/tests/subagent-ownership.spec.ts` | The `subagent_session` refusal: creation and update are refused for a delegated child's Session (by origin, by ownership, and by delegation depth alone), but list and delete still work so a legacy row stays removable. |
| `packages/schedule/schedule/tests/daily.spec.ts` | Daily wall-clock rules: strictly-future date selection, fractional-second normalization, leap days, 23 loose time formats rejected, DST transitions (New York, Lord Howe's half-hour, Apia's skipped 30 December 2011), latest-only decisions after centuries of downtime, the Anchorage 1867 date-line rollback, pinned targets, and the four-digit-year limits. |
| `packages/schedule/schedule/tests/weekly.spec.ts` | Weekday normalization (unique ascending ISO 1–7), the first strictly future weekday, DST gap/overlap resolution, pinned targets, the four-digit limits, durable decoding, and the weekly timing-edit matrix. |
| `packages/schedule/schedule/tests/cron.spec.ts` | The cron engine: canonicalization of 30+ expressions (star flags preserved, Sunday 7→0, `*` vs `1-31` distinguished), 28 rejected expressions, Vixie day-of-month/day-of-week AND/OR semantics, DST fall-back, the UTC+14 date line, the 400-year search horizon (measured by spying on `Temporal.PlainDate.prototype.add`), and the four-digit limits. |
| `packages/schedule/schedule/tests/domain.spec.ts` | The v1 event protocol: decoding/freezing each operation, folding create order, rejecting reused ids and invalid transitions, the fork boundary (`SessionLogOffset`), the readable id allocator, the required title, and the anti-forgery JSON framing. |
| `packages/schedule/schedule/tests/domain-restart.spec.ts` | Durable round-trips through real JSON storage: reopen active/ended tasks, keep the zone alias and pinned target, keep the weekly weekday set and history, open a version-1 task without `status` as active, and the exhaustive zod rejection table for every stored field. |
| `packages/schedule/schedule/tests/delivery-history.spec.ts` | History pagination by identity across appends and clock rollback (103 records, 2 pages, no duplicates), explicit missing-task / wrong-binding / unknown-cursor results, the invalid-limit table, immutable prompt snapshots across a restart, "no additional history or notification after a flush/write failure", the delete-removes-history rule, and the retention/pruning flags. |
| `packages/schedule/schedule/tests/recovery.spec.ts` | Startup recovery: a malformed / version-mismatched / invalid-record domain **refuses to open** and the file bytes are preserved; a repaired file opens and the service activates; legacy history reads without a rewrite; a durable create/delete survives an ancestor unloading mid-dispatch; a startup dispatch-admission failure logs without rejecting the initialized storage. |
| `packages/schedule/schedule/tests/plugin.spec.ts` | The service surface: the empty initial history, archive admission (an armed row refuses the archive and names what must stop), a stop that joins an in-flight create's queue slot, partial-delete notification with an `AggregateError`, a rejection reason that is not an `Error`, the catalog ordering, the "Exactly one reminder selector" rejections, and the legacy-reminder warnings. |
| `packages/schedule/schedule/tests/update.spec.ts` | The pure update resolver: all 30 (stored kind × change kind) transitions, stale-snapshot conflicts, no-op equivalence (including the zone alias), content-only edits that keep the target, the 25-case invalid-wire table, "programming failures are not converted into public input results", and the title rules. |
| `packages/schedule/schedule/tests/update-service.spec.ts` | The service update: one task write preserving Session/prompt/receipts/history, FIFO serialization of competing saves, the queue-time clock, `not_future` after waiting behind a write, a delete ordered before an edit, cancellation before/queued/during-writing (no rollback after writing begins), a persistence failure that publishes nothing, and the "does not emit until the accepted update write completes" ordering. |
| `packages/schedule/schedule/tests/runtime.spec.ts` | The timer: latest-only delivery after downtime, clock rollback re-arming, a batch that cannot be persisted keeping the other task armed, a daily task's identity across two deliveries, "a failed enqueue without a retry timer", a failed flush keeping the task, the daily advance published only after the flush, draining on disposal, segmented long waits, same-Session batching, mixed batches with future members, the final representable occurrence retiring the task, timer coalescing, and the ancestor-unloading refusal. |
| `packages/schedule/schedule/tests/update-restart.spec.ts` | A daily edit survives a Host restart with its saved history, without Session activation, and a no-op leaves the file **byte-identical** (including the stored zone alias `US/Eastern` and the pinned millisecond target). |
| `packages/schedule/schedule/README.md` | (see the group table below) |
| `packages/schedule/README.zh.md` | Chinese translation of the schedule group README. |
| `packages/schedule/AGENTS.md` | The **rules** for this package group — the most valuable document in the shard for anyone copying it: storage owns active/ended tasks and only explicit deletion removes one; one Host runtime scans at startup and never re-arms an ended task; "Daily rules retain an explicit time and IANA zone; they are not fixed 86,400-second intervals"; "Skip missing local dates/times and select the earlier overlap once per date"; "These writes are not atomic: a crash between them may duplicate delivery. **Do not describe enqueue as model completion or add an execution-record state machine**"; "Failed delivery leaves the task stored and reports the failure. **Do not add a generic retry loop**"; "Warn when loading a Session with active historical reminders; do not scan or migrate all historical Sessions implicitly"; "Keep recurrence arithmetic pure." |

### `packages/schedule/tool-schedule/src/index.ts`
- **Purpose:** The model-facing `schedule_create`, `schedule_list`, `schedule_update`, `schedule_delete` over the Host `ctx.schedule`.
- **Key abstractions:** `export const name = 'tool-schedule'`; `export const inject = ['tools']`; `apply(ctx)`; private `registerScheduleTools(ctx)`; `validateCreateArgs` / `validateUpdateArgs`; `timingChangeFrom`; `operationError`; `internalError`; `subagentCallerRefusal`.
- **Data flow:** `apply` does `ctx.inject(['schedule'], (scheduleCtx) => registerScheduleTools(scheduleCtx))` — the tools register **only once the scope resolves the Host `schedule` service**. Each `execute` reads `exec.agent` for the Session binding, validates, then calls the service.
- **Non-obvious design decisions:**
  - **The tool layer owns the *caller* guard; the service layer owns the *target* guard.** The tool refuses a delegated child with `'A delegated subagent cannot use reminders.'`; the service refuses a Session a delegated child owns with `'This Session belongs to subagent routing, which never receives reminder delivery.'` Two guards, two messages, two places.
  - **`operationError` withholds storage detail.** Only a `ScheduleInputError` keeps its code and message; anything else collapses to `{ code: 'internal_error', message: 'The schedule operation failed.' }` — "so storage details never reach the model."
  - **The output schema is a hand-written `oneOf` over 6 view shapes + 9 error shapes** — the model gets a *literal* `code` per error, not a free string.
  - **`schedule_update` re-reads the catalog to build `expected`.** "The catalog also holds inactive reminders, which is the one not-found case the model can act on: it has to create a new reminder instead." So an ended task returns `schedule_ended`, an unknown one `schedule_not_found`.
  - **The tool description states the DST and catch-up semantics to the model** ("Local times that do not exist in the zone are skipped; repeated local times fire once, at the earlier instant… After downtime, a recurring reminder delivers only its latest missed occurrence. **Delivery can repeat after a crash.**").
  - **`CREATE_TITLE_DESCRIPTION` is a *composition* rule, not just a length rule**: "Do not include execution frequency (e.g. daily, hourly), scheduled dates/times, time zones, task status, or configuration and execution details… Put scheduling information in the timing parameters and execution instructions in prompt." This is a prompt-level discipline that mirrors August Trading's "the title is the card heading" concern.
- **Edge cases & failure handling:** A call with no `exec.agent` returns `internal_error` ("rather than guessing a Session"). An already-aborted signal returns `internal_error` *before* the service is called. A cancellation in the FIFO does not mutate the task.
- **Surprising:** **`schedule_update` refuses `after_seconds`** — "To change a relative delay, create a new reminder." The relative delay has no committed rule to re-anchor.

### `packages/workflow/workflow/src/types.ts`
- **Purpose:** The browser-safe workflow vocabulary.
- **Key abstractions:** `WorkflowRunId`; `WorkflowPhase`; `WorkflowMeta`; `WorkflowStopReason` (`completed`/`cancelled`/`error`); `WorkflowResult`; `WorkflowRunInfo`; `WorkflowAgentInfo`; `WorkflowAgentOutcome`; `WorkflowAgentEndInfo`; `WorkflowResultInfo`.
- **Non-obvious design decisions:**
  - **`WorkflowPhase` is "progress vocabulary only — phases group agents in observers/UIs; they impose no execution structure."** A phase is a *label*, not a barrier.
  - **`WorkflowResultInfo` deliberately omits the value.** "a listener observing outcomes must not receive a mutable alias of the caller's result value; a consumer that needs the value holds the run and awaits `result`."
  - **`agentsStarted` degrades honestly on a termination path** — "on a graceful settlement this is the script-side count… on a termination path (cancellation or process failure) it degrades to the host-observed count — calls queued inside a terminated script are unknowable then."
- **Edge cases & failure handling:** The stop-reason union is **CLOSED** — "engine-owned, consumers may exhaust".
- **Surprising:** `WorkflowMeta` "The field vocabulary matches the Claude Code dynamic-workflows meta block" — the seam is deliberately shaped like an existing product's format.

### `packages/workflow/workflow/src/runtime-types.ts`
- **Purpose:** Host-only `WorkflowStartRequest` and `WorkflowRun` handles, split out so a browser client never imports Agent declarations.
- **Key abstractions:** `WorkflowStartRequest` (`script`, `meta`, `args?`, `subagentProvider?`, `maxTotalAgents?`, `parent: Agent`, `signal?`); `WorkflowRun` (`id`, `meta`, `result`, `cancel(reason?)`, `dispose()`).
- **Non-obvious design decisions:** **`result` never rejects.** "consumers may cancel and must call idempotent `dispose()` to await script and child quiescence." `parent` is **required** — "every `agent()` spawned by the script is attributed to that live Agent."

### `packages/workflow/workflow/src/index.ts`
- **Purpose:** The `ctx.workflowEngine` Service Definition — the contract every workflow engine implements.
- **Key abstractions:** `abstract class WorkflowEngine extends Service`; `WorkflowError` (extends `HarnessError`); `isFatalWorkflowError`; the six `workflow/*` Cordis event declarations; `WorkflowErrorCode` (11 codes).
- **Data flow:** `start(request)` → a live `WorkflowRun`. `emitWorkflowEvent(name, ...args)` dispatches to every listener.
- **Non-obvious design decisions:**
  - **The `fatal` flag is the whole failure discipline.** "a typo'd option or a tripped cap must kill the script loudly, and reserve the per-item `null` for child-run failures and ordinary in-stage script errors. **Every `WorkflowErrorCode` is fatal; the flag exists so the distinction is explicit at every catch site rather than implied.**"
  - **Listener containment is per-listener and total.** A throwing listener is logged ("workflow: <name> listener threw: …") without starving peers; a *rejecting* listener is caught too. `renderListenerError` even survives a throwing `toString` → `'[unrenderable thrown value]'`.
  - **The events are observe-only.** "payloads carry run identity snapshots, never the live run, so listeners cannot acquire cancellation or disposal authority."
  - **`workflow/end` fires exactly once as the result settles**, with the outcome *data* only.
  - **`workflow/agent-end` is paired with `workflow/agent-start` by `agent.seq`**, "exactly once per started call on every stop path — on an engine termination path the end is engine-synthesized with outcome `'cancelled'`."
- **Edge cases & failure handling:** `WorkflowErrorCode` separates start failures (`SCRIPT_PARSE`, `META_INVALID`, `INVALID_ARGUMENT`, `UNSUPPORTED_OPTION`, `UNSUPPORTED_SCHEMA`), caps (`AGENT_CAP`, `ITEM_CAP`), provider faults (`AGENT_START`, `AGENT_RESULT`), boundary values (`RESULT_UNSERIALIZABLE`) and `CANCELLED`.
- **Surprising:** `WorkflowError` extends `HarnessError`, so its `code` is the *same* machine-routable taxonomy the rest of the harness uses.

### `packages/workflow/workflow-ptc/src/index.ts`
- **Purpose:** The PTC-backed workflow engine (the shipped implementation of `ctx.workflowEngine`).
- **Key abstractions:** `class PtcWorkflowEngine extends WorkflowEngine` with `static inject = ['subagents', 'ptcRuntime', 'sandboxPolicy', 'workingDirectory']`; `Config` (`provider` 'spawn', `maxConcurrentAgents` 0, `maxTotalAgents` 1000, `maxItemsPerCall` 4096, `syncTimeoutMs` 5000); private `assertBodyParses`, `resolveSubagentProvider`, `resolveMaxTotalAgents`.
- **Data flow:** `start(request)` → `validateMeta` → `assertBodyParses` → resolve provider + cap → mint a uuid run id → build `WorkerInit` → construct `PtcWorkflowRun` → emit `workflow/start` → attach `workflow/end` on `run.result`.
- **Non-obvious design decisions:**
  - **The host parses the script before publishing a run.** `new vm.Script(...)` — "Parse only — the script object is discarded, nothing executes." A bad script fails *synchronously* with a violation list the model can correct.
  - **A Claude Code-style meta header in the body is caught by name.** `META_STATEMENT = /^\s*export\s+const\s+meta\b/` → *"workflow meta rides the `meta` request field, not the script: remove the `export const meta = {...}` statement from the body"*. The comment: "The likeliest authoring slip — a Claude Code-style meta header in the body — gets a pointed message, not a bare SyntaxError."
  - **The engine refuses a non-TypeScript PTC runtime at load.** `if (ctx.ptcRuntime.language !== 'typescript') throw new Error('workflow-ptc requires the Node TypeScript PTC runtime')`.
  - **The concurrency ceiling auto-resolves from the machine**: `maxConcurrentAgents === 0` → `Math.min(16, Math.max(1, availableParallelism() - 2))`. The test suite overrides it to 8 because "the auto-resolved default is machine-derived (cores - 2, floored at 1), so tests that expect N children in flight would wedge on small CI runners."
  - **A per-run cap may only *lower* the engine ceiling** — `workflow maxTotalAgents 3 exceeds the engine ceiling 2`.
  - **`args` are `structuredClone`d** at start — "captures args at start and isolates subsequent caller and script mutations" (the test mutates the caller's array afterwards and the script still sees the original).
  - **The engine captures its dependencies at start** so "an accepted run retains its dependencies through engine unload" — the run survives an HMR reload of the engine plugin.
- **Edge cases & failure handling:** A missing provider route throws `AGENT_START` before a run exists. `start()` never returns a run whose `result` rejects.
- **Surprising:** `maxTotalAgents` (1000) and `maxItemsPerCall` (4096) are *cooperative* caps — "they are not host-enforced security quotas or descendant token budgets."

### `packages/workflow/workflow-ptc/src/runtime.ts`
- **Purpose:** The VM hooks, the combinators, the concurrency slots and the result serialization — the part that runs *inside* the sandboxed Node process.
- **Key abstractions:** `class WorkflowExecution`; `interface ExecutionObserver`; `SUPPORTED_AGENT_OPTIONS` / `DEFERRED_AGENT_OPTIONS`; private `agent`, `parallel`, `pipeline`, `phase`, `log`, `acquireSlot`, `releaseSlot`, `readAgentOptions`, `materializeResult`, `contain`, `assertItemCap`.
- **Data flow:** `new vm.Script('(async () => {…})()')` → `vm.createContext({})` → six frozen globals (`agent`, `parallel`, `pipeline`, `phase`, `log`, `args`) → `runInContext(context, { timeout: syncTimeoutMs })` → `materializeFromRealm(raw)`.
- **Non-obvious design decisions:**
  - **`pipeline()` has NO cross-stage barrier.** "run each item through the stages independently with NO barrier between stages (prefer this for multi-stage work)". `parallel()` is the barrier form. The tool description tells the model exactly this.
  - **A per-item failure is `null`; a misuse is fatal.** `parallel()`/`pipeline()` catch an item's throw → `null`, but re-throw a `WorkflowError` (fatality recognized by `instanceof` against the *host* class — "a script-built object can never pass it, so fatality cannot be forged (nor accidentally dissolved)").
  - **`agent()` returns `null` for an ordinary child failure, not an exception.** A child whose *result promise rejects* is an infrastructure fault → fatal `AGENT_RESULT`; a child that resolves with a non-`completed` stop reason → `null`.
  - **A schema'd child that completes WITHOUT a structured value is a child failure** → `null`.
  - **A dropped hook promise gets a no-op rejection consumer** (`contain`) — "if the script drops the promise, a host rejection cannot become an unhandled rejection that kills the process; if the script does await it, it still observes the rejection."
  - **Unknown option names are rejected with the *deferred* ones named separately**: `'agent() option "effort" is deferred and not supported by this engine (supported: label, phase, schema, provider, model)'` vs `'agent() option "x" is not recognized (…)'`.
  - **The `agent()` cap is checked BEFORE the slot is acquired**, and the message is a *backstop* explanation: "a runaway-loop backstop; raise the applicable maxTotalAgents limit if the scale is intentional".
  - **The concurrency slots are FIFO** — `slotWaiters.shift()`.
- **Edge cases & failure handling:** A non-JSON return value → `RESULT_UNSERIALIZABLE` with the path in the message. The `syncTimeoutMs` bounds only the *initial synchronous slice*.
- **Surprising:** **The script's global `args` is frozen?** No — only the *functions* are frozen ("a script overwriting its own hooks only sabotages itself"); `args` is a plain value.

### `packages/workflow/workflow-ptc/src/realm.ts`
- **Purpose:** "Materializes script VM values as plain JSON and renders thrown values."
- **Key abstractions:** `class MaterializeError`; `materializeFromRealm(value, root)`; `renderThrown(error)`; private `hasPlainPrototype`, `materialize`, `materializeArray`, `materializeObject`.
- **Non-obvious design decisions:**
  - **The materializer mirrors `JSON.stringify` exactly** — own enumerable string keys only ("non-enumerable props never reach JSON output"), and it *rejects* the things JSON would silently drop: sparse arrays, non-index array properties, symbol keys, `NaN`/`Infinity`, bigint, functions, symbols, nested `undefined`, cycles, and exotic prototypes.
  - **A `__proto__` key becomes an OWN data property.** `Object.defineProperty(out, key, {...})`, never assignment: "a `__proto__` key must become an OWN data property of the copy, not a prototype mutation." The test asserts `({}).polluted` is still `undefined` on the host.
  - **Getters run and their RESULT crosses** — "the getter RESULT is what crosses (trust premise)". A getter that *throws* becomes a `MaterializeError` carrying the rendered failure.
  - **A DAG is fine; a cycle is not.** The `seen` set is added/removed around the recursion, so the same object reused as a sibling is accepted.
  - **`renderThrown` is total** — stack → message → `String()` → `'[unrenderable thrown value]'`.
- **Edge cases & failure handling:** The cross-realm prototype test is *"the realm's `Object.prototype` — which we cannot compare by identity across realms"*, so it checks the prototype *chain* shape instead.
- **Surprising:** Root `undefined` is allowed (a valueless script) but nested `undefined` is not.

### `packages/workflow/workflow-ptc/src/host.ts`
- **Purpose:** The host side of the PTC bridge — child ownership, progress, settlement and disposal.
- **Key abstractions:** `class PtcWorkflowRun implements WorkflowRun`; `interface ChildRecord`; the six `bindings()` host functions (`begin`, `startChild`, `childResult`, `disposeChild`, `progress`); `GUEST_URL` (a `data:text/javascript,` URL built from `WORKFLOW_GUEST_SOURCE`).
- **Data flow:** `drive()` → `runtime.run(runtime.resolve({ program, bindings: [{ global: 'workflowHost', functions: this.bindings() }], cwd, sandboxPolicy, timeoutMs: null, signal }))` → the guest calls back over JSON → the host owns the children.
- **Non-obvious design decisions:**
  - **The program is a fixed wrapper.** `const { runWorkflowGuest } = await import("<data-url>"); return await runWorkflowGuest(workflowHost);` — the *host* owns the guest's entry point, so a script cannot substitute its own loader.
  - **`timeoutMs: null`** — the workflow has NO overall elapsed deadline. "Its initial VM slice still has `syncTimeoutMs`, and a caller's abort signal still applies."
  - **The confinement check is explicit.** `if (this.runtime.sandboxMode === undefined && this.policy.mode !== 'danger-full-access') throw new Error('workflow runtime cannot enforce the ${mode} file policy')` — a runtime without confinement is accepted *only* for full access.
  - **The captured working directory is frozen at start.** "The PTC process and every child started by that workflow retain the captured directory when the parent later moves."
  - **Pending starts and accepted activations are tracked separately.** A child that becomes ready *after* cancellation is still disposed: `if (this.controller.signal.aborted) { await this.disposeChild(record); throw new Error('workflow child started after cancellation') }`.
  - **Each child's disposal is memoized** (`record.disposal ??= …`) so every cleanup path disposes it exactly once, and the disposal failure is *warned*, not thrown.
  - **Cancellation wins over a concurrent completion.** "The first accepted terminal outcome owns the run result." The `finally` block aborts the controller, disposes every child, awaits the pending set, and synthesizes `outcome: 'cancelled'` endings for every still-live agent.
  - **The guest program is transported as a `data:` URL** — the sandboxed process never touches the filesystem to load the guest.
- **Edge cases & failure handling:** The `childResult` wait races an abort (`Promise.race([record.run.result, aborted.promise])`) so a cancelled child stops blocking. A malformed callback payload is rejected with a named message ("workflow child call id must be an integer", "invalid workflow agent outcome", …).
- **Surprising:** `endAgent` is **idempotent by sequence number** — `if (!this.liveAgents.delete(info.seq)) return` — so a duplicate `agent-end` produces no second event.

### `packages/workflow/workflow-ptc/src/guest.ts` + `src/guest-types.ts` + `src/meta.ts`
- **Purpose:** The guest adapter, its JSON callback surface, and the meta validator.
- **Key abstractions:** `runWorkflowGuest(host)`; `interface WorkflowGuestHost` (`begin`, `startChild`, `childResult`, `disposeChild`, `progress`); `type WorkflowProgress`; `validateMeta(value)`.
- **Non-obvious design decisions:**
  - **Progress is BATCHED with one batch in flight.** `flush()` sends a batch and chains the next on its acknowledgement; "The first batch reaches the host before a synchronous script can seize its loop." A 200-line `log()` loop is 2 round-trips, not 200.
  - **Progress is drained before the terminal result and before child disposal** — "deliver queued child lifecycle events before disposing the published child".
  - **A progress-delivery failure becomes the run's error**, and the queued progress is dropped rather than retried.
  - **`meta` is DATA, never code.** "Meta arrives as schema-checked JSON data, never evaluated script text." `validateMeta` returns a **normalized copy** (so the engine never aliases the caller's object) and names **every** violation in one message ("names EVERY violation in one throw, not just the first"). Unknown fields are rejected: "accepted-then-ignored is banned."
- **Edge cases & failure handling:** The `WorkflowGuestHost` functions are *promises over JSON*, so a guest-side value is always lossless JSON.
- **Surprising:** The guest is the *same code* as the host's `runtime.ts` — the file is a **generated bundle** (`scripts/gen-workflow-guest.ts`) shipped as a string constant and imported over a `data:` URL.

### `packages/workflow/workflow-ptc/src/guest-source.ts` (43 KB, generated)
- **Purpose:** "Self-contained ESM guest transported into the mounted PTC runtime." Header: *"Generated by scripts/gen-workflow-guest.ts. Do not edit directly."*
- **Content (verified by unescaping the string literal):** a bundled ESM module concatenating, in order: `packages/workflow/workflow-ptc/src/realm.ts` (materialize + renderThrown), `packages/util/brand/src/index.ts` (`brandString`), `packages/llm/llm/src/error.ts` (`HarnessError`), `packages/util/values/src/index.ts` (`assertNever`, the lossless-JSON `walkJsonValue`, `isJsonValue`), `packages/core/tools/src/json-schema.ts` (the enforced JSON-Schema subset, `assertObjectJsonSchema`), `packages/workflow/workflow/src/index.ts` (`WorkflowError`, `isFatalWorkflowError`), `packages/workflow/workflow-ptc/src/runtime.ts` (`WorkflowExecution`), and `packages/workflow/workflow-ptc/src/guest.ts` (`runWorkflowGuest`). It ends with `export { runWorkflowGuest };` and `//# sourceURL=dsh-workflow-guest.js`.
- **Non-obvious design decisions:** **The `sourceURL` is deliberate** — the test asserts a stack from inside the guest contains `dsh-workflow-guest.js:` and does **not** contain `data:text/javascript` ("names generated helper frames without exposing the encoded guest module in errors"). The `sourceURL` gives the frames a name; the error text does not leak the encoded payload.
- **Edge cases & failure handling:** The bundling means the guest carries its *own copies* of the JSON-schema validator and the lossless-JSON walker — the guest cannot reach the host's modules, so the boundary is real.
- **Surprising:** The whole `dsh-tools` JSON-Schema subset (a ~200-line iterative, stack-free validator) is shipped into the sandbox. That is a deliberate cost: the guest validates schemas itself rather than trusting the host.

### `packages/workflow/tool-workflow/src/index.ts`
- **Purpose:** The model-facing `workflow` tool.
- **Key abstractions:** `export const name = 'tool-workflow'`; `inject = ['tools', 'workflowEngine', 'systemPrompt']`; `Config` (`toolName` 'workflow', `maxResultChars` 50 000, `enableRunInBackground` true); `DESCRIPTION` (the whole script-authoring contract); `presentWorkflowCall` / `presentWorkflowResult`; `startBackgroundRun`; `jobOutcomeOf`; `renderResult`; `stopReasonError`.
- **Data flow:** `execute` → foreground: `workflowEngine.start(...)` → `await run.result` → map the stop reason → `{ kind: 'foreground', runId, agentsStarted, result }` → `finally { await run.dispose() }`. Background: `jobs.start({ kind: 'workflow', …, run: (job) => { … } })` → the job's `done` chains from `run.result`.
- **Non-obvious design decisions:**
  - **The tool description IS the API contract**, and it is written as instructions: "`pipeline(items, ...stages)` — run each item through the stages independently with **NO barrier** between stages (prefer this for multi-stage work)." and "**Misused hooks (bad arguments, unknown options, unsupported schemas, tripped caps) end the whole script instead of producing `null`.** The script has no filesystem, network, timer, or Node.js APIs; the agents do the work."
  - **The tool is gated by a prompt section, not by the schema.** "Use the `workflow` tool ONLY when the user explicitly asks for a workflow or for large multi-agent orchestration… **For one or two delegations, prefer plain subagent calls.**" — an explicit *anti-feature* instruction.
  - **A background run is a JOB, and the job owns cancellation.** "No tool-step signal reaches the run — `job_kill`, the list's stop control, and owner teardown are what cancel it." The engine's `signal` is deliberately *not* passed.
  - **The job's ring carries the run's narration as `log` chunks** — "observer-only narration the model's `job_output` never renders". The model sees `(no new output)` and `[status: running, Scan]` until settlement.
  - **The rendered result rides the job's `result`**, delivered exactly once by the model's first `job_output` after settlement.
  - **The durable session record is four log-only events** (`tool-workflow/run-start` / `agent-start` / `agent-end` / `run-end`), written only for a *root* transport execution (`exec.parent === undefined`).
  - **A first record-append failure disables later recording for that run with one warning**, "leaving either no record or a legal continuous prefix without changing the tool result or cleanup."
  - **The card title is `workflow: <meta.name>` read straight from `args`** — "presentation is a pure function of args".
  - **The result is truncated at `maxResultChars`** with a visible notice: `… [truncated: N more characters]`.
- **Edge cases & failure handling:** A non-`completed` stop reason becomes an `isError` result — "Report the reason, not partial output." A missing `exec.agent` throws loudly ("Fail loud rather than guess"). A `run_in_background` call with no job registry throws with the missing composition named.
- **Surprising:** **The tool's `exec.signal` is NOT checked before the background branch** — a deliberate asymmetry with the shell tools, explained in the comment.

### `packages/workflow/tool-workflow/src/record.ts` + `src/types.ts`
- **Purpose:** The live-progress mirror into a background job's ring, and the four durable record event payloads.
- **Key abstractions:** `createWorkflowRecordMirror(ctx)` → `WorkflowRecordMirror` (`start(runId, job)`, `stop(runId)`); `ToolWorkflowRunStartData` / `AgentStartData` / `AgentEndData` / `RunEndData` and their `SessionEventMap` declaration.
- **Non-obvious design decisions:**
  - **`updateProgress(title)` carries the phase as the job's live progress line** — the job row shows the current phase without the model reading the ring.
  - **Every mirror line uses the `log` channel** — "`log` chunks are producer narration for observers and never reach the model." The model's `job_output` before settlement is `(no new output)`.
  - **The mirror subscribes ONCE per plugin** and routes by `runId` — "a straggling event after settlement finds no tracked run, and an append against a settled job drops inside the registry."
- **Edge cases & failure handling:** The registry's own "append to a settled job" warning-and-drop covers a late event.

### Tier 2 — bulk: the workflow test suite

| File | What it is / what it pins |
| --- | --- |
| `packages/workflow/workflow/tests/workflow.spec.ts` | The seam: `WorkflowRunId` brands a string; `WorkflowError` carries `code` + `fatal` (default true) and reads as a `HarnessError`; `isFatalWorkflowError` is true only for a fatal `WorkflowError`; the service registers as `ctx.workflowEngine` and unregisters on fiber dispose (HMR); `emitWorkflowEvent` dispatches to every listener; a throwing listener and a *rejecting* listener are both contained; containment is **per listener**; a listener whose thrown value cannot even be coerced is contained as `'[unrenderable thrown value]'`. |
| `packages/workflow/tool-workflow/tests/tool-workflow.spec.ts` | The tool: the start request carries script/args/parent/signal; the completed value renders as `workflow "audit" completed (7 agents).` + `Return value:` + JSON; the durable session record is exactly the four events in order; `run-end` is written only after disposal reaches quiescence; zero-member and concurrent runs record independently; nested transport executions record nothing; a first append failure is isolated and leaves a valid prefix; a non-`completed` stop reason becomes an `isError`; cancellation mid-flight bridges `exec.signal` → `run.cancel('parent step aborted')`; a synchronous engine throw becomes an `isError`; a missing `exec.agent` fails loud; an already-aborted signal never starts a run; `maxResultChars` truncation; a renamed `toolName` renames the prompt section too and both die with the fiber; presentation is a pure function of args; **the background suite**: an owned job is registered and its ring mirrors the progress as `log` chunks, the model's early `job_output` is `(no new output)` + `[status: running, Scan]`, the settlement carries the rendered value, a registry kill cancels the run and the reason lands in the detail, a failed run settles `failed` with the script's message, a nested transport call records job lifecycle but no workflow events, a synchronous engine rejection registers no job, a missing registry fails loud with the composition named, and a disabled composition hides the parameter AND rejects the call. |
| `packages/workflow/workflow-ptc/tests/workflow-ptc.spec.ts` | The engine (1 040 lines): args captured at start; an end-to-end script with `pipeline`, phases and logs; `agent({schema, model})` forwarding; a per-run provider override; invalid provider routes and caps rejected *before* a run is published; a fatal hook error killing the script; **provider start/result ordering** (a provider that settles before publishing, one that rejects before publication, one that publishes after cancellation); a child result *rejection* being a fatal `AGENT_RESULT`, not a failed child; a non-JSON child result; a throwing `dispose()` and an *unrenderable* dispose rejection still acking; `start()` throwing synchronously for meta/parse problems (including the pointed `export const meta` message); `cancel()` aborting in-flight children and settling after their cleanup; an already-aborted signal preventing script execution; post-cancel narration suppressed host-side; `cancel()` stopping a script parked on a promise no hook owns; stray (un-awaited) children reaped at settle; the settle-reap aborting a pending start *before* `workflow/end`; exactly one `agent-end` per observed start before `workflow/end`; a late provider publication releasing its file; a process exit closing every observed child lifecycle; an uncaught Node callback exception reported as a workflow error; a holder-owned run surviving an engine unload. |
| `packages/workflow/workflow-ptc/tests/guest.spec.ts` | The guest: the six-global script API; structured child options forwarded; the combinators inside the VM; no ambient Node globals; progress drained before settlement; a progress failure retained; a 200-line `log()` burst coalesced into 2 batches with peak concurrency 1; a rejected batch stopping further dispatch; child lifecycle events delivered before the child is disposed; initialization failure before any call; a non-parsing body rejected (including TypeScript syntax); the VM timeout ending an initial synchronous loop; a non-JSON return value; the shipped generated module loaded from a `data:` URL with **fresh VM state per run**; the `sourceURL` naming helper frames without leaking the data URL; a failed child → `null`; the default label derived from the prompt's first line; a provider start failure propagating; a dropped `agent()` promise contained; FIFO admission of queued child calls; and the whole invalid-script-call table plus the total-child and per-call item caps. |
| `packages/workflow/workflow-ptc/tests/host.spec.ts` | The host bridge: an unconfined provider runs under full access with no sandbox policy forwarded; a failed directory lookup settles as an error *without* running; the captured directory survives the parent moving (process **and** later children); the malformed-callback table; no duplicate `agent-end`; `timeoutMs: null` + the Session cwd; a runtime that cannot confine → `'cannot enforce the read-only file policy'`; child collection without parent delivery, with the settlement waiting for child cleanup; the invalid terminal-result table; cancellation preserved when the runtime rejects during cancellation; a non-TypeScript runtime rejected at load; a child published after cancellation disposed; a pending child output wait released by disposal. |
| `packages/workflow/workflow-ptc/tests/realm.spec.ts` | The materializer: realm objects copied to host plain data; `undefined` only at the root; getters invoked and their result crossing; a throwing getter surfacing as a `MaterializeError`; a `__proto__` key as an own data property (host prototype unpolluted); functions/symbols/bigints/non-finite numbers rejected with paths; exotic prototypes rejected but null-prototype data accepted; cycles rejected and a DAG accepted; sparse arrays and non-index array properties rejected; non-enumerable own properties skipped (matching `JSON.stringify`); plain host values accepted; and `renderThrown` preferring the stack, falling back to message → `String()`, and being total. |
| `packages/workflow/workflow-ptc/tests/integration.spec.ts` | The real in-process stack: a two-stage workflow (plain child then schema child) over a `MockAdapter`; the parent receives **no** `followup`/`steer`; the children appear in the parent's catalog as `mode: 'continuable'` and are disposed to quiescence; a child that fails against its schema (nudges exhausted) reaches the script as `null`; 200 ordered progress lines delivered in order. |
| `packages/workflow/workflow-ptc/tests/meta.spec.ts` | The meta validator: a minimal meta returns a **normalized copy** (no aliasing); the full shape rebuilds phases entry by entry; non-objects rejected; unknown fields rejected by name; missing/mistyped `name`/`description`/`whenToUse` rejected; malformed phases rejected entry by entry; and **every** violation named in one throw. |
| `packages/workflow/workflow-ptc/tests/egress.spec.ts` | The program environment: a script that reaches `process.env` through the `Function` constructor sees **`{}`** — no ambient credentials, no proxy settings, no host loader paths — even with `HTTP_PROXY`/`HTTPS_PROXY`/`WORKFLOW_ENV_CANARY`/`TSX_TSCONFIG_PATH` stubbed. |
| `packages/workflow/workflow-ptc/tests/source-runtime.compat.spec.ts` | The Node compatibility matrix: the default workflow config runs through the source PTC runtime; workspace writes are enforced in **both** `per-call` and `persistent-in-memory` execution modes (an outside file is unchanged, an inside file is written only under `workspace-write`). |
| `packages/workflow/workflow-ptc/tests/setup.ts` | The fixture: real Node execution services with a private temp working directory and awaited cleanup; `mountWorkflowRuntime` for a caller-owned context; `fakeParent` with a real Session and an immutable cwd. |
| `packages/workflow/workflow-ptc/tests/built-runtime.e2e.ts` | A `describe.skipIf(!built)` end-to-end against the **published** build: a plain Node driver loads the built package, runs a structured child through a selected provider, and a direct `node:fs` write outside the workspace is blocked (`read-only` policy). |
| `packages/workflow/workflow-ptc/tests/workflow-ptc.e2e.ts` | A `describe.skipIf(!process.env.DEEPSEEK_API_KEY)` end-to-end with two **real** children over the PTC runtime — one prose, one through the structured-output tool — asserting the event order (`workflow/start` … `workflow/end`), the child count, and that every child is disposed to quiescence. |

### Tier 2 — bulk: the workflow group READMEs

| File | What it is / what it decides |
| --- | --- |
| `packages/workflow/README.md` | The group map: `workflow` (`ctx.workflowEngine`), `workflow-ptc` (registers on `ctx.workflowEngine`), `tool-workflow` (registers on `ctx.tools`). |
| `packages/workflow/README.zh.md` | Chinese translation of the group map. |
| `packages/workflow/workflow/README.md` | The seam's contract: the script hooks, the programmatic run API, the failure discipline ("hook misuse … kills the script loudly rather than dissolving into a per-item `null`"), and the *Known Limitations* ("Foreground collection only", "No journaling or resume", "No saved or nested workflows", "No token-budget vocabulary", "Runs are holder-owned, not service-tracked"). |
| `packages/workflow/workflow/README.zh.md` | Chinese translation of the workflow seam README. |
| `packages/workflow/tool-workflow/README.md` | The tool's contract: the four parameters, the foreground envelope, the background job semantics, the config table, the durable-record rules ("The first failed Session append disables later recording for that run with one warning"), and the *Model Experience* section pricing the tool's schema and result tokens. |
| `packages/workflow/tool-workflow/README.zh.md` | Chinese translation of the tool-workflow README. |
| `packages/workflow/workflow-ptc/README.md` | The engine's contract: the config table (`maxConcurrentAgents 0` = "resolves from available CPU parallelism"), the file-policy rules ("A runtime without confinement is accepted only for `danger-full-access`"), the `timeoutMs: null` decision, and the limits ("Workflow caps are cooperative", "The VM is not a security boundary", "Cross-realm errors fail `instanceof Error` inside scripts"). |
| `packages/workflow/workflow-ptc/README.zh.md` | Chinese translation of the workflow-ptc README. |

---

## 2. Ideas worth stealing

1. **The three-package split: contract / implementation / model-tool, repeated three times.** `jobs` (abstract `JobRegistry` service) → `jobs-local` (the in-memory implementation) → `tool-jobs` (the model's `job_output`/`job_list`/`job_kill`). `schedule` (the Host `ctx.schedule` service) → `tool-schedule` (the model's four tools). `workflow` (the abstract `WorkflowEngine`) → `workflow-ptc` (the PTC implementation) → `tool-workflow` (the model's `workflow` tool). The *seam* package holds only types and an abstract Cordis service; the *implementation* package holds the behaviour; the *tool* package holds the schema and the prompt. August Trading has one module per feature area; a seam/implementation split would let it swap a storage engine (SQLite vs. in-memory) without touching the UI.
2. **A load-time misconfiguration fence.** The abstract service throws in its own constructor (`if (new.target === JobRegistry) throw …`) because `abstract` erases at runtime — a composition row naming the contract package would otherwise register an empty `ctx.jobs` and fail far from the mistake. One runtime check buys a load-time error.
3. **One closure per concern, written down as prose.** Every file in this shard opens with a JSDoc block that states the *decision*, not the API. The `jobs-local` README and `packages/schedule/AGENTS.md` are rules, not reference. August Trading's `AGENTS.md` already does this; the reference repo goes further and puts the rules *next to the code* and inside each class's constructor doc.
4. **Observation never consumes the model's read.** `JobRegistry.read` advances a model cursor; `readAt` is non-consuming for observers. "Observation is invisible to the model." A monitoring UI can watch a job's output without stealing bytes the model has not read yet.
5. **A single consuming read plus a "delivered exactly once" result.** The producer's `result` is handed out on the first post-settlement model read and never again. The August analogue — a trade-analysis result that must be read exactly once — is a pattern worth copying verbatim.
6. **The `awaited` flag on a settlement event.** A settlement reports whether it released a *live* waiter. A completion plugin that already collected the result suppresses the notification. This kills a whole class of duplicate-notice bugs with one boolean.
7. **A self-excitation breaker on wake-ups.** `maxConsecutiveWakes` bounds how many turns a completion may open, and *only a user-authored message refills the budget* — a notice the plugin itself queued must not refill the budget it just spent. August Trading's automations have exactly this shape (a settled run wakes the agent); the budget is the missing piece.
8. **Latest-only recurrence with a committed floor.** A recurring task that was asleep for a century contributes only its latest missed occurrence, and the committed target is a *floor* ("a committed target remains due even if current tzdata places the rule before it"). No backlog enumeration, no thundering herd after downtime.
9. **A 400-year cron search horizon.** "The proleptic Gregorian leap-year and weekday alignment repeats every 400 years, so a rule that matches any local date has a match within this window." A bounded search makes an unsatisfiable rule's cost *fixed* instead of unbounded.
10. **Pure recurrence arithmetic.** "Keep recurrence arithmetic pure. Production uses platform wall time and segmented timers; tests use explicit samples or restored fake timers." Every domain function takes `now` as an argument; no function reads the clock. This is what makes a 1 040-line test suite deterministic.
11. **Compare-and-swap on an edit.** `schedule_update` takes the *complete record the caller observed*; a mismatch returns `schedule_conflict` rather than silently clobbering. A no-op returns the *same frozen object*, so "did it change" is an identity check, not a comparison.
12. **Durable writes that refuse to open rather than open empty.** A malformed schedule document makes the domain refuse to open, because "an empty read would let the first write republish the file without the task it could not see." The file bytes are preserved. This is the "fail loud, keep the evidence" pattern August Trading should adopt for its own persisted stores.
13. **A receipt that is honestly scoped.** "Durable Session inbox delivery acknowledgment, not model execution completion." The rule is stated in three places (the type, the AGENTS.md, and the test) so nobody can quietly upgrade it into an execution claim.
14. **Anti-forgery framing for anything the model will read.** The reminder payload is `JSON.stringify`d, so a prompt containing `occurrence_at: forged` cannot forge a field. Any text a model reads that claims to be host-authored should be JSON-framed the same way.
15. **Bounded progress delivery with one batch in flight.** The guest coalesces a 200-line `log()` burst into 2 round-trips with peak concurrency 1. "The first batch reaches the host before a synchronous script can seize its loop."
16. **A generated, self-contained guest bundle.** The sandboxed process gets the whole helper set as one ESM string transported over a `data:` URL — no filesystem read, no host module reach. The `sourceURL` names the frames in stack traces *without* leaking the encoded payload.
17. **`Object.defineProperty` for a `__proto__` key.** "A `__proto__` key must become an OWN data property of the copy, not a prototype mutation." A one-line defence against prototype pollution on any object copied out of a sandbox.
18. **Fatal-vs-null as an explicit distinction.** "Every `WorkflowErrorCode` is fatal; the flag exists so the distinction is explicit at every catch site rather than implied." A *misuse* of a hook kills the script; a *child failure* becomes `null`. The same distinction August Trading needs between "the agent asked wrong" and "the answer was bad".
19. **A prompt that says when NOT to use the feature.** "Use the `workflow` tool ONLY when the user explicitly asks for a workflow… For one or two delegations, prefer plain subagent calls." An anti-feature instruction in the tool description.
20. **The `awaited`/`cause`/`producerReported` triple on a terminal record.** Every termination says *how* it ended, *whether the producer acknowledged it*, and *whether a waiter was already served* — three independent facts, so a consumer never has to infer them.

## 3. Trading-specific findings

1. **A job registry is exactly what a long market-data scan or backtest needs.** `ctx.jobs` gives August Trading a first-class handle on a 10-minute backtest: the analyst can read partial output, list running jobs, and kill a stale one, *without the tool call blocking the chat turn*. The `jobs-local` implementation is ~800 lines of TypeScript and needs no database.
2. **Two cursors on one stream = a live chart and a transcript that do not fight.** August Trading's backtest output could be read by the UI (non-consuming) while the model reads it once (consuming) — the exact `read`/`readAt` split. Today, a long scan either blocks the turn or spams the transcript.
3. **A completion notice is a better delivery channel than polling.** "You are notified in-session when a job finishes — do not busy-poll or sleep on one." A 20-minute backtest that finishes while the trader is typing can inject a one-line notice into the *next* step instead of blocking the turn. The notice is one sentence: `background job <id> (<kind>: <label>) finished [status: completed]. Read its output with job_output.`
4. **A self-excitation breaker is a hard requirement for trading automations.** A "scan → find a setup → scan again" loop can wake the agent forever with no user present. `maxConsecutiveWakes` bounds it, and only a *user* message refills the budget. August Trading's `services/automation` should copy this exactly.
5. **Latest-only recurrence fits a market scanner.** A daily "scan the watchlist" reminder that was off for three days must fire **once**, not three times. The rule ("Recurring tasks contribute only their latest missed occurrence and advance to a future target") is a direct fit for a daily/weekly market scan, and "due recurring tasks in one Session share a message" means the trader gets one digest, not five.
6. **Daily wall-clock, never a 86 400-second interval.** A "09:30 every trading day" reminder must keep the *local time and zone*, so a DST shift does not move the 09:30 bar scan to 10:30 — and a market holiday / missing local date is *skipped*, not fired late. August Trading's `services/automation` (cron + run history) should not be using fixed intervals for anything a trader thinks of as "every morning".
7. **A "settlement" is not an "execution".** The reminder receipt acknowledges that the *inbox* took the message, not that the model did anything with it. The same honesty is needed for a trade-plan validation: "the plan was recorded" ≠ "the plan was good". The reference names the distinction in three separate places so nobody slides.
8. **Bounded history with an explicit "missing" flag.** A delivery history that prunes must say so (`earlierRecordsUnavailable` vs `earlierRecordsPruned`) — "missing receipts are never reconstructed". A trade journal that truncates its history must distinguish "never existed" from "pruned", or the AI's training signal is silently corrupted.
9. **Trading-relevant failure containment.** A price fetch that throws inside a poll source is contained once and the job "runs to its own settlement with whatever the ring holds instead of freezing on a pump failure." A live quote that drops should degrade the scan, not kill it.

## 4. Non-obvious decisions and gotchas

- **`tsdown.config.ts` is typed as `source` in the shard list, not `config`.** Two tiny files (`packages/schedule/schedule/tsdown.config.ts`, `packages/workflow/workflow-ptc/tsdown.config.ts`). They are build configuration, but the file list classifies them as source, so they must be read.
- **The `packages/**/README.i18n.yaml` files are generated bilingual-pairing hash records.** Eleven of them, one per README. They are *not* documentation: each holds a per-heading-section hash of the English and Chinese blocks plus the command that re-records them (`pnpm run verify-translation-pairing --write <file>`). Reading them line by line buys nothing; the head confirms what they are.
- **Every `README.zh.md` is a *translation with a verified hash pair*, not a copy.** The pair-check tooling means the two languages are kept structurally in step, so a divergence is a CI failure, not a reviewer's problem.
- **`JobView.kind` is deliberately typed `string`, not a union.** The `JobKindMap` is merge-extensible, but a browser bundle that compiles fewer declaration merges would reject `pwsh`/`pty-send`. The test pins it as a compile-time probe: `expect(string extends JobView['kind']).toBe(true)`.
- **`JobId('anything')` never validates.** The brand is a compile-time marker; the registry generates `<kind>-<16 hex>` and retries on a UUID collision.
- **The output ring's offsets are absolute and never move.** A reader below the window gets `lossy: true`, never an error. A lone oversized chunk is kept as a UTF-8-safe *tail* with its `at` advanced — the retained text never starts inside a code point.
- **Cross-source reordering is accepted, not fixed.** "Bytes two sources produced inside one poll window land in that order, not in the order they were written: the ring is a best-effort live view." The doc says so rather than pretending to be exact.
- **`JobHooks.done` resolves after the producer *releases* its resources.** Settlement is a release boundary, not a completion boundary.
- **A teardown cancel that throws force-fails the record with the text `'… work may be orphaned'`.** The record says honestly that the work may still be running, instead of pretending it stopped. A duplicate `[some output was dropped from memory; full output: …]` notice is not emitted twice.
- **`schedule_update` refuses `after_seconds`.** "To change a relative delay, create a new reminder." A relative delay has no committed rule to re-anchor.
- **A create that waits behind a longer operation keeps its *request-time* anchor** and may already be due when the queue reaches it; an *update* uses the *queue-time* clock. Two different clocks for two different operations, each documented.
- **A `schedule_create` for a delegated child's Session is refused because the *delivery path* cannot work** ("the live Agent of a delegated child; a stored task for such a Session would stay permanently overdue and retry on every drive") — a refusal justified by the mechanism, not by policy taste. `delete` stays allowed so legacy rows remain removable.
- **The workflow `timeoutMs` is `null`** — there is no overall elapsed deadline, only the initial synchronous slice. The *caller's* deadline still applies.
- **`maxConcurrentAgents: 0` resolves from the machine** (`min(16, max(1, availableParallelism() - 2))`), which is why the test suite overrides it to 8 — "the auto-resolved default is machine-derived … so tests that expect N children in flight would wedge on small CI runners."
- **The workflow tool's background path deliberately does NOT pass `exec.signal` to the run.** "No tool-step signal reaches the run — `job_kill`, the list's stop control, and owner teardown are what cancel it."
- **The `workflow` tool's foreground and background paths use *different* failure envelopes** (`{ kind: 'foreground', runId, agentsStarted, result }` vs `{ kind: 'background', jobId }`). The parent turn blocks in one case and returns a job handle in the other.
- **The PTC guest's `sourceURL` is `dsh-workflow-guest.js`** — stack frames name the generated helper without exposing the encoded `data:` URL.
- **`renderThrown` is total.** Stack → message → `String()` → `'[unrenderable thrown value]'`. The same guard appears in the workflow seam's listener containment, where a listener whose thrown value cannot even be coerced is contained, not crashed.
- **`packages/schedule/AGENTS.md` is the single most valuable document in this shard** for anyone copying the design: it states the *negative* rules ("Do not describe enqueue as model completion or add an execution-record state machine", "Do not add a generic retry loop", "do not scan or migrate all historical Sessions implicitly").

## 5. Weak spots

- **The schedule package is enormous for what it does.** `domain.ts` is 1 896 lines, `index.ts` ~600, and the test suite is ~19 files / ~270 KB — a hand-written cron engine, a hand-written Temporal layer, and a hand-written JSON-Schema subset. A trading app should take the *rules* (pure arithmetic, latest-only, committed floor, explicit zone) and use a library, not reimplement Vixie cron.
- **The delivery path is explicitly not atomic.** "These writes are not atomic: a crash between them may duplicate delivery." The tool description even warns the model: "Delivery can repeat after a crash." A trader told "your 09:30 scan fired" twice will not trust it the second time.
- **A failed delivery has no retry.** "Failed delivery leaves the task stored and reports the failure. Do not add a generic retry loop." Defensible as a scope decision, but for a *trading* reminder it means a transient network error silently loses the alert.
- **The whole-unit storage document is a scaling wall.** "The JSON backend stores the Schedule domain in one `schedule.json` document, so every task change rewrites all retained tasks and their history, and the Host loads all retained history into memory." Fine for a handful of tasks; not for a per-symbol alert grid.
- **`wakeup` delivery is unbounded by default.** "a notice reaching an idle owner also buys a model request the user did not ask for." The cost of the completion-notice design is real and defaults to the expensive side.
- **The `dsh-schedule` service cannot be mounted alone.** "Schedule cannot be mounted alone in a headless or SDK-only composition: delivery requires the Host Web Session controller and a Session persistence backend." The seam is not a library.
- **`JobRegistry` is a one-implementation-per-process service.** A second implementation throws (`service "jobs" has been registered`), and the process-local store is memory-only — "records are in-memory, so a durable or cross-process backend must implement the same contract differently." There is no persistent job backend shipped.
- **The workflow engine's caps are cooperative, not enforced.** "Workflow caps are cooperative … they are not host-enforced security quotas or descendant token budgets." A model-authored script can exceed its intent.
- **The VM is explicitly not a security boundary.** "OS policy constrains the code that reaches Node." Anyone reusing this pattern for untrusted scripts needs a real sandbox.
- **Cross-realm `instanceof` fails inside scripts.** "Branch on stable fields such as `name` and `code` instead." A sharp edge for anyone porting the pattern.
- **The workflow tool's result is truncated, not stored.** "a JSON over `maxResultChars` is truncated in the model-facing projection rather than stored behind a retrieval handle" — the open direction in the package's own dev note.

## 6. Status ledger

**139 files: 128 read, 11 skipped.** The full ledger is in the companion
`dsh-workflow-jobs-schedule.status.tsv` (TAB-separated: `path`, `status`, `note`).

The 11 skips are all the same kind of file: `packages/*/README.i18n.yaml` (and
`packages/*/*/README.i18n.yaml`) — **generated bilingual-pairing hash manifests**,
one per README, each holding a per-heading-section hash of the English and Chinese
blocks plus the command that re-records them. The head of every one was read and
the size confirmed on disk; none was read line by line because the file contains
no prose, only hashes and a tool invocation.

