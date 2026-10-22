# deepseek-harness :: dsh-apps-desktop

**Files in shard:** 572 (read: 550, skipped with reason: 22)
**What this shard covers:** the entire `apps/desktop` package of the DeepSeek Harness monorepo — the Electron shell that wraps the shared `dsh` Web application and its private "Desktop Host" child process. It is the reference's *distribution* surface rather than its *agent* surface: there is no prompt assembly, no tool dispatch and no model routing here. What it does contain is a remarkably complete answer to "how do you ship a local agent harness as a signed desktop app, and how do you keep it honest while it updates itself" — an Electron main process with a hand-rolled updater state machine, a mandatory-update policy client that can block the whole app, a self-signed runtime-integrity manifest, a command-link installer that refuses to touch a command it does not own, a crash-report writer with bounded dialog excerpts, an NSIS installer with a custom-drawn native UI, and ~260 spec files that pin the *reasons* behind every one of those refusals.

The trading-relevant material is therefore indirect but real: this shard is the best available reference for **human-in-the-loop gating of consequential actions**, **durability of state across a restart**, **audit trails that survive a decision**, and **the discipline of "the renderer may not name the thing it is asking for"** — which is exactly the shape of August Trading's trade-plan approval, bot breaker's, and skill-approval flows.

## 0. Method and reading depth

- Every file in `dsh-apps-desktop.files.txt` was opened. `src/**` (69), `renderer/**` (12), `installer/**` (14 non-asset), `cli/**` (3), `config/**` (6) and the package/build configuration were read in full (line by line) and get a Tier-1 entry.
- `scripts/**` (171 files) and `tests/**` (260 files) are the release-pipeline tooling and its test suite. These were read in batches; the meaningful content of a script is its header contract plus its exported surface, and the meaningful content of a spec is its `describe`/`it` titles (the assertion is what the spec pins). Each is given a table row stating what it actually pins, and the load-bearing ones get a full entry. The 52 `tests/expected/*` golden files and the 29 `tests/fixtures/*` executable fixtures were read in full.
- `docs/**` READMEs (9 documents, plus their Chinese mirrors) were read for the *decisions* they record, not for prose.
- **22 files are skipped with a reason**: 9 generated `README.i18n.yaml` bilingual-pair hash manifests (Tier 3 `generated-vendored` — head read to confirm what they are), 7 binary image assets under `resources/` and `installer/assets/` (PNG/ICO magic bytes and size confirmed on disk), and 6 vector/brand SVG assets whose heads were peeked. None of them carries behaviour.
- **Nothing in the reference repo was executed.** Only `Get-Content` / `Get-ChildItem` / `git` reads were used. No install, build, test, or script was run.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `apps/desktop/src/main.ts`
- **Purpose:** the Electron main process. 1356 lines that own the window, the custom `dsh-app://` protocol, the child "Desktop Host" process, the updater, the tray, the menus, the mandatory-update policy, and every IPC handler.
- **Key abstractions:** wires `DesktopProjectManager` (profile), `DesktopHostProcess` (child), `DesktopBackendController` (child lifetime), `DesktopUpdateCoordinator` + `DesktopUpdateSchedule` (updater), `DesktopMandatoryUpdatePolicy` + `DesktopMandatoryUpdateWindow` (policy), `DesktopUpdateDialog` + `DesktopUpdateOverlays` (dialogs), `DesktopBrowserGuests`, `DesktopPlatformView`, `DesktopQuitConfirmation`, `DesktopTray`, `DesktopFatalRecovery`.
- **Data flow:** the shell owns a `dsh-app://app/` origin. `dsh-app://shell/*` serves bundled shell documents; `dsh-app://app/*` is served from the packaged Web `dist` for the first paint, then **forwarded to the authenticated Host** (`forwardWebRequest` + `authenticateWebHost` + a `Set-Cookie` → `Cookie` swap) for everything else. The renderer therefore never holds the Host's credentials.
- **Non-obvious design decisions:** (a) the Host is spawned as `ELECTRON_RUN_AS_NODE=1` child running `@deepseek-ai/dsh-desktop-host/lib/index.js` — the *same* Electron binary doubles as Node, so there is no second runtime to ship (`src/node-environment.ts`); (b) closing the main window **hides** it rather than quitting, so the Host and its tasks keep running; (c) `updateState` is published to *every* window (`BrowserWindow.getAllWindows()`) so a renderer can never be the source of truth.
- **Edge cases & failure handling:** `reportFatal` is the single funnel for fatal errors; it writes a crash report *first* and then shows a bounded dialog (`fatal-recovery.ts`). The updater's `beforeRestart` hook refuses to install if the Host could not be stopped gracefully, and **restarts the Host** if the install later fails (`publishUpdate` → `restoreHost`).
- **Surprising:** `app.setAppLogsPath()` is called *before* `app.whenReady()` so the very first crash report already lands in the platform log directory; and the `protocol.handle` route is registered for the whole app lifetime, meaning the Web app is served by the shell, not by the Host, even in development.

### `apps/desktop/src/ipc.ts`
- **Purpose:** the single registry of every IPC channel name, plus the shared product-API shape and the sender assertion.
- **Key abstractions:** `DESKTOP_IPC` (26 channels), `assertDesktopSender(event, hostnames)`, `DesktopUpdateState`, `DesktopUpdatePresentation`, `DesktopUpdateFailureKind`.
- **Data flow:** every `ipcMain.handle` in the app routes through a sender check that verifies `dsh-app:` scheme + hostname + (in most handlers) that the sender frame is the *primary* frame of the *owning* window.
- **Non-obvious design decisions:** `DesktopUpdateState` (main-process, may carry `technicalDetails`) and `DesktopUpdatePresentation` (renderer-safe, semantic only) are **two different types for the same fact**. The renderer can therefore never read raw updater diagnostics — it reads a `failure` kind and asks the main process for details through a separate, main-owned surface.
- **Edge cases:** `assertDesktopSender` throws on a missing sender frame rather than defaulting to allow.
- **Surprising:** the channel names are namespaced `dsh-desktop:` / `dsh-platform:` / `dsh-welcome:` / `dsh-update-dialog:` — and `preload-update-dialog.ts` exposes its bridge **only** when `location.href === 'dsh-app://shell/update-dialog.html'`, so a compromised product document cannot reach the dialog API.

### `apps/desktop/src/update-coordinator.ts`
- **Purpose:** owns exactly one updater target from "check" through "downloaded" to "installed", and refuses to let the renderer name a version or a URL.
- **Key abstractions:** `DesktopUpdateCoordinator` with `check(manual)`, `download(version)`, `install(version)`, `dispose()`; the state machine is `idle → checking → available → downloading → verifying → ready → installing`.
- **Data flow:** `check` → `updater.checkForUpdates()` → a *candidate version* held in the main process. `download(version)` **re-checks that `version === this.candidate`**, so a stale confirmation is a thrown error, not a silent download. `install(version)` requires `downloaded === true` and a matching candidate.
- **Non-obvious design decisions:** `autoDownload = false` and `autoInstallOnAppQuit = false` — electron-updater is configured to *never* act on its own. `allowDowngrade = false` is set explicitly because selecting a channel can silently enable it in electron-updater. The `latest` channel refuses a feed version containing `-` (a prerelease).
- **Edge cases:** `check` returns the current state (no network) when a download/install is in flight; a *manual* check failure stays visible, an automatic one is silent. `dispose()` waits for all in-flight updater promises with `allSettled` before removing the `error` listener, because a pending electron-updater promise can still emit an `EventEmitter` `error` during shutdown — an unhandled `error` event would crash the process.
- **Surprising:** `onError` deliberately does nothing for check/download errors (those promises own their failures) and only reports *install* errors, because `quitAndInstall` can fail after it returns.

### `apps/desktop/src/update-schedule.ts`
- **Purpose:** the polling loop for ordinary update checks, with exponential backoff and jitter.
- **Key abstractions:** `resolveDesktopUpdateScheduleConfig(env)`, `DesktopUpdateSchedule` (`check(manual, force)`, `dispose()`).
- **Data flow:** one shared deadline (`nextCheck`) is used by periodic, foreground, resume and explicit checks. `check()` returns the current state immediately when not due, unless `force` is set.
- **Non-obvious design decisions:** the backoff is *per-schedule* (`delay = min(maxBackoff, delay*2)` on failure, reset to `intervalMs` on success) and the jitter is applied **asymmetrically** around the delay (`lower = delay*(1-jitter)`, `upper = delay*(1+jitter)`) so the schedule cannot synchronise across many installed clients. A shared `activeChecks` counter means a manual caller joining an automatic check does **not** double the backoff.
- **Edge cases:** `dispose()` clears the timer and marks disposed so a late completion cannot re-arm the schedule; `check()` after disposal rejects.
- **Surprising:** the mandatory-update policy has its **own** schedule (`mandatory-update-policy.ts`), deliberately separate from this one — the file header says so explicitly: "Ordinary feed polling; policy queries and user-authorized transfers keep their own lifetimes."

### `apps/desktop/src/mandatory-update-policy.ts`
- **Purpose:** a server-driven policy that can say "this build is no longer supported" and **block the entire application** until the user updates.
- **Key abstractions:** `DesktopPolicyConfig` (origin, allowed page/auth origins, interval/timeout/backoff/jitter, authentication mode), `DesktopPolicyState` (`blocking`, `checking`, `title`, `detail`, `page`, `error`), `DesktopMandatoryUpdatePolicy`.
- **Data flow:** `check(scenario, manual)` → `GET /api/v0/check_client_update?scenario=…` with client identity headers → a response parsed by `parsePolicy`. A business code `40005` means *block*; `code 0 && biz_code 0 && data null` means *not blocked*. Anything else is a protocol error.
- **Non-obvious design decisions:** **a transport or parse failure never erases a known block** ("A known block survives transport and parsing failures, but not a fresh no-force success"). The backoff is `intervalMs * 2^min(failures,20)`, capped at `maxBackoffMs`. The `page` (the fallback download link) is validated against an allow-list of *exact* HTTPS origins immediately before it is handed to `shell.openExternal` or the clipboard.
- **Edge cases:** `dispose()` aborts the in-flight request and awaits settlement so a late response cannot publish or reschedule.
- **Surprising:** the policy query is **independent of the updater** — it never downloads or installs anything; it only decides whether the app may be used. That separation is the whole design.

### `apps/desktop/src/mandatory-update-window.ts`
- **Purpose:** the shell-owned modal that presents the policy and owns every privileged action.
- **Key abstractions:** `DesktopMandatoryUpdateWindow` (`sync`, `focus`, `confirm(version, active)`, `preparingRestart(active)`, `dispose`), `MandatoryUpdateView`, `MandatoryUpdateAction` = `refresh | download | install | later | page | copy`.
- **Data flow:** the main process publishes a `MandatoryUpdateView` (locale + policy + update state + confirmation + restart + navigation) to the renderer; the renderer replies with an *action name*, a *version*, and a *confirmation revision*.
- **Non-obvious design decisions:** the confirmation carries a monotonic `revision`; an `install`/`later` with a stale revision is rejected ("desktop policy: stale installation confirmation"). On Windows the modal is **embedded in the main window** via a closed shadow-root iframe (`preload-mandatory-overlay.ts`) rather than being a separate window — because a separate modal window on Windows would steal focus from the Host. On macOS it is a real child window with a *non-native* modal so it does not animate as a sheet.
- **Edge cases:** a policy that stops blocking closes the modal only after a 150 ms fade, so the exit is visible. A failed load of the modal document leaves the parent **blocked** with the title changed to the failure message.
- **Surprising:** the `page`/`copy` actions use a `navigationEpoch` so a late `openExternal` failure cannot overwrite the state of a *newer* navigation.

### `apps/desktop/src/update-dialog.ts`
- **Purpose:** one reusable, main-owned confirmation surface for every ordinary dialog in the app (updates, command management, policy login consent, About).
- **Key abstractions:** `DesktopUpdateDialog` (`show(parent, options)`, `focus()`, `cancel()`, `dispose()`), `UpdateDialogView` (revision, locale, title, message, detail, buttons, cancelId, closeLabel, technicalDetails), `UpdateDialogOptions`.
- **Data flow:** the main process composes the text; the renderer can only `respond(revision, index)` — a *displayed index*, never a semantic answer.
- **Non-obvious design decisions:** the `revision` counter makes a response from a replaced prompt **invalid** ("desktop update: stale dialog response"). The response handler validates the index against `cancelId` and `buttons.length`. `show()` resolves to `cancelId` when the dialog is aborted, closed, or the load fails — closing a confirmation never grants permission.
- **Edge cases:** `this.active?.finish(cancelId, true)` retains the window for a *replacement* prompt rather than closing and reopening it; the backdrop fades independently (`closing` timer).
- **Surprising:** the same class backs the "About" box, the "Manage dsh command" flow and the update confirmation. One dialog implementation, one focus trap, one keyboard model — this is the "one expandable panel" discipline August Trading applies to `Disclosure.tsx`, applied to native dialogs.

### `apps/desktop/src/update-overlay.ts`
- **Purpose:** creates the transparent, frameless child window that hosts a shell dialog **without** replacing the parent's native window controls.
- **Key abstractions:** `DesktopUpdateOverlays` (`create(parent, preload, title, nativeModal)`, `input(parent)`).
- **Data flow:** `input(parent)` returns `{revision, blocked}`; the keyboard layer (`keyboard.ts`) and the renderer overlay both consult it so a shell dialog actually blocks the product's shortcuts.
- **Non-obvious design decisions:** on macOS with `nativeModal === false` the overlay **prepends** a `before-input-event` listener on the parent so the shell dialog blocks input *before* the product's own shortcut listeners can dispatch it. The `revision` increments on every open and close, so a consumer can tell "still blocked" from "blocked by a different dialog".
- **Edge cases:** the overlay follows the parent's bounds on `move`/`resize` and re-shows when the parent is shown.
- **Surprising:** `skipTaskbar: true`, `hasShadow: false`, `resizable: false` — a shell overlay is deliberately not an app in the taskbar.

### `apps/desktop/src/quit-confirmation.ts`
- **Purpose:** the "you are about to quit" gate that asks about *running work*, not about a generic confirm.
- **Key abstractions:** `resolveDesktopQuitPrompt(inspection)`, `DesktopQuitConfirmation.confirm()`.
- **Data flow:** the Host is asked `inspectQuit()` → `{activeTasks, scheduledTasks}` → one of four locale keys (`quitActiveTasks`, `quitScheduledTasks`, `quitActiveAndScheduledTasks`, or none).
- **Non-obvious design decisions:** **an inspection failure counts as "unknown", and unknown warns** — it maps to `quitActiveTasks` rather than quitting silently. The inspection runs **once per decision**: work that starts or ends while the box is open does not change the copy, and approval never re-inspects. Repeated quit requests *join* the open confirmation instead of stacking a second box.
- **Edge cases:** `dispose()` (a quit path that must not ask) resolves a pending decision to `false` without opening a box.
- **Surprising:** the button order is platform-specific — macOS lays buttons out right-to-left from index 0, Windows keeps array order — and the comment says so.

### `apps/desktop/src/host-process.ts`
- **Purpose:** the lifecycle of the child process that runs the shared Web application.
- **Key abstractions:** `DesktopHostProcess` (`start()`, `stop(requireGraceful)`, `updateTasks(action)`, `inspectQuit()`), `DesktopHostFatalError` (message + a separate `diagnostic` getter), `DesktopHostUncleanExitError`, `isDesktopHostEvent` (a strict runtime validator for every IPC message from the child).
- **Data flow:** the child is spawned with `stdio: ['ignore','pipe','pipe','ipc']`; it reports `ready` (with the Web URL and boot injections), `fatal`, `platform-session`, `shutdown-complete`, and two correlated control responses (`update-tasks`, `quit-inspection`).
- **Non-obvious design decisions:** control requests are **correlated by `requestId`** with a per-request deadline; an unanswered request rejects rather than hanging. `stop(requireGraceful)` escalates `SIGTERM` → `SIGKILL` and refuses the update handoff unless the child exited 0 *and* acknowledged `shutdown-complete`. The stderr tail is capped at 64 KiB. `DesktopHostFatalError.diagnostic` is a **getter** so `util.inspect` does not print the (possibly huge) diagnostic twice.
- **Edge cases:** a `shutdown-complete` that was not requested is treated as a failure ("acknowledged an unrequested shutdown"). `platform-session` is cleared to `null` on every failure path, so a credential never outlives its host.
- **Surprising:** `isDesktopHostEvent` validates the *entire* platform session shape — including that `requestHeaders` contains no `authorization`, `host`, `content-length` or CRLF, and that the origin is HTTPS or loopback HTTP.

### `apps/desktop/src/backend-controller.ts`
- **Purpose:** owns one backend startup and its quiescent teardown, independent of any window.
- **Key abstractions:** `DesktopBackendController<Host>` (`start(prepare)`, `stop()`, `close()`, `state`, `host`).
- **Data flow:** `start()` serialises retries (`pending` is shared), runs `prepare()` (profile preparation) then `createHost(...).start()`, and publishes `starting → ready | error`.
- **Non-obvious design decisions:** the controller keeps the **original error object** in the error state (`{phase:'error', message, failure}`) so a crash report keeps the stack, enumerable properties and cause chain — the string is for the UI, the object is for the report. A cleanup failure is folded into an `AggregateError` rather than replacing the original.
- **Edge cases:** `stop()` marks the attempt `cancelled` so a `prepare()` that resolves later does not spawn a child. `close()` is permanent: `start()` after close rejects.
- **Surprising:** `stop()` resolves even when the pending startup promise rejects (it uses `allSettled` and re-throws only the *cleanup* failure).

### `apps/desktop/src/project-manager.ts`
- **Purpose:** initializes the Desktop profile (a pnpm workspace) and performs native recovery (disable all third-party plugins).
- **Key abstractions:** `DesktopProjectManager` (`applyRelease()`, `disableAllPlugins()`), `createRuntimeProjectMetadata`, `createDevelopmentProjectMetadata`, `createPluginProfile`.
- **Data flow:** `applyRelease()` → validate the runtime descriptor → migrate `pnpm-workspace.yaml` → create the plugin profile → remove link projections. All of it under a **file lock**.
- **Non-obvious design decisions:** the lock is a `lock` file containing the **owner's PID**; a stale lock is reclaimed only after `process.kill(pid, 0)` proves the owner is gone (with `ESRCH` meaning dead and any other signal meaning *alive*). The lock file itself must be a regular file — a symlink or directory is an error, not a lock.
- **Edge cases:** `mkdirSync(profile, {mode: 0o700})`, `openSync(lock, 'wx', 0o600)`, `fsyncSync` before the operation, `unlink` in a `finally`.
- **Surprising:** the workspace file is **generated as a string**, including an explicit `allowBuilds:` list naming exactly which native packages may build (`node-pty`, `koffi`, `fs-ext`, the core build package) and which are explicitly `false` (`@google/genai`, `protobufjs`, `node-addon-require-builtin`).

### `apps/desktop/src/core-package-set.ts`
- **Purpose:** the signed set of local npm tarballs that supply the bundled runtime, and the proof that they were used.
- **Key abstractions:** `parseDesktopCorePackageSet`, `verifyDesktopCorePackageSet`, `desktopCorePackageOverrides`, `verifyDesktopCoreLockfile`.
- **Data flow:** the descriptor (`desktop-packages.json`) lists `{name, version, file, bytes, integrity}`; verification re-hashes every tarball and compares the directory listing to the descriptor **exactly** (extra files are an error).
- **Non-obvious design decisions:** `verifyDesktopCoreLockfile` rejects a lockfile that resolved any core package through a **registry** version — the shell's runtime must come from the signed local tarballs, not from npm at install time. The descriptor must be **sorted by name**; an unsorted descriptor is rejected.
- **Edge cases:** every field is pattern-validated (`PACKAGE_NAME_PATTERN`, `VERSION_PATTERN`, `FILE_PATTERN`, `INTEGRITY_PATTERN`).
- **Surprising:** the release packages (`@deepseek-ai/dsh` and the private Desktop Host) must carry the *same version* as the Electron shell, or the descriptor is rejected.

### `apps/desktop/src/runtime-tree.ts`
- **Purpose:** the integrity manifest of the shipped production tree — the file-level equivalent of a signed build.
- **Key abstractions:** `writeDesktopRuntime(root, release, sharedNames, target)`, `readDesktopRuntime(root)`, `verifyDesktopRuntime(root, expectedVersion, target)`, `runtimePath(root, path)`.
- **Data flow:** every file in the runtime root is inventoried as `{path, bytes, sha256, executable}`; the descriptor is written beside the tree as `desktop-runtime.json`.
- **Non-obvious design decisions:** `runtimePath` refuses absolute paths, backslashes, colons, empty segments, `.` and `..` — the manifest is treated as untrusted input. Verification compares the whole inventory **byte-for-byte** (JSON equality of the sorted arrays). The `executable` bit is forced to `false` on Windows because there is no portable Unix permission bit there.
- **Edge cases:** the inventory walker **throws** on a filesystem entry that is neither a file nor a directory (a socket or device node) rather than skipping it. `inventoryRuntimeForVerification` uses 8 parallel readers and waits for every outstanding descriptor to close before returning a failure.
- **Surprising:** `verifyDesktopRuntime` re-checks the release version against the *expected* version, which is how an "installed-update qualification" build can rewrite the version and still be verified.

### `apps/desktop/src/web-document.ts`
- **Purpose:** serves the packaged Web assets and forwards everything else to the authenticated Host.
- **Key abstractions:** `serveWebDocument(request, root)`, `authenticateWebHost(url)`, `forwardWebRequest(request, host, cookie)`.
- **Data flow:** `authenticateWebHost` performs a `redirect: 'manual'` fetch of the Host's launch URL, requires status **303** and a `set-cookie`, and returns the cookie value only. `forwardWebRequest` then replays the renderer's request to the Host with that cookie substituted.
- **Non-obvious design decisions:** a set of **withheld response headers** (`set-cookie`, `content-encoding`, `content-length`, `transfer-encoding`, `connection`, `keep-alive`, `te`, `trailer`, `upgrade`, `proxy-authenticate`, `proxy-authorization`) never reach the renderer — `set-cookie` would hand the Host's auth cookie to the page's own cookie jar. Plugin bundle responses (`/plugins/…`) are forced to `cache-control: no-store` because the Host marks them immutable under a revision that changes every launch.
- **Edge cases:** path traversal is blocked by `resolve()` + a `startsWith(directory + sep)` check; `decodeURIComponent` failure returns 400; a missing file returns 404; a non-GET/HEAD method returns 405.
- **Surprising:** the `index.html` is patched at serve time with `<script>globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()</script>` — the page waits for asynchronous Host injections, and the shell owns that handshake.

### `apps/desktop/src/browser-guests.ts`
- **Purpose:** the isolation policy for Sidebar webview guests, enforced in the main process.
- **Key abstractions:** `DesktopBrowserGuests` (`acquire(owner, workspace)`, `release(owner, id)`, `bind(window, attachInput)`).
- **Data flow:** a renderer acquires a **lease** for a workspace; the lease names a `session.fromPartition('dsh-sidebar-browser-<uuid>')` that survives for the process lifetime. The guest is attached only if the `about:blank#<lease>` document matches a live, unclaimed lease owned by that window.
- **Non-obvious design decisions:** the webview preferences are **overwritten**, not merged — the code deletes every preference except `disablePopups` and then assigns a fixed set (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `webviewTag: false`, `plugins: false`, `navigateOnDragDrop: false`, `disableDialogs: true`). `httpreferrer` is cleared. A guest may not navigate to the application Host itself. Downloads are prevented. `login` events are cancelled.
- **Edge cases:** the lease is released when the owner navigates, when the renderer process dies, or when the window is destroyed. A `will-attach-webview` from a guest is always denied.
- **Surprising:** the first document is an *inert* `about:blank` carrying the lease, and the binding happens on `dom-ready` **before** the renderer can navigate the guest — a race the comment explicitly calls out.

### `apps/desktop/src/keyboard.ts`
- **Purpose:** global shortcut dispatch, including two-key chords, plus the interception of native menu accelerators.
- **Key abstractions:** `installDesktopShortcuts(...)` returning `{fileMenu, sendEditingKey, attach, attachGuest, dispose}`.
- **Data flow:** Electron `before-input-event` is intercepted; a key is turned into a `bindingKey({code, modifiers})` and matched against the *effective* shortcut set (only rows with a binding, no issue and no conflicts). A match is forwarded to the renderer as `{kind: 'keyboard'|'iframe'|'webview', revision, frameName, code, secondCode, repeat, control/alt/shift/meta}`.
- **Non-obvious design decisions:** the chord is built from the **sorted set of currently held keys**, so `Ctrl+K` then `I` is order-independent. `setIgnoreMenuShortcuts(true)` is used to stop Electron's native menu from eating a key the app wants. `consumed`/`held` maps track press-vs-repeat so a key release reaches the same handlers that received the press. The overlay `revision` is compared on every event: when it changes, the whole held-key state is reset.
- **Edge cases:** dead keys, IME composition and `altgr` clear the held set. Auto-repeat is swallowed only when the key is not a match. `sendEditingKey` re-focuses the focused guest and restores the editor's selection range after the synthetic key event.
- **Surprising:** the shortcut *definitions* arrive from the renderer (`shortcutsGet` → `parseShortcutDefinitions`) and are then owned by the main process for the lifetime of the window; the main process is the only place that decides whether a key is a shortcut.

### `apps/desktop/src/preload-app.ts`
- **Purpose:** the single product preload — the boundary that exposes native capability to the Web application.
- **Key abstractions:** `dshDesktop` (the product API: browser, keyboard, shortcuts, deviceInfo, updates), plus `dshOnboarding`, `__DSH_DIRECTORY_PICKER__`, `__DSH_HOST_PATHS__`, `dshDesktopBoot`, `dshPlatform`, `__DSH_LOCALE__`.
- **Data flow:** the preload is context-isolated and sandboxed; every capability is a named IPC round-trip. `__DSH_HOST_PATHS__.pathFor(file)` uses `webUtils.getPathForFile` so a dropped file becomes an `@path` reference instead of an upload.
- **Non-obvious design decisions:** the full `dshDesktop` product API is exposed **only** when the location is `dsh-app://app` *and* `process.isMainFrame`; everywhere else a bare `{protocolVersion: 1}` is exposed. The keyboard subscriber re-validates the focused element for `iframe`/`webview` inputs before forwarding.
- **Edge cases:** `enterWorkspace` temporarily sets `tabindex` on `<body>` and restores the previous attribute exactly.
- **Surprising:** the preload installs the Windows caption menu, the mandatory-update overlay (Windows only), the native-theme mirror, the fullscreen mirror and the platform marker — the shell's chrome is assembled by the preload, not by the app.

### `apps/desktop/src/preload-theme.ts`
- **Purpose:** mirrors the Web app's theme source into Electron's native theme so native chrome follows the app palette.
- **Key abstractions:** `syncNativeTheme()`.
- **Data flow:** a `MutationObserver` watches `html[data-ds-theme-source]`; each new value is sent over `DESKTOP_IPC.nativeThemeSet` and the main process sets `nativeTheme.themeSource`.
- **Non-obvious design decisions:** the *same* attribute is the source of truth for the web UI, the native chrome and the Platform login page — one attribute, three consumers. The observer only sends on change (`sent` guard).
- **Edge cases:** the preload runs before the document root exists, so it waits for `DOMContentLoaded`.
- **Surprising:** this is the pattern August Trading's `index.css` `@theme` block should copy if it ever ships a native shell: the web theme attribute is the single source, and native chrome reads it back.

### `apps/desktop/src/preload-mandatory-overlay.ts`
- **Purpose:** mounts the shell-owned mandatory-update document *inside* the main window's content area on Windows.
- **Key abstractions:** `installMandatoryUpdateOverlay()`.
- **Data flow:** a `closed` shadow root holds an iframe loading `dsh-app://shell/mandatory-update.html`; a `MessageChannel` connects the frame to the preload, which relays actions to the main process and posts results back.
- **Non-obvious design decisions:** the shadow root is `mode: 'closed'` — the product document cannot reach the update frame's DOM. The frame's `z-index` is `2147483647` and its top is offset by `WINDOWS_TITLEBAR_HEIGHT` so it covers the content but not the native caption.
- **Edge cases:** a `keydown` capture-phase listener **blocks background input** whenever the policy is blocking, but lets the Windows caption menu through (`data-windows-menu` in the composed path). The frame is removed 150 ms after the policy stops blocking.
- **Surprising:** the same document works both as a top-level page and as an embedded frame — `mandatory-update-frame.js` detects the embedded case and installs a `MessagePort`-based bridge only when `window.parent !== window`.

### `apps/desktop/src/preload-browser.ts`
- **Purpose:** the renderer-side browser bridge, with **one** main-process event subscription per window rather than one per lease.
- **Key abstractions:** `createDesktopBrowserBridge()` → `{acquire, release, onOpenRequested}`.
- **Data flow:** a single `ipcRenderer.on` fans out to per-lease listener sets; `onOpenRequested` returns a disposer that deletes the lease entry when its last listener leaves.
- **Non-obvious design decisions:** the payload is re-validated in the renderer (both `lease` and `url` must be strings) before any callback runs. A throwing listener is caught and logged so one bad subscriber cannot break the others.
- **Edge cases:** the returned bridge exposes neither IPC nor Electron objects.
- **Surprising:** the comment says it plainly: "browser operations that expose neither IPC nor Electron objects."

### `apps/desktop/src/preload-platform.ts`, `apps/desktop/src/preload-platform-account.ts`, `apps/desktop/src/preload-welcome.ts`, `apps/desktop/src/preload-menu.ts`, `apps/desktop/src/preload-windows.ts`, `apps/desktop/src/preload-update-dialog.ts`, `apps/desktop/src/preload-mandatory.ts`
- **Purpose:** the seven remaining preloads, each scoped to exactly one document and one job.
- **Key abstractions:** `markDocumentPlatform`, `syncWindowFullscreen`; the Platform account bridge (`getAuthToken`, `getLocale`, `onLocaleChange`); the welcome bridge (`dshWelcome`); the Windows caption menu (`installWindowsMenu`); the Windows appearance sync (`syncWindowsAppearance`); the update-dialog bridge (`dshUpdateDialog`); the mandatory bridge (`dshMandatoryUpdate`).
- **Data flow:** every one of them gates on a **location check** (`dsh-app://shell/mandatory-update.html`, `dsh-app://app`, …) before exposing anything, and every one of them throws at module load if its precondition is missing (the welcome preload throws if `--dsh-welcome-locale=` is absent).
- **Non-obvious design decisions:** the Platform account preload copies the token **once** via `sendSync` at init and then serves it from memory — "token getters never perform IPC". The Windows caption menu preserves the editor's selection range across the native popup (`rememberEditor` clones the DOM ranges and restores them) and mounts only after `[data-shell-overlay]` exists, so it never appears over a half-rendered app.
- **Edge cases:** the Windows appearance sync converts CSS colours to `rgba()` through a 1×1 canvas because Electron's `titleBarOverlay` rejects non-CSS colour strings; it only sends on change.
- **Surprising:** `preload-menu.ts` implements a **roving tabindex menubar** with ArrowLeft/ArrowRight/ArrowDown, and removes the outline when the input modality is pointer — a full keyboard model living in a preload, entirely outside the Web app.

### `apps/desktop/src/locale.ts`
- **Purpose:** the typed English and Chinese copy owned by the Electron shell, plus the locale resolution rules.
- **Key abstractions:** `en`, `zh` (both `as const`; `zh` is `satisfies DesktopMessages`), `DesktopMessages` (a mapped type requiring the *complete* English key set in every locale), `resolveDesktopLocale`, `resolveDesktopStartupLocale`, `formatDesktopMessage`, `desktopUpdateReadyConfirmation`.
- **Data flow:** `formatDesktopMessage` replaces `{name}` placeholders and leaves an unknown placeholder intact. `resolveDesktopStartupLocale(preference, languages)` prefers the explicit preference (`zh`/`en`), then walks the OS language list by primary subtag, then falls back to English.
- **Non-obvious design decisions:** the `DesktopMessages` mapped type means **adding a message to `en` is a compile error in `zh`** — a missing translation cannot ship. The shell's locale is independent of the Web app's: the app reports `localeChanged` and the shell re-labels its own menus and tray.
- **Edge cases:** a placeholder with no matching value is left as-is rather than blanked.
- **Surprising:** the copy is deliberately written as *guidance to the user about consequences* ("Running tasks will continue. You can reopen the window from the system tray."), not as status text. This is the same discipline as August Trading's `runStatus.ts` vocabulary.

### `apps/desktop/src/crash-report.ts`
- **Purpose:** writes the complete diagnostic of one fatal failure to disk, and keeps the *dialog* small.
- **Key abstractions:** `writeCrashReport(directory, input)`, `renderCrashReport(input)`, `pruneCrashReports(directory, retained)`, `RendererConsoleTail`, `crashReportFileName(time, source)`.
- **Data flow:** the report is plain text: a header of facts (time, source, phase, app/version/platform/arch/electron/node/locale, shell pid), the `inspect()`-rendered error (depth 6, 64 KiB string cap, 100-element array cap), the Host's own diagnostic when it reported one, and the renderer console tail.
- **Non-obvious design decisions:** `CRASH_REPORTS_RETAINED = 10` and pruning matches **only** files whose name matches the exact generated syntax (`/^crash-\d{4}-…-(host|web-boot|renderer|main)\.log$/`), so pruning never touches an unrelated file in the logs directory. `RendererConsoleTail` keeps the **oldest** lines and drops from the head, and always keeps one oversized line whole so a stack is never cut mid-line.
- **Edge cases:** a write failure returns `undefined` and the recovery dialog proceeds without a path — a diagnostic aid must never be fatal. `ERROR_SECTION_MAX_CHARS = 256 KiB` bounds the error section.
- **Surprising:** the file name is *sortable by time*, and pruning sorts by file name — no mtime dependency, no race with a clock change.

### `apps/desktop/src/fatal-recovery.ts`
- **Purpose:** the one native recovery dialog for the first fatal failure in a process.
- **Key abstractions:** `DesktopFatalRecovery.report(error, source)`, `CRASH_REPORT_WAIT_MS = 1_000`, `DETAIL_BUDGET = 1200`, `DETAIL_TAIL_LINES = 8`.
- **Data flow:** the report is written **first** (bounded by 1 s) so the dialog can name the file; the dialog shows the last 8 lines of the error, a truncation notice if it was shortened, the report path, and the reinstall advice.
- **Non-obvious design decisions:** the dialog's `detail` is **budgeted in characters** (`DETAIL_BUDGET`), and the truncation is computed backwards from the budget so the advice and the report line always survive. `EADDRINUSE` is detected by regex and gets a **different button set** (Exit/Restart only, no "disable plugins"). A later report can never replace the first dialog.
- **Edge cases:** a failed recovery operation loops the dialog with the *new* error rather than exiting; `dispose()`-style shutdown resolves a pending decision to `false`.
- **Surprising:** the advice is "Your tasks are stored separately" — the crash dialog tells the user that **their work is safe**, which is a deliberate product statement, not just a string.

### `apps/desktop/src/quit-confirmation.ts` (see also above) and `apps/desktop/src/background-notice.ts`
- **Purpose:** `DesktopBackgroundNotice` is the one-time Windows confirmation before the window is hidden to the tray.
- **Key abstractions:** `DesktopBackgroundNotice.close(hide)`, `dispose()`.
- **Data flow:** the acknowledgement is a marker file under `userData`; updates retain it and the uninstaller removes it.
- **Non-obvious design decisions:** only an **explicit** acknowledgement permits the first hide; a cancelled prompt remains eligible. Repeated requests while the box is open *focus* it rather than stacking a second one.
- **Edge cases:** the marker write is best-effort (a failure is logged, the hide still proceeds).
- **Surprising:** the notice text tells the user that running tasks *continue* — the same "your work survives" promise as the crash dialog.

### `apps/desktop/src/locale.ts` helpers used by the update path — `desktopUpdateErrorSummary`, `presentDesktopUpdate` (`apps/desktop/src/update-presentation.ts`)
- **Purpose:** turn a main-process update failure into a localized summary and a renderer-safe status.
- **Key abstractions:** `desktopUpdateFailureKind(state)`, `desktopUpdateErrorSummary(state, messages)`, `presentDesktopUpdate(state)`.
- **Data flow:** a `NETWORK_FAILURE` regex classifies the message into `check-network` / `download-network` / `install-network`; the renderer receives only `{phase, version?, percent?, failure?}`.
- **Non-obvious design decisions:** the technical details are **not** in the presentation — they live in the main-process state and are surfaced only through a main-owned expandable section.
- **Edge cases:** `percent` is floored; absent fields are omitted rather than sent as `undefined`.
- **Surprising:** `presentDesktopUpdate` exists so that the *renderer* can render status without ever being able to construct an update state. This is the same "semantic status + separately held diagnostics" split used in `WireAuditEntry` on the August Trading side.

### `apps/desktop/src/update-journal.ts`
- **Purpose:** an opt-in, out-of-install-directory JSONL evidence log for update qualification.
- **Key abstractions:** `DesktopUpdateJournal` (`action(action)`, `state(state)`), `desktopUpdateJournalState(state)`, `DesktopUpdateJournalAction`.
- **Data flow:** every record is `{schemaVersion, sequence, time, pid, version, event, ...}` appended with `appendFileSync(..., {flush: true})` — the append is flushed **before the caller continues**, so an incomplete qualification is never reported as traced.
- **Non-obvious design decisions:** the state is **whitelisted**: only `phase`, `targetVersion`, integer `percent`, `failedOperation` and a *fixed* error classification (`ERROR_CODES.find(code => message.includes(code)) ?? 'UNCLASSIFIED'`) survive. No raw error text, no URL, no request data. Duplicate states add no record.
- **Edge cases:** the directory must be absolute (a relative path throws); the file is created with `flag: 'wx'` and mode `0600`; creation errors **stop qualification** rather than degrading silently.
- **Surprising:** this is a complete answer to the trading question "structured logs the model can query" — a JSONL file with a fixed vocabulary, one file per process, and a hard rule that free text never enters it.

### `apps/desktop/src/command-installation.ts`
- **Purpose:** reversible ownership of a `dsh` command on the user's `PATH`, without ever following or overwriting a changed entry.
- **Key abstractions:** `inspectFileCommand`, `installFileCommand`, `removeFileCommand`, `CommandInstallationError` (codes `EINVAL`, `ESTALE`, `EOWNERSHIP`, `ENOENT`, `EUNSUPPORTED`), `FileCommandInstallation`.
- **Data flow:** a **fingerprint** (SHA-256 over dev/ino/mode/uid/gid/size/mtime-ns plus the link target) is computed over the current entry and the receipt; that fingerprint is shown to the user and must be presented back unchanged when the operation runs. The receipt (`.dsh-desktop-command.json`) records the launcher and the installed fingerprint.
- **Non-obvious design decisions:** the operation is a **rename-then-verify-then-rollback** transaction: the old entry is renamed to `.dsh-command-backup-<uuid>`, the new symlink is created via a temp name and hard-linked into place, and *any* failure restores the previous entry and throws an `AggregateError` naming the preserved path. The macOS `link()` syscall follows symlinks, so the repo ships a 20-line C helper (`cli/link-entry.c`) that calls `linkat` to preserve the inode and refuse an occupied destination.
- **Edge cases:** a backup whose fingerprint changed is `EOWNERSHIP`; a changed entry is `ESTALE`; a path that is neither file nor symlink is `EUNSUPPORTED`. The whole operation runs under `withFileLock(receiptPath, …, {waitMs: 5000})`.
- **Surprising:** an externally replaced command is **never removed** — `removeFileCommand` deletes only the receipt and leaves the other installer's entry alone, and reports `preservedBackup` so the UI can say "the previous launcher is preserved at: …".

### `apps/desktop/src/command-management.ts`
- **Purpose:** the native UI around the command manager, including the elevation fallback and the "another dsh takes precedence" diagnosis.
- **Key abstractions:** `presentCommandManagement(state, messages, platform)`, `DesktopCommandManager` (`show()`, `idle()`), `CommandPresentation`.
- **Data flow:** the manager runs the privileged worker (`command-manager-entry.ts`) out-of-process; on macOS a `EACCES`/`EPERM` result is retried through `osascript … with administrator privileges`, and an `(-128)` stderr means the user cancelled the elevation.
- **Non-obvious design decisions:** the "which dsh will my shell actually run?" question is answered by running the user's **login shell** (`shell -ilc "command -v dsh"`) with a 5 s timeout — and if the shell cannot be interrogated, the state is `selectionUnknown`, which *changes the confirmation* (a warning dialog before installing) rather than being ignored.
- **Edge cases:** the worker is spawned with a **filtered environment** (no `KEY|SECRET|TOKEN|PASSWORD|NODE_OPTIONS|NODE_PATH`); the worker's stdout is parsed as JSON, and a non-zero exit whose stdout still starts with `{` is still parsed.
- **Surprising:** `idle()` exists so the *updater* can wait for a command operation the user started before it takes over the installation — a small, explicit "one visible operation at a time" rule.

### `apps/desktop/src/command-manager-entry.ts` and `apps/desktop/cli/link-entry.c`
- **Purpose:** the out-of-process worker and the macOS hard-link helper.
- **Key abstractions:** the worker takes `operation` (`inspect|install|remove`) and an expected fingerprint; the C helper is `linkat`-based.
- **Data flow:** the worker writes **one JSON line** to stdout (`{ok:true,state}` or `{ok:false,code,message}`) — a machine-readable receipt, never a human string.
- **Non-obvious design decisions:** on macOS the worker sets `process.umask(0o022)` because it writes *public* command-ownership metadata, not user secrets. On Windows the worker pipes a JSON request to `command-path.ps1` over stdin. The mutation targets on macOS are **fixed before elevation** (the destination `/usr/local/bin/dsh` and the launcher path are decided in the parent), so the elevated `osascript` never receives a path the UI could influence.
- **Edge cases:** the fingerprint argument is validated as 64 hex characters for any mutating operation; an unknown operation is `EINVAL`.
- **Surprising:** the worker is a **separate entry point** from the Electron main process, so the privileged part of the flow has no Electron, no window and no renderer in scope.

### `apps/desktop/src/login-shell-environment.ts`
- **Purpose:** recover the user's real environment (PATH, and everything an rc file sets) when the app was launched from the Dock or Finder.
- **Key abstractions:** `readDesktopLoginShellEnvironment(base, config, options)`, `loginShellCandidates()`, `parseLoginShellOutput(stdout)`, `mergeLoginShellEnvironment(base, shell)`.
- **Data flow:** each candidate shell is run as `shell -ilc <DUMP>` where the dump prints a NUL-delimited marker, `command env -0`, and the marker again. The variables between the two markers are merged over the inherited environment.
- **Non-obvious design decisions:** the probe disables auto-update and tmux autostart (`DISABLE_AUTO_UPDATE`, `ZSH_TMUX_AUTOSTARTED`) so a plugin cannot block the read. The probe runs in its **own process group** (`detached: true`) and the group is killed on timeout or abort. `DSH_*` and `ELECTRON_*` are **launcher-owned** and are never overwritten by the shell. The read completes at the **closing delimiter**, not at `close`, because background children of an rc file inherit stdout and hold it open.
- **Edge cases:** every candidate failure is recorded as `{shell, reason}` (`exit <code>`, signal, spawn error, `timeout`, `aborted`, `unparsed`) and the next candidate is tried; on Windows the function returns `base` unchanged.
- **Surprising:** the failure list is *returned*, not just logged — the main process logs each one with the reason. A partial environment is a normal, reported outcome, not an exception.

### `apps/desktop/src/platform-view.ts`
- **Purpose:** an isolated `WebContentsView` that embeds the account Platform (usage / top-up) pages inside the app.
- **Key abstractions:** `DesktopPlatformView` (`open`, `setBounds`, `bootstrap`, `notifyLocaleChanged`, `close`, `closeAndWait`, `dispose`), `platformBounds(value)`.
- **Data flow:** the view runs in a partition derived from `(origin, userId)` — `persist:dsh-platform-<sha256>` when the user is known, a random temporary partition when not. Deployment headers and client headers are injected on requests to the account origin, and **stripped again** if a request is redirected to another origin.
- **Non-obvious design decisions:** `ERR_ABORTED` on the first load is **not** a failure (a Platform document may replace its own URL to consume an embedded deployment parameter). `close()` tears down the view, clears the webRequest hooks, and then **clears storage** (cookies, filesystem, indexdb, shadercache, serviceworkers, cachestorage) — the credential lifetime is the view's lifetime. A `generation` counter makes a superseded `open()` a no-op.
- **Edge cases:** `platformBounds` rejects non-finite, negative or >100 000 values; `bootstrap` requires the exact sender frame and origin; external links open in the OS browser, never in the embedded session.
- **Surprising:** `closeAndWait()` throws an `AggregateError` if any storage cleanup failed — the installer's handoff must not proceed with a credential still on disk.

### `apps/desktop/src/account-backend.ts`
- **Purpose:** the native account commands and the live state stream, with **no credential reaching a renderer**.
- **Key abstractions:** `accountView(value)` (a strict decoder), `validateBrowserDestination`, `desktopAccountBackend(origin, invoke, cookies)`, `DesktopAccountBackend`.
- **Data flow:** unary calls go over the standard authenticated RPC; the live watch opens a WebSocket to the remote stream mux with the session cookie and opens **three** multiplexed streams: `account/watch`, `account/watchExpiry` and `productAnalytics/watchPolicy`.
- **Non-obvious design decisions:** `accountView` validates the *entire* shape (status, links, attempt phase, error code) and re-validates every browser URL: HTTPS only, or loopback HTTP, never with credentials. The socket has `maxPayload: 65_536`. A malformed frame closes the socket rather than throwing. On close, the stream **reconnects after 1 s** and reports `onAnalyticsEnabledChanged(false)` — a disconnected stream publishes *no collection*, never a stale "yes".
- **Edge cases:** `credentials.describe` is called in **batches of 64** references (the API's own limit) — a detail that would break at 65 configured providers.
- **Surprising:** the *expiry* stream and the *policy* stream share the same socket; a failure of one does not disturb the other, because each is demultiplexed by its own `streamId`.

### `apps/desktop/src/welcome-backend.ts` and `apps/desktop/src/welcome-api.ts`
- **Purpose:** the native welcome flow's operations, and the decision of whether the welcome is needed at all.
- **Key abstractions:** `connectDesktopWelcome(authenticatedUrl, send, cookies)`, `DesktopWelcomeBackend`, `needsWelcome(authentication)`.
- **Data flow:** the welcome talks to the *same* Web backend over the standard RPC (`settings/describe`, `llm/listConfigurableProviders`, `credentials/describe`, `credentials/set`, `productAnalytics/enabled|Report`).
- **Non-obvious design decisions:** `needsWelcome` is `!loggedIn && !hasApiKey` — **two independent** authentication routes, and a user with only an API key is never nagged. `save()` catches everything and returns `{ok:false}`: "Provider diagnostics may contain credentials; the native form owns failure copy." The analytics policy is read with a 1 s `AbortSignal.timeout` so a hung policy endpoint cannot delay a sign-in.
- **Edge cases:** the credential *reference* (`apiKeyEnv`) is discovered from the settings namespaces and cross-checked against the provider directory; a missing reference is an error, not a default.
- **Surprising:** `read()` gathers `apiKeyEnv` from every configurable provider and asks `credentials/describe` about all of them, so "has an API key" means "has a key for *some* provider", not "has a DeepSeek key".

### `apps/desktop/src/welcome-window.ts`
- **Purpose:** the native welcome window and its IPC ownership.
- **Key abstractions:** `welcomeWindowOptions(platform, locale)`, `openWelcomeWindow(locale, operations)`.
- **Data flow:** IPC handlers are installed per window and removed when the window closes; each handler asserts the sender is that window's main frame.
- **Non-obvious design decisions:** the analytics handler **whitelists** the exact event/attribute combinations (`auth_page_click` with exactly `button_name: 'sign_in'|'api-key'`; the other two with no attributes) and throws otherwise. The API key is validated against `/^[\x21-\x7e]+$/` — printable ASCII, no spaces — in the main process as well as the renderer.
- **Edge cases:** a failed `loadFile` destroys the window and re-throws; `disposeActiveHandlers` is called before the new window's handlers are installed, so there is never a moment with two owners.
- **Surprising:** the window uses `vibrancy: 'menu'` on macOS and `backgroundMaterial: 'acrylic'` on Windows — the welcome window is a native-material surface, not a flat HTML page.

### `apps/desktop/src/client/WelcomePage.tsx` and `apps/desktop/src/client/welcome.tsx`
- **Purpose:** the standalone React renderer for the welcome flow.
- **Key abstractions:** `Welcome({api})` with pages `entry | key | account`; `welcome.tsx` mounts it with `flushSync` so Electron can reveal the window only after the first paint.
- **Data flow:** the component holds no credentials; every action goes through `window.dshWelcome`.
- **Non-obvious design decisions:** a `revision` ref guards async results: `start()` and `cancel()` capture `++revision.current` and discard a response that arrives after a newer action. `busyRef` blocks double submits independently of React state. The API key is validated in the renderer *and* the main process, and the renderer additionally rejects a value that looks like an env assignment (`KEY=value`) or a quoted string.
- **Edge cases:** `pagehide` unmounts the root and removes the media-query listener; `mounted.current` guards every `setState` after unmount.
- **Surprising:** `flushSync` is used deliberately — "Mount the local React renderer before Electron reveals the welcome window" — so the window is never shown with a blank frame.

### `apps/desktop/src/policy-test-auth.ts`
- **Purpose:** an isolated, process-lifetime session for the test-environment login, with no product window sharing its cookies.
- **Key abstractions:** `DesktopPolicyTestAuth` (`focus`, `login()`, `request` (a `fetch`-shaped function), `dispose()`).
- **Data flow:** `request` only accepts `https://<origin>/api/v0/check_client_update` with `redirect: 'error'` and `cache: 'no-store'`; the login window navigates only to the configured origin or an allowed auth origin.
- **Non-obvious design decisions:** the session is `session.fromPartition('dsh-policy-auth-<uuid>', {cache: false})` and `dispose()` clears storage, the auth cache and all connections. The window's **first document is a local placeholder** (`policy-login-loading.html`) so the user sees a spinner immediately while the remote page loads, and no later subresource can keep the placeholder on screen. `F12` is explicitly re-enabled for the test build.
- **Edge cases:** the request filter cancels any document that is neither the placeholder nor an allowed origin, and cancels the login with `failed`.
- **Surprising:** the placeholder is loaded with `?label=` so the **main process owns the copy** — the local document declares no global and reads one string.

### `apps/desktop/src/quit-confirmation.ts`, `apps/desktop/src/settings.ts`, `apps/desktop/src/paths.ts`, `apps/desktop/src/owned-directory.ts`, `apps/desktop/src/release.ts`, `apps/desktop/src/host-protocol.ts`, `apps/desktop/src/windows-layout.ts`, `apps/desktop/src/update-channel.ts`, `apps/desktop/src/update-error.ts`, `apps/desktop/src/single-instance.ts`, `apps/desktop/src/startup-error.ts`, `apps/desktop/src/duration-env.ts`, `apps/desktop/src/node-environment.ts`, `apps/desktop/src/keybindings.ts`, `apps/desktop/src/device-info.ts`, `apps/desktop/src/directory-picker.ts`, `apps/desktop/src/microphone-permissions.ts`, `apps/desktop/src/tray.ts`, `apps/desktop/src/client-metadata.ts`, `apps/desktop/src/platform-ipc.ts`, `apps/desktop/src/mandatory-update-ipc.ts`, `apps/desktop/src/client/styles.d.ts`
- **Purpose:** the small, single-purpose modules that the big ones depend on.
- **Key abstractions (with the non-obvious decisions):**
  - `settings.ts` — `readDesktopSettings(userData)` **never throws**: an unreadable or invalid settings file falls back to defaults with a console warning, because optional settings must not be fatal. The default file is created with `flag: 'wx'` and `EEXIST` is tolerated, so a user-created file is never overwritten.
  - `paths.ts` — `resolveDesktopPaths(dshHome)` returns `{profile, lock}` under the *shared* Harness home; the Electron profile and the CLI's data live side by side but do not collide.
  - `owned-directory.ts` — `removeOwnedDirectory` unlinks a symlink **without following it**; the comment records why: "Electron's recursive rm follows nested Windows junctions into installed resources." A non-directory, non-link root is an error.
  - `release.ts` — `parseDesktopRelease` validates a semver version, a semver node version, a semver pnpm version and the **host protocol generation**; the protocol version is a literal `4 as const` in `host-protocol.ts`, so bumping the lifecycle protocol is a compile-time decision.
  - `update-channel.ts` — the channel is sealed into the **packaged manifest**, independent of the release version; an *invalid* explicit channel throws rather than falling back, so a corrupted manifest cannot silently change which feed is used.
  - `update-error.ts` — `DesktopUpdatePreparationError` carries a stable `kind` and a separately-owned `technicalDetails` string; the raw subprocess output is excluded by contract.
  - `single-instance.ts` — `claimDesktopSingleInstance` claims the lock *before any profile lifecycle begins* and routes later launches to the owner.
  - `startup-error.ts` — `desktopErrorState` flattens an `AggregateError` into a multi-line message, so nested causes survive the trip to a renderer.
  - `duration-env.ts` — `resolveDurationMs` throws for anything outside 1000…2147483647 and **names the variable** in the error; the same validator is used by the update schedule, the policy config and the login-shell probe.
  - `node-environment.ts` — `desktopNodeEnvironment` sets `ELECTRON_RUN_AS_NODE=1` and, when a bin directory is supplied, puts it *first* on `PATH`.
  - `keybindings.ts` — the device-local shortcut file is written with `writeFileAtomic(path, raw, {mode: 0o600, dirMode: 0o700})` and read through a `ShortcutPersistence` coordinator that owns the single writer.
  - `device-info.ts` — `readDeviceInfo` returns `name=value` pairs separated by `; ` and **omits** any field whose source fails; it deliberately contains no hostname, user name or serial number.
  - `directory-picker.ts` — the picker rejects a request from any renderer that is not the owning window's **main frame**, and coalesces concurrent requests into one promise per window.
  - `microphone-permissions.ts` — microphone access is granted only to the primary window's main frame on the `dsh-app://app` origin, audio only, and on macOS only after the OS grants it.
  - `tray.ts` — the Windows tray is present for the whole run (not only while hidden) and its only actions are "open" and "quit" — the quit goes through the *same* confirmation as every other quit entry.
  - `client-metadata.ts` — `desktopClientVersion()` **throws** if the build carries no `DSH_CLIENT_VERSION` rather than reporting a guessed one.
  - `platform-ipc.ts` / `mandatory-update-ipc.ts` — the channel-name constants, and the `PlatformLocale` union `'en_US' | 'zh_CN'`.
  - `client/styles.d.ts` — a one-line module declaration for `*.css`.
- **Edge cases & failure handling:** the common pattern across all of these is *fail closed, never fail fatally*: a missing file yields a default, a malformed value yields a typed error, an unavailable capability yields `undefined` and a log line.

### `apps/desktop/src/update-attention.ts`
- **Purpose:** best-effort background attention for a *prepared but unconfirmed* update — "never grants update or task-stop authorization."
- **Key abstractions:** `DesktopUpdateAttention` (`ready(version, parent, modal, returnToConfirmation)`, `clear()`, `reset()`).
- **Data flow:** on Windows it flashes the parent frame; on macOS it bounces the Dock icon and posts **one silent notification** per readiness episode. A click on the notification returns to the *current* confirmation — it never installs.
- **Non-obvious design decisions:** one reminder per downloaded version (`if (this.version === version) return`), and the reminder is cleared the moment the parent or the modal is focused. The notification is *silent*, and it is not shown when either window is already focused.
- **Edge cases:** `Notification.isSupported()` is checked; a failed notification still leaves the frame flash or Dock bounce in place. Every native call is wrapped so an unavailable attention mechanism degrades to a log line, not a failure.
- **Surprising:** the class never focuses or restores the app — "Return to the application to confirm installation and restart" — because stealing focus is a worse failure than a missed reminder.

### `apps/desktop/src/update-http-executor.ts`
- **Purpose:** an **inactivity** deadline for the updater's HTTP requests, layered on electron-updater's own transport.
- **Key abstractions:** `DesktopUpdateHttpExecutor` (extends `ElectronHttpExecutor`, overrides `addErrorAndTimeoutHandlers`).
- **Data flow:** the executor installs its own timer that is **refreshed on every response byte**; when it expires it rejects with `code: 'ETIMEDOUT'` and aborts the request.
- **Non-obvious design decisions:** the deadline is an *inactivity* deadline, not a total-download deadline: "Maximum silence before headers or between response chunks, not a total download deadline." The upstream socket timer is for Node's HTTP, so Electron's `ClientRequest` (which emits `response`/`close` rather than socket events) needs its own handler.
- **Edge cases:** Electron 44 can emit a writable `close` after `finish` but *before* the response headers arrive, so the `abort` and `error` listeners are also attached. The timer is cleared on `end`, `error` and `stop`, and the request is aborted on expiry.
- **Surprising:** the constructor **validates its own timeout** (1000…2147483647) and throws for anything else, so a bad environment variable fails at construction rather than silently disabling the deadline.

### `apps/desktop/renderer/update-dialog.html`, `apps/desktop/renderer/update-dialog.js`, `apps/desktop/renderer/update-dialog.css`
- **Purpose:** the shell-owned document that renders every ordinary confirmation.
- **Key abstractions:** `window.dshUpdateDialog` = `{status, respond, subscribe}`; the document holds no copy of its own.
- **Data flow:** the main process sends a `UpdateDialogView`; the document renders it and answers with an **index**.
- **Non-obvious design decisions:** the document implements its **own focus trap** — Tab and Shift+Tab cycle a computed list of `button, details>summary, details[open]>pre` and `preventDefault()` every Tab, so focus cannot escape to the browser chrome. `Escape` responds with `cancelId`, never with the default button. A stale revision (`state.revision <= view.revision`) is **ignored**, so a late push cannot replace a newer prompt.
- **Edge cases:** the backdrop fades via a CSS transition with a `@starting-style` rule; `prefers-reduced-motion` removes it. The `technical-details` `<details>` is collapsed on every new view.
- **Surprising:** the CSS is deliberately plain and light (`color-scheme: light`, `#0f1115` on `#fff`) — a shell dialog is not themed by the app, it is a *system* surface with a stable identity.

### `apps/desktop/renderer/mandatory-update.html`, `apps/desktop/renderer/mandatory-update.js`, `apps/desktop/renderer/mandatory-update.css`, `apps/desktop/renderer/mandatory-update-frame.js`
- **Purpose:** the policy modal, rendered as text by a shell-owned page, usable both top-level and embedded.
- **Key abstractions:** `window.dshMandatoryUpdate` = `{status, subscribe, action}`; the frame bridge is a `MessagePort` protocol (`dsh-mandatory-connect` / `dsh-mandatory-state` / `dsh-mandatory-action` / `dsh-mandatory-result`).
- **Data flow:** the main process publishes a `MandatoryUpdateView`; the page computes the copy from the view's `locale.messages` — it holds no English or Chinese strings of its own.
- **Non-obvious design decisions:** the embedded bridge is installed **only** when `window.parent !== window` *and* the parent has not exposed a preload API — so the same file serves both roles. The `message` handler checks `event.isTrusted`, `event.source === window.parent` and `event.origin === 'dsh-app://app'`, and accepts exactly one port. The `action` call always carries the *current* `version` and `confirmation.revision`, so a stale click cannot install.
- **Edge cases:** `Escape` is prevented outright (a mandatory block has no escape). The primary button is disabled while an action is in flight, **except** while a confirmation is pending, where the button must stay live. The "download" button can become an "install" button under a held key; the page blurs the focused button in that case so a stale Enter does not install.
- **Surprising:** the page renders `update.technicalDetails` only when the update failed, and re-collapses the `<details>` whenever the content changes.

### `apps/desktop/renderer/policy-login-loading.html`
- **Purpose:** the local placeholder document shown while the remote login page loads.
- **Key abstractions:** none — it reads one `?label=` query parameter and renders it.
- **Non-obvious design decisions:** its CSP is `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'` — no origin, no font, no image. The spinner animation is disabled under `prefers-reduced-motion`.
- **Edge cases:** the script is IIFE-wrapped so the document "declares no global of its own".
- **Surprising:** the main process owns the *label* — the local document has no copy.

### `apps/desktop/renderer/welcome.html`, `apps/desktop/renderer/welcome.css`, `apps/desktop/renderer/assets/window-material.css`
- **Purpose:** the welcome document and its stylesheet.
- **Key abstractions:** the design-token block (`--dsw-alias-*`) is defined on `body` and mirrored for `prefers-color-scheme: dark`; the welcome window is transparent and the *native* material supplies the blur, so the CSS only supplies a foreground tint.
- **Non-obvious design decisions:** the layout is a three-row grid (`40px minmax(0,1fr) 104px`) with the actions pinned to the bottom row, so the window can be resized without the content jumping. `app-region: drag` on `.titlebar` and `app-region: no-drag` on every control.
- **Edge cases:** `:lang(en)` reduces the brand emphasis size — a per-language optical adjustment.
- **Surprising:** the file's comment cites the exact Figma frames ("Figma 2121:39336 / 2138:44626") so the CSS can be reconciled with the design source.

### `apps/desktop/renderer/assets/welcome-brand.svg`, `apps/desktop/renderer/update-close.svg`
- **Purpose:** two vector assets (the wordmark, the close glyph).
- **Content:** `welcome-brand.svg` is a 472×40 SVG with its own embedded `:root` token block; `update-close.svg` is a 449-byte glyph.
- **Status:** read (head confirmed); they are assets, not behaviour.

### `apps/desktop/installer/lifecycle.nsh`
- **Purpose:** the NSIS page lifecycle: GUI init, welcome, pre-install checks, progress, failure, finish.
- **Key abstractions:** `InstallerGuiInit` (DPI via `GetDeviceCaps(LOGPIXELSX)`, a 600-logical-pixel square window centred on the screen), `InstallerWelcome` (aborts for an update run), `InstallerBeforeInstall` (preflight + "is the app running?"), `InstallerProgressShow` / `InstallerFinish`, `.onInstFailed`.
- **Non-obvious design decisions:** the stock NSIS page is **hidden** and a custom native progress window is drawn on top; the NSIS worker still does the installation, so the UI thread only paints. The progress window is only shown after `SetPropW(HWNDPARENT, "HarnessInstaller.Ready", 1)`, so the installer's first paint is coordinated with the DLL.
- **Edge cases:** every failure path sets `SetErrorLevel 2` and quits — the installer's exit code is meaningful to CI.

### `apps/desktop/installer/path.nsh`
- **Purpose:** validate the install path and pre-flight the destination.
- **Key abstractions:** `InstallerValidatePathFunction` (a macro, so it can be instantiated more than once), `InstallerPreflight`.
- **Non-obvious design decisions:** the validation rejects drive roots, system folders (`WINDIR`, `PROGRAMFILES32/64`), reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9` — even with an extension), characters invalid in a path, trailing dots/spaces, and **reparse points** (a junction in the path). The `PROFILE`/`LOCALAPPDATA` ancestors are allowed but the selected directory itself is not.
- **Edge cases:** writability is proved by actually creating and deleting a temp file in the nearest existing ancestor; free space is checked with `GetDiskFreeSpaceExW` against `APP_64_UNPACKED_SIZE + 64 KiB`. A **new** installation requires an empty directory; an update requires the registered `InstallLocation` and the existing executable.
- **Surprising:** `GetFullPathNameW` is used to normalise the path *after* validation, and a repeated trailing separator that normalises to a drive root is rejected again.

### `apps/desktop/installer/pages.nsh`
- **Purpose:** the custom welcome and finish pages, drawn with NSIS dialogs and GDI+.
- **Key abstractions:** `InstallerCreate` (builds the page), `InstallerRender`, `InstallerStart`, `InstallerWelcomeLeave`, `InstallerFinishLeave`, `InstallerPaintButton` (NM_CUSTOMDRAW), `InstallerPaintCheckbox`.
- **Non-obvious design decisions:** the buttons are **real native controls** painted with `NM_CUSTOMDRAW` — the comment says "NM_CUSTOMDRAW keeps native button focus, keyboard input and accessible text." The checkbox is `BS_AUTOCHECKBOX` for the same reason. A borderless edit is placed inside a separately drawn rounded frame, and the edit's height is computed from the real font metrics.
- **Edge cases:** the path edit is validated 450 ms after the last keystroke (a debounce timer) and shows the error inline in a status label. An elevated installer still launches the app through the **user's shell** (`StdUtils.ExecShellAsUser`), because an elevated process must not be the one that starts the app.
- **Surprising:** the custom-drawn layout targets the **x86 NSIS stub** even on x64 Windows, which the comment states explicitly.

### `apps/desktop/installer/drawing.nsh`
- **Purpose:** GDI+ helpers — pixel fonts, rounded-rectangle paths, the edit frame bitmap, the checkbox painter.
- **Key abstractions:** `InstallerPixelFont`, `InstallerRoundPath`, `InstallerDrawEditFrame`, `InstallerPaintCheckbox`.
- **Non-obvious design decisions:** `InstallerRoundPath` builds a closed rounded rectangle from four arcs, and the arc angles are passed as **IEEE-754 bit patterns** because "System.dll has no float argument type." The macro's comment warns that `$0`/`$1` must not be used as inputs or output.
- **Edge cases:** the focus rectangle is drawn manually (`DrawFocusRect`) so the native focus indication survives the custom painting.

### `apps/desktop/installer/theme.nsh`
- **Purpose:** the light/dark palettes for the installer, in Figma logical pixels.
- **Key abstractions:** the `INSTALLER_*` geometry and colour defines, `InstallerResolveTheme`, `InstallerControlColors`.
- **Non-obvious design decisions:** `auto` reads `HKCU\…\Themes\Personalize\AppsUseLightTheme` and defaults to **light** when the key is missing. GDI+ wants ARGB; GDI text wants COLORREF — the file keeps both forms of every colour (`InstallerBgArgb` and `InstallerBgColorref`).
- **Edge cases:** `SetCtlColors` accepts only compile-time colours, so the palette is chosen between two complete sets at runtime.

### `apps/desktop/installer/strings.nsh`
- **Purpose:** the installer's own localisation, independent of the Electron application locale.
- **Key abstractions:** `LangString` pairs for English and Simplified Chinese.
- **Non-obvious design decisions:** the strings are written as *user guidance with consequences* — "DeepSeek Harness is running. Quit it from the system tray and try again."; "The previous installation could not be restored. Keep the backup directory shown in the error details and contact support before installing again."
- **Edge cases:** the error strings for path validation, ownership, writability and disk space are separate so the dialog can name the exact problem.

### `apps/desktop/installer/progress.h`
- **Purpose:** the animated progress model behind the installer's native progress page.
- **Key abstractions:** `InstallProgress` (`Tick`, `Advance`, `Complete`, `CaptionStage`).
- **Non-obvious design decisions:** **only the successful NSIS finish callback may authorize 100 %** — `Complete()` is the only path that sets `succeeded` and targets 100. Stage boundaries are `{0, 2, 94, 96, 98, 99}`; stages other than the extraction use an **exponential ease** toward their target rather than the real 7-Zip percentage, and the caption stage is derived from the *rendered* value so the label and the bar never disagree.
- **Edge cases:** `Advance` ignores a backwards or out-of-range stage, and never lowers `target`.

### `apps/desktop/installer/extract-progress.h`
- **Purpose:** parse the ASCII percentage 7-Zip prints at the start of each refreshed progress line.
- **Key abstractions:** `ExtractionProgress::Read(data, length)`.
- **Non-obvious design decisions:** the parser is **monotonic** (`number > value`), tolerant of `\r`, `\n` and `\b` line resets, and accepts at most three digits.
- **Edge cases:** a percentage that goes backwards is ignored, so a corrupt line cannot make the bar jump.

### `apps/desktop/installer/extract.h`
- **Purpose:** run the pinned 7-Zip executable under supervision and publish its progress.
- **Key abstractions:** `ExtractApplication(parent, tool, archive, destination, log)`, `InstallerHandle`, `InstallerAttributes`, `LaunchFailure(error)`.
- **Non-obvious design decisions:** the child is put in a **Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`**, so a crashed installer cannot leave a 7-Zip behind. Only three handles are inherited (`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`) — the child's stdin is `NUL`, its stdout is the progress pipe, its stderr is the log file. The command line uses `-bso0 -bse2 -bsp1 -bb0 -sccUTF-8` so 7-Zip's *stdout* is the percentage stream and its *stderr* is the diagnostic file. The destination ends in `\.` so a trailing backslash cannot escape the closing quote.
- **Edge cases:** Win32 failures are returned as **negated** error codes so they can never collide with a 7-Zip exit code; a raw crash status (e.g. `0xC0000005`) comes back bit-for-bit.
- **Surprising:** the progress percentage is published to the UI through a **window property** (`HarnessInstaller.ExtractProgress`) rather than a message — a zero-allocation channel across the DLL/NSIS boundary.

### `apps/desktop/installer/extract-report.h`
- **Purpose:** turn a 7-Zip failure into a saved report, a bounded excerpt, and a copy-to-clipboard action.
- **Key abstractions:** `SevenZipMeaning(code)`, `DescribeResult(code)`, `Headline(code, output, archive)`, `Compose(...)`, `BoundedExcerpt(...)`, `Excerpt(...)`, `ReadOutput(path)`, `WriteUtf8(path, text)`, `CopyToClipboard`, `Show(...)`.
- **Non-obvious design decisions:** the three result ranges are distinguished: `0..255` = a 7-Zip exit code, `< 0` = a negated Win32 error, anything else = a raw process status printed in hex. The **headline** is derived from 7-Zip's own `ERROR:` lines, skipping the line that merely echoes the archive path. The dialog shows at most 10 lines / 1000 characters; the *file* keeps everything (up to 16 MiB). A partial UTF-8 sequence at the truncation boundary is dropped first (`TrimPartialUtf8`) so the decode does not fail wholesale.
- **Edge cases:** the output is decoded as UTF-8 with `MB_ERR_INVALID_CHARS` and falls back to the ANSI code page; the report is written with a UTF-8 BOM; the clipboard write is retried 5 times with a 50 ms pause.
- **Surprising:** `Headline` is careful to skip the case where 7-Zip echoes the archive path after `ERROR:` — a detail that would otherwise produce a useless headline.

### `apps/desktop/installer/directory-report.h`
- **Purpose:** the report for a failed directory replacement (the "upgrade over an existing install" path).
- **Key abstractions:** `directory_report::Content(...)`, `directory_report::Compose(...)`.
- **Non-obvious design decisions:** the report records the **original Windows error and the independent restoration outcome** separately, plus the preserved backup path — so a failed restore is distinguishable from a failed move.

### `apps/desktop/installer/uninstall-data.h`
- **Purpose:** the Windows uninstall cleanup, with a hard refusal to delete anything important.
- **Key abstractions:** `uninstall_data::Normalize`, `Pin`, `Unlink`, `RemoveTree`, `Remove`, `RemoveEmptyParents`.
- **Non-obvious design decisions:** the helper refuses a target that overlaps the installation, the protected Harness home, a **known folder** (Profile, RoamingAppData, LocalAppData, Desktop, Documents, Downloads, Pictures, Music, Videos, Public, ProgramData, Windows, Program Files, Program Files (x86)), or the native Program Files directory. A reparse point is **unlinked, not followed** — the tree walk pins a directory with `FILE_FLAG_OPEN_REPARSE_POINT` and `FILE_SHARE_READ|FILE_SHARE_WRITE` (deliberately **not** `FILE_SHARE_DELETE`) so a rename cannot happen underneath it. Every sibling is attempted and the *first* error is returned after the whole tree has been visited.
- **Edge cases:** a locked file leaves residue and never fails the uninstall; a missing path is a success; `RemoveEmptyParents` refuses a populated or linked parent and never removes the stop directory itself.
- **Surprising:** the file documents the reason for the share flags: "Listing access takes part in share checks, so the open handle refuses the DELETE access a rename or removal needs."

### `apps/desktop/installer/uninstall.nsh`
- **Purpose:** what the uninstaller removes — and what it must never touch.
- **Key abstractions:** `un.CleanData`, `un.RemoveData`.
- **Non-obvious design decisions:** the comment states the rule: "Electron user data and updater downloads leave with the application; the Harness home is never touched." The `DSH_HOME` environment variable is read to pass the protected root to the C++ helper. The `/KEEP_APP_DATA` switch lets an older uninstaller preserve the data when the installer replaces it from another directory. Empty parent directories are pruned with a dedicated helper.
- **Edge cases:** `isUpdated` runs skip the cleanup entirely.

### `apps/desktop/installer/window-frame.cpp`
- **Purpose:** the native DLL that draws the installer's frame, progress page, failure dialogs, process detection and data cleanup.
- **Key abstractions:** `InstallerApplyFrame`, `InstallerShowProgress`, `InstallerFinishProgress`, `InstallerReportExtractFailure`, `InstallerReportDirectoryFailure`, `InstallerFindProcess`, `UninstallRemoveData`, `UninstallRemoveEmptyParents`.
- **Data flow:** the progress page reads its stage and the extraction percentage from **window properties** on the parent (`HarnessInstaller.Stage`, `HarnessInstaller.ExtractProgress`, `HarnessInstaller.Succeeded`), so the NSIS script and the C++ page never share a pointer.
- **Non-obvious design decisions:** the stock NSIS page is subclassed with a `WM_WINDOWPOSCHANGING` handler that forces `SWP_HIDEWINDOW`, so the custom page fully replaces it. `InstallerApplyFrame` **pins the module** with `GetModuleHandleEx(GET_MODULE_HANDLE_EX_FLAG_PIN)` because "NSIS may release its DLL reference before the window receives WM_NCDESTROY". `WM_NCCALCSIZE` returning 0 removes the non-client area, and `WM_NCHITTEST` maps the resize borders to `HTCLIENT` because the window is fixed-size.
- **Edge cases:** `InstallerFindProcess` matches the **full image path**, not just the executable name — "Match the affected executable, not another user's or directory's same-named application." A failed process-snapshot read returns `-1` (unknown) rather than "not running". The final animation is a bounded 750 ms pump of the message loop, so the 100 % frame is actually painted before the finish page is built.
- **Surprising:** the progress page draws a rounded bar with four `AddArc` calls and scales the whole 600×600 canvas by `dpi/96`, so the entire installer UI is one DPI-scaled bitmap.

### `apps/desktop/cli/dsh`, `apps/desktop/cli/dsh.cmd`
- **Purpose:** the shell shims that let the installed app run as the `dsh` command.
- **Key abstractions:** a POSIX `sh` script and a Windows `.cmd`.
- **Non-obvious design decisions:** the `sh` shim resolves **its own symlink chain** before computing `resources`, so it works from a symlinked install; it then `exec`s the app binary with `ELECTRON_RUN_AS_NODE=1` and `--expose-internals` — the same Electron binary, running as Node, hosting the CLI. "Run the installed CLI without changing the invoking shell or working directory."
- **Edge cases:** the Windows shim disables delayed expansion and propagates `%errorlevel%`.

### `apps/desktop/.env.macos.example`, `apps/desktop/.env.windows.example`, `apps/desktop/config/macos-packaging/macos-signing.env.example`, `apps/desktop/config/macos-packaging/production.env.example`, `apps/desktop/config/macos-packaging/test.env.example`, `apps/desktop/config/windows-packaging/production.env.example`, `apps/desktop/config/windows-packaging/test.env.example`, `apps/desktop/config/windows-packaging/windows-signing.env.example`
- **Purpose:** the release configuration templates, with no secret values.
- **Key abstractions:** the environment variable names the packaging scripts read.
- **Non-obvious design decisions:** the comments say exactly one notarization strategy must be chosen; `CSC_KEY_PASSWORD` is "the p12 export password, not an Apple account or login password"; a release ID is "32 lowercase hexadecimal characters from a secure random generator" and must be **retained for the whole batch** so an upgrade test can be repeated; "Values are not shell-expanded."
- **Edge cases:** the test presets carry `DOWNLOAD_TEST_ORIGIN` and `DOWNLOAD_TEST_RELEASE_ID`; the production presets carry the production mandatory-update origin.

### `apps/desktop/package.json`, `apps/desktop/electron-builder.config.mjs`, `apps/desktop/electron-builder.config.d.mts`, `apps/desktop/tsdown.config.ts`, `apps/desktop/tsconfig.json`, `apps/desktop/tsconfig.host.json`, `apps/desktop/tsconfig.client.json`
- **Purpose:** the package manifest and the build configuration.
- **Key abstractions:** the npm scripts (`package:mac:arm64`, `package:win:x64`, `upload:latest:…`, `check:package`, `prepare:runtime`, `sign:primary-runtime`, …), the three tsdown outputs, the two tsconfig projects.
- **Non-obvious design decisions:** the tsdown config produces **three kinds of output**: an ESM main bundle, an IIFE welcome renderer (built by a nested Vite pass in `onSuccess`), and **CommonJS** preloads — "Sandboxed Electron preloads run as CommonJS even though the application package is ESM." The main bundle inlines workspace devDependencies, and the `preloadImports` allow-list is exactly `electron`, `events`, `timers`, `url` — the set a sandboxed preload may `require`. The only inlined build value is `process.env.DSH_CLIENT_VERSION`; "every other variable stays a runtime lookup."
- **Edge cases:** `electron-builder.config.mjs` is a thin re-export of a factory in `scripts/`, so the qualification path can import it without the environment.
- **Surprising:** the `tsconfig.json` is a *solution* file with two referenced projects, and `tsconfig.host.json` **excludes** `src/client` — the main process and the renderer are separately type-checked projects, so a renderer-only type error cannot break the host build.

### Tier 2 — bulk: a compact table, one row per file

The build/packaging/signing/publishing tooling. Each row states what the file's contract is and what it exports; the ones that define a *rule* rather than a mechanism are called out in §2 and §4.

| File | What it does / what it pins |
| --- | --- |
| `apps/desktop/scripts/build-installed-update-worker.mjs` | Internal builder child; requires its live parent's version-scoped packaging record and never publishes. |
| `apps/desktop/scripts/command-path.ps1` | <# Per-user PATH ownership. The worker owns its mutex through registry publication. #> |
| `apps/desktop/scripts/cos-operation.ts` | Total deadlines and request cleanup for one qualification COS operation. — exports: cosOperation |
| `apps/desktop/scripts/desktop-auto-update-environment.d.mts` | Environment variable that selects the Desktop update deployment. — exports: DESKTOP_AUTO_UPDATE_ENV, resolveDesktopAutoUpdateEnvironment, resolveDesktopAutoUpdateTarget, desktopBuildRecordFilename, desktopUpdateMetadataFilename, resolveDesktopAutoUpdateConfig |
| `apps/desktop/scripts/desktop-auto-update-environment.mjs` | Resolve the Desktop auto-update channel and its Tencent COS destination. — exports: DESKTOP_AUTO_UPDATE_ENV, resolveDesktopUpdateChannel, resolveDesktopAutoUpdateEnvironment, resolveDesktopAutoUpdateTarget, desktopBuildRecordFilename, desktopUpdateMetadataFilename |
| `apps/desktop/scripts/desktop-build-commit.d.mts` | Commit a build came from, and whether its checkout carried uncommitted changes. — exports: DESKTOP_BUILD_COMMIT_ENV, DESKTOP_BUILD_DIRTY_ENV, readDesktopBuildCommit, resolveDesktopBuildCommit, desktopBuildCommitEnvironment |
| `apps/desktop/scripts/desktop-build-commit.mjs` |  — exports: DESKTOP_BUILD_COMMIT_ENV, DESKTOP_BUILD_DIRTY_ENV, readDesktopBuildCommit, resolveDesktopBuildCommit, desktopBuildCommitEnvironment |
| `apps/desktop/scripts/desktop-build-paths.d.mts` | import type { DesktopAutoUpdateTarget } from './desktop-auto-update-environment.mjs' — exports: resolveDesktopBuildTarget, desktopTargetBuildPaths, desktopTargetPlatform, resolveDesktopTargetBuildPaths, developmentRuntimeDirectory, desktopArtifactOutput |
| `apps/desktop/scripts/desktop-build-paths.mjs` | Resolve build-owned Desktop paths without sharing mutable state across release targets. — exports: resolveDesktopBuildTarget, desktopTargetBuildPaths, desktopTargetPlatform, resolveDesktopTargetBuildPaths, developmentRuntimeDirectory, desktopArtifactOutput |
| `apps/desktop/scripts/desktop-build-version-discovery.ts` |  — exports: desktopBuildDateSegment, suggestDesktopBuildVersion |
| `apps/desktop/scripts/desktop-build-version.d.mts` | Environment variable that carries the build version through one packaging and upload run. — exports: DESKTOP_BUILD_VERSION_ENV, validateDesktopBuildVersion, resolveDesktopBuildVersion, desktopBuildVersionPrefix |
| `apps/desktop/scripts/desktop-build-version.mjs` |  — exports: DESKTOP_BUILD_VERSION_ENV, validateDesktopBuildVersion, resolveDesktopBuildVersion, desktopBuildVersionPrefix |
| `apps/desktop/scripts/desktop-bundle-imports.d.mts` | import type { Rolldown } from 'tsdown' — exports: importPackageName, isBareSpecifier, unpackagedImports, packagedImportsPlugin |
| `apps/desktop/scripts/desktop-bundle-imports.mjs` |  — exports: importPackageName, isBareSpecifier, unpackagedImports, packagedImportsPlugin |
| `apps/desktop/scripts/desktop-ci-version.d.mts` | Resolve the version used by the manual Desktop packaging workflow. — exports: desktopCiVersion |
| `apps/desktop/scripts/desktop-ci-version.mjs` | Resolve manual Desktop CI build versions without release storage access. — exports: desktopCiVersion |
| `apps/desktop/scripts/desktop-cos.ts` | Shared Tencent COS client construction for Desktop update objects. — exports: DESKTOP_COS_REGION, createDesktopCos |
| `apps/desktop/scripts/desktop-package-environment.d.mts` | Select local test defaults or platform release settings without changing the caller's environment. — exports: localMacOSPackageEnvironment, loadDesktopPackageEnvironment, validateDesktopPackageEnvironment |
| `apps/desktop/scripts/desktop-package-environment.mjs` | Select local test defaults or platform release settings without changing the caller's environment. — exports: localMacOSPackageEnvironment, loadDesktopPackageEnvironment, validateDesktopPackageEnvironment |
| `apps/desktop/scripts/desktop-policy-environment.d.mts` | Required deployment-selected metadata for mandatory-update policy requests. — exports: resolveDesktopPolicyEnvironment |
| `apps/desktop/scripts/desktop-policy-environment.mjs` | Resolve the required policy service from the same deployment as updater publication. — exports: resolveDesktopPolicyEnvironment |
| `apps/desktop/scripts/desktop-publication-failure.ts` | Safe failure details shared by publication diagnostics and durable journals. — exports: DesktopCosOperationError, desktopPublicationFailure |
| `apps/desktop/scripts/desktop-publication-summary.ts` | Render the verified publication plan for GitHub's native deployment reviewers. — exports: desktopPublicationSummary |
| `apps/desktop/scripts/desktop-publish-config.ts` | Read public deployment settings independently from upload and GitHub App secrets. — exports: readDesktopPublishConfig, readDesktopUploadCredentials |
| `apps/desktop/scripts/desktop-publish-cos.ts` | COS transport for resumable Desktop publication; callers authorize writes and own the channel lock. — exports: desktopPublishCos |
| `apps/desktop/scripts/desktop-publish-qualification.d.mts` | Explain why retained debugging packages cannot enter either publication environment. — exports: desktopPublishQualificationError |
| `apps/desktop/scripts/desktop-publish-qualification.mjs` | Explain why retained debugging packages cannot enter either publication environment. — exports: desktopPublishQualificationError |
| `apps/desktop/scripts/desktop-publish-record.ts` | Machine-local channel exclusion and durable, credential-free publication records. — exports: withDesktopChannelLock, createDesktopPublicationRecord, wasDesktopAttemptPublished |
| `apps/desktop/scripts/desktop-publish-route.ts` | Validate a completed packaging attempt and route publication back to its original runner. — exports: resolveDesktopPublishRoute |
| `apps/desktop/scripts/desktop-publish-tag.ts` | Create immutable Desktop release tags using the explicitly supplied GitHub App installation token. — exports: publishDesktopTag |
| `apps/desktop/scripts/desktop-publish.ts` | Resume Desktop publication by reconciling object bytes before changing update feeds. — exports: DesktopPublishError, desktopArtifactDigest, publishDesktopRelease |
| `apps/desktop/scripts/desktop-release-environment.d.mts` | Environment variable that supplies the Electron application identifier. — exports: DESKTOP_APP_ID_ENV, MACOS_SIGNING_IDENTITY_ENV, MACOS_TEAM_ID_ENV, NPM_REGISTRY_ENV, resolveDesktopAppId, resolveNpmRegistry |
| `apps/desktop/scripts/desktop-release-environment.mjs` | Resolve public release identifiers supplied by the packaging environment. — exports: DESKTOP_APP_ID_ENV, MACOS_SIGNING_IDENTITY_ENV, MACOS_TEAM_ID_ENV, NPM_REGISTRY_ENV, resolveNpmRegistry, resolveDesktopAppId |
| `apps/desktop/scripts/desktop-release-store.ts` | Retain immutable Desktop build files outside disposable runner checkouts. — exports: retainedDesktopPath, retainDesktopRelease, verifyRetainedDesktopRelease |
| `apps/desktop/scripts/desktop-release-tag.ts` |  — exports: desktopReleaseTag, tagDesktopRelease |
| `apps/desktop/scripts/desktop-rollback.ts` | Restore historical update feeds without uploading binaries or moving release tags. — exports: rollbackDesktopChannel |
| `apps/desktop/scripts/desktop-toolchain-preflight.ts` |  — exports: probeDesktopToolchain, requireDesktopToolchain |
| `apps/desktop/scripts/desktop-upload-plan.ts` | Validate packaged Desktop update artifacts before any network upload begins. — exports: createDesktopUploadPlan |
| `apps/desktop/scripts/desktop-upload-run.ts` | Durable, credential-free evidence for test and production Desktop uploads. — exports: uploadDesktopRelease |
| `apps/desktop/scripts/dev.ts` | Build and launch the unpackaged Electron shell against the current workspace. |
| `apps/desktop/scripts/development-app.ts` | macOS development bundle that loads the current workspace through Electron. — exports: prepareDevelopmentApp, developmentLauncher |
| `apps/desktop/scripts/development-project.ts` | Prepare the disposable npm-project view used by an unpackaged Electron shell. — exports: prepareDevelopmentProject |
| `apps/desktop/scripts/electron-builder-config.d.mts` | Import the factory without evaluating an ordinary release configuration. |
| `apps/desktop/scripts/electron-builder-config.mjs` | import { officePackageDirectories } from '../../../scripts/libreoffice-packages.mjs' — exports: createElectronBuilderConfig |
| `apps/desktop/scripts/flock-entry.ts` | Load the POSIX flock entry on first use so packaging entry scripts start on a checkout that has not built `native/system`. — exports: createFlockEntryLoader, loadFlockEntry |
| `apps/desktop/scripts/installed-update-builder.ts` | Select isolated qualification inputs without weakening the ordinary Windows installer or signing hooks. — exports: createInstalledUpdateBuilderConfig |
| `apps/desktop/scripts/installed-update-cos.ts` | Fixed test-COS transport; callers authorize writes separately from local planning. — exports: createInstalledUpdateCos |
| `apps/desktop/scripts/installed-update-distribution.ts` | Validate local qualification payload bytes and prepare separate binary and fixed-feed operations. — exports: planInstalledUpdateDistribution |
| `apps/desktop/scripts/installed-update-identity.d.mts` | Configure per-run Electron data and journal paths before production imports. — exports: configureInstalledUpdateIdentity |
| `apps/desktop/scripts/installed-update-identity.mjs` | Configure only a qualification package's identity before the production main entry loads. — exports: configureInstalledUpdateIdentity |
| `apps/desktop/scripts/installed-update-network.ps1` | Operator-owned test-application fault. Status is read-only; Block and Restore require typed confirmation. |
| `apps/desktop/scripts/installed-update-package-content.ts` | Verify identity and update configuration from an extracted installer payload, not a neighboring unpacked build. — exports: verifyInstalledUpdatePackageContent |
| `apps/desktop/scripts/installed-update-packaging.ts` | Supervise one explicitly confirmed qualification build; checks never launch a child or clear a signing interlock. — exports: InstalledUpdateSigningHoldError, assertInstalledUpdateSigningClear, installedUpdatePackagingEnvironment, packageInstalledUpdate |
| `apps/desktop/scripts/installed-update-publication.ts` | Separate immutable qualification uploads from explicitly authorized fixed-feed publication. — exports: verifiedInstalledUpdateDistribution, executeInstalledUpdatePublication |
| `apps/desktop/scripts/installed-update-qualification.ts` | Local-only material allocation and journal inspection for operator-driven installed updates. — exports: createInstalledUpdateRun, readInstalledUpdateRun, inspectInstalledUpdateJournals, collectInstalledUpdateJournals |
| `apps/desktop/scripts/installed-update-signature.d.mts` | Hash a local file without executing it. @param path File path. @returns Base64 SHA-512. — exports: installedUpdateFileHash, verifyInstalledUpdateSignature |
| `apps/desktop/scripts/installed-update-signature.mjs` | Verify supplied executable files without invoking SignTool, private keys, or installer entry points. — exports: installedUpdateFileHash, verifyInstalledUpdateSignature |
| `apps/desktop/scripts/installer-directories.nsh` | !include "LogicLib.nsh" |
| `apps/desktop/scripts/installer.nsh` | !include "LogicLib.nsh" |
| `apps/desktop/scripts/jit-entitlements.plist` | <?xml version="1.0" encoding="UTF-8"?> |
| `apps/desktop/scripts/logged-notarytool.d.mts` | Separate upload and Apple processing timings without replacing electron-notarize's qualification. — exports: runLoggedNotarytool |
| `apps/desktop/scripts/logged-notarytool.mjs` | !/usr/bin/env node — exports: runLoggedNotarytool |
| `apps/desktop/scripts/macos-app-update-config.d.mts` | Resolved fields required to embed a macOS updater feed. — exports: resolveMacOSAppUpdateFeed, createMacOSAppUpdateConfig, writeMacOSAppUpdateConfig, verifyMacOSAppUpdateConfig |
| `apps/desktop/scripts/macos-app-update-config.mjs` | Write and verify the updater configuration sealed into a macOS application. — exports: resolveMacOSAppUpdateFeed, createMacOSAppUpdateConfig, writeMacOSAppUpdateConfig, verifyMacOSAppUpdateConfig |
| `apps/desktop/scripts/macos-cache-policy.ts` | Bind reusable thin Mach-O signatures to the actual certificate, tools, identifier, and entitlements. — exports: macOSCachePolicy |
| `apps/desktop/scripts/macos-entitlements.plist` | <?xml version="1.0" encoding="UTF-8"?> |
| `apps/desktop/scripts/macos-notarization-proxy.ts` | Temporarily route Apple tools through the active macOS service; retain recovery data before mutation. — exports: restoreMacOSNotarizationProxy, withMacOSNotarizationProxy |
| `apps/desktop/scripts/macos-package-settings.d.mts` | File-owned macOS packaging concurrency and stage-specific proxies. — exports: resolveMacOSPackageSettings, macOSDownloadEnvironment |
| `apps/desktop/scripts/macos-package-settings.mjs` | Resolve file-owned macOS packaging concurrency and stage-specific proxies. — exports: resolveMacOSPackageSettings, macOSDownloadEnvironment |
| `apps/desktop/scripts/macos-runner-service.sh` | !/bin/bash |
| `apps/desktop/scripts/macos-runtime.ts` | Sign final native runtime files before the enclosing Desktop application is signed. — exports: signMacOSRuntime |
| `apps/desktop/scripts/macos-signature-cache-directory.d.mts` | Optional machine-owned macOS signature storage. — exports: validateMacOSSignatureCacheDirectory, resolveMacOSSignatureCacheDirectory |
| `apps/desktop/scripts/macos-signature-cache-directory.mjs` | Resolve optional machine-owned macOS signature storage before signing begins. — exports: validateMacOSSignatureCacheDirectory, resolveMacOSSignatureCacheDirectory |
| `apps/desktop/scripts/macos-signature-cache.ts` | Reuse verified standalone signatures by file content and complete signing policy. — exports: cachedMacOSSignature, pruneMacOSSignatureCache |
| `apps/desktop/scripts/macos-signing-keychain.d.mts` | Own a temporary PKCS#12 signing identity for one macOS packaging invocation. — exports: withMacOSSigningKeychain |
| `apps/desktop/scripts/macos-signing-keychain.mjs` | Own a temporary PKCS#12 signing identity for one macOS packaging invocation. — exports: withMacOSSigningKeychain |
| `apps/desktop/scripts/manage-windows-signature-cache.mjs` | Explicit current-account migration and storage inspection under the signing-stage lock. |
| `apps/desktop/scripts/node-bin/node` | !/bin/sh |
| `apps/desktop/scripts/node-bin/node.cmd` | @echo off |
| `apps/desktop/scripts/node-x64-entitlements.plist` | <?xml version="1.0" encoding="UTF-8"?> |
| `apps/desktop/scripts/notarize-macos-disk-images.d.mts` | import type { NotarizeOptions } from '@electron/notarize' — exports: notarizeMacOSDiskImageArtifact |
| `apps/desktop/scripts/notarize-macos-disk-images.mjs` | Notarize and qualify macOS disk images after electron-builder creates them. — exports: notarizeMacOSDiskImageArtifact |
| `apps/desktop/scripts/notarize-macos.d.mts` | Notarize with separate upload and wait timings while preserving signature checks and stapling. — exports: notarizeMacOS |
| `apps/desktop/scripts/notarize-macos.mjs` | Preserve electron-notarize's signature checks and stapling while recording separate Apple phases. — exports: notarizeMacOS |
| `apps/desktop/scripts/package-installed-update.ts` | Operator-only signed packaging; default checks do not launch children, sign, install, or publish. |
| `apps/desktop/scripts/package-macos.ts` | Build the ZIP and DMG from separate signed application copies with overlapping notarization. — exports: packageMacOSArtifacts |
| `apps/desktop/scripts/package-target.ts` | Build one release target with matching Electron and dsh architecture. — exports: withoutWindowsSigningEnvironment, desktopElectronBuilderEnvironment, withoutDesktopUploadCredentials, resolveDesktopPackageTarget, parseDesktopPackageInvocation, desktopElectronBuilderArguments |
| `apps/desktop/scripts/packaging-run.d.mts` |  — exports: recordPackagingEvent, failPackagingRun, packagingOutputRedactor, createPackagingRun |
| `apps/desktop/scripts/packaging-run.mjs` | Persist redacted packaging evidence and terminate the owned stage tree on fatal signing failures. — exports: recordPackagingEvent, failPackagingRun, packagingOutputRedactor, createPackagingRun |
| `apps/desktop/scripts/packaging-step.d.mts` | Persist in-process and Apple-tool phases in the packaging journal. — exports: packagingStep, packagingErrorDetails |
| `apps/desktop/scripts/packaging-step.mjs` | Record in-process and Apple-tool phases in the same journal as packaging subprocesses. — exports: packagingStep, packagingErrorDetails |
| `apps/desktop/scripts/preflight-desktop-publish.d.mts` | Reject identifiable debugging artifacts before installing publication dependencies. — exports: preflightDesktopPublish |
| `apps/desktop/scripts/preflight-desktop-publish.mjs` | Reject identifiable debugging artifacts before installing publication dependencies. — exports: preflightDesktopPublish |
| `apps/desktop/scripts/prepare-cli.ts` | Package terminal launch scripts that reuse the installed Electron runtime. — exports: prepareDesktopCli |
| `apps/desktop/scripts/prepare-command-link.ts` | Build the macOS helper for exact-path command symlink installation. — exports: prepareCommandLink |
| `apps/desktop/scripts/prepare-dsh.ts` | Materialize the complete production runtime before publishing Desktop resources. |
| `apps/desktop/scripts/prepare-installed-update-application.ts` | Freeze the built main, preload, renderer, and bootstrap files shared by a qualification version pair. — exports: prepareInstalledUpdateApplication, verifyInstalledUpdateApplication |
| `apps/desktop/scripts/prepare-installed-update-bootstrap.ts` | Prepare immutable per-run bootstrap files without launching the application or loading credentials. — exports: prepareInstalledUpdateBootstrap |
| `apps/desktop/scripts/prepare-installed-update-network.ts` | Prepare one operator-owned firewall fault for an installed, independently verified qualification executable. — exports: prepareInstalledUpdateNetwork |
| `apps/desktop/scripts/prepare-installed-update-runtime.ts` | Copy a verified runtime into isolated, version-bound qualification resources without signing. — exports: prepareInstalledUpdateRuntime |
| `apps/desktop/scripts/prepare-installed-update.ts` | Allocate operator qualification materials or inspect journals; never signs, uploads, or installs. |
| `apps/desktop/scripts/prepare-macos-ci.mjs` | Validate machine-owned macOS signing settings and record a manual Actions build version. |
| `apps/desktop/scripts/prepare-package-set.ts` | Select and copy the local npm tarball closures that supply Desktop dsh and its private Host. — exports: selectDesktopPackageClosure, assertDesktopHostPackageFiles, prepareDesktopPackageSet |
| `apps/desktop/scripts/prepare-primary-runtime.ts` | Desktop resource locations and signing-aware verification for the shared runtime builder. — exports: preparePrimaryRuntime, smokePrimaryRuntime |
| `apps/desktop/scripts/prepare-runtime-manifests.ts` | Apply electron-builder's dependency metadata cleanup before sealing runtime bytes. — exports: prepareRuntimeManifests |
| `apps/desktop/scripts/prepare-runtime-patches.ts` | Stage explicitly selected Desktop patches without modifying the source workspace. — exports: prepareRuntimePatches, verifyRuntimePatches |
| `apps/desktop/scripts/prepare-runtime.ts` | Prepare Desktop resources and publish their versions after every preparation stage succeeds. |
| `apps/desktop/scripts/prepare-windows-ci.d.mts` | Resolve the version used by the manual Windows packaging workflow. — exports: windowsCiVersion |
| `apps/desktop/scripts/prepare-windows-ci.mjs` | Resolve a manual Windows build version and validate the selected machine preset. |
| `apps/desktop/scripts/prepare-windows-installer.ps1` | <# Compile the x86 DWM helper and raster assets embedded in the NSIS installer. #> |
| `apps/desktop/scripts/publish-desktop-ci.ts` | Publish a retained package selected by the preparation job; --check never reads secrets or contacts COS. — exports: prepareDesktopPublication |
| `apps/desktop/scripts/publish-installed-update.ts` | Operator entry for separate test binary uploads and fixed-feed publication; default mode is local-only. |
| `apps/desktop/scripts/read-desktop-app-key.mjs` | Hand a machine App key to the token action after Environment approval, masking before output. |
| `apps/desktop/scripts/render-tray-icon.ts` |  — exports: TRAY_ICON_SIZES, TRAY_ICON_PATHS, packIco, unpackIco, renderTrayIconEntries |
| `apps/desktop/scripts/resolve-desktop-publish-ci.ts` | Select an exact successful package attempt and its original runner without downloading installers. — exports: selectDesktopPackage, desktopPublishApi |
| `apps/desktop/scripts/resolve-retained-desktop-publish-ci.ts` | Resolve publication settings from the original machine's retained package before deployment approval. — exports: resolveRetainedDesktopPublication |
| `apps/desktop/scripts/retain-desktop-ci.ts` | Retain completed CI packages for later manual publication. — exports: desktopReleasesRoot, retainDesktopCi |
| `apps/desktop/scripts/rollback-desktop-channel.ts` | Manual channel restoration: read-only preview unless --execute is explicitly present. |
| `apps/desktop/scripts/run-windows-runner-task.ps1` | Repeating Task Scheduler triggers recover an exited launcher without relying on action exit-code retries. |
| `apps/desktop/scripts/runtime-file-policy.ts` | Desktop-only omissions from already installed production npm packages. — exports: desktopRuntimeFileExclusion |
| `apps/desktop/scripts/runtime-patch-policy.ts` | Desktop-specific selection of workspace and runtime-only dependency patches. — exports: DESKTOP_RUNTIME_PATCHES, DESKTOP_RUNTIME_DEPENDENCY_OVERRIDES |
| `apps/desktop/scripts/setup-macos-packaging.mjs` | Prepare private machine directories and templates without registering a runner or overwriting configuration. |
| `apps/desktop/scripts/setup-windows-packaging.ps1` | Prepare or inspect machine-owned Windows packaging directories without reading secret values. |
| `apps/desktop/scripts/sign-primary-runtime.ts` | Sign Windows runtime code before executing it, retaining vendor signatures and fail-stop hardware protection. — exports: signWindowsPrimaryRuntime, signWindowsDesktopRuntime |
| `apps/desktop/scripts/smoke-installer-directories.ps1` | Exercise the production NSIS directory transaction with private installation directories. |
| `apps/desktop/scripts/smoke-packaged-runtime.ts` | Validate the assembled application, including native Office conversion outside ASAR. |
| `apps/desktop/scripts/smoke-prepared-runtime.ts` | Check payloads and Host boot with private native-cache and Harness directories. — exports: smokePreparedRuntime |
| `apps/desktop/scripts/smoke-runtime.ts` | Boot the materialized target runtime without access to a user's Harness profile. — exports: smokeDesktopRuntime, apply, apply |
| `apps/desktop/scripts/smoke-windows.ps1` | Run NSIS directory and replacement checks against the prepared Windows target. |
| `apps/desktop/scripts/start-macos-packaging-runner.sh` | !/bin/bash |
| `apps/desktop/scripts/start-windows-packaging-runner.ps1` | Start the existing registered runner with explicit machine configuration and a scrubbed environment. |
| `apps/desktop/scripts/test-host-updates.ts` | Run built Desktop Host task protection in a private development profile without Electron or installation. |
| `apps/desktop/scripts/test-local-updater.mjs` | Run the built Desktop coordinator against real Electron downloads without installing software. |
| `apps/desktop/scripts/test-signed-updates.mjs` | Run real Electron downloads from local executable inputs without installing or publishing them. |
| `apps/desktop/scripts/test-windows-installer.mjs` | Builds an isolated native payload through the production NSIS configuration and exercises its UI. |
| `apps/desktop/scripts/test-windows-update-signature.mjs` | Real NSIS publisher verification against supplied files; never signs or executes an installer. |
| `apps/desktop/scripts/test-workspace-updates.ts` | Run the compiled Electron main entry in a private app with local update delivery and real Host IPC. |
| `apps/desktop/scripts/upload-target.ts` | Upload validated Desktop update artifacts or a fixed installer to Tencent COS. — exports: resolveCredentialUploadEnvironment, uploadDesktopTarget |
| `apps/desktop/scripts/upload-with-credentials.ps1` | requires -Version 5.1 |
| `apps/desktop/scripts/verify-installed-update-package.ts` | Verify signed installer bytes and extract their payload without running any installer or signing operation. — exports: validateInstalledUpdateArchivePaths, verifyInstalledUpdatePackage |
| `apps/desktop/scripts/verify-macos-signature.d.mts` | import type { MacOSSigningEnvironment } from './desktop-release-environment.mjs' — exports: assertMacOSSignatureDetails, assertMacOSRuntimeSignatureDetails, signMacOSRuntimeCode, verifyMacOSRuntimeCode, verifyMacOSSignature, verifyMacOSNotarizedApplication |
| `apps/desktop/scripts/verify-macos-signature.mjs` | Sign runtime code and verify that packaged macOS artifacts carry the company release identity. — exports: assertMacOSSignatureDetails, assertMacOSRuntimeSignatureDetails, signMacOSRuntimeCode, verifyMacOSRuntimeCode, verifyMacOSSignature, verifyMacOSNotarizedApplication |
| `apps/desktop/scripts/verify-published-windows.ps1` | Verify the existing installer; never sign or access the hardware token. |
| `apps/desktop/scripts/verify-retained-desktop.ts` | Recheck distribution signatures on retained installers without signing credentials. — exports: verifyRetainedDesktopSignatures |
| `apps/desktop/scripts/verify-runtime-archive.ts` | Verify runtime bytes and executable permissions using ASAR records and physical unpacked files. — exports: verifyRuntimeArchive |
| `apps/desktop/scripts/windows-asar-unpack.d.mts` | import type { BeforePackContext } from 'app-builder-lib' — exports: prepareWindowsAsarUnpack, verifyWindowsAsarUnpack |
| `apps/desktop/scripts/windows-asar-unpack.mjs` | Keep prepared Windows PE files outside ASAR without changing their sealed bytes. — exports: prepareWindowsAsarUnpack, verifyWindowsAsarUnpack |
| `apps/desktop/scripts/windows-directory-installer.d.mts` | Types for the pinned NSIS directory installation adapter. — exports: directoryInstallSection, directoryInstallerExits, directoryUninstaller, installWindowsDirectoryInstaller |
| `apps/desktop/scripts/windows-directory-installer.mjs` | Adapt the pinned NSIS template to stage and rename complete application directories. — exports: directoryInstallSection, directoryInstallerExits, installWindowsDirectoryInstaller, directoryUninstaller |
| `apps/desktop/scripts/windows-package-settings.d.mts` |  — exports: resolveWindowsPackageSettings |
| `apps/desktop/scripts/windows-package-settings.mjs` | Resolve file-owned Windows signature-cache concurrency before packaging starts. — exports: resolveWindowsPackageSettings |
| `apps/desktop/scripts/windows-runner-task.ps1` | Manage a registered packaging runner in the current user's interactive Windows session. |
| `apps/desktop/scripts/windows-runtime-signature.d.mts` | Public-key verification result; no hardware authentication is performed. — exports: inspectWindowsRuntimeSignature, preserveWindowsRuntimeSignature, windowsRuntimeCode, signWindowsCode, verifyWindowsCode |
| `apps/desktop/scripts/windows-runtime-signature.mjs` | Inspect runtime signatures and preserve byte-identical copies made by electron-builder. — exports: inspectWindowsRuntimeSignature, preserveWindowsRuntimeSignature, windowsRuntimeCode, signWindowsCode, verifyWindowsCode |
| `apps/desktop/scripts/windows-sign.cmd` | @echo off |
| `apps/desktop/scripts/windows-sign.d.mts` |  — exports: buildWindowsSigningEnvironment, resolveWindowsUpdatePublisher, createWindowsTokenSigner, scrubWindowsSigningEnvironment, createRedactedWindowsSigningError, repairDanglingAuthenticodeDirectory |
| `apps/desktop/scripts/windows-sign.mjs` | import { execFile } from 'node:child_process' — exports: scrubWindowsSigningEnvironment, resolveWindowsUpdatePublisher, createRedactedWindowsSigningError, buildWindowsSigningEnvironment, createWindowsTokenSigner, repairDanglingAuthenticodeDirectory |
| `apps/desktop/scripts/windows-signature-batch.d.mts` | import type { WindowsRuntimeSignature } from './windows-runtime-signature.mjs' — exports: parseSignatureRows, inspectSignaturesBatched |
| `apps/desktop/scripts/windows-signature-batch.mjs` | Bounded public-key verification batches; every output row must match its requested file. — exports: parseSignatureRows, inspectSignaturesBatched |
| `apps/desktop/scripts/windows-signature-cache-directory.d.mts` |  — exports: resolveWindowsSignatureCacheDirectory, prepareWindowsSignatureCacheDirectory |
| `apps/desktop/scripts/windows-signature-cache-directory.mjs` | Resolve and validate the current account's shared runtime-signature cache. — exports: resolveWindowsSignatureCacheDirectory, prepareWindowsSignatureCacheDirectory |
| `apps/desktop/scripts/windows-signature-cache-directory.ps1` | Validate account ownership before accessing cache contents; new caches receive a private DACL. |
| `apps/desktop/scripts/windows-signature-cache.d.mts` | import type { WindowsRuntimeSignature } from './windows-runtime-signature.mjs' — exports: signatureCacheIdentity, createCachedSigner, migrateSignatureCache, maintainSignatureCache |
| `apps/desktop/scripts/windows-signature-cache.mjs` | Cache complete signed files; corrupt entries stop the caller before hardware access. — exports: signatureCacheIdentity, migrateSignatureCache, maintainSignatureCache, createCachedSigner |
| `apps/desktop/scripts/windows-signing-preflight.ts` | Check the production signing path with one private probe before preparing release artifacts. — exports: preflightWindowsSigning |
| `apps/desktop/scripts/windows-signing-stage.d.mts` | Stage-wide ownership is independent of the retained hardware-attempt interlock. — exports: withWindowsSigningStage |
| `apps/desktop/scripts/windows-signing-stage.mjs` | Serialize complete signing and cache-maintenance stages without clearing hardware failure evidence. — exports: withWindowsSigningStage |
| `apps/desktop/scripts/windows-signing-state.d.mts` |  — exports: beginWindowsSigningAttempt |
| `apps/desktop/scripts/windows-signing-state.mjs` | Persist a per-user hardware-signing interlock; failures and interrupted attempts never unlock automatically. — exports: beginWindowsSigningAttempt |
| `apps/desktop/scripts/windows-timestamp.d.mts` | import type { WindowsRuntimeSignature } from './windows-runtime-signature.mjs' — exports: normalizeWindowsSignature, completeWindowsSignature |
| `apps/desktop/scripts/windows-timestamp.mjs` | Finish timestamps on isolated copies without repeating a verified private-key operation. — exports: normalizeWindowsSignature, completeWindowsSignature |

#### Test specs and end-to-end scenarios

| File | What the spec actually pins |
| --- | --- |
| `apps/desktop/tests/account-backend.spec.ts` | projects only safe account fields and refuses non-browser authorization schemes; accepts a no-response login failure without discarding the account projection; uses account Remote commands without returning additional wire fields; does not replay an expiry rea… |
| `apps/desktop/tests/acl-skill.built.e2e.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/backend-controller.spec.ts` | desktop backend controller; shares preparation and startup between concurrent retries; waits for pending preparation on close and never spawns afterward; stops a pending child once and waits for startup and child exit on close; publishes preparation errors and… |
| `apps/desktop/tests/background-notice.spec.ts` | keeps the window visible until confirmation and remembers acknowledgement across launches; keeps cancellation eligible for another close and never records it; does not hide or record a late acknowledgement after disposal; keeps acknowledgement in memory when i… |
| `apps/desktop/tests/cli-launcher.spec.ts` | preserves common arguments, cwd, environment, binary input, stderr and exit status |
| `apps/desktop/tests/client-metadata.spec.ts` | reports the inlined client build version and the requested language; refuses a build that carries no client version instead of guessing one |
| `apps/desktop/tests/command-installation.spec.ts` | installs and removes only its own link; preserves the raw target of an existing relative npm link and restores it; restores a regular executable with its bytes and permission bits; rejects a changed confirmation without moving the replacement; repairs a moved … |
| `apps/desktop/tests/command-management.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/command-manager-flow.spec.ts` | requires confirmation before replacing an existing command; passes the displayed fingerprint and reports a stale worker refusal; keeps confirmation when repairing a command shadowed by another installation; coalesces repeated menu clicks and keeps update prepa… |
| `apps/desktop/tests/command-path.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/core-package-set.spec.ts` | desktop core package set; pins the direct dsh dependency and every internal package to local tarballs; rejects version drift, descriptor disorder, corruption, and extra files; rejects registry resolutions for names supplied by the local package set |
| `apps/desktop/tests/cos-operation.spec.ts` | COS operation total deadlines; aborts a stalled versioning retry within the original operation budget; aborts an active download despite ongoing data and closes its request; aborts a PUT awaiting confirmation without resending the object; clears the deadline a… |
| `apps/desktop/tests/crash-report.spec.ts` | names files by sortable time and source; renders the facts header, the inspected error with its properties and cause, and the renderer console; prints the Host diagnostic verbatim in its own section when the Host reported one; says so when no renderer console … |
| `apps/desktop/tests/desktop-auto-update-environment.spec.ts` | desktop auto-update environment; defaults packages and uploads to the test deployment; requires the selected deployment origin for packages and bucket only for uploads; rejects a test download URL that is not an HTTPS origin; rejects unknown deployments and ta… |
| `apps/desktop/tests/desktop-build-commit.spec.ts` | desktop build commit; reads nothing outside a packaging run; round-trips a commit and its tree state through a child environment; rejects a tree state that is neither 0 nor 1; reads the checkout this repository is in |
| `apps/desktop/tests/desktop-build-paths.spec.ts` | desktop build paths; isolates every mutable build directory by complete target; shares only the immutable upstream download cache; resolves the development primary runtime from the build target rather than the host architecture; maps every target to the platfo… |
| `apps/desktop/tests/desktop-build-version-discovery.spec.ts` | desktop build version discovery; formats the date segment in the build host time zone; starts at one when nothing is taken; numbers a stable product version under the documented test prerelease; numbers after the highest local artifact for the same date |
| `apps/desktop/tests/desktop-build-version.spec.ts` | desktop build version; publishes the product version when no build version is present; accepts the documented test form on a stable base; normalizes what the artifacts carry, so validation and publication agree; rejects build metadata, which does not affect up… |
| `apps/desktop/tests/desktop-bundle-imports.spec.ts` | desktop bundle imports; names the package behind a bare specifier; tells external specifiers from bundled and virtual module ids; accepts Node builtins and packaged dependencies, including their subpaths, for the main process; rejects Node builtins outside the… |
| `apps/desktop/tests/desktop-cli.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/desktop-package-environment.spec.ts` | Desktop local packaging configuration; selects macOS local defaults while excluding inherited release settings and retaining build networking; takes cache concurrency from the Windows file and defaults to four without ambient overrides; selects the platform fi… |
| `apps/desktop/tests/desktop-package-selection.spec.ts` | pins the latest successful attempt and finds the package job across pages; routes a Windows package through its own configured machine target; selects an explicit old attempt without consulting the latest attempt; resolves an old locally retained package with … |
| `apps/desktop/tests/desktop-policy-environment.spec.ts` | requires only the selected origin, defaults to test, and accepts explicit page restrictions; rejects login origins in production |
| `apps/desktop/tests/desktop-publication-failure.spec.ts` | preserves actionable validation and filesystem diagnostics; does not retain provider bodies, unknown messages, JSON input or invalid field contents; prints rollback usage through the real CLI before any audit or remote operation; omits malformed provider recei… |
| `apps/desktop/tests/desktop-publication-preflight.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/desktop-publication-summary.spec.ts` | shows production destinations and tag after approval with upload-byte fingerprints; escapes runner display text without adding Markdown rows or HTML elements; fails instead of rendering success when an upload file cannot be read |
| `apps/desktop/tests/desktop-publish-config.spec.ts` | reads public settings without opening the absent credential file and requires production App settings; does not include malformed credential contents in errors; rejects multiline App outputs before writing Actions output fields |
| `apps/desktop/tests/desktop-publish-cos.spec.ts` | uses overwrite prevention, streams verified bytes, and hashes remote readback through the SDK; propagates an oversized channel stream error through the SDK and closes the request |
| `apps/desktop/tests/desktop-publish-preflight.spec.ts` | rejects malformed input before contacting GitHub |
| `apps/desktop/tests/desktop-publish-record.spec.ts` | excludes another process while a channel lock is held and admits it after release; excludes overlapping writers of one channel but permits independent channels and releases after failure; persists intent, before/after bytes and terminal state outside the check… |
| `apps/desktop/tests/desktop-publish-route.spec.ts` | routes the exact successful attempt to its registered machine; fails closed when a publishing route or its unique label is missing; keeps the packaged source separate from the workflow commit; accepts a retained package that did not request publication during … |
| `apps/desktop/tests/desktop-publish-tag.spec.ts` | tags the packaged commit using explicit App authentication; does not write when the same release tag already exists; rejects a conflicting tag without updating or deleting it; reconciles a create race between two platform releases; does not reinterpret authori… |
| `apps/desktop/tests/desktop-publish.spec.ts` | uploads files before the feed and skips identical bytes on a repeat invocation; recovers an ambiguous binary write without repeating it or publishing the feed early; reports published but tag pending and retries only the tag; rejects a files-only plan and a pr… |
| `apps/desktop/tests/desktop-release-store.spec.ts` | retains independent attempts after source removal and rejects replacing an existing attempt; detects changed bytes even when file length is unchanged; does not expose an incomplete copy and releases its claim after failure; permits only one writer for a concur… |
| `apps/desktop/tests/desktop-release-tag.spec.ts` | desktop release tag; names a tag distinct from the npm family tags; creates and pushes a tag for the packaged commit; pushes an existing tag that already names the uploaded commit; refuses to move a tag that names another commit |
| `apps/desktop/tests/desktop-rollback.spec.ts` | previews the exact YAML change without writes; only restores the YAML after checking the historical binary; restores nightly when latest already matches and resumes a partially restored pair |
| `apps/desktop/tests/desktop-upload-plan.spec.ts` | desktop upload plan; uploads only the selected latest installer to each deployment using the existing COS transport; allows an explicitly selected production prerelease at the fixed installer URL; publishes fixed feeds referencing versioned binaries without ov… |
| `apps/desktop/tests/desktop-upload-run.spec.ts` | release upload audit with the real COS SDK and an isolated loopback origin; cannot repeat the write when a client leaves every SDK retry option at its default; refuses networking when the audit parent cannot be created; stops before the next PUT when a respons… |
| `apps/desktop/tests/development-app.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/development-project.spec.ts` | desktop development project; includes declared workspace packages missing from the hoist directory in the runtime inventory; manages development plugins without modifying the linked workspace packages; rejects a CLI package from another release |
| `apps/desktop/tests/device-info.spec.ts` | reports fractional memory in GiB rounded to one decimal; omits a field whose source is absent instead of failing the whole description; omits the fields whose sources throw and keeps the rest |
| `apps/desktop/tests/directory-picker.spec.ts` | Desktop directory picker; restores and focuses the parent window and shares an unanswered dialog; releases a failed dialog so the user can retry; discards the selected path after the parent is destroyed; rejects other windows, subframes, shell pages, remote pa… |
| `apps/desktop/tests/fatal-recovery.spec.ts` | locks the first report before the dialog settles and never resets after an action; reports a user-requested disable failure and allows exit without restarting; allows exit after shutdown cleanup fails; keeps the report line inside the detail budget when the er… |
| `apps/desktop/tests/flock-entry.spec.ts` | returns the imported entry without building and memoizes it; builds once and imports again when the JavaScript entry is missing; builds when the entry imports but the host addon binary is missing; propagates other import errors without building; propagates a b… |
| `apps/desktop/tests/host-process.spec.ts` | desktop host process; correlates task inspections and admission changes over private IPC; correlates quit inspections with task requests and fails an unanswered one at its own deadline; returns the Web authentication URL and waits for graceful shutdown; passes… |
| `apps/desktop/tests/host-update-tasks.spec.ts` | Desktop Host update task protection; does not warn for reads but drains admitted requests before completing the lock; detects task creation by an admitted write before handing off the lock; releases request accounting when the bridge rejects; removes admission… |
| `apps/desktop/tests/installed-update-bootstrap.spec.ts` | installed-update bootstrap; executes the generated entry for both versions with isolated persistent paths before main imports; refuses foreign metadata before creating any data directory or changing the environment; loads the original manifest without adding c… |
| `apps/desktop/tests/installed-update-builder.spec.ts` | installed-update application inputs and builder configuration; freezes shipped files once without copying credentials or claiming dependency and boot qualification; keeps signed NSIS hooks and one isolated identity/feed while selecting each private runtime and… |
| `apps/desktop/tests/installed-update-cos.spec.ts` | qualification COS transport with real SDK serialization over a loopback origin; sends one streamed PUT with explicit length, MD5, no-store policy and a signed non-overwrite header; streams a file-backed object with its declared length; does not retry an uncert… |
| `apps/desktop/tests/installed-update-distribution.spec.ts` | qualification distribution file planning; keeps two binary sets separate from successive bodies at one fixed feed URL without publication authority |
| `apps/desktop/tests/installed-update-network.spec.ts` | installed update network plan; binds an exclusive local plan to verified original application bytes without network changes |
| `apps/desktop/tests/installed-update-package-content.spec.ts` | installed update archive contents; rejects an updater package whose version differs from the verifier; accepts only the builder transformation of runtime dependency manifests; identifies changed executable resources for separate signature verification; install… |
| `apps/desktop/tests/installed-update-packaging.spec.ts` | operator-driven packaging entry; refuses the interlock before loading credentials, confirmation, or child allocation and preserves it byte-for-byte; strips unrelated secrets and preload overrides while retaining signing inputs and the Windows archive filter; c… |
| `apps/desktop/tests/installed-update-publication.spec.ts` | qualification publication sequencing; uploads without advertising, publishes version 1, then requires version 1 startup before publishing version 2; rechecks matching immutable objects on a separately requested upload without rewriting them |
| `apps/desktop/tests/installed-update-qualification.spec.ts` | installed-update qualification materials; allocates independent test-only namespaces and does not produce packages or overwrite an earlier manifest; rejects an invalid source commit before allocating material; reads real journal output while keeping observed f… |
| `apps/desktop/tests/installed-update-runtime.spec.ts` | installed-update runtime preparation; retags only release-owned packages and dependencies while preserving source and third-party versions; stops after a failed version and retains partial materials without a completion receipt; rejects stale or damaged prepar… |
| `apps/desktop/tests/installed-update-signature.spec.ts` | installed update read-only signature evidence; hashes actual bytes using the feed algorithm |
| `apps/desktop/tests/installer-packaging.spec.ts` | installer preparation preserves application dependencies; names unsigned Windows artifacts so they cannot pass for release builds; packages every preload entry point the shell loads |
| `apps/desktop/tests/keybindings.spec.ts` | persists into the supplied userData, reloads null bindings, and retains original future-version bytes |
| `apps/desktop/tests/keyboard.spec.ts` | mirrors only successful bindings, suppresses recording menus, and invalidates pre-navigation drafts; blocks macOS shortcuts while an update overlay loads and clears held and consumed keys before dismissal; rejects other windows, subframes, remote/shell pages, … |
| `apps/desktop/tests/locale.spec.ts` | desktop locale dictionaries; ships the same key set in English and Chinese; formats named values without consuming unknown placeholders; prefers an explicit supported choice, then the first supported system language |
| `apps/desktop/tests/logged-notarytool-exit.spec.ts` | passes Apple rejection JSON from a nonzero wait exit back to electron-notarize for diagnostic retrieval; does not treat failed upload output as a completed submission |
| `apps/desktop/tests/logged-notarytool.spec.ts` | finishes submission before starting wait and records the ID and separate timings; records a redacted upload error without starting wait; rejects missing submission IDs and mismatched wait results; retains redacted Apple diagnostics and passes the original resu… |
| `apps/desktop/tests/login-shell-environment.spec.ts` | resolveDesktopLoginShellConfig; defaults to ten seconds and accepts an override; loginShellCandidates; uses only system shells when the account record is unreadable; parseLoginShellOutput |
| `apps/desktop/tests/macos-app-update-config.spec.ts` | macOS packaged updater configuration; uses the final generic Nightly provider configured for the build; writes and verifies the fixed release feed before signing; rejects another updater cache directory when the signed value is known; seals latest into the mac… |
| `apps/desktop/tests/macos-cache-policy.spec.ts` | accepts only a signature matching the resolved policy; includes certificate, identifier and entitlement contents in the cache policy |
| `apps/desktop/tests/macos-disk-image-signature.spec.ts` | verifies an unnotarized DMG signature and identity without invoking Apple notarization tools; rejects an unnotarized DMG signed by another team; rejects a corrupt unnotarized DMG before inspecting its identity; still requires a stapled ticket and Gatekeeper ac… |
| `apps/desktop/tests/macos-notarization-proxy.spec.ts` | preserves the network when no Apple proxy is configured; retains an empty-proxy recovery record after failed disabling and retries it; keeps the recovery record when disabling an originally empty proxy has no effect; does not steal a live lock and holds the pr… |
| `apps/desktop/tests/macos-notarized-application.spec.ts` | notarized application qualification |
| `apps/desktop/tests/macos-package-preset.spec.ts` | loads machine signing credentials independently of the checkout and rejects misplaced settings; records debugging artifact paths only for an explicit CI selection without notarization credentials |
| `apps/desktop/tests/macos-package-settings.spec.ts` | defaults to four workers and keeps download and Apple proxies independent; overrides conflicting child proxy variables while preserving the parent and unrelated settings |
| `apps/desktop/tests/macos-runtime.spec.ts` | signs Mach-O files in their final locations and verifies each signature; awaits other signers before rejecting and permitting output cleanup |
| `apps/desktop/tests/macos-signature-cache-directory.spec.ts` | retains target-local storage only when the setting is absent; rejects missing, non-directory, linked and non-private storage without repairing it; restores a verified signature after removing and recreating the checkout |
| `apps/desktop/tests/macos-signature-cache.spec.ts` | reuses verified bytes without sharing mutable cache storage; never publishes or replaces input after signing fails; rejects a concurrently changed target; rejects candidate mutation during verification |
| `apps/desktop/tests/macos-signature.spec.ts` | desktop macOS release signature; loads release identifiers from the environment and requires code signing; accepts LZMA DMGs through builder validation while rejecting unknown formats; seals PAK resources with their enclosing bundle while signing executable co… |
| `apps/desktop/tests/macos-signing-keychain.spec.ts` | temporary macOS signing identity; scopes signing to the imported identity and removes credentials before invoking the build; allocates distinct keychains for overlapping invocations |
| `apps/desktop/tests/macos-signing-walk.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/main-startup.spec.ts` | desktop main startup; starts the Host with authentication popups disabled when local settings are invalid; routes shell update documents and assets through the registered main protocol handler; serves shell dialogs and their assets without forwarding them to t… |
| `apps/desktop/tests/mandatory-update-policy.spec.ts` | mandatory update policy; retains a known block through test authentication expiry and rejects 422 as a policy decision; does not enable authentication from a gateway response in anonymous mode; sends an anonymous independent request with installed release head… |
| `apps/desktop/tests/mandatory-update-window.spec.ts` | releases IPC after the Windows main window has already been destroyed; waits for a version-bound second click in the same modal and rejects obsolete or hidden responses; defers without dismissing, and cancels pending approval on policy clearance or disposal; o… |
| `apps/desktop/tests/microphone-permissions.spec.ts` | allows only audio checks from the owned primary application frame; requests macOS microphone access and reports operating-system rejection |
| `apps/desktop/tests/node-environment.spec.ts` | keeps private Desktop launchers out of the Host environment inherited by PTC; provides private launchers only to package installation processes |
| `apps/desktop/tests/owned-directory.spec.ts` | removes nested files and directories while preserving unknown directory-link targets; ignores a missing root and refuses to delete a regular-file root |
| `apps/desktop/tests/package-macos.spec.ts` | parallel macOS artifacts; collects both failures after both lanes release their copies and publishes neither payload; passes the actual App and isolated output directory to each single-target builder |
| `apps/desktop/tests/package-target-errors.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/package-target-stages.spec.ts` | requires one signing preflight before building, then records only the complete release; initializes shared storage only after acquiring the preflight stage lock; checks the assembled macOS runtime before notarizing and recording the release; fails unsigned mac… |
| `apps/desktop/tests/package-target.spec.ts` | desktop package target; selects matching runtime and electron-builder architectures; allows an Apple Silicon host to build the Intel target through Rosetta; rejects unsupported targets and hosts before building; parses installer and unpacked-directory invocati… |
| `apps/desktop/tests/packaged-runtime-verification.spec.ts` | packaged runtime verification; requires the product version when the target tree supplies the runtime; requires the version installed-update qualification wrote into its private runtime; does not let a build version change what the bundled runtime must declare |
| `apps/desktop/tests/packaging-run.spec.ts` | packaging run records; redacts credential values across every byte split; retains redacted output and prevents a later stage after a failed child; kills the stage and its descendant on a fatal marker before either exits voluntarily; fails closed when the outpu… |
| `apps/desktop/tests/packaging-step.spec.ts` | retains nested failures without credentials and includes the restored proxy in the final summary; preserves unrecorded callers and records successful return values without persisting them |
| `apps/desktop/tests/platform-preload.e2e.ts` | provides a synchronous getter immediately after exactly one bootstrap IPC; does not expose the credential bridge to subframes; rejects a mismatched issuer before exposing credentials; fails closed when the main process rejects bootstrap; exposes no bridge when… |
| `apps/desktop/tests/platform-storage.e2e.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/platform-view.spec.ts` | bootstraps only the owned main frame and never puts the token in a URL; destroys old documents on sign-out or credential replacement; keeps the view when the Platform document replaces its own URL during the first load; blocks cross-origin navigation and redir… |
| `apps/desktop/tests/policy-login-loading.spec.ts` | renders the login placeholder label from the main-process query; leaves the label empty when no query supplies one |
| `apps/desktop/tests/policy-test-auth.spec.ts` | shares an isolated memory Session with policy fetches, without opening a login automatically; opens a sandboxed window on explicit action and coalesces logins without authorizing an update; opens only the Feishu login window DevTools on a single F12 keydown; s… |
| `apps/desktop/tests/preload-app.spec.ts` | reads only native login API-key presence through the onboarding bridge; exposes onboarding size activation to the application document; limits product documents to update status and a native confirmation action; reads the local machine description only from th… |
| `apps/desktop/tests/preload-mandatory-overlay.spec.ts` | uses an in-page frame below the caption and reuses it on updates; rejects forged window events and accepts actions only through the transferred private port; keeps caption menu keyboard events available while blocking background shortcuts; clears once without … |
| `apps/desktop/tests/preload-menu.client.spec.ts` | keeps caption menus absent until the application frame replaces loading; does not mount menus after a loading document is disposed; localizes caption entries and removes the menu on disposal; opens native menus without stealing pointer focus and resets popup s… |
| `apps/desktop/tests/preload-platform.client.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/preload-theme.client.spec.ts` | defers observation until the document root exists |
| `apps/desktop/tests/preload-windows.client.spec.ts` | synchronizes live language and palette changes and stops observing a closed document |
| `apps/desktop/tests/preload.e2e.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/prepare-package-set.spec.ts` | desktop package-set selection; does not select a packaging target when imported as a library; includes only the available internal production closure; leaves independently published Office packages to npm resolution; requires both Desktop Host and public CLI e… |
| `apps/desktop/tests/prepare-runtime-patches.spec.ts` | classifies the current workspace and shares only runtime patch bytes; does not infer version overrides from selected patches; supports an independent runtime patch for a package also patched in the workspace; rejects shared bytes that differ from the workspace… |
| `apps/desktop/tests/prepare-windows-ci.spec.ts` | manual Windows CI version; uses the selected product prefix and UTC run identity; resolves the selected version policy independently of the update channel |
| `apps/desktop/tests/prepared-runtime-smoke.spec.ts` | retains payload progress and termination details when the child fails; smokes an x64 target verified on an arm64 build host without revalidating against the host |
| `apps/desktop/tests/primary-runtime-preparation.spec.ts` | rejects a Python-only native Desktop payload before executing interpreters |
| `apps/desktop/tests/primary-runtime-signing.spec.ts` | bounds overlapping cache restores and verifies all hits before serial hardware misses; selects real PE code, including .node, without signing foreign native modules or data; refuses malformed executables and root or nested directory links; retains vendor signa… |
| `apps/desktop/tests/profile-mcp.spec.ts` | retains one shared resource consumer in the Desktop Web profile |
| `apps/desktop/tests/project-manager.spec.ts` | desktop external plugin profile; preserves installed packages, profile state, and the lockfile when preparing a launch; reuses plugin files without scanning manifests and can disable them; disables every third-party bundle without reading a broken plugin patch… |
| `apps/desktop/tests/ptc-runtime.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/quit-confirmation.spec.ts` | quit prompt selection; DesktopQuitConfirmation; quits silently when nothing is running and no Host is ready; shows the macOS alert with the warning icon, Chinese copy, and Quit as the default right-hand button; shows the Windows task dialog with the applicatio… |
| `apps/desktop/tests/read-desktop-app-key.spec.ts` | masks multiline key bytes and passes the exact fixture to the token action without a shell |
| `apps/desktop/tests/retain-desktop-ci.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/runtime-file-policy.spec.ts` | omits development artifacts while preserving executable modules, assets and license files; applies package-specific rules inside scoped and nested dependency containers; retains native prebuilds for the selected macOS architecture |
| `apps/desktop/tests/runtime-manifests.spec.ts` | seals dependency metadata that remains unchanged by archive preparation |
| `apps/desktop/tests/runtime-preparation.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/runtime-tree-read-failure.spec.ts` | drains outstanding reads before rejecting and stops scheduling after a read failure |
| `apps/desktop/tests/runtime-tree.spec.ts` | verifies a runtime after relocation without depending on build paths; rejects filesystem links and incompatible targets; reads file inventory records unchanged during startup; checks the bundled version only during build verification; rejects a descriptor that… |
| `apps/desktop/tests/settings.spec.ts` | creates a discoverable default file on first launch without touching other preferences; loads explicit opt-in and opt-out on the next read without changing an earlier process snapshot; reports filesystem errors instead of replacing unreadable settings; continu… |
| `apps/desktop/tests/shell-file-selection.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/single-instance.spec.ts` | desktop single-instance ownership; quits a second process without registering lifecycle work; routes a later launch to the primary process |
| `apps/desktop/tests/tray-icon.spec.ts` | tray icon packaging; packs PNG entries into a Vista-style ICO directory and reads them back; rejects bitmaps that disagree with their declared edge, oversized edges, and non-PNG data; ships one crisp bitmap per supported display scale in the committed tray ico… |
| `apps/desktop/tests/tray.spec.ts` | shows the application icon with its name as the tooltip and an Open / Quit menu; opens the window on a single click and routes menu entries to the open and quit actions; relabels the menu in the current locale and ignores relabel after disposal |
| `apps/desktop/tests/update-attention.spec.ts` | clears on focus and ignores stale clicks, even after deferral and another background switch; does not notify foreground readiness and does not require notification support; keeps icon attention when the system rejects a notification |
| `apps/desktop/tests/update-channel.spec.ts` | reads the installed channel independently from the current version |
| `apps/desktop/tests/update-coordinator.spec.ts` | desktop release metadata; accepts one exact release identity for Electron and dsh; rejects invalid versions and unsupported host protocols; desktop update coordinator; keeps safe preparation diagnostics separate and clears them on an explicit retry |
| `apps/desktop/tests/update-dialog.spec.ts` | accepts only a displayed choice from its own main frame and retains cancellation outside the button list; releases visible Windows modality before destroying a dismissed dialog; follows the parent geometry and removes listeners when closed or replaced; cancels… |
| `apps/desktop/tests/update-error-renderer.spec.ts` | keeps mandatory diagnostics expandable without clearing the block or authorizing installation; uses client copy and retry when optional policy fields are absent; uses the same modal for download, verification, inspected confirmation and task-aware restart; rev… |
| `apps/desktop/tests/update-http-executor.spec.ts` | Electron updater inactivity deadline; aborts a request that never receives headers without waiting for a Node socket event; refreshes the deadline on actual response bytes rather than timing out a long active download; keeps waiting for headers after Electron … |
| `apps/desktop/tests/update-journal.spec.ts` | desktop qualification update journal; keeps both versions in separate files in the shared evidence directory; drops detailed errors and unexpected fields instead of trying to redact arbitrary text; refuses relative evidence paths and reports storage failure |
| `apps/desktop/tests/update-overlay.spec.ts` | restores a ready overlay each time its parent is shown and releases visibility ownership on close; waits for both a visible parent and a ready document, in either order; does not show or change parent styles when closed before its document is ready; releases a… |
| `apps/desktop/tests/update-presentation.spec.ts` | keeps the Electron preload assignable to the product consumer; records visible ordinary-update states without authorizing downloads or installation; keeps raw diagnostics out of error tooltips in both locales |
| `apps/desktop/tests/update-schedule.spec.ts` | ordinary update polling; checks immediately, doubles failed delays up to the cap, and resets after success; starts the delay at completion and joins a manual caller without hiding its failure; ignores wall-clock changes and lets policy arrival bypass the autom… |
| `apps/desktop/tests/upload-target.spec.ts` | desktop upload command |
| `apps/desktop/tests/upload-with-credentials.spec.ts` | credential launcher destination; uses decrypted credentials only for the matching packaged deployment and bucket; rejects child credentials that do not match the explicit launcher selection |
| `apps/desktop/tests/web-document.spec.ts` | serves the Web entry and assets without starting or contacting a Host; requires the Host authentication exchange and retains only its cookie value; forwards upload bytes and cancellation with Host credentials while keeping the response streaming; drops connect… |
| `apps/desktop/tests/welcome-flow.e2e.ts` | persists explicit API keys and browser account login independently across Host restarts |
| `apps/desktop/tests/welcome-host.spec.ts` | desktop welcome Web operations; authenticates through Web and stores only through the configured credential reference; reads the explicit language preference and recognizes another provider key; reads language without querying account or model providers; allow… |
| `apps/desktop/tests/welcome-renderer.client.spec.tsx` | desktop welcome presentation; sends one trimmed key, prevents competing actions, and clears it after saving; retains an unsaved draft and allows retry after a refused save; skips without saving and starts a fresh renderer at the entry again; returns to the ent… |
| `apps/desktop/tests/welcome-startup.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/welcome-window.spec.ts` | desktop welcome window; waits for its local document and blocks renderer navigation; destroys a window whose document fails to load; does not show a window closed while its document was loading; accepts actions only from its own top frame and removes handlers … |
| `apps/desktop/tests/windows-asar-unpack.spec.ts` | rejects an inline PE even when a neighboring unpacked copy exists; registers external staging cleanup before a configuration rewrite fails; verifies archived bytes against the preparation descriptor |
| `apps/desktop/tests/windows-cli-signals.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/windows-directory-installer.spec.ts` | keeps data cleanup out of the upstream template while retaining application removal and registration cleanup; stages before stopping the application and promotes before registering the installation |
| `apps/desktop/tests/windows-package-preset.spec.ts` | loads unsigned public settings without requiring the signing secret file or personal dotenv; resolves signing file paths relative to the secret file and rejects public overrides there; preserves the selected preset when Windows environment enumeration uses low… |
| `apps/desktop/tests/windows-pty-exit.spec.ts` | Harness-level scenario runner; see the file for its scenario list. |
| `apps/desktop/tests/windows-sign.spec.ts` | Windows token signing; preserves verified copies without hardware and rejects the entire queue after preservation failure; stops concurrent and subsequent signing tasks after a PIN failure; passes only the validated BAT fields to the signing command interprete… |
| `apps/desktop/tests/windows-signature-batch.spec.ts` | each row retains its own signature status; stderr rejects otherwise complete output; empty input launches no verifier and returns no rows |
| `apps/desktop/tests/windows-signature-cache-directory.spec.ts` | accepts an explicit local cache directory |
| `apps/desktop/tests/windows-signature-cache.spec.ts` | restore misses leave inputs and hardware untouched, then share a cached payload across targets; unchanged bytes restored in another file avoid another hardware call; cache summaries distinguish avoided signatures from actual signing attempts; restores cached s… |
| `apps/desktop/tests/windows-signing-preflight.spec.ts` | compiles one new probe and verifies one production-format signature before success |
| `apps/desktop/tests/windows-signing-stage.spec.ts` | independent signing stages wait and recheck the cache before accessing hardware; an interrupted holder releases only the stage lock and retains hardware failure evidence; a failed stage releases its handle before another process enters; accepts a state directo… |
| `apps/desktop/tests/windows-signing-state.spec.ts` | persistent Windows signing interlock; admits one independent process and retains its slot after that process exits; releases only successful attempts and records both operations before completion; refuses hardware entry without an existing supervised run |
| `apps/desktop/tests/windows-timestamp.spec.ts` | a failed timestamp cannot contaminate the next input or repeat hardware signing; exhausted timestamp attempts retain evidence and leave the original untouched; retains staging when failure evidence cannot be stored; uses short tool paths for deeply nested targ… |
| `apps/desktop/tests/windows-update-publisher.spec.ts` | Windows update publisher; preserves organization identity and escapes DN delimiters using the updater parser |

#### Golden fixtures — `apps/desktop/tests/expected/*` (52 files)

These are the **expected-output** side of the Desktop test suite: the exact bytes the shell must produce. They are the closest thing in this repo to a "golden file" contract for user-visible text, and they are the single best idea in the shard for August Trading.

| File | What it pins |
| --- | --- |
| `apps/desktop/tests/expected/about-panel.json` | The About panel's menu items and options for darwin/win32 × en-US/zh-CN — including that Windows has **no** `role: 'about'` (it gets a plain label) and that `version` is deliberately empty. |
| `apps/desktop/tests/expected/application-menu-en-US.json` | The English application menu's exact item order and labels: Check for Updates → Manage dsh Command → Hide / Hide Others / Show All → Quit. |
| `apps/desktop/tests/expected/application-menu-zh-CN.json` | The Chinese application menu's item order and labels — the same six items, localized (检查更新… / 管理 dsh 命令… / 隐藏 / 隐藏其他 / 显示全部 / 退出). |
| `apps/desktop/tests/expected/background-close-confirmation.json` | The first-hide notice's message, its single button, and that the detail is hidden. |
| `apps/desktop/tests/expected/command-management-darwin-en-US.json` | The five macOS command-management dialogs in English: not-installed, installed, broken, **shadowed by another dsh** (a `warning` type with an extra paragraph), and **selection unknown** (the shell could not verify which `dsh` the user's shell would run). The button triples and `defaultId`/`cancelId` are pinned. |
| `apps/desktop/tests/expected/command-management-darwin-zh-CN.json` | The same five macOS dialogs in Chinese, including the localized shadowing warning and the localized "selection unknown" paragraph. |
| `apps/desktop/tests/expected/command-management-win32-en-US.json` | The same five dialogs for the Windows command location (`…\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`) and the Windows shadowing case (a `dsh.cmd` under `C:\Program Files\nodejs`). |
| `apps/desktop/tests/expected/command-management-win32-zh-CN.json` | The Windows variant of the same five dialogs in Chinese. |
| `apps/desktop/tests/expected/command-repair-en-US.json` | The English repair flow's two dialogs: the tri-button state (Close / Repair / Remove) and the single-button completion. |
| `apps/desktop/tests/expected/command-repair-zh-CN.json` | The Chinese repair flow's two dialogs (关闭 / 修复 / 移除, then 关闭). |
| `apps/desktop/tests/expected/cos-GetObject-denied.json` | The **safe** failure record for a denied COS *read*: a fixed phase, the SDK code, the operation (`GetObject`), a request id, the HTTP status 403, and a remediation sentence naming the exact `name/cos:GetObject` permission. No provider body, no credential. |
| `apps/desktop/tests/expected/cos-PutObject-denied.json` | The same record for a denied COS *write* (`PutObject`, `name/cos:PutObject`). |
| `apps/desktop/tests/expected/desktop-upload-audit.txt` | The upload audit's event vocabulary: `upload-start`, `put-intent`, `put-confirmed`, `upload-complete`. |
| `apps/desktop/tests/expected/fatal-address-in-use-en.txt` | The English fatal dialog for `EADDRINUSE`: a different explanation ("Another DSH instance … is running") and only two buttons (Exit / Restart) — no "disable plugins". |
| `apps/desktop/tests/expected/fatal-address-in-use-zh-CN.txt` | The Chinese `EADDRINUSE` dialog with the same two-button shape. |
| `apps/desktop/tests/expected/fatal-dialog-en.txt` | The English generic fatal dialog's exact lines, including the "Your tasks are stored separately." promise and the three-button set (Exit / Restart / Disable third-party plugins). |
| `apps/desktop/tests/expected/fatal-dialog-zh-CN.txt` | The Chinese generic fatal dialog's exact lines, including the localized "任务数据存储在独立位置" (tasks are stored separately) promise. |
| `apps/desktop/tests/expected/fatal-dialog-with-report-en.txt` | The English fatal dialog with the crash-report path line inserted between the error and the advice. |
| `apps/desktop/tests/expected/fatal-dialog-with-report-zh-CN.txt` | The Chinese fatal dialog with the report line (诊断报告：…) inserted in the same position. |
| `apps/desktop/tests/expected/latest-installer-uploads.json` | The six fixed-download destinations (3 targets × 2 deployments) with bucket, key, content type and `channelMetadata: false`. |
| `apps/desktop/tests/expected/mandatory-update-zh.json` | The Chinese mandatory-update confirmation: title, detail, version line, and the two buttons Stop-tasks / Later. |
| `apps/desktop/tests/expected/platform-storage.txt` | The **Platform storage lifecycle**: first-open visible, "got it" hidden, reopen still hidden, cookies cleared, a second account visible again, back-to-first hidden, signed-in-again hidden, restart-first-open hidden. This is a state-machine fixture, not a snapshot of text. |
| `apps/desktop/tests/expected/policy-login-en.json` | The exact dialog *sequence* for the four policy-login outcomes (disabled / returned / cancelled / failed) — a script, not a picture. |
| `apps/desktop/tests/expected/publication-mac-arm64.md` | The **human approval summary** for a mac-arm64 test release: environment, version, channel, platform, the test release id, the download URL, the feed URL, the packaging run link, the source ref and SHA, the packaging machine, the signing result (DMG 校验通过 / ZIP 内应用校验通过), "不创建（test 环境）" for the git tag, "what will happen after you approve", the bucket, the approval-summary SHA-256, and a per-file size/SHA-256 table — plus the warning that a public repository exposes the test prefix.
| `apps/desktop/tests/expected/publication-production.md` | The same summary for a **production** win-x64 release: the fixed `download.deepseek.com` origin, the proposed `desktop-v1.0.0` tag, the "EXE 签名校验通过" line, and a fourth post-approval step — create the git tag for the actual packaged commit, and if the tag creation fails record "已发布，待补 tag".
| `apps/desktop/tests/expected/publication-win-x64.md` | The same summary for a win-x64 test release, including the `.exe.blockmap` row in the file table. |
| `apps/desktop/tests/expected/retained-unnotarized.md` | The refusal message for a retained **unnotarized** package: the remedy (re-run macOS packaging without skipping notarization), and the statement that the artifact is for internal debugging only and cannot publish or update. |
| `apps/desktop/tests/expected/retained-unsigned.md` | The same refusal for a retained **unsigned** Windows package, with the Windows remedy (re-run packaging with signing=signed). |
| `apps/desktop/tests/expected/test-release-upload-mac-arm64.json` | The exact COS keys (`.dmg`, `.zip`, `.zip.blockmap`, `nightly-mac.yml`) and the exact feed YAML body for a mac-arm64 test release, including the SHA-512 of the zip. |
| `apps/desktop/tests/expected/test-release-upload-mac-x64.json` | The same four keys and feed body for mac-x64. |
| `apps/desktop/tests/expected/test-release-upload-win-x64.json` | The Windows variant: `.exe`, `.exe.blockmap` and `nightly.yml` — three keys, no `.zip`. |
| `apps/desktop/tests/expected/update-guidance-en.json` | The seven mandatory-update **states** in English, as a script: download → ready → tasks-running warning → deferred → preparing-restart → failure with the page fallback → no compatible release. Each entry pins the title, detail, version line, the primary action's label, and the error text. |
| `apps/desktop/tests/expected/update-guidance-zh-CN.json` | The same seven states in Chinese, including the failure state's "重试更新" action and the "暂未找到适用的更新" error. |
| `apps/desktop/tests/expected/update-overlay-visibility.json` | The native overlay's visibility contract: initially visible / initially hidden, the parent's and the overlay's visibility after load and after restore, and the released state (`filter: none`, show-listeners restored, `keyboardListeners: 0`). |
| `apps/desktop/tests/expected/update-restart-darwin-en-US.json` | The English macOS install-and-restart confirmation. |
| `apps/desktop/tests/expected/update-restart-darwin-zh-CN.json` | The Chinese macOS install-and-restart confirmation. |
| `apps/desktop/tests/expected/update-restart-win32-en-US.json` | The English Windows install-and-restart confirmation, carrying the extra "The update may take some time. Please wait and do not launch the app again during installation." paragraph. |
| `apps/desktop/tests/expected/update-restart-win32-zh-CN.json` | The Chinese Windows confirmation with the same extra paragraph (更新可能需要一些时间…). |
| `apps/desktop/tests/expected/update-status-zh.json` | The seven `DesktopUpdatePresentation` phases (`idle → available → downloading → verifying → ready → installing → error`) with the `failure` kind on the error row. |
| `apps/desktop/tests/expected/upload-credentials-check.txt` | The credential launcher's own report: "encrypted fields loaded; child environment verified; no network request made." and "parent environment unchanged". |
| `apps/desktop/tests/expected/welcome/en.expected.txt` | The rendered English text of the welcome **entry** page: brand, tagline, "Sign in", "Add API Key". |
| `apps/desktop/tests/expected/welcome/en-api-key.expected.txt` | The rendered English text of the **API-key** page: heading, description, the password field placeholder, the disabled "Save and continue", "Set up later", "Back to sign in". |
| `apps/desktop/tests/expected/welcome/en-waiting.expected.txt` | The rendered English text of the **browser-login waiting** page, including the disabled "Completing sign in…" marker and the copy-link action. |
| `apps/desktop/tests/expected/welcome/en-timeout.expected.txt` | The rendered English text of the **timed-out** sign-in page: "Sign in timed out", "Sign in again", "Add API Key". |
| `apps/desktop/tests/expected/welcome/en-expired.expected.txt` | The rendered English **session-expired** notice. |
| `apps/desktop/tests/expected/welcome/zh-CN.expected.txt` | The rendered Chinese welcome **entry** page. |
| `apps/desktop/tests/expected/welcome/zh-CN-api-key.expected.txt` | The rendered Chinese **API-key** page. |
| `apps/desktop/tests/expected/welcome/zh-CN-waiting.expected.txt` | The rendered Chinese **browser-login waiting** page. |
| `apps/desktop/tests/expected/welcome/zh-CN-timeout.expected.txt` | The rendered Chinese **timed-out** sign-in page. |
| `apps/desktop/tests/expected/welcome/zh-CN-expired.expected.txt` | The rendered Chinese **session-expired** notice. |
| `apps/desktop/tests/expected/windows-installer.json` | The sixteen named Windows installer cases, in order, plus the launch-checkbox state and the native-progress visibility. |
| `apps/desktop/tests/expected/windows-uninstall.json` | The five uninstaller cases: interactive, silent, upgrade, replaced, home-inside. |

#### Executable fixtures — `apps/desktop/tests/fixtures/*` (30 files)

These are **real programs**, not stubs: they are what makes the suite an end-to-end qualification rather than a unit test.

| File | What it is |
| --- | --- |
| `apps/desktop/tests/fixtures/artifact-update-server.mjs` | A loopback server that serves read-only executable inputs with correct hashes and can inject transfer corruption. |
| `apps/desktop/tests/fixtures/cli-console-probe.cpp` | A probe that owns its own console so a test never interrupts the caller's terminal. |
| `apps/desktop/tests/fixtures/command-path.ps1` | The Windows per-user PATH worker used by the command-management tests. |
| `apps/desktop/tests/fixtures/host-update-control.mjs` | Test-only access to services inside the *real* Loader-composed Desktop Host. |
| `apps/desktop/tests/fixtures/host-update-qualification.mjs` | The built Host qualification: the real profile Loader, the standard agent preset, the task services and Node background processes, with only the model response and the human answer substituted. |
| `apps/desktop/tests/fixtures/installed-update-network.ps1` | The operator-owned network-fault control, with the typed confirmation. |
| `apps/desktop/tests/fixtures/installed-update-packaging.mjs` | An **inert** subprocess fixture: packaging supervision is exercised without any signing or executable entry running. |
| `apps/desktop/tests/fixtures/installer-directory-smoke.nsi` | Compiles against the *production* directory transaction with a private payload and target. |
| `apps/desktop/tests/fixtures/installer-write-failure-smoke.nsi` | The same transaction with a forced write failure, so the failure path is exercised. |
| `apps/desktop/tests/fixtures/local-updater.mjs` | The real Electron HTTP/download qualification: "installer execution is forbidden" — the installation call is *recorded*, never executed. |
| `apps/desktop/tests/fixtures/macos-cache-writer.mjs` | One independent signature-cache writer, exercised through native TypeScript stripping. |
| `apps/desktop/tests/fixtures/mandatory-frame.mjs` | A minimal stand-in for the mandatory-update frame, sharing the shell's caption geometry. |
| `apps/desktop/tests/fixtures/office-conversion-inputs.py` | Creates one-page Office inputs with the *packaged* authoring runtime. |
| `apps/desktop/tests/fixtures/owned-directory-smoke.mjs` | The built Desktop cleanup smoke, run under Electron with `ELECTRON_RUN_AS_NODE=1`. |
| `apps/desktop/tests/fixtures/packaging-failure.mjs` | Keeps an owned descendant alive until the packaging supervisor handles a simulated fatal error — this is how "kill the stage tree" is proved. |
| `apps/desktop/tests/fixtures/platform-storage-smoke.mjs` | Real Electron fixture for account-scoped Platform storage across process restarts (the fixture behind `expected/platform-storage.txt`). |
| `apps/desktop/tests/fixtures/pnpm-smoke.mjs` | Installs and uses a local dependency with the packaged pnpm and the Electron Node launcher. |
| `apps/desktop/tests/fixtures/runtime-payload-smoke.mjs` | Exercises the filtered native and HTML dependencies under the Electron Node runtime. |
| `apps/desktop/tests/fixtures/signed-updates.mjs` | Real Electron download, checksum, Authenticode and coordinator recovery — again with installer execution forbidden. |
| `apps/desktop/tests/fixtures/signing-interlock.mjs` | Acquires only filesystem state; it never loads a signer or opens a token. |
| `apps/desktop/tests/fixtures/update-dialogs.mjs` | Real isolated update dialogs; the installer handoff is recorded by an inert updater. |
| `apps/desktop/tests/fixtures/update-overlay-visibility.mjs` | Native overlay visibility qualification with no Host, no network and no user profile. |
| `apps/desktop/tests/fixtures/update-server.mjs` | A loopback-only update feed with deterministic transport failures. |
| `apps/desktop/tests/fixtures/windows-pty-exit.cjs` | Exercises terminal cleanup in a child whose natural exit detects retained workers. |
| `apps/desktop/tests/fixtures/windows-signing-stage.mjs` | An independent process exercising stage ownership and cache reuse with a **hardware-free** signer. |
| `apps/desktop/tests/fixtures/workspace-update-adapters.mjs` | Replaces only the update delivery/installation and inspector allocation for the compiled main-entry scenario. |
| `apps/desktop/tests/fixtures/workspace-update-host.mjs` | Private, token-authenticated test controls for tasks in the real Desktop Host process. |
| `apps/desktop/tests/fixtures/workspace-updates-interactive.mjs` | The operator-controlled qualification against the real workspace; synthetic payloads never execute. |
| `apps/desktop/tests/fixtures/workspace-updates.mjs` | The real workspace update harness, sharing the shell's caption geometry. |
| `apps/desktop/tests/__snapshots__/preload-menu.client.spec.ts.snap` | The Vitest snapshot of the Windows caption menu's DOM. |

#### Documents — the decisions each one records

#### `apps/desktop/tests/README.md` and `apps/desktop/tests/README.zh.md`
- **Purpose:** the **verification record** for the whole Desktop update path, and the list of what is still *not* proven.
- **Key decision:** a "Layer / Observed result" table that names, per layer, exactly what passed — and a separate **Open verification** section that names what did *not*: "These isolated checks do not certify the complete workspace or a release." The doc lists eleven open items verbatim, including "Live policy origins, gateway behavior, rate limits … are pending backend integration. Local responses are not proof of a live service."
- **Why it transfers:** this is the single most transferable document in the shard for August Trading. Its structure — *what passed, layer by layer* + *what is still open, item by item* — is exactly the shape a trading app needs for "does the automation actually protect the trader's capital".

#### `apps/desktop/tests/installed-update/README.md` (+ `apps/desktop/tests/installed-update/README.zh.md`)
- **Purpose:** the operator checklist for a Windows installed update with a failed download, an explicit retry and retained evidence.
- **Key decision:** the eight-step **operator sequence** distinguishes three cases a naive test would conflate: a *missing feed* (a check failure), a *same-version feed* (no update available), and an *interrupted transfer* (a download failure). "A connection failure before progress begins is a different observation and does not satisfy a transfer-interruption test." The evidence table at the end lists 13 items, every one initially `pending`.
- **Key decision:** "Do not uninstall, clear caches, delete evidence, or overwrite failed batches to make a later attempt appear successful. Allocate a new run for a clean attempt and retain the failed one."
- **Why it transfers:** August Trading's own automations (scheduled analyses, bot routines, breaker re-enable) need the same *evidence-first* discipline; this is a ready-made template for "a scheduled run that produced nothing" vs "a scheduled run that failed".

#### `apps/desktop/tests/installed-update/network/README.md` (+ `apps/desktop/tests/installed-update/network/README.zh.md`)
- **Purpose:** an operator-owned, program-specific Windows firewall block used to interrupt exactly one application's download.
- **Key decision:** the tool "never disable[s] an adapter, VPN, proxy, or firewall profile" — the blast radius is exactly one executable's outbound rule, and the recovery command is prepared *before* the block is created. A typed confirmation (`BLOCK <run-id>`) is required, and the recovery validates the rule's name, ownership, direction, action and exact program path; "a foreign matching rule is not removed."
- **Why it transfers:** a direct model for August Trading's "inject a failure into one scheduled job and prove the breaker fires, then prove the recovery".

#### `apps/desktop/tests/installed-update/publication/README.md` (+ `apps/desktop/tests/installed-update/publication/README.zh.md`)
- **Purpose:** separate binary uploads from operator-authorized feed publication.
- **Key decision:** the confirmation is **typed and interactive** — `UPLOAD <version> <run-id>` / `PUBLISH <version> <run-id>` — "there is no piped approval option" (stated in the sibling walkthrough). Binary uploads "never publish a feed". `alreadyPublished: true` means *reconciliation*, not a new publication, and the original operation's evidence is the timing record.
- **Why it transfers:** the typed-confirmation pattern is the right shape for any August Trading action that spends money, places an order, or changes a trader's risk posture.

#### `apps/desktop/README.md` (78 KB) and `apps/desktop/README.zh.md` (70 KB)
- **Purpose:** the behavioural reference for the whole desktop shell — what the app does and, more usefully, *why each refusal exists*.
- **Key decisions it records** (each is a design ruling, not prose):
  - **Release identity**: "Electron and `@deepseek-ai/dsh` always have the same exact version. A dsh upgrade is a Desktop release, even when the shell code is unchanged." Independent versions would create untested combinations.
  - **Closing the window hides it**: the page and the Host keep running, tasks continue, and the next show presents the same document with its session, drafts and scroll position.
  - **The quit asks about *work*, not about a generic confirm**: the Host answers with two facts (active tasks, armed scheduled reminders) and the copy is one of three localized explanations. "Neither fact, the quit proceeds silently. Otherwise a native message box … shows Quit DeepSeek Harness?"
  - **An inspection failure counts as "unknown", and unknown warns**: a Host that misses the two-second deadline "is treated as running tasks."
  - **The policy is not persisted across restarts**, and "policy responses never revoke or replace an updater artifact."
  - **A known block survives transport failures**: "Cancellation, expiry, and invalid responses retain any known mandatory block. … Only a fresh valid no-force response clears the block."
  - **The shared DOM is a presentation constraint, not a security boundary**: "product scripts can hide the overlay but cannot clear main-process policy or authorize installation through it."
  - **"Your tasks are stored separately."** — the crash dialog and the tray notice both promise the user's work survives.
  - **The desktop shell shares sessions, settings, credentials, workspaces and storage under `$DSH_HOME` with CLI dsh**, while executable packages, plugin activation and lockfiles remain separate.
  - **The local settings file is never overwritten**; "Creation, read, or validation failures use the default `false` without blocking startup."
  - **The `updates.allowTestAuthPopupWindow` switch is a local, opt-in, restart-required setting** that suppresses the whole test-authentication flow — a feature flag with a *file*, not an env var that leaks into behaviour.
- **Why it transfers:** this README is a model for how August Trading should write its own "why" document: every refusal names the alternative it rejected.

#### `apps/desktop/packaging/README.md` (45 KB) and `apps/desktop/packaging/README.zh.md` (41 KB)
- **Purpose:** the build-side reference. It decides three axes independently: *deployment* (test/production), *signing mode* (signed/unsigned), and *build path* (local / Actions / self-hosted).
- **Key decisions:**
  - **The version is an argument, not a field**: "The published version is an argument rather than a release field, and upload reads it from the completion record the packaging run wrote." The manifests keep the *product* version, so a test build "no longer rewrites the release family and leaves nothing to revert."
  - **"Before each Desktop packaging run, first confirm the complete version string with the current user. … Do not start packaging until the user confirms that version; the deployment setting alone does not authorize a version choice."**
  - **"Reusing an index would overwrite a published installer and invalidate the checksum in the feed that already points at it"** — hence the bucket-first version discovery.
  - **Release fields come only from the selected configuration files, without fallback to system or shell variables**; `PATH`, proxies and build-tool settings remain inherited. The public preset rejects credentials, and the signing file cannot override public settings.
  - **Configuration checks do not authenticate the PIN, log in to the token, unlock a keychain, or contact Apple** — "actual signing and notarization perform those checks."
  - **The run directory is the record**: `run.json`, `events.jsonl`, redacted `stdout.log`/`stderr.log`, `result.json`. "Missing `result.json` means completion is unconfirmed."
  - **Debug artifacts are named so they cannot be mistaken for release artifacts**: `-unsigned`, `-unnotarized`, a separate artifacts directory, and a refusal message from the publisher.
  - **The Windows installer retries directory renames for errors 5, 32 and 33 up to ten attempts with increasing delays**, and stops immediately for other errors.
  - **The uninstaller's protected-root rules** are spelled out in full, including "the Harness home is never touched".
- **Why it transfers:** the "configuration checks never touch the credential" and "a missing final record means completion is unconfirmed" rules map directly onto August Trading's release/publish gates.

#### `apps/desktop/publishing/README.md` (10 KB) and `apps/desktop/publishing/README.zh.md` (9 KB)
- **Purpose:** the upload side, deliberately separated from packaging.
- **Key decisions:** "Building an installer or downloading an Actions artifact does not publish it." A test release requires a 32-hex release id that must be **kept through packaging, upload and retries** — "upload rejects a completion record with a different update URL." The upload audit records intent and confirmation but never a credential or a raw SDK error, and "Audit-write failures stop later PUTs." "Every object is one streamed Tencent COS PUT with an explicit length and Content-MD5; the COS SDK repeats a request only when its body is not a stream, and this uploader does not retry either." A missing final result "means interruption or unavailable storage, not success."

#### `apps/desktop/publishing/ci/README.md` (13 KB) and `apps/desktop/publishing/ci/README.zh.md` (11 KB)
- **Purpose:** the two-machine publication flow (a hosted router job, then the original signing machine).
- **Key decisions:** a **GitHub Environment approval** gates publication, and "Approval cannot edit a version; reject and rebuild instead." The approval summary's SHA-256 is re-checked after approval: "Changed bytes or destinations reject." "Missing objects are uploaded, identical objects are skipped, and conflicting same-name bytes stop the operation." A tagging failure produces `published-tag-pending` and "on retry, durable feed-completion evidence permits only tag recovery, even if a later release has advanced the channel. It never re-publishes old YAML." Channel restoration is **preview by default**: without `--execute` it "reads remote objects and prints the exact YAML change without writing."
- **Why it transfers:** the "two-phase commit with a re-checked digest" pattern is exactly what August Trading needs for anything that publishes a trade log or a performance report to a shared destination.

#### `apps/desktop/windows-signing/README.md` (18 KB) and `apps/desktop/windows-signing/README.zh.md` (16 KB)
- **Purpose:** the hardware-signing and runner reference, and a model for writing about *accepted risk*.
- **Key decisions:** the trust model is stated up front — "The shared packaging runner assumes trusted internal-team code and operators. Under this assumption, credential and device isolation are deferred and the residual risk is accepted (tracked in #5973); signed/master-only access is not enforced." The **persistent hardware interlock** is the key mechanism: "Before invoking the command interpreter, the signer atomically acquires `attempt.json` … Only successful signing followed by verification of the configured primary signature releases that file … Failure, interruption, an existing interlock, or unavailable audit storage prevents further hardware access, including from another signer instance, process, or checkout under the same Windows account. There is no timed recovery or automatic retry."
- **Key decision:** the **signing stage lock** and the **hardware interlock are two different locks** — "Stage-wide ownership is independent of the retained hardware-attempt interlock," so releasing a stage does not clear a hardware failure.
- **Key decision:** the signature cache is keyed by *content + certificate + toolchain*, and "Cache age alone does not trigger signing."

#### `apps/desktop/README.i18n.yaml`, `apps/desktop/packaging/README.i18n.yaml`, `apps/desktop/publishing/README.i18n.yaml`, `apps/desktop/publishing/ci/README.i18n.yaml`, `apps/desktop/tests/README.i18n.yaml`, `apps/desktop/tests/installed-update/README.i18n.yaml`, `apps/desktop/tests/installed-update/network/README.i18n.yaml`, `apps/desktop/tests/installed-update/publication/README.i18n.yaml`, `apps/desktop/windows-signing/README.i18n.yaml`
- **Purpose:** generated bilingual-pair consistency records — "per heading section, a hash of its English and Chinese blocks outside code blocks and generated regions", regenerated by `pnpm run verify-translation-pairing --write`.
- **Status:** skipped (generated-vendored). Their content is a machine-checked hash manifest; the *idea* is the interesting part (see §2), not the bytes.

#### `apps/desktop/resources/icon.png`, `apps/desktop/resources/icon.svg`, `apps/desktop/resources/icon-macos.png`, `apps/desktop/resources/icon-macos.svg`, `apps/desktop/resources/icon-windows.png`, `apps/desktop/resources/icon-windows.svg`, `apps/desktop/resources/tray-windows.ico`, `apps/desktop/installer/assets/brand.png`, `apps/desktop/installer/assets/brand-2x.png`, `apps/desktop/installer/assets/brand-dark.png`, `apps/desktop/installer/assets/brand-dark-2x.png`, `apps/desktop/installer/assets/uninstaller-sidebar.png`
- **Purpose:** the icon set (PNG/SVG for Windows, macOS and the generic build) and the installer's brand and uninstaller artwork.
- **Status:** skipped (assets) — the binary PNG/ICO files were confirmed on disk (sizes in the file list) and the SVG sources were peeked at the head. The *decision* they encode — "Export each platform SVG as a transparent 1024×1024 PNG", and the uninstaller's 164×314 sidebar bitmap — is recorded in `README.md` and repeated here.





### `apps/desktop/tests/cos-loopback.ts`
- **Purpose:** a loopback HTTP capture used by the tests that exercise the *real* COS SDK's request serialization.
- **Key abstractions:** `CosLoopbackRequest` (method, path, lowercased headers as the SDK wrote them), and the server that records them.
- **Why it matters:** the COS tests therefore assert on the bytes the SDK actually put on the wire — the signature, the `Content-MD5`, the `x-cos-forbid-overwrite` header and the explicit content length — rather than on a mock's expectations.

### `apps/desktop/tests/runtime-fixture.ts`
- **Purpose:** temporary materialized packages for the Desktop resource and profile behaviour tests.
- **Key abstractions:** a helper that writes a package fixture with explicit runtime exports, and builds a `DesktopRuntimeDescriptor` through the production `writeDesktopRuntime`.
- **Why it matters:** it uses the *production* runtime-tree writer, so a fixture's inventory is the same shape the real seal produces — the test cannot pass against a descriptor the app would reject.

### `apps/desktop/tests/windows-installer-extract-report.cpp` (174 lines)
- **Purpose:** the native regression suite for the installer's extraction-failure report.
- **What it pins:** that 7-Zip's evidence survives intact while the dialog headline and the expanded excerpt stay bounded — the three exit-code ranges are distinguished (0–255 = a 7-Zip code, negative = a negated Win32 error, anything else = a raw process status printed in hex), the headline is derived from 7-Zip's own `ERROR:` lines while skipping the line that merely echoes the archive path, the excerpt is bounded to 10 lines / 1000 characters, the saved report keeps everything up to 16 MiB, and a truncated UTF-8 tail is dropped before decoding.
- **Note:** it links the *production* headers (`../installer/extract-report.h`, `../installer/directory-report.h`) and imports the exported DLL entry points — the test exercises the shipped code, not a copy.

### `apps/desktop/tests/windows-installer-presentation.cpp` (32 lines)
- **Purpose:** the native regression for the installer's first presentation.
- **What it pins:** that `InstallerPresentWelcome` moves the window above ordinary windows exactly once and flashes its taskbar button when another window has focus, and that it does **not** remain always-on-top — the assertion walks the Z-order with `GetWindow(GW_HWNDPREV)`.

### `apps/desktop/tests/windows-installer-progress.cpp` (77 lines)
- **Purpose:** deterministic progress scenarios with "no wall-clock sleeps or file operations."
- **What it pins:** that a 7-Zip percentage token can cross a pipe read boundary without being lost or inflated by a filename or a stale redraw — the test replays one stream (`"  0%…  4%\r 50% 14 - filename99%\r 9%\r 101%\r 100%"`) in block sizes of 1, 2, 7 and 128 bytes, and asserts the parser is monotonic and never accepts 101 %.

### `apps/desktop/tests/windows-installer-smoke.ps1` (281 lines)
- **Purpose:** the **native installation** acceptance run, driven through UI Automation against a real installer.
- **What it pins:** the sixteen named cases in `tests/expected/windows-installer.json`, each with "a unique product identity and a private directory": canonical drive roots rejected before the ownership check, Enter validating the current path and the unchecked launch, the completion preserving the window position, the welcome being ready before the first show, a successful install painting 100 % before the finish page, a locked directory showing the error and the copy control while preserving the installation, a registered directory with trailing separators, the registered directory with a checked launch, launch failure with retry and prompt dismissal, a running app rejected before welcome and extraction (both silent and interactive), an app started on welcome rejected before extraction, a silent update retaining the directory and ignoring an unrelated process, an invalid destination, and the uninstall.
- **Note:** it loads `UIAutomationClient` and drives the *real* controls, so it is the only gate in the repo that can see the installer's accessibility tree.

### `apps/desktop/tests/windows-installer-ui.ps1` (258 lines)
- **Purpose:** the shared UI-Automation capture helper for the installer and uninstaller smokes.
- **What it pins:** a C# `InstallerCapture` type compiled with `Add-Type` that makes the process DPI-aware, finds the installer's controls by product name, drives them, and writes screenshots; the two smokes share it so the installer and the uninstaller are observed the same way.

### `apps/desktop/tests/windows-runner-task.ps1` (108 lines)
- **Purpose:** the opt-in Windows Task Scheduler acceptance.
- **What it pins:** installation, automatic recovery, duplicate-start prevention, stop, child-process teardown and uninstall, "against an isolated fake runner" — it creates a temporary task under a path with **spaces in it** (`runner with spaces`) and copies the two runner scripts into it.
- **Safety:** "no GitHub registration or signing access" — it never contacts GitHub and never opens the token.

### `apps/desktop/tests/windows-uninstall-data.cpp` (91 lines)
- **Purpose:** the native regression for the uninstaller's data cleanup.
- **What it pins:** that cleanup "operat[es] only in the caller's private test directory" — a reparse point is unlinked and not followed, a protected known folder is refused, a locked sibling does not stop the rest of the tree, and the read-only attribute is cleared before removal.

### `apps/desktop/tests/windows-uninstall-smoke.ps1` (102 lines)
- **Purpose:** the production uninstaller acceptance, with an isolated application identity and seeded data.
- **What it pins:** the five cases in `tests/expected/windows-uninstall.json` — `interactive`, `silent`, `upgrade`, `replaced`, `home-inside` — against the real `%APPDATA%` / `%LOCALAPPDATA%` locations, and reads the expected case list from the golden file rather than hard-coding it.


### Tier 3 — skipped with a reason (22 files)

None of these carries behaviour; each was confirmed on disk (size, format magic, and a head peek where the format is text).

| File | Why it was not read line by line |
| --- | --- |
| `apps/desktop/README.i18n.yaml` | Generated bilingual-pair consistency record: per heading section, a hash of the English and Chinese blocks. Machine-written by `verify-translation-pairing --write`; head read to confirm what it is. |
| `apps/desktop/packaging/README.i18n.yaml` | Same generated bilingual-pair hash manifest for the packaging guide. |
| `apps/desktop/publishing/README.i18n.yaml` | Same, for the publication guide. |
| `apps/desktop/publishing/ci/README.i18n.yaml` | Same, for the CI publication guide. |
| `apps/desktop/tests/README.i18n.yaml` | Same, for the local update verification record. |
| `apps/desktop/tests/installed-update/README.i18n.yaml` | Same, for the installed-update walkthrough. |
| `apps/desktop/tests/installed-update/network/README.i18n.yaml` | Same, for the network-fault procedure. |
| `apps/desktop/tests/installed-update/publication/README.i18n.yaml` | Same, for the test publication procedure. |
| `apps/desktop/windows-signing/README.i18n.yaml` | Same, for the Windows signing guide. |
| `apps/desktop/resources/icon.png` | Binary application icon (369 KB). PNG magic `89 50 4E 47` and size confirmed on disk. |
| `apps/desktop/resources/icon.svg` | Vector artwork source (1104×1104 viewBox). Head read to confirm it is the wordmark source; the rest is path geometry. |
| `apps/desktop/resources/icon-macos.png` | Binary macOS icon (279 KB). PNG magic confirmed on disk. |
| `apps/desktop/resources/icon-macos.svg` | Vector macOS artwork source (1024×1024, rounded `rx=230` background). Head read to confirm the shape difference from the Windows source. |
| `apps/desktop/resources/icon-windows.png` | Binary Windows icon (128 KB). PNG magic confirmed on disk. |
| `apps/desktop/resources/icon-windows.svg` | Vector Windows artwork source (1024×1024, `rx=192` background). Head read to confirm the shape difference. |
| `apps/desktop/resources/tray-windows.ico` | Binary Windows tray icon (15 KB). ICO magic `00 00 01 00` and the 7-entry directory header confirmed on disk. |
| `apps/desktop/installer/assets/brand.png` | Binary installer brand bitmap. PNG magic confirmed on disk. |
| `apps/desktop/installer/assets/brand-2x.png` | Binary 2× installer brand bitmap. PNG magic confirmed on disk. |
| `apps/desktop/installer/assets/brand-dark.png` | Binary dark-theme installer brand bitmap. PNG magic confirmed on disk. |
| `apps/desktop/installer/assets/brand-dark-2x.png` | Binary 2× dark-theme installer brand bitmap. PNG magic confirmed on disk. |
| `apps/desktop/installer/assets/uninstaller-sidebar.png` | Binary uninstaller sidebar artwork (converted to a 164×314 BMP during preparation). PNG magic confirmed on disk. |
| `apps/desktop/renderer/assets/welcome-brand.svg` | Vector brand mark (472×40). Head read to confirm it carries its own embedded design tokens; the rest is path geometry. |
## 2. Ideas worth stealing

1. **The renderer may not name the thing it is asking for.** Every consequential action in this repo is expressed as a *selection from a displayed list*, never as a value the renderer supplies. The update dialog answers with an **index** into `buttons`, and the main process rejects a stale `revision` (`src/update-dialog.ts`). The install command answers with a **fingerprint** the user was shown (`src/command-installation.ts`). The update coordinator re-checks `version === this.candidate` before downloading (`src/update-coordinator.ts`). The policy modal answers with a version **and** a confirmation revision (`src/mandatory-update-window.ts`). — *Why it transfers*: August Trading's trade-plan approval, bot-arm action and skill-approval inbox should all take an **opaque handle into a list the user actually saw**, not a URL, a symbol, a price or a path supplied by the client. `CONVERGENT` (the same shape appears in the shell's five separate dialogs and in the command manager).

2. **Two types for the same fact: a main-process state and a renderer-safe presentation.** `DesktopUpdateState` may carry `technicalDetails`; `DesktopUpdatePresentation` carries only `{phase, version, percent, failure}` (`src/ipc.ts`, `src/update-presentation.ts`). The renderer *cannot* read raw diagnostics — it reads a semantic failure kind and asks the main process for details through a separate, main-owned surface. — *Why it transfers*: this is exactly August Trading's `WireAuditEntry` discipline ("the transport decides, per request, which capability route it applied, and says why when it applied none"), applied to the whole renderer. `UNIQUE` to this shard, but it converges with August's own pattern.

3. **A known block survives transport failure; only a fresh, valid, no-force answer clears it.** `src/mandatory-update-policy.ts` — "A known block survives transport and parsing failures, but not a fresh no-force success." The failure counter drives an exponential backoff capped at an hour. — *Why it transfers*: if August Trading ever has a "this market/config is unsafe, stop trading" state, the rule must be *sticky*. Losing a risk block because a status endpoint timed out is the worst possible failure mode. `CONVERGENT` (the same stickiness appears in the command installer, the signing interlock and the profile lock).

4. **A human gate that asks about *work*, not about a generic "are you sure".** The quit path asks the Host two facts — active tasks and armed scheduled reminders — and the copy is one of three localized explanations (`src/quit-confirmation.ts`, `src/host-process.ts` `inspectQuit`). An inspection failure counts as *unknown*, and unknown **warns**. The update install path is stricter still: it **locks admission, drains admitted requests, re-checks, and only then stops tasks** — and "an unanswered drain fails at the control-request deadline without authorizing installation." — *Why it transfers*: this is the right shape for "restart the app", "stop the bots", "close the trade window": name what will be interrupted, in the trader's language, and refuse to proceed when the state is unknown. `CONVERGENT`.

5. **A durable, credential-free, whitelisted JSONL journal with a fixed vocabulary.** `src/update-journal.ts` writes one file per process, flushed before the caller continues, containing only `phase`, `targetVersion`, integer `percent`, `failedOperation` and a *fixed* error classification — "no raw diagnostics or request data." The packaging suite does the same thing at a larger scale (`run.json`, `events.jsonl`, `result.json`; "Missing `result.json` means completion is unconfirmed"). — *Why it transfers*: August Trading's trade log and bot run log should be a **fixed-vocabulary JSONL** with a monotonic sequence number, flushed, one file per process/session, and an explicit rule that free text never enters it. `CONVERGENT` (the same pattern at three scales: update journal, packaging run, publication record).

6. **A "no free text" release summary that a human approves before anything is published.** `tests/expected/publication-*.md` is the exact markdown a deployment reviewer reads: environment, version, channel, platform, download URL, feed URL, the packaging run link, the source ref and SHA, the signature result, the proposed git tag, a SHA-256 of the summary itself, and a per-file size/SHA-256 table — plus the explicit warning that a public repository exposes the test prefix. The publisher **re-checks that digest after approval**: "Changed bytes or destinations reject. Approval cannot edit a version; reject and rebuild instead." — *Why it transfers*: a scheduled-run digest for August Trading — a hash of the plan the trader approved, re-checked before execution — is the missing half of most "human-in-the-loop" implementations. `UNIQUE`.

7. **Typed, interactive confirmations for irreversible actions.** `UPLOAD <version> <run-id>`, `PUBLISH <version> <run-id>`, `BLOCK <run-id>`, `RESTORE <run-id>`, and a build-version confirmation that must happen *before* packaging starts. The walkthrough states: "there is no piped approval option." — *Why it transfers*: any August Trading action that can place an order, spend money, or change a trader's risk posture should require a typed confirmation containing the *specific* target, and must not be automatable by a script that pipes a `y`. `CONVERGENT`.

8. **A golden-file contract for user-visible copy, in every locale.** `tests/expected/welcome/*.expected.txt` are the **rendered text** of the welcome window per state per locale; `update-guidance-*.json` are the seven mandatory-update states as a script; `command-management-*.json` pin the five dialog shapes per platform per locale. — *Why it transfers*: August Trading has no equivalent. A `tests/expected/` directory of rendered-text fixtures for the trade card, the gate warning and the bot breaker would catch copy regressions and — more importantly — would make the *wording of a refusal* a reviewed artefact. `UNIQUE`.

9. **A persistent interlock with no automatic recovery.** The Windows signing interlock (`scripts/windows-signing-state.mjs`, `scripts/windows-signing-stage.mjs`) is a file that only a *successful, verified* operation releases; "Failure, interruption, an existing interlock, or unavailable audit storage prevents further hardware access … There is no timed recovery or automatic retry." It is deliberately **separate** from the stage lock, so releasing a stage does not clear a hardware failure. — *Why it transfers*: August Trading's bot breaker should work exactly this way: a failed run (or a failed *recovery*) latches a flag that a human must clear, and the "who may clear it" decision is not the same as the "who may run it" decision. `CONVERGENT` (the profile lock in `src/project-manager.ts` has the same shape: a PID-bearing lock file reclaimed only after the owner is proven dead).

10. **Reconcile by digest, never by ETag, and skip identical bytes.** `scripts/desktop-publish.ts` computes `{size, sha512}` from bytes ("File identity computed from bytes, never inferred from COS ETags"), uploads only missing files, skips identical ones, and stops on a conflict. An ambiguous write is *reconciled by reading remote bytes* rather than repeated. — *Why it transfers*: the same rule makes August Trading's "idempotent scheduled run" safe: compare the plan's digest, skip what matches, and never repeat a write whose outcome is unknown. `CONVERGENT`.

11. **Bilingual pairing is machine-checked by a per-section hash.** `README.i18n.yaml` records a hash per heading section for the English and Chinese blocks, regenerated by `verify-translation-pairing --write`. — *Why it transfers*: if August Trading ever adds a second locale, this is a 30-line script that makes drift impossible. `UNIQUE`.

12. **A feature flag that is a file, not an environment variable.** `src/settings.ts` — `updates.allowTestAuthPopupWindow` lives in `userData/desktop/settings.json`, is read **once at startup**, never overwritten, validated, and falls back to `false` on any failure without blocking startup. — *Why it transfers*: August Trading's "enable/disable the bot arm" switch should be a documented, user-editable file with a default of *off*, read once, with a corrupt file meaning *off* rather than *on*. `UNIQUE`.

13. **One shell for the whole product.** Every confirmation in the app — updates, About, command management, policy login consent — is the same `DesktopUpdateDialog` class, with one focus model, one keyboard model, one locale source. The Windows caption menu is a hand-built roving-tabindex menubar *in a preload*. — *Why it transfers*: August Trading's `components/shared/Disclosure.tsx` and `DetailModal.tsx` are the same instinct; this repo pushes it further by making the *native* surface shared too. `CONVERGENT` with August's own canonical-single-source modules.

14. **The crash dialog promises the user's work survived.** "Your tasks are stored separately." The tray notice says "Running tasks will continue. You can reopen the window from the system tray." — *Why it transfers*: a one-line, honest promise in the failure path is a product feature; August Trading's error surfaces should say the same about the trade log. `UNIQUE`.

15. **Refuse the whole directory, not just the file.** `installer/uninstall-data.h` refuses any target overlapping a known folder, the installation, the Harness home, or the native Program Files; a reparse point is *unlinked, not followed*; a locked file leaves residue and never fails the uninstall. `src/owned-directory.ts` says why: "Electron's recursive rm follows nested Windows junctions into installed resources." — *Why it transfers*: August Trading's backup/restore and "clear cache" actions should refuse to delete a path that overlaps a known data root, and should never follow a link out of the tree. `UNIQUE`.

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work — not in this shard.** The *scheduling* of the agent's reminders lives in the Host and the `schedule` family of `workspace/session-activity`, not in `apps/desktop`. What this shard contributes is the **shell side** of the problem, and it is substantial: (a) the quit path asks the Host "what would quitting interrupt?" and distinguishes *running tasks* from *armed scheduled reminders* (`src/host-process.ts` `inspectQuit`, `src/quit-confirmation.ts`); (b) the update-install path **locks request admission, drains admitted requests, and re-checks** before it stops anything, refusing the install if the drain does not complete in time (`src/host-process.ts` `updateTasks('lock')`, `src/main.ts` `beforeRestart`); (c) a "known block" is preserved across restarts of the polling schedule but **not** across application restarts, and the doc says so explicitly; (d) the **journal** (`src/update-journal.ts`) is the per-process evidence that a scheduled action actually ran, and the installed-update walkthrough's journal milestones (`started`, `workspace-ready`, `check-requested`, `download-requested`, `install-confirmed`, `quit-requested`) are exactly the shape a "did the scheduled run happen?" record should take. There is no cron, no retry queue and no breaker in this shard.
- **Human-in-the-loop approval — strongly present, and the best material in the whole reference set.** The pattern is: the main process composes the copy and the choices; the renderer picks an **index**; a monotonic **revision** invalidates a stale answer; the answer is *bound to a version or a fingerprint* the user actually saw; and the approval is **separate from the execution** (download → ready → install, each with its own confirmation). On top of that sit four more gates: the *typed* confirmation for irreversible publication, the *two-phase* publish (approval → digest re-check → upload), the *training* that a debugging artifact can never publish, and the *hardware interlock* that only a verified success releases. For August Trading this is the reference answer for "how do you make a human approval that a script cannot forge and cannot replay".
- **Post-mortem / reflection loops — not in this shard**, with one exception worth stealing: the **failure record** is durable, redacted, and *outlives the thing that failed*. The crash report keeps the inspected error with its properties and cause chain, the renderer console tail, the process facts and the timestamp, and is pruned to the newest ten by a name that sorts by time. The packaging run keeps the redacted child output, the phase events and the terminal result. The publication record keeps intent, before/after bytes and the terminal state. There is no *lesson extraction* here — that lives in the `dsh-core` shard.
- **Multi-agent — not in this shard.** The only agent-related facts here are about the Host's *task accounting*: the Host reports running agents (including subagents and approval waits), queued messages, and running or stopping jobs, and the shell asks about them before it restarts or quits. The interesting design note is that **API reads do not trigger the warning** — "API requests alone do not trigger the warning" — so the task model is about *work*, not about traffic.
- **Structured logs the model can query — strongly present.** The update journal is JSONL with a fixed event vocabulary and a monotonic sequence number; the packaging run is `run.json` + `events.jsonl` + `result.json`; the publication record is a plan plus events plus a result; the *installer* writes a plain-text extraction failure report and a directory-failure report beside the installation. No database, no FTS, no log server. The discipline that makes them queryable is the **whitelist**: free text never enters a structured record, and diagnostics go to a separate file that is not part of the machine-readable one.
- **Staying simple as features accumulate — the dominant lesson.** The shell has *one* dialog class, *one* tray, *one* update coordinator, *one* schedule, *one* policy client, *one* journal writer, *one* settings file, and *one* IPC registry. The publisher is explicitly told not to run two writers against one channel. The packaging and publication guides are separate documents with separate owners, and the publication guide says so: "Build configuration and signing operations have separate owners." Everything the shell does not need is absent — no plugin marketplace in the shell, no telemetry SDK, no crash-uploader service, no in-app store, no account model of its own (the Host owns it), no model selection (the Web app owns it).

## 4. Non-obvious decisions and gotchas

1. **`assertDesktopSender` checks the *scheme and hostname*, not the whole URL.** A product document at `dsh-app://app/anything` passes. That is deliberate — the Web app serves one origin — and it means an origin check is not a page check. `src/ipc.ts`.
2. **A preloader gates on `location.href` and throws at module load if it is wrong.** `preload-welcome.ts` throws "desktop welcome: missing window locale" when its `--dsh-welcome-locale=` argument is missing. The window would never render; failing loudly at load beats a blank page. `src/preload-welcome.ts`.
3. **`ipcMain.on` with `sendSync` is used for exactly one thing.** The Platform bootstrap, because the preload must have a token *before* the page's scripts run. Everything else is async `invoke`. `src/preload-platform-account.ts`.
4. **The `DesktopUpdateState` and `DesktopUpdatePresentation` split is not redundancy.** The first is a main-process fact; the second is a *renderer-legal projection*. `presentDesktopUpdate` is the only thing that crosses the boundary. `src/update-presentation.ts`.
5. **`electron-updater` is configured to do nothing on its own** (`autoDownload = false`, `autoInstallOnAppQuit = false`) and `allowDowngrade = false` is set *explicitly*, because selecting a channel can silently enable it upstream. `src/update-coordinator.ts`.
6. **`onError` in the coordinator deliberately ignores check and download errors** — those promises own their failures — and only reports *install* errors, because `quitAndInstall` can fail after it returns. `src/update-coordinator.ts`.
7. **The update schedule's backoff is per-schedule, and a manual caller joining an automatic check does not double it.** The `activeChecks` counter exists for exactly that. `src/update-schedule.ts`.
8. **The mandatory policy and the ordinary updater have completely separate lifetimes.** "Ordinary feed polling; policy queries and user-authorized transfers keep their own lifetimes." `src/update-schedule.ts` header.
9. **A failure to *inspect* the Host's state is treated as "tasks are running".** The comment: "an unknown state warns about running tasks rather than quitting silently." `src/quit-confirmation.ts`.
10. **The quit inspection runs once per decision and approval never re-inspects.** Work that starts or ends while the box is open does not change the copy. `src/quit-confirmation.ts`.
11. **The Host's `diagnostic` is a getter, not a property.** So `util.inspect` of the error does not print the (possibly 64 KiB) diagnostic a second time as an escaped property. `src/host-process.ts`.
12. **The Web app is served by the *shell*, not by the Host.** `dsh-app://app/` is served from the packaged `dist` for the first paint and then proxied to the Host with the Host's cookie substituted — so the renderer never holds a credential, and the shell owns the protocol. `src/main.ts` `protocol.handle`, `src/web-document.ts`.
13. **`set-cookie` is withheld from the renderer on purpose.** Relaying it would hand the Host's auth cookie to the page's own cookie jar. `src/web-document.ts` `WITHHELD_RESPONSE_HEADERS`.
14. **Plugin bundle responses are forced to `no-store`.** The Host marks them immutable under a revision that changes every launch, so Chromium's disk cache would only accumulate bundles no later launch can reuse. `src/web-document.ts`.
15. **The profile lock is a PID file, and a stale lock is only reclaimed after the owner is proven dead.** `process.kill(pid, 0)` with `ESRCH` meaning dead and *any other* signal meaning alive. `src/project-manager.ts`.
16. **`removeOwnedDirectory` unlinks a symlink without following it**, because Electron's recursive `rm` follows nested Windows junctions into installed resources. `src/owned-directory.ts`.
17. **The macOS command install uses a 20-line C helper** (`linkat`) because Node's `link()` follows symlinks and would destroy the inode identity the fingerprint is computed over. `cli/link-entry.c`.
18. **The install transaction is rename-then-verify-then-rollback**, and every failure names the preserved path. `src/command-installation.ts`.
19. **An externally replaced command is never removed.** `removeFileCommand` deletes only the receipt; the other installer's entry survives, and the result carries `preservedBackup`. `src/command-installation.ts`.
20. **The Windows command worker runs with a filtered environment** — no `KEY|SECRET|TOKEN|PASSWORD|NODE_OPTIONS|NODE_PATH`. `src/command-management.ts`.
21. **The login-shell probe runs in its own process group and is killed as a group**, and completes at the **closing delimiter** rather than at `close`, because rc-file background children inherit stdout and hold it open. `src/login-shell-environment.ts`.
22. **`DSH_*` and `ELECTRON_*` are launcher-owned** and are never overwritten by the shell's environment. `src/login-shell-environment.ts`.
23. **The `ErrnoException` for the platform session rejects a `requestHeaders` map containing `authorization`, `host`, `content-length` or CRLF**, and requires the origin to be HTTPS or loopback HTTP. `src/host-process.ts` `isDesktopHostEvent`.
24. **`accountView` re-validates every browser URL** and `read()` batches `credentials.describe` in groups of **64**. `src/account-backend.ts`, `src/welcome-backend.ts`.
25. **The Platform view's storage is wiped when the view closes** — cookies, filesystem, IndexedDB, Cache Storage, service workers, HTTP auth. `closeAndWait()` throws if the cleanup failed, which *blocks the installer's handoff*. `src/platform-view.ts`.
26. **`ERR_ABORTED` on a Platform document's first load is not a failure.** The document may replace its own URL to consume an embedded deployment parameter. `src/platform-view.ts`.
27. **The crash report's file name is sortable by time and pruning matches the exact generated syntax**, so pruning never touches an unrelated file in the logs directory. `src/crash-report.ts`.
28. **The dialog's `detail` is budgeted in characters**, and the truncation is computed *backwards* from the budget so the report line and the advice always survive. `src/fatal-recovery.ts`.
29. **`EADDRINUSE` gets a different button set** (Exit / Restart only) and a different explanation. `src/fatal-recovery.ts`.
30. **The Windows mandatory-update overlay uses a `closed` shadow root**, and the background-keydown blocker lets the caption menu through by checking the composed path for `data-windows-menu`. `src/preload-mandatory-overlay.ts`.
31. **The mandatory-update page blurs the focused button when a download button becomes an install button**, so a stale Enter cannot install. `renderer/mandatory-update.js`.
32. **The update-dialog renderer implements its own focus trap** and treats Escape as cancellation, never acceptance. `renderer/update-dialog.js`.
33. **The installer pins 7-Zip to `-bso0 -bse2 -bsp1`** so stdout is the percentage and stderr is the diagnostic file, and puts the child in a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` job so a crashed installer cannot leave a 7-Zip running. `installer/extract.h`.
34. **Only the successful NSIS finish callback may authorize 100 %.** `InstallProgress::Complete` is the only path that targets 100. `installer/progress.h`.
35. **The installer's rounded-rectangle arcs are passed as IEEE-754 bit patterns** because "System.dll has no float argument type." `installer/drawing.nsh`.
36. **The installer's custom-drawn buttons are still native controls** (`NM_CUSTOMDRAW`), so focus, keyboard and the accessibility role survive. `installer/pages.nsh`.
37. **The uninstaller pins directories with `FILE_SHARE_READ|FILE_SHARE_WRITE` and deliberately not `FILE_SHARE_DELETE`**, so a rename cannot happen underneath the walk. `installer/uninstall-data.h`.
38. **`app.setAppLogsPath()` is called before `app.whenReady()`**, so the very first crash report already lands in the platform log directory. `src/main.ts`.
39. **The update channel is sealed into the packaged manifest**, and an *invalid* explicit channel throws rather than falling back. `src/update-channel.ts`.
40. **`desktopClientVersion()` throws** when the build carries no `DSH_CLIENT_VERSION` rather than reporting a guessed version. `src/client-metadata.ts`.
41. **The `en` message dictionary is the source of the `DesktopMessages` mapped type**, so adding a message to English is a compile error in Chinese — a missing translation cannot ship. `src/locale.ts`.
42. **`readDesktopSettings` never throws.** A corrupt or unreadable settings file falls back to defaults with a console warning; optional settings must not be fatal. `src/settings.ts`.
43. **The settings file is created with `flag: 'wx'` and `EEXIST` is tolerated**, so a user-created file is never overwritten. `src/settings.ts`.
44. **The bundle-import check fails the *bundle*, not the installed app.** electron-builder copies only the manifest's `dependencies`, so an unresolvable bare import "ships without complaint and fails at launch with `ERR_MODULE_NOT_FOUND`". `scripts/desktop-bundle-imports.mjs`.
45. **The sandboxed preload's `require` allow-list is exactly `electron`, `events`, `timers`, `url`** — nothing else may be left external. `apps/desktop/tsdown.config.ts`.
46. **The macOS notarization proxy mutates a system network service**, and the change is guarded by a per-user POSIX file lock that is acquired *before* reading the recovery record. "This prevents overlapping proxy transactions across checkouts." `scripts/macos-notarization-proxy.ts`.
47. **The publication publisher and the manual uploader must not run against one channel concurrently** — they have separate locks, separate approval and separate recovery, and the guide says so explicitly. `publishing/README.md`.
48. **A publication that uploaded but failed to tag is `published-tag-pending`, and the retry is *only* allowed to create the tag** — it "never re-publishes old YAML." `publishing/ci/README.md`.
49. **The channel rollback is preview-by-default** and only restores YAML, never binaries and never tags. `scripts/desktop-rollback.ts`.
50. **The client disables automatic downgrade**, so "restoring an old feed can stop additional clients receiving a bad release; clients already on a newer version do not downgrade." `publishing/ci/README.md`.

## 5. Weak spots

1. **`main.ts` is 1356 lines and owns too many concerns.** It holds the window policy, the menu construction, the tray, the updater's `beforeRestart` closure (which is ~80 lines of the most delicate logic in the repo: confirmation → admission lock → drain → platform cleanup → clean stop → install), the account watcher, the policy wiring and every IPC handler. The `beforeRestart` closure in particular is the hardest code in the shard and it is a closure inside a closure inside `main()`. It is well commented and heavily tested, but it is not *reusable* or *inspectable* as a unit — the same responsibility in a separate class (`DesktopUpdateHandoff`) would be testable without Electron.
2. **Two of the most valuable behaviours are only reachable by manual operator action.** The signed installed-upgrade qualification, the real network-fault test and the real COS publication are all documented as **pending** — the automation stops one step short. `tests/installed-update/README.md` says: "Actual packaging remains unverified and requires separate hardware-recovery approval and a present operator." The local fixtures substitute the interesting part (the bytes, the transport, the signer) and leave the *real* part to a human with a token. That is a defensible trade-off, but it means the reference's own confidence in its update path rests on procedure, not on a gate.
3. **The credential-hygiene story is strong in the code and weak in the operations.** The scripts filter secret-bearing environment variables, redact journals, refuse to log PINs, and separate the signing stage lock from the hardware interlock — but `windows-signing/README.md` states plainly that the shared runner "assumes trusted internal-team code and operators", that "signed/master-only access is not enforced", and that a branch could "read those files or access the token". The reference accepts the residual risk explicitly (tracked as #5973), which is honest, but the risk is real and the mitigation is organisational, not technical.
4. **The test suite is large but the *unit* coverage is uneven.** Some specs are extremely thorough (`update-schedule.spec.ts`, `command-installation.spec.ts`, `update-dialog.spec.ts`, `windows-signature-cache.spec.ts`) while others are thin harnesses whose real work is in a `fixtures/` program (`acl-skill.built.e2e.ts`, `welcome-startup.spec.ts`, `platform-storage.e2e.ts`, `retain-desktop-ci.spec.ts`, `desktop-cli.spec.ts` show no `describe`/`it` titles at all). A reader cannot tell from the spec file alone what is actually asserted.
5. **The `tests/expected/` golden files are excellent for the copy they cover and absent for the rest.** The welcome window, the mandatory-update states, the command-management dialogs and the crash dialogs are pinned to the byte; the *ordinary* update dialog's geometry, the sidebar's update row and the account panel are covered by component tests in another shard, and the shell's own copy for those surfaces is not pinned here. The gap is invisible from the file list.
6. **The macOS notarization proxy mutates a machine-wide network setting.** It is guarded by a lock, a recovery record and a restore command, and the guide is explicit about the risk ("This temporarily affects other applications and requires permission to change system proxies"), but a build that crashes between "enable proxy" and "restore proxy" leaves the operator's whole machine routed through a proxy until they run `restore:mac-proxy`. A design that avoided the mutation entirely would be strictly better.
7. **Several scripts are duplicated between `.mjs` and `.d.mts`** (`desktop-auto-update-environment`, `desktop-build-commit`, `desktop-build-paths`, `desktop-build-version`, `desktop-bundle-imports`, `desktop-ci-version`, `desktop-package-environment`, `desktop-policy-environment`, `desktop-publish-qualification`, `desktop-release-environment`, `desktop-signature-*`, `windows-*`, `macos-*`, `notarize-macos*`, `packaging-run`, `packaging-step`, `preflight-desktop-publish`, `electron-builder-config`, `installed-update-*`, `logged-notarytool`, `verify-macos-signature`). The `.d.mts` is a hand-written declaration of the `.mjs`, so **the two can drift** — the type says one thing and the runtime another. A `.ts` source with a compiled `.mjs` would remove an entire class of bug, and the repo already uses `tsdown` to do exactly that for the application.


