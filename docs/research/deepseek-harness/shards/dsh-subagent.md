# deepseek-harness :: dsh-subagent

**Files in shard:** 201 (read: 201, skipped with reason: 0)
**What this shard covers:** the whole `packages/subagent/` capability family of the DeepSeek Harness monorepo — the delegation *seam* (`subagent/`, 22 source modules), the in-process backends (`subagent-spawn-in-process/`, `subagent-fork-in-process/`), the out-of-process product backends (`subagent-acp/`, `subagent-codex/`, `subagent-claude-code/`, `subagent-dsh-sdk/`), and the two model-facing tool packages (`tool-subagent/`, `tool-subagent-control/`). Together these answer one question: *how does a harness let an agent delegate a task to a child agent and get a trustworthy terminal result back without the child's reasoning, tool traffic, or credentials polluting the parent?* The answer is a named-provider registry with an explicit capability contract, a bounded activation pool, one canonical answer-selection rule, and a closed vocabulary of safe failure diagnostics.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

---

#### `packages/subagent/subagent/src/index.ts`
- **Purpose:** The Service Definition for the seam (`ctx.subagents`) — a named-provider registry plus a capability-validating asynchronous start API, the `startActivation` / `sendMessage` / `interrupt` / `listChildren` / `listDescendants` surface, and the `subagent/start` / `subagent/end` lifecycle events.
- **Key abstractions:** `SubagentRuntime` (extends `TypertRemoteService`), `Config` (`maxActiveSubagents` default 8, `maxDepth` default 1, both `Volatile`), `startActivation(spec)`, `waitForChildren(parent)`, `sendMessage(sender, targetId, content, options)`, `interrupt(targetSessionId, authority)`, `drainDescendants(parents)`, `drainChildren(parent, childIds)`, `listChildren`, `listDescendants`, `registerProvider(provider)`, `resolveMaxDepth(configured)`.
- **Data flow:** `ctx.inject(['agents'])` builds the `SubagentManager`; `ctx.inject(['sessionProjections'])` registers three projections (catalog, timing, identity); `ctx.inject(['agents'])` installs the archive-admission listeners. A start resolves the provider, validates depth/schema/capabilities, requires the *exact* live parent Agent, and then routes to `manager.startLocal` (provider has `prepareContinuable`) or `manager.startExternal`.
- **Non-obvious design decisions:**
  - **Capability validation happens BEFORE any child exists** (`assertCapabilities`, `src/index.ts:~700`). A provider that lacks `outputSchema`/`maxDepth`/`agentOptions`, or that `inheritsParentContext` while `agentPreset` was requested, is rejected with `UNSUPPORTED_CAPABILITY`. The seam never "accepts and ignores".
  - **`inheritsParentContext` is descriptive, not enforced** — it exists so the model-facing tool can tell the truth about what the child sees (`src/types.ts:~330`).
  - **Registration is effect-scoped and HMR-safe** (`registerProvider`): a duplicate name throws `DUPLICATE_PROVIDER`; removal emits `subagent/provider-removed` but **never revokes an already-accepted run**.
  - **`maxDepth: 'provider-managed'`** is a first-class value meaning "the out-of-process child owns its own recursion budget" (`resolveMaxDepth`).
  - **The `@Remote('prompt')` / `@Remote('interruptByParent')` methods are the browser control surface**, and they validate a **client-supplied time zone** (`canonicalClientTimeZone`) and a **caller principal** (`principalOf(this.ctx.invocation)`) before delivering.
- **Edge cases & failure handling:** no `agents` service → `CONTINUATION_UNAVAILABLE`; missing/replaced parent → `UNAUTHORIZED`; unknown provider → `NO_PROVIDER`. Image prompt parts are **admitted and persisted through the attachment store before the child's inbox accepts the message**, and a text-only child model is refused with `subagent/attachment-invalid` rather than a silent drop.
- **Surprising:** `interruptByParent` deliberately reads **no catalog, no history, no persistence** — it authorizes the durable parent address against the live Activation only, which is what keeps a live child interruptible while its parent Agent is offline (`src/index.ts:~640`).

#### `packages/subagent/subagent/src/manager.ts` (1,493 lines)
- **Purpose:** Owns subagent startup, message admission, cold resume, parent ownership, settlement, and disposal for every provider.
- **Key abstractions:** `SubagentManager`, `startLocal`, `startExternal`, `deliverToChild` / `deliverFollowup` / `submitMaterialized` / `submitAdmitted`, `coldResume`, `materialize` / `materializeTracked`, `watchLocalSettlement`, `finishDisposal`, `notifySettlement`, `holdOwnership` / `acquireOwnership` / `releaseOwnership`, `drain` / `drainDescendants` / `drainChildren`, `resolveDirectory`, `assertImageCapable`.
- **Data flow:** reserve capacity → resolve directory → provider prepare → materialize child Agent (or external run) → submit initial prompt → watch for settlement → capture result → notify parent → release slot.
- **Non-obvious design decisions:**
  - **Child-first disposal ordering is expressed by registration order, not by data.** The manager registers a *private* Cordis scope's structural disposer FIRST and the drain SECOND, so reverse unwind invokes the drain before releasing the scope (`src/manager.ts:~185-200`). The comment says a cleanup effect on the same scope as the Agent handles "would let structural handle disposal bypass child-first ordering".
  - **Ownership is an edge, not a flag.** `holdOwnership(parent, childId)` pre-registers the child in the parent's `ownedChildren` set so an idle continuation-managed parent cannot settle while a caller is still creating the child; the releaser removes only a hold *this call* added (`src/manager.ts:~700`).
  - **Settlement is a state machine, not a one-shot.** `settlementState()` returns `closed | retry | wait | ready`; the watcher re-checks after the final Session flush, and re-checks the session sequence number before closing admission, so work that lands during the flush is not lost (`src/manager.ts:~1050`).
  - **The child's own log is authoritative for the stop reason** — teardown success says nothing about whether the model errored, hit its token ceiling, or was cancelled (`epochStopReason`, `src/lifecycle.ts`).
  - **A failure without a committed `turn/end` settles as `error`**; a *later* committed turn ending supersedes the live failure and supplies the recovered outcome.
  - **Cold resume reconstructs only from the durable descriptor** — never from the parent's current options — so a resumed child does not inherit a budget or a route the descriptor never declared (`src/manager.ts:~1250`).
- **Edge cases & failure handling:** `DUPLICATE_CHILD` when a reserved id already exists (checked against resident activations, live Agents, *and* stored Sessions); `ACTIVATION_CLOSING` when the parent is being disposed; `DRAINING` for a scoped teardown; `PERSISTENCE_UNAVAILABLE` / `CONTINUATION_UNAVAILABLE` for missing services; `NOT_RESUMABLE` for a child whose log has no supported descriptor; `MODEL_DOES_NOT_SUPPORT_IMAGES` for a text-only child model. Cleanup failures are aggregated into one `ACTIVATION_TEARDOWN_FAILED` carrying *every* boundary's failure, while the captured result promise still resolves with the real outcome.
- **Surprising:** `finishDisposal` calls `this.notifySettlement(activation, result)` **before** `activation.result.resolve(result)` — the parent is told about the child's outcome before the caller awaiting `result` is released, and a failed teardown still delivers the *captured* result to the parent.

#### `packages/subagent/subagent/src/types.ts`
- **Purpose:** The published consumer-facing contracts — request, result, capability, and provider types, plus the `subagent/start` / `subagent/end` payloads.
- **Key abstractions:** `SubagentProvider`, `SubagentCapabilities`, `SubagentStartRequest`, `ResolvedSubagentStartRequest`, `SubagentActivation`, `SubagentRun`, `SubagentResult`, `SubagentStopReasonMap` / `SubagentStopReason`, `ContinuableCreateRequest` / `ContinuableCreateSpec`, `SubagentRunInfo` / `SubagentRunEndInfo`, `SubagentInterruptAuthority`.
- **Data flow:** the service validates a `SubagentStartRequest` into a `ResolvedSubagentStartRequest` (absolute cwd), hands it to a provider, and receives a `SubagentRun` whose `result` promise **never rejects on a child-level failure**.
- **Non-obvious design decisions:**
  - **`SubagentStopReasonMap` is merge-extensible.** Consumers branch on the known cases and fall through `default`, so a backend can add a variant without breaking the seam.
  - **A provider contributes DATA, never a capability** to a continuable child: `ContinuableCreateSpec` carries only `{ seed }` — no Agent, handle, prompt delivery, result, disposal, or resume operation (`src/types.ts:~250`).
  - **Method presence IS the capability.** `prepareContinuable` present ⇒ local activation; `start` present ⇒ external. The manager decides by which method exists, not by a flag.
  - **The `result` contract is explicit:** "Does NOT reject on a child-level failure — a model/transport failure resolves with `stopReason: 'error'`". Rejection is reserved for infrastructure faults the seam cannot express as a stop reason.
- **Edge cases & failure handling:** `diagnostic` is capped at 4,096 UTF-8 bytes by the shared boundary; `structured` is `unknown` because the seam is schema-agnostic.
- **Surprising:** `SubagentProvider.agentRouteDefaults` is documented as "detached immutable data and requires `agentOptions` support" — provider-owned route baselines are a *first-class* concept, distinct from per-request overrides.

#### `packages/subagent/subagent/src/activation.ts`
- **Purpose:** Execution-period records, capacity slots, child serialization, and local output capture.
- **Key abstractions:** `ActivationPool` (with `reserve(capacity)`), `Activation` / `LocalActivation` / `ActivationResource`, `activationAgent`, `requireLocalActivation`, `observeLocalFailure`, `captureLocalResult`, `ChildLock`.
- **Data flow:** `ActivationPool.reserve` takes a slot before any async work; `ChildLock.run(childId, op)` linearizes every delivery/release/dispose for one durable child; `captureLocalResult` folds the child's own event suffix into the terminal result.
- **Non-obvious design decisions:**
  - **Capacity is a process-local slot set shared by a whole activation tree**; the *root* parent consumes no slot (the README explains the root's pool is shared by its descendants).
  - **`ChildLock` absorbs rejections in its chaining tail** so one failed critical section cannot reject an unrelated later caller (`src/activation.ts:~160`).
  - **`observeLocalFailure` records `failureAt` as a session seq, and a later committed `turn/end` at or after that seq clears it** — "a recorded failure still wins over a cancellation, and a later committed turn ending supersedes the live failure" (`src/activation.ts:~115`).
  - **`captureLocalResult` downgrades a missing structured capture to `stopReason: 'error'`** when the child otherwise completed — the parent is told the answer was invalid rather than given a silent empty result.
- **Edge cases & failure handling:** `requireLocalActivation` throws `NOT_CONTINUABLE` for an external child.
- **Surprising:** `Activation.announced` exists so a materialization rolled back before its first accepted delivery owes the parent **no settlement account** — the parent was told that child does not exist.

#### `packages/subagent/subagent/src/assistant-output.ts`
- **Purpose:** The **canonical** rule for choosing a child's final assistant output — used by every backend and by `subagent/end.lastAssistantMessage`.
- **Key abstractions:** `AssistantOutputFold` (with `push(event)`, `pushText(text)`, `collect()`), `finalAssistantOutput(events)`.
- **Data flow:** session events and raw transport text both fold into the same object; `collect()` returns the last non-empty assistant message, else the accumulated streamed text, else `undefined`.
- **Non-obvious design decisions:**
  - **One rule, two transports.** Session-event backends `push` events; ACP content chunks `pushText` raw text into *the same* streamed fallback — so the answer does not depend on which backend produced it.
  - **An empty-content assistant message is skipped**, because the loop appends it after a max-tokens step with no executable blocks (usage-only) (`src/assistant-output.ts:~35`).
  - **Selection is independent of the run's stop reason.**
- **Edge cases & failure handling:** a child that produced neither messages nor text returns `undefined` (the caller maps that to `output: []`).
- **Surprising:** `finalAssistantOutput` carries a `TODO` admitting it folds the whole suffix once per settlement and could be optimised with a backward scan with early exit.

#### `packages/subagent/subagent/src/descriptor.ts`
- **Purpose:** The durable, model-hidden `subagent/descriptor` session event — the identity and resumable composition of every session-backed child.
- **Key abstractions:** `SUBAGENT_DESCRIPTOR_VERSION = 3`, `SubagentDescriptorData`, `OneShotSubagentDescriptorData`, `ContinuableSubagentDescriptorData`, `snapshotSubagentDescriptor(input)`, `foldSubagentDescriptor(events)`.
- **Data flow:** the manager snapshots explicit fields → appends one `subagent/descriptor` to the child's own log → a cold resume folds it back and reconstructs the child's options and composition.
- **Non-obvious design decisions:**
  - **Explicit fields, not the merge-extensible `AgentOptions` object.** An unrelated extension value cannot make continuation fail merely because it is not JSON, and adding a composition input requires a deliberate version bump (`src/descriptor.ts:~14`).
  - **The descriptor deliberately omits `subagentDepth`** (cold resume trusts the persisted header's `delegationDepth` as the monotone floor), **`outputSchema`** (one activation's contract, not durable composition), and per-activation knobs like `maxTokens`.
  - **The FIRST `subagent/descriptor` event is authoritative** — the establishing provider appends exactly one, so a later same-type event cannot rewrite the declared composition (`foldSubagentDescriptor`).
  - **Unknown fields are rejected loudly** (`assertKnownKeys`), and an unknown *version* returns `undefined` ("this child cannot be classified by this runtime") rather than throwing.
- **Edge cases & failure handling:** `snapshotJsonValue` returns `undefined` for a non-losslessly-JSON-serialisable candidate → throws.
- **Surprising:** the descriptor's own doc-comment states that a cold-resumed child "neither restores the prior budget nor inherits the parent's current one; the resumed route's defaults apply instead" — a deliberate decision to avoid a silent budget change.

#### `packages/subagent/subagent/src/catalog.ts`
- **Purpose:** Parent-owned durable `subagent/catalog` events and their chunked host projection.
- **Key abstractions:** `SUBAGENT_CATALOG_VERSION = 0`, `EXTERNAL_SUBAGENT_CATALOG_VERSION = 2`, `SubagentCatalogEvent` (versions 0/1/2), `subagentCatalogProjectionDefinition`, `establishCatalogChild(parent, child, descriptor)`, `establishExternalCatalogChild(parent, childId, label)`.
- **Data flow:** creation appends one catalog fact to the *parent's* session; the projection folds them into `SubagentCatalogEntry[]` in event order; `listChildren` reads that projection without touching child logs.
- **Non-obvious design decisions:**
  - **Three payload versions coexist and the reader supports all three**: v0 = local modes, v1 = adds `mode: 'unknown'`, v2 = records external executions (`src/catalog.ts:~40`).
  - **`mode: 'unknown'` keeps a historical child visible without claiming continuation support**, and an existing complete entry stays authoritative.
  - **Catalog entries record membership once at creation and carry no execution status** — the catalog answers "what children exist", never "how did they go" (`src/catalog.ts:~120`).
  - **The projection's `apply` ignores inherited facts** (`event.seq < state.inheritedEventCount`), so a fork's replayed ancestor facts do not pollute the child's catalog.
- **Edge cases & failure handling:** the projection uses a **chunked list** (`appendChunkedList`) so a parent with thousands of children does not grow one unbounded array.
- **Surprising:** the catalog uses **zod** (`zod@4.4.3`) while the rest of the seam's *config* uses **schemastery** — the boundary between persisted wire data and loader config uses different validators on purpose.

#### `packages/subagent/subagent/src/child-agent.ts`
- **Purpose:** Shared in-process child composition — depth budget, durable session metadata, resolved child `AgentOptions`, the delegated policy seed, and the scoped setup.
- **Key abstractions:** `resolveChildDepth(parent, maxDepth)`, `SubagentDepthError`, `parentAgentOptionsForDelegation(parent)`, `resolveChildAgentOptions(parent, requested, childDepth)`, `childSessionMeta(parent, childDepth, isSeeded, selectedPreset?)`, `applyChildComposition(childCtx, parent, composition)`, `captureDelegatedPolicyOverrides(parent)`, `appendDelegatedPolicyOverrides(childSession, overrides)`, `SUBAGENT_DELEGATION_CONTEXT`, `ChildComposition`, `DelegatedPolicyOverrides`, `ChildCreateInputs`.
- **Data flow:** parent → depth resolution → option merge → session meta → composition mount → policy snapshot appended to the child's own log.
- **Non-obvious design decisions:**
  - **The delegation-scope statement is a *runtime context*, not a system-prompt section**, so the deployment's system prompt stays uniform across parents and children: *"your permission scope was fixed when you were started and cannot be widened from inside this session … state the limitation in your reply so the delegating agent can handle it."* (`src/child-agent.ts:~180`).
  - **The parent's *latest logged request* owns provider/model/effort, not its creation options** (`parentAgentOptionsForDelegation`) — a mid-session route change is inherited by the next child.
  - **Changing the child's route without naming an effort clears the inherited route-owned effort**, so the selected model resolves its own default (`src/child-agent.ts:~120`).
  - **The child's approval policy is pinned to `'never'` regardless of the parent's own policy** — a delegated child acts only within the scope fixed at delegation. The parent's Auto / Full-access *identity* is inherited, but its sandbox override is captured only when explicit, never a deployment default or a one-shot grant (`src/child-agent.ts:~250`).
  - **The policy snapshot is captured synchronously before the child's first `await`** — "a later parent switch belongs to the parent's future, not to this child."
- **Edge cases & failure handling:** `RangeError` when the child depth leaves the safe-integer range; `PRESET_UNAVAILABLE` when a preset is selected but the preset service is absent.
- **Surprising:** the inherited policy events are appended **after** any fork seed, so "fresh policy wins stale seed state".

#### `packages/subagent/subagent/src/out-of-process.ts`
- **Purpose:** The provider-side vocabulary every out-of-process backend composes: the no-capabilities advertisement, timing validation, cwd validation, the never-reject settlement, and the standard run handle.
- **Key abstractions:** `NO_START_CAPABILITIES` (frozen), `assertPositiveFinite(prefix, name, value)`, `assertUsableCwd(prefix, label, cwd)`, `settleRunResult(parts)`, `subprocessRunHandle(parts)`, `RunResultSettlement`, `SubprocessRunHandleParts`.
- **Data flow:** a backend's `attempt()` → `settleRunResult` → `{ output, diagnostic?, stopReason }` → `subprocessRunHandle` publishes `{ id, result, dispose }`.
- **Non-obvious design decisions:**
  - **`settleRunResult` NEVER rejects.** A child-level failure is *flattened* to `stopReason: 'error'` through a contained diagnostic sink (`src/out-of-process.ts:~150`).
  - **The diagnostic is byte-capped at 4,096 UTF-8 bytes and the truncation is visible** (`\n[diagnostic truncated]`), and the cap **never splits a UTF-8 sequence** (`limitSubagentDiagnostic`, `src/out-of-process.ts:~30`).
  - **`assertUsableCwd` probes `X_OK`, not just `statSync().isDirectory()`** — a mode-600 directory is a directory, but a subprocess cwd needs search permission or spawn fails EACCES (`src/out-of-process.ts:~80`).
  - **`subprocessRunHandle.dispose()` is memoised** — one teardown, idempotent, and it settles *local* cancellation before awaiting the backend's teardown.
- **Edge cases & failure handling:** a throwing `onError` sink is contained so it can never reject the result.
- **Surprising:** the seam's `subprocessRunHandle` deliberately assumes **the child may not cooperate** — local cancellation is settled by the parent, not by the child.

#### `packages/subagent/subagent/src/lifecycle.ts`
- **Purpose:** Lifecycle-edge publication (`subagent/start`, `subagent/end`, `subagent/provider-removed`).
- **Key abstractions:** `ActivationObserver`, `LifecycleEmitter`, `createLifecycleEmitter(ctx, carrier)`, `createActivationObserver(emit, provider, childId, parent)`, `epochStopReason(events)`, `renderThrown`.
- **Data flow:** the manager creates an observer per residency epoch; the observer emits the start edge after publication and the end edge exactly once after the disposal outcome is known.
- **Non-obvious design decisions:**
  - **A failure before residency publishes NO edge** — "inventing one would report a lifecycle the child never had" (`src/lifecycle.ts:~40`).
  - **Every listener is independently contained**: a synchronous throw or a rejected returned promise is logged without starving peers, changing the run, or breaking teardown (`src/lifecycle.ts:~75`).
  - **Scoped dispatch keys its carrier by the exact service instance** — a narrowed stand-in would silently change scope filtering (`src/lifecycle.ts:~55`).
  - **`epochStopReason` derives the reason from the child's log, not from disposal.** A clean ending *and* no accounting turn share one rule: "the epoch finished what it was given unless a cancelled queue says otherwise".
- **Edge cases & failure handling:** an unnameable (future) turn reason maps to `error`, never to `completed`.
- **Surprising:** `renderThrown` catches its own `String(value)` coercion failure and returns `'<unrenderable thrown value>'`.

#### `packages/subagent/subagent/src/continuation-messages.ts`
- **Purpose:** The model-visible messages owned by continuable-subagent orchestration.
- **Key abstractions:** `AgentMessageSource` (`kind: 'agent-message'`, `form: 'relay'`), `SubagentSettledMessageSource` (`kind: 'subagent-settled'`, `form: 'notice'`), `createAgentMessage(sender, content)`, `withContinuableReturnGuidance(parentId, prompt)`, `createSettlementMessage(childId, terminal, continuable?)`.
- **Data flow:** the child's final text → a durable user-role message delivered to the parent, with the diagnostic as a separate text block and structured output as `Structured result: <JSON>`.
- **Non-obvious design decisions:**
  - **An agent message and a settlement notice are deliberately different `MessageSource` kinds.** "A transcript that merged them would credit the child with words it never wrote" (`src/continuation-messages.ts:~25`).
  - **Reasoning and tool-call blocks are stripped; text blocks keep their exact bytes and order.**
  - **The empty-closing-text case is stated explicitly**: `It left no closing message.`
  - **The return guidance names the parent id as JSON** (`JSON.stringify(parentId)`) so a model cannot be confused by quoting, and it tells the child that the parent "does not automatically receive your transcript, tool output, or reasoning" and that "sending a message does not end your turn".
- **Edge cases & failure handling:** the summary vocabulary covers `completed` (with and without continuation), `aborted`, `max-tokens`, `refusal`, `error`, and an unnamed extension variant → "ended abnormally".
- **Surprising:** `refusal` is described as "a pre-step rejection — a hook deny, a policy plugin — discarded input the child had claimed, so the parent must not treat the task as done".

#### `packages/subagent/subagent/src/control.ts` + `control-types.ts`
- **Purpose:** Browser-facing prompt/interrupt validation and the stable, client-safe failure vocabulary.
- **Key abstractions:** `validateControlRequest(method, payload)`, `rejectPrompt(error, childSessionId, signal)`, `CONTROL_ID_SCHEMAS`, `SubagentCatalogRow`, `SubagentListEntry` (child or diagnostic), `SubagentAddress`, `SubagentPromptRequest`, `SubagentPromptReceipt`, `SubagentInterruptReceipt`, `SubagentPromptRequestId`.
- **Data flow:** browser → `@Remote('prompt')` → zod validation → admission → attachment store → child inbox → receipt.
- **Non-obvious design decisions:**
  - **The failure vocabulary is closed and documented**: `subagent/invalid-time-zone`, `subagent/parent-unavailable`, `subagent/not-resumable`, `subagent/unauthorized`, `subagent/attachment-invalid`, `subagent/delivery-unavailable`, plus `gateway/bad-request` / `gateway/cancelled` / `gateway/internal`.
  - **Five internal `SubagentError` codes collapse into ONE public code** (`subagent/delivery-unavailable`) — `DRAINING`, `ACTIVATION_CLOSING`, `ACTIVATION_LIMIT_REACHED`, `CONTINUATION_UNAVAILABLE`, `PERSISTENCE_UNAVAILABLE` — because they are all "temporarily unavailable", not the caller's move.
  - **A code outside the admission vocabulary becomes `gateway/internal`** — "a code outside the admission vocabulary is not the caller's move to make" (`src/control.ts:~85`).
  - **The browser prompt carries a client-minted `requestId` branded as the Session Controller's `session-request-id`**, so a subagent prompt and an ordinary Session prompt share one identity vocabulary.
- **Edge cases & failure handling:** the child inbox "cannot admit the message now" (`ACTIVATION_CLOSING`) is distinct from "the child does not exist" (`NOT_RESUMABLE`).
- **Surprising:** `SubagentListEntry` has a `diagnostic` arm with reason `'corrupt' | 'unsupported' | 'unavailable'` — discovery *reports* broken branches rather than hiding them.

#### `packages/subagent/subagent/src/list-children.ts`
- **Purpose:** Direct-child and recursive descendant discovery from parent-owned catalogs.
- **Key abstractions:** `listChildren(ctx, parentSessionId, signal?)`, `listDescendants(ctx, rootSessionId, signal?)`, `SubagentDescendantListEntry`.
- **Data flow:** `ctx.get('sessionQuery')` → live-preferred `observeSession` → the `subagentCatalog` projection → rows in parent event order.
- **Non-obvious design decisions:**
  - **Each catalog read releases its Session observation before the next branch** — the traversal observes each reachable Session exactly once and releases each observation after materialization.
  - **The traversal is a stack-based pre-order** that preserves each catalog's event order, and it **never loads or resumes a child Agent** (`src/list-children.ts:~70`).
  - **A corrupt branch is reported and skipped, not fatal**: `SESSION_QUERY_CORRUPT_SESSION` / `SESSION_QUERY_SOURCE_CONFLICT` → `corrupt`; anything else → `unavailable` (`src/list-children.ts:~95`).
  - **External entries are leaves** — they have no child Session to read.
- **Edge cases & failure handling:** missing `sessionQuery` / `sessions` / projection → typed `SubagentError`s; cancellation → `CANCELLED`, checked *around* each catalog read.
- **Surprising:** a `mode: 'unknown'` entry is emitted as a **diagnostic** but its catalog is **still traversed** — the unknown child may own continuable grandchildren.

#### `packages/subagent/subagent/src/projection.ts` + `projection-types.ts`
- **Purpose:** Pure session projections for subagent identity (mode/label) and active-turn duration.
- **Key abstractions:** `subagentTimingProjectionDefinition` (`stateVersion: 3`), `subagentIdentityProjectionDefinition` (`stateVersion: 2`), `SubagentTimingProjection`, `SubagentIdentityProjection`, `SubagentCatalogEntry`.
- **Data flow:** `subagent/descriptor` + `turn/start` + `turn/end` events → a fold state → a client-safe view.
- **Non-obvious design decisions:**
  - **Every descriptor RESETS the accumulated timing state**, because a fork seed may contain an ancestor's descriptor and completed turns (`src/projection.ts:~95`).
  - **The identity sentinel is `null`, never `undefined`** — "a value pushed over JSON transports must survive `JSON.stringify` losslessly, where an `undefined` field would be dropped and a stale identity would survive on the receiving side" (`src/projection-types.ts:~55`).
  - **The identity carries the descriptor's `seq`**, and `session.isOwnSeq(seq)` proves the identity came from the child's *own* suffix, not a fork seed's replayed ancestor descriptor.
  - **A malformed descriptor folds to no value instead of throwing** — a projection fold must never throw.
- **Edge cases & failure handling:** `stateVersion` is bumped whenever the shape changes so an older checkpoint row refolds instead of being rejected.
- **Surprising:** the timing projection deliberately *ignores* completed pre-descriptor turns.

#### `packages/subagent/subagent/src/structured.ts`
- **Purpose:** The child-scoped structured-output tool, prompt instruction, terminal guard, and authoritative result capture.
- **Key abstractions:** `STRUCTURED_OUTPUT_TOOL = 'structured_output'`, `STRUCTURED_OUTPUT_INSTRUCTION`, `StructuredAttachment` (`acceptsInput()`, `captured()`), `attachStructuredRuntime(childCtx, schema, canComplete)`.
- **Data flow:** the child calls `structured_output` → schema validated → value staged against *this* `ToolExecution` → the authoritative `tools/result` notification commits it → the manager reads `captured()` after settlement.
- **Non-obvious design decisions:**
  - **The capture commits only after the authoritative `tools/result` succeeds**, and a PTC-mode capture additionally waits for the enclosing `run_code` result.
  - **A monotonic tool guard** (`captured === undefined && pending === undefined ? undefined : 'structured output already recorded…'`) composes monotonically, so **a later prepended listener cannot resurrect dispatch** (`src/structured.ts:~120`).
  - **The staging map is keyed by the `ToolExecution` object identity**, not by the adapter call id — "adapter call ids may repeat across steps, but another execution can never reach this Map entry" (`src/structured.ts:~65`).
  - **A failed result discards its capture and REOPENS input; a committed result keeps it closed.**
  - **The tool is registered on the child's own scope**, so concurrent structured children each see their own schema and disposal leaves no global residue.
- **Edge cases & failure handling:** `ToolArgsError` → an `INVALID_ARGS` isError result so the model retries *in the same turn*; `canComplete()` false → "Wait for all delegated child tasks to finish … before submitting structured output."
- **Surprising:** a child that finishes *cleanly without* a capture is an **immediate error to the parent — deliberately NO re-prompt** (`src/structured.ts:~135`, and the spec that pins it).

#### `packages/subagent/subagent/src/depth.ts` + `error.ts` + `internal.ts` + `client.ts`
- **Purpose:** Delegation-depth accounting, the typed error class, the host-only Queue/Steer adapters, and the browser-safe client vocabulary.
- **Key abstractions:** `delegationDepthOf(agent)`, `assertSubagentMaxDepth(maxDepth)`, `SubagentError` (extends `HarnessError`), `adjacentAgentSendMessageTool` (a `Symbol.for` marker), `markAdjacentAgentSendMessageTool`, `isAdjacentAgentSendMessageTool`, `deliverSubagentPrompt` (symbol-keyed), `queueHostSubagentPrompt`, `steerHostSubagentPrompt`.
- **Data flow:** the persisted header's `delegationDepth` is the **monotone floor**; the runtime `AgentOptions.subagentDepth` may DEEPEN but never lower it.
- **Non-obvious design decisions:**
  - **The header is authoritative and monotone** — "a resumed child arrives with fresh options, and counting it from zero would let it delegate as if it were top-level" (`src/depth.ts:~22`).
  - **The `send_message` tool is marked with a `Symbol.for` identity** so the seam can recognise the standard adjacent-Agent messaging tool **without changing its model-visible schema**.
  - **Host prompt delivery is symbol-keyed** so a host adapter can preserve its own source descriptor "without widening the public Service Definition or impersonating an Agent sender" (`src/internal.ts:~40`).
- **Edge cases & failure handling:** a non-safe-integer, negative, or `-0` depth throws `TypeError`; `Object.is(runtime, -0)` is explicitly rejected.
- **Surprising:** `client.ts` exports only *types* — the browser bundle never receives the manager.

#### `packages/subagent/subagent/src/archive-admission.ts`
- **Purpose:** The `subagent` family of the Workspace registry's archive admission — which subagent descendants of a Session are still inside a turn, and how they stop.
- **Key abstractions:** `installSubagentArchiveAdmission(ctx)`, `runningDescendants(ctx, rootId)`, `describe(ctx, child)`.
- **Data flow:** `workspace/session-activity` → the `subagent` activity family; `workspace/session-stop` → one `child.cancel({ kind: 'parent' })` per running descendant.
- **Non-obvious design decisions:**
  - **Lineage is found by *durable data*, not by a live registry walk** — `parentSession` plus the `origin: 'subagent'` header field, at any depth. **A fork shares the lineage field without the origin** and is therefore an independent conversation that never holds its source (`src/archive-admission.ts:~55`).
  - **A damaged header chain that loops is visited once** (a `visited` set).
  - **One child refusing its cancel must not keep its siblings running for an archived parent** — the loop catches and logs per child (`src/archive-admission.ts:~40`).
- **Edge cases & failure handling:** without the Session query service, or with a damaged descriptor, the item names the child by id alone.
- **Surprising:** this is the *only* place in the shard where the runtime reaches into another subsystem's event surface (`workspace/session-activity`).

---

#### `packages/subagent/tool-subagent/src/index.ts`
- **Purpose:** The model-facing delegation tool — one instance is one provider plus one tool name.
- **Key abstractions:** `Config` (`provider`, `toolName`, `modelSelectionSettings`, `agentOptions`, `agentPreset`, `allowedAgentPresets`, `maxDepth`), `apply(ctx, config, session?)`, `providerWording(inheritsConversation)`.
- **Data flow:** provider lifecycle events → tool registration → model call → `ctx.subagents.startActivation({ delivery: 'parent' })` → `{ kind: 'activation', subagentId }`.
- **Non-obvious design decisions:**
  - **The tool's description is derived from `provider.inheritsParentContext`** — a fresh child gets "it does not see this conversation"; a forked child gets "it does not see the current in-flight turn". The model is never told something false about the child's context (`src/index.ts:~120`).
  - **The tool mirrors the provider's lifecycle**: it registers the tool when the named provider appears and disposes it when the provider leaves, so sibling load order and HMR replacement "cannot strand a dangling tool" (`src/index.ts:~300`).
  - **A numeric `maxDepth` or a configured LLM selection the provider cannot enforce fails at MOUNT, not at first delegation** (`assertSubagentProviderConfiguration`).
  - **The canonical tool result carries no execution Promise and no final output** — `{ kind: 'activation', subagentId }` only. Programmatic result-waiting belongs to the subagent service.
  - **The shared system-prompt section lists only the tools the *calling* agent can actually see** and is emitted by exactly one of them (`visible[0] !== toolName → return ''`), so the paragraph appears once: *"Start independent delegations with `subagent` or `subagent_fork` together in one assistant message and continue useful work while they run."*
  - **A runtime-context notice tells the model the depth budget** — *"Delegation depth for `subagent`: current 1, maximum 1, remaining levels 0. Do not call `subagent` at this depth; carry out the work directly."* — and it is re-resolved at each request.
  - **The model-selection policy is sampled per Session and recorded in the Session**, so a later settings edit cannot mutate a live session.
- **Edge cases & failure handling:** `persona` / `toolFilter` in tool config fails at load with an explicit migration error; a provider that changes *during* the async route preflight aborts the delegation with "retry the delegation".
- **Surprising:** `isConcurrencySafe: () => true` — sibling delegations are explicitly classified as safe to overlap.

#### `packages/subagent/tool-subagent/src/model-selection.ts`
- **Purpose:** Child LLM route selection — the merge rules, the allowlist enforcement, and the live preflight.
- **Key abstractions:** `AllowedModelRoute`, `AllowedModelRouteSchema`, `ModelSelectionPolicy`, `modelRouteKey`, `assertAllowedModelRoutes`, `DelegationModelRequest`, `hasDelegationModelRequest`, `requestedAgentOptions`, `assertAllowedModelSelection`, `hasConfiguredLlmSelection`, `preflightChildLlmRoute`.
- **Data flow:** parent options + tool config + model request → merged child options → allowlist check → live `llm.resolveCallConfig` preflight → child creation.
- **Non-obvious design decisions:**
  - **`provider` and `model` form ONE route and must be supplied together.**
  - **Changing the route without naming an effort clears the configured route-owned effort** so the selected model resolves its own default.
  - **Pure inheritance is outside the allowlist** — "no model-facing choice occurred" — but any explicit route must be on the list.
  - **The preflight happens against the LIVE LLM runtime before the child exists**, so an invalid route fails before any resource is consumed.
- **Edge cases & failure handling:** duplicate routes in a policy are rejected at the configuration boundary; an empty `provider`/`model`/`reasoning_effort` string is rejected at the tool JSON boundary.
- **Surprising:** the route key uses a **NUL separator** (`provider\0model`) so a crafted id cannot collide with another pair.

#### `packages/subagent/tool-subagent/src/preset-selection.ts`
- **Purpose:** Deployment-owned preset choices for one delegation tool.
- **Key abstractions:** `PresetSelectionConfig`, `PresetSelectionRequest`, `SubagentPresetSelection` (`configured`, `choices`, `description`, `validate(ctx)`, `assertProvider(provider)`, `resolve(request)`).
- **Data flow:** config → allowlist validation → preset metadata read (descriptions only) → model-supplied `agent_preset` → resolved id.
- **Non-obvious design decisions:**
  - **The allowlist is checked at load and validated per Agent**, and it **reads preset descriptions but does not ACTIVATE candidate presets.**
  - **`agentPreset` must be included in `allowedAgentPresets`** when both are set — otherwise the deployment default is unreachable from the model.
  - **The check does not activate the preset**; activation failure rejects the *selected* preset when the child is composed.
- **Edge cases & failure handling:** duplicate ids in the allowlist, an absent preset service, and a preset id outside the allowlist all fail loudly.
- **Surprising:** `resolve()` returns the configured `agentPreset` when the model omits the argument — the deployment default is the *fallback*, not an override.

#### `packages/subagent/tool-subagent/src/model-selection-settings.ts` + `model-selection-state.ts` + `list-models.ts`
- **Purpose:** The Host-owned opt-in setting, its durable per-Session record, and the `list_subagent_models` discovery tool.
- **Key abstractions:** `SubagentModelSelectionConfig` (a `Service` on `ctx.subagentModelSelection`), `AllowedModelRouteSchema`, `subagentModelSelectionProjectionDefinition` (`stateVersion: 1`), `subagentModelSelectionPolicy(projections, session)`, `recordSubagentModelSelection(...)`, `registerListSubagentModels(ctx, policy)`.
- **Data flow:** Host setting → sampled per new top-level Session → recorded as a `subagent/model-selection-policy` session event → inherited by child Sessions → enforced at the tool call.
- **Non-obvious design decisions:**
  - **The decision is recorded in the Session, not in the running Agent**, so a later settings edit "cannot mutate a live session" and a restored Session keeps its original policy.
  - **The policy event is log-only** — it carries no `surfaceOp` and never enters model history.
  - **Discovery is advisory but *authorisation* is not**: the catalog may list more than the allowlist, but an unauthorised provider is rejected **before its adapter catalog is called**, and an exact lookup must be allowed before the model's efforts are resolved.
- **Edge cases & failure handling:** `enabled` with an empty route list throws; a durable policy with zero routes throws in the projection fold.
- **Surprising:** `list_subagent_models` is registered by **the delegation-tool instance that owns discovery**, and at most one instance per tool scope may own it — because the tool name is global.

#### `packages/subagent/tool-subagent-control/src/index.ts`
- **Purpose:** The globally named `send_message` and `interrupt_agent` tools — thin adapters over `ctx.subagents.sendMessage()` and `ctx.subagents.interrupt()`.
- **Key abstractions:** `apply(ctx)`, `send_message` (`agent_id`, `message`), `interrupt_agent` (`agent_id`).
- **Data flow:** model call → `exec.agent` (the exact live caller) → the service → a durable user message in the target's inbox.
- **Non-obvious design decisions:**
  - **The tools add no authority of their own** — "the service authorizes the exact live caller against the target's recorded lineage" (`src/index.ts:~100`).
  - **`send_message` returns only acceptance** (the accepted `messageId`), never a reply. A reply is another explicitly addressed `send_message`.
  - **`interrupt_agent` returns when the stop request is *accepted*, not when the target is quiet.**
  - **The `send_message` definition is byte-identical in a fork child** — "model communication adds no child-only tool schema."
- **Edge cases & failure handling:** a call with no `exec.agent` throws loudly ("send_message requires a calling agent").
- **Surprising:** `interrupt_agent`'s description states the asymmetry outright: "You can continue a local direct child's conversation later with send_message. External executions stop permanently and cannot receive follow-ups. Subagents it started will keep running."

#### `packages/subagent/tool-subagent-control/src/list-agents.ts`
- **Purpose:** The globally named `list_agents` tool — direct-child discovery plus recursive descendants, with status refinement.
- **Key abstractions:** `apply(ctx)`, `ListAgentsScope = 'children' | 'descendants'`, `resolveListAgentsRequest`, `statusOf`, `project`.
- **Data flow:** `exec.agent` → `ctx.subagents.listChildren` / `listDescendants` → project → one line per continuable child.
- **Non-obvious design decisions:**
  - **One-shot children are omitted** — "they cannot accept `send_message`, so the model never selects them; discovery still traversed them for descendants."
  - **Status is turn activity, not outcome**: `running` / `inactive`; "neither status describes task completion or outcome."
  - **The rendered line is `<id> [<status>] — <label>`**, and the `descendants` scope inserts ` parent=<id> depth=<n>` *before* the label dash, in pre-order.
- **Edge cases & failure handling:** an empty result renders `(no subagents)`; a caller with no agent throws.
- **Surprising:** the tool's description tells the model *"You will be notified when a subagent finishes; there is no need to keep checking its status"* — the discovery tool is explicitly de-emphasised to stop polling.

---

#### `packages/subagent/subagent-acp/src/index.ts` and `src/run.ts`
- **Purpose:** The out-of-process ACP backend — one fresh child process per run, driven over Agent Client Protocol JSON-RPC on stdio.
- **Key abstractions:** `AcpProvider`, `AcpRunSpec`, `startAcpRun`, `disposeAcpChild`, `acpStopReason`, `acpContentText`, `toAcpPrompt`, `acpConfigurationFailure`, `PermissionPolicy = 'allow' | 'reject'`, `DEFAULT_DISPOSE_EOF_GRACE_MS = 6000`, `DEFAULT_DISPOSE_GRACE_MS = 3000`.
- **Data flow:** request → spawn (through the shared `ctx.subprocess` seam) → `initialize` + `session/new` → publish → `session/prompt` → fold `agent_message_chunk` text → `settleRunResult` → `{ output, diagnostic?, stopReason }`.
- **Non-obvious design decisions:**
  - **The provider advertises NO start-time capabilities** so the seam *rejects* a request needing them rather than silently dropping them.
  - **The stop-reason map is deliberately pessimistic**: `max_turn_requests` and *any* unknown future ACP reason map to `error`, never `completed`.
  - **Diagnostics are a closed vocabulary** built from provider-owned facts only — stderr, exception text, task content, tool input, paths, env values and protocol payloads can never enter them.
  - **The permission decision is a second, separate line** appended only when the run did not complete.
  - **Cancellation does not depend on the child cooperating** — a local `cancelSettled` promise races the prompt RPC.
  - **Startup is a transaction**: the run is published only after `initialize` + `session/new` succeed, and a failure owns the still-private process and reaps it before rejecting, as an `AggregateError` carrying *both* the startup and the cleanup failure.
  - **The teardown ladder is three-tier**: stdin EOF (the child's window to flush persistence and reap its own descendants) → `terminate()` (SIGTERM→SIGKILL) → whole-range exit proof.
  - **`spec.env` merges AFTER the seam's credential scrub**, so an explicitly-forwarded key survives while ambient credentials do not.
- **Edge cases & failure handling:** a malformed `session/new` (no session id) is a `protocol` category failure; a pre-aborted request never spawns the binary at all (pinned by a sentinel-file test); a child that hangs *and ignores `session/cancel`* still settles `aborted` locally.
- **Surprising:** the `processRejected` promise parks **forever** on a clean exit — "a clean exit must never win the startup race".

#### `packages/subagent/subagent-claude-code/src/index.ts`, `src/process.ts`, `src/run.ts`
- **Purpose:** The one-shot Claude Code provider over the official Anthropic Agent SDK.
- **Key abstractions:** `ClaudeCodeProvider`, `ClaudeCodeRunSpec`, `startClaudeCodeRun`, `claudeQueryOptions`, `consumeClaudeQuery`, `successfulResult`, `textTask`, `disposeClaudeCodeChild`, `ManagedClaudeCodeProcess`, `claudeSpawnSpec`, `sdkEnvironmentOverlay`, `CLAUDE_CODE_PERMISSION_MODES` (`dontAsk | acceptEdits | auto | plan | bypassPermissions`).
- **Data flow:** request → `officialQuery({prompt, options})` → the SDK's custom-spawn hook spawns the real CLI under the shared seam → the SDK message stream is iterated → only a strict success is accepted → `settleRunResult`.
- **Non-obvious design decisions:**
  - **Unattended by construction**: `AskUserQuestion` always disallowed; `canUseTool` always denies; `onElicitation` always declines; `onUserDialog` always cancels. `plan` mode additionally disallows `ExitPlanMode` so the plan is returned *without* approving execution.
  - **`settingSources` is deliberately omitted** so Claude Code reads the host's own user/project/local settings — the provider is not hermetic and says so.
  - **A strict success is three conditions** (`subtype === 'success'` AND `!is_error` AND `result.trim() !== ''`) followed by *normal iterator completion*.
  - **The SDK's own limit subtypes map to a `limit` category**, not to a generic `error`.
  - **`sdkEnvironmentOverlay` writes tombstones** — for every name the parent scrub removed, the overlay sets `undefined` so the child environment removes it too.
  - **`ManagedClaudeCodeProcess` gets a no-op `error` listener** because EventEmitter throws on an unhandled `error` event and the SDK attaches its listener *after* custom spawn returns.
- **Edge cases & failure handling:** the `onError` sink is wrapped so a throwing sink can never reject the result; cancellation wins the result race and maps to `aborted` *without* a failure diagnostic; the `run.ts` file carries `jscpd:ignore` markers admitting deliberate duplication with the Codex sibling.
- **Surprising:** the diagnostic is a **fixed single line** — `Product subagent failure (product: Claude Code; stage: …; category: …; exit code: …; signal: …)` — and the SDK's own error strings stay only on the `Error.cause` chain.

#### `packages/subagent/subagent-codex/src/index.ts`, `src/run.ts`, `src/wire.ts`
- **Purpose:** The one-shot Codex provider over the official `codex app-server --stdio` protocol.
- **Key abstractions:** `CodexProvider`, `CodexRunSpec`, `startCodexRun`, `disposeCodexChild`, `codexAppServerArgv`, `textTask`, `CodexAppServerWire`, `CodexWireFailureFacts`, `THREAD_PERMISSION_PARAMS`, `failureInfo`, `unattendedDecision`.
- **Data flow:** request → spawn the fixed app-server argv → `initialize` → `thread/start { cwd, ephemeral: true }` → publish → `turn/start` → wait for `turn/completed` → select the answer.
- **Non-obvious design decisions:**
  - **The binary path is resolved from the package manifest, not from `PATH`** — `createRequire(import.meta.url).resolve('@openai/codex/package.json')` → `manifest.bin.codex`. A host `PATH` cannot shadow it.
  - **stderr is piped and forwarded synchronously** with `writeFileSync(process.stderr.fd, bytes)` — byte order preserved without a backpressure queue, and the comment admits "a slow host sink can block this event-loop turn."
  - **`await new Promise(resolve => setImmediate(resolve))` appears four times** as a deliberate "one I/O turn" barrier so stderr already queued in Node reaches the Host before the result settles.
  - **The wire class exposes no generic request surface**: "Supporting another product method must first become part of the provider contract." Unknown server requests *fail the run*.
  - **Answer selection has a three-level precedence**: latest `phase: 'final_answer'` > latest `phase: 'partial_answer'` > latest `phase: null`; `commentary` is never selected and any *other* phase fails the run.
  - **Every server request is validated against the current thread AND turn id** — a request referencing another thread or turn is a protocol error.
  - **A request that arrives before `turn/start` returns are "provisional"**; its diagnostic is deferred until `commitTurnId()` so the recorded order stays truthful.
  - **Diagnostics are ordered by an observation counter** — a later observation only replaces an earlier one.
- **Edge cases & failure handling:** `contextWindowExceeded` → `limit` **and** a `max-tokens` stop reason (not an error); `sandboxError` → `access-policy` plus a sandbox diagnostic; `httpStatusCode` retained only when an integer in `[0, 65535]`; `unattendedDecision` **throws** when the server offers neither `cancel` nor `decline` — the provider refuses to guess an approval decision.
- **Surprising:** `wire.interrupt()` is best-effort only — "local settlement and process teardown remain authoritative when the child no longer accepts protocol requests."

#### `packages/subagent/subagent-dsh-sdk/src/index.ts`, `src/run.ts`
- **Purpose:** The out-of-process backend that runs each child as a *complete DeepSeek Harness runtime* in its own process, over the stdio JSON-RPC SDK client.
- **Key abstractions:** `SdkSubagentProvider`, `SdkRunSpec`, `startSdkRun`, `sdkConfigurationFailure`, `sdkChildOutcome(reason)`, `SDK_START_CAPABILITIES`, `resolveSdkRoute`, `internals.createHarness`.
- **Data flow:** request → resolve the route → `harness.start()` (SDK client spawns the child) → publish → `session/prompt` → `session/wait` → fold the child's session events → `settleRunResult`.
- **Non-obvious design decisions:**
  - **This is the only backend that advertises `agentOptions: true`** — it can choose the child's provider/model/reasoning/maxTokens. `agentPreset`, `outputSchema` and `depthLimit` remain false.
  - **`agentRouteDefaults` publish the configured provider/model baseline to the tool layer** before model overrides and exact-route preflight.
  - **`reasoningEffort` has NO provider-instance default** — an omitted request leaves it absent so the selected child model resolves its own default.
  - **`dshHome` must be an ABSOLUTE path**, and patch files are resolved and stat-checked **at plugin load** — a missing patch is a load-time failure, not a first-run failure.
  - **The child keeps the parent's ORIGIN directory while starting in the selected effective directory** — `cwd: spec.originCwd ?? spec.cwd` for the handshake, `spec.cwd` for the working directory.
  - **The child is spawned by the SDK client rather than `ctx.subprocess`** — the documented exception for SDK-managed transports — so this backend applies the seam's env scrub itself.
- **Edge cases & failure handling:** the child's last durable `turn/end` maps into the seam vocabulary (`completed`/`max-tokens` pass through, `blocked` → `refusal`, `interrupted`/unknown → `error`, missing terminal → `error`); only a child-side `disposed` cause adds a `child-disposed` diagnostic, and an ordinary abort is diagnostic-free.
- **Surprising:** the answer is read from the child's **ordered session events** — the last complete non-empty `assistant/message` (an empty-content usage-only message is skipped), else the accumulated `text-delta` stream.

#### `packages/subagent/subagent-fork-in-process/src/index.ts`
- **Purpose:** The in-process FORK backend — a child seeded with the parent's completed-turn prefix.
- **Key abstractions:** `ForkInProcessProvider`, `completedTurnPrefix(parent)`, `Config` (`providerName` default `fork`).
- **Data flow:** parent session snapshot → find the last `turn/end` → slice to it → the seed becomes the child's own durable transcript.
- **Non-obvious design decisions:**
  - **The seed ends at the parent's last `turn/end`** — "the current tool-call turn is unbalanced and cannot be replayed as a valid child session."
  - **The prefix is captured ONCE, at creation** — it becomes part of the child's own transcript, so a later cold resume replays *that* prefix instead of re-forking the parent's newer history.
  - **`seq === array index`** (the append contract) so the slice is a valid seed beginning at sequence zero.
  - **`tools` is deliberately NOT injected** — the per-run structured runtime gates its capture-tool registration on `tools` itself, so injecting it would change the delegation tool's position in the model-visible tool list.
- **Edge cases & failure handling:** before the first completed turn the seed is empty and the child behaves like a fresh spawn.
- **Surprising:** the fork provider advertises `outputSchema: true` and `depthLimit: true` but **`agentPreset: false`** — independent preset selection is meaningless for a seeded child.

#### `packages/subagent/subagent-spawn-in-process/src/index.ts`
- **Purpose:** The in-process SPAWN backend — a fresh child agent on the same Cordis context.
- **Key abstractions:** `SpawnInProcessProvider`, `prepareContinuable()`, `Config` (`providerName` default `spawn`).
- **Data flow:** `prepareContinuable()` returns `{}` (no seed) → the manager creates the child Agent with the parent's cwd, lineage, provider, model, reasoning effort and output-token limit.
- **Non-obvious design decisions:**
  - **It is the only backend advertising all four capabilities** (`agentOptions`, `agentPreset`, `outputSchema`, `depthLimit`) because it constructs the child itself.
  - **`prepareContinuable()` returning `{}` — "a spawned child starts fresh, so it contributes no seed."**
  - **`tools` is deliberately not injected** for the same reason as fork.
- **Edge cases & failure handling:** `startActivation` refuses a reserved `childId` for a provider without `prepareContinuable` (`UNSUPPORTED_CAPABILITY`).
- **Surprising:** the cheapest transport is also the only one that can honour a depth cap — the cap is enforced by the parent because the parent constructs the child.

---

### Tier 2 — bulk: a compact table, one row per file

#### `packages/subagent/` — package group

| File | What it is / what it pins |
| --- | --- |
| `packages/subagent/README.i18n.yaml` | Generated bilingual-pair section-hash record for the package-group README; pins that the EN/ZH READMEs stay section-by-section in sync (a `pnpm run verify-translation-pairing --write` target). |
| `packages/subagent/README.md` | The package-group index: the nine packages, their roles, and the `ctx.subagents` / `ctx.tools` registration keys. Decides that delegation is a *capability family* with one seam, six backends and two tool packages. |
| `packages/subagent/README.zh.md` | Chinese translation of the package-group index. |

#### `packages/subagent/subagent-acp/` — ACP backend

| File | What it is / what it pins |
| --- | --- |
| `packages/subagent/subagent-acp/README.i18n.yaml` | Generated EN/ZH section-hash record. |
| `packages/subagent/subagent-acp/README.md` | The ACP backend contract: the config table, the stop-reason mapping, the "safe diagnostics" rules (one fixed line; no stderr / task / paths / creds; 4,096-byte cap), failure/recovery, and the known limits (fresh process per run, local workspaces only, no optional start-time capabilities, permission prompts auto-answered). |
| `packages/subagent/subagent-acp/README.zh.md` | Chinese translation. |
| `packages/subagent/subagent-acp/package.json` | Manifest; peer-deps on `dsh-subagent`/`dsh-subprocess`/`dsh-timeout`, dependency on `@agentclientprotocol/sdk@1.4.0`. |
| `packages/subagent/subagent-acp/tests/fixtures/acp-transport.patch.yml` | Disables the claude-code and codex hook rows so the ACP transport tests use the shared model config with no external hooks. |
| `packages/subagent/subagent-acp/tests/fixtures/loader/acp.patch.yml` | Loader fixture: mounts the ACP provider with `process.execPath` + the mock ACP server, `permission: reject`, and env switched by `DSH_TEST_ACP_MODE` (echo-cwd vs diagnostic). |
| `packages/subagent/subagent-acp/tests/fixtures/loader/driver.ts` | Headless Loader driver: one delegation turn, then `waitForChildren` + `whenIdle` + `sessions.flush`. |
| `packages/subagent/subagent-acp/tests/fixtures/loader/mock-delegating-llm.ts` | Mock LLM adapter that scripts exactly one `subagent` tool call and then acknowledges the tool result. |
| `packages/subagent/subagent-acp/tests/loader-composition.e2e.ts` | Keyless real-composition proof through the production profile: the child inherits the parent session cwd, and the remote-limit diagnostic is presented *separately* from the partial output. |
| `packages/subagent/subagent-acp/tests/mock-acp-server.ts` | The scripted mock ACP **agent** (a real subprocess) with ~20 env switches driving every edge case: crash-on-initialize, crash-after-chunk, ignore-cancel, trap-SIGTERM, flush-on-EOF, ignore-EOF (SIGTERM proof), echo-cwd, permission prompts, missing session id, readiness/release files. |
| `packages/subagent/subagent-acp/tests/subagent-acp.e2e.ts` | With-key e2e: drives the real `dsh` ACP profile and asserts the **filesystem effect** (`proof.txt`) independently of the model's answer. |
| `packages/subagent/subagent-acp/tests/subagent-acp.spec.ts` | The keyless integration suite (1,588 lines): the stop-reason map, env layering (ambient credential dropped / explicit key kept), the three-tier teardown ladder with fake timers, cwd resolution, the "never spawn on a pre-aborted signal" sentinel, cancellation that does not depend on the child, and the "diagnostic never contains the secret" assertions. |
| `packages/subagent/subagent-acp/tsconfig.json` | Project references for the ACP package. |

#### `packages/subagent/subagent-claude-code/` — Claude Code backend

| File | What it is / what it pins |
| --- | --- |
| `packages/subagent/subagent-claude-code/README.i18n.yaml` | Generated EN/ZH section-hash record. |
| `packages/subagent/subagent-claude-code/README.md` | The Claude Code bundle contract: the bundle install flow, the `permissionMode` table (`dontAsk`/`acceptEdits`/`auto`/`plan`/`bypassPermissions`), the "native settings are authoritative" rule, the run flow, and the known limits (no continuation, no host-CLI fallback, no wall-clock timeout, no side-effect rollback). Also discloses the 92 MB packed / 325 MB unpacked payload and the pinned Agent SDK 0.3.263. |
| `packages/subagent/subagent-claude-code/README.zh.md` | Chinese translation. |
| `packages/subagent/subagent-claude-code/cordis.patch.yml` | Profile layer: inserts the `subagent-claude-code` provider row and a `tool-subagent-claude-code` tool row bound to it. |
| `packages/subagent/subagent-claude-code/icon.svg` | 807-byte 36×36 plugin-art SVG (two rounded rects with two linear gradients). Asset; content confirmed, not analysed as artwork. |
| `packages/subagent/subagent-claude-code/locale/en.json` | English plugin title/description for the bundle installer. |
| `packages/subagent/subagent-claude-code/locale/zh.json` | Chinese plugin title/description. |
| `packages/subagent/subagent-claude-code/package.json` | Manifest; pins `@anthropic-ai/claude-agent-sdk@0.3.263` and declares `dsh.bundle.patch`. |
| `packages/subagent/subagent-claude-code/tests/fixtures/loader/claude-code.patch.yml` | Loader fixture mounting a fixture provider plus *three* named Claude instances (`claude-code`, `claude-primary`, `claude-secondary`) and four tool rows. |
| `packages/subagent/subagent-claude-code/tests/fixtures/loader/driver.ts` | Driver printing registered providers, their capabilities, tool parameter names, the job tools and the start count — without starting a product process. |
| `packages/subagent/subagent-claude-code/tests/fixtures/loader/fixture.ts` | Re-exports the Codex sibling's composition-only parent adapter. |
| `packages/subagent/subagent-claude-code/tests/loader-composition.e2e.ts` | Proves the Loader registers the providers and tools with `PATH: ''` — i.e. loading the package never probes or starts a Claude binary. |
| `packages/subagent/subagent-claude-code/tests/messages-fixture.ts` | A loopback-only Anthropic Messages SSE server (`complete` / `hold` / `tool-use`) that records every request. |
| `packages/subagent/subagent-claude-code/tests/real-deepseek.e2e.ts` | With-key e2e against the real DeepSeek Anthropic-compatible endpoint via the real SDK + CLI; asserts the exact nonce and that every spawned handle is quiescent. |
| `packages/subagent/subagent-claude-code/tests/real-product.spec.ts` | Real-CLI suite: settings inheritance, the fake key reaching `x-api-key`, the max-turns mapping, two named instances running concurrently, `bypassPermissions` writing a file, `plan` mode returning a plan, and cancellation leaving the CLI tree quiescent. |
| `packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts` | The keyless unit suite (1,761 lines, ~45 cases): task admission, the descriptor/config validation, HMR isolation, duplicate provider names, the official spawn projection, the fixed unattended options, the strict-success rule, publication/cancellation/settlement ordering, and the disposal ladder. |
| `packages/subagent/subagent-claude-code/tsconfig.json` | Project references for the Claude Code package. |

#### `packages/subagent/subagent-codex/` — Codex backend

| File | What it is / what it pins |
| --- | --- |
| `packages/subagent/subagent-codex/README.i18n.yaml` | Generated EN/ZH section-hash record. |
| `packages/subagent/subagent-codex/README.md` | The Codex bundle contract: the `permissionMode` table mapped onto `thread/start` fields (`never` / `approve-for-me` / `dangerously-bypass-approvals-and-sandbox`), the answer-selection precedence (final → partial → unphased), the coarse failure categories, and the known limits. Discloses the 114 MB / 282 MB payload and the pinned `@openai/codex@0.153.4`. |
| `packages/subagent/subagent-codex/README.zh.md` | Chinese translation. |
| `packages/subagent/subagent-codex/cordis.patch.yml` | Profile layer inserting the `subagent-codex` provider + `tool-subagent-codex` tool rows. |
| `packages/subagent/subagent-codex/icon.svg` | The same 807-byte plugin-art SVG as the Claude Code bundle. Asset; content confirmed, not analysed as artwork. |
| `packages/subagent/subagent-codex/locale/en.json` | English plugin title/description. |
| `packages/subagent/subagent-codex/locale/zh.json` | Chinese plugin title/description. |
| `packages/subagent/subagent-codex/package.json` | Manifest; pins `@openai/codex@0.153.4`, declares `dsh.bundle.patch`. |
| `packages/subagent/subagent-codex/tests/deepseek-responses-bridge.ts` | A loopback Responses→DeepSeek bridge for the credentialed e2e: it accepts exactly one request, asserts the nonce is present, forwards to the real API with the bearer credential, and streams the Responses SSE events back. |
| `packages/subagent/subagent-codex/tests/fixtures/loader/codex.patch.yml` | Loader fixture mounting the default plus two named Codex instances and three tool rows. |
| `packages/subagent/subagent-codex/tests/fixtures/loader/driver.ts` | The Codex composition driver (same shape as the Claude Code one). |
| `packages/subagent/subagent-codex/tests/fixtures/loader/fixture.ts` | A parent adapter whose `stream()` **throws** if the composition-only test ever invokes a model. |
| `packages/subagent/subagent-codex/tests/loader-composition.e2e.ts` | Proves the Loader registers the providers and tools with `PATH: ''` — no Codex binary is probed or started. |
| `packages/subagent/subagent-codex/tests/real-deepseek.e2e.ts` | With-key e2e: the real app-server against the real DeepSeek API returning one unique nonce. |
| `packages/subagent/subagent-codex/tests/real-product-cleanup.ts` | Cleanup helper that disposes contexts and HTTP fixtures *before* removing temp roots, captures all registries first, attempts every cleanup, and reports every failure together. |
| `packages/subagent/subagent-codex/tests/real-product-cleanup.spec.ts` | Pins that cleanup helper: per-stage failure attribution, sibling roots still removed after one fails, resources registered during pending cleanup kept for their own cleanup. |
| `packages/subagent/subagent-codex/tests/real-product.spec.ts` | Real `@openai/codex 0.153.4` suite (7 cases): approve-for-me returning exact text, a missing platform payload with no host-CLI fallback, two named instances concurrently, a denied command reported safely, a service failure and an early app-server exit, an explicit dangerous-bypass write in the isolated workspace, and cancellation leaving the tree quiescent. |
| `packages/subagent/subagent-codex/tests/responses-fixture.ts` | A loopback Responses SSE fixture with a scriptable behaviour list (`complete` / `error` / `functionCall` / `advertisedFunctionCall` / `hold`) that records every request. |
| `packages/subagent/subagent-codex/tests/subagent-codex.spec.ts` | The keyless unit suite (2,332 lines, ~60 cases): the wire's handshake/thread/turn payloads, the answer-selection ranking, error grouping (string and object forms), the five unattended request classes, conflicting turn identities, the run lifecycle and quiescence, stderr forwarding without classification, and `disposeCodexChild`. |
| `packages/subagent/subagent-codex/tsconfig.json` | Project references for the Codex package. |

#### `packages/subagent/subagent-dsh-sdk/` — nested-Harness backend

| File | What it is / what it pins |
| --- | --- |
| `packages/subagent/subagent-dsh-sdk/README.i18n.yaml` | Generated EN/ZH section-hash record. |
| `packages/subagent/subagent-dsh-sdk/README.md` | The SDK backend contract: the config table, the `agentOptions` subset it accepts, the `agentRouteDefaults` publication, the stop-reason mapping from the child's last `turn/end`, the "child transcript stays in the child's own session root" rule, and the known limits. |
| `packages/subagent/subagent-dsh-sdk/README.zh.md` | Chinese translation. |
| `packages/subagent/subagent-dsh-sdk/package.json` | Manifest; peer-deps on `dsh-sdk-client`/`dsh-session`/`dsh-subagent`/`dsh-subprocess`. |
| `packages/subagent/subagent-dsh-sdk/src/index.ts` | (Tier 1 above.) |
| `packages/subagent/subagent-dsh-sdk/src/run.ts` | (Tier 1 above.) |
| `packages/subagent/subagent-dsh-sdk/tests/fixtures/loader/child-mock-llm.ts` | The scripted model for the CHILD runtime: it asserts the exact route (`mock/mock-routed/max/777`) and can stream partial text before a fixed provider error. |
| `packages/subagent/subagent-dsh-sdk/tests/fixtures/loader/child.patch.yml` | SDK-profile patch for the child runtime: disables the real LLM, sets a `personaPrefix`, disables agent instructions, and points session persistence at the isolated `DSH_HOME`. |
| `packages/subagent/subagent-dsh-sdk/tests/fixtures/loader/driver.ts` | Headless Loader driver for one delegation turn through the SDK provider. |
| `packages/subagent/subagent-dsh-sdk/tests/fixtures/loader/dsh-sdk.patch.yml` | Test-only SDK provider patch: disables the shipped tool, mounts the scoped delegation tool with `agentOptions.maxTokens: 777`, and injects the child home and patches from env. |
| `packages/subagent/subagent-dsh-sdk/tests/fixtures/loader/mock-delegating-llm.ts` | Parent-side delegating mock that records the resolved parent route to a file and can request a routed or default child route. |
| `packages/subagent/subagent-dsh-sdk/tests/fixtures/loader/nested-mock-llm.ts` | The gated nested-fork model: a child that holds its prompt until a release file appears, plus an `agent/status` listener that marks the root idle. |
| `packages/subagent/subagent-dsh-sdk/tests/fixtures/loader/scoped-tool-subagent.ts` | Mounts the delegation tool in each fixture Agent's own scope, forwarding the tool config. |
| `packages/subagent/subagent-dsh-sdk/tests/loader-composition.e2e.ts` | Keyless real-composition proof: the child runs the model-selected route in the parent workspace, the child's own persisted session header carries the route, and a child error's diagnostic is presented *separately* from the partial output. |
| `packages/subagent/subagent-dsh-sdk/tests/nested-delegation.e2e.ts` | The nesting proof: for both the SDK and ACP backends and for complete / cancel / error outcomes, a child that itself forked a grandchild must finish the nested work before the external task settles — the external task does not settle while the grandchild is in flight. |
| `packages/subagent/subagent-dsh-sdk/tests/subagent-dsh-sdk.spec.ts` | The keyless integration suite (991 lines, ~45 cases): the stop-reason mapping, route override isolation across concurrent children, env scrubbing, the durable-text-on-error cases, startup rollback aggregation, cancellation semantics, and the load-time validation of timing bounds, `dshHome` and `maxTokens`. |
| `packages/subagent/subagent-dsh-sdk/tsconfig.json` | Project references for the SDK package. |

#### `packages/subagent/subagent-fork-in-process/` and `subagent-spawn-in-process/`

| File | What it is / what it pins |
| --- | --- |
| `packages/subagent/subagent-fork-in-process/README.i18n.yaml` | Generated EN/ZH section-hash record. |
| `packages/subagent/subagent-fork-in-process/README.md` | The fork contract: the "seed boundary" (the seed ends at the parent's last completed turn), the one-time-snapshot rule, the KV-cache reasoning for not exposing a child LLM route, and the model experience (what the child sees, token and cache effects). |
| `packages/subagent/subagent-fork-in-process/README.zh.md` | Chinese translation. |
| `packages/subagent/subagent-fork-in-process/locale/en.json` | English plugin title. |
| `packages/subagent/subagent-fork-in-process/locale/zh.json` | Chinese plugin title/description. |
| `packages/subagent/subagent-fork-in-process/package.json` | Manifest; peer-deps on `dsh-agent`/`dsh-session`/`dsh-subagent`. |
| `packages/subagent/subagent-fork-in-process/tests/multi-subagent.spec.ts` | The coexistence proof: one parent delegates to a `spawn` child *and* a `fork` child on the same context, the two are distinct sessions with parent lineage, only the fork inherited the parent's prefix, and the parent's own log records only its own two turns. |
| `packages/subagent/subagent-fork-in-process/tests/subagent-fork-in-process.spec.ts` | Pins the fork's seed semantics: an unseeded fresh child, the seed through the last `turn/end`, a balanced seed when forking mid-turn, structured capture through the shipped plugin, the "seeded parent output is NOT returned as the child's output" rule, and the capability advertisement. |
| `packages/subagent/subagent-fork-in-process/tsconfig.json` | Project references for the fork package. |
| `packages/subagent/subagent-spawn-in-process/README.i18n.yaml` | Generated EN/ZH section-hash record. |
| `packages/subagent/subagent-spawn-in-process/README.md` | The spawn contract: the cheapest transport, what the child inherits (cwd, lineage, provider, model, reasoning effort, output-token limit) and what it does not (the parent transcript), plus the cold-resume and preset rules. |
| `packages/subagent/subagent-spawn-in-process/README.zh.md` | Chinese translation. |
| `packages/subagent/subagent-spawn-in-process/locale/en.json` | English plugin title. |
| `packages/subagent/subagent-spawn-in-process/locale/zh.json` | Chinese plugin title/description. |
| `packages/subagent/subagent-spawn-in-process/package.json` | Manifest; peer-deps on `dsh-subagent`. |
| `packages/subagent/subagent-spawn-in-process/tests/harness.ts` | The full real stack harness (DeepSeek adapter + real bash tool + the delegation tool bound to spawn) and a `waitForIdle` that repeats `whenIdle` + `waitForChildren` until nothing remains. |
| `packages/subagent/subagent-spawn-in-process/tests/spawn-in-process.e2e.ts` | Key-gated smoke: a real parent delegates to a real in-process child that writes a file; the **filesystem effect** is asserted independently of the model's reply. |
| `packages/subagent/subagent-spawn-in-process/tests/subagent-spawn-in-process.spec.ts` | The spawn unit suite (421 lines, ~24 cases): the child's own session and lineage, no inherited conversation, depth stamping and the `maxDepth` refusal, the max-tokens and error mappings, pre-aborted rejection, disposal reaching quiescence, cwd inheritance, the `agentOptions.model` override, structured capture, and the "spawning from a DISPOSING parent fails loud with no orphaned child" teaching-error case. |
| `packages/subagent/subagent-spawn-in-process/tsconfig.json` | Project references for the spawn package. |

#### `packages/subagent/subagent/` — the seam

| File | What it is / what it pins |
| --- | --- |
| `packages/subagent/subagent/README.i18n.yaml` | Generated EN/ZH section-hash record. |
| `packages/subagent/subagent/README.md` | The seam contract: the delegation settings (`maxDepth` default 1), **activation capacity** (`maxActiveSubagents` default 8, sampled before every new or cold-resumed activation, admission does *not* queue), local vs external children, child presets, messaging/interrupting/discovering, the settlement notice and the `subagent:delegation` scope statement, and the full known-limit list. |
| `packages/subagent/subagent/README.zh.md` | Chinese translation of the seam contract. |
| `packages/subagent/subagent/locale/en.json` | English plugin title. |
| `packages/subagent/subagent/locale/zh.json` | Chinese plugin title/description. |
| `packages/subagent/subagent/package.json` | Manifest with `peerDependenciesMeta` marking ten services **optional** (preset registry, permission presets, sandbox, sandbox policy, persistence, projections, query, workspace, user approval) — the seam composes opportunistically, never as a hard dependency. |
| `packages/subagent/subagent/tsconfig.json` | Project references for the seam. |
| `packages/subagent/subagent/src/activation.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/archive-admission.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/assistant-output.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/catalog.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/child-agent.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/client.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/continuation-messages.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/control-types.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/control.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/depth.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/descriptor.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/error.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/index.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/internal.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/lifecycle.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/list-children.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/manager.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/out-of-process.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/projection-types.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/projection.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/structured.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/src/types.ts` | (Tier 1 above.) |
| `packages/subagent/subagent/tests/activation-policy.spec.ts` | Pins the delegated policy appended to the child's log before publication: the parent's Auto / Full-access identity, the explicit sandbox override, and the pinned `approval/policy: never`; also that the policy is captured *before* the async child creation and that a child escalation is rejected deterministically even when an answerer would allow it. |
| `packages/subagent/subagent/tests/activation-presets.spec.ts` | Pins composition inheritance at the *model-visible* level: the child reaches the model with its parent's preset tools and prompt sections, records the composition on its header, follows a parent that switched preset while blank, and uses the current generation for an explicit same-id selection. |
| `packages/subagent/subagent/tests/archive-admission.spec.ts` | Pins archive admission: running descendants by durable lineage at any depth with their labels but never forks, a looping damaged lineage visited once, cancellation of running descendants as their parent (idle children and forks left alone), one child's refusal not stopping its siblings, and the listeners dying with the runtime fiber. |
| `packages/subagent/subagent/tests/assistant-output.spec.ts` | Pins the canonical answer-selection rule: the last non-empty message beats a later empty usage-only message; a non-empty message beats text streamed before and after it; textless assistant content still counts as a message; the fallback is text deltas only (no reasoning, no tool results); `undefined` when the child produced neither; and that the fold handles raw ACP-style text pieces. |
| `packages/subagent/subagent/tests/catalog.spec.ts` | Pins the catalog projection: an external child recorded once with its label, detached views that change only for new own facts, event order preserved across chunk rollover and checkpoint restoration, versions 0 and 1 read, recursive chunk state validated, inherited and unrelated events ignored, and external leaves restored alongside local and unknown children. |
| `packages/subagent/subagent/tests/child-agent.spec.ts` | Pins the child option merge: the parent's effort inherited while the route is unchanged, cleared when the route changes, an explicit child effort kept, and the parent's *latest logged* request selection preferred over creation-time values; plus depth validation and the safe-integer bound. |
| `packages/subagent/subagent/tests/continuation-inheritance.spec.ts` | Pins the continuable policy: the snapshot seeded on a fresh start, replayed on cold resume instead of re-capturing the parent, the fork-prefix ordering, a later child-side switch winning over the snapshot, and the unswitched-sandbox case. |
| `packages/subagent/subagent/tests/continuation-messages-adapter.spec.ts` | One case: the parent continues through the default Messages provider after a reasoning-bearing continuable child settles. |
| `packages/subagent/subagent/tests/continuation-messages.spec.ts` | Pins the settlement notice content: reasoning and tool-call blocks omitted, text block order and bytes preserved around them, and closing text shown alongside the structured result and the diagnostic. |
| `packages/subagent/subagent/tests/continuation-presets.spec.ts` | Pins independent spawn presets and cold-resume compatibility: the selection recorded *before* the descriptor, restoration after the parent switches and the provider unloads, the latest projected selection preferred over the creation header, historical children restored through the current parent, an empty-history fork staying on the parent composition, an inherited selection ignored, and a missing/broken preset refusing restoration. |
| `packages/subagent/subagent/tests/continuation.spec.ts` | The seam's largest suite (4,044 lines, 14 describe blocks, **149 cases**): activation capacity (slot reservation before async creation, slot retained through a failed disposal, capacity shared across siblings and providers), `startActivation` semantics (both identities at inbox acceptance, rollback on abort at every stage, the pre-turn descriptor, effort persistence and cold resume), image Queue prompts, direct-child Queue residency routing, human steering delivery, child ownership edges, durability and teardown (child-first forest disposal, scoped drains, the final-flush recheck loop), review regressions, adjacent-Agent delivery, settlement delivery, lifecycle observation, the public API and the error vocabulary, and `SubagentRuntime.interrupt`. |
| `packages/subagent/subagent/tests/control.spec.ts` | Pins the browser control surface: empty ids rejected, unknown delivery rejected, image parts admitted into durable references before delivery, a refused image batch mapping to `subagent/attachment-invalid` and delivering nothing, non-canonical base64 refused without touching the store, a text-only child model refused, the caller-minted identity and canonical browser zone recorded, a non-owner principal recorded, steer using the same admission operation, UTC-only time zones, a dead parent refused, each internal code mapped to its stable public code, and cancellation answered as cancelled. |
| `packages/subagent/subagent/tests/external-activation-helpers.ts` | Registered parent fixtures for external backends: a parent with a real Session and an observable, non-driving Inbox; `startExternalActivation` preserves a backend fixture's workspace input. |
| `packages/subagent/subagent/tests/external-activation.spec.ts` | Pins external execution ownership: startup cancellation stays attached until unpublished resources finish cleanup, accepted work detaches from caller cancellation, a failed execution rejects only after cleanup, a repeatedly-disposed receipt cancels the process **once**, a backend whose result settles only when disposal begins can still be cancelled, user and ancestor authority both interrupt an external run, and the result survives a cleanup failure for both delivery modes. |
| `packages/subagent/subagent/tests/external-lifecycle.spec.ts` | Pins external admission across parent lifetimes: admitted startup observed and released, one parent's drain not cancelling another parent's pending startup, an id collision with a resident Session cleaned up, a repeated external id rejected without disturbing the first execution, messages to a resident external activation refused, and a non-Error backend cleanup rejection contained. |
| `packages/subagent/subagent/tests/fixtures/activation-presets/plugins/preset-tool.js` | A preset row standing in for the agent-plane tool rows a real preset mounts (import-free on purpose). |
| `packages/subagent/subagent/tests/fixtures/activation-presets/presets/coding/agent.cordis.yml` | The `coding` preset composition: one model-facing row. |
| `packages/subagent/subagent/tests/fixtures/activation-presets/presets/reviewing/agent.cordis.yml` | A second `reviewing` preset composition, so a switch is a real switch. |
| `packages/subagent/subagent/tests/list-children.spec.ts` | Pins discovery: historical children listed through a migrated parent, settled local children listed for both delivery modes *without* corpus or child reads, the observation released after the read (and when the projection is missing), cancellation forwarded, inherited fork facts ignored, chunk growth bounded (>1,000 unrelated Sessions ignored), and the descendant walk (external entries as leaves, cold catalogs read without loading an Agent, one-shot and unknown modes traversed, each catalog visited once, corrupt/missing branches reported as diagnostics, root failures propagated). |
| `packages/subagent/subagent/tests/local-activation.ts` | Local backend fixtures over the production activation lifecycle: isolated JSONL persistence, `startTestActivation` returning the published local Agent, and `startPreparedActivation` supplying a test-selected seed through a temporary provider. |
| `packages/subagent/subagent/tests/manager-internals.ts` | Package-private manager state used to place deterministic lifecycle races (`resident`, `locks`, `ownerCtx`, `dropActivation`). |
| `packages/subagent/subagent/tests/out-of-process.spec.ts` | Pins the shared out-of-process vocabulary: `NO_START_CAPABILITIES` is frozen and empty; timing bounds accept positive finite values only; cwd validation accepts an absolute enterable directory and rejects relative, missing, file and non-searchable paths; `settleRunResult` passes a success through and removes the abort listener, reads an in-flight rejection as aborted, and flattens a failure through a contained sink (and without one); `subprocessRunHandle.dispose` is idempotent. |
| `packages/subagent/subagent/tests/parent-result.spec.ts` | Pins parent result delivery *independent of the child's messaging tool*: the closing answer arrives whether `send_message` is absent or unused, and structured output reaches the parent even when the child has `send_message`. |
| `packages/subagent/subagent/tests/parked-wait.spec.ts` | Pins the host-completion race around idle children with preserved input: a revived sibling rechecked after another parked child finishes maintenance, an unpublished grandchild awaited through publish or rollback, a final-result wait released when direct injection parks the idle child during the flush, and a child created during an earlier idle observation discovered. |
| `packages/subagent/subagent/tests/persistence-helpers.ts` | Handle-based session-persistence helpers: `loadStoredSession` and `seedStoredSession` (create → append → flush → close). |
| `packages/subagent/subagent/tests/run-settlement.spec.ts` | Pins the diagnostic byte bound: a multibyte diagnostic is bounded and visibly marked truncated, and provider-returned results follow the same rules. |
| `packages/subagent/subagent/tests/schedule-tools.spec.ts` | Pins that a preset-mounted Schedule tool reaches a delegated child, and that the Host Schedule service refuses the child's own Session with `subagent_session` **without storing a task** — the Session controller can never deliver a reminder there. |
| `packages/subagent/subagent/tests/service.spec.ts` | Pins the service surface: no owned child work before the Agent service is mounted, the catalog projection binding released with the fiber, provider register/list/lookup/remove with rollback when `provider-added` throws, duplicate and absent provider names rejected with typed errors, lifecycle published only after an async provider start with parent scope, distinct lifecycle identities when provider and child ids repeat, no run lifecycle when startup rejects, an enriched end event, contained observer failures, `SubagentError` in the harness error taxonomy, the descriptor round-trip and version rejection, and a disposed parent rejected before provider execution. |
| `packages/subagent/subagent/tests/structured.spec.ts` | Pins structured output (1,003 lines, ~35 cases): the capture consumes accepted input first; a valid call surfaces `result.structured`; the turn stops after the capture (no extra model step); calls that *follow* the capture in the same response are denied; a later prepended listener cannot resurrect dispatch; calls that *precede* it are untouched; an invalid call yields `INVALID_ARGS` and the model retries in-turn; a clean finish without a capture is an immediate error (deliberately no re-prompt); disposal settles `aborted`; descendant messages and notices precede the final capture; new input is rejected after capture; a schema outside the subset fails before any child exists; the commit observes the authoritative result only; the instruction rides only structured requests; each child owns its capture tool so two concurrent children each see their own schema; and a failed execution stage is never promoted by a later call or a reused call id. |
| `packages/subagent/subagent/tests/test-session-query.ts` | A minimal concrete Session query whose search faces are intentionally unavailable. |
| `packages/subagent/subagent/tests/timing-projection.spec.ts` | Pins the timing projection: historical one-shot identity preserved without inventing a label, the projection registered with the optional registry, inherited seed timing reset at the child's descriptor, an open turn's start exposed with no time subtracted for reversed boundaries, only the latest closed turn's completion published, and pre-descriptor turns ignored. |
| `packages/subagent/subagent/tests/working-directory-fixture.ts` | A directory collaborator whose paths are symbolic and whose logs exclude context providers. |
| `packages/subagent/subagent/tests/working-directory.spec.ts` | Pins child working directories: spawn and fork inherit the *current* directory independently of the origin and inherited history; an explicit relative or absolute directory is retained across a cold resume; and a local child whose setup realm has no directory service is rolled back. |

#### `packages/subagent/tool-subagent-control/`

| File | What it is / what it pins |
| --- | --- |
| `packages/subagent/tool-subagent-control/README.i18n.yaml` | Generated EN/ZH section-hash record. |
| `packages/subagent/tool-subagent-control/README.md` | The control-tool contract: `send_message` (acceptance only), `interrupt_agent` (current turn only; local targets keep their inbox and descendants; external executions stop permanently), and `list_agents` (`children` vs `descendants`, the `running`/`inactive` vocabulary, one-shot children omitted, diagnostics only in `descendants` scope), plus the known limits (no independent result, adjacency only, listing is a snapshot, no pagination). |
| `packages/subagent/tool-subagent-control/README.zh.md` | Chinese translation. |
| `packages/subagent/tool-subagent-control/locale/en.json` | English plugin title. |
| `packages/subagent/tool-subagent-control/locale/list-agents/en.json` | English title for the separately loadable list plugin. |
| `packages/subagent/tool-subagent-control/locale/list-agents/zh.json` | Chinese title for the list plugin. |
| `packages/subagent/tool-subagent-control/locale/zh.json` | Chinese plugin title/description. |
| `packages/subagent/tool-subagent-control/package.json` | Manifest with a `./list-agents` export so the discovery tool is separately loadable. |
| `packages/subagent/tool-subagent-control/src/index.ts` | (Tier 1 above.) |
| `packages/subagent/tool-subagent-control/src/list-agents.ts` | (Tier 1 above.) |
| `packages/subagent/tool-subagent-control/tests/list-agents.spec.ts` | Pins the discovery tool: a settled caller-delivery child listed in both scopes; external leaves omitted without diagnostics; the tool registered once globally with only the optional scope parameter; `(no subagents)` for the empty result; direct children rendered in array order with registry statuses; omitted scope resolving to `children` with the parent id and cancellation forwarded; a historical one-shot sibling omitted; the `inactive` vocabulary pinned; a caller without an agent failing loud; HMR unregistration; the namespace export shape; the complete descendant tree walked in pre-order with parent and depth annotations; one-shot intermediates omitted from the output while what they own is surfaced; and an explicit `descendants` scope forwarding the cancellation signal. |
| `packages/subagent/tool-subagent-control/tests/park-parent.ts` | A helper that rejects every step of the stand-in parent so a child settlement cannot pull the parent into the scripted model corpus. |
| `packages/subagent/tool-subagent-control/tests/test-session-query.ts` | The minimal Session query for continuation and catalog integration tests. |
| `packages/subagent/tool-subagent-control/tests/tool-subagent-control.spec.ts` | Pins the control tools: `send_message` registered once globally with two required parameters; the definition and ordering **byte-identical in a fork child**; the parent id JSON-encoded in the return instruction; a continuable child steering its direct parent; a cold-resumed settled child reporting delivery; steering the nearest step of an open turn; a delivery failure rendered as an errored, not-delivered result; a non-parent caller rejected; and for `interrupt_agent`: the parameter set and wording, a running direct child interrupted with the parent cause (its queue parked), a deep live ancestor interrupting a descendant it did not create, self/sibling/unrelated callers rejected without touching the target, an absent target accepted as a no-op without cold-resuming it. |
| `packages/subagent/tool-subagent-control/tsconfig.json` | Project references for the control package. |

#### `packages/subagent/tool-subagent/`

| File | What it is / what it pins |
| --- | --- |
| `packages/subagent/tool-subagent/README.i18n.yaml` | Generated EN/ZH section-hash record. |
| `packages/subagent/tool-subagent/README.md` | The delegation-tool contract: the config table, managed delegation (the call returns `started subagent <childId>` and does **not** wait), the depth policy (`maxDepth` / `provider-managed`), child preset selection, child LLM selection with the exact-route allowlist, the canonical tool result, the context-sensitive wording, the shared system-prompt paragraph and the runtime depth notice, and the known limits. |
| `packages/subagent/tool-subagent/README.zh.md` | Chinese translation. |
| `packages/subagent/tool-subagent/locale/en.json` | English plugin title. |
| `packages/subagent/tool-subagent/locale/model-selection-settings/en.json` | English title for the settings sub-plugin. |
| `packages/subagent/tool-subagent/locale/model-selection-settings/zh.json` | Chinese title for the settings sub-plugin. |
| `packages/subagent/tool-subagent/locale/zh.json` | Chinese plugin title/description. |
| `packages/subagent/tool-subagent/package.json` | Manifest with a `./model-selection-settings` export; `dsh-agent-preset-registry` is an **optional** peer dependency. |
| `packages/subagent/tool-subagent/src/index.ts` | (Tier 1 above.) |
| `packages/subagent/tool-subagent/src/list-models.ts` | (Tier 1 above.) |
| `packages/subagent/tool-subagent/src/model-selection-settings.ts` | (Tier 1 above.) |
| `packages/subagent/tool-subagent/src/model-selection-state.ts` | (Tier 1 above.) |
| `packages/subagent/tool-subagent/src/model-selection.ts` | (Tier 1 above.) |
| `packages/subagent/tool-subagent/src/preset-selection.ts` | (Tier 1 above.) |
| `packages/subagent/tool-subagent/tests/depth-context.spec.ts` | Pins the runtime depth context: the notice appears only at or above the cap, the runtime depth is used when deeper than the saved header, `provider-managed` limits and agentless calls contribute no text, the context follows the *visible* definition and disappears with the provider, and the contribution is disposed with the tool plugin. |
| `packages/subagent/tool-subagent/tests/harness.ts` | The shared harness: the real tool + service stack around one scripted provider, a settings-controlled setup that passes the unpublished Session explicitly, and `callSubagent` executing through the real ToolRuntime pipeline. |
| `packages/subagent/tool-subagent/tests/list-models.spec.ts` | Pins the discovery tool: omitted unless its instance owns discovery; stays registered without the optional LLM service and rejects calls; **two discovery-owning instances in one scope are rejected**; registered providers listed and live changes followed; advertised models listed without treating the catalogue as a whitelist; discovery intersected with the Session allowlist; an unauthorised provider rejected *before* its adapter catalogue is called; exact-model efforts, descriptions and defaults rendered; and every unavailable/empty case reported with the registered alternatives. |
| `packages/subagent/tool-subagent/tests/model-selection-settings.spec.ts` | Pins the Host setting and its per-Session decision: the composed default without a settings provider; default-off following the validated user layer; duplicate routes, an enabled-but-empty setting and an empty durable policy rejected; each new root Session sampled without changing existing definitions; a direct Agent setup installed *before* Session publication; one tool installed even when recording the policy triggers a registry refresh; a forced route outside the policy rejected before child creation; per-Agent definitions installed for a shared preset scope; the installation reservation released after a failed policy selection; the parent's decision inherited and seeded decisions preserved; the Host setting owner and a scoped standing preset both required; the Session registry required for inheritance; and the saved default depth read at each delegation without remounting the tool. |
| `packages/subagent/tool-subagent/tests/model-selection.spec.ts` | Pins the route rules: empty route ids rejected at the configuration boundary; pure inheritance allowed while explicit values outside the allowlist are rejected; deployment/parent defaults outside the allowlist still usable when the call selects nothing; the route fields and discovery exposed when selection is enabled and hidden and rejected when disabled; selection rejected when the provider cannot apply agent options; an unlisted *complete* route accepted and a configured effort cleared when the route changes; an effort-only override accepted; a parent effort inherited only when the route is unchanged; explicit routes compared with the parent's latest logged selection; an effort with no effective route rejected; the live LLM runtime used for provider and effort validation *before* child creation; the configured effort and route validated before child creation; selection rejected when the LLM service is absent; pure inherited routing usable without resolving an LLM route; a fork warned that changing the route can lose inherited-prefix reuse; and an exact-route resolver failure propagated before child creation. |
| `packages/subagent/tool-subagent/tests/preset-selection.spec.ts` | Pins preset selection: configured ids advertised and a model selection forwarded; a default without a model selector; inheritance preserved with neither a default nor an argument; the default used when a selectable argument is omitted and unlisted ids rejected; forced selection rejected at the model JSON resolver; the preset service required when selection is configured; declared metadata read for a broken preset and its composition rejected at mounting; an Agent created from a preset whose delegation tool selects itself; Agent publication rejected when a preset names an absent preset; and a preset advertised without a description. |
| `packages/subagent/tool-subagent/tests/scripted-provider.ts` | The package-local scripted child boundary: a configurable provider whose result aborts if its signal or disposer wins first, with optional structured output and provider-owned route defaults. |
| `packages/subagent/tool-subagent/tests/scripted-provider.spec.ts` | Pins that fixture: registration through the real service, a configurable name, configured and default structured results, structured output omitted when no schema is requested, configured and cancellation stop reasons honoured, cancellation rejected before *and* during async publication, and unregistration with the owning fiber. |
| `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` | Pins the delegation tool (884 lines, ~40 cases): the mount-time rejection of child agent options a provider cannot apply; a managed subagent started and only its id returned; an explicit child directory resolved without changing the parent's; only task inputs exposed (no scheduling controls); delegations classified concurrency-safe and sibling delegations overlapping; a configurable `toolName` so providers coexist; startup skipped when cancellation wins the async route preflight and rejected when the provider changes during it; model overrides merged over provider-owned route defaults; no parent effort inherited for a provider-owned route default; a direct `apply()` bypassing Schemastery; a caller without an agent failing loud; registration when the provider appears *later* (no load-order requirement); the guidance empty while the provider is absent; the guidance shared across visible tools and scoped to the viewing agent's visible definitions; the provider lifecycle mirrored (gone on backend dispose, re-derived wording on re-registration); the tool plugin fiber owning its listeners; other providers' events ignored; spawn-shaped vs inherited-context wording; startup skipped for an already-aborted signal; the tool depending on `ctx.subagents`; the namespace export shape; `maxDepth` passed through and validated; an omitted `agentOptions` not materialising as `{}`; a local activation returning only its durable id; the guidance hidden when the agent cannot see the tool; a cancelled continuable preparation isolated from a concurrent sibling; and the depth budget configuration (`provider-managed` mounting a capability-less provider). |
| `packages/subagent/tool-subagent/tsconfig.json` | Project references for the delegation tool. |
| `packages/subagent/tool-subagent/tsdown.config.ts` | Builds two self-contained Loader entries (`index.js` and `model-selection-settings.js`) so the package needs no private chunks. |

### Tier 3 — skipped with a reason

None. Every file in the shard was opened; the two SVG plugin-art assets
(`packages/subagent/subagent-claude-code/icon.svg`,
`packages/subagent/subagent-codex/icon.svg`) were read as bytes and characterised
(size, dimensions, shape) rather than analysed as artwork, and the ten generated
`README.i18n.yaml` bilingual-hash records were read in full and characterised as
generated consistency records.

---

## 2. Ideas worth stealing

1. **One canonical answer-selection rule, shared by every transport.** `AssistantOutputFold` picks "the last non-empty assistant message, else the accumulated streamed text, else nothing" and both session-event backends and raw-text transports fold into the *same* object (`packages/subagent/subagent/src/assistant-output.ts:31`). **UNIQUE** — and directly transferable: August Trading's agent/tool results should have one selection rule, not one per call site.
2. **A closed, byte-capped diagnostic vocabulary for every failure.** Providers emit `Subagent failure (provider: X; stage: …; category: …; exit code: …)` built only from provider-owned facts; stderr, task text, paths and credentials are structurally excluded; the text is capped at 4,096 UTF-8 bytes with a *visible* truncation marker and never splits a multi-byte character (`packages/subagent/subagent/src/out-of-process.ts:24`, `:145`). **CONVERGENT** — the same "safe diagnostic + separate field" pattern appears in the ACP, Codex, Claude Code and SDK backends.
3. **Reject the unsupported capability, never accept-and-ignore.** A provider advertises exactly what it can enforce; a request needing `outputSchema`/`maxDepth`/`agentOptions`/independent preset is refused *before* any child exists (`packages/subagent/subagent/src/index.ts:~700`). **UNIQUE.** For August Trading: a "run a backtest" agent must refuse a request it cannot honour rather than quietly dropping the parameter.
4. **A capacity pool that reserves *before* yielding and returns the slot only after cleanup.** `maxActiveSubagents` (default 8) is sampled before every new or cold-resumed activation, is shared by a whole activation tree, and **admission does not queue** — because "a parent waiting for descendants must not wait for its own occupied slot" (`packages/subagent/subagent/README.md`, `packages/subagent/subagent/src/activation.ts:14`). **UNIQUE.**
5. **The child says what it cannot do, instead of the parent guessing.** The fixed `subagent:delegation` runtime-context statement: *"your permission scope was fixed when you were started and cannot be widened from inside this session … state the limitation in your reply so the delegating agent can handle it."* (`packages/subagent/subagent/src/child-agent.ts:180`). **UNIQUE.** August Trading's analyst agents could carry the same one-line scope statement.
6. **Tell the model the truth about what the child sees.** The tool's own description is derived from `provider.inheritsParentContext`: a fresh child gets *"it does not see this conversation"*, a forked child gets *"it does not see the current in-flight turn"* (`packages/subagent/tool-subagent/src/index.ts:120`). **UNIQUE.**
7. **A runtime depth notice instead of a hidden cap.** When the caller reaches the cap, a runtime-context line says *"Delegation depth for `subagent`: current 1, maximum 1, remaining levels 0. Do not call `subagent` at this depth; carry out the work directly."* (`packages/subagent/tool-subagent/src/index.ts:~430`). **UNIQUE.** The analogous August Trading move: tell the model when it is out of trade-plan approvals.
8. **A durable, versioned descriptor that snapshots explicit fields instead of a merge-extensible object.** `SUBAGENT_DESCRIPTOR_VERSION = 3`; unknown fields are rejected, an unknown version returns "cannot classify this child", and a new composition input requires a deliberate version bump (`packages/subagent/subagent/src/descriptor.ts:38`, `:96`). **UNIQUE.**
9. **Discovery reads a parent-owned catalog and never opens a child log.** `listChildren` reads one parent projection; `listDescendants` walks reachable catalogs in pre-order, observing each Session once and releasing each observation; external entries are leaves; unreadable branches become *diagnostics* rather than silent omissions (`packages/subagent/subagent/src/list-children.ts:30`, `:70`). **UNIQUE.** A directly transferable pattern for August Trading's "which bots/automations exist" surface.
10. **Ownership edges prevent a parent from settling while a child is still being created.** `holdOwnership(parent, childId)` pre-registers the child so an idle parent cannot finish its turn before the child's first message is accepted (`packages/subagent/subagent/src/manager.ts:~700`). **UNIQUE.**
11. **Three-tier cooperative teardown: EOF → SIGTERM → SIGKILL, with an exit *proof*.** EOF gives the child a window to flush its own persistence and reap its own descendants before any signal; the final wait is the process owner's exit proof, not a derived timer (`packages/subagent/subagent-acp/src/run.ts:186`). **CONVERGENT** — the Codex, Claude Code and SDK backends repeat the ladder.
12. **A "one I/O turn" barrier before settling a result.** `await new Promise(resolve => setImmediate(resolve))` appears deliberately so stderr already queued in Node reaches the Host before the result settles (`packages/subagent/subagent-codex/src/run.ts:308`). **UNIQUE** — a cheap, transferable trick for "flush the log before you claim you are done".
13. **Structured output is a two-phase commit against the authoritative tool result.** The value is staged per `ToolExecution` identity and committed only when the *final* `tools/result` succeeds; a monotonic guard makes later calls unreplayable; a failed result reopens input and a committed result keeps it closed (`packages/subagent/subagent/src/structured.ts:60`, `:120`). **CONVERGENT** with the "capture before publish" pattern in the process backends.
14. **The failure vocabulary is closed at the boundary and collapses internal codes into one public code.** Five internal `SubagentError` codes (`DRAINING`, `ACTIVATION_CLOSING`, `ACTIVATION_LIMIT_REACHED`, `CONTINUATION_UNAVAILABLE`, `PERSISTENCE_UNAVAILABLE`) all become `subagent/delivery-unavailable` for the browser (`packages/subagent/subagent/src/control.ts:60`). **UNIQUE.**

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work: not in this shard.** The only scheduling-adjacent file is `packages/subagent/subagent/tests/schedule-tools.spec.ts`, which proves that a preset-mounted Schedule tool reaches a delegated child but that the Host Schedule service **refuses the child's own Session** with `subagent_session` and stores no task — "the Session controller can never deliver a reminder there". Scheduled/cron work lives in a different shard (`dsh-workflow-jobs-schedule`).
- **Human-in-the-loop approval: approval is delegated away, never surfaced.** Every out-of-process backend auto-answers the child's permission prompts by *policy*, never by asking a human: ACP's `permission: 'allow' | 'reject'` (`packages/subagent/subagent-acp/src/index.ts:46`), Claude Code's `canUseTool` always denying (`packages/subagent/subagent-claude-code/src/run.ts:355`), and Codex's five unattended request classes (`packages/subagent/subagent-codex/src/wire.ts:~640`). The seam records each decision as a **fixed one-line fact** in the diagnostic — `ACP unattended decision (policy: reject; request: execute; decision: denied)` — so an audit trail exists **without** a human in the loop. For August Trading: an agent that wants to place a trade should be denied deterministically and the denial recorded, not queued for a click.
- **Post-mortem / reflection loops: the settlement notice is the reflection seam.** Every settled child produces a durable, parent-visible notice whose summary is chosen from the stop reason — `completed` / `aborted` / `max-tokens` / `refusal` / `error` — with the final text, the structured result and the diagnostic as *separate* blocks (`packages/subagent/subagent/src/continuation-messages.ts:105`). A `refusal` is explicitly described as "a pre-step rejection … discarded input the child had claimed, so the parent must not treat the task as done". **Nothing accumulates into rules here** — no rule/lesson store exists in this shard; the closest analogue is the `subagent/descriptor`, which is a *versioned snapshot of one child's composition*, not a learned rule.
- **Multi-agent: subagents, not debate.** The whole family is delegation, not debate: there is no turn-taking critic, no judge, no round-robin. What the family *does* supply is the substrate debate needs and DSH does not build — one canonical stop-reason vocabulary, one canonical answer-selection rule, one bounded capacity pool, and a strict adjacency rule (`sendMessage()` requires the exact live sender; every sender may target a direct continuable child; only a sender with a *resident* continuable activation may target its direct parent — `packages/subagent/subagent/src/types.ts:~120`). A debate engine would have to supply the adjudication DSH deliberately omits.
- **Structured logs the model can query: a parent-owned chunked catalog plus three session projections.** Discovery data lives in the **parent's own session log** as `subagent/catalog` events, folded by a chunked-list projection into `SubagentCatalogEntry[]`; the child's own identity and turn timing come from `subagent/descriptor`-derived projections (`subagentCatalog`, `subagentTiming`, `subagent`) (`packages/subagent/subagent/src/catalog.ts:60`, `packages/subagent/subagent/src/projection.ts:30`). No database: session logs + a chunked list + three zod-validated projections. The trade-off is documented — descendant reads are **sequential** and a cold Session without a prepared observation needs a full-log read.
- **Staying simple as features accumulate: a named-provider registry plus a closed capability contract.** Nine packages, one seam, four capability flags, and a refusal to grow the contract: method presence *is* the capability (`prepareContinuable` ⇒ local, `start` ⇒ external), the stop-reason map is merge-extensible but closed, and ten services are declared **optional** peer dependencies so the seam composes opportunistically (`packages/subagent/subagent/package.json`, `packages/subagent/subagent/src/types.ts:~340`). The seam also deliberately leaves `subagent/end` **observe-only** — "a run-affecting continuation or decision API waits for a concrete consumer".

---

## 4. Non-obvious decisions and gotchas

1. **An unknown stop reason is never `completed`.** Both the ACP map (`max_turn_requests` and any future variant → `error`) and the SDK map (`interrupted` → `error`, missing terminal → `error`) refuse to report unclean work as success (`packages/subagent/subagent-acp/src/run.ts:215`, `packages/subagent/subagent-dsh-sdk/src/run.ts:~160`).
2. **`inheritsParentContext` is descriptive, not enforced.** It exists so the *wording* can be truthful; it says nothing about tools, scope or authority (`packages/subagent/subagent/src/types.ts:~330`).
3. **Method presence selects the execution model.** A provider with `prepareContinuable` runs as a local, durable, continuable child; a provider with `start` runs as a one-shot external execution. There is no third option (`packages/subagent/subagent/src/index.ts:~420`).
4. **A provider may contribute DATA to a continuable child, never a capability.** `ContinuableCreateSpec` carries only `{ seed }` — the provider never sees the child's Agent, handle, turns or teardown (`packages/subagent/subagent/src/types.ts:~250`).
5. **The child's own log is authoritative for the stop reason.** Teardown success says nothing about whether the model errored or was cancelled (`packages/subagent/subagent/src/lifecycle.ts:~120`).
6. **A clean ending and no accounting turn share one rule.** `completed` only if the epoch closed cleanly *and* had nothing left to run; a cancelled queue makes it `aborted` (`packages/subagent/subagent/src/lifecycle.ts:~135`).
7. **A failure without a later committed `turn/end` settles as `error` — but a later committed turn ending supersedes it** and supplies the recovered outcome (`packages/subagent/subagent/src/activation.ts:115`).
8. **The delegation-depth header is a monotone floor.** The runtime option may deepen but never lower it, "because a resumed child arrives with fresh options, and counting it from zero would let it delegate as if it were top-level" (`packages/subagent/subagent/src/depth.ts:22`).
9. **Admission does not queue at capacity.** At `maxActiveSubagents` the start is *rejected* with `ACTIVATION_LIMIT_REACHED`; waiting would deadlock a parent that waits for its descendants while holding a slot.
10. **The `send_message` tool is identified by a `Symbol.for` marker**, not by name, so the seam can recognise the standard adjacent-Agent messaging tool without changing its model-visible schema (`packages/subagent/subagent/src/internal.ts:12`).
11. **An agent message and a settlement notice are different `MessageSource` kinds** — merging them would credit the child with words it never wrote (`packages/subagent/subagent/src/continuation-messages.ts:25`).
12. **The identity projection's no-value sentinel is `null`, never `undefined`** — `undefined` would be dropped by `JSON.stringify` and a stale identity would survive on the receiving side (`packages/subagent/subagent/src/projection-types.ts:55`).
13. **Every descriptor resets the timing fold**, because a fork seed replays an ancestor's descriptor and turns (`packages/subagent/subagent/src/projection.ts:95`).
14. **The provider's binary path comes from the package manifest, not `PATH`** (`packages/subagent/subagent-codex/src/run.ts:41`).
15. **Codex stderr is forwarded synchronously with `writeFileSync(process.stderr.fd, …)`** — byte order is preserved without a backpressure queue, and the code accepts that a slow host sink can block the event loop (`packages/subagent/subagent-codex/src/run.ts:265`).
16. **`assertUsableCwd` probes `X_OK`, not just "is a directory"** — a mode-600 directory passes `statSync().isDirectory()` but fails a subprocess spawn with EACCES (`packages/subagent/subagent/src/out-of-process.ts:80`).
17. **The diagnostic cap never splits a UTF-8 sequence**, and truncation is *marked* rather than silent (`packages/subagent/subagent/src/out-of-process.ts:30`).
18. **The host Clock's `AbortSignal` for a delivery owns admission only until inbox acceptance** — once accepted, the message cannot be cancelled through the tool (`packages/subagent/tool-subagent-control/README.md`).
19. **`list_agents` deliberately omits one-shot children**, because they cannot accept `send_message` — discovery still traverses them for their descendants (`packages/subagent/tool-subagent-control/src/list-agents.ts:60`).
20. **A fork tool cannot select a child LLM route on purpose** — inheriting the parent's route keeps the copied conversation prefix eligible for KV-cache reuse (`packages/subagent/tool-subagent/src/index.ts:~250`, `packages/subagent/tool-subagent/README.md`).

---

## 5. Weak spots

1. **`manager.ts` is 1,493 lines and owns nearly every lifecycle rule** — admission, capacity, ownership, cold resume, settlement, delivery and teardown in one class. The `jscpd:ignore` markers in the sibling providers admit that the *providers* duplicate each other deliberately ("sibling product providers intentionally keep product-private run inputs and error normalization instead of adding a shared lifecycle owner") — the same reasoning applied to `manager.ts` would have produced a shared, testable lifecycle owner.
2. **The settlement algorithm is a state machine with four states and a re-check loop** (`closed | retry | wait | ready`) that re-reads the session sequence after the final flush. It is correct but hard to reason about, and `packages/subagent/subagent/tests/parked-wait.spec.ts` exists mostly to pin its races.
3. **The `activation-policy` / `continuation-inheritance` pair duplicates the same delegated-policy rules** across two suites, and `packages/subagent/subagent/tests/continuation.spec.ts` is 4,044 lines with 149 cases in one file — the seam's test suite is a monolith that will become slow and hard to bisect.
4. **Process-local residency with no cross-process lease.** The README states it plainly: "the Activation inbox and ownership graph do not coordinate two harness processes; concurrent access to one persistence store needs a durable mailbox and cross-process lease protocol" — and `list_agents` may report a child `inactive` that another process has just activated (`packages/subagent/subagent/README.md`).
5. **A delivered message has no independent result and no exactly-once guarantee.** `send_message` returns only an inbox `messageId`; the target's later work is never collected through the tool, and the child-to-parent path "provide[s] acceptance identity rather than exactly-once delivery" (`packages/subagent/tool-subagent-control/README.md`).
6. **Several deliberate `/* v8 ignore */` and "defensive" branches** (the ACP `processRejected` promise that parks forever, the `Object.is(x, -0)` checks, the `unnameable reason → error` arms) are correct but each is a place a future refactor can silently change behaviour without a test noticing.
