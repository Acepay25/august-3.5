# deepseek-harness :: dsh-interaction-guard-plan

**Files in shard:** 167 (read: 150, skipped with reason: 17 — all 17 are `generated-vendored`
`README.i18n.yaml` translation-pairing hash records or 2 SVG placeholder icons; see §1 Tier 3)
**What this shard covers:** four sibling package groups in the `deepseek-harness` monorepo, all of
them about the seam between a running agent and a human: `guard/` (loop hygiene — a repeat-tool-call
reminder and a cooperative per-tool-call timeout policy), `interaction/` (the human-collaboration
plane — slash commands, one-shot approvals, permission presets, a question/answer service, and the
model-side `ask_user_question` tool), `plan/` (plan mode: a per-agent collaborative state where the
agent must submit a written plan for review before executing), and `preset/` (declarative agent
presets — a registry of named tool/prompt/skill bundles, an agent-preset composition row, and a
persona row). Together they are the reference's answer to "how do you keep a tool-using agent
honest, bounded, and interruptible without taking the tools away from it".

**How this shard was read:** every `source` file was read in full. `docs` were read in full for the
English READMEs; the `README.zh.md` siblings (translation pairs) were read as head + full heading
index, which is enough to confirm they carry the same decisions. Large test files were read as
head + full `describe`/`it` title index (the titles are the assertions). All `generated-vendored`
(`README.i18n.yaml`) and `assets` files were peeked, not read line by line — see §1 Tier 3.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/guard/repeat-tool-reminder/src/index.ts`
- **Purpose:** an *advisory* per-agent detector for "the model is calling the same tool with the
  same arguments over and over"; it injects a model-visible nudge instead of blocking the call.
- **Key abstractions:** `Config` (schemastery-validated) at `src/index.ts:35` / `Config` schema at
  `src/index.ts:52`; `name = 'repeat-tool-reminder'` (`:24`); `apply(ctx, config)` (`:169`);
  `observe(exec)` (`:196`); `canonicalize` (`:110`); `sortJsonValue` (`:96`); `wildcardToRegExp`
  (`:115`); `previewArguments` (`:125`); `validateThresholds` (`:135`); `prependContext` (`:154`).
  It also *extends the platform type* `MessageSourceMap` (`:14`) so its injected message is
  typed everywhere it can be rendered.
- **Data flow:** a tool call finishes (or is denied) → `tools/post-execute` fires (`:220`) →
  `observe()` canonicalises the arguments, advances that agent's chain in a `WeakMap<Agent,Chain>`,
  and returns a reminder **only if the new count exactly hits a configured threshold** → the
  listener calls `next()` FIRST, then folds the reminder into the returned `PostToolDecision`'s
  `additionalContexts` (prepended, so the guard's source and metadata survive) → the session
  renders it as a synthetic `user/message` whose `source.kind === 'repeat-tool-reminder'`.
- **Non-obvious design decisions:**
  - *Counting happens in `post-execute`, not `pre-execute`.* Denied calls flow through the same
    waterfall, so "a model hammering a denied tool" is counted too (`:196` comment). One listener
    covers every attempt with no cross-event state.
  - *Untracked calls are TRANSPARENT, not resets.* A call excluded by `include`/`exclude` neither
    increments nor resets the chain (`:183` `tracked()`), so `grep X → todo_write → grep X` still
    counts as two consecutive `grep X` — bookkeeping tools cannot launder a loop.
  - *Advisory only.* The listener always delegates and *prepends* to whatever comes back, including
    a downstream `kind: 'block'` decision (`:220-232`). A later listener may still veto.
  - *The chain key is a deep key-sorted JSON string* (`:96-112`). Because arguments arrive as
    `JSON.parse` output, the JSON value domain is the whole input domain — hence no bigint/cycle/
    `undefined` handling, stated as a deliberate proof rather than an omission.
  - *Exact thresholds only.* A chain at 9 repeats with `thresholds: [3,5,8]` goes **silent**
    (the README lists this as a known limitation). Escalation is a function of the exact count.
  - *`thresholds[0]` is the gentle tier.* The gentle wording is keyed to the *first* configured
    threshold, not the literal 3, so a custom first threshold keeps the escalation shape
    (`:70`, `detailedReminder` at `:77`).
  - *Fail-loud config.* Empty list, non-integer, value < 2, or duplicates all **throw at plugin
    load** (`:135-148`); `argumentsPreviewChars` must be an integer ≥ 1 (`:176`). No silent default.
  - *The preview cap bounds only the model-visible text.* Detection always compares the FULL
    canonical string; the cap is a token guard, not a detection limit (`:120-128`).
  - *Per-agent chains keyed by `WeakMap<Agent,…>`*, and a user prompt (`agent/pre-step`, `:236`)
    deletes the submitting agent's chain — a fresh instruction is never treated as a loop. Object
    lifetime bounds the entry, so no disposal listener is needed.
  - *Calls with no `exec.agent` are ignored* (`:196-198`) — a direct `ctx.tools.execute()` caller
    has no model to remind and no identity to key on.
- **Edge cases & failure handling:** malformed argument JSON falls back to the raw string as the
  canonical key (so it still matches itself). Config errors throw at load. The guard never blocks,
  so a misfire costs one extra message, not a failed turn. Chains are in-memory only: a resumed
  session starts fresh (documented cost). Compaction does **not** reset a chain.
- **Surprising:** the reminder rides `additionalContexts`, **not** a `content` replacement — the
  `tool/result` event stays the tool's own output so the audit trail remains honest. And the
  guard's own injected message is a `user` role message; a seat cannot obey the split between
  "the trader's words" and "the harness's" without exactly this kind of source-stamped
  distinction (the same idea August Trading encodes in `utils/harnessMarks.ts`).

#### `packages/guard/timeout-policy/src/index.ts`
- **Purpose:** arm a *cooperative* per-call deadline for any tool that declares `timeoutMs`, and
  convert the timeout into a clean, model-readable error result.
- **Key abstractions:** `TOOL_TIMEOUT = 'TOOL_TIMEOUT'` (`:25`) — one string used BOTH as the
  internal `deadline()` classification code and as the structured `error.code`; `name =
  'timeout-policy'` (`:28`); `inject = ['tools']` (`:31`); `toolTimeoutResult(timeoutMs)` (`:41`);
  `apply(ctx)` (`:55`).
- **Data flow:** `tools/execute` fires → read the declared budget from the registry
  (`ctx.tools.get(exec.name, exec.agent)?.timeoutMs`, `:56`) → a tool with **no** budget delegates
  untouched (`:58`) → otherwise `deadline(exec.signal, timeoutMs, TOOL_TIMEOUT)` builds a fused
  signal → the wrapper **mutates the shared `exec` in place** to swap the derived signal onto
  `exec` for dispatch (Cordis `next()` ignores passed arguments) → `await next()` → if
  `timeoutOf(d.signal, TOOL_TIMEOUT) !== undefined`, the result is replaced with
  `toolTimeoutResult` → the `finally` restores the caller's original signal.
- **Non-obvious design decisions:**
  - *The tool declares its own budget.* `timeoutMs` lives on the tool's `ToolDefinition`, so a
    mistyped tool name is impossible and there is no registry-wide default. The shipped
    `bash`/`read`/`write`/`edit` declare none and are therefore never cut off.
  - *Signal swap, then restore.* `tools/post-execute` listeners must never see this plugin's
    possibly-aborted signal, so `exec.signal` is restored in a `finally` (`:73-75`).
  - *Scoped classification.* `timeoutOf(d.signal, TOOL_TIMEOUT)` is scoped **by code**, so a
    nested *outer* deadline (another `tools/execute` wrapper's timer that fired first) reads as an
    ordinary upstream cancel instead of being misreported as this plugin's timeout. The test
    "preserves registry ABORTED when the caller aborts first" pins exactly this.
  - *Enforcement home vs. timing library.* The plugin owns per-call wiring; `@deepseek-ai/dsh-timeout`
    owns `deadline`/`timeoutOf`. The split is deliberate and recorded in an Agent Note.
  - *Composition order is semantics.* Multiple `tools/execute` listeners compose by Cordis
    registration order: the outer timeout covers a whole retry operation, the inner one covers
    each attempt.
- **Edge cases & failure handling:** the deadline is **cooperative** — a tool that ignores
  `exec.signal` keeps the caller waiting and produces **no** timeout result until it settles; the
  plugin never hard-kills. A provider that throws its own abort error (the web-provider shape) is
  still rewritten to `TOOL_TIMEOUT` when the plugin's timer was the one that fired — the tool's own
  abort result is replaced, not surfaced. If the *caller* aborts first, the registry's own
  `TOOL_ABORTED` result is preserved, not overwritten. Timeout-wins-then-caller-aborts-later keeps
  `TOOL_TIMEOUT` (the timeout is not "un-winnable" by a later abort).
- **Surprising:** the file's own header carries a `FIXME` about a `@deepseek-ai/dsh-timeout-guard`
  rename that the naming ledger has already settled the other way — the README calls the FIXME
  stale. The package is named `timeout-policy` but the directory is `timeout-policy` while the
  npm name is `@deepseek-ai/dsh-tool-call-timeout-policy`; three names for one thing.
- **Deliberately left out:** no blanket per-tool default, no hard kill, no global budget.

#### `packages/interaction/commands/src/index.ts`
- **Purpose:** a registry of *plugin-owned slash commands* that a human can type in an interactive
  UI to drive an agent **without a model round trip** and without creating a model message.
- **Key abstractions:** `CommandRuntime` (`:263`, extends `TypertRemoteService`, so
  `list`/`find`/`execute` are `@Remote`-exposed to a remote UI); `CommandDefinition` (`:61`);
  `CommandInvocation` (`:41`); `ParsedCommand` (`:81`); `parseCommand` (`:125`);
  `normalizeDefinition` (`:179`); `normalizeResult` (`:228`); `withAbort` (`:155`);
  `renderThrown` (`:146`); `admitCommandAttachments` (`:491`); `CommandLayer` (`:94`).
  `src/types.ts` owns the *durable vocabulary*: `CommandDescriptor`, `CommandResult`,
  `CommandExecution`, `CommandSubmitAttachment`, plus the `SessionEventMap` augmentation declaring
  `'command/run'` and `'command/done'`.
- **Data flow:** a UI adapter calls `execute(agent, line, attachments, signal)` (`:361`) →
  `parseCommand` rejects anything that is not a command at byte zero (`:125`) → an unknown name
  returns `undefined` and **logs nothing** (an admission miss never entered a handler) → a
  `commandId` is minted (`:446`, `cmd-<instanceToken>-<seq>`) → `command/run` is appended to the
  agent's session log **before** the handler runs → attachments are admitted (or settled as an
  error) → the handler runs → the result is validated and detached at the boundary
  (`normalizeResult`) → `command/done` is appended with the outcome → the adapter gets
  `{ commandId, result }` and renders it *outside* model history.
- **Non-obvious design decisions:**
  - *Commands never enter model history.* The command line, its input and its result are logged
    (`command/run` / `command/done`) but never submitted as a user message. The *handler* may
    choose to talk to the model; the registry never does. This is the "no model round trip"
    promise, and it is why `dsh-plan-mode` (in the `plan/` group) is a **command producer** that
    explicitly uses the receiving `Agent`.
  - *The lifecycle pair is a log-only append, not a turn.* `appendLifecycle` (`:457`) calls
    `session.append` directly, so no turn wraps the pair and no flush is forced — persistence
    drains at ordinary checkpoints. The README calls this out because it is unusual.
  - *`recordInput: false` exists to avoid duplicating a payload.* A command whose own
    authoritative domain event already carries the input sets it false, so `command/run.args` is
    omitted rather than the same text appearing twice in the log.
  - *Scoped shadowing, not overriding.* `ScopedLayers` merges global definitions with the exact
    agent's own layer; a command-injected plugin mounted under `agent.ctx` shadows the global
    definition **for that agent only**, and its `definitionId` does **not** leak from the
    shadowed global (`normalizeDefinition` builds the descriptor from the *selected* definition
    only). Duplicate names within one layer throw; the error message names the fix
    ("mount a command-injected plugin under that agent's `agent.ctx`").
  - *The registry notifies observers without letting them veto.* `notifyChange` (`:475`)
    dispatches `commands/change` and contains each callback independently — with the explicit
    reason that Cordis's `Array.map` would let one synchronous throw starve later listeners.
  - *Command ids are instance-token-prefixed* (`cmd-<8-hex>-<seq>`), "monotonic per service
    instance" but safe across a resumed log: a session resumed after a restart must not repeat a
    lifecycle id.
  - *Everything crossing the boundary is validated and frozen.* `normalizeDefinition` rejects a
    bad name/description/hint/handler with a `TypeError`; `normalizeResult` rejects a non-`Error`
    rejection, a non-string success text and a negative/`-0` `sourceEventSeq`; every returned
    object is `Object.freeze`d.
  - *Admission is enforced in the executor, not the composer.* Attachments sent to a
    non-declaring command, an absent attachment store, an unknown session-scoped receipt, or an
    over-limit image batch each **settle as a logged error before the handler runs**; a rejected
    admission starts no attachment writes.
  - *Cancellation is checked at two points*: before the handler, and again **after** admission
    ("admission may await slow storage, and a handler entered after the caller cancelled would
    mutate state the retrying caller then duplicates" — `:410-417`).
- **Edge cases & failure handling:** a throwing handler is logged as `command/done kind: 'error'`
  **and** rethrown (`:390` of the test file pins both halves). A handler that ignores the abort
  signal is *not* awaited any more (`withAbort` rejects the wrapper) — the registry stops waiting,
  but the handler's own external side effects may continue; the README lists this as a known
  limitation ("cooperative side-effect cancellation"). A `command/done` append failure on the
  handler-failure path is **contained and logged** so the handler's own error stays the reported
  failure (`:434` `settleThrown`); a `command/run` append failure, by contrast, **fails the
  execution loud**. An image-storage failure can leave unreachable content-addressed objects for
  deferred collection but publishes no model-visible message.
- **Surprising:** the `package.json` ships **four** export entry points (`.`, `./types`,
  `./brand`, `./typert`, `./remote`) because the same module is compiled for both a *Host* and a
  *Client* face; `src/brand.ts` deliberately imports **no cordis** so a client program can name
  the brand without pulling the Host's `Context` merges. The `CommandSourceMap` sum type has
  exactly **one** variant (`user`) and says why: every executor caller is a human-facing UI
  dispatching a human-typed line.

#### `packages/interaction/commands/src/types.ts`
- **Purpose:** the durable, client-safe command vocabulary shared by the host, the wire, and the
  UI adapters.
- **Key abstractions:** `CommandSubmitAttachment` (image | file receipt); `CommandInputDescriptor`
  (`hint` + optional `attachments: boolean`); `CommandResult` (`success` with optional `text` and
  `sourceEventSeq` | `error` with required `text`); `CommandExecution`; `CommandDescriptor`;
  `CommandSourceMap` / `CommandSource`; and the two `declare module` augmentations:
  `cordis`' `Events` (`'commands/change'()`) and `dsh-session/types`' `SessionEventMap`
  (`'command/run'`, `'command/done'`).
- **Data flow:** it is a *type-only* module — it declares the wire shape; the host implements it.
- **Non-obvious design decisions:** the comment on `CommandInputDescriptor.attachments` states the
  division of labour explicitly: the *executor* rejects an invocation carrying attachments when
  the command did not declare them, capable *composers* refuse the submission before dispatch,
  and the *handler* owns every further grammar decision (including rejecting sub-commands that
  cannot use the attachments). The `'command/run'` doc comment pins the "mirroring the
  `tool/call`↔`tool/result` pairing" pattern — a paired record per invocation, so a consumer never
  has to re-parse a command line.
- **Edge cases & failure handling:** n/a (types only). The `sourceEventSeq` reference lets a
  successful command point at an *earlier authoritative domain event* so a client can render a
  richer presentation than the command's own text.
- **Surprising:** `CommandSourceMap` is a merge-extensible sum type with a single variant,
  mirroring `MessageSourceMap`'s shape but deliberately minimal.

#### `packages/interaction/commands/src/brand.ts`
- **Purpose:** branded identity types for command *definitions* (`CommandDefinitionId`) and
  command *executions* (`CommandId`).
- **Key abstractions:** `CommandDefinitionId(id)` and `CommandId(id)` — pure constructors that
  cast a string to a branded type with **no validation**.
- **Data flow:** a plugin mints its own stable, namespaced `definitionId`; the executor mints the
  `commandId` that pairs `command/run` with `command/done`.
- **Non-obvious design decisions:** the module is a "pure type/constructor outlet" that imports
  **no cordis and does no module augmentation**, precisely so a *Client* compilation face can name
  the brand without loading the Host plugin's `Context` merges (the `dsh-llm/brand` shape).
- **Edge cases & failure handling:** none — the constructors validate nothing; the registry
  validates everything else.
- **Surprising:** two distinct identities exist for one command — a stable *definition* identity
  (independent of name and copy, so renaming a command does not break a client) and a per-run
  *execution* id.

#### `packages/interaction/permission-presets/src/index.ts`
- **Purpose:** one user-facing "Permissions" selector that bundles two *independent* enforcement
  knobs — the bash sandbox mode and the approval policy — into named presets, without taking
  ownership of either knob.
- **Key abstractions:** `PermissionPresetService` (`:180`, a `TypertRemoteService` exposing
  `catalog()` over `@Remote('catalog')` at `:292`); `PresetSpec` (`:64`); `Config` (`:159`) with a
  schemastery `static Config` (`:182`); `CUSTOM_PRESET = 'custom'` (`:79`); `AUTO_PRESET = 'auto'`
  (`:82`); `AUTO_PRESET_SPEC` (`:89`); `KnobState` (`:98`); `applyPermissionEvent` (`:134`, the
  projection unit's fold); `derive(state)` (`:348`, the shared matching mathematics);
  `pinInitialPermission(session)` (`:428`); `specOf` (`:475`).
- **Data flow:** the plugin mounts with `inject = ['shell','approval','sessions','sessionProjections']`
  (`:201`) → it registers a `permissions` **Session projection** whose state folds three
  whole-value knob events (`permission/preset`, `sandbox/mode`, `approval/policy`) plus
  `session/end-seed` over the composition defaults (`:113-150`) → a switch (`apply`, `:403`)
  resolves the bundle, runs Auto's admission gate *synchronously first*, appends
  `permission/preset` **only if the effective preset changed**, and then writes each *changed*
  knob through its own canonical setter (`setSandboxMode` from `dsh-sandbox-policy`,
  `setApprovalPolicy` from `dsh-user-approval`) → the read side (`current(session)`, `:341`)
  folds the same state and resolves the *still-matching* last selection.
- **Non-obvious design decisions:**
  - *The bundle never replaces the knobs.* Presets are a *presentation* layer over two knobs that
    keep their own owners, their own events and their own execution semantics. Removing this
    package leaves the last selection in effect. This is the single most transferable idea in the
    shard: a "mode selector" that writes through to existing canonical setters rather than
    inventing a parallel state.
  - *`permission/preset` records intent; the knob events control execution.* The event doc says
    so explicitly: "The knob events follow in the same turn and control execution; this event
    stays out of the model transcript and lets the permission projection unit preserve a selection
    when bundles match." Two presets sharing a bundle therefore keep their *distinct identities*.
  - *`custom` is derived, not stored.* An unmatched knob combination returns `CUSTOM_PRESET`
    (`:79`, `derive` at `:348`); users can leave that state but cannot select or persist a named
    `custom` preset. The reserved names are rejected at **load** (`:211-217`).
  - *The tie-break is deliberate and asymmetric.* A still-matching *last selection* wins a
    shared-bundle tie; otherwise the *first configured match* wins; otherwise `custom`. A
    recorded `auto` selection also matches the `never` policy, because a delegated child pins
    `never` so its reviewer denials stay final (`:352-356`).
  - *`auto` is a current-session-only, effect-scoped contribution.* `registerAuto(admit)`
    (`:303`) publishes one fixed bundle (`danger-full-access` + `ask`) for the effect's lifetime;
    it can never become a default, and it is absent from the settings schema. Its **admission
    check runs before any write**, even for a no-op selection (test at `:126`).
  - *Mounting over an unconfined executor is a misconfiguration and throws at load*
    (`:218-221`) — because a preset bundles a sandbox mode, a shell without `sandboxMode` makes
    the whole concept meaningless.
  - *Session pinning distinguishes "fresh" from "seeded".* `pinInitialPermission` (`:428`) reads
    the projection's `seeded` flag (set by `session/end-seed`) so an explicitly empty restored
    seed is not mistaken for a fresh session: a fresh session gets the user default, a seeded one
    keeps its effective knobs and gains only the *missing* durable facts. A stored `auto` identity
    **fails publication** when the integration is absent — the service neither rewrites it nor
    silently derives Full access.
  - *The catalog is process-level and the current value is session-level.* `catalog()` is a
    `@Remote` returning the whole selectable snapshot; the `permissions` projection carries
    **only** `currentValue` (the projection test asserts `not.toHaveProperty('options')`).
    Registering Auto emits a **payload-free** `permission-presets/catalog-changed` notification —
    no Session event, no projection frame, no seq change (`:459` `emitCatalogChanged`).
  - *Notification listeners are contained individually* (`:459-473`) — the same "one throwing
    observer must not starve the others" discipline as the command registry.
  - *The `/permission` command is optional* — it registers only when a `ctx.commands` registry is
    composed (`:255-273`), and its settlement text deliberately does **not** name its own value
    ("a surface that renders `name · text` would otherwise read `permission · Permission preset:
    workspace-write.`"). The same no-self-labelling rule is pinned in the test at
    `tests/projection.spec.ts:188-203`.
- **Edge cases & failure handling:** a missing `permissions` projection key **fails explicitly**
  (`:328-331`) rather than defaulting. A stored default outside the configured table throws at
  read (`:452` of the test). Re-selecting the current preset appends **nothing** (`:407`) —
  "clicks are not switches". Re-asserting a preset from a drifted (`custom`) state re-records the
  choice and repairs the knob (`:246` of the test). Removing a preset that `defaultPreset` names
  requires changing both in the same Config edit (documented limitation).
- **Surprising:** `defaultPreset` is a `Volatile<string | undefined>` — a *volatile* config field
  is re-read on every access (`config.defaultPreset.get()`), so a settings change moves the
  default for **future** sessions without a remount. And the settings child is configured with
  `{ auto: false }` (`:208`) — the plugin explicitly opts out of the auto-generated settings page.

#### `packages/interaction/permission-presets/src/types.ts`
- **Purpose:** the ONE home of the `permissions` projection-key declaration plus the catalog and
  selection payload types, free of any host-side value import.
- **Key abstractions:** `PresetOption` (`value`, `name`, optional `description`); `PermissionCatalog`
  (`options`, `defaultOptions`, `defaultPreset`); `PermissionSelection` (only `currentValue`);
  the `cordis` `Events` augmentation for `'permission-presets/catalog-changed'`; the
  `dsh-session-projection/types` augmentation declaring the `permissions` projection key.
- **Data flow:** type-only — it declares the wire and projection shape; `src/index.ts` implements.
- **Non-obvious design decisions:** the module is served through **two namespace projections**
  (the package root for host consumers, `./client` for client aggregates) with "zero content
  duplication" — the client file is literally `export type * from './types.ts'`. The catalog is
  "deliberately separate from Session history" because it is a *process* fact, not a session fact.
- **Edge cases & failure handling:** the projection doc states the failure semantics: "Key absence
  means no permission service is composed — clients hide the control." The catalog-change event
  is "payload-free by design: consumers subscribe first, then re-read the complete catalog".
- **Surprising:** `PresetOption.description` is optional and omitted when not configured — the
  client must not assume a sentence exists.

#### `packages/interaction/permission-presets/src/client.ts`
- **Purpose:** the client-namespace projection of the permission domain — a one-line
  `export type * from './types.ts'`.
- **Key abstractions:** none of its own; it re-exports `src/types.ts` verbatim.
- **Data flow:** client code imports ONLY the `./client` namespace (a repo discipline), so the
  browser half-entry gets the same single-source content the host gets from `./types`.
- **Non-obvious design decisions:** the whole file exists to satisfy a *repo discipline* ("client
  code imports ONLY the client namespace") without duplicating a single type. This is the cheapest
  possible "one source, two audiences" solution.
- **Edge cases & failure handling:** n/a.
- **Surprising:** a 388-byte file with a real architectural purpose.

#### `packages/interaction/tool-ask-user/src/index.ts`
- **Purpose:** the model-facing `ask_user_question` tool — the *legacy* (blocking) definition the
  shipped presets use.
- **Key abstractions:** `Config` (`:16`) with `mode: 'legacy' | 'timed'` and `timeout`
  (`:23`); `name = 'tool-ask-user'` (`:28`); `inject = ['tools','userQuestions']` (`:29`);
  `apply(ctx, config)` (`:33`).
- **Data flow:** the tool's `execute` (`:98`) maps the *model's* schema vocabulary
  (`multi_select`) onto the *service's* vocabulary (`multiSelect`), forwards the calling agent and
  the tool's `exec.signal`, awaits `ctx.userQuestions.ask(...)`, and returns a detached answer
  payload whose `render` is `JSON.stringify(value)` (`:80`).
- **Non-obvious design decisions:**
  - *The tool owns no UI.* The README says "Callers provide the answer UI" — the tool is a thin
    adapter over the `ctx.userQuestions` seam, and the seam is a *capability*, not a UI.
  - *Mode selection is a Cordis row, not a runtime flag.* `apply` branches at mount time
    (`:33-36`): `mode: 'timed'` registers the alternate definition and returns; otherwise the
    blocking definition is registered. The model therefore sees exactly **one** schema, chosen
    before the session starts.
  - *The timeout is validated by the schema* (`:23`: `z.union([-1, z.number().step(1).min(1).max(2_147_483)])`),
    so an out-of-range value cannot reach the runtime.
- **Edge cases & failure handling:** without an accepting answerer the call fails (the seam's
  `NO_PROVIDER`); the tool does not implement a fallback.
- **Surprising:** the *legacy* tool's `execute` has **no** `timeout` parameter at all — the
  timed variant is a different schema, not an extra field on the same one. The projection later
  relies on exactly that difference (see `projection.ts`).

#### `packages/interaction/tool-ask-user/src/timed.ts`
- **Purpose:** the opt-in **timed** `ask_user_question` definition — the same tool, but the
  foreground wait can expire while the question stays answerable.
- **Key abstractions:** `registerTimedAskUser(ctx, timeout = 120)` (`:103`); `validateTimeout`
  (`:12`); `validateQuestionIds` (`:19`); `questionRequest` (`:66`); `answerResult` (`:88`);
  `pendingNotice` (`:39`).
- **Data flow:** `execute` (`:191`) validates the effective timeout
  (`args.timeout ?? defaultTimeout`) and the question-id uniqueness → for a finite timeout it
  requires a live agent and calls `ctx.userQuestions.askTimed({...request, agent}, exec.callId,
  timeout * 1000)` → a `{ pending: true, callId }` result is returned **with the notice attached**;
  an answer is returned as the detached batch → for `timeout === -1` it calls `ask()` with
  `wait: { callId }` so the UI card is still keyed by the call id.
- **Non-obvious design decisions:**
  - *Pending is a result, not an error.* `{ pending: true, callId, message }` is a first-class
    tool outcome; the model may continue independent work and the question remains answerable.
  - *The notice lives INSIDE the result value*, not beside it (`:34-43` explains why): the recorded
    result text is read back as one JSON object, and both the projection ("this call stays
    answerable") and the client row ("this is the timeout, not an answer batch") decide from
    that one object.
  - *The pending notice says "Do not treat this as permission."* — a timeout is never approval.
  - *A skipped question is not a pending question.* The tool description spells out the
    difference: "A submitted skipped question is an answer item with empty selected and no
    custom; pending instead means no answer batch arrived before the timeout."
  - *The timed schema is identified by a single parameter.* `TIMED_WAIT_PARAMETER` (`timeout`)
    exists only in the timed schema, and its **presence in the logged request header** is how the
    projection later recognises a timed call — even when the call omits the argument
    (`projection.ts:126`).
  - *Question ids must be unique within one call* (`:19`), but two separate timed calls may reuse
    an id (the test at `tool-ask-user.spec.ts:585`).
  - *The two tool definitions deliberately duplicate their question schema* — and the duplication
    is marked with `/* jscpd:ignore-start */` (`:105`, `:203`) rather than abstracted, because
    "the timed schema intentionally shares question fields with the legacy tool" and the *model
    must see one self-contained schema*.
- **Edge cases & failure handling:** a timed call with no live agent throws
  ("timed questions require a live agent"); a live runtime-owned child is rejected upstream with
  `DELEGATED_CALLER`; the `timeout` is bounded to a positive integer ≤ 2 147 483 s or `-1`.
- **Surprising:** the timed tool's `description` is a *different, longer* prompt than the legacy
  one (`:27` vs `index.ts:31`) — the schema change came with a prompt rewrite, because the
  model-facing contract changed (pending vs skipped).

#### `packages/interaction/user-approval/src/index.ts`
- **Purpose:** the **approval seam** — a channel-neutral, one-shot, fail-closed permission
  decision for a sensitive tool action.
- **Key abstractions:** `ApprovalService` (`:150`, a Cordis `Service` at `ctx.approval`);
  `ApprovalPolicy = 'ask' | 'never'` (`:67`) and `APPROVAL_POLICIES` (`:70`); `setApprovalPolicy`
  (`:100`); `ApprovalRequest` (`:111`); `hasOpenTurn` (`:84`); `OUTCOMES` (`:55`); the two
  model-facing sentences `NEVER_SENTENCE` (`:73`) and `ASK_SENTENCE` (`:75`).
- **Data flow:** `request(req)` (`:215`) → **precondition**: the session must have an open turn
  (`hasOpenTurn`, `:84`) or the call throws *before anything is appended* → `approval/asked` is
  appended (`:229`) → `decide(req, session)` (`:267`) resolves the outcome → `approval/decided` is
  appended with the same `id` (`:233`) → the closed outcome is returned to the caller. The
  effective policy is the session's last `approval/policy` event, else the configured default
  (`:243`).
- **Non-obvious design decisions:**
  - *The audit pair must be turn-enclosed.* The error message says it outright: "a bare event
    between turns is crash-tail garbage on reload". The turn is the durable log's
    commit/replay boundary, so an approval decided outside a turn would be silently dropped on
    reload. This is the single most important idea in the shard for a trading app: **a
    consequential decision must live inside the same durable boundary as the work it gates.**
  - *Fail closed, always.* A missing answerer, a throwing answerer, and even a rogue
    non-vocabulary return all normalise to `'unavailable'` (`:279-286`). The service **never
    prompts a human itself** — it only dispatches to composed answerers.
  - *`never` is decided inside the service, before dispatch* (`:274-280`). The comment explains
    the exact reason: a listener registered with `prepend: true` *after* this service mounts
    would sit ahead of any gate *listener*, so "only the service's own request path can" honour
    the promise that `never` rejects deterministically regardless of registration order.
  - *A synchronously-throwing answerer is contained.* The waterfall is entered through
    `Promise.resolve().then(...)` (`:281-283`) so a listener that throws before its first
    `await` lands in the same rejection path as an async one — `Promise.resolve(call())` would let
    it escape.
  - *Abort races the answerer, and the late answer is discarded by construction* (`:288-307`):
    after an abort wins, the late `resolve(outcome)` is a settled-promise no-op.
  - *The policy travels to the model as a runtime-context contribution* (`:160-176`), positioned
    **after retained history** so a policy switch appends a new snapshot instead of rewriting the
    stable request prefix — the KV-cache-friendly choice, explicitly reasoned in the README.
  - *`setPolicy(agent, policy)` also queues a sourced user message* ("The approval policy
    changed from "ask" to "never" (changed by the user).", `:191-199`) so the model learns the
    switch in-band; the source is `{ kind: 'user-approval' }`, a distinct `MessageSourceMap`
    variant (`:13-17`) so the harness-authored message is never mistaken for the trader's words.
  - *The outcome vocabulary has no "allow always".* `allowed-once` is the only grant; there is no
    grant store, no remembered rule, no revocation. The README lists this as a known limitation
    and it is arguably a *feature* for a trading app.
  - *`setApprovalPolicy` validates before the log changes* (`:101-103`) — an invalid policy
    throws rather than appending garbage.
- **Edge cases & failure handling:** a failure that prevents *either* audit append from
  committing **rejects** rather than returning an unlogged decision (`:214-216`); but a
  *post-commit observer* failure is contained, so an authoritative append cannot suppress its
  matching audit event (`:120-165` of the test file pins both halves). An idle or between-turn
  caller throws before auditing anything.
- **Surprising:** `overrideOf` and `hasOpenTurn` walk the session log **backwards** with
  `session.eventAt(seq)` — the log is the only state, and the read is O(distance-to-answer) rather
  than O(1), which is fine for a fold that changes rarely.

#### `packages/interaction/user-approval/src/types.ts`
- **Purpose:** the wire-safe approval vocabulary — branded request id, closed outcome union, the
  two audit events, and the waterfall event declaration.
- **Key abstractions:** `ApprovalRequestId` (branded, `:18-26`); `ApprovalOutcome =
  'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'` (`:31`); `ApprovalRequestEvent`
  (`:60`); the `SessionEventMap` augmentation for `'approval/asked'` and `'approval/decided'`
  (`:34-58`); the `cordis` `Events` augmentation for the `'approval/request'` **waterfall**
  (`:68-79`).
- **Data flow:** type-only — declares the contract the service and the answerers both implement.
- **Non-obvious design decisions:**
  - *The audit events are explicitly "log-only (like `hook/*`; NOT a surface event, carries no
    `surfaceOp`)"* — they are audit, not UI, and the model never sees them.
  - *`displayReason` is presentation-only and "never persisted in approval audit events"* — a
    localised string never enters the durable record, while `reason` (the asker's own words)
    does. The separation of *what was said* from *how it was rendered* is deliberate.
  - *`id` pairs `approval/asked` with `approval/decided`*, and "exactly one per ask, appended
    when the outcome is known: a decision, a cancellation, or the fail-closed `'unavailable'`."
  - *The waterfall is scope-filtered*: "agent-scoped listeners receive only that agent", and
    `this: Scoped<Agent>` carries the scope into the listener.
- **Edge cases & failure handling:** the outcome union is closed, so a caller must handle
  `'unavailable'` — the README says "Callers fail closed on `unavailable`".
- **Surprising:** the request carries **no tool arguments** — an answerer sees the tool name, the
  reason and (sometimes) the call id, but not what the tool would do. The README flags this as a
  limitation ("the ACP machine channel requires a call id and delegates requests without one").

#### `packages/interaction/user-questions/src/index.ts`
- **Purpose:** the **user-questions seam** (`ctx.userQuestions`) — the capability that lets a
  running agent pause for a human and, optionally, let the model continue while the question
  stays answerable.
- **Key abstractions:** `UserQuestionService` (`:79`, a `TypertRemoteService`); `UserQuestionError`
  (`:46`, a `HarnessError` subclass with a stable `code`); `TimedUserQuestionResult` (`:43`);
  `ask(request)` (`:287`); `askTimed(request, callId, timeoutMs)` (`:234`); the `@Remote`
  `answer(agent, callId, answer)` (`:161`); the `@Remote({mode:'stream'})`
  `attachWait(agent, callId, signal)` (`:216`); `assertLiveRoot(agent)` (`:131`).
- **Data flow:** `ask()` (`:287`) → validates the signal, the non-empty batch, the live-root
  precondition and every question's `intent` → dispatches the `user-questions/request`
  **waterfall** (agent-scoped when an agent is supplied) with a `NO_PROVIDER` fallback →
  normalises a transported `UserQuestionError` back into the public class (`:65-73`).
  `askTimed()` (`:234`) creates a `TimedQuestionWait`, calls `ask()` with the wait's own signal
  and `wait: { callId, timed: true }`, and maps an `ASK_TIMED_OUT` to `{ pending: true, callId }`.
  A late answer arrives through `answer()` (`:161`), which steers a `user-question-reply` user
  message into the agent; the projection closes the question when that message is *admitted*.
- **Non-obvious design decisions:**
  - *The runtime-root rule.* `assertLiveRoot` (`:131`) authenticates the agent through the live
    `AgentRegistry` (`agents.get(agent.id) !== agent` → `CALLER_NOT_LIVE`) and then requires it to
    be a **root** (`agents.roots()` → `DELEGATED_CALLER`). The README gives the reason: "an owned
    child has no human answerer and would block forever". Crucially, *"runtime ownership, not
    durable session lineage, decides this boundary"* — a lineage-bearing session resumed as a new
    runtime root may ask normally (test at `user-questions.spec.ts:221`).
  - *The intent tag is validated at the asker, not in each UI* (`:305-323`). A `plan-review`
    intent asserts two things the type system cannot: that the named `approve` label is one of
    that question's own options, and that a plan-review carries the `detail` it reviews. Both
    would otherwise put "a choice the asker never offered — or an approval of something
    invisible" in front of the user. The error is `BAD_INTENT`.
  - *An intent changes presentation only.* A UI that does not know the tag renders the generic
    option list, and the answer encoding is identical either way.
  - *The queued-reply reservation is a small state machine.* `answer()` refuses a second reply
    with `REPLY_QUEUED`; the reservation is released when the message is **discarded**
    (`agent/inbox/discarded`), when the session records the `user/message`, or when the
    `turn/end` that claimed it passes (`:100-124`). A discarded reply therefore leaves the
    question **answerable** — the user can try again.
  - *The batch is validated by the only owner of the asked questions* (`:180-190`): one item per
    question, exactly once, else `BAD_ANSWER`. The comment says the gateway validated the *shape*
    from the type, but "the model-facing contract also promises one item per question, which only
    this owner of the asked questions can check".
  - *The late reply is a `user-question-reply` user message*, and the message itself is the
    record that closes the question in the projection. Its source carries
    `{ kind: 'user-question-reply', callId, outcome: 'answered' }` and a `@persistenceAttribution`
    tag — readers preserve it without the producer.
  - *No Remote method abandons a question.* "A Client that puts its panel away sends nothing, so
    the call stays answerable until an answer arrives."
  - *The service owns only the foreground wait; durable state lives in the projection.* The
    README's runtime invariant: "the `userQuestions` projection is derived from recorded tool
    calls, PTC dispatches, and admitted user messages; no separate question state is stored."
  - *The unattended timeout aborts only the foreground request signal and returns pending —
    "never aborting the Turn"* (README, Role section).
- **Edge cases & failure handling:** an already-aborted signal fails before the waterfall;
  in-flight cancellation is normalised to `ASK_ABORTED`; a *domain* rejection is preserved even
  when the provider also aborts the signal (test `:130`); a transported `UserQuestionError` is
  restored to the public class (`:65-73`); a provider rejection outside the taxonomy is
  preserved as-is; a non-positive or oversized wait is rejected with `BAD_TIMEOUT`; a duplicate
  wait for the same call is `DUPLICATE_WAIT`. On unload, every live wait is closed with
  `abortedQuestion()` (`:88-95`).
- **Surprising:** the projection recognises a timed call by the **logged request header's tool
  schema**, not by the call's arguments — because a timed call may omit its `timeout` argument.
  That is why `isTimedAskUserQuestionSchema` is exported from `projection.ts` and re-exported by
  the package root (`:37`).

#### `packages/interaction/user-questions/src/projection.ts`
- **Purpose:** the **pure fold** of `ask_user_question` tool events into the answerable-question
  set, plus the Session projection that exposes it to every client.
- **Key abstractions:** `UserQuestionFold` (`:17`); `applyUserQuestionEvent(fold, event)` (`:235`)
  — the one-event transition; `foldUserQuestions(events)` (`:311`); `questionsOf(argumentsText)`
  (`:137`); `isTimedAskUserQuestionSchema(tool)` (`:126`); `TIMED_WAIT_PARAMETER = 'timeout'`
  (`:36`); `ASK_USER_QUESTION_TOOL` (`:28`); `settleQuestion` (`:205`);
  `userQuestionProjectionDefinition` (`:316`, `stateVersion: 2`).
- **Data flow:** the fold consumes the **session log only** → a `request/header` event decides
  whether the calls that follow are timed (by inspecting the recorded tool schemas) → a
  `tool/call` for `ask_user_question` opens a question (`state: 'open'`) → a `tool/result`
  carrying the pending payload, or the synthetic `TOOL_OUTCOME_UNKNOWN` result written by resume
  repair, moves it to `state: 'continued'` → a `tool/result` carrying an answer batch **settles**
  it; any other result **drops** it → a `tool/ptc-dispatch` whose result is pending enters the
  fold as `continued` → a `user/message` whose source is `user-question-reply` settles it.
  The projection's `apply` skips events older than `inheritedEventCount` (`:322`).
- **Non-obvious design decisions:**
  - *No separate question state is stored.* The projection is a fold over the log — so it
    survives a restart for free, and a fork does not inherit a parent's questions (the
    `inheritedEventCount` guard, `:322`; the test at `projection.spec.ts:284`).
  - *Timed-ness is read from the request header, not the arguments* (`:243-251`). The comment:
    "The log records the exact schema list the model saw; a seeded or tool-less header carries
    none, which reads as the legacy tool." A call made under the blocking legacy schema is
    **never tracked** — "a Session that only ever used that tool folds to the empty view".
  - *A crashed call stays answerable.* The `TOOL_OUTCOME_UNKNOWN` branch (`:277`) means a call
    the process never finished becomes `continued` rather than vanishing — a crash cannot
    silently drop a question the user was asked.
  - *The `stateVersion: 2`* exists because "Changes to the projection fold require a
    `stateVersion` bump so stored caches refold from the log" (the tool-ask-user README's Dev
    Note). A fold change without the bump would serve a stale checkpoint.
  - *Unrelated events return the SAME reference* (`:307`) — the registry's change gate, so an
    unrelated event does not emit a change notification (the projection test at
    `permission-presets/tests/projection.spec.ts:67` pins the analogous behaviour).
  - *The wire view is the questions only* — `wire: { viewSchema: projectionViewSchema, view:
    state => state.questions }` (`:327`).
- **Edge cases & failure handling:** malformed model arguments never reached the tool, so
  `questionsOf` returns `null` and the call is not tracked (`:145-150`); a non-JSON result text
  is a failure message, never the pending payload (`:168-178`); a result with no text at all
  closes the tracked call (test `:249`); a late reply that carries no usable batch settles the
  question with **no** answers (`:195`).
- **Surprising:** the fold reads the *tool schema* from the request header to decide timed-ness,
  which means a session that changes its composed tool mid-run is handled by "follows the latest
  header when the composed tool changes mid-Session" (test `:113`) — the fold is not a one-time
  decision.

#### `packages/interaction/user-questions/src/timed-wait.ts`
- **Purpose:** the *foreground wait* object — one live timed question, its cancellable client
  claims, and its unattended timer.
- **Key abstractions:** `TimedQuestionWait` (`:5`) with `deadline`, `parent` (the turn's
  cancellation signal) and `timeout` (the business error); `signal` (`:23`); `done` (`:26`);
  `attach(signal)` (`:43`, an async generator); `close(reason)` (`:73`); `schedule()` (`:34`).
- **Data flow:** the constructor arms a timer for `deadline - Date.now()` **only while no client
  holds the wait** (`:34-39`) → `attach(signal)` registers a claim, yields one
  `{ remainingMs }` frame computed by the **Host**, and holds until the stream closes or the
  question settles → releasing the last claim re-arms the timer (`:52-59`).
- **Non-obvious design decisions:**
  - *The Host computes the remaining duration; the Client counts down on its own clock.* The
    README: "An answer UI claims that wait through `attachWait`, receives the Host-computed
    remaining duration, and counts down on its own clock."
  - *A claimed wait is NOT bound by the Host deadline.* `schedule()` returns early while
    `claims.size > 0` (`:37`) — a connected UI keeps the question open past the Host's deadline;
    when the last claim leaves, the timer is re-armed for the remaining time and the wait then
    expires (test `timed-wait.spec.ts:29`).
  - *The wait's own signal is separate from the turn's.* "Cancellation shared with the
    foreground waterfall, not with the calling Turn" (`:23`) — an unattended timeout must not
    abort the whole turn.
  - *`close()` is idempotent* (`:74`) and always releases the timer, the parent listener and
    every claim.
  - *A cancelled or already-expired wait cannot be claimed* (`:45-49`).
- **Edge cases & failure handling:** the parent signal aborting ends the claim streams "without
  expiring the parent itself" (test `:74`); a wait with no answer UI expires and releases its
  timer (test `:19`).
- **Surprising:** `Promise.withResolvers` is used for the completion promise — a modern
  primitive that removes the classic "resolve captured outside the executor" pattern.

#### `packages/interaction/user-questions/src/types.ts`
- **Purpose:** the client-safe question/answer/event vocabulary.
- **Key abstractions:** `AskUserQuestionOption`; `AskUserQuestionIntent` (the single tag
  `plan-review` with `approve`, `detail` and `callId`); `AskUserQuestionItem`; `AskUserQuestionAnswerItem`;
  `AskUserQuestionAnswer`; `UserQuestionState = 'open' | 'continued'`; `PendingUserQuestion`;
  `SettledUserQuestion`; `UserQuestionProjectionView` (`active` + `settled`); the
  `MessageSourceMap` augmentation for `'user-question-reply'`; the `SessionProjectionMap`
  augmentation for `userQuestions`; the `'user-questions/request'` waterfall declaration.
- **Data flow:** type-only — the wire contract for both the service and the clients.
- **Non-obvious design decisions:**
  - *`approve` is a LABEL, not a position.* "Named rather than positional so no UI infers the
    verdict from option order" — and an `approve` naming no option of its own question is
    rejected at `ask()`.
  - *`detail` is separate from `question`.* "Optional supporting detail rendered with the
    question but kept out of option labels" — this is the plan-under-review payload, and it is
    why a `plan-review` intent can require it.
  - *`SettledUserQuestion` remembers the answers, not just that it settled.* A transcript row
    reads "what the user finally answered" from the projection, because the original tool result
    recorded the *timeout*, not the answer.
  - *`user-question-reply` carries `@persistenceAttribution`* — "Readers preserve this message
    without the producer; only the `userQuestions` projection reads the kind to close the
    question and record its answers." That is the same discipline as August Trading's
    `harnessTurn()`: a harness-authored message must survive a producer-free restore.
- **Edge cases & failure handling:** the `wait` field carries `callId` and a `timed` flag; a
  `timed: true` wait "requires a Client claim", while an absent flag marks an indefinite wait.
- **Surprising:** the vocabulary is deliberately *only* "selectable options plus optional custom
  text" — the README lists richer shapes (file pickers, diff-preview confirmations) as not yet
  having a seam vocabulary.

#### `packages/plan/plan-mode/src/index.ts`
- **Purpose:** **plan mode** — a per-agent collaborative state in which the agent explores and
  designs before executing, and must present a written plan for the user's review.
- **Key abstractions:** `PlanModeController` (`:175`, a Cordis `Service` at `ctx.planMode`,
  `inject = ['tools','systemPrompt','sessionProjections']`); `EXIT_PLAN_MODE = 'exit_plan_mode'`
  (`:66`); `PlanModeConfig` (`:69`); `resolveConfig` (`:104`); `planProjectionDefinition` (`:136`,
  `stateVersion: 3`); `firstHeading` (`:89`); the review constants `REVIEW_ID = 'plan-review'`,
  `APPROVE_LABEL = 'Approve'`, `KEEP_PLANNING_LABEL = 'Keep planning'` (`:75-81`).
- **Data flow:** `/plan` (the command, registered only when a commands service is composed) →
  `set(agent, active)` (`:409`) → if a turn is open the selection becomes **pending** in a
  `WeakMap<Session, {active, narrate}>` (`:186`) and is appended by the `agent/pre-step` listener
  as `plan/mode { active }` **only when the step is accepted** (`:196-215`); if no turn is open the
  event is appended immediately (`:432`) → the `plan:policy` prompt section reads the pending intent
  first, then the logged state (`:223-231`) → the `plan` projection folds `command/run` +
  `command/done` + `plan/mode` + `request/header` into `{ active, pending }` (`:139-172`).
- **Non-obvious design decisions:**
  - *One log-only whole-value event, never a live mirror.* "The durable stance is one log-only
    whole-value-replace event, never a live mirror, so resume, fork, and compaction recover it by
    folding the log." The projection test proves it: a *cold* registry over the same log refolds
    `{active:false, pending:true}` with no service memory involved.
  - *The append happens at a step boundary, not at the moment of selection.* A mode change during
    an open turn "stays pending until the next accepted in-turn pre-step — the only append point
    while an agent runs". The pre-step listener is registered on `agent/pre-step` *after* calling
    `next()` (`:198-200`), so it appends only for an **accepted** step; a rejected step or an
    aborted signal leaves the intent pending.
  - *An append failure can never block the turn.* The `try/catch` around `onBoundary` logs a
    warning and returns the decision unchanged (`:207-212`); the pending intent is **not** deleted,
    so a later accepted pre-step can retry the durable write.
  - *Delete only after the append succeeds* (`:449-458`) — the comment says it outright: "Delete
    only after append succeeds so a failed durable write leaves the selection retryable, not
    dropped." This is a *durability-before-memory* ordering rule.
  - *The exit tool stays registered while plan mode is inactive* (`:66`, `:279`). "Entering or
    leaving plan mode changes only the prompt section, never the request tool catalog" — the tool
    schemas are byte-identical across the transition, so the KV cache prefix survives.
  - *Plan mode is guidance, not enforcement.* "The package registers one prompt section and one
    tool, and restrains through text rather than filtering capabilities." The test at
    `plan-mode.spec.ts:581` states it flatly: "runs every call in plan mode untouched — guidance
    and enforcement are separate axes."
  - *The plan must start with a markdown heading* (`:296`): `/^#\s+\S/` — a cheap sanity check
    that the "plan" is actually a plan, checked *before* the reviewer is asked.
  - *Consent is exact.* The tool requires **exactly one** answer item with **exactly one**
    selected label equal to `Approve` and **no** `custom` text (`:344-350`): "a custom-text-only
    answer is feedback, never consent", "custom text alongside Approve is feedback, not consent",
    "duplicate review answer items are non-consent", "a missing answer item reads as
    keep-planning". Every non-consent path becomes a **failed tool call carrying the feedback
    verbatim** so the model can revise.
  - *A dismissed review is not a failed one* (`:320-327`): `ASK_CANCELLED` calls
    `exec.concludeTurn()` and returns `{ approved: false }` — "the user took the turn back to say
    something the two options do not cover, so the turn ends here instead of spending a model
    request on waiting."
  - *The review uses the `plan-review` presentation intent* (`:313-318`) — the *seam's* intent
    vocabulary, carrying the originating `callId` so the client can reopen the same plan after the
    review closes.
  - *The plan body is carried in `detail`, not in the question text* (`:303`) — the question stays
    "Approve this plan and leave plan mode?" and the plan is the supporting detail. This is what
    lets a generic UI render the same request without a special case.
  - *The plan stays in the log, not in the projection.* "The complete Markdown remains in the
    existing native call or PTC dispatch log."
  - *Narration is conditional on what the model was last told.* `narration()` (`:463`) compares
    the target with `activeAtLastHeader` — the mode the last request header described. If the
    header already said plan mode, no notice is emitted ("the section is the state statement");
    the notice only appears when the model would otherwise be confused. The narration's source is
    `{ kind: 'plan-mode', form: 'notice', summary: text }` — a harness-authored message, distinct
    from the trader's words.
  - *The narration is never added for the exit tool* (`narrate: false`, `:342`) because "the tool
    result is the narration".
  - *An approved exit is a **silent** pending selection* (`:342`) that "keeps plan guidance for
    the rest of the current assistant tool batch" — the switch is appended at the next accepted
    in-turn pre-step, before the next request assembly.
  - *A reload during a pending review fails closed* (`:330-333`): "the plan-mode service was
    reloaded while the plan was under review; present the plan again" — no phantom exit.
  - *The `never` case is explicit.* Without a `userQuestions` channel the tool fails with a
    consumer-neutral message pointing at `/plan off` as the manual escape (`:299-301`).
  - *The config is validated fail-loud at load* (`:104-115`): a missing, blank, non-string or
    **unknown** `section` key throws — "config is { section }".
- **Edge cases & failure handling:** a no-op `set` (target equals the pending or logged state)
  returns `'noop'`; a between-turns reversal of a mid-turn pending intent returns `'cancelled'`
  **without logging**; a flip sequence that returns to the folded mode nets out with no append and
  no notice. `set()` returns one of four explicit outcomes — `committed` / `queued` / `cancelled`
  / `noop` — so the command handler can narrate accurately instead of guessing.
- **Surprising:** `hasOpenTurn` (`:379`) does not scan the log; it reads the `turnBoundary`
  session projection, and **fails explicitly** if that key is absent. The comment on `set()`
  explains why the open-turn fold is the right signal: "agent status stays `running` through
  post-turn checkpointing, when no further in-turn pre-step runs."

#### `packages/plan/plan-mode/src/types.ts`
- **Purpose:** the ONE home of the `plan` projection-key declaration, free of host-side value
  imports.
- **Key abstractions:** `PlanProjection` (`:19`, `{ active, pending }`); `PlanUnitState` (`:26`,
  the host fold state: `active`, `wanted`, `running`, `activeAtLastHeader`); the
  `SessionProjectionStateMap` / `SessionProjectionMap` augmentations.
- **Data flow:** type-only — the fold state and the wire value.
- **Non-obvious design decisions:** the doc comment defines `pending` precisely: "true while a
  logged `/plan` selection targets a state other than `active`, has not failed through its paired
  `command/done`, and no later `plan/mode` event has recorded that state. Capability absence
  (plan-mode not composed) is the key's absence, never a value." — i.e. *no capability* is
  modelled as *absent key*, never as a "disabled" value.
- **Edge cases & failure handling:** n/a (types only).
- **Surprising:** the state tracks `activeAtLastHeader` — the mode the *model* was last told about
  — which is a different fact from `active` (the mode in force). Two sources of truth that must
  not be confused.

#### `packages/plan/plan-mode/src/client.ts`
- **Purpose:** the client-namespace re-export of `./types.ts` — the same "one source, two
  audiences" trick as `permission-presets/src/client.ts`.
- **Key abstractions:** none of its own.
- **Data flow:** `export type * from './types.ts'`.
- **Non-obvious design decisions:** it exists to satisfy the repo discipline "client code imports
  ONLY the client namespace", with **zero content duplication**.
- **Edge cases & failure handling:** n/a.
- **Surprising:** 373 bytes, two sibling packages with the identical pattern — the pattern is
  itself the finding: the reference has a *convention* for serving the same types to a browser
  bundle without loading the host's `Context` augmentation.

#### `packages/preset/agent-preset-registry/src/index.ts`
- **Purpose:** the registry of **declarative agent presets** — named compositions of tools, prompt
  sections and skills, each mounted as its own isolated plugin tree and shared by every agent that
  selects it.
- **Key abstractions:** `AgentPresetRegistry` (`:52`, a `TypertRemoteService` at `ctx.agentPresets`,
  `inject = ['loader','sessionProjections']`); `Definition` (`:38`) and `Generation` (`:31`) and
  `Binding` (`:46`) — the three internal records; `register` (`:81`); `activate` (`:103`);
  `diagnostic` (`:135`); `retain` (`:232`); `bind` (`:250`); `join` (`:265`); `mount` (`:281`);
  `composeFrom` (`:295`); `select` (`:349`); `recompose` (`:334`); `compositionInventory` (`:388`);
  `inspectCompositions` (`:161`); `readDocument` (`:217`); `acquireScope` (`:373`).
- **Data flow:** a declaring plugin calls `register(definition)` (`:81`) → the registry creates a
  **registry-owned scope** and an in-memory Loader tree (`mountPreset`) → the definition's
  activation is *awaited*, and a failure is recorded as `record.broken` and logged rather than
  thrown → `list()` (`:177`) reports every declaration **including the broken ones** → an agent
  binds by `mount(ctx, id)` (`:281`) which retains the generation, joins the agent's scope to the
  generation's scope (`bindScopeParent`) and then releases the temporary retain → the session's
  current preset is a *projection* over the log (`agent-preset/selected`).
- **Non-obvious design decisions:**
  - *A failed preset stays visible.* "Failed definitions remain visible, while existing Agents
    retain the composition they already use." A broken definition appears in the roster with its
    diagnostic rather than disappearing — the user can see *why* their preset did not load.
  - *Revisions are retained, not replaced.* Updating a declaration "retires its previous revision.
    Agents, children and temporary historical reads retain references; releasing the final
    reference disposes the retired tree." The `users` counter on `Generation` (`:35`) plus
    `collect()` (`:148`) implement reference counting — a live agent keeps the OLD revision alive
    even after the definition is replaced.
  - *Startup order must not decide the outcome.* `diagnostic()` (`:135`) re-audits a mounted tree
    on **every read**: "a row waiting for a Host service activates by itself once that provider
    finishes, so the audit waits for the Host Loader tree to settle before reporting the row as
    unusable." A row that is merely *pending* is distinguished from one that *failed*.
  - *A pending row keeps the definition mounted but blocks new bindings* (`:242-247`).
  - *A selection is locked once the session's conversation has started.* `select` (`:349`) reads
    the `turnBoundary` projection and throws `agent-preset/locked` if a turn is open **or** one
    has already run. The composition of a session that has spoken is fixed.
  - *Selections are serialized per agent* by a promise chain (`switches`, `:62`, `:350-371`). The
    chain is stored as a *guarded* promise (`turn.catch(() => undefined)`) so a failed selection
    does not poison the queue — "recovers after a failed selection" is a pinned test.
  - *A selection that changes nothing logs nothing.* "A Session whose log records the preset and
    whose Agent runs its current revision keeps its composition; nothing is logged or announced"
    (`:346-350`) — and the durable record exists because of the repo's "model-visible ⟺ logged"
    rule (see `session.ts`).
  - *The registry writes no declarations.* `readDocument` (`:217`) renders one declaration back
    as entry-list YAML with `!!js` conditions intact ("nothing accepts YAML back") — a **read-only**
    view surface.
  - *A preset service provider must be isolated.* `mountPreset` (in `mount.ts`) **rejects** a
    mount whose subtree published a service into the root realm: "Preset services require isolate
    realms". This is an architectural invariant enforced at mount time, not a convention.
  - *The registry keeps itself off the generated Settings pages* (`:65`) — `settings.configure({
    auto: false })`.
  - *The `read`/`list`/`select` surfaces are `@Remote`*, so a Web client reads the roster and
    selects a preset without the Host's Context merges.
- **Edge cases & failure handling:** a duplicate preset id throws at registration **without
  disposing the first definition** (pinned test). A definition removed while an acquisition is in
  flight does not bind. Disposal is idempotent. A `tools/change` observer that throws is logged
  and does not lose the durable selection. A definition whose child list is malformed fails at the
  **declaring plugin** and keeps its diagnostic.
- **Surprising:** the registry keeps TWO concepts that look like one: `Generation` (the mounted
  tree, reference-counted) and `Definition` (the declaration, keyed by preset id). Replacing a
  declaration creates a new `Generation` under the same id — "different retained revisions can
  share it" (`AgentPresetInspection.id`).

#### `packages/preset/agent-preset-registry/src/mount.ts`
- **Purpose:** the **scoped plugin tree** that a preset's children are mounted into, plus the
  activation audit that decides whether that composition is usable.
- **Key abstractions:** `PresetTree extends EntryTree` (`:9`) — an in-memory tree whose `write()`
  is a **no-op** (`:23`); `PresetMount` (`:27`); `auditRows(tree)` (`:134`); `leakedServices(ctx,
  mount)` (`:69`); `serviceForMount(ctx, mount, name)` (`:98`); `withinFiber` (`:48`);
  `mountPreset(ctx, id, plugins)` (`:204`).
- **Data flow:** `mountPreset` (`:204`) requires a scope → awaits the owning fiber → creates a
  `PresetTree` → `tree.root.update(prepareProfileEntries(...))` → `auditRows` reports `failed` and
  `pending` → `leakedServices` reports services published into the **root** realm → a failure or a
  leak **throws**, and a successful mount returns a `PresetMount` whose scope disposal owns the
  teardown.
- **Non-obvious design decisions:**
  - *The preset tree never writes to disk.* `PresetTree.write()` is overridden to do nothing
    (`:23`): "only the profile configuration editor persists definitions." The `self-dispose.js`
    fixture documents the bug this prevents: "The Loader treats a self-disposing entry as a config
    change and writes the tree back through `EntryTree.write()`, which is the exact path that once
    truncated a preset file to `[]`." A **no-op write** is a bug fix expressed as an override.
  - *The tree does not replace the declaring Loader entry's subtree.* The `PresetTree` constructor
    (`:9-25`) saves and restores the owner's `subtree`/`subgroup` — a mount must not re-parent the
    entry that declared it.
  - *Service isolation is checked by symbol identity.* `leakedServices` (`:69`) walks the store's
    own symbols: "A provider without an `isolate` realm stores its implementation under the root's
    symbol for that name, which is exactly the comparison below; a provider inside an `isolate`
    realm stores under a realm-private symbol and is correctly absent here." A *leak* is a mount
    defect, and it **rejects the mount**.
  - *Membership is object identity, not `uid`.* `withinFiber` (`:48`) explains why: "`uid` looks
    like a cheaper key but is a per-registry counter, so fibers in two different roots collide on
    it and a subtree in one runtime would be blamed for a service published in another."
  - *A row waiting for a service is PENDING, not FAILED.* `auditRows` (`:134`) separates
    "never started"/rejected (failed) from "waiting for a Host service" (pending) — and the
    registry re-audits after the Host tree settles, so startup order does not decide the outcome.
  - *A profile may deny a plugin.* Inside a profile, "compatibility policy decides admission
    first: a row whose plugin the profile denies mounts disabled, so the audit reads it as
    intentionally inactive instead of reporting a failed import" (`:196-201`).
  - *Aggregate failures are flattened for the reader.* `mountDetail` (`:181`) and
    `detailBranches` (`:168`) render an `AggregateError`'s member messages (and a nested
    aggregate) beneath the row diagnostic, so each failure is visible.
- **Edge cases & failure handling:** `mountPreset` on an unscoped context throws "requires a
  scope". A string rejection (`throw 'string rejection'`) is rendered as-is. A row whose plugin
  never started is reported. The audit awaits the tree before reading it.
- **Surprising:** `serviceForMount` (`:98`) is the *inverse* of `leakedServices`: it finds the one
  service a subtree published **anywhere**, including inside an isolated realm — the only
  supported way to reach a preset's own services.

#### `packages/preset/agent-preset-registry/src/definition.ts`
- **Purpose:** the declarative preset shape and the **entry-list validator** for a parsed Cordis
  child list.
- **Key abstractions:** `PresetDefinition` (`:6`); `entryListProblem(rows, at = '')` (`:18`).
- **Data flow:** a parsed YAML list → `entryListProblem` walks it → the **first** invalid row is
  returned as a human-readable string, or `undefined` when the list is well-formed.
- **Non-obvious design decisions:**
  - *The validator recurses into groups.* A `group: true` row's `config` is itself an entry list,
    so the same function validates it with a labelled prefix (`:31-34`).
  - *The messages are diagnostic, not thrown.* They read like a person wrote them: "row 3 names
    no plugin (a "name" string is required)", "group row 2 row 1 is not a plugin row (expected a
    map with a "name")".
  - *A group needs no `name` of its own* — only its children do.
- **Edge cases & failure handling:** a non-array at the top level is "the composition must be a
  top-level list of plugin rows"; a nested non-array is "group … must hold a list of plugin rows".
- **Surprising:** the schema of each *individual* plugin is **not** validated here — "Cordis owns
  individual plugin schemas; the registry validates entry structure" (see `agent-preset/src/index.ts`).

#### `packages/preset/agent-preset-registry/src/preset.ts`
- **Purpose:** the public roster row and the registry's selection policy.
- **Key abstractions:** `AgentPreset` (`:4`, with the `broken` field); `Config` (`:12`) with
  `default: string` and `selectedDefault: Volatile<string | undefined>`.
- **Data flow:** type-only; `Config` is the plugin's own configuration, consumed by
  `AgentPresetRegistry.Config` (which mirrors it in schemastery).
- **Non-obvious design decisions:** `selectedDefault` is **volatile** — re-read on every access, so
  a Settings change moves the default for future sessions without a remount. The deployment
  `default` is the fallback.
- **Edge cases & failure handling:** n/a (types only).
- **Surprising:** `AgentPreset.broken` is part of the *roster row*, so a broken preset is a
  first-class citizen of the list rather than an error channel.

#### `packages/preset/agent-preset-registry/src/session.ts`
- **Purpose:** the session-log record of **which preset a session actually runs** — a projection
  over the log.
- **Key abstractions:** the `'agent-preset/selected'` session event (`:21`); the
  `agentPresetProjectionDefinition` (`:35`, `stateVersion: 1`).
- **Data flow:** the session **header** names the preset the session started with (a creation
  fact, deep-frozen) → the projection's `init` reads it (`:37`) → a later
  `agent-preset/selected` event advances it (`:38-39`) → the wire view is the current preset id
  or `null`.
- **Non-obvious design decisions:**
  - *The header is a creation fact; the log is the truth.* "The creation header names the preset a
    session STARTED with, and it is deep-frozen because that is a creation fact. A session may
    still change preset while it is blank, and the effect of that change outlives the blank
    window: the first turn — and every turn after it — runs under the newly mounted composition."
  - *Recording the change is required by a repo-wide rule.* "Recording the change is what keeps
    the log honest, and it is required outright by the repo's model-visible ⟺ logged rule, since
    the preset decides the tool schemas and prompt sections the model sees." **This is the single
    most transferable idea in the preset group**: if a thing changes what the model sees, it must
    be in the log.
  - *A child session's early selection means an independent spawn.* "In a child Session, an
    occurrence before its first own `subagent/descriptor` marks an independent spawn selection
    that cold resume restores instead of joining the parent's composition."
  - *Reconstruction reads the projection, never the header alone.*
- **Edge cases & failure handling:** a session with no configured preset folds to `null`; the
  projection is the only place that is decided.
- **Surprising:** the same word "blank" is used for two different things — a *blank session* (no
  turn yet) and a *blank composition* — and the distinction is what makes "select a preset before
  the first turn" safe.

#### `packages/preset/agent-preset-registry/src/types.ts`
- **Purpose:** the client-safe payload and event vocabulary of the preset domain.
- **Key abstractions:** `AgentPresetRow` (`:8`, with `isDefault` and `broken`); `AgentPresetRoster`
  (`:21`); `AgentPresetDocument` (`:27`); the `RemoteErrorDetailsMap` augmentation declaring
  `'agent-preset/not-found'`, `'agent-preset/invalid'` and `'agent-preset/locked'` (`:37-47`); the
  `SessionProjectionMap` augmentation for `agentPreset` (`:49`); the `cordis` `Events` augmentation
  for `'agent-preset/selected'` (`:57`).
- **Data flow:** type-only.
- **Non-obvious design decisions:**
  - *The error taxonomy is part of the wire.* Three named remote errors with structured details
    (`available` on not-found, `reason` on invalid, `sessionId` on locked) — a client can render
    "this session has already started" without parsing prose.
  - *The roster includes failures.* "Every current declaration, **including activation
    failures**."
  - *The event carries both the session and the preset*, and the doc says consumers must
    "invalidate only state derived from that session's composition" — a narrowly-scoped
    invalidation instruction.
- **Edge cases & failure handling:** n/a (types only).
- **Surprising:** `AgentPresetDocument.content` is *YAML with `!!js` expressions included* — the
  document is a faithful rendering of the declaration, not a normalized model.

#### `packages/preset/agent-preset-registry/src/display.ts`
- **Purpose:** display-copy resolution for roster presets, shared by every surface that renders
  preset names.
- **Key abstractions:** `BuiltInPresetCopyKey` (`:12`); `PresetDisplaySource` (`:19`);
  `PresetDisplayText` (`:26`); `BUILT_IN_PRESET_KEYS` (`:35`); `isBuiltInPreset` (`:51`);
  `presetDisplayText(preset, t)` (`:63`).
- **Data flow:** a roster row → `isBuiltInPreset` (a shipped id **and** no published `name`) →
  the dictionary keys → `t(key)`; otherwise the declaration's own metadata.
- **Non-obvious design decisions:**
  - *User-authored metadata is never translated.* "Shipped presets resolve through locale
    dictionary keys, and user-authored metadata is never translated." A user's preset name stays
    exactly as written.
  - *The test is "no published name", not "known id".* A shipped preset publishes **no** `name`;
    a declaration that names itself owns its copy — so a user who overrides a shipped id still
    gets their own text.
  - *It is a pure fold with no imports*, "so browser bundles inline it and the Host uses the same
    single home for which shipped id carries which copy key."
- **Edge cases & failure handling:** a preset with no name and no description falls back to its
  **id** as the label.
- **Surprising:** the file is a separate *entry point* (`./display`) precisely so a browser bundle
  can inline it without pulling the registry.

#### `packages/preset/agent-preset-registry/src/composition-inventory.ts`
- **Purpose:** a read-only **inventory** of a composition — the plugin rows a preset names and
  whether each is enabled — computable *before* a successful activation.
- **Key abstractions:** `CompositionRowEnablement = boolean | 'conditional'` (`:7`);
  `DisabledExpressionEvaluator` (`:14`); `AgentPresetCompositionRow` (`:19`);
  `AgentPresetComposition` (`:37`); `AgentPresetInspection` (`:55`);
  `activeCompositionModules(tree)` (`:66`); `definitionComposition(rows, evaluateExpression)`
  (`:171`); `mountedCompositionRows(tree)` (`:186`); `disabledContribution` (`:101`);
  `combineDisabled` (`:120`); `flattenRows` (`:143`).
- **Data flow:** a parsed declaration → `definitionComposition` flattens the rows (groups are
  structural; only their children are emitted) and evaluates each `disabled` expression → the row
  list is `enabled: true | false | 'conditional'`. A live mount → `mountedCompositionRows` reads
  the Loader's own evaluated state, including the root-fiber state.
- **Non-obvious design decisions:**
  - *'conditional' is a first-class answer.* "Throwing refuses the answer: the row is reported
    `'conditional'` rather than guessed." A `!!js` expression that cannot be evaluated outside a
    mount is **not** silently treated as enabled or disabled.
  - *Ancestor group state is combined the way the Loader combines it.* `combineDisabled` (`:120`):
    any literal `true` disables; otherwise any conditional leaves the decision to a mount.
  - *Groups are structural.* `flattenRows` (`:143`) recurses into a group's `config` and emits only
    the children — "the Loader reports a group entry as always enabled and lets children inherit
    its `disabled`".
  - *Two ways to read the same composition.* `definitionComposition` (from the declaration, before
    activation) and `mountedCompositionRows` (from the live tree, with the Loader's evaluated
    state). The registry picks one depending on whether the definition mounted.
- **Edge cases & failure handling:** a malformed row list yields `{ broken }` instead of rows. A
  `!!js` expression that throws yields `'conditional'`, not a crash.
- **Surprising:** `AgentPresetInspection` deliberately contains **no Loader trees or fibers** —
  only detached module references and leaked service names — "Inspectors query the runtime service
  rather than a module-local mount table."

#### `packages/preset/agent-preset/src/index.ts`
- **Purpose:** the **declarative row** that lets a Cordis YAML file define one preset.
- **Key abstractions:** `Config = PresetDefinition` (`:10`); the default-exported `AgentPreset`
  service class (`:14`).
- **Data flow:** Cordis activates the row → `Service.init` yields `ctx.agentPresets.register(this.config)`
  (`:24-26`) → the registry owns the revision; the row's disposer is the registry's unregister.
- **Non-obvious design decisions:**
  - *`EntryGroup.key` is set to `true`* (`:17`) — "Preserve child expressions until their own
    plugins activate." Without it, the `!!js` conditions inside a preset's child list would be
    evaluated before the children they depend on exist.
  - *The child list's schema is `z.array(z.any())`* (`:22`) with the comment: "Cordis owns
    individual plugin schemas; the registry validates entry structure." Each child plugin validates
    **its own** config; the preset only validates the *shape* of the list.
  - *The row does not own agents.* "Registers child plugin configuration without owning Agents
    using older revisions" — the registry's reference counting does that.
- **Edge cases & failure handling:** a duplicate preset id fails the declaration's load.
- **Surprising:** the whole package is 30 lines; all the behaviour lives in the registry.

#### `packages/preset/persona/src/index.ts`
- **Purpose:** a **per-agent persona** as a composable row — the piece of an agent's *identity*
  that a preset can change (a preset could otherwise change only its tools).
- **Key abstractions:** `Config` (`:33`); the schema (`:52`); `apply(ctx, config)` (`:66`);
  `PERSONA_PREFIX_SECTION` / `PERSONA_SUFFIX_SECTION` re-exported from `dsh-system-prompt` (`:23`).
- **Data flow:** the row registers two **scoped** prompt sections — the prefix at
  `DEPLOYMENT_PERSONA_PREFIX` order and the suffix at `DEPLOYMENT_PERSONA_SUFFIX` order — each
  **shadowing** its deployment-wide default rather than sitting beside it; with
  `includeRuntimeContext: false` it also calls `ctx.systemPrompt.suppressRuntimeContext()` (`:78`).
- **Non-obvious design decisions:**
  - *It is scope-only, and that is the point.* "`dsh-system-prompt` owns the global persona as its
    own config, and registers that section unconditionally — so this row is **scope-only**.
    Mounted inside an agent preset it shadows the deployment persona for that one session; mounted
    globally it collides with the registry's own registration and fails loud." The constraint
    *is* the feature: "a preset cannot mount the prompt registry itself, so without a row of its
    own a preset could change an agent's tools but never its identity."
  - *An empty prefix still shadows the default away.* The section is *occupied*, so the deployment
    persona is gone for that agent; the empty text is dropped at render. The persona test pins
    both halves.
  - *Templating is strict and resolves at RENDER time, not assembly time.* "complete `{{…}}` groups
    resolve strictly against registered prompt variables when the prompt renders, not when it
    assembles" — so one assembly can be rendered for two different sessions.
  - *`complete: true` makes the prefix the whole system prompt.* "assembly still resolves
    contexts, tools, variables, and cooperative listeners, but the prompt registry restores this
    exact prefix as the sole section; no identity, suffix, tool guidance, or listener can append
    prompt text" — and the test proves a *prepended* assemble listener cannot add a section.
  - *`includeRuntimeContext: false` suppresses only OPTIONAL context.* "optional context providers
    are not evaluated for this scope, and assembly-listener contributions are discarded unless
    registered as required. Required providers remain active at assembly and request admission."
  - *Disposal restores the deployment default* — the shadow is an effect of the mounting context.
- **Edge cases & failure handling:** an unscoped mount throws `"deployment:persona-prefix" is
  already registered` (the test pins the exact message). Two scopes get two independent personas.
  A `{{unknown}}` variable in a complete persona is dropped, because the complete mode is exact.
- **Surprising:** the persona's suffix is at order `10200` — "after first-party guidance" — while
  the prefix is at order `0`. The *identity* frames the instructions, and the workspace/suffix
  closes them.


### Tier 2 — bulk: a compact table, one row per file

**`guard/` group**

| File | What it is / what it pins |
| --- | --- |
| `packages/guard/README.md` | Package-group map: two loop-hygiene guards (`repeat-tool-reminder` = advisory nudge on identical repeats, `timeout-policy` = per-tool-call deadline); both shipped enabled in the `dsh` base bundle; links the tools-subsystem reference and the timeout-deadline Agent Note. |
| `packages/guard/README.zh.md` | Chinese translation of the above; read as head + heading index — same sections (概述 / 目录 / 包 / 相关文档 / 开发备注), same decisions. |
| `packages/guard/repeat-tool-reminder/README.md` | The full behavioural contract: `thresholds` (default `[3,5,8]`), `include`/`exclude` wildcard scope, `argumentsPreviewChars` (500); four design commitments (advisory-not-veto, count-in-post-execute, exact-match canonicalization, fail-loud-at-load); the chain semantics (untracked calls transparent, denied calls counted, per-agent keying, user-prompt reset, in-memory only); the exact model-facing reminder texts; KV-cache/token effects; and a "Known Limitations" list (exact-match only, compaction does not reset chains, no subagent chain sharing, legitimate idempotent polling still draws nudges, silence past the highest threshold). |
| `packages/guard/repeat-tool-reminder/README.zh.md` | Chinese translation; head + heading index confirms identical section structure (设计理念 / 检测：重复链 / 提醒传递 / 源码地图 / 已知限制与延期工作). |
| `packages/guard/repeat-tool-reminder/locale/en.json` | Two-key locale stub: `meta.title = "repeat-tool-reminder"`. |
| `packages/guard/repeat-tool-reminder/locale/zh.json` | Same stub in Chinese plus a `meta.description`. |
| `packages/guard/repeat-tool-reminder/package.json` | Publishes `@deepseek-ai/dsh-repeat-tool-reminder@0.2.1-rc.2`; one runtime dep (`schemastery`), three peer deps (`dsh-agent`, `dsh-tools`, `cordis`); devDeps pull in `dsh-agent-loop-testkit` and `dsh-session-projection` — i.e. the test strategy is a *real agent loop against a mock adapter*. |
| `packages/guard/repeat-tool-reminder/tsconfig.json` | Project references only; `rootDir: src`, `outDir: lib/types`; references vendor `cosmokit`/`cordis`/`schemastery` plus `core/tools`, `core/agent`, `llm/llm`. |
| `packages/guard/timeout-policy/README.md` | The timeout contract: no configuration; the budget comes from each tool's own `timeoutMs` (`dsh-tool-web` ships `fetchTimeoutMs`/`searchTimeoutMs` = 30 000 ms; `bash`/`read`/`write`/`edit` declare none and are never cut off); the model sees `Error: tool call timed out after <ms>ms`; the four commitments (enforcement-home-not-library, tool-declares-its-own-budget, scoped classification, signal-swap-then-restore); composition semantics by registration order; and the limits (cooperative never a hard kill; no blanket budget). |
| `packages/guard/timeout-policy/README.zh.md` | Chinese translation; head + heading index confirms the same section set (设计理念 / 截止时间如何设置与映射 / 与其他包装层组合 / 已知限制与延期工作). |
| `packages/guard/timeout-policy/locale/en.json` | Two-key locale stub: `meta.title = "tool-call-timeout-policy"`. |
| `packages/guard/timeout-policy/locale/zh.json` | Chinese stub with a description line. |
| `packages/guard/timeout-policy/package.json` | Publishes `@deepseek-ai/dsh-tool-call-timeout-policy@0.2.1-rc.2`; peers `dsh-llm`, `dsh-timeout`, `dsh-tools`, `cordis`; no runtime deps. |
| `packages/guard/timeout-policy/tsconfig.json` | Project references; adds `../../util/timeout` (the `dsh-timeout` deadline library) to the reference graph. |
| `packages/guard/timeout-policy/tests/timeout-policy.spec.ts` | Read in full. Pins: delegation for a tool with no declared budget (and that `exec.signal` is untouched); a fast budgeted tool keeps its own result; a budgeted tool receives the *derived* signal during dispatch; the caller signal is restored for `tools/post-execute`; the deadline replaces a cooperative tool's result with `TOOL_TIMEOUT`; a provider-owned `WEB_ABORTED` error is rewritten to `TOOL_TIMEOUT`; a caller abort first preserves the registry's `TOOL_ABORTED`; a later caller abort cannot replace an already-won timeout; the `TOOL_TIMEOUT` constant; HMR disposal removes the listener; and a "real-load-path" check that the module has no default export and survives `Loader.unwrapExports`. Fake timers throughout, so the timeout cases are deterministic rather than wall-clock races. |
| `packages/guard/repeat-tool-reminder/tests/repeat-tool-reminder.spec.ts` | Read as head (90 lines) + full `describe`/`it` title index (26 cases). Pins: gentle-then-detailed escalation at the first/second default threshold; the gentle text keyed to `thresholds[0]` not the literal 3; argument preview capped while detection still keys on the full string; a different tracked call resets the chain; excluded calls are transparent; `include` wildcard scope; regex metacharacters escaped in patterns; canonicalization ignores property order deeply; chains are per-agent; a new user prompt resets; a chain drops on agent disposal; denied calls count; direct executes with no agent are ignored; the reminder folds onto a downstream `block` keeping its feedback; a downstream canonical value replacement is preserved; and config validation rejects empty thresholds, a threshold below 2, a non-integer, duplicates, and a non-positive/fractional `argumentsPreviewChars`. Driven through a real agent loop against a scripted `MockAdapter` — no network, no wall clock. |

**`interaction/` group — `commands/`**

| File | What it is / what it pins |
| --- | --- |
| `packages/interaction/commands/README.md` | The full command contract: registration shape (name/description/`input.hint`/handler/optional branded `definitionId`), the exact command syntax (slash at byte zero, lowercase name `[a-z][a-z0-9_-]*`, then end-of-input or whitespace; everything after is `rawInput` and the command owns its grammar), agent-scoped shadowing, the attachment-admission rules, adapter dispatch, cancellation semantics; the implementation section (source map, lifecycle events, scoping via `ScopedLayers`, attachment admission) and the "Model Experience" section: command discovery/execution/UI output add **zero model tokens** and never affect the KV cache. |
| `packages/interaction/commands/README.zh.md` | Chinese translation; head + full heading index confirms the same sections (注册命令 / 命令语法 / 限定到 agent 的命令 / 附件 / 从适配器分派 / 取消 / 源码地图 / 生命周期事件 / 作用域 / 附件准入). |
| `packages/interaction/commands/locale/en.json` | Two-key locale stub (`meta.title = "commands"`). |
| `packages/interaction/commands/locale/zh.json` | Chinese locale stub with a description. |
| `packages/interaction/commands/package.json` | Publishes `@deepseek-ai/dsh-commands@0.2.1-rc.2`; **five** export entry points (`.`, `./types`, `./brand`, `./typert`, `./remote`) because the module is compiled for both a Host and a Client face; peers include `dsh-typert-protocol`, `dsh-attachment`, `dsh-scope`, `dsh-brand`; deps `zod` + `dsh-util-crypto`. |
| `packages/interaction/commands/tsconfig.json` | Project references; pulls in `core/agent`, `core/scope`, `core/session`, `llm/llm`, `attachment/attachment`, `util/brand`, `typert/protocol`, `util/crypto`. |
| `packages/interaction/commands/tests/commands.spec.ts` | Read as head (80 lines) + full `describe`/`it` title index (37 cases). Pins: `parseCommand` accepts `/goal`, `/goal create the thing`, a newline separator, a tab separator, and a name with `_`/`-`/digits, and rejects `goal`, ` /goal`, `/`, `/Goal`, `/goal/path`, `/goal🔥`; the descriptor list is immutable and name-sorted; agent-scoped shadows win and are removed with their scope; a registration dies with its plugin fiber; duplicates within one layer are rejected while a scoped shadow is allowed; `commands/change` fires on register/dispose and contains broken observers; non-string descriptions/hints are rejected at the boundary; the invocation carries the exact agent, rawInput and attachments; an aborted handler stops being awaited and an already-aborted signal is honoured; a handler that aborts synchronously is observed; a non-`Error` rejection is reported; `command/run` + `command/done` are logged as a pair around success, error-result and throw; an earlier `sourceEventSeq` is preserved; `recordInput: false` omits `args`; `commandId`s are distinct and monotonic; an admission miss logs **nothing**; the lifecycle pair joins an open turn **without** wrapping it in synthetic turns; attachments are rejected for a non-declaring command, rejected when no attachment store is composed, admitted as a mixed batch in selection order, and an unknown receipt / over-limit batch settle as logged errors; a cancellation landing during admission prevents the handler from running; a non-attachment admission failure is logged and rethrown. |
| `packages/interaction/permission-presets/README.md` | The full preset contract: the preset table config, the reserved names `custom`/`auto`, the write path (Auto admission first → `permission/preset` only on an effective change → each changed knob through its canonical setter), the read side and the `custom` derivation, session pinning vs. blank reuse, the catalog/projection/optional-command split, the limits (only two knobs bundled, `custom` is derived-only, the table is fixed for the plugin lifetime, Auto cannot become a default, a default must name a configured preset), and the model experience: `permission/preset` itself is log-only and causes no KV-cache invalidation. |
| `packages/interaction/permission-presets/README.zh.md` | Chinese translation; head + full heading index confirms the same sections (配置预设 / 切换预设 / 用户看到什么 / 会话默认值 / 写入路径 / 读取侧与 `custom` / 会话固定与空白复用 / 目录、投影与可选命令). |
| `packages/interaction/permission-presets/locale/en.json` | Two-key locale stub. |
| `packages/interaction/permission-presets/locale/zh.json` | Chinese locale stub with a description. |
| `packages/interaction/permission-presets/package.json` | Publishes `@deepseek-ai/dsh-permission-presets@0.2.1-rc.2`; peers `dsh-shell`, `dsh-commands`, `dsh-sandbox`, `dsh-sandbox-policy`, `dsh-session`, `dsh-session-projection`, `dsh-typert-protocol`, `dsh-user-approval`; deps `schemastery` + `zod`. |
| `packages/interaction/permission-presets/tsconfig.json` | Project references; includes `../user-approval`, `../commands`, `../../sandbox/*`, `../../shell/shell`, `../../settings/settings`. |
| `packages/interaction/permission-presets/tests/permission-presets.spec.ts` | Read as head (70 lines) + full `describe`/`it` title index (33 cases). Pins: the fold takes the latest preset and steps over unrelated events; the service does not activate without the projection registry and fails when the `permissions` key is absent; the table is advertised in declaration order; Auto is effect-scoped and removed on unload; a duplicate Auto integration is rejected; Auto admission runs before any write including a no-op; a rejecting admission leaves the session untouched; Auto↔Full-access switching records identity + approval policy; `current()` derives from the effective knobs; an unmatched state derives `custom` (a state, not an error); composition defaults outside the table still derive `custom` when an explicit default is configured; a stale fold falls back to table order; `set()` writes one preset event + both knob events; re-selecting the current preset is a no-op ("clicks are not switches"); re-asserting from a drifted state repairs the knob; a non-confining executor is rejected at load; `optionOf()` presents labels/descriptions and falls back to the raw key; `custom` and `auto` are reserved; an explicit default is required when the composition defaults match no preset; a schema-less approval stand-in reads as `ask`; and (new-session default) persisted Auto is rejected before publication when its integration is absent, admitted without rewriting when live, the current setting is pinned into each new session without changing earlier ones, a seeded legacy session keeps its own values, an empty stored session keeps the composition defaults, sessions that already exist are pinned on remount, existing knob overrides survive a remount, only missing legacy facts are filled, `ask` is materialised when a legacy seed omits the policy, and a stored default outside the table fails to read until repaired. |
| `packages/interaction/permission-presets/tests/projection.spec.ts` | Read in full (209 lines). Pins: the `permissions` projection serves **only** `currentValue` (and explicitly not `options`); the knob events notify the change feed per append and an unrelated `turn/start` does not; `custom` is projected when the knobs match no preset; Auto appears only in the process catalog and changes neither the Session seq nor the projection; catalog notifications are contained for sync throws, non-Error throws, async rejections and async non-Error throws (exactly four warnings); the projection key is absent without the service and is dropped on unload (HMR safety); the `/permission` command lists, switches, logs the lifecycle pair, reports the current preset on a bare invocation, and rejects an unknown preset **without touching the log**; and the service keeps its own instance off the generated Settings pages. |

| `packages/interaction/README.md` | The group map: the five seams and their `ctx` keys — `ctx.commands`, `ctx.approval`, `ctx.permissionPresets`, `ctx.userQuestions`, and the `ask_user_question` tool registered on `ctx.tools`. States the split: "Interactive applications expose these capabilities to people; automation handles its own approvals through ACP." |
| `packages/interaction/README.zh.md` | Chinese translation; head + full heading index confirms the same package table and the same ACP distinction. |
| `packages/interaction/tool-ask-user/README.md` | The tool contract: blocking by default, `mode: timed` opt-in (a **plugin row in the preset's `config.plugins` list**, not a top-level `--patch` entry), `timeout: -1` waits indefinitely, a live child agent cannot call it; the question grammar (unique ids within a call, the recommended option first with `(Recommended)` appended to its label, `timeout` in seconds, "a timeout is never approval"); the answer shape (`selected`, `custom`, an empty `selected` for a skipped item); the pending result `{ "pending": true, "callId": "…" }` and the late-answer user message identified by `kind`/`tool`/`callId`; the four failure modes including `DELEGATED_CALLER`; the "Model Experience" section (fixed schema cost, compact JSON result, no tokens while waiting); and four known limitations (the legacy tool never reports pending, an interrupted PTC wait may lose its question, runtime-owned subagents cannot ask, native answers render as JSON text). |
| `packages/interaction/tool-ask-user/README.zh.md` | Chinese translation; head + full heading index confirms the same sections (何时调用该工具 / 模型得到什么 / 调用何时失败 / 消费者角色 / 结果渲染). |
| `packages/interaction/tool-ask-user/locale/en.json` | Two-key locale stub. |
| `packages/interaction/tool-ask-user/locale/zh.json` | Chinese locale stub with a description. |
| `packages/interaction/tool-ask-user/package.json` | Publishes `@deepseek-ai/dsh-tool-ask-user@0.2.1-rc.2`; peers `dsh-agent`, `dsh-tools`, `dsh-user-questions`; dep `schemastery`. |
| `packages/interaction/tool-ask-user/tsconfig.json` | Project references; includes `../user-questions`, `core/tools`, `core/agent`, `core/system-prompt`, `llm/llm`. |
| `packages/interaction/tool-ask-user/tests/tool-ask-user.spec.ts` | Read as head (60 lines) + full `describe`/`it` title index (22 cases). Pins: the blocking legacy tool is kept when `apply` receives no config; the timed tool registers only when the Cordis row opts in; the 120 s wait is the fallback; the answer batch comes back when the client answers inside the wait; the configured default timeout is described to the model; a model-facing tool schema is registered; Cordis can select the exact legacy tool; the registered provider is asked and the structured answers are projected to text; recommended labels pass through without extra schema fields; custom answers and multi-select choices project correctly; the tool abort signal reaches the request; an optional header and a resumed runtime root pass through; a pending question is reported when the client settles the deadline; an unclaimed timed question is held to the deadline and then reported pending; the timed path requires a live agent; duplicate question ids are rejected before dispatch; separate timed calls may reuse an id; structured user-questions errors travel through tool execution; a live runtime-owned agent is rejected with `DELEGATED_CALLER`; an empty question batch is a structured error; and the tool unregisters when its plugin fiber is disposed. |
| `packages/interaction/user-approval/README.md` | The approval contract: the `ask`/`never` policies, the answerer waterfall (one terminal answerer; "sibling listener order is not a policy-priority mechanism"), the fail-closed `unavailable` outcome, one-shot-only grants, the audit pair in the requesting session's log, the turn-enclosure precondition, the abort-withdraws semantics ("aborting withdraws the question — the request settles `cancelled` and a late answer is discarded"), what the model sees vs. what the user sees, the exact `ask`/`never` model-facing sentences, the token and KV-cache effects, and the four known limitations (turn-enclosed requests only, one-shot grants only, no tool arguments in the request, no built-in answerer). |
| `packages/interaction/user-approval/README.zh.md` | Chinese translation; head + full heading index confirms the same sections (组合应答者 / 设置策略 / 请求决定 / 模型与用户看到什么 / 分发 / 策略与运行时上下文快照 / 审计). |
| `packages/interaction/user-approval/locale/en.json` | Two-key locale stub. |
| `packages/interaction/user-approval/locale/zh.json` | Chinese locale stub with a description. |
| `packages/interaction/user-approval/package.json` | Publishes `@deepseek-ai/dsh-user-approval@0.2.1-rc.2`; peers `dsh-agent`, `dsh-brand`, `dsh-llm`, `dsh-scope`, `dsh-session`, `dsh-system-prompt`; dep `schemastery`. |
| `packages/interaction/user-approval/tsconfig.json` | Project references; includes `core/system-prompt`, `core/scope`, `core/session`, `core/agent`, `llm/llm`, `util/brand`. |
| `packages/interaction/user-approval/tsdown.config.ts` | Build config: bundles `lib/types/index.js` to `lib` as ESM, node platform, es2024, no dts, no clean. |
| `packages/interaction/user-approval/src/types.ts` | Read in full (see Tier 1). |
| `packages/interaction/user-approval/tests/approval.spec.ts` | Read as head (60 lines) + full `describe`/`it` title index (32 cases) — 23 585 B. Pins: an idle ask throws **before appending anything**; a *closed* turn does not satisfy the enclosure precondition; with nobody listening the request fails closed to `unavailable` **and still audits the asked/decided pair**; absent optional fields are omitted from the asked event; the exact readonly request is borrowed for scoped dispatch and audit; an `approval/asked` observer throw after the append is contained and the pair still completes (and the same for `approval/decided`); an append failure that prevented log growth is propagated; the first answering listener's outcome wins (a single decision slot); a non-owning listener delegates via `next()` to the fail-closed default; global and matching agent-scoped listeners are dispatched to and a foreign scope is not; the scoped dispatch carrier is keyed to the exact request agent; a throwing answerer is contained as `unavailable`; a rogue non-vocabulary answer is normalised to `unavailable`; an already-aborted signal settles `cancelled` without asking anyone; a mid-question abort resolves `cancelled` and the late answer is discarded; a late rejection after an abort produces no unhandled rejection; a fresh id is issued per request; a disposed plugin listener is dropped from the chain (HMR safety); the policy fold takes the last event or is undefined; a policy outside the closed vocabulary is rejected **before** appending; a schema-less construction defaults to `ask`; a synchronously-throwing answerer is contained; a `never` config rejects deterministically without consulting any answerer; the gate decides first even against an answerer registered *before* the service, and is unbypassable even by an answerer **prepended after** the service mounts; a session override outranks the configured default in both directions; a live policy switch is queued for the next model step; the complete current policy is contributed as cache-safe context; the latest durable switch is reflected in that context and the contribution stays byte-stable while unchanged; and the runtime-context contribution is disposed with the service. |
| `packages/interaction/user-questions/README.md` | The seam contract: `ask()` vs `askTimed()`, the `attachWait` claim model, the Host-computed remaining duration, the projection-derived durable questions ("Client claims are not persisted"), the single-select vs multi-select `custom` rule, the `plan-review` presentation intent (and the two assertions `ask()` rejects with `BAD_INTENT`), the runtime-root rule, the `open`→`continued` lifecycle, the `answer` RPC's `REPLY_QUEUED` and `BAD_ANSWER` codes, the "no Remote method abandons a question" guarantee, the six exact error strings the model can see, and three known limitations (agent-scoped web answering, question-form-only vocabulary, draft text is not Host-persisted). Ends with the **runtime invariant**: the projection is derived from recorded tool calls, PTC dispatches and admitted user messages; no separate question state is stored. |
| `packages/interaction/user-questions/README.zh.md` | Chinese translation; head + full heading index confirms the same sections (提出问题 / 职责 / 模型体验 / 已知限制与暂缓事项). |
| `packages/interaction/user-questions/locale/en.json` | Two-key locale stub. |
| `packages/interaction/user-questions/locale/zh.json` | Chinese locale stub with a description. |
| `packages/interaction/user-questions/package.json` | Publishes `@deepseek-ai/dsh-user-questions@0.2.1-rc.2`; peers `dsh-agent`, `dsh-llm`, `dsh-scope`, `dsh-typert-protocol`, `dsh-session`, `dsh-session-projection`; deps `zod` + `schemastery`. |
| `packages/interaction/user-questions/tsconfig.json` | Project references; includes `../user-questions`'s dependencies: `core/agent`, `core/scope`, `core/session`, `core/tools`, `session/session-projection`, `typert/protocol`, `llm/llm`. |
| `packages/interaction/user-questions/tests/user-questions.spec.ts` | Read as head (40 lines) + full `describe`/`it` title index (36 cases). Pins: the request reaches the registered provider; no provider → rejection; provider registration is HMR-safe; composed answerers are delegated through; an already-aborted signal fails before the provider; an in-flight cancellation normalises to `ASK_ABORTED`; a domain rejection is preserved when the provider also aborts; a transported provider rejection is restored to `UserQuestionError`; an empty batch is rejected before the provider; a live runtime-owned agent is rejected before the provider; a lineage-bearing session resumed as a runtime root **does** reach the provider; a supplied agent with no live registry attestation is rejected; a stale agent object reusing a live id is rejected; a rejection outside the taxonomy is preserved; an intent whose `approve` names none of its options is rejected; a `plan-review` intent with no plan is rejected; a valid intent passes through; and for `askTimed`: sibling waits are independent and the rest are cancelled on unload, a forwarded request expires even when no client responds, a client-claimed wait stays open and its stream closes when the answer settles, an in-window answer is returned, the client's deadline rejection maps to `pending` while any other code is rethrown, an unclaimed request is held to the deadline then returns pending, the turn signal aborts the hold, a non-question provider failure is rethrown, the hold does not start when the turn ended while unclaimed, a non-positive wait is rejected; and for late replies: a steer closes the question once admitted, concurrent batches are accepted, one queued reply is accepted and a discarded one permits a retry, a reply already in the durable inbox is refused, a claimed reply is reserved, the reservation survives unrelated events, a claimed reply that ends without admission permits a retry, a steering throw permits a retry, an answer with no projection answers nothing, an open question or unknown call is refused, a batch that does not name each question exactly once is refused, and a call made under the blocking legacy tool is never listed even if the process never finished it. |
| `packages/interaction/user-questions/tests/projection.spec.ts` | Read as head (40 lines) + full `describe`/`it` title index (15 cases). Pins: the timed tool schema is recognised by its wait parameter alone; a question asked under the timed schema opens and maps the tool vocabulary; a call made under the blocking legacy tool is never tracked (a legacy session folds to the empty view); the fold follows the latest header when the composed tool changes mid-session; an in-time answer batch settles with that batch and every failure a live host records is dropped; a pending call — or one the process never finished — stays answerable as `continued`; a continued question closes only when its reply is admitted as a user message; a reply's answers are recorded exactly once across its splice and its own event; a pending PTC sub-call continues when only `run_code` appeared in the header; a reply carrying no usable batch settles with no answers; unrelated events, unreadable calls and an unchanged header return the same fold; several timed calls are tracked at once and a re-ask under a reused call id replaces in place; a tracked call whose result carries no text closes; a checkpointed state restores in service vocabulary and duplicate call ids are refused; only well-formed question batches are read out of the arguments; and a fork does not inherit a parent session's question and the whole view is exposed on the wire. |
| `packages/interaction/user-questions/tests/timed-wait.spec.ts` | Read in full (4196 B). Pins: the wait expires with no answer UI and releases its timer; a claimed wait stays open beyond the Host deadline and expires after the last claim leaves; the original remaining duration resumes after a claim disconnects; a claim is released when its consumer returns; claim streams end with the parent cancellation **without expiring the parent itself**; and a cancelled or expired wait cannot be claimed. |

| `packages/plan/README.md` | The group map: one package, `plan-mode`, at `ctx.planMode`; the group's framing sentence — "Plan mode guides rather than restricts: every tool stays available, and limits such as sandbox mode and approval prompts are configured separately." |
| `packages/plan/README.zh.md` | Chinese translation; head + full heading index confirms the same one-package map and the same guide-not-restrict framing. |
| `packages/plan/plan-mode/README.i18n.yaml` | Generated translation-pairing hash record (4412 B); head peeked - no behaviour. |
| `packages/plan/plan-mode/README.md` | The full plan-mode contract: the only required config is the guidance `section`; `/plan`, `/plan <message>`, `/plan off` (with attachments rejected before the mode changes); the reviewed exit (`Approve` vs `Keep planning`, free-text feedback, a dismissed review ends the turn); the implementation section's four design points (durable state and step-boundary appends, the `/plan` command, the exit tool, the session projection unit) and the "reviewed exit" details; the model experience (the `plan:policy` section at first-party prompt order 500, the command staying outside model history, the exit tool schema staying available in both states); and the five known limitations (guidance not enforcement, pending selections are process-local, no creation-time plan option, live children cannot open the review, one specialized review renderer). The Dev Note records the **rejected** generic named-mode registry: "a future collaboration state would establish a shared seam only from two concrete cases". |
| `packages/plan/plan-mode/README.zh.md` | Chinese translation; head + full heading index confirms the same sections (何时选择 / 最小配置 / 进入与离开计划模式 / 经评审的退出 / 观察计划状态 / 持久状态与步骤边界追加 / 会话投影单元). |
| `packages/plan/plan-mode/locale/en.json` | Two-key locale stub. |
| `packages/plan/plan-mode/locale/zh.json` | Chinese locale stub with a description. |
| `packages/plan/plan-mode/package.json` | Publishes `@deepseek-ai/dsh-plan-mode@0.2.1-rc.2`; **`peerDependenciesMeta` marks `dsh-commands` optional** — the command is a genuinely optional child; peers also include `dsh-user-questions` and `dsh-session-projection`; deps `dsh-brand` + `zod`. |
| `packages/plan/plan-mode/src/client.ts` | Read in full (see Tier 1) — the client-namespace re-export. |
| `packages/plan/plan-mode/src/index.ts` | Read in full (see Tier 1) — `PlanModeController`, the `plan/mode` event, the `plan:policy` section, `/plan`, and `exit_plan_mode`. |
| `packages/plan/plan-mode/src/types.ts` | Read in full (see Tier 1) — `PlanProjection`, `PlanUnitState`, the `plan` projection key. |
| `packages/plan/plan-mode/tests/integration.spec.ts` | Read as head (45 lines) + full `describe`/`it` title index (4 cases). A *full-loop* integration: only the model is mocked (a scripted `MockAdapter`); the loop, the session log and the plugin are real. Pins: a pre-turn `set()` makes the **first** header plan-shaped and a non-shell call is guidance-constrained only; a user flip between turns lands at the boundary with one notice and a replaced system node with **stable tool schemas**; a mode flip at error settlement waits until the step after a same-step retry; and a dismissed plan review ends the turn without another model request. |
| `packages/plan/plan-mode/tests/plan-mode.spec.ts` | Read as head (45 lines) + full `describe`/`it` title index (57 cases) — the largest test file in the shard (55 711 B). Pins: `resolveConfig` requires a non-empty string and rejects unknown keys; the fold takes the last `plan/mode` and can fold a prefix; the service does not activate without the projection registry and fails when the `plan` or `turnBoundary` key is absent; `get`/`set` semantics including the four outcomes; the boundary flush (inert when nothing is pending, flushed from pre-step before the following `step/start`, removed on fiber disposal, also flushed at the between-step seam, netted out on a flip-back, and silent before the first request header); the soft layer (tool schemas identical across modes, an agent-less assembly untouched, the full toolset kept in plan mode, foreign assemble additions left alone, the PTC-mode SDK byte-identical across mode switches); no execution gating beyond the exit tool; `/plan` behaviour (registered only with a commands service, mixed attachments steered, `/plan off` with attachments refused, the command removed on disposal); and `exit_plan_mode` in detail (one required argument, agent-less rejected, outside plan mode rejected while still advertised, a heading-less plan rejected before the reviewer is asked, degradation without a seam or without a provider, a runtime-owned agent rejected with consumer-neutral guidance, approve recording the boundary-applied switch, a PTC-mode review carrying the exact plan, the exit flush narrating nothing, keep-planning returning the corrective error with the feedback verbatim, custom text never being consent, exactly one `Approve` selection required, a dismissed review being a turn-concluding success, other review failures keeping their own message, the abort signal forwarded to the review, a disposed plugin failing the pending review, a throwing provider surfacing as the corrective `isError` while the mode stays plan, and the two card presentations) plus HMR disposal removing the service, listeners, prompt section and stable exit tool. |
| `packages/plan/plan-mode/tests/projection.spec.ts` | Read in full (165 lines). Pins: the empty log serves `{active:false, pending:false}`; a logged `/plan` selection reads pending until `plan/mode` records it; a selection whose command settles with an **error** is dropped; `off` args and non-plan commands fold correctly and a matching selection is not pending; a `/plan` message argument targets plan mode; `activeAtLastHeader` freezes the active state across a request header; there is no `plan` key when plan-mode is not composed; the key is dropped when the fiber unloads (HMR safety); and a **cold replay recovers `pending` from the log alone** — a second registry over the same log refolds `{active:false, pending:true}` with no service memory involved. |
| `packages/plan/plan-mode/tsconfig.json` | Full read. Project references; includes `../../interaction/user-questions` and `../../interaction/commands` — the two seams plan mode composes. |

**`preset/` group**

| File | What it is / what it pins |
| --- | --- |
| `packages/preset/README.md` | Group map: `agent-preset-registry` (selection, revision retention and profile editing, at `ctx.agentPresets`), `agent-preset` (declarative child plugins and metadata), `persona` (composable agent persona). The framing: "The Host shares the Agent loop; each Agent sees the tools, prompts and skills of its selected revision." |
| `packages/preset/README.zh.md` | Chinese translation; head + full heading index confirms the same three-package map and the same framing. |
| `packages/preset/agent-preset-registry/README.md` | The registry contract: the `default`/`selectedDefault` config, the fact that definitions come from the `dsh-web-app` bundle (the registry "neither scans directories nor accepts preset paths"), the retired `modeSelectionEnabled` field being ignored, the read-only YAML rendering, the revision-retention model (eager scope + in-memory Loader tree, retired revisions released when the last reference goes), the `cordis:group` isolation requirement, the activation audit (imports, missing services, globally leaked services) with the "startup order does not decide the outcome" rule, the session-log rules (retain the preset id, blank-session selections, recovery uses the *current* definition of that id), the `inspectCompositions()` contract, and the one known limitation: "Presets are not security sandboxes: YAML and plugins can execute Host code." |
| `packages/preset/agent-preset-registry/README.zh.md` | Chinese translation; head + full heading index confirms the same sections (最小配置 / 理解实现 / 模型体验 / 已知限制与待办). |
| `packages/preset/agent-preset-registry/locale/en.json` | Two-key locale stub. |
| `packages/preset/agent-preset-registry/locale/zh.json` | Chinese locale stub with a description. |
| `packages/preset/agent-preset-registry/package.json` | Publishes `@deepseek-ai/dsh-agent-preset-registry@0.2.1-rc.2`; peers the Cordis `include`/`loader` plugins plus `dsh-scope`, `dsh-session-projection`, `dsh-typert-protocol`; deps `dsh-app-boot`, `schemastery`, `zod`, **`js-yaml`** (for the read-only YAML rendering). |
| `packages/preset/agent-preset-registry/src/composition-inventory.ts` | Read in full (see Tier 1). |
| `packages/preset/agent-preset-registry/src/definition.ts` | Read in full (see Tier 1). |
| `packages/preset/agent-preset-registry/src/display.ts` | Read in full (see Tier 1). |
| `packages/preset/agent-preset-registry/src/index.ts` | Read in full (see Tier 1). |
| `packages/preset/agent-preset-registry/src/mount.ts` | Read in full (see Tier 1). |
| `packages/preset/agent-preset-registry/src/preset.ts` | Read in full (see Tier 1). |
| `packages/preset/agent-preset-registry/src/session.ts` | Read in full (see Tier 1). |
| `packages/preset/agent-preset-registry/src/types.ts` | Read in full (see Tier 1). |
| `packages/preset/agent-preset-registry/tests/composition-inventory.spec.ts` | Read in full. One case that pins the whole enablement algebra: a plain row, a `disabled: true` row, a `disabled: {__jsExpr:'false'}` row, a `disabled: {__jsExpr:'unknownVariable'}` row → `'conditional'`, a group with an unevaluable condition whose child inherits `'conditional'`, a disabled child, and a row buried under a disabled group → `false`; plus a malformed group yielding `broken`. |
| `packages/preset/agent-preset-registry/tests/display.spec.ts` | Read in full. Pins: a shipped preset resolves through its dictionary keys; **user-authored metadata is never translated** (the fixture uses Chinese text and expects it verbatim); a preset publishing no metadata falls back to the id, and a *future* system id outside the shipped set behaves like authored metadata. |
| `packages/preset/agent-preset-registry/tests/fixtures/plugins/contribute.js` | A preset row fixture: registers one tool and one prompt section, both named from config. The comment explains it is import-free "because the Loader resolves entry modules through Node's ESM resolver, which cannot see this workspace's TypeScript sources". |
| `packages/preset/agent-preset-registry/tests/fixtures/plugins/global-service.js` | Fixture that publishes a service with **no** `isolate` realm, so it lands in the ROOT realm — the case the leak audit must catch. |
| `packages/preset/agent-preset-registry/tests/fixtures/plugins/late-service.js` | Fixture that publishes into the root realm only *after* its plugin body returned — "escaping the one-shot mount audit. Exercises the package invariant." |
| `packages/preset/agent-preset-registry/tests/fixtures/plugins/needs-missing.js` | Fixture that waits forever for a service the composition never supplies — the row stays **pending** rather than failing, "which only the mount audit can catch". |
| `packages/preset/agent-preset-registry/tests/fixtures/plugins/self-dispose.js` | Fixture that disposes itself once active. Its comment records the bug it guards: "The Loader treats a self-disposing entry as a config change and writes the tree back through `EntryTree.write()`, which is the exact path that once truncated a preset file to `[]`." |
| `packages/preset/agent-preset-registry/tests/fixtures/plugins/throws.js` | Fixture whose activation rejects with its configured message — the failed-row case. |
| `packages/preset/agent-preset-registry/tests/harness.ts` | Read in full. The shared test harness: mounts the real Loader (with the group builtin), LLM runtime, session store, projection registry, system prompt, tool runtime, agent registry and agent loop; exposes `plugin()` (a fixture URL), `contribution(tool)` (a one-row preset), `declare()`, `agentOn(ctx, id, presetId)` (an agent whose setup mounts a preset) and `currentKey()` (an `acquireScope` lease). |
| `packages/preset/agent-preset-registry/tests/mount.spec.ts` | Read in full. Pins: active module order without a base URL, excluding inactive/disabled/group rows; individual causes of import and plugin failures preserved (a string rejection, an aggregate rejection with a nested aggregate, "never started"); `mountPreset` on an unscoped context rejects; the declaring Loader entry's subtree and subgroup are **not** replaced and runtime tree changes are **not** persisted; grouped and conditional rows reported from the activated tree; and a profile-denied row mounts **disabled** (and never executes its side effect) while the same row mounts active once the profile exempts it. |
| `packages/preset/agent-preset-registry/tests/registry.spec.ts` | Read as head (55 lines) + full `describe`/`it` title index (27 cases) — 21 401 B. Pins: eager scoping of tool and prompt registrations and one revision shared across agents; a replaced revision retained for existing scopes and their children and then released; definitions removed without revoking live bindings; a failed definition reported while healthy definitions and the host still start; duplicate ids rejected without disposing the first; a blank scope rebound while a child keeps its former revision; selection logged and preset changes rejected after the first turn; active/disabled entries inventoried with display metadata; a declaration rendered as entry-list YAML with conditions; a retired revision retained for an in-flight cold read; a row waiting for an absent service kept mounted, reported, and refused for bindings; a host provider still activating waited for instead of recording the preset as broken; an isolated service allowed and resolvable through the agent composition; the saved default resolved over the deployment default; a retired `modeSelectionEnabled` field ignored; the instance kept off the generated Settings pages; an unscoped binding and a second child join refused without leaking references; competing blank-session selections serialized and a failed selection recovered; a newly acquired generation retained when a previous activation is replaced; a blank session already running the current revision logging nothing; the default preset logged once when selected without a recorded preset; a repeated selection recomposed and logged once after the definition was replaced; a durable selection not lost when a `tools` observer rejects; failed conditional entries inventoried **without executing their expressions again**; a definition removed mid-acquisition not bound and disposal idempotent; inheriting a revision owned by a different registry refused; malformed child YAML validated at the declaring plugin with the diagnostic retained; and every process-global service published by a preset reported. |
| `packages/preset/agent-preset-registry/tests/session.spec.ts` | Read in full. Pins: the projection starts from the creation header (including **no** configured preset → `null`), keeps the latest selected preset across an unrelated `turn/end`, and the wire view and the state schema agree. |
| `packages/preset/agent-preset-registry/tsconfig.json` | Full read. Project references; a very wide graph (loader, include, app-boot, hmr, sandbox, user-approval, settings, session-projection, typert). |
| `packages/preset/agent-preset/README.i18n.yaml` | Generated translation-pairing hash record (1381 B); head peeked - no behaviour. |
| `packages/preset/agent-preset/README.md` | The declaration contract: the YAML row shape (`id`, `plugins`, `name`, `description`, `order`), the distinction between the Loader row id and `config.id` ("the preset identity saved by sessions"), the shipped `skills/` directory (four skills, with `references/packages.md` generated and freshness-gated in `doc-sync`), the **8192-character pruner threshold** every rendered `SKILL.md` must stay under, the repository symlink alias for `agent-experience` and its Windows caveat, and the two known limitations (duplicate preset ids fail; no directory/file-copy/file-delete operations). |
| `packages/preset/agent-preset/README.zh.md` | Chinese translation; head + full heading index confirms the same sections (使用本包 / 理解实现 / 模型体验 / 已知限制与待办). |
| `packages/preset/agent-preset/locale/en.json` | Two-key locale stub. |
| `packages/preset/agent-preset/locale/zh.json` | Chinese locale stub with a description. |
| `packages/preset/agent-preset/package.json` | Publishes `@deepseek-ai/dsh-agent-preset@0.2.1-rc.2`; `files` ships the **`skills`** directory verbatim; peers `cordis-plugin-loader` and `dsh-agent-preset-registry`; devDeps include `dsh-skill`, `dsh-skill-filesystem` and `dsh-compaction-tool-result-pruner` — the three packages the skills' own test uses. |
| `packages/preset/agent-preset/skills/agent-experience/SKILL.md` | Read in full. The harness's own **model-experience doctrine**, and the most directly transferable doc in the shard: start with minimal context; make discovery explicit; keep critical constraints visible; prefer bounded outputs (return ids/paths, never dump a whole log); use locality (a bounded amount of adjacent context, with omissions marked and a way to retrieve more); evaluate total work ("saving context is useful only if it does not cause more searches, repeated reads, or mistakes"). Plus the tool-definition rules: delete obvious constraints, describe behaviour not implementation, put parameter rules on the parameter, **say each fact once**, and **measure the change** (compare first-turn prompt tokens before and after a tool-definition change). |
| `packages/preset/agent-preset/skills/cordis-composition-reference/SKILL.md` | Read in full. The Loader YAML dialect as a *reference* (not a procedure): patch layers, `insert`, override-by-id with `config` replaced wholesale (never deep-merged), the row fields (`id`, `name`, `config`, `disabled`, `inject`, `intercept`, `isolate`), `group: true` with `cordis:group`, `cordis:include`, `disabled` as a boolean/null/`!!js` expression evaluated at every mount decision, `!!js` (never `!js`) evaluated after the row's injections activate, `isolate` mapping service names to realms, and the `plugin_manager` verbs. Ends with the instruction to **search** `references/packages.md` with grep rather than read it whole. |
| `packages/preset/agent-preset/skills/cordis-composition-reference/references/packages.md` | Read as head (60 lines) + full heading index (57 group headings, 514 lines total) — 41 003 B, the largest doc in the shard. A **generated** catalogue of every workspace package that exports a Cordis plugin, grouped by package group, each row carrying the package name, whether its row takes a `config`, and a one-line description. The header says it is "GENERATED from workspace manifests (`scripts/gen-plugin-packages.ts`) and verified fresh by `pnpm run verify-plugin-packages` (part of `doc-sync`); do not edit it by hand." The group list (acp, api, attachment, boot, browser-use, bundle, client, compaction, computer-use, context, core, credentials, deliverables, document, experimental, extensions, feedback, fs, goal, guard, host, interaction, jobs, llm, lsp, mcp, plan, preset, ptc-runtime, sandbox, schedule, sdk, session, session-query, settings, shell, skill, spill, ssh, storage, subagent, subprocess, telemetry, terminal, test-support, todo, typert, web, workflow, workspace) is itself a map of the reference's whole architecture. |
| `packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md` | Read in full. The full plugin-development procedure: author in the workspace, install with `plugin_manager action: install_bundle`, never hand-write `package.json`/`cordis.patch.yml` in the profile, never run pnpm in the profile directory, and **every `plugin_manager` action needs approval without Full access** — "call it only when its result decides the next step". Then the five-step "deliver a working plugin first" procedure (resolve the destination, discover only the APIs needed, copy the template, read the *installation result* not the logs, fix observed defects in the same plugin). Plus the "knowledge sources, in order" ladder: inspection (`cordis_inspect_query` for Service methods, Event modes, the Config JSON Schema, the Tools, live Client Slots and theme tokens), then package documentation (`Config.listConfigs` → `packageDir` → `README.md`), then source (`lib/index.js` + JSDoc, **not** `src/`). Also: the `DSH_PROFILE`/`DSH_PROFILE_DIR` environment contract, and the "Read next" table that is "the complete list: do not enumerate that directory", with the asar caveat (shell commands, glob, search, node and pnpm all fail inside `app.asar`). |
| `packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md` | Read in full. The Host bundle contract: the `dsh.bundle.patch` manifest, the two export forms (`apply(ctx, config)` or a default-exported service class — "do not mix them"), the display-metadata checklist (`meta.title`/`meta.description` in `locale/en.json` plus the user's locale, an original or licensed icon, `exports` of `./locale/*.json` and `./icon`, `files` kept in sync), the icon format rules (SVG/PNG/JPEG/WebP ≤ 256 KiB, must stay inside the package; absolute paths, URLs and escaping symlinks are rejected), the fallback rules (missing metadata falls back to `package.json` name/description; missing images use the panel's default artwork), and the "inspect saved-state and activation outcomes separately" rule (`failed` needs diagnosis, `overridden` means a higher layer wins, `restart-required` means the change is not live). |
| `packages/preset/agent-preset/skills/cordis-plugin-development/references/mcp-bundle.md` | Read in full. The configuration-only MCP bundle: a manifest with no Host/Client entry files, a patch inserting `@deepseek-ai/dsh-mcp-client` with `serverName`/`transport`/`url`/`failOnStartupError`, stdio variants, and the security rule: "Ambient credentials are scrubbed; reference existing credentials with Loader `!!js` rather than copying secrets into conversation text." Ends: "Repair the same bundle on failure instead of creating duplicates." |
| `packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md` | Read in full (7825 B) — the densest engineering-rules document in the shard. Six principles: the session log is the only source of truth; registrations are effects owned by a context (and a registration on another context has two owners, so keep its disposer in your own effect too); the framework drives and the plugin computes; **extension points are shared — use the weakest mechanism that suffices** (ordered: `ctx.tools.restrict()` can only remove, `ctx.tools.guard()` can only deny, waterfall listeners can rewrite and depend on registration order, `system-prompt/assemble` replaces the whole assembly); other plugins and other harness versions read your data; plugin UI is part of the harness UI. Then Stability rules (a waterfall listener that does not own the decision must return `next()`; spread a rewritten `agent/pre-step` decision so `startsRequestSeries` survives; a denial that must hold regardless of order is a `ctx.tools.guard()`, but a decision that must await something returns `ask` from `tools/pre-execute`; do not append session events with a new `type`; put tunable values in the plugin's `Config`), Performance rules (keep per-session state in a `ctx.sessionProjections` unit; `apply` is pure and returns the same reference for ignored events; bump `stateVersion`; wait on durable events, never poll `agent/status`; a timer that starts work calls `agent.followup()` because `agent.inject()` does not wake the agent), and UI rules (render in a slot, never an iframe; use `--dsw-alias-*` theme tokens only; do not `require` a harness Client package; contribute through `ctx.slots.inject`; add a Chat row via `ctx.uiConversation.events.register()`; declare `wire.view` on the Host projection so the Client never folds session events itself). |
| `packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md` | Read in full. The Web-UI plugin contract: the `dsh.client` manifest section (`platform`, `immediately`, `inject`), the `./client` export, the browser module-loader format (`window.__ModuleLoader__.load({ id, factory(require) })` with React taken from the browser module table — "no duplicate React installation, CDN script, or UMD search"), side-effect-free factories, theme inheritance, and the "do not read another plugin's DOM, stylesheet, or component source to estimate placement" rule. |
| `packages/preset/agent-preset/skills/cordis-plugin-development/references/user-actions.md` | Read in full. The "one operation, two callers" pattern: implement the operation once as a Host service method, let the UI action call it through a Client-callable Host entry point, and expose it through an agent tool with matching parameters — "Do not maintain separate operation logic in the UI and tool paths." And the crucial carve-out: "An action that grants or confirms authority, such as approving a tool call, answering a question the agent asked, or loosening a policy, **stays user-only**." The verification rule: perform the operation through the tool alone and compare; for user-only actions, verify that the agent cannot execute or authorize them. |
| `packages/preset/agent-preset/skills/cordis-plugin-development/references/verification.md` | Read in full. What counts as verification: prefer the already-connected page; do not launch a separate browser, change `HOME`, inspect personal browser profiles, or search for authentication tokens; "A screenshot of a mock page is not verification of the running plugin"; do not build a rasterizer or a custom renderer to compensate for missing browser control; for a page, verify theme-token-only styling, no harness Client package import, no slot-entry crash, and correct rendering in light and dark beside a comparable host page; "Scale verification to the change's risk." |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/client.js` | The Client-half template: a `window.__ModuleLoader__.load` factory that takes React from the module table and registers an SVG decoration into the `conversation.composer.dock` slot through `ctx.slots.inject` + `ctx.slots.register`. |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/cordis.patch.yml` | The two-line patch that inserts the `my-decoration` row. |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/icon.svg` | A 118-byte SVG placeholder (a blue circle) — the artwork the template ships; the skill requires the delivered plugin to replace it with original or licensed art. |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/index.js` | The Host half: `export function apply() {}` — "the Client module owns the rendering." |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/locale/en.json` | The template's `meta.title`/`meta.description` ("Composer Decoration" / "Displays a blue circle below the message composer."). |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/package.json` | The template manifest: `exports` for `.`, `./client`, `./locale/*.json` and `./icon`; `files` listing every shipped resource; `dsh.bundle.patch` and a `dsh.client` section (`platform: web`, `immediately: true`, an `inject` of the conversation UI package). |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/cordis.patch.yml` | The MCP template's patch: inserts `@deepseek-ai/dsh-mcp-client` with `serverName: demo`, `transport: streamable-http`, a loopback URL and `failOnStartupError: true`. |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/icon.svg` | A 335-byte SVG placeholder (two rounded rectangles and an arrow) — the MCP template's artwork. |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/locale/en.json` | The MCP template's `meta.title`/`meta.description`. |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/package.json` | The configuration-only MCP manifest: `exports` for the locale and the icon only, `files` with the patch and the resources, and `dsh.bundle.patch` — no Host or Client entry files. |
| `packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md` | Read in full. The preset-authoring procedure: "Nothing edits a declaration in place: a preset is created or changed by installing a bundle whose patch declares or overrides it"; where the shipped Web presets live (`presets/<id>.patch.yml` in the `dsh-web-app` bundle, ids `standard`/`ptc`/`minimal`/`cordis`); the declaration field rules (`id` = lowercase letters, digits and hyphens; `plugins` required); the two-file bundle recipe (`package.json` with `dsh.bundle.patch` + `cordis.patch.yml` with an `insert`); the override recipe ("the override replaces the complete `config`, so restate `id`, `plugins` and every other field"); the legacy-directory migration path; the verification steps; and the placement rule — "Host plugins supply shared services… Preset plugins contribute scoped tools, persona, prompt sections, and policies… A preset plugin that supplies a service must isolate the provider and all its consumers in the same realm." |
| `packages/preset/agent-preset/src/index.ts` | Read in full (see Tier 1). |
| `packages/preset/agent-preset/tests/skills.spec.ts` | Read in full. A **meta-test over the shipped skills**: `agent-experience` exists in the package with a repository *alias* (a symlink, or a plain-text link target on Windows with `core.symlinks=false`) rather than a second copy; the skill loads from both the package and the repository root; every rendered skill stays under the 8192-code-point pruner threshold and names only files that exist; every whole-file plugin reference stays under the same threshold **even when read with line numbers** (the read tool renders `${number}: ${text}`); every template's manifest, patch and JavaScript parse (the JS is checked with `node --check`); every template ships discoverable, exported, packaged display resources with a `meta.title` and `meta.description` and an `./icon` export; and — the sharpest rule — **no skill may forbid reading the harness's own sources or route skill files through the shell** ("Desktop ships the skill directory inside app.asar, which only the Host process can open"). |
| `packages/preset/agent-preset/tsconfig.json` | Full read. Project references; only cordis, loader, schemastery and the registry. |
| `packages/preset/persona/README.i18n.yaml` | Generated translation-pairing hash record (2384 B); head peeked - no behaviour. |
| `packages/preset/persona/README.md` | The persona contract: the four config fields, the scope-only constraint and why it exists ("Without this row, a preset could change an agent's tools but never its identity"), the template/interpolation rules, `complete` mode, `includeRuntimeContext` and the required-vs-optional distinction, the model experience (prefix at order 0, suffix at order 10200, token and KV-cache effects), and the two known limitations (no global mount; no per-provider runtime-context filter). |
| `packages/preset/persona/README.zh.md` | Chinese translation; head + full heading index confirms the same sections (配置 / 人设行为 / 何时使用 / 如何注册 / 为何仅限 scope 内使用 / 源码地图). |
| `packages/preset/persona/locale/en.json` | Two-key locale stub. |
| `packages/preset/persona/locale/zh.json` | Chinese locale stub with a description. |
| `packages/preset/persona/package.json` | Publishes `@deepseek-ai/dsh-persona@0.2.1-rc.2`; peer `dsh-system-prompt`; dep `schemastery`. |
| `packages/preset/persona/src/index.ts` | Read in full (see Tier 1). |
| `packages/preset/persona/tests/persona.spec.ts` | Read in full. Pins: the persona shadows and interpolates per scope and **restores both defaults on disposal**; an omitted or empty suffix shadows the global suffix away; an **unscoped mount is rejected** with `"deployment:persona-prefix" is already registered`; the shadow is per-scope only; two scopes get two independent personas; empty text still shadows the deployment persona away; disposal restores it; prompt variables interpolate **strictly** and at render time (not assembly time); `complete: true` makes the persona the exact prompt *after* every other contribution, including a prepended `system-prompt/assemble` listener; `includeRuntimeContext: false` suppresses the scope's contexts without changing the global assembly, and disposal restores them; and runtime context stays enabled by default when `apply` is called directly, bypassing the schema defaults. |
| `packages/preset/persona/tsconfig.json` | Full read. Project references; only cordis, cosmokit, schemastery and `core/system-prompt`. |


### Tier 3 — skipped with a reason

**`guard/` group**

| File | Why not read line by line |
| --- | --- |
| `packages/guard/README.i18n.yaml` | Generated translation-pairing record (per-heading hashes of the EN/ZH README blocks, 919 bytes). Head peeked: 6 heading entries with `en`/`zh` hashes. It records that EN and ZH are in sync; it carries no behaviour. |
| `packages/guard/repeat-tool-reminder/README.i18n.yaml` | Generated translation-pairing record (3782 bytes). Head peeked: same hash-per-heading format. No behaviour. |
| `packages/guard/timeout-policy/README.i18n.yaml` | Generated translation-pairing record (2882 bytes). Head peeked: same format. No behaviour. |

**`interaction/`, `plan/` and `preset/` groups**

| File | Why not read line by line |
| --- | --- |
| `packages/interaction/README.i18n.yaml` | Generated translation-pairing hash record (985 B); head peeked — 5 heading entries with `en`/`zh` hashes. It records EN/ZH parity; it carries no behaviour. |
| `packages/interaction/commands/README.i18n.yaml` | Generated translation-pairing hash record (2854 B); head peeked — same format. |
| `packages/interaction/permission-presets/README.i18n.yaml` | Generated translation-pairing hash record (2602 B); head peeked — same format. |
| `packages/interaction/tool-ask-user/README.i18n.yaml` | Generated translation-pairing hash record (3026 B); head peeked — same format. |
| `packages/interaction/user-approval/README.i18n.yaml` | Generated translation-pairing hash record (3635 B); head peeked — same format. |
| `packages/interaction/user-questions/README.i18n.yaml` | Generated translation-pairing hash record (1282 B); head peeked — same format. |
| `packages/plan/README.i18n.yaml` | Generated translation-pairing hash record (906 B); head peeked — same format. |
| `packages/plan/plan-mode/README.i18n.yaml` | Generated translation-pairing hash record (4412 B); head peeked — same format. |
| `packages/preset/README.i18n.yaml` | Generated translation-pairing hash record (824 B); head peeked — same format. |
| `packages/preset/agent-preset-registry/README.i18n.yaml` | Generated translation-pairing hash record (2015 B); head peeked — same format. |
| `packages/preset/agent-preset/README.i18n.yaml` | Generated translation-pairing hash record (1381 B); head peeked — same format. |
| `packages/preset/persona/README.i18n.yaml` | Generated translation-pairing hash record (2384 B); head peeked — same format. |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/icon.svg` | Binary-ish asset (118 B). Head peeked: a 2-line SVG placeholder — a blue `#247bbf` circle in a 64×64 viewBox. The skill itself requires the delivered plugin to replace template artwork with original or licensed art, so the template's own icon carries no information beyond "this is a placeholder". |
| `packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/icon.svg` | Asset (335 B). Head peeked: a 4-line SVG placeholder — two rounded rectangles and an arrow in `#247bbf`. Same placeholder status. |


---

## 2. Ideas worth stealing

### 2.1 The documentation contract itself is an idea

Every `deepseek-harness` package README follows one fixed skeleton: **Summary → Use this package →
Understand the implementation → Further Exploration → Model Experience → Known Limitations and
Deferred Work → Dev Note**, and the "Model Experience" block is always three sub-headings —
*What the model sees* / *Token effect* / *KV Cache effect* (`packages/interaction/user-approval/README.md:104-130`).
The "Known Limitations" block explicitly says "These limits define when the seam is a poor fit.
They are current package constraints, not a general permission comparison"
(`packages/interaction/user-approval/README.md:146-156`) — i.e. a *limits* section, never a
backlog. A reader can therefore ask any package the same three questions and get an answer.

### 2.2 The "Dev Note is non-authoritative" convention

Each README closes with a "Dev Note" that says, in the same words: "This Dev Note is working
context for maintainers: open questions and directions that are not decided. It is explicitly
non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above,
the package code, and the linked Agent Note" (`packages/guard/timeout-policy/README.md:120-131`).
Decided facts and open questions are structurally separated, and the open questions link to
*archived* Agent Notes so a reader can see the whole history. This is the same discipline August
Trading's `docs/plan/` uses, arrived at independently — a **convergence worth noting** (see
`AGENTS.md` in the August Trading repo: "The plan is a proposal, not a decision").

---

### 2.3 The stealable mechanisms

Convergence notes below were checked against the other two reference repos by a bounded
`git ls-files` + targeted head-read of `pi`'s `packages/coding-agent/examples/extensions/` and
`hermes-agent`'s `agent/` — the full read of those repos belongs to other shards.

1. **Gate consequential decisions *inside* the durable turn boundary, and fail closed.**
   `packages/interaction/user-approval/src/index.ts:84` (`hasOpenTurn`) refuses an approval
   request when the session log has no open turn, with the reason stated in the error: "a bare
   event between turns is crash-tail garbage on reload". Every ask appends a paired
   `approval/asked` / `approval/decided` audit pair (`src/index.ts:229`, `src/index.ts:233`), and
   a missing or throwing answerer resolves `'unavailable'` so the action fails closed
   (`src/index.ts:279-286`).
   **CONVERGENT** — `pi`'s `packages/coding-agent/examples/extensions/permission-gate.ts:22-24`
   blocks a dangerous bash command with "Dangerous command blocked (no UI for confirmation)" when
   no UI exists; `hermes-agent`'s `acp_adapter/permissions.py` and
   `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/approval-timeout.test.ts`
   cover the same territory.
2. **Advisory nudges for tool loops, with an idempotent-tool allow-list.**
   `packages/guard/repeat-tool-reminder/src/index.ts:196` counts consecutive identical
   `(tool, canonical args)` per agent, escalates at exact thresholds, and never blocks; excluded
   tools are *transparent* (they neither count nor reset, `src/index.ts:183`).
   **CONVERGENT** — `hermes-agent/agent/tool_guardrails.py` has
   `STALL_GUARD_IDENTICAL_CALL_THRESHOLD = 3` (the same threshold), an `IDEMPOTENT_TOOL_NAMES`
   allow-list playing the role of dsh's `exclude`, and `STALL_GUARD_REPEATABLE_TOOLS` for
   legitimate pollers. **Hermes is stronger in one place**: it detects *cycling* calls
   (`A,B,A,B,…`) that defeat a consecutive-streak detector — dsh's chain resets on every
   different call, so a two-tool loop never trips it.
3. **A cooperative, per-tool deadline whose own timer is distinguishable from an upstream
   cancel.** `packages/guard/timeout-policy/src/index.ts:56` reads the budget from the tool's own
   definition, swaps a derived signal onto `exec` and restores it in a `finally`
   (`src/index.ts:73-75`), and scopes the classification by code so a nested outer deadline reads
   as an ordinary cancel (`src/index.ts:66-68`).
   **CONVERGENT** — `hermes-agent/agent/reasoning_timeouts.py` and
   `agent/thinking_timeout_guidance.py`; `pi` has `src/core/output-guard.ts`.
4. **Write every model-visible state change into the durable log, even when it feels redundant.**
   `packages/preset/agent-preset-registry/src/session.ts:11-17` states the rule outright:
   "it is required outright by the repo's model-visible ⟺ logged rule, since the preset decides
   the tool schemas and prompt sections the model sees." The same rule appears in
   `packages/plan/plan-mode/src/index.ts` (the `plan/mode` event) and in
   `packages/interaction/commands/src/types.ts` (the `command/run` ↔ `command/done` pair, which
   "mirrors the `tool/call`↔`tool/result` pairing").
   **CONVERGENT** — `pi`'s `packages/durable/test/examples/27-plan-mode.ts` treats plan mode as a
   durable-log example, and `pi`'s plan mode documents "Session persistence: State survives
   session resume".
5. **Derive state by folding the log in a pure projection; keep the durable state and the
   *displayed* state as separate facts.** `packages/interaction/user-questions/src/projection.ts:235`
   (`applyUserQuestionEvent`) is a pure fold that returns the **same reference** for an unrelated
   event; `packages/plan/plan-mode/src/types.ts:26` keeps `active` (the mode in force) and
   `activeAtLastHeader` (the mode the model was last told) apart; the `plan` projection carries
   `{ active, pending }` where `pending` is "a pure replay quantity recoverable from the log
   alone" (`packages/plan/plan-mode/src/index.ts:141-172`, proven by
   `tests/projection.spec.ts:152`).
6. **A "mode selector" that writes through to existing canonical setters instead of inventing a
   parallel state.** `packages/interaction/permission-presets/src/index.ts:403` (`apply`) resolves
   the bundle, appends a *preset* event for intent, and then writes each **changed** knob through
   its own setter (`setSandboxMode`, `setApprovalPolicy`). Removing the package leaves the last
   selection in effect. **CONVERGENT** — `pi`'s `examples/extensions/preset.ts` and
   `hermes-agent`'s `acp_adapter/permissions.py` both model permissions as a bundle over
   independent knobs.
7. **Require the approval *answer* to be exact, and treat everything else as a refusal.**
   `packages/plan/plan-mode/src/index.ts:344-350` accepts consent only when there is exactly one
   answer item, exactly one selected label equal to `Approve`, and no `custom` text. "A
   custom-text-only answer is feedback, never consent" (`tests/plan-mode.spec.ts:1005`); "custom
   text alongside Approve is feedback, not consent" (`:1021`); "duplicate review answer items are
   non-consent" (`:1029`); "a missing answer item reads as keep-planning" (`:1043`).
8. **Let the model ask, and let a *timeout* release it without pretending it was answered.**
   `packages/interaction/tool-ask-user/src/timed.ts:191` — a timed ask returns
   `{ pending: true, callId }`, the question stays answerable, and a later answer arrives as a
   user message. The pending notice says "**Do not treat this as permission.**"
   (`src/timed.ts:39`). **CONVERGENT** — `pi`'s `examples/extensions/question.ts` and
   `questionnaire.ts`; `hermes-agent/agent/side_question.py`.

---

## 3. Trading-specific findings

1. **Human-in-the-loop approval — answered in depth, and the shape transfers directly to a
   trading app.** `packages/interaction/user-approval/src/index.ts` gives a one-shot,
   channel-neutral, fail-closed gate: a closed outcome vocabulary
   (`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`, `src/types.ts:31`), a
   **one-shot-only** grant with no "allow always" and no grant store, a durable audit pair, and
   a `never` policy that "rejects every request deterministically before interactive dispatch —
   the strict headless stance for CI and unattended runs" (`README.md:47`). For a trading app the
   interesting inversion is that the *request carries no tool arguments*
   (`src/types.ts:60-70`, and the README's limitation "The request carries no tool arguments") —
   an approver sees the tool name and the reason, not the order. A trade-log approval would need
   to decide whether that is the right default.
2. **Multi-agent: the runtime-root rule is a clean answer to "can a subagent ask the human?"**
   `packages/interaction/user-questions/src/index.ts:131` (`assertLiveRoot`) requires the *exact
   live* agent and then requires it to be a **runtime root**; a delegated child is rejected with
   `DELEGATED_CALLER` and "must include the unresolved decision in its final result"
   (`src/index.ts:139-141`). The README explains why: "an owned child has no human answerer and
   would block forever, while a lineage-bearing session resumed as a new runtime root may ask
   normally." The same rule appears in `exit_plan_mode`
   (`packages/plan/plan-mode/src/index.ts:270-272`). For a trading app this is the right shape for
   *every* subagent that might want to escalate: escalate as a **result**, not as a question.
3. **Structured, queryable logs without a database — answered.** The reference keeps one
   append-only **session event log** as the only source of truth, and derives every read model
   as a *pure fold* over it (`packages/interaction/user-questions/src/projection.ts:235`,
   `packages/plan/plan-mode/src/index.ts:136`). The log-only event vocabulary includes
   `approval/asked` / `approval/decided`, `plan/mode`, `permission/preset`, `command/run` /
   `command/done`, `sandbox/mode`, `approval/policy`, `agent-preset/selected`. Each is a
   *whole-value replace* with a paired event where a pair is needed. That is a complete answer to
   "the equivalent of a trade log": a JSONL-style event log with typed fold projections, no DB.
4. **Staying simple as features accumulate — answered twice, in two different registers.**
   (a) *Mechanically*: the reference's own practices note says "**Extension points are shared;
   use the weakest mechanism that suffices**", ordering the mechanisms from weakest to strongest
   — `ctx.tools.restrict()` (can only remove) → `ctx.tools.guard()` (can only deny) → waterfall
   listeners (can rewrite, depend on registration order) → `system-prompt/assemble` (replaces
   the whole assembly) — "The stronger the mechanism, the more of other plugins' contributions
   you must preserve" (`packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md:24-28`).
   (b) *Procedurally*: plan mode was built as a **product package, not a capability seam** —
   "there is no swappable backend, so the state, guidance, command, and exit tool live in one
   place" (`packages/plan/plan-mode/README.md:96`), and the design note **rejected** a generic
   named-mode registry because "the product shipped only `plan`" and "a future collaboration
   state would establish a shared seam only from two concrete cases"
   (`packages/plan/plan-mode/README.md:194-199`).
5. **Long-lived monitoring and scheduled work — NOT in this shard.** The shard contains no
   scheduler, no cron, no digest loop and no TP/SL detection. (`packages/preset/agent-preset/skills/cordis-composition-reference/references/packages.md` shows a `schedule` package group and a `goal` group in the wider monorepo, but neither is in this shard's file list.) Do not infer an answer from this report.
6. **Post-mortem / reflection loops — NOT in this shard.** There is no outcome→rule loop here:
   the closest adjacent fact is the "model-visible ⟺ logged" rule, which is a *record* obligation
   rather than a learning loop. (The `skill` package group visible in `packages.md` is the likely
   home of a skill/rule lifecycle, but it is outside this shard.)

---

## 4. Non-obvious decisions and gotchas

- **A "pending" state is a first-class outcome, and it is different from a "skipped" answer.**
  `packages/interaction/tool-ask-user/src/timed.ts:34-43` puts the explanation *inside* the
  result value because "the recorded result text is read back as one JSON object: the
  `userQuestions` projection decides from it that the call stays answerable, and the Client
  question row decides from it that the recorded result is the timeout, not an answer batch."
- **A timeout is not a permission.** The pending notice says so in as many words
  (`src/timed.ts:42-43`): "Do not treat this as permission." The `ask`/`never` policy sentences
  carry the same care (`packages/interaction/user-approval/src/index.ts:73-75`).
- **The `never` policy is decided inside the service, not by a listener.** The reason is a
  registration-order subtlety: "a listener registered with `prepend: true` after this service
  mounts would sit ahead of any gate LISTENER, so a listener-shaped gate cannot keep the
  documented promise that `never` rejects deterministically regardless of registration order —
  only the service's own request path can" (`packages/interaction/user-approval/src/index.ts:274-280`).
- **Plan mode does *not* restrict tools in this reference, and that is a deliberate divergence
  from `pi`.** `packages/plan/plan-mode/README.md:38-39`: "It does not restrict the agent: every
  tool stays callable"; the test says "runs every call in plan mode untouched — guidance and
  enforcement are separate axes" (`tests/plan-mode.spec.ts:581`). `pi`'s plan mode does the
  opposite — it disables edit/write and allowlists read-only bash
  (`pi/packages/coding-agent/examples/extensions/plan-mode/README.md:5-7`). **A reader who
  assumes "plan mode" means the same thing in both repos will be wrong.**
- **The exit tool stays registered while plan mode is off.** `packages/plan/plan-mode/src/index.ts:66`
  — "so entering or leaving plan mode changes only the prompt section, never the request tool
  catalog." The tool *schemas* are byte-identical across the transition, which is what keeps the
  KV-cache prefix stable.
- **A `pending` selection in plan mode is process-local.** The README lists it as a known
  limitation: "a selection made after the turn's final accepted pre-step is lost if the process
  exits before another accepted in-turn pre-step; the UI must reapply it"
  (`packages/plan/plan-mode/README.md:170`). A trading app with a mode switch must decide what
  happens on a crash mid-switch.
- **A `!!js` expression that cannot be evaluated is reported as `'conditional'`, not guessed.**
  `packages/preset/agent-preset-registry/src/composition-inventory.ts:101-113` — "Throwing
  refuses the answer: the row is reported `'conditional'` rather than guessed." A third state
  between "on" and "off" is the honest answer, and it is modelled in the type.
- **The preset tree's `write()` is a no-op on purpose.** `packages/preset/agent-preset-registry/src/mount.ts:23`
  — and the fixture `tests/fixtures/plugins/self-dispose.js` records the bug it prevents: the
  Loader "writes the tree back through `EntryTree.write()`, which is the exact path that once
  truncated a preset file to `[]`."
- **Service-isolation leaks are detected by symbol identity, and `uid` cannot be used.**
  `packages/preset/agent-preset-registry/src/mount.ts:48-66` — "`uid` looks like a cheaper key
  but is a per-registry counter, so fibers in two different roots collide on it and a subtree in
  one runtime would be blamed for a service published in another."
- **A capability's absence is the *absence of a key*, never a value.**
  `packages/plan/plan-mode/src/types.ts:17-22`: "Capability absence (plan-mode not composed) is
  the key's absence, never a value." The same pattern in
  `packages/interaction/permission-presets/src/types.ts:52-64` ("Key absence means no permission
  service is composed — clients hide the control").
- **`'custom'` is a derived state, not a selectable one.** `packages/interaction/permission-presets/src/index.ts:79`
  and the README: "Unmatched knob combinations appear as `custom`, which users can leave but
  cannot select." The user can be *in* a state the UI cannot name as a target.
- **The bilingual READMEs are paired by hash, not by review.** Each `README.i18n.yaml` records a
  per-heading hash of the EN and ZH blocks, and the file's own comment gives the repair command
  (`pnpm run verify-translation-pairing --write <path>`). A translator can therefore tell, per
  section, whether the two sides have drifted.
- **The skills are meta-tested.** `packages/preset/agent-preset/tests/skills.spec.ts` asserts that
  every shipped skill stays under the 8192-code-point pruner threshold *even when read with line
  numbers*, that every referenced file exists, that every template's manifest/patch/JS parses,
  that every template ships an icon and a `meta.title`/`meta.description`, and — the sharpest
  rule — that **no skill may forbid reading the harness's own sources or route skill files
  through the shell** (because Desktop ships the skill directory inside `app.asar`, which only
  the Host process can open).

---

## 5. Weak spots

- **Plan mode's enforcement is entirely textual.** The whole feature is one prompt section and
  one tool; nothing stops the model from acting. `packages/plan/plan-mode/README.md:166` admits
  it: "Guidance, not enforcement — plan mode restrains through text only." A user who wants
  "the agent must not trade until I approve" gets a *suggestion*, not a gate. (`pi` enforces it;
  this reference does not.)
- **`exit_plan_mode` degrades to a dead end without a `user-questions` channel.**
  `packages/plan/plan-mode/src/index.ts:299-301` — the tool fails with "no user-questions channel
  is available to review the plan; ask the user to switch the session mode instead", and the
  README confirms "If no interactive review is available, `exit_plan_mode` cannot run and you
  can still leave plan mode with `/plan off`." The agent's plan-submission path is therefore
  *optional infrastructure*, and the package is not self-sufficient.
- **A pending plan-mode selection is lost on a process exit.**
  `packages/plan/plan-mode/README.md:170` — the selection "is lost if the process exits before
  another accepted in-turn pre-step; the UI must reapply it." The pending intent lives in a
  `WeakMap` (`packages/plan/plan-mode/src/index.ts:186`), so it is *memory*, not log.
- **The repeat-tool reminder cannot see a two-tool cycle.** The chain resets on every *different*
  tracked call (`packages/guard/repeat-tool-reminder/src/index.ts:196-215`), so `A,B,A,B,…` never
  trips it. `hermes-agent` explicitly widened its loop guard from single-call turns to whole
  tool-call batches for exactly this reason
  (`hermes-agent/agent/tool_guardrails.py:38-44`).
- **The repeat-tool reminder's argument preview can leak a payload into the context window.**
  The 500-character cap (`packages/guard/repeat-tool-reminder/src/index.ts:48-52`) bounds the
  *quoted* text, and the reminder "is retained history for that agent" — a large `write` body
  echoed in a reminder is 500 characters per threshold crossing, on top of the tool result the
  agent already has. The chain's own key still uses the **full** canonical string
  (`src/index.ts:125-128`), so the cap cannot cause a false negative — but it does cost tokens.
- **A preset is not a security boundary.** `packages/preset/agent-preset-registry/README.md:97`
  says it plainly: "Presets are not security sandboxes: YAML and plugins can execute Host code."
  The `isolate` requirement (`src/mount.ts:204-227`) stops a preset from *replacing* a Host
  service, but it cannot stop a preset from running arbitrary code inside the Host process.
- **The `agent-preset` package ships a skills directory that is only discoverable when symlinks
  work.** `packages/preset/agent-preset/README.md:52-54` and its limitation: "Repository
  discovery of `agent-experience` requires a checkout with symbolic links enabled. With
  `core.symlinks=false`, Git writes the link target as plain text, not a skill." On Windows
  checkouts the repository copy of that skill is *not* a skill — a real, shipped footgun that the
  test acknowledges but cannot fix.
- **The reference's own `timeout-policy` package carries a stale `FIXME` and three names.**
  `packages/guard/timeout-policy/src/index.ts:8-11` asks to settle a
  `@deepseek-ai/dsh-timeout-guard` rename that the naming ledger has already settled the other
  way (the README calls the FIXME "stale pending a code cleanup"), and the package has three
  names: the directory `timeout-policy`, the Cordis plugin name `timeout-policy`, and the npm
  name `@deepseek-ai/dsh-tool-call-timeout-policy`.
- **The approval seam's "one decision slot" and the questions seam's "one queued reply" are
  single-threaded by design, and a second caller gets an error rather than a queue.**
  `packages/interaction/user-approval/tests/approval.spec.ts:180` ("the first answering listener
  outcome (single decision slot)") and `packages/interaction/user-questions/src/index.ts:180-184`
  (`REPLY_QUEUED`). Fine for one human; a multi-human approval queue would need more.



