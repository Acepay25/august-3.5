# deepseek-harness :: dsh-core

**Files in shard:** 175 (read: 166, skipped with reason: 9)

> All 166 non-generated files were opened. Nine files were skipped with a
> recorded reason: the nine `README.i18n.yaml` files, which are *generated*
> bilingual-pairing hash records (their heads were read and their role
> confirmed). The per-file ledger is complete: every file appears exactly once
> below — as a Tier-1 entry, as a Tier-2 table row, or as a Tier-3 skip line.

**What this shard covers:** the `packages/core` group of the DeepSeek Harness
monorepo — the "product API spine". Eight packages: `scope` (scoped registration
and event routing), `session` (the append-only session event log), `system-prompt`
(prompt assembly), `tools` (the tool registry and guarded execution pipeline),
`agent-tool-presentation` (per-agent tool rendering policy), `agent` (the public
`Agent` handle plugins program against), `agent-default-model` (deployment
default model selection), and `agent-loop` (the default turn/step driver). This
is the layer that decides *what a turn is, who owns it, what goes into the
prompt, what a tool call is, and what survives to the next turn*.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `packages/core/agent-loop/src/agent.ts` — the turn/step driver
- **Purpose:** `ReactLoopAgent` — the concrete `Agent` implementation. Owns one session for its lifetime and drives the turn → step → model → tools → step loop. **Every request is derived from the session log**, never assembled from in-memory chat state.
- **Key abstractions:** `Phase` (`idle` | `maintenance` | `running`) — the single state machine (`src/agent.ts:42`); `PreparedStep` (`reject` | `enter`) — the outcome of a pre-step admission (`src/agent.ts:54`); `ReactLoopAgent` (`src/agent.ts:98`).
- **Data flow:** `send()` → inbox splice → `wakeDriver()` → `kick()` → `turn()` → `preStep()` → `step()` → `prepareRequest()` → `buildRequest()` → `AssistantStreamAttempt` → durable `assistant/message` → `executeToolCalls()` → durable `tool/call`/`tool/result` pairs → next step. The prompt is *rendered* from the system-prompt assembly, then *committed into the session* as `system/message` before the request is built, so the request is a pure fold over the log.
- **Non-obvious design decisions:**
  1. **The prompt is a session event, not a parameter.** `step()` calls `this.systemPrompt.project(renderedPrompt, …)` and appends the resulting `system/message` nodes *before* `buildRequest` derives `session.deriveMessages()`. The request therefore carries **no `system` field** — the prompt reaches the provider as ordinary derived history.
  2. **`max-tokens` is sticky for the whole turn** (`src/agent.ts:262-267`): once any step hits the output ceiling, a later step that completes normally must not downgrade the turn's ending.
  3. **Waking input cannot join an aborted activity, so it starts the next turn** (`src/agent.ts:154-161`). The classification is captured *before* the inbox insertion, because a reentrant `cancel()` from a splice observer would otherwise reclassify it.
  4. **A wake sent while idle always opens its turn boundary even if its message was cleared**; only a *latched* replay is suppressed when the queue no longer holds the wake (`src/agent.ts:186-206`).
  5. **Adapter-default fields are stripped before plugins propose the next config** (`requestProposal`, `src/agent.ts:64-71`): `reasoningEffort`/`maxTokens` that the adapter defaulted are deleted from the proposal so the route re-resolves them; explicit settings persist.
  6. **A persisted reasoning effort is restored only for the exact provider+model that set it** (`src/agent.ts:490-497`) — a model swap drops the effort rather than carrying it across routes.
  7. **The request is deep-frozen per message identity, and the identity is remembered in a `WeakSet`** (`src/agent.ts:118`, `src/agent.ts:530-537`). A message is frozen on its *first* request only; a replaced history node is a different object and gets frozen again. A failed freeze traversal is retried on the next request (the `WeakSet` was not yet updated) — see `tests/request-freeze.spec.ts`.
  8. **The `AbortSignal` is the one mutable part of a frozen request** (`src/agent.ts:539-547`): the request object is frozen but `signal` is passed through live so cancellation still works.
  9. **`abortedCancelCause` copies only four fields of the abort reason** (`src/agent.ts:80-95`) because Node's `fetch` assigns a `stack` onto the reason object, and `Session.append` would then either log it or reject it as data JSON cannot hold.
  10. **Failure results for unanswered tool calls are written before the step closes** (`src/agent.ts:270-283`): a recorded `tool/call` with no committed result gets `TOOL_OUTCOME_UNKNOWN`, a request with no call record gets `TOOL_NOT_STARTED`. A failure *while* recording those results becomes an `AggregateError` carrying both.
  11. **A cancelled stream still commits what the user saw**: `live.interruptedBlocks()` is appended as an `assistant/message` with `interrupted: true` (`src/agent.ts:400-417`), so the next request contains the delivered prefix. If nothing was delivered, an `assistant/attempt` event is committed instead.
  12. **Only adapter failures are recoverable.** A provider/adapter failure enters the `agent/request-error` waterfall where a listener may answer `{ kind: 'retry' }`; middleware/result-processing/plugin failures are thrown and close the turn directly ("plugin failure ends the turn, not the loop").
- **Edge cases & failure handling:** empty first batch → the turn opens but spends no model call (`{ kind: 'completed' }`); rejected pre-step → `{ kind: 'blocked' }`; `NO_ADAPTER` from `prepareCall` is tolerated (middleware may serve an unregistered route) but dispatch then fails; a `request-error` listener that itself throws is *not* a retry; cancellation wins over a pending retry action; every exit path appends `turn/end` in a `finally`, and a failure there is itself reported through `throwError`.
- **Surprising:** `runMaintenance()` is the mechanism the *factory* uses to run setup and publication — the agent is briefly "maintenance" rather than "idle" while a plugin's `setup` hook runs, and a wake arriving during maintenance is latched for replay at convergence.

### `packages/core/agent-loop/src/inbox.ts` — the durable pending-input queue
- **Purpose:** `ReactLoopInbox` — pending agent input, stored **in the session log**, not in memory. Two lists: `next-turn` (a queued prompt) and `next-step` (steering / injected context).
- **Key abstractions:** `inboxProjectionSchema` (zod), `inboxProjectionDefinition` (a `ProjectionDefinition<'inbox', InboxState>` — a standard fold over `agent/inbox/spliced`), `ReactLoopInbox` (`src/inbox.ts:74`).
- **Data flow:** every mutation is normalized to a *splice* (`target`, `start`, `removedCount`, `inserted`, optional `outcome`) and appended as one `agent/inbox/spliced` event. The registry folds it **synchronously**, so the live projection reflects the splice by the time `Session.append()` returns — a session observer reading `sessionProjections.stateOf(...)` already sees the new state (`tests/inbox.spec.ts`).
- **Non-obvious design decisions:**
  1. **The projection is the source of truth, not a cache.** `ReactLoopInbox` reads `projections.stateOf(session, 'inbox')` for *every* operation, so a resumed session rebuilds its pending queue from the log.
  2. **The wire value is the fold state itself** (`src/inbox.ts:60-63`) — every pending message already round-trips the log as lossless JSON, so there is no second serialization format.
  3. **Splice coordinates are normalized, not rejected** (`src/inbox.ts:196-208`): `NaN` → 0, negative → counted from the end, over-long delete counts clamp to the list length. The *durable* fold, however, is strict: an out-of-range or duplicate-identity splice in persisted history throws `invalid persisted inbox splice at session seq N` (`src/inbox.ts:31-72`). A live mutation is forgiving; a replayed one is not.
  4. **Message identity is unique across both lists** — inserting the same `MessageId` into `next-step` while it sits in `next-turn` throws.
  5. **Removed messages carry `outcome: 'canceled'` and emit `agent/inbox/discarded`**; a *claim* is a pure deletion with no outcome and emits `agent/inbox/claimed`. Consumers that need a removed message must listen for claimed/discarded, not diff a pre-splice view.
  6. **`clear()` clears `next-step` before `next-turn`** (`src/inbox.ts:98-102`) — a deliberate ordering so the discarded notifications are emitted in that order.
- **Edge cases & failure handling:** the projection registration not being active throws `cannot read inbox state: its projection registration is not active`; a `MessageId` that cannot be JSON-serialized is rejected *before* enqueue (the test proves zero events were appended); `replace()`/`remove()` return `false` for an unknown identity.
- **Surprising:** `inbox.clear()` appends **two** events even when both lists are empty-ish, and the second `clear()` still appends two more — a no-op clear is not free in the log.

### `packages/core/agent-loop/src/runtime-context.ts` — how the prompt and the runtime facts reach the surface
- **Purpose:** Two projections that decide *where* the rendered system prompt and the dynamic runtime-context snapshot live in the session's surface.
- **Key abstractions:** `SystemPromptCommit` (a message + a `SurfaceIntent`), `SystemPromptDecisionInput` (`inHistory`, `startsSeries`), `SystemPromptProjection` (`src/runtime-context.ts:65`), `RuntimeContextProjection` (`src/runtime-context.ts:127`).
- **Data flow:** the system-prompt plugin renders a text; `SystemPromptProjection.project(rendered, input)` returns the ordered per-node updates; the loop appends them as `system/message` events with the right `surfaceOp`; the next request derives them. The runtime-context snapshot works the same way but as a `user/message` with `source.kind === 'runtime-context'`.
- **Non-obvious design decisions:**
  1. **The first prompt — even an empty one — reserves surface node 0** (`src/runtime-context.ts:90-92`). "No system node" and "an empty prompt" are different states, and the empty node still consumes position 0.
  2. **On an incapable route, a new series, or an empty rendering, the head is normalized and every later non-empty node is emptied** (`src/runtime-context.ts:93-99`). "No older instructions remain model-visible" — the harness never leaves a stale prompt in history.
  3. **A capable continuing series APPENDS the changed prompt instead of replacing it** (`src/runtime-context.ts:100-103`), because appending preserves the cached prefix; replacing node 0 in full would miss the provider's prefix cache from that token.
  4. **Consolidation happens even when the effective text is unchanged** — because the *history* of prompt nodes is what must be normalized, not the text.
  5. **Dormant empty tails are ignored**: they neither supply effective text nor require a replacement.
  6. **The runtime-context snapshot is only re-written when the text differs** (`src/runtime-context.ts:147-149`); when it disappears entirely, a fixed marker `Current runtime context: none. Earlier runtime-context snapshots no longer apply.` is written so the model does not keep acting on a stale snapshot.
  7. **The cleared marker carries no `sections` attribution** (`src/runtime-context.ts:151-155`) — there are no contributions left to attribute.
- **Edge cases & failure handling:** a replaced (compacted) runtime-context node is detected via `isReplacementSurfaceEvent` + `sourceEventSeqs` and the retained snapshot is dropped to `null`; a restored session rebuilds the retained snapshot by scanning events newest-first and stopping at the first visible one.

### `packages/core/agent-loop/src/tool-calls.ts` — the bounded parallel tool scheduler
- **Purpose:** Runs one assistant step's tool calls, honouring each tool's *live* concurrency mode: parallel-safe calls overlap, exclusive calls are ordering barriers.
- **Key abstractions:** `PlannedCall`, `Slot`, `GroupOutcome`, `executeToolCalls()` (`src/tool-calls.ts:60`).
- **Data flow:** assistant `tool-call` blocks → `parseArguments` (invalid JSON is preserved **as text**, empty input becomes `{}`) → a group is formed from `ctx.tools.executionMode(first.exec).kind` → `runGroup` starts up to `maxParallelToolCalls` → results commit **in model order** via `commitReady()` → each result is appended as `tool/result` with `sourceEventSeqs: [callSeq]` linking it to its `tool/call`.
- **Non-obvious design decisions:**
  1. **Dispatch may overlap; results, policy and result-context stay model-ordered.** `commitReady()` only advances across *contiguous* model-order slots (`src/tool-calls.ts:146-160`), so a fast second call cannot overtake a slow first one in the log.
  2. **Calls are reclassified immediately before they start** (`src/tool-calls.ts:190-198`): a registry change during the step can turn a later parallel call into an exclusive barrier. The comment says so explicitly — "Commit before classifying again so registry changes affect unstarted calls."
  3. **The pool is a *rolling* pool**, not a batch: each settled slot refills the pool (`src/tool-calls.ts:200-216`).
  4. **Cancellation writes synthetic results for calls that never started**: `ABORTED_BEFORE_DISPATCH` with the text `Error: tool call aborted before dispatch` (`src/tool-calls.ts:250-261`). Replaying the turn then sees a *paired* call/result, which the provider protocol requires.
  5. **An internal scheduler failure drains started dispatches before rejecting** (`src/tool-calls.ts:218-226`) — the owning step then writes the conservative recovery results.
  6. **`result.additionalContexts` are fed back into the next step's inbox** through the caller-supplied `acceptContext` callback (`src/tool-calls.ts:157-158`) — the tool can inject context without owning a turn.
  7. **A tool's private presentation payload is persisted** (`result.meta`, `src/tool-calls.ts:283-285`) "so a UI bridge reproduces the card on replay" — the tool's card is part of the durable record, not a re-derivation.
- **Edge cases & failure handling:** `concludesTurn` on any committed result ends the turn even if other calls are still pending; a scheduler failure is remembered (`schedulerFailure ??= { error }`) so the *first* failure wins.

### `packages/core/agent-loop/src/index.ts` — the plugin, the factory, and the ownership rules
- **Purpose:** `AgentLoop` — the cordis `Service` that implements the public `AgentFactory`, owns agent creation/resume/teardown, and registers the loop's two session projections.
- **Key abstractions:** `turnBoundaryProjectionDefinition` (a host projection of turn/step boundaries, `stateVersion: 2`), `FactoryOwnership` (factory-level teardown ownership), `PreparedAgent` (prepared-but-unpublished resources with one memoized reverse teardown), `AgentLoop` (`src/index.ts:341`), `CONFIGURED_AGENT_IDENTITIES_KEY`.
- **Data flow:** declarative config → one `create()`/`resume()` per entry → `prepare()` (construct driver + scope + write handle) → `initializeAgent()` → `runMaintenance()` → `setup` hook → `appendUnstoredSuffix()` → `publish()` (enter both registries, announce `session/created`, await serial `agent/created` listeners, release queued input).
- **Non-obvious design decisions:**
  1. **Creation is one rollback-covered transaction.** Any failure in setup, commit, or a listener rolls the prepared resources back; announcements already delivered stay observable and receive matching disposal notifications.
  2. **The teardown is memoized** (`disposing ??= (async () => {…})()`) so every racing owner — the caller, the owner fiber, the factory — awaits **one** quiescence boundary, and all of them observe the same rejection.
  3. **Disposal IS a disposed-cause cancel followed by quiescence** — the machine is cancelled with `{ kind: 'disposed' }` and then `whenIdle()` is awaited.
  4. **Teardown failures are collected, never swallowed**: registry/scope/ownership cleanup always runs to quiescence, then the memoized disposal rejects with an `AggregateError`.
  5. **Three abort sources are fused before any resource exists** (`src/index.ts:663-680`): the caller's cancellation signal, the owner fiber's unload, and factory teardown. The abort is registered over *mutable slots* so an unload arriving while the scope is still minting finds a working disposer instead of a leak.
  6. **The scope is adopted on its original fiber** ("so it cannot unload before teardown") — a loop already unloading during minting owns the provisional scope itself.
  7. **Resume takes write ownership FIRST** (`persistence.open(id, 'write')`) to exclude a concurrent resume of the same id in this process.
  8. **Semantic crash repair is the agent layer's job, not the storage layer's.** Persistence hands back the *physically valid* log; the loop then appends `interruptedTurnClosers(persisted)` (missing tool errors, `step/end`, `turn/end`) as an ordinary batch through the same handle.
  9. **The constructor seed never re-emits through `session/event`.** `appendUnstoredSuffix` stores it at the publication commit point so a failed/cancelled setup closes an unmaterialized handle and leaves **no stored residue** — the same id can be created again.
  10. **`storedCount` advances by what was stored, not by `session.seq`** ("an event appended during the await must stay unstored for the next flush").
  11. **Config validation happens before any registration** ("a rejected constructor leaves no projection unit behind"), and `sessionId`/`resumeSessionId` are mutually exclusive and must be unique across entries.
  12. **Launcher-owned identities** (`applyLauncherIdentities`) let a launcher pin the exact session identity of a configured agent *without* a config key, "so an overlay repointing the row's model route cannot drop them". The launcher replaces *both* identity keys, so a config-supplied identity can never survive alongside a launcher-supplied one.
  13. **A declared startup failure is a typed event** (`agent-loop/config-start-failed`), not a throw: "Consumers that buffer work for the configured identity use this transient signal to reject that work instead of waiting forever." Normal factory teardown suppresses the failure of the cancelled startup attempt.
  14. **`maxParallelToolCalls` is a `Volatile` config field sampled for the next tool group**; `agents` remains startup configuration.
- **Edge cases & failure handling:** `assertAgentOptions` rejects a non-positive or non-integer `maxTokens` *before* any resource is created; `raceAbortCall` closes a write handle that finishes creating after abandonment; `restoreOrCreateConfigured` falls back to first creation **only** on `SessionPersistenceNotFoundError` — corruption, ownership conflicts and backend failures stay loud; `waitForDrainingConfiguredIdentity` waits for a draining same-id occupant instead of colliding with it.
- **Surprising:** the "turn boundary" projection is registered by the *loop*, not by the session package, and it is a *host* projection — it exists so a UI can ask "is a turn open right now?" without replaying the log.

### `packages/core/agent-loop/src/assistant-stream.ts` — attempt framing
- **Purpose:** `AssistantStreamAttempt` — folds one model attempt into a compact durable stream plus ordered process-local frames.
- **Key abstractions:** `AssistantStreamAttempt` (`src/assistant-stream.ts:18`), with `start()`, `push(chunk)`, `settle(eventType, append)`, `abandon()`.
- **Data flow:** `StreamChunk` → `AssistantStreamAccumulator` (compaction) + `BlockAssembler` (content blocks) → a `chunk` frame per chunk; the terminal frame is emitted **only after the matching durable event commits** (`settle` calls `append()` synchronously and only then emits `end`).
- **Non-obvious design decisions:** (1) **`settle` publishes the terminal frame after the durable commit** — if the append throws, `abandon()` is called and the error is rethrown, so the UI never sees a `committed` outcome for an event that is not in the log. (2) The attempt id is `${sessionId}:${attempt}` and is "embedded only in the Agent-lifecycle-local attempt id". (3) `interruptedBlocks()` (vs `blocks()`) is the *safe visible prefix* used when cancellation interrupts the attempt.
- **Edge cases & failure handling:** the terminal frame is emitted exactly once — `abandon()` after a failed settlement, `settle()` otherwise.

### `packages/core/agent-loop/src/constants.ts`
- **Purpose:** one exported constant — `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10` (`src/constants.ts:6`).
- **Key abstractions:** none.
- **Data flow:** imported by `src/index.ts` as the schemastery default for `maxParallelToolCalls`.
- **Non-obvious design decisions:** the default lives in `constants.ts` so the schema and the docs cannot drift.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the file is 4 lines; the repo keeps shared constants in a dedicated module rather than inline.

### `packages/core/agent-default-model/src/index.ts` — the deployment's default model
- **Purpose:** Owns the deployment-wide default `{provider, model, reasoningEffort}` that a freshly created agent uses when its session does not name one.
- **Key abstractions:** `Config` (three `Volatile<string>` fields), `AgentDefaultModelConfig` (a cordis `Service`), `currentSelection()`, `saveSelection(next)`, plus a `declare module '@deepseek-ai/cordis'` augmentation adding `ctx.agentDefaultModel`.
- **Data flow:** the config fields are `Volatile` (cordis/schemastery reactive refs), so the service never caches a value — `currentSelection()` re-reads `config.provider.get()` / `config.model.get()` / `config.reasoningEffort.get()` on every call and returns a **detached** plain object. `saveSelection()` looks up `ctx.get('configEditor')`; if there is no editor it returns silently (no-op). Otherwise it calls `editor.edit(entry, () => config)` where `entry` is `ownerContext.fiber.entry`.
- **Non-obvious design decisions:**
  1. **Writes are serialized through a private `saves: Promise` chain** (`src/index.ts:81-88`) so overlapping saves commit in *submission order*, and a rejected write does not block later saves (`this.saves = saved.catch(() => {})`).
  2. **A save is a complete replacement, not a merge** — omitting `reasoningEffort` *removes* it from the profile override, and the config object is rebuilt from scratch rather than merged onto the previous one.
  3. **The service does no catalog-membership validation** — the README states the consumer that opens a model request owns availability diagnostics.
  4. **The `ownerContext.inject(['settings'], …)` in the constructor forces `settings.configure({ auto: false })`** on the owner fiber, so the profile entry is not auto-persisted behind the editor's back.
  5. **The type-only side-effect imports** (`import type {} from '@deepseek-ai/dsh-settings'` and `…dsh-config-editor`) exist purely to force the `declare module` augmentations to be loaded, and are erased at build time.
- **Edge cases & failure handling:** no `fiber.entry` → early return (nothing to write to); no `configEditor` → early return (documented as "a deployment without a configuration editor keeps its composition entry"); a rejected `editor.edit` propagates to *that* caller's promise while the chain continues (the `catch(() => {})` swallows only for the chain, not for the caller).
- **Surprising:** `saveSelection()` mutates nothing locally — the new default becomes visible only because the config editor writes back into the same `Volatile` refs. The test at `tests/agent-default-model.spec.ts:26-33` proves a standalone context with no editor keeps `model: 'original'` after a `saveSelection` call.

### `packages/core/agent-tool-presentation/src/index.ts` — one row that picks the tool's shape
- **Purpose:** The row an agent preset carries to say which form of its tools the model sees: `native` (every schema as a function definition) or `ptc` (only `run_code` plus a generated SDK).
- **Key abstractions:** `name = 'tool-presentation'`, `inject = ['tools']`, `Config { mode }`, `apply(ctx, config)`.
- **Data flow:** `apply` calls `ctx.tools.presentAs(mode)` on the *mounting scope's* context — so the declaration covers every agent joined to that preset's standing mount, and a PTC preset runs beside native ones in one process.
- **Non-obvious design decisions:**
  1. **`ptcRuntime` is deliberately NOT in `inject`** (`src/index.ts:35-39`): a `native` row must mount in a deployment that composes no PTC runtime. The wait is declared *inside* `apply` instead, via `ctx.inject(['ptcRuntime'], …)`.
  2. **`mode` is required, not defaulted** — "an omitted value would mean the row was composed for nothing: a preset without this row already gets the deployment default."
  3. **`presentAs` is itself the effect** — it registers through the calling context and hands back that exact disposer, so the declaration unwinds with the row "without a second wrapper owning it."
  4. **A missing PTC runtime leaves the row *pending*, not failed** — the preset registry then refuses the mount naming this id, "so the failure lands where the operator can act instead of at the session's first request."
- **Edge cases & failure handling:** an unsupported mode is rejected by the schemastery schema; a second declaration in the same composition is refused rather than merged ("two answers to 'which form does the model see' is a contradiction, not an override").
- **Surprising:** the *tool registry* deliberately stays host-plane — "its consumers are all host-plane — the agent loop reads its scheduler, the API proxy reads its presenters, and every tool plugin registers into it — and a service only moves down when all of its consumers move with it." The preset owns the *presentation*, not the registry.

### `packages/core/agent/src/index.ts` — the registry, the factory seam, and the initiator scope
- **Purpose:** `AgentRegistry` — the live agent registry (`ctx.agents`), the factory seam that lets a driver plug in without consumers depending on it, and the process-local *initiator scope* that attributes work to the agent that caused it.
- **Key abstractions:** `AgentRegistry` (`src/index.ts:271`), `AgentFactory` (the `createAgent`/`resume` interface the loop implements), `AgentHandle` (the disposer is a **capability**), `CreateAgentOptions`/`ResumeAgentOptions`, `AgentSetup`/`AgentSetupCommit`.
- **Data flow:** `ctx.agents.create(options)` → `requireFactory()` → `Reflect.apply(target.createAgent, getTraceable(ownerCtx, target), [ownerCtx, options])` → the loop prepares, publishes and returns a handle. The registry's own `enter()`/`announce()` split is the ordered-lifecycle primitive the factory uses.
- **Non-obvious design decisions:**
  1. **The registry never creates agents.** It owns the *contract*; the loop owns construction and driving. Consumers depend on `dsh-agent` and never on `dsh-agent-loop`, "keeping the driver swappable."
  2. **The handle's disposer is a capability**: among consumers, only its holder can tear the agent down. `ctx.agents.get(id)` still returns a *bare* `Agent` — the handle is exposed only to the creator.
  3. **`enter()` and `announce()` are split** so setup can complete while the agent is *unpublished*: observers can never see a partially configured world. `enter()` is the "authoritative collision boundary" — concurrent create/resume may both prepare, but only one exact entry can publish.
  4. **A detach requested during creation is deferred** until the serial `agent/created` dispatch has settled (`entry.detachRequested`), so every listener observes the same live entry and disposal follows creation.
  5. **A stale disposer cannot remove a later same-id replacement** — the captured entry identity is the final boundary (`if (this.store.get(entry.id) !== entry) return`).
  6. **An entry rolled back before announcement is never `agent/disposed`** — that would "invent an impossible lifecycle edge." But an entry announced and then vetoed *is* disposed, so earlier listeners that saw the creation see its disposal.
  7. **The initiator scope is a pair of `AsyncLocalStorage`s** — one for the agent, one for the *run chain* — so a nested boundary can be excluded from its own drain. `withInitiator` preserves the **exact** synchronous value or Promise identity (including a branded Promise whose `then` is overridden or whose `@@species` throws — the code calls `Promise.prototype.then.call` directly to attach an observer safely).
  8. **Teardown rejects new boundaries, lets returned-Promise boundaries drain, then disables the storage** — and a boundary that *initiates* the teardown is excluded from its own drain (no self-deadlock).
  9. **`withoutInitiator()`** hides the inherited agent for shared timers, queue pumps, watchers and exporters, so they do not inherit whichever agent happened to initialize them.
  10. **Ambient presence is neither liveness proof nor authorization** — "subjects and owners remain explicit, as does identity at worker, process, persistence, and wire boundaries."
  11. **`setFactory` canonicalizes a traced Service** before re-tracing it for the caller ("avoid stacking two Cordis shadow layers"), and the second registration throws.
  12. **The registry installs the Workspace archive-admission family** for every agent it publishes.
- **Edge cases & failure handling:** an agent whose id differs from its session id is rejected at `enter()`; `register()` returns the *exact* Cordis effect disposer so a composite teardown can nest the unregistration in order ("yielding a wrapper would leave it disposing as a concurrent sibling on owner unload, unregistering the agent … while its final turn is still draining").
- **Surprising:** `ctx.agents.get(id)` returns a bare `Agent` but `ctx.agents.roots()` distinguishes a *runtime root* from durable session lineage — "a resumed fork may still be a root."

### `packages/core/agent/src/runtime-types.ts` — the `agent/*` event vocabulary
- **Purpose:** The public `Agent` interface (merged onto `src/types.ts`'s minimal `Agent`) and the full declaration of every `agent/*` cordis event.
- **Key abstractions:** `AgentOptions`, `CancelOptions`, `Inbox` (the structural interface), `AgentStatus` (`'idle' | 'running'` — **two states, not three**: "Disposal removes the agent from its registry; it is not a third observable status"), `PreStepDecision`, `RequestErrorAction`, `SessionStartSource` (`'startup' | 'resume' | 'clear' | 'compact'`), `AssistantStreamFrame`.
- **Data flow:** The events are *merge-extensible* cordis declarations with a `this: Scoped<Agent>` receiver, so scope filtering is part of the type.
- **Non-obvious design decisions:**
  1. **Every agent event is scope-filtered by type**: the handler's first parameter carries the `agent` subject *and* the handler declares `this: Scoped<Agent>`.
  2. **`agent/pre-step` is a waterfall; `agent/created` and `agent/turn-stopping` are serial; `agent/status`, `agent/inbox/*`, `agent/error` and `agent/assistant-stream` are emit.** The mode is part of the contract.
  3. **`agent/turn-stopping` is data-driven, not order-driven**: "a listener that objects steers (`agent.steer(...)`) and the machine re-reads its inbox: fresh steering runs another step, none closes the turn. **Data decides, so listener order cannot change the outcome.**" The inverse control (stopping a tool loop early) is also data: a tool result carrying `concludesTurn` ends the turn at its step.
  4. **The turn-stopping conclusion never short-circuits already-submitted next-step work** — same-step `additionalContexts` or racing steering still runs, and the turn closes only when that inbox drains.
  5. **The `agent/assistant-stream` frames are explicitly *presentation data*, not the replay source**: "The loop commits the complete compact stream as one `assistant/message` or `assistant/attempt` before a committed end frame."
  6. **The `agent/inbox/claimed` payload includes the owning turn**, and the doc notes that a rejected step ends the claimed message's life there — "it is neither discarded nor re-emitted as a user/message."
  7. **`agent/request` explicitly cannot mutate messages**: "Model-visible content must use logged channels; this waterfall cannot mutate messages."
  8. **`agent/created` listeners must not await `agent.whenIdle()` or their own owner's disposal** — "those operations wait for creation to finish."
- **Edge cases & failure handling:** n/a (types).
- **Surprising:** `runMaintenance` is part of the *public* `Agent` interface — a non-turn task that runs from the true idle phase, during which public status stays `idle` but `whenIdle()` follows both the task and any waking work released behind it.

### `packages/core/agent/src/dispatch.ts` — the fused dispatcher
- **Purpose:** `agentEvents(ctx, agent, carrier?)` — a dispatcher that couples the agent *subject* to the agent *scope carrier*, so the scope key and the payload's `agent` cannot diverge.
- **Key abstractions:** `AgentSubjectEvent` (the type-level set of agent-subject events), `AgentEventDispatch` (`emit` / `serial` / `waterfall`), `agentCarrier`, `emitAgentEvent`, `assembleContextFor`.
- **Data flow:** the fused tuple is `(carrier, name, { ...payload, agent })` → cordis dispatch. The spread comes **first**, so a payload that happens to carry an `agent` field can never override the injected subject.
- **Non-obvious design decisions:**
  1. **`emit` does NOT use cordis's `emit` mixin.** Cordis invokes callbacks through `Array.map`: "one synchronous throw starves later listeners, and returned promises are discarded." The dispatcher resolves the callback set itself and contains both failure modes independently, logging `agent event "<name>" listener threw/rejected`.
  2. **The carrier is a stateless routing object built once.** The loop driver builds it in the agent's constructor so "hot-path dispatches never allocate."
  3. **The agent-subject event set is derived from the *type* of the events map**, requiring both a payload carrying `{ agent: Agent }` and a `this: Scoped<Agent>` receiver — "The `this` check keeps accidental payload-happens-to-carry-an-Agent events (or zero-arg events, whose parameter tuple would satisfy a bare rest-tuple check via callability) out of the fused-dispatch surface."
  4. **`assembleContextFor(agent, signal)` sets `agent` and `scope` together** — "so agent-scoped prompt and tool contributions cannot be silently omitted."
- **Edge cases & failure handling:** a throwing or rejecting listener never blocks a later observer.
- **Surprising:** the `waterfall`/`serial` methods are thin forwards with one contained, shape-preserving cast each, because TypeScript cannot relate the generic `Tail<K>` spread back to cordis's conditional parameter tuple.

### `packages/core/agent/src/consumed-work.ts` — accounting for work the log consumed
- **Purpose:** `foldConsumedWork(events)` — answers "what did this agent log actually do with the work it took?" from the log alone.
- **Key abstractions:** `ConsumedWork { end?, droppedUnrun }`, `foldConsumedWork`, `accountsForClaim(reason)`.
- **Data flow:** one pass over the events: `turn/start` opens a turn; `step/start` marks it stepped; `agent/inbox/spliced` with a `removedCount` and no `outcome` marks it *claimed* (or, with `outcome: 'canceled'` and no insertions, marks work *dropped unrun*); `turn/end` closes it and decides whether that ending accounts for the claim.
- **Non-obvious design decisions:**
  1. **Turn/step vocabulary alone cannot answer this.** "A turn that stops before its first step leaves a `turn/end` shaped exactly like the balanced no-op turns a rejection or an empty claim produces, so reading turns in isolation either credits cut-short work as finished or convicts every no-op." The missing fact is the *inbox's own record*.
  2. **Only a `completed` end does NOT account for a claim** — a `completed` turn had nothing left to run once its claim was rewritten away. `blocked` **does** account for it (the pre-step rejection discarded the claimed messages, so that work will never run).
  3. **A replacement is not a drop**: a `canceled` splice that *inserts* something keeps the work pending under a new identity; only a cancellation that leaves nothing behind counts as dropped.
  4. **A later accounting turn absorbs an earlier drop** — "Anything dropped before this turn closed is what its own ending reports; only a later drop is still unaccounted for."
  5. **The fold works on an owned *suffix* of a log** — so a caller never has to sample live state before cancelling; "a cancellation issued by anyone — the owner's teardown, an ancestor's interrupt, an unloading plugin — reads the same."
  6. **The default branch of `accountsForClaim` returns `true`** — an unnameable ending over consumed input "must not read as success."
- **Edge cases & failure handling:** a claim with no open turn (an owned suffix that begins mid-turn) is credited to no turn at all.
- **Surprising:** this is a **post-mortem primitive**: it is the repo's answer to "did that turn really do the work it claimed?" — directly applicable to a trading app's trade-log accounting.

### `packages/core/agent/src/model-selection.ts` — coupling a model switch to the transcript
- **Purpose:** `installModelSelection(agentCtx, selection)` — binds one mutable `{provider, model, reasoningEffort}` to an agent's prompt assembly and request routing, and tells the model when the route changed.
- **Key abstractions:** `ModelSelection`, `ModelSelectionRef` (`current` + `assembled`), `installModelSelection`.
- **Data flow:** three scoped waterfall listeners: `system-prompt/assemble` snapshots `current` into `assembled` and injects `provider`/`model` as prompt variables; `agent/request` applies the assembled pair (and clears any inherited effort when the selection has none); `agent/pre-step` (with `prepend: true`) appends a **model-switch notice** to the admitted messages.
- **Non-obvious design decisions:**
  1. **The selection is captured at assembly and applied at request — two different steps — so a concurrent switch takes effect on a *later* step** "instead of splitting the two surfaces."
  2. **An absent selected effort clears any inherited effort**, "restoring the selected model's provider/default behavior."
  3. **The switch notice is a durable user-role message**: `[model changed: assistant turns above this point were generated by <from>; the session continues with <to>]`. Provider names appear only when the switch crosses providers; a reasoning-effort-only change adds nothing.
  4. **The notice compares the assembled selection with the latest *request header***, not with the last selection — so a failed request that never logged its header repeats the notice on the next request.
  5. **Empty no-call decisions add no notice** (the loop skips an empty first step and an emptied offered continuation).
- **Edge cases & failure handling:** a rejected or aborted step adds no notice; the disposer removes all three listeners.
- **Surprising:** the notice is *appended after the cached history*, which preserves the provider's prefix cache — the route change may still prevent reuse, but the log is not rewritten.

### `packages/core/agent/src/archive-admission.ts` — the `turn` family of the Workspace archive seam
- **Purpose:** Answers the Workspace registry's `workspace/session-activity` with a `turn` family while a Session's own Agent is running, and cancels that turn on `workspace/session-stop`.
- **Key abstractions:** `installTurnArchiveAdmission(ctx, lookup)`.
- **Data flow:** `workspace/session-activity` (a waterfall) → read `lookup(sessionId)?.status === 'running'` → prepend `{ kind: 'turn' }` to the rest; `workspace/session-stop` → `agent.cancel({ kind: 'user' })`.
- **Non-obvious design decisions:** the stop is "the way the user's own stop does — `agent.cancel({ kind: 'user' })`, **but without the stop button's `keepInbox`**, so queued input is discarded with a logged inbox splice instead of waking the archived Session later." Nothing is awaited to settlement; "a Session without a live Agent has no turn that could run."
- **Edge cases & failure handling:** the listeners live as long as `ctx`'s fiber, so they stop answering once the registry fiber is disposed.
- **Surprising:** this is a **human-in-the-loop shape** — archiving a session with a live turn *cancels the turn* rather than orphaning it.

### `packages/core/agent/src/types.ts` — the durable agent vocabulary
- **Purpose:** The type-only surface shared with type-only consumers (the `dsh-agent/types` subpath export).
- **Key abstractions:** `Agent` (minimal — only `id`), `InboxTarget`, `InboxState`, `InboxWireState`, `TurnBoundaryProjection`, plus `declare module` augmentations for the Workspace, Typert, session-projection and session event maps.
- **Data flow:** declares the `agent/inbox/spliced` session event shape and the projection table entries for `inbox` and `turnBoundary`.
- **Non-obvious design decisions:**
  1. **The public `Agent` in `types.ts` is deliberately minimal** (only `id`); `runtime-types.ts` merges the live capabilities onto it. The two files exist so a *type-only* consumer can import the identity without pulling the runtime.
  2. **`InboxWireState` exists because the fold state's `UserMessage` type cannot cross a typert Remote boundary** — "its source union carries an `unknown` replay field" — so the wire form is JSON-safe `JsonValue[]`.
  3. **`TurnBoundaryProjection` has an explicit reader contract**: the key is registered by `dsh-agent-loop` and absent otherwise, so "readers treat an absent key as 'no open turn / no boundaries' — capability absence, not a corrupt state."
  4. **The `turn` key is merged into `SessionActivityKindMap`** so a Client that renders the families imports `@deepseek-ai/dsh-agent/types` for it.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the `agent/inbox/spliced` event is declared here, in the *agent* package, while the concrete inbox lives in `agent-loop` — the vocabulary is shared, the storage is not.

### `packages/core/agent/src/projection.ts`
- **Purpose:** A 12-line module-augmentation file that registers the `turnBoundary` key in the session-projection state map.
- **Key abstractions:** none beyond the augmentation.
- **Data flow:** type-only.
- **Non-obvious design decisions:** the *definition* of the projection lives in `agent-loop` (the driver owns the events); the *type* lives here so consumers can read it without depending on the driver.
- **Edge cases & failure handling:** n/a.
- **Surprising:** a package that ships a single `declare module` block — a deliberate split of "the shape" from "the writer."

### `packages/core/scope/src/index.ts` — the scoped-registration primitive
- **Purpose:** Mints a Cordis context that tags its registrations with an opaque identity, and builds routing-only event carriers for that identity.
- **Key abstractions:** `ScopeKey` (an opaque, identity-compared object), `Scoped<T>` (a branded carrier), `Scope` (`ctx`, `rawDispose`, `dispose`), `createScope`, `scopeOf`, `scopeTarget`, `bindScopeParent`/`scopeParentOf`/`scopeChainOf`, `ScopeParentBinding`, `isScopeCarrier`, `carrierKeyOf`.
- **Data flow:** `createScope(ctx, key, { parent })` → `ctx.plugin(scope)` (a no-op backing fiber) → `fiber.ctx.extend({ [kScope]: key })` → a scoped context. `scopeTarget(base, key)` builds a carrier whose `Context.filter` composes the base's own filter with the scope predicate.
- **Non-obvious design decisions:**
  1. **One parent relation powers both directions.** Registration views inherit DOWN the chain (a child scope sees its ancestors' layers); event admission extends UP it (a listener tagged with an ancestor receives a descendant's events). "A tag BELOW the dispatch key stays excluded — events flow up the chain, never down."
  2. **Binding is once.** `bindScopeParent` throws if the key already has a parent; only the returned `ScopeParentBinding` may re-link it, and every re-link keeps the cycle check.
  3. **The carrier carries routing state only** — the real subject travels in the event arguments, and `Scoped<T>`'s brand demands the carrier as the `this` type, "so dispatching with a bare subject is a compile error."
  4. **Untagged listeners stay global**; `{ global: true }` listeners bypass filtering; `key === undefined` admits untagged listeners only.
  5. **`dispose()` is a shared quiescence**: `disposing ??= quiesceFiber(fiber)`, and `quiesceFiber` follows the fiber's `inertia` after `dispose()` so racing callers await the *same* completion.
  6. **`rawDispose` is the exact Cordis disposer** "used when nesting this scope in an ordered composite effect" — the scope teardown order (`inner`, `scope`, `outer`) is asserted by the test.
  7. **A scope is usable synchronously before the backing fiber activates.**
- **Edge cases & failure handling:** a cycle in the parent chain is rejected at bind and at every re-bind; `isScopeCarrier` distinguishes an unkeyed carrier from a non-carrier via a `WeakMap`.
- **Surprising:** "Handing out a scoped context also hands out the minting plugin's service-resolution API (resolution walks the minting fiber's dependency chain), so a scope is minted from the plugin whose dependencies the scoped registrations need." — a scope is *not* a sandbox.

### `packages/core/scope/src/store.ts` — scoped registry layers
- **Purpose:** Shared insertion-ordered storage and effect ownership for scope-aware registries.
- **Key abstractions:** `ScopeLayer` (`isEmpty()`), `NamedEntries<V>`, `AnonymousEntries<V>`, `ScopedLayers<L>`.
- **Data flow:** `ScopedLayers.effect(ctx, action, { label, notify })` derives the scope from `scopeOf(ctx)`, lazily creates the scope's layer, runs the atomic `action`, and yields an undo that removes the entry and reclaims an empty layer.
- **Non-obvious design decisions:**
  1. **Reads never create layers.** `peek(scope)` returns `undefined` rather than materializing one.
  2. **`peek` is deliberately chain-blind**: a caller addressing one scope's *own* contributions (its restrictions, its guards) "must not silently pick up an ancestor's"; `chainLayers` is where inheritance is the point.
  3. **`merge()` materializes global named entries then scope-chain shadows, farthest ancestor first**, so the nearest scope's entry wins a name.
  4. **A layer is reclaimed only when its whole aggregate is empty** — `isEmpty()` covers *every* table in the layer.
  5. **The undo is collected *before* the notification**, and a failed action removes a just-created empty layer rather than leaving it behind.
  6. **A notification that throws rolls the insertion back** — the undo runs, then the notification is retried.
  7. **Values are borrowed** and iterators are live *within one nonempty table generation*: draining the table replaces the backing `Map`, so a live iterator sees no later insertions.
  8. **Equal anonymous values remain separate registrations** (keyed by a `Symbol`).
- **Edge cases & failure handling:** a duplicate name throws the caller-supplied diagnostic; `effect()` returns the *exact* context effect disposer so Cordis effect identity is preserved.
- **Surprising:** `NamedEntries.insert` returns an **idempotent undo that removes only that insertion** — a later re-insertion of the same name is not undone by the earlier undo's second call (the test pins this).

### `packages/core/session/src/index.ts` — the event-sourced session store
- **Purpose:** `Session` (an append-only, event-sourced log) and `SessionStore` (`ctx.sessions`) — the durable record behind every agent interaction.
- **Key abstractions:** `Session`, `SessionStore`, `SessionForkError` + `SessionForkErrorCode`, `appendPluginRecord`, `pluginRecordOf`, `adoptSessionEvent`, `snapshotSessionEvent`, `SessionPreparation` (re-exported).
- **Data flow:** `append(type, data, surfaceIntent)` → `snapshotJsonValue(data)` (one-pass, lossless-JSON validation *and* copy) → `validateSessionEventData` → `surfaceManager.validateNext(event)` → `commit(event)` → `this.log.push(event)` → `session/event` observers. Derived history comes from `deriveMessages()`, which walks the *surface* node list, not the raw log.
- **Non-obvious design decisions:**
  1. **Model-visible means logged.** Anything that reaches a model request must be reconstructable from the log. The request itself is `header.config` + `deriveMessages()` + `header.tools` — there is no `system` field.
  2. **The append path never blocks on I/O** — persistence plugins buffer asynchronously; the commit is synchronous and observers are notified after the log push.
  3. **One iterative JSON pass reads, validates and copies each nested value once**, "so a stateful getter cannot supply one value to validation and another to storage." The tests pin this with counting getters.
  4. **A rejected append changes nothing** — not the log, not the derived state, not the event feed.
  5. **The seed is validated to the same invariants `append` enforces**, so a replay/fork "cannot construct a live log that no persistence backend could store"; `seq` must be contiguous from 0.
  6. **The `seq = log.length` contiguity contract** is the spine of the whole system.
  7. **The header is kept out of the event log** — "it is a storage concern, not replayable conversation state."
  8. **`Session.create` (snapshot mode) copies and freezes; `Session.fromRestore` (detached / shared-frozen) adopts without copying.** The mode is carried by the seed's `eventState`.
  9. **A seeded session must supply both an explicit seed and an explicit inherited count**, and the count must agree with the log or with a tagged `session/end-seed` marker — "the final inherited marker" must be the last one.
  10. **A fork child owns exactly one tagged marker at its inherited cut**; the constructor supplies it when given only the inherited prefix.
  11. **`deriveMessages()` returns a FRESH ARRAY per call over SHARED, DEEP-FROZEN message objects** — "later appends never grow an array a caller already holds."
  12. **The derived cache is invalidated by `contentGeneration`** (a replacement *or* a plugin-owned message change) and otherwise grows by tail.
  13. **`requestHeader()`, `requestContext()` and `toolHistory()` are incremental folds** — each event is folded once, so a per-step read costs O(new events).
  14. **`enter()` and `announce()` are separate**, so a throwing `session/created` listener rolls the attach back instead of leaking the store entry and its publication hooks. The `enter` disposer is yielded *before* the announcement.
  15. **`enter()` re-checks the id for a duplicate** — `prepare` and `enter` are public cross-package primitives and a caller may interleave arbitrary work between them.
  16. **A detach requested during announcement or publication is deferred** until that dispatch unwinds.
  17. **A reentrant append is refused**: "session append cannot reenter while another append is being published."
  18. **Observer failures are contained per listener** and never change the append's return value.
  19. **`flush()` is the ONE flush entry point** — it dispatches `session/flush` with the captured carrier, awaits *every* listener via `Promise.allSettled`, then throws the first failure. "A producer that needs an immediate durability barrier awaits it instead of assuming the write-behind drained."
  20. **Plugin records** are `ignorable` events outside `SessionEventMap`, namespaced `plugin:<owner>/<record>`, that never enter the model-visible surface but travel with the log through resume and fork.
- **Edge cases & failure handling:** a duplicate id, an id that does not match the session's id, a non-absolute `cwd`, a non-JSON `meta`, an exotic header prototype, a reentrant append, an already-announced session, a stale detach, a fork boundary that is not a contiguous existing seq (typed `SessionForkError` with `INVALID_BOUNDARY` / `SESSION_NOT_FOUND` / `SESSION_NOT_LIVE` / `SESSION_ALREADY_EXISTS`) — all rejected before the log changes.
- **Surprising:** `eventAt()`, `snapshotEvents()` and `ownEvents()` are **deprecated** ("new production calls are prohibited") — the repo is actively migrating away from synchronous session reads, with a lint allowance for test files.

### `packages/core/session/src/surface.ts` — the ordered model-visible surface
- **Purpose:** The surface layer: an ordered view of the events that produce LLM messages, plus the append-boundary validator.
- **Key abstractions:** `SessionSurface` (`nodes`, `replaceGeneration`, `contentGeneration`), `SurfaceManager`, `SessionMessageProjection` / `SessionMessageProjectionContext`, `SurfaceFoldResult` / `SurfaceFoldReplacement`, `foldSurface`, `deriveEventMessage`, `validateSessionEventData`, `validateSurfaceMetadata`, `isSurfaceEvent` / `isAppendSurfaceEvent` / `isReplacementSurfaceEvent` / `isSurfaceEligibleType`.
- **Data flow:** every message-producing event records a `surfaceOp`; the surface is the *single source of derived history*. A `replace` splices the shadowed range out; a plugin-owned projection changes message *content* without changing node membership or identity.
- **Non-obvious design decisions:**
  1. **The module is browser-safe** — "web clients consume this subpath export, so it must stay free of `node:` imports (they break the vite bundle)." It even reimplements `isDeepStrictEqual` as `isDeepEqualJson`.
  2. **The surface is the WRONG source for a human transcript.** "The model-visible surface deliberately shadows replaced ranges, so it is the wrong source for a human transcript — a landed replacement would erase conversation the user already saw." `isAppendSurfaceEvent` exists precisely to give the transcript its durable source material.
  3. **Node 0 is protected**: a replacement covering the head while it is a `system/message` must itself be a `system/message` over exactly that node. Later system nodes carry no protection.
  4. **A `tool/result` replacement may change only the message's content** — every other field must be structurally equal.
  5. **`sourceEventSeqs` must cover every shadowed surface node** and must reference *earlier* events; an empty array and duplicates are rejected.
  6. **An `assistant/message` may not carry `sourceEventSeqs`** — it embeds its provider stream instead.
  7. **A surface-eligible event REQUIRES a `surfaceOp` marker**; a non-surface event may not carry one; an unknown ignorable record retains opaque metadata without touching the surface.
  8. **A tool addition is bound to a historical header**: `headerSeq` must name an *earlier* `request/header` and the name must identify **exactly one complete schema** in it.
  9. **A replacement is planned before it mutates state** (`SurfacePlan` / `SurfaceReplacePlan`) — "a failure cannot partially mutate the surface."
  10. **`contentGeneration` counts both replacements and plugin-owned message changes**; `replaceGeneration` counts only positional replacements. The derived cache keys on the former.
  11. **Cached messages cannot outlive the definitions that interpreted their log** — `_assertProjections()` throws "was removed or replaced; restore the session with its owning plugin."
  12. **Empty system/developer/assistant nodes keep their surface position but project to no message.**
- **Edge cases & failure handling:** a replacement whose start/end is not a surface node, start after end, a negative-zero seq, a crossing of the loaded window head, a `developer/message` whose role does not match, a tool-change block in a non-developer message — all rejected with a located message, and the log is unchanged.
- **Surprising:** the "pending plan" mechanism — `validateNext` plans a candidate that has not entered the log, and `_processDelta` applies that plan when the event finally commits, so the incremental manager and the full fold agree exactly.

### `packages/core/session/src/types.ts` — the durable event vocabulary
- **Purpose:** `SessionEventMap`, `SessionEvent`, `SessionHeader`, the sequence brands and the turn-end reason union.
- **Key abstractions:** `SessionId`, `SessionSeq`, `SessionLogOffset`, `SessionSeqCursor`, `OptionalSessionSeq`, `SessionHeader`, `SessionEventMap`, `SessionEvent<T>`, `SurfaceOp`, `SurfaceIntent<T>`, `TurnEndReasonMap` / `TurnEndReason`, `AgentCancelCause` / `TurnEndCancelCause`, `PluginRecordType` / `PluginRecordMap` / `PluginRecord`, `EpochHeader`, `RequestContext`, `RequestHeaderReason`.
- **Data flow:** type-only; the map is the contract every producer appends against.
- **Non-obvious design decisions:**
  1. **Two numeric position types with different meanings.** `SessionSeq` identifies an *existing* event or inclusive watermark; `SessionLogOffset` identifies a *gap, prefix length or read boundary* and may equal the event count. `SessionSeqCursor` adds the `-1` "no event yet"; `OptionalSessionSeq` uses `null` "when absence is data".
  2. **The brands disappear at runtime** — "durable JSON and wire values remain ordinary numbers."
  3. **`SessionEvent` is a proper discriminated union over `type`**, not independent `type`/`data` unions, so `switch (event.type)` narrows `event.data` without casts. The `surfaceOp`/`sourceEventSeqs` fields are *conditional* on the surface variants, so the compiler rejects them on log-only events at the call site.
  4. **`ignorable?: true` is the compatibility mechanism.** "Absent means required: a reader meeting an unrecognized type without this marker MUST refuse to reconstruct the session instead of silently dropping the event… defaulting to required means a forgotten marker over-refuses (an inconvenience) rather than silently resuming a gutted session."
  5. **`SESSION_FORMAT_VERSION = 4` is a single monotonic integer with no major/minor split**, and the doc spells out exactly when to bump it: "Bump when an existing discriminator cannot prevent unsafe interpretation; a structural difference alone is insufficient."
  6. **`EpochHeader.system` is `never`** — "Retired request text; system prompts belong to system/message events."
  7. **`TurnEndReasonMap` is merge-extensible**; `interrupted` and `forked` are *only* ever written by recovery/fork code, never live by the loop.
  8. **`delegationDepth` is persisted** "so a recursion budget survives restart and resume — a runtime-only depth would reset a resumed child to top-level."
  9. **`agentPreset` is durable** "because the preset decides the session's tools and prompt: a resume that restored a different composition would replay history the model can no longer act on."
  10. **`tool/result.error` is allowed only when the message has `isError: true`** — the failure identity lives *outside* the model-facing message.
  11. **`tool/result.meta` is the tool's private presentation payload** — "the durable log reproduces the identical card on replay."
- **Edge cases & failure handling:** `SessionSeq(-0)` and `SessionSeq(0.5)` throw; `header.seedLength` is rejected as a retired physical field.
- **Surprising:** the `session/end-seed` marker is the *only* thing separating inherited history from live work, and "Session append does not reject other writers, so a plugin appending one would silently classify every live bracket before it as seed history."

### `packages/core/session/src/repair.ts` — closing an interrupted turn
- **Purpose:** `ToolCallRecovery` (track unanswered tool requests) and `openTurnClosers` / `interruptedTurnClosers` (synthesize the events that close an open tail turn).
- **Key abstractions:** `TOOL_NOT_STARTED`, `TOOL_OUTCOME_UNKNOWN`, `OpenTurnCloseCause` (`interrupted` | `forked`), `ToolCallRecovery`, `openTurnClosers`, `interruptedTurnClosers`.
- **Data flow:** replay committed events through `ToolCallRecovery.observe` → `results()` builds the synthetic `tool/result` events → `openTurnClosers` appends `step/end` (if a step is open) and `turn/end` with the cause's reason.
- **Non-obvious design decisions:**
  1. **The two error codes state the same fact about the call's *recorded lifecycle*, while the wording differs per cause** — `interrupted` says the harness was interrupted; `forked` says "the parent session may have completed it after the fork point."
  2. **The retry guidance is risk-shaped**: "retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly." — a direct, reusable model-facing policy.
  3. **The synthetic message id is deterministic** (`{cause}-tool-result-{callId}-{seq}`) and the timestamp **reuses the last real event's time** — "never invents a 'future' time."
  4. **A result cites its `tool/call` via `sourceEventSeqs` when one was recorded**, so the pairing survives in the surface.
  5. **Closed steps are preserved** — "a recorded `tool/call` without a committed result receives `TOOL_OUTCOME_UNKNOWN`" and "previously closed inconsistent history" is explicitly *not* rewritten.
  6. **The recovery state retains pending *identities*, not event history.**
  7. **A `tool/result` only discharges a pending call when its `surfaceOp` is `append` and its turn/step match** the call's.
- **Edge cases & failure handling:** a balanced or empty log returns no events; a `tool/call` with no matching assistant entry is handled gracefully; a call already answered is not re-answered.
- **Surprising:** the *same* mechanism serves three different jobs — live failed-step recovery, crash recovery of a persisted log, and fork-seed construction — with only the cause (and therefore the wording) differing.

### `packages/core/session/src/request-header.ts` — the logged request envelope
- **Purpose:** Canonicalization, equality and folding of the `request/header` snapshot.
- **Key abstractions:** `canonicalHeader`, `headerEquals`, `foldRequestHeader`.
- **Data flow:** the loop appends a `request/header` event; `foldRequestHeader(events, from?)` selects the latest snapshot; `headerEquals` decides whether a new snapshot is needed.
- **Non-obvious design decisions:**
  1. **Canonical form drops empty optional fields** — an empty tool list becomes an absent field, and empty `adapterDefaults` becomes absent. "Logging, folding, and comparison use this one representation."
  2. **Tool schemas compare by JSON string equality, in order** — a reorder is a change.
  3. **The fold is resumable** (`from` parameter), so a live session can fold incrementally and a reader can fold a prefix.
- **Edge cases & failure handling:** absent and empty tool arrays compare equal (both canonical absence).
- **Surprising:** the header is *not* the prompt — "the rendered system prompt is a `system/message` surface node, not header state." The header is the **non-history** envelope only.

### `packages/core/session/src/tool-history.ts` — historical tool definitions
- **Purpose:** `ToolHistoryProjection` — a stateful fold over committed headers and developer messages that reconstructs the tool definitions a request must offer, *independently of model capability*.
- **Key abstractions:** `ToolHistoryProjection` (`apply(event)`, `snapshot()`).
- **Data flow:** each committed `request/header` records its schemas; each `developer/message` with a `headerSeq` resolves its additions against *that historical header* and appends an update block.
- **Non-obvious design decisions:**
  1. **Additions resolve through their historical `headerSeq`**, not through the current registry — "the current registry and latest header do not select an earlier addition's definition."
  2. **A retained name that returns with a *changed* definition restarts the declaration series** ("A retained name cannot acquire a different definition without losing prefix reuse"); an unchanged restored name continues the series and is re-offered by its recorded addition.
  3. **A `series` header or a `startsSeries` marker restarts the declarations.**
  4. **A missing definition is an error** ("tool history: missing definition for X"), not a silent skip.
  5. **Headers lacking matching update records fall back to complete active declarations** — "Sessions written before tool-update emission have headers without matching updates."
- **Edge cases & failure handling:** the snapshot is deep-frozen and immutable; a later event never mutates a previously returned snapshot.
- **Surprising:** the projection tracks *both* the current baseline declarations *and* the historical additions, so a request can offer a tool that was added mid-conversation with its original definition.

### `packages/core/session/src/seq-ranges.ts` — compact `sourceEventSeqs`
- **Purpose:** Lossless range encoding for the JSONL `sourceEventSeqs` arrays.
- **Key abstractions:** `EncodedSeq` (`number | [number, number]`), `encodeSeqRanges`, `decodeSeqRanges`.
- **Data flow:** encode consecutive runs of ≥3 into inclusive pairs; decode expands them back.
- **Non-obvious design decisions:** **only *profitable* runs are encoded** — a run of 2 stays as two numbers, because a pair is not smaller than two numbers. A non-increasing input is passed through unchanged (it is not a valid range form).
- **Edge cases & failure handling:** malformed entries, negative values, `start > end`, overlapping ranges and exceeding the caller's `maxEntries` all throw.
- **Surprising:** the decoder imposes **no persistence-only length limit** by default — a million-entry range decodes fine (the test pins a 1,000,001-element array).

### `packages/core/session/src/fork.ts` — fork seed construction
- **Purpose:** `buildForkSeed(events, boundary)` — copy an inclusive prefix, mark the inherited cut, and close the open tail.
- **Key abstractions:** `buildForkSeed`.
- **Data flow:** `events.slice(0, boundary + 1)` → push a `session/end-seed { inherited: true }` marker → `openTurnClosers(prefix, { kind: 'forked' })`.
- **Non-obvious design decisions:** the marker and the closers are **outside the inherited prefix** — `inheritedEventCount` counts only the copied events. The synthetic closers reuse the last copied event's timestamp.
- **Edge cases & failure handling:** the caller validates that the boundary is an existing contiguous event seq.
- **Surprising:** the fork reuses the *same* recovery machinery as crash recovery, with a different cause — one implementation, two stories.

### `packages/core/session/src/preparation.ts` — the unpublished session
- **Purpose:** `SessionPreparation` — ownership of one unpublished Session before registry publication, with `Symbol.dispose`.
- **Key abstractions:** `SessionPreparation` (`create`, `[Symbol.dispose]`), `SessionPreparationOptions`.
- **Data flow:** `using preparation = SessionPreparation.create(store.prepare(id, { meta }))` — the `using` keyword guarantees the release callback fires on any exit, including a throw.
- **Non-obvious design decisions:** **disposal is synchronous and idempotent**; "Providers decide whether release returns the Session to a cache or discards it; publication may consume that state before disposal, making the callback a no-op."
- **Edge cases & failure handling:** a second disposal is a no-op.
- **Surprising:** the `using` declaration is the whole point — the preparation's lifetime is bound to a lexical scope, not to a try/finally the caller can forget.

### `packages/core/session/src/known-event-types.ts` — the generated event vocabulary
- **Purpose:** `KNOWN_SESSION_EVENT_TYPES` and `MESSAGE_PROJECTION_EVENT_TYPES` — the set of event types this build understands.
- **Key abstractions:** two `ReadonlySet<string>` constants.
- **Data flow:** the persistence read path refuses to interpret a log containing a type outside this set **unless** the event carries the envelope's `ignorable` marker.
- **Non-obvious design decisions:** **event-name registration was rejected** — "it does not classify omission safety and would make reads composition-dependent." The per-event `ignorable` marker is the compatibility mechanism instead.
- **Edge cases & failure handling:** "such a log was likely written by a newer harness, and silently skipping a required event would reconstruct a wrong session."
- **Surprising:** the file is **generated** (`scripts/gen-persistence-catalog.ts`) and verified fresh by `verify-persistence-catalog` — the vocabulary is a build artifact, not a hand-maintained list.

### `packages/core/system-prompt/src/index.ts` — the prompt registry
- **Purpose:** `SystemPrompt` (`ctx.systemPrompt`) — the registry every prompt contribution lands in: ordered sections, dynamic runtime contexts, tool-schema providers, variables, and the assembly/render pipeline.
- **Key abstractions:** `PromptSection`, `PromptContext`, `AssembledSection`, `AssembledContext`, `ToolProviderResult`, `PromptAssembly`, `AssembleContext`, `Config`, `SystemPrompt` (`src/index.ts:429`), `renderPrompt`, `renderContextSnapshot`, `renderContextSections`, `joinContextSections`, `SECTION_ORDERS` / `CONTEXT_ORDERS` (`src/index.ts:131` / `:170`), `TOOL_ORDER_REST`, `PERSONA_PREFIX_SECTION` / `PERSONA_SUFFIX_SECTION`.
- **Data flow:** `section()` / `context()` / `variable()` / `toolProvider()` register into a `ScopedLayers` registry → `assemble(context)` collects the global layer + the scope chain, resolves each text provider against the assembly context, sorts, applies the tool order, and dispatches the `system-prompt/assemble` waterfall → `renderPrompt(assembly)` interpolates `{{variables}}` and concatenates the sections.
- **Non-obvious design decisions:**
  1. **Sections are concatenated in ascending `order`; equal orders break by code-unit name order** — a *deterministic* order that does not depend on registration order.
  2. **The order constants are a centrally allocated table**, not scattered numbers: `SECTION_ORDERS` and `CONTEXT_ORDERS` are exported by name so contributors "resolve centrally allocated positions" instead of inventing their own. The test pins that the repository's placements are "unique, integral, and at least ten apart."
  3. **A `complete: true` section becomes the exact complete prompt** — but only *after* the cooperative waterfall has run, so tools, contexts and variables can still be resolved. More than one effective complete section makes assembly fail.
  4. **A registered complete section is RESTORED after the waterfall** — "listeners cannot add to or replace that scope's system prompt."
  5. **The waterfall's returned value is authoritative** — a listener may rewrite the whole assembly, and `system-prompt.spec.ts` pins that an expert assembly wins in PTC mode too.
  6. **The tool order is canonicalized BEFORE the waterfall** ("registration order is a plugin-load artifact and must not leak downstream"), but a listener that appends a tool is **not** re-sorted — "a listener owns the determinism of what it emits."
  7. **A `toolOrder` must contain exactly one `'<unlisted-tools>'` rest entry**, is rejected at load without it or with a duplicate, and **a listed name with no registered tool rejects every `assemble()`** — "misconfiguration blocks work; it does not silently fall back."
  8. **The `system-prompt/change` notification is deliberately UNFILTERED**: "a global change concerns every agent's next assembly, so a scoped listener subscribing here sees every change."
  9. **Dynamic contexts are joined into a *snapshot*, not appended to the prompt** — `renderContextSnapshot` produces one string and `renderContextSections` produces the *attributed* per-contributor form, so a later model can be told which subsystem said what.
  10. **Optional context can be suppressed per scope**, and **required context is never suppressed** — `suppressRuntimeContext()` filters the optional contributions and keeps the required ones.
  11. **Variable interpolation is strict and does not touch the prototype**: `{{constructor}}` is `UNKNOWN` ("prototype properties are not variables"), a *registered* variable named like a prototype property works, and **substituted values are never re-scanned** ("a value containing `{{sneaky}}` stays literal").
  12. **A lone `{{` with no later `}}` anywhere stays literal**, while a malformed reference (inner spaces) throws.
  13. **`interpolate: false` preserves literal text**, including `{{…}}` groups in generated tool documentation.
  14. **`refreshContext(assembly, context)` re-reads the registered runtime facts without re-running the waterfall** — it "preserves accepted sections, tools, variables, and contexts contributed only by the assembly waterfall."
  15. **A duplicate section name throws** — "a double-loaded plugin must fail, not double its text."
  16. **A `system-prompt/change` listener that throws rolls the registration back** (section, tool provider and variable alike) — the contribution never lands half-registered.
- **Edge cases & failure handling:** an unresolved variable reference throws **before** any model request, listing what *does* exist ("(none)" when nothing is registered); a non-finite `order` is rejected; a scope with no scope key cannot be used for a scoped registration; a tool provider whose registration is disposed mid-assembly is not evaluated (the membership is snapshotted first).
- **Surprising:** the *system prompt* is assembled as a set of named, ordered, scope-aware contributions with a **central order table** — the prompt is a registry, not a string. That is the single structural difference from a `buildSystemPrompt()` function, and it is what lets a plugin add a section without knowing where the others are.

### `packages/core/tools/src/index.ts` — the registry and the execution pipeline
- **Purpose:** `ToolRuntime` (`ctx.tools`) — the registry every tool plugin registers into, the model-facing schema projection, and the fixed pre/guard/around/post/result execution pipeline.
- **Key abstractions:** `ToolDefinition`, `ToolExecution` / `ToolExecutionInput` / `ToolRunContext` / `ToolDispatchExecution`, `ToolExecutionResult` (`ToolExecutionSuccess` | `ToolExecutionFailure`), `PreToolDecision`, `PostToolDecision`, `ToolGuard`, `ToolOutputDefinition`, `ToolNotFoundError`, `ToolOutputError`, `ToolRuntimeScheduler` (the internal staged view), `TOOL_RUNTIME_SCHEDULER`, `TOOL_ABORTED`, `TOOL_ABORTED_BEFORE_DISPATCH`, `ToolRestriction`, `ToolPresentationMode`.
- **Data flow:** `register(definition)` → a scoped `ToolLayer` → `view(scope)` resolves the visible map → `schemas(scope)` projects the **allowlisted** wire fields → `execute(input)` → `createExecution` (materialize + freeze args, mint the token) → `tools/pre-execute` waterfall → optional approval `ask` → monotonic guards → `tools/execute` waterfall → the tool body → `tools/post-execute` waterfall → `finalizeContent` → materialize + freeze → `tools/result` observers.
- **Non-obvious design decisions:**
  1. **The wire projection is an allowlist.** `schemas()` emits only `name`, `description`, `parameters` and `deferLoading`. `output`, `execute`, `finalizeContent`, `timeoutMs`, `isConcurrencySafe` and the presentation callbacks "never leak onto the wire" — the tests assert the exact key set.
  2. **The pipeline is fixed and ordered**: `tools/pre-execute` (extensible allow/deny/ask) → registered monotonic guards → `tools/execute` (around-dispatch) → `tools/post-execute` → `finalizeContent` → observe-only `tools/result`.
  3. **Guards are monotonic**: a guard returns a *reason* and has no allow result, so "listener ordering cannot turn a denial back into permission."
  4. **Only the `tools/execute` view may replace the signal**, and the registry **re-fuses the original caller signal** before the body — "replacement cannot detach caller cancellation."
  5. **Cancellation is cooperative and quiescent.** A call aborted before the body is `ABORTED_BEFORE_DISPATCH`; one aborted after it replaces only a *successful* outcome with `ABORTED`. "Cancellation never abandons the body: a started promise reaches quiescence before its outcome becomes `ABORTED`."
  6. **A tool failure does not end the turn.** Unknown and throwing tools become structured `isError` results (`UNKNOWN_TOOL`), "so a call fails without ending the turn."
  7. **The canonical value belongs to execution; the session records the rendered content and optional presentation metadata.** "Replacing or redacting that content does not remove the canonical value available to a programmatic caller; a policy that must deny that access must block execution or replace the value."
  8. **A raw `ToolDefinition` must declare `output { schema, render, presentationMeta? }`** — registration rejects it otherwise. The raw JSON Schema output is validated against the enforced subset at registration.
  9. **The `run_code` name is reserved unconditionally** — "any agent may select a code mode for itself, so a name free to take under the deployment default would become a collision the moment a preset mounted."
  10. **A restriction filters what a scope *inherits*, never what its own layer registers.** The comment records the bug this fixed: "Reading the exempt set as 'the global layer' instead of 'not mine' held only while every model-facing tool sat in the host composition. Once presets moved them onto the agent plane they became an ANCESTOR contribution, so a child's filter silently stopped constraining anything it was given."
  11. **The mode collapse is resolved through `modeFor(scope)`, not the deployment default** — otherwise "an agent given `ptc` by an agent preset under a native deployment … would leave exactly that agent uncollapsed — announcing one surface while executing another, which is the bypass this collapse closes."
  12. **A collapsed call is denied BEFORE the extensible policy pipeline** — "pre-execute listeners, approval `ask`, and guards must never observe — or worse, approve — a call that can only fail." The denial message names the route: "only `run_code` is callable directly — call `x` from inside a `run_code` program instead."
  13. **`presentAs` and `restrict` REQUIRE a scoped context** — a context-global presentation is the `mode` config field, and a context-global restriction "would mask every agent."
  14. **Tool schemas are canonicalized before the assemble waterfall** — registration order "is a plugin-load artifact and must not leak downstream" — but a waterfall listener that mutates the list "owns the determinism of what it emits."
  15. **`projectContent` runs before post-execute policy; `finalizeContent` runs after it** — "Policy replacements remain authoritative" vs "the final content transform."
  16. **Presenters validate SOFTLY.** "Presentation is display-only and may run on REPLAY of arbitrary logged args (possibly from an older schema), so it must never throw" — a mismatch returns `undefined` (a generic card) rather than the hard `ToolArgsError`.
  17. **The approval seam is consumed opportunistically** via `ctx.get('approval')`; with no service an `ask` degrades to a deny ("not yet supported"), and the four outcomes map one-to-one so "the model can tell a human 'no' from an absent approval channel."
  18. **`deferContext` and `concludeTurn` are execution-local capabilities** on the run context; a composite forwards the nested conclusion "exactly like `additionalContexts`."
  19. **The result is materialized ONCE, immediately before `tools/result`** — a lossless-JSON snapshot and a deep freeze; a non-cloneable result is normalized into a safe final error.
  20. **A wrapper-authored result is re-validated** through the owning output contract ("a cached canonical result returned from a different dispatch" is revalidated).
- **Edge cases & failure handling:** a hostile thrown value whose inspection *and* coercion both throw becomes `Error: <unprintable thrown value>`; a lossy body value becomes `INVALID_TOOL_OUTPUT`; a post-execute decision replacing both `value` and `content` is a `TypeError`; replacing the value of a failed result is a `TypeError`; a value replacement whose owning tool disappeared fails as `UNKNOWN_TOOL`; `timeoutMs` must be positive and finite.
- **Surprising:** the registry keeps a **staged internal API** (`TOOL_RUNTIME_SCHEDULER`) so the agent-loop's parallel scheduler can run policy in order while bodies overlap — "this is not a plugin extension point."

### `packages/core/tools/src/schema.ts` — the `defineTool` DSL
- **Purpose:** The author-facing schema DSL, the compile-to-JSON-Schema step, the type inference, and the typed `defineTool` helper.
- **Key abstractions:** `ValueSchemaSpec` (string/number/integer/boolean/null/array/object/json/oneOf), `ParameterSchemaSpec` / `ParameterPropertySpec`, `InferValue` / `InferArgs`, `valueSchemaSpecToJsonSchema`, `parameterSchemaSpecToJsonSchema`, `validateArgs`, `ToolArgsError`, `DefineToolOptions`, `defineTool`.
- **Data flow:** the author DSL → an **iterative** compiler (a task stack, not recursion) → the enforced raw JSON Schema subset → `defineTool` closes over it and validates the model's arguments before the body.
- **Non-obvious design decisions:**
  1. **Openness is mandatory on an explicit object.** `additionalProperties` must be spelled `true` or `false` — "so a nested or output object never acquires an accidental JSON Schema default."
  2. **The parameter root is an implicit OPEN object**; requiredness is a per-property `required: true` annotation.
  3. **`InferValue` is bounded to 16 container levels** and then widens to `JsonValue` — an explicit compile-time budget.
  4. **The compiler is stack-safe**: a 5,000-deep `oneOf` chain compiles without the JavaScript call stack, and cyclic author schemas are rejected.
  5. **`__proto__` is installed with `Object.defineProperty`**, so a property literally named `__proto__` stays schema data.
  6. **The author DSL rejects unknown keys** — "is not supported by the value schema DSL" — rather than accepting them without enforcement.
  7. **The execution path validates strictly; the presentation path validates softly** (see `src/index.ts`).
  8. **`defineTool` compiles the schemas at definition time**, so a malformed schema fails at the author's call site, not at the model's first call.
- **Edge cases & failure handling:** a `required: false` annotation, a method-form member, a sparse `oneOf` array, a decorated `enum` array, a symbol key, a hidden (non-enumerable) key, and a `type`/`oneOf` conflict are all rejected.
- **Surprising:** `defineTool` also accepts `deferLoading: true` — a marker that "requests deferred definition loading and does not imply a `tool-addition` record."

### `packages/core/tools/src/json-schema.ts` — the enforced JSON Schema subset
- **Purpose:** The raw JSON Schema subset shared by tool outputs, generated PTC types, subagents and workflows, plus its validator.
- **Key abstractions:** `JsonSchemaNode`, `ObjectJsonSchema`, `JsonSchemaScalar`, `JsonSchemaType`, `JsonSchemaError`, `assertSupportedJsonSchema`, `assertObjectJsonSchema`, `validateJsonSchemaValue`, `isJsonSchemaRecord`, `isPlainJsonArray`, `isPlainJsonRecord`.
- **Data flow:** an untrusted raw schema → `assertSupportedJsonSchema` (collects **every** violation) → a trusted `JsonSchemaNode` → `validateJsonSchemaValue(schema, value, path)` → path-qualified violations.
- **Non-obvious design decisions:**
  1. **"Unsupported or misplaced keywords reject rather than being accepted without enforcement."** Every unsupported keyword is a violation, with the supported subset named in the message.
  2. **The subset is realm-agnostic.** `isPlainJsonRecord` / `isPlainJsonArray` verify an *intrinsic* prototype by checking the constructor's `name`, its `prototype` identity, and its native source text — so a record from another JavaScript realm (or a forged one) is rejected.
  3. **Both the schema walk and the value walk are stack-safe** (explicit task stacks and explicit frames) — a 5,000-deep union validates without recursion.
  4. **Every violation is reported, not just the first** — the error's `violations` array lists them in walk order.
  5. **Type-correct literal constraints**: `enum` values must match the node's type, and `const` must be one of `enum` when both are declared.
  6. **`oneOf` is EXACT-ONE**, and at least two branches are required.
  7. **`additionalProperties: false` rejects undeclared keys**; the open default is JSON Schema's.
  8. **A present `undefined` counts as missing** for a required property.
  9. **An unconstrained schema accepts only lossless JSON.**
- **Edge cases & failure handling:** a hostile getter inside a value returns a violation rather than throwing; a cyclic schema is rejected while *sibling reuse* is permitted; `assertNever` remains as a forged-schema backstop.
- **Surprising:** the module reimplements deep equality over the JSON domain rather than using `node:util`'s `isDeepStrictEqual` — so it stays browser-safe.

### `packages/core/tools/src/ptc.ts` — the `run_code` transport
- **Purpose:** The PTC-mode transport: a `run_code` program that calls the registry's tools through nested executions, scheduled under the native concurrency contract.
- **Key abstractions:** `RUN_CODE_NAME`, `PtcSdkLanguage`, `CodeRunFailedError`, `RunCodeBridgeOptions`, `createRunCodeTool`, `RunCodeFlavor` / `RUN_CODE_FLAVORS`.
- **Data flow:** the model calls `run_code` → the bridge resolves the working directory, the standing sandbox policy and (if asked) an approved escalation → the runtime runs the program → the program's SDK bindings dispatch nested calls through the registry's staged scheduler → each nested call logs a `tool/ptc-dispatch-start` / `tool/ptc-dispatch` pair → only the outer curated result enters model history.
- **Non-obvious design decisions:**
  1. **The `run_code` description and `code` parameter description are placeholders** in the definition; the language-aware getters installed later replace both "so the schema the MODEL sees matches the SDK section's language." Argument *validation* still keys off the static, language-independent spec.
  2. **The schema flavor MUST match the SDK's language** — "the model never receives a TypeScript schema beside a Python SDK (or vice versa)."
  3. **The per-run scheduler reproduces the native loop's SEQUENCING**: every ordered stage (start append, prepare = pre-execute/guards, finalize = post-execute, context deferral, settle append) runs inside ONE driver lane, so "ordered policy stages never overlap each other and only the around-dispatch/body stage runs concurrently."
  4. **An exclusive call holds its barrier through its COMMIT** (post-execute included) — "exactly like a native exclusive group."
  5. **Classification is re-read immediately before each start** ("a registry mutation while queued can flip a call exclusive"), matching the native scheduler's lazy reclassification.
  6. **The run-scoped abort fires when the run settles for ANY reason**, so an in-flight sub-dispatch is aborted rather than orphaned, and queued-unstarted dispatches are abandoned (and log nothing).
  7. **Only the outer `run_code` result has a hard size cap**; intermediate values are execution-local.
  8. **A `sandbox_permissions` escalation requires a non-empty `justification` and approval before the program starts**, and "the grant applies to that complete execution; standing Session policy and nested tools retain their own authority." "Programs are never replayed automatically: inspect earlier effects before explicitly retrying a denied program."
  9. **The bridge receives registry-private capabilities as closures** ("the `requireRuntime` idiom") so operations only the registry can mint stay off its public service API.
  10. **Nested call ids are `<parent>:ptc:<n>`**, numbered in submission order; "Consumers treat these ids as opaque."
- **Edge cases & failure handling:** a whitespace-only `description` is a structured `isError`; a missing runtime is a structured `isError`, not a crash; an agent-owned program is refused before dispatch when its directory owner is missing; a binding argument that is not lossless JSON dispatches nothing; a tool unregistered between binding enumeration and dispatch fails as `UNKNOWN_TOOL`.
- **Surprising:** the run_code output schema carries a `sandbox` object (`mode`, `denied`, `enforcement`) so the *model* can see that the file sandbox denied an operation and what the escalation route is.

### `packages/core/tools/src/ts-types.ts` — the TypeScript SDK projection
- **Purpose:** The pure projection from registered tool schemas to the TypeScript SDK text the model programs against (the `tools:sdk` prompt section).
- **Key abstractions:** `ToolSdkSchema` (the model-facing schema plus the canonical output schema), `jsonSchemaToTs`, `renderToolsSdk`.
- **Data flow:** the visible tools → `jsonSchemaToTs` per argument/output schema → `ToolArgsMap` / `ToolOutputMap` interfaces → `declare const tools: { … }` → the fixed instruction prose.
- **Non-obvious design decisions:**
  1. **Tools are declared in lexicographic order** and exotic names are quoted ("every name stays reachable, no aliasing").
  2. **A description's comment closer is escaped** so a schema description cannot terminate the generated JSDoc.
  3. **Rendering is stack-safe** (a 5,000-deep union renders in linear time).
  4. **The bash example is shown only when the declared binding actually accepts its arguments** — the SDK must not show a call the schema would reject.
  5. **The instructions are program-format aware** — a function-body runtime gets a `return` example, a REPL runtime a `console.log` example.
- **Edge cases & failure handling:** unsupported or hostile constructs degrade to `unknown`, never throw.
- **Surprising:** the generated SDK says explicitly "A declaration does not make its name a directly callable tool; only names supplied as separate tool schemas may be called directly."

### `packages/core/tools/src/py-types.ts` — the Python SDK projection
- **Purpose:** The Python flavour of the same projection.
- **Key abstractions:** `jsonSchemaToPy`, `renderToolsSdkPy`.
- **Data flow:** the same input → named `TypedDict` per object shape → `async def` methods per tool → the fixed instruction prose.
- **Non-obvious design decisions:**
  1. **Object-shaped arguments and outputs render as named `TypedDict`s, not `dict[str, Any]`** — "so the shape survives into the program under the mode that has nothing else to carry it."
  2. **The identifier predicate is XID-based, not ASCII** — "Python identifiers are not ASCII: `路径` is as legal a field name as `path`."
  3. **NFKC stability is a second, separate condition** — a name that normalizes (e.g. `ﬁeld`) "would be declared and reachable as `field`, so the SDK would advertise a key under a spelling the harness never accepts." Such names take the subscript path, which carries their exact bytes.
  4. **The predicate is deliberately stricter than `str.isidentifier()`**, which does not test NFKC stability.
  5. **Emitted class names are capped and de-duplicated** (a counter suffix, a base-length cap, an astral-safe truncation) so the generated text stays linear in schema depth.
  6. **Reserved words, underscore-leading names, name-mangled fields and `__debug__` degrade to the subscript / `dict[str, Any]` path** rather than emitting invalid Python.
  7. **Control characters, unpaired surrogates and quotes are escaped** so the generated source is encodable and the docstrings stay valid Python.
- **Edge cases & failure handling:** a deeply nested array schema is capped at CPython's bracket limit; a chain just under the cap stays exact; a deep `oneOf` renders in linear time.
- **Surprising:** the module documents the *exact* Unicode-version skew between the Node engine and CPython, and says "the skew is not symmetric" — a CPython older than the engine is the dangerous direction.

### `packages/core/tools/src/presentation.ts` — the render-intent vocabulary
- **Purpose:** The provider-neutral types a tool declares via `presentCall` / `presentResult` to say how one of its calls renders in a UI.
- **Key abstractions:** `ToolCallKind`, `FileLocation`, `FileDiff`, `ToolCallView` (`GenericCallView` | `TerminalCallView` | `DiffCallView`), `ToolResultView` (`GenericResultView` | `TerminalResultView` | `DiffResultView` | `SearchResultView` | `ReadResultView` | `WebResultView`), `ReadFileLine`, `SearchLineMatch`, `SearchFileMatches`, `WebSource`.
- **Data flow:** a tool returns a `card`-tagged view; a UI bridge maps it without special-casing tool names.
- **Non-obvious design decisions:**
  1. **Every view is `card`-tagged** so a UI switches on one discriminant.
  2. **A `tool-addition`/diff view's `oldText` is `null` for a create or an overwrite** — "a call-time presenter has no access to the file's prior content."
  3. **The search card carries `truncated` and `total`** so "a UI never presents a capped result as complete."
  4. **The read card's `lines`/`path`/`lang`/`totalLines` "cannot be reconstructed from the model-facing result text alone"** — the read tool projects them through `output.presentationMeta` (persisted with the session log) so a replay renders identically.
  5. **The web card's `kind` is the union's own discriminant, NOT a `ToolCallKind`** — the values deliberately match so a call and its result read as one category.
- **Edge cases & failure handling:** a UI without a capability falls back to the raw `tool/result` content.
- **Surprising:** the built-in Web Client does **not** consume these values at all — "It selects a renderer through `tool.call.toolview` and derives card props from raw call arguments, result content, failure state, and persisted metadata." The vocabulary is for Host-local consumers.

### `packages/core/tools/src/ptc-calls.ts` — PTC call lifetime under policy changes
- **Purpose:** Cancellation and settlement of complete PTC calls, including nested tools.
- **Key abstractions:** `PtcCalls` (`run(sessionId, signal, mode, run)`).
- **Data flow:** a `sandbox/mode` session event aborts every call whose recorded mode differs; `run()` awaits canceled predecessors' cleanup before resolving the authority and admitting a new call.
- **Non-obvious design decisions:**
  1. **"Keeps calls under a changed policy from overlapping their canceled predecessors."** A later call waits for the earlier one's *complete* cleanup.
  2. **The policy is committed immediately** but the call is aborted afterwards — the test pins the order: "commits policy immediately, cancels existing calls, and waits for their complete cleanup before reading the latest mode."
  3. **The mode is read AFTER the preceding cleanup** — so a call never runs under a mode it did not observe.
  4. **The call's signal is `AbortSignal.any([caller, controller])`**, so a policy change aborts it without detaching the caller's cancellation.
- **Edge cases & failure handling:** a failed call is released and same-policy calls may overlap; a caller cancellation while waiting for a canceled predecessor is honored; the registry refuses late admission after disposal.
- **Surprising:** the `sandbox/mode` listener is registered with `{ global: true }` — it must see *every* session's mode change, not just its own scope.

### `packages/core/tools/src/types.ts` — the PTC dispatch event vocabulary
- **Purpose:** The durable event vocabulary for nested PTC dispatches, shared with type-only consumers.
- **Key abstractions:** `PtcDispatchStartEventData`, `PtcDispatchEventData`, and the `tool/ptc-dispatch-start` / `tool/ptc-dispatch` session-event declarations.
- **Data flow:** the bridge appends a start event when the scheduler actually starts the call, and a settle event when it completes.
- **Non-obvious design decisions:**
  1. **The start event is appended when the scheduler starts the call, not at submission** — "so a start means the tool body pipeline was entered; a call abandoned in the queue logs nothing."
  2. **The arguments are JSON-normalized BEFORE dispatch**, "so this append can never fail on payload shape."
  3. **Both events are log-only**: `deriveMessages()` ignores them, "so sub-calls never re-enter model context; persistence and UIs get every call."
  4. **The settle event carries the sub-call's complete durable outcome in `tool/result`'s own vocabulary** — "so UIs and SDKs render a sub-call through the exact path used for a native call."
- **Edge cases & failure handling:** every started sub-call settles with exactly one settle event, abort included.
- **Surprising:** UIs pair the two events by `subCallId` and time them using the two events' `time` fields.

### `packages/core/tools/src/testing.ts` — the shared test fixture
- **Purpose:** `defineContentToolFixture` — a registry-ready tool whose canonical value IS its content array.
- **Key abstractions:** `defineContentToolFixture`, `ContentToolFixtureOptions`.
- **Data flow:** `defineTool` with an explicit JSON-array output contract and a `render` that returns the value.
- **Non-obvious design decisions:** the fixture **deliberately** uses its content blocks as the canonical value, and the JSDoc says so: "Product tools must declare domain-owned DTOs instead."
- **Edge cases & failure handling:** n/a.
- **Surprising:** the whole `agent-loop` test suite is written against this fixture — the loop's behaviour is pinned through a *deliberately unrealistic* tool contract.


### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/core/README.md` | The core *group map*. Tables the eight packages with their role and their `ctx` key (`ctx.sessions`, `ctx.systemPrompt`, `ctx.tools`, `ctx.agents`, `ctx.agentDefaultModel`, `ctx.agentLoop`; `scope` and `agent-tool-presentation` have **no ctx key**). Decides the layering: `scope` = shared primitive, `agent` = public `Agent` contract, `agent-loop` = swappable default implementation, `bundle/` = runnable compositions. |
| `packages/core/README.zh.md` | Chinese mirror of the core group map; heading parity 8/8 with matching en/zh hashes in `README.i18n.yaml`; the summary and package table were read and match the English. |
| `packages/core/agent-default-model/README.md` | Package contract. Decides: `provider`/`model` are required, `reasoningEffort` optional and *removable* by saving without it; `currentSelection()` returns a detached selection; "the service does not validate catalog membership"; **KV-cache note** — changing the default does not invalidate an existing session's established prefix because that session's request log already names a selection. |
| `packages/core/agent-default-model/README.zh.md` | Chinese mirror of the English README; heading parity 15/15 with matching hashes; the summary and use sections were read and match. |
| `packages/core/agent-default-model/locale/en.json` | UI locale stub — `meta.title = "agent-default-model"`. |
| `packages/core/agent-default-model/locale/zh.json` | UI locale stub — `meta.title = "默认模型"` plus a one-line description. |
| `packages/core/agent-default-model/package.json` | Manifest. `dependencies`: `schemastery`; `peerDependencies`: `dsh-agent`, `dsh-llm`, `dsh-boot/config-editor`, `dsh-settings`, `cordis` — the package deliberately depends on the **configuration editor** and the **settings** service, because its whole job is to write a profile override through them. |
| `packages/core/agent-default-model/tests/agent-default-model.spec.ts` | The default-model service: `currentSelection()` returns a detached `{ provider, model, reasoningEffort }` read live from the `Volatile` config fields; a selection without a reasoning effort reports `undefined`; `saveSelection()` with **no config editor is a no-op** (the context's model stays `'original'`); a save through the editor writes the three fields and `currentSelection()` reflects them; and the disposer removes the `ctx.agentDefaultModel` service. |
| `packages/core/agent-default-model/tsconfig.json` | Project references: vendored `cordis`/`schemastery`, `core/agent`, `llm/llm`, `boot/config-editor`, `settings/settings` — the same five the manifest names. |
| `packages/core/agent-default-model/tsdown.config.ts` | tsdown build: ESM/node/es2024, `dts: false`, `clean: false`. |
| `packages/core/agent-loop/README.md` | The package contract, and the single densest document in the shard. Decides: declarative `agents[]` start at boot; `maxParallelToolCalls` default 10 (`1` = serial); a fresh session mints `${id}-session-<uuid>` unless `sessionId` is set; `sessionId` and `resumeSessionId` are mutually exclusive; **exclusive tool calls are ordering barriers**; cancellation preserves already-delivered streamed text; "the request is `header.config`, `deriveMessages()`, and `header.tools`; it carries no `system` field"; the loop writes a full `request/header` for the first request, a *changed envelope* (config or tools — **the prompt is not part of the header**), an explicit message-series start, a request after a surface replacement or image-offload decision, and resume; the request **deep-freezes** each derived message identity on its first request; "no built-in turn budget"; "Config agents have no per-agent persona field or setup hook"; "Root shutdown persistence — shutting down the root context with an active Agent can leave its final `turn/end` in memory but absent from the persisted log." |
| `packages/core/agent-loop/README.zh.md` | Chinese mirror of the English README. Heading parity confirmed (23/23 headings, same order) and `README.i18n.yaml` carries matching per-section en/zh hashes; the first two sections were read and match the EN text. The decision content is identical to the EN file, so it is not re-listed separately. |
| `packages/core/agent-loop/locale/en.json` | UI locale stub — only `meta.title = "agent-loop"`. |
| `packages/core/agent-loop/locale/zh.json` | UI locale stub — `meta.title = "智能体运行循环"` plus a one-line description. |
| `packages/core/agent-loop/package.json` | Package manifest. `peerDependencies` on `dsh-agent`, `dsh-llm`, `dsh-scope`, `dsh-session`, `dsh-session-persistence`, `dsh-session-projection`, `dsh-system-prompt`, `dsh-tools` — i.e. the loop depends on every spine package by *peer* dependency, so the composition chooses versions. `dependencies`: `dsh-brand`, `dsh-util-values`, `schemastery`, `zod@4.4.3` (pinned exactly). |
| `packages/core/agent-loop/tsconfig.json` | Project references to the vendored `cordis`/`schemastery`/`cosmokit` plus the eight sibling core packages — the dependency graph is declared, not implied. |
| `packages/core/agent-loop/tsdown.config.ts` | tsdown build: ESM, node platform, es2024, `dts: false` (types come from a separate `tsc` pass into `lib/types`). |
| `packages/core/agent-loop/tests/agent.spec.ts` | The public `Agent` surface: `inject()` durably stages context without opening a turn; an unknown producer `source` is preserved verbatim; the exact `inserted`/`claimed`/`discarded` inbox events; `inject()` rejects a non-JSON-serializable payload **before** enqueueing (zero events appended); `steer()` while idle becomes a woken prompt turn; exactly one `running`→`idle` status pair per turn; `whenIdle()` resolves immediately when idle and waits when not; **a throwing `agent/status` listener is contained** and logged as `agent event "agent/status" listener threw`. |
| `packages/core/agent-loop/tests/agent-initiator.spec.ts` | Initiator-scope (AsyncLocalStorage) discipline: overlapping driver continuations stay bound to their exact agents; the initiator identity stays minimal while one explicit signal spans each turn seam; child setup runs under the parent boundary and the parent is restored while the child driver is active; agentless direct tools stay ambient-free and build trusted transport headers internally; the old driver is drained before ALS is disabled during an agent-service restart; ALS stays readable while root disposal drains sibling `AgentLoop` fibers. |
| `packages/core/agent-loop/tests/cancel.spec.ts` | The largest cancellation suite — every landing window of `cancel()`: an abort reason that acquired an own property JSON discards; a no-op cancel on an idle agent; `keepInbox` parking vs clearing; a wake latched in the abort-to-idle window and a wake latched deep into a slow abort convergence; a wake landing after disposal begins (not latched); cancellation from a synchronous `step/start` listener; cancellation during the *stopping* window; a cancel from a synchronous `agent/status(running)` listener; the first typed cause wins and a lifecycle teardown race does not overwrite it; a cancelled stream finalizes the streamed prefix (including reasoning-only and a half-streamed tool call); a retry retains the failed attempt while the final message embeds only its own stream. |
| `packages/core/agent-loop/tests/config-session-id.spec.ts` | Config-driven identity: launcher identities apply by configured `id` without touching unmatched entries; an empty exact id is rejected before publication; `sessionId` and `resumeSessionId` are mutually exclusive; duplicate exact ids are rejected **before** asynchronous startup; a materialized exact id is restored across an `AgentLoop`-only reload; a draining exact-id lifecycle is waited for; an exact-id reload can be cancelled while the prior lifecycle drains; startup failures are contained (with and without persistence) and **a startup whose `String()` coercion throws is still contained**; a fresh `${id}-session-<uuid>` per run is restart-safe; resuming a missing session logs a warning and does not crash; the failure report is suppressed once the loop is disposed. |
| `packages/core/agent-loop/tests/contract-regressions.spec.ts` | Boundary/identity/lifecycle regressions: adapter replay state is recorded with the assembled content; an abort during tool execution parks the finalized context until another wakeup; post-tool context is recorded when a later call aborts the batch; an empty admitted batch closes a turn without a step; injection deferral is limited to the current tool batch; `steer()` from an `agent/turn-stopping` listener continues the same turn; a throwing `agent/turn-stopping` listener ends the turn with an error and the loop survives; duplicate adapter registration is rejected; an agent without a model fails with a clear error (not `NO_ADAPTER` for "default"); the `agent/request` waterfall can supply the model; a forked agent continues turn numbers after the seed log; a finish-error stream chunk ends the turn as **error, not completed**; the `step/start` event is already in `snapshotEvents()` when its listener fires; a pre-commit `turn/start` rejection leaves no durable turn state; a `step/end` validation failure ends the turn with that error; a throwing `agent/error` listener still balances the turn; the loop records `tool/result` under the model `call.id` even when a post-execute listener replaces the content; disposal/cancel during system-prompt assembly closes a **no-step** turn and leaks no LLM call. |
| `packages/core/agent-loop/tests/coverage-edges.spec.ts` | Edge coverage: non-JSON tool arguments pass through as text; empty tool arguments become `{}`; non-`Error` throws from pre-commit validation and from the `agent/request` waterfall are preserved; a coded plugin error renders durably; dispose during streaming yields reason `disposed`; a tool `HarnessError` is forwarded onto the `tool/result` event; a retry action returned after the turn aborted is ignored; a mid-stream throw with no adapter facts is rethrown; a rejected `step/end` still publishes the terminal status; a `presentationMeta` payload is recorded on `tool/result`; a rejected `turn/end` append is contained (warn + `agent/error`, no retry); a completed recovery returning no action leaves the turn terminal; an unrenderable failure drops the rendered message; a direct turn invocation without a driver reservation is rejected; a rejected next step closes the turn as `blocked`. |
| `packages/core/agent-loop/tests/fixtures/serial-created.mjs` | A plugin fixture (plain `.mjs`) that installs **ordered** `agent/created` listeners: the first awaits a macrotask then injects context, the second throws if the listeners ran out of order. Shared by the TypeScript and Python SDK snapshots. |
| `packages/core/agent-loop/tests/inbox.spec.ts` | The durable inbox: two inbox instances read the *same* shared projection; invalid durable coordinates and duplicate identities are rejected with the session seq in the message; a forked session inherits the parent's pending messages; the projection cell is updated **before** session observers run; `replace()` works by identity across both lists; splice coordinates are normalized (`NaN`→0, negative→from-end, over-long delete→clamped) while duplicates throw; `clear()` empties `next-step` before `next-turn` and both splices carry `outcome: 'canceled'`. |
| `packages/core/agent-loop/tests/interception.spec.ts` | The hooks taxonomy end to end: `agent/pre-step` enter/reject, request coordinates, frozen input identity, prompt rewriting before it is recorded, additional separately-sourced messages, no extra step when a completed turn rewrites pending input to empty, staging `inject`/`steer` during pre-step, preserving input staged *after* the blocked batch was claimed, leaving the inbox unchanged when the durable append fails, and a throwing pre-step listener reporting the driver error while retaining adjacent work. Also `agent/created` (once, source `startup`, before the first turn; a creation listener can inject context the first request sees; a throwing creation listener rolls the agent back), tool `additionalContexts` buffering **after** all `tool/result`s, the `tools/pre-execute` deny gate end to end, and an HMR-safety check that disposing the plugin fiber removes all four listeners. |
| `packages/core/agent-loop/tests/loop.spec.ts` | The main behavioural suite (~70 cases): one dense live attempt committed as one v2 message with the exact embedded stream; the live row is abandoned when the durable settlement is rejected; a failed attempt is settled before retrying with a new attempt; no `end` frame when prepared dispatch throws before start; the stream failure is preserved when the settlement is also rejected; `maxTokens` validation (0, -1, 1.5, NaN, MAX_SAFE_INTEGER+1) and seeding; reasoning-effort seeding and config validation; concurrent maintenance is rejected; a latched maintenance wake replays at convergence; the simple turn's ordered events; tool round-trip; the persona rendering order (harness identity → persona → tool guidance) with `{{variables}}` resolved; the session directory is kept out of system-prompt variables; a strict-variable render failure errors the turn and the loop keeps serving turns; an empty assembly sends no system message; runtime-context materialization at the history tail; steering between steps; `inject()` deferral during tool execution; non-JSON context rejected before the FIFO; `agent/turn-stopping` steering; a tool that concludes the turn; `agent/request` model switching is logged; `agent/pre-step` fires once per proposed step before the step opens; `cancel()` mid-stream; `max-tokens` as the turn-end reason, **sticky across the turn but not across turns**; tool calls are not dispatched from a max-tokens-truncated step; empty completion anchors; truncated tool calls dropped but safe content kept; a reentrant send during durable inbox publication is contained; model errors are normalized onto the turn boundary; disposing the loop fiber mid-turn stops the loop (HMR safety); config agents start at startup; `cwd` attaches to the fresh session header; **a session log replays into an identical derived history**. |
| `packages/core/agent-loop/tests/mock-adapter.ts` | The shared mock LLM adapter. `textResponse`, `maxTokensResponse` (a `max-tokens` finish), `toolCallResponse` (a tool call split across two `tool-call-delta` chunks), and a `MockAdapter` driven by a **script** of responses. The script may be `'hang'` (stream one chunk then wait for abort), `'hang-slow'` (50 ms to notice the abort — a stand-in for slow real teardown), or `{ hangAfter }`. Every request is recorded for assertions. |
| `packages/core/agent-loop/tests/properties.spec.ts` | Property-based (`fast-check`) scheduling properties. Invariants: every sent message appears **exactly once** in the log; turn numbers strictly increase; the status trace is a legal `idle→running→idle` machine. Three properties: a synchronous burst gives every message its own turn; sequential sends each get their own turn; mixed settled/same-tick sends preserve one turn per message. Deliberately **event-driven** (the `agent/status` settle signal, no wall-clock sleeps) so "a flake is a finding, not timing noise". |
| `packages/core/agent-loop/tests/request-cache.e2e.ts` | A **key-gated** live-provider test (`describe.skipIf(!process.env.DEEPSEEK_API_KEY)`). Proves that a multi-step tool turn plus a follow-up against the real DeepSeek API reports `cacheReadTokens > 0` on every request after the first — the provider's `prompt_cache_hit_tokens` mapped by the adapter. The persona is long enough to span the provider's 64-token cache-block granularity "from the very first request", and the final answer is checked for the tool's returned value. |
| `packages/core/agent-loop/tests/request-error.spec.ts` | The `agent/request-error` recovery waterfall: a **middleware** failure is *not* offered to request recovery (and no request is dispatched); each failed request may return `{ kind: 'retry' }` before its turn closes (two failures, one turn, one `request/header` with reason `initial`); cancellation wins over a retry action; a recovery listener that throws is not a retry. |
| `packages/core/agent-loop/tests/request-freeze.spec.ts` | Request immutability. Restored identities are **adopted** (the same object identity reaches the request) and frozen at dispatch, while the *containing event wrappers stay mutable*; a failed freeze traversal is retried on the next request; each local header is frozen with an adapter present and without one (the `stop` array cannot be mutated — a `TypeError`); the request is frozen but its `signal` is **not**, so cancellation still works. |
| `packages/core/agent-loop/tests/request-reconstruction.spec.ts` | The reconstructability theorem: every request is a pure function of the session log. Each step request append-extends the previous one; a later turn append-extends too; a new request series starts only when the admitted step asks for one; adapter defaults are logged and per-turn effort changes are supported; an explicit `maxTokens` cap survives a provider switch; the exact-model resolution, request logging and dispatch stay on one adapter registration; a compaction replace rewrites the resend and the log explains it; a system-prompt change replaces surface node 0 and starts a new series, or appends on an in-history route; a tool-schema change re-baselines node 0 with the changed header; a mutation attempt on the frozen request content throws into the step ("loud, not silent"); a fresh loop over a seeded log anchors with a resume snapshot; **"THEOREM: every request rebuilds byte-equal from the session log alone"**; plus `request/context` capacity records (recorded once, re-recorded when the route changes, deduplicated, cleared when the next route advertises none). |
| `packages/core/agent-loop/tests/resource-lifecycle.spec.ts` | Resource retention: with 0/1/2 failed teardowns, the Agent's resources (scope, inbox and turnBoundary projections) are retained until all work exits, the abort handler runs **once**, the scope is disposed, and every failed teardown rejects with its own error. A loop- or root-unload while a background child agent is stopping cancels the child inside `agent/request`, ends the child's turn as `aborted`, clears both inbox lists as `canceled` splices, and — for the loop case — the persisted JSONL log matches the in-memory events exactly. A scope failure is aggregated with the cancel failure. |
| `packages/core/agent-loop/tests/resume.spec.ts` | The session-persistence contract of the factory: a non-`Error` resume publication failure is normalized for rollback and the write handle released; `createAgent` uses the caller's `sessionId` (not `${id}-session`) and rejects a duplicate identity without orphaning a session; a created agent stores its seed and live turn durably through its handle; a rejecting final writer close releases the registries then rejects disposal; a machine-teardown failure is **combined with** a close failure into one rejection; a stored-session create failure rolls the fresh identity back; a seed append failure closes the fresh write handle; a setup failure before publication leaves **no stored residue — the id creates again**; rollback swallows a rejecting handle close after a prepare failure; **resume cannot crash-repair a turn owned by a live agent**; resume appends `interrupted-turn` closers durably (an interrupted tool call closes with `tool/result`, `step/end`, `turn/end`); a resume over a **torn physical tail continues from the committed prefix**; a resume of a forked session preserves lineage, seed boundary and delegation depth in the header; resume and fork both continue persisted history after a live scheduler failure; a resume reloads the persisted session with continuing history and turn numbering and no duplicate seqs; resume rejects when session persistence is not configured. Plus the cancellation edges: a pre-aborted create is rejected (including a non-`Error` reason), a non-`Error` abort during setup is wrapped, an abort between crash repair and publication refuses the resume, an abandoned backend create's late handle is closed, a never-settling persistence open is aborted by owner unload and blocks late publication, and a configured-resume failure landing after teardown is suppressed. |
| `packages/core/agent-loop/tests/runtime-context.spec.ts` | `RuntimeContextProjection` restores the latest **visible** owned snapshot and ignores other sessions; a compacted (replaced) snapshot is not retained; a new snapshot is produced only when the text differs and carries its contributing `sections`. |
| `packages/core/agent-loop/tests/scope-lifecycle.spec.ts` | The scope/registry lifecycle in detail: serial creation is awaited before caller readiness; both entries and scoped effects are retained until an async creation listener settles on owner unload; rollback of both registries and the scope when async creation fails; an already-aborted creation signal is rejected before publication; a reentrant abort during scope preparation joins cleanup; non-`Error` create failures are normalized for rollback while the original value is rethrown; `agent.ctx` is tagged with the Agent scope key; scoped registrations live in the agent world and die with the agent; the inbox projection is owned until `AgentLoop` unloads; `agent.ctx` listeners hear only their own agent; setup runs in the "guaranteed slot" (scoped world complete before `agent/created` and the first assembly); a same-id concurrent creation is arbitrated by the final `enter` and the loser is rolled back; the signal aborts *pending setup* but not a returned live handle; owner unload aborts a pending setup and publishes nothing; the factory is a structural co-owner of every live programmatic agent; reentrant `session/created`/`agent/created` teardowns keep both entries and the scope live; a rejecting setup publishes nothing; an exotic durable seed is rejected before publication; a throwing `session/created` listener disposes the scope; registrations through a disposed agent ctx throw `INACTIVE_EFFECT`; the documented teardown order is *unregistration AFTER the drain, before detach*; `handle.dispose()` during owner unload still awaits true quiescence; ids reopen only after the prior private scope finishes quiescing. |
| `packages/core/agent-loop/tests/serial-listener-review.spec.ts` | Serial creation-listener integrations: creation rolls back when a file-reference prompt installation fails (a name collision) and when a shared preset tool installation fails; **due plugin work starts only after every creation listener finishes** — a producer that resolves the agent during `agent/created` and follows up does not open a turn until the listeners are released. |
| `packages/core/agent-loop/tests/settings.spec.ts` | The `agent-loop` settings section: `maxParallelToolCalls` can be updated live (1 is accepted, 0 is rejected) without changing the composed agents, the live config fiber, or the running loop. |
| `packages/core/agent-loop/tests/shutdown-drain.spec.ts` | Root-fiber shutdown drains buffered session events durably — proven for **both mount orders** (backend-first and loop-first), with no explicit flush and no agent dispose before the root teardown. |
| `packages/core/agent-loop/tests/system-prompt-admission.spec.ts` | Prepared-route prompt admission: with `addition-only` and `in-history` tool updates, earlier input is preserved and additions deferred; consolidation when the route cannot append prompts; a series start rebuilds the prompt and the declarations; retained declarations are rebuilt after a same-name definition changes; every active prompt version is cleared on capable and plain routes across repeated requests and resume; surviving prompt versions are normalized with unchanged text at a series start; compaction retries reconcile without replaying admission; capable history is normalized on a plain route; a capable route appends on the first request after a plain route; restored history resumes with the first pre-step replacement; restored history is normalized under the resumed instance route; cancellation during `request` or `prepare` yields a balanced empty step before input admission; generic config changes and concurrent selection stay on the same prepared route. |
| `packages/core/agent-loop/tests/system-prompt-projection.spec.ts` | `SystemPromptProjection` semantics: multiblock and non-text system nodes are **cleared rather than treated as dormant**; the first rendered prompt appends and an unchanged one is skipped; a changed prompt replaces the retained node; an emptied prompt keeps an empty head that projects to no wire message; an empty head is reserved *before* user history; the surviving node is read from the log (including one restored as "no prompt"); a shadowed non-head node causes a fresh append; an in-history route appends the changed prompt after the cached history; a series start re-baselines node 0 and empties later active nodes; clearing empties **all** active nodes. |
| `packages/core/agent-loop/tests/tool-calls.spec.ts` | The scheduler: parallel-safe siblings run concurrently; an exclusive call between two parallel-safe calls forms a barrier (3 groups); pending calls are reclassified after a barrier replaces their tool; a result observer can make the next call exclusive and stop replenishment; `tool/result` commits in model order even when a later call settles first; derived history pairs calls in model order regardless of log interleaving; an invalid `maxParallelToolCalls` is rejected at plugin load; the rolling pool honours the cap and `1` is fully serial; the cap applies to every factory-created agent; `tools/pre-execute`/`post-execute` observe model call order; additional contexts are injected in model order, not settlement order; denials and errors are ordered without dispatch; an already-aborted signal starts no calls; an abort during ordered pre-execute skips dispatch; abort stops replenishment, commits started results and parks accepted contexts; no exclusive barrier runs after a parallel group aborts; a failure in `execution-mode`/`prepare`/`finalize` pairs the outstanding requests and preserves committed results; the scheduler error survives a failure while recording recovery results; pending requests are isolated from child agents and other sessions; new dispatches stop and started bodies drain before the first failure surfaces; and a PTC-mode model-direct native tool call is denied with `UNKNOWN_TOOL`. |
| `packages/core/agent-loop/tests/tool-order.spec.ts` | Canonical tool order: the logged `request/header` and the dispatched request carry the assembly's canonical order (lexicographic by default), **not** the registration order ("registration order is a concurrent loading artifact and must not leak downstream"); a configured `toolOrder` (with a `TOOL_ORDER_REST` remainder) is honoured; a `toolOrder` naming an unregistered tool closes a no-step turn with no request and no header. |
| `packages/core/agent-loop/tests/tool-updates.spec.ts` | Tool-set changes are logged as `developer/message` events: additions bind to the new header's seq, removals do not; the runtime receives `session.toolHistory()`; an in-history route sends deferred declarations (`deferLoading: true`) and the recorded update blocks. |
| `packages/core/agent-tool-presentation/README.md` | Decides: `mode` is **required** (a preset without the row already gets the deployment default); `native` presents every visible schema, `ptc` presents only `run_code` + a generated SDK; **selecting `ptc` requires a composed PTC runtime and a deployment without one refuses the preset at mount time** — "so the failure lands where the operator can act instead of at the session's first prompt"; **one agent declares one presentation — a second declaration is refused, not merged** ("two answers to 'which form does the model see' is a contradiction, not an override"); the tool registry stays host-plane because "a service only moves down when all of its consumers move with it." |
| `packages/core/agent-tool-presentation/README.zh.md` | Chinese mirror of the English README; heading parity 15/15 and matching en/zh hashes in `README.i18n.yaml`; the summary and use sections were read and match. |
| `packages/core/agent-tool-presentation/locale/en.json` | UI locale stub — `meta.title = "agent-tool-presentation"`. |
| `packages/core/agent-tool-presentation/locale/zh.json` | UI locale stub — `meta.title = "工具调用方式"` plus a one-line description. |
| `packages/core/agent-tool-presentation/package.json` | Manifest. `dependencies`: only `schemastery`; `peerDependencies`: `dsh-tools` + `cordis` — the package depends on the *tools* service, not on the agent loop, so it is usable from any preset. |
| `packages/core/agent-tool-presentation/tsconfig.json` | Project references: vendored `cosmokit`/`cordis`/`schemastery` + `core/tools`. |
| `packages/core/agent-tool-presentation/tests/agent-tool-presentation.spec.ts` | The row's three promises: an unsupported mode is rejected by the schema; `inject` is exactly `['tools']` (a native row must mount where no runtime is composed); the choice reaches **this** agent and no other (a PTC agent sees only `run_code` + a `tools:sdk` section naming the real tool, a native agent sees `echo`); **the presentation is restored to the deployment default when the agent unloads** (HMR safety); a PTC row against a deployment with no runtime stays *pending* (not applied) and the preset registry is the thing that reports it; the row applies once the runtime arrives; a mode is required rather than defaulted. |
| `packages/core/agent/README.md` | The public `Agent` contract. Decides: `ctx.agents` is **inert until a driver registers a factory**; `create()`/`resume()` return an `AgentHandle` — "the only object that can tear that agent down"; `followup()` queues a next-turn prompt, `steer()` submits next-step input, `inject()` adds model-facing context *without* waking the driver, `cancel(cause)` aborts and (unless `keepInbox`) clears pending work; `setup(agentCtx, agent)` composes the agent's scoped world **before** it is published — "Setup composes, it never drive[s]"; `agent/pre-step` can reject or replace a step's messages, `agent/request-error` can retry a failed request, `agent/turn-stopping` can steer to keep a turn open; the assistant-stream event is "presentation data rather than the replay source"; **initiator attribution is process-local and must be carried explicitly across workers, processes, durable queues, and restarts**; `cancel()` clears the inbox by default and there is **no step-only abort**; "Each additional `UserMessage` carries exactly one `MessageSource`." |
| `packages/core/agent/README.zh.md` | Chinese mirror of the English README; heading parity 22/22 with matching hashes; the summary and use sections were read and match. |
| `packages/core/agent/locale/en.json` | UI locale stub — `meta.title = "agent"`. |
| `packages/core/agent/locale/zh.json` | UI locale stub — `meta.title = "智能体管理"` plus a one-line description. |
| `packages/core/agent/package.json` | Manifest. Note the **optional peer dependency** on `dsh-workspace` (`peerDependenciesMeta: { "dsh-workspace": { optional: true } }`) — the archive-admission seam is optional, so the package works without the workspace registry. It also exports a `./types` subpath (the type-only surface) alongside `.` and `./src/*`. |
| `packages/core/agent/tsconfig.json` | Project references: `core/scope`, `llm/llm`, `core/session`, `session/session-projection`, `core/system-prompt`, `typert/protocol`, `workspace/workspace`. |
| `packages/core/agent/tsdown.config.ts` | tsdown build: ESM/node/es2024, `dts: false`. |
| `packages/core/agent/tests/agent.spec.ts` | The registry: the Agent lookup and scoped Context providers are contributed while Typert is live (and withdrawn with it); exact entries register, emit `created`/`disposed`, and unregister on owner disposal; a duplicate id is rejected; an agent whose registry and session identities differ is rejected; runtime creator ownership is tracked separately from registry order (`list` vs `roots` vs `isOwnedBy`); a throwing creation listener rolls the entry back **and pairs the partially delivered creation with a disposal**; an async creation rejection rolls back and every disposal-listener failure is contained with two distinct warnings; creation listeners are awaited one at a time before the next and before registration completes; `enter()`/`announce()` are separable, a stale or idempotent detach cannot remove a replacement, and announcing a non-live agent throws; a detach requested by a creation listener is deferred until that dispatch unwinds. Plus `agentEvents()`: each synchronous throw and returned-promise rejection is contained and logged; serial dispatch carries the fused subject; **the injected subject wins over a payload that carries a conflicting `agent` field**; the cancellation cause is a closed typed union at the Agent seam. Plus the factory seam: a factory is required and delegated through the *calling* context; the runtime parent travels in `options.parentAgent`; a second factory is rejected and the slot is cleared with its owner (HMR); an already-traced Service factory is canonicalized before it is traced for the caller. |
| `packages/core/agent/tests/agent-initiator.spec.ts` | The initiator scope: an absent initiator is reported and a required one throws; exact synchronous and Promise return identities are preserved across `await`; a **branded Promise with an overridden `then`** is tracked without calling it; a Promise whose `@@species` throws is preserved; overlapping initiators are isolated; nested and explicitly cleared boundaries restore the parent; the parent is restored after a synchronous throw and after a rejection; teardown stops new boundaries, drains active Promises, and invalidates retained references; a **cross-realm** Promise (from `node:vm`) is drained; the service does not self-deadlock when a boundary returns its own disposal, nor when a nested boundary returns an ancestor's disposal; an asynchronous teardown initiator is excluded from its own drain while unrelated boundaries still drain. |
| `packages/core/agent/tests/archive-admission.spec.ts` | The Workspace archive seam: the `turn` family is reported **only** while the Session's own Agent is running, and it is prepended ahead of other providers; a Session with no live Agent reports nothing; `workspace/session-stop` cancels a running turn with the **user cause and without `keepInbox`** and leaves an idle agent alone; the family stops answering once the registry fiber is disposed. |
| `packages/core/agent/tests/consumed-work.spec.ts` | `foldConsumedWork`: nothing is reported for a log that consumed no work; the latest turn that entered a model step is reported; a turn that claimed its input and then failed or was stopped before any step is reported; turns that stopped/failed/were rejected **without taking any input** are ignored; a pre-step rejection's `blocked` end accounts for the claimed input; a claim its own turn emptied does not count; a claim with no open turn is credited to no turn; work cancelled out of the inbox after the last accounting turn is reported as `droppedUnrun`; a **replacement** is not a drop; a later accounting turn absorbs an earlier drop. |
| `packages/core/agent/tests/model-selection.spec.ts` | `installModelSelection`: prompt variables and request routing are snapshotted **together** (a concurrent switch lands on a later step); the disposer removes all three listeners; a same-provider and a cross-provider route change each announce `[model changed: …]`; an initial route, a same route, an effort-only change, a rejected step, an aborted step and a disposed installation add **no** notice; empty no-call decisions are preserved while an empty *tool continuation* does announce. |
| `packages/core/agent/tests/verify-export-jsdoc.spec.ts` | The **negative-path** suite for the repo-wide exported-API JSDoc gate (`scripts/verify-export-jsdoc.ts`). Pins: packages without `src/*` exports are limited to declarations reachable from their entrypoints; a fully documented API passes; an undocumented function, a missing `@param`/`@returns`, an inferred return type, a tags-only JSDoc, a stale `@param` and a binding-pattern parameter are all flagged; a `this` receiver annotation is exempt from `@param`; `@returns` is waived for a declarator-annotated const but not an unannotated one; interfaces/type aliases/enums need description prose; `declare module` augmentation bodies are skipped (the cordis gate owns them); `export { … }` lists resolve to the local declaration; a never-exported sibling is not API; a default-export identifier is scoped to its own declarator; a re-exported module is reported once at its defining file; overload implementations are exempt when the signatures are documented; undocumented class members, properties and accessors are flagged while heritage-declared members, private members and constructors are exempt; plugin-protocol statics are exempt but other statics are not; a set accessor is covered by the getter's doc; namespaces recurse with qualified names; the checker **fails closed** on a non-identifier default export, a hybrid callable type literal, and an export-equals assignment; heritage refinement requires `@param` for parameters the base never names and revives the `@returns` duty when an override grows a concrete result over a void base. |
| `packages/core/scope/README.md` | The primitive's contract. Decides: "Child scopes inherit ancestor contributions, with the nearest definition taking precedence, while ancestor scopes can observe descendant activity; neither relationship works in reverse"; disposing a scope removes everything owned by it; `scopeTarget(base, key)` builds a routing-only carrier; the registry layer primitives are `ScopedLayers`, `NamedEntries`, `AnonymousEntries`; **only scope-aware APIs isolate state** — "an arbitrary Cordis service remains context-global merely because it is called through a scoped context"; a context carries **one nearest scope key**; **service reachability comes from the scope minter**, so "a broader minter cannot later be narrowed by the holder". |
| `packages/core/scope/README.zh.md` | Chinese mirror of the English README; heading parity 15/15 with matching hashes; the summary and use sections were read and match. |
| `packages/core/scope/package.json` | Manifest. The only peer dependency is `cordis` — the package is **dependency-free** apart from the plugin framework, which is what lets it sit under both the agent loop and the presets. |
| `packages/core/scope/tsconfig.json` | Project references: vendored `cosmokit` + `cordis` only. |
| `packages/core/scope/tsdown.config.ts` | tsdown build: ESM/node/es2024, `dts: false`. |
| `packages/core/scope/tests/scope.spec.ts` | The scope contract: contexts and derived contexts are tagged with the nearest key; a scope is usable **synchronously before the backing fiber activates**; repeat and raw-disposer-first disposal share one quiescence; the exact raw disposer nests the teardown in the documented order (`inner`, `scope`, `outer`); scoped listeners are routed by key while untagged listeners stay global; the base Cordis filter and its receiver are preserved; `{ global: true }` listeners keep global semantics; the carrier is an opaque brand that exposes none of the subject's properties; the parent chain links at mint, walks to the root and rejects cycles; re-linking is possible **only** through the binding the original binder holds; and **an ancestor-tagged listener is admitted for a descendant dispatch but never the reverse**. |
| `packages/core/scope/tests/store.spec.ts` | The store contract: `NamedEntries` owns duplicate diagnostics, insertion order, live iteration and an **exact idempotent undo**; a drained table starts a fresh iterator generation; `AnonymousEntries` keeps equal values independent; `ScopedLayers` constructs the global layer eagerly while reads stay non-creating; the same scoped context determines both visibility and ownership; a layer is reclaimed only when its whole aggregate is empty; action, notification, undo and disposal notification run in that order; the exact context effect disposer is returned; a failed factory and a failed action clean up without discarding an existing layer; and a notification that throws **rolls the insertion back**. |
| `packages/core/session/README.md` | The densest contract in the shard. Decides: "Model-visible means logged"; append "snapshots and freezes the payload, validates it as lossless JSON, and notifies observers"; `deriveMessages()` "projects the log into the `Message[]` the model sees, incrementally and cached"; a replacement is exactly `{ op: 'replace', startSeq, endSeq }` with inclusive endpoints in *current surface order*; **`eventAt()`, `snapshotEvents()` and `ownEvents()` are deprecated** ("new production calls are prohibited"); the two numeric position types; the **plugin-record** discipline (`plugin:<owner>/<record>`, `ignorable: true`, "a build that does not recognize one retains and skips it on read", "Records never enter the model-visible surface"); `ctx.sessions.fork(source, boundary?, childSessionId?)` and `buildForkSeed`; `ctx.sessions.flush(session)` as the awaited durability checkpoint ("A producer that needs an immediate durability barrier awaits it instead of assuming the write-behind drained"); the **request-header** record with reasons `initial` / `resume` / `change` / `series`; the shared `ToolCallRecovery`; and the `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` model-visible wording. |
| `packages/core/session/README.zh.md` | Chinese mirror of the English README; heading parity 25/25 with matching hashes; the summary and use sections were read and match. |
| `packages/core/session/locale/en.json` | UI locale stub — `meta.title = "session"`. |
| `packages/core/session/locale/zh.json` | UI locale stub — `meta.title = "会话记录"` plus a one-line description. |
| `packages/core/session/package.json` | Manifest with **four** subpath exports: `.` (the service), `./types` (the type-only surface), `./fork` (the seed builder) and `./surface` (the browser-safe surface layer). The `./surface` subpath exists precisely so a web client can consume the surface without pulling `node:` imports. |
| `packages/core/session/tsconfig.json` | Project references: vendored `cosmokit`/`cordis`, `util/brand`, `util/values`, `llm/llm`, `core/scope`, `typert/protocol`. |
| `packages/core/session/tsdown.config.ts` | tsdown build: ESM/node/es2024, `dts: false`. |
| `packages/core/session/tests/canonical-envelopes.spec.ts` | The canonical payload contract: a restored system prompt needs `system-prompt` producer attribution; a table of invalid payloads is each rejected with a *located* error; absent optional fields, nonempty fields and optional failure identity are accepted; nested header/source/data extras are preserved without normalization; **any own `header.system` is rejected even when its value is `undefined`**; an assistant message is adopted and its identified message frozen; a non-object restored request config is rejected; the frozen request-header cache updates only for accepted snapshots; both `detached` and `shared-frozen` prepare owned restored events without publication; a rejected append or seed publishes nothing and changes no derived state; malformed restored envelopes are reported *without a TypeError*; non-canonical replace keys are rejected; surface intent is required and assistant source-event references are forbidden in the types; an unknown ignorable event keeps opaque metadata without deriving a message; a *known* log-only event is rejected even when marked ignorable; a head replacement must be a `system/message` over exactly node 0. |
| `packages/core/session/tests/derived-cache.spec.ts` | The derived-cache contract against a **scratch oracle**: the cache stays deep-equal to a from-scratch replay derivation as the log grows; it rebuilds on a surface replace and still matches; a fresh array is returned per call so a later append never grows a held snapshot (while the message objects are shared and frozen); the per-event projection matches the full derivation; unchanged content reuses the logged event's already-frozen content; and boundaries and an empty assistant message project to `null`. |
| `packages/core/session/tests/developer-header.spec.ts` | Tool additions bind to **one historical request header** across compound changes, replacement, restore and fork; a non-header or non-earlier reference is refused before the append (the log is unchanged); a missing or ambiguous historical tool name is refused; an addition bound to a tool-less header is refused; `headerSeq` is required *exactly* when additions are present and inline definitions are rejected; an incomplete referenced definition in imported history is refused; and the same binding check applies to imported events and to a full-log surface fold. |
| `packages/core/session/tests/fork.spec.ts` | `SessionStore.fork`: an empty live session forks as an empty child with lineage metadata; the latest completed boundary is the default; stable log-only events appended after a closed turn are included; an earlier boundary can be forked even with an open tail; every `turn/end` reason is accepted as a boundary; a bracket inherited from a still-running parent is marked; invalid boundaries, an unknown source id, a detached non-live Session, a stale Session whose id is live on another instance, and a duplicate child id are all rejected with typed errors (and the duplicate id is rejected *before* the boundary is validated). Inside an open turn: an empty open turn closes with a synthetic `turn/end {forked}`; only the turn closes when the cut lands on a closed step boundary; an assistant call cut before its `tool/call` gets a forked not-started error; a dispatched call cut before its result gets an unknown-outcome error citing the `tool/call`; a failed assistant attempt is omitted from derived history; a closed step with an unanswered call is preserved; and a plugin bracket left open at the cut is left untouched ("log-only locks belong to their owner"). Around a surface replacement: the original message is derived for a cut before the replacement and the compacted surface for a cut after it. |
| `packages/core/session/tests/gen-persistence-catalog.spec.ts` | Negative-path tests for the **persistence-catalog generator**. Pins: a `@messageProjection` declaration generates the required interpreter set; a top-level `SessionEventMap` outside the owning package is a hard error; a non-exported top-level interface is a hard error; two homes for the owning interface is a hard error ("the owning vocabulary has exactly one home"); an `extends` clause is a hard error ("inherited keys would join `keyof SessionEventMap` without a catalog row"); a multi-line payload collapses to a one-line fragment; a member with no description prose, an `@mode` tag, a method-form member, a member with no payload type, a non-literal name, a `plugin:`-namespaced type and a duplicate declaration are all hard errors; **violations aggregate into one error instead of failing fast**; the envelope declarations are extracted with their complete JSDoc in canonical order; and the renderer badges union members surface and everything else log-only. |
| `packages/core/session/tests/json.spec.ts` | The lossless-JSON primitives the session depends on: the complete scalar vocabulary is copied and every lossy scalar (`-0`, `NaN`, `Infinity`, `BigInt`) is rejected; dense arrays and plain or null-prototype objects are detached recursively; **intrinsic plain containers from another JavaScript realm are accepted** (including a WebKit native constructor formatting difference); each object value and array slot is read **once**; deeply nested valid JSON is accepted **without using the JavaScript call stack**; exotic containers, sparse/decorated arrays, cycles and invalid children are rejected; a literal `__proto__` key is preserved without changing the prototype; and a throwing getter is propagated *after* being read once. |
| `packages/core/session/tests/message-projections.spec.ts` | Plugin-owned message projections: an event that *requires* an interpreter is refused when none is supplied (at append, at fold and at construction); a generic decision is applied **atomically** and replays through detached folds; registration is by fiber and a duplicate is refused; after the owning fiber unloads, **every cached or pending decision refuses to read** ("was removed or replaced") — including live, forked and restored sessions; a supplied interpreter applies to a loaded window with absolute sequences; and an interpreter is **not retained for a candidate that never committed**. |
| `packages/core/session/tests/plugin-records.spec.ts` | Plugin records: a record is committed as an `ignorable` event outside the model-visible surface and its payload is snapshotted (mutating the caller's object afterwards changes nothing); `pluginRecordOf` reads records back and leaves every other event unread — **including a known event marked ignorable**; a typed interface payload is snapshotted with readonly messages; eight malformed record names are rejected without changing the log; a non-lossless payload is rejected; a record reaches `session/event` observers and a **reentrant record is contained**; and records survive a snapshot restore, a storage reopen and a fork. |
| `packages/core/session/tests/plugin-records.type-test.ts` | A **compile-time** type test (no execution): an undeclared record name has no writable payload type; the payload must match the selected record's declaration; another declared payload must not widen the selected key; and a *known* name does **not** validate a stored payload ("The owner validates it before use, because earlier builds can write different payloads"). |
| `packages/core/session/tests/properties.spec.ts` | Property-based (`fast-check`) invariants for the event log: `deriveMessages` is deterministic; `seq` is strictly monotonic and zero-based contiguous; **replay-from-seed reproduces the derivation identically**; replaying a log that already ends in `end-seed` adds no further marker ("Lazy resume makes browsing a pickup, so this must not grow per open"); non-message events never affect derived history under **any interleaving**; and every derived message has a known role and is frozen (mutating it **throws** in strict mode rather than relying on per-call clones). The arbitraries deliberately carry their own surface intent: "Each arbitrary supplies its own surface intent; `build` must not synthesize one or the property would fail to exercise malformed fixture choices." |
| `packages/core/session/tests/repair.spec.ts` | The recovery synthesis: `ToolCallRecovery` observes a live step without earlier history and retains repairs until their commits arrive; for each cause (`interrupted`, `forked`): a balanced log and an empty log produce nothing; an open turn with no open step closes with the cause reason; an open step closes **before** the turn; an assistant tool request with no recorded call is marked not-started; a call that already has a result is **not** re-answered; an unanswered call after the owning step closed is preserved; only the still-open turn is synthesized; multiple unanswered calls each get a result in log order; the synthetic result carries `surfaceOp` and `sourceEventSeqs` when a `tool/call` was logged; a `tool/call` with no matching assistant entry is handled gracefully; the model-visible wording is pinned per cause; and the error codes are shared across causes. |
| `packages/core/session/tests/request-header.spec.ts` | Header canonicalization, equality and folding: empty optional fields normalize to absence; every canonical field is compared and tool order is preserved; absent and empty tool arrays are equivalent; `foldRequestHeader` returns the supplied baseline when no snapshot follows and takes the latest snapshot otherwise; and `Session.requestContext()` is undefined before any record, folds a seeded log on the **first** read (the fold watermark starts at 0 with the seed already present), advances incrementally, folds a batch appended between two reads, and exposes a **frozen** record. |
| `packages/core/session/tests/scoped.spec.ts` | The session's scope wiring: a session entered through a scoped context dispatches its events in that scope; a bare session dispatches subject-less so scoped listeners never hear it; the paired disposal reuses the captured owner carrier; `flush()` with no listeners resolves `false`; a participating listener resolves `true`; the flush dispatches with the owning carrier and awaits all listeners; a rejecting listener propagates ("the caller owns the failure policy") while a synchronous failure does not starve later listeners; a slower listener is awaited before the failure is reported; a never-entered session is rejected rather than given an invented carrier; and a detached carrier clears and rejects stale flushes. |
| `packages/core/session/tests/sequence-types.spec.ts` | The position types: `SessionSeq` and `SessionLogOffset` are distinct brands and both reject `-1`, `-0`, `0.5`, `MAX_SAFE_INTEGER + 1` and `NaN`; a negative-zero seq is rejected at the restored event boundary; fork lineage stays outside the logical header (`seedLength` is absent, `isSeeded` is a boolean, the count is an offset); child-owned setup is appended after the constructor-owned inherited marker; a later inherited marker is rejected ("final inherited marker"); a seeded header requires both a seed and an inherited count; and the exact cut must agree with lineage and log length. |
| `packages/core/session/tests/session.spec.ts` | The store's full contract (~60 cases): the surface view is stable and readonly; message history derives from the log; the `max-tokens` and `aborted` turn reasons round-trip; injected context and user messages render as plain user content; an explicitly empty seed is marked without marking a fresh session; pre-provider request headers and malformed message shapes are rejected on seed/load; assistant settlement fields are validated *without replaying the embedded stream*; historical/malformed header lifecycle markers are rejected; a message event is snapshotted without validating plugin-owned block details; an exclusively owned message is adopted in place while a snapshot stays detached; the log is isolated from mutation through a derived message; non-JSON event data (including sparse arrays) is rejected at the source; a surface-eligible append with no marker is rejected (the runtime guard for the union-widening loophole); **every seed and append getter is read exactly once**; exotic metadata is rejected *before* cloning can erase its prototype; a null-prototype shell is accepted; a header is detached and frozen, and an exotic/non-JSON/mismatched header is rejected; a cached frozen event-array snapshot does not grow after an append; one event can be read without materializing an array; the store creates sessions and emits `session/created` and `session/event`; duplicate ids are rejected; `enter()` refuses a stale prepared session whose id is already live; one session object cannot attach to two stores; direct and reentrant repeat announcements are refused; a reentrant detach is deferred until the creation dispatch unwinds; a create is rolled back when its owner unloads; the subagent `origin` and `delegationDepth` attach to the header; a non-absolute `cwd` is rejected; the creating fiber's disposal detaches the session (HMR safety); a partial `session/created` announcement is paired with a disposal during rollback; `session/event` observer failures are contained after the commit point; internal dispatch validation runs on the frozen candidate before the commit and resets after a veto; a rejected surface transition publishes nothing; the dispatch resolves *before* the commit so instrumentation failure cannot hide a logged event; a reentrant observer append is contained without reordering later observers; and `session/disposed` listener failures are contained per observer. |
| `packages/core/session/tests/surface.spec.ts` | The surface contract: absent or valid source-event references and complete replacement coverage are accepted; source-event references on a non-surface event and obsolete assistant chunk references are rejected; a tool-result replacement spanning multiple nodes, targeting a non-result node or changing anything outside the content is rejected; array-valued rest fields compare structurally; the `SurfaceManager` folds a contiguous window without materializing earlier sequences and validates tool-result rewrites against a nonzero window offset; a replacement crossing the loaded window head is rejected; the manager shares ordered entries and nested replacement ranges with `foldSurface`; the manager keeps no fold-only replacement history; both paths report the same failures; a negative-zero replacement seq is rejected; a failed candidate validation leaves the incremental state unchanged; a surface-eligible event without its marker is rejected; `sourceEventSeqs` and `surfaceOp` are snapshotted so caller mutation is isolated; the surface path skips non-surface events; an empty assistant message is skipped; the type guards narrow correctly; `replaceGeneration` folds the pending delta and counts replaces; the system node projects as the leading system-role message (an empty one as no message); node 0 can only be rewritten by a `system/message` over exactly that node, while later system nodes and a non-system head are unprotected; a mismatched developer role is rejected at event admission; an empty developer node is retained while projecting no message; and a tool-change block in a user message is rejected. |
| `packages/core/session/tests/tool-history.spec.ts` | The tool-history fold: an initial header yields frozen active declarations with no updates; additions resolve from their referenced header while earlier snapshots stay unchanged; an explicit `series` start or a `startsSeries` marker restarts the declarations; a retained name returning with a **changed** definition restarts them; deferred baseline tools activate through folded history on both `addition-only` and `in-history` routes; a retained name restored **unchanged** continues the series; a header lacking its update record falls back to complete active declarations; inherited history is reconstructed on restore and continues from live events; and an addition whose referenced header lacks the definition is refused. |
| `packages/core/session/tests/typert.spec.ts` | The Session Typert provider: the live Session lookup is contributed in either service load order, resolves the session by id, and is withdrawn with the session fiber. |
| `packages/core/system-prompt/README.md` | The assembly contract. Decides: sections are concatenated in ascending `order` and **equal orders use code-unit name order**; `complete: true` makes a section the exact complete prompt ("more than one effective complete section makes assembly fail"); `interpolate: false` preserves literal text; `refreshContext(assembly, context)` re-reads registered runtime facts without re-running the waterfall; variables are `{{name}}` and **strict** ("unresolved references fail prompt assembly before any model request"); the `toolOrder` list needs exactly one `'<unlisted-tools>'` rest entry, and "a listed name with no registered tool rejects every `assemble()`"; `suppressRuntimeContext()` removes optional context for the calling scope while required contributions remain; **registry-change notifications (`system-prompt/change`) are deliberately unfiltered**; the first-party section order (harness identity −1000, persona prefix 0, tools SDK 5000, harness source 10000, web surface 10100, persona suffix 10200) is a *centrally allocated table*, not scattered numbers. |
| `packages/core/system-prompt/README.zh.md` | Chinese mirror of the English README; heading parity 20/20 with matching hashes; the summary and use sections were read and match. |
| `packages/core/system-prompt/locale/en.json` | UI locale stub — `meta.title = "system-prompt"`. |
| `packages/core/system-prompt/locale/zh.json` | UI locale stub — `meta.title = "系统提示词组装"` plus a one-line description. |
| `packages/core/system-prompt/package.json` | Manifest. Peer dependencies: `dsh-llm`, `dsh-scope`, `cordis`; the only real dependency is `schemastery`. |
| `packages/core/system-prompt/tsconfig.json` | Project references: vendored `cosmokit`/`cordis`/`schemastery`, `llm/llm`, `core/scope`. |
| `packages/core/system-prompt/tests/scoped.spec.ts` | The scoping contract: a scoped persona shadows `deployment:persona-prefix` for that scope only (in either registration order); a scoped-only section joins that scope alone and disappears with it; duplicate names throw per layer and the global case names `agent.ctx`; **a scoped section shadows the global one *before* either text provider is evaluated**; a scoped variable shadows its global twin; a scoped variable that replaces the last provider in its generation is *deferred* to the next assembly; a scoped context shadows the global context and cleans up with the scope; `suppressRuntimeContext()` suppresses all optional context for one scope and restores it on disposal; scoped tool providers are consulted only for their scope; disposing one empties its layer without residue; **a `toolOrder` entry restricted away for a scope is a normal absence while a typo still throws**; `refreshContext` refreshes through the same scoped providers and suppression; and an `agent.ctx` assemble listener shapes only its own scope's assemblies. |
| `packages/core/system-prompt/tests/system-prompt.spec.ts` | The assembly contract (~50 cases): required user context survives optional-context suppression; `refreshContext` refreshes registered context **without reassembling** accepted sections, schemas, variables or expert additions; a missing required context is restored before a later registered context; current suppression applies without evaluating optional providers; literal context survives in both the joined snapshot and the attributed sections; **the repository's section placements are unique, integral and at least ten apart**; the reusable instructions are identical across local environments; the context placements are unique and integral; the environment renders *after* the guidance; the harness identity and the configured persona register and render; a persona-less deployment renders no persona section; the identity can be omitted; runtime context can be suppressed; sections assemble in order with context-resolved text and collected tools; equal orders break by code-unit name; text providers resolve against the assemble context at each call; contributions disappear with their fiber; a duplicate name throws ("a double-loaded plugin must fail, not double its text"); a non-finite order is rejected; **a `system-prompt/change` listener that throws rolls the registration back** (section, tool provider and variable alike); the tool-provider membership is snapshotted before the assembly is evaluated; the waterfall composes in order and a listener can short-circuit; one complete section is restored after the waterfall and two are rejected; assemblies are snapshotted so one step's mutations do not leak; empty section text is filtered; context interpolation failures are attributed to the contributing context; `system-prompt/change` fires on register and dispose; the returned disposer removes the contribution; and the whole variable contract — resolution, live iteration, duplicate rejection, interpolation, malformed references, a lone `{{` with no later `}}` staying literal, **`{{constructor}}` being UNKNOWN (prototype properties are not variables)**, a variable *named* like a prototype property working once registered, and substituted values never being re-scanned. |
| `packages/core/system-prompt/tests/tool-order.spec.ts` | The tool-order contract: `TOOL_ORDER_REST` is `'<unlisted-tools>'` ("The ONE place the public constant's value is pinned"); the default order is lexicographic regardless of provider registration order; a configured order puts the rest at its entry, lexicographically; an unregistered name **rejects the assembly** (misconfiguration blocks work) and the message names the known tools; a provider tool named like the reserved rest entry is rejected; equal names keep collection order (a stable sort); **canonicalization happens BEFORE the assemble waterfall** and a listener-appended tool is not re-sorted ("a listener owns the determinism of what it emits"); and a list without the rest entry, or with a duplicate, is rejected *at load*. |
| `packages/core/tools/README.md` | The tool contract. Decides: `defineTool` declares a typed parameter schema, a **canonical output** contract and a body returning only the declared JSON value; "Model arguments are validated before execution; invalid input becomes a normal error result"; "Canonical values belong to execution; the Session records rendered content and optional presentation metadata instead"; the `mode` config (`native` | `ptc`) and `maxParallelSubCalls` (default 10); per-agent restriction via `ctx.tools.restrict(filter)` (masks intersect, scoped registrations stay visible); the **monotonic guard** after the extensible `tools/pre-execute` waterfall ("a returned reason denies the call, and no later listener can turn that denial back into permission"); the four pipeline events; `projectContent` before post-execute policy and `finalizeContent` after; `presentCall`/`presentResult` as *Host-local* render intents (the built-in Web Client does not consume them); the cooperative-cancellation contract (`ABORTED_BEFORE_DISPATCH` vs `ABORTED`); and the PTC mode's collapse ("the announced surface and the callable surface stay the same"). |
| `packages/core/tools/README.zh.md` | Chinese mirror of the English README; heading parity 23/23 with matching hashes; the summary and use sections were read and match. |
| `packages/core/tools/locale/en.json` | UI locale stub — `meta.title = "tools"`. |
| `packages/core/tools/locale/zh.json` | UI locale stub — `meta.title = "工具注册与执行"` plus a one-line description. |
| `packages/core/tools/package.json` | Manifest with three subpath exports: `.`, `./types` and `./presentation` ("the render-intent vocabulary a tool declares … lives in its own UI-facing module; re-export it so `@deepseek-ai/dsh-tools` stays the single public API for tool producers and UI adapters"). Twelve peer dependencies — the registry is the *integration point* of the sandbox, the approval service, the working directory and the PTC runtime. |
| `packages/core/tools/tsconfig.json` | Project references: `core/session`, `ptc-runtime/ptc-runtime`, `core/system-prompt`, `core/agent`, `core/scope`, `interaction/user-approval`, `sandbox/sandbox`, `sandbox/sandbox-policy`, `session/working-directory`. |
| `packages/core/tools/tests/execution-mode.spec.ts` | The fail-closed concurrency classifier: parallel only for an explicit `true`; exclusive for a tool with no declaration, an unknown tool, a `false` for these args, invalid arguments, a **throwing** classifier, and a **truthy non-boolean** result; parsed arguments are passed straight to a raw definition; `isConcurrencySafe` never reaches the model-facing `schemas()` projection; and `ToolExecutionMode` is the object-tagged union. |
| `packages/core/tools/tests/execution-signal-types.spec.ts` | A **compile-time** contract: every typed invocation must supply a caller-owned signal; the input, execution and run-context signals are readonly and cannot be deleted or set to `undefined`; pre-execute, post-execute and result observers see a readonly signal; **only the around-dispatch view may replace the signal, never remove it**; and `defineTool` contextually exposes a readonly `AbortSignal`. |
| `packages/core/tools/tests/fixtures/literal-sdk.ts` | A plugin fixture whose tool *description* contains literal `{{item}}` / `{{model}}` template syntax — the recorded PTC replay case that proves the SDK section's `interpolate: false` preserves literal braces. |
| `packages/core/tools/tests/gen-tool-catalog.spec.ts` | The **guarantee** tests for the tool-schema catalog generator: every shipped tool package boots and its model-facing schemas are harvested (the exact expected name list is pinned); every tool carries an object-rooted `parameters`; a runtime-spread enum resolves to its literal members (the payoff over AST extraction); each tool is attributed to its registering plugin source; the search tools harvest without depending on the generator process `PATH`; a config-driven tool name is recorded in a note; the manifest guard names an omitted package; and the harvest guard fires when a package "booted without registering a single tool" — "the failure this guards is silent by construction … the catalog would ship without its tools while every gate stays green." |
| `packages/core/tools/tests/json-schema.spec.ts` | The enforced subset: every JSON root and node is accepted; the object-root guard lives only with the consumers that need it; non-schema nodes, unknown types and type arrays are rejected; the `oneOf` vocabulary and its two-branch minimum are enforced; **unknown and misplaced keywords are rejected rather than accepted-then-ignored**; every independent violation is reported; object properties, required names and openness are validated; type-correct scalar `enum`/`const` are required; annotations must be typed and lossless; a lossless annotation container from another realm is accepted; cyclic/exotic structure is rejected while sibling reuse is permitted; a deeply nested raw union asserts without the call stack; required declarations use own-property semantics; and the value validator checks scalars, arrays, objects and null roots, rejects wrong types and lossy numbers, enforces scalar `enum` and `const` together, treats a present `undefined` as missing, returns a violation for a container with a hostile getter, validates dense arrays per index, enforces exact-one `oneOf` semantics (including overlap), accepts only lossless JSON under an unconstrained schema, and uses own properties for requiredness, recursion and closed-object checks. |
| `packages/core/tools/tests/properties.spec.ts` | Property-based (`fast-check`) tests for the schema DSL, including the **property-testing ↔ runtime-validation composition** that "closes the validator/InferArgs drift risk": the JSON Schema `required` array equals the `required: true` keys at every level; the conversion is total; `validateArgs` is total; args satisfying the spec always pass validation; dropping a required key is always rejected; and a non-object top level is always rejected. |
| `packages/core/tools/tests/ptc-calls.spec.ts` | The PTC call lifetime: a policy change commits immediately, cancels the existing call, and waits for its complete cleanup before the next call reads the latest mode; a failed call is released and same-policy calls may overlap; a caller cancellation while waiting for a canceled predecessor is honored; and the registry unloads only after the calls stop and refuses late admission. |
| `packages/core/tools/tests/ptc.spec.ts` | The PTC suite (~120 cases): the mode-aware wire contribution (native contributes every schema, ptc contributes exactly `[run_code]` plus the SDK section, and the run_code-only rule is stated **before** the per-tool guidance that names each tool); the run_code transport is outside scoped allow/deny filtering and reserved against shadows and restrictions; the SDK text is byte-identical across consecutive assemblies; a non-native mode with no runtime (or with an unregistered language) rejects every assembly; the schema flavor follows the runtime language; `run_code` is never exposed to programs; the sub-dispatch scheduler reproduces the native concurrency contract (overlap, barriers, the cap, ordered pre-execute that never overlaps, an exclusive call that holds its barrier through post-execute, submission-ordered commits, a queued-unstarted call that logs nothing); the dispatch bridge returns only the curated output, logs one event per dispatch, exposes only an opaque parent token, forwards a nested conclusion, serializes `Promise.all` dispatches, maps a pre-execute deny to a binding rejection, defers sub-call contexts and image-bearing content, converts a failed run into a structured `isError` carrying kind/message/logs, and short-circuits a pre-aborted signal; per-agent presentation (one agent PTC under a native deployment, a standing preset scope's mode inherited down the chain, a native agent with no `run_code` in its dispatch table, an opt-out, a refused second declaration, a refused unscoped declaration); the standing file policy and sandbox outcomes; the per-program execution controls (timeout validation, escalation approval, "does not start a program after approval returns rejected/cancelled/unavailable", "reports prior effects after a denial and never requests approval or replays implicitly"); and the PTC state ownership. |
| `packages/core/tools/tests/py-types.spec.ts` | The Python projection: the DSL subset maps to `str`/`float`/`bool`/`Literal[...]`/`list[...]`/`dict[str, Any]`; unsupported constructs degrade to `Any`; `Literal` stays parseable; NEL and the line separators pass through raw; a beyond-safe-range integer literal is exact; identifier tools become `async` methods and exotic/reserved names become subscript comments; required fields are plain and optional ones `NotRequired`; a name that CamelCases to a non-letter head is prefixed with `Tool`; a `oneOf` of object branches becomes a union of named `TypedDict`s declared before the parent; a class-name collision gets a counter suffix; the class-name length is capped; a field name that is not a legal Python attribute degrades to `dict[str, Any]`; soft keywords stay `TypedDict` fields; a non-ASCII field name stays a field; **an NFKC-normalizing name degrades**; U+200C is kept in a name tail and rejected at a name head; the output is deterministic and byte-identical regardless of input order; a deep array schema is capped at CPython's bracket limit; a deep `oneOf` renders in linear time; and control characters, unpaired surrogates and quotes are escaped. |
| `packages/core/tools/tests/schema.spec.ts` | The author DSL: every value root compiles (including the author-only `json` node, which becomes an annotation-only schema); the implicit parameter root stays open while explicit object openness is preserved; **runtime-forged author forms are rejected rather than compiled lossily** (16 cases, including a symbol key, a hidden key, a sparse `oneOf` and a decorated `enum`); cyclic schemas are rejected; a 5,000-deep union compiles without the call stack; a property literally named `__proto__` is preserved as schema data; the type inference is pinned (`enum` → a literal union, `const` → the literal, `oneOf` → a union, an open object → `& Record<string, JsonValue>`); inference is bounded at 16 container levels; required and optional parameter keys infer correctly; and the invalid author forms are compile-time errors. |
| `packages/core/tools/tests/scoped.spec.ts` | The registry's scoping contract: a scoped tool is visible and executable for that scope only; a scoped tool shadows a global one in either registration order; a duplicate name within one layer throws and the global case names `agent.ctx`; disposing the scope leaves no residue; `restrict()` masks global tools, merges scope-local tools afterwards, applies a **snapshotted** filter to the live global registry, composes by intersection and lifts each independently, and **fails loud on an unscoped call, an empty filter, and a name it does not inherit**; a restriction over an inherited layer filters what the child inherits, keeps the child's own registrations outside its own filter, and lets an ancestor's restriction reach every scope nested inside it; a scoped pre-execute listener gates only its own agent; scoped guards apply after pre-execute and unwind independently; global guards compose monotonically; a guard registered by an earlier guard is live-iterated; a scoped guard that replaces the last guard in its generation is deferred; and the pipeline shares one token and one materialized argument value, reads a stateful parent accessor **once**, normalizes a throwing arguments accessor without losing the final notification, and notifies every `tools/result` observer with the frozen final outcome. |
| `packages/core/tools/tests/tools.spec.ts` | The registry's full contract (~150 cases): deferred loading survives the registry and the prompt projection; registration feeds the prompt assembly; `schemas()` drops every host callback and `timeoutMs`; a captured content projector runs before policy and a later replacement stays authoritative; a throwing projector is normalized; a raw registration must declare its canonical output; lossy and schema-mismatched body values are rejected **before** post-execute; a value replacement recomputes both projections; a post-execute block becomes a valueless failure; a post-execute decision replacing both projections fails; value replacement on a failed dispatch fails; a wrapper-authored result is normalized (and fails when the owning tool disappeared); a nested conclusion is carried on the nested result; unknown and throwing tools become `isError` results; a hostile thrown value whose inspection *and* coercion throw is normalized; `ToolNotFoundError` carries a stable message and code; the whole **approval** matrix (`allowed-once` / `rejected` / `cancelled` / `unavailable` / a rogue outcome / an agent-less call); the **cancellation** matrix (a pre-aborted call, cancellation arriving while pre-execute awaits, a late wrapper success replaced by `ABORTED`, a late post-execute success replaced by `ABORTED`, an uncooperative started body waited for, the caller signal re-fused into a wrapper replacement and restored afterwards); the pipeline order (`pre-execute` → `execute` → `post-execute`) and each stage's short-circuit; the canonical-result revalidation; and the `defineTool` DSL surface, the runtime argument validation, and the soft-validating presenters. |
| `packages/core/tools/tests/ts-types.spec.ts` | The TypeScript projection: every schema construct maps to the expected type text; objects render with required/optional keys, nested shapes and per-property docs; the renderer is **total** (unsupported or hostile constructs degrade to `unknown`, never throw); a comment closer inside a description is escaped; a 5,000-deep union renders without the call stack; the SDK declares every tool in lexicographic order with quoted keys for exotic names; the fixed instruction lines the model relies on are present; the program is listed before its description; the bindings are kept program-only; the REPL output syntax stays distinct from a function body; **the bash example is shown only when the declared binding accepts it**; the output is deterministic regardless of input order; and an empty tool set renders an empty declaration. |
| `packages/core/session/tests/seq-ranges.spec.ts` | The compact `sourceEventSeqs` encoding: consecutive runs of three or more become inclusive pairs; a run of **two stays as two numbers** (a pair is not smaller); a non-increasing input is passed through unchanged; a malformed entry, a negative value, `start > end`, overlapping ranges and exceeding `maxEntries` all throw; and a **million-element range decodes fine** — "the decoder imposes no persistence-only length limit by default." |

### Tier 3 — skipped with a reason

| `packages/core/README.i18n.yaml` | Generated bilingual-pairing record (per-heading-section hashes of the English and Chinese blocks). Confirmed by reading the head; the file is a build artefact of `verify-translation-pairing --write`, not prose. |
| `packages/core/agent-default-model/README.i18n.yaml` | Same generated pairing record for the agent-default-model README. |
| `packages/core/agent-loop/README.i18n.yaml` | Same generated pairing record for the agent-loop README. |
| `packages/core/agent-tool-presentation/README.i18n.yaml` | Same generated pairing record for the agent-tool-presentation README. |
| `packages/core/agent/README.i18n.yaml` | Same generated pairing record for the agent README. |
| `packages/core/scope/README.i18n.yaml` | Same generated pairing record for the scope README. |
| `packages/core/session/README.i18n.yaml` | Same generated pairing record for the session README. |
| `packages/core/system-prompt/README.i18n.yaml` | Same generated pairing record for the system-prompt README. |
| `packages/core/tools/README.i18n.yaml` | Same generated pairing record for the tools README. |


---

## 2. Ideas worth stealing

1. **Make the log the source of truth and derive everything else from it.**
   `packages/core/session/src/index.ts:820-880` — the request the model sees is
   `header.config` + `deriveMessages()` + `header.tools`; there is no `system`
   field and no in-memory chat state. The repo states the invariant as a rule:
   "**Model-visible means logged**" (`packages/core/session/README.md`). For
   August Trading this is the answer to "how do I make a conversation
   reconstructable after a crash, and how do I make the UI and the model's
   context provably the same thing?" — one append-only log, one derivation.
   *UNIQUE to this repo within the shard* (the other two reference repos are not
   in this shard; treat as a strong pattern rather than a confirmed convergence).

2. **Give every request a reconstructability theorem, and test it.**
   `packages/core/agent-loop/tests/request-reconstruction.spec.ts:856` — the test
   is literally named "THEOREM: every request rebuilds byte-equal from the
   session log alone." The whole request-reconstruction suite is the idea:
   *the transcript is an input to the next request*, and the property is
   asserted, not documented.
   *UNIQUE.*

3. **Reserve surface node 0 for the system prompt and refuse to let anything
   else rewrite it.**
   `packages/core/session/src/surface.ts:487-504` — a replacement covering node 0
   while it is a `system/message` must itself be a `system/message` over exactly
   that node. This is a *hard* invariant on the derived transcript, and it is
   what makes prompt-reconciliation safe.
   *UNIQUE.*

4. **Make the prompt a durable event, not a parameter.**
   `packages/core/agent-loop/src/agent.ts:395-410` — the rendered prompt is
   committed as a `system/message` node *before* the request is built, and the
   projection decides append-vs-consolidate from the route's capability and the
   series state. The companion idea is in `packages/core/agent-loop/src/runtime-context.ts:88-103`:
   a capable continuing route **appends** the changed prompt (preserving the
   provider's prefix cache) while an incapable route or a new series
   **consolidates** at node 0. A trading app that re-renders its system prompt
   per turn can steal this verbatim.
   *UNIQUE.*

5. **Give every failure a canonical, *typed* result instead of an exception.**
   `packages/core/tools/src/index.ts:1676-1700` (`toolErrorResult`,
   `toolAbortedResult`, `toolAbortedBeforeDispatchResult`) and
   `packages/core/session/src/repair.ts:41-53` (`TOOL_NOT_STARTED` /
   `TOOL_OUTCOME_UNKNOWN`). An unknown tool, a denied call, a cancelled call, a
   timeout and a tool that threw all become *ordinary error results* the model
   reads and the turn survives. This is the single most transferable idea in the
   shard for a trading app, where "the tool failed" must never be "the turn
   died".
   *UNIQUE.*

6. **Write the retry guidance as a risk policy, in the model's words.**
   `packages/core/session/src/repair.ts:41-52` — "retry only if the operation is
   read-only or idempotent; if it may have side effects, first verify external
   state or ask the user. Do not retry blindly." A durable, model-readable
   statement of what may be re-run is exactly what an order-placing tool needs.
   *UNIQUE.*

7. **Separate the *extensible* gate from the *monotonic* guard.**
   `packages/core/tools/src/index.ts:723-736` — `tools/pre-execute` is a
   waterfall (reorderable, allow/deny/ask), and `ctx.tools.guard()` is a
   *monotonic* guard that runs after it and can only deny: "listener ordering
   cannot turn a denial back into permission." Two tiers of policy, one of them
   non-negotiable. A trading app with a risk limit needs exactly this shape.
   *UNIQUE.*

8. **Separate the *announcement* from the *callable surface* and keep them
   identical.**
   `packages/core/tools/src/index.ts:1355-1372` — under PTC mode the model sees
   only `run_code`, and a model-direct call naming any other tool is denied
   `UNKNOWN_TOOL` **before** the policy pipeline, with a message that names the
   route ("only `run_code` is callable directly — call `x` from inside a
   `run_code` program instead"). The repo's own comment explains why: "a rule
   the model can only discover by being denied is one it corrects too late."
   *UNIQUE.*

9. **Account for work a turn consumed.**
   `packages/core/agent/src/consumed-work.ts:88-136` — `foldConsumedWork` reads
   the log and answers "what did this turn actually do with the work it took?"
   It is a *post-mortem* primitive: it distinguishes a turn that entered a step,
   a turn that claimed input and then failed, and work that was cancelled out of
   the inbox unrun. Nothing about live state needs sampling before cancelling.
   *UNIQUE.*

10. **Make the concurrency classifier fail closed.**
    `packages/core/tools/src/index.ts:1276-1290` — parallel only for an exact
    `true`; omission, a non-boolean, an exception, an unknown tool and invalid
    arguments are all **exclusive**. A tool opts *in* to overlap; it never opts
    out of safety.
    *UNIQUE.*

11. **Canonicalise ordering before the extension point, not after.**
    `packages/core/system-prompt/src/index.ts:900-925` and
    `packages/core/agent-loop/tests/tool-order.spec.ts:32-40` — the registry's
    order (lexicographic, or a configured `toolOrder`) is applied *before* the
    `system-prompt/assemble` waterfall, so a listener sees a deterministic list;
    but a listener that mutates the list "owns the determinism of what it
    emits." "Registration order is a concurrent loading artifact and must not
    leak downstream."
    *UNIQUE.*

12. **Give the runtime a *view*, not the registry, and re-fuse the caller's
    cancellation.**
    `packages/core/tools/src/index.ts:1745-1780` — an around-dispatch wrapper may
    replace the signal, but the registry fuses the *original* caller signal back
    in before the body runs, and restores the wrapper's signal afterwards.
    "Replacement cannot detach caller cancellation."
    *UNIQUE.*

13. **Keep the strict/complete prompt assembly separate from the dynamic
    context, and let the context be a *user-role snapshot* rather than a second
    system message.**
    `packages/core/system-prompt/src/index.ts:44-106` — sections become prompt
    text; contexts become sourced user-role snapshots in model history. The
    runtime context is therefore *attributed* (which subsystem contributed
    which paragraph) and *replaceable* without touching the prompt.
    *UNIQUE.*

14. **Refuse to lose the user from a cancelled turn.**
    `packages/core/agent-loop/src/agent.ts:400-417` — a cancelled stream commits
    the delivered prefix as an `assistant/message` with `interrupted: true`, so
    "the next request contains what the user saw." Plus
    `packages/core/agent-loop/src/agent.ts:270-283` — every unanswered tool call
    gets a synthetic result before the step closes, so the provider protocol
    never sees a dangling call.
    *UNIQUE.*

15. **Model the "did this turn finish?" question with a two-state machine and
    sticky outcomes.**
    `packages/core/agent-loop/src/runtime-types.ts:113-120` — `AgentStatus` is
    `'idle' | 'running'` only ("Disposal removes the agent from its registry; it
    is not a third observable status"), and `max-tokens` is sticky for the turn
    but not across turns (`packages/core/agent-loop/src/agent.ts:262-267`).
    *UNIQUE.*

16. **Test the invariants with property-based tests, and make the generator
    event-driven so "a flake is a finding, not timing noise."**
    `packages/core/agent-loop/tests/properties.spec.ts:1-16` and
    `packages/core/session/tests/properties.spec.ts:1-10` — three separate
    property suites pin "every sent message appears exactly once", "replay
    reproduces the derivation", and "non-message events never affect derived
    history under *any* interleaving."
    *UNIQUE.*

17. **Make the tool-schema subset an *enforced* contract with its own
    validator, and compile the author's DSL into it.**
    `packages/core/tools/src/json-schema.ts:1-20` and
    `packages/core/tools/src/schema.ts` — one subset, one validator, one
    compiler, one inference; and "unsupported or misplaced keywords reject
    rather than being accepted without enforcement."
    *UNIQUE.*

18. **Use a "capability argument" pattern to keep privileged operations off the
    public service API.**
    `packages/core/tools/src/ptc.ts:291-320` — the `run_code` bridge receives
    `requireRuntime`, `peekApprover`, `resolveSandboxPolicy` and
    `shapeDispatchLog` as closures, so "operations only the owning registry can
    mint stay off its public service API."
    *UNIQUE.*


## 3. Trading-specific findings

**Long-lived monitoring & scheduled work** — *not in this shard.* The core
group has no scheduler, no cron and no monitoring loop; the `schedule/*` and
`job/*` packages visible in `KNOWN_SESSION_EVENT_TYPES`
(`packages/core/session/src/known-event-types.ts:33-38`) live outside
`packages/core`. What this shard *does* contain is the substrate such work
would sit on: the durable log a monitor would append to, the `session/flush`
durability barrier (`packages/core/session/src/index.ts:1404-1421`), the
`turn/end` reason vocabulary that a scheduled run's outcome would use, and the
`agent/turn-stopping` extension point that lets a listener keep a turn open
(`packages/core/agent/src/runtime-types.ts:352-372`).

**Human-in-the-loop approval** — partially here, in the *tool* seam rather than
a dedicated approval package. `PreToolDecision` carries an `ask` variant with a
`reason` and a localized `displayReason`
(`packages/core/tools/src/index.ts:576-583`); `ctx.tools.guard()` is the
monotonic deny-only gate; and `serviceAsk`
(`packages/core/tools/src/index.ts:1683-1742`) maps four approval outcomes —
`allowed-once`, `rejected`, `cancelled`, `unavailable` — onto allow/deny with
*distinct* reasons "so the model can tell a human 'no' from an absent approval
channel." The approval record itself (`ctx.approval.request({ agent, toolName,
callId, reason, displayReason, signal })`) lives in `dsh-user-approval`, outside
this shard. The audit trail that survives a decision is the *session log*: the
`tool/call` and `tool/result` events carry the call id, the arguments and the
structured `error` identity (`packages/core/session/src/types.ts:274-292`),
and the `developer/message` tool-addition/removal events record registry
changes.

**Post-mortem / reflection loops** — partially here. The primitives a
reflection loop would be built on are all present: `foldConsumedWork`
(`packages/core/agent/src/consumed-work.ts:88-136`) accounts for what a turn
consumed; `TurnEndReasonMap` gives a machine-readable ending
(`completed` / `blocked` / `aborted` / `error` / `max-tokens` / `interrupted` /
`forked`); and the plugin-record mechanism
(`packages/core/session/src/index.ts:560-620`) lets an experimental package
write its own durable records — named `plugin:<owner>/<record>`, marked
`ignorable`, and never entering the model-visible surface. The *accumulation
control* (expiry, retirement, consolidation) is **not** in this shard: the
skill/rule packages live elsewhere. What the shard does decide is the
compatibility posture for accumulated state: "Removing or renaming a
declaration does not discard stored records," and the owner "validates it
before use, because earlier builds can write different payloads"
(`packages/core/session/README.md`).

**Multi-agent** — *not in this shard* in the subagent/debate sense. The
`subagent/*` and `team/*` session event types exist in the vocabulary
(`packages/core/session/src/known-event-types.ts:42-46`), and the *delegation
budget* is durable in the session header — `delegationDepth` is "persisted so a
recursion budget survives restart and resume — a runtime-only depth would reset
a resumed child to top-level" (`packages/core/session/src/types.ts:97-104`).
The shard's own multi-agent-relevant idea is the **initiator scope**
(`packages/core/agent/src/index.ts:271-320`): an `AsyncLocalStorage` chain that
attributes work to the exact live agent, with `withoutInitiator()` for shared
timers and the rule that "ambient presence is neither liveness proof nor
authorization." A subagent that inherits its parent's initiator must be told
when it is *its own* agent — that is what the scope is for.

**Structured logs the model can query** — strongly present, and this is the
shard's sharpest answer. The session log *is* the queryable record: an
append-only, lossless-JSON, sequence-contiguous event stream with a typed
vocabulary (`packages/core/session/src/types.ts:180-330`), a **fold** for every
derived view (`foldRequestHeader`, `foldSurface`, `ToolHistoryProjection`,
`foldConsumedWork`), and a `request/context` record carrying the route's
`contextWindow` so the consumer can size its own compaction. The repo also
demonstrates *how to keep a log queryable without a heavy database*: the
`session/search`, `session/event_search`, `session/event_trace` and
`session_event_read` tools appear in the shipped tool catalog
(`packages/core/tools/tests/gen-tool-catalog.spec.ts:47-60`) — the log is
queried **through tools**, not through a database.

**Staying simple as features accumulate** — the shard's answer is *scoping*,
not feature-cutting. The registry/layer primitive (`packages/core/scope`) is
~16 KB and gives every one of the four registries (system prompt, tools, agent,
session projections) the same "one global layer plus lazily created
exact-scope layers, nearest definition wins" model. The second answer is the
**one-line change notification**: a registry change emits one event
(`system-prompt/change`, `tools/change`) and "a global change affects every
scope" — so consumers re-derive rather than patch. The third is the
**reserved-name + required-config** pattern: `run_code` is reserved
unconditionally, `mode` is required rather than defaulted, `toolOrder` needs
exactly one rest entry — each of which turns a "two answers to the same
question" into a load-time failure instead of a runtime contradiction. The
fourth is the **capability argument** (`packages/core/tools/src/ptc.ts:291-320`),
which keeps privileged operations off a public service API instead of growing
the API.


## 4. Non-obvious decisions and gotchas

1. **`Session.append` has a *conditional* parameter type, and the compiler is
   the only thing keeping log-only events clean.**
   `packages/core/session/src/index.ts:770-790` — `...opts: T extends
   SurfaceEventType ? [opts: SurfaceIntent<T>] : []`. A caller that widens
   `SessionEventType` can slip a `surfaceOp` onto a log-only event; the runtime
   guard then throws "session event \"…\" is not surface-eligible and cannot
   carry surfaceOp" (`packages/core/session/src/surface.ts:311-320`). The
   repository knows this and defends it at runtime.

2. **`eventAt()`, `snapshotEvents()` and `ownEvents()` are deprecated but still
   everywhere.** `packages/core/session/src/index.ts:712-760` — "new production
   calls are prohibited," with a lint allowance for test files. The whole
   `agent-loop` test suite (~27 files) is written against them. A reader
   following the *tests* rather than the *docs* will write deprecated code.

3. **`ToolDefinition` and `defineTool` are two different contracts.**
   A raw registration must declare `output { schema, render, presentationMeta? }`
   and is *not* argument-validated (`packages/core/tools/src/index.ts:1091-1104`
   and the test "raw-registered tools are NOT validated by defineTool (MCP keeps
   its own)"), while a `defineTool` definition validates arguments and infers
   types. Two different safety levels behind one type name.

4. **`tools/restrict()` and `tools.presentAs()` throw when called from a
   context without a scope key.** The error text is the documentation:
   "a context-global restriction would mask every agent" and "a context-global
   presentation is the `mode` config field." A plugin that registers a tool
   from a plain context and then tries to restrict it gets a runtime throw, not
   a compile error.

5. **`ToolRuntime.execute` is a *staged* internal API (`TOOL_RUNTIME_SCHEDULER`)
   that a sibling package consumes.** `packages/core/tools/src/index.ts:449-490`
   — the comment says "this is not a plugin extension point," but
   `packages/core/agent-loop/src/tool-calls.ts` calls it directly. The
   scheduler's contract (prepare → dispatch → finalize/finish, with
   `post-result` vs `final-result`) is a real, load-bearing cross-package
   protocol that no public type documents.

6. **The PTC mode's `run_code` transport lives in the tools package but needs
   the PTC runtime, the sandbox policy, the approval service and the working
   directory.** `packages/core/tools/src/ptc.ts:291-320` — the bridge takes
   them as closures so the *registry* does not have to `inject` them (which
   would hold every tool plugin hostage to a PTC runtime). This is a deliberate,
   well-documented workaround, but it means the "tools" package has a hidden
   dependency on four other packages' services.

7. **`AgentStatus` is two-valued, but the lifecycle has more states.**
   `packages/core/agent/src/runtime-types.ts:113-120` — disposal is not a
   third status. A consumer that wants to show "disposing" must read
   `agent/disposed`, not `agent/status`.

8. **`tools/change` and `system-prompt/change` are deliberately UNFILTERED.**
   `packages/core/tools/src/index.ts:228-241` — "a global change concerns every
   agent's next assembly, so a scoped listener subscribing here sees every
   change." A scoped listener that assumes it hears only its own scope's
   changes will over-react.

9. **`Session.fromRestore` and `Session.create` have different aliasing
   contracts** (`detached` vs `shared-frozen`), and the *seed* is not
   re-validated in restore mode the way it is in snapshot mode. A caller that
   passes a mutable seed with `eventState: 'shared-frozen'` has opted out of
   the copy — the parameter name is the whole warning.

10. **The `agent-loop` README's "Known Limitations" lists a live, admitted
    data-loss path**: "Root shutdown persistence — shutting down the root
    context with an active Agent can leave its final `turn/end` in memory but
    absent from the persisted log." The `shutdown-drain.spec.ts` test proves the
    *buffered* events are drained, but the README still says the final event
    can be lost.


## 5. Weak spots

1. **The core group is enormous for a "core".** `packages/core/session/src/index.ts`
   is 1,453 lines / 65 KB in one file, and `packages/core/tools/src/index.ts`
   is 1,993 lines / 91 KB. The repo's own style is to split by concern
   (`surface.ts`, `repair.ts`, `tool-history.ts`, `request-header.ts` beside
   `index.ts`), but each `index.ts` is still a monolith holding the service, the
   validation and the event declarations together.

2. **The prompt-admission rules are spread over four packages.** The rule
   "which system node holds the effective prompt" lives in
   `packages/core/agent-loop/src/runtime-context.ts` (the projection), in
   `packages/core/session/src/types.ts` (the `system/message` event contract),
   in `packages/core/session/src/surface.ts` (the node-0 protection) and in
   `packages/core/agent-loop/src/agent.ts` (the admission call). A change to
   prompt semantics touches all four. The same is true of the tool
   presentation mode: `packages/core/agent-tool-presentation/src/index.ts`,
   `packages/core/tools/src/index.ts` and the `agent-loop`'s
   `wireSchemas`/`collapses` must all agree.

3. **The `tools` package has a hard, unwritten dependency on the approval,
   sandbox, working-directory and PTC-runtime services.** The `requireX`
   closure idiom (`packages/core/tools/src/ptc.ts:291-320`) keeps the *type*
   dependency out of `inject`, but the *runtime* dependency is real, and its
   failure mode is a structured `isError` at call time rather than a mount
   failure. `packages/core/tools/src/index.ts:1043-1060` even has to say
   "Read at use time … NOT via static `inject`: an inject entry would hold
   `ctx.tools` — and every tool plugin behind it — hostage to a PTC runtime
   existing even under `mode: 'native'`." That is a design pressure the
   package has not escaped.

4. **The `Session` surface is the wrong source for a human transcript, and the
   repo says so.** `packages/core/session/src/surface.ts:88-100` — a landed
   replacement erases conversation the user already saw. The fix is
   `isAppendSurfaceEvent`, a *second* reader. A consumer that wants "what the
   user saw" must know to use the append-origin events, and the split is easy
   to get wrong.

5. **Three deprecated-but-widely-used readers still carry the whole test
   suite.** `eventAt` / `snapshotEvents` / `ownEvents` are prohibited for new
   production calls, yet the `agent-loop` tests use them exclusively and the
   migration is "deferred." A reader will follow the tests.

6. **The `py-types.ts` Unicode analysis is exact and admirable and also
   *version-fragile*.** `packages/core/tools/src/py-types.ts:25-98` — the
   identifier predicate is measured against Node 22.23.1 (Unicode 17.0) and
   CPython 3.9.6 (13.0.0), and the doc names the exact characters where the
   two diverge. When either table moves, the SDK's output changes. This is
   honest engineering, but it is a maintenance liability that a reader
   underestimates.

7. **The `tools` registry's own `schemas()` projection is *not* the same
   projection the model sees in PTC mode.** `packages/core/tools/src/index.ts:1015-1032`
   — under `ptc` the *wire* contribution is `[run_code]` plus a generated SDK
   section, while `schemas()` still returns every visible definition. Two
   different notions of "the tools this agent has" live in the same class.

8. **The `agent-loop` README is 23 KB of prose about behaviour that the source
   also states.** Much of it is genuinely one-of-a-kind design rationale (the
   prompt-admission rules, the KV-cache analysis, the request-header reasons),
   but the *duplication* between the README and the code comments is real, and
   it is why the repository needs a bilingual pairing hash per section to keep
   the two languages in step — a maintenance tax imposed by the docs, not the
   code.

