# deepseek-harness :: dsh-shell-terminal-subprocess

**Files in shard:** 233 — **read: 215**, **skipped with reason: 18** (all 18 are the generated
`README.i18n.yaml` bilingual-pairing hash records — confirmed by head peek, not source).
**Six large test suites (>39 KB) were read head+tail, not line by line** — each says so in the
status ledger.

**What this shard covers:** the entire command-execution substrate of the DeepSeek Harness:

```
ctx.shell          (packages/shell/shell)                  ← the executor SEAM
  ├─ bash-local    ─────────────────── POSIX: fresh `bash -c`
  ├─ bash-sandbox  ─────────────────── POSIX: confined via ctx.sandbox
  ├─ pwsh-local    ─────────────────── Windows: fresh `pwsh -Command`
  └─ pwsh-sandbox  ─────────────────── Windows: confined via ctx.sandbox
ctx.shellEnv       (packages/shell/shell-env)              ← the managed DSH_* namespace
ctx.tools          (packages/shell/tool-bash|pwsh|*-persistent) ← the model-facing tools
ctx.subprocess     (packages/subprocess/subprocess)        ← the process SEAM
  ├─ subprocess-local  ─────────────── the host provider (Linux systemd scope / Windows Job / fallback)
  └─ win32-process    ─────────────── the shared Koffi Win32 binding table
ctx.terminals      (packages/terminal/terminal)            ← the PTY session SEAM
  └─ terminal-bash ─────────────────── the shipped interactive shell backend
```

---

## 1. File-by-file

### Tier 1 — load-bearing source: a full entry each

#### `packages/shell/bash-local/src/index.ts` — the default POSIX executor
- **Purpose:** a `ctx.shell` Service Provider running each command as a fresh, non-login
  `bash -c` process through `ctx.subprocess`.
- **Key abstractions:** `LocalBashExecutor extends ShellExecutor`; `Config`
  (`cwd`, `timeoutMs`, `maxTimeoutMs`, `maxOutputBytes`, `maxSpillBytes`, `graceMs` — all
  `Volatile`); `ENV_OVERRIDES`; `assertServiceableBashConfig()`; `executeArgv()` (the
  protected seam the sandbox subclass reuses).
- **Data flow:** `resolve(request)` → `ShellExecSpec` (fills workdir, clamps the timeout to
  `maxTimeoutMs`, applies `onExpiry` default `'kill'`, carries `stdin`/`env`/`dshEnv`
  verbatim, carries `sandboxPolicy` through inertly) → `execute(spec)` → `executeArgv()`
  wires a fused deadline, spawns `['bash','-c',command]`, returns a `ShellExecution` whose
  `result()` projects into `ShellRunResult`.
- **Non-obvious design decisions:**
  - `ENV_OVERRIDES = { NO_COLOR:'1', TERM:'dumb', PAGER:'cat', GIT_PAGER:'cat' }`
    (src/index.ts:26) — a model-facing-output hygiene set the comment explicitly credits to
    Codex's hardcoding and Claude Code's `TERM=dumb`.
  - The env merge order is `{ ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv }`
    (src/index.ts:172): the trusted `dshEnv` snapshot beats the caller's env beats the
    terminal overrides. A caller cannot smuggle a value past the trusted layer.
  - `classify()` is **first-cause** and **mutually exclusive**: `timedOut` only when the
    executor's own deadline fired; `aborted` only when the signal aborted *and* it was not a
    timeout (src/index.ts:213-219). A command that SIGTERMs itself is neither — the
    classification reports the cause that cut the command short, and nothing the executor
    owns did.
  - A provider rejection becomes a **stage-neutral note that acts as the whole stderr
    stream** (`subprocess failed before reporting an outcome: …`, src/index.ts:263).
    `observed.stderr` serves the note at any offset and the consuming `readOutput()` folds
    it in **exactly once**; `result()` rejects with the retained error. This is what keeps
    `done` from ever rejecting for a background job.
  - A synchronous `spawn` throw is **contained into the same settled-killed shape** as an
    asynchronous rejection (src/index.ts:224-232) — `execute()` never throws for a spawn
    problem.
  - Preparation (argv building) runs under the **same fused deadline and the same signal**
    as execution (src/index.ts:222-252). A preparation timeout returns empty output,
    `timedOut: true`, `exitCode: null`; a late preparation success cannot trigger a spawn
    (a `preparationTimedOut` latch).
  - `assertServiceableBashConfig()` runs at **resolve time, not at write time** — the schema
    cannot express "positive and finite" nor the `MAX_TIMER_DELAY_MS` timer bound, so an
    unusable stored budget fails on the *next command* rather than at the profile write
    (src/index.ts:88-99).
- **Edge cases:** empty/NaN/negative budgets rejected with the field name; `graceMs` above
  `MAX_TIMER_DELAY_MS` rejected because Node cannot express it in one timer; a caller may
  raise `stdoutMaxBytes` but not stderr's; a rejection value whose `Symbol.toPrimitive`
  throws is stringified to `unprintable provider failure` and can never escape; `kill()`
  returns `true` once and `false` after settlement.
- **Surprising:** the deadline reason string is `'BASH_TIMEOUT'` even in the pwsh twin (a
  copy-paste; harmless because the reason is only compared internally). A background process
  **survives executor-fiber disposal** and is only killed when the *subprocess service*
  disposes — the process belongs to the service, not the executor.

#### `packages/shell/bash-sandbox/src/index.ts` — the confined POSIX executor
- **Purpose:** wraps the exact `['bash','-c',command]` argv through `ctx.sandbox.confine()`
  and reports mode / enforcement / denial facts on the result.
- **Key abstractions:** `SandboxBashExecutor extends LocalBashExecutor`; `Config = LocalConfig`
  (deliberately inherited — the sandbox policy is NOT the executor's config);
  `processFacts: Map<ShellProcess, {...}>` (per-process confinement facts);
  `decorateResult()` (memoized in-place decoration of the handle's `result()`).
- **Data flow:** `resolve()` stamps `sandboxPolicy` (per-call override, else
  `ctx.sandboxPolicy.resolve()`); `execute()` short-circuits `danger-full-access` to an
  unwrapped run, otherwise awaits `confine()` inside the inherited `executeArgv()`
  preparation hook and spawns the provider's returned argv directly.
- **Non-obvious design decisions:**
  - **Runner failure outranks denial** (src/index.ts:118-124): the command never ran, so
    "denied" would be a lie.
  - **Denials are inferred from failed-command stderr**, matched against the *active
    backend's* signature set (the wrap carries `denialSignatures`). The same stderr flips
    meaning with the backend: EPERM is Seatbelt's denial dialect but under bwrap's
    EROFS-only dialect `Permission denied` is ordinary DAC.
  - **Per-process facts, not a "latest wrap" field** (src/index.ts:60-71): the provider may
    vary enforcement and dialect between overlapping calls, so facts key on the exact
    `ShellProcess` instance and are deleted at settlement.
  - `decorateResult()` decorates the handle **in place** (never wraps it in a second
    object) because `processFacts` and `onProcessDone` key on the exact instance.
  - A provider rejection is attributed to the runner **only when the error independently
    names `argv[0]`** in its `ENOENT`/`EACCES` path or syscall (src/index.ts:169-174).
- **Edge cases:** **fail closed** — a confined mode with no usable runner rejects with
  `SandboxUnavailableError` / `SANDBOX_UNAVAILABLE`; an upstream abort stays cancellation
  even when it prevents spawn; a signal death is never a denial (null exit code); a
  cwd-owned `ENOENT` keeps the original error (not the runner's fault); `ENOEXEC` stays
  ordinary.
- **Surprising:** the executor *never grants* permission — deny-only at the seam. The
  approval flow lives in the tool layer; the executor merely stamps the facts.

#### `packages/shell/bash-sandbox/src/helpers.ts`
- **Purpose:** shell-result projection over shared sandbox diagnostics.
- **Key abstractions:** `classifyDenial(result, signatures)`; re-exports
  `isRunnerSpawnFailure`, `classifyRunnerFailure`, `matchesSignature` from
  `@deepseek-ai/dsh-sandbox`.
- **Non-obvious:** the signature list is **case-insensitive substrings**, supplied by the
  backend; a clean exit (0) or a signal kill (null exit code) is never a denial even when
  the stderr literally contains the denial wording.
- **Surprising:** tiny, but the *only* place the denial rule is applied in this package —
  the runner-failure rule lives in the shared sandbox package.

#### `packages/shell/pwsh-local/src/index.ts` — the PowerShell executor
- **Purpose:** the Windows twin of `bash-local`, running each command as a fresh
  `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>`.
- **Key abstractions:** `PwshLocalExecutor`; `Config` (the bash knobs plus `pwshPath`);
  `ENV_OVERRIDES` (no `TERM=dumb` — a POSIX concept); `ENCODING_PREAMBLE`; `argv(spec)` (the
  protected argv seam the sandbox subclass wraps); `executeArgv()`; `onProcessDone()`.
- **Non-obvious design decisions:**
  - **The command rides as ONE argv element after `-Command`** — PowerShell parses the text
    itself, so there is no shell-quoting layer to escape and native Win32 paths (`C:\...`)
    pass through unchanged (src/index.ts:7-11).
  - `ENCODING_PREAMBLE` pins UTF-8 output *before* the command (src/index.ts:51-52) —
    Windows PowerShell 5.1 writes the console/OEM code page by default and garbles
    non-ASCII. The statements ride on line 1 after `; ` so PowerShell error line numbers
    stay accurate. Documented trade-off: a command starting with `param(...)`, `#requires`
    or `using` cannot run under the preamble.
  - `resolvePwshPath` lives in a **dependency-free sibling module** so the repository's
    coverage-gate probe shares the exact resolution definition the suites use — a probe
    that resolved differently could exempt a file whose suites actually run.
  - The `pwshPath` getter **re-probes the filesystem only when the declared path changed**
    (src/index.ts:145-152) — a runtime config edit takes effect on the next command without
    a remount.
  - The whole file is wrapped in `/* jscpd:ignore-start */` — the copy-paste detector is
    explicitly told this file mirrors `dsh-bash-local` call-for-call **by design**.
- **Edge cases:** Windows reports forced termination as **exit 1 with `signal: null`**, so
  signal-stamped facts are POSIX-only; the timeout/abort classification is
  platform-independent.
- **Surprising:** the deadline reason string is still `'BASH_TIMEOUT'` in the pwsh executor.

#### `packages/shell/pwsh-local/src/resolve.ts` — pure executable resolution
- **Key abstractions:** `candidatePwshPaths(env)`, `resolvePwshPath(configured, env, platform)`.
- **Non-obvious:** resolution order on Windows: PowerShell 7 install → each `PATH` entry
  (quotes stripped, `setx`-style) → Windows PowerShell 5.1 as last resort → bare `pwsh`.
  `candidateExists()` uses **`lstatSync`, not `statSync`** (src/resolve.ts:39-49): the
  Microsoft Store execution alias stats as `EACCES` but lstats as a link, and Node reports
  the alias as a symlink on current releases and a plain file on older ones — `CreateProcess`
  resolves either shape. A real directory never matches.
- **Surprising:** the module is deliberately dependency-free (`node:fs` + `node:path` only) —
  a constraint imposed by a coverage-gate probe, documented in its header. The whole
  function is parameterized on `env` and `platform` so it is **pure on every platform** — the
  tests exercise Windows resolution from Linux.

#### `packages/shell/pwsh-sandbox/src/helpers.ts` and `src/index.ts`
- **Purpose:** the pwsh twin of the bash sandbox consumer, mirroring it call-for-call.
- **Non-obvious:** `isUsableWorkdir()` is checked **at classification time, not atomically
  with spawn** — concurrent path replacement may change attribution but **cannot permit an
  unconfined execution** (src/helpers.ts:47-52). Attribution requires either a supplied
  error path that exactly identifies the runner, or a syscall that does.
- **Surprising:** `src/index.ts` is entirely inside a `/* jscpd:ignore */` block with the
  same "deliberate mirror" justification.

#### `packages/shell/shell-env/src/index.ts` — the managed `DSH_*` namespace
- **Purpose:** the trusted environment every model shell call receives.
- **Key abstractions:** `ShellEnvRegistry`; contributors register `{ name, variables:
  { DSH_KEY: { description } }, resolve(execution) => {...} }`.
- **Data flow:** `collect(execution)` → a **frozen, sorted snapshot** of the registry
  (built-ins + every contributor's resolved facts) computed per execution, so the values
  cannot drift between the request's construction and the spawn.
- **Non-obvious design decisions:**
  - **Contributors must DECLARE every key they return**; an undeclared or non-string value
    fails the call. The declaration is the contract, not the runtime value.
  - **Duplicate ownership and reserved-key claims fail loudly at plugin load**, not at the
    first command. Reserved: `DSH_HOME`, `DSH_SHELL`, `DSH_SESSION_ID`, `DSH_PROFILE`,
    `DSH_PROFILE_DIR`.
  - **Registration is disposed with the registering plugin** (effect-scoped), so hot-reloading
    a plugin removes its facts.
  - `list()` enumerates declarations **without executing the resolvers** — so a diagnostics
    panel can show the catalogue without paying for it.
- **Edge cases:** a `DSH_*` key must be all-caps with underscores; a missing description
  fails registration; an optional fact that resolves to `undefined` is simply absent from the
  snapshot rather than an empty string.

#### `packages/shell/shell/src/index.ts`, `src/types.ts`, `src/render.ts` — the `ctx.shell` seam
- **Purpose:** the abstract `ShellExecutor` Service every implementation registers as
  `ctx.shell` (one per context; a second throws — Cordis' standard duplicate-service
  behaviour).
- **The seam's contract, verbatim in intent:**
  - `resolve(request)` applies implementation-owned defaults and caps; `execute(spec)`
    takes a **fully-specified spec, never a raw request**.
  - `result()` **rejects only for infrastructure failures**. A nonzero exit, a timeout kill
    and an abort kill all resolve with a descriptive result carrying first-cause
    `timedOut`/`aborted` and the spec's `timeoutMs` echoed.
  - `done` settles at process close and **never rejects**; a spawn failure settles as
    `killed` with the error on the read path while `result()` carries the same failure as a
    rejection.
  - `onExpiry: 'none'` arms no deadline; `'kill'` kills at expiry. Expiry during preparation
    returns a settled timed-out handle with no output.
  - `readOutput` is **incremental**: consecutive reads never repeat output. Lossy reads report
    truncation and the available spill files.
  - **"Foreground" is a property of what the caller awaits, not of the spawn** — a caller
    that awaits `result()` ran in the foreground; one that keeps the handle ran it in the
    background.
  - A still-running process is stopped and awaited when its owning composition tears down;
    with the subprocess seam that boundary is `ctx.subprocess` disposal, so a process
    survives an executor-only reload.
- **`src/render.ts` — `parseExitStatus`:** the *inverse* of the `[exit code: N]` /
  `[killed by signal: X]` markers the tools append. A marker only counts when it has a
  leading newline AND ends the string, so output that merely *ends* in marker-like text is
  not read as a failure. A timeout marker no pill shows stays in the body.
- **Non-obvious:** `result()` is **memoized and created on demand** — a background producer
  that never calls it never observes the rejection either; the handle's `done`/read path
  carries the spawn-failure story for them.

#### `packages/shell/tool-bash/src/index.ts` — the one-shot model-facing bash tool
- **Purpose:** the model-facing `bash` tool. With a job registry composed, **every call is a
  job from its start**; `run_in_background` returns the id at once, a foreground command
  that outlives its timeout returns the same id, and `job_output`/`job_kill` collect and
  stop it.
- **Key abstractions:** `Config { enableRunInBackground, promoteOnTimeout }`;
  `BashToolArgs`; the schema built for the model; `presentCall`/`presentResult` presenters.
- **Non-obvious design decisions:**
  - **Named args only.** The tool's request to the executor is assembled from the
    *named* parameters it owns (`command`, `timeoutMs`, `workdir`, `run_in_background`,
    `sandbox_permissions`, `justification`); everything else about the environment comes
    from `ctx.shellEnv` and the session's cwd. The test suite pins that the executor sees
    no unexpected fields.
  - **`promoteOnTimeout` (default true):** a foreground command that reaches its timeout
    **keeps running as its background job** instead of being killed, and the model gets
    `[still running after <timeoutMs>ms; moved to background job <id>]` plus hand-off
    instructions and a **single consuming read** of the output so far — `job_output`
    continues from exactly that point. Registration is *best-effort*: with
    `promoteOnTimeout: false`, no registry, or a registry that refuses the job at start
    (owner's job cap, no controller), the command runs under the executor's deadline kill
    instead. The `timeoutMs` parameter is only advertised in the description when the
    hand-off semantics actually hold.
  - **Escalation is narrow, once-only and justified.** `sandbox_permissions` may request a
    wider mode **only after a real denial**, with a one-sentence `justification`, and the
    request goes through `ctx.approval`. Repeating the *current* mode needs no approval and
    no reason; a *narrower* target fails before execution; a different mode without a
    non-empty reason is rejected.
  - **An outside stop is reported as a reason, not a failure:** a foreground result stopped
    from outside the call (a person stopping the job in the UI) carries
    `[stopped: <reason>]` *before* the signal marker, so the model reads the reason rather
    than concluding the command failed. Cancelling the call itself kills the job instead.
  - **The background surface follows the registry.** The tool registers a foreground-only
    variant when no registry is composed, swaps to the job-backed variant when
    `ctx.jobs` appears, and swaps back when it unloads — the tool never disappears in
    between (both registrations belong to the plugin's own fiber).
  - **The output ring is a best-effort live preview**: stdout and stderr are copied per
    polling round, so two writes in the same window appear stdout-then-stderr rather than in
    write order. A reader that throws is logged once, that stream stops, and the job
    continues to its own settlement.
- **Edge cases:** `run_in_background` with no job runtime fails with
  `background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs`;
  `sandbox_permissions` with no sandboxing executor fails with
  `sandbox_permissions is not available in this composition (no sandboxing executor to escalate)`.
- **Surprising:** a **nonzero exit is a result for the agent to interpret**, not a tool
  error — it is reported as `[exit code: N]`.

#### `packages/shell/tool-bash/src/background.ts` and `src/render.ts`
- **`background.ts`:** the job adaptation. `processOutcome` maps a shell outcome onto a job
  status (`completed`/`killed` + `exit code: N` / `signal: SIGTERM`); `processSources`
  hands the registry **non-consuming `observed` readers** as pull sources (the registry
  pumps them on its own cadence, so a Web client sees live output while the model's
  `job_output` reads the same bytes through another cursor); `ringDelta` renders the ring
  (stdout chunks in order, every stderr chunk in one trailing `[stderr]` section);
  `processJob` owns the job hooks — including the hard case where **a process materialises
  after the job was cancelled**: it is killed and awaited, and `done` stays pending until
  the process actually exits.
- **`render.ts`:** the model-facing marker grammar — `renderResult`, `renderPromoted`,
  `renderJobRead` — plus the re-export of the shared `parseExitStatus`. It emits the
  ordered marker set: `[stderr]`, `[output truncated; full output: <path>]`,
  `[timed out after Nms]`, `[killed by signal: X]`, `[stopped: <reason>]`,
  `[exit code: N]`, and the sandbox markers
  `[sandbox: file access denied under <mode> mode]` /
  `[sandbox: the sandbox runner itself failed under <mode> mode — the command did not run;
  this is a sandbox problem, not a command failure]`.

#### `packages/shell/tool-bash-persistent/src/index.ts` — the persistent bash tool
- **Purpose:** one owner-scoped persistent bash shell per agent; cwd, exported variables,
  functions and background jobs survive across calls; commands run sequentially.
- **Non-obvious design decisions:**
  - **One shell per agent**, keyed by the exact `Agent` object; a call without an owning
    agent session fails.
  - **Marker-anchored completion.** Each command is wrapped with a **unique start/end
    nonce**, so the echoed input line (which PSReadLine/bash render back) can never
    fabricate completion. The extraction anchors on the marker.
  - **"Reset, never repair."** Any uncertain state — an explicit `exit`, a timeout, a send
    failure, an abort — **closes the shell** and the next call starts fresh from the
    workspace; the model is told so in the result (`the next bash call starts from the
    workspace with a fresh current directory and environment`).
  - **Output clipping is honest about what was lost.** Long output keeps the *earliest
    retained prefix* plus a clipping notice; **if the terminal already dropped that
    prefix, the result says so explicitly rather than presenting a tail as complete
    output**.
  - The tool's *description* is configurable (`description` config) — the model-facing
    environment contract is a deployment decision, not a hardcoded string.
- **Edge cases:** a command that needs interactive stdin blocks until the timeout and then
  resets the shell; a cancelled queued call never sends the command; cleanup publishes
  `Error: tool call aborted` with code `ABORTED` and the cancellation reason is NOT rendered
  as command output.

#### `packages/shell/tool-pwsh-persistent/src/index.ts` — the pwsh persistent twin
- **Non-obvious design decisions:**
  - **The wrapper is one physical line.** `quoteForPwsh()` escapes the model's command into
    a double-quoted string with backtick escapes (backtick first, then `"`, then `$`, then
    CR/LF/ESC) and `wrapCommand()` emits `Write-Output <start marker>; Invoke-Expression
    "<body>"; Write-Output <end marker>:<status>`. PSReadLine's wrapped echo therefore
    cannot split the echo the extraction strips.
  - **The exit status is derived, never asserted.** Native programs give the exact native
    exit code via `$LASTEXITCODE`; a PowerShell terminating error gives `1`. The parser
    accepts ASCII spaces after the status digits but still requires LF or CRLF at the end.
  - **The backend owns prompt readiness.** The tool installs and matches no prompt of its
    own — the backend's `prompt` function prints a BEL-terminated OSC marker plus a
    controlled printable prompt; the tool falls back to the backend's own readiness check
    or its silence tier.
  - **The pwsh bootstrap's echoed source cannot publish the shell** — only backend
    `stdin_read` evidence can.
  - A model that redefines `prompt` removes the readiness marker, so the shell settles on
    the silence tier instead of the marker fast path.
- **Edge cases:** under the Windows ACL sandbox's read-only mode pwsh starts in
  **ConstrainedLanguage**, which may deny the bootstrap's `[Console]::` encoding pin and
  prompt marker; SIGTSTP/SIGHUP are unavailable on Windows; SIGINT is a console-wide Ctrl-C
  input write, which at a prompt cancels the pending line rather than signalling a process.

#### `packages/shell/tool-pwsh/src/index.ts` — the one-shot pwsh tool
- **Purpose:** the pwsh twin of `tool-bash`, mirroring it call-for-call (foreground and
  background execution, the managed `DSH_*` environment, per-call sandbox policy, the
  same-turn escalation surface, the bash marker/truncation rendering, and the UI
  presentation).
- **Non-obvious:** the tool's **description teaches the two Windows restricted-token
  contracts to the model** — a read-only pwsh runs in ConstrainedLanguage (`.NET` statics,
  `Add-Type`, COM and reflection fail with "only core types"), and both confined modes deny
  named-pipe opens, so a command that captures another program's output through a pipe
  fails with EPERM; escalate that exact command once, or restructure it. A Windows forced
  termination settles as a bare `[exit code: 1]` with no signal marker, so the model is
  told to read a bare exit 1 after an interrupt as a termination, not a command failure.
- **Edge cases:** the prompt section is registered at a fixed **order 1010** so the pwsh
  tool's instructions land in a stable place in the model prompt.

#### `packages/subprocess/subprocess/src/types.ts` — the subprocess vocabulary
- **Purpose:** the spawn-spec vocabulary, with **no defaults at all**.
- **Non-obvious design decisions:**
  - **`SubprocessSpawnSpec` applies no defaults**: every stdio disposition, limit and
    directory is explicit, "so the caller's own config — not a hidden subprocess-service
    default — decides them (the `dsh-shell` request/spec split is the owning template)".
  - **Three output dispositions, all explicit:** `'pipe'` (raw `Readable` for the caller's
    own protocol framing), `'inherit'` (the child's diagnostics land on the harness's own
    stream), and a `SubprocessCollect` object (bounded in-memory **tail** + optional
    `spill` file for whole-stream recovery).
  - **Reads are offset-based and non-consuming.** `readFrom(offset)` is a projection over
    retained bytes; the offset is the caller's own coordinate in the whole stream, so a
    background reader and a final batch reader can share one stream without stealing from
    each other.
  - **Omitting `spill` keeps only the in-memory tail** — the diagnostic-tail shape (a
    language server's stderr); including it makes the complete stream recoverable up to its
    cap (the bash-tool shape).
  - `graceMs` is "available to the provider's termination procedure **and** used for
    draining still-open collected pipes after the process exits (an inherited descriptor
    held by a survivor cannot hold the outcome open indefinitely)".
  - The abort signal "starts the terminate escalation on the managed range when it fires.
    The caller owns deadlines and cause classification; this seam only reacts to the abort."
- **The terminal half:** `spawnTerminal` is "the only non-pipe process primitive" —
  implementations own terminal byte I/O, foreground groups, signals and whole-session
  quiescence. `inspectForeground()` returns a group id **and an input-wait fact**;
  `inspectActivity()` returns `idle`/`busy`/`unknown` plus a revision, and "unsupported
  shells and incomplete observations report unknown" — **an incomplete observation can never
  prove idleness**. `terminate()` is idempotent and "after settlement, no write, inspection
  or signal call remains in flight".

#### `packages/subprocess/subprocess/src/index.ts` — the seam and the scrub
- **Purpose:** the abstract `SubprocessRuntime` Service plus `scrubbedParentEnv()`.
- **Non-obvious:** `scrubbedParentEnv()` drops **credential-shaped names** (`*KEY*`,
  `*PASSWORD*`, `*SECRET*`, `*TOKEN*`) **and every `DSH_*` name**, case-insensitively, and
  keeps `PATH`. The caller cannot supply the control marker `DSH_SUBPROCESS_CONTROL=pipe`
  through `env` — the provider owns that one.

#### `packages/subprocess/subprocess-local/src/index.ts` — the host provider
- **Purpose:** the local provider: platform-selected managed ranges, Node-shaped stdio
  dispositions, credential-scrubbed environment, provider-owned range signalling.
- **Non-obvious design decisions:**
  - **It has no config at all.** Every disposition, limit, terminal size and grace arrives
    on the spawn request, so deployment-varying choices stay with the calling capability.
  - **The Linux native probe is deliberately cached.** Each probe is a `spawnSync` that
    blocks the event loop and forks the host, so `LinuxScopeSelector` re-runs it only after
    an event invalidates the previous verdict (a scope launch that never started its
    target, a different user-manager listener, or a changed `systemd-run` binary).
  - **A weaker fallback warns ONCE per provider lifetime** (`fallbackWarningIssued`) — the
    disclosure is repeated in the docs, not in the log.
  - **The native path is never replayed through the fallback.** "The provider never
    replays a command through a fallback once a native path may have started it."
  - **JavaScript-observable host exit performs synchronous final termination** — it creates
    no Promise and no timer, and it does not claim full quiescence.
- **Edge cases:** a relative executable path *containing separators* is rejected; bare names
  resolve against the scrubbed PATH with platform-aware extensions (`.COM/.EXE/.BAT/.CMD` on
  Windows); on Windows, non-terminal children and `taskkill` helpers start with their
  windows hidden so background operations do not take focus.

#### `packages/subprocess/subprocess-local/src/output.ts` — the collector and the spill
- **Key abstractions:** `OutputCollector` — keeps the last `maxBytes` of a stream in memory
  ("errors and final results cluster at the end") and, when a `spill` cap is configured,
  appends the complete stream to a private file.
- **Non-obvious design decisions:**
  - **The spill file is created `0600`, `O_EXCL`, randomly named, inside a `0700`
    per-process directory** under the OS temp dir — this resists symlink planting in a
    shared temp directory.
  - **A stream larger than the spill cap discards its now-incomplete spill** and returns
    only the marked truncated tail. Never a partial file presented as complete.
  - **Spilling is best-effort and never interrupts collection.** When the spill file cannot
    be opened or appended (the per-process directory removed by a temp cleaner, `EACCES`,
    `EMFILE`, `ENOSPC`), the collector discards the spill, logs **one** `error` through the
    plugin logger, and keeps collecting the in-memory tail — so the result is truncated with
    no spill path.
  - **Collection runs inside the stream's `'data'` listener** — throwing there would kill
    the host process, so the failure path is explicitly non-throwing.
  - `seal()` closes the spill fd; a delayed writeback failure stops advertising the path
  ("the file may be missing its tail") while every in-memory read keeps working. Both
  collectors are sealed at settlement so reads after exit never point at a still-open file.
  - `snapshot()` returns the retained raw bytes and the total byte count, so a remote
    adapter can preserve offsets without forwarding the complete stream.

#### `packages/subprocess/subprocess-local/src/spawn.ts` — spawn plumbing
- **Key abstractions:** `childEnv(extra)`, `SpawnInternals` (injectable spawn, spill dir,
  spill-failure reporter, taskkill, platform override, Linux group probe),
  `LocalSubprocessHandle.terminateForHostExit()` (a local-only, synchronous, timerless
  final termination deliberately **absent from the public seam**).
- **Non-obvious design decisions:**
  - **The env merge is platform-aware.** On Windows the caller's entries are
    case-insensitively folded (the inherited entry is removed before the caller's is
    pushed), because Windows environment keys are case-insensitive and Node's own merge is
    not.
  - **An explicit `undefined` value is a tombstone** that removes an ordinary ambient
    entry; a string restores or overrides one.
  - **POSIX owners stage TERM before KILL; Windows owners terminate immediately.**
  - **The liveness-poll timer stays ref'd.** "An awaited teardown must keep the event loop
    alive until the tree really exits, or the parent can exit while claiming quiescence and
    orphan the survivors it promised to reap."
  - **`killGroup` never throws**, even for EPERM-style failures.
- **Edge cases:** the abort signal starts the same termination procedure as `terminate()`.

#### `packages/subprocess/subprocess-local/src/process-inspector.ts` — the process table
- **Key abstractions:** `ProcessIdentity { pid, started }` — "PID plus start identity,
  preventing teardown escalation after PID reuse"; `ProcessSnapshot` (`tree`, `session`,
  `alive`); `ProcessInspector` (`foregroundPgid`, `isStdinWaiting`, `snapshot`, `isAlive`,
  `signalGroup`, `signalProcess`).
- **Non-obvious design decisions:**
  - **The process table is read at most once per poll**, on the first question that needs it
    — a `/bin/ps` fork on macOS, a `/proc` walk on Linux, a Toolhelp32 enumeration on
    Windows. Later questions never re-read it, "which is what keeps a poll's cost
    independent of how many descendants the running command spawned".
  - **Windows liveness needs no table at all** — the wait state is a per-handle question, so
    a snapshot asked only for liveness never enumerates (the Windows teardown polls exactly
    this way, every 25 ms).
  - **A snapshot answers what the table showed; signalling must not use it.**
    `isAlive` is the fence a signal takes because it reads current state instead. "An
    observation taken earlier in the same round cannot stand in for it: the observation
    preserves the original PID-to-start-time pairing, so a recycled PID would still match."
  - **An unreadable process table refuses to publish an empty snapshot** — it throws
    (`/proc directory is unreadable`) instead of returning "no processes", because an empty
    table would be a false claim of quiescence.
  - **No stdin-wait claim is made when the process or task directories cannot be
    enumerated.**

#### `packages/subprocess/subprocess-local/src/linux-scope.ts` + `linux-scope-selector.ts`
- **Purpose:** Linux native containment through a temporary **user-systemd scope**.
- **Non-obvious design decisions:**
  - **`--expand-environment=no` is added only on systemd ≥ 254**; before v254 the option is
    rejected, and the scope mode "passes argv to execvpe unexpanded" anyway, so the option
    is simply dropped. The literal-argv guarantee is what stops `$VAR` in a command from
    being expanded by the systemd unit.
  - **The user manager is identified by a listening socket** in the kernel's unix socket
    table at `$XDG_RUNTIME_DIR/systemd/private` — the socket `systemd-run --user` connects
    to. Reading the table costs time proportional to the table's size.
  - **A positive verdict confirms the manager on every selection** (a listener needs no
    child process; otherwise one `systemctl --user show` query decides, and a failed query
    means *this* spawn uses the fallback).
  - **A negative verdict re-probes only when a different listener appears** — a manager
    started later is then usable without a restart.
  - **A scope that launched but never consumed its launch request** (a wedged but listening
    manager) makes that command fail, and the scope launch that preceded the failure also
  fails; the next eligible spawn re-probes.
  - **The bootstrap clears `FD_CLOEXEC` on fd 0-2 (and fd 7) and then calls libc
    `execve()` directly** — the target never runs under Node.
  - **`waitForExit()` proves the scope is empty independently** — including the case where
    the payload was killed before entering the scope's cgroup, so the manager keeps the
    scope active with no processes.
  - **A scope that failed to start reports `LinuxScopeNotStartedError`** so the caller can
    attribute the failure to the launcher rather than the command.

#### `packages/subprocess/subprocess-local/src/runner-launch.ts` + `runner-protocol.ts` + `spawn-runner.ts` + `linux-execve.ts`
- **Purpose:** the private one-shot runner: source, built and packaged forms, a closed
  protocol, and the Windows Job runner.
- **Non-obvious design decisions:**
  - **One private environment variable** (`DSH_SUBPROCESS_RUNNER`) carries the selection and
    is **consumed and deleted** before target state is restored.
  - **The bootstrap environment is stripped of `NODE_*` and `TSX_*`** — the bootstrap must
    not inherit the parent's loader state.
  - **The Linux launch request travels through a private file**, not an inherited pipe:
    `0700` directory, `0600` random-named files, removed after the bootstrap consumes them.
    The Windows path uses an IPC message with the same shape.
  - **The protocol is closed:** an unrecognised `control` value, a malformed start message,
    or a duplicate start all **fail closed** with an `error` message rather than being
    tolerated.
  - **Windows spawn errors are mapped to Node's vocabulary** (`ENOENT`, `EPERM`, `EACCES`,
    `EFTYPE`) so a Windows runner and a direct Node spawn produce the *same* error shape —
    the tests compare them for parity.
  - **The Linux `execve` binding is loaded lazily through Koffi** and **cached**; the
    `fcntl(F_GETFD/F_SETFD)` dance is asserted in tests down to the exact call sequence.

#### `packages/subprocess/subprocess-local/src/terminal.ts` — the node-pty terminal handle
- **Non-obvious design decisions:**
  - **The seam's "no write, inspection or signal in flight after settlement" guarantee
    holds here without operation tracking** — "only because every handle call completes
    synchronously under the hood (node-pty write, ps-based inspection). A first genuinely
    asynchronous step in any handle call must add the tracking a remote provider needs."
    (A TODO in the file records this debt.)
  - **Output backpressure pauses the native reader until the consumer drains**, and an
    explicit termination **resumes the paused read** so the exit notification is received.
  - **On Windows, a missing exit event is itself the outcome.** An externally task-killed
    shell may never fire node-pty's exit notification (its console-list agent fails without
    a parent console), which would leave `done` — and every consumer awaiting it —
    unsettled forever. Teardown has already verified the shell's absence through the
    inspector, so the missing event is settled as `{ exitCode: null, signal: null }`.
  - **The root process's start identity is captured at allocation**; scans stop adopting
    members once the root pid no longer carries it (PID-reuse fencing).

#### `packages/subprocess/subprocess-local/src/shell-activity.ts`
- **Purpose:** optional `shellActivity` — the provider installs a private lifecycle
  recorder in a plain non-login `bash -i` / `zsh -i` **while preserving the user's startup
  files and prompt configuration**.
- **Non-obvious:** bash needs 4.4+ and permission to write the prompt hook; zsh observes an
  empty top-level ZLE prompt, excluding `vared`, selection and continuation prompts.
  **Foreground, background and stopped descendant tasks block the idle judgement.** Native
  Linux additionally requires **exactly one task** in the systemd scope, which covers work
  outside the process tree that is still owned by the scope. An incomplete process-table
  scan, a custom trap, or a zsh async fd handler all report **unknown**. "Process-table
  enumeration failure rejects the observation; activity stays unknown and cleanup retains
  ownership until the table is readable and verification can complete."
- **Surprising:** with activity enabled, **the root process exiting does not terminate
  still-running descendants.**

#### `packages/subprocess/win32-process/src/process.ts` + `ffi.ts` + `abi.ts`
- **Purpose:** the one reusable Win32 binding table for the sandbox and the ordinary runner.
- **Non-obvious design decisions:**
  - **`quoteArg()` implements `CommandLineToArgvW` quoting exactly** (backslashes doubled
    before a quote, trailing backslashes doubled), and the test suite round-trips it
    against the real `CommandLineToArgvW` on Windows.
  - **The target starts SUSPENDED and is assigned to a kill-on-close Job BEFORE it is
    resumed** — "target code cannot run before Job assignment". A controlled assignment or
    resume failure terminates the suspended child or closes the assigned Job before
    releasing every owned handle.
  - **`STARTF_USESHOWWINDOW` with `SW_HIDE` is set, but `CREATE_NO_WINDOW` and
    `CREATE_NEW_CONSOLE` are deliberately NOT** — they can fail DLL initialization under the
    restricted token. Console inheritance is preserved; existing parent console windows are
    not hidden.
  - **`CreateProcessAsUserW` passes a NULL environment block** because an explicit block
    through Koffi fails with `ERROR_INVALID_PARAMETER`; the sandbox establishes changes
    through `SetEnvironmentVariableW` first. The ordinary `CreateProcessW` runner does the
    opposite — it requires the **complete** target environment and passes a sorted,
    double-NUL-terminated UTF-16LE block including `=X:` drive entries, without mutating
    its own environment.
  - **The fd-7 control pipe rides in `STARTUPINFO.cbReserved2/lpReserved2`** as an
    eight-slot CRT descriptor table (standard handles, closed slots 3-6, the control pipe at
    slot 7). Initialising the slot before Node starts avoids overwriting descriptors Node
    has already allocated.
  - **`GetLastError` is captured BEFORE any cleanup** — the tests pin that the reported
    `win32Code` is the one the failing call produced, not the one a later `CloseHandle`
    overwrote.
  - **Every Koffi out-parameter and struct allocation is freed after its Win32 lifetime**;
    the allocation-cleanup test counts `free` calls exactly.
  - **The ABI constants are verified against the MinGW headers** by `verify/abi-probe.cpp`,
    which `static_assert`s every value `abi.ts` asserts — including the 104-byte
    `STARTUPINFOW`, the 24-byte `PROCESS_INFORMATION`, the 48-byte Job accounting record and
    the 40-byte `ActiveProcesses` offset. Koffi's own struct sizes are asserted at module
    load.

#### `packages/terminal/terminal/src/index.ts` + `src/types.ts` — the `ctx.terminals` seam
- **Purpose:** persistent, owner-scoped terminal sessions.
- **Non-obvious design decisions:**
  - **The service owns everything except terminal mechanics**: session identity, publication,
    authorization and cleanup. The backend owns how a session starts, detects readiness,
    retains output and shuts down. "The service publishes a session only after backend
    setup succeeds."
  - **Fencing uses the exact `Agent` object**, and `hasOwnerActivity(owner)` spans
    unpublished setup through final close **with no publication gap** — so a lifecycle
    policy can fence the owner precisely even mid-spawn.
  - **The send reservation is synchronous and happens BEFORE the operation is returned**,
    including before a background job id becomes visible. A second send fails with
    `SEND_ACTIVE`, "so output and cancellation never cross operation ownership".
  - **Machine-routable failure codes**: `NO_BACKEND`, `NO_SESSION`, `FOREIGN_SESSION`,
    `SEND_ACTIVE`, `OWNER_NOT_LIVE`, `DUPLICATE_BACKEND`, `DUPLICATE_NAME`,
    `SERVICE_DISPOSING`. A model can branch on a code, not on prose.
  - **A backend that cannot clean partial startup resources rejects with
    `TerminalBackendCleanupError`** (an `AggregateError` carrying both failures), and the
    service **retains that failure as tracked owner activity** until owner or service
    disposal consumes and reports it — a rollback failure is never swallowed.
  - **Caller cancellation keeps its exact `AbortSignal.reason`** — even when the rollback
    also failed, the cancellation is the error the caller sees.
  - **Teardown is best-effort but never claims false success**: a close failure still clears
    the registries and runs the owner detachers before the aggregated error propagates, so
    "one stuck session cannot orphan backends, reservations, or owner detachers".

#### `packages/terminal/terminal-bash/src/session.ts` — the persistent shell session
- **Purpose:** the readiness model, the bounded output buffer, cancellation and close.
- **Non-obvious design decisions:**
  - **Three bounded readiness tiers settle a send:** exact stdin-wait evidence from the
    subprocess provider (Linux only), the verified private prompt marker with an exact
    printable tail, and output silence (`inferred_idle`). An absolute timeout always
    bounds the wait.
  - **"An `inferred_idle` or `timeout` result does not prove the foreground command
    exited."** Silence is a *bound*, not a proof.
  - **A prompt candidate can race bash's foreground handoff**, and an interactive child also
    inherits `PROMPT_COMMAND` — so silence remains the bound on waiting for shell ownership,
    "instead of letting a child marker suppress readiness until the absolute timeout".
  - **A marker whose printable tail has not arrived yet holds the send on the exact path**
    for `promptTailGraceMs` beyond `idleSilenceMs + handoffGraceMs`, because the marker and
    its tail are written by the same prompt render — a missing tail is a delivery delay, not
    an absent prompt. A tail that arrived and was then invalidated by later output can no
    longer complete, so it keeps the plain bound.
  - **Evidence collected before the provider write is discarded at the write boundary**, and
    a stdin wait that predates the write is not post-write readiness.
  - **Unknown foreground state is never a positive exact-idle signal.**
  - **Cancellation sends a REAL `SIGINT` to the current foreground process group** after
    any in-flight provider write settles. It "never emulates interruption by writing
    `\x03`".
  - **Closing stops readiness polling but retains the active operation** — teardown settles
    it as `session_exit`, "so an in-flight send is never mis-settled as
    stdin_read/inferred_idle/timeout during the grace period".
  - **`BoundedTextBuffer` is amortized:** appending and evicting costs time proportional to
    the incoming text; reads assemble the retained chunks. The head never grows, so eviction
    never rescans a growing string. It preserves code-point boundaries, counts the empty
    line after a trailing newline, and keeps the truncation flag **sticky**.
  - **The incremental buffer is pinned against an eager reference buffer** byte for byte,
    including lone surrogates — a `ReferenceBuffer` in the test computes the same result
    the slow way and the two are compared on every chunk.

#### `packages/terminal/terminal-bash/src/index.ts` — the shell backend
- **Non-obvious design decisions:**
  - **One backend serves both dialects** (bash and pwsh) — the same sanitizer, buffers,
    readiness polling, cancellation and teardown; only argv, environment and prompt
    installation differ.
  - **Bash's `PROMPT_COMMAND` re-asserts `PS1` after the marker** — bash runs
    `PROMPT_COMMAND` before rendering each prompt, so an override never survives to the next
    prompt. The real-shell test proves the prompt is *healed* after an in-shell `PS1=`
    override.
  - **The pwsh prompt function builds the control bytes at runtime** (`[char]27`,
    `[char]7`) because raw ESC characters in submitted input are unreliable under
    PSReadLine.
  - **The pwsh startup loop shares ONE absolute deadline** across every retry, so an
    `inferred_idle` follow-up does not restart the bound.
  - **The sandbox-mode fence is attached to the exact owner and outlives a provider
    reload.** A write that would change the effective sandbox mode is rejected *before* the
    `sandbox/mode` event commits while that owner has an open session or a spawn in
    progress — "so a terminal opened with wider access cannot survive a downgrade".
  - **Confinement preparation receives the opening signal**; cancellation prevents
    terminal allocation even if the provider returns later (a test proves `spawnTerminal`
    is never called).
  - **Startup failure rolls the session back to quiescence before the open is rejected** —
    and a rollback failure becomes a `TerminalBackendCleanupError`.
  - **`PS1`/`PROMPT_COMMAND` are not sent to pwsh** — it ignores them; its prompt is
    installed by the bootstrap, and `NO_COLOR` keeps the renderer quiet.

#### `packages/terminal/terminal-bash/src/config.ts` and `src/sanitize.ts`
- **Non-obvious:** `resolveConfig()` treats **emptiness, not just `undefined`, as "use the
  dialect default"** — because Schemastery materializes an absent optional array as `[]`,
  and a real bash spawn would otherwise start non-interactive without the controlled prompt.
  `validateConfig()` asserts every numeric field is a positive safe integer **except
  `promptTailGraceMs`, whose zero is the documented "no extension" value**, and it enforces
  the *composition* rules between the bounds: `maxReadBytes ≤ scrollbackMaxBytes`,
  `handoffGraceMs ≥ pollIntervalMs` ("so one readiness poll runs inside the grace window"),
  and `promptTailGraceMs` is zero or ≥ `pollIntervalMs` ("so a nonzero tolerance contains
  one readiness poll").
- **The sanitizer** removes CSI/OSC/short escape sequences while preserving **split-sequence
  carry** across chunks; it bounds an unterminated sequence by **discarding it through its
  terminator** rather than buffering it forever; it normalizes CRLF and standalone CR to
  LF and removes BEL; and it tracks the printable tail after the owned prompt marker.

### Tier 2 — bulk: one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/shell/README.md` | Package-group doc for the bash capability family: the 10 packages, the `ctx.shell`/`ctx.shellEnv`/`ctx.tools` keys, and the rule that a profile mounts **exactly one** executor (two fail loudly at load time on duplicate service registration). |
| `packages/shell/README.zh.md` | Chinese translation of the above; same decisions, same package table. |
| `packages/shell/bash-local/README.md` | The executor contract in prose: budget table (`cwd`, `timeoutMs` 120s, `maxTimeoutMs` 600s, `maxOutputBytes` 64 KB, `maxSpillBytes` 64 MB, `graceMs` 3s), the request→spec→execute flow, **runtime-adjustable budgets** (volatile config sampled when resolving each command), the environment layering invariant, and the honest limitation that a background provider-failure note *is* the whole stderr stream. |
| `packages/shell/bash-local/README.zh.md` | Chinese translation of the above. |
| `packages/shell/bash-local/package.json` | Peer deps pin the seam contracts (`dsh-shell`, `dsh-subprocess`, `dsh-timeout`, `cordis`); the only runtime dep is `schemastery`. |
| `packages/shell/bash-local/tsconfig.json` | Project references: `shell/shell`, `subprocess/subprocess`, `util/brand`, `util/timeout`, vendor `cosmokit`/`cordis`/`schemastery`. |
| `packages/shell/bash-local/tests/executor.spec.ts` | The real-process contract: budget clamping, mutually-exclusive timeout/abort classification, self-SIGTERM is neither, consuming `readOutput` (never re-delivers), `[stderr]` section marking, spill paths, kill escalation to SIGKILL after `graceMs`, provider-rejection-as-stderr exactly once, unprintable rejection values contained, and **background processes surviving executor disposal but dying with the subprocess service**. |
| `packages/shell/bash-local/tests/settings.spec.ts` | Live config through Loader updates: budgets change without remounting; an unusable stored budget fails at the *next command*, not at the profile write. |
| `packages/shell/bash-sandbox/README.md` | The confinement contract: the three modes and their file effects, **denials are result facts** (never a silent retry), fail-closed `SANDBOX_UNAVAILABLE`, the exact model-visible markers (`[sandbox: file access denied under <mode> mode]`, the escalation-available marker, the runner-failure marker), and the KV-cache effect of each. |
| `packages/shell/bash-sandbox/README.zh.md` | Chinese translation of the above. |
| `packages/shell/bash-sandbox/package.json` | Peer deps add `dsh-sandbox` + `dsh-sandbox-policy`; dev deps add the three real runner backends. |
| `packages/shell/bash-sandbox/tsconfig.json` | Adds references to `sandbox/sandbox`, `sandbox/sandbox-policy`, `shell/bash-local`. |
| `packages/shell/bash-sandbox/locale/en.json` | UI string: the panel title `bash-sandbox`. |
| `packages/shell/bash-sandbox/locale/zh.json` | Chinese UI string for the same panel title plus a one-line description. |
| `packages/shell/bash-sandbox/tests/bwrap.e2e.ts` | Real bwrap integration (self-skipping when bwrap/userns is unavailable): read-only denies a write (file must NOT exist), workspace-write allows inside and denies beside, background denial classification, and the **approved escalated retry landing the exact write read-only denied**. |
| `packages/shell/bash-sandbox/tests/fixtures/async-confinement-failure.ts` | Snapshot fixture: a refusing sandbox plus a **spawn tripwire** that writes `confinement-audit.json` — proves a refused confinement never allocates a process. |
| `packages/shell/bash-sandbox/tests/fixtures/pending-confinement.ts` | Snapshot fixture: a never-settling confinement plus a process-allocation tripwire — proves a preparation timeout never allocates a process. |
| `packages/shell/bash-sandbox/tests/foreground-timeout.spec.ts` | **One foreground deadline covers sandbox preparation and native execution**: a late preparation success/rejection never spawns; the *remaining* deadline is passed to execution instead of restarting it; upstream cancellation wins when it lands first; timeout stays the first cause when a later caller abort follows the notification; a pre-existing cancellation never prepares. |
| `packages/shell/bash-sandbox/tests/landlock.e2e.ts` | Real Landlock integration: reads the kernel's enforcement level from the launcher probe and asserts the stamped facts match it (`full` vs `partial`). |
| `packages/shell/bash-sandbox/tests/partial-landlock.spec.ts` | Deterministic runner-classification proofs: missing/unexecutable/missing-interpreter runners, bare-name vs relative `argv[0]` forms, a malformed executable staying ordinary, the partial-enforcement notice NOT being a denial, and **a fatal line after the notice outranking denial text**. |
| `packages/shell/bash-sandbox/tests/sandbox.spec.ts` | The consumer-side unit contract with a fake provider: exact argv hand-off, no consumer-side caching of the wrap, fail-closed propagation, `danger-full-access` never consulting the provider, per-call policy overriding the default, overlapping background jobs keeping their **own** wrap facts, and the conservative denial classifier (bare EPERM is not a Linux denial). |
| `packages/shell/bash-sandbox/tests/seatbelt.e2e.ts` | Real macOS Seatbelt integration, including the proof that `BASH_ENV` is evaluated only **after** Seatbelt confines the inner Bash (the hook can write inside, not outside). |
| `packages/shell/pwsh-local/README.md` | The pwsh executor contract: executable resolution order, the one-argv `-Command` rule, UTF-8 pinning, and the honest limitations (Windows termination reports no signal; the encoding preamble blocks `param(...)`/`#requires`/`using`; non-ASCII stdin may mis-decode under PS 5.1). |
| `packages/shell/pwsh-local/README.zh.md` | Chinese translation of the above. |
| `packages/shell/pwsh-local/package.json` | Same peer/dep shape as `bash-local` (seam contracts only). |
| `packages/shell/pwsh-local/tests/executor.spec.ts` | The pwsh twin of the bash suite plus pure-everywhere tests: Windows candidate ordering, the `lstat` symlink acceptance, argv shape (one element after `-Command`, preamble prepended), background provider-failure as the whole stderr stream, and platform-conditional signal assertions. |
| `packages/shell/pwsh-local/tests/settings.spec.ts` | Live config: budgets and `pwshPath` change without remounting; an unusable budget fails at the next command. |
| `packages/shell/pwsh-local/tsconfig.json` | Same reference shape as `bash-local`. |
| `packages/shell/pwsh-sandbox/README.md` | The pwsh confinement twin: the ACL restricted-token chain on Windows vs bwrap/Landlock/Seatbelt elsewhere, the shared denial surface with the bash tool, and the honest Windows limitations (reads unrestricted, private temp authority per session/workspace, read-only grants no writable root but stays partial because of NTFS hard links and AppContainer ACLs). |
| `packages/shell/pwsh-sandbox/README.zh.md` | Chinese translation of the above. |
| `packages/shell/pwsh-sandbox/package.json` | Peer deps add `dsh-pwsh-local`/`dsh-sandbox`/`dsh-sandbox-policy`; dev deps add the real runner backends. |
| `packages/shell/pwsh-sandbox/tests/acl.e2e.ts` | Real Windows ACL e2e: read-only denies writes but not reads; workspace-write grants the workspace plus a **private** temp directory; the ambient temp root and an escape write are denied. |
| `packages/shell/pwsh-sandbox/tests/foreground-timeout.spec.ts` | One deadline spans confinement preparation and native execution; a late preparation never spawns. |
| `packages/shell/pwsh-sandbox/tests/sandbox.spec.ts` | Consumer-side unit contract: pure helper tests, a synchronous spawn rejection split into *attributable to the runner* vs *foreign*, fail-closed on runner refusal. |
| `packages/shell/pwsh-sandbox/tsconfig.json` | Adds `sandbox/sandbox-policy` and `shell/pwsh-local` project references. |
| `packages/shell/shell-env/README.md` | The managed `DSH_*` namespace: built-ins (`DSH_HOME`, `DSH_SHELL=1`, `DSH_SESSION_ID`, `DSH_PROFILE`, `DSH_PROFILE_DIR`), the contributor declaration contract with a code example, reserved keys, and fail-loud duplicate ownership. |
| `packages/shell/shell-env/README.zh.md` | Chinese translation of the above. |
| `packages/shell/shell-env/locale/en.json` | UI panel title only. |
| `packages/shell/shell-env/locale/zh.json` | Chinese UI panel title + description. |
| `packages/shell/shell-env/package.json` | Peer deps `dsh-app-boot`/`dsh-home-paths`/`dsh-shell`/`dsh-tools`. |
| `packages/shell/shell-env/tests/shell-env.spec.ts` | Registry contract: built-ins, the launcher-provided profile facts, reserved-key rejection, the `dshHome` resolution order, declared contributor variables, undeclared/non-string rejection, and effect-scoped disposal. |
| `packages/shell/shell-env/tsconfig.json` | References `shell/shell`, `util/home-paths`, `core/tools`, `boot/app-boot`. |
| `packages/shell/shell/README.md` | The `ctx.shell` seam contract: one execution with two projections, the request/spec split, the two expiry policies, and the shared exit-status marker. |
| `packages/shell/shell/README.zh.md` | Chinese translation; the honest limitation list (no interactive-input vocabulary — stdin is written once at spawn and closed; no PTY session concept). |
| `packages/shell/shell/package.json` | Peer deps `dsh-subprocess` + `dsh-sandbox`; no runtime deps. |
| `packages/shell/shell/tests/render.spec.ts` | The parse contract: a marker needs a leading newline AND the end of the string; a timeout marker no pill shows stays in the body; a signal marker wins over a nonzero exit marker. |
| `packages/shell/shell/tests/service.spec.ts` | The seam contract: one execution, two views; a second implementation throws on duplicate service registration. |
| `packages/shell/shell/tsconfig.json` | References `subprocess/subprocess` and `sandbox/sandbox`. |
| `packages/shell/tool-bash-persistent/README.md` | The owner-scoped persistent bash tool: one shell per agent, marker-anchored extraction, reset-never-repair, the exact model-visible status markers (`[Command finished with exit code N]`, `[shell exited: code N]`, `[shell killed by signal: SIG]`, `[shell exited]`). |
| `packages/shell/tool-bash-persistent/README.zh.md` | Chinese translation of the above. |
| `packages/shell/tool-bash-persistent/locale/en.json` | UI panel title only. |
| `packages/shell/tool-bash-persistent/locale/zh.json` | Chinese UI panel title + description. |
| `packages/shell/tool-bash-persistent/package.json` | Peer deps `dsh-agent`/`dsh-output-retention`/`dsh-terminal`/`dsh-timeout`/`dsh-tools`/`dsh-working-directory`. |
| `packages/shell/tool-bash-persistent/tests/loader-composition.spec.ts` | A real `cordis.yml` Loader composition: cwd/env persist, multiline/heredoc/pipeline, trailing newlines, exit codes, large output clipping, `exec` replacing the wrapper, and `exit` resetting the shell. |
| `packages/shell/tool-bash-persistent/tests/tools.spec.ts` | A 25-mode stub-PTY contract: readiness fallback, the exit paths, surrogate-pair clipping, cancellation vs timeout, and config validation. |
| `packages/shell/tool-bash-persistent/tsconfig.json` | References `terminal/terminal`, `util/output-retention`, `util/timeout`, `session/working-directory`. |
| `packages/shell/tool-bash/README.md` | The one-shot model-facing bash tool: foreground-as-job, promote-on-timeout hand-over, sandbox escalation, and the exact model-visible markers and error strings. |
| `packages/shell/tool-bash/README.zh.md` | Chinese translation of the above; the fullest prose account of the job-ring semantics (best-effort live preview, stdout-before-stderr within a polling window). |
| `packages/shell/tool-bash/locale/en.json` | UI panel title only. |
| `packages/shell/tool-bash/locale/zh.json` | Chinese UI panel title + description. |
| `packages/shell/tool-bash/package.json` | Peer deps include `dsh-jobs`, `dsh-user-approval`, `dsh-sandbox-policy`, `dsh-shell-env`, `dsh-working-directory`. |
| `packages/shell/tool-bash/tests/background-start.spec.ts` | Job ownership during async shell startup: observation stays empty until the process is published; abort reaches the job-owned signal; a process that materialises after cancellation is killed and awaited. |
| `packages/shell/tool-bash/tests/background.spec.ts` | The foreground-as-job contract: promotion hand-over, the settled record leaving the registry, the outside-kill reason, preparation timeout, owner fencing (another session cannot read it), and admission refusal. |
| `packages/shell/tool-bash/tests/integration.spec.ts` | A full agent-loop integration with a mock model: real bash through the tool, session-cwd logging, the `DSH_*` scrub, and a background wake plus `job_output`. |
| `packages/shell/tool-bash/tests/tools.spec.ts` | The consumer-surface suite (1521 lines, read in full): schema shape, argument validation, the prompt section, the background surface following the registry, the sandbox escalation matrix, the UI presenters, and the named-args-only request. |
| `packages/shell/tool-bash/tsconfig.json` | References `core/tools`, `core/agent`, `shell/shell`, `jobs/jobs`, `interaction/user-approval`, `sandbox/*`. |
| `packages/shell/tool-pwsh-persistent/README.md` | The pwsh persistent twin: backend-owned prompt readiness, PSReadLine echo stripping, reset-never-repair, and the Windows-specific limitations (SIGTSTP/SIGHUP unavailable; ConstrainedLanguage blocking the bootstrap). |
| `packages/shell/tool-pwsh-persistent/README.zh.md` | Chinese translation of the above; the source map and the command flow (one physical line, marker-anchored extraction, 1000-line scrollback paging). |
| `packages/shell/tool-pwsh-persistent/locale/en.json` | UI panel title only. |
| `packages/shell/tool-pwsh-persistent/locale/zh.json` | Chinese UI panel title + description. |
| `packages/shell/tool-pwsh-persistent/package.json` | Same peer/dep shape as `tool-bash-persistent`. |
| `packages/shell/tool-pwsh-persistent/tests/loader-composition.spec.ts` | A real Loader composition with a readiness timeline; asserts the exact settle-reason sequence per command and distinguishes the bundled OpenConsole from the unused system conhost. |
| `packages/shell/tool-pwsh-persistent/tests/readiness-timeline.spec.ts` | The unit contract for the diagnostic timeline: prompt-evidence replay (exact tail, invalidated tail, pending prefix, absent marker), per-send windows, control-byte escaping. |
| `packages/shell/tool-pwsh-persistent/tests/readiness-timeline.ts` | The `ReadinessTimeline` diagnostic helper — it records PTY chunks, foreground polls and writes, and formats a human-readable failure timeline with the host facts. A model of how to make a flaky timing path debuggable. |
| `packages/shell/tool-pwsh-persistent/tests/tools.spec.ts` | The stub-PTY contract: echoed-wrapper stripping, a padded completion status, prompt collision, a split status line, cancellation vs timeout, and config validation. |
| `packages/shell/tool-pwsh-persistent/tsconfig.json` | References `terminal/terminal`, `util/output-retention`, `util/timeout`, `session/working-directory`. |
| `packages/shell/tool-pwsh/README.md` | The one-shot pwsh tool: bash parity, the Windows sandbox contracts taught to the model, and the prompt section registered at order 1010. |
| `packages/shell/tool-pwsh/README.zh.md` | Chinese translation of the above; the fullest prose account of the Windows-specific sandbox behaviour taught in the tool description. |
| `packages/shell/tool-pwsh/locale/en.json` | UI panel title only. |
| `packages/shell/tool-pwsh/locale/zh.json` | Chinese UI panel title + description. |
| `packages/shell/tool-pwsh/package.json` | Peer deps add `dsh-user-approval`, `dsh-jobs`, `dsh-sandbox-policy`, `dsh-working-directory`. |
| `packages/shell/tool-pwsh/src/background.ts` | The job adaptation twin of `tool-bash` (identical contract, different module; the whole file is inside a `jscpd:ignore` block). |
| `packages/shell/tool-pwsh/src/render.ts` | `renderPwshResult`/`renderPwshPromoted`/`renderPwshJobRead` — the pwsh marker grammar, the bash twin with its own module. |
| `packages/shell/tool-pwsh/tests/background-start.spec.ts` | Job ownership during async shell startup (the pwsh twin of the bash suite). |
| `packages/shell/tool-pwsh/tests/background.spec.ts` | The foreground-as-job contract for pwsh: promotion, the outside-kill reason, preparation timeout, owner fencing, admission refusal, and the `ringDelta`/`processSources` shapes. |
| `packages/shell/tool-pwsh/tests/fixtures/loader/cordis.yml` | A minimal real `tool-pwsh` composition (system-prompt, fs, projections, working-directory, tools, subprocess, pwsh-local, shell-env, jobs, tool-jobs, tool-pwsh). |
| `packages/shell/tool-pwsh/tests/fixtures/loader/driver.ts` | A boot-and-drive script that runs one real foreground and one real background pwsh call and writes a JSON report. |
| `packages/shell/tool-pwsh/tests/integration.spec.ts` | The real pwsh executor through the tool: stdout, the stderr section, the exit-code marker, timeout, abort, and background via `job_output`. |
| `packages/shell/tool-pwsh/tests/loader.spec.ts` | The REAL-composition tier: boots the fixture as a subprocess through the app/boot path and asserts the assembled model-visible surface. |
| `packages/shell/tool-pwsh/tests/tools.spec.ts` | The consumer-surface suite over a fake executor (1267 lines, read in full): schema, argument validation, per-session sandbox policy, the escalation matrix, the background surface, and the UI presenters. |
| `packages/shell/tool-pwsh/tsconfig.json` | References `core/tools`, `core/agent`, `shell/shell`, `shell/shell-env`, `jobs/jobs`, `interaction/user-approval`, `sandbox/*`. |
| `packages/subprocess/README.md` | The subprocess group map: the service, the local provider, and `win32-process`; "The service keeps process lifetime across consumer reloads; consumers own what a process means." |
| `packages/subprocess/README.zh.md` | Chinese translation of the group map. |
| `packages/subprocess/subprocess-local/README.md` | The local host provider: executable lookup, tail-keep collection with spill, native managed ranges with **disclosed weaker fallbacks**, the control transport, terminal sessions, shell activity, close behaviour, and the full limitation list (Linux direct exit has no deadline; native ownership has explicit host requirements; the credential scrub is a name heuristic; completed spill files are never deleted; a deleted spill directory is not recreated). |
| `packages/subprocess/subprocess-local/README.zh.md` | Chinese translation of the above; the longest limitation list in the shard, and the place where the "fallback can miss an escaped descendant" caveat is stated plainly. |
| `packages/subprocess/subprocess-local/locale/en.json` | UI panel title only. |
| `packages/subprocess/subprocess-local/locale/zh.json` | Chinese UI panel title + description. |
| `packages/subprocess/subprocess-local/package.json` | Peer deps `dsh-subprocess` + `cordis`; the runtime deps include `node-pty`. |
| `packages/subprocess/subprocess-local/scripts/ensure-spawn-helper.mjs` | A tiny build-time helper that ensures the spawn runner helper exists. |
| `packages/subprocess/subprocess-local/src/bin.ts` | The runner entry point — the private one-shot bootstrap. |
| `packages/subprocess/subprocess-local/src/control-spawn.ts` | `controlPipe`/`controlEnvironment` — the fd-7 control-channel wiring; the provider owns the marker and the caller cannot supply it. |
| `packages/subprocess/subprocess-local/src/managed-owner.ts` | `BoundProcessOwner` — the per-handle private signal/wait owner — and `waitWithAbort`, which reports whether the managed-range wait completed *before* the cancellation. |
| `packages/subprocess/subprocess-local/src/runner-launch.ts` | The runner invocation resolution across the source, built and packaged forms; the bootstrap-safe environment (with `NODE_*`/`TSX_*` stripped); the target-argv parsing behind a private delimiter. |
| `packages/subprocess/subprocess-local/src/runner-protocol.ts` | The closed runner protocol: the private launch files, the startup-error file, the Windows IPC messages, and the best-effort cleanup that never reuses a directory. |
| `packages/subprocess/subprocess-local/src/shell-activity.ts` | The `shellActivity` recorder for bash/zsh: the lifecycle markers, the idle/busy/unknown judgement, and the task-count requirement. |
| `packages/subprocess/subprocess-local/src/spawn-runner.ts` | The one-shot Linux exec bootstrap and the Windows Job-owning runner: the Win32→Node error-code mapping, the Job assignment, and the fail-closed protocol handling. |
| `packages/subprocess/subprocess-local/src/windows-inspector.ts` | The Windows Toolhelp32 process-table inspector behind Koffi; the `isInvalidHandle` check and the per-handle liveness read that avoids a table walk. |
| `packages/subprocess/subprocess-local/src/windows-job.ts` | The Windows Job capability probe and the helper-runner launch (the runner's own stdio is isolated from the target's). |
| `packages/subprocess/subprocess-local/tests/control.spec.ts` | The control-pipe contract: exact binary bytes through both the managed and fallback backends, the caller endpoint destroyed on disposal, and the channel absent on an ordinary spawn. |
| `packages/subprocess/subprocess-local/tests/fixtures/control-child.ts` | A child that opens fd 7 and writes to it. |
| `packages/subprocess/subprocess-local/tests/fixtures/hold-linux-bootstrap.ts` | Holds the Linux bootstrap open (the wedged-manager case). |
| `packages/subprocess/subprocess-local/tests/fixtures/managed-tree.ts` | A managed process tree used by the containment tests. |
| `packages/subprocess/subprocess-local/tests/fixtures/process-exit-host.ts` | A child host that publishes a managed tree and then exits via dispose / direct `process.exit` / uncaught exception / unhandled rejection. |
| `packages/subprocess/subprocess-local/tests/linux-execve.spec.ts` | The libc `execve` binding contract: the exact `fcntl` call sequence, the errno surfaced as `ENOENT`, and `EBADF` reported *before* the process is replaced. |
| `packages/subprocess/subprocess-local/tests/linux-scope-selector.spec.ts` | The selector unit contract: the probe triggers (`first`, `scope-not-started`, `new-listener`, `launcher-changed`), the manager confirmation, and the fallback reasons. |
| `packages/subprocess/subprocess-local/tests/linux-scope.spec.ts` | Large (57.6 KB) — head 180 + tail 90 read: scope launch, the systemctl state machine, the literal-argv option detection, and the startup-error file protocol. |
| `packages/subprocess/subprocess-local/tests/local.spec.ts` | Large (59.0 KB) — head 220 + tail 120 read: the local provider's end-to-end contract (a second implementation throws; a non-existent cwd yields a stopped settlement). |
| `packages/subprocess/subprocess-local/tests/native-containment.spec.ts` | The real containment e2e: a descendant that reparents (or calls `setsid`) stays inside the scope and is reaped with it. |
| `packages/subprocess/subprocess-local/tests/native-windows.spec.ts` | The real Windows Job e2e: ordinary descendants keep visible console windows off, raw stdin stays writable while the runner starts the target, and the spawn-error shape matches a direct Node spawn. |
| `packages/subprocess/subprocess-local/tests/process-exit.spec.ts` | The host-exit finalization contract: the exit-phase synchronous termination, and the owned-listener bookkeeping. |
| `packages/subprocess/subprocess-local/tests/process-inspector.spec.ts` | The inspector unit contract: an unreadable `/proc` refuses to publish an empty snapshot (`EACCES`/`EMFILE`); no stdin-wait claim without enumeration; the `/proc` field parsing. |
| `packages/subprocess/subprocess-local/tests/shell-activity-files.spec.ts` | The shell-activity private-file contract. |
| `packages/subprocess/subprocess-local/tests/shell-activity.spec.ts` | The shell-activity unit contract: the idle/busy/unknown revision semantics. |
| `packages/subprocess/subprocess-local/tests/spawn-runner-built.e2e.ts` | The e2e that proves the source entry and the built `./runner` subpath reach the same provider-owned core. |
| `packages/subprocess/subprocess-local/tests/spawn-runner.spec.ts` | Large (43.5 KB) — head 160 + tail 80 read: the closed runner protocol, the Windows Job lifecycle, and fail-closed handling of malformed and duplicate messages. |
| `packages/subprocess/subprocess-local/tests/spawn.spec.ts` | Large (63.4 KB) — head 180 + tail 90 read: the spawn plumbing — the spill directory's `0700` mode, `killGroup` never throwing, and `AbortSignal` handling. |
| `packages/subprocess/subprocess-local/tests/terminal.spec.ts` | Large (39.5 KB) — head 160 + tail 80 read: the terminal handle — backpressure, quiescence, and the activity inspection tiers. |
| `packages/subprocess/subprocess-local/tests/windows-inspector.spec.ts` | The Windows inspector contract: no Toolhelp32 walk for a liveness-only question (the teardown polls every 25 ms), a children-first walk with readable identities only, and termination on a parent cycle. |
| `packages/subprocess/subprocess-local/tests/windows-job.spec.ts` | The Windows Job runner contract: the IPC start/terminate handshake, a late `EPIPE` isolated, and the synchronous host-exit termination. |
| `packages/subprocess/subprocess-local/tsconfig.json` | The project references for the local provider. |
| `packages/subprocess/subprocess-local/tsdown.config.ts` | The bundle entry points, including the `./runner` subpath. |
| `packages/subprocess/subprocess/README.md` | The `ctx.subprocess` seam contract: explicit spawn specs, the three output dispositions, offset reads, managed ranges, the control pipe, terminal sessions, the scrubbed environment, and the failure modes. |
| `packages/subprocess/subprocess/README.zh.md` | Chinese translation of the seam README. |
| `packages/subprocess/subprocess/package.json` | Peer deps only; no runtime dependencies. |
| `packages/subprocess/subprocess/src/control.ts` | `openInheritedControlChannel` — the fd-7 helper the provider owns; it consumes the provider's `DSH_SUBPROCESS_CONTROL=pipe` marker. |
| `packages/subprocess/subprocess/tests/control.spec.ts` | The control-pipe helper contract. |
| `packages/subprocess/subprocess/tests/egress.spec.ts` | The scrub contract: credential-shaped and `DSH_` names dropped case-insensitively; `PATH` kept; an ordinary name kept. |
| `packages/subprocess/subprocess/tests/service.spec.ts` | The seam contract: one subprocess service per context; a duplicate registration throws `service "subprocess" has been registered`. |
| `packages/subprocess/subprocess/tsconfig.json` | The references for the seam package. |
| `packages/subprocess/subprocess/tsdown.config.ts` | The bundle entry points for the seam package. |
| `packages/subprocess/win32-process/README.md` | The shared Win32 binding table: restricted-token creation, the piped/inherited-stdio/Job primitives, the ordinary settlement operations, the inherited control descriptor, the header verification, and the handle-lifetime limits. |
| `packages/subprocess/win32-process/README.zh.md` | Chinese translation of the win32-process README. |
| `packages/subprocess/win32-process/package.json` | Runtime deps `koffi 3.1.1` + `dsh-lazy-require`; no runtime Cordis coupling. |
| `packages/subprocess/win32-process/src/abi.ts` | The verified x64 Win32 constants and the structure sizes/offsets (`STARTUPINFOW` 104, `PROCESS_INFORMATION` 24, Job accounting 48 with `ActiveProcesses` at 40). |
| `packages/subprocess/win32-process/src/control-stdio.ts` | The CRT descriptor table for the inherited fd-7 control pipe: eight slots, slots 3-6 closed, the control pipe at slot 7, and the pipe-type check. |
| `packages/subprocess/win32-process/src/errors.ts` | `Win32Error` — the API name and the exact Win32 code, with the system message appended when available. |
| `packages/subprocess/win32-process/src/koffi.ts` | The process-realm lazy Koffi loader. |
| `packages/subprocess/win32-process/src/index.ts` | The public surface of the Win32 primitives. |
| `packages/subprocess/win32-process/tests/ffi.spec.ts` | The ABI unit contract: the verified sizes, NULL out-parameters, and the exact Win32 error formatting. |
| `packages/subprocess/win32-process/tests/fixtures/console-state.ts` | Reports the inherited console's visibility from a real Windows child (via Koffi). |
| `packages/subprocess/win32-process/tests/ordinary-process.spec.ts` | The ordinary Job runner contract: the fd-7 carrier table bytes, the sorted UTF-16LE environment block (with `=C:` drive entries), the invalid-handle rejection *before* the target is created, and the non-blocking exit/Job-empty polls. |
| `packages/subprocess/win32-process/tests/process-allocation-failure.spec.ts` | The allocation-cleanup contract: every Koffi out-parameter freed exactly once, the drain count slot reused and freed at EOF. |
| `packages/subprocess/win32-process/tests/process-failure-paths.spec.ts` | The failure-path contract: every handle closed before the throw (six pipe handles on a failed `CreateProcessAsUserW`); the last error captured *before* the cleanup that changes it; the suspended child terminated before the Job is closed. |
| `packages/subprocess/win32-process/tests/process.spec.ts` | The restricted-token contract: create → assign → resume ordering, the inheritance bits restored on failure, and the null-thread-handle case. |
| `packages/subprocess/win32-process/tests/quote.spec.ts` | The command-line quoting contract plus a `CommandLineToArgvW` round-trip on Windows. |
| `packages/subprocess/win32-process/tsconfig.json` | References `cordis` and `util/lazy-require`. |
| `packages/subprocess/win32-process/verify/abi-probe.cpp` | The native ABI probe: `static_assert`s pinning every constant the TypeScript `abi.ts` asserts, checked against the MinGW headers. |
| `packages/terminal/README.md` | The package map for the persistent PTY capability family: the session service and the shell backend. |
| `packages/terminal/README.zh.md` | Chinese translation of the terminal package map. |
| `packages/terminal/terminal-bash/README.md` | The shipped shell backend: the dialects, the configuration table, the three readiness tiers, sandboxing and the mode fence, and the observable outcomes. |
| `packages/terminal/terminal-bash/README.zh.md` | Chinese translation of the terminal-bash README. |
| `packages/terminal/terminal-bash/locale/en.json` | UI panel title only. |
| `packages/terminal/terminal-bash/locale/zh.json` | Chinese UI panel title + description. |
| `packages/terminal/terminal-bash/package.json` | Peer deps `dsh-terminal`/`dsh-sandbox*`/`dsh-subprocess`/`dsh-session`; runtime deps `@xterm/headless` + `dsh-pwsh-local`. |
| `packages/terminal/terminal-bash/tests/config.spec.ts` | The config contract: the positive bounds, `handoffGrace ≥ pollInterval`, `promptTailGrace` zero-or-`pollInterval`, and "empty shell values mean the dialect default". |
| `packages/terminal/terminal-bash/tests/index.spec.ts` | The backend contract: startup rollback, the aggregate cleanup failure, the confinement argv and policy, the pwsh bootstrap, the one-deadline bound over pwsh startup retries, and the owner-lifetime sandbox fence. |
| `packages/terminal/terminal-bash/tests/local.spec.ts` | The real-shell e2e: state persists across sends, secrets are scrubbed, an in-shell `PS1` override is healed, a `/dev/tty` foreground read is recognized, a foreground command is signalled with a real `SIGINT`, a disowned descendant is quiesced, and pwsh pins UTF-8 output. |
| `packages/terminal/terminal-bash/tests/sanitize.spec.ts` | The sanitizer contract: split CSI/OSC removal, the owned prompt marker detection, CRLF/CR normalization, and the bounded discard of an unterminated sequence. |
| `packages/terminal/terminal-bash/tests/session-buffer.spec.ts` | The incremental-retention compatibility suite: the incremental buffer is compared against an eager reference buffer byte for byte across byte caps and line caps, including lone and split surrogates. |
| `packages/terminal/terminal-bash/tests/session.spec.ts` | Large (72.1 KB) — head 180 + tail 90 read: the readiness tiers, the output collection, and close-during-send (a closing send settles as `session_exit`, never as a readiness reason). |
| `packages/terminal/terminal-bash/tsconfig.json` | The project references for the shell backend. |
| `packages/terminal/terminal/README.md` | The `ctx.terminals` seam contract: opaque ids, exact-owner fencing, the four wait reasons, the machine-routable error codes, and the design concept ("the service owns everything except terminal mechanics"). |
| `packages/terminal/terminal/README.zh.md` | Chinese translation of the terminal seam README. |
| `packages/terminal/terminal/locale/en.json` | UI panel title only. |
| `packages/terminal/terminal/locale/zh.json` | Chinese UI panel title + description. |
| `packages/terminal/terminal/package.json` | Peer deps `dsh-agent`/`dsh-brand`/`cordis`. |
| `packages/terminal/terminal/tests/service.spec.ts` | The service contract: publication only after spawn, exact-owner fencing, duplicate names and reservations, the rollback aggregation, the disposal ordering, and the "clears registries even when a close fails" rule. |
| `packages/terminal/terminal/tsconfig.json` | References `cordis`, `core/agent`, `util/brand`. |

### Tier 3 — skipped, with the reason

All 18 are the same artefact: a **generated bilingual-pairing consistency record**
(`README.i18n.yaml`) holding per-heading English/Chinese content hashes for the
neighbouring `README.md`. Each was opened at the head to confirm that is all it is; none is
source, logic, or decision content.

| File | Why not read line by line |
| --- | --- |
| `packages/shell/README.i18n.yaml` | Generated bilingual-pairing hash record; head peeked. |
| `packages/shell/bash-local/README.i18n.yaml` | Same generated pairing record. |
| `packages/shell/bash-sandbox/README.i18n.yaml` | Same generated pairing record. |
| `packages/shell/pwsh-local/README.i18n.yaml` | Same generated pairing record. |
| `packages/shell/pwsh-sandbox/README.i18n.yaml` | Same generated pairing record. |
| `packages/shell/shell-env/README.i18n.yaml` | Same generated pairing record. |
| `packages/shell/shell/README.i18n.yaml` | Same generated pairing record. |
| `packages/shell/tool-bash-persistent/README.i18n.yaml` | Same generated pairing record. |
| `packages/shell/tool-bash/README.i18n.yaml` | Same generated pairing record. |
| `packages/shell/tool-pwsh-persistent/README.i18n.yaml` | Same generated pairing record. |
| `packages/shell/tool-pwsh/README.i18n.yaml` | Same generated pairing record. |
| `packages/subprocess/README.i18n.yaml` | Same generated pairing record. |
| `packages/subprocess/subprocess-local/README.i18n.yaml` | Same generated pairing record. |
| `packages/subprocess/subprocess/README.i18n.yaml` | Same generated pairing record. |
| `packages/subprocess/win32-process/README.i18n.yaml` | Same generated pairing record. |
| `packages/terminal/README.i18n.yaml` | Same generated pairing record. |
| `packages/terminal/terminal-bash/README.i18n.yaml` | Same generated pairing record. |
| `packages/terminal/terminal/README.i18n.yaml` | Same generated pairing record. |

---

## 2. Ideas worth stealing

1. **The request/spec split, applied twice.** `ShellExecRequest` (the caller's intent,
   optional fields) is resolved into `ShellExecSpec` (fully specified) by the *executor*,
   and `SubprocessSpawnSpec` applies **no defaults at all** — "the caller's own config, not
   a hidden subprocess-service default, decides them". August Trading has several places
   where a default is applied in two layers; adopting "the request layer owns intent, the
   provider layer owns the resolved spec, and the spec is the only thing that crosses the
   seam" would remove a whole class of drift.

2. **First-cause classification with mutually exclusive flags.** `timedOut` and `aborted`
   can never both be true; the cause that actually cut the command short is the one
   reported, and a command that SIGTERMs *itself* is neither. August's `utils/runStatus.ts`
   is the natural home for the same rule.

3. **A denial is a *fact on the result*, not an exception.** The sandbox stamp
   `{ mode, denied, enforcement, runnerFailed }` rides the result; the executor never
   grants permission and never retries silently; the model-facing layer adds ONE marker
   line. August's approval flow could adopt "the refusal is data, the retry is a separate
   narrow action".

4. **Escalation: narrow, once-only, justified, and approved.** `ESCALATION_TARGETS` is an
   explicit set; repeating the current mode needs no approval; a *narrower* request fails
   before execution; a wider one needs a non-empty reason and a user approval; the
   request is refused for good after a denial. Four rules, no ambiguity.

5. **Offset-based, non-consuming reads.** `readFrom(offset)` is a projection over retained
   bytes; the offset is the caller's coordinate in the whole stream, so a live reader and a
   final reader coexist without stealing from each other. This is exactly the property
   August's live transcript and final transcript both need.

6. **Bounded tail + a spill file whose loss is stated honestly.** In-memory tail (the errors
   and the final result cluster at the end) plus a `0600` file in a `0700` per-process
   directory for the whole stream; a stream over the spill cap *discards* the incomplete
   file rather than presenting a partial one; a spill that cannot be written is dropped
   with one logged error and the result is simply truncated.

7. **"Reset, never repair."** Any uncertain state in a persistent session (an `exit`, a
   timeout, a send failure, an abort) closes the shell and the next call starts fresh —
   and the model is *told* so in the result text. A repaired session is a session whose
   state nobody can reason about.

8. **Marker-anchored completion.** Unique per-command nonces wrapped around the command so
   an echoed input line can never fabricate completion; the echo is stripped by anchoring on
   the marker. Any interactive protocol August builds should do the same rather than
   pattern-matching "looks like a prompt".

---

## 3. Trading-specific findings

1. **Promote a long foreground run instead of killing it.** `promoteOnTimeout` keeps a
   command that reaches its deadline running as its background job, and the model gets
   `[still running after <timeoutMs>ms; moved to background job <id>]` plus a hand-off
   instruction and a **single consuming read** so the background reader continues from
   exactly that point. August's long analyses (Monte Carlo, backtests, a provider's long
   reconcile) would lose nothing at the timeout boundary.

2. **Foreground work is a job from its start.** With a job registry, *every* command is
   registered as it starts — a foreground command is listed, streamable and stoppable while
   it runs, and only its id is withheld from the model if it finishes in time. August's
   agent/bot runs already have a job-like concept; making the *foreground* case a job too
   is what makes a run stoppable from the UI without a special path.

3. **Exact-owner fencing, not owner-id fencing.** `ctx.terminals` fences on the exact
   `Agent` object, and `hasOwnerActivity(owner)` spans unpublished setup through final
   close with no publication gap. August's bots and agents could use the same fence so one
   session's job cannot be read, listed or killed by another — and so a mid-spawn agent
   cannot be orphaned.

4. **Scrub the child environment by name shape, and do it in ONE place.**
   `scrubbedParentEnv()` drops `*KEY*`/`*PASSWORD*`/`*SECRET*`/`*TOKEN*` and every `DSH_*`
   from the ambient environment before the caller's explicit entries are merged. August's
   Electron main process spawns real processes; the same single-source scrub applies there.

5. **One marker grammar, one inverse parser.** `[exit code: N]`, `[timed out after Nms]`,
   `[killed by signal: X]`, `[stopped: reason]`, `[output truncated; full output: path]` —
   and `parseExitStatus`, the *inverse* function, owned by the same package the writer
   lives in. August's `utils/runStatus.ts` is the analogous home; adding the inverse (text →
   facts) would let the transcript, the UI card and the model all read one grammar.

6. **State the clipping honestly, with the amount.** "Long output keeps the earliest
   retained prefix plus a clipping notice; **if the terminal has already dropped that
   prefix, the result says so explicitly rather than presenting a tail as complete
   output**." August's `utils/harnessMarks.ts` clipping notes already name how much was
   kept; DSH's version additionally promises the model the *path* to the full output.

---

## 4. Non-obvious decisions and gotchas

- **"Foreground" is a property of what the caller awaits, not of the spawn.** The same
  handle serves both; `onExpiry: 'none'` + keeping the handle = background.
- **`done` never rejects.** A spawn failure settles as `killed` with the error on the read
  path; `result()` carries the same failure as its rejection. `result()` is memoized and
  created on demand, so a background producer never observes it.
- **A provider rejection becomes the whole stderr stream**, and it is folded in exactly
  once by the consuming read — a subtle double-count trap the code comments explicitly.
- **`shell` is a single service per context.** Loading a second executor throws at load
  time. That is what makes "exactly one executor per profile" enforceable rather than
  aspirational.
- **The sandbox executor decorates the handle in place.** It must: `processFacts` and
  `onProcessDone` key on the exact instance, so wrapping it in a second object would break
  the fact lookup.
- **The failure classification is backend-relative.** The same stderr ("Permission denied")
  is a denial under Seatbelt's dialect and ordinary DAC under bwrap's. The *active* wrap
  carries the signature list.
- **The runner's failure outranks the denial.** "The command never ran" and "the command was
  denied" are different facts, and the second would be a lie.
- **A provider rejection is attributed to the runner only when the error independently names
  `argv[0]`** — and the cwd is independently ruled out first, so a caller's missing working
  directory is not blamed on the sandbox.
- **The pwsh deadline reason string is `'BASH_TIMEOUT'`** — a copy-paste from the bash
  executor that survives into the pwsh twin and is harmless only because the reason is
  compared internally.
- **The Windows PowerShell 5.1 fallback writes the OEM code page.** The UTF-8 preamble
  pins it — and it rides on line 1 so PowerShell error line numbers stay accurate — but it
  also means a command starting with `param(...)`, `#requires` or `using` cannot run.
- **`lstat`, not `stat`, for executable resolution.** The Microsoft Store execution alias
  stats as `EACCES` but lstats as a link, and `CreateProcess` resolves either shape.
- **A `dsh-shell` background process survives executor disposal** — the process belongs to
  the subprocess *service*, not to the executor. HMR-safe by accident, and tested.
- **The Linux native probe is cached because it forks the host.** It is re-run only when an
  event invalidates the verdict, and a *negative* verdict re-probes only when a different
  user-manager listener appears.
- **`--expand-environment=no` exists to keep argv literal.** Without it, systemd expands
  `$VAR` in the command line — the one thing the scope launch must not do.
- **The process table is read once per poll.** A poll's cost is independent of how many
  descendants the command spawned; Windows avoids the table entirely for liveness.
- **PID reuse is fenced with a start identity.** A snapshot is not a valid basis for
  signalling; `isAlive` reads current state immediately before the signal.
- **An unreadable process table throws instead of reporting "no processes".** An empty
  table would be a false claim of quiescence.
- **The spill file is `0600`, `O_EXCL`, randomly named, in a `0700` per-process
  directory** — and a *deleted* spill directory is never recreated, so every later spill in
  that process degrades to the in-memory tail with one logged error.
- **The Windows target starts suspended and is assigned to its kill-on-close Job before it
  is resumed.** Target code cannot run before the assignment. But the create-to-assignment
  window is not atomic: an external kill of the runner in that interval can leave a
  suspended target behind.
- **`GetLastError` is captured before any cleanup.** Otherwise the reported code belongs to
  the cleanup, not to the failure.
- **`CREATE_NO_WINDOW` and `CREATE_NEW_CONSOLE` are deliberately not used** — they can fail
  DLL initialization under a restricted token.
- **The fd-7 control pipe is a CRT descriptor table in `STARTUPINFO.cbReserved2`.**
  Initialising slot 7 before Node starts avoids overwriting descriptors Node already
  allocated.
- **A sandbox-mode change is rejected before the `sandbox/mode` event commits** while the
  owner has an open session — "a terminal opened with wider access cannot survive a
  downgrade". The fence is attached to the exact owner and outlives a provider reload.
- **Readiness is a bound, not a proof.** `inferred_idle` means silence; it does not mean the
  foreground command exited. An interactive child that inherits `PROMPT_COMMAND` can
  suppress the marker path until the absolute timeout.
- **The prompt-marker tail gets its own grace window.** The marker and its tail are written
  by the same render, so a missing tail is a delivery delay on a contended host — but a
  tail that arrived and was then invalidated can no longer complete, so it keeps the plain
  bound.
- **Cancellation sends a real `SIGINT` to the foreground process group** — never a `\x03`
  write. On Windows it is a console-wide Ctrl-C input write, which at a prompt cancels the
  pending line instead of signalling a process.
- **Closing stops readiness polling but keeps the active operation**, so an in-flight send
  settles as `session_exit` and never as a readiness reason.
- **The whole repo accepts deliberate duplication for platform twins** (`/* jscpd:ignore */`
  blocks naming the mirror relationship). The mitigation is documentation, not enforcement.

---

## 5. Weak spots

1. **The credential scrub is a name heuristic only.** `*KEY*`, `*PASSWORD*`, `*SECRET*`,
   `*TOKEN*` — a `*PASSPHRASE*` secret still reaches the child. The README names a
   whitelist as deferred work, which means the current behaviour is "drop what we can
   name", not "drop what is a credential".
2. **Linux direct-process exit has no independent deadline.** After a `SIGKILL` is
   acknowledged, uninterruptible kernel I/O can make dispose wait indefinitely; `graceMs`
   and the scope-query polling budget do not bound that wait.
3. **Fallback process ownership is observation-only.** A descendant that reparents or
   leaves the session *before the first snapshot* escapes the process-table sweep on macOS
   and on Linux without a user manager. The provider explicitly declines to add a
   continuous watcher, so the guarantee degrades silently on those hosts.
4. **Readiness is heuristic without the exact tier.** macOS and Windows settle on the
   prompt marker and silence, so `inferred_idle` is indistinguishable from "the command
   really finished" — and the model is told the difference in prose it must honour.
5. **The persistent PowerShell tool evaluates the model's command inside a wrapper string**
   (`Invoke-Expression "<escaped body>"`), and the completion detection depends on the
   model not printing the nonce. The code argues the nonce makes fabrication impossible; it
   does not make evaluation safe.
6. **Completed spill files accumulate.** The bounded full-output recovery files are never
   deleted by the provider — the per-process directory survives at exit if it holds one —
   so a long-running host accumulates them until an external cleaner runs.

---

*Read on 2026-10-22. Nothing in the reference repository was executed, installed, built
or tested; the only writes were to this report and the status ledger. No PII, credential
or `.env` file was read.*
