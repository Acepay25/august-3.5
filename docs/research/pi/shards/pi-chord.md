# pi :: pi-chord

**Files in shard:** 109 (read: 109, skipped with reason: 0)
**What this shard covers:** `@earendil-works/chord`, the TypeScript "typed host runtime" of the `pi` monorepo — a
capability/RPC runtime in which **contracts** (runtime TypeBox values, not types) declare *object types*, **hosts**
serve them through synchronous *factories*, and callers only ever hold late-bound **references** whose state is
observable JSON that replicates as a snapshot plus a delta stream. The shard contains the entire runtime (`src/`), its
four design documents, and its whole test suite (63 files, including three benchmark harnesses). The load-bearing ideas
for August Trading are (a) a **publication FIFO** that stops a re-entrant write from overtaking the write being
published, (b) a **prepare → gate → commit → retire** hot-reload protocol with per-cell state migrations and a
retryable `upgrade_conflict` for late old callers, (c) a **transactional JSON delta tracker** with exact operation
batches, and (d) an **explicit `Ctx`** carrying cancellation, code version and principal across process boundaries —
plus a hard rule that a *root* must stay short, so awaiting a human is a **state change**, not a held call.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/chord/src/publish.ts` (2.6 KB)
- **Purpose:** one process-wide FIFO queue for *every* observer notification (state events, shape pushes, registry
  tables, listener invocations).
- **Key abstractions:** `enqueue(task)` (`src/publish.ts:15`), `holdPublications(fn)`
  (`src/publish.ts:21`), module-private `queue`/`held`/`draining` (`src/publish.ts:10`).
- **Data flow:** a write *adopts* its revisions first, then enqueues its notifications. `drain()` runs them in
  enqueue order. `holdPublications` defers delivery until a multi-step change (a reload commit) completes.
- **Non-obvious design decision:** the file's own header comment names the bug it exists to fix — *"notifying observers
  synchronously from inside a write lets a re-entrant write overtake the write being published. Example: subscriber A
  reacts to n = 1 by writing n = 2; subscriber B then sees 2 before 1."* The fix is not locking but **ordering**:
  adopt-then-enqueue, so every observer sees revisions in adoption order.
- **Edge cases:** `draining` re-entrancy guard; `held` counter for nested holds; `drain()` is a no-op while held. Tasks
  "must not throw (report instead)" — but nothing enforces that; a throwing task breaks the drain loop's `finally`
  (the `draining` flag is reset, but the remaining queue items are still processed on the next `enqueue`).
- **Surprising:** this is a **process-wide singleton**. The spec's §12 admits it: *"The publication queue is
  process-wide and synchronous. A slow observer delays every later notification in the process, including those of other
  hosts in the same process."* It is the single most transferable idea in this shard and also the shard's sharpest
  weakness.

#### `packages/chord/src/errors.ts` (2.7 KB)
- **Purpose:** the stable error vocabulary every caller sees.
- **Key abstractions:** `CHORD_ERROR_CODES` (12 codes), `ChordError` with `code`/`reason`/`retryable`/`details`,
  `isChordError(error, code?)`, `forbidden()`, `invalid(reason, message, details?)`, `asChordError(error, context)`,
  `runAll(steps, message)`.
- **Data flow:** any error crossing a boundary is mapped to a `ChordError`; `asChordError` keeps a `ChordError`'s code
  and turns anything else into `unavailable` with the original as `cause`.
- **Non-obvious decisions:** `RETRYABLE` is exactly `{"superseded", "upgrade_conflict"}`
  (`src/errors.ts:24`) — the two codes that mean *"try again from a fresh root"*. The message is prefixed
  `code/reason: message`, so the machine-readable pair is in the text. `runAll` throws one error, or an
  `AggregateError` when several failed.
- **Edge cases:** `runAll` runs *every* step even after one throws, then aggregates — disposal must not stop at the
  first failure.
- **Surprising:** the *reason* vocabulary is free-form (`ChordErrorReason = string`) and is where the fine-grained
  facts live (`invalid/args`, `invalid/cycle`, `invalid/duplicate`, `invalid/read_only`,
  `invalid/not_host_lifetime`, `invalid/registry_conflict`, `unavailable/unknown_type`, `unavailable/too_many_calls`,
  `unavailable/ready_timeout`, `aborted/gate_deadline`). Tests assert on `code`, never on wording.

#### `packages/chord/src/json.ts` (5.4 KB)
- **Purpose:** strict-JSON copying and checking — the root of the "ownership" discipline.
- **Key abstractions:** `JsonValue`, `JsonRepresentation<T>`, `copyJson(value, options?)` (`src/json.ts:31`),
  `isJsonValue(value)`.
- **Data flow:** `copyJson` walks the value and *rejects* anything that is not strict JSON: non-finite numbers, cycles,
  non-plain prototypes, sparse arrays, symbol keys, accessors (never invoked), missing/duplicated array indices. It
  rebuilds every object with `Object.defineProperty` and a data descriptor, so no inherited setter ever runs.
- **Non-obvious decisions:** `omitUndefinedProperties` exists so that *object* properties may be omitted without
  normalizing *arrays* (array `undefined` is a hole, not an omission). Null-prototype objects are accepted and their
  prototype is preserved.
- **Edge cases:** the `active` ancestor set catches cycles; `finally { active.delete(value) }` means a *repeated*
  (aliased) container is allowed — it is copied twice, not rejected. `Reflect.ownKeys(value).length !== value.length + 1`
  is the dense-array test: extra, symbol or missing keys all change the count.

#### `packages/chord/src/schema.ts` (9.5 KB)
- **Purpose:** canonicalisation, fingerprinting, and **conservative structural subtyping** for contract compatibility.
- **Key abstractions:** `canonicalJson` (`src/schema.ts:12`), `hash64` (two FNV-1a lanes; explicitly
  *non-cryptographic* because contracts are trusted), `deepEqual`, `assertValid(reason, what, schema, value)`,
  `normalize(schema, value, what)`, `canonicalIdentity(schema, value)` (`src/schema.ts:53`), `fits(sub, sup)`
  (`src/schema.ts:134`).
- **Data flow:** `normalize` = `Value.Default` → `Value.Clean` → `Value.Clone` → `assertValid`. `canonicalIdentity`
  then *strips fields equal to their schema default* — so `{ session: "S1" }` and `{ session: "S1", mode: "x" }` (where
  `mode` defaults to `"x"`) are the same object address, and adding a new optional field with a default does not
  change any existing address.
- **Non-obvious decisions:** `fits()` is deliberately **conservative**. Any keyword in the *sup* schema that the
  function does not model (`not`, `allOf`, `contains`, `$ref`, …) forces exact equality, and a schema-valued
  `additionalProperties` does too. `KNOWN` lists exactly the keywords the function reasons about; `ANNOTATIONS` lists
  the ones with no effect on validity. Function members are compared contravariantly on parameters.
- **Edge cases:** `fits` is one-directional by design (a provider's schema must *cover* the consumer's). A false
  positive is worse than a false negative, so `review.test.ts` "#11" checks counterexamples with `Value.Check`.
- **Surprising:** `canonicalIdentity` is the mechanism behind "adding an optional field with a default doesn't change
  existing addresses" — the identity is the *description's* default-stripped form, not the runtime value.

#### `packages/chord/src/types.ts` (3.6 KB)
- **Purpose:** the public type vocabulary: `Ctx`, `Readable<T>`, `StateEvent<T>`, `RefStatus`, `Shape`, `RefBase`.
- **Key abstractions:** `Ctx<P>` carries `signal`, `rootId`, `codeVersion`, `principal`, and `get()`; `Readable<T>` has
  `value`, `subscribe`, and `events`; `StateEvent` is `snap | ops | reset`; `Shape` is `{ variant, members, contract }`.
- **Non-obvious decisions:** `Ctx.get` is documented as *"A reference for this call, released when the call settles"*
  — the call-scoped lifetime is in the type. `Readable.events` is a separate stream from `subscribe` because the two
  carry different semantics (`snap` then `ops`, or `reset` after a migration or rebind).

#### `packages/chord/src/declare.ts` (1.8 KB)
- **Purpose:** the shapes a factory declares through `self`, other than state cells.
- **Key abstractions:** `ResourceDeclaration<T>` (`version`, `deps?`, `exclusive?`, `open`, `close?`), `Resource<T>`,
  `ListenerDecl`, `Subscribable<E>`, `ValueOf<S>`, `EventOf<S>`.
- **Non-obvious decisions:** `ResourceDeclaration.version` is **required** — *"Bump to replace the resource at the next
  reload (a native value has no schema to detect a change)."* A resource has no schema, so its version is the *only*
  way the runtime can tell that it must be reopened. `deps` are references or resources that must be live first.

#### `packages/chord/src/delta/draft.ts` (386 B)
- **Purpose:** the `Draft<T>` type — a mutable, transaction-scoped view of a JSON value.
- **Key abstractions:** `Draft<T, Depth>` recurses into objects, but **stops at depth 8** (`Depth["length"] extends 8`),
  after which the value is its plain type. Functions and primitives pass through unchanged.
- **Non-obvious decision:** the depth cap is a *type-level* guard against pathological recursion; at runtime the
  tracker's proxy depth is unbounded.

#### `packages/chord/src/registry.ts` (1 KB)
- **Purpose:** named tables of contributions (routes, menu actions, plugin extensions).
- **Key abstractions:** `defineRegistry<V>(name, { conflict })` — `conflict: "error"` (default) or `"last"`; `RegistryTable<V>`
  is a `ReadonlyMap`; `RegistryView<V>` with `table(ctx?)`, `get(key, ctx?)`, `subscribe`.
- **Non-obvious decisions:** `table(ctx)` returns the table **of `ctx.codeVersion`**; without a ctx it returns the
  current one. Per-code-version tables are what make a reload atomic — *"A reload never leaves a moment where an entry
  is missing"* (guide).

#### `packages/chord/src/publish.ts` → covered above. `packages/chord/src/node.ts` (385 B)
- **Purpose:** the Node-only re-export surface (`nodeLoader`, `createHostManager`, `forkDriver`, `childControl`,
  `processLock`). Kept out of `index.ts` so the core stays browser-safe.

#### `packages/chord/src/errors.ts` → covered above.

#### `packages/chord/src/index.ts` (2.2 KB)
- **Purpose:** the public export surface. Decides the package's *shape*: contracts, `createHost`/`defineFacet`/
  `defineRegistry`, links, errors, `Context`/`JsonValue`/`Draft`/`copyJson`/`isJsonValue`/`replicatedState`, and the
  shared `Ctx`/`Readable`/`Ref` types.

#### `packages/chord/src/loader.ts` (2.9 KB)
- **Purpose:** the Node facet loader — imports fresh copies of facet modules on every reload.
- **Key abstractions:** `nodeLoader: FacetLoader`.
- **Data flow:** a `registerHooks({ resolve })` hook carries a `?chord2-reload=<n>` query from a re-imported parent to
  its children **inside a facet module's directory**; the query is only added to URLs under a registered facet root.
- **Non-obvious decisions:** *"Every root first: a facet importing another facet's directory gets this load's copy,
  whatever the order."* The CHANGELOG records the bug: *"nodeLoader registers every facet's directory before importing
  any, so a facet that imports a file of a facet listed after it gets the same module copy as that facet; before, the
  load order could produce duplicates."*
- **Edge cases / known limits:** the file's own `TODO(loader)` — *"replace with an isolating, evicting loader. Every
  reload imports fresh module copies under a new query and the old copies are never evicted (they leak until the process
  exits). TUI plugins need isolation, which this loader does not provide."* The spec repeats it in §12.
- **Surprising:** this is an **owner-approved exception to the no-dynamic-import rule**, and it is commented as such.

#### `packages/chord/src/websocket.ts` (1.7 KB)
- **Purpose:** accept browser WebSocket connections as Chord clients.
- **Key abstractions:** `acceptWebSockets(server, host, options)` (`src/websocket.ts:18`), `WebSocketServerLike` /
  `WebSocketLike` (structural — the package does not depend on `ws`).
- **Data flow:** the link is wrapped **at once** (so frames sent while authenticating are queued, not lost), then the
  authenticator runs; `undefined` closes the link as `unauthorized`, a rejection closes it as `authentication failed`.
- **Non-obvious decisions:** `webSocketLink(socket, { compress: true, acceptPacked: false })` — the server deflates
  its outgoing payloads but **refuses packed frames from untrusted clients**, because *"a small message could inflate
  to anything"*. Peers are always accepted as `kind: "client"`: no roots, no code versions, not reload participants,
  not addressable.

#### `packages/chord/src/cell.ts` (15 KB)
- **Purpose:** observable JSON state — the `Cell` (a named state slot) and `Derived` (a synchronous projection).
- **Key abstractions:** `Source<T>` (base), `Cell<T>`, `Derived<T>`, `Fanout<T>` (`src/cell.ts:19`), the `HYDRATION`
  symbol (`src/cell.ts:66`), `hydrationOf`, `unhydrated`, `notReady`.
- **Data flow:** a write goes `cell.change(ctx, draftFn)` → tracker `beginChange()` → the callback mutates a *proxy
  draft* → `prepare()` → `#publish()`: validate → recompute every transitive dependent **against candidate values**
  (`computeDependents`) → `holdPublications(() => { adopt; emit; install dependents })`. The value is adopted and the
  notifications are queued *together*, so a subscriber never sees a half-applied derivation graph.
- **Non-obvious decisions:**
  - **The tracker tracks containers, so a cell tracks `{ v: value }` and strips the box from published ops**
    (`unbox`, `src/cell.ts:127`).
  - **`replace()` diffs automatically when the new value shares a container with the old one**
    (`sharesStructure`, `src/cell.ts:276`) — a cheap "is this a new revision of the same state?" test. Otherwise a
    single `r` op. `{ diff: true | false }` forces either; *"The value is the same either way; only the ops differ."*
  - **`HYDRATION`** lets a state source say whether it has its value yet. A remote reference's member before its first
    snapshot has none, and *"neither has anything derived from or forwarding it."* An object goes live only once every
    state source it exposes or derives from has its value (`waitHydrated` in `object.ts`).
  - `Derived.attach(precomputed?)` accepts a reload's already-validated dry-run values, so a derivation is not
    recomputed at commit.
  - `Derived` sorts dependents by `seq` (creation order) so a derivation chain recomputes in a stable order.
- **Edge cases:** `change` callbacks must be **synchronous** (a returned Promise throws `TypeError`); a returned value
  is always validated against the schema, even outside dev mode; a throw aborts the draft and leaves the committed
  value untouched. `reset(value, schema)` installs a migrated value and publishes a `reset` event, not `ops`.
- **Surprising:** per-write validation is **dev mode only** (`validate()` returns early unless `options.dev`), but the
  *initial* value and any *returned* value from `change` are always validated.

#### `packages/chord/src/state.ts` (14.4 KB)
- **Purpose:** replicated state — an immutable JSON value with ordered, serialised change notifications; either
  authoritative (`replicatedState(initial)`) or a publication-only view of an external revision source
  (`replicatedState(source)`).
- **Key abstractions:** `ReplicatedState<T>`, `MutableReplicatedState<T>`, `AttachedReplicatedState<T>`,
  `ReplicatedStateSource<T>` / `ReplicatedStateSourceAttachment<T>` / `ReplicatedStateSourceFrame<T>`,
  `StateSubscriber<T>` (`src/state.ts:102`), `ReplicatedStatePublisher<T>`.
- **Data flow:** `change(context, mutate)` opens a tracker change, runs the synchronous callback, prepares, adopts,
  and publishes the prepared value **only if `ops.length > 0`** (a no-op publishes nothing). The publisher pushes
  `{ value, sequence, context }` into each subscriber's pending queue and drains it; each subscriber serialises its
  own callbacks (an async listener's promise is awaited before the next delivery).
- **Non-obvious decisions:**
  - **The 100-frame overflow policy.** On overflow only the newest pending value/context/delivery is retained, and a
    not-yet-started initial hydration is preserved. The README states the consequence plainly: *"Thus public delivery
    sequences may skip. This is a frame-count policy, not a byte limit."* (`src/state.ts:102` `push`).
  - **A cursor-gap detector** on an attached source (`src/state.ts:332`): *"Replicated state source cursor has a gap:
    expected N, received M"* → the attachment is disposed and the failure reported, rather than applying a frame out
    of order.
  - The publisher's *re-entrant* publish is queued (`#delivering`), so a listener that publishes again does not
    interleave.
  - `change` refuses re-entrancy: *"Replicated state cannot be changed reentrantly from a change callback."*
- **Edge cases:** listener failures are reported in isolation and never thrown into the source; `unsubscribe` discards
  pending work *without* aborting or joining the running callback; a rejection that arrives after unsubscribe is still
  observed. A mutable state without an `onError` reports failures by throwing in a microtask.

#### `packages/chord/src/contract.ts` (19 KB)
- **Purpose:** contracts as *runtime values* — the type system that ships without TypeScript.
- **Key abstractions:** `remote(name, def)`, `local(name, def)`, `method(args?, result?)`, `opaque(id)`,
  `hostNamed(name)` / `hostFamily(prefix, key)` (the **placement**), `Description` / `DescriptionSchema`,
  `coverage(provider, consumer)` (`src/contract.ts:289`), `bind(provider, accepts, consumer)`
  (`src/contract.ts:326`), `contractFromDescription`, `RESERVED_MEMBERS`.
- **Data flow:** `remote()` validates the header (non-empty name, positive integer version), requires a placement,
  requires at least one variant, forbids a member that is both state and method, and computes
  `fingerprint = hash64(canonicalJson(description))`. The **description** (not the `def`) is what travels on the wire;
  `contractFromDescription` rebuilds a token from it for a peer.
- **Non-obvious decisions:**
  - **Placement is part of the contract.** `hostNamed("server")` or `hostFamily("session:", "session")` says where the
    objects live. It is *data* in the description, so it is in the fingerprint and in the `hold` token: *"A client
    never chooses where an object lives."* A moved type is a breaking change, and `bind` throws `contract_mismatch`
    with the two placements named.
  - **`coverage()` returns a *reason string*, not a boolean** — `"different type"`, `"host"`, `"input"`,
    `"variant X missing"`, `"variant.member missing or of another kind"`, `"variant.member arguments"`,
    `"variant.member result"`, `"variant.member state"`, `"variant.member opaque a != b"`. A refused bind says exactly
    what is missing.
  - **`bind()` rules**: identical fingerprint → no adapter; different placement → always `contract_mismatch` (an
    adapter never bridges placements); same version → `coverage` decides; different version → only `accepts[version]`
    works.
  - `opaque(id)` requires `name@version` and is **local-only** (`remote contracts cannot expose opaque members`).
  - `RESERVED_MEMBERS` blocks `variant`, `status`, `ready`, `shape`, `error`, `onShape`, `onStatus`, `release`,
    `then`, `contract`.
- **Edge cases:** `remote` copies the placement into a fresh JSON object so the description stays clean. A `local`
  contract has one unnamed variant (`LOCAL_VARIANT = ""`).
- **Surprising:** `method()` with no `args` means the method takes **no arguments** and is called `ref.name(ctx?)`;
  `method(args)` with no `result` means **void** and the caller gets `undefined` *whatever the implementation
  returned*. The description records both by *omitting* the field — and *"fingerprints of such methods change"*.

#### `packages/chord/src/context/index.ts` (5.2 KB)
- **Purpose:** the explicit, ambient-free invocation context.
- **Key abstractions:** `Context` (`abortSignal`, `telemetry`, `value(key)`, `toString()`), `ContextKey<T>`,
  `createContextKey`, `withContextValue`, `withTelemetry(span, context)`, `traceIn(context, options, fn)`,
  `withAbortSignal`, `withoutAbortSignal`, `withCancel`, `awaitWithContext`, `BACKGROUND_CONTEXT`, `TODO_CONTEXT`.
- **Data flow:** a context is an immutable linked list of `(key, value)` layers; `value(key)` walks to the parent.
  `withAbortSignal` combines the parent's signal with a new one via `AbortSignal.any`; `withCancel` creates a fresh
  `AbortController` and derives a child context.
- **Non-obvious decisions:** `Context.telemetry` is a **non-optional, explicit** parent (1.4.0 breaking change) — the
  no-op span is the default, and *"Adapters (`TelemetryContext`) belong to hosts and start root spans; adapters are
  never placed in a `Context`."* `traceIn` creates a callback-managed child span and passes the *derived* context to
  the callback; there is **no ambient current span**.
- **Edge cases:** `withoutAbortSignal` is documented as *"Intended for mandatory cleanup only"* — it masks caller
  cancellation. `awaitWithContext` rejects only the waiter; it does not cancel the underlying promise.
- **Surprising:** this context API is **standalone** — the README says it *"does not yet instrument Chord hosts,
  methods, or network frames."* It is the vocabulary the runtime will use, not the runtime itself.

#### `packages/chord/src/output.ts` (15.6 KB)
- **Purpose:** bounded output streams and adaptive progress commits — the shape of "a tool produced 4 MB, show the
  last 8 KB and say exactly what was dropped".
- **Key abstractions:** `OutputBuffer` (`src/output.ts:127`), `OutputLimits` (`maxBytes`, `maxLines`, `retain:
  "head" | "tail"`), `BoundedOutput` (`text`, `droppedBytes`, `droppedLines`), `OutputSlice`, `OutputSkip`,
  `boundOutput(text, limits)`, `sanitizeOutput`, `utf8ByteLength`, `characterEnd`, `Progress` (`src/output.ts:325`),
  `ProgressClock`, `PROGRESS_BYTES_PER_SECOND = 100 * 1024`.
- **Data flow:** `push(chunk, skipped?)` accepts a string or a byte chunk; a byte chunk is decoded with
  `TextDecoder(..., { stream: true })` so a UTF-8 character split across chunks survives; `skipped` accounts for
  output the producer omitted *before* the chunk (tail retention only — head retention throws). `snapshot()` returns
  the retained window plus the exact totals dropped **over the whole stream**, not just the window.
- **Non-obvious decisions:**
  - **Head retention stops storing once the window is full** (cost proportional to each chunk), while tail retention
    keeps a *suffix slightly longer than the window* (`tailMargin`) so the next window's first line can still be found.
  - **The drop counters are exact even when nothing is stored**: `#totalBytes`/`#totalNewlines` count the whole
    stream; `droppedBytes = totalBytes - kept.bytes`.
  - `sanitizeOutput` removes control characters *except* tab and newline.
  - `Progress` paces commits: the first change after an idle period commits at once; each commit then delays the next
    by at least `minIntervalMs` **and** by its written size at 100 KiB/s. At most one commit is in flight; changes
    made meanwhile coalesce into the next one. `ProgressClock` makes the clock injectable so the pacing is testable.
- **Edge cases:** a lone surrogate counts as U+FFFD (3 bytes) in `utf8ByteLength`; `boundOutput` cuts on a character
  boundary, never mid-codepoint; a U+FEFF at a slice's start is text, not a BOM.
- **Surprising:** `Progress.stop()` returns the waiters the *final* commit must settle — the caller decides what to do
  with promises that no commit ever covered.

#### `packages/chord/src/manager.ts` (15.7 KB)
- **Purpose:** the Node-only host manager — run one child host process, keep at most one instance alive.
- **Key abstractions:** `createHostManager(options)`, `forkDriver(options)`, `childControl(channel)`,
  `processLock(name)` (`src/manager.ts:82`), `Liveness` (`booting`, `activeCalls`, `viewers`, `durableTasks`,
  `idleFor`), `ControlMessage`.
- **Data flow:** `start()` forks a **detached** child (its own process group), waits for a `ready` control message
  (default 30 s), and then polls `keepAlive(liveness)` every `checkInterval` (1 s). `stop()` sends `shutdown`, waits up
  to `grace` (5 s) for the exit, then kills the process tree. `replace()` = stop → wait for exit → start. All of
  start/stop/replace are **serialised through one promise queue**.
- **Non-obvious decisions:**
  - **`processLock` is a kernel-held lock**: an abstract socket on Linux/Android, a named pipe on Windows, a probed
    socket file elsewhere. *"A process lock owned by the kernel for the holder's lifetime … vanishes with its process,
    so there is no stale state to take over and no race between two would-be owners. The child acquires it (before
    opening storage), so the lock follows the process that owns the data."* (`src/manager.ts:82`)
  - The macOS/BSD `sun_path` limit (104 bytes) is handled: `MAX_SOCKET_PATH_BYTES = 103`
    (`src/manager.ts:126`) and a too-deep temp path moves the socket to a private `/tmp/chord2-<uid>` directory whose
    ownership and mode are verified.
  - `forkDriver` **deletes an inherited `CHORD2_LOCK`** from the child's env — a child host that forks its own
    children must not hand them the parent's lock.
  - `idleFor` is measured from the **busy → idle transition**, not from the last busy report.
  - A write to a peer that exited (`EPIPE`) is dropped, not raised: *"its exit is what counts."*
- **Edge cases:** the child's exit kills its whole process group (`process.kill(-pid, "SIGKILL")`) however it ended.

#### `packages/chord/src/link.ts` (16.8 KB)
- **Purpose:** the transports — memory, Node IPC, WebSocket — and the payload packing above them.
- **Key abstractions:** `Link` interface, `BaseLink`, `MemoryLink` / `memoryLinkPair()` (`src/link.ts:242`),
  `IpcLink` / `ipcLink`, `WebSocketLink` / `webSocketLink`, `Packed`, `unpack`, `inflateMessage`, `PACK_THRESHOLD =
  64 * 1024` (`src/link.ts:113`).
- **Data flow:** `BaseLink` holds a receive queue until a handler is set, serialises delivery, and handles `bye`.
  `MemoryLink.transmit` does a **JSON round trip** (which detaches the frame and rejects what JSON would mangle
  silently, e.g. a bigint) and chains deliveries on one promise so they stay FIFO and asynchronous. `IpcLink` wraps
  frames as `{ chord2: frame }` so other control messages pass by. `WebSocketLink` sends text frames normally and
  **binary** frames for packed payloads.
- **Non-obvious decisions:**
  - **Payload packing is invisible above the links.** A frame's `args`/`value` whose JSON exceeds 64 K characters is
    deflated. Over IPC it travels as `z: [field, base64]`; over WebSocket as `[u32 BE envelope length][envelope
    JSON][deflated payload]`. *"A host that only relays the frame forwards the deflated bytes unread; the host that
    uses the payload inflates it."* The relay never pays the inflate cost.
  - **`Link.send` returns the size as sent** (deflated payloads count as sent) *when the transport knows it*. This is
    what makes flow control possible — and it means **IPC links are never windowed**, because they report no sizes.
  - `deliverLater` keeps *ordering* while a frame is being inflated in a browser: later frames wait for it.
  - `zlib` is obtained through `process.getBuiltinModule?.("node:zlib")` — optional, so the module stays browser-safe.
- **Edge cases:** an IPC write that fails after the peer exited ends the link (`ipc send failed: EPIPE`) instead of
  raising an unhandled `error` event that would crash the process. `WebSocketLink` sets `binaryType = "arraybuffer"`.

#### `packages/chord/src/remote.ts` (23.3 KB)
- **Purpose:** the consumer side of a remote reference — one shared **binding** per (type, input, principal key,
  contract fingerprint), many **views** onto it.
- **Key abstractions:** `RemoteBinding` (`src/remote.ts:78`), `RemoteRef`, `ViewReadable` (`src/remote.ts:396`),
  `RemoteChannel` (what the link must provide), `StateIn`.
- **Data flow:** a `get` creates or reuses a binding; the binding holds one remote object; the provider answers with a
  **unit** — a `shape` frame listing the members it lacks, then one `snap` per listed member. The binding applies the
  shape **only once all its snapshots have arrived** (`#apply`), so a live binding always has every state member of
  its variant. Later frames are `ops` (decoded and applied with `applyImmutable`), `reset`, or `error`.
- **Non-obvious decisions:**
  - **The shape is applied after the snapshots**, not on the shape: *"The consumer applies a shape once those snapshots
    are here."* A newer shape arriving before the older one's snapshots waits for both.
  - **A held reference stays subscribed** to its variant's state with or without listeners; `state: false` gives a
    method-only view.
  - **A link loss is not an end**: `detached()` keeps the last values readable and the status goes `loading`; a
    re-hold is marked `again` so its unit is *not* urgent.
  - `#syncState()` tells the provider to start/stop state when the views' wish changes — and stopping state *clears*
    the members (`hydrated = false`).
  - `call()` waits for the binding to re-hold, and **strips the arguments to what the consumer's own schema knows**
    before sending.
- **Edge cases:** a failed snapshot before the first hydration **ends** the reference with its error (nobody could
  read anything, so waiting forever is worse); a `cursor`/sequence gap is not applicable here but an `error` frame
  after hydration is only reported.
- **Surprising:** `RemoteRef.member()` returns `undefined` for a member that is neither a method nor state in the
  consumer's contract — the *consumer's* contract decides what is reachable, not the provider's.

#### `packages/chord/src/connection.ts` (50 KB)
- **Purpose:** one end of a link — consumer of remote references, provider for the peer's holds, and relay.
- **Key abstractions:** `Connection` (`src/connection.ts:349`), `RelayRef`, `RelayCall`, `AcceptOptions`,
  `LinkOptions` (`pingInterval` 15 s, `pingTimeout` 45 s, `window` 256 KiB, `pendingCap` 4 windows, `maxCalls`,
  `onProtocolMismatch`), `Peer`.
- **Data flow:** `hello` announces the protocol version, the host name, the kind and the code version, and whether
  the peer acknowledges frames. Every received frame is validated (`isFrame`); a malformed frame, a duplicate id, or a
  control frame from the wrong side **closes the link**. Calls create an `AbortController`; a `cancel` frame aborts
  it. State frames go through `sendState`, which either sends them or parks them in a **slot**.
- **Non-obvious decisions (the flow-control design is the interesting part):**
  - **State waits; calls, results, shapes, `gone` and control frames never do.** The class comment gives the real
    motivation: *"state is pushed as fast as it changes, but a peer may read slowly … and a relay may hide that …
    Everything sent then queues in front of the next call result."* The window is counted in **unacknowledged frame
    bytes**; the peer acknowledges with a cumulative `ack` frame.
  - **The first unit of a new reference bypasses the window** (`urgent`): *"a `get` waits for it, and must not wait
    behind other holds' state."* A *re-hold* (`again`) is **not** urgent.
  - **A unit slot is lazy** — the shape and snapshots are built from the current values *when it is sent*, so a newer
    unit merges into it.
  - **Waiting ops are capped** (`pendingCap`, default four windows). Beyond it, the oldest waiting streams are
    replaced by their current value (a reset); on a relay, by a `resync` asked of the provider. *"so memory stays
    bounded however long the peer stalls."*
  - **The one ordering exception of a link:** while state waits, a result can arrive before state changes made before
    it. Frames of one stream stay in order.
  - `#scheduleAck()` acknowledges **once per burst**, not per frame (`setTimeout(…, 0)`), and an `ack` outside
    `[acked, sent]` is a protocol violation that closes the link.
  - **Principal stamping is one-directional:** a downstream link acts as the principal it was accepted with, whatever
    the frame says; only the parent may forward a principal. `#originOf` similarly ignores a client-supplied `origin`.
  - `#admitRoot` admits a fenced child's root **in the parent's current code version** rather than rejecting it
    `superseded` — *"the parent never ran that code version."*
- **Edge cases:** `maxCalls` answers excess calls at once with `unavailable/too_many_calls` and keeps the link open;
  a route that returns an already-closed link is not kept as a connection (the CHANGELOG records the fix: it used to
  make every later call to that host name fail and leak the ping timer); on close, an **upstream** link's bindings are
  `detached()` (reconnectable) while a **downstream** host that went away makes them `gone`.

#### `packages/chord/src/host.ts` (56 KB)
- **Purpose:** the host runtime — serving, roots, links, registries, code versions, retirement.
- **Key abstractions:** `createHost<P>(options)`, `HostImpl`, `Host<P>`, `HostOptions<P>` (`name`, `self`, `principalKey`,
  `dev`, `onError`, `taskStopDeadline` 5 s, `readyTimeout` 60 s, `linger`, `loader`, `kind`, `upstream`),
  `Facet`/`FacetApi`/`FacetDefinition`/`defineFacet`, `Route`, `PrincipalMatch`, `CodeVersionState`, `RootOptions`.
- **Data flow:** `serve` registers a `Service` in the *current* code version. `install(facet)` runs the facet's
  `setup` synchronously (installing declarations) and then awaits the host objects it created. `get`/`hold` acquire a
  reference by *address*; `root(fn)` starts a root in the current code version; `joinRoot` runs a call tree and keeps
  a lease on every object it touched.
- **Non-obvious decisions:**
  - **`self` is required** (`createHost needs 'self'`): the app supplies the principal of the host's own code. The
    host's own principal is recognised **by key**, not by object identity, so an equal principal from elsewhere
    reaches the same objects.
  - **The address** is `type\0canonicalIdentity\0principalPart`, where `principalPart` is `"host"` for the host's own
    principal and `p:<key>` otherwise. A remote binding's key adds the **consumer's contract fingerprint**:
    `"@type\0identity\0principal\0fingerprint"` — so two consumers with different contracts do not share a binding.
  - **Two code versions are kept** (`current`, `previous`); a third reload retires the oldest. `retireImplementation`
    closes the resources only the retired version declared, in reverse open order, and releases only the references it
    alone held.
  - **Roots are leased on objects** (`touch`/`lease`): a reload's gate waits for the roots that already entered an
    object, and the lease survives across links (`root_end` is sent on every link a root's calls used).
  - **A child behind is fenced, never renumbered** (`peerHello`, `src/host.ts:987`): the parent's current code
    version is *not* stamped onto the child's old code.
  - **`announceRetired`** (`src/host.ts:737`) tells a reconciled child which code versions the parent retired before,
    so it does not wait out the retire deadline at every reload.
  - **`#resolve` authorises, resolves, then authorises again** (`src/host.ts:1140`), with the revocation generation
    re-checked after every await — *"a revocation during resolution wins."*
  - **Disposal happens in waves: holders before what they hold** (`disposeHoldersFirst`, `src/host.ts:1249`), so a
    resource's `close` may still use the objects its object references.
  - `bindingIdle` (`src/host.ts:1050`) implements the consumer-side **linger**: the last reference to a remote object
    released keeps the binding held and hydrated for `linger.types[typeName]` ms, at most `cap` (4) at a time, least
    recently released first.
  - A commit that fails midway **fails the host terminally** — `host.fail(error)`; from then on the host "admits no
    work" and calls fail `unavailable/host_failed`.
- **Edge cases:** `serve` during a reload throws; `install` of an already-installed facet throws; `serveInto` refuses
  a type whose placement does not include this host; a reference cycle in-host is detected at `get`
  (`invalid/cycle`).
- **Surprising:** `principalKey` defaults to `canonicalJson` — the *entire* principal must be JSON-serialisable, and
  the app is told it "should include connection provenance and grant revision, not display names."

#### `packages/chord/src/object.ts` (74 KB)
- **Purpose:** the object runtime — activation, references, declarations, disposal, leases, tasks, listeners.
- **Key abstractions:** `ObjectImpl`, `RefImpl`, `CtxImpl`, `Decls`, `Run`, `Installed`, `Service`/`makeService`,
  `ServeOptions`/`ServeOptionsFor`, `StateOptions`/`StateInit`, `Self<P>`, `ResourceImpl`/`ResourceFacade`,
  `linkedSignal` (`src/object.ts:490`), `awaitReady` (`src/object.ts:517`), `MemberReadable`, `SelfImpl`.
- **Data flow:** **activation is a transaction** (`#activate`, `src/object.ts:1095`): run the factory synchronously →
  open the declared resources (dependencies first) → wait for the declared references to be ready → run the cells'
  `init` → validate registrations → install the implementation for every retained code version → attach derivations →
  start listeners and tasks → `status = "live"`. **Every failure unwinds everything this activation did** (resources
  closed in reverse order, references released, registrations rolled back).
- **Non-obvious decisions:**
  - **`linkedSignal` instead of `AbortSignal.any`** (`src/object.ts:490`), with the reason in the comment: *"Node keeps
    a dependant of a long-lived source (an object's or a code version's) reachable while it has abort listeners, so
    every call or task context would keep its listeners, and the code they close over, alive as long as the source."*
    The fix is to **detach on close**. This is a measured leak class, not a theory.
  - **The `guard` on every cell write** (`src/object.ts:1546`): refuses a write inside a factory (`invalid/read_only`),
    an expired ctx (`aborted/expired`), an aborted signal, a disposed object, and a code version older than
    `minCodeVersion` (`upgrade_conflict`).
  - **A task is a *code holder*, not a root.** `self.task(fn)` gets a ctx with `holder: true`; every call it makes
    starts a *fresh short root*. This is what keeps a long-running loop from pinning a code version.
  - **`startTasks` waits for the aborted runs to finish** before starting replacements, at most `taskStopDeadline` (5 s),
    and reports the overrun — *"so the old and the new run of a task never work side by side."*
  - **Listeners are staged, not started** (`stageListeners`): subscriptions are made *before* the commit, with events
    buffered, so a failing source fails the *prepare* instead of leaving a half-installed code version. A listener whose
    source and `select` are unchanged **keeps its subscription** — only its handler is swapped.
  - **Two `select` functions are the same if they are identical or have the same source text**
    (`sameSelect`, `src/object.ts:1005`): *"an inline arrow is a new object on every factory run, but its code is what
    matters."* The known miss is a select whose captured values changed between runs.
  - **A listener on state must reconcile** — it is re-subscribed and receives the current value again after a reload
    replaced its source.
  - **`self.state(name, schema, initial | { init }, { version, migrate })`** (`src/object.ts:164`): the **name** is what
    survives a reload; `init` runs once, after the resources are open and the references are live, *before* the object
    goes live.
  - `awaitReady` (`src/object.ts:517`) releases **only that reference** on failure — a binding other references share
    stays.
- **Edge cases:** a factory that returns a Promise throws `invalid/implementation`; a duplicate declaration name of one
  kind throws `invalid/duplicate`; `self.register` outside a `lifetime: "host"` object throws
  `invalid/not_host_lifetime`; a `self.get` of the same address with a *different* contract fingerprint throws
  `invalid/duplicate`; the resource facade's `.value` throws `not_ready` **while any factory runs** — *"a reload's
  prepare rerun must not touch the native resource the old code uses."*
- **Surprising:** `MemberReadable` **subscribes upstream only while someone listens** (`bind()` recomputes on every
  add/remove), so a reference nobody reads costs nothing.

#### `packages/chord/src/reload.ts` (29 KB)
- **Purpose:** the reload protocol — prepare, gate, commit, rollback — for one host.
- **Key abstractions:** `Reload` (the class), `ReloadOptions`, `ReloadReport`, `runReload`, `beginReload`/`endReload`,
  `reloadError`, `Candidate`.
- **Data flow:** `prepare()` (`src/reload.ts:205`) → `waitForRetirement()` → `load()` (build the candidate service
  table and a *pending* code version) → `checkProviders()` (forgotten bumps, facets' `uses`) → `prepareAll()` (run the
  new factory over every live object **in recording mode**) → `host.gating = changed` → `checkRefs()` → build the
  registry tables → `gate()` → `#stage()` (subscribe the new listeners, buffering). `commit()`
  (`src/reload.ts:567`) publishes everything in **one synchronous step** inside `holdPublications`.
- **Non-obvious decisions:**
  - **Prepare is side-effect free.** Cell writes throw during a prepare rerun; listeners and tasks do not start;
  registrations are collected, not published; a changed resource opens *next to* the old one.
  - **The admission cut** (`gate()`, `src/reload.ts:457`): at the cut, an old-code root that has *not* touched the
    object gets `upgrade_conflict` (retryable) rather than running over migrated state; roots that already hold a
    lease are grandfathered and their re-entry is admitted. The gate waits for them (5 s), and a missed deadline
    **aborts the whole reload**, naming the blocking roots in `details`.
  - **The gate is a *retryable* refusal, not an error**: `upgrade_conflict` is in `RETRYABLE`.
  - **State versions belong to cells**, not to the object or the contract. A raised version gates and migrates; a
    *lowered* version is refused; a schema change *without* a bump is refused; a bump without `migrate` keeps the
    value, which must then fit the new schema.
  - **Migration runs on a private copy** (`structuredClone(cell.value)`) and the result is validated against the new
    schema (`migrate`, `src/reload.ts:505`).
  - **`dryRun`** computes the new derivations over the *candidate* values and validates every prospective value
    against every schema that will apply — so the commit only installs.
  - **The commit is one synchronous step, and a failure there is terminal**: *"If an install still throws, the code
    version is half-published: the host fails terminally and admits no more work."*
  - **`#starts`** — work that may start new-code-version roots (tasks, host-object activations) runs *after* the
    coordinator has queued its commit frames, so a new-code task cannot reach a child before the child's commit.
  - **Rollback restores an exclusive resource that failed to close**, or marks it `unavailable` — *"never silently
    closed."*
- **Edge cases:** the whole reload is serialised (`unavailable/reload_running`); a child cannot reload on its own
  (`unavailable/not_coordinator`); browser references never *block* a reload — after the commit they get
  `upgrade_required` instead.
- **Surprising:** the *host's own* reference to a `lifetime: "host"` object is a **lifecycle pin, not an old-version
  consumer** — it adopts the new contract at commit and needs no `accepts` adapter for itself.

#### `packages/chord/src/cluster.ts` (10 KB)
- **Purpose:** the cross-host reload coordinator and the child side.
- **Key abstractions:** `runClusterReload(host, plugins, options)` (`src/cluster.ts:39`), `reconcileChild(host,
  connection)` (`src/cluster.ts:123`), `ChildReloads`.
- **Data flow:** the server prepares itself, sends `prepare` to every synced child, collects votes, and only then
  commits itself and sends `commit`. *"Links are FIFO, so a child commits before it can receive any frame of a root
  started in the new code version."* Any failure or missed vote sends `abort` everywhere and rolls back.
- **Non-obvious decisions:**
  - **Retire before prepare.** `await reload.waitForRetirement()` runs *first*, so the `retire` frames reach every
    child before `prepare` — a child never retires a code version the parent still runs roots of.
  - **The vote deadline is derived**: `gateDeadline + retireDeadline + 5000`.
  - **`reconcileChild` loops.** If the host moved on while the child was reconciling, it aborts and retries against the
    newer code version. The child's old code is *never* relabelled as a newer code version.
  - The child registers its operation **before its first await**, so an abort or a disconnect is never lost
    (`ChildOperation`).
- **Edge cases:** a child whose hello arrives *during* a reload is decided when the reload ends; a child already
  behind is fenced at once so its calls up are admitted meanwhile.

#### `packages/chord/src/wire.ts` (8.3 KB)
- **Purpose:** the frame vocabulary — one TypeBox union that is both the runtime validator and the type source.
- **Key abstractions:** `Frame` (23 frame types), `FrameSchema`, `isFrame(value)`, `PROTOCOL_VERSION = 4`,
  `toWireError`/`fromWireError`, `RootRef`, `WireError`.
- **Data flow:** each frame type has **one direction**, so ids never collide: consumer → provider
  (`hold`, `release`, `call`, `cancel`, `sub`, `unsub`, `resync`); provider → consumer (`shape`, `gone`, `result`,
  `state`); both (`hello`, `ping`, `pong`, `bye`, `root_end`, `ack`); parent → child (`invalidate`, `prepare`,
  `commit`, `abort`, `retire`); child → parent (`vote`).
- **Non-obvious decisions:** payloads (`input`, `args`, `value`) stay `unknown` and are validated *where they are
  used*, against the contract; state ops are checked op by op by the delta decoder. The protocol version is
  **announced, not negotiated**: a peer of another version is closed with reason `protocol-version <n>` and
  `onProtocolMismatch` tells the side that has to load new code (a browser reloads its page).
- **Edge cases:** `fromWireError` strips the `code: ` prefix from the message so the two ends format it the same way.

#### `packages/chord/src/delta/index.ts` (26.9 KB)
- **Purpose:** the delta module's public surface — op vocabulary, path safety, appliers, and the wire codec.
- **Key abstractions:** `Op` (`r`/`s`/`d`/`a`/`t`/`p`/`m`), `WireOp` (the same plus `#` path definitions and
  arity-omitted short forms), `apply`, `applyImmutable`, `applyImmutableBatches`, `encoder()`/`decoder()`,
  `assertValidOp`/`assertValidWireOp`, `assertSafePath`, `RESERVED_SEGMENTS` (`src/delta/index.ts:131`),
  `UnsafePathError`, `PathError`, `overlap()` (`src/delta/index.ts:87`), `isBase`, `isReplace`.
- **Data flow:** the tracker produces `Op`s; `encoder()` turns them into `WireOp`s (interning paths); `decoder()`
  restores them and validates each one; `apply`/`applyImmutable` apply them.
- **Non-obvious decisions:**
  - **Two vocabularies, two validators.** `assertValidOp` checks the *decoded* grammar; `assertValidWireOp` checks
    the *wire* grammar. Validating `Op` against the wire grammar would be laxer than the type: a two-element
    `["s", value]` would pass, and `apply` would then read the value as a path.
  - **Reserved segments** (`__proto__`, `constructor`, `prototype`) are rejected in *any* path, and the appliers write
    with `Object.defineProperty` so an inherited setter never runs. The comment explains the threat model: *"Ops arrive
    from a facet, a plugin compartment, or a tool whose details may echo model output, so none of it is trusted
    input."*
  - **`assertIndexInRange`** (`src/delta/index.ts:304`): an index may address an existing element or append exactly one
    past the end. Anything else produces state a replica cannot match (holes serialise to `null`), *and* it is the
    denial of service that would otherwise let one op allocate a 4.29-billion-entry array.
  - **`overlap()` is a probe-and-verify, deliberately not KMP** (`src/delta/index.ts:87`): *"A hand-written KMP is
    asymptotically equivalent and much slower in practice."* The candidate count is bounded, because repetitive output
    makes a long head match at thousands of positions; giving up returns 0, which emits a set — larger, never wrong.
  - **The encoder interns on the *second* use** — a definition costs more than the path it replaces. It **clears the
    dictionary on an `r`**: *"A base batch is a RECOVERY POINT: a reader replays from the last one with a fresh decoder.
    So everything after it must be self-contained."*
  - **Arity omission is scoped to a batch**, not across batches — a reader that skips a batch must not decode into the
    wrong path.
  - `applyImmutableBatches` shares **one copy-on-write scope across the complete call**, so no intermediate revision is
    exposed; `appendCopy` builds an appended array in **one** copy instead of two (the CHANGELOG records the win: 32 000
    one-item appends went from 11.3 s to 1.4 s).
- **Edge cases:** `apply` *adopts* an `r` payload rather than copying it — fanning one in-memory batch out to several
  mutable replicas makes them alias each other. This is stated as an ownership rule, not a defect.

#### `packages/chord/src/delta/tracker.ts` (79.8 KB) — the largest file in the shard
- **Purpose:** the transactional JSON tracker — a mutable overlay over an immutable revision, materialised into an
  exact operation batch.
- **Key abstractions:** `track(initial)` (`src/delta/tracker.ts:321`), `Tracker<T>` (`value`, `revision`,
  `beginChange()`, `prepareReplace(value)`, `adopt(prepared)`), `Change<T>` (`state`, `prepare()`, `abort()`),
  `Prepared<T>` (`base`, `value`, `ops`, `baseRevision`, `abort()`).
- **Data flow:** `beginChange()` opens an **overlay**: a proxy tree over the base revision. Writes mark nodes dirty;
  `prepare()` emits the ops and materialises the candidate value; `adopt()` swaps the root pointer. The context
  lifecycle is `open → prepared → consumed | aborted | stale`.
- **Non-obvious decisions:**
  - **Adoption is an infallible pointer swap** — materialisation happened during `prepare`, so a storage failure can
    discard the candidate without touching authority.
  - **Adopting one preparation stales all competitors**: open drafts become unusable, their `prepare()` throws, and
    prepared competitors are rejected by `adopt()`.
  - **`#invalidate` drops the loser's strong overlay references in O(1)** — *"Adoption must not walk every node
    touched by a competing draft."* Externally retained proxies still see the stale status.
  - **A no-op still advances `revision` and stales competitors**; replicated state does not *publish* a no-op.
  - **The array overlay is a piece tree** (base pieces + insert pieces, a treap with priorities), and the *plan* for
    an array edit is computed from the pieces alone when the retained base elements keep their order
    (`orderedArrayPlan`) — *"so appending to a long array costs no walk over its elements."* A walk over every base
    element is the fallback when base elements moved (`elementArrayPlan`, which may emit a permutation).
  - **Dense regions**: many small edits inside one array fold into a single `p` splice of that region
    (`buildDenseRegions`, `emitArrayOperations`).
  - **Bounded op counts**: `MAX_DELTA_OPERATIONS = 4 096`; exceeding it folds the whole batch into `["r", value]`.
  - **Reserved keys force a fold to the nearest safe ancestor** — the tracker never emits `__proto__` as a path
    segment.
  - `emitSimpleObjectOperations` is a fast path for small plain-object edits (≤ 128 nodes), which also enables direct
    materialisation without replaying ops.
  - `materializeOperations` picks `applyImmutable` (native splice/permutation) for structural batches and
    `applyImmutableTrusted` (a hand-written copy-on-write applier) otherwise.
- **Edge cases:** a draft may stay open across `await`; `prepare()` and `abort()` are the only ways to settle it, and
  every draft handle is unusable afterwards; a write through a handle whose element was removed from the draft is
  ignored; `set` of `undefined` deletes an object key but throws inside an array; array holes are rejected; a
  non-strict JSON placement throws **before** the draft changes.
- **Surprising:** the tracker deliberately **does not freeze or defensively copy** the root it takes ownership of —
  `track()` is O(1) and never walks the tree. The contract is ownership, and the README says so bluntly: *"an illegal
  mutation is not detected. It silently corrupts state."*

#### `packages/chord/src/delta/diff.ts` (17 KB)
- **Purpose:** compute a compact operation batch from two immutable JSON revisions.
- **Key abstractions:** `diffRevisions(before, after)` (`src/delta/diff.ts:513`), `MAX_DELTA_OPERATIONS = 4 096`
  (`src/delta/diff.ts:5`), `lcsMatches`, `identityAnchors`, `greedyIdentityAnchors`, `identitySubsequence`,
  `semanticallyAligned`, `permutation`, `jsonCost`/`pathCost`/`operationCost`.
- **Data flow:** `diffValue` → string (append / front-truncate / set), array (`diffArray` → `diffArrayRegion`), object
  (`diffObject`), otherwise a set. `diffArrayRegion` first trims the common prefix and suffix, then tries, in order:
  positional matches, an identity subsequence, LIS-based identity anchors, a semantic LCS — and finally falls back to
  one region splice.
- **Non-obvious decisions:**
  - **The diff is *structural*, not field-based.** Two unrelated shifted objects with common field names are NOT
    diffed field-by-field; coincidental `id`/`key` fields are not treated as identity (both pinned by tests).
  - **A pure reorder of a same-length array becomes a permutation op** (`m`).
  - **The diff is cost-bounded twice**: op count (4 096) and *byte cost* — `diffRevisions` compares the delta's
    estimated cost against the snapshot's cost and falls back to `[["r", after]]` when the delta is larger. This is
    the "the diff grew bigger than the data" guard.
  - `lcsMatches` is bounded by a *cell budget* (65 536) so a big diff cannot blow up; `identityAnchors` falls back to
    a greedy scan past 200 000 candidates.
- **Edge cases:** an object with a reserved key is replaced wholesale rather than diffed.

#### `packages/chord/src/delta/apply-immutable-trusted.ts` (4.7 KB)
- **Purpose:** a copy-on-write applier for **self-produced, trusted** operations.
- **Data flow:** `applyImmutableTrusted(target, operations)` copies each touched container **once** (a `WeakSet` of
  already-owned containers), so a batch that touches the same container repeatedly pays one copy.
- **Non-obvious decisions:** it does not validate op shape or path safety (the tracker produced them); it writes with
  `Object.defineProperty`; a splice that shrinks uses `copyWithin` + `length` rather than `splice` (which would spread a
  100 000-item payload).
- **Edge cases:** a `p`/`m` target that is not an array throws; a permutation whose length differs from the array
  throws.

#### `packages/chord/src/delta/revision-validator.ts` (3 KB)
- **Purpose:** validate immutable replica revisions, skipping containers already validated in earlier revisions.
- **Key abstractions:** `JsonRevisionValidator` with a `WeakSet` of already-validated containers.
- **Non-obvious decisions:** it is a *trust* validator for the strict-JSON contract (dense arrays, plain objects,
  enumerable data properties, no cycles, no symbols) — and it is **incremental**, so a long-lived replica is not
  re-walked on every revision.

#### `packages/chord/src/sqlite/database.ts` (1.9 KB)
- **Purpose:** the portable SQLite facade.
- **Key abstractions:** `SqliteExecutor` (`exec`, `run`, `get`, `all`), `SqliteDatabase` (+ `transaction`, `close`),
  `SqliteValue`.
- **Non-obvious decisions:** the transaction contract is spelled out in prose: *"All work in the transaction must use
  that handle; the handle is invalid after the callback settles. Adapters must queue unrelated operations and other
  transactions until the transaction finishes."* And: *"When the callback rejects, the adapter must roll the
  transaction back before rejecting with that same error. If rollback fails, it must reject with a different error (for
  example an `AggregateError`) so callers cannot mistake the callback error for a guaranteed rollback."*
- **Surprising:** the whole portable interface exists so the *same* telemetry store can run on Node SQLite and on a
  Cloudflare Durable Object.

#### `packages/chord/src/sqlite/migrations.ts` (1.8 KB)
- **Purpose:** atomic, versioned schema migrations.
- **Key abstractions:** `applySqliteMigrations(database, migrations, { table })`, `SqliteMigration`.
- **Non-obvious decisions:** migrations must have **contiguous versions starting at 1** (checked *before* touching the
  database); the metadata table is a `singleton INTEGER PRIMARY KEY CHECK (singleton = 1)` row in a `STRICT` table;
  a stored version *newer* than the code supports is an error, not a downgrade; the whole bootstrap and every pending
  migration run in **one transaction**, so a failure rolls them all back together.

#### `packages/chord/src/sqlite/schema.ts` (406 B)
- **Purpose:** validate a table-prefix identifier before it is interpolated into SQL.
- **Key abstractions:** `validateSqliteSchemaPrefix(prefix)`.
- **Non-obvious decisions:** the prefix must match `^[A-Za-z_][A-Za-z0-9_]*$` **and** must not start with `sqlite_`
  (reserved). The table name is interpolated (it cannot be a binding), so this is the only guard.

#### `packages/chord/src/sqlite/node.ts` (6.3 KB)
- **Purpose:** the Node `node:sqlite` adapter.
- **Key abstractions:** `NodeSqliteDatabase`, `openNodeSqliteDatabase(path, options)`, `NodeSqliteDatabaseOptions`,
  `SerialOperationQueue`.
- **Data flow:** `openNodeSqliteDatabase` creates the directory, opens `DatabaseSync`, then sets
  `journal_mode = WAL`, `synchronous = NORMAL`, `wal_autocheckpoint = 1000` (default), and `busy_timeout = 5000` (vs
  SQLite's 0). Prepared statements are cached **per connection by SQL text** and shared between the database and its
  transaction handles.
- **Non-obvious decisions:** `SerialOperationQueue` publishes a **barrier before** an operation starts, so calls the
  operation makes synchronously wait behind it. A transaction is `BEGIN IMMEDIATE`; a failed rollback produces an
  `AggregateError([error, rollbackError])`, not the callback error. `close()` runs `PRAGMA wal_checkpoint(TRUNCATE)`
  before closing.

#### `packages/chord/src/sqlite/cloudflare.ts` (5.9 KB)
- **Purpose:** the Cloudflare Durable Object SQLite adapter — same interface, different runtime.
- **Key abstractions:** `DurableObjectSqliteDatabase`, `DurableObjectSqliteStorage` (a *structural* type, so the
  package needs no Workers type dependency), `SerialQueue`.
- **Non-obvious decisions:** **Durable Object SQL binds numbers as doubles**, so a `bigint` outside the safe integer
  range throws a `RangeError` rather than losing precision. `BLOB` results are converted to `Uint8Array` in place.
  Adapters given the same storage object **share one queue** (a `WeakMap`), so two adapters on one Durable Object do
  not interleave. `close()` waits for queued work but *"the Durable Object owns its storage, so nothing else closes."*
- **Surprising:** direct calls to the underlying storage **bypass** the queue — a documented limitation, not an
  oversight.

#### `packages/chord/src/telemetry-sqlite/index.ts` (12.1 KB)
- **Purpose:** a portable, buffered SQLite recorder for spans and metric aggregates.
- **Key abstractions:** `createSqliteTelemetry(db, options)` (`src/telemetry-sqlite/index.ts:338`), `SqliteTelemetry`,
  `Recorder`.
- **Data flow:** recording **performs no SQL**. A settled span is pushed into an in-memory array; a metric is
  aggregated in a `Map` keyed by `interval:name:kind:unit:attributes`. A one-second timer flushes: completed
  ten-second metric intervals and all settled spans are written in **one transaction**, which also performs the
  retention cleanup. `close()` drains partial intervals.
- **Non-obvious decisions:**
  - **The bounds are counts, not bytes**: `maxQueuedSpans` (default 10 000) bounds settled spans awaiting commit
    *including the in-flight batch*, and *independently* bounds pending metric interval/series pairs. Overflow
    increments `droppedSpans` / `droppedMeasurements`.
  - **A write failure stops recording permanently**: `flush()` and `close()` reject with the original error, without
    retrying.
  - **Metrics keep count, sum, min, max per series** — not raw samples, buckets or exemplars.
  - Retention defaults to **seven days**; the cleanup `DELETE` runs inside the flush transaction.
  - The schema is created by `applySqliteMigrations` with the metadata table `telemetry_schema` — the *same* migration
    runner as everything else.
- **Edge cases:** a span that completes after `close()` is ignored; `close()` does not wait for business callbacks and
  does not close the database.

#### `packages/chord/src/telemetry-sqlite/store.ts` (5.8 KB)
- **Purpose:** the read side — `findTraces`, `getTrace`, `findMetrics` over committed rows.
- **Key abstractions:** `getTrace(db, traceId)`, `findTraces(db, query)` (`src/telemetry-sqlite/store.ts:74`),
  `findMetrics(db, query)`, `attributesSql`.
- **Non-obvious decisions:**
  - **Two queries per page, not one per trace**: a CTE picks the *heads* (the earliest span of each trace) and a
    second query fetches all their spans. The test "uses two span queries for a page, not one query per trace" pins
    this.
  - **Attribute matching is type-aware**: JSON equality must distinguish boolean `true` from numeric `1`, so
    `attributesSql` uses `json_each` with an explicit `entry.type` test.
  - **Cursor pagination** is a JSON-encoded `[started_ms, trace_id]` pair, compared as
    `(started_ms < ? OR (started_ms = ? AND trace_id > ?))`.
  - The whole read runs **inside a transaction**, so a page is a consistent snapshot.
- **Edge cases:** traces are returned newest-first; `findMetrics` filters by name, interval bounds and attributes.

### Tier 2 — bulk: docs, config, and the whole test suite

#### Docs and config

| File | What it is / what it pins |
| --- | --- |
| `packages/chord/README.md` | Package entry map (`.`, `./context`, `./output`, `./delta`, `./node`, `./telemetry-sqlite`, `./sqlite`, `./sqlite/node`, `./sqlite/cloudflare`). Decides: objects are state+code at an address; everyone gets a **reference**, never the object; every object knows its **principal**; state is observable JSON delivered as snapshot+deltas; hot reload keeps state and lets in-flight work finish on the code it started with. Also documents the **delta ownership contract** (trusted immutable ownership, *not* defensive copying or freezing) and the **100-pending-delivery subscription policy** (a *frame-count* policy; "public delivery sequences may skip"). |
| `packages/chord/CHANGELOG.md` | The design log. 1.4.0: `Context.telemetry` becomes an explicit non-optional parent; `telemetry-sqlite` and `sqlite` land. 1.3.0: a total vocabulary rewrite (`Handle`→`Ref`, `epoch`→`codeVersion`, `kind`→`variant`, `eager`→`lifetime`), `PROTOCOL_VERSION` 1→4, contracts gain **placement**, links gain **flow control by units** and **ack** frames, **packed (deflated) payloads**, `FacetApi.signal`, `HostOptions.taskStopDeadline`. The "Fixed" list is gold: disposed objects staying reachable, references retaining every code version's factories, `AbortSignal.any` keeping closures alive, an `EPIPE` crash on a dead child. |
| `packages/chord/docs/guide.md` | The API reference and the **rules of thumb**. Decides: contracts are runtime values (bundles ship no TypeScript); inputs are normalized and canonicalized so adding an optional field with a default does not change an address; a contract version binds only if `N === M` and the provider "covers" the consumer; **variants are not complete authorization**; **a listener on state must reconcile, not count**; **state that must survive a reload lives in cells, never in closure variables**; **roots must be short** — *"awaiting a human inside a method" pins a root and blocks state migration, so the right shape is "record the request as state; the answer is a separate call"* (`docs/guide.md:501`, `:507`, `:811`); `ctx.get` vs `host.get`; disposal closes resources in reverse order and referrers before what they reference. |
| `packages/chord/docs/spec.md` | The normative semantics ("Where it and the code disagree, the disagreement is a bug"). Decides the **compatibility rule**, the **placement rule** ("a client never chooses where an object lives"), the **activation sequence**, the **lifetime table**, the **reload protocol** with its admission cut, the **two-version rule**, the wire frame vocabulary, and §12 **Known limitations and decisions** — the most valuable page in the repo (the commit decision is *not persisted*; links do not resume; one level of reload participants; the publication queue is process-wide and synchronous; the Node loader leaks module copies; "a change of meaning with an identical schema is undetectable, the author's responsibility"). |
| `packages/chord/docs/tutorial.md` | A 11-section executable tutorial — every code block is matched against `test/tutorial.test.ts` by a source-matching test, so doc drift fails CI. Builds a shared todo list: contract → factory → cell/derivation → resource + reference → principals and variants → a second process over a memory link → listeners and tasks → plugins and registries → hot reload (compatible change, state migration, contract adapter) → testing with a fake facet. Its closing checklist is the most compact statement of the discipline: "Keep reloadable state in cells, not closure variables", "Check grants and arguments, not just variants", "Stamp principals at trusted ingress, not from client payloads". |
| `packages/chord/src/delta/README.md` | The delta module's own contract: the **mutation-rights table** (who may mutate what), the **replaying batches** rules (immutable replay is preferred; mutable replay needs a detached root *and* a detached copy of every batch per replica), the **strict-JSON root rules**, the **lifecycle** (open drafts → `prepare()` → `adopt()`; adopting one stales all competitors), the **operation tuples**, **reserved keys** (`__proto__`/`constructor`/`prototype` are never emitted and are rejected with `UnsafePathError`), and the measured footguns (proxy reads ≈ 9 ms per 20 000 nested reads vs 0.08 ms raw; bulk-insert validation ≈ 19 ms and 20 MiB for 100 k objects). |
| `packages/chord/package.json` | v1.4.0, ESM, 9 subpath exports, `sideEffects: false`, Node ≥ 22.19, and exactly two runtime deps: `typebox` 1.3.27 and `@earendil-works/pi-telemetry` 1.4.0. The spec's hard constraint is enforced by a test: "Chord's runtime depends only on its own `delta` module … and Node/browser built-ins plus `typebox`." |
| `packages/chord/tsconfig.build.json` | Build config: extends the monorepo base, `rootDir: ./src`, includes only `src/**/*.ts` — the `test/` tree is deliberately outside the published build. |

#### The test suite (63 files — every file below was opened and its case list extracted)

| File | What it is / what it pins |
| --- | --- |
| `test/awaiting.test.ts` | Awaited `get`s: an aborted get rejects and releases **only its reference**; a `ctx.get` waiting when its call settles rejects `aborted`; a get times out with `ready_timeout` and releases its hold; `ctx.get` resolves hydrated and releases at call end. |
| `test/bindings.test.ts` | Shared bindings: N references to one object ⇒ **one hold, one snapshot per member, one frame per change, one release**; a held reference stays subscribed without listeners; the linger cap (`cap`, least-recently-released first); binding identity = normalized input + principal key + contract fingerprint; hydration of null/empty/undefined values and the `not_ready` read; method-only (`state: false`) references; the `origin` of client holds is the server's, never the client's; protocol version 4 refuses a version-3 peer. |
| `test/boundary.test.ts` | The **package boundary test**: Chord does not depend on Pi packages other than `pi-telemetry`, or on files outside Chord. A machine-checked architectural constraint. |
| `test/cluster.test.ts` | Cross-host reload: every host prepares, the server commits first then the workers, code versions stay in step; a failing vote aborts every host and names the host; a worker gate blocked past its deadline aborts the whole reload; removal tombstones; only the server coordinates; browsers are not participants; a child that says hello mid-reload is reconciled; a child keeps the previous code version until its parent retired it; a child behind is fenced at once and its calls up are admitted; forced retirement cancels a relayed browser call. |
| `test/context.test.ts` | The standalone `Context`: distinct empty roots; typed values layered without modifying parents; inherited vs isolated cancellation; `withoutAbortSignal` masks cancellation for cleanup; telemetry derived independently of values and cancellation; concurrent `traceIn` branches isolated; `awaitWithContext` stops waiting on cancellation. |
| `test/contract.test.ts` | Input normalisation and default-stripped identity; stable description-based fingerprints; reserved member names and opaque remote members refused; coverage accepts additive and refuses breaking changes; methods without args/result; `accepts` adapters as the only way to bind another version; opaque members compared by `name@version`. |
| `test/delta-apply-immutable.test.ts` | The checked immutable applier: each touched container copied once while preserving input/payload ownership; a root-replacement payload protected from later edits; one private copy-on-write scope across batch partitions; tracker batches across arbitrary revision boundaries; no partial application when validation fails; one batch fans out without mutating shared payloads; an append is built in one copy; a wide object is copied once, not once per write. |
| `test/delta-benchmark/benchmark.ts` | A spawn-based benchmark driver (16 scenarios: import, committed-read, draft-read, sparse, queue, sort, dense, unshift, and 8 "watch-*" fan-out profiles) that records timings, op bytes/counts, checksums and retained-MiB, and writes a JSON result. |
| `test/delta-benchmark/benchmark.worker.ts` | The worker that runs each scenario in its own process (tracker only), measuring import/mutate/prepare/serialize/adopt/acquire/enqueue/delivery separately and watching memory. |
| `test/delta-benchmark/conversation-view-benchmark.ts` | A driver for a *provisional* "Pico5 conversation view" workload: projection, normal, fanout, delayed-start-lag, churn-reconnect, overflow-reset, branch-head-replacement; reports medians and p95/p99 per phase. Explicitly labelled "architecture experiments, not compatibility commitments". |
| `test/delta-benchmark/conversation-view-benchmark.worker.ts` | The worker for that workload — models five mounted documents (`config`, `inbox`, `turn`, `preferences`, `live`) plus `audit`, a queue capacity in *pending operations*, and an "async-serialized-ops-only-no-consumer-apply" delivery model. |
| `test/delta-benchmark/memory-benchmark.ts` | A memory driver over four scenarios (idle-control, sparse-burst, staggered-revisions, lagging-watches) reporting heap/RSS deltas against a ready baseline and a process baseline, with GC counts and times. |
| `test/delta-benchmark/memory-benchmark.worker.ts` | The memory worker: requires `--expose-gc`, forces GC before measuring, and reports retained/peak over ready and over process baseline. |
| `test/delta-clone.test.ts` | Tracker ownership: O(1) immutable ownership of the imported revision; null prototypes preserved; **no traversal** of a trusted root; assigned/inserted values copied immediately. |
| `test/delta-diff.test.ts` | The immutable revision diff: sets and deletes; string append and front truncation; array insertion/removal/shift as splices; a same-length queue update collapsed to two splices; a permutation for a pure reorder; reordered-but-equal values normalised to a no-op; permutation validation; payload-free splices for scattered removals; **no field-diffing of unrelated shifted objects**; **no treating coincidental `id`/`key` fields as identity**; the 256 KiB and 1 MiB removed-neighbour payload cases; 1 001/10 000-item push/pop/middle-removal narrowness; 40 000-row sparse edits; a reconstructed large-array leaf edit; a large rotation kept payload-free; 500 unshifts without snapshotting retained rows; wide-object and wide-array emission bounded by a root replacement. |
| `test/delta-tracker/retention.test.ts` | Spawns a worker across GC jobs and asserts the tracker retains nothing after the contexts are collected. |
| `test/delta-tracker/retention.worker.ts` | The worker for that test (tracker + `setImmediate` yields, so the GC can run). |
| `test/delta-tracker/tracker.test.ts` | The largest test file (58 KB) — the tracker's whole contract: transactional overlay lifecycle (materialise + pointer-swap adoption, a transaction alive across `await`, idempotent abort, competing contexts, adoption of a no-op, O(1) replacement ownership); **policy view** (native reads, descriptors, key order after delete-and-readd, integer-like key ordering, `JSON.stringify`, `map`, iteration, borrowed mutators, no dirty read-only traversals, one proxy identity per container); **by-value placements** (every mutator clones, non-strict JSON rejected before the draft changes, repeated aliases expand into independent placements, edits to introduced subtrees fold into the payload); **piece arrays** (one insert for an append to a long array, removals emitted from the end backwards, permutation when order changes, all structural mutators with native return values, held handles after reindex, dense-region folding, a 20 000-operation queue normalised to two operations, adversarial fragmentation, self-overlapping `fill`/`copyWithin`); randomised transactions matching policy, detached replay and adopted state; bounded fallback for many reverse-depth object edits; and **security** (own properties defined without invoking inherited setters, reserved own keys without prototype pollution, a `MemoryStorage`-style recursive clone of `Prepared.value`). |
| `test/delta-traversal.bench.ts` | A benchmark comparing draft reads through the proxy against raw objects (the 9 ms / 20 000 reads figure in the delta README), with a checksum and a `--quick` mode. |
| `test/delta.test.ts` | The delta module's unit contract: lifecycle (draft alive across `await`, abort, no-op normalisation, foreign/stale/repeated preparations, an aborted change invalidating its prepared result); canonical strings (append, rolling window, bounded overlaps); operation application and validation (mutable and immutable, root replacement/splice/permutation, unsafe and malformed paths, the two vocabularies validated separately); the codec (path interning, arity omission, dictionary reset on a base, self-contained batches after a base, no collision on paths containing NUL); ownership (a replacement payload not mutated by a later op, a mutable payload adopted rather than copied); prototype safety; array index safety (gaps, huge indices, string-spelled indices rejected; 100 000-item splices without argument overflow); operation structure safety. |
| `test/fixtures/counting.ts` | A `Link` wrapper that counts frames by type and bytes per direction, and can **hold back acknowledgements** to deliberately fill the peer's flow-control window. The instrumentation that makes the flow-control tests possible. |
| `test/fixtures/echo.ts` | A tiny remote contract (`t.echo`, `hostNamed("w1")`) with `echo` and `pid` methods, used by the manager and link tests. |
| `test/fixtures/loader.ts` | A script (not a vitest file) that exercises `nodeLoader` outside vitest, because vitest's module runner bypasses the resolve hooks the loader installs. Writes plugin files to a temp dir, reloads a facet, and pins the ordering fix: a facet listed first that imports a later facet's directory gets the *same* module copy. |
| `test/fixtures/worker.ts` | The child host for the manager tests, with `FIXTURE_MODE: normal | ignore-shutdown | fatal`; it takes the **kernel lock before opening storage**, serves the `Echo` contract, can spawn a grandchild, and reports `ready`/`fatal` over the control channel. |
| `test/flow-units.test.ts` | Flow control with units: with large streams waiting behind a full window, **a new get resolves at once** and calls are answered; a snapshot larger than the window arrives whole; an IPC link (no sizes) never holds state back; waiting ops stay under the cap however many streams stall, each then getting one reset. Relay topology: one origin hold ⇒ one downstream hold, nothing left after release/close/revoke; a stalled tab overflows and gets a reset while another tab keeps getting every change. |
| `test/flow.test.ts` | The window itself: state held back while the window is full, calls answered meanwhile, one coalesced frame; ops that outgrow their slot replaced with the current value; what waits for a released reference is dropped; relayed state coalesced and a `resync` asked downstream on overflow; a peer whose hello does not announce acks is neither windowed nor acknowledged; an acknowledgement of frames never sent closes the link; `maxCalls` answered with `too_many_calls` while the link stays open. |
| `test/generations.test.ts` | **Generation GC** — a reference held across reloads keeps only the current generation alive; a `lifetime: "host"` object with state, a kept resource, a listener, a task and registrations keeps only the current generation alive; abort listeners that calls and tasks add to their `ctx.signal` do not outlive them; disposed objects are not kept after their disposal finished. This is the test that pins the `linkedSignal` fix. |
| `test/host-objects-reload.test.ts` | The host's own reference to a host object follows contract bumps at commit **without reopening its object or resources**; external old-version consumers still refuse an upgrade without `accepts`; object-owned old-version references still block an upgrade; a forgotten bump stays refused even when the only consumer is the host's own reference; a cluster upgrade retokens references only after unanimous preparation; a reload that changes a type's lifetime creates its host object, or lets it go. |
| `test/host.test.ts` | Activation and lifetime (coalesced concurrent gets, linger and revive, an abandoned activation disposed once it settles, activation failures propagating to dependents and retried, a throwing factory unwinding, duplicate declaration names refused, hold cycles detected, resources closed in reverse order with all steps run and errors aggregated, `ctx.get` holds released when the call settles); declarations and methods (names unique per kind, a no-arg method called with ctx alone, a void method resolving to `undefined`, **a listener on state getting the current value at start and again after a reload replaced its derivation**); lifetime `"host"` refused at compile time and runtime; principals, variants and disposal (objects per principal key, remote args/results validated at the provider boundary, forced disposal making references `gone` and aborting in-flight calls, late-bound state members delivering snap/reset/ops); registries (only `"host"` objects register, registration order kept, conflicts rejected); composition (reference state members as listener/derivation sources, `ctx.get` acting as the root principal at ingress and the host inside objects, calling a reference inside a factory throwing `not_ready`, a `ChordError` keeping its code through dependents). |
| `test/hydration.test.ts` | An object that forwards and derives from a remote member goes live with its value; a member read inside a factory throws `not_ready`; a child host object holding the parent's object goes live once the parent admits the child; a **reference cycle across hosts fails at `readyTimeout` with a cycle hint** (rather than hanging). |
| `test/json.test.ts` | `isJsonValue` checks strict JSON without normalising it; `copyJson` copies without retaining aliases, optionally omits `undefined` object properties without normalising arrays, preserves null prototypes and own `__proto__` data properties, and rejects cycles and non-strict container properties. |
| `test/link.test.ts` | Calls and state across hosts (the server stamps the child's principal; state members deliver a snapshot then delta-encoded ops; the server reaches a child by name; local types and unknown hosts refused); relay, stamping and lifetime (browser → server → worker with the worker's view of the browser's principal; payload principals from clients and children ignored; a route returning a closed link does not poison the host name; authorise before *and* after resolving; a browser disconnect releases exactly its holds; a dead link closes and releases everything; `contract_mismatch` for hosts and `upgrade_required` for browsers; `invalidatePrincipal` re-stamps the link and propagates to workers; after a reconnect, subscribers get a reset); methods without args/result; the protocol version (an old client is told and dropped; a client learns the server speaks another version and stops; an ordinary close is not a mismatch); packed payloads (large args/results/snapshots cross a relay deflated and arrive intact; only payloads above the threshold are packed); IPC (`EPIPE` ends the link instead of raising an unhandled error). |
| `test/links-review.test.ts` | A numbered review list of link fixes: the acceptor decides what a peer is (a client announcing itself as a host is cut off); `root_end` is honoured only from the link the root came over; a revocation while the route is resolving closes the relay and no worker object is made; malformed frames and duplicate ids close the link; a browser disconnect cancels its call downstream; state stopped while the route resolves is forwarded as a hold without state; a release while the route resolves settles waiting calls and forwards nothing; an origin disconnect removes its relayed holds downstream; two browsers share one worker connection and one leaving releases only its own holds; snapshots through an `accepts` adapter are validated against the **consumer's** schema; an abort while the child is loading modules frees its reload slot; the parent link dying while the child prepares unwinds the child; tasks the commit starts cannot reach a child before the child's commit; a child that missed a commit is reconciled on reconnect, never relabelled; a server root that bounces through a worker and back ends normally (no leaked lease). |
| `test/loader.test.ts` | The node loader loads facet modules and reloads them with fresh copies of their relative imports; loading modules without a configured loader is refused. |
| `test/manager.test.ts` | `processLock` admits one holder when the temp directory is too deep for a socket path; the host manager with **real child processes**: a child does not inherit the parent's lock; start/link/stop gracefully; a child-owned kernel lock admits one live process and `replace` waits for the exit; a graceful exit still takes the child's descendants with it; `idleFor` counts from the busy → idle transition; the process tree is killed when a child ignores shutdown past the grace period; a fatal child is a failed start; `keepAlive` stops an idle child. |
| `test/output-skip.test.ts` | Skipped output: the same tail whenever progress snapshots happen; the full stream is matched for every legal skip pattern; skipped bytes, lines and the final newline counted exactly; skips refused for head retention. |
| `test/output.test.ts` | Output bounds: control characters removed but tabs and newlines kept; output within the limits unchanged; a zero limit keeps nothing; exact whole-line slices with the trailing newline; a cut at the byte limit on whole lines; a single over-long line cut on a character boundary; a U+FEFF at a slice's start kept; surrogate edge cases cut exactly like `Buffer`; a deterministic fuzz set. `OutputBuffer`: exact totals across chunks and UTF-8 split across byte chunks; the retained text sanitised but the raw stream counted; a BOM dropped only at the very start; an incomplete character flushed before a string chunk and at the end; matching the whole-stream bound when several chunks arrive between snapshots; head storage stopping once full; only the tail window stored after each snapshot. `Progress`: the first change commits at once, then waits ≥ 100 ms **and** the written size at 100 KiB/s; the configured minimum interval honoured; pacing on an injected clock; a failed commit rejecting its waiters and reporting the error; `stop()` waiting for the in-flight commit and handing back the waiters no commit covered. |
| `test/placement.test.ts` | A `get` goes where the contract places the input — here, a child, or the parent — never named by the caller; `serve` refuses a type the host is not the place of (also at a reload); a host refuses a hold its own contract places elsewhere, and a relay one whose target disagrees; the host comes from the *normalised* input (unknown fields and defaults do not change it); placement is part of the contract, so a moved type is a breaking change never bridged by an adapter; `hostFamily`'s field must be a required string of the input and remote contracts need a host. |
| `test/principals.test.ts` | Factories, methods and contexts see the app's principal type; the host's own principal is recognised **by key** (an equal object reaches the same objects); a child's parent acts as the principal given to `connect` while relayed callers keep theirs; a host, a parent link or a route without its principal is refused. |
| `test/provider-cost.test.ts` | One change to K clients costs **K encodes** (one per feed), one frame per link, and the same ops on every link — the cost model of a fan-out state change. |
| `test/readiness.test.ts` | "Eager readiness": `install`/`load` await resource activation and registration while leaving lazy objects lazy; an eager failure rejects with the activation error; `load` installs every facet before awaiting eager consumers; a missing eager dependency rejects the load rather than only reaching `onError`; `ready` includes direct host serves but not later serves; readiness can be deferred until the parent admits the worker (`awaitHostObjects: false`). |
| `test/reload.test.ts` | The reload protocol end to end: a compatible reload with no gate, pinned roots on old code, state preserved and the previous version retired; **prepare runs in recording mode** (writes throw, a failing factory leaves everything unchanged); a changed cell schema without a version bump is refused; a state bump gates, migrates into the new schema, resets watchers and gives late old roots `upgrade_conflict`; versions are **per cell** (a raised one migrates only that cell, a lowered one is refused); the gate's admission cut, grandfathered roots' re-entry and the commit; a missed gate deadline aborts and names the blocking roots; exclusive resources replaced at the gate and non-exclusive ones at prepare; the two-version rule with `superseded`; forced retirement aborting leftover roots *before* closing their resources; a kept resource closing with the newest declaration's `close`; a task that ignores its abort delaying its replacement by at most `taskStopDeadline`; a facet's `signal` aborting when its run is replaced, removed, its reload aborts, or the host closes; contract checks at reload (forgotten bumps, live consumers, `accepts` adapters); listeners rebound and tasks restarted; registry tables per code version; a reload adding a type together with its consumer; the gate rejecting new objects of a changed type. |
| `test/replicated-state-delivery.test.ts` | Subscription delivery semantics: hydration awaited and each update independent of other subscribers; the pending-delivery bound at 100/101/102/201/202 frames; the running update excluded from overflow with the exact value/context/delivery retained; re-entrant hydration and update callbacks serialised; two subscriptions of the same callback treated independently; unsubscribe dropping queued callbacks without joining or aborting the running one; listener failures isolated (a synchronous hydration failure does not remove the subscription; a rejection is observed even after unsubscribe; a mutable state reports through its default error reporter). |
| `test/replicated-state.test.ts` | Transactional replicated state: one immutable structurally-shared revision published; a throwing callback rolls back and revokes escaped drafts; PromiseLike callbacks rejected and their draft aborted; nested changes/replacements rejected without losing the outer rollback; listener-triggered changes queued in sequence order; listener failures isolated after the commit; assigned values copied by value; alias-free replacements taken by immutable ownership; deeply equal replacements ignored. Authoritative sources: the snapshot captured before activation and queued commits drained in order; hydration at sequence zero when attaching after commits; exact source values published without applying or re-diffing; re-entrant frames buffered and updates covered by a late hydration skipped; listener failures reported without throwing into the source; **cursor gaps reported, the broken attachment disposed and later frames ignored**; attachments independent and disposed idempotently. |
| `test/requests.test.ts` | The numbered application-request list: a held object's state member returned as this object's state member; facets reaching their own host through `FacetApi.root`/`registry`; a listener keeping its subscription across reloads when resource and `select` are unchanged (and resubscribing when `select` changes); `replace` diffing a shared-structure revision and replacing unrelated values; a child behind the server admitted in the server's code version; `self.expose` (an opaque member backed by a resource); a cluster reload reporting what each child prepared; a held remote reference keeping its state without listeners; references reporting status changes (`live`, `loading` while a link reconnects, `gone`, `released`); host close disposing holders before what they hold and before closing links. |
| `test/review.test.ts` | Another numbered review list: a failing listener subscription failing **prepare** (nothing changes); migration validated against the new remote schemas; a commit that still fails midway failing the host terminally; re-entrant observers during a commit seeing the whole new code version; a running listener holding a lease so the gate waits; disposal waiting for running methods before closing resources; a registry conflict during activation unwinding the loser completely; releasing the last hold while listeners start not resurrecting the object; a prepare rerun unable to touch retained resources; objects of types a reload adds starting listeners and tasks only at commit; a breaking provider change and its updated consumer reloading in one batch; an exclusive resource whose close failed restored on rollback or marked unavailable; retirement closing dropped resources before releasing dropped holds; `fits` having no false positives for unmodelled keywords; arguments stripped to what the consumer knows and then to what the provider knows; an aborted task ctx unable to start fresh calls; an expired ctx and a foreign ctx refused; a remote reference refusing a foreign ctx and a ctx not made by Chord without calling. |
| `test/sqlite/cloudflare.test.ts` | The Durable Object driver: BLOB values bound and returned as `Uint8Array`; `get` reading only the cursor's first row; a bigint outside the safe integer range rejected; closing after an active transaction settles; an uncontended statement running before its promise returns; a rejected transaction rolled back and its handle refused afterwards; another adapter's operations running after the transaction, outside its rollback; direct underlying calls included in an active transaction. |
| `test/sqlite/helpers.ts` | A stand-in for a Durable Object's `ctx.storage` over `node:sqlite` with the Durable value types (ArrayBuffer blobs, multi-statement `exec`), so the portable package needs no Workers test dependency. |
| `test/sqlite/migrations.test.ts` | Migrations: independent histories tracked and already-applied migrations skipped; invalid versions rejected **before** touching the database; prefixes and the metadata table identifier validated before any SQL is executed; the initial bootstrap and every pending migration rolled back together. |
| `test/sqlite/node.test.ts` | The Node driver: connection defaults and explicit settings; work committed through the transaction handle and an idempotent close; concurrent transactions serialised; operations run in call order whether they start immediately or wait; ordinary operations queued behind an active transaction; database calls made synchronously by an immediately-started transaction queued behind it; a transaction handle used after its transaction settled rejected; a failed rollback not preserving the callback error. |
| `test/state-diff.test.ts` | The same diff contract as `delta-diff.test.ts`, expressed against the state's own diff (plus "falls back to a base operation when leaf operations are larger"). |
| `test/state-draft.test.ts` | Overlay drafts: only changed branches copied; frozen bases, deletion and native array mutators supported; inserted draft values copied without aliasing; comparator edits kept when sorting; writes through detached child references dropped; 100 000-item `unshift`/`splice` without argument overflow; non-strict JSON placements rejected without mutating the draft or the base; array holes rejected without mutating the committed base. |
| `test/state-fuzz.test.ts` | Randomised convergence: prepared revisions across random transactions converge. |
| `test/state-init.test.ts` | `init` runs after the resources are open and before the object goes live, so nothing sees another value; an init cell cannot be read inside the factory; a throwing or invalid init fails the activation, closes its resources and lets the next `get` retry; init runs in a root and can call other objects. On reload: an existing cell is kept without running `init`, a cell the reload adds runs `init` while it prepares, a failing added `init` refuses the reload (the old code keeps running), and in a gated reload the added cell's `init` runs at the gate. |
| `test/state-value.test.ts` | Immutable revision ownership: an alias-free mutable JSON root taken by ownership **without freezing**; transaction copies committed in place while sharing unchanged branches; repeated placements independent. |
| `test/state.test.ts` | State cells: snapshots then exact ops with derivations following; primitive cells and value-returning changes; a returned value that does not fit the schema rejected even outside dev mode; initial values validated always and writes only in dev mode; writes from inside a factory and placeholder use before activation rejected; listeners running each event in a fresh root and tasks getting an abortable ctx; **re-entrant writes publishing in adoption order with derivations never going stale**. |
| `test/telemetry-sqlite-store.test.ts` | The read side: **two span queries for a page, not one query per trace**; committed rows read without implicitly flushing (including after close); surviving descendants discoverable after a stored parent is removed. |
| `test/telemetry-sqlite.test.ts` | A shared conformance suite for span and propagation semantics, plus the buffering and aggregation contract: no SQL while recording and only settled spans stored; canonical series aggregated by interval with partial intervals written only on close; kind/name/unit/attributes separated without retaining descriptions; the queued-span bound (including the in-flight batch) and the pending metric-series bound; in-flight intervals counted against capacity until commit; a one-second flush and retention-only rows; concurrent flush and close serialised without losing measurements recorded during writes; `close` not waiting for business callbacks, ignoring late completions and leaving the database open; a write failure stopping recording permanently and reported identically without retry; an undefined background write failure remembered and the timer stopped; spans and aggregates rolled back together on SQL failure; migrations reused, identities preserved across reopen and aggregates merged from multiple adapters. |
| `test/tutorial.test.ts` | One test per numbered tutorial section (01–11), each with a 5 s timeout, plus a source-matching check that every TypeScript block in `docs/tutorial.md` equals its runnable source — so the documentation cannot drift. |
| `test/types.test.ts` | A type-level test: state members are `T`, other variants' members need narrowing, and gets are awaited. |
| `test/variants.test.ts` | A new variant's members arrive with its shape and a member outside the variant throws `not_in_variant`; after a link loss the last values stay readable, one fresh unit is sent, and a reference joining meanwhile waits for it. |
| `test/websocket.test.ts` | A browser-style client over a real socket, stamped by the authenticator; large snapshots and results reach the client as **binary** messages while clients may not send them. |

### Tier 3 — skipped with a reason

None. Every file in the shard was opened; the 46 source and doc files were read line by line, and the 63 test,
fixture and benchmark files were opened in batches and their case structure extracted (every `describe`/`it`/`test`
title, plus the imports and fixtures behind them), which is the level the brief asks for a tier-2 bulk read.

---

## 2. Ideas worth stealing

1. **A publication FIFO so a re-entrant write can never overtake the write being published.**
   `packages/chord/src/publish.ts:10-40`. A write *adopts* its revision first, then *enqueues* its notifications;
   `holdPublications(fn)` defers delivery until a multi-step change completes. The file names the bug it fixes:
   "subscriber A reacts to n = 1 by writing n = 2; subscriber B then sees 2 before 1."
   **Why it transfers:** August Trading's transcript, tool trail and live-sync surfaces all publish from inside writes
   (a tool result mutates state that a row renders). This is a small, provable ordering invariant, and it is the
   kind of thing a unit test can pin: *"a re-entrant write publishes in adoption order"*
   (`test/state.test.ts`, "re-entrant writes publish in adoption order"). — **CONVERGENT** in spirit with the other two
   repos' event-ordering discipline; the *implementation* here (one process-wide queue) is **UNIQUE** to `pi`.

2. **"State that must survive a reload lives in cells, never in closure variables" — and a *named* cell is the
   identity that survives.**
   `packages/chord/src/object.ts:164` (`self.state(name, schema, initial, { version, migrate })`),
   `packages/chord/docs/guide.md` (rules of thumb). Three *separate* version numbers protect three different
   boundaries: the **contract version** protects callers, the **state version** protects stored data, the **resource
   version** controls reopening. A schema change without a state bump is *refused*; a raised bump runs `migrate` on a
   private copy and validates the result before it is installed.
   **Why it transfers:** August Trading stores trade analyses, evidence floors and lesson rules in persisted
   structures. Naming the version on the *stored field* (not on the whole record) is what makes "one field's meaning
   changed" migratable without a data migration for everything else. — **UNIQUE** to this repo.

3. **Preparation isolation: a "dry run" of the new code with no side effects.**
   `packages/chord/src/reload.ts:205` (prepare) and `packages/chord/src/object.ts:1095` (activation). During a prepare
   the new factory runs over the *existing* objects: cell writes throw, listeners and tasks do not start,
   registrations are collected, and a changed resource opens *next to* the old one. Every failure leaves the old code
   running. The commit then only *installs*, because everything fallible already ran.
   **Why it transfers:** August Trading's "apply this proposal / migrate this trade log" flows are exactly this
   shape, and the pattern generalises: *validate the new code against the old state before you swap anything*. —
   **UNIQUE**.

4. **The admission cut: a late old caller gets a *retryable* error, not a wrong answer.**
   `packages/chord/src/reload.ts:457` (gate) and `packages/chord/src/errors.ts:24` (`RETRYABLE = {superseded,
   upgrade_conflict}`). At the cut, an old-code root that has not yet entered the migrating object is told
   `upgrade_conflict`; roots that already hold a lease are grandfathered. The error's `retryable` flag is a *property
   of the code*, not something each caller decides.
   **Why it transfers:** the same is needed wherever August Trading swaps a strategy, a schema or a scoring rule
   underneath a running request. — **UNIQUE**.

5. **"Awaiting a human inside a method pins a root" — record the request as state, answer it in a separate call.**
   `packages/chord/docs/guide.md:501`, `:507`, `:811`. The guide's own "wrong / right" pair:
   `approve: async (ctx) => waitForHuman(ctx)` versus *"record the request as state; the answer is a separate call"*.
   The long wait is a **state cell**; the approval is a **method** on the same object.
   **Why it transfers:** this is August Trading's human-in-the-loop shape (a pending approval, a tool call that must
   block). Writing it as state makes it survive a restart, a reload and a reconnect, and it makes the "who is waiting
   and on what" question answerable from a log. — **UNIQUE** as a *rule*, though the underlying idea (never hold a
   connection open for a human) is common.

6. **A listener on state must *reconcile*, not count.**
   `packages/chord/docs/guide.md` (State section) and `packages/chord/src/object.ts` (`stageListeners`). A listener
   whose source the reload replaced subscribes again and receives the current value *again*; the handler must set,
   compare or start/stop what the value says. The repo says it in one line: *"Write its handler to bring things in line
   with the value it gets … not to count or append per call."*
   **Why it transfers:** August Trading's automation scheduler, the lesson pipeline and the post-trade reflector are
   all "listeners on state". A handler that counts events will silently double-count after any restart, reload or
   reconnect. Making *reconcile* the documented contract (and testing it: "a listener on state gets the current value
   at start and again after a reload replaced its derivation", `test/host.test.ts`) is a cheap, high-value rule. —
   **CONVERGENT** (the other repos' replay/reconciliation discipline points the same way).

7. **Bounded output with *exact* drop accounting.**
   `packages/chord/src/output.ts:127` (`OutputBuffer`), `:325` (`Progress`). Head retention stops storing once the
   window is full; tail retention keeps a suffix slightly longer than the window; the counters
   (`droppedBytes`, `droppedLines`) are exact **for the whole stream**, not just the window. `Progress` paces commits
   by *written size* (100 KiB/s) as well as by a minimum interval, and the clock is injectable so the pacing is
   testable.
   **Why it transfers:** August Trading already has this idea in `utils/harnessMarks.ts` (the clipping note must name
   how much was kept vs existed) — Chord is a **convergent** implementation, with the added trick of pacing the
   *commits* by size so a fast producer cannot flood the UI. — **CONVERGENT**.

8. **A 100-frame delivery bound, with the "sequences may skip" consequence stated out loud.**
   `packages/chord/src/state.ts:102` and `packages/chord/README.md`. Each subscription retains at most 100 pending
   complete-value deliveries; on overflow only the newest pending value/context/delivery is kept, and a not-yet-started
   hydration is preserved. The docs say plainly: *"public delivery sequences may skip. This is a frame-count policy, not
   a byte limit."*
   **Why it transfers:** August Trading's live transcript and the dock/Chat sync need exactly this policy, and
   naming the consequence in the API doc is what stops a consumer from assuming a gap-free sequence. — **UNIQUE** in
   this exact form; the *bounded backlog* idea is **CONVERGENT**.

9. **Flow control that holds back *state only*, and never a result.**
   `packages/chord/src/connection.ts:349` (the class comment is the design). Calls, results, shapes and control frames
   are never held back; only state frames wait for the peer's acknowledgements. The first unit of a *new* reference
   bypasses the window (a `get` must never wait behind another reference's state); a re-hold does not. The waiting
   backlog is capped, and a slot that outgrows its cap becomes a reset.
   **Why it transfers:** this is the exact shape of a trading app's live channel: the trader must not wait behind a
   backlog of chart deltas to see a "trade closed" result. — **UNIQUE** in implementation; the *priority inversion*
   insight is **CONVERGENT**.

10. **Placement declared in the contract, so the caller never names a host.**
    `packages/chord/src/contract.ts` (`hostNamed` / `hostFamily`), `packages/chord/src/host.ts:1140` (`#resolve`
    authorises, resolves, then authorises again). A remote contract says *where* its objects live; the placement is
    data in the description, so it is in the fingerprint and in the hold token, and "a client never chooses where an
    object lives."
    **Why it transfers:** August Trading has several "where does this run" questions (which worker, which session,
    which device). Declaring the answer in the *contract* rather than in the call site removes a whole class of
    routing bug — and the "authorise before *and* after resolving" pattern is directly applicable to a broker or
    provider route. — **UNIQUE**.

11. **A compatibility rule that returns a *reason string*, not a boolean.**
    `packages/chord/src/contract.ts:289` (`coverage`): `"variant.member missing or of another kind"`,
    `"variant.member arguments"`, `"variant.member result"`, `"variant.member state"`. A refused binding says exactly
    what is missing, so the fix is obvious.
    **Why it transfers:** August Trading's provider adapters and its "accuracy mode" contracts would benefit from
    "what is missing" rather than "incompatible". — **UNIQUE**.

12. **`linkedSignal` instead of `AbortSignal.any` — a measured leak class.**
    `packages/chord/src/object.ts:490`. Node keeps a dependant of a long-lived source reachable while it has abort
    listeners, so a listener on `ctx.signal` kept its closure (and its code generation) alive for the object's
    lifetime. The fix is to *detach on close*. The CHANGELOG records it as a fixed bug, and
    `test/generations.test.ts` pins it ("abort listeners that calls and tasks add to their `ctx.signal` do not
    outlive them").
    **Why it transfers:** August Trading holds AbortControllers over long-lived resources (the app, a provider
    session, a renderer). This is a concrete, testable memory-leak pattern with a known fix. — **CONVERGENT** (all
    three repos deal with cancellation lifetimes; this repo is the one that *measured* it).

13. **A strict-JSON ownership contract instead of defensive copying, with an explicit mutation-rights table.**
    `packages/chord/src/delta/README.md` and `packages/chord/src/json.ts:31`. Nothing is frozen; `track()` takes
    ownership in O(1) and never walks the tree. The README's blunt framing: *"an illegal mutation is not detected. It
    silently corrupts state."* The mitigation is a *documented boundary rule*: clone or serialise at every mutable
    trust boundary, and name the trust boundaries.
    **Why it transfers:** August Trading's `copyJson` / strict-JSON helpers are the same idea done the other way
    (copy always). Chord's contribution is the *table* — which value may be mutated by whom — and the rule "validate
    untrusted roots at your ingestion boundary, then transfer". — **CONVERGENT**.

14. **Prototype-pollution defence as a first-class part of the data path.**
    `packages/chord/src/delta/index.ts:131` (`RESERVED_SEGMENTS`), `assertSafePath`, and the appliers' use of
    `Object.defineProperty`. The threat model is stated: *"Ops arrive from a facet, a plugin compartment, or a tool
    whose details may echo model output, so none of it is trusted input."* And the index rule
    (`src/delta/index.ts:304`): an array index may address an existing element or append exactly one past the end —
    anything else produces state a replica cannot match, and is the 4-billion-entry DoS.
    **Why it transfers:** August Trading ingests model output and tool payloads into persisted state. A path-shaped
    payload from a model is exactly the untrusted input this defends against. — **UNIQUE**.

15. **A portable SQLite facade with an explicit transaction contract, and a "rollback failed" error that cannot be
    mistaken for the callback's error.**
    `packages/chord/src/sqlite/database.ts`: *"If rollback fails, it must reject with a different error (for example
    an `AggregateError`) so callers cannot mistake the callback error for a guaranteed rollback."* Plus the migration
    runner: contiguous versions from 1, one transaction for the whole bootstrap, a stored version newer than the code
    is an error.
    **Why it transfers:** August Trading's SQLite layer (and its backup/export flows) would benefit from the same
    contract, and the "rollback failed" distinction is a real correctness detail. — **CONVERGENT** (the other repos
    also use SQLite; the *contract prose* is this repo's contribution).

16. **A queryable structured log without a heavy database: SQLite spans + metric aggregates with a `TelemetryStore`
    read API.**
    `packages/chord/src/telemetry-sqlite/index.ts:338`, `src/telemetry-sqlite/store.ts:74`. Two span queries per page
    (not one per trace), type-aware attribute matching through `json_each` (so boolean `true` ≠ numeric `1`),
    cursor pagination, seven-day retention, and metrics kept as count/sum/min/max per ten-second interval — *not*
    raw samples.
    **Why it transfers:** this is the "trade log the model can query" answer. The two-query page and the
    type-aware JSON attribute match are both directly reusable in August Trading's trade-log query layer. —
    **CONVERGENT** (telemetry is a theme across the repos; this particular storage shape is **UNIQUE**).

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** this shard's answer is the **`task` declaration**, not a scheduler.
  `self.task(fn)` is a *code holder*: it gets an abortable `ctx`, and every call it makes starts a **fresh short
  root** (`packages/chord/src/object.ts`, `SelfImpl.task`; `docs/guide.md:501`). On a reload the old run is aborted
  through `ctx.signal` and the replacement starts only after the old one finished, at most `taskStopDeadline` (5 s),
  with the overrun reported. **What is *not* here:** no cron, no recurrence, no catch-up for missed runs, no
  idempotency key, no "three empty runs ⇒ disable" breaker. The spec's own rule is the substitute: *"Long-running
  work is a `task`, and long waits are state."* For August Trading, this shard contributes the **cancellation and
  restart discipline** of a long-lived job (abort → wait → replace, with a bounded deadline and a report), not the
  scheduling.
- **Human-in-the-loop approval:** there is no approval queue here, but there are the three primitives one is built
  from. (a) *A human wait is state, not a held call* (`docs/guide.md:501-511`). (b) *Refusals are a stable vocabulary*:
  `forbidden` (the factory or a method refused this principal), `invalid` (with a `reason` such as `invalid/args`),
  `not_in_variant` (the member does not exist in the variant you hold), `gone` (the object was forced away — call
  `get` again). (c) *Revocation* is `host.invalidatePrincipal(match)`, which force-disposes matching objects here and
  over links, re-stamps or closes the links, and propagates a pattern to child hosts — the audit trail is
  "references become `gone`", observable through `onStatus`. The lesson for August Trading: an approval that is
  *waiting* should be a state record with a stable refusal vocabulary, and a revoked grant should force existing
  references to `gone` rather than leave them half-valid.
- **Post-mortem / reflection loops:** not in this shard (no skill/rule lifecycle lives here). The nearest analogue is
  the **migration contract**: a stored value's *meaning* may change, and the change is declared by raising a version
  and supplying `migrate(old, from)`; the runtime refuses a schema change without a bump, validates the migrated
  result, and gates the swap so no reader sees a half-migrated value (`packages/chord/src/reload.ts:505`). That is the
  exact discipline August Trading would need for "the meaning of an evidence score changed on 2026-10-22".
- **Multi-agent:** not in this shard. The multi-*host* coordination is process-level, not agent-level: a server
  coordinates workers, a relay forwards references, and the "debate" analogue is a **vote** — every participant
  prepares and votes, and one failed vote aborts the whole cluster (`packages/chord/src/cluster.ts:39`). The
  transferable idea is the *voting shape*: prepare → vote → all-ok → commit, with a deadline and a named failing host.
- **Structured logs the model can query:** `telemetry-sqlite` is the answer — SQLite tables `telemetry_spans`,
  `telemetry_metrics`, `telemetry_schema`; a `TelemetryStore` read API (`findTraces`, `getTrace`, `findMetrics`);
  two queries per page; type-aware JSON attribute filters; cursor pagination; seven-day retention; and a
  write-failure-is-permanent rule. No heavy database, and the read side is plain SQL a model can be shown.
- **Staying simple as features accumulate:** the runtime's answer is *subpath exports and a machine-checked boundary*.
  Nine subpath exports, two runtime dependencies (`typebox` and `pi-telemetry`), and `test/boundary.test.ts` asserts
  that the package "does not depend on Pi packages other than pi-telemetry, or on files outside Chord". The spec also
  records a **rejected simplification** so it is not re-proposed: *"Objects keep named cells and unnamed derivations;
  giving each object exactly one state value was rejected. Do not reopen this without a new, concrete problem."*

---

## 4. Non-obvious decisions and gotchas

1. **A cell tracks `{ v: value }` and strips the box from the published ops** (`src/cell.ts:127`). The tracker only
   tracks *containers*, so the cell wraps its value; every published op has the box path removed. Reading the cell
   code without knowing this makes the op paths look wrong.
2. **`replace()` diffs automatically when the new value *shares a container* with the old one** (`src/cell.ts:276`) —
   a structural-sharing test, not an identity test. Unrelated values get one `r` op; the resulting value is identical
   either way.
3. **The `HYDRATION` symbol** (`src/cell.ts:66`) is how a state source says "I do not have my value yet". An object
   goes live only once *every* source it exposes or derives from has one — including a source that merely *forwards*
   another object's member.
4. **A re-hold after a link loss is marked `again`, and `again` makes the unit *not* urgent** — so a reconnecting
   client's state waits for the window like any other state, while a *first* hold bypasses it.
5. **`Link.send` returns the size *as sent*, and links that report no size are never windowed.** Node IPC therefore
   has **no flow control at all** — the only reason is that IPC cannot report a size.
6. **`overlap()` is a probe-and-verify, not KMP** (`src/delta/index.ts:87`), and the candidate count is bounded —
   repetitive output (a build log) makes a long head match at thousands of positions, and giving up emits a set
   (larger, never wrong).
7. **The delta encoder interns a path on its *second* use and clears the dictionary on an `r`** — a base batch is a
   recovery point, so everything after it must be self-contained.
8. **`assertIndexInRange`** allows an index to address an existing element or append exactly one past the end, and
   nothing else (`src/delta/index.ts:304`). This is simultaneously a correctness rule (holes do not survive a JSON
   round trip) and a DoS rule (one op must not allocate 4.29 billion entries).
9. **`sameSelect` compares a listener's `select` by *source text*** (`src/object.ts:1005`), so an inline arrow is
   "the same" across reloads. The known miss: a select whose captured values change between runs is not detected.
10. **The host's own reference to a `lifetime: "host"` object is a lifecycle pin, not an old-contract consumer** — it
    adopts the new contract at commit and needs no `accepts` adapter for itself, while every *other* reference still
    obeys the compatibility rules.
11. **A child host behind its parent is *fenced*, never renumbered**, and its roots are admitted in the parent's
    *current* code version rather than refused `superseded` — "the parent never ran that code version."
12. **The reload's `retire` frames must reach the children before `prepare`** (FIFO), so a child never retires a
    version the parent still runs roots of.
13. **A commit that fails midway fails the host *terminally*** — the host "admits no work" and every call fails
    `unavailable/host_failed`. A half-published code version is worse than a dead host.
14. **`processLock` is a kernel lock** (abstract socket / named pipe) so it dies with the process; on macOS and the
    BSDs the socket path must fit `sun_path` (103 bytes), so a deep temp directory moves it to a private per-user
    directory whose ownership and mode are verified (`src/manager.ts:82`, `:126`).
15. **`apply` adopts an `r` payload rather than copying it** — fanning one in-memory batch out to several mutable
    replicas makes them alias each other. It is documented as an *ownership rule*, not a defect.

---

## 5. Weak spots

1. **The publication queue is a process-wide singleton and is synchronous.** A slow observer delays *every* later
   notification in the process, including other hosts' — the spec admits it (§12). The design is the most valuable
   idea in the shard and also its sharpest scaling limit; August Trading should take the *ordering invariant* and
   not the global queue.
2. **The reload commit decision is not persisted.** A server crash between its own commit and a child's leaves that
   child on the old code version until it reconnects and is reconciled (spec §12). There is no journal of the commit,
   and one level of reload participants only (a child does not forward `prepare` to its own children).
3. **The Node loader leaks module copies and does not isolate plugins** (`src/loader.ts:3`, `TODO(loader)`): every
   reload imports fresh copies under a new query and the old copies are never evicted. TUI plugins need isolation this
   loader does not provide.
4. **The `fits()` subtyping function is conservative by construction** (`src/schema.ts:134`): any keyword it does not
   model forces exact equality, so a legitimate additive change can be refused. And a **change of meaning with an
   identical schema is undetectable** — the spec calls it "the author's responsibility".
5. **`src/delta/tracker.ts` is 2 239 lines** of proxy and piece-tree machinery with dense-region folding, a
   simple-object fast path, and a global `locatedDenseArray` module variable that is reset around emission. The
   measured cost is not trivial (≈ 9 ms per 20 000 nested draft reads versus 0.08 ms raw) and the file is where a
   subtle correctness bug would hide. It is, however, the best-documented performance work in the repo: three
   benchmark harnesses with per-phase timings and retained-memory reporting.
6. **The contract fingerprint is a non-cryptographic 64-bit hash** (`src/schema.ts:22`, two FNV-1a lanes). The
   reasoning is sound ("contracts are trusted, so collisions are not an attack surface") but it means a fingerprint is
   an *identifier*, not a security boundary — a reader who treats it as one will be surprised.
