# hermes-agent :: hermes-apps-desktop-src-rest

**Files in shard:** 1975 (read: see status TSV for the exact per-file ledger)
**What this shard covers:** the entire Electron/React desktop renderer of the Hermes agent
(`apps/desktop/src`): the canonical JSON-RPC wire adapter and REST client, the nanostore state
layer, the assistant-ui transcript surfaces, the Bot Mode plugin (multi-bot groups, relay, cron),
the plugin/SDK contribution runtime, the i18n bundles, the theme engine, and the pane/tree layout
engine. It is the *client half* of a harness: the agent loop, tool execution, memory and skill
lifecycle live in the Python backend; this shard is where those facts are **rendered, gated,
reconciled and recorded**.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `apps/desktop/src/AGENTS.md`
- **Purpose:** the engineering contract for `apps/desktop/src` — the rules a change must obey.
- **Key decisions it states:**
  - Desktop local execution belongs to **one multiplexing gateway owner per home**; the app never
    spawns `hermes serve --port 0` children and never acquires the gateway PID. Every lifecycle
    call carries `?profile=` and every tile records an owner route (`AGENTS.md:8-27`).
  - Native control tickets are **one-use, window-bound, and removed from the URL** before the
    WebSocket is constructed; they ride as a subprotocol, never as a query token
    (`AGENTS.md:20-25`).
  - Slash-command discovery and execution are **two different gates**: `isDesktopSlashCommand`
    (execution, true for any extension) vs `isDesktopSlashSuggestion` (discovery). The palette
    curation must never hide user-activated extensions (`AGENTS.md:44-52`).
  - **Bot Mode identity**: a bot is a profile; its chat is the session titled exactly
    `"Bot Chat"`, resolved by a UNIQUE(title) registry lookup **every time**. There is *no*
    session-id pin, and *recency must never win* — five hardening waves each had to fix a new way
    the stored pointer dangled (`AGENTS.md:56-78`).
- **Why it matters:** this is the closest thing in the repo to a constitution, and it is written as
  *invariants plus the bug that taught them*. Rare and very stealable.

---

### `apps/desktop/src/api/canonical-protocol.ts` (755 lines)
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

#### `apps/desktop/src/api/client.ts` (37 KB)
- **Purpose:** `HermesGateway extends JsonRpcGatewayClient` — the single WS transport — plus the
  **request-scope registry** that decides which `(connection, profile)` backend every REST call
  lands on.
- **Key abstractions:**
  - `HermesGateway` — overrides `connect`, `request`, `on`, `onAny`, `onRequest`, `close`.
  - Scope helpers: `profileScoped`, `capabilityScoped`, `connectionScoped`, `ownerScoped`,
    `resolveOwnerNow`, `hermesApiAs`, `sessionReadOwnerPin`, `profileScopeKey`.
  - `$apiRequestScope` — a nanostore `{ profile, connectionId }`, pushed into `api/` from the
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

#### `apps/desktop/src/api/sessions.ts` (29 KB)
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

#### `apps/desktop/src/api/config.ts` (11.8 KB)
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

#### `apps/desktop/src/api/cron.ts` (6 KB)
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

#### `apps/desktop/src/api/plugins.ts` (10 KB)
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

#### `apps/desktop/src/api/messaging.ts` (6.7 KB)
- **Purpose:** messaging platforms (Telegram et al.), **Telegram QR onboarding**, **pairing** and
  **webhooks**.
- **Non-obvious decision (human-in-the-loop, worth stealing):** an unknown DMer gets a one-time
  code and lands in `pending` until an admin approves. **Approval grants on the row's
  `request_id`, never on the code** — the code is the requester's proof that the channel is theirs
  and is never returned by the API, while an authenticated admin is only ever identifying a row
  they can already see (`messaging.ts:118-150`).
- **Edge case:** the Telegram pairing state lives in the memory of the backend process that started
  it, so every call in one flow must carry the **same** profile scope or the apply 404s
  (`messaging.ts:56-64`).

#### `apps/desktop/src/api/messaging.ts` / `models.ts` / `profiles.ts` / `local-models.ts` / `mcp.ts` / `skills.ts` / `toolsets.ts` / `system.ts`
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

### Tier 2 — bulk: a compact table

#### `apps/desktop/src/api/*.test.ts` (30 files) — what each one pins
| File | What it pins |
| --- | --- |
| `canonical-ambiguous-owner-reconcile.test.ts` | A failed owner reconciliation is re-probed by the next frame; a declined prompt is shown again while the authority still lists it. |
| `canonical-attach-snapshot.test.ts` | A cold attach delivers the snapshot prompt and marks the session attached. |
| `canonical-bot-relay-deliver.test.ts` | A Bot Relay delivery on a canonical dial carries only owner-admitted keys. |
| `canonical-clarify-lifecycle.test.ts` | Snapshots expose batch question params without losing already-locked answers. |
| `canonical-clarify-prompt.test.ts` | A reopened sibling chat delivers retained questions before returning; the clarify card's lock answers. |
| `canonical-create-options.test.ts` | The owner's session-create contract: allowed keys, `service_tier`, `cwd_explicit`. |
| `canonical-deadline.test.ts` | The prerequisite attachment shares the caller's deadline and cancellation; a zero timeout means *no* deadline. |
| `canonical-live-pick.test.ts` | A composer pick is a session-scoped mutate; a busy session answers `deferred`; a fence refusal is retried once, never looped; an older pick refused after a newer pick committed is not retried. |
| `canonical-model-confirm.test.tsx` | The guarded model switch asks; yes applies once with the owner's token; a lost reply retries as the *exact* token-bearing request; a typed refusal spends the token. |
| `canonical-producer-contract.test.ts` | The closed key set the canonical producer frame admits (config keys, owned connector verbs). |
| `canonical-profile-route.test.ts` | A sibling profile route survives canonical request translation. |
| `canonical-prompt-owner.test.ts` | Retained prompts keep their own profile when imported profiles share a stored session id; equal stored ids keep independent revisions/generations/retries; an unanswered prompt is replayed after a lost response. |
| `canonical-protocol-wire.test.ts` | Legacy (non-canonical) dials strip canonical-only identity keys; a compress settle resumes under the caller's deadline; shared-socket equal-id streams use replay owners. |
| `canonical-protocol.test.ts` | The whole canonical contract: CAS revision retention, canonical create retry identity, `voice_stopped` as a settled no-admission receipt, admission identity, `session.info` fanout refreshing the CAS revision, the unknown-admission row, the stored-parent branch, the composer model picker, compress preview staying read-only. |
| `canonical-reasoning-config-set.test.ts` | Typed `/reasoning` sets the session level through the owner mutation; `--global` is refused. |
| `canonical-reconnect-replay-owner.test.ts` | A canonical reconnect replays the retained window to the epoch owner. |
| `canonical-retained-control-retire.test.ts` | Another control retires a lost-reply control; a prompt submit retires the session's controls; the immediate retry keeps its identity. |
| `canonical-retained-mutation-stale.test.ts` | An acknowledged later edit retires an older retained mutation; a stale-generation refusal retires a retained reasoning mutation. |
| `canonical-rewind-lost-reply.test.ts` | A derived rewind whose reply was lost is re-sent, not re-derived; an answered derived rewind is not replayed; a replay-only probe re-presents only a retained derived rewind. |
| `canonical-rewind-redial-profile.test.ts` | A named-profile owner re-presents a lost rewind after a redial. |
| `canonical-session-updated-revision.test.ts` | A second viewer adopts the revision from `session.updated`, monotonically. |
| `canonical-unknown-admission-fence.test.ts` | A stale `session.info` replay leaves the live Discard action usable. |
| `canonical-watch-window-resume.test.ts` | The watch window's legacy `lazy` attach becomes a full transcript read. |
| `config-route-binding.test.ts` | A config record read from A cannot be written to B after the primary changes. |
| `local-models-owner.test.ts` | Delayed local-model reads and controls stay pinned to their captured connection and profile. |
| `plugins.test.ts` | `activeConnection` times out instead of hanging; the plugin socket dials the minted URL (never an empty `?token=`), stays on polling when no URL is minted, retries through an outage, stops after 5 permission refusals, and re-dials on a profile/connection change. |
| `session-http-mutation-identity.test.ts` | A retained identity on another session survives an acknowledged write. |
| `session-transcript-paging.test.ts` | The whole transcript is read instead of adopting the oldest page from a backend that ignores `order`; a passive read stays passive; legacy named-profile routing is preserved while the foreground is local. |
| `sessions-mutations.test.ts` | Concurrent equal sidebar edits share the missing-snapshot verdict; a missing route never selects an unfenced retry; sidebar edits fall back to the base write only when the backend lacks the fencing route. |
| `sessions.test.ts` | The DELETE/PATCH body carries the **owning** profile; the profile query is omitted when no owner is known; an explicit `local` pin stays routed to the local pool; a scoped session read does not dial foreground. |

---
