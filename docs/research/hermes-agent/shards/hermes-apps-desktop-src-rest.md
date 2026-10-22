# hermes-agent :: hermes-apps-desktop-src-rest

**Files in shard:** 1975 (read: 1964, skipped with reason: 11 — the binary `assets` tier and one generated JSON gap-map)
**What this shard covers:** the entire Electron/React **desktop renderer** of the Hermes agent
(`apps/desktop/src`): the canonical JSON-RPC wire adapter and REST client, the nanostore state
layer, the assistant-ui transcript surfaces, the Bot Mode plugin (multi-bot groups, relay, cron),
the plugin/SDK contribution runtime, the i18n bundles, the theme engine, and the pane/tree layout
engine. It is the *client half* of a harness: the agent loop, tool execution, memory and skill
lifecycle live in the Python backend; this shard is where those facts are **rendered, gated,
reconciled and recorded**.

**How this shard was read (so the ledger can be trusted).**
- **Read in full** (byte-for-byte, `Get-Content -Raw`): the 14 `api/` source files, `AGENTS.md`,
  the three READMEs, `lib/chat-runtime.ts`, `lib/inflight-turn-journal.ts`,
  `lib/chat-messages/reconciliation.ts`, `lib/execution-authority.ts`, `lib/todos.ts`,
  `lib/tool-result-summary.ts`, `lib/gateway-liveness-policy.ts`, `lib/log-search.ts`,
  `components/chat/log-search.tsx`, `components/assistant-ui/tool/approval.tsx`,
  `store/approval-mode.ts`, `store/composer-status.ts`, `plugins/hermes-bots/cron.tsx`,
  `store/connections.ts`, `store/connection-request.ts`, `store/composer.ts`,
  `store/composer-queue.ts`, `store/coding-status.ts`. These are the Tier-1 entries below.
- **Structural read** (every remaining file): the file's own leading doc-comment block, its
  exported symbol list, and — for test files — its `describe`/`it` names were extracted and
  read. That is a genuine read of each file's *meaning* (Hermes source files carry their
  contract in the header comment), but it is **not** a line-by-line read of every body. The
  per-file note in the status TSV says which method was used for each file.
- **Not read** (skipped, with a reason in the TSV): 10 binary `assets` (3 JetBrains Mono
  `.woff2`, 2 catalog `.svg`, 4 tier `.webp`, 1 pet `.png`) and
  `i18n/overlay-gaps.json` (136 KB generated key→locale gap map). Their size, name and head
  were confirmed on disk; their bytes were not parsed.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `apps/desktop/src/AGENTS.md` — the desktop's constitution
- **Purpose:** the engineering contract for `apps/desktop/src`, layered on the root and
  `apps/desktop/` guides.
- **What it decides (and why it is worth stealing):**
  - **One multiplexing gateway owner per home.** The app never spawns `hermes serve --port 0`
    children and never acquires the gateway PID as an owned child; it calls
    `hermes gateway ensure --json`, consumes the credential-free endpoint, and authenticates
    WebSockets with fresh one-use private control tickets. *Closing or switching a Desktop
    connection disconnects the viewer; only explicit gateway lifecycle commands stop the owner.*
    Every lifecycle/status/settings REST call carries `?profile=`, and every new-session tile
    records an **owner route** (`AGENTS.md:8-27`).
  - **Native tickets are one-use, window-bound, and removed from the URL** before the WebSocket
    is constructed; they ride as a subprotocol, never as a query token (`AGENTS.md:20-25`).
  - **Slash-command discovery and execution are two different gates.**
    `isDesktopSlashCommand(name)` gates *execution* (true for built-ins **and** any non-built-in
    so a typed skill/quick command runs); `isDesktopSlashSuggestion(name)` gates *discovery*.
    The rule is explicit: *palette curation hides noise, NEVER user-activated extensions* — the
    allow-list "once silently dropped every skill/quick command from completions even though
    they executed when typed" (`AGENTS.md:44-52`).
  - **Bot Mode identity is a NAME, not a pointer.** A bot is a profile; its chat is the session
    titled exactly `"Bot Chat"`, resolved by a UNIQUE(title) registry lookup **every time**.
    *There is no session-id pin* — the old design stored a pointer in `ui_meta['hermes-bots'].chat`
    and five hardening waves each guarded a new way it dangled or was stolen. *Recency must never
    win* (`AGENTS.md:56-78`).
  - **Free-tier surfaces** have a ruled branch order (`billing.free_tier_account` before
    `logged_in`) and ruled copy: never "guest", "anonymous", "claim" or "Nous Portal" in
    user-facing text (`AGENTS.md:80-88`).
- **Why it matters:** this is the closest thing in the repo to a constitution, and it is written
  as *invariants plus the bug that taught them*. Rare and very stealable.

#### `apps/desktop/src/api/canonical-protocol.ts` (755 lines) — the CAS wire adapter
- **Purpose:** the renderer-side adapter that turns legacy Desktop RPC calls into the **canonical**
  `hermes-gateway-v1` contract, and refuses anything the canonical owner does not serve.
- **Key abstractions:**
  - `CanonicalDesktopProtocol` — a *stateful* protocol object holding, per `(profile, session)`
    owner key: `revisions` (CAS), `generations` (execution identity), retained `mutations`,
    `prompts` (open approval/clarify cards), `unknownAdmissions`, `modelConfirmations`
    (`canonical-protocol.ts:224-260`).
  - `canonicalSessionKey(sessionId, profile)` — the **owner key**: `JSON.stringify([profile, id])`.
    Everything (revisions, generations, retained mutations) is scoped by it.
  - `recordCanonicalOwner` / `canonicalOwnerProfile` — a `WeakMap` of *authenticated* owner
    provenance. A JSON-RPC payload's ordinary `profile` property cannot impersonate it
    (`canonical-protocol.ts:31-36`).
  - `observeCanonicalAdmissions` — every `prompt.submit` from any surface reports its accepted
    admission here, so "the composer, an edit, Quick Entry and bots" are one event stream
    (`canonical-protocol.ts:12-18`).
- **Data flow:** `prepare(method, params)` → `preparePayload` → `prepareMutation` builds a
  *retained mutation* → `wire(method, prepared)` maps the verb onto the wire (`session.mutate`,
  `session.resume`, …) → `result(method, params, value)` adopts the owner's revision and rewrites
  the receipt into the legacy shape → `settle()` performs a follow-up request (compress → resume)
  inside the caller's deadline.
- **Non-obvious decisions:**
  - **Retained mutations.** A metadata edit carries `expected_revision` and is *retained* until
    acknowledged. An exact retry re-sends the **same `request_id`**, so the owner resolves it as a
    retry rather than a second edit. A *typed* refusal retires it; an *ambiguous transport failure*
    keeps it, because the outcome is unknown (`canonical-protocol.ts:329-350`).
  - **Derived mutations** (a typed `/undo` or `/retry` that derives its target from a snapshot)
    are keyed by **operation alone**, not by payload, so a retry after a lost reply re-presents the
    *original* target and never re-derives from a transcript the first attempt already rewound
    (`canonical-protocol.ts:311-320`, `:381-390`).
  - **Retirement rules.** `retireMutations` keeps only the session's *very next* control; a
    `prompt.submit` retires the session's retained controls; an acknowledged revision R retires
    every *older value-setting* mutation (rename/archive/model/reasoning/workspace) but **not**
    branch/compress, because a new request id there would execute a second time
    (`canonical-protocol.ts:414-437`, `:634-651`).
  - **Model confirmation tokens.** A guarded model target (cost/data-policy/large-context) is
    answered `confirmation_required` with a one-time token. The token is stored *unsent*; the
    user's confirmed resend presents it. While the outcome of a confirmed request is unknown, any
    retry of the same target re-sends the **exact same token-bearing request**; a typed refusal
    replaces it with an unsent token so it is never auto-confirmed
    (`canonical-protocol.ts:246-260`, `:597-625`).
  - **Admission fence.** `prompt.submit` without `submission_id` gets a fresh UUID — "an
    identityless producer is a fresh send on every call" (`canonical-protocol.ts:213-215`).
  - **Unknown admissions.** A turn the authority recovered as `unknown` (owner died mid-turn) may
    only be acknowledged with *the generation the authority stamped*, never the live one
    (`canonical-protocol.ts:246-249`, `:713-724`).
  - **Rewind vs submit.** The legacy `prompt.submit` truncation keys are split into a fenced
    `session.rewind` mutation + a plain submit. A non-durable target (message id / ordinal) is
    **refused**, not guessed: "This message is not saved yet; wait for it to settle"
    (`canonical-protocol.ts:145-175`).
  - **Closed config key set.** `config.set` accepts only 12 keys; a `scope` on a key without one
    is refused *before the wire* with a human message, not a bare `invalid_params`
    (`canonical-protocol.ts:196-208`).
  - **Session verbs the sidecar owns** (`handoff.*`) and **session-owned connector calls** outside
    the owner's 4 verbs are refused by name (`canonical-protocol.ts:181-194`).
- **Edge cases & failure handling:** `retryableFence` retries a fence refusal **once** at the
  owner's fresh fences, and only for idempotent value picks (`model`, `reasoning`) — never for a
  shared-metadata CAS edit (`canonical-protocol.ts:281-290`). A refusal's revision/generation is
  adopted **monotonically** (an older refusal arriving late never moves the fence backwards).
  `adoptEventRevision` does the same for `session.updated` broadcasts from a second viewer
  (`canonical-protocol.ts:726-741`).
- **Surprising:** `session.activate` is rewritten to `session.resume` on the wire (the warm-cache
  re-attach), and `session.resume`'s legacy `lazy` flag is *dropped* and replaced with
  `omit_messages: false` — "the owner holds the agent; nothing to defer"
  (`canonical-protocol.ts:298-307`).

#### `apps/desktop/src/api/client.ts` (37 KB) — the one transport + the scope registry
- **Purpose:** `HermesGateway extends JsonRpcGatewayClient` — the single WS transport — plus the
  **request-scope registry** that decides which `(connection, profile)` backend every REST call
  lands on.
- **Key abstractions:** `HermesGateway` — overrides `connect`, `request`, `on`, `onAny`,
  `onRequest`, `close`. Scope helpers: `profileScoped`, `capabilityScoped`, `connectionScoped`,
  `ownerScoped`, `resolveOwnerNow`, `hermesApiAs`, `sessionReadOwnerPin`, `profileScopeKey`.
  `$apiRequestScope` — a nanostore `{ profile, connectionId }`, pushed into `api/` from the
  store so `api/` never imports the store (cycle avoidance) (`client.ts:487-505`).
- **Non-obvious decisions:**
  - **Three timeout tiers, each justified:** `STARTUP_REQUEST_TIMEOUT_MS = 60s` (the boot burst of
    read-only calls on a busy/remote backend), `DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS = 30s`
    (interactive), and `PROMPT_SUBMIT_REQUEST_TIMEOUT_MS = 1_800_000` (30 min) because
    `prompt.submit` is *fire-and-forget* — the turn is signalled by stream events, not by the RPC
    return, and a 30s bound produced a false "request timed out" toast while the turn was still
    running (`client.ts:20-38`).
  - **Canonical prompt events are delivered as server *requests*.** The renderer only understands
    server→client requests, so an `approval.request` / `clarify.request` **event** is re-shaped
    into a `ServerRequest` whose `respond` issues the RPC (`client.ts:40-46`, `:139-196`).
  - **A declined card is re-showable.** `fail()` deletes the dedup entry so the next authoritative
    snapshot that still lists the prompt shows it again; only *answered* prompts stay deduplicated
    (`client.ts:180-192`).
  - **Lost replies are never resent from a cached event.** `recoverCanonicalPrompt` re-reads the
    authoritative snapshot instead (`client.ts:198-211`).
  - **Ambiguous session identity is parked, not guessed.** When a frame cannot choose between
    equal stored session ids in two profiles, the client issues one `session.resume` probe per
    known owner and **parks** the frame's delivery until a probe answers; if no owner answers, the
    epoch is un-reconciled so a later frame probes again (`client.ts:281-321`).
  - **Per-transport attachments.** A session subscribed over *this* socket must be resumed on this
    socket before it may submit or respond (`client.ts:373-403`).
  - **`profileScopeKey`** — the cache key for a capability scope is `connectionId::profile` for
    **any** explicit pin, `'local'` included, because a remote registry primary makes the ambient
    path remote; sharing a bare-profile cache row painted one machine's config under another's
    scope (`client.ts:634-646`).
  - **`sessionReadOwnerPin`** — a session read is pinned to the connection that *owns* the row, so
    it does not ride the window's ambient connection onto a host that answers 404
    (`client.ts:660-686`).
  - **Native dial tickets.** The `ticket` query param is *deleted* before the WebSocket is built
    and carried as a subprotocol instead (`client.ts:441-456`).
- **Edge cases:** `close()` bumps `connectionGeneration`; every in-flight request then fails with
  "connection changed; reopen the session" rather than answering on a dead socket
  (`client.ts:198`, `:404-406`).

#### `apps/desktop/src/api/sessions.ts` (29 KB) — the transcript and mutation surface
- **Purpose:** the REST surface for session enumeration, transcript paging and every session
  mutation.
- **Key abstractions:** `listSessions`, `listAllProfileSessions`, `listSidebarSessions`,
  `mutateSessionFenced`, `getLatestSessionMessages`, `getOlderSessionMessages`,
  `getAllSessionMessages`, `fetchStoredTranscriptAcrossBackends`.
- **Non-obvious decisions:**
  - **Pinned rows survive the page window.** The backend back-fills pinned conversations past its
    LIMIT; a plain `slice(0, limit)` throws them away again, which is why "pins silently stopped
    rendering past some count" (`sessions.ts:70-84`).
  - **Batched sidebar slices.** One `/api/profiles/sessions/sidebar` call opens each profile's
    `state.db` once instead of three calls re-opening and re-counting every DB per refresh
    (`sessions.ts:148-166`).
  - **Capability detection is sticky.** A 404 on the batched route (route-level, no path params,
    so it cannot be a bad id) sets `sidebarBatchEndpointMissing` and every later refresh is served
    by the proven per-slice path — until `resetSidebarBatchCapability()` is called on a gateway
    switch (`sessions.ts:216-230`, `:305-330`).
  - **The order-echo guard.** A backend built before the `order` param silently drops it
    (FastAPI ignores unknown query params) and serves the *oldest* page while still returning a
    `pagination` object — a full page then looked like a truncated tail and the transcript became
    its first N rows. Only a page that **echoes `order: 'latest'`** may be adopted as the tail
    (`sessions.ts:445-470`).
  - **Fenced mutations.** `mutateSessionFenced` uses a *route-level verdict* from a
    `mutation-snapshot` read — a session/profile 404, refusal, conflict, timeout or failed write
    keeps the canonical CAS path; only "route missing" selects the unfenced base write
    (`sessions.ts:342-368`).
  - **Cross-backend stored-transcript probe is safe** because a REST read of a backend's own
    `state.db` is side-effect free (a miss is a plain 404; no session is minted or resumed
    anywhere) (`sessions.ts:497-534`).
  - **`includeCompacted: true` on every transcript read** — durable display history must include
    rows preserved by in-place compaction, or the transcript silently ends at the compaction
    boundary and earlier turns are unreachable (`sessions.ts:441-444`).
  - **A safe-load limit** on the full-transcript walk: 32 M chars, then a refusal that points at
    the Web Dashboard export (`sessions.ts:587-606`).
  - **Source filtering** (`source: 'cron'`, `excludeSources`) exists because "a burst of
    (always-newest) cron sessions consumes the whole recents page and starves real conversations"
    (`sessions.ts:142-146`).
- **Edge cases:** `sessionWriteProfile` — "unnamed means *the profile I am looking at*", not
  "whatever home the backend was launched in" (`sessions.ts:47-53`).

#### `apps/desktop/src/api/config.ts` (11.8 KB) — the read→write origin binding
- **Purpose:** config/env/provider/OAuth REST calls — and the **read→write origin binding** that
  keeps a write going home to the machine that served the read.
- **Key abstractions:** `bindConfigReadOrigin` / `peekConfigReadOrigin` / `retainConfigReadOrigin`
  (WeakMap + WeakSet), `resolveConfigWriteScope`.
- **Non-obvious decision:** a GET binds its `(connectionId, profile)` to the returned record; the
  matching write routes back there even after the registry primary changed. A captured origin is
  **spread, not rebuilt**, because re-running `capabilityScoped` would stamp
  `priority: 'foreground'` onto an ambient origin that never carried it — the two branches must
  yield the same tag for the same read (`config.ts:88-120`).
- **Surprising:** `/api/config?include_defaults=false` and `?preserve_language=true` are the two
  quiet flags that keep a save from clobbering unrelated state.

#### `apps/desktop/src/api/cron.ts` (6 KB) — the scheduled-work REST surface
- **Purpose:** the cron job REST surface (list/get/create/update/pause/resume/trigger/delete) plus
  the **Automation Blueprint** gallery.
- **Non-obvious decisions:**
  - **The trigger endpoint waits for the whole job** so the response reflects the persisted
    execution result — so its timeout is 24 h, kept local to that one endpoint rather than
    weakening every API timeout (`cron.ts:15-19`).
  - Cron jobs live in `<HERMES_HOME>/cron/jobs.json` **per profile**; the list endpoint defaults to
    `'all'`, so a concrete profile key must be passed to list one profile's jobs
    (`cron.ts:21-32`).
  - **Run rows are stamped with the owning connection.** A cron run is a backend session like any
    other; without the tag, clicking a run over SSH/remote fell to the ambient id-only resume and
    the transcript never loaded (`cron.ts:46-67`).
  - **`getCronDeliveryTargets` is the single source of truth for delivery targets** — the manual
    editor and the blueprint dialog both use it so they never offer a platform that isn't
    connected (`cron.ts:69-82`).
- **Trading relevance:** this is Hermes' scheduled-work surface. It is *server-side*; the desktop
  is a client of it.

#### `apps/desktop/src/api/plugins.ts` (10 KB) — the plugin REST + WebSocket door
- **Purpose:** the **plugin REST + WebSocket door**, scoped by construction to one plugin's
  namespace.
- **Non-obvious decisions:**
  - **The namespace IS the boundary.** `path` is relative to `/api/plugins/<pluginId>`, and a
    `..` segment is rejected before the request is built (`plugins.ts:57-70`, `:88-105`).
  - **`MAX_REFUSED_PLUGIN_DIALS = 5`.** A refusal that does not clear by itself stops the ladder —
    every attempt is gateway traffic that keeps an idle-exit gateway awake (`plugins.ts:107-109`).
  - **A generation counter scopes every async step**, so a lookup, backoff timer or socket started
    under an older `(connection, profile)` is dropped and never counts as a refusal
    (`plugins.ts:143-152`).
  - **Full-jitter exponential backoff** (`reconnectBackoffDelayMs(attempt, {baseDelayMs: 500,
    capMs: 30_000})`) — an immediate-retry loop across many clients floods the gateway during a
    restart (`plugins.ts:166-181`).
  - **Only a socket that stayed up resets the ladder.** An accept-then-close server (Kanban on an
    archived board) is "up and answering", so it counts as a *refusal*, not a success
    (`plugins.ts:213-227`).
  - **Every consumer must have a polling fallback**, because a socket can drop and the browser
    cannot tell a refused upgrade from a gateway that is restarting (`plugins.ts:126-133`).

#### `apps/desktop/src/api/messaging.ts` — human-in-the-loop approval, worth stealing
- **Purpose:** messaging platforms (Telegram et al.), **Telegram QR onboarding**, **pairing** and
  **webhooks**.
- **Non-obvious decision (human-in-the-loop):** an unknown DMer gets a one-time code and lands in
  `pending` until an admin approves. **Approval grants on the row's `request_id`, never on the
  code** — the code is the requester's proof that the channel is theirs and is never returned by
  the API, while an authenticated admin is only ever identifying a row they can already see
  (`messaging.ts:118-150`).
- **Edge case:** the Telegram pairing state lives in the memory of the backend process that started
  it, so every call in one flow must carry the **same** profile scope or the apply 404s
  (`messaging.ts:56-64`).

#### `apps/desktop/src/api/models.ts` / `profiles.ts` / `local-models.ts` / `mcp.ts` / `skills.ts` / `toolsets.ts` / `system.ts`
- `api/models.ts` — model info / options / recommended default / MoA. `MODEL_INFO_REQUEST_TIMEOUT_MS
  = 5s`: `/api/model/info` probes the provider's `/models` endpoint, and an unreachable provider
  must not hold the Model Settings page hostage (`models.ts:17-25`).
- `api/profiles.ts` — profile CRUD + SOUL read/write + archive import/export. `deleteProfile`
  refuses the name `default` client-side (`profiles.ts:44-57`). The export/import pair carries a
  `desktop.json` appearance overlay inside the tarball so a profile can carry its own look
  (`profiles.ts:86-118`).
- `api/local-models.ts` — the managed llama.cpp runtime: status, hardware probe, catalog,
  download/install/activate jobs, HF search, sideload, server start/stop. Download jobs are
  **pausable/resumable** and a `false` flag (no live download handle) is reported to the caller
  rather than treated as success (`local-models.ts:104-122`).
- `api/mcp.ts` — MCP server test/enable/catalog-install. `saveMcpServers` **replaces** the whole
  map instead of deep-merging, so deletes, re-enables and removed nested fields persist
  (`mcp.ts:60-70`). `mcpOAuthRpc` captures the source **before the first await** so a foreground
  switch cannot move an OAuth tail to another backend (`mcp.ts:74-86`).
- `api/skills.ts` — skills list, raw `SKILL.md` content, enable toggle, the **star map**
  (`/api/learning/graph` — the REST contract keeps the old path even though the UI renamed the
  feature, "renaming this would break against an un-upgraded backend"), learning-node
  read/edit/delete, and the skills hub (official catalog, sources, search, preview, scan,
  install, uninstall, update) (`skills.ts:41-54`).
- `api/toolsets.ts` — toolsets, per-capability provider selection, terminal backends, and the
  computer-use permission grant. `selectToolsetProvider` can answer `needs_nous_auth` + `feature`,
  so the row "won't activate until the user signs in" is data, not a special case
  (`toolsets.ts:75-104`).
- `api/system.ts` — memory provider config/OAuth, memory status/reset, the **curator**
  (`getCuratorStatus`, `setCuratorPaused`, `runCurator`), gateway restart, self-update, action
  status, and the audio surface. Two **content-sized timeouts** are derived from the payload
  (`audioSpeakRequestTimeoutMs`: 35 ms/char clamped to [180 s, 600 s];
  `audioTranscribeRequestTimeoutMs`: 0.1 ms/char) because a remote TTS/STT round-trip regularly
  exceeds the default 15 s (`system.ts:29-62`).

#### `apps/desktop/src/lib/inflight-turn-journal.ts` (38 KB) — a crash-survivable turn journal
- **Purpose:** while a session is busy, the visible tail of the running turn (user prompt +
  streamed assistant rows, tool calls included) is persisted to `localStorage`. If the renderer or
  the whole app dies mid-turn, session resume folds the journaled tail back onto the restored
  transcript, so streamed progress is not silently lost. The backend's own `inflight` snapshot
  covers reconnects while the backend is alive; this journal covers the cases where the backend
  died too — and it is richer, because the backend snapshot carries text only while the journal
  keeps the full part structure.
- **Key abstractions:** `persistInFlightTurnState` / `readInFlightTurnJournal` /
  `recoverInFlightTurnJournal` / `clearInFlightTurnJournal` / `migrateInFlightTurnJournal` /
  `purgeInFlightTurnJournals`; `mergeInFlightMessages(baseMessages, tailMessages, {keepPending})`
  returns `{applied, caughtUp, messages, streamId, turnStartedAt}`.
- **Non-obvious decisions:**
  - **A trailing-edge throttle of 400 ms** on the write path: streaming repaints arrive every
    ~33 ms and `localStorage` writes are synchronous, so a crash costs at most 400 ms of the
    newest tail (`inflight-turn-journal.ts:41-43`).
  - **A bounded namespace**: `MAX_SESSION_STORE_CHARS = 4 MiB`, `MAX_ENTRY_CHARS = 160 KiB`,
    `MAX_ENTRIES = min(24, budget/entry)`, `MAX_AGE_MS = 7 days`. The namespace is swept **once**
    on first access, never on the 400 ms write path.
  - **Tool payloads are reduced to identity.** A tool result can be multi-megabyte; recovery only
    needs invocation identity and failure state, so `args`/`result` are replaced with `{}`
    (`boundedPart`).
  - **A pathological prompt skips journaling rather than weakening the match.** The user text and
    attachment refs are the recovery *join key*; truncating either could attach a journal tail to
    the wrong transcript row (`boundedMessages`).
  - **A tombstone (`'0'`) suppresses a stale v1 predecessor** until the one-shot migration removes
    the aggregate. A quota failure writes a tombstone rather than leaving a misleading older
    snapshot behind (`tombstoneUnlessRecoverable`).
  - **Copy first, delete second on a key migration.** A crash between the two writes leaves BOTH
    keys holding the same recoverable tail — resume folds either one — whereas deleting first
    would trade recovery for a crash window (`migrateSnapshot`).
  - **The journal is re-keyed when a session's stored id rotates** (auto-compression forks a
    continuation), so a mid-lineage tip cannot strand a journal key that a later delete can no
    longer reach (`migrateInFlightTurnJournal`).
- **Edge cases:** `mergeInFlightMessages` distinguishes *caught up* (the base transcript already
  contains the journaled turn's completed reply — the journal is stale and is cleared) from
  *applied*; it refuses to append a duplicate id (assistant-ui's `MessageRepository` throws on a
  duplicate key); and when the journal carries structure, only a *strict extension* of the answer
  text is accepted from the backend projection, because "a longer flat dump that starts with
  thinking chatter must not overwrite / insert as answer text".

#### `apps/desktop/src/lib/chat-messages/reconciliation.ts` (20 KB) — reconciling a live transcript with a durable one
- **Purpose:** when the app refreshes a transcript from the backend, the local (optimistic) rows
  and the durable rows are two different truths. This file merges them without losing an error the
  user must see, and without duplicating a row.
- **Key abstractions:** `preserveLocalAssistantErrors(nextMessages, currentMessages)`,
  `preserveLocalSystemNotices`, `spliceOlderPreservedRows`.
- **Non-obvious decisions:**
  - **Matching is anchored, never content-global.** "Text and provider tool-call ids are not
    globally unique, so the match is deliberately anchored to the last visible user turn on both
    timelines" (`tailTurnAssistantMatchIndex`).
  - **A failed tail turn is folded onto the durable twin, not appended.** A rowId-less errored
    attachment turn cannot be matched by rowId; the preceding local user row's caption, compared
    tolerantly against every hydrated user row, still names the turn
    (`attachmentTurnAssistantMatchIndex`).
  - **Two identical pastes are paired by ordinal, not by first match.** "Two pastes of the SAME
    captioned screenshot strip to identical tolerant captions — so a first-match fold pairs the
    second paste's error with the FIRST paste's settled reply. The pastes are ordered, so pair
    them by position: the n-th local captioned paste names the n-th stored one" (#122079).
  - **Older preserved runs are spliced *in front of* the first newer hydrated row**, not appended
    at the tail, when every row in the run carries a rowId older than every hydrated rowId
    (`spliceOlderPreservedRows`).
  - **Local `system` notices are re-grafted** because a refresh rebuilds from stored rows, which
    never carry them, so the fallback-switch notice vanished on the next refresh (#126422).
- **Why it matters for August Trading:** this is exactly the "the durable record and the live UI
  disagree" problem a trade log has (a plan the user edited on screen vs the plan that was
  written). The pattern — *anchor the match, pair ambiguous repeats by ordinal, keep the local
  error visible, splice by row id* — is directly transferable.

#### `apps/desktop/src/lib/execution-authority.ts` — the epoch/generation fence
- **Purpose:** decides whether a lifecycle frame (`session.info`, `message.start`,
  `message.complete`, `message.error`) belongs to the current execution or is a late frame from a
  previous one.
- **Key abstractions:** `acceptExecutionEvent(authorities, key, type, event)`; a frame carries
  `authority_epoch` (opaque) and `execution_generation` (integer).
- **Non-obvious decisions:**
  - **Epochs are opaque identities, never ordered.** The fence keys on the epoch's *string* form.
  - **Output may follow the current owner but cannot establish another one.** A non-lifecycle frame
    is accepted only if it carries the current epoch+generation and that execution is not terminal.
  - **Only an owner snapshot/start can establish a new epoch**, not a late finalizer.
  - **An admission-only frame is never a lifecycle** — "a queued row's cancellation: the owner's
    epoch and the row's admission, no execution generation" — so it never retires an execution.
  - **An unstamped idle snapshot is accepted only if its generation is not older** than the
    current one.

#### `apps/desktop/src/lib/gateway-liveness-policy.ts` — the "don't kill a busy backend" rule
- **Purpose:** a pure decision function for whether one unanswered liveness probe should
  force-close the primary socket.
- **The decision (and why it is a gem):** a ping timeout proves a dead *transport*, but it also
  fires for a live, **busy** backend — a long silent tool call starves the gateway's event loop
  past the 5 s probe budget, and tearing the socket down then interrupted the running turn into a
  bare "Operation interrupted." placeholder. So: *while ANY session reports working, backend
  silence is EXPECTED*, the first timeout is deferred (one bounded re-probe instead), and only when
  the failure **streak** reaches `LIVENESS_PROBE_FAILURE_STREAK = 2` (the re-probe also went
  unanswered — or no turn is in flight at all) is the socket treated as genuinely dead
  (`gateway-liveness-policy.ts:20-60`).
- **Why it matters for August Trading:** it is the general shape of "do not treat silence as
  failure while work is in flight", and the streak bound stops the opposite failure (a socket
  trusted forever).

#### `apps/desktop/src/lib/tool-result-summary.ts` (10.6 KB) — turning a tool payload into one honest line
- **Purpose:** the heuristic JSON → human summary behind a tool row's default view (the technical
  view still gets the raw JSON).
- **Key abstractions:** `formatToolResultSummary(value)`, `extractToolErrorMessage(value)`.
- **Non-obvious decisions:**
  - **Wrapper keys are unwrapped up to four levels** (`data`, `result`, `output`, `response`,
    `payload`).
  - **A priority key order** (`title`, `name`, `path`, `file`, `url`, `status`, `id`, `message`,
    `summary`, `description`) so the summary line reads like a sentence.
  - **`stderr` is deliberately excluded from the error signal.** "many CLIs emit informational
    lines on stderr (npm progress, git's hint:) that aren't errors. Treating those as error signal
    flipped tool cards into destructive styling for healthy commands."
  - **A failure must be *declared* before nested data is unwrapped to explain it** — "Returned
    data and stdout can describe failures without the tool failing. Only unwrap them to explain a
    failure already declared by the envelope."
  - **A missing result and an empty result are different** (`tool-result-preservation.test.ts`).

#### `apps/desktop/src/lib/todos.ts` — the model's own checklist
- **Purpose:** the `todo_list` tool's durable shape, parsed from a live tool event, a stored
  transcript, or a merge patch, and rendered as a nested tree.
- **Key abstractions:** `parseTodos`, `parseTodoPatch`, `todoTree`, `mergeTodoItems`,
  `nextTodosFromToolEvent`, `latestSessionTodos`, `latestSessionTodoSnapshot`,
  `parseTodoRevision`.
- **Non-obvious decisions:**
  - **The tool was renamed** (`todo_list` on the wire; `todo` survives as the legacy alias in
    stored transcripts) and the reader accepts both.
  - **A `merge: true` write patches by id** so a status-only start event does not wipe the rest of
    the checklist.
  - **A cyclic or dangling parent degrades to depth 0** rather than losing the row, and a
    cycle member that never reaches a root is appended flat so nothing is lost.
  - **Arguments alone are never durable evidence.** `latestSessionTodoSnapshot` only accepts a
    *confirmed* tool result (`unpairedStoredToolResult` disqualifies a part, and the stored result's
    tool name must match).
  - **A revision number is parsed alongside the list** so a poll can tell "the same list" from "a
    new list".

#### `apps/desktop/src/lib/chat-runtime.ts` (20 KB) — the client-side turn state
- **Purpose:** `createClientSessionState` — the whole client-side turn lifecycle as ONE object
  (`busy`, `awaitingResponse`, `streamId`, `sawAssistantPayload`, `adoptedRunningTurn`,
  `interrupted`, `interimBoundaryPending`, `needsInput`, `turnLive`, `usage`, …) — plus the
  normalisation helpers the transcript depends on.
- **Non-obvious decisions:**
  - **The thinking-prefix strip is deliberately narrow.** Only the leading status prefix
    ("Hermes is thinking...") and the obvious placeholder echoes are removed; the delta is **not**
    trimmed, because "reasoning streams as small chunks (often individual tokens with leading or
    trailing spaces), and trimming each chunk before concatenation collapses adjacent words
    together. Whitespace between tokens belongs to the data, not chrome."
  - **A timestamp-less message falls back to *now*, never to a parsed id.** "message ids come in
    incompatible shapes — `assistant-<ms>`, `<seconds>-<i>-<role>`, session-style
    `20260728_184420_…` — and feeding any of them to `new Date()` lands on the 1970 epoch."
  - **Tool-only follow-up messages are folded into their predecessor** (`coalesceToolOnlyAssistants`
    + `concatToolPartsUnique`) so a tool-only assistant message joins the previous message's tool
    group, and a **repeated `toolCallId` is dropped, not renamed** — renaming it would render the
    same call twice, and folding both copies manufactures the duplicate key that crashes
    assistant-ui's `useResources`.
  - **The fold is render-only** (never mutates the store) and **settle-only** (a pending message
    is left alone, so a live turn is never merged/un-merged mid-stream).
  - **Attachment identity is content-derived, not a uuid**, and the value is *normalised* before
    the id is built, so a trailing slash or a `\` separator cannot slip past the exact-match dedupe
    as a "different" attachment.

#### `apps/desktop/src/components/assistant-ui/tool/approval.tsx` (15.5 KB) — the approval card
- **Purpose:** the human-in-the-loop card: a stack of pending approvals, each with Run / Always
  allow / Allow for this session / Reject.
- **Key abstractions:** `PendingApprovalStack` (the transcript-owned host — "Execution rows never
  mount, register or re-home this queue"), `ApprovalQueue` (a swipeable `CardStack`), `ApprovalCard`.
- **Non-obvious decisions:**
  - **"Always allow" goes through a confirm dialog**, because it persists the pattern to
    `~/.hermes/config.yaml` permanently — it is the only choice that writes to disk.
  - **The confirm dialog is mounted one tick later** (`setTimeout(..., 0)`) so the dropdown menu
    fully unmounts before the dialog mounts; otherwise Radix's focus-return races the dialog and
    dismisses it via `onInteractOutside`.
  - **Focus is restored to whatever held it before the press.** "Answering with the pointer moves
    focus onto the card, and the card then unmounts, which parks focus on `<body>` — where
    type-to-focus routes the next keystrokes into the chat composer. For a computer_use flow the
    agent may have just aimed its input at another pane, so the approval hands focus back to
    whatever held it before the press" (#113839). The restore is guarded so it never steals from
    a surface the user moved to while the reply was in flight.
  - **A plugin `approve` rule escalates through the same gate with a synthetic display target**
    (`<tool> (plugin approval rule)`) while the real command lives in `description` — so the
    card shows the description when the command is missing or synthetic; a real command keeps
    rendering as the command.
  - **The answer is re-checked against the store before it is sent** — a request that was already
    answered elsewhere is not answered twice.

#### `apps/desktop/src/store/approval-mode.ts` — the profile-scoped approval policy
- **Purpose:** `manual` / `smart` / `off` approval mode, cached per profile and read/written
  through the gateway's `config.get` / `config.set`.
- **Non-obvious decisions:**
  - **The read/write is profile-scoped, and a blank name IS the launch profile** — so the param
    is *omitted* in that case, "keeping the backend's os.environ / session precedence".
    Without it, "the UI ends up displaying one profile's mode for all of them and a write silently
    edits the launch profile" (#125969).
  - **A revision counter guards every read and write**, so a late response from an older request
    cannot overwrite a newer one; on a failed write the cache **reverts to the last confirmed
    value**, not to the optimistic one.

#### `apps/desktop/src/plugins/hermes-bots/cron.tsx` (44 KB) — the Routines surface (scheduled work)
- **Purpose:** the cron jobs scoped to the bot you are chatting with: the list query and its owner
  resolution, the schedule picker, the create and detail dialogs, and the pane.
- **Key abstractions:** `loadRoutines(owner)`, `selectRoutineJobs(data, error, lastJobs, bot)`,
  `routineFilterHint`, `routineDetailRows(job, c)`, `routineDetailIssue(job)`,
  `routineLastResult(status, c)`, `routinePrompt(bot, title, instruction, activeProfile)`,
  `resolveRoutineOwner`, `RoutinesPane`, `RoutineRow`, `CreateRoutineDialog`, `RoutineDetailDialog`.
- **Non-obvious decisions (all directly relevant to a trading app's scheduled monitor):**
  - **`delivery_failed` must read as a FAILURE, not as a run result the user can trust.** The
    scheduler's `last_status` set is closed on the gateway side and every literal is named: `ok`,
    `error`, `delivery_failed`, `blocked_config`. "delivery_failed means the agent run succeeded
    but the brief never reached its target" — and it is rendered as a failure
    (`routineLastResult`).
  - **An overdue slot is labelled OVERDUE, never promised as a next run.** "A slot parked past
    the scheduler grace is labelled overdue, never promised as a next run (#114309)" — the row
    checks `nextRunOverdueMs(job) !== null` before it will print a next-run time
    (`routineDetailRows`, `RoutineRow`).
  - **The scheduler's own reason is surfaced.** `routineDetailIssue` reads `last_fire_error`,
    `last_delivery_error` and `paused_reason` — "the row only ever showed 'paused'; the
    scheduler's own reason and the last fire/delivery failures had no surface in Bot Mode at all."
  - **The detail rows are pure and drop absent values** — "the dialog cannot invent a field the
    gateway never sent: an absent value drops its row instead of rendering 'undefined'".
  - **A pause failure must not fail the LIST.** Each legacy-routine pause swallows its own error;
    the overlay only claims jobs the gateway actually paused, and the next poll retries the rest.
    Otherwise "the pane would report 'could not load cronjobs' over data that loaded fine, and the
    20s poll would re-attempt the failing pause inside a failing query forever."
  - **A failed refresh keeps the last good list** and shows a "stale" notice
    (`selectRoutineJobs` + `staleNotice`).
  - **An empty pane can be a FILTER, not an absence.** `routineFilterHint` explains "cronjobs are
    present but hidden" when the store has jobs but none are tagged for this bot.
  - **The cross-bot run is a shell delegation, not an API call.** `routinePrompt` builds
    `hermes -p <bot> chat -c 'Routine: <title>' -q '[Scheduled routine] <instruction>'` with
    `shellQuote` escaping, and a `SAFE_ROUTINE_MARKER` prefix — so the run lands in *that bot's own
    history*.
  - **Two delivery targets, chosen by the user:** `history` (the run session only) or
    `bot-chat` (the output is injected into the bot's canonical Bot Chat as a real message, costing
    one agent turn per run) — plus a `continuity: true` flag.
  - **The schedule vocabulary is core's own.** `scheduleLabel` reuses `cron.scheduleLabels.daily`
    / `.hourly` rather than re-translating, and the picker composes a Hermes-native schedule
    string (`every 1h`, `0 9 * * *`).
  - **The owner is captured, not re-read.** `resolveRoutineOwner` fails *closed* when the focused
    owner is authoritative but its exact roster row is absent — "rather than routing cron
    reads/mutations through a stale selection or an unscoped profile name".

#### `apps/desktop/src/store/composer-status.ts` (17 KB) — the one merged "what is running" feed
- **Purpose:** the composer's status stack: one typed, merged list per session of `todo` / `goal` /
  `subagent` / `background` rows, in a fixed render order.
- **Non-obvious decisions:**
  - **Identity is stabilised at two levels.** "This computed's inputs churn constantly during a
    turn … but the merged output for most sessions is unchanged. Rebuilding fresh arrays and item
    objects every time handed every mounted composer stack a new reference per recompute — cross-
    session churn × open tiles." An unchanged session keeps its previous array *and* its item
    objects; a fully-unchanged map keeps its previous reference so `computed` skips the notify
    entirely ("preserve reference identity on no-ops").
  - **Finished background rows self-clear, but at different speeds.** Success lingers 4 s, failure
    12 s "so its exit code stays readable"; a manual X drops either at once. The registry keeps
    finished processes around, so without the dismissal set "every refresh would resurrect a
    dismissed row."
  - **Stopping a background process is confirmed before the row is dropped.** "X on a running row:
    kill the process for real, THEN drop the row. Only drop on a confirmed kill — dismissing
    unconditionally (the old behavior) hid the row while the process lived on, stranding rogue
    tasks. On failure the row stays so the user can retry / see it didn't die."
  - **A rewind kills the live processes** the discarded turns spawned, and marks the ids dismissed
    so an in-flight poll cannot resurrect them.
  - **A gone session stops being polled** — "a gone session never comes back under this runtime id:
    stop polling it, or the 5s timer hammers the gateway with 4001s for the window's lifetime."

#### `apps/desktop/src/lib/log-search.ts` + `apps/desktop/src/components/chat/log-search.tsx` — a queryable log
- **Purpose:** the pure matching behind in-log search (⌘F in the log pane): hit offsets, segment
  cuts, and a severity column.
- **Non-obvious decisions:**
  - **The match runs on the ORIGINAL text with the `iu` flags.** "Lowercasing a copy and slicing
    the original by its offsets drifts whenever case mapping changes length (U+0130 lowercases to
    two code units), so the match runs on the original text instead."
  - **The query is a literal, not a pattern** (`escapeRegExp`).
  - **Severity is read from a fixed column.** `hermes_logging._LOG_FORMAT` puts the level right
    after the timestamp, and anchoring to that column "keeps a message that merely mentions
    'ERROR' from being marked as one."
  - **The cursor is stored with the query it belongs to**, so typing a new query lands on its
    first hit without an effect resetting state.

#### `apps/desktop/src/store/connections.ts` / `connection-request.ts` / `composer.ts` / `composer-queue.ts` / `coding-status.ts`
- `store/connections.ts` (24 KB) — the **gateway switch** as a two-phase commit: *Phase 1* opens
  the target's socket with the active route untouched; *Phase 2* commits inside the activation's
  serialized section. A `switchRevision` counter means a newer click owns the switch from the dial
  onward, so the user never flips through a superseded connection. A failed commit "repaints the
  previous source and lands on a fresh draft there, matching what a failed Settings apply leaves
  behind."
- `store/connection-request.ts` (21 KB) — the **human-in-the-loop connection card** store. The
  state comes only from the backend; the card never sets it. Frames for another operation, or an
  older frame than the one already applied, change nothing — "the transport can reorder them and
  an older one would regress a row." Every field-equal entry keeps the old reference so the row
  does not churn.
- `store/composer.ts` (31 KB) — the composer state: the draft, attachments (with a
  `createComposerAttachmentScope` that owns blob-preview revocation), terminal selections, the
  voice-conversation start latch ("latches each request until the main composer consumes it
  once"), and the fresh-draft key rotation.
- `store/composer-queue.ts` (22 KB) — the **queued prompt** store. Local owner routes use
  canonical admission; remote legacy queues stay local. A queued entry's transport is *frozen* at
  enqueue time so a later re-derivation cannot change what is sent, and a drain claim
  (`withQueueDrainClaim`) keeps two drains from racing.
- `store/coding-status.ts` (19 KB) — the git-status rail. The refresh is **debounced** and
  **sequenced** (`seqByCwd`), so a late probe for an older sequence cannot overwrite a newer one,
  and every structural edge (cwd change, session switch, worktree add/remove, a file-mutating tool
  finishing, a turn settling, window focus) is an explicit trigger rather than a poll.

### Tier 2 — bulk: a compact table, one row per file

The table below is the ledger. Each row's one-liner is derived from the file's own header comment
and its exported symbol list (or, for test files, from its `describe`/`it` names) — the
"structural read" method described at the top of this report. The `api/` REST and wire contract is
tabulated separately in §1.1 so each file appears exactly once.

#### §1.1 `apps/desktop/src/api/` — the canonical wire contract (44 files)

| File | What it is / what it pins |
| --- | --- |
| `apps/desktop/src/api/canonical-ambiguous-owner-reconcile.test.ts` | A failed owner reconciliation is re-probed by the next frame; a prompt declined locally is shown again while the authority still lists it. |
| `apps/desktop/src/api/canonical-attach-snapshot.test.ts` | A cold attach delivers the snapshot prompt and marks the session attached. |
| `apps/desktop/src/api/canonical-bot-relay-deliver.test.ts` | A Bot Relay delivery on a canonical dial carries only owner-admitted keys, sender as a bot author. |
| `apps/desktop/src/api/canonical-clarify-lifecycle.test.ts` | Snapshots expose batch question params without losing already-locked answers. |
| `apps/desktop/src/api/canonical-clarify-prompt.test.ts` | A reopened sibling chat delivers retained questions before returning and replies on its route; the clarify card's lock answers. |
| `apps/desktop/src/api/canonical-create-options.test.ts` | The owner's session-create contract: allowed keys, `service_tier`, `cwd_explicit`. |
| `apps/desktop/src/api/canonical-deadline.test.ts` | The prerequisite attachment shares the caller's deadline and cancellation; a zero timeout means *no* deadline. |
| `apps/desktop/src/api/canonical-live-pick.test.ts` | A composer pick is a session-scoped mutate; a busy session answers `deferred`; a fence refusal is retried once, never looped; an older pick refused after a newer pick committed is not retried; a confirmed resend carries the owner's token. |
| `apps/desktop/src/api/canonical-model-confirm.test.tsx` | The guarded model switch asks; yes applies once with the owner's token; a lost reply retries as the *exact* token-bearing request; a typed refusal spends the token. |
| `apps/desktop/src/api/canonical-producer-contract.test.ts` | The closed key set the canonical producer frame admits (config keys, owned connector verbs). |
| `apps/desktop/src/api/canonical-profile-route.test.ts` | A sibling profile route survives canonical request translation. |
| `apps/desktop/src/api/canonical-prompt-owner.test.ts` | Retained prompts keep their own profile when imported profiles share a stored session id; equal stored ids keep independent revisions/generations/retries; an unanswered prompt is replayed after a lost response. |
| `apps/desktop/src/api/canonical-protocol-wire.test.ts` | Named canonical prompt listeners receive replay-safe ids before answering on the wire; a legacy dial strips canonical-only identity keys; a compress settle resumes under the caller's deadline. |
| `apps/desktop/src/api/canonical-protocol.test.ts` | The whole canonical contract: CAS revision retention, canonical create retry identity, `voice_stopped` as a settled no-admission receipt, admission identity, `session.info` fanout refreshing the CAS revision, the unknown-admission row, the stored-parent branch, the composer model picker, compress preview staying read-only. |
| `apps/desktop/src/api/canonical-reasoning-config-set.test.ts` | Typed `/reasoning` sets the session level through the owner mutation; `--global` reaches the owner. |
| `apps/desktop/src/api/canonical-reconnect-replay-owner.test.ts` | A canonical reconnect replays the retained window to the epoch owner. |
| `apps/desktop/src/api/canonical-retained-control-retire.test.ts` | Another control retires a lost-reply control; a prompt submit retires the session's controls; the immediate retry keeps its identity. |
| `apps/desktop/src/api/canonical-retained-mutation-stale.test.ts` | An acknowledged later edit retires an older retained mutation; a stale-generation refusal retires a retained reasoning mutation. |
| `apps/desktop/src/api/canonical-rewind-lost-reply.test.ts` | A derived rewind whose reply was lost is re-sent, not re-derived; an answered derived rewind is not replayed; a typed refusal lets the repeat derive again. |
| `apps/desktop/src/api/canonical-rewind-redial-profile.test.ts` | A named-profile owner re-presents a lost rewind after a redial. |
| `apps/desktop/src/api/canonical-session-updated-revision.test.ts` | A second viewer adopts the revision from `session.updated`, monotonically. |
| `apps/desktop/src/api/canonical-unknown-admission-fence.test.ts` | A stale `session.info` replay leaves the live Discard action usable. |
| `apps/desktop/src/api/canonical-watch-window-resume.test.ts` | The watch window's legacy `lazy` attach becomes a full transcript read. |
| `apps/desktop/src/api/client.ts` | The one WS transport plus the `(connection, profile)` request-scope registry; three timeout tiers; canonical prompt events re-shaped into server requests. (Tier 1.) |
| `apps/desktop/src/api/config-route-binding.test.ts` | A config record read from A cannot be written to B after the primary changes. |
| `apps/desktop/src/api/config.ts` | Config/env/provider/OAuth REST plus the read→write origin binding. (Tier 1.) |
| `apps/desktop/src/api/cron.ts` | The cron job REST surface + the Automation Blueprint gallery. (Tier 1.) |
| `apps/desktop/src/api/local-models-owner.test.ts` | Delayed local-model reads and controls stay pinned to their captured connection and profile. |
| `apps/desktop/src/api/local-models.ts` | The managed llama.cpp runtime: status, probe, catalog, resumable download jobs, HF search, sideload, server start/stop. |
| `apps/desktop/src/api/mcp.ts` | MCP server test/enable/catalog-install; `saveMcpServers` replaces the whole map; the OAuth RPC captures its source before the first await. |
| `apps/desktop/src/api/messaging.ts` | Messaging platforms, Telegram QR onboarding, pairing and webhooks; approval grants on the row's `request_id`, never on the code. (Tier 1.) |
| `apps/desktop/src/api/models.ts` | Model info / options / recommended default / MoA, with a 5 s budget on the provider-probing `/api/model/info`. |
| `apps/desktop/src/api/plugins.test.ts` | `activeConnection` times out instead of hanging; the plugin socket dials the minted URL (never an empty `?token=`), stays on polling when no URL is minted, retries through an outage, stops after 5 permission refusals, and re-dials on a profile/connection change. |
| `apps/desktop/src/api/plugins.ts` | The plugin REST + WebSocket door; the namespace is the boundary; a 5-refusal ladder; full-jitter backoff. (Tier 1.) |
| `apps/desktop/src/api/profiles.ts` | Profile CRUD + SOUL read/write + archive import/export; `deleteProfile` refuses the name `default`; the bundle carries a `desktop.json` appearance overlay. |
| `apps/desktop/src/api/session-http-mutation-identity.test.ts` | A retained identity on another session survives an acknowledged write. |
| `apps/desktop/src/api/session-transcript-paging.test.ts` | The whole transcript is read instead of adopting the oldest page from a backend that ignores `order`; a passive read stays passive; legacy named-profile routing is preserved while the foreground is local. |
| `apps/desktop/src/api/sessions-mutations.test.ts` | Concurrent equal sidebar edits share the missing-snapshot verdict; a missing route never selects an unfenced retry; sidebar edits fall back to the base write only when the backend lacks the fencing route. |
| `apps/desktop/src/api/sessions.test.ts` | The DELETE/PATCH body carries the **owning** profile; the profile query is omitted when no owner is known; an explicit `local` pin stays routed to the local pool; a scoped session read does not dial foreground. |
| `apps/desktop/src/api/sessions.ts` | Session enumeration, transcript paging and every session mutation; the order-echo guard; fenced mutations. (Tier 1.) |
| `apps/desktop/src/api/skills.ts` | Skills list, raw `SKILL.md`, enable toggle, the star map (`/api/learning/graph`), learning-node edit/delete, and the skills hub. |
| `apps/desktop/src/api/system.ts` | Memory provider config/OAuth, memory status/reset, the curator, gateway restart, self-update, action status, and the audio surface with content-sized timeouts. |
| `apps/desktop/src/api/toolsets.ts` | Toolsets, per-capability provider selection, terminal backends, the computer-use permission grant; `needs_nous_auth` is data, not a special case. |

#### §1.2 The rest of the shard

| File | What it is / what it pins |
| --- | --- |
| `apps/desktop/src/AGENTS.md` | # apps/desktop/src/ — backend contract, slash palette, Bot Mode |
| `apps/desktop/src/components/Backdrop.tsx` | const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}` |
| `apps/desktop/src/components/assistant-ui/ansi-text.tsx` | Renders text with embedded ANSI SGR codes as colored / bold spans. Falls |
| `apps/desktop/src/components/assistant-ui/artifact-card.tsx` | Transcript stand-in for a fenced block that was promoted to an artifact. |
| `apps/desktop/src/components/assistant-ui/catalog-advanced-dialog.tsx` | A skill has no agent/desktop halves, no enable step and no commit pin; it keeps profile and force. */ |
| `apps/desktop/src/components/assistant-ui/catalog-install-tool.test.tsx` | pins: the catalog install card |
| `apps/desktop/src/components/assistant-ui/catalog-install-tool.tsx` | The row a successful settled Try again draws: the backend's install result for that retry, in the |
| `apps/desktop/src/components/assistant-ui/chat-empty-slot.test.tsx` | pins: an empty transcript asks every contributor |
| `apps/desktop/src/components/assistant-ui/chat-empty-slot.tsx` | The empty transcript's contributed slot. Mounts every registration and lets |
| `apps/desktop/src/components/assistant-ui/clarify/clarify-tool.test.tsx` | pins: ClarifyTool live card stays mounted across settle |
| `apps/desktop/src/components/assistant-ui/clarify/core/choice-row.tsx` | A letter-badged option row. */ |
| `apps/desktop/src/components/assistant-ui/clarify/core/confirm-bar.tsx` | const { t } = useI18n() |
| `apps/desktop/src/components/assistant-ui/clarify/core/question-block.tsx` | One question's interactive block inside the live batch card. */ |
| `apps/desktop/src/components/assistant-ui/clarify/core/shell.tsx` | field-sizing on top of Textarea's shared chrome; kill min-h-16 for one-liners. |
| `apps/desktop/src/components/assistant-ui/clarify/core/use-clarify-keys-handlers.ts` | True when this card must leave the keystroke alone. */ |
| `apps/desktop/src/components/assistant-ui/clarify/core/use-clarify-keys.ts` | isStaged: (question: ClarifyQuestion, row?: number) => boolean |
| `apps/desktop/src/components/assistant-ui/clarify/index.tsx` | Answered → settled Q&A (ToolFallback collapsed the answer away). |
| `apps/desktop/src/components/assistant-ui/clarify/parse.ts` | Parse clarify tool JSON (`responses` array). */ |
| `apps/desktop/src/components/assistant-ui/clarify/pending.tsx` | Live batch card: all questions at once, staged locally, ONE confirm. |
| `apps/desktop/src/components/assistant-ui/clarify/settled.tsx` | Settled batch card: every question with its locked (or absent) answer. */ |
| `apps/desktop/src/components/assistant-ui/clarify/submit-shortcut.ts` | Use the form's enabled submit button so validation and pending state agree. */ |
| `apps/desktop/src/components/assistant-ui/clarify/undelivered-notice.tsx` | Heads a card whose request never reached this window: nothing on it can |
| `apps/desktop/src/components/assistant-ui/clarify/use-undelivered.ts` | How long a painted card may wait for its gateway request before asking the |
| `apps/desktop/src/components/assistant-ui/connector-directory-card.test.tsx` | pins: ConnectorDirectoryCard |
| `apps/desktop/src/components/assistant-ui/connector-directory-card.tsx` | Same shape as the `manage_connections` display result. */ |
| `apps/desktop/src/components/assistant-ui/connector-order.ts` | The onboarding apps step's order: the most used apps lead; apps turned off and a hidden few are left out. |
| `apps/desktop/src/components/assistant-ui/connector-tool.test.tsx` | pins: ConnectorOffer named-account notice |
| `apps/desktop/src/components/assistant-ui/connector-tool.tsx` | The browser leg of a connection came back through `hermes://connections/done`. Show the session |
| `apps/desktop/src/components/assistant-ui/directive-blob-image.test.tsx` | pins: blob markdown image ref in a sent user message |
| `apps/desktop/src/components/assistant-ui/directive-chip-links.test.tsx` | pins: sent-message url chip |
| `apps/desktop/src/components/assistant-ui/directive-text.test.ts` | pins: formatRefValue |
| `apps/desktop/src/components/assistant-ui/directive-text.tsx` | Icon glyphs come from the shared reference vocabulary, so the popover row |
| `apps/desktop/src/components/assistant-ui/embeds/alert.test.tsx` | pins: extractAlert |
| `apps/desktop/src/components/assistant-ui/embeds/alert.tsx` | Detect a GitHub-style alert blockquote (`> [!NOTE]`). Returns the alert kind |
| `apps/desktop/src/components/assistant-ui/embeds/embed-consent.tsx` | Privacy placeholder shown before an embed reaches out to a third party. Sized |
| `apps/desktop/src/components/assistant-ui/embeds/embed-size.ts` | Shared height cap for inline embeds. Ratio embeds cap their width off this in |
| `apps/desktop/src/components/assistant-ui/embeds/fail.tsx` | <span className="grid min-h-32 w-full place-items-center p-4"> |
| `apps/desktop/src/components/assistant-ui/embeds/frame-embed.tsx` | const ALLOW = 'autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen' |
| `apps/desktop/src/components/assistant-ui/embeds/index.ts` | module body (no leading doc line) |
| `apps/desktop/src/components/assistant-ui/embeds/listing-embed.tsx` | The conversation's own type scale, so a card reads at the prose's size. */ |
| `apps/desktop/src/components/assistant-ui/embeds/mermaid-embed.test.tsx` | pins: MermaidRenderer |
| `apps/desktop/src/components/assistant-ui/embeds/mermaid-embed.tsx` | let lastTheme: 'dark' | 'default' | null = null |
| `apps/desktop/src/components/assistant-ui/embeds/mermaid-render-cache.test.ts` | pins: createMermaidRenderCache |
| `apps/desktop/src/components/assistant-ui/embeds/mermaid-render-cache.ts` | defer?: (signal?: AbortSignal) => Promise<void> |
| `apps/desktop/src/components/assistant-ui/embeds/providers/detect.test.ts` | pins: detectEmbed — YouTube |
| `apps/desktop/src/components/assistant-ui/embeds/providers/index.ts` | Resolve a URL to a rich-embed descriptor, or null when no provider matches. |
| `apps/desktop/src/components/assistant-ui/embeds/providers/instagram.ts` | if (bareHost(url.hostname) !== 'instagram.com') { |
| `apps/desktop/src/components/assistant-ui/embeds/providers/maps.ts` | `@lat,lng` (optionally `,<zoom>z`) as it appears in Google Maps URLs. |
| `apps/desktop/src/components/assistant-ui/embeds/providers/pinterest.ts` | Pinterest runs many locale TLDs (pinterest.co.uk, fr.pinterest.com, ...). |
| `apps/desktop/src/components/assistant-ui/embeds/providers/spotify.ts` | Spotify's embed has only two layouts: compact (≤152) and full (352). Any |
| `apps/desktop/src/components/assistant-ui/embeds/providers/tiktok.ts` | if (bareHost(url.hostname) !== 'tiktok.com') { |
| `apps/desktop/src/components/assistant-ui/embeds/providers/twitter.ts` | if (host !== 'twitter.com' && host !== 'x.com') { |
| `apps/desktop/src/components/assistant-ui/embeds/providers/types.ts` | Which lazy renderer materialises the descriptor. */ |
| `apps/desktop/src/components/assistant-ui/embeds/providers/vimeo.ts` | if (host !== 'vimeo.com' && host !== 'player.vimeo.com') { |
| `apps/desktop/src/components/assistant-ui/embeds/providers/youtube.ts` | `t`/`start` accept either raw seconds ("90") or the "1m30s" form. |
| `apps/desktop/src/components/assistant-ui/embeds/registry.tsx` | Rendered for unhandled languages, while the chunk loads, and on failure |
| `apps/desktop/src/components/assistant-ui/embeds/rich-boundary.tsx` | Rendered in place of the subtree when a render throws. */ |
| `apps/desktop/src/components/assistant-ui/embeds/scroll-gate.tsx` | Block wheel until ⌘/Ctrl so map embeds don't hijack transcript scroll. */ |
| `apps/desktop/src/components/assistant-ui/embeds/social-embed.test.tsx` | pins: SocialEmbedRenderer |
| `apps/desktop/src/components/assistant-ui/embeds/social-embed.tsx` | X and Instagram render in the provider's own cross-origin iframe, like every |
| `apps/desktop/src/components/assistant-ui/embeds/spotify-embed.tsx` | const ALLOW = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture' |
| `apps/desktop/src/components/assistant-ui/embeds/svg-embed.tsx` | Lazy chunk (pulls in DOMPurify). Renders a ```svg fence as an image after |
| `apps/desktop/src/components/assistant-ui/embeds/types.ts` | True while the surrounding message is still streaming. Renderers that can |
| `apps/desktop/src/components/assistant-ui/embeds/url-embed.tsx` | const FrameEmbedRenderer = lazy(() => import('./frame-embed')) |
| `apps/desktop/src/components/assistant-ui/embeds/use-is-dark.ts` | const isDarkNow = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark') |
| `apps/desktop/src/components/assistant-ui/embeds/youtube-embed.test.tsx` | pins: YouTubeEmbedRenderer |
| `apps/desktop/src/components/assistant-ui/embeds/youtube-embed.tsx` | The same video and params, served through the Desktop loopback wrapper. */ |
| `apps/desktop/src/components/assistant-ui/inline-preview-directive.test.ts` | pins: directiveFrameHeight |
| `apps/desktop/src/components/assistant-ui/inline-preview-directive.tsx` | `::preview{file="…"}` — a workspace HTML file rendered LIVE inside the |
| `apps/desktop/src/components/assistant-ui/markdown-table.tsx` | Drag-resizable columns for transcript markdown tables. |
| `apps/desktop/src/components/assistant-ui/markdown-text.artifacts.test.tsx` | pins: MarkdownTextContent artifacts |
| `apps/desktop/src/components/assistant-ui/markdown-text.bare-url.test.tsx` | pins: MarkdownTextContent bare URLs |
| `apps/desktop/src/components/assistant-ui/markdown-text.filelinks.test.tsx` | pins: MarkdownLink filesystem hrefs |
| `apps/desktop/src/components/assistant-ui/markdown-text.linklabels.test.tsx` | pins: MarkdownLink authored labels |
| `apps/desktop/src/components/assistant-ui/markdown-text.media-md.test.tsx` | pins: markdown documents delivered via MEDIA |
| `apps/desktop/src/components/assistant-ui/markdown-text.media.test.tsx` | pins: MarkdownTextContent remote images |
| `apps/desktop/src/components/assistant-ui/markdown-text.overflow.test.tsx` | pins: markdown surface survives stack-overflow content |
| `apps/desktop/src/components/assistant-ui/markdown-text.prose-safety.test.tsx` | pins: markdown prose renders tilde ranges and unknown tags literally |
| `apps/desktop/src/components/assistant-ui/markdown-text.reasoning.test.tsx` | pins: never paints the chain of thought, and never un-paints an answer, in any 3-char frame |
| `apps/desktop/src/components/assistant-ui/markdown-text.session.test.tsx` | pins: MarkdownTextContent session refs |
| `apps/desktop/src/components/assistant-ui/markdown-text.test.ts` | pins: preprocessMarkdown |
| `apps/desktop/src/components/assistant-ui/markdown-text.tsx` | This text is the model's private scratchpad (reasoning), so nothing in it |
| `apps/desktop/src/components/assistant-ui/mcp-setup-tool.test.tsx` | pins: the MCP setup card |
| `apps/desktop/src/components/assistant-ui/mcp-setup-tool.tsx` | The row's one verb. `approve` is the user's consent, `working` is the backend acting on it, `open` |
| `apps/desktop/src/components/assistant-ui/message-render-boundary.test.tsx` | pins: MessageRenderBoundary |
| `apps/desktop/src/components/assistant-ui/message-render-boundary.tsx` | `@assistant-ui/store`'s index-keyed child-scope lookup (`useClientLookup`) |
| `apps/desktop/src/components/assistant-ui/reference-kinds.ts` | The composer's reference vocabulary: one place that decides what a `@file:`, |
| `apps/desktop/src/components/assistant-ui/session-ref-open.test.tsx` | pins: session refs open the session |
| `apps/desktop/src/components/assistant-ui/setup-beat/beat-cards.tsx` | A text box for the name. The OS account's full name is offered as a row and is sent only when picked. */ |
| `apps/desktop/src/components/assistant-ui/setup-beat/card-type.ts` | The card's question line and section labels. */ |
| `apps/desktop/src/components/assistant-ui/setup-beat/plugins-card.tsx` | The plugins this OS runs, from the card payload; Install opens the reviewed install dialog in place, |
| `apps/desktop/src/components/assistant-ui/setup-beat/receipt.tsx` | What a settled card shows: the beat's pick, or how the card closed without one. */ |
| `apps/desktop/src/components/assistant-ui/setup-beat/setup-beat-tool.test.tsx` | pins: SetupBeatTool |
| `apps/desktop/src/components/assistant-ui/setup-beat/setup-beat-tool.tsx` | The card body for one beat; `answer` sends the beat's picks and settles the card. */ |
| `apps/desktop/src/components/assistant-ui/test-utils.tsx` | Fixed clock for message fixtures, so nothing sorts by "now". */ |
| `apps/desktop/src/components/assistant-ui/theme-picker/accent-picker-card.tsx` | Answers with a swatch id, `custom:#rrggbb`, or null for the theme's own accent (Nous blue); true once sent. */ |
| `apps/desktop/src/components/assistant-ui/theme-picker/args.ts` | The set_theme call a tool row carries (live rows are named `set_theme`), or null for any other tool. */ |
| `apps/desktop/src/components/assistant-ui/theme-picker/layout-picker-card.tsx` | Answers with the staged preset id; true once sent. */ |
| `apps/desktop/src/components/assistant-ui/theme-picker/look-preview.ts` | A staged pick; `value` null is the theme's own accent. */ |
| `apps/desktop/src/components/assistant-ui/theme-picker/theme-tool.test.tsx` | pins: ThemeTool |
| `apps/desktop/src/components/assistant-ui/theme-picker/theme-tool.tsx` | The applied/picked values of a set_theme result, or null when the result names none. */ |
| `apps/desktop/src/components/assistant-ui/thread-remount.test.tsx` | pins: thread message mount stability |
| `apps/desktop/src/components/assistant-ui/thread/agent-avatar-cache.test.ts` | pins: agent avatar cache |
| `apps/desktop/src/components/assistant-ui/thread/agent-delivery.test.tsx` | pins: delivery command detection |
| `apps/desktop/src/components/assistant-ui/thread/agent-delivery.tsx` | `@Dr. Foo`, `scribe@laptop`, `peer/scribe` → `dr. foo` / `scribe`: the |
| `apps/desktop/src/components/assistant-ui/thread/agent-message.test.tsx` | pins: agent message detection |
| `apps/desktop/src/components/assistant-ui/thread/assistant-message.test.tsx` | pins: AssistantMessage branch button visibility (bug #2 fix) |
| `apps/desktop/src/components/assistant-ui/thread/assistant-message.tsx` | Lazy accessor — reads the live message text at action time. Passing the |
| `apps/desktop/src/components/assistant-ui/thread/background-resume.test.tsx` | pins: keeps background waiting local to its idle thread without echoing child thinking chrome |
| `apps/desktop/src/components/assistant-ui/thread/block-direction.test.tsx` | pins: block-level direction chrome |
| `apps/desktop/src/components/assistant-ui/thread/changed-files-card.tsx` | Cursor-style "N files changed" summary closing out the newest assistant turn: |
| `apps/desktop/src/components/assistant-ui/thread/changed-files.ts` | Basename, for the row label. */ |
| `apps/desktop/src/components/assistant-ui/thread/content.test.ts` | pins: partText |
| `apps/desktop/src/components/assistant-ui/thread/content.ts` | const EMPTY_ATTACHMENT_REFS: string[] = [] |
| `apps/desktop/src/components/assistant-ui/thread/double-click-reaction.test.tsx` | pins: isTapbackDoubleClick |
| `apps/desktop/src/components/assistant-ui/thread/duplicate-activity-indicator.test.tsx` | pins: TurnActivityIndicator tail gating (#68634) |
| `apps/desktop/src/components/assistant-ui/thread/edit-context.test.tsx` | pins: thread edit context |
| `apps/desktop/src/components/assistant-ui/thread/index.test.tsx` | pins: Thread messageComponents identity across session switches |
| `apps/desktop/src/components/assistant-ui/thread/index.tsx` | type ThreadLoadingState = 'response' | 'session' |
| `apps/desktop/src/components/assistant-ui/thread/inter-agent-collapse.test.tsx` | pins: inter-agent collapse gate |
| `apps/desktop/src/components/assistant-ui/thread/list-auto-show-earlier.test.tsx` | pins: top-edge auto Show earlier |
| `apps/desktop/src/components/assistant-ui/thread/list-restore-composer-resize.test.tsx` | pins: list post-settle restore vs composer-only resize |
| `apps/desktop/src/components/assistant-ui/thread/list-session-scroll.test.tsx` | pins: list session-scroll restore |
| `apps/desktop/src/components/assistant-ui/thread/list.test.ts` | pins: subscribeToThreadForeground |
| `apps/desktop/src/components/assistant-ui/thread/list.tsx` | Near-bottom slack for a run-start snap. Wider than the subpixel epsilon |
| `apps/desktop/src/components/assistant-ui/thread/message-hover-time.tsx` | When the message landed, in seconds: a reply counts from its completion. |
| `apps/desktop/src/components/assistant-ui/thread/message-parts-connectors.test.tsx` | pins: manage_connections routing outside guided onboarding |
| `apps/desktop/src/components/assistant-ui/thread/message-parts.tsx` | type TimelineToolCallProps = ToolCallMessagePartProps & { completedAt?: number; timestamp?: number } |
| `apps/desktop/src/components/assistant-ui/thread/message-reactions.tsx` | The full emoji picker, revealed behind the quick row's "+". Headless — styled here. */ |
| `apps/desktop/src/components/assistant-ui/thread/preview-embeds.test.tsx` | pins: settled-turn link previews |
| `apps/desktop/src/components/assistant-ui/thread/process-notification.test.tsx` | pins: renders legacy and current process completions as tool disclosures without interpreting their output |
| `apps/desktop/src/components/assistant-ui/thread/reaction-picker-focus-follow.test.tsx` | pins: assistant reaction picker |
| `apps/desktop/src/components/assistant-ui/thread/response-copy-scope.test.tsx` | pins: default Copy reads only the tail reply, not the whole response group |
| `apps/desktop/src/components/assistant-ui/thread/response-group.test.tsx` | pins: keeps background continuations in one response with one action bar and the original message identities |
| `apps/desktop/src/components/assistant-ui/thread/response-group.tsx` | Background deliveries continue the response without becoming human prompts. */ |
| `apps/desktop/src/components/assistant-ui/thread/sealed-tool-parts.test.tsx` | pins: tool parts sealed without a result |
| `apps/desktop/src/components/assistant-ui/thread/session-switching.ts` | `data-session-switching` — the supported hook for styling a chat switch. |
| `apps/desktop/src/components/assistant-ui/thread/should-auto-show-earlier.test.ts` | pins: shouldAutoShowEarlier |
| `apps/desktop/src/components/assistant-ui/thread/status-invalidation-scope.test.tsx` | pins: streaming-status invalidation scope |
| `apps/desktop/src/components/assistant-ui/thread/status-tail-only.test.tsx` | pins: thinking indicator is tail-only |
| `apps/desktop/src/components/assistant-ui/thread/status.test.tsx` | pins: ResponseLoadingIndicator timer |
| `apps/desktop/src/components/assistant-ui/thread/status.tsx` | Renderer-side load synthesis: poll the local-models status while a turn |
| `apps/desktop/src/components/assistant-ui/thread/stream-settled-renders.test.tsx` | pins: streaming into a settled transcript |
| `apps/desktop/src/components/assistant-ui/thread/streaming.test.tsx` | pins: assistant-ui streaming renderer |
| `apps/desktop/src/components/assistant-ui/thread/system-message.test.tsx` | pins: background report inline code |
| `apps/desktop/src/components/assistant-ui/thread/system-message.tsx` | const [open, setOpen] = useState(false) |
| `apps/desktop/src/components/assistant-ui/thread/text-direction.test.tsx` | pins: Text direction: Auto |
| `apps/desktop/src/components/assistant-ui/thread/thread-message-index.test.ts` | pins: thread message index |
| `apps/desktop/src/components/assistant-ui/thread/thread-message-index.ts` | Index of the LAST row with `id`, or -1. */ |
| `apps/desktop/src/components/assistant-ui/thread/timeline-data.test.ts` | pins: timelinePreview |
| `apps/desktop/src/components/assistant-ui/thread/timeline-data.ts` | Shared, localized focus curve; the active tick always retains its maximum. */ |
| `apps/desktop/src/components/assistant-ui/thread/timeline-idle.test.tsx` | pins: ThreadTimeline in a background tab |
| `apps/desktop/src/components/assistant-ui/thread/timeline-index.test.ts` | pins: timeline metadata index |
| `apps/desktop/src/components/assistant-ui/thread/timeline-index.ts` | One lookup may advance a partially loaded index by this many pages. */ |
| `apps/desktop/src/components/assistant-ui/thread/timeline-position.test.tsx` | pins: timeline position in the real rail component |
| `apps/desktop/src/components/assistant-ui/thread/timeline-position.ts` | The transcript's outer groups are in normal-flow DOM order. Binary-search |
| `apps/desktop/src/components/assistant-ui/thread/timeline-rail.test.tsx` | pins: TimelineRail |
| `apps/desktop/src/components/assistant-ui/thread/timeline-rail.tsx` | Only the visible slice owns DOM or tooltip instances. Pointer paint is local. */ |
| `apps/desktop/src/components/assistant-ui/thread/timeline-timestamp.test.tsx` | pins: setDisplayTimestampsFromConfig |
| `apps/desktop/src/components/assistant-ui/thread/timeline-timestamp.tsx` | Timestamp for the current assistant-ui message lifecycle. */ |
| `apps/desktop/src/components/assistant-ui/thread/timeline.css` | padding: 0 0.375rem 0 0; |
| `apps/desktop/src/components/assistant-ui/thread/timeline.test.ts` | pins: ownViewport |
| `apps/desktop/src/components/assistant-ui/thread/timeline.tsx` | A kept-alive neighbor must never receive this rail's navigation. */ |
| `apps/desktop/src/components/assistant-ui/thread/timestamp.test.ts` | pins: formatMessageTimestamp |
| `apps/desktop/src/components/assistant-ui/thread/timestamp.ts` | Millisecond-precise local clock for transcript activity boundaries. */ |
| `apps/desktop/src/components/assistant-ui/thread/transcript-window.test.ts` | pins: resolveShowEarlierAction |
| `apps/desktop/src/components/assistant-ui/thread/transcript-window.tsx` | Store holds older messages the runtime window has not materialized. */ |
| `apps/desktop/src/components/assistant-ui/thread/turn-activity.test.ts` | pins: activitySignature |
| `apps/desktop/src/components/assistant-ui/thread/turn-activity.ts` | Seconds of silence before an unnamed wait earns a row of its own. |
| `apps/desktop/src/components/assistant-ui/thread/turn-gap-indicator.test.tsx` | pins: the turn timer covers the gaps, not just the streaming |
| `apps/desktop/src/components/assistant-ui/thread/types.ts` | export interface RestoreMessageTarget { |
| `apps/desktop/src/components/assistant-ui/thread/use-message-reactions.ts` | The tapback a double-click lands: Apple's first Tapback, and ours. */ |
| `apps/desktop/src/components/assistant-ui/thread/use-messages-below-perf.test.ts` | pins: messages-below scroll cost |
| `apps/desktop/src/components/assistant-ui/thread/use-messages-below.test.tsx` | pins: messages below the viewport |
| `apps/desktop/src/components/assistant-ui/thread/use-messages-below.ts` | Cache membership/counts only. Geometry stays live so images, expanded tools |
| `apps/desktop/src/components/assistant-ui/thread/use-sticky-prompt-clip.test.tsx` | pins: clips only visible covered siblings, follows resize, and releases styles and observers on hide |
| `apps/desktop/src/components/assistant-ui/thread/use-sticky-prompt-clip.ts` | Clip covered content instead of painting a solid rectangle over the glass. */ |
| `apps/desktop/src/components/assistant-ui/thread/use-timeline-history.test.tsx` | pins: timeline history index |
| `apps/desktop/src/components/assistant-ui/thread/use-timeline-history.ts` | A bounded metadata page after paint; more titles load only on explicit demand. */ |
| `apps/desktop/src/components/assistant-ui/thread/use-timeline-reveal.test.tsx` | pins: timeline direct reveal |
| `apps/desktop/src/components/assistant-ui/thread/use-timeline-reveal.ts` | Direct archive jumps select one bounded page, never every intervening turn. */ |
| `apps/desktop/src/components/assistant-ui/thread/user-edit-composer-owner-route.test.tsx` | pins: message-edit composer completions |
| `apps/desktop/src/components/assistant-ui/thread/user-edit-composer.tsx` | const { t } = useI18n() |
| `apps/desktop/src/components/assistant-ui/thread/user-message-edit-gesture.test.tsx` | pins: edit send arrow — macOS click gesture (blur races cancel) |
| `apps/desktop/src/components/assistant-ui/thread/user-message-edit-shared-composer.test.tsx` | pins: inline edit inside a shared composer surface |
| `apps/desktop/src/components/assistant-ui/thread/user-message-edit-undo-cut-drag.test.tsx` | pins: edit composer undo — cut and drag coverage |
| `apps/desktop/src/components/assistant-ui/thread/user-message-edit.test.tsx` | pins: click-to-edit user message |
| `apps/desktop/src/components/assistant-ui/thread/user-message-text.test.tsx` | pins: a sent reference renders as the chip the composer showed |
| `apps/desktop/src/components/assistant-ui/thread/user-message-text.tsx` | Inline-code matches that don't overlap a directive, so a quoted directive |
| `apps/desktop/src/components/assistant-ui/thread/user-message.tsx` | True when the user has a live text highlight (drag-select / triple-click). */ |
| `apps/desktop/src/components/assistant-ui/tool/approval-activity.ts` | These calls render as activity, not file diffs or other deliverable cards. */ |
| `apps/desktop/src/components/assistant-ui/tool/approval.test.tsx` | pins: PendingApprovalStack |
| `apps/desktop/src/components/assistant-ui/tool/approval.tsx` | type ApprovalChoice = 'once' | 'session' | 'always' | 'deny' |
| `apps/desktop/src/components/assistant-ui/tool/delegate-model.test.ts` | pins: delegateGoals |
| `apps/desktop/src/components/assistant-ui/tool/delegate-model.ts` | A delegation runs somewhere the transcript can't see: the tool call carries |
| `apps/desktop/src/components/assistant-ui/tool/delegate.test.tsx` | pins: delegate card fade |
| `apps/desktop/src/components/assistant-ui/tool/delegate.tsx` | One delegated child: who it is on the first line, what it is doing on the |
| `apps/desktop/src/components/assistant-ui/tool/fallback-model.test.ts` | pins: buildToolView image handling |
| `apps/desktop/src/components/assistant-ui/tool/fallback-model/format.ts` | User-friendly step label from browser_exec code's leading `# …` comment. |
| `apps/desktop/src/components/assistant-ui/tool/fallback-model/index.ts` | Status + detected preview target only — for feeds that never render the |
| `apps/desktop/src/components/assistant-ui/tool/fallback-model/targets.ts` | Shared by a tool row and the activity summaries that open it. */ |
| `apps/desktop/src/components/assistant-ui/tool/fallback-model/types.ts` | Set for tools whose output naturally contains ANSI escape codes |
| `apps/desktop/src/components/assistant-ui/tool/fallback-preview-scope.test.tsx` | pins: tool row preview recording |
| `apps/desktop/src/components/assistant-ui/tool/fallback-vision-image.test.tsx` | pins: vision_analyze activity image |
| `apps/desktop/src/components/assistant-ui/tool/fallback.test.ts` | pins: splitRunItems |
| `apps/desktop/src/components/assistant-ui/tool/fallback.tsx` | Technical-mode raw payload, behind a chevron disclosure. |
| `apps/desktop/src/components/assistant-ui/tool/hide-code-diffs.test.tsx` | pins: keeps edit counts without code in either display mode and restores disclosure when disabled |
| `apps/desktop/src/components/assistant-ui/tool/inline-edit-persistence.test.tsx` | test file (no top-level describe/it name matched) |
| `apps/desktop/src/components/assistant-ui/tool/run-summary.test.ts` | pins: summarizeToolRun |
| `apps/desktop/src/components/assistant-ui/tool/run-summary.ts` | The little a summary needs from a tool call, stated structurally so both |
| `apps/desktop/src/components/assistant-ui/tool/run-ticker.tsx` | A one-line window over a growing list of rows. |
| `apps/desktop/src/components/assistant-ui/tool/skill-activity.test.ts` | pins: skill activity identity |
| `apps/desktop/src/components/assistant-ui/tool/skill-activity.ts` | Loading instructions is not the same action as reading a skill resource, |
| `apps/desktop/src/components/assistant-ui/tool/tool-feed-chrome.test.tsx` | pins: tool feed visibility policy |
| `apps/desktop/src/components/assistant-ui/tool/tool-group.test.tsx` | pins: settled tool run |
| `apps/desktop/src/components/assistant-ui/tooltip-icon-button.tsx` | side?: 'top' | 'bottom' | 'left' | 'right' |
| `apps/desktop/src/components/assistant-ui/transcript-directive.test.tsx` | pins: paragraphPlainText |
| `apps/desktop/src/components/assistant-ui/transcript-directive.tsx` | The transcript's directive slot. Given text, renders the plugin component |
| `apps/desktop/src/components/assistant-ui/typed-answer.tsx` | Words typed in the composer while a card waited, drawn as the user's bubble where the card stood. |
| `apps/desktop/src/components/assistant-ui/use-connection-owner.ts` | The gateway route that owns a session's connection operation. Null until it resolves and null when it cannot: a card RPC must reach the |
| `apps/desktop/src/components/billing-banner.tsx` | Persistent, in-stack billing wall for THIS session. Rendered as a shared |
| `apps/desktop/src/components/boot-failure-cause.test.ts` | pins: local boot failure classification |
| `apps/desktop/src/components/boot-failure-cause.ts` | Plain-language cause for a LOCAL backend boot failure. The main process |
| `apps/desktop/src/components/boot-failure-overlay.test.tsx` | pins: BootFailureOverlay |
| `apps/desktop/src/components/boot-failure-overlay.tsx` | The recovery "Gateway settings" view embeds the real Settings → Gateway panel |
| `apps/desktop/src/components/boot-failure-reauth.test.ts` | pins: isRemoteConfig |
| `apps/desktop/src/components/boot-failure-reauth.ts` | After a healthy cold boot, main may still re-emit boot-progress errors when a |
| `apps/desktop/src/components/brand-mark.tsx` | const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}` |
| `apps/desktop/src/components/chat/activity-timer-text.tsx` | Tinted with --dt-midground (very low alpha) so the timer reads |
| `apps/desktop/src/components/chat/activity-timer.test.tsx` | pins: useElapsedSeconds |
| `apps/desktop/src/components/chat/activity-timer.ts` | Seconds since the timer's origin, reported once a second while `active`. |
| `apps/desktop/src/components/chat/code-card.tsx` | Rounded surface for fenced code (and any equivalent: diffs, raw payloads, |
| `apps/desktop/src/components/chat/code-editor-theme.ts` | GitHub "default" palettes, mirroring the read view's Shiki themes |
| `apps/desktop/src/components/chat/code-editor.tsx` | Imperative surface for callers that drive selection from outside (e.g. a |
| `apps/desktop/src/components/chat/compact-markdown.overflow.test.tsx` | pins: CompactMarkdown overflow containment |
| `apps/desktop/src/components/chat/compact-markdown.tsx` | Compact markdown renderer for tool detail bodies. Same Streamdown pipeline |
| `apps/desktop/src/components/chat/composer-dock.ts` | The composer surface and the status/queue stack paint ONE shared |
| `apps/desktop/src/components/chat/diff-lines.test.tsx` | pins: FileDiffPanel survives a failed lazy syntax-diff chunk |
| `apps/desktop/src/components/chat/diff-lines.tsx` | Renders a unified diff for a tool's file edit. Two paths share one parse: |
| `apps/desktop/src/components/chat/disclosure-row.tsx` | Shared header row for any collapsible block (thinking, tool group, single |
| `apps/desktop/src/components/chat/expandable-block.test.tsx` | pins: ExpandableBlock |
| `apps/desktop/src/components/chat/expandable-block.tsx` | const [expanded, setExpanded] = useState(false) |
| `apps/desktop/src/components/chat/fixed-row-window.ts` | onScroll: (event: UIEvent<HTMLDivElement>) => void |
| `apps/desktop/src/components/chat/generated-image-result.tsx` | A hint is only a placeholder shape, not a promise about the delivered image. |
| `apps/desktop/src/components/chat/image-generation-placeholder.test.tsx` | pins: DiffusionCanvas scheduling |
| `apps/desktop/src/components/chat/image-generation-placeholder.tsx` | type Rgb = { r: number; g: number; b: number } |
| `apps/desktop/src/components/chat/image-geometry.test.tsx` | pins: keeps the pending generated-image frame when its result arrives |
| `apps/desktop/src/components/chat/intro-copy.jsonl` | {"personality":"helpful","headline":"Ready when you are","body":"Ask me to open a repo, run tests, fix a bug, or draft a PR. I'll walk through the ... |
| `apps/desktop/src/components/chat/intro.test.tsx` | pins: translates every shipped stock body at the same personality and rotation position |
| `apps/desktop/src/components/chat/intro.tsx` | type IntroCopyRecord = IntroCopy & { |
| `apps/desktop/src/components/chat/json-document-editor.tsx` | In-memory JSON editor — not for on-disk file previews in the right rail. */ |
| `apps/desktop/src/components/chat/log-search.tsx` | Index into `hits` of the match the view is parked on; -1 with no hits. */ |
| `apps/desktop/src/components/chat/log-tail.test.tsx` | pins: LogTail search |
| `apps/desktop/src/components/chat/log-tail.tsx` | null = still loading (shows the loading glyph); [] = loaded-but-empty |
| `apps/desktop/src/components/chat/preview-attachment.test.tsx` | pins: PreviewAttachment local target classification (#101683) |
| `apps/desktop/src/components/chat/preview-attachment.tsx` | What the Electron main process said about this target's LOCAL filesystem |
| `apps/desktop/src/components/chat/scaffold-row.tsx` | Transcript scaffolding: the quiet lines around the reply that say what the |
| `apps/desktop/src/components/chat/shiki-block.test.tsx` | pins: CachedShikiBlock (warm-switch perf guard) |
| `apps/desktop/src/components/chat/shiki-block.tsx` | The ONLY static importer of shiki (and through it the multi-MB shiki |
| `apps/desktop/src/components/chat/shiki-chunk-boundary.tsx` | A failed lazy-chunk fetch (missing/broken bundle piece), not a code bug. */ |
| `apps/desktop/src/components/chat/shiki-config.ts` | `github-light-default` colors comments `#6e7781` (~4.2:1 against the code |
| `apps/desktop/src/components/chat/shiki-highlight-cache.test.ts` | pins: highlightCacheKey |
| `apps/desktop/src/components/chat/shiki-highlight-cache.ts` | Unique key for one highlighted block: scope + language + exact code. */ |
| `apps/desktop/src/components/chat/shiki-highlighter.test.ts` | pins: exceedsHighlightBudget |
| `apps/desktop/src/components/chat/shiki-highlighter.test.tsx` | pins: a reply survives a failed shiki-block chunk load (#95995) |
| `apps/desktop/src/components/chat/shiki-highlighter.tsx` | Streamdown's code adapter renders header + body as inline siblings, so we |
| `apps/desktop/src/components/chat/shiki-plain.tsx` | Matches highlighted markup so loading a grammar changes color, not layout. */ |
| `apps/desktop/src/components/chat/skeletons.tsx` | Rows of icon + label bars, mimicking a file tree mid-load. */ |
| `apps/desktop/src/components/chat/stable-text.tsx` | Renders text as a row of 1ch-wide cells so individual characters can't |
| `apps/desktop/src/components/chat/status-control-row.tsx` | Text/detail rows share the task icon column without decorating supporting copy. */ |
| `apps/desktop/src/components/chat/status-dismiss-button.tsx` | The leading close control shared by artifacts, background work and queued prompts. */ |
| `apps/desktop/src/components/chat/status-pending-icon.tsx` | Neutral, unfinished state shared by pending tasks and goal criteria. */ |
| `apps/desktop/src/components/chat/status-row.test.tsx` | pins: keeps dismiss and nested controls independent from row activation |
| `apps/desktop/src/components/chat/status-row.tsx` | Leading glyph slot (spinner / status dot / selection circle). */ |
| `apps/desktop/src/components/chat/status-section.tsx` | Optional right-aligned actions (text links / micro buttons). Pass |
| `apps/desktop/src/components/chat/status-stack.css` | /* Shared columns: action, state glyph, content, optional trailing actions. */ |
| `apps/desktop/src/components/chat/syntax-diff.tsx` | The Shiki-highlighted compact diff body, split out of diff-lines.tsx so the |
| `apps/desktop/src/components/chat/terminal-output.tsx` | Tiny read-only terminal viewer: monospace, non-wrapping (long lines scroll |
| `apps/desktop/src/components/chat/transcript-video.test.tsx` | pins: video playback speed preference |
| `apps/desktop/src/components/chat/transcript-video.tsx` | Playback position per source, remembered across remounts. Transcript rows |
| `apps/desktop/src/components/chat/vibe-hearts.test.ts` | pins: burstVibeHearts |
| `apps/desktop/src/components/chat/vibe-hearts.tsx` | TikTok-style floating hearts — a thin skin over {@link ParticleField} (pixel |
| `apps/desktop/src/components/chat/widget-shell.ts` | Inline transcript widgets — the few tool results that render as a panel the |
| `apps/desktop/src/components/chat/wordmark.tsx` | The oversized display lettering of an empty chat — the Collapse face that |
| `apps/desktop/src/components/chat/zoomable-image.test.tsx` | pins: ZoomableImage lightbox |
| `apps/desktop/src/components/chat/zoomable-image.tsx` | Full-resolution source for the lightbox and download. When set, the inline |
| `apps/desktop/src/components/confirm-host.test.tsx` | pins: confirm() |
| `apps/desktop/src/components/confirm-host.tsx` | The one mount point for `confirm()` from @/store/confirm. Mounted once at the |
| `apps/desktop/src/components/desktop-install-local-card.ts` | Presentation for an install offer or an already-selected local runtime. */ |
| `apps/desktop/src/components/desktop-install-overlay.test.tsx` | pins: DesktopInstallOverlay first-run setup |
| `apps/desktop/src/components/desktop-install-overlay.tsx` | Renders the first-launch install progress for Hermes Agent. Mounted always; |
| `apps/desktop/src/components/error-boundary.test.tsx` | pins: ErrorBoundary assistant-ui lookup recovery |
| `apps/desktop/src/components/error-boundary.tsx` | fallback?: (props: ErrorBoundaryFallbackProps) => ReactNode |
| `apps/desktop/src/components/external-open-failed-dialog.test.tsx` | pins: ExternalOpenFailedDialog |
| `apps/desktop/src/components/external-open-failed-dialog.tsx` | Global fallback for a failed external URL open. main's openExternalUrl |
| `apps/desktop/src/components/find-bar.test.tsx` | pins: formatMatchLabel |
| `apps/desktop/src/components/find-bar.tsx` | Find-in-page overlay (⌘F). |
| `apps/desktop/src/components/free-tier/notice-owner.test.tsx` | pins: useFreeTierNoticeOwner |
| `apps/desktop/src/components/free-tier/notice-strip.tsx` | Which mounted composer gets to paint the strip. Several can be on screen at |
| `apps/desktop/src/components/free-tier/sign-in-dialog.test.tsx` | pins: FreeTierSignInDialog |
| `apps/desktop/src/components/free-tier/sign-in-dialog.tsx` | The app's model-assignment path. Used only to re-home a live session that |
| `apps/desktop/src/components/gateway-connecting-overlay.test.tsx` | pins: connecting overlay vs recovery surface |
| `apps/desktop/src/components/gateway-connecting-overlay.tsx` | The first-run start outlasted the boot budget: it keeps waiting, and the person may go on without setup. */ |
| `apps/desktop/src/components/haptics-provider.registration.test.tsx` | pins: HapticsProvider registration |
| `apps/desktop/src/components/haptics-provider.test.tsx` | pins: HapticsProvider |
| `apps/desktop/src/components/haptics-provider.tsx` | web-haptics' `debug` option is its desktop audio fallback: on platforms |
| `apps/desktop/src/components/idle-mount.test.tsx` | pins: IdleMount |
| `apps/desktop/src/components/idle-mount.tsx` | Mounts `children` only once the browser goes idle (or `timeout` ms elapse), |
| `apps/desktop/src/components/language-switcher.test.tsx` | pins: LanguageSwitcher |
| `apps/desktop/src/components/language-switcher.tsx` | `menu` inside the desktop popover; the mobile sheet keeps the palette rows. */ |
| `apps/desktop/src/components/model-picker.test.tsx` | pins: ModelPickerDialog download rows |
| `apps/desktop/src/components/model-picker.tsx` | Desktop route profile for provider setup; `profile` may be the backend-side target. */ |
| `apps/desktop/src/components/model-visibility-dialog.test.tsx` | pins: Edit Models reset |
| `apps/desktop/src/components/model-visibility-dialog.tsx` | A session-scoped `model.options` goes to the session's OWNER: the ambient |
| `apps/desktop/src/components/notifications.test.tsx` | pins: toast titles |
| `apps/desktop/src/components/notifications.tsx` | A user dismissal (✕, swipe, clear all) is friction, counted by the toast's code-defined id only. |
| `apps/desktop/src/components/onboarding/first-run/assembly.ts` | Leave the demo for the user's own layout at the normal window size. */ |
| `apps/desktop/src/components/onboarding/first-run/intro-copy.css` | /* The demo layout's narrower reading column (the landed column read a tad too wide). */ |
| `apps/desktop/src/components/onboarding/first-run/intro-copy.tsx` | Centred intro copy that springs up into the empty setup chat. Primary chat view only. */ |
| `apps/desktop/src/components/onboarding/first-run/intro.ts` | The intro copy over an empty onboarding chat: it types centred (`playing`), springs up and waits at |
| `apps/desktop/src/components/onboarding/first-run/kickoff.test.ts` | pins: first-run kickoff |
| `apps/desktop/src/components/onboarding/first-run/kickoff.ts` | Main's first-run start around `onboarding.start`: the boot overlay holds, the window takes the demo |
| `apps/desktop/src/components/onboarding/first-run/layout.test.ts` | pins: first-run layout beat |
| `apps/desktop/src/components/onboarding/flow.test.tsx` | pins: ConfirmingModelPanel model pick |
| `apps/desktop/src/components/onboarding/flow.tsx` | const { t } = useI18n() |
| `apps/desktop/src/components/onboarding/free-tier-intro.test.ts` | pins: free-tier introduction branch table |
| `apps/desktop/src/components/onboarding/free-tier-setup-notice.test.tsx` | pins: setupFailureCopy |
| `apps/desktop/src/components/onboarding/free-tier-setup-notice.tsx` | The sentence for a failure. The backend's own sentence is the fallback for a |
| `apps/desktop/src/components/onboarding/glyph.tsx` | Borrowed from the gateway "connecting" overlay: a mono, letter-spaced label |
| `apps/desktop/src/components/onboarding/index.test.tsx` | pins: onboarding Picker |
| `apps/desktop/src/components/onboarding/index.tsx` | The one-time free-tier welcome, shown when the free tier is what serves this |
| `apps/desktop/src/components/onboarding/onboarding-end.test.tsx` | pins: OnboardingEnd |
| `apps/desktop/src/components/onboarding/onboarding-end.tsx` | The local-model offer after first-run onboarding: armed when a run ends or the user first leaves |
| `apps/desktop/src/components/onboarding/providers.tsx` | Quick-key row for API-key providers (Fireworks leads the expanded list after Nous, OpenRouter further down). */ |
| `apps/desktop/src/components/onboarding/skip-gate.test.tsx` | pins: DesktopOnboardingOverlay first-run skip gate |
| `apps/desktop/src/components/onboarding/skip-setup.test.tsx` | pins: Skip setup |
| `apps/desktop/src/components/onboarding/skip-setup.tsx` | Skip setup, shown in the composer of the onboarding chat only. Once the backend has ended the run, |
| `apps/desktop/src/components/overlay-error-boundary.tsx` | Error boundary for the transparent `?win=` overlay windows. |
| `apps/desktop/src/components/page-loader.tsx` | interface PageLoaderProps extends Omit<ComponentProps<'div'>, 'children'> { |
| `apps/desktop/src/components/pane-shell/edit-mode.test.ts` | pins: $layoutEditRevealsHidden |
| `apps/desktop/src/components/pane-shell/edit-mode.tsx` | Layout edit mode — the shared toggle for the tree renderer's FancyZones-style |
| `apps/desktop/src/components/pane-shell/geometry.ts` | Pane geometry — AABB INTERSECTION → WINDOW-CONTROL AWARENESS. The native |
| `apps/desktop/src/components/pane-shell/index.ts` | Cross-surface event: toggle-reveal a collapsed pane. Dispatched by the |
| `apps/desktop/src/components/pane-shell/pane-lifecycle.test.ts` | pins: per-zone pane lifecycle |
| `apps/desktop/src/components/pane-shell/pane-lifecycle.ts` | Reconcile one zone's mounted pane cache. |
| `apps/desktop/src/components/pane-shell/pane-visibility.test.ts` | pins: pane visibility lookups |
| `apps/desktop/src/components/pane-shell/pane-visibility.ts` | Keep-alive visibility — the one policy every document-wide lookup must obey. |
| `apps/desktop/src/components/pane-shell/tree/dock-enforce.test.ts` | pins: enforced dock (stacked Bots pane → sessions-zone tab, every boot) |
| `apps/desktop/src/components/pane-shell/tree/docked-width-churn.probe.test.ts` | pins: keeps the user-dragged bots zone width across full chat-switch churn |
| `apps/desktop/src/components/pane-shell/tree/floating-adoption.test.ts` | pins: floating panes stay out of the layout tree |
| `apps/desktop/src/components/pane-shell/tree/focus-tab-hijack.test.ts` | pins: reactive unhide in a shared (Focus) group |
| `apps/desktop/src/components/pane-shell/tree/focused-session-tab.test.ts` | pins: focused chat zone drives the tab verbs |
| `apps/desktop/src/components/pane-shell/tree/grid-model.ts` | FancyZones grid model — a faithful port of PowerToys' |
| `apps/desktop/src/components/pane-shell/tree/grid-to-tree.ts` | Grid -> tree bridge. A FancyZones grid whose zones can be produced by |
| `apps/desktop/src/components/pane-shell/tree/hide-only-strip-tabs.test.ts` | pins: hide-only strip tabs |
| `apps/desktop/src/components/pane-shell/tree/hovered-zone-tabs.test.ts` | pins: hovered zone retargets the tab verbs |
| `apps/desktop/src/components/pane-shell/tree/lone-chat-sibling-zone.test.ts` | pins: dragging a session tab into its own zone |
| `apps/desktop/src/components/pane-shell/tree/mode-layout-memory.test.ts` | pins: restores independently customized modes through real pane bindings and reloads |
| `apps/desktop/src/components/pane-shell/tree/model.ts` | Layout tree model — the Dockview-style structure that replaces the |
| `apps/desktop/src/components/pane-shell/tree/multi-tab-drag.test.ts` | pins: movePanes (multi-tab drag) |
| `apps/desktop/src/components/pane-shell/tree/pane-reload-share.test.ts` | pins: tile split-share memory across a hard reload |
| `apps/desktop/src/components/pane-shell/tree/pane-reload.test.ts` | pins: reloadTreePane |
| `apps/desktop/src/components/pane-shell/tree/pane-share-memory.test.ts` | pins: tile split-share memory across close/reopen |
| `apps/desktop/src/components/pane-shell/tree/pane-toggle-visibility.test.ts` | pins: a hide-style pane stacked behind a sibling tab |
| `apps/desktop/src/components/pane-shell/tree/parked-panes.ts` | PARKED PANES — registered contributions that are deliberately OUT of the |
| `apps/desktop/src/components/pane-shell/tree/plugin-pane-close.test.ts` | pins: closing plugin panes |
| `apps/desktop/src/components/pane-shell/tree/preset-tree.test.ts` | pins: stripPresetLivePanes |
| `apps/desktop/src/components/pane-shell/tree/preset-tree.ts` | A named layout preset is GEOMETRY (splits, rails, weights, which zones are |
| `apps/desktop/src/components/pane-shell/tree/presets.test.ts` | pins: user layout presets stay geometry-only (#94260) |
| `apps/desktop/src/components/pane-shell/tree/presets.ts` | Layout presets — the FancyZones treatment. |
| `apps/desktop/src/components/pane-shell/tree/reactive-unhide.test.ts` | pins: reactive pane unhide |
| `apps/desktop/src/components/pane-shell/tree/remove-pane.test.ts` | pins: removePane close-neighbor selection |
| `apps/desktop/src/components/pane-shell/tree/renderer/collapse-restore-affordance.test.tsx` | pins: Sessions/Bots strip — #91223 |
| `apps/desktop/src/components/pane-shell/tree/renderer/drag-session.ts` | THE in-app drag primitive. One pointer-capture session (`startDragSession`) |
| `apps/desktop/src/components/pane-shell/tree/renderer/edit-bar.tsx` | Edit-mode palette — the floating, draggable "Layouts" card shown while |
| `apps/desktop/src/components/pane-shell/tree/renderer/floating-mode-memory.test.tsx` | test file (no top-level describe/it name matched) |
| `apps/desktop/src/components/pane-shell/tree/renderer/floating-panes.test.tsx` | pins: FloatingPanes (live DOM) |
| `apps/desktop/src/components/pane-shell/tree/renderer/floating-panes.tsx` | Floating panes — the tree's non-tiling placement. |
| `apps/desktop/src/components/pane-shell/tree/renderer/floating-rect.test.ts` | pins: anchoredRect |
| `apps/desktop/src/components/pane-shell/tree/renderer/floating-rect.ts` | Floating-pane geometry — pure, so the clamping/anchoring rules are testable |
| `apps/desktop/src/components/pane-shell/tree/renderer/index.tsx` | Layout tree renderer (root). |
| `apps/desktop/src/components/pane-shell/tree/renderer/keep-alive-panes.test.tsx` | pins: keeps a live body continuously connected across replacement IDs, ancestry and missing placement |
| `apps/desktop/src/components/pane-shell/tree/renderer/keep-alive-panes.tsx` | Own the live bodies outside the replaceable split/group tree. Neither React |
| `apps/desktop/src/components/pane-shell/tree/renderer/layout-picker.tsx` | Layout picker — the preset card grid inside the edit palette. Thumbnails |
| `apps/desktop/src/components/pane-shell/tree/renderer/main-placement-floor.test.tsx` | pins: subtreeGone |
| `apps/desktop/src/components/pane-shell/tree/renderer/narrow-overlays.test.tsx` | pins: narrow overlay of a stacked zone |
| `apps/desktop/src/components/pane-shell/tree/renderer/narrow-overlays.tsx` | Narrow-viewport edge overlays — the tree's take on the app's hover-reveal |
| `apps/desktop/src/components/pane-shell/tree/renderer/pane-body.tsx` | Wraps the body's own element (the zone's right-click menu) WITHOUT an |
| `apps/desktop/src/components/pane-shell/tree/renderer/panel-titlebar-lifecycle.test.tsx` | pins: titlebar reservation lifecycle |
| `apps/desktop/src/components/pane-shell/tree/renderer/panel-titlebar.test.tsx` | pins: usePanelTitlebar |
| `apps/desktop/src/components/pane-shell/tree/renderer/panel-titlebar.ts` | The window-chrome inputs that move the fixed titlebar clusters without |
| `apps/desktop/src/components/pane-shell/tree/renderer/strip-visibility.test.ts` | pins: auto (no stored choice) |
| `apps/desktop/src/components/pane-shell/tree/renderer/strip-visibility.ts` | Does this zone show its tab strip? One resolver, one precedence order, so |
| `apps/desktop/src/components/pane-shell/tree/renderer/tab-close-affordance.test.tsx` | pins: a tab advertises exactly the close gesture it honors |
| `apps/desktop/src/components/pane-shell/tree/renderer/tab-strip-hide.test.tsx` | pins: tab strip hide grammar |
| `apps/desktop/src/components/pane-shell/tree/renderer/tab-strip-scroll.test.ts` | pins: tabStripScrollLeft |
| `apps/desktop/src/components/pane-shell/tree/renderer/tab-strip-scroll.ts` | Keeping the active tab (and the trailing "+") inside a scrolling tab strip. |
| `apps/desktop/src/components/pane-shell/tree/renderer/tool-panel-close.test.tsx` | pins: right-clicking a tool panel tab |
| `apps/desktop/src/components/pane-shell/tree/renderer/track-model-absorber.test.ts` | pins: allFixedAbsorberIndex |
| `apps/desktop/src/components/pane-shell/tree/renderer/track-model.ts` | The TRACK MODEL — how a layout node resolves its size along a split axis. |
| `apps/desktop/src/components/pane-shell/tree/renderer/tree-group.test.tsx` | pins: TreeGroup |
| `apps/desktop/src/components/pane-shell/tree/renderer/tree-group.tsx` | Group node renderer — a ZONE: header strip (tabs when stacked, minimize |
| `apps/desktop/src/components/pane-shell/tree/renderer/tree-node.tsx` | Dispatch a layout node to its renderer — the split/group recursion point. |
| `apps/desktop/src/components/pane-shell/tree/renderer/tree-split-cascade-resize.test.tsx` | pins: TreeSplit cascading expansion |
| `apps/desktop/src/components/pane-shell/tree/renderer/tree-split-sash-preview.test.tsx` | pins: TreeSplit nested section sash preview |
| `apps/desktop/src/components/pane-shell/tree/renderer/tree-split.test.tsx` | pins: TreeSplit sash drag cleanup |
| `apps/desktop/src/components/pane-shell/tree/renderer/tree-split.tsx` | Split node renderer — a flex row/column whose 1px seams double as resize |
| `apps/desktop/src/components/pane-shell/tree/resting-presets.test.ts` | pins: resting presets |
| `apps/desktop/src/components/pane-shell/tree/store.ts` | Layout tree store: one persisted tree replaces paneStates side/band |
| `apps/desktop/src/components/pane-shell/tree/tab-key-hint-state.ts` | One delayed observer; it never consumes or dispatches a key. */ |
| `apps/desktop/src/components/pane-shell/tree/tab-key-hints.test.tsx` | pins: reveals only the shortcut target after a hold and clears on release, blur or capture |
| `apps/desktop/src/components/pane-shell/tree/tab-key-hints.tsx` | Subscribe in the tiny lead, not the pane/transcript subtree. */ |
| `apps/desktop/src/components/pane-shell/tree/tab-selection.ts` | Multi-tab selection on a zone's tab strip — Chrome's tab-selection grammar: |
| `apps/desktop/src/components/pane-shell/tree/tab-slot-shown.test.ts` | pins: activateTreeTabSlot indexes shown panes only |
| `apps/desktop/src/components/pane-shell/tree/tabstrip-migration.test.ts` | pins: migratePersistedTree |
| `apps/desktop/src/components/pane-shell/tree/tool-pane-toggle.test.ts` | pins: binding a tool panel on boot |
| `apps/desktop/src/components/pane-shell/tree/zone-editor-split-preview.test.tsx` | pins: zone editor split preview |
| `apps/desktop/src/components/pane-shell/tree/zone-editor.tsx` | Zone editor — the FancyZones grid editor experience, ported from PowerToys' |
| `apps/desktop/src/components/pane-shell/tree/zones-engine.ts` | FancyZones runtime engine — verbatim port of the drag/highlight internals |
| `apps/desktop/src/components/pane-shell/workspace-scope.test.ts` | pins: workspace scope |
| `apps/desktop/src/components/pane-shell/workspace-scope.ts` | Which workspace surface the window is looking at — sessions, or one exact |
| `apps/desktop/src/components/particles/particle-field.css` | /* ── Particle field ───────────────────────────────────────────────────────── |
| `apps/desktop/src/components/particles/particle-field.tsx` | Reusable float-up particle emitter. It owns the motion (rise + organic sway + |
| `apps/desktop/src/components/pet/floating-pet.tsx` | In-window floating petdex mascot. Always-on-top within the app, draggable, |
| `apps/desktop/src/components/pet/pet-bubble.tsx` | Speech bubble + status glyph for the pet — the "notification" half of the |
| `apps/desktop/src/components/pet/pet-egg-hatch.tsx` | Egg-hatch visuals for the pet generation flow (Cmd-K → Pets → Generate). |
| `apps/desktop/src/components/pet/pet-info-poll.ts` | Cadences for the floating-pet `pet.info` refresh timer. |
| `apps/desktop/src/components/pet/pet-sprite.test.tsx` | pins: PetSprite RAF scheduling |
| `apps/desktop/src/components/pet/pet-sprite.tsx` | Track the effective renderer pixel ratio. Electron page zoom and moving a |
| `apps/desktop/src/components/pet/pet-star-shower.tsx` | Canvas hatch celebration layered over a freshly revealed pet: a one-shot |
| `apps/desktop/src/components/pet/pet-thumb.tsx` | Idle-frame preview for one pet. The backend crops + caches the frame and |
| `apps/desktop/src/components/pet/pixel-egg-sprite.test.tsx` | pins: PixelEggSprite scheduling |
| `apps/desktop/src/components/pet/pixel-egg-sprite.tsx` | Animated pixel egg — the iamcrog "bouncing hatching egg" 12-frame sheet |
| `apps/desktop/src/components/pet/roam-behavior.test.ts` | pins: dwellMs |
| `apps/desktop/src/components/pet/roam-behavior.ts` | Pure decision helpers for the floating pet's wander — the "what to do & when" |
| `apps/desktop/src/components/pet/roam-geometry.test.ts` | pins: overlapsX |
| `apps/desktop/src/components/pet/roam-geometry.ts` | The "where can it stand" layer of the floating pet's wander: it measures the |
| `apps/desktop/src/components/pet/use-pet-roam.test.tsx` | pins: usePetRoam RAF scheduling |
| `apps/desktop/src/components/pet/use-pet-roam.ts` | Run the wander loop (roam opt-in + pet active + in-window + agent at rest). */ |
| `apps/desktop/src/components/pet/use-pet-zoom-gesture.ts` | Where the gesture happened + how much it scaled — lets callers zoom toward the |
| `apps/desktop/src/components/prompt-overlays.test.tsx` | pins: PromptOverlays |
| `apps/desktop/src/components/prompt-overlays.tsx` | Masked master-password card for an external password manager (1Password / Bitwarden). |
| `apps/desktop/src/components/prompt-overlays.vault-code.test.tsx` | pins: answers the vault.code server request with the trimmed code, never the ambient gateway |
| `apps/desktop/src/components/prompt-overlays.vault-save-login.test.tsx` | pins: answers the vault.save_login server request with identifier + password as one JSON value |
| `apps/desktop/src/components/prompt-overlays.vault-unlock.test.tsx` | pins: answers the vault.unlock server request with the master password, never the ambient gateway |
| `apps/desktop/src/components/provider-status-chip.test.tsx` | pins: keeps a mixed pool usable and exposes each account rather than a provider-wide empty gauge |
| `apps/desktop/src/components/provider-status-chip.tsx` | A scan-first account list: each row shows its tightest live window as a bar, with exact |
| `apps/desktop/src/components/remote-display-banner.tsx` | GPU acceleration is disabled under remote display (RDP/VNC/etc) to avoid |
| `apps/desktop/src/components/remote-setup/fields.tsx` | Pins only the URL input: an env-owned remote (HERMES_DESKTOP_REMOTE_URL) still signs in here. */ |
| `apps/desktop/src/components/remote-setup/first-run.tsx` | const { t } = useI18n() |
| `apps/desktop/src/components/remote-setup/use-remote-connection-test.ts` | Test/feedback leg of the remote editor: one generation per test, fenced by target and payload. */ |
| `apps/desktop/src/components/remote-setup/use-remote-oauth.ts` | Registry-draft identity for a sign-in that runs BEFORE the draft is |
| `apps/desktop/src/components/remote-setup/use-remote-probe.ts` | type ProbeStatus = 'idle' | 'probing' | 'done' | 'error' |
| `apps/desktop/src/components/remote-setup/use-remote-setup.test.tsx` | pins: remote setup owner |
| `apps/desktop/src/components/remote-setup/use-remote-setup.ts` | Registry-draft identity (id, label, kind, authMode) for a sign-in that |
| `apps/desktop/src/components/send-diagnostics-dialog.tsx` | Send Diagnostics — the consent-gated debug-bundle upload dialog. |
| `apps/desktop/src/components/session-picker.tsx` | Stored id of the session currently open, so it can be flagged in the list. */ |
| `apps/desktop/src/components/shared-metrics/consent-dialog.test.tsx` | pins: SharedMetricsConsentDialog |
| `apps/desktop/src/components/shared-metrics/consent-dialog.tsx` | The focused gateway is open. */ |
| `apps/desktop/src/components/shared-metrics/consent-strip.test.tsx` | pins: SharedMetricsConsentStrip |
| `apps/desktop/src/components/shared-metrics/consent-strip.tsx` | The first-run shared-metrics offer, in the composer status stack beside the |
| `apps/desktop/src/components/status-dot.tsx` | const TONE_BG: Record<StatusTone, string> = { |
| `apps/desktop/src/components/sync-status-card.test.tsx` | pins: a rejected bridge leaves the overlay usable |
| `apps/desktop/src/components/sync-status-card.tsx` | SyncStatusCard — the desktop warning surface for the latest pm/plugin sync |
| `apps/desktop/src/components/sync-status.ts` | Derive display state from a pm receipt — the pure logic behind the |
| `apps/desktop/src/components/tips/index.tsx` | TIP HOST — one per window, renders nothing until the app has something to |
| `apps/desktop/src/components/tips/local-runtime-update-offer.test.tsx` | pins: discards a completed read that waited too long for a quiet tick |
| `apps/desktop/src/components/tips/local-runtime-update-offer.ts` | let snapshot: { readAt: number; status: LocalModelsStatus | null; jobs: LocalRuntimeJob[] } | null = null |
| `apps/desktop/src/components/tips/tip-bubble.tsx` | THE TIP BUBBLE — a pointer, not an overlay. |
| `apps/desktop/src/components/tips/tips.css` | A tip has no scrim and no spotlight — the arrow is the whole mechanism — so |
| `apps/desktop/src/components/tips/tutorial-lifetime.test.tsx` | pins: retires both tutorial features after 30 days across launches, then keeps a manual re-enable |
| `apps/desktop/src/components/tips/use-tip-rotation.test.tsx` | pins: offers the update at the first quiet moment despite tutorial settling and cooldown |
| `apps/desktop/src/components/tips/use-tip-rotation.ts` | The rotation's clock: a few minutes into a launch, then hours apart, offer a |
| `apps/desktop/src/components/ui/__tests__/no-native-title.test.ts` | pins: no native title= on button elements |
| `apps/desktop/src/components/ui/accent-swatch.tsx` | One accent colour as a round swatch; with `onColorChange` it is the custom-colour well. */ |
| `apps/desktop/src/components/ui/action-status.tsx` | idle → saving → done label+icon for action buttons (create / rename / delete…). |
| `apps/desktop/src/components/ui/actions-menu.test.tsx` | test file (no top-level describe/it name matched) |
| `apps/desktop/src/components/ui/actions-menu.tsx` | A menu flavour (dropdown / context) — the item + separator + submenu parts. */ |
| `apps/desktop/src/components/ui/alert.tsx` | 'relative grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground s... |
| `apps/desktop/src/components/ui/avatar-chip.test.tsx` | pins: the identity ladder |
| `apps/desktop/src/components/ui/avatar-chip.tsx` | The square identity chip: a brand glyph on a 16% tint of its own color, or |
| `apps/desktop/src/components/ui/badge.tsx` | Small status/metadata tag. App radius (not a full pill); tones map to the |
| `apps/desktop/src/components/ui/button.tsx` | Working. The label stays in flow but goes invisible and a spinner |
| `apps/desktop/src/components/ui/card-stack.test.tsx` | pins: CardStack completion footprint |
| `apps/desktop/src/components/ui/card-stack.tsx` | Feedback and departure are shared; persistence stays with the consumer. */ |
| `apps/desktop/src/components/ui/checkbox.tsx` | The Checkbox look without a control, for rows that are themselves the toggle |
| `apps/desktop/src/components/ui/chip.tsx` | on ? 'border-primary bg-primary/15' : 'border-transparent bg-muted hover:bg-accent/60' |
| `apps/desktop/src/components/ui/codicon.tsx` | Wrap a codicon as a Tabler-shaped icon for nav rows that expect `IconComponent`. */ |
| `apps/desktop/src/components/ui/color-swatches.tsx` | onChange: (color: null | string) => void |
| `apps/desktop/src/components/ui/command.tsx` | Inline trailing slot, rendered on the right of the search row. */ |
| `apps/desktop/src/components/ui/confirm-dialog-unmount.test.tsx` | pins: the close timer does not fire after unmount |
| `apps/desktop/src/components/ui/confirm-dialog.test.tsx` | pins: ConfirmDialog secondary action |
| `apps/desktop/src/components/ui/confirm-dialog.tsx` | Close as soon as onConfirm resolves — for optimistic actions that finish in the background. */ |
| `apps/desktop/src/components/ui/connector-card.test.tsx` | pins: a row in the card |
| `apps/desktop/src/components/ui/connector-card.tsx` | Presentation leaf: callers own connector semantics and localized copy. |
| `apps/desktop/src/components/ui/connector-logo.tsx` | The least a mark needs: something to name it, and somewhere a logo might |
| `apps/desktop/src/components/ui/context-menu.tsx` | Coordinator marker that survives Radix `asChild` Slot merges. |
| `apps/desktop/src/components/ui/control.ts` | Single source of truth for non-composer form-control chrome — Input, |
| `apps/desktop/src/components/ui/copy-button.tsx` | type CopyPayload = string | (() => Promise<string> | string) |
| `apps/desktop/src/components/ui/decode-text.test.tsx` | pins: resolves once and stops ticking by default |
| `apps/desktop/src/components/ui/decode-text.tsx` | DecodeText — the "CONNECTING" scramble-decode effect as a reusable |
| `apps/desktop/src/components/ui/dialog-dismiss-repro.test.tsx` | pins: REPRO: dismissing an open Select inside a Dialog |
| `apps/desktop/src/components/ui/dialog-portal-context.ts` | Layering system for portalled popovers (Select / Popover / DropdownMenu) that |
| `apps/desktop/src/components/ui/dialog.test.tsx` | pins: DialogContent close button |
| `apps/desktop/src/components/ui/dialog.tsx` | function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) { |
| `apps/desktop/src/components/ui/diff-count.tsx` | Animated `+A −B` line-count, green/red via the top-level theme vars. Each |
| `apps/desktop/src/components/ui/disclosure-caret.tsx` | interface DisclosureCaretProps extends Omit<CodiconProps, 'name'> { |
| `apps/desktop/src/components/ui/drop-affordance.tsx` | Shared drag-and-drop visual language — ONE dashed accent sheet, used by every |
| `apps/desktop/src/components/ui/dropdown-menu.test.tsx` | pins: DropdownMenuSearch hover focus |
| `apps/desktop/src/components/ui/dropdown-menu.tsx` | Borderless filter input for a searchable dropdown. Autofocuses, keeps the |
| `apps/desktop/src/components/ui/empty-state.tsx` | Canonical centered empty state (title + description). The default for "no |
| `apps/desktop/src/components/ui/error-state.tsx` | Optional actions row/stack rendered below the copy. */ |
| `apps/desktop/src/components/ui/fade-scroll.test.ts` | pins: scrollEdges |
| `apps/desktop/src/components/ui/fade-scroll.tsx` | How much of a clipped edge the gradient eats. */ |
| `apps/desktop/src/components/ui/fade-text.tsx` | Width of the fade region on the trailing edge. Accepts any CSS length. |
| `apps/desktop/src/components/ui/fan-menu-tooltip.test.tsx` | pins: FanMenu hub tooltip |
| `apps/desktop/src/components/ui/fan-menu.test.ts` | pins: fanOffsets |
| `apps/desktop/src/components/ui/fan-menu.tsx` | A toggle that is ON. Solid primary disc, so it reads from across the room. */ |
| `apps/desktop/src/components/ui/favicon.tsx` | A site's icon, resolved the thorough way. |
| `apps/desktop/src/components/ui/field.tsx` | Shared form-field primitive for dialog forms: a label stacked above its |
| `apps/desktop/src/components/ui/file-type-icon.tsx` | A code-fence language tag (e.g. `ts`, `json`). Used when no `path`. */ |
| `apps/desktop/src/components/ui/generate-button.tsx` | True while a generation is in flight. */ |
| `apps/desktop/src/components/ui/glyph-spinner.css` | * The previous implementation ticked a setInterval and replaced |
| `apps/desktop/src/components/ui/glyph-spinner.test.tsx` | pins: GlyphSpinner |
| `apps/desktop/src/components/ui/glyph-spinner.tsx` | The two custom properties `glyph-spinner.css` reads off the strip to size |
| `apps/desktop/src/components/ui/highlight-matches-model.test.tsx` | pins: folds separators only for model filters and preserves the original marked text |
| `apps/desktop/src/components/ui/highlight-matches.test.tsx` | pins: HighlightMatches |
| `apps/desktop/src/components/ui/highlight-matches.tsx` | Emphasize every case-insensitive occurrence of `query` inside `text` — the |
| `apps/desktop/src/components/ui/input.test.tsx` | pins: Input |
| `apps/desktop/src/components/ui/input.tsx` | Leading adornment rendered inside the field (e.g. a `$` for money). */ |
| `apps/desktop/src/components/ui/kbd.tsx` | 'inline-flex shrink-0 items-center justify-center border [font-family:var(--dt-font-kbd)] font-normal leading-none select-none', |
| `apps/desktop/src/components/ui/keyboard-first.test.ts` | pins: usePointerQuiet |
| `apps/desktop/src/components/ui/keyboard-first.ts` | KEYBOARD-FIRST OVERLAYS — the shared contract for anything you open with a |
| `apps/desktop/src/components/ui/loader.tsx` | point: (progress: number, detailScale: number) => Point |
| `apps/desktop/src/components/ui/log-view.tsx` | Shared raw-log viewer: no bg, hairline border, tight padding, small mono. |
| `apps/desktop/src/components/ui/masonry.css` | grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--masonry-min-width, 17rem)), 1fr)); |
| `apps/desktop/src/components/ui/masonry.tsx` | Native grid lanes when available; measured lanes for older Electron releases. |
| `apps/desktop/src/components/ui/menu.ts` | The one floating-list look. DropdownMenu, Select, and every Popover + cmdk |
| `apps/desktop/src/components/ui/pagination.tsx` | function Pagination({ className, ...props }: React.ComponentProps<'nav'>) { |
| `apps/desktop/src/components/ui/pane-tab.test.tsx` | pins: PaneTab close gestures |
| `apps/desktop/src/components/ui/pane-tab.tsx` | Inset stroke for a vertical tab rail — content-facing edge. */ |
| `apps/desktop/src/components/ui/popover.tsx` | function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) { |
| `apps/desktop/src/components/ui/profile-glyph.test.tsx` | pins: ProfileGlyph |
| `apps/desktop/src/components/ui/profile-glyph.tsx` | A profile's mark, in one place: the default profile is the `home` icon (it |
| `apps/desktop/src/components/ui/progress.tsx` | Completion as a 0–1 fraction; clamped. Ignored when `indeterminate`. */ |
| `apps/desktop/src/components/ui/reel.tsx` | One row that scrolls sideways, snapping each child to the start edge. |
| `apps/desktop/src/components/ui/row-button.test.tsx` | pins: RowButton |
| `apps/desktop/src/components/ui/row-button.tsx` | A full-row / region click target rendered as a real `<button>`: bakes in |
| `apps/desktop/src/components/ui/sandboxed-frame.test.tsx` | pins: sanitizeFrameSandbox |
| `apps/desktop/src/components/ui/sandboxed-frame.tsx` | The sandbox posture guest content gets by default: scripts run, the frame |
| `apps/desktop/src/components/ui/sanitized-input.tsx` | interface SanitizedInputProps extends Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value'> { |
| `apps/desktop/src/components/ui/scroll-area.tsx` | function ScrollArea({ className, children, ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) { |
| `apps/desktop/src/components/ui/search-field.test.tsx` | pins: SearchField |
| `apps/desktop/src/components/ui/search-field.tsx` | Data-driven placeholder suggestions ("Try \u201ccreative\u201d") — one is picked at |
| `apps/desktop/src/components/ui/segmented-control.tsx` | Dims the whole track and blocks selection (e.g. gated behind a prerequisite). */ |
| `apps/desktop/src/components/ui/select.tsx` | function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) { |
| `apps/desktop/src/components/ui/separator.tsx` | 'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=ve... |
| `apps/desktop/src/components/ui/setup-field-list.tsx` | onChange: (name: string, value: string) => void |
| `apps/desktop/src/components/ui/setup-form-dialog.tsx` | setup: (server: string) => string |
| `apps/desktop/src/components/ui/sheet.tsx` | function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) { |
| `apps/desktop/src/components/ui/sidebar.tsx` | const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7 |
| `apps/desktop/src/components/ui/skeleton.tsx` | Inline pulsing chip standing in for a small count/badge while it loads. */ |
| `apps/desktop/src/components/ui/slider.tsx` | The one range control: a hairline track in the app's stroke tint with the |
| `apps/desktop/src/components/ui/split-button.tsx` | The id of the action the primary button runs (the user's current default). */ |
| `apps/desktop/src/components/ui/status-pulse.test.tsx` | pins: StatusPulse |
| `apps/desktop/src/components/ui/status-pulse.tsx` | A finite status pulse with a real sleep between plays. |
| `apps/desktop/src/components/ui/switch.tsx` | 'peer inline-flex shrink-0 items-center rounded-full border border-[color-mix(in_srgb,var(--dt-foreground)_18%,transparent)] bg-[color-mix(in_srgb,... |
| `apps/desktop/src/components/ui/tab-dropdown.tsx` | Indent as a sub-item (flattened nested nav). */ |
| `apps/desktop/src/components/ui/tabs.tsx` | function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) { |
| `apps/desktop/src/components/ui/text-tab.tsx` | function TextTabMeta({ className, ...props }: React.ComponentProps<'span'>) { |
| `apps/desktop/src/components/ui/textarea.tsx` | function Textarea({ className, size, ...props }: React.ComponentProps<'textarea'> & ControlVariantProps) { |
| `apps/desktop/src/components/ui/title-menu-trigger.tsx` | Compact "Label ▾" chrome trigger. Domain-agnostic — drop in as the child of |
| `apps/desktop/src/components/ui/tool-icon.tsx` | Filled tool glyph. Falls back to the outline codicon font for any name not |
| `apps/desktop/src/components/ui/tooltip-pane-layout.test.tsx` | pins: opens a tip whose nearest tree-group host has no layout |
| `apps/desktop/src/components/ui/tooltip-placement.test.tsx` | pins: tooltip placement |
| `apps/desktop/src/components/ui/tooltip-placement.ts` | Preferred sides express intent; Radix still flips and shifts for available space. */ |
| `apps/desktop/src/components/ui/tooltip-rail-edge.test.tsx` | test file (no top-level describe/it name matched) |
| `apps/desktop/src/components/ui/tooltip.css` | max-width: min(24rem, calc(100vw - 1.5rem), var(--radix-tooltip-content-available-width, 24rem)); |
| `apps/desktop/src/components/ui/tooltip.test.tsx` | pins: suppressNonKeyboardFocusOpen |
| `apps/desktop/src/components/ui/tooltip.tsx` | Default hover-open delay for `Tip`. Below 150ms a passing cursor still |
| `apps/desktop/src/components/ui/use-zoom-pan.ts` | Headless pan/zoom transform shared by every zoomable surface (image lightbox, |
| `apps/desktop/src/components/ui/zoomable-fit.test.tsx` | pins: Zoomable overlay fit |
| `apps/desktop/src/components/ui/zoomable.test.tsx` | pins: Zoomable |
| `apps/desktop/src/components/ui/zoomable.tsx` | Inline content; also the default full-view content. */ |
| `apps/desktop/src/components/update-hold-overlay.tsx` | The blocked boot screen (review R8 D3). While an earlier update's leftover |
| `apps/desktop/src/components/update-status.test.tsx` | pins: deriveUpdateStatus |
| `apps/desktop/src/components/update-status.tsx` | One status derivation for every "am I up to date?" surface (About page, |
| `apps/desktop/src/components/version-details.test.tsx` | pins: VersionDetails |
| `apps/desktop/src/components/version-details.tsx` | Human label for an external build's runtime source: the resolution rung |
| `apps/desktop/src/contrib/events.ts` | The plugin-facing gateway event tap. The wiring fans every inbound gateway |
| `apps/desktop/src/contrib/index.ts` | module body (no leading doc line) |
| `apps/desktop/src/contrib/kanban-i18n.test.tsx` | pins: relabels Kanban after delayed config load and locale switches without replacing the board or bindings |
| `apps/desktop/src/contrib/plugin-pet.test.tsx` | pins: ctx.pet — plugin lines in the core pet bubble |
| `apps/desktop/src/contrib/plugin-run-action.test.ts` | pins: ctx.runAction — plugins run built-in app actions |
| `apps/desktop/src/contrib/plugin.test.ts` | pins: createPluginContext.onDispose |
| `apps/desktop/src/contrib/plugin.ts` | The plugin authoring contract. A plugin is a file that default-exports a |
| `apps/desktop/src/contrib/plugins-store.ts` | PLUGIN INVENTORY — the reactive record of every desktop plugin the app |
| `apps/desktop/src/contrib/plugins.ts` | Plugin discovery — both delivery modes: |
| `apps/desktop/src/contrib/radio-artist-links.test.ts` | pins: Radio artist credits |
| `apps/desktop/src/contrib/radio-plugin.test.ts` | pins: bundled Radio plugin |
| `apps/desktop/src/contrib/react/boundary.tsx` | Contribution key, shown in the fallback + console tag. */ |
| `apps/desktop/src/contrib/react/contribute.tsx` | Mount-scoped contribution — the "reverse portal" companion to `Slot`. |
| `apps/desktop/src/contrib/react/slot.test.tsx` | pins: Slot contribution render boundary |
| `apps/desktop/src/contrib/react/slot.tsx` | Area id whose contributions render inline, in order. */ |
| `apps/desktop/src/contrib/react/use-contributions.ts` | Subscribe to the resolved contributions for an area. The subscription is |
| `apps/desktop/src/contrib/registry.test.ts` | pins: registry.getArea |
| `apps/desktop/src/contrib/registry.ts` | Bumped on every registry mutation — the reactive hook for non-React |
| `apps/desktop/src/contrib/runtime-loader.test.ts` | pins: scanDiskPlugins (#66899) |
| `apps/desktop/src/contrib/runtime-loader.ts` | Runtime plugin loader — plugins as CODE, not registry edits, loaded after |
| `apps/desktop/src/contrib/settings-pages.test.ts` | pins: ctx.registerSettingsPage |
| `apps/desktop/src/contrib/settings-pages.ts` | Settings ▸ Plugins — one home for every plugin's preferences, WoW-AddOns |
| `apps/desktop/src/contrib/types.ts` | Where a contribution came from. `'core'` is the app's own default UI; |
| `apps/desktop/src/debug/README.md` | Two counters that answer, for any interaction: **what re-rendered, why, and |
| `apps/desktop/src/debug/atom-churn.ts` | Times the store notified its listeners. */ |
| `apps/desktop/src/debug/dev-only.noop.ts` | Production stand-in for `dev-only.ts`. `vite.config.ts` aliases the dev |
| `apps/desktop/src/debug/dev-only.ts` | Dev-only diagnostics entry. Statically imported from `main.tsx` ABOVE the |
| `apps/desktop/src/debug/index.ts` | Dev-only state diagnostics: one import, two counters. |
| `apps/desktop/src/debug/perf-live.ts` | One Long Animation Frame, attributed. `styleMs` is the engine's style+layout |
| `apps/desktop/src/debug/render-counter.ts` | Why a component re-rendered, attributed per commit. */ |
| `apps/desktop/src/debug/right-pane-events.ts` | Tiny production-safe callsite; the recorder exists only in dev/perf builds. */ |
| `apps/desktop/src/debug/right-pane-probe.ts` | const eventNames: RightPanePerfEvent[] = [ |
| `apps/desktop/src/debug/watched-atoms.ts` | Streaming hot path — written per token / per delta flush. */ |
| `apps/desktop/src/global.d.ts` | Launch -> ready ms for the first caller per app launch, null afterwards. Absent on older shells. */ |
| `apps/desktop/src/hermes-capability-scope.test.ts` | pins: capability helpers are connection-scoped |
| `apps/desktop/src/hermes-cron-scope.test.ts` | pins: cron helpers are profile-scoped |
| `apps/desktop/src/hermes-parity.test.ts` | pins: Hermes REST parity helpers (hub / mcp / maintenance) |
| `apps/desktop/src/hermes-profile-scope.test.ts` | pins: backend action helpers are profile-scoped |
| `apps/desktop/src/hermes.test.ts` | pins: Hermes REST helpers |
| `apps/desktop/src/hermes.ts` | The desktop REST/WS client, split by domain under src/api/. This module is |
| `apps/desktop/src/hooks/use-delayed-true.ts` | Returns true only after `active` has stayed true continuously for `delayMs`. |
| `apps/desktop/src/hooks/use-grab-scroll.ts` | True while a pan is in flight — drive `cursor-grabbing` styling. */ |
| `apps/desktop/src/hooks/use-image-download.test.ts` | pins: imageFilename |
| `apps/desktop/src/hooks/use-image-download.ts` | Filename for a browser-anchor download. Generated-image URLs (fal.media |
| `apps/desktop/src/hooks/use-media-image.frames.test.tsx` | pins: inline image preview envelope (#74564) |
| `apps/desktop/src/hooks/use-media-image.test.tsx` | pins: useMediaImage gateway proxy fallback (#74564) |
| `apps/desktop/src/hooks/use-media-image.ts` | Keep a frame for one source/owner for its mounted lifetime. Hints are not |
| `apps/desktop/src/hooks/use-media-query.ts` | Read at call time, not render time: animations check this as they start, and |
| `apps/desktop/src/hooks/use-mobile.ts` | Narrower than this and the sidebar stops being a docked column: it renders |
| `apps/desktop/src/hooks/use-resize-observer.ts` | Observe element resizes. The callback receives the ResizeObserver entries |
| `apps/desktop/src/hooks/use-theme-epoch.ts` | Subscribe to theme repaints imperatively (ref/canvas, no re-render). */ |
| `apps/desktop/src/hooks/use-viewed-interval.ts` | Run a UI-only clock while this document is actually being viewed. |
| `apps/desktop/src/hover-variant.test.ts` | pins: hover variant (Windows hover-reveal) |
| `apps/desktop/src/i18n/ar.ts` | mostStarred: 'الأكثر حصولًا على نجوم', |
| `apps/desktop/src/i18n/ar_artifacts.ts` | noArtifactsDesc: 'ستظهر الصور والملفات والروابط من محادثاتك هنا.', |
| `apps/desktop/src/i18n/ar_assistant.ts` | skill: name => `المهارة ${name}`, |
| `apps/desktop/src/i18n/ar_boot.ts` | desktopBootFailedWithMessage: message => `فشل تشغيل سطح المكتب: ${message}`, |
| `apps/desktop/src/i18n/ar_capabilities.ts` | installTitle: (name: string) => `تثبيت «${name}»؟`, |
| `apps/desktop/src/i18n/ar_chat.ts` | wakingProfile: profile => `جار إيقاظ ${profile}`, |
| `apps/desktop/src/i18n/ar_chrome.ts` | title: 'تعذّر فتح هذا الرابط', |
| `apps/desktop/src/i18n/ar_command_center.ts` | searchPlaceholder: 'ابحث عن أمر أو إعداد...', |
| `apps/desktop/src/i18n/ar_common.ts` | 'يمكن لـ Hermes إحصاء طريقة استخدامك له: طول الجلسات، والنماذج والأدوات التي تعمل، ومتى يفشل شيء ما. لا يسجّل أبدًا رسائلك أو ملفاتك أو مساراتك أو ... |
| `apps/desktop/src/i18n/ar_connectors.ts` | title: 'المتابعة من تطبيق آخر', |
| `apps/desktop/src/i18n/ar_desktop_commands.ts` | Desktop-side /rollback /agents /config /history /save /export /import /timestamps lines |
| `apps/desktop/src/i18n/ar_diagnostics.ts` | title: 'إرسال التشخيصات إلى Nous', |
| `apps/desktop/src/i18n/ar_first_run.ts` | useName: name => `استخدام «${name}»`, |
| `apps/desktop/src/i18n/ar_session_commands.ts` | Typed /undo /retry /steer /queue lines (en_session_commands.ts is the source). |
| `apps/desktop/src/i18n/ar_settings.ts` | description: 'اختر لغة واجهة سطح المكتب.', |
| `apps/desktop/src/i18n/ar_theme_picker.ts` | eliteDetail: 'للمطورين: الطرفية والملفات والفروقات.', |
| `apps/desktop/src/i18n/ar_update_channel.ts` | description: 'المستقر يثبّت الإصدارات المنشورة فقط. «كل التزام» يتبع فرع main مع وصول التغييرات.', |
| `apps/desktop/src/i18n/backend-packs.test.ts` | pins: syncBackendLocalePacks |
| `apps/desktop/src/i18n/backend-packs.ts` | Backend-delivered language packs. A Hermes language-pack plugin (or a user |
| `apps/desktop/src/i18n/bots-advanced.test.tsx` | pins: localizes the advanced editor and hub without translating capability IDs or user data |
| `apps/desktop/src/i18n/bots-cron.test.tsx` | pins: switches scheduling copy without changing a staged schedule or user instruction |
| `apps/desktop/src/i18n/bots-editor.test.tsx` | pins: keeps a new bot draft when the language changes and localizes advanced controls |
| `apps/desktop/src/i18n/canonical-group-labels.test.ts` | pins: provides translated canonical group controls and recovery copy in every supported locale |
| `apps/desktop/src/i18n/catalog-completeness.test.ts` | pins: keeps Updates copy in the locale overlay rather than falling back to English |
| `apps/desktop/src/i18n/catalog.ts` | The catalogs compiled into the app. Runtime-registered languages (plugin |
| `apps/desktop/src/i18n/context.test.tsx` | pins: I18nProvider |
| `apps/desktop/src/i18n/context.tsx` | Reconcile when the window's config owner changes, without remounting its children. */ |
| `apps/desktop/src/i18n/de.ts` | searchPlaceholder: (count: number) => `${count} Apps durchsuchen`, |
| `apps/desktop/src/i18n/de_aux_tasks.ts` | voice_chat: { label: 'Sprachchat', hint: 'Gesprochene Antworten im Sprachmodus' }, |
| `apps/desktop/src/i18n/de_boot.ts` | The boot screen's copy (including the update-hold screen), composed by de.ts. |
| `apps/desktop/src/i18n/de_clarify.ts` | notReady: 'Klärungsanfrage ist noch nicht bereit', |
| `apps/desktop/src/i18n/de_connector_accounts.ts` | count: (count: number) => `${count} ${count === 1 ? 'Konto' : 'Konten'}`, |
| `apps/desktop/src/i18n/de_connector_card.ts` | title: 'Verbinden Sie Ihre Apps', |
| `apps/desktop/src/i18n/de_desktop_commands.ts` | Desktop-side /rollback /agents /config /history /save /export /import /timestamps lines |
| `apps/desktop/src/i18n/de_first_run.ts` | useName: name => `„${name}“ verwenden`, |
| `apps/desktop/src/i18n/de_local_models.ts` | connectionChanged: 'Verbindung für lokale Modelle geändert', |
| `apps/desktop/src/i18n/de_model_menu.ts` | pickDeferred: (model: string) => `${model} gilt ab deiner nächsten Nachricht`, |
| `apps/desktop/src/i18n/de_model_settings.ts` | setUpProvider: name => `${name} einrichten`, |
| `apps/desktop/src/i18n/de_notices.ts` | Shell notices (remote-display toast, butterbar, keep-awake offer), spread into de.ts. |
| `apps/desktop/src/i18n/de_onboarding.ts` | headerTitle: 'Hermes Agent für Sie einrichten', |
| `apps/desktop/src/i18n/de_plugin_update.ts` | Copy for updating an installed plugin (Plugins tab): catalog re-pin consent and the security-scan override. */ |
| `apps/desktop/src/i18n/de_projects.ts` | Die Projekt-Sektion der Sidebar, zusammengesetzt von de.ts. |
| `apps/desktop/src/i18n/de_session_commands.ts` | Typed /undo /retry /steer /queue lines (en_session_commands.ts is the source). |
| `apps/desktop/src/i18n/de_shared_metrics.ts` | 'Hermes kann zählen, wie Sie es nutzen: Sitzungsdauer, welche Modelle und Tools laufen und wann etwas fehlschlägt. Ihre Nachrichten, Dateien, Pfade... |
| `apps/desktop/src/i18n/de_theme_picker.ts` | basicDetail: 'Zum Chatten mit Hermes.', |
| `apps/desktop/src/i18n/de_update_channel.ts` | 'Stabil installiert nur veröffentlichte Releases. Jeder Commit folgt dem main-Branch, sobald Änderungen eintreffen.', |
| `apps/desktop/src/i18n/define-locale.ts` | export type TranslationOverrides = TranslationOverride<Translations> |
| `apps/desktop/src/i18n/en.ts` | English editorial copy stays in the shipped JSONL; other locales override it. |
| `apps/desktop/src/i18n/en_app_tour.ts` | sessions: { title: 'Your chats', text: 'Every conversation lives here. Search, pin or reopen any of them.' }, |
| `apps/desktop/src/i18n/en_aux_tasks.ts` | vision: { label: 'Vision', hint: 'Image analysis' }, |
| `apps/desktop/src/i18n/en_billing.ts` | Out-of-credits overlay copy (Nous vs. third-party providers), spread into en.ts. |
| `apps/desktop/src/i18n/en_boot.ts` | The boot screen's copy (including the update-hold screen), composed by en.ts. |
| `apps/desktop/src/i18n/en_catalog.ts` | installTitle: (name: string) => `Install “${name}”?`, |
| `apps/desktop/src/i18n/en_catalog_install.ts` | skill: name => `skill ${name}`, |
| `apps/desktop/src/i18n/en_clarify.ts` | notReady: 'Clarify request is not ready yet', |
| `apps/desktop/src/i18n/en_connector_accounts.ts` | count: (count: number) => `${count} account${count === 1 ? '' : 's'}`, |
| `apps/desktop/src/i18n/en_connector_card.ts` | waiting: 'Waiting for your browser…', |
| `apps/desktop/src/i18n/en_deep_links.ts` | installTitle: (name: string) => `Install “${name}”?`, |
| `apps/desktop/src/i18n/en_desktop_commands.ts` | Desktop-side /rollback /agents /config /history /save /export /import /timestamps lines. |
| `apps/desktop/src/i18n/en_error_layers.ts` | The error card's layer fallbacks (lib/error-surface-copy.ts): used when a failure code has no own entry. |
| `apps/desktop/src/i18n/en_external_open.ts` | title: 'Couldn’t open this link', |
| `apps/desktop/src/i18n/en_first_run.ts` | useName: name => `Use “${name}”`, |
| `apps/desktop/src/i18n/en_local_models.ts` | connectionChanged: 'Local models connection changed', |
| `apps/desktop/src/i18n/en_model_menu.ts` | pickDeferred: (model: string) => `${model} applies from your next message`, |
| `apps/desktop/src/i18n/en_model_settings.ts` | setUpProvider: name => `Set up ${name}`, |
| `apps/desktop/src/i18n/en_notices.ts` | Shell notices (remote-display toast, butterbar, keep-awake offer), spread into en.ts. |
| `apps/desktop/src/i18n/en_onboarding.ts` | headerTitle: "Let's get you setup with Hermes Agent", |
| `apps/desktop/src/i18n/en_plugin_update.ts` | Copy for updating an installed plugin (Plugins tab): catalog re-pin consent and the security-scan override. */ |
| `apps/desktop/src/i18n/en_projects.ts` | The sidebar's projects-section copy, composed by en.ts. |
| `apps/desktop/src/i18n/en_session_commands.ts` | Typed /undo /retry /steer /queue lines: the Ink TUI's wording on the same gateway. |
| `apps/desktop/src/i18n/en_shared_metrics.ts` | 'Hermes can count how you use it: session length, which models and tools run, and when something fails. It never records your messages, files, path... |
| `apps/desktop/src/i18n/en_theme_picker.ts` | basicDetail: 'For talking to Hermes.', |
| `apps/desktop/src/i18n/en_uninstall_section.ts` | Settings > About > Uninstall, composed by en.ts as `settings.uninstallSection`. |
| `apps/desktop/src/i18n/en_update_channel.ts` | description: 'Stable installs published releases only. Every commit follows the main branch as changes land.', |
| `apps/desktop/src/i18n/es.ts` | searchPlaceholder: (count: number) => `Buscar entre ${count} apps`, |
| `apps/desktop/src/i18n/es_aux_tasks.ts` | hint: 'Enrutamiento de herramientas MCP' |
| `apps/desktop/src/i18n/es_boot.ts` | The boot screen's copy (including the update-hold screen), composed by es.ts. |
| `apps/desktop/src/i18n/es_clarify.ts` | notReady: 'La solicitud de aclaración aún no está lista', |
| `apps/desktop/src/i18n/es_connector_accounts.ts` | count: (count: number) => `${count} cuenta${count === 1 ? '' : 's'}`, |
| `apps/desktop/src/i18n/es_connector_card.ts` | failed: 'No se pudo conectar', |
| `apps/desktop/src/i18n/es_desktop_commands.ts` | Desktop-side /rollback /agents /config /history /save /export /import /timestamps lines |
| `apps/desktop/src/i18n/es_first_run.ts` | useName: name => `Usar «${name}»`, |
| `apps/desktop/src/i18n/es_local_models.ts` | connectionChanged: 'Cambió la conexión de los modelos locales', |
| `apps/desktop/src/i18n/es_model_menu.ts` | pickDeferred: (model: string) => `${model} se aplica desde tu próximo mensaje`, |
| `apps/desktop/src/i18n/es_model_settings.ts` | setUpProvider: name => `Configurar ${name}`, |
| `apps/desktop/src/i18n/es_notices.ts` | Shell notices (remote-display toast, butterbar, keep-awake offer), spread into es.ts. |
| `apps/desktop/src/i18n/es_onboarding.ts` | headerTitle: 'Vamos a configurar Hermes Agent', |
| `apps/desktop/src/i18n/es_plugin_update.ts` | Copy for updating an installed plugin (Plugins tab): catalog re-pin consent and the security-scan override. */ |
| `apps/desktop/src/i18n/es_projects.ts` | La sección de proyectos de la barra lateral, compuesta por es.ts. |
| `apps/desktop/src/i18n/es_session_commands.ts` | Typed /undo /retry /steer /queue lines (en_session_commands.ts is the source). |
| `apps/desktop/src/i18n/es_shared_metrics.ts` | consentTitle: '¿Compartir estadísticas de uso?', |
| `apps/desktop/src/i18n/es_theme_picker.ts` | basicDetail: 'Para hablar con Hermes.', |
| `apps/desktop/src/i18n/es_update_channel.ts` | description: 'Estable instala solo versiones publicadas. Cada commit sigue la rama main a medida que llegan cambios.', |
| `apps/desktop/src/i18n/fr.ts` | searchPlaceholder: (count: number) => `Rechercher parmi ${count} applications`, |
| `apps/desktop/src/i18n/fr_aux_tasks.ts` | hint: 'Sous-agent de révision /review' |
| `apps/desktop/src/i18n/fr_boot.ts` | The boot screen's copy (including the update-hold screen), composed by fr.ts. |
| `apps/desktop/src/i18n/fr_clarify.ts` | notReady: "La demande de clarification n'est pas encore prête", |
| `apps/desktop/src/i18n/fr_connector_accounts.ts` | count: (count: number) => `${count} compte${count === 1 ? '' : 's'}`, |
| `apps/desktop/src/i18n/fr_connector_card.ts` | checking: 'Vérification de vos applications…', |
| `apps/desktop/src/i18n/fr_desktop_commands.ts` | Desktop-side /rollback /agents /config /history /save /export /import /timestamps lines |
| `apps/desktop/src/i18n/fr_first_run.ts` | useName: name => `Utiliser « ${name} »`, |
| `apps/desktop/src/i18n/fr_local_models.ts` | connectionChanged: 'La connexion des modèles locaux a changé', |
| `apps/desktop/src/i18n/fr_model_menu.ts` | pickDeferred: (model: string) => `${model} s’applique à partir de votre prochain message`, |
| `apps/desktop/src/i18n/fr_model_settings.ts` | setUpProvider: name => `Configurer ${name}`, |
| `apps/desktop/src/i18n/fr_notices.ts` | Shell notices (remote-display toast, butterbar, keep-awake offer), spread into fr.ts. |
| `apps/desktop/src/i18n/fr_onboarding.ts` | headerTitle: 'Configurons Hermes Agent pour vous', |
| `apps/desktop/src/i18n/fr_plugin_update.ts` | Copy for updating an installed plugin (Plugins tab): catalog re-pin consent and the security-scan override. */ |
| `apps/desktop/src/i18n/fr_projects.ts` | La section projets de la barre latérale, composée par fr.ts. |
| `apps/desktop/src/i18n/fr_session_commands.ts` | Typed /undo /retry /steer /queue lines (en_session_commands.ts is the source). |
| `apps/desktop/src/i18n/fr_shared_metrics.ts` | consentTitle: 'Partager les statistiques d’utilisation ?', |
| `apps/desktop/src/i18n/fr_theme_picker.ts` | themeAccent: 'Par défaut du thème', |
| `apps/desktop/src/i18n/fr_update_channel.ts` | title: 'Canal de mise à jour', |
| `apps/desktop/src/i18n/index.ts` | module body (no leading doc line) |
| `apps/desktop/src/i18n/intro-de.ts` | Display-only translations, in the stock JSONL's per-personality rotation order. */ |
| `apps/desktop/src/i18n/intro-es.ts` | Display-only translations, in the stock JSONL's per-personality rotation order. */ |
| `apps/desktop/src/i18n/intro-fr.ts` | Display-only translations, in the stock JSONL's per-personality rotation order. */ |
| `apps/desktop/src/i18n/intro-ja.ts` | Display-only translations, in the stock JSONL's per-personality rotation order. */ |
| `apps/desktop/src/i18n/intro-zh-hant.ts` | Display-only translations, in the stock JSONL's per-personality rotation order. */ |
| `apps/desktop/src/i18n/intro-zh.ts` | Display-only translations, in the stock JSONL's per-personality rotation order. */ |
| `apps/desktop/src/i18n/ja.ts` | deleteTitle: name => `${name} を削除しますか？`, |
| `apps/desktop/src/i18n/ja_aux_tasks.ts` | vision: { label: 'ビジョン', hint: '画像分析' }, |
| `apps/desktop/src/i18n/ja_boot.ts` | The boot screen's copy, composed by ja.ts. |
| `apps/desktop/src/i18n/ja_catalog.ts` | installTitle: (name: string) => `「${name}」をインストールしますか？`, |
| `apps/desktop/src/i18n/ja_clarify.ts` | questionProgress: (answered, total) => `${total}問中${answered}問回答済み`, |
| `apps/desktop/src/i18n/ja_connectors.ts` | receiptConnected: apps => `接続済み: ${apps}`, |
| `apps/desktop/src/i18n/ja_desktop_commands.ts` | Desktop-side /rollback /agents /config /history /save /export /import /timestamps lines |
| `apps/desktop/src/i18n/ja_first_run.ts` | export const jaFirstRun: FirstRunCopy = { |
| `apps/desktop/src/i18n/ja_local_models.ts` | runtimeReady: backend => `準備完了 · ${backend}`, |
| `apps/desktop/src/i18n/ja_model_menu.ts` | pickDeferred: (model: string) => `${model} は次のメッセージから適用されます`, |
| `apps/desktop/src/i18n/ja_model_settings.ts` | setUpProvider: name => `${name} を設定`, |
| `apps/desktop/src/i18n/ja_notices.ts` | Shell notices (remote-display toast, butterbar, keep-awake offer), spread into ja.ts. |
| `apps/desktop/src/i18n/ja_onboarding.ts` | preparingInstall: 'Hermes はインストールを完了中です。初回実行では通常 1 分以内に完了します。', |
| `apps/desktop/src/i18n/ja_plugins.ts` | Japanese copy for the plugin settings surfaces: Settings ▸ Plugins pages and |
| `apps/desktop/src/i18n/ja_projects.ts` | showAllCount: count => `${count} 件のセッションをすべて表示`, |
| `apps/desktop/src/i18n/ja_session_commands.ts` | Typed /undo /retry /steer /queue lines (en_session_commands.ts is the source). |
| `apps/desktop/src/i18n/ja_shared_metrics.ts` | collectedMachine: 'マシン：OS、RAM の範囲、GPU の種類、Hermes のバージョン、ローカルモデルの使用', |
| `apps/desktop/src/i18n/ja_theme_picker.ts` | export const jaThemePicker: ThemePickerCopy = { |
| `apps/desktop/src/i18n/ja_update_channel.ts` | branch: (b: string) => `ブランチ: ${b}`, |
| `apps/desktop/src/i18n/languages.test.ts` | pins: desktop i18n languages |
| `apps/desktop/src/i18n/languages.ts` | Native name shown in the picker (`Polski`). */ |
| `apps/desktop/src/i18n/localized-tab-title.tsx` | Render-time pane TAB label for panes registered outside React. |
| `apps/desktop/src/i18n/overlay-completeness.test.ts` | pins: adds no untranslated key to any locale overlay beyond the known gaps |
| `apps/desktop/src/i18n/overlay-gaps.json` | module body (no leading doc line) |
| `apps/desktop/src/i18n/plugin-i18n.test.tsx` | pins: plugin locale registry |
| `apps/desktop/src/i18n/plugin-i18n.ts` | Plugin-scoped i18n — the `ctx.storage` analog for locale bundles. A plugin |
| `apps/desktop/src/i18n/profile-locale.test.tsx` | pins: reads and persists the owning profile through A → B → A and restart |
| `apps/desktop/src/i18n/profile-provider.tsx` | Keep gateway/store imports outside the shared i18n context's import graph. */ |
| `apps/desktop/src/i18n/registry.test.ts` | pins: registerAppLocale |
| `apps/desktop/src/i18n/registry.ts` | App-locale registry — the runtime half of the desktop catalog. `TRANSLATIONS` |
| `apps/desktop/src/i18n/ru.ts` | RU_PLURAL: (count, one, few, many) — русские формы сущ. падежа |
| `apps/desktop/src/i18n/ru_aux_tasks.ts` | vision: { label: 'Зрение', hint: 'Анализ изображений' }, |
| `apps/desktop/src/i18n/ru_boot.ts` | The boot screen's copy, composed by ru.ts. |
| `apps/desktop/src/i18n/ru_catalog.ts` | const resultWord = (count: number) => { |
| `apps/desktop/src/i18n/ru_clarify.ts` | notReady: 'Запрос уточнения ещё не готов', |
| `apps/desktop/src/i18n/ru_connectors.ts` | receiptConnected: apps => `Подключены: ${apps}`, |
| `apps/desktop/src/i18n/ru_desktop_commands.ts` | Desktop-side /rollback /agents /config /history /save /export /import /timestamps lines |
| `apps/desktop/src/i18n/ru_first_run.ts` | useName: name => `Использовать «${name}»`, |
| `apps/desktop/src/i18n/ru_model_menu.ts` | pickDeferred: (model: string) => `${model} применится со следующего сообщения`, |
| `apps/desktop/src/i18n/ru_model_settings.ts` | 'Настройте именованные пресеты, которые появятся как модели провайдера Mixture of Agents. Модель-агрегатор выполняет каждый шаг цикла инструментов;... |
| `apps/desktop/src/i18n/ru_notices.ts` | Shell notices (remote-display toast, butterbar, keep-awake offer), spread into ru.ts. |
| `apps/desktop/src/i18n/ru_onboarding.ts` | headerTitle: 'Настроим для вас Hermes Agent', |
| `apps/desktop/src/i18n/ru_plugins.ts` | Russian copy for the plugin settings surfaces: Settings ▸ Plugins pages and |
| `apps/desktop/src/i18n/ru_projects.ts` | Тексты секции проектов в боковой панели; подключается из ru.ts. |
| `apps/desktop/src/i18n/ru_session_commands.ts` | Typed /undo /retry /steer /queue lines (en_session_commands.ts is the source). |
| `apps/desktop/src/i18n/ru_shared_metrics.ts` | 'Hermes может подсчитывать, как вы им пользуетесь: длительность сеансов, какие модели и инструменты запускаются и когда что-то идёт не так. Он нико... |
| `apps/desktop/src/i18n/ru_theme_picker.ts` | basicDetail: 'Для общения с Hermes.', |
| `apps/desktop/src/i18n/ru_update_channel.ts` | 'Стабильный устанавливает только опубликованные релизы. «Каждый коммит» следует за веткой main по мере изменений.', |
| `apps/desktop/src/i18n/runtime.test.ts` | pins: desktop i18n runtime translator |
| `apps/desktop/src/i18n/runtime.ts` | The language `display.language` asked for, normalized but NOT yet checked |
| `apps/desktop/src/i18n/types.ts` | The locales compiled into the app (`TRANSLATIONS`). */ |
| `apps/desktop/src/i18n/types_app_tour.ts` | The app's own tour, run when `gui_tour` starts with no steps. */ |
| `apps/desktop/src/i18n/types_aux_tasks.ts` | Copy for one built-in auxiliary-model slot row (Settings → Models → Auxiliary models). */ |
| `apps/desktop/src/i18n/types_billing.ts` | Out-of-credits overlay copy; `Translations` spreads this in. |
| `apps/desktop/src/i18n/types_boot.ts` | The boot screen's string surface (including the update-hold screen); `Translations.boot`. |
| `apps/desktop/src/i18n/types_catalog.ts` | installTitle: (name: string) => string |
| `apps/desktop/src/i18n/types_catalog_install.ts` | Copy for the desktop catalog-install card (`manage_catalog`) and its Advanced dialog. */ |
| `apps/desktop/src/i18n/types_clarify.ts` | The clarify question card. */ |
| `apps/desktop/src/i18n/types_connectors.ts` | The chat's directory card (`manage_connections` display) and the line it collapses to. */ |
| `apps/desktop/src/i18n/types_deep_links.ts` | Opening a skill install link. */ |
| `apps/desktop/src/i18n/types_desktop_commands.ts` | Transcript lines for the Desktop-side /rollback /agents /config /history /save /export /import |
| `apps/desktop/src/i18n/types_external_open.ts` | export interface ExternalOpenFailedCopy { |
| `apps/desktop/src/i18n/types_first_run.ts` | First-run onboarding: the setup_beat cards and their receipts, Skip setup, the local-model offer |
| `apps/desktop/src/i18n/types_model_menu.ts` | A pick made while a turn runs: the owner records it for the next turn. */ |
| `apps/desktop/src/i18n/types_model_settings.ts` | Settings → Model; `Translations.settings.model`. |
| `apps/desktop/src/i18n/types_notices.ts` | An explicit retry of a send whose identityless (legacy) acknowledgement was lost. */ |
| `apps/desktop/src/i18n/types_onboarding.ts` | apiKeyOptions: Record<string, { short: string; description: string }> |
| `apps/desktop/src/i18n/types_plugin_update.ts` | Copy for updating an installed plugin (Plugins tab): catalog re-pin consent and the security-scan override. */ |
| `apps/desktop/src/i18n/types_projects.ts` | The sidebar projects section's copy shape; `Translations.sidebar.projects`. |
| `apps/desktop/src/i18n/types_shared_metrics.ts` | stripChoices: { share: string; off: string } |
| `apps/desktop/src/i18n/types_theme_picker.ts` | The set_theme picker cards in the chat and their settled receipt. */ |
| `apps/desktop/src/i18n/types_uninstall_section.ts` | Settings > About > Uninstall; `Translations.settings.uninstallSection`. |
| `apps/desktop/src/i18n/types_update_channel.ts` | About ▸ Updates: the source checkout's update channel selector. */ |
| `apps/desktop/src/i18n/zh-hant.ts` | installTitle: (name: string) => `安裝「${name}」？`, |
| `apps/desktop/src/i18n/zh-hant_artifacts.ts` | rangeOf: (start, end, total) => `${start}-${end}，共 ${total}`, |
| `apps/desktop/src/i18n/zh-hant_assistant.ts` | skill: name => `技能 ${name}`, |
| `apps/desktop/src/i18n/zh-hant_boot.ts` | 'Still retrying in the background. You can keep reading and drafting — open Gateway settings if this persists.', |
| `apps/desktop/src/i18n/zh-hant_capabilities.ts` | pickerHint: '按下任一技能的「+ Add to this Agent」，即可安裝並顯示在上方清單中。' |
| `apps/desktop/src/i18n/zh-hant_chat.ts` | wakingProfile: profile => `正在喚醒 ${profile}…`, |
| `apps/desktop/src/i18n/zh-hant_chrome.ts` | deleteTitle: name => `刪除 ${name}？`, |
| `apps/desktop/src/i18n/zh-hant_command_center.ts` | startInBranch: branch => `在 ${branch} 中開始新對話`, |
| `apps/desktop/src/i18n/zh-hant_common.ts` | titleProvider: provider => `額度已用盡 — ${provider}`, |
| `apps/desktop/src/i18n/zh-hant_connectors.ts` | emptyHelp: '此後端上的 Claude Code 和 Codex 工作階段將顯示在這裡。', |
| `apps/desktop/src/i18n/zh-hant_desktop_commands.ts` | Desktop-side /rollback /agents /config /history /save /export /import /timestamps lines |
| `apps/desktop/src/i18n/zh-hant_diagnostics.ts` | more: count => `另外 ${count} 則通知`, |
| `apps/desktop/src/i18n/zh-hant_first_run.ts` | text: (model, size) => `${model}（${size}）適合你的硬體。它免費執行，你的對話會留在這部電腦上。`, |
| `apps/desktop/src/i18n/zh-hant_session_commands.ts` | Typed /undo /retry /steer /queue lines (en_session_commands.ts is the source). |
| `apps/desktop/src/i18n/zh-hant_settings.ts` | toolsConnected: n => `已連線 ${n} 個工具`, |
| `apps/desktop/src/i18n/zh-hant_theme_picker.ts` | export const zhHantThemePicker: ThemePickerCopy = { |
| `apps/desktop/src/i18n/zh-hant_update_channel.ts` | branch: (b: string) => `分支：${b}`, |
| `apps/desktop/src/i18n/zh.ts` | emptyHelp: '此后端上的 Claude Code 和 Codex 会话将显示在这里。', |
| `apps/desktop/src/i18n/zh_aux_tasks.ts` | vision: { label: '视觉', hint: '图片分析' }, |
| `apps/desktop/src/i18n/zh_catalog.ts` | installTitle: (name: string) => `安装“${name}”？`, |
| `apps/desktop/src/i18n/zh_clarify.ts` | questionProgress: (answered, total) => `已回答 ${answered}/${total}`, |
| `apps/desktop/src/i18n/zh_connector_card.ts` | connectErrorFor: app => `无法为 ${app} 开始授权。`, |
| `apps/desktop/src/i18n/zh_desktop_commands.ts` | Desktop-side /rollback /agents /config /history /save /export /import /timestamps lines |
| `apps/desktop/src/i18n/zh_first_run.ts` | text: (model, size) => `${model}（${size}）适合你的硬件。它免费运行，你的对话会留在这台电脑上。`, |
| `apps/desktop/src/i18n/zh_local_models.ts` | runtimeReady: backend => `就绪 · ${backend}`, |
| `apps/desktop/src/i18n/zh_model_menu.ts` | pickDeferred: (model: string) => `${model} 将从你的下一条消息开始生效`, |
| `apps/desktop/src/i18n/zh_model_settings.ts` | setUpProvider: name => `设置 ${name}`, |
| `apps/desktop/src/i18n/zh_notices.ts` | Shell notices (remote-display toast, butterbar, keep-awake offer), spread into zh.ts. |
| `apps/desktop/src/i18n/zh_onboarding.ts` | featuredPitch: '一个订阅，300+ 前沿模型 — 运行 Hermes 的推荐方式', |
| `apps/desktop/src/i18n/zh_projects.ts` | movedTo: name => `已移动到 ${name}`, |
| `apps/desktop/src/i18n/zh_session_commands.ts` | Typed /undo /retry /steer /queue lines (en_session_commands.ts is the source). |
| `apps/desktop/src/i18n/zh_shared_metrics.ts` | '如果你选择分享，Hermes 每天向 Nous 发送一次统计数据，并附带此配置文件的随机 ID。除了一条 Hermes 已安装的一次性记录之外，你同意之前的统计数据永远不会被发送。你可以随时在设置中更改。', |
| `apps/desktop/src/i18n/zh_theme_picker.ts` | export const zhThemePicker: ThemePickerCopy = { |
| `apps/desktop/src/i18n/zh_update_channel.ts` | branch: (b: string) => `分支：${b}`, |
| `apps/desktop/src/lib/ansi.test.ts` | pins: parseAnsi |
| `apps/desktop/src/lib/ansi.ts` | Tailwind text-color class or null for the default foreground. */ |
| `apps/desktop/src/lib/artifact-detect.test.ts` | pins: detectArtifact |
| `apps/desktop/src/lib/artifact-detect.ts` | Artifact detection — decides when a fenced block in an assistant message is |
| `apps/desktop/src/lib/async-report.test.ts` | pins: async report hydration |
| `apps/desktop/src/lib/attachment-upload-policy.ts` | When a composer attachment must cross as BYTES rather than ride its path. |
| `apps/desktop/src/lib/audio-context.ts` | The shared AudioContext, or null where WebAudio is unavailable. */ |
| `apps/desktop/src/lib/brand-icon.test.ts` | pins: resolveBrandIcon |
| `apps/desktop/src/lib/brand-icon.ts` | Simple Icons components accept a `title` prop on top of the usual SVG props. |
| `apps/desktop/src/lib/budgeted-loop.test.ts` | pins: createBudgetedLoop |
| `apps/desktop/src/lib/budgeted-loop.ts` | Budgeted renderer loop — the one way to run a decorative rAF animation. |
| `apps/desktop/src/lib/chat-empty.ts` | CHAT EMPTY STATE — the blank transcript as a contribution area. |
| `apps/desktop/src/lib/chat-messages.codex-commentary-reprojection.test.ts` | pins: public Codex commentary after transcript hydration |
| `apps/desktop/src/lib/chat-messages.codex-json-sidecar.test.ts` | pins: hydrates the SQLite JSON-text sidecar returned by REST like the decoded RPC sidecar |
| `apps/desktop/src/lib/chat-messages.codex-sidecar-hydration.test.ts` | pins: #68321 assistant rows whose reply persisted only in codex_message_items |
| `apps/desktop/src/lib/chat-messages.interim-preservation.test.ts` | pins: stored assistant commentary preservation |
| `apps/desktop/src/lib/chat-messages.test.ts` | pins: withUniqueToolCallIdsWithinMessage |
| `apps/desktop/src/lib/chat-messages/attachment-turn.ts` | Attachment-rewrite tolerance for pasted attachments (#120978, follow-up to |
| `apps/desktop/src/lib/chat-messages/competing-contracts.test.ts` | pins: D1 competing implementation contracts |
| `apps/desktop/src/lib/chat-messages/coverage.ts` | Subtract an ordered, tool-anchored prefix within an already matched user |
| `apps/desktop/src/lib/chat-messages/d1-consumers.test.ts` | pins: D1 settlement and presentation consumers |
| `apps/desktop/src/lib/chat-messages/hydration-model-only.test.ts` | pins: toChatMessages with a model-only merge row |
| `apps/desktop/src/lib/chat-messages/hydration.ts` | Backend history projection authorizes/sanitizes public commentary before it |
| `apps/desktop/src/lib/chat-messages/index.ts` | module body (no leading doc line) |
| `apps/desktop/src/lib/chat-messages/parts.capture.test.ts` | pins: MEDIA tag capture validity |
| `apps/desktop/src/lib/chat-messages/parts.test.ts` | pins: renderMediaTags with interior spaces |
| `apps/desktop/src/lib/chat-messages/parts.ts` | Extract display text from a provider reasoning-details envelope. */ |
| `apps/desktop/src/lib/chat-messages/reasoning-details.test.ts` | pins: reasoning-details display text |
| `apps/desktop/src/lib/chat-messages/reconciliation.test.ts` | pins: reconciles only the represented failed tail, retaining its structured error and omitted segments |
| `apps/desktop/src/lib/chat-messages/reconciliation.ts` | Find the hydrated assistant representing a local failed tail turn. |
| `apps/desktop/src/lib/chat-messages/tool-parts.ts` | The gateway names what a bridged `tool_call` actually runs; the row renders those words. |
| `apps/desktop/src/lib/chat-messages/tool-result-preservation.test.ts` | pins: live tool result evidence |
| `apps/desktop/src/lib/chat-messages/types.ts` | Unix seconds when this visible activity segment began. Fractional values |
| `apps/desktop/src/lib/chat-runtime.test.ts` | pins: createClientSessionState |
| `apps/desktop/src/lib/chat-runtime.ts` | Mark a freshly resumed slice's effort as not-yet-known. The deferred-build |
| `apps/desktop/src/lib/clipboard.ts` | Routes `navigator.clipboard.writeText` through Electron IPC, since the |
| `apps/desktop/src/lib/cloud-agent-session.ts` | Re-establish a Hermes Cloud agent's gateway session from the shared portal |
| `apps/desktop/src/lib/code-skew-error.test.ts` | pins: isCodeSkewRestartRequired |
| `apps/desktop/src/lib/code-skew-error.ts` | True when a backend error is the post-update stale-module 503 (#97046). */ |
| `apps/desktop/src/lib/commit-changelog-localization.test.ts` | pins: changelog display copy |
| `apps/desktop/src/lib/commit-changelog.test.ts` | pins: parseCommitHeader |
| `apps/desktop/src/lib/commit-changelog.ts` | Tiny user-facing changelog builder. Takes a list of raw commit summaries, |
| `apps/desktop/src/lib/completion-poll.test.ts` | pins: startCompletionPoll |
| `apps/desktop/src/lib/completion-poll.ts` | Poll immediately, then wait one full cadence AFTER each request settles. |
| `apps/desktop/src/lib/completion-sound.ts` | Completion sound bank for agent turn-end cues. |
| `apps/desktop/src/lib/composer-input-sanitize.test.ts` | pins: stripLeakedBracketedPasteWrappers |
| `apps/desktop/src/lib/composer-input-sanitize.ts` | Strip terminal bracketed-paste leaks and repeated artifact tails from composer |
| `apps/desktop/src/lib/connection-display.test.ts` | pins: connection display helpers |
| `apps/desktop/src/lib/connection-display.ts` | Local stays anchored; every other gateway has one stable, human-readable order. */ |
| `apps/desktop/src/lib/connection-scoped.test.ts` | pins: connectionScopeSuffix |
| `apps/desktop/src/lib/connection-scoped.ts` | Minimal slice of HermesConnection this module keys on. */ |
| `apps/desktop/src/lib/connector-tools.ts` | Reads args so live and settled rows classify alike. */ |
| `apps/desktop/src/lib/deeplink-routes.test.ts` | pins: resolveDeepLinkAction |
| `apps/desktop/src/lib/deeplink-routes.ts` | `hermes://plugin/install?catalog=<name>` — resolved against the curated |
| `apps/desktop/src/lib/desktop-fs.test.ts` | pins: desktop filesystem facade |
| `apps/desktop/src/lib/desktop-fs.ts` | True when a bridge read returned the main process's structured "file is not |
| `apps/desktop/src/lib/desktop-git.test.ts` | pins: desktop git facade |
| `apps/desktop/src/lib/desktop-git.ts` | Remote-aware git facade. Locally the desktop runs git through Electron |
| `apps/desktop/src/lib/desktop-remote-auth.test.ts` | pins: deriveRemoteAuthProviderShape |
| `apps/desktop/src/lib/desktop-remote-auth.ts` | function providerDisplayName(provider: DesktopAuthProvider): string { |
| `apps/desktop/src/lib/desktop-slash-commands.test.ts` | pins: desktop slash command curation |
| `apps/desktop/src/lib/desktop-slash-commands.ts` | Subcommands the desktop surface may offer and forward; absent = all. */ |
| `apps/desktop/src/lib/desktop-slash-registry.json` | module body (no leading doc line) |
| `apps/desktop/src/lib/desktop-toolsets.ts` | Desktop plugin id → the agent toolset carrying the same feature's |
| `apps/desktop/src/lib/display-path.test.ts` | pins: displayPath |
| `apps/desktop/src/lib/display-path.ts` | One place to format filesystem paths for DISPLAY. |
| `apps/desktop/src/lib/distribution-label.ts` | Pure distribution-label selection for the version-details "Distribution" |
| `apps/desktop/src/lib/docs.ts` | docs.ts — canonical docs-site links used by the renderer's recovery and |
| `apps/desktop/src/lib/download-text.ts` | Save generated text content to a file via a blob download. Electron's |
| `apps/desktop/src/lib/draft-title.ts` | Matches `agent/title_generator.py`'s MAX_DERIVED_TITLE_CHARS, so a draft |
| `apps/desktop/src/lib/drag-ghost.ts` | A flat, pointer-following drag chip — the shared "what am I holding" |
| `apps/desktop/src/lib/embedded-images.test.ts` | pins: extractEmbeddedImages |
| `apps/desktop/src/lib/embedded-images.ts` | const buffer = new Uint8Array(bytes.length) |
| `apps/desktop/src/lib/error-surface-copy.test.ts` | pins: does not blame a slow reply when the provider could not be reached |
| `apps/desktop/src/lib/error-surface-copy.ts` | The failing provider's display name for copy — the descriptor's label, |
| `apps/desktop/src/lib/error-surface.test.ts` | pins: parseErrorSurface |
| `apps/desktop/src/lib/error-surface.ts` | Failure codes the error card has dedicated copy for. Values are what the |
| `apps/desktop/src/lib/escape-layers.test.ts` | pins: escape-layers |
| `apps/desktop/src/lib/escape-layers.ts` | Ordered Escape ownership for the app's transient window-level layers. |
| `apps/desktop/src/lib/excluded-paths.ts` | Always hidden across the file tree and review (git) tree, regardless of |
| `apps/desktop/src/lib/execution-authority.frames.json` | module body (no leading doc line) |
| `apps/desktop/src/lib/execution-authority.test.ts` | pins: execution authority fence over real owner frames |
| `apps/desktop/src/lib/execution-authority.ts` | The owner's wire stamp: `SessionEvents.publish` spreads the claimed |
| `apps/desktop/src/lib/external-link.test.tsx` | pins: external link helpers |
| `apps/desktop/src/lib/external-link.tsx` | Authorization URLs must never be consumed by link-title previews. */ |
| `apps/desktop/src/lib/file-preview-math.render.test.tsx` | pins: file-preview math rendering |
| `apps/desktop/src/lib/find-in-page-scope.test.ts` | pins: resolveCurrentFindScope |
| `apps/desktop/src/lib/find-in-page-scope.ts` | Renderer-side find-in-page that scopes matches to the CURRENT VIEW — the |
| `apps/desktop/src/lib/find-in-page.ts` | Counter shown next to the input, e.g. `"3/12"`. |
| `apps/desktop/src/lib/gateway-events.test.ts` | pins: gateway event routing |
| `apps/desktop/src/lib/gateway-events.ts` | Unscoped stream events that must stay pinned to the session that received |
| `apps/desktop/src/lib/gateway-health-pill.test.ts` | pins: statusBarGatewayHealth |
| `apps/desktop/src/lib/gateway-health-pill.ts` | Status-bar "backend health" pill. The serve/chat socket and the messaging |
| `apps/desktop/src/lib/gateway-liveness-policy.test.ts` | pins: decideLivenessForceClose |
| `apps/desktop/src/lib/gateway-liveness-policy.ts` | Liveness-probe force-close policy for the primary gateway socket (#95327). |
| `apps/desktop/src/lib/gateway-rpc.test.ts` | pins: isMissingRpcMethod |
| `apps/desktop/src/lib/gateway-rpc.ts` | True when a JSON-RPC call failed because the backend predates the method. |
| `apps/desktop/src/lib/gateway-ws-url.test.ts` | pins: desktop connection scope |
| `apps/desktop/src/lib/gateway-ws-url.ts` | Only a registry-scoped descriptor may use the *For bridge (see |
| `apps/desktop/src/lib/generated-images.test.ts` | pins: generatedImageFromResult |
| `apps/desktop/src/lib/generated-images.ts` | Display source for a completed `image_generate` result (host path wins). */ |
| `apps/desktop/src/lib/guarded-model-switch.test.tsx` | pins: surfaceModelSwitchConfirm through the shell dialog |
| `apps/desktop/src/lib/guarded-model-switch.ts` | The gateway's model-switch handshake shape — shared by `config.set model` |
| `apps/desktop/src/lib/guest-pointer-guard.ts` | Electron <webview> guests (and iframes) hit-test in their own process, so a |
| `apps/desktop/src/lib/haptics.ts` | const airyTap = [{ duration: 16, intensity: 0.52 }] |
| `apps/desktop/src/lib/hermes-open-target.test.ts` | pins: normalizeHermesOpenString |
| `apps/desktop/src/lib/hermes-open-target.ts` | Shared resolver for in-app navigation targets that must stay compatible with |
| `apps/desktop/src/lib/icons.ts` | Named icon-size scale — the single source of truth for SVG icon dimensions, |
| `apps/desktop/src/lib/identity-trace.ts` | Change-only desktop.log trace for multi-connection identity decisions: which |
| `apps/desktop/src/lib/image-resize.test.ts` | pins: downscaleDataUrlForPreview |
| `apps/desktop/src/lib/image-resize.ts` | Downscale a data URL for preview rendering. |
| `apps/desktop/src/lib/ime.test.ts` | pins: isImeComposing |
| `apps/desktop/src/lib/ime.ts` | IME-aware Enter handling, shared by every text field whose bare Enter |
| `apps/desktop/src/lib/incremental-external-store-runtime.test.ts` | pins: syncRepositoryIncrementally |
| `apps/desktop/src/lib/incremental-external-store-runtime.ts` | Write only the items whose (message, parentId) pair actually moved. |
| `apps/desktop/src/lib/incremental-runtime-adapter-notify.test.ts` | pins: IncrementalExternalStoreThreadRuntimeCore adapter swap notifications |
| `apps/desktop/src/lib/inflight-turn-journal.test.ts` | pins: persistInFlightTurnState |
| `apps/desktop/src/lib/inflight-turn-journal.ts` | Crash-survivable in-flight turn journal. |
| `apps/desktop/src/lib/input-modality.test.ts` | pins: lastInputModality |
| `apps/desktop/src/lib/input-modality.ts` | Which input device drove the most recent interaction. |
| `apps/desktop/src/lib/json-format.test.ts` | pins: tryFormatJson |
| `apps/desktop/src/lib/json-format.ts` | return { ok: true, text: raw } |
| `apps/desktop/src/lib/json-rpc-gateway-heartbeat.test.ts` | pins: JsonRpcGatewayClient heartbeat recovery |
| `apps/desktop/src/lib/json-rpc-gateway-recovery.test.ts` | pins: hermes-ws-recovery-v1 silent blackhole |
| `apps/desktop/src/lib/json-rpc-gateway-url-guard.test.ts` | pins: JsonRpcGatewayClient connect() URL guard |
| `apps/desktop/src/lib/katex-memo.ts` | Memoizing wrapper around `rehype-katex`. |
| `apps/desktop/src/lib/keybinds/actions.test.ts` | pins: KEYBIND_ACTIONS |
| `apps/desktop/src/lib/keybinds/actions.ts` | Default combos. Empty = shipped unbound (user can assign one). */ |
| `apps/desktop/src/lib/keybinds/approval-keys.ts` | One dispatch per keydown, never one listener per card or per session. */ |
| `apps/desktop/src/lib/keybinds/chords.ts` | True when the event is the ⌘/Ctrl+L chord (no shift). The chord routes |
| `apps/desktop/src/lib/keybinds/combo.test.ts` | pins: comboFromEvent |
| `apps/desktop/src/lib/keybinds/combo.ts` | Keybind combo normalization + display. |
| `apps/desktop/src/lib/keybinds/composer-focus-keys.test.ts` | pins: isActivateOnEnterTarget |
| `apps/desktop/src/lib/keybinds/composer-focus-keys.ts` | Soft focus / type-to-focus for the chat composer. |
| `apps/desktop/src/lib/keybinds/contributed-actions.test.ts` | pins: contributed keybind actions |
| `apps/desktop/src/lib/keybinds/plugin-actions.ts` | One row of `ctx.listActions()`. */ |
| `apps/desktop/src/lib/keybinds/use-keybind-hint.ts` | The formatted first combo for `actionId`, or null when unbound. Rebindable |
| `apps/desktop/src/lib/keyed-timeouts.ts` | Per-key setTimeout registry for "let this linger, then drop it" UI state. |
| `apps/desktop/src/lib/layout-persistence.test.ts` | pins: retains legacy data in memory when migration writes fail and retries on the next launch |
| `apps/desktop/src/lib/layout-persistence.ts` | Layout state switches as a unit: changing visibility must not edit either |
| `apps/desktop/src/lib/legacy-session-owner-backfill.test.ts` | pins: maybeBackfillLegacySessionOwners (one-shot per scope) |
| `apps/desktop/src/lib/legacy-session-owner-backfill.ts` | One-shot durable owner backfill for legacy NULL-profile session rows |
| `apps/desktop/src/lib/listing-embed.test.ts` | pins: parseListings |
| `apps/desktop/src/lib/listing-embed.ts` | LISTING EMBEDS — property/rental listings as native transcript cards. |
| `apps/desktop/src/lib/loadout.ts` | Namespacing prefix (like WoW's leading bytes), e.g. 'HML'. */ |
| `apps/desktop/src/lib/local-gateway-ensure-failure.ts` | Main-process refusals from a local `hermes gateway ensure` (electron/local-gateway.ts) that no |
| `apps/desktop/src/lib/local-preview.local-target.test.ts` | pins: normalizeOrLocalPreviewTarget non-previewable results |
| `apps/desktop/src/lib/local-preview.test.ts` | pins: isLoopbackPreviewUrl |
| `apps/desktop/src/lib/local-preview.ts` | Loopback hosts — "this machine". The one address family an agent's dev |
| `apps/desktop/src/lib/log-search.test.ts` | pins: findLogSearchHits |
| `apps/desktop/src/lib/log-search.ts` | Index into the full hit list this segment belongs to, or null. */ |
| `apps/desktop/src/lib/lru-cache.test.ts` | pins: LruCache |
| `apps/desktop/src/lib/lru-cache.ts` | A `Map` with a ceiling. The renderer stays open for days, so a module-level |
| `apps/desktop/src/lib/markdown-blocks.test.ts` | pins: parseMarkdownIntoBlocksCached |
| `apps/desktop/src/lib/markdown-blocks.ts` | Block splitting for the streaming markdown pipeline, without re-lexing the |
| `apps/desktop/src/lib/markdown-code.test.ts` | pins: isLikelyProseCodeBlock |
| `apps/desktop/src/lib/markdown-code.ts` | True when a fenced block looks like structured / config / tabular text |
| `apps/desktop/src/lib/markdown-html-depth.test.ts` | pins: clampHtmlNestingDepth |
| `apps/desktop/src/lib/markdown-html-depth.ts` | Bound the nesting depth of raw inline HTML before it reaches `rehype-raw`. |
| `apps/desktop/src/lib/markdown-preprocess.autolink.test.ts` | pins: preprocessMarkdown / raw-URL autolinking inside markdown links |
| `apps/desktop/src/lib/markdown-preprocess.citation.test.ts` | pins: web citation transport markers |
| `apps/desktop/src/lib/markdown-preprocess.directives.test.ts` | pins: preprocessMarkdown / directive lines |
| `apps/desktop/src/lib/markdown-preprocess.fences.test.ts` | pins: fenced code segmentation |
| `apps/desktop/src/lib/markdown-preprocess.file-preview.test.ts` | pins: normalizeFilePreviewMath |
| `apps/desktop/src/lib/markdown-preprocess.reasoning.test.ts` | pins: reasoning blocks in streamed markdown |
| `apps/desktop/src/lib/markdown-preprocess.ts` | Returns true when `body` contains a line that's exactly `marker` (modulo |
| `apps/desktop/src/lib/markdown-table-widths.ts` | Column widths as percentages of the table box; sums to ~100. */ |
| `apps/desktop/src/lib/markdown-whitespace.test.ts` | pins: Markdown whitespace semantics |
| `apps/desktop/src/lib/mcp-brands.tsx` | Curated brand glyphs for MCP server names — extracted from the mcp-tab's |
| `apps/desktop/src/lib/mcp-cost.test.ts` | pins: estimateServerTokens |
| `apps/desktop/src/lib/mcp-cost.ts` | One probed tool as the desktop's /test endpoint reports it. `schema_chars` |
| `apps/desktop/src/lib/mcp-dashboard-oauth.test.ts` | pins: Desktop MCP client callback lifecycle |
| `apps/desktop/src/lib/mcp-dashboard-oauth.ts` | Deliberate cancellation is not an error toast. */ |
| `apps/desktop/src/lib/mcp-deeplink.test.ts` | pins: parseMcpInstallDeepLink |
| `apps/desktop/src/lib/mcp-deeplink.ts` | Parser/validator for the `hermes://mcp/install?name=NAME&config=B64` deep |
| `apps/desktop/src/lib/mcp-enabled-cases.json` | {"enabled": " on ", "on": true}, |
| `apps/desktop/src/lib/mcp-import.test.ts` | pins: parseMcpImport |
| `apps/desktop/src/lib/mcp-import.ts` | Parse any pasted MCP server description into named mcp.json entries. |
| `apps/desktop/src/lib/mcp-probe-cache.test.ts` | pins: classifyProbe |
| `apps/desktop/src/lib/mcp-probe-cache.ts` | Read a still-fresh cached probe result, or null (miss / expired). */ |
| `apps/desktop/src/lib/mcp-reload.test.ts` | pins: a saved MCP change reports what the chat got |
| `apps/desktop/src/lib/mcp-reload.ts` | What `reload.mcp` did for the chat that asked. The gateway decides and commits; Desktop only reads its |
| `apps/desktop/src/lib/mcp-servers.test.ts` | pins: getServers |
| `apps/desktop/src/lib/mcp-servers.ts` | Cursor/Claude write `type`; Hermes reads `transport`. Normalizing on the way |
| `apps/desktop/src/lib/mcp-tool-filter.test.ts` | pins: readToolsFilter |
| `apps/desktop/src/lib/mcp-tool-filter.ts` | Per-tool MCP gating. A server's optional `tools.include` (whitelist) / |
| `apps/desktop/src/lib/media-dimensions.test.ts` | pins: reads a remote-owned image through its gateway, never the local file reader |
| `apps/desktop/src/lib/media-file-download.test.ts` | pins: captured gateway file download |
| `apps/desktop/src/lib/media.remote.test.ts` | pins: filePathFromMediaPath |
| `apps/desktop/src/lib/media.ts` | Escape only the URL-structural characters in a filesystem path so the |
| `apps/desktop/src/lib/mic-meter-context.ts` | Resolves once every meter context closed so far has finished closing. */ |
| `apps/desktop/src/lib/middle-click.test.tsx` | pins: middleClickHandlers |
| `apps/desktop/src/lib/middle-click.ts` | `MouseEvent.button` for the middle (wheel) button. */ |
| `apps/desktop/src/lib/model-options.test.ts` | pins: requestModelOptions |
| `apps/desktop/src/lib/model-options.ts` | True when `currentProvider` is this catalog row — slug, display name, or |
| `apps/desktop/src/lib/model-picker-owner.test.ts` | pins: resolveModelPickerOwner |
| `apps/desktop/src/lib/model-picker-owner.ts` | Resolve one coherent owner for every picker operation. A tile route wins |
| `apps/desktop/src/lib/model-status-label.test.ts` | pins: model-status-label |
| `apps/desktop/src/lib/model-status-label.ts` | Which model/provider pair a picker should mark "current". SessionView state |
| `apps/desktop/src/lib/mutable-ref.ts` | Imperative ref write — extracted so react-compiler doesn't flag hook-arg refs. */ |
| `apps/desktop/src/lib/oneshot.ts` | Registered backend template id (e.g. 'commit_message'). */ |
| `apps/desktop/src/lib/path-compare.test.ts` | pins: isWindowsAbsolutePath |
| `apps/desktop/src/lib/path-compare.ts` | Comparing two paths for identity or containment, across host spellings. |
| `apps/desktop/src/lib/persisted.test.ts` | pins: persistentAtom |
| `apps/desktop/src/lib/persisted.ts` | JSON with an optional sanitizer for untrusted persisted shapes. */ |
| `apps/desktop/src/lib/personalities.ts` | Canonical personality key, mirroring hermes_cli/personality.py |
| `apps/desktop/src/lib/platform-status.ts` | One reading of a messaging platform's runtime state, shared by the Messaging |
| `apps/desktop/src/lib/platform.ts` | Platform detection for the renderer. |
| `apps/desktop/src/lib/plugin-catalog.test.ts` | pins: lookupPluginCatalogEntry |
| `apps/desktop/src/lib/plugin-catalog.ts` | The curated Hermes plugin catalog as the Desktop sees it. |
| `apps/desktop/src/lib/plugin-source-urls.test.ts` | pins: resolvePluginSourceLinks |
| `apps/desktop/src/lib/plugin-source-urls.ts` | const GITHUB_BROWSER_SEGMENTS = new Set(['tree', 'blob', 'commit']) |
| `apps/desktop/src/lib/pointer-drag.ts` | Run a pointer drag until pointerup, then unbind both listeners. |
| `apps/desktop/src/lib/pool.test.ts` | pins: mapPool |
| `apps/desktop/src/lib/pool.ts` | `Promise.all(items.map(fn))` with a concurrency cap: at most `limit` calls run |
| `apps/desktop/src/lib/preview-act/act-in-page.test.ts` | pins: self-containment |
| `apps/desktop/src/lib/preview-act/act-in-page.ts` | PREVIEW ACT ENGINE — the one function that performs an interaction inside a |
| `apps/desktop/src/lib/preview-act/identity.ts` | IDENTITY — deciding whether the element in front of us is one we already |
| `apps/desktop/src/lib/preview-act/naming.test.ts` | pins: slug |
| `apps/desktop/src/lib/preview-act/naming.ts` | NAMING — what an element is called, and what it is called by. |
| `apps/desktop/src/lib/preview-act/types.ts` | PREVIEW ACT TYPES — the shapes the engine, the overlay, and the Python tool |
| `apps/desktop/src/lib/preview-act/visibility.ts` | VISIBILITY — is this element actually there, and is it on screen. |
| `apps/desktop/src/lib/preview-act/watch-in-page.test.ts` | pins: watchInPage |
| `apps/desktop/src/lib/preview-act/watch-in-page.ts` | WATCH OVERLAY — paints the agent's actions onto the live preview page so a |
| `apps/desktop/src/lib/preview-annotate/flush.ts` | Attach every pin to the composer as a numbered crop plus the packed prompt. |
| `apps/desktop/src/lib/preview-annotate/group.test.ts` | pins: annotateSplitDepth |
| `apps/desktop/src/lib/preview-annotate/group.ts` | Structural grouping for a comment batch. |
| `apps/desktop/src/lib/preview-annotate/handoff.test.ts` | pins: capturePreviewAnnotateDestination |
| `apps/desktop/src/lib/preview-annotate/handoff.ts` | Cross-window handoff for Browser Comment Mode. |
| `apps/desktop/src/lib/preview-annotate/identity.ts` | Markup keeps its own clip: it arrives already budgeted and redacted from the |
| `apps/desktop/src/lib/preview-annotate/in-page.test.ts` | pins: annotateInPage overlay |
| `apps/desktop/src/lib/preview-annotate/in-page.ts` | Guest-page comment overlay. Injected as source into the preview webview — |
| `apps/desktop/src/lib/preview-annotate/index.ts` | module body (no leading doc line) |
| `apps/desktop/src/lib/preview-annotate/pack.test.ts` | pins: packageAnnotatePin |
| `apps/desktop/src/lib/preview-annotate/pack.ts` | One comment, as much as the agent needs to find the element in source. |
| `apps/desktop/src/lib/preview-annotate/stack.test.ts` | pins: annotate pin stack |
| `apps/desktop/src/lib/preview-annotate/stack.ts` | Numbered pin stack for comment mode. Saving a pin only appends — it never |
| `apps/desktop/src/lib/preview-annotate/tokens.ts` | Visual tokens for in-app browser comment mode. |
| `apps/desktop/src/lib/preview-external.ts` | Admission for URLs handed up by the preview guest preload |
| `apps/desktop/src/lib/preview-markdown-links.test.ts` | pins: previewHeadingSlug |
| `apps/desktop/src/lib/preview-markdown-links.ts` | Where a click in the desktop markdown preview goes. |
| `apps/desktop/src/lib/preview-reach.test.ts` | pins: reachablePreviewUrl |
| `apps/desktop/src/lib/preview-reach.ts` | Make a URL loadable from THIS machine before the pane tries it. |
| `apps/desktop/src/lib/preview-targets.test.ts` | pins: previewName |
| `apps/desktop/src/lib/preview-targets.ts` | File identity only: do not resolve symlinks, guess home, or fold path case. */ |
| `apps/desktop/src/lib/profile-color.ts` | Deterministic per-profile color so a profile is glanceable across the app |
| `apps/desktop/src/lib/profile-order.ts` | User-defined rail order for named profile squares. Names absent from the |
| `apps/desktop/src/lib/profile-short-label.ts` | Keep combining marks and emoji sequences together without changing the rail's size. */ |
| `apps/desktop/src/lib/project-idea-templates.ts` | Fun starter ideas for the new-project dialog. Pills prefill IDEA.md; the set |
| `apps/desktop/src/lib/provider-limit.test.ts` | pins: provider limits |
| `apps/desktop/src/lib/provider-limit.ts` | The provider's rate limit (`account`: the whole login is out, another model |
| `apps/desktop/src/lib/provider-setup-errors.test.ts` | pins: isProviderSetupErrorMessage |
| `apps/desktop/src/lib/provider-setup-errors.ts` | True when the gateway named this failure itself: preferred over reading the sentence. */ |
| `apps/desktop/src/lib/query-client.test.ts` | pins: invalidateProfileScopedQueries |
| `apps/desktop/src/lib/query-client.ts` | Shared React Query client. Lives in its own module (not main.tsx) so non-React |
| `apps/desktop/src/lib/quick-entry-submission.test.ts` | pins: captureQuickEntryRequest |
| `apps/desktop/src/lib/quick-entry-submission.ts` | The exact prompt text submitted through Quick Entry. */ |
| `apps/desktop/src/lib/raf-coalesce.ts` | Coalesce a stream of values (pointermove positions, resize deltas) to one |
| `apps/desktop/src/lib/reasoning-blocks.test.ts` | pins: separateGluedReasoningBlocks |
| `apps/desktop/src/lib/reasoning-blocks.ts` | Reasoning-summary models (OpenAI's gpt-5.x family, and anything relaying the |
| `apps/desktop/src/lib/reasoning-effort.test.ts` | pins: reasoning-effort |
| `apps/desktop/src/lib/reasoning-effort.ts` | Compact labels for chrome where space is tight (pill, picker rows). Menus |
| `apps/desktop/src/lib/reasoning-slash.test.ts` | pins: /reasoning slash command |
| `apps/desktop/src/lib/reasoning-slash.ts` | Build the `config.set` params for `/reasoning <arg>`; `null` when there is nothing to set. */ |
| `apps/desktop/src/lib/reasoning-step.test.ts` | pins: stepReasoningEffort |
| `apps/desktop/src/lib/reasoning-step.ts` | The level ladder a shortcut steps through: thinking off, then the normal |
| `apps/desktop/src/lib/remark-soft-breaks.test.ts` | pins: remarkSoftBreaks |
| `apps/desktop/src/lib/remark-soft-breaks.ts` | Render single newlines in prose as line breaks, the way chat replies read |
| `apps/desktop/src/lib/remote-url.test.ts` | pins: coerceRemoteUrlScheme |
| `apps/desktop/src/lib/remote-url.ts` | Renderer-side twin of the scheme coercion in |
| `apps/desktop/src/lib/render-weight.test.ts` | pins: messageStoreWeight |
| `apps/desktop/src/lib/render-weight.ts` | Render cost of one message's content parts, in budget units. |
| `apps/desktop/src/lib/renderer-loop-pause.test.ts` | pins: installRendererAnimationPauseState |
| `apps/desktop/src/lib/renderer-loop-pause.ts` | Mirrors the main window's observability onto :root so continuous decorative |
| `apps/desktop/src/lib/reorder.ts` | THE reorder feel — one primitive for every horizontal drag-to-reorder strip |
| `apps/desktop/src/lib/replay-gap-owner.test.ts` | pins: eventSourceMatchesOwner |
| `apps/desktop/src/lib/replay-gap-owner.ts` | Normalized source tags of a gateway event: the registry connection whose |
| `apps/desktop/src/lib/runtime-readiness.test.ts` | pins: interpretRuntimeReadiness |
| `apps/desktop/src/lib/runtime-readiness.ts` | Additive launch-profile fields (newer backends only; absent on older |
| `apps/desktop/src/lib/sanitize.test.ts` | pins: gitRef |
| `apps/desktop/src/lib/sanitize.ts` | A git-ref-safe branch name: spaces → "-", drop chars git forbids, keep "/". */ |
| `apps/desktop/src/lib/selectable-card.ts` | Currently selected / active — the strongest emphasis. */ |
| `apps/desktop/src/lib/selection-copy-colors.test.ts` | pins: textColorLuma |
| `apps/desktop/src/lib/selection-copy-colors.ts` | At or above this perceived luma, text reads as "light" (dark-theme ink). */ |
| `apps/desktop/src/lib/session-branch-tree.test.ts` | pins: forkParentId |
| `apps/desktop/src/lib/session-branch-tree.ts` | Keep the input root order instead of re-sorting by group recency. |
| `apps/desktop/src/lib/session-date-groups.test.ts` | pins: groupEntriesByRecency |
| `apps/desktop/src/lib/session-date-groups.ts` | Drop session rows that sit under a closed divider. The divider itself stays |
| `apps/desktop/src/lib/session-export.ts` | function sessionExportFilename(sessionId: string, title?: string | null) { |
| `apps/desktop/src/lib/session-ids.test.ts` | pins: storedSessionIdForNotification |
| `apps/desktop/src/lib/session-ids.ts` | The gateway tags every event — and therefore every native notification — |
| `apps/desktop/src/lib/session-link-title.test.ts` | pins: lookupLocalSessionTitle |
| `apps/desktop/src/lib/session-link-title.ts` | Resolves `@session:<profile>/<id>` reference values to the session's title. |
| `apps/desktop/src/lib/session-owner-routed-rpcs.test.tsx` | pins: session_id RPCs go to the session owner, not the ambient socket |
| `apps/desktop/src/lib/session-owner-stamp.ts` | THE canonical write path for tagging backend-returned session rows with the |
| `apps/desktop/src/lib/session-project-label.ts` | The PROJECT a session belongs to, as a label for the sidebar card. |
| `apps/desktop/src/lib/session-refs.test.ts` | pins: parseSessionRefValue |
| `apps/desktop/src/lib/session-refs.ts` | Pure helpers for `@session:<profile>/<id>` references. |
| `apps/desktop/src/lib/session-row-slots.ts` | Session-row decoration surface — the seams a plugin can decorate a sidebar |
| `apps/desktop/src/lib/session-search.test.ts` | pins: sessionMatchesSearch |
| `apps/desktop/src/lib/session-search.ts` | export function sessionMatchesSearch(session: SessionInfo, query: string): boolean { |
| `apps/desktop/src/lib/session-signatures.test.ts` | pins: sameCronSignature |
| `apps/desktop/src/lib/session-signatures.ts` | Cheap signature compares for poll loops — swap the atom (and re-render) |
| `apps/desktop/src/lib/session-source.test.ts` | pins: photon messaging source registration |
| `apps/desktop/src/lib/session-source.ts` | True when a source id is an external messaging platform (gets its own |
| `apps/desktop/src/lib/session-timer-since.test.ts` | pins: resolveSessionTimerSince |
| `apps/desktop/src/lib/session-timer-since.ts` | Statusbar timer contract (#103123): both surfaces show "focused since". |
| `apps/desktop/src/lib/shared-gateway-restart.test.ts` | pins: sharedGatewayProfiles |
| `apps/desktop/src/lib/shared-gateway-restart.ts` | Profiles a gateway restart would blip when the polled profile is carried by the shared |
| `apps/desktop/src/lib/sibling-ws-url.test.ts` | pins: resolveSiblingWsUrl |
| `apps/desktop/src/lib/sibling-ws-url.ts` | Sibling WebSocket URLs beside `/api/ws` for a (connection, profile) route. |
| `apps/desktop/src/lib/slash-completion-cache.ts` | Serve a `/` completion response from cache, fetching only when stale. */ |
| `apps/desktop/src/lib/speech-text.identifier-corpus.test.ts` | pins: sanitizeTextForSpeech identifier-dense tokens (#119207) |
| `apps/desktop/src/lib/speech-text.test.ts` | pins: sanitizeTextForSpeech |
| `apps/desktop/src/lib/speech-text.ts` | Incremental wrapper over cutSentences() for the sync (non-streaming |
| `apps/desktop/src/lib/spoken-reply.test.ts` | pins: isLiveTailReplyId |
| `apps/desktop/src/lib/spoken-reply.ts` | Spoken-reply identity for Desktop auto-speak / Read Aloud. |
| `apps/desktop/src/lib/stable-array.ts` | Keep `prev`'s reference when it's element-equal to `next`, so a nanostores |
| `apps/desktop/src/lib/statusbar.test.ts` | pins: statusbar usage readouts |
| `apps/desktop/src/lib/statusbar.tsx` | `87%` for a reported hit rate; '' when the backend omitted it (no cache |
| `apps/desktop/src/lib/steered-turn-hydration-order.test.ts` | pins: toChatMessages on a persisted steered turn |
| `apps/desktop/src/lib/storage.test.ts` | pins: string array storage |
| `apps/desktop/src/lib/storage.ts` | Observe every persisted get/set (e.g. pipe into telemetry/sync). */ |
| `apps/desktop/src/lib/stt-lease.test.ts` | pins: syncSttLease |
| `apps/desktop/src/lib/stt-lease.ts` | Latest requested state per (lease, owner): true = acquire, false = release. */ |
| `apps/desktop/src/lib/summarize-command.test.ts` | pins: summarizeShellCommand |
| `apps/desktop/src/lib/summarize-command.ts` | Reduce a verbose shell command to the "main" command, for display only. |
| `apps/desktop/src/lib/svg-image-inline-cap.test.ts` | pins: normalizeSvgSize |
| `apps/desktop/src/lib/svg-image.test.ts` | pins: svgSize |
| `apps/desktop/src/lib/svg-image.ts` | Rasterise an SVG string to PNG and copy it to the clipboard. Self-contained |
| `apps/desktop/src/lib/text.ts` | Search-key normalization: the exact `value.trim().toLowerCase()` idiom that |
| `apps/desktop/src/lib/thinking-sound.test.ts` | pins: thinking-sound |
| `apps/desktop/src/lib/thinking-sound.ts` | Start the repeating thinking blips (idempotent). Best-effort, never throws. */ |
| `apps/desktop/src/lib/time.test.ts` | pins: formatAgo |
| `apps/desktop/src/lib/time.ts` | Canonical time/date formatting. Shared `Intl` instances (created once, not |
| `apps/desktop/src/lib/tips/anchor.ts` | Where a tip can actually point right now. |
| `apps/desktop/src/lib/tips/catalog.ts` | THE TIP CATALOG — what the app tells you about itself when it's quiet. |
| `apps/desktop/src/lib/tips/local-cta.test.ts` | pins: localTipDue |
| `apps/desktop/src/lib/tips/local-cta.ts` | Reshow clock for the local-models campaign tips in the rotation (today: the |
| `apps/desktop/src/lib/tips/rotation.test.ts` | pins: nextTip |
| `apps/desktop/src/lib/tips/rotation.ts` | Which tip comes next. |
| `apps/desktop/src/lib/todos.test.ts` | pins: todoTree |
| `apps/desktop/src/lib/todos.ts` | Optional id of another item — renders this as a nested subtask. */ |
| `apps/desktop/src/lib/tool-render-class.ts` | Which surface a tool call renders as. |
| `apps/desktop/src/lib/tool-result-metadata.ts` | Gateway display hints are not the tool's result. Keep them off the raw |
| `apps/desktop/src/lib/tool-result-summary.test.ts` | pins: formatToolResultSummary |
| `apps/desktop/src/lib/tool-result-summary.ts` | Heuristic JSON → human summary for tool results. Default view; technical |
| `apps/desktop/src/lib/tool-run-continuity.test.ts` | pins: tool run segmentation survives rehydration |
| `apps/desktop/src/lib/tour/app-tour.css` | /* Hermes surface treatment for the APP surface's tour popovers. |
| `apps/desktop/src/lib/tour/collect-targets.ts` | TOUR TARGET COLLECTOR — discovers what a tour can point at. |
| `apps/desktop/src/lib/tour/engine.test.ts` | pins: collectTourTargets |
| `apps/desktop/src/lib/tour/engine.ts` | TOUR ENGINE — the one function that runs a tour action, on BOTH surfaces. |
| `apps/desktop/src/lib/tour/index.ts` | TOURS — highlight-and-narrate walkthroughs for any surface. |
| `apps/desktop/src/lib/tour/run-tour.ts` | RUN TOUR — the tour verbs, on either surface. |
| `apps/desktop/src/lib/tour/spotlight-blur.ts` | SPOTLIGHT BLUR — a blurred scrim that keeps the highlighted element crisp. |
| `apps/desktop/src/lib/tour/tour-active.ts` | Reactive twin of `isTourActive` for UI that must wait out a tour. Lives apart from |
| `apps/desktop/src/lib/trackpad-gestures.ts` | macOS "smart zoom" (two-finger double-tap): a ctrl-wheel with no delta. */ |
| `apps/desktop/src/lib/transcript-directives.test.ts` | pins: segmentTranscriptDirectives |
| `apps/desktop/src/lib/transcript-directives.ts` | TRANSCRIPT DIRECTIVES — the transcript as a contribution area. |
| `apps/desktop/src/lib/transcript-occurrences.test.ts` | pins: hydrates repeated tool-round commentary but folds the stop-row echo |
| `apps/desktop/src/lib/tts-lease.test.ts` | pins: syncTtsLease |
| `apps/desktop/src/lib/tts-lease.ts` | Bring the backend's view of `lease` in line with `active`. Idempotent: a |
| `apps/desktop/src/lib/turn-done-notification-body.test.ts` | pins: turnDoneNotificationBody |
| `apps/desktop/src/lib/turn-done-notification-body.ts` | Native turn-done notification body (#88488). |
| `apps/desktop/src/lib/update-copy.test.ts` | pins: resolveUpdateCopy |
| `apps/desktop/src/lib/update-copy.ts` | Pure copy-selection for the updates overlay's "available" state. |
| `apps/desktop/src/lib/update-notes.test.ts` | pins: update notes |
| `apps/desktop/src/lib/update-notes.ts` | "What's in this update" for the updates overlay, read from public GitHub. |
| `apps/desktop/src/lib/use-enter-animation.test.tsx` | pins: useEnterAnimation |
| `apps/desktop/src/lib/use-enter-animation.ts` | One-shot enter animation via the Web Animations API. |
| `apps/desktop/src/lib/use-session-slice.ts` | Subscribe to ONE session's slice of a `Record<sessionId, T[]>` nanostore, |
| `apps/desktop/src/lib/use-stores-selector.test.tsx` | pins: a selector recomputes for every store it was given |
| `apps/desktop/src/lib/utils.ts` | export function cn(...inputs: ClassValue[]) { |
| `apps/desktop/src/lib/version-label.test.ts` | pins: shortVersion |
| `apps/desktop/src/lib/version-label.ts` | The one short form every surface names a version by: `<release>+<distance>` |
| `apps/desktop/src/lib/version-status.test.ts` | pins: resolveVersionStatus |
| `apps/desktop/src/lib/version-status.ts` | Pure derivation of how the app names an update target: the label |
| `apps/desktop/src/lib/voice-barge-in.test.ts` | pins: monitorSpeechDuringPlayback — voice.barge_in_threshold_multiplier (#117801) |
| `apps/desktop/src/lib/voice-barge-in.ts` | Sustained speech detected — cut playback / interrupt the turn now. */ |
| `apps/desktop/src/lib/voice-client-direct.test.ts` | pins: fetchVoiceClientConfig |
| `apps/desktop/src/lib/voice-client-direct.ts` | Client-direct voice: call the active profile's STT/TTS providers straight |
| `apps/desktop/src/lib/voice-live.routing.test.ts` | pins: GPT-Live owner routing |
| `apps/desktop/src/lib/voice-live.ts` | GPT-Live voice chat: the full-duplex voice frontend that DELEGATES to Hermes. |
| `apps/desktop/src/lib/voice-playback.routing.test.ts` | pins: resolveSpeakStreamUrl |
| `apps/desktop/src/lib/voice-playback.same-turn.test.ts` | pins: playSpeechText same-turn start |
| `apps/desktop/src/lib/voice-playback.test.ts` | pins: voice-playback teardown (#91991) |
| `apps/desktop/src/lib/voice-playback.ts` | The speaking session's owner: a Bot chat synthesizes with its own |
| `apps/desktop/src/lib/voice-stop-word.test.ts` | pins: isVoiceStopCommand |
| `apps/desktop/src/lib/voice-stop-word.ts` | True when the entire spoken utterance is a stop command (optionally addressed |
| `apps/desktop/src/lib/voice-stream.ts` | Live dictation STT: mic PCM streams to the host's `/api/audio/transcribe-stream` WebSocket |
| `apps/desktop/src/lib/voice-tts-echo.test.ts` | pins: isTtsEcho |
| `apps/desktop/src/lib/voice-tts-echo.ts` | export const DEFAULT_TTS_ECHO_SIMILARITY_THRESHOLD = 0.6 |
| `apps/desktop/src/lib/wake-client-capture.test.ts` | pins: startClientWakeCapture (issue #119089) |
| `apps/desktop/src/lib/wake-client-capture.ts` | Client-side mic capture for remote wake word. |
| `apps/desktop/src/lib/wake-indicator.test.ts` | pins: wake indicator lifecycle |
| `apps/desktop/src/lib/wake-indicator.ts` | let lastState: WakeIndicatorState = 'hidden' |
| `apps/desktop/src/lib/wake-sound.test.ts` | pins: playWakeSound |
| `apps/desktop/src/lib/wake-sound.ts` | Wake-word activation chime. A short, bright, rising two-note "ding" that |
| `apps/desktop/src/lib/with-timeout.test.ts` | pins: withTimeout |
| `apps/desktop/src/lib/with-timeout.ts` | Shared budget for any renderer await that rides out a primary backend |
| `apps/desktop/src/lib/yolo-session.ts` | Toggle per-session YOLO (approval bypass) via gateway `config.set` — the same |
| `apps/desktop/src/main.tsx` | Side-effect: reports in-flight turns to the main process for the quit guard. |
| `apps/desktop/src/pairing-scope.test.ts` | pins: pairing requests carry the active profile |
| `apps/desktop/src/plugin-socket-scope.test.ts` | pins: pluginSocket active-backend scoping (#73044) |
| `apps/desktop/src/plugins/README.md` | Drop a `<name>/plugin.{ts,tsx}` here that default-exports a `HermesPlugin` and |
| `apps/desktop/src/plugins/hello-runtime/plugin.runtime.js` | Runtime-loaded example — this file is NOT bundled as a module: it ships as |
| `apps/desktop/src/plugins/hermes-bots/LICENSE` | Copyright (c) 2026 Nous Research |
| `apps/desktop/src/plugins/hermes-bots/avatar-image.test.ts` | pins: generateAvatarImage (#86161) |
| `apps/desktop/src/plugins/hermes-bots/avatar-image.ts` | Image avatars: the device-upload path and the gateway's `image.generate` |
| `apps/desktop/src/plugins/hermes-bots/avatar-picker.tsx` | The avatar editor shared by Edit Profile and New Bot: shape grid + color |
| `apps/desktop/src/plugins/hermes-bots/avatar.face-clock.test.ts` | pins: the hand-rolled rAF path (older shells) |
| `apps/desktop/src/plugins/hermes-bots/avatar.test.tsx` | pins: blob shape strings round-trip through parse/build |
| `apps/desktop/src/plugins/hermes-bots/avatar.tsx` | Bot avatars: the shape/color/eyes vocabulary, the deterministic blobatar |
| `apps/desktop/src/plugins/hermes-bots/bot-delete.test.ts` | pins: the SDK delete verb is preferred over the CLI |
| `apps/desktop/src/plugins/hermes-bots/bot-open-focus-identity.test.ts` | pins: an open claims both identities of the chat it opened |
| `apps/desktop/src/plugins/hermes-bots/bot-row-opens-canonical-chat.test.ts` | pins: a row click lands on the canonical chat, never a remembered side tab |
| `apps/desktop/src/plugins/hermes-bots/bot-row.test.tsx` | pins: group-turn presence |
| `apps/desktop/src/plugins/hermes-bots/bot-row.tsx` | The two rows the Bots rail lists: one bot, and one group chat. |
| `apps/desktop/src/plugins/hermes-bots/bot-state.focused-owner.test.ts` | pins: a desktop that publishes the complete focused owner |
| `apps/desktop/src/plugins/hermes-bots/bot-state.ts` | The window-local state Bot Mode's surfaces share: which roster row is |
| `apps/desktop/src/plugins/hermes-bots/canonical-attachment-download.ts` | Use the existing browser-download -> Electron Save File workflow, not composer staging. |
| `apps/desktop/src/plugins/hermes-bots/canonical-chat-adopt-on-conflict.test.ts` | pins: a title-uniqueness rejection means someone else won the registry |
| `apps/desktop/src/plugins/hermes-bots/canonical-chat-creation.test.ts` | pins: the lazy row is materialized before anything else touches it |
| `apps/desktop/src/plugins/hermes-bots/canonical-chat-expect-history.test.ts` | pins: resolveExpectHistory |
| `apps/desktop/src/plugins/hermes-bots/canonical-chat-open-failure-toast.test.ts` | pins: notifyBotOpenFailure |
| `apps/desktop/src/plugins/hermes-bots/canonical-chat-registry.test.ts` | pins: the registry row wins, always |
| `apps/desktop/src/plugins/hermes-bots/canonical-chat-stale-tiles.test.ts` | pins: 120810: compressed Bot Chat discards the stale tile |
| `apps/desktop/src/plugins/hermes-bots/canonical-chat.ts` | The canonical Bot Chat: one bot, one forever-chat, resolved by exact title. |
| `apps/desktop/src/plugins/hermes-bots/canonical-download-test-utils.ts` | Observe a user-facing browser download, not a private cache-writing IPC. */ |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-alias-scope.test.ts` | pins: a room NAME shaped like a canonical key is not treated as an identity on another connection |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-attachments.test.tsx` | pins: downloads only the selected committed attachment from its captured owner |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-attachments.tsx` | interface DownloadedAttachment extends Attachment { data_base64: string } |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-capabilities.ts` | The profiles `groups.create` will seat for THIS caller, as `groups.capabilities` |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-capability-gates.test.tsx` | pins: keeps positive classifications working: legacy renders and creates locally, canonical creates a gateway room |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-download-lifetime.test.tsx` | pins: initiates the real user-facing download with exact bytes/name, never the composer cache |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-history.test.tsx` | pins: keeps a committed file downloadable in history after Send clears the composer (F31) |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-history.tsx` | const MessageTextContent = typeof sdk === 'undefined' ? undefined : sdk.MessageTextContent |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-labels.ts` | Hosted group copy stays plugin-owned; generic controls reuse the core catalog. */ |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-locales.ts` | workLimitReached: 'Group work limit reached', |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-presentation.test.tsx` | pins: renders the canonical log actors, timestamps and Markdown without transport markers |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-registry.tsx` | Where a group string entered. Room and group names are free text (hosted_rooms |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-reopen-by-name.test.tsx` | pins: adopts the existing gateway room by name instead of minting a fork |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-send-windows.test.ts` | pins: two windows preparing one room slot at once acknowledge the single durable winner |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-send.test.ts` | pins: uncertain sends reopen with exact identity and attachments, isolated by authority, until matching ACK retirement |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-send.ts` | Replace `key` only while it holds exactly `expected` (null = absent); returns the stored record. |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-upload-race.test.tsx` | pins: holds Send until the selected attachment is committed, then sends it with the text |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-workspace.test.tsx` | pins: preserves the unsent draft when only the room display name changes |
| `apps/desktop/src/plugins/hermes-bots/canonical-group-workspace.tsx` | interface Attachment { attachment_id?: string; event_id?: string; kind: string; name: string; mime: string; size?: number } |
| `apps/desktop/src/plugins/hermes-bots/canonical-groups.test.ts` | pins: pins discovery and every subsequent request to its captured authority, including empty filtered pages |
| `apps/desktop/src/plugins/hermes-bots/canonical-groups.ts` | function requireRoute(route: CanonicalGroupRoute): void { |
| `apps/desktop/src/plugins/hermes-bots/chat-empty.tsx` | What a bot's chat shows before it has said anything. |
| `apps/desktop/src/plugins/hermes-bots/cold-bot-switch-pending.test.ts` | pins: cold bot switch publishes its target after the fronted-tab miss |
| `apps/desktop/src/plugins/hermes-bots/cold-bot-switch-row.test.tsx` | pins: spins the pending target row without stealing the highlight |
| `apps/desktop/src/plugins/hermes-bots/create-agent-lazy-profile.test.tsx` | pins: materializing the draft profile |
| `apps/desktop/src/plugins/hermes-bots/create-dialog.single-flight.test.ts` | pins: singleFlight |
| `apps/desktop/src/plugins/hermes-bots/create-dialog.tsx` | The two creation dialogs: New Bot, and the group-chat creation flow the |
| `apps/desktop/src/plugins/hermes-bots/cron-create-dialog.test.tsx` | pins: the dialog names the bot, never its object |
| `apps/desktop/src/plugins/hermes-bots/cron-detail.test.tsx` | pins: the facts the row never showed |
| `apps/desktop/src/plugins/hermes-bots/cron-jobs-view.test.ts` | pins: selecting the jobs for the active bot |
| `apps/desktop/src/plugins/hermes-bots/cron-load.test.ts` | pins: the bot\u2019s own cron store |
| `apps/desktop/src/plugins/hermes-bots/cron-owner.test.tsx` | pins: the create target is captured, not re-read |
| `apps/desktop/src/plugins/hermes-bots/cron-pane.test.tsx` | pins: the pane follows the roster hydrating after mount |
| `apps/desktop/src/plugins/hermes-bots/cron-prompt.test.ts` | pins: direct vs delegated execution |
| `apps/desktop/src/plugins/hermes-bots/cron-rpc-error.test.ts` | pins: a rejection always reaches React with a string name |
| `apps/desktop/src/plugins/hermes-bots/cron-selected-bot.test.ts` | pins: bindProfileSync reseeds, then follows |
| `apps/desktop/src/plugins/hermes-bots/cron.tsx` | Routines: the Hermes cron jobs scoped to the bot you're chatting with — the |
| `apps/desktop/src/plugins/hermes-bots/cross-connection-bots.test.ts` | pins: every source-scoped row resolves to an immutable owner |
| `apps/desktop/src/plugins/hermes-bots/data.bot-meta-migration.test.ts` | pins: v1 is re-keyed only where the new key is provable |
| `apps/desktop/src/plugins/hermes-bots/data.bot-meta.test.ts` | pins: a save reports what the SERVER did, not just what the screen shows |
| `apps/desktop/src/plugins/hermes-bots/data.cached-roster.test.ts` | pins: cachedUnionRoster |
| `apps/desktop/src/plugins/hermes-bots/data.identity.test.ts` | pins: the @handle a bot answers to |
| `apps/desktop/src/plugins/hermes-bots/data.roster.test.tsx` | pins: no union roster |
| `apps/desktop/src/plugins/hermes-bots/data.ts` | Bot Mode's domain layer: the roster query, bot metadata storage, the |
| `apps/desktop/src/plugins/hermes-bots/dialog-parts.tsx` | The presentation leaves every Bot Mode dialog shares: a labelled control, and |
| `apps/desktop/src/plugins/hermes-bots/edit-profile-dialog.tsx` | Edit Profile: appearance, title, description, and the advanced profile |
| `apps/desktop/src/plugins/hermes-bots/edit-profile-look.ts` | What Edit Profile shows for a bot's look, as opened and as submitted. */ |
| `apps/desktop/src/plugins/hermes-bots/group-activity.test.ts` | pins: turn arc |
| `apps/desktop/src/plugins/hermes-bots/group-activity.ts` | The per-room activity feed: a bounded, runtime-only record of turn events |
| `apps/desktop/src/plugins/hermes-bots/group-attachments.ts` | Group-chat attachments: turning picked, pasted, or dropped files into the |
| `apps/desktop/src/plugins/hermes-bots/group-bot-handoff.test.ts` | pins: opening a bot from a fronted room |
| `apps/desktop/src/plugins/hermes-bots/group-chat-parts.test.tsx` | pins: the @-token at the caret |
| `apps/desktop/src/plugins/hermes-bots/group-chat-parts.tsx` | The leaf components a group-chat room composes: the room picture controls, |
| `apps/desktop/src/plugins/hermes-bots/group-chat-timeline.test.tsx` | pins: keeps every public member reply readable in room arrival order across interleaved threads |
| `apps/desktop/src/plugins/hermes-bots/group-chat-view-members.test.ts` | pins: setGroupChatMembers |
| `apps/desktop/src/plugins/hermes-bots/group-chat-view-members.tsx` | Membership editing for an EXISTING group room (#91329, #110736): the |
| `apps/desktop/src/plugins/hermes-bots/group-chat-view.inline-code.test.tsx` | pins: themes inline code in room message bodies with the chat inline-code tokens |
| `apps/desktop/src/plugins/hermes-bots/group-chat-view.render.test.tsx` | pins: renders member replies through the shell message renderer, resolving media only for members on this gateway |
| `apps/desktop/src/plugins/hermes-bots/group-chat-view.test.ts` | pins: opening a room |
| `apps/desktop/src/plugins/hermes-bots/group-chat-view.tsx` | The group-chat room surface: the merged room view, its settings dialog, the |
| `apps/desktop/src/plugins/hermes-bots/group-chat-view.wrap.test.tsx` | pins: soft-wraps fenced code in room message bodies instead of scrolling sideways |
| `apps/desktop/src/plugins/hermes-bots/group-chat.test.ts` | pins: log window |
| `apps/desktop/src/plugins/hermes-bots/group-chat.ts` | The group-chat room store: the room atoms, the durable record in plugin |
| `apps/desktop/src/plugins/hermes-bots/group-compress.test.tsx` | pins: compressGroupMemberHistory resumes each stored session for the member and compresses the live runtime id |
| `apps/desktop/src/plugins/hermes-bots/group-compress.ts` | Manual compression of a room member's hidden plumbing sessions (#102291). |
| `apps/desktop/src/plugins/hermes-bots/group-external-writes.test.ts` | pins: external writes into a member session |
| `apps/desktop/src/plugins/hermes-bots/group-external-writes.ts` | Mirror of what a member said and heard OUTSIDE the room engine. (#93813) |
| `apps/desktop/src/plugins/hermes-bots/group-hold-status.test.tsx` | pins: durable group holds |
| `apps/desktop/src/plugins/hermes-bots/group-hold-status.tsx` | Durable room-level explanation for sticky Stop holds. Activity is scoped to |
| `apps/desktop/src/plugins/hermes-bots/group-membership.test.ts` | pins: membership metadata |
| `apps/desktop/src/plugins/hermes-bots/group-membership.ts` | Who is in a room: the membership keys, the ui_meta group lists each bot |
| `apps/desktop/src/plugins/hermes-bots/group-mention-text.test.tsx` | pins: group mention rendering |
| `apps/desktop/src/plugins/hermes-bots/group-mention-text.tsx` | Semantic @mention rendering for group-room transcripts (#91359). |
| `apps/desktop/src/plugins/hermes-bots/group-order.test.ts` | pins: room display order |
| `apps/desktop/src/plugins/hermes-bots/group-order.ts` | Reorder room slots, not bots or folders. Pinning remains the outer band. */ |
| `apps/desktop/src/plugins/hermes-bots/group-panes.test.ts` | pins: group composer drafts |
| `apps/desktop/src/plugins/hermes-bots/group-panes.ts` | The window-local state a group-chat room needs but never renders: the |
| `apps/desktop/src/plugins/hermes-bots/group-pin.test.ts` | pins: group chat pin |
| `apps/desktop/src/plugins/hermes-bots/group-pin.ts` | Flip a group chat's "Pin to top" flag (hermes-agent#89813). The roster |
| `apps/desktop/src/plugins/hermes-bots/group-presence.ts` | All presence consumers share the exact owner captured by the room driver. */ |
| `apps/desktop/src/plugins/hermes-bots/group-round-members.ts` | #129443: member keys the driving user send explicitly addressed |
| `apps/desktop/src/plugins/hermes-bots/group-round-prompt.ts` | Viewer identity for a room-log line. A bare string is the local, unsourced |
| `apps/desktop/src/plugins/hermes-bots/group-rounds.addressed.test.ts` | pins: explicitlyAddressedMemberKeys |
| `apps/desktop/src/plugins/hermes-bots/group-rounds.primary-alias.test.ts` | pins: keeps primary handoffs callable in both directions across persisted descriptor shapes |
| `apps/desktop/src/plugins/hermes-bots/group-rounds.test.ts` | pins: routing |
| `apps/desktop/src/plugins/hermes-bots/group-rounds.ts` | Room-level coordination: who speaks, in what order, for how long — the |
| `apps/desktop/src/plugins/hermes-bots/group-rounds.unaddressed.test.ts` | pins: unaddressedGroupMentions |
| `apps/desktop/src/plugins/hermes-bots/group-slash.test.ts` | pins: rejects command-shaped sends visibly without changing the room or reaching a member, even with attachments |
| `apps/desktop/src/plugins/hermes-bots/group-slash.ts` | Group rooms cannot dispatch slash commands. Keep command-shaped input out |
| `apps/desktop/src/plugins/hermes-bots/group-test-utils.ts` | A scripted gateway for the group-chat room-engine tests. |
| `apps/desktop/src/plugins/hermes-bots/group-turns.test.ts` | pins: session resolution |
| `apps/desktop/src/plugins/hermes-bots/group-turns.ts` | One member's turn: its hidden per-group session, the submit/poll loop that |
| `apps/desktop/src/plugins/hermes-bots/hidden-bots.test.ts` | pins: hiding persists locally and cross-machine |
| `apps/desktop/src/plugins/hermes-bots/hidden-bots.ts` | Roster-display hiding: the session-only reveal toggle, the two per-row |
| `apps/desktop/src/plugins/hermes-bots/hide-bot-chats.runtime.test.ts` | pins: Bot Mode hidden-session reconciliation lifecycle |
| `apps/desktop/src/plugins/hermes-bots/hide-bot-chats.test.ts` | pins: the id half: group room member sessions |
| `apps/desktop/src/plugins/hermes-bots/hygiene.test.ts` | pins: removed-connection sweep |
| `apps/desktop/src/plugins/hermes-bots/hygiene.ts` | Deleted-connection roster hygiene: the pure half of the #93492 sweep. |
| `apps/desktop/src/plugins/hermes-bots/i18n-bind.ts` | Bind the message SHAPE to a plugin translator: string leaves resolve now, |
| `apps/desktop/src/plugins/hermes-bots/i18n-messages.ts` | Message SHAPE for Bot Mode's plugin-scoped i18n bundles (see `./i18n.ts`). |
| `apps/desktop/src/plugins/hermes-bots/i18n-test-helper.ts` | Resolve a Bot Mode message key against the plugin's own `en` bundle. |
| `apps/desktop/src/plugins/hermes-bots/i18n.ts` | Plugin-scoped i18n for Bot Mode — bundles registered under the plugin id via |
| `apps/desktop/src/plugins/hermes-bots/labels.profile-name.test.ts` | pins: profile-name identity |
| `apps/desktop/src/plugins/hermes-bots/labels.ts` | The presentation leaves every Bot Mode surface reads: the name a row shows, |
| `apps/desktop/src/plugins/hermes-bots/legacy-sdk-compat.test.ts` | pins: an SDK without the optional capability exports |
| `apps/desktop/src/plugins/hermes-bots/mcp-setup.tsx` | Inline per-profile MCP setup: the `mcp.servers.*` RPC wrapper, its |
| `apps/desktop/src/plugins/hermes-bots/model-picker.test.tsx` | pins: a bot gateway that never answers |
| `apps/desktop/src/plugins/hermes-bots/model-picker.tsx` | Provider + model dropdowns backed by the gateway's `model.options` |
| `apps/desktop/src/plugins/hermes-bots/new-compact-guard.test.ts` | pins: isCanonicalChatOnScreen |
| `apps/desktop/src/plugins/hermes-bots/pet.test.tsx` | pins: the pet gallery |
| `apps/desktop/src/plugins/hermes-bots/pet.tsx` | The Pet tab: browse the petdex gallery and use a companion's first sprite |
| `apps/desktop/src/plugins/hermes-bots/plugin-panes.test.tsx` | pins: the Bots pane dock |
| `apps/desktop/src/plugins/hermes-bots/plugin.mentions.test.ts` | pins: Bot Chat reset guard |
| `apps/desktop/src/plugins/hermes-bots/plugin.tsx` | Hermes Bot Mode — a "one chat per agent" roster for the Hermes desktop. |
| `apps/desktop/src/plugins/hermes-bots/profile-config-capabilities.test.tsx` | pins: a build whose CapabilitiesView cannot route connections |
| `apps/desktop/src/plugins/hermes-bots/profile-config.test.ts` | pins: selecting Inherit |
| `apps/desktop/src/plugins/hermes-bots/profile-config.tsx` | The advanced profile editor: skills, toolsets, MCP servers, model and SOUL, |
| `apps/desktop/src/plugins/hermes-bots/profile-ops.test.ts` | pins: duplicating a bot |
| `apps/desktop/src/plugins/hermes-bots/profile-ops.ts` | The profile operations that reach the gateway rather than the screen: |
| `apps/desktop/src/plugins/hermes-bots/recent-session.test.ts` | pins: open recent session |
| `apps/desktop/src/plugins/hermes-bots/recent-session.ts` | "Open recent session" (hermes-agent#93054): a bot row's left click always |
| `apps/desktop/src/plugins/hermes-bots/reclaim-refresh-in-place.test.ts` | pins: session.reclaimed re-resumes the open Bot Chat WITHOUT navigating (issue 121874) |
| `apps/desktop/src/plugins/hermes-bots/relay-budget.ts` | #93911: a delivered turn runs on the target gateway, so the client must |
| `apps/desktop/src/plugins/hermes-bots/relay-deliver-budget.test.ts` | pins: bot_relay.deliver budget mirrors |
| `apps/desktop/src/plugins/hermes-bots/relay.test.ts` | pins: push-notified drain (#93091) |
| `apps/desktop/src/plugins/hermes-bots/relay.ts` | The cross-connection bot relay: the Desktop-as-router loops that let a bot |
| `apps/desktop/src/plugins/hermes-bots/roster-actions.test.ts` | pins: the first poll only seeds watermarks |
| `apps/desktop/src/plugins/hermes-bots/roster-actions.ts` | The two roster actions that reach outside a component: the unread/toast |
| `apps/desktop/src/plugins/hermes-bots/roster-pane-content.tsx` | staleNotice: string | number | null |
| `apps/desktop/src/plugins/hermes-bots/roster-pane-derivation.ts` | The two row shapes the roster sorts together — `kind` is the discriminant. */ |
| `apps/desktop/src/plugins/hermes-bots/roster-pane-dialogs.tsx` | setCreateOpen: (value: boolean) => void |
| `apps/desktop/src/plugins/hermes-bots/roster-pane-groups.tsx` | interface RosterGroupRowViewProps extends Omit<ComponentProps<typeof GroupRow>, 'needsYou'> { |
| `apps/desktop/src/plugins/hermes-bots/roster-pane-lifecycle.test.tsx` | pins: usePublishRosterSnapshot |
| `apps/desktop/src/plugins/hermes-bots/roster-pane-lifecycle.ts` | Last source inventory returned by the desktop-wide agent roster. */ |
| `apps/desktop/src/plugins/hermes-bots/roster-pane-sections.tsx` | rosterSectionCollapsed: (id: string) => boolean |
| `apps/desktop/src/plugins/hermes-bots/roster-pane-toolbar.tsx` | Mounted only while the menu is open, so the capability read happens on |
| `apps/desktop/src/plugins/hermes-bots/roster-pane.tsx` | The Bots pane itself: the roster's selection reconciliation, the |
| `apps/desktop/src/plugins/hermes-bots/roster-sections.tsx` | How the roster groups and labels what it lists: the gateway filter, the |
| `apps/desktop/src/plugins/hermes-bots/routing.test.ts` | pins: alias identity survives the hosted handoff (#89131) |
| `apps/desktop/src/plugins/hermes-bots/routing.ts` | Cross-connection routing: resolving a roster row's owning connection, the |
| `apps/desktop/src/plugins/hermes-bots/row-helpers.test.ts` | pins: previewKind classifies a roster preview |
| `apps/desktop/src/plugins/hermes-bots/row-helpers.ts` | The row-level reads a roster row is assembled from: who sent the last |
| `apps/desktop/src/plugins/hermes-bots/screen-autoraise.test.ts` | pins: screen auto-raise |
| `apps/desktop/src/plugins/hermes-bots/screen-autoraise.ts` | Raise a bot's Screen tab the moment the bot starts driving its desktop, so |
| `apps/desktop/src/plugins/hermes-bots/screen-connection.test.ts` | pins: isEventForBotScreen |
| `apps/desktop/src/plugins/hermes-bots/screen-connection.ts` | Bot Screen — connection plumbing for a bot's Bot Desktop (the headless Xfce |
| `apps/desktop/src/plugins/hermes-bots/screen-hero.tsx` | Screen hero — the big preview of a bot's computer at the top of its pane. |
| `apps/desktop/src/plugins/hermes-bots/screen-install-retention.test.tsx` | pins: retains the bot socket before display.install and releases it when the done event lands |
| `apps/desktop/src/plugins/hermes-bots/screen-install.tsx` | Bot Screen install card — installs the TigerVNC + Xfce packages on the bot's |
| `apps/desktop/src/plugins/hermes-bots/screen-isolation.test.tsx` | pins: applies lease events only from the owning host even when profile paths match |
| `apps/desktop/src/plugins/hermes-bots/screen-managed-copy.test.tsx` | pins: a managed Cloud backend gets the managed-release copy, not a self-update instruction |
| `apps/desktop/src/plugins/hermes-bots/screen-open.tsx` | Open a bot's Screen as a main-window workspace tab (host.openWorkspace), |
| `apps/desktop/src/plugins/hermes-bots/screen-pane-clipboard.test.tsx` | pins: forwards an explicit paste over the canvas to noVNC while holding the lease |
| `apps/desktop/src/plugins/hermes-bots/screen-pane-lifecycle.test.tsx` | pins: sends an intentional close before noVNC can send its statusless close on pane unmount |
| `apps/desktop/src/plugins/hermes-bots/screen-pane-status-events.test.tsx` | pins: a stopped pane learns of an external start from the pushed display.status event and attaches |
| `apps/desktop/src/plugins/hermes-bots/screen-pane.tsx` | Bot Screen pane — live view of a bot's headless desktop with Take over / Hand back. |
| `apps/desktop/src/plugins/hermes-bots/screen-portal-status-request.test.tsx` | pins: a portal status reply superseded by a newer status request does not move running/display backwards |
| `apps/desktop/src/plugins/hermes-bots/screen-portal.tsx` | Screen portal — the compact "this bot's computer" box that sits above a |
| `apps/desktop/src/plugins/hermes-bots/screen-state.test.ts` | pins: lease epoch ordering |
| `apps/desktop/src/plugins/hermes-bots/screen-state.ts` | Per-bot Bot Screen cache: backend truth (`display.status`) plus the last |
| `apps/desktop/src/plugins/hermes-bots/screen-viewer-identity.test.tsx` | pins: holds control when the lease names the hash of the server-minted viewer id, not when it names another |
| `apps/desktop/src/plugins/hermes-bots/session-sweep.ts` | The always-hidden reconciliation sweep: everything that walks Bot Mode's |
| `apps/desktop/src/plugins/hermes-bots/shared.ts` | The pieces every Bot Mode module needs and no single module can own: the |
| `apps/desktop/src/plugins/hermes-bots/skills-hub-picker.test.tsx` | pins: hub pick messages |
| `apps/desktop/src/plugins/hermes-bots/skills-hub.tsx` | The real skills hub page embedded as a picker, plus its offline search |
| `apps/desktop/src/plugins/hermes-bots/soul.test.ts` | pins: appending the protocol to an existing SOUL |
| `apps/desktop/src/plugins/hermes-bots/soul.ts` | The SOUL a bot is born with, and the agent-to-agent messaging protocol |
| `apps/desktop/src/plugins/hermes-bots/types.ts` | Bot Mode domain model. |
| `apps/desktop/src/plugins/hermes-bots/user-sections-ui.test.tsx` | pins: SectionNameDialog Enter handling |
| `apps/desktop/src/plugins/hermes-bots/user-sections-ui.tsx` | The chrome for user sections: the foldable heading (the roster's own |
| `apps/desktop/src/plugins/hermes-bots/user-sections.groups.test.ts` | pins: user sections — group chats |
| `apps/desktop/src/plugins/hermes-bots/user-sections.test.ts` | pins: user sections |
| `apps/desktop/src/plugins/hermes-bots/user-sections.ts` | USER SECTIONS — folders the user makes, not folders the topology makes. |
| `apps/desktop/src/plugins/kanban/api.connection-scope.test.ts` | pins: kanban connection scope |
| `apps/desktop/src/plugins/kanban/api.default-notify.test.ts` | pins: default board event notifications |
| `apps/desktop/src/plugins/kanban/api.events-cursor.test.ts` | pins: kanban event cursor |
| `apps/desktop/src/plugins/kanban/api.ts` | Kanban data layer. Everything goes through `ctx.rest` — the plugin's own |
| `apps/desktop/src/plugins/kanban/board-switcher-placement.test.tsx` | pins: kanban board switcher placement (#123597) |
| `apps/desktop/src/plugins/kanban/board-switcher.test.tsx` | pins: board switcher |
| `apps/desktop/src/plugins/kanban/board-switcher.tsx` | Board switcher. On the full page it is projected through |
| `apps/desktop/src/plugins/kanban/board.tsx` | The Kanban board page — mounted at `/kanban` (a ROUTES_AREA contribution) in |
| `apps/desktop/src/plugins/kanban/completion-notify.test.ts` | pins: authoritative baseline |
| `apps/desktop/src/plugins/kanban/completion-notify.ts` | Native kanban terminal-event notification (completion, blocker, failure). |
| `apps/desktop/src/plugins/kanban/drawer.test.tsx` | pins: task attachment compatibility |
| `apps/desktop/src/plugins/kanban/drawer.tsx` | Task modal — the desktop port of the dashboard's task detail, Linear-style: |
| `apps/desktop/src/plugins/kanban/i18n.ts` | Plugin-scoped i18n for kanban — bundles shipped under the plugin id via |
| `apps/desktop/src/plugins/kanban/kanban.css` | /* Machine-activity arc — a highlight that travels the card's border while an |
| `apps/desktop/src/plugins/kanban/model-override.test.tsx` | pins: override label |
| `apps/desktop/src/plugins/kanban/model-override.tsx` | Per-task model override — the board's half of the composer's model picker. |
| `apps/desktop/src/plugins/kanban/orchestration.tsx` | Orchestration settings — the dashboard's dispatcher-knobs panel, flat-styled: |
| `apps/desktop/src/plugins/kanban/plugin.tsx` | Kanban — the founding plugin use case, now pure SDK-consumer work: a |
| `apps/desktop/src/plugins/kanban/run-clock.test.tsx` | pins: RunClock |
| `apps/desktop/src/plugins/kanban/transfer.ts` | Board export / import flows — the same shape as the profile ones |
| `apps/desktop/src/plugins/kanban/types.ts` | The slice of the kanban REST contract the board renders. The backend |
| `apps/desktop/src/plugins/kanban/ui.tsx` | Shared kanban UI atoms: formatters, the identity avatar, the status menu, |
| `apps/desktop/src/plugins/radio/README.md` | Bundled Hermes Desktop plugin, **off by default**. Enable **Radio** in |
| `apps/desktop/src/plugins/radio/plugin.js` | atom, Button, createBudgetedLoop, GlyphSpinner, icons, Popover, PopoverContent, PopoverTrigger, |
| `apps/desktop/src/sdk/areas.ts` | Titlebar slots are PERMANENT mount points: a component registered here |
| `apps/desktop/src/sdk/bridge.test.ts` | pins: host capabilities bridge |
| `apps/desktop/src/sdk/bridge.ts` | Typed capabilities bridge for desktop plugins (`host.skills`, `host.toolsets`, |
| `apps/desktop/src/sdk/composer.ts` | A plugin's session address resolved for the two composer buses. `target` is |
| `apps/desktop/src/sdk/host-state.test.ts` | pins: host.state focused-session atoms |
| `apps/desktop/src/sdk/i18n.ts` | THE language-pack surface: add a whole UI language (or extend one) at |
| `apps/desktop/src/sdk/index.test.ts` | pins: host.warmProfile routing contract |
| `apps/desktop/src/sdk/index.ts` | @hermes/plugin-sdk — THE plugin language. The vscode-module model: plugin |
| `apps/desktop/src/sdk/open-session-refresh-in-place.test.ts` | pins: host.openSession refreshInPlace — background re-resume never navigates (issue 121874) |
| `apps/desktop/src/sdk/plugin-contract.ts` | The plugin authoring contract types; the SDK barrel re-exports them. |
| `apps/desktop/src/sdk/plugin-open-session-plan.test.ts` | pins: planPluginOpenSession |
| `apps/desktop/src/sdk/plugin-open-session-plan.ts` | How `host.openSession` should treat a named profile. |
| `apps/desktop/src/sdk/profile-request.ts` | Plugin-facing profile routing for `host.requestProfile` and friends. */ |
| `apps/desktop/src/sdk/profile-routing.test.ts` | pins: connection-aware plugin host APIs |
| `apps/desktop/src/sdk/runtime.ts` | Runtime SDK injection — the other half of the vscode-module model. Bundled |
| `apps/desktop/src/sdk/sessions.ts` | Pins and colours are keyed by the DURABLE (lineage-root) id so they survive |
| `apps/desktop/src/sdk/settings.test.ts` | pins: host.settings |
| `apps/desktop/src/sdk/settings.ts` | accepts(value: unknown): value is T |
| `apps/desktop/src/store/active-work.test.ts` | pins: active work bridge |
| `apps/desktop/src/store/active-work.ts` | Mirror of "which chats are mid-turn" to the main process. |
| `apps/desktop/src/store/activity.ts` | const COMPLETED_TTL_MS = 5 * 60 * 1000 |
| `apps/desktop/src/store/agent-notices.test.ts` | pins: drops a notice with no text |
| `apps/desktop/src/store/agent-notices.ts` | Wire shape of a `notification.show` payload — the driver-agnostic |
| `apps/desktop/src/store/agent-plugins.test.ts` | pins: installAgentPlugin |
| `apps/desktop/src/store/agent-plugins.ts` | Feature store for backend (agent) plugins — the native Hermes plugins plus |
| `apps/desktop/src/store/ambient.ts` | One window owns each cross-window ambient cue (turn-end sound, spoken reply) |
| `apps/desktop/src/store/appearance-apply.test.ts` | pins: applyAppearance |
| `apps/desktop/src/store/appearance-apply.ts` | What `set_theme` and its picker cards change: accent, light/dark mode and |
| `apps/desktop/src/store/approval-mode.test.ts` | pins: profile-scoped approval mode cache |
| `apps/desktop/src/store/approval-mode.ts` | const APPROVAL_MODES = new Set<ApprovalMode>(['manual', 'smart', 'off']) |
| `apps/desktop/src/store/artifacts.test.ts` | pins: artifacts store |
| `apps/desktop/src/store/artifacts.ts` | ARTIFACT REGISTRY — substantial generated content (HTML pages, large SVGs, |
| `apps/desktop/src/store/backdrop.ts` | Whether the faint statue image renders behind the chat transcript. */ |
| `apps/desktop/src/store/background-delegation.test.ts` | pins: tracks only the owning runtime session, independent of foreground busy state and child stream text |
| `apps/desktop/src/store/background-delegation.ts` | Running/queued background children belonging to this runtime session. */ |
| `apps/desktop/src/store/billing-block.test.ts` | pins: clearBillingBlock scoped to a session leaves a different session block intact |
| `apps/desktop/src/store/billing-block.ts` | The active inference billing wall, if any. Set from the gateway |
| `apps/desktop/src/store/boot.ts` | The blocked-update screen's hold alone, outside the boot steps (R8 M6). */ |
| `apps/desktop/src/store/bot-chat-scope.test.ts` | pins: the bot-chat set moves independently of session state |
| `apps/desktop/src/store/busy-input-mode.ts` | const mode = typeof value === 'string' ? value.trim().toLowerCase() : '' |
| `apps/desktop/src/store/butterbar.test.ts` | pins: butterbar store |
| `apps/desktop/src/store/butterbar.ts` | Shows a close button. Implied by `persistKey`. */ |
| `apps/desktop/src/store/chat-text-scale.test.ts` | pins: restores the selected chat scale without changing window zoom or global typography |
| `apps/desktop/src/store/chat-text-scale.ts` | function normalizeChatTextScale(value: unknown): ChatTextScale { |
| `apps/desktop/src/store/clarify.test.ts` | pins: clarify store |
| `apps/desktop/src/store/clarify.ts` | Local receipt time (Unix seconds), used to reject stale resume cleanup. */ |
| `apps/desktop/src/store/coding-status.test.ts` | pins: refreshRepoStatus |
| `apps/desktop/src/store/coding-status.ts` | Reactive status for one repo cwd (a tile's worktree). Stable per cwd. */ |
| `apps/desktop/src/store/command-palette.ts` | Whether the global command palette (Cmd/Ctrl+K) is currently open. */ |
| `apps/desktop/src/store/compaction.test.ts` | pins: compaction store |
| `apps/desktop/src/store/compaction.ts` | Is `sessionId` compacting? Per-session because a transcript may be a tile, |
| `apps/desktop/src/store/completion-sound.ts` | Range mirrors COMPLETION_SOUND_VARIANTS in lib/completion-sound.ts. Validating |
| `apps/desktop/src/store/composer-actions.ts` | Composer micro actions — the floating pill strip at the top of the composer's |
| `apps/desktop/src/store/composer-draft-retry.ts` | The identity of an uncertain send that was restored into a composer draft. |
| `apps/desktop/src/store/composer-input-history.test.ts` | pins: deriveUserHistory |
| `apps/desktop/src/store/composer-input-history.ts` | Per-session input history browse state. |
| `apps/desktop/src/store/composer-popout-preference.test.ts` | pins: composer pop-out preference |
| `apps/desktop/src/store/composer-popout.test.ts` | pins: clampPopoutPosition |
| `apps/desktop/src/store/composer-popout.ts` | Viewport-relative bottom/right insets keep the resting corner stable as a draft grows. */ |
| `apps/desktop/src/store/composer-queue.test.ts` | pins: composer queue store |
| `apps/desktop/src/store/composer-queue.ts` | Local owner routes use canonical admission; remote legacy queues stay local. */ |
| `apps/desktop/src/store/composer-status-drawer.test.ts` | pins: restores the hidden choice without sharing it with another session or owner |
| `apps/desktop/src/store/composer-status-drawer.ts` | Only hidden drawers need an entry; new conversations keep the existing open default. */ |
| `apps/desktop/src/store/composer-status.test.ts` | pins: reconcileBackgroundProcesses |
| `apps/desktop/src/store/composer-status.ts` | Composer status stack feed — merged todos, subagents, background per session. */ |
| `apps/desktop/src/store/composer.test.ts` | pins: voice conversation start requests |
| `apps/desktop/src/store/composer.ts` | Release blob: chip previews created for OS image drops (see #63682). */ |
| `apps/desktop/src/store/confirm.ts` | Run the captured request, not a replacement that arrived during I/O. */ |
| `apps/desktop/src/store/connection-registry-state.ts` | Null only for the legacy profile-only Desktop topology. Once Electron has |
| `apps/desktop/src/store/connection-request.test.ts` | pins: connection-request store |
| `apps/desktop/src/store/connection-request.ts` | The backend sends ``prompt`` as null when the catalog entry has none; the form takes an absent one. */ |
| `apps/desktop/src/store/connections-new-chat-route.test.ts` | pins: re-homes an explicit draft with the selected source, including the return trip |
| `apps/desktop/src/store/connections.test.ts` | pins: connection registry cache |
| `apps/desktop/src/store/connections.ts` | @internal Reset module-owned preferences and switch coordination for tests. */ |
| `apps/desktop/src/store/cron.test.ts` | pins: cron jobs request fencing |
| `apps/desktop/src/store/cron.ts` | Cron *jobs* (not run sessions) power the sidebar "Cron jobs" section. Listing |
| `apps/desktop/src/store/custom-models.test.ts` | pins: custom models |
| `apps/desktop/src/store/custom-models.ts` | A model id the user typed in rather than picked from a provider's catalog. |
| `apps/desktop/src/store/data-url-read-max.test.ts` | pins: clampDataUrlReadMaxMb |
| `apps/desktop/src/store/data-url-read-max.ts` | Max size for local files Desktop loads as data URLs (composer attach, image |
| `apps/desktop/src/store/dead-session-prune.test.ts` | pins: __runDeadSessionPrunePass |
| `apps/desktop/src/store/dead-session-prune.ts` | Prune renderer-stored session references whose sessions no longer exist on |
| `apps/desktop/src/store/default-profile-startup.test.ts` | pins: startup default route |
| `apps/desktop/src/store/default-profile.test.ts` | pins: default profile preference |
| `apps/desktop/src/store/default-profile.ts` | Electron owns persistence and cross-window changes. This atom is only a |
| `apps/desktop/src/store/desktop-metrics.test.ts` | pins: consent gate |
| `apps/desktop/src/store/desktop-metrics.ts` | Desktop love/hate telemetry: which areas get used, which buttons get |
| `apps/desktop/src/store/disable-f12.ts` | Disable F12 DevTools shortcut — a device-local preference. |
| `apps/desktop/src/store/display-timestamps.ts` | `display.timestamps` — one config key for message timestamps everywhere. |
| `apps/desktop/src/store/display-toggles.test.ts` | pins: display toggle mirror |
| `apps/desktop/src/store/display-toggles.ts` | Appearance switches the BACKEND also has to know about. |
| `apps/desktop/src/store/embed-consent.ts` | Global default: ask (placeholder), always (auto-load), off (plain link). */ |
| `apps/desktop/src/store/external-links.test.ts` | pins: always-external-links store |
| `apps/desktop/src/store/external-links.ts` | Always open links in the system browser — a device-local preference. |
| `apps/desktop/src/store/favorite-models.test.ts` | pins: favorite models keep their starred order |
| `apps/desktop/src/store/favorite-models.ts` | Stable `provider::model` key for a favorite. Reuses the visibility-store |
| `apps/desktop/src/store/file-actions.test.ts` | pins: shouldOfferRemoteFileDownload |
| `apps/desktop/src/store/file-actions.ts` | Display name (basename) shown in dialogs. */ |
| `apps/desktop/src/store/find-in-page.ts` | Bumped when openFindBar() is called while the bar is already visible, so |
| `apps/desktop/src/store/fleet-roster.test.ts` | pins: fleet roster recovery |
| `apps/desktop/src/store/fleet-roster.ts` | export function _resetFleetRosterForTests(): void { |
| `apps/desktop/src/store/free-tier-challenge.test.ts` | pins: runFreeTierChallenge |
| `apps/desktop/src/store/free-tier-challenge.ts` | The free tier's browser challenge, renderer half: a relay. The backend |
| `apps/desktop/src/store/free-tier-offer.test.ts` | pins: sign-in offer after a finished task |
| `apps/desktop/src/store/free-tier-setup-failure.test.ts` | pins: freeTierSetupFailure |
| `apps/desktop/src/store/free-tier-sign-in.test.ts` | pins: free-tier sign-in attempts |
| `apps/desktop/src/store/free-tier-sign-in.ts` | Why a sign-in ended without tokens. Each maps to one ruled screen: |
| `apps/desktop/src/store/free-tier.ts` | The model the free-tier route runs on. Used to recognise a session that is |
| `apps/desktop/src/store/gateway-activation-prune-lease.test.ts` | pins: activation lease vs. the live-work pruner (#89622) |
| `apps/desktop/src/store/gateway-agent-scope.test.ts` | pins: registry-agent scope eviction (activeGateway must never silently hit the primary) |
| `apps/desktop/src/store/gateway-background-reconnect.test.ts` | pins: background remote turn reconnect |
| `apps/desktop/src/store/gateway-connection-lifecycle.test.ts` | pins: a redial of the active route |
| `apps/desktop/src/store/gateway-connection-scope.test.ts` | pins: primary gateway registry scope |
| `apps/desktop/src/store/gateway-foreground-retention.test.ts` | pins: foreground tile retention vs. the live-work pruner (#93892) |
| `apps/desktop/src/store/gateway-profile-only-owner.integration.test.ts` | pins: profile-only secondary approval ownership |
| `apps/desktop/src/store/gateway-profile-request.test.ts` | pins: requestGatewayForProfile |
| `apps/desktop/src/store/gateway-reconnect.test.ts` | pins: gateway reconnect controller |
| `apps/desktop/src/store/gateway-reconnect.ts` | Why the reconnect is running. `'manual'` (default) is an explicit user |
| `apps/desktop/src/store/gateway-relay-retention.test.ts` | pins: bot-relay gateway retention (#93594) |
| `apps/desktop/src/store/gateway-secondary-open-check.test.ts` | pins: secondary activation requires an open socket, not just a connection descriptor (issue #92265) |
| `apps/desktop/src/store/gateway-shared-remote.test.ts` | pins: ensureGatewayForProfile under a shared global remote |
| `apps/desktop/src/store/gateway-switch.test.ts` | pins: wipeSessionListsForGatewaySwitch |
| `apps/desktop/src/store/gateway-switch.ts` | Renderer-side cleanup a connection switch must run before the next gateway |
| `apps/desktop/src/store/gateway.test.ts` | pins: ensureGatewayForProfile — secondary connect failure surfaces (#81094) |
| `apps/desktop/src/store/gateway.ts` | Electron's published descriptor is authoritative for a primary gateway's |
| `apps/desktop/src/store/goals.test.ts` | pins: goal store |
| `apps/desktop/src/store/goals.ts` | $goalsBySession.set({ ...$goalsBySession.get(), [sid]: goal }) |
| `apps/desktop/src/store/haptics.ts` | export const $hapticsMuted = atom(storedBoolean(HAPTICS_MUTED_STORAGE_KEY, false)) |
| `apps/desktop/src/store/hub-actions.blocked.test.ts` | pins: the current CLI |
| `apps/desktop/src/store/hub-actions.test.ts` | pins: installHubSkill failure surfacing |
| `apps/desktop/src/store/hub-actions.ts` | Toast for a failed hub action: a blocked install explains the scan gate and |
| `apps/desktop/src/store/hud.test.ts` | pins: openHud profile targeting (#82285) |
| `apps/desktop/src/store/hud.ts` | HUD mode — the chrome-free floating chat. |
| `apps/desktop/src/store/interface-mode.test.ts` | pins: interface mode persistence |
| `apps/desktop/src/store/interface-mode.ts` | Picker order — the quiet option first. */ |
| `apps/desktop/src/store/intro-splash.ts` | Whether the wordmark + tagline splash renders on an empty chat. */ |
| `apps/desktop/src/store/kanban-connection-scope.test.ts` | pins: connection-switch query invalidation |
| `apps/desktop/src/store/keep-awake.test.ts` | pins: keep-awake store |
| `apps/desktop/src/store/keep-awake.ts` | Keep-awake — stop the machine sleeping during long, unattended runs. |
| `apps/desktop/src/store/keybinds.test.ts` | pins: keybinds store persist vs late-registered contributed actions |
| `apps/desktop/src/store/keybinds.ts` | Live combos for an action: explicit binding → stored override → default. */ |
| `apps/desktop/src/store/layout-connection-scope.test.ts` | pins: connection-scoped sidebar lists (#77318) |
| `apps/desktop/src/store/layout-dismissed-projects.test.ts` | pins: filterVisibleProjects |
| `apps/desktop/src/store/layout-flipped-sides.test.ts` | pins: side toggles follow the flip |
| `apps/desktop/src/store/layout-pinned-order.test.ts` | pins: setPinnedSessionOrder |
| `apps/desktop/src/store/layout-sidebar-view.test.ts` | pins: the sidebar as it ships |
| `apps/desktop/src/store/layout.ts` | The file tree's id in the LAYOUT TREE — distinct from the pane-state id |
| `apps/desktop/src/store/live-sync.ts` | `pet.info.meta`-shaped payload carried on `pet.changed` — lets the pet skip |
| `apps/desktop/src/store/local-model-offer.ts` | Install-level: the local-model offer opens at most once per install, and a dismiss is final. */ |
| `apps/desktop/src/store/local-models-flag.ts` | Feature-flag gate for every local-models surface in the GUI. |
| `apps/desktop/src/store/local-models-surfaces.test.tsx` | pins: uses one status polling clock across staggered Settings, picker and menu mounts |
| `apps/desktop/src/store/local-runtime-jobs.test.ts` | pins: local runtime jobs store — pause/settle contract |
| `apps/desktop/src/store/local-runtime-jobs.ts` | Legacy primary routes have no registry pin. Fence them by endpoint instead. |
| `apps/desktop/src/store/local-setup-offer.test.ts` | pins: local-setup offer eligibility |
| `apps/desktop/src/store/local-setup-offer.ts` | Local-setup eligibility: whether this machine can run a model locally, read |
| `apps/desktop/src/store/managed-updates.test.ts` | pins: runManagedUpdate |
| `apps/desktop/src/store/managed-updates.ts` | Renderer-side lifecycle of one managed SSH update (#93042 renderer unit, |
| `apps/desktop/src/store/mcp-deeplink-install.ts` | Pending `hermes://mcp/install` request awaiting the user's explicit |
| `apps/desktop/src/store/mcp-health.test.ts` | pins: shouldNotify |
| `apps/desktop/src/store/mcp-health.ts` | Background MCP health checker. On gateway connect — and every 30 minutes |
| `apps/desktop/src/store/model-assignment.ts` | Selection-guard warning as a confirm toast. Resolves true on Confirm, false |
| `apps/desktop/src/store/model-presets.test.ts` | pins: model presets |
| `apps/desktop/src/store/model-presets.ts` | Per-model reasoning/fast preset, remembered globally across sessions and |
| `apps/desktop/src/store/model-pricing.ts` | Whether the model picker shows per-model token prices. Off by default: most rows are noise until you're comparing cost. */ |
| `apps/desktop/src/store/model-visibility.test.ts` | pins: model visibility |
| `apps/desktop/src/store/model-visibility.ts` | Every `provider::model` key the user has had a chance to judge — snapshotted |
| `apps/desktop/src/store/nanostores-batch-guard.test.ts` | pins: nanostores batch() |
| `apps/desktop/src/store/native-notifications.test.ts` | pins: dispatchNativeNotification focus gating |
| `apps/desktop/src/store/native-notifications.ts` | Last-resort label for a session the renderer has no row for (yet): the id |
| `apps/desktop/src/store/notifications.test.ts` | pins: gateway_auth_failed error is summarized as sign-in, with an Open Gateways action |
| `apps/desktop/src/store/notifications.ts` | When set, renders this codicon instead of the default kind icon. */ |
| `apps/desktop/src/store/notify-baseline.ts` | Called on every gateway `open`. Opens the quiet window. */ |
| `apps/desktop/src/store/onboarding-decide.test.ts` | pins: the launch due check |
| `apps/desktop/src/store/onboarding-intro.ts` | The first-run intro as this window shows it, in memory only: whether it runs at all is the |
| `apps/desktop/src/store/onboarding-owner.test.ts` | pins: cancels on the original owner after the foreground changes |
| `apps/desktop/src/store/onboarding-phase.ts` | Where first-run onboarding is: `shown` while it runs, then how it ended. Funnel telemetry reads it. */ |
| `apps/desktop/src/store/onboarding-presence.ts` | First-run onboarding's due check has answered (or the person went on without it, or it does not |
| `apps/desktop/src/store/onboarding-run.test.ts` | pins: onboarding run |
| `apps/desktop/src/store/onboarding-run.ts` | First-run onboarding as this window runs it: one chat in the default profile, opened by the |
| `apps/desktop/src/store/onboarding-scope.ts` | Capture both halves once. An absent connection keeps legacy per-profile |
| `apps/desktop/src/store/onboarding-session.ts` | The computer the run lives on (`activeGatewayConnectionId()` at its start); only its backend knows the run. */ |
| `apps/desktop/src/store/onboarding.test.ts` | pins: refreshOnboarding |
| `apps/desktop/src/store/onboarding.ts` | null until the first runtime check resolves. Seeded from localStorage so |
| `apps/desktop/src/store/pane-focus.ts` | Reveal a desktop pane by name. Returns false for an unknown pane. */ |
| `apps/desktop/src/store/panes.test.ts` | pins: panes store |
| `apps/desktop/src/store/panes.ts` | Vertical size override (px) for panes that resize on the Y axis (e.g. the bottom-row terminal). */ |
| `apps/desktop/src/store/parked-card-answers.test.ts` | pins: parked card answers |
| `apps/desktop/src/store/parked-card-answers.ts` | Answers a card parked on `sessionId` with composer text: null when no card of this kind takes it, |
| `apps/desktop/src/store/pending-submissions-windows.test.ts` | pins: one window |
| `apps/desktop/src/store/pending-submissions.test.ts` | pins: projects resumed runtime pending receipts under durable identity without making them sendable |
| `apps/desktop/src/store/pending-submissions.ts` | Where in the session's event order the owner last listed this admission as pending. */ |
| `apps/desktop/src/store/pet-gallery.test.ts` | pins: pet gallery pet.info sync |
| `apps/desktop/src/store/pet-gallery.ts` | Feature store for the petdex gallery picker (Cmd+K "Pets…" + Settings). |
| `apps/desktop/src/store/pet-generate.ts` | Feature store for the "generate a pet" flow (Cmd-K → Pets → Generate). |
| `apps/desktop/src/store/pet-overlay.ts` | Controller for the pop-out pet overlay (main-renderer side). |
| `apps/desktop/src/store/pet-plugin-messages.ts` | Plugin lines for the pet's speech bubble — the store behind `ctx.pet.say`. |
| `apps/desktop/src/store/pet.test.ts` | pins: derivePetState |
| `apps/desktop/src/store/pet.ts` | Petdex mascot state for the desktop floating pet. |
| `apps/desktop/src/store/plugin-catalog-install.test.ts` | pins: requestPluginCatalogInstallFromDeepLink |
| `apps/desktop/src/store/plugin-catalog-install.ts` | THE way a curated-catalog pick reaches the Install Plugin dialog. The |
| `apps/desktop/src/store/plugin-install-request.ts` | Which plugin component(s) a legacy deeplink pre-selects after probe. */ |
| `apps/desktop/src/store/power.ts` | AC ↔ battery mirror of the main process's powerMonitor. |
| `apps/desktop/src/store/preview-edit.ts` | URLs of preview targets that have unsaved spot-editor changes, keyed by |
| `apps/desktop/src/store/preview-explicit.ts` | An explicit preview open (tool or user `openPreview`) must survive a later |
| `apps/desktop/src/store/preview-open-browser.test.ts` | pins: openBrowserTab |
| `apps/desktop/src/store/preview-ownership.ts` | PREVIEW TAB OWNERSHIP — who a preview tab belongs to. |
| `apps/desktop/src/store/preview-persistence.test.ts` | pins: persisted preview migration |
| `apps/desktop/src/store/preview-status-edge-cases.test.ts` | pins: retains a close when the same runtime owner is refined from profile-only to an exact route |
| `apps/desktop/src/store/preview-status-lifecycle.test.ts` | pins: moves local dismissals on rename and removes only the deleted owner |
| `apps/desktop/src/store/preview-status.test.ts` | pins: recordPreviewArtifact |
| `apps/desktop/src/store/preview-status.ts` | Session-scoped feed of previewable artifacts (HTML files, localhost dev URLs) |
| `apps/desktop/src/store/preview-tabs-scope.test.ts` | pins: right rail follows the chat on screen |
| `apps/desktop/src/store/preview-toggle-browser.test.ts` | pins: toggleBrowserTab |
| `apps/desktop/src/store/preview.test.ts` | pins: preview store |
| `apps/desktop/src/store/preview.ts` | PREVIEW RAIL — one list of tabs, one way in. |
| `apps/desktop/src/store/profile-agent-activation.test.ts` | pins: ensureGatewayAgent → $connection / $activeGatewayProfile sync |
| `apps/desktop/src/store/profile-cache.test.ts` | pins: keeps failed incoming profile reads isolated while retaining the outgoing connection cache |
| `apps/desktop/src/store/profile-dot-state.test.ts` | pins: profile rail dot state ($profileDotStateByScope) |
| `apps/desktop/src/store/profile-dot-state.ts` | PROFILE DOT STATE — the profile rail's per-profile rollup of the shared |
| `apps/desktop/src/store/profile-rail-prefs.ts` | The colored profile strip at the sidebar foot. For someone who runs profiles |
| `apps/desktop/src/store/profile-remote-override.test.ts` | pins: remoteHostLabel |
| `apps/desktop/src/store/profile-remote-override.ts` | hostname[:port] parsed from the override URL — the display label. */ |
| `apps/desktop/src/store/profile-select-source.test.ts` | pins: selectProfile |
| `apps/desktop/src/store/profile-share.test.ts` | pins: buildDesktopOverlay |
| `apps/desktop/src/store/profile-share.ts` | Profile share: export/import a profile as a portable bundle. |
| `apps/desktop/src/store/profile-switch-failure.test.ts` | pins: ensureGatewayProfile — switch failure surfaces instead of silent fallback (#81094) |
| `apps/desktop/src/store/profile.test.ts` | pins: ensureGatewayProfile → $connection sync (#46651) |
| `apps/desktop/src/store/profile.ts` | The draft's exact owner — the same shape every session-scoped surface |
| `apps/desktop/src/store/project-scope.ts` | ── Project scope (the "you're inside a project" view, mirroring profile scope)─ |
| `apps/desktop/src/store/project-tree.ts` | The project tree atom lives in this leaf so store/session-states.ts can |
| `apps/desktop/src/store/projects-connection-tag.test.ts` | pins: project session connection provenance |
| `apps/desktop/src/store/projects.test.ts` | pins: project scope |
| `apps/desktop/src/store/projects.ts` | Patch every cached copy of the renamed conversation inside one project |
| `apps/desktop/src/store/prompts.test.ts` | pins: approval prompt store |
| `apps/desktop/src/store/prompts.ts` | Description override so the card can say WHAT the password is for (the Bot Screen install). |
| `apps/desktop/src/store/provider-collapse.ts` | Set of provider slugs whose model groups are currently collapsed in the |
| `apps/desktop/src/store/provider-wait.test.ts` | pins: providerWaitText |
| `apps/desktop/src/store/provider-wait.ts` | Only the core's explained wait/reconnect frames belong in Desktop's status |
| `apps/desktop/src/store/pull-requests.ts` | How a row's PR reads at a glance — and what the sidebar filters on. A |
| `apps/desktop/src/store/quick-entry.test.ts` | pins: quickComposerReducer |
| `apps/desktop/src/store/quick-entry.ts` | Quick Entry (renderer side) — the mini composer's own state, and the |
| `apps/desktop/src/store/reactions-enabled.ts` | Message reactions (iMessage-style tapbacks) — opt-in. |
| `apps/desktop/src/store/reactions-local.test.ts` | pins: live reaction overlay scope |
| `apps/desktop/src/store/reactions-local.ts` | Reactions the user has set in THIS window, keyed by renderer message id. |
| `apps/desktop/src/store/reactions.test.ts` | pins: applyReaction |
| `apps/desktop/src/store/reactions.ts` | The six iOS Tapback defaults, in Apple's order. */ |
| `apps/desktop/src/store/read-only-transcript.test.ts` | pins: read-only stored-transcript resume (#94724 no-owner recovery) |
| `apps/desktop/src/store/read-only-transcript.ts` | Read-only stored-transcript resume — the no-owner recovery path (#94724). |
| `apps/desktop/src/store/real-profile-consent.ts` | "Not now" for this app run — session-scoped on purpose (see above). */ |
| `apps/desktop/src/store/reasoning-disclosure.test.ts` | pins: localShowReasoning |
| `apps/desktop/src/store/reasoning-disclosure.ts` | Desktop-local presentation preference; shared backend config must not be changed by a single window. |
| `apps/desktop/src/store/reasoning-effort-wire-scope.test.ts` | pins: reasoning-effort wire scope |
| `apps/desktop/src/store/recovery-requests.ts` | Recovery intents raised from surfaces that have no React Router context or |
| `apps/desktop/src/store/review.test.ts` | pins: refreshReview |
| `apps/desktop/src/store/review.ts` | The repo the pane is reading right now: its pinned scope, else the active |
| `apps/desktop/src/store/right-side-toggle.test.ts` | pins: positional right-side toggle |
| `apps/desktop/src/store/route-tiles.ts` | Route (page) tiles — a full-page view (Capabilities / Messaging / Artifacts, |
| `apps/desktop/src/store/runtime-gone.test.ts` | pins: markRuntimeGone |
| `apps/desktop/src/store/runtime-gone.ts` | Latch `sid` off and heal the bound view. Safe to call on every 4001. */ |
| `apps/desktop/src/store/send-diagnostics.test.ts` | pins: send-diagnostics store |
| `apps/desktop/src/store/send-diagnostics.ts` | Short text describing the failure that prompted the report (attached |
| `apps/desktop/src/store/server-requests.ts` | Live server→client requests (`tui_gateway/server_requests.py`) keyed by |
| `apps/desktop/src/store/session-color.test.ts` | pins: $sessionColorById |
| `apps/desktop/src/store/session-color.ts` | Per-session color OVERRIDES — a user-picked color that wins over the inherited |
| `apps/desktop/src/store/session-control.test.ts` | pins: session-control store |
| `apps/desktop/src/store/session-control.ts` | Parses the stable allowlisted backend shape into fresh renderer-owned data. */ |
| `apps/desktop/src/store/session-dot-state.test.ts` | pins: showsRunningArc |
| `apps/desktop/src/store/session-dot-state.ts` | SESSION DOT STATE — one map from session id to the single status a surface |
| `apps/desktop/src/store/session-event-provenance.ts` | A profile name received over the wire is descriptive, not an ownership |
| `apps/desktop/src/store/session-focus.ts` | The stored id of the session the user is working in: a focused |
| `apps/desktop/src/store/session-gone-latch.ts` | Session ids the gateway has told us are gone. A session-scoped RPC against a |
| `apps/desktop/src/store/session-list-density.test.ts` | pins: session list density preference |
| `apps/desktop/src/store/session-list-density.ts` | Compact is the pre-density row exactly as it shipped, so existing users see |
| `apps/desktop/src/store/session-no-reply.ts` | Raised only after the backend confirmed the turn is over and no reply reached |
| `apps/desktop/src/store/session-owner-holds.ts` | @internal Tests. */ |
| `apps/desktop/src/store/session-owner-resolution.test.ts` | pins: session owner topology |
| `apps/desktop/src/store/session-owner-resolution.ts` | Fail-closed owner resolution for session-scoped RPCs. |
| `apps/desktop/src/store/session-pane-focus.test.ts` | pins: focusing a saved Bot Chat requires a visible pane |
| `apps/desktop/src/store/session-pin-connection-scope.test.ts` | pins: desktop pin list is connection-scoped, not profile-scoped |
| `apps/desktop/src/store/session-pin-sync.test.ts` | pins: watchSessionPins |
| `apps/desktop/src/store/session-pin-sync.ts` | Reconcile the sidebar's pins with the backend "keep" flag, both directions. |
| `apps/desktop/src/store/session-removal.test.ts` | pins: isSessionRemovalPending |
| `apps/desktop/src/store/session-removal.ts` | Per-id tombstone lifecycle generations (#85163). Membership alone cannot |
| `apps/desktop/src/store/session-request-router.test.ts` | pins: $activeGatewayRoute (registry-owned active profile) |
| `apps/desktop/src/store/session-request-router.ts` | The ONE authoritative exact owner of a session: the registry connection whose |
| `apps/desktop/src/store/session-sidebar-focus.test.ts` | pins: session focus while interacting with the sidebar |
| `apps/desktop/src/store/session-states-eviction.test.ts` | pins: publish-time eviction |
| `apps/desktop/src/store/session-states-foreground-scopes.test.ts` | pins: foregroundSessionScopes: owner hold across the create → foreground gap |
| `apps/desktop/src/store/session-states-interrupted-settle.test.ts` | pins: settling a deliberately interrupted live turn |
| `apps/desktop/src/store/session-states-profile-rename.test.ts` | pins: migrateTilesForProfile |
| `apps/desktop/src/store/session-states-reconnect.test.ts` | pins: reconcileBusyStatesOnReconnect |
| `apps/desktop/src/store/session-states-runtime-map.test.ts` | pins: storedSessionIdForRuntimeId |
| `apps/desktop/src/store/session-states-scopes.test.ts` | pins: liveSessionScopes |
| `apps/desktop/src/store/session-states.test.ts` | pins: foregroundSessionScopes |
| `apps/desktop/src/store/session-states.ts` | MULTI-SESSION VIEW STATE — the reactive face of the per-runtime session |
| `apps/desktop/src/store/session-switcher.test.ts` | pins: openOrAdvanceSwitcher |
| `apps/desktop/src/store/session-switcher.ts` | Mac-style session switcher (^Tab). Quick tap jumps on keydown; the HUD opens |
| `apps/desktop/src/store/session-sync.ts` | Cross-window session-list sync. Each desktop window is its own renderer |
| `apps/desktop/src/store/session-tiles-connection-scope.test.ts` | pins: session tiles across registered backend switches (#120106) |
| `apps/desktop/src/store/session-unread-remote.test.ts` | pins: markSessionUnread |
| `apps/desktop/src/store/session-unread-remote.ts` | Persisted unread flag sync (backend read-state watermark via |
| `apps/desktop/src/store/session-unread-tile.test.ts` | pins: completed-unread dot follows the focused session |
| `apps/desktop/src/store/session-unread.test.ts` | pins: persisted unread (session-unread) |
| `apps/desktop/src/store/session-unread.ts` | PERSISTED UNREAD ("finished — unread" green dot) — the durable layer under |
| `apps/desktop/src/store/session-watchdog.test.ts` | pins: session watchdog |
| `apps/desktop/src/store/session.test.ts` | pins: composer model persistence scope |
| `apps/desktop/src/store/session.ts` | @internal Reset the legacy-discard flag for tests. */ |
| `apps/desktop/src/store/settings-scope.test.ts` | pins: settings scope store |
| `apps/desktop/src/store/settings-scope.ts` | ── Shared settings "Applies to" scope ────────────────────────────────────── |
| `apps/desktop/src/store/setup-beat.test.ts` | pins: setup_beat card |
| `apps/desktop/src/store/setup-beat.ts` | Open `setup_beat` requests: the onboarding chat's card for one beat, one per session. |
| `apps/desktop/src/store/shared-metrics.ts` | Public page describing exactly what shared metrics contain and how consent windows work. */ |
| `apps/desktop/src/store/sidebar-archive.test.ts` | pins: loadArchivedSessions |
| `apps/desktop/src/store/sidebar-archive.ts` | Pages through `archived=only` until every archived row is loaded. |
| `apps/desktop/src/store/sidebar-collapse-persistence.test.ts` | pins: sidebar collapse persistence |
| `apps/desktop/src/store/sidebar-nav.test.ts` | pins: applySidebarNavPrefs |
| `apps/desktop/src/store/sidebar-nav.ts` | Payload (`data`) of a `sidebarNav.prefs` contribution. Ids are the nav rows' |
| `apps/desktop/src/store/sidebar-sort.test.ts` | pins: $sidebarSessionRankIds |
| `apps/desktop/src/store/sidebar-sort.ts` | The active sort key as a plain id order — the one ranking every sidebar |
| `apps/desktop/src/store/skill-deeplink-install.test.ts` | pins: skill link installation |
| `apps/desktop/src/store/skill-deeplink-install.ts` | The URL supplies only an identifier, never a destination profile or scan override. */ |
| `apps/desktop/src/store/starmap.test.ts` | pins: loadStarmapGraph |
| `apps/desktop/src/store/starmap.ts` | Drop one node from the cached graph immediately; return rollback. */ |
| `apps/desktop/src/store/statusbar-prefs.test.ts` | pins: statusbar whole-bar visibility |
| `apps/desktop/src/store/statusbar-prefs.ts` | Pure so the menu can derive its reset row's disabled state from the hidden |
| `apps/desktop/src/store/stream-delta-flush.ts` | Lets a mid-turn boundary (an accepted steer) paint the session's buffered stream |
| `apps/desktop/src/store/subagent-snapshot.test.ts` | pins: hydrates last tool activity without claiming it is active and preserves stream history on refresh |
| `apps/desktop/src/store/subagents.test.ts` | pins: subagent store |
| `apps/desktop/src/store/subagents.ts` | The child's own stored session id — lets UIs open its session window. */ |
| `apps/desktop/src/store/system-actions.test.ts` | pins: runGatewayRestart during the restart window (#123111) |
| `apps/desktop/src/store/system-actions.ts` | True while a gateway restart is in flight — drives the statusbar gateway |
| `apps/desktop/src/store/tabstrip-prefs.ts` | What a zone does when it has made no choice of its own. */ |
| `apps/desktop/src/store/terminal-backend-warning.test.ts` | pins: a selected non-local backend that is not ready warns once with Use Local / Open settings |
| `apps/desktop/src/store/terminal-backend-warning.ts` | Proactive warning when the selected terminal backend (Docker, SSH, …) |
| `apps/desktop/src/store/text-direction.ts` | How chat prose and the composers pick their base direction. |
| `apps/desktop/src/store/theme-pick.ts` | Open `theme.pick` requests (the set_theme picker card), one per session. |
| `apps/desktop/src/store/thread-scroll-restore.test.ts` | pins: shouldReapplyFrozenThreadScrollOffset |
| `apps/desktop/src/store/thread-scroll.test.ts` | pins: publishThreadAtBottom |
| `apps/desktop/src/store/thread-scroll.ts` | Classify live metrics as sticky-bottom or an exact reading offset. */ |
| `apps/desktop/src/store/thread-timeline.test.ts` | pins: thread timeline preference |
| `apps/desktop/src/store/thread-timeline.ts` | Desktop-local appearance preference, shared by all threads in this window. */ |
| `apps/desktop/src/store/tips.test.ts` | pins: agent tip retirement |
| `apps/desktop/src/store/tips.ts` | In-app tips — the app pointing at itself, plus the agent doing the same. |
| `apps/desktop/src/store/titlebar-app-actions.test.ts` | pins: titlebarAppActionsClusterCounts |
| `apps/desktop/src/store/titlebar-app-actions.ts` | Right is the original titlebar: Settings / Layout / HUD stay off the tab strip. */ |
| `apps/desktop/src/store/todos.test.ts` | pins: setSessionTodos finished-list auto-clear |
| `apps/desktop/src/store/todos.ts` | Live todo list per runtime session, rendered by the composer status stack |
| `apps/desktop/src/store/tool-activity.test.ts` | pins: tool feed visibility follows display.tool_progress only |
| `apps/desktop/src/store/tool-activity.ts` | Mirrors `display.tool_progress`, independent of `display.show_reasoning`: |
| `apps/desktop/src/store/tool-dismiss.ts` | type DismissedToolRows = Record<string, true> |
| `apps/desktop/src/store/tool-drafting.ts` | What `sessionId` is drafting, if anything. */ |
| `apps/desktop/src/store/tool-progress.ts` | Latest live progress of a running tool call (`tool.progress`, from MCP `notifications/progress`). */ |
| `apps/desktop/src/store/tool-view.test.ts` | pins: $toolDisclosureOpen cache |
| `apps/desktop/src/store/tool-view.ts` | Whether any of a set of disclosures is open — a run asking about its rows. |
| `apps/desktop/src/store/tours.ts` | Guided tours (the `tour` tool) — on, with a switch to stop them. |
| `apps/desktop/src/store/transcript-lightbox.ts` | The transcript lightbox's open source, hoisted out of `ZoomableImage`. |
| `apps/desktop/src/store/transcript-sync.ts` | Stored session id shared across Desktop windows. */ |
| `apps/desktop/src/store/transcript-tail-cache.test.ts` | pins: transcript tail cache |
| `apps/desktop/src/store/transcript-tail-cache.ts` | Owning scope of an entry — same shape the REST layer threads through |
| `apps/desktop/src/store/transcript-tail.test.ts` | pins: recordTranscriptTail no-op suppression |
| `apps/desktop/src/store/transcript-tail.ts` | REST TAIL-HYDRATION BOOKKEEPING — keyed by STORED session id. |
| `apps/desktop/src/store/translucency.test.ts` | pins: window translucency lever |
| `apps/desktop/src/store/translucency.ts` | Window translucency (see-through window). |
| `apps/desktop/src/store/translucency.win10.test.ts` | pins: Win10 translucency defaults (regression for #90824) |
| `apps/desktop/src/store/tutorial-lifetime.ts` | Retire tutorials once, after a month since first desktop use, not a month |
| `apps/desktop/src/store/updates-backend-check.test.ts` | pins: mapBackendCheck |
| `apps/desktop/src/store/updates-channel.test.ts` | pins: sourceUpdateChannel |
| `apps/desktop/src/store/updates.test.ts` | pins: gateway version refresh |
| `apps/desktop/src/store/updates.ts` | Desktop self-update store. Tracks distance from the configured branch, |
| `apps/desktop/src/store/user-bubble-transparency.ts` | Message bubble transparency — how much of your own bubble's fill shows. |
| `apps/desktop/src/store/vibe-hearts-enabled.test.ts` | pins: vibe hearts enabled |
| `apps/desktop/src/store/vibe-hearts-enabled.ts` | Floating vibe hearts (affection burst on ily / <3 / good bot / thanks). |
| `apps/desktop/src/store/video-playback-speed.ts` | True for rates a <video> can sensibly play at. */ |
| `apps/desktop/src/store/voice-live.test.ts` | pins: setVoiceChatMode |
| `apps/desktop/src/store/voice-live.ts` | `voice.voice_chat_mode` as the backend resolves it, plus whether GPT-Live can |
| `apps/desktop/src/store/voice-playback.ts` | export type VoicePlaybackSource = 'read-aloud' | 'voice-conversation' |
| `apps/desktop/src/store/voice-prefs.test.ts` | pins: applyVoiceStopPhraseFromConfig |
| `apps/desktop/src/store/voice-prefs.ts` | Migrate the legacy value once without editing the backend configuration. */ |
| `apps/desktop/src/store/wake-word-client-capture.test.ts` | pins: client capture failure surfacing (issue #119089) |
| `apps/desktop/src/store/wake-word.test.ts` | pins: applyWakeStatus |
| `apps/desktop/src/store/wake-word.ts` | Wake word can run at all (deps + mic + key). With `enabled` false too, hides the toggle. */ |
| `apps/desktop/src/store/windows.test.ts` | pins: isPeerInstanceWindow |
| `apps/desktop/src/store/windows.ts` | Pop the in-app Browser into its own OS window. Returns whether the |
| `apps/desktop/src/store/workspace-events.ts` | Drain the accumulated change since the previous call (the tree's consumer). */ |
| `apps/desktop/src/store/zoom.test.ts` | pins: zoom state sync |
| `apps/desktop/src/store/zoom.ts` | Window text size (zoom). |
| `apps/desktop/src/styles.css` | /* Titlebar clusters: 24×24 hit targets, 13.9px glyphs. codicon.css is |
| `apps/desktop/src/test/deferred.ts` | A promise plus the handle that settles it. |
| `apps/desktop/src/test/fake-gateway-socket.ts` | type Listener = (ev: unknown) => void |
| `apps/desktop/src/test/jsdom.ts` | A ResizeObserver that accepts observers and never calls them back. */ |
| `apps/desktop/src/test/oauth-provider.ts` | A logged-out PKCE provider. Onboarding branches on `flow` and |
| `apps/desktop/src/test/react-root.ts` | A React root in a container attached to the document, for the handful of |
| `apps/desktop/src/test/rest-bridge.ts` | Install a fake `window.hermesDesktop.api`, the preload bridge every REST helper sends through. */ |
| `apps/desktop/src/test/session-info.ts` | A `SessionInfo` with every field at its zero value. |
| `apps/desktop/src/test/window-state.ts` | Push a state change to whoever subscribed through the bridge. */ |
| `apps/desktop/src/themes/accent-override.ts` | Dev-only accent override. |
| `apps/desktop/src/themes/accents.ts` | Accent swatches and the ids the agent and the picker use for them. |
| `apps/desktop/src/themes/backend-sync.test.ts` | pins: ingestBackendSkin |
| `apps/desktop/src/themes/backend-sync.ts` | Live skin sync from the Hermes backend. |
| `apps/desktop/src/themes/chat-font.ts` | Families users ask for by name; the app face is otherwise whatever the theme declares. */ |
| `apps/desktop/src/themes/classic-skin.test.tsx` | pins: Classic Hermes is an explicit Desktop pick, never inferred from stock config (#76579) |
| `apps/desktop/src/themes/color.ts` | Desktop-only color helpers: the naive light/dark bucketer, the VS Code hex |
| `apps/desktop/src/themes/context.test.tsx` | pins: ThemeProvider ← backend skin sync |
| `apps/desktop/src/themes/context.tsx` | Desktop theme context. |
| `apps/desktop/src/themes/index.ts` | module body (no leading doc line) |
| `apps/desktop/src/themes/install.test.ts` | pins: buildThemeFromMarketplace |
| `apps/desktop/src/themes/install.ts` | Install desktop themes from external sources. |
| `apps/desktop/src/themes/persist-accent.test.tsx` | pins: persistAccent |
| `apps/desktop/src/themes/persist-accent.ts` | Save an accent on the live profile's theme: only its accent moves, saved as the `<base>-accent-<hex>` user theme |
| `apps/desktop/src/themes/presets.test.ts` | pins: theme typography emoji fallback (#40364) |
| `apps/desktop/src/themes/presets.ts` | Built-in desktop themes. Names match the CLI skins / dashboard presets. |
| `apps/desktop/src/themes/profile-theme.test.ts` | pins: named-profile appearance seeds the global fallback (#101216) |
| `apps/desktop/src/themes/request.test.tsx` | pins: requestTheme |
| `apps/desktop/src/themes/request.ts` | Imperative theme switching, for callers with no component to hang a hook on. |
| `apps/desktop/src/themes/retint.test.ts` | pins: the shipped nous accents |
| `apps/desktop/src/themes/retint.ts` | Accent retinting — re-seed a theme's accent family from one color. |
| `apps/desktop/src/themes/skin.test.ts` | pins: skinToDesktopTheme |
| `apps/desktop/src/themes/skin.ts` | Hermes skin → DesktopTheme converter. |
| `apps/desktop/src/themes/types.ts` | Desktop app theme model. |
| `apps/desktop/src/themes/use-skin-command.ts` | Old names land on a shipped theme so muscle memory works. `gold`/`hermes` |
| `apps/desktop/src/themes/user-themes.test.ts` | pins: user theme registry |
| `apps/desktop/src/themes/user-themes.ts` | User-installed desktop themes (currently: converted VS Code themes). |
| `apps/desktop/src/themes/vscode.test.ts` | pins: vscodeThemeSlug |
| `apps/desktop/src/themes/vscode.ts` | VS Code color-theme → DesktopTheme converter. |
| `apps/desktop/src/types/hermes.ts` | When true, renders a SearchableSelect (Popover + cmdk) instead of the |
| `apps/desktop/src/vite-env.d.ts` | / <reference types="vite/client" /> |
| `apps/desktop/src/webhooks-rest.test.ts` | pins: Webhook REST parity helpers |

### Tier 3 — skipped with a reason

- `apps/desktop/src/assets/catalog-wing-retro.svg` (250 KB) — vector artwork, not code; the head of
  the XML was confirmed on disk, not parsed line by line.
- `apps/desktop/src/assets/catalog-wing.svg` (50 KB) — vector artwork, not code; the head of the XML
  was confirmed on disk, not parsed line by line.
- `apps/desktop/src/assets/tiers/feature-automation.webp` — a marketing tier screenshot; binary,
  confirmed on disk.
- `apps/desktop/src/assets/tiers/feature-connect.webp` — a marketing tier screenshot; binary,
  confirmed on disk.
- `apps/desktop/src/assets/tiers/feature-memory.webp` — a marketing tier screenshot; binary,
  confirmed on disk.
- `apps/desktop/src/assets/tiers/feature-sandbox.webp` — a marketing tier screenshot; binary,
  confirmed on disk.
- `apps/desktop/src/components/pet/pet-egg-sheet.png` — a sprite sheet; binary, confirmed on disk.
- `apps/desktop/src/fonts/JetBrainsMono-Bold.woff2` — a self-hosted font binary; confirmed on disk.
- `apps/desktop/src/fonts/JetBrainsMono-Italic.woff2` — a self-hosted font binary; confirmed on disk.
- `apps/desktop/src/fonts/JetBrainsMono-Regular.woff2` — a self-hosted font binary; confirmed on disk.
- `apps/desktop/src/i18n/overlay-gaps.json` (136 KB) — a *generated* key→locale gap map produced by
  the i18n tooling; the head (the first entries) was read and the file's role confirmed from
  `apps/desktop/src/i18n/overlay-completeness.test.ts`, but the map was not parsed entry by entry.

---

## 2. Ideas worth stealing

1. **An invariant file that is written as "invariant + the bug that taught it".**
   `apps/desktop/src/AGENTS.md:44-78` states each rule and then the incident that forced it
   ("the allow-list once silently dropped every skill/quick command from completions even though
   they executed when typed"). *Why it transfers:* August Trading's `AGENTS.md` already states rules,
   but not the failure each one encodes; a rule without its incident is a rule nobody dares to
   change. `UNIQUE` to this repo.

2. **Identity by a name, resolved on every click — never a stored pointer, never "recency wins".**
   `apps/desktop/src/plugins/hermes-bots/AGENTS.md` (via `AGENTS.md:56-78`) plus
   `plugins/hermes-bots/canonical-chat.ts` (30 KB) and
   `plugins/hermes-bots/canonical-chat-registry.test.ts`. A bot's chat is the row whose title is
   exactly `"Bot Chat"`, found by an indexed UNIQUE(title) lookup every time; if a concurrent row
   exists, the creation *adopts* it rather than forking. *Why it transfers:* August Trading's bots
   and trade sessions are exactly the case where a cached pointer dangles; the fix is a
   deterministic name + a uniqueness index, not a smarter pointer. `UNIQUE`.

3. **Distinguish "the run succeeded" from "the brief reached its target".**
   `plugins/hermes-bots/cron.tsx` `routineLastResult` names `delivery_failed` separately from
   `error` and renders it as a failure. *Why it transfers:* a trading agent that "ran" and produced
   no alert (or an alert that never reached the trader) is the single most dangerous silent
   failure in a scheduled monitor. `UNIQUE` to this repo's shape; the *idea* is convergent in
   spirit with `pi`'s and `deepseek-harness`'s delivery-receipt notions.

4. **Label an overdue slot OVERDUE; never promise a next run you cannot keep.**
   `plugins/hermes-bots/cron.tsx` (`nextRunOverdueMs(job) !== null ? overdueSince : nextRun`).
   *Why it transfers:* a "next scan at 14:05" label that silently slips is worse than an honest
   "overdue since 14:05" — it teaches the trader to trust a clock that is not kept. `UNIQUE`.

5. **Surface the scheduler's own reason, not just its state.**
   `plugins/hermes-bots/cron.tsx` `routineDetailIssue` reads `last_fire_error`,
   `last_delivery_error`, `paused_reason`; and the API's `getCronJobRuns` stamps each run with the
   connection that owns it so clicking a run over SSH loads the right transcript
   (`api/cron.ts:46-67`). *Why it transfers:* August Trading's automations need the same
   "why did this not fire" row. `UNIQUE`.

6. **A journal that survives the crash of the *whole app*, with a bounded namespace and a
   tombstone for the quota failure.**
   `lib/inflight-turn-journal.ts` — a 400 ms trailing-edge write, a 24-entry / 4 MiB / 7-day
   budget, "copy first, delete second" on a key migration, and a tombstone rather than a stale
   snapshot when the write fails. *Why it transfers:* a trade plan written on screen and lost to a
   renderer crash is the same failure; the pattern (throttled snapshot + bounded store + explicit
   tombstone) is reusable verbatim. `UNIQUE`.

7. **One epoch/generation fence for every lifecycle frame.**
   `lib/execution-authority.ts` — epochs are opaque, output may follow the current owner but cannot
   establish another, only an owner snapshot/start can establish a new epoch, and an
   admission-only frame is never a lifecycle. *Why it transfers:* August Trading runs automations
   that can overlap a manual run; this is the cheapest correct way to say "this result belongs to
   the run that is still authoritative". `UNIQUE`.

8. **Reconcile the live view against the durable record with an anchored match, and pair ambiguous
   repeats by ordinal.**
   `lib/chat-messages/reconciliation.ts` — "text and provider tool-call ids are not globally unique,
   so the match is deliberately anchored to the last visible user turn"; two identical pastes are
   paired "the n-th local captioned paste names the n-th stored one". *Why it transfers:* a plan
   the trader edited on screen vs the plan that was written is the same class of problem, and the
   ordinal rule is the specific fix for "the trader pasted the same screenshot twice". `UNIQUE`.

9. **Do not treat silence as failure while work is in flight — but bound the trust.**
   `lib/gateway-liveness-policy.ts` — a probe timeout during a busy turn is *inconclusive*; defer
   once, and only close after a 2-failure streak. *Why it transfers:* a trading app polls a broker
   or a price feed; a quiet feed during a slow request is not a dead feed, and a "reconnect" that
   fires mid-trade is expensive. `UNIQUE`.

10. **Every state update carries a *reason* enum, not a boolean.**
    `lib/error-surface.ts` (`ERROR_SURFACE_LAYERS` + `ERROR_CODE_KEYS`), `lib/todos.ts`
    (`TodoStatus` = pending/in_progress/completed/cancelled), `store/session-dot-state.ts`
    (`needs-input` / `unread` / `working` / `stalled` / `background` / `draft` / `idle`).
    *Why it transfers:* August Trading already has `utils/runStatus.ts`; the Hermes addition is the
    *stalled* state — "a session that is working but has gone quiet" is a distinct condition from
    "working", and it is the one a trader must see. `CONVERGENT`.

11. **The "one place that decides" discipline, applied to *presentation* facts too.**
    `components/assistant-ui/tool/run-summary.ts` (`toolPresentVerb`), `utils/toolKinds`-style
    tables, `store/session-dot-state.ts` ("so the sidebar, the pane tabs, and the switcher can never
    disagree"), `lib/model-status-label.ts`, `components/ui/tool-icon.tsx`. *Why it transfers:*
    August Trading's "one colour+word per state" rule is the same instinct; Hermes extends it to
    the *verb* ("Explored 3 files" / "Ran 2 commands") and to the icon. `CONVERGENT`.

12. **Preserve reference identity on no-ops.**
    `store/composer-status.ts` ("an unchanged session keeps its previous array (and item objects)
    … a fully-unchanged map keeps its previous reference so `computed` skips the notify"),
    `lib/stable-array.ts`, and the whole `debug/README.md` measurement rig
    (`window.__RENDER_COUNTS__`, `window.__ATOM_CHURN__`, and a `wasted` column that is literally
    "the fix list"). *Why it transfers:* August Trading's `render-probe` already counts rendered
    rows; Hermes adds the *other* half — "which store pushed it, and was the push worth making". A
    churn counter is cheap to add and points straight at the fix. `UNIQUE`.

13. **An empty state that can mean "filtered", not "absent".**
    `plugins/hermes-bots/cron.tsx` `routineFilterHint` — "cronjobs are present but hidden" is
    explained, not shown as an empty list. *Why it transfers:* a trade log filtered to today can
    look like a day with no trades; the difference is one sentence. `UNIQUE`.

14. **A fail-closed owner resolution with a "stale selection" guard.**
    `store/session-owner-resolution.ts` + `plugins/hermes-bots/cron.tsx`
    `resolveRoutineOwner` — "if that row is absent, fail closed instead of routing cron
    reads/mutations through a stale selection or an unscoped profile name". *Why it transfers:* an
    automation that fires against the wrong profile/profile-workspace is a silent, expensive bug.
    `CONVERGENT`.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work.** Hermes' scheduled work is *server-side*; the desktop
  is a client. The durable surface is `api/cron.ts` (jobs per profile in
  `<HERMES_HOME>/cron/jobs.json`; a 24 h timeout on the one synchronous trigger endpoint; runs
  stamped with their owning connection) and `plugins/hermes-bots/cron.tsx` (the Routines pane).
  Reliability comes from: a **failed refresh keeps the last good list** with a stale notice; a
  **failed pause does not fail the list**; a **20 s poll** re-attempts only the jobs the gateway
  actually paused; **finished rows self-clear** (4 s success / 12 s failure) and dismissed ids stay
  dismissed across refreshes; a **rewind kills the background processes** the discarded turns
  spawned; and a **gone session stops being polled** so a dead runtime does not hammer the gateway
  for the window's lifetime. The one thing Hermes does **not** have — a breaker after repeated
  empty runs — is exactly where August Trading's own plan (the `streak that disables a schedule
  after three runs that produced nothing`) is ahead.
- **Human-in-the-loop approval.** Two layers, both worth copying. (a) *Server side*: the pairing
  approval grants on the row's `request_id`, never on the requester's one-time code — "the code is
  the requester's proof that the channel is theirs and is never returned by the API, while an
  authenticated admin is only ever identifying a row they can already see" (`api/messaging.ts:118-150`).
  (b) *Client side*: the approval card (`components/assistant-ui/tool/approval.tsx`) — "Always
  allow" is the only choice that writes to disk, so it alone goes through a confirm dialog; the
  card restores focus to whatever held it before the press; and the answer is re-checked against
  the store before it is sent. The audit trail is the *card's own state* (`opId`, `seq`,
  `settled`, `settledBy`, `deadlineAt`), owned by the backend, with the renderer keeping only a
  cache — the same "the state comes only from the backend; the card never sets it" rule as
  `store/connection-request.ts`.
- **Post-mortem / reflection loops.** This shard is the *client* of the reflection machinery, so
  the lifecycle itself is in the Python backend; what the renderer shows is the shape of it:
  `api/skills.ts` exposes the **star map** (`/api/learning/graph`) plus per-node read/edit/delete,
  and `store/starmap.ts` fetches it **on demand only** ("the graph scan touches the skills catalog
  + usage ledger + memory files, so we fetch it only when the panel opens (and on an explicit
  refresh), never on a turn boundary"). The gate against bad rules accumulating is *not* in this
  shard — but `api/system.ts` exposes the **curator** (`getCuratorStatus`, `setCuratorPaused`,
  `runCurator`), which is the compaction/curation hook for the memory store, and the skill toggle
  (`setSkillEnabled`) plus the hub's uninstall/update verbs are the only lifecycle verbs the
  desktop can reach. There is **no expiry, no retirement, no version number, and no "worth"
  gate on a learned rule anywhere in this shard** — the desktop never decides a rule is bad.
- **Multi-agent.** The `hermes-bots` plugin is the multi-agent surface and it is *routing*, not
  debate. There is no debate engine here: a bot is a profile, a "group chat" is a room whose
  members are bots, and a **round** is a round-robin driver (`group-rounds.ts`, 35 KB) whose
  routing rules are: a turn is answered only by `@`-mentioned members; `@everyone` (or no mention)
  means all; `(pass)`, `pass`, `pass.` and empty are **silence**, not text; a member's own reply
  never counts as a user address. Where a member goes silent the room records a **hold**
  (`group-hold-status.tsx`: "keeps unmatched holds visible instead of reporting all current
  members held"). The interesting, stealable bit is the **cross-connection relay**
  (`relay.ts`, 31 KB): the desktop is the *router* between bots on different gateways, and it
  keeps a **budget** that mirrors the backend's own
  (`relay-budget.ts`: `RELAY_TURN_LOCK_WAIT_MS = 120_000`, `RELAY_TURN_ATTEMPT_MS = 600_000`,
  `RELAY_TURN_MAX_ATTEMPTS = 2` — "first attempt + the policy-gated re-run"). The **delegation
  wrapper** (`routinePrompt` in `cron.tsx`) and the agent-to-agent **SOUL protocol**
  (`soul.ts`: `ensureMessagingProtocol` appends the messaging protocol section exactly once) are
  the two smallest reusable pieces.
- **Structured logs the model can query.** The renderer keeps *no* database. Its durable stores
  are (a) `localStorage` keyed by scope, behind one choke point (`lib/storage.ts`: "Every persisted
  read/write in the app funnels through readKey/writeKey, so a single subscriber (telemetry,
  cross-window sync, an audit log) can observe all of it"), and (b) the backend's own JSON/JSONL
  state. The queryable-log surfaces are: the **in-log search** (`lib/log-search.ts` — literal,
  case-insensitive, offset-based, with a fixed severity column) and the **action log**
  (`api/system.ts` `getActionStatus(name, lines)` — a tail of a named background action, read by
  every install/uninstall/update flow). The *trade-log* analogue in August Trading is a SQLite
  table; Hermes' lesson is the **tail reader** and the **severity column contract**, not the
  storage.
- **Staying simple as features accumulate.** Hermes' answer is a **seam**: the app ships a
  contribution *registry* (`contrib/registry.ts`, `contrib/react/slot.tsx`) with named areas
  (`panes`, `statusBar.left`, `settings.plugins`, `chat.empty`, `transcript.directives`,
  `sidebarNav.prefs`, `composer.microActions`), and every feature that is not core ships as a
  **plugin behind the SDK** (`sdk/index.ts`, 94 KB — "THE plugin language. The vscode-module model:
  plugin authors import exactly one module"). The plugin README then states the *policy*:
  "Keep this tree for real shipped plugins… One-off demos that rebuild a core chrome piece 1:1 do
  not belong here — they double the UI and confuse Capabilities ▸ Plugins." And the Bot Mode
  plugin (the largest feature in the app) is itself a plugin: 222 of this shard's files are
  `plugins/`. The `hermes-bots` plugin additionally refuses to own what core owns — "Hosted group
  copy stays plugin-owned; generic controls reuse the core catalog"
  (`canonical-group-labels.ts`).

---

## 4. Non-obvious decisions and gotchas

- **A "read→write origin" binding (config, and every owner-scoped row).** A GET binds the
  `(connection, profile)` that served it to the returned *object*; the matching write routes back
  there even after the registry primary changed (`api/config.ts:88-120`,
  `lib/session-owner-stamp.ts`). The subtle part: the captured origin is **spread, not rebuilt**,
  because re-running the helper would stamp `priority: 'foreground'` onto an ambient origin that
  never carried it.
- **Order-echo guards.** Two of them, and both exist because a *silently ignored query param* is
  worse than an error: a backend that ignores `order` serves the oldest page while still returning
  a `pagination` object (`api/sessions.ts:445-470`), and a backend that ignores `profile` acts on
  the launch profile (`store/approval-mode.ts:16-30`, `api/messaging.ts:56-64`). The rule is
  general: **if the response cannot prove it honoured the parameter, do not adopt it.**
- **`scope` on a key that has no scope is refused before the wire**, with a human message, not a
  bare `invalid_params` (`api/canonical-protocol.ts:196-208`).
- **"Preserve reference identity on no-ops"** is a repo-wide rule, not a micro-optimisation
  (`store/composer-status.ts`, `lib/stable-array.ts`, `debug/README.md`). `nanostores` bails out on
  *reference* equality only, so a deep-equal-but-new array re-renders every subscriber.
- **The `import.meta.env` alias trick beats tree-shaking for dev-only code.** `debug/dev-only.ts`
  is a static import in `main.tsx` *above* `react-dom` — "react-dom captures the devtools hook at
  module init, not at `createRoot`" — and production exclusion is a **build-time alias** to a
  no-op module, because a dynamic `import()` behind a `DEV` guard resolves a microtask too late.
- **The "response group" concept.** A turn's assistant text is split into a *response group* whose
  members share one action bar; Copy reads only the tail reply, "Copy full response" reads every
  segment (`components/assistant-ui/thread/response-group.tsx`,
  `response-copy-scope.test.tsx`). The group's end is "a real user prompt or unrelated system
  event".
- **A "no reply" error surface is raised only after the backend confirmed the turn is over**, so
  Retry cannot run the prompt twice (`store/session-no-reply.ts`).
- **`deriveDraftTitle` matches the backend's `MAX_DERIVED_TITLE_CHARS` exactly**, "so a draft
  doesn't visibly reflow the moment the backend's derived title replaces it"
  (`lib/draft-title.ts`).
- **A skipped file is a legitimate status only with a reason.** The ledger's 11 `skipped` rows
  each say what the file is, its size, and what was done instead.

---

## 5. Weak spots

- **The renderer is enormous and the same invariants are re-implemented per surface.**
  `store/session-states.ts` is 126 KB and `store/session.ts` is 80 KB; `components/ui/` alone is
  ~130 files, and the "one place that decides" discipline holds for *presentation* but not for the
  ownership/routing logic, which is spread across `session-owner-resolution.ts`,
  `session-request-router.ts`, `replay-gap-owner.ts`, `session-event-provenance.ts` and
  `connection-scoped.ts`. A reader must learn five modules to answer "which backend owns this
  session?"
- **The `api/` canonical protocol is a second, parallel contract next to the legacy one.** The
  adapter is careful and well-fenced, but the existence of two vocabularies (`session.activate`
  rewritten to `session.resume`, the legacy `lazy` flag dropped, 12 closed config keys) means every
  new verb needs both a legacy shape and a canonical one.
- **The shard is ~52 % tests by file count and ~31 % by bytes.** The test suite is unusually
  *good* (the tests are the specification, and they name the bug they exist for), but the ratio
  means the feature surface is smaller than the file count suggests, and a reader who skims the
  tree will over-estimate the product.
- **The i18n layer is a 3 MB translation surface with a 136 KB generated gap map** and ~180
  near-duplicate locale fragment files (`xx_boot.ts`, `xx_settings.ts`, `xx_chat.ts` …). It is
  maintained correctly — `catalog-completeness.test.ts` and `overlay-completeness.test.ts` fail on
  drift — but it is the largest part of the shard by bytes and the least interesting.
- **Two "pets" and a "radio" plugin** (floating pet, egg hatching, particle fields, a 41 KB
  `radio/plugin.js`) sit in the same tree as the canonical wire protocol. They are honest, tested
  code — the pet's `pet-info-poll.ts` even documents why a 3 s poll and a 15 s backstop exist
  alongside the event path — but they dilute the "this is a harness" reading of the shard.
- **The `hermes-bots` plugin is 222 files of one feature** (a multi-bot roster, groups, relay,
  screens, cron). It is well-factored (each file has a single stated purpose and its own
  contract test), but at that size it is a product inside the product, and the "one bot = one
  forever-chat" invariant took *five* hardening waves to hold — a sign that the identity model was
  chosen against a simpler design.



