# deepseek-harness :: dsh-client-sidebar-workspace

**Files in shard:** 677 (read: TBD, skipped with reason: TBD — finalised in §6)
**What this shard covers:** the whole `packages/client/*` surface of the DeepSeek Harness monorepo: the browser↔Host wire layer (`connection`), a session-scoped file upload service, the locale/runtime-state plugin, the client module (plugin) manifest system, product analytics, the resources registry, five directory/file pickers, "open in app", the plugin renderer and its session provider, and the four sidebar shells — `ui-sidebar` (root), `ui-sidebar-right` (the tabbed right-hand rail), `ui-sidebar-browser`, `ui-sidebar-documentpreview`, `ui-sidebar-files`, `ui-sidebar-terminal` — plus the `ui-workspace` session/workspace browser. It is almost entirely **client-side chrome**: how the Harness presents an agent host to a human, how it survives reloads, and how it keeps many long-lived panels alive without a database.

> **Reading method note (honesty statement).** Tier-1 `source` files were read in full, batched through `Get-Content -Raw`. Tier-2 bulk (tests, configs, small READMEs) was read in batches too; for the ~430 test files the batch printed each file's `describe`/`it`/`test` titles (the assertions' names are what a test *pins*) and, where a title alone was ambiguous, the file head. The Chinese READMEs (`README.zh.md`) were read as their heading tree plus the matching English section — they are translation siblings and carry no extra decisions. `README.i18n.yaml` files are generated bilingual-pair hash records; they were read in full and carry no runtime behaviour. Binary `.xlsx` fixtures were **not** read line by line (Tier 3, listed in §1.4).

---

## 1. File-by-file

### 1.1 `packages/client/connection` — the browser↔Host wire layer (24 files)

This is the load-bearing package of the shard: it is the only thing that lets a browser talk to a Node host at all. Everything else in the client tree assumes it.

#### Tier 1 — load-bearing source

##### `packages/client/connection/src/api-request-trust.ts`
- **Purpose:** the browser-trust fence that every `/api` request must pass before dispatch (DNS-rebinding defence + cross-site defence). File header states it explicitly: *"this fence never establishes identity"* — it authorises the *host*, authentication is a separate step.
- **Key abstractions:** `assertTrustedAuthority(entry)` (`:53`), `isRemoteAuthority(entry)` (`:92`), `isTrustedApiRequest(request, trustedHosts, bindHost?, protocol)` (`:121`); private `parseAuthority` (`:34`), `canonicalAuthority` (`:70`), `isTrustedAuthority` (`:78`), `isBindAddressAuthority` (`:110`), `isSameAuthorityOrigin` (`:171`).
- **Data flow:** request headers → `Host` header parsed as a WHATWG authority → accepted if loopback (`isLoopbackHostname`), or the listener's own bind IP literal, or a `trustedHosts` entry → then `sec-fetch-site: cross-site` refused → then, if an `Origin` is present, it must name the same authority as `Host`.
- **Non-obvious design decisions:**
  - The **Host fence applies to *every* request**, including ones with no browser markers. The comment at `:135` explains why: over plain HTTP a browser attaches neither `Origin` nor `Sec-Fetch-*` to *reads* (images, navigations), so a markerless request may still be a rebound browser read, and `Host` is the one header rebinding cannot forge.
  - **Port judged from a URL parse under *both* special schemes**, never from the raw string (`:66`) — because WHATWG trimming would misread `"host:port "` as port-less, and because `:80`/`:443` must still count as explicit.
  - **Configured entries must be bare authorities and fail loudly** (`:53`). `harness.internal/path`, `user@harness.internal`, `0x7f.0.0.1`, percent-encoding, unbracketed IPv6, a zero-padded port, and stray whitespace are all *refused at config load* — the note at `:44` says the alternative is "quietly changing the grant". A whitespace-padded entry would otherwise broaden an exact-port grant to every port.
  - The bind address is matched **port-lessly** and ignores a `%zone` id (`:110`), and it stays *outside* `trustedHosts` so accepting it does not widen the deployment's declared remote surface.
- **Edge cases & failure handling:** absent `Host` → refuse; unparsable `Host` → refuse; `Origin: null` (sandboxed iframe, `file:` page) → refuse (the literal "null" is an opaque origin); non-HTTP(S) `Origin` scheme → refuse; `sec-fetch-site: cross-site` → refuse regardless of `Origin`.
- **Surprising:** `isRemoteAuthority` is used to compute `allowsRemoteAuthorities` on the Host handle — a deployment that only ever binds loopback reports `false`, which is how callers know they may *not* expose a remote surface.

##### `packages/client/connection/src/browser-auth.ts`
- **Purpose:** the process-launch-token → signed-cookie exchange for the browser, plus the persistent secret store.
- **Key abstractions:** `class BrowserAuth` (`:206`) with `static create(processOwner, credentials, maxAgeDays)` (`:220`), `authenticatedUrl(baseUrl)` (`:244`), `authorizeIndex(req, res, secure)` (`:263`), `authorizeConnect(req, res, secure, publish)` (`:314`), `isAuthenticated(request, secure)` (`:356`), `authenticateApi(request, secure)` (`:366`); private `authenticate` (`:371`), `writeUnauthorized` (`:385`).
- **Data flow:** a random 32-byte per-process launch token (held in a `WeakMap` keyed by the *root context object*, `:76`) → a URL like `?token=…` → `GET /` with exactly one token mints an **authority-bound signed cookie** (`v1.<payload>.<hmac>`) and answers `303 → ./` so the token drops out of the URL; `GET /connect?token=…&interactions=answer|none` instead mints a `v2` cookie carrying a freshly published operator `PeerId` and answers `302 → ./api/remote.mux`.
- **Non-obvious design decisions:**
  - The cookie **name is a hash of the authority** (`cookieName()` at `:127`) and the **signed payload also carries the authority**, so a cookie minted for `http://host:80` cannot authenticate to `https://host:443` — the audience includes the scheme for TLS (README "keeps HTTPS port 443 distinct from HTTP port 80 with one signing secret").
  - **The `Secure` attribute is decided by the listener that received the request**, never by a `publicUrl` announcement or a forwarded header — the doc comment at `:255` says those "describe a hop this process does not terminate".
  - **The signing secret lives in the credential provider** (`credentialKey('client-connection','browser-session')`), created once and reused; deleting the record and re-activating replaces it, and a *malformed* record **throws instead of being replaced** (`:352` "fails loud on an invalid owner record").
  - **`connect` publishes the operator BEFORE exposing the credential** (`publish(interactions)` is called at `:325` before the cookie is written) — the README calls this "synchronously create the operator before exposing its signed credential".
  - Two cookie payload *versions* coexist (`v1` browser session, `v2` API operator) in one format; `isAuthenticated` accepts only v1 and `authenticateApi` only v2, so a browser cookie can never be replayed as an API credential.
- **Edge cases & failure handling:** expired, future-issued, tampered, wrong-authority, or *longer-lived-than-configured* cookies are all refused (`:371` checks `payload.expiresAt - payload.issuedAt > this.maxAgeMilliseconds`); `cookieMaxAgeDays` that overflows the safe timestamp range throws at construction (`:220`); a HEAD request gets a bodyless 401; every unauthenticated request gets the *same* minimal 401 text.
- **Surprising:** `requestAudience` returns `url.origin` for HTTPS but `url.host` for HTTP (`:84`) — deliberately, so the same cookie name cannot span the two schemes.

##### `packages/client/connection/src/client/connection.ts`
- **Purpose:** the reconnection loop — "Connection generation readiness, cancellation, and continuous recovery".
- **Key abstractions:** `ConnectionController` (`:77`), `ConnectionHostInfo` (`:7`), `ConnectionGeneration` (`:13`), `ConnectionState = 'connected'|'disconnected'|'connecting'` (`:43`), `ConnectionSinks` (`:49`), `ConnectionGenerationSource` (`:67`).
- **Data flow:** a *generation source* is a long-lived function `(signal, ready) => Promise<void>` that must attach its incremental listeners **before** calling `ready`, and must settle after abort so a replacement can start. The controller races `ready` against a hard deadline; on success it publishes `connected`, resets the attempt counter, and calls `onConnected`.
- **Non-obvious design decisions:**
  - **Backoff is 50–100 % jitter of the cap** (`:144`), not full jitter: `cap/2 + random()*cap/2`. Caps are 500 ms → 1 s → 2 s → 4 s → 8 s → 10 s (README), continuing at the final cap.
  - **A `warn` timer and a hard `timeout` timer are separate** (`:899` `waitForReady`): 3 s to *warn* about a slow host, 15 s to *cancel*. Readiness, failure, cancellation, or the deadline all clear the warning.
  - **`isRunning()` and `isGenerationActive()` are read-through methods** (`:155`, `:160`) because "stop() flips the flag across awaits, so narrowing from the loop condition must not stick" — a classic JS narrowing bug this codebase deliberately avoids.
  - **Sink exceptions are isolated** (`callSink` at `:278`): a business-layer throw is logged and never affects pump/reconnect semantics.
  - **State emission is deduplicated** (`:271`) — "connecting" is not re-emitted for consecutive retries (there is a test for it).
  - **A late `ready` from a cancelled generation cannot publish** (`reportReady` checks `gen !== this.generation` at `:227`).
- **Edge cases & failure handling:** offline (`setNetworkAvailable(false)`) suspends automatic retries entirely and publishes `disconnected`; `online` resets the attempt counter and restarts at the base delay; a manual `reconnect()` while offline performs exactly one attempt without resuming automatic retries; `start()` is idempotent; the loop runs with *no sinks at all*.
- **Surprising:** `this.attempt = 0` happens **after** a successful handshake (`:864`) — so the backoff sequence resets on success, not on failure — *and* again for a manual attempt (`:876`).

##### `packages/client/connection/src/client/index.ts`
- **Purpose:** installs the browser-side `ctx.connection` Cordis service and wires the physical carrier.
- **Key abstractions:** `ClientTransportHooks` (`:84`) — the seam that lets a shell (Electron, worker preview) swap the transport without forking the plugin; `ConnectionInstallOptions` (`:128`); `ConnectionHandle` (`:143`); `ConnectionGenerationState` / `ConnectionStateSource` (`:60`, `:68`) — hand-rolled `useSyncExternalStore`-shaped observables; `installConnection(ctx, options)` (`:222`); `apply(ctx)` (`:337`).
- **Data flow:** `apply` reads three page globals — `__DSH_TRANSPORT__`, `__DSH_CONNECTION_RECOVERY__`, and `location` — and hands them to `installConnection`. The service publishes `generation` and `state` snapshots, an `rpc` caller, `openWebSocket`, `reconnect`, `registerGenerationSource` and `start`.
- **Non-obvious design decisions:**
  - **`interactions` defaults to `answer` for a page and `none` otherwise** (`:227`) — a browser tab participates in forwarded human interactions; a headless composition does not.
  - **`registerGenerationSource` is single-shot** (`:311`): a second registration throws. The disposer is *idempotent and identity-checked* so a stale disposer cannot withdraw a newer source.
  - **`start()` is owned by exactly one consumer** (`:322`): a second call throws "the stream loop is already owned by another consumer". A `token` object identifies the owner; after `stop()` a replacement owner is allowed and the old handle is ignored.
  - **`isLoopback` is three-way** (`:270`): the page authority is loopback, **or** the transport declares `ownsHost` (the Host runs inside a worker this page spawned, so "loopback" is vacuous), **or** the context is not a browser at all.
  - Listener exceptions in the generation/state broadcast are caught individually (`:238`, `:250`) so one bad subscriber cannot break the others.
  - The `connection/reset` event is declared in the Cordis `Events` interface (`:22`) with a rule: *"Wire-derived caches must repull; long-lived streams own their own resume and baseline lifecycle."*
- **Edge cases & failure handling:** malformed bootstrap recovery (e.g. `generationReadyTimeoutMs: 0`, `backoffFactor: NaN`) is rejected **before the service is published**; a non-browser `window` shim without `navigator.onLine` is ignored; `offline`/`online` browser events feed the owned retry loop.
- **Surprising:** the browser network watcher is installed **inside `start()`**, not at construction (`:329`), and is torn down by `releaseOwner`.

##### `packages/client/connection/src/client/rpc.ts`
- **Purpose:** the browser-side unary RPC caller — request correlation plus envelope validation.
- **Key abstractions:** `RpcFetch` (`:18`), `RpcStreamOpen` (`:21`), `createWebConnectionRpc(doFetch?, openStream?)` (`:34`).
- **Data flow:** `call(channel, endpoint, payload, signal)` → `assertTarget` → mint `rpcId` via `randomUuid()` → `POST {channel}/{endpoint}` with a `client-request` envelope → parse the `server-response` envelope → **reject on rpcId mismatch** → return `result`.
- **Non-obvious design decisions:**
  - **Channel and endpoint are validated by regex before anything is sent** (`:196` `assertTarget`): the channel must be `/[A-Za-z0-9._~-]+`, and no endpoint segment may be empty, `.`, `..`, or contain anything outside `[A-Za-z0-9_$.-]`. This is path-traversal defence at the client.
  - **The route is document-relative**: `route = `${channel}/${endpoint}`.slice(1)` (`:52`) — "a page posts the document-relative form, and a carrier that resolves against the Host root accepts the same form". The same string works for a page, a worker tunnel and an Electron shell.
  - **Binary responses are multipart** (`:79` `parseBinaryResponse`): the `metadata` part carries the JSON envelope with `null` placeholders plus an attachment table; each attachment names a *result-relative path* of string keys / numeric indices. The client re-walks the path, refuses a path that does not already exist, and refuses a placeholder that is not `null` — then replaces it with an `ArrayBuffer`-backed `Uint8Array`. **No business field name is reserved**, and "Connection does not discover binary fields" — the *handler that owns the result protocol* does the projection.
  - Every failure mode is a `TypeError` with a distinct message; the multipart parser refuses duplicate field names, a missing `metadata` field, a non-`bytes` codec, an unknown part, and leftover fields.
- **Edge cases & failure handling:** a non-2xx HTTP status → `transport failure for …: HTTP <n>`; a non-JSON body → `invalid server-response envelope`; `signal?.throwIfAborted()` after the response but before the id check, so an aborted call does not resolve.
- **Surprising:** `open()` is only added to the returned object when a stream carrier was supplied, and it then **refuses any channel other than `/api`** (`:66`) — "worker-local streams require the /api channel".

##### `packages/client/connection/src/http-bridge.ts`
- **Purpose:** the `node:http` ↔ WHATWG-fetch bridge that adapts the host server to the transport-agnostic Fetch handler.
- **Key abstractions:** `bridge(req, res, apiHandler, peer, maxRequestBodyBytes?)` (`:37`), `DEFAULT_MAX_REQUEST_BODY_BYTES = 300 MiB` (`:15`).
- **Data flow:** the handler first asks `apiHandler.requestBodyMode({method,url})` **before any byte is read** (`:69`), so a route can declare `buffered` (aggregate JSON cap) or `streaming` (backpressured, no aggregate cap). Buffered bodies are accumulated with a running byte counter; streaming bodies are piped via `Readable.toWeb(req)` with `duplex: 'half'`.
- **Non-obvious design decisions:**
  - **Client-disconnect detection hangs off the RESPONSE, not the request** (`:46`). The comment explains: since Node 16 `IncomingMessage`'s `close` fires as soon as the request body is consumed — immediately for a bodyless GET — which would abort a streaming response right after it opened. `ServerResponse` `close` fires on teardown, and `writableEnded` distinguishes a normal `end()` from the client going away.
  - **Backpressure is honoured** (`:110`): a `false` return from `res.write` waits for `drain`; `close` also resolves so a mid-wait disconnect cannot park the loop forever.
  - **Post-disconnect chunks are drained, not written** (`:104`): "cancelling Node multipart bodies can race their producer and reject with ERR_INVALID_STATE".
  - The 300 MiB default is **derived from a different subsystem's limit** — 200 MiB aggregate image limit after base64 expansion (×4/3) plus 1 MiB envelope headroom (see `src/index.ts:74` `assertImageBodyCapacity`).
- **Edge cases & failure handling:** an over-cap declared `content-length` → `413` + `req.destroy()`; an over-cap streamed body → same, mid-stream; an unread streaming request after an early response → `req.destroy()`.

##### `packages/client/connection/src/index.ts` (Host half)
- **Purpose:** the Cordis plugin that provides the Host-side connection service and, when a `webServer` is present, mounts the `/api` and `/connect` routes.
- **Key abstractions:** `ConnectionConfig` (`:96`), `Config` schemastery schema (`:112`), `apply(ctx, config?)` (`:126`), the `connection/request` waterfall event (`:65`).
- **Data flow:** `inject = ['credentials']` → on activation: resolve recovery config, **validate every `trustedHosts` entry at load time** (`:132`), assert image-body capacity, create `HostConnectionService` (which creates the `BrowserAuth` with its durable secret) → when `webServer` appears: inject the recovery config into the served page as `__DSH_CONNECTION_RECOVERY__`, register the `/api` prefix route and the `/connect` exact route.
- **Non-obvious design decisions:**
  - **The `/api` handler is a waterfall** (`:150`): `webCtx.waterfall('connection/request', req, res, () => bridge(...))`. A listener may refuse new requests or `await next()` through response completion. The README names the use: "Desktop uses this hook to lock new API work during an approved installation without canceling already-admitted work." Removing the listener's owning fiber removes the behaviour.
  - **The trust check happens before the bridge** (`:146`): `connection.admit(req)` → 401 vs 403, then only a trusted, authenticated request reaches the body transfer.
  - **The image-capacity assertion is repeated in three places** (`:135`, `:141`, `:157`) because the `attachments` service may attach after `webServer`; each context re-checks the configured cap against the *configured* image limit.
- **Edge cases & failure handling:** a malformed `trustedHosts` entry fails the plugin load loudly; `cookieMaxAgeDays` must be a natural ≥ 1 (schema default 30); `maxRequestBodyBytes` natural ≥ 1 (default 300 MiB).

##### `packages/client/connection/src/rpc-host.ts`
- **Purpose:** the Host registry for logical RPC channels and exact Fetch routes, plus the HTTP adapter.
- **Key abstractions:** `HostConnectionService extends Service` (`:70`), with `requestRejection` (`:123`), `admit` (`:129`), `createPeer` (`:140`), `admitConnection` (`:145`), `authorizeConnect` (`:180`), `authorizeIndex` (`:193`), `createSharedFetchHandler` (`:207`), private `registerFetchRoute` (`:234`), `register` (`:253`), `registerInterceptor` (`:279`).
- **Data flow:** `admit` → `isTrusted` (the fence) → disposed? → 401 : browser cookie → the shared `browserPeer` : API cookie → the peer record → 401. Then `createSharedFetchHandler('/api').fetch(request, peer)` picks an **exact route** by pathname+method, else falls back to the `/api` interceptor's endpoint match, else 404.
- **Non-obvious design decisions:**
  - **Exact routes are owner-only** (`:216`): "Exact routes bypass Gateway access checks, so only the owner reaches them" — a non-owner principal gets 403 even though the shared interceptor would accept the request.
  - **`/api` is reserved** (`:300` `assertChannel`): a plugin cannot register a *new* `/api` channel; it must use `intercept('/api', matcher, handler)`. Duplicate channel or duplicate interceptor registrations throw.
  - **The envelope's `method` must equal the endpoint derived from the path** (`:330`): a mismatch is a `gateway/bad-request` failure, not a dispatch. Media type must be `application/json` (415), body must parse (400), and an invalid envelope returns the *caller's own* `rpcId` when it is a string, else the sentinel `'invalid-request'` (`:341`).
  - **Attachments are framed as multipart** (`:357` `fullResponse`): the JSON body keeps `null` placeholders and a `metadata` part lists `{path, codec:'bytes', part}`. Bytes are copied into a fresh `Uint8Array` because "FileSystem bytes may have SharedArrayBuffer backing, which BlobPart excludes".
  - **Socket ownership is exclusive**: `admitConnection` returns 409 for a duplicate attachment, and `release()` is idempotent (one shared promise) and removes the peer from the map *synchronously* so a later HTTP request with that cookie is refused.
- **Edge cases & failure handling:** a handler that throws → `500` with `handler failure: …`; a disposed service → 401 for everything; a registered route whose path fails `endpointFromPath` → throws at registration; a route with zero or repeated methods → throws.
- **Surprising:** `admit` returns the **shared `browserPeer`** for every authenticated browser, but API cookies map to *per-operator* peers — "keeps all browser cookies on the shared operator and creates independent API operators" (a test title).

##### `packages/client/connection/src/rpc.ts`
- **Purpose:** the transport-neutral contract shared by both halves.
- **Key abstractions:** `RpcId` branded string (`:7`, `:14`), `ConnectionRpcFailure` (`:19`), `ConnectionRpcResult<T>` (`:26`), `ConnectionRpcAttachment` (`:31`), `ConnectionRpcHandlerResult` (`:39`), `transportError(error)` (`:56`), `ConnectionTrustRequest` (`:98`), `PeerAdmission` (`:119`), `ConnectionAdmission` (`:124`), `ConnectionRpcHandler` (`:136`), `ConnectionFetchRoute` (`:153`), `HostConnectionRpc` (`:179`), `HostConnectionHandle` (`:206`), `ConnectionFetchHandler` (`:277`), `ClientConnectionRpc` (`:295`).
- **Data flow:** types only — but the *vocabulary* is the API. `ConnectionRequestBodyMode = 'buffered'|'streaming'` (`:150`) is declared once here and honoured by the bridge, the route registry and the file-upload service.
- **Non-obvious design decisions:**
  - **`transportError` maps any rejection to code `'gateway/internal'`** (`:56`) — a single carrier-neutral failure code for transport-level problems, with the original message preserved.
  - **`ConnectionRpcResult` is a discriminated union of `{ok:true,value}` / `{ok:false,error}`** rather than a thrown error, so a *business* failure travels as data and only a *transport* failure throws.
  - `ConnectionRpcAttachment.path` is `readonly (string|number)[]` — "no business field name is reserved" (README).
- **Edge cases & failure handling:** `transportError` stringifies a non-`Error` rejection rather than assuming `.message` exists.
- **Surprising:** the file exports **both** `RpcResult<T>` (":49 Historical short name") and `ConnectionRpcResult<T>` — a deliberate compatibility alias.

##### `packages/client/connection/src/peer.ts`
- **Purpose:** the `Peer` — "one party admitted to this Host".
- **Key abstractions:** `class Peer implements PeerScope` (`:26`), `PeerOptions` (`:14`).
- **Data flow:** the constructor creates a Cordis **scope** whose key is the Peer instance itself (`:44`), so `scopeOf(peer.ctx)` returns the Peer and events dispatched with `scopeTarget(subject, peer)` reach *only* that peer's listeners. A lifetime `AbortController` aborts `peer.signal` when the scope ends, "however the scope ends: dispose() or the owner Context unloading" (`:47`).
- **Non-obvious design decisions:** **the Peer is its own scope key** — that is what makes per-peer event isolation possible without a separate registry. `interactions` defaults to `'answer'`.
- **Edge cases & failure handling:** `dispose()` returns the scope's disposal promise so racing calls share one completion; the abort reason is `Peer <id> was disposed`.

##### `packages/client/connection/src/recovery-config.ts`
- **Purpose:** one schema for Host-configured and browser-local retry timing.
- **Key abstractions:** `ConnectionRecoveryConfig` (`:5`), `ConnectionRecoveryConfigSchema` (`:25`), `resolveConnectionConfig(config)` (`:38`).
- **Data flow:** `unknown` → schemastery parse → `Required<ConnectionRecoveryConfig>` with every default filled (500 / 2 / 10 000 / 3 000 / 15 000).
- **Non-obvious design decisions:** **all delays are capped at `2_147_483_647`** — "Browsers and Node share this maximum signed 32-bit timer delay" (`:22`). `backoffFactor` must be `>= 1` and is re-checked for finiteness after parsing (`:42`) because `Infinity` would make the cap computation degenerate.
- **Edge cases & failure handling:** a non-finite factor throws `RangeError`; a zero or negative delay is rejected by the schema.

##### `packages/client/connection/src/rpc-schema.ts`
- **Purpose:** zod runtime validation for the two RPC envelope directions.
- **Key abstractions:** `rpcIdSchema`, `rpcErrorSchema`, `rpcResultSchema(value)`, `clientRequestSchema`, `serverResponseSchema`, `rpcMessageSchema` (discriminated union on `type`).
- **Non-obvious design decisions:** **payload validation is deliberately NOT here** — "endpoint payload validation belongs to its owner" (`:36`). The envelope is generic; only the envelope is validated centrally.
- **Edge cases & failure handling:** a valueless success is allowed (`z.unknown().optional()` at `:51`).

##### `packages/client/connection/src/client/api.ts`
- **Purpose:** browser-safe re-exports of the protocol types plus `resultOf(response)` (`:17`).

##### `packages/client/connection/src/client/random-uuid.ts`
- **Purpose:** RFC-4122 v4 UUID without a secure context. `crypto.getRandomValues` is available on insecure origins; `crypto.randomUUID` is not. The version/variant bits are set manually (`:16`).
- **Why it exists:** the browser RPC client mints its own correlation ids, and the page may be served over plain HTTP on a LAN.

##### `packages/client/connection/src/client/socket.ts`
- **Purpose:** physical socket selection for browser / desktop / Node.
- **Key abstractions:** `ConnectionWebSocket` (a minimal structural subset of the WebSocket API, `:14`), `ConnectionWebSocketFactory` (`:40`), `openConnectionWebSocket(path, factory?, baseUrl?)` (`:48`).
- **Non-obvious design decisions:** the base is `baseUrl ?? document.baseURI`, and **outside a document the base is required** — `throw new Error('connection: WebSocket carrier requires streamBaseUrl outside a document')` (`:53`). The scheme is mapped `https:→wss:`, `http:→ws:`.
- **Edge cases & failure handling:** the factory is called with a fully-resolved absolute URL so a carrier never has to guess the Host mount.

##### `packages/client/connection/src/connect-protocol.ts`
- **Purpose:** the two shared constants of the connect handshake: `ConnectionInteractions = 'answer'|'none'` (`:5`) and `CONNECT_PATH = '/connect'` (`:9`).

##### `packages/client/connection/src/loopback-hostname.ts`
- **Purpose:** a zero-dependency loopback predicate shared by the Host fence and the client state. `localhost`, `[::1]`, and the whole IPv4 `127/8` block; the four dotted-decimal parts are each validated as `1..255` (`:20`).
- **Non-obvious decision:** the predicate is **package-internal** — "client plugins consume the derived state through Cordis" — so no consumer can accidentally re-implement it.

##### `packages/client/connection/src/api-path.ts`
- **Purpose:** the single source of the `/api` prefix shared by both halves of the web transport (`:8`).

#### Tier 2 — bulk (docs, config, tests)

| File | What it is / what it pins |
| --- | --- |
| `packages/client/connection/README.md` | The package contract. Decides: the `?token=` → cookie → clean `./` exchange; authority-bound cookies; the Host/Origin fence rules; the Peer model; the `/connect` operator exchange; the `connection/request` waterfall; the generation protocol (a `{type:'ready', clientId, host:{home}}` frame must precede events); the retry ladder (500 ms → 10 s, 50–100 % jitter); and four named limitations (buffered bodies resident in memory, plaintext cookie on HTTP, unused API peers never collected, **no logout operation**). |
| `packages/client/connection/README.zh.md` | Chinese sibling of the above; heading tree read, no additional decisions. |
| `packages/client/connection/README.i18n.yaml` | Generated bilingual-pair hash record: one hash per heading section for `en` and `zh`. Read in full — pure generated metadata, no behaviour. |
| `packages/client/connection/locale/en.json` | One key: `meta.title = "connection"`. |
| `packages/client/connection/locale/zh.json` | `meta.title = "客户端连接"` plus a `meta.description`. |
| `packages/client/connection/package.json` | Dual client/host package: `./client` export resolves to `lib/client.node.js` under Node and `lib/client.browser.js` in a browser; `dsh.client.platform: "web"`, `immediately: true`; deps `dsh-credentials`, `schemastery`, `zod@4.4.3`. |
| `packages/client/connection/tsconfig.json` | Solution file referencing the host and client projects (separate type-checking universes). |
| `packages/client/connection/tsconfig.host.json` | Explicit `files:` list of the 14 host-side modules — the client-only modules are *excluded* from the host program, so a browser import in host code is a compile error. |
| `packages/client/connection/tsconfig.client.json` | The 11 client-side modules; the host-only trust/auth/bridge modules are excluded. |
| `packages/client/connection/tsdown.config.ts` | `clientBundle(..., { dualClient: true })` — the shared build helper that emits both the Node and browser client bundles. |
| `packages/client/connection/tests/api-helpers.client.spec.ts` | Pins `transportError` folding an `Error` to `internal` and stringifying non-Errors, and `resultOf` unwrapping the result slot. |
| `packages/client/connection/tests/api-request-trust.host.spec.ts` | Pins the whole fence: markerless requests are still Host-bound; every loopback spelling; the bind address port-lessly; a rebound Host is refused; Origin/Host compared under the Origin scheme; `trustedHosts` exact-port vs port-less; WHATWG normalisation; `cross-site` refused; `assertTrustedAuthority` rejects anything more than a bare authority; stray whitespace must not broaden a port grant. |
| `packages/client/connection/tests/binary-rpc.host.spec.ts` | Pins the multipart binary framing end to end: gzip and identity, raw bytes + metadata alongside JSON results, attachments already projected by the owner, rejection of a response belonging to another request, nested/optional/root attachment paths, truncated multipart, and late bytes after cancellation. |
| `packages/client/connection/tests/browser-auth.host.spec.ts` | Pins the token/cookie protocol: one process token, authority-bound persistent cookie, HTTPS 443 vs HTTP 80 distinctness, HTTP-cookie replay refused after enabling TLS, the caller's authority/mount preserved, one uniform 401, tampering/expiry/future-issuance/over-long-lifetime refused, one secret per activation, secret replaced after deletion, and a loud failure on an invalid owner record. |
| `packages/client/connection/tests/browser-credentials.ts` | Test double: `RecordCredentials` with a mutable record, `discardWrites`, and read/modify counters. |
| `packages/client/connection/tests/client-apply.client.spec.ts` | Pins the browser install: Host bootstrap timing, malformed bootstrap rejection *before* the service is published, a NaN start override rejected *without acquiring the generation source*, a runtime without `location` treated as local, loopback detection, one generation source only, one loop owner, subscriber isolation, browser offline/online feeding the retry loop, generation retraction while reconnecting, RPC without secure-context `randomUUID`, a pre-decoded `rpc` carrier replacing the HTTP caller, `connection.rpc.open`, and RPC transport/correlation/target validation. |
| `packages/client/connection/tests/connection.client.spec.ts` | The big lifecycle suite: connected announcement with Host facts, reconnect with a fresh generation, jittered cap retry, fixed cap when the factor is 1, interrupting the retry delay, offline pause and restart at the base delay, one manual attempt while offline, no delay for a synchronous reconnect request, a sink that disposes the controller at three different points, active-generation replacement, sink-exception isolation, `onConnected` held until the source is ready, only the first readiness report accepted, a source that ends during readiness, the slow-host warning, the hard deadline at 20/100/200 ms with late-ready ignored, the deadline cleared by stop/reconnect/failure, the `disconnected → retry → connected` transition sequence, one `connecting` across consecutive retries, running with no sinks, and idempotent `start()`. |
| `packages/client/connection/tests/fake-generation.client.ts` | Test-local programmable generation source: `suppressReady`, `holdReady`/`releaseReady`, `end()`, `fail(error)`, `activeCount`. |
| `packages/client/connection/tests/fetch-routes.host.spec.ts` | Pins exact-route dispatch and 404 for unclaimed requests, rejection of invalid/duplicate registrations, 403 for non-owner peers on exact routes while the interceptor still receives them, and in-process Peers that keep their principal and die with the reading Context. |
| `packages/client/connection/tests/generation.client.spec.ts` | Pins that the ready frame's Host facts are published and retracted when the loop stops. |
| `packages/client/connection/tests/http-bridge.host.spec.ts` | Pins the bridge: an over-cap request is destroyed rather than drained; a pending native picker request aborts on browser disconnect; a multipart response finishes without further writes when the client closes during write or backpressure; bytes returned after disconnect are discarded; a declared 2.19 GiB streaming request bypasses the JSON cap; an unread streaming request is closed after an early validation response. |
| `packages/client/connection/tests/loopback-hostname.client.spec.ts` | Pins the loopback predicate: `localhost`, `[::1]`, the whole 127/8 block, and refusal of malformed names. |
| `packages/client/connection/tests/node-half.host.spec.ts` | The Host-half suite: the `connection/request` waterfall ordering and its removal with the owning fiber, awaiting delegated response transfer before releasing the listener, the carrier-neutral service without a web server, the bind address of a late-attached web carrier, the TLS default port for markerless grants, `Secure` from the mounted listener protocol, injected recovery timing and its withdrawal, `allowsRemoteAuthorities` from validated `trustedHosts` only, the 200 MiB image-batch capacity assertion in both directions, a loud failure on a malformed `trustedHosts` entry, route registration and removal, the Host fence on every `/api` path, one browser session for every method on every trusted authority, a disposable dedicated RPC channel, claimed `/api` endpoints and their withdrawal, the shared owner browser Peer, the shared-channel envelope checks, and the operator-scoped `/connect` behaviour (default `none`, independent operators, 400 on bad declarations, refusal after fiber disposal, HTTP-before-socket, unused operators retained but expired cookies rejected, restart recovery that does not resurrect API operators). |
| `packages/client/connection/tests/recovery-config.client.spec.ts` | Pins the separation of the slow-host warning from the hard deadline, the schema bounds, and that a finite fractional growth factor survives. |
| `packages/client/connection/tests/rpc-schema.host.spec.ts` | Pins branding, `transportError` folding, both result branches, both envelope directions and a valueless success. |
| `packages/client/connection/tests/socket.client.spec.ts` | Pins that a base URL is required outside a document, the scheme mapping, and the browser WebSocket + document base fallback. |

### 1.2 `packages/client/file-upload` — session-scoped browser uploads (19 files)

#### Tier 1 — load-bearing source

##### `packages/client/file-upload/src/index.ts` (Host half)
- **Purpose:** streamed upload intake plus a **staged-receipt lifecycle** bound to an exact Session.
- **Key abstractions:** `class FileUploads extends TypertRemoteService` (`:56`), `AgentResolver` (`:31`), `PromptFileBinding` (`:34`), `PromptFileBindingGuard` (`:40`).
- **Data flow:** two paths. (a) The generated Remote `@Remote('upload')` (`:105`) takes base64 bytes → `ctx.attachments.admitEncodedFile`. (b) The raw streaming route `POST /api/session/uploadFileBinary?sessionId=…&name=…` → `ctx.attachments.saveFileStream` with an `AsyncIterable` of chunks — **the bytes are never aggregated**. Both end in `commit()` (`:194`), which stages a `receiptId → FileAttachmentRef` pair in a `WeakMap` keyed by the **exact Session object**.
- **Non-obvious design decisions:**
  - **The receipt table is keyed by the Session *object*, not its id** (`:58` `WeakMap<Session, Map<…>>`) — receipts die with the Session, for free.
  - **Receipt binding is a transaction** (`:150` `bindPrompt`): binding records the previous `requestId` of each receipt and returns a disposable guard whose `dispose()` **restores the previous binding** unless `commit()` was called. The doc: "disposal restores every prior binding unless the caller commits successful delivery".
  - **Retirement is driven by an observed session event** (`:232`): when a `user/message` event with a `source.rpcId` is observed, the receipts bound to that request id are retired. Delivery commits; observation retires.
  - **The Agent is re-checked after the save** (`:208`): `ctx.agents.get(agent.id) !== agent` → `session/not-found` "was disposed before its file upload completed" — a classic use-after-dispose guard.
  - **Subagents may not accept uploads** (`:222`): `origin === 'subagent'` → `subagent/attachment-invalid`.
  - **Attachment errors are recognised and re-coded** (`:196`): `ctx.attachments.isAttachmentError(error)` → `session/attachment-invalid` with the reason; anything else → `gateway/internal` with the cause.
  - **Cold sessions can be resumed** (`:89` `registerAgentResolver`): a registered resolver may bring back an ordinary Agent for a session id that is not currently attached; without one, `session/not-found`.
- **Edge cases & failure handling:** `registerAgentResolver` throws if one is already registered (the disposer is identity-checked); `bindPrompt` throws `FILE_NOT_STAGED` for an unknown or foreign receipt; `session/disposed` deletes the session's staged table; a disposed Session object makes `resolve()` return `undefined`.

##### `packages/client/file-upload/src/client/runtime.ts` (browser half)
- **Purpose:** upload a `Blob`, a `ReadableStream`, or exact bytes without blocking the page thread.
- **Key abstractions:** `fileUploadWorker(scope, createXhr, doFetch)` (`:79`) — a **self-contained Worker body emitted from a function string**; `class FileUploadRuntime extends Service` (`:163`); `FileUploadTransport` (`:158`).
- **Data flow:** `upload(sessionId, data, name?, signal?, onProgress?)` (`:186`) — a `Uint8Array` goes through the generated Remote as base64; a `Blob` or `ReadableStream` goes through `post()` to either the page-owned carrier (`__DSH_FILE_UPLOAD__.fetch`, read **once** before Cordis boots) or a **dedicated short-lived Worker** created from `new Blob([`(${fileUploadWorker.toString()})()`])`.
- **Non-obvious design decisions:**
  - **XMLHttpRequest inside the Worker for `Blob` bodies** (`:95`) — *only* because it is the one browser API that reports **upload progress including the total**; `fetch` cannot. A `ReadableStream` uses `fetch` with `duplex: 'half'` and reports consumed bytes **without a total**, because the stream API carries no length.
  - **The stream body is *transferred* across the Worker boundary** (`postMessage(message, [request.body])`) — "A stream body is consumed once and transfers ownership when it crosses a Worker boundary" (README). The Worker re-wraps it in a `ReadableStream` that forwards chunks and posts progress.
  - **The Worker is terminated on every exit path** (`finish()` at `:250` and `abort()` at `:243`), and the abort listener is removed. The Worker is created per request and revoked immediately (`URL.revokeObjectURL` right after `new Worker`).
  - **The Worker's request URL must be absolute** (`:266`): "the Worker's own base is `blob:`, so its request URL must be absolute" — resolved against `document.baseURI`.
  - **The result envelope is validated by hand** (`:284` `parseFileUploadResult`): `ok` must be a boolean, a failure must carry `{code,message,details}`, and a success must carry a `receiptId` and a `file` with `attachmentId`, `name` and a non-negative safe-integer `bytes`.
- **Edge cases & failure handling:** no `Worker` support → `Promise.reject(new Error('background upload requires Web Worker support'))`; a non-`Uint8Array` chunk from the source stream → `TypeError`; an already-aborted signal → the upload aborts before the message is posted; a transport failure → `file upload transport failed with HTTP <n>`.

##### `packages/client/file-upload/src/http-route.ts`
- **Purpose:** the authenticated raw-byte HTTP route handler.
- **Key abstractions:** `handleFileUploadHttp(service, request)` (`:22`).
- **Data flow:** method must be `POST` (else 405 with `allow: POST`); content type must be `application/octet-stream` (else 415); `sessionId` is **required and non-empty** (else 400); the body is consumed lazily by `requestBodyChunks` (`:73`) — an `AsyncIterable` of `Uint8Array` — and the result is JSON with **HTTP 200 even for a business failure** (the `ok` flag lives in the body).
- **Non-obvious design decisions:** the route is registered with `requestBody: 'streaming'` (`src/index.ts:73`), so the bridge never buffers it — "the bytes are never aggregated". A failure is reported as `remoteErrorOf(error)` when the error is a Remote error, otherwise `gateway/internal`.
- **Edge cases & failure handling:** the reader lock is released in a `finally` (`:78`); a null body yields nothing.

##### `packages/client/file-upload/src/client/contract.ts`
- **Purpose:** the browser-facing contract. `FileUploadService.upload(sessionId, data, name?, signal?, onProgress?)` returning `RemoteResult<FileUploadValue>` (`:8`), `FileUploadProgress {loaded, total?}` (`:12`), `FileUploadBody = Blob | ReadableStream<Uint8Array>` (`:6`).

##### `packages/client/file-upload/src/types.ts`
- **Purpose:** `EncodedFileUploadRequest` (base64 + optional name, `:6`), `FileUploadValue {receiptId, file}` (`:15`), `FileUploadReceiptId` branded (`:22`), `FileUploadFetch` (`:27`), `ClientFileUploadHooks` (`:34`).

##### `packages/client/file-upload/src/protocol.ts`
- **Purpose:** `FILE_UPLOAD_PATH = '/api/session/uploadFileBinary'` (`:4`) and its **browser-relative** form `FILE_UPLOAD_ROUTE = FILE_UPLOAD_PATH.slice(1)` (`:10`).

##### `packages/client/file-upload/src/client/index.ts`
- **Purpose:** the browser plugin that provides `ctx.fileUpload`. `inject = ['remote']` — the upload service uses the generated Remote fallback.

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/file-upload/README.md` | The package contract. Decides: Blob → XHR-in-Worker for *total-aware* progress; stream → transferred to the Worker and fed to fetch with consumed-byte progress only; exact bytes → the generated Remote; a receipt belongs to one exact Session; the staged-receipt transaction (dispose restores, commit keeps); and four limitations — **uploads are not resumable**, stream bodies are one-shot, stream progress has no total, and the Worker source is emitted from a function string (so runtime imports would need a standalone bundled entry). |
| `packages/client/file-upload/README.zh.md` | Chinese sibling; heading tree read. |
| `packages/client/file-upload/README.i18n.yaml` | Generated bilingual-pair hash record; read in full, no behaviour. |
| `packages/client/file-upload/locale/en.json` | `meta.title = "file-upload"`. |
| `packages/client/file-upload/locale/zh.json` | `meta.title = "文件上传"` + description. |
| `packages/client/file-upload/package.json` | Exports `.`, `./client`, `./types`, `./typert` (host) and `./remote` (client) — **the host and the browser each get their own generated-Remote bundle**; `dsh.client.inject: ["@deepseek-ai/dsh-api-remotes"]`, `platform: "web"`. |
| `packages/client/file-upload/tsconfig.json` | Two-project solution (host + client). |
| `packages/client/file-upload/tsconfig.client.json` | Client project: browser-safe modules only. |
| `packages/client/file-upload/tsconfig.host.json` | Host project: the Node-side modules. |
| `packages/client/file-upload/tsdown.config.ts` | The shared client build helper. |
| `packages/client/file-upload/tests/file-upload-http.host.spec.ts` | Pins the raw route: method/content-type/sessionId validation, streamed intake, and the JSON-with-200 failure envelope. |
| `packages/client/file-upload/tests/file-upload.client.spec.ts` | Pins the browser side: Blob vs stream vs exact bytes, progress reporting (with and without a total), cancellation, Worker lifecycle, and receipt validation. |

### 1.3 `packages/client/locale` — the i18n registry (30 files)

#### Tier 1 — load-bearing source

##### `packages/client/locale/src/client/index.ts` (26 KB — the package's centre)
- **Purpose:** one `LocaleRuntime` that owns both the **dictionary registry** and the **locale preference**, and that is itself the slot system's `LocaleFace`.
- **Key abstractions:** `class LocaleRuntime` (`:165`), `LocaleSnapshot {active, locales, revision}` (`:74`), `LocaleDefinition` (`:64`), `LanguageRegistration` (`:54`), `FALLBACK_LOCALE = 'en'` (`:109`), `COMMON_NS`/`SETTINGS_NS` (`:112`,`:115`), the `locale/change` Cordis event (`:96`).
- **Data flow:** a *provisional* locale is derived from `navigator.languages` (or the native bridge's ordered OS languages); the Host settings scope may later deliver a *durable* preference, which replaces it live. `setLocale(id)` (`:255`) is the only write entry; `register(ns, dicts)` (`:389`) adds dictionaries; `bind(ns)` (`:448`) returns a **stable-identity** translate function; `resolveText(text)` (`:214`) resolves package-manifest text.
- **Non-obvious design decisions:**
  - **`setLocale` persists even when the id already matches** (`:250`): "the active value may be a provisional browser-derived or fallback resolution that nothing has stored yet. Picking the language already on screen is still an explicit choice, and it must survive a different browser sharing the same DSH home." Only the *render notification* is conditional.
  - **Dictionary registration does NOT emit `locale/change`** (`:118`): "listeners may re-register slots in response, and boot registers one namespace per package" — a registration-heavy boot would storm the event bus. The render refresh rides the **snapshot revision** instead.
  - **One throwing subscriber must not strand the others** (`:506`): each listener is called in a `try/catch` and the error is logged — "outlets would keep the previous language".
  - **Lookup walks the fallback chain twice** (`:466` `translate`): first in the requested namespace, then again in `common`, then shows the **key itself** as the last resort. The chain is cached per start locale (`fallbackChain`, `:382`) and cached chains are dropped whenever the catalog changes.
  - **A fallback chain must terminate at English** (`:334` `assertFallbackChain`): cycles, unknown targets and chains that do not reach `en` are refused at registration; a refused registration is **rolled back** (`this.catalog.delete(key)`, `:325`).
  - **`detectBrowserLocale` uses `window`, not `navigator`** (`:535`): "Node exposes a global `navigator` reporting the machine's own language, which must not decide the locale for non-browser runs."
  - **Matching is exact-tag first, then primary subtag** (`:551`): "an exact regional registration wins before a language-wide fallback".
  - **A stored external locale waits for its definition** (`:304` `adopt`): if the preferred id is not in the catalog, the *provisional* locale stays active — the preference is not silently lost.
  - **`<html lang>` is written only when the value changes** (`:148` `syncDocumentLanguage`): dictionary-only revisions leave the attribute untouched.
  - **The Host read runs after plugin activation** so "an unavailable settings scope cannot block the page" (README), and a **late native initialisation that resolves after unload is contained** (`:568`).
- **Edge cases & failure handling:** an unknown locale id in `setLocale` throws; a malformed BCP-47 tag throws; a duplicate `(ns, locale)` throws ("a namespace's texts have one owner"); the disposer removes only *its own* dictionary (identity-checked, `:396`); removing the *active* language falls back without clearing the stored id; an external plugin's `addLanguage` disposer is idempotent and identity-checked (`:334`).
- **Surprising:** `bind(ns)` returns **the same function object** for a namespace on every call — deliberately, so it "can ride inject surfaces without breaking memoization".

##### `packages/client/locale/src/locale-settings.ts`
- **Purpose:** the durable `locale.preference` field and its BCP-47 pattern `^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$` (`:14`).
- **Non-obvious decision:** `LOCALE_IDS = ['zh','en']` (`:17`) is the shipped set, while `LocaleId = string` (`:25`) is the *open* type — language-pack plugins may add ids the host never sees.
- **Key abstractions:** `LOCALE_SETTINGS_NAMESPACE = 'locale'` (`:9`), `LOCALE_PREFERENCE_FIELD = 'preference'` (`:12`), `LocaleSettingsFields` (`:35`), `LocaleSettingsSchema` (`:39`).

##### `packages/client/locale/src/index.ts` (Host half)
- **Purpose:** registers the `locale` settings namespace on the Host. The preference field is declared **`volatile()`** (`:27`) — a volatile preference must not trigger a Host restart — and the plugin registers with `settings.configure({ auto: false })` so it does **not** get an auto-generated Settings page (`:36`).

##### `packages/client/locale/src/client/bootstrap.ts`
- **Purpose:** the native-shell bootstrap bridge. `parseLocaleBootstrap(value)` (`:26`) validates the IPC payload by hand and throws `TypeError('locale: invalid native initialization data')`.
- **Non-obvious decision:** the bridge is **read once per page load** ("A fresh read on each page load prevents a stale preload preference after reload" — README).

##### `packages/client/locale/src/client/settings-store.ts`
- **Purpose:** the Language row's slot store — a *mirror* of the locale snapshot, written only by the plugin's apply-world change listener.
- **Non-obvious decision:** `revision` starts at **-1**, not 0 (`:29`) "so revision 0 lands as a change" — and `sync` drops any write whose revision is not strictly greater (`:33`), which is what makes a stale HMR disposer harmless.

##### `packages/client/locale/src/client/LanguageRow.tsx`
- **Purpose:** the Settings → General "Language" row: a title, a selector pill, and a `Menu` with the registered locales.
- **Non-obvious decision:** the row **registers itself** into the `settings.general.item` slot (in `src/client/index.ts:544`) — "a feature owns its own settings surface" — instead of the Settings package knowing about the language feature.

##### `packages/client/locale/src/locales/en.ts`, `zh.ts`, `index.ts`, `settings.ts`
- **Purpose:** the shipped dictionaries. **`zh` is the source of truth for the key set** (Chinese-first repo convention) and `en` is *checked complete against it* with `satisfies Record<CommonKey, string>` — "a missing or extra en key is a compile error" (`src/locales/index.ts:5`). The `common` namespace holds ~45 shared words (OK, Cancel, Copy, Retry, Loading…, `{value}K`); `settings.locale` holds one key.

##### `packages/client/locale/src/css-modules.d.ts`
- **Purpose:** the CSS-module declaration shim (`*.module.css` → `Record<string,string>`).

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/locale/README.md` | The i18n contract. Decides: the preference lives in Host settings (`cordis.patch.yml`), not the browser; browser detection is provisional until the Host read lands; lookup order (namespace → `common` → the key itself); language packs must terminate at `en`; `<html lang>` external-id vs built-in-tag mapping; and two limitations — **registry-held text reads its translation once** (copy captured at registration time keeps its language) and **language packs own language-specific behaviour** (no plural rules, no bidi). |
| `packages/client/locale/README.zh.md` | Chinese sibling; heading tree read (15 headings). |
| `packages/client/locale/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/locale/locale/en.json` | `meta.title = "locale"`. |
| `packages/client/locale/locale/zh.json` | `meta.title = "界面语言"` + description. |
| `packages/client/locale/package.json` | `dsh.client.inject` lists four other client packages (connection, ui-renderer, ui-settings, api-remotes) — the plugin composes, it does not own, the transport. |
| `packages/client/locale/tsconfig.json` | Two-project solution. |
| `packages/client/locale/tsconfig.client.json` | Client project uses `include: ["src"]` + `exclude: ["src/index.ts"]` — the Host entry is kept out of the browser program. |
| `packages/client/locale/tsconfig.host.json` | Host project: only `src/index.ts` and `src/locale-settings.ts`. |
| `packages/client/locale/tsdown.config.ts` | Shared client build helper. |
| `packages/client/locale/tests/apply.client.spec.ts` | Pins plugin activation: a late native initialisation that resolves or rejects **after unload** is contained; changes are reported only while mounted; the slot service is declared; the service is provided with both dictionaries and the row is registered whether the declaration precedes or follows `apply`; snapshots project into the row store and face writes route back; external locale registration/disposal projects into the row; the explicit Host preference loads **after non-blocking activation**; an **HMR collapse of the declaring entry does not leave a stale disposer that blocks**; teardown removes the row and teardown without a declaration is quiet. |
| `packages/client/locale/tests/bootstrap.client.spec.ts` | Pins the native bridge: a failed native read is **reported, not silently swallowed**; the native language order is used without persisting a provisional choice; the stored choice survives dictionary/language registration; an external preference stays pending until its language registers; the preload response is validated before its fields are read. |
| `packages/client/locale/tests/config.host.spec.ts` | Pins that the locale preference registers with the Host settings lifecycle and that **the plugin keeps its own instance off the generated Settings pages**. |
| `packages/client/locale/tests/document-language.client.spec.ts` | Pins `<html lang>`: stated at activation (not the markup's shipped value), follows a switch in both directions with BCP-47 tags, follows an explicit Host preference, uses an external locale's id, and is **not rewritten for catalog changes that keep the same active locale**. |
| `packages/client/locale/tests/language-row.client.spec.tsx` | Pins the row: title + active label on the pill, open/select/close, closing on an outside pointerdown without selecting, and following store changes with an unknown active id falling back to the id itself. |
| `packages/client/locale/tests/locale.client.spec.ts` | The 30-case runtime suite: the active→en→key chain, the `common` fall-through, `{name}` interpolation leaving unknown placeholders intact, stable per-namespace `bind` identity, duplicate `(ns,locale)` rejection and disposer scoping, the LocaleFace contract (revision moves on switch *and* registration; unsubscribe works), a throwing subscriber isolated, disposer republish, `setLocale` writing through the scope and republishing only on a real change, **persisting an explicit pick of the provisional locale**, process-local operation without a host scope, unknown id throwing, external locale registration with reversible disposal, fallback copy until a dictionary registers, duplicate/malformed definition rejection, malformed id rejection *before* dictionary registration, per-key recursive fallback walking, a fallback cycle exposed by re-registering an unloaded language, adoption of a saved external locale when it registers later, adoption of a Host preference without writing it back, an absent Host preference returning to the browser locale, adopting a section standing at construction and releasing the subscription on dispose, opening provisionally in the browser language with regional matching by primary subtag, re-evaluating browser languages as definitions register/unload, running outside a browser, an explicit in-process preference replacing the browser value, English serving as both the opening locale and the dictionary fallback, and the exact initial two-locale catalog with its fallback relation. |
| `packages/client/locale/tests/localized-text.client.spec.ts` | Pins `resolveText`: strings verbatim (no lookup, no interpolation), each field resolved in the current locale without registering map languages, registered regional fallbacks walked with lowercase map keys, and English used across an unloaded fallback. |
| `packages/client/locale/tests/settings-store.client.spec.ts` | Pins the mirror store: the empty init shape with `revision: -1`, the sync advancing the revision, and the revision guard dropping stale and duplicate writes. |

### 1.4 `packages/client/modules` — the client plugin (module) manifest system (18 files)

#### Tier 1 — load-bearing source

##### `packages/client/modules/src/client/manifest.ts` (23 KB — the wire contract)
- **Purpose:** the browser-safe contract face: the `__DSH_BOOT__` wire types, the boot-manifest parser, and the boundaries around `ClientModuleSystem`.
- **Key abstractions:** `WebBootEntry` (`:46`), `WebBootBatch` (`:70`), `WebBootBatchPhase = 'bootstrap'|'application'` (`:67`), `WebBootRelease {version, commit?}` (`:83`), `WebBootGraph` (`:90`), `BootModuleRow` (`:110`), `BootPluginRow` (`:131`), `BootManifest` (`:141`), `parseBootManifest(wire)` (`:229`), `readRelease(wire)` (`:319`), `parseDshClient(pkgName, value)` (`:182`), `exactPackageSpecifier` (`:203`), `stripClientSuffix` (`:216`), `ClientModuleLoader` (`:401`), `ClientModuleRecord` (`:379`).
- **Data flow:** `window.__DSH_BOOT__` → `parseBootManifest` → **two consumer views** of the same wire: `modules` (the module table's view: `url`, `initialUrl`, `rev`, `inject`, `external`) and `plugins` (the entry-composition view: `id`, `inject`, `immediately`).
- **Non-obvious design decisions:**
  - **The parser is loud, never lenient**: a missing/non-object graph, a non-string `rev`, a malformed `release`, a non-array `entries`/`batches`, a duplicate entry id, a duplicate batch URL, an entry in no batch, an entry in two batches, a batch naming an unknown entry — every one throws with a precise message. "a page without a valid manifest cannot boot anything" (`:225`).
  - **`stripClientSuffix` normalises `<id>/client` to `<id>`** (`:216`) — "a plugin bundle IS its package's client half" — so each importing package can request the subpath its own code imports.
  - **`readRelease` reads the release WITHOUT validating the rest of the graph** (`:313`) — so a release stays comparable "when another release changes the graph format" (this is what lets the page announce a release it cannot parse).
  - **The `dsh.client` declaration validator is shared** by the node half's Loader scan and the roster generator (`:177`).
- **Edge cases & failure handling:** `optionalStringArray` throws when a field is present but is not an array of strings (`:158`).

##### `packages/client/modules/src/client/system.ts` (22 KB)
- **Purpose:** the implementation behind `ClientModuleLoader` — the lazy-CJS module table.
- **Key abstractions:** `class ClientModuleSystem implements ClientModuleLoader` (`:118`), `defaultLoadBundle` (`:18`), `atRevision` (`:36`), `chunkUrl` (`:59`), `claimStyles` (`:91`), `register` (`:172`), `arrive` (`:221`), `arriveGraphRow` (`:282`), `materialize` (`:337`), `makeRequire` (`:363`), `importChunk` (`:402`), `import` (`:436`), `prefetch` (`:451`), `invalidate` (`:568`).
- **Data flow:** `prefetch(id)` → arrive (register the factory, do **not** run it) → `import(specifier)` → materialize (`factory(require)` → exports, memoized in `loadCache`). `require.async('./client.x.js')` loads a package-local chunk on demand.
- **Non-obvious design decisions:**
  - **A bundle that loads without registering is NEVER re-executed** (`:262`): "the batch script registers its packages in sequence and a replay would stop at the first duplicate registration". Only a *transport* failure is retried once, and then the row falls back to its own one-resource URL — "one failed batch costs at most three requests per missing row".
  - **A failed batch URL is remembered, a failed one-resource URL is not** (`:274`): "a one-resource URL has no fallback and stays retryable on the next import".
  - **A require cycle is fatal** (`:343`): "factory-form CJS cannot deliver partial exports".
  - **The style claim is a before/after diff** (`:83`, `:91`): untagged `<style>` tags that appeared during materialization are claimed for that plugin; a tag present *before* the factory ran is not. A factory that throws has its claimed styles removed (`:355`).
  - **An arrival cycle is detected and named** (`:288`): "the host must reject this graph before serving it".
  - **A dependency cascade is re-thrown as a chain** (`:330`): `"consumer" not loaded because dependency "dep" failed` — so 44 unrelated failures read as one chain.
  - **The last import error per row is recorded** (`:461` `recordingImportError`) — transport, registration, cascade, *or* factory execution — and cleared by a later success or an `invalidate`.
  - **A factory registered twice is loud** (`:180`): "bundle executed twice without invalidate?".
- **Edge cases & failure handling:** `import` of an unknown specifier throws "the runtime mirror of the bundle purity gate" (`:448`); a chunk request outside the boot graph throws; a chunk whose owner URL cannot address siblings throws at URL-resolution time (`:66`).

##### `packages/client/modules/src/client/entries.ts` (11 KB)
- **Purpose:** page-owned entry reconciliation — "transport-independent reconciliation, retries and code replacement".
- **Key abstractions:** `class ClientEntries` (`:42`), `ClientEntryState {syncing, failures}` (`:11`), `ModuleIndex` (the private descriptor-replacement seam, `:20`).
- **Data flow:** `start(loader, manifest)` creates the initial roster; `sync(graph)` validates and applies a new full graph; `retry()` reconciles again; `reload(id, rev)` replaces one entry's code. **All of it runs on one serialized queue** (`enqueue`, `:171`).
- **Non-obvious design decisions:**
  - **A generation counter invalidates stale work** (`:189`): "A local generation prevents an older download from mounting after its desired entry or code changes". `current(generation)` is checked between every await.
  - **`enqueue` never lets one failure stop the next operation** (`:171`): the queue continues, and the failure is recorded as a *page-local* failure for the subject.
  - **The release is compared BEFORE the graph is validated** (`:127`): "a graph of another release, including one whose format this page cannot read, is not applied".
  - **Ownership survives a rejected export** (`:185` `create`): `this.managed.set(id, loader.resolve(entryId))` in a `finally` — "Keep ownership even when Loader rejects a module's plugin exports after inserting its entry".
  - **Removed fibers are awaited for inertia** (`:239`): "Removed fibers no longer appear in Loader.getTasks()", so the loop must wait them out.
  - **A failed entry is retried in place** (`:254`): `entry.fiber.update(entry.options.config)` — the same entry, not a new one.
- **Edge cases & failure handling:** an entry whose fiber never becomes ACTIVE is reported as "is waiting for activation" (`:272`); `reload` of an unknown id invalidates and reconciles instead (`:141`).

##### `packages/client/modules/src/client/release-change.ts`
- **Purpose:** the gate that decides which Host graphs a page may apply.
- **Key abstractions:** `class ReleaseChangeGate` (`:38`), `ClientReleaseChange {page, previous, host}` (`:8`).
- **Non-obvious design decisions:** **two releases are equal only when BOTH `version` and `commit` match** (`:16`); the dismissed release is held in a **one-element object** (`:48`) because "an unpublished release is itself a value" (a bare `undefined` would be ambiguous); only the *last* dismissed release is remembered, in page memory.

##### `packages/client/modules/src/client/entry-lifecycle.ts`
- **Purpose:** two loader-lifecycle operations. `tearDownEntryFiber` (`:11`) **deletes the runtime from the registry before clearing the fiber** — "Registry deletion prevents Loader from treating replacement as a user disable" — then awaits the fiber's inertia. `removeOwnedStyles` (`:23`) removes only `<style data-plugin="<id>">` tags.

##### `packages/client/modules/src/client/notify.ts`
- **Purpose:** subscriber notification, one `try/catch` per subscriber (`:9`) — "one throwing subscriber must not skip the rest".

##### `packages/client/modules/src/client/index.ts`
- **Purpose:** the browser entry point. `createClientModuleSystem(target, bootstrapModule, options)` (`:44`) builds the system; `apply(ctx)` (`:74`) enrolls the kernel-built system as `ctx.modules` and **throws if the Loader has no client module system** (`:78`).
- **Non-obvious decision (from the header comment):** "The module system itself is built by the shell kernel BEFORE cordis exists (the bootstrap exception — the mechanism that loads plugins cannot arrive through itself)."

##### `packages/client/modules/src/index.ts` (49 KB — the Node half; read structurally: head 200 + exported/signature index + tail 90)
- **Purpose:** the Host side — scan enabled Loader entries for `dsh.client`, compose `window.__DSH_BOOT__`, serve `/plugins` bundle and combo responses with source maps, and provide `ctx.clientModules`.
- **Key abstractions:** `class ClientModuleRegistry extends Service` (`:603`), `ClientArtifactBaseline {path, mtimeMs, ctimeMs, size}` (`:61`), `orderByModuleGraph(entries)` (`:508`), `bootInjections(graph)` (`:559`), `MissingClientBundleError` (`:97`), `ClientPackageCompositionError` (`:112`), `LazyResponse` (`:156`), `ComboArtifact` (`:162`), `BatchArtifact` (`:174`).
- **Non-obvious design decisions (from the header and the index):**
  - **Scanning is incremental per package — "there is no full-rescan code path"** (`:6`). Every cordis `internal/plugin` emission marks the fiber's entry name dirty; a **microtask flush** reconciles each dirty name. The activation pass seeds the same dirty set and flushes synchronously, so first scan and steady state share one implementation.
  - **Package metadata is cached per Loader specifier AND owning-tree base URL until restart** (`:5`), including the *negative* "not a client package" verdict.
  - **Revisions are metadata-based, not content-based** (`:221` `artifactRevision`): derived from `mtimeMs`, `ctimeMs` and size — "ctime distinguishes rewrites that preserve mtime and size". The README calls this out as a limitation.
  - **Combo URLs are partitioned before they exceed 3 KiB** (`:264` `projectedComboUrlBytes`, `:273` `partitionComboRecords`): one bootstrap combo for the modules row, one or more application combos.
  - **Responses are built lazily** (`:388` `lazyBody`): a script body is combined on its first `GET`; `HEAD` materializes neither body (`:1160`).
  - **The combo URL key and the wire reference differ** (`:559`): the graph carries the *app-directory-relative* form so a browser document resolves it under its own mount, while the response table is keyed by the absolute route.
  - **A missing bundle fails activation loudly with one build instruction and a package/path list** (`:97`, `:112`) — and `ClientPackageCompositionError` **separates "bundles not found" from "other failures"** so a missing build is not confused with a broken plugin.
  - **Distinct active Loader sources for one browser package are a composition error** (proved by `tests/node-half.client.spec.ts:443`).
  - **The bundle route follows the injected `webServer` lifetime**: it registers when the service is ready and is removed and re-registered when that service is replaced.
  - **The Node client entry and its split chunks are never served as browser factory scripts** (`:1112`): `client.node.js` / `client.node.*` are explicitly refused.
- **Edge cases & failure handling:** an unknown resource or revision → 404; a non-GET/HEAD → 405; a malformed authored source map falls back to a generated-file map; an unrequested prior-generation map reads the *current* map file (a named limitation).

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/modules/README.md` | The module-system contract. Decides: the `dsh.client` declaration → a served `/plugins` bundle with no per-plugin wiring; **lazy execution** (running a bundle only registers a factory); the combo-failure arithmetic (≤ 3 requests per missing row); the live-plugin composition rules (enabling adds an entry, disabling removes it *and waits for its asynchronous effects* before evicting unused modules and styles); the **Host release change** protocol (a page applies nothing from another release, keeps running its current plugins, and publishes `releaseChange`; `dismissRelease()` remembers only the last dismissed release); the shared-module table rule; and the named limitations (metadata-based revisions, flat module graph by design, release detection rides the graph stream, source launch has no Host-half build step, bootstrap/code-replacement limits, lazy delivery retains requested bodies, an unrequested prior-generation map reads the current map file). |
| `packages/client/modules/README.zh.md` | Chinese sibling; heading tree read (18 headings). |
| `packages/client/modules/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/modules/locale/en.json` | `meta.title = "modules"`. |
| `packages/client/modules/locale/zh.json` | `meta.title = "客户端模块加载"` + description. |
| `packages/client/modules/package.json` | The manifest description is itself a design summary: "node half composes the `__DSH_BOOT__` entry graph … browser half is the lazy-CJS module table the vendored cordis Loader consumes as its internal seam". |
| `packages/client/modules/tsconfig.json` | A **single** project (not the host/client split of the other packages) with `lib: ES2024 + DOM` and `types: ["node"]` — because the Node half reads the browser half's contract file. |
| `packages/client/modules/tsdown.config.ts` | Shared client build helper. |
| `packages/client/modules/tests/entries.client.spec.ts` | Pins the page-side reconciliation: add/drain/re-enable with styles while unrelated entries survive; an obsolete download is not mounted but can be loaded later; dynamic dependencies register first and a still-required module is retained by an unmanaged entry; download/apply failures diagnosed with healthy plugins still running; an identical graph retried; malformed graphs rejected before mutating active entries; stable local snapshots with a failing subscriber contained; superseded snapshots ignored; reconciliation reported before startup; a materialization failure retried with the same graph and its partial styles cleaned; a stale code replacement not finishing after download or async teardown; bootstrap ownership explicit; a rejected Loader entry retained for retry rather than duplicated; Loader import failures reported and recovered; a materialized factory not mounted after a newer removal; overlapping graph snapshots coalesced; a superseded arrival and its cached dependency replaced before mounting; bootstrap and dependent fibers preserved; failed arrival targets discarded; the latest desired revision used when a rebuild queues before entry creation; styles cleaned from a superseded factory. Plus the release-change suite: boot-release graphs applied silently; another release applied not at all and announced once; the announcement withdrawn and only changed modules replaced when the Host returns; a dismissed release still applied not at all; a graph of another release announced **even when its format cannot be read**; an absent release treated as one identity; every subscriber notified when one throws. |
| `packages/client/modules/tests/loader.client.spec.ts` | Pins the lazy-CJS machinery: queued registrations drained into the live facade; prefetch registers without running the factory; import materializes once and memoizes; declared dynamic requests and injected packages register before their consumer; concurrent callers share one arrival; a chunk loads only when its factory requests it (with the invalidating revision); a bare async request answered through the ordinary import path; a chunk arriving after its owner generation was invalidated is discarded. Plus bundle-arrival recovery (retry once on transport failure and share the retry; fall back per row; never re-execute a batch that loaded without registering; never re-execute a batch that already ran; report every attempt; a failed one-resource URL stays retryable). Plus the import-error record (transport failure cleared by a successful import; a throwing factory recorded; the failed dependency named in the consumer's record; a non-`Error` throw recorded as an `Error`; a prefetch failure cleared by `invalidate`). Plus require resolution (recursive materialization; seed preferred; cache hit; a miss is loud; a cycle is fatal). Plus the bootstrap module, the failure modes (duplicate registration, malformed/duplicate chunk registration, malformed relative chunk, a chunk from an owner outside the graph, an unaddressable sibling chunk, a chunk that does not register its id, an unknown import, an unknown prefetch, a duplicate graph entry, an arrival cycle, double boot). Plus the boot-manifest wire (absent fields normalized; a non-array `external` rejected; the batch table required; an optional release carried and a malformed one rejected; malformed phases; duplicate batch URLs; several batches per phase; complete batch fields; a one-to-one batch assignment). Plus HMR reset (invalidate drops factory and record; absolute and protocol-relative combo endpoints preserved; the current revision used when no override). Plus style claiming (untagged tags claimed and inventoried; pre-existing untagged tags left alone; nested-require attribution; removal on a throwing factory; no document). Plus the default transport seam (external classic script; the settled node removed; a load failure loud). |
| `packages/client/modules/tests/node-half.client.spec.ts` | Pins the Node half: the Web-carrier lifetime tracked in both orders; the Host release published in every composed graph; the HTML bootstrap facade preceding blocking preloads and the boot graph then becoming live; every application combo preloaded; a page that did not preload the modules bundle rejected; a bootstrap bundle with a runtime external rejected; the browser module id derived from the file entry's owning manifest; owning-tree package resolution for an import-only Worker loader; sibling `dsh` roles allowed; distinct active Loader sources for one browser package rejected and the remaining source promoted; missing bundles grouped under one build instruction; other read failures **not** reported as missing builds; a generated-file map fallback; a source map read only on its first map GET; a materialized resource retained across an unrelated recomposition; packed combo sections mapped back to each bundle; one prior immutable batch generation retained; **artifact revisions preserved across registry restarts** and scan-order changes; the graph and subscribers unchanged when a rebuild has identical artifacts; revisions hashing only metadata; agreement with a fresh registry after a byte or build-stamp change; a revision change on a same-size rewrite that preserves mtime; startup combos split before the map-form URL exceeds 3 KiB; a source map served beside a registered bundle; a package-local chunk served only after its versioned URL is requested and read only through the asynchronous filesystem face; a chunk re-read after its first asynchronous read fails; a renamed browser export loaded at the logical URL without exposing Node bundles; a new chunk revision when a build rewrites only the entry timestamp; `sourceRoot` applied; a non-zero second batch section mapped through a standard source-map consumer; a generated-file fallback combined with a later authored map. Plus shared-module declarations and the **module-graph order** suite (every requested row before its consumers along a chain; a shared row before both arms of a diamond; a `/client` request resolved onto the requested row; an unanswered request left to the static channel; a cycle rejected and named; a self-request rejected; the served graph composed in module-graph order; activation failing loudly on a cycle). |

### 1.5 `packages/client/product-analytics` — desktop product telemetry (22 files)

#### Tier 1 — load-bearing source

##### `packages/client/product-analytics/src/index.ts` (Host half)
- **Purpose:** the authenticated analytics RPC — event intake plus live compaction collection.
- **Key abstractions:** `class ProductAnalytics extends TypertRemoteService` (`:38`), `Config` (`:19`), the `@Remote enabled()` (`:57`), `@Remote({mode:'stream'}) watchPolicy(signal)` (`:66`), `@Remote report(event)` (`:93`).
- **Data flow:** `report` → `enabled()` check → **one** environment snapshot promise, memoised for the plugin's life (`:97`) → `deepseekAccount.getDeviceIdentity()` → the static environment fields + identity + app version → `ctx.productTelemetry.emit(...)`.
- **Non-obvious design decisions:**
  - **The policy is checked TWICE** — before the work and again after the async environment/identity lookup (`:104`): "The Host checks its current volatile configuration again at event intake and after environment and identity lookup."
  - **`missing_fields` is a sorted, comma-separated scalar string** (`:106`), not an object — "encodes failed fields as a sorted scalar and omits an empty failure list". The sort makes the value comparable across events.
  - **The environment snapshot is cached even when it FAILED** (`:97`): `this.environment ??= collectEnvironment(...)` — the promise never rejects, so a failed sample is not retried per interaction. The README names this a limitation ("startup contention can cause a cached timeout for the whole run").
  - **The service aborts its environment queries on disposal and awaits them** (`:44`) — "disabled or disposed intake never emits late results".
  - **Compaction is observed, not replayed** (`:51`): the `session/event` listener reports `context_compression` with `trigger_type` `auto`/`manual` derived from `event.data.turn === null` — the Host never walks Session history.
  - **The `enabled` setting is `volatile()` and has no user-facing control** (`:37`) — the settings scope registers it with `auto: false`.
- **Edge cases & failure handling:** a missing account identity is omitted, not fatal; an exporter submission failure is isolated and logged as a warning; the exporter is required even when collection is disabled (the plugin's `inject` lists `productTelemetry`).

##### `packages/client/product-analytics/src/environment.ts`
- **Purpose:** static OS metadata collection — "independent of account and credential availability".
- **Key abstractions:** `collectEnvironment(options)` (`:73`), `EnvironmentAttributes` (`:8`), `MissingReason = 'unavailable'|'invalid-value'|'query-failed'|'timeout'|'output-limit'|'unsupported'` (in `environment-query.ts:5`).
- **Data flow:** `node:os` for the always-available fields, then platform-specific **fixed** commands: Windows PowerShell (`-NoProfile -NonInteractive -EncodedCommand` with a UTF-16LE base64 script) or macOS `sw_vers` / `sysctl`.
- **Non-obvious design decisions:**
  - **Every field has a defined failure mode; a failed source only invalidates its DEPENDENT fields** (`:86` `missing()`): "The failed OS source cannot invalidate independently collected fields."
  - **A missing value is never a zero** (`:91`): `undefined`, `''`, a non-safe-integer, or `<= 0` all become `unavailable`. The README: "missing numeric fields never become zero"; "Missing revision never becomes `.0`".
  - **The Windows revision is preserved verbatim** (`UBR`), and `0` is refused as a fabricated revision (the test at `tests/environment.host.spec.ts:55`).
  - **Physical cores are summed across sockets and never inferred from logical processors** (`:135`, `EnvironmentAttributes.cpu_physical_core_count` comment).
  - **Native architecture is independent of the running binary** (`:139`): Windows CIM architecture codes map to `ia32/arm/x64/arm64`; the map must be *uniform across sockets* or the field is `unavailable` ("does not merge conflicting socket architectures"). `app_arch` stays `process.arch`.
  - **The PowerShell script is base64-encoded UTF-16LE** (`:110`) — the standard way to pass a script with no quoting hazards.
  - **The Windows path is built from `process.env.SystemRoot`** (`:104`); an absent root marks the four query fields `unavailable` **without spawning anything**.
  - **A non-Windows/non-macOS platform marks the four fields `unsupported` without spawning** (`:162`).
- **Edge cases & failure handling:** malformed JSON → `invalid-value` (never the raw output); a macOS `ProductVersionExtra` that conflicts with the inline suffix → `invalid-value`; the inline `(a)` suffix is accepted without being doubled.

##### `packages/client/product-analytics/src/environment-query.ts`
- **Purpose:** bounded, cancellable execution of **fixed** OS metadata commands.
- **Key abstractions:** `queryEnvironment(command, args, options)` (`:33`), `QueryResult = {kind:'value',stdout} | {kind:'missing',reason}` (`:11`), `QueryOptions {timeoutMillis, maxOutputBytes, signal}` (`:15`).
- **Data flow:** `execFile` with **no shell** (`:36`), `windowsHide: true`, a `killSignal` of `SIGKILL`, a timeout and a `maxBuffer`; the child is awaited to `'close'` before the result is returned.
- **Non-obvious design decisions:**
  - **The result is a fixed reason, never the raw error or output** (`:43`): `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` → `output-limit`; killed-and-not-aborted → `timeout`; anything else → `query-failed`.
  - **The child is awaited to `close` even when execFile already reported** (`:52`): "execFile can report abort before stdio closes; disposal owns both settlements."
  - **A synchronous spawn failure creates no child** (`:50`) and is isolated as `query-failed` — the other queries stay owned.
  - **Commands are never event-supplied text** (`:29`): the argv is fixed by the caller.

##### `packages/client/product-analytics/src/events.ts`
- **Purpose:** the **closed set** of event names and their allowed fields.
- **Key abstractions:** `ProductEventMap` (`:8`), `ProductEvent` (the discriminated union) (`:60`), `TrackProductEvent` (`:66`), `OnboardingPage` (`:56`).
- **Non-obvious design decisions:** the map is **attribute-typed per event** — e.g. `auth_page_click` may only carry `button_name: 'sign_in'|'api-key'`; `install_plugin_result` carries `input_value`, `is_success`, `error_reason?`, `duration`, `plugin_name?`. This is the "generated Typert validator accepts only the typed event fields" the README mentions — a schema, not a free-form bag.

##### `packages/client/product-analytics/src/client/index.ts` (renderer half)
- **Purpose:** the desktop renderer's analytics sender.
- **Key abstractions:** `class DesktopAnalytics extends Service` (`:16`), `apply(ctx)` (`:62`).
- **Data flow:** the constructor checks `'dshDesktop' in globalThis` (`:25`) — **the browser has no collection capability at all** — and otherwise opens a **policy stream** (`ctx.remote.$stream`) whose frames flip `this.collecting`. `track(name, attributes, timestamp = Date.now())` (`:52`) drops the event when collection is off.
- **Non-obvious design decisions:**
  - **The sender retains its OWN RPC context** (`:21`): "RPC dispatch stays in the provider context when Cordis traces a consumer call" — so a consumer's trace cannot leak into the analytics RPC.
  - **A transport failure is swallowed** (`:23`): "Missing or disconnected Remote services must not interrupt the interaction."
  - **The policy stream failing closed** (`:34` `carrierFailed` → `collecting = false`) — an analytics outage must not become a data leak.
  - **`inject = ['remote', 'remote.productAnalytics']`** — the sender needs the *specific* remote, not just the gateway.
  - **Events are not retained for reconnect** (`:47`): "Send an event without retaining it for reconnect or later enablement."

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/product-analytics/README.md` | The telemetry contract. Decides: Desktop reports through the existing OTel exporter **by default, with no user-facing control**; ordinary Web never submits these events; missing login identity is omitted; the exact field table (12 fields + `missing_fields`); the *deliberate exclusions* (API keys, account tokens, prompts, responses, hostnames, machine UUIDs); **environment sampling is one-shot and cached**; the query bounds (5 000 ms / 16 384 bytes); and a long list of event-semantics rules (onboarding impressions counted once; `send_button_click` retains its original timestamp and captures the model/effort/run-mode *before* async adjudication and only on the ordinary message path; a failed send does not retract the attempt; `Plan` takes precedence over an active goal; `session_id` omitted while the Session is blank; model/plugin switches report only accepted changes; fork events carry the created child id before the optional title update; `plugin_toggle` distinguishes `plugin` from `bundle`; install results use `user_cancelled` / `unknown_result`; `input_value` is redacted to `[git]` / `[url]` / `[path-or-other]`; `is_builtin` means *installation-supplied*). Plus five limitations (one-shot sampling, host security policy blocking PowerShell, disabling does not clear the exporter queue, no durable outbox, native startup waits for Host authentication). |
| `packages/client/product-analytics/README.zh.md` | Chinese sibling; heading tree read (10 headings). |
| `packages/client/product-analytics/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/product-analytics/locale/en.json` | `meta.title = "product-analytics"`. |
| `packages/client/product-analytics/locale/zh.json` | `meta.title = "桌面端使用统计"` + description. |
| `packages/client/product-analytics/package.json` | Exports `./client`, `./typert` (host), `./remote` (browser) — the same dual-face pattern as file-upload. |
| `packages/client/product-analytics/tsconfig.json` | Two-project solution. |
| `packages/client/product-analytics/tsconfig.client.json` | Client project: only the renderer sender and the event types. |
| `packages/client/product-analytics/tsconfig.host.json` | Host project: the RPC service, the events, and the two environment modules. |
| `packages/client/product-analytics/tsdown.config.ts` | `clientBundle(..., { hostPhase: true })`. |
| `packages/client/product-analytics/tests/collection.client.spec.ts` | Pins the renderer sender: **never collects in Web even when the Host advertises analytics**; disabled events dropped with no backfill; no retry or propagation of a transport rejection; a synchronous Remote failure does not interrupt the action; the supplied occurrence time is kept and new events stop on a policy change; **fails closed on stream loss** and accepts a fresh policy after reconnection; a consumer can report without being granted the analytics Remote namespace. |
| `packages/client/product-analytics/tests/collection.host.spec.ts` | Pins the Host: disabled collection reads no identity and submits nothing; login identity reused and only approved common fields copied; a missing identity does not discard a valid event; **unload suppresses an identity lookup that settles after disposal**; the event written through the real exporter to an isolated collector; live manual and automatic compaction collected only when enabled; an unavailable account omitted and exporter failure isolated; the exporter required even when collection is disabled; live policy changes streamed and intake disabled during an identity lookup; pending policy readers woken on disposal and hidden settings presentation registered; one environment query shared across concurrent events with identity kept fresh; failed environment fields cached without discarding the event or retrying; sampling aborted and awaited on disposal with no late results; failed fields encoded as a sorted scalar with an empty list omitted. |
| `packages/client/product-analytics/tests/environment-composition.host.e2e.ts` | One e2e case: real system metadata added to an existing event through Loader and OTLP. |
| `packages/client/product-analytics/tests/environment-query.host.spec.ts` | Pins the query runner: UTF-8 output captured and the child closed before returning; nonzero exit output and raw error text omitted; a failed spawn settling without retaining a buffer or child; a timeout terminating the child and awaiting close; multibyte stdout bounded without treating truncated metadata as valid; stderr bounded even when stdout would be valid; an in-flight query aborted with child closure awaited; synchronous spawn failures isolated; and (macOS only) the real kernel architecture matched, including Intel without the arm64 OID. |
| `packages/client/product-analytics/tests/environment.host.spec.ts` | Pins the environment collector: the Windows revision preserved and physical cores summed across sockets independently of the logical count; a genuine revision of `0`/`9457`/`9458` retained; **no invented revision zero** when `UBR` is missing; missing build/major/minor marked without discarding CPU metadata; invalid CPU fields rejected; unavailable CPU architecture and physical cores marked; conflicting socket architectures not merged; native Windows ARM64 read independently of the application binary; Windows query fields omitted when `SystemRoot` is absent or empty; `timeout`/`output-limit`/`query-failed` isolated from the local CPU and memory fields; malformed JSON rejected without exposing raw output; macOS product version and native architecture reported for arm64 `1`/absent/`0`; the macOS security-response suffix preserved; garbage versions rejected; macOS query failure isolated from the Node fields; unusable memory marked unavailable instead of zero; refused synchronous OS sources isolated; an unsupported platform marked without spawning commands; an inline macOS response suffix accepted without doubling; conflicting macOS suffixes rejected. |
| `packages/client/product-analytics/tests/fixtures/environment.host.ts` | The e2e fixture: boots the **production profile** with an overlay, points the telemetry exporter at a local HTTP receiver, and writes `captures.json` with the captured events plus a **reference** computed independently by running `sw_vers`/`sysctl`/PowerShell directly — so the test compares the collector against the OS itself. |
| `packages/client/product-analytics/tests/fixtures/environment.patch.yml` | The profile overlay: three plugins disabled, the OTLP exporter inserted with a test endpoint, and the analytics plugin enabled with a synthetic app version. |

### 1.6 `packages/client/resources` — the URL-addressed live-value model (14 files)

#### Tier 1 — load-bearing source

##### `packages/client/resources/src/client/contract.ts`
- **Purpose:** the published face of the resource model. "A resource is one address, and a resource address is a `dsh-resource://<type>/…` URL: the host names the protocol."
- **Key abstractions:** `ResourceStatus = 'none'|'loading'|'live'|'failed'` (`:41`), `ResourceSnapshot<Value>` (`:49`), `UseResource` (the global standard hook, `:62`), `ResourceProvider<P>` (`:74`), `Resources` (the service, `:96`), `ResourceProtocolMap` (declared in ui-slots — the **declaration-merged roster**, so a consumer names the protocol as a type argument without importing the owner's runtime).
- **Non-obvious design decisions:**
  - **Scope lives in the path, not in the model** (`:13`): "A protocol that needs a scope (a session, a workspace) encodes it in the path, as `dsh-resource://file/session/<sessionId>/<absolute path>` does; the model itself knows only addresses."
  - **Navigation addresses are NOT resources** (`:16`): "Addresses under any other scheme (`sidebar://guide`) are navigation addresses and name no resource."
  - **A failure is a FRAME, never a throw** (`:85`): "a throw inside the stream is a programming error and is not caught."
  - **A failed frame KEEPS the last value** (`:52`): "The latest `ok` frame's value; kept through a later failure frame".
- **Edge cases & failure handling:** ending the stream keeps the last state; a pin with an already-aborted signal pins nothing.

##### `packages/client/resources/src/client/resources.ts`
- **Purpose:** the provider registry and the per-address state machines.
- **Key abstractions:** `class ResourceRegistry implements Resources` (`:84`), `protocolOf(address)` (`:49`), `RESOURCE_SCHEME = 'dsh-resource'` (`:43`), `ResourceRecord` (`:26`).
- **Data flow:** `source(address)` → a **record** per address (kept for the page lifetime) → a `SnapshotStore` + a holder count → the first holder opens the provider's stream → each frame sets `live`/`failed` → the last holder's release aborts the controller and resets the snapshot to idle.
- **Non-obvious design decisions:**
  - **Records are never dropped, only their state is** (`:4`): "Keeping the record keeps `source()` reference-stable across React's render-then-subscribe window and a StrictMode remount, where a recreated record would make every render resubscribe and restart the stream." This is the single most transferable idea in the package.
  - **`protocolOf` reads the URL's HOST** (`:49`): the scheme is fixed (`dsh-resource:`) and the host names the protocol, lower-cased. A non-special scheme keeps its case, hence the explicit `toLowerCase()`.
  - **A provider arriving later attaches the addresses it owns** (`:140` `attach`): held records start their stream; an idle record becomes `loading` **without opening**.
  - **A provider leaving detaches only its own records** (`:150`): the stream ends and the record reports `none`.
  - **Frames arriving after the release that aborted the stream are dropped** (`:172`): "A frame the provider yields after the release that aborted it belongs to nobody; ending the loop also returns the iterator."
  - **A failed frame keeps the previous value** (`:180`): `value: record.store.getSnapshot().value`.
- **Edge cases & failure handling:** a second provider for one protocol throws; a registration is dropped when the *registering fiber* is disposed and when the *registry's own fiber* is disposed; a pin whose signal is already aborted pins nothing; the subscriber's unsubscribe is idempotent (`active` flag, `:112`).

##### `packages/client/resources/src/client/index.ts`
- **Purpose:** the browser plugin. `apply(ctx)` (`:34`) builds the `ResourceRegistry` **at apply's top level, never inside an effect** (`:37`): "other plugins call `register()` from their own apply, and it adds an effect to this fiber." The service is provided via `ctx.reflect.provide` and its disposer is registered **first so it tears down last** (`:41`): "the face outlives every provider that registered into it." `ctx.slots.provideRoot({keyedHooks:{resource: …}})` makes `useResource` reach every slot component.

##### `packages/client/resources/src/index.ts`
- **Purpose:** the Host half is a **no-op** (`:7`) — "Pure host half; the resource model lives in the browser export."

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/resources/README.md` | The resource contract. Decides: the `dsh-resource://<type>/…` address form; scope-in-the-path; the four statuses; one provider per protocol (a second registration throws); **registering a provider while addresses are held opens them; disposing it ends their streams and returns them to `none`**; `pin()` for "hold open without subscribing" and the Sidebar's use of it to pin every open tab so switching tabs unmounts the body without closing its stream; failures as frames; and two limitations (records live for the page lifetime — memory grows with the number of distinct addresses ever read; providers own abort compliance). |
| `packages/client/resources/README.zh.md` | Chinese sibling; heading tree read (15 headings). |
| `packages/client/resources/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/resources/locale/en.json` | `meta.title = "resources"`. |
| `packages/client/resources/locale/zh.json` | `meta.title = "客户端资源服务"` + description. |
| `packages/client/resources/package.json` | A **client-only** package: `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-renderer"]`, no host export beyond the inert entry. |
| `packages/client/resources/tsconfig.json` | A single client project (`extends tsconfig.base.client.json`). |
| `packages/client/resources/tsdown.config.ts` | Shared client build helper. |
| `packages/client/resources/tests/apply.client.spec.ts` | Pins the plugin: the host Loader entry stays inert; `ctx.resources` is provided and every slot component gets `useResource` over the shared source; both are withdrawn on dispose so a remount registers again without a duplicate; one address is shared across independently bound views without reopening on rebinding. |
| `packages/client/resources/tests/resources.client.spec.ts` | Pins the registry: `protocolOf` reads the host lower-cased and reports none for any other address; a protocol is owned by exactly one provider and freed on dispose; `none` for an address with no provider and for a navigation address; a held address opens when its provider arrives and closes when it leaves; **only the arriving protocol's held addresses are opened**; an idle unheld address turns to `loading` without opening; registrations drop when the registering fiber or the registry's own fiber is disposed; the stream opens on the first subscriber only and closes after the last leaves; one source per address; pins hold until the signal aborts and an aborted signal pins nothing; a remounting subscriber gets the latest value without reopening while a pin holds it; a resource reopens as a fresh stream after the last holder left; frames a released stream still yields are ignored and its iterator returned; a stream ending on its own keeps the last value live; a failure frame sits beside the last value and the next `ok` clears it; a first-frame failure with no value; a failure frame after release dropped; different complete addresses opened independently with only the lifetime signal supplied; **late value/failure frames dropped after a released resource reopens** and **after a provider replacement**; another protocol streaming plain numbers. |

### 1.7 `packages/client/ui-directory-picker-browse` — the in-app Miller-column directory browser (16 files)

#### Tier 1 — load-bearing source

##### `packages/client/ui-directory-picker-browse/src/client/DirectoryBrowser.tsx` (52 KB — read structurally: head 190 + exported/signature index + tail 90)
- **Purpose:** the 680×500 "Select Workspace Directory" Miller-column dialog.
- **Key abstractions:** `DirectoryBrowserProps` (`:48`), `DirectoryBrowser` (`:273`), `LevelColumn` (`:221`), `visibleEntries` (`:201`), `readDraft` (`:178`), `displayCrumbs` (`:116`), `separatorOf` (`:132`), `draftDirectory` (`:157`), `failureText` (`:75`).
- **Data flow:** the owner injects `listDirectory(path?, signal?)` and `createDirectory(path, name)`; the dialog keeps a parent/child pair of levels, a selection, a draft, and a `showHidden` flag; `onOpen(targetPath)` adopts the selection, falling back to the listed level.
- **Non-obvious design decisions:**
  - **Three named timing constants, each with a stated purpose** (`:88`, `:97`, `:106`): `SLOW_SCAN_DELAY_MS = 300` (a listing that settles inside the window swaps the panes with **no intermediate frame** — only a genuinely slow host shows the "Loading…" pill, and the pill floats over the stale view); `PARENT_LEG_WAIT_MS = 200` (inside the window both legs land as ONE two-pane frame; past it the target commits single-pane and the late parent leg upgrades in place); `DRAFT_PREVIEW_DEBOUNCE_MS = 250` (absorbs the keystrokes that walk through intermediate directory parts).
  - **Navigation is "selection-anchored and quiet"**: "the previous view keeps rendering while a crumb jump or a submitted path is scanned, then target and parent legs land as one two-pane frame … navigation never flashes an intermediate frame."
  - **The platform separator is inferred from the HOST-STAMPED home path** (`:132`), "never from typed text or entry paths, where a backslash is a legal POSIX name character" — and the heuristic's last-step caveat is documented with a TODO for a host-stamped `separator` field.
  - **A failed listing keeps the previous view**; a failed navigation falls back to the single-pane landing rather than an error screen.
  - **Focus is re-parked deliberately** when a listing unmounts the focused row (`:542` in the test list) — "re-parks focus on the edit zone when a failed pick unmounts a dot-revealed row".
  - **The `busy` owner flag freezes Open and the view**; **every parent control is inert while the nested create dialog is open**.
  - **Escape is scoped to the topmost dialog** (`:1228`): the nested create closes first, the browser only after; and Escape inside the *path editor* collapses the editor, not the dialog.
  - **IME composition is respected** (`:1327`): Enter is ignored while a composition is active, in either input.
  - **The path and folder name are passed to the Host UNTRIMMED** — trimming only gates the blank check (`:1177`, `:1534`).
  - **Hidden filtering is client-side**; the Host always lists hidden entries and flags them.
  - **Every stale async result is dropped**: a superseded listing, a stale child listing, a stale failure, a late navigation resolution, a creation that settles after unmount or after close-and-reopen.
- **Edge cases & failure handling:** `failureText` (`:75`) prefers a Host business message carried as `{rpcError:{message}}` and falls back to `Error.message` then `String(error)`; a truncated level is flagged as incomplete; a failed home listing keeps path entry available.

##### `packages/client/ui-directory-picker-browse/src/client/flow.ts`
- **Purpose:** the browse occupant that adapts the slot owner's conversation onto the dialog.
- **Key abstractions:** `BrowseFlowInjected` (`:13`), `BrowseDirectoryFlow(props)` (`:32`).
- **Non-obvious decision:** **browse failures stay inside the dialog's own alert surfaces** (`:28`) — "the owner's `onError` arm is never driven by this occupant". A confirmed directory is the pick; a dismissal is the cancellation.

##### `packages/client/ui-directory-picker-browse/src/client/index.ts`
- **Purpose:** the browser plugin; it fills **two** directory-flow holes (`conversation.hero.workspace.directoryFlow` and `sidebar.workspaces.directoryFlow`).
- **Non-obvious design decisions:**
  - **The two dictionaries land as a unit** (`:48`): if the second registration hits a rival owner of the namespace, the first **rolls back before the throw** — "a failed activation must not squat the namespace's other locale".
  - **Both hole registrations install as ONE transactional effect** through nested `ctx.slots.inject()` calls (`:76`) — "the generator makes the two registrations one transactional effect. The outer/inner nesting order is arbitrary; neither hole has precedence."
  - **The dialog's copy is registered by the feature that owns it** (`LOCALE_NS = 'directory-browser'`), not by the workspace package.
  - `inject = ['slots','uiWorkspace','locale']`.

##### `packages/client/ui-directory-picker-browse/src/index.ts`
- **Purpose:** an **empty** Host `apply()` (`:8`) — "the empty apply exists so the plugin appears in the host cordis.yml / Loader".

##### `packages/client/ui-directory-picker-browse/src/client/DirectoryBrowser.module.css`
- **Purpose:** the dialog's stylesheet, written as a contract. Notable: the class is **doubled** (`.dialog.dialog`) so it beats Modal's own `.dialog` regardless of stylesheet order; the card is `min(680px, 100%)` × `min(500px, calc(100dvh - 32px))` with a flex header/footer and scrolling columns, "so shrinking the height keeps Open/Cancel reachable instead of clipping them below a fixed overlay"; the scrollbar token is **rebound on the surface** so descendants inherit it; the crumb bar IS the editor's box in both modes (the hover outline lights the whole row).

##### `packages/client/ui-directory-picker-browse/src/css-modules.d.ts`
- **Purpose:** the CSS-module declaration shim.

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-directory-picker-browse/README.md` | The browse-surface contract. Decides: one cordis.yml row composes the whole browse interaction; the dialog's shape; "New folder" opens a nested create dialog targeting the selected folder and selects what it creates; "Open" adopts the selected folder falling back to the listed level; **browse failures stay inside the dialog**; and two limitations (no search, no multi-select, no rename or delete; hidden filtering is client-side only). |
| `packages/client/ui-directory-picker-browse/README.zh.md` | Chinese sibling; heading tree read (11 headings). |
| `packages/client/ui-directory-picker-browse/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/ui-directory-picker-browse/locale/en.json` | `meta.title = "ui-directory-picker-browse"`. |
| `packages/client/ui-directory-picker-browse/locale/zh.json` | `meta.title = "应用内目录选择界面"` + description. |
| `packages/client/ui-directory-picker-browse/package.json` | `dsh.client.inject` lists four packages (api-remotes, ui-renderer, ui-workspace, locale) — the picker drives the workspace service and registers its own copy. |
| `packages/client/ui-directory-picker-browse/tsconfig.json` | A single client project referencing ui-slots, ui-primitives, api/remotes, locale, ui-renderer and ui-workspace. |
| `packages/client/ui-directory-picker-browse/tsdown.config.ts` | Shared client build helper. |
| `packages/client/ui-directory-picker-browse/tests/client-flow.client.spec.tsx` | Pins the plugin: the services it drives; both holes filled for declarations before *or* after `apply` and leaving with its fiber; the outer injection rolled back when the second hole is occupied; a wholesale rollback with a loud report when a rival injection wins declaration activation; the zh dictionary rolled back when a rival owns the namespace's en slot; the dictionaries registered and the namespace bound; the injected browse calls driven through the hole entry; confirm picking and dismissal cancelling; nothing rendered while closed; and the node apply as an inert loader seat. |
| `packages/client/ui-directory-picker-browse/tests/directory-browser.client.spec.tsx` | The 80-case dialog suite. Pins: nothing rendered and no listing launched while closed; opening at the Host home as one wide column with hidden entries hidden and crumbs rooted at Home; the toggle and its reset on close; a row select producing the two-pane view; a right-column pick advancing one level; **a superseded listing aborted on the wire** and the in-flight one aborted on close; crumb jumps to and away from the display root; a navigation to the filesystem root keeping the wide level; the target landing single-pane at the wait bound with the superseded parent leg aborted and its late resolution dropped; **a navigation landing as ONE two-pane frame**; a stalled parent leg upgrading in place; Escape inside the landing window withdrawing the submitted navigation; the loading indicator appearing only after the silence window and floating over the stale view; the silence window restarting on a superseding pick; a close mid-scan resetting the gate; the single-pane landing when the truncated parent lacks the target; Windows case-folding anchoring; focus re-parking after an unmounted focused row; a failed preview clearing the selection; the fallback single-pane landing when the parent leg fails; Open adopting the selection else the listed level; busy freezing Open; path editing (Enter navigates, Escape restores, blank ignored); prefix filtering of the listed level with dot-revealed hidden matches; two-pane filtering and the draft walking back up; following the draft into a directory no pane lists; the pane arity holding as the draft walks; a stale pane held until its landing; the walked-to panes kept when the editor is cancelled; both legs waited out so one keystroke never flashes a single pane; the panes walking back up when segments are erased; the scan re-arming after a superseding keystroke; the draft followed again after a failed submission hold releases; focus re-parked when a landed scan unmounts the focused row; a failed scan keeping the panes and staying silent; the scan held while a submitted path is in flight; superseded scans discarded; the draft and filter kept through focus loss; Escape collapsing the editor rather than the dialog; a dot-revealed hidden row staying visible as the selection; picking a filtered row adopting it and closing the editor; a right-pane pick while editing parking focus; Windows backslash seeding; clicking away cancelling the edit; a restarted home listing; the path passed untrimmed; an unreadable target surfaced as an alert with the edit open; non-typed failures folded into readable text; the full ancestry outside the home subtree; Escape scoped to the topmost dialog; both dialogs kept open during an in-flight creation; New folder disabled during the post-create relist; path entry available when the home listing fails; the thrown message used for an invalid RPC error payload; Open and New folder disabled while a draft is uncommitted; Enter ignored during IME composition; a two-pane navigation failure surfaced below the columns; the editor kept open when a pending listing settles right after Edit Path; a pending navigation settling after Escape ignored; a newer path edit kept when an older slow navigation settles; an intact selection preview kept when a path edit is cancelled; the single-pane fallback when a path edit superseded the preview and was cancelled; a creation settling after unmount dropped; dismissal ignored while adoption is busy; parent controls inert while the nested dialog is open; creation failures and results after a close-and-reopen dropped; the folder name passed untrimmed; a folder created and landed with it selected; the nested dialog kept open on failure; a post-create relist failure surfaced; stale child listings and failures dropped; the create target named by its path when the level reports no crumbs; the nested dialog refusing to close during an in-flight creation; an incomplete level flagged when the backend cut it at its bound; a truncated child preview flagged; the child pane pinned into view; and starting back at home on reopen. |

### 1.8 `packages/client/ui-directory-picker-native` — the renderless OS-chooser flow (13 files)

#### Tier 1 — load-bearing source

##### `packages/client/ui-directory-picker-native/src/client/flow.ts`
- **Purpose:** a **renderless** occupant that opens the OS folder dialog and reports one outcome.
- **Key abstractions:** `NativeFlowInjected {pick(): Promise<string|null>}` (`:13`), `NativeDirectoryFlow(props)` (`:28`).
- **Non-obvious design decisions (all three are about React correctness):**
  - **The ref arms once per rising `open` edge** (`:47`) — "the ref arms once per open so re-renders (and an adoption keeping `open` true while `busy`) never launch a second chooser".
  - **Callbacks ride a ref** (`:38`): "Callbacks ride a ref so the settled pick reports through the owner's latest handlers, not the ones captured when the chooser opened."
  - **Unmount discards the settlement wholesale** (`:44`): "the dead instance must neither adopt a path nor drive the owner's error surface. The wire carries no per-request abort, so the native chooser survives until answered — its answer just lands nowhere; the replacement instance re-arms under the owner's still-open request." An injected-face identity change alone (re-registration) **keeps** the pending settlement.
  - **StrictMode's development replay is handled explicitly** (`:52`): "StrictMode's development replay runs the cleanup once before the real lifetime: re-arm on setup or every outcome would be discarded."
- **Edge cases & failure handling:** a `null` path is a cancellation; a rejection is folded into `onError` with `Error.message` or `String(reason)`.

##### `packages/client/ui-directory-picker-native/src/client/index.ts`
- **Purpose:** the browser plugin. It reads a **pre-Cordis page global** `__DSH_DIRECTORY_PICKER__` (`:35`) and prefers it over the Host call (`:39`): the Electron shell owns the chooser; ordinary Web calls `ctx.uiWorkspace.pickDirectory()`.
- **Non-obvious decision:** the same nested `ctx.slots.inject()` transactional pattern fills both holes (`:44`).

##### `packages/client/ui-directory-picker-native/src/index.ts`
- **Purpose:** an **empty** Host `apply()` (`:8`).

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-directory-picker-native/README.md` | The native-surface contract. Decides: the OS chooser opens on the local machine; the picked path is adopted and cancelling closes; in Electron the flow uses the **narrow preload directory-picker bridge** and "cancellation and failure never retry through the Host chooser"; the two surfaces fill the same slots, "so switching is a composition change, not a code change"; and three limitations (no cancellation of an open chooser — the wire has no per-request abort; local carriers only; **Linux automatic selection** — without zenity or kdialog the Host selects browse even in Desktop). |
| `packages/client/ui-directory-picker-native/README.zh.md` | Chinese sibling; heading tree read (11 headings). |
| `packages/client/ui-directory-picker-native/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/ui-directory-picker-native/locale/en.json` | `meta.title = "ui-directory-picker-native"`. |
| `packages/client/ui-directory-picker-native/locale/zh.json` | `meta.title = "系统目录选择界面"` + description. |
| `packages/client/ui-directory-picker-native/package.json` | `dsh.client.inject` lists only ui-renderer and ui-workspace — the native surface registers **no locale**, because it renders no copy. |
| `packages/client/ui-directory-picker-native/tsconfig.json` | A single client project. |
| `packages/client/ui-directory-picker-native/tsdown.config.ts` | Shared client build helper. |
| `packages/client/ui-directory-picker-native/tests/client-flow.client.spec.tsx` | Pins the plugin and the flow: the services it drives; both holes filled for declarations before or after `apply` and leaving with its fiber; **a duplicate package row failing loudly instead of deduplicating**; a wholesale rollback with a loud report when a rival injection wins; the outer injection rolled back when the second hole is occupied; **a second flow occupant rejected at load (single-kind hole)**; the injected pick driven through the hole entry; the actual Desktop preload bridge consumed on win32 and darwin; the desktop bridge used without calling the Host, preserving cancellation and errors; **one pick per open edge** with the path reported to the latest `onPicked`; a settlement landing after unmount discarded; `null` reported as cancellation and re-arming after the owner withdraws `open`; pick failures folded into `onError`; nothing rendered while closed or open; and the node apply as an inert loader seat. |
| `packages/client/ui-directory-picker-native/tests/desktop-picker.client.spec.tsx` | One composition test: the native flow cancels through Desktop **without invoking the Host chooser**. |

### 1.9 `packages/client/ui-open-in-app` — "Open in…" controls (30 files)

#### Tier 1 — load-bearing source

##### `packages/client/ui-open-in-app/src/client/controller.ts`
- **Purpose:** the page-lifetime controller for the *directory* opener — availability, the remembered choice, and the launch POST.
- **Key abstractions:** `class OpenInAppController` (`:32`), `OpenInAppLaunchState {phase:'idle'|'busy'|'error', path}` (`:13`), three snapshot stores (`apps`, `choice`, `operation`).
- **Non-obvious design decisions:**
  - **The choice is PERSISTED across browser restarts and sessions** (`:39`): `persist: { name: 'dsh.open-in-app.choice' }` — "shared across sessions and browser restarts".
  - **Availability is read ONCE per controller life** (`:62`): `this.loading ??= this.run()` — concurrent calls share the read.
  - **A failed read publishes an empty list, which renders NO BUTTON AT ALL** (`:64`) — "an unreachable host reads as no apps, and the header simply shows no button rather than a broken one".
  - **Only *nameable* apps count** (`:44`): `currentApp()` filters the catalog through `APP_LABEL_KEY`, so an app the UI has no label for is invisible.
  - **A launch in flight blocks a second one** (`:86`): `if (this.operation.getSnapshot().phase === 'busy') return`, and `choose()` refuses to change the remembered app mid-launch (`:73`).
- **Edge cases & failure handling:** a non-OK availability answer, a non-array payload, and a network failure all yield an empty list; a non-2xx launch throws `open failed: HTTP <n>` and the operation state becomes `error` with the captured path.

##### `packages/client/ui-open-in-app/src/client/open-path.ts`
- **Purpose:** the *file* opener's carrier — desktop availability and the open/reveal gestures over the Session Remote.
- **Key abstractions:** `class OpenInAppPathController` (`:38`), `OpenInAppPathAction = 'open'|'reveal'` (`:14`), `OpenInAppPathFailure = 'openError'|'revealError'` (`:19`), `OpenInAppPathRemote` (`:24`).
- **Non-obvious design decisions:**
  - **The reveal request is distinguishable on the wire** (`:59`): `{path, action:'reveal'}` vs `{path, application?}` — the Host revalidates an explicitly selected handler before launching.
  - **A carrier rejection is treated exactly like a Host refusal** (`:66`): "a Host that cannot be reached failed the gesture like a Host that refused it, and the control announces that" — the failure kind is still `openError`/`revealError`.
  - **A failed association query is DISTINCT from an empty handler list** (`:82`): the query returns `null` on failure and the array on success, so "failed" and "nothing registered" never look alike.
- **Edge cases & failure handling:** availability is `null` until answered and `false` after a failed read, so the control renders nothing either way but can tell "not yet" from "no".

##### `packages/client/ui-open-in-app/src/client/file-applications.ts`
- **Purpose:** a **shared** association reader — several mounted controls for the same file share one query.
- **Key abstractions:** `useFileApplications(target, query, enabled)` (`:62`), a module-level `WeakMap<Query, Map<string, Entry>>` (`:15`), `Entry {state, users, controller, refresh}` (`:10`).
- **Non-obvious design decisions:**
  - **The cache is keyed by the query function itself** (`:15`): "a stable reader scoped to the serving Host" — a different Host gets a different cache.
  - **Reference counting, not subscription counting** (`:19`): "Each mounted consumer retains the query; the last release cancels and discards it."
  - **The last release aborts the controller and DELETES the entry** (`:46`) — the result is discarded, so a cancelled query cannot replace another file's results.
  - **A disabled control never joins the query** (`:64`): `enabled ? subscribe(...) : () => {}`.
  - **`useSyncExternalStore` with a stable `snapshot` getter** (`:65`) keeps the hook uSES-safe.

##### `packages/client/ui-open-in-app/src/client/OpenTargetButton.tsx`
- **Purpose:** the ONE split button shared by files and directories — "one default action, application menu, and per-gesture feedback".
- **Key abstractions:** `OpenTargetApplication` (`:16`), `OpenTargetOperation = {kind:'default'}|{kind:'application',id}|{kind:'reveal'}` (`:22`), `OpenTargetButtonProps` (`:27`), `useOpenTargetGesture` (`:44`), `OpenTargetButton` (`:80`), `ApplicationIcon` (`:72`).
- **Non-obvious design decisions:**
  - **The gesture is serialised by a REF, not by state** (`:52`): `if (inFlight.current) return` — "coalesces repeated gestures before the busy state renders", which the state alone cannot do.
  - **Files open through an application whenever one is registered** (`:93`): the OS-marked default, else the first entry in the Shell's preference order. **Reveal is promoted only when NO application is registered** (`:98`) — "so a missing default marker never hides the applications behind it".
  - **The Host's default marker is best effort** (`:105`): with no marker the control names the application it wants instead of letting the OS resolve the association again.
  - **Reveal always stays LAST in the menu, in a fixed footer** (`:128`) — separated from the scrolling applications.
  - **Each application icon has its own fallback** (`:72`): a failed image falls back to a generic icon, and the icon is `key`-ed by its source so a changed URL remounts it.
  - **The chevron triggers a refresh when the menu is opening** (`:147`): `if (!menuOpen) props.refresh?.()` — the menu shows current associations.
  - **A loading state with no known preferred app renders a skeleton** (`:110`).

##### `packages/client/ui-open-in-app/src/client/open-failure-toast.tsx`
- **Purpose:** a **per-control** failure banner — "one failed request announces once, from the control the user pressed".
- **Non-obvious design decision:** a **sequence number keys the banner** (`:16`): "the same failure text replays instead of staying silently in place" — without the key, React would keep the old toast mounted and the second failure would be invisible.

##### `packages/client/ui-open-in-app/src/client/index.ts` (the plugin)
- **Purpose:** registers the dictionaries and **five** slot contributions: `conversation.session.header.utilities`, `sidebar.right.tab.files.actions`, `sidebar.right.tab.document.actions`, `sidebar.right.tab.document.unpreviewable`, `deliverables.file.actions`, `deliverables.review.file.actions`.
- **Non-obvious design decisions:**
  - **The keyboard command resolves its target lazily and refuses politely** (`:96`): `resolve()` returns `{status:'blocked', reason}` with a localized reason ("Opening workspace", "Current workspace or local application unavailable") rather than silently doing nothing.
  - **The command only runs while the Conversation is selected** (`:82`): `if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) return undefined` — a global panel hides the Session header, so the workspace must not be opened from a hidden header.
  - **The target is captured at dispatch time** (`:73`): the main Session's `cwd` and the remembered app, "before dispatch" — so a gesture cannot open a different directory than the one the user saw.
  - **Both file-tree and Session header share ONE controller** (`:74`), so the choice and the busy state are global truth.
  - **The Session-header contribution is a thin adapter** (`:110`): it reads the Session's `cwd` through the runtime store and renders nothing when there is no `cwd`.

##### `packages/client/ui-open-in-app/src/client/OpenInAppAction.tsx`, `OpenPathAction.tsx`, `FileRouteAction.tsx`, `OpenPathEmptyAction.tsx`
- **Purpose:** the four adapters that feed the shared control.
- **Non-obvious decisions:** `OpenPathAction` and `OpenPathEmptyAction` **share `FileOpenTarget`** (`:36` of OpenPathAction) — the only difference is the `empty` flag, which switches to the prominent 40 px variant. `FileRouteAction` queries the **owning Session's authorized route** (`:13`) rather than the Session Remote, "without bypassing the owning Session's authorization route", and treats an unavailable route or a malformed response as "no associations" so reveal stays available. `OpenInAppAction` maps the catalog ids through `APP_LABEL_KEY` and **returns null when no app is nameable**.

##### `packages/client/ui-open-in-app/src/client/applications.ts`
- **Purpose:** the **nameable** application catalogue — 40 ids mapped to their label keys. The map is the gate: an app without an entry here is invisible in the UI.

##### `packages/client/ui-open-in-app/src/client/locales.ts`
- **Purpose:** the `open-in-app` dictionaries. The **product names are shared verbatim between both dictionaries** via one `PRODUCT_NAMES` constant (`:8`), and the `en` dictionary is typed `Record<OpenInAppKey, string>` against the **Chinese** key set (`:70`) — "zh is the source of truth". The English dictionary adds the four OS names that differ by platform (`Finder`, `File Explorer`, `Files`, `Terminal`).

##### `packages/client/ui-open-in-app/src/client/OpenTargetButton.module.css`
- **Purpose:** the 24 px-high split button — "a hairline pill with a 12px label and a narrow chevron half", sized to sit in a document header's 24 px control row beside round icon buttons.

##### `packages/client/ui-open-in-app/src/index.ts`, `src/css-modules.d.ts`
- **Purpose:** the inert Host half and the CSS-module shim.

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-open-in-app/README.md` | The open-in-app contract. Decides: the Session-header split button opens the session's `cwd` in the remembered application, and the chevron lists every catalog application the Host probed as installed; **a Host without the capability renders none of these controls**; the same 24 px split button across the Session header, file-tree header and document header; the shortcut "Open locally" and its platform-specific bindings, with the effective binding shown in the tooltip and `aria-keyshortcuts`; "pointer and keyboard gestures share the controller's launch state, so repeated gestures cannot launch twice or change the remembered choice mid-launch"; file menus have **no separate "Open in default app" row**; "Show file location" stays in a fixed footer; a successful query with one action renders a single button without a dropdown; a gray skeleton while associations load; choosing a file application does not change the system default; mounted controls with the same reader and file share one query and refreshing one refreshes all; the last release cancels the query and discards its state; and four limitations (the dictionaries gate the menu — a catalog extension without an `app.<id>` entry in **both** dictionaries stays invisible; availability is read once per page; one reveal label for every platform; the delivery cards keep their own opener). |
| `packages/client/ui-open-in-app/README.zh.md` | Chinese sibling; heading tree read (12 headings). |
| `packages/client/ui-open-in-app/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/ui-open-in-app/locale/en.json` | `meta.title = "ui-open-in-app"`. |
| `packages/client/ui-open-in-app/locale/zh.json` | `meta.title = "外部应用打开界面"` + description. |
| `packages/client/ui-open-in-app/package.json` | `dsh.client.inject` lists **ten** other client packages — the widest injection list in the shard, which shows how many surfaces consume this one feature. |
| `packages/client/ui-open-in-app/tsconfig.json` | A single client project with 18 project references. |
| `packages/client/ui-open-in-app/tsdown.config.ts` | Shared client build helper. |
| `packages/client/ui-open-in-app/tests/browser-plugin.client.spec.ts` | Pins the plugin: absent workspaces refused and failed keyboard launches reported; the main directory and remembered app captured **before dispatch** with pointer launch occupancy shared; the services it binds declared; **a retained workspace not opened while a global panel hides the Session header**; both document-preview path controls registered behind one desktop answer and removed on fiber teardown; the Session directory adapted and the controller shared with the file tree; the injected controller face; an empty availability list on a failed Host read and launches rejecting on HTTP errors; both dictionaries registered under its own namespace and released with the fiber; **the English dictionary key-identical to the Chinese source of truth**; and the node apply as an inert loader seat. |
| `packages/client/ui-open-in-app/tests/controller.client.spec.ts` | Pins the controller: no platform-specific choice at start; one availability read shared across concurrent loads; an empty list for a non-OK answer and for a non-array payload; the document-relative availability route requested; only nameable installed apps used with a fallback when the remembered choice is gone; the busy operation shared across gestures with the app and directory captured; the chosen app restored from the `open-in-app` storage key; the launch body posted with HTTP failures surfaced. |
| `packages/client/ui-open-in-app/tests/file-applications.client.spec.tsx` | Pins the shared reader: the initial read shared and a menu refresh published to both controls; cancellation only after the last consumer leaves with the released result discarded; disabled controls kept out of the query and refresh permitted only while retained. |
| `packages/client/ui-open-in-app/tests/file-route-action.client.spec.tsx` | Pins the delivery-card adapter: the authorized route queried, a handler selected, reveal kept last; reveal still available after an http/transport/invalid query failure; no query without a desktop and another pending gesture honoured. |
| `packages/client/ui-open-in-app/tests/open-in-app-action.client.spec.tsx` | Pins the directory adapter: the accelerator advertised; nothing rendered before availability arrives, with no apps, or for unnameable ids; the remembered choice shown with a fallback; both buttons disabled and duplicate gestures ignored until the launch settles; a launch failure announced without changing the remembered application; only applications listed with the default marked and a successful choice remembered; Escape closing without launching and an icon fallback; the selected application named in the tooltip; no dropdown with a single directory application; the displayed directory opened and its changes followed. |
| `packages/client/ui-open-in-app/tests/open-path-action.client.spec.tsx` | Pins the file adapter (19 cases): nothing rendered while the desktop answer is unknown and nothing without a desktop; the default application opened from the main button and revealed from the menu; the default application also offered from the menu with Escape closing without a gesture; both halves disabled while the gesture settles and no failure left on the control; the empty-state variant rendering nothing without a desktop and opening with one; a failed open announced **once** through its own toast, which leaves after its hold and fade, dismissed on schedule even when the owner re-renders; the default icon and current application list shown with a selection that does not replace default opening; an obsolete file query ignored and the default application refreshed when the menu opens; reveal kept last and made the default when the query fails; the first registered application used when none is marked default; reveal as the default only with no registered application; repeated gestures coalesced before the busy state renders; the menu closed from its chevron without querying again; the association query awaited before a default action is allowed; the same menu in the prominent empty-state control with the prominent default labelled reveal when no application is registered; a skeleton while associations load and reveal pinned outside the application list. |
| `packages/client/ui-open-in-app/tests/open-path.client.spec.ts` | Pins the path controller: started unanswered with one read shared across concurrent loads; no desktop published for a refusing Host, a failed answer and a rejecting carrier; the default-application open sent without an action and the reveal with one; the failed gesture named for a refused answer and a rejecting carrier; current handlers queried with an explicit application carried without changing the default gesture; **failed association queries distinguished from an empty application list**. |

### 1.10 `packages/client/ui-renderer` — the slot renderer and React binding (30 files)

#### Tier 1 — load-bearing source

##### `packages/client/ui-renderer/src/client/registry.ts` (33 KB — read structurally: head 150 + exported/signature index + tail 60)
- **Purpose:** the renderer-owned Cordis service over the pure `SlotCore` (which lives in ui-slots). The module header states the split precisely: ui-slots owns registration semantics, the declaration ledger, the load-time validations and the unload cascade; **this layer owns what needs a live application** — the `slots/changed` event bridge, injection through the caller's `ctx.effect`, the renderer installation contract, and the store INSTANCE axis.
- **Key abstractions:** `class SlotRegistry extends Service` (`:120`), `RootOwnerProps` (`:49`), the `SlotMap` merge declaring the built-in `'root'` slot (`:28`), `StoreAxisRecord` (`:61`), `FactoryStoreAxis` (`:76`), `ErasedRegisterOptions` (`:83`).
- **Non-obvious design decisions:**
  - **The `'root'` slot carries a long warning comment** (`:32`): it is a *single* slot, so a second entry does not sit beside the frame — **it shadows it**, and a dynamically registered entry gets a lower priority than the shipped one, so the dynamic one WINS and the page renders your component alone with every seat the frame declares gone. The comment names the correct alternative (`shell.overlay`, "a list slot: additive, and click-through until your entry opts into pointer events").
  - **The store axis is (handle × scope key) → instance** (`:65`), with the record dropped when the last holding entry unloads; **in-memory session instances are released without clearing persisted state** on scope death (`:4`).
  - **Factory store occurrences are WEAK until committed** (`:78`): "Render-created records stay weak until their occurrence commits"; committed ones are enumerable for session-generation cleanup.
  - **Duplicate root standard props are rejected without publishing a partial binding** (`copyUnique` at `:718`) — the whole binding is refused, not half-applied.
  - **`register`/`registerFactory` are assigned on the prototype** (`:737`) rather than declared as class members, with the reason in a comment — the `declare` inside the class needs the implementation elsewhere.
  - **A scope-less factory store resolution throws** (`requireScopeKey` at `:756`): "session factory store resolution requires a session id".
- **Edge cases & failure handling:** a second declaration of `root` is rejected attributing the built-in row; a store handle bound to two scopes throws; a core rejection commits nothing (children stay undeclared); `renderSlot` before `install` throws with boot-order guidance; a double install throws; any non-`root` key throws.

##### `packages/client/ui-renderer/src/client/scoped-slots.tsx` (54 KB — read structurally: head 140 + exported/signature index + tail 70)
- **Purpose:** the React renderer for declarative slots — "Per-entry bindings enforce child authorization, and entry boundaries contain registrant failures".
- **Key abstractions:** `createSlotRenderer()` (`:1318`), `SlotOutlet` (`:1069`), `RootOutlet` (`:1275`), `FactoryOutlet` (`:978`), `FactoryOccurrence` (`:906`), `RootEntry`/`SessionEntry`/`SessionMaybeEntry` (`:767`, `:656`, `:703`), `SlotErrorBoundary` (`:409`), `boundRenderSlot`/`boundRenderSlotChain` (`:68`, `:98`), `standardKit` (`:544`), `factoryKit` (`:860`).
- **Non-obvious design decisions:**
  - **Every per-entry binding is identity-stable and dies with the entry** (`:62`): "memoized components must not resubscribe on unrelated re-renders"; a retained closure calling after disposal hits the in-ledger check and throws `StaleAuthorizationError`.
  - **The stale check PRECEDES the ownership check** (`:70`) — a dead binding throws "stale" even for an undeclared key.
  - **A `chain` slot must use `renderSlotChain` and a non-chain must use `renderSlot`** (`:76`, `:107`) — the kind mismatch is caught in both directions as a plain-JS backstop behind the typed narrowing.
  - **An undeclared slot renders as EMPTY, not as a crash** (`:341` of the test list): "declaring entry unloaded = natural blank, not a crash".
  - **A crashing entry is isolated** (`:386`): "isolates a crashing entry without collapsing siblings"; the boundary remounts on re-election so a failed entry does not black out its replacement.
  - **The root's failure modes are distinguished** (`:1283`): if registrations exist but every one abdicated, the crash face `<div data-slot-error="root" />` replaces the tree; if NO registration exists at all, it throws `SlotAssemblyError("renderSlot('root') before any 'root' registration (boot order)")` — "registered-but-broken is a crash, not the boot-order assembly failure".
  - **Prop precedence is fixed and documented** (`:624`): `<Comp {...kit} {...injected} {...slotInjected.props} {...contextual} {...ownerProps} />` — **owner props win**.
  - **`assertNoPropOverlap`** (`:852`) rejects a duplicate prop between the injected kit and the received props rather than letting one silently shadow the other.
  - **A recursive factory render throws** (`:996`): `SlotOwnershipError('recursive render of factory …')`.
  - **The session-maybe scope has an explicit *incarnation*** (`useMaybeIncarnation`, `:737`): "adopts the first session: blank → first id keeps the incarnation (no remount)"; a post-adoption switch remounts so local state cannot leak across sessions, and a no-op republish of the same session keeps the incarnation.
  - **Locale is delivered through a *revision* subscription** (`useLocaleRevision`, `:353`), not by re-binding the translate function, so a dictionary that arrives late refreshes the mounted outlet.
  - **The `t` seat is synthesized from the declared locale namespace** (`:303` `localeSeat`) — the renderer owns the standard seat, not the plugin.

##### `packages/client/ui-renderer/src/client/bindings.tsx`
- **Purpose:** the internal React bindings.
- **Key abstractions:** `HostContext`/`useHost` (`:19`, `:26`), `RootBindingContext`/`useRootBinding` (`:35`), `ScopeBindingContext`/`useScopeBinding` (`:44`), `ScopeBindingProvider` (`:57`), `observableHook` (`:67`), `maybeObservableHook` (`:82`), `keyedObservableHook` (`:135`), `RootStandardProvider` (`:169`), `ScopeProvider` (`:177`), `keyedHookCall` (`:113`).
- **Non-obvious design decisions:**
  - **Hooks are cached per source object** (`:73` `hookCache`, `:145` `keyedHookCache`) — a WeakMap, so the selector hook identity survives re-renders.
  - **`maybeObservableHook` keeps the hook CALL ORDER stable** (`:82`): "Bind an optional source without changing Hook call order" — an absent source still calls `observableHook(absentSource)` internally, so React's hook sequence never changes between an absent and a present source.
  - **The keyed hook supports three call forms** (`:113`): `(key, member)`, `(key, selector?, equal?)`, `(selector, equal?)` — and the *default key* is a scope (`'session'`), with `NO_DEFAULT_KEY` a `Symbol` so it cannot collide with a real key.
  - **The scope revision is subscribed before the adapter is resolved** (`:184`): `observableHook(host.scopeRevision)(v => v)` then `host.scope(scope)` — so a scope adapter that installs later re-renders the subtree.
  - **Every missing provider throws a `SlotAssemblyError`** with a precise message (`:29`, `:39`, `:49`).

##### `packages/client/ui-renderer/src/client/bind.ts`
- **Purpose:** the ONE hook constructor in the client stack — "engines and hosts traffic in bare sources; binding happens on the React side".
- **Key abstraction:** `bindSnapshotSelector(w)` (`:20`).
- **Non-obvious decision:** `subscribe`/`getSnapshot` are captured **once per source** into stable closures (`:22`), "so components never resubscribe across renders"; equality defaults to `Object.is`. The method-style source's `this` is re-bound.

##### `packages/client/ui-renderer/src/client/index.ts`
- **Purpose:** the plugin — installs the renderer and provides `ctx.uiRenderer`.
- **Non-obvious design decisions:**
  - **The boot DOM is HYDRATED, not replaced** (`:60` `mountApp`): when the kernel left a `[data-dsh-boot]` element, `hydrateRoot` is used with a `BootHandoff` component that renders the boot markup for one frame (`useLayoutEffect` → `setReady(true)`) and the real app afterwards — "preserving the framework-free boot DOM through hydration".
  - **Without a boot element, the render is FLUSHED synchronously** (`:78`): `flushSync(() => root.render(app()))` — the assembled app appears before the next paint.
  - **The `slots/changed` event is declared** (`:37`) with the rule that *factory definitions publish through `subscribeFactory()` instead*.
  - `inject: string[] = []` — the renderer needs no service to install.

##### `packages/client/ui-renderer/src/client/app.tsx`
- **Purpose:** the assembly closure — the whole layout tree hangs from the built-in `root` slot, "the only ctx-level slot render in the application" (`:3`).

##### `packages/client/ui-renderer/src/client/errors.ts`
- **Purpose:** one error class, `SlotAssemblyError` (`:5`) — "Renderer assembly failures that must escape component error boundaries".

##### `packages/client/ui-renderer/src/client/use-sync-external-store.d.ts`
- **Purpose:** local typings for `use-sync-external-store/shim/with-selector.js` — "the runtime package ships no types".

##### `packages/client/ui-renderer/src/index.ts`
- **Purpose:** the inert Host half.

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-renderer/README.md` | The renderer contract. Decides: `mount(container)` hydrates the framework-free boot page and switches to the full React application **before the next paint**; the renderer performs the sole context-level `renderSlot('root')` call; business plugins "never wire subscriptions themselves — the renderer binds the runtime's bare observable sources into selector hooks at the slot outlets"; a Component Factory can expose caller-selected local Components "without sharing implementation values between packages"; a Factory Store factory stays lazy until an occurrence first materialises, its exclusive handle rejects persistence, and render-time records stay weak; Factory errors use the ordinary supervision channel **without abdicating the shared definition** — the definition and its fallback local Components report against the definition, caller-selected ones against the caller registration, and each boundary resets with its own scope incarnation; React/React DOM/Cordis/ui-slots/ui-primitives keep **one browser identity** through the shell's static module table while this package arrives as a dynamic bundle; and two limitations (the first application frame waits for every client entry; **no Suspense integration or per-entry lazy loading**). |
| `packages/client/ui-renderer/README.zh.md` | Chinese sibling; heading tree read (14 headings). |
| `packages/client/ui-renderer/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/ui-renderer/locale/en.json` | `meta.title = "ui-renderer"`. |
| `packages/client/ui-renderer/locale/zh.json` | `meta.title = "界面渲染"` + description. |
| `packages/client/ui-renderer/package.json` | `dsh.client.immediately: true` — the renderer must exist before the roster settles. |
| `packages/client/ui-renderer/tsconfig.json` | A single client project referencing only ui-slots. |
| `packages/client/ui-renderer/tsdown.config.ts` | Shared client build helper. |
| `packages/client/ui-renderer/tests/app.client.spec.tsx` | Pins the assembly closure: a loud failure when the slot registry is unavailable; the root slot tree rendered. |
| `packages/client/ui-renderer/tests/bind.client.spec.tsx` | Pins the uSES bridge: a re-render on a selected change with a bail-out on an equal slice; custom equality for object slices; **no resubscription across re-renders**; StrictMode safety with subscription cleanup on unmount; method-style sources keeping their `this`; and the selector result memoized against `getSnapshot` spam. |
| `packages/client/ui-renderer/tests/factory-slots.client.spec.tsx` | Pins Component Factories (17 cases): direct lookups reported before rendering and without a definition; inject, locale, children, local selection and exclusive stores assembled per occurrence; the occurrence Store kept across StrictMode effect replay and renderer updates; **one exclusive handle minted per rendered Session incarnation**; a local Component bound to the scope at its render position; chain children bound with ordinary routing and stale-authority checks; a local Component given only its own scope standard props; a strict local Component without a current scope binding failing loud; a fallback rendered until a definition appears and restored after disposal; a component crash contained to its occurrence; a caller-selected local Component crash attributed to its caller; a fallback local Component crash attributed to the Factory definition and reset for its Session; caller ownership preserved when a selected local Component renders a nested Factory; stale authorization failures reported while the definition remains live; a failed session Factory retried after the Session incarnation changes; a failed boundary reset when the render position selects another Factory; undeclared local slots, recursive rendering, duplicate props and stale child authority rejected. |
| `packages/client/ui-renderer/tests/inline-slots.client.spec.tsx` | Pins inline anchors: inline anchors and exhausted cells render as `span` while ordinary slots stay `div`; span overlay fallbacks and span error boundaries for inline chains; the inline child anchor retained after its Factory declaration is disposed. |
| `packages/client/ui-renderer/tests/keyed-hook-member.client.spec.tsx` | Pins the keyed standard hooks: the `(key, member)` form reading the resolver's source; the selector/equality/default-key forms preserved; `undefined` read for every call form while the source family is absent. |
| `packages/client/ui-renderer/tests/reconnect.client.spec.tsx` | One case: the mounted root survives a transport reconnect. |
| `packages/client/ui-renderer/tests/registry.client.spec.ts` | The registry suite (40+ cases): the Factory definition ledger (one definition published, duplicates rejected, children collapsed on disposal; committed exclusive stores kept across effect replay with scoped instances released; **persistence rejected on an exclusive Factory Store**; a Factory store handle shared on the ordinary optional-scope axis); the built-in `root` (declared at construction, a second declaration rejected attributing the built-in row); load-time validation (contributing into an undeclared slot, a duplicate declaration naming the slot and the prior declarant, one store handle bound to two scopes, nothing committed when the core rejects the entry); declaration injection (immediate activation, waiting for a declaration, cleanup on collapse and re-run after redeclaration, a same-tick collapse/redeclaration observed through the declaration epoch, plugin disposal preventing a waiting injection from resurrecting, **earlier yielded registrations rolled back when generator setup fails**, a delayed setup failure contained so later slot listeners still run, a stopped controller skipped, a nested redeclaration activation kept when the outer collapse resumes, a waiting injection cancelled when its contributor is already unloading, dynamic plugin replacement without retaining the old entry, service-layer store state released when the declaration collapses); the renderer install seam (a throw before install with boot-order guidance, a throw on double install, a throw on any non-root key, a throw on `renderSlot('root')` before any root registration, rendering through the installed renderer); the host face (`entriesOf`/`specOf`/`isLive` served off the ledger with `isLive` flipping on disposal, root standard sources published and retracted **atomically**, duplicate final root prop names rejected without publishing a partial binding, scope-adapter install and disposal revisions published); the store instance axis (one instance per handle×root scope, per-session instances keyed by session id and created with the scope key, a fresh handle per register for the factory form, instances dropped with the last holding entry and stale resolution refused, a materialized per-session instance dropped without clearing persistence, per-panel and per-maybe memory separated when a Session reopens before the previous Context cleanup, scoped stores not materialised solely for scope release, scoped Store cleanup left with the newest Context generation, session-maybe state dropped without clearing persistence and a fresh instance on reuse); the entry-unload cascade (declared children, their contributions and the ledger rows killed with the entry; the cascade through cordis fiber disposal; an idempotent disposer); and the event bridge (entry writes and child declarations re-emitted as `slots/changed`). |
| `packages/client/ui-renderer/tests/scoped-slots-real-core.client.spec.tsx` | Pins the renderer over the REAL `SlotCore`: registrations rendered live through real microtask batching (register, dispose back to fallback); same-tick mutations coalesced into one notification so the uSES pairing stays consistent; owner props passed through with sibling `entries()` references stable across mutations; stale bindings fed from the real ledger — a disposed registration throws off `isLive`. |
| `packages/client/ui-renderer/tests/scoped-slots.client.spec.tsx` | The 60-case renderer suite: the root outlet (the root registration rendered, a loud failure when root is unregistered, owner props passed into the root component); child outlets and the `renderSlot` binding (declared single slots rendered live with fallback/empty/register/dispose, an undeclared key rendering empty rather than crashing, list ordering with the `only` filter and keyed dispatch by entryKey, the binding identity-stable across re-renders and throwing `SlotOwnershipError` off-declaration, a crashing entry isolated without collapsing siblings); chain outlets and `renderSlotChain` (the first non-null selector elected in order with `injected` matched and decliners skipped **without mounting them**, a throwing selector contained to its entry and treated as declined, the boundary remounted on re-election, the owner fallback used when every selector declines and re-routed live, an empty chain rendering the fallback and electing live once an entry registers, ascending-priority ordering with registration sequence breaking ties, the binding identity-stable, off-declaration keys and kind mismatches backstopped both ways, the chain seat withheld from entries declaring no chain child); overlay chains (the fallback kept mounted and state-holding through a takeover then hidden and restored, a fallback-only strict chain kept mounted until its Session scope exists, non-overlay chains left on the unmount path, election semantics preserved under overlay); standard-kit synthesis (a live `useSessions` and `useWorkspaces` hook delivered to every slot component, the session pair under `SessionProvider`, only function-valued inject hooks bound, the `SessionProvider` seat handed to entries declaring a session-scope child, a loud failure for a strict session slot while no session is current, the store pair delivered with baked actions, session-slot stores resolved per scope key with values surviving a switch-away and back); inject semantics (root inject running once per entry with no arguments, the inject hooks compartment bound into `use<Name>` selector hooks **so sources never reach the component**, the inject keyedHooks compartment bound without exposing source resolvers, session inject receiving sessionId and cached per (entry × session) so a switch-back reuses, store-declaring entries getting baked actions appended to the inject parameters, a throwing inject factory contained to its own entry, kit/inject/owner props merged with the owner winning); and the session-maybe adoption identity (the first session adopted without a remount, a remount on a post-adoption switch, a fresh blank incarnation on session loss, the incarnation kept across a no-op republish, mounted scope consumers rebound when the installed adapter changes). |
| `packages/client/ui-renderer/tests/session-provider.client.spec.tsx` | Pins `SessionProvider` (11 cases): explicit absence rendered, switching only when the owner supplies a reference; nothing rendered for explicit absence when the empty branch is omitted; **no root scope inferred from the main owner selection**; a resident optional subtree preserved when absence adopts its first Session; an adopted optional subtree reset for a same-id replacement generation; local state reset on a Session switch and on a same-id new Context generation; descriptor props refreshed without remounting the live generation; nested Providers bound independently with the outer reference restored for siblings; the Provider seat delivered to entries declaring only optional Session children; a loud failure when the Session adapter omits its area renderer. |
| `packages/client/ui-renderer/tests/stale-authorization.client.spec.tsx` | Pins the staleness rule: a live binding renders and the same closure throws after its entry is disposed; **the stale check precedes the ownership check** (a dead binding throws stale even for an undeclared key); an HMR reload (same key, new entry) mints a fresh binding while the old one stays dead. |
| `packages/client/ui-renderer/tests/ui-renderer.client.spec.tsx` | Pins the plugin: no host-side behaviour; the renderer installed and the assembled application mounted; the boot page hydrated before switching to the assembled application; an unmount disposer returned; the service and renderer retracted with the fiber. |
| `packages/client/ui-renderer/tests/use-projection.client.spec.tsx` | Pins the projection kit: the projected value read through the kit, `undefined` for unresolved keys, live changes followed; the selector overload run over the whole value (and over `undefined` when absent). |

### 1.11 `packages/client/ui-session` — the Session scope adapter (13 files)

#### Tier 1 — load-bearing source

##### `packages/client/ui-session/src/client/index.ts` (27 KB — read structurally: head 160 + exported/signature index + tail 60)
- **Purpose:** the Session Controller adapter for React selector hooks and Slot scope data — the package that decides **what a session-scoped component may see**.
- **Key abstractions:** `class UiSession extends Service` (`:282`), `UseSessions`/`UseSession`/`UseSessionStatus` (`:34`, `:38`, `:72`), `SessionStatus {running, pendingInteraction, completionUnread}` (`:60`), `SessionPendingInteractionMap` (a declaration-merged map, `:51`), `PendingInteractionPublisher` (`:107`), `class PendingInteractionDomain<T>` (`:118`), `SessionSourceDescriptor`/`SessionSourceContribution` (`:220`, `:209`), `MaterializedBinding` (`:262`), `renderSessionArea` (imported from `session-provider.tsx`).
- **Non-obvious design decisions:**
  - **The pending-interaction map is declaration-merged** (`:51`): every domain contributes its own pending-interaction shape, and the union is computed from the merged map. A plugin adds a pending-interaction *kind* without touching this package.
  - **A pending interaction carries a DELEGATE** (`:107`): the publisher hands over a `() => Promise<void>` that settles its owner, and teardown returns those delegates so the owners are settled rather than orphaned.
  - **A duplicate pending-interaction key throws** (`:130`): "a replacement request must use a new key".
  - **`release()` removes the values BEFORE awaiting the delegates** (`:145`) — the UI shows no pending interaction while the owner is still settling.
  - **Every descriptor is assembled BEFORE any subscriber is notified** (`:396` of the test list) — a later Session contribution that fails leaves **every source unchanged** (`:495`).
  - **Cross-compartment collisions are rejected at the final standard prop name** (`:477`, `claimStandardProp` at `:662`) — a hook named `sessions` and a prop named `useSessions` would land on the same prop name and throw.
  - **`running` is `boolean | undefined`** (`:61`) — "absent until a baseline or event establishes it". A synthetic catalog row is NOT running; it is *unknown*.
  - **The status snapshot is compared structurally before publishing** (`sameSessionStatus`, `:700`) — an unchanged map does not churn the subscribers.
  - **A source is shared between references to the same generation** (`:248`), and **an old Context's cleanup must not remove a same-id replacement source** (`:330`) — the generation check is what makes this safe.
  - **The `global` access resource and the per-Session resource use DIFFERENT hooks** (README "Access Hooks"): `useRemoteAccess(action)` vs `useSessionAccess(sessionId, action)` vs the Session-scope `useAccess(action)` — "so neither shadows the other".
- **Edge cases & failure handling:** a foreign or released reference is rejected before resolving UI sources; a failing binding subscriber is contained and dispatch continues; cached sources are released without rematerialising while the Controller binding stays live; a failing aggregate subscriber is contained; the SessionMaybe-scope `useAccess` returns `undefined` while no Session is bound.

##### `packages/client/ui-session/src/client/session-provider.tsx`
- **Purpose:** the `SessionProvider` seat's render semantics — `renderSessionArea(binding, {empty, children})` (`:15`): with no bound Session it renders the empty branch; otherwise the children. The Session's "render area" is a **function**, so the provider can decide *what* is rendered, not just provide a value.

##### `packages/client/ui-session/src/index.ts`
- **Purpose:** the inert Host half.

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-session/README.md` | The Session-adapter contract. Decides: the package exposes Session catalog, retain information and unified UI status through standard Slot hooks; it materialises per-`SessionBinding` hooks and props; `SessionProvider` can inherit an outer binding or bind an explicit `SessionReference`; it owns **process-local pending-interaction and completion-reminder policy** without owning Controller transport, history or references; running status comes from Host list baselines or status events; **subagent catalog rows and retained subagent fallback rows do not establish running status**, but main-view references still acknowledge completions; and the access-hook vocabulary (the `global` resource uses a different hook so neither shadows the other; the SessionMaybe-scope `useAccess` returns `undefined` while no Session is bound). One limitation: **pending interactions are process-local projections** — the owning Remote waterfall must replay an outstanding request after a browser reconnect. |
| `packages/client/ui-session/README.zh.md` | Chinese sibling; heading tree read (9 headings). |
| `packages/client/ui-session/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/ui-session/locale/en.json` | `meta.title = "ui-session"`. |
| `packages/client/ui-session/locale/zh.json` | `meta.title = "会话界面连接"` + description. |
| `packages/client/ui-session/package.json` | `dsh.client.inject` lists the session-controller, api-remotes, api-remote-access and ui-renderer packages. |
| `packages/client/ui-session/tsconfig.json` | A single client project with ten references. |
| `packages/client/ui-session/tsdown.config.ts` | Shared client build helper. |
| `packages/client/ui-session/tests/status-controller.client.spec.ts` | One case: unlisted child status preserved through metadata updates and main-view acknowledgement. |
| `packages/client/ui-session/tests/ui-session.client.spec.ts` | The UiSession suite: the main-view source tracked with its retention watcher moving between Sessions; one stable source shared between references to the same generation; explicit absence stable and independent of catalog changes; foreign and released references rejected before resolving UI sources; disposal published only to the ended generation and its reference rejected; **an old Context's cleanup not removing a same-id replacement source**; a failing binding subscriber contained with dispatch continuing; cached sources released without rematerialising while the Controller binding stays live; all descriptor snapshots assembled before notifying independent Session sources; cross-compartment collisions rejected at the final standard prop name; **every source unchanged when a later Session contribution fails**; synthetic-row status unknown until an event or Host baseline establishes it; non-main completions recorded and acknowledged by main-view activity; an idle event recorded before the initial catalog baseline with absent status retired later; the highest-precedence exact pending interaction published with each source removed independently; duplicate keys rejected and a failing aggregate subscriber contained; **active pending values removed before awaiting their teardown delegation**; the root sources provided and the Session scope adapter installed; and the Host loader half inert. |

### 1.12 `packages/client/ui-sidebar-browser` — sandboxed browser tabs in the right Sidebar (47 files)

#### Tier 1 — load-bearing source

##### `packages/client/ui-sidebar-browser/src/client/browser/url.ts`
- **Purpose:** the address policy — one parser that decides what a browser tab may open.
- **Key abstractions:** `parseBrowserAddress(input, applicationOrigin?)` (`:35`), `BrowserTarget` (`:10`), `BrowserAddressFailure = 'empty'|'invalid'|'protocol'|'credentials'|'application-origin'` (`:18`), `MAX_BROWSER_URL_LENGTH = 16 KiB` (`:6`).
- **Non-obvious design decisions:**
  - **A scheme-less address becomes HTTPS** (`:38`): the regex `^[A-Za-z][A-Za-z\d+.-]*:(?!\d+(?:[/?#]|$))` distinguishes a real scheme from a port (`localhost:8080` is NOT a scheme), and `https://` is prepended.
  - **The DSH application's own origin is refused** (`:47`): `reason: 'application-origin'` — "The embedded browser cannot open the DSH application itself."
  - **Embedded credentials are refused** (`:45`): `username`/`password` in the URL.
  - **Only `http:` and `https:` are allowed** (`:56`): `file:`, `data:`, `blob:` and script schemes are all `protocol` refusals — the error copy points the user at Document Preview for local files.
  - **The length cap bounds the PERSISTED state** (`:6`): "this bounds persisted navigation state".

##### `packages/client/ui-sidebar-browser/src/client/browser/BrowserController.ts`
- **Purpose:** "Carrier-independent tab commands and renderer-facing state" — the owner of address validation, commands, and explicit restoration, without inspecting the carrier type.
- **Key abstractions:** `class BrowserController implements HostObservable<BrowserControllerState>` (`:40`), `BrowserControllerState` (`:13`), `createBrowserControllers(actions, createPage, isTabOpen)` (`:207`), `BrowserInjected` (`:180`).
- **Non-obvious design decisions:**
  - **A saved checkpoint alone NEVER starts a page** (`:113`): "Consume initial navigation once; a saved checkpoint alone never starts a page." The user must press Restore.
  - **The restore affordance disappears once a page has been requested** (`:81`): `restoreTarget: frame.target === undefined ? currentBrowserTarget(this.checkpoint) : undefined`.
  - **An address failure is cleared when the target changes** (`:77`): the `addressRevision` counter increments on a real change so a stale error does not linger.
  - **Plugin unload does NOT delete the saved navigation** (`:237`): "Plugin unload also aborts occurrences; only layout removal deletes saved navigation" — the `isTabOpen` predicate distinguishes the two.
  - **An old occurrence cannot delete its replacement** (`:228`): the `held.signal !== signal` check disposes the old controller but the `forget` closure is bound to the signal.
  - **The controller can be REBOUND to a replacement Session binding** (`:149` `rebind`) — the checkpoint writer moves without losing the live page.
  - **Repeated `dispose()` calls join one disposal** (`:156`).

##### `packages/client/ui-sidebar-browser/src/client/browser/BrowserNavigation.ts`
- **Purpose:** the application-known history, used only by the iframe provider (which cannot read a cross-origin URL).
- **Key abstractions:** `class BrowserNavigation` (`:15`), `MAX_BROWSER_HISTORY = 100` (`:7`), `BrowserNavigationStatus` (in `BrowserPersistence.ts`).
- **Non-obvious design decisions:**
  - **The history is bounded at 100 entries** (`:96`): the oldest are spliced off.
  - **A new navigation discards the stale forward branch** (`:95`): `entries.slice(0, index + 1)`.
  - **The FIRST frame load for a revision is "known"; a LATER load is "unknown"** (`:157` `frameLoaded`): "another load marks it unknown" — proof that the page navigated somewhere the app cannot read. In that state Back, Forward and external-open are disabled.
  - **A frame observation before any controlled request is ignored** (`:155`).

##### `packages/client/ui-sidebar-browser/src/client/browser/IframeImpl.ts`
- **Purpose:** the iframe navigation provider.
- **Key abstractions:** `class IframeImpl implements BrowserFrame` (`:12`).
- **Non-obvious design decisions:**
  - **The sandbox is a provider-level control** (`:13`): `BrowserSandboxControl.setEnabled` — "an optional iframe policy control, not an Electron process-sandbox switch".
  - **A load failure is published only for the CURRENT document generation** (`:44`): `this.navigation.snapshot.request?.revision !== revision` → ignored.
  - **Re-submitting the current address is a RELOAD, not a new history entry** (`:60`).
  - **The sandbox toggle reloads the page** (`:88`) so the new policy actually applies.
  - **Every publish also persists the navigation snapshot** (`:105`).

##### `packages/client/ui-sidebar-browser/src/client/electron/ElectronWebViewImpl.ts` (12 KB — read structurally: head 90 + exported/signature index + tail 50)
- **Purpose:** the Electron `<webview>` navigation and guest lifetime, independent of DOM placement.
- **Key abstraction:** `class ElectronWebViewImpl implements BrowserFrame` (`:17`).
- **Non-obvious design decisions:**
  - **`attach()` vs `detach()`** (`:53`, `:65`): "A physical mount may recreate a lost guest; ordinary Sidebar hiding never calls this." `detach()` aborts the attachment and **drops the guest**, keeping only the pending target so a re-attach re-initialises it.
  - **The guest is acquired from the main process with a WORKSPACE storage account** (`:131` `initialize`), so the partition is per workspace.
  - **A load failure clears only the error, keeping the history flags** (`:240`): `canGoBack: this.ready && current.canGoBack`.
  - **A release is tracked in a set** (`:264`) so disposal can await every outstanding guest release.
  - **Only the address and title are persisted** (`browserAddressCheckpoint`), never Chromium's history stack.

##### `packages/client/ui-sidebar-browser/src/client/view/IframePresentation.ts`
- **Purpose:** the iframe DOM and its revision-tagged load observations.
- **Key abstractions:** `class IframePresentation implements BrowserPresentation` (`:31`), `WEB_BROWSER_SANDBOX` (`:8`).
- **Non-obvious design decisions:**
  - **The sandbox string is fixed and explicit** (`:8`): `allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox` — "top navigation and downloads are not granted directly".
  - **`referrerPolicy = 'no-referrer'`** (`:56`) and **no package-owned Permissions Policy** — "so browser defaults and user grants apply".
  - **Load/error handlers check identity** (`:60`, `:63`): `if (this.element === element)` — a stale element's event cannot be attributed to the current one.
  - **A remount reports `remounted`** (`:45`) so the provider can reload the latest application-known URL.

##### `packages/client/ui-sidebar-browser/src/client/view/BrowserBody.tsx`
- **Purpose:** the common browser chrome (provider-neutral).
- **Key abstractions:** `BrowserBodyProps` (`:46`), `useBrowserDraft(url, revision)` (`:48`), `SandboxPolicyIcon` (`:25`).
- **Non-obvious design decisions:**
  - **The address draft is keyed by the address revision** (`:48`): `edit?.revision === revision ? edit.value : url ?? ''` — a navigation invalidates the user's half-typed text, but an unrelated re-render does not.
  - **The mount happens in a `useLayoutEffect`** (`:72`) with a `mountEpoch` counter (`:66`) so the Reload button stays disabled until the container is committed.
  - **The provider's "open requested" event opens a NEW SOURCE TAB** (`:76`): `tab.actions.openTab('browser', { params: { url }, revealIfOpened: false })`.
  - **The "unknown address" state disables Back/Forward/external-open** and shows a "URL changed" badge (`:118`).
  - **The sandbox-off warning is a `role="status"` band**, not an alert — an informational banner.
  - **The failure band and the address-failure band are different roles**: `role="status"` for a load failure, `role="alert"` for an invalid address.

##### `packages/client/ui-sidebar-browser/src/client/index.ts` (the plugin)
- **Purpose:** registers the Browser tab type, the guide entry, the body and the title.
- **Non-obvious design decisions:**
  - **The carrier is chosen by a PROTOCOL VERSION check** (`:69`): `carrier?.protocolVersion === 1 ? carrier.browser : undefined` — an older desktop shell silently falls back to the iframe provider.
  - **`keepMounted` is set ONLY on Desktop** (`:74`): `keepMounted: desktop !== undefined` — "Desktop Browser tabs declare `keepMounted`, so Sidebar preserves their DOM across tab changes, Session switches, collapse and floating."
  - **The Web and Desktop frame installations are different compositions** (`:100`): the Desktop one additionally injects `workspaces` to resolve the storage account.
  - **The `browser.new` command opens a tab in the focused dock pane** (`:53`), and each tab plugin owns its own command's availability and localized refusal.

##### `packages/client/ui-sidebar-browser/src/client/electron/workspace.ts`
- **Purpose:** resolve the CWD-keyed Electron storage partition.
- **Key abstraction:** `browserWorkspace(source, sessionId, signal)` (`:14`).
- **Non-obvious design decisions:**
  - **The storage key is the Workspace's canonical CWD, not its record id** (`:14`): "Use the Workspace's canonical CWD, not its record id".
  - **A Session with no resolved Workspace is isolated** (`:31`): `session:<sessionId>` instead of `cwd:<path>`.
  - **The readiness wait is abort-aware and removes its subscription** (`:19`).

##### `packages/client/ui-sidebar-browser/src/client/electron/ElectronWebviewPresentation.ts`
- **Purpose:** the Electron tag DOM inside a Sidebar-owned container.
- **Key abstractions:** `class ElectronWebviewPresentation implements BrowserPresentation` (`:38`), `WebviewElement` (`:7`).
- **Non-obvious design decisions:** **the element is configured with a main-approved partition and lease** (`:63`) — `name`, `partition`, `allowpopups`, and `src: 'about:blank#<lease>'`; the guest is never created without an approval.

##### `packages/client/ui-sidebar-browser/src/client/browser/BrowserFrame.ts`, `BrowserPage.ts`, `BrowserPersistence.ts`, `store.ts`
- **Purpose:** the carrier-neutral contracts. `BrowserFrame` (navigation + observable state), `BrowserPage` (a navigation provider plus its presentation — "The owning controller disposes frame; UI mounts only presentation"), `BrowserTabState` (the *serializable* record: `entries`, `index`, `request`, `navigation`, `failure`), and `createBrowserStore()` (a Session-scoped store persisted under `dsh.sidebar-browser.v1`).

##### `packages/client/ui-sidebar-browser/src/client/view/BrowserPresentation.ts`, `BrowserTitle.tsx`, `locales.ts`, `definition.tsx`, `pages.ts`, `electron/pages.ts`, `types.ts`
- **Purpose:** the presentation contract (`mount` "ends physical attachment, without disposing the navigation model"), the live tab title (the current host name, falling back to the tab title), the dictionaries (28 keys, including the four refusal messages and the sandbox warning), the static tab definition (`multiple: true`, `priority: 'builtin'`), the two page factories, and the **type-only Electron bridge** (`DesktopBrowserBridge` — "Origin-scoped operations; no Electron objects or arbitrary IPC cross this interface").

##### `packages/client/ui-sidebar-browser/src/client/view/Browser.module.css`
- **Purpose:** the stylesheet, written as a contract: the Go button is **hidden until the address box has focus** (`visibility: hidden` → `:focus-within` reveals it); the "URL changed" badge hides while the field is focused; the unsandboxed state uses the error colour token; and a global rule — `:global(html:has([data-dockkit-pointer])) .webview { pointer-events: none; }` — stops a native guest from consuming a docking gesture's window events.

#### Tier 2 — bulk

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-sidebar-browser/README.md` | The browser-tab contract. Decides: Web uses an iframe with application-managed history, Desktop uses Electron `<webview>` with native history and retained pages; "The package never injects Electron or Node access into visited content"; Browser is **disabled by default in Web profiles** and enabled on Desktop; a host name without a scheme becomes HTTPS; public and loopback targets use the same default sandbox; the `browser.new` command's platform defaults (Cmd/Ctrl+T on Desktop; Linux Web leaves it unbound); the toolbar's five actions; **the sandbox toggle is per-tab-occurrence and not persisted**, with an amber warning; after a restart the saved title and URL are shown and "Restore or Reload opens that address **only when requested**"; the protocol policy (reject `file:`, script/data/blob, embedded credentials, the DSH origin, malformed addresses); the iframe sandbox string and the fact that "Popups leave the sandbox; in Web, an escaped popup retains its opener and can navigate the top-level application"; the navigation state machine's known/unknown rule; and a long limitations list (many sites refuse iframe embedding; a later iframe load reveals navigation but not the new URL; browsers conceal iframe failures so the load-failure notice is best-effort; saved title/URL survive reloads and plugin unload while the tab remains in the layout; local files belong to Document Preview; **Desktop shares process-local storage partitions by canonical workspace CWD** and "Host-address filtering is not a general private-network or DNS-rebinding firewall"). |
| `packages/client/ui-sidebar-browser/README.zh.md` | Chinese sibling; heading tree read (16 headings). |
| `packages/client/ui-sidebar-browser/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/ui-sidebar-browser/locale/en.json` | `meta.title = "ui-sidebar-browser"`. |
| `packages/client/ui-sidebar-browser/locale/zh.json` | `meta.title = "浏览器面板"` + description. |
| `packages/client/ui-sidebar-browser/package.json` | A `./types` export so the Host and the Client share the bridge declarations without a runtime dependency. |
| `packages/client/ui-sidebar-browser/tsconfig.json` | Two-project solution. |
| `packages/client/ui-sidebar-browser/tsconfig.client.json` | Client project includes only `src/client`, `src/types.ts` and the CSS shim. |
| `packages/client/ui-sidebar-browser/tsconfig.host.json` | Host project: only `src/index.ts` and `src/types.ts`. |
| `packages/client/ui-sidebar-browser/tsdown.config.ts` | Shared client build helper. |
| `packages/client/ui-sidebar-browser/tests/apply.client.spec.ts` | Pins the plugin: session controllers bound and rebound under desktop protocol 0 and 1; a multi-instance builtin registered with its body and title; the resolved Browser target opened with the macOS/Windows default and the shortcut released; the macOS Web default published; every registration removed on disposal. |
| `packages/client/ui-sidebar-browser/tests/apply.host.spec.ts` | One case: the Browser Host Loader entry stays inert. |
| `packages/client/ui-sidebar-browser/tests/browser-body.client.spec.tsx` | Pins the chrome: the effective refresh accelerator displayed; the saved title and URL shown **without loading until Restore is clicked**; native error details rendered and provider open requests routed through the source tab; address input routed to the controller with parser failures rendered; HTTPS in the fixed sandbox with controller history followed; later frame loads marked unknown with the unsafe toolbar actions limited; a best-effort iframe error notice shown until the next controlled load; loopback loaded under the default sandbox and kept across sandbox changes; known Web targets opened externally and an initial typed navigation consumed; a rejected initial URL kept in the address input for editing; the latest controlled URL reloaded instead of the initial URL after a remount. |
| `packages/client/ui-sidebar-browser/tests/browser-controller.client.spec.ts` | Pins the controller: restore only on request with saved checkpoints redirected to a replacement binding; refresh restoring a saved page and ignoring cancellation from a retired physical mount; provider open requests validated and late provider callbacks ignored after disposal; navigation commands ignored after the tab occurrence ends; the four navigation commands and frame load state owned; an old occurrence unable to delete a replacement controller; loopback loaded under the sandbox and reloaded across sandbox changes; public HTTP loaded without changing the sandbox policy. |
| `packages/client/ui-sidebar-browser/tests/browser-frame.client.spec.ts` | One case: the iframe implementation owns transient sandbox mode and revision-scoped load state. |
| `packages/client/ui-sidebar-browser/tests/browser-navigation.client.spec.ts` | Pins the history: bounded history, branch replacement and reload revisions; **only the first current frame load classified as known**; frame observations before a controlled request ignored. |
| `packages/client/ui-sidebar-browser/tests/browser-title.client.spec.tsx` | One case: the current page title used, falling back to the tab title. |
| `packages/client/ui-sidebar-browser/tests/electron-frame.client.spec.ts` | One case: a failed load cleared when the main page retries without a toolbar command. |
| `packages/client/ui-sidebar-browser/tests/electron-harness.client.ts` | The Electron test harness: a real presentation and navigation with the native operations replaced by spies, per-test webview events, and a guest that must actually attach before a test proceeds. |
| `packages/client/ui-sidebar-browser/tests/store.client.spec.ts` | One case: snapshots replaced and only the closed tab forgotten. |
| `packages/client/ui-sidebar-browser/tests/url.client.spec.ts` | Pins the address policy: host names and HTTPS addresses normalised; HTTP accepted including loopback hosts; **every undeclared or privileged form rejected**. |
| `packages/client/ui-sidebar-browser/tests/workspace.client.spec.ts` | Pins the storage account: resolved Sessions grouped by canonical CWD rather than Workspace identity; an authoritative baseline awaited with the readiness subscription removed; cancellation rejected before and during readiness without retaining a listener. |

### 1.13 `packages/client/ui-sidebar-documentpreview` — the file preview surface (191 files)

#### Tier 1 — load-bearing source (the core; the per-format renderers are catalogued in §1.13.1)

##### `packages/client/ui-sidebar-documentpreview/src/client/index.ts`
- **Purpose:** the browser plugin — register the `text` tab type, its dictionaries, its body and its chip title, and then register **eight** format renderers.
- **Key abstractions:** `DocumentPreviewRegistry` (provided as `ctx.documentPreviews`), `textDefinition()` (`:19`), `createTextStore()` (`:82`), `textFace(...)` (`:83`), `Config` read from the page global `__DSH_DOCUMENT_PREVIEW_CONFIG__` (`:76`).
- **Non-obvious design decisions:**
  - **The type reaches the Sidebar only through its public path** (`:3`): the definition into `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat, the chip title into `sidebar.right.pane.tab.title` — "Nothing here reaches into the Sidebar's store, its panes, or its sequence."
  - **Four Session-scoped child slots are declared** (`:93`): `sidebar.right.tab.document` (keyed), `.actions` (list), `.unpreviewable` (list), `.action` (keyed) — this is the package's extension surface for other plugins.
  - **Every import from another client plugin is a TYPE** (`:11`) — "the plugin surface is `apply`, `inject`, and the store factory".
  - **The store is shared by the body and the tools registrations** (`:83`) "which the slot runtime allows because both are session-scoped".

##### `packages/client/ui-sidebar-documentpreview/src/client/definition.ts`
- **Purpose:** stage one of the registration — what the `text` tab type IS.
- **Key abstractions:** `TEXTPREVIEW_ID`, `TEXTPREVIEW_KIND`, `basenameOf(address)` (`:27`), `textDefinition()` (`:41`).
- **Non-obvious design decisions:**
  - **The type claims the `fallback` band** (`:44`): "the plain viewer that any more specific type for the same address should beat, the position VS Code's text editor holds among its editors."
  - **The whole address is the content identity** (`:21`): "two files with one name in different directories, or one path under two sessions, are two tabs; only the chip text is shortened."
  - **`basenameOf` decodes per segment** (`:27`): a name carrying `#`, `?` or a space reads as itself; a malformed percent sequence is shown raw rather than refusing the address.
  - **`canOpen` accepts only Session addresses** (`:45`): a bare `absolute` address is not claimed — "an unclaimed address is the documented wiring error."

##### `packages/client/ui-sidebar-documentpreview/src/client/store.ts`
- **Purpose:** the preview's own state — the pages it has read and how the reader views them.
- **Key abstractions:** `createTextStore()` (`:129`), `TextTabState` (`:26`), `TextPage` (`:15`), `fresh()` (`:80`).
- **Non-obvious design decisions:**
  - **The view state must outlive the body** (`:10`): "a tab switched away from unmounts its body and must come back where it was rather than re-read or jump to its opening line again."
  - **Bucketed by tab id** (`:11`): "two tabs of one file scroll independently."
  - **A bucket lives as long as its tab record** (`:13`): the face's first read arms one listener on the owner's `signal` that forgets the bucket.
  - **Pages of two versions never meet** (`:196`): a page whose version differs from the held version clears the page map — "so the body never shows two versions at once."
  - **`lines: 0` vs `lines: 1, text: ''` are distinguished** (`:19`): the first is "a page past the file's last line", the second is "a page holding one empty line".
  - **The answered navigation revision is recorded** (`:253` `navigated`) so a remount restores the position "instead of jumping again".
  - **`reset` keeps the view but drops the pages** (`:222`): `loadRevision++` and the pages map cleared.

##### `packages/client/ui-sidebar-documentpreview/src/client/face.ts`
- **Purpose:** the preview's asynchronous half — "The component never awaits anything."
- **Key abstractions:** `textFace(read, readAll, resources)` (`:113`), `TextInjected` (`:29`), `TabReads` (`:88`).
- **Non-obvious design decisions:**
  - **The session comes from the file's ADDRESS, not from the slot's session** (`:26`): "the address is the read's whole authority" — the `inject` factory's `sessionId` argument is explicitly unused.
  - **A generation counter retires older requests** (`:146`): a settlement whose generation no longer matches writes nothing.
  - **A page of a newer version arriving past the first line restarts the walk** (`:164`): "the tab's pages are dropped and the first page read again."
  - **Cleanup rides the owner's `signal`, armed ONCE per tab by its first read** (`:131`): "the abort forgets the tab's bucket and this bookkeeping in one listener, however often its body mounts."
  - **The two read modes are mutually exclusive**: switching mode aborts the in-flight read and resets the store (`:146` `modeOf`).
  - **A rejected complete read is converted into a `RemoteError`-shaped failure** (`:186`) so the UI's failure path treats it like any other remote failure.

##### `packages/client/ui-sidebar-documentpreview/src/client/rpc.ts`
- **Purpose:** the paged and complete-byte reads, bound to the Client Remote.
- **Key abstractions:** `hostFileOf(address)` (`:60`), `createReadPage(remote)` (`:79`), `ReadWorkspaceFilePage` (`:49`), `SessionFile` (`:53`).
- **Non-obvious design decisions:**
  - **The page length is the Host's configured cap, so no `limit` travels** (`:77`).
  - **A Remote call does not reject: the result carries the failure** (`:47`).
  - **An address that is not a session-scoped file address THROWS** (`:62`): "The registry routes only session-scoped `file` addresses to this type, so an address `parseFileAddress` rejects or that carries no session is a programming error."
  - **Bytes are borrowed read-only and must be copied before a Worker transfer** (`:84`).

##### `packages/client/ui-sidebar-documentpreview/src/client/failure-line.ts`
- **Purpose:** the failure line one Remote code deserves — "Kept apart from the component so the mapping is testable on its own."
- **Key abstractions:** `failureLine(t, failure)` (`:24`), `emptyFailureRecourse(failure)` (`:47`) returning `'open'|'retry'|'none'`.
- **Non-obvious design decision:** a byte cap is rendered "the way a person reads one" (`:15`) rather than as a raw byte count; unnamed codes fall through to "the generic line carrying the carrier's message".

##### `packages/client/ui-sidebar-documentpreview/src/config.ts`
- **Purpose:** the deployment limits shared by the Host config and the browser previews.
- **Key abstractions:** `Config` (`:5`), the schemastery `Config` (`:19`).
- **Non-obvious design decisions:** the Office cache is bounded by **both** entries and bytes (8 / 64 MiB) and by pending RPCs and readers (8 / 32); the spreadsheet parser is bounded by bytes (16 MiB), **combined rectangular cell area** (250 000) and Worker lifetime (15 s).

##### `packages/client/ui-sidebar-documentpreview/src/index.ts`
- **Purpose:** the Host half — embeds the validated preview settings into every served page as `__DSH_DOCUMENT_PREVIEW_CONFIG__` (`:16`).

##### `packages/client/ui-sidebar-documentpreview/src/client/document/contract.ts`, `registry.ts`, `resource-group.ts`, `suffix.ts`, `tab-lifetime.ts`, `unviewable.ts`
- **Purpose:** the extension seam. `DocumentPreviewDefinition` (`{id, extensions, binaryExtensions?, priority, title, loading, wrap?}`), `DocumentLoadMode = 'text-pages'|'bytes-complete'|'renderer'` (`registry.ts:6`), the **matching order** (`extension` band > `builtin`, then longer suffixes, then registration order — README), `ResourceGroup` (the tab-owned dependency membership that always retains the root Resource), the shared suffix normalisation, the tab-lifetime retention helper, and the **unviewable list** — "A suffix belongs here only when its bytes are never readable text — an uncertain suffix stays out and keeps the plain-text fallback."

##### `packages/client/ui-sidebar-documentpreview/src/client/TextPreview.tsx`
- **Purpose:** the preview body — "a file's content, or the reason it is not showing."
- **Non-obvious design decisions:** the standard `useResource` hook gives the **metadata** and the type's own store holds the **content** (`:9`); a failed metadata frame "takes the same bar's place over the pages already loaded, with the same reload"; and the type's controls sit **at the end of the path row** — "the Sidebar's strip carries none of them."

##### The per-format renderers (each read via its header comment + export index)
| Renderer | Key decisions recorded in its own header |
| --- | --- |
| `text/` (`TextBody.tsx`, `index.ts`, `lines.ts`) | The plain-text fallback is registered through the **same document extension points** as the other viewers; `linesOf` "preserv[es] one empty line but exclud[es] a zero-line page" — matching the Host's own line count. |
| `code/` (`CodeBody.tsx`, `index.ts`, `locales.ts`) | "Incrementally highlighted source; the document owner supplies the accumulated text and wrap preference"; the language is chosen from the **file path**, not from the content. |
| `markdown/` (`MarkdownBody.tsx`, `frontmatter*.ts*`, `path-images.ts`, `index.ts`, `locales.ts`) | One retained Markdown renderer over the accumulated text; the YAML frontmatter parser is **lazy-loaded into its own chunk** so it stays out of the startup chunk, and the **verbatim block stands in** while it loads or if it fails; local image URLs are served by the **authenticated `/api/file` route**, resolved beside the source document, and "URL escapes are decoded once; query and fragment suffixes are excluded from the filename". |
| `image/` (`ImageBody.tsx`, `index.ts`, `locales.ts`) | "Complete image bytes rendered in a shared zoom viewport"; `imageMediaType(path)` classifies the media type from the path; the image extensions and the **binary** image extensions are separate lists (SVG is not binary); replacing or unmounting the image **revokes its Blob URL**. |
| `pdf/` (`pdf.tsx`, `LazyPdfBody.tsx`, `runtime.ts`, `document.ts`, `text.ts`, `assets.ts`, `store.ts`, `errors.ts`, `index.ts`, `locales.ts`) | The PDF renderer is a **lazy package-local chunk** — "PDF.js, its Worker source, and embedded support data stay out of the startup `client.js`"; one **real module Worker and loading task per mounted document**; the official `TextLayerBuilder` owns selection boundaries and copy normalisation; the page bitmap is capped at 16 777 216 pixels; the view store keeps "the last visible page and optional PDF zoom preference" while "document objects and canvases remain component-local". |
| `office/` (`OfficeBody.tsx`, `cache.ts`, `face.ts`, `store.ts`, `FontNotice.tsx`, `OfficeFontAction.tsx`, `index.ts`, `locales.ts`) | Office conversion results are cached by **(renderer generation, Session, absolute source path, source version)**; "Each read checks renderer generation and authorized source metadata before sharing an in-flight conversion or reusing a successful PDF"; the least-recently-used PDFs leave to keep retention within **both** limits; "Failures and PDFs larger than the byte limit are not retained"; **cancelling one reader leaves the shared conversion running until the final reader leaves**; the converted PDF is **never persisted**. |
| `excel/` (`excel.tsx`, `LazyExcelBody.tsx`, `convert.ts`, `parse.ts`, `worker.ts`, `xlsx.ts`, `xls.ts`, `xlsx-archive.ts`, `delimited.ts`, `model.ts`, `format.ts`, `error.ts`, `index.ts`, `locales.ts`) | "One workbook per disposable parser Worker; **formulas and external links are never executed**"; the XLSX preview is an **in-memory copy without DrawingML parts** ("The original file and worksheet XML remain unchanged"); CSV/TSV keep every field as **literal text** ("Values remain literal strings, including leading zeros, dates, booleans, and formula-looking text"); the parser runs in a **disposable Worker** and "transfers a copy of retained file bytes"; unsupported features are *declared*, not silently dropped (`EXCEL_UNSUPPORTED_FEATURES`). |
| `html/` (`HtmlBody.tsx`, `bootstrap.ts`, `basic-document.ts`, `pack.ts`, `read-relative.ts`, `bytes.ts`, `index.ts`, `locales.ts`) | Two policies: **Off** = a DOMPurify-sanitised static document in an iframe with **no sandbox permissions**, "CSP blocks scripts, external resources, connections, forms, and nested frames; all `href` and `xlink:href` attributes, refresh directives, and declarative shadow roots are removed before reparsing"; **On** = a scripted Blob iframe with **exactly `sandbox="allow-scripts"`** (no `allow-same-origin`). The packer collects only **direct classic `.js` and `.css`** references with fixed limits (4 MiB per asset, 32 MiB total, 64 distinct assets) — "no module, CSS dependency or runtime fetch traversal". The iframe name is `dsh-sidebar-html-<tab-id>` "for Desktop shortcut routing. This correlation does not grant the preview access to the parent document." |
| `zoom/` (`ZoomViewport.tsx`, `ZoomControls.tsx`, `store.ts`, `types.ts`, `locales.ts`) | One shared zoom viewport for every zoomable renderer; the preference is `fit-width` or a fixed scale in **25 %–400 %**; "Fit width is the default and tracks pane resizing"; the control "starts hidden, slides up when the pointer enters the bottom 72 CSS pixels, and slides down after a 420 ms leave delay". |

#### 1.13.1 Tier 2 — the rest of `ui-sidebar-documentpreview`

| File | What it is / what it pins |
| --- | --- |
| `packages/client/ui-sidebar-documentpreview/README.md` | The preview contract (30 KB — the densest document in the shard). Decides: the type claims the `fallback` band and a narrower `extension`/`builtin` type wins; the whole address is the content identity; the header shows the Host's absolute path when available; the implementation dropdown appears only with more than one renderer; **Plain text is offered only for text-compatible sources**; a known binary container suffix shows the unsupported message **without issuing a read**; two list child slots hand the previewed file to other plugins **once its metadata reports a Host path**; the wrap toggle appears only when the renderer declares `wrap: true`; the body **reaches every pane edge** ("This intentionally differs from the Files tab's 2px right-side scrollbar offset"); the registry's ranking rule; the three loading modes and the `renderer` mode's `loaded(version)` / `failed()` / `reload()` contract; the **address rules** (`.`/`..` preserved, the Host resolves them, the Session is taken only from the address); the HTML off/on policies; the spreadsheet rules (fonts/fills/borders/number formats/merges/hidden rows/frozen headings retained for XLSX; saved formula results shown **without recalculating**, with a compact formula-bar warning; the workbook viewport follows size changes **without reloading its sheets or selection**; pixel-based trackpad gestures pan the grid on both axes together); the XLSX DrawingML omission with a **notice** rather than a silent drop; the CSV/TSV literal-value rules; the Office conversion cache identity and limits; the missing-font warning ("Viewed and dismissed states are not retained"); the navigation model (a navigation "remains pending while its selected renderer has no anchor and runs if the user switches to plain text or code"); and the limitations (preview, not editing; **byte-view scroll state is not restored**; **scroll writes are unthrottled**; a failed PDF chunk load requires a page reload because React caches a rejected lazy import). |
| `packages/client/ui-sidebar-documentpreview/README.zh.md` | Chinese sibling; heading tree read. |
| `packages/client/ui-sidebar-documentpreview/README.i18n.yaml` | Generated bilingual-pair hash record; read in full. |
| `packages/client/ui-sidebar-documentpreview/licenses/FortuneSheet.txt` | The MIT licence of the bundled spreadsheet renderer (retained in the published chunk). |
| `packages/client/ui-sidebar-documentpreview/locale/en.json`, `locale/zh.json` | `meta.title` (+ a Chinese description). |
| `packages/client/ui-sidebar-documentpreview/package.json` | The manifest; the exports list the per-format subpath entries. |
| `packages/client/ui-sidebar-documentpreview/tsconfig.json`, `tsconfig.client.json`, `tsconfig.host.json`, `tsdown.config.ts` | Two-project split; the tsdown config builds the **multi-chunk** client bundle (each heavy renderer in its own chunk). |
| `packages/client/ui-sidebar-documentpreview/src/client/TextPreview.module.css` and the 12 other `*.module.css` files | Styling only; read in bulk via their leading comments (e.g. "The preview takes the pane's definite height outright, so the header stays…", "The frame follows the scroller's width, so the image's percentage maximum…"). |
| `packages/client/ui-sidebar-documentpreview/src/css-modules.d.ts`, `src/client/excel/asset-imports.d.ts`, `src/client/pdf/asset-imports.d.ts` | Module declaration shims for the CSS modules and the `?raw` asset imports (the build-owned Worker sources). |
| `packages/client/ui-sidebar-documentpreview/tests/apply.client.spec.ts` | 4 cases: the type, dictionaries and body/title seats registered under the type's id, the body with a store and a face. |
| `packages/client/ui-sidebar-documentpreview/tests/basic-html.client.spec.ts` | 3 cases: MathML navigation and links exposed by parser mutation removed; static content preserved while navigation, policy overrides and active documents are removed. |
| `packages/client/ui-sidebar-documentpreview/tests/code-body.client.spec.tsx` | 8 cases: a malformed file address rejected without starting the highlighter; multiline grammar state carried across pages with completed lines preserved. |
| `packages/client/ui-sidebar-documentpreview/tests/code-registration.client.spec.tsx` | 5 cases: builtin metadata published before the document slot exists and the body waiting to register; ini and other text configuration suffixes admitted. |
| `packages/client/ui-sidebar-documentpreview/tests/config.host.spec.ts` | 2 cases: the Client cache and spreadsheet limits exposed on the Host entry; YAML cache settings embedded in browser pages and withdrawn on disposal. |
| `packages/client/ui-sidebar-documentpreview/tests/definition.client.spec.ts` | 13 cases: the basename decoded; the whole address used when there is no last segment; a malformed percent sequence handled; the text type's registry position. |
| `packages/client/ui-sidebar-documentpreview/tests/document-preview-license-bundle.client.spec.ts` | 1 case: the bundled third-party licences kept inside the packed lazy chunks. |
| `packages/client/ui-sidebar-documentpreview/tests/document-registry.client.spec.ts` | 7 cases: matching builtins retained as alternatives beneath extensions; same-band ties broken by suffix specificity then registration order. |
| `packages/client/ui-sidebar-documentpreview/tests/document-seat.client.spec.tsx` | 5 cases: an unscoped absolute address rejected through `canOpen`; path shapes from `notes.unknown`, `/other/…`, `C:/other/…` and `//host/share/…`. |
| `packages/client/ui-sidebar-documentpreview/tests/document-toolbar.client.spec.tsx` | 13 cases: no implementation picker when plain text is the only viewer; document preparation shown before the first page and on reload. |
| `packages/client/ui-sidebar-documentpreview/tests/document-unviewable.client.spec.ts` | 3 cases: one sample from every listed category matched; matching regardless of case, directories and separators; renderer-claimed, text and unknown suffixes left out. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-body.client.spec.tsx` | 9 cases: the existing workbook refreshed on pane resize and disconnected on file replacement and unmount; loading then a workbook with editing and recalculation surfaces. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-convert.client.spec.ts` | 9 cases: values, dates, cached formulas, styles, merges, dimensions, visibility and frozen headings kept; workbooks with missing results and Chinese text opened. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-drawings.client.spec.ts` | 6 cases: charts with a DrawingML prefix opened while every displayed cell is retained; drawing parts and their relationships removed. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-formats.client.spec.ts` | 10 cases: mixed-case paths resolved per format with the byte limits enforced; unsupported filename suffixes rejected. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-opc.client.spec.ts` | 6 cases: the OPC package opened without changing the source bytes; comment VML bound independently of relationship and ZIP entry order; styles retained. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-opening.client.spec.ts` | 6 cases: cells, styles, comments, Tables and hyperlinks opened; ambiguous ASCII case-equivalent part names rejected. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-parse.client.spec.ts` | 8 cases: a private copy transferred with the Worker and URL released after parsing; no Worker allocated for aborted or oversized input; an active parse cancelled. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-readonly-panning.client.spec.ts` | 2 cases: the workbook context left on the clamped scrollbar offsets after read-only panning; a reversed gesture kept after the clamp. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-registration.client.spec.ts` | 1 case: complete binary reads registered and the slot and locale removed on disposal. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-worker.client.spec.ts` | 2 cases: parsed sheets and bounded failure categories returned; an unexpected parser failure reported as an invalid workbook. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-xml.client.spec.ts` | 10 cases: comments and Tables preserved; UTF-16 in either byte order decoded; CDATA contributing literal text. |
| `packages/client/ui-sidebar-documentpreview/tests/face.client.spec.ts` | 20 cases: a dependency subscribed once and members refused after the tab ends; the read marked in flight then the page kept; a failed read recorded; switching away from `text-pages`/`bytes-complete` retiring the previous generation. |
| `packages/client/ui-sidebar-documentpreview/tests/failure-line.client.spec.ts` | 6 cases: each workspace-file code named; the byte cap stated the way a person reads one; any other failure passed through in its own words; the empty-state recourse handed out. |
| `packages/client/ui-sidebar-documentpreview/tests/html-apply.client.spec.ts` | 2 cases: HTML suffixes claimed as a builtin complete-byte renderer without wrap; the dictionary and matching keyed body registered and every contribution removed on disposal. |
| `packages/client/ui-sidebar-documentpreview/tests/html-body.client.spec.tsx` | 10 cases: the HTML reloaded when only its CSS/JS resource changes; static HTML rendered without reading related files, running scripts or reaching the parent. |
| `packages/client/ui-sidebar-documentpreview/tests/html-bootstrap.client.spec.ts` | 4 cases: UTF-8 and script-ending text carried as data then the unchanged complete HTML written; local resources created in the frame with `base` and inline references preserved. |
| `packages/client/ui-sidebar-documentpreview/tests/html-pack.client.spec.ts` | 9 cases: direct classic JS and CSS collected in document order with duplicates deduplicated; HTTPS, module, file, root-relative, data and runtime references left alone. |
| `packages/client/ui-sidebar-documentpreview/tests/html-read-relative.client.spec.ts` | 7 cases: a relative URL decoded once with the returned bytes preserved; the **Host-resolved** dependency observed instead of a symlink or parent-segment spelling. |
| `packages/client/ui-sidebar-documentpreview/tests/image-body.client.spec.tsx` | 6 cases: the image kept non-draggable and shown after decoding succeeds; replaced bytes revoked; image decode and Blob creation failures reported. |
| `packages/client/ui-sidebar-documentpreview/tests/image-registration.client.spec.ts` | 2 cases: image suffixes claimed as a builtin complete-byte renderer without wrap; the dictionary and keyed body registered and removed on disposal. |
| `packages/client/ui-sidebar-documentpreview/tests/lines.client.spec.ts` | 4 cases: a trailing newline ends an empty last line as the Host counted it; a page holding one empty line told from a page past the file's end. |
| `packages/client/ui-sidebar-documentpreview/tests/loading-indicator.client.spec.tsx` | 2 cases: the localised document status with a larger spinner; additional-page loading compact and accessible. |
| `packages/client/ui-sidebar-documentpreview/tests/markdown-body.client.spec.tsx` | 11 cases: document images and failure text loaded under an HTTP and an app base; reference images resolved at EOF and on update. |
| `packages/client/ui-sidebar-documentpreview/tests/markdown-frontmatter-fallback.client.spec.tsx` | 1 case: the verbatim frontmatter and the body kept when the frontmatter chunk fails. |
| `packages/client/ui-sidebar-documentpreview/tests/markdown-path-images.client.spec.ts` | 7 cases: document metadata awaited only for relative images; `#figure`, `?size=2`, `//cdn.test/…`, `\\server\…` and `file:///tmp/…` destinations classified. |
| `packages/client/ui-sidebar-documentpreview/tests/markdown-registration.client.spec.tsx` | 2 cases: builtin paged Markdown declared for both suffixes without consuming source wrap; the body waiting for the document slot and releasing its locale. |
| `packages/client/ui-sidebar-documentpreview/tests/office-cache.client.spec.ts` | 22 cases: a pending conversion shared between readers with cached reads reauthorised; stale or unauthorised reuse rejected; a declared conversion failure never cached. |
| `packages/client/ui-sidebar-documentpreview/tests/office-font-notice.client.spec.tsx` | 4 cases: the details opened with focus restored on Escape or close and dismissed outside without stealing focus; the details kept open while focus moves inside. |
| `packages/client/ui-sidebar-documentpreview/tests/office-registration.client.spec.ts` | 14 cases: Office view state retained across remounts and released on tab close or plugin disposal; Word and PowerPoint kept per remote/render/files combination. |
| `packages/client/ui-sidebar-documentpreview/tests/pdf-assets.client.spec.ts` | 3 cases: the ambient build payload read only when the factory is created; a buffer PDF.js may transfer away never shared; a missing font file reported. |
| `packages/client/ui-sidebar-documentpreview/tests/pdf-body.client.spec.tsx` | 18 cases: non-byte contents reported without starting PDF.js; no load started for a tab record that has already ended; loading, zoom controls and page rendering. |
| `packages/client/ui-sidebar-documentpreview/tests/pdf-document.client.spec.ts` | 5 cases: canvas cancellation joined before cleanup when text rendering fails; cancellation when the owner aborts during the library render call. |
| `packages/client/ui-sidebar-documentpreview/tests/pdf-registration.client.spec.ts` | 2 cases: localised loading feedback while the PDF chunk resolves; a builtin complete-bytes body registered with every contribution and retained view removed. |
| `packages/client/ui-sidebar-documentpreview/tests/pdf-runtime.client.spec.ts` | 11 cases: a real module-worker port started before `getDocument` with complete bytes and local assets; startup cancelled before the worker handshake. |
| `packages/client/ui-sidebar-documentpreview/tests/pdf-smoke.client.spec.ts` | 1 case: two pages parsed and their distinct vector colours drawn in a real worker. |
| `packages/client/ui-sidebar-documentpreview/tests/pdf-store.client.spec.ts` | 2 cases: the last visible page kept per tab with only the closed tab forgotten; independent Session store instances. |
| `packages/client/ui-sidebar-documentpreview/tests/pdf-text.client.spec.ts` | 1 case: the selectable text aligned to the displayed width with its observer and DOM removed on cancellation. |
| `packages/client/ui-sidebar-documentpreview/tests/renderer-loading.client.spec.tsx` | 11 cases: a non-Office renderer loading content, reporting its version and reloading through the shared toolbar; renderer content retained across remounts. |
| `packages/client/ui-sidebar-documentpreview/tests/resource-group.client.spec.ts` | 5 cases: the initial metadata used as a baseline with only later changes invalidating; an existing member subscribed once; repeated metadata ignored. |
| `packages/client/ui-sidebar-documentpreview/tests/rpc.client.spec.ts` | 4 cases: the session and the decoded relative path read out of a session file address; the path preserved for `/etc/hosts`, `C:/w/a b.md` and `//host/share/a b.md`. |
| `packages/client/ui-sidebar-documentpreview/tests/store.client.spec.ts` | 8 cases: an explicit implementation choice cleared to resume automatic selection; the empty state and the bucket minted on the first write; pages kept by their offset. |
| `packages/client/ui-sidebar-documentpreview/tests/text-preview.client.spec.tsx` | The 32-case body suite: pages, the file's metadata, navigation and view, and the header controls — including the requested path shown until the Host supplies the absolute path (with `C:\work\…` and `\\host\share\…` shapes). |
| `packages/client/ui-sidebar-documentpreview/tests/text-title.client.spec.tsx` | 2 cases: the type sheet drawn before the title text, sized to the chip line; the sheet picked from the title's extension. |
| `packages/client/ui-sidebar-documentpreview/tests/zoom-store.client.spec.ts` | 1 case: fixed and fit-width preferences retained, only the closed tab forgotten. |
| `packages/client/ui-sidebar-documentpreview/tests/zoom-viewport.client.spec.tsx` | 5 cases: fitting without upscaling, following resize and leaving fixed zoom unchanged; missing and small content resolved to 100 %. |
| `packages/client/ui-sidebar-documentpreview/tests/excel-drawing-fixture.ts`, `excel-fixture.ts`, `excel-opc-fixture.ts`, `excel-opening-fixture.ts`, `excel-xml-fixture.ts`, `fixtures.client.ts`, `pdf-fixture.ts`, `xls-fixture.ts`, `pdf-worker.fixture.mjs` | The fixture builders that construct the synthetic workbooks, OPC packages and PDFs the suites read. |
| `packages/client/ui-sidebar-documentpreview/tests/fixtures/excel-opc/*.xlsx` (6 files), `tests/fixtures/excel-xml/*.xlsx` (8 files) | **Skipped** — binary XLSX fixtures; confirmed on disk by size and ZIP signature, not read line by line. |
| `packages/client/ui-sidebar-documentpreview/tests/fuzz/README.md`, `README.zh.md`, `README.i18n.yaml`, `excel-worker.client.ts`, `generate.py`, `run.client.ts` | The fuzz harness for the pinned ExcelJS patch: a corpus generator, a runner and a worker harness, with the README explaining the independent-writer regressions the patch must survive. |

<!-- APPEND -->
