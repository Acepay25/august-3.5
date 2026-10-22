# deepseek-harness :: dsh-sandbox-fs-storage

**Files in shard:** 231 (read: 213, skipped with reason: 18)
**What this shard covers:** the harness's *capability seams* — the four seams that decide what an agent may read, write, run, and remember. `packages/fs` is the filesystem seam: an abstract `ctx.fs` provider contract (`fs/`), a host backend (`fs-local/`), a sandbox-enforcing backend (`fs-sandbox/`), a read-before-edit policy plugin (`fs-observation-policy/`), and the model-facing tools (`tool-fs/`, `tool-fs-search/`, `tool-str-replace-editor/`). `packages/sandbox` is the process-confinement seam: the vocabulary and escalation choreography (`sandbox/`), the shared per-session policy resolver (`sandbox-policy/`), the per-platform runners (`sandbox-local/`), and the Windows restricted-token backend (`sandbox-windows-acl/`). `packages/storage` is the durable-state seam: a backend registry (`storage/`), a schema-validated change-emitting domain form (`storage-domain/`), and two media (`storage-json/`, `storage-sqlite/`). The unifying idea across all three is the same: **the policy is a plugin that observes events, not a method on the provider** — so a backend can be swapped without touching the tools, and the guard can be removed without breaking anything.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/fs/fs` — the `ctx.fs` contract

##### `packages/fs/fs/src/index.ts`
- **Purpose:** the abstract filesystem service (`ctx.fs`) every backend implements, plus the three `fs/*` policy events that decouple tools from policy.
- **Key abstractions:** `FileSystem` (abstract `Service`), the `fs/write-intent` / `fs/edit-intent` waterfall events and the `fs/observed` recorder event (`packages/fs/fs/src/index.ts:59`, `:67`, `:77`).
- **Data flow:** every operation starts at `resolve(path, {cwd})` → an `FsTarget {targetKey, displayPath}`. `targetKey` is a *branded opaque* string; `displayPath` is the only field a consumer may show. `stat` → `readText`/`streamText`/`readBytes`/`readByteRange`; `listDir`; mutations through `writeText`/`editText` with an optional guard.
- **Non-obvious design decisions:**
  - The base class deliberately has **no** observation policy. `sandboxMode` returns `undefined` (`packages/fs/fs/src/index.ts:119`) so the tool layer can *advertise* escalation fields honestly instead of offering a lever that does nothing.
  - `readBytes` **requires** `maxBytes` and fails `FS_TOO_LARGE` rather than truncating; `readByteRange` is bounded by its *window* instead, so the caller's `length` cap is the guard. Two different bounding strategies because the threat is different (whole file vs. window).
  - `editText` stays *on the seam* — version check, literal match, and atomic rewrite share one critical section, so "one wins, the rest see stale" is correct by construction rather than by convention.
  - The seam arms **no I/O deadline**. A deadline would kill work the OS still finishes; cancellation is a best-effort `AbortSignal` at syscall boundaries.
- **Edge cases & failure handling:** every read/list/mutation failure is a typed `FsError` with a stable code; `watch` rejects with `FS_IO_ERROR` on providers that do not support it (no polling fallback); `processPathFromHostPath` returns `undefined` rather than guessing.
- **Surprising:** the `fs/observed` event is documented as "listeners must be synchronous recorders: throws fail the tool call and returned promises are not awaited" (`packages/fs/fs/src/index.ts:74-76`) — a *successful mutation can still surface as an error* to the model if a listener throws.

##### `packages/fs/fs/src/types.ts`
- **Purpose:** the vocabulary: opaque target/version identities, stat shapes, the write-intent union, and the error taxonomy.
- **Key abstractions:** `FsTargetKey` / `FsVersion` (branded strings, `packages/fs/fs/src/types.ts:27`, `:43`), `FsObservation = present@version | absent` (`:52`), `FsWriteIntent = createIfAbsent | replaceIfVersion` (`:123`), `FsErrorCode` (`:175`), `FsError extends HarnessError` (`:196`).
- **Data flow:** types only; the branding functions are identity at runtime — they exist to make the compiler reject a consumer parsing a target key.
- **Non-obvious design decisions:**
  - `FsObservation` has **three** logical states across the two variants plus "unseen": unseen, confirmed-absent, present-at-a-version. The policy layer treats all three differently (see `fs-observation-policy`).
  - `FsWriteIntent` has only two arms. "Unconditional create-or-overwrite" is expressed by *omitting* the intent, not by a third union member — omission is a distinct state in the type system, which is why the provider's `expected?` parameter is optional.
  - `FsPathInfo` (lstat) is deliberately *path-shaped* while `FsInfo` (stat) is *target-shaped*: `resolve` follows symlinks, `lstat` lets a consumer reject a repo-owned link *before* the follow happens.
  - `FsError` extends `HarnessError` so it carries a stable `code` through the tool registry's `isError` channel — consumers branch on the code, never on message text.
- **Edge cases & failure handling:** the code union is closed and machine-routable; `before`/`after` in `FsWriteOutcome` are raw text, never a diff — the *consumer* computes a contextual diff at result time.
- **Surprising:** `FsWriteOutcome.before` is `null` for a create, but also for a binary prior file, a non-UTF-8 prior file, or a prior file at/above the diff bound. "No diff basis" and "nothing was there" are the same null.

#### `packages/fs/fs-local` — the host backend

##### `packages/fs/fs-local/src/index.ts`
- **Purpose:** the `ctx.fs` implementation over the real host filesystem.
- **Key abstractions:** `LocalFileSystem extends FileSystem` (`packages/fs/fs-local/src/index.ts:63`), `Config {cwd, diffBasisMaxBytes}`, and a per-target FIFO lock map (`:104`).
- **Data flow:** `resolve` → `resolveLocalTarget` (realpath identity). `writeText` probes, enforces the guard, captures a bounded `before` diff basis, calls `writeFileAtomic`, re-probes, returns the new version. `editText` probes, checks the guard **before** literal matching, reads, applies the literal edit, restores line endings, republishes — all inside the same per-target lock.
- **Non-obvious design decisions:**
  - **One mutation critical section per target.** `withLock` (`:118`) is a FIFO chain per `targetKey`; the read→guard→write window cannot interleave, so two concurrent writers deterministically produce one winner and one `FS_STALE_VERSION`. The lock map entry is deleted in a `finally` when it is the tail, so the map does not leak.
  - The **stale guard is checked before literal matching** (`packages/fs/fs-local/src/index.ts:257-270`). An edit based on an old read reports `FS_STALE_VERSION`, never a misleading "old_string not found" against newer content. This is the single most important ordering decision in the file.
  - A **missing target on an edit reports `FS_STALE_VERSION` even with no version guard** — the freshness framing is preserved across the guarded and unguarded paths.
  - `createIfAbsent` onto an existing file reports `FS_NOT_OBSERVED` ("cannot overwrite existing X without reading it first"), not a generic conflict.
  - `diffBasisMaxBytes` is validated at construction against `min(Buffer.MAX_LENGTH, Buffer.MAX_STRING_LENGTH)` — a cap above the runtime's real allocation ceiling is rejected rather than silently truncated.
- **Edge cases & failure handling:** abort is checked before and after every async probe; the "before" diff basis is best-effort — a binary prior file, an at-limit file, or a file that grew after the probe still writes successfully with `before: null`; the post-write probe finding the file absent (a concurrent unlink between rename and stat) falls back to a `missing:<key>` sentinel version.
- **Surprising:** the lock is **in-process only**. A cross-process writer is caught only by the optional version guard observing a metadata change; replacement writers are never serialized across processes.

##### `packages/fs/fs-local/src/fsio.ts`
- **Purpose:** all Cordis-free raw filesystem mechanics — the file that can be unit-tested without the plugin runtime.
- **Key abstractions:** `resolveLocalTarget` (`:161`), `probe` / `probeNoFollow`, `readWholeText` / `readWholeBytes` / `readByteWindow` / `streamWholeText`, `readTextForDiff` (`:750`), `writeFileAtomic` (`:588`), `applyLiteralEdit` (`:814`), `normalizeLineEndings` / `restoreLineEndings`, and the `FsIoInternals` test-hook table.
- **Data flow:** `writeFileAtomic` stages into a **private owner-only directory next to the target** (`.name.pid.uuid.tmpdir`, mode `0700`), opens the temp file `wx` at `0600`, writes, `fsync`s, then publishes: a hard-link no-replace for `createIfAbsent`, `ReplaceFileW` on Windows, `rename()` elsewhere. The staging directory is removed afterwards.
- **Non-obvious design decisions:**
  - **Realpath-derived identity, with the nearest-existing-ancestor walk.** For a missing target, `resolveLocalTarget` realpaths the deepest existing ancestor and re-appends the missing suffix, so the key is *stable across creation* — including when an ancestor is a symlink. Without this, an observed state recorded before a create would not match the target after it.
  - **Two different publish primitives for two different guarantees.** `createIfAbsent` publishes with `link()` — a *no-replace* primitive, so a concurrent creator's file is preserved and this write is rejected `FS_NOT_OBSERVED`. Unconditional/guarded replacement uses `rename()`/`ReplaceFileW`, which *does* replace. A backend that used rename for both would silently clobber a concurrent creator.
  - **The diff basis is read from the open descriptor, not a prior stat.** `readTextForDiff` (`:750`) opens the file, stats *the handle*, allocates `size + 1` bytes, and reads. A file that grew after the caller's preflight cannot make this helper buffer more than `maxBytes`.
  - **Line endings are normalized for the diff basis but restored on write-back.** `readForEdit` detects the dominant style (CRLF vs LF, sampled over the first 4096 chars); edits are applied on LF and written back in the original style. A lone `\r` not followed by `\n` is left alone.
  - **The binary detector is deliberately asymmetric** and the README says so: reads NUL-sample only the first 8192 bytes, edits scan the whole buffer. A file with a late NUL reads fine but rejects edits.
  - Windows DACL preservation: the target's descriptor is copied onto the *empty temp file* before content is written, and `ReplaceFileW` preserves the target descriptor at publication (`packages/fs/fs-local/src/win32.ts:139`).
- **Edge cases & failure handling:** a non-ENOENT/ENOTDIR metadata fault propagates (it is a real permission/IO fault, not absence); `ENOTDIR` (a path component is a file) is normalized to `FS_NOT_FOUND` with a clear message; the mid-read `AbortError` Node throws is translated into `FS_ABORTED`; post-commit staging-cleanup failure is swallowed on purpose (the write is committed; owner-only residue cannot un-commit it).
- **Surprising:** `localDisplayPath` preserves *physical* parent traversal on POSIX — `symlink/..` reaches the parent of the link target, filesystem semantics first, lexical normalization second. Windows keeps native drive-relative normalization.

##### `packages/fs/fs-local/src/win32.ts`
- **Purpose:** Windows security-descriptor helpers for atomic replacement, with Koffi loaded lazily.
- **Key abstractions:** `readFileDaclWin32`, `copyFileDaclWin32`, `replaceFileWin32`, plus a private `win32()` lazy binder.
- **Data flow:** `GetFileSecurityW` (two-phase: size probe then fill) → `SetFileSecurityW` with `DACL | PROTECTED_DACL` → `ReplaceFileW`.
- **Non-obvious design decisions:** Koffi is imported **inside** `win32()` so a non-Windows process never opens `advapi32.dll`; the DACL is installed with `PROTECTED_DACL_SECURITY_INFORMATION` so the staging parent cannot inject an inherited ACE onto the temp file.
- **Edge cases & failure handling:** Win32 codes are mapped to Node-style errno strings (`ENOENT`/`EACCES`/`EIO`) with the raw `win32Code`, `syscall`, and `path` preserved on the error.
- **Surprising:** the module is import-safe on any platform; the failure is deferred to the first call.

#### `packages/fs/fs-observation-policy` — the read-before-edit plugin

##### `packages/fs/fs-observation-policy/src/index.ts`
- **Purpose:** the plugin that makes a mutation require a prior observation, without being a service the tools inject.
- **Key abstractions:** `ObservedStateGate` (`:21`), a `WeakMap<object, Map<string, FsObservation>>` keyed by *owner* then `targetKey` (`:28`); `writeIntent` (`:65`), `editIntent` (`:78`), `observe`.
- **Data flow:** `fs/observed` records a presence or absence for the owner; `fs/write-intent` and `fs/edit-intent` convert that record into the provider's optional guard.
- **Non-obvious design decisions:**
  - **The plugin registers no service and injects nothing.** `apply` (`:106`) mounts with no `inject` and exposes no `ctx.fsPolicy`. Removing it leaves the bare provider's unconditional behavior instead of breaking the tools. This is the seam-split idea in its purest form.
  - **The owner is the agent's session object, held weakly.** The map is `WeakMap<object, Map<...>>` so a collected session frees its state; the package never reads a field of the session — it only uses object identity.
  - **The intent slot is single-slot and first-wins.** The plugin decides outright and never calls `next()`; the waterfall is deferred through `Promise.resolve().then(...)` so a throw becomes a rejection instead of escaping synchronously through the waterfall (`:119`, `:122`).
  - **The `fs/observed` recorder must stay synchronous and non-throwing.** It is a plain `ctx.emit` after the mutation already committed; a throwing listener cannot roll the write back.
- **Edge cases & failure handling:** an actor with no session (a direct tool call) has no owner, so its edits always fail `FS_NOT_OBSERVED` and its writes always resolve `createIfAbsent` — a non-agent caller can never overwrite an existing file through the gate; a target observed *absent* rejects an edit with `FS_NOT_FOUND` (not `FS_NOT_OBSERVED`), because absence is a *positive* observation, not a missing one.
- **Surprising:** a successful write or edit **refreshes** the basis, so the next edit needs no re-read. The record is a prior-observation log, not a one-shot ticket.

##### `packages/fs/fs-observation-policy/src/types.ts`
- **Purpose:** the minimal structural view of a tool execution needed to derive an observed-state owner.
- **Key abstractions:** `FsObservationActor { agent?: { session?: object } }`.
- **Data flow:** the tool passes its `exec` straight through as the opaque `object` actor on the `fs/*` events; this package narrows it structurally and never imports `dsh-tools`, `dsh-agent`, or `dsh-session`.
- **Non-obvious design decisions:** the package names the *shape* it needs and does not import the package that owns it. The comment at `packages/fs/fs-observation-policy/src/index.ts:37-40` records that tsgolint and tsc disagree on the weak-type assignability, so the cast is deliberate and commented.
- **Edge cases & failure handling:** an actor with `agent` but no `session` yields no owner — the middle rung of the optional chain is explicitly tested.
- **Surprising:** the type carries an explicit comment that the owner is treated as an *opaque object identity* and the package never reads any of its fields.

#### `packages/fs/fs-sandbox` — the confining backend

##### `packages/fs/fs-sandbox/src/index.ts`
- **Purpose:** a `ctx.fs` backend that fences `writeText`/`editText` by the per-call sandbox mode while letting reads pass through untouched.
- **Key abstractions:** `SandboxedFileSystem extends LocalFileSystem` (`:55`), `static inject = ['sandboxPolicy']` (`:56`), and `checkedTarget` (`:122`).
- **Data flow:** each mutation resolves the per-call policy → `read-only` throws `FS_SANDBOX_DENIED`; `workspace-write` **re-resolves** the target (a fresh realpath), checks containment under `writableRoots(policy)`, and returns *that fresh target* — the one that is then mutated; `danger-full-access` returns the caller's target unfenced.
- **Non-obvious design decisions:**
  - **The fence returns the target, it does not just check it.** `checkedTarget` returns the exact target the mutation must use, so the checked identity *is* the mutated one. This closes the check-here-write-there TOCTOU in the direction that matters: a symlink ancestor swapped between the tool's resolve and the write is caught.
  - **Reads are never restricted.** "Every mode permits reading" — the seam's threat model is a *model-controlled path into a write*, not a read.
  - The fence is explicitly documented as a **policy check in trusted code, not a kernel boundary** (`packages/fs/fs-sandbox/src/index.ts:6-14`); kernel-grade isolation of untrusted code stays `ctx.shell`'s job.
- **Edge cases & failure handling:** the denial is a structured `FsError` with `FS_SANDBOX_DENIED`, distinguishable from a host permission error; a workspace root that *is* the target passes containment and then fails on file type instead.
- **Surprising:** `danger-full-access` is not a special case in the code — it is simply the early return.

##### `packages/fs/fs-sandbox/src/containment.ts`
- **Purpose:** the containment check with a lexical fast path and a filesystem-identity fallback.
- **Key abstractions:** `isPathUnder(path, root, caseSensitive)` (`:58`), `isLexicallyUnder` (`:23`).
- **Data flow:** the lexical comparison answers immediately; when spellings differ, the target's existing ancestors are walked and compared to the root by `dev`/`ino` identity.
- **Non-obvious design decisions:** the identity fallback exists because Windows 8.3 short names and casing differences make a purely textual comparison wrong; matching by `dev`+`ino` recognizes the alias without weakening containment to a textual approximation.
- **Edge cases & failure handling:** a missing root matches nothing (conservative); a path whose ancestor is a regular file is treated as a missing target, not as containment; case sensitivity defaults to `process.platform !== 'win32'`.
- **Surprising:** the fallback is an *ancestor* walk, not a realpath of the whole path — it works for a target that does not exist yet.

#### `packages/fs/tool-fs` — the model-facing file tools

##### `packages/fs/tool-fs/src/index.ts`
- **Purpose:** plugin entry: config, tool composition, and the `read_image` attachment gate.
- **Key abstractions:** `Config` (schemastery), `apply(ctx, config)` (`:35`), `READ_LIMIT`/`READ_MAX_LINE_LENGTH`/`READ_MAX_BYTES`/`STREAM_MIN_SIZE` defaults.
- **Data flow:** resolves the config, validates every cap is a positive integer, then registers the selected tools.
- **Non-obvious design decisions:**
  - **`read_image` registers only inside `ctx.inject(['attachments'], …)`** (`:60`). The tool is *composition-conditional*: without a durable attachment store the deployment cannot durably commit image bytes, so the tool never exists. The executor still re-checks `ctx.get('attachments')` for direct callers.
  - **One `FsSandboxController` is built per plugin and shared by `write` and `edit`** — advertisement gating, policy resolution, and denial mapping are one object, not two.
  - Every cap is validated as a positive integer at load, with the comment "or retention and timeout arithmetic misbehaves silently".
- **Edge cases & failure handling:** all four tools may be disabled; the caps are still validated when `read` is disabled.
- **Surprising:** disabling the `read` tool does **not** relax the observation policy — a write/edit still needs a prior observation, which another tool (e.g. `str_replace_editor` with `command: view`) can supply.

##### `packages/fs/tool-fs/src/read.ts`
- **Purpose:** the `read` tool — one stat, a streaming decision, a bounded window, then the observation.
- **Key abstractions:** `applyReadTool(ctx, caps)` (`:68`), `parseReadArgs`, `READ_LIMIT = 2000` (`:15`), `STREAM_MIN_SIZE = 10 MiB` (`:21`).
- **Data flow:** `resolveRegularReadTarget` → one `stat` (type check + size routing + version) → `streamText` or `readText` → `buildWindow` → `ctx.emit('fs/observed', target, {kind:'present', version}, exec)`.
- **Non-obvious design decisions:**
  - **One stat, not two.** The same `stat` supplies the type check, the size-based streaming decision, and the observed version. Reads pay one metadata round-trip; writes and edits pay *zero* (the guard comes from the intent slot).
  - **A file of unknown size is streamed, never read whole** (`:118`) — a size-less backend must not be able to make the tool buffer an arbitrary file.
  - `isConcurrencySafe: () => true` (`:136`) — the read's only mutation is the synchronous version recorder, and a later write re-checks the version under the target lock, so a recorder race fails closed.
  - The result carries a **structured window in `presentationMeta`** so a UI's read card survives replay, because the raw canonical value is not on the wire — only the model-facing text.
- **Edge cases & failure handling:** a missing file still records *confirmed absence* for the calling session (so a later `write` can safely recreate it); the `read` footer distinguishes "output capped" from "more remaining" from "end of file".
- **Surprising:** `presentResult` re-parses the model-facing text with a regex to recover the body — the structured window rides in `meta`, but the *content* block is text-only, so the card has to strip the envelope.

##### `packages/fs/tool-fs/src/read-render.ts`
- **Purpose:** pure windowing and envelope formatting — the file that decides how much of a file the model sees.
- **Key abstractions:** `buildWindow` (`:111`), `formatReadOutput`, `readMetaFromMeta` (`:230`), `READ_MAX_LINE_LENGTH = 2000` (`:11`), `READ_MAX_BYTES = 50 KiB` (`:14`).
- **Data flow:** an async iterable of decoded chunks → a numbered, line-capped, byte-capped window plus the exact total line count.
- **Non-obvious design decisions:**
  - **The line buffer is capped at `maxLineLength + 1` chars**, so even a newline-free 500 MB line cannot grow memory without bound — the scan keeps counting lines but stops accumulating characters.
  - The window is built over an *async iterable*, so one code path serves the whole-file and the streamed read.
  - **The byte cap stops the scan and marks `truncatedByBytes`**, which produces a different footer — a truncated read is honestly labelled as such.
  - `readMetaFromMeta` (`:230`) enforces a *semantic* contract on replayed JSON, not just a shape: `offset` must be a 1-based integer, `totalLines` a non-negative integer, each line number ≥ `offset`, strictly increasing, and ≤ `totalLines`. A violation *declines* to the generic fallback rather than rendering a card that misnumbers.
- **Edge cases & failure handling:** an offset past EOF throws `FS_NOT_FOUND` naming the file and its line count; CRLF is stripped per line; the final line without a trailing newline still flushes.
- **Surprising:** the *exact* total line count is reported even when the window is capped — the model is told how big the file is, not just how much it got.

##### `packages/fs/tool-fs/src/read-target.ts`
- **Purpose:** the shared resolve-and-validate path for the read tools.
- **Key abstractions:** `resolveRegularReadTarget(ctx, exec, requestedPath)`.
- **Data flow:** `ctx.fs.resolve(path, sessionResolveOptions(...))` → `stat` → on absence, `ctx.emit('fs/observed', target, {kind:'absent'})` **then** throw `FS_NOT_FOUND`; on a non-regular target, throw `FS_NOT_REGULAR_FILE`.
- **Non-obvious design decisions:** the absence observation is emitted *before* the throw, so the failure is still productive — the session now knows the file is gone.
- **Edge cases & failure handling:** the target is validated as a regular file before any content is read.
- **Surprising:** a failed read is what makes a later recreate safe.

##### `packages/fs/tool-fs/src/write.ts`
- **Purpose:** the `write` tool — a full-file create-or-replace.
- **Key abstractions:** `applyWriteTool(ctx, sandbox)` (`:62`), `parseWriteArgs`, `formatWriteOutput`.
- **Data flow:** `sandbox.resolvePolicy('write', args, exec)` → `ctx.fs.resolve` → `ctx.waterfall('fs/write-intent', target, exec, () => undefined)` (`:121`) → `ctx.fs.writeText(target, content, intent, signal, sandboxPolicy)` → `mutationResult`.
- **Non-obvious design decisions:**
  - **The tool never stats.** The guard comes from the intent slot; the provider re-checks under its lock. The stat budget is pinned by a test: "read stats once; write and edit never stat in the tool".
  - The tool asks for the *intent* only; it never inspects an observation cache.
  - The result's `before`/`after` are the provider's LF-normalized text, and the *diff* is computed at result time in `diff.ts` — the tool does not build diffs.
  - The success envelope is five lines exactly (`<path>`, `<type>file</type>`, `<content>`, `Created file`/`Updated file`, `</content>`) — the file content is **not** echoed back.
  - The schema puts `file_path` **before** `content` in the property order and says so in the description, to guide streaming presentation.
- **Edge cases & failure handling:** a `FS_SANDBOX_DENIED` becomes the shared `[sandbox: …]` marker plus the escalation hint; a `FS_NOT_OBSERVED`/`FS_STALE_VERSION` becomes the stable remedy text via `remediateFsError`.
- **Surprising:** the tool passes `() => undefined` as the waterfall's default — the *bare* default is "unconditional", and the policy plugin is what makes it guarded.

##### `packages/fs/tool-fs/src/edit.ts`
- **Purpose:** the `edit` tool — a literal replacement, unique-match by default.
- **Key abstractions:** `applyEditTool(ctx, sandbox)` (`:76`), `parseEditArgs`, `formatEditOutput`.
- **Data flow:** same shape as `write` — policy resolution, resolve, `ctx.waterfall('fs/edit-intent', target, exec, () => undefined)` (`:133`), `ctx.fs.editText(...)`, `mutationResult`.
- **Non-obvious design decisions:**
  - The intent slot sits **inside** the `try` (`:133-137`), because the slot itself can throw `FS_NOT_OBSERVED` — and that refusal must receive the same model-facing remedy as a provider failure.
  - `old_string === new_string` is rejected at argument validation: an equal pair is a guaranteed no-op.
  - `replace_all` defaults to false; the *provider* raises `FS_AMBIGUOUS_EDIT` when the literal matches more than once.
  - The success message is a single sentence, and `replace_all` gets a distinguishable one.
- **Edge cases & failure handling:** an empty `old_string` is rejected; a blank `file_path` is rejected.
- **Surprising:** the tool does not pre-check that `old_string` exists — it delegates the match to the provider, which has the file's actual bytes.

##### `packages/fs/tool-fs/src/sandbox.ts`
- **Purpose:** the escalation API shared by `write` and `edit`.
- **Key abstractions:** `FsSandboxController` (`:37`), `schemaFields()`, `resolvePolicy(toolName, args, exec)` (`:87`), `mapError(error, policy)` (`:124`).
- **Data flow:** the controller is built once from `ctx.fs.sandboxMode` (the *capability fact*); `resolvePolicy` resolves the standing session policy, and if the model asked for a wider mode, runs `approveEscalation` through `ctx.approval` and stamps the granted mode onto that one call.
- **Non-obvious design decisions:**
  - **Advertisement is derived from the capability, not from configuration.** No confining backend ⇒ no `sandbox_permissions` field in the schema at all.
  - **The controller fails at construction** if a confining filesystem is mounted without `ctx.sandboxPolicy` — a missing dependency is a load-time error, not a runtime surprise.
  - `mapError` keeps the `FS_SANDBOX_DENIED` code on the marker error because `ToolRuntime` only populates `result.error` for `HarnessError` instances — a plain `Error` would strip the code that retry/observers key on.
  - The escalation hint rides the denial *at the decision point*, so the sanctioned retry does not depend on the model recalling the tool description.
- **Edge cases & failure handling:** a missing approval service or a missing agent fails closed; a rejected escalation never mutates.
- **Surprising:** `resolvePolicy` returns the standing policy unchanged when the model asks for the *same* mode — no approval prompt for a no-op.

##### `packages/fs/tool-fs/src/error.ts`
- **Purpose:** the stable model-facing diagnostic for guarded-mutation failures.
- **Key abstractions:** `remediateFsError(error, displayPath)` (`:21`).
- **Data flow:** a caught `FsError` → a remediated `FsError` with the same `code` and the original chained as `cause`.
- **Non-obvious design decisions:**
  - `FS_NOT_OBSERVED` is **normalized** to one message regardless of whether the policy or the provider produced it: `cannot modify "<path>": file has not been read — read the file, then retry`. Two different internal reasons collapse into one instruction the model can act on.
  - `FS_STALE_VERSION` keeps the provider's reason and *appends* `— re-read the file, then retry`.
  - Every other code passes through untouched.
- **Edge cases & failure handling:** non-`FsError` values pass through unchanged.
- **Surprising:** the remedy is a *procedure*, not an error message — it tells the model what to do next, in the imperative.

##### `packages/fs/tool-fs/src/mutation-result.ts`
- **Purpose:** the shared tail of a successful mutation.
- **Key abstractions:** `mutationResult(ctx, target, outcome, exec)`.
- **Data flow:** strips `version` from the provider outcome, emits `fs/observed` with `{kind:'present', version}`, and returns the remaining fields plus `path: ctx.fs.processPath(target)`.
- **Non-obvious design decisions:** the version is **not** in the tool result the model sees — it lives only in the observation event. The model gets the canonical path, not the internal identity.
- **Edge cases & failure handling:** none needed — the helper only runs on success.
- **Surprising:** the observation is emitted *here*, at the single place both mutating tools pass through, so it cannot be forgotten by one of them.

##### `packages/fs/tool-fs/src/session-cwd.ts`
- **Purpose:** the per-session cwd resolution options for filesystem calls.
- **Key abstractions:** `sessionResolveOptions(ctx, exec)`.
- **Data flow:** `ctx.workingDirectory.ensure(exec.agent, exec.signal)` for agent calls; `undefined` cwd (provider default) for agentless calls; `exec.signal` always.
- **Non-obvious design decisions:** the cwd comes from the *working-directory service*, not from the session header — so a `working_directory` change mid-session redirects subsequent file operations.
- **Edge cases & failure handling:** a non-agent call leaves the cwd to the provider.
- **Surprising:** the sandbox permission root and the cwd are *independent* — changing the cwd routes files elsewhere without changing where the agent may write (pinned by an integration test).

##### `packages/fs/tool-fs/src/diff.ts`
- **Purpose:** result-time contextual diff presentation.
- **Key abstractions:** `computeHunkDiffs(path, before, after)`, `diffsFromMeta`, `pathFromMeta`, `DIFF_CONTEXT = 3`.
- **Data flow:** provider `before`/`after` text → one `FileDiff` per applied hunk, with three lines of context on each side.
- **Non-obvious design decisions:**
  - The diff is computed at **result time**, from the text the provider stored — not by the provider. The provider stores raw text; the presentation layer decides what a "hunk" means.
  - The `\` no-newline marker is dropped so it never leaks into a diff block.
  - A pure insertion reports `oldText: null`.
  - The diffs ride in the tool result's `meta` as JSON, so the card **survives replay** of a persisted session log.
- **Edge cases & failure handling:** `diffsFromMeta` rejects malformed metadata wholesale (one bad entry ⇒ `undefined`) so presentation falls back instead of rendering a corrupt card.
- **Surprising:** a *scattered* `replace_all` produces one `FileDiff` per hunk, not one merged block — matching per-site editor cards.

##### `packages/fs/tool-fs/src/read-image.ts`
- **Purpose:** the `read_image` tool — commit a PNG/JPEG/WebP/GIF to durable attachment storage and return it as an image block.
- **Key abstractions:** `sniffImageMediaType(data)` (`:54`), `imageMediaTypeForPath`, `assertImageCapableRoute(ctx, exec, requestedPath)` (`:120`), `formatImageReadOutput`, `imageRefFromValue`, `applyReadImageTool(ctx)` (`:209`).
- **Data flow:** extension check → deployment media-type check → **route capability check** → resolve → `readBytes` with a byte cap → sniff if extension-less → `attachments.saveImage` → emit `fs/observed` → return the envelope plus the image block.
- **Non-obvious design decisions:**
  - **The route gate is stricter than the host upload preflight.** An image-reading tool is useful only when the *exact* calling route can inspect its result, so an unknown capability **refuses** rather than relying on an adapter failure after filesystem and attachment work have already happened.
  - **Every pre-read gate runs before any filesystem I/O**, so a refusal never leaks partial reads or attachment writes.
  - An extension-less path is identified from its **file signature**; a path *with* a wrong extension is refused with a "rename the file" remedy rather than sniffed. The extension is a *declaration*, the magic bytes are the truth.
  - The byte cap is `min(maxImageBytes, maxMessageImageBytes)` — the per-message aggregate bound applies beside the per-image bound.
  - `presentationMeta` carries **only the path**; the attachment reference is deliberately *not* copied into `meta`, because the settled content already carries it and a `tools/post-execute` hook that replaces the content would leave a stale copy.
- **Edge cases & failure handling:** every `AttachmentError` code gets its own actionable message (dimension, pixel count, byte size, 16-bit PNG conversion, invalid image, type mismatch); a declared/sniffed mismatch names both formats.
- **Surprising:** a downscaled read names the *multiplier* that maps coordinates on the attached image back onto the original file — and names per-axis multipliers when integer rounding makes the ratios differ.

#### `packages/fs/tool-fs-search` — glob and grep

##### `packages/fs/tool-fs-search/src/index.ts`
- **Purpose:** plugin entry for the `glob`/`grep` discovery pair.
- **Key abstractions:** `Config` (schemastery), `apply(ctx, config)`, `inject = ['tools','systemPrompt','subprocess','workingDirectory']`.
- **Data flow:** validates every cap, then registers both tools.
- **Non-obvious design decisions:**
  - **The package injects `subprocess`, NOT `fs`.** Search is a process-backed ripgrep workflow; putting it on the filesystem seam would force every backend to grow a search API.
  - `sampleOverCapGlobResults` is **required with no default** — a deployment must choose the over-cap ordering contract explicitly, because the two orders answer different questions.
  - `spillStore` is read opportunistically with `ctx.get()`, not injected: spill is optional.
  - `graceMs` is bounded by `MAX_TIMER_DELAY_MS` at load.
- **Edge cases & failure handling:** every cap must be a positive integer; a non-integer cap is rejected at load, not at first use.
- **Surprising:** the module has **no default export** — it is a namespace plugin, and a stray `export default apply` would make the Cordis loader's `unwrapExports` collapse the module and drop `inject`. There is a dedicated test for that (`tests/load-path.spec.ts`).

##### `packages/fs/tool-fs-search/src/search-core.ts`
- **Purpose:** the shared spawn helper, the `SEARCH_*` error vocabulary, the spill handoff, and the workdir-relative display.
- **Key abstractions:** `runRipgrep(ctx, exec, toolName, argv, rawOutputMaxBytes, graceMs, stderrMaxBytes)` (`:222`), `resolveRgPath()` (`:171`), `trySaveFormattedResult` (`:383`), `SearchError`, `RAW_OUTPUT_MAX_BYTES = 20 MB` (`:36`), `SEARCH_TIMEOUT_MS = 30 s` (`:43`), `SEARCH_META_MAX_BYTES = 64 KiB` (`:65`).
- **Data flow:** resolve the packaged binary → `ctx.subprocess.spawn({argv: [rg, '--no-config', ...argv], cwd: workdir, stdio: {stdout:{maxBytes}, stderr:{maxBytes}}, graceMs, signal})` → await `handle.done` → read the collected stdout → classify.
- **Non-obvious design decisions:**
  - **`--no-config` is prepended unconditionally.** The spawn is unconfined, so a host `RIPGREP_CONFIG_PATH` (or an `rg.conf` beside the binary) could otherwise inject a `--pre` and make ripgrep execute an arbitrary preprocessor for every matched file.
  - **The binary is resolved lazily, once per process**, so a missing or corrupt platform package surfaces as `SEARCH_FAILED` on the *first search call* rather than failing the composition load.
  - **The raw stdout cap is enforced twice**: the subprocess seam is asked for a bounded collect, and `completeStdout` re-checks the in-memory size. A lossy read fails as `SEARCH_RAW_OUTPUT_OVERFLOW` rather than parsing a silently-partial stream.
  - **The tool never reads a raw spill path.** The model-facing recovery artifact is the *formatted* result saved through `ctx.spillStore.saveText()`.
  - Spill is **best-effort**: a missing backend, a missing session owner, or a `saveText` rejection logs a warning and returns `undefined` — the search never becomes an error because spill storage was unavailable.
  - Exit semantics are tool-owned: `0` = success with results, `1` = success with zero results (`noMatches`), anything else throws.
- **Edge cases & failure handling:** three distinct launch-failure domains are classified separately — a synchronous throw at spawn *creation* ("could not start"), a rejection of `handle.done` ("subprocess failed before reporting an outcome"), and an abort already observed at creation time (which becomes `SEARCH_ABORTED`, not `SEARCH_FAILED`).
- **Surprising:** the tool claims no shell layer exists, so every model-controlled value is a plain argv element — command substitution, backticks, quotes, newlines, and leading dashes are all inert by construction, and there is a test that pins each one.

##### `packages/fs/tool-fs-search/src/glob.ts`
- **Purpose:** the `glob` tool — discover files by path pattern, modification-time ordered.
- **Key abstractions:** `buildGlobCommand`, `sampleAcrossTopLevel(paths, maxItems, root)` (`:170`), `GLOB_MAX_RESULTS = 100` (`:25`), `GLOB_VCS_EXCLUDES` (`:37`), `formatGlobOutput`, `renderGlobPaths`, `globCardPage`.
- **Data flow:** `rg --files --glob=<pattern> --sort=modified --no-ignore --hidden` + paired VCS excludes → parse stdout into a path list → relativize to the workdir → cap → optionally spill.
- **Non-obvious design decisions:**
  - **Each VCS name is excluded with TWO negated globs** — `!**/<name>` prunes the directory during traversal, and `!**/<name>/**` still excludes the internals when the search root is *at or inside* that directory (where the prune glob alone never matches).
  - **`sampleAcrossTopLevel` round-robins across the result's top-level entries** (`:170`) instead of taking the modification-time head. The comment records the shipped failure: "`*` matches the whole tree, mtime order puts one freshly-unpacked subtree first, and a head-of-3 reads like the entire workspace."
  - **A flat result keeps the plain footer**, because for a flat result the sample *is* the modification-time head — the footer would otherwise lie about the basis.
  - The card page and the model-facing page are computed by the *same* function (`globCardPage` vs `renderGlobPaths`) so text and card cannot disagree about which paths survived the cap.
  - The search root rides behind `--` so a leading-dash path cannot be parsed as a flag.
- **Edge cases & failure handling:** an invalid glob is `SEARCH_INVALID_PATTERN`; a result that fits entirely is shown whole and untouched.
- **Surprising:** `sampleAcrossTopLevel` is written to survive 125,000 top-level groups — more than the JavaScript argument limit — because an earlier implementation spread them.

##### `packages/fs/tool-fs-search/src/grep.ts`
- **Purpose:** the `grep` tool — ripgrep content search, grouped by file.
- **Key abstractions:** `buildGrepCommand`, `parseGrepMatches(stdout)` (`:169`), `formatGrepMatches`, `formatGrepOutput`, `GREP_MAX_MATCHES = 250` (`:29`), `GREP_MAX_LINE_BYTES = 2000` (`:35`).
- **Data flow:** `rg --json --regexp=<pattern> [--glob=<include>] [-- <path>]` → parse the NDJSON → preview each line → retain the first N matches → group by file.
- **Non-obvious design decisions:**
  - **`--json` instead of text output.** Path, line number, and line text parse without colon-splitting ambiguity — a file path containing a colon would break the text format.
  - **Only `match` records are consumed.** `begin`/`end`/`context`/`summary` — and any future type — are transport framing and are skipped, not treated as malformed.
  - **A malformed `--json` line fails the whole search** (`SEARCH_FAILED`), because the raw output is an internal transport and a partial result would be a lie.
  - **`include` must be ONE positive glob.** Negated patterns and comma-separated lists are rejected up front; a comma inside a brace group is fine (`*.{ts,tsx}` is one glob with alternation).
  - A **whitespace-only pattern is legal** — it is a legitimate regex, unlike a blank `glob` pattern.
  - A non-UTF-8 matched line (ripgrep sends base64 `bytes`) renders as the placeholder `(line is not valid UTF-8)` rather than failing the search.
- **Edge cases & failure handling:** the per-line preview budget preserves UTF-8 boundaries; the CRLF terminator is stripped from the matched line.
- **Surprising:** the spill artifact holds the **complete** match list (every match, previewed) even though the inline page shows only the first N — the recovery file is the whole search.

##### `packages/fs/tool-fs-search/src/presentation.ts`
- **Purpose:** the search-card metadata projection and its defensive narrowing.
- **Key abstractions:** `grepSearchMeta`, `globSearchMeta`, `groupMatchesByFile`, `searchViewFromMeta(meta)` (`:189`), `capMetaBytes(meta, maxMetaBytes)` (`:107`).
- **Data flow:** the retained matches/paths → a JSON `SearchMeta` (`shape: 'matches' | 'paths'`, plus `total` and `truncated`) → the card view on replay.
- **Non-obvious design decisions:**
  - **The canonical value never crosses the wire** — only the model-facing text and this JSON `meta` do — so the structured shape a UI renders *must* ride in `meta`.
  - **The projection consumes the same retained items the model-facing render consumes**, so text and card agree about which results survived the cap.
  - **`total` reports every result found and `truncated` reports the cap**, so a UI never presents a capped result as complete.
  - **A second, independent byte cap bounds the JSON `meta` itself** (`:107`): trailing file groups or paths are dropped until the serialized meta fits, and the result is marked truncated. A single oversized item is *kept* — the invariant is a bounded payload, never an empty card that hides a real result.
  - The `meta` types use object-literal `type` aliases rather than the SDK interfaces, because only a type alias is assignable to the `JsonValue` index signature.
- **Edge cases & failure handling:** malformed meta narrows to `undefined` so the presentation falls back instead of throwing during replay of an obsolete or hand-edited log.
- **Surprising:** a **zero-result** meta narrows to a valid *empty* card, unlike the mirrored `diffsFromMeta` which rejects empty diffs — a zero-match grep is a legitimate result, not an absent projection.

##### `packages/fs/tool-fs-search/src/direct-call.ts`
- **Purpose:** the shared post-policy selection for search-result spill.
- **Key abstractions:** `acceptedDirectCallValue(ctx, tool, exec, result, decision)`.
- **Data flow:** a `tools/post-execute` hook → check the decision is an `accept` that did not replace the value → check the execution is a *direct* top-level call (no parent), the right tool, not an error, and still the registered tool → return the canonical value.
- **Non-obvious design decisions:** the check is deliberately narrow. Spill only happens for a direct successful top-level call whose canonical value was not replaced downstream.
- **Edge cases & failure handling:** a downstream policy that replaced the canonical value means the *new* value is spilled, not the old one.
- **Surprising:** a **nested `run_code` dispatch is excluded** — a nested value never enters model context, so spilling it would write a file nobody can reach.

##### `packages/fs/tool-fs-search/src/ripgrep.d.ts`
- **Purpose:** the minimal type surface for `@vscode/ripgrep`, which ships no declarations.
- **Key abstractions:** `declare module '@vscode/ripgrep' { export const rgPath: string }`.
- **Data flow:** types only.
- **Non-obvious design decisions:** a hand-written `.d.ts` rather than `@types/*`; the module comment records the resolution mechanics (platform package optional dependency, ESM).
- **Edge cases & failure handling:** n/a.
- **Surprising:** the file is classified as `source` but contains no runtime code at all.

#### `packages/fs/tool-str-replace-editor` — the Claude-Code-style editor

##### `packages/fs/tool-str-replace-editor/src/index.ts`
- **Purpose:** the standalone `str_replace_editor` tool — one schema, four commands (`view`, `create`, `str_replace`, `insert`) over `ctx.fs`.
- **Key abstractions:** `apply(ctx, config)` (`:520`), `MutationPolicy`, `presentEditorCall`, `Config {maxOutputChars, description}`.
- **Data flow:** every command resolves an **absolute** path first; mutations then follow one shared flow — policy guard (`fs/write-intent` / `fs/edit-intent`), provider enforcement, then an `fs/observed` record on success; `view` only stats and renders.
- **Non-obvious design decisions:**
  - **Absolute paths are enforced** with a hint: a relative path is refused with "Maybe you meant /<path>?".
  - **`view` shows tabs preserved**, so the displayed text remains valid literal-replacement input.
  - **`str_replace` and `insert` re-read the file and use the observed version as the CAS basis** when no policy plugin supplies a guard — the tool does not depend on the policy plugin being mounted.
  - **A null placeholder is treated as omitted** for parameters the selected command does not use, but `str_replace.new_str: null` is *rejected* so a deletion must be expressed by omission.
  - The clip notice is a fixed string that tells the model to *search inside the file* to find the line numbers it needs (`:18`).
- **Edge cases & failure handling:** `str_replace` requires a unique literal match and reports the offending **line numbers** on ambiguity; `insert` validates the boundary against the file's line count; the directory listing is depth-limited to 2 and excludes hidden, `node_modules`, and `__pycache__`.
- **Surprising:** the tool is a *nonexperimental standalone plugin* explicitly **not** offered in the Plugins page — it exists for custom compositions.

#### `packages/sandbox/sandbox` — the confinement seam

##### `packages/sandbox/sandbox/src/index.ts`
- **Purpose:** the abstract process-sandbox service (`ctx.sandbox`) and the confinement vocabulary.
- **Key abstractions:** `SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'` (`:30`), `SandboxExecutionPolicy` (`:40`), `SandboxEnforcement = 'full' | 'partial'` (`:60`), `RunnerFailureRule`, `ConfinedArgv`, `SandboxProvider` (`:159`), `SandboxUnavailableError` (`:132`), `SANDBOX_UNAVAILABLE` (`:125`).
- **Data flow:** a consumer resolves a per-call `SandboxPolicy` and calls `confine(argv, policy, signal)`; the provider returns the argv to spawn *in place of* the caller's, plus the enforcement completeness, the backend's denial signatures, and the structured runner-failure rules.
- **Non-obvious design decisions:**
  - **Policy rides the call, never the provider.** Two consumers may confine under different policies at the same instant.
  - **`SandboxEnforcement` is `full | partial`, and `partial` is a first-class value.** A backend that cannot govern every promised file effect says so rather than overstating the boundary. The Windows ACL rung and older Landlock ABIs are the current `partial` cases.
  - **`SandboxUnavailableError` fails closed** — the error text names the missing platform runner and the escape hatch (switch to `danger-full-access`).
  - **`denialSignatures` is per backend**, not a cross-backend union — the union would claim denials a given backend never produces.
  - **Runner-failure evidence is structured**, with an exit-code gate and informational-line exclusions, so "the runner never ran" is distinguishable from "confinement worked and blocked it".
- **Edge cases & failure handling:** functional probes arbitrate multi-runner chains; a sole candidate is selected without a probe, but its own refusal still fails closed.
- **Surprising:** the `ConfinedArgv` carries the *dialect* the consumer needs to classify the child's stderr — the seam deliberately does not normalize denial reporting into a typed channel.

##### `packages/sandbox/sandbox/src/escalation.ts`
- **Purpose:** the escalation vocabulary and choreography shared by every enforcing tool family.
- **Key abstractions:** `WIDER_MODES` (`:28`), `ESCALATION_TARGETS` (`:41`), `validateEscalationArgs`, `sandboxDenialMarker` (`:71`), `escalationHintMarker` (`:84`), `sandboxPermissionsDescription`, `approveEscalation` (`:171`), `EscalationApprover` (a minimal *structural* shape, not the approval service type).
- **Data flow:** `approveEscalation` compares the requested mode with the call's effective mode → repeating the effective mode returns it with no approval → a strictly wider mode requires an approval request → the outcome (`allowed-once` / `rejected` / `cancelled` / `unavailable`) maps to a distinct verbatim text.
- **Non-obvious design decisions:**
  - **The strictly-wider check happens at EXECUTION, never in the schema.** The schema's enum is the closed *target* vocabulary; the effective mode is per-call truth, and schemas are registry-global.
  - **`ESCALATION_TARGETS` is the full closed set, not "wider than the composition default".** Cutting the enum down to the default's wider modes would strand a session whose effective mode sits below the default.
  - **The package depends on a structural function shape, not on the approval package** — the tool layer closes over `ctx.approval.request` and hands the closure down, so `dsh-sandbox` never imports the approval or agent packages.
  - **The audit reason is self-contained**: `escalate sandbox to <mode>: <justification>`, and the request carries English *and* Chinese presentation copy with the model's justification unchanged.
  - **A rejection's text tells the model to stop** ("it stays denied, so stop and explain instead of working around it") — the failure mode being designed against is the model looking for a workaround.
- **Edge cases & failure handling:** a missing approval service and an agent-less call each fail closed with *distinct* text; an outcome outside the closed union trips an exhaustiveness guard.
- **Surprising:** the `justification` must be a non-empty sentence and is validated separately from `sandbox_permissions` — an approval prompt without a reason is a malformed ask.

##### `packages/sandbox/sandbox/src/roots.ts`
- **Purpose:** the one derivation of "what `workspace-write` means" as a canonical allow-list.
- **Key abstractions:** `canonicalPath(path)` (`:30`), `writableRoots(policy)` (`:52`).
- **Data flow:** `writableRoots` returns `[workspaceRoot, '/tmp', tmpdir()]` canonicalized and deduplicated; `read-only` returns `[]`.
- **Non-obvious design decisions:**
  - **`realpathSync.native` rather than the JS implementation** — the JS one lexically collapses `..` before resolving a preceding symlink on some platforms, while the native one matches chdir/spawn and the enforcement layers this identity feeds.
  - **A path that cannot be resolved is returned as-is** — a missing root matches nothing until it exists. Inventing a fallback would grant a path the caller never named.
  - **`os.tmpdir()` is included because omitting it would deny what the mode promises** (mkstemp-family tools).
- **Edge cases & failure handling:** the set is deduplicated, so a workspace that *is* the temp dir grants one root, not two.
- **Surprising:** both the Seatbelt profile and the in-process filesystem fence derive their allow-list here, so "the write tool cannot write /tmp but bash can" cannot arise.

##### `packages/sandbox/sandbox/src/diagnostics.ts`
- **Purpose:** classify observed sandbox runner failures and file-effect denials.
- **Key abstractions:** `isRunnerSpawnFailure(error, runnerProgram, workdir)` (`:33`), `classifyRunnerFailure(exitCode, stderr, rules)` (`:65`), `matchesSignature`.
- **Data flow:** a spawn rejection → attribute to the runner only if the error path equals argv[0] *and* the caller-owned cwd is independently usable → otherwise it is a command failure, not a runner failure.
- **Non-obvious design decisions:**
  - **The cwd is checked independently** before attributing `ENOENT`/`EACCES`, so a relative-program failure is not misattributed to the runner.
  - **An empty or whitespace-only fatal signature is ignored** — it is not meaningful evidence, but it does not disable the valid signatures beside it.
  - **Informational lines are excluded by exact full-line equality** before fatal matching, so a benign notice does not abort the classification.
- **Edge cases & failure handling:** exit status alone never proves runner failure; the workdir check is not atomic with the spawn, and the comment says so — concurrent path replacement may change attribution but cannot permit an unconfined execution.
- **Surprising:** the failure is *in-band* (stderr text + exit code), so a confined child that deliberately mimics its runner can cause a false attribution. The README records this as a known boundary.

#### `packages/sandbox/sandbox-policy` — the shared policy home

##### `packages/sandbox/sandbox-policy/src/index.ts`
- **Purpose:** the one owner of the deployment's sandbox fallbacks plus per-session resolution.
- **Key abstractions:** `SandboxPolicyService` (`:110`), `resolve(request)` (`:164`), `renderPolicyContext(policy)` (`:42`), the `sandboxMode` session projection unit.
- **Data flow:** `resolve({session, mode})` → `mode = approved ?? session fold ?? deployment default`; `workspaceRoot = session.header.cwd ?? configured fallback`.
- **Non-obvious design decisions:**
  - **The effective policy is contributed to a cache-safe runtime-context snapshot before each agent request**, and the agent loop logs that snapshot as model history — so replay reconstructs the same mode and root the enforcing consumers resolve, without rewriting the stable system prompt.
  - **The context text is capability-neutral**: it states the mode's file-effect contract without inventorying which capabilities are mounted.
  - **The `read-only` context explicitly tells the model not to refuse from policy alone**: "try an available tool normally and follow any denial and escalation guidance it returns." The repo records a historical measurement — 5 of 12 turns with zero tool calls — that this check exists to prevent.
  - **The deployment default is `read-only`** — the fail-safe default; a deployment wanting a workspace-writable agent opts in explicitly.
  - **The workspace root must be absolute** and is preserved as spelled; a relative value fails at load.
- **Edge cases & failure handling:** a session with no cwd and an agentless call both fall back to the configured root; the service resolves the policy *once* at each operation boundary so executors and providers stay session-free.
- **Surprising:** the deployment root is *not* host-normalized — it is an execution-world path, and each enforcing provider canonicalizes it on its own filesystem.

##### `packages/sandbox/sandbox-policy/src/session-mode.ts`
- **Purpose:** the per-session sandbox-mode override, stored in the session log.
- **Key abstractions:** `SANDBOX_MODES` (`:42`), `setSandboxMode(session, mode)` (`:53`), the `sandbox/mode` session event.
- **Data flow:** a runtime switch appends exactly one `sandbox/mode` event; the `sandboxMode` projection folds to the last one; `effective = projection state ?? deployment default`.
- **Non-obvious design decisions:**
  - **The switch IS its event.** Nothing mutates mode state out of band, so an override survives restart by replay and two sessions can never see each other's state.
  - **The event is log-only**, not a surface event — it is durable and replayable, never in the model transcript.
  - **Workspace identity needs no event**: the immutable `SessionHeader.cwd` recorded at creation is the root for every call in that session.
  - `source: 'delegation'` marks an override seeded into a child.
- **Edge cases & failure handling:** the mode takes effect on the session's *next* confined call, not retroactively.
- **Surprising:** the override lives in the *policy* package, not in any one capability's seam, because it is shared by every enforcing family.

#### `packages/sandbox/sandbox-local` — the per-platform runners

##### `packages/sandbox/sandbox-local/src/index.ts`
- **Purpose:** the local `ctx.sandbox` provider — platform runner chains, functional probes, per-call wrapping, and the Windows grant lifecycle.
- **Key abstractions:** `LocalSandboxProvider` (`:252`), `PLATFORM_CHAINS` (`:160`), `DENIAL_SIGNATURES` (`:207`), `RUNNER_FAILURE_RULES` (`:233`), `SandboxInternals` (the test-hook table), `materializeAclGrant` (`:403`), `selectRunner` (`:503`), `chainVerdict` (`:510`).
- **Data flow:** `confine(argv, policy, signal)` → canonicalize the root → operator `runnerCommand` (asserted, unprobed) or the platform chain → build the runner argv + profile → return `{argv, enforcement, denialSignatures, runnerFailureRules}`.
- **Non-obvious design decisions:**
  - **Selection is by PLATFORM first, probes second.** A platform with one candidate is selected *without* a probe; probing arbitrates, it does not re-validate a choice that has no alternative.
  - **The verdict is cached for the provider's lifetime** — including the `unavailable` verdict, so the failure is not re-probed.
  - **`runnerCommand` is an operator assertion**: it skips functional probes and asserts `full` enforcement.
  - **The Windows rung owns the write grants**: the write SID is the per-*workspace* identity (`workspaceWriteSid`) and the ACE materializes once per workspace per server lifetime — the exact-ACE skip makes every later provision O(1) instead of re-propagating the tree per session. Each live session/workspace pair instead gets a **random** private temp directory with its own revocable SID.
  - **Grant materialization is fail-closed**: a half-materialized temp grant is revoked and its directory removed before the error propagates, and cleanup failures are aggregated with `AggregateError`.
  - **Grant cleanup failures are reported, not thrown** — Cordis teardown must not be aborted by grant cleanup.
- **Edge cases & failure handling:** the temp root is rejected if it is inside the workspace, before any ACL mutation; a fresh provider always chooses a new temp path and SID, so crash residue cannot collide with or authorize a resumed session.
- **Surprising:** the Windows rung reports `enforcement: 'partial'` and says why — NTFS hard links alias one file object across paths, reads stay unconfined, and a tree another AppContainer tool has ACL'd with a package SID is not readable by the Low-integrity child.

##### `packages/sandbox/sandbox-local/src/profiles.ts`
- **Purpose:** the per-platform profile builders.
- **Key abstractions:** `bwrapProfileArgs` (`:16`), `landlockProfileArgs` (`:30`), `seatbeltProfileArgs` (`:51`).
- **Data flow:** a `SandboxPolicy` → the runner's own argument dialect.
- **Non-obvious design decisions:**
  - **bwrap gets a private PID namespace and a fresh `/proc`** — commands manage their descendants but cannot see host processes, so procfs magic links cannot bypass the mounts.
  - **bwrap's `workspace-write` `/tmp` is an ephemeral tmpfs**, not the host's.
  - **The Seatbelt profile is allow-default with `(deny file-write*)`** plus write allow-lists derived from the shared `writableRoots` helper, and every root is canonicalized because Seatbelt matches resolved paths (`/tmp` IS `/private/tmp` on darwin).
  - **Landlock keeps its own grant spellings** (an ephemeral `/tmp` mount, launcher-owned flags) — the honest per-runner differences — with parity pinned by test.
- **Edge cases & failure handling:** `read-only` still grants `/dev/null` a write, because a required sink is not a file effect the mode forbids.
- **Surprising:** the three dialects do not grant the *same* temp areas, and the repo records that as intentional rather than papering over it.

#### `packages/sandbox/sandbox-windows-acl` — the Windows restricted-token backend

##### `packages/sandbox/sandbox-windows-acl/src/index.ts`
- **Purpose:** the `AclSandbox` — a WRITE_RESTRICTED token with capability-SID write grants.
- **Key abstractions:** `AclSandbox` (`:163`), `AclSandboxOptions`, `AclSandboxSpawnOptions`, `AclSandboxChild`.
- **Data flow:** `init()` → open the current token → parse the write SIDs → build the Low label and world SIDs → apply the grants → find the logon SID → `CreateRestrictedToken` → `restrictTokenIntegrity` → merge a default-DACL grant → `spawn()`.
- **Non-obvious design decisions:**
  - **The restricting-SID list is mode-selected**: `read-only` carries no write SID, so a *standing* workspace grant from an earlier workspace-write period stays **inert** — the write-restricted pass-2 check grants only what the restricting list carries — while the unrevoked ACE keeps a re-upgrade free of re-propagation.
  - **The default DACL is merged with a full-access ACE for a restricting SID.** The restricted token inherits the user's default DACL, which names no restricting SID, so a new anonymous pipe would fail the pass-2 check and break every piped-stdio grandchild spawn. The *temp* SID is preferred over the workspace SID so default-DACL objects in one session's temp tree do not acquire the shared workspace capability.
  - **`init()` is fail-closed**: any Win32 failure revokes the revocable (temp) grants, frees the SIDs, and throws. The child is **never** spawned unrestricted.
  - **`dispose()` leaves the standing workspace ACEs** (the cross-instance reuse cache) and revokes only the temp grants.
  - **`stdio: 'inherit'` puts the child in a kill-on-close Job**; with piped stdio, `waitForExit` is deliberately *not* started until the drains finish (waiting first would deadlock on a full pipe buffer).
- **Edge cases & failure handling:** every API failure throws with the API name and the exact Win32 code; cleanup failures are aggregated.
- **Surprising:** the keep-alive group (logon SID + Everyone) is present in **both** modes, and Authenticated Users / INTERACTIVE / LOCAL are absent from both — the second choice closes the `C:\`-root tree-creation escape and the Public-tree write escape, and the first is required for early DLL init and CNG.

##### `packages/sandbox/sandbox-windows-acl/src/acl.ts`
- **Purpose:** the ACL editing primitives.
- **Key abstractions:** `grantWrite` (`:377`), `revokeWrite` (`:431`), `withPathLock` (`:93`), `buildExplicitAccess`, `buildLowLabelAcl`, `hasExactGrant` (`:312`), `lockFilePath`.
- **Data flow:** read the current DACL and label → merge → apply, all under a per-path exclusive lock.
- **Non-obvious design decisions:**
  - **One `SetNamedSecurityInfoW` call applies three edits**: the capability allow ACE, a Deny ACE removing the ambient `FILE_DELETE_CHILD` from the world SID, and the Low no-write-up mandatory label.
  - **The ambient-delete deny inherits to containers only.** `FILE_DELETE_CHILD` is evaluated on directories; inheriting its bit onto files would deny every `GENERIC_ALL`/`FullControl` open inside the root (0x40 is a member of that mask).
  - **The exact-ACE/exact-deny/exact-label skip** means a re-grant does *not* re-propagate the identical descriptor across the whole tree — minutes on large workspaces become a no-op.
  - **The whole get-merge-set sequence runs under a per-path `LockFileEx` lock**, so concurrent sandbox instances cannot clobber each other's ACEs. The lock file is opened with shared read/write but *not* delete, so it cannot be removed and recreated under the holder.
  - **The ACE's SID is inline in the ACE** — there is no pointer to read; reading one yields garbage addresses and crashed `EqualSid` (verified with gdb). The comparison is field-by-field through bounded offset reads.
- **Edge cases & failure handling:** a malformed ACL header, an implausible size, or an ACE that would overrun the ACL all read as "no exact entry" and fall back to the merge-apply path; a revoke clears the shared Low label only when no other capability grant remains.
- **Surprising:** the descriptor allocation contract — only the *descriptor* may be `LocalFree`d, never the ACL pointer inside it, and it must not be freed before `SetEntriesInAclW` has consumed it. Freeing the ACL pointer corrupts the heap.

##### `packages/sandbox/sandbox-windows-acl/src/token.ts`
- **Purpose:** restricted-token construction.
- **Key abstractions:** `openCurrentProcessToken`, `findLogonSid`, `makeWellKnownSid`, `setTokenDefaultDaclGrant` (`:112`), `restrictTokenIntegrity` (`:156`), `createRestrictedToken` (`:216`).
- **Data flow:** current process token → logon SID copy → well-known SIDs → restricting-SID buffer → `CreateRestrictedToken` with `DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED` → integrity level → default DACL.
- **Non-obvious design decisions:**
  - **The token handle is obtained through a real `OpenProcess` handle** because the `GetCurrentProcess()` pseudo-handle is not addressable through koffi.
  - **The restricting list is `[logon SID, Everyone, workspace SID, optional temp SID]` under workspace-write and `[logon SID, Everyone]` under read-only.**
  - **The integrity level is lowered to Low** — the level the mandatory labels the grants apply are matched against; a Medium token would ignore them.
  - **`SE_GROUP_LOGON_ID` is compared with `>>> 0`** — JS bitwise `&` is signed 32-bit and the attribute has bit 31 set.
- **Edge cases & failure handling:** every call is checked; a token with no logon SID group throws with the group count.
- **Surprising:** the `TokenGroups` size query is *expected to fail* with `ERROR_INSUFFICIENT_BUFFER` — the failure is the size.

##### `packages/sandbox/sandbox-windows-acl/src/ffi.ts`
- **Purpose:** the Koffi binding table for the ACL/token calls, layered on the shared Win32 process owner.
- **Key abstractions:** `Win32Bindings`, `win32()` / `win32Sync()`, `isInvalidHandle`, `decodePtrAt`, `sameSidAt`, `getTempPath`, `allocOverlapped`.
- **Data flow:** a lazily-required `koffi` → a cached binding table.
- **Non-obvious design decisions:** the module is `createLazyRequire`d, so `koffi` is not loaded at import time; `allocOverlapped` returns a *zeroed* 32-byte x64 OVERLAPPED because Koffi 3.1.1 crashes when `LockFileEx`/`UnlockFileEx` receives NULL.
- **Edge cases & failure handling:** `getTempPath` rejects a required length larger than the fixed buffer rather than truncating.
- **Surprising:** `sameSidAt` compares SIDs by field without allocating strings — a bounded, allocation-free comparison of native records.

##### `packages/sandbox/sandbox-windows-acl/src/grant.ts`
- **Purpose:** the server-side write-grant materialization.
- **Key abstractions:** `AclWriteGrant` (`:32`), `AclWriteGrant.create(writeSid)`, `add(path, standing = false)` (`:105`), `dispose()`.
- **Data flow:** `create` parses the SID and builds the Low/world SIDs → `add` grants the ACE, the deny, and the label → `dispose` revokes the *revocable* paths and frees the SIDs.
- **Non-obvious design decisions:**
  - **The path is recorded BEFORE the grant.** A post-apply throw (a `LocalFree` failure after `SetNamedSecurityInfoW` succeeded) must still revoke it, and revoking an ungranted path is a no-op merge.
  - **Standing vs revocable is a per-path property**, not a per-grant one: workspace paths stand, temp paths revoke.
  - `create` is fail-closed at every step, freeing the earlier allocations when a later one fails.
- **Edge cases & failure handling:** `dispose` aggregates every failure into an `AggregateError`.
- **Surprising:** a *standing* grant is never revoked by `dispose` — the workspace ACE is a cross-session reuse cache, and revoking it would force the next session to re-propagate the whole tree.

##### `packages/sandbox/sandbox-windows-acl/src/runner.ts`
- **Purpose:** the argv-prefix wrapper the seam spawns in place of the caller's command.
- **Key abstractions:** the argv contract `[node, runner.js, --workspace, <dir>, --temp, <dir>, --mode, <mode>, [--write-sid, --temp-write-sid], --, <argv...>]`, `RUNNER_SIGNATURE = 'windows-acl-run'` (`:55`), `RUNNER_FAILURE_EXIT = 127` (`:56`), `parseArgs`, `main` (`:116`).
- **Data flow:** parse → validate both directories → verify the SID pair against their owning paths → build the token → rewrite TMP/TEMP to the private dir → spawn with inherited stdio in a kill-on-close Job → mirror the exit code → revoke the self-managed temp grant.
- **Non-obvious design decisions:**
  - **Every runner-side failure prints `windows-acl-run: <detail>` and exits 127** — the seam's runner-failure rules match that signature, so a broken sandbox is distinguishable from a denied command.
  - **The runner ignores its own CTRL+C** (`SetConsoleCtrlHandler(null, 1)`) — the confined child keeps handling its own; the runner must survive to revoke grants and mirror the exit code.
  - **TMP/TEMP are rewritten in the runner's own environment**, because an explicit environment block through koffi trips `ERROR_INVALID_PARAMETER` in `CreateProcessAsUserW` (verified empirically).
  - **The runner verifies each SID against its owning path** and refuses a mismatch — a caller cannot hand it a SID for a different directory.
- **Edge cases & failure handling:** with the SID pair the runner neither grants nor revokes (`manageDacls: false`); without it, `--temp` names a *root* and the runner creates and removes a random private child.
- **Surprising:** the exit-code mirror is full-width on Windows — a child exiting with `0xC0000005` is read back as the uint32 `3221225477` and observed as exactly that by the parent.

##### `packages/sandbox/sandbox-windows-acl/src/acl-skill.ts`
- **Purpose:** register the bundled `diagnose-windows-sandbox-acl` skill.
- **Key abstractions:** `ACL_DIAGNOSIS_SKILL`, `registerAclDiagnosisSkill(ctx)` (`:44`).
- **Data flow:** copy the packaged assets into a private temp directory → parse the SKILL.md frontmatter → register a `SkillProvider` that serves the body.
- **Non-obvious design decisions:**
  - **The provider owns a private filesystem copy of its resources** so external PowerShell can execute them even when the package lives inside ASAR or SEA.
  - **Disposal removes both the provider and its resource copy.**
  - Missing or invalid packaged assets **fail registration** rather than registering a broken skill.
- **Edge cases & failure handling:** the frontmatter parser requires a `description`; the resource files are written `wx` (no clobber) at mode `0600`.
- **Surprising:** the skill is registered by `sandbox-local` on Windows only, and only when the *built-in* runner is used — an operator `runnerCommand` does not register it.

##### `packages/sandbox/sandbox-windows-acl/src/path-boundary.ts`
- **Purpose:** the canonical directory-boundary checks between the workspace and temp capabilities.
- **Key abstractions:** `assertTempRootOutsideWorkspace` (`:22`), `assertPrivateTempDisjoint` (`:34`).
- **Data flow:** `realpathSync.native` on both sides → a `relative()` containment test.
- **Non-obvious design decisions:**
  - **A temp root *inside* the workspace is rejected**, because every child created below it would inherit the standing workspace capability.
  - **The private temp directory must be disjoint from the writable directories in *either* direction** — either inheritance direction would merge the two capabilities.
- **Edge cases & failure handling:** the check is done on canonical paths, so an alias spelling is caught.
- **Surprising:** the "temp parent above the workspace" case is *accepted*, because a fresh child of that parent is a sibling of the workspace, not inside it.

##### `packages/sandbox/sandbox-windows-acl/src/spawn.ts`
- **Purpose:** thin adapters over the shared Win32 process owner.
- **Key abstractions:** `spawnSandboxed`, `spawnSandboxedInherited`, `waitForExit`, and the re-exported `drainPipe`.
- **Data flow:** a restricted token + command/args/cwd → a native process (piped or in a kill-on-close Job).
- **Non-obvious design decisions:** the package owns *no* Win32 logic of its own — the process, stdio, Job, wait, and handle-cleanup primitives belong to `@deepseek-ai/dsh-win32-process`, which is separately ABI-verified.
- **Edge cases & failure handling:** n/a (delegated).
- **Surprising:** this file exists purely to keep the sandbox's own surface narrow; a future native-exe runner would keep the same argv contract and only swap the entries.

##### `packages/sandbox/sandbox-windows-acl/src/workspace-sid.ts`
- **Purpose:** derive the per-workspace and per-temp write identities.
- **Key abstractions:** `workspaceWriteSid(workspaceRoot)` (`:35`), `tempWriteSid(tempDir)` (`:49`).
- **Data flow:** `sha256(canonicalPath)` → two 30-bit sub-authorities → `S-1-4-x-y` (workspace) or `S-1-4-x-y-1` (temp).
- **Non-obvious design decisions:**
  - **The workspace SID is deterministic from the canonical path**, so the workspace-root ACE materializes once per workspace per machine and every later session, call, or restart hits the exact-ACE skip.
  - **The temp SID is domain-separated** by a `'temp\0'` prefix and a third sub-authority, so it can never collide with a workspace SID.
  - **The SID string is not a secret** — the SID's power is defined solely by the ACEs that name it.
- **Edge cases & failure handling:** renaming the workspace derives a *new* SID; the old standing ACEs are inert residue and the next session re-propagates once.
- **Surprising:** the derivation is *byte-sensitive* — an alias spelling derives a second identity, which is self-healing but costs one extra tree propagation.

##### `packages/sandbox/sandbox-windows-acl/src/win32-abi.ts`
- **Purpose:** the ACL/token-specific Win32 constants.
- **Key abstractions:** the access masks (`GRANT_MASK`, `FILE_GENERIC_WRITE`, `FILE_DELETE_CHILD`), the `CreateRestrictedToken` flags, the ACE types, and the struct sizes.
- **Data flow:** constants only.
- **Non-obvious design decisions:**
  - **`GRANT_MASK` excludes `WRITE_DAC` and `WRITE_OWNER`** — a confined child cannot rewrite DACLs or take ownership to escape the allowlist.
  - **`SYSTEM_MANDATORY_LABEL_NO_WRITE_UP`** is used because the kernel applies it inside the access check, covering writes and deletes granted through a parent's `FILE_DELETE_CHILD` right — the path the write-restricted pass-2 intersection does not reach.
- **Edge cases & failure handling:** n/a.
- **Surprising:** every constant here is checked against the real Windows headers by `verify/abi-probe.cpp` with `static_assert`s — the sizes are not guesses.

##### `packages/sandbox/sandbox-windows-acl/verify/abi-probe.cpp`
- **Purpose:** a C++ program that prints the real Windows struct sizes and offsets, plus `static_assert`s.
- **Key abstractions:** `TRUSTEE_W`, `EXPLICIT_ACCESS_W`, `SID_AND_ATTRIBUTES`, `TOKEN_MANDATORY_LABEL`, `ACL` sizes and offsets.
- **Data flow:** compiled and run against the Windows SDK, then the numbers are transcribed into `win32-abi.ts`.
- **Non-obvious design decisions:** the ABI is *proved*, not documented — a mismatch between the JS assumptions and the native layout would corrupt memory silently.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the file also asserts the derived `GRANT_MASK == 0x110156`, so the mask in the TypeScript is tied to the same check.

##### The bundled diagnosis skill (`assets/diagnose-windows-sandbox-acl/`)

##### `packages/sandbox/sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/SKILL.md`
- **Purpose:** the model-facing instructions for diagnosing an unexpected Windows sandbox denial.
- **Key abstractions:** the "one command diagnoses and repairs" contract; the `nextAction` decision table.
- **Data flow:** the model reads the skill, runs the one script command, reads the `RECAP`, and decides.
- **Non-obvious design decisions:**
  - **The skill says to write the approval request in plain words, in the user's language**, and to keep `WRITE_DAC`/`icacls`/ACE vocabulary *out* of the prompt — the prompt is all the user reads before widening access.
  - **The script has no modes**: it reads the path and every ancestor and repairs what the observations prove, in the same run. The skill forbids splitting it into a diagnostic call and a repair call, and forbids asking twice.
  - **The script must be run unconfined**, because it writes permissions the confined token cannot — running it confined would report the sandbox's own restriction as a missing right.
  - **Trust `verification` records, never `completed` actions.**
  - **A deny ACE's presence alone does not establish causation**, and the script never removes one.
- **Edge cases & failure handling:** the skill tells the model to stop after any failed or refused repair, and to name the blocking object and the missing right — and to ask the user to switch to full access and to send the session as feedback.
- **Surprising:** the skill is a *repair* tool, not a diagnostic one, and it explicitly forbids a second repair attempt after a failure.

##### `packages/sandbox/sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/scripts/diagnose-windows-sandbox-acl.ps1`
- **Purpose:** the one-command diagnose-and-repair script (798 lines of PowerShell).
- **Key abstractions:** `Write-Report` (JSONL records to stdout *and* a report file), `Invoke-ReportedOperation`, `Get-ObjectFacts`, `Get-SubtreePackageSources`, `Save-AclBackup`, `Restore-SavedDacl`, `Get-RepairRefusal`, and the `RECAP` summary.
- **Data flow:** inspect the path and every ancestor → classify → refuse anything outside `-AllowRoot` → back up → repair (grant FullControl where `WRITE_DAC`/`WRITE_OWNER` are missing; remove explicit AppContainer package allow ACEs ancestor-first) → verify by re-reading → on failure, restore every attempted change in reverse order → print `RECAP`.
- **Non-obvious design decisions:**
  - **The report is written to a JSONL file because tool output keeps only its tail** — the complete record set must survive truncation.
  - **The script never creates, deletes, or writes the contents of any file**; its only writes are the recovery artifacts and the DACLs it repairs.
  - **Every change is backed up first, with an independent recovery script**, and the recovery command is printed.
  - **Refusals are checked before any change**: outside `-AllowRoot`, a dangerous root (drive root, user profile, Windows directory, managed application tree), or a path traversing a reparse point.
  - **Missing observations are treated as incomplete, not as evidence** — the script refuses rather than inventing permissions.
  - **The caller-owned temp root is never an implicit grant** and the ambient temp root is never granted.
  - **The verdict vocabulary is `NOT_THIS_CLASS | PRECONDITION | CULPRIT | BOTH | UNREADABLE | INCOMPLETE`** — "not this class" is a first-class, non-blameful answer.
- **Edge cases & failure handling:** a failed repair restores all attempted DACL changes from this invocation in reverse order and exits non-zero; the rollback status is reported as `verified`/`failed` and maps to `restore_pending_then_stop`.
- **Surprising:** the script reads the caller's *integrity level* through `GetTokenInformation` rather than `whoami.exe`, because inside a below-Medium token that process fails to initialize (`0xc0000142`) and raises an application-error dialog on the user's desktop.

#### `packages/storage/storage` — the backend hub

##### `packages/storage/storage/src/backend.ts`
- **Purpose:** the normative backend contract.
- **Key abstractions:** `StorageBackend` (`:17`), `KvFacet` (`:30`), `KvUnitDescriptor` (`:46`), `KvUnit` (`:85`), `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/` (`:10`).
- **Data flow:** a descriptor → `kv.open(descriptor)` → a `KvUnit` handle with `loadAll` / `putRecord` / `deleteRecord` / `setGlobal` / `backupRecord?` / `close`.
- **Non-obvious design decisions:**
  - **`UNIT_NAME_RE` is one regex for both file names and SQL identifier segments** — a name that is safe as a file name is safe as an identifier without escaping.
  - **Record keys are arbitrary strings and never reach file paths** (in the `single` layout); in the `per-record` layout a key becomes a path segment and must match `[a-zA-Z0-9_-]+`.
  - **The unit does NOT serialize concurrent writes** — ordering is the caller's responsibility (the domain layer runs one write chain per unit). The unit only guarantees each call is atomic and durable once resolved.
  - **`backupRecord?` is optional** — a backend whose medium has no per-record document to move omits it, and the caller falls back to its reject-loud path.
  - **A version already stamped on the medium that differs from the descriptor's rejects with `version-mismatch`; there is no migration.**
- **Edge cases & failure handling:** any call after `close` rejects with `closed`; a medium that cannot be parsed as this unit rejects with `malformed-medium`.
- **Surprising:** the file's doc comment says it is "the normative contract text for backend implementers" and the shared conformance suite in `tests/contract.ts` checks every rule.

##### `packages/storage/storage/src/index.ts`
- **Purpose:** the `ctx.storage` hub.
- **Key abstractions:** `Storage extends Service` (`:47`), `StorageForms` (the declaration-merged form map), `mount(form, facility)` (`:64`), `form(form)`, `storageBackendServiceKey(name)` (`:26`).
- **Data flow:** backends register under `backend`; data forms mount under their form key; consumers reach `ctx.storage.domain` or `ctx.storageDomain`.
- **Non-obvious design decisions:**
  - **The hub performs no IO.** It is a pure registration table with two faces.
  - **Registration and mounting are effects** — the returned disposer removes only *that* registration's contribution, so a stale disposer firing after a re-register does not remove the successor.
  - **Each backend also publishes a lifecycle-only service key** (`storage.backend.<name>`), so a form provider can `inject` those keys and activate only after every configured backend has registered — activation cannot race registration, while callers still resolve backends by name through the hub.
- **Edge cases & failure handling:** a duplicate mount throws `duplicate-mount`; reading a form before its owner mounts throws `form-not-mounted`.
- **Surprising:** the package's `export default` is the service class **only** — mixing a default export with a function-plugin `apply` would make the Loader drop the plugin namespace (the same trap the `tool-fs-search` test guards against).

##### `packages/storage/storage/src/registry.ts`
- **Purpose:** the named backend table.
- **Key abstractions:** `BackendRegistry` (`:14`), `register(name, backend)`, `get(name)`, `names()`.
- **Data flow:** name → backend.
- **Non-obvious design decisions:** **the disposer does not close the backend** — the owning plugin closes it after unregistering. And the disposer only removes its own contribution (`if (this.backends.get(name) === backend)`).
- **Edge cases & failure handling:** a duplicate name throws `duplicate-backend`; an unknown name throws `backend-not-found` with the registered names listed in the message.
- **Surprising:** the error message enumerates the registered backends — a diagnostic that turns a typo into an instant fix.

##### `packages/storage/storage/src/error.ts`
- **Purpose:** the shared error vocabulary.
- **Key abstractions:** `StorageErrorCode = 'backend-not-found' | 'form-not-mounted' | 'duplicate-backend' | 'duplicate-mount' | 'version-mismatch' | 'malformed-medium' | 'closed'`, `StorageError`.
- **Data flow:** types only.
- **Non-obvious design decisions:** the code is the stable contract consumers switch on; the message is diagnostic prose.
- **Edge cases & failure handling:** standard `ErrorOptions` for `cause`.
- **Surprising:** there is no code for a double-open — that is a *caller bug* and the backends throw a plain `Error` for it, deliberately.

#### `packages/storage/storage-domain` — the typed domain form

##### `packages/storage/storage-domain/src/domain.ts`
- **Purpose:** the open-domain runtime: authoritative memory, one write chain per domain, change emission.
- **Key abstractions:** `Domain<S>` (`:97`), `KvTable<K,V>` (`:42`), `DomainGlobal<G>`, `DomainImpl` (`:140`), `enqueue` (`:263`), `runClose` (`:236`), `emitChanged` (`:251`).
- **Data flow:** `put`/`delete`/`update`/`global.set` → queue on the domain's single chain → **await backend durability FIRST** → mutate memory → emit `domain/changed`.
- **Non-obvious design decisions:**
  - **Memory is authoritative; the medium is the durable projection.** A rejected backend write leaves memory untouched, so reads never diverge from the medium.
  - **The write order is durability → memory → event.** Every one of the three is in that order, always.
  - **`update`'s transform runs at its chain slot**, so concurrent updates never interleave; the transform is a *synchronous pure* function, and its `current` is the value at that slot.
  - **The event is a notification, not a transaction participant.** A throwing listener is contained with a logged warning rather than rejecting the already-durable write.
  - **`entries()`/`keys()` are snapshots, not live views** — iteration stays stable while queued writes land.
  - **Returned records are the stored objects themselves** (no defensive copies) and must not be mutated in place.
- **Edge cases & failure handling:** `close()` rejects new writes immediately, drains already-queued writes (their events still emit), releases the unit, and only then frees the domain name; it is idempotent.
- **Surprising:** `delete` decides existence *at its chain slot*, not at call time — an earlier queued `put` of the same key makes the delete observe it and return `false`.

##### `packages/storage/storage-domain/src/spec.ts`
- **Purpose:** the domain declaration vocabulary.
- **Key abstractions:** `DomainSpec` (`:35`), `DomainTableSpec`, `DomainGlobalSpec`, `defineDomain(spec)` (`:107`), `domainTable(schema)` (`:91`), `descriptorOf(spec)` (`:154`).
- **Data flow:** the owning package declares a spec once; the type surface and the runtime (validation, descriptor projection) both derive from it.
- **Non-obvious design decisions:**
  - **`defineDomain` fails loud at the owning package's module load**, before any medium is touched.
  - **The global schema must not accept `null`.** `null` is the medium's "never written" sentinel, so a nullable global would be indistinguishable from an absent one on reopen.
  - **`compatibleVersions` entries must be below the current version** — the owner vouches for older records, but the list is forward-only by construction.
  - **`invalidRecords: 'backup-and-skip'` exists for disposable derived data**: the backend moves the record's document aside, the failure is logged, and the open continues with the record absent. A backend that cannot move a document keeps the rejecting default.
  - **Record schemas are zod, plugin `Config` is schemastery** — a deliberate split, with the rationale in the module comment.
- **Edge cases & failure handling:** a bad name, a negative/fractional version, an unknown `invalidRecords`, an invalid `layout`, or a nullable global all throw at declaration time.
- **Surprising:** the `layout` union is compile-time only — a spec built from config could carry any value, so the runtime boundary re-checks it.

##### `packages/storage/storage-domain/src/index.ts`
- **Purpose:** the `ctx.storage.domain` facility.
- **Key abstractions:** `DomainFacility` (`:69`), `open<S>(spec)` (`:103`), `Config {backend, routes}`, `parseRecord` (`:198`).
- **Data flow:** `open` → reject an already-open name → resolve the route → require the `kv` facet → open the unit → `loadAll` → validate every stored record against the spec's zod schemas → construct the domain.
- **Non-obvious design decisions:**
  - **The route table is per-domain configuration, not a hub-global choice.** Multiple backends stay mounted side by side.
  - **The facility waits for every configured backend to register** (`ctx.inject` on the derived service keys), so row order in a composition is not a failure mode.
  - **The caller owns the handle's lifecycle.** The facility closes any domain left open when it unmounts.
  - **A failed open releases the name reservation unconditionally**, so a later attempt can succeed.
  - **A null stored global means "never written"** and serves `initial` without materializing it.
- **Edge cases & failure handling:** `already-open`, `facet-unsupported`, `invalid-record` (naming the table and key), `missing-key`, `closed`; backend `version-mismatch`/`malformed-medium` pass through unchanged.
- **Surprising:** the domain name is *reserved* the instant `open` is called, so a concurrent second open of the same name fails loud rather than racing.

##### `packages/storage/storage-domain/src/events.ts`
- **Purpose:** the change-event vocabulary.
- **Key abstractions:** `DomainChangedPut` / `DomainChangedDeleted` (`:34`), the `domain/changed` event (`:46`).
- **Data flow:** one event per durable write, strictly after the backend acknowledged durability, carrying the *new* snapshot and an operation discriminant.
- **Non-obvious design decisions:**
  - **The event never carries the old value** — a diffing consumer keeps its own previous snapshot.
  - **Deletes are tombstones** with no value.
  - **Events of one domain arrive in its write-chain order.**
- **Edge cases & failure handling:** the global singleton is signalled by `table === ''` and `key === ''`.
- **Surprising:** the file names the future use — "this is the event source for cross-process change push (RPC frames) in a later phase", which is not implemented yet.

##### `packages/storage/storage-domain/src/error.ts`
- **Purpose:** the domain-layer error vocabulary.
- **Key abstractions:** `DomainErrorCode = 'already-open' | 'facet-unsupported' | 'invalid-record' | 'missing-key' | 'closed'`, `InvalidRecordDetail`, `DomainError`.
- **Data flow:** types only.
- **Non-obvious design decisions:** **`invalid-record` carries a `detail` with the table and key**, and only that code has a detail. Backend failures pass through as `StorageError` — the domain layer does not rewrap them.
- **Edge cases & failure handling:** the zod failure is chained as `cause`.
- **Surprising:** the `detail` field is typed `readonly detail?:` with "present exactly when `code` is `invalid-record`" — the type makes the pairing optional but documented.

#### `packages/storage/storage-json` — the human-readable medium

##### `packages/storage/storage-json/src/index.ts`
- **Purpose:** the JSON backend — one human-readable document per unit under a configured root.
- **Key abstractions:** `JsonStorageBackend` (`:39`), `Config {root}`.
- **Data flow:** `kv.open(descriptor)` → validate the descriptor → open the unit by layout → track it.
- **Non-obvious design decisions:**
  - **`root` has NO default.** A `process.cwd()` fallback would scatter unit files wherever the process happened to start; assemblies state the location explicitly.
  - **The opening slot is reserved synchronously at `open()` entry**, so a concurrent open of the same unit fails and `close()` can await opens still in flight.
  - **The root is created with mode `0700`.**
- **Edge cases & failure handling:** an invalid unit or table name rejects as `malformed-medium`; a double-open is a plain `Error` (a caller bug, not a medium condition); a backend that closed mid-open closes the unit and throws `closed`.
- **Surprising:** the plugin registers the backend *and* provides the lifecycle service key, and the disposer unregisters first, then closes.

##### `packages/storage/storage-json/src/atomic.ts`
- **Purpose:** durable whole-file replacement.
- **Key abstractions:** `writeAtomic(path, data)` (`:24`), `fsyncDirectory(path)` (`:44`).
- **Data flow:** write a same-directory temp file → `fsync` it → `rename()` over the target → `fsync` the parent directory (POSIX).
- **Non-obvious design decisions:**
  - **Rename is the correct primitive here** — unlike the session-log backend's `link()+unlink()` no-clobber protocol, a unit file has exactly one writer per process and last-write-wins is correct.
  - **The parent directory is fsynced after the rename** so the new entry is crash-durable.
  - The directory fsync is skipped on Windows, which rejects `O_RDONLY` directory opens.
- **Edge cases & failure handling:** a failed write removes the temp file and rethrows.
- **Surprising:** the module comment explains *why* rename and not link+unlink — the two protocols are deliberately different for different guarantees.

##### `packages/storage/storage-json/src/format.ts`
- **Purpose:** the on-disk JSON unit format.
- **Key abstractions:** `UnitState`, `serialize(name, state)` (`:28`), `parse(text, descriptor)` (`:47`), `serializeRecord`, `parseRecord(text, versions)` (`:117`).
- **Data flow:** in-memory state → pretty-printed JSON with a stable key order → file; and back.
- **Non-obvious design decisions:**
  - **The file is always the current net state, kept human-readable** — legibility is the backend's reason to exist.
  - **`typeof tables !== 'object'` alone admits an array.** Reading one as a table map reports every declared table as absent, and the next publish replaces the file with that empty view, discarding records the reader could not see — so the array case is rejected explicitly.
  - **A malformed or wrongly-stamped per-record document reads as an *absent record*, not a failure.** One bad file must not brick the whole unit.
  - **The whole-unit format rejects a version mismatch instead** — there is exactly one document, so there is nothing to salvage.
- **Edge cases & failure handling:** a foreign unit header, a non-object `tables`, a non-object table, and a stored version ≠ descriptor version each get a distinct `StorageError` code.
- **Surprising:** `parseRecord` returns `undefined` for a document whose stamp is outside the accepted set — the per-record contract *discards* rather than migrates.

##### `packages/storage/storage-json/src/single-unit.ts`
- **Purpose:** the `single` layout — the whole unit is one document at `<root>/<name>.json`.
- **Key abstractions:** `openSingleUnit` (`:28`), `SingleJsonUnit` (`:52`).
- **Data flow:** memory is authoritative; every write mutates memory, serializes the complete state, and atomically replaces the file.
- **Non-obvious design decisions:**
  - **A failed publish rolls back the in-memory value** — memory is authoritative, so a rejected write must not survive in memory or ride along with the next publish.
  - **Writes are NOT queued here.** Ordering belongs to the caller (the domain layer's write chain); the unit only guarantees each call publishes a complete, durable file.
  - **The unit file is deferred materialization** — a missing file opens as an empty unit.
- **Edge cases & failure handling:** `close()` drains the in-flight publishes before releasing the unit; an undeclared table is a caller error; `setGlobal` on a unit without a global slot is a caller error.
- **Surprising:** the two unit classes (`SingleJsonUnit` and `PerRecordJsonUnit`) duplicate the drain/guard lifecycle, and the duplication is *explicitly marked* with a `jscpd:ignore` block — the classes are standalone by design.

##### `packages/storage/storage-json/src/per-record-unit.ts`
- **Purpose:** the `per-record` layout — one version-stamped document per record.
- **Key abstractions:** `openPerRecordUnit` (`:51`), `PerRecordJsonUnit` (`:195`), `SAFE_KEY_RE`, `bootstrapLegacyUnit` (`:123`), `backupRecord` (`:238`).
- **Data flow:** the unit directory *is* the state — `loadAll` re-reads the tree; each put/delete is one durable file operation.
- **Non-obvious design decisions:**
  - **The per-record unit holds NO in-memory state.** The domain layer owns the live memory and serializes the writes, so the unit never mutates memory and needs no rollback.
  - **Record keys become path segments**, so they must be path-safe (`[a-zA-Z0-9_-]+`); an unsafe key rejects before any file operation.
  - **The legacy bootstrap is deliberately conservative**: it only runs when the new tree has *no* document path at all, only when the legacy file's unit name matches, and only when its stored version is in the accepted set. Migrating records the owner never vouched for would stamp them with the current version and turn a discardable stale cache into schema failures at the domain layer.
  - **The legacy file is never changed or deleted.**
  - **`backupRecord` renames the document to `<key>.json.bak.<YYYYMMDDHHmm>`** — the moved file no longer ends in `.json`, so every later read ignores it, and the bytes stay on disk for inspection.
- **Edge cases & failure handling:** a missing directory is the empty unit; an unreadable record document reads as absent; a same-minute backup of the same key overwrites the previous one (the newer bytes are the ones worth keeping).
- **Surprising:** any document path in a declared table — *even an unreadable or stale one* — suppresses the legacy bootstrap for the whole unit.

#### `packages/storage/storage-sqlite` — the point-update medium

##### `packages/storage/storage-sqlite/src/index.ts`
- **Purpose:** the SQLite backend — one database file hosts every routed unit, document-per-row.
- **Key abstractions:** `SqliteStorageBackend` (`:55`), `Config {path, journalMode}`, `materializeUnit` (`:98`).
- **Data flow:** `kv.open(descriptor)` → validate names → reserve the unit name synchronously → open the DB → read the unit's version row → insert or reject on mismatch → `CREATE TABLE IF NOT EXISTS` per declared table → hand back the unit.
- **Non-obvious design decisions:**
  - **The unit name is reserved synchronously** so a concurrent second open rejects instead of racing past the guard during the awaits.
  - **The version stamp lives in a `units` table** and a mismatch rejects with `version-mismatch` — no migration.
  - **The record tables are `STRICT`** and the identifier is built from two already-validated segments, so no external input is ever interpolated into SQL identifiers.
  - **The disposer unregisters the name first, then closes the medium.**
- **Edge cases & failure handling:** a pending open that fails removes its reservation; `close()` drains a still-pending failed open.
- **Surprising:** `this.ready.catch(() => {})` marks the open-failure rejection handled — every primitive re-awaits `ready`, so the failure still surfaces to each caller; the guard only prevents an unhandled-rejection crash when the failure precedes the first use.

##### `packages/storage/storage-sqlite/src/schema.ts`
- **Purpose:** the physical layout version and the open/configure sequence.
- **Key abstractions:** `STORAGE_SQLITE_SCHEMA_VERSION = 1` (`:20`), `JournalMode` (`wal | delete | truncate | persist`), `openDatabase(path, journalMode)` (`:60`), `recordTableName(unit, table)` (`:117`).
- **Data flow:** create the parent `0700` → exclusively create a missing DB file `0600` → open → pragmas → check `user_version` → create the metadata tables → stamp a fresh DB.
- **Non-obvious design decisions:**
  - **`memory` and `off` journal modes are excluded** — dropping journal durability silently contradicts the durability clause of the KV contract.
  - **A fresh database is stamped LAST.** The stamp asserts the layout is complete, so a failure above leaves the medium unstamped and a re-open retries materialization from scratch.
  - **The physical layout version is orthogonal to the per-unit format version.** The DB version is in `PRAGMA user_version`; the unit version is in the `units` row.
  - **Existing files retain their modes**; only missing ones are created owner-only.
- **Edge cases & failure handling:** a non-zero, non-current `user_version` rejects outright — the pre-release stance is no migration.
- **Surprising:** `recordTableName` produces `u_<unit>_<table>` — the `u_` prefix keeps it from colliding with the metadata tables.

##### `packages/storage/storage-sqlite/src/unit.ts`
- **Purpose:** one opened SQLite unit — prepared statements over the record tables.
- **Key abstractions:** `SqliteKvUnit` (`:27`), `TableStatements`, `settle(operation)` (`:132`).
- **Data flow:** prepared statements prepared once at construction; every primitive is a single statement.
- **Non-obvious design decisions:**
  - **Atomicity comes from SQLite itself** — no explicit transactions, and no write queue (ordering is the caller's).
  - **`loadAll` uses a null-prototype object** so a record key like `__proto__` lands as an own property instead of mutating the prototype. There is a test that pins exactly this.
  - **`settle` maps a synchronous throw to a rejection**, so the Promise-returning contract never throws synchronously. A non-`Error` throw (a value's own `toJSON` throwing a string) is wrapped in an `Error`.
  - **Bad stored JSON maps to `malformed-medium`** naming the table and key.
- **Edge cases & failure handling:** an undeclared table and a unit with no global slot are caller errors; every call after `close` rejects with `closed`.
- **Surprising:** the `value` column is JSON *text* — the schema is document-per-row, not a typed column set, so a domain's record shape is entirely the domain layer's business.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/fs/README.md` | Package-group map for `packages/fs`: the seven packages, the ctx keys, and the decision that the policy is a plugin rather than an injected service. |
| `packages/fs/README.zh.md` | Chinese mirror of the above; content is the same decision set. |
| `packages/fs/fs/README.md` | The `ctx.fs` contract: "contract over mechanism", "policy stays off the base class", "editText stays on the seam", "bounds live at this seam"; plus the three `fs/*` events. |
| `packages/fs/fs/README.zh.md` | Chinese mirror of the `ctx.fs` contract page. |
| `packages/fs/fs/package.json` | `@deepseek-ai/dsh-fs` — the abstract filesystem capability seam; peer-depends on `dsh-llm`, `dsh-sandbox`, `dsh-brand`, cordis. |
| `packages/fs/fs/tsconfig.json` | Project references: cosmokit, cordis, brand, llm, sandbox. |
| `packages/fs/fs/tests/service.spec.ts` | Pins the seam contract with a fake backend: registration, duplicate-service throw, disposal, `readByteRange` windowing, `readBytes` cap, `watch` rejection, `listDir` metadata-only, branded id identity, `FsError` code + cause. |
| `packages/fs/fs-local/README.md` | Host backend reference: realpath identity, atomic publication, one mutation critical section; plus an explicit "Known Limitations" list (cwd is not a sandbox, binary detection asymmetry, in-process-only lock, hard-link requirement). |
| `packages/fs/fs-local/README.zh.md` | Chinese mirror of the host backend reference. |
| `packages/fs/fs-local/package.json` | `@deepseek-ai/dsh-fs-local` — host-filesystem `ctx.fs`; depends on `chokidar` and `koffi`. |
| `packages/fs/fs-local/tsconfig.json` | Project references: cosmokit, cordis, schemastery, llm, fs. |
| `packages/fs/fs-local/tests/filesystem.spec.ts` | The local backend through `ctx.fs`: resolve/stat/lstat, byte-range and byte-capped reads, `listDir` ordering, guarded writes (createIfAbsent / replaceIfVersion incl. the race and dangling-symlink cases), the diff-basis `before: null` cases, edit ordering (stale checked *before* literal matching), concurrent write/edit races, symlink target identity, lock release, HMR disposal. |
| `packages/fs/fs-local/tests/fsio.spec.ts` | Cordis-free mechanics: `resolveLocalTarget` (missing target, symlinked ancestor, ENOTDIR), probe/probeNoFollow, `listDirectory` error translation, `readWholeText` binary/UTF-8 rejection, `readTextForDiff` growth/shrink/deletion races, `streamWholeText` chunked decoding, `writeFileAtomic` staging safety and Windows DACL path, `applyLiteralEdit` match rules, CRLF round-trip. |
| `packages/fs/fs-local/tests/watch.spec.ts` | Chokidar adapter: the parent-directory watch for a file target, the directory watch, cancellation before and during initialization, error normalization, and the async close contract. |
| `packages/fs/fs-local/tests/win32.spec.ts` | Host-independent DACL helper tests: read/install/replace ordering, Win32→errno mapping, and every failure path. |
| `packages/fs/fs-observation-policy/README.md` | The read-before-edit policy reference: three logical states (unseen / confirmed absent / present-at-version), the single-slot first-wins decision, the "the switch is its event" session-log design, and the limits (no resume survival, no agentless owner, direct `ctx.fs` reads emit no observation, freshness ≠ full-view). |
| `packages/fs/fs-observation-policy/README.zh.md` | Chinese mirror of the observation-policy reference. |
| `packages/fs/fs-observation-policy/package.json` | `@deepseek-ai/dsh-fs-observation-policy` — "observed-state, read-before-edit, and version-guarded write/edit added over the ctx.fs provider seam through the fs/* event gate (no service API)". |
| `packages/fs/fs-observation-policy/tsconfig.json` | Project references: cosmokit, cordis, llm, fs. |
| `packages/fs/fs-observation-policy/tests/policy.spec.ts` | Event-level policy tests: no service API, no `inject`, write-intent decisions for every owner shape, edit-intent refusals, present→absent→present transitions, multi-owner isolation, first-wins short-circuit, and disposal clearing the state. |
| `packages/fs/fs-sandbox/README.md` | The confining backend reference: mode behaviour, the "re-canonicalize now and mutate *that* target" TOCTOU direction, the explicit "policy fence, not a kernel boundary" threat model, and the limit that the fence-vs-runner parity is derived from one owner. |
| `packages/fs/fs-sandbox/README.zh.md` | Chinese mirror of the fs-sandbox reference. |
| `packages/fs/fs-observation-policy/locale/en.json` | English plugin title: `fs-observation-policy`. |
| `packages/fs/fs-observation-policy/locale/zh.json` | Chinese plugin title + description: "文件编辑保护 / 确保智能体先读取文件再修改，降低误覆盖风险。". |
| `packages/fs/fs-sandbox/package.json` | `@deepseek-ai/dsh-fs-sandbox` — sandbox-enforcing `ctx.fs`; peer-depends on fs, fs-local, sandbox, sandbox-policy. |
| `packages/fs/fs-sandbox/tsconfig.json` | Project references: cosmokit, cordis, fs, fs-local, sandbox, sandbox-policy. |
| `packages/fs/fs-sandbox/locale/en.json` | English plugin title: `fs-sandbox`. |
| `packages/fs/fs-sandbox/locale/zh.json` | Chinese plugin title + description: "文件系统沙箱 / 限制智能体只能修改工作区内的文件。". |
| `packages/fs/fs-sandbox/tests/containment.spec.ts` | Containment: equal paths, descendants, filesystem-root boundary, case-insensitive comparison, symlink alias recognition by identity for a *missing* target, unrelated/missing roots, and a regular-file ancestor treated as absent. |
| `packages/fs/fs-sandbox/tests/fs-sandbox.spec.ts` | The fence on a real filesystem: read-only denies write and edit (no file left on disk), workspace-write allows the workspace and the platform temp, denies absolute/outside paths, `..` traversal, symlink escapes, and a *stale* targetKey; the TOCTOU direction (fresh identity mutated, stale outside path untouched); per-call escalation stamps; the structured `FsError` identity. |
| `packages/fs/tool-fs/README.md` | The model-facing file tools: the four tools and their arguments, the read caps, the policy and sandbox behaviour, the exact model-facing envelopes and footers, the exact error texts, and the limits (no model-facing directory listing, text-only read, extension-declared media type, no timeout surface). |
| `packages/fs/tool-fs/README.zh.md` | Chinese mirror of the tool-fs reference. |
| `packages/fs/tool-fs/package.json` | `@deepseek-ai/dsh-tool-fs` — read / read_image / write / edit over `ctx.fs`; peer-depends on fs, sandbox, sandbox-policy, tools, attachments, system-prompt, working-directory. |
| `packages/fs/tool-fs/tsconfig.json` | Project references across tools, system-prompt, fs, fs-observation-policy, sandbox, sandbox-policy, user-approval, attachment, code-language, working-directory. |
| `packages/fs/tool-fs/locale/en.json` | English plugin title: `tool-fs`. |
| `packages/fs/tool-fs/locale/zh.json` | Chinese plugin title + description: "文件读写工具 / 让 AI 读取、创建和编辑工作文件". |
| `packages/fs/tool-fs/tests/diff.spec.ts` | Pins the contextual-diff hunks: ±3 context lines, one diff per hunk for a scattered replace_all, no-op → no hunks, pure insertion → `oldText: null`, the `\ No newline` marker dropped, and the defensive `meta` narrowing. |
| `packages/fs/tool-fs/tests/error.spec.ts` | Pins the model-facing diagnostics: the stale remedy, the two-sources-to-one `FS_NOT_OBSERVED` normalization, code preservation, cause chaining, and pass-through of other codes and non-`FsError` values. |
| `packages/fs/tool-fs/tests/fs-tools.e2e.ts` | Key-gated real-model smoke: write → read → edit verified on disk, and the per-session cwd routing (the file lands in the session dir, not the config dir). |
| `packages/fs/tool-fs/tests/harness.ts` | The with-key e2e harness: mounts the real fs stack (LocalFileSystem + observation policy + tool-fs) over a working-directory fixture; deliberately outside the e2e glob so importing it registers no tests. |
| `packages/fs/tool-fs/tests/integration.spec.ts` | End-to-end tool-registry tests over the *real* local backend: the default deployment (policy mounted) vs the bare deployment (unconditional), the stat budget (read stats once, write/edit never stat), per-session cwd, concurrent edits, the stale-CAS failure, the throwing-`fs/observed`-listener case (mutation on disk, result isError), and the working-directory change routing. |
| `packages/fs/tool-fs/tests/read-image.spec.ts` | `read_image` over the real filesystem and attachment store: extension routing, extension-less sniffing, the strict image-modality gate, durable commit + image block, every attachment admission failure, the downscale coordinate multiplier, and that `read` keeps its text-only contract. |
| `packages/fs/tool-fs/tests/read-render.spec.ts` | Windowing: offset/limit, CRLF stripping, per-line truncation, the byte cap, offset-past-EOF rejection, the capped line buffer for newline-free giant lines, and the semantic `meta` validation on replay. |
| `packages/fs/tool-fs/tests/tools.spec.ts` | Consumer API over a fake provider: per-tool enable/disable and prompt sections, `file_path`-first schema ordering, parallel-vs-exclusive execution mode, the read window and footers, observed-state authorization, streaming routing, the diff card projection, the sandbox escalation API (advertisement, stamping, denial mapping, fail-closed arms), and scope-aware prompt guidance across all 8 visibility masks. |
| `packages/fs/tool-fs-search/README.md` | The discovery tools: glob/grep arguments, the required over-cap sampling choice, the search caps, the deployment requirement (no host `rg`), the `SEARCH_*` error codes, the two-budgets-two-artifacts design, and the limits (no shared-workspace proof, no pagination, sampling groups by first path segment only). |
| `packages/fs/tool-fs-search/README.zh.md` | Chinese mirror of the tool-fs-search reference. |
| `packages/fs/tool-fs-search/package.json` | `@deepseek-ai/dsh-tool-fs-search` — glob/grep backed by `@vscode/ripgrep`; peer-depends on subprocess, spill, output-retention, timeout, tools, working-directory. |
| `packages/fs/tool-fs-search/tsconfig.json` | Project references across output-retention, llm, session, tools, system-prompt, shell, spill, timeout, working-directory. |
| `packages/fs/tool-fs-search/locale/en.json` | English plugin title: `tool-fs-search`. |
| `packages/fs/tool-fs-search/locale/zh.json` | Chinese plugin title + description: "文件搜索工具 / 让 AI 按文件名或文本内容搜索本地文件". |
| `packages/fs/tool-fs-search/tests/integration.spec.ts` | The *real* subprocess service plus the packaged `rg`: discovery by pattern with hidden files included and `.git` excluded, directory scoping, zero results, VCS internals excluded when the root *is* the VCS dir, hostile patterns inert, leading-dash patterns, real regex-error classification, the session-cwd resolution, and pre-dispatch cancellation. |
| `packages/fs/tool-fs-search/tests/load-path.spec.ts` | The real-load-path guard: unwraps the module through the REAL `Loader.prototype.unwrapExports` to prove a stray `export default apply` would drop `inject` and break the composition. |
| `packages/fs/tool-fs-search/tests/presentation.spec.ts` | The search-card projections: by-file grouping, `total`/`truncated` honesty over already-retained input, the serialized-meta byte cap (trailing groups dropped, one oversized group kept), and the defensive narrowing that accepts a zero-result card but rejects a malformed one. |
| `packages/fs/tool-fs-search/tests/rg-path.spec.ts` | Failure path for the lazily-resolved packaged ripgrep: a missing platform package surfaces as a per-call `SEARCH_FAILED` and stays memoized, rather than failing the composition load. |
| `packages/fs/tool-fs-search/tests/rg-sidecar.spec.ts` | Binary resolution: the pkg `-rg` sidecar (POSIX and Windows naming), the ordinary Node dependency path, the packaged-without-sidecar fallback, and the Electron ASAR → `.asar.unpacked` rewrite. |
| `packages/fs/tool-fs-search/tests/tools.spec.ts` | The big consumer suite over a fake subprocess and a fake spill: registration, config validation, fixed argv construction (hostile patterns inert), workdir derivation and signal forwarding, the three distinct launch-failure classifications, exit semantics (`1` = empty success), the raw-output overflow arms, the cross-directory sampling algorithm (including 125,000 groups), glob/grep result shaping, the spill handoff, the `rg --json` transport failures, the no-background-job invariant, and the search-card presentation. |
| `packages/fs/tool-str-replace-editor/README.md` | The standalone editor reference: the four commands, the `null`-placeholder rules, the absolute-path requirement, the read-before-edit inheritance, and the limits (UTF-8 text only, no `replace_all`, unconditional without the policy plugin). |
| `packages/fs/tool-str-replace-editor/README.zh.md` | Chinese mirror of the editor reference. |
| `packages/fs/tool-str-replace-editor/package.json` | `@deepseek-ai/dsh-tool-str-replace-editor` — view / create / str_replace / insert over `ctx.fs`; peer-depends on fs, output-retention, sandbox, sandbox-policy, tools. |
| `packages/fs/tool-str-replace-editor/tsconfig.json` | Project references: cordis, schemastery, output-retention, tools, fs, sandbox, sandbox-policy. |
| `packages/fs/tool-str-replace-editor/tests/tools.spec.ts` | The editor over a real session: the four commands, literal replacement, the 2-level directory listing and view clipping at a surrogate-pair boundary, the `old_str`-only failure vocabulary, the observation-policy delegation, the sandbox policy on every mutation, tab preservation, and the config validation. |
| `packages/sandbox/README.md` | The sandbox group map: the four packages, the three modes, and the one-shot user-approved escalation. |
| `packages/sandbox/README.zh.md` | Chinese mirror of the sandbox group map. |
| `packages/sandbox/sandbox/README.md` | The confinement seam contract: the three modes, `full` vs `partial` enforcement, the denial marker and escalation hint, the fail-closed `SANDBOX_UNAVAILABLE` error text, and the limits (file effects only, same-world only, stderr-dialect denial reporting, in-band runner diagnostics, one provider per context). |
| `packages/sandbox/sandbox/README.zh.md` | Chinese mirror of the sandbox seam contract. |
| `packages/sandbox/sandbox/package.json` | `@deepseek-ai/dsh-sandbox` — the abstract process-sandbox seam for the harness. |
| `packages/sandbox/sandbox/tsconfig.json` | Project references: cosmokit, cordis, llm, session. |
| `packages/sandbox/sandbox/tests/diagnostics.spec.ts` | Pins the runner-diagnostics rules: `ENOENT`/`EACCES` attribution only after the cwd ambiguity is eliminated, the rejection of non-spawn/unrelated-program/unstructured failures, empty fatal signatures ignored, Landlock's exit-125 gate plus a non-notice fatal line, and the shared status/matching rules. |
| `packages/sandbox/sandbox/tests/escalation.spec.ts` | Pins the escalation vocabulary and choreography: the strictly-wider ladder, the closed target enum, the argument-pairing validation, the verbatim markers, and every `approveEscalation` outcome arm including the exhaustiveness guard. |
| `packages/sandbox/sandbox/tests/roots.spec.ts` | Pins the writable-root derivation so the fs fence and the Seatbelt profile cannot drift: symlink resolution, the conservative as-is fallback for an unresolvable path, `read-only` granting nothing, and the canonical deduplicated workspace-write set. |
| `packages/sandbox/sandbox/tests/vocabulary.spec.ts` | Pins the fail-closed error's structured `{name, code}` identity and the operator-facing message naming the missing runner and the escape hatch. |
| `packages/sandbox/sandbox-policy/README.md` | The shared policy home: the resolution precedence (approved > session fold > deployment default), the session-log-as-store design, the capability-neutral context text, and the limits (one primary workspace root, file effects only, temp areas deliberately summarized) — plus the counter-test rule for policy-context replacements. |
| `packages/sandbox/sandbox-policy/README.zh.md` | Chinese mirror of the sandbox-policy reference. |
| `packages/sandbox/sandbox-policy/package.json` | `@deepseek-ai/dsh-sandbox-policy` — per-call sandbox policy resolver + current model context. |
| `packages/sandbox/sandbox-policy/tsconfig.json` | Project references: cosmokit, cordis, schemastery, agent, sandbox, session, system-prompt, session-projection. |
| `packages/sandbox/sandbox-policy/tsdown.config.ts` | Build config: a self-contained ESM bundle of `lib/types/index.js` to `lib`, no dts, `clean: false`. |
| `packages/sandbox/sandbox-policy/locale/en.json` | English plugin title: `sandbox-policy`. |
| `packages/sandbox/sandbox-policy/locale/zh.json` | Chinese plugin title + description: "沙箱权限策略 / 根据当前会话的权限模式和工作区，确定每次操作的限制。". |
| `packages/sandbox/sandbox-policy/tests/policy.spec.ts` | Pins the policy service: the `read-only` default, absolute-root enforcement, the agentless fallback, the per-session mode + cwd resolution, the approved-mode override, the closed mode vocabulary, HMR disposal, the exact context text for each mode, byte-stability across `TMPDIR` changes, resumption from the session log, and the `sandbox/mode` event kit. |
| `packages/sandbox/sandbox-local/README.md` | The per-platform backend reference: runner selection (platform first, probes second), the platform profiles, the per-backend denial and runner-failure dialects, the Windows standing-vs-revocable grant split, and the limits (partial enforcement, deprecated `sandbox-exec`, cached verdict, `runnerCommand` as an operator assertion). |
| `packages/sandbox/sandbox-local/README.zh.md` | Chinese mirror of the sandbox-local reference. |
| `packages/sandbox/sandbox-local/package.json` | `@deepseek-ai/dsh-sandbox-local` — bwrap / landlock-run / Seatbelt / Windows-ACL backends; depends on `dsh-sandbox-windows-acl` and `node-addon-system`. |
| `packages/sandbox/sandbox-local/tsconfig.json` | Project references: cosmokit, cordis, schemastery, native system entry, llm, sandbox, sandbox-windows-acl, session. |
| `packages/sandbox/sandbox-local/locale/en.json` | English plugin title: `sandbox-local`. |
| `packages/sandbox/sandbox-local/locale/zh.json` | Chinese plugin title + description: "本地进程沙箱 / 按操作系统提供进程隔离，限制命令的访问范围". |
| `packages/sandbox/sandbox-local/tests/acl-grants.spec.ts` | The Windows grant lifecycle in the provider: no grants for a cancelled request, one standing workspace grant plus one revocable temp capability per session, reuse of both, read-only granting nothing, a fresh provider getting a new temp path and SID after a crash, forks and workspace changes getting distinct temp capabilities, and the fail-closed cleanup arms. |
| `packages/sandbox/sandbox-local/tests/bwrap.e2e.ts` | Real bwrap confinement: the passing probe selects the rung at `full` with the EROFS dialect, read-only denies a write (the file must not exist) and keeps the tree readable, the private PID namespace, and the ephemeral `/tmp` under workspace-write. |
| `packages/sandbox/sandbox-local/tests/landlock.e2e.ts` | Real Landlock confinement through the bundled launcher: read-only denies a write, the tree stays readable, the host `/dev` subtree is denied (the grant is the `/dev/null` *file*), and workspace-write grants the host `/tmp` — the documented profile difference. |
| `packages/sandbox/sandbox-local/tests/local.spec.ts` | The provider's own suite: the three profile dialects, the `runnerCommand` override arms, the platform chains (Linux probes bwrap first, darwin selects its sole candidate unprobed, an unknown platform fails closed), the cached verdict, the default Landlock/Seatbelt/windows-acl probe contracts, and the `probeTimeoutMs` guard against Node's unbounded `spawnSync({timeout: 0})`. |
| `packages/sandbox/sandbox-local/tests/packed-install.e2e.ts` | The publish-path rehearsal: packs the release, derives the workspace closure, installs the launcher, and confines through the *installed* launcher — or fails closed, never unconfined. |
| `packages/sandbox/sandbox-local/tests/packed-workspace-closure.spec.ts` | Pins the closure walk: install edges and required peers are followed, development and optional peers are excluded, and an absent workspace dependency fails loud. |
| `packages/sandbox/sandbox-local/tests/packed-workspace-closure.ts` | The helper: reads the pnpm workspace inventory, parses each manifest, and computes the transitive runtime closure of `workspace:` dependencies. |
| `packages/sandbox/sandbox-local/tests/seatbelt.e2e.ts` | Real Seatbelt confinement: read-only denies a write with the "operation not permitted" dialect, keeps the tree readable, grants no temp area at all, and workspace-write grants `/tmp` plus the user temp dir. |
| `packages/sandbox/sandbox-windows-acl/README.md` | The Windows backend reference: the direct `AclSandbox` API, the WRITE_RESTRICTED mechanism, the mode token lists and why each SID is present or absent, the runner argv contract, and a long "Verified boundaries" list (ambient-delete deny inheritance, reads/network unconfined, hard-link aliasing, console isolation unavailable, the standing Low label outliving DSH, `WRITE_OWNER` requirement, piped grandchild EPERM, eager tree propagation, AppContainer-ACL unreadability, PowerShell language-mode differences). |
| `packages/sandbox/sandbox-windows-acl/README.zh.md` | Chinese mirror of the Windows backend reference. |
| `packages/sandbox/sandbox-windows-acl/package.json` | `@deepseek-ai/dsh-sandbox-windows-acl` — restricted-token spawn with a capability-SID write allowlist; exports `./runner`; depends on `koffi` and `yaml`. |
| `packages/sandbox/sandbox-windows-acl/tsconfig.json` | Project references: cosmokit, cordis, schemastery, win32-process, subprocess, lazy-require, skill. |
| `packages/sandbox/sandbox-windows-acl/tsdown.config.ts` | Build config: the confinement runner is its own entry (`lib/types/runner.js`), path-loaded by sandbox-local's win32 chain, with koffi kept an external native require. |
| `packages/sandbox/sandbox-windows-acl/tests/acl-failure-paths.spec.ts` | Every checked Win32 call in the lock / read-merge-write / label / grant-skip sequence has a failing counterpart, each closing what it created; plus the exact-ACE/exact-label skip and the DACL/SACL-walk defenses (malformed size, overrunning ACE, wrong trustee, wrong integrity level). |
| `packages/sandbox/sandbox-windows-acl/tests/acl-skill.spec.ts` | The bundled skill registers its candidate and its extracted resource directory, and disposal removes the candidate. |
| `packages/sandbox/sandbox-windows-acl/tests/acl.spec.ts` | Real-FFI ACL edits: the ambient-delete deny inherits to subdirectories only, revoking one of two grants keeps the shared Low label, grant+revoke preserves a pre-existing explicit ACE, the exact-ACE skip avoids the eager full-tree re-propagation, interleaved instances leave BOTH standing workspace ACEs, the per-path lock is exclusive, and the grant mask carries DELETE + `FILE_DELETE_CHILD` but never `WRITE_DAC`/`WRITE_OWNER`. |
| `packages/sandbox/sandbox-windows-acl/tests/control.spec.ts` | The managed control pipe: the confined child runs with no visible console in both modes, and binary bytes survive the Job and the restricted-token runner while writes stay denied. |
| `packages/sandbox/sandbox-windows-acl/tests/diagnose-script.spec.ts` | The diagnosis script as a runnable artifact: package-ACE removal with a paired recovery record, the healthy-directory verdict, the missing-`WRITE_DAC` grant, the same-invocation repair of both, ancestor-first removal, whole-subtree repair, the inherit-only ACE case, the shared-SID deny preserved, the `-AllowRoot` refusals, the managed-application-tree refusal, the reverse-order rollback, the `restore_pending_then_stop` path, the removed switches, and idempotence. |
| `packages/sandbox/sandbox-windows-acl/tests/ffi.spec.ts` | Stubbed FFI tests: temp-path decoding, the invalid-handle check, pointer-at-offset decoding, and the bounded SID comparison's early exits. |
| `packages/sandbox/sandbox-windows-acl/tests/grant-failure-paths.spec.ts` | `AclWriteGrant` failure paths: fail-closed SID parse, the null SID rejection, and the `AggregateError` aggregation of revocation and SID-free failures. |
| `packages/sandbox/sandbox-windows-acl/tests/grant.spec.ts` | Real-FFI `AclWriteGrant`: fail-closed SID parse, the ACE add/dispose round-trip observed through `icacls`, the recorded path order, and the standing/revocable lifecycle split. |
| `packages/sandbox/sandbox-windows-acl/tests/index-failure-paths.spec.ts` | `AclSandbox` orchestration failures: the constructor's mode/SID matrix, the fail-closed init cleanup with aggregated failures, the spawn arms (control pipe requires inherited stdio; refuse before init), and the dispose aggregation. |
| `packages/sandbox/sandbox-windows-acl/tests/path-boundary.spec.ts` | The workspace/temp boundary: a temp root equal to or below the workspace is rejected, a temp parent above it is accepted, and the private temp directory must be disjoint in either direction. |
| `packages/sandbox/sandbox-windows-acl/tests/probe.spec.ts` | The end-to-end write restriction: the child writes only in the granted targets, is denied elsewhere, may still read outside (the documented boundary), fails closed when the write SID cannot be parsed, and clears provisional temp state after a failed init. |
| `packages/sandbox/sandbox-windows-acl/tests/provider-chain.spec.ts` | The win32 chain's argv contract, denial dialect, and runner-failure rules through the REAL `LocalSandboxProvider.confine()` — platform-independent so it runs in every CI lane. |
| `packages/sandbox/sandbox-windows-acl/tests/runner.spec.ts` | The REAL runner end-to-end: granted-directory-only writes, read-only denying writes while reads and `$null` redirection work, `Remove-Item`/`Rename-Item` succeeding in the granted workspace, paired-SID trust, temp isolation between sibling sessions, the agentless per-call temp child, the mode-downgrade leak regression, the ambient-writable escape, the delete-escape and cross-root-delete regressions, NUL writes staying ambient, the FullControl-open behaviour, the Low-label closing the Everyone-Modify boundary, the hard-link partial boundary, and the runner-failure signature + exit 127. |
| `packages/sandbox/sandbox-windows-acl/tests/skill-composition.spec.ts` | Loads and unloads the ACL skill through the REAL sandbox-local composition (Windows-only lane). |
| `packages/sandbox/sandbox-windows-acl/tests/token-failure-paths.spec.ts` | Every checked Win32 call in the token pipeline has a failing counterpart: token open, logon-SID scan, well-known SID creation, default-DACL merge, restricted-token creation, the integrity level, and the restricting-list construction. |
| `packages/sandbox/sandbox-windows-acl/tests/workspace-sid.spec.ts` | The SID derivations: stable per canonical path, distinct across workspaces, byte-sensitive to the spelling, and domain-separated for the temp SID. |
| `packages/sandbox/sandbox-windows-acl/tests/fixtures/skill-composition/cordis.yml` | The minimal composition fixture: `dsh-sandbox-local` + `dsh-skill`. |
| `packages/storage/README.md` | The storage group map: the four packages, the ctx keys, and the note that they are optional and host-side (no tools, no prompt content, no session events). |
| `packages/storage/README.zh.md` | Chinese mirror of the storage group map. |
| `packages/storage/storage/README.md` | The hub reference: backends own media, data forms own semantics; multiple backends side by side; registration and mounting are effects; activation cannot race registration; the backend contract's clause list. |
| `packages/storage/storage/README.zh.md` | Chinese mirror of the hub reference. |
| `packages/storage/storage/package.json` | `@deepseek-ai/dsh-storage` — the storage hub (named backend registry + mounted data forms). |
| `packages/storage/storage/tsconfig.json` | Project references: cosmokit, cordis. |
| `packages/storage/storage/locale/en.json` | English plugin title: `storage`. |
| `packages/storage/storage/locale/zh.json` | Chinese plugin title + description: "数据存储服务 / 统一管理插件使用的存储后端和数据访问方式。". |
| `packages/storage/storage/tests/contract.ts` | The shared KV-backend conformance suite: a missing unit opens empty, records and the global round-trip durably across a reopen, overwrite and idempotent delete, a version mismatch rejects *without touching the data*, and post-close operations reject with `close` being idempotent. |
| `packages/storage/storage/tests/registry.spec.ts` | The registry and the service: register/resolve/dispose, duplicate rejection, the derived lifecycle service keys, form mounting, the `form-not-mounted` and `duplicate-mount` errors, and the stale-disposer guard after dispose + re-register. |
| `packages/storage/storage-domain/README.md` | The domain form reference: declaring a domain, opening and using it, routing domains to backends, the open sequence, and the limits (single-process change visibility, no cross-table transactions, no data migration). |
| `packages/storage/storage-domain/README.zh.md` | Chinese mirror of the domain form reference. |
| `packages/storage/storage-domain/package.json` | `@deepseek-ai/dsh-storage-domain` — schema-validated, change-emitting KV domains over storage backends. |
| `packages/storage/storage-domain/tsconfig.json` | Project references: cosmokit, cordis, schemastery, storage. |
| `packages/storage/storage-domain/locale/en.json` | English plugin title: `storage-domain`. |
| `packages/storage/storage-domain/locale/zh.json` | Chinese plugin title + description: "结构化数据存储 / 按数据结构校验和保存键值数据，并通知其他插件发生了变更。". |
| `packages/storage/storage-domain/tests/domain.spec.ts` | The domain layer: `defineDomain`'s loud validation (name, version, nullable global, `compatibleVersions`, `invalidRecords`, `layout`), the open sequence and every failure code, per-domain routing, the `backup-and-skip` policy, snapshot reads, concurrent `update` serialization, the `domain/changed` emission order, the durability-failure arms (memory untouched, nothing emitted), the global singleton's `initial`, and close/unmount lifecycle. |
| `packages/storage/storage-domain/tests/helpers/memory-backend.ts` | An in-memory `StorageBackend` double with a shared media pool (so a second instance reopens the same medium), a version stamp a test can pre-set, and an injectable write-failure counter. |
| `packages/storage/storage-json/README.md` | The JSON backend reference: the two layouts, the `root` config, the observable behaviour (deferred materialization, `malformed-medium` vs `version-mismatch`, the per-record "a bad document reads as absent" rule, the legacy bootstrap conditions), and the limits (whole-unit rewrite, no cross-process locking, Windows rename without write-through). |
| `packages/storage/storage-json/README.zh.md` | Chinese mirror of the JSON backend reference. |
| `packages/storage/storage-json/package.json` | `@deepseek-ai/dsh-storage-json` — JSON file KV storage backend. |
| `packages/storage/storage-json/tsconfig.json` | Project references: cosmokit, cordis, schemastery, storage. |
| `packages/storage/storage-json/locale/en.json` | English plugin title: `storage-json`. |
| `packages/storage/storage-json/locale/zh.json` | Chinese plugin title + description: "JSON 文件存储 / 将键值数据保存为本地 JSON 文件。". |
| `packages/storage/storage-json/tests/json-backend.spec.ts` | The JSON backend: the pretty-printed file, deferred materialization, `malformed-medium` vs a foreign unit header vs a foreign version, the double-open caller error, the publish rollback, the undeclared-table and global errors, the `tables`-is-an-array rejection, `close` draining in-flight writes, and the whole `per-record` suite (one document per record, foreign documents discarded, the legacy bootstrap conditions, `backupRecord` moving the document aside, compat-version reads). |
| `packages/storage/storage-sqlite/README.md` | The SQLite backend reference: document-per-row, single-statement atomicity, names validated before DDL, versions failing loud, the open sequence, and the limits (synchronous driver blocks the event loop, no busy-wait, only the current layout version opens, the open sequence duplicated with the query provider). |
| `packages/storage/storage-sqlite/README.zh.md` | Chinese mirror of the SQLite backend reference. |
| `packages/storage/storage-sqlite/package.json` | `@deepseek-ai/dsh-storage-sqlite` — SQLite storage backend (kv facet). |
| `packages/storage/storage-sqlite/tsconfig.json` | Project references: cosmokit, cordis, schemastery, storage. |
| `packages/storage/storage-sqlite/tests/sqlite-backend.spec.ts` | The SQLite backend: `:memory:`, the STRICT tables and the schema stamp, a mismatched `user_version`, name validation before touching the medium, the double-open guard, the prototype-polluting key round-trip, the unstamped-after-failed-materialization repair, `malformed-medium` for bad stored JSON and a bad global, the non-`Error` `toJSON` throw, the undeclared-table and no-global errors, draining a pending failed open during close, filesystem error propagation, the invalid-filename rejection, the preserved file mode, and the hub registration/dispose. |

> Every file in the shard appears exactly once across the Tier 1, Tier 2, and Tier 3 sections. The authoritative list of all 231 rows, with a per-file status, is the status TSV.

### Tier 3 — skipped with a reason

The 18 `README.i18n.yaml` files are **generated bilingual-pair consistency records**: per heading section, a hash of the English and Chinese blocks outside code blocks and generated regions, regenerated by `pnpm run verify-translation-pairing --write <readme>`. They are machine-generated metadata, not prose. Each was confirmed on disk (name, size, header, and a peek at the first hash rows) and none was read line by line; the decision content of every corresponding README is captured in the Tier-2 rows above.

| File | Why skipped |
| --- | --- |
| `packages/fs/README.i18n.yaml` | Generated EN/ZH heading-hash record; content reflected by the two README rows above. |
| `packages/fs/fs/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/fs/fs-local/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/fs/fs-observation-policy/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/fs/fs-sandbox/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/fs/tool-fs/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/fs/tool-fs-search/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/fs/tool-str-replace-editor/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/sandbox/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/sandbox/sandbox/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/sandbox/sandbox-local/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/sandbox/sandbox-policy/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/sandbox/sandbox-windows-acl/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/storage/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/storage/storage/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/storage/storage-domain/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/storage/storage-json/README.i18n.yaml` | Generated EN/ZH heading-hash record. |
| `packages/storage/storage-sqlite/README.i18n.yaml` | Generated EN/ZH heading-hash record. |

---

## 2. Ideas worth stealing

> **Note on CONVERGENT.** This shard is one repository. `CONVERGENT` marks an idea that is also present in at least one of the other two reference repos (or is an established industry pattern with the same shape); `UNIQUE` marks something only deepseek-harness does here. Cross-shard confirmation is still owed by the pi / hermes-agent workers.

1. **Make the policy a plugin that observes events, not a method on the provider.** The read-before-edit rule is a `fs/observed` recorder plus two single-slot waterfall listeners; removing the plugin leaves the bare provider's unconditional behavior instead of breaking the tools (`packages/fs/fs-observation-policy/src/index.ts:106`). *Why it transfers:* August Trading's trade-plan validation, risk gates, and veto ledger are all policies over one pipeline — this is the shape that lets you mount or unmount a rule without forking the executor. **UNIQUE** (the specific event-gate form).
2. **Give every mutation a freshness guard, and check the guard *before* matching content.** The version guard is checked before the literal match, so a stale edit reports `FS_STALE_VERSION` and never a misleading "old_string not found" (`packages/fs/fs-local/src/index.ts:257-270`). *Why it transfers:* a plan re-validation must report "the plan is stale" rather than "your entry no longer matches" — the distinction decides what the model does next. **CONVERGENT** (optimistic-concurrency guards are standard; the ordering is the load-bearing part).
3. **Three observation states, not two: unseen / confirmed-absent / present-at-version.** `FsObservation` (`packages/fs/fs/src/types.ts:52`) plus the policy's `writeIntent`/`editIntent` (`packages/fs/fs-observation-policy/src/index.ts:65`, `:78`) distinguish "never looked" from "looked and it is gone" from "looked and it is this version". *Why it transfers:* August Trading needs exactly this to know whether a symbol has been analysed, analysed-with-no-trade, or analysed-at-this-price. **CONVERGENT**.
4. **Owner-scoped state, keyed weakly.** The observation record is a `WeakMap<session, Map<targetKey, observation>>` (`packages/fs/fs-observation-policy/src/index.ts:28`) and a session that is collected frees its state. *Why it transfers:* with multiple agents, one agent's read must not authorise another agent's write — and a dead session's authorisations should die with it. **UNIQUE**.
5. **Re-resolve the target at the moment of the write and mutate *that*.** The sandbox fence returns the target it checked (`packages/fs/fs-sandbox/src/index.ts:122-160`), closing the check-here-write-there TOCTOU. *Why it transfers:* any guard that validates a path, a price, or a balance must re-validate against the value it is about to act on, not the one it planned against. **CONVERGENT**.
6. **A strictly-wider escalation ladder with a one-shot, human-approved retry.** `WIDER_MODES` is a closed table; the check is at execution, never in the schema; the enum is the *full* target vocabulary so a narrowed default cannot strand a session (`packages/sandbox/sandbox/src/escalation.ts:28`, `:41`). *Why it transfers:* a trading agent that wants to place a real order, or write outside the sandbox, should escalate exactly one level with a justification the human reads — and the "narrowest wider mode that suffices" phrasing is the right instruction to the model. **UNIQUE** in its exact shape.
7. **The denial message carries its own recovery instruction.** `remediateFsError` normalizes every `FS_NOT_OBSERVED` source to one imperative sentence (`packages/fs/tool-fs/src/error.ts:21`), and the sandbox denial marker is followed by the same-turn escalation hint (`packages/sandbox/sandbox/src/escalation.ts:84`). *Why it transfers:* August Trading's error text should tell the model what to *do*, not what went wrong — the two are separated on purpose. **CONVERGENT**.
8. **Fail closed, and say which boundary you could not enforce.** `SandboxEnforcement = 'full' | 'partial'` is a reported fact, not a promise (`packages/sandbox/sandbox/src/index.ts:60`); the Windows rung reports `partial` and the README lists the three reasons. *Why it transfers:* if August Trading's risk engine cannot evaluate a market state, it should refuse and report *which* guard was missing, rather than silently trading. **CONVERGENT**.
9. **Bound the persisted presentation metadata separately from the visible content.** The search tools cap the inline page *and* independently cap the serialized `meta` to 64 KiB, dropping trailing groups and marking the result truncated (`packages/fs/tool-fs-search/src/presentation.ts:107`). *Why it transfers:* a trade-log or chart card persisted into the session log and re-sent every turn is exactly this shape — the *count* of results and the *truncation flag* must survive even when the payload does not. **UNIQUE**.
10. **When a result set is too big, sample across the top-level groups instead of taking the head.** `sampleAcrossTopLevel` round-robins across the result's top-level entries (`packages/fs/tool-fs-search/src/glob.ts:170`), because "a head-of-3 reads like the entire workspace". *Why it transfers:* the same failure exists in a trading agent — the first three matches of a symbol scan are often all one sector and read as the whole portfolio. **UNIQUE**.
11. **One owner for "what may be written", shared by every enforcement dialect.** `writableRoots` is the single derivation used by the Seatbelt profile and the in-process fs fence (`packages/sandbox/sandbox/src/roots.ts:52`, `packages/sandbox/sandbox-local/src/profiles.ts:51`). *Why it transfers:* August Trading has several write surfaces (settings, journal, provider keys, export); if each derives its own boundary they will drift. **CONVERGENT**.
12. **Durable → memory → event, in that order, every time.** The domain layer awaits backend durability *before* mutating memory and *then* emits the change event (`packages/storage/storage-domain/src/domain.ts:263`, `:251`). *Why it transfers:* a trade record must be on disk before the UI shows it and before the model is told it happened. **CONVERGENT**.
13. **A cap is a *contract*, not a truncation.** `readBytes` fails `FS_TOO_LARGE` rather than returning a truncated result, and the whole-file read bound lives on the seam so no backend can buffer without limit (`packages/fs/fs/src/index.ts:222`, `:228`). *Why it transfers:* August Trading's market-data fetch and export paths should fail loudly on an oversized payload instead of returning a silent prefix. **CONVERGENT**.
14. **The write path is a state machine with three outcomes, and the "before" is best-effort.** `FsWriteOutcome.before` is `null` for a create *and* for an undiffable prior file, and the write still succeeds (`packages/fs/fs-local/src/index.ts:202`). *Why it transfers:* a journal write must not fail because the *display* diff could not be computed — separate the required record from the optional presentation. **CONVERGENT**.
15. **The policy is *invisible* to the model except as a capability-neutral sentence.** The `sandbox:policy` context states the mode's file-effect contract without inventorying mounted capabilities (`packages/sandbox/sandbox-policy/src/index.ts:42`), and the guidance is byte-stable across mode changes. *Why it transfers:* August Trading's system prompt should not enumerate which tools are mounted — that would change the prompt prefix on every config change and defeat provider caching. **CONVERGENT**.
16. **Counter-test the policy-context replacement.** The sandbox-policy README records a historical measurement (5 of 12 turns with zero tool calls) and requires that any policy-context change be counter-tested on denied-then-escalatable tasks to confirm the model still attempts the initial call (`packages/sandbox/sandbox-policy/README.md`, "Known Limitations"). *Why it transfers:* August Trading's risk-guard prompts are the same hazard — a guard that makes the model refuse up front is worse than no guard. **UNIQUE** (the *measurement* is the idea).

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work — not in this shard.** There is no cron, scheduler, or job runner in these 231 files. The closest primitives are (a) `FileSystem.watch(target, changed, signal)` — a one-file/one-directory OS-event watcher with an async close contract, backed by chokidar, with the file case watching the *parent* directory so creation of a initially-missing file is observed (`packages/fs/fs-local/src/index.ts:69`), and (b) the in-process `domain/changed` event, which is a change feed but explicitly *not* cross-process (`packages/storage/storage-domain/src/events.ts:46`). Neither is a durable schedule, and the domain README names cross-process change push as deferred work.
- **Human-in-the-loop approval — present, and directly transferable.** `approveEscalation` is an ordered, fail-closed sequence: repeating the effective mode needs no approval; a strictly wider mode requires an approval request carrying a self-contained audit reason (`escalate sandbox to <mode>: <justification>`) plus bilingual presentation copy; every non-grant outcome maps to a distinct verbatim text, and the *rejection* text explicitly says "it stays denied, so stop and explain instead of working around it" (`packages/sandbox/sandbox/src/escalation.ts:171`). The tool layer passes its own `ctx.approval` closure down, so the seam never depends on the approval package. For August Trading this is the pattern for "this action needs a human": a closed ladder, an approval record whose reason is the *whole* audit trail, and a rejection that closes the door rather than inviting a workaround.
- **Post-mortem / reflection loops — not in this shard.** These packages contain no reflection, lesson, or rule-accumulation machinery. The nearest analogue is the observation record's *self-refresh*: a successful write or edit updates the recorded version so the next mutation needs no re-read (`packages/fs/fs-observation-policy/src/index.ts:65`; pinned by "a write/edit observation refreshes the basis, so the next edit needs no re-read"). That is a *mechanical* refresh, not a lesson learned — it carries no judgement and no expiry. Any "which rules have accumulated" analysis belongs to another shard.
- **Multi-agent — the isolation boundary is per-session, and the read is not shared.** The observation state is keyed by the agent's session object, so owner A's read never authorises owner B's edit, and each owner records its own version independently (`packages/fs/fs-observation-policy/src/index.ts:28`; pinned by "owner A observing does not grant owner B edit authority"). The *sandbox* is the opposite: one policy home resolves each session's mode and workspace root so two sessions never see each other's state (`packages/sandbox/sandbox-policy/src/session-mode.ts:53`), while the Windows backend's per-session temp SID exists precisely so sibling sessions sharing a workspace cannot enter one another's temp trees (`packages/sandbox/sandbox-windows-acl/src/workspace-sid.ts:49`). There is **no debate mechanism** anywhere in this shard — this is the "subagent vs debate" question's counterpart: the repo separates *state isolation* (per-session) from *policy uniformity* (one shared resolver), and neither requires the agents to talk.
- **Structured logs the model can query — three different mechanisms, all worth stealing.** (1) **JSONL, one record per line, plus a `RECAP` tail** — the Windows diagnosis script writes every observation, action, verification and refusal as a JSON object per line to `acl-report-*.jsonl`, *because* tool output keeps only its tail; the recap is printed last so the truncated output still carries the decisions (`diagnose-windows-sandbox-acl.ps1`, `Write-Report` / the `RECAP` line). (2) **NDJSON from a subprocess** — `grep` consumes `rg --json` and parses only `match` records, so path, line number and text are unambiguous without colon-splitting (`packages/fs/tool-fs-search/src/grep.ts:169`). (3) **A human-readable pretty-printed JSON file as the medium** — the JSON storage backend's reason for existing is legibility; the file *is* the current net state and can be inspected with `cat` (`packages/storage/storage-json/src/format.ts:28`). August Trading already has SQLite for the trade log; the missing piece is the *queryable* projection — the search tools show how to make a structured log a first-class artifact without a database.
- **Staying simple as features accumulate — the "seam split" and the "one owner" rule.** The filesystem stack is split into contract / provider / policy / tools precisely so a backend can be swapped without touching the tools and a policy can be removed without breaking them (`packages/fs/README.md`, "the policy is a plugin, not a service the tools inject"). The sandbox family has *one* policy home and *one* writable-root derivation, so the fs fence and the bash runner cannot drift (`packages/sandbox/sandbox/src/roots.ts:52`). The storage family has *one* backend contract with a shared conformance suite run against every backend (`packages/storage/storage/tests/contract.ts`). The rule that keeps the feature count from becoming the product: **each new capability must fit an existing seam, and each rule must have exactly one owner.**

---

## 4. Non-obvious decisions and gotchas

1. **The stale guard is checked before the literal match, and a *missing* target on an edit also reports `FS_STALE_VERSION`** — even on the unguarded path (`packages/fs/fs-local/src/index.ts:257-270`). A reader expecting `FS_NOT_FOUND` will misread every one of these.
2. **`FsWriteOutcome.before` is `null` for far more than "the file did not exist"** — binary prior, non-UTF-8 prior, or a prior at/above the diff bound all yield `null` while the write succeeds (`packages/fs/fs-local/src/index.ts:230`).
3. **The intent waterfall's default is `undefined`, which means "unconditional".** The tools pass `() => undefined` (`packages/fs/tool-fs/src/write.ts:121`); the *plugin* is what makes it guarded. A missing plugin therefore fails **open**, by design.
4. **The `fs/observed` event is emitted *after* the mutation committed, so a throwing listener turns a durable write into an `isError` result** — the bytes are on disk and the model is told it failed (`packages/fs/tool-fs/tests/integration.spec.ts`, "a throwing fs/observed listener surfaces as isError, but the mutation already hit disk"). A real inconsistency in the harness.
5. **A failed read is what makes a later recreate safe.** The absence observation is emitted *before* the `FS_NOT_FOUND` throw (`packages/fs/tool-fs/src/read-target.ts:23-30`).
6. **The binary detector is asymmetric on purpose:** reads NUL-sample only the first 8192 bytes; edits scan the whole buffer (`packages/fs/fs-local/src/fsio.ts:17`). A file with a late NUL reads fine and rejects edits.
7. **Two different publish primitives for two different guarantees:** `createIfAbsent` uses `link()` (no-replace, so a concurrent creator's file survives); replacement uses `rename()`/`ReplaceFileW` (which *does* replace) (`packages/fs/fs-local/src/fsio.ts:588-700`).
8. **`readTextForDiff` reads from the open descriptor, not from a prior path stat** — a file that grew after the caller's preflight cannot make it buffer more than `maxBytes` (`packages/fs/fs-local/src/fsio.ts:750`).
9. **The binary-detection asymmetry is one of a documented list of nine "Known Limitations"** — the repo treats its own sharp edges as a first-class deliverable, and each limitation is stated as a constraint, not a bug.
10. **In the Windows ACL backend, the *ambient* delete right is denied to the world SID and the deny inherits to containers only** — `FILE_DELETE_CHILD` is evaluated on directories, and inheriting its bit onto files would refuse every `GENERIC_ALL`/`FullControl` open inside the root (`packages/sandbox/sandbox-windows-acl/src/acl.ts:377`).
11. **A standing workspace grant stays *inert* under a read-only downgrade** because the write-restricted pass-2 check grants only what the restricting list carries — and the unrevoked ACE makes the later re-upgrade free of re-propagation (`packages/sandbox/sandbox-windows-acl/src/token.ts:216`).
12. **The Low mandatory label outlives the session and widens the tree for other Low-integrity processes** — the README states this is the price of the write boundary (`packages/sandbox/sandbox-windows-acl/README.md`, "Verified boundaries"). A standing security-descriptor edit is a real residue.
13. **The `Everyone` SID stays in the restricting list in *both* modes** and does not confer write authority any more (the Low label does that work). Its absence would break early DLL init (`0xC0000142`) and CNG (`0xE0434352`).
14. **`Authenticated Users` is absent from both lists** — the cost is that CIM cmdlets and `Get-ComputerInfo` are unavailable in every confined mode (`packages/sandbox/sandbox-windows-acl/README.md`).
15. **The Windows runner rewrites TMP/TEMP in its *own* environment** because an explicit environment block through koffi trips `ERROR_INVALID_PARAMETER` in `CreateProcessAsUserW` — verified empirically (`packages/sandbox/sandbox-windows-acl/src/runner.ts`).
16. **The `denialSignatures` set is per backend, not a union** — a cross-backend union would claim denials a given backend never produces (`packages/sandbox/sandbox/src/index.ts:109`; the sibling `fatalSignatures` at `:86` and `informationalLines` at `:88` are the same per-backend discipline).
17. **`ESCALATION_TARGETS` is the full closed set, not "wider than the default"** — otherwise a narrowed default would advertise nothing while a narrower-switched session stays confined with no lever (`packages/sandbox/sandbox/src/escalation.ts:41`).
18. **`--no-config` is prepended to every ripgrep spawn** because the spawn is unconfined and a host `RIPGREP_CONFIG_PATH` could otherwise inject a `--pre` preprocessor (`packages/fs/tool-fs-search/src/search-core.ts:222`).
19. **The `include` glob must be ONE positive pattern** — negated patterns and comma-lists are rejected, but a comma inside a brace group is fine (`*.{ts,tsx}`) (`packages/fs/tool-fs-search/src/grep.ts:56`).
20. **A whitespace-only `grep` pattern is legal; a whitespace-only `glob` pattern is not** (`packages/fs/tool-fs-search/src/grep.ts:104`, `glob.ts:83`).
21. **The search tools deliberately do *not* extend the `ctx.fs` provider contract** — putting search on the seam would force every backend to grow a search API. A remote or virtual-filesystem deployment therefore has no search at all (`packages/fs/tool-fs-search/src/index.ts:20-26`).
22. **The `single` JSON layout rewrites the whole unit on every write** and there is **no cross-process write lock** — two processes writing one unit interleave (`packages/storage/storage-json/README.md`, "Known Limitations").
23. **The domain layer refuses a global schema that accepts `null`**, because `null` is the medium's "never written" sentinel and a nullable global could not round-trip (`packages/storage/storage-domain/src/spec.ts:107`).
24. **The per-record JSON layout treats a malformed or wrongly-stamped document as an *absent record*, while the whole-unit layout rejects** — one bad file must not brick a unit, but there is exactly one whole-unit document so there is nothing to salvage (`packages/storage/storage-json/src/format.ts:117`).
25. **The legacy per-record bootstrap only runs when the new tree has *no* document path at all** — even an unreadable or stale document suppresses it for the whole unit (`packages/storage/storage-json/src/per-record-unit.ts:123`).
26. **`delete` decides existence at its chain slot, not at call time** — an earlier queued `put` of the same key makes the delete observe it (`packages/storage/storage-domain/src/domain.ts:315-318`).
27. **A `domain/changed` listener that throws is contained with a warning** — the write is already durable and the event is a notification, not a transaction participant (`packages/storage/storage-domain/src/domain.ts:251`).
28. **The SQLite backend's `loadAll` uses a null-prototype object** so a record key named `__proto__` lands as an own property rather than mutating the prototype (`packages/storage/storage-sqlite/src/unit.ts:65`).
29. **A fresh SQLite database is stamped with its layout version LAST**, so a failure above leaves the medium unstamped and a re-open retries materialization from scratch (`packages/storage/storage-sqlite/src/schema.ts:60`).
30. **Every package's README carries a "Known Limitations and Deferred Work" section** listing sharp edges as *current constraints* rather than bugs — a documentation convention worth copying verbatim.
31. **Two package-level hazards are guarded by dedicated tests**: a stray `export default apply` in a namespace plugin would make the Cordis loader drop `inject` (`packages/fs/tool-fs-search/tests/load-path.spec.ts`), and a `default export` mixed with a function-plugin `apply` does the same in the storage hub (`packages/storage/storage/src/index.ts:160`).
32. **`probeTimeoutMs: 0` is rejected** because Node treats `spawnSync({timeout: 0})` as *unbounded* — the opposite of what the field promises (`packages/sandbox/sandbox-local/src/index.ts:249`).

---

## 5. Weak spots

1. **The observation state is memory-only and does not survive a session resume.** A resumed session starts with no observations and must re-read every target before a guarded mutation succeeds (`packages/fs/fs-observation-policy/README.md`, "Known Limitations"; the plugin's disposal explicitly clears the map for HMR safety at `packages/fs/fs-observation-policy/src/index.ts:57` and `:113`). For a long-running trading session that is both an ergonomic tax and a correctness cliff: the guard's strength is exactly the strength of a memory that a crash erases.
2. **A throwing `fs/observed` listener turns a durable write into an `isError` result.** The bytes are on disk, the model is told the write failed, and the natural recovery is to retry — which then hits `FS_NOT_OBSERVED` or a stale guard on a file that *was* written. The repo pins this behavior in a test rather than fixing it (`packages/fs/tool-fs/tests/integration.spec.ts`), which suggests it is a known wart, not a decision.
3. **Authorization is freshness, not view-completeness.** A *windowed* read (a few lines of a large file) authorizes a full-file overwrite of the rest (`packages/fs/fs-observation-policy/README.md`, "Authorization is version freshness, not view completeness"; pinned by "lets a WINDOWED read authorize an edit when the file is unchanged"). The policy deliberately does the weaker thing, and the weaker thing is a real hazard for anything that treats "the agent read it" as "the agent saw it".
4. **The Windows ACL backend's partial enforcement is not a rounding error — it is three separate holes** (hard links alias file objects across paths; reads are entirely unconfined; a tree ACL'd by another AppContainer tool is unreadable), and the standing Low label *widens* the workspace for any other Low-integrity process on the machine (`packages/sandbox/sandbox-windows-acl/README.md`, "Verified boundaries"). The repo is honest about it; the residue is real and permanent.
5. **Two whole subsystems in this shard have no migration story.** A stored version differing from the descriptor rejects the open outright — `version-mismatch`, no migration — in both the storage domain and the SQLite backend (`packages/storage/storage-domain/README.md`; `packages/storage/storage-sqlite/src/schema.ts:60`). For a trading journal whose schema will evolve, this is a deferred migration that will have to be paid all at once.
6. **The `single` JSON layout's cost is O(unit) per write and its concurrency story is "last completion wins"**, with the README's own mitigation being "route the domain to SQLite instead" (`packages/storage/storage-json/README.md`, "Dev Note"). A configuration choice standing in for a missing capability.
7. **The `fs/observed` weakness has a second face: the tool layer cannot see that a *different* tool observed the file.** A direct `ctx.fs.readText` records nothing, so a later guarded edit rejects `FS_NOT_OBSERVED` even though the file was demonstrably read — the policy is per-tool, not per-file (`packages/fs/fs-observation-policy/README.md`, "Direct ctx.fs reads emit no fs/observed"). The seam's narrowness is bought with a foot-gun.
