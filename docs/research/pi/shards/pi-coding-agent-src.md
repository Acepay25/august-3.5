# pi :: pi-coding-agent-src

**Files in shard:** 263 (read: 110, skipped with reason: 153)
**What this shard covers:** the entire `packages/coding-agent/src` tree of the `pi` reference harness: the CLI entry points and argument parser, the `core/` layer (agent session, compaction, extensions, model resolution, settings, skills, session persistence, tools), the `extensions/` layer (codemode, llama, MCP, tool-search), the interactive TUI (`modes/interactive`, including the theme system), the RPC/JSON/print modes, and the `utils/` grab-bag. This is the load-bearing application code of a terminal coding agent — the closest analogue to August Trading's "single-seat, tool-driven analysis" surface.

**Coverage note (honest):** 110 files were read line by line (two of them — `core/agent-session.ts` at 164 KB and `src/main.ts` — by the brief's head-and-tail rule for very large files, and the note in the status ledger says so). The remaining 153 were **catalogued by a head read plus an export-signature scan** and are reported as one-line rows in the Tier-2/Tier-3 tables below; they are marked `skipped` in the status ledger with that reason rather than being passed off as line-by-line reads. The set is dominated by TUI presentation components, the `utils/` grab-bag, the vendored export assets and the MCP/llama/codemode extension internals — the behaviour that matters most to August Trading (the agent loop, compaction, tool validation, trust, settings, session persistence) *was* read in full.

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/coding-agent/src/bun/cli.ts`
- **Purpose:** Bun-compiled-binary entry point: restore the sandbox env, set up the runtime, then hand off to the normal CLI.
- **Key abstractions:** none — three side-effect imports in order.
- **Data flow:** `sandbox-env-setup.ts` → `runtime-setup.ts` → `../cli.ts`.
- **Non-obvious design decisions:** The order is load-bearing. Env restoration must happen *before* any module reads `process.env` at import time, and `runtime-setup.ts` reads `process.env` indirectly through the OAuth/bedrock registrations. This is the classic "import order is a contract" problem solved by making the contract a file.
- **Edge cases & failure handling:** `restoreSandboxEnv` no-ops unless `process.versions.bun` and `process.env` is empty.
- **Surprising:** The Bun path is not a re-implementation — it is the *same* `cli.ts`, with three pre-imports. One code path, two runtimes.

#### `packages/coding-agent/src/bun/quickjs-wasm.d.ts`
- **Purpose:** Ambient module declaration so TypeScript accepts `import quickjsWasmPath from "quickjs-wasi/quickjs.wasm"`.
- **Key abstractions:** `declare module "quickjs-wasi/quickjs.wasm" { const path: string; export default path }`.
- **Non-obvious design decisions:** Bun loads `.wasm` imports as *file paths*, not bytes. The `.d.ts` documents that contract in one line rather than lying about the module's shape.
- **Surprising:** The wasm file is embedded in the compiled binary and its runtime path is a readable temp file — this is how sandboxed codemode gets a QuickJS interpreter.

#### `packages/coding-agent/src/bun/restore-sandbox-env.ts`
- **Purpose:** Workaround for Bun issue #27802 — a compiled Bun binary has an *empty* `process.env` inside sandboxes (nono on Linux/macOS).
- **Key abstractions:** `restoreSandboxEnv(): void`.
- **Data flow:** reads `/proc/self/environ`, splits on NUL, splits each entry at the first `=`, writes back into `process.env`.
- **Non-obvious design decisions:** Only fires when `process.env` is *completely empty* (not "missing expected vars") — an all-or-nothing heuristic, because a partially-populated env cannot be told apart from a real one. The comment explicitly says "Keep this in sync with `getBunSandboxEnvValue()` in `packages/ai/src/utils/provider-env.ts`" — a duplicated lookup, documented as such.
- **Edge cases & failure handling:** the whole `/proc` read is wrapped in try/catch and silently ignored; `idx > 0` skips malformed entries and entries whose name is empty.
- **Idea to steal:** the "empty means broken" heuristic for a hostile environment.

#### `packages/coding-agent/src/bun/runtime-setup.ts`
- **Purpose:** Registers the Bun-only runtime pieces before the app starts: OAuth flows, the Bedrock provider module, and the embedded QuickJS wasm path.
- **Key abstractions:** `bedrockProviderModule`, `registerBunOAuthFlows()`, `setBedrockProviderModule()`, `setEmbeddedQuickJSWasmPath()`.
- **Non-obvious design decisions:** `process.emitWarning` is stubbed to a no-op — Node's deprecation warnings would corrupt a TUI. `process.title = APP_NAME` renames the process for `ps`/task-manager.
- **Edge cases & failure handling:** the wasm import is a *path*, not a buffer, precisely so the compiled binary can extract it at runtime.

#### `packages/coding-agent/src/bun/sandbox-env-setup.ts`
- **Purpose:** One-liner that calls `restoreSandboxEnv()` before any other module is evaluated.
- **Non-obvious design decisions:** the file exists only to give the sandbox restore a deterministic position in the import graph.

#### `packages/coding-agent/src/cli.ts`
- **Purpose:** The canonical Node entry point: `setupCli()` then `main(process.argv.slice(2))`.
- **Non-obvious design decisions:** `setupCli()` must run *before* `main` because it installs the undici dispatcher, and provider SDKs capture `fetch` at import time.

#### `packages/coding-agent/src/cli/args.ts`
- **Purpose:** Hand-rolled CLI argument parser and the help text.
- **Key abstractions:** `Args` interface (one field per flag), `parseArgs(args: string[]): Args`, `printHelp(extensionFlags?)`, `isValidThinkingLevel`, `normalizeSessionName`.
- **Data flow:** argv → `Args` with three side channels: `messages[]`, `fileArgs[]` (from `@path`), and `unknownFlags: Map<string, boolean|string>`.
- **Non-obvious design decisions:**
  - Unknown `--flags` are **not** errors. They are collected into `unknownFlags` and later offered to extensions as their own flags (`--plan` from plan-mode). A typo becomes a *deferred* error, not a hard stop.
  - Validation is split by severity: a bad `--tools` list is an **error** diagnostic, a bad `--thinking` level is only a **warning** and the flag is dropped.
  - `--print` swallows the next token as the prompt unless it starts with `-`/`@` — and `--` explicitly ends option parsing, so a prompt starting with a dash is reachable (`pi -p -- "- Summarize"`).
  - The tool allow/deny lists support glob-ish `*` patterns and `+name`/`-name` add/remove semantics relative to the defaults.
  - The help text is a single template literal that doubles as the product's feature list — it names every provider env var, every tool, and the read-only usage pattern.
- **Edge cases & failure handling:** `--mode`, `--use-theme`, `--tui-mode` and `--name` all validate the *next* argument and push a diagnostic if it is missing or looks like another flag. `--list-models` distinguishes "flag with a search term" from "flag alone" by peeking at the next token.
- **Surprising:** `getToolListError(tools)` is imported from `settings-manager.ts` — the *parser* validates tool names against the settings layer rather than duplicating the list.

#### `packages/coding-agent/src/cli/auth-check.ts`
- **Purpose:** `pi auth check` — a machine-readable readiness probe for a provider.
- **Key abstractions:** `AuthCheckStatus = "ready" | "not_ready" | "invalid"`, `AuthCheckReason` (four values), `checkProviderAuth(args, modelRuntime, {refresh})`, `getProviderCredential`, `createAuthCheckModelRuntime`.
- **Data flow:** CLI args → provider/model resolution → `modelRuntime.checkAuth(provider)` → a status triple.
- **Non-obvious design decisions:** The status vocabulary separates **`not_ready`** (no key configured — a user-fixable state) from **`invalid`** (the runtime itself is broken: `models.json` failed to load, or `checkAuth` threw). A broken config is not the same as a missing credential, and conflating them makes a support question unanswerable.
- **Edge cases & failure handling:** every provider error is caught and mapped to `invalid_state`; the function never throws for provider problems. `createAuthCheckModelRuntime` uses `allowModelNetwork: false` and `refreshOnCreate: false` so a *check* never triggers a network model-catalog refresh.
- **Idea to steal:** the three-state readiness vocabulary (`ready` / `not_ready` / `invalid`) for a provider-config surface.

#### `packages/coding-agent/src/cli/auth-command.ts`
- **Purpose:** Parsing and shared helpers for the three `auth` subcommands (`check`, `print-api-key`, `print-bearer-token`).
- **Key abstractions:** `AuthCommand` (`kind`, `args`, `json`, `credentials`, `noRefresh`, `minExpiryMs`), `AuthCommandError`, `parseAuthCommand`, `validateAuthCommandArgs`, `getAuthCredential`.
- **Data flow:** argv → `AuthCommand` → the check/print implementations.
- **Non-obvious design decisions:**
  - Flags are **kind-scoped**: `--json`, `--credentials`, `--no-refresh` are only valid for `check`; `--min-expiry` only for `print-bearer-token`. A wrong flag throws a named error rather than being ignored.
  - `getAuthCredential` accepts either an `apiKey` **or** an `Authorization: Bearer …` header, and extracts the token from the header with a regex — so a provider that only speaks bearer tokens still works.
  - `validateAuthCommandArgs` rejects `unknownFlags`, `--api-key`, messages and file args: the auth surface refuses to accept anything it did not declare.
- **Edge cases & failure handling:** `--min-expiry` accepts `ms|s|m|h` and is parsed with a strict regex; anything else throws.

#### `packages/coding-agent/src/cli/config-selector.ts`
- **Purpose:** Backs the `pi config` command with the TUI `ConfigSelectorComponent`.
- **Key abstractions:** `ConfigSelectorOptions`, `selectConfig(options): Promise<void>`.
- **Non-obvious design decisions:** the selector is a **global vs project** scope toggle (`writeScope: "global" | "project"`, `projectModeAvailable`), so a resource can be enabled for the user or for the project. `initTheme(...)` is called *before* the TUI is constructed so the first frame is already themed.
- **Edge cases & failure handling:** a `resolved` latch guarantees the promise settles exactly once whether the user closes the selector, cancels, or the process exits.

#### `packages/coding-agent/src/cli/credential-print.ts`
- **Purpose:** Resolve and print one configured provider credential for an *external* client.
- **Key abstractions:** `resolveCredentialForPrint(args, modelRuntime, kind, minExpiryMs?, signal?)`.
- **Data flow:** args → provider list → `modelRuntime.getAuth(...)` → a single credential string.
- **Non-obvious design decisions:**
  - It deliberately goes through `ModelRuntime.getAuth()` rather than reading the credential store, so **OAuth tokens under five minutes from expiry are refreshed and persisted through the normal request-auth path**. The comment says so explicitly.
  - `--min-expiry` (default 30 minutes) forces a refresh before a bearer token is handed to another process, so the external client is not handed a token that dies mid-request.
  - `api_key` and `bearer_token` are *disjoint* kinds: an OAuth provider is skipped by `print-api-key` and an API-key provider is skipped by `print-bearer-token`, and the error message distinguishes "configured with OAuth, not an API key" from "not configured with an OAuth bearer token".
  - If several providers match, the command **refuses** and names them rather than picking one.
- **Idea to steal:** never hand a raw token to an external process without a minimum-remaining-lifetime check.

#### `packages/coding-agent/src/cli/file-processor.ts`
- **Purpose:** Turns `@file` CLI arguments into text content and image attachments.
- **Key abstractions:** `ProcessedFiles {text, images}`, `ProcessFileOptions {autoResizeImages}`, `processFileArguments(fileArgs, options?)`.
- **Data flow:** `@path` → `resolveReadPath` → `access`/`stat` → mime sniff → text or image branch → a `<file name="…">…</file>` text block plus `ImageContent[]`.
- **Non-obvious design decisions:**
  - **Empty files are skipped silently** rather than becoming an empty `<file>` tag.
  - The file content is wrapped in an explicit `<file name="ABSOLUTE_PATH">` tag — a small, stable, greppable envelope that tells the model both *what* it is reading and *where*.
  - Image processing failure does **not** abort: the failure message is embedded in the text block and the run continues.
  - A missing file or an unreadable file is a hard `process.exit(1)` with a red message.
- **Idea to steal:** the `<file name="…">` envelope for pasted content.

#### `packages/coding-agent/src/cli/initial-message.ts`
- **Purpose:** Combines stdin, `@file` text and the first CLI message into one initial prompt.
- **Key abstractions:** `InitialMessageInput`, `InitialMessageResult`, `buildInitialMessage(...)`.
- **Data flow:** stdin → file text → first CLI message (which is *shifted off* `parsed.messages` so it is not sent twice) → joined with `""`.
- **Non-obvious design decisions:** the join is `""` (no separator) — the parts are already delimited by the `<file>` tags. The `shift()` is the important bit: the first message is consumed here and must not also flow through the normal message queue.

#### `packages/coding-agent/src/cli/list-models.ts`
- **Purpose:** `--list-models [search]` — a column-aligned table of every available model.
- **Key abstractions:** `listModels(modelRuntime, searchPattern?, signal?)`, local `formatTokenCount`.
- **Non-obvious design decisions:**
  - The table prints **capability columns the user can act on** — `context`, `max-out`, `thinking` (yes/no), `images` (yes/no) — not just names. This is the "what can this model do" table a model-picker should render.
  - `formatTokenCount` renders `200000 → "200K"`, `1000000 → "1M"`.
  - A load error from `models.json` is a **yellow warning**, not a failure — the table still prints.
- **Idea to steal:** a capability matrix in the model picker.

#### `packages/coding-agent/src/cli/project-trust.ts`
- **Purpose:** Bridges the core project-trust flow to the CLI's UI capabilities.
- **Key abstractions:** `createProjectTrustContext({cwd, mode, settingsManager, hasUI})` → `ProjectTrustContext`.
- **Data flow:** core trust resolution → `ui.select` / `ui.confirm` / `ui.input` / `ui.notify`.
- **Non-obvious design decisions:** every UI callback **returns `undefined`/`false` when there is no UI** (print/JSON/RPC modes) — the answer to "trust this folder?" in a non-interactive run is "no", not "yes by default". `notify` writes to **stderr** in non-interactive modes so stdout stays parseable.
- **Idea to steal:** the "no UI ⇒ deny" rule for approval prompts in headless mode.

#### `packages/coding-agent/src/cli/session-picker.ts`
- **Purpose:** The TUI session selector used by `--resume`.
- **Key abstractions:** `selectSession(currentSessionsLoader, allSessionsLoader, settingsManager)`.
- **Data flow:** two loaders (current project vs all sessions) → `SessionSelectorComponent` → a path or `null`.
- **Non-obvious design decisions:** the loader signature is `(onProgress?, signal?) => Promise<SessionInfo[]>` — the picker is **progress-aware and abortable**, so a slow filesystem scan shows progress and a cancelled picker aborts the scan.
- **Edge cases & failure handling:** a `resolved` latch again; cancel resolves `null` rather than hanging.

#### `packages/coding-agent/src/cli/setup.ts`
- **Purpose:** Pre-main process setup.
- **Key abstractions:** `setupCli(): void`.
- **Data flow:** sets `process.title`, `PI_CODING_AGENT=true`, `AI_AGENT=pi`, stubs `process.emitWarning`, calls `configureHttpDispatcher()`.
- **Non-obvious design decisions:** the comment states the rule precisely: *"Configure undici before provider SDKs issue requests. Settings are applied once SettingsManager has loaded global/project configuration."* The dispatcher is installed **early with defaults**, then re-configured later with the user's timeout. Two-phase configuration.

#### `packages/coding-agent/src/cli/startup-ui.ts`
- **Purpose:** All the small TUI surfaces that appear before the main interactive mode: first-time setup, a generic selector, a generic input, and the terminal-colour query.
- **Key abstractions:** `createStartupTui`, `startStartupTui`, `showStartupSelector`, `showStartupInput`, `showFirstTimeSetup`, `shouldRunFirstTimeSetup`, `loadThemes`, `loadStartupThemes`.
- **Data flow:** `SettingsManager` → capability overrides + keybindings + theme → `TuiMainScreen` → a component → a promise.
- **Non-obvious design decisions:**
  - `shouldRunFirstTimeSetup` requires **four** conditions: official distribution, `PI_EXPERIMENTAL=1`, no custom agent dir, and no existing `settings.json`. A fork/rebrand never runs it.
  - `loadThemes` **swallows a broken theme's error** — a startup prompt must not fail because a theme file is bad; the resource loader reports it later with a diagnostic.
  - The system theme starts **grayscale** (`markTerminalColorsPending()`) until the terminal reports its colours, then re-renders. Deliberate: never render a guessed palette.
  - `queryStartupTerminalColors` is fire-and-forget with a timeout — startup does not block on the terminal's OSC query.
  - `clearStartupTui` waits **25 ms** after `ui.clear()` before resolving, so the cleared screen actually paints.
- **Edge cases & failure handling:** every startup surface uses a `settled` latch so the promise resolves exactly once.

#### `packages/coding-agent/src/core/auth-guidance.ts`
- **Purpose:** The four "you have no model/credential" messages, each with a pointer at the docs.
- **Key abstractions:** `getProviderLoginHelp`, `formatNoModelsAvailableMessage`, `formatNoModelSelectedMessage`, `formatNoApiKeyFoundMessage`.
- **Non-obvious design decisions:** the "unknown" provider id renders as "the selected model" rather than the literal string `unknown`. Every failure path ends with the *same* actionable instruction block.
- **Idea to steal:** one shared "how to fix this" block reused by every empty-state error.

#### `packages/coding-agent/src/core/bug-report-upload.ts`
- **Purpose:** Uploads a bug-report bundle to the Radius gateway as multipart form data.
- **Key abstractions:** `uploadBugReport(bundle, {token?, signal?, gatewayUrl?})`.
- **Data flow:** `bugReportFiles(bundle)` → `FormData` → `POST /v1/bug-reports` → `{id}`.
- **Non-obvious design decisions:** the upload is **anonymous by default** — a token is attached only if one was supplied, and the endpoint accepts an unattributed bundle.
- **Edge cases & failure handling:** the response is parsed defensively (`response.json().catch(() => null)`), and success requires `response.ok && json.ok === true && typeof json.bug_report.id === "string"` — three checks, because a 200 with a malformed body is not success.

#### `packages/coding-agent/src/core/cache-stats.ts`
- **Purpose:** Measures **prompt-cache waste** across a session: tokens that were in the previous turn's prompt but were re-billed instead of read from cache.
- **Key abstractions:** `CACHE_TTL_MS = 5 * 60_000` (Anthropic's default TTL), `NOISE_FLOOR_TOKENS = 1024`, `CacheMiss {missedTokens, missedCost, idleMs, modelChanged}`, `CacheWasteTotals`, `ModelPriceSource`, `computeCacheWaste`, `collectCacheMisses`, `detectCacheMiss`.
- **Data flow:** session entries → `scan()` walks the entries, tracking the previous request → per assistant message `detectMiss(prev, message, models)` → totals + a per-message map.
- **Non-obvious design decisions:**
  - A **noise floor**: a miss of ≤1024 tokens is "cache breakpoint granularity noise" and is not counted. Without it, the tool would report a miss on almost every turn.
  - A **sticky `reportedCache` flag** distinguishes "the provider never reports cache activity" (nothing to miss) from "the provider reports cache reads and this turn had none" (a total miss). The comment says it exactly: *"on cache-read-only providers that is a total miss, while on providers that never report caching it means nothing."*
  - The extra cost is computed as `missedTokens × (paidPerToken − readPerToken)`, where `paidPerToken` is derived from *this message's own* cost breakdown (input + cacheWrite, including the write premium) rather than from a price table.
  - A **compaction or branch summary resets `prev`** — the context legitimately changed, so the next turn's prompt is new content, not re-billed content. A **model switch does NOT reset it** — switching models re-bills the whole prompt and *should* be counted.
  - `modelChanged` is carried on every miss so the UI can distinguish "the cache expired" from "you switched models".
- **Idea to steal:** measure cache waste as a first-class, explainable number rather than a vendor-specific usage field.
- **Surprising:** `detectCacheMiss` is documented as needing a session that does **not yet** contain the message, because `message_end` fires *before* persistence — an ordering assumption encoded in a comment.

#### `packages/coding-agent/src/core/client-identity.ts`
- **Purpose:** Builds the `User-Agent` / attribution pi presents to providers.
- **Key abstractions:** `getClientIdentity(settingsManager): ClientIdentity`.
- **Non-obvious design decisions:** the attribution string is `null` when install telemetry is off — pi does not identify itself as a CLI agent to the provider unless the user opted in to telemetry. `userAgent: "detailed"` includes the version.

#### `packages/coding-agent/src/core/crash-log.ts`
- **Purpose:** A best-effort, size-bounded crash log (`~/.pi/crashes.json`) plus the machinery to attribute a crash to an extension.
- **Key abstractions:** `CrashRecord`, `readCrashLog`, `recordCrash`, `takeUnnotifiedCrash`, `clearCrashLog`, `findExtensionStackMatches`.
- **Data flow:** uncaught exception → `recordCrash` → append to the JSON array, keep the **last 5** → next startup `takeUnnotifiedCrash` returns the newest record younger than 7 days and marks it `notified`.
- **Non-obvious design decisions:**
  - `findExtensionStackMatches` is a real attribution engine: it parses the stack, normalises Windows backslashes, handles a **single-file package** differently from a **package root** (prefix match for descendants vs exact-segment match for one file), and case-insensitively matches Windows drive paths. It also **skips synthetic paths** (`builtin:…`) so a built-in is never blamed on an extension.
  - `readCrashLog` validates each record's shape and drops malformed ones, so a corrupted file cannot crash the crash handler.
  - `takeUnnotifiedCrash` marks the record notified **and ignores a write failure** — "Showing the notice again is harmless."
  - `recordCrash` returns `undefined` on any failure: it is called from the crash path itself, so it must never throw.
- **Idea to steal:** blame an extension from the stack trace, with a "who did it" line on the crash record.

#### `packages/coding-agent/src/core/defaults.ts`
- **Purpose:** The default thinking level and the canonical ordered list of thinking levels.
- **Key abstractions:** `DEFAULT_THINKING_LEVEL = "medium"`, `THINKING_LEVEL_OPTIONS` (`off, minimal, low, medium, high, xhigh, max`).
- **Non-obvious design decisions:** the ladder has **seven** steps including `xhigh` and `max` — a single shared list that the settings schema, the CLI parser and the cycle keybinding all read, so a new tier cannot be added in one place only.

#### `packages/coding-agent/src/core/diagnostics.ts`
- **Purpose:** The three diagnostic shapes the whole app reports: `warning`, `error`, `collision`.
- **Key abstractions:** `ResourceCollision {resourceType: "extension"|"skill"|"prompt"|"theme", name, winnerPath, loserPath, winnerSource?, loserSource?}`, `ResourceDiagnostic`.
- **Non-obvious design decisions:** a **collision** is a first-class diagnostic: when two skills/extensions/prompts/themes claim the same name, the diagnostic names **both** the winner and the loser and their sources. This is the "your skill was shadowed" report.

#### `packages/coding-agent/src/core/event-bus.ts`
- **Purpose:** A tiny typed wrapper over `EventEmitter` used for cross-component events.
- **Key abstractions:** `EventBus {emit, on}`, `EventBusController {clear}`, `createEventBus()`.
- **Non-obvious design decisions:** `on()` wraps the handler in a **safe async wrapper** that catches and logs any error, and returns an unsubscribe function. A throwing listener can never take the bus down.
- **Idea to steal:** an event bus whose listeners cannot crash the emitter.

#### `packages/coding-agent/src/core/exec.ts`
- **Purpose:** `execCommand(command, args, cwd, options)` — the shared shell-command runner for extensions and custom tools.
- **Key abstractions:** `ExecOptions {signal?, timeout?, cwd?}`, `ExecResult {stdout, stderr, code, killed}`.
- **Data flow:** `spawn(command, args, {shell: false, stdio: ["ignore","pipe","pipe"]})` → accumulate stdout/stderr → resolve with the exit code.
- **Non-obvious design decisions:**
  - `shell: false` — the command and args are passed as an **argv array**, never interpolated into a shell string. No quoting bugs, no injection.
  - The kill path is **SIGTERM, then SIGKILL after 5 seconds**, and `killed` is reported separately from `code` so the caller can tell "timed out" from "exited non-zero".
  - `waitForChildProcess(proc)` is used instead of listening for `close`, because a **detached descendant holding the stdio pipe open** would otherwise hang the promise forever. The comment says so.
  - The promise **always resolves** — even on spawn error, with `code: 1`.
- **Idea to steal:** `killed` as a separate field from the exit code.

#### `packages/coding-agent/src/core/experimental.ts`
- **Purpose:** The single gate for experimental features: `process.env.PI_EXPERIMENTAL === "1"`.
- **Non-obvious design decisions:** exact string equality, not a truthy parse — one flag, one meaning, no `yes`/`true` variants to guess at.

#### `packages/coding-agent/src/core/http-dispatcher.ts`
- **Purpose:** Owns the global undici dispatcher: proxy support, idle timeouts, HTTP/1.1-only, and the global `fetch` install.
- **Key abstractions:** `DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000`, `HTTP_IDLE_TIMEOUT_CHOICES` (30s/1m/2m/5m/disabled), `parseHttpIdleTimeoutMs`, `formatHttpIdleTimeoutMs`, `applyHttpProxySettings`, `configureHttpDispatcher(timeoutMs?)`.
- **Data flow:** settings → `configureHttpDispatcher` → `undici.EnvHttpProxyAgent` → `undici.setGlobalDispatcher` → `undici.install()`.
- **Non-obvious design decisions:**
  - `DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2_000` — the comment explains: *"Node's 250ms default can terminate valid connection attempts on high-latency routes."* A happy-path tuning value inherited from Node turned out to break slow routes.
  - `allowH2: false` and `proxyTunnel: true` — HTTP origins stay on CONNECT tunnels, "as they were before Undici 8.7".
  - `withUndiciErrorListener` attaches a no-op `error` listener because undici can emit an internal `Client` "error" while terminating a mid-stream body; the body stream still rejects through the reader, and without the listener Node's EventEmitter `error` special case would crash the process.
  - The `shouldInstallGlobals` check preserves a **deliberate** user override of `globalThis.fetch`: if the current `fetch` is still the one undici installed (or the original), pi re-installs; if a caller replaced it, pi leaves it alone.
  - The comment about Node 26: *"Node 26.0's bundled fetch can otherwise consume compressed responses through npm undici's dispatcher without decompressing them, causing response.json() failures."*
- **Idea to steal:** pin `fetch` and the dispatcher to the same implementation.

#### `packages/coding-agent/src/core/index.ts`
- **Purpose:** The public barrel of the core layer.
- **Key abstractions:** re-exports `AgentSession`, `AgentSessionRuntime`, `createAgentSessionRuntime`, `AgentSessionServices`, `createAgentSessionServices`, `executeBashWithOperations`, `CompactionResult`, `CacheWarmingDecision/Status`, `createEventBus`, the whole extension event/type surface, `defineTool`, `createSyntheticSourceInfo`.
- **Non-obvious design decisions:** the barrel is the **extension API surface** — the event names (`AgentStartEvent`, `TurnStartEvent`, `ToolCallEvent`, `AgentSettledEvent`, `SessionBeforeCompactEvent`, `SessionBeforeForkEvent`, …) are exported as types, so extensions are typed against the core's lifecycle rather than strings.

#### `packages/coding-agent/src/core/key-id-schema.ts`
- **Purpose:** A typebox schema for a key identifier (`ctrl+shift+a`, `escape`, …).
- **Key abstractions:** `KeyIdSchema`, `keybindingValueSchema(options?)`, `KeybindingValueSchema`.
- **Non-obvious design decisions:** the regex is built from the **actual `Key` enum** in the TUI package, and it carries a **negative lookahead for duplicate modifiers** (`ctrl+ctrl+x` is invalid). The schema is therefore generated from the source of truth rather than hand-maintained.

#### `packages/coding-agent/src/core/keybindings-schema.ts`
- **Purpose:** The JSON schema for the user's `keybindings.json`.
- **Key abstractions:** `KeybindingsSchema`.
- **Data flow:** `KEYBINDINGS` (the default table) → one optional property per binding, with the description carried from the definition; `additionalProperties` allows the same value schema for extension-registered bindings.
- **Non-obvious design decisions:** the schema is **generated from the default table**, so a new binding automatically appears in the schema and in the editor's autocomplete.

#### `packages/coding-agent/src/core/keybindings.ts`
- **Purpose:** The complete default keybinding table, the legacy-name migration map, and the `KeybindingsManager`.
- **Key abstractions:** `APP_KEYBINDINGS`, `KEYBINDINGS` (TUI defaults + app defaults), `KEYBINDING_NAME_MIGRATIONS`, `migrateKeybindingsConfig`, `KeybindingsManager`, `useWindowsKeybindings`.
- **Data flow:** `keybindings.json` → `loadRawConfig` → `migrateKeybindingsConfig` (rename legacy names, drop duplicates) → `toKeybindingsConfig` (validate each value against the typebox schema) → `KeybindingsManager`.
- **Non-obvious design decisions:**
  - **Platform-aware defaults**: on Windows/WSL, `alt+enter` becomes `ctrl+q` (queue a follow-up), `ctrl+shift+p` becomes `alt+p`, `alt+left/right` become `ctrl+left/right`. The reasoning is that `alt+enter` is unreliable in Windows terminals.
  - A **legacy-name migration table** (`cursorUp → tui.editor.cursorUp`, …, `cycleThinkingLevel → app.thinking.cycle`). Migration is *lossless and idempotent*: if the new key is already present, the legacy one is dropped rather than overwriting it.
  - `orderKeybindingsConfig` writes the known bindings first (in the table's order) and then the unknown ones sorted — so the file is stable and diffs cleanly.
  - Invalid values are **silently dropped** (`if (validateKeybindingValue.Check(binding))`), not fatal: one bad keybinding cannot lock the user out of the app.
  - `useWindowsKeybindings` also detects **WSL** via `WSL_DISTRO_NAME`/`WSL_INTEROP`, so WSL gets the Windows key set.
- **Idea to steal:** a legacy-name migration table for renamed settings, applied on every load.

#### `packages/coding-agent/src/core/messages.ts`
- **Purpose:** The custom message types that extend the base agent message, and the transformer to LLM messages.
- **Key abstractions:** `BashExecutionMessage`, `CustomMessage<T>`, `BranchSummaryMessage`, `CompactionSummaryMessage`, `COMPACTION_SUMMARY_PREFIX/SUFFIX`, `BRANCH_SUMMARY_PREFIX/SUFFIX`, `bashExecutionToText`, `convertToLlm`, `createCustomMessage`, `createBranchSummaryMessage`, `createCompactionSummaryMessage`.
- **Data flow:** custom message → `convertToLlm` → a `user`-role `Message` for the provider.
- **Non-obvious design decisions:**
  - The custom types are registered by **declaration merging** into the upstream `CustomAgentMessages` interface, so the upstream agent core knows about them without a dependency inversion.
  - `excludeFromContext` on a bash message (`!!` prefix) drops it from the LLM context while keeping it visible to the human — the transcript and the model see different things.
  - The summary messages are wrapped in **literal `<summary>` XML tags with a prose sentence before them** ("The conversation history before this point was compacted into the following summary:"). The tag is the boundary the model can be told to trust.
  - `convertToLlm` ends with an `exhaustiveCheck: never` so a new message role is a **compile error** until it is handled.
- **Idea to steal:** a single `transformToLlm` choke point where every custom message type must be handled.

#### `packages/coding-agent/src/core/model-config.ts`
- **Purpose:** The immutable, credential-blind snapshot of `models.json`.
- **Key abstractions:** `ModelsConfigSchema` (typebox), `ModelsJsonSchemas`, `ModelConfig` (`load`, `getProvider`, `getProviderIds`, `getError`), `ModelsJsonProvider/Model/ModelOverride`.
- **Data flow:** file → `stripJsonComments` + `stripBom` → `JSON.parse` → `validateModelsConfig.Check` → `deepFreeze(structuredClone(provider))` into a `Map`.
- **Non-obvious design decisions:**
  - A **bad file never throws**. Every failure mode (unreadable, unparseable, schema-invalid) returns a `ModelConfig` with an **empty provider map and an `error` string**; the app keeps running with the built-in catalog and shows a diagnostic. The error message includes the file path and, for schema errors, a **path-qualified list** ("`providers.openai.baseUrl`: expected string").
  - The file is `deepFreeze`d and `structuredClone`d — the snapshot is genuinely immutable, so nothing downstream can mutate the catalog.
  - **Comment stripping** (`stripJsonComments`) means `models.json` can be JSONC without a second parser.
  - `apiKey` accepts three forms in one string: a literal key, `"$NAME"` env interpolation, or `"!command"` whose stdout is the key.
  - `ModelOverrideSchema` mirrors `ModelDefinitionSchema` but every field is optional and `cost` is `Partial` — an override is a patch, not a definition.
- **Idea to steal:** a config loader that reports errors as data and never as an exception.

#### `packages/coding-agent/src/core/model-registry.ts`
- **Purpose:** A **synchronous compatibility facade** over `ModelRuntime`, exposed to extensions.
- **Key abstractions:** `ModelRegistry` (a thin wrapper: `getAll`, `getAvailable`, `find`, `findOfType`, `stream`, `complete`, `classify`, `generateImages`, `registerProvider`, `registerVirtualModel`, …), `ResolvedRequestAuth` (a discriminated union: `{ok: true, apiKey?, headers?, baseUrl?, env?}` | `{ok: false, error}`).
- **Data flow:** extension → `ModelRegistry` → `ModelRuntime` → provider.
- **Non-obvious design decisions:**
  - The class exists purely so **older extension code keeps working**; the comment says "Coding-agent internals use `ModelRuntime` directly." This is the classic two-layer approach: one authoritative async runtime, one sync façade.
  - `getApiKeyAndHeaders` returns a **result union, not a throw**, and it special-cases a provider whose compat config says `authHeader` — that provider needs a resolved key, so "no key" is an error; every other provider can still work with headers alone. The error message is rewritten from the internal `"authHeader requires a resolved API key"` into `"No API key found for \"<provider>\""`.
  - `classify` and `generateImages` are documented as **never rejecting** — they return a result object instead.

#### `packages/coding-agent/src/core/models-store.ts`
- **Purpose:** Storage for dynamically refreshed provider model catalogs.
- **Key abstractions:** `InMemoryCodingAgentModelsStore` (a `Map` with `structuredClone` on read and write), `FileModelsStore` (a locked JSON file at `~/.pi/models-store.json`).
- **Data flow:** `read` → revision check → cache hit, or a single shared reload promise → `storage.withLockAsync` → parse → return; `write`/`delete` → lock → mutate → write → update the in-memory state.
- **Non-obvious design decisions:**
  - The file store keeps an in-memory snapshot plus a **file revision**; a read whose revision is unchanged is served from memory with **no disk I/O**.
  - Concurrent reads that miss the cache **share one reload promise** (`readState.reload`), with a reader count; the last reader out aborts the reload controller. No thundering herd, no leaked controller.
  - All writes go through `FileAuthStorageBackend.withLockAsync` — a **file lock** — so two pi processes do not clobber each other's catalog.
  - The shared read state is **module-global but bounded to one path** ("Optimize the common path without retaining an unbounded set of custom paths").
- **Idea to steal:** a revision-stamped cache + a single shared in-flight reload.

#### `packages/coding-agent/src/core/nested-tool-calls.ts`
- **Purpose:** Supports tools that call other tools (codemode scripts calling `read`, `bash`, …) and records those nested calls.
- **Key abstractions:** `NESTED_CALL_LIMITS` (max 256 calls, 8 KB of arguments per call, 32 KB total, 500 chars of error), `NestedCallRecorder`, `NestedToolCallRunner`, `NestedToolCallHost`, `NestedCallSummary`, `NestedToolExecutionEvent`.
- **Data flow:** a tool calls `ctx.executeTool(name, args)` → the runner mints id `<callerId>/<n>` → the host runs it through the **same tool pipeline** (`runToolCall`) → events are emitted with `parentToolCallId` → the record is snapshotted onto the parent tool's result message, and the nested usage is added to the parent's usage.
- **Non-obvious design decisions:**
  - Nested calls **share the parent's recorder**, so a nested call's own nested calls are recorded in the same tree.
  - The **exclusive queue**: if the agent is sequential, or the specific tool declares `executionMode: "sequential"`, the nested call waits on a promise chain. A call that *holds* the queue (`holdsQueue`) does not wait on itself — otherwise a sequential tool that calls another tool would deadlock. This is the subtle bit.
  - Nested calls are **not persisted**; only their usage is counted. So the transcript shows the parent, and the cost still lands.
  - Over-limit arguments are dropped but the record keeps `argumentsBytes` and is marked `complete: false` — the UI can say "this record was truncated".
  - Tool failures come back as `isError: true`; the runner **never rejects**.
- **Idea to steal:** nested tool calls as a first-class, bounded record with a `complete` flag.

#### `packages/coding-agent/src/core/output-guard.ts`
- **Purpose:** Takes over `process.stdout.write` so the TUI's own rendering is not interleaved with a child's output.
- **Key abstractions:** `takeOverStdout()`, `restoreStdout()`, `isStdoutTakenOver()`, `writeRawStdout(text)`, `waitForRawStdoutBackpressure()`, `flushRawStdout()`.
- **Data flow:** takeover → all normal writes are redirected to **stderr** → `writeRawStdout` writes to the saved raw stdout through a **serialized promise chain** → `flushRawStdout` waits for backpressure.
- **Non-obvious design decisions:**
  - The raw write **retries on `ENOBUFS` / `EAGAIN` / `EWOULDBLOCK`** with a 10 ms delay instead of dropping the chunk — a TTY buffer that is momentarily full must not lose output.
  - `writeRawStdout` **never awaits**: it chains onto `rawStdoutWriteTail` and swallows the rejection into `process.exit(1)`. The caller does not block on the terminal.
  - `waitForRawStdoutBackpressure` loops until the tail stops changing — a stable-tail check, not a single await.
- **Idea to steal:** a stdout takeover that redirects human-readable noise to stderr so the machine-readable channel stays clean.

#### `packages/coding-agent/src/core/pi-manifest.ts`
- **Purpose:** Reads a package's `package.json` → `pi` manifest, which declares the extensions/skills/prompts/themes a package contributes.
- **Key abstractions:** `PiManifest`, `readPiManifest(packageJsonPath)`.
- **Non-obvious design decisions:** only the four known fields are read, and each is accepted **only if it is an array of strings** — a malformed manifest is silently ignored rather than partially trusted. The whole read is wrapped in a try/catch returning `null`.

#### `packages/coding-agent/src/core/project-trust.ts`
- **Purpose:** The decision flow for "may this project folder's settings, resources and extensions be loaded?"
- **Key abstractions:** `AppMode`, `resolveProjectTrusted(options): Promise<boolean>`, `ProjectTrustOption`, `formatProjectTrustPrompt`.
- **Data flow:** CLI override → "does this project even need trust?" → extension `project_trust` event → stored decision → `defaultProjectTrust` setting → interactive prompt.
- **Non-obvious design decisions:**
  - The precedence is explicit and ordered: **`--approve`/`--no-approve` wins over everything**; then "no project resources at all ⇒ trusted"; then **extensions get first refusal** (an extension can answer the trust question for itself); then the stored decision; then the `always`/`never`/`ask` setting.
  - **No UI ⇒ not trusted.** A headless run with a project that has resources and no recorded decision returns `false`. This is the safe default, not a crash.
  - The extension event result carries `remember: true/false`, so an extension can answer *without* persisting a decision.
  - The prompt text names exactly what trust grants: loading `.pi` settings and resources, installing missing project packages, and executing project extensions.
- **Idea to steal:** extensions get first refusal on the trust decision.

#### `packages/coding-agent/src/core/radius.ts`
- **Purpose:** The Radius gateway URL, its env override (`PI_RADIUS_GATEWAY`) and its MCP endpoint.
- **Key abstractions:** `RADIUS_PROVIDER_ID`, `ENV_RADIUS_GATEWAY`, `RADIUS_MCP_URL`, `getRadiusGatewayUrl()`.
- **Non-obvious design decisions:** the gateway is **normalised** through the AI package's `normalizeRadiusGatewayUrl` so a user-supplied override cannot produce a malformed URL.

#### `packages/coding-agent/src/core/session-cwd.ts`
- **Purpose:** Detects a session whose recorded working directory no longer exists.
- **Key abstractions:** `SessionCwdIssue`, `getMissingSessionCwdIssue`, `formatMissingSessionCwdError`, `formatMissingSessionCwdPrompt`, `MissingSessionCwdError`, `assertSessionCwdExists`.
- **Non-obvious design decisions:** three distinct renderings of the same fact — a **thrown error** (`assertSessionCwdExists`), a **one-line error** and a **two-line prompt** — because the same issue is consumed by a thrown path and by an interactive "continue in current cwd?" prompt.
- **Edge cases & failure handling:** a session with no file, or whose cwd still exists, is not an issue.

#### `packages/coding-agent/src/core/session-export.ts`
- **Purpose:** Serialises the current session branch to JSONL, and writes it to a file.
- **Key abstractions:** `serializeSessionBranch(sessionManager, createTrailingEntries?)`, `exportSessionToJsonl(sessionManager, outputPath?, createTrailingEntries?)`.
- **Data flow:** `sessionManager.getBranch()` → prepend a `session` header (`type`, `version`, `id`, `timestamp`, `cwd`) → assign each entry a `parentId` chain → optional trailing entries → one JSON object per line.
- **Non-obvious design decisions:**
  - The **parent chain is materialised on export** — the in-memory branch entries do not carry `parentId`; the exporter writes it. The export format is therefore self-describing.
  - `createTrailingEntries(parentId, timestamp)` lets the caller append entries that exist only in the export (e.g. a synthetic "session ended" record) without polluting the live session.
  - The default filename is `session-<ISO with : and . replaced by ->.jsonl` — filesystem-safe timestamps.
  - The output directory is created if missing.

#### `packages/coding-agent/src/core/settings-defaults.ts`
- **Purpose:** The single source of truth for every runtime default.
- **Key abstractions:** `SETTINGS_DEFAULTS` (a big `as const` object).
- **Non-obvious design decisions:**
  - The defaults are **grouped by domain** and include the operational numbers that matter: `compaction.reserveTokens: 16384`, `compaction.keepRecentTokens: 20000`, `retry.maxRetries: 3`, `retry.baseDelayMs: 2000`, `retry.provider.maxRetryDelayMs: 60000`.
  - `cacheWarming: "streaming"` and `codemode.mode: "on"` with `inlineBudget: 3000` — a **token budget for the tool declarations injected inline**.
  - `defaultProjectTrust: "ask"`.
  - The same object is consumed by `settings-schema.ts`, so the published JSON Schema and the runtime defaults cannot drift.
- **Idea to steal:** one `DEFAULTS` object that both the schema and the accessors read.

#### `packages/coding-agent/src/core/settings-diagnostics.ts`
- **Purpose:** Turns settings-manager errors into runtime diagnostics and de-duplicates them.
- **Key abstractions:** `collectSettingsDiagnostics(settingsManager)`, `deduplicateDiagnostics(diagnostics)`.
- **Non-obvious design decisions:** de-duplication is by `type\0message` and **keeps the first occurrence** — the startup manager's report wins over the runtime manager's report of the same broken file.

#### `packages/coding-agent/src/core/source-info.ts`
- **Purpose:** Where a resource came from: `user` / `project` / `temporary` scope, `package` / `top-level` origin, plus the source string.
- **Key abstractions:** `SourceInfo`, `SourceScope`, `SourceOrigin`, `BUILTIN_PATH_PREFIX`, `getSyntheticPathSource`, `isSyntheticPath`, `createSourceInfo`, `createSyntheticSourceInfo`.
- **Non-obvious design decisions:** **synthetic paths** — `builtin:<name>` and `<inline:name>` — let a resource that is not a file on disk have a source identity, and `isSyntheticPath` lets the crash-blame code skip them.
- **Idea to steal:** a uniform "source" identity for resources that are not files.

#### `packages/coding-agent/src/core/telemetry.ts`
- **Purpose:** Resolves whether install telemetry is on: env override first, then the setting.
- **Key abstractions:** `isInstallTelemetryEnabled(settingsManager, telemetryEnv = process.env.PI_TELEMETRY)`.
- **Non-obvious design decisions:** the env var, **when present**, wins over the user's stored preference — and the truthy parse accepts `1`, `true`, `yes` case-insensitively, so `PI_TELEMETRY=0`/`false`/`no` can turn it *off* from a script.

#### `packages/coding-agent/src/core/timings.ts`
- **Purpose:** Opt-in startup profiling behind `PI_TIMING=1`.
- **Key abstractions:** `resetTimings(namespace?)`, `time(label, namespace?)`, `printTimings()`.
- **Non-obvious design decisions:** timings are **namespaced** ("main", "extensions") so the extension-loading cost is measured separately from the rest of startup, and each `time()` is a **delta from the previous mark**.

#### `packages/coding-agent/src/core/settings-schema.ts`
- **Purpose:** The typebox JSON Schema for `settings.json` — the published contract.
- **Key abstractions:** `SettingsSchema`, and the per-domain sub-schemas; the exported types `Settings`, `RetrySettings`, `CompactionSettings`, `CodemodeSettings`, `TransportSetting`, `CacheWarmingMode`, `DefaultProjectTrust`, …
- **Data flow:** `SETTINGS_DEFAULTS` → every `default:` in the schema → the runtime and the published schema agree.
- **Non-obvious design decisions:**
  - **`deprecated: true`** on `queueMode`, `websockets` and `retry.maxDelayMs` — old keys keep working but are marked.
  - `transport` has four values: `auto`, `sse`, `websocket`, `websocket-cached` — a cached-websocket transport is a distinct mode, not a flag.
  - `cacheWarming` is `off | streaming | idle` and the schema's own description says: *"Global only because each refresh costs money."* The privacy/cost reasoning is in the schema.
  - `codemode.mode` is `on | only` with a long description of the difference ("on" keeps direct tools declared and annotates script-callable tools; "only" lists every script-callable tool in codemode and does not declare active direct tools).
  - `thinkingBudgets` are per-level numbers — the thinking tier is a **budget**, not a name.
  - `httpIdleTimeoutMs` and `websocketConnectTimeoutMs` accept `0` or the string `"disabled"` — a timeout can be explicitly turned off.
  - `SettingsSchema` sets `additionalProperties: true` so an unknown key never blocks a settings file from loading.
  - The `Settings` type **omits** the deprecated `queueMode`/`websockets` and re-types `retry`/`skills`, so the migrated shape is what the app uses.

#### `packages/coding-agent/src/core/trust-manager.ts`
- **Purpose:** The persistent project-trust store (`~/.pi/trust.json`) and the "does this project even need trust?" test.
- **Key abstractions:** `ProjectTrustStore` (`get`, `getEntry`, `set`, `setMany`), `ProjectTrustOption`, `getProjectTrustOptions`, `hasTrustRequiringProjectResources`, `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`.
- **Data flow:** cwd → canonicalised path → walk **up** the tree looking for a stored decision → `true`/`false`/`null`.
- **Non-obvious design decisions:**
  - Trust is **inherited from the nearest ancestor** with a decision. Trusting a parent folder trusts its children.
  - The trust store is a **directory lock** (`proper-lockfile`) with a 10-attempt, 20 ms busy-wait. The busy-wait is deliberate: the comment says *"Sleep synchronously to avoid changing trust store callers to async."*
  - The options list distinguishes **"Trust parent folder"** (writes the parent and *clears* the child with `null`) from **"Trust (this session only)"** (writes nothing). `null` in the file means "no decision here", and `setMany` **deletes** the key for `null`.
  - `hasTrustRequiringProjectResources` walks up looking for `.agents/skills` but **excludes the user's own `~/.agents/skills`**, even when cwd *is* `$HOME` — otherwise running pi in your home directory would always demand trust.
  - The file is written with **sorted keys** so it diffs cleanly.
- **Idea to steal:** "trust the parent" as a first-class answer, and a session-only option that writes nothing.

#### `packages/coding-agent/src/core/skills.ts`
- **Purpose:** Discovers, validates and formats "skills" — markdown files that give the model a specialised procedure.
- **Key abstractions:** `Skill {name, description, filePath, baseDir, sourceInfo, disableModelInvocation}`, `loadSkills`, `loadSkillsFromDir`, `formatSkillsForPrompt`, `SkillFrontmatter`, `LoadSkillsResult`.
- **Data flow:** directories → `SKILL.md` discovery (a directory containing `SKILL.md` is a skill root and is **not** recursed into) → frontmatter parse → name/description validation → `Skill` list → XML block for the system prompt.
- **Non-obvious design decisions:**
  - **Two discovery shapes**: a declared skill is `<dir>/SKILL.md`; a bare `<dir>/name.md` with a `description` in its frontmatter also counts. A bare `.md` **without** a description is silently ignored.
  - **The name is validated against the Agent Skills spec**: ≤64 chars, `^[a-z0-9-]+$`, no leading/trailing hyphen, no `--`. Violations are **warnings** — the skill still loads.
  - A **missing description is fatal** for the skill (it is dropped), because the description is what the model matches against.
  - `disable-model-invocation: true` in the frontmatter removes the skill from the prompt entirely; it stays invocable only via `/skill:name`.
  - **`formatSkillsForPrompt(skills, fileReadTool)` takes the reader as a parameter**: `"read"`, `"bash"`, or `"indirect"`. The prompt text changes to match the tool the model actually has; if the reader is only reachable through another tool, the hint names no tool.
  - The prompt format is XML per the Agent Skills standard: `<available_skills><skill><name/><description/><location/></skill></available_skills>`, with `escapeXml` on every value.
  - `.gitignore` / `.ignore` / `.fdignore` files are honoured during discovery, and `node_modules` is skipped.
  - **Symlink de-duplication** via `canonicalizePath` — the same file reached by two paths loads once.
  - A **name collision** produces a `collision` diagnostic naming the winner and the loser; the first one wins.
- **Idea to steal:** the `<available_skills>` XML index, and a `disable-model-invocation` flag that removes a skill from the prompt without deleting it.

#### `packages/coding-agent/src/core/system-prompt.ts`
- **Purpose:** Builds the system prompt as **named, independently replaceable sections**.
- **Key abstractions:** `BuildSystemPromptOptions`, `buildSystemPromptSections`, `buildSystemPromptState`, `buildSystemPrompt`, `diffSystemPromptSections`, `normalizeBuildSystemPromptOptions`, `SystemPromptSections`.
- **Data flow:** options → normalised → a `Record<string, string>` of sections → each section wrapped in `<name>…</name>` → the system message.
- **Non-obvious design decisions:**
  - The prompt is **not a string**. It is a map of named sections (`preamble`, `tools`, `rules`, `docs`, `addendum`, `project_context`, `skills`, `cwd`) and only the `preamble` is untagged.
  - `diffSystemPromptSections(previous, current)` returns a **patch** (`Record<string, string|null>`) — `null` means "remove this section". A changed tool list therefore changes one section, not the whole prompt.
  - Section names are validated against `/^[a-z][a-z0-9_-]*$/` and `preamble` is reserved. A bad section name **throws** at build time.
  - `forceSystemPrompt` (set by a `before_agent_start` handler) is **opaque**: it produces a system message with `content` and no `sections`.
  - `buildSystemPrompt` renders exactly what the transcript's system message replays — the prompt you see in the terminal is the prompt the model got.
  - `buildRules` adds a rule **only when it applies**: if `bash`/`powershell` is present but `grep`/`find`/`ls` are not, the model is told to use the shell for file operations. Rules are de-duplicated by normalised text.
  - The `docs` section is a long, precise map of pi's own documentation, and it tells the model to resolve `docs/...` under the docs root **not** the cwd.
- **Idea to steal:** a system prompt that is a map of named sections, diffed and patched, so a tool change edits one section.

#### `packages/coding-agent/src/core/prompt-templates.ts`
- **Purpose:** Loads markdown prompt templates and expands `/name args` into a prompt.
- **Key abstractions:** `PromptTemplate`, `loadPromptTemplates`, `expandPromptTemplate`, `parseCommandArgs`, `substituteArgs`.
- **Data flow:** directories of `.md` files → frontmatter (`description`, `argument-hint`) → `PromptTemplate` → `/name` expansion at send time.
- **Non-obvious design decisions:**
  - `substituteArgs` supports `$1`, `$@`, `$ARGUMENTS`, `${N:-default}`, `${@:-default}`, `${@:N}` and `${@:N:L}` — **bash-style**, including slicing. The comment says substitution is **not recursive**: an argument containing `$1` is not re-substituted.
  - `parseCommandArgs` tracks a `hasToken` flag so a **quoted empty string** (`""`) survives as an argument.
  - The description falls back to the **first non-empty line**, truncated to 60 chars with an ellipsis.
  - Templates load from a **global** dir, a **project** dir, and explicit paths, each with a different `sourceInfo` scope.
- **Idea to steal:** bash-style `${@:N:L}` argument slicing in a prompt template.

#### `packages/coding-agent/src/core/auth-storage.ts`
- **Purpose:** The credential store: `~/.pi/auth.json` (mode `0600`), its file lock, and a revision-stamped read cache.
- **Key abstractions:** `FileAuthStorageBackend` (`withLock`, `withLockAsync`), `AuthStorage` (a `CredentialStore`), `ReadOnlyAuthStorage`, `InMemoryAuthStorageBackend`, `readStoredCredential`, `AuthStorageBackend`.
- **Data flow:** credential read → revision check → cached data, or one shared reload → `withLockAsync` → parse → return; modify/delete → lock → mutate → write the whole file → update the cache.
- **Non-obvious design decisions:**
  - **Lock compromise is checked at four points** around the critical section, and a compromised lock **throws**. The lock is not advisory: a write that might have raced is not trusted.
  - **Windows `EPERM` retry**: a just-removed lock directory can stay "delete pending" while antivirus or an indexer still holds it, so `mkdir` fails with `EPERM`. The code retries up to 5 times (capped separately from the 30 s wait-for-holder deadline) with exponential backoff and jitter. The comment explains it exactly.
  - The file is created with `mode: 0o600` and the parent directory with `0o700` — "The mode applies only on creation so administrator-managed modes and ACLs remain intact."
  - **A read failure preserves the last valid in-memory snapshot** (`catch {}` in `reload`) — a transient read error must not wipe the credentials.
  - The read state is **shared per path across instances** (a module-global), with a single in-flight reload and a reader count; the last reader out aborts the reload.
  - `ReadOnlyAuthStorage` **validates every credential's shape** and throws a precise message ("Invalid auth.json credential for provider \"x\"") — a corrupted file fails loudly rather than silently dropping a provider.
  - `read()` resolves `$ENV` and `!command` key values, but `list()` does **not** — listing credentials must not execute a command.
- **Idea to steal:** `list()` must not resolve secrets; only `read()` does.

#### `packages/coding-agent/src/core/cache-warmer.ts`
- **Purpose:** Keeps a provider's prompt-cache entry alive by replaying the request with a **one-token output cap** before the entry expires.
- **Key abstractions:** `CacheWarmer` (`start`, `onAgentSettled`, `onModeChanged`, `cancel`, `status`), `CacheWarmingDecision`, `CacheWarmingStatus`, `CacheWarmingDecisionEvent`, `getCacheWarmingDelayMs`, `getPromptCacheTtlMs`, `isReplayable`, `formatCacheWarmingStatus`, `formatCacheWarmingUsage`.
- **Data flow:** a real request → `start(request, isCurrent)` → a timer at 90 % of the TTL → a replay request with `maxTokens: 1` → the usage is appended to the session as a `cache_warm` entry.
- **Non-obvious design decisions:**
  - **The economics are explicit.** `expectedSavings = continuationProbability × missCost − warmCost`, and the refresh only happens when that is **≥ $0.05**. The idle continuation probability is a constant `0.15`, with the comment: *"Measured from our own usage; per-session estimates were not better than this constant."*
  - `isReplayable` refuses to replay a request whose provider would change its behaviour on replay: Anthropic's budget-based thinking derives `budget_tokens` from `max_tokens`, so a one-token replay would get a different budget and "the model could still think for thousands of tokens". Only models with `forceAdaptiveThinking` are safe.
  - **Fixed safety windows**: streaming warming never continues past **one hour**; idle warming past **30 minutes**. A warm request never extends these windows.
  - A `refreshDeadlineAt` keeps **half** of the planned pre-expiry margin, because "a late refresh is likely a full-price cache write, not a cache warm".
  - `isCurrent()` is re-checked before **and** after every refresh; if the conversation changed, warming stops with the reason "conversation context changed".
  - Extension overrides are honoured but **an extension failure falls back to pi's own decision**, and the override is recorded (`extensionOverride: true`) so the status line can say who decided.
  - Every refresh is recorded as a **session usage entry** (`appendUsage("cache_warm", …)`), so the cost is visible in `/session` and in the cache-waste analysis.
- **Idea to steal:** a scheduled background job that is allowed only when its expected saving is positive.

#### `packages/coding-agent/src/core/compaction/compaction.ts`
- **Purpose:** Context compaction — the mechanism that keeps a long session inside the model's context window.
- **Key abstractions:** `shouldCompact`, `estimateContextTokens`, `estimateProjectedContextTokens`, `findCutPoint`, `prepareCompaction`, `compact`, `generateSummary`, `generateSummaryWithUsage`, `completeSummarization`, `getSummarizationFailure`, `estimateTokens`, `DEFAULT_COMPACTION_SETTINGS`.
- **Data flow:** projected session entries → a cut point → the messages to summarise + the messages to keep → one LLM call → a summary + the file-operation lists → a `compaction` session entry.
- **Non-obvious design decisions:**
  - **The trigger is `contextTokens > contextWindow − reserveTokens`**, with `reserveTokens: 16384` and `keepRecentTokens: 20000`.
  - **The cut point may land mid-turn.** `findCutPoint` returns `{firstKeptEntryIndex, turnStartIndex, isSplitTurn}`. When a turn is split, a **second, smaller summary** (`TURN_PREFIX_SUMMARIZATION_PROMPT`) summarises only the *start* of the turn, and the two are merged with a `---` separator. The turn-prefix prompt explicitly says: *"Only summarize information explicitly present above. Do not infer or recreate later messages."*
  - **A tool result is never a cut point** — a tool result must follow its tool call, so the cut is at a user or assistant message. When the cut lands on an assistant message with tool calls, its results follow and are kept.
  - **Token estimation is a deliberately conservative `chars / 4` heuristic**, with an image counted as 4800 chars.
  - **`estimateProjectedContextTokens` distrusts usage captured before a later edit or compaction**: it locates the last usage message, finds the newest invalidating entry (`context_edit` or `compaction`), and if the usage predates it, re-estimates from scratch.
  - **A length stop is a failure**: `getSummarizationFailure` refuses to persist a summary that hit the token cap ("generation hit the token cap and the summary is incomplete"). A partial summary must not become a checkpoint.
  - **A summarization that tries to call a tool is an error** — the summarizer must not act.
  - `completeSummarization` sets `cacheRetention: "none"` so a one-off summary does not **write** a cache entry, and gives callers without a session id a fresh `uuidv7` routing id.
  - Every summarization goes through `retryAssistantCall`, so a transient stream drop honours the configured retry policy instead of failing the compaction.
  - The summary prompt is a **fixed, exact-format** template (Goal / Constraints & Preferences / Progress·Done·In Progress·Blocked / Key Decisions / Next Steps / Critical Context) with the instruction "Preserve exact file paths, function names, and error messages."
  - `UPDATE_SUMMARIZATION_INSTRUCTIONS` gives the merge rules for an existing summary: PRESERVE, ADD, move In Progress → Done, and remove what is no longer relevant.
- **Idea to steal:** refuse to persist a partial summary; a length stop is a failure, not a checkpoint.

#### `packages/coding-agent/src/core/compaction/branch-summarization.ts`
- **Purpose:** Summarises the branch the user navigated *away* from, so context is not lost when they come back.
- **Key abstractions:** `collectEntriesForBranchSummary`, `prepareBranchEntries`, `generateBranchSummary`, `BranchSummaryResult`, `BranchSummaryDetails`.
- **Data flow:** old leaf + target → the common ancestor → the entries between them → a token-budgeted message set → a summary + the file lists.
- **Non-obvious design decisions:**
  - The walk from the old leaf **does not stop at compaction boundaries** — a compaction's summary is included and becomes context.
  - The token budget walks **newest to oldest** so the most recent context is the one kept.
  - A compaction or branch-summary entry is allowed to **exceed the budget** if the budget is still under 90 % — it is important context.
  - File operations are collected from **all** entries (even those outside the budget) so the cumulative read/modified list stays complete; only pi-generated summaries count (`fromHook !== true`).
  - The summary is prefixed with a plain sentence: *"The user explored a different conversation branch before returning here. Summary of that exploration:"*.
- **Idea to steal:** summarise the abandoned branch, not just the whole session.

#### `packages/coding-agent/src/core/compaction/utils.ts`
- **Purpose:** The shared pieces of compaction and branch summarisation: file-operation tracking, conversation serialisation, and the summariser's system prompt.
- **Key abstractions:** `FileOperations`, `createFileOps`, `extractFileOpsFromMessage`, `computeFileLists`, `formatFileOperations`, `serializeConversation`, `SUMMARIZATION_SYSTEM_PROMPT`.
- **Data flow:** agent messages → a `[User]: … / [Assistant]: … / [Assistant tool calls]: … / [Tool result]: …` text transcript → the summariser.
- **Non-obvious design decisions:**
  - **The conversation is serialised to text** before summarisation, "so the model doesn't try to continue it".
  - **Tool results are truncated to 2000 characters** with an explicit `[... N more characters truncated]` marker.
  - **Thinking blocks are omitted entirely.** The comment is the reason: providers return summaries of the real reasoning, replayed thinking is often not part of the model's live context, and *"Including it can make the summarization request larger than the context it summarizes."*
  - `extractFileOpsFromMessage` reads **nested calls** from a tool result as well as tool calls from an assistant message — so a codemode script's file writes are tracked.
  - The file lists are emitted as `<read-files>` / `<modified-files>` XML blocks appended to the summary.
  - `SUMMARIZATION_SYSTEM_PROMPT` says: "Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary."

#### `packages/coding-agent/src/core/bash-executor.ts`
- **Purpose:** One bash execution path shared by interactive and RPC modes, with streaming, ANSI-safe chunking and a spill file.
- **Key abstractions:** `executeBashWithOperations(command, cwd, operations, options)`, `BashResult`, `BashExecutorOptions`.
- **Data flow:** `operations.exec` → `onData` chunks → strip ANSI → sanitise → rolling buffer + spill file → `truncateTail` → the result.
- **Non-obvious design decisions:**
  - **A split ANSI escape sequence across two chunks is reassembled** with `splitIncompleteAnsiSuffix` before stripping — otherwise a colour code at a chunk boundary leaks raw bytes into the transcript.
  - The rolling buffer is capped at `DEFAULT_MAX_BYTES × 2` and **drops the oldest chunks** — the tail is what matters.
  - Once the output exceeds the threshold, **everything is written to a spill file** and the result carries `fullOutputPath`.
  - **An aborted command still returns the output it produced so far**; the error is only rethrown when the signal was *not* aborted.
  - `exitCode` is `undefined` when cancelled, distinct from a non-zero exit.
- **Idea to steal:** a spill file for oversized tool output, with the path shown in the transcript.

#### `packages/coding-agent/src/core/usage-totals.ts`
- **Purpose:** Usage and cost aggregation for the footer and `/session`.
- **Key abstractions:** `UsageTotals`, `createUsageTotals`, `addUsageToTotals`, `combineUsage`, `getUsageCostBreakdown`.
- **Data flow:** session entries → grouped by `provider/responseModel` → sorted by cost, descending.
- **Non-obvious design decisions:**
  - `combineUsage` keeps the **optional** splits (`cacheWrite1h`, `reasoning`) only when *either* side reports them — a sum never invents a field.
  - `getUsageCostBreakdown` buckets tool results, branch summaries and compactions under **"Tools/summaries"**, separate from model-attributed usage.
  - It uses `responseModel ?? model` — the model that actually answered, not the one requested.

#### `packages/coding-agent/src/core/model-runtime.ts`
- **Purpose:** The single authority for providers, models, credentials and requests.
- **Key abstractions:** `ModelRuntime` (implements `Models`), `CreateModelRuntimeOptions`, `ModelRuntimeAuthOverrides`, `CredentialSynchronizationError`.
- **Data flow:** `create()` → `ModelConfig.load` + a `ModelsStore` + the builtin provider catalog → `composeModelProvider` per provider → a snapshot of all/available/auth → `stream`/`complete`/`classify`/`generateImages` → `prepareRequest` resolves the auth and headers.
- **Non-obvious design decisions:**
  - **Provider composition is layered**: builtin → `models.json` overlay → extension registration → `models.json` `modelOverrides` (the topmost user layer). `composeProvider` **returns the untouched builtin when there is no overlay**, with the comment "so its auth/login/stream behavior is exact".
  - A **composition error is captured, not thrown**: the provider falls back to the base and the error is recorded in `compositionErrors`, surfaced by `getError()`.
  - **Availability is a snapshot with sequence numbers.** `availabilityRefreshSeq` and `providerAvailabilitySeq` invalidate in-flight refreshes, so a slow refresh cannot overwrite a newer one. This is a classic stale-response guard.
  - **Credential operations are serialised per provider** (`credentialOperations` map) — a login and a logout cannot interleave.
  - `CredentialSynchronizationError` is a distinct error class for "the credential was committed but the local snapshot could not be synchronised" — a partial success that must not look like a total failure.
  - `markProvisionallyConfigured` marks a newly registered provider as configured **before** the async availability check lands, because "callers such as initial model selection read the snapshot before they finish".
  - `PI_OFFLINE=1` disables all model-network refreshes at construction.
  - `getProviderAuthStatus` distinguishes **runtime** (in-memory key), **stored** (auth.json), **environment**, **fallback** and **`models_json_key`/`models_json_command`** sources.
  - `mergeHeaders` deletes any existing header with the same name case-insensitively before setting the new one — no duplicate `Authorization`.
  - `streamSimple` on a **virtual model** resolves the route first, caps `maxTokens` to the routed model, and **drops the caller's credentials** when the route goes to a different provider ("so they are not sent to the wrong vendor").
- **Idea to steal:** sequence-numbered snapshot invalidation for async refreshes.

#### `packages/coding-agent/src/core/model-resolver.ts`
- **Purpose:** Resolving a model from a user-typed string, a scope pattern, or a session restore.
- **Key abstractions:** `resolveModelReference`, `resolveModelScopeFromModels`, `resolveCliModel`, `findInitialModel`, `restoreModelFromSession`, `defaultModelPerProvider`, `ModelReferenceResult` (`resolved` / `ambiguous` / `not-found`).
- **Data flow:** a pattern → candidates → a provider decision → a model (+ a thinking level) or an ambiguity report.
- **Non-obvious design decisions:**
  - **Candidates are collected before a provider is chosen**, so "catalog order never decides the provider" and an ambiguous match is *reported* rather than falling through to a weaker one.
  - The thinking suffix `:` is only parsed **when the full text matches no model**, because ids like OpenRouter's `qwen/qwen3-coder:exacto` contain colons. Three modes: `none`, `strict` (an invalid suffix stays part of the id), `lenient` (an invalid suffix is dropped with a warning).
  - `provider/rest` is treated as a **hint, not a rule** — the whole text may also be a model id on another provider. The named provider wins when it is usable; otherwise a sole usable raw match wins.
  - **Ambiguity is a first-class outcome** with the candidate list and a `usableCount`. The CLI error names every candidate as `provider/id` and says whether the ambiguity is because no provider is authenticated or more than one is.
  - `bestFuzzyMatch` prefers **aliases** (`claude-sonnet-4-5`) over dated versions (`claude-sonnet-4-5-20250929`) and then the latest id.
  - `findInitialModel` has a **four-step priority**: scoped models → the saved default (only if auth is configured) → the provider default table → the first available model.
  - `restoreModelFromSession` explains the fallback in words: *"model no longer exists"* vs *"no auth configured"*.
- **Idea to steal:** report an ambiguous model choice instead of picking one.

#### `packages/coding-agent/src/core/virtual-models.ts`
- **Purpose:** "Virtual models" — catalog entries that **route each request to a physical model** (a router/alias layer over the provider catalog).
- **Key abstractions:** `VirtualModelDefinition`, `ModelRouteRequest`, `ModelRoute`, `ModelRouteReason` (`user` / `continuation` / `retry` / `direct`), `createVirtualModel`, `withVirtualModels`, `getBranchSelection`, `getVirtualModelState`, `isVirtualModel`, `findLatestResponse`.
- **Data flow:** a selected virtual model → the router picks a physical model + thinking level → the request goes to that provider → the assistant message records the **physical** model.
- **Non-obvious design decisions:**
  - "Everything below the routing step only sees physical models: providers stream them and assistant messages record them. **A virtual model never reaches a provider.**"
  - The **route reason** is part of the contract: `user` (first request after a human message), `continuation` (after tool results), `retry` (after a failure, including a retry after compaction for a context overflow), `direct` (outside the agent loop).
  - A failed route **leaves the virtual model on the message** — the failure is visible rather than silently rewritten.
  - Router **state** is stored on the session branch as a `pi.virtual-model-state` custom entry, so a router can be a state machine that survives a restart.
  - `getBranchSelection` implements the subtle rule: a virtual `model_change` **holds** until the next `model_change` (because the responses name the physical models it routed to), but a virtual model that is no longer registered does **not** hold, so the selection falls back to the physical model that answered last.
  - A virtual model **hides a physical chat model with the same id**, and a provider that has only virtual models still needs no credentials.
- **Idea to steal:** a routing layer whose failures are visible in the transcript.

#### `packages/coding-agent/src/core/provider-composer.ts`
- **Purpose:** Composes the builtin provider, the `models.json` overlay and an extension registration into one `Provider`.
- **Key abstractions:** `composeModelProvider`, `validateExtensionProvider`, `ProviderConfigInput`, `ExtensionOAuthConfig`, `AuthStatus`, `applyModelOverride`, `configuredRequestAuthStatus`, `resolveConfiguredModelHeaders`.
- **Data flow:** three layers → `getAllModels()` (base → models.json → extension → OAuth `modifyModels` → `modelOverrides`) → a composed `Provider` with composed `auth`.
- **Non-obvious design decisions:**
  - **The layer order is documented in code**: "models.json modelOverrides are the topmost user-config layer: they apply once, after custom-model upserts, extension model replacement, and legacy OAuth projection."
  - **Nested merge objects are merged, not replaced**: `compat.openRouterRouting`, `vercelGatewayRouting`, `chatTemplateKwargs`, `chatTemplateArgs`, `inputLimits.images.resize` and `samplingParamsByThinkingLevel` are merged one level deep.
  - `getAllModels()` is called **eagerly** at compose time so structural errors surface immediately: "Validate eagerly so registration/reload reports structural errors immediately."
  - A provider that ends up with **no authentication method at all** throws `"no authentication method configured."`
  - An **OAuth-only provider gets no fabricated API-key login method** — pi does not invent an api-key path for a provider that only does OAuth.
  - The API-key `check` distinguishes the *source* of the key: "stored credential", "configured API key", "environment". An env-var key that is not set returns `undefined` (not configured).
  - `authHeader: true` turns the resolved key into `Authorization: Bearer …` and **throws** if no key could be resolved.
  - Extension OAuth callbacks are **adapted** into the canonical `OAuthLoginCallbacks` (auth URL, device code, text prompt, progress, manual code, select).
  - `refreshModels` **validates the new model list before publishing it**, and the publish is atomic via `context.publish({update, persist})`.
  - A transient catalog failure **keeps the etag** so the next refresh revalidates instead of re-downloading.
- **Idea to steal:** one explicit layer order, documented in the code, with eager validation.

#### `packages/coding-agent/src/core/remote-catalog-provider.ts`
- **Purpose:** Overlays a remotely refreshed model catalog onto a builtin provider.
- **Key abstractions:** `withRemoteCatalog`, `withPersonalizedCatalog`, `REMOTE_CATALOG_REFRESH_INTERVAL_MS` (4 hours), `REMOTE_CATALOG_MODEL_TYPES`, `PersonalizeCatalog`.
- **Data flow:** pi.dev `/api/models/providers/<id>?types=chat,image,classifier` → ETag-validated → stored in the models store → merged over the builtin list.
- **Non-obvious design decisions:**
  - A **304 keeps the cached body**: the validator is only sent when a cached body actually backs it, "so a 304 can never leave the overlay empty".
  - A **404 or 501 persists `lastModified: 0` and the etag is dropped**, so the next attempt is a full fetch rather than a permanently stuck revalidation.
  - A **transient failure keeps the etag** so the next refresh revalidates instead of downloading the whole catalog.
  - The refresh interval is 4 hours, and an entry **without** `lastModified` is always refetched.
  - `withPersonalizedCatalog` (used for OpenRouter) **replaces** the catalog with the personalised list and skips the interval and the etag revalidation — because the saved list is already the personalised one.
- **Idea to steal:** a 304 must never be able to empty the cached list.

#### `packages/coding-agent/src/core/resource-loader.ts`
- **Purpose:** The single place that discovers every resource — extensions, skills, prompt templates, themes, context files and the system prompt.
- **Key abstractions:** `DefaultResourceLoader`, `ResourceLoader` (the interface), `loadProjectContextFiles`, `DefaultResourceLoaderOptions`, `isBuiltinExtension`.
- **Data flow:** settings → the package manager resolves the enabled resources → each kind is loaded → the results are stored with a `SourceInfo` → `reload()` re-does all of it.
- **Non-obvious design decisions:**
  - **The project-trust pass is a separate load.** `loadProjectTrustExtensions()` forces `projectTrusted = false`, reloads the settings, and loads the *global and CLI* extensions only. The trust question is then asked with that pre-trust set, and only after the answer is the final set loaded. Built-in extensions wait for the final pass, because "a loaded extension cannot be unloaded".
  - **Replaceable extensions are omitted, not just warned about**: if a third-party MCP extension registers `/mcp`, the built-in MCP extension is *not loaded*, and the warning names the exact command to fix it.
  - **Extension conflicts are reported, not resolved**: "Keep all extensions loaded. Conflicts are reported as diagnostics, and precedence is handled by load order." (tools and flags; commands are not conflict-checked here).
  - **Host-provided packages must be `peerDependencies` with a `*` range, not `dependencies`** — otherwise an installed copy bypasses the extension loader and creates duplicate runtime modules. The warning is explicit.
  - `findShadowedContextFile` handles the **git worktree** case: a linked worktree's own `AGENTS.md` shadows the main repo's, and loading both would apply the same context twice. It compares **canonicalised (realpath)** paths because `git worktree add` writes realpath forms.
  - Context files are discovered by walking **up** the tree, and the global agent-dir file is loaded first, then the ancestors from the root down.
  - `dedupePrompts` / `dedupeThemes` produce **collision diagnostics** naming the winner and the loser.
  - The project `SYSTEM.md` / `APPEND_SYSTEM.md` are only used when the project is **trusted**.
  - Every "path does not exist" case becomes an **error diagnostic**, not an exception.
- **Idea to steal:** a two-pass load — untrusted first, then trusted — so a trust prompt can be answered before any project code runs.

#### `packages/coding-agent/src/core/sdk.ts`
- **Purpose:** The public SDK entry: `createAgentSession(options)`.
- **Key abstractions:** `CreateAgentSessionOptions`, `CreateAgentSessionResult`, plus re-exports of the tool factories and the extension types.
- **Data flow:** options → a `ModelRuntime`, a `SettingsManager`, a `SessionManager` and a `ResourceLoader` → model/thinking/tool resolution → an `Agent` → an `AgentSession`.
- **Non-obvious design decisions:**
  - **The tool list has three modifiers**: an allowlist (`tools`), a denylist (`excludeTools`), and a `+name`/`-name` modifier list that *adds to or removes from the defaults* instead of replacing them. A list of only modifiers is not an allowlist; mixing modifiers with plain entries throws.
  - **`blockImages` is enforced in `convertToLlm`**, replacing each image with the text "Image reading is disabled." and **de-duplicating consecutive** placeholders. The setting is read per call, so a mid-session change takes effect.
  - The **cache-warmer context check compares message identity**, not the model object: "Agent state may shallow-copy the messages array or refresh the model object without changing the provider request, so top-level object identity is not a valid cache key."
  - Warming is started **only for requests whose `sessionId` matches the session**, because compaction and summaries use their own routing ids.
  - `buildRequestOptions` reads the retry/timeout settings **per request**, and installs a `transformHeaders` hook so extensions can rewrite the provider headers.
  - A new session **records the initial model and thinking level** so a resume restores them; an old session missing the thinking entry gets one appended.
  - `setDefaultStreamFn(streamSimple)` preserves the pre-0.81 fallback for extensions that construct their own `Agent`.

#### `packages/coding-agent/src/core/footer-data-provider.ts`
- **Purpose:** Supplies the footer's live data — the git branch and the extensions' status texts.
- **Key abstractions:** `FooterDataProvider`, `findGitPaths`, `ReadonlyFooterDataProvider`, `GitPaths`.
- **Data flow:** cwd → `.git` discovery (directory **or** `gitdir:` file for worktrees) → a watcher on the HEAD directory → a debounced refresh → branch change callbacks.
- **Non-obvious design decisions:**
  - **The watcher watches the *directory* containing HEAD, not HEAD itself**: "Git uses atomic writes (write temp, rename over HEAD), which changes the inode. `fs.watch` on a file stops working after the inode changes."
  - **Reftable repos are handled separately** — branch switches update files in the reftable directory instead of HEAD, so that directory and `tables.list` get their own watchers.
  - **WSL on a Windows-mounted path polls `HEAD` instead of watching it** (`shouldPollGitHead`), because inotify does not fire reliably for `/mnt/c`.
  - The branch is read **from the HEAD file** (fast, no subprocess); git itself is only invoked for the `.invalid` (worktree) case.
  - A watcher error **clears the watchers and schedules a retry** (`FS_WATCH_RETRY_DELAY_MS`) instead of throwing.
  - A refresh that arrives while one is in flight sets `refreshPending` and is coalesced into a single follow-up.

#### `packages/coding-agent/src/config.ts`
- **Purpose:** The app's path/name/identity constants and its install-method detection.
- **Key abstractions:** `APP_NAME`, `APP_TITLE`, `CONFIG_DIR_NAME`, `VERSION`, `ENV_AGENT_DIR`, `ENV_SESSION_DIR`, `getAgentDir`, `getPackageDir`, `detectInstallMethod`, `getSelfUpdateCommand`, `getQuickJSWasmPath`, `getCodemodeWorkerSpecifier`, `detectInstallChange`, `getThemesDir`, `getExportTemplateDir`, `getDocsPath`.
- **Data flow:** `package.json` → `piConfig {name, configDir}` → the app name, title and config dir; env overrides → the agent dir.
- **Non-obvious design decisions:**
  - **The app can be rebranded from `package.json`** (`piConfig.name`, `piConfig.configDir`). The env var names are derived from the app name (`PI_CODING_AGENT_DIR`), so a fork gets its own namespace.
  - `getPackageDir` **walks up to the package root**, and if it finds `dist/` with a parent `package.json` it returns the *parent* — "Node still needs the package root so its dist-relative asset paths do not become dist/dist/."
  - The self-update command is **only offered when the install is actually managed by a global package manager AND the path is writable**. Otherwise the user gets an instruction, not a command.
  - The self-update commands always pass `--ignore-scripts` — pi never runs an install script.
  - `detectInstallChange` re-reads the **startup** `package.json` path, not a freshly resolved one: "Resolving it again would walk up past a deleted install and could find an unrelated package.json, such as one in the home directory."
  - `getCodemodeWorkerSpecifier` spawns the worker from an **in-memory `data:` URL** for the bundled-Node release, because "an update replaces or deletes the file while this process keeps running."
- **Idea to steal:** the `data:`-URL trick for a worker that an update might delete under you.

#### `packages/coding-agent/src/core/resolve-config-value.ts`
- **Purpose:** Resolves a config value that may be a literal, an env var, or a shell command.
- **Key abstractions:** `resolveConfigValue`, `resolveConfigValueOrThrow`, `resolveHeaders`, `resolveHeadersOrThrow`, `isCommandConfigValue`, `isConfigValueConfigured`, `getConfigValueEnvVarNames`, `clearConfigValueCache`.
- **Data flow:** a config string → parsed into a *reference* (`{type:"command"}` or `{type:"template", parts}`) → resolved at request time.
- **Non-obvious design decisions:**
  - **Three syntaxes in one string**: a literal, `$NAME`/`${NAME}` interpolation, and `!command` whose stdout is the value. `$$` escapes a literal `$` and `$!` escapes a literal `!`.
  - A template with **any missing env var resolves to `undefined`**, not a partial string.
  - The **command result is cached for the process lifetime** (`commandResultCache`), and `resolveConfigValueUncached` exists for the paths that must not cache.
  - The shell command runs through the **configured shell** (with the command piped on stdin for some shells) and only falls back to the default shell on Windows when the configured shell does not exist.
  - `resolveConfigValueOrThrow` names the **missing env vars** in the error ("Failed to resolve API key for provider \"x\" from environment variables: A, B").
- **Idea to steal:** a config value that can be a literal, an env var, or a command — with the *source* reported in the auth status.

#### `packages/coding-agent/src/core/runtime-credentials.ts`
- **Purpose:** A non-persistent overlay for in-memory API keys.
- **Key abstractions:** `RuntimeCredentials` (a `CredentialStore` wrapper).
- **Data flow:** `setRuntimeApiKey` → the override map → `read` returns the override, else the underlying store.
- **Non-obvious design decisions:** `list()` merges the overrides with the stored credentials, so an in-memory key still shows as "configured" — but the **source** is reported separately by `ModelRuntime.getProviderAuthStatus` as `"runtime"`.

#### `packages/coding-agent/src/core/session-manager.ts`
- **Purpose:** The session store: an **append-only tree of JSONL entries** on disk.
- **Key abstractions:** `SessionManager` (plus the static factories `create`, `open`, `continueRecent`, `inMemory`, `forkFrom`, `findById`, `list`, `listAll`), `SessionEntry` (11 entry types), `buildSessionProjection`, `buildContextEntries`, `sessionEntryToContextMessages`, `SessionProjection`, `SessionInfo`, `CURRENT_SESSION_VERSION = 3`.
- **Data flow:** append → a `SessionEntry {id, parentId, timestamp, …}` → an in-memory index → `appendFileSync` one JSON line per entry. Reading walks the **parent chain** from the leaf to the root.
- **Non-obvious design decisions:**
  - **The session is a tree, not a list.** `branch(id)` moves the leaf pointer; the next append creates a sibling. History is never modified or deleted.
  - **The file is created lazily**: `_persist` writes the file only once the session contains a **user or assistant message**. "Setup entries alone (model, thinking level, system prompt) stay in memory so opening and closing pi without chatting leaves no file behind." The file is created with `openSync(path, "wx")` — exclusive create, so two processes cannot both claim it.
  - **Versioned migrations** run on load: v1→v2 adds the id/parentId tree and converts `firstKeptEntryIndex` → `firstKeptEntryId`; v2→v3 renames the `hookMessage` role to `custom`. A migrated file is rewritten.
  - **Malformed lines are skipped, not fatal.** But a file whose first entry is not a valid session header is **rejected without modification** ("Session file is not a valid pi session").
  - The header scan is **bounded** (`MAX_SESSION_HEADER_SCAN_BYTES = 1 MB`) so a hostile or huge file cannot stall discovery; the bound is a *discovery optimisation only* — a full load remains authoritative.
  - `buildSessionProjection` is the **canonical** context builder: it resolves the compaction boundary, applies `context_edit` entries, and produces a list of `{sourceEntry, messages}` — so the transcript (provenance) and the model context (projection) are separate.
  - `context_edit` is an **append-only** branch-local edit of an earlier entry's content, validated to be on the active branch and of an editable role.
  - **`appendCompaction` stores the current system message** with the compaction, so the replayed prompt at that boundary is reproducible.
  - `createBranchedSession` **re-chains the retained path** when it drops label entries, so removing a label cannot orphan a subtree.
  - `getSessionStats` aggregates over **all** session entries, including compacted-away history, "so token/cost totals reflect what was actually billed across the session."
  - The session directory name encodes the cwd: `--C--Dev--project--`.
  - Discovery is **bounded-concurrency** (10 for reading session info, 64 for directory scans) and **progress-aware** (partial results published every 10 / 100 files).
- **Idea to steal:** an append-only tree store where the transcript and the model context are two different projections of the same log.

#### `packages/coding-agent/src/core/settings-manager.ts`
- **Purpose:** The settings store: a **global** `~/.pi/agent/settings.json` and a **project** `.pi/settings.json`, merged.
- **Key abstractions:** `SettingsManager`, `FileSettingsStorage`, `InMemorySettingsStorage`, `getToolListError`, `applyToolModifiers`, `DEFAULT_TOOL_NAMES`, `mergeDefaultTools`.
- **Data flow:** two files → parse → migrate → `deepMergeSettings(global, project)` → the effective `Settings`; writes go through a **write queue** and a **file lock**, and only the fields modified in this session are written back.
- **Non-obvious design decisions:**
  - **Two scopes with a different trust rule.** The project scope is only read at all when `projectTrusted` is true, and `setProjectTrusted(false)` **wipes the in-memory project settings** and re-merges. A project write without trust **throws**.
  - **Only modified fields are written back.** `modifiedFields` / `modifiedNestedFields` track what changed, and `persistScopedSettings` merges *only those* into the file — so a second pi process's changes to other fields are not clobbered.
  - **Nested settings merge key-by-key**, so changing `terminal.showImages` does not overwrite `terminal.imageWidthCells`.
  - **Settings migrations** run on every load: `queueMode → steeringMode`, the `websockets` boolean → the `transport` enum, the old `skills` object → an array, `retry.maxDelayMs → retry.provider.maxRetryDelayMs`.
  - The `defaultTools` list has **two shapes**: plain names *replace* the inherited selection; a list of only `+name`/`-name` *modifies* it. Mixing the two is an error, and a `+name` entry with a `*` is an error.
  - `getCacheWarmingMode()` reads the **global settings only** — "Read from global settings only because warming costs money."
  - `getOrCreateDeviceId()` reads the **global** settings only, "so a committed project settings file cannot give every clone the same ID."
  - `setEnableAnalytics(true)` **generates a tracking id on first opt-in**.
  - A malformed `settings.json` does **not** stop pi: the load error is recorded and surfaced as a diagnostic, and the file is **not overwritten** (`save()` returns early when `globalSettingsLoadError` is set).
  - `drainErrors()` hands the accumulated errors to the runtime diagnostic collector exactly once.
- **Idea to steal:** write back only the fields that changed, so two processes can share a settings file.

#### `packages/coding-agent/src/core/extensions/loader.ts`
- **Purpose:** Loads TypeScript extension modules and gives each one an API object.
- **Key abstractions:** `createExtensionRuntime`, `loadExtensions`, `loadExtensionsCached`, `loadExtensionFromFactory`, `discoverAndLoadExtensions`, `clearExtensionCache`.
- **Data flow:** a path → `jiti.import(path)` → a factory function → the factory is called with an `ExtensionAPI` → registrations land on the `Extension` object.
- **Non-obvious design decisions:**
  - **The runtime starts as throwing stubs.** `createExtensionRuntime()` returns a runtime whose action methods throw "Extension runtime not initialized. Action methods cannot be called during extension loading." `Runner.bindCore()` replaces them with the real ones later. This is what makes "register during load, act after bind" safe.
  - **A failed extension's API is dead**: `load.discard()` sets the state to `failed`, and every later call throws `Extension "x" failed to load and its API is no longer active.`
  - **The API is transactional during load**: `pendingFlagValues` and `pendingRuntimeChanges` are buffered and only flushed by `commit()`.
  - **The runtime goes stale on session replacement**: `invalidate(message)` unsubscribes every event-bus subscription and makes every captured context throw. The message names the exact calls that invalidate it (`ctx.newSession()`, `ctx.fork()`, `ctx.switchSession()`, `ctx.reload()`).
  - **Three module-resolution strategies**: embedded virtual modules (Bun binary / SEA / bundled Node), `virtualModules` + `tsconfigPaths` (TypeScript source runtime), or `alias` (unbundled Node dist). The choice is explicit per runtime.
  - `moduleCache: false` — jiti does not cache modules; pi caches the **factory** itself, keyed by a `(cwd, generation)` token that is invalidated when the cwd changes or the cache is cleared.
  - **Discovery is one level deep**: a `*.ts`/`*.js` file, a directory with `index.ts`, or a directory with a `package.json` `pi` manifest.
  - MCP server names are checked for a **namespace clash** (`-` vs `_` would share a namespace) and a server already owned by another extension is refused.
  - `registerTool` requires an **object** parameter schema — an array or a primitive throws.
  - A flag's `default` must match the declared type, or it throws.
- **Idea to steal:** a runtime whose action methods throw until the host binds them, so a plugin cannot act before it is ready.

#### `packages/coding-agent/src/core/extensions/runner.ts`
- **Purpose:** The event dispatcher: it owns the extension lifecycle, the handler registry and every emit.
- **Key abstractions:** `ExtensionRunner` (`emit`, `emitToolCall`, `emitToolResult`, `emitMessageEnd`, `emitContext`, `emitBoundary`, `emitBeforeAgentStart`, `emitInput`, `emitCacheWarmingDecision`, `emitResourcesDiscover`, `createContext`, `createToolContext`, `createCommandContext`), `emitProjectTrustEvent`, `emitSessionShutdownEvent`.
- **Data flow:** an event → `snapshotEventHandlers` (a snapshot, so a handler registering a handler does not affect the current dispatch) → each handler in load order → the result is merged.
- **Non-obvious design decisions:**
  - **Handler errors never break the run.** Every `emit*` catches, reports through `emitError` (with the extension path, the event name, the message and the stack) and continues.
  - **`tool_call` is the one exception**: a `tool_call` handler that throws **blocks the tool** ("Extension failed, blocking execution"). A blocked call returns `{block: true}` and the pipeline stops.
  - **`message_end` handlers must return the same role**; a different role is reported as an error and ignored.
  - **`tool_result` handlers compose**: content, details, structuredContent, isError and usage are each replaced independently, and if the content is replaced but the structured content is not, the structured content is **deleted** ("Structured content that is not replaced along with the content may no longer match it.").
  - **The `context` event runs in two phases.** `context` handlers see the **conversation only** (the system messages are hidden) and pi restores the prompt afterwards, so "models with mid-conversation support keep their cached prefix". `context_with_system` handlers see the full transcript and their output is used as returned — but if the handler **removes the leading system message**, pi reports an error explaining the request would have no prompt or tool declarations.
  - `restoreSystemMessages` keeps the system message in place when the conversation is unchanged, and otherwise prepends `getCurrentSystemMessage(current)` — "A changed one gets the replayed prompt sections and tool declarations as one leading system message, so pruning, windowing, or slicing from a compaction summary cannot drop them."
  - **`project_trust` is first-refusal**: the first handler that returns yes/no wins; `"undecided"` falls through to the next handler.
  - **Shortcut conflicts are classified**: a *reserved* built-in keybinding cannot be overridden (the extension shortcut is skipped with a diagnostic); a non-reserved one is overridden with a warning. The reserved list is explicit and only covers editor-global keys.
  - **Duplicate command names are disambiguated** as `name:2`, `name:3` rather than silently shadowing each other.
  - `emitInput` **chains transforms** and short-circuits on `"handled"`.
  - `emitBoundary` lets a handler **append session entries** (custom, custom_message, context_edit, compaction) and then rebuilds the context preview; an invalid draft makes the boundary invalid and the run stops.
  - `withUIPrompt` tracks a **depth counter** so a nested prompt does not emit a second `ui_prompt_start`.
  - The context object's properties are **getters**, so a value is resolved at call time and a stale context throws on access.
- **Idea to steal:** the two-phase context hook (conversation-only, then full-transcript) so a plugin that prunes history cannot accidentally drop the system prompt.

#### `packages/coding-agent/src/core/extensions/index.ts`
- **Purpose:** The public extension barrel.
- **Non-obvious design decisions:** it exports **only types** plus `defineTool`, the tool-result type guards, and the tool wrappers. The extension API is deliberately a *type surface* — everything an extension can do is visible in one import.

#### `packages/coding-agent/src/core/extensions/virtual-modules.ts`
- **Purpose:** The modules an extension may import, mapped to the host's own instances.
- **Non-obvious design decisions:** **the host's module instance is shared**, so an extension gets the *same* `typebox` and the same `pi-tui` classes as the host — no duplicate class identities. The `pi-ai` root is aliased to the `compat` entrypoint ("a strict superset of the core entrypoint") so old extensions keep working.

#### `packages/coding-agent/src/core/extensions/wrapper.ts`, `packages/coding-agent/src/core/extensions/jiti-loader.ts`, `packages/coding-agent/src/core/extensions/jiti-static-loader.ts`
- **Purpose:** (wrapper) adapt a `RegisteredTool` into an `AgentTool`; (jiti loaders) pick jiti's lazy or static transform depending on the runtime.
- **Non-obvious design decisions:** the static jiti entry is used only for compiled binaries, "so Bun and SEA bundlers embed the Babel transform. The module itself remains lazy until an extension is loaded."

#### `packages/coding-agent/src/core/bug-report.ts`
- **Purpose:** Builds and redacts a bug report: metadata, diagnostics, an optional transcript, and an optional model-written summary.
- **Key abstractions:** `collectBugReportMetadata`, `collectBugReportDiagnostics`, `bugReportFiles`, `writeBugReportArchive`, `generateBugReportSummary`, `redactUrl`, `redactJsonValue`, `BugReportBundle`.
- **Data flow:** the session entries + the runtime → a metadata object + a diagnostics object → the four files of the bundle (`report.json`, `diagnostics.json`, `session.jsonl`, `summary.md`) → a zip or an upload.
- **Non-obvious design decisions:**
  - **Redaction is a key-name rule, not a value rule**: `SENSITIVE_KEY` matches `api_key`, `secret`, `token`, `password`, `credential`, `authorization`, `cookie` (with camelCase normalised to snake_case first), and every matching JSON value becomes `<redacted>`.
  - **URLs are redacted too** — userinfo is stripped and secret-looking query parameters are replaced, with a nested `scheme://` prefix handled.
  - The environment block records **the names** of the `PI_*` variables, never their values ("Names help diagnose configuration; values never leave the machine").
  - `trackingId` and `deviceId` are **dropped** from the settings snapshot entirely.
  - The diagnostics collect **only failed assistant turns** — never conversation content — so a user can share the diagnosis without sharing the transcript.
  - The model-written summary uses the **same summarisation pipeline** as compaction (`completeSummarization`), with a prompt that says "Do not include file contents, secrets, or credentials from the transcript; refer to files by path only."
  - When the transcript is *not* shared, the summary is generated from the **last 60 % of the context window** of messages, and the prompt says "only the last N of the M messages are shown."

#### `packages/coding-agent/src/core/slash-commands.ts`
- **Purpose:** The list of built-in slash commands.
- **Key abstractions:** `BUILTIN_SLASH_COMMANDS` (23 entries with a name, a description and an optional `argumentHint`), `SlashCommandInfo`, `SlashCommandSource` (`extension | prompt | skill`).
- **Non-obvious design decisions:** the list is a **plain data table**, so the help, the RPC `get_commands` response and the TUI's command palette all read the same source. Extension, prompt-template and skill commands are the *other* three sources, and all four are surfaced together.

#### `packages/coding-agent/src/core/compaction/index.ts`
- **Purpose:** The compaction barrel — re-exports `branch-summarization.ts`, `compaction.ts` and `utils.ts`.
- **Non-obvious design decisions:** a three-line `export *` barrel, so `core/compaction/compaction.ts` can import its own helpers without a circular path and the SDK can import the whole compaction surface from one place.

#### `packages/coding-agent/src/core/agent-session.ts` *(164 KB / 4458 lines — read head 1-1000 and tail 4159-4458; the middle was not read line by line)*
- **Purpose:** The core abstraction shared by every run mode: agent state, event subscription with automatic persistence, model/thinking management, compaction, bash, session switching and branching.
- **Key abstractions:** `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent` (the full event union), `PromptOptions`, `SessionStats`, `parseSkillBlock`, `ContextUsage`.
- **Data flow:** an agent event → `_handleAgentEvent` → a session entry appended to the `SessionManager` → an `entry_appended` event emitted to the UI; a user prompt → `prompt()` → steering/follow-up queuing → the agent run.
- **Non-obvious design decisions:**
  - The event union **names the compaction reason** (`"manual" | "threshold" | "overflow"`) and the retry lifecycle (`auto_retry_start` / `auto_retry_end`, `summarization_retry_scheduled` / `_attempt_start` / `_finished`). The UI can therefore distinguish "the user asked" from "the context filled up" from "the provider failed".
  - `agent_end` carries `willRetry` — a turn that failed but will be retried is **not** an error to the user.
  - **Auto-compaction runs in `prepareNextTurnWithContext`**, before the next assistant response, and again if a virtual-model route turns out to exceed the threshold. It never compacts mid-turn.
  - **The `context_edit` mechanism is the branch-local "edit what you said"** — the edit is appended, so the transcript keeps the original and the projection applies the edit.
  - **`_failedResponse` is carried into the retry** and handed to the virtual-model router as `failed`, because "the context no longer contains it".
  - The tool hooks are installed **once on the Agent**, and the callbacks read `this._extensionRunner` at execution time — so an extension reload swaps the runner in without reinstalling the hooks.
  - **The tool-result image normalisation runs *after* the extension hook**, so an image an extension injected is normalised too.
  - `getContextUsage()` returns **`tokens: null`** when there is no assistant usage *after* the latest compaction — "context token count is unknown until the next LLM response" — rather than reporting a stale number.
  - `getSessionStats()` aggregates over **all** entries, including compacted-away history, so the cost matches the bill.
  - The system prompt and `ctx.getSystemPrompt()` are kept **in step with what the provider sees** by rebuilding them in `prepareNextTurnWithContext`.
- **Idea to steal:** a context-usage figure that is honestly `null` when it is not knowable.

#### `packages/coding-agent/src/core/tools/truncate.ts`
- **Purpose:** The shared truncation policy for every tool's output.
- **Key abstractions:** `DEFAULT_MAX_LINES = 2000`, `DEFAULT_MAX_BYTES = 50 * 1024`, `GREP_MAX_LINE_LENGTH = 500`, `truncateHead`, `truncateTail`, `truncateMiddle`, `truncateLine`, `formatSize`, `TruncationResult`.
- **Non-obvious design decisions:**
  - **Two independent limits** — 2000 lines *and* 50 KB — and the result records **which one was hit** (`truncatedBy: "lines" | "bytes"`).
  - **Head truncation for files, tail truncation for command output.** Tail is the right end for errors; head is the right end for source.
  - **Never returns a partial line** — except the documented tail edge case, which is flagged with `lastLinePartial`.
  - If the **first line alone** exceeds the byte limit, the content is empty and `firstLineExceedsLimit` is set.
  - `truncateMiddle` keeps the **head and the tail** around a `…N chars truncated…` marker (the Codex pattern) and cuts only at **UTF-8 character boundaries**.
  - `truncateStringToBytesFromEnd` walks back over **continuation bytes** so a multi-byte character is never cut in half.
- **Idea to steal:** report *which* limit was hit, and offer the continuation offset in the text.

#### `packages/coding-agent/src/core/tools/output-accumulator.ts`
- **Purpose:** Bounded-memory accumulation of streaming tool output.
- **Key abstractions:** `OutputAccumulator` (`append`, `finish`, `snapshot`, `readFullOutput`, `closeTempFile`), `OutputSnapshot`, `FullOutput`.
- **Data flow:** raw `Buffer` chunks → a streaming UTF-8 decoder → a rolling tail + a line/byte counter → a snapshot on demand; the full output spills to a temp file once it exceeds the limits.
- **Non-obvious design decisions:**
  - The rolling tail is trimmed **at UTF-8 boundaries** and remembers whether it starts at a **line boundary**, so a snapshot never begins mid-line.
  - The temp file is opened **as soon as the limits are exceeded**, and the already-buffered chunks are flushed into it.
  - `readFullOutput` reads the **head and the tail** of the file around an explicit `[... N bytes omitted ...]` marker, again on character boundaries.
- **Idea to steal:** spill to a file *while* streaming, not after the fact.

#### `packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`
- **Purpose:** The one adapter between a `ToolDefinition` and the agent core's `AgentTool`.
- **Non-obvious design decisions:** `createToolDefinitionFromAgentTool` **synthesises** a minimal definition from a plain `AgentTool`, "so AgentSession's internal registry [stays] definition-first even when a caller provides plain AgentTool overrides". One registry shape, always.

#### `packages/coding-agent/src/core/tools/file-mutation-queue.ts`
- **Purpose:** Serialises mutations of the **same file** while letting different files proceed in parallel.
- **Key abstractions:** `withFileMutationQueue(filePath, fn)`.
- **Data flow:** path → `realpath` (or the resolved path when the file does not exist) → a per-key promise chain → the operation → release.
- **Non-obvious design decisions:**
  - The key is the **realpath**, so two different spellings of the same file cannot race. A missing file falls back to the resolved path.
  - The **registration itself is serialised** through a global `registrationQueue`, so the map is never mutated concurrently.
  - The map entry is **deleted when the last holder releases it** — the queue does not leak keys.

#### `packages/coding-agent/src/core/tools/path-utils.ts`
- **Purpose:** Path resolution, including the macOS filename shapes that break naive lookups.
- **Key abstractions:** `resolveReadPath`, `resolveReadPathAsync`, `resolveToCwd`, `expandPath`, `pathExists`.
- **Non-obvious design decisions:** when the exact path does not exist, it tries **four variants**: the macOS narrow-no-break-space before AM/PM, the **NFD** (decomposed) form, the **curly apostrophe** form, and the combined NFD+curly form. "Users typically type U+0027 (straight apostrophe)" but macOS stores U+2019.

#### `packages/coding-agent/src/core/tools/read.ts`
- **Purpose:** The `read` tool.
- **Key abstractions:** `createReadToolDefinition`, `ReadOperations` (pluggable file access), `readToolSystemPromptContribution`, `readOutputSchema`.
- **Non-obvious design decisions:**
  - The tool declares its own **prompt contribution** — a `promptSnippet` ("Read file contents") and `promptGuidelines` ("Use read to examine files instead of cat or sed."). The system prompt is *composed from the tools*, not written by hand.
  - The description states the **truncation limits** and tells the model to continue with `offset`.
  - **Truncation produces an actionable continuation notice**: "[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]" — and a separate notice when the user's own `limit` stopped early.
  - If the first line alone exceeds the byte limit, the tool **points the model at a bash fallback**: "Use bash: sed -n '1p' <path> | head -c 51200".
  - A model that **cannot see images** gets an explicit note appended to the image block.
  - `constrainedSampling: {type: "json_schema", strict: "prefer"}`.
- **Idea to steal:** the truncation notice that tells the model exactly how to continue.

#### `packages/coding-agent/src/core/tools/write.ts` / `edit.ts`
- **Purpose:** The `write` and `edit` tools.
- **Key abstractions:** `createWriteToolDefinition`, `createEditToolDefinition`, `WriteOperations`, `EditOperations`, `EditToolDetails {diff, patch, firstChangedLine}`.
- **Non-obvious design decisions:**
  - **The abort is checked *after* each await, never from an abort listener** — "that would release the mutation queue while an in-flight filesystem operation may still finish."
  - `edit` matches **every** `oldText` against the **original** file, not incrementally, and overlapping edits are refused.
  - `prepareEditArguments` **repairs malformed model output**: some models send `edits` as a JSON *string*, or as a single edit object; both are normalised. A legacy `oldText`/`newText` pair is folded into the `edits` array.
  - `edit` **strips the BOM before matching** ("The model will not include an invisible BOM in oldText") and **restores the original line endings** afterwards.
  - The result carries a **display diff, a unified patch and the first changed line** — enough for a renderer to show the change and for an editor to jump to it.
  - Both tools declare a `promptSnippet` and `promptGuidelines` so the system prompt teaches their use.
- **Idea to steal:** repair the model's malformed tool arguments instead of failing the turn.

#### `packages/coding-agent/src/core/tools/index.ts`
- **Purpose:** The tool registry: eight built-in tools, each with a `create…ToolDefinition` and a `create…Tool` factory.
- **Key abstractions:** `ToolName` (`read|bash|powershell|edit|write|grep|find|ls`), `allToolNames`, `createToolDefinition`, `createTool`, `createAllToolDefinitions`, `createCodingToolDefinitions` (read, bash, edit, write), `createReadOnlyToolDefinitions` (read, grep, find, ls).
- **Non-obvious design decisions:** the **default tool set is `read, bash, edit, write`**; the read-only set is a named alternative. `grep`, `find` and `ls` are **off by default** — the model is told to use the shell instead.

#### `packages/coding-agent/src/core/tools/bash.ts`
- **Purpose:** The `bash` tool — and, through `createShellToolDefinition`, the `powershell` tool too.
- **Key abstractions:** `createShellToolDefinition(cwd, config, options)`, `BashOperations` (a pluggable exec backend), `BashSpawnHook`, `ShellToolConfig`, `bashOutputSchema` (the structured output for programmatic callers).
- **Data flow:** the model's `command` → the spawn hook → `spawn(shell, args)` → stdout/stderr chunks → an `OutputAccumulator` → a throttled `onUpdate` stream → a truncated snapshot + a `structuredContent` result.
- **Non-obvious design decisions:**
  - **The model-facing output and the programmatic output are different.** The model sees the truncated tail; a codemode script gets `structuredContent.output` with up to **1 MB**, plus `exit_code` and `wall_time_seconds`.
  - **The abort kills the whole process tree** (`killProcessTree`), and a signal-killed shell reports **128 + signal number** so it is not mistaken for success.
  - **The `PI_*` session environment variables are removed by default** and only re-added when `exposeSessionEnvironment` is on — the session id, file, provider, model and reasoning level are *not* leaked into every shell command unless asked for.
  - **A timeout is optional** (no default) and is reported as a distinct error: "Command timed out after N seconds".
  - **Output updates are throttled to 100 ms** with a dirty flag, so a chatty command does not flood the UI.
  - The truncated output carries an **actionable notice** naming the line range and the temp file path.
  - `spawn` uses `detached: true` on non-Windows so the process tree can be killed as a unit.
- **Idea to steal:** separate the human/model-facing output from the programmatic output, and never leak session metadata into a subprocess by default.

#### `packages/coding-agent/src/core/tools/grep.ts`
- **Purpose:** The `grep` tool — content search via ripgrep.
- **Key abstractions:** `createGrepToolDefinition`, `GrepOperations`, `grepSchema` (`pattern`, `path`, `glob`, `ignoreCase`, `literal`, `context`, `limit`).
- **Data flow:** `ensureTool("rg")` → `rg --no-config --json --line-number --color=never --hidden …` → the JSON stream is parsed for `type: "match"` events → matches are collected → after the child exits, each match is formatted with its context lines.
- **Non-obvious design decisions:**
  - **`--no-config` is mandatory**: "the tool contract (literal, glob, limit, …) must not depend on ambient user config like `RIPGREP_CONFIG_PATH`."
  - **The match limit kills the child** (`stopChild(true)`) rather than letting ripgrep finish, and the result says so: "100 matches limit reached. Use limit=200 for more, or refine pattern".
  - **Long lines are truncated to 500 chars** with a notice that points at the `read` tool for the full line.
  - The `context` lines are formatted with the **`-` separator** convention (`file-line- text`) so a match is visually distinct from its context.
  - The **file contents are cached** per file for the context lines.
  - The tool is **off by default** (not in `DEFAULT_TOOL_NAMES`).
- **Idea to steal:** `--no-config` style isolation so a user's ambient tool config cannot change a tool's contract.

#### `packages/coding-agent/src/core/tools/ls.ts`
- **Purpose:** The `ls` tool.
- **Key abstractions:** `createLsToolDefinition`, `LsOperations`, `lsSchema` (`path`, `limit`, default 500).
- **Non-obvious design decisions:** entries are sorted **case-insensitively**, directories get a `/` suffix, dotfiles are included, and an entry that cannot be stat'ed is **skipped** rather than reported. The limit notice tells the model exactly how to ask for more.

#### `packages/coding-agent/src/core/tools/powershell.ts`
- **Purpose:** The `powershell` tool for Windows.
- **Non-obvious design decisions:** it is the **same tool implementation** with a different `ShellToolConfig` and a **UTF-8 output prefix** (`[Console]::OutputEncoding=[System.Text.Encoding]::UTF8`) prepended to every command, wrapped in try/catch so a failure does not break the command. One shell tool implementation, two configurations.

#### `packages/coding-agent/src/extensions/tool-search/tool.ts`
- **Purpose:** BM25 **tool discovery** — the model searches for tools that are not declared to it, and the matches are activated for the next call.
- **Key abstractions:** `Bm25Ranker`, `tokenize`, `createToolSearchDocument`, `ToolSearchDocument`, `ToolRanker`, `TOOL_SEARCH_DESCRIPTION`.
- **Data flow:** a query → tokenised (camelCase split, stop words removed, naive stemming) → BM25 over each tool's search document → the top N matches are **activated** (`setActiveTools`) → the next model call declares them.
- **Non-obvious design decisions:**
  - **The search document is built from the tool's own metadata**: the name, the name with `_` as spaces, the description, every schema property name and description (recursively, including `anyOf`/`oneOf`/`allOf` variants), and the namespace's description and instructions.
  - **The tool's own description is deliberately static** — it does *not* list the searchable tools, "so it stays the same while tools are registered, for example when MCP servers connect."
  - Loading goes through the **active tool set**, so it is recorded in the transcript "like any other tool change and survives `/tree`, resume, and fork on that branch."
  - The ranker is behind a `ToolRanker` interface: "BM25 today; a hybrid ranker with embeddings can replace it."
  - The tool is `exposure: "model-only"` — a script must not change what the model sees.
- **Idea to steal:** BM25 over *tool metadata* to keep the model's tool declarations small, with activation recorded in the transcript.

#### `packages/coding-agent/src/core/mcp-servers.ts`
- **Purpose:** The MCP server configuration contract and the registry extensions register into.
- **Key abstractions:** `McpServerConfig` (stdio | http), `McpExposure` (`codemode | deferred | direct | hidden`), `McpServerRegistry`, `validateMcpServerConfig`, `createToolNameMatcher`, `isMcpToolName`, `mcpNamespace`, `getMcpToolExposure`.
- **Data flow:** a config object → validation (returns the config **or an error string**) → the registry → the MCP extension connects it.
- **Non-obvious design decisions:**
  - **The exposure model is the interesting part.** `direct` = declared to the model; `deferred` = declared only after `tool_search` loads it; `codemode` = callable only from a script; `hidden` = registered but unreachable. The default is `codemode`, which keeps MCP tools **out of the model's tool declarations entirely**.
  - `toolExposure` overrides the server default per tool, with **exact names beating patterns**; `"exposure": "hidden"` plus a few overrides exposes only those.
  - The **OAuth validation is strict**: a loopback redirect URI must be `http` on `localhost`/`127.0.0.1`/`[::1]` with **no query and no fragment**; `authServerMetadataUrl` must be `https` (or http on a loopback host); `clientRegistration: "cimd"` cannot be combined with a `clientId`.
  - A legacy `sse` transport is **rejected with a message** rather than silently ignored.
  - The namespace replaces `-` with `_`, so two server names differing only in `-`/`_` would collide — the loader checks for that.
  - `createToolNameMatcher` compiles `*` patterns to regexes **with every other regex metacharacter escaped** — a tool name is not a regex.
- **Idea to steal:** a four-way tool-exposure ladder (direct / deferred / script-only / hidden) that keeps a large external tool surface out of the model's context.

#### `packages/coding-agent/src/core/agent-session-runtime.ts`
- **Purpose:** Owns the **current** `AgentSession` plus its cwd-bound services, and performs session replacement (`/new`, `/resume`, `/fork`, import).
- **Key abstractions:** `AgentSessionRuntime` (`switchSession`, `newSession`, `fork`, `importFromJsonl`, `dispose`), `CreateAgentSessionRuntimeFactory`, `SessionImportFileNotFoundError`.
- **Data flow:** a before-event → the new `SessionManager` → `teardownCurrent` (abort the run, emit `session_shutdown`, dispose) → `createRuntime` (rebuild the services for the new cwd) → `apply` → `rebindSession` → the caller's `withSession` hook.
- **Non-obvious design decisions:**
  - **The teardown settles the active response first** — "so the aborted turn (including tool results) is persisted to the outgoing session before it is replaced."
  - `beforeSessionInvalidate` is a **synchronous** hook that runs after `session_shutdown` but before the context goes stale, for host-owned UI teardown that "must not yield to the event loop".
  - The **fork position** is `"before"` (fork from the parent of a user message, and return the message's text) or `"at"` (fork from the message itself).
  - An import **copies** the file into the session dir with `COPYFILE_EXCL` and picks a `-1`, `-2` suffix on a collision.
  - `assertSessionCwdExists` runs **before** the switch, so a session whose recorded cwd is gone fails with a clear message rather than resuming in the wrong place.

#### `packages/coding-agent/src/core/agent-session-services.ts`
- **Purpose:** Creates the cwd-bound services (model runtime, settings manager, resource loader) separately from the session.
- **Key abstractions:** `AgentSessionServices`, `createAgentSessionServices`, `createAgentSessionFromServices`, `AgentSessionRuntimeDiagnostic`.
- **Non-obvious design decisions:**
  - **Services are recreated whenever the effective cwd changes**, so a session switch cannot leave a resource loader bound to the old project.
  - **Runtime creation returns diagnostics instead of printing or exiting** — "The app layer decides whether warnings should be shown and whether errors should abort startup."
  - A provider registration that **throws** becomes a diagnostic naming the extension, not a crash.
  - An **unknown extension flag** becomes an error diagnostic listing every unknown option.

#### `packages/coding-agent/src/modes/rpc/rpc-types.ts` and `packages/coding-agent/src/modes/rpc/rpc-mode.ts`
- **Purpose:** The **headless protocol**: JSON lines in on stdin, JSON lines out on stdout.
- **Key abstractions:** `RpcCommand` (35 commands), `RpcResponse` (a success/data or success/failure union per command), `RpcSessionState`, `RpcExtensionUIRequest` / `RpcExtensionUIResponse`, `runRpcMode`.
- **Data flow:** a command line → `JSON.parse` → `handleCommand` → a response line; meanwhile every `AgentSessionEvent` is streamed out as a JSON event.
- **Non-obvious design decisions:**
  - **Every command has a typed response**, and the failure shape is uniform: `{type: "response", command, success: false, error}`. There is no exception channel.
  - The `prompt` command **responds only after the prompt preflight succeeds**, and the response carries a `disposition` (`started` | `queued` | `handled`) so the caller knows whether the message was taken.
  - **Extension UI is part of the protocol.** A `select`/`confirm`/`input`/`editor` request goes out as an `extension_ui_request` with a UUID, and the host answers with `extension_ui_response`; the promise resolves to a **default** on abort or timeout rather than rejecting.
  - UI features that need a TUI (custom footers, widgets, editors, theme switching) are **explicitly no-ops** in RPC mode, and each says why.
  - The stdout is taken over by `output-guard` and written through the **raw, backpressure-aware** path, so the protocol stream is never interleaved with a TUI frame.
  - `get_entries` supports a **`since` cursor** — a host can tail the transcript incrementally.
  - `get_commands` returns extension commands, prompt templates **and** skills, each with its `sourceInfo`.
  - `SIGTERM` (and `SIGHUP` off Windows) triggers a graceful shutdown that kills tracked detached children and flushes stdout.

#### `packages/coding-agent/src/modes/json-event.ts`
- **Purpose:** The JSON projection of the session event stream.
- **Non-obvious design decisions:** `message_update` is **replaced** by a `JsonMessageUpdateEvent` with the `partial` field flattened, so a host never has to deal with the partial-typing shape.

#### `packages/coding-agent/src/main.ts`
- **Purpose:** The CLI entry point — it turns argv into `createAgentSession` options and picks the run mode.
- **Key abstractions:** `main(options)`, `resolveAppMode`, `resolveSessionPath`, `buildSessionOptions` (in the file), `runAuthCommand`.
- **Data flow:** argv → `parseArgs` → the mode (`rpc` / `json` / `print` / `interactive`) → migrations → the runtime factory → `createAgentSessionRuntime` → the mode runner.
- **Non-obvious design decisions:**
  - **The mode is inferred from the TTY**: `parsed.print || !stdinIsTTY || !stdoutIsTTY` ⇒ print mode. Piping anything in makes it non-interactive.
  - **`--api-key` requires a model** and is installed as a **runtime** key, not written to `auth.json`.
  - **Conflicting flags are refused**: `--fork` cannot be combined with `--session`, `--continue`, `--resume` or `--no-session`; `--session-id` cannot be combined with the first three.
  - The **auth check exit code encodes the status**: `0` ready, `1` not ready, `2` invalid. A script can branch on the state without parsing text.
  - **Diagnostics are de-duplicated** across the startup and runtime settings managers.
  - **A runtime error aborts startup** (`process.exit(1)`), and if any error mentions "Failed to load extension" the hint "Start without extensions using `pi -ne`" is printed.
  - The **model catalog refresh runs in the background** in RPC mode (15 s timeout) so the first prompt is not blocked.
  - The startup benchmark path waits for stdout/stderr to **drain** before returning.

#### `packages/coding-agent/src/core/export-html/index.ts`, `packages/coding-agent/src/core/export-html/tool-renderer.ts`, `packages/coding-agent/src/core/export-html/ansi-to-html.ts`
- **Purpose:** Exports a session to a **single self-contained HTML file**.
- **Key abstractions:** `exportSessionToHtml`, `exportFromFile`, `ToolHtmlRenderer`, `ansiToHtml`, `ansiLinesToHtml`, `generateThemeVars`.
- **Data flow:** the session entries + the agent state → a JSON blob → **base64** → injected into the template; the theme colours become CSS custom properties; the custom tools are pre-rendered by invoking their TUI renderers and converting the ANSI to HTML.
- **Non-obvious design decisions:**
  - **The session data is base64-encoded** into the page "to avoid escaping issues".
  - The export colours are **derived from the theme's `userMessageBg`** using relative luminance (WCAG) — a dark theme gets a darker page, a light theme a lighter one — unless the theme declares explicit export colours.
  - The five built-in tools are rendered by the template itself; **only custom tools are pre-rendered** through the TUI renderer.
  - The renderer produces **both a collapsed and an expanded** HTML, and the collapsed one is omitted when it equals the expanded one.
  - **A renderer that throws returns `undefined`** and the export falls back to structured rendering — a broken custom tool cannot break the export.
  - `ansiToHtml` handles the 16 ANSI colours, the 256-colour cube and grayscale, and true-colour RGB, and escapes HTML as it goes.
- **Idea to steal:** a self-contained HTML export whose custom-tool output is rendered by the *same* renderer the terminal uses.

#### `packages/coding-agent/src/index.ts`
- **Purpose:** The package's public API.
- **Non-obvious design decisions:** the barrel exports the **types** of the whole extension event surface, the tool factories, the session/compaction functions, the theme utilities and the UI components — so an SDK consumer never reaches into `core/`.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/coding-agent/src/core/extensions/types.ts` | 2304-line type surface: `ExtensionAPI`, `ExtensionEvent`, `ToolDefinition`, `ExtensionContext`, `ExtensionUIContext`, `ToolExposure`, `ToolNamespace`, `ToolLoadout`, `BoundaryResult`, `ContextUsage`. Read head + export scan only (bulk tier). |
| `packages/coding-agent/src/core/package-manager.ts` | 2766 lines: `DefaultPackageManager`, `ResolvedPaths`, `PathMetadata`, `ProgressEvent` — resolves npm/git package sources into extension/skill/prompt/theme resources and installs them. Read head + export scan only. |
| `packages/coding-agent/src/core/tools/edit-diff.ts` | 556 lines: `applyEditsToNormalizedContent`, `fuzzyFindText`, `generateUnifiedPatch`, `generateDiffString`, `detectLineEnding` — the exact-text edit engine (BOM/CRLF aware). Read head + export scan only. |
| `packages/coding-agent/src/core/tools/find.ts` | 318 lines: the `find` tool (glob file discovery) with pluggable `FindOperations`. Read head + export scan only. |
| `packages/coding-agent/src/core/tools/render-utils.ts` | 185 lines: shared rendering helpers — `formatToolCallWithArgs`, `formatReadLineRange`, `linkPath`, `startToolTimer`/`toolTimerText`, `getTextOutput`. Read head + export scan only. |
| `packages/coding-agent/src/core/tools/renderers/index.ts` | 63 lines: `createAllToolRenderers()` — the renderers **without** the tool implementations, "keeps ~17 MB of module graph out of a process that only renders". Read head + export scan only. |
| `packages/coding-agent/src/core/tools/renderers/bash.ts` | 109 lines: `createShellRenderers(prompt)` — the shell tool's call/result presentation, throttled at 100 ms. Read head + export scan only. |
| `packages/coding-agent/src/core/tools/renderers/edit.ts` | 252 lines: the edit tool's diff presentation (`EditRenderState`, `editRenderers`). Read head + export scan only. |
| `packages/coding-agent/src/core/tools/renderers/find.ts` | 77 lines: the find tool's presentation. Read head + export scan only. |
| `packages/coding-agent/src/core/tools/renderers/grep.ts` | 82 lines: the grep tool's presentation. Read head + export scan only. |
| `packages/coding-agent/src/core/tools/renderers/ls.ts` | 70 lines: the ls tool's presentation. Read head + export scan only. |
| `packages/coding-agent/src/core/tools/renderers/read.ts` | 173 lines: the read tool's presentation, with relative-path and line-range rendering. Read head + export scan only. |
| `packages/coding-agent/src/core/tools/renderers/write.ts` | 181 lines: the write tool's presentation. Read head + export scan only. |
| `packages/coding-agent/src/core/export-html/template.html` | 56 lines: the export page shell with `{{CSS}}` / `{{JS}}` / `{{SESSION_DATA}}` placeholders. Read head + export scan only. |
| `packages/coding-agent/src/core/export-html/template.css` | 1076 lines: the export stylesheet; `{{THEME_VARS}}`, `{{BODY_BG}}`, `{{CONTAINER_BG}}`, `{{INFO_BG}}` are substituted at export time. Read head only. |
| `packages/coding-agent/src/experimental/source-resolver.ts` | 86 lines: a Node module hook that applies the workspace `tsconfig.json` path aliases so source runs cannot fall through to stale `dist` files. Read head + export scan only. |
| `packages/coding-agent/src/migrations.ts` | 315 lines: `runMigrations(cwd)` — `migrateAuthToAuthJson`, `migrateSessionsFromAgentRoot`, and the deprecation-warning prompt. Read head + export scan only. |
| `packages/coding-agent/src/package-manager-cli.ts` | 1142 lines: the `install` / `remove` / `update` / `list` / `config` commands and `cleanupManagedInstall`. Read head + export scan only. |
| `packages/coding-agent/src/rpc-entry.ts` | 13 lines: the separate `pi-rpc` binary entry (own process title, own dispatcher config). Read head + export scan only. |
| `packages/coding-agent/src/extensions/index.ts` | 14 lines: `builtInExtensions` — llama.cpp, codemode, mcp, tool_search; the last three are **replaceable**. Read head + export scan only. |
| `packages/coding-agent/src/extensions/codemode/index.ts` | 49 lines: `createCodemodeExtension()` — registers the `codemode` tool **inactive**; the MCP extension activates it when MCP tools are script-only. Read head + export scan only. |
| `packages/coding-agent/src/extensions/codemode/tool.ts` | 411 lines: the `codemode` tool — the model writes JavaScript that calls other tools through `ctx.executeTool`; only the script's output reaches the model. Read head + export scan only. |
| `packages/coding-agent/src/extensions/codemode/execute.ts` | 850 lines: the QuickJS sandbox that runs a codemode script. Read head + export scan only. |
| `packages/coding-agent/src/extensions/codemode/execute.lazy.ts` | 2 lines: a lazy `import("./execute.ts")` so the sandbox runtime only loads when a script runs. Read head + export scan only. |
| `packages/coding-agent/src/extensions/codemode/renderer.ts` | 156 lines: the codemode row — the script, the nested calls with their status, the model-call cost and the elapsed time. Read head + export scan only. |
| `packages/coding-agent/src/extensions/codemode/worker.ts` | 6 lines: the bundled-build worker entrypoint that re-exports `pi-codemode/worker`. Read head + export scan only. |
| `packages/coding-agent/src/extensions/llama/index.ts` | 230 lines: the llama.cpp extension — model download, a local server, and a `llama.cpp` provider. Read head + export scan only. |
| `packages/coding-agent/src/extensions/llama/client.ts` | 348 lines: `LlamaClient` — the local llama-server HTTP client with model status/progress events. Read head + export scan only. |
| `packages/coding-agent/src/extensions/llama/huggingface.ts` | 158 lines: `HuggingFaceClient` — model search, quantization and shard parsing, plus token discovery. Read head + export scan only. |
| `packages/coding-agent/src/extensions/llama/provider.ts` | 299 lines: `createLlamaProvider()` — registers `llama.cpp` as a provider whose auth resolves against the local server. Read head + export scan only. |
| `packages/coding-agent/src/extensions/llama/ui.ts` | 542 lines: the llama manager TUI (model list, download progress). Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/index.ts` | 1347 lines: the built-in MCP integration — connects `mcp.json` servers plus extension-registered ones, and registers tools as `mcp__<server>__<tool>`. Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/config.ts` | 243 lines: `loadMcpConfig` — reads the global and the (trusted) project `mcp.json`; a project entry may override only `enabled`/`exposure`/`toolExposure`. Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/tools.ts` | 391 lines: adapts MCP tools to pi tool definitions; text over 20 KB keeps its head and tail, and the full text goes to a temp file. Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/resources.ts` | 339 lines: `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource` — the Codex-compatible resource tools. Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/runtime.ts` | 454 lines: the MCP client, transports and OAuth sign-in; loaded lazily so the MCP client is only pulled in when a server exists. Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/oauth.ts` | 558 lines: the MCP OAuth flow (PKCE, DCR or a Client ID Metadata Document) against a loopback callback; credentials in `mcp-auth.json`. Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/cli.ts` | 594 lines: the `pi mcp` command — add/remove/check servers and sign in, outside a session. Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/ui.ts` | 259 lines: the `/mcp` manager view — menus that rebuild while servers connect, plus the sign-in screen. Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/log.ts` | 69 lines: appends `notifications/message` to `mcp.log`, rotating at 5 MB; every message is one synchronous append because several processes may write it. Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/cli.lazy.ts` | 2 lines: lazy `import("./cli.ts")` for the `pi mcp` command. Read head + export scan only. |
| `packages/coding-agent/src/extensions/mcp/runtime.lazy.ts` | 2 lines: lazy `import("./runtime.ts")` for the MCP client. Read head + export scan only. |
| `packages/coding-agent/src/extensions/tool-search/index.ts` | 18 lines: `createToolSearchExtension()` — registers `tool_search` **inactive**. Read head + export scan only. |
| `packages/coding-agent/src/modes/index.ts` | 16 lines: the run-mode barrel (`InteractiveMode`, `runPrintMode`, `runRpcMode`, `RpcClient`). Read head + export scan only. |
| `packages/coding-agent/src/modes/print-mode.ts` | 173 lines: `runPrintMode` — the single-shot mode that sends a prompt, prints the answer and exits (text or JSON stream). Read head + export scan only. |
| `packages/coding-agent/src/modes/rpc/jsonl.ts` | 58 lines: `serializeJsonLine` and `attachJsonlLineReader` — strict LF framing and a line reader that survives a payload containing other Unicode separators. Read head + export scan only. |
| `packages/coding-agent/src/modes/rpc/rpc-client.ts` | 617 lines: `RpcClient` — spawns the agent in RPC mode and offers a typed API for every command. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | 7082 lines: the whole TUI mode (rendering, input, keybindings, the tree, the session picker). Read head + export scan only — the largest file in the shard. |
| `packages/coding-agent/src/modes/interactive/tui-renderer.ts` | 81 lines: `createInteractiveTui` — fullscreen (alt-screen) vs regular (main-screen) selection, plus a reference TUI for tests. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/chat-viewport.ts` | 46 lines: `createChatViewport` — the scroll view holding the document, the pending messages, the status line and the editor. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/bug-report.ts` | 298 lines: `reportBug` — the interactive bug-report flow (hint, transcript consent, upload or zip). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/external-editor.ts` | 46 lines: `editInExternalEditor` — a temp file, the user's `$EDITOR`, and a `complete`/`failed` result. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/model-catalog-refresh.ts` | 51 lines: `refreshModelCatalogs` — a background, abortable catalog refresh that only the newest pass wins. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/model-search.ts` | 21 lines: the search text for a model in the pickers. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/program-status-reporter.ts` | 111 lines: `ProgramStatusReporter` — turns session events into the terminal's program-status indicator (OSC 9;4). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/session-share.ts` | 224 lines: `shareSession` — exports a session and shares it as a Radius artifact or a GitHub gist. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/theme/theme.ts` | 1086 lines: the theme engine — token resolution, `initTheme`/`setTheme`, theme loading from JSON, and the export colours. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/theme/system-theme.ts` | 655 lines: derives a theme from the terminal's own colours in OKHSL, with WCAG contrast rules per token. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/theme/theme-controller.ts` | 253 lines: `InteractiveThemeController` + `requestTerminalColors` — the terminal colour query and the theme watcher. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/theme/theme-schema.ts` | 146 lines: the theme JSON validator, kept out of `theme.ts` because typebox costs ~17 MB of module graph. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/theme/theme-tokens.ts` | 121 lines: `THEME_TOKENS` — the token table (slot, description, fallback) every theme must fill. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/theme/dark.json` | The shipped dark theme (78 lines, OKHSL tokens). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/theme/light.json` | The shipped light theme (78 lines, OKHSL tokens). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/index.ts` | 37 lines: the UI component barrel exported to extensions. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/assistant-message.ts` | 202 lines: the assistant's message row, with the OSC 133 shell-integration zones. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/user-message.ts` | 71 lines: the user's message row, with the OSC 133 zone markers. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/tool-execution.ts` | 408 lines: `ToolExecutionComponent` — the tool row (call, streaming result, images, timing). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/bash-execution.ts` | 223 lines: the `!`-command row with streaming output. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/footer.ts` | 302 lines: `FooterComponent` — cwd, git branch, context usage, token/cost totals. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/status-indicator.ts` | 123 lines: the working / retry / compaction / branch-summary status indicators, each with its own reason vocabulary. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/model-selector.ts` | 421 lines: the model picker with fuzzy search. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/scoped-models-selector.ts` | 401 lines: the model-cycle scope editor (enable/disable, reorder, per-model thinking level). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/session-selector.ts` | 1045 lines: the session browser (list, rename, delete, fork, spawn). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/session-selector-search.ts` | 194 lines: the session search grammar — `parseSearchQuery`, `matchSession`, `filterAndSortSessions`, and the sort modes (threaded / recent / relevance). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/tree-selector.ts` | 1428 lines: the session-tree browser with the filter modes (default / no-tools / user-only / labeled-only / all). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/settings-selector.ts` | 1009 lines: the settings menu. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/settings-submenu.ts` | 258 lines: `SelectSubmenu` and `SteppedSubmenu` — a reusable menu and a wizard-style multi-step menu. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/config-selector.ts` | 951 lines: the `pi config` resource manager (global vs project scope, per-package enable/disable). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/thinking-selector.ts` | 154 lines: the thinking-level picker. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/oauth-selector.ts` | 224 lines: the provider auth picker — API key vs OAuth, with the per-provider status. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/radius-login-selector.ts` | 114 lines: the `/login` menu with the animated Radius option. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/login-dialog.ts` | 238 lines: the OAuth sign-in dialog (device code, paste, browser). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/auth-url.ts` | 39 lines: the sign-in URL row with a copy hint. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/theme-selector.ts` | 67 lines: the theme picker. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/show-images-selector.ts` | 50 lines: the image-rendering picker. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/trust-selector.ts` | 134 lines: the project-trust prompt (trust / trust parent / this session / do not trust). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/user-message-selector.ts` | 155 lines: the "fork from this message" picker. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/extension-selector.ts` | 117 lines: a generic string-option selector for extensions. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/extension-input.ts` | 94 lines: a generic text input for extensions, with the countdown timer. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/extension-editor.ts` | 141 lines: a multi-line editor for extensions (Ctrl+G external editor). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/custom-editor.ts` | 148 lines: the main editor, with the working/compaction/retry status embedded in its top border. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/countdown-timer.ts` | 39 lines: the reusable countdown timer for dialogs. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/custom-message.ts` | 114 lines: the row for an extension-injected custom message. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/custom-entry.ts` | 69 lines: the row for an extension-only (non-context) session entry. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts` | 68 lines: the row for a `/skill:name` invocation. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/branch-summary-message.ts` | 71 lines: the collapsed/expanded branch-summary row. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/compaction-summary-message.ts` | 72 lines: the collapsed/expanded compaction-summary row. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/bordered-loader.ts` | 68 lines: the loader wrapped in a border, for extension UI. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/dynamic-border.ts` | 25 lines: a border that adjusts to the viewport width; notes the jiti-loaded-extension case where the global `theme` may be undefined. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/diff.ts` | 147 lines: `renderDiff` — the diff row renderer shared by the edit tool and the export. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/visual-truncate.ts` | 98 lines: `truncateToVisualLines` — truncation by *visual* lines (accounting for wrapping), shared by the tool renderers. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/markdown-transform.ts` | 29 lines: `createMarkdownTransform` — the chain that applies the extensions' markdown transformers. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/mermaid.ts` | 89 lines: the mermaid diagram renderer as a markdown transformer (`off` / `final` / `streaming`). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/themed-text.ts` | 32 lines: text that rebuilds its string after a theme change, so colours never go stale. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/keybinding-hints.ts` | 48 lines: `keyText` / `keyHint` / `rawKeyHint` — the one formatter for the key hints shown beside every action. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/first-time-setup.ts` | 148 lines: the first-run dialog (theme preview, analytics opt-in). Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/armin.ts` | 384 lines: an animated XBM easter egg. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/easter-egg-3d.ts` | 1292 lines: the 3D easter-egg animation that dissolves the rendered screen. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/easter-egg-3d.lazy.ts` | 27 lines: loads the 3D easter egg on first use; only fullscreen mode can show it. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/earendil-announcement.ts` | 53 lines: a bundled announcement image shown after an update. Read head + export scan only. |
| `packages/coding-agent/src/modes/interactive/components/pi-logo.ts` | 40 lines: the wordmark, drawn in colour only on terminals that support it. Read head + export scan only. |
| `packages/coding-agent/src/utils/abort.ts` | 48 lines: `operationSignal` and `raceWithAbortSignal` — the two abort helpers every async path uses. Read head + export scan only. |
| `packages/coding-agent/src/utils/ansi.ts` | 82 lines: `splitIncompleteAnsiSuffix` and `stripAnsi` — ANSI stripping that survives a split escape sequence. Read head + export scan only. |
| `packages/coding-agent/src/utils/child-process.ts` | 137 lines: `spawnProcess`, `spawnProcessSync`, `waitForChildProcess` — the spawn wrappers and the "don't hang on inherited stdio" wait. Read head + export scan only. |
| `packages/coding-agent/src/utils/changelog.ts` | 196 lines (docs): `parseChangelog`, `compareVersions`, `getNewEntries`, `normalizeChangelogLinks` — the changelog shown after an update. Read head + export scan only. |
| `packages/coding-agent/src/utils/clipboard.ts` | 150 lines: `readClipboardText`, `readClipboardFilePaths`, `copyToClipboard`. Read head + export scan only. |
| `packages/coding-agent/src/utils/clipboard-command.ts` | 47 lines: `runClipboardCommand` — "Undefined means the command failed; an empty buffer is a successful result." Read head + export scan only. |
| `packages/coding-agent/src/utils/clipboard-image.ts` | 240 lines: clipboard image reading, with a Wayland-specific path. Read head + export scan only. |
| `packages/coding-agent/src/utils/deprecation.ts` | 14 lines: `warnDeprecation` — each warning is emitted once per process. Read head + export scan only. |
| `packages/coding-agent/src/utils/exif-orientation.ts` | 182 lines: `applyExifOrientation` — reads the EXIF orientation from the TIFF header. Read head + export scan only. |
| `packages/coding-agent/src/utils/frontmatter.ts` | 40 lines: `parseFrontmatter` / `stripFrontmatter` over YAML. Read head + export scan only. |
| `packages/coding-agent/src/utils/fs-watch.ts` | 30 lines: `watchWithErrorHandler` and `closeWatcher` — the watcher wrapper with a 5 s retry. Read head + export scan only. |
| `packages/coding-agent/src/utils/git.ts` | 226 lines: `parseGitUrl` — parses npm/git URLs into a `GitSource`. Read head + export scan only. |
| `packages/coding-agent/src/utils/highlight-js.d.ts` | 36 lines: the ambient types for the `highlight.js/lib/core` import. Read head + export scan only. |
| `packages/coding-agent/src/utils/html.ts` | 51 lines: `decodeHtmlEntity` / `decodeHtmlEntityAt` — entity decoding without a DOM. Read head + export scan only. |
| `packages/coding-agent/src/utils/image-convert.ts` | 89 lines: `convertToPng` and the PNG transcoder registration. Read head + export scan only. |
| `packages/coding-agent/src/utils/image-process.ts` | 119 lines: `processImage` — the one image path (resize → convert → hints) used by the read tool and the CLI. Read head + export scan only. |
| `packages/coding-agent/src/utils/image-resize-core.ts` | 174 lines: `resizeImageInProcess` — the resize worker body. Read head + export scan only. |
| `packages/coding-agent/src/utils/image-resize-worker.ts` | 43 lines: the worker thread entry for image resizing. Read head + export scan only. |
| `packages/coding-agent/src/utils/image-resize.ts` | 122 lines: `resizeImage` — the worker wrapper, with a same-thread fallback. Read head + export scan only. |
| `packages/coding-agent/src/utils/json.ts` | 6 lines: `stripJsonComments` — JSONC → JSON without a second parser. Read head + export scan only. |
| `packages/coding-agent/src/utils/management-http.ts` | 78 lines: `fetchWithRetry` — retries 408/425/429/5xx with a per-attempt timeout. Read head + export scan only. |
| `packages/coding-agent/src/utils/mime.ts` | 116 lines: `detectSupportedImageMimeType` — sniffs the file's magic bytes rather than trusting the extension. Read head + export scan only. |
| `packages/coding-agent/src/utils/open-browser.ts` | 24 lines: `openBrowser` — never invokes a shell. Read head + export scan only. |
| `packages/coding-agent/src/utils/output-files.ts` | 34 lines: `writeOutputFile` / `createOutputFileStream` — the ONE place output files (truncated tool output, binary resources) are written. Read head + export scan only. |
| `packages/coding-agent/src/utils/paths.ts` | 140 lines: `normalizePath`, `resolvePath`, `canonicalizePath`, `getFileRevision` — the path and file-revision primitives. Read head + export scan only. |
| `packages/coding-agent/src/utils/photon.ts` | 139 lines: the lazy loader for the native image library, working in Node, Bun and a bundled binary. Read head + export scan only. |
| `packages/coding-agent/src/utils/pi-user-agent.ts` | 6 lines: `getPiUserAgent` — the User-Agent for pi's own requests. Read head + export scan only. |
| `packages/coding-agent/src/utils/shell.ts` | 251 lines: `getShellConfig`, `getPowerShellConfig`, `getShellEnv`, `sanitizeBinaryOutput`, `killProcessTree`, and the detached-child pid registry. Read head + export scan only. |
| `packages/coding-agent/src/utils/sleep.ts` | 18 lines: `sleep(ms, signal)` that rejects on abort. Read head + export scan only. |
| `packages/coding-agent/src/utils/syntax-highlight.ts` | 219 lines: `highlight` and `renderHighlightedHtml` — the code highlighting used by the tool renderers and the export. Read head + export scan only. |
| `packages/coding-agent/src/utils/text.ts` | 9 lines: `splitBom` / `stripBom` — the BOM helpers used by every file reader. Read head + export scan only. |
| `packages/coding-agent/src/utils/tool-result-images.ts` | 67 lines: `normalizeToolResultImages` — resizes images a tool returned, using the model's own limits. Read head + export scan only. |
| `packages/coding-agent/src/utils/tools-manager.ts` | 401 lines: `ensureTool("fd" | "rg")` — downloads and caches the helper binaries into the agent dir. Read head + export scan only. |
| `packages/coding-agent/src/utils/version-check.ts` | 109 lines: `checkForNewPiVersion` — the update check against pi.dev. Read head + export scan only. |
| `packages/coding-agent/src/utils/windows-self-update.ts` | 84 lines: `quarantineWindowsNativeDependencies` — moves locked native DLLs aside so an update can replace them. Read head + export scan only. |
| `packages/coding-agent/src/utils/wsl.ts` | 15 lines: `isWSL` — the WSL detection used by the keybindings and the git watcher. Read head + export scan only. |
| `packages/coding-agent/src/utils/zip.ts` | 72 lines: `writeZipArchive` — a dependency-free zip writer for the bug-report archive. Read head + export scan only. |

### Tier 3 — skipped with a reason

| File | Why not read line by line |
| --- | --- |
| `packages/coding-agent/src/modes/interactive/assets/clankolas.png` | **Binary PNG asset, 539 KB** (PNG signature confirmed at the head of the file). A raster image carries no source logic to mine; it was confirmed on disk and not decoded. |
| `packages/coding-agent/src/core/export-html/vendor/highlight.min.js` | 121 KB **minified vendored** Highlight.js bundle — over the 120 KB rule; head read only, body not read line by line. |
| `packages/coding-agent/src/core/export-html/vendor/marked.min.js` | 44 KB minified vendored marked bundle — head read only. |
| `packages/coding-agent/src/core/export-html/vendor/marked-cjk-friendly.min.js` | 4.7 KB minified vendored patch bundle — head read only. |
| `packages/coding-agent/src/core/export-html/template.js` | 80 KB **generated client script** (1924 lines) for the HTML export; head read only. |

---

## 2. Ideas worth stealing

1. **A named-section system prompt, diffed and patched** — the prompt is a map of named sections (`preamble`, `tools`, `rules`, `docs`, `skills`, `cwd`), each diffed against the transcript's current sections and patched individually, so a tool change edits one section instead of rebuilding the prompt. `packages/coding-agent/src/core/system-prompt.ts:126` (`buildSystemPromptSections`), `:186` (`diffSystemPromptSections`).
2. **A tool-exposure ladder that keeps a large tool surface out of the model's context** — `direct` (declared), `deferred` (loaded on demand), `codemode` (script-only), `hidden`. MCP tools default to script-only, so a dozen servers cost the model nothing. `packages/coding-agent/src/core/mcp-servers.ts:66` (`McpExposure`), `packages/coding-agent/src/extensions/mcp/index.ts:1`.
3. **BM25 over tool metadata to discover tools on demand** — the tool's own description, its schema's property names and descriptions, and its namespace's docs become the searchable document; the match is *activated* through the active tool set so it is recorded in the transcript and survives a branch. `packages/coding-agent/src/extensions/tool-search/tool.ts:107` (`Bm25Ranker`), `:151` (`createToolSearchDocument`), `:206` (`searchAndLoad`).
4. **Cache warming as an economics decision, not a timer** — a background job re-sends the request with a one-token cap, but only when `continuationProbability × missCost − warmCost ≥ $0.05`, with a one-hour streaming window, a 30-minute idle window, and a "not replayable" guard for providers whose budget-based thinking would change on replay. `packages/coding-agent/src/core/cache-warmer.ts:22` (`CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS`), `:60` (`isReplayable`), `:295` (`evaluate`).
5. **A refusal to persist a partial summary** — a summarisation that stopped because it hit the token cap is a **failure**, not a checkpoint; the summary is not written and the turn fails loudly. `packages/coding-agent/src/core/compaction/compaction.ts:436` (`getSummarizationFailure`).
6. **Truncation notices that tell the model exactly how to continue** — "[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]", plus a byte-limit notice, plus a match-limit notice that names the doubled limit, plus a "use the read tool for the full line" notice. Every tool follows the same shape. `packages/coding-agent/src/core/tools/read.ts:194`, `packages/coding-agent/src/core/tools/grep.ts:283`, `packages/coding-agent/src/core/tools/ls.ts:146`.
7. **The tool declares its own prompt contribution** — each tool carries a `promptSnippet` and `promptGuidelines`, and the system prompt's rules are *composed* from the active tool set (a rule appears only when its tool is present). The prompt cannot drift from the tools. `packages/coding-agent/src/core/tools/read.ts:28` (`readToolSystemPromptContribution`), `packages/coding-agent/src/core/system-prompt.ts:100` (`buildRules`).
8. **A two-phase context hook** — `context` handlers see the conversation only, and the system message is restored afterwards; `context_with_system` handlers see everything but are warned if they removed the leading system message. The first phase keeps a models' cached prefix intact; the second is opt-in. `packages/coding-agent/src/core/extensions/runner.ts:1332` (`emitContext`), `:276` (`restoreSystemMessages`).
9. **A three-state readiness vocabulary for a provider** — `ready` / `not_ready` (no credential) / `invalid` (the config itself is broken), with the exit code encoding the state (0/1/2). A script can branch on readiness without parsing prose. `packages/coding-agent/src/cli/auth-check.ts:8`, `packages/coding-agent/src/main.ts:170`.
10. **A two-pass, trust-gated resource load** — the loader first loads *only* the global and CLI resources, asks the trust question with that set, and only then loads the project's. A project extension cannot run before the user has answered. `packages/coding-agent/src/core/resource-loader.ts:521` (`loadProjectTrustExtensions`).
11. **A write-back that touches only the fields that changed** — a settings write merges only the fields (and nested keys) modified in this session into the file, so two processes can share one settings file. `packages/coding-agent/src/core/settings-manager.ts:600` (`persistScopedSettings`).
12. **A bounded header scan for a log you must read at startup** — the session header is found within 1 MB, and exceeding the bound is a *discovery* failure only; the full load stays authoritative. `packages/coding-agent/src/core/session-manager.ts:585` (`readSessionHeader`).

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work — not in this shard.** There is no cron, no scheduler and no "detect the TP/SL hit" loop here; the shard covers the agent runtime, not a monitoring daemon. The closest analogue is the **cache warmer** (`packages/coding-agent/src/core/cache-warmer.ts`), which is the one background timer in the codebase: it has a hard safety window (one hour streaming / 30 minutes idle), a fixed pre-expiry deadline, a cost threshold, and it re-validates that the conversation has not changed before every refresh. A scheduled TP/SL watcher should copy that shape: a deadline, a cost/benefit gate, an idempotency check on the state it acts on, and a recorded reason for every stop.
- **Human-in-the-loop approval — strong.** Two distinct mechanisms: (a) **project trust** (`packages/coding-agent/src/core/project-trust.ts`, `core/trust-manager.ts`) — a decision stored per folder, inherited from the nearest ancestor, with "trust this session only" and "trust the parent" options, and the rule that **no UI ⇒ not trusted**; (b) the **`user_bash` hook** (`packages/coding-agent/src/core/extensions/runner.ts:1290`) — a `!` command can be intercepted, and the handler must return exactly one of `{operations}` or `{result}`, validated at runtime. The audit trail is the **session tree**: every decision is a `SessionEntry` with an id, a parent and a timestamp, and the transcript is the durable record.
- **Post-mortem / reflection loops — the compaction summary is the reflection loop, and it has a "bad rules" gate.** The summary is a **fixed-format structured checkpoint** (Goal / Constraints / Progress·Done·In Progress·Blocked / Key Decisions / Next Steps / Critical Context) with an explicit merge rule set ("PRESERVE, ADD, move In Progress → Done"). A summary that hits the token cap is **rejected** rather than stored (`getSummarizationFailure`). The file-operation lists (`<read-files>`, `<modified-files>`) are carried forward across compactions, so "what did this session actually change" survives the context being thrown away. What pi does **not** have is a rule *lifecycle* — no expiry, no retirement, no worth-gate on learned rules; the only "bad rule" gate is the compaction summary's format.
- **Multi-agent — no debate engine; the model is a single agent plus a *tool* layer.** The one multi-actor mechanism is the **virtual model** router (`packages/coding-agent/src/core/virtual-models.ts`): a router function picks the physical model per request, with the **route reason** (`user` / `continuation` / `retry` / `direct`) and a persistent router **state** stored on the session branch. The other is the extension layer, where several extensions can answer the same event — and the resolution is **first-answers-wins for `project_trust`**, **last-override-wins for the cache-warming decision**, and **load-order precedence** for tools/commands/flags, with every conflict reported as a diagnostic. The lesson for August Trading: a second "agent" that only *routes* is cheap and testable; a second agent that *argues* is not present here and is not needed for a single-seat trader.
- **Structured logs the model can query — the session JSONL is exactly that, with no database.** The store is an **append-only JSONL tree**: one JSON object per line, each with `id`/`parentId`/`timestamp`, plus a `session` header line. The model sees a **projection** of that tree (`buildSessionProjection`), and the same log is what a human, a `/tree` browser, the HTML export and the RPC `get_entries` cursor read. Cost and token usage are stored **as session entries** (`type: "usage"`, `kind: "cache_warm"`), so the cost of a background action is queryable next to the conversation. The `context_edit` entry type is the interesting one: an **append-only edit of an earlier entry's contribution to the model context** — the transcript keeps the original, the projection applies the edit.
- **Staying simple as features accumulate — the repo fights feature count with three rules.** (1) **One registry shape**: every tool is a `ToolDefinition`; a plain `AgentTool` is *synthesised* into one so there is a single definition-first registry (`core/tools/tool-definition-wrapper.ts`). (2) **One source of truth per fact**: `SETTINGS_DEFAULTS` feeds both the runtime and the published JSON Schema; `KEYBINDINGS` generates the keybinding schema; the theme token table generates the theme schema. (3) **Load-bearing code stays out of the display path**: the tool renderers live in a separate module so "a process that only displays tool output" does not load the execution path or the typebox schemas — and the theme validator is split out for the same reason ("~17 MB of module graph"). Lazy entry points (`cli.lazy.ts`, `runtime.lazy.ts`, `execute.lazy.ts`) do the same for whole features.

---

## 4. Non-obvious decisions and gotchas

1. **A tool result is never a cut point.** Compaction may cut at a user or an assistant message, never at a tool result, because a tool result must follow its tool call. When the cut lands on an assistant message with tool calls, its results follow it and are kept. A reader who assumes "cut at the last user message" will break tool pairs. (`core/compaction/compaction.ts:findValidCutPoints`)
2. **A compaction can split a turn, and then it produces *two* summaries.** The second one is a much smaller "turn prefix" checkpoint that is explicitly forbidden from inferring the later messages: *"Only summarize information explicitly present above. Do not infer or recreate later messages."* The two are merged with a `---` separator. (`core/compaction/compaction.ts:generateTurnPrefixSummary`)
3. **The context usage figure can legitimately be `null`.** After a compaction, the last assistant usage describes the *pre*-compaction context; if no assistant has answered since, pi reports `tokens: null, percent: null` rather than a stale number. (`core/agent-session.ts:getContextUsage`)
4. **Thinking blocks are dropped from the summarisation request on purpose.** Replayed thinking is often not part of the model's live context, and including it "can make the summarization request larger than the context it summarizes." (`core/compaction/utils.ts:serializeConversation`)
5. **A cache miss is only counted above a 1024-token noise floor**, and a turn with no cache activity is only a miss if *some earlier* turn in the segment reported one — otherwise it is a provider that does not report caching at all. (`core/cache-stats.ts:detectMiss`)
6. **The extension runtime's action methods throw until the host binds them.** A plugin that calls `pi.sendMessage` during its own load gets "Extension runtime not initialized", not a silent no-op. (`core/extensions/loader.ts:createExtensionRuntime`)
7. **The context object is invalidated on session replacement, and the message says exactly what to do about it**: move post-replacement work into `withSession` and use the ctx passed to `withSession`; do not use the old ctx after `await ctx.reload()`. (`core/extensions/loader.ts:invalidate`)
8. **A `tool_call` handler that throws blocks the tool.** Every other event swallows handler errors; this one does not, because a security hook that fails must not fail open. (`core/extensions/runner.ts:emitToolCall`)
9. **`context_edit` is append-only and branch-local.** The original message stays in the transcript; the edit is a new entry that the projection applies. An edit to an entry not on the active branch is refused. (`core/session-manager.ts:appendContextEdit`)
10. **The `!` command's result is excluded from the model context with the `!!` prefix** while still being shown to the human — the transcript and the model see different things. (`core/messages.ts:bashExecutionToText`)
11. **The session file is only created once the conversation starts.** Model and thinking-level setup entries stay in memory, so opening and closing pi without chatting leaves no file behind. The file is created with an exclusive `wx` open. (`core/session-manager.ts:_persist`)
12. **A settings file that fails to parse is never overwritten.** `save()` returns early while a load error is outstanding, and the error is surfaced as a diagnostic. (`core/settings-manager.ts:save`)
13. **`list()` must not resolve a secret.** The credential store's `list()` returns only the provider id and the type; only `read()` resolves an env var or runs a `!command`. (`core/auth-storage.ts:AuthStorage.list`)
14. **A `--api-key` on the command line is a runtime key**, never written to `auth.json`; `getProviderAuthStatus` reports it as source `"runtime"`. (`core/model-runtime.ts:getProviderAuthStatus`)
15. **A 304 on the model catalog must never empty the overlay.** The ETag is only sent when a cached body backs it, and a 404/501 persists `lastModified: 0` and drops the ETag so the next attempt is a full fetch. (`core/remote-catalog-provider.ts:withRemoteCatalog`)
16. **`--exclude-tools` applies to MCP tools too; `--tools` does not** (unless the allowlist names an `mcp__` tool or is empty). The two lists have deliberately different scopes. (`core/sdk.ts:createAgentSession`)
17. **The abort is checked *after* each await in the file tools, never from an abort listener** — an abort listener would release the mutation queue while the filesystem operation is still in flight. (`core/tools/write.ts`, `core/tools/edit.ts`)
18. **`--no-config` on ripgrep**, because the tool's contract must not depend on the user's `RIPGREP_CONFIG_PATH`. (`core/tools/grep.ts`)
19. **A broken custom tool renderer cannot break the HTML export** — it returns `undefined` and the export falls back to the structured rendering. (`core/export-html/tool-renderer.ts`)
20. **The trust answer in a headless run is "no".** Every UI callback in `createProjectTrustContext` returns `undefined`/`false` when there is no UI, and `resolveProjectTrusted` returns `false` rather than defaulting to trust. (`cli/project-trust.ts`, `core/project-trust.ts`)

---

## 5. Weak spots

1. **`agent-session.ts` (164 KB, 4 458 lines) and `interactive-mode.ts` (251 KB, 7 082 lines) are enormous.** The session class owns the agent, the tool registry, the extension bindings, compaction, retries, branching, the cache warmer and the export; the interactive mode owns the TUI, the tree, the pickers and the keybindings. Both are past the point where a reader can hold them in their head, and both are the natural fault line for a "turn lifecycle" refactor. This shard shows the *shape* of that debt rather than fixing it.
2. **The extension API surface is enormous and mostly types.** `core/extensions/types.ts` is 2 304 lines of type declarations and the barrel re-exports ~200 names. The runtime semantics are clear (the runner), but the *contract* is so wide that a third-party extension can hook almost anything — which is exactly the "feature count becomes the product" failure mode the rest of the codebase works hard to avoid.
3. **Some safety limits are duplicated rather than shared.** `MAX_CRASH_RECORDS`, the session-discovery concurrency caps, the truncation limits, the `MAX_TIMEOUT_MS` guard, the compaction `reserveTokens` and the cache-warmer windows all live in different modules with their own constants, and several are re-derived (e.g. `DEFAULT_COMPACTION_SETTINGS` in `compaction.ts` duplicates `SETTINGS_DEFAULTS.compaction` in `settings-defaults.ts`). Two sources of truth for the same number is how they drift.
4. **The `bash`/`powershell` tool leaks the session's identity by default** (`exposeSessionEnvironment` defaults to `true`, so `PI_SESSION_ID`, `PI_MODEL` and `PI_PROVIDER` reach every subprocess). It is opt-out rather than opt-in, which is the wrong default for a credential-adjacent leak.
5. **The trust model is per-folder and coarse.** One boolean per path, inherited from the nearest ancestor, with no expiry and no per-resource granularity — a folder trusted once stays trusted forever, and "trust the parent" is a single click that covers every child.
6. **There is no rule or memory lifecycle.** The `Skill` type has a `disableModelInvocation` flag but no version, no worth-gate, no expiry and no retirement; nothing stops a stale skill from being injected forever. For a system that accumulates learned material over months, that is the missing piece.
