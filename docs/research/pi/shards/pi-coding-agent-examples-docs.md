# pi :: pi-coding-agent-examples-docs

**Files in shard:** 191 (read: 181, skipped with reason: 10)
**What this shard covers:** the *public surface* of `pi` (the `@earendil-works/pi-coding-agent` package) — every markdown reference under `packages/coding-agent/docs/`, every runnable example under `packages/coding-agent/examples/`, the four JSON schemas under `packages/coding-agent/schemas/`, and three build/codegen scripts under `packages/coding-agent/scripts/`. The docs are the canonical statement of pi's agent loop, compaction, session tree, tool-exposure model, virtual-model routing and trust model; the examples are the *implementation reference* the docs point at (the extensions README calls them that explicitly). Everything here was read as text; no repo code was executed.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/coding-agent/scripts/generate-references.ts`
- **Purpose:** codegen that renders `docs/models-configuration.md` from the same TypeBox schemas that define `models.json`. The doc and the schema therefore cannot drift.
- **Key abstractions:** `ReferenceArtifact` (path + title + intro + sections), `ReferenceSection` (a heading, an optional intro, a `TSchema` whose properties become table rows, plus `links` for fields that point at another section and `collapsed` for fields listed without their nested fields), `renderReference()`, `renderReferences()` (exported so a test can assert the rendered map without touching the filesystem).
- **Data flow:** `CompatSchemasByApi` (from `@earendil-works/pi-ai/providers/compat-schema`) + `ModelInputLimitsSchema` + `ModelsJsonSchemas` → `referenceRows()` → markdown tables → `docs/models-configuration.md`.
- **Non-obvious design decisions:**
  - The banner `<!-- This file is generated from TypeScript source. Do not edit it manually; run npm run generate:references. -->` is emitted *by the generator*, so the file cannot lose its own warning.
  - APIs that share a compatibility schema are **grouped**: `compatSchemaApis` maps a schema to every API that uses it, and the section heading becomes `### \`openai-completions\`` with an "Also applies to …" line. One schema, one row-set, many APIs.
  - `documentedObject()` only descends into a nested object **if at least one of its fields carries documentation** — so a schema's anonymous inner objects do not explode the table into rows nobody can act on.
  - `escapeTableText()` escapes `|` and `<` so a description containing a pipe cannot break the table.
- **Edge cases:** `referenceType()` renders `anyOf` as a `|`-joined union and de-duplicates it; a missing `type` renders as `unknown` rather than throwing. Fields listed in `links` are not expanded inline (they get a markdown anchor instead).
- **Stealable:** August Trading's `docs/plan/` has a flow-doc anchor gate that re-measures line numbers; generating a *reference* from the types is the same idea applied to schemas. A hand-written table of provider quirks is a table that will rot.

#### `packages/coding-agent/scripts/generate-schemas.ts`
- **Purpose:** emits the four JSON Schemas published at `https://pi.dev/schemas/*.json` (`models`, `settings`, `keybindings`, `theme`), each with `$schema: draft/2020-12`, `$id: https://pi.dev/schemas/<name>.schema.json` and a `$comment` carrying the same "do not edit" warning.
- **Key abstractions:** `SchemaArtifact` (filename + schema + optional `definitions`), `splitAnnotations()`, `addDefinitions()`, `serializeSchema()`, `renderConfigSchemas()` (exported for tests).
- **Data flow:** TypeBox schemas from `pi-ai` + the package's own `model-config.ts` / `settings-schema.ts` / `keybindings-schema.ts` / `theme-schema.ts` → `addDefinitions()` → JSON → `packages/coding-agent/schemas/*.schema.json`.
- **Non-obvious design decisions:**
  - **Annotation-preserving de-duplication.** `splitAnnotations()` separates "shape" keys (`type`, `properties`, `items`, `required`, …) from "annotation" keys (`default`, `description`, `deprecated`, `examples`, `readOnly`, `title`, `writeOnly`). `addDefinitions()` then replaces a repeated schema with a `$ref` to `$defs/<Name>` **while keeping the annotations at the use site** — so `ModelCost` has one definition but each use can still say "Required." This is the interesting part: the `$defs` are not a copy, they are a de-duplication that keeps per-use prose.
  - **The generator fails on a stale definition.** `if (unusedDefinitions.length > 0) throw new Error(...)`. A `$defs` entry nobody references is a *build failure*, not dead weight.
  - Definition names are validated against `/^[A-Za-z][A-Za-z0-9_-]*$/` before use.
- **Edge cases:** a definition whose shape equals another is matched by `JSON.stringify(shape)` — order-sensitive, so two logically-equal-but-differently-ordered shapes would not de-duplicate. That is a real (if minor) fragility.
- **Stealable:** the "unused definition is an error" rule is the cheapest possible defence against a schema that quietly stops describing reality.

#### `packages/coding-agent/scripts/migrate-sessions.sh`
- **Purpose:** a **data-repair** migration, not a format migration: it moves session `.jsonl` files that a bug in v0.30.0 wrote to `~/.pi/agent/` into the proper `~/.pi/agent/sessions/<encoded-cwd>/` directory.
- **Key abstractions:** `AGENT_DIR` (overridable with `PI_AGENT_DIR`), `DRY_RUN` flag.
- **Data flow:** for each `*.jsonl` directly in the agent dir → read line 1 → `jq -r '.cwd // empty'` → encode the cwd (`sed 's|^/||'` then `sed 's|[/:\\]|-|g'`, wrapped `--…--`) → `mkdir -p` + `mv`.
- **Non-obvious design decisions:**
  - It is **idempotent and non-destructive**: it `SKIP`s (never overwrites) when the target already exists, and it skips unreadable files, invalid JSON, and headers with no `cwd`, counting each as `failed` rather than aborting.
  - It has a `--dry-run` mode that prints the exact move plan and then says "Run without --dry-run to perform the migration".
  - It reads the header with `head -1` + `jq` rather than parsing JSON in bash.
- **Edge cases:** `shopt -s nullglob` so an empty agent dir is not a glob error; `set -e`; per-file failures are counted, not fatal.
- **Stealable:** a migration script that only *moves* and refuses to overwrite is a migration you can run twice. The "fix the data on disk" script is also a separate artefact from the "read the new format" code — August Trading's stored chats/trades could use the same split.

### Tier 2 — bulk: a compact table, one row per file

#### `packages/coding-agent/docs/` — the reference surface (47 files: 42 `.md` + `docs.json` + 4 images)

| File | What it is / what it pins |
| --- | --- |
| `docs/index.md` | Landing page: what pi is, the five entry points, and the "Work safely" warning that project trust is **not** a sandbox. |
| `docs/quickstart.md` | Install, `/login`, first task, and the **"Choose how to customize Pi" ladder** from `AGENTS.md` → prompt template → skill → extension → TUI component → custom provider → package. |
| `docs/how-pi-works.md` | The whole model in ~100 words: a session is a **tree**; the active branch supplies history; a turn is one model request plus its tool calls; steering enters after the current turn, follow-ups after pending work. |
| `docs/cli-integration.md` | The four interfaces and their lifetime (interactive / print / JSON / RPC). Pins that **all four use the same agent, sessions, resources and tools**; only I/O differs. Also the "fork and rebrand" recipe via `package.json` → `piConfig.name` / `configDir`. |
| `docs/cli.md` | Full CLI reference. `--tools` has **two grammars**: a plain-name list *replaces* the selection, a `+name`/`-name`-only list *modifies* the default, and "Plain names and `+name`/`-name` entries cannot be mixed". Also `--print` vs `--mode text`, `--session-dir` precedence over the env var, `pi auth check` exit codes 0/1/2. |
| `docs/codemode.md` | The `codemode` tool: the model writes raw JS, it runs in a **QuickJS sandbox** (no Node/fs/network/timers), and only the script's *output* reaches the model. Hard limits: 256 MB VM, ≤2 workers per process, 60 s queue wait, output cap 16 777 216 chars, `max_output_tokens` default 10 000, `store()`/`load()` cross-call KV, and the `models.classify()` / `models.generateImages()` non-chat APIs. |
| `docs/compaction.md` | **The compaction reference.** Trigger `contextTokens > contextWindow - reserveTokens` (reserve 16 384, keep 20 000); cut-point rules ("Never cut at tool results"); the split-user-message-span case; the append-only `context_edit` recovery entry; per-model `compaction.modelOverrides`; the `session_before_compact` / `session_compact_failed` / `session_before_tree` hooks; the fixed summary format (Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context). |
| `docs/configuration.md` | Two-scope config: user `~/.pi/agent` vs project `.pi` (project loads only after trust). The one exception is `sessionDir`, read **before** trust resolution. Context files load *regardless of trust*. |
| `docs/containerization.md` | Four isolation strategies compared (plain Docker / Docker Sandboxes / OpenShell / Gondolin micro-VM) and the honest warning: **tool-only isolation does not constrain the host process or extension tools that do not use the isolated backend**. |
| `docs/custom-provider.md` | "Choose the smallest integration" table. The *complete Provider* vs legacy `ProviderConfig` split; the two `refreshModels` contracts (publish vs return); the six-step custom-stream contract; the rule that `options.onPayload` / `onResponse` / `onProviderStreamEvent` must be honoured "or the provider behaves differently from Pi's built-in providers". |
| `docs/docs.json` | The docs navigation tree plus four legacy-path redirects. |
| `docs/environment-variables.md` | The `PI_*` session env injected into the LLM's shell tools (`PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`) — resolved **per command**, so a model switch shows up on the next command. Process markers `AI_AGENT=pi` / `PI_CODING_AGENT=true`. |
| `docs/extensions.md` | **The largest and most valuable doc.** The full event taxonomy; the six handler-composition patterns (notification / in-place mutation / chained transformation / gate / actionable boundary / last override); the tool `exposure` axis; the MCP-style tool-annotation hints used for approval decisions; the nested-tool-call contract with its **bounded** `nestedCalls` record (8 KiB per call, 32 KiB per result, ≤256 calls, `complete: false` marker); and the state-storage decision table. |
| `docs/how-pi-works.md` | (see above) |
| `docs/images/doom-extension.png` | Binary screenshot asset (172 KB) — Tier 3, skipped. |
| `docs/images/exy.png` | Binary screenshot asset (1.5 MB) — Tier 3, skipped. |
| `docs/images/interactive-mode.png` | Binary screenshot asset (519 KB) — Tier 3, skipped. |
| `docs/images/tree-view.png` | Binary screenshot asset (282 KB) — Tier 3, skipped. |
| `docs/json.md` | The canonical event-stream reference. `agent_end` ≠ end of work; `agent_settled` is; `message_update` is **delta-only** ("so stream size remains linear") and `message_end` is authoritative; the `tool_execution_*` lifecycle; `compaction_start/end` with `reason` ∈ manual/threshold/overflow; `auto_retry_*` and `summarization_retry_*`. Warns that Node's `readline` mis-splits JSONL on U+2028/U+2029. |
| `docs/keybindings.md` | The complete named-action table (`app.session.new`, `tui.editor.*`, `app.thinking.cycle`, …), the key syntax, and the fact that an empty list **disables** an action's keybindings. Windows/WSL get different defaults for the same action id. |
| `docs/llama-cpp.md` | Local model router; and the interesting bit — **chat models re-used as classifiers**: the state is sent twice (state, questions, state, question-with-labels) and the answer is read from **next-token label probabilities**, confidence `(n*peak-1)/(n-1)`, with the warning that "raw label probabilities are usually overconfident" and a temperature knob that softens the distribution without changing the answer. |
| `docs/mcp.md` | MCP servers: config rules, OAuth (RFC 9728/8414/9207 discovery, `cimd` registration), the **exposure ladder** for MCP tools (`codemode` default / `deferred` / `direct` / `hidden`) with `toolExposure` per-tool overrides. Resource tools get the *widest* exposure among contributing servers; 20 KB middle-truncation; HTTP errors retried twice but tool calls **not** retried ("the server may already have performed them"). |
| `docs/message-types.md` | The shared `AgentMessage` union. `Usage.reasoning` "is already included in `output`; do not add it again" — a precise double-counting trap. `stopReason` has seven values including `"pending"` (never persisted) and `"deferred"`. |
| `docs/models-configuration.md` | **Generated** field reference for `models.json` — providers, models, overrides, `inputLimits`, and the per-API `compat` matrix. The "provider quirk ledger": every verified deviation from a standard API is one named boolean. |
| `docs/models.md` | Model selection, compatible endpoints, `promptCache` lifetimes, `samplingParamsByThinkingLevel`, and the **classifier / image model** families (Jev, Clef, Luna) that do not chat and are reached only through codemode. |
| `docs/nvidia-rtx-llama-cpp.md` | Converts NVIDIA single-model launch recipes into llama.cpp **router presets** (ini sections → model IDs). A clean example of turning "one command per model" into "one declarative file with many models". |
| `docs/packages.md` | Pi packages: one unit distributing extensions + skills + prompts + themes. The peer-dependency rule — host-provided packages must be `peerDependencies` with `"*"`, never bundled, because bundling "can bypass Pi's extension module mapping and create duplicate classes, registries, and initialization work". |
| `docs/prompt-templates.md` | Markdown → `/` command. The substitution grammar (`$1`, `$@`, `${1:-default}`, `${@:N:L}`) and the rule that extensions see the **raw input first** through the `input` event. |
| `docs/providers.md` | Credential resolution order (runtime `--api-key` → `auth.json` → `models.json` `apiKey` → env/ambient), the `!command` secret-manager form, and per-provider extras (Azure deployment-name mapping, Bedrock/Vertex ambient credentials, OpenRouter's key-scoped model list). |
| `docs/quickstart.md` | (see above) |
| `docs/rpc-commands.md` | Every RPC command with request/response JSON. `prompt`'s `data.disposition` ∈ `handled`/`queued`/`started`; `get_entries` with a `since` cursor as a **durable cursor across client restarts**; `get_state`'s `isStreaming`/`isCompacting`/`pendingMessageCount`. |
| `docs/rpc-extension-ui.md` | The extension-UI subprotocol: dialog methods (select/confirm/input/editor) block on a response; fire-and-forget methods (notify/setStatus/setWidget/setTitle/set_editor_text) do not; a `timeout` auto-resolves agent-side; and an explicit list of what is **degraded** in RPC mode. |
| `docs/rpc.md` | RPC framing and lifecycle. A successful `prompt` response does **not** mean the run completed; `agent_settled` is the signal. The Python minimal client uses a binary pipe reader precisely to avoid the Unicode-separator split bug. |
| `docs/sdk.md` | The in-process SDK. `session.systemPrompt` is read-only but reflects unsent changes; `prompt()` **rejects** rather than guessing when called during streaming without a steering choice; `SessionManager` is authoritative for finalized context ("Assigning `session.agent.state.messages` does not replace persisted context"). |
| `docs/security.md` | The threat model, stated plainly: "Watching the transcript, using project trust, and reviewing changes do not create a security boundary." Trust resolution order (CLI flag → extension handler → saved decision for the dir or an ancestor → global default). Declining trust does **not** undo the initial `sessionDir` lookup. |
| `docs/session-format.md` | The JSONL session contract: entry base (`id`/`parentId`/ISO timestamp), 13 entry types, and the three-stage context build (`buildContextEntries` → `buildSessionProjection` → `buildSessionContext`). The `context_edit` entry is **append-only** and changes *future model context only* — raw history, exports and accounting stay intact. |
| `docs/sessions.md` | Branching vocabulary (`/tree` vs `/fork` vs `/clone`), context management, export/share, and `/bug` (a **private** report that can include a model-written summary of the transcript, with a warning to review it first). |
| `docs/settings.md` | Every setting with type/default/description. `cacheWarming` = `off`/`streaming`/`idle` with a **$0.05 avoided-cost floor**; `retry.provider.maxRetries` default 0 with the reason ("Provider retries can delay Pi from handling quota and usage-limit errors itself"); `steeringMode`/`followUpMode`; `defaultProjectTrust` settable **only** in agent-dir settings. |
| `docs/shell-aliases.md` | The non-interactive shell model: `shellPath`, `shellCommandPrefix`, and why `.bash_aliases` beats sourcing `.zshrc` into bash. |
| `docs/skills.md` | Skills = a directory with `SKILL.md`; **name + description only in the prompt**, full text loaded on demand. The Agent Skills spec fields, the routing-quality rule ("Avoid descriptions such as 'Helps with PDFs'"), and that `/skill:name` forces a load. |
| `docs/slash-commands.md` | The built-in command list, and the honest statement that the in-session `/` menu is the *exact* reference for what is loaded. |
| `docs/terminal-setup.md` | Per-terminal key-protocol fixes, and the **Program Status Protocol (OSC 7501)**: pi reports `working` / `blocked` / `done` / `error` / `idle` so external dashboards can see agent state. "Reports never contain prompts or model output." |
| `docs/termux.md` | Android/Termux install, clipboard (text only), and the pattern of adding *environment facts* to `AGENTS.md` rather than making pi infer them. |
| `docs/themes.md` | Theme schema, six colour notations (hex / OKLCH / OKHSL / 256-index / var / terminal default), the **4.5:1 WCAG contrast floor** for body text, and the `light/dark` auto pair. |
| `docs/tmux.md` | Extended-key configuration for tmux 3.2–3.4 vs 3.5+ (`extended-keys-format csi-u`). |
| `docs/tui.md` | The component model: render to lines, invalidate + `requestRender()`, `visibleWidth()` not `string.length`, `Focusable` + `CURSOR_MARKER` for IME correctness, and "do not create a second terminal renderer inside an extension". |
| `docs/usage.md` | The interactive workflow; the three input modes (Enter = steer, Alt+Enter = follow-up, Escape = stop); `!` vs `!!`; `/debug` writing `pi-debug.log`. |
| `docs/virtual-models.md` | **The routing reference.** Selection vs dispatch are kept apart: the *virtual* pair is what the user picks and what `model_change` records; the *physical* pair is what each assistant message records. `route()` receives `reason` ∈ `user`/`continuation`/`retry`/`direct`, plus `previous`, `failed`, `state`, `messages`, `signal`. Sticky routing (`previous` for continuations) preserves prompt caches. Router `state` follows the session tree and survives compaction. |

#### `packages/coding-agent/examples/` — the implementation reference (3 top-level + 119 extension + 15 SDK = 137)

| File | What it is / what it pins |
| --- | --- |
| `examples/README.md` | Points at the SDK, RPC-client and extension example trees. |
| `examples/rpc-client.ts` | Typed `RpcClient` usage: subscribe → prompt → wait for `agent_settled` → stop. `promptAndWait()` installs the listener *before* prompting. |
| `examples/rpc-extension-ui.ts` | A hand-written RPC client that renders the extension-UI subprotocol (dialogs, widgets, status) in a custom TUI, with a `StringDecoder` + LF-split stdout reader. |

#### `packages/coding-agent/examples/extensions/` — one row per example

| File | What it is / what it pins |
| --- | --- |
| `README.md` | The catalogue; also pins two rules — use `StringEnum` for string params (Google API compatibility) and persist state in tool-result `details` so it forks correctly. |
| `auto-commit-on-exit.ts` | `session_shutdown` → `git status --porcelain` → derive a commit message from the last assistant text → `git add -A` + commit. |
| `bash-spawn-hook.ts` | Wraps the built-in bash tool via `createBashTool(cwd, { spawnHook })` to rewrite command/cwd/env before execution. |
| `bookmark.ts` | `pi.setLabel` / `getLabel` — user bookmarks on session entries, visible in `/tree`; `/unbookmark` clears the last one. |
| `border-status-editor.ts` | A `CustomEditor` whose border carries model, thinking level, context % and git branch; uses `fitBorder()` to truncate the left/right labels to the terminal width. |
| `built-in-tool-renderer.ts` | Overrides the *renderers* of read/bash/edit/write while keeping their behaviour: line counts, exit code, diff `+n/-n` stats, file size. |
| `claude-rules.ts` | Scans `.claude/rules/` on `session_start`, then **lists the rule file paths** in the prompt and lets the model `read` the relevant one — progressive disclosure. |
| `commands.ts` | `pi.getCommands()` + `getArgumentCompletions`; groups commands by source (extension/prompt/skill) and shows each one's source path. |
| `confirm-destructive.ts` | `session_before_switch` / `session_before_fork` → confirm → `{ cancel: true }`. Fails **closed** (no UI → no action). |
| `custom-compaction.ts` | Replaces auto-compaction with a full summary of the whole context, using **Gemini Flash** rather than the conversation model; falls back to the default on error or an empty summary; passes the abort `signal` through. |
| `custom-footer.ts` | `ctx.ui.setFooter()` — token/cost from the branch, git branch from `footerData.getGitBranch()`, `onBranchChange` to re-render. |
| `custom-header.ts` | `ctx.ui.setHeader()` — an ASCII mascot; `/builtin-header` restores the built-in header. |
| `custom-provider-anthropic/index.ts` | A full custom provider: OAuth PKCE, a hand-written `streamSimple` (content-block lifecycle, `input_json_delta` accumulation, `signature_delta` for thinking, `calculateCost`, `mapStopReason`), Anthropic cache_control, and — in OAuth mode — a **Claude Code tool-name mapping** so the same tool set is renamed on the wire. |
| `custom-provider-anthropic/.gitignore` | `node_modules/`. |
| `custom-provider-anthropic/package.json` | Example manifest with a `pi.extensions` key and an `@anthropic-ai/sdk` dependency. |
| `custom-provider-anthropic/package-lock.json` | Generated lockfile — Tier 3, skipped (head confirmed: lockfileVersion 3, one dependency). |
| `custom-provider-gitlab-duo/index.ts` | A provider that **delegates** streaming to the built-in `anthropicMessagesApi()` / `openAIResponsesApi()`, adds a 25-minute direct-access-token cache, and forces `forceAdaptiveThinking`. |
| `custom-provider-gitlab-duo/test.ts` | A manual test script that registers the API, builds a model, and streams. |
| `custom-provider-gitlab-duo/package.json` | Example manifest (no dependencies — it reuses the host's). |
| `custom-provider-gitlab-duo/.gitignore` | `node_modules/`. |
| `debug-provider.ts` | Toggleable raw provider-stream capture into a TUI-only session entry; uses `structuredClone(event.data)` and renders the JSON on expand. |
| `dirty-repo-guard.ts` | Blocks session switch/fork when `git status --porcelain` is dirty; no UI ⇒ block. Counts the changed files in the prompt. |
| `doom-overlay/README.md` | The DOOM demo's doc: 35 FPS, half-block rendering, 3.2:1 aspect, controls table, credits. |
| `doom-overlay/index.ts` | The overlay command; reuses a persistent engine across invocations (so a session can resume the same game). |
| `doom-overlay/doom-component.ts` | Renders the WASM framebuffer as half-block characters with 24-bit fg/bg colour; computes the row count from the width via `ASPECT_RATIO = 3.2`. |
| `doom-overlay/doom-engine.ts` | The WASM wrapper: `new Function(...)` to load the Emscripten module "to bypass jiti completely", injects the WAD into the virtual FS, and converts ARGB → RGBA. |
| `doom-overlay/doom-keys.ts` | Terminal key → DOOM key code mapping, handling both raw input and Kitty protocol sequences (including Shift for run). |
| `doom-overlay/wad-finder.ts` | Finds or downloads the shareware WAD, and **validates the magic bytes** (`IWAD`) before writing it. |
| `doom-overlay/doom/build.sh` | The Emscripten build script (resolutions overridable by env var; exports exactly the seven functions the JS side needs). |
| `doom-overlay/doom/doomgeneric_pi.c` | A tiny doomgeneric platform shim: framebuffer pointer, key queue, ticks. |
| `doom-overlay/doom/build/doom.js` | Emscripten loader — Tier 3, skipped (head confirmed: the standard Emscripten runtime). |
| `doom-overlay/doom/build/doom.wasm` | Compiled WASM binary — Tier 3, skipped (magic `00 61 73 6D` confirmed). |
| `doom-overlay/.gitignore` | Ignores the auto-downloaded `doom1.wad`. |
| `dynamic-resources/index.ts` | The `resources_discover` hook returning `skillPaths` / `promptPaths` / `themePaths`. |
| `dynamic-resources/SKILL.md` | A minimal skill with the Agent Skills frontmatter. |
| `dynamic-resources/dynamic.md` | A prompt template with a `description` frontmatter. |
| `dynamic-resources/dynamic.json` | A theme file (the `vars` → `colors` indirection, and the `export` block for HTML). |
| `dynamic-tools.ts` | Registers a tool on `session_start` and more at runtime via a command; validates the tool name against `/^[a-z0-9_]+$/` and refuses duplicates. |
| `entry-renderer.ts` | `pi.appendEntry` + `pi.registerEntryRenderer` — durable, LLM-invisible rows drawn in the transcript. |
| `event-bus.ts` | `pi.events.on/emit` for inter-extension communication. |
| `file-trigger.ts` | `fs.watch` a trigger file → `pi.sendMessage(..., { triggerTurn: true })` → clear the file. **The external-system-into-agent path.** |
| `git-checkpoint.ts` | `git stash create` per turn, keyed by entry id; `/fork` offers to restore the stash. Checkpoints cleared on `agent_settled`. |
| `git-merge-and-resolve.ts` | After each turn: fetch + merge upstream; on conflict, parse the conflict markers and send the agent a **structured conflict report** (file, line range, ours/theirs) as a follow-up. Re-sends unresolved conflicts from a previous incomplete merge. |
| `github-issue-autocomplete.ts` | Stacks a custom autocomplete provider; preloads open issues once per session and filters locally (numeric prefix first, then fuzzy). |
| `gondolin/index.ts` | Routes read/write/edit/bash/ls/find/grep into a local micro-VM; rewrites the system prompt's "Current working directory" line to the guest path. |
| `gondolin/package.json` | Example manifest with the `@earendil-works/gondolin` dependency. |
| `gondolin/.gitignore` | `node_modules/`. |
| `handoff.ts` | **Context transfer**: serialise the branch → ask a model for a *self-contained* new-thread prompt → put it in the editor → open a new session with `parentSession` tracking. Explicitly "instead of compacting (which is lossy)". |
| `hello.ts` | Minimal `defineTool` example. |
| `hidden-thinking-label.ts` | `ctx.ui.setHiddenThinkingLabel()`. |
| `inline-bash.ts` | `!{command}` expansion in prompts via the `input` event; 30 s timeout; whole-line `!` preserved; shows a preview of what was expanded. |
| `input-transform-streaming.ts` | Uses `event.streamingBehavior === "steer"` to **skip expensive preprocessing** during steering — latency-aware input handling. |
| `input-transform.ts` | Three `input` outcomes: `continue` / `transform` / `handled` (an instant local answer with no LLM call). |
| `interactive-shell.ts` | Detects interactive commands (60+ defaults, env-configurable) and **suspends the TUI** (`tui.stop()` → run → `tui.start()`) to give them the real terminal. Only intercepts user `!` commands, not the agent's bash tool. |
| `jev-router.ts` | **A complete virtual-model router.** A classifier picks the planning model; after the first successful `edit`/`write` the rest of the work moves to a cheap model; the phase is router *state* so it survives compaction. Explicitly accepts "a single prompt-cache miss". Sticky routing keeps the previous model for continuations. |
| `mac-system-theme.ts` | Polls macOS appearance every 2 s and switches the pi theme; clears the interval on `session_shutdown`. |
| `message-renderer.ts` | `registerMessageRenderer` for custom-message styling + expandable details. |
| `minimal-mode.ts` | Overrides the built-in tools' renderers so the collapsed view shows only a *count* ("→ 12 matches") and the expanded view the full output. |
| `modal-editor.ts` | A vim-like `CustomEditor` subclass (normal/insert modes) that preserves the app's shortcuts by forwarding unclaimed keys to `super.handleInput`. |
| `model-status.ts` | The `model_select` hook; shows the model in the status bar; skips the notification on `source === "restore"`. |
| `notify.ts` | Desktop notifications via OSC 777 / OSC 99 / Windows toast — **fired on `agent_settled`, not `agent_end`**, with the reason spelled out in a comment. |
| `overlay-qa-tests.ts` | 13 overlay QA commands: anchors (all 9), margins/offsets, stacking, width overflow with real streamed process output, terminal-edge placement, percentage positioning, maxHeight truncation, responsive side panel, visibility toggle, passive (non-capturing) overlay, focus cycling, and multi-panel streaming input. |
| `overlay-test.ts` | Overlay compositing with wide CJK characters, styled text and emoji; uses `CURSOR_MARKER` + `renderFakeCursor` for IME correctness. |
| `permission-gate.ts` | `tool_call` gate on `rm -rf` / `sudo` / `chmod 777`; **no UI ⇒ block**. |
| `pirate.ts` | `before_agent_start` returning a modified `systemPrompt`. |
| `plan-mode/index.ts` | A read-only "plan mode": write tools disabled, bash allowlisted, plan steps extracted from a `Plan:` header, `[DONE:n]` markers for progress, state persisted in a session entry, and on resume only messages **after** the last `plan-mode-execute` entry are re-scanned for completion. |
| `plan-mode/utils.ts` | The pure functions: `DESTRUCTIVE_PATTERNS`, `SAFE_PATTERNS`, `isSafeCommand()` (must be **not destructive AND safe**), `extractTodoItems()`, `extractDoneSteps()`, `markCompletedSteps()`. "Extracted for testability." |
| `plan-mode/README.md` | The plan-mode doc: features, commands, the allowlist/blocklist tables, and the two-mode lifecycle. |
| `preset.ts` | Named presets (model, thinking, tools, instructions) from `presets.json` (global + project); snapshots and restores the original state; persists the active preset name in a session entry; on restore it keeps the name for the instructions but does **not** re-apply model/tools. |
| `project-trust.ts` | The `project_trust` event: `yes` / `no` / `undecided`, with `remember`. First handler to decide wins. |
| `prompt-customizer.ts` | **Structured prompt editing**: writes into `event.systemPromptOptions.sections.tool_guidance` instead of replacing the whole prompt, and derives the guidance from the *actually selected* tools. |
| `protected-paths.ts` | Blocks `write`/`edit` to `.env`, `.git/`, `node_modules/`. |
| `provider-payload.ts` | Logs the exact provider payload and the response headers — the wire-audit pattern. |
| `qna.ts` | Extracts questions from the last assistant message into the editor, with a cancellable loader; refuses to run against an incomplete (`stopReason !== "stop"`) message. |
| `question.ts` | A `question` tool with a full custom UI: option list + inline "Type something." editor, Escape = back, Escape = cancel. `executionMode: "sequential"`. |
| `questionnaire.ts` | Multi-question input with a tab bar (Q1, Q2, …, ✓ Submit), per-question answer tracking, and a "Type something" escape hatch. |
| `rainbow-editor.ts` | Animated "ultrathink" highlight in a `CustomEditor`. |
| `reload-runtime.ts` | `ctx.reload()` from a command; the LLM-callable tool instead **queues a follow-up user command** because tools get `ExtensionContext` and cannot call `ctx.reload()` (deadlock avoidance). |
| `rpc-demo.ts` | Exercises every RPC-supported extension-UI method. |
| `sandbox/index.ts` | OS-level sandboxing via `@anthropic-ai/sandbox-runtime`, with a per-project `sandbox.json` deep-merged over a default config; `--no-sandbox` flag; the process **group** is killed on timeout; `SandboxManager.reset()` on shutdown. |
| `sandbox/package.json` | Example manifest with the sandbox-runtime dependency. |
| `sandbox/.gitignore` | `node_modules`. |
| `send-user-message.ts` | `pi.sendUserMessage()` with `deliverAs: "steer" | "followUp"`, and `ctx.isIdle()` to pick; refuses to guess when busy. |
| `session-name.ts` | `pi.setSessionName` / `getSessionName`. |
| `shutdown-command.ts` | `ctx.shutdown()` from a command and from a tool (deferred until idle). |
| `snake.ts` | A snake game with a custom UI; game state saved in a custom entry and **resumed paused**; ESC pauses and saves, Q quits and clears the save. |
| `space-invaders.ts` | A larger arcade game; same save/resume pattern; uses the Kitty key-release protocol for smooth movement. |
| `ssh.ts` | Delegates *all* tools to a remote machine by plugging pluggable `operations` (`readFile`/`access`/`writeFile`/`mkdir`/`exec`) into the built-in tools; resolves the remote cwd on `session_start` (CLI flags are not available during the factory) and rewrites the system prompt's cwd line. |
| `status-line.ts` | `ctx.ui.setStatus()` with themed turn progress. |
| `structured-output.ts` | A tool that returns `terminate: true` so the agent ends **on the tool call** — no extra LLM turn paid for. |
| `subagent/index.ts` | **The subagent implementation.** Spawns a separate `pi --mode json -p --no-session` process per invocation; three modes (single / parallel / chain); `MAX_PARALLEL_TASKS = 8`, `MAX_CONCURRENCY = 4`, `PER_TASK_OUTPUT_CAP = 50 KB`; parses the child's JSONL `message_end` events to accumulate usage; abort escalates SIGTERM → SIGKILL after 5 s; the chain stops at the first failing step; project-local agents need confirmation when the project is untrusted. |
| `subagent/agents.ts` | Agent discovery: markdown + YAML frontmatter (`name`, `description`, `tools`, `model`); walks up to the nearest `.pi/agents`; project agents override user agents on name collision; `parseToolList` accepts both `tools: read, bash` and `tools: [read, bash]`, and a bad file is skipped rather than taking down the directory. |
| `subagent/agents/scout.md` | The scout role: fast recon returning **compressed** context (file + exact line ranges + key code) for an agent that has not seen the files. |
| `subagent/agents/planner.md` | The planner role: reads context, produces a numbered plan, explicitly makes no changes; output format is fixed (Goal / Plan / Files to Modify / New Files / Risks). |
| `subagent/agents/reviewer.md` | The reviewer role: `git diff` → read → check; severity-bucketed output (Critical / Warnings / Suggestions) with `file:line` references. Bash is restricted to read-only commands "Assume tool permissions are not perfectly enforceable". |
| `subagent/agents/worker.md` | The worker role: full capabilities in an isolated context; output format tells the *next* agent which files changed and which functions were touched. |
| `subagent/prompts/implement.md` | Workflow: `scout → planner → worker`, passing output via the `{previous}` placeholder. |
| `subagent/prompts/scout-and-plan.md` | Workflow: `scout → planner`, explicitly "Do NOT implement - just return the plan". |
| `subagent/prompts/implement-and-review.md` | Workflow: `worker → reviewer → worker` — implement, review, then apply the feedback. |
| `subagent/README.md` | The subagent design doc: isolated context, the three tool modes, the per-task 50 KB cap, the security model for project-local agents, the agent roster table (scout/planner/reviewer/worker with their models and tools), and the error-handling matrix. |
| `summarize.ts` | Summarises the branch with a **pinned model** (`openai/gpt-5.2`), checks `hasConfiguredAuth` first, and shows the result in a transient overlay. |
| `system-prompt-header.ts` | Shows the system-prompt length in the status bar (`ctx.getSystemPrompt()`). |
| `tic-tac-toe.ts` | A game against the agent demonstrating `executionMode: "sequential"`: sibling tool calls share a cursor, so under parallel execution the `play` could resolve before the `move_*` calls. The cursor home is pinned at (0,0) so every non-origin play needs ≥1 move, making the race observable; the cursor is **not** reset on a failed play, so the agent can retry. The user cursor is never exposed to the model. |
| `timed-confirm.ts` | Dialogs with `{ timeout }` (agent-side auto-resolve) and with an explicit `AbortSignal`. |
| `titlebar-spinner.ts` | Braille spinner in the terminal title while working; stopped on `agent_settled` and `session_shutdown`. |
| `todo.ts` | A todo-list tool with `/todos`; state persisted in tool-result `details` and reconstructed on `session_start` **and** `session_tree` so it is branch-correct. |
| `tool-override.ts` | Overrides the built-in `read` with an **audited** version: an access log written through `withFileMutationQueue`, blocked secret patterns (`.env`, `secrets*`, `credentials*`, `~/.ssh`, `~/.aws`, `~/.gnupg`), 50 KB truncation, and reuse of the built-in renderer. |
| `tools.ts` | A `/tools` picker that persists the selection into a session entry and restores it on `session_start` **and** `session_tree` (branch-correct). |
| `trigger-compact.ts` | Compacts when context usage **crosses** 100 k tokens (a crossing, not a level) — and offers `/trigger-compact`. |
| `truncated-tool.ts` | Wraps ripgrep with proper truncation: `truncateHead` (keeps the first N) vs `truncateTail` (keeps the last N — the right choice for logs), `DEFAULT_MAX_BYTES` / `DEFAULT_MAX_LINES`, the full output to a temp file, and a truncation notice that names the omitted lines and bytes. |
| `widget-placement.ts` | Widgets above and below the editor. |
| `with-deps/index.ts` | An extension with its own npm dependency, to test that jiti resolves modules from the extension's own `node_modules`. |
| `with-deps/package.json` | Example manifest with the `ms` dependency. |
| `with-deps/.gitignore` | `node_modules/`. |
| `working-indicator.ts` | Custom streaming indicator: dot / pulse / spinner / none / reset. |
| `working-message-test.ts` | Verifies a custom working message survives loader recreation between turns. |

#### `packages/coding-agent/examples/sdk/` — 15 focused SDK examples

| File | What it is / what it pins |
| --- | --- |
| `README.md` | The index, a "Quick Reference" of the `createAgentSession` options and the event union, and a note that the runtime example shows a `recreate` function closing over process-global inputs. |
| `01-minimal.ts` | Create → prompt → observe → `dispose()`. `dispose()` is not optional. |
| `02-custom-model.ts` | Select a model three ways: exact provider/id, via the registry (including `models.json` models), or from the *available* list (those with working credentials). |
| `03-custom-prompt.ts` | Replace the prompt entirely (`systemPromptOverride`) vs append to it (`appendSystemPromptOverride`). |
| `04-skills.ts` | Discover, filter and add skills; a synthetic skill can be defined inline. |
| `05-tools.ts` | Built-in tool allowlists, including a read-only session (`["read","grep","find","ls"]`). |
| `06-extensions.ts` | Load file-based and inline extensions; the commented template shows the `tool_call` / `agent_start` / `agent_end` handlers. |
| `07-context-files.ts` | `AGENTS.md` discovery walking up from cwd, and overriding the set. |
| `08-prompt-templates.ts` | Add file-style prompt templates. |
| `09-api-keys-and-oauth.ts` | Point `authPath` / `modelsPath` elsewhere; set a runtime API key. |
| `10-settings.ts` | `applyOverrides`, `setDefaultThinkingLevel` + `flush()` as the durability boundary, and `drainErrors()` so **settings I/O errors are surfaced at the app layer** rather than swallowed. |
| `11-sessions.ts` | In-memory / new / continue-recent / list / open; `SessionManager.create(cwd, customDir)`. |
| `12-full-control.ts` | Replace *everything*: a hand-written `ResourceLoader` returning empty sets and a fixed system prompt. |
| `13-session-runtime.ts` | The **rebind** pattern: after `runtime.newSession()` / `switchSession()` the old subscriptions are dead, so `bindSession()` re-subscribes and re-binds extensions. |
| `14-codemode-mcp.ts` | Adds `codemode` / `tool_search` / MCP to the loader's `extensionFactories`; `settingsManager.applyOverrides({ defaultTools: ["+codemode", "+tool_search"] })` — the `+name` form so the default tools are *added to*, not replaced. |

#### `packages/coding-agent/schemas/` — generated JSON Schemas (4 files)

| File | What it is / what it pins |
| --- | --- |
| `keybindings.schema.json` | 12.8 KB. `additionalProperties` is a schema, so a typo'd action id is an editor error. 90 named actions in `properties` (plus a `$schema` passthrough), one `$defs/KeybindingValue` (a string or an array of strings). |
| `models.schema.json` | 46 KB. `required: ["providers"]`; `$defs`: `ModelCost`, `ModelInputLimits`, `ModelPromptCache`, `ProviderCompat` (42 compatibility flags), `ThinkingLevelMap` (the seven thinking levels). |
| `settings.schema.json` | 19.8 KB. 58 top-level settings (plus a `$schema` passthrough): model/thinking, interaction, tools, sessions, compaction, terminal, network/retry, shell, resources, updates. |
| `theme.schema.json` | 11.4 KB. `required: ["name","colors"]`; `additionalProperties: false`; `$defs/ColorValue` (the six colour notations); a separate `export` block for HTML export colours. |

### Tier 3 — skipped with a reason

Ten files are tier 3 (`assets` / `generated-vendored`). Each was confirmed on disk (name, exact size, format) and, where non-binary, its head was read; none was read line by line.

| File | Why it was not read line by line |
| --- | --- |
| `packages/coding-agent/docs/images/doom-extension.png` | Binary PNG screenshot, 171 987 bytes. Referenced from the extension docs purely as an illustration of the DOOM overlay. |
| `packages/coding-agent/docs/images/exy.png` | Binary PNG screenshot, 1 510 779 bytes. Documentation illustration only. |
| `packages/coding-agent/docs/images/interactive-mode.png` | Binary PNG screenshot, 519 083 bytes. Documentation illustration only. |
| `packages/coding-agent/docs/images/tree-view.png` | Binary PNG screenshot, 281 981 bytes. Documentation illustration only. |
| `packages/coding-agent/examples/extensions/custom-provider-anthropic/package-lock.json` | Generated npm lockfile, 651 bytes. Head read: `lockfileVersion: 3`, one dependency (`@anthropic-ai/sdk` ^0.52.0). |
| `packages/coding-agent/examples/extensions/gondolin/package-lock.json` | Generated npm lockfile, 6 043 bytes. Head read: `lockfileVersion: 3`, one dependency (`@earendil-works/gondolin` 0.12.0). |
| `packages/coding-agent/examples/extensions/sandbox/package-lock.json` | Generated npm lockfile, 3 116 bytes. Head read: `lockfileVersion: 3`, one dependency (`@anthropic-ai/sandbox-runtime` ^0.0.26). |
| `packages/coding-agent/examples/extensions/with-deps/package-lock.json` | Generated npm lockfile, 892 bytes. Head read: `lockfileVersion: 3`, one dependency (`ms` ^2.1.3). |
| `packages/coding-agent/examples/extensions/doom-overlay/doom/build/doom.js` | Generated Emscripten WASM loader, 64 607 bytes. Head read: the standard Emscripten runtime, exporting `_doomgeneric_Create`, `_doomgeneric_Tick`, `_DG_GetFrameBuffer`, `_DG_GetScreenWidth/Height`, `_DG_PushKeyEvent`, `_malloc`, `_free` — the exact seven symbols `build.sh` compiles in. |
| `packages/coding-agent/examples/extensions/doom-overlay/doom/build/doom.wasm` | Compiled WebAssembly binary, 380 169 bytes. WASM magic bytes `00 61 73 6D` confirmed on disk. |

Three further large files were read as head + tail rather than end to end, and the status TSV says so on each row: `overlay-qa-tests.ts` (46 KB, head 200 + tail 160 — a catalogue of 13 overlay QA commands), `tic-tac-toe.ts` (35 KB, head 120 + tail 120 — the `executionMode: "sequential"` rationale and the two tool contracts), and `space-invaders.ts` (15 KB, head 120 + tail 90 — the state model and the save/resume contract).

---

## 2. Ideas worth stealing

1. **The "smallest mechanism that meets your need" ladder** — `docs/quickstart.md` orders every customisation option from `AGENTS.md` (a text file) up to a package. August Trading's `docs/plan/open-items.md` is a proposal list; a published ladder like this would make "do we need a new service for this?" answerable without a design debate. *(`docs/quickstart.md`)*
2. **Tool *exposure* as a first-class, five-valued axis** — `direct` / `model-only` / `codemode` / `deferred` / `hidden`. Orthogonal to "is the tool registered". August Trading's desk-tool catalogue could use the same ladder — and the same rule that `hidden` **withdraws** a tool, because tools cannot be unregistered. *(`docs/extensions.md`, "Tool exposure")*
3. **A `codemode`-style script sandbox where only the *output* reaches the model** — the model writes a small program, the program calls tools in parallel and filters, and the model never sees the raw tool output. The single most transferable idea here for a trading app with fat tool results (order books, long klines). *(`docs/codemode.md`)*
4. **Declaration-vs-dispatch separation for routing** — a *virtual* model (what the user picks, what the transcript records) is kept strictly apart from the *physical* model (what each assistant message records). Replaying a conversation across physical models then works identically to a manual switch. *(`docs/virtual-models.md`, "Selection and dispatch")*
5. **Sticky routing that admits its cost** — a router that keeps the previous model for continuations and retries "keeps prompt caches and thinking signatures valid"; the reference example explicitly accepts "a single prompt-cache miss" as the price. *Naming the cost* is the point. *(`docs/virtual-models.md`; `examples/extensions/jev-router.ts`)*
6. **The `context_edit` append-only omission** — recovery from a context overflow does not delete the failed assistant turn; it appends an edit that omits it *from future model context only*, leaving raw history, exports and billing totals intact. This is the answer to "we lost the transcript". *(`docs/session-format.md`; `docs/compaction.md`, "Overflow and Length Recovery Ordering")*
7. **A crossing-triggered compaction** rather than a level-triggered one — the example fires only when usage *crosses* 100 k, so the trigger cannot re-fire every turn. *(`examples/extensions/trigger-compact.ts`)*
8. **The `terminate: true` tool result** — a structured-output tool that ends the turn on the tool call, so the app does not pay for a follow-up LLM turn that only repeats the answer. *(`examples/extensions/structured-output.ts`; `docs/extensions.md`)*
9. **`agent_end` vs `agent_settled` as two distinct signals** — one is "this low-level run ended", the other is "no automatic work remains". Every UI element, notification or audit record that says "done" must use the second. *(`docs/json.md`; `docs/extensions.md`; `examples/extensions/notify.ts`)*
10. **The bounded nested-call record** — nested tool calls are recorded with name, args, status, duration and error, and **never the result**, capped at 8 KiB per call, 32 KiB per result, 256 calls, with a `complete: false` flag when anything was dropped. A transcript that cannot blow up. *(`docs/extensions.md`, "Tools")*
11. **The classifier API (`choice` / `bool` / `score` with probabilities)** as a first-class non-chat model type, reachable from a script but not from the model picker. A trading app's "is this setup valid / how strong is this signal" questions are classifier-shaped, not chat-shaped — and the answer comes with a confidence number, which a chat answer does not. *(`docs/models.md`; `docs/codemode.md`, "Classify")*
12. **Generate the reference from the types, and fail the build on a stale definition** — `generate-references.ts` renders the doc from the same TypeBox schemas the JSON Schema is built from, and `generate-schemas.ts` throws on an unused `$defs` entry. *(`packages/coding-agent/scripts/generate-references.ts`, `generate-schemas.ts`)*
13. **Branch-correct state reconstruction** — `todo.ts` and `tools.ts` both restore their state on `session_start` **and** `session_tree`, from the *branch*, not the whole file. An extension whose state is global-to-the-session is wrong the moment the user takes a branch. *(`examples/extensions/todo.ts`, `tools.ts`)*
14. **The subagent as a *pipeline*, not a swarm** — `scout → planner → worker` and `worker → reviewer → worker`, with each role's output format written down as a contract ("Files Changed", "Key functions/types touched"). Debate-as-parallel-agents is absent; sequencing with an explicit handoff format is the design. *(`examples/extensions/subagent/`)*
15. **The project-agent trust confirmation** — a subagent that comes from a repo is repo-controlled code; the extension asks before running it, names the agents and the directory, and defaults the scope to user-level only. *(`examples/extensions/subagent/index.ts`; `README.md`, "Security Model")*

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** *not in this shard.* There is no cron, no scheduler, no catch-up, no idempotency key anywhere in these 191 files. The closest shapes are *reactive* rather than scheduled: `examples/extensions/mac-system-theme.ts` (a 2 s poll that starts on `session_start` and clears its interval on `session_shutdown` — the right lifecycle for a timer), `examples/extensions/file-trigger.ts` (a `fs.watch` that injects work into a live session), and `examples/extensions/git-merge-and-resolve.ts` (a post-turn reconciliation that re-sends unresolved conflicts from a previous incomplete merge — an *idempotent re-check* pattern). See the `pi-durable` / `pi-agent-env` shards for the scheduled surface.
- **Human-in-the-loop approval:** the strongest answer in the shard, and the pattern is **fail-closed** throughout. `permission-gate.ts`, `dirty-repo-guard.ts` and `confirm-destructive.ts` all return `{ block: true }` / `{ cancel: true }` when `ctx.hasUI` is false — no UI means no approval, and the default is refusal. The decision *input* is richer than a command regex: `docs/extensions.md` shows how to gate on MCP tool annotations (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`) instead of on tool names, with a worked example. `docs/rpc-extension-ui.md` defines a dialog subprotocol with a `timeout` that auto-resolves agent-side, and `examples/extensions/timed-confirm.ts` shows the `AbortSignal` form. The *audit record* is the weak half: a blocked call carries only a `reason` string, and nothing is persisted. August Trading's approvals inbox would map cleanly onto `tool_call` + `ctx.ui.confirm`, and would need to add the persistence pi does not have.
- **Post-mortem / reflection loops:** *not a lifecycle in this shard.* The nearest thing is `examples/extensions/handoff.ts` (a model writes a self-contained new-thread prompt from the serialised branch — "instead of compacting (which is lossy)") and `docs/compaction.md`'s fixed summary schema (Goal / Constraints & Preferences / Progress / Key Decisions / Next Steps / Critical Context) — a *structured* retrospective format. What is **absent** is the "outcomes become new rules" half and any gate on rule accumulation: `docs/skills.md` covers creation, frontmatter validity, routing quality and discovery, but never expiry, consolidation, usage measurement or retirement. A skill that is wrong stays wrong and is still advertised to the model forever. That gap is a finding, not something to copy.
- **Multi-agent:** `examples/extensions/subagent/` is the whole answer. Each subagent is a **separate `pi` process** (`--mode json -p --no-session`) with its own system prompt, tool allowlist and model — a genuinely isolated context window. Roles are separate markdown files with frontmatter; workflows are three *pipeline* presets (`scout → planner → worker`, `scout → planner`, `worker → reviewer → worker`) that pass output forward through a `{previous}` placeholder. The interesting part is the *absence*: there is no debate, no parallel "two agents argue", no consensus step. The design is **sequencing with a written handoff format** — each role's output format is specified so the next role can consume it without reading the previous transcript. The only parallel mode is `tasks: [...]` (max 8 tasks, 4 concurrent), which is fan-out, not debate. By contrast `examples/extensions/jev-router.ts` is the *single-agent* version of the same cost-control idea (a classifier picks the model; the work stays in one transcript).
- **Structured logs the model can query:** the answer is a **JSONL file with a tree, not a database**. `docs/session-format.md` defines 13 entry types, each with `id`/`parentId`/ISO timestamp; `docs/rpc-commands.md`'s `get_entries` accepts a `since` cursor so "an entry id works as a durable cursor: pass the last entry id you have seen … even across client restarts". Extensions write durable, LLM-invisible state with `pi.appendEntry()` and read it back from the *branch*. And `examples/extensions/tool-override.ts` shows the *query* side: an append-only access log guarded by `withFileMutationQueue()`. For a trading app, that is a trade log without a database — one JSONL per session, an append-only edit entry for corrections, and a cursor-based read.
- **Staying simple as features accumulate:** the docs are the evidence. The features are large (virtual models, codemode, MCP, branch summaries, packages) but the *user-facing* surface is held to four modes and one `/` menu: "Extensions, prompt templates, and skills can add commands. The command menu in Pi is therefore the exact reference for the resources loaded in your session" (`docs/slash-commands.md`). The other anti-bloat device is the exposure axis: the default for MCP tools is `codemode` — *not* declared to the model — so adding a server does not add to the model's context. And `codemode.inlineBudget` (3 000 estimated tokens) caps how many tool declarations the model sees at all. A third device is the **preset**: `examples/extensions/preset.ts` shows that a whole mode (model + thinking + tools + instructions) is one JSON object rather than four separate features.

---

## 4. Non-obvious decisions and gotchas

1. **`agent_end` is not "done".** The docs repeat it four times: retries, overflow recovery, compaction retries, steering and follow-ups can all start another run after `agent_end`. Only `agent_settled` means no automatic work remains. `examples/extensions/notify.ts` says so in a comment and fires on `agent_settled`.
2. **`message_update` is delta-only.** The wire format deliberately drops the cumulative `message` field and every `partial` snapshot "so stream size remains linear". A consumer must assemble deltas and then *replace* the reconstruction with the authoritative `message_end` content. Assembling the final message from deltas alone is a bug.
3. **`Usage.reasoning` is already inside `Usage.output`** — "do not add it again" (`docs/message-types.md`). A double-count inflates every cost total.
4. **`--tools` has two incompatible grammars.** A plain-name list *replaces* the selection; a `+name`/`-name`-only list *modifies* the default; and "Plain names and `+name`/`-name` entries cannot be mixed". The same dual grammar appears in the `defaultTools` setting and in the `settings.json` resource arrays.
5. **A project `.pi` entry can be a *partial override*.** An `mcp.json` project entry with only `{ "enabled": false }` overrides just that field of the user-level server and keeps `env`, `headers` and `auth`. The same "omitted = all, `[]` = none" grammar is used for package resource filters.
6. **`hidden` exposure withdraws a tool; it does not unregister it.** "Re-register a tool with `exposure: "hidden"` to withdraw it, since tools cannot be unregistered." `pi.unregisterProvider()` and `pi.unregisterVirtualModel()` exist; `unregisterTool` does not.
7. **A `tool_call` handler that *throws* blocks the tool.** "A `tool_call` handler failure blocks the tool as a fail-safe." Gate handlers must fail closed — and the examples implement that by hand (`permission-gate.ts`).
8. **`tool_result` handlers that redact `content` must also replace `structuredContent`** — "replacing only `content` drops it".
9. **Nested tool calls never enter the transcript.** They are recorded on the calling tool's result message as `nestedCalls` (metadata only, never results), with hard byte caps and a `complete: false` flag.
10. **The `codemode` options line must be the FIRST line** of the script — "an options line anywhere else fails the call before the script runs".
11. **`bash` output has two different limits.** The *model* sees 2000 lines / 50 KB; the *script* sees up to 1 MiB, with the first and last 512 KiB kept around an omission marker and the full text in a temp file. A codemode script can filter a result the model would never have been able to see whole.
12. **MCP tool calls are not retried, but MCP resource reads are.** "Tool calls are not retried because the server may already have performed them."
13. **A "successful" `prompt` RPC response can mean `handled`, `queued` or `started`.** Only `started` implies a run; `handled` means an extension consumed it and *no run will happen*.
14. **Context files (`AGENTS.md`) load even when project trust is declined.** Only `.pi/*` and project skills are trust-gated. "Treat instructions in a folder as untrusted input even when you decline project trust."
15. **Declining project trust does not undo the `sessionDir` lookup** — the one setting read before trust resolution, "so it can locate sessions".
16. **Codemode scripts cannot await a promise that never settles** — there are no timers in the sandbox, so a wait with no pending tool call fails immediately.
17. **`pi.sendMessage()` is not `pi.sendUserMessage()`.** The first sends a *custom* message (can carry `details`, can be `display: false`); the second reads as if the user typed it and *always* triggers a turn.
18. **A tool cannot call `ctx.reload()`.** Tools receive `ExtensionContext`, not `ExtensionCommandContext`; `examples/extensions/reload-runtime.ts` therefore queues `/reload-runtime` as a *follow-up user command* instead. The same split makes some command-only operations deadlock-prone.
19. **The tool that can end a turn is `terminate: true`, and it applies only "when every completed tool in that batch agrees to terminate"** — not per tool.
20. **`plan-mode` re-scans only the messages *after* the last `plan-mode-execute` entry on resume**, so a `[DONE:n]` marker from a *previous* plan does not mark the current plan's steps complete. A subtle, correct detail.
21. **A failed tool call does not reset shared state in `tic-tac-toe.ts`** — the cursor stays where it was so the agent can retry, and is reset only on success. The reset-on-success rule is pinned in a comment.
22. **`custom-compaction.ts` falls back to the default compaction** when its model is missing, the summary is empty, or the call throws — a custom summariser never breaks the session.
23. **`preset.ts` does not re-apply the model and tools on resume**, only the instructions: "Don't re-apply model/tools on restore, just keep the name for instructions." Re-applying would silently change the session's model.
24. **`handoff.ts` says compaction is lossy** and offers a generated self-contained prompt as the deliberate alternative — a direct statement that the auto-summary is not a substitute for a planned transfer.

---

## 5. Weak spots

1. **The trust model is presented as a boundary it is not.** `docs/security.md` is admirably honest — "Watching the transcript, using project trust, and reviewing changes do not create a security boundary" — but the whole `.pi/` resource system still ships executable TypeScript that runs **inside the Pi process with the user's permissions**. A project trust decision is a one-time yes/no on code that then has full ambient authority; `examples/extensions/custom-provider-anthropic/index.ts` even embeds a "Claude Code" identity header for OAuth mode. The only real containment is the optional containerisation/VM path, which is manual and off by default.
2. **The `compat` matrix in `models-configuration.md` is a growing pile of provider-specific booleans** (40+ flags across five APIs, each with a "Default: auto-detected from URL" note). It is a precise record of reality and simultaneously an admission that the "one API" abstraction does not hold. `docs/custom-provider.md` says compatibility flags should "describe verified differences" and "Do not enable them based only on an endpoint claiming compatibility" — but nothing in the schema verifies anything.
3. **Skills have no lifecycle beyond discovery.** `docs/skills.md` covers creation, frontmatter validity, routing-description quality and where they live — but not expiry, consolidation, usage measurement, or retirement. A skill that is wrong stays wrong and is still advertised to the model forever. The same is true of the "rules" a trading app would accumulate from outcomes: pi's learning story ends at compaction summaries.
4. **The demo games are shipped in the reference tree** — `doom-overlay/` (≈445 KB of WASM plus an Emscripten loader), `snake.ts`, `tic-tac-toe.ts`, `space-invaders.ts` — next to the real examples. They do exercise the overlay and `executionMode: "sequential"` paths genuinely, but they dilute a directory that calls itself "the implementation reference", and the DOOM example's `wad-finder.ts` **downloads a 4 MB file from the internet on first run**, which is an unpleasant default for an example directory.
5. **The generated-ness of the docs and schemas is only asserted in a comment.** `<!-- This file is generated from TypeScript source. Do not edit it manually -->` and a `$comment` in the JSON are the only markers. A hand-edit is caught by nothing visible in this shard. (The generator's own "unused `$defs` entry is an error" rule is a good precedent, but it is not applied to the reference pages.)
6. **Extension state is reconstructed by scanning the branch on every `session_start` and `session_tree`** (`todo.ts`, `tools.ts`, `plan-mode`). It is correct and branch-aware, but it is O(branch) work per navigation with no index — fine for a todo list, a scaling problem for anything bigger.

---

## 6. Ledger

See `pi-coding-agent-examples-docs.status.tsv` — one row per file, in file-list order (191 rows).
