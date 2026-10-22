# pi :: pi-agent-env

**Files in shard:** 62 (read: 62, skipped with reason: 0)
**What this shard covers:** Two npm packages from the `pi` monorepo that together define how an agent *acts* rather than how it thinks. `packages/agent` (`@earendil-works/pi-agent-core`) is the agent runtime: the turn lifecycle, the tool-execution pipeline (validation → preflight hook → execute → postflight hook → result message), the steering/follow-up queues, and a proxy stream that lets a browser talk to an LLM through a server. `packages/env` (`@earendil-works/pi-env`) is a remote *execution environment*: a small Rust daemon (`packages/env/daemon`) that speaks a length-prefixed framed protocol over stdin/stdout and performs file, process, watch and pseudo-terminal operations on another machine, plus a TypeScript client (`Connection`, `RemoteExecutionEnv`, SSH bootstrap) that reproduces Node's exact filesystem and error semantics across the wire. Together they are the most concrete reference in this repo for **what an agent loop actually does when a tool misbehaves** and **how a tool backend stays trustworthy under loss, concurrency and partial failure**.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

---

#### `packages/agent/src/types.ts`
- **Purpose:** The public vocabulary of the agent runtime — every type a host application touches.
- **Key abstractions:** `StreamFn` (`types.ts:24`), `ToolExecutionMode` (`types.ts:47`), `QueueMode` (`types.ts:55`), `BeforeToolCallResult`/`AfterToolCallResult` (`types.ts:66`, `types.ts:92`), `AgentLoopConfig` (`types.ts:196`), `ThinkingLevel` (`types.ts:349`), `AgentState` (`types.ts:366`), `AgentToolResult` (`types.ts:424`), `AgentToolCallOutcome` (`types.ts:449`), `AgentTool` (`types.ts:466`), `AgentContext` (`types.ts:504`), `AgentEvent` (`types.ts:522`).
- **Data flow:** `AgentMessage[]` → (optional `transformContext`) → `convertToLlm` → `Message[]` → provider. Tools return `AgentToolResult` with three *separate* channels: `content` (model-facing), `details` (UI/log-facing), `structuredContent` (programmatic, not sent to the model).
- **Non-obvious design decisions:**
  - The `StreamFn` contract forbids throwing: *"Must not throw or return a rejected promise for request/model/runtime failures"* (`types.ts:30`) — failures must be *encoded in the stream* as a final message with `stopReason: "error" | "aborted"`. This makes the transport swappable and keeps the loop's error path uniform.
  - `structuredContent` is dropped automatically if `afterToolCall` replaces `content` but not `structuredContent` (`types.ts:85-89`, enforced in `agent-loop.ts:801-806`): the structured payload may no longer describe the text, so keeping it would be a lie.
  - `AgentTool.replay?: "never" | "safe"` (`types.ts:490`) — "Recovery policy for an effect whose durable intent exists but whose outcome is unknown." A tool that may have had a durable side effect (a write, an order) declares whether it is safe to replay.
  - `AgentState.systemPrompt` is **read-only** and *replayed from the transcript* (`types.ts:367-372`): the system message in the transcript is the single source of truth, not a separate field.
  - `AgentState.tools` and `.messages` are accessor properties that **copy** the assigned top-level array (`types.ts:379-381`) so an outside array cannot be mutated behind the agent's back.
- **Edge cases & failure handling:** `AfterToolCallResult` merge is field-by-field with **no deep merge** for `content`/`details`/`usage` (`types.ts:100-103`). `AgentTool.execute` may throw (the loop catches it) *or* return `isError: true` — the doc explicitly says "do not only describe the failure in `content`" (`types.ts:472-475`).
- **Surprising:** `AgentEvent` has no "error" event type. An error is an *assistant message* with `stopReason: "error"` — failures ride the normal message lifecycle, so a UI needs no separate error channel.

#### `packages/agent/src/agent-loop.ts`
- **Purpose:** The low-level turn loop: stream → tool calls → results → next turn, with hooks at every seam.
- **Key abstractions:** `agentLoop` (`agent-loop.ts:48`), `agentLoopContinue` (`agent-loop.ts:79`), `runAgentLoop` (`agent-loop.ts:113`), `runAgentLoopContinue` (`agent-loop.ts:145`), `runLoop` (`agent-loop.ts:176`), `declareToolChanges` (`agent-loop.ts:342`), `streamAssistantResponse` (`agent-loop.ts:406`), `failToolCallsFromTruncatedMessage` (`agent-loop.ts:488`), `executeToolCalls` (`agent-loop.ts:515`), `executeToolCallsSequential`/`executeToolCallsParallel` (`agent-loop.ts:535`, `agent-loop.ts:596`), `prepareToolCall` (`agent-loop.ts:718`), `runToolCall` (`agent-loop.ts:821`).
- **Data flow:** `runLoop` is an **outer** loop (follow-up queue) wrapping an **inner** loop (tool calls + steering). Each inner iteration: `prepareNextTurn` → append prepared + pending messages → `prepareRequest` → provider stream → tool batch → `finishTurn` → `turn_end` → poll steering → repeat. The outer loop then polls `getFollowUpMessages`.
- **Non-obvious design decisions:**
  - **Truncated tool calls never execute.** If the assistant message stopped with `stopReason === "length"`, *every* tool call in it is failed rather than executed (`agent-loop.ts:277-279`, `agent-loop.ts:488-522`). The reason is spelled out at `agent-loop.ts:490-494`: streamed tool-call arguments are finalized by a best-effort JSON salvage parser, so a truncated message can yield tool calls whose arguments *parse and validate* but are silently incomplete. This is a genuinely subtle bug class that most harnesses get wrong.
  - **Tool-loadout changes are announced to the model.** Before every request the loop diffs the *executable* set (`context.tools`) against the *declared* set in the transcript's system messages and injects a system message with `toolsAdded`/`toolsRemoved` (`agent-loop.ts:342-390`). If a pending system message already exists, the delta is **merged into it** and the message's own tool fields are treated as intent and *replaced* by the real delta (`agent-loop.ts:352-375`) — the executable set always wins over what the caller claimed.
  - **Parallel vs. sequential is decided per batch, not per call.** `executeToolCalls` checks whether *any* tool in the batch declares `executionMode: "sequential"`; if so the *entire* batch runs sequentially (`agent-loop.ts:515-534`). Parallel mode still **preflights sequentially** (`beforeToolCall` runs one at a time, in source order) and only then executes concurrently (`agent-loop.ts:614`).
  - **Two different orderings, deliberately.** In parallel mode `tool_execution_end` fires in *completion* order, but the persisted `toolResult` messages and `turn_end.toolResults` are in *assistant source order* (`agent-loop.ts:596-669`; pinned by `agent-loop.test.ts` "should emit tool_execution_end in completion order but persist tool results in source order"). The transcript must stay in a stable order; the UI may show things as they finish.
  - **Early termination needs unanimity.** `shouldTerminateToolBatch` returns true only if *every* finalized tool result in the batch set `terminate === true` (`agent-loop.ts:700-702`). A mixed batch continues normally — one loud tool cannot silence the others.
  - **`terminate` is runtime-only.** The hint never appears in the emitted `toolResult` message (`agent-loop.ts:869-880`); it is a loop-control hint, not protocol.
  - **Errors from `afterToolCall` become error results, not aborts** (`agent-loop.ts:806-809`) — a throwing postflight hook must not take down the batch.
  - **`runToolCall` reuses the exact model-issued pipeline** (prepare → validate → `beforeToolCall` → execute → `afterToolCall`) with no events and no messages (`agent-loop.ts:821-830`). This is what lets a *nested* tool call (a codemode script calling tools) go through the same permission checks — see `examples/mcp-codemode/tools.ts:100-129`.
- **Edge cases & failure handling:**
  - Abort is checked at every seam: after `beforeToolCall`, before execution, between parallel entries (`agent-loop.ts:742-746`, `agent-loop.ts:761-765`).
  - Tool update callbacks are *scoped to the invocation*: late `onUpdate` calls after the tool promise settles are ignored (`agent-loop.ts:878-895`, `acceptingUpdates` flag).
  - `durationMs` is measured with `performance.now()` (monotonic) and **excludes hook time** (`agent-loop.ts:867`, `types.ts:452`); a call that never ran has no `durationMs` at all.
  - `convertToLlm` and `transformContext` are contractually forbidden from throwing (`types.ts:210-214`, `types.ts:227-229`) — a throw there would interrupt the loop with no normal event sequence.
- **Surprising:** `agentLoop()`/`agentLoopContinue()` (the EventStream API) are documented as **observational only**: "They preserve event order, but they do not wait for your async event handling to settle before later producer phases continue" (README "Low-Level API"). The `Agent` class *is* the barrier version — `beforeToolCall` there sees agent state that already includes the assistant message. Two APIs with the same name and different semantics is a real trap.

#### `packages/agent/src/agent.ts`
- **Purpose:** The stateful host wrapper: owns the transcript, emits events, executes tools, manages queues.
- **Key abstractions:** `Agent` (`agent.ts:190`), `PendingMessageQueue` (`agent.ts:149`), `AgentInitialState` (`agent.ts:84`), `AgentOptions` (`agent.ts:118`), `MutableAgentState` (`agent.ts:71`).
- **Data flow:** `prompt()`/`continue()` → `runWithLifecycle` (creates an `AbortController`, marks `isStreaming`) → `runAgentLoop`/`runAgentLoopContinue` → `processEvents` (reduces state, then awaits listeners **in subscription order**).
- **Non-obvious design decisions:**
  - **Awaited listeners are part of run settlement.** `processEvents` awaits every subscriber sequentially (`agent.ts:596-601`). `agent_end` is the *last event*, but the agent is not idle until those listeners finish (`agent.ts:311-320`, `agent.ts:567-573`). `waitForIdle()` resolves after them.
  - **A thrown stream function still produces a full event sequence.** `handleRunFailure` synthesizes a failure assistant message and emits `message_start`/`message_end`/`turn_end`/`agent_end` (`agent.ts:542-558`). A UI sees the same shape whether the provider threw, aborted, or returned an error — one code path to render.
  - **Two queues with different semantics.** `steer()` interrupts mid-run (delivered after the current tool batch); `followUp()` waits until the agent would otherwise stop (`agent.ts:314-327`). Each has a `QueueMode` of `"one-at-a-time"` (default) or `"all"`.
  - **`continue()` has a documented fallback ladder**: empty/system-only transcript → reject *without consuming the queues*; assistant tail → drain one steering batch, else one follow-up batch; otherwise → continue from context (`agent.ts:393-427`).
  - **`peekQueuedMessages()` previews without consuming** (`agent.ts:339-342`) — the UI can show "what will run next" without racing the loop.
  - **`reset()` refuses during a run** (`agent.ts:364-369`) — a fix from 0.84.1, because an earlier version cleared the transcript mid-stream.
- **Edge cases & failure handling:** `prompt()`/`continue()` throw if a run is active (`agent.ts:376-381`, `agent.ts:394-397`) instead of corrupting state; the error message names the alternatives (`steer()`/`followUp()`). `abort()` is a no-op when idle.
- **Surprising:** `Agent` has **two** `prepareNextTurn` shapes: the legacy `prepareNextTurn(signal)` and `prepareNextTurnWithContext(context, signal)`; the class prefers the context form when both are set (`agent.ts:490-500`). The legacy one still receives the *abort signal*, not the next-turn context (pinned by `agent.test.ts` "keeps legacy prepareNextTurn signal callback behavior").

#### `packages/agent/src/proxy.ts`
- **Purpose:** A `StreamFn` that proxies provider calls through an app's own server, for browser clients that must not hold provider keys.
- **Key abstractions:** `streamProxy` (`proxy.ts:113`), `ProxyAssistantMessageEvent` (`proxy.ts:19`), `ProxyStreamOptions` (`proxy.ts:66`).
- **Data flow:** `POST {proxyUrl}/api/stream` with `{ model, context, options }` → newline-delimited `data: {json}` SSE-ish lines → reconstructed client-side into an `AssistantMessageEventStream`.
- **Non-obvious design decisions:**
  - **The server strips the `partial` field from delta events** to save bandwidth; the client **reconstructs** the partial assistant message itself (`proxy.ts:113-124`, `proxy.ts:253-330`). A proxying layer therefore costs the client a full re-implementation of the delta state machine.
  - **A clean EOF without a terminal event is an error, not a hang** (`proxy.ts:219-230`). The comment is explicit: "A clean EOF without a done/error event means the server dropped the response mid-stream. Surface it as an error instead of leaving consumers waiting on a result that never arrives." Pinned by `proxy.test.ts` "emits an error instead of hanging when the stream ends without a terminal event".
  - **The final event may not be newline-terminated** — the buffer is flushed after the reader finishes (`proxy.ts:211-217`); pinned by `proxy.test.ts` "processes terminal metadata when the event is not newline-terminated".
  - **Only a whitelisted subset of stream options crosses the wire** (`proxy.ts:91-110`): temperature, sampling params, maxTokens, reasoning, cacheRetention, sessionId, headers, metadata, transport, thinkingBudgets, maxRetryDelayMs. The abort signal and the auth token are *not* in it.
- **Edge cases & failure handling:** abort cancels the reader (`proxy.ts:137-142`); a non-OK HTTP response tries to parse `{ error }` from the body and falls back to status text (`proxy.ts:148-161`); `text_delta` for a non-text content block throws (`proxy.ts:264-266`).

#### `packages/agent/src/stream-fn.ts`
- **Purpose:** A process-global fallback `StreamFn` so a host can inject a model runtime without `pi-agent-core` depending on a provider catalog.
- **Key abstractions:** `setDefaultStreamFn` (`stream-fn.ts:11`), `getDefaultStreamFn` (`stream-fn.ts:15`).
- **Data flow:** Module-level `defaultStreamFn`; `getDefaultStreamFn()` throws a named error if unset (`stream-fn.ts:17`).
- **Non-obvious design decision:** This exists so that "Hosts that provide a default model runtime can install its stream function here without making pi-agent-core depend on a provider catalog or compatibility layer" (`stream-fn.ts:6-9`). It is a *dependency-inversion* seam: the agent package has zero knowledge of providers.
- **Edge cases:** `Agent` tolerates `options` being `undefined` for older compiled consumers (`agent.ts:250-252`) and then falls back to the default (`agent.ts:257`). Pinned by `agent.test.ts` "uses the configured default when a legacy caller omits streamFn" and `agent-loop.test.ts` "default stream function compatibility".

#### `packages/agent/src/index.ts`
- **Purpose:** The package barrel.
- **Key abstractions:** re-exports `agent.ts`, `agent-loop.ts`, `proxy.ts`, `types.ts`, plus `setDefaultStreamFn`.
- **Data flow / non-obvious:** `.ts` extensions in the import specifiers (`index.ts:1-5`) — the package targets Node's strip-only TypeScript support, so the published JS keeps the `.ts` specifiers.

---

#### `packages/env/src/connection.ts`
- **Purpose:** The client half of the pi-env wire protocol: frame a request, spawn/keep the daemon alive, decode replies.
- **Key abstractions:** `Connection` (`connection.ts:178`), `RemoteError` (`connection.ts:22`), `RemoteInfo` (`connection.ts:38`), `nodePlatform` (`connection.ts:57`), `isConnectionLost` (`connection.ts:126`), `Reply`/`RequestOptions` (`connection.ts:76`, `connection.ts:83`).
- **Data flow:** `request(op, json, options)` → frame (13-byte header + JSON + payload) → child stdin → `#onData` reassembles frames → `#dispatch` resolves the pending promise or routes `EVENT` frames to `onEvent`. One `Session` per spawned daemon; each `Session` has a monotonically increasing id.
- **Non-obvious design decisions:**
  - **The daemon prints a sync line before any frame.** Shell startup files may write to stdout, so the client's first act is to scan for `PI-ENV <token>\n` and discard everything before it (`connection.ts:340-350`); noise before it is forwarded to `onLog`. The token is per-session random (`connection.ts:275`).
  - **A failed start is not remembered.** `#connect` clears `#ready` on rejection so "the next request tries again" (`connection.ts:227-239`); the comment in `ssh.ts:522-528` says the same. A transient network failure does not poison the connection object.
  - **The `command` option may be a function**, computed at each start — that is how SSH detection+deployment happens lazily, and why its failure is that *operation's* error (`connection.ts:66-72`).
  - **Handles are session-scoped.** A request can pass `session` (`connection.ts:96`); if the session is gone the request fails with `lost` rather than reaching a *new* daemon that never opened the handle (`connection.ts:203-209`). Pinned by `remote.test.ts` "fails requests on handles of a lost connection instead of reaching the new daemon".
  - **Payloads are copied, not views.** `new Uint8Array(body.subarray(...))` (`connection.ts:379`) — the comment says "like `NodeExecutionEnv`'s reader results, not a view of the receive buffer", because the buffer is reused.
  - **Two liveness limits**: the client pings every 5 s and tears down after 30 s of silence (`connection.ts:15`, `connection.ts:302-306`); start-up has a separate 60 s budget (`connection.ts:17`, `connection.ts:285-291`).
  - **A corrupt frame kills the connection** rather than being skipped (`connection.ts:355-360`, `connection.ts:369-376`): "framing errors end the connection" (protocol.md).
- **Edge cases & failure handling:** abort sends a `cancel` frame but the request still settles with the daemon's result (`connection.ts:249`); `child.stdin.on("error")` is swallowed so a dead pipe does not crash the process (`connection.ts:300`); `session.timer.unref()` keeps the timer from holding the event loop open (`connection.ts:307`).

#### `packages/env/src/remote-env.ts`
- **Purpose:** `ExecutionEnv` implemented on top of a `Connection`: reads, writes, listings, exec, watch — with Node's exact semantics.
- **Key abstractions:** `RemoteExecutionEnv` (`remote-env.ts:352`), `Handle` (`remote-env.ts:139`), `RemoteBinaryReader` (`remote-env.ts:157`), `RemoteDirReader` (`remote-env.ts:229`), `RemoteTextLineReader` (`remote-env.ts:288`), `remotePath` (`remote-env.ts:72`), `readRange` (`remote-env.ts:96`).
- **Data flow:** every method resolves the path with the *remote* system's rules, checks the abort signal, issues one or more daemon requests, and maps the daemon's `RemoteError` to a `FileError` through `toFileError`.
- **Non-obvious design decisions:**
  - **The client owns semantics; the daemon owns syscalls.** `docs/semantics.md` has a "Split of work" table that assigns path resolution, abort checkpoints, error-code mapping, read sizes and decoding to the *client*, and only system calls to the daemon. This is the single most transferable idea in the shard: the remote half stays dumb and small.
  - **Path resolution mirrors Node exactly, including Windows drive-relative paths.** `#resolve` (`remote-env.ts:398-427`) handles `~`, `~/…`, `file://` URLs, and the exotic Windows case: a drive-relative path on *another* drive resolves against that drive's `=D:` working directory from `hello.driveCwds`, falling back to the drive root.
  - **Pipelined reads with a fixed depth.** `readRange` keeps up to `READ_DEPTH = 8` reads of 256 KiB in flight (`remote-env.ts:39-40`, `remote-env.ts:96-137`); on a short read it *discards the in-flight queue* and restarts from the true end (`remote-env.ts:122-128`) — a subtle correctness detail that prevents reading garbage past EOF.
  - **Writes are chunked and abort-checked per chunk, and a failed chunk poisons the handle.** The client writes 512 KiB chunks (`remote-env.ts:42`), the daemon serialises chunk writes per handle (`main.rs:378-402`) and marks the handle `failed` so later chunks get `EBADF` rather than leaving a gap (`main.rs:203-212`). The client then reports "the file has no gaps" (`remote-env.ts:612-618`).
  - **`appendFile` deliberately does *not* check the abort between chunks** (`remote-env.ts:594`) — matching Node's `appendFile`, per `docs/semantics.md`.
  - **The callback's exception is the exec's error.** If `onOutput` throws, the client aborts the command and surfaces `callback_error` (`remote-env.ts:908-920`). A UI bug cannot silently swallow a command.
  - **`cleanup()` kills without aborting** (`remote-env.ts:950-954`), so the command settles with its *killed* status (exit 137) rather than `aborted` — a different, distinguishable outcome.
- **Edge cases & failure handling:** `exists()` maps `not_found` to `false` and re-raises everything else (`remote-env.ts:679-685`); `listDir` throws if *any* entry cannot be lstat'ed, matching Node (`remote-env.ts:643-650`), while `openDirReader` *skips* entries removed between enumeration and lstat (`remote-env.ts:270-276`); `readTextFile` refuses a file > 2 GiB with a named error (`remote-env.ts:466-470`); timeouts are validated before the request (`remote-env.ts:838-847`).

#### `packages/env/src/ssh.ts`
- **Purpose:** SSH bootstrap: detect the remote system, deploy a verified daemon, connect — with a strict host-key policy.
- **Key abstractions:** `SshTarget` (`ssh.ts:24`), `sshArguments` (`ssh.ts:77`), `scanHostKey` (`ssh.ts:182`), `acceptHostKey` (`ssh.ts:258`), `forgetHostKey` (`ssh.ts:281`), `deployDaemon` (`ssh.ts:405`), `detectPlatform` (`ssh.ts:333`), `connectSsh` (`ssh.ts:534`), `sshConnection` (`ssh.ts:513`), `HostKeyUnknownError`/`HostKeyChangedError` (`ssh.ts:41`, `ssh.ts:43`), `SshError` (`ssh.ts:46`).
- **Data flow:** `Connection.command` is a closure that, on each start: detects the platform (once, cached in `state.remote`) → verifies/deploys the daemon → returns `["ssh", ...sshArguments(target), launchCommand(...)]`.
- **Non-obvious design decisions:**
  - **The daemon is named by its SHA-256.** `daemonPath` (`ssh.ts:394-400`) embeds the first 32 hex chars of the digest, so two versions never collide and a stale binary is never mistaken for the current one. The file is **re-verified by hash before every start** (`ssh.ts:405-418`, `ssh.ts:459-467`), and a tampered file is replaced (`ssh.test.ts` "reuses a verified daemon and replaces a tampered one").
  - **The upload is atomic and hash-checked.** POSIX: write to `mktemp`, verify hash, `mv -f` into place (`ssh.ts:469-492`). Windows: base64 over stdin (because "Windows' sshd may never pass on the end of stdin", `ssh.ts:436`), decode, verify hash, then a **retry loop** on `Move-Item` because "a running daemon or a virus scanner can hold the old file for a moment" (`ssh.ts:445`).
  - **A remote without a hash tool is a hard error**, not a bypass: `nohash` → "has no sha256sum, shasum or openssl to verify pi-env" (`ssh.ts:414-416`).
  - **Host-key policy is maximally strict and explicit**: `BatchMode=yes`, `ClearAllForwardings=yes`, `ForwardAgent=no`, `ForwardX11=no`, `ControlMaster=no`, `RemoteCommand=none`, `SendEnv=-*` (no locale forwarding), `StrictHostKeyChecking=yes`, `GlobalKnownHostsFile=none`, `HashKnownHosts=no`, and a fixed `HostKeyAlias` independent of aliases/ports/jump hosts (`ssh.ts:77-128`). The alias is what makes the trust store work across `~/.ssh/config` aliases.
  - **A changed host key is never accepted automatically.** `acceptHostKey` throws `HostKeyChangedError` if a trusted key of the same type differs (`ssh.ts:270-273`); `forgetHostKey` must be called first. Pinned by `ssh.test.ts` "accepts only host keys for the alias and never replaces a trusted key silently".
  - **`acceptHostKey` only accepts plain lines for the alias.** `parseHostKeyLine` (`ssh.ts:216-232`) rejects markers (`@cert-authority`), patterns and hashed names by regex.
  - **Known-hosts writes are serialised per file and atomic.** `knownHostsChanges` holds a promise chain per file; the new content goes to a `.tmp` file and is `rename`d into place (`ssh.ts:225-251`).
  - **Detection has three fallbacks**: POSIX `uname` probe → PowerShell probe (cmd.exe as the remote shell) → a second PowerShell probe when the POSIX probe reveals Git Bash (`ssh.ts:320-341`).
  - **Termux gets actionable warnings**, not just a failure: missing `TMPDIR`, missing `termux-exec` (`LD_PRELOAD`), and "run termux-wake-lock to keep the connection alive" (`ssh.ts:309-317`).
- **Edge cases & failure handling:** every `ssh` invocation has a timeout (60 s default, 300 s for uploads) that kills the child and rejects with the stderr diagnostics (`ssh.ts:130-152`); SSH stderr is pattern-matched to map failures onto `HostKeyChangedError` / `HostKeyUnknownError` / `SshError` (`ssh.ts:158-171`); `checkField` rejects an option value that starts with `-` or contains whitespace/control characters (`ssh.ts:65-70`) — argument-injection defence.

#### `packages/env/src/watch.ts`
- **Purpose:** The client half of the file watcher: open the daemon's watcher, feed changes to the callback, survive connection loss.
- **Key abstractions:** `RemoteWatcher` (`watch.ts:23`), `RemoteWatchOptions` (`watch.ts:9`).
- **Data flow:** `RemoteWatcher.open` → `connection.request("watch", …)` → daemon events `ready` / `change` / `error` → `#deliver`.
- **Non-obvious design decisions:**
  - **A lost connection is a `overflow`, not a silent gap.** `#reconnect` (`watch.ts:133-155`) re-opens the watcher with exponential backoff (1 s → 30 s) and, on success, delivers `{ overflow: true }` — the consumer is told *changes were missed*, not handed a false "all caught up". The doc comment at `watch.ts:19-21` says exactly this.
  - **A throwing callback must not stop watching.** `#deliver` swallows the callback's exception (`watch.ts:78-85`).
  - **`ready` resolves the open promise; the mode is learned from the daemon** (`watch.ts:96-99`). The daemon decides native vs. polling (Windows and unreliable filesystems poll), and the client just reflects it.
  - **`error` is terminal**: after an `error` event the watcher sets `#closed` and delivers one final error (`watch.ts:105-109`).
- **Edge cases & failure handling:** `close()` is idempotent, wakes the backoff timer and aborts the request (`watch.ts:70-75`); a `close()` during a backoff sleep is honoured because `#wake` resolves the timer (`watch.ts:136-143`).

#### `packages/env/src/list-files.ts`
- **Purpose:** The `listFiles` operation and `LocalExecutionEnv` — a local env that lists files with the *same* code as the remote one.
- **Key abstractions:** `listFilesOver` (`list-files.ts:20`), `LocalExecutionEnv` (`list-files.ts:76`).
- **Data flow:** validate options → check `hello.features` → request `listFiles` → decode the compact payload (kind byte + path + NUL) into `FileListEntry[]`.
- **Non-obvious design decisions:**
  - **The payload is a compact binary encoding, not JSON** — one byte of kind, the relative path, a NUL (`list-files.ts:44-52`). 50 000 entries fit in 4 MiB.
  - **Feature negotiation, not version negotiation.** The client checks `connection.info().features?.includes("listFiles")` and returns `not_supported` for an older daemon (`list-files.ts:33-36`). Pinned by `remote.test.ts` "reports listFiles as not supported by daemons released before it" using the `old-daemon.ts` stand-in.
  - **`LocalExecutionEnv` extends `NodeExecutionEnv`** and only overrides `listFiles` (`list-files.ts:78-104`) — local and remote environments then share one listing implementation, so a bug cannot exist in one and not the other.

#### `packages/env/src/terminal.ts`
- **Purpose:** A remote pseudo-terminal: raw bytes out, keystrokes in, resize, foreground job, exit code.
- **Key abstractions:** `RemoteTerminal` (`terminal.ts:26`), `openTerminal` (`terminal.ts:107`), `TerminalOptions` (`terminal.ts:8`).
- **Data flow:** `openTerminal` issues a `pty` request; `onStart` captures the request id + session; `onEvent` receives `started` (resolve the open promise with the `RemoteTerminal`) and `output` (raw bytes to the caller).
- **Non-obvious design decisions:**
  - **The terminal's identity is the *request id*, not a separate handle.** `ptyWrite`/`ptyResize`/`ptyForeground` address the running `pty` request by its id (`terminal.ts:57`, `terminal.ts:72`, `terminal.ts:88`). This removes a whole class of handle-lifetime bugs.
  - **Input is chunked at 1 MiB** because frames are capped at 16 MiB (`terminal.ts:4`, `terminal.ts:60-66`).
  - **Fire-and-forget writes.** `#request` swallows failures (`terminal.ts:97-101`): "A terminal that ended or a lost connection: `exited` reports it." The failure channel is the `exited` promise, not the write.
  - **`exited` carries the error.** `exited.catch(started.reject)` means a failure *before* the terminal started rejects the open, and a failure *after* rejects `exited` (`terminal.ts:120-128`).
- **Edge cases & failure handling:** `close()` aborts the request, which kills the process group server-side (`terminal.ts:76-78`); `foreground()` after the terminal ended rejects with `EBADF` (pinned by `terminal.test.ts`).

#### `packages/env/src/errors.ts`
- **Purpose:** The single error-mapping table from Node codes to `FileError` codes.
- **Key abstractions:** `toFileError` (`errors.ts:9`), `abortResult` (`errors.ts:5`).
- **Data flow:** any thrown value → `FileError` with a stable code.
- **Non-obvious design decision:** The mapping is *exactly* `NodeExecutionEnv`'s (`ENOENT → not_found`, `EACCES/EPERM → permission_denied`, `ENOTDIR → not_directory`, `EISDIR → is_directory`, `EINVAL/SYMLINK/NOT_REGULAR → invalid`, everything else → `unknown`) (`errors.ts:19-36`). One table means the remote env and the local env fail the same way.
- **Edge cases:** a non-`RemoteError` becomes `unknown` with the original message and the original as `cause` (`errors.ts:10-14`); `abortResult` produces `aborted` with the path (`errors.ts:5-7`).

#### `packages/env/src/index.ts`
- **Purpose:** The package barrel.
- **Key abstractions:** re-exports `Connection`, `RemoteExecutionEnv`, `LocalExecutionEnv`, the SSH bootstrap functions, `openTerminal`, `RemoteWatcher`.
- **Data flow / non-obvious:** the public surface is deliberately small — 4 groups: connection, environments, SSH, terminal/watch.

---

#### `packages/env/daemon/src/main.rs`
- **Purpose:** The daemon's server: frame loop, request dispatch, handle table, worker pool, liveness.
- **Key abstractions:** `Server` (`main.rs:74`), `FileHandle`/`DirHandle`/`Handle` (`main.rs:47`, `main.rs:62`, `main.rs:68`), `Control` (from `exec.rs`), `serve_frames` (`main.rs:404`), `serve` (`main.rs:465`).
- **Data flow:** stdin → `frame::read_frame` → dispatch. File ops go to a **16-thread worker pool** (`main.rs:41`, `main.rs:344-360`); `exec`, `pty` and `watch` get their **own thread with a 16 MiB stack** (`main.rs:432-441`).
- **Non-obvious design decisions:**
  - **Control replies jump the queue; bulk output does not.** `Output` keeps two queues; `control` frames (results, errors, pings, watch events) are always written before queued bulk output (`output.rs:34-48`, `main.rs:368-373`). *Exception:* an `exec`/`pty` result is deliberately put on the bulk queue so the result follows its own output, and a reply with a payload > 64 KiB also queues behind output ("a slow link delays bulk data, not replies") (`main.rs:45`, `main.rs:368-373`).
  - **The cancel is registered before the request runs.** `server.controls.insert(id, control)` happens *before* dispatch (`main.rs:428-431`): "Registered before the request runs, so a cancel right behind it is not lost." The protocol doc makes the same promise (`docs/protocol.md`, "Cancellation").
  - **`ptyWrite`/`ptyResize`/`ptyForeground` are answered on the frame-reading thread**, not the pool ("through the worker pool, two writes could swap", `main.rs:414-428`) — keystrokes must arrive in order.
  - **Chunk writes to one handle are serialised** by `run_in_order` (`main.rs:378-402`), and a failed chunk poisons the handle (`main.rs:203-212`).
  - **Handle count is capped at 4096** with `EMFILE` (`main.rs:43`, `main.rs:115-121`).
  - **30 seconds of client silence kills every process group and exits** (`main.rs:38`, `main.rs:496-509`): "A client that went silent (a phone that lost its network) leaves nothing running." The same `kill_all` runs when stdin ends (`main.rs:512`).
  - **Feature negotiation is a first-class protocol field**: `FEATURES: &[&str] = &["listFiles"]` reported in `hello` (`main.rs:33-34`, `main.rs:159`).
  - **`hello` reports the things a client cannot guess**: `os`, `arch`, `home`, `separator`, `tmpdir`, `cwd`, `driveCwds` (Windows' `=C:` variables), `pid`, `version` (`main.rs:146-161`).
- **Edge cases & failure handling:** unparseable JSON leaves the framing intact and produces an `EINVAL` reply (`frame.rs:79-84`); a failed thread spawn returns `spawn_error` (`main.rs:437-445`); `read_dir` locks only *its* directory so a slow listing does not hold up other requests (`main.rs:270-275`).

#### `packages/env/daemon/src/frame.rs`
- **Purpose:** The wire framing: `u32 length | u8 type | u32 id | u32 jsonLength | json | payload`, big-endian.
- **Key abstractions:** `Frame` (`frame.rs:22`), `read_frame` (`frame.rs:47`), `write_frame` (`frame.rs:84`), `MAX_FRAME`/`MAX_PAYLOAD` (`frame.rs:15-17`).
- **Data flow:** stdin bytes → frames; frames → dispatch.
- **Non-obvious design decisions:** a frame is capped at 16 MiB (`frame.rs:15`) and the *payload* cap leaves 64 KiB for JSON (`frame.rs:17`); a length outside `9..=MAX_FRAME` is a framing error that ends the connection (`frame.rs:62-64`); **unparseable JSON is not a framing error** — the frame arrives with `Value::Null` and gets an `EINVAL` reply (`frame.rs:79-84`), so one bad request does not kill the session.
- **Edge cases:** a clean EOF returns `None` (`frame.rs:58`); `9 + jsonLength > length` is rejected (`frame.rs:70-72`); a frame that is too large to write is refused (`frame.rs:91-93`).

#### `packages/env/daemon/src/output.rs`
- **Purpose:** The single writer of stdout, with two queues so control frames are never stuck behind bulk output.
- **Key abstractions:** `Output` (`output.rs:26`), `control` (`output.rs:34`), `bulk` (`output.rs:41`), `wait_for_room` (`output.rs:51`), `run` (`output.rs:66`).
- **Data flow:** producers → two deques → one writer thread → stdout.
- **Non-obvious design decisions:**
  - **`wait_for_room` applies backpressure of 4 MiB** to *unwindowed* command output (`output.rs:14`, `output.rs:51-61`), "which slows the command down like a full pipe would". The `stop` flag lets an aborted command escape the wait.
  - **The bulk counter is per-sender**, passed as an `Arc<AtomicUsize>` (`output.rs:41-48`), so one slow producer does not gate the others.
- **Edge cases:** a write failure closes the output queue and ends the writer (`output.rs:84-88`); `close()` wakes both condvars (`output.rs:63-68`).

#### `packages/env/daemon/src/exec.rs`
- **Purpose:** Run a shell command or an argv program; stream its output; enforce timeout/abort; spill to a file.
- **Key abstractions:** `run` (`exec.rs:239`), `Control` (`exec.rs:40`), `Message` (`exec.rs:29`), `ExecRequest` (`exec.rs:69`), `Spill` (`exec.rs:130`), `Groups` (`exec.rs:25`), `kill_group` (`exec.rs:110`).
- **Data flow:** spawn → two reader threads (stdout/stderr) → decode → `output` events → wait for exit → settle with `{ exitCode }` or an error.
- **Non-obvious design decisions:**
  - **Two reader threads, two independent decoders** (`exec.rs:352`, `exec.rs:398-401`), because stdout and stderr are separate pipes and their interleaving is not fixed. The differential test asserts exactly this ("stdout and stderr are separate pipes, read concurrently: their order relative to each other is not fixed").
  - **Output is still collected for 100 ms after the process exits** (`EXIT_STDIO_GRACE`, `exec.rs:21`, `exec.rs:417-423`), because a descendant may still be writing; a descendant holding the pipes open forever cannot stall the command.
  - **Abort ≠ kill.** `Cancel` → the command settles as `aborted`; `Kill` → it settles with the *killed process's* exit status (137) (`exec.rs:40-56`, `exec.rs:433-438`). Two different outcomes for two different intents, and the client can tell them apart.
  - **The timeout stays armed during the grace period** — "Node's timer stays armed until the command settles" (`exec.rs:394-398`).
  - **Spill is a whole-file write, not a tail.** Once the output crosses `afterBytes`/`afterLines`, the *complete* raw output goes to `pi-output-<uuid>.log` in a fresh `tmp-` directory (`exec.rs:167-186`). A prefix is buffered in memory until the threshold trips.
  - **Every command gets a new session, default signal dispositions and an empty signal mask** (`sys/unix.rs:230-249`), so a kill reaches every descendant.
- **Edge cases & failure handling:** the working directory must exist or the command fails with `spawn_error` (`exec.rs:296-305`); a `spawn_error` from the wait is reported separately (`exec.rs:459-463`); the reader threads are interrupted and the pipes closed when the command settles (`exec.rs:443-447`); a spill failure kills the command and surfaces as `unknown` with the message "Failed to preserve complete shell output" (`exec.rs:437-441`, `exec.rs:451-456`).

#### `packages/env/daemon/src/window.rs`
- **Purpose:** The output window: coalesce, pace and bound command output, replacing what falls outside the window with exact counts.
- **Key abstractions:** `Window` (`window.rs:7`), `Pending` (`window.rs:44`), `Event` (`window.rs:34`), `Skipped` (`window.rs:27`).
- **Data flow:** decoded text → `Pending::push` (accumulate) → `Pending::take` (deliver events).
- **Non-obvious design decisions:**
  - **The window is a *tail* guarantee, not a byte counter.** `trim` (`window.rs:103-166`) removes only the *longest prefix* whose removal still leaves more than `max_bytes`/`maxLines`; what remains is provably outside the window. The skipped text is replaced by `{ bytes, newlines, endsWithNewline }` — counts, not a placeholder string. The client's tail is therefore *always* the true end of the output.
  - **Delivery is paced by the caller's own rate**: `next_send = now + max(minInterval, delivered/min(window.maxBytes)/bytesPerSecond)` (`window.rs:167-176`).
  - **Trimming is amortised**: it only runs once more than 4 windows have accumulated (`window.rs:95-100`).
  - **Stream boundaries are preserved** when no skip occurred (`window.rs:186-196`); after a skip the text is merged into one event.
- **Edge cases:** character-boundary-safe trimming (`window.rs:135-140`); line-based trimming starts at a newline of the segment (`window.rs:143-152`); `bytes_per_second` is floored at 1.0 to avoid a division by zero (`window.rs:25`).

#### `packages/env/daemon/src/watch.rs`
- **Purpose:** A port of Durable's `NodeFileWatcher` that runs *next to the files*, so a scan costs no round trips.
- **Key abstractions:** `FileWatcher` (`watch.rs:231`), `Snapshot`/`Entry` (`watch.rs:74`, `watch.rs:60`), `Mode` (`watch.rs:83`), `Target` (`watch.rs:48`), `Scan` (`watch.rs:210`), `Installed` (`watch.rs:225`).
- **Data flow:** scan → snapshot → (native event | poll tick) → debounced rescan → diff → `change` event.
- **Non-obvious design decisions:**
  - **Native events only *trigger* a rescan.** The reported change set is the **difference between snapshots** plus the event paths (`watch.rs:2-3`, `watch.rs:463-476`). The event stream is a hint; the snapshot is the truth. This is what makes the watcher correct across inotify/FSEvents/Windows.
  - **The mode is chosen from the file system, not from the OS alone.** A table of 12 Linux `statfs` magics (NFS, SMB, CIFS, FUSE, 9P, Lustre, GPFS, Ceph, OpenAFS, kAFS, sdcardfs) forces polling (`watch.rs:35-48`, `watch.rs:184-205`), because those file systems accept a watch but do not report changes made elsewhere. Windows polls too (rename is blocked by open watched directories, `watch.rs:700-704`).
  - **Running out of watches switches to polling *and says so***: `switch_to_polling` (`watch.rs:576-582`) emits `{ kind: "change", overflow: true, mode: "polling" }`. The consumer is told its coverage degraded.
  - **A watched directory that is replaced is detected by identity** (`dev`/`ino`), not by path — a watcher follows the directory it was installed on (`watch.rs:490-506`).
  - **Polling mode compares recently modified small files by content hash** (`watch.rs:262-281`, `HASH_MAX_BYTES = 256 KiB`, `HASH_RECENT = 5 s`), because a same-second mtime change would otherwise be invisible.
  - **The event path is reported in the spelling of the watched path**, not the canonical one (`watch.rs:594-609`), so `/private/var` (FSEvents) becomes `/var`.
  - **Paths are sorted like JavaScript** (`sort_like_javascript`, `watch.rs:155-159`) — by UTF-16 code units, because the reference is Node.
  - **A budget on the number of directories** (`maxDirectories`, default 10 000) with a clear error ("Watched paths exceed N directories", `watch.rs:95-103`).
  - **Reads are not events** (`EventKind::Access` is ignored, `watch.rs:651-655`).
- **Edge cases & failure handling:** an unreadable *target* fails the request; an unreadable directory *below* the target is skipped (`watch.rs:305-317`); a missing target is watched for its creation (`watch.rs:375-385`); a rescan failure sends a terminal `error` event with `permission_denied` or `invalid` (`watch.rs:98-107`); macOS gets a 500 ms settle window after installing watchers because FSEvents streams go live late (`watch.rs:24`, `watch.rs:447`).

#### `packages/env/daemon/src/list.rs`
- **Purpose:** `listFiles` — a bounded, cancellable, gitignore-aware tree listing, as `fd --hidden --exclude .git` would list it.
- **Key abstractions:** `Options` (`list.rs:18`), `Listing` (`list.rs:63`), `list` (`list.rs:95`), `run` (`list.rs:176`).
- **Data flow:** `WalkBuilder` (the `ignore` crate, the one fd and ripgrep use) → per-entry records → a compact payload.
- **Non-obvious design decisions:**
  - **Three independent bounds**, each with a default: `maxEntries` 50 000, `maxBytes` 4 MiB (clamped to the frame payload limit), `timeoutMs` 10 000 (`list.rs:13-15`, `list.rs:53-55`). The first bound hit sets `truncated: true` and stops.
  - **The listing is checked for abort between entries** (`list.rs:126-128`), so a cancel stops a huge walk promptly (`remote.test.ts` "cancels a listing in the daemon" cancels 10 100 files).
  - **`.git` and the caller's `exclude` names are skipped with everything below them** (`list.rs:121-125`).
  - **The `ignore` crate's `require_git(true)`** means gitignore rules apply only inside a work tree — outside one, nothing is ignored (`list.rs:116`), and the unit test proves it (`list.rs:250-252`).
  - **Records are `kind byte + relative path + NUL`** (`list.rs:165-169`), and siblings come in byte order of their names (`sort_by_file_name`, `list.rs:120`).
  - **Non-UTF-8 names get replacement characters** in the listing (`relative`, `list.rs:74-91`).
- **Edge cases:** a missing root is `ENOENT`, a file root is `ENOTDIR` (`list.rs:96-108`); symlinks are listed but never followed (`list.rs:112-121`); entries that cannot be read are skipped, not fatal (`list.rs:130`).

#### `packages/env/daemon/src/fs.rs`
- **Purpose:** File operations with Node's semantics where Rust's std differs.
- **Key abstractions:** `info` (`fs.rs:16`), `mkdir_recursive` (`fs.rs:64`), `write` (`fs.rs:111`), `rm` (`fs.rs:156`), `open_reader` (`fs.rs:181`), `pread` (`fs.rs:203`), `read` (`fs.rs:220`), `dir_entry` (`fs.rs:245`).
- **Data flow:** request JSON → a Node-shaped `info` record → JSON reply.
- **Non-obvious design decisions:**
  - **Recursive `mkdir` is hand-written** to match Node exactly: an existing directory is fine, an existing file is `EEXIST`, a file in the way of a parent is `ENOTDIR` (`fs.rs:64-101`). Rust's `create_dir_all` differs.
  - **`rm` distinguishes directory-vs-file**: a directory without `recursive` fails with `ERR_FS_EISDIR` (`fs.rs:168-174`); `force` swallows only a *missing* path (`fs.rs:159-162`).
  - **`fsync` checks for a directory first**, because POSIX refuses to open a directory for writing and Windows does not (`fs.rs:135-146`).
  - **A directory entry's name is decoded as UTF-8 and then lstat'ed under that decoded name**, so a non-UTF-8 name reports `ENOENT` exactly as Node does (`fs.rs:245-259`); `raw` carries the original bytes for sorting (`fs.rs:261-263`).
  - **`pread` loops on `EINTR`** and stops at EOF (`fs.rs:203-218`); `read` is a *single* read call, "as Node's `readFile` makes for files of unknown size (FIFOs, devices)" (`fs.rs:220-233`).
- **Edge cases:** `open_reader` refuses a directory with `EISDIR` and a non-regular file with `NOT_REGULAR` (`fs.rs:181-201`).

#### `packages/env/daemon/src/errors.rs`
- **Purpose:** Node-shaped errors: a code (`ENOENT`, `EISDIR`, …) plus a diagnostic message.
- **Key abstractions:** `Failure` (`errors.rs:9`), `Failure::io`/`io_between` (`errors.rs:44`, `errors.rs:52`), `to_json` (`errors.rs:88`), `describe` (`errors.rs:107`).
- **Data flow:** an `io::Error` + syscall + path → a `Failure` → JSON `{ code, message, syscall?, path?, …extra }`.
- **Non-obvious design decisions:**
  - **The message format is Node's**, verbatim: `CODE: description, syscall 'from' -> 'to'` (`errors.rs:60-70`), with libuv's `uv_strerror` table inlined (`errors.rs:107-136`). A client that shows the message shows what Node would have shown.
  - **`code` is the contract; `message` is diagnostic** (protocol.md: "Messages are diagnostic; only codes are part of the contract"). The `Failure` type enforces that split: `code` is a plain field, the message is built from it.
  - **`extra` carries extra JSON fields** such as `spillPath` (`errors.rs:39-42`, `errors.rs:92-96`).
- **Edge cases:** an unknown OS error falls back to the OS text, lowercased, with Rust's `(os error N)` suffix stripped (`errors.rs:54-60`).

#### `packages/env/daemon/src/decode.rs`
- **Purpose:** WHATWG UTF-8 decoding that matches Node's `TextDecoder` when the input arrives in pieces.
- **Key abstractions:** `StreamDecoder` (`decode.rs:13`), `range_decoder` (`decode.rs:26`), `starts_with_bom` (`decode.rs:41`).
- **Data flow:** raw bytes → `decode(bytes, last)` → text, holding back an incomplete character.
- **Non-obvious design decisions:**
  - **`new_decoder_with_bom_removal()`, not `new_decoder()`** — the latter would sniff a UTF-16 BOM and *switch encodings* (`decode.rs:18-21`). Node does not do that; the comment says so.
  - **A range decoder has no BOM handling at all** (`decode.rs:26-29`), because a byte range that does not start at the beginning of the input must not eat a BOM.
  - **Invalid sequences become U+FFFD by the maximal-subpart rule** — the same as Node's decoder (`decode.rs:3-5`), with unit tests pinning the boundary cases (`decode.rs:47-80`).

#### `packages/env/daemon/src/scan.rs`
- **Purpose:** A port of Durable's `LineScanner`: locate lines `[start_line, end_line)` and measure their decoded UTF-8 size.
- **Key abstractions:** `LineScanner` (`scan.rs:14`), `push` (`scan.rs:57`), `finish` (`scan.rs:113`).
- **Data flow:** chunks → the scanner tracks byte offsets and newline counts → a `LineScan` JSON record.
- **Non-obvious design decisions:**
  - **The first three bytes are buffered separately** to detect a BOM without decoding it as text (`head`, `scan.rs:29`, `scan.rs:57-72`).
  - **Two decoders run in parallel**: one for the whole selection, one for the first line only (`scan.rs:31-32`), because the result needs both `selectedBytes` and `firstLineBytes`.
  - **`selectedBytes` is the *decoded* length**, i.e. what `new TextDecoder().decode(file)` would produce — not the byte count (`scan.rs:18-19`, `scan.rs:145-152`).
  - **The selection ends at the last selected line**, and a selection reaching past the last line ends with the last line (`scan.rs:139-142`).

#### `packages/env/daemon/src/sys/mod.rs`
- **Purpose:** The OS seam: error names, positional reads, tmpdir, opening, spawning, killing.
- **Key abstractions:** `ShellConfig` (`sys/mod.rs:15`), `OpenMode` (`sys/mod.rs:26`), `Synthetic` (`sys/mod.rs:40`), `synthetic` (`sys/mod.rs:48`), `error_name` (`sys/mod.rs:54`), `path_exists` (`sys/mod.rs:60`), `random_bytes` (`sys/mod.rs:66`), `cwd` (`sys/mod.rs:78`).
- **Data flow:** one platform module is compiled in (`unix` or `windows`) and re-exported (`sys/mod.rs:4-13`).
- **Non-obvious design decisions:**
  - **`Synthetic` is a first-class error kind** (`sys/mod.rs:36-52`): some Node error codes have no OS equivalent (`ENOTDIR` from a recursive `mkdir` through a file, `EISDIR` when Windows creates a file where a directory exists). `error_name` downcasts to it first (`sys/mod.rs:54-61`).
  - **`random_bytes` is explicitly "not for secrets"** (`sys/mod.rs:65-66`) — it is a counter+time hash, not a CSPRNG.

#### `packages/env/daemon/src/sys/unix.rs`
- **Purpose:** Linux, macOS and Android behaviour.
- **Key abstractions:** `os_error_name` (`sys/unix.rs:17`), `tmpdir` (`sys/unix.rs:78`), `mkdtemp` (`sys/unix.rs:98`), `open_reader` (`sys/unix.rs:113`), `read_pipe` (`sys/unix.rs:171`), `shell_config` (`sys/unix.rs:215`), `configure` (`sys/unix.rs:230`), `kill_tree` (`sys/unix.rs:263`), `exit_code` (`sys/unix.rs:271`), `raw_name` (`sys/unix.rs:280`).
- **Data flow:** the same daemon logic, with Unix syscalls.
- **Non-obvious design decisions:**
  - **Shell resolution is Node's order**: a configured `shellPath` must exist (else `shell_unavailable`), then `/bin/bash`, then `which bash`, then `sh` (`sys/unix.rs:215-239`).
  - **`open_reader` opens with `O_NONBLOCK` and optionally `O_NOFOLLOW`** (`sys/unix.rs:113-131`); an `ELOOP`/`EMLINK` under `no_follow` becomes the synthetic code `SYMLINK`.
  - **Every command is put in a new session** (`setsid`) with default signal dispositions and an empty signal mask, in a `pre_exec` closure restricted to async-signal-safe calls (`sys/unix.rs:230-249`).
  - **`kill_tree` kills the process *group*, falling back to the process** (`sys/unix.rs:263-270`).
  - **A signal-killed process reports `128 + signal`**, as a shell does (`sys/unix.rs:271-276`).
  - **The reader thread polls the pipe in non-blocking mode** so it can notice the `stop` flag within 100 ms (`sys/unix.rs:171-205`).

#### `packages/env/daemon/src/sys/windows.rs`
- **Purpose:** Windows behaviour, following libuv's `src/win/*.c` and Node's `child_process`.
- **Key abstractions:** `os_error_name` (`sys/windows.rs:40`), `mtime` (`sys/windows.rs:76`), `identity` (`sys/windows.rs:91`), `tmpdir` (`sys/windows.rs:101`), `mkdtemp` (`sys/windows.rs:126`), `open` (`sys/windows.rs:145`), `realpath` (`sys/windows.rs:180`), `remove_file` (`sys/windows.rs:190`), `resolve_program` (`sys/windows.rs:209`), `quote_argument` (`sys/windows.rs:288`), `child_environment` (`sys/windows.rs:326`), `configure` (`sys/windows.rs:359`), `job`/`after_spawn` (`sys/windows.rs:372`, `sys/windows.rs:393`), `kill_tree` (`sys/windows.rs:401`), `drive_cwds` (`sys/windows.rs:414`), `path_identity` (`sys/windows.rs:429`).
- **Data flow:** the same daemon logic, with Win32 calls.
- **Non-obvious design decisions:**
  - **`identity` uses the *creation time*, not a file index** (`sys/windows.rs:91-96`) — but `path_identity` opens a handle to get the real volume serial + file index, because "NTFS gives a file created under a recently removed name the old one's creation time" ('tunneling') (`sys/windows.rs:429-467`).
  - **The environment is built exactly as Node builds it**: variables in object order, sorted by UTF-16 code units, first-wins for names differing only in case, then libuv's 11 `REQUIRED_VARIABLES` appended if missing (`sys/windows.rs:313-357`).
  - **Arguments are quoted by libuv's `quote_cmd_arg` algorithm**, reimplemented byte-for-byte (`sys/windows.rs:288-311`, with a unit test at `sys/windows.rs:469-484`).
  - **Every child is assigned to a Job Object** with `KILL_ON_JOB_CLOSE` (`sys/windows.rs:372-391`), so the daemon's exit kills the whole tree — the Windows analogue of `setsid` + `kill(-pid)`.
  - **`kill_tree` is `taskkill /F /T`**, "not waited for" (`sys/windows.rs:401-410`).
  - **Legacy WSL `bash.exe` gets the command on stdin** (`is_legacy_wsl_bash`, `sys/windows.rs:281-295`), because it mangles `-c` quoting — the same trick as the `pi` changelog's "pass scripts over stdin so shell variables expand in the target bash".
  - **Batch files are refused** with `spawn EINVAL` (`sys/windows.rs:255-262`), matching Node.
  - **`read_dir` maps `ERROR_DIRECTORY` (267) to `ENOTDIR`** on Windows and `ENOENT` elsewhere (`sys/windows.rs:420-427`, `sys/unix.rs:284-286`).
  - **`ExitStatus` is unsigned on Windows**: an access violation is 3221225477 (`sys/windows.rs:409-412`).

#### `packages/env/daemon/src/pty.rs`
- **Purpose:** A pseudo-terminal for interactive programs (Unix only).
- **Key abstractions:** `Terminal` (`pty.rs:30`), `Terminals` (`pty.rs:39`), `PtyRequest` (`pty.rs:44`), `run` (`pty.rs:147`), `write`/`resize`/`foreground` (`pty.rs:89`, `pty.rs:100`, `pty.rs:112`).
- **Data flow:** `openpty` → the program is the session leader with the pty as its controlling terminal → raw bytes out, input in.
- **Non-obvious design decisions:**
  - **The program leads a new session with the terminal as its controlling terminal** (`setsid` + `TIOCSCTTY`, `pty.rs:293-303`), so job control and SIGHUP work.
  - **Default signal dispositions and an empty signal mask** are re-applied in the `pre_exec` closure (`pty.rs:304-311`) — the same discipline as `exec`.
  - **The master fd is set `O_NONBLOCK`** and the reader `poll()`s it (`pty.rs:319-330`, `pty.rs:411-424`), so a lost connection can stop the reader.
  - **The slave fd is dropped after spawn** (`pty.rs:315`) — "Only the program holds the terminal now, so reads end once it and its descendants close it."
  - **`foreground()` reports the process group only when it is *not* the program's own** (`pty.rs:112-133`): for a shell at its prompt the answer is `null`; for a shell running `sleep 100` it is that job's group id and name. This is how a client tells "the shell is idle" from "the shell is running a build".
  - **The process name is read from `/proc/<pid>/comm` on Linux and `proc_name` on macOS** (`pty.rs:251-268`).
  - **Windows answers `ENOTSUP`** with a clear message (`pty.rs:135-145`).
- **Edge cases:** `cols`/`rows` are validated to 1..4096 (`pty.rs:47-58`); writing to a terminal that ended fails with `EBADF` (`pty.rs:89-98`); a resize sends `SIGWINCH` via `TIOCSWINSZ` (`pty.rs:100-109`).

#### `packages/env/daemon/build.rs`
- **Purpose:** Expose the npm package version to the daemon as `PI_ENV_VERSION`.
- **Key abstractions:** `fn main` (`build.rs:4`).
- **Data flow:** reads `../package.json`, scrapes the `"version"` string, emits `cargo:rustc-env=PI_ENV_VERSION=…`.
- **Non-obvious design decision:** the daemon's `hello` reports the *npm* version it shipped with (`main.rs:36`, `main.rs:150`), so a client can tell which release is on the far end. `cargo:rerun-if-changed=../package.json` keeps the build honest.
- **Edge cases:** the version scrape is a naive string split (`build.rs:8-14`) — brittle but adequate, and it fails loudly rather than silently.

---

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/agent/README.md` | The agent package's contract document: the message-flow diagram, the full event sequence for a prompt and for a tool-calling turn, the `prepareRequest`/`finishTurn` lifecycle, the steering vs. follow-up rules, and the warning that the low-level `agentLoop()` streams are observational only. |
| `packages/agent/CHANGELOG.md` | The design's history. Decides: the `shouldStopAfterTurn` → `finishTurn` migration (0.87.0); the removal of the whole experimental harness (sessions, compaction, skills) from this package in 1.0.0; `durationMs` measured on a monotonic clock excluding hooks (1.1.0); the `AgentState` reshape making runtime fields readonly and arrays copy-on-assign (0.65.0); the `steer`/`followUp` split (0.32.0). |
| `packages/agent/examples/mcp-codemode/main.ts` | Wires an MCP server's tools into an `Agent` plus one `codemode` tool; shows that a codemode script can call the same tools the model can. |
| `packages/agent/examples/mcp-codemode/tools.ts` | The adapters: `toToolName` (provider tool names are limited to 64 chars of `[A-Za-z0-9_-]`), `createMcpTools` (MCP output schemas become `structuredContent`), and `createNestedToolRunner` — a nested tool call goes through `runToolCall`, so `beforeToolCall`/`afterToolCall` apply to tool-calling tools too. |
| `packages/agent/package.json` | Package metadata: `@earendil-works/pi-agent-core` v1.4.0, deps `pi-ai` + `typebox`; Node ≥ 22.19.0 (needed for strip-only TypeScript). |
| `packages/agent/tsconfig.build.json` | Build config: `include: ["src/**/*.ts"]`, paths mapping `pi-ai` to its built `dist`, so the package compiles against the published types. |
| `packages/agent/vitest.config.ts` | Test config: `environment: "node"`, `testTimeout: 30000`, and `resolve.conditions: ["source"]` with aliases so tests import sibling packages' **source**, not their `dist`. |
| `packages/agent/test/agent-loop.test.ts` | 2234 lines pinning the loop. The load-bearing cases: "should not execute tool calls from a length-truncated assistant message"; "should emit tool_execution_end in completion order but persist tool results in source order"; "should force sequential execution when a tool has executionMode=sequential even with default parallel config"; "should inject queued messages after all tool calls complete"; "should stop after a tool batch when every tool result sets terminate=true" / "should continue after a mixed batch with one terminating blocked call"; "runs finishTurn after tool-result messages and before turn_end"; "action:end skips queue polling and next-turn preparation"; "makes exactly one context-only request when no natural request satisfies continuation"; "does not poll steering after prepareRequest"; "declares tool loadout changes to the model" and "rewrites pending tool declarations to match the executable set". |
| `packages/agent/test/agent.test.ts` | 1229 lines pinning the `Agent` class: awaited subscribers are part of run settlement (`isStreaming` stays true until `agent_end` listeners finish); `reset()` throws during a run; `prompt()`/`continue()` throw while streaming; `steeringMode`/`followUpMode` one-at-a-time vs. all; `peekQueuedMessages()` does not consume; `prepareRequest` can replace the model, the context and the thinking level; `finishTurn` receives the active abort signal; queues survive an error/aborted response even when `finishTurn` asks to continue; `identity` merges over `DEFAULT_AGENT_IDENTITY` field-by-field. |
| `packages/agent/test/e2e.test.ts` | Integration tests against the `fauxProvider` (a scripted provider from `pi-ai/compat`): basic prompt, tool execution with pending-tool-call tracking, abort mid-stream, event ordering, multi-turn memory, thinking blocks preserved, and `continue()` from user/toolResult tails. |
| `packages/agent/test/proxy.test.ts` | Three proxy regressions: tool-call metadata that arrives only on `toolcall_end` is preserved; a terminal event that is not newline-terminated is still processed; a stream that ends without a terminal event produces an error instead of hanging. |
| `packages/agent/test/utils/calculate.ts` | A tiny `calculate` tool (`new Function`) used across the agent tests; `createCalculateToolWithUsage` injects a `usage` payload so the loop's usage propagation can be observed. |
| `packages/agent/test/utils/get-current-time.ts` | A `get_current_time` tool with a timezone parameter; demonstrates the tool pattern: schema, `label`, `details` for the UI, and a thrown error for an invalid timezone. |
| `packages/agent/test/utils/wait-for-tick.ts` | `waitForTick()` — a macrotask yield used to let pending promise callbacks run in tests. |
| `packages/env/README.md` | The env package's contract: what the daemon does, the SSH bootstrap flow (scan → accept → detect → deploy → connect), the lazy `sshConnection` variant, the `listFiles` bounds, and the supported platforms. |
| `packages/env/CHANGELOG.md` | The env package's history. Decides: `listFiles` + `nodePlatform` + `LocalExecutionEnv` (1.2.0); pseudo-terminals and `ptyForeground` (1.3.0); the initial release's promise that "results match `NodeExecutionEnv` on that machine" and that watchers "report `overflow` and resume after a lost connection" (1.0.4). |
| `packages/env/docs/protocol.md` | **The wire contract**, in full: the framing, the six frame types, the error-code table, the cancellation semantics (`{mode:"kill"}` vs. abort), the scheduling rules (control frames before bulk output; >64 KiB replies queue behind output), the liveness rules (ping every 5 s; exit after 30 s of silence), and every operation with its fields. |
| `packages/env/docs/semantics.md` | **The split of work** between client and daemon, plus the rules the standard libraries do not follow (recursive `mkdir`, `rm`, `mkdtemp`, `tmpdir`, `listDir` ordering, `openBinaryReader`, `listFiles` having no local counterpart, Windows specifics) and the command/watching rules. |
| `packages/env/package.json` | `@earendil-works/pi-env` v1.4.0; deps `pi-durable` + `chord`; `build:daemon` runs `cargo build --locked`; `files` ships `dist`, `bin`, `docs`. |
| `packages/env/tsconfig.build.json` | Build config: paths to `chord`, `chord/context` and `pi-durable/env` dist types; `include: ["src/**/*.ts"]`. |
| `packages/env/vitest.config.ts` | Test config: node environment, `resolve.conditions: ["source"]` so the tests import the sibling packages' source. |
| `packages/env/daemon/Cargo.toml` | The daemon's manifest: `edition = "2024"`, `publish = false`, pinned `=` dependency versions (`encoding_rs`, `ignore`, `notify`, `serde_json`, plus `libc` on Unix and `windows-sys` on Windows), and a release profile with `lto`, `codegen-units = 1`, `strip = true`. |
| `packages/env/daemon/rust-toolchain.toml` | Pins the Rust toolchain to 1.96.0 with `rustfmt` and `clippy`. |
| `packages/env/daemon/Cargo.lock` | The generated lockfile: 40+ pinned crates. `notify` pulls in inotify, FSEvents, kqueue and `mio`; `ignore` pulls in `globset`/`walkdir`/`same-file`. Its content is a build artefact, not design. |
| `packages/env/test/conformance.test.ts` | Registers Durable's shared `registerEnvConformance` suite twice — once for `RemoteExecutionEnv` over a pipe, once for `LocalExecutionEnv` — with Git Bash as the Windows shell and `symlinks: false` there. |
| `packages/env/test/daemon.ts` | The test daemon path: `PI_ENV_DAEMON` if CI set, else `daemon/target/debug/pi-env`; throws a build instruction if missing. |
| `packages/env/test/differential.test.ts` | **The strongest test in the shard**: 60 seeded random sequences of 25 file operations run against `NodeExecutionEnv` (local) and `RemoteExecutionEnv` (over the daemon), with results normalised (roots replaced, `mtimeMs` dropped, failures reduced to their code) and compared for equality. Plus devices/FIFOs/directories read like Node, non-UTF-8 names, and the same results from Durable's real `read` and `bash` tools. |
| `packages/env/test/old-daemon.ts` | A stand-in for a pre-`features` daemon: answers `hello` without `features` and refuses every other op as `EINVAL`. Used to pin the `not_supported` fallback. |
| `packages/env/test/remote.test.ts` | Pins the output window (5 MB of output → delivered + skipped == total, and the tail is the true end), abort right after the request, `nodePlatform` names, `listFiles` → `not_supported` on an old daemon, cancelling a 10 100-entry listing, timeout of a silent command, stale handles failing after a lost connection, a failed start being retried, and multi-chunk writes/reads staying in order. |
| `packages/env/test/ssh-external.test.ts` | Runs the conformance suite over a **real SSH server** when `PI_ENV_SSH_HOST` is set (CI); logs each stage ("scanning the host key", "detected … deploying") so a CI hang shows where it is. |
| `packages/env/test/ssh.test.ts` | Boots a **disposable `sshd` on localhost** with its own host key, client key and `authorized_keys`, then pins: an untrusted host is refused; after `acceptHostKey` the daemon deploys and works; a verified daemon is reused (mtime unchanged); a tampered daemon is replaced; the daemon is re-verified after a lost connection; `listFiles` over SSH matches the local listing exactly; the login shell is used only when asked; a lazy connection reports a failed start as the operation's error; only plain host-key lines for the alias are accepted; a changed key is refused. |
| `packages/env/test/terminal.test.ts` | Pins the pty: a program sees a TTY (`IS-A-TTY`), `stty size` reflects the resize, `$TERM` is passed, the foreground job is reported (not the shell at its prompt), raw bytes are delivered (0xff is not decoded), 40 000 bytes of input arrive **in order**, `close()` kills the program, a missing directory fails, and writing to a nonexistent terminal gives `EBADF`. |

### Tier 3 — skipped with a reason

None. Every one of the 62 files was opened and read; `packages/env/daemon/Cargo.lock` was read in full even though it is a generated lockfile, because it is small (12 KB) and its pinned dependency set is itself a design signal (`ignore`, `notify`, `encoding_rs` — deliberately three, and no async runtime).

---

## 2. Ideas worth stealing

1. **`terminate: true` as a unanimous, runtime-only early-exit hint.** A tool (or a `beforeToolCall` block, or an `afterToolCall` override) may say "do not call the model again"; the loop honours it **only when every finalized tool result in the batch says so** (`packages/agent/src/agent-loop.ts:700`). *Why it transfers*: August Trading's desk tools each want to say "I already logged this trade, don't ask again" — with unanimity, one grumpy tool cannot end a turn that another tool still needs. The hint never enters the transcript (`agent-loop.ts:869`).

2. **A truncated assistant message must not execute its tool calls.** If the provider stopped with `stopReason === "length"`, every tool call in that message is failed with a message asking the model to re-issue it (`packages/agent/src/agent-loop.ts:277`, `agent-loop.ts:488`). *Why it transfers*: August Trading's desk tools place orders and write notebooks. A JSON salvage parser can produce a *valid but truncated* argument set; the guard is the difference between "the order was placed with a default size" and "nothing happened".

3. **The executable tool set always wins over what the caller claimed.** Before each request the loop diffs the real loadout against the transcript's declaration and *rewrites* the pending system message's `toolsAdded`/`toolsRemoved` to the real delta (`packages/agent/src/agent-loop.ts:342-390`). *Why it transfers*: August Trading has a model-authored skill/tool registry that can drift from the runtime's actual capabilities; the model must never be told it can call something it cannot.

4. **Split the tool pipeline into named seams so nested calls get the same gates.** `prepareToolCall` (argument shim → schema validation → `beforeToolCall` → execute → `afterToolCall`) is a single function, and `runToolCall` re-uses it for tool-calling-tools (`packages/agent/src/agent-loop.ts:718`, `agent-loop.ts:821`; `packages/agent/examples/mcp-codemode/tools.ts:100-129`). *Why it transfers*: August Trading's `toolForge` and the desk tools that call other tools would otherwise bypass the approval gate.

5. **One "model-facing text" plus two side channels.** `AgentToolResult` has `content` (what the model sees), `details` (what the UI/log sees) and `structuredContent` (what code sees, *not sent to the model*), and the postflight hook drops `structuredContent` if it replaces `content` without it (`packages/agent/src/types.ts:424-447`, `agent-loop.ts:801-806`). *Why it transfers*: August Trading's tool results currently mix UI text and structured data; separating them removes a whole class of "the model sees a JSON blob" defects.

6. **`prepareRequest` — a hook immediately before every provider request that can replace the context, the model and the thinking level** (`packages/agent/src/types.ts:264-272`, `agent-loop.ts:225-251`). *Why it transfers*: this is the exact place to (a) install the canonical persisted transcript, (b) re-read the trader's latest settings, or (c) swap in a cheaper model mid-turn — without touching the loop.

7. **Two queues with different urgency: `steer()` vs `followUp()`**, each with a `one-at-a-time` (default) or `all` drain mode, plus a non-consuming `peekQueuedMessages()` (`packages/agent/src/agent.ts:149-175`, `agent.ts:314-342`). *Why it transfers*: August Trading's chat surface already has a "stop" button and a queue; naming the two intents removes the guesswork about what a queued message does.

8. **A binary, bounded, cancellable listing with three independent limits and an explicit `truncated` flag.** `listFiles` defaults to 50 000 entries / 4 MiB / 10 s, checks the abort *between entries*, and reports `truncated` rather than silently cutting (`packages/env/daemon/src/list.rs:13-15`, `list.rs:120-170`; `packages/env/src/list-files.ts:44-56`). *Why it transfers*: August Trading's "scan the workspace" tools need the same three bounds and the same honesty flag.

9. **Separate control frames from bulk output, and give bulk output backpressure.** `Output` keeps two queues; results, errors, pings and watch events always jump ahead of command output, and unwindowed output waits at 4 MiB unsent (`packages/env/daemon/src/output.rs:14`, `output.rs:34-61`). *Why it transfers*: August Trading streams tool output into the transcript; a cancel's acknowledgement must not queue behind a 5 MB market-data dump.

10. **An output *window* that guarantees a true tail and reports what it dropped as counts.** The window trims only the prefix whose removal still proves exclusion, and reports `{ bytes, newlines, endsWithNewline }` rather than a placeholder (`packages/env/daemon/src/window.rs:103-176`). *Why it transfers*: August Trading truncates tool output; it should truncate the *middle* and keep an exact count of what it lost.

11. **Prove the remote half by differential testing against the local half.** 60 seeded random sequences of 25 file operations, results normalised and compared for exact equality (`packages/env/test/differential.test.ts:1-300`). *Why it transfers*: August Trading's SQLite/IndexedDB dual persistence, its Electron-vs-web differences, and its "local vs. remote market data" split are all candidates for this exact harness.

12. **Deploy a binary named by its SHA-256 and re-verify the hash before every start; refuse to run when the remote has no hash tool.** (`packages/env/src/ssh.ts:394-416`, `ssh.ts:459-492`.) *Why it transfers*: if August Trading ever ships a helper binary or a skill bundle to a remote host, "the name is the digest and the digest is checked before use" is the whole security model in three lines.

13. **A known-hosts store with an explicit, human-driven accept flow — and a changed key is *never* accepted automatically.** `scanHostKey` shows a fingerprint, `acceptHostKey` writes one alias-scoped line atomically, and a different key of the same type raises `HostKeyChangedError` until `forgetHostKey` is called (`packages/env/src/ssh.ts:182`, `ssh.ts:258`, `ssh.ts:270-273`). *Why it transfers*: August Trading has an "approvals inbox" concept; the transferable part is the *refusal to auto-accept a changed credential* and the explicit, serialised, atomic write.

14. **A watcher that reports `overflow` when its coverage was lost.** When the native watcher runs out of watches, or the connection drops, the watcher says "changes were missed" instead of pretending it is caught up (`packages/env/daemon/src/watch.rs:576-582`, `packages/env/src/watch.ts:148`). *Why it transfers*: August Trading's live-market subscriptions and price alerts need an explicit "I missed something" signal, not silence.

15. **A liveness contract on both sides**: ping every 5 s, exit after 30 s of silence, kill every process group on the way out (`packages/env/daemon/src/main.rs:37-38`, `main.rs:496-513`; `packages/env/src/connection.ts:15`, `connection.ts:302-306`). *Why it transfers*: an August Trading background worker that loses its socket must not leave orphaned processes or a half-written state file.

16. **Feature negotiation instead of version negotiation.** The daemon advertises `features: ["listFiles"]` in `hello`; the client checks the *feature*, not the version, and an older daemon gets `not_supported` instead of a crash (`packages/env/daemon/src/main.rs:33-34`, `main.rs:159`; `packages/env/src/list-files.ts:33-36`). *Why it transfers*: August Trading's model/tool capabilities should be advertised the same way, so an old helper binary degrades instead of breaking.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work — mostly *not* in this shard.** There is no cron, no scheduled digest, no entry/TP/SL detection in `packages/agent` or `packages/env`. What this shard *does* contain is the substrate such work would sit on: a **long-lived file watcher that runs next to the data** and reports changes as a diff of snapshots rather than as events (`packages/env/daemon/src/watch.rs:2-3`, `watch.rs:463-476`), a **poll fallback chosen from the file system** (`watch.rs:35-48`, `watch.rs:184-205`), and a **watcher that survives a lost connection by reconnecting with exponential backoff and declaring an `overflow`** (`packages/env/src/watch.ts:133-155`). For August Trading's scheduled work, the transferable shape is: the watcher lives beside the data, the *diff* is the signal, and a coverage gap is reported rather than hidden.
- **Human-in-the-loop approval — the gate exists but lives in another shard.** This shard provides the *mechanism* a gate would use: a `beforeToolCall` hook that can block a call and return a reason, which the loop converts into an error tool result the model sees (`packages/agent/src/agent-loop.ts:755-772`, `packages/agent/src/types.ts:66-74`), and a `runToolCall` path that applies the same gate to *nested* tool calls (`packages/agent/src/agent-loop.ts:821-830`). The `packages/env` side adds the audit-friendly property that a blocked call leaves a structured record: the error tool result carries the reason as text and `isError: true`. The approval *record* and its persistence are not in this shard.
- **Post-mortem / reflection loops — not in this shard.** No reflection, no rule extraction, no rule retirement. The nearest thing is the `afterToolCall` postflight hook (`packages/agent/src/types.ts:92-104`, `agent-loop.ts:790-812`), which is the *structural* slot where a post-mortem would live: it sees the executed result, can rewrite it, and can mark the batch terminating. Note the safety property it inherits — a throwing postflight hook becomes an error result instead of aborting the batch (`agent-loop.ts:806-809`).
- **Multi-agent — not in this shard; and the shard's stance is against debate.** `packages/agent` is a *single* agent with a tool pipeline. The only multi-actor pattern present is **steering**: a human (or another actor) injects a message mid-run, delivered after the current tool batch completes (`packages/agent/src/agent-loop.ts:214`, `agent.ts:314-327`). The `codemode` example adds a second form of parallelism that is *not* a debate: one model-written JavaScript script calls many tools concurrently and returns only its output (`packages/agent/examples/mcp-codemode/tools.ts:131-205`). That is "one agent, many tools, one answer" — the opposite of a debate, and probably the right default for trading analysis.
- **Structured logs the model can query — the closest thing here is a framed, typed, byte-oriented protocol plus a text-safe output layer.** Two reusable pieces: (a) the daemon's **frames carry a request id, a type and a JSON envelope**, so a transcript of every operation is a stream of typed records rather than prose (`packages/env/daemon/src/frame.rs:5-17`); and (b) the **output window keeps an exact tail and reports dropped bytes as counts** (`packages/env/daemon/src/window.rs:167-196`), which is exactly what a trade log needs — "here are the last N bytes, and here is precisely what I did not keep". There is no database and no JSONL log store in this shard.
- **Staying simple as features accumulate — the strongest evidence in the shard is the *removal*, not the addition.** `packages/agent/CHANGELOG.md` records the 1.0.0 change that removed the entire experimental harness — sessions, session storage, durable runtime, pico3, harness tools, compaction, skills, prompt templates, system-prompt helpers, telemetry schemas, search service types — leaving "only `Agent`, the agent loop, the proxy stream, and their types". The package *gained* durability elsewhere (`@earendil-works/pi-durable`). That is the pattern: **when a feature needs its own lifecycle (persistence, compaction, approval), move it to a sibling package rather than growing the core.** The `packages/env` daemon makes the same move: the client keeps semantics, the daemon keeps syscalls, and neither grows the other (`packages/env/docs/semantics.md`, "Split of work").

---

## 4. Non-obvious decisions and gotchas

1. **`agent_end` is not the idle boundary.** It is the last *event*; the agent is idle only after every awaited `agent_end` listener has settled (`packages/agent/src/agent.ts:311-320`, `agent.ts:596-601`). A caller that treats `agent_end` as "done" will race its own persistence.
2. **The low-level `agentLoop()` stream is observational; the `Agent` class is a barrier.** The README is explicit: the low-level streams "do not wait for your async event handling to settle before later producer phases continue" (README, "Low-Level API"). Only `Agent` guarantees that `beforeToolCall` sees the assistant message already in agent state.
3. **Parallel tool execution emits two different orderings on purpose.** `tool_execution_end` in completion order; persisted `toolResult` messages and `turn_end.toolResults` in assistant source order (`packages/agent/src/agent-loop.ts:596-669`). A UI that counts "tool results seen" versus "rows persisted" will disagree if it assumes one order.
4. **One sequential tool in a batch forces the whole batch sequential.** Not just that tool — the entire batch (`packages/agent/src/agent-loop.ts:520-524`). Pinned by two separate tests.
5. **`structuredContent` silently disappears** if a postflight hook replaces `content` but not `structuredContent` (`packages/agent/src/agent-loop.ts:801-806`). A hook that edits the text and forgets the structure breaks downstream programmatic consumers.
6. **`convertToLlm` and `transformContext` must not throw.** A throw there interrupts the low-level loop with no normal event sequence (`packages/agent/src/types.ts:210-214`).
7. **A failed `start` is not remembered by `Connection`** — the next request retries (`packages/env/src/connection.ts:227-239`). This is why a lazy SSH connection reports the *operation's* error rather than a sticky failure.
8. **A handle belongs to the daemon session that opened it.** After a lost connection the new daemon numbers its handles from 1 again, so a stale handle could silently address the *wrong* file. The client therefore passes the session id and fails such requests (`packages/env/src/connection.ts:203-209`; `packages/env/test/remote.test.ts`, "fails requests on handles of a lost connection"). This is a subtle, well-handled footgun.
9. **`cancel` vs `kill` are different outcomes.** `cancel` settles the command as `aborted`; `kill` settles it with the killed process's exit status (137) (`packages/env/daemon/src/exec.rs:40-56`). August Trading should keep the same distinction: "the user cancelled" and "we tore it down" are different facts.
10. **The daemon's stdout is shared with shell startup noise.** The client must scan for the `PI-ENV <token>\n` marker before trusting any byte (`packages/env/src/connection.ts:340-350`). Anything printed before it is forwarded to `onLog`, not parsed as a frame.
11. **`listFiles` skips gitignored files only inside a git work tree** (`require_git(true)`, `packages/env/daemon/src/list.rs:116`). Outside a work tree, nothing is ignored — so the same directory can list differently depending on whether `.git` exists.
12. **The daemon's `watch` reports changes as a *snapshot diff*, not as events.** The native event is only a hint that triggers a debounced rescan (`packages/env/daemon/src/watch.rs:2-3`). A consumer that assumes "one event = one change" is wrong.
13. **Windows `identity` cannot be trusted from metadata alone.** NTFS "tunneling" can give a recreated file the old file's creation time, so the daemon opens a handle to read the real file index (`packages/env/daemon/src/sys/windows.rs:429-467`).
14. **`Agent.prompt()` while streaming throws; it does not queue.** The message names the alternatives (`packages/agent/src/agent.ts:376-381`).
15. **`Agent.reset()` during a run throws** rather than clearing the transcript mid-stream (`packages/agent/src/agent.ts:364-369`).

---

## 5. Weak spots

1. **The agent package's `Agent` class is a god-object with two generations of API side by side.** `prepareNextTurn` *and* `prepareNextTurnWithContext`, `queueMode`-era leftovers in the changelog, `prepareArguments` as a "compatibility shim", `streamFn` as *required* in the types but *optional* at runtime for "older compiled consumers" (`packages/agent/src/agent.ts:250-252`). The compatibility shims are individually defensible; together they make the public surface much larger than the problem needs.
2. **The `finishTurn` continuation rule is easy to get wrong and the docs warn about it.** "Returning `{ action: "continue" }` unconditionally creates an endless loop" (README) — the loop honours exactly one context-only request, but a hook that always returns `continue` will drive the model round after round (`packages/agent/src/agent-loop.ts:305-315`). There is no built-in cap on consecutive context-only turns.
3. **The `packages/env` daemon is a large amount of Rust for a reference, and its complexity is inherent to the goal (Node-identical semantics across Linux/macOS/Android/Windows).** `watch.rs` alone is 780 lines of snapshot-diffing, FSEvents settling, inode identity and polling fallbacks. A reader coming for "how to watch files" will not find it easy. It also carries a hand-maintained table of 12 Linux filesystem magics (`packages/env/daemon/src/watch.rs:35-48`) that will rot as filesystems appear.
4. **The `afterToolCall` merge semantics have no deep merge for `content`/`details`/`usage`** (`packages/agent/src/types.ts:100-103`). A hook that wants to *append* to the content must build the whole array itself; there is no helper, and no test pins a partial-append idiom.
5. **`packages/agent` has no test for the "mixed batch with a terminating tool" case at the `Agent` class level, only at the loop level**, and the `proxy.ts` delta-reconstruction state machine (≈150 lines of switch statements, `proxy.ts:253-330`) is covered by only three tests (`packages/agent/test/proxy.test.ts`) — it is the most intricate untested surface in the shard.
6. **The env package's tests require a built Rust daemon and (for the SSH suite) a real `sshd`.** `packages/env/test/daemon.ts` throws at import time if the binary is missing, so the TS test suite cannot run without `cargo build`. That is a real barrier to contribution, even though the differential harness is excellent.

---

*Report written by an exhaustive-read worker. Every file in `pi-agent-env.files.txt` was opened and read; 62 of 62 read, 0 skipped.*
