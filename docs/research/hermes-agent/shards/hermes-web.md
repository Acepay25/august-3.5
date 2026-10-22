# hermes-agent :: hermes-web

**Files in shard:** 250 (read: 202, skipped with reason: 48 — 11 binary assets, 17 locale
dictionaries, 1 API facade, 1 theme provider, 18 page surfaces; every skip names the exact extent
read in the status ledger)
**What this shard covers:** the entire `web/` frontend of Hermes Agent — a Vite + React 19 + TypeScript
dashboard that fronts a Python/FastAPI "hermes" agent. It is a *control-plane* UI, not the agent
runtime: the primary chat surface is the **real `hermes --tui` embedded over a PTY** (xterm.js), and
everything else (sessions, cron, skills, models, keys, plugins, profiles, MCP, webhooks, pairing) is a
management surface over a REST API. The shard is dominated by ~112 `lib/` modules — small, single-purpose,
heavily unit-tested helpers — and ~39 components, plus a 21-locale i18n layer and 25 page surfaces.
The recurring engineering theme is **ownership of state under a shared, multi-profile, multi-process
backend**: which socket owns a session, which profile a write targets, which banner a component may
clear, which request is allowed to land. Almost every module carries a doc comment explaining a
specific bug it exists to prevent — that commentary is the most valuable artefact in the shard.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `web/AGENTS.md`
- **Purpose:** the rules doc for `web/` + `hermes_cli/web_routers/`, layered on the repo root `AGENTS.md`.
- **Key abstractions:** n/a (prose). It states the load-bearing rule: **"The dashboard embeds the REAL
  `hermes --tui` — not a rewrite"** (`web/AGENTS.md:11-18`). The transcript, composer and slash-command
  behaviour belong to the Ink TUI; the dashboard must not re-implement them.
- **Data flow:** `web/src/pages/ChatPage.tsx` → xterm.js → `WebSocket /api/pty?token=…` →
  `hermes_cli/pty_bridge.py` (`ptyprocess`, POSIX PTY) → `node ui-tui/dist/entry.js` → `tui_gateway` +
  AIAgent. Resize travels as `\x1b[RESIZE:<cols>;<rows>]`, intercepted server-side and applied with
  `TIOCSWINSZ` (`web/AGENTS.md:29-33`).
- **Non-obvious design decisions:** (a) "Do not re-implement the primary chat experience in React" —
  the React side may add *complementary* panels (`ChatSidebar`, `ModelPickerDialog`) but must keep their
  state independent of the PTY child and surface failures non-destructively so the terminal pane keeps
  working (`web/AGENTS.md:37-39`). (b) `dashboard` vs `serve` are **independent surfaces**; `serve` sets
  `HERMES_SERVE_HEADLESS=1` so `mount_spa()` disables the SPA even if a stray `web_dist/` exists
  (`web/AGENTS.md:45-51`). (c) "Auth: every new REST route and WS endpoint uses the same session token;
  never a second scheme." (d) "Routers are one-file-per-surface" — a new surface is a new
  `web_routers/<surface>.py`, not a growing `web_server.py`.
- **Edge cases & failure handling:** the doc notes POSIX PTY works on WSL but **not native Windows** —
  this is the root cause of the `PTY_START_FAILED_MESSAGE` copy in `web/src/lib/pty-close-copy.ts:53-55`.
- **Surprising:** a dashboard for an AI agent deliberately does *not* own the chat. The entire React
  chat surface is a terminal emulator with a side rail.

### `web/src/App.tsx` (1406 lines)
- **Purpose:** the app shell — sidebar, nav, route table, banner stack, persistent chat host.
- **Key abstractions:** `BUILTIN_ROUTES_CORE` (20 routes, `web/src/App.tsx:104-124`), `BUILTIN_NAV_REST`
  (18 nav items), `buildNavItems` / `partitionSidebarNav` / `buildRoutes` (plugin-aware nav + routing,
  `web/src/App.tsx:196-320`), `RouteFallback`, `UnknownRouteFallback`, `ProfileKeyedRoutes`,
  `SidebarNavLink`, `SidebarSystemActions`, `GatewayDot`, `SidebarTooltip`.
- **Data flow:** `main.tsx` mounts `BrowserRouter → I18nProvider → ThemeProvider → SystemActionsProvider
  → ProfileProvider → App`. `App` reads `usePlugins(profile)` for manifests, `useSidebarStatus()` for
  the 10 s status poll, and `api.getConfig()` for the `dashboard.show_token_analytics` flag. Every route
  page is `lazy()`-imported so the shell does not pay for xterm/three/plot up front
  (`web/src/App.tsx:16-38`).
- **Non-obvious design decisions:**
  - **The chat host is mounted persistently but lazily activated.** `ChatPage` is rendered *outside*
    `<Routes>` and hidden with `display:none` so the PTY, WebSocket and xterm instance survive tab
    switches; the host is deferred until the first `/chat` visit via a **sticky latch**
    (`latchChatActivation`, `web/src/App.tsx:329-334`). The comment at `web/src/App.tsx:95-103` spells
    out the cost: mounting early would spawn the whole TUI + agent bootstrap (`Installing TUI
    dependencies…` → `npm install`) the moment *any* page loads.
  - **A plugin may override `/chat`, and the loading gate is load-bearing.** `chatOverriddenByPlugin`
    is computed from asynchronously-arriving manifests, so on first render it is always false; without
    the `pluginsLoading` gate the host would mount, spawn a PTY, then be yanked out from under the user
    (`web/src/App.tsx:381-408`).
  - **Profile scope remounts the whole routed tree.** `ProfileKeyedRoutes` keys on the selected profile
    so every page refetches; otherwise a page opened under profile A would show A's state while writes
    silently targeted profile B — "the exact stale-target footgun the switcher exists to kill"
    (`web/src/App.tsx:837-850`).
  - **One mobile-header spacer, not one per banner.** A comment records the review finding: each
    banner used to carry its own `mt-14` *and* the content kept `pt-14`, so two visible banners stacked
    three offsets (`web/src/App.tsx:572-576`).
- **Edge cases & failure handling:** `localStorage` access is wrapped in try/catch for private-browsing
  (`web/src/App.tsx:349-364`); the mobile drawer locks `body` overflow and restores the previous value
  on cleanup; a `matchMedia` listener closes the mobile nav at ≥1024 px.
- **Surprising:** the sidebar's system actions (Restart / Update Hermes) are *not* a page — they live
  in the nav rail with confirmation dialogs and a poll-to-completion toast (`web/src/App.tsx:1082-1113`).

### `web/src/lib/api.ts` (2779 lines — transport core read; endpoint inventory extracted)
- **Purpose:** the single typed facade over every backend endpoint (171 methods, `web/src/lib/api.ts:429-1447`).
- **Key abstractions:** `fetchJSON<T>` (`web/src/lib/api.ts:177-271`), `authedFetch` (raw `Response`,
  for uploads/blobs, `web/src/lib/api.ts:315-330`), `getWsTicket` / `buildWsAuthParam` (gated-mode
  single-use WS tickets, `web/src/lib/api.ts:290-313`), `setManagementProfile` / `getManagementProfile`,
  `withManagementProfile`, `PROFILE_SCOPED_PREFIXES`, `HERMES_BASE_PATH`.
- **Data flow:** `api.foo()` → `fetchJSON(url)` → `withManagementProfile(url)` (appends `?profile=`) →
  session-token header injection → `fetch(BASE + url, { credentials: "include" })` → on non-2xx,
  `apiErrorFromResponse(status, body, url)` → `ApiError`; on network failure,
  `apiErrorFromNetworkFailure` → `ApiError` with `status: 0`.
- **Non-obvious design decisions:**
  - **Profile scoping is a URL-prefix allow-list, not a per-call argument.** `PROFILE_SCOPED_PREFIXES`
    (`web/src/lib/api.ts:109-161`) lists 40+ endpoint families; `withManagementProfile` rewrites only
    those. An explicit `profile=` in the URL always wins (`web/src/lib/api.ts:170`).
  - **The scope falls back to the profile the backend itself serves**, injected as
    `window.__HERMES_DASHBOARD_PROFILE__` — "the fallback is not a guess: the backend injects a name
    only when it provably resolves back to its own home" (`web/src/lib/api.ts:91-103`). Without it every
    destructive route 400s on a host that merely *has* a second profile directory.
  - **401 has two distinct recoveries.** A structured `unauthenticated` / `session_expired` envelope with
    a `login_url` triggers a full-page redirect (gated OAuth mode) and never resolves
    (`web/src/lib/api.ts:209-242`); a bare 401 in loopback mode triggers a **once-per-session** page
    reload, because the server rotates `_SESSION_TOKEN` on every restart and the open tab holds the old
    one (`web/src/lib/api.ts:243-256`).
  - **A 2xx clears the reload latch** (`web/src/lib/api.ts:258-263`) so a later 401 gets its own cycle.
- **Edge cases & failure handling:** `credentials: "include"` always, so the cookie path works and
  loopback is unaffected; the raw body and URL are kept on the error object for a "Copy details" action
  (`ApiError.details`, `web/src/lib/api-error.ts:100-104`).
- **Surprising:** `fetchJSON` is *not* a thin wrapper — it is where the auth model, the profile scope,
  the error taxonomy and the 401 recovery policy live. Every one of those is documented at the point of
  decision.

### `web/src/lib/api-error.ts`
- **Purpose:** the user-facing error shape for the whole REST layer.
- **Key abstractions:** `ApiError` (`status`, `body`, `url`, `details` getter), `extractDetail`,
  `humanizeStatus` (status → plain sentence), `apiErrorFromResponse`, `apiErrorFromNetworkFailure`,
  `errorMessage(err)`, `API_UNREACHABLE_MESSAGE`.
- **Data flow:** raw body → `extractDetail` (parses JSON `detail` / `message` / `error`; joins FastAPI
  validation arrays; reads `detail.message` out of a structured `{error, message, path}`; refuses HTML
  pages; refuses bodies > 300 chars) → `ApiError(message, { status, body, url })`.
- **Non-obvious design decisions:** the module exists because `fetchJSON` used to throw
  `new Error("<status>: <raw body>")` and ~40 toast call sites interpolated the Error object, producing
  `Error: Error: 404: {"detail":"..."}` (`web/src/lib/api-error.ts:3-11`). `errorMessage` reads
  `.message`, never `String(e)`, so the double prefix cannot come back.
- **Edge cases & failure handling:** a network failure is *not* a 500 — `status: 0` and the message
  becomes "Hermes dashboard cannot reach the Hermes service. Is `hermes dashboard` still running?"
  (`web/src/lib/api-error.ts:17-19`).
- **Surprising:** the error *type* carries the status so a caller can branch on 401/403/409 without
  re-parsing the message (`web/src/components/AuthWidget.tsx:80-86`).

### `web/src/lib/session-mutations.ts`
- **Purpose:** optimistic-concurrency session writes (rename / delete / import).
- **Key abstractions:** `createDashboardSessionMutations(fetchJSON)` wrapping the shared
  `createSessionMutationClient` from `apps/shared`.
- **Data flow:** every mutation first GETs `/api/sessions/{id}/mutation-snapshot` → the snapshot's
  `runtime_revision` / `runtime_generation` / `request_id` become the request identity → the write is sent
  with `expected_revision` / `expected_generation` / `request_id`. The payload is **frozen** (deep JSON
  clone) before the await so a UI change cannot alter a request whose identity is already fixed
  (`web/src/lib/session-mutations.ts:12-16`).
- **Non-obvious design decisions:** the write is retried **unchanged** after a lost reply, because the
  request id makes it idempotent (pinned by `web/src/lib/session-mutations.test.ts`: "prepares import
  and delete from snapshots and retries unchanged after a lost reply"). A missing snapshot is an error,
  never a silent "just do it".
- **Edge cases & failure handling:** a 409 surfaces as `revision_conflict`; `request_id` falls back to
  a `crypto.getRandomValues`-derived UUID when `crypto.randomUUID` is unavailable on an insecure origin.
- **Surprising:** the client refuses to substitute missing counters — a session with no snapshot cannot
  be deleted, by design.

### `web/src/lib/cron-job.ts`
- **Purpose:** the pure logic behind the cron editor and the cron job list.
- **Key abstractions:** `CronJobFormState`, `buildCronJobPayload`, `cronJobFormFromJob`,
  `cronJobHasExecutionContent`, `cronLastResult` / `CronLastResultTone`, `cronNextRunOverdueMs`,
  `cronSchedulerStaleAgeS`, `cronAgoLabel`, `CRON_NEXT_RUN_OVERDUE_GRACE_MS` (15 min),
  `CRON_SCHEDULER_STALE_S` (3 missed ticks + slack).
- **Data flow:** form state → `buildCronJobPayload` (optional fields collapse to `null` so an update
  *explicitly clears* them rather than leaving stale values, `web/src/lib/cron-job.ts:44-46`) → the API.
- **Non-obvious design decisions:**
  - **Continuity is stored as the reserved `"self"` entry inside `context_from`.** Users never type
    "self"; the checkbox is the surface, and any hand-typed variant is stripped first
    (`web/src/lib/cron-job.ts:47-52`). The form→record direction splits it back out into a boolean.
  - **The `last_status` tone table is closed and explicit.** `ok` → success, `delivery_failed` →
    warning (amber, *not* green and *not* the same red as a run error), `blocked_config` → warning, and
    **any unrecognised literal → destructive** so a new backend status can never render as a neutral
    "unknown"-looking badge (`web/src/lib/cron-job.ts:122-145`).
  - **Delivery failure and run failure are different fields.** `delivery_failed` reads
    `last_delivery_error` first (the agent run succeeded; the output never reached the target);
    `last_error` is null for those runs.
  - **A stale `next_run_at` is never presented as an upcoming "Next".** `cronNextRunOverdueMs` returns
    the overdue duration only past the 15-minute grace, and returns null for paused/completed/disabled
    jobs or an unparseable stamp (`web/src/lib/cron-job.ts:152-166`).
- **Edge cases & failure handling:** `cronSchedulerStaleAgeS` dates the **oldest** stale ticker across
  profiles, ignores jobs not expected to fire, and returns null when the server could not date the tick
  (`web/src/lib/cron-job.ts:170-186`).
- **Surprising:** the "delivery failed" case exists because a scheduled job that ran fine but could not
  deliver is a *different operational state* from one that failed — and conflating them is how a
  monitoring surface starts lying.

### `web/src/lib/schedule.ts`
- **Purpose:** a human schedule builder over a deliberately broad backend grammar.
- **Key abstractions:** `ScheduleMode` (`interval|daily|weekly|monthly|once|custom`),
  `ScheduleBuilderState`, `buildScheduleString`, `parseScheduleString`, `describeSchedule`,
  `parseSimpleCronExpression`, `ScheduleDescribeStrings`, `englishOrdinal`.
- **Data flow:** picker state → `buildScheduleString` → one backend-compatible string
  (`"every 30m"`, `"0 9 * * *"`, `"30 14 * * 1,3,5"`, `"2026-02-03T14:00:00"`). In reverse, a stored
  schedule → `parseScheduleString` → picker state.
- **Non-obvious design decisions:**
  - **Interval syntax is preferred over cron** because `"every 30m"` survives a backend without
    `croniter` installed and reads better in a job list; raw cron is emitted only when the picker needs
    its expressiveness (`web/src/lib/schedule.ts:99-110`).
  - **Humanisation refuses to guess.** `describeCronExpression` returns `null` for anything with
    ranges, steps, or 6+ fields, and the caller falls back to the raw expression. The doc is explicit
    why: destructuring only the first five fields of `0 9 * * * 2099` would silently drop the year and
    read as "Daily at 09:00" (`web/src/lib/schedule.ts:322-335`).
  - **The "Custom" escape hatch is a normal option**, not hidden behind an advanced toggle
    (`web/src/components/ScheduleBuilder.tsx:24-27`).
- **Edge cases & failure handling:** cron Sunday `7` is normalised to the builder's Sunday `0`;
  an empty weekday selection emits `*` rather than a backend 400; a 16-char `datetime-local` value gets
  `":00"` appended so the backend's `T` branch and `isoformat()` agree.
- **Surprising:** `parseScheduleString` and `buildScheduleString` are round-trip tested over 12
  fixtures, including the lossy `1,7 → 0,1` normalisation (`web/src/lib/schedule.test.ts`).

### `web/src/lib/pty-reconnect.ts`
- **Purpose:** the reconnect policy for the embedded PTY terminal.
- **Key abstractions:** `PtyConnectionState` (`connecting|open|reconnecting|closed|ended`),
  `shouldReconnectPtyOnPageResume`, `shouldBlockPtyInput`, `ptyReconnectDelayMs`, and the constants
  `PTY_RECONNECT_BASE_MS` (250), `PTY_RECONNECT_MAX_MS` (3 000), `PTY_RECONNECT_MAX_ATTEMPTS` (5),
  `PTY_CONNECTING_TIMEOUT_MS` (8 000), `PTY_TICKET_TIMEOUT_MS` (8 000),
  `PTY_KEEPALIVE_INTERVAL_MS` (20 000), `PTY_RESUME_RECONNECT_THROTTLE_MS` (1 000),
  `PTY_RESUME_SANITIZE_WINDOW_MS` (30 000).
- **Data flow:** `visibilitychange` / `pageshow` / `focus` / `online` events → throttled →
  `shouldReconnectPtyOnPageResume` → schedule a redial → the connect effect rebuilds the socket.
- **Non-obvious design decisions:**
  - **The ladder is short and tight because the PTY is the user's live terminal**: 250 ms → 3 s cap, 5
    attempts, deterministic (no jitter) so the banner can print the exact delay
    (`web/src/lib/pty-reconnect.ts:33-39`).
  - **Two separate timeouts** because the failure modes are different: a socket stuck in `CONNECTING`
    (half-open mobile socket after a radio handoff) vs a *ticket request* that hangs before any socket
    exists, which produces no close event and would otherwise leave the tab on "connecting" forever
    (`web/src/lib/pty-reconnect.ts:19-30`).
  - **A give-up state is sticky.** `reconnectGaveUp` makes the page-resume path return `false`, so a tab
    focus cannot silently restart the ladder behind an overlay that says it stopped
    (`web/src/lib/pty-reconnect.ts:88-95`).
  - **The keepalive is a resize control frame**, not a ping: browsers cannot emit ping frames, and
    `/api/pty` consumes a resize without reaching the child process
    (`web/src/lib/pty-reconnect.ts:41-45`).
- **Edge cases & failure handling:** the `connectInFlight` guard prevents a double-connect in the async
  ticket/URL await gap — but is deliberately overridden when the page already believes it is `closed`
  (the user is actively trying to recover) (`web/src/lib/pty-reconnect.ts:98-108`).
- **Surprising:** `shouldBlockPtyInput(state)` is `state !== "open"` — input is refused in *four* of
  five states, and the same gate is applied to keyboard-shortcut escape sequences so a reconnecting
  session never receives bytes (`web/src/lib/pty-keyboard-shortcuts.ts:63-75`).

### `web/src/lib/pty-resume-sanitizer.ts`
- **Purpose:** strips pathological ANSI that Ink's two-pass virtual scroll emits during session resume.
- **Key abstractions:** `PtyResumeSanitizer` (stateful, `#pending` / `#stripErase`),
  `applyPtyFilters(input, stripErase)`.
- **Data flow:** WebSocket binary frame → `next(chunk)` → hold back a trailing partial escape or a
  trailing newline run → `applyPtyFilters` → xterm `write()`. `flush()` at end of stream.
- **Non-obvious design decisions — the three pipeline facts that shape everything**
  (`web/src/lib/pty-resume-sanitizer.ts:11-27`):
  1. **The PTY is in cooked mode (ONLCR).** `ptyprocess` never calls `setraw()`, so every LF arrives as
     CRLF — a filter matching `\n{50,}` would never fire in production. The burst regex is
     `(?:\r?\n){50,}` and the test file says so explicitly (`web/src/lib/pty-resume-sanitizer.test.ts:8-19`).
  2. **Reads are chunked, not message-framed** (`os.read(fd, 65536)`), so a CSI escape, a UTF-8 code
     point and a long blank-line run can each straddle a frame boundary. All three get trailing-state
     buffering.
  3. **Erase codes are only pathological during the resume replay.** `ESC[K` / `ESC[X` are how a TUI
     clears stale glyphs for spinners and progress bars; stripping them forever corrupts normal output.
     Suppression is bounded to a 30 s window after connect (`endEraseSuppression()`).
- **Edge cases & failure handling:** a buffered *partial escape* is **dropped** at flush, never written
  — emitting one would leave xterm's parser in an "in-escape" state that swallows all output after a
  reconnect (`web/src/lib/pty-resume-sanitizer.ts:143-152`). A buffered newline run *is* emitted
  (collapsed).
- **Surprising:** the collapse threshold is 50 rows, and the tests prove that 49+49 rows split across
  two frames still sum past the threshold (`web/src/lib/pty-resume-sanitizer.test.ts`).

### `web/src/lib/events-reconnect.ts` + `web/src/lib/eventsFeedClient.ts`
- **Purpose:** the reconnect policy and socket for the `/api/events` subscriber (the sidebar's live feed).
- **Key abstractions:** `eventsReconnectDelayMs` (1 s → 30 s cap, **15 attempts**),
  `shouldRetryEventsClose`, `isEventsAuthRejection` (4401/4403 are terminal),
  `eventsReconnectingMessage` / `eventsRejectedMessage` / `eventsGaveUpMessage`,
  `isEventsFeedMessage`, `EVENTS_CONNECT_TIMEOUT_MS` (15 s); `EventsFeedClient` extends the shared
  `JsonRpcGatewayClient` with `replay: false`, `heartbeatDeadlineMs: 0`, and an `onClose` handler.
- **Data flow:** `feed.connect(channel)` → mint a single-use ticket (bounded by the same 15 s deadline
  as the handshake) → open the socket → `onState('open')` / `onClose(code)` → the component owns the timer.
- **Non-obvious design decisions:**
  - **The backoff is deterministic (no jitter) because the banner prints the exact delay**
    (`web/src/lib/events-reconnect.ts:22-27`).
  - **Auth rejections are terminal** (retrying burns tickets); a normal 1000 close is intentional; every
    other code is worth retrying (`web/src/lib/events-reconnect.ts:37-50`).
  - **Every message this module can put in the shared banner starts with a fixed prefix**
    (`"Live tool activity "`) so `isEventsFeedMessage` can recognise it. The feed may only clear a
    banner *it* wrote — otherwise a feed recovery would erase a credential warning or a sidecar error
    the user needs to see (`web/src/lib/events-reconnect.ts:56-66`).
  - **The ticket request is covered by the same deadline as the handshake**; a stalled pre-socket
    request emits no close event and would strand the retry loop on its last banner
    (`web/src/lib/eventsFeedClient.ts:68-76`).
- **Edge cases & failure handling:** `lastCloseCode === null` distinguishes "pre-socket failure" (the
  component must schedule the retry itself) from "socket existed and closed" (the close handler owns
  it) — the two paths de-duplicate via a single pending timer.
- **Surprising:** 15 attempts at 1→30 s is a ~4-minute ladder for the *sidebar*, while the PTY gets 5
  attempts at 250 ms→3 s. Same repo, opposite tuning, because the two surfaces have opposite costs.

### `web/src/lib/pty-attach-token.ts`
- **Purpose:** a per-browser-tab identity for the keep-alive PTY, sent as `?attach=`.
- **Key abstractions:** `ptyAttachToken(rotate = false)`, the module-level `claimedToken`.
- **Data flow:** `sessionStorage["hermes.pty.token.chat"]` → `claim(token)` via the **Web Locks API**
  (`navigator.locks.request(name, { ifAvailable: true })`, holding a never-settling promise) → if the
  lock is unavailable, mint a fresh 32-hex-char token → store it → claim it.
- **Non-obvious design decisions:** the backend maps one attach token to exactly one PTY, so a token two
  tabs present makes the second tab *take over* the first one's terminal (the first is closed 4409 and
  dies). `localStorage` is shared per origin, so every tab read the same value; and Chrome's
  "Duplicate tab" clones `sessionStorage` into the new tab, so neither storage alone isolates tabs
  (`web/src/lib/pty-attach-token.ts:3-12`). The fix is sessionStorage **and** a Web Lock: a tab whose
  token is already claimed by a live document mints its own.
- **Edge cases & failure handling:** the lock is requested **once** per document (Web Locks are not
  reentrant — asking twice in one document deadlocks); browsers without the Locks API degrade to
  sessionStorage isolation only; the lock is released by the browser on document unload, so a *reload*
  of the same tab finds its token free again.
- **Surprising:** a browser API normally used for cross-tab coordination is used here as a **liveness
  proof** — "is another live document holding this token?".

### `web/src/lib/pty-composition.ts`
- **Purpose:** reconciles IME composition events with xterm's `onData` so a committed word is delivered
  exactly once.
- **Key abstractions:** `createPtyCompositionForwarder(send)` → `{ onCompositionEnd, noteTerminalData,
  filterTerminalData, dispose }`; constants `ECHO_WINDOW_MS` (80) and `MAX_DELIVERED_TRACK_CHARS` (256).
- **Data flow:** `compositionend(data)` → 16 ms timer → `send(data)`; xterm `onData` →
  `noteTerminalData(data)` (may cancel the pending fallback) and → `filterTerminalData(data)` (may strip
  a duplicate).
- **Non-obvious design decisions:** mobile IMEs turn composition events and `onData` into *overlapping
  sources of the same user intent*: `compositionend` can fire twice with identical data, can trail
  `onData` that already carried the commit, and `onData` can echo a word the composition path just
  forwarded (`web/src/lib/pty-composition.ts:6-14`). The forwarder keeps a short record of both
  delivery channels and drops re-sends. The 80 ms window is chosen because IME re-fires land within a
  few milliseconds while a human repeating the same commit takes far longer.
- **Edge cases & failure handling:** rapid consecutive commits are *preserved* (the previous one is
  flushed before scheduling the next) rather than discarded; ESC/SGR data is excluded from matching;
  once unrelated terminal data arrives, the fallback is retained even if later callbacks happen to
  spell the composition.
- **Surprising:** `filterTerminalData` returns `""` for a full duplicate but the *new suffix* for a
  strict extension — so a legitimate continuation is not lost (`web/src/lib/pty-composition.ts:118-126`).

### `web/src/lib/pty-mobile-input.ts`
- **Purpose:** normalises Gboard/IME full-line and last-word suggestions into terminal backspaces+retext.
- **Key abstractions:** `shouldTreatInputAsMobileReplacement`, `updatePtyInputLine`,
  `normalizePtyMobileInput`, `MOBILE_REPLACEMENT_WINDOW_MS` (350).
- **Data flow:** `inputType` + data → `shouldTreatInputAsMobileReplacement` → `normalizePtyMobileInput`
  → either `{ data: DELETE.repeat(n) + replacementLine, nextLine, normalized: true }` or the raw data.
- **Non-obvious design decisions:**
  - **The duplicate-final-word collapse requires a ≥2-character word** so legitimate single-letter
    reduplication ("a a", "i i") is not eaten inside the replacement window
    (`web/src/lib/pty-mobile-input.ts:41-49`).
  - **The collapse must match the tracked line's own tail**, so only a word Gboard actually re-emitted
    is collapsed.
  - **Escape sequences RESET the line tracker** rather than appending their printable payload: the flat
    tracker cannot model cursor moves, and recording "hello[D" would poison the next replacement
    (`web/src/lib/pty-mobile-input.ts:100-110`).
- **Edge cases & failure handling:** the tests pin the stale-tracker bug (#106403): a tracker that
  survived a tab switch made the DELETE count wrong ("hel" + 3×DEL + "hello" over a composer holding
  "hello" leaves "hehello"); clearing the tracker on deactivation makes the same input pass through.
- **Surprising:** the component emits raw `DEL` bytes to the PTY to undo an IME suggestion — the
  terminal never learns about the suggestion mechanism at all.

### `web/src/lib/keyboard-inset.ts`
- **Purpose:** soft-keyboard inset math for the mobile terminal.
- **Key abstractions:** `computeKeyboardInset(viewport, layoutHeightPx)`, `keyboardRevealScrollDelta`,
  `KEYBOARD_INSET_MIN_PX` (80).
- **Data flow:** `window.visualViewport` (`height`, `offsetTop`) → `inset = layoutHeight − vv.height −
  vv.offsetTop` → applied as bottom padding on the terminal wrapper → the xterm host shrinks →
  ResizeObserver refit → `term.onResize` sends `RESIZE` to the PTY → Ink redraws the input line above
  the keyboard (`web/src/lib/keyboard-inset.ts:11-22`).
- **Non-obvious design decisions:** neither iOS Safari nor Android Chrome (default
  `interactive-widget=resizes-visual`) shrinks the *layout* viewport, so the `h-dvh` app shell's
  bounding box does not change and `fit()` computes the same (cols, rows). The only reliable signal is
  `visualViewport`. Android Chrome 108+ is additionally handled by
  `interactive-widget=resizes-content` in the viewport meta, where the inset computes ≈0 and this path
  is a harmless no-op.
- **Edge cases & failure handling:** insets below 80 px are treated as 0 (URL-bar show/hide produces
  transient deltas that would thrash the terminal grid; real soft keyboards are ≥ ~150 px);
  non-finite values, negative layout heights and vv taller than the layout all return 0; fractional
  geometry is rounded to whole pixels.
- **Surprising:** `keyboardRevealScrollDelta` deliberately does *not* pin the page to (0,0) — "pinning
  the page to (0, 0) fights iOS and can leave the input line off-screen"
  (`web/src/lib/keyboard-inset.ts:71-85`).

### `web/src/lib/xterm-webgl-gating.ts` + `web/src/lib/xterm-webgl-release.ts`
- **Purpose:** decide whether the fast xterm WebGL renderer is safe, and clean up the GL contexts it leaks.
- **Key abstractions:** `probeWebglSupport(doc)`, `isSafari(userAgent)`, `shouldUseWebglRenderer`,
  `textNeedsDomShaping(text)`, `COMPLEX_SCRIPT_RANGES`; `loseWebglContexts(host)`.
- **Data flow:** `probeWebglSupport` creates a canvas, gets `webgl2`/`webgl`, reads
  `WEBGL_debug_renderer_info` → `UNMASKED_RENDERER_WEBGL`, then **releases the probe context** with
  `WEBGL_lose_context` (browsers cap live contexts at ~16). `shouldUseWebglRenderer` requires width
  ≥ 768 px, not Safari, a real context, and not a software rasterizer.
- **Non-obvious design decisions — three named failure classes**
  (`web/src/lib/xterm-webgl-gating.ts:6-20`):
  - Safari's WebGL texture atlas mangles Unicode box-drawing glyphs (the HERMES banner) — the DOM
    renderer draws them fine.
  - Software rasterizers (llvmpipe, SwiftShader) succeed at `getContext("webgl")` but regl then throws
    "(regl) webgl not supported" from *inside* the addon.
  - Atlas drawing is per code point, so complex scripts that need shaping (Bengali conjuncts) come out
    visually broken; the DOM renderer runs text through the browser's shaper. `textNeedsDomShaping`
    flags 12 Unicode ranges so the addon can be **dropped mid-stream** when such text arrives.
- **Edge cases & failure handling:** `isSafari` excludes every known Chromium/iOS-wrapper fingerprint
  that keeps the legacy `Safari/` UA token (`Chrom(e|ium)/`, `CriOS/`, `FxiOS/`, `EdgiOS/`, `EdgA/`,
  `SamsungBrowser/`, `Android`). Renderer info stripped by privacy modes → benefit of the doubt.
- **Surprising:** `@xterm/addon-webgl` 0.19 removes its canvas on dispose but never calls
  `loseContext()`, so the context survives until GC; ChatPage rebuilds the terminal on every PTY
  reconnect, so a reconnect storm walks into the ~16-context cap and eventually loses the context of
  the terminal the user is looking at (`web/src/lib/xterm-webgl-release.ts:5-15`).

### `web/src/lib/log-classify.ts`
- **Purpose:** classify a log line's level for the Logs page.
- **Key abstractions:** `classifyLine(line) → "error"|"warning"|"info"|"debug"`,
  `LEVEL_TOKEN_RE` (anchored to the line head).
- **Data flow:** line → try the structured level token `^\d{4}-\d{2}-\d{2}[ T][\d:,.]+\s+(DEBUG|INFO|
  WARNING|WARN|ERROR|CRITICAL|FATAL)\b` → else fall back to word-boundary matching.
- **Non-obvious design decisions:** **plain substring matching is deliberately avoided** because INFO
  lines carrying payloads like `parse_errors=0` or paths like `errors.log` must not render red
  (`web/src/lib/log-classify.ts:6-9`). The token is anchored to the line head so payload text cannot
  spoof a level (`INFO chat: user said "ERROR ERROR ERROR"` stays info). The fallback uses word
  boundaries, so `errors=0 all good` and `wrote to errors.log` are info, and `Traceback (most recent
  call last):` is error.
- **Edge cases & failure handling:** `TRACEBACK (` at the start of a line is an error even with no
  level token.
- **Surprising:** this is a whole module (and a whole test file) for a colour decision — because a
  log viewer that cries wolf is worse than no log viewer.

### `web/src/lib/profile-bootstrap.ts`
- **Purpose:** decide the management profile scope when nothing else names one.
- **Key abstractions:** `dashboardInitialProfile()`, `dashboardServingProfile()`,
  `initialProfileScope(searchParams, bootstrap, serving)`, `shouldAdoptActiveProfile(...)`.
- **Data flow:** URL `?profile=` → server-injected `__HERMES_INITIAL_PROFILE__` → server-injected
  `__HERMES_DASHBOARD_PROFILE__` → nothing.
- **Non-obvious design decisions:** the precedence is **URL > bootstrap > serving**, and the serving
  profile is the *last* resort because it "says out loud what an unnamed request already meant" — it
  must never override a scope the URL or the bootstrap payload already named
  (`web/src/lib/profile-bootstrap.ts:39-42`). And `shouldAdoptActiveProfile` only adopts the sticky
  machine-wide `active_profile` when the dashboard itself is the *default-hosted* one: a dashboard
  hosted by a named profile (`hermes -p demo serve`) serves THAT agent, and adopting the machine-global
  active profile would silently retarget its banner, chat TUI env and model to another agent
  (`web/src/lib/profile-bootstrap.ts:44-57`).
- **Edge cases & failure handling:** an explicit empty `?profile=` still outranks bootstrap and serving.
- **Surprising:** the "active profile" file and the "management scope" are deliberately *different*
  concepts, and the code says so.

### `web/src/lib/dashboard-auth-reload.ts`
- **Purpose:** the one-shot page reload for a stale loopback session token.
- **Key abstractions:** `attemptDashboardTokenReloadOnce(storage, reload)`,
  `clearDashboardTokenReloadAttempt(storage)`, `maybeReloadForLoopbackWsAuthFailure(code, authRequired,
  storage, reload)`.
- **Data flow:** WS close code 4401 in loopback mode → `maybeReloadForLoopbackWsAuthFailure` → if not
  gated and the code is exactly 4401 → `attemptDashboardTokenReloadOnce` → check
  `sessionStorage["hermes.tokenReloadAttempted"]` → set it → `window.location.reload()`.
- **Non-obvious design decisions:** the latch lives in **sessionStorage** so a reload does not
  re-arm it (a reload clears nothing in sessionStorage, so the second 401 is ignored and the user sees
  a real error instead of a reload loop); in **gated** mode a 4401 is a real middleware failure and
  must *not* reload.
- **Edge cases & failure handling:** every storage access is try/caught (privacy mode blocks
  sessionStorage entirely).
- **Surprising:** the same policy is applied to the *WebSocket* close code, not just HTTP 401 — the
  two paths share one latch so a page cannot reload twice.

### `web/src/lib/chat-activation.ts`
- **Purpose:** the sticky latch that decides when the embedded chat may spawn its PTY.
- **Key abstractions:** `latchChatActivation(previous, isActive)` → `previous || isActive`.
- **Non-obvious design decisions:** the whole function is three lines because the *reason* is load-bearing
  and the comment carries it (`web/src/lib/chat-activation.ts:3-13`): opening `/api/pty` spawns the
  whole TUI + agent bootstrap, which on a fresh checkout prints `Installing TUI dependencies…` and runs
  `npm install` — so merely loading `/sessions` would trigger it. The latch is **sticky** so the PTY
  still persists across later tab switches.
- **Surprising:** a one-line module with a four-case test file — the behaviour is subtle enough to need
  its own proof.

### `web/src/lib/plugin-update.ts`
- **Purpose:** a plugin update that asks the human before each override the backend requests.
- **Key abstractions:** `runDashboardPluginUpdate(name, copy, ask)`, `scanFindingLines(findings)`,
  `PluginUpdateCopy`, `SEVERITY_ORDER`, `FINDINGS_SHOWN` (8).
- **Data flow:** loop → `api.updateAgentPlugin(name, { acceptCapabilities, force })` → if
  `consent_required` and not yet accepted → ask (the new catalog pin *widens* the plugin; the backend
  changed nothing until confirmed) → set `acceptCapabilities` and retry → if `scan_blocked` and the
  verdict is `caution` and not yet forced → ask, showing severity-sorted findings capped at 8 → set
  `force` and retry → if the verdict is `dangerous` → **throw without asking** (never overridable).
- **Non-obvious design decisions:** **each question is asked at most once**; a refusal returns `false`
  and applies nothing; a `dangerous` verdict is not a question at all.
- **Edge cases & failure handling:** the findings list is truncated with a `+N` line so a native confirm
  stays readable.
- **Surprising:** the client, not the server, is the place where "this update widens the plugin's
  capabilities" is turned into a human decision — and the decision is re-driven by the response, not
  by a local flag.

### `web/src/lib/mcp-dashboard-oauth.ts`
- **Purpose:** complete an MCP server's OAuth flow from the dashboard.
- **Key abstractions:** `completeMcpDashboardOAuth({ serverName, start, status, open, sleep,
  maxPollFailures })`.
- **Data flow:** `open("about:blank", "_blank")` **synchronously from the click handler** → then
  `start(serverName)` → the flow's `authorization_url` is assigned to the already-open window → poll
  `status(flow_id)` every second until `approved`.
- **Non-obvious design decisions:**
  - **The popup is opened BEFORE the first `await`.** Browsers otherwise classify the later OAuth
    popup as unsolicited and block it (`web/src/lib/mcp-dashboard-oauth.ts:33-40`).
  - `authWindow.opener = null` — the auth window must not reach back into the dashboard.
  - **A transient status failure is retried up to `maxPollFailures` (3)** with a 1 s sleep; a
    *terminal* error status throws immediately.
  - **A closed auth window is an error, not a hang** — "OAuth authorization window was closed before
    completion".
- **Edge cases & failure handling:** a blocked popup fails *before* `start` is called (no orphan
  server-side flow).
- **Surprising:** the ordering constraint (open the window first) is the entire hard part of browser
  OAuth, and it is expressed as a two-line comment.

### `web/src/lib/reasoning-markup.ts`
- **Purpose:** parse the model's `<thinking> / <reflection> / <action> / <result>` markup into
  renderable segments.
- **Key abstractions:** `parseReasoningMarkup`, `hasReasoningMarkup`, `shouldRenderStructuredReasoning`,
  `ReasoningMarkupSegment`, `splitFenceAware`, `findMatchingCloseTag` (depth-counted).
- **Data flow:** content → split on code fences → find known tags → nest-aware match → merge adjacent
  prose segments.
- **Non-obvious design decisions:**
  - **Fenced code is never parsed for tags** — "```xml\n<thinking>keep this literal</thinking>```"
    stays literal (`web/src/lib/reasoning-markup.test.ts`).
  - **Only assistant output gets the structured treatment.** A user prompt or a tool result that
    contains a literal `<action>` tag stays on the Markdown path
    (`shouldRenderStructuredReasoning(role, content)`, `web/src/lib/reasoning-markup.ts:26-31`).
  - Unrelated angle brackets (`<div>`, `<custom-tag>`) are not reasoning markup; only a *known* tag
    with a *matching close* counts.
- **Edge cases & failure handling:** an unfinished `<thinking>unfinished` is left as plain text.
- **Surprising:** the depth-counted close-tag matcher makes nested `<thinking>` inside `<thinking>`
  work — the parser recurses into the inner content.

### `web/src/lib/shared-gateway.ts`
- **Purpose:** the copy and the truth-detection for a gateway that may be shared by several profiles.
- **Key abstractions:** `sharedGatewayProfiles(status)`, `sharedGatewayRestartDescription`,
  `sharedGatewayRestartedMessage`, `gatewayStateDescription`, `gatewayStateNeedsLogs`,
  `gatewayActionFailedMessage`, `servedProfileRefusal`.
- **Non-obvious design decisions:**
  - **A restart of the shared multiplexer blips every bot on the device**, so the confirmation names
    them ("All bots on this device reconnect: default, alpha, beta") and the success toast counts them
    (`web/src/lib/shared-gateway.ts:5-19`).
  - **`degraded` + not running is a different story from `degraded` + running.** The former is
    "Exited: a watchdog stopped a wedged gateway — see Logs"; the latter is "Running with some
    channels offline" (`web/src/lib/shared-gateway.ts:28-40`).
  - **A failed action leads with the outcome, then the detail, then the fix** — and the "Open Logs for
    details" pointer is *omitted* when the dashboard itself is unreachable (`ApiError.status === 0`),
    because the Logs page cannot load either (`web/src/lib/shared-gateway.ts:62-79`).
- **Edge cases & failure handling:** punctuation is not doubled when the detail already ends in
  `.`/`?`/`!`; the 409 detail from a served-profile refusal is unwrapped into a sentence.
- **Surprising:** a 409 body is read both from an `ApiError` *and* from the legacy hand-rolled
  `"409: {...}"` string — the module supports two error shapes at once.

### `web/src/lib/aux-tasks.ts` + `web/src/lib/model-picker-current.ts` + `web/src/lib/model-picker-filter.ts`
- **Purpose:** the auxiliary-model slot machinery (vision, compression, skills-hub, approval, MCP,
  title-gen, review, voice, triage, decomposer, describer, curator).
- **Key abstractions:** `BUILTIN_AUX_TASKS` (12 slots, `web/src/lib/aux-tasks.ts:14-28`),
  `auxTaskRows`, `auxTaskLabel`; `isAutoPickerCurrent`, `assignmentToPickerCurrent`,
  `resolvePickerCurrent`, `formatPickerCurrentLabel`, `resolveInitialProviderSlug`;
  `queryMatchesProviderOnly`.
- **Non-obvious design decisions:**
  - **The picker catalog always returns the MAIN chat model**, so an auxiliary slot must pass its own
    assignment or the header shows GLM while the task list shows Qwen. `resolvePickerCurrent` makes the
    override win, and an explicit `{model:"", provider:"auto"}` override is kept as auto rather than
    falling back to main (`web/src/lib/model-picker-current.ts:3-9, 47-60`).
  - **`auto` renders as "auto (use main model)"** — a third state distinct from "no model".
  - **A search query that located the provider by name but matches none of its model ids falls back to
    an unfiltered model list** (typing "aws" finds "AWS Build" whose Claude model ids contain no "aws").
  - **Plugin-registered aux tasks are appended after the built-ins** so the layout stays stable, and
    built-ins always come first (`web/src/lib/aux-tasks.ts:36-48`).
- **Edge cases & failure handling:** a plugin task with no label falls back to its key; a built-in is
  never duplicated.

### `web/src/lib/clipboard.ts`
- **Purpose:** copy text with a guaranteed fallback.
- **Key abstractions:** `copyTextToClipboard(text): Promise<boolean>`.
- **Data flow:** `navigator.clipboard.writeText` (only in a secure context) → on failure or insecure
  context → an off-screen `<textarea>` + `document.execCommand("copy")` → restore the user's previous
  selection ranges.
- **Non-obvious design decisions:** **the previous selection is saved and restored** — a copy must not
  silently destroy what the user had selected (`web/src/lib/clipboard.ts:33-46`).
- **Edge cases & failure handling:** returns `false` (rather than throwing) when no mechanism exists;
  `execCommand` is wrapped in try/catch.
- **Surprising:** the fallback path is required because the dashboard is often served over plain HTTP on
  a LAN (`http://192.168.x.x:9119`), where `navigator.clipboard` is undefined.

### `web/src/lib/nested.ts`
- **Purpose:** dotted-path get/set for the config editor.
- **Key abstractions:** `getNestedValue(obj, path)`, `setNestedValue(obj, path, value)`.
- **Non-obvious design decisions:** `setNestedValue` uses `structuredClone` and returns a **new** object
  — the caller's original config is never mutated, which is what makes the config editor's
  "deep merge, never clobber" save safe (`web/src/lib/nested.ts:11-24`).
- **Edge cases & failure handling:** intermediate non-object segments are replaced with `{}` rather than
  throwing; `getNestedValue` returns `undefined` on a non-object hop.

### `web/src/lib/session-import.ts` / `session-refresh.ts` / `session-prune.ts` / `env-state.ts`
- **Purpose:** four small state reconcilers.
- **Key abstractions:** `parseImportSessions` / `importSummary`; `shouldRefreshSessions(prevNewestId,
  currentNewestId)`; `formatSessionPruneResult`; `removeDeletedEnvVarFromState`.
- **Non-obvious design decisions:**
  - **The import parser accepts three shapes** (a single session, an array, a wrapped `{sessions:[…]}`,
    or JSONL) and *rejects* a file whose entries are not all objects with a specific message
    (`web/src/lib/session-import.ts:22-27`).
  - **The Sessions page polls because there is no cross-process push channel.** The dashboard's
    FastAPI server and a terminal CLI share one SQLite DB; a new session id at the head of the
    overview poll means the paginated list is stale (`web/src/lib/session-refresh.ts:5-13`). It returns
    false on the first poll (no baseline) and whenever either id is null.
  - **Deleting a custom env key removes it from state; deleting a catalog key keeps it and marks it
    unset** (`web/src/lib/env-state.ts:4-18`).
  - **Pruning reports skipped open sessions** — "prune only removes ended sessions" — so the count is
    never silently smaller than reality.
- **Surprising:** `shouldRefreshSessions` is a two-line function with a five-case test, because the
  false-positive (refreshing on mount) is a visible UX bug.

### `web/src/lib/model-picker-filter.ts` / `plugin-update.ts` / `mcp-server-create.ts` / `memory-provider-setup.ts` / `automation-blueprints.ts` / `api-aux.ts` / `api-files.ts` / `api-plugins.ts` / `api-whatsapp.ts`
- **Purpose:** small wire-type and validation modules.
- **Key abstractions:** `queryMatchesProviderOnly`; `runDashboardPluginUpdate`; `buildMcpServerCreate` /
  `emptyMcpServerDraft`; `setupHasDetails` / `setupHasInstallableSteps`; `AutomationBlueprint` /
  `AutomationBlueprintField`; `AuxiliaryTaskAssignment`; `ManagedFileEntry`; `AgentPluginScanFinding`;
  `WhatsAppOnboardingStartResponse`.
- **Non-obvious design decisions:**
  - `buildMcpServerCreate` **throws with actionable messages** ("Name required", "URL required",
    "Bearer token required", "Command required") and **omits irrelevant transport fields entirely** — an
    HTTP server carries no `command`/`args`/`env` even if the draft has them
    (`web/src/lib/mcp-server-create.ts:47-79`).
  - `buildMcpServerCreate` parses stdio `args` on whitespace *or* commas and `env` as `KEY=VALUE` lines,
    **skipping a line with no `=`** rather than throwing.
  - The blueprint `strict` flag distinguishes "options are a closed set" from "options are suggestions,
    any value is accepted" (`web/src/lib/automation-blueprints.ts:9-12`).
  - `setupHasInstallableSteps` separates "there is a setup to describe" from "there is a setup the
    dashboard can run" — a PM member with only a declared Python dependency has details but nothing
    installable.
- **Edge cases & failure handling:** the API-type modules exist to keep `api.ts` under its
  "code-health line cap" (`web/src/lib/api-files.ts:1-3`).

### `web/src/lib/pty-close-copy.ts`
- **Purpose:** the user-facing copy for the PTY connection lifecycle — separated so the words are
  testable without xterm or a fake WebSocket.
- **Key abstractions:** `ptyRejectionBanner(code)`, `PTY_TOKEN_MISSING_BANNER`, `PTY_RECONNECTING_BANNER`,
  `PTY_GAVE_UP_BANNER`, `PTY_SESSION_ENDED_MESSAGE`, `PTY_START_FAILED_MESSAGE`,
  `PTY_SESSION_ENDED_TERMINAL_LINE`, `ptyReconnectExhausted`.
- **Non-obvious design decisions:**
  - **Close codes never appear in user text** — they are logged to the console instead
    (`web/src/lib/pty-close-copy.ts:5-8`).
  - **Each rejection code gets its own fix**, not a generic one: 4401 → reload; 4403 → the address does
    not match the server; 4404 → this server has no terminal chat, update Hermes; 4408 → the server
    only accepts chat from its own machine.
  - **The start-failure message is deliberately neutral**: close 1011 also covers "no terminal support on
    this platform" (native Windows), where retrying cannot help, so the text must not promise a fix
    (`web/src/lib/pty-close-copy.ts:50-55`).
  - **A crash and `/exit` look identical** — the overlay says "If you did not end it yourself, the agent
    may have crashed — open Logs to see why, or start a new session."
- **Surprising:** the "Reconnect" vs "Reload page" vs "check server" choice is *data*, returned as a
  `PtyBannerAction`, so the component never re-derives it.

### `web/src/lib/pty-resume-loading.ts` / `pty-scroll.ts` / `pty-focus.ts` / `pty-keyboard-shortcuts.ts` / `pty-mouse-report.ts` / `terminal-appearance.ts` / `terminal-font-refit.ts` / `terminal-touch-scroll.ts`
- **Purpose:** eight more PTY/terminal helpers, each with a narrow, testable contract.
- **Key abstractions and their decisions:**
  - `shouldShowResumeLoadingOverlay` — the wait notice shows only while a resumed chat is *blank*;
    reconnect/closed/ended states keep their own overlays and must not stack this one
    (`web/src/lib/pty-resume-loading.ts:26-42`). `shouldFinishResumeHydrationOnChunk` keys off the
    **rendered** chunk, not the raw frame: the sanitizer collapses an erase-only first frame to `""`,
    so a non-empty raw frame would clear the notice while the terminal is still blank.
  - `isViewportPinnedToBottom` / `shouldFollowPtyOutput` — during a resume replay the viewport is
    pinned to the bottom **as each chunk commits** (not on a fixed double-rAF delay), and the pin is
    released the moment the user scrolls up to read the backlog
    (`web/src/lib/pty-scroll.ts:1-30`).
  - `parseResumeControlMessage` — a one-off JSON text frame names the session the server resolved when
    there is no `?resume=` in the URL; **any other text frame** (an ANSI error banner) must keep
    rendering into the terminal (`web/src/lib/pty-scroll.ts:60-78`).
  - `shouldRestoreTerminalFocus` — the terminal may reclaim focus only when nothing else holds it
    (`document.activeElement` is null/`<body>`, or already inside the host). Clicking into the sidebar
    must not be yanked back (`web/src/lib/pty-focus.ts:1-8`).
  - `resolvePtyKeyboardShortcut` — bare `Ctrl+C` copies **only when a terminal selection exists**;
    otherwise it stays an interrupt. `Ctrl+Backspace` / `Ctrl+Delete` map to word deletion.
  - `SGR_MOUSE_RE` — xterm's SGR mouse reports are **dropped entirely** rather than forwarded to
    Hermes ("input stability over terminal-style mouse reporting").
  - `terminalTierWidthPx` / `terminalFontSizeForWidth` — the terminal's font tier is driven by the
    **host's `clientWidth`**, because Chrome DevTools device mode keeps `window.innerWidth` at the
    desktop value while the drawn layout is phone-sized (`web/src/lib/terminal-appearance.ts:30-44`).
  - `refitWhenTerminalFontLoads` — xterm measures its cell size once at `open()`; when the bundled
    JetBrains Mono swaps in later the grid keeps fallback metrics. The fix bounces `fontFamily` through
    `"monospace"` (a same-value assignment is a no-op in xterm), then refits, clears the texture atlas
    and refreshes every row (`web/src/lib/terminal-font-refit.ts:44-74`).
  - `installTerminalTouchScroll` — iPadOS WebKit does not translate a finger drag into wheel events;
    vertical touch movement is converted to `scrollLines()` at 18 px/line, and at the top/bottom
    boundary the event is left alone so the outer page can still move above the keyboard
    (`web/src/lib/terminal-touch-scroll.ts:25-46`).

### `web/src/lib/chat-sidebar-banner.ts` / `chat-title.ts` / `chat-workspaces.ts` / `chat-copy-last.ts` / `chat-copy-last-button.tsx` / `chat-image-drop.ts` / `chatImagePaste.ts` / `chat-panel-collapsed.ts` / `chat-channel-id.ts`
- **Purpose:** the chat side-rail's pure helpers.
- **Key abstractions and their decisions:**
  - `sidecarErrorMessage` / `credentialWarning` — transport jargon collapses to one sentence
    ("The chat side panel could not connect. Chat still works."), while a **real** gateway error (a bad
    profile name) is shown as-is. The credential warning is *rewritten* to name the provider and the
    fix ("Add a key under Keys, or pick a different provider").
  - `titleFromSessionInfoPayload` returns **three** states — `undefined` (no title field), `null` (the
    field is present but blank), or the trimmed string — so a title-only update does not blank the badge.
  - `workspaceOptions` — project folders first (one row per folder for a multi-folder project), then
    discovered repos by recency, deduped on path; a persisted custom path that dropped out of discovery
    still renders as the selected row.
  - `sendCopyLastCommand` — sends `/copy` over the PTY, waits **100 ms**, then sends Return as its own
    event, so Ink's tokenizer emits a keypress per character instead of coalescing them into a paste.
  - `attachChatImageDropListeners` — **plain-text pastes are cancelled and re-delivered through
    `term.paste()`**, because xterm's own paste listener clears the hidden textarea but the browser's
    default insert runs *after* event dispatch, so the stale value survives and the next typed character
    gets duplicated ("when" → "whenn") (`web/src/lib/chat-image-drop.ts:8-16`).
  - `uploadChatImage` — the browser's clipboard bytes are uploaded to `HERMES_HOME/images` because the
    container has no access to the browser clipboard, so the server-side `clipboard.paste` path can never
    see a pasted image. Size is capped at 25 MB client-side (the Anthropic vision limit) "rather than
    round-tripping a doomed upload".
  - `generateChannelId` — the id ties a chat tab's PTY child (publisher) to its sidebar (subscriber);
    the previous PTY child terminates with the old WS and its channel auto-evicts.

### `web/src/contexts/ProfileProvider.tsx` (+ `profile-context.ts`, `useProfileScope.ts`)
- **Purpose:** the machine-level management-profile scope.
- **Key abstractions:** `ProfileProvider`, `ProfileContext`, `useProfileScope`.
- **Data flow:** React state is the source of truth; the URL (`?profile=<name>`) is a *synchronized
  projection*; the selection is mirrored into the api module (`setManagementProfile`) so `fetchJSON`
  transparently appends it.
- **Non-obvious design decisions:**
  - **State-first, not URL-first.** Sidebar nav links are bare paths (`/config`, `/skills`); a
    URL-derived scope would silently reset to the dashboard's own profile on every nav click — "the
    switcher would LOOK global while normal navigation dropped the write target"
    (`web/src/contexts/ProfileProvider.tsx:29-38`).
  - **A `?profile=` that CHANGED is adopted during render, before any effect runs**, so the URL sync
    below never sees the old state next to the new URL and writes it back
    (`web/src/contexts/ProfileProvider.tsx:56-66`).
  - The scope is **re-asserted onto the URL after every navigation** that dropped it, with `replace: true`
    so the back button is not polluted.
- **Edge cases & failure handling:** the bootstrap fetch is guarded by a `cancelled` flag.
- **Surprising:** `setManagementProfile(profile)` is called **during render**, on every render where it
  changed — "so fetches fired by child effects in the same commit see it."

### `web/src/contexts/SystemActions.tsx` (+ `system-actions-context.ts`, `useSystemActions.ts`)
- **Purpose:** the "Restart gateway" / "Update Hermes" actions and their outcome reporting.
- **Key abstractions:** `SystemActionsProvider`, `SystemActionsContext`, `useSystemActions`,
  `ACTION_NAMES`.
- **Data flow:** `runAction` → POST → poll `api.getActionStatus(name)` every 1 500 ms until
  `!running` → read `exit_code` → compose the toast.
- **Non-obvious design decisions:**
  - **A committed update OWES work even on failure.** `updateDebt(receipt, updateActionId)` names the
    follow-up steps whether the run exited 0 or 1 — "a partial run exits 1 after `record_user_action`"
    — and the toast says "Updated, but still owed (re-run `hermes update` to finish)"
    (`web/src/contexts/SystemActions.tsx:56-73`).
  - **Only THIS action's receipt may name owed work.** The status route attaches the latest receipt
    otherwise, which would blame an unrelated run (`web/src/contexts/SystemActions.tsx:28-31`, pinned by
    `web/src/contexts/SystemActions.test.tsx`).
  - **A restart of the shared multiplexer names the count of bots reconnected.**
  - **The update endpoint may refuse** (`{ok:false, message, update_command}`) instead of spawning the
    action; that guidance is surfaced directly, not polled as a synthetic failure.
- **Edge cases & failure handling:** transient fetch errors during polling are swallowed and the poll
  continues; the toast auto-dismisses after 4 s.

### `web/src/contexts/PageHeaderProvider.tsx` (+ `page-header-context.ts`, `usePageHeader.ts`)
- **Purpose:** one page header every page can decorate.
- **Key abstractions:** `PageHeaderProvider` (slots: `setTitle`, `setAfterTitle`, `setEnd`),
  `usePageHeader`.
- **Non-obvious design decisions:** the per-page slots are **cleared on every path change** in a
  `useLayoutEffect` (so a page that navigates away does not leave a stale toolbar), and the provider
  owns the title/after-title/end layout — including the rule that the **Env route stacks the jump-nav
  below the title on small screens** so "KEYS" stays readable.
- **Edge cases & failure handling:** `usePageHeader` throws if used outside the provider (a loud
  failure beats a silent no-op).

### `web/src/hooks/useModalBehavior.ts` / `useSidebarStatus.ts`
- **Purpose:** shared modal behaviour and the shell's status poll.
- **Key abstractions:** `useModalBehavior({open, onClose})` → a container ref; `useSidebarStatus()`.
- **Non-obvious design decisions:** `useModalBehavior` handles Escape, body scroll lock and **focus
  restoration to the previously focused element** on close; it returns a container ref "for optional
  future focus trapping" — the trap itself is not implemented here
  (`web/src/hooks/useModalBehavior.ts:1-11`). `useSidebarStatus` polls every **10 s** while the Status
  page uses its own faster interval, "to avoid duplicate load".
- **Edge cases & failure handling:** the previous `body.style.overflow` is captured and restored.

### `web/src/components/ChatSidebar.tsx` (691 lines) + `ChatSessionList.tsx`
- **Purpose:** the two panels beside the embedded terminal.
- **Key abstractions (ChatSidebar):** `sidecarSessionCreateParams(profile)`, `sessionInfoModel`,
  `STATE_LABEL` / `STATE_TONE`, `SIDE_CAR_MAX_RECONNECT_ATTEMPTS` (5), `HEALTHY_OPEN_GRACE_MS` (10 000).
- **Data flow:** two WebSockets, one per concern — a **JSON-RPC sidecar** (`GatewayClient` → `/api/ws`,
  used only for connection state and credential warnings) and an **event subscriber**
  (`/api/events?channel=…`, used for `session.info` and `dashboard.new_session_requested`).
- **Non-obvious design decisions:**
  - **The badge shows the model that is actually answering, not the configured one.** The PTY chat
    session's `session.info` reports the runtime identity, which changes when a provider fallback
    replaces the configured primary mid-turn (#54509). Config remains the fallback until the PTY has
    broadcast a runtime identity (`web/src/components/ChatSidebar.tsx:153-176`).
  - **The sidecar's `session.info` model is deliberately NOT used** — it is a one-time snapshot of a
    throwaway sidecar agent and never updates.
  - **A socket that opens and dies within 10 s is a flap, not a recovery** — only a connection that
    stays open past the grace period refills the reconnect budget. Otherwise an open→immediate-close
    cycle resets the budget forever and the ladder never exhausts (#129393).
  - **The redial counter lives in a ref, not effect state** — each redial rebuilds the client and
    re-runs the effect, so a closure-local counter would reset every attempt.
  - **The shared banner has ownership rules.** The events feed may only write over an empty banner or
    one of its own messages, and may only clear its own
    (`web/src/components/ChatSidebar.tsx:400-404`).
  - **The sidecar session opts into `close_on_disconnect`** so the gateway reaps its `slash_worker`
    subprocess instead of leaking it.
  - **The model picker writes config over REST (`/api/model/set`), not the sidecar `config.set` RPC**,
    which "didn't reliably land in the config.yaml the agent boots from" — and then offers a dashboard
    reload so the running chat adopts it.
  - **"Add key" is a router navigation, not a page load** — a full page load would tear down the
    xterm scrollback and the chat sockets.
- **ChatSessionList** decisions: it is a **navigation surface, not a session-management one** (delete /
  rename / export live on the Sessions page) to avoid duplicating that machinery; picking a row sets
  `/chat?resume=<id>` and re-picking the active row is a no-op; a **monotonic request token** ensures
  only the most recent fetch commits state, so a fast profile switch cannot land a stale list; the
  list polls every 20 s and refreshes on `visibilitychange`.
- **Edge cases & failure handling:** both are best-effort — a failed fetch surfaces a small inline error
  with a Retry affordance and the terminal pane keeps working.

### `web/src/components/MemoryPressureBanner.tsx` (186 lines) + its test
- **Purpose:** the app-wide resource-pressure banner.
- **Key abstractions:** `MEMORY_LIVE_TRIGGERS`, `DISK_LIVE_TRIGGERS`, `readDismissed` /
  `writeDismissed` (sessionStorage), `keyFor(trigger)`.
- **Data flow:** `StatusResponse.memory` / `.disk` → the trigger list (worst-first) → the first trigger
  that has not been dismissed → a banner with a Dismiss button.
- **Non-obvious design decisions — the dismissal semantics are the whole feature**
  (`web/src/components/MemoryPressureBanner.tsx:25-37`):
  - **Every dismissal key embeds the reporting `boot_id`**, so a gateway restart invalidates all of
    them. Without this, dismissing `critical`, rebooting and coming back still-critical would hide the
    NEW incident — and mask the OOM notice too, since critical takes precedence.
  - **Within one boot, dismissal masks only the dismissed trigger**; escalation (elevated → critical,
    in either domain) re-opens immediately.
  - **A confirmed recovery** (pressure back to `ok`, *not* `unknown`) clears that domain's live
    dismissals so the next episode surfaces again. `unknown` (a stale/absent sample) is absence of
    evidence, not recovery, and clears nothing.
  - **Each domain recovers independently** — a fixed disk must not un-dismiss a memory warning.
  - **The recovery reset is a render-time state adjustment**, the sanctioned React pattern for
    reacting to prop changes without an effect.
- **Edge cases & failure handling:** a missing `boot_id` (degraded payload / pre-NS-656 image) degrades
  to a shared per-severity bucket — old behaviour, never a crash. The stored list is parsed defensively
  (a pre-incident build stored a bare trigger string; `JSON.parse` throws → a clean reset).
- **Surprising:** **disk critical outranks memory critical** — "imminent data loss beats imminent
  restart" — and dismissing the top trigger *cascades* to the next one rather than silencing everything.

### `web/src/components/ModelPickerDialog.tsx` (23 KB)
- **Purpose:** the two-stage provider → model picker, shared by the chat sidebar and the Models page.
- **Key abstractions:** `NO_PROVIDERS_MESSAGE`, `ProviderColumn`, `ModelColumn`, `HighlightedText`
  (fuzzy-match position highlighting).
- **Data flow:** `loader()` or `gw.request("model.options")` → providers with models → fuzzy-ranked
  provider and model lists → `onApply(provider, model, persistGlobal)` or `gw.request("config.set", …)`.
- **Non-obvious design decisions:**
  - **Two invocation modes** — chat-session (JSON-RPC) and standalone (REST loader + `onApply`) — so the
    Models page reuses the same UI without needing an open chat PTY.
  - **With no query, providers that actually have models float to the top.** A fresh install lists ~40
    providers and only a couple are configured; burying "OpenRouter · 37 models" under a wall of
    "0 models" rows made the picker feel broken (`web/src/components/ModelPickerDialog.tsx:213-224`).
  - **The expensive-model confirmation is a second dialog**, not a checkbox, and it is driven by the
    backend's `confirm_required` response.
  - **The dialog is portalled to `document.body`** because the dashboard column is `relative z-2`, which
    creates a stacking context that traps `fixed` descendants below the app sidebar.
  - **`include_unconfigured: true`** — the picker mirrors the TUI's full provider universe with setup
    warnings.
  - **A provider with a *setup warning* shows it in the model column**, not the provider column.
- **Edge cases & failure handling:** `closedRef` guards against setState after the dialog closes; a
  double-click on a model applies it immediately.

### `web/src/components/ConfirmDialog.tsx` / `DeleteConfirmDialog.tsx` / `useModalBehavior.ts`
- **Purpose:** the ONE confirmation dialog.
- **Key abstractions:** `ConfirmDialog` (`destructive` tone, `loading`, `data-confirm` focus target),
  `DeleteConfirmDialog` (a thin i18n wrapper).
- **Non-obvious design decisions:** the confirm button is **focused on open** via `[data-confirm]`, and
  the previously focused element is **restored on close**; the backdrop click cancels; Escape cancels
  with `preventDefault`; body scroll is locked while open. The dialog is portalled to `document.body`.
- **Edge cases & failure handling:** `loading` disables both buttons and swaps the label to "…".
- **Surprising:** a separate DS `ConfirmDialog` also exists and is used by some pages — two dialog
  implementations for one job.

### `web/src/components/Markdown.tsx` (383 lines) + `StructuredReasoning.tsx`
- **Purpose:** a lightweight markdown renderer for LLM output.
- **Key abstractions:** `parseBlocks` → `BlockNode` (`code|heading|hr|list|paragraph`), `parseInline` →
  `InlineNode` (`text|code|bold|italic|link|br`), `HighlightedText`, `StreamingCaret`.
- **Non-obvious design decisions:**
  - **It is deliberately NOT a full CommonMark parser** — "optimized for typical assistant message
    patterns" (`web/src/components/Markdown.tsx:6`).
  - **The streaming caret hugs the final character** instead of wrapping onto a new line after a block
    element — the caret is attached to the *last block*, and for a list to its *last item*.
  - **Only `http(s):` and `mailto:` links are rendered.** Other schemes (`javascript:`, `data:`,
    `vbscript:`) are downgraded to plain text "so a crafted link in agent/message content can't execute
    on click" (`web/src/components/Markdown.tsx:327-335`).
  - **Search-term highlighting uses a regex with escaped terms**, and `HighlightedText` splits the text
    on the capture group so the matched parts can be wrapped.
- **Edge cases & failure handling:** an unmatched link is text, not a broken anchor; a URL is
  auto-linked; a newline inside a paragraph becomes `<br>`.

### `web/src/components/OAuthLoginModal.tsx` (428 lines) + `OAuthProvidersCard.tsx` + `OAuthLoginModal.test.tsx`
- **Purpose:** the provider sign-in flow (device-code and PKCE).
- **Key abstractions:** `Phase` (`idle|starting|awaiting_user|submitting|polling|approved|error`),
  `OAuthProvidersCard` (`formatExpiresAt`, `connectedCount`).
- **Data flow:** `startOAuthLogin(provider.id)` → `flow === "device_code"` → poll `pollOAuthSession`
  every 2 s → `approved` → toast + auto-close after 1.5 s; `flow === "pkce"` → the user pastes the code
  → `submitOAuthCode`.
- **Non-obvious design decisions:**
  - **On local expiry the modal asks the backend once before declaring failure.** The backend poller
    usually has the real story ("Portal sign-in is required before the device code can be approved"),
    but its next tick is up to 2 s away; a bare "expired" would be a dead end
    (`web/src/components/OAuthLoginModal.tsx:73-100`).
  - **If the backend still says `pending`, the modal keeps polling** — the local countdown may have
    fired early (clock skew or a stalled tab) and killing the session with a wrong "expired" is worse
    than waiting.
  - **The fallback message names the common cause** (the sign-in stalled in the opened tab) rather than
    "expired".
  - **Retry starts a fresh session** rather than reusing the expired one, with a fresh countdown.
  - **A device code has a visible countdown**, and the "waiting for auth" state shows a spinner.
- **Edge cases & failure handling:** `isMounted` guards every async continuation; `cancelOAuthSession`
  is called on close unless the flow already finished; the copy button has a 2 s "copied" reset.

### `web/src/components/AuthWidget.tsx` + `auth-widget-visibility.ts`
- **Purpose:** the sidebar "Logged in as …" affordance.
- **Key abstractions:** `shouldHideAuthWidget(identity)`, `truncateUserId(id)`.
- **Non-obvious design decisions:**
  - **Renders nothing in loopback mode** — a 401 from `/api/auth/me` means the gate is not engaged.
  - **The user id is truncated to 14 chars + ellipsis** — "enough to disambiguate users in a small org
    and short enough to fit a single sidebar row", and it deliberately does not reveal the full opaque
    identifier (`web/src/components/AuthWidget.tsx:37-42`).
  - **The label falls through `display_name` → `email` → truncated `user_id`**, because the Nous Portal
    contract V1 only populates `user_id`.
  - **The loading state reserves the row height** so the sidebar does not flicker.
- **Edge cases & failure handling:** a network error shows a minimal "auth status unavailable" line so
  the user knows the widget tried.

### `web/src/components/ChatWorkspacePicker.tsx`, `ScheduleBuilder.tsx`, `AutomationBlueprints.tsx`, `AutoField.tsx`, `AllowlistInput.tsx`, `SkillEditorDialog.tsx`, `ToolsetConfigDrawer.tsx`, `ReasoningPicker.tsx`, `ModelInfoCard.tsx`, `ModelReloadConfirm.tsx`, `LoadErrorNotice.tsx`, `MultiplexStandaloneBanner.tsx`, `ProfileScopeBanner.tsx`, `ProfileSwitcher.tsx`, `SharedMetricsConsentBanner.tsx`, `SidebarFooter.tsx`, `SidebarStatusStrip.tsx`, `PlatformsCard.tsx`, `HermesConsoleModal.tsx`, `LanguageSwitcher.tsx`, `ThemeSwitcher.tsx`
- **Purpose:** the remaining shared components. The decisions worth stealing:
  - **`LoadErrorNotice` exists because a toast is the wrong tool**: "a toast vanishes after 3s and
    cannot carry a retry action, so the user was left with an empty page and no next step"
    (`web/src/components/LoadErrorNotice.tsx:12-18`). A page-load failure gets a **persistent card with
    a Retry button**.
  - **`SharedMetricsConsentBanner` gives two equal answers** ("Share with Nous" / "No thanks") and the
    answer is written to the profile's config so every surface stops asking; a re-ask is the exception
    whose X *keeps* the recorded "No thanks" so nobody is asked a third time.
  - **`MultiplexStandaloneBanner` keys its dismissal on the reason text**, so a different blocker
    re-surfaces; it is session-scoped.
  - **`ProfileScopeBanner` is an app-wide amber strip** shown whenever the switcher targets a profile
    other than the dashboard's own — "every management write … and new Chat sessions land in that
    profile".
  - **`ModelReloadConfirm` explains the cost before asking**: switching models starts a fresh chat, the
    current one stays resumable, and the agent's memory is kept. A full reload is used because
    "the in-place hot-swap and partial remount both proved unreliable".
  - **`ReasoningPicker` writes a SPARSE patch**: "PUT /api/config deep-merges onto disk, so sending only
    the edited key never clobbers sibling keys — and never echoes a default-expanded snapshot back over
    values another surface changed meanwhile" (`web/src/components/ReasoningPicker.tsx:74-82`). It
    reverts the optimistic UI on failure.
  - **`SkillEditorDialog` remounts its body via `key`** so all form state initialises through `useState`
    initialisers — no reset-on-open effect.
  - **`ToolsetConfigDrawer` polls a post-setup install's log** through a *trigger counter* rather than a
    ref, so the recursive timer lives inside the effect and the lint stays clean; a lost log tail says
    "Lost track of the post-setup process".
  - **`AutoField` renders a config field from a backend-supplied schema** (`boolean|select|number|text|
    list`), recursing into nested objects and arrays, with a `FieldHint` that shows the dotted key path
    and the description.
  - **`AllowlistInput` splits a pasted `"123, 456"` into one box per entry** and reports one
    comma-separated value; the last row cannot be removed (the list always has a row).
  - **`ChatWorkspacePicker` renders a persisted custom path** that dropped out of discovery as the
    selected row "instead of snapping back to the default".
  - **`LanguageSwitcher` uses endonyms, not flags** — "languages aren't countries, and flag pairings
    inevitably create political mismappings". It uses a bottom sheet below the `sm` breakpoint.
  - **`ThemeSwitcher` shows a three-stop swatch per theme** so the palette can be previewed before
    committing, and offers an independent font override.
  - **`HermesConsoleModal` is a full xterm terminal over `/api/console`** with a JSON frame protocol
    (`ready|output|error|confirm_required|complete|clear|pong`), command history (up/down), `^C` cancel,
    `^L` clear, and a `confirm_required` prompt answered with `y`/`yes`.
  - **`SidebarStatusStrip` distinguishes "alive but the heartbeat went stale" from "Running"** — "'Running'
    would be the lie the reporter saw" (`web/src/components/SidebarStatusStrip.tsx:63-67`).

### `web/src/plugins/registry.ts` + `slots.ts` + `usePlugins.ts` + `PluginPage.tsx` + `types.ts` + `sdk.d.ts`
- **Purpose:** the dashboard's plugin system — a third-party surface with its own security and lifecycle
  rules.
- **Key abstractions:** `exposePluginSDK`, `SDK_CONTRACT_VERSION` ("1.1.0"), `selectPluginProfile`,
  `registerPlugin`, `getPluginLoadError`, `onPluginRegistered`; `KNOWN_SLOT_NAMES` (30 slots: 10
  shell-wide + 20 page-scoped), `registerSlot`, `PluginSlot`, `clearPluginSlots`;
  `usePlugins`, `canSeedLoadedFromCache`, `pluginAssetUrl`; `PluginManifest` (with `integrity` for SRI).
- **Data flow:** `GET /api/dashboard/plugins?profile=…` → manifests → CSS `<link>` + `<script>` injection
  with `data-hermes-profile` → the bundle calls `window.__HERMES_PLUGINS__.register(name, Component)` →
  `PluginPage` renders it via `useSyncExternalStore`.
- **Non-obvious design decisions:**
  - **The plugin registry is bound to ONE profile.** Switching profiles clears every component, load
    error and slot the previous profile's bundles registered, and a bundle that finishes loading after
    the switch registers nothing (`_fromOtherProfile()` reads `document.currentScript`'s
    `data-hermes-profile` attribute, `web/src/plugins/registry.ts:44-50`).
  - **The SDK is a versioned API boundary, hand-authored rather than derived** from the runtime object —
    "changing it is a deliberate act, visible in review, not an accidental consequence of refactoring an
    internal helper" (`web/src/plugins/sdk.d.ts:24-27`).
  - **The SDK deliberately withholds the session token from plugins** — it exposes `fetchJSON`,
    `authedFetch`, `buildWsUrl` and `buildWsAuthParam` instead, so a plugin never reads
    `window.__HERMES_SESSION_TOKEN__` directly.
  - **Subresource Integrity is opt-in** via the manifest's `integrity` field; without it behaviour is
    unchanged, with it the browser refuses to execute a tampered bundle.
  - **`canSeedLoadedFromCache` refuses to seed `loading = false` when a cached manifest overrides
    `/chat`** — the gate in `App.tsx` is load-bearing and the cache must not defeat it.
  - **A 2 s timeout ends the loading state** even if a bundle never registers; a bundle that loads but
    does not call `register()` is reported as `NO_REGISTER` with actionable copy.
- **Edge cases & failure handling:** `PluginPage` subscribes **during render** via
  `useSyncExternalStore` so a `register()` that happens before an effect would run is never missed.

### `web/src/themes/presets.ts` + `types.ts` + `fonts.ts` + `context.tsx` (partial)
- **Purpose:** the theming system.
- **Key abstractions:** `BUILTIN_THEMES` (8 themes), `webPresetFromShared`, `DashboardTheme` (palette /
  typography / layout / assets / componentStyles / colorOverrides / seriesColors), `FONT_CHOICES` (14
  curated fonts), `THEME_DEFAULT_FONT_ID`.
- **Non-obvious design decisions:**
  - **Themes are three orthogonal layers** — palette (background/midground/foreground), typography
    (families, base size, line height, tracking) and layout (radius, density) — so switching changes
    more than colour.
  - **The preset palettes are SHARED with the desktop** (`THEME_PRESET_PALETTES` from `@hermes/shared`),
    and a test asserts the dashboard's canvas equals the shared background *and* that the accent has
    ≥3:1 contrast against it, "so a future re-mapping cannot silently ship grey-on-grey"
    (`web/src/themes/presets.test.ts`).
  - **The font override is a curated catalogue, not a free-text font name + URL box** — the `fontUrl` is
    injected as a `<link>`, so accepting an arbitrary user-supplied URL would be a self-XSS /
    SSRF-ish footgun. The backend mirrors the allow-list.
  - **Density is a spacing multiplier** (`--theme-spacing-mul`: 0.85 / 1 / 1.2) applied via
    `calc(0.25rem * var(--theme-spacing-mul))`, so every shadcn spacing utility scales at once.
  - **Theme names have an alias table** (`lens-5i` → `nous-blue`) so a persisted old key does not
    silently fall back to the default.
  - **The theme is pre-applied from localStorage before React mounts** to avoid a flash of the default
    palette.
- **Edge cases & failure handling:** the same URL is never injected twice (a `Set` of injected font
  URLs); switching to a theme with fewer overrides clears the leftovers.

### `web/src/i18n/types.ts` (926 lines) + `context.tsx` + `define-locale.ts` + `index.ts` + `en.ts` (partial)
- **Purpose:** 17 locales with a fully typed translation contract.
- **Key abstractions:** `Locale` (17 values), `Translations` (a deep interface with **optional** keys for
  late additions), `I18nProvider`, `useI18n`, `LOCALE_META`, `defineLocale`, `TranslationOverrides`.
- **Non-obvious design decisions:**
  - **Optional keys are the fallback mechanism.** New strings are added as optional members with the
    comment "English fallback until translated", so 16 locale files are not churned for every new
    feature — and a missing translation degrades to the English literal *at the call site*, not to a
    blank (`web/src/i18n/types.ts:20-21, 113-131`).
  - **`defineLocale` merges partial overrides onto `en`** so a locale may ship only what it has
    translated, while *unknown* keys still fail the type-check
    (`web/src/i18n/define-locale.ts:5-11`).
  - **The `Translations` interface is the single source of the string inventory**; the components read
    `t.*` and never hard-code copy (with a handful of deliberate exceptions where a fallback literal
    is written inline, e.g. `t.app.diskCriticalBanner ?? "…"`).
  - **Locale metadata comes from `@hermes/shared`** so the desktop and web pickers can never disagree on
    a language's native name.
  - **The locale is persisted to localStorage** and `applyDocumentLocale` sets `<html dir>` for RTL
    (Arabic) — the CSS uses logical properties so the layout flips.
- **Edge cases & failure handling:** an unknown stored locale falls back to `en`; localStorage failure
  (privacy mode) is caught.

### `web/src/index.css` + `web/src/main.tsx` + `web/vite.config.ts` + `web/vitest.config.ts` + `web/eslint.config.js` + `web/index.html` + `web/package.json` + `web/tsconfig*.json`
- **Purpose:** the build, the theme tokens, the provider composition.
- **Key decisions:**
  - **The React Compiler preset is scoped to modules that can contain components** — the default filter
    matches any PascalCase/`use*` declaration, "effectively every TS module — which made the babel pass
    parse the whole codebase" (`web/vite.config.ts:5-14`).
  - **The dev server forwards the backend's session token.** The Python dashboard injects a one-shot
    token into `index.html`; the Vite dev server serves its own `index.html`, so without the
    `hermesDevToken` plugin every protected `/api/*` call 401s. The plugin fetches the running
    dashboard's HTML on each page load and re-injects the token, the embedded-chat flag and the initial
    profile (`web/vite.config.ts:20-79`).
  - **Vendor chunks are split by group** (react, xterm, three, plot, motion, ui, vendor) so the first
    paint does not download xterm/three/plot until a route needs them.
  - **`resolve.dedupe` forces the dashboard's copy of react, react-dom, three, plot, leva, gsap** —
    two copies would break hooks and WebGL contexts.
  - **The vitest config pins `NODE_ENV=development`** — React 19 ships `act` only in its development
    build, and a shell that already exports `NODE_ENV=production` makes every `createRoot` test fail
    with "act is not a function" (`web/vitest.config.ts:34-48`).
  - **The test timeout is 15 s** because the SessionsPage suite legitimately runs 3.5–4.5 s on green CI
    runners — "right against vitest's 5s default, so a loaded runner tips them into a timeout".
  - **The eslint config downgrades four react-hooks v7 rules to `warn`** with a TODO naming the three
    patterns that must be refactored first (`web/eslint.config.js:16-25`).
  - **`index.css` documents an import ORDER dependency**: `fonts.css` must come BEFORE `globals.css`,
    or the DS font variables resolve to families the browser never loads and every component looks
    unstyled (`web/src/index.css:1-10`).
  - **The shadcn-compat token block exists because the page code predates the design system** — rather
    than rewrite every call site, `text-muted-foreground` is routed to `--color-text-secondary`.
  - **`@theme inline` multiplies `--spacing` by the density factor** so every `p-N`/`gap-N` scales.

---

### Tier 2 — bulk: a compact table, one row per file

Every file in the shard appears exactly once below (or in a Tier-1 entry above). "partial" means the
file was opened and analysed in part (head + tail + structural sweep) rather than line by line; the
status ledger carries the exact extent.

#### `web/` root, config and build

| File | What it is / what it pins |
| --- | --- |
| `web/AGENTS.md` | Rules for `web/` + `hermes_cli/web_routers/`: the dashboard EMBEDS the real `hermes --tui`; React may add complementary panels only; `dashboard` and `serve` are independent surfaces; one session-token scheme for every REST/WS route; one router file per surface. (Tier-1 entry above.) |
| `web/README.md` | Stack (Vite + React 19 + TS + Tailwind v4 + hand-rolled shadcn-style components), dev/build workflow, the `web_dist` output path, and a long **typography & contrast contract**: `text-xs` (12px) minimum body size, opacity never below 0.7 and never stacked, uppercase only via `text-display` (not the raw Tailwind class), semantic colour tokens over layer references, and a per-surface font tier table. |
| `web/eslint.config.js` | Flat ESLint config; `react-refresh/only-export-components` allows constant exports; four react-hooks v7 rules pinned at `warn` with a TODO naming the three patterns to refactor first. |
| `web/index.html` | Minimal SPA shell; `viewport-fit=cover` + `interactive-widget=resizes-content` (the mobile-keyboard lever `keyboard-inset.ts` complements). |
| `web/package.json` | Dependencies (React 19.2, react-router 8.3, Vite 8.2, Tailwind 4.3, xterm 6.0 + 4 addons, `@nous-research/ui` 0.18.2, @observablehq/plot, three, qrcode, motion, gsap); scripts `build` → `node ../scripts/build/web.mjs`, `test` → `vitest run`, `check` → typecheck + test + lint. |
| `web/public/favicon.ico` | Binary ICO (4 808 bytes, magic `00 00 01 00`). Tier 3. |
| `web/public/fonts-terminal/JetBrainsMono-Bold.woff2` | Self-hosted JetBrains Mono Bold for the embedded terminal; registered via `@font-face` in `index.css` with `font-display: swap`. `terminal-font-refit.ts` waits for it and forces xterm to re-measure. Tier 3. |
| `web/public/fonts-terminal/JetBrainsMono-Italic.woff2` | The italic face of the same stack (binary WOFF2, 96 428 B). Tier 3. |
| `web/public/fonts-terminal/JetBrainsMono-Regular.woff2` | The regular face of the same stack (binary WOFF2, 92 380 B). Tier 3. |
| `web/public/fonts/Collapse-Bold.woff2` | The design system's "Collapse" display face, shipped locally so the dashboard never depends on a CDN (binary WOFF2, 59 144 B). Tier 3. |
| `web/public/fonts/Collapse-Regular.woff2` | The regular weight of the "Collapse" face (binary WOFF2, 62 816 B). Tier 3. |
| `web/public/fonts/Mondwest-Regular.woff2` | The Mondwest display face used by the brand chrome (`font-mondwest text-display`); the only display face the dashboard ships (binary WOFF2, 23 828 B). Tier 3. |
| `web/public/fonts/RulesCompressed-Medium.woff2` | The "Rules Compressed" display face, medium weight (binary WOFF2, 38 848 B). Tier 3. |
| `web/public/fonts/RulesCompressed-Regular.woff2` | The "Rules Compressed" display face, regular weight (binary WOFF2, 37 764 B). Tier 3. |
| `web/public/fonts/RulesExpanded-Bold.woff2` | The "Rules Expanded" display face, bold weight (binary WOFF2, 35 012 B). Tier 3. |
| `web/public/fonts/RulesExpanded-Regular.woff2` | The "Rules Expanded" display face, regular weight (binary WOFF2, 33 820 B). Tier 3. |
| `web/src/index.css` | Theme tokens: the LENS_0 Hermes-teal default, typography/layout tokens, the shadcn-compat `@theme inline` block, density as a `--spacing` multiplier, RTL support, and three keyframe/utility sets (sidebar tooltip, toasts, dialog). (Tier-1 decisions above.) |
| `web/src/main.tsx` | Provider order `BrowserRouter → I18nProvider → ThemeProvider → SystemActionsProvider → ProfileProvider → App`; `exposePluginSDK()` runs BEFORE render so a plugin loaded via `<script>` can use React immediately; `ProfileProvider` is above `App` so its plugin loader follows the selected profile. |
| `web/tsconfig.json` | Project references only (`tsconfig.app.json`, `tsconfig.node.json`). |
| `web/tsconfig.app.json` | `strict`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUncheckedSideEffectImports`, and the `@/*`, `@hermes/shared*` path aliases. Includes `src` and `../apps/shared/src`. |
| `web/tsconfig.node.json` | The Vite-config-only project; same strictness, `types: ["node"]`. |
| `web/vite.config.ts` | React + React Compiler (scoped filter) + Tailwind; the `hermesDevToken` plugin that forwards the backend's session token into the dev HTML; `resolve.dedupe` for react/three/plot/leva/gsap; `build.outDir = ../hermes_cli/web_dist`; rolldown vendor code-splitting groups; a dev proxy for `/api` (with `ws: true`) and `/dashboard-plugins`. |
| `web/vitest.config.ts` | `environment: "node"` by default (per-file `// @vitest-environment jsdom` opt-in), `include: src/**/*.test.{ts,tsx}`, `testTimeout: 15_000`, and `env.NODE_ENV = "development"`. |

#### `web/src/contexts/` and `web/src/hooks/`

| File | What it is / what it pins |
| --- | --- |
| `web/src/contexts/PageHeaderProvider.tsx` | The one page header; title/afterTitle/end slots cleared on path change; mobile stacks the title and toolbar. |
| `web/src/contexts/PageHeaderProvider` (test) | n/a — see `ProfileProvider.test.tsx` and `SystemActions.test.tsx` below. |
| `web/src/contexts/ProfileProvider.test.tsx` | Pins the URL↔scope sync: a link that changes path AND `?profile=` adopts the new scope; a bare nav link KEEPS `?profile=`; the switcher rewrites the URL. |
| `web/src/contexts/ProfileProvider.tsx` | The machine-level write-target scope; state-first, URL as a synchronized projection. (Tier-1 entry above.) |
| `web/src/contexts/SystemActions.test.tsx` | Pins the update toast: a partial run (exit 1) names the owed user action **verbatim**, and a receipt belonging to another run is never named. |
| `web/src/contexts/SystemActions.tsx` | Restart / update actions, poll-to-completion, and the "still owed" receipt semantics. (Tier-1 entry above.) |
| `web/src/contexts/page-header-context.ts` | The context object + `PageHeaderContextValue` (three setters). |
| `web/src/contexts/profile-context.ts` | The context object + `ProfileContextValue` (`profile`, `currentProfile`, `profiles`, `setProfile`). |
| `web/src/contexts/system-actions-context.ts` | The context object + `SystemAction` union (`"restart" | "update"`). |
| `web/src/contexts/usePageHeader.ts` | The hook; **throws** outside its provider. |
| `web/src/contexts/useProfileScope.ts` | The hook; returns the context's default value (never throws). |
| `web/src/contexts/useSystemActions.ts` | The hook; **throws** outside its provider. |
| `web/src/hooks/useModalBehavior.ts` | Escape-to-close, body scroll lock, focus restoration, container ref for a future focus trap. |
| `web/src/hooks/useSidebarStatus.ts` | The shell's 10 s status poll (the Status page has its own faster interval). |

#### `web/src/i18n/`

| File | What it is / what it pins |
| --- | --- |
| `web/src/i18n/index.ts` | The barrel: `I18nProvider`, `useI18n`, `LOCALE_META`, and the `Locale` / `Translations` types. |
| `web/src/i18n/define-locale.ts` | `defineLocale(overrides)` — merges a partial locale onto `en` via `@hermes/shared`'s `mergeTranslations`; unknown keys still fail the type-check. |
| `web/src/i18n/context.tsx` | The 17-locale map, `LOCALE_META` (endonyms from `@hermes/shared`), localStorage persistence with a validity check, and `applyDocumentLocale` (sets `<html dir>` for RTL). |
| `web/src/i18n/types.ts` | The 926-line typed translation contract; optional keys = the English-fallback mechanism. (Tier-1 entry above.) |
| `web/src/i18n/en.ts` | The canonical 937-line dictionary (partially read: lines 1-190; the remainder is the same key set as `types.ts`). |
| `web/src/i18n/af.ts` | Afrikaans dictionary (~787 lines) — a full `Translations` object; head/tail sampled, shape confirmed against `en.ts`. |
| `web/src/i18n/ar.ts` | Arabic dictionary (~716 lines) — the only locale built with `defineLocale({…})`, i.e. a PARTIAL locale that falls back to English for everything it does not translate. Also the RTL locale (`<html dir>` is set by `applyDocumentLocale`). |
| `web/src/i18n/de.ts` | German dictionary (~786 lines) — full `Translations`. |
| `web/src/i18n/es.ts` | Spanish dictionary (~787 lines) — full `Translations`. |
| `web/src/i18n/fr.ts` | French dictionary (~787 lines) — full `Translations`. |
| `web/src/i18n/ga.ts` | Irish dictionary (~795 lines) — full `Translations`. |
| `web/src/i18n/hu.ts` | Hungarian dictionary (~787 lines) — full `Translations`. |
| `web/src/i18n/it.ts` | Italian dictionary (~786 lines) — full `Translations`. |
| `web/src/i18n/ja.ts` | Japanese dictionary (~786 lines) — full `Translations`. |
| `web/src/i18n/ko.ts` | Korean dictionary (~786 lines) — full `Translations`. |
| `web/src/i18n/pt.ts` | Portuguese dictionary (~788 lines) — full `Translations`. |
| `web/src/i18n/ru.ts` | Russian dictionary (~787 lines) — full `Translations`. |
| `web/src/i18n/tr.ts` | Turkish dictionary (~787 lines) — full `Translations`. |
| `web/src/i18n/uk.ts` | Ukrainian dictionary (~788 lines) — full `Translations`. |
| `web/src/i18n/zh-hant.ts` | Traditional Chinese dictionary (~786 lines) — full `Translations`; `LOCALE_META` keeps "zh" and "zh-hant" as separate locales. |
| `web/src/i18n/zh.ts` | Simplified Chinese dictionary (~782 lines) — full `Translations`. |

#### `web/src/lib/` (112 files)

| File | What it is / what it pins |
| --- | --- |
| `web/src/lib/api.ts` | The typed REST facade (171 methods). Read the transport/policy core (lines 1-330: `withManagementProfile`, `fetchJSON`, `authedFetch`, ticket minting) and extracted the full endpoint inventory; the per-endpoint wrapper bodies were not read line by line. |
| `web/src/lib/api-aux.ts` | Wire types for `GET /api/model/auxiliary` — `AuxiliaryTaskAssignment` (with `inherit_from` / `effective` for plugin tasks) and `AuxiliaryModelsResponse`. |
| `web/src/lib/api-error.test.ts` | Pins the error contract: an `ApiError` message is the JSON `detail` (never the status or body), a structured `detail.message` beats the generic status sentence, a detail-less status maps to a plain sentence, a network failure becomes the "is hermes dashboard running" sentence with `status: 0`, and `extractDetail` joins FastAPI validation arrays while ignoring HTML. |
| `web/src/lib/api-error.ts` | The error taxonomy. (Tier-1 entry above.) |
| `web/src/lib/api-files.ts` | Wire types for the managed-files API (`ManagedFileEntry`, `ManagedFilesResponse`, `ManagedFileReadResponse`, `ManagedFileWriteResponse`) — split out to keep `api.ts` under its line cap. |
| `web/src/lib/api-plugins.ts` | `AgentPluginScanFinding` + `AgentPluginUpdateResponse` — the security-scan verdict and the consent-required envelope. |
| `web/src/lib/api-whatsapp.ts` | The WhatsApp onboarding wire types (status union `starting|installing|waiting|connected|error|expired|cancelled`, plus the apply response with `needs_restart`). |
| `web/src/lib/api.test.ts` | Pins: the one-shot reload path for loopback 401s, the latch clearing after a 2xx, `getModelOptions` keeping an explicit profile while refreshing, the `PROFILE_SCOPED_PREFIXES` allow-list (5 concrete families) leaving other families alone, the serving-profile fallback, `authedFetch` scope resolution, plugin routes being profile-scoped, plugin WS URLs naming the profile while `/api/events` does not, and the gated-mode OAuth contract (cookie auth, no session header). |
| `web/src/lib/automation-blueprints.ts` | The blueprint catalogue wire types; `strict` distinguishes a closed option set from suggestions. |
| `web/src/lib/aux-tasks.test.ts` | Pins: built-ins only against an older backend; plugin tasks appended after the built-ins with the server's label/hint; a missing label falls back to the key; a built-in is never duplicated; `inherit_from` is carried through. |
| `web/src/lib/aux-tasks.ts` | The 12 built-in auxiliary slots and the plugin-task merge. (Tier-1 entry above.) |
| `web/src/lib/chat-activation.test.ts` | The four cases of the sticky PTY latch (inactive → inactive; activates; stays activated after leaving; stays while active). |
| `web/src/lib/chat-activation.ts` | The sticky latch. (Tier-1 entry above.) |
| `web/src/lib/chat-channel-id.test.ts` | The channel id is prefixed `chat-` / `chat-fresh-` and never repeats. |
| `web/src/lib/chat-channel-id.ts` | The channel id generator (crypto UUID with a Math.random fallback). |
| `web/src/lib/chat-copy-last.ts` | Sends `/copy`, waits 100 ms, sends Return separately, flashes "copied" for 1.5 s, refocuses the terminal. |
| `web/src/lib/chat-copy-last-button.tsx` | The floating "copy last response" overlay button. |
| `web/src/lib/chat-image-drop.ts` | Paste / dragover / drop listeners in the capture phase; plain-text pastes are cancelled and re-delivered via `term.paste()`. |
| `web/src/lib/chat-panel-collapsed.ts` | The persisted collapse flag for the desktop chat side panel (localStorage), as pure helpers. |
| `web/src/lib/chat-sidebar-banner.test.ts` | Pins the credential-warning rewrite (names the provider and the fix, drops "First message will fail") and the transport-jargon collapse (real errors pass through). |
| `web/src/lib/chat-sidebar-banner.ts` | The sidecar banner copy helpers. (Tier-1 entry above.) |
| `web/src/lib/chat-sidebar-session-params.test.ts` | Pins the sidecar `session.create` params: `close_on_disconnect: true`, `source: "tool"`, profile forwarded when present and omitted when not. |
| `web/src/lib/chat-title.test.ts` | Pins the three-state title result (`undefined` / `null` / trimmed string) and that a payload without a `title` field returns `undefined`. |
| `web/src/lib/chat-title.ts` | The title normalisers. (Tier-1 entry above.) |
| `web/src/lib/chat-workspaces.test.ts` | Pins the picker order (project folders first, then repos by recency, deduped), archived projects excluded, and that `~` is only collapsed on a path boundary (`/home/user2` is not `/home/u`). |
| `web/src/lib/chat-workspaces.ts` | The workspace list/flatten/persist helpers. (Tier-1 entry above.) |
| `web/src/lib/chatImagePaste.test.ts` | Pins image extraction from `DataTransfer` (items + files), the Safari/Firefox `files[]` fallback, de-duplication across both lists, and that a `file` item with an empty `type` still counts as an image. |
| `web/src/lib/chatImagePaste.ts` | The image extraction + upload helpers (25 MB cap, MIME→extension map). (Tier-1 entry above.) |
| `web/src/lib/clipboard.test.ts` | Pins the Clipboard API path, the `execCommand` fallback when it rejects, the insecure-context path, and `false` when no mechanism exists. |
| `web/src/lib/clipboard.ts` | The copy helper. (Tier-1 entry above.) |
| `web/src/lib/cron-job.test.ts` | Pins: list normalisation and trailing-slash stripping; continuity stored as the reserved `self` entry and stripped when the toggle is off; optional fields collapse to `null` so an update explicitly clears them; a script counts as execution content; the stored `self` entry splits back into the toggle; a one-shot `run_at` beats the display string; the `last_status` tone table (`ok`/`delivery_failed`/`blocked_config`/`error`/unknown); the 15-minute overdue grace; the scheduler-staleness age across profiles. |
| `web/src/lib/cron-job.ts` | The cron form/payload/result logic. (Tier-1 entry above.) |
| `web/src/lib/cron-trigger-controller.test.ts` | Pins the shared trigger controller: immediate announcement + coalescing of a duplicate trigger for the same job, release after a failure, release after a failing feedback callback, the same job id in two profiles running concurrently, release before the stopped-state callback, and the stopped-callback failure path. |
| `web/src/lib/dashboard-auth-reload.test.ts` | Pins the one-shot reload latch (reloads once, clears on request) and that a 4401 only reloads in loopback mode. |
| `web/src/lib/dashboard-auth-reload.ts` | The stale-token reload policy. (Tier-1 entry above.) |
| `web/src/lib/dashboard-flags.ts` | `isDashboardEmbeddedChatEnabled()` — now always `true`, kept as a stable seam. |
| `web/src/lib/dashboard-modal-shell.ts` | The shared modal backdrop/panel class strings + `shouldCloseOuterModalOnEscape` (an outer modal must ignore Escape while a nested picker owns it). |
| `web/src/lib/env-state.test.ts` | Pins that a deleted CUSTOM key is removed from state while a catalog key is kept and marked unset. |
| `web/src/lib/env-state.ts` | That reconciler. (Tier-1 entry above.) |
| `web/src/lib/events-reconnect.test.ts` | Pins the delay ladder (doubling, clamped, monotonic), which close codes are retried (1001/1005/1006/1011/1012/1013 yes; 1000 no; 4401/4403 no; undefined yes), the "never both retry and report an auth rejection" invariant, the prefix-based banner ownership, and the delay rendered in whole seconds. |
| `web/src/lib/events-reconnect.ts` | The events-feed reconnect policy. (Tier-1 entry above.) |
| `web/src/lib/eventsFeedClient.ts` | The `/api/events` subscriber client. (Tier-1 entry above.) |
| `web/src/lib/gatewayClient.test.ts` | Pins that a loopback 4401 close is routed through the stale-token reload path. |
| `web/src/lib/gatewayClient.ts` | The JSON-RPC-over-WebSocket client (`/api/ws`), the ticket-vs-token auth switch, and the "Session token not available" guard. |
| `web/src/lib/keyboard-inset.test.ts` | Pins the inset maths: no viewport → 0, no keyboard → 0, the obscured-region formula, `offsetTop` handling, the 80 px threshold, exactly-at-threshold acceptance, never negative, degenerate and non-finite inputs → 0, fractional rounding; and the reveal-scroll delta (including iOS `offsetTop`). |
| `web/src/lib/keyboard-inset.ts` | The soft-keyboard inset maths. (Tier-1 entry above.) |
| `web/src/lib/load-error-copy.test.ts` | Pins the `{what}` / `{detail}` template filling and the omission of the details line when there is none. |
| `web/src/lib/load-error-copy.ts` | The "could not load X" copy builder (kept out of the component so the shape is testable without rendering). |
| `web/src/lib/log-classify.test.ts` | Pins the level classification, including the regression cases: `parse_errors=0` and `rotating errors.log` must NOT render red, and payload text must not spoof a higher level. |
| `web/src/lib/log-classify.ts` | The level classifier. (Tier-1 entry above.) |
| `web/src/lib/mcp-dashboard-oauth.test.ts` | Pins: the popup opens synchronously with `about:blank` and `opener = null`; a terminal OAuth error surfaces and closes the window; a blocked popup fails BEFORE `start`; a closed window is an error; a transient status failure is retried. |
| `web/src/lib/mcp-dashboard-oauth.ts` | The MCP OAuth flow. (Tier-1 entry above.) |
| `web/src/lib/mcp-server-create.test.ts` | Pins the HTTP-Bearer request (no stdio fields even when the draft has them), the OAuth and unauthenticated shapes, the stdio args/env parsing, and the four rejection messages. |
| `web/src/lib/mcp-server-create.ts` | The MCP server draft → create-request builder. (Tier-1 entry above.) |
| `web/src/lib/memory-provider-setup.ts` | `setupHasDetails` vs `setupHasInstallableSteps` — "there is a setup to describe" vs "there is a setup the dashboard can run". |
| `web/src/lib/model-picker-current.test.ts` | Pins that an auxiliary slot's own assignment wins over the catalog's main model, that an explicit `auto` override is kept, that the label reads "auto (use main model)", and the initial-provider fallback chain. |
| `web/src/lib/model-picker-current.ts` | The picker's "current" resolution. (Tier-1 entry above.) |
| `web/src/lib/model-picker-filter.test.ts` | Pins the "query found the provider but no model id" case (the "aws" / "AWS Build" issue) and the three ways it must NOT fire. |
| `web/src/lib/model-picker-filter.ts` | That filter. (Tier-1 entry above.) |
| `web/src/lib/nested.ts` | The dotted-path get/set (immutable set via `structuredClone`). (Tier-1 entry above.) |
| `web/src/lib/plugin-update.test.ts` | Pins: a `caution` scan is shown (severity, file, line, description) and retried with `force` only after the user agrees; a refusal applies nothing; a `dangerous` verdict throws WITHOUT asking. |
| `web/src/lib/plugin-update.ts` | The consent-gated plugin update. (Tier-1 entry above.) |
| `web/src/lib/profile-bootstrap.test.ts` | Pins the scope precedence (URL > bootstrap > serving), the explicit-empty-URL case, the no-scope-invented case, and that a named-profile dashboard does NOT adopt the machine's sticky active profile. |
| `web/src/lib/profile-bootstrap.ts` | The scope bootstrap. (Tier-1 entry above.) |
| `web/src/lib/pty-attach-token.test.ts` | Pins the Web-Lock claim: a duplicated tab (sessionStorage cloned) mints its OWN token, and a reload reuses the stored token once the old document released its lock. |
| `web/src/lib/pty-attach-token.ts` | The per-tab PTY identity. (Tier-1 entry above.) |
| `web/src/lib/pty-close-copy.test.ts` | Pins that 4401/4403/4404/4408 get banners while 1006 and 4410 do not, that the stale/missing-token cases offer a Reload, and that the ladder stops after the last attempt. |
| `web/src/lib/pty-close-copy.ts` | The PTY lifecycle copy. (Tier-1 entry above.) |
| `web/src/lib/pty-composition.test.ts` | Pins the IME forwarding: a composition with no `onData` is forwarded; `onData` arriving first cancels the fallback; unrelated terminal data preserves it; ESC/SGR is ignored while matching; rapid consecutive commits are preserved; disposal cancels; and the three Android/Gboard double-send paths deliver a word exactly once, while real repeats (outside the window) and unrelated input survive. |
| `web/src/lib/pty-composition.ts` | The IME dedup forwarder. (Tier-1 entry above.) |
| `web/src/lib/pty-focus.test.ts` | Pins focus restoration: `<body>`/null → restore, already-in-host → restore, another control → do NOT steal, host not mounted → restore. |
| `web/src/lib/pty-focus.ts` | The focus-restoration predicate. (Tier-1 entry above.) |
| `web/src/lib/pty-keyboard-shortcuts.test.ts` | Pins `Ctrl+C` copying only with a selection, `Ctrl+Backspace` / `Ctrl+Delete` word deletion, and that shortcut bytes are blocked in every non-`open` PTY state and when the socket is not open. |
| `web/src/lib/pty-keyboard-shortcuts.ts` | The shortcut resolver + the guarded sender. (Tier-1 entry above.) |
| `web/src/lib/pty-mobile-input.test.ts` | Pins: the replacement input types; a Gboard full-line and a last-word suggestion both become backspace+retext; ordinary appends untouched; control input untouched; single-letter reduplication preserved; the stale-tracker DELETE-count bug; and that an arrow-key reset disarms the heuristic. |
| `web/src/lib/pty-mobile-input.ts` | The mobile-input normaliser. (Tier-1 entry above.) |
| `web/src/lib/pty-mouse-report.ts` | The SGR mouse-report regex; reports are dropped, not forwarded. |
| `web/src/lib/pty-reconnect.test.ts` | Pins the page-resume rules (reconnect on visible resume with a missing/closed socket; not while hidden; not while offline; not while a connect is in flight unless already closed; not after give-up; not on an open socket) and the delay ladder. |
| `web/src/lib/pty-reconnect.ts` | The PTY reconnect policy. (Tier-1 entry above.) |
| `web/src/lib/pty-resume-loading.test.ts` | Pins the hydration gate against the REAL sanitizer: an erase-only, all-newline or partial-CSI first frame keeps the wait notice up; a visible replay clears it. |
| `web/src/lib/pty-resume-loading.ts` | The resume wait-notice gate. (Tier-1 entry above.) |
| `web/src/lib/pty-resume-sanitizer.test.ts` | Pins: normal text untouched; CRLF and LF bursts collapsed; short runs untouched; `ESC[K` / `ESC[X` stripped (and preserved after the window closes); SGR untouched; partial escapes buffered and resolved across frames; a partial escape DROPPED on flush; bursts split across 64 KiB frames, many small reads, and 49+49 fragments all collapsed; blank runs separated by content NOT merged; a trailing run emitted on flush. (The file documents why the fixtures use CRLF: the PTY is in cooked mode.) |
| `web/src/lib/pty-resume-sanitizer.ts` | The resume sanitizer. (Tier-1 entry above.) |
| `web/src/lib/pty-scroll.test.ts` | Pins the bottom-pin predicate (including the overshoot case and a 0×0 buffer), the follow rules (resume only, released when the user scrolls up), and the resume control-frame parser (an ANSI banner is NOT a control frame). |
| `web/src/lib/pty-scroll.ts` | The resume-scroll helpers. (Tier-1 entry above.) |
| `web/src/lib/reasoning-effort.test.ts` | Pins: empty/unset → `medium`; every valid level passes through; case/whitespace insensitive; unknown values → `medium`; and no orphan option labels. |
| `web/src/lib/reasoning-effort.ts` | The effort ladder (`none` + 7 levels) and the normaliser, sourced from `@hermes/shared`. |
| `web/src/lib/reasoning-markup.test.ts` | Pins: `<thinking>` unwrapping; prose/action/result separation; unrelated angle brackets are not markup; fenced XML/HTML stays literal; an unfinished tag stays plain text; and the structured rendering is ASSISTANT-ONLY (user/tool/system keep literal tags). |
| `web/src/lib/reasoning-markup.ts` | The markup parser. (Tier-1 entry above.) |
| `web/src/lib/resolve-page-title.test.ts` | Pins i18n nav keys, plugin tab labels, the literal map (`/mcp` → "MCP", not "Mcp"), the root → Sessions case, and the trailing-slash equivalence. |
| `web/src/lib/resolve-page-title.ts` | The page-title resolver (i18n keys → literal map → capitalised path segment). |
| `web/src/lib/schedule.test.ts` | Pins the parse of every schedule form (interval, ISO, daily, weekly, Sunday-7 normalisation, monthly) and the fallbacks to `custom` (ranges, `@daily`, a Z-suffixed ISO, an out-of-range weekday, a multi-day-of-month), plus a 12-case build↔parse round trip. |
| `web/src/lib/schedule.ts` | The schedule builder/describer. (Tier-1 entry above.) |
| `web/src/lib/session-import.test.ts` | Pins the three accepted import shapes (single, array, wrapped, JSONL), the "File is empty" and "Expected exported session JSON or JSONL" rejections, and the summary line (skipped/detached counts only when present). |
| `web/src/lib/session-import.ts` | The import parser + summary. (Tier-1 entry above.) |
| `web/src/lib/session-mutations.test.ts` | Pins: a lost reply is retried unchanged; the request carries `expected_revision`, `expected_generation` and a `request_id`; a revision conflict surfaces; a missing snapshot is an error (never a substituted counter); and `request_id` degrades gracefully without `crypto.randomUUID`. |
| `web/src/lib/session-mutations.ts` | The optimistic-concurrency session writer. (Tier-1 entry above.) |
| `web/src/lib/session-prune.ts` | The prune result line, including "Skipped N open sessions; prune only removes ended sessions". |
| `web/src/lib/session-refresh.test.ts` | Pins the four refresh cases (first poll, empty response, unchanged head, new head). |
| `web/src/lib/session-refresh.ts` | The cross-process staleness detector. (Tier-1 entry above.) |
| `web/src/lib/shared-gateway.test.ts` | Pins: the shared-profile list (default first); `null` for a standalone gateway, an older backend, or a lone default; the 409 detail unwrapping; and that the "Open Logs" pointer is omitted when the dashboard itself is unreachable, with no doubled punctuation. |
| `web/src/lib/shared-gateway.ts` | The shared-gateway copy and truth-detection. (Tier-1 entry above.) |
| `web/src/lib/terminal-appearance.ts` | The terminal theme, the layout-width-driven font tier (7→14 px), the line-height tier, and `terminalTierWidthPx` (host `clientWidth` first). |
| `web/src/lib/terminal-font-refit.test.ts` | Pins: the re-measure → refit → atlas-clear → full-refresh sequence on font load; nothing after cleanup; nothing when the faces were already loaded; fallback metrics left alone when no face loads; and a no-op without a `FontFaceSet`. |
| `web/src/lib/terminal-font-refit.ts` | The font-load refit. (Tier-1 entry above.) |
| `web/src/lib/terminal-touch-scroll.test.ts` | Pins the drag→`scrollLines` conversion, that the boundary leaves the event to the outer page, and that cleanup removes the listeners. |
| `web/src/lib/terminal-touch-scroll.ts` | The iPadOS touch-scroll shim. (Tier-1 entry above.) |
| `web/src/lib/utils.ts` | `cn()` (clsx + tailwind-merge), the three theme-font class constants, and `timeAgo` / `isoTimeAgo`. |
| `web/src/lib/xterm-webgl-gating.test.ts` | Pins: the Safari detection (desktop + iOS yes; Chrome/Firefox/CriOS/FxiOS/Edg no), the WebGL gate (width ≥ 768, never Safari, never without a context, never on llvmpipe), the probe releasing its context, and the complex-script detection (Bengali/Devanagari/Khmer yes; ASCII, box-drawing and emoji no; above-BMP handled). |
| `web/src/lib/xterm-webgl-gating.ts` | The WebGL gate. (Tier-1 entry above.) |
| `web/src/lib/xterm-webgl-release.test.ts` | Pins that every WebGL context under the host is released and a 2D canvas is never handed a context. |
| `web/src/lib/xterm-webgl-release.ts` | The GL-context release. (Tier-1 entry above.) |

#### `web/src/components/` (39 files)

| File | What it is / what it pins |
| --- | --- |
| `web/src/components/AllowlistInput.tsx` | One input per allowlist entry; a pasted `"123, 456"` splits into separate boxes; reports one comma-separated, de-duplicated value; the last row cannot be removed. |
| `web/src/components/AuthWidget.test.tsx` | Pins the visibility helper (loopback hidden, gated visible) and the integration: a loopback identity renders nothing, a non-loopback identity renders the name and a logout button, and a 401 hides the widget. Also asserts the request went through the real `getAuthMe` → `fetchJSON` path with the session header. |
| `web/src/components/AuthWidget.tsx` | The sidebar identity widget. (Tier-1 entry above.) |
| `web/src/components/AutoField.tsx` | The schema-driven config field (boolean/select/number/text/list + recursive nested objects and arrays) with a `FieldHint` showing the key path and description. |
| `web/src/components/AutomationBlueprints.tsx` | The blueprint gallery: each card expands into a per-field form; submitting POSTs `/api/cron/blueprints/instantiate`; a 422's slot-level message is shown inline. |
| `web/src/components/ChatSessionList.test.tsx` | Pins the 20 s poll, the `visibilitychange` refresh, and that the list does not load or poll until the Chat tab is active. |
| `web/src/components/ChatSessionList.tsx` | The conversation switcher (read-only + select/new). (Tier-1 entry above.) |
| `web/src/components/ChatSidebar.test.tsx` | The largest test in the shard: the runtime-model badge follows the PTY's `session.info` over config; config stays until a runtime identity arrives; a title-only update does not blank the badge; the sidecar auto-redials after a transient close; the redial budget exhausts and reports "gave up after 5 attempts"; the events feed's exponential backoff (1s/2s/4s) and its reset only after a stable 10 s open; a flapping socket does NOT refill the ladder; one retry when `error` and `close` both fire; auth rejections and normal closures are not retried; the give-up cap; the banner clearing only its own message (a credential warning survives a feed recovery, and a sidecar error survives a feed drop); "Add key" is a route change, not a page load; the shared JSON-RPC client is reused across reconnects (so seq replay can fire); and unmount clears the timer and closes the socket. |
| `web/src/components/ChatSidebar.tsx` | The side panel. (Tier-1 entry above.) |
| `web/src/components/ChatWorkspacePicker.tsx` | The workspace picker: discovered projects/repos plus a custom path, persisted per profile, applied to the NEXT fresh chat. |
| `web/src/components/ConfirmDialog.tsx` | The one confirmation dialog (focus the confirm button, restore focus on close, backdrop/Escape cancel). |
| `web/src/components/DeleteConfirmDialog.tsx` | A thin i18n wrapper over the DS confirm dialog. |
| `web/src/components/HermesConsoleModal.tsx` | The Hermes Console: an xterm terminal over `/api/console` with a JSON frame protocol, command history, `^C`/`^L`, a `confirm_required` prompt, and a Reconnect that redials without closing the modal. |
| `web/src/components/LanguageSwitcher.tsx` | The endonym-based language picker (no flags), with a bottom sheet on narrow viewports and an anchored dropdown otherwise. |
| `web/src/components/LoadErrorNotice.tsx` | The persistent "could not load X" card with a Retry button. |
| `web/src/components/Markdown.tsx` | The lightweight markdown renderer + streaming caret + link-scheme allow-list. (Tier-1 entry above.) |
| `web/src/components/MemoryPressureBanner.test.tsx` | Pins: nothing for null/healthy/`unknown`; critical outranks the OOM notice; dismissal persists across re-renders; escalation re-opens; a NEW `boot_id` re-opens both the OOM notice and a live-pressure banner; a confirmed recovery resets; `unknown` does NOT reset; disk healthy/unknown renders nothing; the disk-critical message with free-space detail; disk critical outranks memory critical; the OOM notice outranks disk elevated; dismissing a disk warning does not mask a later memory warning; disk escalation re-opens; disk recovery resets; disk and memory dismissals are independent; a reboot re-opens the disk banner. |
| `web/src/components/MemoryPressureBanner.tsx` | The pressure banner. (Tier-1 entry above.) |
| `web/src/components/ModelInfoCard.tsx` | The model capability card: context window (with the "override — auto:" annotation), max output tokens, and the Tools/Vision/Reasoning/family badges. |
| `web/src/components/ModelPickerDialog.tsx` | The two-stage provider→model picker. (Tier-1 entry above.) |
| `web/src/components/ModelReloadConfirm.tsx` | The "switching starts a fresh chat, the old one stays resumable, memory is kept" confirm. |
| `web/src/components/MultiplexStandaloneBanner.tsx` | The amber banner for a gateway that came up standalone on a boot guard, dismissed per reason text. |
| `web/src/components/OAuthLoginModal.test.tsx` | Pins the local-expiry behaviour: the backend's enriched message is surfaced; a still-`pending` backend keeps the session alive (clock skew); the PKCE flow does not poll; and a Retry starts a genuinely fresh session with a new countdown. |
| `web/src/components/OAuthLoginModal.tsx` | The sign-in modal. (Tier-1 entry above.) |
| `web/src/components/OAuthProvidersCard.tsx` | The provider list with per-provider flow badges, token previews, expiry countdowns, the CLI-command fallback with a copy button, and a destructive disconnect confirm. |
| `web/src/components/PlatformsCard.tsx` | The connected-platforms card with a state→tone map, per-platform error messages and last-update times, and a pulse dot on the connected badge. |
| `web/src/components/ProfileScopeBanner.tsx` | The app-wide amber "managing profile X" strip. |
| `web/src/components/ProfileSwitcher.tsx` | The machine's write-target selector in the sidebar (hidden when only one profile exists; the current-profile option is highlighted amber when another is targeted). |
| `web/src/components/ReasoningPicker.tsx` | The effort selector, writing a SPARSE config patch and reverting the optimistic UI on failure. |
| `web/src/components/ScheduleBuilder.tsx` | The human schedule picker (interval/daily/weekly/monthly/once/custom) with an inline preview of the string that will be sent. |
| `web/src/components/SharedMetricsConsentBanner.tsx` | The first-run metrics offer with two equal answers; a re-ask's X keeps the recorded "No thanks". |
| `web/src/components/SidebarFooter.tsx` | The version stamp and the org link. |
| `web/src/components/SidebarStatusStrip.tsx` | The gateway + active-session summary, and `gatewayLine()` — the single place the gateway state is turned into a tone (including "heartbeat stale" and "degraded but not running"). |
| `web/src/components/SkillEditorDialog.tsx` | The SKILL.md author (create + edit) with a create template; validation happens server-side so errors are actionable inline. |
| `web/src/components/StructuredReasoning.test.tsx` | Pins that the `<thinking>` wrapper is unwrapped (no literal tags in the DOM) and that action/result render as labelled code blocks. |
| `web/src/components/StructuredReasoning.tsx` | The structured reasoning renderer (prose → Markdown; action/result → labelled code blocks). |
| `web/src/components/ThemeSwitcher.tsx` | The theme picker with a 3-stop palette swatch per theme plus an independent font-override section. |
| `web/src/components/ToolsetConfigDrawer.tsx` | The toolset configuration drawer: enable toggle, provider matrix, per-env-var key inputs ("leave blank to keep"), and a post-setup install with a live log tail. |
| `web/src/components/auth-widget-visibility.ts` | One predicate: hide the auth widget for a `loopback` identity. |

#### `web/src/pages/` (25 files)

| File | What it is / what it pins |
| --- | --- |
| `web/src/pages/AnalyticsPage.tsx` | The usage dashboard: 7/30/90-day periods, a daily token bar chart, per-model and top-skill tables, a sortable `useTableSort` hook (nulls always last), and the token/series colours driven by the theme's `--series-*-token` vars. (Partial: head 90 + tail 25 of 605 lines read.) |
| `web/src/pages/ChannelsPage.tsx` | The messaging-platforms surface: per-platform state badges, allowlist editing, Telegram bot-token and Slack-token format validation, and the WhatsApp/Telegram QR onboarding panels. (Partial: head 70 + tail 20 of 1517 lines read.) |
| `web/src/pages/ChannelsPage.whatsapp.test.tsx` | Pins that a destructive re-pair needs an explicit "Back up and re-pair" confirmation naming the private backup, that an ordinary pairing is non-destructive, and that an active-bridge refusal is shown with the button re-enabled. |
| `web/src/pages/ChatPage.a11y.test.tsx` | Pins the composer accessibility: the xterm `Terminal` is constructed with `screenReaderMode: true` (the constructor option, not a DOM patch), the host is a labelled `role="region"`, and exactly ONE custom key handler is registered (a second silently replaces the first) with Tab returned to the browser (WCAG 2.1.2). |
| `web/src/pages/ChatPage.test.tsx` | The PTY page's behaviour tests: the reconnect ladder, the ticket timeout, WebGL selection and mid-stream teardown for complex scripts. (Partial: head 130 + tail 20 of 946 lines read.) |
| `web/src/pages/ChatPage.tsx` | The embedded terminal page — the whole PTY lifecycle (connect, ticket, keepalive, reconnect, resume hydration, sanitizer, scroll pinning, IME, mobile input, keyboard inset, touch scroll, WebGL gating and release, attach token, focus, copy-last). (Partial: head 220 + tail 45 of 2073 lines read; the connect/reconnect body was not read line by line.) |
| `web/src/pages/ConfigPage.tsx` | The schema-driven config editor: 25+ categories with icons, a search across fields, per-category reset-to-default with a confirm dialog, raw-YAML view/edit, and import/export. (Partial: head 90 + tail 25 of 680 lines read.) |
| `web/src/pages/CronPage.tsx` | The cron surface: the job list with per-job badges (state, last result, profile, delivery target, skills, mode, model, toolsets), the schedule description, the overdue / missed-fire / delivery-error lines, pause/resume/trigger-now, the create and edit modals, the blueprint tab, and the profile filter. (Partial: lines 1-720 and 900-1294 of 1294 read; the trigger/pause/create handler block at 721-899 was not read.) |
| `web/src/pages/DocsPage.tsx` | The docs iframe, with a `color-scheme: light` + white background so the light-canvas Docusaurus text stays readable inside a dark dashboard. |
| `web/src/pages/EnvPage.tsx` | The Keys page: provider grouping by env-var prefix (18 prefixes with an explicit priority order), per-key set/unset, reveal, and the OAuth providers card. (Partial: head 70 + tail 20 of 1109 lines read.) |
| `web/src/pages/FilesPage.tsx` | The managed-files browser: listing, drag-and-drop upload, directory creation, delete with a confirm, and download via a data URL. (Partial: head 90 + tail 25 of 539 lines read.) |
| `web/src/pages/LogsPage.tsx` | The log viewer: file/level/component/line-count segmented filters, `?file=` deep links, a 5 s auto-refresh, and per-line level colouring via `classifyLine`. |
| `web/src/pages/McpPage.tsx` | The MCP surface: the server list, the add-server modal (http/stdio, none/header/oauth), a per-server test, the OAuth flow via `completeMcpDashboardOAuth`, and the catalogue with install. (Partial: head 70 + tail 20 of 917 lines read.) |
| `web/src/pages/ModelsPage.tsx` | The models surface: per-model token/cost analytics with a four-segment input/output/cache-read/reasoning bar, the auxiliary-slot assignments, the MoA slots, and the model picker. (Partial: head 110 + tail 30 of 1390 lines read.) |
| `web/src/pages/PairingPage.tsx` | The pairing surface: pending requests with an explicit Approve per request, approved users with a destructive revoke, and a "Clear pending" action in the page header. |
| `web/src/pages/PluginsPage.test.ts` | Pins that a memory provider with only a declared Python dependency has setup details and installable steps (and that dropping the declaration removes the installable steps). |
| `web/src/pages/PluginsPage.tsx` | The plugin surface: the installed list, the hub, the catalogue with install/remove, the runtime toggle, sidebar visibility, the memory-provider configuration, and the consent-gated update. (Partial: head 70 + tail 20 of 1395 lines read.) |
| `web/src/pages/ProfileBuilderPage.tsx` | The stepped profile wizard (identity → model → skills → MCPs → review); nothing is written until the final POST; skills use REPLACE semantics. (Partial: head 70 + tail 20 of 834 lines read.) |
| `web/src/pages/ProfilesPage.tsx` | The profiles surface: create/rename/delete, "Set as active", the soul (description) editor, the per-profile model, "Manage skills & tools", and a reduced-motion-aware braille spinner. (Partial: head 70 + tail 20 of 1426 lines read.) |
| `web/src/pages/SessionsPage.test.tsx` | Pins the per-row profile routing (every per-row request goes to the row's OWNING profile, not the management default) and the role-gated structured reasoning (a user message containing literal `<action>`/`<result>` tags is NOT parsed as reasoning). (Partial: head 130 + tail 20 of 261 lines read.) |
| `web/src/pages/SessionsPage.tsx` | The sessions surface: the list with per-row actions, the FTS5 snippet highlighting, the transcript with tool-call blocks, the overview/automation/chats filters, the import/export, prune, and bulk delete. (Partial: head 130 + tail 30 of 2158 lines read.) |
| `web/src/pages/SessionsPage_sources.tsx` | The session-source vocabulary: 20 sources with an icon and a colour, the 8 "automation" sources, the category mapping, and the human labels. |
| `web/src/pages/SkillsPage.tsx` | The skills surface: the installed list with per-skill enable switches, the hub with install/update/uninstall, a security scan panel (severity, category, file:line, description, policy reason), the skill editor, and the toolset drawer. (Partial: head 110 + tail 30 of 1665 lines read.) |
| `web/src/pages/SystemPage.tsx` | The system surface: gateway start/stop/restart, the doctor / security audit / backup / import / checkpoint actions with a live action-log viewer, the memory provider, the credential pool, the hooks, the curator, the portal, the prompt-size probe and the debug-share. (Partial: head 110 + tail 30 of 1655 lines read.) |
| `web/src/pages/WebhooksPage.tsx` | The webhooks surface: enable, create (name, description, events, delivery mode, optional prompt), the one-time secret shown on creation with a copy button, per-subscription toggle and delete, and a restart-required notice. (Partial: head 90 + tail 25 of 613 lines read.) |

#### `web/src/plugins/` (10 files)

| File | What it is / what it pins |
| --- | --- |
| `web/src/plugins/PluginPage.tsx` | Renders a plugin tab once its bundle calls `register()`; subscribes during render via `useSyncExternalStore` so a registration that beats the effect is never missed; shows `LOAD_FAILED` / `NO_REGISTER` copy. |
| `web/src/plugins/index.ts` | The plugin barrel. |
| `web/src/plugins/registry.test.ts` | Pins the SDK surface additions: Dialog + its subcomponents, ConfirmDialog and Toast on `components`; `useToast` and `useConfirmDelete` on `hooks`; and that the original React hooks are still present. |
| `web/src/plugins/registry.ts` | The registry, the profile binding (`selectPluginProfile`, `_fromOtherProfile`) and `exposePluginSDK()` (React, hooks, `api`, `fetchJSON`, `authedFetch`, `buildWsUrl`, `buildWsAuthParam`, the component map, `cn`/`timeAgo`/`isoTimeAgo`, `useI18n`) plus `SDK_CONTRACT_VERSION = "1.1.0"`. |
| `web/src/plugins/sdk.d.ts` | The hand-authored, versioned public contract for `window.__HERMES_PLUGIN_SDK__` / `__HERMES_PLUGINS__`, with the reasons it is not derived from the runtime object, and the open questions for productionising it. |
| `web/src/plugins/slots.ts` | The 30 named slots (10 shell-wide + 20 page-scoped), the registration order, the replace-on-re-register rule, and `clearPluginSlots()` on a profile change. |
| `web/src/plugins/types.ts` | `PluginManifest` (including the optional SRI `integrity` field and the `tab.position` / `tab.override` / `tab.hidden` controls) and `RegisteredPlugin`. |
| `web/src/plugins/usePlugins.profile.test.tsx` | Pins the profile binding: a list for the previous selection that lands after a switch is dropped; the previous profile's plugins, assets, slots and late registrations are all forgotten; assets are removed when the profile is left even after its list empties; and a profile seeds only from its own cached list. |
| `web/src/plugins/usePlugins.test.ts` | Pins the manifest cache (per-profile keys, invalid JSON → null, storage errors swallowed), `canSeedLoadedFromCache` (a cached `/chat` override keeps `loading = true`), and `pluginAssetUrl` (the profile is a path segment, so relative asset URLs keep it). |
| `web/src/plugins/usePlugins.ts` | The discovery + injection hook: manifest fetch, CSS/script injection with `data-hermes-profile`, SRI, the `LOAD_FAILED` / `NO_REGISTER` outcomes, a 2 s loading timeout, and the per-profile asset teardown. |

#### `web/src/themes/` (6 files)

| File | What it is / what it pins |
| --- | --- |
| `web/src/themes/context.tsx` | The theme provider: the CSS-var builders (palette layers as `color-mix` + opaque base, typography vars, layout vars, the camel→`--color-*` override map with a full-clear list, the series-colour vars, the named-asset vars, the component-style buckets) and the apply/switch lifecycle. (Partial: lines 1-200 of 615 read — the builders are covered; the apply effect was not read line by line.) |
| `web/src/themes/fonts.ts` | The 14-entry curated font catalogue (system sans/serif/mono + Inter, IBM Plex Sans, Work Sans, Atkinson Hyperlegible, DM Sans, Spectral, Fraunces, Source Serif 4, JetBrains Mono, IBM Plex Mono, Space Mono), the `theme` sentinel, and the reason the catalogue is vetted (an injected `fontUrl` is a self-XSS / SSRF footgun). |
| `web/src/themes/index.ts` | The theme barrel. |
| `web/src/themes/presets.test.ts` | Pins that the shared presets (cyberpunk, ember, midnight, mono) render the shared palette table's background, and that the accent's contrast against the canvas is ≥ 3:1. |
| `web/src/themes/presets.ts` | The 8 built-in themes (default, default-large, nous-blue, midnight, ember, mono, cyberpunk, rose) and the shared-palette projection. |
| `web/src/themes/types.ts` | The theme model: palette, typography, layout (radius + density), assets, `componentStyles` (per-bucket CSS vars), `colorOverrides`, `seriesColors`, `swatchColors`, the terminal colours, and the `ThemeListResponse` (built-ins are partial; user themes carry their full definition). |

---

### Tier 3 — skipped with a reason

- `web/public/favicon.ico` — binary ICO, 4 808 bytes, magic `00 00 01 00`; confirmed on disk, not read line by line.
- `web/public/fonts-terminal/JetBrainsMono-Bold.woff2` (94 628 B), `…-Italic.woff2` (96 428 B), `…-Regular.woff2` (92 380 B) — binary WOFF2 (`wOF2` magic); confirmed on disk, not read line by line.
- `web/public/fonts/Collapse-Bold.woff2` (59 144 B), `…-Regular.woff2` (62 816 B), `…/Mondwest-Regular.woff2` (23 828 B), `…/RulesCompressed-Medium.woff2` (38 848 B), `…/RulesCompressed-Regular.woff2` (37 764 B), `…/RulesExpanded-Bold.woff2` (35 012 B), `…/RulesExpanded-Regular.woff2` (33 820 B) — binary WOFF2 (`wOF2` magic); confirmed on disk, not read line by line.

---

## 2. Ideas worth stealing

1. **The "one owner per banner" rule.** A shared error surface is written to and cleared by several
   producers; each producer may only clear a message *it* wrote. Hermes solves it with a fixed prefix
   and an `isEventsFeedMessage()` predicate, and the tests prove the two other producers' messages
   survive (`web/src/lib/events-reconnect.ts:56-66`, `web/src/components/ChatSidebar.test.tsx`).
   *Why it transfers:* August Trading has several places that can show a run-level error (the
   provider error, the notebook failure, the validation refusal). A "who owns this banner" rule plus a
   per-source prefix is a cheap, testable way to stop one recovery path from erasing another's warning.
   **UNIQUE** (to this repo's shape, but directly transferable).
2. **A dismissal key that embeds the reporting boot id.** A user dismissed the warning once; the
   process restarted; the situation is the SAME but the INCIDENT is new, so the banner must re-appear.
   Keying dismissals by `trigger:boot_id` gets this exactly right, and the escalation/recovery rules
   are stated as a small state machine (`web/src/components/MemoryPressureBanner.tsx:25-37, 112-128`).
   *Why it transfers:* August Trading's outcome-settlement and "not enough data" warnings have the
   same shape — a dismissal must not hide a NEW episode, but a confirmed recovery should clear the old
   one. **UNIQUE**.
3. **A closed status→tone table where an UNKNOWN literal is destructive, not neutral.** A new backend
   status can never render as a quiet grey badge (`web/src/lib/cron-job.ts:122-145`). *Why it
   transfers:* August Trading computes verdicts from a model's free-text output and from persisted rows;
   defaulting an unrecognised verdict to "neutral" is how a broken trade looks fine. **UNIQUE**.
4. **Separate "the run failed" from "the run succeeded but delivery failed"** — two fields
   (`last_error` vs `last_delivery_error`), two tones (red vs amber), and a rule that the detail comes
   from the right field (`web/src/lib/cron-job.ts:126-145`). *Why it transfers:* a plan that was
   generated but never logged, or a post-mortem that ran but never wrote back, is a materially different
   event from a failed post-mortem. **UNIQUE**.
5. **Detect a dead scheduler instead of presenting a stale "Next run".** A stored `next_run_at` in the
   past beyond a 15-minute grace is rendered as "overdue since", and the scheduler's own heartbeat age
   is surfaced separately (`web/src/lib/cron-job.ts:147-186`, `web/src/pages/CronPage.tsx:905-912`). The
   same file comments that a parked stamp is "the only user-visible trace of a dead scheduler".
   *Why it transfers:* August Trading's automations and scheduled analyses need exactly this — a
   scheduler that died looks identical to "nothing scheduled" unless the UI checks the heartbeat.
   **UNIQUE**.
6. **"A socket that opens and dies within 10 s is a flap, not a recovery."** The reconnect budget is
   only refilled after a connection has been stable past a grace window, so an open→immediate-close
   cycle cannot reset the ladder forever (`web/src/components/ChatSidebar.tsx:65-78`,
   `web/src/lib/pty-reconnect.ts`). *Why it transfers:* August Trading's WebSocket/SSE or polling
   clients have the same bug potential — a backoff budget that resets on every open is an infinite
   retry loop wearing a backoff costume. **UNIQUE**.
7. **Runtime identity beats configured identity in the UI.** The badge shows the model that actually
   answered (from the session's own `session.info`), falling back to the configured one — because a
   provider fallback swaps the model mid-turn and the configured model is then a lie
   (`web/src/components/ChatSidebar.tsx:153-176`). *Why it transfers:* August Trading has a
   provider-fallback path; the "current model" the trader is told must be the one that produced the
   answer, not the one that was configured. **UNIQUE**.
8. **A one-shot reload latch for a rotated session token, applied to HTTP 401 *and* the WebSocket
   close code** (`web/src/lib/dashboard-auth-reload.ts`). *Why it transfers:* a browser tab that
   survives a backend restart holds a stale credential; the correct behaviour is one automatic reload,
   not a login loop. **CONVERGENT** (the same shape appears in the other two reference repos' auth
   handling).
9. **Cross-process staleness detection by head id.** The dashboard and a CLI share one SQLite DB and
   there is no push channel, so the page polls and compares the newest session id to decide whether
   the paginated list is stale (`web/src/lib/session-refresh.ts`). *Why it transfers:* the same
   "two processes, one store, no push" problem exists between the Electron shell and the renderer.
   **UNIQUE**.
10. **Optimistic concurrency on every write, with a stable request identity.** Every session write
    first fetches a mutation snapshot, then sends `expected_revision` / `expected_generation` /
    `request_id`, and a lost reply is retried *unchanged*
    (`web/src/lib/session-mutations.ts`). *Why it transfers:* August Trading writes trade plans,
    skills and memories from several surfaces; an idempotency key plus a revision check is the
    cheapest way to make a retry safe. **UNIQUE**.
11. **A URL-prefix allow-list for scoping, not a per-call argument.** One global switcher and 40
    endpoint families decide where a write lands; an explicit parameter always wins
    (`web/src/lib/api.ts:109-175`). *Why it transfers:* August Trading has provider configs, skills
    and memories that all need a scope; one allow-list is far less error-prone than threading a scope
    through 170 call sites. **CONVERGENT** (all three repos scope their mutable state).
12. **A "the scope fell back to what an unnamed request already meant" rule.** The backend injects the
    profile it serves only when it provably resolves back to its own home
    (`web/src/lib/api.ts:91-103`, `web/src/lib/profile-bootstrap.ts:16-30`). *Why it transfers:* the
    same reasoning applies to any "which workspace am I in?" fallback. **UNIQUE**.
13. **Render a schedule as a sentence, but refuse to guess.** The describer only humanises simple,
    well-shaped cron expressions and falls back to the raw string otherwise — because destructuring
    five fields of a six-field expression would silently drop the year
    (`web/src/lib/schedule.ts:322-335`). *Why it transfers:* a trade-plan summary that renders
    "Daily at 09:00" for a plan that only fires in 2099 is worse than showing the raw schedule.
    **UNIQUE**.
14. **Humanise the *time* but keep the *expression* visible.** The picker shows the exact string that
    will be sent, under the human form (`web/src/components/ScheduleBuilder.tsx:243-254`).
    *Why it transfers:* the same "show the machine-readable form next to the human one" pattern applies
    to a risk limit, a stop distance or a position size. **UNIQUE**.
15. **A destructive action names what it will destroy and offers the exact recovery command.** The
    WhatsApp re-pair dialog names the "private backup" and the update toast quotes the owed
    `git stash pop` instruction verbatim (`web/src/pages/ChannelsPage.whatsapp.test.tsx`,
    `web/src/contexts/SystemActions.tsx:56-73`). *Why it transfers:* deleting a trade log or a
    notebook should say what is lost and how to get it back, in the user's own words. **UNIQUE**.
16. **The update toast distinguishes "succeeded" from "succeeded but still owes work", and only this
    run's receipt may name the debt** (`web/src/contexts/SystemActions.tsx:28-31, 56-73`, pinned by
    `web/src/contexts/SystemActions.test.tsx`). *Why it transfers:* the same "partial success" shape
    applies to a settlement that wrote some rows but not all. **UNIQUE**.
17. **A denied credential warning is rewritten to name the fix** ("Add a key under Keys, or pick a
    different provider") rather than repeating the backend's "First message will fail"
    (`web/src/lib/chat-sidebar-banner.ts:35-50`). *Why it transfers:* every provider error in August
    Trading should name the button to press. **UNIQUE**.
18. **A "copy last response" that waits 100 ms so the tokenizer emits one keypress per character**
    (`web/src/lib/chat-copy-last.ts`). A tiny, concrete instance of "the transport has a timing
    contract and you must meet it". **UNIQUE**.
19. **A failed load is a persistent card with a Retry, not a toast** (`web/src/components/LoadErrorNotice.tsx:12-18`).
    *Why it transfers:* a toast that vanishes leaves the trader with an empty page and no next step.
    **CONVERGENT**.
20. **Preserve the user's selection when copying.** A copy must not destroy what was selected
    (`web/src/lib/clipboard.ts:33-46`). Small, correct, transferable. **UNIQUE**.
21. **"Optional key = English fallback" as an i18n contract.** A new string is added to the typed
    interface as optional and 16 locale files are not churned; the call site falls back to the English
    literal (`web/src/i18n/types.ts:20-21, 113-131`). *Why it transfers:* August Trading has one
    interface and no i18n — but the same "additive, typed, optional" pattern works for a growing
    settings/copy registry. **UNIQUE**.
22. **A plugin/extension surface with a versioned, hand-authored contract and an SRI opt-in** — the
    SDK deliberately withholds the session token and exposes `fetchJSON` / `authedFetch` / `buildWsUrl`
    instead (`web/src/plugins/sdk.d.ts:24-27, 60-86`). *Why it transfers:* if August Trading ever grows
    a tool-authoring surface, the "never hand the extension the secret" rule is the one to copy.
    **UNIQUE**.

---

## 3. Trading-specific findings

**Long-lived monitoring & scheduled work.** This shard is the *control plane* for Hermes' cron
scheduler, and it is the most directly transferable part of the shard for August Trading's automations.
- **Scheduled work is a first-class surface with a human picker, a description, and a preview**
  (`web/src/lib/schedule.ts`, `web/src/components/ScheduleBuilder.tsx`). The picker is fully controlled
  and **preserves each mode's state across mode switches** so flipping Daily→Weekly→Daily does not
  erase the user's work.
- **Reliability is enforced by making the failure visible, not by preventing it.** A stale
  `next_run_at` becomes an "overdue since" line rather than an upcoming "Next" (`web/src/lib/cron-job.ts:147-166`);
  the scheduler's own heartbeat age is surfaced independently (`web/src/lib/cron-job.ts:170-186`);
  a missed fire is reported as "missed scheduled fire (at …)" with the detail
  (`web/src/pages/CronPage.tsx:1223-1228`); and a failed *delivery* is distinguished from a failed
  *run* (`web/src/lib/cron-job.ts:126-145`).
- **Idempotency at the trigger point.** A manual "Trigger now" for a job that is already running is
  **coalesced, not queued** — the shared controller announces it immediately, runs the action once, and
  returns `{started: false}` for the duplicate; the same job id in two different profiles MAY run
  concurrently (`web/src/lib/cron-trigger-controller.test.ts`). The job is released on failure, on a
  failing feedback callback, and on a failing running-state callback, so a stuck state cannot wedge
  the button.
- **Continuity is a first-class, explicit toggle** — "each run sees the previous run's output (dedupe,
  pick up where it left off)" — stored as a reserved `self` entry so users never type it
  (`web/src/lib/cron-job.ts:47-52`, `web/src/pages/CronPage.tsx:303-311`). This is the closest thing in
  the shard to a post-trade feedback loop: the previous run's output is an explicit input to the next.
- **Upstream chaining is a first-class field** (`context_from` — a list of job ids), and the
  "which jobs feed this one" relation is editable (`web/src/pages/CronPage.tsx:313-323`).
- **No catch-up, no missed-run replay, and no breaker-after-empty-runs are visible in this shard** —
  those live in the Python scheduler. The dashboard's contribution is *observability*, not policy.
  **Not in this shard** for the scheduler's own recovery semantics.

**Human-in-the-loop approval.** Two surfaces, two different strengths.
- **The pairing surface is a genuine approval queue**: pending requests with the platform, the label,
  the age in minutes, and a per-request Approve button; approved users with a destructive revoke
  (`web/src/pages/PairingPage.tsx`). The request id is required — a request without one cannot be
  approved (`web/src/pages/PairingPage.tsx:64-72`).
- **A named-profile dashboard must not adopt the machine's active profile** — approving or setting a
  scope in one profile cannot silently retarget another profile's chat and model
  (`web/src/lib/profile-bootstrap.ts:44-57`).
- **Plugin updates ask before each widening**: a new catalog pin (which widens the plugin's
  capabilities) and a `caution` security verdict are each a one-time question; a `dangerous` verdict is
  never overridable (`web/src/lib/plugin-update.ts:28-53`). The findings list is severity-sorted and
  capped so a native confirm stays readable.
- **The gateway restart names its blast radius**: "All bots on this device reconnect: default, alpha,
  beta" (`web/src/lib/shared-gateway.ts:16-18`) — an approval that says what else will be affected.
- **Approval record durability:** the decisions here are *state* (approved/pending lists, plugin
  enablement, a dismissed warning key), not an append-only audit log. The closest thing to an audit
  trail is the action-status receipt (`web/src/contexts/SystemActions.tsx:56-73`) and the session
  mutation receipts (`web/src/lib/session-mutations.ts`).
  **Not in this shard**: a durable, queryable approval journal.

**Post-mortem / reflection loops.** Partly here, partly not.
- **The curator is a first-class surface** with a pause toggle and a manual run
  (`web/src/pages/SystemPage.tsx` head imports `CuratorStatus`; `api.getCurator` /
  `api.runCurator` in `web/src/lib/api.ts:1380-1389`). The plugin SDK even names a built-in auxiliary
  slot `curator` — "Skill-usage review" (`web/src/lib/aux-tasks.ts:25`). Whether it *expires* or
  *retires* rules is not in this shard.
- **The "skills" surface carries a security scan per skill** with a severity, a category, a
  `file:line` and a `policy_reason` (`web/src/pages/SkillsPage.tsx` tail; `api.previewSkillFromHub` /
  `api.scanSkillFromHub` in `web/src/lib/api.ts:1443-1447`) — a gate on what may be loaded, not on
  what may be written.
- **What stops bad rules accumulating is NOT in this shard** (the skill lifecycle policy lives in the
  Python side). What this shard shows is the *shape* of a good answer elsewhere: the `MemoryPressureBanner`
  dismissal state machine (a rule is scoped to an episode, escalations re-open it, a confirmed recovery
  clears it) is exactly the shape a rule-expiry/retirement policy needs.

**Multi-agent.** Not a debate engine in this shard. What is here is the *auxiliary-task* model: twelve
named slots (vision, compression, skills-hub, approval, MCP, title-gen, review, voice, triage,
decomposer, describer, curator) each with its own provider+model assignment, plus a MoA (mixture-of-
agents) configuration surface with its own slots (`web/src/lib/aux-tasks.ts`,
`web/src/pages/ModelsPage.tsx`). The interesting discipline is that an **auxiliary slot's assignment
must not leak the main chat model into its header** — a bug that shipped and is now pinned by a test
(`web/src/lib/model-picker-current.ts:3-9`, `web/src/lib/model-picker-current.test.ts`). There is no
debate engine and no subagent-vs-debate comparison in this shard.

**Structured logs the model can query.** The Logs page is a *tail of server-side log files* — three
files (`agent`, `errors`, `gateway`), filtered by level and component, with 50/100/200/500-line windows
and a 5 s auto-refresh (`web/src/pages/LogsPage.tsx`). It is **not** a queryable store. The
queryable-by-the-model surface is elsewhere: `api.searchSessions` runs a **SQLite FTS5** search over
session messages and the page renders the backend's `>>>`/<<<`-delimited snippets with the match
highlighted (`web/src/pages/SessionsPage.tsx` head — `SnippetHighlight`; `web/src/lib/api.ts:916`). The
"trade log" equivalent — a structured, searchable record — is the session store, and it is a real FTS
index, not a JSONL file. The level classifier is a small, well-tested module precisely because the log
tail is text, not structured rows.

**Staying simple as features accumulate.** This shard shows three mechanisms.
- **The plugin surface is the escape hatch**: anything that does not fit a built-in page becomes a
  plugin with a nav slot, a route and a set of injection points — 30 named slots, ten of them
  page-scoped (`web/src/plugins/slots.ts`). The built-in pages therefore do not grow a new tab for
  every idea.
- **Pure helpers are extracted from fat components so the component can shrink.** The comments say so
  explicitly: "Extracted from ChatPage.tsx so the page file can keep shrinking (repo file-size
  ratchet)" (`web/src/lib/terminal-appearance.ts:1-5`), and `api-files.ts` exists because "the facade
  stays under its code-health line cap" (`web/src/lib/api-files.ts:1-3`). A **file-size ratchet** is a
  concrete anti-bloat mechanism: a file that grows past a cap must be split, and the split must be
  into a *tested pure module*.
- **Lanes are kept, not merged.** `ChatSessionList` explicitly refuses to own delete/rename/export
  ("This is a navigation surface, NOT a session-management one … Keeping this panel read-only (plus
  select / new) avoids duplicating that machinery"), and `ConfirmDialog` vs `DeleteConfirmDialog` vs
  the DS `ConfirmDialog` show that even a two-line wrapper is preferred over a second implementation.
- **The cheap-but-deliberate line is the "one owner" rule** (idea 1 above): rather than growing a
  central error-state manager, each surface keeps its own banner with a prefix that says who owns it.

---

## 4. Non-obvious decisions and gotchas

1. **The dashboard does not own the chat.** React renders a *terminal emulator*; the transcript,
   composer and slash commands belong to the Ink TUI running inside the gateway. Reading
   `ChatPage.tsx` as "a chat UI" is the single biggest misreading of this shard
   (`web/AGENTS.md:11-18`).
2. **`?profile=` in the URL is a projection of React state, not the source of truth.** URL-first would
   reset the scope on every bare nav click (`web/src/contexts/ProfileProvider.tsx:29-38`).
3. **The "active profile" (a sticky file) and the "management scope" (the switcher) are different
   concepts**, and a named-profile dashboard must not adopt the former
   (`web/src/lib/profile-bootstrap.ts:44-57`).
4. **The runtime model, not the configured model, is what the UI shows** — a provider fallback swaps
   it mid-turn (`web/src/components/ChatSidebar.tsx:153-176`).
5. **A 401 means two different things** depending on mode: a structured `session_expired` envelope
   means "log in again", while a bare 401 in loopback mode means "the server rotated its token,
   reload once" (`web/src/lib/api.ts:209-257`).
6. **The `?profile=` scope is applied by a PREFIX allow-list.** A route that is not in
   `PROFILE_SCOPED_PREFIXES` is machine-global, and adding a new scoped family means editing that
   list — the silent failure mode is a write landing in the wrong profile
   (`web/src/lib/api.ts:109-161`).
7. **The PTY is in cooked mode, so LF never arrives alone.** A resume filter that matches `\n{50,}`
   would pass its tests and do nothing in production — the test file says this outright
   (`web/src/lib/pty-resume-sanitizer.test.ts:8-19`).
8. **Erase codes are only pathological for 30 seconds.** After that `ESC[K` is how a TUI clears stale
   glyphs, and stripping it forever corrupts the display
   (`web/src/lib/pty-resume-sanitizer.ts:35-48`).
9. **A partial ANSI escape must be DROPPED, not flushed.** Writing one leaves xterm's parser
   in-escape and swallows all subsequent output (`web/src/lib/pty-resume-sanitizer.ts:143-152`).
10. **A terminal font that loads late leaves the grid with fallback metrics**, and xterm only
    re-measures on a *changed* `fontFamily` — hence the bounce through `"monospace"`
    (`web/src/lib/terminal-font-refit.ts:60-64`).
11. **xterm's WebGL addon leaks GL contexts** (it never calls `loseContext`), and the browser caps
    live contexts at ~16, so a reconnect storm eventually kills the *current* terminal's context
    (`web/src/lib/xterm-webgl-release.ts:5-15`).
12. **Safari's WebGL atlas mangles box-drawing glyphs**, and software rasterizers succeed at
    `getContext("webgl")` then throw from inside the addon — so a "does WebGL work?" check must
    inspect the *renderer string*, not just the context
    (`web/src/lib/xterm-webgl-gating.ts:10-20`).
13. **The first-frame rule for the resume wait notice** keys off the *rendered* chunk, not the raw
    frame — the sanitizer collapses an erase-only frame to `""`
    (`web/src/lib/pty-resume-loading.ts:36-41`).
14. **The reconnect budget lives in a ref, and only a stable connection refills it.** A
    closure-local counter resets on every rebuild, so the ladder never exhausts
    (`web/src/components/ChatSidebar.tsx:150-152`).
15. **The chat tab's PTY must not open until the tab has been visited once** — otherwise loading
    `/sessions` runs the TUI's `npm install` (`web/src/lib/chat-activation.ts:3-13`).
16. **A plugin may own `/chat`, and the manifests arrive asynchronously** — so the built-in chat host
    must wait for the plugin list before mounting, or it spawns a PTY and is then yanked away
    (`web/src/App.tsx:381-408`).
17. **`window.confirm` is still the approval surface for plugin updates** (`web/src/lib/plugin-update.ts:30`)
    — a deliberate simplicity choice, and a visible one.
18. **The dashboard has TWO confirm-dialog implementations** (a local `ConfirmDialog` and the DS
    `ConfirmDialog`) and a `DeleteConfirmDialog` wrapper — an inconsistency, not a design.
19. **The `Translations` interface's optional keys are the fallback mechanism**, so "not yet
    translated" is a compile-time-legal state rather than a missing-key crash
    (`web/src/i18n/types.ts:113-131`).
20. **The font override is a curated catalogue because the URL is injected as a `<link>`** — a
    free-text font URL would be a self-XSS / SSRF footgun (`web/src/themes/fonts.ts:8-20`).
21. **`vitest` pins `NODE_ENV=development`**, because React 19 ships `act` only in its development
    build and an inherited production env makes every `createRoot` test fail
    (`web/vitest.config.ts:34-48`).
22. **`@font-face` must be imported BEFORE the design system's `globals.css`**, or the DS font
    variables resolve to families the browser never loads and every component looks unstyled
    (`web/src/index.css:1-10`).
23. **`xterm` has exactly ONE custom key handler.** A second registration silently replaces the first —
    xterm stores one, so a well-meaning addition can break the clipboard handler
    (`web/src/pages/ChatPage.a11y.test.tsx`).
24. **The docs iframe forces `color-scheme: light`**, because Docusaurus paints over a transparent
    `<html>` and relies on the browser's canvas colour, which would otherwise make its light-canvas
    text invisible on the dark dashboard (`web/src/pages/DocsPage.tsx:41-52`).
25. **Copy is a two-path operation** — the Clipboard API only in a secure context, plus a
    selection-based `execCommand` fallback that restores the user's selection
    (`web/src/lib/clipboard.ts`).

---

## 5. Weak spots

1. **`api.ts` is a 2 779-line god-facade with 171 methods**, already under a line-cap ratchet that has
   forced several extractions. The profile-scoping rule lives inside it as a prefix allow-list, so a
   new route that is *not* in the list silently becomes machine-global — a fail-open default for the
   most dangerous class of bug in the system (`web/src/lib/api.ts:109-175`).
2. **The i18n layer is a 21-file, ~600 KB translation burden** for a dashboard whose users are
   overwhelmingly English-speaking; the optional-key fallback is a good mitigation but the surface
   area is now a permanent maintenance tax (`web/src/i18n/`).
3. **There are two confirm-dialog implementations** and two "load error" conventions (a toast in some
   places, the persistent `LoadErrorNotice` in others); the "one owner per banner" discipline is
   excellent but the ownership map is implicit in string prefixes rather than typed
   (`web/src/components/ConfirmDialog.tsx`, `web/src/lib/dashboard-modal-shell.ts`).
4. **The reconnect/keepalive machinery is elaborate and lives in the browser, not the server.** A
   15-attempt ladder, a 10 s flapping grace window, a ticket timeout, a connecting timeout, a
   keepalive resize frame, a resume sanitize window, a WebGL context budget, a Web-Lock attach token
   and an IME dedup forwarder are all needed because the transport is a PTY over a WebSocket — the
   complexity is a direct consequence of the architecture, and it is paid in the client
   (`web/src/lib/pty-*.ts`).
5. **The `ChatPage.tsx` file is 2 073 lines of orchestration** — it wires ~25 helper modules and
   keeps ~25 refs. It is already being dissolved into `lib/`, but the page itself remains the
   integration point for every terminal quirk, which is where the next regression will land.
6. **The plugin SDK is marked "STATUS: spike"** and its open questions are unresolved (published
   package or in-repo? runtime version assertion? exact per-component prop types?). The surface already
   exposes the whole React core and the API client to third-party bundles
   (`web/src/plugins/sdk.d.ts:30-44`).
7. **The dashboard renders the real terminal, so the transcript is not inspectable as structured
   data** — the model must be queried through the session store and FTS instead. That is a defensible
   trade, but it means no surface in this shard can show "what did the agent do" as rows.
