# deepseek-harness :: dsh-client-misc

**Files in shard:** 146 (read: 146, skipped with reason: 0)
**What this shard covers:** the browser half of the DeepSeek Harness web GUI: the `packages/client/` package group
authoring rules and package map, the development-reload transport (`hmr`), the React-free snapshot-store engine
(`store`), the shared client bundle preset (`tsdown.client.ts`), and three UI plugin packages — `ui-attachment`
(composer/message attachments), `ui-deepseek-model-label-1017` (a one-badge model-label plugin) and
`ui-deliverables` (changed-files cards, file diffs, review tabs) — plus the `web` shell that boots the page
(page boot, transport injection, window drag). Nothing here is model-facing: every package in this shard declares
"Model Experience: None". The interesting parts for August Trading are the *engineering discipline* — the slot
contract, the one-store-per-domain rule, the HMR revision protocol, the localisation/i18n pairing gate, and the
deliverables diff/review surfaces.

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/client/AGENTS.md`
- **Purpose:** the authoring contract for every package under `packages/client/*` (the browser half of the dsh web GUI) plus `apps/web`. 162 lines; it supplements the repo-wide `AGENTS.md`.
- **Key abstractions:** none (prose), but it *defines* the abstractions the shard's code implements: the five props shares (`PropsRuntime`, `PropsRenderSlots`, `PropsRenderFactories`, `PropsStore`, inject face), the slot registration forms, the store handle/instance split, and the module-graph `external` concept.
- **Data flow:** n/a — it is the rulebook the rest of the shard obeys.
- **Non-obvious design decisions (each is a steal-worthy rule):**
  - *Live data has exactly three channels* (`:15`): parent knows it → owner props at the `renderSlot` site; only the component knows it → local state; shared across entries or survives remount → a store declared at `register`. Derived data is a pure function (`useMemo`), never its own subscription.
  - *Business components contain no subscription machinery* (`:26`): no `useSyncExternalStore`, no manual subscribe wiring, no mirroring an external snapshot into local state. This is a hard ban on a very common React pattern.
  - *Effects do not synchronize state* (`:32`): "`useLayoutEffect` is not a default and `useEffect` is not the fix" — a layout measurement must answer why it happens here and take an injected measurement hook; an effect never pushes render-derivable data back to a parent.
  - *`ctx` belongs to the apply world only* (`:44`): components receive data and callbacks through the derived props shares; they never see `ctx`, never import a service class to poke it, never read a React context.
  - *A feature plugin MUST NOT runtime-import another feature plugin's values* (`:40`): shared declarations use `import type`; behaviour crosses packages through injected Cordis services, UI through slots; "If neither fits, stop and escalate — do not add an export to unblock yourself."
  - *Business data lives in the object layer, never a store* (`:56`): entry-declared stores carry shared *viewing/interaction* state (selection, drafts, panel widths); sessions, frames, connections stay in the object layer.
  - *A `key` states identity* (`:19`): a key that only silences a warning, or encodes render order, misstates identity.
  - *Every product-visible string lives in a typed locale dictionary* (`:121`), enforced by `pnpm run verify-client-ui-i18n`; internal matching uses discriminants or stable ids, never localized text.
  - *The module graph sits below Cordis DI* (`:89-101`): a table contrasting Cordis service `inject` (runtime, waits, replaceable, cycles allowed) with module-graph `external` (materialization, throws on the spot, single identity, cycles rejected).
  - *Per-file 100% coverage gate* for client source packages (`:127`); unreachable defensive arms need a `/* v8 ignore -- <reason> */` with a real reason.
  - *The local check ladder* (`:134-140`): `pnpm run test:gui` for every GUI change; `DSH_SNAPSHOT=replay pnpm run test:web` for anything that can alter assembled browser output; no repo-wide pre-push aggregate.
- **Edge cases & failure handling:** n/a (prose), but it names them: a slot name that mirrors the composition path (`<domain>.<entry>.<hole>`), a `Factory` local Component created during render (remounts the subtree, resets its local state), and a store handle exported at module level (a "disguised singleton across plugin reloads").
- **Surprising:** the doc explicitly forbids the two most common React idioms (`useSyncExternalStore` in business components, `useEffect` as a synchronizer) and forbids a plugin from importing another plugin — the whole point of the slot system is to make that unnecessary.

#### `packages/client/tsdown.client.ts`
- **Purpose:** the shared tsdown preset that builds every client plugin's browser bundle. 780 lines, and the most load-bearing build file in this shard.
- **Key abstractions:** `clientBundle(packageDir, libEntry, options)` (`:115`) for dynamic browser plugins; `staticLinked(packageDir, libEntry)` (`:168`) for libraries the shell links statically; `clientLibrary` (`:199`), `clientOnly` (`:209`); `isStaticLinkedConfig(configs)` (`:186`) — the roster marker that lets gates ask "is this package in the static assembly channel?" without a second hand-kept list; `INLINE_SAFE` (`:69`) — the regex of packages a bundle may inline; `requestedExternals(subject, declaration)` (`:413`).
- **Data flow:** a package's `tsdown.config.ts` calls a preset → the preset reads the package's own `package.json` (name, npm sections, `dsh.client.external`) → produces a tsdown `UserConfig` (or a function of `DSH_BUILD_FACE`) → rolldown/lightningcss emit `lib/client.js` → the artifact is a **closure factory**: `window.__ModuleLoader__.load({ id, factory })` where the factory receives an injected `require` (the loader's module table) and returns `module.exports` (`:664-669`).
- **Non-obvious design decisions:**
  - *The bundle purity gate* (`:567-577`): any `@deepseek-ai/*` value import that is neither a requested module-table row, a vendored library, an inline-safe wire layer, nor a generated `/remote` contribution is a **build error**. This turns "two plugins accidentally share a runtime instance" from a subtle bug into a red build. Type-only imports are erased and never reach the gate (`:576`).
  - *The rule is the package's own request list* (`:523-531`): `neverBundle: isRequested`, `alwaysBundle: (s) => !isRequested(s)`. The comment explains why: "A `require()` the table cannot answer is a guaranteed runtime throw."
  - *`staticLinked` keeps every bare specifier an import* (`:307-312`), because the shell attributes chunk bytes by `node_modules/<pkg>` — inlining a dependency into a workspace file collapses the vendor/index cache split. It also rejects two entries with the same basename (`:172-175`) because they would overwrite one artifact.
  - *CSS Modules are compiled inside the bundle* by lightningcss with pattern `[hash]_[local]` (`:592-597`), injected as a tagged `<style>` at factory execution, deduped by `style[data-plugin-css=...]` (`:51`); `?inline` exports compiled text for a plugin-owned lifecycle effect. The class map is emitted **sorted by local name** (`:600`) so the artifact is deterministic.
  - *Virtual CSS ids must not end in `.css`* (`:32-35`): tsdown's own guard matches ids ending in `.css`, so the loader uses a `\0dsh-css:` prefix + `.mjs` suffix.
  - *`asyncChunkRequirePlugin`* (`:446-479`) rewrites `Promise.resolve().then(() => require("./client.x.js"))` into `require.async("./client.x.js")` — and **throws** if the generated pattern is missing (`:462`), because a synchronous relative require in a chunk is a runtime failure the runtime does not support.
  - *The same plugin stamps the entry's mtime after the build* (`:470-477`): `utimes(entryPath, atime, max(now, mtime+1))` so the HMR poller sees a deterministic revision.
  - *`import.meta.env` must be defined three ways* (`:554-559`): `process.env.NODE_ENV`, `import.meta.env.MODE` **and** bare `import.meta.env` — because zustand probes `import.meta.env ? import.meta.env.MODE : ...` and a truthiness probe would otherwise survive as an empty `import.meta`.
  - *Client input isolation* (`:675-719`): a non-experimental package's bundle may not contain any input outside its own package — asserted at `generateBundle` and again on the sourcemap path, so a plugin cannot smuggle another package's file into its artifact.
- **Edge cases & failure handling:** unreadable `package.json` throws with a message telling the caller to pass `import.meta.dirname` (`:377-381`); a manifest with no string `name` throws (`:383-386`); `buildFace` throws on an unknown `DSH_BUILD_FACE` (`:232-235`); a stylesheet outside the package's `src/` throws (`:349`); a rolldown module with no bundler record throws (`:695`).
- **Surprising:** the preset carries its own *purity* rules and *isolation* rules — it is not just a bundler config, it is the enforcement point for the architecture the AGENTS.md describes. Also: `clean` must stay `false` because cleaning this invocation would wipe the independently emitted Node entry (`:512-514`).

#### `packages/client/hmr/src/index.ts` (Node half)
- **Purpose:** Host-side transport that keeps open browser pages in sync with the plugin graph and reloads rebuilt bundles. Stat-polls every graph row's client bundle and serves `/plugins/events` as SSE.
- **Key abstractions:** `apply(ctx, config)`; `Config { pollIntervalMs }` validated by schemastery with `.step(1).min(1).default(500)` (`:36-38`); `bundleStat` / `sameBundleStat` (`:44-55`); `watched: Map<string, WatchedBundle>`; `publish` / `watchRow` / `pollWatches` / `syncWatches` (`:74-137`).
- **Data flow:** `ctx.clientModules.graph()` → per-row `artifactBaseline(id)` → `statSync` on each row's `lib/client.js` → a change in `(mtimeMs, ctimeMs, size)` calls `ctx.clientModules.rebuilt(id)` → the SSE channel broadcasts `{ type: 'rebuilt', id, rev }` to every connected browser. Separately, `onGraphChanged` republishes the whole graph to all connections and re-syncs the watch set.
- **Non-obvious design decisions:**
  - *Revision = metadata, not content* (`:44-55`): the entry's mtime, ctime and size identify the revision "without hashing its contents; unchanged metadata requires no content read." Host restarts over unchanged artifacts keep the same revisions, so reconnecting the graph stream does not replace browser plugins.
  - *`ctime` is part of the identity* (`:50-52`): a rewrite that preserves mtime and size still publishes, because ctime advanced. The node-half test pins exactly this (`node-half.client.spec.ts` — "publishes a ctime change when a rewrite preserves mtime and size").
  - *Stat-before-publication preserves a detectable older baseline* (`:117-120`): the stat is taken **before** `rebuilt()` is called, so a write that lands during the read is still seen on the next poll.
  - *ENOENT is not an error* (`:80-90`, `:104-112`): a missing bundle marks the watch `dirty` and is retried; a bundle that reappears with the same mtime/size still publishes because the dirty flag forces it.
  - *The graph carries no cleanup-completion guarantee* (README `:62`): the browser is told the *desired* entries; Host activation and cleanup stay with the Host lifecycle. The node-half test asserts the graph is broadcast **before** the Host finishes activating, and that disposing the row does not retract the frame.
  - *The SSE channel writes a `: connected` comment on open* (`:167-170`) so clients/proxies see a live channel even when no rebuild ever happens; `EventSource` frame parsing skips it naturally.
  - *A non-GET hit on the endpoint keeps the old global 405 semantics* (`:180-186`): "Named routes match ahead of the carrier's method gate."
- **Edge cases & failure handling:** `publish` catches an error from `rebuilt()`, treats `ENOENT` as "still dirty", and warns on anything else; a `statSync` failure is non-fatal (warn, keep the watch dirty). The interval is `unref()`ed (`:143`) so it never holds the process open. Dispose unsubscribes, clears the interval and clears the watch map (`:145-149`).
- **Surprising:** the plugin polls with `statSync` *by design* — "polling by design: network mounts deliver no inotify events" (`:5-6`).

#### `packages/client/hmr/src/events.ts`
- **Purpose:** the shared wire protocol of the `/plugins/events` SSE channel.
- **Key abstractions:** `PluginsEventFrame` = `{ type: 'graph'; graph: WebBootGraph }` | `{ type: 'rebuilt'; id: string; rev: string }`; `PluginsEventParseResult` = `frame | unknown | invalid`; `parsePluginsEventFrame(value)`; `EVENTS_ENDPOINT = '/plugins/events'`; `EVENTS_ROUTE = 'plugins/events'` (document-relative, `:59-64`).
- **Data flow:** JSON string on the wire → `JSON.parse` in the browser half → `parsePluginsEventFrame` → either a known frame, a forward-compatible `unknown`, or `invalid`.
- **Non-obvious design decisions:**
  - *Three outcomes, not two* (`:29-33`): a **known** frame, an **unknown** `type` string (forward compatibility — a newer Host may add a frame type and the page must not treat it as corruption), and **invalid** (a known type with a broken payload). The header comment is explicit that sharing the type keeps the ends from drifting, *not* from parsing.
  - *The graph payload is not validated here* (`:27-28`): "the module controller parses the complete graph before updating its index" — the envelope is validated at the wire, the body at the owner.
  - *`EVENTS_ROUTE` strips the leading slash* (`:64`) so the browser half can fetch it relative to the document (the app may be served under a base path).
- **Edge cases & failure handling:** `null`, `[]`, `{}`, `{ type: 'rebuilt' }` (missing id), `{ type: 'graph', graph: null }` are all `invalid`; `{ type: 'future' }` is `unknown` (pinned by `events.client.spec.ts`).
- **Surprising:** the type lives in a *shared* module that both the Node and browser halves import — but the comment insists the wire is still a wire boundary and each side parses independently.

#### `packages/client/hmr/src/client/index.ts` (browser half)
- **Purpose:** the page-side SSE subscription that forwards graph/rebuilt frames to the client module system's serial controller.
- **Key abstractions:** `apply(ctx)`; `readPageTransportEvents(fetch, signal, receive)`; `PageTransportGlobal.__DSH_TRANSPORT__.fetch` — an optional shell-owned request carrier.
- **Data flow:** frame → `parsePluginsEventFrame` → `entries.sync(frame.graph)` for a graph, `entries.reload(frame.id, frame.rev)` for a rebuild; both are promises and failures are logged via `ctx.logger.error` (`:51-54`).
- **Non-obvious design decisions:**
  - *Two transports, one behaviour* (`:69-82`): if the page has `__DSH_TRANSPORT__.fetch` (the worker preview's tunnel) it streams through it; otherwise it uses `EventSource`. The tunnel path is a `fetch` + `TextDecoderStream` + `EventSourceParserStream` reader, aborted by an `AbortController` on dispose.
  - *A stream that ends while the plugin is active is an error* (`:32-33`): "client-hmr: plugins/events closed; client graph changes stop until the page reloads" — the browser is told loudly rather than silently going stale.
  - *A malformed frame is dropped loudly* (`:57-60`): `ctx.logger.warn` with the raw payload, and the frame is discarded. Unknown frame types are logged too.
  - *Abort is silent* (`:75-77`): an abort during dispose must not log an error — the test "stays silent when disposal aborts a page-transport request in flight" pins it.
- **Edge cases & failure handling:** a non-OK response or a null body throws `client-hmr: plugins/events answered <status>`; the reader loop breaks on `done` and, if not aborted, throws the "closed" error.
- **Surprising:** the browser half does **not** own the reload; it delegates to `ctx.modules.entries.sync/reload`, which "serializes entry changes and waits for browser resource cleanup".

#### `packages/client/store/src/contract.ts`
- **Purpose:** the framework-neutral snapshot/store contract — the type layer of the whole slot system.
- **Key abstractions:** `ObservableSnapshot<T>` (`getSnapshot`/`subscribe`); `SnapshotSelectorHook<T>`; `MaybeSnapshotSelectorHook<T>` (a selector that is *always present* but whose value is `undefined` when no session is current — "keeps hook call sites stable across no-session/session transitions without pretending that a session snapshot exists"); `ActionsDecl<T>`; `BakedActions<T, A>` (the draft parameter stripped — "what components (`props.actions`) and inject factories receive"); `StoreSpec<T, A>`; `StoreInstance<T, A>`; `StoreHandle<T, A>`; `StoreFactory`; `StoreDecl`; `HandleOf<H>`; `BoundActions<H>`; `PropsStore<H>`; `DefineStore`.
- **Data flow:** types only — the flow is `StoreSpec` → `defineStore` → `StoreHandle` → `handle.create(scopeKey?)` → `StoreInstance` → the renderer's `useStore` hook.
- **Non-obvious design decisions:**
  - *The store's write set is the audit face* (`:36-40`): "declared as the store's complete write set (the audit face — components can only write through these)." A component can read anything but can only mutate through declared actions.
  - *`init` is a lambda* (`:55-57`): "a lambda so every instance gets a fresh state."
  - *Handles must never be exported at module level* (`:95-99`): "module-cache identity is a disguised singleton across plugin reloads" — a plugin that hot-reloads would keep serving the old handle.
  - *`clearPersisted` is explicit and NOT called on scope teardown* (`:80-83`): "Runtime scope teardown does not call this operation."
  - *The `any[]` in `ActionsDecl` is deliberate and commented* (`:42-44`): `unknown[]` would reject every concrete signature under strict parameter contravariance.
  - *The `A & ActionsDecl<T>` intersection at the call site is load-bearing* (`:156-170` in `src/index.ts`): T resolves from `init` in the first inference round, then the intersection contextually types each mutator's draft parameter, so call sites write `(d, x: X) => {...}` with no draft annotation. The documented fallback if TS breaks this is currying: `defineStore(init).actions({...})`.
- **Edge cases & failure handling:** type-level only.
- **Surprising:** the `StoreHandle.create(scopeKey?)` contract says a per-session instance suffixes the persist key so per-session instances persist independently — persistence scoping is a *type contract*, not a runtime convention.

#### `packages/client/store/src/index.ts`
- **Purpose:** the React-free snapshot-store engine (zustand vanilla + immer + subscribeWithSelector + a rAF flush middleware + opt-in persist + dev freeze) plus `defineStore`.
- **Key abstractions:** `createSnapshotStore<T>(init, { flush?: 'raf' | 'sync'; persist?: { name } })`; `notifySubscribers(listeners, label, ...args)`; `shallowEqual`; `defineStore(decl)`; `attachPersistence`; `devFreeze`; `EngineStoreInstance` / `EngineStoreHandle`.
- **Data flow:** `defineStore({ init, persist?, actions })` → `handle.create(scopeKey)` → a `createSnapshotStore` instance → each declared action is bound to `store.update(draft => mutate(draft, ...params))` → immer's `produce` → a new frozen snapshot → subscribers notified (sync or one-per-frame).
- **Non-obvious design decisions:**
  - *Persistence is hand-rolled, not zustand's `persist` middleware* (`:141-146`): the middleware's write path spreads state into an object (`partialize({ ...get() })`), "exploding primitive state (a persisted string draft becomes {0:'h',1:'e',...})" — and the corruption happens *before* serialization, so it is not fixable via merge/deserialize options. This is a concrete, hard-won gotcha.
  - *The flush default is `sync`; `raf` is opt-in* (`:79-81`): "controlled inputs need same-tick echo." The known `raf` tradeoff is documented (`:76-78`): a component mounting mid-frame reads fresh state while existing subscribers hear it next flush — "transient frame-level skew, same nature as the object layer's microtask batching."
  - *rAF falls back to a microtask* where `requestAnimationFrame` is absent (`:57-66`) — node unit tests — preserving the "N changes = 1 notification within a tick" contract in both environments.
  - *`notifySubscribers` copies the listener set before dispatch and isolates failures* (`:37-50`): one throwing subscriber is logged (`console.error`) and cannot starve the rest. This is the "no single callback can starve the others" rule.
  - *`update` uses immer's `produce`, not zustand's partial-merge `setState`* (`:110-113`): "so scalar and array roots replace correctly."
  - *`set` bypasses immer, so it needs its own `devFreeze`* (`:115-117`, `:166-170`), and `devFreeze` is a **deep freeze outside production only**.
  - *The persist key IS the storage identity* (`:180-186`): two live instances created under the same resolved key share (and cross-pollute) one `localStorage` entry. Production is safe because the framework caches one instance per handle × scope key; `create()` deliberately does not dedupe or throw so tests can create freely.
  - *Storage failures only disable persistence, never break the store* (`:148-152`): quota/private-mode errors are caught and logged. `clearPersisted` swallows failures with the same non-fatal contract.
  - *No `localStorage` in node → persistence silently disables* (`:150-153`), with the reason given: "same contract as a storage failure, minus the per-store console noise a ReferenceError would produce."
- **Edge cases & failure handling:** rehydration parse failure → `console.error("snapshot store '<name>' rehydration failed:", error)` and the store still starts fresh; write failure → `console.error("snapshot store '<name>' persistence failed:", error)` and the write still lands.
- **Surprising:** the store engine is deliberately **not** React-aware: "Engine products are bare observables — subscribe/getSnapshot/update/set, NO selector hook. Hook synthesis is ui-renderer's."

#### `packages/client/ui-attachment/src/AttachmentRail.tsx`
- **Purpose:** the horizontal, scrollbar-less draft-attachment rail with edge paging arrows.
- **Key abstractions:** `AttachmentRail<T extends AttachmentRailItem>`; `AttachmentRailItem { id }`; `AttachmentRailLabels { group, scrollLeft, scrollRight }`.
- **Data flow:** the owner passes `items`, `labels` and a `renderItem` callback; the rail owns only scroll geometry state (`edges`), never the attachment data.
- **Non-obvious design decisions:**
  - *The first layout pass is distinguished from growth* (`:59-62`): `countRef` starts `null`; a rail that **mounts** over an existing draft (a session switch back to held images) must not jump to the end — only a *growing* item count scrolls to the end (`:71-78`).
  - *A 1px slack at the edges* (`:65-68`): "engines report fractional scroll positions at the edges."
  - *The rail observes ITSELF, not the window* (`:85-93`): the rail's width follows the composer, which resizes with sidebars and panels; a `ResizeObserver` on the rail element catches those, "not only window resizes."
  - *The wheel is consumed exclusively and manually non-passive* (`:95-115`): React's root wheel listener is passive, so without a manually attached `{ passive: false }` listener a vertical tick would also scroll the conversation behind the composer. `deltaMode` LINE and PAGE are normalized to pixels (Firefox notch wheels), a purely horizontal pan stays native, and a per-tick clamp of 60px keeps a fast wheel followable.
  - *Reduced motion is honoured for paging* (`:31-36`): `matchMedia('(prefers-reduced-motion: reduce)')` → `behavior: 'auto'`, and the optional call keeps the jsdom lane on the default because jsdom implements no `matchMedia` despite lib.dom's non-optional typing.
  - *Paging keeps the last visible thumbnail as context* (`:122-125`): one viewport minus a 64px card, floored at 200px so narrow rails still page a useful distance.
  - *State updates are memoized* (`:67`): `setEdges(prev => prev.left === left && prev.right === right ? prev : {...})` — no re-render when the edges did not change.
- **Edge cases & failure handling:** `ResizeObserver` absent → the rail still works (guarded by `typeof ResizeObserver !== 'undefined'`, `:86`); null rail element → `/* v8 ignore next -- defensive */` early returns, because the div renders unconditionally.
- **Surprising:** the component is fully generic over the item type and the render function, and its `labels` prop carries only three strings — every user-visible string comes from the owner's locale namespace.

#### `packages/client/ui-attachment/src/MessageImage.tsx`
- **Purpose:** the compact history image renderer with retryable loading, click-to-open lightbox, and three layout variants.
- **Key abstractions:** `MessageImageSpec` (a durable `attachment` **or** a local `preview`); `ImageLoader` = `((a) => Promise<string>) & { peek?: (a) => string | undefined }`; `MessageImage`; `ImageGallery`; `singleFit(dimensions)`.
- **Data flow:** a `MessageImageSpec` → the `load` callback (a *session-authorized* loader) → a `blob:`/`data:` URL → `<img src>` → click → `ImageLightbox` (from `ui-primitives`).
- **Non-obvious design decisions:**
  - *`peek` gives a synchronous first frame* (`:75-77`): the component initialises `loaded` from `load.peek?.(attachment)` so a cached URL renders on frame one while the refresh runs behind it. The test "renders a cached URL on the first frame while refreshing it" pins it.
  - *One `attempt` counter re-arms the single load effect* (`:85-88`): "so every attempt — first load or retry — runs under the same liveness guard and the same reset." Retry is therefore not a second code path.
  - *The liveness guard* (`:96-104`): `let live = true` and a `cleanup` that sets it false — a load that settles after unmount must not set state (pinned by "ignores a load settling after unmount").
  - *Sizing is a clamp, not a crop* (`:33-46`): long edge 240px, aspect clamped to [0.25, 4], never upscaled past the natural size; the crop anchor is `center top` for very tall images and `left center` for very wide ones — "where the informative content usually starts."
  - *A preview's dimensions may be unknown* (`:49-56`, `:88-94`): an unprobed lone preview renders as a 240×240 square crop, and "the durable replacement restores the exact fit."
  - *The preview arm has no failure surface* (`:67-68`): a local object URL renders directly — no loader round-trip, so no retry control is possible or needed.
  - *The key mixes identity and index* (`:168`): `` `${attachmentId ?? preview.url}:${index}` `` — the index is there because the same attachment may legitimately appear twice in one gallery.
- **Edge cases & failure handling:** a failed load → a retry control that keeps the variant's box (`data-variant` is preserved, `:117-120`); a click while `src === null` does nothing (`:129`); an unnamed attachment falls back to `labels.image`.
- **Surprising:** the same component serves Chat history, trajectory rows and tool results, differing only by the `variant` prop and the layout hints — one gallery, three densities.

#### `packages/client/ui-attachment/src/client/drop-events.ts`
- **Purpose:** the document-level drag-and-drop listeners one mounted attachment view installs.
- **Key abstractions:** `installDocumentDropEvents(canAcceptDrop, onAddFiles, dragDepth, setDragActive)`; `droppedDirectories(dataTransfer, files)`.
- **Data flow:** `dragenter/dragover/dragleave/drop` on `document` + `dragend` on `window` → a `dragDepth` counter → `setDragActive` → the overlay; on drop, `onAddFiles(files, directorySet)`.
- **Non-obvious design decisions:**
  - *Only file drags are intercepted* (`:41-45`): `dataTransfer.types.includes('Files')` — a text drag stays native, so the page's own text selection and URL drops are untouched.
  - *A nested-drag counter, not a boolean* (`:47-56`, `:66-71`): `dragDepth` counts enters/leaves so a child element's `dragleave` does not flicker the overlay off; the counter is clamped at 0.
  - *The "left the viewport" heuristic* (`:70-76`): a `dragleave` whose target is `documentElement`/`body` and whose coordinates are outside the viewport resets the counter to 0 — this is the classic fix for a stuck overlay when a drag leaves the window.
  - *Directory drops are only detectable through the entry API* (`:8-21`): the `File` a directory drop yields is indistinguishable from an empty file, so `webkitGetAsEntry()?.isDirectory` is the only source of that fact; browsers without it report no directories. The `items`/`files` indexes are walked in lockstep.
  - *`dropEffect` is set to `'copy'` or `'none'`* (`:63-67`) — the overlay's disabled state is expressed to the OS drag cursor.
- **Edge cases & failure handling:** `dragend` on the window resets everything (an aborted drag); the cleanup removes exactly the five listeners it installed.
- **Surprising:** the overlay itself is `pointer-events: none`, so the *owner's* listeners keep an accurate enter/leave count — the decoration never intercepts the drag.

#### `packages/client/ui-attachment/src/client/index.ts`
- **Purpose:** the browser-half plugin that registers the composer attachment entry and the four image galleries.
- **Key abstractions:** `inject = ['slots']`; `apply(ctx)`.
- **Data flow:** `ctx.slots.registerFactory({ name: 'conversation.images.content', scope: 'root', locale: 'conversation' }, MessageImagesContent)` plus four `ctx.slots.inject(...)` calls that register `MessageImages` at **priority 100** into `conversation.chat.message.images`, `conversation.chat.user.images`, `conversation.trajectory.images`, `tool.call.images`, and `ComposerAttachments` into `conversation.input.attachments`.
- **Non-obvious design decisions:**
  - *`ctx.slots.inject(name, () => ctx.slots.register(...))`* (`:22-25`): the registration waits for the actual slot *declaration* (not for the other plugin's activation) and is removed when that declaration collapses. This is the sanctioned way to fill another package's slot.
  - *One shared Factory + four domain adapters* (README `:56-60`): the Factory owns gallery presentation and default copy; "it owns no Session state and no read authorization"; each domain owns its Slot declaration.
  - *Priority 100 everywhere* (`:26-36`): a lower-priority entry replaces only its own position; removing it restores the official entry. The `image-slot-isolation` test proves exactly this for all four slots.
  - *The package entry exports no components* (README `:60`): only `apply`/`inject`.
- **Edge cases & failure handling:** every registration leaves with the plugin fiber (pinned by `plugin.client.spec.ts`).
- **Surprising:** the four image positions are four *separate* slots with one shared Factory — so a domain can override one without touching the others.

#### `packages/client/ui-attachment/src/client/ComposerAttachments.tsx`
- **Purpose:** the composer-side assembly: the draft rail, the drop overlay, and the local preview lightbox.
- **Key abstractions:** `ComposerAttachments({ attachments, canAcceptDrop, onAddFiles, onRemoveAttachment, uploads, onRetryFile, dropLimits, t })`; `ComposerRailItem`.
- **Data flow:** the owner's `attachments` array → `railItems` (memo) → `AttachmentRail` → per-item `FileCard` (for `kind: 'file'`) or a thumbnail button (for `kind: 'image'`); `uploads[attachment.id]` supplies the upload state and progress.
- **Non-obvious design decisions:**
  - *A draft with no upload state is treated as uploading* (`:47-49`): `upload === undefined || upload.status === 'uploading'` → `'uploading'`. The `FileCard` therefore never shows a "ready" state it has not been told about.
  - *Progress is only shown when the total is known* (`:53-55`): the spread is conditional on `upload.total !== undefined && upload.total > 0`, and `FileCard` renders an indeterminate bar when `progress` is `undefined`.
  - *The preview closes when its attachment disappears* (`:25-27`): an effect drops a preview whose id is no longer in `attachments`.
  - *The rail renders only while items exist* (`:36`) and the overlay only while a drag is active (`:32`).
- **Edge cases & failure handling:** the `uploads` map may lack an entry entirely; the failed state renders a distinct retry button *beside* (not inside) the remove button — the test asserts `retry.contains(remove) === false`.
- **Surprising:** images and files share ONE rail in pick order (the test pins `['first.png','middle.pdf','last.png']` in one group) — no separate "images" and "files" rows.

#### `packages/client/ui-attachment/src/client/MessageImages.tsx` + `packages/client/ui-attachment/src/client/labels.ts`
- **Purpose:** the official image gallery Factory and the label resolvers.
- **Key abstractions:** `MessageImagesContent` (the Factory component, typed `FactoryComponentPropsOf<'conversation.images.content'>`); `MessageImages` (the per-domain adapter that calls `renderFactorySlot`); `lightboxLabels`, `messageImageLabels`, `dropOverlayLabels`, `fileCardLabels`, `attachmentRailLabels` (all take `TranslateNS<'conversation'>`).
- **Data flow:** owner props (`images`, `loadImage`, `align`, `compact`, `thumbnail`, optional `labels`) → `renderFactorySlot('conversation.images.content', ...)` → the Factory resolves `labels ?? messageImageLabels(t)` → `ImageGallery`.
- **Non-obvious design decisions:**
  - *A caller may supply complete labels to override the defaults* (`:24`): `const resolved = useMemo(() => labels ?? messageImageLabels(t), [labels, t])`. The test proves the override is applied **without remounting the image** (same DOM node before and after) — the Factory is re-rendered, not re-keyed.
  - *Optional flags are spread conditionally* (`:37-41`): `...compact === undefined ? {} : { compact }` — an absent flag stays absent rather than becoming `false`, so the slot owner can distinguish "not requested" from "requested false".
  - *Every label is a function of the locale seat* (`:1` in `labels.ts`): the components own no fallback copy at all; the localized text lives in a dictionary, and `openNamed` is a *function* (`label => t('image.openOriginalLabel', { label })`) so interpolation stays in the dictionary.
- **Edge cases & failure handling:** n/a beyond the above.
- **Surprising:** `labels.ts` imports the label *types* from the components and the components import the *values* from `labels.ts` — a type-only cycle, deliberate to keep the shape and the copy in one place.

#### `packages/client/ui-attachment/src/DropOverlay.tsx` + `packages/client/ui-attachment/src/FileCard.tsx` + CSS modules
- **Purpose:** the presentational pieces — the full-viewport drop invitation (rendered through a body portal), the pending-file card, and their styles.
- **Key abstractions:** `DropOverlay({ disabled, labels })`; `FileCard({ name, bytes, state, progress, labels, onRemove, onRetry })`; `FileCardState = 'uploading' | 'ready' | 'error'`.
- **Data flow:** labels in, DOM out; `DropOverlay` portals to `document.body` "for the same transformed-ancestor reason as the lightbox."
- **Non-obvious design decisions:**
  - *The overlay is decoration only* (`:20-24`): `pointer-events: none` keeps drag targeting on the page below, so the owner's document-level listeners keep an accurate enter/leave count and own accept/reject.
  - *The overlay has two illustrations* (`:33-38`): the enabled one and a greyed "blocked" one; the disabled state also drops the limits line.
  - *`role="status"`* on the overlay (`:32`) — an ARIA live region, so the drop invitation is announced without stealing focus.
  - *`FileCard`'s metadata line is state-dependent* (`:21-25`): uploading → `labels.uploading`; error → `labels.failed`; ready → `EXTENSION + byte size` joined with a space, with empty parts filtered out.
  - *The extension is uppercased and truncated to 8 chars* (`:20`): `fileExtension(name).toUpperCase().slice(0, 8)`.
  - *A failed card turns its body into the retry button* (`:33-47`) while the remove button stays separate; `.removeFailed` is always visible (opacity 1) because it is the escape hatch from a failed upload.
  - *The indeterminate progress bar is a CSS animation and is disabled once a real width is set* (FileCard.module.css `.progressBar[style] { animation: none; }`) — a style attribute's presence is the switch from indeterminate to determinate.
  - *Touch surfaces keep the remove button visible* (`@media (pointer: coarse) { .remove { opacity: 1 } }`) — "Touch surfaces have no hover to reveal the control."
- **Edge cases & failure handling:** `progress` is clamped to [0, 1] before the width is computed (`:60`).
- **Surprising:** the CSS uses `corner-shape: round` and `--dsw-*` semantic tokens only — no literal colours in the components; the fallbacks in the CSS (`#d54941`, `#4d6bfe`) are the only literals and they live in the token layer.

#### `packages/client/ui-deepseek-model-label-1017/src/client/DeepSeekModelLabel.tsx` + `packages/client/ui-deepseek-model-label-1017/src/client/index.ts` + `packages/client/ui-deepseek-model-label-1017/src/client/locales.ts`
- **Purpose:** a deliberately *tiny* plugin that shows a `1017` badge beside `DeepSeek-V4.1-Flash` in the composer model selector.
- **Key abstractions:** `DeepSeekModelLabel(props: PropsRuntime<'conversation.input.model.label'> & PropsLocale<'deepseek-model-label-1017'>)`; `en`/`zh` dictionaries typed by `LabelKey`.
- **Data flow:** owner props (`provider`, `model`, `placement`) → a pure string decision → either the untouched `model.name` or `<span>{model.name} <Tag tone="info">{t('badge.label')}</Tag></span>`.
- **Non-obvious design decisions:**
  - *The badge requires a three-way match* (`:15-17`): provider is `deepseek-official` **or** `deepseek-account`, **and** `model.id === 'deepseek-flash'`, **and** `model.name === 'DeepSeek-V4.1-Flash'`. Any deviation returns the plain catalog name.
  - *The catalog entry is never rewritten* (`:15`, and the test asserting `input.model` still equals `{ id, name }`): the badge is a *presentation* layer over an unchanged catalog name and request id.
  - *The plugin occupies a `single` slot* (README "Known Limitations"): another model-label plugin at the same priority conflicts — "the two presentations do not compose automatically."
  - *The locale namespace is declared through module augmentation* (`declare module '...ui-slots' { interface LocaleNamespaceMap { 'deepseek-model-label-1017': LabelKey } }`) — a typed dictionary, not a string table.
  - *The badge text is itself localized* even though it is the literal `1017` — so a future "1017" is one dictionary change, not a component change.
- **Edge cases & failure handling:** the test pins that a dated name (`DeepSeek-V4.1-Flash-1017`) and a later release name (`-1024`) are **not** badged, and that a custom name (`My Flash`) is not badged.
- **Surprising:** the whole package is 1095 bytes of component and exists to be *deleted later* — the README says: "The `1017` marker is fixed client presentation, not a server capability assertion. Remove this package and its bundle row when structured release labels replace it." A whole plugin package is the unit of reversibility.

#### `packages/client/ui-deliverables/src/turn-deliverables.ts` (browser) — the produced-file vocabulary
- **Purpose:** the Conversation Node Definition that folds a Turn's successful mutations, recorded changes, and explicit deliveries into one immutable `DeliverablesTurnData` value, plus the readers the UI consults.
- **Key abstractions:** `deliverablesDefinition` (a `ConversationNodeDefinition<DeliverablesState>`); `producedForClosing(data, seq)`; `selectProducedFiles(owner)`; `changesForClosing(owner)`; `presentedForClosing(owner)`; `producedFileMentions(paths, openFile, label, operations)`; `ProducedPath` / `PresentedPath` / `DeliverablesTurnData`.
- **Data flow:** durable Session events (`turn/start`, `tool/call`, `tool/result`, `deliverables/presented`, `workspace/changes`) → `match()` → `start()`/`update()` folding into State → `buildLocationData()` publishes an immutable per-Turn value → the chat view reads it through `owner.turn.data.get('deliverables')`.
- **Non-obvious design decisions:**
  - *Produced paths come from TOOL CALLS, never from the prose* (`:2-6`): "never from presentation data or the closing prose." The file list is derived from the model's own mutation calls plus their recorded `meta.path`.
  - *Only a small, explicit set of mutation calls counts* (`:60-77`): `write`, `edit`, and the *mutating* `str_replace_editor` commands (`create`, `str_replace`, `insert`). The `view` command is not a mutation. Every argument is validated field by field (`validEditArgs` at `:81-88`, `editorMutationPath` at `:92-110`) — a successful *result* with a malformed *call* contributes nothing (pinned by 19 table-driven cases in `deliverables.client.spec.tsx:331-398`).
  - *`meta.path` wins over the argument path, and only when it is absolute* (`:114-120`): "Root results without that field retain the legacy argument fallback; malformed relative targets contribute no guessed path." This is how a moved file still opens at its recorded target.
  - *A file written and then edited in the same Turn is ONE entry* (`:152-154`): paths keep first-seen order and appear once, deduplicated by path.
  - *Turn membership is owned elsewhere* (`:146-149`): "The Conversation Location index owns turn membership before this function runs, so paths cannot spill across turns and this derivation does not infer boundaries from neighboring presentation Nodes."
  - *The Definition publishes no view Node* (`:200`): "Turn-local successful mutation accumulator; it publishes no view Node." It contributes data only.
  - *`buildLocationData` preserves identity when nothing changed* (`:249-256`): the previous location value is returned unchanged when `produced`, `presented`, and `changes` are all reference-equal — so an unrelated append does not invalidate the tail.
  - *The mention resolver refuses to guess* (`:279-303`): a token resolves only when exactly one target matches (exact path, exact recorded argument alias, or a unique basename). "Every matching fact must identify the same file; ambiguous arguments and basenames stay inert. No suffix or current-directory guess is used." A legacy bare path cannot override an ambiguous canonical basename.
  - *`presentedForClosing` keeps the LAST declaration per path* (`:265-271`): "Duplicate declarations use the last description before the closing reply."
- **Edge cases & failure handling:** a failed result contributes nothing (`:236`); an orphan result with no matching call contributes nothing; a `surfaceOp: 'replace'` event is excluded (`isAppendSurfaceEvent`, `:229`); malformed `deliverables/presented` data returns `null` from `match` (`:191-193`); `start()` throws if it is not given a `turn/start` match (`:203-204`).
- **Surprising:** this is the whole "what did the agent actually change?" answer, and it is built from the *tool call log*, not from a diff of the filesystem — which is why it can name a file the model never mentioned.

#### `packages/client/ui-deliverables/src/changes.ts` and `packages/client/ui-deliverables/src/presented.ts` — the wire contracts
- **Purpose:** validators and route builders for every Host-served change summary, comparison, and delivery declaration.
- **Key abstractions:** `isChangedFile`, `isChangesSummary`, `isChangesDiff`, `isChangesEvent`, `isHunk`; `changesSummaryUrl`, `changesDiffUrl`, `changedFileUrl`; `changesReviewAddress`, `parseChangesReviewAddress`; `isPresentedHost`, `isPresentedFile`, `isPresentedData`, `presentedFileUrl`, `basename`; the route constants `CHANGED_FILES_PATH` / `CHANGES_DIFF_PATH` / `CHANGES_OPEN_PATH` / `PRESENT_OPEN_PATH` / `PRESENT_HOST_PATH` and their document-relative `*_ROUTE` twins.
- **Data flow:** Host JSON → a validator → a typed value the browser may use; a (sessionId, seq, index) triple → a document-relative URL.
- **Non-obvious design decisions:**
  - *Every route has a document-relative twin* (`:22-34`): `PATH.slice(1)`, because the app may be served under a base path. The same pattern appears in `hmr/src/events.ts` and `presented.ts`.
  - *The summary is a `Pick` of the Host's type* (`:36`): "The summary fields the route serves; the Host keeps the working directory and snapshot ids to itself." The browser never learns the working directory from the summary route.
  - *Validators are strict about types, not about shape* (`:57-70`): `Number.isSafeInteger(added) && Number.isSafeInteger(deleted)`; `binary`/`oversized` may be `undefined` or `true` but never `false` — so a `false` is a malformed record, not a false flag.
  - *A hunk line must start with `+`, `-`, or a space* (`:80`): `/^[+ -]/` — a diff line without a sign is malformed.
  - *A comparison of kind `binary` or `oversized` is valid with no hunks* (`:84-85`): the refusal itself is the payload.
  - *The review address round-trips* (`:137-165`): `dsh-resource://changes-review/session/<sessionId>/<seq>/<turn>` — the Session and the event sequence identify the content, the turn rides along for the tab title. `parseChangesReviewAddress` rejects a turn of `0` (`/^[1-9]\d*$/`) and a malformed percent sequence, and returns `undefined` for anything it did not mint — the review tab then throws rather than rendering a wrong file.
  - *`basename` handles both separators* (`:97-101`): `Math.max(lastIndexOf('/'), lastIndexOf('\\'))` — Windows paths are first-class.
- **Edge cases & failure handling:** every validator returns `false` for `null`, arrays, and plain objects; the address parser is total (never throws except a caught `decodeURIComponent` failure).
- **Surprising:** the *coordinates* for a file action are `(sessionId, seq, index)` — a durable event address, not a path. The file path is re-read from the event at action time, so a moved file resolves to its current location and a deleted one 404s.

#### `packages/client/ui-deliverables/src/present-open.ts` (Node half) — the authenticated native-open routes
- **Purpose:** the Host routes that serve the change summary, the per-file comparison, and the native open of a declared or changed file, all behind the Connection's authentication fence.
- **Key abstractions:** `registerPresentOpen(ctx)`; `handlePresentOpen`, `handleChangesSummary`, `handleChangesDiff`, `handleChangesOpen`; `openVerified`; `readTarget`; `failureStatus`; `coordinate(value)`.
- **Data flow:** a browser request → `ctx.connection.fetch.register({ path, methods, requestBody: 'buffered' })` → the handler → `ctx.sessionQuery.readEvent` / `ctx.workspaceChanges.summary|diff` / `ctx.workspaceFiles.stat` → `ctx.sessionController.openWorkspacePath`.
- **Non-obvious design decisions:**
  - *The file is authorized by the SESSION, not by the request* (`:76-80`, `:104-128`): the route reads the durable event addressed by `(sessionId, seq)`, validates the declaration inside it, and only then stats the file through the *viewed* Session's filesystem. A request cannot name a path.
  - *A file is verified through the Session filesystem; a directory is verified by the Host filesystem mapping alone* (`:82-92`): `fs.processPathFromHostPath(path)` must map, and `fs.processPath(await fs.resolve(mapped))` must round-trip to the same path — otherwise 422. "Providers without this mapping return 422, after which the review tab hides its native open; a same-named Host file is insufficient."
  - *A final symlink is refused* (`:161-171` in `present-open.host.spec.ts`): the round-trip through `resolve` resolves the link, so the resolved path no longer equals the declared path → 404.
  - *The Host's own paths never leak* (`:167-186` and the host spec's assertion that the 500 body does not contain `/private/host/path`): a launcher failure answers a generic message.
  - *A missing Host desktop is 409, an unmappable path is 422, a missing file is 404, an internal failure is 500* (`:62-70`): `failureStatus` maps a known set of session/workspace-file error codes to 404 and everything else to 500.
  - *The desktop is checked BEFORE the event is read* (`:76-80`): "Read the addressed event once the Host desktop is known to be available" — a 409 short-circuits the work.
  - *Pending requests are tracked and awaited on disposal* (`:30-35`): an `AbortController` lifetime plus `Promise.allSettled(pending)`; each request's signal is `AbortSignal.any([request.signal, lifetime.signal])`.
  - *Every answer is `cache-control: no-store`* (`:24`, `:139`, `:160`, `:101`).
  - *The `GET` method on an open route lists the associated applications* (`:94-97`) — the same route, two verbs.
- **Edge cases & failure handling:** invalid coordinates → 400 *before* any read (the host spec asserts `readEvent` was never called); an unrelated Session → 404; a forgotten summary → 404; a missing file → 404; a corrupt session → 500, and a later retry succeeds.
- **Surprising:** *no file content is copied or attached* — "No file-content copy or attachment is created" (README). The route opens the file in place.

#### `packages/client/ui-deliverables/src/client/host-read-store.ts` — the fetch-once cache
- **Purpose:** one browser plugin's cached reads of Host-served records, keyed by their authenticated URL.
- **Key abstractions:** `HostReadPolicy<T>` (`loading`, `failed`, `retryable(state)`, `decode(response)`); `HostReadStore<T>` with `state`, `loadUrl`, `reset`, `dispose`.
- **Data flow:** a URL → a `loading` state → a `fetch` → `decode(response)` → a published state keyed by the URL; `reset()` on a connection replacement.
- **Non-obvious design decisions:**
  - *The URL is the cache key* (`:34-35`): "Record URLs key the state across Sessions and turns."
  - *The policy decides what a later request does* (`:14-32`): a served record or a `missing` answer is kept; only an `error` is retryable. Two subclasses make the difference explicit: `ChangesSummaryStore` uses `failed: 'missing', retryable: () => false`; `ChangesDiffStore` uses `failed: 'error', retryable: state => state === 'error'`.
  - *A connection replacement ABORTS in-flight reads* (`:39-40`, `:69-73`): a `generation` AbortController is aborted on `reset()`, and `read` checks `signal.aborted` before publishing — so a read started against the old Host cannot publish into the new one. Pinned by "lets no read started before a reset publish afterwards".
  - *Disposal waits for every pending read* (`:75-78`) and then no state can be published.
  - *A transport failure is not an exception* (`:88-93`): it publishes the policy's `failed` state.
- **Edge cases & failure handling:** a 404 → `missing`; a non-OK → `error`; malformed JSON that fails the validator → `error`/`missing` per policy; a fetch rejection → `failed`.
- **Surprising:** the store never retries on its own — a retry is a *user gesture* (a Retry button), which is why `retryable` is a policy function and not a timer.

#### `packages/client/ui-deliverables/src/client/changes-summary.ts` and `packages/client/ui-deliverables/src/client/changes-diff.ts`
- **Purpose:** the two concrete read caches.
- **Key abstractions:** `ChangesSummaryState = ChangesSummary | 'missing' | 'loading'`; `ChangesDiffState = ChangesDiff | 'missing' | 'error' | 'loading'`; `load(sessionId, seq)` / `load(sessionId, seq, index)`.
- **Non-obvious design decisions:**
  - *A summary that is gone is permanent* (`:16`): `retryable: () => false` — "a summary or a missing answer is kept until the connection is replaced." The Host no longer serves it, so re-reading is pointless.
  - *A comparison that failed to read is retryable* (`:18`): `retryable: state => state === 'error'` — a transport failure may succeed later.
  - *A 404 is `missing`, not `error`* (`:20-21`): the distinction drives whether a Retry button appears.
- **Edge cases & failure handling:** a response that fails `isChangesDiff` is published as `error` (retryable) rather than crashing the reader.
- **Surprising:** the *hover preview* and the *review tab* share these two stores, so hovering a row warms the cache the tab then reads — one read, two surfaces.

#### `packages/client/ui-deliverables/src/client/present-open.ts` (browser) — the shared native-open controller
- **Purpose:** one controller for the native open/reveal gesture, shared by delivery cards, the review tab, and the prose mentions.
- **Key abstractions:** `PresentedOpenController` with `state`, `host`, `open`, `openChanged`, `loadHost`, `resetHost`, `dispose`; `PresentedOpenPhase = 'opening' | 'opened' | 'revealing' | 'revealed' | 'error' | 'revealError' | 'nativeUnavailable'`; `PRESENTED_SUCCESS_HOLD_MS = 5000`, `PRESENTED_SUCCESS_FADE_MS = 200`.
- **Data flow:** a gesture → a phase published in a URL-keyed store → a POST to the action route → a terminal phase (or `nativeUnavailable` on 422) → an expiry timer that clears the state after hold + fade.
- **Non-obvious design decisions:**
  - *The action URL is the state key* (`:20-21`): "File action URLs key the state across Sessions, turns, and both clickable surfaces." Two surfaces showing the same file share one pending flag.
  - *A second gesture while one is pending is a no-op* (`:62-63`): `phase === 'opening' || phase === 'revealing'` → return null without a request.
  - *Success feedback expires; failure feedback does not* (`:142-149`): the success timer deletes the state entry after hold + fade; a failure stays until another attempt.
  - *422 is its own phase* (`:136`): `nativeUnavailable` — "This file has no available Host path. Preview it in the sidebar." The review tab then *hides* the native open rather than showing a button that always fails.
  - *Desktop metadata reads are coalesced* (`:79-91`): a second `loadHost()` while one is in flight returns the same promise.
  - *`resetHost` invalidates without eagerly fetching* (`:94-101`): it aborts the in-flight read, clears the state, and re-fetches only if a read was actually pending — "invalidates cached desktop metadata without eagerly fetching an unused Host."
  - *The expiry is owned before subscribers are notified* (`:142-149` + the test "owns the expiry before notifying subscribers that can dispose the controller"): the timer is registered before the state update, so a subscriber that disposes the controller cannot leak a timer.
  - *Disposal prevents late publication* (`:141`): the state is not written after the lifetime signal aborts.
- **Edge cases & failure handling:** a transport failure publishes the same retryable phase as an HTTP failure; an aborted request publishes nothing; `dispose()` awaits every pending request.
- **Surprising:** the controller is created **once per plugin** (`client/index.ts:38`) and shared by every card, tab and mention — so the pending state is global, not per-component.

#### `packages/client/ui-deliverables/src/client/turn-deliverables.ts` (browser side, the `producedFileMentions` resolver) and `client/index.ts`
- **Purpose:** the plugin's browser-half registration and the prose mention service.
- **Key abstractions:** `deliverablesDefinition`; `producedFileMentions`; `selectProducedFiles`; `presentedForClosing`; `changesForClosing`.
- **Data flow:** the Conversation engine publishes `DeliverablesTurnData` → the chat view asks the `chatFileMentions` service for a resolver for the closing message → the Markdown renderer calls `resolve(token)` → a `{ open, label, title }` or `undefined`.
- **Non-obvious design decisions:**
  - *All policy lives in one file* (`:1-9`): "the supported mutation calls, mention matching, row cap, and copy — so composing this plugin out of cordis.yml removes every surface; the owning view renders an empty list and inert prose at zero cost." The plugin is *composable out* as a unit.
  - *The service's ABSENCE is the off state* (`:105-107`): "The prose side of the same vocabulary: the chat view reaches this face via ctx.get, so its absence — this plugin composed out — is the off state." No boolean flag, no empty-array special case.
  - *A resolved mention keeps its code chip and takes the markdown sheet's link language* (README) — the resolver returns data, not markup.
  - *`ctx.on('connection/reset', ...)` clears every cache* (`:41-45`): the opener, the summary store, and the diff store all forget, because "The replaced connection may reach a Host that no longer serves them."
  - *The review tab's body is registered under the keyed `sidebar.right.pane.tab` seat with an EXCLUSIVE store* (`:81-90`): `store: createReviewStore()` — the framework mints one instance per session, so two review tabs keep separate choices.
  - *The review tab type is registered at the `builtin` band* (`:73`): `priority: 'builtin'`.
  - *The turn-tail entry declares a child slot* (`:58-62`): `children: { 'deliverables.file.actions': { kind: 'list', scope: 'session' } }` — the native-open control is contributed by `ui-open-in-app` through a slot, not imported.
- **Edge cases & failure handling:** disposal awaits every store's disposal (`:39`); a `connection/reset` after disposal does not notify subscribers (pinned by the plugin-registration test).
- **Surprising:** the tail entry's `id` is the package name (`'@deepseek-ai/dsh-client-ui-deliverables'`) — the *id* is the removal handle, so one plugin's contribution to a shared list is one addressable row.

#### `packages/client/ui-deliverables/src/client/ChangedFiles.tsx` — the changed-files card
- **Purpose:** the card a finished turn ends with: the files the turn changed, with the Host's line counts, each opening the turn's review.
- **Key abstractions:** `ChangedFiles({ changes, cwd, openReview, t, sessionId, useChangesDiff, loadChangesDiff })`; `ChangedFilePreview`; `COLLAPSED_ROWS = 4`.
- **Data flow:** the summary (read from the Host once) → the header (count + totals) → a folded list of rows → a `HoverCard` preview that lazily loads the comparison.
- **Non-obvious design decisions:**
  - *A single file uses only the header* (`:44-46`, `:66-78`): no list, no fold control — the header shows "Edited {name}" plus the counts, and the file's full path rides a hidden `aria-describedby` span.
  - *The header's totals come from the Host, not from the capped list* (`:52-56` + the test "sums the header from the Host totals, not from the capped list"): with a 4-row fold, the header still says "Edited 11 files +1,232 −326".
  - *The comparison is loaded ONLY when the preview opens* (`:129-136`): `ChangedFilePreview` is mounted only while the hover card is open, so passing over a row does not read a comparison.
  - *The hover dwell is 500ms* (`:65`, `:87`): `openDelayMs={500}`.
  - *The preview is narrower than the card by 48px and inset 24px per side* (README) — the card's own width anchors it (`widthAnchorRef={cardRef}`), so the preview never overflows.
  - *The full path is an accessible description, not visible text* (`:97`, `:88`): `aria-describedby` on a hidden span; the visible row shows only the display path.
  - *Four rows before the fold, and once expanded the list collapses again from the bottom* (`:48`, `:80-83`).
  - *Rows appear in the recorded display order* (README) — repository files above the working directory sort first; the card does not re-sort.
  - *File-status notes and hunk headers are hidden in the preview* (`.preview [data-diff-note='metadata'], .preview [data-diff-hunk-header] { display: none; }`), but a comparison with no hunks keeps its status text.
- **Edge cases & failure handling:** a binary file shows "binary" and a file the Host did not capture shows "too large", with no counts; a failed comparison read offers a Retry that re-reads it.
- **Surprising:** the *card* never shows a native-open control — "Native-open gestures belong to the review tab; the card shows counts only" (pinned by a test).

#### `packages/client/ui-deliverables/src/client/Deliverables.tsx` — the turn-tail assembly
- **Purpose:** the component registered into `conversation.chat.turnTail`: the changed-files card plus the delivery cards.
- **Key abstractions:** `DeliverablesTail` (the slot entry); `Deliverables` (the body); `selectDeliverables(owner)`; `DeliverablesInjected`; `COLLAPSED_PRESENTED_COUNT = 4`.
- **Data flow:** the closing Turn's owner props → `selectDeliverables` → the summary read (once) → the card; the delivered files → the delivery cards; the Host desktop metadata → the native controls.
- **Non-obvious design decisions:**
  - *The whole surface is one preference-gated decision* (`:88-90`): `showCodeDiff` comes from `ctx.configForms.developerTools.enabled`; turning it off removes the card immediately while "explicit delivery cards, inline file links, and recorded workspace changes remain available."
  - *The summary is read once per announcement* (`:92-96`): the effect reads only when the store has no state for that URL; the store keeps it until the connection is replaced.
  - *A summary the Host no longer serves leaves NO card* (`:97-100`): `summary.files.length > 0` is required, and a `missing` summary renders nothing at all — not an error card.
  - *The delivery cards and the changed-files card share ONE native-open controller* (`:104-107`): the same `states` map backs both, keyed by the action URL.
  - *The action slot is rendered per file* (`:117-127`): `renderSlot('deliverables.file.actions', { actionUrl, available, pending, onAction })` — the slot owner decides what the control looks like; this package only supplies the coordinates and the flags.
  - *A single delivery spans the whole row; several form a two-column grid* (`:112`, `.presented[data-single='true']`).
  - *The delivery list folds after four* (`:21`, `:101-103`), and the changed-files list folds after four — two different caps, both four.
- **Edge cases & failure handling:** a Host metadata read failure renders a Retry; a Host without a desktop renders an explanatory line instead of the native control; a delivery with no extension falls back to the localized "File".
- **Surprising:** the *only* thing that decides whether the changed-files card appears is the summary the Host serves — the app never diffs the filesystem itself.

#### `packages/client/ui-deliverables/src/client/FileDiff.tsx` — the shared comparison renderer
- **Purpose:** one renderer for a file comparison, used identically by the hover preview and the review tab.
- **Key abstractions:** `FileDiff({ state, split, wrap, retry, t })`; `hunkRows(hunk)`; `splitRows(hunk)`; `renderedHunks(hunks)`; `MAX_RENDERED_LINES = 5000`; `DiffRow` / `SplitRow`; `hunkHighlights`.
- **Data flow:** a `ChangesDiffState` → a loading / missing / error / binary / oversized line, or a text comparison → hunks → rows → highlighted spans → two synchronized columns or one unified list.
- **Non-obvious design decisions:**
  - *Highlighting is HUNK-LOCAL* (`:35-52`): "each rendered old and new hunk side is tokenized independently because omitted source lines are unavailable." The old and new sides are tokenized **separately** — the two sides of a changed line are different code and get different colours.
  - *Shiki's dropped terminal empty token row is compensated* (`:44-46`): `highlighted[index] ?? []` — "Shiki omits one terminal empty token row; retain an aligned empty run for that source line."
  - *A comparison with only additions or only deletions renders in ONE column* (`:154-157`): `oneSided = hasAdditions !== hasDeletions` → `split && !oneSided`. The *selected* view is not changed — the user's split toggle still reads as split.
  - *A hard render cap of 5000 lines* (`:14`, `:116-125`): the last hunk is shortened and the tab says so.
  - *The four states are all one line* (`:147-153`): loading (a `role="status"` live region), missing, error (with a Retry), binary, oversized.
  - *The split view's two columns scroll together on BOTH axes* (`:180-193`): each side's scroll offsets are mirrored, and the browser-clamped offset is recorded so the peer's own scroll event cannot pull the source back.
  - *The note is a single fact* (`:127-133`): created / deleted / unchanged — nothing else.
  - *A coarse (timed-out) comparison says so* (`:229`): `diff.coarse` → "Line comparison timed out; shown as a whole-file replacement."
- **Edge cases & failure handling:** an unknown language keeps the text plain (`data-diff-code` is absent); a comparison with zero hunks renders the "unchanged" note.
- **Surprising:** the *same* `FileDiff` component draws the tiny hover preview and the full-width review tab, at the cost of one `data-review-view` attribute — the layout differences live in CSS.

#### `packages/client/ui-deliverables/src/client/ReviewTab.tsx` — the review tab body
- **Purpose:** the right-Sidebar tab that reviews one turn's changed files, one comparison at a time.
- **Key abstractions:** `ReviewTab`; `ReviewInjected`; `navigatedIndex(params)`; `Counts`.
- **Data flow:** the tab's `contentId` (a `dsh-resource://changes-review/...` address) → `parseChangesReviewAddress` → the summary read → the file selector → the comparison read → `FileDiff`.
- **Non-obvious design decisions:**
  - *The address IS the content* (`:75-77`): the Session and the event sequence identify the content; the turn names the tab. A wrong address **throws** rather than rendering an empty tab.
  - *A navigation applies its file index exactly once* (`:84-88`): the store keeps the navigation `revision`; the effect only fires when the revision differs.
  - *A navigated index the summary does not list falls back to the first file* (`:103`): `files[state.index] !== undefined ? state.index : 0`.
  - *The tab's state ends with the tab record* (`:89-94`): the tab's `signal` abort event calls `actions.forget(tab.id)`, so a closed tab's bucket is dropped.
  - *The view and wrap choices are per tab* (`:10-12`, `:33-36`): one bucket per `tab.id` in the store.
  - *The native open hides itself when the Host cannot map the path* (`:106`): `phase !== 'nativeUnavailable'`.
  - *A missing summary still names the turn* (`:110-113`): the title is shown even with no file selected.
  - *The file title uses the shared `PathLabel`* (`:132`): complete and left-aligned when it fits, otherwise clipped at the left with a fade that preserves the trailing characters and the extension.
- **Edge cases & failure handling:** an unparseable address throws `ui-deliverables: not a review address "…"` (pinned by the test "refuses an address it did not mint"); a missing summary renders one line, not an error; a failed comparison read offers a Retry.
- **Surprising:** the *file selector* lists every recorded file with its own counts, and switching files is a store write, not a URL change — the tab address stays the same.

#### `packages/client/ui-deliverables/src/client/review-store.ts` and `packages/client/ui-deliverables/src/client/review-definition.ts`
- **Purpose:** the review tab's per-tab view state, and the tab type's registry definition.
- **Key abstractions:** `createReviewStore()`; `ReviewTabState { index, split, wrap, navigated }`; `ReviewActions` (`navigated`, `selected`, `toggledSplit`, `toggledWrap`, `forget`); `changesReviewDefinition(t)`; `CHANGES_REVIEW_KIND`; `CHANGES_REVIEW_ID`; `ChangesReviewParams { index? }`.
- **Non-obvious design decisions:**
  - *The store is an EXCLUSIVE store* (`:44-47`): "the registration declares it as an exclusive store, so the framework mints one instance per session."
  - *The first navigation seeds the tab's defaults* (`:57-60`): a new tab starts `{ split: true, wrap: false }` — side-by-side, unwrapped. Later navigations only move the file.
  - *Every action names the tab it writes* (`:40-46`): `navigated(draft, tabId, revision, index)`.
  - *`forget` removes exactly one bucket* (`:82-85`): `Object.fromEntries(entries.filter(([id]) => id !== tabId))` — one tab's death does not touch another's.
  - *The tab type owns a URL pattern, not a route table* (`:45-50`): `patterns: ['dsh-resource://changes-review/**']`, `canOpen: address => parseChangesReviewAddress(address) !== undefined` — the definition and the parser are the same truth.
  - *The title is computed from the address on every call* (`:51-54`): the translator is read fresh, so a locale change retitles the tab.
- **Edge cases & failure handling:** writing to a tab with no bucket throws `'ui-deliverables: no review state for tab "…"'` — a loud failure rather than a silent no-op.
- **Surprising:** the tab is identified by the *package* id (`CHANGES_REVIEW_ID = '@deepseek-ai/dsh-client-ui-deliverables'`) while the tab *kind* is `changes-review` — the kind is the user's vocabulary, the id is the implementation's handle.

#### `packages/client/ui-deliverables/src/client/PresentRow.tsx` and `packages/client/ui-deliverables/src/client/PresentedFileCard.tsx`
- **Purpose:** the `present` tool's status row, and the delivery card's identity + actions.
- **Key abstractions:** `PresentRow`; `PreparingPresentRow`; `StartedPresentRow`; `fileNames(raw)`; `PresentedFileCard`; `cardDescription(description, fallback)`.
- **Data flow:** a durable tool record → the row's state (`preparing` / `running` / `ok` / `error` / `stopped`) → the recorded result text in a disclosure; the delivery declaration → the card's basename, description, type icon, and the contributed action slot.
- **Non-obvious design decisions:**
  - *The preparing stage is NOT expandable and shows no filenames* (`:41-46`): "It does not show filenames, create delivery cards, or enable file actions before the recorded call supplies arguments."
  - *Partial tool JSON stays visible* (`:22-24`): `catch { return raw }` — "Truncated tool JSON remains visible until the call completes."
  - *The row retains its document icon and recorded result across progress, success, failure, and interruption* (README) — the state changes, the identity does not.
  - *The card's description strips a trailing parenthesised type* (`:10-12`): `/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/u` — "Quarterly summary (.pdf)" displays as "Quarterly summary", and the Chinese full-width form is handled too.
  - *The action button is not nested inside the card's preview button* (`:20-21`, `:40-56`): the preview is an absolutely positioned sibling (`z-index: 1`) and the action slot sits at `z-index: 2` with `pointer-events: auto`.
  - *Success feedback fades after a hold* (`:44-47`): the animation delay/duration come from the controller's constants, so the CSS and the state expiry agree.
  - *The reveal copy depends on what the Host can actually do* (`:28-35`): with `fileManager === 'directory'` the copy is "Opening containing folder…", not "Showing in file manager…".
- **Edge cases & failure handling:** a malformed args blob is tolerated; an orphaned error (`call: null`) still shows `Name: code`; a result with no content and no error renders no disclosure at all.
- **Surprising:** the *description* is a `role="status"` live region only once a phase exists — before that it is static text, so a mounted card does not announce its own description.

#### `packages/client/web/src/boot.ts` — the boot kernel
- **Purpose:** the browser boot entry: load the module system, prefetch the immediate tier, activate every plugin, then hand the mount point to the UI renderer.
- **Key abstractions:** `AppWebEntry`; `BootSeams` (a test-only `loadBundle` replacement); `run(onFailure?)`; `dispose()`; `prefetchImmediateTier()`.
- **Data flow:** `__DSH_BOOT_READY__` gate → `window.__ModuleLoader__.create({ boot, staticModules, loadBundle })` → the manifest → prefetch of `immediately` rows → `bootClient` → `mountClient`.
- **Non-obvious design decisions:**
  - *The kernel owns exactly three things* (README): the module system, the Cordis Loader, and the boot page. "The Host owns the graph, batch preload, and loader facade, so `AppWebEntry` never knows the bootstrap package id or parses the wire format."
  - *A boot-readiness gate* (`:53-56`): the page owner installs `__DSH_BOOT_READY__` and settles it after every injection row has taken effect; "An absent global means no bootstrap owns the document and there is nothing to wait for." The boot page is already on screen while this waits.
  - *A carrier may own the fatal presentation* (`:100-103`): `run(onFailure)` keeps the loading page visible and hands the error outward; Desktop uses this to request native recovery. Without a carrier, the boot page renders the failure.
  - *The transport default is the pre-injected page transport, and explicit seams still win* (`:68-73`): the spread order is `...transport?.loadBundle`, then `...this.seams` — the explicit seam overrides.
  - *Prefetch failures are swallowed deliberately* (`:130-134`): "Prefetch only starts transport early; the Loader import retries and reports this bundle failure."
  - *The drag watcher is installed BEFORE the first mount* (`:118-120`): "the surface the renderer draws is the one the first frame measures."
- **Edge cases & failure handling:** a missing `__ModuleLoader__` throws a named error; a missing `__DSH_BOOT__` is reported by the facade; a duplicate graph entry is reported by the module system; every failure path ends in `console.error(reason)` plus either `onFailure` or `page.fail(...)`.
- **Surprising:** *the whole application waits for the full roster* — "one failed entry keeps the framework-free boot page visible with a per-entry report; partial UI availability is not supported." No degraded mode.

#### `packages/client/web/src/boot-client.ts` — the activation audit
- **Purpose:** mount the Loader over a module system, create every manifest row, wait for quiescence, and audit that every entry activated.
- **Key abstractions:** `bootClient(options)`; `assertEntriesActive(ctx, modules)`; `ClientBootOptions`; `EntryStateLabel`.
- **Data flow:** the manifest's `plugins` rows → `loader.create({ name })` per row → `internal/status` events → a per-entry state label → the audit.
- **Non-obvious design decisions:**
  - *The audit names the MISSING SERVICE* (`:70-74`): a pending entry's unmet `inject` list is resolved against `ctx.get(service)`, and the report says `pending (waiting for services: a, b)`. That is a diagnostic, not an exception class.
  - *The report is ONE aggregated error* (`:80-82`): "web boot: 4 entries did not activate" followed by one line per entry — the plural is even handled ("1 entry" vs "4 entries").
  - *An import failure names the recorded error when the module system has one* (`:64-69`): otherwise "import failed (see console for the import error)".
  - *The audit is strict at boot only* (README): "The initial activation audit remains strict; later page-local failures appear in Settings → Plugins → Plugin list."
  - *Every row is marked `loading` before the loader is asked* (`:39-40`), so the boot page has a denominator.
- **Edge cases & failure handling:** a row that never got a fiber is `failed`; a row whose fiber is `pending`, `failed`, `disposed` or `unloading` is reported.
- **Surprising:** the boot page's progress arc is driven by `active / total` — the *number of activated entries*, not bytes or time.

#### `packages/client/web/src/boot-page.ts` — the framework-free boot page
- **Purpose:** a plain-DOM boot page that survives a plugin failure, because React only arrives with the UI renderer.
- **Key abstractions:** `BootPage` with `setTotal`, `setState`, `fail`, `dispose`; the DOM contract `data-dsh-boot`, `data-dsh-boot-spinner`, `--dsh-boot-arc`.
- **Data flow:** entry states → the arc angle and the per-entry labels; a failure message → the report panel.
- **Non-obvious design decisions:**
  - *The arc is a CSS variable, not an animation* (`:106-108`): `--dsh-boot-arc` is set to `72 + ratio*216` degrees and consumed by a `conic-gradient` with a radial mask. Progress is *monotonic* and expressed as a real arc, not a spinner.
  - *The node identity persists* (`:41-42` + the boot spec's "resumes without replacing the document"): the boot page element is the same DOM node before and after the boot completes.
  - *The failure panel replaces the card's children, keeping the wordmark* (`:88-101`): `this.card.replaceChildren(this.wordmark, report)`.
  - *A failed entry is listed by name* (`:89-92`): one div per failed id, then the aggregated report text.
- **Edge cases & failure handling:** `setTotal(0)` → the arc stays at 72°; a failure that arrives before any state still renders the report.
- **Surprising:** the boot page's CSS carries its own fallback palette (`--dsh-boot-label-primary` etc.) because "The framework-free boot page cannot depend on theme delivery succeeding."

#### `packages/client/web/src/seed.ts` and `packages/client/web/src/platform.ts` — the shared module table
- **Purpose:** the frozen module table every dynamic bundle resolves its externals against.
- **Key abstractions:** `PLATFORM_MODULES` (11 specifiers); `PRELOADED_CLIENT_EXTERNALS` (currently empty); `getStaticModules()`; `PlatformModule`.
- **Non-obvious design decisions:**
  - *The `satisfies` pin is the projection contract* (`:29-33`): "a word added to PLATFORM_MODULES without a static import here (or vice versa) fails to compile instead of drifting into a runtime require miss."
  - *The list is the single source for three consumers* (`:3-5`): seeding, bundling externals, and Vite aliases — "so their module identities cannot drift."
  - *Built-in and installed plugins get the SAME instances* (README): "The shell supplies the dependency versions declared in this package's package.json; the module table does not negotiate versions per plugin."
  - *`PRELOADED_CLIENT_EXTERNALS` is empty* (`:18-20`) — the slot exists so the baseline is expressible without changing the contract.
- **Edge cases & failure handling:** n/a (a compile-time table).
- **Surprising:** the table includes the *repo's own* packages (`@deepseek-ai/dsh-client-store`, `ui-slots`, `ui-primitives`, `ui-dockkit`) — the shared runtime is a frozen singleton set, and a plugin that inlines its own copy of `ui-slots` would break the slot registry (which is why `tsdown.client.ts` refuses undeclared cross-plugin value imports).

#### `packages/client/web/src/mount.ts` — the renderer handoff
- **Purpose:** mount the UI renderer into the container through a *dependency fiber*, so replacing `uiRenderer` remounts the application.
- **Key abstractions:** `mountClient(ctx, container)`.
- **Non-obvious design decisions:**
  - *The mount is an inject, not a direct call* (`:16-20`): `ctx.inject(['uiRenderer'], scope => scope.effect(() => scope.uiRenderer.mount(container)))` — the effect installs when the service arrives and reinstalls when it is replaced.
  - *The mount effect's cleanup is the unmount* (`:17`): the renderer returns an unmount function, and the effect's disposal calls it. Pinned by "mounts into the container and unmounts when the tree is disposed" and "remounts when uiRenderer is replaced".
- **Edge cases & failure handling:** with `uiRenderer` already provided (the normal case) the effect is installed by the time `mountClient` returns; otherwise it installs when the service arrives.
- **Surprising:** this is how the app survives a plugin hot-reload that replaces the renderer — the whole React tree is remounted, not patched.

#### `packages/client/web/src/loader-status.ts`
- **Purpose:** the fiber-state vocabulary the boot page renders.
- **Key abstractions:** `FIBER_STATE` (a mirror of cordis's const enum); `LoaderEntryState`; `STATE_LABELS`.
- **Non-obvious design decisions:**
  - *The const enum is mirrored, not imported* (`:9-14`): "a const enum has no runtime object to import (and esbuild-based pipelines cannot inline it across modules), so these values mirror the pinned vendored definition while retaining its type."
  - *The label map is keyed by the member, not reversed* (`:19`): "inlining-safe — no reverse mapping."
- **Edge cases & failure handling:** n/a.
- **Surprising:** the comment names the exact bundler that broke the const enum — a reminder that a "type-only" import is not always erasable.

#### `packages/client/web/src/apply-injections.ts`
- **Purpose:** the page-side interpreter for the Host's structured index injection table.
- **Key abstractions:** `applyIndexInjections(rows, loadScript)`.
- **Non-obvious design decisions:**
  - *Rows execute strictly in table order* (`:2-4`): "so a global row lands before the scripts that read it."
  - *`script-preload` is a no-op* (`:36-38`): "Some transports cannot preload without executing; loadScript owns the actual request."
  - *The interpreter is total* (`:40-42`): an unknown row kind throws `web boot: unknown index injection row …` via `assertNever`.
- **Edge cases & failure handling:** a script row is injected as an inline `<script>` element (so it executes in page context); a `script-src` row awaits `loadScript`.
- **Surprising:** the same table is also rendered into `index.html` text server-side; this interpreter is the *static worker page's* equivalent, which is why it exists at all.

#### `packages/client/web/src/window-drag/regions.ts` — the app-region composition model
- **Purpose:** the executable statement of how Electron composes `-webkit-app-region` boxes.
- **Key abstractions:** `RegionRect`; `DRAG_MARK = 'data-window-drag'`; `RECALL_MARK = 'data-window-drag-recall'`; `INTERACTIVE_SELECTOR`; `containsPoint(rect, x, y)`; `isDraggableAt(regions, x, y)`.
- **Non-obvious design decisions:**
  - *"The last matching box decides"* (`:11-15`): "The composition is therefore equivalent to 'the last matching box decides' — a point is draggable when the last collected box containing it is `drag`." The model walks the boxes in DOM order and overwrites the answer.
  - *Edges are half-open* (`:64-70`): "Edges belong to the box, matching the half-open rectangles the window hit test uses" — so two adjacent boxes never both claim a point.
  - *One selector, two consumers* (`:41-58`): `INTERACTIVE_SELECTOR` is declared once and the base stylesheet's rule is compared against it by a test — "so the two cannot drift."
- **Edge cases & failure handling:** a point outside every box is not draggable; an empty region list is not draggable.
- **Surprising:** this module is *pure geometry with no DOM* — so the composition rule can be tested in node (the spec is `// @vitest-environment node`) and reused by a browser coverage scenario: "tests and the browser coverage scenario both decide points through this module so a claim about coverage has one meaning."

#### `packages/client/web/src/window-drag/recall.ts` — the one window drag watcher
- **Purpose:** the single watcher that makes Electron recollect the window's drag rects when a chrome row's geometry moves (electron#32341).
- **Key abstractions:** `installWindowDragRecall(options)`; `WindowDragRecallOptions` (`document`, `scheduleFrame`, `watchBox`); `GRACE_FRAMES = 2`; `MOTION_EVENTS`; `readBox`; `touchesRows`; `movesRows`.
- **Data flow:** DOM mutations / transitions / resizes → `arm()` → a frame → `measure()` → `removeAttribute(RECALL_MARK)` then, if any box moved, `setAttribute(RECALL_MARK, '')` → the next frame → the same → until the geometry settles.
- **Non-obvious design decisions:**
  - *The pulse is a clear-then-set, and the order is load-bearing* (`:81-95`): "Clearing first is part of the pulse, and the clear must be flushed before the measurement below reads it: one style pass between the two writes is what makes Electron observe a computed app-region value that changed back. Reordering these two statements silently drops the pulse."
  - *A grace window absorbs a transition's first frame* (`:27-32`, `:98-101`): a CSS transition's first frame still reports the from-value, so the loop must not stop on the first unchanged sample.
  - *The watcher's own output is not a movement* (`:190-193`): `if (record.attributeName === RECALL_MARK) return false` — otherwise the watcher re-arms from its own output every frame.
  - *A sibling inserted beside a row shifts it without resizing it* (`:202-207`): only a child-list change in a container that HOLDS a marked row re-arms; "which keeps streamed appends outside the surface out of here" — the transcript streaming beside the chrome rows never wakes the watcher.
  - *The mark subtracts the BODY's own box* (base.css): the row marks inside still declare drag and win in document order, "so the pulse changes nothing about the composed surface — it only makes Electron collect it again."
  - *Nothing is installed off darwin* (`:63`): `if (doc.documentElement.dataset.platform !== 'darwin') return () => {}`.
  - *Two scheduling seams* (`:44-52`): the frame queue and the box watcher are injected, so every pulse is decided by the test rather than by wall-clock timing.
- **Edge cases & failure handling:** a document with no `ResizeObserver` watches no boxes and relies on DOM changes alone; a seam whose canceller drops the frame on the floor is handled by a `disposed` flag — "a disposed watcher must not measure, mark, or re-arm from it."
- **Surprising:** the whole 224-line watcher exists to work around one Electron bug, and it is owned by the *shell* so that no chrome row has to know the trap.
### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/client/README.i18n.yaml` | Generated bilingual-pair hash record for `packages/client/README.md` — one hash per heading section, English vs Chinese. |
| `packages/client/README.md` | The package map for the browser half: 60+ packages, each with its role and its `ctx` key. The "kernel packages boot and serve the page; the UI feature packages present it" split. |
| `packages/client/README.zh.md` | The Chinese mirror of the package map; identical package table, localized prose. |
| `packages/client/hmr/README.i18n.yaml` | Generated hash record for the hmr README (22 sections). |
| `packages/client/hmr/README.md` | The reload contract: two-stage boot, the browser swap, the cascade, the failure policy, and the three stated limitations (coarse reload, no rollback, web transport only). |
| `packages/client/hmr/README.zh.md` | The Chinese mirror of the hmr README. |
| `packages/client/hmr/locale/en.json` | The package's English locale namespace — only `meta.title`. |
| `packages/client/hmr/locale/zh.json` | The package's Chinese locale namespace with a description. |
| `packages/client/hmr/package.json` | Manifest: exports `.`/`./client`/`./src/*`; `dsh.client.inject: [dsh-client-modules]`, `platform: web`, `immediately: true` (stage-one prefetch). |
| `packages/client/hmr/tests/events.client.spec.ts` | Pins the wire parser's three outcomes: a known frame, a forward-compatible unknown type, and an invalid frame. |
| `packages/client/hmr/tests/node-half.client.spec.ts` | Pins the stat-poll watch set: map-only writes are ignored, ctime-only changes publish, a reappearing bundle publishes, an ENOENT race keeps a dirty baseline, and the graph is broadcast *before* Host activation completes. |
| `packages/client/hmr/tests/transport.client.spec.ts` | Pins the browser transport: graph/rebuilt forwarding, two warns for two malformed frames, a logged rejection, the page-transport path, and silence on disposal-abort. |
| `packages/client/hmr/tsconfig.json` | Client tsconfig with the cordis/loader/modules/webserver/schemastery project references. |
| `packages/client/hmr/tsdown.config.ts` | `clientBundle(dir, ['lib/types/index.js'])` — the dynamic browser-half preset. |
| `packages/client/store/README.i18n.yaml` | Generated hash record for the store README. |
| `packages/client/store/README.md` | Decides that the store is React-free, owns sync/raf publication, Immer updates, shallow equality and opt-in persistence; the hook lives in `ui-renderer`. |
| `packages/client/store/README.zh.md` | The Chinese mirror of the store README. |
| `packages/client/store/package.json` | Manifest: zustand + immer as devDependencies (the ESM keeps them external), no `dsh.client` block — it is a static library, not a plugin row. |
| `packages/client/store/tests/store.client.spec.ts` | Pins the store engine: draft updates preserve untouched branches, sync vs raf notification counts, the microtask fallback, dev freeze (and no freeze in production), primitive persistence not exploded into index keys, storage failures reported but non-fatal, per-scope persist keys, and `clearPersisted` removing exactly one key. |
| `packages/client/store/tsconfig.json` | Client tsconfig with a single cordis project reference. |
| `packages/client/store/tsdown.config.ts` | `staticLinked(...)` — the store is a *static* library the shell bundles, not a dynamic plugin. |
| `packages/client/ui-attachment/README.i18n.yaml` | Generated hash record for the attachment README. |
| `packages/client/ui-attachment/README.md` | Decides the attachment surface: one ordered draft rail (64px images / 240px file cards), a document-level lightbox, a pointer-inert drop overlay, and the "no zoom, no focus trap" limits. |
| `packages/client/ui-attachment/README.zh.md` | The Chinese mirror of the attachment README. |
| `packages/client/ui-attachment/locale/en.json` | The package's English locale namespace — `meta.title` only. |
| `packages/client/ui-attachment/locale/zh.json` | The package's Chinese locale namespace with a description. |
| `packages/client/ui-attachment/package.json` | Manifest: `dsh.client.inject` lists the six packages whose slots it fills; every runtime dep is a devDependency (browser-only). |
| `packages/client/ui-attachment/src/AttachmentRail.module.css` | The rail's layout: hidden scrollbar, 64px items, edge arrows, hover/focus reveal of the remove button, `pointer: coarse` always-visible, reduced-motion opt-out, and the `--dsh-scrollbar-thumb` l2 rebinding contract. |
| `packages/client/ui-attachment/src/DropOverlay.module.css` | The overlay is `pointer-events: none` with a 10px backdrop blur and a 160ms fade; the title/desc use `--dsw-font-l-20`/`s-14`. |
| `packages/client/ui-attachment/src/FileCard.module.css` | The 240×64 card, the spinner, the failed state, the indeterminate progress bar — and `.progressBar[style] { animation: none }`, which is how the bar switches from indeterminate to determinate. |
| `packages/client/ui-attachment/src/MessageImage.module.css` | The gallery grid and the three variants (`single` 240px, `tile` 64px square, `thumbnail` 48px with `object-fit: contain`); a failed tile keeps its 64px cell. |
| `packages/client/ui-attachment/src/client/ComposerAttachments.module.css` | The rail wrapper and the 64px image item with its absolutely-positioned remove button. |
| `packages/client/ui-attachment/src/css-modules.d.ts` | The two-line `*.module.css` / `*.css` ambient declaration shared by every client package. |
| `packages/client/ui-attachment/src/index.ts` | The Host half: `apply()` is empty — "No host-side behavior; the client half registers the React slot entries." |
| `packages/client/ui-attachment/tests/attachment-rail.client.spec.tsx` | Pins the rail: ordered rendering, arrow visibility from scroll geometry, paging by one viewport (floored at 200px), the ResizeObserver path, the wheel conversion (LINE/PAGE deltas, 60px clamp, horizontal pan stays native), reduced motion, and "growth jumps to the end, removal does not". |
| `packages/client/ui-attachment/tests/composer-attachments.client.spec.tsx` | Pins the composer: file drags are intercepted while text drags stay native, dropped directories are reported through the entry API, nested drags are counted, a blocked drop is not forwarded, and the three upload states render with separate remove and retry. |
| `packages/client/ui-attachment/tests/drop-overlay.client.spec.tsx` | Pins the overlay: it portals to `document.body`, the desc line is optional, and the disabled state swaps the illustration and drops the desc. |
| `packages/client/ui-attachment/tests/image-slot-isolation.client.spec.tsx` | Pins the four image slots' independence: a priority-0 override replaces only its own slot and disposal restores the official gallery — for all four domains. |
| `packages/client/ui-attachment/tests/message-image.client.spec.tsx` | Pins the image renderer: a cached URL on the first frame, a 240px bounded box, the aspect clamp at [0.25, 4] with the crop anchor, retry after a failed load, thumbnail status icons in both locales, focus restoration on close, and a load that settles after unmount being ignored. |
| `packages/client/ui-attachment/tests/plugin.client.spec.ts` | Pins the plugin's registrations: the empty Host half, the one Factory, the five slot entries, and that every registration leaves with the plugin fiber. |
| `packages/client/ui-attachment/tsconfig.json` | Client tsconfig with ten project references (cordis, attachment, ui-renderer, ui-chat, ui-conversation, ui-tool, ui-trajectory, ui-slots, ui-primitives, locale). |
| `packages/client/ui-attachment/tsdown.config.ts` | `clientBundle(...)` — the dynamic browser-half preset. |
| `packages/client/ui-deepseek-model-label-1017/README.i18n.yaml` | Generated hash record for the badge package README. |
| `packages/client/ui-deepseek-model-label-1017/README.md` | Decides the badge's exact match (provider + model id + exact catalog name), its three stated limits, and that the package is meant to be *deleted* when structured release labels arrive. |
| `packages/client/ui-deepseek-model-label-1017/README.zh.md` | The Chinese mirror of the badge package README. |
| `packages/client/ui-deepseek-model-label-1017/package.json` | Manifest: injects `ui-model-selection`, `ui-renderer`, `locale`; the `dsh.client` block has no `external`. |
| `packages/client/ui-deepseek-model-label-1017/src/client/DeepSeekModelLabel.module.css` | A 5-line flex row with a 4px gap and `vertical-align: baseline`. |
| `packages/client/ui-deepseek-model-label-1017/src/css-modules.d.ts` | The `*.module.css` ambient declaration. |
| `packages/client/ui-deepseek-model-label-1017/src/index.ts` | The Host half: an empty `apply()` that only makes the browser package available to the Loader. |
| `packages/client/ui-deepseek-model-label-1017/tests/label.client.spec.tsx` | Pins the badge for both official providers at all three placements; pins that another provider, another model id, a custom name, a dated name and a later release name are all preserved; pins that the catalog entry is never rewritten and that unloading restores the fallback. |
| `packages/client/ui-deepseek-model-label-1017/tsconfig.json` | Client tsconfig with six project references. |
| `packages/client/ui-deepseek-model-label-1017/tsdown.config.ts` | `clientBundle(...)`. |
| `packages/client/ui-deliverables/README.i18n.yaml` | Generated hash record for the deliverables README. |
| `packages/client/ui-deliverables/README.md` | The longest README in the shard: it decides the changed-files card, the delivery cards, the review tab, the inline-code link vocabulary, the `present` prompt guidance, and eight stated limitations. |
| `packages/client/ui-deliverables/README.zh.md` | The Chinese mirror of the deliverables README. |
| `packages/client/ui-deliverables/locale/en.json` | The package's English locale namespace — `meta.title` only. |
| `packages/client/ui-deliverables/locale/zh.json` | The package's Chinese locale namespace with a description. |
| `packages/client/ui-deliverables/package.json` | Manifest: 9 injected packages, ~30 devDependencies (every runtime edge is dev-only for a browser package), and one real `dependency` (`dsh-typert-protocol`) for the Host half. |
| `packages/client/ui-deliverables/src/client/ChangedFiles.module.css` | The card's filled header, the mono path row, the count gutter, the "Preview in sidebar" hover swap, and the preview's hidden metadata/hunk headers. |
| `packages/client/ui-deliverables/src/client/Deliverables.module.css` | The two-column delivery grid (one column under 620px), the 60px file row, the absolutely-positioned preview button, the hover hint swap, and the success fade with a reduced-motion opt-out. |
| `packages/client/ui-deliverables/src/client/FileDiff.module.css` | The shared comparison layout: the intrinsic-width column track, `overscroll-behavior: none`, the added/deleted gutter tokens, and the `data-review-wrap` switch. |
| `packages/client/ui-deliverables/src/client/PresentRow.module.css` | The status row that stays readable beside long workspace paths. |
| `packages/client/ui-deliverables/src/client/ReviewTab.module.css` | The tab's selector, the 28px tool buttons, and the split toggle's 90° rotation when pressed. |
| `packages/client/ui-deliverables/src/client/file-actions.ts` | The **slot contract** for native file actions: `deliverables.file.actions` and `deliverables.review.file.actions`, each a `list`/`session` slot whose owner supplies `actionUrl`, `available`, `pending` and `onAction`. |
| `packages/client/ui-deliverables/src/client/locales.ts` | The `deliverables` namespace dictionary — 60+ keys, Chinese as the key-set source of truth, English typed as `Record<DeliverablesKey, string>`. |
| `packages/client/ui-deliverables/src/css-modules.d.ts` | The `*.module.css` ambient declaration. |
| `packages/client/ui-deliverables/src/index.ts` | The Host half: registers the static `ui:deliverable-file-references` system-prompt section and calls `registerPresentOpen(ctx)`. |
| `packages/client/ui-deliverables/tests/changed-files-hover.client.spec.tsx` | Pins the hover preview: nothing is read before 500ms, the comparison is only read when the preview opens, the preview keeps the workspace path, Escape and pointer-down close it, and a failed read offers a Retry. |
| `packages/client/ui-deliverables/tests/changes-diff.client.spec.ts` | Pins the comparison cache: a served comparison is kept, a 404 becomes `missing`, a 500 or a transport failure becomes a retryable `error`, a reset forgets everything, and a disposal drops the settling read. |
| `packages/client/ui-deliverables/tests/changes-open.host.spec.ts` | Pins the Host routes: the summary is served without the working directory, the comparison is the Host's, invalid coordinates are rejected before any read, the file opens at its verified Host path, and a launcher failure never leaks a Host path. |
| `packages/client/ui-deliverables/tests/deliverables.client.spec.tsx` | The biggest spec in the shard (1117 lines): pins the produced-path derivation (19 malformed-argument cases, dedup, first-seen order, canonical targets), the change announcement folding, the card's rendering and its developer-tools gate, the mention resolver's refusal to guess, the plugin's registrations and fiber teardown, and the delivery cards. |
| `packages/client/ui-deliverables/tests/file-actions.tsx` | A test double for the native-action slot — it renders the owner props so component tests can drive the gesture without the real control. |
| `packages/client/ui-deliverables/tests/present-open.client.spec.ts` | Pins the open controller: concurrent gestures coalesce, a 422 is `nativeUnavailable`, transport and HTTP failures are both retryable, disposal prevents late publication, success feedback expires after 5s + 200ms, and the expiry is owned before subscribers are notified. |
| `packages/client/ui-deliverables/tests/present-open.host.spec.ts` | Pins the declared-file open route end to end: the file is opened at its *current* bytes, a fork's own workspace is used, invalid coordinates are rejected before the read, a final symlink is refused, a child Session opens without activating an Agent, and disposal aborts and awaits a pending launch. |
| `packages/client/ui-deliverables/tests/present-row.client.spec.tsx` | Pins the `present` row: the saved result is disclosed, the preparation is non-expandable and subscribes to nothing, the lifecycle states are `running`/`error`/`stopped`, six malformed argument shapes are tolerated, and an orphaned error is shown. |
| `packages/client/ui-deliverables/tests/presented-file-card.client.spec.tsx` | Pins the delivery card: the directory-only copy in both locales, the basename with the full path in the title, the trailing "(.pdf)" suffix stripped (ASCII and full-width), and the action button independent of the card preview. |
| `packages/client/ui-deliverables/tests/prompt.host.spec.ts` | Pins the model-facing prompt section: an inline snapshot of the exact text, its presence in two recorded system-prompt sidecars, and its removal when the plugin unmounts. |
| `packages/client/ui-deliverables/tests/review-tab.client.spec.tsx` | Pins the review tab: the address round-trip, the store's seed/toggle/forget, the unified row numbering and the split pairing, the 5000-line cap, the synchronized two-column scroll on both axes, the one-sided hunks falling back to one column, the syntax highlighting, and the refusal of an address it did not mint. |
| `packages/client/ui-deliverables/tests/turn-tail-spacing.client.spec.ts` | A *source-text* spec: it reads the CSS files and asserts the exact margins, heights, font sizes and gaps, so a spacing regression is caught without a browser. |
| `packages/client/ui-deliverables/tsconfig.client.json` | The client build face: 20 project references, `rootDir: src`, `outDir: lib/types`. |
| `packages/client/ui-deliverables/tsconfig.host.json` | The host build face: 14 project references, listing only the four Host-side files. |
| `packages/client/ui-deliverables/tsconfig.json` | A solution tsconfig referencing both faces. |
| `packages/client/ui-deliverables/tsdown.config.ts` | `clientBundle(...)`. |
| `packages/client/web/README.i18n.yaml` | Generated hash record for the web boot kernel README. |
| `packages/client/web/README.md` | Decides the two-stage boot, the framework-free boot page, the shared module table, the `__DSH_BOOT_READY__` gate, and the one stated limitation (no partial UI). |
| `packages/client/web/README.zh.md` | The Chinese mirror of the web boot kernel README. |
| `packages/client/web/package.json` | Manifest: the shell's own dependency versions (React 18, zod 4.4.3, TanStack Virtual 3.14.10) — the versions the shared module table pins for every plugin. |
| `packages/client/web/src/base.css` | The shell's mount defaults: the theme-token fallbacks, `text-autospace: normal` on prose and `no-autospace` on code/diff/read/search/terminal, the one darwin drag rule, the recall mark rule, and the single `:is(...)` interactive subtraction. |
| `packages/client/web/src/boot-page.module.css` | The boot page's fallback palette and the conic-gradient spinner whose arc is the `--dsh-boot-arc` variable. |
| `packages/client/web/src/css-modules.d.ts` | The `*.module.css` ambient declaration. |
| `packages/client/web/src/index.ts` | The shell's public surface: `AppWebEntry`, `BootSeams`, `getStaticModules`, `PLATFORM_MODULES`, `PRELOADED_CLIENT_EXTERNALS`, `applyIndexInjections`. |
| `packages/client/web/tests/base-styles.client.spec.ts` | Pins the shell sheet: no theme import, the darwin interactive rule byte-identical to `INTERACTIVE_SELECTOR`, the one drag rule, the recall rule, and the autospace split. |
| `packages/client/web/tests/boot-client.client.spec.ts` | Pins the activation audit: every row activates, a row waiting on a missing service is named, an import failure is named and logged, and the report's singular/plural wording. |
| `packages/client/web/tests/boot-page.client.spec.ts` | Pins the boot page: the skeleton, the arc growing 72°→180°→288°, the failed-entry list, the complete sweep report, and detachment on disposal. |
| `packages/client/web/tests/boot.client.spec.ts` | Pins the boot entry: a carrier-owned failure keeps the loading page, the boot page is drawn *before* the Host injections and the same DOM node survives, the immediate tier is prefetched through the injected transport, and a modules-dependent row may be created before the modules row. |
| `packages/client/web/tests/mount.client.spec.ts` | Pins the renderer handoff: the mount happens once, the unmount happens on tree disposal, and replacing `uiRenderer` remounts the application. |
| `packages/client/web/tests/window-drag-recall.client.spec.ts` | Pins the drag watcher through its two seams: nothing off darwin, one pending frame, a pulse while the box moves, a re-arm on a sibling insertion but not on an unrelated container, the grace window, and a disposed watcher that never measures. |
| `packages/client/web/tests/window-drag-regions.client.spec.ts` | Pins the app-region composition: the last box wins, edges are half-open, a later drag re-adds what an earlier no-drag removed, and the published interactive selector. |
| `packages/client/web/tsconfig.json` | Client tsconfig with nine project references and a `**/*.legacy.*` exclusion. |
| `packages/client/web/tsdown.config.ts` | `staticLinked(dir, ['lib/types/index.js', 'lib/types/apply-injections.js'])` — two entries, so the shell also serves the injection interpreter. |
### Tier 3 — skipped with a reason

**None.** Every one of the 146 files in this shard was read in full, including the seven `generated-vendored`
`README.i18n.yaml` hash records (each 1–3 KB; they are per-heading bilingual-pair hashes, not bulk data, so
reading them line by line cost nothing and let the report assert what they are). No file was unreadable,
binary, or truncated. Two large files (`packages/client/tsdown.client.ts` at 780 lines and
`packages/client/ui-deliverables/tests/deliverables.client.spec.tsx` at 1117 lines) were read in full through
the `read` tool in numbered chunks; one earlier batch call was truncated by the tool and every affected file
(`packages/client/AGENTS.md`, `packages/client/README.zh.md`, `packages/client/hmr/README.md`) was re-read
individually before anything was written down.
## 2. Ideas worth stealing

1. **A build-time purity gate that turns "two packages share a runtime instance" into a red build.**
   `packages/client/tsdown.client.ts:567-577` — any `@deepseek-ai/*` *value* import that is not a requested
   module-table row, a vendored library, an inline-safe wire layer, or a generated `/remote` contribution
   **throws during the build**. Type-only imports are erased and never reach the gate. *Why it transfers to
   August Trading:* the app already has a "canonical single-source modules" list in `AGENTS.md`, but the rule is
   documentation-only; the same rule as a lint/build gate would make the second `riskReward.ts` impossible to
   merge. `CONVERGENT` (the pi and hermes-agent repos are expected to enforce module boundaries too; the *form*
   — a build-time rather than review-time check — is the transferable part).

2. **Three channels for live data, and no subscription machinery in a component.**
   `packages/client/AGENTS.md:15` and `:26` — parent knows it → owner props; only the component knows it →
   local state; shared/survives-remount → a declared store. And "Business components contain no subscription
   machinery — no `useSyncExternalStore`, no manual subscribe wiring, no mirroring an external snapshot into
   local state." *Why it transfers:* August Trading has several places where a `useEffect` mirrors a service
   snapshot into `useState`; this rule plus a store declaration removes the class of bug rather than each
   instance. `UNIQUE` (as stated).

3. **Effects do not synchronize state — and the rules say so in the negative.**
   `packages/client/AGENTS.md:32` — "`useLayoutEffect` is not a default and `useEffect` is not the fix: a layout
   measurement answers why it happens here, why CSS cannot express it, and why it must be pixel-based, then takes
   an injected measurement hook. An effect never pushes render-derivable data back to a parent through a props
   setter." *Why it transfers:* directly applicable to a chart-and-panel app; the "name the reason in the
   comment" clause is a reviewable rule. `UNIQUE`.

4. **A store's write set is the audit face.**
   `packages/client/store/src/contract.ts:36-40` — "declared as the store's complete write set (the audit face —
   components can only write through these)"; `BakedActions` strips the draft parameter so a component receives
   `actions.select(id)` rather than `actions.select(draft, id)`. *Why it transfers:* August Trading's stores are
   the natural place to enforce "the UI may only do these five things to a trade" — and the declared write set
   becomes a list you can diff. `UNIQUE`.

5. **A store handle must never be exported at module level.**
   `packages/client/store/src/contract.ts:95-99` — "module-cache identity is a disguised singleton across plugin
   reloads"; production code never calls `create()` outside a registration; tests do. *Why it transfers:* a
   module-level store handle in a hot-reloading app is a stale-instance bug that only shows after a reload —
   exactly the class of bug August Trading's HMR work would hit. `UNIQUE`.

6. **Fetch-once caches that forget on connection replacement, and refuse to retry on their own.**
   `packages/client/ui-deliverables/src/client/host-read-store.ts:34-93` — the URL is the cache key; a policy
   says which states a later request may replace; a connection reset aborts in-flight reads so an old Host's
   answer cannot publish into a new connection; a retry is a *user gesture*, not a timer. *Why it transfers:*
   August Trading's provider calls and journal reads need exactly this shape when the app runs in Electron and
   the backend can be replaced under it. `CONVERGENT` (the same "connection generation" idea appears in the
   `connection/reset` handler at `ui-deliverables/src/client/index.ts:41-45`).

7. **Derived state from the tool-call log, never from the prose.**
   `packages/client/ui-deliverables/src/client/turn-deliverables.ts:60-77` and `:114-120` — the set of "files
   this turn changed" is folded from *successful first-party mutation calls* and their recorded absolute
   `meta.path`; reads, unsupported tools, malformed calls, failed results and orphan results contribute nothing;
   a malformed relative target produces no guessed path. *Why it transfers:* this is the pattern for a trading
   app's "what did this analysis session actually write" (journal entries, rule files, chart drawings) — derived
   from the durable action log, not from what the model *said* it did. `UNIQUE`.

8. **A resolver that refuses to guess.**
   `packages/client/ui-deliverables/src/client/turn-deliverables.ts:279-303` — an inline-code token resolves only
   when exactly one target matches (exact path, an exact recorded argument alias, or a unique basename);
   ambiguous matches stay inert; no suffix or current-directory guess is ever used. *Why it transfers:* the same
   disambiguation rule ("exactly one match, otherwise inert") belongs on any place the app auto-links a symbol,
   ticker, rule name, or file in a model's answer. `UNIQUE`.

9. **A file/asset action is authorized by the durable event, not by the request.**
   `packages/client/ui-deliverables/src/present-open.ts:76-128` and `:87-92` — the route reads the event
   addressed by `(sessionId, seq, index)`, validates the declaration inside it, resolves the file through the
   *viewed* Session's filesystem, and requires the Host path to round-trip (`processPath(resolve(mapped))` must
   equal the declared path) or answers 422. *Why it transfers:* August Trading's "open the journal entry in the OS"
   / "export the trade log" actions have the same shape, and the round-trip check is a one-line defence against
   path confusion. `CONVERGENT` (the same "verify then act" discipline appears in the change-summary route).

10. **A "composed out" plugin is a first-class off state.**
    `packages/client/ui-deliverables/src/client/index.ts:1-9` and `:105-107` — all the policy lives in one file,
    and the prose face is reached through `ctx.get`, so "this plugin composed out — is the off state" is the
    *absence* of a service, not a boolean flag; "the owning view renders an empty list and inert prose at zero
    cost." *Why it transfers:* feature-flagging a whole capability should be a removal, not a branch everywhere.
    `UNIQUE`.

11. **An audit report that names the missing dependency.**
    `packages/client/web/src/boot-client.ts:60-82` — one aggregated error listing every entry that did not
    activate, with the *specific* unmet service (`pending (waiting for services: a, b)`) or the recorded import
    error, and correct singular/plural wording. *Why it transfers:* a startup health check that says "provider X
    is not configured" beats a blank screen; August Trading's provider list is exactly this shape. `UNIQUE`.

12. **A framework-free failure page that survives the framework's own failure.**
    `packages/client/web/src/boot-page.ts` and `boot-page.module.css` — the boot page is plain DOM and local
    CSS with its own fallback palette, so a plugin that fails to import is reported *by name* instead of
    producing a white screen; the progress arc is a CSS variable driven by `active / total`. *Why it transfers:*
    August Trading's Settings → Providers screen is the place where a misconfiguration must be legible; the
    "no framework, no theme dependency" constraint is a good discipline for any error surface. `UNIQUE`.

13. **A revision identified by metadata, not by content.**
    `packages/client/hmr/src/index.ts:44-55` and `packages/client/hmr/README.md:62` — the entry's mtime, ctime
    and size identify a revision "without hashing its contents"; unchanged metadata requires no content read; a
    Host restart over unchanged artifacts keeps the same revisions, so a reconnecting page does not replace its
    plugins. *Why it transfers:* the same trick makes an August Trading "the config changed" check cheap and
    makes a reconnect idempotent. `CONVERGENT` (all three repos watch artifacts).

14. **A "what would this cost" line, measured.**
    `packages/client/ui-deliverables/README.md` (Model Experience → KV Cache effect) — every package states what
    it adds to the prompt and whether the section is static. The deliverables guidance is "static at first-party
    order 9000 for the lifetime of the package mount, so it remains in the reusable prompt prefix and does not
    change across Turns." *Why it transfers:* the same "Model Experience / KV Cache effect" stanza is a template
    August Trading could adopt for every prompt-bearing module — and it is a template the harness *enforces*
    per package. `UNIQUE`.

15. **A per-package bilingual hash record.**
    `packages/client/*/README.i18n.yaml` — one hash per heading section for the English and Chinese blocks
    outside code blocks, re-recorded by `pnpm run verify-translation-pairing --write`. *Why it transfers:* if
    August Trading ever ships a second language, this is a cheap way to prove the two sides did not drift, with
    a script and no review discipline. `UNIQUE`.

16. **A drag-region composition model as pure, testable geometry.**
    `packages/client/web/src/window-drag/regions.ts` — "the last matching box containing it is `drag`", expressed
    as a 30-line function with no DOM, so the browser coverage scenario and the unit test decide the same
    question. *Why it transfers:* the same trick works for any "which surface wins" rule (z-index arbitration,
    which pane owns a keyboard key, which surface owns a click). `UNIQUE`.
## 3. Trading-specific findings

*(This shard is the browser half of the GUI: boot, attachments, model labels, deliverables and the window
chrome. It contains no model loop, no provider transport, and no scheduler. Where a question belongs to another
shard, that is stated rather than guessed.)*

- **Long-lived monitoring & scheduled work — mostly not in this shard, but the HMR poller is a clean precedent.**
  The reminder/schedule machinery lives in `ui-schedule` (not in this shard's file list). What *is* here is a
  long-lived poll that survives the failure modes a trading app's background poller also has:
  `packages/client/hmr/src/index.ts:74-137` polls every graph row's bundle every 500 ms; a file that is
  momentarily absent (a rename, a rebuild in flight) is marked `dirty` and retried rather than treated as an
  error (`:80-90`, `:104-112`); the stat is taken **before** publication so a write landing during the read is
  still caught next tick (`:117-120`); a `ctime`-only change publishes (`:50-52`); and the interval is
  `unref()`ed so it never holds the process open (`:143`). A trading "monitor for entry/TP/SL hits" poller has
  exactly these failure modes (a file/row momentarily missing, a write racing a read, a change that does not
  alter size).

- **Human-in-the-loop approval — the gate pattern is here; the approval UI is not.**
  `ui-approval` (the approval request surface) is not in this shard. What *is* here is how a consequential
  action is gated and audited: the native open/reveal is only ever executed from a **user gesture**
  (`ui-deliverables/src/client/present-open.ts:61-73` refuses a second gesture while one is pending), the
  action is authorized by the durable event coordinates rather than by the request
  (`src/present-open.ts:104-128`), the Host refuses with a *typed* status (409 no desktop, 422 no mappable
  path, 404 gone, 500 internal), the refusal is a **distinct UI phase** (`nativeUnavailable`) that makes the
  control disappear rather than fail silently, and the attempt leaves a **retained, retryable** state on the
  card with a per-URL success expiry (5 s hold + 200 ms fade). That is a small, reusable audit trail: who
  clicked, on which coordinates, what the Host answered.

- **Post-mortem / reflection loops — not in this shard, but the *record* that a loop would read is.**
  The learning/insight/rule machinery is elsewhere. What this shard contributes is the shape of the record:
  the Host announces a `workspace/changes` event, the card reads a **summary** through an authenticated route,
  and each file's **comparison is the turn's snapshot, not its current content**
  (`ui-deliverables/README.md`, review-tab section). Two consequences worth stealing: (a) the record is
  addressed by `(sessionId, seq)` and is therefore replayable and forkable — the same coordinates resolve in a
  child Session's own workspace (`present-open.host.spec.ts`, "resolves inherited declarations in the viewed
  fork workspace"); (b) a *timeout* is recorded as data (`coarse: true` → "Line comparison timed out; shown as a
  whole-file replacement") rather than hidden.

- **Multi-agent — not in this shard.** `ui-subagent` is not in this file list. The adjacent rule that does show
  up is the **turn-scoping** rule: "The Conversation Location index owns turn membership before this function
  runs, so paths cannot spill across turns and this derivation does not infer boundaries from neighboring
  presentation Nodes" (`ui-deliverables/src/client/turn-deliverables.ts:146-149`). For a multi-agent trading
  desk, that is the rule that keeps agent A's writes out of agent B's review.

- **Structured logs the model can query — partially here.** The session event log itself is addressed by
  `seq` and is the source of truth (outside this shard). What this shard adds is the **derived, served
  record**: a per-turn change summary and a per-file comparison, both read through authenticated
  document-relative routes, both validated by hand-written type guards (`src/changes.ts`), both cached
  fetch-once and invalidated on a connection replacement. No database: the Host holds the record in memory and
  the browser holds a URL-keyed map. The same pattern (a derived, queryable, per-turn summary of what changed)
  is what a trading app needs for "show me the trades this session took and why".

- **Staying simple as features accumulate — this shard's strongest theme.**
  Six mechanisms: (1) *one shared Factory, four domain adapters* — the image gallery is written once and
  mounted into four slots (`ui-attachment/src/client/index.ts:20-36`), so a fourth domain costs a registration,
  not a component; (2) *one policy file* — the deliverables package keeps "the supported mutation calls,
  mention matching, row cap, and copy" in one place so the whole feature composes out as a unit
  (`ui-deliverables/src/client/index.ts:1-9`); (3) *a whole package that exists to be deleted* —
  `ui-deepseek-model-label-1017` is 1095 bytes of component whose README says "Remove this package and its
  bundle row when structured release labels replace it"; (4) *a build-time gate* so a rule cannot be forgotten
  (`tsdown.client.ts:567-577`); (5) *one store per domain, no module-level singletons*
  (`store/src/contract.ts:95-99`); (6) *the "composed out = absent service" off state*, so a disabled feature
  costs nothing at runtime.
## 4. Non-obvious decisions and gotchas

1. **A zustand `persist` middleware corrupts primitive state, and it cannot be fixed with options.**
   `packages/client/store/src/index.ts:141-146` — the middleware's write path spreads state into an object
   (`partialize({ ...get() })`), so a persisted *string* draft becomes `{0:'h',1:'e',…}`; the corruption happens
   *before* serialization, so merge/deserialize options cannot help. The store therefore hand-rolls persistence.
   Anyone reaching for `zustand/middleware/persist` on a primitive state will hit this.

2. **`import.meta.env` must be defined three ways, not one.**
   `packages/client/tsdown.client.ts:554-559` — `process.env.NODE_ENV`, `import.meta.env.MODE`, **and** bare
   `import.meta.env`. zustand probes `import.meta.env ? import.meta.env.MODE : …`; without the bare key the
   truthiness probe survives as an empty `import.meta` and the bundle throws `ReferenceError` at boot.

3. **A `const enum` has no runtime object, and esbuild cannot inline it across modules.**
   `packages/client/web/src/loader-status.ts:9-14` — the values are *mirrored* from the vendored cordis
   definition, with the type retained. The comment names the exact bundler that broke it.

4. **Clearing a CSS attribute before setting it is load-bearing.**
   `packages/client/web/src/window-drag/recall.ts:81-95` — "Reordering these two statements silently drops the
   pulse." Electron only recollects app-regions when a *computed* value changes, so the clear must be flushed
   before the measurement reads it.

5. **A `read` that settles after a `reset` must not publish.**
   `packages/client/ui-deliverables/src/client/host-read-store.ts:69-73, 88-93` — the generation AbortController is
   aborted on reset, and `read` checks `signal.aborted` before writing. The same rule, in the open controller,
   is "disposal prevents late publication" (`client/present-open.ts:141`).

6. **A store's persist key IS its storage identity, and two instances under one key cross-pollute.**
   `packages/client/store/src/index.ts:180-186` — production is safe only because the framework caches one
   instance per handle × scope key; `create()` deliberately does not dedupe so tests can create freely.

7. **`ctx.slots.inject(name, () => ctx.slots.register(...))` waits for the SLOT DECLARATION, not for the other
   plugin's activation.** `packages/client/ui-attachment/src/client/index.ts:22-25` — the registration is removed
   when the declaration collapses and reruns after a redeclaration. This is the sanctioned way to fill another
   package's slot, and it is why the deliverables package can register a `sidebar.right.pane.tab` body without
   importing the sidebar package's code.

8. **A plugin that reads a *decision* from its owner must not own a boolean.**
   `packages/client/ui-deliverables/src/client/Deliverables.tsx:88-90` — the changed-files card's visibility is
   `ctx.configForms.developerTools.enabled` supplied through the inject face, not a prop the component reads
   from a config file.

9. **A diff's two sides are tokenized INDEPENDENTLY.**
   `packages/client/ui-deliverables/src/client/FileDiff.tsx:35-52` — the old and the new side of a changed line
   are different code and get different colours. Tokenizing the file as a whole would be wrong, and is
   impossible anyway: the omitted source lines are not available.

10. **A one-sided diff silently drops to one column without changing the user's chosen view.**
    `packages/client/ui-deliverables/src/client/FileDiff.tsx:154-157` — `oneSided = hasAdditions !== hasDeletions`
    → the split is not drawn, but the split *toggle* still reads as pressed. The user is not lied to.

11. **A path that does not round-trip is refused, even when a same-named file exists.**
    `packages/client/ui-deliverables/src/present-open.ts:87-92` — `processPath(resolve(processPathFromHostPath(p)))`
    must equal `p`. A final symlink therefore 404s. "a same-named Host file is insufficient."

12. **A "folder" drop is indistinguishable from an empty file except through the entry API.**
    `packages/client/ui-attachment/src/client/drop-events.ts:8-21` — `webkitGetAsEntry()?.isDirectory` is the
    only source of that fact; browsers without it report no directories. The `items` and `files` lists are walked
    in lockstep to line them up.

13. **A rail that MOUNTS over existing content must not scroll to the end.**
    `packages/client/ui-attachment/src/AttachmentRail.tsx:59-78` — a `countRef` of `null` marks the first layout
    pass, so a session switch back to held images is "initial display, not growth". Only a growing count scrolls.

14. **`document`-level `wheel` listeners must be attached manually and non-passive.**
    `packages/client/ui-attachment/src/AttachmentRail.tsx:95-115` — React's root wheel listener is passive, so
    without a manual `{ passive: false }` listener a vertical tick over the rail would also scroll the
    conversation behind the composer.

15. **A `ResizeObserver` on the element, not on the window.**
    `packages/client/ui-attachment/src/AttachmentRail.tsx:85-93` — the rail's width follows the composer, which
    resizes with sidebars and panels; observing the window misses those.

16. **The `ui:deliverable-file-references` prompt section is static at order 9000 so it stays in the reusable
    prefix** — and the test asserts it appears in two recorded system-prompt sidecars
    (`ui-deliverables/tests/prompt.host.spec.ts`).

17. **A `dsh.client` row's `inject` list is INFORMATIONAL ONLY.**
    `packages/client/AGENTS.md:148` — it does not sequence entry activation or apply order; activation order is
    Cordis fiber inject waiting on *services*. A reader would assume otherwise.

18. **`dsh.client.external` is not a feature-plugin dependency mechanism.**
    `packages/client/AGENTS.md:83` — only infrastructure, transport or generated assembly may add a
    package-specific non-baseline value request.
## 5. Weak spots

1. **The architecture is enforced by prose plus one build gate, and the prose is long.** `packages/client/AGENTS.md`
   is 162 lines of dense rules — slot discipline, five props shares, export discipline, ctx discipline, layering
   red lines, dependency classification, module-graph semantics, directory regime, styling, i18n, testing, a
   check ladder, a package checklist and a component checklist. Most of it is *review-time* discipline. The one
   mechanically enforced rule (the bundle purity gate) is exactly the rule that would be easiest to state
   briefly. A new contributor has to internalise the whole document before writing a line, and the document
   itself references at least five other documents (`docs/subsystems/web-client.md`, `slots.md`,
   `conversation.md`, `docs/web-styling.md`, `docs/testing.md`) — five-context loading before the first edit.

2. **The build preset is 780 lines of hand-rolled bundler behaviour, and several of its rules are folklore
   encoded as regexes.** `packages/client/tsdown.client.ts` — the purity gate is a 20-line regex
   (`INLINE_SAFE`, `:69`) naming 12 package families; the CSS handling is three near-identical virtual loaders
   (`:580-634`); the async-chunk rewrite depends on a *specific* rolldown output shape and throws if it does
   not match (`:456-467`); and `import.meta.env` must be defined three ways for one library's probe (`:554-559`).
   Every one of these is a real constraint, but they are pinned by the shape of a third-party bundler's output
   rather than by an interface, so a rolldown upgrade is a multi-site risk. There is no test suite for the
   preset in this shard.

3. **The `web` boot package accepts no partial availability, and the failure is a wall of text.** The README
   states it as a limitation ("partial UI availability is not supported"), and `assertEntriesActive` throws one
   aggregated error naming every failing entry — which is *excellent* for a developer and *poor* for a trader
   who just wants the app to open. A surface that said "the app works, except the journal tab" would be a
   different product decision, and the code makes that decision once, in one place, with no seam for it.

4. **The i18n burden is real and the enforcement is hash-based.** Every package carries a `README.zh.md`
   (16 KB for deliverables alone) plus a per-heading hash record; the `verify-translation-pairing` script proves
   the two sides have *the same content*, which is a strong property, but it means every README change is two
   edits and a re-record, and the hash record says nothing about whether the Chinese is *good*.

5. **Two parallel slot systems in one package.** `ui-deliverables` fills `conversation.chat.turnTail` (a `list`
   slot) *and* registers a keyed `sidebar.right.pane.tab` body *and* provides a `chatFileMentions` service
   *and* a keyed `tool.call.toolview` entry — four different extension mechanisms for one feature package, each
   with its own lifecycle. The tests are correspondingly large (1117 lines for one spec), and the plugin's
   `apply` is a sequence of registrations whose interaction is only visible in the integration test.

6. **The comparison route serves whole file text.** `ui-deliverables/README.md` (Known Limitations) — "the
   comparison route serves a listed file's complete text wherever the Host recorded it, including ignored files
   and files outside the workspace root the Sidebar previews are confined to." A diff viewer that needs only the
   hunks is shipped the whole file. That is a bandwidth and a data-exposure decision left in place for
   convenience.
