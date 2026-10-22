# hermes-agent :: hermes-apps-desktop-electron

**Files in shard:** 666 (read: 666, skipped with reason: 0)
**What this shard covers:** the entire Electron **main-process shell** of the Hermes
Agent desktop app (`apps/desktop/electron/**`): the `main.ts` orchestrator (18,468 lines),
the ~330 pure/electron-free sibling modules it was decomposed into, the `preload.ts`
contextBridge, the `updater/` strategy family, a small set of native helpers
(C/ObjC/C#/Objective-C/Python), and 336 vitest suites covering all of it.
It is the desktop **plumbing**, not the agent: no model calls, no prompt assembly,
no memory/learning loop, no trading logic. What it does contain is an unusually
well-documented set of **cross-process lifecycle protocols** — backend ownership,
update markers, connection registries, OAuth partitions, crash forensics — which is
where the transferable ideas are.

**Method note (important, read before trusting an entry):** every file in the shard
was opened and read. The files in the first ~16 list positions were captured by a
full-text read. The rest were captured by a **structured read** that records each
file's header doc-comment (where this repo keeps the "why"), its import graph,
every exported symbol and function signature, its throw sites, its
marker/TODO/issue-reference comments and its module constants — that is a read of
every file's content, not a summary from its name, but it is **not** a line-by-line
read of the bodies. `main.ts` (703 KB, 18,468 lines) was read in sections: head 120
lines, tail 90 lines, the full `app.whenReady` boot body, plus a structural scan of
all 105 `ipcMain.handle` channel names, 407 top-level function declarations, 20
section banners and the module-scope state. The 336 test files were catalogued by
their header comment plus their `describe`/`it`/`test` titles — the titles are the
assertions' subjects, which is exactly what a tier-2 one-line entry needs; the five
that use non-vitest title styles (`.mjs`, `.c`, `.py`) were read directly. Every
claim in an entry is traceable to the file's own doc-comment or code. The status
TSV records the method per file.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entries

### `apps/desktop/electron/main.ts` (703,757 bytes, 18,468 lines)
- **Purpose:** the Electron main process. Owns the app lifecycle, every IPC handler,
  the backend pool, the connection registry plumbing, window creation, the update
  hand-off, and the quit sequence.
- **Key abstractions:** it *consumes* the 330 sibling modules rather than defining
  them; the only names it exports are `_resetFileRevealDedupeForTest()` and
  `isInstallerCreatedCheckout()`. Its own state is module-level `let`:
  `mainWindow` (:1918), `backendStartFailure` (:2010), `bootstrapAbortController`
  (:2020), `isQuittingForHandoff` (:3822), `hudWindow` (:13003).
- **Data flow:** `app.whenReady()` (:18001) → consume the pending-relaunch marker →
  warm the login-shell PATH → install OS CA trust → enable the Linux basic password
  store → migrate legacy encrypted secrets → enable the accessibility tree → install
  media/download/protocol handlers → register the deep link → install the preview
  guest preload and escape hatch → configure the spellchecker → register
  power-resume listeners → restore keep-awake → seed the primary profile → apply
  Quick Entry settings → install the screenshot/HUD gesture taps → wire
  display-topology rehoming → `resumeManagedSshRecoveries()` → build the first
  window (which also installs the macOS application menu).
- **Non-obvious decisions:** the boot body is *ordered by dependency*, not by
  importance — the spellchecker, the deep link and the accessibility switch all run
  before `createWindow()` because each has a documented "must run before X" rule in
  its own module. The update hand-off deliberately does **not** quit the app on
  macOS (`app.on('window-all-closed')`, :18458): the detached updater's PID-wait
  would otherwise spin to its full timeout and leave an invisible app.
- **Edge cases & failure handling:** `app.on('before-quit')` (:18316) runs a
  *teardown barrier* — it defers the quit until every required branch settles, and
  a failed teardown still releases the final quit. Two `before-quit` handlers exist
  (:16880 and :18316), a smell but intentional (one is the marker, one the guard).
  Sandbox/GPU fallback markers are rewritten to "clean boot" on a normal quit, keyed
  on the *sticky* flag so a manual `--no-sandbox` run still records a clean boot.
- **Surprising:** 105 `ipcMain.handle` channels in one file, each named
  `hermes:<domain>:<verb>` — a stable, greppable wire vocabulary. And the file
  does real work at **module scope** (e.g. `const localGatewayDials = createLocalGatewayDials()`
  and `configurePythonGatewayTicketClient(...)` on lines 5–9), which makes the file
  hard to import in a test.

### `apps/desktop/electron/api-transport.ts` (10,443 bytes)
- **Purpose:** the one HTTP transport policy for every REST helper in the main process.
- **Key abstractions:** `withRetry`, `shouldRetryRequest`, `isTransientTransportError`,
  `isIdempotentMethod`, `httpStatusError`, `readStatusCode`, `readJsonErrorBody`,
  `htmlResponseError`, `jsonAgentFor`, `downloadAgentFor`, `destroyKeepaliveAgents`.
- **Data flow:** caller supplies a `makeAttempt(requestState)`; the helper owns the
  socket pool, the retry decision, the backoff (`200 * 2^attempt`, capped at 2 s) and
  the error shape.
- **Non-obvious design decisions:** (a) **separate pools** — JSON gets `maxSockets: 50`,
  downloads get `maxSockets: 8`, so a few long-lived download streams can never starve
  the small latency-sensitive JSON calls. (b) **verb-gated retry** — GET/HEAD/OPTIONS
  retry on any transient error; POST/PUT/PATCH/DELETE retry *only* when the request
  provably never reached the server (a `NEVER_SENT_CODES` connection failure, or
  `requestState.bodySent === false`). Anything ambiguous (ECONNRESET/EPIPE after the
  body flushed) is NOT retried, because the server may already have processed it.
  (c) `httpStatusError` stamps a structured `statusCode` **and** keeps the legacy
  `"<status>: <body>"` message, so old readers keep working while new classifiers
  read the integer.
- **Edge cases:** `htmlResponseError` distinguishes a 3xx redirect (name the
  `Location`; blame an auth proxy *unless* it is only a scheme/trailing-slash fix,
  detected by `isSchemeOrSlashRedirect`) from a 2xx HTML body ("the endpoint is
  likely missing"). A missing/invalid status normalises to 500.
- **Surprising:** the whole policy exists because of one incident (#92976): the
  backend closes idle keep-alive sockets, the next write on a reused socket dies
  with `socket hang up`, and a burst of GETs surfaced raw resets.

### `apps/desktop/electron/backend-ownership.ts` (10,616 bytes)
- **Purpose:** the durable record of which backend processes this Electron owns.
- **Key abstractions:** `BackendIdentity`, `BackendOwnershipEntry`, `BackendOwnershipStore`,
  `createBackendOwnership`, `parseBackendOwnershipDetailed`, `serializeBackendOwnership`,
  `backendCommandMatches`, `createBackendShutdownCoordinator`, `REAP_ORPHANS_DEADLINE_MS`.
- **Data flow:** a claim persists the *exact* identity (pid + parent pid + start
  marker) to a store; on the next launch the store is parsed, each entry's identity
  is re-probed, and only confirmed-dead entries are stopped; survivors are written back.
- **Non-obvious design decisions:** a **pid is not identity** — every record carries a
  creation time / start marker so a recycled pid is never mistaken for the original.
  A failed identity probe is *preserved*, not deleted ("a corrupt file … guaranteeing
  they leak forever"). `backendCommandMatches` only stops processes whose command
  line actually looks like `hermes serve|dashboard`.
- **Edge cases:** the reap has a 5 s deadline; entries that could not be processed in
  time are preserved for the next launch; a backend whose parent Electron is still
  alive is never stopped.
- **Surprising:** the module refuses to own a backend without a *complete* identity —
  it throws `Cannot own a backend without a complete process identity.` rather than
  storing a partial record.

### `apps/desktop/electron/backend-claim.ts` (9,235 bytes)
- **Purpose:** decide whether a freshly spawned local backend child is really *ours*.
- **Key abstractions:** `processStartMarker`, `probeStartMarker`, `claimDecision`,
  `pidOnlyStartMarker`, `isPidOnlyStartMarker`, `createBackendOutputTail`,
  `formatBackendExitLine`, `REAP_PROBE_TIMEOUT_MS`.
- **Data flow:** read `/proc/<pid>/stat` (POSIX) or ask PowerShell
  `Get-Process` (Windows) for the process creation time → compare against the marker
  the parent recorded → `claimDecision(childAlive, probe)`.
- **Non-obvious design decisions:** **a failed probe against a LIVE child degrades to
  PID-only identity instead of killing the child.** The old behaviour hard-failed on
  any probe error, and a PowerShell 5.1 cold start then killed healthy backends in a
  loop ("the renderer 'repaired' by respawning, and the next probe timeout killed
  that one too").
- **Edge cases:** the reap probe budget is 5 s; a missing pid is classified `ESRCH`
  so the reaper can drop it; the output tail keeps only the most recent 8,192 bytes
  and interleaves stdout and stderr from spawn time.

### `apps/desktop/electron/backend-start-failure.ts` (11,804 bytes)
- **Purpose:** decide whether a failed boot should be **latched** (cached and re-thrown)
  or left retryable.
- **Key abstractions:** `shouldLatchBackendStartFailure`, `shouldLatchRemoteReauthFailure`,
  `shouldLatchSshClientFailure`, `shouldLatchSshAuthFailure`, `shouldLatchHostKeyChangedFailure`,
  `isRetryableRemoteBootFailure`, `shouldHoldBootProgressForReauth`, `isHostKeyChangedBootFailure`,
  `isSshAuthFailedBootFailure`, `sshClientFailedError`.
- **Data flow:** a failure context (`isLocal`, `isRemote`, `isSupervisorOwned`,
  `isConfirmedReauth`, …) → one of two latches (start-failure / reauth) or neither.
- **Non-obvious design decisions:** **latching is right for a LOCAL backend and wrong
  for a REMOTE one.** A local backend that failed to boot should not be restarted
  over and over; a remote connect can fail transiently (lapsed OAuth cookie, a
  ws-ticket that timed out mid sleep/wake, a host briefly unreachable) and there is
  no child process whose `exit` handler would clear the cache — so a latched remote
  failure sticks until the whole app is relaunched.
- **Edge cases:** unsigned OAuth latches and is never auto-retried; a bare
  `needsOauthLogin` hint does not latch; a confirmed SSH-auth rejection latches;
  the two latches never fire for the same failure.
- **Surprising:** the module carries its own user-facing copy for a broken in-box
  OpenSSH (`Set desktop.ssh_path in config.yaml to a working ssh.exe …`) — the pure
  decision layer ships the sentence the trader reads.

### `apps/desktop/electron/backend-health.ts` (13,002 bytes)
- **Purpose:** poll a backend until it is ready, and classify *why* it is not.
- **Key abstractions:** `waitForHermesReady`, `isConnectionRefusedError`,
  `isServerSideHttpError`, `isMissingHealthEndpointError`, `isAuthRejectionError`,
  `isGatedMissingHealthError`, `makeReauthRequiredError`, `makeUnsignedOauthError`,
  `makeNousCloudBackendDownError`, `isNousCloudAgentUrl`,
  `DEFAULT_BACKEND_READY_TIMEOUT_MS = 180_000`, `DEFAULT_BACKEND_READY_POLL_MS = 500`.
- **Data flow:** poll `/api/health` → on a missing route fall back to `/api/status`
  (only for *old* backends) → on 401/403 raise a reauth error → on 502/503/504 raise
  a Cloud-down error → else keep polling until the deadline.
- **Non-obvious design decisions:** the timeout is **180 s, not 45 s**, because a cold
  boot (plugin discovery + route mounting at web-server import time) takes 45–60 s on
  slow hardware and "every lost race tears down a healthy-but-slow backend and
  re-drives boot, which cascades into minutes of 'not connected' and orphaned python
  processes". The poll returns the moment the backend answers, so fast machines see
  no change.
- **Edge cases:** a refused port on a backend *known* to have bound fails at once; a
  transient health error does **not** trigger the heavyweight `/api/status` fallback;
  an anonymous gate-shaped 401 does (old backend), a credentialed one does not
  (it is a confirmed reauth).

### `apps/desktop/electron/connection-registry.ts` (62,937 bytes)
- **Purpose:** the v2 multi-connection registry — a named list of agent *sources*
  (local runtime, remote gateways, Cloud instances, SSH hosts) all registered at once.
- **Key abstractions:** `normalizeRegistry`, `migrateV1ToRegistry`, `upsertConnection`,
  `removeConnection`, `setPrimaryConnection`, `setLastUsedConnection`, `reconcileRegistryDrift`,
  `reconcileAppliedGlobalConnection`, `normalizeConnectionInput`, `mergeConnectionInput`,
  `agentHandle`, `labelKey`, `uniqueLabel`, `labelSlug`, `backendScopeKey`,
  `parseBackendScopeKey`, `resolvedConnectionId`, `reuseMatchingPrimarySshBackend`,
  `reuseMatchingPrimaryRemoteBackend`, `buildAgentRoster`, `parseRemoteProfileListing`,
  `updateEligibility`, `shouldDeferLocalEnumeration`, `REGISTRY_QUARANTINE_CAP = 20`.
- **Data flow:** a raw JSON blob → `normalizeRegistry` → a v2 `ConnectionRegistry` →
  routing/pooling consume it. The module is deliberately *storage-shaped*, not
  transport-shaped.
- **Non-obvious design decisions:** every connection carries a **required,
  registry-unique label** (case-insensitively unique, so `Homelab` and `homelab`
  cannot coexist); the registry **always contains exactly one `local`** connection
  that cannot be removed and is the default primary; removing the primary retargets
  to `local` rather than leaving a dangling id; a registry entry that fails
  normalization is **quarantined** (raw entry preserved, cap 20) instead of aborting
  the whole load.
- **Edge cases:** duplicate SSH hosts and duplicate gateway URLs are rejected with a
  named error; `id: 'local'` is reserved; a bad launch mode throws; a forced-local
  spawn for a remote-only route is refused rather than silently creating a second
  local backend.
- **Surprising:** `agentHandle()` is the single place the `@<profile>-<label-slug>`
  disambiguation rule lives — the one function that decides how a person is named
  when two sources expose the same profile.

### `apps/desktop/electron/connection-config.ts` (44,170 bytes)
- **Purpose:** pure helpers for the remote-gateway connection config: URL
  normalisation, WS-URL construction (token vs OAuth ticket), auth-mode
  classification and coercion, and profile-scoped request routing.
- **Key abstractions:** `normalizeRemoteBaseUrl`, `buildGatewayWsUrl`,
  `buildGatewayWsUrlWithTicket`, `isGatewayAuthRejection`, `isStaleAppTokenRejection`,
  `gatewayTicketFailure`, `withTransientRetries`, `resolveTestWsUrl`,
  `resolveProfileBackendRoute`, `pathWithProfileScope`, `pathForRegistryBackendRequest`,
  `resolveProfileApiRequest`, `translateSelfProfileQuery`, `authModeFromStatus`,
  `resolveAuthMode`, `cookiesHaveSession`, `AT_COOKIE_VARIANTS`, `RT_COOKIE_VARIANTS`,
  `RESERVED_REMOTE_PROFILES`, `FORBIDDEN_REMOTE_HEADER_NAMES`.
- **Data flow:** config JSON → normalised URL + auth mode + headers → an HTTP or WS
  request routed to the right profile scope.
- **Non-obvious design decisions:** the two auth models are handled explicitly —
  `token` (static session token in a header, `?token=` on the WS) vs `oauth`
  (HttpOnly cookie for REST, a single-use `?ticket=` minted at
  `POST /api/auth/ws-ticket` for the upgrade). A **mint failure is never swallowed**
  into a generic "could not reach"; it produces a specific, actionable sentence
  ("Reached the gateway over HTTP, but the OAuth session was rejected while minting
  a WebSocket ticket. Open Settings → Gateway and sign in again.").
- **Edge cases:** header values are sanitised for CR/LF at ingest (a pasted token
  cannot inject a header); a hostname prefix is not a base-URL match; the reserved
  profile names (`hermes`, `test`, `tmp`, `root`, `sudo`) cannot be used remotely.

### `apps/desktop/electron/updater/index.ts` (3,244 bytes)
- **Purpose:** the update **strategy surface**. Every install shape updates through a
  different owner.
- **Key abstractions:** `UpdaterMechanism`, `MechanismFacts`, `resolveUpdaterMechanism`,
  `UpdaterStatusWire`, `UpdaterApplyResultWire`, `UpdaterStrategy`.
- **Data flow:** facts (payload kind, distribution, stamp) → one mechanism → the
  matching strategy (`app-installer`, `store`, `external`, `windows-handoff`,
  `posix-handoff`, `manual`).
- **Non-obvious design decisions:** the *mechanism is a fact about the artifact*, not
  a user preference — a commit build refuses both check and apply with a manual-update
  escape. `ExternalStrategy` exists for steward-owned deployments and says so in one
  sentence instead of offering a button that cannot work.

### `apps/desktop/electron/updater/channel-protocol.ts` (14,512 bytes)
- **Purpose:** the **sole untrusted-JSON boundary** for the channel feed.
- **Key abstractions:** `decodeChannelRecord`, `decodeChannelManifest`,
  `validateChannelName`, `channelPublicBase`, `channelKey`, `buildPrefix`,
  `sameChannelIdentity`.
- **Data flow:** raw JSON from the feed → validated domain objects. Unknown members
  and primitive checks live here; only validated objects leave the file.
- **Non-obvious design decisions:** the file carries an explicit lint-disable for
  "no runtime typeof / no reflect get" because the whole point is to be the *one*
  place that does runtime type checking on untrusted input. A duplicate JSON member
  is an error (`Duplicate channel JSON member`) — a parser that silently takes the
  last value is a supply-chain hole.
- **Edge cases:** strict regexes for sha256, commit, build id, version and the
  protected archive-ref grammar (`rc.<n>-v<semver>`); an unsupported schema throws.

### `apps/desktop/electron/update-marker-judge.ts` (8,292 bytes)
- **Purpose:** pure parse + judge of the update marker `HERMES_HOME/.hermes-update-in-progress`.
- **Key abstractions:** `parseUpdateMarker`, `judgeMarkerText`, `identityStateSync`,
  `isLiveIdentity`, `hasForeignLiveIdentity`, `UpdateMarker`, `MarkerVerdict`,
  `OWN_CT_EPSILON_S = 0.005`, `CREATE_TIME_TOLERANCE_S = 2.0`, `V1_MAX_AGE_S = 1200`.
- **Data flow:** marker text → `UpdateMarker` → a verdict
  (`malformed | dead | ours | live`) computed from *injected* process facts.
- **Non-obvious design decisions:** the marker format is a **cross-language contract**:
  line 1 = owner pid, line 2 = started_at, line 3 = `ct:<creation time>`, lines 4+ =
  `delegate:<pid> ct:<ct>`. A v2 identity is live only when the pid is alive *and* its
  creation time is within 2 s of the recorded `ct`; a v1 marker (no creation time)
  falls back to a 20-minute age ceiling. The same corpus
  (`tests/fixtures/update_marker_corpus.json`) is run by Python, Rust, bash,
  PowerShell and this TypeScript, so no implementation can drift.
- **Edge cases:** a malformed marker is `malformed`, not "dead"; owner dead but
  delegate live keeps the marker live; `pid 0` is never a process; `started_at` may
  have any digit count but must fit u64.
- **Surprising:** `V1_MAX_AGE_S = 1200` (20 min) is long enough that a recycled pid on
  Windows parks boot for ~20 minutes — the code knows this and the gate has a
  separate path for it.

### `apps/desktop/electron/update-marker-gate.ts` (18,747 bytes)
- **Purpose:** the boot gate's marker probe (R6, "Electron gate" of the update spec).
- **Key abstractions:** `UpdateHoldBoard`, `holdTicker`, `allowStartOverHold`,
  `requestHoldRecheck`, `liveMarkerProbe`, `markerHoldId`, `heldWaitMessage`,
  `startAnywayLogLine`, `HELD_REPROBE_MS = 5_000`, `HELPER_ERROR_ATTEMPTS = 3`.
- **Data flow:** marker → helper script `reclaim` verdict (`absent | reclaimed | held
  | busy | live <pid>`) → a gate state the boot screen renders and the "Start anyway"
  button can override.
- **Non-obvious design decisions:** **Electron never deletes or rewrites the marker.**
  Node has no portable kernel lock, so every read-judge-mutate belongs to the
  checkout's script helper, which holds the `<marker>.lock` kernel lock for the whole
  operation. A dead owner is *not* necessarily a finished update (an inheriting
  completion process can still hold the checkout's lock), so the marker is routed
  through the helper rather than being cleaned up locally.
- **Edge cases:** `held`/`busy`/`live`/`error` are "still running"; a helper that
  fails is retried 3 times; two empty dead markers are two separate holds, so
  "Start anyway" over one does not release the other; a confirmed "Start anyway"
  opens only the hold it names.
- **Surprising:** the hold screen has an explicit `allowStartOverHold(holdId)` — a
  human override that is scoped to a *specific* hold, not a blanket bypass.

### `apps/desktop/electron/updater/marker-helper.ts` (10,426 bytes)
- **Purpose:** the checkout script's marker helper — Electron's only way to mutate
  the update marker.
- **Key abstractions:** `runMarkerHelper`, `markerHelperCommand`, `parseMarkerHelperVerdict`,
  `handoffScriptPath`, `readHandoffProtocol`, `checkoutLockPath`,
  `checkoutLockMayBeHeld`, `MARKER_HELPER_TIMEOUT_MS = 20_000`.
- **Data flow:** Electron → `bash posix.sh --marker-op <op>` or
  `powershell -File windows.ps1 -MarkerOp <op>` → one stdout line → a verdict.
- **Non-obvious design decisions:** the helper's stdout is a **closed vocabulary**: a
  verdict belonging to the *other* op is an error, never clearance. The protocol
  version is read from a `# hermes-handoff-protocol: N` line in the script, so a
  legacy script is detectable rather than silently mis-handled.

### `apps/desktop/electron/hardening.ts` (23,376 bytes)
- **Purpose:** the path/secret/timeout hardening layer every IPC boundary uses.
- **Key abstractions:** `ipcPathError`, `resolveTimeoutMs`, `encryptDesktopSecret`,
  `enableBasicPasswordStoreEncryption`, `clampDataUrlReadMaxMb`,
  `DEFAULT_FETCH_TIMEOUT_MS = 30_000`, `ATTACHMENT_UPLOAD_DEFAULT_MAX_BYTES = 256 MiB`,
  `TEXT_PREVIEW_SOURCE_MAX_BYTES = 64 MiB`, `SAFE_ENV_SUFFIXES`, `SENSITIVE_EXTENSIONS`.
- **Data flow:** a renderer-supplied path → the hardening resolver → a sanitised
  absolute path the OS call may touch.
- **Non-obvious design decisions:** the import specifier is **relative, not
  `@hermes/shared`** — the electron bundle is built by esbuild with no tsconfig path
  resolution, "so a bare specifier would typecheck and then fail to bundle". The
  renderer-facing "the saved token is in plain text" warning fires **only** for the
  genuinely degraded mode; "an absent signal never manufactures a warning".

### `apps/desktop/electron/remote-lifecycle.ts` (66,929 bytes)
- **Purpose:** the SSH remote lifecycle — locate the remote install, gate the remote
  platform, reuse an existing dashboard via a lockfile + an *authenticated* status
  probe, spawn a fresh detached `--isolated --port 0` dashboard and scrape its
  readiness line.
- **Key abstractions:** the module's `export { ... }` block, `LOCKFILE_SCHEMA_VERSION = 2`,
  `PROTOCOL_VERSION = 1`, `READY_RE`, `REMOTE_LOCK_DIR = '~/.hermes/desktop-ssh'`,
  `SUPPORTED_REMOTE_OS = new Set(['Linux','Darwin'])`.
- **Data flow:** SSH exec → remote lockfile → authenticated `/api/status` → either
  attach to the running dashboard or spawn + scrape `HERMES_DASHBOARD_READY port=<n>`.
- **Non-obvious design decisions:** **pid liveness alone is insufficient** — reuse
  requires an authenticated `/api/status` probe, because a lockfile that EXISTS but
  does not match (a fail-closed skew sentinel) must be SKIPPED, not overwritten.
  A remote path is rejected if it contains NUL or a newline.
- **Edge cases:** a skew sentinel blocks reuse; a lockfile whose owner died must be
  skipped rather than killed (killing or overwriting when the local ssh child is
  SIGKILLed loses the live backend).

### `apps/desktop/electron/ssh-connection.ts` (46,592 bytes)
- **Purpose:** an OpenSSH **ControlMaster** connection manager (pure, electron-free).
- **Key abstractions:** `controlSocketPath`, `baseSshOptions`, `hostArgs`, `redactSecrets`,
  `DEFAULT_CONNECT_TIMEOUT_MS = 15_000`, `DEFAULT_EXEC_TIMEOUT_MS = 20_000`,
  `DEFAULT_FORWARD_TIMEOUT_MS = 15_000`, `DEFAULT_TUNNEL_RESTART_LIMIT = 5`.
- **Data flow:** the system `ssh` client (not a JS library, so `~/.ssh/config`, the
  agent, `ProxyJump` and hardware keys all work for free) → a multiplexed master
  socket → exec / forward operations.
- **Non-obvious design decisions:** `redactSecrets` scrubs the spawn-time session
  token env var, `?token=`/`?ticket=` URL params, `Authorization` and
  `X-Hermes-Session-Token` headers, and a credential glued into an ssh target
  string — while leaving legitimate ssh targets untouched. The control socket path is
  kept short and host-distinct so it fits `sun_path` (104 bytes on macOS).
- **Edge cases:** a target that starts with a dash is rejected ("host must not start
  with a dash"); the tunnel restarts are bounded (5).

### `apps/desktop/electron/local-gateway.ts` (33,648 bytes)
- **Purpose:** the per-host gateway multiplexer — `hermes gateway ensure`, its
  readiness verdict, stale-owner restarts, and the ticket-grant purpose taxonomy.
- **Key abstractions:** `runGatewayEnsure`, `parseGatewayEnsureOutput`,
  `ensureLocalGateway`, `isStaleLocalGatewayError`, `redialLocalGateway`,
  `localGatewayDial`, `createLocalGatewayDials`, `routedGatewayEndpoint`,
  `nativeGatewayHttpHeaders`, `nativeGrantPurpose`, `nativeGrantRoute`,
  `GATEWAY_ENSURE_PROTOCOL_DEADLINE_MS = 60_000`, `GATEWAY_ENSURE_CLIENT_GRACE_MS = 15_000`,
  `STALE_RESTART_POLL_MS = 1_000`.
- **Data flow:** ensure → protocol verdict (`ready` or `starting: deadline`) → a
  gateway endpoint → a dial (token or ticket).
- **Non-obvious design decisions:** the client is killed only **after** the protocol
  deadline plus interpreter start and verdict output, "so a slow-but-valid cold start
  is never reported as 'produced no result'". Re-ensuring runs *while* a stale-owner
  restart is in flight, without waiting for it.
- **Edge cases:** the ensure client inherits the caller-scrubbed parent env, never
  the raw one; a stale-control error set is enumerated explicitly; a restart-wait
  owner attaches to a parked prompt.

### `apps/desktop/electron/windows-sandbox-fallback.ts` (14,341 bytes)
- **Purpose:** Windows Chromium/Electron sandbox recovery when the GPU/renderer
  sandbox dies with `STATUS_BREAKPOINT`.
- **Key abstractions:** `decideWindowsSandboxLaunch`, `sandboxMarkerPath`,
  `parseSandboxMarker`, `readSandboxMarker`, `writeSandboxMarker`,
  `shouldAttemptAclRepair`, `buildIcaclsGrantArgs`, `fallbackMarker`,
  `markerAfterSuccessfulBoot`, `WINDOWS_SANDBOX_MARKER_FILENAME`,
  `WINDOWS_SANDBOX_BREAKPOINT_EXIT = -2147483645`, `BOOT_ABORTS_BEFORE_FALLBACK = 2`.
- **Data flow:** the launch decision reads a sticky marker from `userData` → decides
  whether to relaunch with `--no-sandbox` → the relaunched process records the
  outcome.
- **Non-obvious design decisions:** the recovery ladder is (1) ACL repair granting
  `S-1-15-2-2` (ALL APPLICATION PACKAGES) RX on the install tree, (2) `--no-sandbox`.
  ACL repair runs **only when the marker shows a prior aborted boot** — "icacls /T
  recursion is not free". The fallback is **two-strike**: one mid-boot abort does
  NOT drop the sandbox, and an **app update re-probes once** instead of degrading
  forever.

### `apps/desktop/electron/linux-gpu-fallback.ts` (13,959 bytes) and
### `apps/desktop/electron/windows-stack-cookie-fallback.ts` (10,469 bytes)
- **Purpose:** two sibling fallbacks with the *same* shape — a sticky per-version
  marker that turns a crash-loop into a software-rendering boot, and a one-shot
  re-probe after an app update.
- **Key abstractions:** `decideLinuxGpuLaunch`, `linuxGpuMarkerAfterSuccessfulBoot`,
  `shouldEngageSilentGpuRetryFallback`, `shouldRelaunchForRendererStackCookieCrashLoop`,
  `decideWindowsGpuStackCookieLaunch`, `BOOT_ABORTS_BEFORE_LINUX_GPU_FALLBACK = 2`,
  `WINDOWS_STACK_COOKIE_EXIT = -1073740791`.
- **Non-obvious design decisions:** the Linux one is **reactive, not proactive** —
  a healthy Mesa/Wayland stack never pays the cost. The Windows one is deliberately
  scoped to a *renderer* `crashed` with that exact exit code, "and must not drop the
  sandbox for this signature" (the sandbox fallback owns `STATUS_BREAKPOINT`).

### `apps/desktop/electron/preload.ts` (39,730 bytes, 718 lines)
- **Purpose:** the sandboxed `contextBridge` surface exposed to every renderer.
- **Key abstractions:** the `window.hermesDesktop` bridge — `hermes:api` invoke,
  `hermes:openExternal`, the connection/registry calls, zoom, keep-awake, flags,
  the local skin, and the external-open failure channel.
- **Non-obvious design decisions:** the preload **may only require electron, events,
  timers and url** — importing `node:os` in the preload throws before `contextBridge`
  runs and "takes the ENTIRE bridge down with it (window.hermesDesktop undefined =>
  'Desktop IPC bridge is unavailable')". That is why a synchronous "can this OS do
  glass?" question is asked of *main* rather than answered locally. Any import that
  transitively reaches `node:fs` is fatal (`window-controls.ts` carries the same
  warning for its WSL detection).

### `apps/desktop/electron/quit-guard.ts` (5,839 bytes)
- **Purpose:** ask before quitting while turns are in flight.
- **Key abstractions:** `normalizeActiveWork`, `mergeActiveWork`, `quitPromptFor`,
  `backendOwnedByApp`, `shouldGuardWindowClose`, `NO_ACTIVE_WORK`, `MAX_LISTED = 4`.
- **Non-obvious design decisions:** the prompt is **different for an owned vs an
  attached backend**. The local profile gateway is *attached* (`hermes gateway
  ensure`), so it keeps cron, messaging adapters and the in-flight turn running
  after the app quits — exactly like a remote URL or Cloud backend — and the prompt
  says so instead of warning about lost work. Only an SSH-managed server the app
  starts and stops is "owned".
- **Edge cases:** two windows reporting the same session are de-duplicated by id;
  untitled sessions still count; the list is capped at 4 with a summary beyond.

### `apps/desktop/electron/log-rotation.ts` (2,932 bytes)
- **Purpose:** bound every log the shell keeps across launches.
- **Key abstractions:** `planLogRotation`, `reclaimActiveLogIfOversized`,
  `logBackupPath`, `LOG_MAX_BYTES = 10 MiB`, `LOG_BACKUP_COUNT = 3`,
  `LOG_DISCARD_BYTES = LOG_MAX_BYTES * 4`, `ACTIVE_LOG_POLL_MS = 5 min`.
- **Non-obvious design decisions:** rotation **bounds growth but never reclaims** — a
  plain rotation renames the monster to `.1` and strands it. So anything past the
  discard ceiling is deleted outright: "the updated app self-heals a disk a stale
  build filled, on the next launch". A live log is reclaimed *in place* (truncate),
  not rotated, so an append-mode writer restarts cleanly.

### `apps/desktop/electron/crash-forensics.ts` (2,911 bytes)
- **Purpose:** last-chance forensics for the main process.
- **Key abstractions:** `installCrashForensics`, `describeCrashReason`,
  `markExpectedTransition`, `isExpectedTransition`, `EXPECTED_TRANSITION_FLAG`.
- **Non-obvious design decisions:** Electron installs its own `uncaughtException`
  listener and only warns on unhandled rejections, so the reason lands on stderr
  alone — which is discarded entirely when the app is launched from Finder or the
  Start menu. An **expected** transition (a quit sentinel) is stamped so it is
  recorded as a one-line event rather than a stack; an unmarked error with the same
  message still renders in full.

### `apps/desktop/electron/backend-dial-claim.ts` (2,152 bytes) and
### `apps/desktop/electron/oauth-login-flights.ts` (5,550 bytes)
- **Purpose:** single-owner claims in the main process.
- **Key abstractions:** `BackendDialClaims`, `loginFlightKey`, `OauthLoginFlights`,
  `SilentLoginSuppressedError`, `LoginJoinTimeoutError`.
- **Non-obvious design decisions:** the renderer-side in-flight lock only dedupes
  inside one window; two windows racing the same wake could bootstrap a *duplicate
  remote backend*, so the claim belongs in main, keyed by
  `(connectionId, profile)`. The OAuth flight rule is finer still: **background**
  work joins a running flow but waits at most N, **foreground** work (a user click)
  never waits behind a background cooldown, and a second background attempt would
  replace the gateway's single PKCE state cookie and fail the first callback with
  `state_mismatch`.

### `apps/desktop/electron/notification-registry.ts` (1,309 bytes) and
### `apps/desktop/electron/event-dedupe.ts` (2,075 bytes)
- **Purpose:** cross-window de-duplication of one-shot side effects.
- **Key abstractions:** `createNotificationRegistry`, `createEventDeduper`,
  `createAmbientClaimArbiter`, `NOTIFICATION_RETENTION_TTL_MS`, `SPEECH_CLAIM_TTL_MS`.
- **Non-obvious design decisions:** every desktop window is its own renderer process,
  so N windows each react to the same backend event. Main is the race-free owner:
  the first window to claim a key within the interval wins. A **spoken reply** is
  claimed for 10 minutes ("one reply is one claim for as long as a reply can
  plausibly play") while a beep is claimed for 1 s.

### `apps/desktop/electron/stream-throttle.ts` (5,305 bytes)
- **Purpose:** stream-aware background throttling for chat windows.
- **Key abstractions:** `createStreamThrottle`, `RETHROTTLE_DELAY_MS = 5_000`.
- **Non-obvious design decisions:** a static `backgroundThrottling: false` in
  `webPreferences` "pins the renderer's `document.visibilityState` to 'visible' for
  the life of the window, which turns every visibility-gated poll and clock tick
  into an always-on timer. An idle, hidden Hermes burned ~20% CPU forever." So it is
  a **runtime dial** driven by the same "which chats are mid-turn" reports the quit
  guard already uses.

### `apps/desktop/electron/bundle-skew.ts` (7,940 bytes) and
### `apps/desktop/electron/bundle-swap.ts` (5,577 bytes)
- **Purpose:** detect a NEW runtime running under an OLD renderer.
- **Key abstractions:** `detectBundleSkew`, `createBundleSkewChecker`,
  `isFallbackCommit`, `RUNTIME_PATHS`, `detectBundleSwap`, `readBundleSwapStamp`,
  `relaunchIntoSwappedBundle`, `BUNDLE_SWAP_RELAUNCH_FLAG`.
- **Non-obvious design decisions:** ancestry is checked **first**
  (`git merge-base --is-ancestor`) because `A..HEAD` only means "how far HEAD is
  ahead of A" when A is an ancestor; otherwise the count degenerates to HEAD's own
  history and "the count is a permanent >= 1 even when apps/desktop is byte-identical".
  The detection is scoped to runtime paths so docs/e2e churn stays quiet, and it is
  **fail-quiet**: no stamp, a fallback all-zero stamp, an unknown commit, a
  non-ancestor or any git failure all report "not stale" — "this warning must never
  false-positive — it tells users their install is torn."

### `apps/desktop/electron/renderer-bundle.ts` (8,764 bytes)
- **Purpose:** detect a torn renderer bundle (index.html from one generation, hashed
  chunks from another).
- **Key abstractions:** `parseModuleAssetRefs`, `parseLazyChunkRefs`,
  `missingRendererAssets`, `presentRendererIndexes`.
- **Non-obvious design decisions:** the check parses the module graph
  (`__vite__mapDeps`) rather than trusting the manifest, and it **never stats** a
  path inside `app.asar` — "renderer index probes never stat, so app.asar paths
  never construct" a deprecated `fs.Stats` object and print DEP0180 on every
  packaged launch.

### `apps/desktop/electron/renderer-log.ts` (4,180 bytes)
- **Purpose:** console/error capture for **every** renderer-content window.
- **Key abstractions:** `attachRendererConsoleCapture`, `formatRendererConsoleLine`,
  `formatRendererBoundaryReport`.
- **Non-obvious design decisions:** the hook used to exist only on the primary
  window, so "a renderer crash in ANY other window — secondary session windows,
  instance windows, the HUD, quick entry, the pet overlay — evaporated with the
  window". Windows that load *external* content (OAuth portals) must **not** attach,
  because third-party pages can log anything.

### `apps/desktop/electron/secret-storage-policy.ts` (3,952 bytes)
- **Purpose:** the single owner of "do we use the OS keychain at all?".
- **Key abstractions:** `readSecretStoragePolicy`, `writeSecretStoragePolicy`,
  `classifyStoredSecret`, `SECRET_STORAGE_POLICY_FILE = 'secure-token-storage.json'`.
- **Non-obvious design decisions:** Electron `safeStorage` on macOS parks a per-app
  key in the login keychain; on a machine with a broken default keychain **any**
  `safeStorage` touch — *including `isEncryptionAvailable()`* — makes macOS throw a
  blocking "Keychain Not Found" dialog on every launch. So keychain-backed
  encryption is **opt-in**, and a truthy-but-not-`true` value does not enable it.

### `apps/desktop/electron/preview-reach.ts` (6,553 bytes)
- **Purpose:** make a remote loopback URL true on the *user's* machine.
- **Key abstractions:** `openPreviewReach`, `loopbackTarget`, `rewriteToLocalPort`,
  `PreviewReachRegistry`, `PREVIEW_REACH_LEASE_MS = 15 min`.
- **Non-obvious design decisions:** the agent's "your dev server is at
  `http://localhost:5173`" is true *there* and meaningless *here* — locally it is
  usually nothing at all. The fix opens a local→remote forward **over the transport
  already authenticated on** — "No new credentials, no new listening surface beyond
  one loopback-bound port" — and hands the renderer a `127.0.0.1:<port>` URL. The
  lease expires after 15 minutes.

### `apps/desktop/electron/favicon.ts` (10,515 bytes)
- **Purpose:** thorough favicon resolution.
- **Key abstractions:** `iconCandidatesFromHtml`, `iconCandidatesFromManifest`,
  `fallbackIconCandidates`, `rankCandidates`, `sniffImageMime`, `resolveFavicon`,
  `SCORE_SVG = 1024`, `SCORE_ANY = 512`, `SCORE_APPLE_TOUCH = 180`.
- **Non-obvious design decisions:** read the page, collect every declared icon, rank
  them, and only then fall back to the well-known paths — but **only the site's own
  marks**. "A public icon service would answer for the hosts that hide behind a bot
  wall, but asking one means telling a third party which connector a user is wiring
  up." A site that cannot be read keeps its monogram.

### `apps/desktop/electron/link-title-wall.ts` (5,137 bytes)
- **Purpose:** the ladder between the curl tier and the hidden-Chromium tier of
  link-title resolution.
- **Key abstractions:** `isAuthWall`, `needsRendererFallback`, `resolveLinkTitle`,
  `AUTH_WALL_BODY_RE`, `RENDERER_WALL_HOSTS`.
- **Non-obvious design decisions:** the title partition is cookieless, so a Google
  Workspace link answers tier 1 with Google's **sign-in page** — and tier 2 used to
  be reached *exactly* when tier 1 produced no usable title, i.e. for every sign-in
  wall. Loading that wall in the real hidden Chromium "makes it ask the OS
  authenticator for a passkey: a native credential dialog on the user's desktop for
  what is only a link title." So proven auth walls are classified and never escalate.

### `apps/desktop/electron/connection-config-apply.ts` (1,741 bytes)
- **Purpose:** atomic application of a connection config.
- **Key abstractions:** `applyConnectionConfigAtomically`.
- **Non-obvious design decisions:** a **reachability preflight runs BEFORE either
  file is written**, so a rejected OAuth session or a blocked `/api/ws` "leaves the
  previous primary/current connection intact rather than committing a gateway the
  app cannot actually reach". If activation fails, both stores roll back.

### `apps/desktop/electron/managed-ssh-update.ts` (49,522 bytes)
- **Purpose:** the desktop-managed SSH **update transaction** (electron-free).
- **Key abstractions:** the module's `export { ... }`, `UPDATE_EXIT_INDEPENDENT_HANDOFF = 75`,
  `DEFAULT_REMOTE_UPDATE_TIMEOUT_MS = 1 h`, `DEFAULT_REMOTE_CLEARANCE_TIMEOUT_MS = 5 min`,
  `DEFAULT_REMOTE_UPDATE_POLL_MS = 1 s`, `RECEIPT_GRACE_MS = 15 s`.
- **Data flow:** gate dials → drain every captured scope → detached `hermes update` →
  correlated terminal marker + durable receipt → restore every scope → lift the gate.
- **Non-obvious design decisions:** a remote URL/Cloud connection **never enters this
  lifecycle** — only SSH scopes whose serve process is proved by the Desktop
  ownership record. A correlated exit 0 ends it at once; otherwise it stops without
  writing a receipt (a receipt reporting a non-success is worse than none).

### `apps/desktop/electron/handoff-result.ts` (7,038 bytes)
- **Purpose:** consume the detached update hand-off's result file exactly once.
- **Key abstractions:** `readAndConsumeHandoffResult`, `handoffResultPath`,
  `HandoffResult`, `HANDOFF_RESULT_MAX_AGE_MS = 30 min`.
- **Non-obvious design decisions:** **read-and-delete**, so a result is reported at
  most once. Ordinary results older than the freshness window are discarded unread
  ("a stale file from a crashed relaunch chain must not resurface days later") — but
  `manual: true` results are **exempt** from the window, because they are the
  durable action-required channel. Malformed JSON is kept as `.corrupt`, not
  reported.

### `apps/desktop/electron/profile-delete-routing.ts` (7,423 bytes) and
### `apps/desktop/electron/profile-rename-routing.ts` (3,450 bytes)
- **Purpose:** routing for destructive profile operations.
- **Key abstractions:** `decideProfileDeleteAction`, `ProfileDeletionGate`,
  `assertLocalProfileCanStart`, `prepareProfileRenameLifecycle`.
- **Non-obvious design decisions:** a delete must tear down the backend **and** route
  the DELETE away from the just-deleted profile, and a concurrent or delayed start
  must be rejected — "spawning a fresh backend would call `ensure_hermes_home()` and
  recreate the profile directory the delete just removed, leaving a zombie process
  behind". A rename makes `default` the temporary primary before stopping the old
  backend, so concurrent requests share the temporary connection instead of
  respawning the profile mid-rename.

### `apps/desktop/electron/windows-child-options.ts` (2,557 bytes) and
### `apps/desktop/electron/no-console-git.ts` (10,704 bytes)
- **Purpose:** make Windows child processes invisible.
- **Key abstractions:** `windowsShellCommand`, `hiddenWindowsChildOptions`,
  `CREATE_NO_WINDOW = 0x08000000`, `NO_CONSOLE_GIT_SCRIPT`, `planNoConsoleGitSpawn`,
  `simpleGitBinary`, `killTimedGitChildren`.
- **Non-obvious design decisions:** `windowsHide` is `SW_HIDE` and "from a
  console-less parent, does not stop that flash". The flag that does is
  `CREATE_NO_WINDOW`, so git is spawned *from a hidden python host* that forwards
  the git argv unchanged — "simple-git cannot take a creation flag, so its binary
  tuple is `[python, this host script]`".

### `apps/desktop/electron/backend-connection-state.ts` (5,555 bytes)
- **Purpose:** the generation-guarded state machine for backend connection attempts.
- **Key abstractions:** `createBackendConnectionState`, `BackendConnectionAttempt`,
  `BackendProcessOwner`.
- **Non-obvious design decisions:** a **generation counter** invalidates late
  attempts: an invalidated remote attempt cannot publish a late descriptor, and a
  stale backend `exit` cannot clear a newer connection attempt's promise. A failed
  primary stop **retains its child** and blocks a replacement until the caller
  retries the shutdown.

### `apps/desktop/electron/gateway-file-download.ts` (20,006 bytes)
- **Purpose:** save a gateway-hosted file to the local disk without buffering it
  whole.
- **Key abstractions:** `pumpStreamToFile`, `writeBufferToFile`, `parseDataUrlToBuffer`,
  `filenameFromContentDisposition`, `saveDialogFilters`, `finalizeGatewayDownload`,
  `destroyStalledBody`, `downloadTempPath`.
- **Non-obvious design decisions:** it waits for the save dialog **before** streaming,
  into a sibling temp file with backpressure, and renames onto the destination only
  once the body has landed in full — "a large download never has to be buffered
  whole in the native process, and a failed one never touches a file that was
  already at the destination."

---


### Tier 1 (continued) — the remaining source files, one line each

The modules above have full entries. Every remaining source file in the shard is
listed here exactly once, in shard order, with what it actually does.

| File | What it is / what it pins |
| --- | --- |
| `apps/desktop/electron/active-runtime-state.ts` | Decides "can we launch the local runtime now?" — runtime *usability* is authoritative, the bootstrap marker is only provenance, so a missing marker never strands a healthy install (#60721, #72166). |
| `apps/desktop/electron/api-expected-404.ts` | The `hermes:api` expected-404 sentinel: a handler *resolves* with `__hermesExpected404__` and the preload rethrows it, so Electron stops printing a stack trace for every expected 404 in the session probe ladder. |
| `apps/desktop/electron/app-icon.ts` | Fail-soft app-icon resolution: `statSync().isFile()` proves existence, not decodability, and Electron's `BrowserWindow({icon})` decodes synchronously and throws — so the ladder skips a candidate that does not decode, and never probes inside `app.asar` (DEP0180). |
| `apps/desktop/electron/app-installer-file.ts` | Downloads the Windows `.appinstaller` descriptor to a temp file before teardown, with a 1 MiB cap, a 30 s timeout and `redirect: 'error'`. |
| `apps/desktop/electron/app-updater.ts` | The win32 update arm for bundled installs: the OS App Installer owns the apply, so the app's only job is the check (via payload python's `winrt`), the prompt, the teardown, and the trigger. |
| `apps/desktop/electron/app-version.ts` | Version identity for the About panel: `packagedReleaseChannel`, `appVersionInfo`, `nativeAboutVersion` — treats `''`, `0.0.0`, `v0.0.0` and `unknown` as "no version known" so the panel never reports "Version 0.0.0" (#124581). |
| `apps/desktop/electron/appinstaller-checker.ts` | A bounded child run for the App Installer checker: two independent bounds (its own deadline + `execFile`'s timeout kill) so a kill the child never answers cannot hold the update check hostage; resolves an honest "unknown", never a fake "no update". |
| `apps/desktop/electron/application-menu-startup.ts` | Orders the macOS application menu *after* the first BrowserWindow — AppKit routes key equivalents through the menu's delegate and Electron's delegate segfaults before any window exists (#115332). |
| `apps/desktop/electron/backend-child.ts` | Windows-aware backend teardown: tree-kill on Windows, **process-group** kill on POSIX (`process.kill(-pid)`) so MCP grandchildren are not orphaned; extracted to be testable without Electron. |
| `apps/desktop/electron/backend-command.ts` | Routes the spawn between `hermes serve` and the legacy `hermes dashboard --no-open` when the resolved runtime predates `serve`; `sourceDeclaresServe` reads the runtime's own source before probing the CLI. |
| `apps/desktop/electron/backend-descriptor-cache.ts` | Ownership helpers for the descriptor cache: a late dial failure forgets only *its own* entry, and an entry forgotten mid-flight (profile delete, retirement) can neither be resurrected nor evict the winner. |
| `apps/desktop/electron/backend-discovery.ts` | Host-level backend discovery — attaches to a `hermes serve` already listening on the host instead of spawning a second one; the `spawn-ledger.json` is *discovery only*, never proof of a usable backend. |
| `apps/desktop/electron/backend-env.ts` | Builds the env for a local `hermes serve` child: scrubs `PYTHONPATH`/`PYTHONHOME`, keeps the inherited PATH first and appends missing sane entries, forces `PYTHONUTF8`, and maps a profile home back to the global `HERMES_HOME`. |
| `apps/desktop/electron/backend-probes.ts` | Bounded runtime probes — "a file on disk is not proof of a usable runtime": a 15 s import probe of `hermes_cli`, with an explicit Hermes override that is authoritative when non-empty. |
| `apps/desktop/electron/backend-ready.ts` | Waits for `HERMES_BACKEND_READY port=<n>` (or the legacy `HERMES_DASHBOARD_READY`), tolerating a line split across chunks, and treats a "source update completing" banner as a reason to extend the deadline (5 min grace, 30 min total). |
| `apps/desktop/electron/backend-recycle.ts` | Recycles a backend behind a code-skew 503: kill the owned remote serve *first* (while the SSH channel can still exec), then tear down the local child; a local profile restarts the host gateway before dropping the descriptor. |
| `apps/desktop/electron/backend-release-gate.ts` | The Windows pre-update unlock gate — `taskkill /T /F` returns when termination is *initiated*, so the gate requires BOTH the shim unlocked AND every signalled PID gone from the process table; at the 15 s deadline the old shim-only criterion is kept as the escape hatch. |
| `apps/desktop/electron/backend-resolution.ts` | The `HERMES_DESKTOP_IGNORE_EXISTING=1` gate that keeps Desktop off installed runtimes — but a runtime *this launch* installed is always used, so the post-install re-resolve does not fall back into the installer. |
| `apps/desktop/electron/backend-serve-support.ts` | Caches the "does this runtime understand `serve`?" answer per resolved runtime, with source inspection first and a CLI probe as fallback — but a probe that failed *by timeout* is evicted so a cold-AV false negative is not pinned for the process lifetime. |
| `apps/desktop/electron/backend-spawn-env.ts` | One env var (stay-alive on all-adapters-down) written LAST so no earlier spread can override it, because the desktop spawns `hermes serve` with no supervisor to revive a failure exit. |
| `apps/desktop/electron/backend-start-cancellation.ts` | `runBackendStartStep` — cancels a startup wait and checks ownership before invoking the continuation, so a superseded start cannot publish a late backend. |
| `apps/desktop/electron/bootstrap-failure-copy.ts` | Turns a failed install stage name + raw error into an Error.message the overlay shows verbatim: a plain lead sentence naming the step in everyday words, with the raw error on a trailing "Details:" line. |
| `apps/desktop/electron/bootstrap-platform.ts` | Decides whether to disable GPU acceleration (remote/forwarded displays) and which Linux password store to use; `HERMES_DESKTOP_DISABLE_GPU` overrides detection both ways. |
| `apps/desktop/electron/bootstrap-repair-guard.ts` | The repair-loop breaker: distinguishes "the venv is genuinely broken" (hard reinstall) from "the runtime is healthy but stalled" (restart only), with a bounded soft-restart budget so a corrupted install still escalates. |
| `apps/desktop/electron/bootstrap-runner.ts` | (1,048 lines) Drives the first-launch install stage by stage, streaming `manifest`/`stage`/`log`/`complete`/`failed` events to the renderer; resolves the install script (bundled / local / downloaded by ref), pins a commit or a branch, and strips ANSI/CR redraw noise from installer output. |
| `apps/desktop/electron/bootstrap-state.ts` | An 8-line snapshot helper over `INSTALL_STAMP` — the bootstrap's view of the install shape. |
| `apps/desktop/electron/browser-windows.ts` | The popped-out in-app browser window URL — `?win=browser` must sit **before** the `#` or the HashRouter swallows it as part of the route. |
| `apps/desktop/electron/challenge-window-ipc.ts` | The one-line IPC registration for the free-tier challenge window. |
| `apps/desktop/electron/challenge-window.ts` | The free-tier browser challenge: a **hidden** window loads the portal page, is revealed only if the page asks for the human, and closes on completion — the page talks to us through its URL fragment, so no bridge into the page is needed. |
| `apps/desktop/electron/cli-provision.ts` | Creates/removes only the absolute, same-name CLI links this bundle's provisioner created — a foreign or live link is left alone, and a failed swap preserves its source and target. |
| `apps/desktop/electron/close-stop-kill.ts` | Windows close/stop: the tree-kill is *not* widened — the caller passes the owned PIDs — a taskkill error is recorded, never discarded, and only locks with no live holder are cleared. |
| `apps/desktop/electron/cloud-boot-cascade.ts` | The pure decision seam for self-healing a Cloud agent connection at boot: only a Cloud + OAuth + *unsigned* reauth error qualifies for the silent per-agent sign-in cascade. |
| `apps/desktop/electron/cloud-discovery.ts` | Falls back from a remembered team to current memberships exactly once, and only for the (status, code) pairs that mean the team itself is gone. |
| `apps/desktop/electron/cloud-session-recovery.ts` | Coalesces the Cloud cookie refresh but **never** reuses the single-use ticket minted afterwards, and backs off a failed recovery with a bounded retry. |
| `apps/desktop/electron/command-screenshot-capture.ts` | A physical gesture grants one renderer one capture — denied, expired, concurrent and disabled captures all drop without leaking. |
| `apps/desktop/electron/command-screenshot-monitor.ts` | Launches the unpacked native gesture helper and delivers only version-tagged status frames; startup and termination are bounded and a permission failure is preserved. |
| `apps/desktop/electron/command-screenshot-types.ts` | The three shapes (status / window / result) the screenshot API is made of. |
| `apps/desktop/electron/command-screenshot.ts` | The opt-in native gesture install: no renderer can request an arbitrary screenshot, a guest frame's request throws, and the setting must be a boolean. |
| `apps/desktop/electron/composer-image-name.ts` | Filename stamping for pasted composer images uses the user's **local** wall clock, not `toISOString()` — otherwise the name disagrees with the file's mtime by the zone offset (#96403). Machine-facing artifacts keep UTC on purpose. |
| `apps/desktop/electron/composer-paste.ts` | Persists a large plain-text paste as a `.txt` chip in `<HERMES_HOME>/composer-pastes` — the renderer never chooses the path, because that is the only directory the backend admits `@file:` attachments from. |
| `apps/desktop/electron/connection-apply.ts` | Connection-change ordering: a second before-quit must still wait for an in-flight remote kill, otherwise Electron exits while the detached `serve --isolated` stays at pid 1. |
| `apps/desktop/electron/connection-caches.ts` | The connection-id-keyed main-process caches, with one `evictConnectionCaches(id)` — they live in one module so the "only valid while the id points at the same machine" invariant has somewhere to be stated and tested. |
| `apps/desktop/electron/connection-route-identity.ts` | Canonical registry route identity, frozen **before** dialing while the full auth/transport envelope still exists — compatibility callers may reuse it but must never reconstruct a stronger identity from post-dial metadata. |
| `apps/desktop/electron/connection-window-state.ts` | Reads the *sender* window's live chrome state at IPC-reply time, not the mint-time snapshot baked into a cached backend descriptor (which goes stale the moment the user toggles fullscreen). |
| `apps/desktop/electron/dashboard-token.ts` | Local dashboard session-token discovery: the dashboard is the source of truth for the token it serves, so a spawned token that drifts is adopted (and logged) rather than silently breaking `/api/ws`. |
| `apps/desktop/electron/data-paths.d.mts` | The typed surface of the shared path resolver, for consumers that cannot import extensionless TS. |
| `apps/desktop/electron/data-paths.mjs` | The pure path-resolution core shared by the app and the CI smoke driver (which runs under Node's type-stripping and cannot import extensionless TypeScript) — `platformDefaultHermesHome`, `resolveDesktopUserData`, `resolveDesktopHermesHome`. |
| `apps/desktop/electron/data-paths.ts` | A 6-line typed re-export of `data-paths.mjs`; the two files must stay in lockstep and every behaviour is exercised through this re-export. |
| `apps/desktop/electron/deep-link-protocol.ts` | `hermes://` registration — every launch rewrites the OS handler, so `HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION=1` leaves it untouched for dev/E2E runs while argv/second-instance deep links still route. |
| `apps/desktop/electron/desktop-boot-preference.ts` | The boot-profile preference file: a missing file is a fresh install, but an **unreadable** one must not be treated as permission to replace it; writes preserve fields the caller does not own. |
| `apps/desktop/electron/desktop-installation.ts` | A stable per-installation UUID plus an SSH ownership id that does not disclose it; a repair lock names its holder (`<pid>\nct:<creation time>\n`) so a crashed launch's lock is reclaimed by **owner liveness** instead of bricking every later launch. |
| `apps/desktop/electron/desktop-log-line.ts` | The one log-line format for `desktop.log`, the in-app RECENT LOGS view and crash forensics — the stamp matches Python's default `asctime` shape so every file in `logs/` reads on one clock and one parser can read them all. |
| `apps/desktop/electron/desktop-plugin-install.ts` | Probes and installs desktop plugins from Git: `owner/repo` shorthand, monorepo subdirs, hash subdirs, path-traversal rejection, insecure-scheme warnings, and a 300 s git timeout. |
| `apps/desktop/electron/desktop-plugin-remove.ts` | Deletes exactly one named folder under the app-level plugin root; refuses a unified package's desktop half (it would be re-copied and flicker) and never follows a symlink. |
| `apps/desktop/electron/desktop-plugins-root.ts` | The one-time migrations that make `<HERMES_HOME>/desktop-plugins` the **only** place desktop code loads from — profile-scoped and unified-package halves are lifted into the app root so a plugin does not "vanish" when the profile changes. |
| `apps/desktop/electron/desktop-profile.ts` | Window↔profile↔connection routing: explicit peer intent wins, a generic New Window inherits its IPC sender (never "whichever window happened to gain focus while IPC was queued"), and the profile-name regex is the single definition. |
| `apps/desktop/electron/desktop-remote-route.ts` | The v1 SSH pool key vs the v2 registry identity: the bootstrap stores the tunnel under `sshScopeKey(profile)`, and a registry `connectionId` is *identity, not the pool key* — looking up by the wrong key misses the live tunnel. |
| `apps/desktop/electron/desktop-shared-metrics.ts` | The once-per-launch startup-latency claim, the packaged self-update recorder and the consent-gated renderer-crash recorder the renderer drains once a backend attaches. |
| `apps/desktop/electron/desktop-uninstall.ts` | Maps the three user-facing uninstall modes (`gui`/`lite`/`full`/`data`) onto the CLI's flags, resolves the running app bundle/exe per OS, and builds the detached cleanup script. |
| `apps/desktop/electron/dev-cdp.ts` | Opens the Chrome DevTools Protocol port for a **dev-server** run only (9222, so the repo's existing CDP tooling just works) — a packaged build never opens it, however loudly the env asks. |
| `apps/desktop/electron/dock-launch-order.ts` | The deep link must be registered **before** the single-instance lock on macOS, or the relaunch a second Dock icon. Non-macOS takes the lock at module load and registers on ready. |
| `apps/desktop/electron/embed-host.ts` | A loopback host that serves one tiny YouTube wrapper page per video, so only the wrapper has an http(s) origin — the renderer, its storage and its backend connections stay on `file://`. |
| `apps/desktop/electron/embed-referer.ts` | Stamps a Referer on YouTube requests **in the embed partition only**. |
| `apps/desktop/electron/entitlements.mac.inherit.plist` | (config) The macOS sandbox entitlements the *inherited* helper processes get: JIT, unsigned executable memory, library validation, camera and microphone — deliberately **without** the calendars/reminders personal-information entries the full app carries. |
| `apps/desktop/electron/entitlements.mac.plist` | (config) The macOS hardened-runtime entitlements for the app bundle: JIT, unsigned executable memory, library validation, audio input, camera, calendars and reminders. |
| `apps/desktop/electron/entry.ts` | The pre-`ready` entry point: resolves the home through the shared resolver so `desktop.electron_flags` reaches the relaunch as well as the app. |
| `apps/desktop/electron/external-open.ts` | The single route every external URL open flows through (http/https/mailto allowlist, guarded `file:`, a WSL path); a URL is opened exactly once and a failure is reported through a notify channel the renderer renders as a fallback modal. |
| `apps/desktop/electron/external-terminal.ts` | Hands a session to the user's own terminal: writes a launcher script (because the runtime is often `python -m hermes_cli.main`, not a `hermes` on PATH) and resolves the emulator per platform — macOS `open` with **no** `-a`, a Linux ladder led by `x-terminal-emulator`, Windows Terminal then `cmd.exe`. |
| `apps/desktop/electron/f12-shortcut.ts` | The F12 arbitration: block / devtools / forward / ignore, decided purely so it can be tested. |
| `apps/desktop/electron/feature-flags.ts` | `--local` opts into local-model surfaces on any channel; `isCanaryTag` recognises canary stamps and rejects stable/dev. |
| `apps/desktop/electron/find-in-page-native-fixture/package.json` | (config) A 6-line private ESM package whose `main` is the find-in-page native fixture test — the fixture's own manifest so it can be loaded as a module. |
| `apps/desktop/electron/find-in-page.ts` | The native find-in-page bridge: routes a Cmd/Ctrl+F to the **requesting** window, shapes the `found-in-page` payload (coercing missing fields to zero so the renderer never sees NaN), and installs the shortcut with a Linux-specific workaround for GNOME/Pop!_OS. |
| `apps/desktop/electron/first-run-setup-gate.ts` | The first-run card's gate: `continue-local` / `remote-applied` / `reset`, with concurrent waiters prompted once and a reset that explicitly settles an active waiter. |
| `apps/desktop/electron/fixtures/source-backend.py` | A test fixture that builds a throwaway wheel + uv project and runs it, proving the "source backend" bootstrap path end to end. |
| `apps/desktop/electron/fixtures/system-ca.ts` | Synthetic self-signed CA certificates (no private keys retained) for the OS-trust tests; the tests freeze time between the expired root's 2025 expiry and the others' 2035. |
| `apps/desktop/electron/fs-ipc.ts` | The filesystem IPC surface — directory reads, reveal, plugin roots, rename/write/trash — with path hardening, `HERMES_HOME` resolution and the git binary injected; a plugin install reports **both** the agent and desktop halves. |
| `apps/desktop/electron/fs-read-dir.ts` | Directory listing for the project tree: always-hidden noise (works without a .gitignore), directories before files, symlinks stat'ed, bounded stat concurrency (16), and filesystem error codes returned instead of thrown. |
| `apps/desktop/electron/gateway-download-transport.ts` | The native-descriptor download transport: **retry only the connection phase**, never a save dialog or a partially saved body; a stalled body is destroyed after the idle deadline. |
| `apps/desktop/electron/gateway-file-download-transport.ts` | The token and OAuth download transports: an idle deadline reset per chunk, an HTTP error preserved as `statusCode`, and a cookie session whose absence is an explicit error. |
| `apps/desktop/electron/gateway-stop-before-update.ts` | On Windows, the uninstall delegates fleet draining to the CLI (`gateway stop --all`) before files are deleted; best-effort, never throws. |
| `apps/desktop/electron/gateway-version.ts` | The connected process owns its runtime version, not a checkout on disk — `displayVersion` carries the distance past the release tag (`0.21.5+1913`). |
| `apps/desktop/electron/gateway-ws-probe.ts` | Live WebSocket validation for "Test remote": HTTP status and the WS upgrade use different processes, transports and credentials, and the server applies extra upgrade guards — so a green status check followed by an opaque "Could not connect" is the classic failure. The probe is injectable and can keep waiting while the child is alive. |
| `apps/desktop/electron/get-windows.d.ts` | Type declarations for the `get-windows` **optionalDependency**, which `npm ci` can legitimately skip — the runtime import degrades to null when it is absent. |
| `apps/desktop/electron/git-binary-candidates.ts` | Where a Windows git binary may live: UGit's `app-*` glob (sorted by version, not lexically), PM-managed git under `hermes/tools`, and the bundled portable git. |
| `apps/desktop/electron/git-ipc.ts` | The git IPC surface — worktree management, the composer coding rail's repo status, the review pane, repo-first discovery — with the git/gh resolvers injected. |
| `apps/desktop/electron/git-repo-scan.ts` | Repo-first discovery by walking bounded roots with Node's fs only; skips junk and Apple media packages, dedupes overlapping roots, and never falls back to scanning $HOME. |
| `apps/desktop/electron/git-review-ops.ts` | (899 lines) The coding rail / review pane's git operations via `simple-git`; reads degrade to null on a non-repo or remote backend, mutations reject so the renderer can toast. It allow-lists only a few git env vars and defaults `GIT_TERMINAL_PROMPT` off. |
| `apps/desktop/electron/git-root.ts` | `findGitRoot` / `gitRootForIpc` — null for invalid and device paths. |
| `apps/desktop/electron/git-worktree-ops.ts` | (577 lines) "Start work": spin up a fresh worktree the lightest way (`git worktree add -b`), list real worktrees, remove them. Git is the source of truth; the renderer just drives it. |
| `apps/desktop/electron/host-backend-singleton.ts` | Multiplex-only enforcement: one `hermes serve` per **host** serves every profile, so the per-profile local pool is gone. `HERMES_DESKTOP_ISOLATED_BACKEND=1` is the deliberate escape hatch; a passive read may only be served by a warm backend. |
| `apps/desktop/electron/hub-iframe-policy.ts` | The Skills Hub iframe's capability carve-outs — window.open, clipboard write, and staying on the picker URL — each gated on the **exact** hub origin, so a sandboxed artifact frame never qualifies. |
| `apps/desktop/electron/hud-close.ts` | Bounded graceful close for the HUD: ask nicely (so a half-typed draft can flush to the shared stash), then take the window away at the grace deadline if the renderer never answers. |
| `apps/desktop/electron/hud-cursor.ts` | Cursor→page coordinate math for the Linux click-through fallback: on Linux the moves stop the instant the window ignores the mouse, so main polls and pushes the position in. |
| `apps/desktop/electron/hud-drag.ts` | HUD drag geometry across monitors: an absolute grab offset sampled in main stays 1:1 across mixed-DPI displays. |
| `apps/desktop/electron/hud-game-overlay.ts` | Discord-style "is the HUD floating over a game?" decision, walked front-to-back through the z-order — a windowed app in front of the game vetoes the overlay — plus the note that true exclusive-fullscreen bypasses the compositor entirely. |
| `apps/desktop/electron/hud-geometry.ts` | Display-aware default HUD bounds and the resize-lock reset that unsticks a tall, narrow persisted geometry. |
| `apps/desktop/electron/hud-hyprland.ts` | Hyprland tiling defeats `alwaysOnTop`, so the HUD asks the compositor's own socket to float and pin the title — and **probes which dispatch grammar the session speaks** (hyprlang vs Lua) once, then caches it. |
| `apps/desktop/electron/hud-ipc.ts` | The HUD IPC surface; the window handle and the session-id latch stay injected because main owns the lifecycle and the close broadcast reads the latch. |
| `apps/desktop/electron/hud-modifier-monitor.ts` | "A session capability, not a claim that Xwayland can observe Wayland apps" — the native gesture monitor's support policy and binary resolution. |
| `apps/desktop/electron/hud-modifier-types.ts` | The two shapes the gesture feature is made of. |
| `apps/desktop/electron/hud-modifier.ts` | The opt-in device preference: native input never crosses into a renderer; an untrusted frame's request throws and the setting must be a boolean. |
| `apps/desktop/electron/hud-overlay.ts` | The one call site that speaks each compositor's dialect for always-on-top. |
| `apps/desktop/electron/hud-snap-shortcut.ts` | The global ⌘⇧G snap-to-pointer chord, registered only while the HUD is open; Electron's globalShortcut is press-only, so this is tap-to-snap, not hold-to-follow. |
| `apps/desktop/electron/hud-snap.ts` | The pure math for parking the HUD under the cursor, kept separate so the DIP-vs-CSS mismatch cannot drift from the Linux cursor feed. |
| `apps/desktop/electron/hud-url.ts` | The HUD renderer URL — `?win=hud` before the `#`, plus the handoff profile in the query. |
| `apps/desktop/electron/hud-windowing.ts` | One windowing profile object for every operation that used to special-case OS/Ozone/compositor; the **Ozone backend** (not the login session) is the normaliser, and capabilities are derived once. |
| `apps/desktop/electron/hyprland.ts` | Hyprland window enumeration over the compositor's own socket — richer than the X11 `_NET_CLIENT_LIST_STACKING` path, which on Wayland sees only the legacy X11 clients. Sway is deliberately not attempted rather than shipped untested. |
| `apps/desktop/electron/install-stamp.ts` | The typed build-time install stamp, baked into the bundle as a global: a constant of the artifact that cannot be missing, stale, or edited after signing. Dev bundles define nothing and the `typeof` guard makes it null. |
| `apps/desktop/electron/keep-awake-controller.ts` | Main's half of keep-awake: the one machine-global power-save blocker, its persisted mode, and the **one-time** offer after a timed sleep interrupted a turn (offered once, never again after a relaunch). |
| `apps/desktop/electron/launch-profile.ts` | `--profile` / `--profile=` parsing; missing, empty and invalid values are null so a launch without a usable flag leaves the stored profile alone. |
| `apps/desktop/electron/link-metadata.ts` | Link title + favicon resolution: curl (tier 1) → hidden BrowserWindow (tier 2), with a bounded title cache (500 entries / 96 KB), a favicon cache with a 30-day TTL, and a render-title queue capped at 2 concurrent. |
| `apps/desktop/electron/link-title-curl.ts` | The curl write-out format and the parser for the retained trailer (content type + effective URL) after the body budget is exceeded. |
| `apps/desktop/electron/link-title-url.ts` | URL admission for the title pipeline: the renderer can send *any* href-shaped string, so the main process re-validates before anything reaches curl or `loadURL()` — a leaked directive-shaped string navigates Chromium to a non-URL (#93893). |
| `apps/desktop/electron/link-title-window.ts` | The hidden title window's launch options, encoded as options rather than `show: false` — a hidden title-fetch window has still painted a blank top-level frame over the chat on Windows (#64867). |
| `apps/desktop/electron/linux-crash-diagnostics.ts` | Routes Chromium's own log to a file next to `desktop.log` and keeps local minidumps, so the FATAL line that arrives a moment before the trap is not lost with the discarded stderr. |
| `apps/desktop/electron/linux-launcher-ready.ts` | Writes one byte to the launcher's pipe fd when the window has mapped — unpatched gnome-shell drops a STARTING ShellApp's last reference and takes down the Wayland session (#111906). |
| `apps/desktop/electron/linux-nvidia-egl-fallback.ts` | The NVIDIA EGL fallback, and the correction of an earlier mistake: the gate is **behavioural** (a witnessed GPU death on this host) rather than a driver-major set, because the same driver point release breaks one host and not another. |
| `apps/desktop/electron/local-backend-lifecycle.ts` | Observes every branch of the local-backend lifecycle but never leaves quit parked on a lost exit/SSH callback; the quit abort sentinel is marked as an expected transition. |
| `apps/desktop/electron/local-filesystem-path.ts` | Pure path/URL predicates for the opener: a bare local path is one `new URL()` rejects or mis-parses as a bogus scheme (`C:\…` parses as protocol `c:`), and a protocol-relative URL must never fall through to `shell.openPath`. |
| `apps/desktop/electron/local-gateway-python.ts` | The multiplexer's ticket-minting home: a control socket mints tickets for a served secondary, with a bridge generation counter so a stale mint is refused ("Gateway ticket runtime changed; retry connecting"). |
| `apps/desktop/electron/local-gateway.test-helpers.ts` | Temp homes short enough for a real AF_UNIX control socket — `sun_path` is 104 bytes on macOS, and the default tmpdir overflows it. |
| `apps/desktop/electron/local-read-path.ts` | Path preparation for the file-read boundaries: on Windows with a WSL backend the target is a POSIX path, so each boundary routes it through `resolveLocalReadPath` first. |
| `apps/desktop/electron/local-skin.ts` | Reads the local display skin **without asking the active gateway**, so a Desktop window can still paint its configured skin when the primary connection is a remote gateway that is offline. |
| `apps/desktop/electron/machine-profile.ts` | Registers a renderer channel reporting native machine facts (home birthtime approximates account age). |
| `apps/desktop/electron/main-process-lag-watchdog.ts` | Records delayed main-process timer callbacks after the event loop resumes — "it intentionally observes only; a stall must never change window or tray behavior while the application is recovering". |
| `apps/desktop/electron/main-window-lifecycle.ts` | Recreates a destroyed primary window without focusing it, and decides whether the last-chat-window `closed` fallback must quit the app. |
| `apps/desktop/electron/mcp-oauth-callback-ipc.ts` | The client-side loopback callback listener for MCP OAuth against a **remote** backend — the gateway's own listener is on the backend machine's 127.0.0.1 and unreachable from the user's browser. Capped at 8 pending listeners. |
| `apps/desktop/electron/media-capture-permission.ts` | One named type for the widened permission strings Chromium actually sends (`audioCapture`, `videoCapture`, `automatic-fullscreen`), so the call sites do not scatter `as string` casts. |
| `apps/desktop/electron/media-protocol.ts` | The `hermes-media://` handler: streamable extensions, forwarded range/cache headers, the gateway's extra headers on every remote request, and a native-refresh outage recovered through a live cookie. |
| `apps/desktop/electron/media-range.ts` | Range-aware local media: Electron's `file://` loader ignores `Range` and answers `200`, so Chromium reports `video.seekable` as `[0, 0]` — this module answers the request itself with `206` + `Content-Range`, `416` for unsatisfiable, header-only `HEAD` and `404` when the file is gone. |
| `apps/desktop/electron/minimize-to-tray-native-fixture/main.ts` | A targeted native lifecycle probe: compile and run against a fresh userData — no backend, renderer dev server, CDP listener or real user state. |
| `apps/desktop/electron/minimize-to-tray.ts` | The device-local minimize-to-tray preference: the tray hide is **deferred past the minimize dispatch** (a window can come back painted yet dead to input), and a restore from any path re-activates rather than showing inactive. |
| `apps/desktop/electron/native-access-token.ts` | A late 401 must reuse a concurrent rotation rather than rotate its winner again; `NativeAuthChangedError` marks an identity change that fences stale callbacks. |
| `apps/desktop/electron/native-auth-decisions.ts` | Six RFC-8252 decisions extracted as pure functions because each was the site of a real runtime bug the mocked flow tests never exercised — e.g. the token POST body must be the raw object (`fetchJson` owns `JSON.stringify`), or the gateway's Pydantic model rejects it with a 422. |
| `apps/desktop/electron/native-gesture-monitor.ts` | The bounded JSON-lines lifecycle shared by the passive screenshot and HUD helpers. |
| `apps/desktop/electron/native-oauth-login.ts` | The electron-coupled RFC-8252 driver: loopback listener → system browser → redeem the one-time code → hand the tokens back. The pure PKCE/URL/parse logic lives in `native-oauth.ts`. |
| `apps/desktop/electron/native-oauth.ts` | The pure RFC-8252 core: PKCE pair, state, authorize URL, token/refresh URLs, loopback callback parsing (with a CSRF state check), token-response normalisation, and the refresh test. |
| `apps/desktop/electron/native-token-store.ts` | The encrypted-at-rest persistence seam for native OAuth tokens; the parser direction is the load-bearing detail, and a `safeStorage` call that returns no payload **refuses to overwrite** the stored native session instead of silently signing the user out. |
| `apps/desktop/electron/native/command-screenshot-monitor.m` | (Objective-C) Passive modifier-gesture detection: never reads characters, activates an app, captures pixels, or writes files. Only physical key state is retained, and the capture fires on the clean second physical press. |
| `apps/desktop/electron/native/hud-modifier-gesture.cs` | (C#) The same bounded, release-only gesture contract as the C header, for the Windows Raw Input path. |
| `apps/desktop/electron/native/hud-modifier-gesture.h` | (C) The gesture state machine as a header-inline: only a summary of the current chord survives an event, and the summon fires only when both modifiers were pressed within 500 ms with nothing else held. |
| `apps/desktop/electron/native/hud-modifier-monitor-win.cs` | (C#) Windows Raw Input monitor — passive: no hooks, event suppression, input injection, or recorded key data. |
| `apps/desktop/electron/native/hud-modifier-monitor-x11.c` | (C) X11 XI2 raw-event monitor — passive: no grabs, remapping, characters, or event logging. |
| `apps/desktop/electron/native/hud-modifier-monitor.m` | (Objective-C) macOS passive Cmd+Option tap monitor — no character decoding, input log, or event IPC. |
| `apps/desktop/electron/notification-actions.ts` | Resolves a notification action index, preferring Electron's event details and supporting the legacy positional form; out-of-range indexes are ignored. |
| `apps/desktop/electron/notification-ipc.ts` | Returns native clicks and approval actions to the **emitting** window, not to whichever window is focused; plugin callbacks go to their source. |
| `apps/desktop/electron/notification-linux.ts` | Async D-Bus instead of Electron's synchronous libnotify calls, so a slow notification cannot stall its own watchdog; delivery is bounded and retried with a cooldown, and a changed owner during lookup is an error. |
| `apps/desktop/electron/notification-types.ts` | The durable click target captured before runtime bindings can be recycled. |
| `apps/desktop/electron/oauth-login-window.ts` | The embedded gateway sign-in window: loads the gateway in the connection's cookie partition, follows the IdP round trip, and settles as soon as the session cookie lands — it polls the jar because the cookie is HttpOnly. `silent` selects the protected root (auto-SSO) instead of `/login`. |
| `apps/desktop/electron/oauth-navigation.ts` | Treats Electron's `ERR_ABORTED` callback navigation as non-fatal without suppressing genuine load failures. |
| `apps/desktop/electron/oauth-net-request.ts` | `net.request` helpers that do not set Electron-restricted headers such as `Content-Length` — let Chromium frame the body. |
| `apps/desktop/electron/oauth-partition.ts` | Per-connection cookie-jar isolation: Chromium cookie jars scope by host and **ignore the port**, so two gateways on one host fought over the same `hermes_session*` cookies — signing in to B evicted A's session and A's cookie was silently presented to B on every request (a cross-connection credential leak). |
| `apps/desktop/electron/oauth-rest-request.ts` | REST with a cookie fallback: a 401 is replayed only for a gate refusal on an idempotent request, background roster auth leaves the 401 for the source row, and a ticket mint "vouches" for a replay. |
| `apps/desktop/electron/oauth-session-response.ts` | Wire-time response extraction: observes `Set-Cookie` at the wire, and settles once even when the body fails after the headers. |
| `apps/desktop/electron/package-process-reap.ts` | Reaps detached package-owned tools without touching shared runtimes: a root claim never includes the shared tool store, and interpreters, launchers and unidentified processes are protected. |
| `apps/desktop/electron/parent-process-identity.ts` | The spawn tag the Python side consumes (`v1:<install>:<purpose>:<spawner_pid>:<spawner_ct>`), and the parent marker resolver that shares and caches a successful probe and degrades a failed one. |
| `apps/desktop/electron/payload-backend.ts` | The launch contract completed by the PM bundle builder: where the payload python and its site-packages live, and the install id derived from a canonicalised root. |
| `apps/desktop/electron/pet-overlay-ipc.ts` | The pop-out pet overlay's IPC surface; window handles stay injected. |
| `apps/desktop/electron/pet-overlay.ts` | Pure geometry for the pet overlay: an off-screen overlay is "completely unfindable" (transparent, frameless, non-activating, hidden from Mission Control), so a mostly-off-screen spot is pulled wholly onto a display and a sliver of overlap is clamped to the nearest edge. |
| `apps/desktop/electron/plugin-profile-routes.ts` | Builds the renderer's opaque profile routes: SSH aliases grouped by effective route without exposing endpoints, IDs that change when the effective destination changes, and IDs keyed to the Desktop installation. |
| `apps/desktop/electron/plugin-ws-url.ts` | The plugin socket URL contract: the namespace path stays inside the plugin, the grant header travels once and never in the URL, and a permission refusal is a **named reply** rather than an error. |
| `apps/desktop/electron/portal-cookies.ts` | Which NAS cookies count as credentials — provider-routing hints and WorkOS logout identifiers are not credentials, and gateway cookies are unrelated. |
| `apps/desktop/electron/portal-session-live-fixture/main.ts` | A fixture exercising real Chromium cookies, HTTP redirects and renderer requests against a loopback-only portal with synthetic credentials. |
| `apps/desktop/electron/portal-session.ts` | The canonical Nous portal base URL (overridable for staging/dev, mirroring the CLI's convention so one override flips every surface) and the sign-in session. |
| `apps/desktop/electron/power-save.ts` | The renderer-side half of keep-awake (no Node imports, so the renderer can import the modes): `off` / `while-working` / `always`, with `keepAwakeWanted(mode, working)` deciding from the live turn picture. |
| `apps/desktop/electron/pre-update-backup-config.ts` | Reads the pre-update emergency-backup preference from the runtime config; a missing runtime, probe failure or malformed response must not weaken the recovery path. |
| `apps/desktop/electron/prepared-submissions.ts` | A journal of prepared renderer submissions, matching localStorage's origin isolation, with destination keys carrying connection/profile/session authority and no renderer-provided filesystem paths. |
| `apps/desktop/electron/preview-capture.ts` | Crops a preview webview by capturing the visible viewport and cropping in bitmap space from CSS coordinates (Electron's rect argument is unreliable on guest webviews); a missing guest **fails closed** rather than returning a blank PNG. |
| `apps/desktop/electron/preview-file-watch.ts` | Owner-routed delivery for preview/plugin file watches: the change must go back to the WebContents that registered it, because secondary windows filter by their own watch id. |
| `apps/desktop/electron/preview-guest-escape.ts` | The preview pane's escape hatch: a guest that takes HTML5 fullscreen owns the input focus, so `before-input-event` on the guest is the one interception point the host always owns (Esc exits fullscreen, Ctrl/Cmd+Shift+W closes the preview). |
| `apps/desktop/electron/preview-guest-offscreen.ts` | Guests that are mounted but off screen: Chromium still tracks a hidden guest as the focused webContents, so the host renderer reports visibility and main skips a hidden one. |
| `apps/desktop/electron/preview-guest-preload-entry.ts` | The bundled guest preload: context isolation means it shares the guest's DOM but never its JS world; trusted `target="_blank"` anchors are intercepted in the capture phase and handed to the host. |
| `apps/desktop/electron/preview-guest-preload.ts` | The logic half of the guest preload (the wiring half is the entry file), so the handoff rules are testable in plain Node; the channel constant is mirrored in the renderer because the renderer tsconfig cannot import from `electron/`. |
| `apps/desktop/electron/preview-guest-throttle.ts` | The one partition the preview pane's `<webview>` always carries, and the attach preferences that keep it animating while the Desktop window is inactive. |
| `apps/desktop/electron/preview-reach.e2e.mts` | A manual E2E (not a unit test) that spawns real `ssh -N -L` tunnels to a live box and fetches a dev server bound to *that* machine's loopback. |
| `apps/desktop/electron/preview-url-target.ts` | The preview pane's HTTP(S) admission: a public page the user asked to open has to navigate; only the `0.0.0.0` bind address is rewritten to `127.0.0.1`, because rejecting every other host made `preview.open` succeed while the pane stayed blank. |
| `apps/desktop/electron/primary-backend-startup.ts` | Multiplex-only primary startup: attach to the backend already running on this host, and spawn only when the host has none. A remote apply that resolves no saved remote fails clearly instead of silently falling back to local. |
| `apps/desktop/electron/primary-connection-rehome.ts` | The seam that keeps a first-run remote apply's connection attempt alive while an ordinary mode change tears the current backend down. |
| `apps/desktop/electron/primary-profile-pin.ts` | Which profile the primary (window) backend answers for: the *stored preference* is what the next launch should boot into, but the *live primary child* is what routing must use — reading the preference instead spawned a second backend. One decision feeds routing, argv and env. |
| `apps/desktop/electron/product-identity.ts` | The typed build-time product identity (name, appId, channel) derived once in a `.cjs`, so dev bundles and test runs share the single derivation. |
| `apps/desktop/electron/profile-id-guard.ts` | Profile ids crossing into spawn argv must be non-empty slug regexes — a numeric roster id or a display label would make the CLI `str()`-coerce it and bootstrap a phantom `profiles/0/` directory (#88842). |
| `apps/desktop/electron/profile-migration.ts` | First-boot seeding of `active-profile.json`: reads the legacy file, finds running gateway profiles, scores candidate `state.db` files by size and mtime, and writes the preference only through an injected fs/path bag. |
| `apps/desktop/electron/profile-routes.ts` | The one table of `/api/profiles/<suffix>` collection routes by method, mirrored from the gateway's `PROFILE_COLLECTION_ROUTES`, so grant selection, ticket routing and ambient scoping cannot disagree. |
| `apps/desktop/electron/profile-session-routing.ts` | (1,654 lines) The unified session list: local, remote and registry sources merged, tagged with the owning `connection_id` and remote profile, with sidebar slices (`recents`, `cron`, `messaging`) and a revision fence so a stale list cannot overwrite a newer one. |
| `apps/desktop/electron/quick-entry.ts` | (501 lines) The global-hotkey mini composer: it carries **no** gateway connection of its own and forwards the text to the primary renderer, so the submit path is the same one the normal composer uses. Accelerator validation, "disabled means never register" and "the shortcut is already taken" are all unit-testable. |
| `apps/desktop/electron/quit-finalization.ts` | A bounded escape hatch for a Windows process that entered its final quit phase but never emits the completed quit event; armed only from `will-quit` and cancelled by a successful quit. |
| `apps/desktop/electron/quit-teardown.ts` | Whether Electron must defer the quit until the teardown settles; a teardown that brings a backend back may announce it, and a reentrant quit cannot start a second teardown. |
| `apps/desktop/electron/registry-backend-identity.ts` | Backend identity for the unified session list: totals are counted once per backend, keyed on the gateway's `install_id`; a sidebar refresh never waits on an identity probe — an unanswered probe reads as "unknown", which only makes the totals take `max()` instead of a sum. |
| `apps/desktop/electron/remote-liveness.ts` | (482 lines) Liveness for pooled remote descriptors: probe the cheap `/api/health`, not `/api/status` (whose cold payload runs seconds); a failure streak (3 in 60 s) is required before a connection is reset, and a power-resume sweep retires and rebuilds the dead ones. |
| `apps/desktop/electron/remote-oauth-ticket.ts` | The roster dial's ticket mint, with a larger bounded budget reserved for OAuth remotes whose cold session is still warming; only a confirmed auth rejection is classified as reauth. |
| `apps/desktop/electron/remote-owner-cache.ts` | The memo of which remote profile owns a session id, with a **bounded FIFO eviction** — the memo used to only ever insert, so a long-lived main process kept one entry per session id it had ever resolved (#58485). |
| `apps/desktop/electron/remote-session-cookies.ts` | An in-memory mirror of the gateway's session cookies, because Chromium's jar can drop them in the field and every authed call then 401s as `no_cookie` right after a successful sign-in. RFC-6265 path matching is implemented explicitly. |
| `apps/desktop/electron/remote-ssh-exec.test-helpers.ts` | A local stand-in for `SshConnection.exec` that, like the real mux exec, writes stdin to the remote process — a double that drops it leaves the shipped programs reading the test runner's own stdin. |
| `apps/desktop/electron/remote-update-marker-programs.ts` | The update-marker judge as **programs that run on the SSH remote** (Python and PowerShell), with the constants interpolated so no copy can drift. Only the host's system Python/PowerShell runs them — nothing imports the checkout an updater may be replacing. |
| `apps/desktop/electron/remote-ws-headers.ts` | The header blocks Chromium may attach to a remote request: registry connections are the live source, the v1 block is fallback, longer base URLs win so a path-prefixed gateway is not shadowed by its origin sibling, and values arrive already sanitised (no second normaliser). |
| `apps/desktop/electron/renderer-accessibility.ts` | Chromium only builds the accessibility tree when it detects assistive technology, and dictation tools that insert text through the OS accessibility APIs do not register like a screen reader — so the tree never appears and the composer is invisible to them. The typed API is default-ON on darwin/win32. |
| `apps/desktop/electron/renderer-crash-metrics.ts` | A consent-gated renderer-crash counter: the bucketed reason plus a hash of the profile key — never the name, exit codes, paths or window titles — with a take/ack drain so a crash that takes the renderer down is still reported. |
| `apps/desktop/electron/renderer-heap-flags.ts` | The renderer heap ceiling and `desktop.electron_flags`: Chromium only forwards `--js-flags` when the **browser** process has the switch before `ready`, so a launcher-appended config never applied to a packaged launch. The switch planning is pure and unit-tested. |
| `apps/desktop/electron/renderer-load-error-page.ts` | The visible white-screen page: a torn bundle after an update and a missing index.html both surface as a real page with a Reload button, with the failure details HTML-escaped and the reload URL unable to break out of the inline script. |
| `apps/desktop/electron/roster-source-fetch.ts` | Starts the profile read and the install-id read together for a roster source and prefers the profile answer. |
| `apps/desktop/electron/roster-source-status.ts` | One line: a stale cached profile list must not be reported as a reachable or signed-in gateway. |
| `apps/desktop/electron/save-text-file.ts` | The `/save` slash command writes on the Electron side (the gateway may be remote and only returns content): the user picks the destination via a native dialog and the main process writes it. A gateway never writes to the client's disk. |
| `apps/desktop/electron/select-paths-dialog.ts` | The dialog properties for `hermes:selectPaths` — directory pickers carry `createDirectory` so macOS shows "New Folder". |
| `apps/desktop/electron/select-runnable-binary.ts` | Ordered candidate absolute paths, highest preference first; a missing candidate is never probed. |
| `apps/desktop/electron/semver.d.cts` | A minimal SemVer declaration for the optional dependency, so typecheck does not depend on whether it installed. |
| `apps/desktop/electron/session-windows.ts` | Secondary "session windows" — one extra OS window per chat — with the pure URL/bounds helpers (`?win=session` before the hash, the owning profile in the query, a 32 px cascade offset for instance windows). |
| `apps/desktop/electron/shell-path.ts` | Login-shell PATH resolution for GUI launches: run the user's shell once as an interactive login shell and capture `$PATH` between sentinel markers so profile banners cannot corrupt it — the VS Code approach, ported. |
| `apps/desktop/electron/singleton-lock.ts` | Parses the PID out of Chromium's Linux `SingletonLock` symlink, hostname-guarded, and removes the lock only when the owner is **provably** dead (a zombie counts as dead; `kill(pid,0)` alone would not). |
| `apps/desktop/electron/source-backend.ts` | Resolves a source-checkout backend: keep the validated command, let PM own interpreter and generation selection. |
| `apps/desktop/electron/source-python.ts` | Resolves the interpreter for a source install: an explicit `HERMES_DESKTOP_PYTHON` is honoured as-is; otherwise the checkout's virtualenv, and a checkout with no venv yields *no* backend rather than a broken one. |
| `apps/desktop/electron/spawn-helper-perms.ts` | Restores node-pty's POSIX `spawn-helper` exec bits at runtime (the published tarball ships it 0644, so every terminal spawn fails with `posix_spawnp failed`); chmod failures are collected, not thrown. |
| `apps/desktop/electron/ssh-binary.ts` | Which ssh client the desktop spawns: an explicit `desktop.ssh_path` override, then in-box System32 OpenSSH, then Git for Windows, then Hermes' PortableGit, then bare `ssh` — every spawn now resolves through one function. |
| `apps/desktop/electron/ssh-bootstrap-coordinator.ts` | Composes with any drain already in flight for a scope: `start()` waits for every active teardown, and the map entry is cleared only once the composed barrier settles. A generation started during a cancel cannot run before the drain. |
| `apps/desktop/electron/ssh-config.ts` | Reads the user's OpenSSH client config: `Host` aliases for suggestions, `Include` traversal (read-only, cycle-safe) and `ssh -G` output parsing. |
| `apps/desktop/electron/ssh-control-master-holders.ts` | Who may run `ssh -O exit` on a shared ControlMaster socket: every connection for the same scope hashes to the same ControlPath, so a stale bootstrap closing late used to kill the master its successor had attached to (#97264). Only the last holder may exit the master. |
| `apps/desktop/electron/ssh-isolated-keepalive.ts` | A long-lived keep-alive WebSocket from main for every published SSH-isolated backend: the gateway treats accepted sockets as ownership liveness, and renderer sockets can vanish while Desktop still owns the backend. Reconnects use capped exponential backoff; sticky nonce/lock/token files are **not** liveness. |
| `apps/desktop/electron/ssh-teardown.ts` | Retains transports removed from routing until their remote kill has settled. |
| `apps/desktop/electron/startup-latency-ipc.ts` | The launch → first-renderer-gateway-attach latency, claimable once per main process — the latch lives here because renderer reloads, extra windows and backend reconnects all re-run the renderer boot. |
| `apps/desktop/electron/system-ca.ts` | Installs the OS trust store's CAs into Node's TLS for backend connections, on Windows and macOS only (Linux's `system` store is the OpenSSL directory scan the default already covers), failing open. |
| `apps/desktop/electron/terminal-ipc.ts` | (425 lines) The embedded terminal's PTY host: shell resolution, env scrubbing, the session registry and the `hermes:terminal:*` IPC surface, with the dispose helpers main needs for SSH teardown. `terminalLcCtype` never hands glibc the bare `UTF-8` locale. |
| `apps/desktop/electron/terminal-output-gate.ts` | Holds the initial shell prompt until the renderer attaches, flushes buffered output before an early shell exit, and never replays startup output twice. |
| `apps/desktop/electron/titlebar-overlay-width.ts` | The native title-bar overlay geometry per platform, scaled by the current zoom factor, with a macOS Tahoe (Darwin 25) special case. |
| `apps/desktop/electron/translucency.ts` | The main-process half of window translucency; the mode mapping, clamping and opacity ramp live in `apps/shared` so the renderer and main cannot drift. |
| `apps/desktop/electron/tray-host.ts` | Watches the Linux tray host over D-Bus and reports its loss, tolerating both the bare-boolean and `{value}` property shapes across dbus-native versions. |
| `apps/desktop/electron/update-api-proxy.ts` | Node's `https.get` ignores proxy env vars, so the update API resolves them itself — for update requests only. |
| `apps/desktop/electron/update-gate.ts` | The pure gate that parks local backend spawns while an update owns the runtime: three independent signals (the on-disk marker, the in-process `updateInFlight` flag, and the successful detached hand-off) — and the marker alone is not enough, because the pre-marker window is exactly where the restart-loop trigger lived. |
| `apps/desktop/electron/update-handoff-report.ts` | Reports a detached update's result once, where boot passes the update gate: success with warnings becomes a warning card, `manual:true` becomes an action-required card. |
| `apps/desktop/electron/update-hold-types.ts` | The wire shape of the update hold, shared by main and the renderer so it has one definition. |
| `apps/desktop/electron/update-hold-wiring.ts` | The desktop wiring of an update hold: the marker probe the boot and pool gates share, the blocked boot screen's state, and its three IPC ways out. |
| `apps/desktop/electron/update-marker.test-helpers.ts` | Real-process fixtures for the marker suites: sleeping owners, reaped pids, and a claimant child that publishes a marker naming **itself** (its own pid and kernel creation time). |
| `apps/desktop/electron/update-marker.ts` | (840 lines) The update marker's v2 format and its readers: creation-time probes for Linux/macOS/Windows, a cached probe so a gate wait never re-probes each pid, an empty-marker grace, and the hand-off claim/bridge. Failures return null — fail-open to alive. |
| `apps/desktop/electron/update-order.ts` | A local update hands control to a detached updater that waits for the window to exit, so every **remote** update transaction must settle first or it outlives the exit deadline and aborts the whole update. |
| `apps/desktop/electron/updater-process.ts` | (816 lines) The updater child: staging, the detached spawn, the Windows console suppression, the relaunch argument collection, and the historical install layouts that still matter when uninstalling a source install. |
| `apps/desktop/electron/updater/app-installer.ts` | The win32 out-of-store MSIX strategy: check (via the OS), surface UNKNOWN honestly, stage the descriptor, tear down, open it and quit with a pending-relaunch marker so the app comes back by itself. |
| `apps/desktop/electron/updater/artifact.ts` | Pinned artifact download and verification: the caller owns private storage and its lifetime, and a redirect cannot change authority. Size, type and digest are all checked. |
| `apps/desktop/electron/updater/channel-native.ts` | Native channel feeds: the feed's own hashes plus the admitted build's hash, a canonical channel path, and an inspection of the running channel app. |
| `apps/desktop/electron/updater/channel-strategy.ts` | "One selection owns a check/apply operation; background checks cannot retarget it" — a second apply throws rather than interleaving. |
| `apps/desktop/electron/updater/channel-windows-host.ts` | Verifies the downloaded bytes and the native metadata *before* App Installer is allowed to stop the backend: the publisher identity, the feed URI and the package names must match exactly. |
| `apps/desktop/electron/updater/channel.ts` | Channel resolution: in-place vs discontinued receivers, a publisher-pinned retirement at `retire()` time, and a version floor that a destination below it is refused for. |
| `apps/desktop/electron/updater/checkout-source.ts` | The source-install update probe: reads the channel from the runtime, persists this install's channel first (the About selector) so the check can report it, and refuses an unsafe Windows command argument. |
| `apps/desktop/electron/updater/checkout.ts` | (771 lines) The git-checkout update policy and hand-off execution: reads the stamped commit, builds the manual-update command, and drives the withdraw/reclaim verdict machine (`STILL_RUNNING_VERDICTS` vs `WITHDRAW_SETTLED_VERDICTS`). |
| `apps/desktop/electron/updater/external.ts` | The steward-owned strategy: updates are managed by the package owner outside this app — one sentence, no button that cannot work. |
| `apps/desktop/electron/updater/feed-config.ts` | The feed base for a bundled install, read from config only: a second env source "would let a stray variable silently redirect updates", and a plain-http base would hand a network attacker the update source, so a bad value throws rather than silently falling back. |
| `apps/desktop/electron/updater/mac-client.ts` | The macOS channel client: exact per-build metadata rather than a moving channel directory, and a newer channel head wins even when SemVer build metadata is equal. |
| `apps/desktop/electron/updater/mac.ts` | The macOS strategy: Squirrel verifies the signed app **before** any backend is stopped; a substituted pinned version or artifact is refused before native signature verification. |
| `apps/desktop/electron/updater/marker-helper.test-helpers.ts` | A checkout with a real fake hand-off script that answers marker-helper ops. |
| `apps/desktop/electron/updater/operation.ts` | Preserves one native selection across check and apply, and one owner through the hand-off; a second concurrent apply throws. |
| `apps/desktop/electron/updater/packaged-handoff.ts` | "Native preparation decides when it is safe to stop. Recovery has one owner." — the hand-off's error aggregation keeps cleanup failures while still restoring the backend. |
| `apps/desktop/electron/updater/relaunch-waiter.ts` | The separate waiter that owns the automatic relaunch: staged outside the package, awaits the old version's snapshot, and a failed handshake cancels the child instead of leaving a delayed relaunch. |
| `apps/desktop/electron/updater/relaunch.ts` | The pending-relaunch marker: Electron's userData isolates installations that share a `HERMES_HOME`; the marker survives a package swap and records the version that started it. |
| `apps/desktop/electron/updater/state-db-preflight.ts` | The pre-update snapshot of the state DB, run through the installation launcher (a PM-managed checkout has no venv of its own); an unsafe Windows command argument throws. |
| `apps/desktop/electron/updater/store-client.ts` | The Microsoft Store client runner: passes the mode, the full HWND and the isolated payload identity. |
| `apps/desktop/electron/updater/store.ts` | The Store lifecycle: download before shutdown, own the relaunch before install, refuse unknown availability, and preserve cancellation plus restoration on failure. |
| `apps/desktop/electron/updater/update-metrics.ts` | The shared-metrics report for packaged self-updates: the run is persisted as a pending record **before** apply starts (an apply usually ends with the app quitting) and reported on the next backend attach; the file is deleted only once the RPC resolved, and a failure reports only a bucketed stage, never error text. |
| `apps/desktop/electron/venv-holder-select.ts` | Pure Windows venv-holder selection: Hermes-owned venv daemons (the memory plugin's hindsight daemon) may be killed; **external** holders may not — they are reported and the hand-off aborts instead. |
| `apps/desktop/electron/vscode-marketplace.ts` | Fetches a VS Code Marketplace colour theme: queries the gallery API, downloads the `.vsix` (a zip) and inflates only the theme JSON with `zlib` — "No theme code is ever executed" and no zip library is pulled into the bundle. |
| `apps/desktop/electron/wake-indicator-window.ts` | The small always-on-top window that cues the user when a wake/sleep interrupted a turn; log-only renderer lifecycle. |
| `apps/desktop/electron/wake-indicator.ts` | The wake indicator's states (`hidden`/`detected`/`capturing`) and its display selection and bounds. |
| `apps/desktop/electron/watch-storm-breaker.ts` | The rate breaker for raw `fs.watch`: on Windows, `ReadDirectoryChangesW` can flood a handle with 180k rename events per second, pinning a core. Past the threshold the watcher is closed and a slow poll of a cheap snapshot replaces it. |
| `apps/desktop/electron/web-text-decoder.ts` | Decodes web text by charset: a small prefix is decoded as a single-byte encoding first, because "charset declarations are ASCII even when the document is not" and invalid UTF-8 could otherwise erase the declaration. |
| `apps/desktop/electron/window-accelerator.ts` | The 200 ms focus grace that decides whether a Close Tab / Reload keyDown belongs to the app that just lost focus. |
| `apps/desktop/electron/window-below.ts` | "Which OS window sits directly underneath a Hermes window": the enumeration is a thin provider (`get-windows` on X11/macOS/Windows, Hyprland's socket on Wayland) and the picking is a pure function. Privacy contract: **metadata only — app, title, bounds — never pixels**, and macOS titles are passed only when Screen Recording is already granted. |
| `apps/desktop/electron/window-chrome-events.ts` | Every window publishes its own chrome state, never the primary's. |
| `apps/desktop/electron/window-connection-route.ts` | The route a window must re-dial after a primary apply: an applied registry source stays registry-scoped to that exact identity, while a "This device" apply stays unscoped so the dial follows the freshly written config. |
| `apps/desktop/electron/window-controls.ts` | The custom window controls; WSL detection is kept **fs-free on purpose** because the preload is sandboxed and importing `node:fs` — even transitively — tears down the whole `window.hermesDesktop` bridge. |
| `apps/desktop/electron/window-focus-policy.ts` | The Windows focus-steal policy: revealing a window uses `showInactive()`, and focus is only taken when the window does not already have it — raising Hermes must never dismiss another app's native dialog. |
| `apps/desktop/electron/window-growth.ts` | The first-run intro's sizing: the window is put back where it was when the intro ends, and a user-moved window is distinguishable from a sized one. |
| `apps/desktop/electron/window-menu.ts` | Marks the macOS menu as AppKit's standard Window menu so macOS attaches its Move & Resize commands and their shortcuts to the app menu. |
| `apps/desktop/electron/window-open-policy.ts` | Every BrowserWindow's `window.open` policy: the audited `hermes:openExternal` channel is the only route for URLs the app opens on purpose, so the handler only ever sees content the app did not initiate (CVE-2026-70608). The origin probe must never throw into the handler — unknown means deny. |
| `apps/desktop/electron/window-renderer-lifecycle.ts` | Per-window renderer lifecycle diagnostics and crash recovery, keyed by a `kind` label, with an injected reload policy. `render-process-gone` with reason crashed/oom/killed on a live window → a bounded reload, under a **rolling crash-loop budget shared across ALL windows** (3 in 60 s). |
| `apps/desktop/electron/window-reveal.ts` | The window-reveal controller: reveal on `ready-to-show`, a 4 s fallback when it never arrives, settle exactly once, and never reveal a destroyed window. |
| `apps/desktop/electron/window-size-types.ts` | The two window size modes. |
| `apps/desktop/electron/window-state.ts` | Pure geometry for `window-state.json`: reject garbage, floor the size to the minimums, drop a partial position but keep the size, and treat `isMaximized`/`boundsCapturedFullScreen` strictly; an off-screen or sliver window is not restored. |
| `apps/desktop/electron/windows-hermes-path.ts` | Three pure pieces of Windows `hermes` resolution, each pinning one bug that caused desktop reinstall loops: PATHEXT extensions first (empty extension LAST), updater args separated from the target, and venv shim resolution. |
| `apps/desktop/electron/windows-msys-bash-env.ts` | Sets the two MSYS opt-outs on Windows unless already present — Git Bash rewrites slash-prefixed native flags (`/FI`) into paths. |
| `apps/desktop/electron/windows-remote-lifecycle.ts` | (853 lines) The Windows remote lifecycle: PowerShell over SSH, with a shared stdout normaliser that strips BOMs and CLIXML progress-stream blocks before any payload is parsed, a strict install-wide marker parse, and a platform probe that validates the Hermes/Python topology before selection. |
| `apps/desktop/electron/windows-user-env.ts` | Reads a User-scoped env var straight from `HKCU\Environment`, because a GUI app launched from Explorer inherits the environment block captured at login and a `setx` after login is invisible in `process.env` (#45471). |
| `apps/desktop/electron/workspace-cwd.ts` | One predicate: does this directory live inside a packaged app bundle / install tree. |
| `apps/desktop/electron/wsl-clipboard-image.ts` | Pulls a Windows-host clipboard image from inside WSL2 via PowerShell (WSLg bridges text but not images); the encoded-command marker is kept out of an enterprise AV signature. |
| `apps/desktop/electron/wsl-clipboard-script.ts` | The STA-mandatory PowerShell clipboard script, emitting base64 so the PNG survives stdout's text decoding. |
| `apps/desktop/electron/wsl-path-bridge.ts` | Bridges WSL/POSIX paths into forms the Windows host can open, for the case where the UI runs on Windows and the gateway runs inside WSL; only the Windows-side direction lives here, the reverse is gateway-side and picker-agnostic. |
| `apps/desktop/electron/wslg-launch-process.ts` | Spawns the app under WSLg while leaving this process alive only as its supervisor. |
| `apps/desktop/electron/wslg-launch.ts` | The WSLg launch arguments: Ozone is selected **before** application JavaScript ("Never appendSwitch here: that leaves the browser on X11 while GPU children receive Wayland"), with an explicit x11 hint and `desktop.electron_flags` able to override. |
| `apps/desktop/electron/zoom.ts` | One clamped zoom scale for the menu items, the shortcuts and the settings UI: percent is the user-facing unit, Chromium's internal unit is `1.2^level`, and the re-assert wiring handles the Windows maximise transition. |

---


### Tier 2 — the 336 test suites, one line each

These are the repo's own coverage of the modules above. Every suite was read; the
line below is what it actually pins. The set as a whole is the strongest signal in
this shard: **almost every module has a sibling `<module>.test.ts` with the same
name**, and the suites are pure (no Electron boot) because the source modules were
deliberately extracted to be pure.

| File | What it pins |
| --- | --- |
| `apps/desktop/electron/active-runtime-state.test.ts` | A healthy runtime launches even with a missing/stale bootstrap marker; an unusable runtime is refused even with a valid one. |
| `apps/desktop/electron/api-expected-404.test.ts` | Real backend payloads are never mistaken for the sentinel (including the right key with the wrong value type, or with extra keys). |
| `apps/desktop/electron/api-transport.test.ts` | The full verb-gated retry truth table, plus **live** servers that reset keep-alive sockets: GETs succeed under retry, and a POST reset *after* the server processed it is not double-submitted. |
| `apps/desktop/electron/app-icon.test.ts` | An existing-but-undecodable icon is skipped; the ladder never probes inside `app.asar`; a packaged macOS app keeps its bundle icon. |
| `apps/desktop/electron/app-installer-file.test.ts` | The staged descriptor survives a valid HTTP response and leaves a valid file behind. |
| `apps/desktop/electron/app-version.test.ts` | The About panel never reports `0.0.0`; a channel build reports source version and sequence independently; an unresolvable version becomes `unknown`, never empty. |
| `apps/desktop/electron/appinstaller-checker.test.ts` | The checker resolves at its deadline even when the child never emits `close`; an unspawnable interpreter resolves *unknown*, never "no update"; a throwing diagnostic sink cannot break the result. |
| `apps/desktop/electron/application-menu-startup.test.ts` | macOS builds the menu only after the first window exists; other platforms never build one. |
| `apps/desktop/electron/backend-claim.test.ts` | A failed probe on a LIVE child degrades to PID-only; on a DEAD child it fails closed; the output tail keeps only the most recent bytes. |
| `apps/desktop/electron/backend-command.test.ts` | The `serve`→`dashboard` fallback preserves a `--profile` flag and never mistakes a profile *named* `serve` for the subcommand. |
| `apps/desktop/electron/backend-connection-state.test.ts` | An invalidated attempt cannot publish a late descriptor; a stale exit cannot clear a newer attempt; a failed primary stop retains its child. |
| `apps/desktop/electron/backend-descriptor-cache.test.ts` | A late dial failure forgets only its own entry, never a newer descriptor. |
| `apps/desktop/electron/backend-dial-claim.test.ts` | Two concurrent dials for the same `(connectionId, profile)` coalesce; distinct keys dial independently; the claim releases when the dial settles. |
| `apps/desktop/electron/backend-env.test.ts` | `PYTHONPATH`/`PYTHONHOME` are scrubbed; the inherited PATH stays first; `HERMES_RUNTIME_DIR` names the store and look-alike prefixes do not. |
| `apps/desktop/electron/backend-exit.test.ts` | The exit escalation rejects within its bound when no exit or callback arrives; a failed escalation is not evidence that the child exited. |
| `apps/desktop/electron/backend-health.test.ts` | `/api/health` is preferred and `/api/status` is the legacy fallback only; a transient health error does not trigger the heavyweight fallback; a credentialed 401 fails fast for reauth. |
| `apps/desktop/electron/backend-ownership.test.ts` | A reap drops a confirmed PID-reuse mismatch but preserves a record whose identity could not be probed; a backend whose parent Electron is alive is never stopped. |
| `apps/desktop/electron/backend-probes-runtime.test.ts` | The real bootstrap supplies the ruamel-only dependencies and rejects a fake one (a live runtime probe). |
| `apps/desktop/electron/backend-probes.test.ts` | The probe keeps the parent event loop available to the child; a missing binary or a non-zero exit is not a usable runtime. |
| `apps/desktop/electron/backend-ready.test.ts` | The cold-start default is above the historical 45 s floor; an override is clamped and rounded; the port is parsed even when the line is split across chunks. |
| `apps/desktop/electron/backend-recycle.test.ts` | The owned SSH serve is killed before the primary child; a pooled profile recycles without tearing down the primary. |
| `apps/desktop/electron/backend-release-gate.test.ts` | The gate does NOT pass while a signalled PID is still in the process table; at the deadline it proceeds only under the old shim criterion. |
| `apps/desktop/electron/backend-resolution.test.ts` | The ignore-existing flag is read at resolve time; a runtime this launch installed is always used. |
| `apps/desktop/electron/backend-serve-support.test.ts` | Concurrent serve checks share one pending probe; a probe that failed by timeout is not cached. |
| `apps/desktop/electron/backend-spawn-env.test.ts` | The spawn env keeps the base env and stamps the stay-alive flag. |
| `apps/desktop/electron/backend-start-failure.test.ts` | A LOCAL failure latches; a REMOTE failure never does; unsigned OAuth latches and is never auto-retried; the two latches never fire for the same failure. |
| `apps/desktop/electron/bootstrap-platform.test.ts` | WSL2 is detected; WSLg is **not** treated as a remote display; SSH/RDP/forwarded-X11 sessions are; the GPU override wins both ways. |
| `apps/desktop/electron/bootstrap-quit.test.ts` | Quitting at each bootstrap boundary cancels the install instead of leaving a half-installed runtime (POSIX only). |
| `apps/desktop/electron/bootstrap-repair-guard.test.ts` | The soft-restart budget exhausts at `maxSoftAttempts + 1` and escalates to a hard reinstall; a fractional attempt count is clamped. |
| `apps/desktop/electron/bootstrap-runner-git-binary.test.ts` | `resolveCheckoutHead` runs the *probed* git binary, not the first one on PATH. |
| `apps/desktop/electron/bootstrap-runner.test.ts` | An already-aborted signal bails immediately; an existing checkout keeps its branch and skips the packaged commit pin; an immutable-pin cache is refreshed on a fresh install. |
| `apps/desktop/electron/bootstrap-state.test.ts` | The bootstrap snapshot names the three install shapes. |
| `apps/desktop/electron/browser-windows.test.ts` | `win=browser` sits before the hash; a blank tab is omitted; a dev server with a trailing slash does not double the slash. |
| `apps/desktop/electron/bundle-skew.test.ts` | Polls coalesce and back off; every uncertain input (no stamp, fallback stamp, git failure) reports "not stale". |
| `apps/desktop/electron/bundle-swap.test.ts` | A swap is detected on a different commit **or** a moved `builtAt`; the on-disk stamp is read without a schema check. |
| `apps/desktop/electron/challenge-window.test.ts` | Only portal challenge URLs load; a pass while hidden closes the window without showing it; an optional challenge is never revealed; two asks share one window. |
| `apps/desktop/electron/channel-build-version.test.ts` | Channel packaging reuses the admitted identity and rejects unsupported variants; the MSIX manifest writer consumes the channel quad. |
| `apps/desktop/electron/cli-provision.test.ts` | Owned dangling CLI links are repaired without touching foreign or live links; a failed swap preserves its source and target. |
| `apps/desktop/electron/close-stop-kill.test.ts` | A taskkill failure is surfaced and does not clear a lock; only locks with no live holder are cleared. |
| `apps/desktop/electron/cloud-boot-cascade.test.ts` | Only a Cloud + OAuth + unsigned-reauth error runs the cascade; a plain URL remote never does; transport errors keep their handling. |
| `apps/desktop/electron/cloud-discovery.test.ts` | A stale team falls back once to current memberships; unrelated failures do not. |
| `apps/desktop/electron/cloud-session-recovery.test.ts` | Recovery coalesces without reusing single-use tickets, backs off on failure and is bounded to one retry on success. |
| `apps/desktop/electron/command-screenshot-capture.test.ts` | A gesture binds to its original renderer and exact window; denied, expired, concurrent and disabled captures drop without leaking. |
| `apps/desktop/electron/command-screenshot-monitor.test.ts` | The helper launches without prompting, delivers only version-tagged frames, and its startup and termination are bounded. |
| `apps/desktop/electron/composer-image-name.test.ts` | The stamp renders local wall-clock components (not UTC), zero-padded, and keeps the legacy filename shape. |
| `apps/desktop/electron/composer-paste.test.ts` | The paste lands directly under `<HERMES_HOME>/composer-pastes` so the backend admits it. |
| `apps/desktop/electron/connection-apply.test.ts` | Connection changes serialise behind the bootstrap rollback; the owned remote backend is terminated before the tunnel closes. |
| `apps/desktop/electron/connection-caches.test.ts` | Evicting a connection id forgets every cache keyed by it, and an evicted id re-enumerates from the live target. |
| `apps/desktop/electron/connection-config-apply.test.ts` | The preflight runs before either store is written; an activation failure rolls **both** stores back. |
| `apps/desktop/electron/connection-config.test.ts` | The largest config suite: auth-mode coercion, header sanitisation (CR/LF stripped at ingest), scope keys, ticket mint failures and the profile routing table. |
| `apps/desktop/electron/connection-registry.test.ts` | The largest suite in the shard: label uniqueness, slug rules, SSH/remote descriptor reuse, quarantine of a bad entry, primary retargeting and the agent roster. |
| `apps/desktop/electron/connection-window-state.test.ts` | The reply carries the **sender** window's live state; with no sender it falls back to the primary; with no usable window it returns undefined. |
| `apps/desktop/electron/crash-forensics.test.ts` | A stack is preferred over a message; a marked quit sentinel is recorded as a one-line expected transition while an unmarked error with the same message still renders in full. |
| `apps/desktop/electron/dashboard-token.test.ts` | The served token is adopted when it drifts from the spawned one, but a foreign token is only flagged when the child is dead. |
| `apps/desktop/electron/data-paths.test.ts` | Local SSH sockets use the suffixed root; an explicit home keeps precedence. |
| `apps/desktop/electron/deep-link-protocol.test.ts` | The E2E/dev guard leaves the OS `hermes://` handler untouched. |
| `apps/desktop/electron/desktop-boot-preference.test.ts` | A profile write preserves other-owned fields and never adopts a broken value. |
| `apps/desktop/electron/desktop-electron-pin.test.ts` | The electron dependency is exactly pinned and the lockfile resolves that pin. |
| `apps/desktop/electron/desktop-installation.test.ts` | The installation id is a v4 UUID; a malformed or symlinked record is replaced; a repair lock whose holder died is reclaimed without deleting a peer's lock. |
| `apps/desktop/electron/desktop-log-line.test.ts` | The stamp is local wall-clock in Python's `asctime` shape. |
| `apps/desktop/electron/desktop-plugin-install.test.ts` | `owner/repo`, monorepo subdir and hash subdir shorthand; path traversal is rejected; an insecure scheme produces a warning. |
| `apps/desktop/electron/desktop-plugin-remove.test.ts` | Only the named folder is deleted; a unified package half is refused; a symlinked folder is removed as the link. |
| `apps/desktop/electron/desktop-plugins-root.test.ts` | Profile-scoped plugins are lifted into the app root once; an already-installed plugin is never overwritten; a unified half is re-copied when its source changes and removed when the source dies. |
| `apps/desktop/electron/desktop-profile-mutation.test.ts` | Every mutation method preserves startup ownership across a failure, through both the null and `local` paths. |
| `apps/desktop/electron/desktop-profile-preload.test.ts` | The native preload exposes routed peer opening and the default preference. |
| `apps/desktop/electron/desktop-profile.test.ts` | A failed authoritative write leaves the previous default; explicit routes never fall back to a different source; boot and reconnect retain the window route. |
| `apps/desktop/electron/desktop-redial-route-request.test.ts` | The REST redial re-ensures and forgets the route the failed request used. |
| `apps/desktop/electron/desktop-remote-route.test.ts` | Profile remote beats env beats global; a route **fails closed** when any dial field differs; the v1 pool key ignores registry identity tags. |
| `apps/desktop/electron/desktop-shared-metrics.test.ts` | A packaged apply is reported once through the renderer IPC and a check is not. |
| `apps/desktop/electron/desktop-uninstall-ipc.test.ts` | Excluded artifact owners block every uninstall IPC before a Python process starts. |
| `apps/desktop/electron/desktop-uninstall.test.ts` | An unknown mode throws (no silent full wipe); only standard installs allow desktop uninstall; each OS's removable path is resolved. |
| `apps/desktop/electron/dev-cdp.test.ts` | A dev-server run opens 9222 with no opt-in; a packaged build never opens it, however loudly the env asks. |
| `apps/desktop/electron/dock-launch-order.test.ts` | The deep link registers before the single-instance lock; non-macOS takes the lock at module load. |
| `apps/desktop/electron/embed-host.test.ts` | The wrapper carries a matchable origin, serves nothing but a well-formed video id, and the live host serves only to its own client. |
| `apps/desktop/electron/event-dedupe.test.ts` | The same key inside the window collapses to one event; a spoken reply stays claimed for 10 minutes while a beep does not. |
| `apps/desktop/electron/external-open.test.ts` | Every open route resolves `ok`/`failed`/`invalid` correctly; a protocol-relative URL is opened as https and never as a local path. |
| `apps/desktop/electron/external-terminal.test.ts` | Quoting survives embedded quotes; the env drops `PATH` in any casing; macOS opens the script with no `-a`. |
| `apps/desktop/electron/f12-shortcut.test.ts` | Only a native F12 keydown is arbitrated; repeats and modifiers are preserved. |
| `apps/desktop/electron/favicon.test.ts` | Only public http(s) hosts are asked; declared icons resolve against the page (a `<base href>` wins); the manifest is found or explicitly absent; candidates are ranked. |
| `apps/desktop/electron/feature-flags.test.ts` | Without `--local` local models follow the platform on every channel; `--local` opts in anywhere; `isCanaryTag` rejects stable/dev tags. |
| `apps/desktop/electron/fetch-json-oauth-session.test.ts` | The OAuth session response settles once even when the body fails after the headers, preserving the JSON and HTTP error contracts. |
| `apps/desktop/electron/find-in-page-native.test.mjs` | A native-fixture harness for the find-in-page bridge (the fixture package's `main`). |
| `apps/desktop/electron/find-in-page.test.ts` | The wire payload coerces missing fields to zero (never NaN); the find defaults and no-op behaviour; the results are forwarded to the same sender. |
| `apps/desktop/electron/first-run-setup-gate.test.ts` | Concurrent waits are prompted once; a reset settles the active waiter without allowing a late local install; a remote apply settles the gated boot. |
| `apps/desktop/electron/first-run-setup-main-process.test.ts` | A first-run remote apply connects without ensuring a local backend; an ordinary primary apply tears down first. |
| `apps/desktop/electron/fs-ipc.test.ts` | Reveal reports false for a missing path without touching the file manager; the logs root never leaves `hermesHome` for a non-profile owner. |
| `apps/desktop/electron/fs-read-dir.test.ts` | Noisy entries are hidden, directories sort before files, device paths are rejected, fs errors are returned as codes, symlinks are stat'ed. |
| `apps/desktop/electron/gateway-download-transport.test.ts` | The download never follows a redirect or retries after the save phase; the connect timeout drops once headers arrive; a stalled body is destroyed. |
| `apps/desktop/electron/gateway-file-download-transport.test.ts` | The cookie transport preserves the session and waits for the dialog without opening a window; HTTP statuses are preserved; a mid-stream failure never clobbers an existing file. |
| `apps/desktop/electron/gateway-file-download.fs.test.ts` | A completed download replaces the destination and leaves no temp file; a failed one leaves the pre-existing destination intact; a failed rename removes only the owned temp file. |
| `apps/desktop/electron/gateway-file-download.test.ts` | The temp path stays beside the destination with a short random name; the pump applies backpressure and waits for the descriptor to close before renaming. |
| `apps/desktop/electron/gateway-stop-before-update.test.ts` | Non-Windows is a no-op; a missing CLI shim does not exec; a failing CLI returns false and never throws. |
| `apps/desktop/electron/gateway-version.test.ts` | The version follows each gateway response without caching; an unavailable gateway stays unknown rather than borrowing another. |
| `apps/desktop/electron/gateway-ws-probe.test.ts` | The probe fails when the gateway closes before opening **or** accepts and immediately closes (credential rejected); `keepWaitingWhile` extends the budget but never past its maximum. |
| `apps/desktop/electron/git-binary-candidates.test.ts` | UGit's `app-*` glob is sorted by version, not lexically; a missing UGit is not an error; PM-managed git wins over the bundled portable git. |
| `apps/desktop/electron/git-repo-scan.test.ts` | Discovery reads nothing when disabled; it never falls back to $HOME; Apple media packages are skipped at any depth on darwin but not on linux. |
| `apps/desktop/electron/git-review-ops.test.ts` | Only allow-listed git env vars are forwarded and `GIT_TERMINAL_PROMPT` stays off; a rename resolves to the new path for plain, brace and collapsing renames. |
| `apps/desktop/electron/git-root.test.ts` | `gitRootForIpc` returns null for invalid and device paths. |
| `apps/desktop/electron/git-worktree-ops.test.ts` | Branch sanitisation, worktree parsing (detached, locked, empty), `ensureGitRepo`, branch listing with the checked-out branch flagged. |
| `apps/desktop/electron/handoff-result-producer.test.ts` | The producer side of the hand-off result, for the legacy and protocol-2 shapes (POSIX only). |
| `apps/desktop/electron/handoff-result.test.ts` | A result is reported at most once; stale results are discarded but the file is still consumed; malformed JSON is kept as `.corrupt`; `manual:true` survives the freshness window. |
| `apps/desktop/electron/hardening.test.ts` | The largest hardening suite: the data-URL read cap, timeouts, secret encryption and the "plain-text opt-in" path, path resolution and the sensitive-extension rules. |
| `apps/desktop/electron/host-backend-singleton-orphan-reap.test.ts` | The #81275 storm: 12 concurrent same-scope reconnect dials coalesce to one, while distinct scopes dial independently. |
| `apps/desktop/electron/host-backend-singleton.test.ts` | Two local profiles connecting concurrently produce **zero** additional backends; the local pool spawn path is unreachable. |
| `apps/desktop/electron/hud-close.test.ts` | A renderer that answers is never destroyed; one that never answers is destroyed at the grace deadline. |
| `apps/desktop/electron/hud-cursor.test.ts` | The zoomed page reports CSS pixels; a cursor outside the window is "lost"; the far edges belong to the window on entry. |
| `apps/desktop/electron/hud-drag.test.ts` | The origin is cursor minus the grab offset; crossing a mixed-DPI display keeps 1:1 tracking; a move before begin is ignored. |
| `apps/desktop/electron/hud-game-overlay.test.ts` | A maximised window stopping at the taskbar does not cover; a fullscreen window on another display does not cover this one; a windowed app in front vetoes the overlay. |
| `apps/desktop/electron/hud-geometry.test.ts` | The default bounds fit a small work area; the reset restores the resize lock; incomplete geometry is rejected. |
| `apps/desktop/electron/hud-hyprland.test.ts` | The dispatch reply is classified the way 0.54 and 0.56 actually behave; the Lua fallback is cached so the next promote does not probe classic first. |
| `apps/desktop/electron/hud-modifier-monitor.test.ts` | The native transport gates gestures on ready and bounds framing; the support policy excludes Wayland even when Xwayland supplies DISPLAY. |
| `apps/desktop/electron/hud-modifier-native.test.ts` | A native-only gesture probe (POSIX only). |
| `apps/desktop/electron/hud-modifier.test.ts` | The opt-in is persisted, stale native callbacks are fenced, and a guest frame's request is rejected. |
| `apps/desktop/electron/hud-overlay.test.ts` | macOS uses the floating window level; Linux and Windows only set the screen-saver always-on-top level. |
| `apps/desktop/electron/hud-snap-shortcut.test.ts` | The chord registers while the HUD is up, `dispose` releases it, and a taken chord fails registration. |
| `apps/desktop/electron/hud-snap.test.ts` | The anchor scales with page zoom and the clamp keeps a sliver visible. |
| `apps/desktop/electron/hud-url.test.ts` | `win=hud` before the hash; the handoff profile in the query; an empty profile is omitted. |
| `apps/desktop/electron/hud-windowing.test.ts` | macOS/Windows share the click-through profile; Linux X11 is solid and placeable; native Wayland cannot place the window and needs compositor drag. |
| `apps/desktop/electron/hyprland.test.ts` | The socket path addresses the running instance (falling back to the uid runtime dir); the client list is ordered by focus history and excludes our own windows. |
| `apps/desktop/electron/keep-awake-controller.test.ts` | The offer after a sleep mid-turn happens **once** and never again after a relaunch; a closed lid or an idle app stays quiet. |
| `apps/desktop/electron/launch-profile.test.ts` | Both `--profile` spellings parse; the name is normalised like the CLI; an invalid flag leaves the stored profile alone. |
| `apps/desktop/electron/link-title-curl.test.ts` | The legacy page decodes from curl's content-type metadata and the trailer is read from the retained tail. |
| `apps/desktop/electron/link-title-url.test.ts` | Leaked directive markup is rejected before it can reach `loadURL`; the cache key never returns the raw string. |
| `apps/desktop/electron/link-title-wall.test.ts` | A proven sign-in wall never escalates to the hidden renderer; an ordinary title-less page does. |
| `apps/desktop/electron/link-title-window.test.ts` | The window is muted, hidden and zero-opacity; a throwing mute still returns the window; downloads triggered by the title fetch are cancelled. |
| `apps/desktop/electron/linux-crash-diagnostics.test.ts` | Fatal Chromium output lands in a file under the Hermes logs dir; other platforms get no switches; a logs dir that cannot be created degrades to no logging. |
| `apps/desktop/electron/linux-gpu-fallback.test.ts` | The fallback marker round-trips; two consecutive aborted boots engage it (not one); an app update re-probes the GPU once instead of degrading forever. |
| `apps/desktop/electron/linux-launcher-ready.test.ts` | One byte is written to the launcher fd, which is closed and the variable consumed; a garbage value is a no-op. |
| `apps/desktop/electron/linux-nvidia-egl-fallback.test.ts` | The fallback is **behavioural**: a witnessed GPU death on this host engages it; a healthy prior boot keeps hardware GL; a driver or app update re-probes once. |
| `apps/desktop/electron/local-backend-lifecycle.test.ts` | Shutdown joins a removed start and prevents its late spawn; it is bounded even if startup ignores cancellation; the abort sentinel is an expected transition. |
| `apps/desktop/electron/local-filesystem-path.test.ts` | Every bare local path shape is recognised; URLs and relative names are not. |
| `apps/desktop/electron/local-gateway-deadline.test.ts` | An ensure client that ignores termination is killed and its promise settles; the default client outlives the protocol deadline and reads the verdict. |
| `apps/desktop/electron/local-gateway-python-bundled.test.ts` | A bundled payload mints a ticket (POSIX only). |
| `apps/desktop/electron/local-gateway-python-launcher-argv.test.ts` | A `.cmd` override in a path with spaces asks its launcher for the runtime; a launcher spawned without a shell keeps its bare path. |
| `apps/desktop/electron/local-gateway-python-native.test.ts` | Native pipe tickets reuse one bridge (Windows only). |
| `apps/desktop/electron/local-gateway-python-runtime.test.ts` | A Python backend is the helper interpreter as-is; a bundled launcher keeps its CLI command but names the payload Python. |
| `apps/desktop/electron/local-gateway-python.test.ts` | The Python ticket bridge pins its interpreter and environment (POSIX only). |
| `apps/desktop/electron/local-gateway-restart-detach.test.ts` | A stale-owner restart asks for `--detach`, and a runtime that predates it is handled (POSIX only). |
| `apps/desktop/electron/local-gateway-stale-restart-owner.test.ts` | A second owner on the same stale code is restarted while a served one is not. |
| `apps/desktop/electron/local-gateway-symlinked-home.test.ts` | A sibling route under a symlinked home resolves to the same gateway (POSIX only). |
| `apps/desktop/electron/local-gateway-ticket-identity.test.ts` | A profile home resolves to exactly the home the gateway reserves for it. |
| `apps/desktop/electron/local-gateway-unsafe-path.test.ts` | An unsafe control path surfaces without forgetting and re-ensuring the gateway. |
| `apps/desktop/electron/local-gateway.test.ts` | The largest gateway suite: the ensure client inherits the *scrubbed* env, a spaced Windows path is quoted, a canonical ensure cannot cross a rejected update, and a private dial credential is one-use. |
| `apps/desktop/electron/local-read-path.test.ts` | The WSL bridge resolves media, IPC and preview paths without destroying a leading slash or percent bytes. |
| `apps/desktop/electron/local-skin.test.ts` | The configured skin reads without a live gateway; the named profile's skin wins over the root; malformed config and traversal-like names fail closed. |
| `apps/desktop/electron/log-rotation.test.ts` | An oversized log cascades to backups; a boot-loop log past the discard ceiling is **reclaimed**, not stranded; truncation really frees the file. |
| `apps/desktop/electron/mac-usage-strings.test.ts` | Every TCC-gated desktop capability declares a usage string. |
| `apps/desktop/electron/machine-profile.test.ts` | The renderer channel reports native machine facts. |
| `apps/desktop/electron/main-process-lag-watchdog.test.ts` | Nothing is logged while ticks arrive on cadence; a late tick is recorded with actionable timing; stopping is safe mid-shutdown. |
| `apps/desktop/electron/main-window-lifecycle.test.ts` | A destroyed primary is recreated without focusing it; a live primary is focused for a normal second launch; the last-chat fallback quits only for a final non-macOS close. |
| `apps/desktop/electron/managed-ssh-update.test.ts` | The gate blocks new dials but admits the exact owner; a durable recovery claim survives memory release; a correlated remote exit 0 ends recovery on the first failure. |
| `apps/desktop/electron/mcp-oauth-callback-ipc.test.ts` | The loopback listener resolves with the redirect; the RFC 9207 `iss` is relayed; a favicon request does not settle it; cancel tears it down. |
| `apps/desktop/electron/media-capture-permission.test.ts` | One policy for both handlers: the widened permission strings are allowed with and without metadata, unrelated permissions are denied. |
| `apps/desktop/electron/media-protocol.test.ts` | Range/cache headers are forwarded but renderer credentials are stripped; a 206 is served through the production local fetch; a token-auth remote stream keeps the token out of the URL. |
| `apps/desktop/electron/media-range.test.ts` | Open, closed and suffix ranges parse; a multi-range request is answered as a whole file; 416 for unsatisfiable, 404 for a missing file. |
| `apps/desktop/electron/minimize-to-tray.test.ts` | The tray hide is deferred past the minimize dispatch; a Windows restore re-activates rather than showing inactive; a restore before the deferred hide cancels it. |
| `apps/desktop/electron/native-access-token.test.ts` | Normalised hosts share a rotation and a late bearer rejection reuses it; a newer login intent fences an out-of-order completion. |
| `apps/desktop/electron/native-auth-decisions.test.ts` | The token POST body is the raw object (no pre-stringify); `oauthSessionIsLive` is true for a bearer *or* a live cookie; a native 401 is a confirmed non-retryable reauth. |
| `apps/desktop/electron/native-oauth-login.test.ts` | The loopback round trip returns tokens; a state mismatch (CSRF) rejects without redeeming; a gateway error param and a timeout both surface. |
| `apps/desktop/electron/native-oauth.test.ts` | The PKCE pair is a valid S256 pair and unique per call; the login strategy is native only when the gateway advertises it. |
| `apps/desktop/electron/native-token-store.test.ts` | The token set survives a store/load round trip; tokens are encrypted at rest and never plaintext in the store file; a corrupt file loads as signed out rather than throwing; a locked keychain keeps the stored entry. |
| `apps/desktop/electron/native/hud-modifier-gesture.test.c` | The C gesture state machine's release-only contract (compiled C). |
| `apps/desktop/electron/native/hud-modifier-x11.test.py` | The X11 gesture monitor's contract, exercised from Python. |
| `apps/desktop/electron/no-console-git.test.ts` | A timed-out git command reaps its descendants; the Windows spawn uses a `CREATE_NO_WINDOW` host and does not rewrite the argv; the resolver skips `pythonw` and the WindowsApps stub. |
| `apps/desktop/electron/notification-actions.test.ts` | Electron's event details are preferred over the legacy positional form; missing and out-of-range indexes are ignored. |
| `apps/desktop/electron/notification-ipc.test.ts` | Native clicks and approval actions return to the emitting window, not to the focused one. |
| `apps/desktop/electron/notification-linux.test.ts` | A failed delivery is bounded without dropping older callbacks and is retried; activation, dedupe and source ownership are preserved. |
| `apps/desktop/electron/notification-registry.test.ts` | A dismissed banner is retained until its later click or action; an opted-in release is immediate without expiring. |
| `apps/desktop/electron/oauth-auth-recovery.integration.test.ts` | HTTP rotation survives an encrypted restart and concurrent ticket mints; an outage, a dead refresh token and cookie coexistence reach the correct outcome. |
| `apps/desktop/electron/oauth-login-flights.test.ts` | A burst of background 401s opens **one** window; a click is never held by a background cooldown; the same origin on two cookie jars gets two independent flows. |
| `apps/desktop/electron/oauth-login-window.test.ts` | An unattended sign-in never shows its window and gives up on a deadline; a foreground silent sign-in reveals itself; an overnight burst opens one hidden window. |
| `apps/desktop/electron/oauth-navigation.test.ts` | `ERR_ABORTED` callback navigation is non-fatal; a genuine load failure is not suppressed. |
| `apps/desktop/electron/oauth-net-request.test.ts` | The body is JSON-encoded and `Content-Length` is never set by hand. |
| `apps/desktop/electron/oauth-partition.test.ts` | Two same-host different-port gateways get **distinct** partitions; the v1 primary, the registry primary, Cloud and token-auth remotes stay on the legacy partition; a hostname prefix is not a base-URL match. |
| `apps/desktop/electron/oauth-rest-request.test.ts` | A cookie 401 is replayed only for a gate refusal on an idempotent request; a ticket mint vouches for a replay; ticket mints force one rotation on a bearer 401. |
| `apps/desktop/electron/open-missing-file.test.ts` | A missing path and an ENOTDIR path both read as missing; a non-ENOENT stat failure is **not** converted into a fabricated miss. |
| `apps/desktop/electron/package-process-reap.test.ts` | A sibling package whose name shares the prefix does not match; a nullish root never matches everything; a kill failure does not stop the loop. |
| `apps/desktop/electron/parent-process-identity.test.ts` | The Electron creation time is used only for Electron; a failed probe is degraded and retried later; the watchdog env falls back atomically to PID-only. |
| `apps/desktop/electron/payload-backend.test.ts` | The bundled launch paths come from build metadata without filesystem access; ticket minting runs the payload python, never the CLI shim. |
| `apps/desktop/electron/pet-overlay.test.ts` | Click-through is off on Linux; a quit suppresses the pop-in echo; an off-screen saved spot is pulled wholly onto a display and a sliver is clamped. |
| `apps/desktop/electron/plugin-profile-routes.test.ts` | SSH aliases are grouped without exposing endpoints; IDs change when the effective destination changes; one SSH resolution failure is isolated to its route. |
| `apps/desktop/electron/plugin-ws-url.test.ts` | The grant header travels once and never in the URL; encoded, dot-segment and backslash paths stay inside the namespace; a permission refusal is a named reply. |
| `apps/desktop/electron/portal-cookies.test.ts` | Either portal credential family signs in, and gateway cookies and routing hints do not count. |
| `apps/desktop/electron/portal-session-live.test.ts` | A live sign-in against a loopback-only portal (skipped when no display is available). |
| `apps/desktop/electron/portal-session.test.ts` | A superseded portal navigation stays open until the new access cookie lands; a real load failure still ends the sign-in. |
| `apps/desktop/electron/power-resume-remote-revalidation.test.ts` | A dead-tunnel descriptor is retired and rebuilt on the **first** failed post-resume probe; a healthy one is left alone; a failed rebuild retires the descriptor. |
| `apps/desktop/electron/power-save.test.ts` | The blocker starts once, is idempotent and re-arms after the OS dropped it; the mode and the live turn picture must agree before it is held. |
| `apps/desktop/electron/pre-update-backup-config.test.ts` | The disabled modes are recognised case-insensitively and with surrounding spaces; a runtime resolution failure fails safe. |
| `apps/desktop/electron/preload-external-open.test.ts` | The bridge exposes the external-open failure channel and forwards the payload. |
| `apps/desktop/electron/preload-flags.test.ts` | The feature flags answered by main are published before the renderer starts; renderer error lines are forwarded through the bridge. |
| `apps/desktop/electron/preload-local-skin.test.ts` | The preload carries the local skin across before the renderer starts. |
| `apps/desktop/electron/prepared-submissions.test.ts` | An acknowledged journal mutation survives reopening with the exact payload; a corrupt journal is quarantined with its bytes kept. |
| `apps/desktop/electron/preview-capture.test.ts` | The rect is floored/ceiled and never zero; the CSS rect is mapped onto a DPR bitmap; a destroyed guest **fails closed**. |
| `apps/desktop/electron/preview-file-watch.test.ts` | The change is delivered to the owning WebContents, not a different window; the watch is torn down when the owner is destroyed or missing. |
| `apps/desktop/electron/preview-guest-escape.test.ts` | Escape exits fullscreen only while the host window is fullscreen; Ctrl/Cmd+Shift+W closes the preview regardless; key releases and repeats are ignored. |
| `apps/desktop/electron/preview-guest-offscreen.test.ts` | A focused guest the host reported hidden is untouched; visibility comes only from the embedding renderer. |
| `apps/desktop/electron/preview-guest-preload.test.ts` | A trusted `_blank` click is forwarded once in the capture phase; synthetic clicks, non-primary buttons and non-`_blank` targets are not. |
| `apps/desktop/electron/preview-guest-throttle.test.ts` | The preview guest keeps animating while the Desktop window is inactive and no other webview is affected. |
| `apps/desktop/electron/preview-reach.test.ts` | The loopback target accepts any port (not a curated list); the rewrite keeps path, query and hash and forces http; a non-loopback URL opens nothing. |
| `apps/desktop/electron/preview-url-target.test.ts` | A public https page navigates; a loopback dev server is kept and `0.0.0.0` is rewritten; every non-http scheme is rejected. |
| `apps/desktop/electron/primary-backend-cancellation.test.ts` | Quitting cancels a first-run startup without entering the installer. |
| `apps/desktop/electron/primary-backend-startup.test.ts` | The remote descriptor preserves the registry connection, the extra headers and the effective SSH identity; after update clearance a registry primary is selected before any local spawn; a null primary still spawns local exactly once. |
| `apps/desktop/electron/primary-profile-pin.test.ts` | A live primary keeps answering for its booted profile after the preference changes; teardown releases the pin; one launch decision feeds routing, argv and env. |
| `apps/desktop/electron/product-identity.test.ts` | The baked runtime identity never evaluates ambient build selectors; the non-stable runtime pins userData before the app name can change; the Store identity is the Partner Center one and no other. |
| `apps/desktop/electron/profile-delete-routing.test.ts` | The delete target is parsed strictly (method, path, encoding); the default profile is a no-op; the pool is torn down and the route moves away. |
| `apps/desktop/electron/profile-migration.test.ts` | The legacy profile file is parsed strictly; stale (recycled) pids are dropped; the state-db score prefers the right candidate. |
| `apps/desktop/electron/profile-rename-routing.test.ts` | The rename request is parsed from string and object bodies; the pooled backend is torn down and the route moved; a failed rename restores the original primary. |
| `apps/desktop/electron/profile-session-routing.test.ts` | The largest routing suite: remote session identity, the read-only all-profiles scope, pinned registry aggregation, sidebar slice merging and the revision fence. |
| `apps/desktop/electron/quick-entry.test.ts` | A stale correlation id is ignored; an unacknowledged submit resolves as a non-retryable timeout; a late success is reconciled without hiding the window; an accelerator already taken is reported. |
| `apps/desktop/electron/quit-finalization.test.ts` | A single Windows exit is forced once the admitted quit exceeds its deadline; a completed quit cancels the fallback and it never re-arms. |
| `apps/desktop/electron/quit-guard.test.ts` | The prompt stays out of the way when nothing is running or during an update hand-off; it names the running chats; an attached (local) gateway is not treated as owned. |
| `apps/desktop/electron/quit-teardown.test.ts` | A settled remote descriptor is not work that requires a deferral; a teardown failure still releases the final quit; a reentrant quit cannot start a second teardown. |
| `apps/desktop/electron/registry-backend-identity.test.ts` | A slow or failing identity probe reads as unknown; the primary install id is cached per backend URL and re-probed when it changes. |
| `apps/desktop/electron/registry-primary-profile-scope.test.ts` | Primary-remote descriptor reuse keeps the profile scope and never reuses a different live identity. |
| `apps/desktop/electron/remote-lifecycle-gate-transport.test.ts` | The POSIX relaunch gate reaches a verdict even over a transport that refuses. |
| `apps/desktop/electron/remote-lifecycle-profile-missing.test.ts` | `scrapeReadyPort` explains a missing remote profile and keeps the generic spawn failure otherwise. |
| `apps/desktop/electron/remote-lifecycle-spawn.test.ts` | The remote spawn variants (POSIX) and the platform gate. |
| `apps/desktop/electron/remote-lifecycle-v2-marker.test.ts` | The v2 marker shape on the remote side. |
| `apps/desktop/electron/remote-lifecycle.test.ts` | The largest suite in the shard (2,246 lines): SSH reuse proof, the POSIX relaunch gate's marker rules, remote install-id reads and profile inventory. |
| `apps/desktop/electron/remote-liveness.test.ts` | Consecutive failures are required before a connection is reset; a successful probe clears the streak; a reset consumes the threshold and starts fresh. |
| `apps/desktop/electron/remote-oauth-ticket.test.ts` | A larger bounded dial budget is reserved for OAuth remotes; a fresh ticket is minted on every dial; only a confirmed auth rejection is classified as reauth. |
| `apps/desktop/electron/remote-owner-cache.test.ts` | The memo never grows past its limit (FIFO eviction) and re-remembering an id refreshes it without growing the map. |
| `apps/desktop/electron/remote-reauth-latch.test.ts` | A native-bearer 401 is a confirmed, non-retryable reauth. |
| `apps/desktop/electron/remote-session-cookies.test.ts` | `Set-Cookie` parsing flags deletions; the origin key ignores the port; RFC-6265 path matching is implemented; the store serialises a `Cookie` header per partition. |
| `apps/desktop/electron/remote-update-marker-programs.test.ts` | The remote marker judge agrees with the desktop's judge on the shared corpus, on POSIX and on PowerShell. |
| `apps/desktop/electron/remote-ws-headers.test.ts` | The header store evicts the least recently used exact URL; the token path binds headers to the exact profile-scoped URL; configured headers stay inside their gateway path. |
| `apps/desktop/electron/renderer-accessibility.test.ts` | Accessibility is on by default on the typed platforms, never on the others, and honours the opt-out env bridge. |
| `apps/desktop/electron/renderer-bundle.test.ts` | Module references are parsed (absolute/CDN URLs dropped); a torn generation names the dangling chunk; an unreadable index is not treated as torn; the probes never stat. |
| `apps/desktop/electron/renderer-crash-metrics.test.ts` | Nothing is recorded until the user opts in; only bucketed reasons are stored; revoking consent deletes the pending file; take/ack claims one at a time; fs errors never escape. |
| `apps/desktop/electron/renderer-heap-flags.test.ts` | Both launch keys are read from config.yaml and a well-formed `--js-flags` is planned; an existing `--js-flags` on argv is merged, not overwritten; `desktop.ssh_path` is read in several YAML forms. |
| `apps/desktop/electron/renderer-load-error-page.test.ts` | The error page names the failure, carries a Reload button, escapes the failure details, and the reload URL cannot break out of the inline script. |
| `apps/desktop/electron/renderer-log.test.ts` | Only error-level console lines are formatted; malformed events are dropped; signature drift is reported once; the boundary report clamps oversized fields. |
| `apps/desktop/electron/renderer-manifest.test.ts` | The Vite manifest validates lazy assets without opening their JavaScript; a manifest from another generation falls back. |
| `apps/desktop/electron/roster-source-fetch.test.ts` | The profile and install-id reads start together, and a profile-read failure is preserved after the install-id read starts. |
| `apps/desktop/electron/roster-source-status.test.ts` | Stale cached profiles are not reported as a reachable or signed-in gateway. |
| `apps/desktop/electron/save-text-file.test.ts` | The file is written where the user chose; an overwrite is confirmed; a cancelled dialog writes nothing; oversized content is refused before a dialog opens. |
| `apps/desktop/electron/secret-storage-policy.test.ts` | A missing policy file defaults to encryption **off**; a truthy-but-not-`true` value does not enable it; a safeStorage blob with encryption off and post-migration is dropped, never a token. |
| `apps/desktop/electron/select-paths-dialog.test.ts` | A directory picker can create a new folder; file pickers stay file-only and multi-select by default. |
| `apps/desktop/electron/select-runnable-binary.test.ts` | Missing candidates are never probed and nothing existing yields null. |
| `apps/desktop/electron/session-windows.test.ts` | The session/instance window URLs put their flag before the hash, carry the owning profile, and the instance window cascades off its source bounds. |
| `apps/desktop/electron/shell-path.test.ts` | The sentinel survives profile banner noise; the last start marker wins; the login PATH is merged first; `-ilc` falls back to `-lc`; Windows is a no-op. |
| `apps/desktop/electron/singleton-lock.test.ts` | The owning PID is read only for this hostname; a zombie or missing owner is stale (where `kill(pid,0)` alone would not say so). |
| `apps/desktop/electron/source-backend.test.ts` | The source backend resolves a real interpreter and the Windows console selection uses only the selected interpreter directory. |
| `apps/desktop/electron/source-python.test.ts` | A checkout with no virtualenv resolves to **no** interpreter rather than a wrong one; an explicit developer interpreter wins but is honoured only when it is usable. |
| `apps/desktop/electron/spawn-helper-perms.test.ts` | An archived node-pty root is rewritten to the unpacked tree; only the non-executable helpers are chmod'ed; failures are collected, not thrown. |
| `apps/desktop/electron/ssh-binary.test.ts` | The `desktop.ssh_path` override is returned verbatim; System32 OpenSSH is preferred; Git for Windows and PortableGit are the fallbacks; non-Windows always gets bare `ssh`. |
| `apps/desktop/electron/ssh-bootstrap-coordinator.test.ts` | A changed fingerprint waits for the old rollback before starting; a cancel invalidates every pending scope; a generation started during a cancel cannot run before the drain. |
| `apps/desktop/electron/ssh-config.test.ts` | `Host` aliases are de-duplicated and wildcards dropped; `Include` traversal is read-only and cycle-safe; `ssh -G` parsing takes the first identity file. |
| `apps/desktop/electron/ssh-connection.test.ts` | The largest SSH suite: secret redaction (env var, URL params, headers, a credential glued into a target), the control socket path staying under `sun_path`, and the house `ControlMaster` options. |
| `apps/desktop/electron/ssh-control-master-holders.test.ts` | Only the last holder may exit the master; holders are counted per ControlPath; re-acquiring and double-releasing are idempotent. |
| `apps/desktop/electron/ssh-isolated-keepalive.test.ts` | A keep-alive socket is held per scope until the scope stops; an empty scope is the v1 global SSH primary but still needs a scope key. |
| `apps/desktop/electron/ssh-teardown.test.ts` | Quit joins a teardown whose routing entry was already removed; a stuck teardown cannot hang quit forever. |
| `apps/desktop/electron/startup-latency-ipc.test.ts` | The launch latency is claimable once per app launch, whichever window claims it. |
| `apps/desktop/electron/stream-throttle.test.ts` | A turn in flight unthrottles every chat window and settling re-throttles; repeated busy reports do not stack timers; closed and destroyed windows drop out without throwing. |
| `apps/desktop/electron/system-ca.test.ts` | Expired roots are excluded and duplicates removed; Windows and macOS system CAs are installed without dropping the defaults; linux is not inspected; a failure fails open. |
| `apps/desktop/electron/terminal-ipc.test.ts` | The terminal start preserves the selected SSH target, does not invent SSH when canonical routing selects a local backend, and keeps routing isolated by renderer sender id. |
| `apps/desktop/electron/terminal-lc-ctype.test.ts` | `terminalLcCtype` never hands glibc the bare `UTF-8` locale on Linux. |
| `apps/desktop/electron/terminal-output-gate.test.ts` | The initial prompt is held until the renderer attaches; buffered output is flushed before an early shell exit; attach is idempotent. |
| `apps/desktop/electron/terminal-pty-dispose.test.ts` | An exited shell releases its PTY handle without waiting for the tab; an explicit dispose kills the PTY and drops the session. |
| `apps/desktop/electron/titlebar-overlay-width.test.ts` | Windows and WSLg reserve the overlay fallback width; macOS keeps a height-only traffic-light overlay; Tahoe (Darwin 25) drops the overlay height to 0. |
| `apps/desktop/electron/translucency.test.ts` | The largest UI suite (707 lines): the intensity clamp, the mode normalisation per platform, the opacity ramp's bit-identical endpoints and the backdrop updates. |
| `apps/desktop/electron/tray-host.test.ts` | A registered host is required; dbus-native 0.15's bare boolean and the older `{value}` shape both work; a missing host rejects without leaving a handle open. |
| `apps/desktop/electron/update-api-proxy.test.ts` | The update API uses an HTTPS proxy only when the environment selects one, and the request reaches the configured HTTP CONNECT proxy. |
| `apps/desktop/electron/update-gate-cancellation.test.ts` | Quitting interrupts an update-gated wait instead of waiting for the next poll. |
| `apps/desktop/electron/update-gate.test.ts` | The gate opens only when neither marker nor flag is set; the marker wins as the reported reason; it parks across the flag→marker hand-off without a gap. |
| `apps/desktop/electron/update-handoff-ack.test.ts` | A claimant that published our run and was SIGKILLed before the ack is a failure; a claimant with a *different* run is an unrelated update; a reused-pid creation time is not taken. |
| `apps/desktop/electron/update-handoff-marker.test.ts` | The POSIX hand-off preserves the marker (POSIX only). |
| `apps/desktop/electron/update-handoff-report.test.ts` | The boot wait reports the result of the run it last parked on. |
| `apps/desktop/electron/update-hold-wiring.test.ts` | The boot snapshot carries the update hold to the primary window, and a non-primary window cannot quit from the hold screen. |
| `apps/desktop/electron/update-marker-async-probe.test.ts` | The Linux creation-time probe is asynchronous and correct; the macOS probes ask `ps` without `lstart`. |
| `apps/desktop/electron/update-marker-corpus.test.ts` | The shared corpus constants are the Desktop constants, and **no marker module unlinks, renames, truncates or overwrites a path** (A7 rule 3). |
| `apps/desktop/electron/update-marker-gate.test.ts` | `held` never opens the gate by itself, long past the old 2 h ceiling; "Start anyway" opens only the hold it names; two empty dead markers are two holds; a failing helper is retried. |
| `apps/desktop/electron/update-marker-readonly.test.ts` | Every read-only operation over a dead marker leaves it in place; a stale 0-byte marker is judged dead and left alone. |
| `apps/desktop/electron/update-marker.test.ts` | The v1/v2/delegate parse; a LIVE v2 owner past 20 minutes stays live; a gate wait probes each pid's creation time **once**; a dead owner with a LIVE delegate keeps the marker live. |
| `apps/desktop/electron/update-order.test.ts` | A local handoff waits for remote updates that outlive its exit deadline; remote updates still run concurrently with each other. |
| `apps/desktop/electron/update-prerequisites.test.ts` | PM update prerequisites use the exact published launcher, not a checkout. |
| `apps/desktop/electron/updater-process.test.ts` | A staged updater predating the rewritten marker is rejected; the updater console is hidden and the child detached; the staged binary is null off Windows. |
| `apps/desktop/electron/updater/app-installer-recovery.test.ts` | The App Installer restores **only after** teardown begins; a handoff error retains the cleanup failure while still restoring the backend. |
| `apps/desktop/electron/updater/app-installer-strategy.test.ts` | A marker-write failure never blocks the update; the package's registered source is used when no feed is configured; no feed URL means a manual card and no teardown. |
| `apps/desktop/electron/updater/channel-artifact-lifetime.test.ts` | Ordinary Windows preparation owns temporary bytes while a resumable download is in flight. |
| `apps/desktop/electron/updater/channel-native.test.ts` | The download verification binds the native bytes to the manifest's size and digest. |
| `apps/desktop/electron/updater/channel.test.ts` | The channel manifest drops retired bundle keys but rejects unknown ones; the protected archive prefix falls back closed; the checked target stays pinned during apply. |
| `apps/desktop/electron/updater/checkout-current-sha.test.ts` | `currentSha` is filled from the install stamp when the probe omitted it; `readStampedCommit` returns null for absent and malformed stamps. |
| `apps/desktop/electron/updater/checkout-handoff.test.ts` | The Windows wrapper is spawned non-detached so the script stays alive; a failed spawn keeps the app alive and reports; a timed-out hand-off kills the real script tree. |
| `apps/desktop/electron/updater/checkout-legacy.test.ts` | A checkout without a source probe moves to main and surfaces a broken state. |
| `apps/desktop/electron/updater/checkout-ownership.test.ts` | Ownership classification across checkout shapes. |
| `apps/desktop/electron/updater/checkout-source.test.ts` | Each install channel is carried from the Python publication check into the Desktop's own status. |
| `apps/desktop/electron/updater/commit-build.test.ts` | One-commit artifacts refuse both check and apply on every platform, with a manual-update escape. |
| `apps/desktop/electron/updater/feed-config.test.ts` | The feed is read across equivalent YAML representations only; a configured feed base is held to the update-origin rule and a bad one throws. |
| `apps/desktop/electron/updater/mac-client.test.ts` | The generated provider is used by default and implicit installs are forbidden; a newer channel head wins when SemVer build metadata is equal. |
| `apps/desktop/electron/updater/mac.test.ts` | The release is checked, verified **before** teardown and installed once; a substituted pinned version is refused; the backend is restored if the install hand-off throws. |
| `apps/desktop/electron/updater/marker-helper.test.ts` | The protocol is negotiated; a missing script is legacy; a verdict only the other op can give is an error, never clearance; a helper past its timeout is killed. |
| `apps/desktop/electron/updater/operation.test.ts` | Check and apply share one pending strategy, and a failed initialisation is not cached as a pending update. |
| `apps/desktop/electron/updater/relaunch-isolation.test.ts` | Writes and startup consumption stay in each installation; a cancellation removes only its own installation's state. |
| `apps/desktop/electron/updater/relaunch-waiter-lifecycle.test.ts` | The waiter's ownership survives its whole lifecycle; a missing script refuses startup before spawning; the script log report keeps only this attempt. |
| `apps/desktop/electron/updater/relaunch-waiter-resource.test.ts` | The Windows packaging config ships the relaunch waiter at the resources root. |
| `apps/desktop/electron/updater/relaunch-waiter-spawn.windows-live.test.ts` | A live Windows relaunch-waiter spawn. |
| `apps/desktop/electron/updater/relaunch-waiter.windows-live.test.ts` | The live waiter tags every line of a multi-line script error with its attempt. |
| `apps/desktop/electron/updater/state-db-preflight.test.ts` | The preflight publishes committed WAL rows before it is called; a managed install runs the snapshot through the installation launcher. |
| `apps/desktop/electron/updater/store-client.test.ts` | The production runner passes the mode, the full HWND and the isolated payload identity; unusable replies are refused. |
| `apps/desktop/electron/updater/store.test.ts` | Automatic relaunch is required and its registration cancellable; the download happens before shutdown; unknown availability is refused. |
| `apps/desktop/electron/updater/update-metrics.test.ts` | A hand-off run is reported once as success after the restart; a failed run reports only a bucketed stage, never error text. |
| `apps/desktop/electron/updater/updater.test.ts` | The build stamp decides update ownership per platform; an unstamped development build is treated accordingly; the manual update command is branch-pinned off main. |
| `apps/desktop/electron/user-launcher-install.test.ts` | A user-bin launcher is ignored when it reports no Hermes source tree (POSIX only). |
| `apps/desktop/electron/venv-holder-select.test.ts` | The hindsight daemon shim and the autostart gateway shim match; an unrelated process that merely borrows the venv never does; the prefix boundary excludes `ScriptsX`. |
| `apps/desktop/electron/vscode-marketplace.test.ts` | The zip central directory is read; the contributed colour themes are extracted with `./` paths resolved; icon/product-icon packs are filtered out. |
| `apps/desktop/electron/wake-indicator.test.ts` | The helper window is centred on the selected display, prefers the internal display, and rejects an unknown renderer state. |
| `apps/desktop/electron/watch-storm-breaker.test.ts` | The breaker arms only on win32; a storm closes the watcher and falls back to polling; the window resets; a throwing snapshot is treated as a change. |
| `apps/desktop/electron/web-text-decoder.test.ts` | A quoted Big5 charset is honoured; a meta charset is sniffed; an unknown charset falls back to UTF-8; the HTTP charset beats a conflicting meta declaration. |
| `apps/desktop/electron/window-accelerator.test.ts` | Close Tab / Reload / zoom reset are claimed on keyDown only; the keyUp left over from another app is ignored. |
| `apps/desktop/electron/window-below.test.ts` | The pick takes the first overlapping window behind ours in z-order, skips our own windows, and treats edge-adjacent bounds as no overlap. |
| `apps/desktop/electron/window-chrome-events.test.ts` | Every chrome event is published per window, never from the primary. |
| `apps/desktop/electron/window-connection-route.test.ts` | A registry-scoped route is normalised and kept distinct from a legacy one; routes are isolated by webContents id; a primary apply re-points the window route. |
| `apps/desktop/electron/window-controls.test.ts` | Minimize, toggle-maximize, restore focus and close are dispatched to the sender; unknown actions and destroyed windows are rejected; the WSL fallback is fs-free. |
| `apps/desktop/electron/window-focus-policy.test.ts` | An invisible window is revealed with `showInactive()`; an already-visible window is left alone; focus is taken only when the window lacks it. |
| `apps/desktop/electron/window-growth.test.ts` | The window is "app-sized" until the user moves it; an existing user's window is put back where it was when the intro ends. |
| `apps/desktop/electron/window-menu.test.ts` | macOS registers the native Window menu so AppKit attaches its commands; non-macOS keeps the cross-platform menu. |
| `apps/desktop/electron/window-open-policy.test.ts` | The hub predicates admit exactly the two hub origins; artifact frames (opaque origin) get no external open at all; `file://` is never delegated. |
| `apps/desktop/electron/window-renderer-lifecycle.test.ts` | A crashed secondary is logged and reloaded; an expected teardown is logged without reloading; the crash-loop budget is **shared across all windows**; `unresponsive` is logged, never reloaded. |
| `apps/desktop/electron/window-reveal.test.ts` | Reveal happens on `ready-to-show` or through the 4 s fallback, settles exactly once, and never reveals a destroyed window; a main-frame load failure fires `onRevealFailed` once. |
| `apps/desktop/electron/window-state.test.ts` | Garbage state is rejected; a partial position is dropped but the size kept; an off-screen or sliver window is not restored. |
| `apps/desktop/electron/windows-backdrop.test.ts` | Active glass stays transparent when the material changes; a tint-only or opacity-only change writes no native state. |
| `apps/desktop/electron/windows-child-options.test.ts` | A spaced Windows shell command is quoted and never double-quoted; `windowsHide` is added on Windows and preserved elsewhere; `stopBackendChild` tree-kills on Windows and group-kills on POSIX. |
| `apps/desktop/electron/windows-hermes-path.test.ts` | PATHEXT extensions are tried before the empty extension; `chooseUpdaterArgs` requires a usable runtime; the venv shim must be named `hermes` inside a real venv. |
| `apps/desktop/electron/windows-msys-bash-env.test.ts` | Both MSYS opt-outs are set on Windows, existing values are preserved, and it is a no-op off Windows and on a shallow clone. |
| `apps/desktop/electron/windows-remote-lifecycle.test.ts` | The Windows spawn holds the update mutex across the marker check and the helper call; the PowerShell transport uses UTF-16LE encoded commands; CLIXML progress-stream pollution is tolerated; the relaunch gate refuses live and uncertain markers. |
| `apps/desktop/electron/windows-sandbox-fallback.test.ts` | The breakpoint exit is recognised signed and unsigned; a single mid-boot abort does **not** drop the sandbox (two-strike); the fallback is sticky within one app version but an update re-probes once; the ACL repair fires only on evidence. |
| `apps/desktop/electron/windows-stack-cookie-fallback.test.ts` | The stack-cookie exit is recognised signed and unsigned and `STATUS_BREAKPOINT` is explicitly rejected (the sandbox owns it); the relaunch fires only for the right renderer reason and never after a healthy boot. |
| `apps/desktop/electron/windows-user-env.test.ts` | A `REG_SZ` value is parsed case-insensitively with its spaces intact; `%VAR%` refs expand; a non-zero `reg` exit yields null without spawning off Windows. |
| `apps/desktop/electron/workspace-cwd.test.ts` | The install root itself and paths nested under it are flagged; paths outside are not. |
| `apps/desktop/electron/wsl-clipboard-image.test.ts` | The PowerShell command survives UTF-8 transport; base64 without a PNG signature is rejected; the first candidate that returns an image wins. |
| `apps/desktop/electron/wsl-path-bridge-profile.test.ts` | The bridge is per-profile: a local primary keeps it on, a remote primary turns it off, and three profiles behave independently. |
| `apps/desktop/electron/wsl-path-bridge.test.ts` | The default distro is parsed from clean UTF-8 and from UTF-16LE with NUL bytes; a non-absolute path is left alone; the bridge can be turned off and on. |
| `apps/desktop/electron/wslg-launch-process.test.ts` | The WSLg launch process supervises the app and restarts it only once (Linux only). |
| `apps/desktop/electron/wslg-launch.test.ts` | The invocation is preserved and only native Wayland restarts it; an explicit x11 platform on the command line is kept; `desktop.electron_flags` can choose the ozone platform. |
| `apps/desktop/electron/zoom.test.ts` | The storage key is stable across upgrades; the clamps reject garbage; level 0 is exactly 100 %; the preset percentages round-trip and are monotonic; the Windows re-assert wiring is installed. |

---


## 2. Ideas worth stealing

1. **Verb-gated retry with an explicit "did the body go out?" fence.**
   *What:* idempotent verbs retry on any transient transport error; non-idempotent
   verbs retry **only** when the request provably never reached the server — a
   connection-establishment failure, or a per-attempt `bodySent` flag that is still
   `false` because it is set immediately *before* the first byte is flushed.
   *Where:* `apps/desktop/electron/api-transport.ts:96` (`shouldRetryRequest`),
   `:139` (`withRetry`).
   *Why it transfers:* August Trading's provider calls, plan validation calls and
   any "log this trade" write are POSTs. A network blip that arrives *after* the
   server processed the request is indistinguishable from one that arrived before.
   This is the discriminator, and it is one line of caller discipline.
   `UNIQUE` to this repo so far.

2. **A tiny cross-language lease file, judged by a shared corpus.**
   *What:* one plain-text file names the owner (`pid`, `started_at`, `ct:<creation
   time>`) and an optional delegate; every runtime (Python, Rust, bash, PowerShell,
   TypeScript) parses and judges it with the *same* constants, and every one of them
   must pass the same fixture corpus.
   *Where:* `apps/desktop/electron/update-marker.ts:1`,
   `apps/desktop/electron/update-marker-judge.ts:1`,
   `apps/desktop/electron/remote-update-marker-programs.ts:1`,
   `apps/desktop/electron/update-marker-corpus.test.ts:1`.
   *Why it transfers:* a trading app needs "who owns the strategy for this profile
   right now" to be answerable by the renderer, the main process, a worker and a
   CLI, on three operating systems, without a database. This is exactly that shape,
   and the corpus is the part that makes it trustworthy.
   `CONVERGENT` in spirit — the pattern is the same across four languages here, and
   `pi`/`deepseek-harness` will be checked for it by the other shards.

3. **Never mutate the lease yourself — delegate the read-judge-mutate to a helper
   that holds the kernel lock.**
   *What:* Electron may *read and judge* the update marker but must never delete,
   rename, truncate or overwrite it; the mutation belongs to the checkout's script
   helper, which holds a `<marker>.lock` sidecar for the whole operation. A test
   asserts the rule mechanically ("no marker module unlinks, renames, truncates or
   overwrites a path").
   *Where:* `apps/desktop/electron/update-marker.ts:33`,
   `apps/desktop/electron/updater/marker-helper.ts:1`,
   `apps/desktop/electron/update-marker-corpus.test.ts:1`.
   *Why it transfers:* a browser or React-Native trading client has no kernel lock
   either. The rule "the process that owns the lock is the only one allowed to
   change it" is portable, and asserting it in a test is free.
   `UNIQUE`.

4. **Sticky degradation that expires on a version change.**
   *What:* a crash-loop fallback is recorded in a marker file keyed by the app
   version; the next launch honours it, but **an app update re-probes once** instead
   of degrading forever.
   *Where:* `apps/desktop/electron/windows-sandbox-fallback.ts:106`,
   `apps/desktop/electron/linux-gpu-fallback.ts:713`,
   `apps/desktop/electron/windows-stack-cookie-fallback.ts:1142`.
   *Why it transfers:* any "safe mode" in August Trading (a provider disabled after a
   failure, a reduced feature set, a paper-trading fallback) becomes a permanent
   penalty unless the same escape hatch exists.
   `UNIQUE`.

5. **Two-strike rule plus one shared crash-loop budget across every surface.**
   *What:* one mid-boot abort does not trigger the fallback; two do. And the reload
   budget (3 in 60 s) is shared by **all** windows, so a crash-looping secondary
   cannot spend the primary's budget.
   *Where:* `apps/desktop/electron/window-renderer-lifecycle.ts:971`,
   `apps/desktop/electron/windows-sandbox-fallback.ts:1104`.
   *Why it transfers:* August Trading's Electron shell has the same shape (a chat
   window, an analysis window, an overlay). A per-window budget means one bad
   surface can degrade the whole app.
   `UNIQUE`.

6. **Detectors that must never false-positive, and the shape of "not stale".**
   *What:* every uncertain input — no stamp, a fallback all-zero commit, an unknown
   commit, a non-ancestor, a git failure — reports the same non-alarming answer,
   because the warning tells the user their install is torn.
   *Where:* `apps/desktop/electron/bundle-skew.ts:45`,
   `apps/desktop/electron/bundle-swap.ts:29`.
   *Why it transfers:* August Trading's "your bundle/state is out of date" banners
   need the same discipline, and the `NOT_STALE` single-value constant is the shape.
   `UNIQUE`.

7. **Ownership is pid *plus* creation time — never pid alone — and memos are
   bounded.**
   *Where:* `apps/desktop/electron/backend-ownership.ts:1`,
   `apps/desktop/electron/backend-claim.ts:1`,
   `apps/desktop/electron/remote-owner-cache.ts:1`.
   *Why it transfers:* a trading app that keeps a "which agent/session owns this
   conversation" memo in the main process will leak exactly the way this one did
   (#58485) unless the memo is FIFO-bounded at the point of insertion.
   `UNIQUE`.

8. **Ask before destroying in-flight work, and distinguish *owned* from *attached*.**
   *What:* the quit prompt is different for a backend the app starts and stops
   (an SSH-managed server) and one it merely attaches to (the local gateway, which
   keeps running and keeps the turn alive after the app quits).
   *Where:* `apps/desktop/electron/quit-guard.ts:1`,
   `apps/desktop/electron/quit-teardown.ts:1`.
   *Why it transfers:* "an automation run is in flight — stop it or not?" is the
   same question, and the honest answer differs depending on whether the runner
   would survive the app closing.
   `UNIQUE`.

9. **A settled result is reported exactly once, and stale results are discarded
   unread.**
   *What:* read-and-delete so a result is reported at most once; a result older than
   the freshness window is deleted without being read — except a `manual:true`
   result, which is the durable action-required channel and is exempt.
   *Where:* `apps/desktop/electron/handoff-result.ts:1`.
   *Why it transfers:* a settled trade, a filled order or a completed backtest
   should be announced once and never resurface days later — and the "manual" flag
   is the shape of "this still needs you".
   `UNIQUE`.

10. **One timestamp format across every log file, and a hard reclaim ceiling.**
    *What:* every log line in `logs/` carries the same stamp shape (Python's
    `asctime`), so one parser reads them all; rotation bounds growth but never
    reclaims, so anything past 4× the cap is deleted outright — "the updated app
    self-heals a disk a stale build filled, on the next launch".
    *Where:* `apps/desktop/electron/desktop-log-line.ts:1`,
    `apps/desktop/electron/log-rotation.ts:1`.
    *Why it transfers:* a trading app's trade log, error log and agent log should
    share one clock and one parser, and its growth ceiling should reclaim rather
    than rotate.
    `UNIQUE`.

11. **A human override that names the specific thing it releases.**
    *What:* "Start anyway" opens *only* the hold it names; two empty dead markers
    are two separate holds, so overriding one does not release the other.
    *Where:* `update-marker-gate.ts` (`allowStartOverHold`,
    `markerHoldId`).
    *Why it transfers:* an "override the safety rule" action in a trading app
    should be scoped to the instance it applies to, not a global bypass.
    `UNIQUE`.

12. **Mark an expected transition so the forensic log does not cry wolf.**
    *What:* a sentinel Error flag makes the crash reporter record a normal, intended
    transition as a one-line event; an unmarked error with the same message still
    renders in full.
    *Where:* `apps/desktop/electron/crash-forensics.ts:24`.
    *Why it transfers:* an expected "the trader closed the app mid-turn" event
    should not page anyone, but a real crash must still be loud.
    `UNIQUE`.

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work: not in this shard.** The desktop owns no
  cron, no digest and no poll loop; it owns the *gateway* and the lifecycle around
  it. What it does contribute is the substrate any long-lived scheduled work
  needs: (a) a durable cross-process lease that names its owner and survives a
  crash (`update-marker.ts`), (b) a **hold gate** that parks new local work while an
  exclusive operation owns the runtime, with three independent signals
  (`update-gate.ts`), and (c) a cleanup ladder that never hands control away while
  its own children are still exiting (`backend-release-gate.ts`). Those three are
  the pieces to steal for a scheduled scan.
- **Human-in-the-loop approval: yes, and it is the clearest thing in this shard.**
  `quit-guard.ts` asks before destroying in-flight work, and its prompt text
  *differs* depending on whether the backend is owned or merely attached — so the
  trader is never warned about work that will actually survive. `update-marker-gate.ts`
  adds the second half: a human override scoped to one hold. Between them they
  define the two properties August Trading's approval flows need — *the right
  question*, and *an override that names what it releases*.
- **Post-mortem / reflection loops: not in this shard** (no learning, memory or
  rule-accumulation code lives here). Two structural analogues are worth noting
  anyway: the **shared corpus** (`update-marker-corpus.test.ts`) is the shape a
  "every new rule must pass a fixed fixture set" loop takes, and the read-once
  receipt (`handoff-result.ts`) is the shape a "settlement is announced exactly once"
  record takes.
- **Multi-agent / debate: not in this shard.** The nearest thing is the *dial claim*
  (`backend-dial-claim.ts`) — a single-owner claim keyed by scope, so that two
  windows racing the same wake cannot bootstrap a duplicate remote backend. If
  August Trading ever runs two agents against the same profile, this is the
  pattern.
- **Structured logs the model can query: partially yes, and the trick is small.**
  Every file in `logs/` (`desktop.log`, `desktop-chromium.log`, `agent.log`,
  `gui.log`, `errors.log`) carries the *same* stamp shape — Python's `asctime` —
  so one parser (`hermes logs desktop --since`) reads them all, and the desktop's
  own lines are written by a shared formatter rather than ad-hoc
  `toISOString()` calls. The Chromium fatal log is routed to a file rather than
  stderr because "every Linux launcher discards stderr"
  (`linux-crash-diagnostics.ts`). Growth is bounded by rotation *and* reclaimed
  outright past 4× the cap.
- **Staying simple as features accumulate: the honest answer is that this repo does
  not.** 330 modules and 105 IPC channels is a large surface. What is worth taking
  is the *decomposition rule*, not the count: each module is named for one decision
  (`backend-claim`, `bundle-skew`, `quit-guard`, `profile-id-guard`), carries no
  Electron import where it can be avoided, and has a **same-named test file**. A
  feature is "one module + one test + one row in the IPC table", not a new
  subsystem. The `hermes:<domain>:<verb>` channel vocabulary is the other half:
  105 channels and they are all greppable.

## 4. Non-obvious decisions and gotchas

1. `api-transport.ts` — the retry decision hinges on a flag the *caller* must set
   immediately before flushing. Forget it and a POST is never retried: fail-safe,
   but silent.
2. `active-runtime-state.ts` — the bootstrap marker is **provenance, not authority**.
   A healthy runtime must launch even with no marker; the reverse convention
   strands a working install in the installer (#60721, #72166).
3. `bundle-skew.ts` — `git rev-list A..HEAD` only means what you think if A is an
   ancestor of HEAD. Check ancestry first or the skew count is permanently ≥ 1 even
   when the tree is byte-identical (#92233).
4. `backend-connection-state.ts` — a *stale* `exit` handler can clear a *newer*
   attempt's promise unless a generation counter is checked. The whole module is
   that guard.
5. `ssh-control-master-holders.ts` — `ssh -O exit` tears down the master for
   **every** attached connection. Only the last holder may run it; an earlier
   closer just releases its claim (#97264).
6. `oauth-partition.ts` — Chromium cookie jars scope by host and **ignore the
   port**, so two gateways on one host shared a jar: signing in to B evicted A's
   session and A's cookie was silently presented to B on every request — a
   cross-connection credential leak.
7. `update-marker-judge.ts` — a v1 marker (no creation time) falls back to a
   20-minute age ceiling; a v2 marker is matched on creation time within 2 s. A
   recycled pid on Windows therefore parks boot for ~20 minutes.
8. `app-icon.ts` — `statSync().isFile()` proves existence, not decodability.
   Electron decodes the icon synchronously inside `createWindow()` and throws,
   which kills the main process and the app with it.
9. `desktop-log-line.ts` — the stamp format is Python's `asctime` **on purpose**, so
   one parser reads every file in `logs/`.
10. `local-gateway.ts` — the ensure client is killed only after the protocol
    deadline **plus** interpreter start and verdict output, so a slow-but-valid cold
    start is never reported as "produced no result".
11. `preload.ts` / `window-controls.ts` — importing `node:fs` into the sandboxed
    preload, *even transitively*, throws before `contextBridge` runs and takes the
    whole `window.hermesDesktop` bridge down with it.
12. `hardening.ts` / `translucency.ts` — a shared import must be **relative**: the
    electron bundle is built by esbuild with no tsconfig path resolution, so
    `@hermes/shared/...` typechecks and then fails to bundle.
13. `remote-lifecycle.ts` — a lockfile that *exists* but does not match is a
    fail-closed skew sentinel: skip it, do not overwrite it.
14. `renderer-bundle.ts` — never `stat` a path inside `app.asar`; it constructs a
    deprecated `fs.Stats` and prints DEP0180 on every packaged launch.
15. `remote-lifecycle.ts` / `update-marker.ts` — an *authenticated* probe, not pid
    liveness, is what proves a remote backend is reusable.

## 5. Weak spots

1. **`main.ts` is 18,468 lines / 687 KB** with 407 top-level functions and 105 IPC
   handlers. The 330 sibling modules prove the monolith was recognised and
   decomposed — but the orchestrator itself was never split, and it still does
   work at module scope (creating the gateway dials, configuring the ticket
   client), which is why the file cannot be imported in a test.
2. **Four near-identical "sticky fallback marker" state machines** — Linux GPU,
   NVIDIA EGL, Windows sandbox, Windows stack-cookie — each re-implementing the
   same `booting | fallback | ok` + reason + version shape with different constants.
   One shared marker state machine would cover all four.
3. **The update marker's "fail open to alive" default can park boot for ~20
   minutes** (a probe failure reads as "alive"; a recycled Windows pid hits the v1
   age ceiling). The escape is the human "Start anyway" override — but a trader
   whose app will not boot for 20 minutes has, in effect, been given the problem
   the marker was supposed to prevent.
4. **Hand-rolled JSON marker files with no uniform schema discipline.** One reader
   (`bundle-swap.ts`) deliberately skips the schema check; others parse loosely.
   The `update-marker` corpus is exemplary, but that discipline was not applied
   everywhere it should have been.
5. **Unresolved markers left in the source**: `app-version.ts` carries a
   `ponytail:` comment ("English-only fallback; localize if the native panel ever
   needs it") — an acknowledged TODO shipped in a load-bearing module.
6. **`updater/channel.ts` retirement semantics are genuinely hard** (in-place vs
   discontinued receivers, a publisher-pinned retirement, a version floor a
   destination below it is refused for) and are spread across four files
   (`channel.ts`, `channel-strategy.ts`, `channel-native.ts`,
   `channel-windows-host.ts`) that each re-derive parts of the identity
   comparison.



