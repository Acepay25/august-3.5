# deepseek-harness :: dsh-experimental-inspector

**Files in shard:** 340 (read: 338, skipped with reason: 2 — one SVG icon asset and one Chinese README translation; both listed in §1 Tier 3 with their reason)
**What this shard covers:** three "experimental" packages from the DeepSeek Harness monorepo that are all *observability and extension* packages rather than agent-loop packages: `claude-code-mods` (a compatibility bridge that runs Anthropic's Claude Code "mods" — hook modules with `register(on, options)` — as DSH plugins, with a middleware chain, a per-session `$` API, a "band above the prompt" drawing surface and a test kit); `inspector` (a Chrome-DevTools-Protocol-shaped debugging surface with a host/worker/client three-tier split, a shared typed wire protocol, a Cordis object-graph collector and a "query router" that answers structured questions about a live process); and `session-inspector` (a React client that renders a *session transcript* as an object tree / table / chat-node graph, with diff highlighting, reveal-scroll and a streaming log view). The shard is dominated by `inspector` (212 files), which is a whole sub-application built on the CDP protocol.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

---

### Part A — `packages/experimental/claude-code-mods` (62 files)

This package is a *compatibility bridge*: it takes a third-party plugin format (Anthropic's Claude Code "mods", which are ES modules exporting `register(on, options)`) and runs them inside DSH's agent loop. It is the most transferable idea in this shard for August Trading, because it is a plugin system with a hard, explicit failure vocabulary.

#### `packages/experimental/claude-code-mods/src/index.ts`
- **Purpose:** the bridge service (`ClaudeCodeMods`, a `TypertRemoteService`) that holds the loaded mods, registers the harness listeners that raise their events, and exposes the band to the Client over a Remote.
- **Key abstractions:** `ClaudeCodeMods` (service), `Config` (`hookTimeoutMs`, `catchTimeoutMs`, `processTimeoutMs`, `toolAliases`, `bandColumns`, `bandRows`), `SERVED_EVENTS` (the eight events this host actually raises: `session.start`, `session.end`, `prompt.submit`, `turn.start`, `turn.complete`, `tool.call`, `command.run`, `ui.render`), `DetachedRuns` (tracks fire-and-forget hook runs so disposal can abort and await them), `rewritePromptText`, `appendContext`, `acceptPromptSubmit`, `modAnswered`.
- **Data flow:** `agent/created` → `workingDirectory.ensure()` → `engine.raise('session.start')`; `agent/pre-step` → filter to human-authored (`source.kind === 'user'`) messages → `engine.raise('prompt.submit')` → the answer either replaces the prompt's text blocks, appends context blocks after the prompt, or `{ drop }` (which returns `{ kind: 'reject' }` and ends the turn as `blocked`); `tools/execute` → `engine.raiseWith('tool.call')` → `{ deny }` becomes an error-shaped result, `{ result }` is checked against the tool's own *output schema*; `session/event` `turn/start` / `assistant/message` / `turn/end` → fold a per-session `TurnRecord` → `engine.raise('turn.complete')` with answer text, duration, abort flag and token usage.
- **Non-obvious design decisions:**
  - `tool.call` runs **after** the harness permission decision, and a hook that tries to rewrite the *arguments* it passes to `next` is *skipped with a report* (`index.ts:411-424`) because "the call is logged before policy runs, so the arguments a hook passes down must be the logged ones". The refusal message names a design proposal file. This is a deliberate refusal to let a plugin lie in the audit trail.
  - A mod's `{ result }` answer only becomes a *successful* tool result when the value satisfies the tool's own declared output schema (`index.ts:437-445`); otherwise it is error-shaped with `MOD_ANSWERED`. A mod cannot smuggle a wrong-shaped value into the transcript as a success.
  - `session.start` / `session.end` fire for **root agents only**; subagent events carry `e.agentId` instead (`index.ts:322-326`).
  - A prompt submitted by a mod is framed as `Message from the "<plugin>" mod:\n<text>` unless `asUser: true` (`host-ops.ts:396-400`), so the model can tell whose words it is reading.
  - `redraw` is deferred by one macrotask (`setTimeout(..., 0)`) because "a mod sets its own state right after the `$` call that triggers the redraw resolves" (`index.ts:268-273`).
  - The band is *one instance per session* and is drawn by the **first** mod in load order whose `ui.render` hook returns a tree; `next(e)` yields to the next mod.
- **Edge cases & failure handling:** an unserved event is reported once at load; a hook failure is reported once per failure *kind*; `agent/disposed` raises `session.end` but keeps `$.state` readable until the hooks settle; a failed `register` fails only that plugin's mount, not the composition; `tools/result` clears the replacement map for calls that never reach `post-execute`.
- **Surprising:** `$.ui.open` always answers `{ isPlaced: false }` — the bridge places *no panes at all*; a mod that wants a pane degrades to the band. `$.ui.log` / `toast` / `status` reach the **host log**, not the GUI.

#### `packages/experimental/claude-code-mods/src/chain.ts`
- **Purpose:** the middleware chain that runs one event through the selected hooks, outermost first, with the engine behavior at the bottom.
- **Key abstractions:** `dispatch()`, `BudgetClock`, `HookTimeoutError`, `RewriteRefusedError`, `DispatchRequest`, `RegisteredHook`, `LoadedMod`.
- **Data flow:** `runFrom(index, input)` walks the selected hooks; a hook's `next(e)` runs the hooks beneath it *once* (a second call hands back the first promise); the core runs last.
- **Non-obvious design decisions:**
  - **The budget clock counts only the hook's own running time.** It *pauses* while the hook awaits `next` or any `$` call, and it counts *nested* pauses (`chain.ts:104-120`). This is the difference between "a hook may take 10 s of its own work" and "a hook may take 10 s of latency"; the former is a resource limit, the latter would make long I/O impossible.
  - A hook that **throws, times out, or settles with no result is skipped** and reported **once per failure kind** (`hook.reported: Set<string>`), so a broken hook does not spam the log on every event.
  - "The result from beneath stands when it had already called `next`" — a hook that fails *after* the tool already ran does not un-run it; the failure is reported and the chain continues.
  - A `.catch` handler shares the hook's *beneath state*: what the hook already ran is handed back, so nothing beneath runs twice (`runCatch`).
  - `null` is a legitimate answer ("a surface drawn empty"); only a hook that settles with a non-object is "no result".
  - `freezeInput` deep-freezes the event input at every depth, so a hook cannot mutate shared state.
  - `next.to()` always rejects: "Skipping tiers is a managed-settings feature this bridge does not implement".
- **Edge cases & failure handling:** an unobserved deadline rejection is swallowed at construction (`this.deadline.promise.catch(() => {})`); a late `next` from a timed-out hook resolves to `undefined`; the core's own error propagates without blaming the hook that awaited it.

#### `packages/experimental/claude-code-mods/src/engine.ts`
- **Purpose:** the Cordis-free engine: the loaded mods, the two dispatch directions, per-session `$.state`, and the timers mods start.
- **Key abstractions:** `ModsEngine<B>`, `OpCore` / `OpTable` / `OpResolver`, `OpDenied`, `OpContext<B>`, `TimerSet`, `RaiseOptions`.
- **Data flow:** `engine.raise(event, input, core, options)` runs an *engine* event through **every** selected hook; `engine.invoke(mod, op, input, binding, signal)` runs a *mods API call* through **only the mods loaded before the caller**, then the engine's own behavior.
- **Non-obvious design decisions:**
  - **Two dispatch directions with different visibility** (`engine.ts:236-247`): the engine event reaches everyone; a `$` call raised by mod *N* reaches only mods *0..N-1*. This makes "a plugin cannot see or re-enter its own call" a structural property rather than a convention. `tool.call` is special-cased to be raised from the tool pipeline instead (`engine.ts:279`).
  - `$.state` is keyed by *session key* then by `<plugin>\u0000<key>` slot, so two plugins cannot collide and two sessions cannot see each other's state.
  - Timers are owned **per (session, mod)**: `forgetSession` closes only that session's timers, `unload` closes only that mod's timers, and `close()` waits for callbacks already running so a mod cannot touch the host after unload.
  - The engine answers `state.*`, `clock.now` and `clock.sleep` itself when the resolver serves none — so the test kit and the host agree on them.
- **Edge cases & failure handling:** `$.clock.sleep` rejects on the event's abort signal, before *or* during the wait; a timer callback that throws is reported, not swallowed silently; `OpDenied` maps to `{ deny }` so the caller's `$` call rejects with the reason.

#### `packages/experimental/claude-code-mods/src/host-ops.ts`
- **Purpose:** the engine behavior of every `$` call, mapped onto the composed harness services (`ctx.commands`, `ctx.tools`, `ctx.fs`, `ctx.subprocess`, `ctx.userQuestions`, `ctx.workingDirectory`, `ctx.storageDomain`).
- **Key abstractions:** `createHostOps(options)`, `HostOpsOptions`, `AgentBinding`, `modToolName`, `toolCallResultOf`, `MODS_API_VERSION`, and the limit constants `FS_MAX_BYTES`, `STORE_MAX_BYTES`, `PROCESS_OUTPUT_MAX_BYTES`, `HTTP_MAX_BYTES` (all 4 MiB / 1 MiB).
- **Data flow:** each op receives the raw mod input as `unknown`, validates it with `record()` / `requireString()`, and returns a typed shape.
- **Non-obvious design decisions:**
  - **Every un-composed service fails with the service's *package name*** — e.g. `"$.fs needs a filesystem service (dsh-fs), which this deployment did not compose"`. The failure names the missing dependency rather than a generic error.
  - The `$.store` is a **storage domain** with one JSON object per plugin, capped at 4 MiB, and **concurrent writes to one plugin's record are serialized** through a per-plugin promise chain (`host-ops.ts:196-203`), so a read-modify-write cannot lose an update.
  - The store limit is counted in **UTF-8 bytes**, not characters.
  - `$.process.run` takes **argv without a shell**, spawns with `stdout`/`stderr` capped at 1 MiB, and combines the event signal with a timeout: `AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)])`.
  - `$.http.fetch` **cancels the response stream at the first byte past the bound** rather than buffering the whole body.
  - `$.fs` is resolved against the **validated current session directory**, and `$.fs.stat` follows symlinks (reporting `isLink: true`) but reports `mtimeMs: 0` — a known gap.
  - `$.env.get` / `$.env.set` touch the **process** environment, shared by every session and plugin (a documented limitation, not an oversight).
  - `$.tool.register` names the tool `mcp__<plugin>__<tool>` and validates the input schema at registration (`assertObjectJsonSchema`) so an unsupported keyword fails *that* call, not a later request.
  - `$.prompt.submit` frames the message with the mod's name and records the submission so the resulting `prompt.submit` event carries `origin: { kind: 'plugin', name }`.
- **Edge cases & failure handling:** `fs.stat` on a missing path throws `"does not exist"`; `fs.read` of an oversized file is refused before reading; `store.set` of a value that would exceed the budget is refused *before* the write.

#### `packages/experimental/claude-code-mods/src/api.ts`
- **Purpose:** builds the `$` object a hook receives, and the proxy that makes *unserved* members fail by name.
- **Key abstractions:** `createModsApi(binding)`, `ApiBinding`, `TimerHost`, `withUnservedMembers`.
- **Data flow:** every method shapes its arguments into a mods-API event and hands it to `binding.invoke`, which runs the earlier mods and then the engine's behavior. `call()` **pauses the budget clock** around the await; `fire()` is the fire-and-forget variant whose rejection is reported to the host log.
- **Non-obvious design decisions:**
  - **`withUnservedMembers` is the single most transferable trick in this package**: the served `$` is wrapped in a `Proxy` whose `get` returns a rejecting function for any member of a *known Claude Code namespace* that this host does not serve. A mod that reaches for `$.model.complete` gets `no implementation for model.complete` instead of a `TypeError`. The set of namespaces is a hard-coded list (`METHOD_NAMESPACES`), so the failure names the gap.
  - The `$` is **read-only**: `set`, `defineProperty` and `deleteProperty` all return `false`. The comment explains why the served object is *not* frozen: "the proxy below returns a wrapped namespace, which a frozen target's invariant would forbid".
  - `$.clock.sleep` is the one call that does **not** pause the clock — it counts as the hook's own time, matching Claude Code.
- **Edge cases & failure handling:** `$.ui.ask` normalises a bare array of labels into `AskOptions`; `$.tool.call` strips `tool_use_id` and `agentId` before dispatch.

#### `packages/experimental/claude-code-mods/src/module.ts`
- **Purpose:** runs a mod's `register(on, options)` and keeps the registrations in one ordered `HookRegistry`.
- **Key abstractions:** `HookRegistry` (`list`, `add`, `remove`, `select`, `unserved`, `describe`), `createOn(mod)`, `registerMod(definition, order)`.
- **Data flow:** `registerMod` validates the plugin name (`/^[A-Za-z0-9_-]{1,64}$/`), freezes the options, runs `register`, and returns the mod plus its hooks in registration order.
- **Non-obvious design decisions:**
  - **`on` refuses an unknown event name at load**, with Claude Code's own wording (`"tool.calls" is not an event`), so a typo fails loudly rather than registering a hook that never runs.
  - **One event may be registered without a matcher only once** — Claude Code's rule, enforced.
  - `select(event, raisedBy)` filters to hooks whose mod has a *lower* order than `raisedBy` and sorts by mod order — the "earlier mods only" rule, implemented in one place.
  - `describe(mod)` renders the `hooks:` line the way `claude plugin validate` prints it: `tool.call{tool=Bash}, fs.read, *`.
  - A `register` that throws is re-wrapped as `hooks module did not load: register threw <message>` with the original as `cause`.
- **Edge cases & failure handling:** a duplicate mod name throws (`another plugin of that name loads first`); `remove` on an unknown name is a no-op.

#### `packages/experimental/claude-code-mods/src/matcher.ts`
- **Purpose:** the event-name vocabulary and the field matchers that select hooks.
- **Key abstractions:** `ENGINE_EVENTS` (the engine-raised names), `KNOWN_EVENTS` (engine events **plus every mods-API method as `<namespace>.<method>`**), `isEventPattern`, `eventMatches`, `matcherMatches`, `describeMatcher`.
- **Data flow:** `matcherMatches(matcher, input)` compares each matcher field against the event input's top-level field of the same name — scalar by equality, array by membership, `RegExp` by test.
- **Non-obvious design decisions:**
  - **A global or sticky `RegExp` is reset before every test** (`expected.lastIndex = 0`) — "every event starts fresh". This is a real bug class in matcher engines and is fixed in one line.
  - **`*` selects every event *except* `telemetry.*`** — telemetry is opt-in by name.
  - `KNOWN_EVENTS` includes events this host *never raises*; they are separately tracked in `ENGINE_EVENTS` so `HookRegistry.unserved()` can name them at load.
- **Edge cases & failure handling:** a matcher against a non-object input is `false`; a `classic.*` glob is refused (no known event starts with `classic.`).

#### `packages/experimental/claude-code-mods/src/surfaces.ts`
- **Purpose:** the "band above the prompt": one drawn surface per session, with generations, held button callbacks, and change detection.
- **Key abstractions:** `SurfaceTable`, `SessionBand`, `SurfaceHost`.
- **Data flow:** `renderOnce` raises `ui.render` through the mods, validates the tree, serializes it with each `onPress` replaced by an action id (`a0`, `a1`, …), and notifies watchers. `stateRead`/`stateWritten` connect `$.state` slots to redraws.
- **Non-obvious design decisions:**
  - **Action ids count up per drawing**, so an *unchanged* tree serializes identically and **keeps its generation** — the client is not re-rendered for nothing.
  - **A press names the generation it saw.** A press from an earlier generation is ignored and reported (`band press ignored: a0 of generation 0 is not on the current drawing (1)`) — the classic "stale button" race, solved with a generation number rather than by hoping the client is fast enough.
  - **Overlapping refreshes coalesce**: three concurrent `refresh` calls produce exactly two render passes (one in flight, one more).
  - The band **subscribes to the `$.state` slots the last drawing read**; a write to another slot does not redraw.
  - A render that throws, or returns a tree that does not validate, becomes an **empty band** and a report — never a crash of the surface.
- **Edge cases & failure handling:** `forget(sessionId)` ends every watcher stream and stops further passes; `dispose()` forgets every band; a failing `onPress` is reported by the host and the band still redraws.

#### `packages/experimental/claude-code-mods/src/elements.ts`
- **Purpose:** the `Box` / `Text` / `Button` vocabulary a `ui.render` hook answers with, plus validation, serialization and the search a test uses.
- **Key abstractions:** `uiElements()`, `isUiElement`, `treeProblem`, `serializeTree`, `findAll`, `renderText`, `UiElement`, `UiNode`, `TreePattern`.
- **Data flow:** the constructors freeze the props; `treeProblem` walks the tree and returns the *first* problem as a sentence; `serializeTree` keeps scalars, flattens children, and replaces `onPress` with the id `holdAction` returns.
- **Non-obvious design decisions:**
  - Elements are **branded with a symbol** (`elementBrand`), so `isUiElement` cannot be fooled by a plain `{ type: 'Text', props: {} }` — the host will not serialize an object it did not build.
  - `scalarProps` silently drops non-scalar props and the `children` / `onPress` keys — the wire format is scalars only.
  - `findAll` matches on **the text an element draws, descendants included** — a `Box`'s text is the concatenation of its children, which is what a test wants to assert on.
- **Edge cases & failure handling:** `null` / `undefined` / `false` draw nothing; a number draws as its string; a non-element object in the tree is a validation error, not a crash.

#### `packages/experimental/claude-code-mods/src/testing.ts`
- **Purpose:** the test kit — load mods, stub the engine's answers, raise events, mount a surface, all without a session or a harness service.
- **Key abstractions:** `createModTestKit(options)`, `ModTestKit`, `TestKitRaisers`, `KitOn`, `MountedSurface`, `MountedElement`, `mock.store`, `mock.env`, `mock.clock`.
- **Data flow:** the kit builds a `ModsEngine` whose `ops` resolver answers from the registered stubs (or the built-in defaults), and whose `core` for an engine event answers from the stub or the `DEFAULT_ENGINE_ANSWERS` table.
- **Non-obvious design decisions:**
  - The kit's own mod (`claude-code-testing`) has `order: Number.MAX_SAFE_INTEGER`, so it is always *innermost* — a stub answers beneath every real mod.
  - **A stub must answer `{ value }` or `{ deny }`**; anything else is an error (`a stub returned neither { value } nor { deny }`). This keeps the "what did the engine answer?" question crisp.
  - `$.ui.mount` **re-renders on every read** (`tree()`, `text()`, `find()` all render afresh), so a test that changes state and re-reads sees the new drawing — the kit is a live surface, not a snapshot.
  - `mock.clock` advances the fake clock on `$.clock.sleep` instead of waiting — deterministic time.
- **Edge cases & failure handling:** mounting the same surface twice throws; a `press()` on a non-Button throws with the type in the message; `kit.reports` collects the engine's diagnostic lines so a test can assert on them.

#### `packages/experimental/claude-code-mods/src/define-mod.ts`
- **Purpose:** wrap a mod's `register(on, options)` as a DSH (Cordis) plugin.
- **Key abstractions:** `defineMod(spec)`, `ModSpec`, `ModPlugin`, `ModConfig`.
- **Data flow:** `apply(ctx, config)` calls `ctx.claudeCodeMods.add({ ...definition, options: { ...userConfig, ...config } })` and returns the disposer.
- **Non-obvious design decisions:**
  - The plugin's **name is prefixed** (`claude-code-mod-<name>`) so it cannot collide with a core plugin.
  - The plugin's `Config` is `z.dict(string|number|boolean|string[])` — the `userConfig` value types — and the composition's `config:` block *overlays* the `userConfig` defaults, which become `register`'s `options`.
  - The comment on the disposer notes that Cordis "collects even when the plugin was removed while `register` ran" — the race is handled by the host, not the plugin.
- **Edge cases & failure handling:** a `register` that throws fails the mount with the host's wording, and the rest of the composition continues.

#### `packages/experimental/claude-code-mods/src/tool-names.ts`
- **Purpose:** the two-way translation between Claude Code's tool names and the harness's.
- **Key abstractions:** `DEFAULT_TOOL_ALIASES` (`Bash→bash`, `Read→read`, `Edit→edit`, `Write→write`, `Glob→glob`, `Grep→grep`, `WebFetch→web_fetch`, `WebSearch→web_search`, `Task→subagent`, `TodoWrite→todo_write`, `AskUserQuestion→ask_user_question`, `ExitPlanMode→exit_plan_mode`, `Skill→skill`), `createToolNameAliases(overrides)`, `ToolNameAliases`.
- **Data flow:** `toMod(harnessName)` and `toHarness(modName)`, each falling back to the name itself.
- **Non-obvious design decisions:** the reverse map is built from the forward map, so an **override is automatically bidirectional**; an unknown harness tool keeps its own name in both directions.

#### `packages/experimental/claude-code-mods/src/types.ts`
- **Purpose:** the whole mod-facing type surface — the hooks-module contract, the event inputs/results, and the `$` interface.
- **Key abstractions:** `ModOn` (four overloads: typed-with/without-matcher for served events, open for every other name), `ModEvents` (the eight served events, typed), `ModsApi`, `HookNext`, `HookBudget`, `HookFailure`, `PromptSubmitResult` (a discriminated union with `{ drop }`), `ToolCallResult` (`{ deny }` | `{ result, isError? }`).
- **Data flow:** pure types; no runtime.
- **Non-obvious design decisions:** `HookNext.to(e, tier)` is typed but documented as always throwing; `HookRegistration.catch(handler)` returns `void` so a handler cannot be swapped after the fact. Field names follow Claude Code's declarations *so an unmodified mod type-checks against the same names*.

#### `packages/experimental/claude-code-mods/src/values.ts`
- **Purpose:** four small helpers — `messageOf`, `record`, `requireString`, `stringify`.
- **Key abstractions:** the four functions.
- **Data flow:** pure.
- **Non-obvious design decisions:** `stringify` is typed as `string | undefined` (JSON cannot carry `undefined`) so the caller must handle the case — used by the `$.store` size check and by `jsonValueOf`.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/experimental/claude-code-mods/README.md` | The package reference: the eight served events, the served `$` namespaces, the band semantics, the config table, the implementation map, and an explicit *Known Limitations* list (one drawing surface; `next` runs once; unserved events/namespaces; `tool.call` after the permission decision; one process, many sessions; no sandbox; `turn.complete` text goes to the host log; `$.session.usage` incomplete; `plugin.json`/`hooks.json` not read). |
| `packages/experimental/claude-code-mods/README.zh.md` | The Chinese translation of the above; the same decisions, same limitation list. |
| `packages/experimental/claude-code-mods/README.i18n.yaml` | Generated bilingual-pairing record: a hash per heading for the English and Chinese blocks, so a one-sided edit fails the pairing check. |
| `packages/experimental/claude-code-mods/cordis.source.patch.yml` | The opt-in source overlay: the bridge, the three example mods, and the web band, in mount order — with the note that "the guards that yield when idle come before Token Weather, which draws whenever it has a reading". |
| `packages/experimental/claude-code-mods/package.json` | Manifest: exports (`.`, `./types`, `./testing`, `./typert`, `./remote`), the peer dependencies the bridge needs composed, and the dev dependencies the tests need. |
| `packages/experimental/claude-code-mods/tsconfig.json` | Project references (18 workspace projects) and `include: ["src"]`. |
| `packages/experimental/claude-code-mods/examples/blast-radius/.claude-plugin/plugin.json` | The Claude Code plugin identity the example ships: name, version, description. |
| `packages/experimental/claude-code-mods/examples/blast-radius/hooks/blast-radius.d.mts` | The type shim that lets the `.mjs` hooks module type-check against `ModRegister`. |
| `packages/experimental/claude-code-mods/examples/blast-radius/hooks/blast-radius.mjs` | The human-in-the-loop guard: classifies a `Bash` command against five risk patterns, *measures* the blast radius with real subprocesses (`du -sh`, `find`, `git status --porcelain`, `git clean -n`, `git log HEAD..origin/main`), and **holds the call in a poll loop until a Proceed/Cancel button decides**; Cancel answers `{ deny: '...It would have: <summary>' }`. A failed measurement still lets the user decide. |
| `packages/experimental/claude-code-mods/examples/blast-radius/hooks/hooks.json` | Claude Code's own hook-module manifest (unused by this bridge). |
| `packages/experimental/claude-code-mods/examples/blast-radius/index.ts` | The DSH wrapper: `defineMod` with a `waitArgv` of the running Node executable so the cancellable hold works on Windows without POSIX `sleep`. |
| `packages/experimental/claude-code-mods/examples/blast-radius/tests/blast-radius.test.ts` | Pins: a safe command runs normally; a risky one is held; the band shows the risk summary; Cancel denies with the summary in the reason; Proceed lets it run; with a placed pane the band stays empty. |
| `packages/experimental/claude-code-mods/examples/replay-theater/.claude-plugin/plugin.json` | The plugin identity for the replay example. |
| `packages/experimental/claude-code-mods/examples/replay-theater/hooks/hooks.json` | The unused Claude Code hook manifest. |
| `packages/experimental/claude-code-mods/examples/replay-theater/hooks/replay-theater.d.mts` | The `ModRegister` type shim. |
| `packages/experimental/claude-code-mods/examples/replay-theater/hooks/replay-theater.mjs` | Records a turn's `Edit`/`Write` calls as diffs, seals them at `turn.complete` (one replay per turn, subagent turns do not disturb it), registers `/replay`, and draws a stepper with Prev/Next/Close. |
| `packages/experimental/claude-code-mods/examples/replay-theater/index.ts` | The `defineMod` wrapper for the replay example. |
| `packages/experimental/claude-code-mods/examples/replay-theater/tests/replay-theater.test.ts` | Pins: the command registers at session start; nothing shows until the turn ends; a subagent's turn does not disturb the sealed replay; the diff steps forward and back; the band hands over to the pane while it is open. |
| `packages/experimental/claude-code-mods/examples/token-weather/.claude-plugin/plugin.json` | The plugin identity, with the `types` pointer. |
| `packages/experimental/claude-code-mods/examples/token-weather/hooks/hooks.json` | The unused Claude Code hook manifest. |
| `packages/experimental/claude-code-mods/examples/token-weather/hooks/token-weather.d.mts` | The `ModRegister` type shim. |
| `packages/experimental/claude-code-mods/examples/token-weather/hooks/token-weather.mjs` | The published module unchanged: keeps a 12-reading history in `$.state` (so it survives a hot reload of the file) and draws a sparkline, a percentage and a per-turn delta above the prompt; only main-loop turns are sampled. |
| `packages/experimental/claude-code-mods/examples/token-weather/index.ts` | The `defineMod` wrapper: the blog's module and type contract run unchanged. |
| `packages/experimental/claude-code-mods/examples/token-weather/types/index.d.ts` | The published `PluginState` module augmentation (`declare module 'claude-code'`). |
| `packages/experimental/claude-code-mods/examples/token-weather/tests/token-weather.test.ts` | The published test, unchanged apart from three `as any` casts: the band shows "Clear" then "Showers" and the per-turn delta as the token count grows. |
| `packages/experimental/claude-code-mods/tests/bridge.spec.ts` | The full-loop proof: a scripted mock model drives the real agent loop, tool/command registries, filesystem, subprocess, user-questions and storage services. Pins the tutorial mod, the guard mod's deny + fail-closed `.catch`, the ticket mod's `mcp__` tool and prompt context, `prompt.submit` rewrite/drop/origin, `tool.call` answers and the **refusal of argument rewrites**, the whole `$` surface over a live HTTP server, `$.ui.ask` mapping (selection, typed answer, dismissal), commands and prompts raised by a mod, subagent `agentId` marking, malformed tool arguments, turn reasons, `$.session.usage` with the token meter, unserved-event reporting, disposal cancelling a sleeping timer, and the band end-to-end (Token Weather + Blast Radius + a throwing button). |
| `packages/experimental/claude-code-mods/tests/chain.spec.ts` | Pins the three moves (observe / rewrite / answer), outermost-first ordering with per-hook matcher evaluation, one-run-beneath-per-hook, a late `next` from a timed-out hook, the budget clock pausing inside `next` and `$` calls, and every `.catch` handler branch. |
| `packages/experimental/claude-code-mods/tests/host-ops.spec.ts` | Pins the op table against bare contexts: the missing-service wording for every namespace, input validation, the fs size limits, symlink reporting, `process.run` exit codes and timeouts, the store's 4 MiB budget (measured in UTF-8 bytes) and its write serialization, global (session-less) command/tool registration, and the committed-directory owner. |
| `packages/experimental/claude-code-mods/tests/module.spec.ts` | Pins `createOn`'s refusals (Claude Code's `plugin validate` rules), the registry's ordering and "earlier mods only" scoping, `registerMod`'s error wording, per-session `$.state`, the read-only `$` and the `no implementation for <ns>.<member>` rejection, and the timer lifecycle per mod and per session. |
| `packages/experimental/claude-code-mods/tests/surfaces.spec.ts` | Pins the band: action ids per drawing, the generation kept for an unchanged tree, a stale press ignored and reported, a watch ending when the band is forgotten, a redraw only for a subscribed `$.state` slot, refresh coalescing, a failed/invalid render becoming an empty band, and a failing `onPress` reported. |
| `packages/experimental/claude-code-mods/tests/testing.spec.ts` | Pins the test kit: the tutorial mod's `/tally`, configured options, `$.state` in the kit, a fire-and-forget call nobody answers being reported, stubs answering `{ value }` / `{ deny }`, `mock.store` / `mock.env` / `mock.clock`, the default answers for every bridged event, and `$.ui.mount` re-rendering on every read. |
| `packages/experimental/claude-code-mods/tests/define-mod.spec.ts` | Pins: the plugin name prefix, the config → `options` overlay, a mod removed while its `register` was still running, the defaults for `version` / `root`, and a `register` that throws failing only its own mount. |
| `packages/experimental/claude-code-mods/tests/directory-resume.spec.ts` | Pins: on a persisted resume, `$.session.cwd` reports the *final committed* directory while `$.session.root` keeps the original project. |
| `packages/experimental/claude-code-mods/tests/elements.spec.ts` | Pins: frozen branded elements, the validation messages, serialization with `onPress` → action id, `findAll` by type / drawn text / button label, and `renderText`. |
| `packages/experimental/claude-code-mods/tests/matcher.spec.ts` | Pins: the known event names, the globs (`*` excludes telemetry), the matcher comparison rules, the `plugin validate` matcher rendering, and the two-way tool-name aliases with overrides. |
| `packages/experimental/claude-code-mods/tests/loader-composition.spec.ts` | Pins the *real* Loader path: a `cordis.yml` row mounts the bridge and a mod by file URL; the mod's `/tally` answers through the composed command registry. |
| `packages/experimental/claude-code-mods/tests/examples.spec.ts` | Imports the three example mods' own `claude plugin test` files into the spec lane so the coverage inventory sees them. |
| `packages/experimental/claude-code-mods/tests/support/claude-code-testing.ts` | The `claude-code/testing` shim: `describe` / `test` / `expect` from Vitest, `tier` accepted for source compatibility, and the *inference* of the mod under test from the test file's location or the outermost `describe` name. |
| `packages/experimental/claude-code-mods/tests/support/claude-code.ts` | The `claude-code` module a mod's `types/index.d.ts` augments (`PluginState`), plus the type re-exports. |
| `packages/experimental/claude-code-mods/tests/fixtures/first-mod.mjs` | Claude Code's tutorial mod unchanged: registers `/tally`, counts tool calls, restyles the spinner (a render site this bridge never raises). |
| `packages/experimental/claude-code-mods/tests/fixtures/first-mod.ts` | The tutorial mod wrapped as a `defineMod` plugin. |
| `packages/experimental/claude-code-mods/tests/fixtures/first-mod.d.mts` | The `ModRegister` type shim. |
| `packages/experimental/claude-code-mods/tests/fixtures/guard-mod.mjs` | A `tool.call` guard that refuses a force push / `rm -rf`, logs what ran, and **fails closed** through `.catch`. |
| `packages/experimental/claude-code-mods/tests/fixtures/guard-mod.ts` | The guard mod wrapped as a plugin. |
| `packages/experimental/claude-code-mods/tests/fixtures/guard-mod.d.mts` | The `ModRegister` type shim. |
| `packages/experimental/claude-code-mods/tests/fixtures/ticket-mod.mjs` | Registers a model-facing tool, answers `mcp__ticket-mod__ticket` calls, appends branch context to a PR prompt, and adds a line under each answer. |
| `packages/experimental/claude-code-mods/tests/fixtures/ticket-mod.ts` | The ticket mod wrapped as a plugin. |
| `packages/experimental/claude-code-mods/tests/fixtures/ticket-mod.d.mts` | The `ModRegister` type shim. |

### Tier 3 — skipped with a reason

None. Every file in Part A was opened and read.



### Part B — `packages/experimental/inspector` (212 files)

This package is a **cross-realm Chrome DevTools Protocol hub**. A Host plugin starts a Node `worker_threads` Worker that owns *all* CDP state; the Worker serves the loopback HTTP discovery endpoints, the DevTools WebSocket, and a Client-ingest WebSocket. The Host and every browser Client publish *internal observation records* (not CDP messages) to the Worker, which translates recognised topics into standard CDP domains. A third, CDP-independent query API lets a program read the same Cordis tree without opening a DevTools session.

The most transferable idea here for August Trading is the **observation record pipeline**: producers publish lossless JSON on a declared topic, the transport sequences and bounds them, overflow is reported as a *sequence gap* rather than a dropped event, and the consumer is free to be a different protocol (CDP) or a different consumer (the query API).

#### `packages/experimental/inspector/src/index.ts`
- **Purpose:** the repository-facing Host package entry: the `Config` schema, the `apply` wrapper, and the re-exports.
- **Key abstractions:** `Config` (26 fields), `InspectorService` (the `ctx.inspector` façade), `name`, `inject` (`['webServer', 'connection']`).
- **Data flow:** `apply(ctx, config)` delegates to the mirrored Host implementation.
- **Non-obvious design decisions:**
  - `host` is `z.const('127.0.0.1')` — **loopback is not configurable**, it is a type-level constant. The Worker config decoder re-checks it (`control-codec.ts:29`).
  - Every numeric limit's default comes from `resolveInspectorOptions()` (the *library* defaults), so the schema and the library cannot drift.
- **Edge cases & failure handling:** the plugin `inject`s `webServer` and `connection`; the Host registers a bootstrap route before the Worker is ready.

#### `packages/experimental/inspector/src/host/plugin.ts`
- **Purpose:** the Host Cordis plugin: starts the Worker, provides `ctx.inspector`, injects the Client bootstrap, serves the mirrored DevTools frontend, and proxies the CDP upgrade.
- **Key abstractions:** `apply(ctx, config)`, `bootstrapResponse`, `isUnavailableOnPlatform`, `DEVTOOLS_PATH`.
- **Data flow:** `ctx.effect(async () => {...})` registers the bootstrap route *first* (so a Client that publishes during startup **waits** rather than failing), then `startInspector(spec)`, then the Cordis tree publisher, `ctx.provide('inspector', …)`, the index injection, the static asset route and the WebSocket upgrade route.
- **Non-obvious design decisions:**
  - **`ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` is the one failure that does NOT fail the plugin.** The Worker cannot run in a browser Worker host; the Host logs one warning and keeps only the bootstrap route, which answers `503`. Every other startup error rolls back and rejects the fiber.
  - The bootstrap route answers `503` when the Inspector is unavailable, and **an aborted request stops waiting** rather than holding the connection.
  - The DevTools frontend is served under the *application-relative* `inspector/devtools/` path, using the **existing Web login**; `GET`/`HEAD` serve files, other methods answer `405`, and the prefix redirects to the entry.
  - The CDP upgrade route **authenticates the same browser session** and forwards only to this Inspector's Worker page target; an invalid `clientSourceId` selector answers `400` and *"must not open an unfiltered connection"*.
  - `console.log` is used for the readiness URL because "this readiness URL is emitted while the plugin tree is still loading, before a logger sink is guaranteed".
  - The `--inspect` flag only opens a Chrome window; it does not control whether the Inspector runs.
- **Edge cases & failure handling:** `disposeInspectorResources` runs every disposer in **reverse acquisition order** and aggregates failures; rollback on a failed registration closes the already-started Worker.

#### `packages/experimental/inspector/src/host/bridge/controller.ts`
- **Purpose:** owns the Worker and the Host source; resolves and validates every option.
- **Key abstractions:** `InspectorOptions` (30 fields), `InspectorSpec` (the fully resolved form), `InspectorEndpoint`, `InspectorHandle`, `resolveInspectorOptions`, `startInspector`.
- **Data flow:** `resolveInspectorOptions` → `startInspector` → `MessageChannel` → `Worker` (with `workerData` boot + a transferred `MessagePort`) → `HostInspectorSource` on `port1` → the `ready` frame → the endpoint URLs → `installFetchObserver`.
- **Non-obvious design decisions:**
  - **The client protocol is a random 32-byte token**: `dsh-inspector-v0-<base64url>`, used as the WebSocket subprotocol the Client must present.
  - `resolveInspectorOptions` **cross-validates** the options: `maxSourceFrameBytes` must be able to carry one base64 body chunk (`ceil(chunk/3)*4 + 4096`), `clientReconnectMaxMs ≥ clientReconnectBaseMs`, and every `clientOrigins` entry must be **canonical** (`new URL(origin).origin === origin`).
  - The `devtools://` URL is built with `panel=elements` and `noJavaScriptCompletion=true`.
  - `spawnWorker` has a **source-mode path** that bootstraps `tsx/esm/api` inside a `data:` URL so the Worker can run TypeScript sources without a profile install.
- **Edge cases & failure handling:** if the source is constructed but the Worker never becomes ready, the source is closed and the Worker terminated; `close()` is idempotent through a memoised promise; a Worker failure after `markRunning` closes the source and stops the fetch observer.

#### `packages/experimental/inspector/src/shared/bridge/buffer.ts`
- **Purpose:** the realm-neutral bounded buffer behind both source transports.
- **Key abstractions:** `InspectorSourceBuffer`, `InspectorSourceBufferOptions`.
- **Data flow:** `publish`/`setState` validate and enqueue; `takeBatch` removes and sequences the next transport-sized batch; `replacement` emits the complete retained state.
- **Non-obvious design decisions:**
  - **Overflow is reported, not hidden**: the oldest prefix is dropped and the next append frame carries `droppedBefore = firstSequence - expectedSequence`, so the consumer *knows* it lost records.
  - A record larger than one frame is dropped **after consuming its sequence number** — the gap is visible rather than the sequence silently repeating.
  - `setState` **restores the previous value** if the new state would not fit the frame budget, and then throws — it never leaves a half-applied state.
  - `takeBatch` refuses to include a record whose sequence is not contiguous with the batch (`candidate.sequence !== first.sequence + batch.length` breaks the loop) — a non-contiguous batch would be a lie.
- **Edge cases & failure handling:** a topic longer than 128 characters or not declared by the source is refused; the payload must be lossless JSON; `monotonicMs` must be finite.

#### `packages/experimental/inspector/src/shared/bridge/rpc.ts`
- **Purpose:** the shared correlated query owner for Host and Client sources.
- **Key abstractions:** `InspectorQueryConnection`, `InspectorQuerySender`, `InspectorQueryRemoteError`.
- **Data flow:** `connect(sourceId, generation, sender)` admits a generation; `request(query)` allocates an id, bounds the frame, and sends; `receive(value)` decodes and settles.
- **Non-obvious design decisions:**
  - **`connect` disconnects the previous generation first** — "Inspector source generation replaced" — so a stale carrier can never answer a live request.
  - A response whose `sourceId`/`generation` do not match the active one is rejected, not applied.
  - A response whose `op` does not match the pending request's `op` is rejected — a cross-method settlement is impossible.
  - `disconnect` rejects the pending calls but *permits a later generation*; `close` is permanent.
- **Edge cases & failure handling:** a timeout is per-request; a malformed response disconnects the connection and rethrows.

#### `packages/experimental/inspector/src/shared/bridge/control-codec.ts`, `messages/observation.ts`, `messages/query/*`, `messages/runtime/*`, `messages/sources/*`
- **Purpose:** the exact decoders for every wire frame. These are the package's real contract.
- **Key abstractions:** `parseInspectorWorkerConfig`, `parseInspectorHostControl`, `parseInspectorWorkerControl`, `parseInspectorClientBootstrap`, `parseSourceFrame`, `parseWorkerSourceFrame`, `parseInspectorQueryRequestFrame`, `parseClientRuntimeCommand`, `parseClientRuntimeResult`, `parseClientSourceCommand`, `parseClientSourceResult`.
- **Data flow:** every decoder **rebuilds** the value it accepts (it does not pass the untrusted object through), so a decoded frame is a fresh, well-typed object.
- **Non-obvious design decisions:**
  - **`exactKeys` rejects unknown fields.** A frame with an extra field is invalid, not "extra data to ignore" — this is what makes the protocol versionable.
  - The Client bootstrap **must** be a `ws:` URL on `127.0.0.1`; anything else is refused by the decoder.
  - `source/open` may not declare a Client capability for a Host source; a capability type may not be declared twice; a topic must be 1–128 characters.
  - `parseCordisRuntimeTree` rejects a **repeated `sourceId`** and a **repeated Fiber `uid`**.
- **Edge cases & failure handling:** every numeric field goes through `natural(value, label, zero)` — a safe integer with an explicit lower bound.

#### `packages/experimental/inspector/src/shared/cordis/collector.ts`
- **Purpose:** the shared Host/Client projection from *live* Cordis objects to a bounded, serialisable tree.
- **Key abstractions:** `CordisTreeCollector`, `CordisTreeLimits`.
- **Data flow:** `collectContexts(root)` walks the registry's fibers and the root's event hooks; the tree is then projected into `CordisTreeNode`s with retained object handles.
- **Non-obvious design decisions:**
  - **Cordis's `shadow` prototype wrappers are unwrapped** (`Symbol.for('cordis.shadow')`), so the tree shows the real Context/Fiber graph rather than Cordis's service-call proxies.
  - **A Fiber owns exactly one Context child**, and the Context-only layers (`extend()`, `isolate()`, `intercept()`) stay direct Context descendants.
  - The snapshot is **bounded twice**: by node count and by *encoded byte size*. When it is too large, the collector **prunes the last child repeatedly** and marks the snapshot `truncated` — the tree degrades gracefully instead of failing the transport.
  - The live-object table is replaced **atomically**: `objects.begin()` … `objects.commit()` — a snapshot never exposes a half-built registry.
  - The traversal depth is capped at 100 and a breach marks the snapshot truncated.
- **Edge cases & failure handling:** a root Context that cannot be retained is a hard error; a disposed fiber (`uid === null`) is skipped.

#### `packages/experimental/inspector/src/shared/cordis/object-registry.ts`
- **Purpose:** realm-local retention and identity for the live objects a snapshot names.
- **Key abstractions:** `RealmObjectRegistry`, `RealmObjectGeneration`, `realmObjectExpression`, `identifyRealmObject`, `IDENTIFY_REALM_OBJECT_FUNCTION`.
- **Data flow:** the registry lives in a **global symbol table** (`Symbol.for('dsh.inspector.realm-object-registries')`) so the Worker can resolve an object *inside the inspected realm* by evaluating one expression.
- **Non-obvious design decisions:**
  - **`identify` walks through nested `then`-only wrappers** (Cordis's plugin call facades) up to 8 levels, and refuses anything else. A hostile proxy cannot escape: the `catch` returns `undefined`.
  - The identity function sent through CDP is **self-contained** — it reads the global symbol table and asks each registry.
  - `retain` gives an object a **stable handle** across generations; the strong-reference set is replaced atomically on `commit`.
- **Edge cases & failure handling:** a committed generation cannot be mutated; `close()` removes the registry from the global table and drops every strong reference.

#### `packages/experimental/inspector/src/shared/json.ts` and `shared/validation.ts`
- **Purpose:** the lossless-JSON and exact-field primitives every decoder uses.
- **Key abstractions:** `isJsonValue`, `requireJsonObject`, `jsonByteLength`, `isPlainObject`, `exactObject`, `exactKeys`, `wireId`, `optionalString`, `optionalBoolean`, `optionalNonNegativeNumber`.
- **Data flow:** `visitJson` walks the value with an **ancestor set** so a cycle is rejected.
- **Non-obvious design decisions:**
  - **`isJsonValue` rejects `-0`, `NaN`, `Infinity`, exotic arrays, accessor properties, symbol keys and non-enumerable own properties** — the value must survive both a `MessagePort` structured clone and a JSON WebSocket *without coercion*.
  - `jsonByteLength` measures the **UTF-8** size, which is what the byte limits are about.

#### `packages/experimental/inspector/src/worker/bridge/hub.ts`
- **Purpose:** the Worker-side owner of every source generation.
- **Key abstractions:** `InspectorSourceRegistry`, `InspectorSourceEvent`, `InspectorRecordConsumer`, `SourceConnection`, `IngestedInspectorRecord`.
- **Data flow:** `receive(connection, value)` parses and applies a frame; `apply` dispatches by frame type; `send` writes a Worker-to-source frame to one still-active generation.
- **Non-obvious design decisions:**
  - **A malformed frame closes only its own source transport** and sends `source/rejected` — one broken Client cannot take the Worker down.
  - **A sequence gap triggers a `source/resnapshot` request** instead of silently accepting a hole: the Worker asks the source to resend its complete state.
  - `open` for an existing `sourceId` **closes the prior generation first** ("source generation replaced").
  - A source that sends a Client-only frame without declaring the matching capability is refused.
  - A topic the source did not declare is refused.
- **Edge cases & failure handling:** every listener is isolated in a `try/catch` — "a diagnostic observer is isolated from source admission and later observers".

#### `packages/experimental/inspector/src/worker/bridge/runtime-rpc.ts` and `source-rpc.ts`
- **Purpose:** the two correlated Worker→Client routers (Runtime/Console, and the source catalog).
- **Key abstractions:** `ClientRuntimeRouter`, `ClientRuntimeTarget`, `ClientSourceRouter`, `ClientRuntimeRemoteError`, `ClientSourceRemoteError`.
- **Data flow:** `request(target, sessionId, command)` sends a typed frame and waits for the correlated response; `subscribeConsole` enables a Console session for one DevTools connection.
- **Non-obvious design decisions:**
  - **A Client execution context id is negative** (`nextContextId--` from `-1`), so a synthetic Client context can never collide with a native Node context id.
  - The `uniqueContextId` is `dsh-client:<sourceId>:<generation>` — it identifies the *generation*, so a reconnect is a new context.
  - A response whose `op` does not match the request is a **correlation mismatch**, and the Worker then *cancels* the Client's response so the Client can roll its handles back.
  - The source chunk size is derived from the frame budget: `floor((maxFrameBytes - 4096) * 3 / 4)`.
- **Edge cases & failure handling:** a timeout cancels the in-flight Client request before rejecting; a closed source rejects every pending request.

#### `packages/experimental/inspector/src/worker/cdp/session.ts`, `realm-sessions.ts`, `protocol.ts`, `target.ts`, `ids.ts`
- **Purpose:** one DevTools connection's dispatcher and its supporting types.
- **Key abstractions:** `CdpSession`, `InspectorRealmSessionSet`, `parseCdpRequest`, `cdpError`, `sendCdpFailure`, `respondToCdpRequest`, `handleScaffold`, `CDP_METHOD_NOT_HANDLED`, `cdpStringId`, `cdpNumericId`.
- **Data flow:** `receive(value)` parses a request, then tries the DOM, Runtime, Debugger and native domains in turn, then the Network domain, then the `DSHInspector.*` diagnostic domain, then the page scaffold.
- **Non-obvious design decisions:**
  - **The `DSHInspector` diagnostic domain is the package's own CDP extension**: `enable`, `disable`, `getSources`, `getCordisTree`. `getCordisTree` answers the *detached, consumer-neutral* tree — no routing handles, no CDP ids.
  - The **client selection is a display filter, not authorisation**: `visibleSources()` and `visibleTree()` narrow the view; they do not stop collection.
  - `handleScaffold` answers the page-target methods DevTools needs (`Page.getFrameTree`, `Target.getTargetInfo`, `Browser.getVersion`) with a synthetic `dsh://host` frame, and returns `CDP_METHOD_NOT_HANDLED` for anything else so the caller can answer `-32601 Method not found`.
  - Every CDP id is **branded and connection-scoped**; a `CdpNodeId` and a `CdpBackendNodeId` are different numeric roles.
- **Edge cases & failure handling:** an invalid frame closes that client only; `close()` releases the network subscription, the DOM session, the Runtime session, the Debugger session, the native domains and the realm sessions.

#### `packages/experimental/inspector/src/worker/cdp/domains/runtime/session.ts` and `object-table.ts`
- **Purpose:** the Runtime domain routed across *uniform* Host and Client realms.
- **Key abstractions:** `RuntimeDomainSession`, `RuntimeObjectTable`, `RuntimeObjectObserver`, `CdpRuntimeCompletion`.
- **Data flow:** `handle(request)` dispatches `Runtime.*`; each realm is addressed by a numeric context id or a `uniqueContextId`; the object table maps realm-local backend handles to connection-local CDP `objectId`s.
- **Non-obvious design decisions:**
  - **A Client context id is negative and a missing one is an explicit error** ("Client execution context is no longer available") rather than a silent fallback to the Host — falling back to the Host would evaluate in the wrong realm.
  - `callFunctionOn` **refuses to pass an object between realms**.
  - `nativeParameters` rewrites CDP object ids into *native* backend handles for a Host-native request, and throws if the realm has no native domains.
  - The object table allocates `runtime:<connectionId>:<n>` ids and releases them per realm, per group, or wholesale.
- **Edge cases & failure handling:** `Runtime.enable` rolls back every realm it enabled if one fails; a closed realm's objects are released and its synthetic context destroyed.

#### `packages/experimental/inspector/src/worker/cdp/domains/dom/model.ts` and `session.ts`
- **Purpose:** the semantic DOM projection of the Cordis tree and its per-connection DOM session.
- **Key abstractions:** `CordisDomBackend`, `CordisDomNode`, `CordisDomDocument`, `CordisDomMutation`, `CordisDomSession`.
- **Data flow:** the backend assigns **durable backend node ids** and produces a new document per snapshot; the diff between two documents becomes a list of mutations; the session maps backend ids to connection-local `NodeId`s.
- **Non-obvious design decisions:**
  - **`DOM.getDocument` serves three levels by default**; deeper levels are fetched on expand through `DOM.requestChildNodes`, and withheld levels advertise `childNodeCount`. This keeps a large tree off the wire until it is needed.
  - **A repeated expansion delivers only the missing child lists**, preserving the frontend's existing node objects.
  - The DOM session is **read-only**: `DOM.setAttributeValue`, `setNodeName`, `setOuterHTML`, `removeNode`, `moveTo`, `copyTo` are recognised and refused.
  - An **unchanged snapshot emits no DOM event**; a changed child list of a known node emits only `childNodeCountUpdated`.
  - A NodeId leaving through search or object lookup **pushes the not-yet-sent ancestor levels** first.
- **Edge cases & failure handling:** a disconnected Client's tree is retained (up to the configured count) and its `<client>` element gains a `disconnected` attribute.

#### `packages/experimental/inspector/src/worker/inspection/network-store.ts` and `domains/network/session.ts`
- **Purpose:** the bounded repository of captured fetches and its CDP projection.
- **Key abstractions:** `NetworkStore`, `NetworkStoreEvent`, `NetworkDomain`, `NetworkSink`, `CapturedNetworkBody`.
- **Data flow:** the fetch observer publishes `fetch/*` topics; the store assembles them into a request lifecycle; the Network domain replays the retained events to a newly enabled connection and then streams live ones.
- **Non-obvious design decisions:**
  - **The retained body is a *prefix*, and the truncation is marked** (`dshInspectorTruncated`, `dshInspectorCaptureError`) rather than silently short.
  - `Network.streamResourceContent` returns the buffered prefix and the connection then receives **only the later bytes** through `Network.dataReceived` — and only for connections that opted in.
  - Completed requests are **evicted before** an active one when the retention limit is reached.
  - SSE responses are parsed by `InspectorEventSourceParser` and projected as `Network.eventSourceMessageReceived`.
  - `Network.getResponseBody` returns base64 with `base64Encoded: true` — a binary body must not be mangled by a text response.
- **Edge cases & failure handling:** a malformed fetch field is isolated — it does not drop the active request; a request evicted mid-stream is cleaned out of every per-connection map.

#### `packages/experimental/inspector/src/host/inspection/network.ts`
- **Purpose:** the full `globalThis.fetch` capture.
- **Key abstractions:** `installFetchObserver`, `FetchObserver`, `FETCH_TOPICS`.
- **Data flow:** the wrapper builds a `Request`, publishes `fetch/start`, clones the request and reads the clone's body in bounded chunks, awaits the *original* fetch, publishes `fetch/response`, clones the response and reads that clone, and publishes `fetch/end`.
- **Non-obvious design decisions:**
  - **The caller receives the original `Response` as soon as the original fetch resolves** — the capture is a clone, never a delay.
  - The capture **keeps the wrapper-created `Request` reachable** in a module-level `WeakMap` keyed by the response body, because "Node's fetch forwards the caller's abort signal only while that Request is reachable". This is a subtle platform bug the code documents explicitly.
  - Installing over an **accessor** `fetch` property is refused ("cannot be observed safely").
  - The wrapper copies `name` and `length` from the original, and `stop()` restores the *original descriptor* (including removing an own property that did not exist before).
- **Edge cases & failure handling:** a clone failure is recorded as a capture error and does not affect the caller; a body read error is caught and reported; `stop()` is idempotent and cancels the active clone readers.

#### `packages/experimental/inspector/src/worker/realms/host/*`
- **Purpose:** the Host realm, backed by a **private `node:inspector.Session` per DevTools connection**.
- **Key abstractions:** `HostInspectorRealm`, `HostInspectorSession`, `HostRuntimeBackend`, `HostConsoleBackend`, `HostSourceBackend`, `HostDebuggerBackend`, `HostNotificationChannel`.
- **Data flow:** the session `connectToMainThread()`s on first use and posts native CDP requests; notifications are **rewritten** so the default Host execution context carries the Inspector's own name; `HostNotificationChannel` serialises delivery through one promise chain.
- **Non-obvious design decisions:**
  - **One V8 session per DevTools connection**, so "Host debugging remains available while Host JavaScript is paused" — the inspector session is independent of the paused main thread.
  - The `HostNotificationChannel` **serialises** notifications so a slow projector cannot reorder them.
  - `HostSourceBackend` maintains a **connection-local script catalog** from `Debugger.scriptParsed` notifications.
  - The `Host` context is `{ kind: 'native' }` — the *real* Node context, not a synthetic one.
- **Edge cases & failure handling:** a failed `connectToMainThread` is remembered and reported once ("Host V8 inspector is unavailable"); every listener is isolated.

#### `packages/experimental/inspector/src/worker/realms/client/*`
- **Purpose:** the Client realm, backed by the typed Worker↔Client transport.
- **Key abstractions:** `ClientInspectorRealm`, `ClientRuntimeBackend`, `ClientConsoleBackend`, `ClientSourceBackend`, `ClientScriptIdentity`, `clientCompletion`, `clientRemoteObject`.
- **Data flow:** the realm opens a *fresh* set of backends per DevTools connection (its own Runtime session id, its own source session id) so two DevTools connections never share object handles.
- **Non-obvious design decisions:**
  - **Unsupported options are refused explicitly, not ignored**: `throwOnSideEffect`, `serializationOptions`, `disableBreaks`, `userGesture`, native execution contexts, and `allowUnsafeEvalBlockedByCSP` all throw with the reason.
  - `ClientScriptIdentity` maps a Client-local script key to a **realm-wide** key, so the Console and Sources projections of one script agree.
  - The Client's `nativeDomains` capability is `{ state: 'unsupported', reason: 'Client realm has no native CDP transport' }` — the gap is *named*, not hidden.
- **Edge cases & failure handling:** the source reader validates each chunk's size, offset advance and `eof`, and decodes with `TextDecoder('utf-8', { fatal: true })` so a corrupt chunk is an error rather than a replacement character.

#### `packages/experimental/inspector/src/client/bridge/*` and `src/client/plugin.ts`
- **Purpose:** the browser side: the reconnecting WebSocket source, the tab-identity claim, and the plugin lifecycle.
- **Key abstractions:** `ClientInspectorSource`, `ClientBridgePublisher`, `ClientBridgeLifecycle`, `ClientBridgeRpc`, `ClientRealmSource`, `InspectorClientSession`.
- **Data flow:** the plugin reads or receives the bootstrap, claims a tab identity, opens the WebSocket, sends `source/open`, and the Worker answers `source/accepted`; the publisher then flushes its retained state and its queued observations.
- **Non-obvious design decisions:**
  - **The tab identity is claimed with the Web Locks API** before the transport opens, so a duplicated live tab receives a *new* id while a refresh reuses the stored one. Without Web Locks the identity falls back to `sessionStorage` alone.
  - `pagehide` **closes the source synchronously**; `pageshow` reconnects with the *same logical identity*.
  - The reconnect backoff is **randomised**: `cap/2 + Math.random()*cap/2` — a thundering herd of tabs is not the failure mode they wanted.
  - The publisher only writes when `socket.bufferedAmount <= maxBufferedBytes`, and re-schedules otherwise.
  - `InspectorClientSession` **serialises** its bootstrap reads and replacements through one promise chain, so a connection reset cannot interleave two sources.
- **Edge cases & failure handling:** a `source/rejected` closes the socket with `1008`; an invalid Worker frame closes the socket with `1008` and logs; the `error` event is deliberately ignored because `close` owns reconnection.

#### `packages/experimental/inspector/src/client/cdp/*`
- **Purpose:** the browser-side Runtime, Console, Sources and object-table implementations.
- **Key abstractions:** `ClientRuntimeExecutor`, `ClientObjectStore`, `getClientProperties`, `ClientConsoleObserver`, `ClientSourceCatalog`, `parseClientStack`.
- **Data flow:** the Worker sends a `client-runtime/request`; the executor evaluates in the page, serialises the result, and returns a response; the Worker acknowledges, and only then are the object handles **committed**.
- **Non-obvious design decisions:**
  - **Object handles are provisional until the Worker acknowledges the response.** A failed or cancelled request rolls back *exactly* the handles that request allocated — the allocation ledger is per-request.
  - `getClientProperties` reads descriptors **without invoking getters**, walks the prototype chain with a visited set, and honours `ownProperties` / `accessorPropertiesOnly` / `nonIndexedPropertiesOnly`.
  - The Console observer **wraps** the browser's console methods and calls the original *first*, so the page's own output is unaffected; the capture runs in a microtask so the page's stack is not polluted by the observer.
  - `parseClientStack` understands both the V8 (`at fn (url:line:col)`) and the Firefox (`fn@url:line:col`) formats, and normalises line/column to zero-based.
  - The Client source catalog discovers the app's own bundle from `__DSH_BOOT__` and reads the `sourceMappingURL` trailer — **the source map is only fetched if the script advertises one**.
- **Edge cases & failure handling:** a hostile proxy cannot break the object reader (every reflective call is guarded); a `result-too-large` response is produced *before* the response is sent; a Client Runtime request id already pending is refused.

#### `packages/experimental/inspector/src/client/bottom/*`
- **Purpose:** the bottom-panel DevTools frame, its resize handle, its keyboard forwarding and its labels.
- **Key abstractions:** `registerInspectorPage`, `InspectorResizeHandle`, `bindInspectorKeyboard`, `zh`/`en`.
- **Data flow:** the panel is registered in the `shell.bottom` slot with a `Ctrl/Cmd+Shift+.` shortcut; the iframe loads the mirrored frontend with `disableLocaleInfoBar=true` and the claimed `clientSourceId`.
- **Non-obvious design decisions:**
  - **The iframe stays mounted while collapsed** and across Session navigation; only unloading the component resets it. The panel state is `'unopened' | 'visible' | 'hidden'`.
  - The keyboard handler **forwards** a matching key into the iframe instead of handling it, and never takes over the parent's command arbitration.
  - The resize handle is a `role="separator"` with `aria-valuemin/max/now`, pointer-captured, and keyboard-operable (Arrow/Home/End) — a real ARIA separator, not a styled div.
  - The close button **restores the opening control's focus** when that control is still connected.
- **Edge cases & failure handling:** a key that is composing, already consumed, unbound, or has a different second-code is left inside DevTools.

#### `packages/experimental/inspector/scripts/devtools/*` and `scripts/build-devtools.ts`
- **Purpose:** build the official `chrome-devtools-frontend@1.0.1638082` sources into a self-hosted static frontend, **offline**.
- **Key abstractions:** `buildDevtools`, `buildFrontend`, `frontendSourceRoot`, `frontendImages`, `imagesModule`, `restoreModuleUrls`, `configureHostPerformanceSource`, `configureCodeMirrorBrowser`, `cssTextModule`.
- **Data flow:** the npm sources are resolved and their version **checked against the pin**; a Vite plugin rewrites `import.meta` expressions, compiles CSS to text modules, generates the image module, and stubs the Node-only transports; the output is published with an integrity manifest.
- **Non-obvious design decisions:**
  - **Nothing is downloaded.** "Normal npm installation supplies the source and toolchain; building needs no appspot access, browser download, browser launch, or PAK extraction." A `workspace-prefetch` test pins this.
  - `restoreModuleUrls` uses the **TypeScript compiler API** to rewrite `import.meta.url` and `import.meta.resolve` into `new URL(..., base).href`, preserving module-relative resource URLs (and deployment prefixes) after bundling.
  - `configureHostPerformanceSource` changes the Timeline panel so the **Host** is the CPU-recording target while the page target stays for Elements — one file, two exact string replacements, each asserted to occur exactly once.
  - The English-only decision is implemented by replacing the i18n module with a one-line constant — no translation files, no dictionary generator.
  - The build is **atomic**: it compiles into a temporary directory and renames it into place.
- **Edge cases & failure handling:** a source expression that is expected to change but did not **fails the build** ("expected source expression changed").

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/experimental/inspector/README.md` | The package reference: the runtime layout, the 20-field configuration table, the observation API, the Cordis tree inspection rules, the fetch-capture rules, the security section, and a nine-item limitations list. |
| `packages/experimental/inspector/README.zh.md` | The Chinese translation of the above. |
| `packages/experimental/inspector/README.i18n.yaml` | Generated per-heading bilingual pairing hashes. |
| `packages/experimental/inspector/assets/devtools/connect.js` | The same-origin bootstrap: picks the CDP WebSocket endpoint, forwards the `clientSourceId` selection, defaults `panel=console`, and sets DevTools' own locale-info-bar preference. |
| `packages/experimental/inspector/assets/devtools/LICENSE` | The Chromium BSD-3 licence shipped with the mirrored frontend. |
| `packages/experimental/inspector/cordis.patch.yml` | The built-artifact overlay row. |
| `packages/experimental/inspector/cordis.source.patch.yml` | The source overlay row used by `pnpm run demo:inspector`. |
| `packages/experimental/inspector/locale/en.json` | The English bottom-panel title and description. |
| `packages/experimental/inspector/locale/zh.json` | The Chinese bottom-panel title and description. |
| `packages/experimental/inspector/package.json` | The manifest: exports (`.`, `./client`), the pinned `chrome-devtools-frontend` devDependency, the `dsh.client` inject block and the published-files list. |
| `packages/experimental/inspector/tsconfig.json` | The solution file (host + client projects). |
| `packages/experimental/inspector/tsconfig.client.json` | The client project file list and references. |
| `packages/experimental/inspector/tsconfig.host.json` | The host project file list and references. |
| `packages/experimental/inspector/tsdown.config.ts` | The Host/Client/Worker bundle plan; the DevTools build hangs off `build:done`. |
| `packages/experimental/inspector/scripts/build-devtools.ts` | The offline DevTools compilation: builds into a temporary directory, hashes every output, writes an integrity manifest, and renames the result into `lib/devtools` atomically. |
| `packages/experimental/inspector/scripts/devtools/inputs.ts` | The npm source discovery (with an exact version check), the icon enumeration with a collision check, and the generated image module. |
| `packages/experimental/inspector/scripts/devtools/source.ts` | The four source adapters: `restoreModuleUrls` (a TypeScript-AST rewrite of `import.meta`), `configureHostPerformanceSource`, `configureCodeMirrorBrowser` and `cssTextModule`. |
| `packages/experimental/inspector/scripts/devtools/vite.ts` | The Vite build of the pinned frontend: the virtual-module plugin, the generated inputs, the injected scripts, the emitted assets and the entry map. |
| `packages/experimental/inspector/src/index.ts` | The Host package entry: the 26-field `Config` schema, `apply`, and the re-exports. |
| `packages/experimental/inspector/src/host/index.ts` | Re-exports the Host plugin. |
| `packages/experimental/inspector/src/host/plugin.ts` | The Host plugin: Worker start, `ctx.inspector`, bootstrap route, DevTools asset route, CDP upgrade proxy, `--inspect` handling. |
| `packages/experimental/inspector/src/host/bridge/controller.ts` | The Worker owner, the 30-field option resolution with its cross-validations, and the endpoint URLs. |
| `packages/experimental/inspector/src/host/bridge/lifecycle.ts` | The Worker's readiness, failure containment and graceful-then-forced shutdown. |
| `packages/experimental/inspector/src/host/bridge/publisher.ts` | The Host publisher: microtask-coalesced MessagePort writes with **one batch in flight at a time**. |
| `packages/experimental/inspector/src/host/bridge/rpc.ts` | The Host-side query bridge over the Worker MessagePort. |
| `packages/experimental/inspector/src/host/bridge/transport.ts` | The Host source over a dedicated MessagePort, including the `source/open` handshake. |
| `packages/experimental/inspector/src/host/bridge/dispatcher.ts` | Dispatches Worker frames to the Host handlers and **rejects Client-only commands** routed to the Host. |
| `packages/experimental/inspector/src/host/inspection/cordis.ts` | Re-exports the shared Cordis tree publisher. |
| `packages/experimental/inspector/src/host/inspection/realm.ts` | The Host source descriptor (a fresh id and generation per Worker start). |
| `packages/experimental/inspector/src/host/inspection/network.ts` | The full `globalThis.fetch` capture with bounded, non-blocking body cloning. |
| `packages/experimental/inspector/src/host/cdp/index.ts` | The Host bridge capability list — empty, because the Worker attaches to the Host V8 directly. |
| `packages/experimental/inspector/src/host/cdp/console.ts` | The Host Console capability (none) and the misroute rejection. |
| `packages/experimental/inspector/src/host/cdp/debugger.ts` | The Host debugger capability (none). |
| `packages/experimental/inspector/src/host/cdp/errors.ts` | `HostCdpBridgeUnavailableError` — the named reason a Host-only CDP operation cannot cross the source bridge. |
| `packages/experimental/inspector/src/host/cdp/heap-profiler.ts` | The Host heap-profiler capability (none). |
| `packages/experimental/inspector/src/host/cdp/objects.ts` | Rejects Host object operations that must use the native session. |
| `packages/experimental/inspector/src/host/cdp/profiler.ts` | The Host CPU-profiler capability (none). |
| `packages/experimental/inspector/src/host/cdp/properties.ts` | Rejects Host property enumeration on the source bridge. |
| `packages/experimental/inspector/src/host/cdp/runtime.ts` | Rejects each misrouted Client Runtime command with the right reason. |
| `packages/experimental/inspector/src/host/cdp/sources.ts` | The Host Sources capability (none) and the misroute rejection. |
| `packages/experimental/inspector/src/host/cdp/stack.ts` | The one stable sentence explaining why Host CDP does not cross the bridge. |
| `packages/experimental/inspector/src/client/index.ts` | Re-exports the Client plugin. |
| `packages/experimental/inspector/src/client/plugin.ts` | The Client plugin: bootstrap read/inject, the serialised session owner, the `ctx.inspector` service, and the bottom-panel injection. |
| `packages/experimental/inspector/src/client/bridge/controller.ts` | Starts the browser source after the tab identity is claimed. |
| `packages/experimental/inspector/src/client/bridge/dispatcher.ts` | Dispatches Worker frames to the browser-realm capability handlers. |
| `packages/experimental/inspector/src/client/bridge/lifecycle.ts` | The randomised, bounded reconnect backoff. |
| `packages/experimental/inspector/src/client/bridge/locales.ts` | The fallback Client label. |
| `packages/experimental/inspector/src/client/bridge/publisher.ts` | The Client publisher: buffered state survives a reconnect, writes respect `bufferedAmount`. |
| `packages/experimental/inspector/src/client/bridge/rpc.ts` | The Client query bridge over the active WebSocket. |
| `packages/experimental/inspector/src/client/bridge/transport.ts` | The reconnecting Client source: open/accept/close frames, Runtime and Sources execution, cancellation. |
| `packages/experimental/inspector/src/client/cdp/index.ts` | The Client bridge capability list. |
| `packages/experimental/inspector/src/client/cdp/console.ts` | The transparent console/error observer and the per-session fan-out. |
| `packages/experimental/inspector/src/client/cdp/debugger.ts` | The Client debugger capability: unavailable, with the reason. |
| `packages/experimental/inspector/src/client/cdp/errors.ts` | `ClientRuntimeExecutionError` — a transport failure, distinct from an evaluated JavaScript exception. |
| `packages/experimental/inspector/src/client/cdp/heap-profiler.ts` | The Client heap-profiler capability: unavailable. |
| `packages/experimental/inspector/src/client/cdp/objects.ts` | The per-session object store with per-request allocation ledgers. |
| `packages/experimental/inspector/src/client/cdp/profiler.ts` | The Client CPU-profiler capability: unavailable. |
| `packages/experimental/inspector/src/client/cdp/properties.ts` | Lazy, getter-free property enumeration with a prototype-walk bound. |
| `packages/experimental/inspector/src/client/cdp/runtime.ts` | The Client Runtime executor: evaluate, call, await, release, and the provisional-handle commit/rollback. |
| `packages/experimental/inspector/src/client/cdp/sources.ts` | The browser-side source catalog, chunked and bounded. |
| `packages/experimental/inspector/src/client/cdp/stack.ts` | Browser stack parsing for V8 and Firefox. |
| `packages/experimental/inspector/src/client/inspection/cordis.ts` | Re-exports the shared Cordis tree publisher. |
| `packages/experimental/inspector/src/client/inspection/network.ts` | The Client network topic list — currently empty. |
| `packages/experimental/inspector/src/client/inspection/realm.ts` | The tab-identity claim (Web Locks + `sessionStorage`) and the per-generation descriptor. |
| `packages/experimental/inspector/src/client/bottom/keyboard.ts` | Forwards the effective binding into the DevTools iframe without taking over arbitration. |
| `packages/experimental/inspector/src/client/bottom/locales.ts` | The bilingual bottom-panel labels and the locale-namespace augmentation. |
| `packages/experimental/inspector/src/client/bottom/page.module.css` | The bottom panel's CSS module. |
| `packages/experimental/inspector/src/client/bottom/page.tsx` | The panel, the `Ctrl/Cmd+Shift+.` shortcut, the focus restoration and the iframe lifetime. |
| `packages/experimental/inspector/src/client/bottom/resize.tsx` | The ARIA separator that resizes the panel by pointer and keyboard. |
| `packages/experimental/inspector/src/css-modules.d.ts` | The CSS Modules ambient declaration. |
| `packages/experimental/inspector/src/shared/bridge/buffer.ts` | The bounded, gap-reporting source buffer. |
| `packages/experimental/inspector/src/shared/bridge/codec.ts` | Re-exports the JSON and validation primitives. |
| `packages/experimental/inspector/src/shared/bridge/control-codec.ts` | The exact decoders for the Worker config and the three lifecycle message families. |
| `packages/experimental/inspector/src/shared/bridge/ids.ts` | The branded identifier roles. |
| `packages/experimental/inspector/src/shared/bridge/publisher.ts` | The transport-independent publisher interfaces and the shared connection base. |
| `packages/experimental/inspector/src/shared/bridge/query-reader.ts` | The query-backed Cordis tree reader. |
| `packages/experimental/inspector/src/shared/bridge/rpc.ts` | The correlated query owner with generation matching and timeouts. |
| `packages/experimental/inspector/src/shared/bridge/validation.ts` | Re-exports the exact-field readers. |
| `packages/experimental/inspector/src/shared/bridge/version.ts` | The single wire version constant. |
| `packages/experimental/inspector/src/shared/bridge/messages/control.ts` | The Worker config, boot, shutdown, ready/failure/stopped and Client bootstrap types. |
| `packages/experimental/inspector/src/shared/bridge/messages/cordis.ts` | The `cordis/tree` topic constant. |
| `packages/experimental/inspector/src/shared/bridge/messages/network.ts` | The seven `fetch/*` topic names. |
| `packages/experimental/inspector/src/shared/bridge/messages/observation.ts` | The observation frame family and its exact decoders. |
| `packages/experimental/inspector/src/shared/bridge/messages/query/codec.ts` | The exact query request/response decoders and the error codes. |
| `packages/experimental/inspector/src/shared/bridge/messages/query/commands.ts` | The closed query command/result model. |
| `packages/experimental/inspector/src/shared/bridge/messages/query/frames.ts` | The query request/response envelopes. |
| `packages/experimental/inspector/src/shared/bridge/messages/query/index.ts` | The query protocol's public exports. |
| `packages/experimental/inspector/src/shared/bridge/messages/runtime/command-codec.ts` | The exact Client Runtime command decoder. |
| `packages/experimental/inspector/src/shared/bridge/messages/runtime/commands.ts` | The closed Client Runtime command/result model. |
| `packages/experimental/inspector/src/shared/bridge/messages/runtime/console-frames.ts` | The Console capability, enable/disable frames and event decoder. |
| `packages/experimental/inspector/src/shared/bridge/messages/runtime/frames.ts` | The Runtime request/cancel/acknowledge/response/session-closed envelopes. |
| `packages/experimental/inspector/src/shared/bridge/messages/runtime/index.ts` | The Runtime protocol's public exports. |
| `packages/experimental/inspector/src/shared/bridge/messages/runtime/value-codec.ts` | The exact RemoteObject/descriptor/exception decoder, including the per-type representation rules. |
| `packages/experimental/inspector/src/shared/bridge/messages/sources/codec.ts` | The exact source command/result decoder with base64 validation. |
| `packages/experimental/inspector/src/shared/bridge/messages/sources/commands.ts` | The read-only source catalog command/result model. |
| `packages/experimental/inspector/src/shared/bridge/messages/sources/frames.ts` | The source request/response/session-closed envelopes. |
| `packages/experimental/inspector/src/shared/bridge/messages/sources/index.ts` | The source protocol's public exports. |
| `packages/experimental/inspector/src/shared/cdp/capabilities.ts` | The explicit per-realm operation support lists. |
| `packages/experimental/inspector/src/shared/cdp/console.ts` | The realm-neutral Console event model. |
| `packages/experimental/inspector/src/shared/cdp/debugger.ts` | The realm-neutral debugger values. |
| `packages/experimental/inspector/src/shared/cdp/errors.ts` | The realm-neutral exception and stack types. |
| `packages/experimental/inspector/src/shared/cdp/ids.ts` | The branded realm, backend-handle and script-key roles. |
| `packages/experimental/inspector/src/shared/cdp/index.ts` | The realm-neutral CDP type exports. |
| `packages/experimental/inspector/src/shared/cdp/operations.ts` | The realm-neutral Runtime request/result types. |
| `packages/experimental/inspector/src/shared/cdp/property.ts` | The realm-neutral property descriptor types. |
| `packages/experimental/inspector/src/shared/cdp/realm.ts` | The normalised backend interfaces (Runtime, Console, Source, Debugger, Native) and the explicit `supported`/`unsupported` capability type. |
| `packages/experimental/inspector/src/shared/cdp/remote-object.ts` | The realm-neutral RemoteObject model. |
| `packages/experimental/inspector/src/shared/cdp/sources.ts` | The realm-neutral script metadata. |
| `packages/experimental/inspector/src/shared/cordis/collector.ts` | The live Context/Fiber projection with shadow unwrapping and double bounds. |
| `packages/experimental/inspector/src/shared/cordis/ids.ts` | The branded object-registry and object-handle roles. |
| `packages/experimental/inspector/src/shared/cordis/model.ts` | The consumer-neutral Cordis tree and its strict decoder. |
| `packages/experimental/inspector/src/shared/cordis/object-reference.ts` | The opaque live-object reference and its decoder. |
| `packages/experimental/inspector/src/shared/cordis/object-registry.ts` | The realm-local object table, the global registry, and the realm-resolution expression. |
| `packages/experimental/inspector/src/shared/cordis/observer.ts` | The coalesced Cordis tree publication on plugin/status events. |
| `packages/experimental/inspector/src/shared/cordis/projector.ts` | The pure projection from routed snapshots to the consumer-neutral tree. |
| `packages/experimental/inspector/src/shared/cordis/publisher.ts` | The shared publication of the browser-safe Cordis snapshot. |
| `packages/experimental/inspector/src/shared/cordis/reader.ts` | The read-only tree reader interface. |
| `packages/experimental/inspector/src/shared/cordis/snapshot.ts` | The serialisable snapshot model and its node/handle/uuid validators. |
| `packages/experimental/inspector/src/shared/dispose.ts` | The ordered, failure-aggregating teardown. |
| `packages/experimental/inspector/src/shared/identity.ts` | The branded identifier construction. |
| `packages/experimental/inspector/src/shared/index.ts` | The shared barrel. |
| `packages/experimental/inspector/src/shared/json.ts` | The lossless-JSON predicate, the plain-object test and the UTF-8 byte measure. |
| `packages/experimental/inspector/src/shared/network/event-source.ts` | The incremental UTF-8 Server-Sent-Events parser. |
| `packages/experimental/inspector/src/shared/network/observation.ts` | The fetch observation payload types. |
| `packages/experimental/inspector/src/shared/service.ts` | The shared `ctx.inspector` façade. |
| `packages/experimental/inspector/src/shared/validation.ts` | The exact-field readers. |
| `packages/experimental/inspector/src/shared/web.ts` | The bootstrap path, the client-selection query parameter and its single-use rule. |
| `packages/experimental/inspector/src/worker/entry.ts` | The Worker bootstrap: boot-data validation, the ready/failure/stopped control frames, and the idempotent stop. |
| `packages/experimental/inspector/src/worker/server.ts` | The Worker's assembly: stores, routers, realms, endpoint, and the ordered shutdown. |
| `packages/experimental/inspector/src/worker/bridge/endpoint.ts` | The loopback HTTP discovery, the DevTools CDP socket and the Client-ingest socket, with the token and origin checks. |
| `packages/experimental/inspector/src/worker/bridge/hub.ts` | The source registry: generations, sequencing, gap detection, topic checks and the event bus. |
| `packages/experimental/inspector/src/worker/bridge/runtime-rpc.ts` | The Runtime/Console router, the synthetic contexts and the correlation checks. |
| `packages/experimental/inspector/src/worker/bridge/session.ts` | The one-way session-closed delivery. |
| `packages/experimental/inspector/src/worker/bridge/source-rpc.ts` | The source-catalog router with chunk validation. |
| `packages/experimental/inspector/src/worker/cdp/ids.ts` | The branded CDP identifier roles. |
| `packages/experimental/inspector/src/worker/cdp/protocol.ts` | The request parser and the error/response helpers. |
| `packages/experimental/inspector/src/worker/cdp/realm-sessions.ts` | The per-connection realm session set and the client-selection filter. |
| `packages/experimental/inspector/src/worker/cdp/session.ts` | The per-connection CDP dispatcher and the `DSHInspector.*` diagnostic domain. |
| `packages/experimental/inspector/src/worker/cdp/target.ts` | The page-target scaffold DevTools needs. |
| `packages/experimental/inspector/src/worker/cdp/domains/dom/index.ts` | The DOM domain exports. |
| `packages/experimental/inspector/src/worker/cdp/domains/dom/model.ts` | The semantic DOM projection, the durable backend ids and the mutation diff. |
| `packages/experimental/inspector/src/worker/cdp/domains/dom/session.ts` | The read-only DOM session: depth limiting, the search map, the object binding and the sticky node ids. |
| `packages/experimental/inspector/src/worker/cdp/domains/native.ts` | The Host-only native domain adapter. |
| `packages/experimental/inspector/src/worker/cdp/domains/debugger/cdp-params.ts` | The Debugger parameter decoders. |
| `packages/experimental/inspector/src/worker/cdp/domains/debugger/index.ts` | The Debugger domain exports. |
| `packages/experimental/inspector/src/worker/cdp/domains/debugger/projector.ts` | The script-parsed and paused-event projections. |
| `packages/experimental/inspector/src/worker/cdp/domains/debugger/script-registry.ts` | The ScriptId-to-realm route table and the retired-unsupported set. |
| `packages/experimental/inspector/src/worker/cdp/domains/debugger/session.ts` | The Debugger domain: script catalog, breakpoints, call-frame evaluation and the source search. |
| `packages/experimental/inspector/src/worker/cdp/domains/network/session.ts` | The Network domain: enable/disable, body reads, streaming and the SSE projection. |
| `packages/experimental/inspector/src/worker/cdp/domains/runtime/cdp-params.ts` | The Runtime parameter decoders and the context selectors. |
| `packages/experimental/inspector/src/worker/cdp/domains/runtime/index.ts` | The Runtime domain exports. |
| `packages/experimental/inspector/src/worker/cdp/domains/runtime/object-table.ts` | The connection-local object id table and the CDP value projections. |
| `packages/experimental/inspector/src/worker/cdp/domains/runtime/session.ts` | The Runtime domain across uniform realms, including the native-parameter rewrite. |
| `packages/experimental/inspector/src/worker/inspection/cordis-query.ts` | The query execution against the shared tree reader. |
| `packages/experimental/inspector/src/worker/inspection/cordis-store.ts` | The Worker-side snapshot repository, the node index and the disconnected-tree retention. |
| `packages/experimental/inspector/src/worker/inspection/network-store.ts` | The bounded fetch repository and its event vocabulary. |
| `packages/experimental/inspector/src/worker/inspection/query-router.ts` | The Worker-side query peers: admission, execution, bounded settlement and carrier revocation. |
| `packages/experimental/inspector/src/worker/inspection/realm-store.ts` | The realm registry and its admission/ removal events. |
| `packages/experimental/inspector/src/worker/inspection/realm.ts` | The realm lifecycle model and the explicit `RealmCapability` type. |
| `packages/experimental/inspector/src/worker/realms/client/bridge.ts` | The Client realm's bridge dependencies. |
| `packages/experimental/inspector/src/worker/realms/client/console.ts` | The Client Console backend. |
| `packages/experimental/inspector/src/worker/realms/client/debugger.ts` | The explicit unsupported Client debugger capability. |
| `packages/experimental/inspector/src/worker/realms/client/index.ts` | The Client realm definition and its per-connection session factory. |
| `packages/experimental/inspector/src/worker/realms/client/runtime.ts` | The Client Runtime backend, including the explicit option refusals. |
| `packages/experimental/inspector/src/worker/realms/client/scripts.ts` | The realm-wide script identity namespace. |
| `packages/experimental/inspector/src/worker/realms/client/sources.ts` | The Client source backend with chunk validation. |
| `packages/experimental/inspector/src/worker/realms/client/values.ts` | The Client-wire-to-realm-neutral value conversions. |
| `packages/experimental/inspector/src/worker/realms/host/bridge.ts` | The per-connection `node:inspector.Session` and the serialised notification channel. |
| `packages/experimental/inspector/src/worker/realms/host/console.ts` | The Host Console backend over native notifications. |
| `packages/experimental/inspector/src/worker/realms/host/debugger.ts` | The Host debugger backend over native notifications. |
| `packages/experimental/inspector/src/worker/realms/host/index.ts` | The Host realm definition and its per-connection native session factory. |
| `packages/experimental/inspector/src/worker/realms/host/runtime.ts` | The Host Runtime backend over native V8. |
| `packages/experimental/inspector/src/worker/realms/host/scripts.ts` | The native script id conversion. |
| `packages/experimental/inspector/src/worker/realms/host/sources.ts` | The Host script catalog over `Debugger.scriptParsed`. |
| `packages/experimental/inspector/src/worker/realms/host/values.ts` | The native-protocol validators. |
| `packages/experimental/inspector/tests/bootstrap-route.host.spec.ts` | The bootstrap route answers requests *before* the Worker is ready; a failed startup answers `503`; an unavailable platform keeps the route; an aborted request stops waiting. |
| `packages/experimental/inspector/tests/bottom-keyboard.client.spec.ts` | The iframe keyboard listeners are replaced on load and removed on disposal or cross-origin navigation; composing, consumed, unbound and non-matching keys stay inside DevTools. |
| `packages/experimental/inspector/tests/bottom.client.spec.tsx` | The bottom panel opens on `Mod+Shift+Period` without a Session, retains the iframe while collapsed, resizes by pointer and by keyboard, routes frame input through the effective binding, restores opener focus, keeps modal arbitration, and resets on unload. |
| `packages/experimental/inspector/tests/built-lib.e2e.ts` | The published tarball packs its sibling Worker and evaluates the Host through plain Node. |
| `packages/experimental/inspector/tests/client-browser.e2e.ts` | Chrome node identities survive recursive and shallower Cordis expansion; Console values are forwarded and the built bundle is exposed as read-only source. |
| `packages/experimental/inspector/tests/client-runtime.client.spec.ts` | The Client Runtime executor retains objects, reads descriptors lazily, releases groups, separates evaluated exceptions from transport failures, rolls back only a failed request's handles, keeps handles provisional until acknowledged, rejects oversized by-value results, and isolates Console objects per DevTools session. |
| `packages/experimental/inspector/tests/client-sources.client.spec.ts` | The source catalog loads the script before a map-first read, omits map metadata when there is no map reference, reports a failed map fetch without losing the script, transfers UTF-8 source and maps in bounded chunks, and refuses assets above the aggregate limit. |
| `packages/experimental/inspector/tests/client-stack.client.spec.ts` | Browser stack parsing normalises line numbers and associates known source URLs. |
| `packages/experimental/inspector/tests/client-stack.host.spec.ts` | One script key is used across the Client Console and Sources projections. |
| `packages/experimental/inspector/tests/cordis-collector.host.spec.ts` | The collector retains a service-created Fiber with its canonical Context and keeps ordinary and inherited-fiber Contexts distinct without duplicating the Fiber. |
| `packages/experimental/inspector/tests/cordis-model.host.spec.ts` | The tree decoder accepts connected and disconnected realms and rejects duplicate source ids, malformed nodes, duplicate Fiber ids and excessive depth; the snapshot decoder enforces node and depth limits; the projection strips routing fields; the object registry retains stable identities and rolls generations atomically. |
| `packages/experimental/inspector/tests/cordis-query.host.spec.ts` | The consumer-neutral tree is projected without routing identifiers; the query codecs are exact; stale, malformed, timed-out and closed requests are cleared; a new generation revokes the older carrier; Host and Client services read the same Worker snapshot without a CDP connection. |
| `packages/experimental/inspector/tests/cordis-tree.host.spec.ts` | The Cordis tree integration: a late-starting Worker is closed after cancellation; Fiber and Context identities stay distinct; truncation is marked; snapshots are bounded by node count and byte size; notifications are coalesced; disposed Fibers and shadows are ignored; a disconnected snapshot is frozen and replaced on reconnect; snapshots diff into local DOM mutations; node kinds resolve to RemoteObjects; the document serves three levels by default; and the Client-scoped projection publishes disconnect attributes and keeps its own node identities. |
| `packages/experimental/inspector/tests/debugger.e2e.ts` | A paused Host frame is evaluated and resumed while the main thread is stopped. |
| `packages/experimental/inspector/tests/devtools-build.e2e.ts` | The frontend builds from the fixed installed sources with the network APIs blocked, and includes the Memory panel and the injected entries. |
| `packages/experimental/inspector/tests/devtools-selection.host.spec.ts` | An absent selector stays global, one selected Client is decoded, and an explicit debugging endpoint is left unchanged. |
| `packages/experimental/inspector/tests/devtools-source.host.spec.ts` | The source adapters are evaluated in per-test VMs: `import.meta` rewriting preserves surrounding text, the Host Performance change touches only the recording-mode field and target expression, the CodeMirror browser branch is selected without calling `require`, and the image module is generated. |
| `packages/experimental/inspector/tests/dispose.host.spec.ts` | Teardown waits for each registration before releasing its predecessor and the source, and collects every failure after attempting every action. |
| `packages/experimental/inspector/tests/event-source.host.spec.ts` | The SSE parser keeps state across chunks, CRLF boundaries and UTF-8 boundaries, and retains valid ids while ignoring comments and unknown fields. |
| `packages/experimental/inspector/tests/fetch-observer.host.spec.ts` | The fetch observer captures the full URL, headers and both bodies; marks truncation without changing the caller's response; finishes after a post-header abort; reports a pre-header rejection as cancelled; records clone failures; handles bodyless responses; refuses an accessor `fetch`; contains publisher failures; cancels a clone reader on stop; restores an inherited `fetch` without leaving an own property; and renders a non-Error rejection without letting hostile coercion escape. |
| `packages/experimental/inspector/tests/fixtures/client-source.client.ts` | The isolated Client fixture process used by the Host-side protocol integration tests. |
| `packages/experimental/inspector/tests/fixtures/client-source.host.ts` | The Host-side controller for that isolated Client fixture. |
| `packages/experimental/inspector/tests/fixtures/debug-host.ts` | The child-process fixture whose Host main thread is paused and resumed through the Worker. |
| `packages/experimental/inspector/tests/integration.host.spec.ts` | The real Worker over an isolated Client fixture: pending calls settle when the socket closes; an embedded connection is limited to its Client while a direct one sees all; malformed selectors are rejected before admission; Host and Client contexts switch and Client RemoteObjects route; object ids and groups are isolated per connection; work is cancelled at the deadline; only the default Host context is advertised; the same value model serves both realms; Console objects are forwarded through isolated sessions; a chunked Client bundle becomes read-only Debugger source; Host fetch data is projected through Network; later response chunks stream to an opted-in connection; and captured EventSource data stays readable after a post-header abort. |
| `packages/experimental/inspector/tests/layout.host.spec.ts` | The source layout invariants: Client and Host adapters are mirrored, the Worker backends are mirrored, shared modules are environment-independent, the faces are isolated, compiler files sit on their declared face, and the Worker repositories are independent of the Chrome adapter. |
| `packages/experimental/inspector/tests/loader-composition.host.spec.ts` | The Inspector works through a real Cordis Loader composition. |
| `packages/experimental/inspector/tests/network.host.spec.ts` | The Network domain bounds incomplete bodies, evicts completed requests before retaining a later body, streams later chunks only to opted-in sessions, projects and replays parsed SSE events, bounds active metadata, finishes a response whose clone ended with a capture error, marks a post-header failure truncated, isolates malformed observations, closes only the selected source's active requests, rejects malformed fetch fields without losing later valid records, tracks zero-byte truncation, and rejects a non-list header field without dropping the request. |
| `packages/experimental/inspector/tests/plugin-routes.host.spec.ts` | The Host DevTools routes answer by method, index authorisation, redirect and asset outcome; the authenticated CDP upgrade is proxied with its headers and early bytes; the browser socket closes when the Worker refuses; and a rollback failure is logged while the registration error still rejects initialisation. |
| `packages/experimental/inspector/tests/plugin.client.spec.ts` | The Client plugin: the source is removed on `pagehide` and reconnected once on resume; `ctx.inspector` publishes after acceptance; the realm source id survives while the transport generation rotates; a refresh keeps the logical id; a copied session identity is rotated; a page-lifetime id is the fallback; an outstanding Runtime operation is cancelled without a late response; a replacement absorbs the queue loss once; the built bundle is served; a connection reset reuses the source; a missing bootstrap is retried; a late bootstrap is not installed after disposal; a network failure keeps recovery; an aborted refresh settles quietly; and cleanup joins before a replacement is claimed. |
| `packages/experimental/inspector/tests/plugin.host.spec.ts` | The Host plugin starts the Worker, provides `ctx.inspector`, injects the bootstrap and disposes; a later registration failure closes the Worker; `--inspect` failing to open Chrome keeps inspection available; and a failed fetch-capture installation closes the Worker. |
| `packages/experimental/inspector/tests/port-selection.host.spec.ts` | An occupied starting port advances upward and the selected port is published. |
| `packages/experimental/inspector/tests/protocol.host.spec.ts` | The source protocol rebuilds a valid frame and rejects non-JSON payloads, isolates generations and reports sequence gaps, closes only a malformed source connection, decodes Runtime commands and rejects undeclared fields, rejects invalid RemoteObject representations, and decodes the Console and source frames exactly. |
| `packages/experimental/inspector/tests/shared-validation.host.spec.ts` | The JSON predicate accepts every lossless category and measures UTF-8 bytes, and rejects lossy primitives, cycles, exotic arrays and accessor objects; the exact-field readers accept declared fields and reject unknown, symbolic and wrongly typed ones. |
| `packages/experimental/inspector/tests/source-buffer.host.spec.ts` | The source buffer absorbs pre-replacement queue loss exactly once, validates records before either carrier enqueues them, refuses oversized retained state without replacing the previous value, splits frames at record/byte/sequence gaps, drops queued records against the byte limit independently of the item limit, and keeps at most one Host MessagePort batch in flight. |
| `packages/experimental/inspector/tests/worker-lifecycle.host.spec.ts` | The Worker lifecycle keeps the runtime error listener, treats an already-exited Worker as stopped, reads readiness and completes a graceful shutdown through one persistent owner. |
| `packages/experimental/inspector/tests/workspace-prefetch.host.spec.ts` | The workspace install prefetches no DevTools, the npm source is pinned and uses the workspace Vite without a webpack dependency, and the published frontend carries no download tooling or cache. |

### Tier 3 — skipped with a reason

- `packages/experimental/inspector/icon.svg` — a 1.2 KB SVG icon (Tier 3 asset); opened and its head confirmed, not read line by line.



### Part C — `packages/experimental/session-inspector` (66 files)

This package renders a **live session transcript as an inspectable table**: the raw Session event log ("Raw Log") and the materialised Chat structure ("Chat Group"). It is a *client-only* plugin (the Host half is inert), it subscribes to the existing Chat and Session-log models rather than duplicating them, and it never mutates Session data. Its distinguishing craft is **stability under a moving target**: the log is a live stream that is also paginated, settled, replaced and sometimes rebuilt, and the table keeps its scroll anchor, its sticky ancestors and its selected row through all of that.

#### `packages/experimental/session-inspector/src/client/views/session-log/model.ts`
- **Purpose:** the incremental raw-log row model.
- **Key abstractions:** `SessionLogModel`, `LogRoot`.
- **Data flow:** the model's `rows` snapshot store holds the row list; each record has its own keyed `InspectorRecord` store, so a row's *value* updates independently of the *row list*.
- **Non-obvious design decisions:**
  - **Subscriptions exist only while the table is observed** — the model stops reading the session source when the tab is hidden and catches up when it reopens. An always-on subscriber would burn CPU on a hidden tab.
  - **Live deltas are replaced by durable events.** A live chunk row is transient; when the durable `assistant/message` arrives, the transient rows are replaced by lossless text/reasoning/tool-call children.
  - **Historical rows are reused**: "Live log appends reuse historical row objects and the Turn/Step grouping cursor" — an append inserts one row into its block and shifts only the *following* root offsets.
  - A **pagination, settlement, replacement or missed revision rebuilds the hierarchy** while preserving the keyed record sources, so the raw values are not lost.
  - The `collapsedSummary` (the folded reasoning preview) is written back onto the *owning* `block-start` record, so the folded header and its raw detail never disagree.
- **Edge cases & failure handling:** a settlement whose live frames were never loaded is still accepted; settled identities outside the loaded window are released while loaded rows are retained across rebuilds.

#### `packages/experimental/session-inspector/src/client/views/session-log/stream.ts`
- **Purpose:** the block-indexed hierarchy for one live or durable Assistant stream.
- **Key abstractions:** `AssistantLogStream`, `StreamEntry`.
- **Data flow:** `append(chunk)` returns the row to insert, an optional *replaced* block header, and an optional folded summary.
- **Non-obvious design decisions:**
  - **A `block-end` collapses its block automatically** and returns a `header` describing the replacement, so the table can swap the header in place instead of rebuilding.
  - The **folded reasoning summary is bounded** to the normal preview length and is built only from the *matching* reasoning deltas — interleaved blocks keep separate summaries.
  - Chunks whose block-start was never loaded remain **direct Assistant children** — the model does not invent a block.
  - The chunk counter counts **all** received chunks, including children of folded blocks, so the "N chunks" fact survives folding.
- **Edge cases & failure handling:** a `finish` chunk outside an indexed content block stays outside.

#### `packages/experimental/session-inspector/src/client/views/session-log/groups.ts`
- **Purpose:** the Turn/Step range grouping.
- **Key abstractions:** `SessionLogGroups`.
- **Data flow:** `append(row, event)` places a record inside its open Step or Turn.
- **Non-obvious design decisions:**
  - **A missing start is never synthesised.** "Missing starts are not synthesized: loading an earlier start adds ancestry to the existing rows." The grouping cursor only *adds* ancestry.
  - The **start record is the sticky group header** and the **end record stays a raw child at the group's tail** — the log is not rewritten.
  - Turn and Step groups stay expanded after completion; manual folding is table-local.

#### `packages/experimental/session-inspector/src/client/views/table-model.ts`
- **Purpose:** the row identity, the disclosure resolution and the sticky-ancestor hierarchy.
- **Key abstractions:** `InspectorRow`, `InspectorDisclosure`, `inspectorRowCollapsed`, `InspectorTableHierarchy`, `InspectorRecord`, `InspectorRecordSource`.
- **Data flow:** `InspectorTableHierarchy` walks the depth-first row order and omits the descendants of a collapsed row; `stickyIndexes(index)` returns the visible ancestors.
- **Non-obvious design decisions:**
  - **A manual disclosure choice is valid only for the lifecycle state in which it was made.** `inspectorRowCollapsed` compares `choice.state === row.disclosure`; when the block closes, the earlier "open" choice is void and the block becomes collapsed, but the user can reopen it. This is a small, exact mechanism for "an automatic event must not steal the user's choice, and must not keep it either".
  - `InspectorRecordSource` **projects lazily**: the raw metadata is recomputed only when its source object changes, so a re-render does not re-project every row.
- **Edge cases & failure handling:** an ancestor outside the loaded window produces no sticky header.

#### `packages/experimental/session-inspector/src/client/views/table-layout.ts`
- **Purpose:** the virtual scroll layout that survives an automatic collapse.
- **Key abstractions:** `InspectorTableLayout`, `InspectorTableItem`, `InspectorViewport`, `InspectorRowAnchor`, `INSPECTOR_ROW_HEIGHT`.
- **Data flow:** the constructor takes the new hierarchy, the *previous* layout, the pre-update viewport and an optional manual anchor, and computes the items, the preserved-collapse flag, the trailing space and the scroll offset.
- **Non-obvious design decisions:**
  - **A live block closure must not move the reader's eyes.** The layout detects "the hierarchy got shorter *and* a row that was open is now closed", then re-anchors the scroll offset to the row the reader was looking at, and **reserves the freed space at the bottom** so the data does not jump up.
  - **The reserved space is only ever below the data.** "Automatic block closure keeps the visible row or surviving parent at its screen position and leaves unused space only below the data; new rows fill that space before normal tail following resumes."
  - A **manual** disclosure keeps the clicked header at its measured viewport position and *pauses* following, retaining only the trailing space needed to keep it visible.
  - `stickyIndexesAtOffset` resolves each sticky level **below** the table header and the already-occupied sticky rows, so a nested header replaces the level above it rather than stacking on top.
- **Edge cases & failure handling:** a removed anchor resets; a preceding block closing anchors a surviving later row.

#### `packages/experimental/session-inspector/src/client/views/type-filter.ts` and `TypeFilter.tsx`
- **Purpose:** the confirmed type filter.
- **Key abstractions:** `InspectorTypeFilter`, `InspectorTypeMatches`, `TypeFilter`.
- **Data flow:** the editor holds a *draft*; only Enter, **Apply filter**, or choosing a candidate commits it.
- **Non-obvious design decisions:**
  - **A filter keeps the ancestors of matching rows**, so a matched nested row can still be inspected in context. Ancestors that are *context only* appear muted and do not count toward the matching total.
  - **Matching descendants of a closed block start visible** — the filter opens the branch it needs and nothing else.
  - Matching is **case-insensitive containment**; surrounding `*` are stripped, so `delta` and `*delta*` mean the same thing.
  - **Editing alone does not change the table.** The editor is a portalled surface with `aria` roles, keyboard selection, and a *stale-response guard*: an out-of-order suggestion response cannot replace a newer one.
  - Confirming resets the selection, the disclosure choices and the reserved trailing space, and returns to the top.
- **Edge cases & failure handling:** clearing and confirming restores all types; a candidate failure is shown without losing the draft; results arriving after dismissal or unmount are ignored.

#### `packages/experimental/session-inspector/src/client/views/chat-node/model.ts`
- **Purpose:** the Chat-structure table model.
- **Key abstractions:** `ChatNodeModel`, `InspectorRecord` projections.
- **Data flow:** the model watches *structural* Chat changes while the visible rows observe their own Node or Group.
- **Non-obvious design decisions:**
  - **Row order follows root references and group membership, independently of row data.** A content update does not reorder the table.
  - **Hidden or unlisted materialised Nodes remain root rows**, inserted by *event anchor* between the existing roots — "the Inspector does not invent group membership", and it does not append after the last Turn.
  - Equal anchors are ordered deterministically.
  - The refresh is **coalesced into one microtask** and only runs while the table has subscribers.
  - An unavailable group source leaves the table empty rather than guessing.

#### `packages/experimental/session-inspector/src/client/views/chat-node/objects.ts`
- **Purpose:** the weak-identity index of the objects the detail tree can navigate to.
- **Key abstractions:** `ChatObjectIndex`.
- **Data flow:** `refresh()` indexes each immutable publication **once** (guarded by a `WeakSet` of the snapshot's own collections) into a `WeakMap` of object → reference.
- **Non-obvious design decisions:**
  - **Weak identities throughout.** The index never retains a replaced snapshot's objects; a reference *reads the current value* rather than holding one.
  - The `read` closure always re-reads the live source: "Named references read current values without retaining replaced snapshots."
  - Node enumeration uses the **existing** `nodes.values()` reader rather than a private copy.
  - Group members are indexed under their *own* node identity plus the group part, so "the exact group part before broader Node" is expressible.

#### `packages/experimental/session-inspector/src/client/views/object-value.ts` and `InspectorObjectTree.tsx`
- **Purpose:** the lazy, typed runtime-object reader and the value tree.
- **Key abstractions:** `InspectorObjectEntry`, `InspectorObjectValue`, `InspectorObjectTree`, `ValueTree`.
- **Data flow:** the tree expands a field only when it is opened; collections expand in pages; getters are labelled, never executed.
- **Non-obvious design decisions:**
  - **A getter is labelled `[Getter / Setter, not evaluated]`** — the inspector never runs user code to show a value.
  - **Arrays and TypedArrays read only the disclosed index prefix**; a sparse slot is marked `[Empty slot]`, distinct from an explicit `undefined`.
  - **"Other properties" is a separate disclosure** that scans the non-index and symbol fields *without invoking getters*; the initial numeric page does not enumerate the whole collection.
  - **Expanded fields are cached until a Conversation publication changes**, so a mutable Turn/Step Data refreshes without resetting the disclosure state or re-enumerating on a UI-only render.
  - The inspected **root expands inline**; registered nested objects become *links*, and a reference button adds a breadcrumb. Selecting an earlier breadcrumb returns to that level and discards the later path.
  - An unregistered cycle shows its **ancestor path**; Maps keep their object keys; Sets and arrays show members; class instances keep their names and own fields; WeakMap/WeakSet stay opaque.
- **Edge cases & failure handling:** the typed-array length uses the **intrinsic** getter even when an own getter shadows it; a disappearing Proxy property is handled.

#### `packages/experimental/session-inspector/src/client/views/chat-node/dom.ts`, `highlight.ts`, `reveal.ts`, `reveal-target.ts`, `picker.ts`, `pick-match.ts`
- **Purpose:** all DOM interaction with the *existing* Chat.
- **Key abstractions:** `mainChatRoot`, `displayed`, `inChat`, `findChatTargets`, `visibleChatRect`, `placeChatHighlight`, `InspectorChatRevealer`, `resolveChatRevealTargets`, `InspectorChatPicker`, `matchChatElement`, `matchChatNodeRow`.
- **Data flow:** the revealer finds candidate elements, scrolls them natively, then flashes a **body-level overlay**; the picker installs a transparent click-catching mask over the Chat and hit-tests with `elementsFromPoint()`.
- **Non-obvious design decisions:**
  - **The Inspector adds no elements to the Chat content.** The highlight is a body-level overlay; the mask is a separate fixed element.
  - **Native scrolling is used**, and the flash happens only after *all* moving ancestors have finished scrolling.
  - **Reduced motion is honoured**: the navigation is immediate and there is no flash.
  - **The reveal has a ranked fallback**: the exact identity, then a nearby loaded node in the same Step, then the same Turn, then other loaded Turns, ordered by event distance. "Missing, empty, or still-hidden occurrences do not stop navigation."
  - If no candidate can render, the **visible Chat column is highlighted** without moving it.
  - **Text similarity is never used** to identify a target — only existing data attributes.
  - The picker **forwards wheel movement** to the underlying Chat scrollport and consumes the pointer events so the underlying control is not activated.
  - A pick that finds no match **stays active with a notice** rather than silently cancelling.
  - **One active picker per plugin instance**; separate instances do not cancel one another, and unloading releases the picker without calling the panel's callbacks.
- **Edge cases & failure handling:** a queued flash is discarded when the row becomes hidden or leaves the viewport; a replaced animation cannot remove the new highlight; a missing Chat refuses the pick.

#### `packages/experimental/session-inspector/src/client/views/InspectorTable.tsx`
- **Purpose:** the shared virtualized table.
- **Key abstractions:** `InspectorInjected`, `InspectorTable`.
- **Data flow:** the table consumes a row snapshot, a keyed record reader, a type reader, a load-older command, and optional object navigation.
- **Non-obvious design decisions:**
  - **Only the selected table subscribes.** The Chat and log models are both lazy; switching presentation swaps the subscription.
  - The table uses **TanStack Virtualizer** with a fixed 30-pixel row height, and computes the sticky ancestors from the *committed* geometry.
  - The horizontal **data preview is a projection; the raw detail is not**. Preview filtering never removes fields from the raw JSON.
  - The identity column shows the **complete value in a tooltip** outside the table's clipping area.
  - A row that was removed or settled is reported ("This record was removed or settled. Select a current record.") rather than showing stale data.
  - A reference's details stay navigable **after its table row has disappeared**.
- **Edge cases & failure handling:** pagination retry, the loading state, and an empty history are all handled; a formatter error is contained and the details panel can be closed and reopened.

#### `packages/experimental/session-inspector/src/client/views/index.ts` and `View.tsx`
- **Purpose:** the Sidebar tab and the presentation switch.
- **Key abstractions:** `registerInspectorTab`, `SessionInspectorView`, `SessionInspectorInjected`, `InspectorPresentation`.
- **Data flow:** the tab is registered once; per Session, a `WeakMap` caches the Chat model, the log model and the row readers; the view switches between them.
- **Non-obvious design decisions:**
  - **The models are cached per `SessionBinding`**, not per Session id, so the cache follows the session's lifetime.
  - **Changing presentation resets the local selection, the type filter and the scroll state** — the two presentations are different views, not two columns.
  - The tab registers **a Sidebar page and a guide entry, not a Conversation View** — it borrows the Sidebar's existing Session reference.
  - The **crosshair button** owns the picker; the picker is disposed when the plugin unloads.
  - **A picked row that the filter excludes clears the filter** and then reveals that row.
- **Edge cases & failure handling:** a disposed plugin refuses to start a picker; an unknown Session id throws rather than rendering an empty panel.

#### `packages/experimental/session-inspector/src/client/views/format.ts`, `raw-json.ts`, `objects.ts`, `InspectorDetails.tsx`
- **Purpose:** the preview, the raw JSON writer, the reference contract and the resizable detail panel.
- **Key abstractions:** `inspectorPreview`, `INSPECTOR_PREVIEW_LIMIT`, `inspectorJson`, `InspectorJsonWriter`, `InspectorObjectReference`, `InspectorObjects`, `InspectorDetails`.
- **Data flow:** the preview is a bounded horizontal string; the raw JSON is a separate, lossless serialisation of the same value.
- **Non-obvious design decisions:**
  - **The preview is type-specific**: a tool-call delta shows only `argumentsDelta`; a reasoning delta shows only `text`; a generic record omits `type`, `seq` and `sequence` and the top-level `time`.
  - **When one field remains, only its value appears** (no field name); with two or more, the names stay.
  - `inspectorJson` marks **only true ancestors** as `[Circular]`; shared non-circular values are expanded in each branch, and a `bigint` becomes an `n`-suffixed string.
  - A serialisation failure is **contained**: the detail panel shows the error instead of retiring the view.
  - The detail panel is a **pointer-captured, keyboard-operable ARIA separator** with a 15–80% clamp.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/experimental/session-inspector/README.md` | The package reference. The decisions it records: the sticky-ancestor rule, the filter-keeps-ancestors rule, the reveal/pick precedence, "no reference navigation in Raw Log", the preview vs raw-data separation, and the pagination window limit. |
| `packages/experimental/session-inspector/README.zh.md` | The Chinese translation of the above. |
| `packages/experimental/session-inspector/README.i18n.yaml` | Generated per-heading bilingual pairing hashes. |
| `packages/experimental/session-inspector/locale/en.json` | The English tab title and description. |
| `packages/experimental/session-inspector/locale/zh.json` | The Chinese tab title and description. |
| `packages/experimental/session-inspector/package.json` | The manifest: the five injected client services, the TanStack Virtualizer dependency, and the published-files list. |
| `packages/experimental/session-inspector/tsconfig.json` | The client project references. |
| `packages/experimental/session-inspector/tsdown.config.ts` | The client bundle plan. |
| `packages/experimental/session-inspector/src/index.ts` | The inert Host discovery entry: `apply()` does nothing, because "Session inspection belongs to the Client". |
| `packages/experimental/session-inspector/src/css-modules.d.ts` | The CSS Modules ambient declaration. |
| `packages/experimental/session-inspector/src/client/index.ts` | The browser plugin: registers the dictionary and the sidebar tab. |
| `packages/experimental/session-inspector/src/client/locales.ts` | 60+ bilingual labels and the `LocaleNamespaceMap` augmentation. |
| `packages/experimental/session-inspector/src/client/views/index.ts` | The sidebar tab registration, the per-Session model cache, the picker ownership, and the row-pick routing. |
| `packages/experimental/session-inspector/src/client/views/View.tsx` | The presentation switch, the picker button, the "no match" notice and the table wiring. |
| `packages/experimental/session-inspector/src/client/views/InspectorTable.tsx` | The virtualized table, the breadcrumb navigation, the flash-on-update and the details panel. |
| `packages/experimental/session-inspector/src/client/views/InspectorDetails.tsx` | The pointer-captured resizable raw-data panel. |
| `packages/experimental/session-inspector/src/client/views/InspectorObjectTree.tsx` | The lazy value tree, the reference links and the inline Node Data expansion. |
| `packages/experimental/session-inspector/src/client/views/TypeFilter.tsx` | The portalled type-filter editor with asynchronous suggestions and explicit confirmation. |
| `packages/experimental/session-inspector/src/client/views/format.ts` | The bounded, type-specific horizontal preview. |
| `packages/experimental/session-inspector/src/client/views/object-value.ts` | The shallow typed object reader that never invokes getters. |
| `packages/experimental/session-inspector/src/client/views/objects.ts` | The Inspector-owned object-reference coordinates and the read-current-value contract. |
| `packages/experimental/session-inspector/src/client/views/raw-json.ts` | The JSON writer that marks cycles and contains a formatting failure. |
| `packages/experimental/session-inspector/src/client/views/table-layout.ts` | The virtual scroll layout that preserves the visible anchor across an automatic collapse. |
| `packages/experimental/session-inspector/src/client/views/table-model.ts` | The row identity, the disclosure-resolution rule and the sticky-ancestor hierarchy. |
| `packages/experimental/session-inspector/src/client/views/type-filter.ts` | The confirmed type filter that keeps the ancestors of matching rows. |
| `packages/experimental/session-inspector/src/client/views/inspector.module.css` | The CSS module, including the `prefers-reduced-motion` rule that disables the row animation. |
| `packages/experimental/session-inspector/src/client/views/chat-node/dom.ts` | The main-Chat DOM lookup, the visibility test and the occurrence finder. |
| `packages/experimental/session-inspector/src/client/views/chat-node/highlight.ts` | The clipped highlight geometry (scrollports and the composer). |
| `packages/experimental/session-inspector/src/client/views/chat-node/model.ts` | The Chat table order, the group nesting and the microtask-coalesced refresh. |
| `packages/experimental/session-inspector/src/client/views/chat-node/objects.ts` | The weak-identity object index for Nodes, Groups, Turns and Steps. |
| `packages/experimental/session-inspector/src/client/views/chat-node/pick-match.ts` | The element-to-row matching rules (exact part, then Node, Group, Step, Turn). |
| `packages/experimental/session-inspector/src/client/views/chat-node/picker.ts` | The click-catching mask, the hover preview and the wheel forwarding. |
| `packages/experimental/session-inspector/src/client/views/chat-node/reveal-target.ts` | The ranked reveal candidates. |
| `packages/experimental/session-inspector/src/client/views/chat-node/reveal.ts` | The deferred reveal, the native smooth scroll and the body-level flash. |
| `packages/experimental/session-inspector/src/client/views/session-log/chat-target.ts` | The original log coordinates handed to the Chat reveal. |
| `packages/experimental/session-inspector/src/client/views/session-log/groups.ts` | The Turn/Step range grouping that never synthesises a missing start. |
| `packages/experimental/session-inspector/src/client/views/session-log/model.ts` | The incremental log rows, the settlement and the live stream children. |
| `packages/experimental/session-inspector/src/client/views/session-log/stream.ts` | The block-indexed Assistant stream and the folded reasoning summary. |
| `packages/experimental/session-inspector/tests/chat-node-fixture.client.ts` | The fixture exposing the store/source cycle reached by raw Node inspection. |
| `packages/experimental/session-inspector/tests/chat-node.client.spec.ts` | Group members nest, hidden Nodes are included, content updates leave the row order unchanged, unlisted assistant steps are placed by event anchor, and a hidden table retires its groups. |
| `packages/experimental/session-inspector/tests/details.client.spec.tsx` | The raw-data height follows pointer capture and keyboard resizing without remounting the panel. |
| `packages/experimental/session-inspector/tests/format.client.spec.ts` | The previews show only the tool-call argument deltas, hide the reasoning index, apply the field selection to nested data, keep field names when more than one remains, hide the top-level time only, omit the Chat identity columns, and bound nested arrays by length. |
| `packages/experimental/session-inspector/tests/highlight.client.spec.ts` | The visible highlight geometry excludes clipped group content and the composer. |
| `packages/experimental/session-inspector/tests/log-chat-target.client.spec.ts` | A user message keeps its original sequence without inventing Turn or Step coordinates; tool identity survives for calls and results; Assistant children are described by their owning event and part; and a nested dispatch keeps its root tool call. |
| `packages/experimental/session-inspector/tests/matching.client.spec.ts` | The DOM and row matching fall back to a root tool, Group or Turn in the same Conversation, then to the loaded Turn, keeping nearby Nodes ahead of Turn headers. |
| `packages/experimental/session-inspector/tests/object-tree.client.spec.tsx` | JSON containers expand without object links; collapsed fields survive a value update; collection enumeration is bounded and reused; registered nested objects become links; Node Data expands inline but its title still navigates; Maps expand in pages and unregistered cycles terminate; accessors are marked without being evaluated; and non-index properties are disclosed separately from sparse slots. |
| `packages/experimental/session-inspector/tests/object-value.client.spec.ts` | Opaque scalar objects are labelled without exposing internals; buffers and DataViews keep byte offsets; null prototypes, symbol fields, accessors and disappearing Proxy properties are supported; sparse slots stay separate from accessors; and the intrinsic TypedArray length wins over an own getter. |
| `packages/experimental/session-inspector/tests/objects.client.spec.ts` | Node, Turn, Step and Data identities are indexed (including hidden and replaced nodes); Group snapshots, Group Data and named member parts navigate through their latest sources; collection keys and non-enumerable fields are kept without evaluating getters; and Location references are retained without rows. |
| `packages/experimental/session-inspector/tests/picker.client.spec.ts` | The mask uses the existing Slot/Chat markers and excludes hidden, nested and Sidebar occurrences; the exact group part wins over broader matches; the hover preview is kept and the selection is consumed once; unmatched picks stay active; wheel movement is forwarded; the mask is released when the Inspector is hidden; a missing Chat refuses the pick; and a copied identity is rotated. |
| `packages/experimental/session-inspector/tests/presentation.client.spec.tsx` | The single Inspector switches presentation in one table and follows a linked node through its collapsed parent. |
| `packages/experimental/session-inspector/tests/raw-json.client.spec.ts` | A real Chat Node serialises after its Location source is materialised; self-referencing objects, maps and sets are marked without being modified; shared non-circular values expand separately in each branch; and bigint stays readable while a serialisation error is contained. |
| `packages/experimental/session-inspector/tests/reveal-scroll.client.spec.ts` | The smooth navigation waits for all moving ancestors and releases its callbacks on cancellation: it flashes only after both scrolls end, only flashes an already visible target, uses the next ranked Node, highlights the Chat column when nothing renders, finds a replacement after a folded ancestor, discards a queued flash when the row hides, ignores unrelated scrolls, keeps reduced-motion navigation immediate, and lets a replaced animation not remove the new highlight. |
| `packages/experimental/session-inspector/tests/reveal-target.client.spec.ts` | The candidate ranking: an earlier user message is found by sequence; tool identity and the owning Assistant win; the approximation stays inside the requested Turn; equal distances keep the first candidate; the ranking is Step, then Turn, then Session; the root tool stays primary; and identical candidates are removed. |
| `packages/experimental/session-inspector/tests/reveal.client.spec.ts` | The reveal opens the existing searchable folds in order, selects the exact group part, and cancels its overlay resources. |
| `packages/experimental/session-inspector/tests/session-log-groups.client.spec.ts` | Each Step nests inside its Turn with the closers at the group's end; filtering keeps the Turn/Step context and folds a Step independently; a loaded start adds headers around the existing rows without replacing their record sources; and a live Assistant stays inside its Step through settlement. |
| `packages/experimental/session-inspector/tests/session-log.client.spec.ts` | The raw log reuses published historical rows, keeps earlier snapshots immutable, maps picked Chat identities to tool calls and reasoning blocks, nests interleaved deltas under their `block-start` and folds each block at `block-end`, restores closed historical blocks collapsed, groups live deltas across an interleaved entry, replaces transient rows with lossless stream children, stops observing hidden tables, releases settled identities outside the window, and accepts a settlement whose live frames were never loaded. |
| `packages/experimental/session-inspector/tests/stream-summary.client.spec.ts` | The folded reasoning summary joins only the matching deltas, keeps the preview bound while retaining the original chunk counts, and keeps a finish chunk outside the indexed content blocks. |
| `packages/experimental/session-inspector/tests/table-filter.client.spec.tsx` | A confirmed filter preserves the contextual ancestors and reveals a picked row. |
| `packages/experimental/session-inspector/tests/table-geometry.client.ts` | The fixed row geometry used by the jsdom tests, which has no layout engine. |
| `packages/experimental/session-inspector/tests/table-hierarchy.client.spec.ts` | The Assistant and active block headers stay above the virtual viewport; a manually collapsed Assistant hides every descendant; an open-block override resets at closure but the block can be reopened; an ancestor outside the loaded window produces no sticky header; and a keyed row projection is cleared when its source is removed. |
| `packages/experimental/session-inspector/tests/table-layout.client.spec.ts` | The rows stay contiguous and the parent is anchored; trailing blank space is filled by new rows; closed history stays compact and a manual disclosure resets the spacing; the current Turn is used below the header; each nested sticky header is replaced when the next Step reaches that level; a manual anchor stays reachable; a surviving later row is anchored; and a removed anchor is reset. |
| `packages/experimental/session-inspector/tests/table-scroll.client.spec.tsx` | The table starts at the tail, retains the nested sticky headers, follows an automatic block closure, and retains trailing space when folding the final Turn. |
| `packages/experimental/session-inspector/tests/table.client.spec.tsx` | The merged reasoning preview is used only when folded and the raw `block-start` fields are preserved; only the horizontal preview omits the type and sequence fields; the table is virtualized and the selected row updates in place with an animation; cyclic raw nodes open and a formatter error is contained; the complete row identity shows in a tooltip outside the clipping area; empty history, pagination retry, the loading state and a removed selection are handled; and reference details stay navigable after their row disappeared. |
| `packages/experimental/session-inspector/tests/type-filter-editor.client.spec.tsx` | Out-of-order responses are discarded; Enter confirms the typed fragment; candidates confirm by keyboard or click; drafts are discarded on dismissal; a candidate failure is contained; the focus stays inside the panel until blur leaves it; an empty candidate list stays unselected; and a non-Error failure does not lose the draft. |
| `packages/experimental/session-inspector/tests/type-filter.client.spec.ts` | Type fragments match case-insensitively with optional surrounding stars; matching descendants of a closed block are revealed without unrelated children; an empty result is produced when nothing matches; and the suggestions are asynchronous, distinct and independent of the row disclosure. |
| `packages/experimental/session-inspector/tests/views.client.spec.ts` | The Host discovery stays inert; the plugin registers a Sidebar page and guide entry without a Conversation View; it waits for the Sidebar slot and follows its redeclaration; and it binds the cached sources, pagination and exact-or-approximate picking to the inspected Session. |

### Tier 3 — skipped with a reason

- `packages/experimental/session-inspector/README.zh.md` — the Chinese translation of `README.md`. The English README carries the same decisions and `README.i18n.yaml` records the per-heading pairing hashes, so the Chinese file was not read line by line.

---

## 2. Ideas worth stealing

1. **A "no implementation for `<namespace>.<member>`" proxy for every plugin API.** `packages/experimental/claude-code-mods/src/api.ts:225-259` wraps the served `$` in a `Proxy` whose `get` returns a *rejecting function* for any member of a known-but-unserved namespace. A third-party plugin that reaches past the host gets a message naming the gap instead of a `TypeError`. **Why it transfers:** August Trading's provider/tool registries already have "this service was not composed" cases; the same proxy turns a missing capability into a *documented* failure. **`UNIQUE`** (no other repo in this shard does it).
2. **A budget clock that counts only the hook's own work.** `packages/experimental/claude-code-mods/src/chain.ts:54-130` pauses the deadline while the plugin awaits `next` or a `$` call, and counts nested pauses. A plugin may take 10 s of *its own* computation but unlimited latency. **Why it transfers:** August Trading's provider calls, backtests and Monte Carlo runs all have a per-call timeout today; a two-part budget (own-work budget + wall-clock budget) is the shape a tool timeout actually wants. **`UNIQUE`**.
3. **Report overflow as a *sequence gap*, never as a silent drop.** `packages/experimental/inspector/src/shared/bridge/buffer.ts:98-124` and `packages/experimental/inspector/src/worker/bridge/hub.ts:214-233`: a bounded queue drops the oldest prefix, the next frame carries `droppedBefore`, and a gap makes the consumer *ask for a full resnapshot* rather than accept a hole. **Why it transfers:** August Trading's `services/automation` has a run history and a streak breaker; the same "I lost records, here is my state again" protocol is what a trade-log UI needs when a long backtest overruns its buffer. **`UNIQUE`**.
4. **One surface, many producers, and a "generation" per connection.** `packages/experimental/inspector/src/shared/bridge/messages/observation.ts` gives every source a stable `sourceId` and a per-connection `generation`; the Worker keeps the *logical* source across reconnects and creates a *new* generation each time, so a stale frame from a dead transport can never be applied to a live one. **Why it transfers:** August Trading's SQLite/localStorage stores, the agent sessions and the bot roster all need "same thing, new instance" semantics; the `sourceId` + `generation` pair is a two-word answer. **`UNIQUE`**.
5. **A "refuse to rewrite the logged input" rule, with the reason in the message.** `packages/experimental/claude-code-mods/src/index.ts:411-424`: a hook that changes the tool arguments it passes down is *skipped* and reported, because "the call is logged before policy runs, so the arguments a hook passes down must be the logged ones". **Why it transfers:** August Trading logs every trade and every AI decision; a plugin or a service that could change an argument *after* it was logged would break the audit trail. Naming the missing mechanism in the refusal is the transferable part. **`UNIQUE`**.
6. **A stale-action guard by generation number.** `packages/experimental/claude-code-mods/src/surfaces.ts:120-140` and `packages/experimental/session-inspector/src/client/views/table-model.ts`: a button press names the *generation it saw*; a press from an earlier generation is reported and ignored. The session inspector uses the same shape for disclosure choices, where a manual choice is valid only for the lifecycle state in which it was made. **Why it transfers:** August Trading's approval inbox, the "Log this trade" button and the automation toggles all race against re-renders; a generation/epoch on the action is cheaper than a version check. **`UNIQUE`**.
7. **An inspector that reads the app's *own* DOM instead of adding to it.** `packages/experimental/session-inspector/src/client/views/chat-node/reveal.ts` and `picker.ts`: the highlight is a body-level overlay, the picker is a separate fixed mask, and the Inspector never adds a node to the Chat content. It scrolls natively and flashes only after every moving ancestor has settled. **Why it transfers:** August Trading's transcript and chart panes are the product; an inspector that mutated them to mark a row would corrupt what the trader is reading. **`UNIQUE`**.
8. **A "preview" that is provably a projection of the raw value, never a mutation.** `packages/experimental/session-inspector/src/client/views/format.ts` and `packages/experimental/claude-code-mods` (the `$.session.messages` projection) both build a *display* form from the original without changing it, and the raw detail always shows the original. **Why it transfers:** August Trading's trade log shows previews (e.g. a one-line summary of a tool call); the rule "the preview is a projection, the raw data is the truth" prevents the summary from becoming a second source of truth. **`CONVERGENT`** (both the mods bridge and the session inspector do it, and the `pi`/`hermes` shards are not in this file).

## 3. Trading-specific findings

- **Scheduled / long-lived work:** not in this shard. The three packages here are *observability and extension* packages; the automation, cron and run-history code lives in `packages/experimental/ralph-bundle`, `tool-ralph` and the `automation` services, which are other shards. The one transferable piece is the **reconnect backoff with a randomised half-window** (`packages/experimental/inspector/src/client/bridge/lifecycle.ts:26-33`) and the **"generation" identity** that survives a restart.
- **Human-in-the-loop approval:** the Blast Radius mod is a complete, small approval loop: classify the risky action, *measure* the consequence with real commands, hold the call, and let a human decide; **Cancel denies with the measured summary in the reason** (`packages/experimental/claude-code-mods/examples/blast-radius/hooks/blast-radius.mjs:96`). The failure mode is closed (`guard-mod` denies on error). For August Trading, the analogue is a *pre-trade* confirmation that shows the position size, the stop and the risk before the order is placed, and that **fails closed** if the measuring step fails.
- **Post-mortem / reflection loops:** not in this shard. The nearest thing is the session inspector's *settlement* path, where a transient live delta is **replaced by the durable event** and the durable record is the one that is kept (`packages/experimental/session-inspector/src/client/views/session-log/model.ts`). That is the shape a "the live number becomes the recorded number" rule should take, but the reflection loop itself lives elsewhere.
- **Multi-agent:** not in this shard. The nearest thing is the *mod chain* — a **strictly ordered** stack where a later mod sees only what an earlier mod allowed, and a mod's own call never reaches itself (`packages/experimental/claude-code-mods/src/engine.ts:236-247`). If August Trading ever runs several critics over one trade plan, that ordering rule is the transferable part: the ordering is structural, not conventional.
- **Structured logs the model can query:** this shard contains **two** answers. (a) The inspector's *observation record* pipeline — producers publish lossless JSON on a declared topic, the transport sequences and bounds it, and a **query API** reads the same state without opening a DevTools session (`packages/experimental/inspector/src/worker/inspection/query-router.ts`). (b) The session inspector's *raw log* — the Session's own event stream, grouped by Turn/Step, with the durable record as the truth (`packages/experimental/session-inspector/src/client/views/session-log/model.ts`). August Trading's trade log is already an event stream; the *query* half is what it lacks.
- **Staying simple as features accumulate:** the inspector's answer is a **closed, versioned wire protocol** with exact field sets (`exactKeys`), a single `INSPECTOR_PROTOCOL_VERSION`, and a *rejection* for anything that does not match — the feature count cannot grow without a version bump and a decoder change. The session inspector's answer is the opposite: it **adds no model-facing input, no Conversation API and no Session data**; it reads what already exists. Both are "do not add a concept" rules.
- **Human-in-the-loop, one more angle:** the *approval record* in this shard is the **replay theater** mod (`packages/experimental/claude-code-mods/examples/replay-theater/hooks/replay-theater.mjs`): it records a turn's `Edit`/`Write` calls as diffs, **seals them at `turn.complete`**, and lets a human step through them one at a time. For August Trading, the analogue is a sealed, replayable record of what a trade plan actually did — the same "seal at the boundary, replay afterwards" discipline.

## 4. Non-obvious decisions and gotchas

1. **`exactKeys` rejects unknown fields** (`packages/experimental/inspector/src/shared/validation.ts:15-27`). A frame with an extra field is *invalid*, not "extra data to ignore". This is the whole reason the protocol can be versioned: a new field requires a decoder change, and an old decoder refuses the new frame instead of silently mis-reading it.
2. **`isJsonValue` rejects `-0`, `NaN`, `Infinity`, exotic arrays, accessor properties, symbol keys and non-enumerable own properties** (`packages/experimental/inspector/src/shared/json.ts:41-63`). The predicate is about *surviving a carrier unchanged*, not about being JSON-shaped.
3. **A global/sticky `RegExp` matcher is reset before every test** (`packages/experimental/claude-code-mods/src/matcher.ts:113-116`). A matcher engine that forgets `lastIndex = 0` fails on the second event — a classic, quiet bug.
4. **`null` is a valid hook answer**; only a hook that settles with a *non-object* is "no result" (`packages/experimental/claude-code-mods/src/chain.ts:245-247`). A surface that draws nothing is not a failure.
5. **A hook that fails *after* `next` resolved does not un-run the tool** (`packages/experimental/claude-code-mods/src/chain.ts:267-277`). The result from beneath stands; the failure is reported.
6. **A plugin's `$` call reaches only the mods loaded *before* it** (`packages/experimental/claude-code-mods/src/engine.ts:236-247`). A plugin cannot observe its own call — structurally, not by convention.
7. **The `$.store` write budget is measured in UTF-8 bytes, not characters** (`packages/experimental/claude-code-mods/src/host-ops.ts:397-406`), and concurrent writes to one plugin's record are serialised through a per-plugin promise chain.
8. **A Client execution-context id is negative** (`packages/experimental/inspector/src/worker/bridge/runtime-rpc.ts:196`), so a synthetic Client context can never collide with a native Node context id; and a *missing* Client context is an explicit error rather than a fallback to the Host, because falling back would evaluate in the wrong realm.
9. **A CDP `objectId` is connection-scoped; a `BackendNodeId` is not** (`packages/experimental/inspector/src/worker/cdp/ids.ts`). Two DevTools connections see the same tree through different object ids.
10. **`DOM.getDocument` serves three levels by default** and withholds the rest, advertising `childNodeCount`; expansion fetches only the *missing* child lists so the frontend keeps its existing node objects.
11. **The Client's `node:inspector` session is per DevTools connection, not per Host** (`packages/experimental/inspector/src/worker/realms/host/bridge.ts:20-27`) — that is what lets Host debugging stay available while the Host's JavaScript is paused.
12. **The fetch capture keeps the wrapper-created `Request` reachable in a module-level `WeakMap`** (`packages/experimental/inspector/src/host/inspection/network.ts:16-21`), because Node's fetch forwards the caller's abort signal only while that Request is reachable. A subtle platform bug, documented in place.
13. **The mirrored DevTools frontend is built from the npm sources with no network access** and the DevTools *upstream* source is patched with **exact string replacements that are asserted to occur exactly once** (`packages/experimental/inspector/scripts/devtools/source.ts:97-104`).
14. **A manual disclosure choice in the session inspector is valid only for the lifecycle state in which it was made** (`packages/experimental/session-inspector/src/client/views/table-model.ts:24-32`): an automatic `block-end` resets the user's earlier "open" choice, but the block can be reopened.
15. **The reserved blank space after an automatic collapse goes *below* the data, never above** (`packages/experimental/session-inspector/src/client/views/table-layout.ts:40-62`), so the reader's current row does not move and new rows fill the gap before tail-following resumes.
16. **A missing group start is never synthesised** in the log grouping (`packages/experimental/session-inspector/src/client/views/session-log/groups.ts:36-60`); loading an earlier start *adds* ancestry to the rows that already exist.
17. **The Inspector never runs a getter to show a value** (`packages/experimental/session-inspector/src/client/views/object-value.ts:31-34`); a getter is labelled and a sparse slot is distinguished from an explicit `undefined`.
18. **The `plain` preview is a projection, never a mutation** — and a singleton field shows only its value while two or more keep their names (`packages/experimental/session-inspector/src/client/views/format.ts:24-32`).
19. **The Client's unsupported CDP options are refused by name** — `throwOnSideEffect`, `serializationOptions`, `disableBreaks`, `userGesture`, native contexts, and `allowUnsafeEvalBlockedByCSP` (`packages/experimental/inspector/src/worker/realms/client/runtime.ts:120-140`). Silently ignoring them would be a lie about what the browser did.
20. **`ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` is the one startup failure that does not fail the plugin** (`packages/experimental/inspector/src/host/plugin.ts:56-63`): the Host warns once and keeps a route that answers `503`.

## 5. Weak spots

1. **The inspector is a very large machine for a debugging tool.** Three tiers (Host / Worker / Client), a mirrored `client/` ↔ `host/` tree, a private wire protocol with 18 message types, ~30 configuration knobs, and a self-hosted Chrome DevTools frontend compiled from npm sources. The value is real, but the surface area is much larger than the feature, and a `layout.host.spec.ts` exists purely to *keep the mirror in sync* — a tax paid every time the file set changes.
2. **The `no implementation` proxy and the "unserved capability" pattern are duplicated across the two inspector faces** (`host/cdp/*` and `client/cdp/*` are near-mirror files that mostly *refuse*). The refusals are correct, but the repetition is exactly the drift risk the rest of the package is careful about.
3. **The inspector is a *developer-only* feature with production-grade ceremony.** Every message is versioned, bounded, exactly decoded and correlated — for a tool whose users are the package's own maintainers. The `DSHInspector.getCordisTree` query API is the part that generalises; the rest is a lot of surface for a local debugging session.
4. **The `claude-code-mods` bridge is explicitly an alpha compatibility demonstration.** Half of its namespaces are unserved, `plugin.json`/`hooks.json` are not read, `next` runs only once (Claude Code runs the chain again), the `tool.call` hook runs *after* the permission decision, and a mod runs in-process with full authority. The README's own limitations list is longer than most of the feature list.
5. **The session inspector's DOM coupling is a real fragility.** Picking, revealing and highlighting all depend on *other* components' `data-*` attributes and their "searchable fold" behaviour, and the README concedes that "Approximation cannot recover an unrendered message's exact location". A rename in the Chat component silently breaks the Inspector.
6. **Some of the inspector's tests assert on internals rather than behaviour.** `layout.host.spec.ts` reads the source tree's *file layout* to assert the mirror is in sync — a test that fails on a rename rather than on a defect, and that will eventually forbid a legitimate refactor.


