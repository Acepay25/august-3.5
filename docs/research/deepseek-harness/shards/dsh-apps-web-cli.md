# deepseek-harness :: dsh-apps-web-cli

**Files in shard:** 719 (read: 716, skipped with reason: 3)
**What this shard covers:** the three application shells of the DeepSeek Harness monorepo — `apps/cli` (the `dsh` launcher: argv grammar, profile composition and boot, plugin management, bounded shutdown, startup diagnostics, config/schema dumps), `apps/web` (the Vite-built browser shell, its bundle-isolation build rules, and the entire browser e2e lane with its 229 ARIA/geometry goldens), and `apps/plugin-market-generator` (a standalone, never-executes-the-code index generator for a plugin marketplace). It is the "how do you ship and observe an agent product" shard: almost everything here is about the *edges* — what happens on the second Ctrl+C, what the log says after a failed boot, what a scheduled reminder does when it is overdue, what a human sees when the model asks for permission. The agent loop itself lives elsewhere in the monorepo; this shard shows the shell that drives it.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `apps/cli/src/args.ts`
- **Purpose:** Owns the `dsh` command grammar. Decides whether an invocation is a profile boot, a config dump, a schema dump, or plugin management, and where the launcher's own flags end and the booted app's arguments begin.
- **Key abstractions:** `DshInvocation` (a four-way union: `profile` | `dump-config` | `dump-config-schema` | `plugin`), `parseDshArgs(argv, version, manageDesktopProfile)`, and the `collect` helper for the repeatable `--patch` option.
- **Data flow:** argv → Commander (with `allowUnknownOption()` at `apps/cli/src/args.ts:164`) → a `DshInvocation` whose `args` field is handed to the booted tree verbatim through `ctx.cmdlineArgs`.
- **Non-obvious design decisions:**
  - The launcher "parses only what it owns": the first token it does not recognise starts the app's arguments, so `dsh --profile web --help` prints the *web app's* help, not the launcher's. This is implemented by `passThroughOptions()` + `enablePositionalOptions()` and a `helpOption(false)` on the launcher (`apps/cli/src/args.ts:164` area). It is the reason `dsh -h` with no profile still prints the launcher's help — a bare `dsh -h` has no app to hand it to.
  - `--patch` is deliberately **non-variadic** (`apps/cli/src/args.ts:83`-adjacent `collect`): a variadic `--patch` would swallow the inner app arguments. The comment says so in one line.
  - `dsh <name>` expands to `dsh --profile <name>`, but only when the first token is not `plugin` and does not start with `-`; `plugin` is reserved for management.
  - `desktop` is a reserved profile name: `rejectElectronProfile` (`apps/cli/src/args.ts:83`) refuses both boot and dump for it, and the npm build refuses plugin management for it unless the Desktop carrier passes `manageDesktopProfile`.
  - The three dump flags are **mutually exclusive** and **refuse app arguments**: a dump never runs an app's command-line provider, so printing a tree that differs from what the same invocation would boot would mislead.
- **Edge cases & failure handling:** repeated `--profile` before app arguments is rejected; `--profile` after a shorthand name is an error; an empty `--patch` value is an error; a `CommanderError` is turned into `process.exit(error.exitCode)`.
- **Surprising:** `parseDshArgs` never returns without a resolution — a bare `dsh` with no profile calls `program.error(...)`, i.e. it exits inside the parser. The function's `DshInvocation` return type therefore means "the invocation that was booted", not "maybe an invocation".

### `apps/cli/src/bin.ts`
- **Purpose:** The `dsh` process entry. Resolves the invocation, then **dynamically imports only the runner that mode needs** (`./profile-boot.ts`, `./plugin.ts`, `./dump-config.ts`, `./dump-config-schema.ts`).
- **Key abstractions:** `runCli(options: RunCliOptions)`, `RunCliOptions` (`packageManager` + `manageDesktopProfile`).
- **Data flow:** `process.argv.slice(2)` → `parseDshArgs` → a `switch (invocation.mode)` that imports one module and awaits it. `loadLayeredEnv('dsh')` produces the frozen launch-environment snapshot that `runProfile` later uses for proxy resolution.
- **Non-obvious design decisions:** the lazy import is the *only* thing keeping a config dump from booting a Cordis tree, and a `plugin` command from loading the whole runtime. The `default:` branch is `invocation satisfies never` — a compile-time exhaustiveness check, so adding a mode without handling it is a type error.
- **Edge cases & failure handling:** only a `StartupError` is converted into a diagnostic report and `exit(1)`; any other error is rethrown so the stack survives.
- **Surprising:** `process.exit(await runPlugin(...))` — the plugin mode exits with pnpm's own status code, so a pnpm failure is visible in the shell.

### `apps/cli/src/profile-boot.ts`
- **Purpose:** The shared profile lifecycle for every `dsh` surface (web, headless, sdk, acp, and the Desktop host). Resolves the profile, stacks its patch layers, mounts the tree, wires fail-loud and bounded shutdown.
- **Key abstractions:** `runProfile(options)`, `prepareProfile(name, userLayer, fromDefaultProfile)`, `initializeProfileFromDefault(name, fromDefaultProfile, home)`, `homePatchPath()`, `INSTALL_ANCHOR`, `createAppReady()`.
- **Data flow:** the layer stack is *bundle patches* (in `dsh.profile.bundles` order) → the profile's own `cordis.patch.yml` → the home-level `$DSH_HOME/cordis.patch.yml` → each `--patch` overlay in argv order → the telemetry switch. The composition is applied over an **empty root config** (`PROFILE_ROOT_CONFIG`, `apps/cli/src/profile-boot.ts:81`).
- **Non-obvious design decisions:**
  - **The root config is rewritten on every boot.** The comment at `apps/cli/src/profile-boot.ts:81` explains it: the vendored Loader's tree write-back (a plugin self-disposing persists the current tree) can bake composed rows into the file, which would duplicate every bundle insert on the next boot. The file exists only because the Loader needs a real include root to anchor `baseUrl` at the profile directory.
  - **Profile replacement is a two-rename transaction in a staging directory** (`initializeProfileFromDefault`, `apps/cli/src/profile-boot.ts:108`). The new profile is assembled in `.<name>.staging-*` beside the target and moved in; only *then* is the previous target deleted. A failed move restores the previous directory; if the restore also fails, the old profile stays at the reported staging path for manual recovery. Windows reports `EPERM` rather than `EEXIST`, so the *target's state* is used to detect a concurrent winner. Shipped profile names are reserved case-insensitively.
  - **The outbound proxy is resolved from the launch snapshot, not `process.env`** (`apps/cli/src/profile-boot.ts:36`): Node's `fetch` ignores the proxy environment on its own, and `NODE_USE_ENV_PROXY` cannot see a proxy declared in a `.env` layer because Node samples the environment at start.
  - **Signals own teardown for the whole startup window**, not just after `boot()` settles (`apps/cli/src/profile-boot.ts:307`): an inserted provider can publish before sibling rows finish mounting. `SIGTERM` (a supervisor's stop request) exits **0** on every surface; `SIGINT` (a user interrupt) reports **130**.
  - `createAppReady()` is a hand-rolled one-shot readiness latch: `onReady` listeners registered after the commit fire immediately; before it, they queue.
- **Edge cases & failure handling:** cleanup failures are aggregated (`AggregateError`) rather than masking the original startup error. `dispose` is idempotent via a memoised promise. The proxy disposer and the fiber disposer are both attempted even if the first throws.
- **Surprising:** `prepareProfile` is called by the *dump* modes too — "a dump initializes missing profile files". The dump is boot-free but not side-effect-free.

### `apps/cli/src/process-shutdown.ts`
- **Purpose:** A bounded, escalating process-exit controller shared by normal completion and Unix signal handlers.
- **Key abstractions:** `createProcessShutdown(dispose, forceExit, complete, timeoutMs)`, `ProcessShutdown` (`shutdown(code)` / `interrupt(code)`), `PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000` (`apps/cli/src/process-shutdown.ts:4`).
- **Data flow:** `start(code, forceAfterDispose)` arms a timer, then runs `dispose()`. Resolution → `complete(code)` (sets `process.exitCode`) or, for an interrupt, `forceExit(code)`. Rejection → forced exit.
- **Non-obvious design decisions:**
  - The controller distinguishes **"drain"** from **"escalate"**. The first `SIGINT`/`SIGTERM` calls `interrupt`, which starts the graceful drain *and* force-exits once disposal settles. A *second* signal, arriving while the drain is in progress, force-exits immediately. Normal `shutdown(code)` calls **coalesce** and are *not* treated as escalation.
  - The 5-second grace is a *hard* bound: if disposal hangs, the process exits anyway. The comment in `apps/cli/reference/README.md` ("Process shutdown gives the plugin tree up to five seconds to dispose") makes this a product promise.
  - `forceExitOnce` / `completeOnce` are separately latched, so a forced exit can never be overwritten by a later natural completion.
- **Edge cases & failure handling:** disposal rejection → forced exit, not a silent hang. `interrupt` after `shutdown` is already running → immediate force exit. `timeoutMs` is replaceable, which is how the unit spec pins the bound.
- **Surprising:** `complete` defaults to `process.exitCode = code`, not `process.exit(code)` — a normal completion lets the event loop drain, while only the escalation path hard-exits.

### `apps/cli/src/startup-diagnostics.ts`
- **Purpose:** Saves a full startup-failure report to a private, uniquely named file under `$DSH_HOME/logs`, while keeping the terminal report to one line.
- **Key abstractions:** `reportStartupFailure(error, context, write?)`, `StartupDiagnosticContext` (`home`, `version`, `profile`).
- **Data flow:** `StartupError` → `util.inspect` with `depth: null, maxArrayLength: null, maxStringLength: null, showHidden: true, customInspect: false, getters: false, colors: false` → a text report → `mkdir(logDir, { mode: 0o700 })` + `writeFile(logPath, report, { flag: 'wx', mode: 0o600 })` (`apps/cli/src/startup-diagnostics.ts:62`).
- **Non-obvious design decisions:**
  - `flag: 'wx'` means the write **fails rather than overwriting** — earlier reports are never replaced, and concurrent failures get distinct files (`startup-<timestamp>-<uuid>.log`).
  - The file name carries both a timestamp and a `randomUUID()`, so two failures in the same millisecond still get distinct paths.
  - The report header says *"Raw diagnostics may contain configuration or credential values from plugin errors. Review before sharing."* and the docs state plainly that **values are not redacted** — the design choice is to be complete, not to be safe.
  - `gutter: false` on the inspect options means accessors are *described*, never evaluated.
  - The stderr write is **awaited** (`writeStderr` resolves on the stream's callback) so the process does not exit before the report is on the terminal.
- **Edge cases & failure handling:** if the log directory or file cannot be written, the *complete* report is printed to stderr instead of claiming a saved path, and the exit code stays 1.
- **Surprising:** the collection explicitly does **not** gather environment variables or configuration contents independently of the logged errors — only what the plugin already put in its error.

### `apps/cli/src/plugin.ts`
- **Purpose:** Profile package management and explicit, exact-version compatibility approvals.
- **Key abstractions:** `runPlugin(profile, args, packageManager?)`, `versionCommand(profile, args)` (the DSH-owned `allow-version` / `revoke-version` / `version-exemptions` sub-commands).
- **Data flow:** `dsh plugin --profile <name> <pnpm args…>` → the DSH-owned version commands are intercepted, everything else is forwarded to pnpm with the profile directory as cwd, under `withFileLock(profile/package.json)`.
- **Non-obvious design decisions:**
  - The compatibility approval is **exact and narrow**: `allow-version <package@version> --dsh-version <exact>` and it requires `--accept-risk`. It applies to one package *and* one DSH version, is persisted in the profile, and prints the risk warning to stderr before granting.
  - These DSH-owned commands **never become pnpm arguments** — the parser only recognises its own three verbs and throws on an unexpected argument.
  - The profile write lock is shared with the plugin manager and the profile's manifest; the Desktop profile runs under the same lock with a bundled pnpm.
  - Exit code 127 is translated into "pnpm was not found; install pnpm and make it available on PATH", and each incompatible package prints the **exact** command the user should run next.
- **Edge cases & failure handling:** the `desktop` profile must already be initialised by the Electron app, otherwise the command errors with an instruction; other profiles are initialised on first use from the shipped template (or the base bundle alone).
- **Surprising:** a git-hosted plugin that builds on install is called out by name: pnpm ≥10 blocks the `prepare` script, and the CLI prints both pnpm's `allowBuilds` hint and the path of the profile's `pnpm-workspace.yaml` where the key must be pasted.

### `apps/cli/src/dump-config.ts`
- **Purpose:** Prints a profile's composed patch tree as commented YAML without booting it.
- **Key abstractions:** `runDumpConfig(profile, defaultOnly, patches, fromDefaultProfile)`, `collectConfigDumpLayers(loaded, defaultOnly, patches)`.
- **Data flow:** `prepareProfile` → layers in bundle → profile → home → argv order → `renderConfigDump` on stdout.
- **Non-obvious design decisions:** `--dump-default-config` (bundle layers only) is the **recovery diagnostic for a broken `cordis.patch.yml`** — because it never reads the user layer, a profile whose own patch file is corrupt can still be inspected. `--dump-default-config` also refuses `--patch` overlays, because the option means "the bundle layers and nothing else".
- **Edge cases & failure handling:** `!!js` expressions stay unevaluated; relative plugin names in inserted rows resolve beside their patch file; unmatched patch targets are reported on stderr.
- **Surprising:** the dump *does* initialise missing profile files. It is boot-free but not read-only.

### `apps/cli/src/dump-config-schema.ts`
- **Purpose:** Emits one JSON Schema 2020-12 document describing the composed profile's *declared* plugin configuration, without applying any plugin.
- **Key abstractions:** `runDumpConfigSchema(profile, patches, fromDefaultProfile)`.
- **Data flow:** same layer collection as the YAML dump → `generateConfigSchema(loaded, layers, INSTALL_ANCHOR)` → `JSON.stringify(dump, null, 2)` on stdout, diagnostics on stderr.
- **Non-obvious design decisions:**
  - **stdout is redirected to stderr for the whole collection** (`apps/cli/src/dump-config-schema.ts:36`) and restored in a `finally`. Trusted module diagnostics must not precede the JSON document on stdout — a consumer piping stdout into `jq` would otherwise get garbage.
  - The exit code distinguishes *failure* (nonzero, no schema) from *incompleteness* (`dump['x-cordis'].complete === false` → `exitCode = 1` **with** a partial but usable schema on stdout). The reference calls this "a regenerated, pre-stable reference, not a versioned persisted catalog".
- **Edge cases & failure handling:** collection imports trusted modules and may run import-time code; the docs warn that automated callers should enforce an **external** timeout because the dump neither force-exits nor owns disposal of import-time resources.
- **Surprising:** the schema describes *declarations*, not configured values — but declared defaults and raw plugin errors can still contain sensitive data, so the output is not automatically safe to share.

### `apps/cli/src/bin.ts` / `apps/cli/src/sdk-source.cordis.patch.yml` / `apps/cli/tsdown.config.ts`
- `sdk-source.cordis.patch.yml` disables the `typert-loader` row in a clean source checkout (no build-generated contributor modules exist yet) — a one-line, honest patch rather than a conditional in code.
- `tsdown.config.ts` ships **two** entries (`lib/types/bin.js` and `lib/types/profile-boot.js`): the CLI and the profile lifecycle shared with the Desktop host. `dts: false` — declarations come from `tsc -b`, matching every package in the monorepo.

### `apps/plugin-market-generator/src/cli.ts`
- **Purpose:** The generator's command line: `--input`, `--output`, `--title`, plus `--description`, `--cache`, `--registry`, `--inline-icon-bytes`, `--concurrency`, `--timeout-ms`.
- **Key abstractions:** `main(argv)`, `program()`, `Options`.
- **Data flow:** argv → Commander → `parseSources(readFileSync(input))` → `generate({...})` → icons written beside the index, stale generated icons removed, index written via `writeIfChanged`.
- **Non-obvious design decisions:**
  - **Three exit statuses, documented in the help text itself** (`apps/plugin-market-generator/src/cli.ts:60`): `0` every source read, `1` some source fell back to its cached result or was omitted, `2` invalid arguments or input. A publisher can therefore script the marketplace build.
  - Paths resolve against `process.env.INIT_CWD ?? process.cwd()`, because `pnpm --filter … start` runs the program in the *package* directory, not the directory the user typed in.
  - `--inline-icon-bytes` is capped at `MAX_INLINE_ICON_BYTES` (32768) by the option parser itself, so the index format's limit cannot be exceeded by a flag.
  - `--registry` is normalised to a trailing slash and a non-public registry is recorded in every npm version's `source`, so a consumer can tell where a version came from.
- **Edge cases & failure handling:** Commander's own errors are already printed, so `main` only maps them to an exit code; any other throw becomes `2` with the message on stderr.
- **Surprising:** the generator's own `--cache` defaults to a directory *next to the input list*, explicitly "beside the input list" and not inside the published output directory.

### `apps/plugin-market-generator/src/generate.ts`
- **Purpose:** Turns a source list into a validated format-1 plugin-market index, reusing cached results for unchanged releases and commits.
- **Key abstractions:** `generate(options)`, `Cache`, `readNpm`, `readGit`, `entryOf`, `releaseOf`, `mapLimited`.
- **Data flow:** sources → per-source read (npm packument + one tarball, or Git refs + objects) → cache lookup → `parseMarketIndex(index, VALIDATION_URL)` → index document + icon files + a list of failures.
- **Non-obvious design decisions:**
  - **A failed source keeps its last successful result** (`apps/plugin-market-generator/src/generate.ts:330`): a transient outage does not drop plugins from the index; the failure is still reported and the exit code is 1. The mechanism is a separate `last/<hash>.json` file per source, distinct from the per-identity cache.
  - **The cache is versioned** — `CACHE_VERSION = 7` (`apps/plugin-market-generator/src/generate.ts:62`) is mixed into every cache key, so changing the derivation rules rebuilds the cache rather than serving stale entries.
  - A cached record is only used when the index **format still accepts it** and its icon files still exist. A damaged or now-invalid cache entry is rebuilt, not trusted.
  - `mapLimited` keeps results in input order, so the index is deterministic: entries follow the list order and the file is rewritten only when its bytes change.
  - Git version resolution has an explicit **precedence ladder**: `<name>@` tag (rank 0) beats a unified tag (rank 1) beats the default branch (rank 2); ties break on the earlier commit time.
- **Edge cases & failure handling:** a release-named tag pointing at something unreadable is reported and lists nothing, so it cannot fail the whole repository. A package name produced by two sources keeps the first and warns.
- **Surprising:** the *whole index* is re-validated through `parseMarketIndex` before it is written, and the validation URL is a deliberately invalid `https://index.invalid/index.json` so that relative icon references are checked but no network request is implied.

### `apps/plugin-market-generator/src/fetchers.ts`
- **Purpose:** Downloads package files **without running any of their code**.
- **Key abstractions:** `npmPackument`, `npmTarball`, `gitRefs`, `withGitObjects`, `cacheKey`, `FetchLimits`, `GitObjects`.
- **Data flow:** npm: `fetch` the packument → `fetch` the tarball → verify the registry integrity hash → unpack in memory with `tar` → `readManifest`. Git: `git ls-remote` → `git init --bare` in a temp dir → `git fetch --depth 1 --stdin` → `ls-tree`/`cat-file` to read blobs.
- **Non-obvious design decisions:**
  - **The tarball's bytes must match the registry's `dist.integrity`** before a single byte is unpacked, and the unpacked `package.json` must name the requested package *and* version.
  - Unpacking keeps only regular files outside `node_modules`; symlinks, submodules, and directories without files do not exist.
  - **Git is run with the repository's own code disabled** (`apps/plugin-market-generator/src/fetchers.ts:149`): `core.hooksPath=/dev/null`, `core.fsmonitor=false`, `submodule.recurse=false`, `gc.auto=0`, `maintenance.auto=false`, `protocol.allow=never` plus an explicit allow-list of transports (default `https`, `ssh`; `file` only in tests).
  - Git objects are fetched into a **private temporary bare repository** and read as blobs, so no working tree exists: no checkout filter, no LFS download, no symlink takes effect.
  - `GIT_*` variables are stripped from the environment except `GIT_SSH`/`GIT_SSH_COMMAND`; `GIT_TERMINAL_PROMPT=0` and `GIT_LFS_SKIP_SMUDGE=1` are forced, and ssh runs in batch mode unless the user set their own.
  - The raw commit object is read for the committer time, so no user formatting option (e.g. signature display) can run on repository data.
- **Edge cases & failure handling:** a 64 MiB bound on both the compressed tarball and its unpacked contents; a 1 MiB bound on manifests, locale files, and workspace files. When a server refuses a fetch-by-SHA, the generator falls back to fetching by ref name.
- **Surprising:** `command.child.stdin?.on('error', () => {})` — Git may exit before it reads its input, and the exit status already reports that failure, so the broken pipe is deliberately not a second one.

### `apps/plugin-market-generator/src/metadata.ts`
- **Purpose:** Reads a package's display metadata the way DSH reads *installed* plugin metadata — locale files and the icon resolved through the package `exports` map, with nothing evaluated.
- **Key abstractions:** `readDisplayMetadata(files, manifest, options)`, `Display`, `IconFile`, `GENERATED_ICON`, `dictionaries`, `localized`, `repositoryUrl`, `readIcon`.
- **Data flow:** `PackageFiles` + `Manifest` → locale dictionaries → display fields → an icon that is either a `data:` URL (≤ `inlineBytes`) or a content-hashed file under `icons/`.
- **Non-obvious design decisions:**
  - **The icon file name is a content hash** (`sha256(...).slice(0, 16)` + extension), so the index is stable and a changed icon is a new file. `GENERATED_ICON` is the regex that lets the publisher delete *only* icons it generated.
  - A locale file must resolve **into the same directory as `./locale/en.json`**; a translation without an English value *and* without a manifest fallback is dropped, because the format requires English.
  - The **author string is scrubbed of the email**: npm's `Name <email> (url)` becomes just `Name`, and the comment says the point is that "no address spreads into the index".
  - `repository` is turned into a *browse* URL: a `#semver:^1` committish is stripped, credentials/query/fragment/`.git` are removed, and a `directory` that is not a safe relative path is reported and omitted.
  - `homepage` is copied **as written** — and nothing else (not `repository`) stands in for a missing one. A non-http(s) homepage is reported and omitted, not substituted.
  - Keywords are copied unchanged, including empty strings, duplicates, and an empty array; a non-array or a non-string member produces a warning and omits the whole field **without dropping the package**.
- **Edge cases & failure handling:** a malformed locale file, an invalid locale name, an icon that is not SVG/PNG/JPEG/WebP, an icon over 256 KiB, an icon outside the package — each is a *warning*, and the package still ships.
- **Surprising:** `metadata.ts` mirrors DSH's *installed-plugin* metadata rules exactly, so an index built from a Git tag and a plugin installed from npm look identical in the Discover page.

### `apps/plugin-market-generator/src/packages.ts`
- **Purpose:** Reads manifests and finds bundle packages in a repository tree, without running any code.
- **Key abstractions:** `readManifest`, `isBundle`, `dshRange(manifest)`, `findBundlePackages(files, warn)`, `workspaceGlobs`, `expandGlob`, `scan`.
- **Data flow:** `PackageFiles` → `package.json` / `pnpm-workspace.yaml` → a list of repository-relative package directories.
- **Non-obvious design decisions:**
  - **`dshRange` computes the conjunction of DSH peer ranges** (`apps/plugin-market-generator/src/packages.ts:83`): it takes the `||` alternatives of each peer range, keeps each comparator once, drops combinations no version satisfies, and returns an `Error` when installation would refuse the version on *every* DSH version. A range of exactly `workspace:*` / `workspace:^` / `workspace:~` means "the running DSH version" and imposes nothing; `*` admits every version and is dropped.
  - The combination is capped at `MAX_RANGE_ALTERNATIVES = 256` — a version needing more is not listed, rather than producing a pathological range string.
  - **Bundle discovery has a documented precedence**: root manifest declares a bundle → the root only; workspace globs match bundle packages → those; otherwise a bounded scan of three directory levels, skipping `node_modules`, `test`, `tests`, `fixtures`, `example`, `examples`.
  - A glob that matches nothing is *reported*, and negated globs are ignored.
  - `expandGlob` implements a small glob language itself (`*` within a segment, `**` for zero-or-more directories) rather than pulling in a matcher.
- **Edge cases & failure handling:** a malformed manifest or a malformed workspace file declares no package rather than throwing. Parent-relative globs match nothing by design.
- **Surprising:** `SCAN_DEPTH = 3` — the fallback scan is deliberately shallow, so a deep monorepo must declare workspaces to be indexed.

### `apps/plugin-market-generator/src/files.ts`
- **Purpose:** Atomic file writes shared by the cache and the output, plus the read-only in-memory file tree that packages are read from.
- **Key abstractions:** `writeIfChanged(file, contents)`, `readJsonFile(file)`, `PackageFiles` (with `resolve`, `file`, `read`, `directories`, `fileNames`, `within`), `MAX_TEXT_FILE_BYTES`.
- **Data flow:** bytes → a temporary sibling file → `renameSync` into place. The rename is what makes the write atomic; a reader never sees a partially written file.
- **Non-obvious design decisions:**
  - **`writeIfChanged` compares bytes first** and returns `false` without touching the file when the content is identical. The whole generator is therefore idempotent: re-running with no upstream change leaves the output untouched (mtime included).
  - The temporary name includes `process.pid` and a random suffix, so two concurrent generator runs cannot collide on it.
  - `readJsonFile` treats a malformed file as *absent*, so an older or interrupted generator's file is rebuilt rather than crashing the run.
  - `PackageFiles.resolve` refuses absolute paths and anything that leaves the tree — the package boundary is enforced in the resolver, not at the call sites.
  - `MAX_TEXT_FILE_BYTES = 1 MiB` is enforced at read time, not at download time.
- **Edge cases & failure handling:** symbolic links, submodules, and empty directories simply do not exist in the tree.
- **Surprising:** `PackageFiles` is a *virtual* file system — the generator never unpacks a tarball or checks out a repository to disk. It builds a map of path → lazy reader and indexes directory children in the constructor.

### `apps/plugin-market-generator/src/sources.ts`
- **Purpose:** Parses the source list — one npm package name or https Git URL per line.
- **Key abstractions:** `parseSources(text)`, `Source` (`{kind:'npm'|'git', line, name|url}`).
- **Data flow:** text → per line → **the index format itself is the validator**: `check()` builds a throwaway format-1 index with the candidate and runs `parseMarketIndex` on it.
- **Non-obvious design decisions:**
  - The list parser does not re-implement the rules; it *borrows* the format's own parser, so a line the index would reject is rejected at list-parse time with the format's reason. The error message quotes that reason.
  - A trailing `/` or `.git` is dropped so `https://github.com/o/r/` and `https://github.com/o/r.git` name the same repository, and repeats are dropped.
  - A Git URL is validated with a 40-character zero commit as a placeholder — the URL shape is checked, not the repository.
- **Edge cases & failure handling:** the error names the **line number** and the offending line.
- **Surprising:** `parseSources` is the only place the generator touches user input, and it is a two-function file.

### `apps/web/src/main.ts`
- **Purpose:** The browser entry for the Web client.
- **Key abstractions:** `AppWebEntry` (from `@deepseek-ai/dsh-client-web`), `applyIndexInjections`, the `DesktopBootGlobal` interface.
- **Data flow:** theme CSS import → `new AppWebEntry(#root)` → `entry.run(reportFailure)`. When the Desktop carrier is present, it waits for `desktop.ready()` (which yields `injections` + `streamBaseUrl`), sets `__DSH_TRANSPORT__`, injects the index scripts, and only then resolves the `__DSH_BOOT_READY__` gate.
- **Non-obvious design decisions:**
  - **The failure path is explicit**: if `dshDesktopBoot` is absent, a boot error is re-thrown; if it is present, the error is reported to the carrier as `desktop.failed(message)`. The GUI never shows a half-booted shell.
  - The `__DSH_BOOT_READY__` gate is a `PromiseWithResolvers` the desktop side can await; the web side **rejects** it on failure so the carrier can render a diagnostic.
  - `applyIndexInjections` loads scripts by appending `<script>` tags and resolving on `load` / rejecting on `error` — a failed injection is a named error, not a silent no-op.
- **Edge cases & failure handling:** a missing `#root` throws immediately; a missing `__DSH_BOOT_READY__` in the desktop path throws `desktop web: boot readiness is missing`.
- **Surprising:** the entry is a *boot shim*, not an application — the whole application is the `dsh-client-web` library, and the Vite entry cannot run standalone (see `vite.config.ts`).

### `apps/web/src/preview.ts`
- **Purpose:** The worker-preview bootstrap — the one module `preview.html` adds ahead of the stock entry tag.
- **Key abstractions:** `chooseWorkerHostSource`, `connectWorkerHost`, `DshWorker`.
- **Data flow:** top-level await → choose the data source (pre-Cordis) → `connectWorkerHost(new DshWorker(...), { image, overlays })` → the served startup chain continues verbatim.
- **Non-obvious design decisions:** the *pre-Cordis* source chooser runs **before** the Worker handshake, so the "Choose Preview data" dialog is not part of the Cordis tree and cannot be affected by it. The file is a **separate Rollup entry** rather than an extra `<script>` tag in `index.html`, because Vite folds every module tag of one page into a single synthetic entry and only a separate input keeps the shared page chunks bootstrap-free.
- **Edge cases & failure handling:** the comment in `vite.config.ts` is explicit that the Worker preview surface groups under `dist/preview/` so the published payload can exclude it as one directory.
- **Surprising:** `preview.html` is produced by *string-splicing* the built `index.html` — it is the same page with one extra `<script>` tag, and shares every chunk with it.

### `apps/web/src/node-module-stub.ts`
- **Purpose:** A browser stand-in for `node:module`, used through Vite's `resolve.alias` for the vendored Cordis Loader's only Node import.
- **Key abstractions:** `createRequire` (throws), `LoadHookContext` (type-only `never`).
- **Data flow:** the vendored loader's `import { createRequire } from 'node:module'` is aliased to this stub.
- **Non-obvious design decisions:** **it fails loud**: `createRequire` throws `'node:module is not available in the browser'` rather than returning a shim. The comment says the path is unreachable in the configured loader path and "fails loud if that assumption changes" — a silent no-op stub would let a broken build ship.
- **Edge cases & failure handling:** the error surfaces at first use, not at import time, because the stub is a function.
- **Surprising:** `LoadHookContext` is typed `never` — the stub is *type-level* proof that no Node loader hook is reachable from the browser build.

### `apps/web/vite.config.ts`
- **Purpose:** The Web build: chunking policy, the emitted preview page, the standalone-serve rejection, and the CSS/worker instrumentation.
- **Key abstractions:** `rejectStandaloneServe()`, `clientDocumentTitle()`, `brandFontLicense()`, `emitPreviewPage()`, `katexWoff2Fonts()`, `productWebBundleIsolation()`, `VENDOR_PACKAGES`, `npmPackageOf(id)`.
- **Data flow:** `defineConfig` → plugins in order → `build.rollupOptions.input` = `{ index: index.html, bootstrap: src/preview.ts }` → `manualChunks` → `output.entryFileNames` / `chunkFileNames` / `assetFileNames`.
- **Non-obvious design decisions:**
  - **The bundle is refused to run standalone** (`apps/web/vite.config.ts:48`, `STANDALONE_ERROR` at `:12`): `config(_config, env)` throws whenever `env.command === 'serve'`, with a message that names the correct commands (`pnpm dsh web`, `dsh web`, `pnpm run dev:web`). The reason is that only `dsh web` injects `window.__DSH_BOOT__`; a bare Vite server would present a bootless shell as a working GUI.
  - **The vendor chunk is a hand-maintained allow-list of exact npm package names** (`VENDOR_PACKAGES`, `apps/web/vite.config.ts:118`) with a long comment explaining the constraint: *every member must be React-free*, because Rollup folds a module shared between the entry and a manual chunk into the manual chunk — one React-importing member would drag the single shared React copy into `vendor` and split hook and element identity.
  - The list is deliberately conservative: only packages the workspace imports *directly* are listed; their private transitive dependencies are pulled in by Rollup's chunk colouring. A dependency shared with index-side code falls back to `index` — "a few kB of dilution, never a correctness problem".
  - Lazy `@shikijs/langs` grammars are **kept out** of `vendor` (they must stay on-demand chunks); only the three boot grammars are listed explicitly as `BOOT_GRAMMAR_FILES`.
  - `resolve.dedupe: ['react', 'react-dom']` (`apps/web/vite.config.ts:240`) with a comment that React must stay a **devDependency** of this package and that any watcher must run Vite from this directory — otherwise a second React ships and splits hook identity.
  - The alias table has exactly one entry: `node:module` → the failing stub.
  - `build.target: 'es2022'` because the worker bootstrap uses top-level await, which Vite's default `es2020`-era target rejects.
  - `base: './'` — relative asset URLs, so `preview.html` mounts the same output under any base directory.
- **Edge cases & failure handling:** the preview page is emitted only when `build.write` is true and `writeBundle` ran; a missing module-entry tag in the built `index.html` throws rather than producing a broken page.
- **Surprising:** `process.versions.node` is *defined* as `"0.0.0"` in the build, and `process.env.CORDIS_SHARED` as `undefined`, so the vendored loader's environment probes take the intended branches.

### `apps/web/product-isolation.ts`
- **Purpose:** Vite plugins that record every chunk, asset, CSS and worker input of the built default Web page, and fail the build if an experimental package reaches it.
- **Key abstractions:** `productWebBundleIsolation(repository, webRoot)`, `browserDependencyAnalysis()`, `WebProductBundleIsolation` (from `scripts/web-product-bundle-isolation.ts`).
- **Data flow:** `buildStart` → `inputs.reset()` → `generateBundle` (pre) captures chunks → CSS `transform` is wrapped to record each stylesheet and its `addWatchFile` dependencies → `renderBuiltUrl` records asset references → `generateBundle` (post) → `inputs.verify(bundle, id => this.getModuleInfo(id))`.
- **Non-obvious design decisions:**
  - **The CSS plugin is instrumented by wrapping `vite:css`'s own `transform`** through a `Proxy` whose `addWatchFile` is intercepted. If Vite's CSS plugin is missing or is not exactly one instance, the build **throws** (`Web product isolation: Vite CSS input instrumentation is unavailable`) rather than silently recording less.
  - `browserDependencyAnalysis` is a separate, build-only plugin that **requires `build.write: false`** — a dependency-disclosure walk that could write output is refused.
  - The `dependencyAnalysis` flag switches the verification off during an analysis run, so the analysis does not fail on the experimental packages it is deliberately reporting.
- **Edge cases & failure handling:** the isolation plugin runs `enforce: 'post'` and fails *before publication*, not after.
- **Surprising:** the whole mechanism exists to stop experimental packages leaking into the shipped Web bundle — "the product" is a build-time invariant, not a code review convention.

### `apps/web/katex-fonts.ts`
- **Purpose:** A `lightningcss` transform that keeps only WOFF2 KaTeX font sources.
- **Key abstractions:** `katexWoff2Fonts(): Plugin`.
- **Data flow:** Vite `transform` on `katex/dist/katex(.min).css` → `lightningcss.transform` with a `visitor.Rule['font-face']` → the filtered CSS + source map.
- **Non-obvious design decisions:** **a face without a WOFF2 source rejects the build** (`KaTeX font face requires a WOFF2 source`) — the transform is `enforce: 'pre'` so it runs before the CSS pipeline. Other packages' stylesheets are untouched, and every face and layout rule is preserved.
- **Edge cases & failure handling:** the match is on the module id with backslashes normalised to forward slashes, so Windows paths behave like POSIX ones.
- **Surprising:** the unit spec (`apps/web/tests/katex-fonts.spec.ts`) asserts both directions — that a face without WOFF2 is rejected **and** that older font formats in unrelated stylesheets are preserved.

### `apps/web/stress-tests/reasoning-chunks.stress.ts`
- **Purpose:** An opt-in browser stress reproduction for reasoning-stream renderer stalls.
- **Key abstractions:** `ReasoningStressAdapter` (an `LlmAdapter` that emits 100,000 individual chunks through the real Host/Gateway/browser carriers), `StressProbe`, `CHUNK_COUNT = 100_000` (`apps/web/stress-tests/reasoning-chunks.stress.ts:18`), `MAIN_THREAD_DELAY_BUDGET_MS = 250` (`:21`).
- **Data flow:** the adapter yields batches of 128 chunks every 16 ms, paced by the test through `emitNextBatch()`; the browser runs a 50 ms interval probe that records the **maximum event-loop delay**, and a scheduled custom event measures **scheduled-interaction latency**; the test asserts both are under 250 ms and that the page had zero errors.
- **Non-obvious design decisions:**
  - The probe measures **two different things** — the max main-thread delay and the latency of a *scheduled interaction* — because a renderer can block the loop while still dispatching a timer that was already due.
  - The stream is externally paced (`releaseBatch` / `resolveBatch`) so the test can hold the model mid-stream and observe a **collapsed Think row that is still live**.
  - `options.signal?.throwIfAborted()` is checked on every batch: the stress lane also proves the stream is abortable.
  - The report is written to stdout as JSON before the assertions, so a failure leaves the numbers behind.
- **Edge cases & failure handling:** `onTestFailed` saves a screenshot; `adapter.finish()` is called in a `finally` so the loop never hangs the suite; the whole scenario has a 600 s timeout and the turn a 540 s settle budget.
- **Surprising:** this is a *stress* test in the repo's own sense — it is not part of the default lane, it measures rather than asserts timing, and the text it streams is `推理` (Chinese) so the CJK path is exercised too.

### `apps/cli/tsconfig.json` and `apps/cli/tsdown.config.ts`
- **`tsconfig.json`** lists the 25 workspace projects the CLI composes (app-boot, cmdline, the base/headless/web/sdk/acp bundles, the webserver and frontend-static hosts, session/system-prompt/tools, launch-environment, home-paths, mcp-client, session-query, shell, plugin-manager, atomic-write). It is a *reference* graph, not a build script — `tsc -b` builds them in order.
- **`tsdown.config.ts`** ships **two** entries (`lib/types/bin.js` and `lib/types/profile-boot.js`): the CLI and the profile lifecycle shared with the Desktop host. `dts: false` — declarations come from `tsc -b`, matching every package in the monorepo. `clean: ['lib/*.js']` so a stale chunk cannot survive a rebuild.
- `apps/cli/src/sdk-source.cordis.patch.yml` disables the `typert-loader` row in a clean source checkout (no build-generated contributor modules exist yet) — a one-line, honest patch rather than a conditional in code.

*(The remaining `apps/web` build files — `index.html`, `package.json`, `tsconfig.json`, `.npmignore`, `public/*`, `src/vite-env.d.ts` — are described in the Tier-2 table below; `apps/web/tsconfig.json` excludes ~180 test files from the client aggregate because the e2e lane reads Host services and the two Cordis `Context` faces merge under the same keys with different services.)*

---

### Tier 2 — bulk: a compact table, one row per file

The bulk of this shard is the **test corpus**: 470 test/golden/fixture files under `apps/web/tests` and `apps/cli/tests`. Every file was opened; the description below is the file's own leading doc comment, or its first `describe`/`it` name, or (for JSONL/Markdown goldens) the shape of the artefact it pins. The 25 Tier-1 source files named in §1 are **not** repeated here, so the table plus the Tier-1 entries account for all 719 files exactly once.

*Read method for this tier: the goldens, overlays, fixtures, and JSONL artefacts were read in full; the long spec files were read through their header block and their complete `describe`/`it` inventory, and the highest-value ones (`schedule-timing.expected.e2e.ts`, `semantic-checkpoint.expected.e2e.ts`, `escalation.e2e.ts`, `goal.expected.e2e.ts`, `compaction.e2e.ts`, and the 16 files between `default-workspace.e2e.ts` and `fold-blank-matrix.e2e.ts`) were read line by line. The 229 goldens under `apps/web/tests/expected/` and the 6 under `apps/web/tests/snapshots/` were read in full.*

| File | What it is / what it pins |
| --- | --- |
| `apps/cli/README.i18n.yaml` | generated bilingual-pairing hash manifest for the CLI README |
| `apps/cli/README.md` | CLI README: entry modes, profile layers, the app-argument boundary, optional overlays |
| `apps/cli/README.zh.md` | Chinese translation of the CLI README |
| `apps/cli/composition.md` | generated base-bundle composition graph: 100 plugin ids and their packages |
| `apps/cli/config/examples/mcp-memory/engram.cordis.yml` | opt-in MCP memory overlay for Engram 1.20.0 (stdio, `engram mcp`) |
| `apps/cli/config/examples/mcp-memory/mcp-reference-memory.cordis.yml` | opt-in MCP memory overlay for the reference memory server; `MEMORY_FILE_PATH` defaults to `~/.dsh-mcp-reference-memory.jsonl` |
| `apps/cli/config/examples/mcp-memory/memorix.cordis.yml` | opt-in MCP memory overlay for Memorix 1.3.0 (`memorix serve`) |
| `apps/cli/package.json` | CLI manifest: bin `dsh`, ~100 workspace deps, exports `./profile-boot` for the Desktop host |
| `apps/cli/reference/README.i18n.yaml` | generated bilingual-pairing hash manifest for the CLI reference |
| `apps/cli/reference/README.md` | CLI behaviour reference: layer precedence, flags, shutdown, plugin management, web profile, source execution |
| `apps/cli/reference/README.zh.md` | Chinese translation of the CLI behaviour reference |
| `apps/cli/src/sdk-source.cordis.patch.yml` | disables the `typert-loader` row in a clean source checkout |
| `apps/cli/tests/agent-team-headless.e2e.ts` | real `dsh` run with Agent Teams: two teammates, peer mail, dependent tasks, waiting, Lead aggregation |
| `apps/cli/tests/args.spec.ts` | unit spec of `parseDshArgs`: routing, the app-argument boundary, mutual exclusion of the dump flags, the reserved `desktop` profile |
| `apps/cli/tests/built-bin.e2e.ts` | the **built** `dsh` binary (no tsx): SDK/ACP/headless profiles, profile replacement, hot reload, pnpm forwarding, config dumps |
| `apps/cli/tests/desktop-host.e2e.ts` | Desktop Host lifecycle when Electron disconnects before profile startup settles (with and without a boot failure) |
| `apps/cli/tests/dsh-badge.expected.e2e.ts` | the opt-in bundled badge skill advertised and loaded through the shipped app |
| `apps/cli/tests/dump-config-schema.expected.e2e.ts` | assembled schema dump: native namespaces, Include expansion, positioned diagnostics, partial projections, `x-cordis` completeness |
| `apps/cli/tests/expected/dump-config-schema.json` | the committed JSON Schema 2020-12 golden for the schema dump |
| `apps/cli/tests/expected/launcher-help.txt` | the committed launcher `--help` text golden |
| `apps/cli/tests/fixtures/agent-shutdown.mjs` | fixture plugin that owns scope-limited cancellation during Web shutdown |
| `apps/cli/tests/fixtures/dsh-badge/cordis.yml` | overlay enabling the badge skill |
| `apps/cli/tests/fixtures/dsh-badge/default.cordis.yml` | overlay disabling filesystem watching and telemetry |
| `apps/cli/tests/fixtures/dsh-badge/snapshot.ts` | loader snapshot driver for the badge scenario |
| `apps/cli/tests/fixtures/github-webhook/cordis.yml` | real-product overlay: webhook runtime, rule, workspace, session, agent |
| `apps/cli/tests/fixtures/github-webhook/github-webhook-rule.mjs` | the GitHub webhook rule plugin (Schemastery config) |
| `apps/cli/tests/fixtures/initialize-profile-from-default.ts` | child process that synchronises two competing profile initialisations for the race acceptance test |
| `apps/cli/tests/fixtures/invalid-provider.cordis.yml` | deliberately invalid optional provider row, proving best-effort startup continues |
| `apps/cli/tests/fixtures/memory-mcp-base.cordis.yml` | minimal keyless composition for the MCP overlay test |
| `apps/cli/tests/fixtures/never-dispose.mjs` | disposer that never settles — the Ctrl+C escalation fixture |
| `apps/cli/tests/fixtures/source-tool-driver.ts` | source-profile tool-dispatch evidence from the real Agent and Node module cache |
| `apps/cli/tests/fixtures/web-browser-open/open.mjs` | the browser-opener helper the snapshot observes |
| `apps/cli/tests/fixtures/web-browser-open/register.mjs` | registers the opener helper as the host's browser command |
| `apps/cli/tests/github-webhook-real.e2e.ts` | real CLI + real model: a GitHub webhook creates a Workspace Session end to end |
| `apps/cli/tests/headless-shutdown.e2e.ts` | in a real PTY, the first Ctrl+C drains and the second forces exit |
| `apps/cli/tests/lazy-search-startup.compat.spec.ts` | built CLI boots the shipped Web composition with full-text search off by default, then disposes on SIGTERM |
| `apps/cli/tests/memory-mcp-configs.spec.ts` | the third-party memory overlays stay config-only: package pin, transport, secret handling, and a real tool discovered through the generic MCP bridge |
| `apps/cli/tests/optional-bundle-transitions.e2e.ts` | optional bundles through the shipped Web Loader with a live package manager: PTC SDK, session search, badge asset, persistent terminal, Ralph workflow, title cadence, all five bundles as global tools |
| `apps/cli/tests/plugin-compatibility.expected.e2e.ts` | published CLI refuses an incompatible installation until an exact risk exemption is granted |
| `apps/cli/tests/plugin.spec.ts` | explicit CLI exemptions use the profile lock and never become pnpm arguments; Desktop operations under the shared writer lock |
| `apps/cli/tests/process-shutdown.spec.ts` | unit spec of the shutdown controller: drain, escalation, coalescing, the grace bound |
| `apps/cli/tests/profile-hmr.spec.ts` | which shipped bundle layers enable configuration watching, and how a later YAML layer selects the module roots |
| `apps/cli/tests/profile-initialization.spec.ts` | `initializeProfileFromDefault`: template copy, restore on failure, concurrent recreation, shipped-name reservation |
| `apps/cli/tests/profile-mcp.spec.ts` | every shipped profile template carries one shared MCP resource consumer and no server |
| `apps/cli/tests/resolved-profile-boot.spec.ts` | an application-owned profile shares the named-profile launch lifecycle |
| `apps/cli/tests/source-launch.compat.spec.ts` | the source launcher (`node --import tsx/esm`) boots without a build and requires a profile |
| `apps/cli/tests/startup-diagnostics.spec.ts` | the startup report: distinct files, `0600` mode, the full report on stderr when the write fails, error properties preserved |
| `apps/cli/tests/telemetry-switch.spec.ts` | the telemetry hard-disable switch: any non-empty value disables, including falsy-looking ones |
| `apps/cli/tests/web-agent-presets.e2e.ts` | the shipped Web composition's presets: tool rosters, RL prompt, compaction, two independent sessions, subagent bundles, preset inheritance and refusal to switch a live session's preset |
| `apps/cli/tests/web-agent-shutdown.e2e.ts` | keyless SIGTERM regression for Agent cancellation during Web teardown (idle and running) |
| `apps/cli/tests/web-auth.e2e.ts` | real `dsh web` authentication: a forged loopback Host is rejected, the browser cookie survives a restart |
| `apps/cli/tests/web-browser-open.expected.e2e.ts` | the default browser handoff: the page is handed over after the tree settles, the reason and manual URL are printed, VS Code Remote SSH suppresses the open |
| `apps/cli/tests/windows-shell.spec.ts` | the shipped shell composition gates both shell stacks by platform on its own rows; the effective per-platform roster is pinned |
| `apps/cli/tests/profiles/AGENTS.md` | the rule for this tree: a composition belongs here only when the CLI profile assembly is the subject |
| `apps/cli/tests/profiles/acp/cordis.yml` | pointer to the committed ACP snapshot config |
| `apps/cli/tests/profiles/acp/tests/acp.e2e.ts` | ACP over real stdio: only framed JSON-RPC on stdout, `session/new` without a model call, a real turn that writes the requested file |
| `apps/cli/tests/profiles/acp/tests/cleanup.e2e.ts` | ACP teardown: the workspace is removed even when process shutdown fails, and both failures are reported |
| `apps/cli/tests/profiles/acp/tests/cleanup.ts` | the shared teardown helper (close the agent, then remove the workspace) |
| `apps/cli/tests/profiles/acp/tests/control-surface.e2e.ts` | generic keyless ACP v1 control-surface conformance: select, mount MCP, close, restart, resume, cancel through the SDK only |
| `apps/cli/tests/profiles/acp/tests/escalation.e2e.ts` | the live approval loop: denial → model escalation → one-shot allow → the write lands on disk; a rejected escalation stays denied |
| `apps/cli/tests/profiles/acp/tests/fixtures/control-surface/control-surface-llm.ts` | keyless two-model adapter for the control-surface conformance test |
| `apps/cli/tests/profiles/acp/tests/fixtures/control-surface/cordis.yml` | keyless ACP v1 control-surface patch over `dsh --profile acp` |
| `apps/cli/tests/profiles/acp/tests/fixtures/image-offload.cordis.yml` | assembled-request snapshot for native DeepSeek image offload |
| `apps/cli/tests/profiles/acp/tests/goal.expected.e2e.ts` | goal rounds: exact automatic rounds with persisted cancellation, and the wrap-up instruction injected after an autonomous completion |
| `apps/cli/tests/profiles/acp/tests/hooks.e2e.ts` | a PreToolUse hook denies every bash command, so the requested file is never written |
| `apps/cli/tests/profiles/acp/tests/image-offload.expected.e2e.ts` | Messages Files offload and inline fallback in assembled requests |
| `apps/cli/tests/profiles/acp/tests/goal-expected/goal-round-driver/input.json` | the scripted ACP input for the goal-round-driver scenario |
| `apps/cli/tests/profiles/acp/tests/goal-expected/goal-round-driver/replay.override.json` | the recorded model chunks for the goal-round-driver scenario |
| `apps/cli/tests/profiles/acp/tests/goal-expected/goal-round-driver/session.expected.jsonl` | the committed session log for the goal-round-driver scenario |
| `apps/cli/tests/profiles/acp/tests/goal-expected/goal-round-driver/session.jsonl` | the seeded input session (format v0) |
| `apps/cli/tests/profiles/acp/tests/goal-expected/goal-round-driver/stdout.expected.jsonl` | the committed ACP stdout (JSON-RPC frames) for the goal-round-driver scenario |
| `apps/cli/tests/profiles/acp/tests/goal-expected/goal-wrapup/input.json` | the scripted ACP input for the goal wrap-up scenario |
| `apps/cli/tests/profiles/acp/tests/goal-expected/goal-wrapup/replay.override.json` | the recorded model chunks for the goal wrap-up scenario |
| `apps/cli/tests/profiles/acp/tests/goal-expected/goal-wrapup/session.expected.jsonl` | the committed session log for the goal wrap-up scenario |
| `apps/cli/tests/profiles/acp/tests/goal-expected/goal-wrapup/session.jsonl` | the seeded input session (format v0) |
| `apps/cli/tests/profiles/acp/tests/goal-expected/goal-wrapup/stdout.expected.jsonl` | the committed ACP stdout for the goal wrap-up scenario |
| `apps/cli/tests/profiles/fixtures/official-installer-observer.mjs` | observes ordinary manager operations in an installed Web profile without starting native agents |
| `apps/cli/tests/profiles/headless/credentials-snapshot.patch.yml` | missing-credential patch over the shipped headless profile |
| `apps/cli/tests/profiles/headless/goal-snapshot.patch.yml` | replay-backed goal patch over the shipped headless profile |
| `apps/cli/tests/profiles/headless/real-model.patch.yml` | test-only agent and persistence patch over base + headless |
| `apps/cli/tests/profiles/headless/retry-snapshot.patch.yml` | deterministic provider-retry patch over the shipped headless profile |
| `apps/cli/tests/profiles/headless/semantic-checkpoint-snapshot.patch.yml` | patch for resuming one seeded semantic-checkpoint session |
| `apps/cli/tests/profiles/headless/subagent-diagnostic-snapshot.patch.yml` | patch for resuming a seeded corrupt-child diagnostic session |
| `apps/cli/tests/profiles/headless/subagent-inheritance-snapshot.patch.yml` | patch for resuming a read-only parent whose child inherits the override |
| `apps/cli/tests/profiles/headless/subagent-settlement-snapshot.patch.yml` | replay-backed continuable child settlement patch |
| `apps/cli/tests/profiles/headless/team-snapshot.patch.yml` | deterministic Agent Teams patch over the shipped headless profile |
| `apps/cli/tests/profiles/headless/tests/coding-task.e2e.ts` | a real model repairs a failing test through bash |
| `apps/cli/tests/profiles/headless/tests/compaction.e2e.ts` | a long session compacts mid-flight and keeps running; the summary shadows real older nodes |
| `apps/cli/tests/profiles/headless/tests/credentials.e2e.ts` | credential selection through the shipped headless profile and real HTTP adapters |
| `apps/cli/tests/profiles/headless/tests/fixtures/cli.patch.yml` | keyless model and isolated-path patch over the shipped headless profile |
| `apps/cli/tests/profiles/headless/tests/fixtures/deepseek-defaults.patch.yml` | local endpoint and isolated-path patch over the shipped headless profile |
| `apps/cli/tests/profiles/headless/tests/fixtures/headless-profile.patch.yml` | the product headless profile patch for the keyless CLI snapshots |
| `apps/cli/tests/profiles/headless/tests/fixtures/pi-ai-conversation-updates.patch.yml` | pi-ai Kimi route with dynamic prompt and tool updates |
| `apps/cli/tests/profiles/headless/tests/fixtures/pi-ai-defaults.patch.yml` | pi-ai route and isolated-path patch over the shipped headless profile |
| `apps/cli/tests/profiles/headless/tests/fixtures/retry-snapshot-backend.mjs` | deterministic provider adapter for the headless retry-policy snapshot |
| `apps/cli/tests/profiles/headless/tests/fixtures/semantic-checkpoint-agent.ts` | publishes the semantic-checkpoint session before CLI dispatch |
| `apps/cli/tests/profiles/headless/tests/fixtures/startup-activation-error/activation-error.mjs` | fails activation with a deterministic stack so the startup diagnostic is snapshot-stable |
| `apps/cli/tests/profiles/headless/tests/fixtures/startup-activation-error/activation-error.patch.yml` | unrelated activation failure over the shipped headless profile |
| `apps/cli/tests/profiles/headless/tests/fixtures/subagent-diagnostic-agent.ts` | resumes the seeded diagnostic parent so `list_agents` runs against a cold child |
| `apps/cli/tests/profiles/headless/tests/fixtures/subagent-diagnostic-query.ts` | exact-read Session query that makes search unavailable for the descriptor-less child |
| `apps/cli/tests/profiles/headless/tests/fixtures/subagent-inheritance-agent.ts` | resumes the seeded read-only parent before CLI dispatch |
| `apps/cli/tests/profiles/headless/tests/fixtures/subagent-settlement-fence.ts` | holds the parent's second step until the child's settlement is delivered |
| `apps/cli/tests/profiles/headless/tests/fixtures/team-llm.mjs` | deterministic keyless Agent Teams adapter shared by the profile snapshot and the CLI e2e |
| `apps/cli/tests/profiles/headless/tests/fixtures/workspace-context-resume-agent.ts` | resumes the seeded agent-instructions session |
| `apps/cli/tests/profiles/headless/tests/full-loop.e2e.ts` | real model + real bash tool: the command runs and its output is reported |
| `apps/cli/tests/profiles/headless/tests/harness.ts` | the coding harness: real Agent loop, local bash, session events, `waitForIdle`, `finalText` |
| `apps/cli/tests/profiles/headless/tests/headless.expected.e2e.ts` | the one-shot headless product: JSON event projection, resume across two wakes, terminal model failure, retry, missing/invalid credential guidance, reasoning on stderr, Agent Team, goal tools, continuable-child settlement |
| `apps/cli/tests/profiles/headless/tests/keyless-smoke.e2e.ts` | the real Loader tree boots, runs the production shell tool, and persists the turn (zstd-compressed session) |
| `apps/cli/tests/profiles/headless/tests/mcp-pagination.expected.e2e.ts` | MCP discovery exceeding the SDK page limit warns and the headless task still completes |
| `apps/cli/tests/profiles/headless/tests/profile-resolution.ts` | real CLI profile imports in source and built launches, including npm-link dependency layouts |
| `apps/cli/tests/profiles/headless/tests/ptc.e2e.ts` | PTC typed values: a large value crosses intact, background jobs return an id and poll to completion, abort semantics, foreground bash coupling, runtime inspection |
| `apps/cli/tests/profiles/headless/tests/real-model.e2e.ts` | a real model modifies a temporary workspace, verified outside the agent |
| `apps/cli/tests/profiles/headless/tests/resume.e2e.ts` | a fact stored in a prior, separately-disposed session is recalled |
| `apps/cli/tests/profiles/headless/tests/semantic-checkpoint.expected.e2e.ts` | resuming an unknown tool outcome: `TOOL_OUTCOME_UNKNOWN` and "Do not retry blindly." |
| `apps/cli/tests/profiles/headless/tests/session-format-guard.expected.e2e.ts` | released v0 migrates before resume; a newer format or an unknown required event fails loud, naming the upgrade direction and the raw log path |
| `apps/cli/tests/profiles/headless/tests/source-tool.built.e2e.ts` | a source-profile shell call reaches `tool/result` through one Tools instance, with or without a sandbox |
| `apps/cli/tests/profiles/headless/tests/subagent-diagnostic.expected.e2e.ts` | a parent-owned catalog event is sufficient to discover a child whose persisted log has no descriptor event |
| `apps/cli/tests/profiles/headless/tests/subagent-inheritance.expected.e2e.ts` | a parent-only read-only override is seeded into the child log and confines a real write under a wider deployment default |
| `apps/cli/tests/profiles/headless/tests/todo-write.e2e.ts` | `todo_write` appends a model-produced task list |
| `apps/cli/tests/profiles/headless/tests/workspace-context-resume.expected.e2e.ts` | an offline replacement of the workspace instructions does not duplicate the visible baseline, and supersedes an incompatible baseline |
| `apps/cli/tests/profiles/headless/tests/expected/goal-tools/input.json` | the scripted input for the goal-tools scenario |
| `apps/cli/tests/profiles/headless/tests/expected/goal-tools/replay.override.json` | the recorded model chunks for the goal-tools scenario |
| `apps/cli/tests/profiles/headless/tests/expected/goal-tools/stream-json.expected.jsonl` | the committed stream-json output for the goal-tools scenario |
| `apps/cli/tests/profiles/headless/tests/expected/headless-profile/reasoning.stderr.expected.txt` | the expected `dsh: reasoning:` stderr lines |
| `apps/cli/tests/profiles/headless/tests/expected/headless-profile/session.expected.jsonl` | the committed session log for the keyless headless profile |
| `apps/cli/tests/profiles/headless/tests/expected/headless-profile/stderr.expected.txt` | the expected CLI mock provider failure line |
| `apps/cli/tests/profiles/headless/tests/expected/invalid-credential/stream-json.expected.jsonl` | the expected stream-json for an invalid credential |
| `apps/cli/tests/profiles/headless/tests/expected/mcp-pagination/stderr-cause.txt` | the exact MCP pagination error text |
| `apps/cli/tests/profiles/headless/tests/expected/missing-credential/stream-json.expected.jsonl` | the expected stream-json for a missing credential |
| `apps/cli/tests/profiles/headless/tests/expected/provider-retry/input.json` | the scripted input for the provider-retry scenario |
| `apps/cli/tests/profiles/headless/tests/expected/provider-retry/stream-json.expected.jsonl` | the expected stream-json for a transient provider failure retried |
| `apps/cli/tests/profiles/headless/tests/expected/semantic-checkpoint/replay.jsonl` | the seeded input session for the semantic-checkpoint resume |
| `apps/cli/tests/profiles/headless/tests/expected/semantic-checkpoint/replay.override.json` | the recorded model chunks for the semantic-checkpoint resume |
| `apps/cli/tests/profiles/headless/tests/expected/semantic-checkpoint/session.expected.jsonl` | the committed session log showing the resumed unknown-outcome turn |
| `apps/cli/tests/profiles/headless/tests/expected/startup-activation-error/stderr.expected.txt` | the exact "1 entry did not activate" warning text |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-diagnostic/parent.expected.jsonl` | the committed parent session log for the cold-child catalog scenario |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-diagnostic/replay.override.json` | the recorded `list_agents` call and answer for the diagnostic scenario |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-inheritance/child.expected.jsonl` | the committed child log: delegation descriptor + inherited `read-only` sandbox mode |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-inheritance/child.replay.jsonl` | the seeded child session (format v0) |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-inheritance/child.replay.v3.jsonl` | the seeded child session (format v3) |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-inheritance/parent.expected.jsonl` | the committed parent session log for the inheritance scenario |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-inheritance/replay.override.json` | the recorded delegation call and the parent's answer |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-settlement/child.expected.jsonl` | the committed child log: delegation descriptor + `workspace-write` sandbox mode |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-settlement/child.replay.jsonl` | the seeded child session (format v0) |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-settlement/parent.override.json` | the recorded parent turns for the settlement scenario |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-settlement/parent.replay.jsonl` | the seeded parent session |
| `apps/cli/tests/profiles/headless/tests/expected/subagent-settlement/stream-json.expected.jsonl` | the expected stream-json: the parent is notified when the continuable child settles, without polling |
| `apps/cli/tests/profiles/headless/tests/expected/workspace-context-resume/offline-edit/replay.jsonl` | the seeded session for the offline-edit scenario |
| `apps/cli/tests/profiles/headless/tests/expected/workspace-context-resume/offline-edit/replay.override.json` | the recorded chunks for the offline-edit scenario |
| `apps/cli/tests/profiles/headless/tests/expected/workspace-context-resume/offline-edit/session.expected.jsonl` | the committed session log for the offline-edit resume |
| `apps/cli/tests/profiles/headless/tests/expected/workspace-context-resume/precedence-change/session.expected.jsonl` | the committed session log when the precedence changed offline |
| `apps/cli/tests/profiles/headless/workspace-context-resume-snapshot.patch.yml` | patch for resuming the seeded workspace-instruction session |
| `apps/cli/tests/profiles/official-installer-packed.e2e.ts` | installs the exported registry's local closure and switches Official bundles through the generic manager |
| `apps/cli/tests/profiles/packed-installation.ts` | packs and installs a source-independent product for idle Web-profile integration tests |
| `apps/cli/tests/profiles/sdk/dynamic-tool-cache.e2e.ts` | the preceding conversation stays cached after a tool is added to the registry |
| `apps/cli/tests/profiles/sdk/fixtures/dynamic-tool-cache.mjs` | SDK fixture that observes each request and lets the model add or remove a scoped tool |
| `apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts` | the Python SDK profile: startup failure with stdin open, invalid max-token env, Office resource composition modes |
| `apps/cli/tests/profiles/sdk/office-cli.e2e.ts` | the agent discovers and executes the installed Office CLI without Node on PATH |
| `apps/cli/tests/profiles/web/tests/creator-plugin-manager.expected.e2e.ts` | MCP reaches existing and new Creator sessions and survives a process restart |
| `apps/cli/tests/profiles/web/tests/default-web-process.ts` | the built-process owner shared by the Host and browser default-Web isolation smokes |
| `apps/cli/tests/profiles/web/tests/fixtures/creator-plugin-manager.mjs` | test-only IPC assertions over real Creator presets and profile management |
| `apps/cli/tests/profiles/web/tests/fixtures/runtime-roster-observer.ts` | test-only IPC observer mounted beside the unchanged default Web composition |
| `apps/cli/tests/profiles/web/tests/office.expected.e2e.ts` | ordinary Web mounts no Office skills, commands, or authoring dependencies |
| `apps/cli/tests/profiles/web/tests/public-url.expected.e2e.ts` | the advertised public root, verified TLS with Secure browser authentication, and a bound-address/authority fence |
| `apps/cli/tests/profiles/web/tests/runtime-roster-isolation.spec.ts` | retained experimental names stay visible through installed aliases in real roster fields |
| `apps/cli/tests/profiles/web/tests/runtime-roster-isolation.ts` | experimental identity checks over independently observed built-Web runtime records |
| `apps/cli/tests/profiles/web/tests/runtime-roster.ts` | runtime evidence collected from the real Web process for default-product isolation |
| `apps/cli/tests/profiles/web/tests/schedule-timing.expected.e2e.ts` | schedule RPC over the built Web: catalog/history/update, optimistic-concurrency conflict, cold-restart identity |
| `apps/cli/tests/profiles/web/tests/web-best-effort-startup.expected.e2e.ts` | best-effort startup: the full Web app serves while unrelated entries fail; a required HTTP server that cannot bind fails the profile |
| `apps/cli/tests/profiles/web/tests/web-default-isolation.expected.e2e.ts` | default Web boots with the shipped Schedule rows and without experimental modules or an active built-in Browser |
| `apps/cli/tests/profiles/web/tests/web-failure-matrix.expected.e2e.ts` | the failure matrix: unreadable TLS, a non-loopback bind, required vs optional startup failures, native HMR keeping siblings and recovering, and detached rejections terminating the app |
| `apps/cli/tests/profiles/webhook-packed.e2e.ts` | the published webhook example loads in an isolated installed Web profile |
| `apps/plugin-market-generator/README.i18n.yaml` | generated bilingual-pairing hash manifest for the generator README |
| `apps/plugin-market-generator/README.md` | generator README: what is listed, caching, security limits |
| `apps/plugin-market-generator/README.zh.md` | Chinese translation of the generator README |
| `apps/plugin-market-generator/package.json` | generator manifest (private; `tsx src/bin.ts` start script) |
| `apps/plugin-market-generator/tests/cli.spec.ts` | generator CLI: help with every option and its default, missing required option, an unreadable source list |
| `apps/plugin-market-generator/tests/discovery.spec.ts` | `parseSources`, `isBundle`, `dshRange`, `findBundlePackages` (root/workspaces/scan), and `PackageFiles` path safety |
| `apps/plugin-market-generator/tests/generate.spec.ts` | listing every non-deprecated bundle version, keywords handling, rebuilding a rejected cache record, first source wins, writing the index once and removing only stale generated icons |
| `apps/plugin-market-generator/tests/git.spec.ts` | Git versions from release tags and the default branch read as objects; a root package; refused transports; unreadable tags; oversized manifests; ignored `GIT_*` overrides |
| `apps/plugin-market-generator/tests/support.ts` | per-test temp directories and cleanups shared by the generator specs |
| `apps/plugin-market-generator/tsconfig.json` | generator project references |
| `apps/web/.npmignore` | excludes sourcemaps from the published package |
| `apps/web/index.html` | static shell: `#root`, manifest link, media-query favicons |
| `apps/web/package.json` | web frontend manifest: vite build over the client-web shell, preview build/serve scripts |
| `apps/web/public/favicon-dark.svg` | dark-mode wordmark SVG (identical path, white fill) |
| `apps/web/public/favicon.svg` | light-mode wordmark SVG (identical path, black fill) |
| `apps/web/public/manifest.webmanifest` | PWA install metadata |
| `apps/web/src/vite-env.d.ts` | vite client type reference |
| `apps/web/tests/README.i18n.yaml` | generated bilingual-pairing hash manifest for the web tests README |
| `apps/web/tests/README.md` | the browser e2e lane README: completion-observation rules, the Host-face rule, the do-not-import-client rule |
| `apps/web/tests/README.zh.md` | Chinese translation of the browser e2e lane README |
| `apps/web/tests/access-confirmation.e2e.ts` | both permission pickers expose the experimental Auto entry behind a locale-aware in-page risk confirmation; Full access keeps its own gate |
| `apps/web/tests/account-login.e2e.ts` | DeepSeek account sign-in from a plain browser against a loopback Platform double |
| `apps/web/tests/agent-preset-authoring.e2e.ts` | the preset settings page: roster guidance, read-only detail, Creator-mode task start |
| `apps/web/tests/agent-preset-selection.e2e.ts` | a session's composition is fixed when the session starts; the staged pick is the only place it still works |
| `apps/web/tests/agent-team-panel.e2e.ts` | the Agent Teams panel: a read-only board of agent-owned task changes, viewport containment, expansion |
| `apps/web/tests/approval-composer.e2e.ts` | a pending approval whose command would push the actions outside the viewport gets a capped text region |
| `apps/web/tests/assembled-boot.ts` | assembled-jsdom scaffolding that boots the real built client bundles through `AppWebEntry` |
| `apps/web/tests/assembled-remote.spec.ts` | the app-owned RemoteMock scenario advances turns and updates the Session summary |
| `apps/web/tests/assembled-remote.ts` | the RemoteMock response catalogue carrier for built-client tests without a Host |
| `apps/web/tests/auto-review-approval.e2e.ts` | a cold recording renders an Auto-review denial the user rejected and a reviewer failure — not an Auto denial |
| `apps/web/tests/auto-review-denial.e2e.ts` | a cold recording renders the structured Auto-review denial without replaying a reviewer or model call |
| `apps/web/tests/auto-review-fixture.ts` | explicit source Web layer and optional visual evidence for Auto scenarios |
| `apps/web/tests/background-job-list.e2e.ts` | a running background job appears in the Session header without a refresh and is killed from a two-press stop control |
| `apps/web/tests/bash-abort-row.e2e.ts` | a cancelled Bash call still exposes the recorded command and the full error in its keyed row |
| `apps/web/tests/blank-preset-reuse.e2e.ts` | a blank Session recorded under an undeclared preset is reused under the default |
| `apps/web/tests/blank-writer-reuse.e2e.ts` | the selected blank writer is reused, or a new one is created on contention, without trying another blank |
| `apps/web/tests/bonus-notice.e2e.ts` | the user-side bonus notice: acknowledged under settings, refreshed once per entry, localized request |
| `apps/web/tests/built-boot.expected.e2e.ts` | the built plugin graph assembles: staged activation, per-plugin CSS injection, a rendered journey |
| `apps/web/tests/caption-overlays.e2e.ts` | settings and expanded plugin dialogs stay clear of the Windows caption across fullscreen transitions |
| `apps/web/tests/changed-files-turn.e2e.ts` | a turn that edits, creates and shell-appends files ends with the changed-files card whose rows open the review |
| `apps/web/tests/chat-continuous-conversation.e2e.ts` | twelve deterministic replay turns through the real composer keep their tool rows bound to one live session |
| `apps/web/tests/chat-flow-layout.e2e.ts` | cold history retains Chat spacing through the flow slot's `display:contents` anchor |
| `apps/web/tests/chat-long-interactions.e2e.ts` | a long-history contract that stays valid under a virtualized renderer: content identity and interaction routing, not scroll geometry |
| `apps/web/tests/chat-scroll-contract.e2e.ts` | the long-transcript scroll contract: semantic-row position, bottom ownership, interaction state, the real outer scroll host |
| `apps/web/tests/chat-scroll-fixture.ts` | synthetic long-chat history generated through Session so pagination exercises real event shapes |
| `apps/web/tests/clickable-links-gallery.e2e.ts` | every clickable link and artifact form the chat renders, in one settled keyless turn |
| `apps/web/tests/client-plugin-live.e2e.ts` | page-local client lifecycle: menu rows, two-page synchronisation, a failed download, an uncreated entry, a bootstrap rebuild |
| `apps/web/tests/code-card-layout.e2e.ts` | read offsets stay clear of aligned source in both wrap modes; long diff rows fill through horizontal scrolling |
| `apps/web/tests/code-language.snapshot.ts` | recorded read metadata and the file preview share syntax highlighting; CSV defaults to Spreadsheet |
| `apps/web/tests/cold-blank-session.e2e.ts` | pending Inbox recovery from detached persistence through the shipped Web profile |
| `apps/web/tests/collapse-timing.e2e.ts` | recorded work details fold at completion, defer the latest process until ordinary input, and keep Verbose open |
| `apps/web/tests/command-image-envelope.expected.e2e.ts` | an image-carrying submit is refused by a command that does not declare attachments, and consumed by one that does |
| `apps/web/tests/complex-history.perf.ts` | opt-in benchmark for high-cardinality workspace and history rendering; measurements, not timing assertions |
| `apps/web/tests/composer-draft-scroll.e2e.ts` | a composer draft longer than the 14-line cap scrolls, reveals the caret, and holds no second scroll offset |
| `apps/web/tests/composer-focus.e2e.ts` | selection and focus are restored after presses in the composer's unused space |
| `apps/web/tests/composer-placeholder.e2e.ts` | the placeholder hides as soon as a draft contains whitespace, and returns after deletion |
| `apps/web/tests/composer-shortcuts.e2e.ts` | an application Enter chord with extra modifiers preserves the draft and the menu |
| `apps/web/tests/composer-tab-geometry.e2e.ts` | the input card's position across the Chat and Trajectory tabs, with a committed geometry golden |
| `apps/web/tests/connection-recovery.e2e.ts` | a real WebSocket loss does not replace Client plugins or navigate the page |
| `apps/web/tests/context-meter.e2e.ts` | context details stay inside the viewport with and without Chat's statistics contribution |
| `apps/web/tests/cordis-tool-round.e2e.ts` | historical generated-plugin cards stay readable after their tool APIs are removed |
| `apps/web/tests/cot-translation-paid.e2e.ts` | saved native Account Flash translations are reused across reopen and reload; uncached requests cancel without changing the conversation |
| `apps/web/tests/cot-translation.e2e.ts` | durable reasoning translation persists across reopen and reload, retains the original on failure, and cancels uncached requests |
| `apps/web/tests/declared-reasoning.e2e.ts` | a hand-declared model's `reasoningEfforts` reaches the composer's effort pane — the picker offers exactly what is declared |
| `apps/web/tests/deepseek-messages-chat.e2e.ts` | the historical Messages provider replay preserves its recorded identity and DeepSeek model group |
| `apps/web/tests/deepseek-messages-settings.e2e.ts` | one DeepSeek card; Messages settings saved using the existing credential reference |
| `apps/web/tests/deepseek-model-label-1017.e2e.ts` | the shipped browser plugin decorates both DeepSeek routes without changing catalog identity |
| `apps/web/tests/default-model.e2e.ts` | the composer's model switch writes the shared default; a session that already logged a route keeps deriving from its own log |
| `apps/web/tests/default-product-isolation.e2e.ts` | the shipped Web profile's actual Client plugin and module registries activate without experimental packages |
| `apps/web/tests/default-workspace.e2e.ts` | first-use startup prepares a durable default Workspace and reports a failure to create one |
| `apps/web/tests/desktop-boot.spec.ts` | the Desktop boot kernel: client initialisation failures reach native recovery, a failed Host rejects the shared boot wait, and a missing root/readiness is reported before client plugin startup |
| `apps/web/tests/desktop-locale.e2e.ts` | native initialisation supplies system languages without saving them; an explicit choice is shared across reloads |
| `apps/web/tests/desktop-onboarding.e2e.ts` | App-only desktop onboarding over the shipped Loader, real account/settings APIs, and an isolated Platform fixture: Web stays unchanged, progress resumes, credit returns even when the balance refresh fails |
| `apps/web/tests/desktop-updates.e2e.ts` | Desktop update states and their explicit actions, per locale, with a controlled Desktop carrier (no Electron, no installer) |
| `apps/web/tests/details-session-lifecycle.e2e.ts` | the details panel follows the current Session lifecycle: each Session keeps its sidebar state and applies normal, fullscreen, and capacity-close geometry |
| `apps/web/tests/developer-tools-settings.e2e.ts` | Coding Tools persist while Standard, Creator, and custom presets remain selectable when the tools are disabled |
| `apps/web/tests/devtools-frontend.e2e.ts` | the prebuilt Inspector frontend assets are served under their own path without rebuilding DevTools |
| `apps/web/tests/diff-context.e2e.ts` | cold Session rendering covers exact context and bounded whole-fragment replacements; collapsed and expanded counts stay consistent with the displayed diff |
| `apps/web/tests/document-preview.e2e.ts` | the keyless document-preview smoke: text, isolated HTML, width-fitted images, rendered PDF, the spreadsheet pane's read-only controls, and the Host Office preview through the PDF worker |
| `apps/web/tests/draft-initialization.e2e.ts` | unsubmitted drafts are initialised through the shipped Workspace API and restored: navigation, `clearPreviousDraft`, a rebuilt command chip, repeated file/folder/Session capsules, a legacy string draft, a delayed skills catalog, and a parameter transition matrix |
| `apps/web/tests/excel-opc.e2e.ts` | independent-writer XLSX previews open comments, Tables, and equivalent OPC encodings without hiding cell data |
| `apps/web/tests/feedback-command.e2e.ts` | the `/feedback` command settles without a model turn: the host appends the log-only lifecycle and the transcript renders the acknowledgement with the session and anonymous user ids |
| `apps/web/tests/feedback-release.e2e.ts` | feedback release: the loopback collector must receive each authorised suffix before the next UI action; command tails, provider changes, and browser reloads do not release |
| `apps/web/tests/file-upload-round.e2e.ts` | a generic file upload round trip: the upload RPC stores the exact bytes under an isolated `DSH_HOME`, send is gated on the staged receipt, and the model reads the saved copy with the real read tool |
| `apps/web/tests/focus-rings.e2e.ts` | focus-ring paint in both themes: pointer keys stay silent, Tab/navigation reveal a blue outline, and a negative control proves blanket shadow suppression would destroy input and card paint |
| `apps/web/tests/fold-blank-matrix.e2e.ts` | the blank-area matrix for "On next message" folding: the largest band no visible row covers, after the fold settles and on every animation frame |
| `apps/web/tests/fork-mid-turn.e2e.ts` | forking a completed recording at its first `tool/call` seeds branch closers and the child continues as a resume |
| `apps/web/tests/github-ready-review.e2e.ts` | a GitHub ready-for-review webhook creates a browsable Workspace Session |
| `apps/web/tests/goal-bar.e2e.ts` | the goal bar renders one active goal and clears it without a stale error or a duplicate mutation |
| `apps/web/tests/goal-command-presentation.e2e.ts` | `/goal` opts its command input into the human transcript while the command stays log-only |
| `apps/web/tests/goal-multi-turn-actions.e2e.ts` | each autonomous Goal round ends as its own turn and owns a distinct assistant action row |
| `apps/web/tests/hmr-live.e2e.ts` | built `dsh web` plus the dev:web watchers hot-reload a real client-plugin source edit without a page reload |
| `apps/web/tests/home-path-tilde.expected.e2e.ts` | the sidebar hover card shows `~/Documents/project` while copy still writes the full path |
| `apps/web/tests/idle-submission-handoff.e2e.ts` | idle submissions stay in Chat across independently delivered Inbox and transcript frames |
| `apps/web/tests/image-display.expected.e2e.ts` | multimodal image surfaces: the history pair through the authorized attachment route, pasted images, a whole-page drop under the limits overlay, a host dimension rejection |
| `apps/web/tests/input-plugin-extensions.e2e.ts` | optional input contributions mount through the real Loader and preserve editor ownership |
| `apps/web/tests/inspector-late-enable.e2e.ts` | enabling the Inspector bundle on a running page mounts the bottom DevTools without a reload |
| `apps/web/tests/inspector-panels.e2e.ts` | the real packaged DevTools panels against an isolated Web Host |
| `apps/web/tests/inspector-source-build.e2e.ts` | built npm frontend assets work under a deployment prefix without remote resource requests |
| `apps/web/tests/interrupted-turn.e2e.ts` | a turn closed by a DSH stop shows the stopped summary and the interruption notice |
| `apps/web/tests/jobs-menu-layering.e2e.ts` | the background-job menu stays above the Browser dock, anchored and dismissable |
| `apps/web/tests/katex-fonts.spec.ts` | all KaTeX WOFF2 faces ship with identical bytes; a face without WOFF2 is rejected; other formats are preserved elsewhere |
| `apps/web/tests/layout-bottom.e2e.ts` | the bottom Slot's height is reserved without remounting it on main-panel navigation |
| `apps/web/tests/lifecycle-chrome.e2e.ts` | the workspace-aware first-send flow over the real wire, reload recovery from the log alone, and the dark-theme token cascade |
| `apps/web/tests/live-interactions.e2e.ts` | running-draft submission, cancellation, error surfacing, transient-retry recovery, and retry exhaustion, all through the real wire |
| `apps/web/tests/live-job-stream.e2e.ts` | a running job's real output streams into the expanded panel, then settles in place on kill |
| `apps/web/tests/markdown-cjk-strong.e2e.ts` | punctuation-terminated strong spans render before adjacent CJK text |
| `apps/web/tests/markdown-file-links.e2e.ts` | cold-replayed Markdown references open Session files at the requested line without duplicate tabs |
| `apps/web/tests/markdown-images.e2e.ts` | file requests are authenticated and active content is isolated; permitted images load and failures show authored text |
| `apps/web/tests/markdown-inline-code-links.e2e.ts` | a complete HTTP URL in inline code opens; other code stays inert |
| `apps/web/tests/markdown-wide-table.e2e.ts` | tables under four columns fill the message column; wide ones scroll and break out past the transcript width |
| `apps/web/tests/math-rendering.e2e.ts` | the settled reply renders without KaTeX errors |
| `apps/web/tests/max-tokens-notice.expected.e2e.ts` | the localized truncation notice renders after a cut-off answer instead of ending silently |
| `apps/web/tests/menu-material.e2e.ts` | account and Session menus share material and keep macOS backings aligned and scoped |
| `apps/web/tests/message-actions.e2e.ts` | assistant IconActions and clocks on settled history: branch only on the completed tail, the footer waits for `turn/end` |
| `apps/web/tests/message-feedback-protocol.snapshot.ts` | the message-feedback Host Remote protocol: strict list, put, conflict, and delete calls |
| `apps/web/tests/message-feedback.e2e.ts` | durable per-message feedback: both ratings through the dialog, the Dislike persists, then is retracted; Session feedback records only on submit |
| `apps/web/tests/minimal-preset.snapshot.ts` | the minimal preset: the exact RL prompt with shell and image schemas, manual compaction, and durable image reading |
| `apps/web/tests/model-input-layout.ts` | browser helper: model input types stay below both capacity fields across editor widths |
| `apps/web/tests/model-menu-observer.e2e.ts` | sticky model groups in both pickers, keyboard-operable, without synchronous group rect reads |
| `apps/web/tests/models-settings-recovery.e2e.ts` | stored catalog drift stays repairable: the failed provider is shown beside healthy ones and an invalid edit is refused |
| `apps/web/tests/models-settings.e2e.ts` | the Models settings page: the dormant catalog, a key no HTTP header can carry, a blank key as a reference-free profile, customized settings as a merge patch |
| `apps/web/tests/navigation-panes.e2e.ts` | the Trajectory view, timing overview, local details inspector, and sidebar search over one seeded session |
| `apps/web/tests/new-session-refused.e2e.ts` | an explicit New Session the Host refuses reports through the Workspace notice |
| `apps/web/tests/notice-wake-tail.e2e.ts` | a Turn this Client did not submit (a subagent-settled notice) wakes while the reader follows a long Turn's tail |
| `apps/web/tests/office-fixture.ts` | tiny binary Office and OOXML documents built with `fflate` |
| `apps/web/tests/official-subagent-bundle.e2e.ts` | the official bundle reaches the real Claude SDK/CLI; the delegation, native result, and unchanged workspace are persisted |
| `apps/web/tests/onboarding-deepseek-config.e2e.ts` | the shipped DeepSeek adapter stays mounted while its credential is absent; the inline key write lands without a reload |
| `apps/web/tests/onboarding-native.e2e.ts` | the Host's native-onboarding setting reaches the assembled browser before its dialogs register |
| `apps/web/tests/onboarding-usable-provider.e2e.ts` | a user who configured another provider is not asked for the official DeepSeek key again |
| `apps/web/tests/open-in-app-ssh.e2e.ts` | SSH launch behaviour: a remembered app is hidden after the host returns an empty catalog |
| `apps/web/tests/permission-policy-context.e2e.ts` | the current sandbox policy reaches the model before tools, through the real `/permission` command path |
| `apps/web/tests/pinned-clock.e2e.ts` | fixture-day clock pins keep page scheduling native at every real-to-fixture distance |
| `apps/web/tests/plan-control-row.e2e.ts` | composer click areas and content-sized model collapse at the narrow viewport; Plan toggles |
| `apps/web/tests/plan-review.e2e.ts` | the plan-review takeover: a decision card, an unlogged review previewed automatically, a review arriving while a panel is active, and dismissed plan history |
| `apps/web/tests/plugin-config.e2e.ts` | plugin configuration pages: a field edited through the real wire down to `cordis.patch.yml`, the override badge and reset, staged edits, a non-numeric draft refused |
| `apps/web/tests/plugin-hmr-lifecycle.e2e.ts` | install, switch off/on, and upgrade without a restart; a version that cannot load names the load error; a change HMR cannot apply asks for a restart |
| `apps/web/tests/plugin-install-approve.e2e.ts` | pnpm leaves an install script undecided; the dialog offers approval and the retry runs with it |
| `apps/web/tests/plugin-install-cancel.e2e.ts` | cancelling an installation, retrying, highlighting the enabled plugin at 40 % alpha, and recovering unknown results |
| `apps/web/tests/plugin-install-github.e2e.ts` | a GitHub network failure or timeout offers a mirror, then another way, and never retries the failed address |
| `apps/web/tests/plugin-install-registry.e2e.ts` | the fastest responding registry is selected and remembered, with a fallback after a registry failure |
| `apps/web/tests/plugin-manager.e2e.ts` | the plugin manager page: installed bundles, their rows, bundle enablement, icons, and an optional feature preview |
| `apps/web/tests/prefix-proxy.ts` | the browser-facing prefix-stripping HTTP/WebSocket proxy for the scaffold |
| `apps/web/tests/present-svg.e2e.ts` | an explicit file-card request exercises SVG delivery without naming the present tool |
| `apps/web/tests/present.e2e.ts` | recorded source-file delivery, edits, reload, deletion, and Session ZIP behaviour |
| `apps/web/tests/preset-migration.snapshot.ts` | cold V2 restoration mounts the shipped PTC preset and publishes only the current successor |
| `apps/web/tests/preview-boot.e2e.ts` | the browser-only worker deployment boots the real Cordis tree out of the packed VFS image |
| `apps/web/tests/produced-file-mentions.e2e.ts` | unique, ambiguous, and unknown inline file references: only the unique mention links |
| `apps/web/tests/ptc-escalation.e2e.ts` | a real PTC sandbox denial followed by one approved program execution |
| `apps/web/tests/ptc-round.e2e.ts` | a PTC round renders nested sub-calls; the durable log carries `run_code` with full-content sub-dispatches |
| `apps/web/tests/public-mount.e2e.ts` | plugin bundles, RPC, and bidirectional Gateway streams through a prefix-stripping HTTP proxy |
| `apps/web/tests/pwa-manifest.e2e.ts` | install metadata ships with the built web application; fixed-colour favicons are selected by media query |
| `apps/web/tests/pwsh-terminal.e2e.ts` | a pwsh call renders with the same terminal-card layout as bash and a parsed exit pill |
| `apps/web/tests/question-composer.e2e.ts` | the resident question composer: ask, answer, complete with the answer logged, cancel, queue, and a late answer |
| `apps/web/tests/queue-actions.e2e.ts` | pending queue actions: edit and remove exact occurrences, preserve the Queue across a stop, and advance in FIFO order |
| `apps/web/tests/queue-image.e2e.ts` | an image attachment submitted while a turn runs queues as one occurrence with a durable thumbnail |
| `apps/web/tests/rail-search-expand.e2e.ts` | the collapsed rail's search survives its own document-level bubble and lands focus in the input |
| `apps/web/tests/reasoning-preview.e2e.ts` | streaming reasoning previews show completed paragraph first lines with a right-edge fade |
| `apps/web/tests/reference-composer.e2e.ts` | file and session references through the real Host, grouped in the shared `@` menu, projected as inline ranges |
| `apps/web/tests/remote-settings.e2e.ts` | a trusted remote browser uses the same Host settings service as loopback |
| `apps/web/tests/replay-round-trip.e2e.ts` | a fresh round trip: a real prompt, the real bash tool, the settled turn, and the conversation aria golden |
| `apps/web/tests/scaffold-generation.spec.ts` | web seed stream timing and the snapshot-generation filename rules (parent/child generations, retained inputs) |
| `apps/web/tests/scaffold-hermetic.e2e.ts` | replay skill discovery is isolated from every ambient host root |
| `apps/web/tests/scaffold.ts` | the shared browser e2e scaffold: boots the real Web composition, records/replays fixtures, owns the golden comparison |
| `apps/web/tests/schedule-after.e2e.ts` | conversational Schedule delivery: an After reminder, batching one latest occurrence per overdue Every record, an explicit local At reminder, and the cross-Session task catalogue |
| `apps/web/tests/schedule-header.e2e.ts` | the Automation tasks page header keeps its title intact before moving New to another line |
| `apps/web/tests/search-card.expected.e2e.ts` | the grep card, its truncation summary, and its capped head/tail slice |
| `apps/web/tests/seeded-history.e2e.ts` | a cold-seeded session renders purely from the log: sidebar listing, cold history paging, tool views, reasoning as secondary Markdown |
| `apps/web/tests/server-restart.e2e.ts` | the same revision, Session and page survive a server restart on the same port |
| `apps/web/tests/session-archive-active.e2e.ts` | archiving a running Session is refused; confirming stops the turn first, then hides the row |
| `apps/web/tests/session-inspector.e2e.ts` | the optional Inspector renders a recorded Session and highlights nearby Chat content |
| `apps/web/tests/session-log-upload.e2e.ts` | browser saves control the session-log field on real DeepSeek HTTP requests |
| `apps/web/tests/session-replay-reload.e2e.ts` | recorded-session recovery through Chromium and WebKit's native JSON validation |
| `apps/web/tests/session-unarchive.e2e.ts` | archived sessions are restored from the sidebar filter and stay restored across a reload |
| `apps/web/tests/sessionless-header.e2e.ts` | global navigation before the first Session keeps its empty-header geometry and sidebar access |
| `apps/web/tests/settings-appearance.e2e.ts` | settings controls share radius and card materials across account, model, and plugin pages |
| `apps/web/tests/settings-chrome.e2e.ts` | the settings modal shell, the Appearance preference row, the theme cascade, font sizes, and Permission as a default for future sessions |
| `apps/web/tests/settings-import.e2e.ts` | a `settings.yaml` left in the harness home by earlier releases is imported once at start |
| `apps/web/tests/shared-inspector.e2e.ts` | the shared Inspector iframe toggles bottom DevTools from the page and from the iframe, and keeps its panel across Sessions |
| `apps/web/tests/shell-command-details.e2e.ts` | a long shell command is shown in full in the expanded row, with a copy action |
| `apps/web/tests/shipped-composition.e2e.ts` | the shipped Web composition's catalog, defaults, Loader lifecycle, and one complete Auto producer-to-tool path |
| `apps/web/tests/shortcuts-desktop.e2e.ts` | the real application composition and Desktop persistence with a substituted Electron preload transport |
| `apps/web/tests/shortcuts-fixed.e2e.ts` | fixed approval rejection keys through the real browser, the Remote waterfall, and a recorded model command |
| `apps/web/tests/shortcuts-panels.e2e.ts` | sidebar commands through the shipped Loader, real owners, and the Web keybinding editor |
| `apps/web/tests/shortcuts-workspace.e2e.ts` | seven owner operations with saved bindings; a first-turn fork refusal explains itself and retries from the completed prefix |
| `apps/web/tests/shortcuts.e2e.ts` | keyboard routing, inline editing, and localized system feedback in the real Web composition |
| `apps/web/tests/sidebar-browser.e2e.ts` | the sandboxed Browser tab navigates HTTP(S) with application-known history |
| `apps/web/tests/sidebar-right.e2e.ts` | the shipped right Sidebar: the official roster row, the real plugin graph, fullscreen, and capacity-closed panels |
| `apps/web/tests/sidebar-scrollbar.e2e.ts` | the sidebar scrollbar reservation and themed thumb, in both palettes |
| `apps/web/tests/sidebar-subagent-activity.e2e.ts` | a running descendant is pinned on its visible idle owner row |
| `apps/web/tests/sidebar-terminal.e2e.ts` | the shipped sidebar terminal over the real Loader, Remote mux, Chromium and local PTY |
| `apps/web/tests/sidebar-title-hover-scroll.e2e.ts` | hovering a clipped session title marquees it to its far edge and restores its start |
| `apps/web/tests/skill-invocation-policy.e2e.ts` | every user-invocable skill reaches the slash source; user-only entries carry their marker; user-disabled quadrants stay hidden |
| `apps/web/tests/skill-menu-plugin-change.e2e.ts` | switching a plugin on the Plugins page updates the `/` menu of an already-open Session |
| `apps/web/tests/skill-tool-row.e2e.ts` | the real skill-load recording renders through the keyed toolview with exact durable output |
| `apps/web/tests/skill-user-invoke.e2e.ts` | a user invokes a disable-model-invocation skill through the composer; the gesture becomes a bubble and a replayed answer |
| `apps/web/tests/smoke-real.e2e.ts` | the real-host smoke: three immutable plugin batches, runtime context routing, a retried partial transport failure, PTC tool collapse |
| `apps/web/tests/standalone-string-editor.e2e.ts` | a standalone global tool from a custom Host patch reaches the PTC SDK and a persisted Session |
| `apps/web/tests/startup-auto-selection.e2e.ts` | startup Session opening preserves the resident Hero tree |
| `apps/web/tests/startup-rpc-budget.e2e.ts` | cold boot issues at most two `settings/describe` calls regardless of client plugin count |
| `apps/web/tests/stats-paged-history.e2e.ts` | whole-session turn/step counts render from the `sessionStats` projection on the first (partial) page and survive load-older |
| `apps/web/tests/steering.e2e.ts` | both steering entry points: the QueueDock strictly transfers one queued occurrence; the composer gestures choose Queue or Steer |
| `apps/web/tests/streaming-fence-highlight.e2e.ts` | the growing code fence is highlighted through shiki and its token tree is preserved when the turn settles |
| `apps/web/tests/subagent-conversation.e2e.ts` | the persisted subagent conversation: the reference menu, a cold child catalog cache miss, opening a child's history, FIFO follow-up admission, an unavailable grandchild |
| `apps/web/tests/subagent-fork-schedule.snapshot.ts` | forked Web agents inherit the standard preset and refuse every reminder tool |
| `apps/web/tests/subagent-interrupt-ui.e2e.ts` | the composer's independent Stop interrupts a running continuable child; the follow-up is parked and resumes FIFO |
| `apps/web/tests/subagent-interrupt.e2e.ts` | `subagents/interruptByParent` over the real composition: a queued follow-up is parked on interrupt and resumes FIFO |
| `apps/web/tests/submission-echo.e2e.ts` | a text-plus-image send paints its echo bubble synchronously on the submit keystroke |
| `apps/web/tests/support-timezone.e2e.ts` | the recorded browser timezone is isolated from the host time zone |
| `apps/web/tests/support.ts` | shared browser plumbing: dist location, free port, failure shots, scroll, locale, `PLUGIN_TOGGLE_SETTLE_MS` |
| `apps/web/tests/terminal-command-browser.ts` | browser helper for terminal command assertions |
| `apps/web/tests/thinking-markdown.e2e.ts` | expanded reasoning keeps Markdown semantics at the secondary typography tier |
| `apps/web/tests/todo-row.expected.e2e.ts` | the parallel plan renders as a row summary, a separate active count, and the dock plan strip |
| `apps/web/tests/tool-details.e2e.ts` | every recorded tool expands through its keyed renderer |
| `apps/web/tests/trajectory-image-display.expected.e2e.ts` | durable record images render in the Trajectory details panel from the shared cache |
| `apps/web/tests/trajectory-virtualization.e2e.ts` | semantic row identity survives an older-page prepend; DOM mounting stays bounded; every scroll range is reachable |
| `apps/web/tests/turn-tail-actions.e2e.ts` | assistant IconActions arrive with `turn/end`, not before; the Turn process folds after the completed reply becomes the answer |
| `apps/web/tests/user-text-secret-mask.e2e.ts` | a credential in user text is masked behind its own reveal control |
| `apps/web/tests/vite-entry.e2e.ts` | bare Vite must fail before it can present a bootless shell as a working GUI |
| `apps/web/tests/voice-download.e2e.ts` | a failed model download publishes the actual source and recovery advice, and retries on request |
| `apps/web/tests/voice-input.e2e.ts` | dictation submits only the reviewed text through the ordinary recorded Session flow |
| `apps/web/tests/voice-setup.e2e.ts` | empty local caches guide explicit enablement to plugin setup without starting installation |
| `apps/web/tests/web-search-round.e2e.ts` | a real browser drives `web_search` through the real provider and persists the capped structured result |
| `apps/web/tests/window-drag-coverage.e2e.ts` | the macOS window drag surface: which chrome rows drag, which pixels stay content |
| `apps/web/tests/workflow-run.e2e.ts` | the durable workflow Conversation Node: the live member, its local child, and the settled record beside the tool row |
| `apps/web/tests/workspace-management.e2e.ts` | workspace creation, rename with a duplicate-name pre-check, grouping, the directory dialog's path editor |
| `apps/web/tests/workspace-new-session-folding.e2e.ts` | five established sessions beside the provisional blank row; the watermark follows the open session |
| `apps/web/tests/workspace-recency.e2e.ts` | recency pauses in Manual order, drags survive a reload, and "Last updated" resets |
| `apps/web/tests/worktree-opt-in.e2e.ts` | the Git Worktrees switch persists and its capability is removed while the checkouts are retained |
| `apps/web/tests/expected/access-confirmation/auto-confirmation.expected.md` | golden: the Chinese "confirm enabling Auto review (experimental)" dialog |
| `apps/web/tests/expected/access-confirmation/current-session-picker.expected.md` | golden: the three permission modes in the current-session picker |
| `apps/web/tests/expected/access-confirmation/slash-picker.expected.md` | golden: the `/permission` fuzzy picker |
| `apps/web/tests/expected/access-confirmation/ui.expected.md` | golden: the Chinese "confirm full access" dialog |
| `apps/web/tests/expected/account-login/avatar-retry.expected.md` | golden: the avatar retry request counts per Settings entry |
| `apps/web/tests/expected/agent-preset-authoring/section.expected.md` | golden: the preset-authoring Settings section |
| `apps/web/tests/expected/agent-preset-selection/header.expected.md` | golden: the Session hierarchy header with a subagent count |
| `apps/web/tests/expected/agent-preset-selection/hero.expected.md` | golden: the empty-state hero with the workspace and mode buttons |
| `apps/web/tests/expected/agent-preset-selection/menu.expected.md` | golden: the preset menu with each mode's description |
| `apps/web/tests/expected/bonus-notice/notice-flow.expected.md` | golden: the bonus notice flow (held, notice, acknowledgement order) |
| `apps/web/tests/expected/clickable-links-gallery/ui.expected.md` | golden: the full clickable-links gallery tree |
| `apps/web/tests/expected/client-plugin-live/bootstrap-rebuild.expected.md` | golden: the "plugin failed to sync; server state unchanged" alert |
| `apps/web/tests/expected/client-plugin-live/enabled.expected.md` | golden: "dynamic plugin enabled" |
| `apps/web/tests/expected/client-plugin-live/recovered.expected.md` | golden: "dynamic plugin r1 enabled" |
| `apps/web/tests/expected/client-plugin-live/session-actions.expected.md` | golden: the Session action menu (Pin / Rename) |
| `apps/web/tests/expected/cold-blank-session/queue.expected.md` | golden: the pending row restored after the Host restarted |
| `apps/web/tests/expected/composer-draft-scroll/geometry.expected.md` | golden: the composer scroll geometry at several draft positions |
| `apps/web/tests/expected/composer-focus/focus.expected.md` | golden: the composer whitespace focus contract |
| `apps/web/tests/expected/composer-placeholder/visibility.expected.md` | golden: placeholder visibility for empty / one space / many spaces |
| `apps/web/tests/expected/composer-tab-geometry/geometry.expected.md` | golden: the input card geometry across the Chat and Trajectory tabs |
| `apps/web/tests/expected/cordis-history/ui.expected.md` | golden: a conversation rendered from Cordis-tool history |
| `apps/web/tests/expected/cot-translation-paid/paid-choices.expected.md` | golden: the paid translation plugin's Settings page |
| `apps/web/tests/expected/cot-translation-paid/paid-result.expected.md` | golden: the paid translation result row |
| `apps/web/tests/expected/cot-translation/bing.expected.md` | golden: the Bing reasoning translation row |
| `apps/web/tests/expected/cot-translation/failure.expected.md` | golden: the "translation unavailable, original shown" status |
| `apps/web/tests/expected/cot-translation/preferences.expected.md` | golden: the reasoning-translation preferences page |
| `apps/web/tests/expected/declared-reasoning/pointer-menu.expected.md` | golden: the model-and-effort pointer menu |
| `apps/web/tests/expected/declared-reasoning/ui.expected.md` | golden: the declared effort radio items |
| `apps/web/tests/expected/deepseek-messages-settings/cards.expected.md` | golden: the DeepSeek card inside Settings |
| `apps/web/tests/expected/deepseek-messages-settings/picker.expected.md` | golden: the DeepSeek model group in the picker |
| `apps/web/tests/expected/deepseek-model-label-1017/models.expected.md` | golden: the DeepSeek account group with its release badge |
| `apps/web/tests/expected/default-model/background-save.expected.md` | golden: the composer with the access-mode chip |
| `apps/web/tests/expected/default-model/command-picker.expected.md` | golden: the `/model` fuzzy picker |
| `apps/web/tests/expected/default-model/model-labels.expected.md` | golden: the exact inline model labels in the composer picker |
| `apps/web/tests/expected/default-model/search.expected.md` | golden: the model search box and its clear action |
| `apps/web/tests/expected/default-model/unselected.expected.md` | golden: the composer with no model selected |
| `apps/web/tests/expected/default-workspace/failure.expected.md` | golden: "cannot create the default workspace" alert |
| `apps/web/tests/expected/desktop-locale/automatic.expected.md` | golden: the Settings dialog in the automatic locale |
| `apps/web/tests/expected/desktop-locale/selected.expected.md` | golden: the Settings dialog in the selected locale |
| `apps/web/tests/expected/desktop-onboarding/bonus-after-onboarding.expected.md` | golden: the bonus notice after onboarding |
| `apps/web/tests/expected/desktop-onboarding/credit-en-dark.expected.md` | golden: the English "Add credits" region (dark) |
| `apps/web/tests/expected/desktop-onboarding/credit-funded-en-dark.expected.md` | golden: the funded "Add credits" region (dark) |
| `apps/web/tests/expected/desktop-onboarding/credit.expected.md` | golden: the Chinese "准备可用额度" region |
| `apps/web/tests/expected/desktop-onboarding/process-en-dark.expected.md` | golden: the English "how much detail" region |
| `apps/web/tests/expected/desktop-onboarding/process.expected.md` | golden: the Chinese "你希望看到多少工作过程？" region |
| `apps/web/tests/expected/desktop-onboarding/purpose-en-dark.expected.md` | golden: the English "what would you like help with" region |
| `apps/web/tests/expected/desktop-onboarding/purpose.expected.md` | golden: the Chinese "你希望 DeepSeek Harness 帮你做什么？" region |
| `apps/web/tests/expected/desktop-onboarding/welcome-en-dark.expected.md` | golden: the English welcome region |
| `apps/web/tests/expected/desktop-onboarding/welcome.expected.md` | golden: the Chinese welcome region |
| `apps/web/tests/expected/file-upload-round/draft.expected.md` | golden: the mixed composer attachment rail and its selection order |
| `apps/web/tests/expected/file-upload-round/history.expected.md` | golden: the mixed history attachment flow and its source order |
| `apps/web/tests/expected/fork-mid-turn/ui.expected.md` | golden: the forked child's first turn and its "Completed" status |
| `apps/web/tests/expected/github-ready-review/conversation-expanded.expected.md` | golden: the GitHub review Session in the expanded tree |
| `apps/web/tests/expected/github-ready-review/conversation.expected.md` | golden: the GitHub review Session in the collapsed tree |
| `apps/web/tests/expected/goal-bar/active.expected.md` | golden: the active goal strip (Pause / Edit) |
| `apps/web/tests/expected/goal-bar/inactive.expected.md` | golden: the inactive goal strip (Resume / Edit) |
| `apps/web/tests/expected/goal-command-presentation/ui.expected.md` | golden: the `/goal` command's human transcript bubble |
| `apps/web/tests/expected/home-path-tilde/workspace-hover.expected.txt` | golden: `hover=~/Documents/project` and the full path on copy |
| `apps/web/tests/expected/input-plugin-extensions.expected.md` | golden: the composer's activity row and its cancel action |
| `apps/web/tests/expected/jobs-menu-layering/geometry.expected.md` | golden: the background-jobs menu geometry over the Browser dock |
| `apps/web/tests/expected/layout-bottom/geometry.expected.md` | golden: the bottom slot's reserved geometry (empty / open / grown) |
| `apps/web/tests/expected/markdown-cjk-strong/ui.expected.md` | golden: CJK-adjacent strong emphasis |
| `apps/web/tests/expected/markdown-images/ui.expected.md` | golden: the Markdown image policy surface |
| `apps/web/tests/expected/markdown-inline-code-links/ui.expected.md` | golden: inline-code links |
| `apps/web/tests/expected/markdown-wide-table/geometry.expected.md` | golden: the wide-table fill/scroll/break-out relations per viewport |
| `apps/web/tests/expected/math-rendering/ui.expected.md` | golden: the settled math reply |
| `apps/web/tests/expected/max-tokens-notice/history-turn.expected.txt` | golden: the output-token-limit notice text |
| `apps/web/tests/expected/menu-material/materials.expected.json` | golden: the menu material tokens per palette |
| `apps/web/tests/expected/menu-material/modal-masks.expected.json` | golden: the modal mask tokens per palette |
| `apps/web/tests/expected/menu-material/session-menu.expected.md` | golden: the Session menu |
| `apps/web/tests/expected/models-settings-recovery/stored-error.expected.md` | golden: a stored provider error inside Settings |
| `apps/web/tests/expected/models-settings/catalog-inputs.expected.md` | golden: the model-catalog add card |
| `apps/web/tests/expected/models-settings/configured.expected.md` | golden: a configured provider in Settings |
| `apps/web/tests/expected/models-settings/declared-edit.expected.md` | golden: the declared-model edit card |
| `apps/web/tests/expected/models-settings/declared.expected.md` | golden: the declared model list |
| `apps/web/tests/expected/models-settings/delete.expected.md` | golden: the delete-provider confirmation |
| `apps/web/tests/expected/models-settings/empty.expected.md` | golden: the empty Models Settings state |
| `apps/web/tests/expected/models-settings/image-only.expected.md` | golden: an image-only model configuration |
| `apps/web/tests/expected/models-settings/model-picker.expected.md` | golden: the "choose a model to add" dialog |
| `apps/web/tests/expected/models-settings/native-delete.expected.md` | golden: the native provider delete confirmation |
| `apps/web/tests/expected/models-settings/native-keyless.expected.md` | golden: a keyless native provider in Settings |
| `apps/web/tests/expected/models-settings/refreshing.expected.md` | golden: the Models Settings refresh state |
| `apps/web/tests/expected/navigation-panes/code-card.expected.md` | golden: the code card's Wrap/Copy actions |
| `apps/web/tests/expected/navigation-panes/command-wrap.expected.md` | golden: the wrap command's per-scheme output |
| `apps/web/tests/expected/new-session-refused/notice.expected.md` | golden: the Host's New Session refusal notice |
| `apps/web/tests/expected/office-font-notice.md` | golden: the Office font warning surface |
| `apps/web/tests/expected/onboarding-deepseek-config/default-models.expected.md` | golden: the default-model list during onboarding |
| `apps/web/tests/expected/onboarding-deepseek-config/empty.expected.md` | golden: "no models available" |
| `apps/web/tests/expected/onboarding-deepseek-config/missing.expected.md` | golden: the "add an API key to get started" dialog |
| `apps/web/tests/expected/onboarding-deepseek-config/models.expected.md` | golden: the model list during onboarding |
| `apps/web/tests/expected/onboarding-deepseek-config/sign-in.expected.md` | golden: the "get started" dialog |
| `apps/web/tests/expected/onboarding-deepseek-config/welcome.expected.md` | golden: the preview-version notice |
| `apps/web/tests/expected/onboarding-native/models.expected.md` | golden: the native-onboarding Models page |
| `apps/web/tests/expected/onboarding-native/signed-out-menu.expected.md` | golden: the signed-out menu |
| `apps/web/tests/expected/onboarding-usable-provider/dismissed.expected.md` | golden: the first-run setup card dismissed |
| `apps/web/tests/expected/plan-narrow-viewport/layout.expected.md` | golden: the composer control layout and click areas at 800×720 |
| `apps/web/tests/expected/plan-review/temporary.expected.md` | golden: the "Temporary review" region |
| `apps/web/tests/expected/plugin-config/bundle.expected.md` | golden: a community bundle's configuration page |
| `apps/web/tests/expected/plugin-config/official.expected.md` | golden: the official Plugins page |
| `apps/web/tests/expected/plugin-config/row.expected.md` | golden: one plugin row's detail page |
| `apps/web/tests/expected/plugin-config/subagent.expected.md` | golden: the subagent configuration page |
| `apps/web/tests/expected/plugin-config/web-search.expected.md` | golden: the web-search configuration page |
| `apps/web/tests/expected/plugin-install-approve/blocked.expected.md` | golden: the blocked-install dialog |
| `apps/web/tests/expected/plugin-install-cancel/cancelled.expected.md` | golden: the cancelled-install dialog |
| `apps/web/tests/expected/plugin-install-cancel/highlight.expected.md` | golden: the enabled plugin highlighted at 40 % alpha |
| `apps/web/tests/expected/plugin-install-cancel/invalid-registry.expected.md` | golden: the invalid custom-registry input |
| `apps/web/tests/expected/plugin-install-cancel/preparing.expected.md` | golden: the "preparing installation" dialog |
| `apps/web/tests/expected/plugin-install-cancel/unconfirmed.expected.md` | golden: the "installation status unconfirmed" dialog |
| `apps/web/tests/expected/plugin-install-cancel/unknown.expected.md` | golden: the "could not obtain the installation result" dialog |
| `apps/web/tests/expected/plugin-install-github/another-way.expected.md` | golden: the "another way" install dialog |
| `apps/web/tests/expected/plugin-install-github/failed-on-mirror.expected.md` | golden: "cannot reach GitHub" on the mirror too |
| `apps/web/tests/expected/plugin-install-github/failed.expected.md` | golden: "cannot reach GitHub" |
| `apps/web/tests/expected/plugin-install-github/mirror.expected.md` | golden: the GitHub mirror dialog |
| `apps/web/tests/expected/plugin-install-github/timeout-on-mirror.expected.md` | golden: "GitHub connection timed out" on the mirror too |
| `apps/web/tests/expected/plugin-install-github/timeout.expected.md` | golden: "GitHub connection timed out" |
| `apps/web/tests/expected/plugin-install-registry/fastest-default.expected.md` | golden: the registry picker with the fastest default |
| `apps/web/tests/expected/plugin-install-registry/installed.expected.md` | golden: the "installed" dialog |
| `apps/web/tests/expected/plugin-install-registry/official-default.expected.md` | golden: the registry picker with the official default |
| `apps/web/tests/expected/plugin-install-registry/picker.expected.md` | golden: the registry picker |
| `apps/web/tests/expected/plugin-manager/exports-en.expected.md` | golden: the English plugin detail page |
| `apps/web/tests/expected/plugin-manager/exports.expected.md` | golden: the Chinese plugin detail page |
| `apps/web/tests/expected/plugin-manager/header-responsive.expected.md` | golden: the plugin header's responsive layout rules |
| `apps/web/tests/expected/plugin-manager/icons.expected.md` | golden: the plugin card icon sizes and decode state |
| `apps/web/tests/expected/plugin-manager/ime-enter.expected.md` | golden: IME-composition behaviour in the package field |
| `apps/web/tests/expected/plugin-manager/live-enabled.expected.md` | golden: the Plugins page with a live-enabled bundle |
| `apps/web/tests/expected/plugin-manager/loading.expected.md` | golden: the Plugins page while loading |
| `apps/web/tests/expected/plugin-manager/manager.expected.md` | golden: the Plugins page |
| `apps/web/tests/expected/plugin-manager/missing-bundle.expected.md` | golden: a plugin whose bundle is missing |
| `apps/web/tests/expected/plugin-manager/preview.expected.md` | golden: the experimental plugin preview |
| `apps/web/tests/expected/plugin-manager/refresh.expected.md` | golden: the refresh tooltip's 500 ms delay |
| `apps/web/tests/expected/quota-notice/account_quota.expected.md` | golden: the `ACCOUNT_QUOTA` failure notice |
| `apps/web/tests/expected/quota-notice/quota.expected.md` | golden: the `QUOTA` failure notice |
| `apps/web/tests/expected/reasoning-preview/running.expected.md` | golden: the running reasoning preview with its fade |
| `apps/web/tests/expected/reference-composer/menu.expected.md` | golden: the reference menu's file/folder options |
| `apps/web/tests/expected/reference-composer/order.expected.md` | golden: the reference order target conversation |
| `apps/web/tests/expected/schedule-after/at-conversation.expected.md` | golden: an "At" reminder rendered as an ordinary assistant follow-up |
| `apps/web/tests/expected/schedule-after/conversation.expected.md` | golden: the "Automation task" conversation bubble |
| `apps/web/tests/expected/schedule-after/every-conversation.expected.md` | golden: a batched "Reminders:" line for two Every records |
| `apps/web/tests/expected/schedule-header.expected.md` | golden: the Automation tasks header layout |
| `apps/web/tests/expected/search-card/grep-card.expected.txt` | golden: the grep card's summary and head/tail slice |
| `apps/web/tests/expected/seeded-history/blank-reasoning.expected.md` | golden: recorded reasoning rendered as secondary Markdown |
| `apps/web/tests/expected/session-archive-active/dialog.expected.md` | golden: the "stop and archive this session?" dialog |
| `apps/web/tests/expected/session-row-hover/actions.expected.json` | golden: the session-row hover action states |
| `apps/web/tests/expected/session-row-hover/grouped.expected.json` | golden: the grouped session-row hover states |
| `apps/web/tests/expected/session-row-hover/mixed-rows.expected.json` | golden: the mixed-row hover exclusivity |
| `apps/web/tests/expected/settings-appearance/account.expected.md` | golden: the account settings card |
| `apps/web/tests/expected/settings-appearance/dark.expected.md` | golden: the dark palette's card/radius tokens |
| `apps/web/tests/expected/settings-appearance/light.expected.md` | golden: the light palette's card/radius tokens |
| `apps/web/tests/expected/settings-chrome/collapse-timing-en.expected.md` | golden: the English collapse-timing menu |
| `apps/web/tests/expected/settings-chrome/collapse-timing-zh.expected.md` | golden: the Chinese collapse-timing menu |
| `apps/web/tests/expected/settings-chrome/dialog-en.expected.md` | golden: the English Settings dialog |
| `apps/web/tests/expected/settings-chrome/dialog-no-browser.expected.md` | golden: the Settings dialog without a browser provider |
| `apps/web/tests/expected/settings-chrome/dialog.expected.md` | golden: the Chinese Settings dialog |
| `apps/web/tests/expected/settings-chrome/plugin-instances.expected.md` | golden: the plugin-instances list |
| `apps/web/tests/expected/settings-chrome/plugins.expected.md` | golden: the plugin list |
| `apps/web/tests/expected/shared-inspector/bottom.expected.md` | golden: the bottom DevTools geometry and shortcut |
| `apps/web/tests/expected/shared-inspector/client-status.expected.md` | golden: the disconnected-client attribute contract |
| `apps/web/tests/expected/shared-inspector/connections.expected.md` | golden: the DevTools context counts across embedded pages |
| `apps/web/tests/expected/shared-inspector/metadata-en.expected.md` | golden: the English DevTools bundle metadata |
| `apps/web/tests/expected/shared-inspector/metadata-zh.expected.md` | golden: the Chinese DevTools bundle metadata |
| `apps/web/tests/expected/shared-inspector/page.expected.md` | golden: the DevTools panel tab list |
| `apps/web/tests/expected/shell-command-details/background-long-token.expected.md` | golden: a very long background command shown in full |
| `apps/web/tests/expected/shell-command-details/background.expected.md` | golden: the background command row |
| `apps/web/tests/expected/shell-command-details/foreground-multiline.expected.md` | golden: the multi-line foreground command row |
| `apps/web/tests/expected/shortcuts-desktop/chord.expected.md` | golden: the recorded chord for "New Session" |
| `apps/web/tests/expected/shortcuts-desktop/fixed-conflict.expected.md` | golden: a fixed-key conflict in the shortcut editor |
| `apps/web/tests/expected/shortcuts-desktop/font-sizes.expected.md` | golden: the font-size shortcut values |
| `apps/web/tests/expected/shortcuts-desktop/macos-copy-override.expected.md` | golden: the macOS copy override on "New Session" |
| `apps/web/tests/expected/shortcuts-desktop/modal-layers.expected.md` | golden: the modal-layer shortcut order |
| `apps/web/tests/expected/shortcuts-desktop/recording.expected.md` | golden: the shortcut recording control |
| `apps/web/tests/expected/shortcuts-desktop/windows-copy-override.expected.md` | golden: the Windows copy override on "New Session" |
| `apps/web/tests/expected/shortcuts-panels/browser.expected.md` | golden: the Browser tab's close control |
| `apps/web/tests/expected/shortcuts-panels/guide-close.expected.md` | golden: the guide tab's close control |
| `apps/web/tests/expected/shortcuts-panels/page-actions.expected.md` | golden: the Files tab's page actions |
| `apps/web/tests/expected/shortcuts-panels/panels.expected.md` | golden: the panel tab list |
| `apps/web/tests/expected/shortcuts-panels/tab-menu.expected.md` | golden: the panel tab menu |
| `apps/web/tests/expected/shortcuts-workspace/files-open.expected.md` | golden: the opened workspace's file actions |
| `apps/web/tests/expected/shortcuts-workspace/fork-unavailable.expected.md` | golden: "this session has no completed turn" |
| `apps/web/tests/expected/shortcuts-workspace/fork.expected.md` | golden: the workspace shortcut surface |
| `apps/web/tests/expected/shortcuts-workspace/macos-defaults.expected.md` | golden: the macOS default shortcut table |
| `apps/web/tests/expected/shortcuts-workspace/session-menu.expected.md` | golden: the Session menu reached by shortcut |
| `apps/web/tests/expected/shortcuts/edit-stale.expected.md` | golden: a stale shortcut's "Restore default" state |
| `apps/web/tests/expected/shortcuts/en-US-conflict.expected.md` | golden: the English conflict alert |
| `apps/web/tests/expected/shortcuts/en-US-empty.expected.md` | golden: the English shortcut dialog |
| `apps/web/tests/expected/shortcuts/en-US-inline.expected.md` | golden: the English inline shortcut row |
| `apps/web/tests/expected/shortcuts/en-US-reset-confirm.expected.md` | golden: the English reset confirmation |
| `apps/web/tests/expected/shortcuts/en-US-saved.expected.md` | golden: "Modified" |
| `apps/web/tests/expected/shortcuts/en-US.expected.md` | golden: the English shortcut table |
| `apps/web/tests/expected/shortcuts/zh-CN-conflict.expected.md` | golden: the Chinese conflict alert |
| `apps/web/tests/expected/shortcuts/zh-CN-empty.expected.md` | golden: the Chinese shortcut dialog |
| `apps/web/tests/expected/shortcuts/zh-CN-inline.expected.md` | golden: the Chinese inline shortcut row |
| `apps/web/tests/expected/shortcuts/zh-CN-reset-confirm.expected.md` | golden: the Chinese reset confirmation |
| `apps/web/tests/expected/shortcuts/zh-CN-saved.expected.md` | golden: "已修改" |
| `apps/web/tests/expected/shortcuts/zh-CN.expected.md` | golden: the Chinese shortcut table |
| `apps/web/tests/expected/sidebar-subagent-activity/owner-running.expected.md` | golden: a running descendant on its owner row |
| `apps/web/tests/expected/sidebar-terminal/colors.expected.md` | golden: the terminal's ANSI palette per theme |
| `apps/web/tests/expected/sidebar-terminal/disconnected.expected.md` | golden: the disconnected terminal status |
| `apps/web/tests/expected/sidebar-terminal/guide.expected.md` | golden: the terminal guide menu |
| `apps/web/tests/expected/sidebar-terminal/limit.expected.md` | golden: the terminal-quota alert |
| `apps/web/tests/expected/sidebar-terminal/running.expected.md` | golden: the running terminal textbox |
| `apps/web/tests/expected/sidebar-terminal/shell-menu.expected.md` | golden: the shell choice menu |
| `apps/web/tests/expected/sidebar-terminal/theme.expected.md` | golden: the terminal surface colours per theme |
| `apps/web/tests/expected/sidebar-terminal/unavailable.expected.md` | golden: "this terminal no longer exists" |
| `apps/web/tests/expected/skill-invocation-policy/menu-fuzzy.expected.md` | golden: the fuzzy skill menu with a user-only marker |
| `apps/web/tests/expected/skill-invocation-policy/menu.expected.md` | golden: the shared skill menu |
| `apps/web/tests/expected/skill-invocation-policy/preview.expected.md` | golden: the skill definition preview |
| `apps/web/tests/expected/skill-user-invoke/ui-expanded.expected.md` | golden: the user-invoked skill, expanded |
| `apps/web/tests/expected/skill-user-invoke/ui.expected.md` | golden: the user-invoked skill |
| `apps/web/tests/expected/stats-paged-history/ui.expected.md` | golden: the whole-session statistics surface |
| `apps/web/tests/expected/steer-all/mid-steer.expected.md` | golden: a mid-turn steering interjection |
| `apps/web/tests/expected/steer-all/replay.override.json` | the recorded chunks for the steering scenario |
| `apps/web/tests/expected/steer-all/settled-expanded.expected.md` | golden: the settled steering conversation, expanded |
| `apps/web/tests/expected/steer-all/settled.expected.md` | golden: the settled steering conversation |
| `apps/web/tests/expected/subagent-conversation/migration-required-child.expected.md` | golden: the "before opening the child" subagent tree |
| `apps/web/tests/expected/thinking-markdown/ui.expected.md` | golden: the expanded Thinking Markdown surface |
| `apps/web/tests/expected/todo-row/parallel-plan.expected.txt` | golden: the parallel-plan row summary and active count |
| `apps/web/tests/expected/trajectory-virtualization/load-more.expected.md` | golden: the "Load earlier history" row |
| `apps/web/tests/expected/voice-download-fallback.expected.md` | golden: the voice-model download failure alert |
| `apps/web/tests/expected/voice-download.expected.md` | golden: the voice-model download failure alert (503) |
| `apps/web/tests/expected/voice-setup.expected.md` | golden: the "set up voice input before recording" dialog |
| `apps/web/tests/expected/voice-source-auto.expected.md` | golden: the automatic voice-model source card |
| `apps/web/tests/expected/voice-source-manual.expected.md` | golden: the manual voice-model source card |
| `apps/web/tests/expected/web-runtime-context/file-reference-prompt.expected.md` | golden: the runtime-context instruction that governs how produced files are linked |
| `apps/web/tests/expected/web-runtime-context/web-surface-prompt.expected.md` | golden: the runtime-context instruction that identifies "this GUI" |
| `apps/web/tests/expected/workspace-management/grouping-options.expected.md` | golden: the "Group by" menu |
| `apps/web/tests/expected/workspace-management/parent-folders.expected.md` | golden: the nested workspace folder tree |
| `apps/web/tests/expected/workspace-new-session-folding/first-batch.expected.md` | golden: the first batch of established sessions |
| `apps/web/tests/expected/workspace-new-session-folding/sidebar.expected.md` | golden: the sidebar with the provisional New Session row |
| `apps/web/tests/expected/workspace-new-session-folding/watermark-kept.expected.md` | golden: the watermark kept after leaving the session |
| `apps/web/tests/fixtures/account-login/cordis.patch.yml` | points the account provider at the loopback Platform double |
| `apps/web/tests/fixtures/assembled-remote.fixture.json` | the RemoteMock response catalogue (sessionList, settingsDescribe, credentials, attachment, …) |
| `apps/web/tests/fixtures/bonus-notice/cordis.patch.yml` | points the account provider at the loopback Platform double for the bonus notice |
| `apps/web/tests/fixtures/context-meter-no-chat.patch.yml` | disables `ui-chat` so the context meter is measured alone |
| `apps/web/tests/fixtures/deepseek-model-label-1017/account.overlay.yml` | the replay catalog supplies the account route without authentication |
| `apps/web/tests/fixtures/deepseek-model-label-1017/session.v4.jsonl` | the seeded session header (format v4) |
| `apps/web/tests/fixtures/inspector-copy.patch.yml` | the Inspector on a random port with fetch capture off |
| `apps/web/tests/fixtures/native-open-on.patch.yml` | pins desktop availability so native-open controls render in headless CI |
| `apps/web/tests/fixtures/office/README.i18n.yaml` | generated bilingual-pairing hash manifest for the Office fixture README |
| `apps/web/tests/fixtures/office/README.md` | the binary Office fixtures: what they are, where they came from, and what the regression covers |
| `apps/web/tests/fixtures/office/README.zh.md` | Chinese translation of the Office fixture README |
| `apps/web/tests/fixtures/office/preview.doc` | binary OLE2 Word fixture (`preview.doc`) |
| `apps/web/tests/fixtures/office/preview.ppt` | binary OLE2 PowerPoint fixture (`preview.ppt`) |
| `apps/web/tests/fixtures/office/preview.xls` | binary OLE2 Excel fixture (`preview.xls`) |
| `apps/web/tests/fixtures/onboarding-native/cordis.patch.yml` | disables `credentialOnboarding` for the native-onboarding scenario |
| `apps/web/tests/fixtures/plugins/fixture-bundle/cordis.patch.yml` | inserts the fixture bundle and its exported sub-rows |
| `apps/web/tests/fixtures/plugins/fixture-bundle/fallback-icon.svg` | the fallback icon (grey circle) |
| `apps/web/tests/fixtures/plugins/fixture-bundle/icon.svg` | the fixture bundle's icon (blue circle) |
| `apps/web/tests/fixtures/plugins/fixture-bundle/index.js` | an inert Cordis plugin (`@fixture/bundle`) |
| `apps/web/tests/fixtures/plugins/fixture-bundle/locale/review/en.json` | the English locale metadata for the review export |
| `apps/web/tests/fixtures/plugins/fixture-bundle/locale/review/zh.json` | the Chinese locale metadata for the review export |
| `apps/web/tests/fixtures/plugins/fixture-bundle/locale/search/en.json` | the English locale metadata for the search export |
| `apps/web/tests/fixtures/plugins/fixture-bundle/locale/search/zh.json` | the Chinese locale metadata for the search export |
| `apps/web/tests/fixtures/plugins/fixture-bundle/package.json` | the fixture bundle manifest (name, icon, `dsh.bundle`) |
| `apps/web/tests/fixtures/plugins/fixture-bundle/review.js` | an inert review plugin for exported-metadata coverage |
| `apps/web/tests/fixtures/plugins/fixture-bundle/search.js` | an inert search plugin for exported-metadata coverage |
| `apps/web/tests/fixtures/plugins/fixture-bundle/search.package.json` | a second manifest describing the exported search package |
| `apps/web/tests/fixtures/plugins/fixture-input-extension/client.js` | a published-protocol consumer of composer activities and bundle activation guidance |
| `apps/web/tests/fixtures/plugins/fixture-input-extension/cordis.patch.yml` | inserts the input-extension fixture |
| `apps/web/tests/fixtures/plugins/fixture-input-extension/index.js` | the Host companion for the input extension fixture |
| `apps/web/tests/fixtures/plugins/fixture-input-extension/package.json` | the input-extension fixture manifest |
| `apps/web/tests/fixtures/plugins/fixture-layout-bottom/client.js` | root-scoped bottom content with occupant-owned height and local input state |
| `apps/web/tests/fixtures/plugins/fixture-layout-bottom/index.js` | the Host companion for the bottom-slot fixture |
| `apps/web/tests/fixtures/plugins/fixture-layout-bottom/package.json` | the bottom-slot fixture manifest |
| `apps/web/tests/fixtures/plugins/fixture-live-client/client.js` | a test package using the published registration protocol, locale and slots |
| `apps/web/tests/fixtures/plugins/fixture-live-client/cordis.patch.yml` | inserts the live-client fixture |
| `apps/web/tests/fixtures/plugins/fixture-live-client/index.js` | the Host companion for the live browser lifecycle fixture |
| `apps/web/tests/fixtures/plugins/fixture-live-client/package.json` | the live-client fixture manifest |
| `apps/web/tests/fixtures/registry-ping.mjs` | controlled public-registry responses inside one isolated Web-test Host |
| `apps/web/tests/fixtures/restart-startup.js` | holds one Host service until the restart test releases application startup |
| `apps/web/tests/fixtures/restart-startup.overlay.yml` | injects the restart-startup service into `session-controller` |
| `apps/web/tests/fixtures/shared-inspector.patch.yml` | the shared Inspector on a random port, plus the session inspector |
| `apps/web/tests/fixtures/sidebar-terminal.patch.yml` | a small terminal quota and fast polling for the sidebar terminal lane |
| `apps/web/tests/agent-team-panel.overlay.yml` | the Agent Teams bundle expressed as an overlay over the stable base and Web bundles |
| `apps/web/tests/changed-files-turn.overlay.yml` | pins `nativeOpen: false` so the card header stays a label |
| `apps/web/tests/clickable-links-gallery.overlay.yml` | pins the native-open capability so headless CI and desktop hosts render the same branch |
| `apps/web/tests/declared-reasoning.overlay.yml` | starts the default on a declared reasoning model so the effort pane has something to describe |
| `apps/web/tests/default-model.overlay.yml` | declares pi-ai routes so the composer has a typeable model |
| `apps/web/tests/goal-bar.overlay.yml` | disables the goal-round driver so the bar scenario issues no model request |
| `apps/web/tests/no-sidebar-browser.overlay.yml` | exercises Settings without a built-in browser provider |
| `apps/web/tests/pin-browse-picker.overlay.yml` | pins the in-browser directory picker so a Playwright page can drive it |
| `apps/web/tests/present-svg.overlay.yml` | pins `nativeOpen: false` for the SVG delivery scenario |
| `apps/web/tests/present.overlay.yml` | pins `nativeOpen: true` for the file-delivery scenario |
| `apps/web/tests/pwsh-terminal.overlay.yml` | swaps the shipped bash stack for the PowerShell twin on every platform |
| `apps/web/tests/sidebar-browser.overlay.yml` | opts in to the Browser for its integration scenarios |
| `apps/web/tests/standalone-string-editor.overlay.yml` | inserts the optional string-replace editor tool |
| `apps/web/tests/support/listen-probe.mjs` | patches `Server.prototype.listen` to mark when the Host bound a port |
| `apps/web/tests/snapshots/agent-team-panel/resize.expected.md` | golden: the Agent Team panel after a resize (expansion offered) |
| `apps/web/tests/snapshots/agent-team-panel/task.expected.md` | golden: the Agent Team panel with one shared task |
| `apps/web/tests/snapshots/live-job-stream/settled.expected.md` | golden: the background-job list after the job settled |
| `apps/web/tests/snapshots/live-job-stream/streaming.expected.md` | golden: the background-job list while the job streamed |
| `apps/web/tests/snapshots/preview-boot/source-chooser.expected.md` | golden: the "Choose Preview data" form |
| `apps/web/tests/snapshots/streaming-fence-highlight/mid-stream.expected.md` | golden: the mid-stream code fence and its shiki token tree |
| `apps/web/tsconfig.json` | web project: host-face tests excluded from the client aggregate |

### Tier 3 — skipped with a reason

- `apps/web/tests/fixtures/office/preview.doc` — binary OLE2 Word document (9,216 bytes; magic `D0 CF 11 E0` confirmed on disk). Not line-readable; the fixture's `README.md` and `README.zh.md` were read instead, and they document exactly what the document contains and what the regression covers.
- `apps/web/tests/fixtures/office/preview.ppt` — binary OLE2 PowerPoint document (606,720 bytes; magic `D0 CF 11 E0` confirmed on disk). Not line-readable; documented by the fixture README.
- `apps/web/tests/fixtures/office/preview.xls` — binary OLE2 Excel document (5,632 bytes; magic `D0 CF 11 E0` confirmed on disk). Not line-readable; documented by the fixture README.

---

## 2. Ideas worth stealing

*Convergence note: this shard read only `deepseek-harness`. The `pi` and `hermes-agent` repos are other workers' shards, so every idea below is marked `UNIQUE` **from this shard's evidence** — a `CONVERGENT` marker would need the other two repos read.*

1. **Freeze the launch environment once, and let every plugin read that one snapshot.** `apps/cli/src/profile-boot.ts:36` resolves the outbound proxy from a `LaunchEnvironmentSnapshot` *before any plugin mounts*, precisely because Node's `fetch` ignores the proxy environment on its own and `NODE_USE_ENV_PROXY` cannot see a `.env` layer. **Why it transfers:** August Trading reads `process.env`, `.env` and Preferences at many call sites; one frozen snapshot makes "which credential did this run actually use?" answerable after the fact, and makes a run reproducible.
2. **Make the app-argument boundary an explicit, shared, immutable value.** `apps/cli/src/args.ts:164` — the launcher parses only what it owns; the first token it does not recognise starts the app's arguments, and every injected plugin reads the *same* immutable snapshot (`ctx.cmdlineArgs`). **Why it transfers:** August Trading's provider/model selection and its Electron shell both want CLI-ish settings; one shared snapshot removes the "who parses what" question.
3. **Ship a bounded, escalating shutdown as a product promise.** `apps/cli/src/process-shutdown.ts:4` — 5 s grace, first signal drains, second force-exits, `SIGTERM` exits 0 (a supervisor's ordinary stop), `SIGINT` exits 130. **Why it transfers:** August Trading's Electron/Capacitor shells need the same explicit contract, and the *codes* (0 vs 130) are worth copying verbatim.
4. **Make the product boundary a build invariant, not a convention.** `apps/web/product-isolation.ts:30` records every chunk, asset, CSS and worker input of the shipped bundle and fails the build if an experimental package reaches it; `apps/web/vite.config.ts:48` refuses to *serve* the bundle standalone with a message naming the right command. **Why it transfers:** August Trading's "experimental" features (voice, COT translation, worktree, plugin market) are exactly the things that leak into a production bundle; a build-time gate is cheaper than a review convention.
5. **Fail loud in a stand-in rather than shim silently.** `apps/web/src/node-module-stub.ts` — the browser stand-in for `node:module` throws `'node:module is not available in the browser'` rather than returning a no-op. **Why it transfers:** a silent stub in August Trading's Electron main process would let a broken preload ship and fail only at the user's first click.
6. **Stamp a capability, not a version, and refuse to guess an in-flight outcome.** `apps/cli/tests/profiles/headless/tests/semantic-checkpoint.expected.e2e.ts:128` — a session interrupted mid side-effecting tool call resumes with a `TOOL_OUTCOME_UNKNOWN` marker and the instruction "Do not retry blindly." **Why it transfers:** this is exactly the trade-log question "did that order actually fill?" — the system must record *unknown* rather than guess.
7. **Let the user's own override be a patch layer, and rewrite the root every boot.** `apps/cli/src/profile-boot.ts:81` — the root config is always rewritten, because the Loader's write-back can bake composed rows into the file and duplicate every insert on the next boot. **Why it transfers:** a user-editable settings file in August Trading must never be able to absorb generated content.
8. **Make a risky capability approval exact, narrow and revocable.** `apps/cli/src/plugin.ts:19` — `allow-version <pkg@version> --dsh-version <exact> --accept-risk`, persisted in the profile, revocable, and it never becomes a pnpm argument. **Why it transfers:** August Trading's "allow this provider / this broker / this autocapture" approvals should name the exact thing, not a class of things.
9. **Replace state in a transaction with a recoverable old copy.** `apps/cli/src/profile-boot.ts:108` — the new profile is assembled in a staging directory beside the target, moved in, and only then is the old one deleted; a failed restore leaves the previous copy at a reported path. **Why it transfers:** August Trading's `ExportService` / backup / import flow has the same shape; so should a trade-log migration.
10. **Keep the last good result when a source fails, and say so.** `apps/plugin-market-generator/src/generate.ts:330` — a source that cannot be read keeps its last successful result, the failure is reported, and the exit code is 1. **Why it transfers:** a market-data or broker adapter that goes down mid-run should degrade, not wipe the day's records.
11. **Cache entries must re-validate against the format they feed.** `apps/plugin-market-generator/src/generate.ts:62` — `CACHE_VERSION` is part of every cache key, and a cached record is only reused when the index parser still accepts it and its files still exist. **Why it transfers:** a cached analysis or a cached tool-result schema in August Trading must be re-checked, not trusted.
12. **Never execute the code you describe.** `apps/plugin-market-generator/src/fetchers.ts:100` and `:149` — tarballs are integrity-verified and unpacked in memory; Git is read as blobs in a private bare repo with `core.hooksPath=/dev/null`, `protocol.allow=never` and an explicit transport allow-list. **Why it transfers:** any "import a community strategy/indicator" feature in August Trading should read, not run.
13. **Redirect stdout to stderr while collecting, so the artefact stays machine-parseable.** `apps/cli/src/dump-config-schema.ts:36` — the import-time noise of trusted modules is sent to stderr and stdout carries exactly one JSON document. **Why it transfers:** any "export my trades as JSON/CSV" action must not interleave diagnostics with the payload.
14. **Budget responsiveness, not just correctness, for a streaming renderer.** `apps/web/stress-tests/reasoning-chunks.stress.ts:18` and `:21` — 100,000 reasoning chunks at 128 per 16 ms, measuring the **max event-loop delay** and the **scheduled-interaction latency** separately, both under 250 ms. **Why it transfers:** August Trading's chart and transcript stream thousands of rows; the two-number measurement (loop delay vs interaction latency) is a directly reusable gate.
15. **Keep the heavy vendor chunk React-free by construction.** `apps/web/vite.config.ts:118` — a hand-maintained allow-list of exact package names, with the reason spelled out: one React-importing member would drag the single shared React copy into `vendor` and split hook and element identity. **Why it transfers:** August Trading's chart/markdown/highlight stack has the same hazard.
16. **One golden per surface, and assert the inventory is closed.** 229 committed goldens in `apps/web/tests/expected`; every scenario asserts "the fixture inventory is closed", so an accidental extra artefact fails the build. The goldens are **ARIA trees**, not pixels — semantic, localisable, and readable. **Why it transfers:** August Trading's transcript/tool-row rendering is exactly the surface a jsdom test cannot see, and an ARIA-tree golden would be a cheap regression net for it.
17. **Let the composed configuration be dumped, not guessed.** `apps/cli/src/dump-config.ts` + `apps/cli/src/dump-config-schema.ts` — a boot-free dump of the composed tree and a JSON Schema of what is *declared*, with `x-cordis` diagnostics and an honest `complete: false`. **Why it transfers:** August Trading has a large provider/service matrix; a "what is actually configured?" dump is a debugging superpower.
18. **Say the failure as a sentence, and name the recovery.** `apps/web/tests/expected/sidebar-terminal/limit.expected.md` — "The terminal limit has been reached. Close unused terminals and try again. Exited terminals also count toward the limit." **Why it transfers:** the same tone is right for "the broker rejected the order" and "the plan needs 1 more approval".
19. **Give every failure a distinct, machine-readable identity.** `apps/web/tests/expected/quota-notice/quota.expected.md` and `account_quota.expected.md` — `QUOTA` and `ACCOUNT_QUOTA` are separate codes, and `apps/web/tests/auto-review-denial.e2e.ts` proves that a *reviewer failure* is shown as a reviewer failure, not as an "Auto denial". **Why it transfers:** in a trading app, "the model refused", "the risk gate refused" and "the broker rejected" must never collapse into one message.

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work.** This shard contains the *product surface* of DSH's scheduling, not the cron engine. `apps/web/tests/schedule-after.e2e.ts:573` pins the important behaviour: an overdue `Every` record is **batched to one latest occurrence** and both schedules advance — a catch-up storm is collapsed rather than replayed. `apps/cli/tests/profiles/web/tests/schedule-timing.expected.e2e.ts:81` pins the write path: `schedule/update` carries an `expected` record and returns `{ updated: false, code: 'schedule_conflict' }` on a stale edit, and `schedule_not_found` when the session does not own the task — an optimistic-concurrency fence, not a last-write-wins. The same file pins the *history* contract: a delivery record is `{ scheduledAt, deliveredAt, messageId }`, history is bounded by `retention: { days: 30, records: 200 }`, and the answer says plainly whether older records were pruned or were never available (`earlierRecordsUnavailable` / `earlierRecordsPruned`). Background work is a separate, observable surface: `apps/web/tests/background-job-list.e2e.ts:1` drives a real `ctx.jobs` entry, the running job appears in the Session header *without a refresh*, and `apps/web/tests/live-job-stream.e2e.ts` shows its real output streaming into an expanded panel and settling in place on kill. **Not in this shard:** the timer/cron implementation (`cordis-plugin-timer`), the catch-up-on-restart logic, and any breaker after repeated empty runs — those live in `packages/schedule` and `packages/jobs-local`.
- **Human-in-the-loop approval.** The approval record is carried by the *tool call it gates*, not by a side channel: `apps/cli/tests/profiles/acp/tests/escalation.e2e.ts:32` shows the full loop — a read-only sandbox denies a bash write, the **model** escalates with `sandbox_permissions` plus a one-sentence justification, the bridge raises a permission request attached to the escalating tool call, the offered options are exactly one-shot (`allow-once`, `reject-once`), and an approved retry lands the file on disk while a rejected escalation leaves the file absent *and still ends the turn*. In the Web surface, `apps/web/tests/access-confirmation.e2e.ts` puts both the experimental Auto entry and Full access behind the same locale-aware in-page risk confirmation, and `apps/web/tests/auto-review-approval.e2e.ts` / `auto-review-denial.e2e.ts` prove the **identity of the denier is preserved**: a reviewer failure is rendered as a reviewer failure and a user rejection as a user rejection, never as an "Auto denial". The surviving audit trail is the session log plus the permission request's own fields (session id, tool call id, the exact options offered). **Not in this shard:** the approval service and the permission-preset implementation (`packages/user-approval`, `packages/permission-presets`).
- **Post-mortem / reflection loops.** The strongest loop in this shard is the **semantic checkpoint**: an interrupted side-effecting call is resumed with `TOOL_OUTCOME_UNKNOWN` and "Do not retry blindly." (`apps/cli/tests/profiles/headless/tests/semantic-checkpoint.expected.e2e.ts:128`) — the system refuses to guess the outcome of an operation that was in flight when the process died, and pushes the *verification* to the model. Compaction is recorded, not silent: `apps/cli/tests/profiles/headless/tests/compaction.e2e.ts` asserts a `compaction/start`…`compaction/end` bracket, a `compaction/summary` naming the `shadowedSeqs` it shadowed, and a replace-op surface mutation — the transcript records **what it dropped**. Goal wrap-up injects one plugin-sourced `<goal_complete>` context after the terminal tool result and the model answers inside the same turn (`apps/cli/tests/profiles/acp/tests/goal.expected.e2e.ts:156`). Feedback is a *release gate* on the log, not a write: `apps/web/tests/feedback-release.e2e.ts` proves the collector receives each authorised suffix before the next UI action, and that command tails, provider changes and browser reloads do **not** release anything. **Not in this shard:** how outcomes become new rules, and what stops bad rules accumulating (that is the `packages/learning` shards).
- **Multi-agent.** Subagents, not debate. The child's own log carries a `subagent/descriptor` (version, mode `continuable`, provider, label) and a `sandbox/mode` event whose `source` is `delegation` — so a parent's narrower permission travels with the child and *overrides the wider deployment default* (`apps/cli/tests/profiles/headless/tests/expected/subagent-inheritance/child.expected.jsonl`). Settlement is push, not poll: `apps/cli/tests/profiles/headless/tests/fixtures/subagent-settlement-fence.ts` holds the parent's next step until the child's settlement is delivered, and `apps/cli/tests/profiles/headless/tests/expected/subagent-settlement/stream-json.expected.jsonl` states the rule — "notifies the parent when a continuable child settles without polling". Discovery degrades gracefully: `apps/cli/tests/profiles/headless/tests/subagent-diagnostic.expected.e2e.ts` shows a parent-owned catalog event is sufficient to find a child whose persisted log has **no descriptor event**. The "team" surface (`apps/cli/tests/agent-team-headless.e2e.ts`, `apps/web/tests/agent-team-panel.e2e.ts`) is a **shared task board with a Lead**, owner, scopes and status — a coordination surface, not a debate. Nowhere in this shard do two models answer the same question so they can be compared; the one two-model fixture (`apps/cli/tests/profiles/acp/tests/fixtures/control-surface/control-surface-llm.ts`) exists to make an answer *deterministic*, not to weigh two opinions. **Where debate would be wasted:** everything here shows that DSH spends its multi-agent budget on ownership, inheritance and settlement, not on persuasion.
- **Structured logs the model can query.** The durable record is **JSONL, one event per line**, with a `seq` and a `surfaceOp` that says how the event changes the *visible* surface (`append`, or a replace op). The committed goldens are the evidence: `apps/cli/tests/profiles/headless/tests/expected/semantic-checkpoint/session.expected.jsonl` is a diffable transcript, and the replay mechanism (a recorded session plus a `replay.override.json` of model chunks) makes ~450 browser scenarios keyless and deterministic. The format has a **guard**: `apps/cli/tests/profiles/headless/tests/session-format-guard.expected.e2e.ts` — a released v0 migrates before resume *without changing its source*, a newer format fails loud naming the upgrade direction and the raw log path, and an unknown required event type is refused. **Not in this shard:** the query engine itself — the in-memory SQLite content index (`packages/session-query-sqlite`) and the JSONL persistence (`packages/session-persistence-jsonl`) are other shards' work. What this shard adds is the discipline: the log's *shape* is a contract, it is versioned, and it is replayed rather than re-derived.
- **Staying simple as features accumulate.** Five mechanisms, all visible here: (1) **the composition is a table** — `apps/cli/composition.md` is a generated list of 100 plugin ids and their packages, so a feature is a declarative row, not a new module to wire; (2) **one golden per surface, with a closed inventory** — 229 committed ARIA/geometry goldens, and every scenario asserts it read exactly the fixtures it expected, so an accidental extra artefact fails the build; (3) **a written boundary for the test tree** — `apps/cli/tests/profiles/AGENTS.md:5`: "Keep a composition here only when the CLI profile assembly is the subject"; (4) **a deliberately small default** — the `minimal` agent preset is one fixed system prompt, one persistent shell, `read_image` and `working_directory`, and the full composition is opt-in per session; (5) **the product refuses to be half-served** — `apps/web/vite.config.ts:48` will not serve a bootless shell. The general shape: *feature count is controlled by making the default small and making every addition declarative*, not by deleting features.

## 4. Non-obvious decisions and gotchas

1. **The launcher's flags must come first, and the boundary is the first *unrecognised* token.** `dsh --profile web --port 8080` sends `--port` to the web app; `dsh --profile web --help` prints the *web app's* help, not the CLI's. A reader who assumes `--port` is a `dsh` flag will mis-predict everything.
2. **A config dump initialises a missing profile.** `--dump-config` and `--dump-config-schema` are "boot-free" but not read-only: they create the profile directory and write the root config. Only `--dump-default-config` (bundle layers only) is safe on a broken `cordis.patch.yml` — and it refuses `--patch` overlays, because it means "the bundle layers and nothing else".
3. **A patch replaces a row's whole `config`; it does not deep-merge.** And a user patch that replaces `config` with literals *removes* the runtime read of a flag-provided value (`port: !!js ctx.webStartup.port ?? 3080` becomes a constant). This is the single most surprising rule in the CLI.
4. **Signal exit codes are product decisions.** `SIGTERM` exits **0** on every surface; `SIGINT` exits **130**; a second signal force-exits. A supervisor stop is *not* an error, and the reference states this explicitly.
5. **The profile root `cordis.yml` is rewritten on every boot.** Editing it is pointless — it exists only to give the Loader an include root to anchor `baseUrl` at.
6. **`dsh plugin --profile x add .` installs the invoking directory, not the profile.** Relative specs are anchored to where the user typed the command, so a plugin checkout installs itself.
7. **TLS never falls back to HTTP.** Unreadable, empty or invalid certificate material fails startup; the pair is read once and never renewed or watched, so replacing it needs a listener reload or a restart.
8. **The schema dump is a reference, not a contract.** The reference calls it "a regenerated, pre-stable reference, not a versioned persisted catalog" — follow `$ref` and `configRef`, never hard-code definition names or ordering.
9. **The startup report is deliberately unredacted.** "Values are not redacted" is stated in the reference; the header warns the reader. Complete beats safe, but a user pasting it into a bug report leaks credentials.
10. **The `vendor` chunk must be React-free, and the rule is not obvious.** One React-importing member would drag the single shared React copy into `vendor` and split hook and element identity; the allow-list is exact npm package names on purpose (`apps/web/vite.config.ts:118`).
11. **`apps/web` is not an application.** `pnpm --filter … dev` is an *error* with a message naming `pnpm dsh web` / `dsh web` / `pnpm run dev:web`, because only `dsh web` injects `window.__DSH_BOOT__`.
12. **The web e2e lane must not import `@deepseek-ai/dsh-client-*`.** Importing a client package drags its whole TypeScript project into the **Host** build graph — this has already bitten the lane once (`apps/web/tests/README.md:31`). The rule is enforced by review, not by tooling, and the prescribed workaround is to *mirror* the constant next to a commented-out import so a drift fails loudly.
13. **The goldens are ARIA trees, so they are copy- and locale-sensitive.** A renamed button or a changed Chinese string breaks a browser test whose file name says nothing about it — 229 goldens, many of them Chinese.

## 5. Weak spots

1. **The launcher's grammar is implicit in the option order.** "The first token the launcher does not recognise starts the inner arguments" is implemented by a *combination* of Commander settings (`allowUnknownOption`, `passThroughOptions`, `enablePositionalOptions`, `helpOption(false)`) spread across `args.ts` and explained only in prose in `reference/README.md`. A future option that starts with `-` would silently change the boundary.
2. **The profile-replacement transaction has an unrepaired failure mode.** If the restore rename fails, the previous profile survives only at a `.staging-*/previous` path that the user must find by hand. It is documented; it is not tooled, and no test drives that branch end to end.
3. **The startup diagnostic report is unredacted by design.** A user who pastes it into a public issue leaks API keys and provider configuration. The header warning is a mitigation, not a control.
4. **`dshRange` is a hand-rolled semver intersection.** It caps at 256 alternatives and emits a range string whose meaning may not match another tool's reading of the same conjunction; a plugin with two DSH peer ranges is the edge case.
5. **The browser e2e lane is enormous and its failures are hard to localise.** 230 spec files and 229 goldens, with the goldens asserting exact Chinese and English copy — a copy edit breaks a test whose name says nothing about the change. `apps/web/tests/scaffold.ts` (1,796 lines) is the shared harness every scenario depends on, and it is pinned only indirectly.
6. **The build-time product-isolation gate wraps Vite's own CSS plugin.** `apps/web/product-isolation.ts` reaches into `vite:css`'s `transform` and proxies `addWatchFile`; a Vite upgrade that changes that hook's shape would make the gate throw (loud) — but a subtler change could make it record *less* and still pass.
7. **The `dsh` launcher is one binary with four modes and roughly twenty flags.** `plugin`, `dump-config`, `dump-config-schema` and the profile boot share a Commander program and a "first unknown token" rule; the resulting surface is large enough that the reference document is 30 KB of prose, which is itself a sign the grammar wants to be smaller.

