# pi :: pi-codemode-mcp

**Files in shard:** 67 (read: 67, skipped with reason: 0)
**What this shard covers:** two small, sharp, standalone packages that sit *outside* pi's agent loop but decide how much power the agent has. `packages/codemode` is a sandboxed JavaScript runtime: model-written code runs inside a QuickJS/WebAssembly VM whose only capability is calling host-injected tools, so nested tool calls never enter the LLM context — only the script's output and return value do. It ships three interchangeable sandboxes (a Node/Bun worker thread, an inline VM for runtimes without threads, and a remote VM behind an RPC boundary for Cloudflare Durable Objects) over one shared host core, one script prelude, and one result format. `packages/mcp` is a from-scratch Model Context Protocol *client* (no dependency on the official SDK): a transport-neutral JSON-RPC core, a stdio transport, a Streamable-HTTP transport with SSE resumption, and a hand-adapted OAuth subset (PKCE, dynamic client registration, discovery, refresh, step-up scope). Together they answer two questions August Trading keeps asking: *how do you let a model compose tool calls without drowning the context?* and *how do you talk to an external tool server without trusting it?*

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/codemode/src/types.ts`
- **Purpose:** the public type surface of the codemode package — the contract every other file obeys.
- **Key abstractions:** `CodemodeTool` (name, description, `inputSchema`/`outputSchema`, `spread`, `signature`, `execute(args, {signal})`); `CodemodeResult` as a **discriminated union** on `ok` (`:88-107`); `CodemodeErrorKind` = `"script" | "timeout" | "aborted" | "sandbox"` (`:59-71`); `CodemodeOutputItem` (text with optional `console: true`, or image); `CodemodeCall` (`name`, `status: "ok"|"error"|"cancelled"`, `durationMs`); `CodemodeRunOptions`/`CodemodeRun` (`:206-249`) for the deterministic replay API; `CodemodeSandboxBaseOptions` (`:112-139`).
- **Data flow:** types only — but every doc comment here is a *contract sentence* the implementation is measured against ("`output` is kept for failed executions too, up to the failure").
- **Non-obvious design decisions:**
  - **The error kind is a four-way taxonomy, and each kind carries a different promise about the VM.** `timeout` and `aborted` say "the execution ended and the VM was asked to stop" — *asked*, not *stopped*; `sandbox` covers a wasm trap or a missing worker file; `script` covers anything the script itself threw (`:59-71`). A caller can therefore tell "the script failed" from "our sandbox broke" without parsing messages.
  - **`CodemodeJsonSchema` is typed as `{ [key: string]: unknown } | boolean`** — deliberately *not* a JSON Schema library type, because the schemas are only used to **render declarations**; values are never validated against them (`:9`). The doc says so explicitly.
  - **A failed result has no `storeWrites` field at all** — only the success arm of the union carries it (`:96-107`). "Failed executions report no writes" is expressed in the *type*, not in a runtime check.
- **Edge cases & failure handling:** the type documents that a call still running when the script returns is reported as `cancelled`; that `during` is only present on a deterministic `start()` run; that `storeWrites.set`/`delete` partition the changes.
- **Surprising:** `CodemodeTool.spread` and `signature` are *globals-only* fields — a tool that carries them is legal TypeScript but meaningless.

#### `packages/codemode/src/identifier.ts`
- **Purpose:** maps a tool name to the identifier the script uses.
- **Key abstractions:** `toCodemodeIdentifier(name)` — every character that is not valid in a JS identifier becomes `_`.
- **Data flow:** `mcp__docs__search` → unchanged; `my-tool` → `my_tool`.
- **Non-obvious design decisions:** the *first* character uses a stricter rule (`/^[A-Za-z_$]$/`) than the rest (`/^[A-Za-z0-9_$]$/`), and an empty name becomes `"_"` — so the result is always a legal identifier, never an empty string.
- **Edge cases & failure handling:** none needed; the mapping is total.
- **Surprising:** the *original* name stays reachable too — the prelude installs the function under both `tools.my_tool` and `tools["my-tool"]`, so a mangled identifier never loses the tool.

#### `packages/codemode/src/index.ts`
- **Purpose:** the package's main barrel (`"."` export).
- **Key abstractions:** re-exports the declaration renderer, `CodemodeSandboxBase`, `CodemodeSandbox`, `InlineCodemodeSandbox`, the remote pair, the source parser, the four store/output limit constants, and the whole type surface.
- **Data flow:** n/a (barrel).
- **Non-obvious design decisions:** the **limit constants are exported** (`MAX_OUTPUT_CHARS`, `MAX_OUTPUT_ITEMS`, `MAX_STORE_TOTAL_CHARS`, `MAX_STORE_VALUE_CHARS`) so a host can pre-flight against them instead of hard-coding numbers.
- **Edge cases & failure handling:** n/a.
- **Surprising:** `CodemodeSandboxBase` is exported publicly even though it is abstract-ish — it is the *shared API surface* the other two sandboxes implement.

#### `packages/codemode/src/portable.ts`
- **Purpose:** the **Node-free** entry (`"./portable"`), for Cloudflare Workers, Durable Objects and browsers.
- **Key abstractions:** `InlineCodemodeSandbox`, `RemoteCodemodeSandbox`, `serveCodemodeRemote`, `CodemodeSandboxBase`, the protocol types, and `CodemodeWasmModule`.
- **Data flow:** nothing executes here; it is a re-export surface that deliberately **excludes** `node:fs` (the `loadQuickJSWasm` helper) and the worker-thread sandbox.
- **Non-obvious design decisions:** the split is enforced by *file placement*, not by a build flag — `portable.ts` simply never imports `node:*`. The `wasm.ts` module is the one place with Node imports, and only the `loadQuickJSWasm` function touches them; the *type* `CodemodeWasmModule` is portable.
- **Edge cases & failure handling:** n/a.
- **Surprising:** `portable.ts` still exports the *type* `HostToWorkerMessage`/`WorkerToHostMessage` — the wire vocabulary is considered part of the portable contract because the remote side speaks it.

#### `packages/codemode/src/wasm.ts`
- **Purpose:** compiles the QuickJS WebAssembly module once and caches it.
- **Key abstractions:** `loadQuickJSWasm(path?)`; the opaque `CodemodeWasmModule` type; a module-level `Map<string, Promise<CodemodeWasmModule>>` (`:14`).
- **Data flow:** `readFile(path)` → `WebAssembly.compile(bytes)` → cached promise; the default path is resolved through `createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm")`.
- **Non-obvious design decisions:** **a failed load deletes the cache entry** (`:30-33`), so the next call retries instead of serving a permanently rejected promise. The cache is keyed by *path*, so two sandboxes with different wasm files do not collide.
- **Edge cases & failure handling:** `WebAssembly.compile` is used (not `instantiate`), so compilation is off the critical path of `new Worker(...)`; the `WebAssembly` global is reached through a locally declared interface because the Node type definitions do not carry the DOM globals.
- **Surprising:** the type is `object`, not `WebAssembly.Module` — the package refuses to depend on the DOM lib for one type.

#### `packages/codemode/src/source.ts`
- **Purpose:** the codemode **source format** — JavaScript optionally preceded by one `// @options:` line.
- **Key abstractions:** `parseCodemodeSource(input)`; `CodemodeSourceOptions` (`maxOutputTokens`, `timeoutMs`); `CodemodeSourceError`; `CODEMODE_SOURCE_GRAMMAR` (`:22-32`) — a Lark grammar for providers that support grammar-constrained tool input.
- **Data flow:** source text → split on `\n` → the options line is parsed and **replaced by an empty line**, so line numbers in stack traces still match the input → `{ code, options }`.
- **Non-obvious design decisions:**
  - **Exactly two options are supported and any other key is a hard error** (`SUPPORTED_FIELDS`, `:13`): `max_output_tokens` and `timeout_ms`. The sandbox **does not act on them** — the caller decides. The parser is a *contract*, not a policy.
  - **An options line anywhere but the first line is an error, not a silent ignore** (`:106-114`). This was a real bug (#10631): a mid-file options line was ignored, so `timeout_ms` "never applied" — the fix was to *throw*, naming the offending line number.
  - The options line is replaced by an empty line rather than removed, which is what keeps the error's line number equal to the model's line number.
  - `timeout_ms` must be a positive safe integer ≤ 2,147,483,647 (`:16`, `:88-93`); `max_output_tokens` may be 0 but not fractional.
- **Edge cases & failure handling:** empty/whitespace input → `CodemodeSourceError`; invalid JSON → error naming the parser's own message; a JSON array or scalar → "must be a JSON object"; an options line with no code after it → error.
- **Surprising:** the **grammar export exists for a second, unrelated consumer** — providers that can constrain a tool's JSON input to a Lark grammar. The same file is both a parser and a grammar source.

#### `packages/codemode/src/declarations.ts`
- **Purpose:** renders a tool's JSON Schemas into **TypeScript declarations for the model**, so the model sees typed signatures instead of prose.
- **Key abstractions:** `renderDeclarations({tools, globals})`; `renderToolSignature`; `renderToolSample`; `renderToolOutputType`; `schemaToType(schema, {maxChars})`.
- **Data flow:** JSON Schema → `toType()` → a TS type expression; objects render **on one line** (`{ city: string; "max-lines"?: number; }`) unless a property carries a description or an inexpressible constraint, in which case it renders **one property per line** with `//` comment lines above it.
- **Non-obvious design decisions:**
  - **Constraints the type cannot express become JSDoc-ish tags on the property's comment line** — `// @integer @minimum 0 @maximum 30000 @default 0` (`constraintTags`, `:253`). Keywords covered: `integer`, numeric bounds, `multipleOf`, string length, `pattern`, `format`, array length, `uniqueItems`, non-null `default`, `deprecated` (`:14-29`).
  - **The renderer degrades in two steps, not one.** If the tagged rendering exceeds `maxChars`, it is rendered **again without the tags**; only if *that* is still too long does it become `unknown` (`schemaToType`, `:139-145`). `DEFAULT_INPUT_SCHEMA_MAX_CHARS` is 16,000 (`:10`). Losing the constraint tags is preferred over losing the type.
  - **A nullable optional field's constraints are read from its non-null branch** (`:257-269`) — because Pydantic's `int | None = Field(None, ge=1, le=100)` puts the bounds on the branch. When both the property and the branch carry constraints, the **tightest** wins (`@minimum` takes the max, `@maximum` takes the min — `LOWER_BOUNDS`/`UPPER_BOUNDS`, `:22-25`).
  - **Draft-04/OpenAPI-3.0 boolean `exclusiveMinimum`/`exclusiveMaximum` are normalised** into exclusive bounds (`:271-277`).
  - **Local `$ref`s are expanded, recursive and remote ones render as `unknown`**, with a hard cap of 32 expansions (`:12`) so shared definitions cannot blow the output up (`:170-182`).
  - **The comment terminator is escaped** (`*/` → `*\/`, `:117`) so a description cannot close the doc comment early — and line terminators U+2028/U+2029 are escaped inside tags (`:290-291`).
  - Properties are **sorted by name**, so the same schema always renders identically (`:307`).
- **Edge cases & failure handling:** `true` → `unknown`, `false` → `never`; `allOf` parts that are `unknown` are dropped and the rest intersected; `enum`/`const` render as literal unions.
- **Surprising:** the tags are **not** validation — "Schemas only shape the declarations; values are not validated against them" (README). The renderer is a *presentation* layer, and it is careful to say so.

#### `packages/codemode/src/runtime/protocol.ts`
- **Purpose:** the message contract between the host and whatever is running the VM.
- **Key abstractions:** `VmStartData` (code, tool list with `jsName`, globals, memory limit, store snapshot, optional `deterministic` block); `WorkerData` (adds the compiled wasm and a `SharedArrayBuffer` interrupt flag); `WorkerToHostMessage` = `call | output | done | crash | started | idle`; `HostToWorkerMessage` = `result`.
- **Data flow:** tool arguments and results cross **as JSON strings** — "the worker passes them into and out of the QuickJS VM as strings and never builds structured values itself" (`:6-8`).
- **Non-obvious design decisions:**
  - **Everything crossing the boundary is plain data**, so the same `VmStartData` can travel through a `postMessage` *or* a Workers RPC call unchanged (`:11-14`). The remote sandbox reuses this contract verbatim.
  - **The `interrupt` flag is a `SharedArrayBuffer`, not a message.** The VM polls it because Bun's `worker.terminate()` cannot stop a thread spinning in wasm (`:35-39`).
  - **`started` and `idle` exist only for deterministic mode**: `started` carries the VM's fingerprint *before the script runs*, so a replay can refuse a different VM; `idle` carries `(seq, issued)` after each drain.
- **Edge cases & failure handling:** `isWorkerToHostMessage` / `isHostToWorkerMessage` are the only type guards; the host re-validates anything a launcher passes through, so a broken bridge cannot inject a malformed message.
- **Surprising:** `done` carries `writes` (the store's JSON) as a **separate field from `value`** — the script's return value and its store writes are two independent channels, and a failed run reports only the error.

#### `packages/codemode/src/runtime/vm.ts`
- **Purpose:** drives **one** QuickJS VM through **one** script — the single implementation shared by the worker, the inline launcher and the remote server.
- **Key abstractions:** `startVm(options)` → `VmSession {deliver, dispose}`; `StartVmOptions`; `VirtualClock`; `deterministicWasi`; `discardOutput`; `prng` (mulberry32); `fnv1a` (prelude hash).
- **Data flow:** `PRELUDE_SOURCE` is evaluated inside the VM with the bridge function and the JSON-encoded tools/globals/store → the prelude returns `{settle, run, stalled}` → the script is compiled as `(async (tools, console) => { …code… })` → `run(fn)` starts it → `drain()` pumps the promise queue → the bridge posts `call`/`output`/`done` messages out.
- **Non-obvious design decisions:**
  - **The script is wrapped in an async arrow whose *prefix shares line 1 with the script*** (`:344`), so reported line numbers are exact — only column numbers on line 1 are shifted (documented in the README).
  - **The interrupt handler is polled *between* promise jobs, every 50 jobs** (`JOBS_PER_POLL`, `:154`, `:247`). This is not cosmetic: a script like `while (true) await null` executes only a few opcodes per job, so QuickJS's own opcode-counted polling would let it run a long time between polls. The comment at `:24-29` states it exactly.
  - **The deterministic mode fixes five separate sources of nondeterminism**: time (virtual clock reading `startedAt` then the `now` of the result being processed, never backwards), randomness (mulberry32 over the seed), timezone (UTC — `timezoneOffset: 0`), garbage-collection introspection (`WeakRef`/`FinalizationRegistry` removed via `Intrinsics.ALL & ~Intrinsics.WEAK_REF`), and **delivery order** (results carry a `seq` and are applied strictly in that order, buffering early ones — `:198-224`).
  - **The clock is seeded from the seed while the context is being created** (`:116-124`, `:194-195`): QuickJS seeds `Math.random()` from the *first* clock read, and which read comes first is the engine's business, so the first read is made deterministic on purpose.
  - **The fingerprint is a string of the facts that matter for replay**: engine versions, prelude hash, deterministic version, stack size, heap limit, interrupt budget (`:319`). A replay against a different fingerprint is a different run, and the host can see it.
  - **`DETERMINISTIC_VERSION` is a manual bump** (`:69`) — "Bumped whenever this module or the prelude changes what a deterministic script observes". It is the *only* thing that makes a prelude change replay-incompatible.
  - **QuickJS's stdout/stderr writes are discarded** (`discardOutput`, `:143-155`) because that output belongs to the host application, and libc would retry a short write.
- **Edge cases & failure handling:** a parse failure in the script is posted as `done{ok:false}` with a QuickJS stack, not as a crash (`:339-343`); anything else after the VM exists becomes a `crash` message; `startVm` only *rejects* if the VM cannot be created at all.
- **Surprising:** **`vm._getExports()`** is used to run promise jobs one at a time (`qjs_is_job_pending` / `qjs_execute_pending_job`) because the public `executePendingJobs()` drains the queue with no interrupt opportunity in between. The comment at `:236-239` notes quickjs-wasi is pinned to an exact version so this internal-but-public API is stable.

#### `packages/codemode/src/runtime/execution.ts`
- **Purpose:** the **host side** of an execution, shared by every sandbox. Owns everything the script must not influence.
- **Key abstractions:** `CodemodeSandboxBase` (tool table, defaults, in-flight set); `Execution` (one run); `VmLauncher` (chooses *where* the VM runs); `VmChannel` (`post`/`stop`); `VmEvents` (`message`/`failure`); `checkGlobals`.
- **Data flow:** `execute(code, {signal, timeoutMs, store})` → serialize the store → build `VmStartData` → launch → the VM posts `call` → the host runs the tool → the host posts `result` → the VM posts `done` → `finish()` builds the `CodemodeResult` and resolves it.
- **Non-obvious design decisions:**
  - **The first terminal event wins.** `done`, `crash`, a launcher failure, the deadline, or an abort — whichever arrives first decides the result; later events are ignored (`finished` flag, `:410-459`).
  - **`finish()` aborts pending tool calls, clears the timers, removes the abort listener, and *then* resolves** — and it resolves only *after* `channel.stop()` completes (`:445-459`). "The host asked the VM to stop, and the request for that completed, before the caller hears the result."
  - **A tool that was still running when the script ended is reported `cancelled`**, and its `AbortController` is fired so the tool can clean up (`:419-426`). The call record is created with `status: "cancelled"` *at call time* and only upgraded to `ok`/`error` if the call actually finished (`:373-375`, `:396-400`).
  - **`receive()` wraps everything in a try/catch** (`:344-355`): an exception in the host's own decode path would otherwise escape into the launcher's transport and leave the execution **unsettled**. A decode failure becomes `kind: "sandbox"` with the message *"Sandbox bridge broken: … The script may have modified built-ins such as a prototype's toJSON."*
  - **`deliver()` serializes the outcome *before* recording anything** (`:277-292`): a value JSON cannot hold (a `BigInt`) throws and **leaves the call waiting for another answer** rather than half-recording it.
  - **Result numbers must be positive integers used once** (`:264-267`), and `deliver` throws for a reused `seq` or an unknown call id — the deterministic protocol is strict on purpose.
  - **`initialize`-style exceptions do not exist here, but `globals` are validated hard**: a global name must be `identifier` or `namespace.member`, must not shadow a reserved built-in (`tools`, `ALL_TOOLS`, `console`, `text`, `image`, `exit`, `globalThis`, `store`, `load` — `RESERVED_GLOBALS`, `:51-60`), must not duplicate, and must not collide with its own namespace (`checkGlobals`, `:152-171`).
  - **`close()` aborts in-flight executions and rejects new ones** (`:576-580`); `execute()` after `close()` **rejects** (`:494`), while `start()` after `close()` **throws** (`:531`).
- **Edge cases & failure handling:** the default deadline is 300,000 ms (`:49`) and `Infinity` disables it; `timeoutMs` is per-execution and overrides the sandbox default; the abort listener is registered `{ once: true }` and removed in `finish()`; `unsent` holds replies produced before the launcher returned its channel, and they are flushed when it arrives (`:262-266`).
- **Surprising:** **`CodemodeSandboxBase` holds only the tool table and the defaults — it holds no VM.** Each `execute()` gets its own VM; the sandbox is a factory, not a session. `start()` (`:530`) is the *other* half of the API: a run the **host** answers, with a virtual clock, a seed, and a strict `deliver(seq, now, id, outcome)` protocol.

#### `packages/codemode/src/runtime/prelude-source.ts`
- **Purpose:** the JavaScript evaluated inside the VM before the script runs — the script's entire world.
- **Key abstractions:** `PRELUDE_SOURCE` (a string); `MAX_STORE_VALUE_CHARS` (256 KiB), `MAX_STORE_TOTAL_CHARS` (1 MiB), `MAX_OUTPUT_CHARS` (16 MiB), `MAX_OUTPUT_ITEMS` (100 000) (`:34-43`).
- **Data flow:** `bridge(kind, a, b, c)` is the only way out. The prelude builds `tools` (a Proxy), `ALL_TOOLS`, `console`, `text`, `image`, `exit`, `store`, `load` and the globals on top of it, and returns `{settle, run, stalled}`.
- **Non-obvious design decisions:**
  - **The built-ins are frozen *before* anything else runs** (the `lockdown()` IIFE, `:58-135`). The reason is stated at `:36-39`: the prelude *shares* the built-ins with the script, so a script that patched `Array.prototype.toJSON` could corrupt what the prelude reports to the host. The freeze is a BFS over everything reachable from the globals, including the intrinsics only reachable from instances (iterator/generator prototypes, `%TypedArray%`, `Iterator.prototype`).
  - **Freezing alone would break ordinary code**, via the "override mistake" — a read-only data property on a prototype cannot be assigned on an instance either, so `this.name = "MyError"` in an `Error` subclass would throw. So commonly-overridden properties (`constructor`, `name`, `message`, `toString`, `toLocaleString`, `valueOf`, `toJSON`) become **accessors whose setter defines an own property on the instance** instead (`:64-89`).
  - **Reading a member of `tools` (or a namespace) that does not exist throws an error that names the close matches** (the `guard()` Proxy, `:230-256`): *"tools.websearch does not exist. Did you mean tools.web_search? ALL_TOOLS lists every tool; searchTools(query) finds tools by topic. Check for a member with "websearch" in tools."* A model typo becomes a one-line fix instead of a silent `undefined`.
  - **`store`/`load` are synchronous over a JSON snapshot**; `load` returns a **copy** (mutating it cannot change the store), storing `undefined` **deletes** the key, and the size limits throw a `RangeError` *inside the script* with an actionable hint ("store() is for small state such as IDs or summaries…").
  - **The output limit fails the script even if the script catches the error** (`:342-354`): `done(false, …)` is called *before* the throw, so the run is already decided.
  - **`image()` validates the actual bytes**: base64 well-formedness, then a **magic-number signature check** against PNG/JPEG/GIF/WebP (`:396-401`), and the **MIME type is derived from the data, not from the declared type** (`:403-437`). Remote `http(s)` URLs are rejected outright.
  - **`stalled()` reports a script waiting on a promise nothing can settle** — with no timers and no I/O in the VM, `await new Promise(() => {})` can never resolve, so the VM detects it and fails the run with *"The script is waiting on a promise that can never settle"* rather than hanging until the deadline.
- **Edge cases & failure handling:** an error whose `name`/`message` is not a string is coerced (`:198-206`); a value that cannot be described at all becomes "The script threw a value that cannot be described"; `exit()` ends the script *successfully* while keeping output and store writes (`:439-450`); `console.*` output is marked `console: true` so a host can tell it from `text()`.
- **Surprising:** **there are no timers, no `fetch`, no `process`, no `require`, no modules, no `WebAssembly`** — but `eval` and `Function` *do* work, because they can only produce more code in the same VM (README, and the "escape hatches" tests).

#### `packages/codemode/src/runtime/worker.ts`
- **Purpose:** the worker-thread entry point. One worker runs one script inside a fresh QuickJS VM.
- **Key abstractions:** `startVm` + the `HostToWorkerMessage`/`WorkerToHostMessage` contract.
- **Data flow:** `workerData` → `startVm({data, wasm, post, shouldInterrupt})` → the VM polls `Atomics.load(interrupt, 0) !== 0` → messages go out via `parentPort.postMessage`.
- **Non-obvious design decisions:**
  - **The worker never disposes the VM** ("The VM lives until the host terminates the worker", `:24`). Disposal is the host's job, via termination.
  - **`shouldInterrupt` is a `SharedArrayBuffer` read, not a message** (`:21`), because `terminate()` alone cannot stop a thread spinning in wasm.
- **Edge cases & failure handling:** a failure in `main()` is posted as `{type: "crash"}` (`:41-43`); the file is safe to import outside a worker (`if (parentPort)` guard, `:40`).
- **Surprising:** **importing this module starts the worker.** Bundled hosts must add it as a separate build entrypoint and pass `workerUrl` — for a Bun compiled executable, the *relative source path string* (e.g. `"./src/codemode-worker.ts"`), which Bun resolves from its embedded module graph.

#### `packages/codemode/src/runtime/host.ts`
- **Purpose:** the Node/Bun launcher — one worker thread and one QuickJS VM per execution.
- **Key abstractions:** `workerLauncher(options)` → `VmLauncher`; the `CodemodeSandbox` class.
- **Data flow:** load wasm (cached) → create a `SharedArrayBuffer(4)` → `new Worker(workerUrl, {workerData})` → relay `message` events → `post` results back → on abort/timeout, set the interrupt flag and `terminate()`.
- **Non-obvious design decisions:**
  - **A fresh worker per run is a termination-safety decision** ("a runaway script, including one that only spins the microtask queue, is killed with `terminate()` and cannot poison a later run", `:19-26`).
  - **`acquireWorker()` is a *synchronous* admission hook that runs after wasm loading and immediately before the worker is created** (`:30`). Throwing rejects the execution *without starting a worker*; returning a release callback gives the host a concurrency slot that is released **on actual worker exit or constructor failure** — never when the script result settles (`:26-34`).
  - **`onWorkerStarted(exited)` gives a promise that resolves when the worker actually exits** (`:68`) — which may be *after* the result and `close()` settle, because on Bun a non-interruptible built-in can delay termination. The host is told to keep the slot occupied until then.
  - **Stopping does not wait for the worker** (`:59-66`): the interrupt flag is set, `terminate()` is fired and *not awaited*, and the worker is `unref()`-ed (because `terminate()` refs it internally). The comment is blunt: *"This does not guarantee computation has stopped."*
  - **Node 24/26 `--watch` messages are filtered out** (`:41-48`) — `watch:import`/`watch:require` on the worker channel would otherwise be parsed as protocol messages (issue #10725).
  - **A worker that exits before the script settled is a `sandbox` error** (`:53-55`).
- **Edge cases & failure handling:** wasm load failure → `Failed to load QuickJS: …`; worker constructor failure → `Failed to start worker: …` **and the reserved capacity is released** (`:32-35`); a throwing `onWorkerStarted` fails the execution and requests termination (`:69-73`).
- **Surprising:** **the default worker URL depends on the file extension** — `./worker.ts` when running from source, `./worker.js` from the published `dist` (`:9-12`).

#### `packages/codemode/src/runtime/inline.ts`
- **Purpose:** runs the VM **on the calling thread**, for runtimes without worker threads, and as the server side of the remote sandbox.
- **Key abstractions:** `inlineLauncher(wasm, interruptBudget)`; `InlineCodemodeSandbox`; `DEFAULT_INTERRUPT_BUDGET = 100_000` (`:39`); `INLINE_MAX_STACK_SIZE = 256 * 1024` (`:42`).
- **Data flow:** same as the worker launcher, except `post` defers delivery to a **microtask** so host code never runs inside a VM callback and can never re-enter the VM (`:80-98`).
- **Non-obvious design decisions:**
  - **The interrupt budget replaces the deadline while the script computes.** QuickJS runs synchronously, so on the calling thread neither the deadline timer nor the abort signal can fire — and on Cloudflare even `Date.now()` is frozen. The launcher therefore *counts the interrupt polls* and fails with `kind: "timeout"` once the budget is spent (`:77-84`).
  - **The budget is a measured constant**: ~50 000 polls/second on an Apple M-series laptop, ~10 000/second on Cloudflare Durable Objects — so 100 000 polls is roughly 2–10 seconds of uninterrupted computation (`:19-25`). The README adds the operational rule: **keep the budget below the platform's CPU limit**, because hitting the platform limit *resets the Durable Object* instead of failing one script.
  - **The budget is counted across waits on tools**, so a script that alternates compute and tool calls is still bounded (proved by a test).
  - **The first terminal message wins** — a crash caused by interrupting an already-settled VM is noise and is dropped (`:71-75`).
  - **The stack guard is reduced to `INLINE_MAX_STACK_SIZE`** because the VM runs on the caller's stack (~1 MB on Node's main thread), so the guard must trip before the host stack overflows.
- **Edge cases & failure handling:** when the budget is exhausted the launcher reports a `timeout` **rather than** the interrupt-induced crash (`:87-93`) — the cause, not the symptom.
- **Surprising:** **the deadline still works whenever the script waits on a tool**, because the event loop runs then. The interrupt budget is only the limit on pure computation.

#### `packages/codemode/src/runtime/remote.ts`
- **Purpose:** runs the VM in **another isolate** (a Cloudflare Durable Object) over an RPC boundary, while the tools stay in the caller.
- **Key abstractions:** `RemoteCodemodeSandbox`; `serveCodemodeRemote(request, exchange, options)`; `CodemodeRemote`, `CodemodeRemoteExchange`, `CodemodeRemoteMessage`, `CodemodeRemoteReply`; `CodemodeServeOptions`.
- **Data flow:** client → `remote.execute(request, exchange)` → remote starts the VM → the remote **buffers** output and sends it with the next `exchange` → the client runs the tool and replies → … → the remote sends the terminal `done` → the client resolves.
- **Non-obvious design decisions:**
  - **The measured reason for the whole design** is in the header comment: a 10-second compute delayed every other request to the session Durable Object by the full 10 seconds **when the VM ran in the session object or in a Dynamic Worker, but by ~50 ms in a Durable Object of a separately deployed Worker** (`:5-16`). The architectural split follows from a measurement, not a preference.
  - **Output is buffered on the remote and flushed with the next call** (`FLUSH_ITEMS = 1000`, `FLUSH_CHARS = 1 MiB`, `:88-89`), so a script that prints in a loop does not make one RPC per line. A test pins 5 000 prints to ≤ 6 exchanges.
  - **Each `exchange` carries at most one call**, so concurrent tool calls are concurrent RPCs; calls on one stub are delivered in order, which keeps output ordered before the call that follows.
  - **The client cannot interrupt a remote VM that is computing.** When the client finishes first it answers every pending and later exchange with `{type:"stop"}` (`:33-37`), and the remote disposes the VM at that point; a remote that is *computing* keeps going until it calls a tool or uses up its budget, and reports that as a timeout.
  - **The server caps what the client may ask for**: `budget = min(requested, maxInterruptBudget)`, `memory = min(requested, maxMemoryLimitBytes)` (`:110-118`). The client cannot widen the server's limits.
  - **The client's waiter is registered *before* the reply is sent** (`:213-217`), because a tool may throw *synchronously* and answer in the same tick.
- **Edge cases & failure handling:** an RPC rejection, or a remote that returns **without a terminal message**, is a `kind: "sandbox"` error (`"Remote sandbox returned before the script settled"`, `:239-243`); a remote that cannot be reached at all throws `Failed to reach the remote sandbox: …`.
- **Surprising:** the remote is described as a *pure function of its inputs* — `serveCodemodeRemote` "never rejects" (`:107-109`). Every failure is a message, not an exception.

#### `packages/codemode/src/cloudflare.ts`
- **Purpose:** the Cloudflare Workers entry (`"./cloudflare"`).
- **Key abstractions:** `cloudflareQuickJSWasm` (the Wrangler-compiled module); `createInlineCodemodeSandbox(options)`; `CodemodeSandboxDurableObject` (the remote end).
- **Data flow:** the `.wasm` import is turned into a `WebAssembly.Module` by Wrangler's `CompiledWasm` rule → `serveCodemodeRemote` runs the VM in the Durable Object's thread → tools are answered over Workers RPC from the caller's object.
- **Non-obvious design decisions:**
  - **`CodemodeSandboxDurableObject` keeps no state and never touches storage** (`:50-51`); it is a CPU rental, not a datastore.
  - **The server's limits are `protected` fields the host overrides by subclassing** (`:63-65`, and the documented example at `:53-60`): `maxInterruptBudget`, `maxMemoryLimitBytes`. The default memory is 32 MiB per VM against a 128 MB isolate (`:32`).
  - **The class must be deployed in its *own* Worker** and bound with `script_name` — "a class in the same Worker can share an isolate, and therefore a thread, with the objects that call it" (`:49-53`).
  - **The `.wasm` import is typed as `unknown` and cast** (`:26-28`), because the declaration file cannot express "this is a compiled module".
- **Edge cases & failure handling:** the Durable Object caps every request at its own limits "whatever the client asks for" (`:46`).
- **Surprising:** the comment at `:12-22` spells out the **failure mode of the wrong deployment**: importing `/cloudflare` into the agent's own Worker would bundle QuickJS there too, and a same-Worker class would block the session. The import path *is* the architecture.

#### `packages/codemode/src/cloudflare-modules.d.ts`
- **Purpose:** ambient declarations so the repository type-checks without a Workers type dependency.
- **Key abstractions:** `declare module "cloudflare:workers"` with a minimal `DurableObject`; `declare module "*/quickjs.wasm"` returning `unknown`.
- **Data flow:** compile-time only.
- **Non-obvious design decisions:** the wasm declaration is a **pattern** (`*/quickjs.wasm`), not an exact specifier — so a host that declares the exact specifier wins where both are visible (`:13-16`).
- **Edge cases & failure handling:** the file is **not published** (the comment at `:2-3`), and the build tsconfig lists it under `files` because `exclude` does not apply to `files`.
- **Surprising:** it is typed `source` in the file list even though it is a declaration file.

#### `packages/mcp/src/protocol/jsonrpc.ts`
- **Purpose:** the JSON-RPC vocabulary and the client's error taxonomy.
- **Key abstractions:** `JsonRpcRequest`/`Notification`/`Response`; `JSON_RPC_ERROR_CODES` (`:37-43`); `McpError` (code + data), `McpConnectionClosedError`, `McpTimeoutError` (`:64-70`), `McpAbortError` (`:74-78`); `parseJsonRpcMessage`; the `isJsonRpc*` guards.
- **Data flow:** a raw value → `isJsonRpcRequest` / `isJsonRpcNotification` / `isJsonRpcResponse` → typed message, or `McpError(invalidRequest)`.
- **Non-obvious design decisions:**
  - **A response is "either result or error, never both and never neither"** — `isJsonRpcResponse` checks `"result" in message` XOR `"error" in message` (`:93-99`).
  - **The four error classes are separate types, not one class with a code**, so a caller can `instanceof` them: a timeout is *not* an abort, and a closed connection is not a protocol error.
  - **`McpAbortError` has `name = "AbortError"`** (`:76`) even though the class is `McpAbortError` — deliberately matching the DOM/Node convention so generic abort handling works.
- **Edge cases & failure handling:** `isJsonRpcId` accepts a string or a **finite** number (`:82-84`) — `NaN`/`Infinity` are rejected.
- **Surprising:** `toError(value)` (`:86-88`) exists purely so every listener receives a real `Error`.

#### `packages/mcp/src/protocol/types.ts`
- **Purpose:** the MCP protocol types and the **version negotiation constants**.
- **Key abstractions:** `LATEST_PROTOCOL_VERSION = "2025-11-25"` (`:4`); `SUPPORTED_PROTOCOL_VERSIONS` (`:9`); `Tool` (with `outputSchema`, `annotations`, `execution`); `ToolAnnotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`); `Root`; `ClientCapabilities`/`ServerCapabilities`; `Resource`/`ResourceTemplate`.
- **Data flow:** types only.
- **Non-obvious design decisions:** **the client sends the latest version but accepts four** — "Servers that do not support the requested version answer with their own latest one, so older versions stay accepted for servers built on older SDKs" (`:5-8`).
- **Edge cases & failure handling:** n/a (the client validates the negotiated version at runtime — see `client.ts`).
- **Surprising:** `Tool.execution.taskSupport` (`:77-79`) and `ToolAnnotations` exist in the type surface although the README says "servers, sampling, and tasks are outside the initial core" — the *types* are broader than the implemented surface.

#### `packages/mcp/src/protocol/content.ts`
- **Purpose:** MCP content blocks, and the conversion into the shape an LLM API accepts.
- **Key abstractions:** `ContentBlock` union; `CallToolResult` (`content`, `structuredContent`, `isError`); `LlmContent` = text | image; `toLlmContent(result)`; `blockToLlmContent(block)`.
- **Data flow:** `CallToolResult` → per-block mapping → `LlmContent[]`.
- **Non-obvious design decisions:**
  - **Text and images pass through; everything else becomes a short text placeholder** (`:79-108`): audio → `[audio <mime> omitted]`; a resource link → `name: uri`; an embedded text resource → its text; an embedded **image** resource → an image block; a binary resource → `[binary resource <uri> (<mime>) omitted]`. Nothing is silently dropped, and nothing is dumped.
  - **A result with no content blocks but with `structuredContent` falls back to its JSON** (`:115-117`), "since servers should, but do not always, mirror structured results as text".
  - **`structuredContent` is typed `unknown`** — any JSON value including arrays and `null` (MCP 2026-07-28), which was a *breaking change* in 1.2.0.
- **Edge cases & failure handling:** an unknown block `type` still renders a placeholder rather than crashing (`:105-107`).
- **Surprising:** the placeholders are **part of the model's context** — they are the difference between "the tool returned audio" and "the tool silently returned nothing".

#### `packages/mcp/src/auth-provider.ts`
- **Purpose:** the one-method seam between the HTTP transport and whatever holds credentials.
- **Key abstractions:** `AuthProvider {token(), onUnauthorized?(context)}`; `UnauthorizedContext` (the 401 response, the server URL, the fetch, and **the token the rejected request carried**); `McpFetch`.
- **Data flow:** the transport asks for a token before each request; on a 401 it hands the response to `onUnauthorized`, which may refresh, then retries once.
- **Non-obvious design decisions:**
  - **`UnauthorizedContext.token` is the *rejected* token**, and the doc explains exactly why: "A different current token means another request already refreshed it" (`:10-11`). That single field is what lets N concurrent 401s share one refresh.
  - **`token()` may refresh over the network**, so the transport calls it *only before requests whose answer it waits for* — and `close()` explicitly does **not** call it (see `streamable-http.ts`).
- **Edge cases & failure handling:** n/a — the interface is tiny on purpose.
- **Surprising:** **there is no OAuth code in this file.** The transport knows nothing about OAuth; the OAuth package adapts itself to this interface.

#### `packages/mcp/src/transports/transport.ts`
- **Purpose:** the transport contract and the shared listener bookkeeping.
- **Key abstractions:** `McpTransport` (`start`/`send`/`close`/`onMessage`/`onError`/`onClose`/optional `setProtocolVersion`); `McpTransportSendOptions {signal}`; `TransportEvents` (the abstract base every transport extends); `DEFAULT_MAX_MESSAGE_BYTES = 16 MiB` (`:3`).
- **Data flow:** a transport emits messages; the client consumes them.
- **Non-obvious design decisions:**
  - **`send()` takes an optional `signal`**, documented as: *"Aborted once the sender no longer waits for a reply … A transport must not dispatch the message after that, for example when retrying it after an authorization refresh. It does not undo a message already dispatched."* (`:9-17`) — the fix for issue #10598, where a cancelled request was still executed by the server.
  - **`emitClose()` fires at most once per transport** (`:61-64`) — a transport that closes twice does not double-notify.
  - **Listener registration returns an unsubscribe function** (`:38-51`), so the client can drop all three listeners on close.
- **Edge cases & failure handling:** `emitError` normalizes a non-Error into an `Error` (`:56-59`).
- **Surprising:** `setProtocolVersion` is **optional** on the interface — only the HTTP transport uses it to send `MCP-Protocol-Version` on subsequent requests.

#### `packages/mcp/src/transports/in-memory.ts`
- **Purpose:** an in-process transport pair for tests.
- **Key abstractions:** `InMemoryTransport`; `createInMemoryTransportPair()`.
- **Data flow:** `send()` **structured-clones** the message and delivers it to the peer in a microtask (`:24-26`).
- **Non-obvious design decisions:**
  - **The clone is deliberate** — it reproduces the structured-clone boundary a real transport has, so a test that mutates a message after sending sees the same behaviour as production.
  - **Delivery is a microtask, not a call** — the client is never re-entered synchronously from `send()`.
  - **`emitError` is overridden and made public** "so tests can simulate transport-level failures" (`:37-40`) — the one place the class breaks its own encapsulation, on purpose.
- **Edge cases & failure handling:** sending before `start()` or after `close()` throws `McpConnectionClosedError`; `connectPeer` twice throws.
- **Surprising:** `close()` closes the peer too (`:28-31`) — closing one end tears down the pair.

#### `packages/mcp/src/transports/stdio.ts`
- **Purpose:** the newline-delimited-JSON stdio transport for local MCP servers.
- **Key abstractions:** `StdioTransport`; `StdioTransportOptions`; `killProcessTree(child, signal)` (`:17-45`).
- **Data flow:** `crossSpawn(command, args)` → stdout chunks are buffered and split on `\n` → each line is `JSON.parse`d and `parseJsonRpcMessage`d → emitted; stdin writes `JSON.stringify(message) + "\n"`.
- **Non-obvious design decisions:**
  - **The shutdown sequence follows the spec exactly**: close stdin, wait 500 ms (`STDIN_CLOSE_GRACE_MS`), then `SIGTERM`, then `SIGKILL` after `closeTimeoutMs` (default 2 s) (`:152-179`).
  - **The server runs in its own process group** (`detached: USE_PROCESS_GROUPS`, `:112`), and the kill targets the **negative pid** — "the whole group, so wrappers like `npx` or `uvx` do not leave the server behind" (`:31-33`).
  - **Windows uses `taskkill /pid /T /F`** because Windows has no graceful signals and `cross-spawn` runs `.cmd` shims through `cmd.exe` (`:21-29`).
  - **A process-exit hook kills the groups of any server still running** when the host exits without closing them (`:47-58`).
  - **stdout and stderr have separate byte caps** (16 MiB message / 64 KiB stderr ring, `:7`), and an over-long message **drops the buffer and reports an error** rather than growing without bound (`:181-200`).
  - **stderr is kept as a ring buffer** (`:207-213`) so `transport.stderr` always holds the *last* 64 KiB — the server's own log is readable after the fact.
  - **A server that closes with an incomplete JSON-RPC message is an error** (`:124-127`), not a silent truncation.
- **Edge cases & failure handling:** `cross-spawn` is used instead of `child_process.spawn` so Windows `.cmd` shims work; the spawn error is awaited explicitly before `start()` resolves (`:114-130`).
- **Surprising:** **`env` defaults to inheriting the whole process environment** and `inheritEnv: false` is the opt-out — the opposite of the usual sandbox default.

#### `packages/mcp/src/transports/streamable-http.ts`
- **Purpose:** the Streamable HTTP transport: POST for requests, GET for the server-to-client stream, DELETE to end the session, SSE for streaming responses.
- **Key abstractions:** `StreamableHttpTransport`; `consumeSseStream(stream, options)` (`:41`); `McpHttpError`, `McpAuthRequiredError`, `McpSessionExpiredError`; `StreamableHttpReconnectOptions`; `SseEvent`.
- **Data flow:** `send()` → `authorizedFetch("POST", …)` → check the response → capture `Mcp-Session-Id` → either parse a JSON body or hand the body to `consumeResponseStream`; `notifications/initialized` opens the GET stream.
- **Non-obvious design decisions:**
  - **`consumeSseStream` is a correct, hand-written SSE parser** with: CRLF handling, `:` comment lines ignored, multi-line `data:` joined with `\n`, `id:` captured (and ignored if it contains a NUL, per the SSE spec), `retry:` captured and **used as the reconnect delay** (`:79-81`), and a **byte budget on the pending event** so a server that streams `data:` lines without a terminating blank line cannot grow the buffer without bound (`:47-53`, `:86-88`).
  - **The GET stream opens only after initialization** (`:250-254`) — the spec forbids opening it earlier.
  - **A dropped response stream is *resumed* with `Last-Event-ID`** when the server assigned event ids (`:382-427`). The server may close response streams at will, so a lost stream is not a lost answer.
  - **The reconnect backoff resets when the stream was healthy** — "A stream that stayed up for a while counts as healthy, even if it was idle" (`:436-437`).
  - **Retry classification is explicit** (`:482-489`): 408/429/5xx and network `TypeError`s (including a connection dropped mid-body) are retryable; auth, session and protocol errors are not.
  - **`fetch` is called without a receiver** (`:214-219`) — "`this.fetch(...)` … would pass the transport as `this`, which Cloudflare Workers reject for the platform fetch ("Illegal invocation")" (issue #10188). A test pins this with a strict `fetch` that throws on any receiver.
  - **`close()` reuses the last request's token and never asks the auth provider** (`:268-284`): "The auth provider may refresh tokens over the network, so it is not asked here and closing never waits for a refresh" (issue #10565). The DELETE has a 1-second `AbortSignal.timeout`.
  - **`signal` only stops *dispatch*, not the shared recovery** (`:285-292`): "getting a token or the authorization recovery can take a while, and a request its sender gave up on in the meantime must not reach the server. It does not abort the shared recovery, which other requests may wait for."
  - **A 403 whose challenge says `insufficient_scope` is treated as an auth problem** (`:163-168`), which is what makes step-up authorization reachable.
  - **The error body is capped at 8 KiB and the message snippet at 500 chars** (`:20-21`, `:173-177`).
- **Edge cases & failure handling:** a response stream that ends without an answer produces a synthetic JSON-RPC **error response** for that request id (`:418-426`), so only the one request fails; a 202/204 for a request is an error ("accepted request without a response"); a 404 with a known session id is `McpSessionExpiredError`.
- **Surprising:** **the reconnect delay respects the server's `retry:` field** — a server can dictate the client's backoff (`:491-492`).

#### `packages/mcp/src/client.ts`
- **Purpose:** the transport-neutral MCP client core — request correlation, initialization, timeouts, cancellation, progress, roots, and the protocol helpers.
- **Key abstractions:** `McpClient`; `McpClientOptions`; `McpRequestOptions {signal, timeoutMs, onProgress}`; `PendingRequest`; `validateInitializeResult`, `validateListPage`, `validateCallToolResult`, `validateReadResourceResult`.
- **Data flow:** `connect(transport)` → `initialize` → `notifications/initialized` → state `connected`; then `request()`/`notify()`; responses resolve the matching `pending` entry; notifications fan out to listeners; server requests (`ping`, `roots/list`) are answered by registered handlers.
- **Non-obvious design decisions:**
  - **Timeouts are *renewed by progress*** (`:536-551`, `:553-559`): every `notifications/progress` for the request re-arms the timer. A long tool call is not a timeout as long as it reports progress. The default is 30 s (`:38`).
  - **The spec forbids cancelling `initialize`**, so the `cancellable` flag is false for it (`:429-441`) and no `notifications/cancelled` is sent — pinned by a test.
  - **Every request carries its own `sendController`** (`:443`), aborted in `removePending` (`:577-585`). That is the signal the transport uses to refuse to dispatch (or re-dispatch) a message whose caller already gave up — issue #10598.
  - **The abort reason is forwarded to the server** as `notifications/cancelled` with `reason` (`:561-574`), so the server can see *why*.
  - **Pagination is bounded and loop-safe**: at most 1 000 pages (`:39`), a **duplicate cursor is an error** (`:369-372`), and an empty/null `nextCursor` terminates the list (`:113-115`).
  - **The result validation is lenient in exactly one place and strict everywhere else.** `content` is optional (servers that only return `structuredContent` are common) and defaults to `[]` (`:148-156`); every other field is checked (`isTool` requires `name` and an object `inputSchema`; `isResource` requires a `uri`, with `name` optional and **falling back to the URI** — `:118-131`).
  - **`roots` may be a value or a function** (async), so a client can offer roots that change (`:181-193`).
  - **`markClosed` is idempotent** (`:597-611`): it rejects pending requests, aborts the server requests being served, flips the state, and fires the close listeners **once**.
  - **Transport errors are *reported*, not fatal** (`:224-225`): "Transport errors are reported only. Pending requests fail when the transport closes." A stray log line on the channel does not kill in-flight calls — pinned by a test.
  - **Progress notifications are matched by token, not by request id** (`:513-521`, `:536-543`), because the progress token is the request id but the mapping is explicit.
- **Edge cases & failure handling:** `connect()` on a client that is not `idle` throws; a failed `connect()` **closes the transport and rethrows** (`:239-243`); a response for an unknown request id is reported as an error, not a crash (`:501-505`); `initialize` with an unsupported negotiated version is rejected and the client ends `closed`.
- **Surprising:** **`McpClient` owns the protocol and the transport owns only framing and I/O** — the README states the split explicitly, and the code honours it: the transport never correlates a request with its answer.

#### `packages/mcp/src/oauth/errors.ts`
- **Purpose:** the OAuth error types.
- **Key abstractions:** `OAuthError` (code + `errorUri`); `OAuthIssuerMismatchError` (`:13-26`) carrying `expected` and `received`; `OAuthInsecureEndpointError` (`:28-34`); `OAuthRegistrationError` (status + body); `McpOAuthAuthorizationRequiredError` (`:40-44`).
- **Data flow:** thrown by the flow and the discovery code; caught by the caller.
- **Non-obvious design decisions:**
  - **`OAuthIssuerMismatchError.expected` may be `undefined`** — "undefined when no authorization server metadata was discovered" (`:14-15`). The *absence* of a verifiable issuer is itself an error, not a pass.
  - **`OAuthInsecureEndpointError` exists so credentials are never sent to a non-HTTPS endpoint** — the message is explicit: "Refusing to send OAuth credentials to non-HTTPS endpoint …".
  - **`McpOAuthAuthorizationRequiredError` is a *distinct* error**, not a flag — it is the signal "the user must act", and it is what the README's example catches.
- **Edge cases & failure handling:** the issuer-mismatch message formats `undefined` as `"none"` so the log reads clearly (`:19-21`).
- **Surprising:** **`OAuthError` carries the RFC's own `error` code string**, so a server's `access_denied` survives into the exception.

#### `packages/mcp/src/oauth/types.ts`
- **Purpose:** the OAuth data shapes and **dependency-free structural validation** (adapted from the official SDK, with Zod removed).
- **Key abstractions:** `AuthorizationServerMetadata`; `OAuthProtectedResourceMetadata`; `OAuthTokens`; `OAuthClientMetadata`/`OAuthClientInformation`; `OAuthChallenge`; `OAuthDiscoveryState`; `parseAuthorizationServerMetadata`, `parseProtectedResourceMetadata`, `parseOAuthTokens`, `parseClientInformation`.
- **Data flow:** an untrusted JSON body → a parser → a typed object with `undefined` fields **removed** (`compact`, `:100-102`).
- **Non-obvious design decisions:**
  - **`null` and `""` count as *absent*** (the `absent()` helper, `:111-113`): "servers send them for fields they have no value for, like `scope: \"\"`". This was a real bug (#10266) — an empty scope used to fail with "Invalid scope".
  - **`expires_in: null` must not mark a token as expired** (`:183-193`): "Number(null) is 0, which would mark the token as expired at once." The parser checks `absent()` before calling `Number`.
  - **`safeUrl` rejects `javascript:`, `data:` and `vbscript:`** (`:126-135`) and uses `URL.canParse` first — because "URL parsing throws a `TypeError`, which discovery reserves for network failures" (`:129-130`). A malformed URL must not be mistaken for a network error.
  - **Optional string arrays keep `null` as absent but reject a non-string member** (`:117-122`).
- **Edge cases & failure handling:** every parse failure is a plain `Error` with a field-specific message (`"Invalid OAuth token response"`, `"Invalid expires_in"`, …).
- **Surprising:** the `compact()` step is what makes `withScope()` and `stepUpScope()` correct downstream — absent scope must be *absent*, not present-and-empty.

#### `packages/mcp/src/oauth/discovery.ts`
- **Purpose:** protected-resource and authorization-server discovery, and `WWW-Authenticate` parsing.
- **Key abstractions:** `discoverProtectedResourceMetadata`; `discoverAuthorizationServerMetadata`; `discoverOAuthServerInfo`; `buildAuthorizationServerDiscoveryUrls`; `parseWwwAuthenticate`; `selectResource`; `resourceUrlFromServerUrl`.
- **Data flow:** server URL → `/.well-known/oauth-protected-resource<path>` → the `authorization_servers` entry → `/.well-known/oauth-authorization-server<path>` (or the OIDC variants) → issuer-validated metadata.
- **Non-obvious design decisions:**
  - **The discovery *miss* rule is explicit**: 4xx and 502 mean "not here, try the next candidate", anything else is a hard error (`:24-26`). A 500 during discovery is not silently a miss.
  - **The issuer is validated against the URL that was requested** (`:137-146`), with a trailing-slash trim on both sides because "URL parsing adds a trailing slash to bare origins". A mismatch throws `OAuthIssuerMismatchError`.
  - **Three candidate metadata URLs are built** (`:104-114`): `oauth-authorization-server`, `openid-configuration`, and — for a path'd issuer — `openid-configuration` **after** the path.
  - **Invalid protected-resource metadata falls back to the server origin** rather than failing discovery (`:167-180`): only a `TypeError` (a genuine network failure) is re-thrown.
  - **`selectResource` refuses a resource that does not match the MCP server** — origin must match and the path must be a prefix (`:202-215`). A metadata document cannot redirect a request to a different host.
- **Edge cases & failure handling:** a malformed `resource_metadata` URL in a challenge is ignored rather than fatal (`:45-51`); a challenge with a non-`bearer`/`dpop` scheme yields `{}`.
- **Surprising:** **`parseWwwAuthenticate` treats an empty value as absent** (`:31-33`): "`scope=\"\"` carries no information, so it counts as absent" — the same rule as the metadata parser.

#### `packages/mcp/src/oauth/flow.ts`
- **Purpose:** the OAuth flow — PKCE authorization, dynamic client registration, code exchange, refresh, and the transport-facing adapter.
- **Key abstractions:** `authorizeMcp(provider, options)`; `startAuthorization`; `exchangeAuthorizationCode`; `refreshAuthorization`; `registerClient`; `stepUpScope`; `adaptOAuthProvider`; `OAuthClientProvider` (the interface an application implements); `OAuthFlowResult = "AUTHORIZED" | "REDIRECT"`.
- **Data flow:** discovery → client registration (or a Client ID Metadata Document) → `startAuthorization` (PKCE verifier + S256 challenge) → the application opens the browser → the callback server captures the code → `authorizeMcp` with the code exchanges it → tokens are saved → `adaptOAuthProvider` turns the provider into an `AuthProvider` for the transport.
- **Non-obvious design decisions:**
  - **The flow never opens a browser and never chooses where credentials live.** The package provides `onRedirect(url)` and an `McpOAuthStateStore`; the application supplies both (README, and `OAuthClientProvider`).
  - **`application_type` is derived from the redirect URIs** (`:113-120`): loopback hosts and custom schemes → `native`, otherwise `web` (MCP SEP-837). Without it, OpenID Connect servers reject http loopback redirect URIs (issue #10493).
  - **`secureEndpoint` refuses to send credentials anywhere but https** (`:122-125`), with loopback as the sole exception.
  - **`stepUpScope` combines the challenged scopes with the scopes granted so far** (`:314-318`): "a challenge may list only the missing scopes and a token with just those would lose access the old one had". The new grant is the union.
  - **RFC 9207 issuer validation on the code exchange** (`:381-388`): the code is exchanged only when `iss` names the flow's authorization server; **if the server promised the parameter and did not send it, the exchange is refused**; and **without metadata there is no issuer to compare with, so any `iss` is rejected** — a server cannot skip the check by hiding its metadata.
  - **`authorizeMcp` self-heals once** (`:430-449`): an `invalid_client`/`unauthorized_client` invalidates *all* credentials and retries; an `invalid_grant` invalidates only the tokens and retries.
  - **A failed refresh falls back to a new authorization, but only for a `server_error`** (`:394-401`) — a specific refusal (`access_denied`, `invalid_scope`) is re-thrown rather than papered over.
  - **`adaptOAuthProvider` shares ONE refresh between concurrent 401s** (`:452-487`): an in-flight promise is reused; and "a request whose token was already replaced is just retried: with rotating refresh tokens, a second refresh with the old refresh token would fail and discard the new grant" — hence the comparison of `context.token` with the current token.
  - **An `insufficient_scope` challenge asks for authorization instead of refreshing** (`:466-476`), because "a refresh keeps the old scope".
- **Edge cases & failure handling:** every request of the flow takes an optional `signal` (issue #10565) and **an aborted refresh does not fall back to a new authorization** (`:396`); the token request **checks the body before the status** (`:216-228`) because "servers may report OAuth errors with any status".
- **Surprising:** **`scope` uses `||`, not `??`** (`:344-346`) — "an empty scope (for example from `scopes_supported: []`) falls through to the next source". The empty-string-is-absent rule from `types.ts` is applied at every layer.

#### `packages/mcp/src/oauth/provider.ts`
- **Purpose:** the default, stateful OAuth client provider for **one exact MCP server URL**.
- **Key abstractions:** `McpOAuthProvider`; `McpOAuthState`; `McpOAuthStateStore`; `MemoryOAuthStateStore`.
- **Data flow:** the provider reads/writes a `McpOAuthState` through the store; `state()`, `clientInformation()`, `tokens()`, `codeVerifier()`, `discoveryState()` are the getters; `saveX()` are the setters; `invalidateCredentials(kind)` deletes selectively.
- **Non-obvious design decisions:**
  - **Stored state for another server URL is ignored** (`:165-168`): `own(state)` returns a fresh empty state when `state.serverUrl !== this.serverUrl`. "Stored state for another server URL is ignored so credentials never leak across servers." — a pinned test binds credentials to the exact URL.
  - **Writes are serialized through a promise chain** (`:157-163`), so two concurrent `saveTokens` calls cannot interleave a read-modify-write on the store.
  - **`expires_in` is turned into an absolute `tokensExpireAt` at save time** (`:106-115`) — the expiry is remembered against the wall clock, not re-derived from a relative number later.
  - **`MemoryOAuthStateStore` clones on both load and save** (`:40-51`), so the caller cannot mutate the stored object by accident.
  - **`invalidateCredentials` is granular** — `"all" | "client" | "tokens" | "verifier" | "discovery"` (`:129-147`), which is what lets the flow retry with only the tokens dropped.
- **Edge cases & failure handling:** `codeVerifier()` **throws** when none is stored, rather than returning `undefined` and failing later.
- **Surprising:** the README states the package "does not open a browser or choose where credentials are stored" — but this class *does* default to an in-memory store, so a host that forgets to inject one silently loses credentials on restart.

#### `packages/mcp/src/oauth/callback.ts`
- **Purpose:** the local HTTP server that catches the OAuth redirect.
- **Key abstractions:** `OAuthCallbackServer`; `OAuthCallback {code, state, iss?}`; `OAuthCallbackPage`; `waitForCallback(state, path?)`.
- **Data flow:** `listen()` binds `127.0.0.1:0` → the redirect arrives with `code`/`state` → the pending promise for that `state` resolves.
- **Non-obvious design decisions:**
  - **`waitForCallback(state, path?)` can demand a specific path** (`:93-105`), "so a server-specific redirect URI can tell authorization servers apart (RFC 9700 section 4.4.2.2)". A response on another path is rejected — pinned by a test.
  - **`iss` is captured** (`:157-158`) so RFC 9207 issuer validation can happen at the flow level.
  - **The pending map is keyed by `state`** and a duplicate `state` throws ("OAuth state is already pending") — a replayed callback cannot hijack a pending one.
  - **The browser page is pluggable** (`renderPage`) and defaults to plain text; the HTML variant sets `cache-control: no-store`.
  - **The default timeout is 5 minutes** and `close()` rejects every pending promise.
- **Edge cases & failure handling:** unknown path → 404; unknown/expired state → 400; a missing `code` → 400; an `error` parameter → the promise **rejects** with the server's `error_description` (and the browser still gets a 200 "you may close this window").
- **Surprising:** **`redirectHost` is separate from `host`** (`:15-20`) — you can listen on `127.0.0.1` while advertising `localhost` in the redirect URI, which is what clients registered with `localhost` need.

#### `packages/mcp/src/oauth/index.ts`
- **Purpose:** the `"./oauth"` barrel.
- **Key abstractions:** re-exports the callback server, the discovery functions, the error classes, the flow functions, the provider classes and the OAuth types.
- **Data flow:** n/a (barrel).
- **Non-obvious design decisions:** the barrel **deliberately omits `McpOAuthStateStore`'s helpers** and exports the *types* separately with `export type` — so a runtime import of the OAuth entry does not pull in the callback server's `node:http` unless it is used.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the OAuth entry is a **separate export path** (`@earendil-works/pi-mcp/oauth`) precisely so a consumer that does not need OAuth does not load it.

#### `packages/mcp/src/index.ts`
- **Purpose:** the package's main barrel.
- **Key abstractions:** re-exports the client, the transports, the protocol types, the error classes and `toLlmContent`.
- **Data flow:** n/a.
- **Non-obvious design decisions:** the barrel exports **the error classes by name** (`McpError`, `McpAbortError`, `McpConnectionClosedError`, `McpTimeoutError`, `McpAuthRequiredError`, `McpSessionExpiredError`) — the caller is expected to branch on them.
- **Edge cases & failure handling:** n/a.
- **Surprising:** it does **not** export the OAuth surface — that is the `"./oauth"` entry, and the split is visible in the barrel itself.

#### `packages/mcp/src/testing/index.ts`
- **Purpose:** the `"./testing"` entry.
- **Key abstractions:** `createInMemoryTransportPair`, `InMemoryTransport`.
- **Data flow:** n/a.
- **Non-obvious design decisions:** **the testing transport is a published entry point**, not a test-only file — downstream adapters can be tested against a paired in-memory transport without a network.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the file is 93 bytes — the smallest `source` file in the shard, and the only one whose entire job is a re-export.

#### `packages/codemode/vitest.config.ts` and `packages/mcp/vitest.config.ts`
- **Purpose:** the two packages' Vitest configurations.
- **Key abstractions:** identical in both packages — `globals: true`, `environment: "node"`, a `dot` reporter (or `github-actions` under CI), and **`resolve.conditions: ["source"]`** for both the client and SSR resolvers.
- **Data flow:** the `source` export condition makes `import "@earendil-works/pi-codemode"` resolve to `src/index.ts` instead of `dist/index.js` — every workspace package manifest has a `"source"` field (see `package.json`).
- **Non-obvious design decisions:** **tests import workspace packages by source path, never by built artifact** — no build step is needed before `vitest`.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the two files are byte-identical apart from nothing — the two packages share one test configuration by copy, not by a shared base file.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/codemode/CHANGELOG.md` | Release history 0.99.0 → 1.4.0. Records the **breaking** 1.3.0 change (worker-backed results settle after *requesting* shutdown, not after exit — hosts must track `onWorkerStarted(exited)`), the removal of `MCP_TYPESCRIPT_PREAMBLE` in 1.2.0, the output-limit fix (#10283), the built-in-freeze fix (#10444), and the `parseCodemodeSource` misplacement fix (#10631). |
| `packages/codemode/README.md` | The package's contract in prose: the three-sandbox matrix, the script's whole API surface, `Store` semantics, the source format, Cloudflare deployment (why a *separate* Worker, the interrupt-budget rule, the billing model), the declarations renderer, deterministic runs, the four `result.error.kind`s, and a "How it works" section. |
| `packages/codemode/examples/cloudflare/README.md` | The two-Worker example: `sandbox/` runs the VM in a separate isolate; `agent/` owns the tools in a `Session` Durable Object; local run is `npx wrangler dev -c agent/wrangler.jsonc -c sandbox/wrangler.jsonc`; the sandbox must be deployed **first**. |
| `packages/codemode/examples/cloudflare/agent/src/index.ts` | The agent Worker: a `Session` Durable Object owns the tool (`count`) and points `RemoteCodemodeSandbox.remote` at `env.CODEMODE_SANDBOX.getByName(this.ctx.id.toString())` — one sandbox object per session. |
| `packages/codemode/examples/cloudflare/agent/wrangler.jsonc` | Binds the sandbox class **by `script_name`**; the comment states that binding a class exported from this Worker would run the VM on the session's thread. |
| `packages/codemode/examples/cloudflare/sandbox/src/index.ts` | The whole sandbox Worker in five lines: re-export `CodemodeSandboxDurableObject as CodemodeSandbox`, plus a 404 fetch handler ("Only Workers with a binding can reach the class"). |
| `packages/codemode/examples/cloudflare/sandbox/wrangler.jsonc` | `workers_dev: false`, `preview_urls: false`, and `limits.cpu_ms: 60000` — the comment states the rule: **keep the CPU limit above the interrupt budget**, so scripts fail with a timeout instead of resetting the object. |
| `packages/codemode/package.json` | Six export entries (`.`, `./declarations`, `./source`, `./portable`, `./cloudflare`, `./worker`), each with a `"source"` condition; one runtime dependency (`quickjs-wasi` 3.6.2, pinned exactly); `engines.node >= 22.19.0`. |
| `packages/codemode/tsconfig.build.json` | `outDir: dist`, `rootDir: src`, and `files: ["src/cloudflare-modules.d.ts"]` — the ambient declarations are added via `files` because `exclude` does not apply to `files`. |
| `packages/codemode/test/declarations.test.ts` | Pins `schemaToType`: primitive/literal/union rendering, one-line objects with sorted properties, descriptions on comment lines, constraint tags (incl. the Pydantic nullable-branch rule and draft-04 exclusive bounds), `$ref` expansion and recursion stop, tag-dropping before the `unknown` fallback, and the `renderDeclarations` output for tools, namespaced globals and explicit signatures. |
| `packages/codemode/test/deterministic.test.ts` | The deterministic-run suite, run against **both** the worker and the remote backend: identical calls and output for the same start/seed/results, the pinned random values, UTC + no `WeakRef` regardless of the host's timezone, strict `seq` ordering under a reordering transport, the fingerprint format, `during`, the clock never going backwards, abort ending a run uncatchably, and "execute() is not deterministic". |
| `packages/codemode/test/fixtures/raw-worker.ts` | A worker double that posts whatever JSON payload the test passes as the "script", so the host can be fed payloads the real prelude never produces (used for the broken-bridge and Node `--watch` cases). |
| `packages/codemode/test/fixtures/worker-process-exit.ts` | A process-level fixture for `abort`/`timeout`/`close`, printing the result kind, the elapsed time and whether the worker had actually exited when the result settled. |
| `packages/codemode/test/portable.test.ts` | Pins the inline sandbox (interrupt budget as a timeout, the budget counted across tool waits) and the remote sandbox (tools run in the caller, output batching ≤ 6 exchanges for 5 000 prints, the server's caps on budget and memory, abort → "stop" → the remote's VM disposed, and the three remote-failure classifications). |
| `packages/codemode/test/sandbox.test.ts` | The big matrix: **every** behaviour test runs against the worker, inline and remote backends. Covers script errors and stack formatting, the image/text validation matrix, `exit()`, tools (concurrency, identifier shadowing, unawaited-call cancellation, the "did you mean" message), the store (copies, limits, messages), globals (namespaces, `spread`, invalid names), limits (timeout, Infinity, the stall detector, the output-limit RangeError, `close()`, parallel isolation, deep recursion → catchable `RangeError`), the escape hatches (no host globals, `eval`/`Function` stay inside, dynamic import rejected, built-in patches ignored, frozen intrinsics), and the broken-bridge classifications. |
| `packages/codemode/test/source.test.ts` | Pins `parseCodemodeSource`: plain code unchanged, the options line parsed while **keeping line numbers**, only the first line counts, a mid-file options line is rejected **with its line number**, and every rejection message. |
| `packages/codemode/test/worker-lifetime.test.ts` | Pins the #10748 rules: admission denied → no worker started; a failed `Worker` constructor → the reserved capacity is released; a wasm failure → no capacity reserved; abort/timeout/close **settle without waiting for worker exit** (and the partial output and the `cancelled` call record survive); a throwing `onWorkerStarted` terminates the worker; and a real Node/Bun process exits promptly. |
| `packages/mcp/CHANGELOG.md` | Release history 0.99.0 → 1.4.0. Records the `structuredContent` widening to any JSON value (#10416), the RFC 9207 issuer-mismatch fix, the **cancelled-request-is-not-retried** fix (#10598), the `close()`-must-not-refresh fix (#10565), the `application_type` fix (#10493), and the `clientMetadataUrl` → `clientMetadataDocument()` replacement (#10302). |
| `packages/mcp/LICENSES/modelcontextprotocol-typescript-sdk.txt` | The MIT licence of the Anthropic TypeScript SDK, whose `client/auth.ts` the OAuth code was adapted from. Kept in the published `files` list. |
| `packages/mcp/README.md` | The package's contract: usage, the `toLlmContent` rules, the "wrap an MCP tool as an AgentTool" recipe (including the 64-character provider name limit and the "providers require an object schema" workaround), the OAuth recipe with `McpOAuthAuthorizationRequiredError`, the **supported protocol surface** (including what is explicitly out of scope: batch JSON-RPC, legacy HTTP+SSE, servers, sampling, tasks), and the testing entry. |
| `packages/mcp/package.json` | Three export entries (`.`, `./oauth`, `./testing`), `sideEffects: false`, one dependency (`cross-spawn` 7.0.6, pinned), `engines.node >= 22.19.0`. |
| `packages/mcp/tsconfig.build.json` | `outDir: dist`, `rootDir: src`, `include: src/**/*.ts`. |
| `packages/mcp/test/client.test.ts` | Pins the client: the exact `initialize` + `notifications/initialized` message sequence, paginated `tools/list` (including a server that ends pagination with `""`), resource listing with the URI-as-name fallback, `structuredContent` passthrough, JSON-RPC error surfacing with `data`, **timeout renewal on progress**, abort and timeout producing `notifications/cancelled` (but **not** for `initialize`), transport errors being reported without failing pending requests, older protocol versions accepted, and close listeners firing once. |
| `packages/mcp/test/content.test.ts` | Pins `toLlmContent`: text and image pass through; audio, resource links and binary resources become placeholders; an embedded image resource becomes an image; and the `structuredContent`-as-JSON fallback (including `null` and an array). |
| `packages/mcp/test/fixtures/stdio-server.mjs` | A newline-delimited MCP server fixture: answers `initialize`, `tools/list`, `tools/call` and `ping`, and returns a JSON-RPC "not found" error for anything else. |
| `packages/mcp/test/fixtures/stubborn-server.mjs` | A hostile fixture: ignores stdin EOF **and** SIGTERM, and spawns a grandchild that outlives it — the case the process-group kill exists for. |
| `packages/mcp/test/helpers.ts` | Loopback HTTP server helper for the transport tests: `listen(handler)` → origin, `readBody(request)`, and `closeServers()` (which calls `closeAllConnections()` so no test leaks a socket). |
| `packages/mcp/test/oauth.test.ts` | The full OAuth integration suite against a loopback server: discovery → dynamic registration → PKCE authorization → callback → code exchange → a 401 that refreshes; **one refresh shared between concurrent 401s** with rotating refresh tokens; the insufficient-scope step-up keeping the old scopes and the old grant; credentials bound to the exact server URL; the `application_type` derivation; issuer-mismatch rejection; a configured metadata document used as-is (and https enforced); the RFC 9207 `iss` matrix; an aborted flow not falling back to a redirect; and the callback server's plain-text/HTML pages and path rejection. |
| `packages/mcp/test/stdio.test.ts` | Pins the stdio transport: a newline-delimited server round trip with stderr captured both by the callback and by the ring buffer, and (on POSIX) that a server which ignores shutdown **and its grandchild** are both killed within 5 s. |
| `packages/mcp/test/streamable-http.test.ts` | Pins the HTTP transport: the SSE parser (chunked CRLF, comments, ids, multi-line data, and the byte limit on a never-terminated event), JSON and SSE responses, the session and protocol-version headers, the auth-error classification, "only the request whose stream breaks fails", the GET stream opening after initialization, `Last-Event-ID` resumption, a stream that ends without an answer, GET-stream reconnection, a 202-for-a-request, the error body in the message, the 401/403 handoff with the rejected token, **a cancelled request is not retried after an auth recovery**, `close()` reusing the last token, `fetch` called without a receiver, and the expired-session classification. |

### Tier 3 — skipped with a reason

None. Every file in the list was opened and read; no file in this shard is binary, generated, or vendored.

---

## 2. Ideas worth stealing

1. **Let the model write a *script* that calls tools, and keep the nested calls out of the context.** The codemode sandbox's whole point: `tools.<name>(args)` inside a QuickJS VM, and only the script's `text()`/`image()` output and return value reach the LLM (`packages/codemode/README.md:1-6`, `packages/codemode/src/runtime/prelude-source.ts:230-256`). August Trading's desk tools are a natural fit: a model-written plan that fans out twenty order-book reads and returns one screen of numbers instead of twenty tool-result rows. **UNIQUE.**
2. **One host core, three interchangeable execution backends.** `CodemodeSandboxBase` + a `VmLauncher` (`packages/codemode/src/runtime/execution.ts:460`, `:79-81`) means a worker thread, an inline VM and a remote isolate are the *same API with the same result type*. August Trading could have one "analysis runner" abstraction with a local and a worker backend and never re-derive the contract. **CONVERGENT** (the same shape as pi's MCP transport/client split and hermes-agent's runner split).
3. **Deterministic replay of a model-authored workflow.** `sandbox.start(code, {startedAt, seed, …})` fixes the clock, the randomness, the timezone, GC introspection and the delivery order, and reports a **fingerprint** of the VM so a replay can refuse a different one (`packages/codemode/src/runtime/vm.ts:188-224`, `:319`; `packages/codemode/src/runtime/execution.ts:530-570`). August Trading's agent rounds, routines and backtests could all be made replayable by analogy: same inputs, same tool answers, same output. **UNIQUE.**
4. **A "did you mean" error for every tool-name typo.** The `tools` object is a Proxy that throws *"tools.websearch does not exist. Did you mean tools.web_search? …"* instead of returning `undefined` (`packages/codemode/src/runtime/prelude-source.ts:230-256`). For a model, this is a self-correcting error message; for August Trading's desk-tool catalogue it would convert a silent no-op into one line of repair. **UNIQUE.**
5. **Budget the *model's* context in the tool declaration, not just the request.** `schemaToType` renders a schema to TypeScript, degrades **constraint tags first** and only then to `unknown` (`packages/codemode/src/declarations.ts:139-145`, `:10`). August Trading's `utils/memoryBudget.ts` has the analogous pressure for the notebook; this is the same idea applied to the *tool surface* — which is where an LLM spends context. **UNIQUE.**
6. **Progress renews the deadline.** Every `notifications/progress` re-arms the request timeout (`packages/mcp/src/client.ts:536-559`). A slow provider call is not a timeout as long as it reports progress — the exact thing August Trading's long analysis turns need. **CONVERGENT** (the same "idle but alive" idea appears in pi's progress handling and hermes-agent's heartbeat). 
7. **A cancelled request must never be *dispatched* after the fact.** The transport's `send()` takes an `AbortSignal` that is fired when the request settles, and the transport must not (re)send a message after that (`packages/mcp/src/transports/transport.ts:9-17`, `packages/mcp/src/client.ts:443`, `:577-585`). The bug it fixes (#10598) is nasty: a cancelled request was still executed on the server. August Trading's "stop" button has the same hazard. **UNIQUE.**
8. **Concurrency admission that is released on *actual* worker exit, not on result settle.** `acquireWorker()` returns a release callback and `onWorkerStarted(exited)` gives a promise that resolves when the worker really dies (`packages/codemode/src/runtime/host.ts:26-34`, `:68`; `packages/codemode/CHANGELOG.md:1.4.0`). A "result settled" semaphore is a leak waiting to happen on Bun, on a busy mac, or under a hung tool. **UNIQUE.**
9. **Share one refresh between concurrent 401s, and detect "someone already refreshed for me" by comparing the rejected token.** (`packages/mcp/src/oauth/flow.ts:452-487`; `packages/mcp/src/auth-provider.ts:10-11`.) With rotating refresh tokens, a second refresh with the old token would fail and *discard the new grant*. The same pattern (compare the credential you used against the current one before acting) applies to any concurrent credential refresh. **UNIQUE.**
10. **Bound everything the model can produce, and fail loudly when the bound is hit.** Output chars *and* items (`MAX_OUTPUT_CHARS`, `MAX_OUTPUT_ITEMS`), store value size and total size, interrupt polls, memory, stack depth, list pages, SSE event bytes, message bytes. **Every** one of these is a named constant with a named failure (`packages/codemode/src/runtime/prelude-source.ts:34-43`, `:342-354`; `packages/mcp/src/client.ts:39`). **CONVERGENT.**
11. **A validation layer that is lenient in exactly one documented place.** `validateCallToolResult` defaults a missing `content` to `[]` (because servers that return only `structuredContent` are common) and is strict everywhere else (`packages/mcp/src/client.ts:148-156`); `validateListPage` accepts a missing resource `name` and substitutes the URI (`:118-131`). Leniency is a *choice with a reason*, not an accident. **UNIQUE.**
12. **Give the caller a token that means "the thing I rejected", not just "there was a 401".** `UnauthorizedContext.token` is the token the *rejected request* carried (`packages/mcp/src/auth-provider.ts:8-12`). That single field is what makes concurrency-safe refresh possible. **UNIQUE.**
13. **A "the script is waiting on a promise that can never settle" detector.** With no timers and no I/O in the VM, `await new Promise(() => {})` can never resolve — so the VM *detects* it and fails the run immediately instead of burning the deadline (`packages/codemode/src/runtime/prelude-source.ts`, `stalled()`; `packages/codemode/test/sandbox.test.ts`). August Trading has the same shape of hang in any promise-based tool layer. **UNIQUE.**
14. **Make the *transport* own only framing and I/O; make the *client* own correlation, timeouts, cancellation and lifecycle.** The README states the split and the code honours it (`packages/mcp/README.md:44-45`, `packages/mcp/src/client.ts:497-520`). August Trading's provider layer already has this shape; the MCP client is the proof that it stays clean when a second transport arrives. **CONVERGENT.**

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work: not in this shard.** Neither package runs a cron, a digest, or a monitoring loop. The closest transferable idea is the *idempotence contract* of the remote sandbox's `exchange` protocol (`packages/codemode/src/runtime/remote.ts:33-48`) and the reconnect/backoff state machine of the GET stream (`packages/mcp/src/transports/streamable-http.ts:429-470`), which is exactly the shape a "poll for entry/TP/SL hits" loop needs: bounded retries, an explicit "healthy" reset, and a terminal failure that is *reported* rather than retried forever.
- **Human-in-the-loop approval: partially here, and it is the OAuth callback.** The one consequential, human-driven action in this shard is the OAuth authorization: the flow **redirects and waits for a human** (`packages/mcp/src/oauth/flow.ts:376-397`), the callback server **binds the response to the exact `state`** and rejects a replayed or mismatched one (`packages/mcp/src/oauth/callback.ts:93-105`, `:124-168`), and the code is only exchanged when its `iss` names the right authorization server (`packages/mcp/src/oauth/flow.ts:381-388`). The transferable pattern for August Trading's approval inbox: **a single-use, state-bound, path-bound approval token** — and the audit trail is the *grant* itself (`saveTokens`, `saveClientInformation`, `saveCodeVerifier`, `saveDiscoveryState`), each of which is a durable, separately invalidatable record.
- **Post-mortem / reflection loops: not in this shard.** There is no outcome→rule machinery. The nearest thing is the deterministic replay (`packages/codemode/src/runtime/vm.ts:188-224`): *the same script, seed, clock and tool answers must produce the same output*, and a fingerprint proves the VM was the same. That is the precondition a post-mortem needs — you cannot learn from a replayed failure if the replay is not bit-identical.
- **Multi-agent: not in this shard.** No subagents, no debate. The relevant finding is negative and useful: pi's `codemode` tool deliberately lets **one** agent script many tool calls instead of spawning agents, and the README says the nested calls stay out of the context. For August Trading's bot roster and group rounds, the interesting question this shard raises is *"when is a scripted fan-out better than a group round?"* — and the answer this repo implies is: whenever the calls are *data fetches* rather than *judgements*.
- **Structured logs the model can query: partly here, via the call record.** `CodemodeResult.calls` is a list of `{name, status, durationMs}` for every tool call — including `cancelled` calls — with no database (`packages/codemode/src/types.ts:60-66`, `packages/codemode/src/runtime/execution.ts:373-380`). Combined with the deterministic `during` field (`{seq, issued}`, `packages/codemode/src/types.ts:196-201`) it is a compact, replayable ledger of what the model did. August Trading's `Message.toolEvents` is the same idea at a different granularity; the missing piece here is a *text* log — the codemode package keeps no queryable history, only the last run's.
- **Staying simple as features accumulate: this shard is the strongest evidence in the repo.** Two packages, each with a **single entry point per environment** and no framework: codemode has three sandboxes over one core (`packages/codemode/src/runtime/execution.ts:460`), and MCP has three transports over one client (`packages/mcp/src/client.ts`). Every new capability is an *implementation of an existing interface* (`VmLauncher`, `McpTransport`, `OAuthClientProvider`, `McpOAuthStateStore`) — not a new subsystem. And both packages state what they deliberately do **not** do: the MCP README lists batch JSON-RPC, legacy HTTP+SSE, servers, sampling and tasks as out of scope; the codemode README lists timers, `fetch`, `process`, `require`, modules and `WebAssembly` as absent from the VM.

---

## 4. Non-obvious decisions and gotchas

1. **A codemode result can settle while the VM is still computing.** `close()` and timeouts *request* termination; they do not wait for the worker to exit (`packages/codemode/src/runtime/host.ts:59-66`; `packages/codemode/CHANGELOG.md:1.3.0`). The README says it plainly: *"This does not guarantee computation has stopped."* Anything that counts "running work" must use `onWorkerStarted(exited)`, not the result promise.
2. **The prelude shares the built-ins with the script.** That is why the built-ins are frozen *before* the script runs (`packages/codemode/src/runtime/prelude-source.ts:36-39`, `:58-135`) — a script that patched `Array.prototype.toJSON` could otherwise corrupt what the prelude sends to the host. The freeze must be careful: a plain freeze breaks `this.name = "MyError"` in an `Error` subclass, so overridable properties became accessors that define an own property on the instance.
3. **A script cannot be *validated* against its schema — the schemas only shape the declarations** (`packages/codemode/src/types.ts:9`). Anything that must be checked has to be checked by the tool implementation.
4. **`store` writes are only reported on success.** A failed execution reports **no** `storeWrites` — and the type enforces it (the error arm of `CodemodeResult` has no such field, `packages/codemode/src/types.ts:96-107`).
5. **The codemode `tools` object is a Proxy that throws on unknown members** — but `in`, `toString` and `JSON.stringify` still work (`packages/codemode/src/runtime/prelude-source.ts:230-240`; the test pins `["echo" in tools, "nothing" in tools, String(tools.toString), JSON.stringify(tools)]`). A code path that does `tools[name]` for an optional tool will **throw**, not return `undefined`.
6. **A tool name and its identifier are two names.** `tools.my_tool` and `tools["my-tool"]` are the same function, and the *first* tool wins when two names normalize to the same identifier (`packages/codemode/src/runtime/prelude-source.ts:207-215`). The `ALL_TOOLS` list therefore contains the identifier, not the original name.
7. **The MCP client's `initialize` is not cancellable** — the spec forbids it, so no `notifications/cancelled` is sent (`packages/mcp/src/client.ts:429-441`).
8. **`close()` on the HTTP transport must not ask the auth provider for a token.** Asking could trigger a *network* refresh and delay the close; the transport reuses the last request's token (`packages/mcp/src/transports/streamable-http.ts:268-284`; #10565).
9. **A 403 with `error="insufficient_scope"` is an auth failure, not a permission denial** (`packages/mcp/src/transports/streamable-http.ts:163-168`). Treating it as fatal would break step-up authorization.
10. **The MCP transport calls `fetch` without a receiver.** On Cloudflare Workers, `this.fetch(...)` throws "Illegal invocation" (#10188, `packages/mcp/src/transports/streamable-http.ts:214-219`). Any wrapper of `fetch` must preserve the *absence* of a receiver, not just the arguments.
11. **The MCP stdio transport inherits the whole environment by default** (`inheritEnv` is opt-out, `packages/mcp/src/transports/stdio.ts:110-111`) — the opposite of the usual sandbox default.
12. **The stdio transport kills the process *group*** (negative pid), because `npx`/`uvx` wrappers would otherwise leave the real server running (`packages/mcp/src/transports/stdio.ts:31-33`); Windows uses `taskkill /T /F`.
13. **An empty OAuth `scope` is *absent*, not "no scope".** `null` and `""` are dropped at the parser, at the challenge parser, and at every `scope` selection (`packages/mcp/src/oauth/types.ts:111-113`; `packages/mcp/src/oauth/discovery.ts:31-33`; `packages/mcp/src/oauth/flow.ts:344-346`). Getting this wrong produced "Invalid scope" failures (#10266).
14. **`expires_in: null` must not mean "expired"** — `Number(null)` is 0 (`packages/mcp/src/oauth/types.ts:183-193`).
15. **An OAuth client that answers `initialize` with an *older* protocol version is accepted**; one that answers with an unknown version is refused and the client ends `closed` (`packages/mcp/src/client.ts:230-237`, `packages/mcp/test/client.test.ts`).
16. **The MCP client's list pagination treats `nextCursor: ""` and `null` as "no more pages"** and detects a repeated cursor (`packages/mcp/src/client.ts:113-115`, `:369-372`).
17. **A "sandbox bridge broken" error means the *host* failed to decode what the VM sent** — usually because the script patched a built-in (`packages/codemode/src/runtime/execution.ts:344-355`). It is reported as `kind: "sandbox"`, not `kind: "script"`, because the script did not fail.

---

## 5. Weak spots

1. **The codemode sandbox is a lot of machinery for one capability.** Three sandboxes, a remote RPC protocol, a deterministic replay mode, a prelude of ~600 lines of embedded JavaScript and a wasm loader — for a feature that is, at heart, "run this script with these tools". A reader who only wants the tool-composition idea must wade through `execution.ts` (560 lines), `vm.ts` (330) and `prelude-source.ts` (520). The *shape* is worth stealing; the size is not.
2. **The MCP OAuth subset is a fork of a moving target.** `flow.ts`, `discovery.ts` and `types.ts` carry a header saying they are "adapted from modelcontextprotocol/typescript-sdk v1.29.0" with the Zod/CORS shims removed — and the CHANGELOG is a running list of spec mismatches (#10416, #10493, #10302, #10266, #10172). Vendoring a spec means carrying its churn forever; the licence file is honest about it, but the maintenance cost is real.
3. **The deterministic replay mode is powerful but nearly untested against reality.** The suite pins the behaviour on two backends with a synthetic provider, but nothing demonstrates a *real* restart-and-replay of a long-running workflow; the fingerprint is a string, and a mismatch has no recovery story (the host can only refuse the replay). Meanwhile the `DETERMINISTIC_VERSION` counter is a manual bump that a future contributor can forget.
4. **Two of the codemode limits are silently unenforced in one direction.** `timeoutMs` does not bound a script that computes on the calling thread (the interrupt budget does, and its rate is machine-dependent — 2 s on a laptop, 10 s on Cloudflare), and the remote sandbox **cannot interrupt a computing VM at all**; it keeps running until the next tool call or until the budget is spent (`packages/codemode/src/runtime/remote.ts:33-37`). A caller reading `timeoutMs: 60_000` on the remote sandbox is misled about what it buys.
5. **`McpClient` is a single class with a broad internal surface** — ~600 lines covering connection lifecycle, request correlation, progress, roots, pagination, validation and notification fan-out (`packages/mcp/src/client.ts`). The pieces are cleanly separated *by method*, but there is no seam for a caller to reuse the pagination or the progress handling without the whole client.
6. **`renderToolOutputType` and the declaration renderer are presentation-only, but nothing enforces that** — a host can hand the model a schema that lies about a tool's result, and the only symptom is a model that mis-handles the value. The package is honest in the docs (`packages/codemode/src/types.ts:9`) but offers no runtime check.
