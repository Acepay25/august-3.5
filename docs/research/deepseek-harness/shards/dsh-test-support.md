# deepseek-harness :: dsh-test-support

**Files in shard:** 213 (read: 205, skipped with reason: 8 — the eight `generated-vendored` `README.i18n.yaml` bilingual-pair hash records, confirmed by head peek only)
**What this shard covers:** the whole `packages/test-support/` group of the DeepSeek Harness monorepo — eight packages that let the rest of the repo test itself with no provider key and no business Host: `agent-loop-testkit` (mounting the production AgentLoop + Inbox doubles), `client-runtime` (a jsdom slot bench plus a whole-client boot tier), `llm-mock-server` (a scriptable Messages/SSE fault server), `llm-replay` (recorded-transcript replay with an override sidecar), `loader-smoke` (a packaged/subprocess boot lane), `remote-mock` (an endpoint-named RPC mock with a live log), and `session-snapshot` (a 1760-line snapshot suite factory, its normalizers, its manifest schema, and 91 committed fixtures). Every package is *test* infrastructure; the group's stated exit rule is "a package moves out of this group when it gains a product contract and product consumers" (`packages/test-support/README.md`).

**A note that recurs through every entry below:** this group has one governing idea — **fail loud, never fake**. An unstubbed method throws naming itself; an unregistered endpoint fails the test at teardown; a malformed manifest is rejected before any comparison is trusted; a script cursor refuses to advance on an invalid request; a fixture whose expectation was under-consumed fails with a diagnostic instead of passing quietly. That is the single most transferable thing in the shard.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry (41 files)

#### `packages/test-support/agent-loop-testkit/src/index.ts`
- **Purpose:** the two mounting helpers every agent-loop test starts from — `mountAgentLoopTestDependencies(ctx, options)` and `mountAgentLoopTestHarness(ctx)`.
- **Key abstractions:** `AgentLoopTestHarness` (`create(id, options?, meta?)`, `claim(agent, target, turn)`), `AgentLoopTestDependenciesOptions` (`workingDirectory`, `systemPrompt`, `tools`), and a private `DriverInbox extends Inbox` that adds the production `claim(target, turn)`.
- **Data flow:** `mountAgentLoopTestDependencies` mounts **six** plugins in a fixed order — LLM runtime, session store, session-projection registry, system-prompt registry, tool runtime, agent registry — and **deliberately stops before `AgentLoop`** (`src/index.ts:88-99`). The caller therefore controls the loop's load order.
- **Non-obvious design decisions:**
  - Options are **forwarded untouched**: the helper "provides no test defaults beyond those services' own defaults", so a test that wants a persona supplies it and a production default can never be masked by a test default.
  - `mountAgentLoopTestHarness` mounts the *public production plugin* (`ctx.plugin(AgentLoop, { agents: [] })`) and reaches the concrete agent's inbox through a locally-declared interface rather than exporting the loop's `Inbox` class or projection definition (`src/index.ts:100-113`). The test surface stays narrow; the implementation is production.
  - **No LLM adapter is mounted.** A test that starts the loop must register the route it exercises — the README states this as a known limitation, and it is what keeps "the loop ran" from being a fiction.
  - `workingDirectory: true` mounts `FsLocal` only `if (ctx.get('fs') === undefined)` (`src/index.ts:93`), so a suite that already mounted its own filesystem keeps it.
- **Edge cases & failure handling:** a plugin-load failure rejects the promise; the README states that "services activated earlier in the sequence remain context-owned and unwind when the context is disposed" — there is no rollback, the context is the unit of teardown.
- **Surprising:** 113 lines that only wire plugins. The interesting behaviour is in `inbox.ts` and in what the *caller* is forbidden from doing.

#### `packages/test-support/agent-loop-testkit/src/inbox.ts`
- **Purpose:** two Inbox doubles — a mutable process-local one and a fail-fast "unsupported" one.
- **Key abstractions:** `createInboxStub(): Inbox`, `unsupportedInbox(): Inbox`.
- **Data flow:** `createInboxStub` keeps two arrays keyed by `InboxTarget` (`'next-turn'`, `'next-step'`); a private `locate(messageId)` scans both so `replace`/`remove` work by id regardless of queue.
- **Non-obvious design decisions:**
  - The stub **never writes to a Session** — "two process-local arrays and never writes to a Session". Durability requires a harness-created Agent.
  - `unsupportedInbox()` throws on **every** mutation with one message, `'this test Agent does not support Inbox mutations'` (`src/inbox.ts:71-79`) — the "fail at the first unexpected dependency" pattern.
  - `nextTurn`/`nextStep` are **live array references**, not copies, so a spec can inspect the queue without an accessor.
- **Edge cases & failure handling:** `replace`/`remove` return `false` for an unknown id rather than throwing — a missing id is a normal outcome, not an error.
- **Surprising:** `unsupportedInbox` still exposes empty arrays, so **reading is allowed and changing is not**.

#### `packages/test-support/agent-loop-testkit/src/working-directory-fixture.ts`
- **Purpose:** a directory collaborator for consumer-only tests with structural Agent stubs.
- **Key abstractions:** `provideWorkingDirectoryFixture(ctx, defaultDirectory = process.cwd())`.
- **Data flow:** registers a `workingDirectory` service with `defaultDirectory`, a `get(session)` preferring `session.header.cwd`, and an `ensure(agent)` resolving the same value.
- **Non-obvious design decisions:** it explicitly **does not validate paths, change directories, or record events**; directory-*behaviour* tests are routed to the real `mountAgentLoopTestDependencies(ctx, { workingDirectory: true })` with temp dirs.
- **Edge cases & failure handling:** none — that is the point. Anything that can fail belongs in the real fixture.
- **Surprising:** a 16-line file whose only job is to keep the "no second implementation" rule intact.

#### `packages/test-support/client-runtime/src/index.ts`
- **Purpose:** `SlotTestRuntime` — the jsdom bench that mounts the *production* SlotRegistry, renderer and ui-session adapter around test-owned doubles.
- **Key abstractions:** `SlotTestRuntime` (`create()`, `mount()`, `declare()`, `renderSlot()`, `storeOf()`, `factoryOf()`, `flush()`, `dispose()`), `SlotView<K>`, `FeatureHandle`, `TestFileUpload`, `TestRoot`, and the private `OwnerPropsCell` external store.
- **Data flow:** `create()` → new Cordis `Context` → mount `SlotRegistry` → construct the runtime (provides `sessions`, `workspaces`, `fileUpload`; installs the renderer) → mount `allowAllAccessPlugin` → mount the ui-session plugin via its published `apply`/`inject` (`src/index.ts:301-307`). A spec then `declare()`s slot keys, `mount()`s a plugin, and `renderSlot(key, owner)` returns a scoped view.
- **Non-obvious design decisions:**
  - **Nothing is reimplemented.** "It copies no SlotCore/renderer/store machinery — everything mounts the production implementations." ui-session is mounted by importing its published `apply`/`inject` pair rather than re-deriving its wiring.
  - **`mount()` pre-checks required services** (`src/index.ts:319-325`): `Inject.resolve(plugin.inject)` is compared with the context and a missing service throws `"mount would suspend: missing service(s) … — provide() them first"`. A missing provider would otherwise *suspend the fiber forever*, silently.
  - **Every public mutator is act-wrapped** through one `stabilizer` (`src/index.ts:259-261`); tests never handle SlotCore microtask batching or React `act`.
  - `renderSlot` throws if the key was not declared, and throws a **different** message if the auto frame rendered no wrapper ("was the runtime already disposed?") — two distinct diagnoses.
  - `storeOf` refuses before `renderRoot()`: "the host face exists only inside the installed renderer, exactly as in production".
  - `dispose()` is idempotent and ordered: unmount React trees → dispose feature fibers → release the root registration → release the two default root sources → dispose minted session scopes → dispose the context → `localStorage.clear()` (`src/index.ts:518-534`).
- **Edge cases & failure handling:** `fileUpload.upload` rejects every call until a suite replaces it. `releaseWorkspaceSource()` / `releasePanelInfoSource()` exist so the bench's default source does not shadow the production Layout owner.
- **Surprising:** the auto frame renders **keyed Fragments only** — the renderer already emits the `<div data-slot>` anchor, and a second wrapper would nest duplicate anchors under the same key (`src/index.ts:399-417`). And `OwnerPropsCell` is a hand-rolled `useSyncExternalStore` store, so `view.update(owner)` re-renders through the *standard* uSES boundary rather than a test-only shortcut.

#### `packages/test-support/client-runtime/src/sessions.ts`
- **Purpose:** `TestSessions` + `FixtureSession` — the test-owned Session Controller face.
- **Key abstractions:** `TestSessions implements ISessions`, `FixtureSession implements SessionFace`, `TestSessionReference` (private), plus internal `SessionRecord` / `SessionGeneration` / `OpeningControl`.
- **Data flow:** a fixture is *declared* (`add(fixture)`) into a catalog record; a *generation* (a live Cordis scope) is **materialised lazily** when something retains the session (`retain` → `materialize` → `createScope(this.rootCtx, id)`), and dropped when the last reference is released.
- **Non-obvious design decisions:**
  - **Catalog and generation are separate.** `add()` never retains; the README says the fixture "resolves subagent addresses from explicitly supplied addresses or loaded parent projections **without retaining a Session generation**". That split lets a spec declare a row that is never opened.
  - **Every unstubbed verb throws with the fixture's identity and the fix**: `'test session "s1": prompt is not stubbed — supply it on the fixture\'s session face'` (`src/sessions.ts:107-110` and siblings). `SessionBehaviorOverrides = Partial<ISession> & Record<string, unknown>` keeps the production verbs type-safe while extras stay permissive — and the docblock states the exact hazard of that trade.
  - **`beginSubmission` is a local echo** — mints `test-submission-N` ids without touching the fixture snapshot, because "submission echoes are client-only presentation state".
  - **Retention is reference-counted per source**, and the counts are published into both the retention store and the list row's `retainedBy`.
  - The file carries explicit `/* jscpd:ignore-start -- The fixture intentionally mirrors production SessionReference settlement and release semantics. */` markers (`src/sessions.ts:190-232`, `419-451`) — the duplication is *deliberate* and the reason is written down.
- **Edge cases & failure handling:** `retain` on a closed controller throws; `retain` rolls back (`reference.release()`) if `attachOpening` throws. `using(target, options, operation)` awaits `reference.ready` and **always** releases in `finally`. A fixture's `initialOpen` promise is the generation's *opening barrier*: `ready` resolves only after it settles, and a rejection propagates to every waiter. Scope-disposal failures are **logged, not thrown**; `drainDrops()` waits for outstanding disposals at teardown.
- **Surprising:** `search` returns an **empty page by default** — "content ranking is Host behavior, so a scenario that asserts hits declares them through `stubSearch`". And `fork` is a **recorded no-op** returning the source id and creating no child: "this face only proves the call".

#### `packages/test-support/client-runtime/src/workspaces.ts`
- **Purpose:** `TestWorkspaces` — the test-owned Workspace Controller face.
- **Key abstractions:** `TestWorkspaces implements IWorkspaces` with a `list` snapshot store, a `calls` log, and a `stub(method, impl)` seat.
- **Data flow:** the runtime provides `workspaces` as a service and publishes `workspaces.list` as a root hook. Every action records into `calls` and then either uses an installed stub or applies the **production-observable** default.
- **Non-obvious design decisions:** the defaults are not inert — `archiveSession` adds the id to `archivedSessionIds`, `pinSession` *prepends* it to `pinnedSessionIds` ("the id leads the list state's pin set"), and the un-variants remove it. These mirror the production face's observable effect so a UI assertion is meaningful.
- **Edge cases & failure handling:** the stub is looked up **after** the call is recorded, so a spec can assert the call happened even when the stub throws.
- **Surprising:** `insertSessionBefore` echoes `title: ''` and `path: ''` — a deliberately empty echo so a test that reads those fields is forced to stub the action. `initializeDefault` has **no default behaviour** (returns `undefined` unless stubbed), matching "first-use initialization is ineligible".

#### `packages/test-support/client-runtime/src/access.ts`
- **Purpose:** the allow-all stand-in for the remote-access Client row.
- **Key abstractions:** `allowAllAccess: AccessStandardProps` (four hooks, all `() => true`), `allowAllAccessPlugin`.
- **Data flow:** the plugin provides a `remoteAccess` service whose `source` returns one constant `HostObservable<boolean>` and registers a root hook `remoteAccess` so ui-session / ui-workspace publish their resource hooks over it.
- **Non-obvious design decisions:** the **same object** is reused for every resource, so a test cannot distinguish "allowed for A" from "allowed for B" — the point is only that nothing is refused.
- **Edge cases & failure handling:** the observable's `subscribe` returns a no-op disposer; there is no listener bookkeeping because the value never changes.
- **Surprising:** the plugin is installed **before** ui-session in `SlotTestRuntime.create()` — ordering matters and the README calls it out.

#### `packages/test-support/client-runtime/src/remote.ts`
- **Purpose:** `TestRemote` — the `ctx.remote` double for the forwarded-event path.
- **Key abstractions:** the class itself (`$host`, `$on`, `emit`, `$mount`, `provideNamespaces`).
- **Data flow:** the constructor registers itself as `ctx.remote` **plus one service per scripted namespace** (`ctx.provide('remote.' + name, face)`), so a plugin injecting `remote.<name>` unparks.
- **Non-obvious design decisions:**
  - **A namespace that would shadow the double's own member is refused**: `TypeError('TestRemote: scripted namespace "…" would shadow the double\'s own member')` (`src/remote.ts:58-64`). The reason is written down: `$mount`'s rejection is the contract a spec relies on.
  - **`$mount` always rejects** — "you have outgrown me" rather than pretending.
  - **A throwing listener propagates out of `emit`** instead of being contained and logged. The docblock calls this a *deliberate asymmetry with production*: "a spec cannot lean on this double for the containment guarantee `$on` documents — assert that against the real service."
- **Edge cases & failure handling:** `emit` on an unknown event is a no-op.
- **Surprising:** the package re-exports the **`RemoteError` constructor as a value** from `@deepseek-ai/dsh-typert-protocol`, because the `dsh-api-remotes` facade cannot carry it — a value import from a spec would pull that assembly's *unbuilt* `/remote` artifact chain (`src/remote.ts:3-7`). A packaging constraint leaking into a test package's public API.

#### `packages/test-support/client-runtime/src/fixtures.ts`
- **Purpose:** plain fixture builders for the controller/UI snapshot shapes.
- **Key abstractions:** `sessionSnapshot(id)`, `conversationSnapshot(overrides)`, `chatSnapshot(overrides)`, `workspaceSnapshot()`, plus `SessionBehaviorOverrides`, `Stabilizer`, `FixtureSnapshot<T>`.
- **Data flow:** each builder returns an immutable value a fixture spreads overrides over.
- **Non-obvious design decisions:** the docblock states the exact type-system trade: "The open Record tail means a misnamed EXTRA member is not caught by the compiler (it grafts as dead weight); the ISession verbs stay safe — a misnamed verb leaves the fail-loud stub in place, which names itself at the first call."
- **Edge cases & failure handling:** `sessionSnapshot` returns a *complete* quiescent snapshot (14 fields) so an override never has to fill in the rest.
- **Surprising:** `conversationSnapshot` and `chatSnapshot` are kept **separate** from `sessionSnapshot` — "Assembly tests provide Session event entries instead of adding Conversation or Chat fields to `SessionSnapshot`." One giant fixture object would let a test invent state the product could never produce.

#### `packages/test-support/client-runtime/src/snapshot.ts`
- **Purpose:** a Vitest snapshot serializer that keeps `.snap` files structural.
- **Key abstractions:** `domSnapshotSerializer` (a `SnapshotSerializer`), `registerDomSnapshotSerializer()`.
- **Data flow:** `test()` checks whether the subtree carries a CSS-module scoped class (`/^_(.+)_[a-z0-9]+$/`) or any `<svg>` with children. `serialize()` **clones** the element, rewrites class attributes to their semantic locals (`_frame_a1b2c3` → `frame`), replaces each `<svg>`'s children with a `data-content` FNV-1a fingerprint of its inner HTML, and prints the clone.
- **Non-obvious design decisions:** **the clone is the point** — both normalizations happen "on a clone (the live DOM is untouched, so class/tag queries keep working)". The clone no longer matches the serializer's own predicate, so vitest falls through to the built-in DOM element serializer. The SVG **fingerprint still flips when the artwork changes**, so an icon change is not silently lost.
- **Edge cases & failure handling:** registration is idempotent via a module flag; `test()` guards `typeof Element !== 'undefined'`.
- **Surprising:** the local name may itself contain underscores (the regex is greedy), and tokens are matched per whitespace-separated class token, so foreign class names pass through untouched.

#### `packages/test-support/client-runtime/src/translate.ts`
- **Purpose:** a test double of the locale lookup chain.
- **Key abstractions:** `makeTranslate(...dicts)`.
- **Data flow:** the returned function walks the dictionaries in order, takes the first that owns the key, otherwise returns the **key itself** (so the key stays visible), then interpolates `{name}` placeholders.
- **Non-obvious design decisions:** the fallback is the key, not an empty string — a spec asserting untranslated copy sees the key and can spot it.
- **Edge cases & failure handling:** an unknown placeholder is left verbatim.
- **Surprising:** a 30-line file that mirrors the production resolution order so specs do not re-implement the chain.

#### `packages/test-support/client-runtime/src/locale-env.ts`
- **Purpose:** pin `navigator.languages` / `navigator.language` for localized-copy specs.
- **Key abstractions:** `usePinnedBrowserLanguages(primary, ...rest)`.
- **Data flow:** a `beforeEach` defines the two own properties on `navigator`; an `afterEach` **deletes** them, which uncovers the environment's own accessors again.
- **Non-obvious design decisions:** the comment explains the trick: "Navigator declares both readonly, hence the erased receiver" (`src/locale-env.ts:20-22`).
- **Edge cases & failure handling:** it calls the vitest hooks at the point of call, so it must be used at suite level.
- **Surprising:** it exists because jsdom reports the *runner's* language (`en-US`), so "a spec asserting the product's Chinese copy states the browser it assumes instead of inheriting the machine's".

#### `packages/test-support/client-runtime/src/config-form.ts`
- **Purpose:** `stubConfigForm<T>()` — an in-memory settings scope for service specs.
- **Key abstractions:** `StubConfigForm<T>` = `{ scope, set, mutate, unset, listenerCount(), publish(next) }`.
- **Data flow:** the stub starts in the `loading` state with `writable: false`; `set`/`mutate`/`unset` are `vi.fn()` spies resolving `true`; `publish(next)` merges a partial snapshot and notifies every subscriber (the Host-acceptance path).
- **Non-obvious design decisions:** `publish` notifies over a **copy** of the listener set, so a listener that unsubscribes during notification cannot corrupt the iteration.
- **Edge cases & failure handling:** `listenerCount()` exists so a spec can assert **disposal**.
- **Surprising:** the writes resolve `true` regardless of `writable`; the stub is a *transport* double, not a permission model.

#### `packages/test-support/client-runtime/src/assembly/roster.ts`
- **Purpose:** `ClientRoster` — the ordered package-name rows a whole-client test boots — plus `graphFromRoster` and `assertPlan`.
- **Key abstractions:** `ClientRosterRow` (`name`, `inject`, `immediately`), `ClientRoster` (`of`, `pick`, `closure`, `without`), `AssemblyPlan` (`{ roster, provide? }`), `ClientPluginModule`.
- **Data flow:** `graphFromRoster(rows)` synthesizes a raw `WebBootGraph` with one `application` batch, `rev: 'local'`, and placeholder `plugins/<name>/client.js` URLs — **nothing is ever fetched**.
- **Non-obvious design decisions:**
  - **Validation is deliberately left to production**: "Validation stays with the production `parseBootManifest` inside the module system: duplicate names and an empty roster are rejected there, not here." (`ClientRoster.of` *does* reject duplicates itself, but the graph-level validation is not duplicated.)
  - `closure(names)` computes the **transitive inject cone** in roster order and stops at `PLATFORM_SEED` (the shell's statically seeded modules). A row injecting a package outside the roster throws — "the bundle itself would not boot".
  - `pick`, `without` and `closure` all **throw on unknown names**, and the message prints the whole roster so the fix is obvious.
- **Edge cases & failure handling:** `closure` visits each name once, so a cycle in the inject graph terminates.
- **Surprising:** the whole-client tier runs the *real* production module system with a queue of pre-arrived factories — the "no second implementation" rule survives into the assembly tier.

#### `packages/test-support/client-runtime/src/assembly/test-client.ts`
- **Purpose:** `TestClient` — boots an `AssemblyPlan` through the production `bootClient` over an in-process module table.
- **Key abstractions:** `TestClient.start(plan, mock, options)`, `TestClientOptions` (`mount`, `awaitConnected`, `connectTimeoutMs`), and the private ref-counted `SharedJsdomShims`.
- **Data flow:** `assertPlan` → refuse `provide` for the two generated-Remote packages → drop those rows → `loadPluginModules` → replace the Connection row's `apply` with one that installs the mock's `rpc` carrier → acquire the jsdom shims → `createInProcessModules(graphFromRoster(...))` → mount the `remote.<ns>` proxies → optionally mount `allowAllAccessPlugin` → `bootClient(...)` → optionally `mountClient(ctx, element)` → wait for `ctx.connection.state === 'connected'`.
- **Non-obvious design decisions:**
  - **The mock is bound to the client's own Connection instance**, not to a page global — "starts and reloads can overlap without changing a page global."
  - **The generated-Remote rows are dropped, not stubbed**; a `provide` entry for either is **refused**. Their behaviour is replaced by contract-free `remote.<ns>` proxies and allow-all access hooks.
  - **The jsdom shims are reference-counted** and the disposer deletes **exactly** the globals it installed, restoring the original `document.fonts` descriptor when it had one. Only `EventSource` and `ResizeObserver` are shimmed, and only when absent.
  - **The readiness timeout message carries the mock log** — unmatched endpoints and stream states — so a timeout is diagnosable from the failure text alone.
  - **Teardown error composition:** `dispose()` disposes the tree, then runs `mock.assertNoUnmatched()` *last*; when both fail it throws one error carrying both messages with the tree failure as `cause`.
  - `reload(name)` is registry-first: `tearDownEntryFiber(entry)` then `entry.refresh()`.
- **Edge cases & failure handling:** on any boot failure the context is disposed, an owned mount removed and the shims released **before** the original error is rethrown; a half-built tree that fails to dispose is swallowed ("The boot failure is the error to report"). `dispose()` is idempotent — the first call owns the teardown, later calls await it.
- **Surprising:** `resolveMountPoint` throws a **directive-shaped** error when there is no DOM: `"client-test-runtime: mount requires a DOM; add '// @vitest-environment jsdom' to the spec"`. The harness tells you exactly what to add.

#### `packages/test-support/client-runtime/src/assembly/modules.ts`
- **Purpose:** in-process module arrival — import each roster row's `/client` module and register it as a pre-arrived factory.
- **Key abstractions:** `MODULES_PACKAGE`, `loadPluginModules(plan)`, `createInProcessModules(graph, modules)`.
- **Data flow:** `loadPluginModules` returns a `Map<packageName, module>`; `createInProcessModules` builds a `ClientModuleLoaderTarget` in `mode: 'queue'`, pushes one factory per non-bootstrap module, and creates the production `ClientModuleSystem` with `loadBundle: url => Promise.reject(...)`.
- **Non-obvious design decisions:**
  - The **bootstrap row is special-cased**: `@deepseek-ai/dsh-client-modules` is always this process's static namespace, and providing it throws ("is the bootstrap module and cannot be provided").
  - `loadBundle` **rejects rather than fetches** — "in-process modules never load bundles". The tier cannot accidentally hit the network.
  - The import is `await import(\`${name}/client\`)` with a `/* @vite-ignore */`, and failures are re-wrapped with the package name prefix.
- **Edge cases & failure handling:** the `load` sink throws "module facade is not initialized" but is marked `/* v8 ignore next */` because construction replaces it before the queue drains.
- **Surprising:** `staticModules` is **empty** — "namespaces already hold their own imports", so the production facade's static-module path is unused.

#### `packages/test-support/client-runtime/src/assembly/remote-proxies.ts`
- **Purpose:** contract-free `remote.<ns>` services for the whole-client tier.
- **Key abstractions:** `REMOTES_PACKAGE`, `remoteNamespacesOf(modules, mock)`, `remoteProxiesPlugin(namespaces, mock)`.
- **Data flow:** for each namespace, `ctx.provide('remote.' + ns, proxy)`. The proxy's `get` returns a function mapping `remote.<ns>.<method>(...args)` to the endpoint `<ns>/<method>` on the Connection's `rpc`, as a **stream** when `mock.modeOf(endpoint) === 'stream'`, otherwise a unary call.
- **Non-obvious design decisions:**
  - **The namespace proxy has no `then` property**: "awaiting the namespace object itself must not call a method."
  - **A trailing `AbortSignal` argument is popped** and forwarded; the rejection is folded the way the *generated* client folds a carrier throw: `cancelledFailure` when the signal aborted, `carrierFailure` otherwise.
  - Namespaces come from **two** sources: every `remote.<ns>` a roster module injects, plus the namespace of every endpoint the mock has a rule for.
- **Edge cases & failure handling:** an endpoint without a rule is still dispatched (the mock logs it and `dispose()` fails the test); a stream endpoint the spec never declared is treated as a unary call — a documented limitation.
- **Surprising:** the proxy bypasses the Gateway client's `invoke`/`invokeStream` entirely — no `$mount` lifecycle check, no `normalizeConnectionStream` re-marking.

#### `packages/test-support/client-runtime/src/assembly/remote-default-responses.ts`
- **Purpose:** the default responses for every Remote endpoint the web assembly calls while booting.
- **Key abstractions:** `remoteDefaultResponses: RemoteTable`.
- **Data flow:** a spec loads this table first and layers its own with `mock.load(table)`; anything without a rule fails the test at `dispose()` via `mock.assertNoUnmatched()`.
- **Non-obvious design decisions:**
  - **Every row carries the name of the plugin that calls it** as a comment (`// ui-settings 'mirror.ensure()' at apply and again on 'connection/reset'`). The file doubles as a map of the product's boot-time calls.
  - **Endpoints the boot never touches stay absent** "so a new call fails loud."
  - Streams opened *later* than boot are declared in `RemoteTable.streams` (`'session/follow'`) so a spec that forgets to script one gets a **stream miss** rather than a silent unary.
- **Edge cases & failure handling:** each stream script opens with a **baseline** event then opens — matching the production stream contract.
- **Surprising:** the default model-catalogue answer names a concrete provider/model (`deepseek-official` / `deepseek-v4-flash`) — the bench must return something the hero chip can render.

#### `packages/test-support/client-runtime/src/assembly/bundle-roster.ts`
- **Purpose:** read the `web` profile's browser roster from the bundle patch files, the way the launcher composes them.
- **Key abstractions:** `WEB_PROFILE_BUNDLES`, `bundleRoster(bundles, anchor?, disabledContext?)`, `webApp`.
- **Data flow:** for each bundle → resolve its `package.json` → read `dsh.bundle.patch` → parse each listed YAML file with the **include plugin's own** `entryListSchema` → compose with the include plugin's `applyEntryPatches` → flatten Loader groups → for each enabled row whose package declares `dsh.client.platform === 'web'`, build a `ClientRosterRow` with that declaration's `inject` and `immediately`.
- **Non-obvious design decisions:**
  - **The production parser is reused, not re-implemented** (`applyEntryPatches`, `entryListSchema`, `evaluate`, `isJsExpr`, `exactPackageSpecifier`, `parseDshClient`). The test tier sees exactly what the launcher sees.
  - **A patch that matches nothing THROWS here where the launcher only warns** — a deliberate strictness upgrade for tests.
  - `disabled` expressions are evaluated only when an explicit Loader scope is supplied; without one, a browser row with an unevaluatable `disabled` value throws ("a `!!js` expression").
  - **Nothing is copied from the bundles**: "a bundle change is visible at the next import." The roster is *live*, not a snapshot.
  - `locateManifest` resolves package manifests through `createRequire(anchor).resolve.paths(name)`, depth by depth, so a **linked bundle resolves from its own dependency directory** and takes precedence over an ancestor's copy.
  - `webApp` supplies the profile *name* (`{ profileContext: { name: 'web' } }`) — "not business Host services".
- **Edge cases & failure handling:** a bundle whose manifest names a different package than expected throws; a row whose package cannot be resolved throws with the bundle list; a manifest with no `dsh.client` declaration, or a non-`web` platform, is silently skipped (that is the filter, not an error).
- **Surprising:** this is the **only** place in the whole-client tier that touches the repository filesystem, and it is explicitly Node-only.

#### `packages/test-support/client-runtime/src/assembly/vitest.ts`
- **Purpose:** the Vitest fixtures `createClientTest(plan, options)` returns.
- **Key abstractions:** `ClientTestFixtures` = `{ mock, remote, start }`.
- **Data flow:** the `mock` fixture creates a `RemoteMock` loaded with `remoteDefaultResponses`; `remote` hands back `mock.remote`; `start` lazily calls `TestClient.start(plan, mock, options)`.
- **Non-obvious design decisions:**
  - **Repeated `start()` calls share one promise**, and the rejection handler is attached *immediately* — "Startup belongs to the caller; keep a rejection handler attached until teardown can await it" — so an unhandled rejection cannot crash the worker.
  - **Teardown waits for startup but does not rethrow its rejection**, then disposes the client, and **calls `mock.assertNoUnmatched()` even when no client was started**.
  - `start()` **after the fixture closed rejects**: "start() called after its test fixture closed".
- **Edge cases & failure handling:** the `mock` fixture's `finally` block always runs `assertNoUnmatched()`.
- **Surprising:** "These fixtures isolate their own state, not page globals such as `location`."

#### `packages/test-support/client-runtime/src/assembly/index.ts`
- **Purpose:** the whole-client entry point, **kept out of the package root** so slot-tier specs never load the assembly machinery. Exports `ClientRoster`, `TestClient`, `remoteDefaultResponses`, `bundleRoster`/`webApp`, `createClientTest`.

#### `packages/test-support/llm-mock-server/src/index.ts`
- **Purpose:** `startMockLlmServer` — a scriptable Messages-compatible HTTP/SSE server that consumes one behaviour per accepted request.
- **Key abstractions:** `MOCK_LLM_BEHAVIORS` (24 names), `MockLlmBehavior`, `ConcreteMockLlmBehavior`, `MockLlmRandomWeights`, `DEFAULT_MOCK_LLM_RANDOM_WEIGHTS`, `MockLlmRequestOutcome`, `MockLlmServerEvent`, `MockLlmRequestRecord`, `MockLlmServerOptions`, `MockLlmServer`.
- **Data flow:** `resolveOptions` validates everything up front → `createServer` handler → validate method / path / API key / JSON body → **only then** advance the FIFO cursor → build a `MockLlmRequestRecord` → emit a `request` telemetry event → `runBehavior` executes the wire result → `finishRecord` emits a `result` event.
- **Non-obvious design decisions:**
  - **Validation precedes the cursor.** "Invalid requests do not consume the script" — a misconfigured client can burn retries without advancing the sequence. This is a deliberate, documented property.
  - **The server never retries and never interprets harness policy.**
  - **`random` resolves at request time** through a seeded PRNG (mulberry32-style), so a run is reproducible from the printed seed; the record keeps **both** `scriptBehavior: 'random'` and the concrete `behavior`.
  - **`DEFAULT_MOCK_LLM_RANDOM_WEIGHTS` is explicitly labelled test pressure, not an estimate of production incident frequency** (`success: 48, slow_success: 10, max_tokens: 2, connection_reset: 5, stream_disconnect: 5, partial_disconnect: 10, empty: 5, stall: 2, rate_limit: 5, server_error: 4, service_unavailable: 2, partial_eof: 1, malformed_json: 1`).
  - **The telemetry observer can never affect the wire** — `emit()` wraps the observer in try/catch.
  - **`pause(ms, response)` is response-owned**: the timer aborts when the response closes, so a client that disconnects mid-stream leaves no timer running.
  - **`splitText` splits by Unicode code point** (`Array.from(text)`), so a chunk boundary never splits a surrogate pair.
  - **The `retry-after` header rounds up to whole seconds**, matching the header's unit.
- **Edge cases & failure handling:** script exhaustion returns a **structured** HTTP 500 (`MOCK_SCRIPT_EXHAUSTED`) unless `repeatLast`. `context_overflow` returns 400 with code `context_length_exceeded`; `auth_error` returns 401 `invalid_api_key`; `quota_exceeded` returns 429 `insufficient_quota` — **different codes for two different 429s**. The `response.once('close')` handler marks an unfinished request `client_closed`. `close()` is idempotent and force-closes all connections. A handler-wide `catch` turns an unexpected throw into a 500 `MOCK_HANDLER_FAILED`.
- **Surprising:** `wrong_content_type` sends a **valid SSE body under `application/json`** — a realistic misconfiguration easy to miss in a hand-written double.

#### `packages/test-support/llm-mock-server/src/cli.ts`
- **Purpose:** dependency-free CLI parsing for the standalone server.
- **Key abstractions:** `parseMockLlmCliArgs(argv)`, `MOCK_LLM_CLI_USAGE`, `MockLlmCliConfig`, `CONNECTION_REFUSED_BEHAVIOR`.
- **Data flow:** `node:util` `parseArgs` (strict, no positionals) tokenises; every numeric, bounded or cross-option rule is validated manually below it.
- **Non-obvious design decisions:**
  - **The CLI owns one behaviour the library does not**: `connection_refused` is a *listener-lifecycle* phase, not a request behaviour. It is stripped from the sequence before the library sees it and the CLI performs the pre-listen delay itself.
  - `connection_refused` must be the FIRST entry and must be followed by a request behaviour; it requires an explicit nonzero `--port`.
  - `--listen-delay-ms` is only legal together with `connection_refused`.
  - `--seed` and `--random-weights` are only legal when the sequence contains `random`.
  - **A random weight must name a concrete behaviour** — `random=1` is refused.
- **Edge cases & failure handling:** delays are bounded to `MAX_MOCK_LLM_TIMER_DELAY_MS = 2_147_483_647`; `retryAfterMs` must additionally be positive. Duplicated weights are rejected.
- **Surprising:** `--help` returns *before* `--sequence` is checked, so it works with no other argument.

#### `packages/test-support/llm-mock-server/src/bin.ts`
- **Purpose:** the standalone process wrapper (`pnpm run mock:llm`).
- **Data flow:** parse argv → on `connection_refused` print an `unavailable` JSONL record, sleep, then start the server → print a `ready` record carrying `baseURL` and `randomSeed` → stream every server event to stdout as JSONL → on SIGINT/SIGTERM close and exit 130/143.
- **Non-obvious design decisions:** the **JSONL protocol on stdout** is the integration surface. `close()` is guarded by a `closing` flag so a double signal cannot double-exit.
- **Edge cases & failure handling:** a parse failure writes the message plus the usage text to stderr and sets `process.exitCode = 1`.
- **Surprising:** the whole file is wrapped in `/* v8 ignore start -- thin process/signal glue … */` — the coverage policy excludes process glue explicitly rather than by accident.

#### `packages/test-support/llm-replay/src/index.ts`
- **Purpose:** the keyless snapshot-test LLM replay — derive one model-call script per recorded session and bind fresh live sessions to parent/child scripts by first-call order.
- **Key abstractions:** `ReplayEntry` (`chunks` | `throw` | `hang`), `ReplayOverrideDoc` (`ReplayEntry[]` | `{ patches }`), `ReplayOverridePatch`, `ReplayConfig`, `ReplayHandle` (`dispose`, `assertConsumed`), `SessionScript`, `ReplayModelConfig`, `ReplayProviderConfig`.
- **Data flow:** `apply(ctx, config)` resolves fixture paths from config or `$DSH_SNAPSHOT_*` → `installLlmReplay(ctx, config)` → `loadSessionScripts(config)` parses and migrates each fixture through the **build-static Session format catalog** → `deriveReplayScript(events)` expands each `assistant/message`/`assistant/attempt` stream into one `chunks` entry → the live `stream()` call claims the next unclaimed script by session id → `replayEntry()` yields the recorded chunks.
- **Non-obvious design decisions:**
  - **The fixture is migrated in memory and never rewritten**: "The parser never rewrites or renames the fixture."
  - **Projected rows get deterministic dense sequences and zero timestamps**; packed chunk rows (`text-chunks`, `reasoning-chunks`, `tool-call-chunks`) are given `seq0`/`time0` and their cardinality from the payload length.
  - **A non-empty stream without a `finish` chunk is the fingerprint of a thrown `stream()`** and derivation *refuses* it: "this scenario needs a replay.override.json sidecar."
  - **A `compaction/summary` carrying `llmStreamCall: true` and a complete `rawOutput` replays as one canonical successful stream** at that event's position.
  - **`{{fromRequest:<regex>}}` placeholders** resolve against the live request's string leaves at stream time — the **last** match wins, and its first capture group (or the whole match) substitutes in place. The closing-brace scan is written to allow a pattern ending in a brace quantifier.
  - **`{{session:N}}` tokens** materialise the live session id bound at that ordinal; using one before the child binds throws.
  - **`inferStartedSubagents`** learns a background child id from the stable tool-result text ("started subagent …") before that child reaches its first model call.
  - **The DeepSeek request-extension acceptance point is reproduced**: for `provider === 'deepseek-official'` and an accepted entry, the plugin calls `extensions.prepare({ body: { messages: [] } })` and `prepared.accept()` — "Replay reproduces post-2xx side effects, not the provider wire body."
  - **A script-exhaustion and an unrecorded-session call both fail loud** with messages that name what to do ("re-record the scenario").
  - **`assertConsumed()`** throws unless every recorded script bound to a live session and every bound cursor drained — "the scenario drove fewer model calls than recorded".
  - **`paceMs`** adds a per-chunk delay so a downstream transport sees genuinely incremental delivery; "A realism knob only — correctness must never depend on it."
- **Edge cases & failure handling:** `apply` requires a fixture path from config or env and throws otherwise; `paceMs` must be a non-negative integer; `validateConfiguredModels` rejects a non-text/image modality, a non-positive `imageRequestTokens`, `imageRequestTokens` on a text-only route, a `systemPromptUpdate` other than `in-history`, and an unknown `toolUpdate` mode — each with a message naming the provider and model.
- **Surprising:** the module throws at **load time** if the format catalog's version and the Session package's version disagree — a build-consistency gate, not a runtime check. And the recorded session ids are *diagnostic only*: live ids bind by ordered first use.

#### `packages/test-support/loader-smoke/src/index.ts`
- **Purpose:** the shared subprocess harness — mode-aware launch resolution plus `runLoaderSmoke`.
- **Key abstractions:** `ExampleMode` (`'src' | 'lib'`), `EXAMPLE_MODE_ENV` (`DSH_EXAMPLE_MODE`), `resolveExampleMode`, `ExampleLaunchOptions`, `ExampleLaunch`, `LoaderSmokeOptions`, `LoaderSmokeResult`, `runLoaderSmoke`.
- **Data flow:** `runLoaderSmoke` creates (or reuses) the cwd → runs `prepare(cwd)` → `resolveExampleLaunch` → spawns under `execa` with `input: ''` (writes nothing and closes stdin) and a deadline → on timeout or an unexpected exit code throws with **both captured streams embedded** → runs `inspect(cwd)` → returns `{ stdout, stderr }`; the `finally` removes only a cwd the harness created.
- **Non-obvious design decisions:**
  - **`src` mode is the zero-build dev path** (`node --import tsx <srcBin>` with `TSX_TSCONFIG_PATH` set); **`lib` mode runs the built bin under plain Node** so bare package plugins resolve through real package `exports` — "exactly as an installed consumer resolves them". CI sets `lib`; dev leaves it unset.
  - **An invalid mode fails loud**: "must be 'src' or 'lib' … a typo in a gate's env fails loud."
  - **The proxy environment is cleared** (`clearedProxyEnv()`) — "a smoke launches a real `dsh` against local fixtures, so it must not inherit the machine's network policy"; `undefined` removes the name from the child rather than setting it empty.
  - **`expectedExitCode`** lets a scenario pin a *designed* failure surface, and "a run that exits any other way — including succeeding — still fails the smoke".
  - **`reject: false`** folds spawn errors, the SIGKILL deadline and nonzero exits into independent result fields, so the diagnostics can embed both streams on every failure.
- **Edge cases & failure handling:** the deadline is 30 s by default and `LOADER_SMOKE_TEST_TIMEOUT_MS` = 45 s ("leaves room for the subprocess-owned 30-second diagnostic timeout"). A caller-provided cwd is **left in place** so consecutive smokes can share one world.
- **Surprising:** `toLibBin` rewrites only the **last** `/src/` segment and understands the Windows `\\src\\` spelling.

#### `packages/test-support/loader-smoke/src/agent-turn.ts`
- **Purpose:** `runFixtureTurn` — drive one task through exactly one configured root agent.
- **Key abstractions:** `FixtureTurnResult` (`{ type: 'result', sessionId, output, usage? }`), `FixtureTurnOptions` (`task`, `onEvent?`), `onlyRootAgent`, `addUsage`.
- **Data flow:** find the single root agent (waiting for `agent/created` if the registry is momentarily empty) → `agent.whenIdle()` → create the user message → listen on `session/event` for the *owned* session only → wait until the inbox splice carrying **that message id** is observed → `agent.followup(message)` → `agent.whenIdle()` → dispose the listener → `ctx.sessions.flush(agent.session)` → return the final assistant text and accumulated usage.
- **Non-obvious design decisions:**
  - **The listener starts only after the message is durable.** The code first waits for the `agent/inbox/spliced` event that contains the message id, and only then starts forwarding events — so the observer never sees a partial turn.
  - **Usage is accumulated per `(turn, step)`** in a map, so a step's usage is not double-counted when both an `assistant/attempt` and an `assistant/message` carry it.
  - **The agent publication wait is explicit**: "Configured agents publish asynchronously (persistence create/resume runs before publication), so a settled Loader does not imply a registered agent yet."
- **Edge cases & failure handling:** the exactly-one-root rule is re-checked **after** the wait; the listener is disposed in a `finally`; `flush` is skipped when the turn throws.
- **Surprising:** `addUsage` only carries `cacheReadTokens`, `cacheWriteTokens` and `reasoningTokens` when *either* side has them — so an absent optional field stays absent rather than becoming zero.

#### `packages/test-support/remote-mock/src/remote-mock.ts`
- **Purpose:** `RemoteMock` — the endpoint table (unary answers or stream scripts), live stream control, a log, and the Connection carrier face.
- **Key abstractions:** `RemoteTable` (`unary`, `stream`, `streams`), `RemoteMockOptions`, `StreamFilter`, `OpenStreams`, `UnaryRuleFn`, `ok`, `RemoteMock`.
- **Data flow:** `dispatch(endpoint, args)` → the endpoint's native mock → the registered default (value or handler) → the log entry settles `pending` → `answered`/`failed`. `open(endpoint, args, signal, uplink?)` → the endpoint's native stream mock → the registered script → a `MockStream` with its own queue, one pending read and a log entry.
- **Non-obvious design decisions:**
  - **`mock.remote` is a lazy Proxy** over every namespace and method — no method list, no domain helper. Each accessed endpoint owns a cached native Vitest mock, and the **same** mock answers direct calls and Connection traffic, so "return overrides and call assertions observe the functions the client actually invokes".
  - **Only explicit `stream()` or table stream declarations select stream methods**; everything else uses unary mocks. "Accessing a method does not fabricate a successful business result."
  - **A missing default is an *unmatched request*, not a failed rule** — the private `MissingUnaryRule` class distinguishes the two so the log can report it separately.
  - **`endpoints()` includes *accessed* proxy methods**, not just registered ones, so the assembly can provide their namespaces.
  - **`RemoteMock.create()` registers one `$events` stream** that answers the Gateway client's opening with `{ type: 'ready', clientId, host }` and stays open — "this is what lets the assembled client reach `connected`".
  - **`modeOf(endpoint)` is the one declaration the whole-client proxies need**; an endpoint neither declared nor ruled is dispatched as a unary call.
- **Edge cases & failure handling:** a rule that throws synchronously is converted into a rejection so the call settles through one path; `settleOrAbort` rejects with the abort reason and keeps a handler on the call so its own outcome is never an unhandled rejection; `assertNoUnmatched()` throws with the misses **and the registered endpoint list**.
- **Surprising:** `open()` stores the carrier uplink on the instance for the duration of the call and clears it in a `finally` — a deliberate (and slightly racy) instance field rather than a parameter, because the native mock's signature is fixed.

#### `packages/test-support/remote-mock/src/streams.ts`
- **Purpose:** the pushable, abort-aware stream a script drives, plus the script builders and the fake-handle typing helpers.
- **Key abstractions:** `StreamHandle` (`push`, `end`, `fail`, `signal`, `uplink`), `StreamScript`, `frames(items)`, `openStream(initial)`, `streamHandle(source)`, `streamMethod(generator)`, `MockStream`, `HandleUplink`, `MockClientStream`, `toError`.
- **Data flow:** a script receives `(args, stream)`; `push` either resolves the pending read directly or enqueues; `end`/`fail` settle the stream; the consumer's `next()` pulls from the queue; `return()` cancels.
- **Non-obvious design decisions:**
  - **The first of `end`, `fail`, or consumer cancellation settles the stream**; later `end()`/`fail()` calls are no-ops.
  - **`drained()` is precise about what it means**: it resolves once the consumer has pulled everything pushed *and* is waiting again (for an open stream) or the queue is empty (for a settled one) — "pulled means taken from the queue: a consumer that processes items asynchronously after pulling them may still be working on the last one."
  - **Cancellation drops the queue**: a consumer that leaves discards what it left, so `drained()` can settle.
  - **A second concurrent read rejects** with `"remote-mock: <endpoint> stream has one consumer"` — the Gateway reads streams sequentially, so this names a test-side misuse.
  - **`HandleUplink`** implements the uplink a direct handle owns: `send()` pushes, `end()` half-closes, `close()` ends and drops unread items; `send()` after the end throws `"remote-mock: uplink was ended"`.
  - **`MockClientStream.send()` applies the real lossless-JSON check** (`isRemoteUplinkItem`), and a stream opened through `rpc.open` owns no uplink: `send()` throws "uplink belongs to the carrier that opened the stream".
- **Edge cases & failure handling:** a script that throws or rejects fails the stream with that error; a non-`Error` throw reason is stringified by `toError`.
- **Surprising:** `streamHandle(source)` types an `AsyncIterable` as the generated handle with **inert** `send`/`end`/`dispose` — "a fake built on it drives the downlink only".

#### `packages/test-support/remote-mock/src/log.ts`
- **Purpose:** the log store — answered calls, opened streams, and requests without a rule.
- **Key abstractions:** `LoggedCall`, `LoggedStream`, `LoggedMiss`, `MockLog` (`calls`, `streams`, `requests`, `unmatched`), `CallRecord`, `StreamRecord`, `MockLogStore`.
- **Data flow:** one **shared `seq` counter** orders calls and stream opens together; `requests()` merges both, sorts by `seq`, and maps to `args[0]`.
- **Non-obvious design decisions:**
  - **`requests()` without an endpoint excludes the Gateway's own `$`-prefixed endpoints** — the product's requests, not the transport's.
  - **The log entries are *live***: `state` is `pending` until the rule settles, and `result` holds the answer or the thrown error.
- **Edge cases & failure handling:** none — the store is pure bookkeeping; the *dispatcher* owns the transitions.
- **Surprising:** a single global `seq` across two different kinds of entry is what lets a caller reconstruct the interleaving of calls and stream opens.

#### `packages/test-support/remote-mock/src/remote-proxy.ts`
- **Purpose:** lazy namespace access for native Remote mocks.
- **Key abstractions:** `MockedRemote<Api = TypertRemoteNamespaceMap>`, `createRemoteProxy(method)`.
- **Data flow:** a nested `Proxy` per namespace; `get` on the namespace returns a Proxy whose `get` returns `method(\`${namespace}/${name}\`)` and caches it.
- **Non-obvious design decisions:**
  - **The type is `keyof Api extends never ? any : MaybeMockedDeep<Api>`** — an *empty* generated map makes only this test proxy `any`; a non-empty map keeps the production namespace names, parameters, results and native spy types. "It does not augment or weaken production Remote declarations."
  - **`then` probes and symbol reads are inert** on both proxies, so `await mock.remote.settings` never calls a method and `Promise.resolve(namespace)` returns the namespace itself.
- **Edge cases & failure handling:** a non-string property returns `undefined`.
- **Surprising:** the `any` escape hatch is deliberately scoped to the *test proxy only* — the `proxy-types.client.spec.ts` compiles probe programs with a virtual TypeScript host to prove production declarations stay closed.

#### `packages/test-support/remote-mock/src/index.ts`
- **Purpose:** the public face re-exports: `RemoteMock`, `ok`, `frames`, `openStream`, `streamHandle`, `streamMethod`, `MockClientStream`, and the log/proxy types. The docblock states the browser-safety constraint: "no DOM, React, or Node imports, no runtime import from another harness package."

#### `packages/test-support/session-snapshot/src/suite.ts`
- **Purpose:** the scenario-table suite factory — registration contract, fixture guards, comparison, and record/refresh write-back. (1760 lines, 84 KB — the largest file in this shard.)
- **Key abstractions:** `Scenario` (the 25-field scenario table), `SnapshotSuiteOptions`, `scenarioSkipped`, `stdoutExpectedVariants`, `claimSharedSnapshot`, `assertUniqueSnapshotContents`, `fixtureContext`, `normalizedHeaders`, `normalizedSystemPrompts`, `normalizedToolSchemas`, `systemPromptPrecedesRequests`, `formatSystemPromptSnapshot` / `parseSystemPromptSnapshot`, `formatToolSchemasSnapshot` / `parseToolSchemasSnapshot`, `restorePinnedToolSchemas`, `assertChildSystemPromptSnapshot`, `headerChangeCount`, `unknownToolCallIds`, `stabilizeFixtureMessageIds`, `refreshFixtureReplacements`, `reconcileCatalogCreationTimes`, `stabilizeRefreshLog`, `assertSessionFixtureStorage`, `defineAcpSnapshotSuite`.
- **Data flow:** `defineAcpSnapshotSuite` validates the scenario table at registration (unique names, exactly one pin per header class, resolvable sidecar sources with matching change counts) → registers one test per scenario plus a `snapshot fixtures` describe block of guards → each scenario test reads `snapshot.yml` + `input.json`, runs `runScenario`, reconciles catalog clocks, normalizes stdout and logs, compares or writes back, then re-derives every live header and prompt from the class pin.
- **Non-obvious design decisions:**
  - **Exactly one scenario per header-composition class pins the tokenized header sequence**, and every *other* scenario in that class is checked against the pin. A class with zero or two pins throws at registration.
  - **Identical sidecar content under two paths is rejected** ("reuse one source") — the corpus stores each distinct prompt and schema sequence once.
  - **`record` mode never re-records `authored` scenarios** and never touches a retained historical generation (`writesCurrentSessionFixtures`).
  - **Replay runs concurrently** (`describe.concurrent`) because each subprocess owns a unique temp cwd and persistence root; **record and refresh stay serial** because they write.
  - **The fixture guard block runs before any comparison result is trusted**: orphan directories, missing files, sidecar presence matching the declaration exactly, one pin per class, canonical JSON formatting for schema sidecars, and a **fixed-point** identity-redaction check.
  - **`assertSessionFixtureStorage`** enforces the storage policy: no `UNKNOWN_TOOL` results, no `/private{{cwd}}`, an unscrubbed prompt or schema, a `request/header` with no preceding `system/message`, and identity redaction as a fixed point — but **only for current generations**; a retained historical role keeps its released bytes.
  - **Refresh stabilisation is a bijection, not a replacement list**: `normalizedStringMappings` builds a log-wide forward/reverse map of normalized-equivalent strings and disables reuse if any record misaligns or any mapping conflicts. "Ambiguous layouts or mappings keep fresh strings."
  - **Complete durable-message ids are excluded** from that mapping because a later structural pass owns them (`stabilizeFixtureMessageIds` matches by content fingerprint, and refuses a fingerprint whose id also identifies different content).
- **Edge cases & failure handling:** a shared snapshot that diverges between two claimants throws ("shared snapshot … diverged between … and …") so the final file cannot depend on scenario order. `scenarioSkipped` skips authored scenarios while recording, retained generations while recording, `posixOnly` on Windows, and `pwshOnly` when the host has no `pwsh` — while the fixture guards still cover the committed files everywhere.
- **Surprising:** `scenario.pinsHeader`, `systemPromptSource`, `toolSchemasSource`, `expectedHeaderChanges` and `expectedPromptChanges` are **only valid on a pinning scenario** and throw otherwise — the fields cannot be silently ignored.

#### `packages/test-support/session-snapshot/src/harness.ts`
- **Purpose:** the scripted scenario driver and the session-log harvest.
- **Key abstractions:** `InputStep` (17 ops), `InputScript` (`steps`, `permissionAnswers`), `PermissionAnswer` (`kind`), `HarvestedLog`, `RunResult`, `RunOptions`, `snapshotSpillRoot`, `runScenario`, and the seven `waitForPersisted*` helpers.
- **Data flow:** `runScenario` creates the cwd and the sessions root → seeds the committed workspace → captures the initial workspace snapshot → composes the child env (`DSH_SNAPSHOT*`, isolated `DSH_HOME`/`DSH_AGENTS_HOME`, cleared proxy env) → launches the ACP subprocess → runs the input steps in order → closes stdin → harvests every persisted log → captures the final workspace → tears everything down in a failure-safe `finally`.
- **Non-obvious design decisions:**
  - **The permission-answer queue is FIFO by *option kind*, not option id** — "option ids are agent-issued randoms a committed script cannot know, while kinds are the ACP-stable vocabulary." A request beyond the queue is answered `cancelled`.
  - **A scripted kind the agent never offered REJECTS the run.** The callback cannot fail the run from inside (a JSON-RPC error response would look like a denial), so it captures the error and answers `cancelled`; the step loop then fails the run as a harness error. "The scenario scripted an impossible selection."
  - **Every wait names the session, the deadline and the missing fact**, and retains the underlying failure as `cause` — "Session-log wait timeouts identify the session or child and deadline even when the first log harvest exceeds that deadline."
  - **`waitForTurnStart` rejects a malformed turn record immediately** rather than retrying: "a malformed persisted record is a scenario bug, not a not-yet state."
  - **`waitForTurnEnd` uses the raw-JSONL closing boundary**, not the ACP cancel response, so "cancellation snapshots use this external boundary to keep subprocess disposal from changing an `aborted` turn into a `disposed`."
  - **`waitForSubagentTurnEnd` requires a `request/header` after the child's `subagent/descriptor`** — only a later request header proves the child's *own* model work reached a closed turn.
  - **The harvest order is primary-first, then children by ascending `createdAt`** — and the comment states the cross-package invariant: "This harvest order must match the replay load order in dsh-llm-replay's `loadSessionScripts`."
  - **`snapshotSpillRoot` derives a fixed-length logical root** from a SHA-256 prefix of the scenario name, and Windows uses a two-character-shorter root "because drive resolution adds its drive prefix".
  - **Cleanup failures and scenario failures are reported together** via `AggregateError` — "neither orthogonal outcome hides the other."
- **Edge cases & failure handling:** the stderr of the child is appended to any scenario error ("agent stderr:\n…"). `promptExpectError` swallows the model error as the expected outcome but throws when the prompt unexpectedly succeeds. `newSessionExpectError` swallows the bridge's rejection of an unsupported workspace scope.
- **Surprising:** the harness **clears the proxy environment** for the same reason the smoke harness does — a runner's proxy would return an error page that the recorder would then commit as the expected output.

#### `packages/test-support/session-snapshot/src/launcher.ts`
- **Purpose:** the shared ACP launcher — spawn, connect, collect, and shut down.
- **Key abstractions:** `AgentUnderTest`, `AcpTestLaunchOptions`, `AcpTestClient`, `LaunchedAcpTestAgent`, `launchAcpTestAgent`, `materializeProfilePatch`.
- **Data flow:** `resolveExampleLaunch` (from `loader-smoke`) → `spawn` with piped stdio → a **raw-byte stdout tee** (buffers for the transcript, a `Readable` passthrough for the SDK's `ndJsonStream`) → the ACP SDK client app over `clientApp.connect(stream)` → session updates collected in receive order → `close()` drains stdio, the SDK's parser, and any in-flight client callbacks.
- **Non-obvious design decisions:**
  - **The child's spawn failure is observed in the same tick as spawn**, so a missing cwd cannot crash the runner; the promise then surfaces the original error to `spawned` and `close()`.
  - **The stdout tee is raw bytes.** The SDK parses one copy while the transcript keeps the exact bytes — so the expected-output comparison sees the wire, not the SDK's view.
  - **Draining waits for three things**: stdio closure, the SDK's `closed` (parser exhaustion), and **in-flight client callbacks** — "the ACP SDK's readable loop dispatches client callbacks without awaiting them."
  - **Permission requests fail closed as `cancelled`** when the caller supplies no handler.
  - **Shutdown is a three-stage escalation**: graceful stdin end → the requested signal → a `SIGKILL` fallback, each with a bounded "exit marker" grace window (`EXIT_MARKER_GRACE_MS = 250`). When the fallback is refused the error is an `AggregateError` carrying both the original failure and the refusal.
  - **Profile patches are *materialized* into the launch cwd** with relative plugin names rewritten to absolute file URLs, and each resolvable bare package is **symlinked into the profile's `node_modules`** — "This mirrors `dsh plugin` while retaining the bare entry name and package identity used by request metadata."
  - **Replay selects a sibling `cordis.snapshot.yml` patch** rather than the live patch, because "Replay siblings already contain the selected scenario's complete delta over the base patch."
- **Edge cases & failure handling:** a `close()` on an already-dead child awaits the drain and returns; a child that outlives the smoke leaves descendants behind ("a process tree spawned by a faulty fixture can outlive the smoke and needs external cleanup").
- **Surprising:** `materializeProfilePatch` is **exported** from the package — the patch-materialisation contract is reused by the headless and SDK adapters, not just ACP.

#### `packages/test-support/session-snapshot/src/normalize.ts`
- **Purpose:** the pure normalizers and scrubbers — the heart of the comparison contract.
- **Key abstractions:** `NormalizeContext` (`sessionIds`, `cwd`, `cwdAliases`), `CwdPathMode` (`canonical` | `native`), `NormalizeOptions`, `SessionSnapshotComparisonOptions`, `normalizeStdout`, `normalizeSessionLog`, `normalizeSessionSnapshot`, `normalizeSessionSnapshots`, `normalizeSessionFormatMetadata`, `scrubSystemPrompts`, `scrubToolSchemas`, `scrubModelRequestBulk`, `scrubSessionSnapshot`, `tokenizeSessionFixtureCwd`, `extractSnapshotSpillPaths`.
- **Data flow:** a raw log/stdout → parse → **tokenize** the volatile values → zero the clocks → project the persistence envelope away → compare. The token vocabulary is `{{sessionId}}`, `{{messageId}}`, `{{usedTokens}}`, `{{cwd}}`, `{{system}}`, `{{tools}}`, `{{eventTime}}`, `{{eventOmittedBytes}}`, `{{sourceSessionFormatVersion}}`, `{{spillLocator:<name>}}`.
- **Non-obvious design decisions:**
  - **Tokenize, never delete.** "Normalization preserves unexpected request-header fields, including `system`, so regressions remain visible."
  - **The cwd is replaced by a boundary-aware scan**, longest spelling first, including macOS `/private` aliases and the Windows short/long path spellings — a global `replaceAll` would corrupt a longer path.
  - **Separator canonicalisation is restricted to cwd-rooted paths** (`CWD_ROOTED_PATH_RE`) and to two generated path markers — "A global backslash rewrite would corrupt regexes, commands, and model-authored text."
  - **Event-read results are scrubbed only inside their distinctive fenced envelope**, so neighbouring tool text stays regression-visible.
  - **`normalizeStdout` rewrites JSON-RPC ids to a first-seen sequence** (1, 2, 3, …) so id churn does not perturb the expected output, and **throws on a non-JSON stdout line** — "doubling as a protocol-stdout purity check."
  - **Packed chunk rows keep their sequence and lose their clocks**: `time0` → 0 and each `dt` gap → 0.
  - **Every clock family is zeroed explicitly**: event `time`, embedded stream `time`/`time0`/`dt`, `hook/result.durationMs` (but the `decision` survives), job `startedAt`/`finishedAt`, goal `createdAt`/`updatedAt`, subagent catalog `childCreatedAt`, and feedback item `createdAt`/`updatedAt`.
  - **`scrubToolSchemas` retains ordered tool NAMES when the log contains a developer message** — "so historical addition references remain verifiable."
  - **`normalizeSessionSnapshots` runs the strict build-static catalog restoration first**, then identity redaction, then normalization with `identityMode: 'preserve'`; `nativeWriterOutput` tokenizes only the delivery markers qualified by the *source* generation.
  - **`tokenizeSessionFixtureCwd` replaces any absolute spelling whose final segment is the generated cwd basename** — so a recording made on one machine compares with one made on another.
- **Edge cases & failure handling:** a headerless input throws ("session snapshot must start with a session header"); a cwd with no basename throws; a malformed record is left byte-identical rather than crashing the normalizer.
- **Surprising:** `scrubSessionSnapshot` parses each non-empty line **at most once** and keeps the header line byte-identical.

#### `packages/test-support/session-snapshot/src/manifest.ts`
- **Purpose:** parse and validate one `snapshot.yml`.
- **Key abstractions:** `SnapshotProfile`, `SnapshotRecording`, `SnapshotHeaderManifest`, `SnapshotReplayManifest`, `SnapshotPlatform`, `SnapshotPermission`, `SnapshotWorkspaceManifest`, `SnapshotInputAttachment`, `SnapshotInputManifest`, `SnapshotSessionReference`, `SnapshotSessionFormatCoverage`, `SnapshotSessionFormatManifest`, `SnapshotManifest`, `SnapshotSessionWriteMode`, `parseSnapshotManifest`, `writesCurrentSessionFixtures`.
- **Data flow:** `yaml.load(source, { schema: yaml.JSON_SCHEMA })` → a closed field whitelist (`exactKeys`) → per-field validation → a normalised manifest object.
- **Non-obvious design decisions:**
  - **The manifest is CLOSED**: any unknown field throws ("manifest has unknown field(s): extra"). A typo cannot be silently ignored.
  - **JavaScript YAML tags are refused** by loading with `JSON_SCHEMA` — a manifest cannot execute code.
  - **Names are lower-kebab-case** (`NAME_RE`) and scenario sources must be a lower-kebab-case path with no absolute prefix, no backslash and no NUL.
  - **Every error is prefixed** `session-snapshot: <path>: …`, so a failing fixture names its own file.
  - **`writesCurrentSessionFixtures`** encodes the ownership rule: only a write-capable mode, only an *owning* scenario (no `session:` reference), and only when no historical `sessionFormat` is declared.
  - **`sessionFormat` and `session` are mutually exclusive** — a retained generation belongs to the owner.
  - **Attachment ids must be content-addressed** (`sha256:`), the media type must be a MIME type, and the ids must be unique.
- **Edge cases & failure handling:** an empty `workspace:` block throws ("must not be empty"); `environment` keys must be uppercase names mapped to strings; `childToolSchemas`/`childSystemPrompts` must be arrays of unique positive integers.
- **Surprising:** the whole parser is wrapped so that even a non-`Error` throw is re-emitted as `session-snapshot: <path>: <message>`.

#### `packages/test-support/session-snapshot/src/session-files.ts`
- **Purpose:** the immutable Session-generation filename grammar.
- **Key abstractions:** `SessionFixtureFile`, `PersistedSessionFile`, `sessionFixtureName`, `writerSnapshotName`, `parseSessionFixtureName`, `sessionFixtureFiles`, `sessionFixtureNames`, `sessionHeaderVersion`, `assertSessionFixtureVersion`, `persistedSessionFilename`, `parsePersistedSessionFilename`, `latestPersistedSessionPaths`, `assertPersistedSessionVersion`.
- **Data flow:** a scenario directory's file names → `sessionFixtureFiles` selects the **highest generation per role** → roles must be **contiguous** (parent `0`, children `1`, `2`, …) → each selected file's header must agree with its filename.
- **Non-obvious design decisions:**
  - **The grammar is `session[.N][.vN].jsonl`** — the ordinal is the child slot, the `.vN` is the *physical format generation*, and `v0` is encoded by omission.
  - **A file that starts with `session` and ends with `.jsonl` but does not match the grammar THROWS** ("invalid session fixture name"), while an unrelated file is ignored.
  - **Roles must be contiguous**: a gapped child set throws ("session fixture roles must be contiguous").
  - **A versionless projected header is v0** — "a versionless projected Session header is format v0."
  - **`writerSnapshotName` is deliberately outside the replay grammar** ("This expected output never participates in replay generation selection").
- **Edge cases & failure handling:** `-0` is rejected as a non-negative safe integer (`Object.is(value, -0)`); a filename/header generation mismatch throws with both versions.
- **Surprising:** `latestPersistedSessionPaths` filters by **compression** too, so a raw and a zstd generation in the same directory do not collide.

#### `packages/test-support/session-snapshot/src/identity.ts`
- **Purpose:** relationship-preserving identity redaction for committed session snapshots.
- **Key abstractions:** `redactSessionSnapshotIds(logs)`.
- **Data flow:** parse each log → claim ids by **kind** (`session`, `message`, `approval`, `workflow`, `command`, `rpc`, `retry`, `id`) in **first-seen order** across the parent and every child → replace longest values first.
- **Non-obvious design decisions:**
  - **The kinds are decided by the record's context**, not by the value's shape: `commandId` → `command`, `rpcId` → `rpc`, `retryId` → `retry`, `runId` → `workflow`, any `…Id`/`…Ids` key → `id`, and an `approval/asked`/`approval/decided` record's `id` → `approval`.
  - **Prose is not redacted**: only UUID-shaped values, `-<16 hex>` job ids and legacy `{{sessionId}}`/`{{messageId}}` tokens are candidates. A UUID that merely appears in prose stays.
  - **Semantic text is mined**: `as message <uuid>` → `message`, `Anonymous user: <uuid>` → `id`.
  - **Already-canonical tokens are preserved and their counter is advanced**, so a fixture that already contains `{{message:7}}` continues at `{{message:8}}` rather than colliding.
  - **The replacement is longest-first**, so a short id that is a prefix of a longer one cannot corrupt it.
- **Edge cases & failure handling:** the function is a **fixed point** — re-running it on its own output changes nothing, and `assertSessionFixtureStorage` asserts exactly that.
- **Surprising:** the header's session id is claimed **always** (`always = true`), even when it is not UUID-shaped — the parent/child relationship must survive.

#### `packages/test-support/session-snapshot/src/workspace.ts`
- **Purpose:** capture readable, path-stable workspace state.
- **Key abstractions:** `EMPTY_WORKSPACE_MARKER` (`.empty`), `WorkspaceTextFileSnapshot`, `WorkspaceBinaryFileSnapshot`, `WorkspaceSymlinkSnapshot`, `WorkspaceEmptyDirectorySnapshot`, `WorkspaceSnapshotEntry`, `CaptureWorkspaceSnapshotOptions`, `captureWorkspaceSnapshot`, `captureExpectedWorkspaceSnapshot`.
- **Data flow:** a recursive walk of the root → each entry sorted by name → a directory with no children becomes an `empty-directory` entry, a file becomes `text` or `binary`, anything else becomes a `symlink` with the **unresolved** target.
- **Non-obvious design decisions:**
  - **Paths are cwd-relative POSIX** (`segments.join('/')`) so a Windows run and a POSIX run produce the same expected file.
  - **Text detection is round-trip exact**: a file is `text` only if `Buffer.from(text, 'utf8').equals(bytes)` — so a NUL byte or invalid UTF-8 makes it `binary`.
  - **Symlinks are not followed** — the recorded state is the link, not its target.
  - **`EMPTY_WORKSPACE_MARKER`** lets Git retain an expected empty directory "without becoming expected workspace state" — the marker is excluded only from the *expected* capture.
  - **`ignoredRootEntries` applies only to the immediate children of the root**, so a harness-owned `.dsh` directory is dropped but a user file of the same name deeper in the tree is not.
- **Edge cases & failure handling:** none — the capture is total.
- **Surprising:** a directory is recorded as `empty-directory` **only when it has no entries at all**, including no hidden files.

#### `packages/test-support/session-snapshot/src/index.ts`
- **Purpose:** the package entry re-exporting the four layers (launcher, harness, normalizers, suite factory). The docblock carries the one packaging constraint: **"NOTE: ./suite.ts imports vitest, so this package is importable only inside a vitest run."**

### Tier 2 — bulk: a compact table, one row per file (164 files)

#### Docs (16)

| File | What it is / what it pins |
| --- | --- |
| `packages/test-support/README.md` | The group map: the seven packages, their one-line roles, and the **exit rule** — "a package moves out of this group when it gains a product contract and product consumers." |
| `packages/test-support/README.zh.md` | Chinese mirror of the group map. |
| `packages/test-support/agent-loop-testkit/README.md` | The testkit contract: two mounting helpers, two Inbox stubs, a working-directory fixture; the harness mounts **no adapter** and owns no teardown. |
| `packages/test-support/agent-loop-testkit/README.zh.md` | Chinese mirror. |
| `packages/test-support/client-runtime/README.md` | The bench contract: two tiers, fail-loud rules, the `webApp` roster rules, and an explicit "Known Limitations" list (proxies bypass the Gateway client's `invoke`; undeclared endpoints go unary; Session/Conversation/Chat fixtures stay separate). |
| `packages/test-support/client-runtime/README.zh.md` | Chinese mirror. |
| `packages/test-support/llm-mock-server/README.md` | The fault-server contract: the behaviour table (24 rows), the FIFO script, random weights as *test pressure not incident frequency*, the timing/content knobs, and the three failure modes (script exhaustion, no positive weight, invalid requests not consuming the script). |
| `packages/test-support/llm-mock-server/README.zh.md` | Chinese mirror. |
| `packages/test-support/llm-replay/README.md` | The replay contract: the fixture projection rules, per-role generation selection, the `replay.override.json` sidecar for the two unreconstructable failure modes (throw-before-chunk, cancel/hang), first-call-order session binding, and the two known limits (concurrent children; only ordinary chunks are derivable). |
| `packages/test-support/llm-replay/README.zh.md` | Chinese mirror. |
| `packages/test-support/loader-smoke/README.md` | The smoke contract: isolated cwd and DSH homes, source-vs-built mode, `expectedExitCode`, `runFixtureTurn`, and the three failure modes (never exits; built mode needs a prior build; output bounded by execa's 100 MB `maxBuffer`). |
| `packages/test-support/loader-smoke/README.zh.md` | Chinese mirror. |
| `packages/test-support/remote-mock/README.md` | The mock contract: endpoint naming, `mock.remote` usage, default tables, stream scripts and live control, the `mock.rpc` carrier, the observation surface, and five "Known Limitations" (in-process carrier only, values cross by reference, values are not checked, no payload matching, native stream overrides own their iterable). |
| `packages/test-support/remote-mock/README.zh.md` | Chinese mirror. |
| `packages/test-support/session-snapshot/README.md` | The snapshot contract: closed manifests, generation-qualified role selection, the prompt/schema sidecar ownership model, record/replay/refresh modes, the workspace-parent rules, and the seven "What can go wrong" entries. |
| `packages/test-support/session-snapshot/README.zh.md` | Chinese mirror. |

#### Config (17)

| File | What it is / what it pins |
| --- | --- |
| `packages/test-support/agent-loop-testkit/package.json` | **Zero runtime dependencies**; every harness package is `peerDependencies` + `devDependencies` (workspace:\*), so a testkit can never pin a version of production code. |
| `packages/test-support/agent-loop-testkit/tsconfig.json` | Project references to every production package the helper mounts — a compile-time guarantee the dependency spine exists. |
| `packages/test-support/client-runtime/package.json` | Runtime deps are only `@testing-library/{dom,react}`, `js-yaml`, `vitest`; everything else is a peer/dev dependency — the bench mounts production code, it does not carry it. |
| `packages/test-support/client-runtime/tsconfig.json` | `extends ../../../tsconfig.base.client.json`, adds the `node` ambient types **only** so the roster reader can use `node:fs`; project references pin the client-side production packages. |
| `packages/test-support/client-runtime/tsdown.config.ts` | One-line `clientLibrary(...)` build config. |
| `packages/test-support/llm-mock-server/package.json` | Peer-depends only on cordis — the fault server itself is dependency-free. |
| `packages/test-support/llm-mock-server/tsconfig.json` | Plain `extends ../../../tsconfig.base.json` with `rootDir: src`. |
| `packages/test-support/llm-mock-server/tsdown.config.ts` | `tsdown`: one self-contained ESM entry, no code splitting, no dts (types come from `tsc`). |
| `packages/test-support/llm-replay/package.json` | Depends on the **session-format catalog** and `dsh-util-values`; the DeepSeek extensions peer is marked **optional**. |
| `packages/test-support/llm-replay/tsconfig.json` | Project references to compaction, llm, the extensions, session and the format catalog. |
| `packages/test-support/loader-smoke/package.json` | Real runtime deps (`execa`, `tsx`); everything else peer/dev. |
| `packages/test-support/loader-smoke/tsconfig.json` | Project references to cordis, agent, llm, session and http-proxy. |
| `packages/test-support/remote-mock/package.json` | One runtime dep — `@vitest/spy` — so the package also works in a browser page without the Vitest runner. |
| `packages/test-support/remote-mock/tsconfig.json` | Client-side base config with references to the protocol, cordis and the client connection. |
| `packages/test-support/remote-mock/tsdown.config.ts` | One-line `clientLibrary(...)` build config. |
| `packages/test-support/session-snapshot/package.json` | Depends on the ACP SDK, the include plugin, `llm-replay`, `loader-smoke`, the session format and `vitest` — the snapshot tier is assembled *from the other test-support packages*. |
| `packages/test-support/session-snapshot/tsconfig.json` | Project references to the include plugin, loader-smoke, llm-replay, session and the session format. |

#### Tests (131)

| File | What it is / what it pins |
| --- | --- |
| `packages/test-support/agent-loop-testkit/tests/agent-loop-testkit.spec.ts` | Pins: `unsupportedInbox` throws on mutation; the prerequisite spine is configurable (a persona prefix reaches the rendered prompt); an existing `fs` is kept when `workingDirectory: true`; the mutable stub's full queue algebra; and the durable path — inbox insert/claim events, duplicate-pending rejection, and a persisted-splice validation error. |
| `packages/test-support/client-runtime/tests/__snapshots__/runtime.client.spec.tsx.snap` | The two structural snapshots: a scoped class folded to `frame plain` with an svg collapsed to `data-content="2bfa09dc"`, and a childless svg left untouched beside a scoped class. |
| `packages/test-support/client-runtime/tests/assembly-bundle-roster.client.spec.ts` | Pins the roster reader: bundle composition order, the `dsh.client` platform filter, linked-bundle resolution beating an ancestor package, group flattening, `disabled` evaluation, and six "fails loud" cases (unresolvable bundle, no patch list, patch that does not apply, unresolvable row, a manifest naming another package). |
| `packages/test-support/client-runtime/tests/assembly-dependencies.client.spec.ts` | Pins which production packages the assembly tier is allowed to depend on. |
| `packages/test-support/client-runtime/tests/assembly-modules.client.spec.ts` | Pins in-process module loading: the bootstrap row cannot be provided, a failed `/client` import names the package, `loadBundle` never fetches, and the vendored Loader boots over the in-process table. |
| `packages/test-support/client-runtime/tests/assembly-plan.client.spec.ts` | Pins `assertPlan` and the roster's `pick`/`without`/`closure` algebra. |
| `packages/test-support/client-runtime/tests/assembly-remote-proxies.client.spec.ts` | Pins the `remote.<ns>` proxies: unary vs stream dispatch by mock mode, the trailing-`AbortSignal` pop, `gateway/internal` vs `gateway/cancelled` folding, and that a rule-less call is left in the log for `dispose()` to report. |
| `packages/test-support/client-runtime/tests/assembly-roster.client.spec.ts` | Pins roster construction: duplicate detection, the closure cone, unknown-name errors that print the roster, and that the platform seed modules satisfy an inject edge without a row. |
| `packages/test-support/client-runtime/tests/assembly-test-client-node.client.spec.ts` | Pins the whole-client boot in the **node** environment: no DOM needed, close-even-when-dispose-fails, refusal to provide the two generated rows, the allow-all access row, unmatched requests reported alongside a failed teardown, a concurrent second dispose waiting for the first, and "fails loud when the roster cannot provide a connection". |
| `packages/test-support/client-runtime/tests/assembly-test-client.client.spec.ts` | Pins the whole-client boot in jsdom: the full web-app roster, shim install/remove (only what it installed), two concurrent plugin trees, `reload`/`unload`, the "no `uiRenderer`" refusal, and the readiness-timeout message carrying the mock log. |
| `packages/test-support/client-runtime/tests/assembly-vitest.client.spec.ts` | Pins the Vitest fixtures: shared `start()` promise, `start()` after close rejects, unmatched-call failure at teardown. |
| `packages/test-support/client-runtime/tests/helpers.client.spec.tsx` | Pins the fixture helpers: allow-all access hooks, the constant `remoteAccess` source, retracting default root sources without removing replacements, panel hooks, the fail-loud upload stub, independent Conversation/Chat snapshots, the production selector binding, and the pinned browser languages. |
| `packages/test-support/client-runtime/tests/remote.client.spec.ts` | Pins `TestRemote`: event delivery and disposal, an unsubscribed event, `$mount` refusing, a scripted namespace reachable both as `ctx.remote.<name>` and as its own service, and the shadowing refusal. |
| `packages/test-support/client-runtime/tests/runtime.client.spec.tsx` | The largest client spec (42 KB): root declaration and rendering, the whole Session lifecycle (catalog vs generation, reference counting, release races, search, scope disposal), stores and store guards, workspaces, feature mount and disposal, the single-slot tier, the fail-loud session face, the workspaces action face, and the stubbed settings scope. |
| `packages/test-support/llm-mock-server/tests/cli.spec.ts` | Pins the CLI parser: every option, the defaults, and **22 distinct rejection cases**. |
| `packages/test-support/llm-mock-server/tests/server.spec.ts` | Pins the wire: SSE shapes and chunk counts, the three transport boundaries, stall + client abort, UTF-8 code points split across request chunks, an IPv6 base URL, structured HTTP errors with distinct codes, script exhaustion, reproducible random selection, and 20 invalid-option rejections. |
| `packages/test-support/llm-replay/tests/llm-replay.spec.ts` | The 100 KB replay spec (142 cases): fixture format diagnostics, `parseSessionLog` envelope rules, `prepareSessionSnapshotFixtureForComparison`, `deriveReplayScript` (including the thrown-stream refusal and the marked-compaction path), `loadReplayScript` + the override sidecar forms, `installLlmReplay` through the **real LlmRuntime waterfall** (placeholder substitution, provider catalogues, extension acceptance, throw/hang entries, pacing, abort paths, `assertConsumed`), `parseSessionHeader`, `loadSessionScripts` ordering, per-session keying, and the `apply` plugin entry. Read as head + full test-name census (2344 lines). |
| `packages/test-support/llm-replay/tests/session-format-corpus-inventory.ts` | The **inventory of deliberate historical refusals**: 14 committed `.jsonl` paths with their exact source generation and exact refusal reason, plus 12 headerless protocol fixtures. A refusal that disappears or changes its text fails the corpus spec. |
| `packages/test-support/llm-replay/tests/session-format-corpus.spec.ts` | Restores every committed `session*.jsonl` under `snapshots/`, `packages/` and `scripts/snapshots/` through the real catalog **without changing source bytes** (asserted in a `finally`), and pins the corpus policy: current-generation fixtures may never be refused, unlisted refusals are rejected, a changed reason fails, and corruption masquerading as an unsupported migration fails. |
| `packages/test-support/loader-smoke/tests/agent-turn.spec.ts` | Pins `runFixtureTurn`: the exactly-one-root rule, the wait for publication, the **owned interval** (events before the message's durable receipt are not observed), per-step usage de-duplication, an absent usage, and listener removal on failure. |
| `packages/test-support/loader-smoke/tests/example-launch.spec.ts` | Pins the mode resolver: `src`/`lib`/empty/absent, an invalid value, `src` requiring a tsconfig path, the `tsx/esm` hook, `lib` deriving the built bin (including the Windows spelling and the "last `/src/` segment only" rule). |
| `packages/test-support/loader-smoke/tests/fixtures/cli-mock-llm.ts` | A keyless headless-agent adapter: one production shell tool call then a final answer, with a `DSH_CLI_MOCK_FAILURE=1` failure mode and a per-step reasoning-effort override. |
| `packages/test-support/loader-smoke/tests/fixtures/fail.ts` | A non-zero subprocess fixture (`exitCode = 7`). |
| `packages/test-support/loader-smoke/tests/fixtures/hang.ts` | A deadline subprocess fixture (an interval that never ends). |
| `packages/test-support/loader-smoke/tests/fixtures/headless-driver.ts` | The snapshot-only Loader driver: boots a shipped profile, optionally requires a named fixture entry to have activated, streams one turn as canonical JSONL, and always disposes the context. |
| `packages/test-support/loader-smoke/tests/fixtures/production-profile.ts` | The repository-only shipped-profile composition helper: loads a profile, computes the runtime resolution, and passes the bundle patches plus the test's `*.patch.yml` overlays to the root `cordis:include`. |
| `packages/test-support/loader-smoke/tests/fixtures/success.ts` | The successful subprocess fixture: echoes argv, cwd, the DSH homes, a marker env and stdin back to the test. |
| `packages/test-support/loader-smoke/tests/loader-smoke.spec.ts` | Pins `runLoaderSmoke`: cwd isolation, stdin closed, both streams captured, the cwd removed; a caller-provided cwd left in place; arbitrary argv plus `prepare`/`inspect`; the non-zero exit diagnostic; `expectedExitCode` accepted *and* a surprising success still failing; and the deadline kill. |
| `packages/test-support/remote-mock/tests/proxy-types.client.spec.ts` | A **type-level** spec: it compiles probe programs with a virtual TypeScript host to prove that an empty generated map makes only the test proxy `any`, that a non-empty map keeps arguments/results/spy types checked, that production namespaces stay closed, and that the runtime build carries no `@deepseek-ai/dsh-typert-protocol` import. |
| `packages/test-support/remote-mock/tests/proxy.client.spec.ts` | Pins the native proxies: cached identities, inert `then`/symbol probes, FIFO one-shot answers shared between direct and carrier calls, the carrier keeping its signal out of positional args, per-mock queue isolation, `mockClear` vs `mockReset`, missing defaults after the queue drains, and the stream-mode selection plus native overrides bypassing the controlled-stream log. |
| `packages/test-support/remote-mock/tests/rpc.client.spec.ts` | Pins the Connection carrier: both payload forms, the uplink handed to the script and kept out of the logged args, the real lossless-JSON check on `send()`, the owned uplink closing with the stream, malformed payloads, unmatched endpoints, and the abort paths. |
| `packages/test-support/remote-mock/tests/unary.client.spec.ts` | Pins the unary defaults: a fixed value answered verbatim with the args/result/`seq` logged; defaults replaced on registration and table reload (including an explicit `undefined` answer); positional args reaching the native spy; raw values and typed handlers coexisting in one table; the `pending → answered/failed` log states; `requests()` ordering per endpoint and across all but the Gateway's own; and `load(table)` for a whole table. |
| `packages/test-support/remote-mock/tests/streams.client.spec.ts` | Pins the stream machinery: `frames` vs `openStream`, arg-filtered push/end/fail, the single-consumer rejection, settling twice being a no-op, `drained()` semantics in five states, cancellation dropping later pushes, the handle signal aborting on `return()`, a script that throws, and the built-in `$events` ready frame per generation. |
| `packages/test-support/session-snapshot/tests/harness.spec.ts` | The 64 KB harness spec (56 cases) driven through the **real spawn path** against the scripted fake ACP bin: spawn failure surfacing, boot and captures, profile argv and patch rebasing, the shutdown escalation (four refused-fallback cases), in-flight callback draining, every `waitFor*` op and its timeout message, spill-root isolation, workspace seeding, the permission-answer queue, the harvest order, and the combined scenario+cleanup failure report. Read as head + full test-name census. |
| `packages/test-support/session-snapshot/tests/identity.spec.ts` | Pins the identity redaction: typed relationships across parent and child, feedback versions preserved, unrelated prose untouched, the semantic-text mining, the canonical-token continuation, and the **fixed point**. |
| `packages/test-support/session-snapshot/tests/manifest.spec.ts` | Pins the manifest: the owning scenario, `sdk-minimal`, a retained generation with its coverage, the write-mode rule, the full metadata block, and **39 rejection cases** (unknown fields, bad names, bad coverage, absolute/backslash/NUL paths, a JS YAML tag, and the `sessionFormat`/`session` exclusivity). |
| `packages/test-support/session-snapshot/tests/normalize.spec.ts` | The 55 KB normalizer spec (89 cases): stdout id sequencing, cwd scrubbing at every boundary (file URI, chained punctuation, macOS `/private`, Windows drives), separator canonicalisation, spill-path tokenising, clock zeroing per family, packed-row handling, multi-session comparison and the delivery-generation rules, `tokenizeSessionFixtureCwd`, and the three scrubbers' idempotence. Read as head + full test-name census. |
| `packages/test-support/session-snapshot/tests/storage-policy.spec.ts` | Pins the storage policy: only the highest generation of each role is checked, a retained historical child keeps its released bytes, and the current-generation rules (no `UNKNOWN_TOOL`, no `/private{{cwd}}`, prompt and schema scrubbed, a `system/message` before every request, identity redaction as a fixed point) are enforced. |
| `packages/test-support/session-snapshot/tests/suite.spec.ts` | The 70 KB suite spec (115 cases): the registration contract (one pin per class, no duplicates, resolvable sidecar sources with matching change counts), the shared-snapshot claim and uniqueness rules, the whole filename grammar, `stdoutExpectedVariants`, `scenarioSkipped`, every normalizer-side helper, the schema/prompt sidecar formats, `unknownToolCallIds`, `stabilizeFixtureMessageIds` (fingerprint matching and its ambiguity refusals), `refreshFixtureReplacements`, `stabilizeRefreshLog` (packed timing, inserted events, correlated-id bijections), and the catalog-clock reconciliation. Read as head + full test-name census. |
| `packages/test-support/session-snapshot/tests/workspace.spec.ts` | Pins the workspace capture: text/binary/link/empty-directory classification in path order, the ignored-root and `.empty` rules, and NUL-bearing UTF-8 read as binary. |
| `packages/test-support/session-snapshot/tests/fixtures/child-question-tripwire.ts` | A tripwire answerer whose *invocation* means a delegated child reached the UI questioner — a fixture that fails by being reached. |
| `packages/test-support/session-snapshot/tests/fixtures/compaction-working-directory.ts` | Sets a fixed POSIX working directory before the first model request. |
| `packages/test-support/session-snapshot/tests/fixtures/dynamic-tool-prompt-updates.ts` | Adds prompt guidance and a tool after a read, asserting the first request's history is preserved and the second request carries two system messages. |
| `packages/test-support/session-snapshot/tests/fixtures/dynamic-tool-updates.ts` | Registers a tool after a read and removes it after use, asserting the deferred-activation and in-history vs addition-only tool-update semantics. |
| `packages/test-support/session-snapshot/tests/fixtures/fake-acp-agent.ts` | The scripted fake ACP bin: a whole subprocess run is scripted from a `behavior.json` beside the fixture (prompt settle mode, session/new rejection, permission probe, env echo, workspace echo, stderr note, late inherited output, scripted logs, filesystem noise), with `{{CWD}}`/`{{SID}}` substitution. |
| `packages/test-support/session-snapshot/tests/fixtures/in-history-prompt-update.ts` | Adds a prompt section after the first successful read so the next step renders a changed system prompt. |
| `packages/test-support/session-snapshot/tests/fixtures/parent-agent-preset.ts` | Selects the root session's initial preset before the agent is published. |
| `packages/test-support/session-snapshot/tests/fixtures/parent-sandbox-override.ts` | Switches each ROOT session to `read-only` so a continuable child inherits the parent's explicit override as a `source: 'delegation'` event. |
| `packages/test-support/session-snapshot/tests/fixtures/partial-landlock-sandbox.ts` | A deterministic sandbox-runner classification provider (partial enforcement vs a missing executable) with the Landlock tuple aligned to the production `RUNNER_FAILURE_RULES`. |
| `packages/test-support/session-snapshot/tests/fixtures/ptc-mode-change.ts` | Changes the file policy from *outside* an active tool call while a nested tool awaits cancellation. |
| `packages/test-support/session-snapshot/tests/fixtures/subagent-activation-limit.ts` | Holds child execution until the parent's capacity probe has been recorded (`maxActiveSubagents: 1`), ordering parent admission and child completion without elapsed-time assumptions. |
| `packages/test-support/session-snapshot/tests/fixtures/subagent-durability-failure.ts` | The largest fixture (7 KB): bridges an authored placeholder child id to the live random one, fences the unknown-id lookup behind both accepted follow-ups, forces the child's final continuation turn to fail its durability checkpoint, and can fail a one-shot child's publication and disposal. |
| `packages/test-support/session-snapshot/tests/fixtures/subagent-result-diagnostic.ts` | A fixed provider producing four diagnostic results (product/stage/category) plus a cleanup failure, so parent-notification snapshots are deterministic. |
| `packages/test-support/session-snapshot/tests/fixtures/subagent-send-message-fence.ts` | Holds the child until the parent's spawn turn ends, then parks the parent until settlement follows its agent message — so replay scheduling cannot fold settlement into the parent's first turn. |
| `packages/test-support/session-snapshot/tests/fixtures/subagent-settlement-barrier.ts` | Holds the tool response until activation settlement has queued its notice. |
| `packages/test-support/session-snapshot/tests/fixtures/subagent-structured-parent.ts` | Registers a fixed-schema consumer and delivers a parent correction to the child mid-call, then awaits settlement. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-child/behavior.json` | The scripted parent + child logs for the record suite (both with a `system/message`, a `request/header` and the same inherited user message). |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-child/input.json` | The three-step input script (initialize, newSession, prompt). |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-child/session.1.jsonl` | The v0 child fixture (no `version`), with a literal macOS cwd and a `{{session:2}}`/`{{session:1}}` relationship. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-child/session.1.v3.jsonl` | The v3 child fixture with `{{cwd}}`, `{{system}}` and `{{tools}}` tokens and two distinct message ids. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-child/session.jsonl` | The v0 parent fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-child/session.v3.jsonl` | The v3 parent fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-child/snapshot.yml` | The minimal manifest (`version: 1`, `profile: acp`). |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-child/stdout.expected.jsonl` | The four expected JSON-RPC frames. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-child/tool-schemas.1.expected.json` | The child's own tool-schema sidecar (`t1`). |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-pin/behavior.json` | The scripted single log for the pin scenario. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-pin/input.json` | The three-step input script. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-pin/session.1.jsonl` | A v0 child fixture with a literal parent session id (not a token) — the retained historical generation. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-pin/session.jsonl` | The v0 parent fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-pin/session.v3.jsonl` | The v3 parent fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-pin/snapshot.yml` | The minimal manifest. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-pin/stdout.expected.jsonl` | The four expected frames. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-pin/system-prompt.expected.md` | The one-line readable prompt sidecar. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-pin/tool-schemas.expected.json` | The parent's tool-schema sidecar. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-skip/behavior.json` | An empty behaviour (no prompt, no logs). |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-skip/input.json` | A single initialize step. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-skip/replay.override.json` | The one-line `[{"kind":"hang"}]` override sidecar. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-skip/session.jsonl` | A header-only session fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-skip/snapshot.yml` | The minimal manifest. |
| `packages/test-support/session-snapshot/tests/fixtures/record-suite/rec-skip/stdout.expected.jsonl` | The single expected frame. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/authored-error/behavior.json` | The scripted error turn (`turn/end` with an error reason). |
| `packages/test-support/session-snapshot/tests/fixtures/suite/authored-error/input.json` | The `promptExpectError` step. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/authored-error/replay.override.json` | The `[{"kind":"throw","chunks":[],"message":"model exploded","code":"PROVIDER"}]` sidecar. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/authored-error/session.jsonl` | The v0 error fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/authored-error/session.v2.jsonl` | The v2 error fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/authored-error/snapshot.yml` | The minimal manifest. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/authored-error/stdout.expected.jsonl` | The expected frames including the JSON-RPC error frame. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/blocked-log/behavior.json` | The scripted `hook/result` with `decision: "block"` and a `durationMs`. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/blocked-log/input.json` | The `promptExpectError` step. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/blocked-log/session.jsonl` | The v0 blocked fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/blocked-log/session.v2.jsonl` | The v2 blocked fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/blocked-log/snapshot.yml` | The minimal manifest. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/blocked-log/stdout.expected.jsonl` | The expected frames. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/no-model/behavior.json` | An empty behaviour. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/no-model/input.json` | A single initialize step — the no-model scenario. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/no-model/session.jsonl` | A header-only fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/no-model/snapshot.yml` | The minimal manifest. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/no-model/stdout.expected.jsonl` | The single expected frame. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/pin-turn/behavior.json` | The scripted two-step turn: an initial header, a replaced `system/message`, a `series` header and a `change` header (the two header revisions the pin must own). |
| `packages/test-support/session-snapshot/tests/fixtures/suite/pin-turn/input.json` | The three-step input script. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/pin-turn/session.jsonl` | The v0 pin fixture with three header reasons. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/pin-turn/session.v2.jsonl` | The v2 pin fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/pin-turn/session.v3.jsonl` | The v3 pin fixture with the replaced prompt and the `sourceEventSeqs` reference. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/pin-turn/snapshot.yml` | The minimal manifest. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/pin-turn/stdout.expected.jsonl` | The four expected frames. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/pin-turn/system-prompt.expected.md` | The readable prompt sidecar with the `<!-- system/message change 1 -->` section — the format the parser splits on. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/pin-turn/tool-schemas.expected.json` | The tool-schema sidecar with `initial` and one `changes` entry (`t1` then `t1`,`t2`). |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/behavior.json` | The scripted parent + child logs, the child carrying its **own** prompt ("CHILD GUIDANCE") and its own tool set (`child-only`). |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/input.json` | The three-step input script. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/session.1.jsonl` | The v0 child fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/session.1.v2.jsonl` | The v2 child fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/session.1.v3.jsonl` | The v3 child fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/session.jsonl` | The v0 parent fixture with an `assistant/chunk` row. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/session.v2.jsonl` | The v2 parent fixture with a packed `assistant/attempt`. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/session.v3.jsonl` | The v3 parent fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/snapshot.yml` | The manifest with `workspace: { final: true }` — the scenario that owns the complete final workspace state. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/stdout.expected.jsonl` | The expected frames including the workspace-listing chunk. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/system-prompt.1.expected.md` | The child's own prompt sidecar. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/tool-schemas.1.expected.json` | The child's own tool-schema sidecar. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/workspace.expected/seed.txt` | The expected final workspace content ("prepared at runtime"). |
| `packages/test-support/session-snapshot/tests/fixtures/suite/plain-turn/workspace/seed.txt` | The committed seed file copied into the generated cwd before the run. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/shared-pin/behavior.json` | The scripted log whose changed header is shared with another scenario's pin. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/shared-pin/input.json` | The three-step input script. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/shared-pin/session.jsonl` | The v0 shared-pin fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/shared-pin/session.v2.jsonl` | The v2 shared-pin fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/shared-pin/session.v3.jsonl` | The v3 shared-pin fixture. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/shared-pin/snapshot.yml` | The minimal manifest. |
| `packages/test-support/session-snapshot/tests/fixtures/suite/shared-pin/stdout.expected.jsonl` | The four expected frames. |
| `packages/test-support/session-snapshot/tests/fixtures/working-directory-admission.ts` | Asserts that the first admitted request carries the *selected* working directory and no longer carries the previous one. |
| `packages/test-support/session-snapshot/tests/fixtures/workspace-context-compaction.ts` | Replaces the visible workspace baseline with a compaction summary after the first touch is fully projected. |
| `packages/test-support/session-snapshot/tests/fixtures/workspace-context-global-failure.ts` | Exercises user-global instruction reconciliation during a provider-metadata outage by making one copy of `AGENTS.md` unavailable. |

### Tier 3 — skipped with a reason (8 files)

All eight are `generated-vendored` bilingual-pair hash records (`README.i18n.yaml`). Each was confirmed by its name, its byte size and a 12-line head peek: every one is the same shape — a comment naming the paired README and the regeneration command (`pnpm run verify-translation-pairing --write <README>`), followed by one YAML mapping of heading-section path → `{en: <hash>, zh: <hash>}`. They are generated artefacts, not prose; they were not read line by line.

| File | Why not read line by line |
| --- | --- |
| `packages/test-support/README.i18n.yaml` | Generated bilingual-pair hash record (866 B); confirmed by head peek — heading-path → `{en,zh}` hashes for `README.md`. |
| `packages/test-support/agent-loop-testkit/README.i18n.yaml` | Generated bilingual-pair hash record (2061 B); head peek confirms the same shape. |
| `packages/test-support/client-runtime/README.i18n.yaml` | Generated bilingual-pair hash record (2699 B); head peek confirms the same shape. |
| `packages/test-support/llm-mock-server/README.i18n.yaml` | Generated bilingual-pair hash record (2363 B); head peek confirms the same shape. |
| `packages/test-support/llm-replay/README.i18n.yaml` | Generated bilingual-pair hash record (2276 B); head peek confirms the same shape. |
| `packages/test-support/loader-smoke/README.i18n.yaml` | Generated bilingual-pair hash record (2208 B); head peek confirms the same shape. |
| `packages/test-support/remote-mock/README.i18n.yaml` | Generated bilingual-pair hash record (2292 B); head peek confirms the same shape. |
| `packages/test-support/session-snapshot/README.i18n.yaml` | Generated bilingual-pair hash record (2428 B); head peek confirms the same shape. |

---

## 2. Ideas worth stealing

1. **Fail-loud test doubles that name the missing dependency.** `packages/test-support/client-runtime/src/sessions.ts:107-110` — an unstubbed verb throws `"test session "s1": prompt is not stubbed — supply it on the fixture's session face"`. *Why it transfers*: August Trading's doubles frequently no-op, so a green suite proves nothing about the path that mattered. `UNIQUE` in this repo's form; the principle is general.
2. **A scriptable provider-fault server with 24 named wire behaviours.** `packages/test-support/llm-mock-server/src/index.ts:20-44` — resets, partial disconnects, stalls, empty completions, missing `[DONE]`, malformed JSON, 429/500/503, auth/quota/context-overflow codes, tool calls, `max_tokens`. *Why it transfers*: August Trading retries provider calls; today those paths are untested without a real key. `CONVERGENT` — the other reference repos also ship provider mocks.
3. **Validation happens BEFORE the fault script advances.** `packages/test-support/llm-mock-server/src/index.ts:560-600` — "Invalid requests do not consume the script", so a misconfigured client can burn retries without advancing the sequence. *Why it transfers*: any request/response fault-injection harness for August Trading's provider transport. `UNIQUE`.
4. **A recorded-transcript replay adapter with an explicit override sidecar for what a log cannot reconstruct.** `packages/test-support/llm-replay/src/index.ts` — the derived script comes from the durable log; a `replay.override.json` supplies the two impossible cases (a throw before any chunk, and a hang/cancel), in either a whole-script or a positional-patch form. *Why it transfers*: August Trading could record one real provider conversation per provider-error scenario and replay it deterministically. `CONVERGENT` — keyless replay appears in more than one reference repo.
5. **`assertConsumed()` — a teardown check that the scenario drove as many model calls as were recorded.** `packages/test-support/llm-replay/src/index.ts:1150-1170`. *Why it transfers*: the same check (fixture fully consumed) would catch an August Trading snapshot that stopped exercising a code path without anyone noticing. `UNIQUE`.
6. **Unmatched-endpoint accounting: any request with no rule fails the test at teardown.** `packages/test-support/remote-mock/src/remote-mock.ts:330-337` and `packages/test-support/client-runtime/src/assembly/vitest.ts:38-47`. *Why it transfers*: August Trading's provider and IPC mocks should report every unstubbed call, not silently return `undefined`. `CONVERGENT` — a mock that logs misses is common across the reference repos.
7. **Tokenize volatile values instead of deleting them, and preserve relationships.** `packages/test-support/session-snapshot/src/identity.ts` — typed first-seen tokens (`{{session:1}}`, `{{message:1}}`, `{{cwd}}`, `{{system}}`, `{{tools}}`) keep the parent/child id relationship intact across two logs, and unexpected fields (including `system`) stay visible so regressions remain visible. *Why it transfers*: August Trading's snapshots over trades/analysis would otherwise drift on every id, timestamp and path. `UNIQUE` in this exact form.
8. **One pin per composition class, with byte-identical sidecars rejected.** `packages/test-support/session-snapshot/src/suite.ts` — exactly one scenario may pin a header class; every other member is checked against it; identical committed content under two paths is an error ("reuse one source"). *Why it transfers*: August Trading has several surfaces that assemble the same prompt; a "one owner, many checkers" rule stops the copies from drifting. `UNIQUE`.
9. **Placeholders resolved against the live request at replay time.** `packages/test-support/llm-replay/src/index.ts` — `{{fromRequest:<regex>}}` lets one fixture script a value it cannot know (a randomly minted goal id the model must echo back). *Why it transfers*: August Trading's recorded provider interactions often contain ids minted at run time. `UNIQUE`.
10. **A closed manifest schema that rejects unknown fields and JS YAML tags.** `packages/test-support/session-snapshot/src/manifest.ts:190-230`. *Why it transfers*: any declarative scenario/strategy file in August Trading should refuse a typo rather than ignore it. `UNIQUE`.
11. **A "no second implementation of production logic" test bench.** `packages/test-support/client-runtime/src/index.ts` — the bench mounts the production SlotRegistry, renderer and ui-session adapter, and the *only* thing it reimplements is the owner interface the feature consumes. *Why it transfers*: August Trading's jsdom tests could mount the real store/renderer rather than a reimplementation. `CONVERGENT` — mounting production machinery is the pattern across the reference repos.
12. **Every wait names the subject, the deadline and the missing fact, and keeps the cause.** `packages/test-support/session-snapshot/src/harness.ts:560-700` — `waitForTurnStart`, `waitForTurnEnd`, `waitForGoalPhase`, `waitForInboxMessage`, `waitForTitleAfterTurnEnd`, `waitForEventAfterTurnEnd`. *Why it transfers*: August Trading's automation and monitor code would benefit from the same discipline on its own durable waits. `UNIQUE` in wording; general in principle.
13. **A support-tier group with an explicit exit rule.** `packages/test-support/README.md` — "a package moves out of this group when it gains a product contract and product consumers." *Why it transfers*: a written rule that decides when test infrastructure becomes product code — August Trading's `scripts/` and `tests/` blur is a live question. `UNIQUE`.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** *not in this shard* — no cron, digest or scheduler lives here. But the shard does contain the **durable-wait pattern** a monitoring loop needs: `packages/test-support/session-snapshot/src/harness.ts:560-700` waits on a *persisted boundary* (`turn/start`, `turn/end`, a goal phase, an inbox insertion) rather than on a timer, and every timeout names the session, the deadline and the missing fact while keeping the underlying error as `cause`. The same file also shows the **idempotency trap** August Trading's automations must avoid: `waitForTurnEnd` uses the raw-JSONL closing boundary "so subprocess disposal [cannot] change an `aborted` turn into a `disposed`".
- **Human-in-the-loop approval:** the harness's permission queue is **FIFO by option *kind*, not option id** (`packages/test-support/session-snapshot/src/harness.ts:117-135`) because option ids are agent-issued randoms a committed script cannot know, while kinds are the stable vocabulary. A request beyond the queue is answered `cancelled` (fail closed). A scripted kind the agent never offered **rejects the run** rather than being absorbed as a denial. The audit trail is the committed `input.json` (the script) plus the recorded `approval/asked` / `approval/decided` events, whose ids are redacted to typed tokens while the *relationships* survive (`packages/test-support/session-snapshot/src/identity.ts`). The durable-teaching analogue for August Trading: a **permission preset** (`read-only` / `workspace-write` / `danger-full-access`) is a first-class, recorded field (`packages/test-support/session-snapshot/src/manifest.ts:47-49`).
- **Post-mortem / reflection loops:** *not in this shard* — no outcome→rule loop here. The nearest thing is the **post-mortem fixture** `packages/test-support/session-snapshot/tests/fixtures/subagent-result-diagnostic.ts`, which produces fixed diagnostic strings ("Product subagent failure (product: Codex; stage: turn; category: transport; HTTP status: 503)") — a *classified* failure taxonomy recorded alongside the partial output, i.e. the shape a reflection loop would need.
- **Multi-agent:** the shard contains six subagent fixtures, and they are the interesting part. `subagent-activation-limit.ts` orders parent admission and child completion with `maxActiveSubagents: 1` and no elapsed-time assumption; `subagent-settlement-barrier.ts` holds the tool response until settlement has queued its notice; `subagent-send-message-fence.ts` parks the parent until settlement follows its agent message "so replay scheduling cannot fold settlement into the parent's first turn or starting a second parent request between the Agent message and settlement"; `subagent-durability-failure.ts` forces the child's last continuation turn to fail its durability checkpoint "so the scenario proves child-first disposal survives a failed last flush". **Where debate adds nothing here:** `llm-replay` binds each live session to a recorded script by **first-call order** and the README says outright that a concurrent cut "would bind live sessions to recorded scripts non-deterministically" — a concurrent subagent fan-out is exactly the case this design cannot express.
- **Structured logs the model can query, without a heavy database:** the Session format *is* the trade log. `packages/test-support/session-snapshot/src/normalize.ts` enumerates the event vocabulary the product persists: `turn/start`, `turn/end`, `step/start`, `step/end`, `system/message`, `developer/message`, `request/header`, `assistant/message`, `assistant/attempt` (with a *packed* chunk stream carrying `time0` and `dt` gaps), `tool/result`, `agent/inbox/spliced`, `approval/asked`, `approval/decided`, `goal/change`, `job/registered`, `job/settled`, `hook/result`, `subagent/catalog`, `subagent/descriptor`, `compaction/start|summary|end`, `session/title`, `feedback/message-put`. It is JSONL — one file per session, append-only, no database — and the normalizers show it can be queried structurally (a `goal/change` phase, a `job/settled` outcome, an `approval/decided` id) after normalising the clocks.
- **Staying simple as features accumulate:** the group's own README states the rule that keeps it honest — "a package moves out of this group when it gains a product contract and product consumers" — and the packages hold to it by having **zero runtime dependencies** (`packages/test-support/agent-loop-testkit/package.json`) and by refusing to ship a second implementation of production logic. The `client-runtime` bench's own limit is stated as a *known limitation* rather than papered over.

---

## 4. Non-obvious decisions and gotchas

1. **`mountAgentLoopTestDependencies` deliberately stops before `AgentLoop`** (`packages/test-support/agent-loop-testkit/src/index.ts:88-99`). A reader expecting a one-call setup will mount the loop too early and deadlock their own load order.
2. **`unsupportedInbox()` allows reads and refuses writes** (`packages/test-support/agent-loop-testkit/src/inbox.ts:66-79`). A test can read `nextTurn` and get `[]` — only a *mutation* throws.
3. **`createClientTest`'s mock fixture calls `assertNoUnmatched()` even when no client was started** (`packages/test-support/client-runtime/src/assembly/vitest.ts:38-47`). A spec that never boots the client still fails on a miss.
4. **The whole-client tier refuses `provide` for `@deepseek-ai/dsh-api-remotes` and `@deepseek-ai/dsh-api-remote-access`** (`packages/test-support/client-runtime/src/assembly/test-client.ts:190-196`) — those rows are *dropped*, not stubbed, and their behaviour is replaced by contract-free proxies and allow-all access.
5. **`RemoteMock.create()`'s single `$events` registration is what lets an assembled client reach `connected`** (`packages/test-support/remote-mock/src/remote-mock.ts:97-107`). Remove it and the whole-client tier hangs at readiness.
6. **`endpoints()` includes *accessed* proxy methods, not only registered ones** (`packages/test-support/remote-mock/src/remote-mock.ts:196-206`). A spec that merely touches `mock.remote.foo.bar` makes `foo` a known namespace.
7. **`MockedRemote`'s `any` is scoped to the test proxy only** (`packages/test-support/remote-mock/src/remote-proxy.ts:11-15`) — and `proxy-types.client.spec.ts` proves it by compiling probe programs in a virtual TypeScript host.
8. **The llm-mock-server's random weights are labelled "test pressure, not an estimate of production incident frequency"** (`packages/test-support/llm-mock-server/src/index.ts:55-70`). Copying those numbers into a real client's retry budget would be a mistake.
9. **`llm-mock-server`'s script cursor is global and arrival-ordered**, so concurrent callers share it — deterministic per-session fault assignment needs separate server instances.
10. **`llm-replay` binds live sessions to recorded scripts by first-call order** and the source carries an explicit `XXX(concurrent-subagents)` marker (`packages/test-support/llm-replay/src/index.ts:790`) — a documented gap, not an oversight.
11. **`session-snapshot`'s harvest order and `llm-replay`'s load order must agree**, and the comment says so (`packages/test-support/session-snapshot/src/harness.ts:820-826`). Changing one without the other silently mismaps child sessions.
12. **`snapshotSpillRoot` uses a different root length on Windows** ("Windows uses a two-character-shorter root because drive resolution adds its drive prefix", `packages/test-support/session-snapshot/src/harness.ts:222-232`) — a cross-platform locator budget, not an accident.
13. **`normalizeStdout` throws on a non-JSON stdout line** (`packages/test-support/session-snapshot/src/normalize.ts:361-372`) — the normalizer *is* the protocol purity check.
14. **The snapshot normalizers tokenize, never delete** — an unexpected request-header field (including `system`) stays visible so a regression cannot hide behind a scrub.
15. **`assertSessionFixtureStorage` applies the current-generation rules only to current generations**; a retained historical role keeps its released bytes ("Historical roles retain their released bytes, including roles retired by the current writer").

---

## 5. Weak spots

1. **The whole-client tier does not run the generated Remote clients.** `packages/test-support/client-runtime/src/assembly/remote-proxies.ts` forwards positional arguments with no zod validation, no wire-name mapping and no scoped-identity injection, and it bypasses the Gateway client's `invoke`/`invokeStream` entirely. An endpoint the spec never declared as a stream is dispatched as a **unary** call. A green whole-client test therefore does **not** prove the production client works — the README admits this, and the generated clients stay covered only by the built-artifact e2e lane.
2. **`packages/test-support/session-snapshot/src/suite.ts` is 1760 lines / 84 KB in one file** with at least five responsibilities (registration contract, fixture guards, normalization helpers, refresh stabilisation, comparison). `packages/test-support/client-runtime/src/sessions.ts` carries deliberate `jscpd:ignore` duplication of production settlement semantics for the same reason. Both are the parts most likely to rot, and both are load-bearing for the whole snapshot tier.
3. **The replay binding is first-call order, which is wrong for concurrent subagents** — the source says so, and the fixtures compensate with five elaborate fences (`subagent-send-message-fence.ts`, `subagent-settlement-barrier.ts`, `subagent-activation-limit.ts`, `subagent-durability-failure.ts`, `subagent-structured-parent.ts`). A concurrent fan-out would bind scripts non-deterministically.
4. **The mock values are not checked.** `packages/test-support/remote-mock/README.md` lists it: answers cross by reference (a non-JSON downlink the real wire would reject passes through), a unary answer is not checked to be `{ ok, value }`, and rules match on **endpoint only** with no payload matching — "discriminate on business arguments inside a handler". A test can therefore pass against a malformed envelope.
5. **The `llm-mock-server`'s `random` weights are a fabricated distribution**, and `connection_refused` can only be produced by a *listener-lifecycle* phase, not by request-level selection — "request-level random selection can only reset an accepted connection". Both are documented, but both mean a stress run cannot reproduce a real incident distribution.
