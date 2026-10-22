# deepseek-harness :: dsh-bundle-boot-remote

**Files in shard:** 397 (read: 357, skipped with reason: 40 — 27 `generated-vendored` bilingual hash ledgers, and 13 large source files read at the head only; both groups are named in §1 "Tier 3")
**What this shard covers:** the *boot* and *bundle* half of the DeepSeek Harness monorepo plus the remote/PTY runtimes it sits on. Five families: (a) `packages/boot/*` — how a DSH profile boots (environment layers, patch composition, compatibility preflight, module resolution interception, JSON-Schema projection of plugin config, hot reload, config editor, plugin manager, plugin market); (b) `packages/bundle/*` — the shipped profile compositions (base, web-app, headless, acp-app, sdk-app, sdk-minimal); (c) `packages/ptc-runtime/*` — the program-execution capability (per-call processes, a retained REPL, a JSON wire, an output ledger); (d) `packages/ssh/*` — five SSH execution providers plus their helper runtime; (e) `packages/telemetry/otel` and `packages/workspace/workspace` — a structured event/session log and the workspace record store.

Everything here is *infrastructure around the agent*, not the agent loop itself: what gets loaded, from where, under what compatibility and failure policy, and how a long-lived process survives edits and crashes.

**How to read the entries.** For the 13 files marked "head read" in §1 "Tier 3", the *module head* (its declared contract, its exported surface and its error vocabulary) was read, and every claim made about them in §1 and §2 comes from that head, from the package README, or from the test names that pin them — never from an assumed body. Everything else was read in full.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/boot/app-boot/src/index.ts`
- **Purpose:** The shared boot glue for every `dsh` profile launcher: env layering, fail-loud guards, patch parsing, config dump, root-Include mounting, activation auditing and the `boot()` entry point.
- **Key abstractions:** `boot(binName, absConfigPath, patches?, prepare?, bareModuleBaseUrl?)`; `installFailLoud(binName, proc?, release?)`; `auditStartupEntries(ctx, binName, warn?)`; `recomposeProfile(ctx, patches, binName, options)` / `reconcileProfilePatches(ctx, patches, binName, requiredIds?)`; `loadLayeredEnv`; `loadOptionalPatches` / `loadOverlayPatches`; `renderConfigDump`; `mountRootInclude`; `resolveConfigPath`; `StartupError`.
- **Data flow:** `boot()` creates a Cordis `Context`, installs the Loader plugin, runs a host `prepare()` hook, mounts the root `cordis:include` entry, awaits `ctx.loader.await()`, then audits. A second, short-lived `diagnostics` Context is given the *same* logger so startup warnings/errors survive the root context's disposal (`index.ts:1208-1217`).
- **Non-obvious design decisions:**
  - The **bootstrap env allow/deny lists** (`index.ts:136-181`): a `.env` file may not set anything that decides *how the process starts* (`PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, `DSH_*`, `XDG_*`, …). The four proxy names are the single exception, and only from the Harness-home `.env` — because the invoking directory's `.env` arrives with a clone while the home file is the user's own (`index.ts:162-169`). **This is a genuinely reusable rule.**
  - **Both env layers are parsed and validated before either is applied** (`index.ts:244-253`): "a rejection must not leave one file applied". Accepted values never replace an inherited one — the snapshot records *which layer supplied each value*.
  - `installFailLoud` **never resumes the failed operation** (`index.ts:844-857`): "only the throw site knows which state is intact". The release hook (terminal hand-back) is awaited under a **referenced** 2 s timer so a never-settling disposer cannot let Node reach an empty event loop and exit 0 (`index.ts:842`, `index.ts:901-918`).
  - **One rejection checkpoint**: `inactiveEntries` retains the exact rejection reasons it folds into the boot diagnostic through the next process-rejection checkpoint, so `installFailLoud` coalesces the Loader's duplicate notification while unrelated rejections stay fatal (`index.ts:814-836`, `index.ts:1082`).
  - **Required-entry policy is a global id list**, not profile metadata (`index.ts:951-960`): `agent-loop`, `webserver`, `web-runtime`, `modules`, `connection`, `headless-runner`, `acp`, `sdk-jsonrpc-server`. Optional failures warn; required failures dispose the whole app.
  - **Two-stage failure labels**: `host preparation failed` vs `plugin tree failed to load` (`index.ts:1220-1231`) — a `prepare` hook that throws before any entry mounted is not a plugin problem.
  - `StartupError.entries` / `.startup` are **non-enumerable** (`index.ts:1018-1021`): full diagnostic reports keep them, ordinary error inspection omits them.
- **Edge cases & failure handling:** a surface that disposes the whole tree mid-startup makes `ctx.loader` undefined — `boot()` re-checks after settlement and returns instead of throwing a TypeError over an app that exited exactly as asked (`index.ts:1233-1239`). Cyclic `cause` chains terminate diagnostic traversal without replacing the original cause (`index.ts:1253-1258`). Disposal of the partial context happens in `catch`, and the collector is disposed in `finally`.
- **Surprising:** `renderConfigDump` re-implements the patch algorithm *exactly* as boot does (one flattened `applyEntryPatches` call), and derives per-row provenance by **diffing positionally** between successive snapshot compositions (`index.ts:667-697`) — because the patch algorithm only rewrites in place or appends, a top-level index identifies one row across snapshots.

#### `packages/boot/app-boot/src/profile.ts`
- **Purpose:** Profile discovery, initialization, bundle resolution and the immutable *runtime resolution* (the package table a profile launch installs into Node's resolvers).
- **Key abstractions:** `Profile`, `ProfileLayer`, `ProfileManifest`, `SkippedBundle`, `RuntimeResolution`, `RuntimeResolutionEntry`, `LinkedRoot`, `ProfileRuntimeResolution`; `loadProfile`, `loadProfileDirectory`, `initProfile`, `resolveBundleDir`, `composeEntries`, `createRuntimeResolution`, `removeLinkProjections`, `readProfileManifest`/`writeProfileManifest`.
- **Data flow:** `loadProfile` → resolve dir → auto-init a shipped template → `removeLinkProjections` → `normalizeShippedProfile` → `loadProfileDirectory` → for each `dsh.profile.bundles` entry resolve a directory (installation anchor first, profile second), read its `dsh.bundle.patch` files, parse each as a patch list → plus the profile's own `cordis.patch.yml`. `createRuntimeResolution` then BFS-walks the installation's dependency graph and the selected bundles' closures to produce a frozen table of `(name, packageDir, version, declarer, scope)`.
- **Non-obvious design decisions:**
  - **Two-anchor resolution** (`profile.ts:702-725`): a bundle resolves *first* from the dsh installation, then from the profile. This is the contract that `@deepseek-ai/dsh-base` always comes from the same installation as the running binary.
  - **BFS "first resolution wins"** (`profile.ts:403-404`): the visited set *is* the link map, matching Node's own nearest-wins dependency traversal.
  - **Peer dependencies participate** in the traversal (`profile.ts:407-410`): "Service Definition packages … are peers of their implementations, never plain dependencies, yet out-of-tree plugins import them directly."
  - **Retired bundles are removed from the stored list automatically** (`profile.ts:206-210`, `675-682`) and an exact installation-owned bundle tuple is normalized back to the shipped template (`profile.ts:659-669`) — migration is data, not code paths.
  - `ProfileRuntimeResolution` **remembers the inputs it was computed from** in a private `#source` field, so `computeLatestResolution()` can re-read the disk without retaining synthetic layers (`profile.ts:495-529`).
- **Edge cases & failure handling:** a bundle that cannot be resolved, has no `dsh.bundle`, is incompatible, or has a broken patch is **skipped and listed** in `skippedBundles` — the remaining bundles keep their order (`profile.ts:751-768`). Profile manifest and user-patch errors still throw. `removeLinkProjections` unlinks only symlinks whose target lies inside `.dsh-module-fallback/node_modules` (`profile.ts:293-301`).
- **Surprising:** `resolveProfileDir` rejects `node_modules` as a profile name because Node reserves it (`profile.ts:170-174`).

#### `packages/boot/app-boot/src/profile-resolution/resolver.ts`
- **Purpose:** Install one *runtime resolution* as an interception on Node's default ESM and CommonJS resolvers, so a profile's packages win over the installation's — without creating fallback symlinks.
- **Key abstractions:** `installRuntimeInterception(resolution): RuntimeInterception`; `RuntimeInterception.{packageDir, replace, dispose}`; `barePackageName(request)`; `ResolutionRestartRequired`; `registerWorkerResolution(resolution)`; internal `ResolutionRouter`, `MovedDirectories`, `ResolutionRoute` (`interception` | `native-after-interception` | `native`).
- **Data flow:** `ResolutionRouter` compiles the frozen resolution into a per-importer route table. `routeScoped`/`routeLinked` decide, per (importer, request), whether to answer natively, to answer from the *declaring manifest* of the interception entry, or to continue above the interception layer. ESM interception wraps `loader.resolveSync` (v2) or `loader.resolve`/`resolveSync` (v1); CJS interception wraps `Module._resolveFilename` with a synthetic `Module` whose `filename`/`paths` point at the routed anchor.
- **Non-obvious design decisions:**
  - **Node still owns exports, conditions, subpaths, caches and error codes** — the interception only changes *which anchor* the lookup runs from (`resolver.ts:1170-1182` in the README; code at `resolver.ts:869-899`).
  - **Routed failures report the ORIGINAL importer**: `throwWithImporter` rewrites the message and stack so the user sees their own file, not the synthetic anchor (`resolver.ts:791-799`). `throwWithoutCjsAnchor` strips the synthetic anchor out of Node's `requireStack` (`resolver.ts:801-822`).
  - **`MovedDirectories`** (`resolver.ts:408-457`): Node caches the *real path* of every link it resolved through and never refreshes it. When a link points elsewhere, a native lookup that selects a file below the previous target must select the same file below the current target. This is a class of bug that only a real-world package manager produces.
  - **`replace()` is a strict, ordered diff** (`resolver.ts:470-522`): profile-scoped mappings may be removed or changed in version/declarer; an installation mapping that changes version/declarer/directory, or a scope change, throws `ResolutionRestartRequired`. A *retained* profile mapping that moved to a different real directory is also a restart.
  - **Self-reference is detected structurally** (`resolver.ts:293-315`): a package whose manifest has `name` + `exports` answers for itself; the traversal stops at a `node_modules` boundary.
  - Peer-aware linked-root lookup: at each `D/node_modules` position, the *current* `D/package.json` peer names present in the runtime table use the runtime package; other names use the physical candidate (`resolver.ts:636-675`).
- **Edge cases & failure handling:** explicit CommonJS `paths` always retain native lookup (`resolver.ts:991`); `#imports` targets are resolved with `resolve.exports` and left to Node when they are relative or outside the profile scope (`resolver.ts:846-860`); `MODULE_NOT_FOUND` with an undefined `path` is treated as an *unselected package miss* and swallowed (`resolver.ts:385-388`); the ESM resolve hook is re-entrancy-guarded with a one-shot `delegatedEsm` marker (`resolver.ts:838-842`).
- **Surprising:** the whole file reaches into Node internals (`internal/modules/esm/loader`, `internal/modules/cjs/loader`, `internal/modules/helpers`) through the `node-addon-require-builtin` package, and *fails loudly* with `profile resolution: unsupported Node module loader` if any expected interface is missing (`resolver.ts:733-773`).

#### `packages/boot/app-boot/src/config-schema/collect.ts`
- **Purpose:** Discover declared plugin `Config` schemas **without mounting plugins or evaluating config expressions**, producing a JSON Schema document plus positioned diagnostics.
- **Key abstractions:** `collectConfigSchemas(profile, entries, resolution, diagnostics): Promise<ConfigSchemaDump>`; internal `walk`/`walkInclude`; `carrier()` resolving native `cordis:group` / `cordis:include` identities per tree base.
- **Data flow:** `walk(entries, baseUrl, prefix)` visits each row, validates it, imports the plugin module through the Loader, reads `plugin.Config` reflectively, and if it is a native Schemastery graph, records it as `entry.native`. Native carriers are descended into (`group` → child entry list; `include` → a literal YAML/JSON file). The result is handed to `buildConfigSchemaDocument`.
- **Non-obvious design decisions:**
  - **"Config expressions are not evaluated"** is enforced structurally: `entryList()` rejects a non-array, `includePatches()` rejects `!!js` nodes, `walkInclude` requires a literal `path` and a `.json/.yaml/.yml` extension (`collect.ts:104-167`).
  - **Malformed rows do not lose siblings** — each row is validated in isolation and a bad row becomes a positioned diagnostic (`collect.ts:228-236`).
  - **Include cycles are detected through canonical real paths** and reported (`collect.ts:178-182`); the same include included twice from different places is fine because the ancestor set is scoped to the current chain (`collect.ts:216-220`).
  - **Parser messages can quote configuration values**, so only the file and location are retained (`collect.ts:186-191`).
  - A **disabled carrier declares no children**, because the Loader never initializes it unless `group: true` forces it (`collect.ts:255-257`).
- **Edge cases & failure handling:** a missing include file falls back to `config.initial` in memory and writes nothing (`collect.ts:183-190`); the interception is disposed in a `finally` even though imported modules stay cached (`collect.ts:270-272`).

#### `packages/boot/app-boot/src/config-schema/projector.ts`
- **Purpose:** Project a native Schemastery `Config` graph into JSON Schema **without executing validators or transform callbacks**.
- **Key abstractions:** `createConfigProjector(): Promise<(root, prefix) => ConfigProjection>`; `LOADER_EXPRESSION_SCHEMA`; `ConfigProjection { schema, definitions, acceptsMissing, limitations }`.
- **Data flow:** `visit(node, path, strict)` walks the native graph, building a JSON Schema node per native node and collecting `limitations` strings; recursion is detected through an `active` set and turned into a `$ref` to a generated `…RecursiveN` definition.
- **Non-obvious design decisions:**
  - **Every imprecision becomes an explicit limitation string, never a guess** (`projector.ts:76-78`): `acceptsMissing` can be `true | false | 'unknown'`, and `'unknown'` is propagated into the emitted schema as `x-cordis.omissionValidation: 'runtime'` (`projector.ts:475`, `projector.ts:570`).
  - **Ajv is used only to check literal defaults against the generated schema** — it does not fill defaults, coerce input, or call native validators (`projector.ts:55-59`).
  - **Union branches that may mutate their input widen the whole union to `true`** (`projector.ts:400-405`): "earlier union branches may alter later validation inputs".
  - `effectful` vs `mutating` are tracked separately: a transform or loose schema is *effectful*; only containers that write adapted values back are *mutating* (`projector.ts:46-50`, `projector.ts:410-413`).
  - **Recursive references are exported without mutating the native lazy schemas** — the native graph is cloned per strict visit (`projector.ts:81-86`).
  - **Non-JSON defaults are omitted, not coerced** (`projector.ts:47-68`): a cyclic or non-plain-object default is dropped with a limitation, and the *sibling* constraints survive.
- **Edge cases & failure handling:** a lazy cycle with no concrete schema throws `lazy cycle has no concrete schema`; a non-Error builder failure is reported per node without losing other schemas; `volatile` fields must not be nested inside another volatile field (`validateVolatilePlacement`).
- **Surprising:** `constant()` reproduces Schemastery's "omitted and null-valued object members are alike" semantics by generating a `patternProperties` escape for `Object.prototype` keys and treating inherited members as optional (`projector.ts:70-86`).

#### `packages/boot/app-boot/src/config-schema/document.ts`
- **Purpose:** Compose the Loader entry/patch *structure* and the collected plugin schemas into one JSON Schema 2020-12 document.
- **Key abstractions:** `buildConfigSchemaDocument(profile, collected, targets, initialDiagnostics): Promise<ConfigSchemaDump>`.
- **Data flow:** Emits `$defs` for `loaderExpression`, `entryMetadata`, `entryList`, `patchList`, `unknownConfig`, `includeConfig`, `includePatch`, plus one `configN` definition per distinct native schema. Per-entry `configRef` points at the right definition; per-plugin-name rules select the union of the refs collected for that name.
- **Non-obvious design decisions:**
  - **`unknownConfig` is explicitly "unknown configuration, not a prohibition on fields"** (`document.ts:47`) — unknown plugin names stay open.
  - **The "dormant" rule**: a row that is `disabled: true` (or has a `disabled` expression) and is not `group: true` may omit its config, because the Loader never initializes it (`document.ts:159-167`).
  - **A plugin name resolved to two different schemas yields a union and a warning**, not an arbitrary pick (`document.ts:174-178`) — "module resolution depends on the owning tree".
  - **Patch target ids come from the root tree's index only**; include-local ids are excluded (`document.ts:141`, `document.ts:180-196`).
  - The document's own `$comment` spells out the layering order (bundle → profile → home → CLI), that **a patch config replaces the whole config rather than deep-merging**, and that **JSON Schema defaults are annotations** while Schemastery validates a fallback on null/omission unless `required` rejects first (`document.ts:207-215`).
- **Edge cases & failure handling:** diagnostics are sorted by the position of their path so the report reads in document order (`document.ts:198`); `complete` is false if any error diagnostic exists, any entry is `partial`/`unsupported`/`error`, or a name resolved ambiguously (`document.ts:209-212`).

#### `packages/boot/app-boot/src/config-schema/index.ts`
- **Purpose:** The public `generateConfigSchema(profile, layers, installAnchor)` entry point.
- **Key abstractions:** `generateConfigSchema`; re-exports `ConfigSchemaDump`, `NativeConfigSchema`.
- **Data flow:** composition diagnostics (skipped bundles become *errors*) → `composeEntries(layers)` → `createRuntimeResolution` → `collectConfigSchemas`.
- **Non-obvious decisions:** a **skipped bundle is an error diagnostic**, not a warning — the selected composition is incomplete, and the caller must know (`index.ts:22-28`).
- **Edge cases:** the function **does not mutate the supplied layers** (they are cloned inside `composeEntries`), and collection **must not overlap another profile-resolution interception** (`index.ts:12-17`).

#### `packages/boot/app-boot/src/config-schema/native.ts`
- **Purpose:** Identity check at the plugin-export and lazy-builder boundary.
- **Key abstractions:** `isNativeConfigSchema(value): value is NativeConfigSchema`.
- **Non-obvious decisions:** recognition is by **marker protocol** (`Symbol.for('schemastery') === true`, a string `type`, and an object `meta`) — no validator is invoked and no serialization hook runs (`native.ts:13-21`). This is the "check the shape, do not call the thing" rule.

#### `packages/boot/app-boot/src/config-schema/pattern.ts`
- **Purpose:** Decide whether a native RegExp constraint can be emitted as a JSON Schema `pattern` under Unicode semantics.
- **Key abstractions:** `createPatternCheck(): Promise<(source, flags?) => boolean>`.
- **Data flow:** parses the pattern twice with `@eslint-community/regexpp` (Unicode and non-Unicode) and compares a **canonical signature** of both ASTs (`pattern.ts:34-37`); then checks each alternative against `portableAlternative`.
- **Non-obvious decisions:**
  - Only `''` and `'u'` flags are considered portable; any other flag is rejected outright (`pattern.ts:48`).
  - A **lone unanchored broad set** (`\S`, `\d`, `\w` negated) asks only "does a matching character exist", so it is portable; but two of them, or a word assertion alongside them, can observe a surrogate pair's midpoint and are refused (`pattern.ts:24-32`).
  - **Parsing never executes the regex** against config values (`pattern.ts:45`).
  - A `SyntaxError` from the parser is swallowed and reported as "not portable"; any other parser failure is rethrown (`pattern.ts:50-53`).

#### `packages/boot/app-boot/src/config-schema/types.ts`
- **Purpose:** The JSON Schema output types and the native-graph input type.
- **Key abstractions:** `ConfigJsonSchema`, `ConfigJsonSchemaObject`, `ConfigSchemaDiagnostic`, `ConfigSchemaEntry` (with `status: 'schema'|'partial'|'absent'|'unsupported'|'error'`), `ConfigSchemaDump` (with the `x-cordis` extension carrying `profile`, `complete`, `entries`, `diagnostics`, `patchSchema`), `NativeConfigSchema`.
- **Non-obvious decisions:** the `x-cordis` extension is **part of the typed contract** — standard validators may ignore it, but DSH's own tooling reads it (`types.ts:56-64`). `ConfigSchemaDiagnostic.path` is described as a *structural position in the discovered entry tree*, not a JSON pointer (`types.ts:18-21`).

#### `packages/boot/app-boot/src/compatibility-preflight.ts`
- **Purpose:** Refuse to mount a plugin whose declared DSH requirement the running runtime does not satisfy — decided at the composition boundaries DSH owns, *before* the module is imported.
- **Key abstractions:** `prepareProfileEntries(ctx, entries, parentURL, binName)`; `prepareProfilePatches(ctx, patches, parentURL, binName)`; internal `preflight`, `manifestOf`, `includedConflicts`.
- **Data flow:** for each row, read its manifest (through the `pluginPackages` service when the launcher supplied one, else Node's own lookup, else by walking up to the nearest `package.json`), evaluate compatibility, and if the row is denied set `disabled: true` (and clear `group`). Native Includes are descended into: an Include that *reaches* a denied plugin is denied **as a whole**, because "its file is never rewritten" (`compatibility-preflight.ts:142-167`).
- **Non-obvious decisions:**
  - **Only a compatibility conflict denies a row.** An unresolvable manifest is left to the Loader's own import failure (`compatibility-preflight.ts:101-113`).
  - **Metadata that cannot be read or validated is refused rather than silently admitted** (`compatibility-preflight.ts:107-112`).
  - **`prepareProfilePatches` composes over the launcher's EMPTY root** and returns one insertion patch, because a non-empty root would lose the caller's id-targeted overrides (`compatibility-preflight.ts:171-187`).
  - Diagnostics go to **stderr** because "no plugin-owned logger exporter exists yet" at admission time (`compatibility-preflight.ts:76-83`).
  - A **disabled row is skipped entirely** (`row.disabled === true && !row.group` → continue) — the policy does not second-guess an explicit disable (`compatibility-preflight.ts:122`).
- **Edge cases:** a recursive Include is detected by a `includes` set and left undecided (`compatibility-preflight.ts:150-151`); a dynamic (non-literal) Include path is left to the Include plugin itself.

#### `packages/boot/app-boot/src/plugin-compatibility.ts`
- **Purpose:** Evaluate a plugin's `engines.dsh` (else its `@deepseek-ai/dsh*` peers) against the running runtime version — without importing plugin code.
- **Key abstractions:** `PluginCompatibility { name, version, runtimeVersion, requirements, exempted }`; `getDshRuntimeVersion()`; `evaluatePluginCompatibility(manifest, exemptions, runtimeVersion?)`; `pluginCompatibilityWarning(issue)`.
- **Data flow:** read the runtime version from *this package's* `package.json` through a **filesystem path** (not a URL) because "the executable's virtual filesystem intercepts string paths, not URL arguments" (`plugin-compatibility.ts:49-54`); then evaluate.
- **Non-obvious decisions:**
  - **`engines.dsh` decides alone and peerDependencies are then ignored** (`plugin-compatibility.ts:88-97`).
  - `workspace:^`, `workspace:~`, `workspace:*` peers refer to the current runtime; **any `workspace:` value inside `engines.dsh` is unmet** (`plugin-compatibility.ts:88-90`, `plugin-compatibility.ts:97`).
  - Prereleases participate (`includePrerelease: true`).
  - The warning text names the **exact remedy**: the exact `package-name@version` key and the exact runtime version to grant, and states the risk ("may cause crashes or data loss") (`plugin-compatibility.ts:126-133`).
- **Edge cases:** a malformed manifest (`engines` not an object, a non-string range) throws rather than being treated as "no requirement" — refusal beats leniency here.

#### `packages/boot/app-boot/src/profile-compatibility.ts`
- **Purpose:** The profile-local `compatibility.json` — the only place a version exemption may live.
- **Key abstractions:** `PROFILE_COMPATIBILITY_FILENAME = 'compatibility.json'`; `ProfileCompatibility { exemptions, warnings, rewritable }`; `readProfileCompatibility(dir)`; `readProfileVersionExemptions(dir)`; `setProfileVersionExemption(dir, pkgVersion, runtimeVersion, enabled, acceptRisk)`; `isExactPluginVersion(value)`.
- **Data flow:** read → parse → validate every key as an exact `package-name@version` and every value as a list of exact DSH versions → keep the accepted records, report the rejected ones.
- **Non-obvious decisions:**
  - **A malformed file authorizes nothing but does not stop the profile** — the accepted records still apply, each rejected record is reported on stderr, and the file is then treated as **read-only** so a grant refuses and asks the user to repair it by hand rather than overwriting their content (`profile-compatibility.ts:63-70`, `profile-compatibility.ts:111-121`).
  - The exemption lives in **its own file, not in `package.json`** — so an exemption write never touches the dependency manifest, the bundle list, or Cordis patch files (`profile-compatibility.ts:5-6`).
  - **Grants require explicit risk acknowledgement** and must name the *currently running* runtime (`profile-compatibility.ts:126-137`).
  - Writes are `withFileLock` + `writeFileAtomic(..., { mode: 0o600 })` (`profile-compatibility.ts:139-153`).
  - `isExactPluginVersion` rejects ranges, prefixes, whitespace and anything that is not canonical SemVer including build metadata (`profile-compatibility.ts:19-24`).
- **Edge cases:** a revoked runtime is removed from the list; when the list becomes empty the whole key is deleted (`profile-compatibility.ts:145-149`).

#### `packages/boot/app-boot/src/profile-context.ts`
- **Purpose:** The launcher-owned profile facts and the composition of the patch layers.
- **Key abstractions:** `ProfileContext` (name, dir, patchPath, installAnchor, cwd, home, `packageManager`, `startedBundles`, `overlays`, `telemetryDisabledEnv`); `ProfilePnpmInvocation`; `resolveTelemetryPatch(disabledEnv, hasRow)`; `readBundlePatches`; `readProfilePatches`.
- **Data flow:** `readProfilePatches` = bundle layers → profile patch → home patch → launch overlays, then the telemetry opt-out patch.
- **Non-obvious decisions:**
  - **The telemetry opt-out is "off by mistake"** — ANY non-empty value, including `'0'` and `'false'`, disables (`profile-context.ts:56-63`).
  - If the composition has **no telemetry row**, no patch is generated and the switch is trivially satisfied — custom profiles need not mount telemetry (`profile-context.ts:57-60`).
  - The context is **data only**: "scheduling and mutation belong to their callers" (`profile-context.ts:18-19`).

#### `packages/boot/app-boot/src/profile-plugins.ts`
- **Purpose:** Read the profile's installed dependencies and reconcile bundle activation after a package-manager operation.
- **Key abstractions:** `ProfilePluginLocation`, `ProfilePluginDependency { name, version, bundle, enabled }`, `ProfilePluginInventory`, `ProfilePluginReconciliation`; `readProfilePlugins`, `writeProfileBundles`, `reconcileProfilePlugins`.
- **Data flow:** `readProfilePlugins` reads the manifest and, per dependency, the *installed* manifest (or the spec when the installed metadata is missing) and asks the shared bundle resolver whether the package declares a `dsh.bundle.patch`.
- **Non-obvious decisions:**
  - **Unreadable installed metadata must not prevent listing or removing a dependency** (`profile-plugins.ts:37-40`).
  - Reconciliation **preserves disabled bundles** when the caller asks (`preserveDisabled`) and **auto-activates newly installed bundle declarations** (`profile-plugins.ts:104-116`).
  - The manifest is written **only when the bundle list actually changed** (`profile-plugins.ts:117-119`).

#### `packages/boot/app-boot/src/profile-sanitize.ts`
- **Purpose:** Filesystem recovery for a broken profile — back up the patch and restore a known-good bundle list, **without loading plugins or parsing patches**.
- **Key abstractions:** `sanitizeProfile(binName, profileDir, bundles): string | undefined`.
- **Data flow:** rename `cordis.patch.yml` → `cordis.patch.yml.bak-<unix-ms>[-ordinal]`, then write the bundle list into the manifest.
- **Non-obvious decisions:**
  - The **caller must stop the profile and exclude concurrent profile writes** before calling — the function relies on that exclusion to keep the destination absent until the rename (`profile-sanitize.ts:5-9`, `profile-sanitize.ts:21-22`).
  - **Invalid profile JSON fails before any mutation** (`profile-sanitize.ts:26`).
  - Failures propagate and may leave completed changes in place **for a retry** (`profile-sanitize.ts:9-10`).
  - The backup name is Unix **milliseconds** plus an ordinal on collision (`profile-sanitize.ts:15-19`).

#### `packages/boot/app-boot/src/package-meta.ts`
- **Purpose:** Read a plugin's display text (title/description, localized) and icon **without evaluating plugin code**.
- **Key abstractions:** `readPluginMeta(specifier, parentURL): PluginLocalizedMeta | undefined`; `resolvePluginResource(specifier, parentURL): string`.
- **Data flow:** resolve `<specifier>/locale/en.json` through the Node resolver → read every sibling `*.json` in that directory as a language → resolve `<specifier>/package.json` (package-root specifiers only) for the fallback title/description and a declared `icon` → else resolve `<specifier>/icon` → base64 it into a data URL.
- **Non-obvious decisions:**
  - **A subpath specifier never reads `package.json`** — its icon can only come from `<specifier>/icon` (`package-meta.ts:164-166`, `package-meta.ts:181`).
  - **Icons are confined**: a manifest icon must stay inside its declaring directory; an exported icon must stay inside its owning package after realpath resolution (`package-meta.ts:36-38`, `package-meta.ts:44`, `package-meta.ts:57-64`).
  - **Icon limits**: SVG/PNG/JPEG/WebP only, ≤ 256 KiB (`package-meta.ts:16-20`, `package-meta.ts:51-53`).
  - **An icon failure retains the display text** and returns the diagnostic alongside it (`package-meta.ts:191-194`).
  - Language files must **share the directory containing the resolved English resource** (`package-meta.ts:134-136`); the language id is validated against a BCP-47-ish regex and duplicates (case-insensitively) are rejected.
  - A **missing resource is "absent", but an invalid export target is an error** — `optionalResourcePath` distinguishes `ERR_PACKAGE_PATH_NOT_EXPORTED`/`MODULE_NOT_FOUND`/`ENOENT` from anything else (`package-meta.ts:82-95`).

#### `packages/boot/app-boot/src/profile-resolution/service.ts`
- **Purpose:** A Cordis service exposing the runtime resolution and deterministic package lookup.
- **Key abstractions:** `PluginPackages extends Service`; `PluginPackage { name, version, dir, manifestPath, manifest }`; `PluginPackagesConfig`; `ctx.pluginPackages`.
- **Data flow:** the service installs the interception and registers the resolution for Harness-owned Workers; `packageOf(specifier, parentURL)` resolves a package directory without requiring an exported `package.json`; `metaOf` delegates to `readPluginMeta`.
- **Non-obvious decisions:**
  - **`replace(successor)` publishes atomically and clears the parsed-package cache** (`service.ts:104-114`).
  - The service owns the Worker resolution registration and **disposes it with the context effect** (`service.ts:74-79`).
  - `refresh()` only works when the installed resolution is a `ProfileRuntimeResolution`; a plain-data resolution refuses (`service.ts:116-127`).
- **Edge cases:** a selected package directory with **no manifest** yields `undefined` rather than an error; malformed metadata is reported.

#### `packages/boot/app-boot/src/profile-resolution/legacy-links.ts`
- **Purpose:** Canonicalize module directories/resources through the *active* carrier's filesystem (packaged executable vs plain Node).
- **Key abstractions:** `realModuleDirectory(path)`; `realModuleFile(path)`.
- **Non-obvious decisions:** a packed executable has **no native realpath**, so `realModuleDirectory` uses `realpathSync` there and `realpathSync.native` otherwise; `realModuleFile` **preserves physical file aliases** because SEA archive files are symlink-free but their directories support realpath (`legacy-links.ts:25-33`).

#### `packages/boot/app-boot/src/profile-resolution/worker-bootstrap.ts`
- **Purpose:** Install the inherited runtime resolution inside one Harness-owned Worker.
- **Key abstractions:** side-effect module; reads `getEnvironmentData('@deepseek-ai/dsh-app-boot/profile-resolution')`.
- **Non-obvious decisions:** **the bootstrap bundle has no static package imports** (it is bundled with `resolve.exports` inlined) so a Worker carries its own dependency closure and does not resolve anything at load time.

#### `packages/boot/app-boot/src/official-bundles.ts` / `official-bundle-packages.ts` / `official-bundles.generated.ts`
- **Purpose:** The offline catalog of "Official" on-demand bundles, with their localized titles, descriptions and inline SVG icons.
- **Key abstractions:** `ON_DEMAND_BUNDLES` (two entries: `dsh-subagent-claude-code`, `dsh-subagent-codex`); `OfficialBundleCatalogEntry { packageName, meta: { title, description, icon } }`; `OFFICIAL_ON_DEMAND_CATALOG`.
- **Non-obvious decisions:** the catalog is **generated offline** by `pnpm gen-official-bundle-catalog` and contains **no install target and no version** — the Plugin Manager derives the target from the running installation. The icons are embedded base64 data URLs so the catalog never imports provider code (`official-bundles.generated.ts:1-5`).

#### `packages/boot/cmdline/src/index.ts`
- **Purpose:** The immutable command-line handoff from the launcher to the app.
- **Key abstractions:** `CmdlineArgs`, `AppExit`, `AppReady`, `CmdlineHost`; `provideCmdline(ctx, host)`; `parseCmdline(ctx, program)`; `exitOnStdinEnd(ctx, label)`; `internals` (injectable streams).
- **Data flow:** the launcher parses only its own flags and hands everything after them through `ctx.cmdlineArgs` — a **frozen snapshot** that many plugins may read (`cmdline/src/index.ts:88-95`). An app brings a commander program; `parseCmdline` runs it against the snapshot.
- **Non-obvious decisions:**
  - **Structural, not `instanceof`, error detection** (`isCommanderError`, `cmdline/src/index.ts:213-224`): an out-of-tree plugin brings its own commander copy whose `CommanderError` is a different identity, and an identity check there would rethrow a printed help as a fatal load failure.
  - **`configureExitAndOutput` walks every subcommand** (`cmdline/src/index.ts:196-208`): commander copies `exitOverride` and output configuration into a subcommand only at registration, so a root-only override would let a registered subcommand write to the process streams and call `process.exit` directly.
  - **`hasAction` guard** (`cmdline/src/index.ts:176-186`): a program that forgot its action would otherwise parse successfully, publish nothing, and surface only as dependent rows pending on an absent service.
  - **EOF does not exit before readiness**: `exitOnStdinEnd` registers `ready.onReady(() => exit(0))`, so a startup rejection racing EOF stays the process outcome (`cmdline/src/index.ts:110-133`).
  - The EOF listener **never reads or resumes stdin**, so a protocol transport receives bytes buffered before it mounted (`cmdline/src/index.ts:121-125`).
- **Edge cases:** the launcher must provide `cmdlineArgs` and `appExit` or the parse fails loudly; `exitOnStdinEnd` requires both `appExit` and `appReady` and throws otherwise.

#### `packages/boot/config-editor/src/index.ts`
- **Purpose:** Persist a plugin's configuration as a profile patch and apply it through the normal Loader path.
- **Key abstractions:** `ConfigEditor extends Service` (`ctx.configEditor`); `entries()`; `configuration()`; `edit(entry, change)`.
- **Data flow:** `edit()` takes the profile manifest lock → reconciles external changes → derives the candidate → runs it through the entry's own `internal/config` waterfall and `resolveConfig` (**so the plugin validates it**) → edits the YAML document in place (preserving comments and `!!js` tags) → writes atomically with mode `0600` → reconciles again; on failure it **restores the previous document and reloads the previous patches** (`config-editor/src/index.ts:118-137`).
- **Non-obvious decisions:**
  - **The candidate is validated by the plugin itself before anything touches disk** (`config-editor/src/index.ts:109-115`).
  - **A config equal to the inherited value deletes the override** rather than writing an equal one (`config-editor/src/index.ts:120-126`).
  - **A higher-layer override (home patch or CLI overlay) is detected and refused** with `Configuration for "x" is overridden by a home patch or command-line overlay` (`config-editor/src/index.ts:133-138`).
  - **Only uniquely-addressed entries owned by the profile's root Include are editable** — duplicate ids are excluded (`config-editor/src/index.ts:34-40`).
  - The editor runs inside `hmr.runExclusive` when HMR is present, so it is serialized with reloads (`config-editor/src/index.ts:139-141`).
  - The YAML document is edited through the `yaml` library's AST so **comments and `!!js` expression tags survive** outside the replaced value (`config-editor/src/index.ts:117-136`).

#### `packages/boot/hmr/src/index.ts`
- **Purpose:** Serialized module and profile-configuration hot reload.
- **Key abstractions:** `Hmr extends Service` (`ctx.hmr`); `HmrConfig { base, root, ignored, debounce }`; `runExclusive(operation)`; `watchConfig(filename, refresh)`; `reconcileProfile(requiredIds?)`; `ProfileReconciliation { warnings, pending, restartReason? }`; `PendingModule { url, reason }`; events `hmr/change` and `hmr/reload`.
- **Data flow:** chokidar watches module roots; the debounced dispatcher classifies each changed path (externals → full reload; a cached ESM/JSON module → stashed; an Include file → `include.refresh()`; else `hmr/change`). `partialReload()` computes accepted/declined sets from the module dependency graph, evicts the changed modules, re-imports the plugin entries, disposes the old runtime, re-registers the replacement, and **rolls back on failure**. Profile patches and the manifest are watched separately and funnel into `reconcileProfile()` → app-boot's `recomposeProfile()`.
- **Non-obvious decisions:**
  - **Everything is one queue**: `runExclusive` serializes config mutations, module replacements and package operations, and **rejects nesting** (`hmr/src/index.ts:268-276`).
  - **`reconcileProfile` must run inside `runExclusive`** and throws otherwise (`hmr/src/index.ts:926`).
  - **HMR never imports replacement code itself**: "the Loader imports the current files when the generation starts an entry, so disabled, removed and incompatible rows never execute it" (`hmr/src/index.ts:957-961` in the README; code at `hmr/src/index.ts:869-871`).
  - **Three reasons a change waits for a restart**: `host-module` (the process entry point's static graph imports it), `unmanaged-plugin` (no traversable Loader entry owns it), `module-comparison` (the caches cannot be compared) (`hmr/src/index.ts:1017-1025`).
  - **A failed replacement does not restore the old plugin** — the previous version stops running, the failure is an activation failure, and every later recomposition imports it again (`hmr/src/index.ts:715-735`).
  - **`evict()` backs up the caches and returns a restore closure** (`hmr/src/index.ts:753-777`): the rollback is the restore closure.
  - **Manifest changes invalidate Node's package configuration** rather than reload the module (`hmr/src/index.ts:448-451`).
  - The `applicationReady` promise gates all reloads: "Plugins started with the application are recorded; modules loaded later are compared by modification time" (`hmr/src/index.ts:367-383`).
- **Edge cases & failure handling:** `contained()` wraps each optional step so a failed comparison or eviction does not abort the recomposition (`hmr/src/index.ts:902-910`); a surface that disposed the tree mid-reload is detected by `ctx.get('loader') === undefined` checks; `namespaceOf()` distinguishes a module whose evaluation threw (`MODULE_ERRORED = 5`) from an unlinked one (`hmr/src/index.ts:1030-1045`).
- **Surprising:** `EntryNamespaces` retains **every distinct imported namespace per (name, baseUrl)** so that a source reload uses the module that was actually loaded, instead of re-resolving the name (which would follow a changed `exports` map) (`hmr/src/index.ts:92-139`).

#### `packages/boot/hmr/src/module-files.ts`
- **Purpose:** Detect module files that changed on disk, by disk identity rather than by watcher events.
- **Key abstractions:** `ModuleFiles` (`observe`, `compare`, `refresh`, `now`).
- **Data flow:** the identity of a file is `inode:size:mtimeMs`; a module is stale when its file disappeared or its identity differs.
- **Non-obvious decisions:**
  - **Change time (`ctime`) is deliberately NOT recorded** — creating a hard link to a file (as pnpm does) changes ctime without changing content (`module-files.ts:13-17`).
  - The clock is read from **a fresh marker file's mtime**, not `Date.now()`, because "the system clock and file timestamps can differ by a clock tick in either direction" (`module-files.ts:48-66`).
  - **FAT's 2-second timestamp resolution** is compensated with `TIMESTAMP_RESOLUTION_MS = 2000` (`module-files.ts:8-10`).
  - A module **first loaded after the last observation** is stale when its mtime is at/after the observation minus the resolution — accepting a spurious reload in exchange for detecting a reinstall (`module-files.ts:74-79`).
- **Edge cases:** a removed or unreadable file yields `undefined` identity → the module is stale.

#### `packages/boot/hmr/src/watch-config.ts`
- **Purpose:** Watch one exact configuration file (and only its ancestors) without subscribing to siblings.
- **Key abstractions:** `watchConfig(ctx, filename, options, refresh, inTransaction?)`.
- **Data flow:** `findWatchRoot` walks up to the nearest existing directory and returns `{ filename, root, depth }`; chokidar watches that root with `depth` and an `ignored` predicate that excludes everything except the target.
- **Non-obvious decisions:**
  - **`awaitWriteFinish: true` by default** — "edits wait for Chokidar's 2-second write-stability window, avoiding its lossy change-event throttle" (`watch-config.ts:52-53`).
  - **Refresh callbacks are serialized and coalesced** through a `dirty` flag loop (`watch-config.ts:64-84`).
  - **A refresh failure is logged, not fatal** — the watcher keeps processing later events (`watch-config.ts:71-79`).
  - **The disposer re-attaches an error listener across `close()`**, because "its straggler stats a file this teardown is deleting, which Windows reports as EPERM, and an 'error' emission with no listener is rethrown as an uncaught exception" (`watch-config.ts:94-100`).
  - The watcher registers itself on the context as an effect, so disposal is automatic (`watch-config.ts:113`).
- **Edge cases:** a **duplicate registration of the same canonical path throws** (`watch-config.ts:47`); a patch path whose parent is a regular file throws; the filesystem root that cannot be read terminates the search.

#### `packages/boot/hmr/src/package-manifest.ts`
- **Purpose:** Expire Node's cached package configuration for package directories whose manifest changed.
- **Key abstractions:** `PackageManifests` (`invalidate(manifest)`, `dispose()`); internal `loadNodeInternals()`, `captureEsmResolveCache()`.
- **Data flow:** `invalidate()` installs replacements on Node's `internalBinding('modules')` (`readPackageJSON`, `getPackageScopeConfig`, `getPackageType`), on `internal/modules/package_json_reader`'s `getNearestParentPackageJSON`, and on `Module._load`; then it clears the CommonJS `_pathCache` and the ESM `ResolveCache`.
- **Non-obvious decisions:**
  - **The ESM resolve cache is captured by observing one lookup through the prototype** — the cache object itself is not exported (`package-manifest.ts:100-121`).
  - **The CommonJS `_load` hook resolves the request to an absolute filename first**, bypassing Node's private request cache without evicting already-evaluated modules (`package-manifest.ts:217-223`).
  - **Invalidated directories are matched by real path**, so a linked consumer that names a package by its link path is still covered (`package-manifest.ts:171-195`).
  - **Node's own diagnostics are preserved**: an invalid manifest throws the same `ERR_INVALID_PACKAGE_CONFIG` shape, including the importing base and specifier (`package-manifest.ts:286-292`).
  - `findNearestPackageConfig` **stops at a `node_modules` boundary**, exactly like Node (`package-manifest.ts:264-277`).
  - Every replacement is restored on `dispose()` **only if it is still the installed one** (`package-manifest.ts:57-67`).
- **Edge cases:** non-UTF-8 manifest bytes are an invalid package config; a BOM is stripped; `name`/`type`/`exports`/`imports` strings must be *well-formed* Unicode (`isWellFormed()`).

#### `packages/boot/hmr/src/error.ts`
- **Purpose:** Log HMR build failures with code frames when source locations are available.
- **Key abstractions:** `handleError(ctx, e)`.
- **Non-obvious decisions:** the build-failure shape is detected **structurally** (`errors` array whose members all have a string `text`), not with `instanceof` (`error.ts:5-8`); a failure without a `location` logs just the text.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/boot/README.md` | Boot group index: the six boot packages, their `ctx` keys, and the rule that each package README owns its details. |
| `packages/boot/README.zh.md` | Chinese mirror of the boot group README (same headings; section hashes in the i18n ledger). |
| `packages/boot/app-boot/README.md` | The app-boot contract: two-call entry point, profile/bundle model, compatibility preflight + exact-version exemptions, config dump, schema inspection, and the **startup/reload failure matrix** (one row per failure pattern × optional/required/HMR). |
| `packages/boot/app-boot/README.zh.md` | Chinese mirror of the app-boot README. |
| `packages/boot/app-boot/package.json` | `@deepseek-ai/dsh-app-boot` v0.2.1-rc.2; depends on `ajv`, `js-yaml`, `regexpp`, `resolve.exports`, `semver`, `node-addon-require-builtin`; peers on the vendored Cordis loader/include/group. |
| `packages/boot/app-boot/tsconfig.json` | Project references to the vendored cordis/loader/include/group and the util packages; `rootDir: src`, `outDir: lib/types`. |
| `packages/boot/app-boot/tsdown.config.ts` | Two build entries: the library (bundling `cordis-plugin-include`, keeping Loader external so host and tree share one Loader peer) and the worker bootstrap (bundling `resolve.exports`, no static package imports). |
| `packages/boot/app-boot/tests/app-boot.spec.ts` | Pins `resolveConfigPath` (incl. replay basename swap), `loadEnv`/`loadLayeredEnv` (layer precedence, proxy exception, bootstrap-name refusal), `installFailLoud` (single labelled line, release hook, first-rejection latch, non-Error rejections), `auditStartupEntries` (required vs optional, nested/aggregate causes, pending services, non-enumerable metadata), patch loading, and `boot()` end-to-end (retains import errors, disposes on required failure, survives a mid-startup disposal). |
| `packages/boot/app-boot/tests/compatibility-preflight.spec.ts` | Pins the denial path: incompatible plugin blocked *before import*, exact-version exemption, package-imports alias, group descendant, whole-Include omission, unresolvable rows left to the Loader, recursive Include termination, denial labels. |
| `packages/boot/app-boot/tests/config-dump.spec.ts` | Pins `renderConfigDump`: layer order, `!!js` printed verbatim, per-source `# ==` comments, one flattened patch application identical to boot, unmatched-patch warnings, loud failure on a bad base config. |
| `packages/boot/app-boot/tests/config-pattern.spec.ts` | A 28-row table pinning which RegExp constructs survive as JSON Schema `pattern` under Unicode semantics. |
| `packages/boot/app-boot/tests/config-reload.spec.ts` | Pins include refresh: missing file → `initial` entries, invalid file → keep the last good tree, patch parity with the initial load, later patch over an earlier insert, schema-rejection recovery, one `isolate` realm across a group. |
| `packages/boot/app-boot/tests/config-schema.spec.ts` | Pins schema collection/projection: namespace + class `Config` exports, anonymous/disabled/conditional rows, dormant carriers, absent vs unsupported vs import-failure statuses, recursive references, literal includes and their cycles, malformed rows keeping siblings, patch-target indexing, and the "no native validation executed" guarantee. |
| `packages/boot/app-boot/tests/hooks-thread-stack.ts` | Test helper registering a synchronous resolve hook that rethrows Node's resolver errors with a read-only `stack` (the shape the module-hooks thread returns). |
| `packages/boot/app-boot/tests/linked-resolution-matrix.spec.ts` | A differential matrix (layout × importer × source × manifest/module state) comparing DSH's linked-root resolution against native Node for `esm-resolve`, `cjs-require`, `cjs-paths` and metadata lookups. |
| `packages/boot/app-boot/tests/loader-shape.compat.spec.ts` | Pins that the Node loader is detected by its **own API version**, not the Node major (24.0–24.11.1 report major 24 but carry the v1 loader). |
| `packages/boot/app-boot/tests/official-bundles.spec.ts` | Pins exactly two on-demand bundles, each with an SVG data-URL icon, both languages present, and **no version field** in the catalog. |
| `packages/boot/app-boot/tests/package-meta.spec.ts` | The biggest metadata suite: locale fallbacks, per-field translations, subpath rules, icon path confinement, byte limit ±1, symlink ownership, case-equivalent language names, malformed metadata diagnostics, and v1/v2 resolver argument order. |
| `packages/boot/app-boot/tests/plugin-compatibility.spec.ts` | Pins runtime-version reading, range semantics, `workspace:` handling, `engines.dsh` deciding alone, peer-only fallback, exact-version exemptions (no range interpretation), prototype-pollution-safe identity handling, and the warning text. |
| `packages/boot/app-boot/tests/profile-compatibility.spec.ts` | Pins the `compatibility.json` reader/writer: exact identities with build metadata, rejected records reported but not fatal, explicit risk acknowledgement, current-runtime requirement, `0600` persistence, revocation of one runtime without losing others, and refusal to widen a malformed file. |
| `packages/boot/app-boot/tests/profile-plugins.spec.ts` | Pins the plugin inventory (alias keys, installed versions, install precedence) and bundle reconciliation with and without `preserveDisabled`. |
| `packages/boot/app-boot/tests/profile-resolution-service.spec.ts` | Pins the `PluginPackages` service: refresh from its own profile, refresh without a profile, refusal for plain-data resolutions, metadata without importing the entry, native lookup without a registration, and additive generation publication to the process and to Workers. |
| `packages/boot/app-boot/tests/profile-resolution-worker-bootstrap.spec.ts` | Two cases: no inherited data → no-op; inherited data → the resolution is installed. |
| `packages/boot/app-boot/tests/profile-resolution.spec.ts` | The largest suite (139 KB, ~110 cases): ESM/CJS routing parity, explicit CJS `paths` always native, npm aliases, package `imports` aliases, legacy `main` fallbacks, link-backend projections, generation rules (additive vs `ResolutionRestartRequired`), `MovedDirectories` relocation, linked-root generations, peer-position occupation, and native error preservation. |
| `packages/boot/app-boot/tests/profile-sanitize.spec.ts` | Pins recovery: broken plugins/patch are never loaded, previous backups survive retries, absent profile stays absent, invalid profile JSON fails before mutation, backup failure propagates before activation changes. |
| `packages/boot/app-boot/tests/profile.spec.ts` | Pins profile loading: bundle order, `dsh.bundle.patch` list order, path anchoring beside each file, template auto-init, retired-bundle removal, bundle compatibility skip, `composeEntries`, `createRuntimeResolution` (bundle closures, symlinked real paths, nested same-name packages, import-only exports, legacy `main`) and `removeLinkProjections`. |
| `packages/boot/app-boot/tests/schemastery-json-schema.spec.ts` | ~45 cases pinning the projection semantics: required derived from fallback validation, unions not narrowed to `oneOf`, transform callbacks not run, unsafe regexes not emitted, lazy metadata effects, volatile containment, UTF-16 length bound, non-JSON defaults omitted, deterministic output independent of native allocation ids. |
| `packages/boot/app-boot/tests/user-patches.spec.ts` | Pins the user-patch layer: missing file → no layer, `!!js` preserved, inserted relative plugin names anchored to the patch file, loud failures for unreadable/unparsable/non-array files, Include config stays literal, `disabled` interpolation and write-back preserving the `!!js` form, and profile-reconciliation settlement semantics. |
| `packages/boot/cmdline/README.md` | The cmdline contract: three launcher values (`cmdlineArgs`, `appExit`, `appReady`), app-owned flags beating config fallbacks, `--help` exiting 0, and the "launcher flags must precede app arguments" limitation. |
| `packages/boot/cmdline/README.zh.md` | Chinese mirror of the cmdline README. |
| `packages/boot/cmdline/package.json` | `@deepseek-ai/dsh-cmdline`; peers on cordis/loader, dev-dep on commander ^15. |
| `packages/boot/cmdline/tsconfig.json` | Project references to vendored cordis/include/loader. |
| `packages/boot/cmdline/tests/cmdline.spec.ts` | Pins flag-beats-config, help exiting 0 with no row started, action rejection without starting, rethrowing a non-commander failure, the immutable snapshot shared by several parsers, subcommand exit routing, and EOF→bounded exit only after readiness. |
| `packages/boot/config-editor/README.md` | The config-editor contract: validate the complete candidate before touching disk, serialize with profile changes and HMR, invalid values and higher-layer overrides leave the file unchanged, and only uniquely-addressed root-Include entries are editable. |
| `packages/boot/config-editor/README.zh.md` | Chinese mirror of the config-editor README. |
| `packages/boot/config-editor/package.json` | `@deepseek-ai/dsh-config-editor`; optional peer on `@deepseek-ai/dsh-hmr`; depends on `yaml`, `js-yaml`, `dsh-atomic-write`. |
| `packages/boot/config-editor/tsconfig.json` | Project references to hmr, app-boot, atomic-write and vendored include. |
| `packages/boot/config-editor/locale/en.json` | English display title for the plugin (`config-editor`). |
| `packages/boot/config-editor/locale/zh.json` | Chinese display title + description for the plugin. |
| `packages/boot/hmr/LICENSE` | MIT license text retained for the module-replacement implementation derived from `@cordisjs/plugin-hmr` 1.0.15. |
| `packages/boot/hmr/README.md` | The HMR contract: one queue for module replacement, Include refresh and profile configuration; the `root`/`ignored`/`debounce`/`base` config table; `awaitWriteFinish` default; the module-identity rules (inode+size+mtime, hard links, marker-file clock); the replacement rules; and a long, honest Known-Limitations list. |
| `packages/boot/hmr/README.zh.md` | Chinese mirror of the HMR README. |
| `packages/boot/hmr/package.json` | `@deepseek-ai/dsh-hmr`; deps `chokidar@5.0.0`, `picomatch`, `@babel/code-frame`, `node-addon-require-builtin`, `schemastery`. |
| `packages/boot/hmr/tsconfig.json` | Project references to vendored cordis/loader/include/timer/schemastery plus app-boot and cmdline. |
| `packages/boot/hmr/locale/en.json` | English display title (`hmr`). |
| `packages/boot/hmr/locale/zh.json` | Chinese display title + description. |
| `packages/boot/hmr/tests/coordination.spec.ts` | Pins the queue: serialization, nested-transaction rejection, queue survives failure, config handlers held behind config mutations, unrelated lock-file notifications ignored, self-disposal from inside a transaction, host full-reload hook for framework files, and watcher startup failure handling. |
| `packages/boot/hmr/tests/error.spec.ts` | Pins `handleError`: non-build failures warn as-is; a build failure with a location gets a code frame; an unreadable source file is reported. |
| `packages/boot/hmr/tests/module-files.spec.ts` | Two cases: the clock comes from a marker file that is then removed; the system clock is the fallback when no marker can be created. |
| `packages/boot/hmr/tests/modules.spec.ts` | Pins module replacement: v1/v2 loaders, config retained through replacement, volatile references re-bound, failure restores the cached modules and the old plugin, unchanged dependencies are not replaced, shared runtimes, dependency cycles, CommonJS cache restore, and the "original failure reported when the restore also fails" rule. |
| `packages/boot/hmr/tests/package-manifest-dispatch.spec.ts` | Pins how manifest changes dispatch: a manifest alone does not reload, a manifest imported as JSON does, a host-graph manifest asks for a full reload, a config-owned manifest stays with its watcher, `exports`/`main` moves take effect on entry restart, and namespace bookkeeping for shared/re-export entries. |
| `packages/boot/hmr/tests/package-manifest.spec.ts` | Pins manifest invalidation against Node's own readers: CommonJS exports refresh without evicting modules, package type/scope/nearest-manifest reads update, invalid manifests reproduce the native error, `node_modules` scope boundaries, root-scope termination, and disposal restoring the native readers. |
| `packages/boot/hmr/tests/package-reload.spec.ts` | The largest HMR suite: hard links do not stale a module, an in-place upgrade takes the new bundle patch config, a generation that waits for a restart puts its dropped rows back *at their places* (including inside a group), a failed import is retried, a module written during activation stays stale, and the three restart reasons. |
| `packages/boot/hmr/tests/profile.spec.ts` | Pins the profile watches: waits for readiness, applies profile/home/manifest changes, ignores dependency-only manifest changes, cancels queued reloads when the app exits, recovers from unreadable inputs, and applies a patch edited between boot parsing and watcher registration. |
| `packages/boot/hmr/tests/reconciliation.spec.ts` | A table-driven suite over profile reconciliation outcomes. |
| `packages/boot/hmr/tests/watch-config.spec.ts` | Pins exact config watching: filesystem aliases collapsed, add/change/unlink observed outside the module roots, creation when the parent did not exist, refreshes serialized and drained on disposal, consecutive writes, a parent that is a regular file rejected, watcher-failure release, post-close error absorption, and refresh-failure logging. |
| `packages/boot/hmr/tests/fixtures/package-root-scope.mjs` | A tiny fixture module used by the manifest scope tests. |


### `packages/boot/plugin-manager/src/index.ts`
- **Purpose:** The `PluginManager` service: persistent management of the *current profile*'s plugins and bundles, shared by the CLI, the Web page and the agent tool.
- **Key abstractions:** `PluginManager extends TypertRemoteService` (`ctx.pluginManager`); `@Remote` methods `listPlugins`, `listBundles`, `registries`, `inspect`, `setPluginEnabled`, `setBundleEnabled`, `installBundle`, `removeBundle`, `listVersionExemptions`, `setVersionExemption`, `waitForInstall`, `cancelInstall`; events `plugin-manager/changed`, `plugin-manager/install-log`, `plugin-manager/install-state`.
- **Data flow:** every mutation runs `change()` → `withFileLock(profile/package.json)` → snapshot the four profile files (`package.json`, `cordis.patch.yml`, `pnpm-workspace.yaml`, `compatibility.json`) into `diskState()` → perform the operation → reload via `hmr.reconcileProfile` (or report `restart-required` when HMR is absent) → compare `diskState()` to decide `changed`.
- **Non-obvious design decisions:**
  - **`change()` never throws**: every failure becomes `application: 'failed'` plus a typed `error.code`; only a lock or disposal error rejects (`index.ts:898-926`).
  - **A run this manager terminated is not a success**, even when pnpm trapped the signal and exited 0 (`index.ts:586-587`, `index.ts:776-781`).
  - **`failedAt` says what the last failed run could not reach**: `registry` (another registry could answer), `spec-host` (the error line names the git/tarball host, which no registry stands in for) or absent (`index.ts:590-596`).
  - **The registries asked are a *plan*, not a loop over all registries**: a registry outside the configured set is asked *alone*, so a private registry never falls through to a public one (`registry.ts:34-77`).
  - **A compatibility refusal is the package's own answer**, so no other registry is asked after it (`index.ts:584-585`).
  - **With HMR, `installBundle` refuses to install over an installed package** (`already-installed`) so the previous version's plugins stop first (`index.ts:541-545`).
  - `protectedModules` — a hard-coded set of 17 module names the manager may never disable or remove (`index.ts:68-78`).
- **Edge cases & failure handling:** a failed or cancelled install **restores `package.json` and `pnpm-lock.yaml`** from the pre-pnpm snapshot but deliberately *not* `pnpm-workspace.yaml` (so pending build approvals survive) (`index.ts:550`, `index.ts:603-609`). `installBundle` with `enabled: false` still installs and still checks compatibility. `cancelInstall` answers `too-late` once the bundle is being applied (`index.ts:669-678`).
- **Surprising:** `listBundles` reports a **selected bundle that failed to load** with an `error` while `enabled: true` records the *saved selection*, not successful loading (`index.ts:342-383`).

### `packages/boot/plugin-manager/src/operations.ts`
- **Purpose:** The shared pnpm operations behind both `dsh plugin` (CLI) and the manager service.
- **Key abstractions:** `runProfilePnpm(context, args, options): Promise<PackageResult>`; `runPluginCommand`; `bundleManifest`; `saveManifest`; `viewProfilePackage`; `readProfileRegistry`; `registryArguments`; `anchorPathSpec`.
- **Data flow:** snapshot `package.json` + `pnpm-lock.yaml` → optional pre-install registry lookup (`pnpm view`) to read the named package's `engines`/`peerDependencies` → compatibility preflight → spawn pnpm with `execa` → stream stdout/stderr into a per-run log file under `.plugin-manager/logs/` → classify the failure → restore or reconcile.
- **Non-obvious design decisions:**
  - **A run record is written before the spawn and removed after**: `.plugin-manager/run.json` names the pnpm tree, so a successor that takes over the profile lock from an exited process waits for it (`operations.ts:190-227`). "A lock whose holder process exited is taken over by the next writer, but that process's pnpm tree can still be running."
  - **The pipes drain under a fixed 2 s grace** after the process exits, then are cut with a notice in the log — "a descendant that inherited them holds them open" (`operations.ts:118-137`, `operations.ts:410-430`).
  - **The silence bound kills the whole tree and waits for it** before the caller restores files and releases the lock (`operations.ts:300-312`, `operations.ts:394-396`).
  - **A dependency the run did not touch never blocks an unrelated operation**: it stays installed and is only warned about (`operations.ts:434-447`).
  - **A rejected install restores the files and then reinstalls the restored lockfile** so the version that worked before keeps loading (`operations.ts:448-470`).
  - **Service runs scrub the environment; CLI runs inherit it** (`operations.ts:296-297`).
- **Edge cases & failure handling:** the log file is closed in a `finally` even when preparation or spawn fails; a malformed profile manifest is reported *before* pnpm is invoked.

### `packages/boot/plugin-manager/src/registry.ts`
- **Purpose:** Decide which registries one package operation asks, in order — and what a failed attempt could not reach.
- **Key abstractions:** `OFFICIAL_NPM_REGISTRY`, `NPMMIRROR_REGISTRY`, `REGISTRY_URL`; `normalizeRegistry(url)`; `registryPlan(requested, configured)`; `attributeFailure(kind, log, spec)`.
- **Non-obvious decisions:** **pnpm's own registry (`null`) joins the fallback set only while what it names is known to be public**; otherwise it is asked *alone* and nothing falls back into it (`registry.ts:60-77`). A requested registry that is *not* in the configured set is also asked alone (`registry.ts:73-74`).
- **Edge cases:** `attributeFailure` reads the host **only off error lines**, not off a warning that merely links to it (`registry.ts:99-104`).

### `packages/boot/plugin-manager/src/install-spec.ts`
- **Purpose:** Read an install spec before pnpm sees it — which of pnpm's four spec forms it is, and whether a registry would accept the name.
- **Key abstractions:** `ParsedInstallSpec` (`registry` | `path` | `tarball` | `git`); `InvalidInstallSpecError`; `parseInstallSpec(raw)`; `dependencySpec(name, recorded, profileDir, packageName?)`.
- **Non-obvious decisions:** **a local path must be absolute** — "the Host's working directory means nothing to the person typing into a browser" (`install-spec.ts:68-74`). `dependencySpec` **removes the user information of an http(s) URL** while keeping its query string (`install-spec.ts:119-120`). Package names are checked against npm's own shape and the 214-character limit.

### `packages/boot/plugin-manager/src/build-approval.ts`
- **Purpose:** Record and approve pnpm's pending dependency build scripts in the profile's `pnpm-workspace.yaml`.
- **Key abstractions:** `recordPendingBuilds(dir, output)`; `approveBuilds(dir, names)`; `ignoredBuildNames(output)`.
- **Non-obvious decisions:** **pnpm only writes those policy entries when it can prompt**, and the manager always runs it non-interactively — "the run's own report is the record that survives" (`build-approval.ts:26-30`). Approval **writes the policy without running the scripts**; the caller holds the profile manifest lock (`build-approval.ts:66`). **YAML anchors and aliases inside `allowBuilds` are refused** (`build-approval.ts:27-30`).

### `packages/boot/plugin-manager/src/patch.ts`
- **Purpose:** Comment-preserving enablement edits to the profile patch, plus the entry flattening they compare against.
- **Key abstractions:** `flatten(rows)`; `writePluginEnabled(profile, id, name, enabled): Promise<boolean>`.
- **Non-obvious decisions:** an override holding **only `id` and `disabled`** is *removed* when the bundle layers and the remaining profile patches already give the entry the requested state — "the profile patch records only departures from the bundles" (`patch.ts:36-45`, `patch.ts:88-96`). A `!!js` value never matches the literal comparison, so its override is kept (`patch.ts:45-47`). Home and launch overlays are **not consulted** for that comparison.

### `packages/boot/plugin-manager/src/run-tree.ts`
- **Purpose:** Wait for one package run's whole process tree to disappear before the caller touches the profile again.
- **Key abstractions:** `RunTree { pid, grouped }`; `leadsOwnGroup(execution, platform)`; `treeAlive(tree, internals)`; `awaitTreeGone(tree, internals)`.
- **Non-obvious decisions:** **a service run leads its own POSIX process group** (so it can be killed as a unit) while **a CLI run keeps the caller's group** (so an interrupt still reaches it) (`run-tree.ts:37-44`). The wait is bounded at 5 s with a 15 ms poll.

### `packages/boot/plugin-manager/src/github-connection.ts`
- **Purpose:** Check a GitHub repository *before* pnpm starts, without downloading or building anything.
- **Key abstractions:** `checkGithubConnection(spec, dir, options)`.
- **Non-obvious decisions:** **credential helpers and askpass are disabled** (`-c credential.helper=`, `GIT_TERMINAL_PROMPT=0`, empty `GIT_ASKPASS`), so the check never prompts; **pnpm owns authentication and transport fallback** (`github-connection.ts:60-66`). The full log stays on disk while only the **tail** is returned to the caller (`github-connection.ts:85-90`).

### `packages/boot/plugin-manager/src/types.ts`
- **Purpose:** The public records shared with clients.
- **Key abstractions:** `ManagementError['code']` (13 codes), `RestartReason` (5 reasons), `PluginInstallFailureKind` (10 kinds), `ChangeResult`, `PackageResult`, `PluginSpecInspection`, `PluginInstallProgress`, `PluginInstallLogChunk`.
- **Non-obvious decisions:** **the refusal codes are a closed union** so every surface renders them from its own locale dictionary (`types.ts:19-21`). `ChangeResult.application` is `'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'` — *the observed outcome*, distinct from what was saved (`types.ts:132-152`).

### `packages/boot/plugin-manager/src/tools.ts`
- **Purpose:** The agent-facing `plugin_manager` tool.
- **Key abstractions:** `ERROR_STEPS`, `FAILURE_STEPS`, `RESTART_STEPS`, `withNextStep(result)`, `apply(ctx)`.
- **Non-obvious decisions:**
  - **Every action requires `danger-full-access` or an explicit approval**, and the approval "does not change the session permission mode" (`tools.ts:118-127`).
  - **Every non-`applied` result carries a `nextStep` sentence** derived from the outcome, refusal code, failure kind or restart reason — the model is told what to do next instead of being handed a bare error code (`tools.ts:52-93`).
  - **Approval for build scripts is separate**: `approvedBuilds` grants *persistent* permission for that profile, and "General installation permission is not enough" (`tools.ts:107-108`).
- **Edge cases:** the session's permission mode is **re-checked on each execution**, including after a revocation.

### `packages/boot/plugin-market/src/index.ts`
- **Purpose:** The Host reader of configured plugin-market indexes, annotating every entry with installation status, DSH compatibility and the exact install arguments.
- **Key abstractions:** `PluginMarket extends TypertRemoteService` (`ctx.pluginMarket`); `Config { indexes, fetchTimeoutMs, maxBytes, cacheTtlMs }`; `@Remote listIndexes`, `setIndexes`, `search`; service method `entry`.
- **Data flow:** `sources()` validates every configured URL → `fetchShared(url)` (concurrent reads share one fetch) → `fetchIndex` (fetch with `redirect: 'error'`, body capped at `maxBytes`) → `parseIndexInWorker` (a Worker Thread) → cache with a TTL → `MarketSearch.select(query)` → per-page annotation against the live plugin manager.
- **Non-obvious design decisions:**
  - **A source URL is validated on every use, not only on save** — Settings and profile files can write any http(s) string (`index.ts:222-238`).
  - **A URL that is not in canonical form is listed with its refusal and never fetched** (`index.ts:232`).
  - **A pinned `fetchedAt` answers later pages from the same document even after the TTL expired** (`index.ts:210`), so paging is stable.
  - **`fetchedAt` is strictly increasing per URL** even when two fetches land in the same millisecond (`index.ts:248`).
  - **The index is parsed in a Worker Thread** so a large index does not block the Host event loop (`parse-thread.ts:1-2`).
  - The default version is "the highest compatible version **without** a prerelease tag, or the highest compatible prerelease when the plugin lists no version without one" (`index.ts:325-328`).
- **Edge cases:** a document that finishes after its source was removed is ignored (`index.ts:249-256`).

### `packages/boot/plugin-market/src/search.ts`
- **Purpose:** Fuzzy filtering, search and ordering over one validated index.
- **Key abstractions:** `MarketSearch` (`select`, `search`, `build`); `searchTerms(text)`.
- **Non-obvious decisions:** **CJK runs are tokenized into overlapping character pairs plus the last character**, so Chinese/Japanese/Korean text matches without a dictionary (`search.ts:11-30`). Terms are NFKC-normalized so composed/decomposed forms, half-width kana and compatibility characters match alike. The MiniSearch index is built **in chunks of 500 with yields between them**, so the first query does not block the event loop (`search.ts:57`, `search.ts:110-140`). Fuzzy matching is `0.2 × term length` for terms of ≥ 4 characters, `maxFuzzy: 2`, `combineWith: 'AND'` (`search.ts:119-125`).

### `packages/boot/plugin-market/src/parse.ts` / `parse-thread.ts` / `worker.ts`
- **Purpose:** Decode, parse and validate a fetched index body off the Host thread.
- **Key abstractions:** `parseIndexBody(body, url): IndexParseResult`; `parseIndexInWorker(body, url, signal)`.
- **Non-obvious decisions:** the body is decoded with **strict UTF-8** (`TextDecoder('utf-8', { fatal: true })`) and a violation is reported as a *located* diagnostic (`$` for UTF-8/JSON errors, a JSON path for format violations) (`parse.ts:24-47`). The Worker **transfers** the body buffer, so the caller's copy is unusable afterwards, and the result comes back by structured clone (`parse-thread.ts:28-33`).

### `packages/boot/plugin-market/src/index-url.ts`
- **Purpose:** Validate and normalize an index source URL.
- **Key abstractions:** `normalizeIndexUrl(text)`.
- **Non-obvious decisions:** **credentials and fragments are refused** in an index URL (`index-url.ts:22-24`).

### `packages/boot/plugin-market/src/tools.ts`
- **Purpose:** The read-only `plugin_market` agent tool.
- **Key abstractions:** `apply(ctx)`; `pageOf(offset, limit)`; `paged(items, page)`; `versionResult(version)`.
- **Non-obvious decisions:** **market text is third-party data, not instructions** — stated in the tool description itself (`tools.ts:68`). Market titles/descriptions are truncated to **300 UTF-16 code units** so one entry cannot dominate the result (`tools.ts:29-34`). Cancelling the call **stops waiting without aborting the shared fetch** (`tools.ts:11-19`, `tools.ts:118-123`).


### `packages/bundle/headless/src/index.ts`
- **Purpose:** The one-shot direct Agent driver: create one Agent (or adopt an exact persisted Session), drive it to quiescence, print the answer, exit.
- **Key abstractions:** `apply(ctx, config)`; `run(ctx, config, io)`; `resolveAgent(...)`; `assertAdoptable(header, events, sessionId, cwd)`; `summarize(session, firstSeq)`; `streamReasoning(ctx, agent, stderr)`.
- **Data flow:** await the whole Loader tree → resolve the model selection → create or resume the Agent → `agent.followup(userMessage)` → loop `whenIdle()` + `subagents.waitForChildren` until quiescent → `sessions.flush()` → summarize from the **durable** session log → print, exit.
- **Non-obvious design decisions:**
  - **The answer is derived from the durable log, never from the live frame** (`index.ts:70-95`).
  - **A session may only be adopted if it was recorded under the same cwd, is not a subagent/fork, and carries no agent preset this bundle does not compose** (`index.ts:186-215`).
  - **A corrupt preset record must not read as "no preset"** — it throws rather than silently running under the wrong composition (`index.ts:167-176`).
  - **A live Agent under the requested id is refused**: the runner cannot claim an exclusive interval over an Agent it did not create (`index.ts:243-251`).
  - **A missing `--session-id` target is an error, not a new session**: "creating the requested id here would turn a typo into a brand-new empty history the caller believes it is continuing" (`index.ts:262-268`).
  - The quiescence loop **re-checks the child settlement after the parent turn completes**, because a child can wake the parent (`index.ts:385-392`).
- **Edge cases & failure handling:** `--session-id` requires both the `sessionPersistence` and `sessionQuery` services; a miscomposed profile **fails loud before the resume** rather than losing the history at exit (`index.ts:225-241`).

### `packages/bundle/headless/src/json-stream.ts`
- **Purpose:** The `--json` projection: a bounded, ordered newline-delimited event stream derived from one Agent's durable Session events.
- **Key abstractions:** `projectJsonRun(ctx, agent, sink, options)`; `boundJsonLine(event, maxStringBytes, maxEventBytes)`; `MAX_STRING_BYTES = 8 KiB`, `MAX_EVENT_BYTES = 32 KiB`, `MAX_DEPTH = 64`.
- **Non-obvious design decisions:**
  - **Every projected event is a commit point**: text and reasoning come from committed `assistant/message` content, "never from a live attempt that may still be retried or discarded" (`json-stream.ts:1-5`).
  - **A partial token total is omitted entirely** — "a partial sum would read as an exact total" (`json-stream.ts:298-306`).
  - **A retried attempt's usage is accumulated** into the step total, because the committed message alone would under-report billed tokens (`json-stream.ts:187-215`).
  - **The bounding is two-stage**: strings and keys are capped first; if the serialized line is still too long, structured fields are dropped and only scalars survive; if even that is too long, only `type` and `truncated` remain (`json-stream.ts:141-166`).
  - Objects are rebuilt with a **null prototype** so a literal `__proto__` key stays data (`json-stream.ts:82-90`).
  - **The terminal `final` event is deliberately unbounded** — it is the lossless answer (`json-stream.ts:279-284`).
- **Edge cases:** a `tool/result` whose `surfaceOp !== 'append'` is skipped (compaction replaced it; it would duplicate a callId) (`json-stream.ts:253-255`).

### `packages/bundle/headless/src/startup.ts`
- **Purpose:** The one-shot command-line provider: the task positional, `--session-id`, `--json`, `--help`.
- **Key abstractions:** `HEADLESS_STARTUP_SERVICE`; `apply(ctx)`; `jsonRequested(argv)`.
- **Non-obvious decisions:** **the raw argv decides the JSON contract, not Commander's parse** — a grammar error still owes a `--json` caller an error event, so `program.error` is replaced with a JSON line plus the same control-flow error (`startup.ts:63-75`). The `--json` scan stops at `--` and skips a `--session-id` value, so a literal `--json` used as an option value never installs the override (`startup.ts:56-60`).

### `packages/bundle/web-app/src/index.ts`
- **Purpose:** The browser-surface runtime glue: resolve the built frontend dist, mount the static fallback, register the bash-visible web runtime variable, and open the default browser.
- **Key abstractions:** `WebApp` service (`ctx.webApp`) with `getAdvertisedUrl()`.
- **Non-obvious decisions:** **an advertised `publicUrl` replaces the published bind-address URL** — it grants no trust by itself (`index.ts:1-12`). **Non-loopback HTTP binds trigger an exposure warning** (`index.ts:10-11`). The frontend dist is **workspace knowledge of the bundle, never user config** (`index.ts:3-4`).

### `packages/bundle/web-app/src/public-url.ts`
- **Purpose:** Parse the advertised public HTTP(S) root of a prefix-stripping proxy deployment.
- **Key abstractions:** `parsePublicUrl(value, label)`.
- **Non-obvious decisions:** it **rejects hazards WHATWG URL parsing would accept** — control characters, a query or fragment, credentials (including an empty user), and an empty authority (`public-url.ts:15-36`).

### `packages/bundle/web-app/src/startup.ts`
- **Purpose:** The Web flag family (`--host`, `--port`, `--public-url`, `--trusted-host`, `--no-open`, TLS) published as `webStartup`.
- **Key abstractions:** `WEB_STARTUP_SERVICE`; `WebStartupValues`.
- **Non-obvious decisions:** **a wildcard `--host` is refused**: "binding every interface would expose remote code execution to the network" (`startup.ts:106-108`). `--tls-cert` and `--tls-key` must be supplied **together** (`startup.ts:113-117`).

### Bundle composition pattern
- **Purpose:** The shipped profile compositions — the whole "what is a profile" story in YAML.
- **Key abstractions:** a top-level YAML array of loader patch entries (`id`/`name`/`config`/`disabled`/`inject` plus `insert` lists).
- **Non-obvious design decisions:**
  - **A patch replaces the targeted row's whole `config` rather than merging into it.** "A row whose value differs by mode does NOT live here: it belongs to each mode bundle, keeping any single row down to one bundle layer plus the user's" (`base/cordis.patch.yml:6-13`).
  - **Row order carries no load semantics** — activation is service-availability driven (`base/cordis.patch.yml:14-15`).
  - **The base composes, the mode bundles configure.** The base row for `session-query-sqlite` ships `openAt: never` so SQLite is never opened by default; a deployment overrides it in a later patch layer (`base/cordis.patch.yml:139-153`).
  - **Platform gating is symmetric**: `bash-sandbox` is disabled on Windows and `pwsh-sandbox` on everything else (`base/cordis.patch.yml`).
  - **`sdk-minimal` does not layer over the base at all**: "this insert is the complete Cordis tree" (`sdk-minimal/cordis.patch.yml:1-4`).
  - The Web surface ships **four agent presets** (`cordis`, `minimal`, `ptc`, `standard`), each an `agent-preset` row plus its tool roster grouped by `cordis:group` — `planning`, `compaction`, `delegation`.
- **Edge cases:** the `headless` patch **disables the credential store and authorization** because one-shot jobs use launch-time credentials (`headless/cordis.patch.yml:35-44`).

### `packages/telemetry/otel/src/session-log.ts`
- **Purpose:** A byte-bounded, independent OTLP queue for feedback-authorized Session logs.
- **Key abstractions:** `SessionLogReporter`; `SessionLogProcessor` (a custom `LogRecordProcessor`); `resolveSessionLogLimits(options)`; `SESSION_LOG_MAX_REQUEST_BYTES = 4_000_000`.
- **Non-obvious design decisions:**
  - **A record that exceeds the request ceiling is rejected whole — never truncated** (`session-log.ts:107-111`).
  - **Only one transport request is in flight**, and the watchdog **does not release the request slot** — it warns and keeps waiting (`session-log.ts:145-159`).
  - **Mounting the service creates no queue, identity or connection**; the caller owns disposal and the outer deadline (`session-log.ts:176-196`).
- **Edge cases:** a serialization failure rejects that record and continues; a failed HTTP request is reported and the queue continues.

### `packages/telemetry/otel/src/event-log.ts` / `event-transport.ts` / `transport.ts` / `index.ts`
- **Purpose:** The ordinary-event channel and the shared OTLP HTTP transport.
- **Key abstractions:** `EventLogReporter`; `createEventLogExporter(options, signal)`; `createLogExporter(options)`; `logTransportOptions(options)`.
- **Non-obvious decisions:** **the two channels share no state** — each has its own exporter, resource, scope and queue (`index.ts:19-30`). The event record's `body` is "never a prompt, response, credential, or file contents" (`event-log.ts:19-21`). The transport **does not inherit another collector's headers or TLS identity** (`transport.ts:22-27`). The event exporter's response body is capped at **4 MiB**, matching the SDK's OTLP limit (`event-transport.ts:59-60`).

### `packages/workspace/workspace/src/index.ts`
- **Purpose:** The durable workspace registry: an ordered list of project directories and the sessions grouped under each.
- **Key abstractions:** `WorkspaceRegistry extends Service` (`ctx.workspaceRegistry`); `create`, `initializeDefault`, `get`, `list`, `delete`, `insertBefore`, `archiveSession`, `unarchiveSession`, `pinSession`, `unpinSession`, `resolveByPath`; errors `WorkspaceUnknownSessionError`, `WorkspaceActiveSessionError`, `WorkspaceArchivedSessionPinError`, `WorkspaceOrderInvalidError`; events `workspace/session-activity` (waterfall) and `workspace/session-stop` (parallel).
- **Data flow:** open the domain → recover a pending mutation → validate the stored state → bootstrap once from the stored session headers → index live sessions → rebuild the entity cache. Every mutation runs through `enqueueOperation`, a **promise tail that serializes the whole registry** (`index.ts:894-903`).
- **Non-obvious design decisions:**
  - **A recoverable two-write marker**: `pendingMutation` is persisted *before* the record/order pair can diverge, so startup can distinguish an interrupted operation from corruption (`spec.ts:35-43`, `index.ts:636-648`).
  - **Archiving never touches workspace accounting** — an archived session keeps its `sessionIds` slot so unarchiving restores its position (`index.ts:339-343`).
  - **Pinning and archival are mutually exclusive**; archiving drops the pin in the same durable write (`index.ts:380-384`).
  - **With `stopActivity`, the archive is written FIRST and the stops are requested afterwards**; "the durable archive set is what a provider's `agent/pre-step` gate reads, so every wake the stops induce is already blocked" (`index.ts:349-354`, `index.ts:373-386`).
  - **A failed provider stop is logged, never a reason to keep the session visible** (`index.ts:481-493`).
  - **A missing directory never mutates the record** — the directory may only be temporarily moved (`types.ts:172-177`).
  - **The default workspace's title is the requested directory's own final segment, not the canonical one**, "so a symlink at that path does not retitle the Workspace after its target" (`index.ts:252-256`).
- **Edge cases & failure handling:** `validateStoredState` **fails loud** on a duplicated order entry, a missing record, an orphan record or a path claimed twice (`index.ts:744-785`). When a deletion committed at the table write but the marker could not be cleared, the failure is **logged rather than reported** — "the requested state became true" (`index.ts:618-627`).

### `packages/workspace/workspace/src/entity.ts`
- **Purpose:** The single `Workspace` implementation, with one private write path.
- **Key abstractions:** `WorkspaceEntity`; `WorkspaceEntityHost`; `WorkspaceMoveInvalidError`; the `unchangedSentinel`.
- **Non-obvious decisions:** **every write funnels through `mutate()`**, so `updatedAt` stamping and invalid-candidate pruning happen exactly once (`entity.ts:1-6`, `entity.ts:180-208`). The update fn runs **on the domain write chain**, so membership decisions are race-free against queued writes (`entity.ts:186-190`). A no-op aborts the slot through a sentinel, so it "neither rewrites the medium nor emits a change event" (`entity.ts:201-206`).

### `packages/workspace/workspace/src/spec.ts` / `paths.ts` / `types.ts`
- **Purpose:** The durable schema, the path canon and the public interface.
- **Key abstractions:** `workspaceRecord`, `workspaceDomainState`, `workspaceDomainSpec` (version 2); `realpathNormalize`, `fullyQualifiedWorkspacePath`, `defaultWorkspaceTitle`; the `Workspace` interface and `WorkspaceId` brand.
- **Non-obvious decisions:**
  - **`fs.realpath` is the ONE uniqueness canon** — "a symlink to an existing workspace's directory collides" (`paths.ts:44-51`).
  - **A relative path rejects before `realpath` can resolve it** from the Host cwd or the current Windows drive (`paths.ts:44-46`).
  - **A missing path rejects with the original `ENOENT`** — a workspace must point at an existing directory (`paths.ts:47-51`).
  - **The id is a uuid, never the path**, because path normalization rewrites paths and a reference anchor must stay stable (`types.ts:12-16`).
  - **The archived and pinned sets are defaulted** so records written before the fields parse unchanged (`spec.ts:60-78`).

### `packages/ptc-runtime/ptc-runtime/src/index.ts` / `types.ts`
- **Purpose:** The abstract PTC execution seam (`ctx.ptcRuntime`): run one model-written program against host-provided async bindings.
- **Key abstractions:** `PtcRuntime extends Service` (abstract `language`, `isolation`, `resolve(request)`, `run(spec)`); `PtcRunRequest`, `PtcRunSpec`, `PtcRunResult`, `PtcRunFailure`; `PtcBindingNamespace`, `PtcBindingFunction`, `PtcBindingErrorClass`.
- **Non-obvious decisions:**
  - **A failed program is a FIELD on a resolved result, never a rejection** — "reporting a failed program is the caller's job, not an exception path" (`types.ts:154-166`).
  - **Failure kinds are orthogonal**: a timeout is not an exception, an abort is not a timeout, a substrate death is neither (`types.ts:129-152`).
  - **One shared set of reserved binding globals across every backend**, "so a caller cannot pick a name that works on Node and collides on Python" (`index.ts:17-35`).
  - **`PORTABLE_RESERVED_WORDS` is the union of ECMAScript and Python reserved words**, because a per-language check would let `lambda` pass the TypeScript backend and fail the Python one (`index.ts:52-77`).
  - **`language` and `isolation` are descriptors, not security claims** (`index.ts:114-133`).

### `packages/ptc-runtime/ptc-runtime-node/src/config.ts` / `bindings.ts` / `environment.ts` / `launch.ts` / `process.ts` / `protocol.ts` / `channel.ts`
- **Purpose:** The Node backend's configuration, binding validation, environment scrubbing, launch selection, child-process entry and wire protocol.
- **Key abstractions:** `NodeConfig` (Schemastery) and `validateConfig`; `validateBindings(request)`; `clearProgramEnvironment(state)`; `resolveLaunch(config)` / `bootstrapArgs(...)`; `runNodeMain(stream, maxMessageBytes, processState)`; the `ProgramToHost`/`ReplyMessage` unions; `JsonChannel`.
- **Non-obvious decisions:**
  - **`process.env` starts EMPTY for the program**; only `PATH`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`, `TEMP`, `TMP` survive, because native child processes need them (`environment.ts:4-16`).
  - **Every host-side validation message names the seam's shared rule** rather than the Node backend's preference (`bindings.ts:16-25`).
  - **The wire protocol is validated by the host** because "model code can write directly to the inherited descriptor" (`protocol.ts:1-4`).
  - **Logs stream eagerly** so output survives a mid-run termination (timeout, abort, OOM) (`protocol.ts:44-48`).
  - **The control channel is length-prefixed with a bounded input and bounded queued writes** (`channel.ts:1-3`).
- **Edge cases:** a binding resolution that is not lossless JSON is an error, never a corrupted value (`bindings.ts:70-72`).

### `packages/ptc-runtime/ptc-runtime-node/src/output-json.ts` / `output-ledger.ts` / `output-stream.ts` / `policy-processes.ts`
- **Purpose:** Exact byte accounting for retained output, bounded drainage after termination, and process invalidation on a policy change.
- **Key abstractions:** `jsonStringBytesUpTo`, `jsonValueBytesUpTo`, `truncateJsonStringBytes`; `OutputLedger`; `drainOutput`, `terminateProcess`; `PolicyProcesses`.
- **Non-obvious decisions:**
  - **Every JSON measurement uses module-captured intrinsics** (`Reflect.apply`, `Array.isArray`, `Buffer.byteLength`, …) so a model that mutates `Array.prototype` cannot change the accounting (`output-json.ts:9-31`).
  - **The size of a JSON string is measured without materializing its escaped form**, and the cap is reported as soon as it is crossed (`output-json.ts:92-110`).
  - **Truncation is code-point aligned** — a split surrogate is never produced (`output-json.ts:54-61`).
  - **The output limit takes precedence over the failure diagnostic** when the combined bytes exceed the cap (`output-ledger.ts:22-25`).
  - **A policy change invalidates the processes of that session and the next admission waits for their cleanup** (`policy-processes.ts:23-36`, `policy-processes.ts:75-78`).

### `packages/ssh/ssh/src/index.ts` / `helper.ts` / `helper-processes.ts` / `protocol.ts` / `schemas.ts` / `stream-security.ts` / `helper-entry.ts`
- **Purpose:** The OpenSSH connection owner, the private remote helper, its process ownership and the versioned RPC wire.
- **Key abstractions:** `SshConnection extends Service` (`ctx.ssh`); `HelperLaunch` (`node-script` | `executable`); `Config { host, launch, helper, helperHash, workspace, requestTimeoutMs, maxFrameBytes, maxPending, leaseMs }`; `runSshHelper(transport)`; `SshRpcPeer`; `SSH_PROTOCOL_VERSION = 2`; `authenticateStream(socket, capability, timeoutMs, signal)`.
- **Non-obvious decisions:**
  - **The connection verifies installed artifact digests before readiness** — a `helperHash` mismatch refuses the connection (`index.ts:49-51`).
  - **Forwarded streams are authenticated with TLS-PSK**, not certificates: "PSK proves peer identity without an X.509 certificate or hostname", and there is **no unauthenticated cipher fallback** (`stream-security.ts:5-8`, `stream-security.ts:22-24`).
  - **The per-stream 256-bit capability key is never transmitted as data** (`stream-security.ts:17-19`).
  - **Management requests (heartbeat, close, terminate, streamClose) have reserved capacity** separate from the ordinary request budget, so cleanup still works when the ordinary budget is full (`protocol.ts:16-31`).
  - **The helper owns remote cleanup** when the connection closes or its lease expires (`index.ts:41-42`).
  - **The helper entry accepts no command arguments** and reports every failure on stderr with exit code 127 (`helper-entry.ts:11-24`).
- **Edge cases:** the helper's filesystem and subprocess effects run through the *installed local providers* on the remote host, so the remote sandbox semantics match the local ones (`helper.ts:1-2`).

### `packages/ssh/fs-ssh/src/index.ts` / `sandbox-ssh/src/index.ts` / `subprocess-ssh/src/index.ts` / `ssh-helper-runtime/src/index.ts`
- **Purpose:** The remote filesystem, sandbox and subprocess providers, plus the private packaged helper carrier.
- **Key abstractions:** `SshFileSystem extends FileSystem`; `SshSandboxProvider extends SandboxProvider`; the SSH subprocess runtime; `runSshHelperRuntime()`.
- **Non-obvious decisions:**
  - **Remote paths keep their canonical spelling** and the relative spelling is sent to the remote resolver (`fs-ssh/src/index.ts:36-40`).
  - **Remote errors are mapped back to the local filesystem's error codes**, so a consumer cannot tell a remote `FS_PERMISSION_DENIED` from a local one (`fs-ssh/src/index.ts:100-107`).
  - **The sandbox provider resolves the policy on the SSH host**, so Bash and Node receive the *same* backend's enforcement level and denial signatures (`sandbox-ssh/src/index.ts:5-8`).
  - **The SEA dispatcher selects the helper, the subprocess runner or the PTC worker by an environment variable and then DELETES it**, so the choice cannot leak into a child (`ssh-helper-runtime/src/index.ts:29-38`).

### Remaining bundle source files
- `packages/bundle/acp-app/src/index.ts` — the ACP zero-option command provider; **the ACP bridge waits for the startup service**, so `--help` starts no transport (`acp-app/src/index.ts:1-6`).
- `packages/bundle/sdk-app/src/index.ts` — the SDK equivalent; publishes `SDK_APP_STARTUP_SERVICE` with the selected profile name (`sdk-app/src/index.ts:38-60`).
- `packages/bundle/sdk-minimal/src/index.ts` and `packages/bundle/base/src/index.ts` — **empty modules**: "The package's substance is `cordis.patch.yml`" (`sdk-minimal/src/index.ts:1-6`).
- `packages/bundle/headless/src/runner-internals.ts` and `startup-internals.ts` — the injectable process streams and process facts, kept out of the package entry "so substituting them in tests adds no public package API".


### Tier 2 — bulk: the bundle, PTC, SSH, telemetry and workspace families

| File | What it is / what it pins |
| --- | --- |
| `packages/bundle/README.md` | Bundle group index: each package declares `dsh.bundle.patch`; the launcher stacks those patch documents to assemble a named profile; `sdk-minimal` supplies its complete tree in one bundle. |
| `packages/bundle/README.zh.md` | Chinese mirror of the bundle group README. |
| `packages/bundle/base/README.md` | The shared core contract: model connection, full tool set, durable session history and workspace safety defaults for every base-backed surface. |
| `packages/bundle/base/README.zh.md` | Chinese mirror of the base README. |
| `packages/bundle/base/cordis.patch.yml` | The base composition: ~110 rows covering LLM/session/tools/sandbox/compaction/subagent/PTC/storage/telemetry, with per-row comments naming the invariant each row defends. |
| `packages/bundle/base/package.json` | `@deepseek-ai/dsh-base` manifest: the full dependency list that *is* the base composition, plus the `dsh.bundle.patch` declaration. |
| `packages/bundle/base/tsconfig.json` | Project references to cordis, config-editor and settings. |
| `packages/bundle/base/tests/base.spec.ts` | Pins that the patch list parses and is declared through the manifest field, and that each shell stack is gated by a symmetric platform `disabled` expression. |
| `packages/bundle/base/tests/fixtures/root.cordis.yml` | The empty root entry list (`[]`) used as the composition root in tests. |
| `packages/bundle/acp-app/README.md` | The ACP profile contract: inherits the base's disabled module-HMR policy, sets the coding-agent persona and model route, mounts a zero-option command provider, and starts the ACP bridge only after that provider accepts the invocation. |
| `packages/bundle/acp-app/README.zh.md` | Chinese mirror of the acp-app README. |
| `packages/bundle/acp-app/cordis.patch.yml` | The ACP composition: persona prefix, session-title LLM disabled, the startup row, the ACP row gated on `acpAppStartup`, and HMR disabled. |
| `packages/bundle/acp-app/package.json` | `@deepseek-ai/dsh-acp-app` manifest with the `dsh.bundle.patch` declaration. |
| `packages/bundle/acp-app/tsconfig.json` | Project references to cordis and cmdline. |
| `packages/bundle/acp-app/tests/acp-app.spec.ts` | Pins startup-gated ACP serving without overriding the base HMR policy. |
| `packages/bundle/acp-app/tests/startup.spec.ts` | Pins that readiness is published and EOF requests a bounded exit, and that `--help` publishes neither readiness nor binds stdin. |
| `packages/bundle/headless/README.md` | The one-shot profile contract: one task per invocation, final answer on stdout, `--json` event stream, `--session-id` resume, exit 0 = completed / 1 = aborted. |
| `packages/bundle/headless/README.zh.md` | Chinese mirror of the headless README. |
| `packages/bundle/headless/cordis.patch.yml` | The headless composition: persona, tools mode, the startup row, the runner row wired through `ctx.headlessStartup`, HMR disabled and the credential rows disabled (launch-time credentials). |
| `packages/bundle/headless/package.json` | `@deepseek-ai/dsh-headless` manifest; exports the `./startup` subpath and ships the patch. |
| `packages/bundle/headless/tsconfig.json` | Project references to agent, llm, session, session-query, fs, subagent and cmdline. |
| `packages/bundle/headless/tests/headless.spec.ts` | Pins the runner's quiescence loop: child settlement waking the parent, later child batches, re-checking children after a parent turn, and the durable summary as the outcome source. |
| `packages/bundle/headless/tests/json-stream.spec.ts` | Pins the `--json` projection: the opening `session` event precedes every observed event, the cwd and per-string cap defaults, turn/step boundaries, and the bounded payload shapes. |
| `packages/bundle/headless/tests/startup.spec.ts` | Pins the command-line provider: the task positional joined into the runner config, the JSON mode, the exact session identity, the `-` stdin marker, and the usage errors. |
| `packages/bundle/headless/tests/terminal-failures.spec.ts` | Pins that a failed summary hook falls back to the durable outcome, and that a recovered summary accepts a missing `turn/start` or `turn/end`. |
| `packages/bundle/headless/tests/fixtures/provider-cwd.ts` | Test fixture that supplies a provider with a known cwd for the runner's adoptability checks. |
| `packages/bundle/sdk-app/README.md` | The SDK profile contract: a zero-option command provider publishes readiness; the JSON-RPC server starts only after it; `--help` exits without claiming stdio. |
| `packages/bundle/sdk-app/README.zh.md` | Chinese mirror of the sdk-app README. |
| `packages/bundle/sdk-app/cordis.patch.yml` | The SDK composition: persona, the startup row with the profile name, the JSON-RPC server gated on `sdkAppStartup` + `loader` with a `DSH_MAX_TOKENS_AS_SUCCESS` expression, and the packaged-carrier workspace/skill rows driven by `DSH_PRIMARY_RUNTIME`. |
| `packages/bundle/sdk-app/package.json` | `@deepseek-ai/dsh-sdk-app` manifest with the `dsh.bundle.patch` declaration. |
| `packages/bundle/sdk-app/tsconfig.json` | Project references to cordis, schemastery and cmdline. |
| `packages/bundle/sdk-app/tests/sdk-app.spec.ts` | Pins startup-gated JSON-RPC serving without overriding the base HMR policy. |
| `packages/bundle/sdk-app/tests/startup.spec.ts` | Pins readiness + bounded EOF exit, `--help` publishing neither, and the selected profile name appearing in the help text. |
| `packages/bundle/sdk-minimal/README.md` | The standalone SDK contract: persistent shell, `read_image`, `working_directory`, uncompressed JSONL sessions, model from the SDK init request; **excludes** base, Web, settings, managed credentials, telemetry, text file tools, skills, jobs and subagents. |
| `packages/bundle/sdk-minimal/README.zh.md` | Chinese mirror of the sdk-minimal README. |
| `packages/bundle/sdk-minimal/cordis.patch.yml` | The complete standalone tree: JSON-RPC server, one DeepSeek adapter, persistent bash/pwsh, JSONL sessions, `danger-full-access` sandbox policy, and explicitly named minimal kernel rows. |
| `packages/bundle/sdk-minimal/package.json` | `@deepseek-ai/dsh-sdk-minimal` manifest: the complete allowlisted dependency set of the standalone tree. |
| `packages/bundle/sdk-minimal/tsconfig.json` | Project references to cordis only. |
| `packages/bundle/sdk-minimal/tests/sdk-minimal.spec.ts` | Pins that the bundle declares one standalone allowlisted tree with every row dependency. |
| `packages/bundle/web-app/README.md` | The browser-surface contract: the frontend dist is bundle-owned, `publicUrl` advertises without granting trust, and Desktop analytics (not Web) is collected with 30 s batches, 15 s export timeout, 20 s processor timeout and a 2 s shutdown drain. |
| `packages/bundle/web-app/README.zh.md` | Chinese mirror of the web-app README. |
| `packages/bundle/web-app/cordis.patch.yml` | The Web composition: surface-specific persona, the in-memory session index, the browser roster (`dsh.client` rows), the transport layer, the desktop telemetry rows and the webserver row. |
| `packages/bundle/web-app/presets/cordis.patch.yml` | The `cordis` agent preset: persona, time context, shell/fs/jobs/schedule tools, and the `planning` / `compaction` / `delegation` groups. |
| `packages/bundle/web-app/presets/minimal.patch.yml` | The `minimal` preset: persona, fs read-only, compaction group, and a persistent bash/pwsh shell group. |
| `packages/bundle/web-app/presets/ptc.patch.yml` | The `ptc` preset: the full tool roster plus `tool-presentation` and a PTC workflow row. |
| `packages/bundle/web-app/presets/standard.patch.yml` | The `standard` preset: the full roster without the PTC presentation row. |
| `packages/bundle/web-app/package.json` | `@deepseek-ai/dsh-web-app` manifest: the Web surface's client and host dependency set. |
| `packages/bundle/web-app/tsconfig.json` | Project references to cordis, schemastery, loader, app-boot, cmdline, connection, frontend-static, webserver, launch-environment, shell-env and subprocess. |
| `packages/bundle/web-app/locale/en.json` | English display title for the bundle. |
| `packages/bundle/web-app/locale/zh.json` | Chinese display title and description for the bundle. |
| `packages/bundle/web-app/locale/startup/en.json` | English display title for the startup row. |
| `packages/bundle/web-app/locale/startup/zh.json` | Chinese display title for the startup row. |
| `packages/bundle/web-app/tests/browser-defaults.spec.ts` | Pins the browser defaults the bundle chooses when the invocation names none. |
| `packages/bundle/web-app/tests/browser-open.spec.ts` | Pins that the canonical URL is opened **only after the complete page is reachable**. |
| `packages/bundle/web-app/tests/document-conversion.e2e.ts` | Pins that one shared conversion row loads and that caller-owned PDFs survive disposal. |
| `packages/bundle/web-app/tests/document-preview.spec.ts` | Pins that the shipped Office rows load with separately patched settings and authorized PDF output. |
| `packages/bundle/web-app/tests/fixtures/document-conversion.docx` | Binary fixture document (869 bytes) for the conversion e2e; opened and identified, not parsed. |
| `packages/bundle/web-app/tests/product-analytics.spec.ts` | Pins that collection and its shutdown are limited to the Desktop launch (desktop vs web). |
| `packages/bundle/web-app/tests/public-url.spec.ts` | Pins `parsePublicUrl`: canonical HTTP(S) roots accepted, a missing trailing slash normalized, and the rejected hazards. |
| `packages/bundle/web-app/tests/startup.spec.ts` | Pins the web flag provider: each flag published, wildcard `--host` rejected before any consumer activates, deployment values left to each consumer, and TLS pairing. |
| `packages/bundle/web-app/tests/web-app.spec.ts` | Pins the runtime glue: the advertised public root behind a prefix-stripping proxy, and that disabling printing and browser opening publishes no readiness side effect. |
| `packages/ptc-runtime/README.md` | PTC family map: the default Node backend starts a fresh process under the sandbox policy; `persistent-in-memory` keeps a separate confined REPL per explicit state owner; the Python backend is experimental; **failures return as results**. |
| `packages/ptc-runtime/README.zh.md` | Chinese mirror of the ptc-runtime group README. |
| `packages/ptc-runtime/ptc-runtime/README.md` | The seam contract: lossless JSON results, captured logs or structured failures; a provider may retain memory for an explicit owner until release and never restores it from a Session. |
| `packages/ptc-runtime/ptc-runtime/README.zh.md` | Chinese mirror of the ptc-runtime README. |
| `packages/ptc-runtime/ptc-runtime/package.json` | `@deepseek-ai/dsh-ptc-runtime` manifest (seam only; peers on cordis and the sandbox package). |
| `packages/ptc-runtime/ptc-runtime/tsconfig.json` | Project references to cosmokit, cordis and the sandbox package. |
| `packages/ptc-runtime/ptc-runtime/tests/reserved.spec.ts` | Pins the three seam-owned exclusion sets: `RESERVED_BINDING_GLOBALS`, `RESERVED_ERROR_MEMBERS` and `DUNDER_MEMBER`. |
| `packages/ptc-runtime/ptc-runtime/tests/service.spec.ts` | Pins the seam: registers as `ctx.ptcRuntime`, reports a failed run as an error field (never a rejection), and reports a pre-aborted signal as an abort failure. |
| `packages/ptc-runtime/ptc-runtime-node/README.md` | The Node backend contract: `per-call` starts a fresh process under the platform sandbox; `persistent-in-memory` retains a confined REPL per Agent; elapsed deadlines, output bounds and a V8 heap limit constrain execution; a restricted mode fails when its backend is unavailable. |
| `packages/ptc-runtime/ptc-runtime-node/README.zh.md` | Chinese mirror of the ptc-runtime-node README. |
| `packages/ptc-runtime/ptc-runtime-node/locale/en.json` | English display title for the Node PTC provider. |
| `packages/ptc-runtime/ptc-runtime-node/locale/zh.json` | Chinese display title and description. |
| `packages/ptc-runtime/ptc-runtime-node/package.json` | `@deepseek-ai/dsh-ptc-runtime-node` manifest; exports the private `./process` child entry. |
| `packages/ptc-runtime/ptc-runtime-node/tsconfig.json` | Project references to session, cosmokit, cordis, schemastery, the seam, timeout, fs, subprocess and the sandbox packages. |
| `packages/ptc-runtime/ptc-runtime-node/tsdown.config.ts` | Three build entries: the provider plus the two private child bootstraps, each inlining `@deepseek-ai/dsh-subprocess/control`. |
| `packages/ptc-runtime/ptc-runtime-node/tests/bindings.spec.ts` | Pins binding validation: unusable globals rejected (`$name`, `while`, `lambda`, `console`), duplicates rejected, arbitrary own member names accepted. |
| `packages/ptc-runtime/ptc-runtime-node/tests/bootstrap.spec.ts` | Pins `LogBuffer` (streams until the byte budget, then one fitting prefix and one limit report) and the console shim. |
| `packages/ptc-runtime/ptc-runtime-node/tests/built-lib.e2e.ts` | Runs a TypeScript program with a binding through the **built** `lib/index.js` and `lib/process.js` entries. |
| `packages/ptc-runtime/ptc-runtime-node/tests/channel.spec.ts` | Pins the length-prefixed frame channel: split headers and UTF-8 bodies reassembled, consecutive frames accepted, an over-long declared frame rejected before its body. |
| `packages/ptc-runtime/ptc-runtime-node/tests/execution-mode.spec.ts` | Pins that unsupported execution-mode names are rejected at configuration parsing and that retained state is cleared when the mode changes. |
| `packages/ptc-runtime/ptc-runtime-node/tests/host-failures.spec.ts` | Pins the host failure taxonomy: the deployment mode is reported, unsupported resolved inputs are rejected before spawning, an unavailable required sandbox fails before spawning, and partial enforcement stays separate from a successful program. |
| `packages/ptc-runtime/ptc-runtime-node/tests/json-wire.spec.ts` | Pins the lossless-JSON snapshot boundary: scalars, detached dense arrays, plain and null-prototype records, and intrinsics from another realm. |
| `packages/ptc-runtime/ptc-runtime-node/tests/launch.spec.ts` | Pins launch selection: an explicit installed bootstrap is used without pretending it maps the host file, an unreadable bootstrap fails, a remote embedded worker is used when the client runs plain Node. |
| `packages/ptc-runtime/ptc-runtime-node/tests/output-json.spec.ts` | Pins the byte accounting: every JSON escape accounted, cutting only between complete code points, and hostile strings bounded without materializing the escaped form. |
| `packages/ptc-runtime/ptc-runtime-node/tests/output-ledger.spec.ts` | Pins the combined ledger: exact escaping, separators and optional completion values accounted; a bounded prefix retained when logs or the diagnostic exceed the limit. |
| `packages/ptc-runtime/ptc-runtime-node/tests/output-stream.spec.ts` | Pins bounded drainage: an already-ended or absent stream accepted, an output descriptor retained after exit bounded, and `close`/`error` reported as incomplete output. |
| `packages/ptc-runtime/ptc-runtime-node/tests/persistent-built.e2e.ts` | Retains variables through the **built** provider and the sibling process entry. |
| `packages/ptc-runtime/ptc-runtime-node/tests/persistent-host.spec.ts` | Pins the policy interaction: a call is cancelled when its session policy changes before launch, an approved wider call survives an unchanged standing mode, a cancelled call stays cancelled when the policy changes back, and a retained call is refused when the provider unloads. |
| `packages/ptc-runtime/ptc-runtime-node/tests/persistent-process.spec.ts` | Pins the REPL child: an injected process stays local to the REPL, the environment survives while each evaluation and its binding replies are captured separately, and an old asynchronous exception does not finish a later evaluation. |
| `packages/ptc-runtime/ptc-runtime-node/tests/persistent-sandbox.spec.ts` | Pins retained-state confinement: read-only retains variables and denies writes, workspace-write refuses a sibling path, reuse under another policy is refused until the owner is released, and confinement failure closes without spawning Node. |
| `packages/ptc-runtime/ptc-runtime-node/tests/persistent.spec.ts` | Pins the REPL: declarations, closures, object identity and imports retained across evaluations; implicit REPL globals retained; a completed callback exception not attributed to a later evaluation. |
| `packages/ptc-runtime/ptc-runtime-node/tests/policy-processes.spec.ts` | Pins policy-driven invalidation: cleanup starts without another execution, the standing policy governs a temporary escalation, a failed cleanup is retried before admission, and unload waits for all processes. |
| `packages/ptc-runtime/ptc-runtime-node/tests/process-main.spec.ts` | Pins the child main: the environment is cleared, a binding reply is dispatched, the terminal frame is flushed, the control pipe stays open for a late reply, and an invalid frame limit is rejected. |
| `packages/ptc-runtime/ptc-runtime-node/tests/process.spec.ts` | Boots an unbuilt source closure outside the workspace and exchanges tool replies. |
| `packages/ptc-runtime/ptc-runtime-node/tests/runtime.spec.ts` | Pins the runtime: erasable TypeScript runs in the resolved directory with an empty environment, native startup paths stay available for nested Node creation, binding values are returned, and typed binding rejections are preserved. |
| `packages/ptc-runtime/ptc-runtime-node/tests/setup.ts` | Shared test setup for the provider suite. |
| `packages/ssh/README.md` | SSH family map: files, ordinary processes, terminals and sandbox enforcement run on one POSIX SSH host while the Harness stays local. |
| `packages/ssh/README.zh.md` | Chinese mirror of the ssh group README. |
| `packages/ssh/fs-ssh/README.md` | The remote filesystem contract: file tools read and mutate the same files remote Bash, terminals, language servers and Node programs see; canonicalization, version guards and atomic mutations use the local implementations installed beside the helper. |
| `packages/ssh/fs-ssh/README.zh.md` | Chinese mirror of the fs-ssh README. |
| `packages/ssh/fs-ssh/package.json` | `@deepseek-ai/dsh-fs-ssh` manifest. |
| `packages/ssh/fs-ssh/tsconfig.json` | Project references to cordis, schemastery, ssh, fs and the sandbox packages. |
| `packages/ssh/fs-ssh/tests/provider.spec.ts` | Pins the remote filesystem: watching is declared unsupported without a remote request, remote canonical paths are kept while the relative spelling goes to the remote resolver, and the error-code mapping holds. |
| `packages/ssh/sandbox-ssh/README.md` | The remote sandbox contract: the remote host selects its installed local sandbox backend and applies each call's policy there; Bash and Node receive the same enforcement level and denial signatures. |
| `packages/ssh/sandbox-ssh/README.zh.md` | Chinese mirror of the sandbox-ssh README. |
| `packages/ssh/sandbox-ssh/package.json` | `@deepseek-ai/dsh-sandbox-ssh` manifest. |
| `packages/ssh/sandbox-ssh/tsconfig.json` | Project references to cordis, schemastery, ssh and sandbox. |
| `packages/ssh/sandbox-ssh/tests/provider.spec.ts` | Pins the remote sandbox: the policy is resolved remotely and the literal enforcing argv returned; current backend facts are obtained for every policy; malformed facts are refused. |
| `packages/ssh/ssh-helper-runtime/README.md` | The packaged helper contract: each archive includes the executable, its native resources and integrity metadata; the carrier supports managed processes, terminals, sandboxing and an embedded PTC worker. |
| `packages/ssh/ssh-helper-runtime/README.zh.md` | Chinese mirror of the ssh-helper-runtime README. |
| `packages/ssh/ssh-helper-runtime/package.json` | Private `@deepseek-ai/dsh-ssh-helper-runtime` manifest: the whole dependency closure the SEA executable carries. |
| `packages/ssh/ssh-helper-runtime/tsconfig.json` | Project references to cordis, ssh, subprocess-local and ptc-runtime-node. |
| `packages/ssh/ssh-helper-runtime/tests/fixtures/direct-helper.ts` | Fixture driving the helper directly over plain streams. |
| `packages/ssh/ssh-helper-runtime/tests/fixtures/driver.ts` | Fixture that launches and drives the packaged helper. |
| `packages/ssh/ssh-helper-runtime/tests/fixtures/sshd/Dockerfile` | Container image for the local sshd used by the acceptance suite. |
| `packages/ssh/ssh-helper-runtime/tests/fixtures/sshd/sshd_config` | sshd configuration for that container. |
| `packages/ssh/ssh-helper-runtime/tests/fixtures/sshd/start.sh` | Startup script for that container. |
| `packages/ssh/ssh/README.md` | The connection contract: one deployment-owned OpenSSH alias supplies authentication and host identity; the connection verifies installed artifact digests before readiness; the helper owns remote cleanup when the connection closes or its lease expires. |
| `packages/ssh/ssh/README.zh.md` | Chinese mirror of the ssh README. |
| `packages/ssh/ssh/package.json` | `@deepseek-ai/dsh-ssh` manifest; exports `./helper`, `./protocol` and `./schemas` subpaths for the remote side. |
| `packages/ssh/ssh/tsconfig.json` | Project references to cordis, schemastery, the fs/subprocess/sandbox families and the util packages. |
| `packages/ssh/ssh/tsdown.config.ts` | Four build entries: `index`, `protocol`, `schemas` and the private `helper` entry. |
| `packages/ssh/ssh/tests/collection.spec.ts` | Pins output collection: the full stream is captured while the snapshot reader is paused, and the spill is retained after a disconnect. |
| `packages/ssh/ssh/tests/connection-disposal.spec.ts` | Pins connection disposal: new requests are refused during a ready continuation or an already-closing phase, one heartbeat stays outstanding when ordinary capacity is full, a control command outliving cancellation is force-killed and joined. |
| `packages/ssh/ssh/tests/fixtures/helper.ts` | Fixture helper used by the SSH unit suites. |
| `packages/ssh/ssh/tests/helper-boundaries.spec.ts` | Pins the connection boundary: unsupported hosts and cancellation refused before startup, teardown joined when cancellation arrives while services mount, the negotiated bootstrap digest returned, invalid handshake fields rejected, and an external bootstrap refused for an executable helper. |
| `packages/ssh/ssh/tests/helper-cleanup-join.spec.ts` | Pins that finalization is joined after a native success or failure while the direct result is retained. |
| `packages/ssh/ssh/tests/helper-failure-settlement.spec.ts` | Pins that a one-process capacity is reused after ENOENT and that late `done` errors are preserved. |
| `packages/ssh/ssh/tests/helper-finalization.spec.ts` | Pins finalization: the native control endpoint is destroyed when its authenticated TLS transport fails, completion is not republished after the record is released, and completion stays owned by a release still observing the native range. |
| `packages/ssh/ssh/tests/helper-lifecycle.spec.ts` | Pins the helper lifecycle: directory and listener allocation joined before close, capacity reserved before asynchronous allocation, and no process published after a termination interrupts cwd resolution. |
| `packages/ssh/ssh/tests/helper-processes.spec.ts` | Pins remote process ownership: terminal operations forwarded with a bounded completed-result cache, a terminal allocated after a cancelled start joined, stdin bytes piped, and a missing native control descriptor still reaping the native process. |
| `packages/ssh/ssh/tests/helper-runtime.spec.ts` | Pins the helper's runtime behaviour: relative filesystem operations bound to the negotiated workspace without chdir, guarded write/edit outcomes and error codes preserved across RPC, metadata and byte ranges returned, and remote text iterators closed. |
| `packages/ssh/ssh/tests/identifiers.spec.ts` | Pins that process and text-stream identities stay distinct while keeping their UUID wire values. |
| `packages/ssh/ssh/tests/inspector-signal.spec.ts` | Pins that actual debugger activation is observed with SIGUSR1 disabled or enabled. |
| `packages/ssh/ssh/tests/live.e2e.ts` | Acceptance suite against a real sshd: same-user sandboxed connectors refused before a process stream is granted, guarded file mutations and byte reads shared, binary fd 7 preserved through native ownership and read-only confinement, and control/cancellation moving while stdout is paused. |
| `packages/ssh/ssh/tests/management-capacity.spec.ts` | Pins the management-request capacity: a cancelled remote handler keeps its credit while it cleans up, heartbeat and close stay available with one ordinary call outstanding, and a management method admits only its own pending call. |
| `packages/ssh/ssh/tests/protocol-boundaries.spec.ts` | Pins the wire bounds: an already-aborted call transmits nothing, pending calls are bounded without evicting an admitted request, and an oversized outbound frame is refused before writing. |
| `packages/ssh/ssh/tests/protocol-disposal.spec.ts` | Pins disposal during output backpressure: queued requests settle after a peer close, an output close or an input EOF without a drain event. |
| `packages/ssh/ssh/tests/protocol.spec.ts` | Pins the RPC peer: responses validated and typed operation errors retained, excessive lengths rejected before waiting for the payload, and an admitted operation cancelled without replay. |
| `packages/ssh/ssh/tests/startup-behavior.spec.ts` | Pins startup: a non-POSIX client refused before SSH starts, only verified remote coordinates published, executable paths quoted, filesystem-only deployments permitted, and an unconfigured PTC bootstrap getter refused. |
| `packages/ssh/ssh/tests/stream-capability.spec.ts` | Pins stream capabilities: an unknown TLS identity refused without consuming a legitimate reservation, only one of two connected clients published for a reservation, another endpoint capability refused, and administrative-looking bytes not treated as a helper request. |
| `packages/ssh/ssh/tests/stream-lifetime.spec.ts` | Pins TLS cancellation ownership: an authenticated stream is cancelled before its underlying socket closes, and cancellation works with an arbitrary caller reason. |
| `packages/ssh/ssh/tests/stream-rebind.spec.ts` | Pins that the key and payload stay private when a workspace-write process rebinds and relays the listener. |
| `packages/ssh/ssh/tests/stream-timeout.spec.ts` | Pins the TLS authentication deadline: a peer that accepts a connection but never authenticates is closed. |
| `packages/ssh/subprocess-ssh/README.md` | The remote subprocess contract: executable lookup, ordinary processes, fd 7 control traffic and terminal sessions run beside the SSH filesystem; remote native process owners govern termination and quiescence. |
| `packages/ssh/subprocess-ssh/README.zh.md` | Chinese mirror of the subprocess-ssh README. |
| `packages/ssh/subprocess-ssh/package.json` | `@deepseek-ai/dsh-subprocess-ssh` manifest. |
| `packages/ssh/subprocess-ssh/tsconfig.json` | Project references to cordis, schemastery, ssh and the subprocess packages. |
| `packages/ssh/subprocess-ssh/tests/lifecycle.spec.ts` | Pins terminal allocation lifecycle: a pending prepare/connect/start is joined before provider disposal. |
| `packages/ssh/subprocess-ssh/tests/process-behavior.spec.ts` | Pins ordinary remote process behaviour: inherited output forwarded without ending the host standard streams, output draining bounded after completion even when the output peer stays open, and outputs that closed before the start acknowledgement observed. |
| `packages/ssh/subprocess-ssh/tests/shell-discovery.spec.ts` | Pins that remote shell facts are validated and a lookup miss is distinguished from a transport failure. |
| `packages/ssh/subprocess-ssh/tests/stream-wait-lifecycle.spec.ts` | Pins the public output streams: destroying one closes only the matching transport, a closure is remembered before remote allocation finishes, and range-observation cancellation is honoured. |
| `packages/ssh/subprocess-ssh/tests/terminal-behavior.spec.ts` | Pins terminal behaviour: output published and terminal operations forwarded with remote process observations, termination retried after a remote cleanup failure without discarding the live handle, and termination still available after the direct-result observation fails. |
| `packages/telemetry/README.md` | Telemetry group map: reporting infrastructure shared by product analytics and feedback-authorized Session uploads; business plugins select events, identities, authorization and redaction, transport plugins own encoding and delivery. |
| `packages/telemetry/README.zh.md` | Chinese mirror of the telemetry group README. |
| `packages/telemetry/otel/README.md` | The OTel service contract: one `otel` service creates ordinary-event and Session-log channels, each with its own exporter, resource, scope and queue; **mounting alone creates no transport or identity and sends nothing**. |
| `packages/telemetry/otel/README.zh.md` | Chinese mirror of the otel README. |
| `packages/telemetry/otel/locale/en.json` | English display title for the OTel service. |
| `packages/telemetry/otel/locale/zh.json` | Chinese display title and description. |
| `packages/telemetry/otel/package.json` | `@deepseek-ai/dsh-otel` manifest; the OTel SDK packages plus `got`. |
| `packages/telemetry/otel/tsconfig.json` | Project references to cosmokit, cordis and the session package. |
| `packages/telemetry/otel/tests/event-log.spec.ts` | Pins the event channel: the dedicated agent released after exporting explicit asynchronous headers, the HTTPS agent released after a TLS failure, responses over the OTLP body limit rejected, and one channel's cancellation not cancelling another. |
| `packages/telemetry/otel/tests/session-log.spec.ts` | Pins the Session-log channel: full nested events preserved without truncation, gzip and uncompressed requests bounded, an exact request admitted, an oversized record diagnosed once, and the queue continuing after an oversized record and a failed HTTP request. |
| `packages/workspace/README.md` | Workspace family map: an ordered list of named projects with sessions grouped by directory; hiding a session never deletes it and removing a project never deletes its folder or history. |
| `packages/workspace/README.zh.md` | Chinese mirror of the workspace group README. |
| `packages/workspace/workspace/README.md` | The registry contract: durable project directories and their sessions, header-validated membership, re-adding a removed directory creates a fresh project, an existing project's sessions stay grouped when its directory disappears; **invisible to models, no prompt or request-context cost**. |
| `packages/workspace/workspace/README.zh.md` | Chinese mirror of the workspace README. |
| `packages/workspace/workspace/locale/en.json` | English display title for the workspace registry. |
| `packages/workspace/workspace/locale/zh.json` | Chinese display title and description. |
| `packages/workspace/workspace/package.json` | `@deepseek-ai/dsh-workspace` manifest; peers on session, session-persistence, storage, storage-domain and the typert protocol. |
| `packages/workspace/workspace/tsconfig.json` | Project references to cosmokit, cordis, schemastery, storage, storage-domain, session, session-persistence, typert and util/brand. |
| `packages/workspace/workspace/tests/workspace.spec.ts` | 88 cases pinning the registry lifecycle and bootstrap: it stays pending without `sessionPersistence` and never opens the domain, it bootstraps once from the listed headers in `createdAt` order, equal timestamps break by session id and canonical path, plus the archive/pin/order/membership rules. |


### Tier 2 — bulk: the remaining named files

(The tables above group several modules under one heading; this table names the remaining files of the shard individually so the ledger is complete.)

| File | What it is / what it pins |
| --- | --- |
| `packages/boot/app-boot/src/official-bundle-packages.ts` | The generated-bundle package-name list the on-demand catalog is checked against; a one-line module with no runtime behaviour of its own. |
| `packages/boot/app-boot/src/official-bundles.generated.ts` | The generated on-demand catalog: package names, localized titles/descriptions and base64 SVG data URLs, with **no install target and no version** — the target is derived from the running installation. |
| `packages/boot/plugin-manager/README.zh.md` | Chinese mirror of the plugin-manager README (sections: 使用本包 / 版本兼容性与豁免 / 配置 / 理解实现 / 失败行为). |
| `packages/boot/plugin-manager/locale/en.json` | English display title for the manager service. |
| `packages/boot/plugin-manager/locale/zh.json` | Chinese display title and description for the manager service. |
| `packages/boot/plugin-manager/locale/tools/en.json` | English display title for the manager *tool* row (a separate row from the service). |
| `packages/boot/plugin-manager/locale/tools/zh.json` | Chinese display title for the manager tool row. |
| `packages/boot/plugin-manager/package.json` | `@deepseek-ai/dsh-plugin-manager` manifest; exports the `./types` subpath and peers on the typert protocol, the host plugin inventory and the app-boot package. |
| `packages/boot/plugin-manager/tsconfig.json` | Project references to cordis, schemastery, app-boot, hmr, subprocess, the typert protocol, tools, the util packages, the sandbox packages and the user-approval package. |
| `packages/boot/plugin-manager/src/failure.ts` | The typed management failure: `ManagementFailure(code)` plus `incompatiblePlugin(compatibility)` — the refusal vocabulary every surface renders from its own locale. |
| `packages/boot/plugin-manager/src/install-failure.ts` | The install-failure classifier: it names the run's end *before* reading its output, then the most specific code inside it, and keeps Git HTTP 401/403/404 out of the connection-recovery bucket. |
| `packages/boot/plugin-manager/src/official-install-target.ts` | The install target for an Official on-demand bundle: the exact released Host version, or a same-checkout development link when the running installation is not a release. |
| `packages/boot/plugin-manager/tests/build-approval.spec.ts` | Pins the build-approval policy: only named pending packages are approved, an unlisted name is refused atomically, comments and existing decisions survive, pnpm file-dependency selectors are preserved verbatim, and a malformed workspace file is rejected without being rewritten. |
| `packages/boot/plugin-manager/tests/git-environment.ts` | Test helper supplying the profile's Git environment for the connection checks. |
| `packages/boot/plugin-manager/tests/github-connection.spec.ts` | Pins the pre-install GitHub check: registry packages and other Git hosts are left to the installer, an immediate transport failure is reported without waiting, a silent proxy connection is ended at the deadline, a connected probe is cancellable, a missing Git executable is *not* classified as a network failure, and no credential helper or askpass is ever invoked. |
| `packages/boot/plugin-manager/tests/install-spec.spec.ts` | Pins `parseInstallSpec` (registry names with ranges, absolute paths with `file:`/`link:`, on-disk tarballs, git hosts and tarball URLs — each naming the host it is fetched from) and `classifyInstallFailure` (Git HTTP 401/403/404 excluded from connection recovery). |
| `packages/boot/plugin-manager/tests/manager.spec.ts` | The largest manager suite: a GitHub network/timeout failure is stopped before pnpm and attributed to the repository, a non-network error is left to pnpm, an active check can be cancelled and disposal waits for it, a bundle is listed with its rows and live entries, a running management bundle stays protected when its files go missing, and a bundle skipped at startup can still be removed. |
| `packages/boot/plugin-manager/tests/official-install-target.spec.ts` | Pins the on-demand install target: an exact released version for a release installation and a development link for a checkout. |
| `packages/boot/plugin-manager/tests/operation-logs.spec.ts` | Pins the per-run diagnostic log under `.plugin-manager/logs/`: the file is created, the output is captured, and the log survives a failed operation. |
| `packages/boot/plugin-manager/tests/operations-process.spec.ts` | Pins the pnpm run mechanics: the run record written before the spawn, the bounded pipe drain after exit, the silence bound that kills the whole tree, and the file restoration on failure. |
| `packages/boot/plugin-manager/tests/operations.spec.ts` | Pins the operation surface: manifest snapshots and restoration, the registry lookup before install, the compatibility preflight, the dependency closure that stays installed after an unrelated failure, and the lockfile reinstall after a rejected install. |
| `packages/boot/plugin-manager/tests/package-reload.spec.ts` | Pins the manager's reload path: the bundle's rows are recomposed, a disabled bundle keeps its dependency, and a publication failure is reported without undoing the disk change. |
| `packages/boot/plugin-manager/tests/patch.spec.ts` | Pins the enablement edit: the override is added, updated or removed to record only the departure from the bundles, `!!js` values are left alone, and the YAML comments survive. |
| `packages/boot/plugin-manager/tests/registry.spec.ts` | Pins the registry plan: a private registry is asked alone, pnpm's own registry joins the fallback set only while it is known to be public, and the failure attribution reads the host only off error lines. |
| `packages/boot/plugin-manager/tests/run-tree.spec.ts` | Pins the process-tree wait: a service run leads its own group, a CLI run keeps the caller's, a dead tree resolves immediately, and the wait is bounded. |
| `packages/boot/plugin-manager/tests/tools.spec.ts` | Pins the agent tool: each action is approved once per sandbox mode without changing the session permission mode, a rejected/cancelled/unavailable approval mutates nothing, the `never` policy never prompts, a cancelled wait is cancelled, inventories paginate, and UI translation metadata stays out of the model-facing lists. |
| `packages/boot/plugin-market/README.zh.md` | Chinese mirror of the plugin-market README. |
| `packages/boot/plugin-market/package.json` | `@deepseek-ai/dsh-plugin-market` manifest; depends on app-boot, plugin-manager, settings, system-prompt, tools, the typert protocol and semver. |
| `packages/boot/plugin-market/tsconfig.json` | Project references to cordis, loader, schemastery, app-boot, plugin-manager, plugin-market-index, package-manifest, timeout, values, settings, the typert protocol and tools. |
| `packages/boot/plugin-market/tsdown.config.ts` | Two build entries: the service and the private parse Worker bundle. |
| `packages/boot/plugin-market/src/types.ts` | The public market records: `MarketListingEntry`, `MarketListingVersion`, `MarketInstallation`, `MarketCompatibility`, `MarketQuery`, `MarketSearchResult` and the closed sort/category unions. |
| `packages/boot/plugin-market/src/parse-thread.ts` | Runs the index parse in a fresh Worker Thread: the body is transferred, the first message wins, the Worker is terminated on settle or abort, and a termination failure still settles the caller. |
| `packages/boot/plugin-market/src/worker.ts` | The private Worker entry: it receives the body buffer, parses it and posts the result back through the transfer list. |
| `packages/boot/plugin-market/tests/built-worker.e2e.ts` | Exercises the **bundled** Worker: a valid index is searched and an invalid one reported through the built artifact, which must run without workspace packages and refuse a malformed request. |
| `packages/boot/plugin-market/tests/configuration.spec.ts` | Pins the Settings write path: index sources are saved without remounting the service, announced, and restored at restart. |
| `packages/boot/plugin-market/tests/fixtures/market.patch.yml` | Profile patch fixture that mounts the market service for the tests. |
| `packages/boot/plugin-market/tests/market-parse-failure.spec.ts` | Pins that a parse-Worker failure is reported as `plugin-market/fetch-failed` rather than as a validation error. |
| `packages/boot/plugin-market/tests/market.spec.ts` | The largest market suite: installation status and compatibility annotations, the default version rule, a shared concurrent fetch with caching and refresh, refusal of an unconfigured URL, fetch-failure recording, invalid encodings/JSON/format violations reported with their JSON path, removal of a source, aborted in-flight fetches on disposal, category and label filtering, relevance ranking, the sort orders, paging with a pinned document and a total, and the strictly increasing `fetchedAt`. |
| `packages/boot/plugin-market/tests/parse-thread.spec.ts` | Pins the Worker thread: body transfer, first-message resolution, Worker termination, settlement when termination fails, rejection when the Worker fails or exits silently, and refusal of an already-aborted signal. |
| `packages/boot/plugin-market/tests/parse-worker.spec.ts` | Pins the Worker entry: a body is parsed in a Worker and its buffer is transferred. |
| `packages/boot/plugin-market/tests/parse.spec.ts` | Pins `parseIndexBody`: strict UTF-8, JSON parsing, format-1 validation and relative icon resolution against the index URL. |
| `packages/boot/plugin-market/tests/tools.spec.ts` | Pins the `plugin_market` tool: it lists configured indexes, returns paged results with a total, and keeps UI-only metadata out of the model-facing payload. |
| `packages/bundle/headless/src/startup-internals.ts` | The injectable process facts the headless startup provider reads (`stdin.isTTY`, stdout), kept out of the `./startup` entry so tests add no public API. |
| `packages/ptc-runtime/ptc-runtime-node/src/bindings.ts` | Binding validation against the seam's shared rules: the reserved global set, the reserved error-member set, dunder members, duplicate names and non-lossless-JSON resolutions. |
| `packages/ptc-runtime/ptc-runtime-node/src/launch.ts` | Launch selection for the program child: an installed bootstrap, a source bootstrap or an embedded remote worker; the arguments and the failure message for an unreadable bootstrap. |
| `packages/ptc-runtime/ptc-runtime-node/src/output-ledger.ts` | The combined outer-output ledger: exact byte accounting for log entries, separators and the optional completion value, with an explicit `output-limit` failure that retains a fitting prefix. |
| `packages/ptc-runtime/ptc-runtime-node/src/output-stream.ts` | Bounded drainage of a terminated program's output: the descriptor is kept open long enough to drain, then closed, and a `close`/`error` is reported as incomplete output. |
| `packages/ptc-runtime/ptc-runtime-node/src/persistent-process.ts` | The retained REPL child process: its environment, the local binding namespace, the per-evaluation capture and the rule that an old asynchronous exception does not finish a later evaluation. |
| `packages/ptc-runtime/ptc-runtime-node/src/persistent-process-entry.ts` | The private child entry for the retained REPL — the module a process runs, kept out of the public entry. |
| `packages/ptc-runtime/ptc-runtime-node/src/policy-processes.ts` | Owns asynchronous cleanup after a committed Session file-policy change: a changed mode invalidates that session's processes, cleanup starts without another program running, a failed cleanup is retried before admission, and unload waits for every process. |
| `packages/ptc-runtime/ptc-runtime-node/src/process-entry.ts` | The private child entry for a per-call program — the module a fresh process runs. |
| `packages/ptc-runtime/ptc-runtime-node/src/process.ts` | The child-side main: the environment is cleared, binding replies are dispatched, the terminal frame is flushed, the control pipe stays open for a late reply and an invalid frame limit is rejected. |
| `packages/ptc-runtime/ptc-runtime-node/src/protocol.ts` | The program↔host wire: `CallMessage`, `LogMessage`, `OutputLimitMessage`, `DoneMessage` and the `ReplyMessage` union, with the rule that a failed program is a field on the `done` frame and that logs stream eagerly. |
| `packages/ssh/sandbox-ssh/src/index.ts` | The remote sandbox provider: it resolves the policy on the SSH host, returns the literal enforcing argv and the current backend facts, and refuses malformed facts. |
| `packages/ssh/ssh-helper-runtime/src/index.ts` | The packaged-helper carrier: the SEA dispatcher selects the helper, the subprocess runner or the PTC worker by an environment variable and then deletes it, so the choice cannot leak into a child. |
| `packages/ssh/ssh/src/helper-entry.ts` | The private remote helper entry: it accepts no command arguments, serves the versioned RPC over its own stdio and reports every failure on stderr with exit code 127. |
| `packages/ssh/ssh/src/stream-security.ts` | TLS-PSK authentication for forwarded streams: the per-stream capability key proves peer identity without a certificate, there is no unauthenticated cipher fallback, and a failing transport is closed. |
| `packages/telemetry/otel/src/index.ts` | The `otel` service: it creates the ordinary-event and Session-log channels and **nothing else** — mounting it makes no queue, no identity and no connection. |
| `packages/telemetry/otel/src/event-transport.ts` | The ordinary-event OTLP exporter: a cancellable HTTP transport with a 4 MiB response cap that matches the SDK's own OTLP limit. |
| `packages/telemetry/otel/src/transport.ts` | The shared OTLP HTTP transport: the agent, headers, timeout and TLS identity are explicit and **never inherited from another collector**. |
| `packages/workspace/workspace/src/types.ts` | The public workspace interface and the `WorkspaceId` brand: an id is a uuid and never a path, because path normalization rewrites paths and a reference anchor must stay stable. |

---

### Tier 3 — skipped with a reason

The 27 `README.i18n.yaml` files are **generated bilingual-pair consistency ledgers**: for each heading section of the sibling `README.md`, a 16-hex-digit hash of the English and Chinese blocks outside code fences. Every one was opened and read; none is read line-by-line in the report because they carry no prose beyond hashes — they are regenerated by `pnpm run verify-translation-pairing --write`. Full list: `packages/boot/README.i18n.yaml`, `packages/boot/app-boot/README.i18n.yaml`, `packages/boot/cmdline/README.i18n.yaml`, `packages/boot/config-editor/README.i18n.yaml`, `packages/boot/hmr/README.i18n.yaml`, `packages/boot/plugin-manager/README.i18n.yaml`, `packages/boot/plugin-market/README.i18n.yaml`, `packages/bundle/README.i18n.yaml`, `packages/bundle/acp-app/README.i18n.yaml`, `packages/bundle/base/README.i18n.yaml`, `packages/bundle/headless/README.i18n.yaml`, `packages/bundle/sdk-app/README.i18n.yaml`, `packages/bundle/sdk-minimal/README.i18n.yaml`, `packages/bundle/web-app/README.i18n.yaml`, `packages/ptc-runtime/README.i18n.yaml`, `packages/ptc-runtime/ptc-runtime-node/README.i18n.yaml`, `packages/ptc-runtime/ptc-runtime/README.i18n.yaml`, `packages/ssh/README.i18n.yaml`, `packages/ssh/fs-ssh/README.i18n.yaml`, `packages/ssh/sandbox-ssh/README.i18n.yaml`, `packages/ssh/ssh-helper-runtime/README.i18n.yaml`, `packages/ssh/ssh/README.i18n.yaml`, `packages/ssh/subprocess-ssh/README.i18n.yaml`, `packages/telemetry/README.i18n.yaml`, `packages/telemetry/otel/README.i18n.yaml`, `packages/workspace/README.i18n.yaml`, `packages/workspace/workspace/README.i18n.yaml`.

The following 13 large source files were **head-read**: the module's declared contract, its exported surface, its error vocabulary and its leading implementation were read (45–60 lines each), and the file was then characterised from its package README and from the test names that pin it. Their bodies were **not** read line by line, so the entries above describe their *contract* rather than their whole implementation: `packages/bundle/web-app/src/index.ts`, `packages/ptc-runtime/ptc-runtime-node/src/bootstrap.ts`, `packages/ptc-runtime/ptc-runtime-node/src/channel.ts`, `packages/ptc-runtime/ptc-runtime-node/src/index.ts`, `packages/ptc-runtime/ptc-runtime-node/src/json-wire.ts`, `packages/ptc-runtime/ptc-runtime-node/src/persistent.ts`, `packages/ssh/fs-ssh/src/index.ts`, `packages/ssh/ssh/src/helper-processes.ts`, `packages/ssh/ssh/src/helper.ts`, `packages/ssh/ssh/src/index.ts`, `packages/ssh/ssh/src/protocol.ts`, `packages/ssh/ssh/src/schemas.ts`, `packages/ssh/subprocess-ssh/src/index.ts`.

---
## 2. Ideas worth stealing

1. **A "compatibility preflight" that refuses a plugin *before* importing it.** DSH evaluates a plugin's declared `engines.dsh` against the running runtime at the composition boundary and *disables* the row rather than letting an import blow up later (`packages/boot/app-boot/src/compatibility-preflight.ts:89-140`). The exemption is an exact `package-name@version` → exact runtime version pair in its own `compatibility.json` file, never a range (`packages/boot/app-boot/src/profile-compatibility.ts:126-137`). *Why it transfers:* August Trading already refuses invalid plans (E-37/E-43); the same shape — a machine-checkable declared requirement plus an exact, separately-stored, user-acknowledged exemption — works for "this analysis provider needs this schema version". `UNIQUE` to this shard's repo, but the *pattern* (declare, preflight, exempt exactly) is what a trading rule engine wants.
2. **"Limitation strings" instead of a guessed schema.** When a plugin's config cannot be projected exactly into JSON Schema, DSH emits an explicit `limitations: string[]` and an `acceptsMissing: true | false | 'unknown'` rather than inventing a default (`packages/boot/app-boot/src/config-schema/projector.ts:71-78`, `projector.ts:475`). *Why it transfers:* August Trading's zod schemas at the AI boundary (`schemas/tradeAnalysis.ts`) are the same idea — a coercion that "might" work must be visible, not silently assumed. `UNIQUE`.
3. **A two-layer `.env` policy: layers are parsed before either is applied, and a file may not set process-shape variables.** Both env layers are validated *before* either is written into `process.env`, so a rejection never leaves one layer applied (`packages/boot/app-boot/src/index.ts:244-253`); and a `.env` may not set `PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, `DSH_*` or `XDG_*` — only four proxy names from the *home* layer (`packages/boot/app-boot/src/index.ts:136-181`). *Why it transfers:* August Trading reads provider keys from the Preferences store today; when it gains an env-file path, this "environment file may not decide how the process starts" rule is exactly right for a desktop app that also runs an Electron shell. `UNIQUE`.
4. **Module identity by disk, not by watcher event.** DSH's HMR treats a module as stale when its `inode:size:mtime` changes, explicitly *not* `ctime` (a pnpm hard link changes ctime without changing content), and reads the clock from a fresh marker file rather than `Date.now()` because "the system clock and file timestamps can differ by a clock tick in either direction" (`packages/boot/hmr/src/module-files.ts:8-10`, `module-files.ts:13-17`, `module-files.ts:48-66`). *Why it transfers:* August Trading's desktop build reloads a *bundled* app, not a watched tree — but the same discipline applies to any cache keyed on file content (a strategy file, a notebook): key on identity, not on a notification. `UNIQUE`.
5. **A durable event projection that only ever reads *committed* state.** The `--json` stream derives every event from committed `assistant/message` content — "never from a live attempt that may still be retried or discarded" (`packages/bundle/headless/src/json-stream.ts:1-5`) — and a partial token total is omitted entirely rather than published as an exact number (`json-stream.ts:298-306`). *Why it transfers:* this is precisely the August Trading rule that a *settled* verdict and malformed persisted audit data must not drop a row; applied to a trade log, the durable record is the only thing a query may read. `CONVERGENT` in spirit — the same discipline appears in the workspace registry and the plugin manager.
6. **A byte-bounded ledger that reports the limit instead of silently truncating.** The PTC output ledger measures JSON sizes with module-captured intrinsics (so model code cannot corrupt the accounting by mutating `Array.prototype`), truncates only on code-point boundaries, and turns an overflow into an explicit `output-limit` failure (`packages/ptc-runtime/ptc-runtime-node/src/output-json.ts:9-31`, `output-ledger.ts:22-25`). *Why it transfers:* August Trading's `MemoryFilesService.getNotebookWriteFailure()` already refuses to let a memory loss become an invisible state; the same rule for any tool-output byte cap. `UNIQUE`.
7. **A recoverable two-write marker for every durable mutation.** The workspace registry persists a `pendingMutation` marker *before* the record/order pair can diverge, so startup can tell an interrupted operation from corruption (`packages/workspace/workspace/src/spec.ts:35-43`, `packages/workspace/workspace/src/index.ts:636-648`). *Why it transfers:* August Trading's trade journal, backup service and automation history all do multi-file writes; this "intent record before mutation" makes a crash recoverable instead of merely lossy. `UNIQUE`.
8. **Every failure carries a `nextStep` sentence instead of an error code.** The `plugin_manager` tool turns each refusal, failure kind and restart reason into a sentence that says what the model (or the user) does next (`packages/boot/plugin-manager/src/tools.ts:52-93`). *Why it transfers:* August Trading's `runStatus.ts` already owns "one colour+word per state"; the same registry could own the one sentence per refusal, so every surface says the same next step. `UNIQUE`.
9. **A registry plan, not a registry loop.** When a package operation may fall back between registries, DSH asks a registry that is *outside the configured set* **alone**, so a private registry never leaks into a public one (`packages/boot/plugin-manager/src/registry.ts:60-77`), and `failedAt` distinguishes "another registry could answer" from "the git host itself failed" (`packages/boot/plugin-manager/src/index.ts:590-596`). *Why it transfers:* the same "never silently widen the set of contacted parties" rule applies to any market-data or broker endpoint August Trading talks to. `UNIQUE`.
10. **One canonical path, checked at the boundary.** The workspace registry has exactly one uniqueness canon (`fs.realpath`), refuses a relative path before `realpath` can resolve it against the wrong cwd, and refuses a missing directory with the original `ENOENT` (`packages/workspace/workspace/src/paths.ts:44-51`). *Why it transfers:* August Trading's workspace/notebook paths, trade-log files and export targets all need one canon; the "reject a relative path rather than resolve it against an unpredictable cwd" rule is the transferable half. `UNIQUE`.
11. **A "version-tolerant but version-exact" rule set.** `PORTABLE_RESERVED_WORDS` is the *union* of ECMAScript and Python reserved words, and every backend refuses the *same* set of binding globals — "a namespace list valid on one backend is valid on all" (`packages/ptc-runtime/ptc-runtime/src/index.ts:17-35`, `index.ts:52-77`). *Why it transfers:* when August Trading supports several analysis providers or several model transports, the *provider-facing* vocabulary (tool names, plan fields, verdict keys) must be one union, not a per-provider subset, or the same prompt silently degrades on one provider. `UNIQUE`.
12. **A profile is data, not code.** A profile is a YAML patch layer list; a bundle is a package whose manifest names a patch file; a patch *replaces* a row's whole config rather than merging, so "a row whose value differs by mode does not live in the shared layer" (`packages/bundle/base/cordis.patch.yml:6-15`). *Why it transfers:* August Trading's multi-surface story (chat, chart dock, learn, journal, settings) is the same shape — the differences between surfaces should be *data* over one shared composition, not forked components. `UNIQUE`.

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work — partially in this shard; the mechanism is here, the scheduler is not.** This shard contains the *plumbing* a monitor needs and does **not** contain the scheduler: the durable, restart-recoverable piece is the workspace registry's pending-mutation marker and its `enqueueOperation` tail (`packages/workspace/workspace/src/index.ts:894-903`), the run record written *before* a long process is spawned and removed after (`packages/boot/plugin-manager/src/operations.ts:190-227`), and the `awaitTreeGone` wait that holds the profile lock until the started scripts have actually stopped writing (`packages/boot/plugin-manager/src/run-tree.ts:64-78`). The scheduler itself, the catch-up rule for a missed run, and the breaker after repeated empty runs live in other shards — do not assume they exist here.
- **Human-in-the-loop approval — one model, two grants.** The plugin-manager tool requires either `danger-full-access` or an explicit approval *for that call*, and the approval **does not change the session's permission mode** (`packages/boot/plugin-manager/src/tools.ts:118-127`); the session mode is re-checked on every execution, including after a revocation. Build-script approval is a **separate, persistent** grant for the profile (`approvedBuilds`), and "General installation permission is not enough" (`tools.ts:107-108`). The approval *record* that survives the decision is the profile file itself (`pnpm-workspace.yaml` `allowBuilds`, `compatibility.json`), written atomically with mode `0600` under a file lock — and the audit trail is the per-run log under `.plugin-manager/logs/` plus the `plugin-manager/changed` event with a reason (`packages/boot/plugin-manager/src/index.ts:928-936`).
- **Post-mortem / reflection loops — not in this shard.** Nothing in the boot/bundle/remote families implements an outcome→rule loop or a rule-retirement gate. The nearest thing is the *negative* discipline worth stealing: a rule that records its own **expiry/retirement** shape does not exist here, but the compatibility-exemption file (`compatibility.json`) is a worked example of a narrow, exact, user-acknowledged, revocable grant — a plausible model for "this learned rule is exempt until date X, for this exact pair".
- **Multi-agent — the seam, not the debate.** This shard shows where the *boundary* between one agent and its workers is drawn: the headless runner's quiescence loop re-checks child settlement **after** the parent turn completes, because a child can wake the parent (`packages/bundle/headless/src/index.ts:385-392`), and `subagents.waitForChildren` is part of the "quiescent" definition rather than a side channel. Debate adds nothing here; the repo's answer is *sequenced delegation with an explicit quiescence predicate*.
- **Structured logs the model can query — three stores, no heavy database.** (a) **JSONL sessions** on disk (`dsh-session-persistence-jsonl`, `root: dshHomePath('sessions')`, `compression: none` — `packages/bundle/base/cordis.patch.yml`, the `sessions` row); (b) **an in-memory full-text index that is opt-in and opens lazily** — the base ships `openAt: never` so SQLite is never opened unless a deployment opts in (`packages/bundle/base/cordis.patch.yml:139-153`); (c) **OTLP channels** — an ordinary-event channel and a Session-log channel with **separate exporters, resources, scopes and queues**, where the Session-log channel **rejects an oversized record whole rather than truncating it** (`packages/telemetry/otel/src/session-log.ts:107-111`). The transferable pattern: *a queryable log is a durable append-only file plus a lazily-opened index*, and the index is never a write-path dependency.
- **Staying simple as features accumulate — "the composition is data; the row is the unit."** The base bundle is ~110 YAML rows, each with a comment naming the invariant it defends, and the whole difference between surfaces is *patch layers* (`packages/bundle/base/cordis.patch.yml`). `sdk-minimal` is one bundle that declares a complete standalone tree — a deliberately small allowlist that excludes base, Web, settings, managed credentials, telemetry, text file tools, skills, jobs and subagents (`packages/bundle/sdk-minimal/README.md`). The feature count does not become the product because *a profile is a file*, and a file can be replaced wholesale.

## 4. Non-obvious decisions and gotchas

- **`patch` replaces a row's whole `config`; it never deep-merges.** "An id-targeted patch does not deep-merge, so a profile override restates the bundle fields it keeps" (`packages/boot/app-boot/README.md`). Every override is therefore a full restatement — verbose, but impossible to misread.
- **A "reload" never re-imports the code itself.** HMR "does not import replacement code: the Loader imports the current files when the generation starts an entry, so disabled, removed and incompatible rows never execute it" (`packages/boot/hmr/README.md`). A failed replacement therefore *stops the previous plugin* rather than restoring it — every later recomposition retries the import (`packages/boot/hmr/src/index.ts:715-735`).
- **The restart-reasons are a closed set of five** — `no-hmr`, `package-moved`, `host-module`, `unmanaged-plugin`, `module-comparison` (`packages/boot/plugin-manager/src/types.ts:31-37`) — and HMR has its own three (`host-module`, `unmanaged-plugin`, `module-comparison`, `packages/boot/hmr/src/index.ts:1017-1025`). "The change cannot be applied now, and here is exactly which class of change it is."
- **A schema is a *projection*, never a validation.** Ajv checks only literal defaults against the generated schema; it does not fill defaults, coerce input or call native validators (`packages/boot/app-boot/src/config-schema/projector.ts:55-59`). Any native behaviour that cannot be reproduced becomes a limitation string, and `acceptsMissing` can be `'unknown'`.
- **The compat matrix is a differential test against native Node, not a list of expected outputs.** `linked-resolution-matrix.spec.ts` runs the same scenario against DSH's interception and against native Node for `esm-resolve`, `cjs-require`, `cjs-paths` and metadata lookups, over a layout × importer × source × manifest-state matrix (`packages/boot/app-boot/tests/linked-resolution-matrix.spec.ts:615-616`). That is the right way to pin a resolver.
- **The Node loader is detected by its own API version, not by the Node major.** Node 24.0–24.11.1 report major 24 while carrying the **v1** loader; v2 arrived only in 24.12.0 (`packages/boot/app-boot/tests/loader-shape.compat.spec.ts:11-18`).
- **`error.name` is not a reliable signal; the *shape* is.** Build failures are detected structurally (`errors` array whose members all have a string `text`, `packages/boot/hmr/src/error.ts:5-8`); commander errors are detected structurally too (`packages/boot/cmdline/src/index.ts:213-224`), because an out-of-tree plugin brings its own commander copy whose `CommanderError` is a different identity.
- **`process.env` for a model-written program starts EMPTY** (six platform variables survive) (`packages/ptc-runtime/ptc-runtime-node/src/environment.ts:4-16`), and a PTC failure is a **field on a resolved result**, never a rejection (`packages/ptc-runtime/ptc-runtime/src/types.ts:154-166`).
- **Reading a market/index/registry body is strict UTF-8 with a *located* diagnostic.** A malformed byte is reported as "must be UTF-8" at path `$`; a JSON error carries the parser's message; a format violation carries the JSON path of the offending value (`packages/boot/plugin-market/src/parse.ts:24-47`).
- **`failAt` vs `failedAt` in the plugin market**: a *fetch* failure names the source it could not read; the index *content* failure names the path inside the document (`packages/boot/plugin-market/README.md`).

## 5. Weak spots

- **The module-resolution interception is deeply invasive.** `profile-resolution/resolver.ts` reaches into `internal/modules/esm/loader`, `internal/modules/cjs/loader` and `internal/modules/helpers` through `node-addon-require-builtin`, patches `Module._resolveFilename`, rewrites error stacks to point at a synthetic anchor, and maintains a `MovedDirectories` shadow of Node's own realpath cache (`packages/boot/app-boot/src/profile-resolution/resolver.ts:733-773`, `resolver.ts:791-822`, `resolver.ts:408-457`). It is defended by a good differential matrix, but it is a large, Node-version-fragile surface to own.
- **The HMR package is the most intricate code in the shard.** It intercepts Node's module loader, replaces `Module._load`, evicts and restores caches, and rewires the Cordis Loader's entries — and its own README lists a long Known Limitations section (module comparison, CommonJS constraints, ambiguous shared runtimes, darwin FSEvents timing) (`packages/boot/hmr/README.md`). "Reload plugin code without restarting" is a large amount of machinery for a modest benefit.
- **Some layers are large enough to be their own product.** `packages/boot/app-boot/src/index.ts` is 1266 lines, `profile-resolution/resolver.ts` 1072, `profile.ts` 823, `packages/boot/hmr/src/index.ts` 1131 and `packages/boot/plugin-manager/src/index.ts` 939 — each with several responsibilities that a smaller codebase would split.
- **The composition model is opaque to a newcomer.** A single row's effective configuration is the product of four patch layers (bundle → profile → home → CLI overlay), each of which *replaces* rather than merges, and `renderConfigDump` exists precisely because "what will actually mount?" is not answerable by reading one file (`packages/boot/app-boot/src/index.ts:667-697`). The `base/cordis.patch.yml` header comment is the only map.
- **The plugin manager's own protection is a hard-coded list.** `protectedModules` is 17 module names in one array (`packages/boot/plugin-manager/src/index.ts:68-78`) — a policy expressed as data in code, with no test-visible reason per name.
- **Several READMEs are long and partly self-referential.** `packages/boot/app-boot/README.md` is 36 KB and `packages/boot/plugin-manager/README.md` 29 KB, with cross-references into `docs/` and sibling package READMEs; the useful decision is often buried in a table far down. (The i18n hash ledgers — 27 files of per-section hashes — are pure machine bookkeeping that a reader must learn to ignore.)
