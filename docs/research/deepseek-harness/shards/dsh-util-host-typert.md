# deepseek-harness :: dsh-util-host-typert

**Files in shard:** 472 (read: 412, skipped with a stated reason: 60)
**What this shard covers:** the "platform" layer of the deepseek-harness monorepo — everything that is *not* the agent loop itself. Concretely four groups: (a) `packages/extensions/*` — the dynamic "Cordis" plugin system, split into a host half (`cordis-host-runner`), a browser half (`cordis-client-runner`), a read-only discovery tool pair (`tool-cordis`) and a browser panel (`ui-cordis`); (b) `packages/host/*` — the OS-facing adapters: directory pickers (four competing implementations), `open-in-app` URL/app resolution, `plugin-inventory`, OpenTelemetry product telemetry, and a static-file web server; (c) `packages/typert/*` — the type/protocol layer: an AST-driven **type-model generator** that turns a TypeScript workspace into a machine-readable service/type contract, the wire protocol, a loader, and a registry service; (d) `packages/util/*` — twenty small, sharp utility packages (atomic write, brand types, partial-JSON streaming, timeouts, output retention, HTTP proxy policy, native command opening, workspace paths, …).

For **August Trading** the load-bearing ideas here are: *progressive disclosure catalogs* (a directory first, one exact contract second), *teaching errors that name the fix*, *the dual-half plugin split* (host owns I/O, browser owns UI), *a whitelist façade that pins identity*, *convergence by identity rather than by history*, and *retention caps with a classifier instead of eviction*.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `packages/extensions/cordis-client-runner/src/client/evaluator.ts`
- **Purpose:** evaluate a *browser half* of a dynamic plugin — plain JavaScript source that is run as the **body of an async function** whose parameters ARE the symbol surface.
- **Key abstractions:** `evaluateClientHalf()`, `isDynamicCordisPlugin()`, `DynamicCordisStyles`, `DYNAMIC_CLIENT_REDIRECTS`, `DynamicCordisClosureEnv`, `DynamicCordisEvaluatedPlugin`.
- **Data flow:** host hands over `clientCode` → `new Function('React','console','styles','host','harness','setTimeout',…,'process','Buffer', body)` → the closure returns a plugin (function form or `{ apply(ctx) }` object form) → runner mounts it. The declared `inject` of the *returned* plugin is deliberately NOT trusted here (the runner overwrites it from the dispatched row).
- **Non-obvious design decisions:**
  - **Shadowing the ambient globals instead of deleting them.** `setTimeout/setInterval/clearTimeout/clearInterval/fetch/require` are injected as *parameters* that throw. That turns a runtime "not a function" into a **teaching error naming the exact alternative** (`evaluator.ts:36-50`). The same redirect text is reused for a crash that mentions the global by another route (`window.setInterval`), and is appended only if not already present — the trap's own message already carries it.
  - `host.call(method)` with no argument sends **`null`**, not `{}` and not `undefined` — because the wire is JSON and `undefined` is not JSON (`evaluator.ts:225-231`).
  - `harness` is a `Proxy` that throws on **any** property read — the host half owns `harness.handle`, the browser half owns `host.call` (`evaluator.ts:74-84`).
  - `console` is wrapped: every line is tagged `[cordis:<pluginId>]`, and **only `console.error` is mirrored** into the load report, truncated at 500 chars (`evaluator.ts:135-150`).
- **Edge cases & failure handling:** a `SyntaxError` from `new Function` is re-thrown as a teaching error naming "plain JavaScript (no JSX, no TypeScript)"; a *non*-SyntaxError from the constructor is rethrown untouched (so a real engine fault is not misreported as a source problem, `evaluator.ts:191-197`). A closure returning `undefined` gets a "did you forget `return`?" message with two worked examples; any other non-plugin value gets "must `return` a plugin". A circular console argument degrades to `'[unserializable console argument]'`.
- **Surprising:** `process` and `Buffer` are passed as `undefined` so `typeof process` probes stay safe instead of throwing `ReferenceError`.

### `packages/extensions/cordis-client-runner/src/client/guard.ts`
- **Purpose:** the whitelisting `ctx` façade a dynamic browser half receives — **API discipline, not a security boundary** (the file says so at `guard.ts:10-11`: the code is as trusted as the host process that accepted it).
- **Key abstractions:** `dynamicCordisContext(ctx, env)`, `DynamicCordisGuardEnv`, `DynamicCordisSlotLedgerRow`, `CTX_VERBS`, `TIMER_VERBS`.
- **Data flow:** the real fiber ctx + the dispatched package row → a `Proxy` that resolves `ctx.get(name)`, whitelisted lifecycle verbs, and declared services → each service is itself proxied (`guardedService`, `guardedSlots`, `guardedTheme`).
- **Non-obvious design decisions:**
  - **Service methods are forwarded with the *service* as receiver, not the caller** (`Reflect.apply(value, target, args)`), because `SlotRegistry.register` must stay a prototype method so `this.ctx` binds to the **calling** plugin's fiber — that is what routes the effect and the unload cascade into the caller (`guard.ts:70-80`, and the host catalog repeats the same warning at `api-catalog.ts` `slots.register`).
  - **The `theme` seat pins `source`** to `"<pluginId>.<packageId>"` regardless of what the caller passes, so a dynamic package can never impersonate or evict another source's token layer; the layer's disposer is additionally hung on the calling fiber *and* returned, because "model code cannot be trusted to keep the returned handle" (`guard.ts:173-199`).
  - **A service that returns a cordis `Context` is denied** — synchronously and after `await` — because `ctx.escape()` is the classic route out of the façade (`guard.ts:56-67`).
  - **Shadowing priority is assigned automatically** (`--this.nextPriority`, so later registrations sort first = newest wins) for every slot kind **except `chain`**, whose election is deliberately left alone (`guard.ts:126-135`).
  - The `has` trap mirrors the `get` trap exactly, so `'slots' in ctx` and `ctx.slots` agree (`guard.ts:224-231`).
- **Edge cases & failure handling:** every rejection goes through `rejectGuard()`, which **reports the failure to the owning Agent and then throws** — the model learns of the refusal even though the call fails.
- **Surprising:** the object-form plugin's own `inject` is the *declaration site*; the function form has none, so it reaches **no service at all** — the error message teaches this explicitly.

### `packages/extensions/cordis-client-runner/src/client/runtime.ts`
- **Purpose:** the per-package browser lifecycle engine — evaluate → guard → seat in the module table → create a loader entry, so a *dynamic* package rides the exact machinery a *static* plugin does.
- **Key abstractions:** `DynamicCordisPackageRunner` (the engine), `CordisObservable<T>` (`getSnapshot`/`subscribe` with a **stable reference between mutations**), `DynamicCordisLoadResult`, `DynamicCordisLoadErrorCause` (`'evaluate' | 'module-import' | 'activate'`), `DynamicCordisRenderFailure`, `errorDetails()`.
- **Data flow:** `load(half)` → per-plugin serial queue → `evaluateClientHalf` → `modules.invalidate(moduleId)` → `window.__ModuleLoader__.load({id, factory})` → `loader.create({name})` → `fiber.await()` → seat the `LivePackage` record → publish a snapshot.
- **Non-obvious design decisions:**
  - **Convergence is by live state, not by history:** loading the *same* `pluginRunId` is a no-op **that still answers** (`ok: true`) so a replayed run never looks unacknowledged; a *newer* run replaces it; the same package after a retract loads afresh (`runtime.ts:246-256`).
  - **The queue tail must survive a failed operation**: `this.queues.set(id, next.then(() => {}, () => {}))` — one rejection would otherwise wedge every later operation on that package (`runtime.ts:281-289`).
  - **Ownership is keyed by component identity in a `WeakMap`**, and the comment enumerates why every alternative fails: `entry.registrant` is package-supplied (impersonable), the shadowing priority is absent on chain entries, and a parallel entry ledger would drift (`runtime.ts:198-215`).
  - **A parked package is a success**: `waitingFor` lists the declared services this page has not got; the load answers `ok: true` with `waitingFor` (`runtime.ts:360-366`).
  - **Teardown waits for the fiber's disposal** before invalidating the module factory, so a cleanup effect that calls back into the host still works (`runtime.ts:395-410`).
- **Edge cases & failure handling:** three distinct failure causes are reported; an `evaluate` failure disposes the styles it created (no leaked `<style>` tags); a missing `window.__ModuleLoader__` throws a message that says "booted outside the web shell?"; a load that throws *after* the entry is created tears the entry down first.
- **Surprising:** the render-crash message is **rewritten**: `"your entry in slot \"root\" crashed while React rendered it: …"`, plus the withheld-global redirect when the crash text names one, and never twice (`runtime.ts:437-450`).

### `packages/extensions/cordis-client-runner/src/client/orchestrator.ts`
- **Purpose:** page-side run orchestration — model approvals and direct panel gestures, in one place, with Plugin-keyed state so a remounted panel never loses an open approval.
- **Key abstractions:** `CordisRunOrchestrator`, `CordisRunActivity` (`'awaiting-approval' | 'orchestrating'`), `CordisRunFailure` (`'host-half-failed' | 'client-half-failed'`), `CordisRunHostSeam`, `CordisUserRunRequest`.
- **Data flow:** `cordis/request-run` → `open()` → (if `requiresApproval`) an `awaiting-approval` activity, else automatic orchestration → `approve`/`decline`/`startUserRun` → `drive()` = **host half first, then source fetch, then browser half, then one resolution**.
- **Non-obvious design decisions:**
  - **Host half first, always** — so a host-half failure short-circuits before the browser has moved (`orchestrator.ts:317-324`).
  - **One in-flight run per plugin**: a second `approve`/`startUserRun` *joins* the promise already in flight rather than starting a second (`orchestrator.ts:264-276`).
  - **`decline` is refused once the definition is already `orchestrating`** — a refusal would contradict a decision already made (`orchestrator.ts:238-245`).
  - **The activity keeps the `agentId` even after the decision is made**, so a run never falls out of its session group while it is still executing (`orchestrator.ts` `drive` sets `phase: 'orchestrating'` with `agentId`).
  - `reconcileApprovals(rows)` rebuilds pending approvals from an **authoritative host inventory** — this is the reconnect/missed-event recovery path.
- **Edge cases & failure handling:** a transport rejection of the host verb is folded into the verb's own failure shape (`host-half-failed`); a refused answer is logged and dropped, because the host settles the request either way; a non-`Error` rejection is stringified.
- **Surprising:** a **host-only** definition (`hasClientHalf: false`) still publishes an `orchestrating` activity and can still fail — folding that into `client-half-failed` would "report a run that succeeded as a failure of a half the definition never had".

### `packages/extensions/cordis-client-runner/src/client/index.ts`
- **Purpose:** the plugin entry — wires the runner, the orchestrator, the inspect registry, the timer service and the forwarded Host events into one `apply(ctx)`.
- **Key abstractions:** `CordisRunnerFace` (the service surface a UI reads: `activeRuns`, `lastRunError`, `renderFailures`, `reconcileApprovals`, `approve`, `decline`, `startUserRun`, `subscribe`, `getSnapshot`, `isLoaded`), `invokeFailure()`, `wireFailure()`.
- **Data flow:** `ctx.remote.$on('cordis/request-run' | 'cordis/request-run-resolved' | 'cordis/dynamic-retract' | 'cordis/inspect-query' | 'cordis/inspect-query-resolved')` → orchestrator/runner/inspect; `ctx.provide('dynamicCordisRunner', face)`.
- **Non-obvious design decisions:**
  - **The service face is a thin re-export of three observables** — the "activity map is the single home of 'a run is in flight', so an affordance never keeps its own copy — that is what makes it survive a remount" (`index.ts:66-72`).
  - **`renderFailures` is page-local and current**; the host keeps its own last-across-pages copy for the model; the two have different owners and lifetimes and **neither is derived from the other** (`index.ts:87-99`).
  - **Two failure layers are taught differently**: the carrier's error branch means the call never reached the host half; the namespace's own `ok:false` is that half *answering with a refusal* (`index.ts:206-214`).
  - **Render-failure reporting is deliberately fire-and-forget** — "the run this package belongs to was answered before it ever rendered, so nothing waits on this and a failed report must not turn one crash into two" (`index.ts:217-224`).
  - The plugin declares `inject: ['loader','modules','slots','remote','remote.dynamicCordisRunner']` — declaring the namespace **parks the plugin until the host side exists**, so a page never loads a browser half whose host half it could never reach.
- **Edge cases & failure handling:** `wireFailure()` adds the *call* and the *contract* to the codec's bare field-name refusal ("the model authored both halves").

### `packages/extensions/cordis-client-runner/src/client/inspect-registry.ts`
- **Purpose:** browser-side registry for read-only Cordis capability providers, a manifest publisher, and a live query dispatcher.
- **Key abstractions:** `ClientCordisInspectRegistry`, `ClientCordisInspectHost` (a two-method transport seam: `sync`, `resolve`), `ClientCordisInspectProviderRegistration`.
- **Data flow:** providers register → `publish()` coalesces into a microtask → the complete manifest is synced to the host over a **chained promise** (`syncChain`) so two publishes cannot interleave → a host-broadcast query is dispatched to the local provider → the first accepted page wins.
- **Non-obvious design decisions:**
  - **Publish is coalesced, sync is serialized** — `publishQueued` collapses bursts into one microtask; `syncChain` guarantees order (`inspect-registry.ts:76-92`).
  - **The provider manifest is the contract**: method names are checked for duplicates at registration, and the query dispatcher *re-checks* the method against the manifest before calling it, answering `method-missing` rather than throwing.
  - **First page wins**: `if (this.active.has(request.requestId)) return` — a duplicate broadcast is dropped, and `close(requestId)` aborts the local `AbortController` when another page answered.
- **Edge cases & failure handling:** a missing provider answers `{ok:false, reason:'provider-missing'}`; a provider that throws answers `provider-error`; an aborted query answers `cancelled` and is **not sent** at all; a failed `sync` is logged and swallowed so one bad publish cannot wedge the chain.
- **Surprising:** the manifest is replaced **completely** on every publish, not merged — the host always holds the true current set.

### `packages/extensions/cordis-client-runner/src/client/providers.ts`
- **Purpose:** the first-party Client inspect providers — Service, Event, Builtin, Slots, Theme.
- **Key abstractions:** `clientInspectProviders(ctx)`, `CLIENT_BUILTIN_INSPECTION`, `compactSlotTree()`, `inspectLiveSlot()`, `inspectSlotCatalog()`.
- **Data flow:** a query arrives with a method + input → the provider resolves the live service off `ctx` → a compact tree or an exact catalog entry.
- **Non-obvious design decisions:**
  - **Progressive disclosure**: the provider description says "compact directory, then one exact coding contract" — `queryServiceApi(undefined)` returns only `key + description + method signatures`; naming an exact service returns the full contract **plus only the transitively referenced type declarations** (`providers.ts:91-137`).
  - The **Slots** provider is hand-written (not the `registration()` helper) because it reads the live registry and must project a *discriminated* `slot | factory` tree.
  - The `tool.view.cordis` slot's key domain is **overridden** by the guard's own rule ("only accepts key 'self'") — the catalog's declared key domain is replaced by what the guard actually enforces (`providers.ts:180-190`).
- **Edge cases & failure handling:** a service that is not running throws a named error ("Client Slots service is not running") instead of returning an empty tree.

### `packages/extensions/cordis-client-runner/src/client/timer.ts`
- **Purpose:** the browser implementation of the Cordis timer service, API-compatible with the Host `TimerService`.
- **Key abstractions:** `ClientTimerService` (extends `Service`), `provideClientTimer(ctx)`.
- **Data flow:** `ctx.mixin('timer', ['timeout','interval','throttle','debounce','setTimeout','setInterval'])`; every timer is registered as a `ctx.effect` so it is disposed with the **calling fiber**.
- **Non-obvious design decisions:** `timeout(delay)` returns a promise that **rejects with "Context has been disposed"** when the fiber dies — a pending promise cannot hang forever (`timer.ts:104-110`). `interval(delay)` returns a real `AsyncIterableIterator` whose `return`/`throw` dispose the timer. `throttle`/`debounce` return the wrapper with a `.dispose` property.
- **Edge cases & failure handling:** the file is full of targeted `oxlint-disable` comments explaining that the `any` positions mirror the Host's **overload erasure** — the browser half must not narrow the public API.
- **Surprising:** `setTimeout`/`setInterval` are kept as **deprecated** aliases.

### `packages/extensions/cordis-client-runner/src/client/api-catalog.ts` (generated data, 75 KB / 1174 lines)
- **Purpose:** the machine-readable catalog `cordis_inspect` serves to the model — every harness service, every event, every referenced type, plus the inherited `ctx` API.
- **Key abstractions:** `SERVICE_API`, `EVENT_API`, `TYPE_API`, `INHERITED_CTX_API`, `queryServiceApi(key?)`, `queryEventApi(name?)`.
- **Data flow:** the generator's AST walk produces this file; `queryServiceApi` projects it into either `{mode:'catalog'}` (signatures only) or `{mode:'service'}` (full contract + `referencedTypes` closure).
- **Non-obvious design decisions:** `referencedTypeClosure(seeds)` walks the type graph **transitively** but only from the *signatures*, so one exact service brings only the types it actually mentions — never the whole graph (`api-catalog.ts:1058-1072`).
- **Surprising:** the header says "Generated by scripts/gen-cordis-inspect-catalog.ts — do not edit by hand … freshness-gated by `pnpm run verify-cordis-inspect-catalog` in doc-sync" — **the same AST walk produces the rendered docs, so data and docs cannot diverge**.

### `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` (generated data, 273 KB / 4902 lines)
- **Purpose:** the compile-time contract of the shipped web bundle's slot surface — every slot a browser half can register into, what the register call must pass, what the component receives, who already occupies the seat, and `replaceRisk`.
- **Key abstractions:** `ClientSlotEntry`, `ClientSlotOption`, `CLIENT_NOTES`, `CLIENT_SLOT_API`.
- **Data flow:** `gen-client-catalog.ts` → this file → `providers.ts`'s `compactSlotTree`/`inspectSlotCatalog` → the model's `Slots.listSubTree` answer.
- **Non-obvious design decisions:** each entry carries a **runnable `example`** (a minimal browser half that registers into that slot) and a `source` pointer (`packages/client/ui-workspace/src/client/contract/toast.ts:53`). `replaceRisk: 'shadows-shipped-ui'` tells the model that registering there *replaces* shipped UI. `occupants` lists who already holds the seat, and `keyDomain` names the keys already taken.
- **Reading note:** the head and tail were read in full; the body is generated data of one repeated shape, so it was characterised rather than read line by line.

### `packages/extensions/cordis-client-runner/src/index.ts`
- **Purpose:** the node half — an empty `apply()` so the row appears in the host `cordis.yml` / Loader, while the browser half ships through `exports["./client"]`.

---

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/extensions/README.md` | Package-group index: the four extensions packages and their `ctx` keys; notes the browser halves live here because they are halves of dual-half packages. |
| `packages/extensions/README.zh.md` | Chinese mirror of the above (bilingual pair enforced by the i18n hash file). |
| `packages/extensions/cordis-client-runner/README.md` | The package contract: what the page does, the run surface, lifecycle boundaries (loading is idempotent, a refresh starts clean by design), the source map, and the "Model Experience" section (token effect / KV-cache effect of each outcome). |
| `packages/extensions/cordis-client-runner/README.zh.md` | Chinese mirror. |
| `packages/extensions/cordis-client-runner/locale/en.json` | Locale title. |
| `packages/extensions/cordis-client-runner/locale/zh.json` | Locale title + description. |
| `packages/extensions/cordis-client-runner/package.json` | Package manifest: `./client` export, `dsh.client.inject` list, `platform: web`. |
| `packages/extensions/cordis-client-runner/tests/api-catalog.client.spec.ts` | Pins the split Workspace Controller / UI navigation service signatures, uniqueness of event names, and that `queryServiceApi` returns only the **referenced type closure** (e.g. `PromptContentPart` present, `ConversationSnapshot` absent). |
| `packages/extensions/cordis-client-runner/tests/evaluator.client.spec.ts` | Pins the symbol surface, the timer/fetch/require/harness redirects, `host.call` argument omission → `null`, the parse/return teaching errors, the tagged console (error-only mirror, 500-char truncation), style ownership stamping and disposal. |
| `packages/extensions/cordis-client-runner/tests/guard.client.spec.ts` | Pins the whitelist, the "not declared" teaching, framework-internals withholding, `get`/`has`/`set` behaviour, Context denial, descending shadowing priority, chain-slot priority preservation, factory ledger rows, malformed-register rejection before touching the registry, HMR safety (fiber disposal removes registrations), and the theme seat's pinned source + fiber-owned disposer. |
| `packages/extensions/cordis-client-runner/tests/orchestrator.client.spec.ts` | Pins the host→client ordering, the short-circuit on host-half failure, the failure shapes per stage, idempotence per definition, decline/approve races, the "never downgrade an orchestration to a waiting decision" rule, and the host-only path. |
| `packages/extensions/cordis-client-runner/tests/plugin.client.spec.ts` | Pins the plugin composition: service face provided, forwarded withdrawal event unloads, `host.call` routing + `null` argument, the JSON-contract teaching error, one teaching error per routing failure code, render-crash reporting (and survival of a refused report), and the inert node half. |
| `packages/extensions/cordis-client-runner/tests/runner.client.spec.ts` | Pins load convergence (same run = no-op answer, newer run replaces, parked services replayed), per-plugin serialization, the three failure stages, the three-step teardown, retract of a superseded revision being ignored, and the render-failure rules (one latest per package, cleared on retract/reload, redirect appended once). |
| `packages/extensions/cordis-client-runner/tsconfig.json` | Extends `tsconfig.base.client.json`; project references to the vendored cordis/loader and the client modules/ui-renderer/ui-theme. |
| `packages/extensions/cordis-client-runner/tsdown.config.ts` | One-liner: `clientBundle(dir, ['lib/types/index.js'])`. |

### Tier 3 — skipped with a reason

| File | Why not read line by line |
| --- | --- |
| `packages/extensions/README.i18n.yaml` | Generated bilingual-pair hash record (per-heading SHA of the EN/ZH blocks). Head read; it is a machine file, refreshed by `verify-translation-pairing --write`. |
| `packages/extensions/cordis-client-runner/README.i18n.yaml` | Same generated hash record; head read. |
| `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` (body) | 273 KB / 4902 lines of **generated** slot data (one repeated entry shape). Head (70 lines) and tail (40 lines) read in full; the shape, the `example`/`source`/`replaceRisk` fields and the `CLIENT_NOTES` rules were extracted, but the ~60 middle entries were not read one by one. |

### `packages/extensions/cordis-host-runner/src/guard.ts`
- **Purpose:** the registration boundary between a sandboxed host half and the real runtime — schema normalization + validation with teaching errors, the marker-guarded `harness.defineTool` / `harness.registerTool` pair, the `harness.handle` normalizer, the sandbox `ctx` façade, and the plugin-shape helpers.
- **Key abstractions:** `sandboxDefineTool()`, `sandboxRegisterTool()`, `normalizeHandler()`, `guardedPlugin()`, `isPlugin()`, `pluginName()`.
- **Data flow:** model-written schema → `normalizeParameterSchemaSpec` → host-realm `ParameterSchemaSpec` → `defineTool` → `assertSupportedJsonSchema` → marker-tagged tool. The tool's `execute`/`render` results go through `cloneJson` (a **stack-safe** iterative cross-realm JSON clone) before re-entering the host realm.
- **Non-obvious design decisions:**
  - **The clone is an explicit work-stack, not recursion** (`guard.ts:150-250`) — a deep model-authored object would blow the JS stack in a normal recursive cloner. The clone also **rejects** non-JSON values instead of coercing them, with a message that names the executable next step: "the usual cause is a handler that returns whatever its last call produced, and the fix is one keyword" (`return null`).
  - **`ctx.tools.get` returns a schema view, never the live `ToolDefinition`** — exposing the raw definition would hand package code the tool's `execute` function, letting it call another tool directly and bypass the runtime's identity-protection / pre-policy / monotonic-guard / dispatch / post-policy / final-observation chain (`guard.ts:616-630`).
  - **Every realm-crossing check uses realm-safe predicates**: `isPlainRecord` verifies the prototype is backed by the *native* `Object` constructor, `hasPlainArrayPrototype` does the same for `Array`, and `isSyntaxError` checks `error.name` rather than `instanceof` (a vm-realm `SyntaxError` is not a host `instanceof SyntaxError`).
  - **The `ctx` façade is a whitelist, not a pass-through** — a framework member that exposes an unguarded context is denied, because it would bypass the marker checks and the host-realm normalization.
  - The **host and browser guards are declared duplicates, not a shared module** — the comment says why: "Moving the rule into a shared package would move a security invariant out of the halves that enforce it, which is a design decision rather than a duplication fix" (`guard.ts:545-556`).
- **Edge cases & failure handling:** invalid tool declarations are rejected **before** registration (a table-driven test pins every message); a circular schema is detected and named; `additionalProperties` must be explicitly `true`/`false` in the direct DSL but is defaulted to `true` in the raw JSON-Schema form.
- **Surprising:** `isPlugin()` accepts a bare function — and the comment notes that a bare function passes the first arm, so the object arm never sees `Function.prototype.apply`.

### `packages/extensions/cordis-host-runner/src/index.ts` (1221 lines)
- **Purpose:** `DynamicCordisRunnerService` — the registry, the lifecycle verbs, the approval machinery and the invoke table in **one service**, so a definition's whole life has one owner.
- **Key abstractions:** `DynamicCordisRunnerService` (extends `TypertRemoteService`), `Config` (`vmTimeoutMs`, `clientInspectTimeoutMs`), `DynamicCordisSnapshotRow`, the `@Remote(...)` methods (`runHostHalf`, `getClientCode`, `resolveRequestRun`, `settleUserRun`, `syncInspectManifest`, `resolveInspectQuery`, `reportRenderFailure`, `reportClientGuardFailure`, `invoke`, `inventory`, `stopFromPanel`, `undefineFromPanel`).
- **Data flow:** `define` (trim + precheck + mint ids) → `run` (resolve plan → arm approval → emit `cordis/request-run` → suspend) → a page answers via `runHostHalf` + `getClientCode` + `resolveRequestRun` → `commitActivation` sets `currentPackageId` → `stop`/`undefine` retract and dispose.
- **Non-obvious design decisions:**
  - **Versions are immutable packages.** A plugin holds packages that never change after `define`; `currentPackageId` and `nextPackageId` point at the running and the target version, and `mode: 'run' | 'update'` encodes whether the target equals the current version. A failed update **keeps `currentPackageId` and points `nextPackageId` at the failed target** — the old version stays live (`versioning.spec.ts`).
  - **A failed update rolls back, it does not half-apply**: `startFresh` retracts the old run before starting the new one, and `commitActivation` only runs on a fully successful client resolution.
  - **`mode` misuse is refused with a recipe**: "no successful version yet; start X with mode `run`" / "package X is already current; use mode `run`" / "package X differs from current Y; use mode `update`".
  - **The approval is a *first-claim* record**: `claimRequest` deletes the pending entry, so only the first answer wins; a late/stale answer returns `{accepted:false}` and changes nothing.
  - **`reportRenderFailure` steers the owning session exactly once** — `shouldSteer = run.renderFailure === undefined` — and the host keeps **only the latest** crash per package.
  - **Runtime failures are de-duplicated by a key** (`reportedRuntimeErrors`) so a handler that fails on every call does not flood the session with the same steering message.
  - **Panel gestures inject a *user* message into the session** (`stopFromPanel`, `undefineFromPanel`) — the model's next step learns that the human did something, and the injected text names `currentPackageId`/`nextPackageId` so the model knows the world it now has.
  - **The steering text tells the model what NOT to do**: "Do not request the same activation again unless the user asks." (rejection case) and "Report the failure to the user; the definition can be managed through the Cordis panel."
  - `owned(agent, pluginId)` is the **session-scoping gate** — a plugin is only visible to the session that defined it.
- **Edge cases & failure handling:** `transition-in-flight` when a plugin already has a pending request; `plugin-missing` messages explain "it may have been removed or lost on DSH restart"; `stop` on a not-running plugin returns `not-running`; the `retract` path disposes handler disposers, then the fiber, then emits `cordis/dynamic-retract`.
- **Surprising:** `undefine` is refused for a plugin owned by another session — the error is a *missing* plugin, not "not yours", so the registry does not leak existence.

### `packages/extensions/cordis-host-runner/src/sandbox.ts`
- **Purpose:** the `node:vm` sandbox a host half evaluates in — a fresh realm with a tagged console, `harness` helpers, encoding primitives, and **callable traps** over the Node APIs the sandbox withholds.
- **Key abstractions:** `createSandbox()`, `evaluateHostCode()`, `precheckCode()`, `parseErrorMessage()`, `syntaxErrorContext()`.
- **Data flow:** `precheckCode` compiles (never runs) the source at define time → `createSandbox` builds the context → `evaluateHostCode` runs it in the vm with a `filename` and a `timeout`.
- **Non-obvious design decisions:**
  - **A define-time parse gate, so unparseable code never reaches the registry**: "a model fixes it and defines again instead of discovering the failure at run time" (`sandbox.ts:186-200`).
  - **The TypeScript heuristic is scoped to the offending line only** — "an ` as ` inside an ordinary description string must not turn a plain syntax error into a misleading remove-annotations message" (`sandbox.ts:170-177`).
  - **The bracket-balance hint** teaches the exact shape error the model makes: "a plain `return { … }` ends with `}` (an optional `;`), never `)`."
  - **Data-valued globals stay `undefined` rather than throwing accessors** — a throwing `process` getter "would detonate the common `typeof process` feature probe at resolution time" (`sandbox.ts:76-84`).
  - **The console is write-through, not buffered** — "a registered listener fires long after the run call returned, and its output must land somewhere the user can see" (`sandbox.ts:19-26`).
  - **Dual-realm `instanceof`**: the vm's constructors are patched so `instanceof` accepts both VM and host values; host intrinsics are left untouched (`sandbox.ts:33-56`).
  - **The error text names the cordis alternative** for every withheld API (`require` → `ctx.fs`/`ctx.web`/`ctx.bash`; timers → the `timer` service).
- **Edge cases & failure handling:** `vmTimeoutMs` bounds only the **synchronous** portion; an async body escapes it (an accepted cost under the "treat a dynamic package like bash access" trust stance). A cross-realm `SyntaxError` is detected by `error.name`, not `instanceof`. `btoa`/`atob` are provided (Buffer is absent) so the model can base64 without Buffer.

### `packages/extensions/cordis-host-runner/src/registry.ts`
- **Purpose:** the process-local definition registry and its identity mints.
- **Key abstractions:** `DynamicCordisRegistry`, `DynamicCordisPlugin`, `DynamicCordisDefinition` (immutable package version), `DynamicCordisRun` (one live activation + everything its teardown owns), `DynamicCordisPendingRequest`.
- **Data flow:** `define` → `registry.add` / `plugin.packages.set`; `run` → `armRequest` → `claimRequest`/`disarmRequest`; `stop` → retract → `run` deleted.
- **Non-obvious design decisions:**
  - **Identity mints never reuse a suffix** — `mintPluginId` loops until the id is free, so a semantic prefix (`clock`) yields `clock-1`, `clock-2` and the model sees a readable id.
  - **The plugin record separates `currentPackageId` (last *successful* activation) from `nextPackageId` (failed or in-progress target)** — the two are the whole rollback story.
  - `approvedClientPackages` (per-package) and `clientVersionUpdatesApproved` (plugin-wide) are **two separate grants** — "allow this version" vs "allow future versions of this plugin".
- **Edge cases & failure handling:** `peekRequest` (read without claiming) vs `claimRequest` (first answer wins) are two distinct methods — the difference is load-bearing for the approval race.
- **Surprising:** definitions are **session-scoped**: `ofSession(sessionId)` is what every session-facing read uses.

### `packages/extensions/cordis-host-runner/src/lifecycle.ts`
- **Purpose:** host-half fiber lifecycle under the `cordis-dynamic` group — settle a sandbox-produced plugin as a child fiber, and report the services a settled-but-pending fiber waits for.
- **Key abstractions:** `startHostHalf()`, `missingServices()`.
- **Data flow:** `group.await()` → `group.ctx.plugin(guardedPlugin(...))` → `fiber.await()` → on failure `fiber.dispose()` then rethrow.
- **Non-obvious design decisions:**
  - **A failed startup never leaves a failed fiber mounted** — it is disposed before the error is rethrown.
  - **The "already registered" collision gets a recipe**, not just the raw error: "to REPLACE something an earlier dynamic package registered, first stop that package through its runner or the Cordis panel before running the new version" (`lifecycle.ts:35-40`).
  - **Stopping needs no helper** — a host half unwinds through an ordinary awaited `fiber.dispose()`, "because everything the plugin registered is an effect on its fiber".
- **Edge cases & failure handling:** a settled-but-not-active fiber is *legal* cordis semantics — it activates when the service appears; `missingServices` names what it is waiting for.

### `packages/extensions/cordis-host-runner/src/inspect-registry.ts`
- **Purpose:** the host registry for model-visible read-only capability queries, plus the cross-page router for client queries.
- **Key abstractions:** `CordisInspectRegistryService`, `HostCordisInspectProviderRegistration`, `HostCordisInspectQueryContext`.
- **Data flow:** register a host provider → `list()` returns host + mirrored client providers → `query(platform, provider, method, input, agent, signal)` validates the input against the method's JSON Schema, runs it, validates the output, and snapshots it.
- **Non-obvious design decisions:**
  - **Client queries have a bounded wait with a *useful* timeout message**: "Client inspect query X.Y timed out after Nms. Open or reconnect the Harness page, then retry." or, if a page failed, "Client failure: <first diagnostic>" (`inspect-registry.ts:236-247`).
  - **The first failure diagnostic is retained** (`pending.failure ??= …`) and later pages may still win — "a failed page must not prevent another page from supplying a valid result."
  - **The Gateway is checked before dispatch**: no connected client ⇒ a named refusal, not a 10-second wait.
  - **The deadline is *not* extended by a disconnect** — "queries already dispatched retain their original deadline."
  - **Output is validated against the method's own `outputSchema`** and then snapshotted (`snapshotJsonValue`) so a non-JSON value is refused.
- **Edge cases & failure handling:** cancelling removes the timer and the abort listener; the registry's disposal settles every pending query as `cancelled`; a response from another agent is ignored *without* retaining its error.

### `packages/extensions/cordis-host-runner/src/types.ts`
- **Purpose:** the client-safe wire vocabulary for the whole dynamic-plugin subsystem.
- **Key abstractions:** the branded ids (`CordisDynamicPluginId`, `CordisDynamicPackageId`, `CordisDynamicPluginRunId`, `ApprovalRequestId`, `CordisInspectRequestId`), `CordisRunStatus` (9 states), `CordisHalfState`, `CordisRunDiagnostic` (6 phases), `DynamicCordisRunAttempt`, `DynamicCordisRunResponse`, `DynamicCordisInvokeResult` (4 error codes), and the `cordis/*` event declarations.
- **Non-obvious design decisions:**
  - **The run attempt is retained independently of the physical run** — `latestRun` survives a stop, so the panel can still show *why* the last attempt failed after the run is gone.
  - **Every response type is a discriminated union with an explicit `reason` vocabulary** (`plugin-missing`, `package-missing`, `invalid-mode`, `transition-in-flight`, `host-half-failed`, `client-half-failed`, `rejected`, `cancelled`, `not-running`) — no free-text failures.
  - **`CordisInspectResolveAck.accepted` is documented precisely**: "true only for a valid success that settles the query; false for retained failures and unknown, timed out, cancelled, or late answers."
- **Surprising:** the events are declared on `Context['Events']` with a `@mode emit` tag — the same catalog that the *model* reads is generated from these declarations.

### Tier 2 — bulk (host runner + tool-cordis + ui-cordis)

| File | What it is / what it pins |
| --- | --- |
| `packages/extensions/cordis-host-runner/README.md` | The host contract: config table (`vmTimeoutMs` 5000, `clientInspectTimeoutMs` 10000), the client-inspection timeout policy, what a run does (`define`/`run`/`stop`/`undefine`), "definitions are session-scoped and process-local", and the **trust stance**: "the sandbox isolates globals but is not a security boundary … Treat a dynamic package like bash access". |
| `packages/extensions/cordis-host-runner/README.zh.md` | Chinese mirror of the host contract. |
| `packages/extensions/cordis-host-runner/locale/en.json` | Locale title. |
| `packages/extensions/cordis-host-runner/locale/zh.json` | Locale title + description. |
| `packages/extensions/cordis-host-runner/package.json` | Manifest: `./types` (client-safe), `./typert`, `./remote` subpaths; `zod` is declared even though no `src` file imports it (the generated Typert faces need it). |
| `packages/extensions/cordis-host-runner/tests/helpers.ts` | The spec harness: a real `SystemPrompt` + `ToolRegistry` + timer tree, a **recording gateway** whose fake browser answers exactly the way the real client runner does ("nothing here is a shortcut through the host's own verbs, so the round trip under test is the real one"), plus `AGENT_A`/`AGENT_B` and the model-written code fixtures. |
| `packages/extensions/cordis-host-runner/tests/composition.spec.ts` | Pins cross-package provide/inject: the consumer activates immediately when the provider is first, stays **parked** (a successful run) when the provider is missing, the provider's stop sends the consumer back to pending, re-running the provider re-runs the consumer through a fresh guard, a duplicate provide fails loud leaving the second package not running, and **stop reaches quiescence** (the listener is gone by the time `stop` returns — "no grace period, no eventual consistency"). |
| `packages/extensions/cordis-host-runner/tests/versioning.spec.ts` | Pins the version model: a failed update keeps `currentPackageId` and points `nextPackageId` at the failed target; aborting the asking turn cancels the approval; **an attaching page that fails to load the client half does not stop the host run**. |
| `packages/extensions/cordis-host-runner/tests/runner.spec.ts` | Pins the runner chain on a real cordis tree: definitions are recorded without running, ids are never reused, unparseable code stays out of the registry, another session's definition is hidden, host-only packages start immediately, the first answer settles the request, a second concurrent page shares one activation, the client source goes only to the owning session and only while it runs, and undefine forgets the definition. |
| `packages/extensions/cordis-host-runner/tests/sandbox.spec.ts` | Pins the vm contract: isolated globals, no `process`/`Buffer`, global writes do not leak to the host, the cordis timer service is usable, `btoa`/`atob` exist, dual-realm `instanceof` works, `vmTimeoutMs` is honoured for the synchronous part, a `null` throw is not misclassified as a syntax error, and the parse failures carry the TypeScript-removal / bracket-balance teaching. |
| `packages/extensions/cordis-host-runner/tests/sandbox-context.spec.ts` | Pins the façade's escape surface: `ctx.root.tools.register` bypasses nothing and fails loud, assignment is rejected, a service returning a `Context` is denied (sync and async), the `in` operator answers without throwing, an undeclared live service names the inject fix, optional services pass through `ctx.get`, a cross-package consumer must declare the provider, and `ctx.tools.get` returns a *schema*, not the live definition with `execute`. |
| `packages/extensions/cordis-host-runner/tests/inspect-registry.spec.ts` | Pins the client-inspect deadline: no dispatch without a connected client, the deadline survives a disconnect, the first failure is reported at the deadline, a later successful page wins, the first failure is kept, output-validation errors are retained for the timeout message, another agent's response is ignored, a retry is accepted after publication, cancellation removes the timer and the abort listener, and disposal settles every pending request. |
| `packages/extensions/cordis-host-runner/tsconfig.json` | Project references for the host build. |
| `packages/extensions/tool-cordis/README.md` | The two read-only tools (`cordis_inspect_list`, `cordis_inspect_query`); the **Config** provider pages the live Loader tree (`offset`/`limit` ≤ 100, `total`/`nextOffset`) and projects one entry's native Config into a self-contained JSON Schema 2020-12 document; "Inspection cannot invoke service methods, configure plugins, or execute generated code." |
| `packages/extensions/tool-cordis/README.zh.md` | Chinese mirror of the tool contract. |
| `packages/extensions/tool-cordis/locale/en.json`, `locale/zh.json`, `locale/host/en.json`, `locale/host/zh.json` | Locale titles for the tool and the host entry. |
| `packages/extensions/tool-cordis/package.json` | Manifest: a `.` (preset row) and a `./host` (process-global provider registration) entry point. |
| `packages/extensions/tool-cordis/src/index.ts` | Registers the two tools. The tool **descriptions are the prompt**: "Call this Tool before writing or configuring a plugin … Do not guess names or treat an Inspect method as a business Service that Plugin code can call." |
| `packages/extensions/tool-cordis/src/host.ts` | The process-global provider row; "the registry keys providers by id and rejects a duplicate, so this row belongs to the host composition … every per-session `tool-cordis` row reads the shared set through its tools." |
| `packages/extensions/tool-cordis/src/providers.ts` | The four host providers: Service, Event, Config, Tool. The Event provider **filters out `cordis/*`** (those are the subsystem's own events, exposed elsewhere). |
| `packages/extensions/tool-cordis/src/config.ts` | Live Config discovery from the Loader tree. The `ConfigStatus` vocabulary is five-valued: `schema` / `absent` / `unsupported` / `tree` (a group/include carrier) / `inactive` (disabled, never imported, or disposed) — and "a plugin whose `apply` failed keeps its fiber and still reports its Config". |
| `packages/extensions/tool-cordis/src/present.ts` | Replay-safe `GenericCallView` intents for the two tools. |
| `packages/extensions/tool-cordis/tests/config.spec.ts` | Pins the Config directory: every live entry with its loader id, patch id and status; paging and name filtering; malformed fields rejected; a disabled plugin reads as `inactive`; one entry's package dir + projected schema; and "a Host composed without a Loader" is a named refusal. |
| `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` | Direct regressions for the **vendored cordis ownership substrate**: effect visibility under a reentrant owner restart, rollback of collected cleanup when setup throws, async rollback awaited on a sync failure, single-shot disposers, cleanup-time registration refused during a restart unload, registration legal while children are PENDING/LOADING, and child-publication ownership rollback. |
| `packages/extensions/tool-cordis/tests/host.spec.ts` | The host entry registers the first-party providers once and withdraws them on disposal. |
| `packages/extensions/ui-cordis/README.md` | The UI contract: the panel is **frame-wide and never filtered by session** (the current session's rows group first); a row shows **two independent facts** — what the host runs and what this page has loaded — mapped onto one status marker; a pending request the last read does not cover still gets a row built from the request's own fields; the define card is a *record*; the run card hosts the package's own `tool.view.cordis` business view. |
| `packages/extensions/ui-cordis/README.zh.md` | Chinese mirror of the UI contract. |
| `packages/extensions/ui-cordis/package.json` | Manifest: `./client` export, eight client-side injects. |
| `packages/extensions/ui-cordis/locale/en.json`, `locale/zh.json` | Locale titles. |
| `packages/extensions/ui-cordis/src/index.ts` | Empty node half. |
| `packages/extensions/ui-cordis/src/css-modules.d.ts` | Ambient declarations for `*.module.css`. |
| `packages/extensions/ui-cordis/src/client/index.ts` | The plugin entry: registers the dictionaries, the `CordisDynamicPort` seam (stop/remove/inventory over the Remote namespace), the inventory store, the run-card registry, and the slot registrations (`sidebar.footer.action`, three keyed `tool.call.toolview` rows). It also **reconciles pending approvals from the inventory** after every read, and on `connection/reset` it resets *and* refreshes the inventory. |
| `packages/extensions/ui-cordis/src/client/inventory.ts` | The single-flight inventory read. Rows are **re-read, never patched** ("the wire announcements carry no labels and a definition can appear or disappear between them — a patch-in-place cache would drift"). A failed read **keeps the rows it had and says why** ("dropping the rows would turn a transient wire failure into 'nothing is defined'"). A `generation` counter discards a stale read's answer after a reconnect. |
| `packages/extensions/ui-cordis/src/client/card-model.ts` | Replay-stable view models derived from the **frozen call/result slice**. A truncated argument stream degrades to `null` rather than dropping the row; an `interrupted` error code is a distinct `stopped` state; the error summary is the **first line** of the output. |
| `packages/extensions/ui-cordis/src/client/status.ts` | The three visible readings (`idle` / `client-pending` / `running`) derived from the host inventory plus this page's live set. |
| `packages/extensions/ui-cordis/src/client/slots.ts` | The injected faces (`CordisCardFace`, `CordisRunCardFace`, `CordisPanelFace`) and the `tool.view.cordis` slot declaration (`kind: 'keyed'`, `scope: 'session'`). |
| `packages/extensions/ui-cordis/src/client/run-card-index.ts` | The per-session business-view ownership index: "only a greater log sequence can replace it" — so a newer successful run card supersedes an older one. |
| `packages/extensions/ui-cordis/src/client/locales.ts` | The bilingual dictionary (zh + en, 60+ keys) with a `satisfies Record<CordisKey, string>` check on both sides — a missing key is a compile error, not a runtime blank. |
| `packages/extensions/ui-cordis/src/client/dynamic-port.ts` | The RPC seam kept outside React, and the `CordisActionResult` union. |
| `packages/extensions/ui-cordis/src/client/events.ts` | The client-safe type re-exports. |
| `packages/extensions/ui-cordis/src/client/CordisPanel.tsx` (507 lines) | The frame-wide panel: sidebar-footer badge (running + waiting count), a fixed list above the footer, per-session grouping, a version picker, approve/decline/run/stop/remove/retry/rollback controls, `useDismissOnOutsidePointer`, and a `visibleRequests` ref that tracks which approvals the panel has *shown* so a newly-arrived request is announced. |
| `packages/extensions/ui-cordis/src/client/CordisRunRow.tsx` | The `cordis_run` card: renders the business view from the `tool.view.cordis` keyed slot, detects a **superseded** card by comparing the index's `callId`/`seq`, and shows the render failure inline. |
| `packages/extensions/ui-cordis/src/client/CordisDefineRow.tsx` | The read-only `cordis_define` card with Host/Client source tabs (`CodeBlock` + `DisclosureRow`), the brand accent on the editable source, and a `data-terminal` attribute for the failed/stopped state. |
| `packages/extensions/ui-cordis/src/client/CordisActionRow.tsx` | The `cordis_stop` / `cordis_undefine` cards. |
| `packages/extensions/ui-cordis/src/client/CordisPreparingRow.tsx` | The argument-free preparing row shared by the three card families — one non-expandable row, no package identity, no inventory read. |
| `packages/extensions/ui-cordis/src/client/CordisDefineRow.module.css` (296 lines) | The define card's chrome: title/chevron in the business accent, a terminal state variant, the source tabs with an `::after` active marker and a `:focus-visible` ring. |
| `packages/extensions/ui-cordis/src/client/CordisPanel.module.css` (360 lines) | The sidebar badge and the fixed panel above the footer, including a `rail` variant for a collapsed sidebar. |
| `packages/extensions/ui-cordis/src/client/CordisRunRow.module.css` (134 lines) | The run card's status colours keyed on `data-cordis-status` (`awaiting-approval` / `client-pending` / `running` / `failed`). |
| `packages/extensions/ui-cordis/tests/card-model.client.spec.ts` | Pins the define/action card models: name + purpose + both code halves off the call arguments, the minted id from the result presentation meta, read-only when the meta carries no usable id, a truncated argument stream degrading instead of dropping the row, the raw first line as the name fallback, and the call head cut by the event window. |
| `packages/extensions/ui-cordis/tests/inventory.client.spec.ts` | Pins the inventory store: starts unread, single-flight, keeps the rows on a failed read, reports a non-`Error` rejection without inventing a message, forgets everything on reset ("the next host may be a new process"), and discards a stale read's answer *and its failure* after a reconnect. |
| `packages/extensions/ui-cordis/tests/status-icons.client.spec.tsx` | Pins the failure glyphs: the code glyph is retained for define/run failures and for interrupted calls, and a **dashed** glyph is used when a successful run receipt later reports an activation failure. |
| `packages/extensions/ui-cordis/tests/versioning.client.spec.ts` | Pins the versioned card models, the run-card ownership index (greatest session log sequence wins) and the three visible statuses (host-only running vs client pending vs fully loaded). |
| `packages/extensions/ui-cordis/tsconfig.json`, `tsdown.config.ts` | Client build config. |

### Tier 3 — skipped with a reason (extensions group)

| File | Why not read line by line |
| --- | --- |
| `packages/extensions/cordis-host-runner/README.i18n.yaml` | Generated bilingual-pair hash record; head read. |
| `packages/extensions/tool-cordis/README.i18n.yaml`, `packages/extensions/ui-cordis/README.i18n.yaml` | Generated bilingual-pair hash records; head read. |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | 624 KB / 8960 lines of **generated** service/event/type data (`gen-cordis-api.ts`, freshness-gated by `verify-cordis-api`). Head (60) and tail (25) read; the shape and the `queryServiceApi`/`queryEventApi`/`referencedTypeClosure` projection are the same as the client-side twin, which was read in full. |

---

# `packages/host/*` — the OS-facing adapters

### `packages/host/directory-picker/src/index.ts`
- **Purpose:** the `ctx.directoryPicker` **seam**: a service contract for "how does the operator pick a workspace directory", with a *discriminated capability* rather than one method set.
- **Key abstractions:** `DirectoryPicker` (abstract `Service`), `DirectoryPickerCapabilities` (a **merge-extensible map** keyed by capability kind), `DirectoryPickerCapability` (the derived union), `DirectoryPickerError` with the closed code set `directory-unreadable | directory-exists | directory-create-failed`.
- **Non-obvious design decisions:**
  - **Backends differ in interaction *shape*, not just mechanism** — hence a union, not a method set. Consumers switch on `capability().kind`; "the documented default for an unknown kind is to hide the picking affordance rather than fail" (`index.ts:11-16`).
  - The capability map is **declaration-merging**: a new backend adds its shape to the map rather than editing this package.
  - The capability object **must be stable for the service lifetime** — consumers may capture it across calls.
- **Edge cases:** one implementation per context (a second load throws, cordis' standard duplicate-service behaviour).

### `packages/host/directory-picker-browse/src/index.ts`
- **Purpose:** the in-app browse backend — one-level listing and child-directory creation over Node's stdlib.
- **Key abstractions:** `BrowseDirectoryPicker`, `fullyQualified()`, `boundedInsert()`, `raceAbort()`.
- **Non-obvious design decisions:**
  - **The listing is streamed into a name-sorted bounded window** (`maxEntries + 1`), so memory stays O(keep) "regardless of how many children the directory holds", and the `+1` slot lets an in-window extra row prove the cut. `boundedInsert` does an **O(1) reject** for a candidate past the tail and an **O(log keep) binary insertion** otherwise — "100k children against a 1,001 window must not approach 10^8 comparisons" (`index.ts:81-110`).
  - **A wire path is never rebased under the process cwd.** `fullyQualified()` is stricter than `isAbsolute` on Windows: drive-less rooted forms (`\foo`, `/foo`) and incomplete UNC prefixes pass `isAbsolute` yet still resolve against the *current drive* — so they are refused.
  - **Every filesystem await races the caller's signal** (`raceAbort`), and an abandoned `opendir` that still mints a handle is closed so a departed caller cannot leak a descriptor.
  - A window candidate that turns out non-enterable (broken symlink) is **not backfilled** from beyond the window — the eviction already marks the level truncated, "which stays the honest answer".
- **Edge cases:** symlinks to directories are followed; broken and cyclic links are skipped; creation is non-recursive and rejects any name that is not a single segment.

### `packages/host/directory-picker-auto/src/resolve.ts` + `src/probe.ts`
- **Purpose:** a **pure** boot-time decision: native or browse, from sampled host facts.
- **Non-obvious design decisions:**
  - `native` requires **every** signal — no remote-authority trust, a loopback bind, no SSH launch, and a servable display — and **anything ambiguous resolves to `browse`**, "which works everywhere" (`resolve.ts:53-68`).
  - A blank env export counts as **unset** (shell convention).
  - The PATH probe for `zenity`/`kdialog` is injected as a predicate, so an attended Linux host without a chooser keeps the working browse interaction "instead of a backend whose every pick fails".
- **Edge cases:** the sample happens **exactly once per boot**, so the mounted capability stays stable for the service lifetime, as the seam requires.

### `packages/host/open-in-app/src/resolver.ts` + `src/catalog.ts` + `src/index.ts`
- **Purpose:** resolve installed editors / Git GUIs / terminals / file managers to **verified** launchers, and serve them as three `webServer` routes.
- **Key abstractions:** `OpenInAppLocator` (a closed union: `fixed | app | xcode | cli | file | scan | appPaths | installRecord`), `OpenInAppLaunch` (`argv | shell-open`), `OpenInAppResolvedLaunch`, `launchDetachedApp`, `parseRegistryDump`, `parseDesktopEntry`.
- **Non-obvious design decisions:**
  - **Every locator resolves to an artifact this host actually holds** — "never a bare install record". A Windows `App Paths` hit is accepted only when the registered target exists on disk; an Uninstall record is verified through the executable it points at.
  - **PATH names resolve in-process** (PATH/PATHEXT stat, no shell, no `which`) — so a Linux entry never spawns a lookup.
  - **The Windows registry is read at most once per pass** and shared across entries (a `RegistryViewOnce` holder).
  - **The catalog resolves lazily, once per plugin life**, into one map of verified launchers: "a click, menu open, or page reload never re-runs detection". A launch that finds its executable gone (`ENOENT`) invalidates that one entry and re-resolves it once.
  - **Security has one home, in `index.ts`**: every route asks the connection service for a rejection first (Host/Origin fence against DNS rebinding), and the open route validates its body at the wire (JSON media type, 64 KiB ceiling, string fields, a resolved-available catalog id, an absolute path naming an existing directory).
  - **Launches get a credential-scrubbed environment** and their declared Windows visibility policy; `shell-open` goes through the OS shell's open verb rather than a direct spawn, because that is the channel the file managers use.
- **Edge cases:** a failed launcher is a 502; an empty catalog on a platform with no entries is a 200 with no apps; an icon extraction failure resolves `null` and the icon route answers 404.

### `packages/host/webserver/src/index.ts` + `src/injections.ts`
- **Purpose:** the HTTP transport — named routes, upgrade routes, index transforms, one fallback seat. "It knows no harness concepts and serves no files."
- **Key abstractions:** `WebRoute` (`kind: 'exact' | 'prefix'`), `WebUpgradeRoute`, `IndexInjection` (a **typed row union**: `global | script | script-src | script-preload | style | html`), `renderIndexInjections()`, `isLoopbackHost`, `isWildcardHost`.
- **Non-obvious design decisions:**
  - **Route matching is fixed:** exact over the whole table, then longest prefix, then the fallback handler.
  - **The injection table is data, not string transforms**: one table feeds two renderers (the served form and the static-worker boot payload), and "anything not expressible as a row stays on `tapIndex`, which runs after row rendering".
  - **A `global` row's value escapes `<` as `\u003c`**, so a row-controlled string cannot break out of the script element.
  - **Wildcard bind addresses are rejected by address *value*, not by text** — "ipaddr's IPv4 unspecified range covers all of 0/8; only the all-zero address binds every interface", and an IPv4-mapped wildcard is denied through the real plugin load.
  - The boot-readiness deferred (`__DSH_BOOT_READY__`) is created with `??=` so whichever side runs first creates it; the served form creates and resolves it in one statement because every row is already in the document text.
- **Edge cases:** TLS material is rejected **at activation, before the listener binds**; the port-already-taken case fails the fiber loud; teardown reaches quiescence for upgraded, idle and handshaking TLS sockets.

### `packages/host/plugin-inventory/src/index.ts`
- **Purpose:** a read-only, point-in-time projection of the current Loader entries for a settings page.
- **Non-obvious design decisions:**
  - **No second cache**: "Cordis's internal plugin/status events already maintain Entry.fiber and Fiber.state, so a second cache would only add another lifecycle truth to keep synchronized."
  - `FiberState` (a cross-package const enum) is mirrored into a stable string `fiberPhase` vocabulary; `DISPOSED` maps to `null` — a disposed entry is not a phase.
  - The service is **Remote-only** and deliberately declares no same-process `Context` merge.

### `packages/host/product-telemetry-otel/src/index.ts`
- **Purpose:** explicit product usage events over OTLP/HTTP.
- **Non-obvious design decisions:**
  - **Mounting the plugin collects nothing automatically**; the application submits each event explicitly.
  - **The endpoint URL and the channel header are validated at construction**, and `maxExportBatchSize > maxQueueSize` is refused.
  - **The shutdown deadline cancels pending exports** and warns "pending events may be lost" — the deadline is a *bound*, not a lie that everything flushed.
  - "Queue admission and shutdown completion are not collector or warehouse acknowledgements" — the docs refuse to over-claim.

### `packages/host/frontend-static/src/index.ts`
- **Purpose:** the SPA dist server on the webserver's fallback seat.
- **Non-obvious design decisions:**
  - **Traversal rejection uses `sep`, not `'/'`** — `resolve()` emits backslash paths on Windows, where a `/` suffix would reject every legitimate subpath.
  - **Only absent/non-file targets are 404**; other filesystem failures reach the webserver's request-failure handling.
  - **Index access requires authentication; non-index assets stay public.**
  - A `<base href="./">` is inserted after the opening `<head>` so relative resource references resolve.

### Tier 2 — bulk (host group)

| File | What it is / what it pins |
| --- | --- |
| `packages/host/README.md` | The host package map and each package's `ctx` key. |
| `packages/host/directory-picker/README.md` | The seam contract: the capability union, the closed error vocabulary, the host-owned `hidden` flag and the `crumbs` ancestor chain. |
| `packages/host/directory-picker/src/types.ts` | The client-safe `DirectoryEntry` / `DirectoryListing` types and the truncation contract. |
| `packages/host/directory-picker/tests/seam.spec.ts` | A subclass registers as `ctx.directoryPicker` and leaves with its fiber; the error carries the code and the subject path. |
| `packages/host/directory-picker-auto/README.md` | The boot-time sample and the `native` preconditions. |
| `packages/host/directory-picker-auto/src/index.ts` | Mounts the resolved backend **and its browser half** as real Loader entries; the effect's disposer joins both fibers' teardown, and a failed setup unmounts what it created. |
| `packages/host/directory-picker-auto/tests/resolve.spec.ts` | One signal per case; blank env treated as unset; the PATH scan skips empty segments. |
| `packages/host/directory-picker-auto/tests/loader-composition.spec.ts` | REAL Loader composition: the native backend mounts for an attended loopback host and unmounts on disposal. |
| `packages/host/directory-picker-browse/README.md` | `maxEntries` default 1000 ("the bound GitHub's web UI applies"), the truncated flag, non-recursive creation, the fully-qualified path fence. |
| `packages/host/directory-picker-browse/tests/service.spec.ts` | Directories only, hidden rows flagged, symlinks followed, broken links skipped, the `maxEntries` cut, the abort stopping the scan, the typed failures. |
| `packages/host/directory-picker-native/README.md` | macOS AppKit panel, Linux Zenity with a KDialog fallback, Windows `IFileOpenDialog` in a child process; a cancel is `null`, not an error. |
| `packages/host/directory-picker-native/src/native-picker.ts` | The macOS JXA panel (it installs the standard Edit menu so ⌘C/⌘V work in the panel's own fields), Zenity→KDialog, the Win32 dialog with **no fallback tier**, and "a caller abort is not converted to a user cancellation". |
| `packages/host/directory-picker-native/src/win32-dialog.ts` | The main-thread driver: the child-process message protocol mapped onto a promise, the `WM_CLOSE` abort service, the kill last resort, settle-once. |
| `packages/host/directory-picker-native/src/win32-dialog-logic.ts` | The pure COM sequencing over injectable bindings; `FOS_*` flags; release on every path. |
| `packages/host/directory-picker-native/src/win32-dialog-bindings.ts` | The koffi-backed COM vtable calls; koffi is imported lazily so non-Windows never loads it. |
| `packages/host/directory-picker-native/src/win32-dialog-host.ts` | Spawns the dialog child process (built CJS vs source tsx). |
| `packages/host/directory-picker-native/src/win32-dialog-worker.ts` | The child-process entry: `showing` / `done` / `error` over IPC; a *child process* rather than a worker thread "so a native fault stays contained and the modal call never wedges the host". |
| `packages/host/directory-picker-native/tests/*` | The tier selection, the abort rule, the COM sequencing against fake bindings, a fake COM world over a mocked koffi, and the keyless built-artifact guard. |
| `packages/host/frontend-static/README.md` | 404/403/405 semantics, authenticated index, public assets, one owner of the fallback seat. |
| `packages/host/frontend-static/tests/frontend-static.spec.ts` | REAL Loader composition over the served HTTP surface, including the seat release on disposal. |
| `packages/host/open-in-app/README.md` | The three routes, the fixed catalog, browser authentication and host-origin trust, "do not pass inherited credentials to launched applications". |
| `packages/host/open-in-app/src/catalog.ts` | The compile-time application table: the locator chains per platform, `argv` vs `shell-open`, the `{path}` token. |
| `packages/host/open-in-app/src/icons.ts` | Icon extraction per platform (plutil+sips, PowerShell `ExtractAssociatedIcon`, XDG theme lookup); every failure resolves `null`. |
| `packages/host/open-in-app/src/shared.ts` | The route paths and wire payloads shared verbatim with the browser package. |
| `packages/host/open-in-app/src/internals.ts` | The test seam for host facts. |
| `packages/host/open-in-app/tests/*` | The trust fence on every route, one shared resolution pass, the ENOENT refresh, the wire validation, the launcher/registry/desktop parsing, the detached-launch watch window. |
| `packages/host/plugin-inventory/README.md` | A point-in-time read-only snapshot; "it cannot mutate plugins and provides no history or change subscription". |
| `packages/host/plugin-inventory/src/types.ts` | The inventory types, including `'conditional'` enablement for an unevaluated `!!js` expression. |
| `packages/host/plugin-inventory/tests/inventory.spec.ts` | One `list` method under the namespace, the current non-group entries without a second cache, preset compositions with fiber phases. |
| `packages/host/product-telemetry-otel/README.md` | Explicit events only, best-effort delivery, no ingestion confirmation. |
| `packages/host/product-telemetry-otel/tests/*` | Isolated collector headers, nothing exported on mount, the batch threshold, a partial batch on the interval, a permanent rejection reported without failing the caller, the drain on unload, and the headless Loader composition fixtures. |
| `packages/host/webserver/README.md` | The transport's contract and the fixed route-matching order. |
| `packages/host/webserver/tests/webserver.spec.ts` | REAL Loader composition: the bind-address schema and predicates, gzip eligibility, routes/taps/fallback, fresh injection rows per render, TLS, teardown quiescence, fail-loud on a taken port. |
| `packages/host/webserver/tests/tls-fixture.ts` | Disposable localhost TLS material (selfsigned). |
| all `packages/host/**/package.json`, `tsconfig.json`, `tsdown.config.ts`, `locale/*.json` | Manifests, project references, bundle configs and locale titles — read in full. |
| all `packages/host/**/README.zh.md` | Chinese mirrors of the EN READMEs; heads read (the EN source of truth was read in full). |

---

# `packages/typert/*` — the typed-remote layer

### `packages/typert/generator/src/analyzer.ts` (3468 lines)
- **Purpose:** the TypeScript project analyzer that produces the **compiler-independent** model. "Programs, symbols, and syntax nodes remain extraction-only implementation details; callers receive only the model declared in `model.ts`."
- **Key abstractions:** `WorkspaceAnalyzer`, `WorkspaceCaches`, `TypertAnalysisError`, `AnalysisMode` (`'check' | 'write'`), `DiscoveredTypertPackage`, `AggregateConfig`, `PackageRegistration`.
- **Non-obvious design decisions:**
  - **Host and client are analyzed as independent programs**, so a face never sees the other face's types except through an explicit cross-face link.
  - **`check` vs `write` mode**: in check mode a missing public annotation fails; in write mode the analyzer *writes* the inferred annotation and re-analyzes clean. The Typert-specific checks (annotation coverage, private cross-package references, unretainable merges) run **regardless** of the diagnostics switch.
  - **Build outputs are rejected by default**: "Typert reads workspace packages only from source when a caller rejects build outputs, so its result cannot depend on whether, or when, package compilation ran" — an import that reaches `lib/` on a compiled tree resolves to nothing on a clean one, and both are rejected.
  - **Forwarding modules are followed** (named, renamed, star, namespace re-exports) but a forwarding module that reaches another package by *relative path* is rejected.
- **Edge cases:** merged declarations with conflicting authored variance, merged parts outside the registered face, and declaration merges without a lossless model are all hard errors with a source-oriented diagnostic.

### `packages/typert/generator/src/emitter.ts` (1234 lines) + `src/renderer.ts` + `src/model.ts`
- **Purpose:** the model-driven artifact emitter. "It consumes only FaceModel and TypeGraph data; TypeScript compiler nodes are not part of this boundary."
- **Non-obvious design decisions:**
  - **Emitters never reach back into TypeScript AST nodes** — the renderer is the only traversal API.
  - **A schema the tool subset cannot express raises `ToolSchemaError` rather than a weakened schema** — "callers report it as an absent projection rather than a narrower schema".
  - **`projectToolSchema` refuses overlapping union branches** ("selected union branches overlap or have no required discriminator") and refuses recursive selected types — a strictness that keeps the tool schema unambiguous.
  - The emitted artifact uses **lazy schema factories** (`Payload$schema = () => (Payload$schema$value ??= z.object(...))`) so a package that exports a schema does not pay for constructing it at import.
  - Source maps are produced with `@jridgewell/gen-mapping`.
- **Edge cases:** a byte-stable source projection is retained (body-free declaration text) so a regeneration is byte-identical.

### `packages/typert/generator/src/cordis-catalog.ts` (1069 lines)
- **Purpose:** the Cordis-specific projection that renders the model-facing API catalog and the documentation pages.
- **Non-obvious design decisions:**
  - **The catalog is policy-driven**: the repository supplies which types need a documentation link, which framework services are in the runtime catalog, and which harness services are *omitted* "because dynamic Plugins must not call them".
  - **The type-link check is fail-closed**: every unclassified signature type is aggregated into one error with its source and remediation, rather than failing fast.
  - The rendered pages are **region-delimited** (`REGION_BEGIN` / `REGION_END` markers) so a generator owns the inside and the page owns the outside.
  - The `referencedTypes` closure is **word-bounded and transitively resolved from the seed text**, so one service brings only the types it mentions.
- **Edge cases:** declarations longer than a budget render as a truncated stub; the `Slots` service declaration is explicitly kept inside the display budget.

### `packages/typert/generator/src/build-output-guard.ts` + `src/workspace.ts` + `src/tsdown-plugin.ts` + `src/worker.ts` + `src/artifact-files.ts`
- **Purpose:** the build wiring: discovery, the guard, the rolldown plugin face, the worker thread, and the artifact writer.
- **Non-obvious design decisions:**
  - **The tsdown plugin lowers standard decorators** in TypeScript dependencies before bundling — a build step, not a runtime one.
  - **Workspace mode generates in a Worker Thread** started by the pass's first `buildStart`, so bundling continues on the main thread; the first `writeBundle` awaits the result and writes every artifact **once**.
  - **Failures are values, not rejections**, so an unclaimed generation never produces an unhandled rejection; the worker posts exactly one response and exits.
  - **A host artifact without Remote methods removes the stale Remote client files** left by an earlier pass — a stale `./remote` export would otherwise advertise a namespace that no longer exists.
  - `writePackageArtifacts` writes files one by one: "a failed write can leave this package's outputs partially replaced" — stated, not hidden.

### `packages/typert/protocol/src/index.ts` + `src/types.ts` + `src/remote-error.ts` + `src/json-value.ts` + `src/owned-value.ts`
- **Purpose:** the shared Remote protocol: decorators, wire descriptors, codecs, and provider contracts.
- **Non-obvious design decisions:**
  - **The `@Remote` marker is a non-enumerable, versioned descriptor on the prototype**, so it survives bundling and can be read back by the Gateway without the decorator's closure.
  - **Markers are idempotent across instances** and return detached snapshots.
  - **`RemoteError` is discriminated by a structural marker (`isDSHRemoteError`), never by `instanceof`** — "an Error thrown in another realm (iframe, VM) fails instanceof Error here". The failure code is the discriminator; `throw result.error` keeps throw semantics on the client.
  - **The JSON boundary is lossless by construction**: `isRemoteJsonValue` rejects a non-finite number, `-0`, a sparse array, a non-plain prototype, a symbol key, a non-enumerable own key, and a cycle. A top-level `undefined` is allowed as an uplink *item* (the wire carries it as a frame without a value) but nested `undefined` is not.
  - **`typertOwnedValue` transfers cleanup ownership without adding a reference count** — a borrowed payload plus an idempotent release, disposed after the invocation and reply settle.
  - The lookup / context / resource maps are **merge-extensible**: a domain declares its keys and inherits the protocol.
- **Edge cases:** `markerOptions` validates the decorator's option keys at decoration time, so a typo fails when the class is defined rather than when the call is made.

### `packages/typert/registry/src/service.ts` (805 lines)
- **Purpose:** the runtime registry for generated reflection, lazy Zod schemas, Remote invocation descriptors, and dependency-inverted lookup/Context providers.
- **Non-obvious design decisions:**
  - **Registrations are atomic and fiber-scoped**: "a contribution lands whole or not at all and is withdrawn automatically when the registering component unloads." A duplicate package face or a duplicate schema key is refused *before* committing.
  - **A schema is materialized and cached on first request**, not at registration.
  - **The `global` resource kind is reserved** — no declared resource kind may take its name.
  - **Change-listener failures are contained**: one bad listener does not stop the later ones from being notified.
  - The registry does no TypeScript analysis and generates no schemas — the generator and the loader own that.

### `packages/typert/loader/src/index.ts` (507 lines)
- **Purpose:** auto-registering generated Typert artifacts from Loader compositions.
- **Non-obvious design decisions:**
  - **Scanning is incremental per entry name**: every `internal/plugin` emission marks the fiber's entry name dirty and a microtask flush reconciles the dirty names against the live entries.
  - **Package verdicts and imported manifests are cached per package name and never expire** — "plugin-set changes take effect on restart", which is the honest statement of a process-lifetime cache.
  - **Failure asymmetry**: a package discovered from a Loader entry with no export is skipped silently, but an *explicit* package or a *declared* artifact that is broken **fails loud** — aggregated into the activation throw for existing entries, contained to a logged error per package in steady state.
  - `validateTypertManifest` validates every field of the manifest (services, events, objects, members, types, documentation, strict invocation descriptors) **without requiring tool schemas** — a contribution is not asked to carry a projection it does not need.
  - **The loader must not materialize consumer-owned views**: loading a contribution must not request input views or projections (pinned by `lazy-info.spec.ts`).

### Tier 2 — bulk (typert group)

| File | What it is / what it pins |
| --- | --- |
| `packages/typert/README.md` | The group map: generator, loader, protocol, registry. |
| `packages/typert/generator/README.md` | Publication is opt-in via `./typert` / `./client/typert` / `./remote` exports; generation rejects what it cannot represent; it runs only at build time. |
| `packages/typert/generator/src/index.ts` | The public API surface. |
| `packages/typert/generator/src/tool-schema.ts` | The lossless projection into the enforced tool-schema subset. |
| `packages/typert/generator/tests/type-model.spec.ts` | The analyzer contract: independent face models, cross-face edges, forwarding modules, merged declarations, check vs write mode. |
| `packages/typert/generator/tests/remote-model.spec.ts` | The Remote model contract: binary results, lookup parameters, stream uplinks, scope rules, duplicate endpoint rejection. |
| `packages/typert/generator/tests/remote-metadata.spec.ts` | The Remote metadata contract: strict vs ordinary input views, tool-schema projection, recursive parsers, discriminator unions. |
| `packages/typert/generator/tests/schema-emitter.spec.ts` | The schema emitter's supported and unsupported projection matrices. |
| `packages/typert/generator/tests/cordis-catalog-contract.spec.ts` | Every catalog rule has a hard-error case (mode tags, param docs, return docs, stale params). |
| `packages/typert/generator/tests/cordis-catalog.spec.ts` | Reproduces every committed catalog artifact **byte for byte**. |
| `packages/typert/generator/tests/renderer.spec.ts` | The renderer's defensive shapes and broken-edge failures. |
| `packages/typert/generator/tests/tools-catalog.spec.ts` | Round-trips the complete service and event structure through the runtime registry. |
| `packages/typert/generator/tests/tsdown-plugin*.spec.ts` | Decorator lowering, transform filtering, stale artifact removal, and every worker failure mode. |
| `packages/typert/generator/tests/type-model-workspace.ts` | In-memory fixture workspaces: `node:fs` is mocked so a spec never touches the disk. |
| `packages/typert/generator/tests/remote-module.ts` | Loads generated JS with the *current* protocol factory, not a built library. |
| `packages/typert/generator/tests/fixtures/**` | The two fixture workspaces: a remote-model workspace (a Host-only Agent class, `@Remote` / `@RemoteScope` / stream methods) and a type-model workspace whose `models.ts` is a **type-syntax zoo** — every supported `TypeNode` shape reachable from one public declaration. |
| `packages/typert/loader/README.md` | Mounted packages auto-contribute and withdraw; packages without the export are skipped. |
| `packages/typert/loader/tests/loader.spec.ts` | Auto-registration, withdrawal on unmount, explicit packages, negative verdict caching, manifest validation. |
| `packages/typert/loader/tests/lazy-info.spec.ts` | Loading a contribution must not request consumer-owned input views or projections. |
| `packages/typert/protocol/README.md` | The decorator model, the wire identity maps, one failure class, forwarded host events. |
| `packages/typert/protocol/src/remote-info.ts` | Lazy assembly of generated Remote definitions: parsers and projections are built only on request. |
| `packages/typert/protocol/src/principal.ts` | `principalOf` — the non-owner caller of the current Remote call. |
| `packages/typert/protocol/src/remote-access.ts` | The access-control resource vocabulary. |
| `packages/typert/protocol/tests/*` | The marker descriptor, idempotence, resource readers, scoped waterfalls, the invocation accessor, and the published entry staying free of Zod runtime imports. |
| `packages/typert/registry/README.md` | Generated reflection under stable keys; atomic, fiber-scoped registrations. |
| `packages/typert/registry/src/types.ts` | The generated-artifact and runtime-registry types. |
| `packages/typert/registry/src/client/index.ts` | The browser face installs the *same* registry implementation. |
| `packages/typert/registry/tests/typert.spec.ts` | Atomic registration and withdrawal, schema materialization, provider registries, the reserved `global` kind, change-listener containment. |
| all `packages/typert/**/package.json`, `tsconfig.json`, `tsdown.config.ts`, `locale/*.json` | Manifests, project references, bundle configs and locale titles — read in full. |
| all `packages/typert/**/README.zh.md` | Chinese mirrors; heads read. |

### Tier 3 — skipped with a reason (typert group)

| File | Why not read line by line |
| --- | --- |
| `packages/typert/generator/tests/.generated-model-O7FJNT/host.mjs`, `.../qwn8sk/host.mjs` | **Generated** artifacts (a Typert emission written by a test). Head read; the `TYPERT` manifest shape extracted. |
| `packages/typert/generator/tests/__snapshots__/type-model.spec.ts.snap` | **Generated** vitest snapshot, 229 KB / 6484 lines. Head read; the body is the emitted Zod + `TYPERT` manifest. |
| `packages/typert/**/README.i18n.yaml` (5 files) | Generated bilingual-pair hash records; heads read. |

---

# `packages/util/*` — twenty sharp libraries

### `packages/util/output-retention/src/index.ts`
- **Purpose:** bounded model-facing output — "what did we keep, what did we omit?" — for tools that must cap how much context they return.
- **Key abstractions:** `ItemRetainer` (ordered logical units), `TextRetainer` (byte-oriented text), `Omitted` (`none | exact | unknown`), `PushDecision`, `RetainedItems`, `RetainedText`, `RetentionNotice`, `describeOmitted()`, `formatRetentionNotice()`, `truncateWithoutSplittingSurrogatePair()`.
- **Non-obvious design decisions:**
  - **`truncated` means "the retainer omitted otherwise-available content because of a budget" — NOT "the upstream was incomplete"**. Permission failures, skipped binaries, provider partial failures and unreadable candidates stay in *tool-domain* fields, "never folded into `truncated`". This is the single most transferable idea in the shard.
  - **The library owns the mechanical question; the tool owns the business semantics** (grouping, line numbering, exit codes, spill files, provider error states, the recovery words).
  - **Byte-oriented, not character-oriented**, for process/body safety; `omittedBytes` counts **bytes**.
  - **UTF-8 boundaries are preserved at every cut**: a prefix cut trims a trailing partial sequence, a suffix cut trims leading continuation bytes.
  - **The head|tail split is only a real cut when bytes were actually omitted.** With nothing omitted the prefix and suffix are *adjacent slices of one stream*, so a codepoint may span them; decoding them separately would corrupt a boundary-spanning codepoint "though no content was dropped". This is a subtle and correct detail.
  - **The omission count is reported against the bytes actually returned**, not the pre-trim budget — "an exact count derived from the budget alone would overstate the retained text (and any 'Omitted N bytes' notice built from it would be a lie)".
  - `formatRetentionNotice` joins a **standardized** omission clause with the tool's own recovery sentence; "the library never owns recovery words — only the tool knows the action".
  - `truncateWithoutSplittingSurrogatePair` caps a character budget without leaving a lone high surrogate, "a strict JSON reader rejects a durable Session log that carries one".
- **Edge cases:** a zero budget is legal (keeps nothing, counts everything); a non-integer or negative budget is rejected at construction; the suffix accumulator drops whole chunks as they slide out, so memory stays bounded.

### `packages/util/timeout/src/index.ts`
- **Purpose:** shared timeout arithmetic, deadline fusion, and timeout-vs-cancel classification.
- **Key abstractions:** `TimeoutReason` (carrying a capability-owned `code` and the elapsed ms), `clampTimeout()`, `deadline()` (a `Deadline` with `signal` + `[Symbol.dispose]`), `idleWatchdog()`, `timeoutOf()`.
- **Non-obvious design decisions:**
  - **The library only notifies through abort signals**; "each capability still owns the mechanism that stops its work and translates timeout reasons into public outcomes."
  - **`clampTimeout` rejects an invalid hint *before* work starts**, and **zero is not a public disable-timeout sentinel** — `timeoutMs <= 0` is an *internal* no-timer sentinel.
  - **`AbortSignal.any` adopts the reason of whichever source aborts FIRST**, so a race resolves to a single cause: a timeout win carries a `TimeoutReason`, an upstream win carries an ordinary abort reason. `timeoutOf(signal, code)` then classifies it — and a *foreign* code "follows the ordinary cancellation path", so a nested upstream deadline is not mistaken for this one.
  - **`idleWatchdog` counts only time spent waiting for provider reads** — "consumer think time does not count as provider idle time" — and the timer exists only while a `next()` is outstanding.
  - **The deadline owns the outstanding demand**: "a transport can leave a read it aborted pending forever (undici drops the error when the abort lands on an in-flight body read), so waiting for the iterator to observe the signal would leave the caller waiting past its own deadline." The abandoned demand stays the caller's to release through the signal, and "an async generator queues its own return behind it, so callers must not await it."
  - The timer delay is validated against Node's own clamp limit (`2_147_483_647`) — "must be a positive finite number no greater than …", so a bad delay fails loudly instead of silently becoming 1 ms.

### `packages/util/atomic-write/src/index.ts`
- **Purpose:** atomic file replacement and cross-process writer locking.
- **Key abstractions:** `writeFileAtomic(filename, content, { mode, dirMode? })`, `withFileLock(filename, operation, { signal?, waitMs? })`.
- **Non-obvious design decisions:**
  - **The temp file is opened with `wx` (exclusive create)** — "the open refuses to follow a symlink planted at the temp path" — and the fresh inode carries the caller's `mode` through the rename, "so replacing a wider-permission file narrows it without a chmod race".
  - **The rename replaces a symlinked target itself** instead of writing through to its referent, and the same-directory sibling keeps the rename on one filesystem.
  - **Windows transient rename failures (`EACCES`, `EBUSY`, `EPERM`) are retried with bounded exponential backoff** while the complete temp file remains the rename source; any other code is not retried.
  - **Crash durability (fsync) is explicitly out of scope** and the code says so (a `TODO(settings-atomic-durability)` marker names it).
  - **The lock records its holder's PID; a contender takes over only when a signal probe proves the holder is gone** (`ESRCH`). A holder that exists under another user (`EPERM`) or whose record is incomplete is waited for.
  - **The takeover is itself arbitrated by a claim file named after the record hash**, and the claimant re-reads the lock and re-probes the PID before removing it — "a removal never deletes a lock another contender acquired after the dead holder's, including one whose holder reused the PID".
  - **`waitMs` exists because waiting is productive**: a contender that acquires the lock afterwards re-reads the committed state.

### `packages/util/values/src/index.ts` + `src/partial-json.ts`
- **Purpose:** lossless JSON validation, detached snapshots, deep freezing, structural equality, and a lazily-scanned view over streaming tool-call arguments.
- **Key abstractions:** `JsonValue`, `assertNever()`, `snapshotJsonValue()`, `isJsonValue()`, `deepEqualJson()`, `deepFreeze()`, `WeakMapWithValues`, `PartialArguments`.
- **Non-obvious design decisions:**
  - **The JSON walker is iterative, not recursive** — a deep model-authored object would blow the JS stack in a recursive cloner. The work-stack is explicit (`visit` / `array-item` / `object-property` / `leave`).
  - **The "lossless" bar is strict**: a non-finite number, `-0`, a sparse array, a non-plain prototype, a symbol key, a non-enumerable own key and a cycle are all rejected. `enumerableStringKeys` returns `undefined` rather than coercing.
  - **Realm-safe prototype checks**: `hasIntrinsicConstructor` verifies the prototype is backed by the *native* `Object`/`Array` constructor, so a cross-realm value is accepted and a forged prototype is not.
  - **`deepFreeze` deliberately leaves `AbortSignal` objects mutable** — a frozen signal would be useless.
  - **`WeakMapWithValues` keeps a strongly retained set of values** so they can be iterated and cleared at lifecycle end, while the keys stay weak.
  - **`PartialArguments` scans nothing until a reader asks**, remembers every question it answered, and reports *changed* answers when the owner refreshes for publication — the streaming tool-call argument view. "A row reads the fields it cares about at whatever granularity it displays, at every stage of the call."
  - `PartialArguments.EMPTY` is a shared **sealed** view with no fields.
- **Edge cases:** a streaming view and a sealed view of the same text are *not* structurally equal, "even though every reader agrees"; a reader cache is not carried into corrected authoritative text.

### `packages/util/http-proxy/src/policy.ts` + `src/install.ts`
- **Purpose:** one outbound HTTP proxy policy, resolved from the launch environment and installed as undici's global dispatcher.
- **Key abstractions:** `ProxyPolicy`, `ProxyResolution` (the policy **plus every rejected candidate**), `ProxyDiagnostic`, `resolveProxyPolicy()`, `proxyForUrl()`, `bypassesProxy()`, `isLoopbackHost()`, `installProxyFromEnvironment()`, `proxyRouteFor()`, `proxyEnvironmentForChild()`, `clearedProxyEnv()`.
- **Non-obvious design decisions:**
  - **The policy half imports no `undici`**, so it stays loadable in the browser-worker runtime; `undici` is imported dynamically in the install half.
  - **A rejected proxy value is *reported*, never silently dropped** — a SOCKS/PAC URL and an unparseable URL each get an operator-facing sentence "that carries no credential".
  - **A scheme whose own value was refused stays direct** — it does not fall back to `ALL_PROXY` or to the other scheme, "rather than falling back".
  - **The lowercase env name wins** (matching undici), and a blank lowercase value is treated as unset "instead of letting it shadow the uppercase one".
  - **The loopback matcher covers the whole `127.0.0/8` block** and rejects an out-of-range octet "rather than reading it as loopback".
  - **`proxyRouteFor` hands back the dispatcher already routing**, "so a branch and its request agree".
  - **The child environment carries the user's own exported values, not this process's normalization**, and the outermost install's record survives a nested one.
  - `installProxyFromEnvironment` restores the dispatcher, the route and the environment on disposal.

### `packages/util/native-command/src/*`
- **Purpose:** shell-free host command execution, path opening, and file-association discovery.
- **Key abstractions:** `runNativeCommand` (a `NativeCommandRunner` over `execFile`, never a shell), `openNativePath`, `openNativeTextFile`, `openNativeAssociatedPath`, `revealNativePath`, `nativeFileManager`, `canOpenNativePath`, `nativeFileApplications`, `openNativeFileApplication`, `desktopEntryFields`, `desktopApplicationIcon`.
- **Non-obvious design decisions:**
  - **Windows startup visibility is explicit** (`'hidden' | 'visible'`) — never inferred.
  - **The default intent prefers the default *browser* for documents it renders**, then falls back to the default application; the text-editor intent never consults the browser.
  - **WSL translates every path for the Windows desktop** instead of assuming a Linux GUI, and an empty translation is rejected before invoking Windows.
  - **Windows hands every intent to Explorer** — "the shell's own default-application resolution, the one a double-click uses".
  - **The macOS and Windows association sources keep paths as argv / encoded data, never as executable source** — the Windows PowerShell is generated with positional args "so paths stay out of the command line's parsing (no quoting/escaping surface)".
  - `parseNativeFileApplications` validates the metadata a native process returned; the caller "must revalidate it against the file's current handlers before opening".

### `packages/util/workspace-path/src/index.ts` + `src/file-address.ts`
- **Purpose:** browser-safe workspace path helpers and the `dsh-resource://file/…` address grammar.
- **Key abstractions:** `isAbsoluteWorkspacePath`, `resolveWorkspacePath`, `abbreviateHomePath`, `workspaceTitleOf`, `pathPartsOf`, `fileAddressFor`, `relativizeToCwd`, `fileMediaUrl`, `sessionFileAddress`, `absoluteFileAddress`, `parseFileAddress`.
- **Non-obvious design decisions:**
  - **A file is addressed by session when it is relative or inside the workspace**, and by absolute path otherwise — "the same absolute path gets different addresses in different Sessions".
  - `fileMediaUrl` refuses a UNC path and any path with a control character, and encodes the path as a query parameter.
  - `relativizeToCwd` is display-only and leaves a path outside the workspace unchanged.

### `packages/util/plugin-market-index/src/index.ts`
- **Purpose:** the executable rule set for plugin-market index format 1.
- **Key abstractions:** `parseMarketIndex(value, indexUrl)`, `marketInstallTarget()`, `MarketIndexError` (carrying the **JSON path** of the offending value, e.g. `$.plugins[0].versions[1].version`).
- **Non-obvious design decisions:**
  - **The error names the exact JSON path**, not just the rule.
  - **An id such as `__proto__` stays an ordinary own key** — the validator defines members with `Object.defineProperty` rather than assignment.
  - **A relative index URL is refused with its own error**; a `file:`-origin icon resolved against a `file:` index is rejected.
  - **The inline `data:` icon payload is capped** (`MAX_INLINE_ICON_BYTES`).
  - **Versions are ordered by SemVer precedence**, and unknown members are dropped rather than rejected.

### `packages/util/home-paths/src/index.ts`
- **Purpose:** the DSH home and the shared agents home, plus display helpers.
- **Non-obvious design decisions:**
  - **Precedence: explicit path > environment > OS-home default**, and **a blank environment value is treated as unset** "so a blank override never resolves the home to the current working directory".
  - **The display helper never returns an absolute machine path** — the default home is `~/.dsh`, a configured one is `$DSH_HOME`.
  - `canonicalizeWatchPath` resolves the **deepest existing ancestor** and proves it is an enumerable directory before restoring a missing suffix, "so Windows does not treat a regular-file ancestor as ordinary absence".

### `packages/util/launch-environment/src/index.ts`
- **Purpose:** an immutable snapshot of the launch environment that remembers **which layer supplied each value**.
- **Key abstractions:** `LaunchEnvironmentSource` (`'process' | 'project-env' | 'user-env'`), `LaunchEnvironmentEntry`, `LaunchEnvironmentSnapshot`, `createLaunchEnvironmentSnapshot()`, `launchEnvironmentOf(ctx)`, `launchedThroughSsh()`.
- **Non-obvious design decisions:**
  - **Every layer is copied** so a later mutation cannot change the snapshot.
  - **Windows folds environment names case-insensitively**; POSIX stays exact.
  - **`getFrom(name, sources)` can exclude layers** — "an omitted layer stays unreachable regardless of later ordering changes", which is how a sensitive lookup refuses a `.env` file.
  - **SSH is detected from the inherited process layer only** — "Project and user `.env` values never establish an SSH session."
  - The snapshot does **not** isolate subprocesses: every layer is still copied into `process.env`, and the doc says so.

### Tier 2 — bulk (util group)

| File | What it is / what it pins |
| --- | --- |
| `packages/util/README.md` | The util package map: "capability packages shared mechanical primitives instead of duplicate implementations"; every root entry is a library with no product service. |
| `packages/util/brand/src/index.ts` | `Branded` / `BrandedNumber` plus `brandString` / `brandNumber` — nominal types with no shared runtime state, so duplicate installs stay interchangeable. |
| `packages/util/brand/tests/brand.spec.ts` | A number is branded without changing its runtime value. |
| `packages/util/chunked-list/src/index.ts` | `appendChunkedList` (copies at most one 64-value chunk), `iterateChunkedList` (O(N) time, O(N/64) scratch), `chunkedListSchema` (a recursive strict Zod schema). |
| `packages/util/chunked-list/tests/chunked-list.spec.ts` | Prefix immutability across chunk rollovers, JSON checkpoint round-trip. |
| `packages/util/code-language/src/index.ts` | The one extension→grammar table, a `Map` (not an object) so `foo.constructor` misses, the persisted-hint overrides, and the short-id table. |
| `packages/util/code-language/tests/code-language.spec.ts` | Case-insensitivity, `Object.prototype`-key safety, the already-persisted short hints, every suffix listed once. |
| `packages/util/crypto/src/index.ts` | `randomUUID` from `crypto.getRandomValues` with the RFC 9562 version/variant bits pinned, and a chunked `bytesToBase64` that does not overflow the argument limit. |
| `packages/util/crypto/tests/uuid.spec.ts` | The UUID's shape, uniqueness, and independence from `crypto.randomUUID`. |
| `packages/util/deque/src/index.ts` | The circular buffer: growth, sparse compaction at a quarter capacity, and **immediate reference clearing** on removal. |
| `packages/util/deque/tests/deque.spec.ts` | FIFO order, wrapping, sparse compaction, reference release, `size` vs an `undefined` entry. |
| `packages/util/deque/benchmarks/drain.ts` | The drain benchmark (median of 5 samples, 250k–2M entries, with a checksum guard). |
| `packages/util/lazy-require/src/index.ts` | `createLazyRequire` over `node:module`'s `createRequire`; **a failed load is not cached**. |
| `packages/util/lazy-require/tests/index.spec.ts` | Resolves from the caller and caches the successful value. |
| `packages/util/lazy-require/tests/fixtures/value.cjs` | The CJS fixture that counts its own loads. |
| `packages/util/native-command/src/index.ts` | The package's public surface. |
| `packages/util/native-command/src/types.ts` | `NativeFileApplication` and its parser. |
| `packages/util/native-command/src/runner.ts` | The shared no-shell `execFile` runner: stdout/stderr capture, abort termination, explicit window visibility. |
| `packages/util/native-command/src/desktop-entry.ts` | XDG desktop-entry fields, data directories and the theme icon lookup. |
| `packages/util/native-command/src/path-opener.ts` | The open / reveal / text-editor intents, the browser-renderable document set, the WSL translation, `canOpenNativePath`, `nativeFileManager`. |
| `packages/util/native-command/src/file-applications.ts` | The per-platform association query, the macOS dedupe by version, the explicit-handler launch. |
| `packages/util/native-command/src/file-applications-linux.ts` | Linux associations from GIO with the shared XDG metadata. |
| `packages/util/native-command/src/file-applications-windows.ts` | The Windows Shell association query and invocation; paths are encoded data, never PowerShell expressions. |
| `packages/util/native-command/tests/*` | Tier selection, the abort rule, the COM sequencing, a fake COM world over a mocked koffi, the CreateProcess command-line limit, real GIO and real Windows Shell discovery. |
| `packages/util/package-manifest/src/{index,types}.ts` | The shared manifest declarations and the client manifest; each reader owns its own parsing and defaults. |
| `packages/util/plugin-market-index/src/types.ts` | The validated market-index record types. |
| `packages/util/plugin-market-index/tests/plugin-market-index.spec.ts` | Every format-1 rule with the offending JSON path, `__proto__` as an ordinary key, pinned install targets. |
| `packages/util/time/src/index.ts` | `canonicalClientTimeZone` — the platform-canonical spelling, or `undefined`; it validates and canonicalizes but **formats nothing**. |
| `packages/util/time/tests/time.spec.ts` | UTC and `Area/Location` accepted, an alias canonicalized, blank/padded/abbreviated refused. |
| `packages/util/values/tests/partial-json.spec.ts` | Sealed vs streaming views, settlement, structural equality, the streaming readers. |
| `packages/util/values/tests/weak-map-with-values.spec.ts` | Weak keys with strongly retained values in insertion order. |
| `packages/util/workspace-path/tests/*` | The address round-trips (session, absolute POSIX, Windows drive, UNC), the authenticated file-route URL, and the display helpers. |
| all `packages/util/**/package.json`, `tsconfig.json` | Manifests and project references — read in full. |
| all `packages/util/**/README.md` | Each package's contract: what it decides and what it deliberately leaves to the caller. |
| all `packages/util/**/README.zh.md` | Chinese mirrors; heads read. |

### Tier 3 — skipped with a reason (util group)

| File | Why not read line by line |
| --- | --- |
| all 19 `packages/util/**/README.i18n.yaml` | Generated bilingual-pair hash records; heads read. |

---

## 2. Ideas worth stealing

1. **`CONVERGENT` — the "truncated means the *budget* omitted content, never that the upstream was incomplete" separation.** `packages/util/output-retention/src/index.ts:14-21` — the retainer's `truncated` is about *this* budget only; a permission failure or a provider partial failure belongs in the tool's own domain field. August Trading has exactly this hazard in its `read`/`grep`/`web` tools and in the "spill receipt" concept; splitting "the tool capped the output" from "the tool could not read everything" is a correctness win the model can act on. *Why it transfers:* the model must be able to tell "there is more, ask again" from "the source was incomplete, do not ask again".
2. **`CONVERGENT` — omission is reported as an exact count, and the count is measured against the bytes actually returned, not against the budget.** `packages/util/output-retention/src/index.ts:387-397` — "an exact count derived from the budget alone would overstate the retained text (and any 'Omitted N bytes' notice built from it would be a lie)". *Why it transfers:* August Trading's `memoryBudget.ts` caps bytes; the same trap applies to any truncated tool output.
3. **`CONVERGENT` — a library owns the *mechanical* question and the caller owns the business semantics.** `packages/util/output-retention/src/index.ts:9-13` — the retainer counts and keeps; grouping, line numbers, exit codes, spill files and the recovery words stay in the tool. *Why it transfers:* the same seam keeps August Trading's retention/notice code from becoming a second implementation per tool.
4. **`UNIQUE` — a standardized omission clause plus a tool-owned recovery sentence, joined by one formatter.** `packages/util/output-retention/src/index.ts:407-430` (`describeOmitted`, `formatRetentionNotice`). *Why it transfers:* every capped tool result in August Trading would then read the same way, and the model learns one shape.
5. **`CONVERGENT` — progressive disclosure: a directory first, one exact contract second, and only the transitively referenced types.** `packages/extensions/cordis-client-runner/src/client/api-catalog.ts:1058-1072` (`referencedTypeClosure`) and `packages/typert/generator/src/cordis-catalog.ts` (the `referencedTypes` closure). *Why it transfers:* August Trading's `constants/prompts` and tool schemas could expose a compact index of its own capabilities and fetch one contract on demand — the same token discipline the reference applies.
6. **`UNIQUE` — the generated catalog and the rendered docs come from the *same AST walk*, so they cannot diverge, and the artifact is freshness-gated.** `packages/extensions/cordis-client-runner/src/client/api-catalog.ts:1-12`. *Why it transfers:* August Trading could generate the `docs/tool-catalog.md` and the machine-readable tool index from one source, with a CI freshness gate.
7. **`UNIQUE` — teaching errors that name the executable next step, not the rule.** `packages/extensions/cordis-host-runner/src/guard.ts:170-186` (the JSON-clone rejection names "the usual cause is a handler that returns whatever its last call produced, and the fix is one keyword"), and `packages/extensions/cordis-host-runner/src/sandbox.ts:170-183` (the parse hint names the exact bracket mistake). *Why it transfers:* August Trading's provider-error path and its zod-boundary errors could each carry a one-line fix.
8. **`UNIQUE` — a whitelist façade that pins identity: the caller cannot forge the layer's source, and the façade is explicitly "API discipline, not a security boundary".** `packages/extensions/cordis-client-runner/src/client/guard.ts:173-199` (the theme seat forces `source` to the package id). *Why it transfers:* if August Trading ever lets a tool or a skill register a UI contribution, identity must be pinned at the boundary, not trusted.
9. **`CONVERGENT` — convergence by *live state*, not by history: loading the same activation is a no-op that still answers.** `packages/extensions/cordis-client-runner/src/client/runtime.ts:246-256`. *Why it transfers:* a replayed automation run in August Trading must be idempotent *and* must not look unacknowledged.
10. **`UNIQUE` — the per-plugin serial queue whose tail survives a failure.** `packages/extensions/cordis-client-runner/src/client/runtime.ts:281-289` — "one rejection would otherwise wedge every later operation on the same package". *Why it transfers:* the same shape protects any per-entity work queue in August Trading (one failed trade-record write must not wedge the symbol's queue).
11. **`CONVERGENT` — timeout and cancellation are two different things, and the library classifies them.** `packages/util/timeout/src/index.ts:60-72` (`AbortSignal.any` adopts the first reason) and `timeoutOf(signal, code)` — a foreign code "follows the ordinary cancellation path". *Why it transfers:* August Trading's provider timeout vs user abort should be distinguishable in the error the trader reads; the current `toFriendlyProviderError` path blurs them.
12. **`CONVERGENT` — an idle watchdog that counts only time spent *waiting* for the provider, not consumer think time.** `packages/util/timeout/src/index.ts:128-190`. *Why it transfers:* a streaming provider call in August Trading can be idle for legitimate reasons; a watchdog that counts total wall time would abort a healthy call.
13. **`UNIQUE` — the deadline owns the outstanding demand.** `packages/util/timeout/src/index.ts:139-146` — a transport can leave an aborted read pending forever, "so waiting for the iterator to observe the signal would leave the caller waiting past its own deadline". *Why it transfers:* the same hazard exists in any streaming fetch in August Trading.
14. **`CONVERGENT` — the atomic file write that narrows permissions on a fresh inode, plus a cross-process writer lock with a dead-holder takeover.** `packages/util/atomic-write/src/index.ts:60-120` and `:200-260`. *Why it transfers:* August Trading writes notebook/skills files from several surfaces; a lock + rename is the minimum that keeps a concurrent write from resurrecting stale state.
15. **`UNIQUE` — the two-observation rule: the host keeps the last crash *across* pages for the model, the page keeps its own current crash for its panel, and neither is derived from the other.** `packages/extensions/cordis-client-runner/src/client/runtime.ts:196-215`. *Why it transfers:* August Trading's chat and its dock are two homes; the same "two owners, two lifetimes" rule prevents one from lying to the other.
16. **`UNIQUE` — a whitelist of *services* plus a vocabulary of framework-internal names that are withheld by design, with the withheld list printed to the model.** `packages/extensions/cordis-client-runner/src/client/guard.ts:200-240`. *Why it transfers:* August Trading's tool registry could tell the model exactly which capabilities exist and which are withheld, instead of a silent absence.
17. **`CONVERGENT` — a bounded, name-sorted streaming window instead of materializing a whole level.** `packages/host/directory-picker-browse/src/index.ts:81-110` (O(1) reject, O(log keep) insert, a `+1` slot to prove the cut) and `packages/host/directory-picker-browse/README.md` (the 1,000-row bound follows GitHub's web UI). *Why it transfers:* the same windowing applies to any "list many things" tool in August Trading (candles, trades, signals).
18. **`UNIQUE` — the "one resolution" round trip: host half first, then source fetch, then client half, then exactly one answer; the answering page's acknowledgement is read.** `packages/extensions/cordis-host-runner/src/index.ts:317-324`. *Why it transfers:* an August Trading action that spans a background service and the UI (e.g. "install a skill", "run a backtest") should have one settlement point.
19. **`UNIQUE` — a "stale success" is refused rather than applied, and the refusal says why.** `packages/extensions/cordis-host-runner/src/index.ts:388-395` (`accepted: false` when the revision moved on). *Why it transfers:* an approval in August Trading should be invalidated if the thing approved changed in between.
20. **`UNIQUE` — a *panel* gesture injects a user message into the model session, naming the state the model now has.** `packages/extensions/cordis-host-runner/src/index.ts:431-446`. *Why it transfers:* when the trader stops or removes something in August Trading, the model's next step should learn about it, with the pointer values it needs.
21. **`CONVERGENT` — the approval record is a *first-claim* row.** `packages/extensions/cordis-host-runner/src/registry.ts` (`peekRequest` vs `claimRequest`). *Why it transfers:* an August Trading approval inbox should be claimable exactly once, and the claim must be atomic.
22. **`UNIQUE` — "the sandbox isolates globals but is not a security boundary … Treat a dynamic package like bash access", stated in the package contract.** `packages/extensions/cordis-host-runner/README.md`. *Why it transfers:* if August Trading ever lets the model write code, the honest contract is the first thing to write.
23. **`UNIQUE` — the *define-time parse gate*: unparseable code never reaches the registry, and the diagnosis is the same whichever verb caught it.** `packages/extensions/cordis-host-runner/src/sandbox.ts:186-200` + `parseErrorMessage`. *Why it transfers:* a generated artifact or a skill body should be validated at authoring time, not at use time.
24. **`UNIQUE` — the "kind" discriminator as a *merge-extensible* map, with the documented default for an unknown kind being "hide the affordance, do not fail".** `packages/host/directory-picker/src/index.ts:60-75`. *Why it transfers:* August Trading's surfaces (panel vs. inline, native vs. remote) could add a kind without editing the seam, and an unknown kind must degrade to a hidden control rather than a crash.
25. **`UNIQUE` — a boot-time *pure* resolution from sampled facts, with "anything ambiguous resolves to the universally-working option".** `packages/host/directory-picker-auto/src/resolve.ts:53-68`. *Why it transfers:* the same rule (ambiguity → the always-works path) fits August Trading's provider selection and its desktop-vs-web rendering.
26. **`CONVERGENT` — the client-registration seam with the wire body validated at the boundary (media type, size ceiling, field types, resolved target).** `packages/host/open-in-app/src/index.ts:12-22`. *Why it transfers:* any August Trading host route (a backtest kick-off, a data import) should validate its body the same way, in one place.
27. **`UNIQUE` — the "re-read, don't patch" rule for a cache that announcements cannot keep in sync.** `packages/extensions/ui-cordis/src/client/inventory.ts:6-18` — the announcements "carry no labels and a definition can appear or disappear between them — a patch-in-place cache would drift". *Why it transfers:* August Trading's provider/preset lists should be re-read on a signal, not patched.
28. **`CONVERGENT` — a failed read keeps the rows it had and says why.** `packages/extensions/ui-cordis/src/client/inventory.ts:96-106` — "dropping the rows would turn a transient wire failure into 'nothing is defined'". *Why it transfers:* a failed provider list in August Trading must not read as "no providers".
29. **`UNIQUE` — a *generation* counter that discards a stale read's answer after a reconnect.** `packages/extensions/ui-cordis/src/client/inventory.ts:60-80`. *Why it transfers:* after a reconnection the old host's rows must not be published on top of the new one.
30. **`CONVERGENT` — an *untrusted* value is never rebased under the process working directory.** `packages/host/directory-picker-browse/src/index.ts:41-52` (`fullyQualified`, stricter than `isAbsolute` on Windows). *Why it transfers:* any path or file argument that crosses a wire in August Trading should be rejected, not resolved.

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** *not in this shard.* This shard holds the platform libraries; the cron/automation runner and the monitoring surfaces live in other shards of this repo. The nearest thing here is the **idle watchdog** (`packages/util/timeout/src/index.ts:128-190`) and the **rearmable deadline** — a "watch the feed for inactivity" primitive that distinguishes *waiting* from *thinking* — and the **launch-environment snapshot** that tells a scheduled job what the environment was at launch rather than what `process.env` happens to hold now.
- **Human-in-the-loop approval:** the strongest material in the shard. The approval is a **first-claim registry row** with an explicit `requiresApproval` flag, a **per-package grant** and a **plugin-wide grant** (`packages/extensions/cordis-host-runner/src/registry.ts`), a **frame-wide panel** that is deliberately *not* filtered by session (`packages/extensions/ui-cordis/README.md`), a **stale-success refusal** (`accepted: false`) when the approved revision moved on, and a **steering message to the owning session** that says what to do next ("Do not request the same activation again unless the user asks"). The audit trail is the `DynamicCordisRunAttempt` record: it survives the run (`packages/extensions/cordis-host-runner/src/types.ts`), carries a 9-value status, a 6-value diagnostic phase, and both halves' states.
- **Post-mortem / reflection loops:** *not in this shard.* The nearest transferable idea is the **run-attempt record that outlives the run** — a failure stays readable after the thing that failed is gone, and the UI shows it "in the same place as a load failure", so "it never loaded" and "it loaded and then threw" are distinguishable.
- **Multi-agent:** *not in this shard.* The relevant seam is the **dual-half plugin** (host owns I/O, browser owns UI) and the **"one resolution" round trip**, plus the principle that a *host half* is the only place side effects live while a *browser half* is a projection.
- **Structured logs the model can query:** the closest thing here is the **generated API catalog** — a machine-readable, AST-derived directory of every service, event and referenced type, served progressively to the model (`packages/extensions/cordis-client-runner/src/client/api-catalog.ts`). The `cordis_inspect` pair (`list` then `query`) is a read-only, schema-validated query surface over a live runtime, and it is **the same shape a queryable trade/journal log wants**: a directory, then one exact query, with the answer validated against a declared schema.
- **Staying simple as features accumulate:** the reference's answer is **splitting a capability into a seam plus interchangeable backends** (`directory-picker` + `native` + `browse` + `auto`), and **keeping the mechanical half in a library with no `ctx`** (`output-retention`, `timeout`, `atomic-write`, `brand`). Every util package states in one line what it *does not* own — "the library owns only the mechanical question", "each capability still owns the mechanism that stops its work".

## 4. Non-obvious decisions and gotchas

1. **`truncated` has one meaning.** In `output-retention` it means *the budget omitted content*. A partial upstream failure is a **different field**. Reading `truncated` as "the source was incomplete" is the mistake this design exists to prevent.
2. **The exact omission count is measured against what was returned**, not against the budget — a boundary trim drops partial-codepoint bytes too, and a count derived from the budget alone "would be a lie".
3. **The head|tail split is only a real cut when bytes were omitted.** With nothing omitted the two windows are adjacent slices of one stream and a codepoint may span them; decoding them separately corrupts it "though no content was dropped".
4. **A library that is "not a security boundary" says so up front** (`sandbox.ts`, `guard.ts`, the host-runner README). Do not read the guard as containment.
5. **The guard forwards service methods with the *service* as receiver**, because `SlotRegistry.register` must stay a prototype method so `this.ctx` binds to the *calling* plugin's fiber. An arrow property would freeze `this` to the service's own root ctx and "silently break per-plugin disposal" (`packages/extensions/cordis-client-runner/src/client/api-catalog.ts`, `slots.register`).
6. **The host and browser guards are hand-mirrored twins on purpose.** Moving the rule into a shared package "would move a security invariant out of the halves that enforce it" (`packages/extensions/cordis-host-runner/src/guard.ts:545-556`).
7. **A service that returns a cordis `Context` is denied** — synchronously and after `await` — because `ctx.escape()` is the classic route out of the façade.
8. **"A parked package is a success."** A plugin whose declared services are not yet present is *running*, waiting; the load answers `ok: true` with `waitingFor`. Folding that into a failure would report a successful run as broken.
9. **A `run`/`update` mode mismatch is refused with a recipe** ("no successful version yet; start X with mode `run`"), not with a generic error.
10. **A failed update keeps `currentPackageId` and points `nextPackageId` at the failed target** — the old version stays live, and the pointer tells the model what state the world is in.
11. **A "refused resolution" is not retried by the browser half** — the acknowledgement of `resolveRequestRun` is not read, so a stale success leaves the page holding what it loaded. This is a known limitation in the reference's own README, not an accident.
12. **A render crash is reported fire-and-forget** — "the run this package belongs to was answered before it ever rendered, so nothing waits on this and a failed report must not turn one crash into two".
13. **The host keeps only the *latest* crash per package**, so a repeatedly crashing entry costs the model one message rather than a growing list.
14. **Ownership is keyed by component identity in a `WeakMap`**, and the comment enumerates why each alternative fails (`entry.registrant` is package-supplied, the shadowing priority is absent on chain entries, a parallel ledger would drift).
15. **A "versioned, immutable package" model, not a mutable plugin.** `define` never changes a package; `currentPackageId` / `nextPackageId` are the whole story. This is what makes the rollback semantics obvious.
16. **The inventory is re-read, not patched**, and a failed read **keeps the rows it had**.
17. **A `Map`, not an object, for the extension table** — `foo.constructor` must miss rather than resolve the inherited member, "which would otherwise reach callers as a non-string language value".
18. **`crypto.randomUUID` is a secure-context API.** A page served over plain HTTP on a LAN address has no such method; the repo has a lint rule pointing callers at one implementation built on `getRandomValues`.
19. **An env var's name is folded case-insensitively on Windows only**; POSIX stays exact.
20. **`fullyQualified` is stricter than `isAbsolute` on Windows** — `\foo`, `/foo` and `\\` pass `isAbsolute` yet still resolve against the *current drive*.
21. **The `no_proxy` matcher covers the whole `127.0.0/8` block** and rejects an out-of-range octet "rather than reading it as loopback".
22. **A rejected proxy value is reported, never silently dropped** — and a scheme whose own value was refused stays **direct** rather than falling back.
23. **The `use` of `Object.prototype` keys is guarded everywhere an untrusted string keys a lookup** — the code-language table, the market-index declarations, the partial-JSON reader.
24. **A cross-realm `instanceof` is never used to discriminate a failure** — `RemoteError` carries a structural marker; a `SyntaxError` from a vm realm is detected by `error.name`.
25. **The JSON clone is iterative** — a deep model-authored object would blow the stack in a recursive cloner.
26. **The win32 dialog is a *child process*, not a worker thread**, "so a native fault stays contained and the modal call never wedges the host"; the child is killed as a last resort and the `WM_CLOSE` service is re-posted until the worker reports back.
27. **A macOS native panel needs the standard Edit menu installed before `NSOpenPanel` opens**, or every text field in the panel (Go to Folder, Search, Tags) is un-pastable — a bug only a real macOS user would find.
28. **A symlink to a directory is followed; a broken or cyclic one is skipped**, and the skipped row is not backfilled from beyond the window, because the eviction already marks the level truncated "which stays the honest answer".
29. **`writeFileAtomic` does not `fsync`** — crash durability is explicitly out of scope, and the code says so.
30. **The lock takeover is arbitrated by a claim file named after the record hash**, so a removal "never deletes a lock another contender acquired after the dead holder's, including one whose holder reused the PID".
31. **A blank environment value is "unset"** everywhere in this shard (home paths, proxy vars, the env snapshot) — "a blank override never resolves the home to the current working directory".
32. **`deepFreeze` deliberately leaves `AbortSignal` objects mutable.**
33. **A streaming `PartialArguments` view and a sealed view of the same text are NOT structurally equal**, "even though every reader agrees" — the view knows whether more may arrive.
34. **The generated catalog is a *machine* file with a freshness gate**; the committed docs and the model-facing catalog come from one AST walk so "this data and the rendered docs cannot diverge".

## 5. Weak spots

1. **The guard twins are duplicated on purpose** (host and browser), and the duplication will drift: the browser guard already lists "Guard whitelists are hand-mirrored twins" as a known limitation of the reference. A shared *specification* (not a shared module) would be the honest fix.
2. **The sandbox is not containment.** The reference says so, but a `node:vm` host half that can reach `ctx.bash` is one refactor away from being a shell. The "trust stance" is documented, not enforced.
3. **`vmTimeoutMs` only bounds the synchronous portion** — an async host half escapes it entirely, and the README admits it. A timeout that does not time out the common case is a timeout that will surprise someone.
4. **A suspended run request has no timeout.** It waits for a person until the asking turn is cancelled, so unattended automation cannot use browser-half packages — a design hole with a known answer deferred.
5. **The two generated catalogs are enormous** (624 KB and 273 KB of *committed, generated* data in the repo) and the snapshot file is 229 KB. A repo-wide convention of committing generated artifacts is convenient for freshness gates and expensive for every clone and every code search.
6. **The `api-catalog` / `slot-catalog` / `cordis-catalog` pipeline is three overlapping mechanisms** producing three similar catalogs (`tool-cordis`, `cordis-client-runner`, and the `docs/` pages). Each is freshness-gated, so the repo carries three near-duplicate copies of the same service/event facts. The reference's own `verify-*-catalog` scripts exist to keep them in step — a standing tax.
7. **`native-command`'s Windows path is a generated C# source embedded in a TypeScript string** (`file-applications-windows.ts`), and the macOS path is embedded JXA. These are untyped, unlinted, and untestable except through a real OS; the tests are skipped on the wrong platform, so a large part of that surface is untested on CI.
8. **The `directory-picker` family ships four packages for one capability** (seam, native, browse, auto) plus two client packages that are not in this shard. The adaptive chooser exists because the decision could not be made in config — the reference's own README says pinning is "not a config field here". That is a lot of packages for one button.
9. **`open-in-app`'s `catalog.ts` is a hard-coded table of applications** with per-platform locator chains; a newly installed editor does not appear until restart ("newly installed applications appear after restart"). It is a lot of hand-maintained platform knowledge.
10. **The `PartialArguments` reader is 666 lines of hand-written JSON scanning** — a full incremental parser for the narrow need of reading a few fields from a streaming tool call. Correct and well tested, but a large bespoke machine to maintain.
11. **`output-retention`'s `TextRetainer` `finish()` is subtle enough to need a comment paragraph** about the adjacent-slice case; the correctness is real but the readability cost is high, and a future edit to that method could silently corrupt a codepoint.
12. **The `util` group is eighteen near-identical package skeletons** (README × 3, i18n hash, locale × 2, package.json, tsconfig) for a dozen lines of code each. The per-package ceremony is the price of independent publication, and it is not free.
13. **The `README.i18n.yaml` hash files are a per-heading SHA of the EN and ZH blocks** — a clever, low-cost bilingual drift detector, but it is 19 more generated files to keep and it says nothing about the *quality* of the translation.
14. **`plugin-market-index` hand-writes a whole JSON validation layer** (with a JSON-path error, a `__proto__`-safe member writer, an inline-icon byte cap) where a schema library would normally live. It is more precise than a schema and more code to maintain.
15. **The `typert` generator is ~9,000 lines of analysis, model, emission and rendering** — a compiler-in-a-box. The freshness gates and the byte-for-byte catalog reproduction test are what keep it honest, which is also a statement that the generator is not trusted to stay in step on its own.

---

## 6. Complete per-file index (one row per file, in list order)

Every file in the shard, with the depth of the read and a one-line summary. The *analysis* of each file is in §1 above — this table is the index that guarantees nothing was left out.

| # | path | status | one-line summary |
| --- | --- | --- | --- |
| 1 | `packages/extensions/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read (it is a machine file refreshed by verify-translation-pairing --write) |
| 2 | `packages/extensions/README.md` | read | package-group index: four extensions packages, their ctx keys, and why the browser halves live in this group |
| 3 | `packages/extensions/README.zh.md` | read | Chinese mirror of the extensions group index |
| 4 | `packages/extensions/cordis-client-runner/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 5 | `packages/extensions/cordis-client-runner/README.md` | read | package contract: page behaviour, run surface, lifecycle boundaries, source map, Model Experience (token/KV-cache effect), known limitations |
| 6 | `packages/extensions/cordis-client-runner/README.zh.md` | read | Chinese mirror of the client-runner contract |
| 7 | `packages/extensions/cordis-client-runner/locale/en.json` | read | locale title string |
| 8 | `packages/extensions/cordis-client-runner/locale/zh.json` | read | locale title + description |
| 9 | `packages/extensions/cordis-client-runner/package.json` | read | manifest: ./client export, dsh.client.inject list, platform web |
| 10 | `packages/extensions/cordis-client-runner/src/client/api-catalog.ts` | read | full read of the 1174-line generated catalog: SERVICE_API/EVENT_API/TYPE_API/INHERITED_CTX_API + queryServiceApi/queryEventApi and referencedTypeCl... |
| 11 | `packages/extensions/cordis-client-runner/src/client/evaluator.ts` | read | closure evaluation, teaching traps, tagged console, style bookkeeping - read fully |
| 12 | `packages/extensions/cordis-client-runner/src/client/guard.ts` | read | whitelisting ctx facade, slots seat priority/ledger, theme seat pinned source, Context denial - read fully |
| 13 | `packages/extensions/cordis-client-runner/src/client/index.ts` | read | plugin entry wiring runner + orchestrator + inspect registry + forwarded host events; CordisRunnerFace - read fully |
| 14 | `packages/extensions/cordis-client-runner/src/client/inspect-registry.ts` | read | provider registry, coalesced publish, serialized sync, query dispatch with abort - read fully |
| 15 | `packages/extensions/cordis-client-runner/src/client/orchestrator.ts` | read | run orchestration, approve/decline races, reconcileApprovals recovery, host-only path - read fully |
| 16 | `packages/extensions/cordis-client-runner/src/client/providers.ts` | read | Service/Event/Builtin/Slots/Theme inspect providers, progressive disclosure projection - read fully |
| 17 | `packages/extensions/cordis-client-runner/src/client/runtime.ts` | read | load engine: convergence, serialization, guard-wrapped mount, three failure stages, teardown, render-failure ownership - read fully |
| 18 | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | skipped | 273 KB / 4902 lines of GENERATED slot data (one repeated entry shape); head 70 + tail 40 read in full, shape/example/source/replaceRisk extracted, ... |
| 19 | `packages/extensions/cordis-client-runner/src/client/timer.ts` | read | browser timer service API-compatible with the host TimerService, fiber-owned disposers - read fully |
| 20 | `packages/extensions/cordis-client-runner/src/index.ts` | read | empty node-half apply() so the row appears in the host loader |
| 21 | `packages/extensions/cordis-client-runner/tests/api-catalog.client.spec.ts` | read | pins service signatures, unique event names, referenced-type-closure projection |
| 22 | `packages/extensions/cordis-client-runner/tests/evaluator.client.spec.ts` | read | pins symbol surface, redirects, null argument, parse/return teaching errors, tagged console, styles |
| 23 | `packages/extensions/cordis-client-runner/tests/guard.client.spec.ts` | read | pins whitelist, shadowing priority, chain priority preservation, factory ledger, Context denial, HMR safety, theme pinning |
| 24 | `packages/extensions/cordis-client-runner/tests/orchestrator.client.spec.ts` | read | pins half ordering, per-stage failure shapes, idempotence, approve/decline races, host-only run |
| 25 | `packages/extensions/cordis-client-runner/tests/plugin.client.spec.ts` | read | pins plugin composition, forwarded events, host.call routing, teaching errors per failure code, render-crash reporting |
| 26 | `packages/extensions/cordis-client-runner/tests/providers.client.spec.ts` | read | pins the live Slots provider (owner fields, phases, discriminated slot/factory nodes) and the guard's allowed key |
| 27 | `packages/extensions/cordis-client-runner/tests/runner.client.spec.ts` | read | pins load convergence, serialization, three failure stages, teardown, retract semantics, render-failure rules |
| 28 | `packages/extensions/cordis-client-runner/tsconfig.json` | read | extends tsconfig.base.client.json with project references |
| 29 | `packages/extensions/cordis-client-runner/tsdown.config.ts` | read | clientBundle one-liner |
| 30 | `packages/extensions/cordis-host-runner/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 31 | `packages/extensions/cordis-host-runner/README.md` | read | host contract: config table, client-inspection timeout policy, define/run/stop/undefine, session-scoped process-local definitions, trust stance |
| 32 | `packages/extensions/cordis-host-runner/README.zh.md` | read | Chinese mirror of the host contract |
| 33 | `packages/extensions/cordis-host-runner/locale/en.json` | read | locale title |
| 34 | `packages/extensions/cordis-host-runner/locale/zh.json` | read | locale title + description |
| 35 | `packages/extensions/cordis-host-runner/package.json` | read | manifest: ./types client-safe subpath, ./typert, ./remote; zod declared for the generated faces |
| 36 | `packages/extensions/cordis-host-runner/src/guard.ts` | read | registration boundary: stack-safe cross-realm JSON clone, schema normalization with teaching errors, marker-guarded tool registration, sandbox ctx ... |
| 37 | `packages/extensions/cordis-host-runner/src/index.ts` | read | 1221 lines read in three chunks: DynamicCordisRunnerService, define/run/stop/undefine, approval arming/claiming, version rollback, steering message... |
| 38 | `packages/extensions/cordis-host-runner/src/inspect-registry.ts` | read | host inspect registry, client query router, bounded wait with a useful timeout message, first-failure retention - read fully |
| 39 | `packages/extensions/cordis-host-runner/src/lifecycle.ts` | read | host-half fiber lifecycle, failed fiber disposed before rethrow, already-registered teaching recipe, missingServices - read fully |
| 40 | `packages/extensions/cordis-host-runner/src/registry.ts` | read | definition registry, never-reused identity mints, current/next package pointers, two separate approval grants - read fully |
| 41 | `packages/extensions/cordis-host-runner/src/sandbox.ts` | read | node:vm sandbox: callable Node-API traps with cordis alternatives, define-time parse gate, dual-realm instanceof, write-through tagged console - re... |
| 42 | `packages/extensions/cordis-host-runner/src/types.ts` | read | client-safe wire vocabulary: branded ids, 9 run statuses, 6 diagnostic phases, discriminated result unions, cordis/* event declarations - read fully |
| 43 | `packages/extensions/cordis-host-runner/tests/composition.spec.ts` | read | pins cross-package provide/inject, parked consumers, stop-reaches-quiescence, duplicate-provide failure |
| 44 | `packages/extensions/cordis-host-runner/tests/helpers.ts` | read | the spec harness: real tool registry, recording gateway whose fake browser answers like the real client runner |
| 45 | `packages/extensions/cordis-host-runner/tests/inspect-registry.spec.ts` | read | head + describe/it titles: client inspect deadline, first-failure retention, retry after publication, disposal settles pending |
| 46 | `packages/extensions/cordis-host-runner/tests/runner.spec.ts` | read | head + describe/it titles: definitions without running, never-reused ids, cross-session hiding, first-answer-wins, shared activation |
| 47 | `packages/extensions/cordis-host-runner/tests/sandbox-context.spec.ts` | read | head + describe/it titles: facade escape surface closed, inject gate, tools.get returns a schema not the definition |
| 48 | `packages/extensions/cordis-host-runner/tests/sandbox.spec.ts` | read | head + describe/it titles: vm isolation, Node-API traps, btoa/atob, dual-realm instanceof, vmTimeoutMs, parse teaching |
| 49 | `packages/extensions/cordis-host-runner/tests/versioning.spec.ts` | read | pins current/next package rollback, aborted approval, attaching page failure not stopping the host run |
| 50 | `packages/extensions/cordis-host-runner/tsconfig.json` | read | project references for the host build |
| 51 | `packages/extensions/tool-cordis/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 52 | `packages/extensions/tool-cordis/README.md` | read | the two read-only inspection tools, the paged live-Loader Config provider, JSON Schema 2020-12 projection |
| 53 | `packages/extensions/tool-cordis/README.zh.md` | read | Chinese mirror of the tool contract |
| 54 | `packages/extensions/tool-cordis/locale/en.json` | read | locale title |
| 55 | `packages/extensions/tool-cordis/locale/host/en.json` | read | host-entry locale title |
| 56 | `packages/extensions/tool-cordis/locale/host/zh.json` | read | host-entry locale title |
| 57 | `packages/extensions/tool-cordis/locale/zh.json` | read | locale title + description |
| 58 | `packages/extensions/tool-cordis/package.json` | read | manifest with a preset entry point and a process-global ./host entry point |
| 59 | `packages/extensions/tool-cordis/src/api-catalog.ts` | skipped | 624 KB / 8960 lines of GENERATED service/event/type data (gen-cordis-api.ts, freshness-gated); head 60 + tail 25 read, projection functions are the... |
| 60 | `packages/extensions/tool-cordis/src/config.ts` | read | live Config discovery from the Loader tree; five-valued ConfigStatus; paged directory with total/nextOffset; per-entry JSON Schema projection - rea... |
| 61 | `packages/extensions/tool-cordis/src/host.ts` | read | process-global host provider row (register once per process, not per preset) - read fully |
| 62 | `packages/extensions/tool-cordis/src/index.ts` | read | registers cordis_inspect_list and cordis_inspect_query; the tool descriptions are the prompt - read fully |
| 63 | `packages/extensions/tool-cordis/src/present.ts` | read | replay-safe GenericCallView intents for the two tools - read fully |
| 64 | `packages/extensions/tool-cordis/src/providers.ts` | read | the four host providers (Service, Event, Config, Tool); the Event provider filters out cordis/* - read fully |
| 65 | `packages/extensions/tool-cordis/tests/config.spec.ts` | read | head + describe/it titles: paged directory, name filter, malformed fields, inactive plugin, package dir + projected schema, no-Loader refusal |
| 66 | `packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` | read | head + describe/it titles: vendored cordis effect/child-publication ownership regressions |
| 67 | `packages/extensions/tool-cordis/tests/host.spec.ts` | read | full read (35 lines): the host entry registers the providers and withdraws them on disposal |
| 68 | `packages/extensions/tool-cordis/tsconfig.json` | read | project references for the tool package |
| 69 | `packages/extensions/ui-cordis/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 70 | `packages/extensions/ui-cordis/README.md` | read | the UI contract: frame-wide unfiltered panel, two independent facts per row, one status marker, request-only rows, define card as a record, busines... |
| 71 | `packages/extensions/ui-cordis/README.zh.md` | read | Chinese mirror of the UI contract |
| 72 | `packages/extensions/ui-cordis/locale/en.json` | read | locale title |
| 73 | `packages/extensions/ui-cordis/locale/zh.json` | read | locale title + description |
| 74 | `packages/extensions/ui-cordis/package.json` | read | manifest: ./client export, eight client injects |
| 75 | `packages/extensions/ui-cordis/src/client/CordisActionRow.tsx` | read | head + exported declarations: the cordis_stop / cordis_undefine cards |
| 76 | `packages/extensions/ui-cordis/src/client/CordisDefineRow.module.css` | read | head 34 + class list (296 lines): define-card chrome, terminal state variant, source tabs |
| 77 | `packages/extensions/ui-cordis/src/client/CordisDefineRow.tsx` | read | head + exported declarations: read-only define card with Host/Client source tabs |
| 78 | `packages/extensions/ui-cordis/src/client/CordisPanel.module.css` | read | head 34 + class list (360 lines): sidebar badge, fixed panel, rail variant |
| 79 | `packages/extensions/ui-cordis/src/client/CordisPanel.tsx` | read | head + exported declarations (507 lines): frame-wide panel, badge, version picker, approve/decline/run/stop/remove, outside-pointer dismiss |
| 80 | `packages/extensions/ui-cordis/src/client/CordisPreparingRow.tsx` | read | full read (30 lines): the shared argument-free preparing row |
| 81 | `packages/extensions/ui-cordis/src/client/CordisRunRow.module.css` | read | head 34 + class list (134 lines): run-card status colours keyed on data-cordis-status |
| 82 | `packages/extensions/ui-cordis/src/client/CordisRunRow.tsx` | read | head + exported declarations: run card, business view from tool.view.cordis, superseded detection |
| 83 | `packages/extensions/ui-cordis/src/client/card-model.ts` | read | replay-stable view models from the frozen call/result slice; truncated args degrade; interrupted is its own state - read fully |
| 84 | `packages/extensions/ui-cordis/src/client/dynamic-port.ts` | read | the RPC seam and the CordisActionResult union - read fully |
| 85 | `packages/extensions/ui-cordis/src/client/events.ts` | read | client-safe type re-exports - read fully |
| 86 | `packages/extensions/ui-cordis/src/client/index.ts` | read | plugin entry: dictionaries, CordisDynamicPort, inventory store, run-card registry, slot registrations, approval reconciliation - read fully |
| 87 | `packages/extensions/ui-cordis/src/client/inventory.ts` | read | single-flight inventory read; re-read not patch; failed read keeps rows; generation counter discards stale reads - read fully |
| 88 | `packages/extensions/ui-cordis/src/client/locales.ts` | read | the bilingual dictionary with satisfies-key checks on both sides - read fully |
| 89 | `packages/extensions/ui-cordis/src/client/run-card-index.ts` | read | per-session business-view ownership index; only a greater log sequence replaces - read fully |
| 90 | `packages/extensions/ui-cordis/src/client/slots.ts` | read | injected faces and the tool.view.cordis slot declaration - read fully |
| 91 | `packages/extensions/ui-cordis/src/client/status.ts` | read | the three visible status readings derived from inventory + page live set - read fully |
| 92 | `packages/extensions/ui-cordis/src/css-modules.d.ts` | read | ambient declarations for *.module.css |
| 93 | `packages/extensions/ui-cordis/src/index.ts` | read | empty node half |
| 94 | `packages/extensions/ui-cordis/tests/card-model.client.spec.ts` | read | head + describe/it titles: define/action card models, truncated args, cut call head |
| 95 | `packages/extensions/ui-cordis/tests/inventory.client.spec.ts` | read | head + describe/it titles: single-flight read, failed read keeps rows, reset forgets, stale read discarded after reconnect |
| 96 | `packages/extensions/ui-cordis/tests/status-icons.client.spec.tsx` | read | head + describe/it titles: failure glyphs retained, dashed glyph for a late activation failure |
| 97 | `packages/extensions/ui-cordis/tests/versioning.client.spec.ts` | read | head + describe/it titles: versioned card models, run-card ownership, three visible statuses |
| 98 | `packages/extensions/ui-cordis/tsconfig.json` | read | client build config |
| 99 | `packages/extensions/ui-cordis/tsdown.config.ts` | read | clientBundle one-liner |
| 100 | `packages/host/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 101 | `packages/host/README.md` | read | the host package map: webserver, frontend-static, the four directory-picker packages, open-in-app, plugin-inventory, product-telemetry-otel and the... |
| 102 | `packages/host/README.zh.md` | skipped | Chinese mirror of the host package map; the EN file was read in full and the pair is mechanically enforced by the i18n hash file |
| 103 | `packages/host/directory-picker-auto/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 104 | `packages/host/directory-picker-auto/README.md` | read | the adaptive chooser: one pure boot-time sample, native needs no remote-authority trust + loopback bind + non-SSH + servable display, anything ambi... |
| 105 | `packages/host/directory-picker-auto/README.zh.md` | skipped | Chinese mirror; EN read in full |
| 106 | `packages/host/directory-picker-auto/locale/en.json` | read | locale title |
| 107 | `packages/host/directory-picker-auto/locale/zh.json` | read | locale title + description |
| 108 | `packages/host/directory-picker-auto/package.json` | read | manifest declaring both backend and surface packages as peer deps |
| 109 | `packages/host/directory-picker-auto/src/index.ts` | read | resolves once at boot and mounts backend + surface as real Loader entries; setup owns the entries it created until it returns the disposer - read f... |
| 110 | `packages/host/directory-picker-auto/src/probe.ts` | read | PATH probe for zenity/kdialog with an injected executability predicate - read fully |
| 111 | `packages/host/directory-picker-auto/src/resolve.ts` | read | the pure backend resolution from sampled host facts; blank env exports count as unset - read fully |
| 112 | `packages/host/directory-picker-auto/tests/loader-composition.spec.ts` | read | head + titles: REAL Loader composition, native mounted for an attended loopback host, unmounted on disposal, unmount on surface failure, tolerate t... |
| 113 | `packages/host/directory-picker-auto/tests/resolve.spec.ts` | read | head + titles: one signal per case, blank env treated as unset, PATH scan skips empty segments |
| 114 | `packages/host/directory-picker-auto/tsconfig.json` | read | project references |
| 115 | `packages/host/directory-picker-browse/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 116 | `packages/host/directory-picker-browse/README.md` | read | the browse backend: one-level listing, maxEntries default 1000 (GitHub's bound), truncated flag, non-recursive creation, single-segment names, full... |
| 117 | `packages/host/directory-picker-browse/README.zh.md` | skipped | Chinese mirror; EN read in full |
| 118 | `packages/host/directory-picker-browse/locale/en.json` | read | locale title |
| 119 | `packages/host/directory-picker-browse/locale/zh.json` | read | locale title + description |
| 120 | `packages/host/directory-picker-browse/package.json` | read | manifest: node-only backend |
| 121 | `packages/host/directory-picker-browse/src/index.ts` | read | the browse backend: boundedInsert name-sorted window, raceAbort, fullyQualified per-platform fence, symlink following, typed DirectoryPickerError -... |
| 122 | `packages/host/directory-picker-browse/tests/service.spec.ts` | read | head + titles: directories only, hidden flag, symlinks, broken links skipped, maxEntries cut, abort stops the scan, typed failures |
| 123 | `packages/host/directory-picker-browse/tsconfig.json` | read | project references |
| 124 | `packages/host/directory-picker-browse/tsdown.config.ts` | read | node-only tsdown config |
| 125 | `packages/host/directory-picker-native/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 126 | `packages/host/directory-picker-native/README.md` | read | the native backend: macOS scripted AppKit panel, Linux Zenity with a KDialog fallback, Windows IFileOpenDialog in a spawned child; a cancel is null... |
| 127 | `packages/host/directory-picker-native/README.zh.md` | skipped | Chinese mirror; EN read in full |
| 128 | `packages/host/directory-picker-native/locale/en.json` | read | locale title |
| 129 | `packages/host/directory-picker-native/locale/zh.json` | read | locale title + description |
| 130 | `packages/host/directory-picker-native/package.json` | read | manifest: koffi dependency, the ./worker CJS export |
| 131 | `packages/host/directory-picker-native/src/index.ts` | read | the native capability registration - read fully |
| 132 | `packages/host/directory-picker-native/src/native-picker.ts` | read | the cross-platform chooser: macOS JXA panel source, Zenity then KDialog, Win32 dialog with no fallback tier, cancel mapping, abort not converted to... |
| 133 | `packages/host/directory-picker-native/src/win32-dialog-bindings.ts` | read | head 30 + API surface (206 lines): koffi-backed COM vtable calls, lazily imported so non-Windows never loads koffi, cross-thread window closer |
| 134 | `packages/host/directory-picker-native/src/win32-dialog-host.ts` | read | head 30 + API surface (34 lines): spawns the dialog child process (built CJS vs source tsx), stdio/ipc |
| 135 | `packages/host/directory-picker-native/src/win32-dialog-logic.ts` | read | head 30 + API surface (147 lines): the pure COM sequencing over injectable bindings, FOS_* flags, HRESULT_CANCELLED, release on every path |
| 136 | `packages/host/directory-picker-native/src/win32-dialog-worker.ts` | read | head 30 + API surface (55 lines): child-process entry, IPC protocol showing/done/error, a child process rather than a worker thread so a native fau... |
| 137 | `packages/host/directory-picker-native/src/win32-dialog.ts` | read | head 30 + API surface (159 lines): the main-thread driver, WM_CLOSE abort service, kill last resort, settle-once |
| 138 | `packages/host/directory-picker-native/tests/built-worker.e2e.ts` | read | head + titles: keyless built-artifact guard; plain node loads lib/worker.cjs and reaches the real koffi requires |
| 139 | `packages/host/directory-picker-native/tests/native-picker.spec.ts` | read | head + titles: macOS Edit-menu panel, Win32 with no fallback, abort rule, Zenity then KDialog |
| 140 | `packages/host/directory-picker-native/tests/service.spec.ts` | read | full read (21 lines): the native backend registers a stable native capability and leaves with its fiber |
| 141 | `packages/host/directory-picker-native/tests/win32-dialog-bindings.spec.ts` | read | head + titles: a fake COM world over a mocked koffi module, DPI tiers, WM_CLOSE poster, the worker entry over a mocked process boundary |
| 142 | `packages/host/directory-picker-native/tests/win32-dialog-logic.spec.ts` | read | head + titles: the COM sequencing against fake bindings, outcome mapping, release on every path |
| 143 | `packages/host/directory-picker-native/tests/win32-dialog.spec.ts` | read | head + titles: the child-process message protocol, the WM_CLOSE abort service, kill last resort, settle-once |
| 144 | `packages/host/directory-picker-native/tsconfig.json` | read | project references |
| 145 | `packages/host/directory-picker-native/tsdown.config.ts` | read | two builds: the ESM backend and the separate CJS worker artifact |
| 146 | `packages/host/directory-picker/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 147 | `packages/host/directory-picker/README.md` | read | the seam contract: a discriminated capability union (native vs browse), the closed three-code error vocabulary, hidden flag and crumbs owned by the... |
| 148 | `packages/host/directory-picker/README.zh.md` | skipped | Chinese mirror; EN read in full |
| 149 | `packages/host/directory-picker/package.json` | read | manifest with a client-safe ./types subpath |
| 150 | `packages/host/directory-picker/src/index.ts` | read | the abstract seam: merge-extensible capability map, DirectoryPickerError with a closed code set, one implementation per context - read fully |
| 151 | `packages/host/directory-picker/src/types.ts` | read | the client-safe listing types: DirectoryEntry and DirectoryListing with the truncation contract - read fully |
| 152 | `packages/host/directory-picker/tests/seam.spec.ts` | read | full read (35 lines): a subclass registers as ctx.directoryPicker and leaves with its fiber; the error carries the code and subject path |
| 153 | `packages/host/directory-picker/tsconfig.json` | read | project references |
| 154 | `packages/host/frontend-static/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 155 | `packages/host/frontend-static/README.md` | read | the SPA dist server: 404/403/405 semantics, index access authenticated but assets public, one instance owns the fallback seat |
| 156 | `packages/host/frontend-static/README.zh.md` | skipped | Chinese mirror; EN read in full |
| 157 | `packages/host/frontend-static/package.json` | read | manifest: the fallback-seat owner |
| 158 | `packages/host/frontend-static/src/index.ts` | read | serveStatic: traversal rejection using sep (not '/'), 404 vs rethrow, index authorized before the bytes are read, base href injection - read fully |
| 159 | `packages/host/frontend-static/tests/frontend-static.spec.ts` | read | head + titles: REAL Loader composition over the served HTTP surface, error semantics, seat release on disposal |
| 160 | `packages/host/frontend-static/tsconfig.json` | read | project references |
| 161 | `packages/host/open-in-app/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 162 | `packages/host/open-in-app/README.md` | read | head 30: the three routes, the fixed application catalog, browser authentication and host-origin trust, no inherited credentials to launched applic... |
| 163 | `packages/host/open-in-app/README.zh.md` | skipped | Chinese mirror; EN head read |
| 164 | `packages/host/open-in-app/locale/en.json` | read | locale title |
| 165 | `packages/host/open-in-app/locale/zh.json` | read | locale title + description |
| 166 | `packages/host/open-in-app/package.json` | read | manifest with the browser-safe ./shared subpath |
| 167 | `packages/host/open-in-app/src/catalog.ts` | read | head 45 + API surface (393 lines): the compile-time application table, the OpenInAppLocator union (fixed/app/xcode/cli/file/scan/appPaths/installRe... |
| 168 | `packages/host/open-in-app/src/icons.ts` | read | icon extraction per platform: macOS plutil+sips, Windows PowerShell ExtractAssociatedIcon, Linux desktop-entry theme lookup; every failure resolves... |
| 169 | `packages/host/open-in-app/src/index.ts` | read | head 45 + API surface (311 lines): the three routes behind the connection trust fence, the 64 KiB body ceiling, wire body validation, one lazy reso... |
| 170 | `packages/host/open-in-app/src/internals.ts` | read | the test seam for host facts - read fully |
| 171 | `packages/host/open-in-app/src/resolver.ts` | read | head 40 + API surface (760 lines): the locator chain resolution, Windows registry view read once per pass, desktop-entry parsing, launch outcome cl... |
| 172 | `packages/host/open-in-app/src/shared.ts` | read | the route paths and wire payloads shared verbatim with the browser package - read fully |
| 173 | `packages/host/open-in-app/tests/host-routes.spec.ts` | read | head + titles: REAL Loader composition, the connection fence on every route, one shared resolution pass, ENOENT refresh, wire validation, 502 on a ... |
| 174 | `packages/host/open-in-app/tests/icons.spec.ts` | read | head + titles: macOS icns conversion, Windows PowerShell extraction, Linux theme lookup sizes-largest-first |
| 175 | `packages/host/open-in-app/tests/launch-detached.spec.ts` | read | head + titles: the detached launch watch window |
| 176 | `packages/host/open-in-app/tests/resolver.spec.ts` | read | head + titles: per-platform locator chains, one-pass resolution, registry read at most once, desktop parsing, launch outcome classification |
| 177 | `packages/host/open-in-app/tsconfig.json` | read | project references |
| 178 | `packages/host/open-in-app/tsdown.config.ts` | read | node-only tsdown config |
| 179 | `packages/host/plugin-inventory/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 180 | `packages/host/plugin-inventory/README.md` | read | head 30: pluginInventory/list is a point-in-time read-only snapshot; no history, no change subscription; Remote-only by design |
| 181 | `packages/host/plugin-inventory/README.zh.md` | skipped | Chinese mirror; EN head read |
| 182 | `packages/host/plugin-inventory/locale/en.json` | read | locale title |
| 183 | `packages/host/plugin-inventory/locale/zh.json` | read | locale title + description |
| 184 | `packages/host/plugin-inventory/package.json` | read | manifest: the preset roster is an optional peer dependency |
| 185 | `packages/host/plugin-inventory/src/index.ts` | read | readPluginInventory reads the Loader on every call (no second cache), maps FiberState to a phase vocabulary, adds preset compositions - read fully |
| 186 | `packages/host/plugin-inventory/src/types.ts` | read | the inventory types: PluginFiberPhase, effective enablement incl. 'conditional', preset groups - read fully |
| 187 | `packages/host/plugin-inventory/tests/inventory.spec.ts` | read | head + titles: one list method under the namespace, current non-group entries without a second cache, preset compositions with fiber phases |
| 188 | `packages/host/plugin-inventory/tsconfig.json` | read | project references |
| 189 | `packages/host/product-telemetry-otel/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 190 | `packages/host/product-telemetry-otel/README.md` | read | head 30: explicit product events only, nothing collected automatically, best effort delivery that does not confirm ingestion |
| 191 | `packages/host/product-telemetry-otel/README.zh.md` | skipped | Chinese mirror; EN head read |
| 192 | `packages/host/product-telemetry-otel/locale/en.json` | read | locale title |
| 193 | `packages/host/product-telemetry-otel/locale/zh.json` | read | locale title + description |
| 194 | `packages/host/product-telemetry-otel/package.json` | read | manifest: OTel SDK dependencies |
| 195 | `packages/host/product-telemetry-otel/src/index.ts` | read | the policy adapter: endpoint/header validation at construction, batch bounds, shutdown deadline that aborts pending exports - read fully |
| 196 | `packages/host/product-telemetry-otel/tests/fixtures/driver.ts` | read | the Loader composition fixture with a loopback collector and one synthetic event |
| 197 | `packages/host/product-telemetry-otel/tests/fixtures/shutdown.patch.yml` | read | the config overlay that disables the other rows and inserts the telemetry row |
| 198 | `packages/host/product-telemetry-otel/tests/fixtures/shutdown.ts` | read | the shutdown fixture: disposal must leave the host free to exit naturally |
| 199 | `packages/host/product-telemetry-otel/tests/fixtures/telemetry.patch.yml` | read | the config overlay that inserts the telemetry row |
| 200 | `packages/host/product-telemetry-otel/tests/loader-composition.e2e.ts` | read | head + titles: exports the explicitly submitted event through the headless Loader composition |
| 201 | `packages/host/product-telemetry-otel/tests/telemetry.spec.ts` | read | head + titles: isolated collector headers, nothing exported on mount, batch threshold, partial batch on interval, permanent rejection reported with... |
| 202 | `packages/host/product-telemetry-otel/tsconfig.json` | read | project references |
| 203 | `packages/host/webserver/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 204 | `packages/host/webserver/README.md` | read | head 30: node:http (node:https with tls), named routes + upgrade routes + one fallback seat, matching order exact then longest prefix then fallback... |
| 205 | `packages/host/webserver/README.zh.md` | skipped | Chinese mirror; EN head read |
| 206 | `packages/host/webserver/locale/en.json` | read | locale title |
| 207 | `packages/host/webserver/locale/zh.json` | read | locale title + description |
| 208 | `packages/host/webserver/package.json` | read | manifest: compression, ipaddr.js, negotiator |
| 209 | `packages/host/webserver/src/index.ts` | read | head 60 + API surface (589 lines): WebRoute/WebUpgradeRoute, bind-address literal validation, wildcard rejection by address value, gzip eligibility... |
| 210 | `packages/host/webserver/src/injections.ts` | read | structured index injection rows (global/script/script-src/script-preload/style/html) with escaping, plus the boot-readiness deferred tail - read fully |
| 211 | `packages/host/webserver/tests/tls-fixture.ts` | read | the disposable localhost TLS material fixture (selfsigned) - head + structure read |
| 212 | `packages/host/webserver/tests/webserver.spec.ts` | read | head + titles: REAL Loader composition, bind-address schema and predicates, gzip eligibility, routes/taps/fallback, fresh injection rows per render... |
| 213 | `packages/host/webserver/tsconfig.json` | read | project references |
| 214 | `packages/typert/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 215 | `packages/typert/README.md` | read | the Typert group map: generator, loader, protocol, registry and their roles |
| 216 | `packages/typert/README.zh.md` | skipped | Chinese mirror; EN read in full |
| 217 | `packages/typert/generator/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 218 | `packages/typert/generator/README.md` | read | head 34: the build-time generator; publication is opt-in via ./typert exports; generation rejects what it cannot represent; runs only at build time |
| 219 | `packages/typert/generator/README.zh.md` | skipped | Chinese mirror; EN head read |
| 220 | `packages/typert/generator/package.json` | read | manifest: the public API plus a ./tsdown build-wiring subpath |
| 221 | `packages/typert/generator/src/analyzer.ts` | read | head 30 + API surface (3468 lines): the TypeScript project analyzer; independent face programs, package registration discovery, source-edit mode, b... |
| 222 | `packages/typert/generator/src/artifact-files.ts` | read | package-local artifact writing; a host artifact without Remote methods removes stale Remote client files - read fully |
| 223 | `packages/typert/generator/src/build-output-guard.ts` | read | head 24 + API surface (225 lines): detects workspace build outputs loaded into an analyzed face program, and imports that resolve to nothing |
| 224 | `packages/typert/generator/src/cordis-catalog.ts` | read | head 26 + API surface (1069 lines): the Cordis catalog projection, its policy object, the fail-closed type-link gate, the rendered page regions wit... |
| 225 | `packages/typert/generator/src/emitter.ts` | read | head 24 + API surface (1234 lines): the model-driven artifact emitter; consumes only FaceModel/TypeGraph, never compiler nodes |
| 226 | `packages/typert/generator/src/index.ts` | read | the public API surface - read fully |
| 227 | `packages/typert/generator/src/model.ts` | read | head 32 + API surface (447 lines): the compiler-independent model - every type node, member, declaration and invocation shape |
| 228 | `packages/typert/generator/src/renderer.ts` | read | head 26 + API surface (365 lines): rendering and traversal over the TypeGraph, so emitters never reach back into TypeScript AST |
| 229 | `packages/typert/generator/src/tool-schema.ts` | read | the lossless projection into the enforced tool-schema subset; a type it cannot express raises ToolSchemaError rather than a weakened schema - read ... |
| 230 | `packages/typert/generator/src/tsdown-plugin.ts` | read | head 24 + API surface (268 lines): the rolldown plugin face; lowers standard decorators, then emits artifacts; workspace mode runs in a Worker Thread |
| 231 | `packages/typert/generator/src/worker.ts` | read | the worker-thread entry: exactly one response, then exit - read fully |
| 232 | `packages/typert/generator/src/workspace.ts` | read | head 32 + API surface (213 lines): workspace discovery and model-driven generation; findWorkspaceRoot, hasTypertExport |
| 233 | `packages/typert/generator/tests/.generated-model-O7FJNT/host.mjs` | skipped | GENERATED artifact (a Typert emission written by a test); head 25 read, structure and TYPERT manifest shape extracted |
| 234 | `packages/typert/generator/tests/.generated-model-qwn8sk/host.mjs` | skipped | GENERATED artifact (same emitter, second run); not read line by line |
| 235 | `packages/typert/generator/tests/__snapshots__/type-model.spec.ts.snap` | skipped | GENERATED vitest snapshot (6484 lines); head 25 read, the snapshot body is the emitted Zod + TYPERT manifest |
| 236 | `packages/typert/generator/tests/cordis-catalog-contract.spec.ts` | read | head + describe/it titles: the fail-closed catalog contract (every @mode, @param and @returns rule has a hard-error case) |
| 237 | `packages/typert/generator/tests/cordis-catalog.spec.ts` | read | head + titles: reproduces every committed catalog artifact byte for byte; referenced framework enums; the Slots declaration within the display budget |
| 238 | `packages/typert/generator/tests/fixtures/remote-model/package.json` | read | the fixture workspace manifest |
| 239 | `packages/typert/generator/tests/fixtures/remote-model/packages/domain/package.json` | read | the domain fixture manifest with its export map |
| 240 | `packages/typert/generator/tests/fixtures/remote-model/packages/domain/src/index.ts` | read | the domain fixture: a Host-only Agent class, a TypertLookupMap and TypertContextMap declaration |
| 241 | `packages/typert/generator/tests/fixtures/remote-model/packages/domain/src/types.ts` | read | the AgentId type |
| 242 | `packages/typert/generator/tests/fixtures/remote-model/packages/domain/tsconfig.json` | read | the domain fixture tsconfig |
| 243 | `packages/typert/generator/tests/fixtures/remote-model/packages/remote/package.json` | read | the remote fixture manifest declaring ./typert and ./remote exports |
| 244 | `packages/typert/generator/tests/fixtures/remote-model/packages/remote/src/index.ts` | read | the remote fixture: @Remote unary, @RemoteScope, and @Remote({mode:'stream'}) methods on a TypertRemoteService |
| 245 | `packages/typert/generator/tests/fixtures/remote-model/packages/remote/src/types.ts` | read | the remote fixture request/result types |
| 246 | `packages/typert/generator/tests/fixtures/remote-model/packages/remote/tsconfig.json` | read | the remote fixture tsconfig |
| 247 | `packages/typert/generator/tests/fixtures/remote-model/tsconfig.base.json` | read | the fixture base tsconfig with the path mappings the analyzer resolves |
| 248 | `packages/typert/generator/tests/fixtures/remote-model/tsconfig.host.json` | read | the fixture host aggregate tsconfig |
| 249 | `packages/typert/generator/tests/fixtures/remote-model/typert-protocol.d.ts` | read | the fixture's stand-in protocol declaration (the whole decorator/descriptor contract the analyzer reads) |
| 250 | `packages/typert/generator/tests/fixtures/type-model/cordis.d.ts` | read | the fixture's minimal cordis declaration |
| 251 | `packages/typert/generator/tests/fixtures/type-model/package.json` | read | the fixture workspace manifest |
| 252 | `packages/typert/generator/tests/fixtures/type-model/packages/client/package.json` | read | the client fixture manifest |
| 253 | `packages/typert/generator/tests/fixtures/type-model/packages/client/src/index.ts` | read | the client fixture: cross-face type references, re-exports and inheritance |
| 254 | `packages/typert/generator/tests/fixtures/type-model/packages/client/tsconfig.json` | read | the client fixture tsconfig |
| 255 | `packages/typert/generator/tests/fixtures/type-model/packages/host/package.json` | read | the host fixture manifest |
| 256 | `packages/typert/generator/tests/fixtures/type-model/packages/host/src/index.ts` | read | the host fixture: @typert object annotation, aliased and default-only services, Context and Events merges, ignored members |
| 257 | `packages/typert/generator/tests/fixtures/type-model/packages/host/src/models.ts` | read | the type-syntax zoo fixture: every TypeNode shape reachable from one public declaration |
| 258 | `packages/typert/generator/tests/fixtures/type-model/packages/host/tsconfig.json` | read | the host fixture tsconfig |
| 259 | `packages/typert/generator/tests/fixtures/type-model/packages/write/package.json` | read | the write-mode fixture manifest |
| 260 | `packages/typert/generator/tests/fixtures/type-model/packages/write/src/index.ts` | read | the write-mode fixture: a service with intentionally absent public annotations |
| 261 | `packages/typert/generator/tests/fixtures/type-model/packages/write/tsconfig.json` | read | the write fixture tsconfig |
| 262 | `packages/typert/generator/tests/fixtures/type-model/tsconfig.base.json` | read | the fixture base tsconfig |
| 263 | `packages/typert/generator/tests/fixtures/type-model/tsconfig.client.json` | read | the fixture client aggregate tsconfig |
| 264 | `packages/typert/generator/tests/fixtures/type-model/tsconfig.host.json` | read | the fixture host aggregate tsconfig |
| 265 | `packages/typert/generator/tests/fixtures/type-model/tsconfig.json` | read | the fixture root tsconfig |
| 266 | `packages/typert/generator/tests/fixtures/type-model/tsconfig.write.json` | read | the fixture write aggregate tsconfig |
| 267 | `packages/typert/generator/tests/remote-metadata.spec.ts` | read | head + titles: the Remote method metadata contract - strict vs ordinary input views, tool-schema projection, recursive parsers, discriminator unions |
| 268 | `packages/typert/generator/tests/remote-model.spec.ts` | read | head + titles: the Remote model contract - binary results, lookup parameters, stream uplinks, scope rules, duplicate endpoint rejection |
| 269 | `packages/typert/generator/tests/remote-module.ts` | read | the source-only evaluator for generated artifacts (loads generated JS with the current protocol factory) - read fully |
| 270 | `packages/typert/generator/tests/renderer.spec.ts` | read | head + titles: the renderer's defensive shapes and broken-edge failures |
| 271 | `packages/typert/generator/tests/schema-emitter.spec.ts` | read | head + titles: the schema emitter's supported and unsupported projection matrices |
| 272 | `packages/typert/generator/tests/tools-catalog.spec.ts` | read | head + titles: round-trips the complete service and event structure through the runtime registry |
| 273 | `packages/typert/generator/tests/tsdown-plugin-worker.spec.ts` | read | head + titles: the worker thread writes the same artifacts as in-process generation; a worker analysis error fails the bundle |
| 274 | `packages/typert/generator/tests/tsdown-plugin.spec.ts` | read | head + titles: decorator lowering, transform filtering, stale Remote artifact removal, and every worker failure mode |
| 275 | `packages/typert/generator/tests/type-model-workspace.ts` | read | the in-memory fixture workspaces: node:fs is mocked, so a spec never touches the disk |
| 276 | `packages/typert/generator/tests/type-model.spec.ts` | read | head + titles (1733 lines): the analyzer contract - independent face models, cross-face edges, forwarding modules, merged declarations, check vs wr... |
| 277 | `packages/typert/generator/tsconfig.json` | read | project references |
| 278 | `packages/typert/loader/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 279 | `packages/typert/loader/README.md` | read | head 34: mounted packages auto-contribute their generated reflection and schemas, and withdraw them on unmount; packages without the export are ski... |
| 280 | `packages/typert/loader/README.zh.md` | skipped | Chinese mirror; EN head read |
| 281 | `packages/typert/loader/locale/en.json` | read | locale title |
| 282 | `packages/typert/loader/locale/zh.json` | read | locale title + description |
| 283 | `packages/typert/loader/package.json` | read | manifest |
| 284 | `packages/typert/loader/src/index.ts` | read | head 24 + API surface (507 lines): discovery of ./typert exports, manifest validation, incremental per-entry-name scanning, fail-loud vs contained ... |
| 285 | `packages/typert/loader/tests/lazy-info.spec.ts` | read | full read: loading a contribution must not request consumer-owned input views or projections |
| 286 | `packages/typert/loader/tests/loader.spec.ts` | read | head + titles: auto-registration, withdrawal on unmount, explicit packages, negative verdict caching, manifest validation |
| 287 | `packages/typert/loader/tsconfig.json` | read | project references |
| 288 | `packages/typert/protocol/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 289 | `packages/typert/protocol/README.md` | read | head 34: @Remote and @RemoteScope decorators, wire identity maps, one failure class, forwarded host events |
| 290 | `packages/typert/protocol/README.zh.md` | skipped | Chinese mirror; EN head read |
| 291 | `packages/typert/protocol/package.json` | read | manifest with a ./types and a ./remote-info subpath |
| 292 | `packages/typert/protocol/src/index.ts` | read | head 26 + API surface (484 lines): the decorators, the versioned prototype descriptor, bindTypertRemote, TypertRemoteService, remoteMethods |
| 293 | `packages/typert/protocol/src/json-value.ts` | read | lossless JSON checks shared by every carrier: no coercion, no omission, no nested undefined, no -0 - read fully |
| 294 | `packages/typert/protocol/src/owned-value.ts` | read | invocation-owned values: a borrowed payload plus an idempotent cleanup, with no extra reference count - read fully |
| 295 | `packages/typert/protocol/src/principal.ts` | read | reads the non-owner caller of the current Remote call - read fully |
| 296 | `packages/typert/protocol/src/remote-access.ts` | read | the access-control resource vocabulary: the built-in global resource plus one resource per declared kind - read fully |
| 297 | `packages/typert/protocol/src/remote-error.ts` | read | the one Remote failure class, discriminated by a structural marker, never by instanceof - read fully |
| 298 | `packages/typert/protocol/src/remote-info.ts` | read | head 26 + API surface (161 lines): lazy assembly of generated Remote definitions; parsers and projections are built only on request |
| 299 | `packages/typert/protocol/src/types.ts` | read | head 24 + API surface (939 lines): the compiler-independent protocol - lookup/context maps, invocation descriptors, codecs, principals, streams |
| 300 | `packages/typert/protocol/tests/built-runtime.e2e.ts` | read | head + titles: the published protocol entry must stay free of Zod runtime imports |
| 301 | `packages/typert/protocol/tests/fixtures/source-launch.ts` | read | the source-launch fixture that executes standard decorator syntax - read fully |
| 302 | `packages/typert/protocol/tests/owned-value.spec.ts` | read | full read: ownership stays generic, idempotent and shared across bundles |
| 303 | `packages/typert/protocol/tests/protocol.spec.ts` | read | head + titles: the marker descriptor, idempotence, resource readers, scoped waterfalls, the invocation accessor |
| 304 | `packages/typert/protocol/tests/remote-access.spec.ts` | read | head + titles: principalOf, the resource union, and the frozen reader records |
| 305 | `packages/typert/protocol/tests/remote-info.spec.ts` | read | head + titles: lazy index/schema/projection construction, named omissions, stream handles |
| 306 | `packages/typert/protocol/tsconfig.json` | read | project references |
| 307 | `packages/typert/registry/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 308 | `packages/typert/registry/README.md` | read | head 34: generated reflection, lazy Zod schema factories and Remote descriptors under stable keys; registrations are atomic and fiber-scoped |
| 309 | `packages/typert/registry/README.zh.md` | skipped | Chinese mirror; EN head read |
| 310 | `packages/typert/registry/locale/en.json` | read | locale title |
| 311 | `packages/typert/registry/locale/zh.json` | read | locale title + description |
| 312 | `packages/typert/registry/package.json` | read | manifest with the dual client export (node + browser bundles) and an immediately-mounted client face |
| 313 | `packages/typert/registry/src/client/index.ts` | read | the browser face installing the same registry implementation - read fully |
| 314 | `packages/typert/registry/src/index.ts` | read | the host entry and the TypertRegistryContract declaration - read fully |
| 315 | `packages/typert/registry/src/service.ts` | read | head 24 + API surface (805 lines): the runtime registry - schema records, package models, invocation descriptors, lookup/context/resource providers... |
| 316 | `packages/typert/registry/src/types.ts` | read | head 24 + API surface (118 lines): the generated-artifact and runtime-registry types |
| 317 | `packages/typert/registry/tests/typert.spec.ts` | read | head + titles: atomic registration and withdrawal, schema materialization, provider registries, the global resource reservation, change-listener co... |
| 318 | `packages/typert/registry/tsconfig.json` | read | project references |
| 319 | `packages/typert/registry/tsdown.config.ts` | read | the dual client bundle config |
| 320 | `packages/util/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 321 | `packages/util/README.md` | read | the util package map: shared mechanical primitives, every root entry a library with no product service |
| 322 | `packages/util/README.zh.md` | skipped | Chinese mirror; EN head read |
| 323 | `packages/util/atomic-write/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 324 | `packages/util/atomic-write/README.md` | read | head 18: atomic replacement without partial content or symlink hijack, cross-process writer lock, caller-selected permission bits, no fsync durability |
| 325 | `packages/util/atomic-write/README.zh.md` | read | head 18: Chinese mirror |
| 326 | `packages/util/atomic-write/package.json` | read | manifest: zero-dependency library |
| 327 | `packages/util/atomic-write/src/index.ts` | read | writeFileAtomic (exclusive-create temp + rename carrying the stated mode) and withFileLock (a wx lock sibling, dead-holder takeover under a claim) ... |
| 328 | `packages/util/atomic-write/tests/atomic-write.spec.ts` | read | head + titles: mode narrowing, symlink replacement, Windows rename retries, and every lock takeover race |
| 329 | `packages/util/atomic-write/tsconfig.json` | read | project references |
| 330 | `packages/util/brand/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 331 | `packages/util/brand/README.md` | read | head 18: nominal string/number brands with no shared runtime state, so duplicate installs stay interchangeable |
| 332 | `packages/util/brand/README.zh.md` | read | head 18: Chinese mirror |
| 333 | `packages/util/brand/package.json` | read | manifest |
| 334 | `packages/util/brand/src/index.ts` | read | Branded/BrandedNumber plus brandString/brandNumber - read fully |
| 335 | `packages/util/brand/tests/brand.spec.ts` | read | full read (13 lines): a number is branded without changing its runtime value |
| 336 | `packages/util/brand/tsconfig.json` | read | project references |
| 337 | `packages/util/chunked-list/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 338 | `packages/util/chunked-list/README.md` | read | head 18: immutable append-only lists with bounded copying and Zod checkpoint validation |
| 339 | `packages/util/chunked-list/README.zh.md` | read | head 18: Chinese mirror |
| 340 | `packages/util/chunked-list/package.json` | read | manifest with the zod dependency |
| 341 | `packages/util/chunked-list/src/index.ts` | read | appendChunkedList (copies at most one 64-value chunk), iterateChunkedList, chunkedListSchema - read fully |
| 342 | `packages/util/chunked-list/tests/chunked-list.spec.ts` | read | head + titles: prefix immutability across chunk rollovers, JSON checkpoint round-trip |
| 343 | `packages/util/chunked-list/tsconfig.json` | read | project references |
| 344 | `packages/util/code-language/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 345 | `packages/util/code-language/README.md` | read | head 17: the one extension-to-grammar table shared by the client preview and the host read card; readLangHintForPath keeps already-persisted values |
| 346 | `packages/util/code-language/README.zh.md` | read | head 17: Chinese mirror |
| 347 | `packages/util/code-language/package.json` | read | manifest |
| 348 | `packages/util/code-language/src/index.ts` | read | the extension table, the Map (not object) lookup, the persisted-hint overrides and the short-id table - read fully |
| 349 | `packages/util/code-language/tests/code-language.spec.ts` | read | head + titles: case-insensitivity, Object.prototype-key safety, the persisted short hints, every suffix listed once |
| 350 | `packages/util/code-language/tsconfig.json` | read | project references |
| 351 | `packages/util/crypto/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 352 | `packages/util/crypto/README.md` | read | head 17: UUID minting that works outside a secure context; a lint rule points randomUUID callers here |
| 353 | `packages/util/crypto/README.zh.md` | read | head 17: Chinese mirror |
| 354 | `packages/util/crypto/package.json` | read | manifest |
| 355 | `packages/util/crypto/src/index.ts` | read | randomUUID from crypto.getRandomValues with RFC 9562 version/variant bits, plus chunked bytesToBase64 - read fully |
| 356 | `packages/util/crypto/tests/uuid.spec.ts` | read | head + titles: RFC 9562 shape, uniqueness, and no dependence on crypto.randomUUID |
| 357 | `packages/util/crypto/tsconfig.json` | read | project references |
| 358 | `packages/util/deque/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 359 | `packages/util/deque/README.md` | read | head 18: circular deque, amortized constant-time ends, immediate release of removed entries |
| 360 | `packages/util/deque/README.zh.md` | read | head 18: Chinese mirror |
| 361 | `packages/util/deque/benchmarks/drain.ts` | read | the drain benchmark: median of 5 samples at 250k-2M entries with a checksum guard - read fully |
| 362 | `packages/util/deque/package.json` | read | manifest |
| 363 | `packages/util/deque/src/index.ts` | read | the circular buffer with growth, sparse compaction at a quarter capacity, and immediate reference clearing - read fully |
| 364 | `packages/util/deque/tests/deque.spec.ts` | read | head + titles: FIFO order, wrapping, sparse compaction, reference release, size vs undefined |
| 365 | `packages/util/deque/tsconfig.json` | read | project references |
| 366 | `packages/util/home-paths/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 367 | `packages/util/home-paths/README.md` | read | head 18: the DSH home and the shared agents home, with a display form that never reveals an absolute machine path |
| 368 | `packages/util/home-paths/README.zh.md` | read | head 18: Chinese mirror |
| 369 | `packages/util/home-paths/package.json` | read | manifest |
| 370 | `packages/util/home-paths/src/index.ts` | read | resolveDshHome/resolveAgentsHome precedence, expandHomePath, canonicalizeWatchPath, and the symbolic display helpers - read fully |
| 371 | `packages/util/home-paths/tests/home-paths.spec.ts` | read | head + titles: precedence, blank env treated as unset, display labelling, watcher canonicalization |
| 372 | `packages/util/home-paths/tsconfig.json` | read | project references |
| 373 | `packages/util/http-proxy/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 374 | `packages/util/http-proxy/README.md` | read | head 18: one outbound proxy policy applied to every Node fetch; loopback stays direct; unsupported proxy URLs are reported |
| 375 | `packages/util/http-proxy/README.zh.md` | read | head 18: Chinese mirror |
| 376 | `packages/util/http-proxy/package.json` | read | manifest with the undici dependency |
| 377 | `packages/util/http-proxy/src/index.ts` | read | the public four-function surface - read fully |
| 378 | `packages/util/http-proxy/src/install.ts` | read | head 22 + API surface (315 lines): the undici global dispatcher installation, the child environment, and the cleared environment |
| 379 | `packages/util/http-proxy/src/policy.ts` | read | head 22 + API surface (343 lines): the pure policy resolution, the loopback matcher, and the bypass rules |
| 380 | `packages/util/http-proxy/tests/install.spec.ts` | read | head + titles: global fetch routing, bypass, environment publication and restoration, nested installs |
| 381 | `packages/util/http-proxy/tests/matcher-parity.spec.ts` | read | head + titles: the bypass matcher agrees with the installed dispatcher's own matcher |
| 382 | `packages/util/http-proxy/tests/policy.spec.ts` | read | head + titles: scheme precedence, ALL_PROXY fallback, refused values staying direct, IPv6 loopback forms |
| 383 | `packages/util/http-proxy/tsconfig.json` | read | project references |
| 384 | `packages/util/launch-environment/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 385 | `packages/util/launch-environment/README.md` | read | head 18: an immutable environment snapshot that records which layer supplied each value; layers can be excluded |
| 386 | `packages/util/launch-environment/README.zh.md` | read | head 18: Chinese mirror |
| 387 | `packages/util/launch-environment/package.json` | read | manifest |
| 388 | `packages/util/launch-environment/src/index.ts` | read | the three-layer snapshot (process, project .env, user .env), Windows name folding, and the SSH detection - read fully |
| 389 | `packages/util/launch-environment/tests/launch-environment.spec.ts` | read | head + titles: trust order, layer filtering, copy-on-snapshot, empty values kept |
| 390 | `packages/util/launch-environment/tsconfig.json` | read | project references |
| 391 | `packages/util/lazy-require/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 392 | `packages/util/lazy-require/README.md` | read | head 18: caller-relative lazy loading for CommonJS-compatible host dependencies; a failed load is not cached |
| 393 | `packages/util/lazy-require/README.zh.md` | read | head 18: Chinese mirror |
| 394 | `packages/util/lazy-require/package.json` | read | manifest |
| 395 | `packages/util/lazy-require/src/index.ts` | read | createLazyRequire over node:module createRequire - read fully |
| 396 | `packages/util/lazy-require/tests/fixtures/value.cjs` | read | the CJS fixture that counts its own loads - read fully |
| 397 | `packages/util/lazy-require/tests/index.spec.ts` | read | head + titles: resolves from the caller and caches the successful value; a failed load is not cached |
| 398 | `packages/util/lazy-require/tsconfig.json` | read | project references |
| 399 | `packages/util/native-command/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 400 | `packages/util/native-command/README.md` | read | head 18: shell-free host command execution, path opening, desktop detection and WSL handoff |
| 401 | `packages/util/native-command/README.zh.md` | read | head 18: Chinese mirror |
| 402 | `packages/util/native-command/package.json` | read | manifest with a browser-safe ./types subpath |
| 403 | `packages/util/native-command/src/desktop-entry.ts` | read | head 16 + API surface (76 lines): XDG desktop-entry fields, data directories and the theme icon lookup |
| 404 | `packages/util/native-command/src/file-applications-linux.ts` | read | head 16 + API surface (66 lines): Linux file associations from GIO with shared XDG metadata |
| 405 | `packages/util/native-command/src/file-applications-windows.ts` | read | head 16 + API surface (276 lines): the Windows Shell association query and invocation; paths are encoded data, never PowerShell expressions |
| 406 | `packages/util/native-command/src/file-applications.ts` | read | head 16 + API surface (200 lines): the per-platform association query, the macOS dedupe by version, and the explicit-handler launch |
| 407 | `packages/util/native-command/src/index.ts` | read | the public surface - read fully |
| 408 | `packages/util/native-command/src/path-opener.ts` | read | head 16 + API surface (315 lines): the open/reveal/text-editor intents, the browser-renderable document set, and the WSL translation |
| 409 | `packages/util/native-command/src/runner.ts` | read | the shared no-shell execFile runner with cancellation and explicit window visibility - read fully |
| 410 | `packages/util/native-command/src/types.ts` | read | the browser-safe NativeFileApplication metadata and its parser - read fully |
| 411 | `packages/util/native-command/tests/file-applications-linux-native.spec.ts` | read | head + structure: real GIO discovery in private XDG roots |
| 412 | `packages/util/native-command/tests/file-applications-linux.spec.ts` | read | head + titles: GIO handler dedupe, nested desktop ids, artwork reuse |
| 413 | `packages/util/native-command/tests/file-applications-windows.spec.ts` | read | head + structure: real Windows Shell discovery and invocation |
| 414 | `packages/util/native-command/tests/file-applications.spec.ts` | read | head + titles: dedupe by version, explicit handler authorization, the CreateProcess command-line limit |
| 415 | `packages/util/native-command/tests/native-command.spec.ts` | read | head + titles: stdout/stderr capture, non-zero exit, ENOENT, abort termination |
| 416 | `packages/util/native-command/tests/path-opener.spec.ts` | read | head + titles: per-platform open, browser-renderable documents, WSL translation, canOpenNativePath |
| 417 | `packages/util/native-command/tsconfig.json` | read | project references |
| 418 | `packages/util/output-retention/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 419 | `packages/util/output-retention/README.md` | read | head 18: bounded model-facing output - an item retainer, a text retainer, and a standardized omission footer with tool-owned recovery guidance |
| 420 | `packages/util/output-retention/README.zh.md` | read | head 18: Chinese mirror |
| 421 | `packages/util/output-retention/package.json` | read | manifest |
| 422 | `packages/util/output-retention/src/index.ts` | read | ItemRetainer (head window, exact omitted count), TextRetainer (head/tail/headTail byte windows with UTF-8 boundary trimming), describeOmitted, form... |
| 423 | `packages/util/output-retention/tests/output-retention.spec.ts` | read | head + titles: exact omission counts, zero budgets, the head\|tail split never dropping a codepoint, byte-exact omission |
| 424 | `packages/util/output-retention/tsconfig.json` | read | project references |
| 425 | `packages/util/package-manifest/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 426 | `packages/util/package-manifest/README.md` | read | head 18: the shared manifest declarations; each reader owns its own parsing and defaults |
| 427 | `packages/util/package-manifest/README.zh.md` | read | head 18: Chinese mirror |
| 428 | `packages/util/package-manifest/package.json` | read | manifest |
| 429 | `packages/util/package-manifest/src/index.ts` | read | the type re-exports only - read fully |
| 430 | `packages/util/package-manifest/src/types.ts` | read | the manifest declarations, including the client manifest and the localized-text shape - read fully |
| 431 | `packages/util/package-manifest/tsconfig.json` | read | project references |
| 432 | `packages/util/plugin-market-index/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 433 | `packages/util/plugin-market-index/README.md` | read | head 18: the executable rule set for plugin market index format 1 |
| 434 | `packages/util/plugin-market-index/README.zh.md` | read | head 18: Chinese mirror |
| 435 | `packages/util/plugin-market-index/package.json` | read | manifest with semver |
| 436 | `packages/util/plugin-market-index/src/index.ts` | read | head 22 + API surface (330 lines): parseMarketIndex with a JSON-path error, the inline icon size cap, and marketInstallTarget |
| 437 | `packages/util/plugin-market-index/src/types.ts` | read | the validated market index record types - read fully |
| 438 | `packages/util/plugin-market-index/tests/plugin-market-index.spec.ts` | read | head + titles: every format-1 rule with the offending JSON path, __proto__ as an ordinary key, pinned install targets |
| 439 | `packages/util/plugin-market-index/tsconfig.json` | read | project references |
| 440 | `packages/util/time/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 441 | `packages/util/time/README.md` | read | head 18: IANA zone validation and canonicalization only; each boundary throws its own domain code |
| 442 | `packages/util/time/README.zh.md` | read | head 18: Chinese mirror |
| 443 | `packages/util/time/package.json` | read | manifest |
| 444 | `packages/util/time/src/index.ts` | read | canonicalClientTimeZone - the platform-canonical spelling, or undefined - read fully |
| 445 | `packages/util/time/tests/time.spec.ts` | read | head + titles: UTC and Area/Location accepted, alias canonicalized, blank/padded/abbreviated refused |
| 446 | `packages/util/time/tsconfig.json` | read | project references |
| 447 | `packages/util/timeout/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 448 | `packages/util/timeout/README.md` | read | head 18: timeout arithmetic, deadline fusion, and timeout-vs-cancel classification; the library only notifies through signals |
| 449 | `packages/util/timeout/README.zh.md` | read | head 18: Chinese mirror |
| 450 | `packages/util/timeout/package.json` | read | manifest |
| 451 | `packages/util/timeout/src/index.ts` | read | clampTimeout, deadline (AbortSignal.any fusion), idleWatchdog (a rearmable idle timer that only counts waiting time), timeoutOf, TimeoutReason - re... |
| 452 | `packages/util/timeout/tests/timeout.spec.ts` | read | head + titles: clamping, the timeout arm, the upstream fusion race, the no-timeout sentinel, timeoutOf classification |
| 453 | `packages/util/timeout/tsconfig.json` | read | project references |
| 454 | `packages/util/values/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 455 | `packages/util/values/README.md` | read | head 18: lossless JSON validation, detached snapshots, deep freezing, structural equality and partial-argument reading |
| 456 | `packages/util/values/README.zh.md` | read | head 18: Chinese mirror |
| 457 | `packages/util/values/package.json` | read | manifest |
| 458 | `packages/util/values/src/index.ts` | read | assertNever, the iterative lossless-JSON walker, snapshotJsonValue, isJsonValue, deepEqualJson, deepFreeze (leaves AbortSignal live), WeakMapWithVa... |
| 459 | `packages/util/values/src/partial-json.ts` | read | head 22 + API surface (666 lines): PartialArguments, a lazily scanned view over streaming tool-call arguments with change detection |
| 460 | `packages/util/values/tests/partial-json.spec.ts` | read | head + titles: sealed vs streaming views, settlement, structural equality, the streaming readers |
| 461 | `packages/util/values/tests/weak-map-with-values.spec.ts` | read | head + titles: weak keys with strongly retained values in insertion order |
| 462 | `packages/util/values/tsconfig.json` | read | project references |
| 463 | `packages/util/workspace-path/README.i18n.yaml` | skipped | generated bilingual-pair hash record; head read |
| 464 | `packages/util/workspace-path/README.md` | read | head 18: browser-safe workspace path helpers plus the dsh-resource://file/... address grammar |
| 465 | `packages/util/workspace-path/README.zh.md` | read | head 18: Chinese mirror |
| 466 | `packages/util/workspace-path/package.json` | read | manifest |
| 467 | `packages/util/workspace-path/src/file-address.ts` | read | head 22 + API surface (112 lines): the file-address grammar - session-scoped and absolute addresses, built and parsed without a filesystem |
| 468 | `packages/util/workspace-path/src/index.ts` | read | read fully: isAbsoluteWorkspacePath, resolveWorkspacePath, abbreviateHomePath, workspaceTitleOf, pathPartsOf, fileAddressFor, relativizeToCwd, file... |
| 469 | `packages/util/workspace-path/tests/file-address.spec.ts` | read | head + titles: round-trips for session, absolute POSIX, Windows drive and UNC addresses |
| 470 | `packages/util/workspace-path/tests/file-media-url.spec.ts` | read | head + titles: the authenticated file route URL for POSIX and Windows paths |
| 471 | `packages/util/workspace-path/tests/index.spec.ts` | read | head + titles: addressing, absoluteness, resolution, home abbreviation, path splitting |
| 472 | `packages/util/workspace-path/tsconfig.json` | read | project references |

