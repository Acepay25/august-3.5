# deepseek-harness :: dsh-mcp-lsp

**Files in shard:** 86 (read: 86, skipped with reason: 0)
**What this shard covers:** the two *external-capability* families of the DeepSeek Harness — the LSP
family (`packages/lsp/lsp` = the `ctx.lsp` seam, `packages/lsp/lsp-stdio` = a stdio language-server
provider, `packages/lsp/tool-lsp` = the model-facing `lsp` tool) and the MCP family
(`packages/mcp/mcp-client` = the bridge to external Model Context Protocol servers,
`packages/mcp/mcp-resources` = shared, scope-aware resource tools). The unifying architecture is
**capability seam + pluggable provider + exactly one owner of the model-facing surface**: providers
register *capabilities*, never tools; one package owns the name, schema, prompt guidance and
presentation; results cross the seam as closed unions with stable error codes; and the canonical
value is kept whole while only the *projection* is capped.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `packages/lsp/lsp/src/index.ts`
- **Purpose:** the `ctx.lsp` Service Definition — a language-server provider registry plus
  order-independent per-query selection over the four navigation operations.
- **Key abstractions:** `Lsp` (extends Cordis `Service`, key `lsp`), `LspError extends HarnessError`,
  `finalExtension()`, `Route` (internal `{provider, languageId}`), `normalizeExtension()`.
- **Data flow:** `query(request, signal)` → `finalExtension(request.filePath)` → `routes.get(ext)` →
  no route ⇒ throw `LspError(..., 'LSP_UNAVAILABLE')`; else
  `route.provider.query({...request, languageId: route.languageId}, signal)`.
- **Non-obvious design decisions:**
  - **Atomic registration** (`index.ts:99-135`): every validation and conflict check runs *before*
    any mutation. A provider mapping `.py` and `.ts` where `.ts` is already taken publishes
    **nothing** — `.py` is not reserved either. The reservation then happens inside a single
    `ctx.effect()` generator so the id and every extension are released together.
  - **Order-independent selection** (`index.ts:158-166`): routing is by final extension only.
    Registration order (and HMR order) can never change which provider answers.
  - **No JSON-RPC escape hatch** (`types.ts:14-19`): the operation union is *closed*. Adding an
    operation is a compile-enforced change across seam, provider, and tool.
  - **Provider-owned workspace coordinate**: the `locations` result variant carries
    `resolvedWorkspaceUri` so consumers relativize URIs in the *execution world's* namespace rather
    than applying host-platform path rules to a possibly symlinked path.
- **Edge cases & failure handling:** empty provider id → `LSP_INVALID_PROVIDER`; duplicate id →
  `LSP_CONFLICT`; zero extensions → `LSP_INVALID_PROVIDER`; malformed extension key
  (`EXTENSION_PATTERN = /^\.[^./\\]+$/`, so `.tar.gz` is invalid) → `LSP_INVALID_PROVIDER`; empty
  language id → `LSP_INVALID_PROVIDER`; the same extension twice inside one provider (e.g. `.ts`
  and `TS`) → `LSP_INVALID_PROVIDER`; extension owned by another provider → `LSP_CONFLICT`.
  `finalExtension` returns `''` for extensionless names and leading-dot dotfiles (`.bashrc`),
  which no route ever matches.
- **Surprising:** `registerProvider` returns a *synchronous* disposer wrapping an async
  `ctx.effect` disposer with `void dispose()` — a deliberate fire-and-forget seam between Cordis's
  promise-returning effect API and a sync disposer contract, commented as such
  (`index.ts:136-138`).

### `packages/lsp/lsp/src/types.ts`
- **Purpose:** the seam's closed vocabulary — request, provider, and result contracts. Types only.
- **Key abstractions:** `LspOperation` (4-member closed union), `LspPosition`, `LspRange`,
  `LspQueryRequest`, `LspProviderQuery` (= request + derived `languageId`), `LspLocation`,
  `LspHover`, `LspQueryResult` (closed union on `kind`), `LspProvider`, `LspService`.
- **Data flow:** caller → `LspQueryRequest` (all fields required, no defaults) → seam derives
  `languageId` → `LspProviderQuery` → provider → `LspQueryResult` → consumer `switch`es on `kind`.
- **Non-obvious design decisions:** *every* request field is required on purpose, so there is no
  `resolve()` step and no implementation defaulting (`types.ts:44-51`). The `languageId` "only
  synchronizes the transient document; it does not participate in selection". The `locations`
  variant's `resolvedWorkspaceUri` is documented as *mandatory* for relativization ("MUST use
  this, not parse the request's possibly symlinked process path with host-platform rules").
- **Edge cases & failure handling:** the result union is discriminated by `kind`, so an unhandled
  new variant breaks compilation rather than silently falling through.
- **Surprising:** positions are zero-based UTF-16 at the seam, while the *model-facing* tool
  accepts one-based cursor coordinates and converts — the coordinate convention boundary lives in
  the tool, not the seam.

### `packages/lsp/lsp/src/brand.ts`
- **Purpose:** the opaque provider identity type.
- **Key abstractions:** `LspProviderId = Branded<'LspProviderId'>` and its factory.
- **Data flow:** a string is branded at the provider's construction site; the registry treats it as
  opaque identity.
- **Non-obvious design decisions:** the factory performs **no validation** — "the registry rejects
  an empty id at registration" (`brand.ts:14-19`). Validation lives at the registry, so a bad id
  fails at the seam with a structured code.
- **Edge cases & failure handling:** none here by design.
- **Surprising:** 827 bytes, but load-bearing — it is what makes "provider id" and "arbitrary
  string" different types.

### `packages/lsp/lsp-stdio/src/index.ts`
- **Purpose:** plugin entry — config schema, load-time executable resolution, one isolated provider
  per configured server, per-workspace process pooling, one transparent transport-failure retry.
- **Key abstractions:** `apply(ctx, config)`, `Config`/`LspLocalServerConfig` (schemastery),
  `LocalLspProvider` (implements `LspProvider`), `validateServerConfig`, `assertTimer`,
  `assertPositiveInteger`, `throwTeardownFailures`.
- **Data flow:** `apply()` → validate all server entries → `ctx.subprocess.resolveExecutable()` for
  every command **before publishing any provider** → construct `LocalLspProvider`s → `ctx.effect()`
  registers them with `ctx.lsp.registerProvider` → on disposal, unregister *all* routes first, then
  `disposeAll()` on every provider.
- **Non-obvious design decisions:**
  - **Resolve-everything-before-publishing-anything** (`index.ts:141-171`): a bad later server id
    prevents *earlier* providers from registering. The rollback path awaits
    `Promise.allSettled(lookups)` so no sibling lookup is left dangling.
  - **Setup cancellation is wired to the plugin's own disposal** (`index.ts:126-134`): the plugin
    listens for `internal/plugin` and aborts the setup `AbortController` when *its own* fiber is
    disposed — because "unload otherwise waits for this callback".
  - **Read-before-spawn** (`index.ts:238-252`): the source is read *inside* the workspace queue and
    *before* any process is created, so a queued query sees current bytes when its turn starts and
    an invalid source cannot leave an idle pooled process.
  - **One retry, only for transport failures** (`index.ts:255-283`): `canRetryTransport` is set to
    `false` after the first retry, and the retry is gated on `instance.isTransportFailure(reason)` —
    an *identity* check against the connection's retained fatal cause, so a genuine server error is
    never retried.
  - **The queue tail never rejects** (`index.ts:288-296`): `previous.then(() => result).then(() =>
    undefined, () => undefined)` — "later callers serialize without inheriting an earlier query's
    outcome". The tail follows the *actual* prior work, not the abortable view, so a caller giving
    up on the wait does not deserialize the queue.
  - **Config validation that fails loud at load** (`index.ts:189-215`): timer budgets must be
    positive integers within Node's timer range, byte caps must be positive. The comments explain
    *why* each matters: `slice(-0)` keeps everything, `maxMessageBytes: 0` makes every response
    fatal, and `deadline()`'s `<= 0` is the internal no-timeout sentinel that would let a server
    that ignores shutdown hang disposal forever.
- **Edge cases & failure handling:** teardown failures are aggregated only after every sibling has
  settled (`throwTeardownFailures`: one failure rethrown as-is, several as `AggregateError`).
  Disposal unregisters routes *before* tearing down processes "so no new query can enter a draining
  provider". A query whose instance died is evicted and, if both query and teardown failed, the two
  errors are combined into `AggregateError([queryReason, teardownReason], 'LSP operation and
  teardown failed')`.
- **Surprising:** `assertActive()` is a method rather than a field read (`index.ts:207-209`) — a
  `query()` await would otherwise narrow a plain boolean field to a literal type, defeating the
  check.

### `packages/lsp/lsp-stdio/src/instance.ts`
- **Purpose:** one language-server process — the `initialize` handshake, a serialized abortable
  query queue, the transient `didOpen`→request→`didClose` lifecycle, and bounded teardown.
- **Key abstractions:** `LspInstance`, `InstanceSpec`, `CLIENT_CAPABILITIES`,
  `LIFECYCLE_NOOP_METHODS`, `markSettled()`.
- **Data flow:** constructor spawns the connection and starts `initialize()` immediately. `query()`
  → `abortable(this.queue, signal)` → `runQuery()` → capability checks → `didOpen` → request →
  normalize → `finally` → `didClose`.
- **Non-obvious design decisions:**
  - **`processId: null` in `initialize`** (`instance.ts:118-120`): "A subprocess provider may run in
    another PID namespace or machine; the host PID would let the server monitor an unrelated
    process." This is why a hard-killed harness *orphans* language servers.
  - **The queue tail follows the real prior work** (`instance.ts:96-99`): `this.queue = this.queue
    .then(() => run).then(() => undefined, () => undefined)`. Aborting a waiter must not
    deserialize the shared queue.
  - **Cancel grace with forced teardown** (`instance.ts:227-257`): on abort, send `$/cancelRequest`
    and race the pending request against a `killGraceMs` deadline. If the request settled (either
    outcome) the instance survives; if it did not, the instance is torn down "so nothing outlives
    the query" and "the still-active request cannot overlap the next queued query's document
    lifecycle".
  - **A poisoned instance is never pooled** (`instance.ts:157-168`): if the handshake wait fails —
    an abort *or* `initialize` rejecting — the instance is torn down, because "a
    permanently-rejecting/pending `ready` can't make every later query for this workspace fail".
  - **`didClose` is skipped when the instance is already dead** (`instance.ts:181-192`): sending it
    would race the teardown and let the next queued query's document lifecycle overlap the
    still-active request.
  - **The client refuses to mutate** (`instance.ts:265-286`): `workspace/applyEdit` is rejected;
    lifecycle bookkeeping (`window/workDoneProgress/create`, `client/registerCapability`,
    `client/unregisterCapability`) is answered with `null`; anything else is rejected as
    "unsupported server request".
- **Edge cases & failure handling:** `findReferences` always sends `context.includeDeclaration:
  true` ("the caller gets no flag and impact analysis never omits the defining site"). A `didClose`
  write failure does **not** replace a settled result — the result is kept and teardown is awaited
  (`instance.ts:186-191`). A `didOpen` write failure tears down before rethrowing, because "a
  canceled backpressured write or failed stdin leaves the protocol stream unusable before `opened`
  can arm the didClose cleanup".
- **Surprising:** `gracefulShutdown` is best-effort — a failure or timeout is swallowed
  (`instance.ts:305-311`) and managed-range cleanup remains authoritative. And `forceTerminate`'s
  awaits are **unbounded on purpose** ("quiescence, not another timer, is the postcondition
  disposal owes callers") (`instance.ts:320-327`).

### `packages/lsp/lsp-stdio/src/connection.ts`
- **Purpose:** the JSON-RPC endpoint over one spawned language server — id correlation, outbound
  requests/notifications, inbound server→client requests, stderr capping.
- **Key abstractions:** `LspConnection`, `ConnectionSpec`, `ConnectionWriter`, `ConnectionSpawner`,
  `Pending`.
- **Data flow:** `request(method, params)` → allocate `nextId++` → register in `pending` → write
  `{jsonrpc, id, method, params}` → stdout chunk → `MessageDecoder.push` → `dispatch` →
  `handleResponse` resolves/rejects the pending entry; `handleServerRequest` answers the
  server→client request and writes back a result or a `-32601` error.
- **Non-obvious design decisions:**
  - **stderr is a bounded tail, not a spill** (`connection.ts:105-108`): "stderr is a collected
    diagnostic tail (no spill — the bounded tail IS the contract)".
  - **The close reason is recorded so a post-close request rejects immediately** instead of
    hanging (`connection.ts:127-140`): "a closed process sends no further responses".
  - **stdin errors are fatal even if the process is alive** (`connection.ts:142-144`): "Child stdin
    can fail while the process itself remains alive (for example, a server closes fd 0)".
  - **A framing failure terminates the managed range** (`connection.ts:246-254`): "a framing/JSON
    failure corrupts the stream position irrecoverably" — helpers must not outlive the leader.
  - **The writer is injectable** (`connection.ts:78-83`): "tests inject callback failures without
    relying on OS pipe races" — a seam that lets tests simulate transport faults deterministically.
  - **A no-op catch keeps late rejections from surfacing as unhandled** (`connection.ts:180-186`).
- **Edge cases & failure handling:** `peekNextId()` exposes the *next* id so the instance can
  pre-arm a `$/cancelRequest` before sending. `cancel()` is best-effort and swallows write
  failure. `exitMessage()` appends the retained stderr tail to the exit error so the failure is
  diagnosable.
- **Surprising:** `LspConnection` does not know about LSP at all — it is a generic
  JSON-RPC-over-`Content-Length` endpoint. The LSP-specific answers live in `instance.ts`.

### `packages/lsp/lsp-stdio/src/framing.ts`
- **Purpose:** `Content-Length` framing — encode one message, decode a byte stream into complete
  message bodies, with bounded header and body size.
- **Key abstractions:** `encodeMessage()`, `MessageDecoder` (`push()`), `parseContentLength()`,
  `MAX_HEADER_BYTES = 1 << 16`.
- **Data flow:** `push(chunk)` → concatenate into an internal buffer → repeatedly `next()` until it
  reports "not ready" → each complete body is `JSON.parse`d and returned in arrival order.
- **Non-obvious design decisions:** the header cap exists so "a server that never sends the
  separator cannot grow the buffer forever". `Content-Length` is matched case-insensitively and
  other headers are ignored, matching the base protocol. `parseContentLength` requires a
  *non-negative integer* — a missing or non-numeric header is an error, not a default.
- **Edge cases & failure handling:** body over `maxMessageBytes` → throw; missing `Content-Length`
  → throw; non-numeric → throw; header block over 64 KiB (with or without terminator) → throw;
  invalid JSON body → throw with the parse message.
- **Surprising:** the decoder is stateful across chunks but trims with `subarray`, so a
  partially-consumed buffer is never copied.

### `packages/lsp/lsp-stdio/src/host.ts`
- **Purpose:** filesystem-seam source access — workspace canonicalization and byte-bounded source
  reads through `ctx.fs`.
- **Key abstractions:** `HostWorkspace` (`target`/`canonicalPath`/`fileUrl`), `HostSource`,
  `canonicalizeWorkspace()`, `readHostSource()`.
- **Data flow:** `canonicalizeWorkspace` → `fs.resolve` → `fs.stat` (must be a directory) →
  `{target, canonicalPath: fs.processPath(target), fileUrl: fs.fileUrl(target)}`.
  `readHostSource` → `fs.resolve` relative to the workspace → `fs.contains(workspace.target,
  target)` → `fs.streamText` → accumulate chunks, counting UTF-8 bytes, stopping at
  `maxDocumentBytes`.
- **Non-obvious design decisions:**
  - **The filesystem provider owns URI syntax** (`host.ts:31-33`): the harness host may differ from
    the execution platform, so `fileUrl` comes from `fs`, never from hand-built `file://` strings.
  - **Containment is checked before the bytes are read** (`host.ts:88-90`): a source outside the
    canonical workspace is rejected before any server exists.
  - **The byte cap reports the observed lower bound** (`host.ts:104-107`): "reading stopped after
    N bytes" — a truncated-read message that says what was seen, not just the limit.
  - **An `XXX(lsp-source-replacement)` marker** (`host.ts:95-96`): a deliberate note that
    stable-handle identity between the containment check and the open is *not* yet handled, with
    the condition under which it should be revisited.
- **Edge cases & failure handling:** non-directory workspace → error; source outside workspace →
  error; missing source → the fs provider's "not found"; non-regular file (directory, FIFO) →
  "not a regular file"; non-UTF-8 → the fs provider's "invalid UTF-8"; pre-aborted signal →
  honoured before any filesystem work; every provider error is wrapped with the path and the
  original as `cause`.
- **Surprising:** the doc comment says "This layer owns the LSP-specific complete-document cap
  while the filesystem provider owns streaming, regular-file checks, and UTF-8 validation" — a
  deliberate split of responsibility between the seam and the layer above.

### `packages/lsp/lsp-stdio/src/translate.ts`
- **Purpose:** pure protocol translation — capability checks, UTF-16 negotiation, and normalization
  of `Location`/`LocationLink`/`Hover` payloads into the seam's closed unions.
- **Key abstractions:** `requestMethod()`, `capabilityValue()`, `supportsCapability()`,
  `supportsOperation()`, `supportsTransientOpen()`, `isOpenCloseKind()`,
  `negotiatePositionEncoding()`, `normalizeLocations()`, `normalizeHover()`,
  `renderHoverContents()`, `renderMarkedString()`, `isRange()`, `isPosition()`,
  `isProtocolCoordinate()`, `malformedResponse()`.
- **Data flow:** raw server payload → structural guards → closed-union value, or a
  `LspError(..., 'LSP_MALFORMED_RESPONSE')`.
- **Non-obvious design decisions:**
  - **`supportsTransientOpen` treats the legacy enum and the options form differently**
    (`translate.ts:84-97`): the enum `Full(1)`/`Incremental(2)` *imply* open/close, but the options
    form requires an **explicit** `openClose: true`, "because the protocol defaults an omitted
    `openClose` to false". `supportsTransientOpen({change: 1})` is `false`.
  - **`negotiatePositionEncoding` rejects everything but utf-16** (`translate.ts:112-115`): an
    omitted encoding defaults to utf-16; any other value is a protocol error. It fails rather than
    silently mis-indexing a document.
  - **Malformed ranges are never silently dropped** (`translate.ts:196-201`): a hover with a
    malformed range throws rather than returning a range-less hover.
  - **Coordinates are validated as non-negative integers** (`translate.ts:154-156`): negative and
    fractional line/character values are rejected as malformed.
  - **A language-tagged `MarkedString` becomes a fenced code block**; a bare string stays verbatim;
    an array joins with one blank line.
- **Edge cases & failure handling:** `null` hover → `null`; `undefined` → malformed; empty
  `MarkupContent` value → `null` (a no-hover, not an error); a non-object element inside a
  locations array → malformed.
- **Surprising:** the module is **100% pure** — "No I/O or process state — every function here is a
  pure transform, which the fake-stdio tests pin exactly." That is why the malformed-payload matrix
  is testable without a process.

### `packages/lsp/lsp-stdio/src/protocol.ts`
- **Purpose:** the subset of LSP wire types this host reads/writes. Types only.
- **Key abstractions:** `WirePosition`, `WireRange`, `WireLocation`, `WireLocationLink`,
  `WireMarkupContent`, `WireMarkedStringObject`, `WireMarkedString`, `WireHover`,
  `WireTextDocumentSyncKind`, `WireTextDocumentSyncOptions`, `WireProviderCapability`,
  `WireServerCapabilities`, `WireInitializeResult`.
- **Data flow:** wire payload → `translate.ts` structural guards → seam union.
- **Non-obvious design decisions:** the doc comment states the discipline: "Types only. Fields
  absent from a real server payload stay optional; the translation layer normalizes them into the
  seam's closed unions." Optionality is *in the wire type*; the closed union is *in the seam type*.
  `WireProviderCapability = boolean | Record<string, unknown> | undefined` deliberately models
  "both boolean and options object mean supported".
- **Edge cases & failure handling:** none — validation lives in `translate.ts`.
- **Surprising:** `positionEncoding` is typed as a plain `string`, not a union — the *check* is
  `negotiatePositionEncoding`'s runtime job.

### `packages/lsp/lsp-stdio/src/abort.ts`
- **Purpose:** shared cancellation helpers fusing caller and disposal signals.
- **Key abstractions:** `abortError(signal)`, `throwIfAborted(signal)`, `abortable(work, signal)`.
- **Data flow:** `abortable` races the owned work promise against an abort rejection; the work keeps
  its own handlers and "continues to its owner-defined quiescence boundary".
- **Non-obvious design decisions:**
  - **Timeout classification is preserved** (`abort.ts:12-17`): `timeoutOf(signal)` wins over the
    raw reason, so a timeout deadline surfaces as a timeout, not a generic abort.
  - **A non-`Error` abort reason is coerced** (`abort.ts:20-22`): a string reason becomes
    `new Error('LSP query aborted')`.
  - **The work is NOT cancelled by the race** (`abort.ts:38-46`): "the underlying work keeps its own
    handlers and continues to its owner-defined quiescence boundary" — the helper abandons the
    *wait*, not the work.
- **Edge cases & failure handling:** an already-aborted signal rejects immediately without
  registering a listener; the abort listener is removed in `finally` so a long-lived signal does
  not accumulate listeners.
- **Surprising:** `Promise.withResolvers` + `Promise.race` is used rather than `AbortSignal`'s own
  event wiring — it keeps the helper usable with a plain `Promise` and no Node-only APIs.

### `packages/lsp/tool-lsp/src/index.ts`
- **Purpose:** the model-facing `lsp` tool over `ctx.lsp` — one read-only tool, four operations,
  one-based→zero-based coordinate conversion, bounded rendering, and a timeout budget.
- **Key abstractions:** `apply(ctx, config)`, `Config` (schemastery), `DEFAULT_LSP_TOOL_TIMEOUT_MS`
  (60 000), `LSP_PROMPT_TEXT`, `LSP_POSITION_OUTPUT_SCHEMA`, `LSP_RANGE_OUTPUT_SCHEMA`.
- **Data flow:** `apply` → validate config → `ctx.systemPrompt.section({name: 'tool:lsp', order:
  ctx.systemPrompt.getSectionOrder('TOOL_LSP'), text: LSP_PROMPT_TEXT})` → `ctx.tools.register(
  defineTool({...}))`. `execute(args, exec)` → `parseLspArgs(args)` → `ctx.workingDirectory.ensure(
  exec.agent, exec.signal)` → `ctx.lsp.query({operation, filePath, position, workspaceRoot},
  exec.signal)` → map the closed union to the canonical tool value → `render` formats the text.
- **Non-obvious design decisions:**
  - **Consumer-only** (`index.ts:56-58`): the plugin injects only `tools`, `lsp`, `systemPrompt`,
    `workingDirectory` and imports **no provider**. The tool never knows which server it talks to.
  - **One canonical value, one projection** (`index.ts:154-200`): the tool's `value` is the seam's
    closed union verbatim (zero-based ranges, every location), while the *rendered text* is one-based
    and workspace-relative. The caps affect **only the presentation** — a test pins that the
    canonical value keeps all locations when the render is capped.
  - **The timeout is attached to the definition, never to the model** (`index.ts:36-43`, `213`):
    `timeoutMs` is enforced by `dsh-tool-call-timeout-policy`; it is "not model-configurable" and is
    absent from the schema.
  - **No workspace fallback** (`index.ts:216-221`): `exec.agent === undefined` → `LspError(...,
    'LSP_WORKSPACE_REQUIRED')` before any query.
  - **The prompt tells the model when *not* to use the tool** (`index.ts:49`): "Use search/read for
    ordinary navigation." — a precision aid, not a default.
  - **The output schema is a `oneOf` with `const` discriminators and `additionalProperties:
    false`** (`index.ts:76-152`), so the model-visible contract is the same closed union the seam
    has.
- **Edge cases & failure handling:** config validated at load (`assertPositiveInteger`,
  `assertTimer`); `assertNever` guards both exhaustive switches; a `null` hover is preserved as an
  explicit `null` value rather than coerced to an error; an optional hover range is omitted rather
  than defaulted.
- **Surprising:** `presentCall` renders a **generic search card**, not a bespoke LSP card — a
  deliberately cheap UI surface, with the operation and one-based cursor carried in the title.

### `packages/lsp/tool-lsp/src/render.ts`
- **Purpose:** pure formatting and coordinate conversion — the whole presentation layer of the tool.
- **Key abstractions:** `LSP_OPERATIONS`, `DEFAULT_MAX_LOCATIONS` (100),
  `DEFAULT_MAX_RESULT_CHARS` (16 000), `LspToolInput`, `LspToolArgs`, `parseLspArgs()`,
  `formatLocations()`, `formatHover()`, `boundResult()`, `renderUri()`, `filePath()`,
  `presentLspCall()`.
- **Data flow:** raw model args → `parseLspArgs` (validate + one-based→zero-based) → seam result →
  `formatLocations`/`formatHover` → `boundResult` (count cap) → text.
- **Non-obvious design decisions:**
  - **URI resolution happens in the *execution world's* path rules, never the host's**
    (`render.ts:139-172`). A `file:` URI carries no OS, so a leading `/C:` segment is read as a
    Windows drive (`drivePath = /^\/[a-z](?::|%3A)/iu`); the workspace and the target are then
    relativized with `win32` or `posix` accordingly. A Windows-world URI on a POSIX host renders
    correctly.
  - **A target in a different world is never relativized** (`render.ts:165`): `if
    (windowsWorld !== targetWindowsWorld) return targetPath`.
  - **Malformed URIs stay verbatim** (`render.ts:155-158`, `174-183`): bad escapes, encoded
    separators, and NUL bytes are all refused by `fileURLToPath` and returned unchanged.
  - **The truncation marker counts *inside* the cap** (`render.ts:127-133`): the text is sliced to
    `maxChars - notice.length` and the notice appended, so the result is exactly the cap, never
    cap-plus-notice.
  - **Two-level capping** (`render.ts:97-120`): `maxLocations` bounds the *item count* first (with
    a singular/plural omission marker), then `maxResultChars` bounds the complete text.
  - **The presenter depends only on the tool arguments** (`render.ts:5-7`): "a UI may call the
    presenter on live streaming and on replay" — so a pending call can be drawn before any server
    round trip.
- **Edge cases & failure handling:** empty locations → the distinct line `No results.`; a null
  hover → `No hover information.`; a cap smaller than the notice → the notice alone, sliced to the
  cap; a non-positive or non-integer coordinate → a named error (`line must be a positive integer
  (one-based)`); a blank `file_path` → rejected; an unknown operation → rejected with the allowed
  set.
- **Surprising:** `..generated` is treated as an **in-workspace** directory — only a real `..`
  segment counts as an escape (pinned by a test).

### `packages/mcp/mcp-client/src/index.ts`
- **Purpose:** the MCP client bridge plugin — connect one external MCP server, register its tools
  on `ctx.tools` under server-qualified public names.
- **Key abstractions:** `apply(ctx, config)`, `Config` (`StdioConfig | StreamableHttpConfig`),
  `SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/`, `activeServerNames` (a `WeakMap<object, Set<string>>`
  keyed by registration scope), `Reconnect` (schemastery).
- **Data flow:** `apply` → `resolveReconnectPolicy(config.reconnect, ...)` (fails loud at load) →
  `ctx.effect` reserves `serverName` in the current scope → `startConnection(ctx, config, reconnect)`
  → `registerServerContext(ctx, serverName, connection)` → register a dispose effect → `await
  connection.ready` → throw if `failOnStartupError` and the attempt failed.
- **Non-obvious design decisions:**
  - **The `serverName` reservation is scope-aware** (`index.ts:52-57`): a `WeakMap` keyed by
    `scopeOf(ctx) ?? ctx.root`. Two *independent Agent scopes* may reuse the same name; a duplicate
    inside one scope fails at load with an actionable message, and the earlier instance stays
    intact.
  - **`apply` is deliberately `async`** (`index.ts:169-176`): "Cordis treats a prototype-bearing
    ordinary function as a constructor, whose returned Promise is not startup work."
  - **The plugin blocks activation on the initial connection + discovery** (`index.ts:203-215`):
    "so Cordis consumers observe the tools immediately after the fiber activates."
  - **An unload observer closes the transport to interrupt pending startup requests**
    (`index.ts:196-203`): "Cordis announces unload before awaiting an unfinished apply()."
  - **The reconnect policy is re-resolved outside schemastery** (`index.ts:183-187`): "Programmatic
    construction may bypass Schemastery normalization, so every default and bound is re-judged
    here — misconfiguration fails the plugin instance at load."
- **Edge cases & failure handling:** the config union validates `serverName` (pattern + length),
  the `reconnect` block, the timeout and the instruction cap; `failOnStartupError: false` (the
  default) logs and enters the reconnect loop instead of rejecting the fiber; with
  `failOnStartupError: true` the fiber rejects and Cordis rolls it back, but the client is still
  closed.
- **Surprising:** the same `serverName` on a *different root* is fine — the reservation is per
  scope object, not global.

### `packages/mcp/mcp-client/src/connection.ts`
- **Purpose:** the connection supervisor — MCP client/transport generations, tool-registry sync,
  and bounded exponential-backoff reconnection.
- **Key abstractions:** `startConnection()`, `resolveReconnectPolicy()`, `ReconnectConfig`,
  `RECONNECT_DEFAULTS` (frozen: enabled/500 ms/30 000 ms/10 attempts),
  `DEFAULT_MAX_INSTRUCTION_BYTES` (32 768), `GENERATION_CLOSE_TIMEOUT_MS` (5 000),
  `ConnectionHandle` (`ready` + `dispose()` + `ServerContext`), `ConnectionOutcome`.
- **Data flow:** `startConnection` → create the supervisor closure → `settling = connectGeneration(true)`
  → `ready` resolves with `{}` on success or `{error}` on failure. `connectGeneration` creates a
  fresh `Client` (the SDK binds a Protocol to one transport for life) → `createTransport(config)` →
  `connect` → read server instructions → byte-cap check → `enqueueSync(generation, opts)` (fetch
  tools + swap the generation). On close: `generationDown` → `scheduleReconnect`.
- **Non-obvious design decisions:**
  - **One outage = one attempt budget** (`connection.ts:186-250`): `failedAttempts` increments per
    consecutive failure; a connection that stayed up past the stability window
    (`maxDelayMs`) resets the budget; exhaustion unregisters the tools and stops — "disposal
    (including HMR) is the only way back from that state".
  - **A crash loop with briefly successful connects still exhausts the cap** — the stability window
    is what makes a successful connect not launder the budget (pinned by a test).
  - **Every sync is serialized through one chain** (`connection.ts:172-181`): "so two syncs can
    never interleave their dispose-previous/register-next swap (which would double-dispose one
    generation and leak another)". The chain tail survives a failed sync; the enqueuing caller owns
    reporting.
  - **A generation may act only while it is the current one** (`connection.ts:186-188`): the
    `isCurrent` guard makes racing close/error signals idempotent, and a stale generation's
    notification handler is ignored.
  - **The reconnect timer is `unref()`'d** (`connection.ts:232-235`): "An armed reconnect timer must
    never hold the process open on its own."
  - **A failed generation that cannot confirm transport closure stops the retry loop**
    (`connection.ts:190-201`): "reconnect stopped to avoid overlapping server processes; reload the
    plugin or restart the Host to retry" — fail-closed rather than leaking children.
  - **Instructions are byte-capped *including* the attribution header**
    (`connection.ts:290-296`): `### MCP server: <name>\n\n<text>` is measured, and an oversized
    value rejects the connection.
  - **Disposal quiesces, it does not merely request** (`connection.ts:334-345`): clear the timer,
    close the transport, `await settling`, `await syncChain`, then unregister the current
    generation.
  - **A server without the `tools` capability connects with an empty tool set** — no request is
    made at all (`tools.ts:112-115`).
- **Edge cases & failure handling:** `resolveReconnectPolicy` rejects unknown keys, non-finite or
  out-of-range delays, `initialDelayMs > maxDelayMs`, and a non-positive-integer `maxAttempts`.
  The `ready` promise reports the *real* first error; a server that crashes *after* a successful
  initial sync cannot flip the outcome because `settling.then()` is a microtask while stdio
  `onclose` is a macrotask (`connection.ts:318-327`).
- **Surprising:** `GENERATION_CLOSE_TIMEOUT_MS` is 5 000 because the SDK's stdio transport owns
  *two* 2-second termination grace periods — "Keep one additional second for the process-close
  event that proves the old generation is gone; timing out fails closed instead of overlapping
  children."

### `packages/mcp/mcp-client/src/tools.ts`
- **Purpose:** the tool bridge — discovery, deterministic server-qualified naming, atomic
  generation swap, execution, and durable image projection.
- **Key abstractions:** `publicToolName()`, `syncTools()`, `createMcpToolDefinition()`,
  `ToolBridgeOptions`, `ToolDisposers`, `McpResult`, `McpToolDefinitionOptions`,
  `PreparedProjection`, `MAX_PUBLIC_NAME_LENGTH` (64), `INVALID_NAME_CHARS`, `HASH_LENGTH` (12),
  `IMAGE_MEDIA_TYPES`, `CANONICAL_BASE64`, `extractText()`, `projectContent()`, `decodeImage()`,
  `resolveImageAdmission()`.
- **Data flow:** `syncTools` phase 1: `client.listTools(undefined, {cacheMode: 'refresh'})` → for
  each tool compute `publicToolName(serverName, tool.name)` → `createMcpToolDefinition(ctx, {...})`.
  Phase 2: dispose the previous generation, then `ctx.tools.register(definition)` for each.
  Execution: `options.call(argsObj, exec)` → `specTypeSchemas.CallToolResult['~standard'].validate`
  → `isError` ⇒ throw → canonical `{content, structuredContent?}` → if the content holds an image,
  prepare an image projection keyed by the exact `ToolExecution`.
- **Non-obvious design decisions:**
  - **The public name is a pure function of `(serverName, rawName)`** (`tools.ts:83-101`): the
    clean case is `mcp__<server>__<raw>`; when character replacement or truncation to the 64-char
    function-name contract changes it, a **12-hex-char SHA-256 of the identity** is appended "so
    distinct MCP identities never collapse into the same public name".
  - **The raw name is the only wire name** (`tools.ts:8-11`): "`tools/call` always receives the raw
    name; the public name is never sent to the server and never parsed to recover the raw name."
  - **Full generation or none** (`tools.ts:117-155`): a fetch failure keeps the previous
    generation; a registration conflict rolls back the *entire* attempted generation ("you never
    get a partial tool set from that server").
  - **A server listing the same tool twice is an invalid tool list** (`tools.ts:117-124`), not a
    silent last-wins.
  - **`projectContent` installs the prepared content before `tools/post-execute`**
    (`tools.ts:214-222`): it also *verifies* the result has not been changed —
    `isDeepStrictEqual(result.value, projection.value)` and
    `isDeepStrictEqual(result.content, projection.fallback)` — so a policy that replaced the value
    or the content keeps its authority.
  - **Images are admitted only after exact capability proof** (`tools.ts:327-352`): the *active
    route* is resolved from the request header, then the agent options, then `llm.resolveModelInfo`
    must declare `image` in `inputModalities`, and the call must not be cancelled.
  - **The image batch is atomic** (`tools.ts:356-420`): one invalid member rejects the *whole*
    batch and every image is projected as a diagnostic string. Base64 must be canonical (a
    round-trip re-encode check rejects aliases).
  - **The canonical value keeps the raw MCP JSON** (`tools.ts:236-240`): base64 stays in the
    execution-local value and is never copied into a session event; the provider reads verified
    bytes from the attachment store.
  - **Non-object arguments are coerced to `{}`** (`tools.ts:224-227`): "Fallback to {} lets the MCP
    server produce a specific 'missing required param' error the model can learn from."
- **Edge cases & failure handling:** an unsupported advertised output schema falls back to
  `JsonValue` (`supportedOutputSchema`, `tools.ts:169-176`) — the structured content is then *not*
  schema-validated; a *supported* schema is enforced by the ToolRuntime (`INVALID_TOOL_OUTPUT`).
  A `taskSupport: 'required'` tool throws at call time ("this bridge does not support").
  Audio, embedded resources, unknown block types, a resource link missing its name/URI, and a
  missing text field each get their own bounded diagnostic string — and every diagnostic says
  "raw … data remains available to programmatic callers" so nothing is silently discarded.
- **Surprising:** `syncTools` always passes `{cacheMode: 'refresh'}` — the SDK's own tool-list cache
  is deliberately bypassed so a re-sync is authoritative.

### `packages/mcp/mcp-client/src/server-context.ts`
- **Purpose:** publish connection-owned MCP resources and literal server instructions.
- **Key abstractions:** `ServerContext` (`resources`, `instructions()`), `registerServerContext()`.
- **Data flow:** `ctx.inject(['mcpResources'], inner => inner.mcpResources.register(server,
  connection.resources))` and `ctx.inject(['systemPrompt'], inner => inner.systemPrompt.section({
  name: `mcp:${server}`, order: getSectionOrder('MCP_SERVERS'), interpolate: false, text: () =>
  connection.instructions() }))`.
- **Non-obvious design decisions:**
  - **`interpolate: false`** (`server-context.ts:35`): the server's instruction text is inserted
    literally, so braces in a server's own text are never treated as template holes. The fixture
    server proves it: "keep {{braces}} literal".
  - **The prompt section is a *function*, not a string** (`text: () => connection.instructions()`),
    so the text follows the live connection generation and is withdrawn on disposal.
  - **Both consumers are optional peer dependencies** — the client works without either.
- **Edge cases & failure handling:** absent or blank instructions contribute no prompt text; a
  replacement connection publishes its instructions only after discovery succeeds.
- **Surprising:** the resource provider and the prompt section are registered through *two separate
  `ctx.inject` calls*, so each is enabled only if that service is present in the composition.

### `packages/mcp/mcp-client/src/transport.ts`
- **Purpose:** the transport factory — stdio spawn with a scrubbed environment, or Streamable HTTP.
- **Key abstractions:** `createTransport(config)`, `buildChildEnv(extra)`.
- **Data flow:** `config.transport === 'stdio'` → `new StdioClientTransport({command, args, env:
  buildChildEnv(config.env), cwd})`; `'streamable-http'` → `new StreamableHTTPClientTransport(new
  URL(config.url), {requestInit: {headers: config.headers}})`.
- **Non-obvious design decisions:**
  - **The scrub definition is shared, not the spawn path** (`transport.ts:10-16`): "The MCP SDK
    owns the actual spawn, so this transport shares the scrub definition rather than the spawn
    path." The ambient env is `scrubbedParentEnv()` (credential-shaped names and stale `DSH_*` names
    dropped) and the configured `env` merges *on top*, so explicit overrides survive.
- **Edge cases & failure handling:** none locally — the SDK owns spawn/connect failures, and the
  supervisor classifies them.
- **Surprising:** `buildChildEnv` is the *only* place credentials are filtered in the MCP path, and
  it is a one-liner that reuses another package's scrub — the credential policy is defined once.

### `packages/mcp/mcp-resources/src/index.ts`
- **Purpose:** scoped MCP resource providers plus the three shared model-facing resource tools.
- **Key abstractions:** `McpResourceRuntime` (Service, key `mcpResources`), `McpResourceRequest`
  (closed union), `McpResourceProvider`, `ResourceLayer` (a `ScopeLayer`), `register()`,
  `registerTools()`, `request()`.
- **Data flow:** `register(server, provider)` → an `ctx.effect` generator inserts the server into
  the scope's `NamedEntries`; if it is the *first* provider in that layer, the shared tools are
  registered for that scope → a tool call resolves the server in the *calling agent's scope*
  (`layers.merge(exec.agent, layer => layer.servers).get(server)`) and dispatches.
- **Non-obvious design decisions:**
  - **The shared tools are owned by the service, not by the first provider's plugin**
    (`index.ts:100-114`): "The resource service owns the shared tool effects independently of the
    first provider's plugin, so unloading that provider cannot remove tools needed by another
    server."
  - **First provider registers, last provider removes** (`index.ts:88-99`): the tools appear while
    the scope has providers and disappear when the last one goes — and the removal is *synchronous*
    so a stale tool cannot be observed after unload.
  - **A duplicate server name inside one scope throws** (`index.ts:33-34`):
    `MCP resource server "<name>" is already registered in this scope`.
  - **The prompt lists only the *caller-visible* names, sorted** (`index.ts:56-64`): the same
    scoped registry drives both tool availability and the prompt, and an empty registry contributes
    no section.
  - **The server name is interpolated into the prompt as JSON, not as prose**
    (`JSON.stringify(names)`), so a name containing `{{braces}}` is inert.
- **Edge cases & failure handling:** a missing `server` argument or an unavailable server fails
  **before** dispatch (`index.ts:126-129`); a partial shared-tool registration is rolled back
  (`index.ts:85-93`); a provider whose requests fail keeps the tools registered ("Connection
  failures do not remove the shared tools while the client entry remains active").
- **Surprising:** the tools are registered in a scope derived from the *service's own* context
  (`selfCtx`), not the registering plugin's context — which is what makes them outlive one
  provider and disappear only with the last one.

### `packages/mcp/mcp-resources/src/tools.ts`
- **Purpose:** the three shared tools that adapt model arguments to scoped resource operations.
- **Key abstractions:** `registerResourceTools(ctx, request)`, `listParameters`, `output`
  (schema + render), `RequestResource`.
- **Data flow:** three `ctx.tools.register(defineTool({...}))` calls inside one `ctx.effect`
  generator — `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` — each
  forwarding `{server, ...request}` to the caller's `request` function with the `ToolExecution`.
- **Non-obvious design decisions:**
  - **One shared parameter schema and one shared output for all three tools** (`tools.ts:17-27`):
    the output schema is `{type: 'json'}` and the render is
    `renderResourceResult(args.server, value)` — the server name is the *argument*, so the
    attribution is always correct even when the tool is called with a different server than the
    one that owns the scope.
  - **The cursor is optional and forwarded verbatim** (`tools.ts:47-49`): absent → the SDK
    collects the pages; present → that page only. There is no local pagination logic.
- **Edge cases & failure handling:** the effect disposer removes all three tools synchronously.
- **Surprising:** the three tools are *not* per-server tools — they are one set shared by every
  configured server, with the server chosen per call.

### `packages/mcp/mcp-resources/src/render.ts`
- **Purpose:** the resource-result projection that keeps binary payloads out of model history.
- **Key abstractions:** `renderResourceResult(server, value)`.
- **Data flow:** `JSON.stringify(value, replacer)` where a `blob` field with a string value is
  replaced by `[binary resource: <length> base64 characters; available to programmatic callers]`
  → one text block prefixed with `MCP server: <server>\n`.
- **Non-obvious design decisions:**
  - **Only `blob` is replaced** — URI, MIME type and text fields stay in the rendered JSON, so the
    model still sees the *shape* of the resource.
  - **The canonical value is untouched** — the base64 bytes remain in the tool's `value` for
    programmatic callers; only the *projection* is reduced.
- **Edge cases & failure handling:** the replacer is applied at stringify time, so a `blob` nested
  anywhere in the result is caught.
- **Surprising:** the replacement text states the *length* of the base64 ("8 base64 characters"),
  which is a small, cheap signal of how much binary was there.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/lsp/README.md` | Group map for the `lsp` family: the three packages, their `ctx` keys, and the rule that **providers register capabilities, not tools** — `tool-lsp` is the only owner of the model-facing name/schema/prompt/presentation. |
| `packages/lsp/README.zh.md` | Chinese mirror of the group map; same decisions, same structure. |
| `packages/lsp/README.i18n.yaml` | Generated bilingual-pair hash record: per heading section, a hash of the English and Chinese blocks outside code blocks; regenerated by `pnpm run verify-translation-pairing --write`. |
| `packages/lsp/lsp-stdio/README.md` | The provider's contract doc: the 12-field config table with defaults, the query lifecycle (read → `didOpen` → request → `didClose`), the observable failure modes (`LSP_UNSUPPORTED_OPERATION`, `LSP_MALFORMED_RESPONSE`), the security boundary, a 7-bullet design philosophy, a source map, and 4 known limitations (no confinement, transient-open compatibility floor, serialization latency, orphaned servers after SIGKILL). |
| `packages/lsp/lsp-stdio/README.zh.md` | Chinese mirror of the provider contract. |
| `packages/lsp/lsp-stdio/README.i18n.yaml` | Generated bilingual-pair hash record for the lsp-stdio README. |
| `packages/lsp/lsp-stdio/package.json` | Manifest: `exports` map with `"./src/*"` passthrough (tests import source directly); peer deps on `dsh-fs`/`dsh-subprocess`/`dsh-lsp`/`dsh-timeout`; dev deps include the real `typescript-language-server` for the e2e. |
| `packages/lsp/lsp-stdio/tests/built-lib.e2e.ts` | Keyless **built-artifact** smoke: plain Node imports the packages *by name* through their exports maps, spawns the fixture, runs one query over real `Content-Length` framing in `lib/index.js`, and disposes. Skips when `lib/` is absent; CI runs it after the build. |
| `packages/lsp/lsp-stdio/tests/connection.spec.ts` | Pins `LspConnection`: init round-trip; explicit `DSH_*` env reaches the child while the ambient namespace is scrubbed; error responses reject; `workspace/configuration` answered from static config; server notifications dropped; `applyEdit` rejection keeps the connection healthy; framing error kills the process; requests after close reject; stderr tail capped (including *by bytes* for multibyte UTF-8 — `'😀'` at a 4-byte cap); unknown ids and non-object frames ignored. |
| `packages/lsp/lsp-stdio/tests/fixture-server.ts` | One scriptable fake LSP server driving ~20 scenarios from env vars (`LSP_FAKE_ENCODING`, `_SYNC`, `_CAPS`, `_DEF/_REFS/_IMPL/_HOVER`, `_HANG`, `_CRASH_ON_OPEN`, `_EXIT_AFTER_REPLY`, `_NO_SHUTDOWN`, `_ON_OPEN`, `_ERROR`, `_GARBAGE`, marker files). Speaks the real base protocol. |
| `packages/lsp/lsp-stdio/tests/framing.spec.ts` | Pins `encodeMessage`/`MessageDecoder`: utf-8 byte length in the header, multiple messages per chunk, split reassembly, header split from body, case-insensitive header + ignored extras, over-size body, missing/non-numeric header, unterminated and oversized header blocks, non-JSON body. |
| `packages/lsp/lsp-stdio/tests/host.spec.ts` | Pins `canonicalizeWorkspace`/`readHostSource`: realpath of a symlinked workspace (aliases share identity), missing/non-directory workspace, provider-failure wrapping, cancellation normalization, relative/absolute reads, symlink-inside allowed, symlink-escape and absolute-outside rejected, non-regular file rejected, FIFO rejection (skipped on Windows), pre-abort honoured, oversized source reports the observed byte count, multibyte boundary counted in bytes, non-UTF-8 rejected, and a literal U+FFFD accepted (only malformed sequences are rejected). |
| `packages/lsp/lsp-stdio/tests/instance.spec.ts` | Pins `LspInstance`: server-request answers (configuration/lifecycle/applyEdit/unknown) all keep serving; `includeDeclaration` for references; pre-abort rejection; mid-flight cancel; **kill escalation when the server ignores `$/cancelRequest` past the grace** (instance becomes `dead`) vs **no kill when the server honors it**; abort observed during a slow handshake; abort during a backpressured `didOpen` write; stdin failure during `didOpen`; teardown finished before a request-write failure is reported; unsupported capability; a server error response is *not* treated as an abort; a `didClose` write failure keeps the settled result but marks the instance dead; graceful exit ordering (`EXIT` then `CLEAN`); idempotent dispose; query after disposal → `LSP_DISPOSED`; SIGKILL escalation; a surviving managed-range helper is awaited; a non-`Error` abort reason is coerced. |
| `packages/lsp/lsp-stdio/tests/lifecycle.spec.ts` | The end-to-end seam spec: extension → independent server routing; definition/implementation/references/hover normalization; empty results are successes; non-utf-16 encoding rejected **without retrying**; a poisoned (utf-8) instance is never pooled; query failure + disposal failure become a 2-error `AggregateError` and the instance is evicted; a `didClose` failure after a settled query still evicts; no transient-open sync rejected; openClose options accepted; unsupported operation; out-of-workspace source rejected before startup; three concurrent queries serialize **in order**; a queued query reads the source only when its lifecycle starts (proved with a didOpen marker file showing the rewritten bytes); abort mid-flight and pre-abort; the server's stderr tail appears in the exit error; a timeout deadline is classified as the abort reason; crash-on-open fails the query but the next query gets a fresh process; an idle-dead pooled server is evicted and replaced; abort during source read spawns no server; disposal aborts and awaits a workspace lookup and a queued source stream; teardown aggregates instance failures; plugin teardown waits for every provider; distinct workspaces run in parallel; a server ignoring `shutdown` is still disposed cleanly; a missing command fails at load. |
| `packages/lsp/lsp-stdio/tests/provider.spec.ts` | Pins plugin-level config: bare command resolved on the child PATH; empty PATH segments skipped; a query after disposal → `LSP_UNAVAILABLE`; non-positive teardown budget / byte cap rejected at load; timers above `MAX_TIMER_DELAY_MS` rejected; a non-executable absolute path and an executable directory rejected (Windows X_OK caveat noted); empty server table and empty server id rejected; **every executable resolved before any provider is published**; aborted sibling lookups are awaited before setup rejects; disposal during setup aborts the lookup; a later registration conflict rolls back the earlier one. |
| `packages/lsp/lsp-stdio/tests/translate.spec.ts` | Pins the pure translation layer: operation→method mapping; capability slot reading in both boolean and options forms; transient-open rules for the enum and options forms (an options form without explicit `openClose` is rejected); utf-16 negotiation; `null` vs `undefined` locations; `Location`, `Location[]`, `LocationLink` mapping; malformed entries; negative/fractional coordinates; every hover encoding (MarkupContent, bare string, language-tagged → fenced code, array joined with one blank line), empty contents → `null`, malformed range rejected rather than dropped. |
| `packages/lsp/lsp-stdio/tests/typescript-server.e2e.ts` | The **real** `typescript-language-server` e2e: builds a small TS project, drives all four operations through the full `ctx.lsp` → `dsh-lsp-stdio` stack. Establishes one compatibility floor, not a cross-language claim. |
| `packages/lsp/lsp-stdio/tsconfig.json` | Build config: `rootDir: src`, `outDir: lib/types`; project references to the vendored cordis/schemastery/cosmokit plus `dsh-brand`, `dsh-timeout`, `dsh-llm`, `dsh-fs`, `dsh-lsp`, `dsh-subprocess`. |
| `packages/lsp/lsp/README.md` | The seam's contract: the four operations table, the **provider-neutral** promise ("replacing the backend does not change what the model sees or how it asks"), the failure taxonomy (`LSP_UNAVAILABLE`/`LSP_INVALID_PROVIDER`/`LSP_CONFLICT`/`LSP_DISPOSED`), 5 design-philosophy bullets, and the known limits (exclusive extension ownership, four read-only operations only, **no observation API**). |
| `packages/lsp/lsp/README.zh.md` | Chinese mirror of the seam contract. |
| `packages/lsp/lsp/README.i18n.yaml` | Generated bilingual-pair hash record for the lsp seam README. |
| `packages/lsp/lsp/package.json` | Package manifest: `ctx.lsp` service package, peer deps on `cordis`/`dsh-brand`/`dsh-llm`, no runtime dependencies. |
| `packages/lsp/lsp/tests/lsp.spec.ts` | Pins the seam: `finalExtension` (case folding, `.d.ts`, Windows separators, dotfiles); registration routing; extension-key normalization (`TS` → `.ts`); every `LSP_INVALID_PROVIDER`/`LSP_CONFLICT` case; **atomic reservation** (a conflicting later extension publishes nothing, `.py` is not reserved); all reservations released together on dispose; order-independent selection; the abort signal forwarded verbatim; `LSP_UNAVAILABLE` when no provider handles the extension; **fiber-scoped disposal (HMR safety)**; `LspError.code`; the brand factory. |
| `packages/lsp/lsp/tsconfig.json` | Build config for the seam; references the vendored cordis/cosmokit plus `dsh-brand` and `dsh-llm`. |
| `packages/lsp/tool-lsp/README.md` | The model-facing contract: the four operations, the one-based cursor convention, the three config keys, the prompt text *verbatim*, and a per-surface "Model Experience" section (what the model sees / token effect / KV-cache effect) for the prompt, the schema, the results, and the UI presentation. |
| `packages/lsp/tool-lsp/README.zh.md` | Chinese mirror of the tool contract. |
| `packages/lsp/tool-lsp/README.i18n.yaml` | Generated bilingual-pair hash record; head read, structure confirmed. |
| `packages/lsp/tool-lsp/package.json` | Manifest: peer deps on `dsh-tools`/`dsh-system-prompt`/`dsh-lsp`/`dsh-timeout`/`dsh-working-directory`; dev deps include `dsh-tool-call-timeout-policy` and `dsh-agent-loop-testkit`. |
| `packages/lsp/tool-lsp/tests/tool-lsp.spec.ts` | Pins the tool: registration + prompt section, the default and overridden timeout budget, the schema enum's four operations, "no default export" (namespace-plugin shape), load-time config rejection, one-based→zero-based conversion, workspace-relative rendering, **the canonical value keeps every location when the render is capped**, relativization against the provider's `resolvedWorkspaceUri` (not the session cwd) when the cwd is a symlink alias, hover rendering, an optional hover range preserved, a null hover preserved as an explicit value, `LSP_WORKSPACE_REQUIRED` without a session cwd, `LSP_UNAVAILABLE`, `INVALID_ARGS` on a bad operation, signal forwarding, and the `presentCall` card shape. |
| `packages/lsp/tool-lsp/tests/render.spec.ts` | Pins the pure layer: operation/coordinate validation; `renderUri` across POSIX, Windows-on-POSIX, remote `file://server/share` authorities, case-insensitive shares, encoded backslashes as ordinary POSIX characters, `..generated` vs `..`, and every malformed-URI form; `formatLocations` no-result line, one-based grouped output, the count cap with singular/plural markers, and the character cap holding even with a 1 MB URI; `formatHover` no-hover line and cap-inside-the-marker; the `presentLspCall` card. |
| `packages/lsp/tool-lsp/tests/integration.spec.ts` | The in-process integration: tool + seam + real stdio provider + timeout policy. A definition query round-trips to `a.ts:1:1`; a hanging server trips the `TOOL_TIMEOUT` budget. |
| `packages/lsp/tool-lsp/tests/load-path.spec.ts` | Loader export-shape guard: a namespace plugin with `inject` must not `export default apply`, or the Loader's `unwrapExports` would collapse the module and drop `inject` (postmortem 0001). Asserts the namespace survives `unwrapExports` with `name`/`inject`/`apply`/`Config` intact. |
| `packages/lsp/tool-lsp/tsconfig.json` | Build config; references vendored cordis/schemastery plus dsh llm/tools/system-prompt/timeout/working-directory and the lsp seam. |
| `packages/mcp/README.md` | The MCP group map: the client owns each configured connection; `mcp-resources` supplies shared resource tools; "MCP tools and prompt text appear only for callers with a configured server in scope"; "No server is enabled by default". |
| `packages/mcp/README.zh.md` | Chinese mirror of the MCP group map. |
| `packages/mcp/README.i18n.yaml` | Generated bilingual-pair hash record; head read, structure confirmed. |
| `packages/mcp/mcp-client/README.md` | The MCP bridge contract: the `mcp__<server>__<tool>` naming shape, the 12 config fields with defaults (including the whole `reconnect` block), the coexistence rules (duplicate server name fails; a server listing the same tool twice has its list rejected; a conflicting update is rejected entirely — never a partial tool set), the "canonical value vs rendered projection" split, the reconnect backoff (500 ms doubling to 30 s, 10-attempt budget, budget reset after `maxDelayMs` of uptime), the environment-scrubbing rule, the per-surface Model Experience section, and a Dev Note listing five *open* questions. |
| `packages/mcp/mcp-client/README.zh.md` | Chinese mirror of the MCP bridge contract. |
| `packages/mcp/mcp-client/README.i18n.yaml` | Generated bilingual-pair hash record; head read, structure confirmed. |
| `packages/mcp/mcp-client/package.json` | Manifest: peer deps on `dsh-attachment`/`dsh-llm`/`dsh-scope`/`dsh-subprocess`/`dsh-timeout`/`dsh-tools`/`dsh-mcp-resources`/`dsh-system-prompt` (the last two **optional**); runtime dep `@modelcontextprotocol/client` pinned at `2.2.0`; dev deps include the official `server-everything` and `server-filesystem` servers. |
| `packages/mcp/mcp-client/tests/apply.spec.ts` | Pins the plugin lifecycle against a mocked SDK: module exports; the `Config` schema (serverName required/pattern/length, reconnect defaults materialized, partial overrides merged, an invalid reconnect rejected); blank/absent server instructions add no prompt text; connect + sync + notification handler; **plugin loading blocks until initial discovery publishes the tools**; a duplicate `serverName` fails at load and the first instance survives; unload during the initial connection closes the transport and registers no tools; the same name is allowed in two independent scopes and on two different roots; the reservation is released on dispose; a failed connect logs and registers nothing; `failOnStartupError` rejects activation *and* still closes the client; a foreign squatter makes strict startup reject; `list_changed` arriving before `connect` resolves still preserves strict startup; re-sync on notification; a failed re-sync keeps the previous generation; the disposer unregisters the *current* generation; `client.close` failure is handled gracefully; the streamable-http config path; and the `maxInstructionBytes` cap measured on the *attributed* UTF-8 text. |
| `packages/mcp/mcp-client/tests/egress.spec.ts` | Proves the Streamable-HTTP transport honours the environment proxy: with `HTTP_PROXY`/`HTTPS_PROXY` set to a local fake proxy, the request is observed at the proxy (`mcp-probe.invalid` appears in the proxied request). |
| `packages/mcp/mcp-client/tests/fixture-server.ts` | A real MCP stdio server with controlled tools: `add`, `greet`, `fail` (isError), `image` (a real PNG block between two text blocks), `crash` (replies then exits the process after the response flushes), and `admin.reset` — a **dotted name**, legal in MCP and illegal in the function-name contract, exercising the normalize-and-hash path end to end. |
| `packages/mcp/mcp-client/tests/fixtures/negotiation-lifecycle.mjs` | A legacy stdio server with a file barrier around protocol discovery; it records every lifecycle event as JSONL with its pid, and reports whether the *previous* probe process was still alive — the evidence that the probe is reaped before the serving process starts. |
| `packages/mcp/mcp-client/tests/fixtures/pagination-limit-server.ts` | A wire fixture whose `tools/list` always returns a `nextCursor` — a non-terminating discovery pagination, used to prove the SDK's own page limit stops the loop. |
| `packages/mcp/mcp-client/tests/fixtures/pagination-limit.patch.yml` | The overlay row that mounts the pagination-limit fixture as an MCP client entry with `failOnStartupError: true` and reconnect disabled. |
| `packages/mcp/mcp-client/tests/fixtures/resources-server.ts` | A deterministic MCP server with literal instructions containing `{{braces}}`, one text resource, one binary resource, and one templated resource — the inputs for the headless Session snapshots. |
| `packages/mcp/mcp-client/tests/http-fixture.ts` | A keyless stateless Streamable-HTTP MCP fixture on an ephemeral port; it records the observed `authorization` headers and the `ping` calls. |
| `packages/mcp/mcp-client/tests/load-path.spec.ts` | The same Loader export-shape guard as `tool-lsp`, with the full postmortem-0001 explanation ("would read `ctx.tools` without having injected it and throw `cannot get property … without inject` the moment it loads"). |
| `packages/mcp/mcp-client/tests/mcp-client.e2e.ts` | The real-protocol e2e against four servers: the local fixture, the official `server-everything`, the official `server-filesystem` (a real write/read round-trip, asserted on disk independently of the tool result), and an in-process Streamable-HTTP server. Proves: the dotted tool name normalizes to `mcp__fixture__admin_reset_<12 hex>` and still executes; the raw name is never registered; the image tool yields an *ordered* three-block content (text, durable image attachment, text) with the base64 present in the canonical value and **absent** from the projected content; a crash-then-recover proves auto-reconnect by a *post-crash* call round-tripping and the tool list holding exactly one `add`; plugin unload during an outage returns in under 4 s instead of sitting out the 8 s backoff; the filesystem server's effect is asserted on disk; the HTTP path sends the configured `Authorization` header on every request. |
| `packages/mcp/mcp-client/tests/mcp-client.spec.ts` | The big unit spec. `publicToolName`: clean names verbatim, invalid characters replaced with a 12-hex hash, over-long names truncated to exactly 64 with a hash suffix, and two distinct identities that normalize to the same base **not** collapsing. `syncTools`: server-qualified registration, two servers publishing the same raw name side by side, coexistence with a *native* tool of the same raw name, a duplicated raw name rejected, a failed fetch keeping the previous generation, a foreign squatter rolling back the whole generation, the previous generation unregistered before a re-sync, and paginated discovery with a supported vs an unsupported output schema. Execution: the raw name on the wire, the raw name for a normalized public name, newline-joined text blocks, an ordered mixed image result, an explicit image refusal that keeps MCP success, a malformed image batch rejected atomically, unsupported media and base64 aliases rejected atomically, refusal for a route without image input, refusal when the route is missing/unverifiable/cancelled, refusal when storage rejects the batch, an *admission* rejection distinguished from a *storage* rejection, post-execute text shortening keeping the image, dispatch value/renderer replacement beating the prepared projection, post-execute replacement and blocking winning, primitive blocks diagnosed, structured-content validation (`INVALID_TOOL_OUTPUT`), the `JsonValue` fallback for unsupported schemas, `isError` → a throw → an error result, task-required tools rejected at call time, the abort signal forwarded, audio/embedded-resource/unknown-type diagnostics, a resource link's name and URI preserved, and every "no model-visible content" case. Plus `createTransport` for both transports and the env scrub, and the non-object-args fallback. |
| `packages/mcp/mcp-client/tests/negotiation-lifecycle.spec.ts` | Real SDK probe ownership: the probe process is **reaped before** the serving process starts (`starts[1].previousAlive === false`); disposal during a probe starts no serving process; a failed HTTP probe retries without waiting for a Client close event; a failed stdio probe (no spawnable child) retries; and a failed probe whose transport closure cannot be confirmed **stops** the retry loop with the exact "avoid overlapping server processes" error. |
| `packages/mcp/mcp-client/tests/protocol.spec.ts` | Real SDK negotiation, subscription and cancellation: a resource-only server stays connected with no tools; the shared resource tools exist for a tools-only server; explicit list and template cursors are preserved through the SDK (`[undefined, 'opaque-page', undefined, 'opaque-page']`); the modern list-change subscription updates the tool set; and a caller's cancellation reaches the executing tool's `context.mcpReq.signal`. |
| `packages/mcp/mcp-client/tests/reconnect.spec.ts` | The reconnect supervisor spec: instructions withdrawn when disposal interrupts discovery; resource reads rejected while a replacement is negotiating ("server is disconnected"); reconnect after a transport close with a *different* tool list and no duplicate/leaked generation; the failure cap unregistering the tools; giving up behind an in-flight re-sync; a replacement not starting until the failed generation reports it closed; **reconnect stopping when a failed generation never reports closure**; disposal owning a pending connect rejection; disposal overlapping failed-generation cleanup; disposal bounded when the transport never reports closure (with the "server shutdown may be incomplete" error); a transport attaching after disposal starts still being closed; a queued tool refresh discarded; dispose during a 60 s backoff returning promptly; a close after dispose scheduling nothing; reconnect disabled keeping the tools and reporting manual recovery; the uptime past the stability window resetting the budget; **a crash loop with briefly successful connects still exhausting the cap**; a connect rejection racing its own close scheduling exactly one retry per attempt; a transport closing during a resolving connect registering nothing; disposal during an in-flight sync; a re-sync failing because dispose closed the transport staying silent; and a stale notification handler being ignored. Plus the `resolveReconnectPolicy` matrix (unknown keys, out-of-range delays, `initialDelayMs > maxDelayMs`, non-integer attempt caps, and `apply` failing loud). |
| `packages/mcp/mcp-client/tests/server-context.spec.ts` | The prompt and resource provider are published and withdrawn together; instructions are re-read on every assembly; a scoped server's instructions are visible only to the owning scope. |
| `packages/mcp/mcp-client/tests/tool-definition.spec.ts` | The exported adapter: the callback receives the *exact* `ToolExecution` (same object, same signal) and the canonical `{content, structuredContent}` value is preserved; invalid external results (`null`, `{content:[42]}`, `{content:[{type:'image'}]}`) are rejected before any content is exposed. |
| `packages/mcp/mcp-client/tsconfig.json` | Build config; references vendored cordis/schemastery plus dsh llm/tools/scope/subprocess/timeout/http-proxy/system-prompt and the mcp-resources sibling. |
| `packages/mcp/mcp-resources/README.md` | The resource contract: three shared tools that require an explicit server name and read only when called; "A caller with no configured MCP server sees no MCP prompt text or resource tools in native or PTC mode"; the first provider in a scope registers the shared tools and the last removes them; the canonical result keeps the full JSON while the text renderer replaces a string `blob` with a description of its base64 length; a per-surface Model Experience section; and five known limitations (a server without the `resources` capability still appears in the prompt, `tools.restrict()` scope rules, no subscriptions, no binary projection, no cross-server aggregation). |
| `packages/mcp/mcp-resources/README.zh.md` | Chinese mirror of the resource contract. |
| `packages/mcp/mcp-resources/README.i18n.yaml` | Generated bilingual-pair hash record; head read, structure confirmed. |
| `packages/mcp/mcp-resources/locale/en.json` | A two-line locale file: `meta.title = "mcp-resources"`. |
| `packages/mcp/mcp-resources/locale/zh.json` | The Chinese locale file: `meta.title` plus a `meta.description`. |
| `packages/mcp/mcp-resources/package.json` | Manifest: peer deps on `cordis`/`dsh-llm`/`dsh-scope`/`dsh-system-prompt`/`dsh-tools` (`dsh-system-prompt` **optional**); the `locale/*.json` files are exported and published. |
| `packages/mcp/mcp-resources/tests/resources.spec.ts` | The scope spec: with no servers, **every** MCP contribution is absent in both `native` and `ptc` mode (no schemas, no prompt text, `UNKNOWN_TOOL` for each call); the shared tools live until the last provider unloads and a replacement is accepted; scoped tools are shared across independent provider owners in either disposal order; scoped teardown is awaited *before* the provider owner finishes unloading; a scoped server is visible only to its owner and descendants and falls back to inherited providers; PTC declarations and bindings are removed and a previously materialized call is rejected after disposal; a provider whose requests fail **keeps** its tools; a partial shared-tool registration is rolled back; server names are published without requiring server tools or instructions and `{{literal}}` braces survive; only caller-visible names are listed; the whole contribution is withdrawn when the plugin unloads; all three operations route with explicit server/cursor/uri and forward the abort signal; binary bytes stay canonical while text/URI/attribution are projected; and missing parameters and unavailable servers fail before dispatch. |
| `packages/mcp/mcp-resources/tsconfig.json` | Build config; references vendored cordis plus dsh llm/scope/tools/system-prompt/values. |

### Tier 3 — skipped with a reason

None. Every file in the shard was opened and read; the `generated-vendored` classification on the
`README.i18n.yaml` files turned out to be small text files (941–3 866 bytes) that were read in
full rather than merely peeked.

---

## 2. Ideas worth stealing

1. **A capability seam where providers register capabilities and exactly one package owns the
   model-facing surface.** "Providers register capabilities, not tools: `tool-lsp` is the only owner
   of the model-facing name, schema, prompt guidance, and presentation, so swapping a provider never
   changes how the model asks for navigation." (`packages/lsp/README.md:22`,
   `packages/lsp/lsp/README.md:41-46`) — **UNIQUE** to this repo among the three, and the single
   most transferable idea here. August Trading has desk tools, a tool catalogue, a toolForge
   (model-authored tools), and a skill system; a seam that lets each of them *provide* capabilities
   while one module owns every model-facing name and schema would stop the catalogue from drifting.
2. **Canonical value vs capped projection are two different things.** The tool's `value` is the
   complete result; the rendered text is capped; the cap is "presentation only"
   (`packages/lsp/tool-lsp/src/index.ts:154-200`, `packages/lsp/tool-lsp/src/render.ts:97-133`;
   `packages/mcp/mcp-client/src/tools.ts:236-240`). — **CONVERGENT** with August Trading's existing
   split between `Message.toolEvents` and `Message.liveToolEvents`; the reference's addition is the
   *proof* that the canonical value survives the cap.
3. **All-or-nothing generation swap.** A failed fetch keeps the previous generation; a registration
   conflict rolls back the *entire* attempted generation — "you never get a partial tool set from
   that server" (`packages/mcp/mcp-client/src/tools.ts:104-155`,
   `packages/mcp/mcp-client/README.md:74-79`). The LSP seam does the same for provider
   registrations (`packages/lsp/lsp/src/index.ts:99-135`). — **UNIQUE** here; August Trading's skill
   approval, agent roster and rule registration would all benefit from an atomic
   "publish everything or publish nothing" rule.
4. **A reconnect supervisor with one budget per outage and a stability window.** Delays double from
   500 ms to 30 s; ten consecutive failures give up, unregister the tools, and only a reload or a
   restart recovers; a connection that stayed up past the stability window resets the budget; a
   crash loop whose connects briefly succeed *still* exhausts the cap
   (`packages/mcp/mcp-client/src/connection.ts:186-250`,
   `packages/mcp/mcp-client/src/connection.ts:5-14`). — **UNIQUE**; this is the most directly
   stealable reliability pattern in the shard for a scheduled job that keeps producing nothing.
5. **Stable public identity with a hash on lossy normalization.** The model-facing name is a pure
   function of `(serverName, rawName)`; when the 64-char function-name contract forces a change, a
   12-hex SHA-256 of the *identity* is appended so two distinct tools never collapse
   (`packages/mcp/mcp-client/src/tools.ts:83-101`). Session history and permission rules therefore
   survive restarts and HMR. — **UNIQUE**; August Trading's bot ids, agent names and rule ids would
   benefit from the same "public name is a pure function of a stable identity" contract.
6. **Read/validate before you create anything.** The LSP provider resolves, contains and
   byte-bounds the source *inside* the workspace queue and *before* any process is created, so an
   invalid input cannot leave an idle pooled process behind
   (`packages/lsp/lsp-stdio/src/index.ts:238-252`). — **UNIQUE**; the direct analogue for August
   Trading is "validate the trade plan and fetch the candles *before* starting the Monte Carlo
   worker or writing a journal row".
7. **Cancellation with a bounded grace and a kill fallback.** Send `$/cancelRequest`, race the
   pending request against a deadline, and if the peer does not settle, *destroy the connection* so
   the still-active request cannot overlap the next one
   (`packages/lsp/lsp-stdio/src/instance.ts:227-257`). — **UNIQUE**; the same three-step shape
   (ask → grace → destroy) applies to aborting a provider request in August Trading.
8. **A stable error-code taxonomy callers route on, instead of parsing `message`.**
   `LSP_INVALID_PROVIDER`, `LSP_CONFLICT`, `LSP_UNAVAILABLE`, `LSP_DISPOSED`,
   `LSP_UNSUPPORTED_OPERATION`, `LSP_MALFORMED_RESPONSE`
   (`packages/lsp/lsp/src/index.ts:44-48`, `packages/lsp/lsp/README.md:63`). — **CONVERGENT** with
   August Trading's `utils/runStatus.ts` error classifier.
9. **"The raw name is the only wire name."** The normalized public name is never sent to the peer
   and is never parsed to recover the raw one
   (`packages/mcp/mcp-client/src/tools.ts:8-11`, `packages/mcp/mcp-client/src/tools.ts:190-197`).
   — **UNIQUE**; the same rule should govern every August Trading name that is both model-facing
   and stored on disk.
10. **A "Model Experience" section in every package README** — what the model sees, the token
    effect, and the KV-cache effect, per surface (prompt, schema, results, UI)
    (`packages/lsp/tool-lsp/README.md:150-215`,
    `packages/mcp/mcp-client/README.md:196-250`). — **CONVERGENT** with the August Trading
    "canonical single-source modules" discipline; the reference's version adds the *token and
    cache* columns, which August Trading's AGENTS.md does not track.
11. **A load-path guard test that pins the plugin's export shape.**
    `packages/lsp/tool-lsp/tests/load-path.spec.ts`, `packages/mcp/mcp-client/tests/load-path.spec.ts`
    — a namespace plugin with `inject` must not `export default apply`, or the Loader's
    `unwrapExports` drops `inject` and the plugin throws at load. Both packages carry the same
    three-line guard and cite the same postmortem. — **UNIQUE**; a cheap, high-value test class
    (module *shape* bugs are invisible to behavioural tests).
12. **"Generic host, not a catalog."** Deployments configure commands and mappings explicitly;
    "presets belong in `cordis.yml` overlays, not in this package"
    (`packages/lsp/lsp-stdio/README.md:74-75`). — **UNIQUE**; the direct August Trading lesson is
    that a provider preset belongs in a config overlay, never in the shipping package.
13. **Bounded diagnostics instead of unbounded logs.** stderr is a *capped tail* that is "the
    contract", and the tail is folded into the exit error so a crash is diagnosable
    (`packages/lsp/lsp-stdio/src/connection.ts:105-108`, `connection.ts:270-274`). — **UNIQUE**.
14. **A truncation marker that counts inside the cap.** The text is sliced to
    `maxChars - notice.length` and the notice appended, so the result is exactly the cap
    (`packages/lsp/tool-lsp/src/render.ts:127-133`). — **UNIQUE**, and directly applicable to any
    August Trading prompt that truncates tool output.
15. **Distinct "no result" text, not an error and not an empty string.** `No results.` and
    `No hover information.` are two different successful outcomes
    (`packages/lsp/tool-lsp/src/render.ts:98,110`). — **UNIQUE**; the model must be able to tell
    "nothing found" from "something went wrong" without reading prose.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work — not in this shard** (no cron, no TP/SL detection, no
  digest scheduler appears in these 86 files). The closest transferable thing is the MCP reconnect
  supervisor, which is a *recovery* loop with a bounded attempt budget, a doubling backoff, a
  stability-window reset and a fail-closed stop (`packages/mcp/mcp-client/src/connection.ts:186-250`)
  — a better shape than a plain "N failures then disable", because a briefly-successful retry
  cannot launder the budget.
- **Human-in-the-loop approval — not in this shard.** There is no approval record, no audit trail
  and no human gate in these packages. Two *refusals* are the closest: the LSP host rejects
  `workspace/applyEdit` and "never applies edits or runs commands"
  (`packages/lsp/lsp-stdio/src/instance.ts:279-286`), and the MCP bridge rejects a task-required
  tool at call time (`packages/mcp/mcp-client/src/tools.ts:224-227`). August Trading's approval
  inbox lives in a different package, but the *shape* — a peer that asks the harness to act is
  refused, and the refusal is a structured error the model can read — is worth copying.
- **Post-mortem / reflection loops — not in this shard.** No outcomes become rules here. The
  nearest analogue is the *failure ledger* inside the reconnect supervisor: each failed attempt
  produces a distinct, greppable log line with the attempt counter
  (`packages/mcp/mcp-client/src/connection.ts:236-240`), and the "giving up" line is the artifact a
  human reads afterwards.
- **Multi-agent — not in this shard** (no subagent/debate machinery). The relevant idea is
  *scoping*: the same `serverName` may be reused in two independent Agent scopes while a duplicate
  inside one scope fails at load (`packages/mcp/mcp-client/src/index.ts:52-57`), and the MCP
  resource registry gives each Agent its own visible server list
  (`packages/mcp/mcp-resources/src/index.ts:56-64,126-129`). That is the isolation primitive an
  August Trading per-agent desk would need.
- **Structured logs the model can query — not in this shard.** No file-per-record log, no JSONL
  store, no SQLite, no FTS. The two queryable-ish records are the **retained stderr tail** (a
  bounded diagnostic string that is folded into the error the model sees) and the **system-prompt
  section**, which is the harness's own logged, re-assembled record of what the model was told.
- **Staying simple as features accumulate — strongly answered.** Four mechanisms: (1) a closed
  operation union so a new feature is a compile error, not a branch
  (`packages/lsp/lsp/src/types.ts:14-19`); (2) one owner of the model-facing surface
  (`packages/lsp/README.md:22`); (3) explicit "known limitations" sections that say what the
  package will *not* do ("four read-only operations only", "no observation API",
  `packages/lsp/lsp/README.md:110-121`); and (4) a Dev Note that lists *open* questions rather
  than pretending they are settled (`packages/mcp/mcp-client/README.md:252-262`).

---

## 4. Non-obvious decisions and gotchas

- **The seam is provider-neutral, but the *tool* is not.** `ctx.lsp.query` returns a closed union;
  the tool returns that union *verbatim* as its canonical value while rendering a one-based,
  workspace-relative text. Both representations exist simultaneously and a test pins that the
  canonical value is unaffected by the render cap
  (`packages/lsp/tool-lsp/tests/tool-lsp.spec.ts:118-145`).
- **The model-facing coordinate convention is one-based; the seam's is zero-based.** The seam
  speaks the protocol's UTF-16 zero-based positions; the tool accepts one-based model coordinates
  and converts at the boundary (`packages/lsp/tool-lsp/src/render.ts:41-58`). A reader who assumes
  one convention throughout will be off by one.
- **`renderUri` deliberately does NOT use the harness host's path rules.** A `file:` URI does not
  carry its OS, so a `/C:` segment is read as a Windows drive and the relativization uses
  `win32`/`posix` accordingly; a target in a *different* world is never relativized
  (`packages/lsp/tool-lsp/src/render.ts:139-172`). A POSIX host rendering a Windows workspace
  correctly is a deliberate, tested behaviour.
- **`supportsTransientOpen` is stricter than the LSP spec's default.** The options form requires
  an explicit `openClose: true`; the legacy enum `Full`/`Incremental` implies it
  (`packages/lsp/lsp-stdio/src/translate.ts:84-97`). A server that omits `openClose` is treated as
  not supporting open/close.
- **`negotiatePositionEncoding` fails the whole handshake on a non-utf-16 server**, and the
  instance is then destroyed rather than pooled — so every later query for that workspace starts a
  *fresh* process and fails the same way, instead of hanging on a poisoned instance
  (`packages/lsp/lsp-stdio/src/instance.ts:157-168`,
  `packages/lsp/lsp-stdio/tests/lifecycle.spec.ts:150-165`).
- **The LSP provider refuses to mutate.** `workspace/applyEdit` is rejected; lifecycle bookkeeping
  is answered with `null`; anything else is "unsupported server request"
  (`packages/lsp/lsp-stdio/src/instance.ts:265-286`).
- **`initialize.processId: null` means a SIGKILL'd harness orphans language servers.** The client
  PID is withheld so a server in another PID namespace cannot monitor an unrelated process — the
  price is that the servers can no longer watch the client either
  (`packages/lsp/lsp-stdio/src/instance.ts:118-120`,
  `packages/lsp/lsp-stdio/README.md:127`).
- **The MCP tool's public name can become unreadable.** A raw name longer than the budget or
  containing illegal characters is truncated to 51 characters plus `_` plus a 12-hex hash
  (`packages/mcp/mcp-client/src/tools.ts:94-100`) — stable, unique, and no longer recognisable.
- **A lossy output schema silently disables structured-content validation.** `supportedOutputSchema`
  catches the rejection and returns `undefined`, so the tool's schema degrades to `JsonValue` and
  the server's `structuredContent` is *not* validated against its advertised schema
  (`packages/mcp/mcp-client/src/tools.ts:169-176`; the fallback is pinned at
  `packages/mcp/mcp-client/tests/mcp-client.spec.ts:245-260`). The supported case *is* enforced
  (`INVALID_TOOL_OUTPUT`).
- **`syncTools` always re-fetches** (`{cacheMode: 'refresh'}`,
  `packages/mcp/mcp-client/src/tools.ts:112-115`) — the SDK's tool-list cache is bypassed so a
  re-sync is authoritative, at the cost of a round trip on every notification.
- **The MCP resource prompt text is `interpolate: false`.** A server's instructions containing
  `{{braces}}` are inserted literally (`packages/mcp/mcp-client/src/server-context.ts:35`), and the
  resource server list is embedded as `JSON.stringify(names)` for the same reason
  (`packages/mcp/mcp-resources/src/index.ts:60-63`).
- **The MCP resource tools are shared, not per-server, and are owned by the service rather than by
  the first provider.** They appear when a scope's first provider registers and vanish when its
  last one does — and unloading *one* provider cannot remove tools another server still needs
  (`packages/mcp/mcp-resources/src/index.ts:88-114`).
- **Two `load-path.spec.ts` files exist for the same reason.** A namespace plugin with `inject`
  must not `export default apply`; the Loader's `unwrapExports` would collapse the module, drop
  `inject`, and the plugin would throw at load. Both packages carry the guard and cite the same
  postmortem (`packages/lsp/tool-lsp/tests/load-path.spec.ts:1-10`,
  `packages/mcp/mcp-client/tests/load-path.spec.ts:1-13`).
- **A `vi.mock` of the MCP SDK must live in its own file** — `apply.spec.ts` and `reconnect.spec.ts`
  each say so in their header comment ("Isolated file so vi.mock of the MCP SDK doesn't pollute
  other test suites").
- **The stderr tail is capped *by bytes*, not by characters.** `'😀😀'` at a 4-byte cap yields
  exactly `'😀'` (`packages/lsp/lsp-stdio/tests/connection.spec.ts:222-229`).
- **`syncTools` rejects a server that lists the same tool twice** as an invalid tool list — not
  last-wins, not a silent skip (`packages/mcp/mcp-client/src/tools.ts:117-124`).
- **An MCP `isError` result throws *before* image persistence**, so the ToolRuntime records a
  failure and no attachment is written (`packages/mcp/mcp-client/src/tools.ts:231-234`).
- **A failed re-sync keeps the previous tool generation; a failed *registration* rolls the whole
  generation back.** Two different failure modes with two different policies
  (`packages/mcp/mcp-client/src/tools.ts:104-155`).

---

## 5. Weak spots

- **The MCP bridge has no approval gate at all.** Every discovered MCP tool is immediately
  callable by the model, with only a per-call timeout. The LSP side is safe by construction
  (read-only, `applyEdit` refused), but the MCP side is *write-capable by default* and the
  package's own limitations list never says so
  (`packages/mcp/mcp-client/README.md:229-241`). For a harness that lets a model call external
  servers, that is the biggest gap in the shard.
- **The reconnect supervisor is doing too much for one file.** `connection.ts` is 18.7 KB of
  generation lifecycle, backoff, budget, close barriers, instruction byte caps and resource
  dispatch, and `reconnect.spec.ts` is 27 KB of tests for it. The *shape* is good, but the surface
  area is a maintenance liability, and the SDK's own 60-second default leaks into the package
  ("Startup and discovery timeouts are inherited from the MCP SDK", a stated limitation).
- **The `lsp` seam has no observation API.** "Availability is observed only by running `query()`
  and routing the thrown `LspError` codes; there is no provider-change event or
  capability-status query" (`packages/lsp/lsp/README.md:118-121`). A UI cannot show which
  providers are live without probing them.
- **`lsp-stdio` is one-process-per-workspace with no pooling across providers and no limit on
  live instances**; long-lived workspace processes "consume memory until disposal" and a
  SIGKILL leaves them running (`packages/lsp/lsp-stdio/README.md:124-129`).
- **The MCP client's `serverName` uniqueness is per *registration scope*, not per process.** Two
  agents may each have a `github` server, which is what makes agent-scoped isolation work, but it
  also means two servers with the same name can produce the *same* public tool names in different
  scopes — a session that moves between scopes would see a name mean two things.
- **`maxInstructionBytes` measures the *attributed* text**, including the `### MCP server: <name>`
  header the harness itself added (`packages/mcp/mcp-client/src/connection.ts:290-296`). A limit
  expressed in "bytes of server instructions" that actually counts the harness's own header is a
  slightly misleading contract.
- **The bilingual README pairing is enforced only by a hash file and a script.** There is no test
  in this shard that fails when a README's two languages drift; the `README.i18n.yaml` records are
  *generated* artefacts that a stale edit would silently invalidate.
- **The pinned MCP SDK (`2.2.0`) is acknowledged as still moving** and a "breaking upstream
  change requires updating the bridge" (`packages/mcp/mcp-client/README.md:258-262`).
- **`lsp-stdio` has no confinement policy** — it trusts the configured server completely and gives
  it the full filesystem and process authority of the mounted execution world
  (`packages/lsp/lsp-stdio/README.md:106-111`).
