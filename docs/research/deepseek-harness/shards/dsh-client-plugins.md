# deepseek-harness :: dsh-client-plugins

**Files in shard:** 55 (read: 51, skipped with reason: 4)
**What this shard covers:** the two browser-side plugin packages of the DeepSeek Harness web client — `packages/client/ui-plugin-manager` (the sidebar "Plugins" panel: install/enable/disable/uninstall plugin bundles, watch pnpm output, edit plugin configuration, and the Host-side registry-latency probe) and `packages/client/ui-plugin-market` (the "Discover" tab: browse a plugin-market index, search/filter/sort it, and install a listed version). It is the client half of a host-driven plugin system: a React-free controller per package owns state, the Host (`boot/plugin-manager`, `boot/plugin-market`, `api/remotes`) owns every fact, and the two packages meet only through a declared **slot contract** (`slot-contract.ts`). The shard contains no model-facing code at all — both READMEs say so explicitly ("Model Experience: None … this package neither assembles nor sends a provider request") — so its value to August Trading is in **state-machine design for uncertain long-running work, refusal vocabularies, slot-based extension points, and a bilingual-dictionary discipline**.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `packages/client/ui-plugin-manager/src/client/manager-store.ts`
- **Purpose:** the single owner of the Plugins page's state: the Host's bundles joined with their live plugin entries, the action in flight, the pnpm install run and its outcome, the uninstall confirmation, and the toast a failed action becomes (1308 lines).
- **Key abstractions:**
  - `PluginManagerController` (`manager-store.ts:550`) — a React-free store class exposing `getSnapshot()`, `inject(configLedger, pluginTabs, resolveText)` → `PluginManagerFace`, and `dispose()`.
  - `PluginManagerState` (`:304`) — `status: 'idle'|'loading'|'ready'|'error'|'unavailable'`, `refreshStatus: 'idle'|'refreshing'|'failed'`, `packages`, `busy` (keys with a wire-crossing action), `notice`, `install`, `confirm`, `highlight`.
  - `InstallState` (`:197`) — the install dialog's whole world, including `phase: 'idle'|'checking'|'starting'|'running'|'cancelling'|'applying'|'unconfirmed'|'unknown'|'done'|'failed'` (`:203`).
  - `InstallRequest` (`:541`) — the four flags that make the cancellation/recovery machine work: `acknowledged`, `replyLost`, `recovering`, `cancellation.waitingForStart`.
  - `ManagerNotice` (`:44`) — the toast union, every variant carrying a monotonic `seq` so one toast is distinguishable from the next.
  - Pure helpers exported for tests: `registryKey` (`:139`), `offeredRegistries` (`:156`), `packageView` (`:448`), `sortPackages` (`:486`), `rowKey` (`:438`), `isInstallPending` (`:267`), `githubRecoveryRegistry` (`:277`), `asksMirror` (`:292`).
- **Data flow:** `read()` (`:865`) asks `pluginInventory.list()` first — *if the Host manages no profile the page is `unavailable`*, not broken — then `Promise.all([listBundles(), listPlugins()])` and joins each bundle with the entries its rows run as. Every action ends with `await this.load()`; every `plugin-manager/changed` event triggers a load; every load coalesces (`:838`).
- **Non-obvious design decisions:**
  - **A `null` registry is a value, not "unset".** `registry: null` means "the registry pnpm's own configuration names". `RegistryChoice` (`:122`) is therefore a union `{kind:'offered', registry: Registry}` | `{kind:'custom', url}`, not a nullable string. `registryKey` (`:139`) compares by normalized URL but **falls back to the raw string when the URL does not parse** — a remembered address that no longer parses still stands for itself rather than colliding with anything.
  - **`uncertainty` is a first-class field, not an error string** (`:254`): `'result'` (the install's reply was lost), `'cancellation'` (a stop was not confirmed), `'acceptance'` (the Host has not yet accepted the request). Each maps to a different sentence and a different recovery action (only `'result'` offers "Check installation status" — `PluginManagerPage.tsx:1419`).
  - **A refresh never destroys cached data.** `settleRefresh()` (`:857`) turns a failed refresh into a *toast* when there was cached inventory and into an *inline error* when there was not; `hasCachedInventory` (`:557`) is what distinguishes them.
  - **The spinner is held for a minimum** (`REFRESH_SPINNER_MIN_MS = 400`, `:130`) so a fast read does not flash it (`:850`).
  - **`transientRegistry`** (`:566`): a registry chosen by another tab applies to that one install and is **never remembered** (`:994`).
  - **The registry choice is remembered per browser** in `localStorage` under `dsh.plugin-manager.install-registry` (`:568`); a remembered registry the Host no longer offers is **kept as a typed one** (`reconciled`, `:511`).
  - **A late answer is dropped by identity, not by timing.** `generation` (`:554`) and `this.request !== request` (`:1058`) guards mean an answer that arrives after disposal or after a newer request never touches the state.
- **Edge cases & failure handling:** empty input (the spec is trimmed and an empty spec is refused locally), a refused spec vs a refused *answer* (the former returns to the field with a reason, the latter reads as `unknown` with the transport's words — `:1006-1012`), a transport rejection vs a Host refusal (the refusal keeps its code, the transport's words are shown verbatim), an install that is cancelled before the Host accepted it (retried automatically when acceptance arrives), a lost install reply (recovered by `waitForInstall`; if the Host has no active request the phase becomes `unknown`, not "cancelled" — `:1063`), a pnpm failure with no package result (a run that is still open settles with `exitCode: null`).
- **Surprising:** `update()` (`:665`) is **remove-then-install**. If the removal fails with `stop-profile` the install proceeds anyway (the running bundle stays installed and the new one waits for a restart); if it fails for any other reason the update is abandoned. And a finished install offers "Enable now", but a refusal to enable **still closes the dialog** and merely toasts — the list then shows what did not switch on (`:1207-1228`).

### `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx`
- **Purpose:** the whole Plugins page — grouped cards, bundle/row/official-plugin detail pages, the install wizard, the uninstall confirmation, and the toasts (1815 lines, ~20 local components).
- **Key abstractions:** `PluginManagerPageProps` (`:48`) is the slot renderer's assembled props; `PackageCard`/`ItemCard` (`:546`,`:585`); `PackageDetail`/`RowDetail`/`ItemDetail` (`:679`,`:637`,`:609`); `InstallDialog` (`:1005`); `ConfirmDialog` (`:1503`); `RowsSection` (`:308`); `AddPluginMenu` (`:63`).
- **Data flow:** the page reads four reactive sources bound by the renderer — `usePluginManager`, `useConfigLedger`, `usePluginTabs`, `useStore` (navigation) — and renders slots it never names: `plugins.item`, `plugins.bundle.config`, `plugins.row.config`, `plugins.add.actions`, `plugins.tab`, `plugins.detail.actions|badge|section`, `plugins.bundle.activation`.
- **Non-obvious design decisions:**
  - **The page draws chrome; the plugin draws content.** "The page draws the title, icon, and crumb itself"; a slot entry renders `null` for a subject it has nothing for and draws its own section chrome.
  - **A configuration entry owns its draft.** Leaving the page drops the staged edits (README, *Configuration pages*).
  - **`useInstallComposition`** (`:975`) guards IME confirmation: `isComposing` OR the legacy `keyCode === 229` OR an internal 10 ms window after `compositionend` (Safari's post-composition Enter). The two inputs (spec, custom registry) keep **independent** composition state.
  - **The registry options are portaled and FIXED-positioned** (`:1223` `createPortal(..., document.body)` + `useAnchoredPosition`) so unfolding them never lengthens the dialog; the panel is opaque so the radio controls stay readable over the modal.
  - **Escape folds the registry panel and goes no further** (`:1043`): a capture-phase listener calls `stopPropagation()` so the modal underneath does not also close.
  - **Tab inside the registry panel is trapped** (`:1256`) between the selected radio and the address field, and leaving either end closes the panel and returns focus to the toggle.
  - **The install terminal folds to 12 lines** (`INSTALL_TERMINAL_LINES = 12`, `:801`) — the shared `TerminalBlock` keeps the first and last six.
  - **`installDoneOtherVersion` is only shown when exactly ONE registry was asked** (`:1398`): "a fallback registry can serve another release than the one inspected, so only a single-registry run is explained".
  - **The list's own order is not the Host's order.** `sortPackages` sorts by `shortName` (strips scope and the `dsh-`/`dsh-host-`/`dsh-client-` prefixes), so "a card stays put when its bundle is switched, whatever order the Host answers in" (`:481`).
  - **Hardcoded package-name lists** decide the page's grouping: `BUILTIN_PROFILE_BUNDLES` (`:115`), `EXTENSION_BUNDLES` (`:124`), `MORE_BUNDLES` (`:130`).
- **Edge cases & failure handling:** a bundle that leaves the list drops back to the cards (`:1610`); a contributed tab whose entry leaves the ledger falls back to "Installed" and stays there (`:1607`); an image that fails to decode falls back to default artwork without blocking management (`:238`); a card with no `scrollIntoView` is still marked (`:2157` in tests).
- **Surprising:** the page **excludes built-in profile bundles from its cards even when the Host reports an error for them** (`:1615`), and the "More" list is not a tab panel — it replaces the Installed groups entirely and hides the refresh/add buttons.

### `packages/client/ui-plugin-manager/src/client/slot-contract.ts`
- **Purpose:** the **extension contract** the Plugins page declares for other plugins (200 lines). A registrant merges it with `import type` and never imports the package at runtime.
- **Key abstractions:** nine slots declared via `declare module '@deepseek-ai/dsh-client-ui-slots'` (`:118-199`): `plugins.add.actions` (list), `plugins.tab` (list), `plugins.bundle.activation` (keyed), `plugins.item` (list), `plugins.bundle.config` (keyed), `plugins.row.config` (keyed), `plugins.detail.actions` / `.badge` / `.section` (lists). Owner-prop types: `PluginConfigViewProps`, `PluginRowRef`, `PluginPackageRef`, `PluginsSubject`, `PluginDetailProps`, `PluginActivationOwnerProps`, `PluginTabInstall`, `PluginTabProps`, `PluginAddActionsProps`, `ConfigPageForm`.
- **Data flow:** the page renders a slot with a *subject* (`{kind:'bundle',pkg} | {kind:'row',pkg,row} | {kind:'item',id}`); a contribution decides from the subject whether it has anything to say.
- **Non-obvious design decisions:**
  - **A contribution is given facts, never the page's own state.** `PluginPackageRef` carries name/version/installed/availability/official/enabled/rows — "never the page's own state" (`:47`).
  - **One slot serves two views.** `PluginConfigViewProps.view` is `'summary' | 'page'`; bundle config renders only `'page'`, official cards render `'summary'` under the title and `'page'` in the body.
  - **The owner of a config page supplies the form, not the page.** `ConfigPageForm` (`:212`) is `{ state: ConfigFormSnapshot, mutate }` — the page owner hands over the accepted values and an atomic `mutate(ops, expectedRevision)`.
  - **A row's page exists only while a `plugins.row.config` entry names that row** (README) — so a contribution meant for a row renders on the page that configuration opens.
- **Edge cases:** `renderSlot('plugins.item', {view:'summary'}, {only: item.id})` — the `{only}`/`{entryKey}` option narrows the list to one registration, so a page with 40 official plugins does not render 40 summaries.
- **Surprising:** `plugins.item` is documented as **OCCUPIED** by the official settings pages ("one companion package per host-plane namespace") — the contract documents its own occupancy, which is a rare and useful form of API documentation.

### `packages/client/ui-plugin-manager/src/client/presentation.ts`
- **Purpose:** display labels and toast sentences — the pure layer between the Host's codes and the user's words (195 lines).
- **Key abstractions:** `registryText` (`:29`), `managementText` (`:84`), `shortName` (`:110`), `packageText` (`:121`), `rowText` (`:141`), `restartText` (`:163`), `noticeText` (`:175`).
- **Data flow:** Host error code → the page's dictionary → one sentence. `CODE_KEYS` (`:58`) is a `satisfies Record<ManagementError['code'], PluginManagerLocaleKey>` map, so **a new Host code breaks the build until it is worded** (`:56`).
- **Non-obvious design decisions:**
  - **Never claim a registry's name before the Host has read it.** `registryText` (`:29`) returns the *neutral* "default registry" when the Host could not read pnpm's configuration; it only says "npm's own registry" once the resolved URL is known. "The label never claims npm's own for another one."
  - **A refusal's own diagnostic is shown verbatim** — only `operation-error` passes the Host's text through (`:100`); every other code gets a sentence from the dictionary.
  - **An incompatibility gets one sentence per package** plus a remedy that differs for "installing" vs "already installed" (`:86-98`).
- **Edge cases:** a registry URL that does not parse is shown as written (`:44`); a Host that names no restart reason still asks for the restart (`:164`).
- **Surprising:** `shortName` is used for *sorting*, not display — it strips `dsh-`, `dsh-host-`, `dsh-client-` so `@deepseek-ai/dsh-experimental-voice-input-bundle` sorts under "experimental-voice-input-bundle".

### `packages/client/ui-plugin-manager/src/client/config-ledger.ts`
- **Purpose:** projects the three configuration slots into one observable the page binds (85 lines).
- **Key abstractions:** `ConfigLedger` (`{items, bundles, rows}`), `OfficialItem`, `rowConfigKey(bundle, rowId)` (`:36`), `configLedgerSource(ctx)` (`:45`).
- **Data flow:** `ctx.slots.entries('plugins.item' | 'plugins.bundle.config' | 'plugins.row.config')` + `ctx.locale` → one cached snapshot; `subscribe` fans out to all three slots plus the locale.
- **Non-obvious design decisions:**
  - **The projection is versioned, not recomputed.** It keeps the three slot `getVersion()` numbers and the locale `revision`; it rebuilds only when one moves (`:53-60`). A label thunk is therefore **re-read on locale change, not on every snapshot** (pinned by `config-ledger.client.spec.ts:78-85`).
  - **`rowConfigKey` is `${bundle}#${rowId}`** — a bundle and a row can never collide in the keyed slot, and the key is derivable by anyone who knows the two names.
  - **A list-slot registration without an id is a `/* v8 ignore next */` case** (`:63`) — the type says it cannot happen; the comment says so out loud.
- **Edge cases:** a keyed registration without a `key` is skipped rather than producing an `undefined` key (`:48`); an item without a label gets an empty title.
- **Surprising:** the file's own doc comment explains that the projection is what lets "the page never name a configurable plugin" — the indirection is the feature.

### `packages/client/ui-plugin-manager/src/client/index.ts`
- **Purpose:** the browser half's registration: the sidebar entry, the `main` panel, the shell-overlay refresh toast, and the Host-invalidation wiring (161 lines).
- **Key abstractions:** `apply(ctx)`, `NS = 'pluginManager'`, `PANEL_ID = 'plugins'`, `inject = ['slots','locale','remote','remote.pluginManager','remote.pluginInventory','remote.pluginRegistryProbe','configForms','layout']` (`:80`), and the `ctx.pluginNavigation` service (`:36`).
- **Data flow:** `ctx.effect` blocks register the dictionaries, the controller, the Host invalidations, the two slot registrations and the `main` panel.
- **Non-obvious design decisions:**
  - **The panel owns a navigation store; the controller owns the data.** `ctx.slots.inject('main', function* () { ... })` creates ONE store instance and hands every registration the same instance (`:110-115`), so a React remount preserves the selected target while a fresh registration starts on the list.
  - **Leaving the panel resets the view to the list** (`:118`) — but only the *view*, not the tab.
  - **A page never rendered holds no snapshot to refresh** (`:93`): `refresh()` is a no-op unless `status !== 'idle'`, so a Host change that arrives before the first render does not trigger a read (pinned by `browser-plugin.client.spec.tsx:196-203`).
  - **The refresh toast is registered into `shell.overlay`**, not into the page, so it **survives navigation away from the Plugins panel** (`:101-110`).
  - **`pluginNavigation.openBundle(packageName)`** is provided via `ctx.reflect.provide` so another client plugin can open a bundle's detail **without changing the current Session** (`:120-127`).
- **Edge cases:** the fiber's disposal removes every registration; a re-registration creates a *fresh* controller, so a stale notice cannot leak into the new page (pinned by `browser-plugin.client.spec.tsx:141-146`).
- **Surprising:** the `inject` list is asserted **exactly** by a test (`:150`): the page declares the services it uses and no more.

### `packages/client/ui-plugin-manager/src/client/tab-ledger.ts`
- **Purpose:** projects the `plugins.tab` ledger (other plugins' contributed tabs) as one locale-following observable (56 lines).
- **Key abstractions:** `PluginTab {id,label}`, `tabLedgerSource(ctx)`.
- **Data flow:** identical shape to `configLedgerSource` — cached on the slot version + the locale revision.
- **Non-obvious design decisions:** the same versioned-cache pattern, so the two ledgers behave identically; an entry without a label is an empty title rather than a crash.
- **Edge cases:** unsubscribe removes the listener from both the slot and the locale (`:47`).
- **Surprising:** a tab's label is a **thunk** resolved at read time, so the locale change re-labels the tab without the tab re-registering.

### `packages/client/ui-plugin-manager/src/client/navigation-store.ts`
- **Purpose:** the page's selection state — which list/detail is open and which tab (39 lines).
- **Key abstractions:** `View = {kind:'list'} | {kind:'more'} | {kind:'package',name,from?} | {kind:'item',id} | {kind:'row',name,rowId,from?}`; `NavigationState = {view, tab}`; `createNavigationStore()`.
- **Data flow:** `defineStore` with `init` = `{view:{kind:'list'}, tab:'installed'}`; two draft-mutating actions.
- **Non-obvious design decisions:**
  - **`'installed'` is the page's own tab; any other tab value is another plugin's registration id** (`:17`) — one field holds both kinds, disambiguated by the ledger.
  - **`from?: 'more'`** records which list a detail was opened from, so the crumb can return to the right list (`:11`).
- **Edge cases:** a detail whose bundle is absent resolves to `undefined` and the page shows the list.
- **Surprising:** the store is created *per registration*, not per component — the "remembered target across a React remount" behaviour is a consequence of the store's lifetime, not of any state machine.

### `packages/client/ui-plugin-manager/src/client/locales.ts`
- **Purpose:** the page's entire dictionary (27 KB, ~430 keys in Chinese and English).
- **Key abstractions:** `zh` (the **key source of truth**), `en` (`satisfies Record<PluginManagerLocaleKey, string>`), `PluginManagerLocaleKey = keyof typeof zh`, plus two exported template constants `INSTALL_GIT_EXAMPLE` and `INSTALL_PATH_EXAMPLE` (`:4`,`:6`).
- **Data flow:** `ctx.locale.register(NS, {zh, en})`; the page binds `t = ctx.locale.bind(NS)`.
- **Non-obvious design decisions:**
  - **The Chinese dictionary is the key source; English is checked against it** (`:6` `as const` + `:436` `satisfies`). A key added to `zh` but not `en` is a type error.
  - **The templates are exported constants, not literals in the component**, so the page can detect "the user typed the example verbatim" and say "replace this with the actual Git repository address" (`:5`).
  - **Every refusal code has a sentence**; the reason codes read as the Host's own vocabulary ("The profile patch cannot address this one uniquely").
- **Edge cases:** the sentence separator differs by language (`''` in Chinese, `' '` in English — `:429`/`:430`).
- **Surprising:** `installDoneOtherVersion` explains pnpm's `minimumReleaseAge` supply-chain policy **in the UI** — a security policy the app does not own, surfaced with the exact `name@version` to install if the trader insists.

### `packages/client/ui-plugin-manager/src/client/PluginRefreshToast.tsx`
- **Purpose:** hosts the refresh-failure toast **outside the Plugins panel's lifetime** (32 lines).
- **Key abstractions:** `PluginRefreshToastFace` (a `Pick` of the manager face plus the notice hook), `PluginRefreshToastProps`.
- **Data flow:** reads `state.notice` from the shared store; renders only when `notice.kind === 'refresh-failed'`.
- **Non-obvious design decisions:** **the toast is keyed by `notice.seq`** (`:28`) so a second failure is a *new* toast, not a re-render of the first, and the old one is not re-shown.
- **Edge cases:** every other notice kind renders `null` (`:25`).
- **Surprising:** the toast component does not import the store — it receives the hook through the slot's `inject`, which is how the overlay survives the page's own registration.

### `packages/client/ui-plugin-manager/src/client/PluginsPanelIcon.tsx`
- **Purpose:** the sidebar's Plugins glyph (28 lines).
- **Key abstractions:** `PluginsPanelIcon({size})`.
- **Data flow:** renders `IconPluginPinwheelOutlineRegular` at the sidebar's requested size.
- **Non-obvious design decisions:** **the icon reads no application state at all** — a test renders it with every hook replaced by a function that throws (`:151` in `browser-plugin.client.spec.tsx`).
- **Edge cases:** none — the sidebar owns the button, the label and the selected state.
- **Surprising:** the file is 28 lines and exists to make that "reads nothing" property *testable*.

### `packages/client/ui-plugin-manager/src/client/sanitize-install-input.ts`
- **Purpose:** classifies a user-typed install spec into something safe to send to analytics (15 lines).
- **Key abstractions:** `sanitizeInstallInput(spec)`.
- **Data flow:** the analytics event carries the *classified* value, never the raw spec (`manager-store.ts:961-962`, `:1124`).
- **Non-obvious design decisions:**
  - **Only a registry name and a plain version survive verbatim** (`:9`); a git URL becomes `'[git]'`, any other URL `'[url]'`, everything else `'[path-or-other]'` (`:10-12`).
  - **The classification is by SHAPE, not by content** — a path that looks like a package name is not a package name, because the regex demands a name followed by an optional `@version` (`:9`).
- **Edge cases:** `C:\Users\...` and `/Users/...` both become `'[path-or-other]'`; `plugin@https://…` is `[path-or-other]`, not `[url]`, because the scheme is not at the start.
- **Surprising:** the test asserts the token never appears anywhere in the recorded analytics calls (`manager-store.client.spec.ts:1735-1743`) — the check is on the *serialized event log*, not on one field.

### `packages/client/ui-plugin-manager/src/client/PluginManagerPage.module.css`
- **Purpose:** the page's styles (1544 lines).
- **Key abstractions:** CSS-module class names consumed as `css.x`.
- **Data flow:** plain CSS modules; every colour is a `--dsw-alias-*` token.
- **Non-obvious design decisions:**
  - **The card title is a button that stretches over the whole card** via `::after { position:absolute; inset:0 }`, while the card's end controls sit at `z-index:1` (`:294-320`) — so the entire card is clickable and the switch still gets its own click.
  - **The highlight is a CSS animation with a `prefers-reduced-motion` fallback that keeps a static ring** (`:174-196`).
  - **The registry panel is `position: fixed` with a z-index of 1100 and an opaque layer** (`:789-810`) so it can float over the modal.
  - **The page owns the macOS window-drag strip**: the 28 px top inset lives on the head row, and the `data-window-drag` attribute is on that row only (`:11-40`).
  - **The skeleton reuses the real card's metrics** (`.skeletonText { height: 1lh }`, `:277-289`) so the first read does not shift the layout.
- **Edge cases:** `.toolbar[hidden] { display:none }` (`:1466`) overrides the flex rule; reduced-motion is honoured in three places.
- **Surprising:** the CSS carries a whole essay of *why* comments — the "window drag strip", the "hover surface reaches 8px past the content", the "l2 thumb" contract — a level of intent-documentation that is itself worth stealing.

### `packages/client/ui-plugin-manager/src/client/assets.d.ts`
- **Purpose:** declares `*.svg` as a `string` module so the illustrations can be imported by URL (5 lines).
- **Key abstractions:** the ambient module declaration.
- **Data flow:** the page imports four SVGs and embeds them in the client bundle.
- **Non-obvious design decisions:** the SVGs are **embedded in the bundle**, not served as files, so the page works offline (the README says the on-demand Official cards are "visible offline before installation").
- **Edge cases:** none.
- **Surprising:** four illustrations ship in **two languages each** (640×300 SVG per language, both required) with no declaration interface — the page holds a hardcoded `BUNDLE_PREVIEWS` map (`PluginManagerPage.tsx:189-192`).

### `packages/client/ui-plugin-manager/src/css-modules.d.ts`
- **Purpose:** ambient declarations for `*.module.css` and `*.css` (6 lines).
- **Key abstractions:** `declare module '*.module.css' { const classes: Record<string,string>; export default classes }`.
- **Data flow:** lets the TS build type-check `css.foo` without a CSS loader in the type graph.
- **Non-obvious design decisions:** the class map is `Record<string, string>`, so a **typo in a class name is a type error but not a build error** (the key is still a string) — the class is simply `undefined` at runtime.
- **Edge cases:** none.
- **Surprising:** this tiny file is duplicated verbatim in the market package — a small piece of copy-paste that keeps each package independently buildable.

### `packages/client/ui-plugin-manager/src/index.ts` (Host half)
- **Purpose:** the Host-side `pluginRegistryProbe` service — races npm and the mainland mirror and reports the faster one (110 lines).
- **Key abstractions:** `PluginRegistryProbe extends TypertRemoteService`, `Config {registryProbeEnabled, registryProbeTimeoutMs, registryProbeCacheTtlMs}`, `@Remote fastest(): Promise<string|null>`.
- **Data flow:** two parallel `fetch` GETs to `/-/ping` through the Host's fetch proxy; `Promise.any` picks the first 2xx (`:73`); the loser is aborted; **both response bodies are discarded and the cleanup is awaited before the result is returned** (`:74-82`).
- **Non-obvious design decisions:**
  - **Concurrent readers share one probe** (`:59`) — `this.pending ??= this.probe()`.
  - **An unavailable result is cached too** (`:85`), for the same TTL as a winner — so a machine with no route to either registry does not re-probe on every dialog open.
  - **Redirects are refused** (`redirect: 'error'`, `:70`) — a registry that redirects is not the registry it claims.
  - **The deadline covers the cleanup**, not just the response: `AbortSignal.any([lifetime, finished, timeout])` (`:64`).
  - **The service aborts and awaits its pending probe on unload** (`:38-41`); a call after unload **rejects** rather than returning null.
- **Edge cases:** a body whose `cancel()` rejects does not fail the probe (`:112` in the test) — the success is kept.
- **Surprising:** the probe measures **ping latency, not download throughput** — the README says so explicitly ("Ping response time does not measure package-download throughput").

### `packages/client/ui-plugin-manager/tsdown.config.ts`
- **Purpose:** the bundler entry point (2 lines).
- **Key abstractions:** `clientBundle(import.meta.dirname, ['lib/types/index.js'], { hostPhase: true })`.
- **Data flow:** tsdown produces `lib/index.js` (Host) and `lib/client.js` (browser).
- **Non-obvious design decisions:** **`hostPhase: true`** — one package builds two runtimes (Host + browser) from one source tree, which is why `src/index.ts` and `src/client/` are separate tsconfig projects.
- **Edge cases:** none.
- **Surprising:** the same two-line file is the whole build configuration for a package with a Host service, a browser plugin and a Remote protocol.

### `packages/client/ui-plugin-market/src/client/market-store.ts`
- **Purpose:** Discover's state — configured index sources, the selected index's query and loaded pages, and source editing (305 lines).
- **Key abstractions:** `DiscoverController`, `DiscoverState`, `ListingState`, `DiscoverFace`, `ListingFailure = 'fetch'|'invalid'|'changed'`, `SourceFailure`, `PAGE_SIZE = 50` (`:25`), `MAX_PAGE = 100` (`:86`).
- **Data flow:** `loadIndexes()` → `remote.pluginMarket.listIndexes()`; `load(url, query, count, refresh)` → repeated `remote.pluginMarket.search(...)` pages, appending entries until `count` is reached or `nextOffset` is null.
- **Non-obvious design decisions:**
  - **`ListingState` keeps `query` and `answered` separately** (`:30-33`): `query` is what was asked, `answered` is the query the shown `value` answers. The empty-state wording therefore follows the **shown results**, not the query in flight (`:236`, and `DiscoverSection.tsx:529`).
  - **The document identity is `fetchedAt`.** Later pages send the first page's `fetchedAt`; if the Host answers from a replaced document the list **reloads once**, and a second replacement **fails** the read as `'changed'` (`:213-225`).
  - **A failed page keeps the entries already shown** (`:205-208`): `value` is carried across the failure, and the status becomes `'error'` with a `failure` — so a failed "Show more" leaves the first 50 entries on screen.
  - **An undeclared filter or sort key leaves the query** (`declaredQuery`, `presentation.ts:29`) and the read is redone — the index no longer declaring a filter must not leave a ghost chip in the toolbar.
  - **A change to the profile's bundles re-reads every loaded page** (`:170-176`) to refresh installation status, restarting once on a replaced document.
  - **A superseded read is dropped by a read counter** (`listingRead`/`indexRead`, `:118-120`).
- **Edge cases:** no selection → `refresh`/`search`/`more` do nothing (`:243`); an empty source list clears the listing; a source URL that is a duplicate / invalid / unsavable maps to a distinct `SourceFailure` (`:97-102`).
- **Surprising:** `load()` pages with `limit = min(count - offset, MAX_PAGE)` — a 50-entry request becomes **two Host calls** (`limit 100` then `limit 50`), and the test suite pins that exact split (`market-store.client.spec.ts:257-266`).

### `packages/client/ui-plugin-market/src/client/DiscoverSection.tsx`
- **Purpose:** the Discover tab — market menu, search, filters, sort, entry list, entry page, source dialog, install confirmation (598 lines).
- **Key abstractions:** `DiscoverSection`, `Browser` (`:404`), `EntryCard` (`:125`), `EntryDetail` (`:195`), `VersionRow` (`:161`), `SourcesDialog` (`:272`), `ConfirmDialog` (`:323`), `MarketIcon` (`:48`).
- **Data flow:** the controller publishes `DiscoverState`; the component keeps only the *unsent* search text, the opened entry and the confirmation as local state (README, *Understand the implementation*).
- **Non-obvious design decisions:**
  - **Search is debounced at 250 ms** (`TEXT_DELAY_MS`, `:26`) and the *sort* is derived from the text: typing switches "Default order" to "Best match" and clearing it switches back (`presentation.ts:20`).
  - **Declarations are ordered by localized title with `Intl.Collator` in the active UI language** (`presentation.ts:52`) — the language comes from the locale snapshot, not the browser.
  - **The empty-state wording distinguishes "this index lists no plugins" from "no plugins match"** by looking at the **answered** query (`:529`).
  - **Remote icons are lazy and carry `referrerPolicy="no-referrer"`** (`:50`) — the README is explicit that a browser-fetched icon discloses the user's IP to the image host.
  - **An incompatible version's Install button is `aria-disabled`, not removed** (`:100-107`) — the tooltip says why.
  - **An *exempted* incompatibility is installable** (`installable()`, `:80`) — a user-set compatibility exemption is honoured.
- **Edge cases:** an opened entry stays on screen when a reload no longer includes it (`:493`); a bundle DSH *provides* offers no version install at all (`:176`).
- **Surprising:** the install confirmation names the **source facts** (package, registry, repository, commit, directory) *before* the install, so the user can check the origin — the same trust posture the manager's install guide takes.

### `packages/client/ui-plugin-market/src/client/presentation.ts`
- **Purpose:** pure query and display helpers over market search results (137 lines).
- **Key abstractions:** `DiscoverQuery`, `INITIAL_QUERY` (`:17`), `withText` (`:26`), `declaredQuery` (`:35`), `displayDeclarations` (`:60`), `presentedVersion` (`:76`), `sourceFacts` (`:88`), `indexLabel` (`:112`).
- **Data flow:** pure functions over the Host's `MarketSearchResult`.
- **Non-obvious design decisions:**
  - **`withText` is a state machine on the sort key, not just a setter**: blank→words switches index order to relevance; words→blank switches back; **an order chosen while text was present stays** (`:26-33`).
  - **`presentedVersion` falls back to the highest version when the default is incompatible** (`:81`).
  - **`sourceFacts` names the full commit**, not a short SHA — the user is asked to verify an origin.
- **Edge cases:** a market URL the browser cannot parse is shown as written (`:118`).
- **Surprising:** `declaredQuery` returns the **same object reference** when nothing changed (`:43`) so the caller can compare by identity — a cheap, deliberate no-op signal.

### `packages/client/ui-plugin-market/src/client/locales.ts`
- **Purpose:** the Discover tab's dictionary (~110 keys, Chinese first).
- **Key abstractions:** `zh` (key source), `en` (`satisfies Record<PluginMarketLocaleKey, string>`), `PluginMarketLocaleKey`.
- **Data flow:** `ctx.locale.register('pluginMarket', {zh, en})`.
- **Non-obvious design decisions:** **the trust notice is copy, not chrome** — `sourcesTrust`: "Indexes come from third parties. Add only sources you trust: their plugins run with your permissions once installed." and `installTrust` repeats it at the point of installation.
- **Edge cases:** none.
- **Surprising:** the same sentence is written twice, in two places, because the two moments of risk are different.

### `packages/client/ui-plugin-market/src/client/index.ts`
- **Purpose:** the Discover tab's browser registration (79 lines).
- **Key abstractions:** `apply(ctx)`, `inject = ['slots','locale','remote','remote.pluginMarket']`, `NS = 'pluginMarket'`.
- **Data flow:** registers the dictionary, creates the controller, and subscribes to three invalidations: `plugin-market/changed` → `sourcesChanged()`, `plugin-manager/changed` → `bundlesChanged()`, `connection/reset` → `sourcesChanged()` (`:40-49`).
- **Non-obvious design decisions:** **the tab contributes through the manager's own slot** (`ctx.slots.inject('plugins.tab', ...)`, `:70`) — the market package does not know anything about the manager's internals, only the slot contract.
- **Edge cases:** the controller is disposed with the fiber (`:39`).
- **Surprising:** the tab's `install` owner prop is the *manager's* `installFrom` — the market hands a confirmed version back to the manager's dialog, which is why the market never implements an install itself.

### `packages/client/ui-plugin-market/src/client/DiscoverSection.module.css`
- **Purpose:** Discover's styles (436 lines).
- **Key abstractions:** CSS-module class names.
- **Data flow:** plain CSS modules, same `--dsw-alias-*` token vocabulary.
- **Non-obvious design decisions:** the same "title button covers the whole card, the action sits above it" pattern as the manager (`:139-165`); the empty state is padded 64 px and centred (`:183-194`).
- **Edge cases:** reduced-motion honoured for the skeleton (`:378`).
- **Surprising:** the card metrics deliberately match the Installed tab's, and the file says so in its first comment.

### `packages/client/ui-plugin-market/src/css-modules.d.ts`
- **Purpose:** the same ambient CSS-module declaration as the manager's (6 lines).
- **Key abstractions:** `declare module '*.module.css'`.
- **Data flow:** type-level only.
- **Non-obvious design decisions:** none beyond the copy.
- **Edge cases:** none.
- **Surprising:** duplicated verbatim — see the manager's entry.

### `packages/client/ui-plugin-market/src/index.ts`
- **Purpose:** the Host half — deliberately empty (4 lines).
- **Key abstractions:** `apply(): void {}`.
- **Data flow:** none.
- **Non-obvious design decisions:** **the `pluginMarket` service is composed by its own bundle row**, not by this package; the file exists only so the package has a Host entry point.
- **Edge cases:** none.
- **Surprising:** a package whose Host half is a no-op, pinned by a test that asserts it does not throw (`node-plugin.client.spec.ts`).

### `packages/client/ui-plugin-market/tsdown.config.ts`
- **Purpose:** the bundler entry point (2 lines).
- **Key abstractions:** `clientBundle(import.meta.dirname, ['lib/types/index.js'])` — note: **no `hostPhase`**, because the Host half is empty.
- **Data flow:** tsdown produces `lib/index.js` and `lib/client.js`.
- **Non-obvious design decisions:** the same builder helper as the manager, with one option omitted.
- **Edge cases:** none.
- **Surprising:** the difference between the two packages' build configs is a single flag.

---

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-plugin-manager/README.md` | The package's behaviour contract in English. Decides: the install wizard's phases, the registry-choice memory, the 400 ms spinner minimum, the 1500 ms probe deadline, the 5-minute probe cache, the "install scripts need permission" approval (saved in the profile's `pnpm-workspace.yaml`), the pnpm `minimumReleaseAge` explanation, the GitHub→npmmirror recovery, and an explicit **Known Limitations** list (no version picker, one install at a time, rows show a phase but not a reason, a browser refresh loses the tracked request). Also declares "Model Experience: None". |
| `packages/client/ui-plugin-manager/README.zh.md` | The Chinese mirror of the above; the same decisions, with the extra sentence that "installed bundles carry no uninstall action" and that the *More* list's Codex/Claude Code subagents stay last. |
| `packages/client/ui-plugin-market/README.md` | The Discover tab's contract: the 250 ms search debounce, fuzzy multi-language matching, all-labels-must-match filtering, the "Best match / Default order / Publish date / declared sort key" sort menu, the 50-entry paging, the `fetchedAt` document identity and the one-restart rule, and its own **Known Limitations** ("No upgrade action", "Remote icons disclose the user's IP address"). |
| `packages/client/ui-plugin-market/README.zh.md` | The Chinese mirror; same decisions. |
| `packages/client/ui-plugin-manager/README.i18n.yaml` | Machine-generated bilingual-pairing hash ledger: one hash per heading section for the English and Chinese READMEs, re-recorded by `pnpm run verify-translation-pairing --write`. Guarantees the two documents cannot drift section-by-section. |
| `packages/client/ui-plugin-market/README.i18n.yaml` | The same hash ledger for the market README pair. |
| `packages/client/ui-plugin-manager/locale/en.json` | The package's locale metadata (`meta.title` = "ui-plugin-manager") for the package registry. |
| `packages/client/ui-plugin-manager/locale/zh.json` | The same, in Chinese, plus a description. |
| `packages/client/ui-plugin-market/package.json` | The market package's manifest: `dsh.client.inject` lists `api-remotes`, `client-locale`, `client-ui-plugin-manager`; the `./client` export subpath; the `files` list is short because the Host half is empty. |
| `packages/client/ui-plugin-manager/package.json` | The manager's manifest: the `dsh` block declares **four injected client services**, the `exports` map publishes `./client`, `./src/*`, `./typert`, `./remote` and `./locale/*.json`, and `devDependencies` name the whole client stack (slots, sidebar, layout, settings, product-analytics, crypto, timeouts). |
| `packages/client/ui-plugin-manager/tsconfig.json` | A solution file: `files: []` plus references to the Host and client projects. |
| `packages/client/ui-plugin-manager/tsconfig.host.json` | The Host project's config: `files: ["src/index.ts"]` — the Host half is one file, and it is the only file type-checked there. |
| `packages/client/ui-plugin-manager/tsconfig.client.json` | The browser project's config: `include: ["src/client", "src/css-modules.d.ts"]` plus 15 project references — every client dependency is a separate TS project, so a broken reference fails the build. |
| `packages/client/ui-plugin-market/tsconfig.json` | The market's single project: `include: ["src"]`, with references to `boot/plugin-market`, `util/plugin-market-index` and `ui-plugin-manager`. |
| `packages/client/ui-plugin-manager/tests/browser-plugin.client.spec.tsx` | The registration's contract: navigation reset on leaving the panel, the refresh toast **shared between the page and the shell overlay** and surviving navigation, the `inject` list asserted exactly, the sidebar icon that reads no state, the slot specs, the locale-following `resolveText`, "a Host change before the first render is not a reason to read", and that install output folds into an open run only. |
| `packages/client/ui-plugin-manager/tests/manager-store.client.spec.ts` | The store's whole contract, ~120 cases: the coalesced read, the cached-vs-uncached refresh distinction, the 400 ms spinner hold, the `stop-profile`/`overridden`/`restart-required` outcomes, the full cancellation/recovery matrix (`too-late` / `not-running` / `offline` / lost install reply / lost cancel reply / acceptance), the registry reconciliation rules, the GitHub→mirror recovery, the analytics redaction, and the "late settlements after disposal are dropped" property. |
| `packages/client/ui-plugin-manager/tests/components.client.spec.tsx` | The page's rendered contract: the tab set, the add-plugin menu, the skeleton, the refresh toast vs the inline error, the card/detail/official grouping, the row filter above ten rows, the configuration pages, the detail contributions, the **IME Enter handling** for both inputs, every install refusal sentence, the registry panel's keyboard behaviour, the highlight/scroll, the uninstall confirmation, every toast wording in both languages, and the on-demand Official bundle lifecycle. |
| `packages/client/ui-plugin-manager/tests/config-ledger.client.spec.ts` | The projection's contract: the items in ledger order with locale-following labels, the bundle/row key sets, **the snapshot stays identical until a ledger or the locale moves**, and every subscription is released. |
| `packages/client/ui-plugin-manager/tests/registry-probe.host.spec.ts` | The probe's contract: concurrent readers share one probe, the first 2xx wins, the loser is aborted, both bodies are cancelled, an unavailable result is cached, a timeout and a dispose both settle the pending probes, the winner is chosen by arrival and the body cleanup is awaited before settling, and invalid probe limits are rejected by the schema. |
| `packages/client/ui-plugin-manager/tests/sanitize-install-input.client.spec.ts` | The redaction contract: registry identifiers survive; git URLs, authenticated URLs, local paths and `plugin@https://…` are all classified. |
| `packages/client/ui-plugin-market/tests/browser-plugin.client.spec.ts` | The tab's registration contract: it contributes a `discover` entry to `plugins.tab` with a locale-resolved label, a Host change or a connection reset **before the first render does not trigger a read**, a change after the first render does, and the registration disappears with its fiber. |
| `packages/client/ui-plugin-market/tests/discover.client.spec.tsx` | The tab's rendered contract: the skeleton, the empty state, the one-action-per-card rule, the install confirmation (spec, registry, author, trust notice), the incompatible-vs-exempted difference, the 250 ms debounce and the relevance sort, the filters, every sort option and the direction toggle, the market menu, the entry page's source facts and links, the version list, the paging button, the failure wording for `fetch`/`invalid`/`changed`, and the source dialog's four refusals. |
| `packages/client/ui-plugin-market/tests/market-store.client.spec.ts` | The controller's contract: the first read selects the first index, a failed read keeps the last listing, a superseded read is ignored, an empty source list clears the listing, each source refusal is worded, a change before the first render does nothing, a disposal drops every late settlement, the `fetchedAt` document identity with the one-restart rule, the exact `limit 100 / limit 50` page split, and the "keeps the previous answer beside a failed new query" rule. |
| `packages/client/ui-plugin-market/tests/node-plugin.client.spec.ts` | The empty Host half registers nothing and does not throw. |
| `packages/client/ui-plugin-market/tests/presentation.client.spec.ts` | The pure helpers' contract: the collator ordering with a tie-break on id, the relevance/index sort coupling, the undeclared-id dropping (returning the same object when nothing changed), the default/highest version choice, the source facts for npm vs git, and the market label falling back from title to host to the URL as written. |

---

### Tier 3 — skipped with a reason

| File | Why it was not read line by line |
| --- | --- |
| `packages/client/ui-plugin-manager/src/client/assets/badge-skill-preview.svg` | Binary-shaped illustration asset (86 562 bytes, 22 lines of long SVG path data). Confirmed on disk: a 640×300 SVG with a `viewBox`, a `<clipPath id="canvas">` and vector paths — a feature-preview illustration for the "badge skill" bundle, English variant. Its twin `badge-skill-preview.zh.svg` is the Chinese variant. Read the first 7 lines only. |
| `packages/client/ui-plugin-manager/src/client/assets/badge-skill-preview.zh.svg` | Same asset, Chinese variant (69 193 bytes). Confirmed on disk: identical 640×300 canvas, different glyphs. Read the first 7 lines only. |
| `packages/client/ui-plugin-manager/src/client/assets/voice-input-preview.svg` | Illustration asset (96 075 bytes, 46 lines of long path data). Confirmed on disk: a 640×300 SVG mock of a voice-input panel (a waveform of rounded bars, a card, an arrow). Read the first 7 lines only. |
| `packages/client/ui-plugin-manager/src/client/assets/voice-input-preview.zh.svg` | Same asset, Chinese variant (53 832 bytes). Read the first 7 lines only. |

---

## 2. Ideas worth stealing

1. **A first-class "uncertain" outcome vocabulary for long-running work.** `InstallState.failure.uncertainty` is `'result' | 'cancellation' | 'acceptance'` (`manager-store.ts:254`) and each value gets its own sentence and its own recovery action — only a lost *result* offers "Check installation status" (`PluginManagerPage.tsx:1419`), while a pending *acceptance* offers nothing but patience. **Why it transfers:** August Trading's provider calls, automation runs and trade captures all have a "we do not know whether it landed" state. Today that is an error string; it should be a named state with a named recovery, and it should never be reported as a failure or a success. `UNIQUE` to this repo within the three references.
2. **Keep the query and the answer apart, and word the screen from the answer.** `ListingState` carries `query` (asked) *and* `answered` (the query the shown results answer) (`market-store.ts:30-33`), and the empty-state copy is chosen from `answered` (`DiscoverSection.tsx:529`). **Why it transfers:** an August Trading list filtered by symbol/date/timeframe must keep saying "no results for *the filter you are looking at*" while a new filter loads or after it fails — never "no results" for a filter the user has not seen applied. `UNIQUE` here.
3. **A closed union of refusal codes that the UI must word, with the Host's diagnostic shown verbatim for the one code that has none.** `CODE_KEYS` is `satisfies Record<ManagementError['code'], PluginManagerLocaleKey>` (`presentation.ts:56-73`), so a new Host code is a **compile error** until the app words it. **Why it transfers:** August Trading's provider errors, schema rejections and trade-plan refusals should be a closed union with one sentence each, and a code with no sentence must show the server's own text rather than a generic "something went wrong". `CONVERGENT` — the same discipline appears in `pi`/`hermes-agent`-style provider error mapping.
4. **Cache-and-toast instead of cache-and-error.** A failed refresh keeps the cached cards and shows a toast that **survives leaving the page**, because the toast is registered into `shell.overlay` rather than into the page (`index.ts:101-110`, `PluginRefreshToast.tsx`). **Why it transfers:** August Trading's provider list / model list / automation list should never blank out on a transient network failure; the failure should be a notice that outlives the screen. `UNIQUE`.
5. **Classify user input before it reaches telemetry — by shape, not by content.** `sanitizeInstallInput` (`sanitize-install-input.ts:8-14`) keeps only a registry name and a plain version; everything else becomes `[git]`, `[url]` or `[path-or-other]`. The test asserts the secret never appears anywhere in the serialized event log (`manager-store.client.spec.ts:1735-1743`). **Why it transfers:** August Trading sends prompts, file paths, ticker/venue ids and broker references to model providers and possibly to analytics; a shape-classifier is a cheap, testable guarantee. `UNIQUE`.
6. **A slot contract so the page never names a plugin.** Nine declared slots, keyed config slots, and a `subject` type that gives a contribution *facts* and never the page's state (`slot-contract.ts:118-200`). **Why it transfers:** August Trading's "Agents desk", "Learning" surfaces and "Settings" could each declare their own extension points instead of the app hardcoding a list of known features. `UNIQUE` in this form; `pi` converges on the same idea via a plugin registry.
7. **A bounded, shared, cached endpoint probe that awaits its own cleanup.** `PluginRegistryProbe.fastest()` shares one pending probe, caches *unavailable* results too, refuses redirects, aborts the loser, and awaits the response-body cancellation before it returns (`src/index.ts:51-95`). **Why it transfers:** August Trading's provider-endpoint health check (and the "which broker API is fastest" question) gets the same shape. `UNIQUE`.
8. **A minimum spinner duration so a fast read does not flash it** (`REFRESH_SPINNER_MIN_MS = 400`, `manager-store.ts:130`, `:850`) — plus the rule that only a *manual* refresh shows a spinner while a background read stays silent. **Why it transfers:** August Trading's provider/quote refreshes get the same rule. `CONVERGENT` — the same "don't flash a spinner" rule appears in the other references' UI layers.
9. **"The result depends on which endpoint answered — so only explain it when one endpoint was asked."** The `installDoneOtherVersion` explanation is shown **only** when exactly one registry was asked, because a fallback registry can serve a different release than the one inspected (`PluginManagerPage.tsx:1398-1409`). **Why it transfers:** if August Trading ever explains a price/plan difference, it must only do so when one source was actually consulted. `UNIQUE`.
10. **A document-identity check for paged reads.** The market sends the first page's `fetchedAt` with every later page; a changed document restarts the read once and a second change fails it as `'changed'` (`market-store.ts:213-225`). **Why it transfers:** a paged trade list or a paged backtest result set that changes underneath the reader needs the same "one restart, then fail loudly" rule. `UNIQUE`.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work: not in this shard.** The package manages plugins, not schedules. The transferable part is the *invalidation* pattern: the page re-reads the Host on a Host event, on a connection reset, and after every action — and a change that arrives **before the first render is deliberately ignored** so the page does not read twice (`index.ts:93-99`, `browser-plugin.client.spec.tsx:196-203`). August Trading's automation list would want the same "re-read on `connection/reset`, not on a timer" discipline.
- **Human-in-the-loop approval: yes, and the approval record lives where it is acted on.** Two approvals appear: the uninstall confirmation (`ConfirmDialog`, `PluginManagerPage.tsx:1503`) and the **install-script approval**, where a blocked pnpm run lists the packages whose scripts are pending and offers "Allow these scripts and retry" (`PluginManagerPage.tsx:1381-1395`). The permission itself is saved by the **Host in the profile's `pnpm-workspace.yaml`**, not in the UI, and the UI names the consequence ("the scripts run here with your permissions, and the permission is saved in this profile"). *Transfer:* an August Trading approval (e.g. "allow the model to place this order") should be persisted by the thing that performs the action, so the audit trail and the permission cannot disagree.
- **Post-mortem / reflection loops: not in this shard.** The nearest analogue is the *settlement record* of an install: one record per pnpm run carrying `jobId`, the command line, the cwd, the interleaved stdout/stderr and the exit code (`InstallRun`, `manager-store.ts:178-196`), grouped by job id in `appendLog` (`:799-816`). That is the shape a trade-log record wants: an id, the exact command, the working directory, the raw output and the exit code.
- **Multi-agent: not in this shard.** The one multi-party pattern is the **slot contract** — a third-party plugin contributes content to a page it does not own, and the page never names it (`slot-contract.ts:1-18`). That is the "extension point" half of multi-agent design; the "subagent vs debate" question belongs to another shard.
- **Structured logs the model can query: partially.** The client keeps only the *in-flight* install's runs in memory; the durable log is the Host's `logPath` (`packageResult.logPath`, `manager-store.ts:235-248`). There is no queryable store in this shard — August Trading's SQLite trade journal is strictly better than anything here.
- **Staying simple as features accumulate: yes, and it is written down.** Both READMEs carry an explicit **Known Limitations and Deferred Work** section naming what was deliberately *not* built: no version picker, no upgrade action in Discover, one install at a time, rows show a phase but not a reason, "a successful installation does not certify that a module can activate", and "the Host inventory remains complete; the Settings Plugins section's Plugin list tab inspects their plugins" — i.e. **the management page deliberately shows less than the Host knows**. The section is also duplicated inside the Chinese README, and a `README.i18n.yaml` hash ledger enforces that the two copies stay section-for-section identical. *Transfer:* August Trading's feature creep guard should be a written non-goals list, updated when a feature is deferred, not just an absence.

---

## 4. Non-obvious decisions and gotchas

1. **`null` is a registry.** `registry: null` means "the registry pnpm's own configuration names", not "no registry". `RegistryChoice` is a union with `kind` (`manager-store.ts:122-127`). Any code that treats `null` as "unset" will break the whole registry feature.
2. **The UI must not name a registry the Host has not read.** Until the Host resolves pnpm's configuration, the entry reads as the *neutral* "default registry"; only then is it "npm's own registry" (`presentation.ts:29-40`). The label never claims npm's own for a mirror.
3. **A registry URL that does not parse compares AS WRITTEN** (`registryKey`, `manager-store.ts:139-153`), so a remembered-but-invalid address still stands for itself instead of colliding with another entry.
4. **`offeredRegistries` lists pnpm's own configuration last and de-duplicates by comparison key** (`manager-store.ts:156-167`) — the same registry never appears twice in the picker, even when the Host's configured registry and pnpm's resolved one are the same host.
5. **A remembered registry the Host no longer offers is KEPT as a typed one** (`reconciled`, `manager-store.ts:511-519`) — the user's earlier choice is not silently dropped.
6. **`rowConfigKey(bundle, rowId)` is `${bundle}#${rowId}`** (`config-ledger.ts:36-38`) — a bundle-level key and a row-level key can never collide in the same keyed slot.
7. **A slot's label is a thunk resolved at read time**, and the projection only re-reads it when the **locale revision** moves (`config-ledger.ts:53-60`, `tab-ledger.ts:24-33`). Reading a label is not free, and the code says so.
8. **The install's `approvedBuilds` are per-profile and persisted by the Host**, so the retry carries `approvedBuilds` to the Host and the Host writes the permission before re-running pnpm (`manager-store.ts:1120-1131`).
9. **The pnpm `minimumReleaseAge` explanation is only shown for a single-registry run** (`PluginManagerPage.tsx:1398-1409`) — with a fallback registry the installed version may legitimately differ from the inspected one, so the explanation would be a lie.
10. **The GitHub→npmmirror recovery returns to an EMPTY package-name field, not to the failed URL** (`githubRecoveryRegistry`, `manager-store.ts:277-286`; `useGithubMirror`, `:645-659`) — the mirror serves registry packages, not the GitHub repository.
11. **When the install already asks the mirror, the button reads "Try another way" instead of "Use mirror"** (`asksMirror`, `manager-store.ts:292-295`) — the same action must not be offered as if it would change something.
12. **A late log chunk can create a run the dialog never saw, but only while the install is pending** (`appendLog`, `manager-store.ts:799-816`); after the run settles, a stray chunk is dropped — and a trailing *final* chunk for a known run still updates it.
13. **`update` is remove-then-install**, and the two failure modes differ: a removal that fails with `stop-profile` still lets the install proceed (the running bundle stays and the new one waits for a restart), while any other removal failure abandons the update (`:665-687`).
14. **A refusal to enable a freshly installed bundle still CLOSES the dialog** and merely toasts — the list then shows what did not switch on (`:1207-1228`).
15. **The list is sorted by the SHORT name**, not the package name, so a scoped `@deepseek-ai/dsh-…` package sorts where a person expects (`shortName`, `presentation.ts:110-117`; `sortPackages`, `manager-store.ts:486-488`).
16. **The page excludes built-in profile bundles from its cards even when the Host reports an error for them** — the Host's inventory stays complete and is inspected elsewhere (`PluginManagerPage.tsx:1615-1617`).
17. **The "More" list is not a tab panel.** It replaces the Installed groups entirely, and the page's own refresh/add buttons are hidden while a contributed tab is selected (`PluginManagerPage.tsx:1700-1730`).
18. **A contributed tab that leaves the ledger falls back to "Installed" and STAYS there when it returns** (`PluginManagerPage.tsx:1607-1610`) — the fallback is sticky, not a transient.
19. **The refresh toast is keyed by `notice.seq`** (`PluginRefreshToast.tsx:28`), so a second failure is a new toast with a new lifetime rather than a re-render of the old one.
20. **The toast's hold time scales with the text** (`toastHoldMs`, `PluginManagerPage.tsx:195-197`): `min(8000, max(3000, len*80))` ms — long enough to read a failure that names what broke.

---

## 5. Weak spots

1. **`manager-store.ts` is a 1308-line controller that does six jobs.** Inventory reads, install orchestration, cancellation/recovery, registry reconciliation, analytics and UI-facing text selection all live in one class. The cancellation/recovery machine alone is four interacting flags (`acknowledged`, `replyLost`, `recovering`, `cancellation.waitingForStart`, `manager-store.ts:541-548`) whose correct behaviour is only legible by reading the ~20 surrounding tests. It is the most valuable *and* the most fragile part of the shard.
2. **The "refresh" semantics are over-fine.** `refreshStatus` has three values, and whether a failure becomes a **toast** or an **inline error** depends on whether there was cached inventory (`settleRefresh`, `manager-store.ts:857-863`). The test suite pins at least eight distinct combinations of that rule (`manager-store.client.spec.ts:265-460`). A simpler rule ("never blank the list; always toast") would be far cheaper to maintain.
3. **The Discover pagination is fragile and its exact wire shape is pinned by tests.** A 50-entry request becomes two Host calls with different `limit` values (100 then 50) because of `MAX_PAGE = 100` versus `PAGE_SIZE = 50` (`market-store.ts:25`, `:86`, `:216-222`), and the test asserts the exact `[[0,100],[100,50]]` sequence (`market-store.client.spec.ts:257-266`). The `fetchedAt` document identity plus the "restart once, then fail as `changed`" rule compounds it.
4. **The page file is 1815 lines of one React module** with ~20 local components, and three **hardcoded package-name lists** (`BUILTIN_PROFILE_BUNDLES`, `EXTENSION_BUNDLES`, `MORE_BUNDLES`, `PluginManagerPage.tsx:115-140`) that decide the page's grouping. Those lists will rot as packages come and go, and the "More" list's ordering rule (`optionalBundleRank`, `:143-150`) is pure ceremony around them.
5. **The bilingual duplication is expensive.** A 31 KB English README is mirrored by a 28 KB Chinese one, and a **generated hash ledger** (`README.i18n.yaml`) plus a `verify-translation-pairing` script exist only to stop the two copies drifting. That is a real maintenance tax for a repo that ships two languages; a single-language app should not copy it.
6. **The "known limitations" are honest but numerous**: a browser refresh loses the tracked install request and its output (`README.md`, *Known Limitations*), one install at a time, no version picker, and "a successful installation does not certify that a module can activate". The last one is the right kind of warning and the other three are the cost of the design.
